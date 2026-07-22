/**
 * TypeScript/JavaScript 语言的 tree-sitter AST → CodeSkeleton 映射器
 * 直接遍历 AST 节点，不使用 .scm 查询文件
 */
import type Parser from 'web-tree-sitter';
import type {
  ExportSymbol,
  ExportKind,
  ImportReference,
  ParseError,
  MemberInfo,
  MemberKind,
  Language,
  Visibility,
} from '../../models/code-skeleton.js';
import type { CallSite, CalleeKind } from '../../models/call-site.js';
import type { QueryMapper, MapperOptions } from './base-mapper.js';

// ============================================================
// Feature 152 — call site 抽取常量（与 PythonMapper 对齐）
// ============================================================

/** 文件大小上限：超过 1MB 跳过 callSites 抽取（与 PythonMapper 对齐） */
const CALLSITES_MAX_FILE_BYTES = 1_000_000;

/** 动态调用名集合：这些 identifier 调用产出 unresolved（C-8 修复，无 dynamicReason 元数据） */
const DYNAMIC_CALL_NAMES = new Set(['eval', 'Function']);

/**
 * 作用域定义节点类型集合。
 * 进入这些节点时将 callerContext 压栈，离开时弹栈。
 * C-4 修复：匿名 arrow/function 也必须入栈，避免内层 callback 归属错外层 class method。
 */
const SCOPE_DEFINING_TYPES = new Set([
  'function_declaration',           // function foo() {}
  'function',                       // const f = function() {}
  'arrow_function',                 // const f = () => {}
  'method_definition',              // class Foo { bar() {} }
  // Codex final W-3 修复：generator function 也定义独立 callerContext
  'generator_function_declaration', // function* gen() {}
  'generator_function',             // const gen = function*() {}
]);

// ============================================================
// 辅助工具
// ============================================================

/** 获取节点的命名字段文本 */
function fieldText(node: Parser.SyntaxNode, fieldName: string): string | undefined {
  const child = node.childForFieldName(fieldName);
  return child?.text;
}

/** 查找节点中指定类型的第一个子节点 */
function findChild(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

/** 查找节点中所有指定类型的子节点 */
function findChildren(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  const result: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) result.push(child);
  }
  return result;
}

/** 检查 export_statement 是否为 export default */
function isDefaultExport(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'default') return true;
    if (child?.text === 'default') return true;
  }
  return false;
}

/** 检查声明是否为 async */
function isAsync(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.text === 'async') return true;
    // 遇到函数名就停止
    if (child?.type === 'identifier' || child?.type === 'type_parameters') break;
  }
  return false;
}

/** 提取 TS/JS 函数签名 */
function extractFunctionSignature(node: Parser.SyntaxNode, name: string): string {
  const asyncPrefix = isAsync(node) ? 'async ' : '';
  const typeParams = node.childForFieldName('type_parameters')?.text ?? '';
  const params = node.childForFieldName('parameters')?.text ?? '()';
  const returnType = node.childForFieldName('return_type')?.text ?? '';
  const returnSuffix = returnType ? `: ${returnType.replace(/^:\s*/, '')}` : '';

  return `${asyncPrefix}function ${name}${typeParams}${params}${returnSuffix}`;
}

/** 提取类型参数列表 */
function extractTypeParams(node: Parser.SyntaxNode): string[] {
  const typeParamsNode = node.childForFieldName('type_parameters');
  if (!typeParamsNode) return [];

  const params: string[] = [];
  for (let i = 0; i < typeParamsNode.childCount; i++) {
    const child = typeParamsNode.child(i);
    if (child && child.type === 'type_parameter') {
      params.push(child.text);
    }
  }
  return params;
}

/** 提取 class 继承和实现 */
function extractClassHeritage(node: Parser.SyntaxNode): { ext?: string; impl: string[] } {
  let ext: string | undefined;
  const impl: string[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'class_heritage') {
      for (let j = 0; j < child.childCount; j++) {
        const clause = child.child(j);
        if (!clause) continue;
        if (clause.type === 'extends_clause') {
          // extends 后面的类型
          for (let k = 0; k < clause.childCount; k++) {
            const typeNode = clause.child(k);
            if (typeNode && typeNode.type !== 'extends') {
              ext = typeNode.text;
              break;
            }
          }
        } else if (clause.type === 'implements_clause') {
          for (let k = 0; k < clause.childCount; k++) {
            const typeNode = clause.child(k);
            if (typeNode && typeNode.type !== 'implements' && typeNode.type !== ',') {
              impl.push(typeNode.text);
            }
          }
        }
      }
    }

    // tree-sitter-typescript 某些版本直接在 class 节点下有 extends_clause
    if (child.type === 'extends_clause' && !ext) {
      for (let k = 0; k < child.childCount; k++) {
        const typeNode = child.child(k);
        if (typeNode && typeNode.type !== 'extends') {
          ext = typeNode.text;
          break;
        }
      }
    }
    if (child.type === 'implements_clause') {
      for (let k = 0; k < child.childCount; k++) {
        const typeNode = child.child(k);
        if (typeNode && typeNode.type !== 'implements' && typeNode.type !== ',') {
          impl.push(typeNode.text);
        }
      }
    }
  }

  return { ext, impl };
}

/** 从 accessibility_modifier 提取可见性 */
function getMemberVisibility(node: Parser.SyntaxNode): Visibility | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'accessibility_modifier') {
      if (child.text === 'public') return 'public';
      if (child.text === 'protected') return 'protected';
      if (child.text === 'private') return 'private';
    }
  }
  return undefined;
}

/** 检查成员是否为 static */
function isMemberStatic(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.text === 'static') return true;
    // 遇到实际声明内容就停止
    if (child?.type === 'identifier' || child?.type === 'property_identifier') break;
  }
  return false;
}

/** 检查成员是否为 abstract */
function isMemberAbstract(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.text === 'abstract') return true;
  }
  return false;
}

// ============================================================
// TypeScriptMapper
// ============================================================

export class TypeScriptMapper implements QueryMapper {
  readonly language: Language = 'typescript';

  /**
   * 从 AST tree 提取导出符号
   * 处理 export_statement 包装的各种声明
   */
  extractExports(
    tree: Parser.Tree,
    _source: string,
    _options: MapperOptions = {},
  ): ExportSymbol[] {
    const rootNode = tree.rootNode;
    if (rootNode.childCount === 0) return [];

    const exports: ExportSymbol[] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      if (node.type === 'export_statement') {
        const symbols = this._extractExportStatement(node);
        exports.push(...symbols);
      }
    }

    return exports;
  }

  /**
   * 从 AST tree 提取导入引用
   *
   * Feature 156 W1.0 v2 / CRIT-3：除 `import_statement` 外，还要遍历 AST 找
   *   - `call_expression` callee = `import` keyword → dynamic import
   *   - `call_expression` callee = `require` Identifier → commonjs-require
   *
   * 这样 tree-sitter 降级路径下 AC-11 的 dynamic / commonjs-require 边也能产出
   * （ts-morph 主路径已在 ast-analyzer.ts 覆盖）。
   */
  extractImports(tree: Parser.Tree, _source: string): ImportReference[] {
    const rootNode = tree.rootNode;
    if (rootNode.childCount === 0) return [];

    const imports: ImportReference[] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node || node.type !== 'import_statement') continue;

      const ref = this._extractImportStatement(node);
      if (ref) imports.push(ref);
    }

    // CRIT-3：遍历整棵 AST 找 dynamic import / commonjs-require
    this._collectCallExpressionImports(rootNode, imports);

    return imports;
  }

  /**
   * 递归遍历 AST，识别 dynamic import / commonjs-require 调用并产出对应 ImportReference。
   *
   * 仅识别 AST 结构上的 call_expression 节点 — 不是文本正则，因此能避免 WARN-2 类
   * 字符串 / 注释中的 "require('./x')" 误命中（tree-sitter parser 会把它们标识为
   * string / comment 节点，不会形成 call_expression 子树）。
   */
  private _collectCallExpressionImports(
    node: Parser.SyntaxNode,
    imports: ImportReference[],
  ): void {
    if (node.type === 'call_expression') {
      const ref = this._extractCallExpressionImport(node);
      if (ref) imports.push(ref);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) this._collectCallExpressionImports(child, imports);
    }
  }

  /**
   * 从 call_expression 节点派生 ImportReference（仅当 callee 为 `import` keyword 或
   * `require` Identifier 时）。
   *
   * tree-sitter-typescript grammar 把动态 import callee 标识为 `import` 节点（type==='import'），
   * require 调用则是 type==='identifier' && text==='require'。
   */
  private _extractCallExpressionImport(call: Parser.SyntaxNode): ImportReference | null {
    const fn = call.childForFieldName('function');
    if (!fn) return null;

    let kind: 'dynamic' | 'commonjs-require' | null = null;
    if (fn.type === 'import') {
      kind = 'dynamic';
    } else if (fn.type === 'identifier' && fn.text === 'require') {
      kind = 'commonjs-require';
    }
    if (!kind) return null;

    // 取第一个参数（必须是字符串字面量）
    const args = call.childForFieldName('arguments');
    if (!args) return null;

    let firstStringArg: Parser.SyntaxNode | null = null;
    for (let i = 0; i < args.childCount; i++) {
      const arg = args.child(i);
      if (!arg) continue;
      if (arg.type === 'string') {
        firstStringArg = arg;
        break;
      }
    }
    if (!firstStringArg) return null;

    // 提取 string 字面量的文本内容（剥首尾引号 / 取 string_fragment 子节点）
    let moduleSpecifier = firstStringArg.text.replace(/^['"`]|['"`]$/g, '');
    // tree-sitter 把 string 节点细分为 ' / string_fragment / '；优先用 fragment 子节点更稳
    for (let i = 0; i < firstStringArg.childCount; i++) {
      const child = firstStringArg.child(i);
      if (child?.type === 'string_fragment') {
        moduleSpecifier = child.text;
        break;
      }
    }
    if (!moduleSpecifier) return null;

    const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
    return {
      moduleSpecifier,
      isRelative,
      resolvedPath: null,
      isTypeOnly: false,
      importType: kind,
    };
  }

  /**
   * 从 AST tree 提取解析错误
   */
  extractParseErrors(tree: Parser.Tree): ParseError[] {
    const errors: ParseError[] = [];
    this._collectErrors(tree.rootNode, errors);
    return errors;
  }

  // ============================================================
  // 内部方法 — 导出提取
  // ============================================================

  /** 处理 export_statement */
  private _extractExportStatement(node: Parser.SyntaxNode): ExportSymbol[] {
    const symbols: ExportSymbol[] = [];
    const isDefault = isDefaultExport(node);

    // 遍历 export_statement 的子节点查找实际声明
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      switch (child.type) {
        case 'function_declaration': {
          const sym = this._extractFunctionDeclaration(child, isDefault, node);
          if (sym) symbols.push(sym);
          break;
        }
        case 'class_declaration': {
          const sym = this._extractClassDeclaration(child, isDefault, node);
          if (sym) symbols.push(sym);
          break;
        }
        case 'interface_declaration': {
          const sym = this._extractInterfaceDeclaration(child, isDefault, node);
          if (sym) symbols.push(sym);
          break;
        }
        case 'type_alias_declaration': {
          const sym = this._extractTypeAliasDeclaration(child, isDefault, node);
          if (sym) symbols.push(sym);
          break;
        }
        case 'enum_declaration': {
          const sym = this._extractEnumDeclaration(child, isDefault, node);
          if (sym) symbols.push(sym);
          break;
        }
        case 'lexical_declaration': {
          const syms = this._extractLexicalDeclaration(child, isDefault, node);
          symbols.push(...syms);
          break;
        }
        case 'export_clause': {
          // re-export: export { x } from 'y' 或 export { x }
          const syms = this._extractExportClause(child, node);
          symbols.push(...syms);
          break;
        }
        default:
          break;
      }
    }

    return symbols;
  }

  /** 提取 function_declaration */
  private _extractFunctionDeclaration(
    node: Parser.SyntaxNode,
    isDefault: boolean,
    wrapperNode: Parser.SyntaxNode,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name') ?? (isDefault ? 'default' : 'anonymous');
    const signature = extractFunctionSignature(node, name);
    const typeParams = extractTypeParams(node);

    return {
      name,
      kind: 'function',
      signature,
      jsDoc: null,
      typeParameters: typeParams.length > 0 ? typeParams : undefined,
      isDefault,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
    };
  }

  /** 提取 class_declaration */
  private _extractClassDeclaration(
    node: Parser.SyntaxNode,
    isDefault: boolean,
    wrapperNode: Parser.SyntaxNode,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name') ?? (isDefault ? 'default' : 'anonymous');
    const typeParams = extractTypeParams(node);
    const heritage = extractClassHeritage(node);

    const typeParamStr = typeParams.length > 0 ? `<${typeParams.join(', ')}>` : '';
    let signature = `class ${name}${typeParamStr}`;
    if (heritage.ext) signature += ` extends ${heritage.ext}`;
    if (heritage.impl.length > 0) signature += ` implements ${heritage.impl.join(', ')}`;

    const members = this._extractClassMembers(node);

    return {
      name,
      kind: 'class',
      signature,
      jsDoc: null,
      typeParameters: typeParams.length > 0 ? typeParams : undefined,
      isDefault,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
      members: members.length > 0 ? members : undefined,
    };
  }

  /** 提取 interface_declaration */
  private _extractInterfaceDeclaration(
    node: Parser.SyntaxNode,
    isDefault: boolean,
    wrapperNode: Parser.SyntaxNode,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name') ?? 'anonymous';
    const typeParams = extractTypeParams(node);

    const typeParamStr = typeParams.length > 0 ? `<${typeParams.join(', ')}>` : '';
    let signature = `interface ${name}${typeParamStr}`;

    // 提取 extends
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'extends_type_clause' || child?.type === 'extends_clause') {
        const types: string[] = [];
        for (let j = 0; j < child.childCount; j++) {
          const typeNode = child.child(j);
          if (typeNode && typeNode.type !== 'extends' && typeNode.type !== ',') {
            types.push(typeNode.text);
          }
        }
        if (types.length > 0) {
          signature += ` extends ${types.join(', ')}`;
        }
      }
    }

    const members = this._extractInterfaceMembers(node);

    return {
      name,
      kind: 'interface',
      signature,
      jsDoc: null,
      typeParameters: typeParams.length > 0 ? typeParams : undefined,
      isDefault,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
      members: members.length > 0 ? members : undefined,
    };
  }

  /** 提取 type_alias_declaration */
  private _extractTypeAliasDeclaration(
    node: Parser.SyntaxNode,
    isDefault: boolean,
    wrapperNode: Parser.SyntaxNode,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name') ?? 'anonymous';
    const typeParams = extractTypeParams(node);
    const typeParamStr = typeParams.length > 0 ? `<${typeParams.join(', ')}>` : '';

    // type alias 签名去掉 = 之后的定义体
    const fullText = node.text;
    const eqIdx = fullText.indexOf('=');
    const signature = eqIdx > 0 ? fullText.slice(0, eqIdx).trim() : `type ${name}${typeParamStr}`;

    return {
      name,
      kind: 'type',
      signature,
      jsDoc: null,
      typeParameters: typeParams.length > 0 ? typeParams : undefined,
      isDefault,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
    };
  }

  /** 提取 enum_declaration */
  private _extractEnumDeclaration(
    node: Parser.SyntaxNode,
    isDefault: boolean,
    wrapperNode: Parser.SyntaxNode,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name') ?? 'anonymous';
    const isConst = node.text.trimStart().startsWith('const ');
    const signature = isConst ? `const enum ${name}` : `enum ${name}`;

    return {
      name,
      kind: 'enum',
      signature,
      jsDoc: null,
      isDefault,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
    };
  }

  /** 提取 lexical_declaration（const/let/var） */
  private _extractLexicalDeclaration(
    node: Parser.SyntaxNode,
    isDefault: boolean,
    wrapperNode: Parser.SyntaxNode,
  ): ExportSymbol[] {
    const symbols: ExportSymbol[] = [];

    // 判断是 const 还是 let
    let keyword = 'const';
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.text === 'let') { keyword = 'let'; break; }
      if (child?.text === 'var') { keyword = 'var'; break; }
    }

    const kind: ExportKind = keyword === 'const' ? 'const' : 'variable';

    // 遍历 variable_declarator
    const declarators = findChildren(node, 'variable_declarator');
    for (const decl of declarators) {
      const name = fieldText(decl, 'name') ?? 'anonymous';
      const typeAnnotation = decl.childForFieldName('type');
      const typeSuffix = typeAnnotation ? `: ${typeAnnotation.text.replace(/^:\s*/, '')}` : '';
      const signature = `${keyword} ${name}${typeSuffix}`;

      symbols.push({
        name,
        kind,
        signature,
        jsDoc: null,
        isDefault,
        startLine: wrapperNode.startPosition.row + 1,
        endLine: wrapperNode.endPosition.row + 1,
      });
    }

    return symbols;
  }

  /**
   * 提取 export_clause (re-export)
   *
   * 已知限界（F221 裁决 1）：tree-sitter 降级路径把 re-export 产出为 kind='variable'
   * 而非 ts-morph 主路径的 kind='re-export'（无 reExportFrom/isTypeOnly 标记），
   * 因此不会被图派生 / call-resolver 的 re-export 过滤命中——该 parity gap 仅在
   * ts-morph parse 失败（语法非法文件）时触发，修复前后行为一致，parity 修复单独立项。
   */
  private _extractExportClause(
    clauseNode: Parser.SyntaxNode,
    exportNode: Parser.SyntaxNode,
  ): ExportSymbol[] {
    const symbols: ExportSymbol[] = [];

    // 查找 source（from 'module'）
    const sourceNode = findChild(exportNode, 'string');
    const _source = sourceNode?.text.replace(/^['"]|['"]$/g, '');

    // 遍历 export_specifier
    for (let i = 0; i < clauseNode.childCount; i++) {
      const child = clauseNode.child(i);
      if (child?.type === 'export_specifier') {
        const name = fieldText(child, 'name') ?? child.text;
        const alias = fieldText(child, 'alias');
        const exportedName = alias ?? name;

        symbols.push({
          name: exportedName,
          kind: 'variable', // re-export 无法确定实际 kind
          signature: _source ? `export { ${name} } from '${_source}'` : `export { ${name} }`,
          jsDoc: null,
          isDefault: false,
          startLine: exportNode.startPosition.row + 1,
          endLine: exportNode.endPosition.row + 1,
        });
      }
    }

    return symbols;
  }

  // ============================================================
  // 内部方法 — 成员提取
  // ============================================================

  /** 提取 class 成员 */
  private _extractClassMembers(node: Parser.SyntaxNode): MemberInfo[] {
    const members: MemberInfo[] = [];
    const body = node.childForFieldName('body') ?? findChild(node, 'class_body');
    if (!body) return members;

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      const member = this._extractClassMember(child);
      if (member) members.push(member);
    }

    return members;
  }

  /** 提取单个 class 成员 */
  private _extractClassMember(node: Parser.SyntaxNode): MemberInfo | null {
    const visibility = getMemberVisibility(node);
    const isStatic = isMemberStatic(node);
    const isAbstract = isMemberAbstract(node) || undefined;

    switch (node.type) {
      case 'method_definition': {
        return this._extractMethodDefinition(node, visibility, isStatic, isAbstract);
      }
      case 'public_field_definition': {
        return this._extractFieldDefinition(node, visibility, isStatic, isAbstract);
      }
      default:
        return null;
    }
  }

  /** 提取方法定义 */
  private _extractMethodDefinition(
    node: Parser.SyntaxNode,
    visibility: Visibility | undefined,
    isStatic: boolean,
    isAbstract: boolean | undefined,
  ): MemberInfo | null {
    const name = fieldText(node, 'name');
    if (!name) return null;

    // 判断是否为 getter/setter/constructor
    let kind: MemberKind = 'method';
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.text === 'get') { kind = 'getter'; break; }
      if (child?.text === 'set') { kind = 'setter'; break; }
    }
    if (name === 'constructor') kind = 'constructor';

    const asyncPrefix = isAsync(node) ? 'async ' : '';
    const params = node.childForFieldName('parameters')?.text ?? '()';
    const returnType = node.childForFieldName('return_type');
    const returnSuffix = returnType ? `: ${returnType.text.replace(/^:\s*/, '')}` : '';

    let signature: string;
    if (kind === 'getter') {
      signature = `get ${name}()${returnSuffix}`;
    } else if (kind === 'setter') {
      signature = `set ${name}${params}`;
    } else if (kind === 'constructor') {
      signature = `constructor${params}`;
    } else {
      signature = `${asyncPrefix}${name}${params}${returnSuffix}`;
    }

    return {
      name,
      kind,
      signature,
      jsDoc: null,
      visibility,
      isStatic,
      isAbstract,
    };
  }

  /** 提取字段定义 */
  private _extractFieldDefinition(
    node: Parser.SyntaxNode,
    visibility: Visibility | undefined,
    isStatic: boolean,
    isAbstract: boolean | undefined,
  ): MemberInfo | null {
    const name = fieldText(node, 'name') ?? node.childForFieldName('property')?.text;
    if (!name) return null;

    const typeAnnotation = node.childForFieldName('type');
    const typeSuffix = typeAnnotation ? `: ${typeAnnotation.text.replace(/^:\s*/, '')}` : '';
    const signature = `${name}${typeSuffix}`;

    return {
      name,
      kind: 'property' as MemberKind,
      signature,
      jsDoc: null,
      visibility,
      isStatic,
      isAbstract,
    };
  }

  /** 提取 interface 成员 */
  private _extractInterfaceMembers(node: Parser.SyntaxNode): MemberInfo[] {
    const members: MemberInfo[] = [];
    const body = node.childForFieldName('body') ?? findChild(node, 'object_type') ?? findChild(node, 'interface_body');
    if (!body) return members;

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      if (child.type === 'method_signature' || child.type === 'method_definition') {
        const name = fieldText(child, 'name');
        if (!name) continue;

        const params = child.childForFieldName('parameters')?.text ?? '()';
        const returnType = child.childForFieldName('return_type');
        const returnSuffix = returnType ? `: ${returnType.text.replace(/^:\s*/, '')}` : '';
        const signature = `${name}${params}${returnSuffix}`;

        members.push({
          name,
          kind: 'method',
          signature,
          jsDoc: null,
          isStatic: false,
        });
      } else if (child.type === 'property_signature') {
        const name = fieldText(child, 'name');
        if (!name) continue;

        const typeAnnotation = child.childForFieldName('type');
        const typeSuffix = typeAnnotation ? `: ${typeAnnotation.text.replace(/^:\s*/, '')}` : '';
        const signature = `${name}${typeSuffix}`;

        members.push({
          name,
          kind: 'property',
          signature,
          jsDoc: null,
          isStatic: false,
        });
      }
    }

    return members;
  }

  // ============================================================
  // 内部方法 — 导入提取
  // ============================================================

  /** 提取 import_statement */
  private _extractImportStatement(node: Parser.SyntaxNode): ImportReference | null {
    // 检查 import type
    let isTypeOnly = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.text === 'type' && i > 0) {
        // import type ... 中 type 在 import 之后
        const prev = node.child(i - 1);
        if (prev?.text === 'import') {
          isTypeOnly = true;
          break;
        }
      }
    }

    // 提取 module specifier（字符串字面量）
    let moduleSpecifier = '';
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      moduleSpecifier = sourceNode.text.replace(/^['"]|['"]$/g, '');
    } else {
      // 尝试查找 string 子节点
      const stringNode = findChild(node, 'string');
      if (stringNode) {
        moduleSpecifier = stringNode.text.replace(/^['"]|['"]$/g, '');
      }
    }

    if (!moduleSpecifier) return null;

    const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');

    // 提取 named imports
    const namedImports: string[] = [];
    let defaultImport: string | null = null;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === 'import_clause') {
        // import_clause 可能包含 default import 和 named imports
        for (let j = 0; j < child.childCount; j++) {
          const clauseChild = child.child(j);
          if (!clauseChild) continue;

          if (clauseChild.type === 'identifier') {
            defaultImport = clauseChild.text;
          } else if (clauseChild.type === 'named_imports') {
            for (let k = 0; k < clauseChild.childCount; k++) {
              const specifier = clauseChild.child(k);
              if (specifier?.type === 'import_specifier') {
                const importedName = fieldText(specifier, 'name') ?? specifier.text;
                namedImports.push(importedName);
              }
            }
          } else if (clauseChild.type === 'namespace_import') {
            // import * as name
            const alias = fieldText(clauseChild, 'alias') ?? clauseChild.text;
            defaultImport = alias;
          }
        }
      }

      // 有些 tree-sitter 版本直接在 import_statement 下有 named_imports
      if (child.type === 'named_imports') {
        for (let j = 0; j < child.childCount; j++) {
          const specifier = child.child(j);
          if (specifier?.type === 'import_specifier') {
            const importedName = fieldText(specifier, 'name') ?? specifier.text;
            namedImports.push(importedName);
          }
        }
      }

      // 直接的 identifier 可能是 default import
      if (child.type === 'identifier' && i > 0) {
        const prev = node.child(i - 1);
        if (prev?.text === 'import' || prev?.text === 'type') {
          defaultImport = child.text;
        }
      }
    }

    return {
      moduleSpecifier,
      isRelative,
      resolvedPath: null,
      namedImports: namedImports.length > 0 ? namedImports : undefined,
      defaultImport,
      isTypeOnly,
    };
  }

  // ============================================================
  // 内部方法 — 错误收集
  // ============================================================

  /** 递归收集 AST 中的 ERROR 节点 */
  private _collectErrors(node: Parser.SyntaxNode, errors: ParseError[]): void {
    if (node.type === 'ERROR' || node.hasError) {
      if (node.type === 'ERROR') {
        errors.push({
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          message: `语法错误: 无法解析的节点 "${node.text.slice(0, 100)}"`,
        });
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type !== 'ERROR') {
          this._collectErrors(child, errors);
        }
      }
    }
  }

  // ============================================================
  // Feature 152 — call site 抽取（FR-1.1 ~ FR-1.5）
  // ============================================================

  /**
   * 从 AST tree 提取函数调用点（Feature 152 P1）。
   *
   * 覆盖 6 种 calleeKind：free / member / cross-module / super / decorator / unresolved。
   * TS extractor 不产出 dunder kind（CL-08）。
   * 大文件 size guard（EC-14）：source.length > 1MB 直接返回空数组。
   */
  extractCallSites(tree: Parser.Tree, source: string): CallSite[] {
    // size guard：文件超过 1MB 跳过，避免内存/性能问题
    if (source.length > CALLSITES_MAX_FILE_BYTES) {
      return [];
    }

    const out: CallSite[] = [];
    const callerContextStack: string[] = [];

    this._walkCallSites(tree.rootNode, callerContextStack, out);
    return out;
  }

  /**
   * 递归遍历 AST 抽取 call sites。
   * callerContextStack 维护当前 function/class 嵌套作用域，进入 SCOPE_DEFINING_TYPES 时压栈。
   * W-3 修复：handleDecorator 返回需跳过的子树节点，walker 在递归前跳过该节点。
   */
  private _walkCallSites(
    node: Parser.SyntaxNode,
    callerContextStack: string[],
    out: CallSite[],
  ): void {
    // 进入作用域定义节点时推入 callerContext（C-4 修复：匿名 arrow/function 也入栈）
    let pushedCtx = false;
    if (SCOPE_DEFINING_TYPES.has(node.type)) {
      const ctx = this._deriveCallerContext(node);
      if (ctx != null) {
        callerContextStack.push(ctx);
        pushedCtx = true;
      }
    }

    // 获取当前 callerContext（栈顶）
    const callerCtx = callerContextStack.length > 0
      ? callerContextStack[callerContextStack.length - 1]
      : undefined;

    // 核心分发：产出 callSite
    let skipSubtree: Parser.SyntaxNode | null = null;

    switch (node.type) {
      case 'call_expression':
        this._handleCallExpression(node, callerCtx, out);
        break;
      case 'new_expression':
        this._handleNewExpression(node, callerCtx, out);
        break;
      case 'decorator':
        skipSubtree = this._handleDecorator(node, callerCtx, out);
        break;
      case 'tagged_template_expression':
        this._handleTaggedTemplate(node, callerCtx, out);
        break;
      default:
        break;
    }

    // 递归子节点（W-3 修复：跳过 decorator 内 call_expression 子树，避免双计数）
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      // 如果当前节点的 handleDecorator 标记了要跳过的子树，则跳过该子树
      if (skipSubtree != null && child.id === skipSubtree.id) continue;
      this._walkCallSites(child, callerContextStack, out);
    }

    // 出栈
    if (pushedCtx) {
      callerContextStack.pop();
    }
  }

  /**
   * 推导当前节点的 callerContext 字符串。
   *
   * C-4 修复：匿名 arrow_function / function 也产生 `<arrow:line:col>` / `<fn:line:col>`，
   * 确保内层 callback 不会错误归属外层 class method。
   */
  private _deriveCallerContext(node: Parser.SyntaxNode): string | null {
    switch (node.type) {
      case 'function_declaration': {
        const name = fieldText(node, 'name');
        if (name) return name;
        // 匿名函数声明（理论上少见）
        return `<fn:${node.startPosition.row + 1}:${node.startPosition.column}>`;
      }
      case 'method_definition': {
        const name = fieldText(node, 'name');
        const className = this._findAncestorClassName(node);
        if (className && name) return `${className}.${name}`;
        return name ?? null;
      }
      case 'arrow_function': {
        // 尝试从 variable_declarator 父节点获取变量名
        const parent = node.parent;
        if (parent?.type === 'variable_declarator') {
          const varName = fieldText(parent, 'name');
          if (varName) return varName;
        }
        // C-4 修复：匿名 arrow function 用位置唯一化
        return `<arrow:${node.startPosition.row + 1}:${node.startPosition.column}>`;
      }
      case 'function': {
        // 函数表达式（const f = function() {}）
        const parent = node.parent;
        if (parent?.type === 'variable_declarator') {
          const varName = fieldText(parent, 'name');
          if (varName) return varName;
        }
        // C-4 修复：匿名 function 表达式用位置唯一化
        return `<fn:${node.startPosition.row + 1}:${node.startPosition.column}>`;
      }
      case 'generator_function_declaration': {
        // Codex final W-3 修复：generator function 声明 function* gen() {}
        const name = fieldText(node, 'name');
        if (name) return name;
        return `<gen:${node.startPosition.row + 1}:${node.startPosition.column}>`;
      }
      case 'generator_function': {
        // generator function 表达式：const gen = function*() {}
        const parent = node.parent;
        if (parent?.type === 'variable_declarator') {
          const varName = fieldText(parent, 'name');
          if (varName) return varName;
        }
        return `<gen:${node.startPosition.row + 1}:${node.startPosition.column}>`;
      }
      default:
        return null;
    }
  }

  /**
   * 向上遍历 AST 找到最近的 class_declaration 节点，返回类名。
   * 用于 method_definition 推导 callerContext（如 "Foo.bar"）。
   */
  private _findAncestorClassName(node: Parser.SyntaxNode): string | null {
    let current: Parser.SyntaxNode | null = node.parent;
    while (current != null) {
      if (current.type === 'class_body' || current.type === 'class_declaration' || current.type === 'class') {
        // class_body 的父节点才是 class_declaration
        if (current.type === 'class_body') {
          const classDecl = current.parent;
          if (classDecl) {
            const name = fieldText(classDecl, 'name');
            if (name) return name;
          }
        } else {
          const name = fieldText(current, 'name');
          if (name) return name;
        }
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * 处理 call_expression 节点，分流 7 种形态（T-008）：
   * 1. dynamic import(`import('./x')`) → unresolved，calleeName='import'
   * 2. super() 自调用 → super
   * 3. eval/Function identifier → unresolved
   * 4. 普通 identifier 调用 → free
   * 5. C-3 修复：import().then() 链式 — 检测并跳过外层 .then 防双计数
   * 6. member_expression → handleMemberCall
   * 7. optional chain 等复杂形式 → 尽力提取 member_expression
   *
   * C-8 修复：mkCallSite 不接受 dynamicReason 参数（CallSite schema 仅 6 字段）。
   */
  private _handleCallExpression(
    node: Parser.SyntaxNode,
    callerCtx: string | undefined,
    out: CallSite[],
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    // dynamic import：`import('./x')` — funcNode.type 为 'import'
    if (funcNode.type === 'import') {
      out.push(this._mkCallSite('import', 'unresolved', node, callerCtx));
      return;
    }

    // super() 构造器自调用（call_expression 中 func 为 super）
    if (funcNode.type === 'super') {
      out.push(this._mkCallSite('super', 'super', node, callerCtx));
      return;
    }

    // identifier 形式：foo() / eval() / Function()
    if (funcNode.type === 'identifier') {
      const name = funcNode.text;
      // eval / Function → unresolved（C-8 修复：无 dynamicReason 元数据）
      if (DYNAMIC_CALL_NAMES.has(name)) {
        out.push(this._mkCallSite(name, 'unresolved', node, callerCtx));
        return;
      }
      // 普通 free 调用
      out.push(this._mkCallSite(name, 'free', node, callerCtx));
      return;
    }

    // member_expression 形式：obj.method() / Class.method()
    if (funcNode.type === 'member_expression') {
      // C-3 修复：检测链式 `import('./x').then(cb)` 模式，避免 .then 被双计数
      // 模式：call_expression(function=member_expression(object=call_expression(function=import)))
      const objectNode = funcNode.childForFieldName('object');
      if (objectNode?.type === 'call_expression') {
        const innerFunc = objectNode.childForFieldName('function');
        if (innerFunc?.type === 'import') {
          // 外层 .then(cb) 跳过——内层 import() 由递归子节点产出
          return;
        }
      }
      this._handleMemberCall(funcNode, node, callerCtx, out);
      return;
    }

    // optional_member_expression：obj?.method()（tree-sitter 对应节点类型）
    if (funcNode.type === 'optional_member_expression') {
      this._handleMemberCall(funcNode, node, callerCtx, out);
      return;
    }

    // 其他复杂形式（括号包裹的表达式等）→ 跳过
  }

  /**
   * 处理 member_expression / optional_member_expression 中的调用（严格与 PythonMapper L943-953 对齐）：
   * - this.method() → member（无 qualifier）
   * - super.method() → super
   * - 首字母大写 qualifier（Class.method）→ member + qualifier
   * - 首字母小写 qualifier（mod.fn）→ cross-module + qualifier（关键：不是 member）
   */
  private _handleMemberCall(
    memberNode: Parser.SyntaxNode,
    callNode: Parser.SyntaxNode,
    callerCtx: string | undefined,
    out: CallSite[],
  ): void {
    const objectNode = memberNode.childForFieldName('object');
    const propertyNode = memberNode.childForFieldName('property');
    if (!propertyNode) return;

    const calleeName = propertyNode.text;
    const qualifier = objectNode?.text ?? '';

    // this.method() → member（无 qualifier，resolver 通过 callerContext 定位类）
    if (qualifier === 'this') {
      out.push(this._mkCallSite(calleeName, 'member', callNode, callerCtx));
      return;
    }

    // super.method() → super
    if (qualifier === 'super') {
      out.push(this._mkCallSite(calleeName, 'super', callNode, callerCtx));
      return;
    }

    // 首字母大写（Class.method）→ member + qualifier
    if (qualifier && /^[A-Z]/.test(qualifier)) {
      out.push(this._mkCallSite(calleeName, 'member', callNode, callerCtx, qualifier));
      return;
    }

    // 首字母小写（mod.fn）→ cross-module + qualifier（与 PythonMapper 对齐）
    if (qualifier) {
      out.push(this._mkCallSite(calleeName, 'cross-module', callNode, callerCtx, qualifier));
      return;
    }

    // 无 qualifier 兜底 → cross-module
    out.push(this._mkCallSite(calleeName, 'cross-module', callNode, callerCtx));
  }

  /**
   * 处理 new_expression 节点（T-009）。
   * - new Foo() → free，calleeName='Foo'（FR-1.3）
   * - new Function('code') → unresolved（W-2 修复，避免误判为本地构造）
   * - new Foo.Sub() → 委派 handleMemberCall
   * C-8 修复：不向 CallSite schema 添加 viaNew 元数据字段。
   */
  private _handleNewExpression(
    node: Parser.SyntaxNode,
    callerCtx: string | undefined,
    out: CallSite[],
  ): void {
    const constructorNode = node.childForFieldName('constructor');
    if (!constructorNode) return;

    // identifier 形式：new Foo()
    if (constructorNode.type === 'identifier') {
      const name = constructorNode.text;
      // W-2 修复：new Function('code') → unresolved（动态构造，避免误判为本地构造）
      if (name === 'Function') {
        out.push(this._mkCallSite('Function', 'unresolved', node, callerCtx));
        return;
      }
      // 普通构造：new Foo() → free，calleeName='Foo'
      out.push(this._mkCallSite(name, 'free', node, callerCtx));
      return;
    }

    // member_expression 形式：new Foo.Sub()（如 new express.Router()）
    if (constructorNode.type === 'member_expression') {
      this._handleMemberCall(constructorNode, node, callerCtx, out);
      return;
    }
  }

  /**
   * 处理 decorator 节点（T-010）。
   * - 带参 decorator `@Foo()` → decorator kind
   * - bare decorator `@Foo`（无括号）→ 不产出（与 Python CL-04 对齐）
   *
   * W-3 修复：找到带参 decorator 的 call_expression 后产出 callSite，
   * 返回该 call_expression 节点作为跳过标记，walker 不再递归进入，
   * 避免 call_expression 子节点被 walker 再次产出 free/member callSite（双计数）。
   *
   * @returns 需要跳过的子树节点（call_expression），或 null（bare decorator 不产出）
   */
  private _handleDecorator(
    node: Parser.SyntaxNode,
    callerCtx: string | undefined,
    out: CallSite[],
  ): Parser.SyntaxNode | null {
    // 找 decorator 节点的 call_expression 子节点（带参 decorator 才有）
    const callExpr = findChild(node, 'call_expression');
    if (!callExpr) {
      // bare decorator（@Foo 无括号）→ 不产出，无需跳过子树
      return null;
    }

    // 从 call_expression 中取 callee 名称
    const funcNode = callExpr.childForFieldName('function');
    if (!funcNode) return callExpr;

    let calleeName: string;
    if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
    } else if (funcNode.type === 'member_expression') {
      const propNode = funcNode.childForFieldName('property');
      calleeName = propNode?.text ?? 'unknown';
    } else {
      calleeName = 'unknown';
    }

    out.push(this._mkCallSite(calleeName, 'decorator', callExpr, callerCtx));

    // 返回 callExpr，让 walker 跳过该子树，避免双计数（W-3 修复）
    return callExpr;
  }

  /**
   * 处理 tagged_template_expression 节点（T-010）。
   * - tag 为 identifier → free
   * - tag 为 member_expression → 委派 handleMemberCall
   */
  private _handleTaggedTemplate(
    node: Parser.SyntaxNode,
    callerCtx: string | undefined,
    out: CallSite[],
  ): void {
    const tagNode = node.childForFieldName('tag');
    if (!tagNode) return;

    if (tagNode.type === 'identifier') {
      out.push(this._mkCallSite(tagNode.text, 'free', node, callerCtx));
      return;
    }

    if (tagNode.type === 'member_expression') {
      this._handleMemberCall(tagNode, node, callerCtx, out);
      return;
    }
  }

  /**
   * 构造单个 CallSite 记录（6 字段，C-8 修复：不接受 dynamicReason / viaNew 参数）。
   * 字段：calleeName / calleeKind / line / column / callerContext / calleeQualifier
   */
  private _mkCallSite(
    calleeName: string,
    calleeKind: CalleeKind,
    callNode: Parser.SyntaxNode,
    callerContext: string | undefined,
    calleeQualifier?: string,
  ): CallSite {
    const cs: CallSite = {
      calleeName,
      calleeKind,
      line: callNode.startPosition.row + 1,
    };
    if (callNode.startPosition.column !== undefined) {
      cs.column = callNode.startPosition.column;
    }
    if (callerContext !== undefined) cs.callerContext = callerContext;
    if (calleeQualifier !== undefined) cs.calleeQualifier = calleeQualifier;
    return cs;
  }
}
