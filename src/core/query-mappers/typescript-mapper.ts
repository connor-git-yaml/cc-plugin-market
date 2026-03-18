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
import type { QueryMapper, MapperOptions } from './base-mapper.js';

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

    return imports;
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

  /** 提取 export_clause (re-export) */
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
}
