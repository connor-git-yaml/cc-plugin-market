/**
 * Go 语言的 tree-sitter AST → CodeSkeleton 映射器
 * 直接遍历 AST 节点，不使用 .scm 查询文件
 */
import type Parser from 'web-tree-sitter';
import type {
  ExportSymbol,
  ExportKind,
  ImportReference,
  ParseError,
  MemberInfo,
  Language,
  Visibility,
} from '../../models/code-skeleton.js';
import type { CallSite, CalleeKind } from '../../models/call-site.js';
import type { QueryMapper, MapperOptions } from './base-mapper.js';

// ============================================================
// Feature 153 — extractCallSites 常量
// ============================================================

/** 大文件阈值 — 与 PythonMapper.CALLSITES_MAX_FILE_BYTES 一致；超过此尺寸跳过 callSites 抽取 */
const CALLSITES_MAX_FILE_BYTES = 1_000_000;

/** 反射类调用 receiver 集合（与 scripts/lib/go-call-extractor.mjs `GO_REFLECTION_RECEIVERS` 一致） */
const GO_REFLECTION_RECEIVERS = new Set(['reflect', 'unsafe']);

// ============================================================
// 辅助工具
// ============================================================

/** 获取节点的命名字段文本 */
function fieldText(node: Parser.SyntaxNode, fieldName: string): string | undefined {
  const child = node.childForFieldName(fieldName);
  return child?.text;
}

/** Go 的可见性: 首字母大写 = public，否则 private */
function goVisibility(name: string): Visibility {
  if (name.length === 0) return 'private';
  const first = name.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase() ? 'public' : 'private';
}

/** 判断标识符是否为导出的（首字母大写） */
function isExported(name: string): boolean {
  return goVisibility(name) === 'public';
}

/** 提取参数列表文本 */
function extractParamList(node: Parser.SyntaxNode): string {
  const params = node.childForFieldName('parameters');
  return params ? params.text : '()';
}

/** 提取函数返回值类型 */
function extractResult(node: Parser.SyntaxNode): string {
  const result = node.childForFieldName('result');
  return result ? result.text : '';
}

/** 提取 receiver（方法声明的接收者） */
function extractReceiver(node: Parser.SyntaxNode): { text: string; typeName: string } | undefined {
  // method_declaration 的 receiver field
  const receiver = node.childForFieldName('receiver');
  if (!receiver) return undefined;

  // receiver 是 parameter_list，如 (s *Server)
  // 提取类型名：去掉指针 * 和变量名
  const text = receiver.text;
  // 遍历 receiver 的子节点找到类型
  let typeName = '';
  for (let i = 0; i < receiver.childCount; i++) {
    const child = receiver.child(i);
    if (child?.type === 'parameter_declaration') {
      const typeNode = child.childForFieldName('type');
      if (typeNode) {
        // 可能是 *Server 或 Server
        typeName = typeNode.text.replace(/^\*/, '');
      }
    }
  }

  return { text, typeName };
}

// ============================================================
// GoMapper
// ============================================================

export class GoMapper implements QueryMapper {
  readonly language: Language = 'go';

  /**
   * 从 AST tree 提取导出符号
   * 首字母大写 = public，includePrivate: false 时只返回大写开头的
   */
  extractExports(
    tree: Parser.Tree,
    _source: string,
    options: MapperOptions = {},
  ): ExportSymbol[] {
    const rootNode = tree.rootNode;
    if (rootNode.childCount === 0) return [];

    const includePrivate = options.includePrivate ?? false;
    const exports: ExportSymbol[] = [];

    // 第一遍：收集 struct/interface 的符号，方便后续关联 method
    const structMap = new Map<string, ExportSymbol>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case 'function_declaration': {
          const symbol = this._extractFunction(node, includePrivate);
          if (symbol) exports.push(symbol);
          break;
        }
        case 'method_declaration': {
          // 延后处理，先收集所有 type 定义
          break;
        }
        case 'type_declaration': {
          const symbols = this._extractTypeDeclaration(node, includePrivate);
          for (const sym of symbols) {
            exports.push(sym);
            if (sym.kind === 'struct' || sym.kind === 'interface') {
              structMap.set(sym.name, sym);
            }
          }
          break;
        }
        case 'const_declaration': {
          const symbols = this._extractVarOrConst(node, 'const', includePrivate);
          exports.push(...symbols);
          break;
        }
        case 'var_declaration': {
          const symbols = this._extractVarOrConst(node, 'variable', includePrivate);
          exports.push(...symbols);
          break;
        }
        case 'import_declaration':
          // 导入在 extractImports 中处理
          break;
        default:
          break;
      }
    }

    // 第二遍：处理 method_declaration，关联到 receiver struct
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node || node.type !== 'method_declaration') continue;

      const methodMember = this._extractMethod(node, includePrivate);
      if (!methodMember) continue;

      const receiver = extractReceiver(node);
      if (receiver) {
        const structSymbol = structMap.get(receiver.typeName);
        if (structSymbol) {
          if (!structSymbol.members) {
            structSymbol.members = [];
          }
          structSymbol.members.push(methodMember.member);
          continue;
        }
      }

      // 如果找不到对应 struct，作为独立函数导出
      exports.push(methodMember.asSymbol);
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
      if (!node || node.type !== 'import_declaration') continue;

      const refs = this._extractImportDeclaration(node);
      imports.push(...refs);
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
  // 内部方法 — 函数/方法提取
  // ============================================================

  /** 提取顶层函数声明 */
  private _extractFunction(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name');
    if (!name) return null;
    if (!includePrivate && !isExported(name)) return null;

    const params = extractParamList(node);
    const result = extractResult(node);
    const resultSuffix = result ? ` ${result}` : '';
    const signature = `func ${name}${params}${resultSuffix}`;

    return {
      name,
      kind: 'function',
      signature,
      jsDoc: null,
      isDefault: false,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /** 提取 method_declaration */
  private _extractMethod(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): { member: MemberInfo; asSymbol: ExportSymbol } | null {
    const name = fieldText(node, 'name');
    if (!name) return null;
    if (!includePrivate && !isExported(name)) return null;

    const receiver = extractReceiver(node);
    const receiverText = receiver ? receiver.text + ' ' : '';
    const params = extractParamList(node);
    const result = extractResult(node);
    const resultSuffix = result ? ` ${result}` : '';
    const signature = `func ${receiverText}${name}${params}${resultSuffix}`;

    const member: MemberInfo = {
      name,
      kind: 'method',
      signature,
      jsDoc: null,
      visibility: goVisibility(name),
      isStatic: false,
    };

    const asSymbol: ExportSymbol = {
      name,
      kind: 'function',
      signature,
      jsDoc: null,
      isDefault: false,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };

    return { member, asSymbol };
  }

  // ============================================================
  // 内部方法 — type 声明提取
  // ============================================================

  /** 提取 type_declaration（可能包含多个 type_spec） */
  private _extractTypeDeclaration(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): ExportSymbol[] {
    const symbols: ExportSymbol[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === 'type_spec') {
        const symbol = this._extractTypeSpec(child, includePrivate);
        if (symbol) symbols.push(symbol);
      } else if (child.type === 'type_spec_list') {
        // 分组 type ( ... )
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec?.type === 'type_spec') {
            const symbol = this._extractTypeSpec(spec, includePrivate);
            if (symbol) symbols.push(symbol);
          }
        }
      }
    }

    return symbols;
  }

  /** 提取单个 type_spec */
  private _extractTypeSpec(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name');
    if (!name) return null;
    if (!includePrivate && !isExported(name)) return null;

    const typeNode = node.childForFieldName('type');
    if (!typeNode) return null;

    let kind: ExportKind;
    let members: MemberInfo[] | undefined;

    switch (typeNode.type) {
      case 'struct_type': {
        kind = 'struct';
        members = this._extractStructFields(typeNode, includePrivate);
        break;
      }
      case 'interface_type': {
        kind = 'interface';
        members = this._extractInterfaceMethods(typeNode, includePrivate);
        break;
      }
      default: {
        // type alias 或 type definition
        kind = 'type';
        break;
      }
    }

    const signature = `type ${name} ${typeNode.type === 'struct_type' ? 'struct' : typeNode.type === 'interface_type' ? 'interface' : typeNode.text}`;

    return {
      name,
      kind,
      signature,
      jsDoc: null,
      isDefault: false,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      members: members && members.length > 0 ? members : undefined,
    };
  }

  /** 提取 struct 的字段 */
  private _extractStructFields(
    structNode: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo[] {
    const members: MemberInfo[] = [];
    const fieldList = structNode.childForFieldName('body') ?? structNode;

    for (let i = 0; i < fieldList.childCount; i++) {
      const child = fieldList.child(i);
      if (!child) continue;

      if (child.type === 'field_declaration' || child.type === 'field_declaration_list') {
        const fieldName = fieldText(child, 'name');
        const fieldType = fieldText(child, 'type');

        if (fieldName) {
          if (!includePrivate && !isExported(fieldName)) continue;

          members.push({
            name: fieldName,
            kind: 'property',
            signature: fieldType ? `${fieldName} ${fieldType}` : fieldName,
            jsDoc: null,
            visibility: goVisibility(fieldName),
            isStatic: false,
          });
        }
      }
    }

    return members;
  }

  /** 提取 interface 的方法签名 */
  private _extractInterfaceMethods(
    ifaceNode: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo[] {
    const members: MemberInfo[] = [];

    for (let i = 0; i < ifaceNode.childCount; i++) {
      const child = ifaceNode.child(i);
      if (!child) continue;

      if (child.type === 'method_spec') {
        const methodName = fieldText(child, 'name');
        if (!methodName) continue;
        if (!includePrivate && !isExported(methodName)) continue;

        const params = child.childForFieldName('parameters')?.text ?? '()';
        const result = child.childForFieldName('result')?.text ?? '';
        const resultSuffix = result ? ` ${result}` : '';

        members.push({
          name: methodName,
          kind: 'method',
          signature: `${methodName}${params}${resultSuffix}`,
          jsDoc: null,
          visibility: goVisibility(methodName),
          isStatic: false,
        });
      }
    }

    return members;
  }

  // ============================================================
  // 内部方法 — const/var 提取
  // ============================================================

  /** 提取 const_declaration 或 var_declaration */
  private _extractVarOrConst(
    node: Parser.SyntaxNode,
    kind: 'const' | 'variable',
    includePrivate: boolean,
  ): ExportSymbol[] {
    const symbols: ExportSymbol[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === 'const_spec' || child.type === 'var_spec') {
        const specSymbols = this._extractSpec(child, kind, includePrivate);
        symbols.push(...specSymbols);
      }
    }

    return symbols;
  }

  /** 提取单个 const_spec / var_spec */
  private _extractSpec(
    node: Parser.SyntaxNode,
    kind: 'const' | 'variable',
    includePrivate: boolean,
  ): ExportSymbol[] {
    const symbols: ExportSymbol[] = [];
    const name = fieldText(node, 'name');

    if (name) {
      if (!includePrivate && !isExported(name)) return symbols;
      const typeNode = node.childForFieldName('type');
      const typeSuffix = typeNode ? ` ${typeNode.text}` : '';
      const keyword = kind === 'const' ? 'const' : 'var';
      const signature = `${keyword} ${name}${typeSuffix}`;

      symbols.push({
        name,
        kind,
        signature,
        jsDoc: null,
        isDefault: false,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }

    return symbols;
  }

  // ============================================================
  // 内部方法 — 导入提取
  // ============================================================

  /** 提取 import_declaration */
  private _extractImportDeclaration(node: Parser.SyntaxNode): ImportReference[] {
    const refs: ImportReference[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === 'import_spec') {
        const ref = this._extractImportSpec(child);
        if (ref) refs.push(ref);
      } else if (child.type === 'import_spec_list') {
        // 分组 import ( ... )
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec?.type === 'import_spec') {
            const ref = this._extractImportSpec(spec);
            if (ref) refs.push(ref);
          }
        }
      } else if (child.type === 'interpreted_string_literal') {
        // 单行 import "fmt"
        const path = child.text.replace(/^"|"$/g, '');
        if (path) {
          refs.push({
            moduleSpecifier: path,
            isRelative: false,
            resolvedPath: null,
            isTypeOnly: false,
          });
        }
      }
    }

    return refs;
  }

  /** 提取单个 import_spec */
  private _extractImportSpec(node: Parser.SyntaxNode): ImportReference | null {
    // import_spec 可能有 alias（name field）和 path
    const pathNode = node.childForFieldName('path');
    if (!pathNode) {
      // 尝试直接取 interpreted_string_literal
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'interpreted_string_literal') {
          const path = child.text.replace(/^"|"$/g, '');
          if (path) {
            return {
              moduleSpecifier: path,
              isRelative: false,
              resolvedPath: null,
              isTypeOnly: false,
            };
          }
        }
      }
      return null;
    }

    const path = pathNode.text.replace(/^"|"$/g, '');
    if (!path) return null;

    return {
      moduleSpecifier: path,
      isRelative: false,
      resolvedPath: null,
      isTypeOnly: false,
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
  // Feature 153 — extractCallSites（FR-1 ~ FR-7 实现）
  // ============================================================

  /**
   * 抽取 Go 函数调用点。
   *
   * 行为对齐：
   * - scripts/lib/go-call-extractor.mjs 的 _classifyCallExpression / _scanImports / _resolveGoCaller
   * - call-resolver 4-stage 决策表（spec.md FR-2 表格 11 行 short-circuit）
   *
   * Size guard：source.length > 1MB 时返回 []（与 PythonMapper.extractCallSites 一致）。
   */
  extractCallSites(tree: Parser.Tree, source: string): CallSite[] {
    if (source.length > CALLSITES_MAX_FILE_BYTES) {
      return [];
    }
    const root = tree.rootNode;
    const importAliases = this._scanImports(root);
    const callSites: CallSite[] = [];
    const ctxStack: string[] = [];
    const recvVarStack: (string | null)[] = [];
    this._walkCallSites(root, ctxStack, recvVarStack, importAliases, callSites);
    return callSites;
  }

  /**
   * FR-5: 扫描 source_file → import_declaration → import_spec 收集 alias 集合。
   *
   * 与 go-call-extractor.mjs `_scanImports` 行为完全一致：
   * - 自定义 alias `import f "fmt"` → 记 alias `f`
   * - 标准 import `import "fmt"` → 记 path 末段 `fmt`
   * - dot import (name=dot) / blank import (name=blank_identifier) → skip（不入集合）
   */
  private _scanImports(root: Parser.SyntaxNode): Set<string> {
    const aliases = new Set<string>();
    for (let i = 0; i < root.namedChildCount; i++) {
      const child = root.namedChild(i);
      if (!child || child.type !== 'import_declaration') continue;
      // import_spec 直接挂在 import_declaration 下，或挂在 import_spec_list 下
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j);
        if (!spec) continue;
        if (spec.type === 'import_spec') {
          const alias = this._extractAliasFromImportSpec(spec);
          if (alias) aliases.add(alias);
        } else if (spec.type === 'import_spec_list') {
          for (let k = 0; k < spec.namedChildCount; k++) {
            const inner = spec.namedChild(k);
            if (inner?.type === 'import_spec') {
              const alias = this._extractAliasFromImportSpec(inner);
              if (alias) aliases.add(alias);
            }
          }
        }
      }
    }
    return aliases;
  }

  /** FR-5 辅助：从 import_spec 提取 alias 名（dot/blank 返回 null）。 */
  private _extractAliasFromImportSpec(spec: Parser.SyntaxNode): string | null {
    const nameNode = spec.childForFieldName('name');
    if (nameNode) {
      if (nameNode.type === 'dot' || nameNode.type === 'blank_identifier') {
        return null;
      }
      if (nameNode.type === 'package_identifier' && typeof nameNode.text === 'string') {
        return nameNode.text;
      }
    }
    // 无 name → 用 path 末段
    const pathNode = spec.childForFieldName('path');
    if (!pathNode || pathNode.type !== 'interpreted_string_literal') return null;
    const raw = pathNode.text.replace(/^["']|["']$/g, '');
    if (!raw) return null;
    const lastSlash = raw.lastIndexOf('/');
    return lastSlash === -1 ? raw : raw.slice(lastSlash + 1);
  }

  /**
   * FR-7: 从 method_declaration 的 receiver 字段递归提取 type 名。
   *
   * 支持形态：值 receiver / 指针 / 嵌套指针 / 泛型 / 泛型指针 / qualified type，
   * 与 go-call-extractor.mjs `_extractReceiverTypeName` + `_extractTypeNameRecursive` 行为一致。
   */
  private _extractReceiverTypeName(methodDecl: Parser.SyntaxNode): string | null {
    const receiverField = methodDecl.childForFieldName('receiver');
    if (!receiverField || receiverField.type !== 'parameter_list') return null;
    for (let i = 0; i < receiverField.namedChildCount; i++) {
      const param = receiverField.namedChild(i);
      if (!param || param.type !== 'parameter_declaration') continue;
      for (let j = 0; j < param.namedChildCount; j++) {
        const child = param.namedChild(j);
        if (!child) continue;
        if (child.type === 'identifier') continue; // receiver 名字（var name）
        const typeName = this._extractTypeNameRecursive(child);
        if (typeName) return typeName;
      }
    }
    return null;
  }

  /** 递归从 type 节点中提取末段 type_identifier 名（值 type / pointer / generic / qualified）。 */
  private _extractTypeNameRecursive(node: Parser.SyntaxNode | null): string | null {
    if (!node) return null;
    if (node.type === 'type_identifier' && typeof node.text === 'string') {
      return node.text;
    }
    if (node.type === 'pointer_type') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const inner = this._extractTypeNameRecursive(node.namedChild(i));
        if (inner) return inner;
      }
      return null;
    }
    if (node.type === 'generic_type') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const inner = node.namedChild(i);
        if (inner && (inner.type === 'type_identifier' || inner.type === 'qualified_type')) {
          return this._extractTypeNameRecursive(inner);
        }
      }
      return null;
    }
    if (node.type === 'qualified_type') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const inner = node.namedChild(i);
        if (inner?.type === 'type_identifier' && typeof inner.text === 'string') {
          return inner.text;
        }
      }
      return null;
    }
    return null;
  }

  /** FR-7: 从 method_declaration receiver 提取 var name（identifier 子节点；可能为 null）。 */
  private _extractReceiverVarName(methodDecl: Parser.SyntaxNode): string | null {
    const receiverField = methodDecl.childForFieldName('receiver');
    if (!receiverField || receiverField.type !== 'parameter_list') return null;
    for (let i = 0; i < receiverField.namedChildCount; i++) {
      const param = receiverField.namedChild(i);
      if (!param || param.type !== 'parameter_declaration') continue;
      for (let j = 0; j < param.namedChildCount; j++) {
        const child = param.namedChild(j);
        if (child?.type === 'identifier' && typeof child.text === 'string') {
          return child.text;
        }
      }
    }
    return null;
  }

  /**
   * FR-1, FR-7: 递归遍历 AST，对 call_expression 产 CallSite。
   *
   * 栈协议（try/finally 配对）：
   * - 进入 method_declaration → push `Type.method` + receiver var
   * - 进入 function_declaration → push `funcName` + null
   * - 进入 func_literal → push `<closure:line:col>` + null
   * - 离开时 pop（finally 块保证）
   */
  private _walkCallSites(
    node: Parser.SyntaxNode,
    ctxStack: string[],
    recvVarStack: (string | null)[],
    importAliases: ReadonlySet<string>,
    out: CallSite[],
  ): void {
    // ERROR / MISSING 节点：跳过子树（与 extractor 行为一致）
    if (node.type === 'ERROR' || node.type === 'MISSING') return;

    let pushed = false;
    if (node.type === 'method_declaration') {
      const typeName = this._extractReceiverTypeName(node) ?? '<anon-method>';
      const nameNode = node.childForFieldName('name');
      const methodName = nameNode?.text ?? '<anon-method>';
      const recvVar = this._extractReceiverVarName(node);
      ctxStack.push(`${typeName}.${methodName}`);
      recvVarStack.push(recvVar);
      pushed = true;
    } else if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      const fnName = nameNode?.text ?? '<anon-func>';
      ctxStack.push(fnName);
      recvVarStack.push(null);
      pushed = true;
    } else if (node.type === 'func_literal') {
      const line = node.startPosition.row + 1;
      const col = node.startPosition.column;
      ctxStack.push(`<closure:${line}:${col}>`);
      recvVarStack.push(null);
      pushed = true;
    }

    try {
      if (node.type === 'call_expression') {
        const callerCtx = ctxStack.length > 0 ? ctxStack[ctxStack.length - 1] : undefined;
        const recvVar =
          recvVarStack.length > 0
            ? recvVarStack[recvVarStack.length - 1] ?? null
            : null;
        this._handleCall(node, callerCtx, recvVar, importAliases, out);
      }
      // 递归 children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) this._walkCallSites(child, ctxStack, recvVarStack, importAliases, out);
      }
    } finally {
      if (pushed) {
        ctxStack.pop();
        recvVarStack.pop();
      }
    }
  }

  /**
   * FR-1, FR-2 (11 行分类表), FR-6: 处理单个 call_expression 节点。
   *
   * 路由顺序按 spec.md FR-2 表格行 #1 → #11 short-circuit 匹配，先匹配的形态先返回。
   */
  private _handleCall(
    node: Parser.SyntaxNode,
    callerContext: string | undefined,
    receiverVarName: string | null,
    importAliases: ReadonlySet<string>,
    out: CallSite[],
  ): void {
    // FR-6: phantom call 防御
    if (this._isPhantomCall(node)) return;

    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // 行 #1: identifier callee → free
    if (funcNode.type === 'identifier') {
      out.push(this._mkCallSite(funcNode.text, 'free', line, column, callerContext));
      return;
    }

    // 行 #2: func_literal callee (IIFE) → free + <anon-func>
    if (funcNode.type === 'func_literal') {
      out.push(this._mkCallSite('<anon-func>', 'free', line, column, callerContext));
      return;
    }

    // 行 #3, #4: parenthesized_expression（类型转换）
    if (funcNode.type === 'parenthesized_expression') {
      const cls = this._classifyParenthesized(funcNode);
      out.push(
        this._mkCallSite(
          cls.calleeName,
          cls.calleeKind,
          line,
          column,
          callerContext,
          cls.calleeQualifier,
        ),
      );
      return;
    }

    // 行 #5 ~ #9: selector_expression
    if (funcNode.type === 'selector_expression') {
      const operandNode = funcNode.childForFieldName('operand');
      const fieldNode = funcNode.childForFieldName('field');
      if (!fieldNode) return;
      const calleeName = fieldNode.text;

      // 行 #5: reflect/unsafe → unresolved
      if (
        operandNode?.type === 'identifier' &&
        GO_REFLECTION_RECEIVERS.has(operandNode.text)
      ) {
        out.push(this._mkCallSite(calleeName, 'unresolved', line, column, callerContext));
        return;
      }

      // 行 #6: import alias → cross-module
      if (operandNode?.type === 'identifier' && importAliases.has(operandNode.text)) {
        out.push(
          this._mkCallSite(
            calleeName,
            'cross-module',
            line,
            column,
            callerContext,
            operandNode.text,
          ),
        );
        return;
      }

      // 行 #7: receiver var match → member + qualifier=undefined（让 resolver 用 callerContext）
      if (
        operandNode?.type === 'identifier' &&
        receiverVarName !== null &&
        operandNode.text === receiverVarName
      ) {
        out.push(this._mkCallSite(calleeName, 'member', line, column, callerContext));
        return;
      }

      // 行 #8: 其它 identifier operand（非 alias 非 receiver var）→ free
      if (operandNode?.type === 'identifier') {
        out.push(this._mkCallSite(calleeName, 'free', line, column, callerContext));
        return;
      }

      // 行 #9: 非 identifier operand（嵌套 selector / call / type_assertion）→ free
      out.push(this._mkCallSite(calleeName, 'free', line, column, callerContext));
      return;
    }

    // 行 #10: index_expression(operand=identifier X, index=type_arguments) → free + name=X
    // 实测注解：tree-sitter-go 把 `MakeMap[T]()` 解析为 call_expression(function=identifier
    // "MakeMap", type_arguments=...) 直接进入行 #1；行 #10 作为兜底处理罕见 generic 形态。
    if (funcNode.type === 'index_expression') {
      const operandNode = funcNode.childForFieldName('operand');
      const indexNode = funcNode.childForFieldName('index');
      if (
        operandNode?.type === 'identifier' &&
        (indexNode?.type === 'type_arguments' || indexNode?.type === 'type_argument_list')
      ) {
        out.push(
          this._mkCallSite(operandNode.text, 'free', line, column, callerContext),
        );
        return;
      }
      // 内层 operand 非 identifier → 行 #11
    }

    // 行 #11 fallback: unresolved + 截断 funcNode.text ≤ 60 字符
    const rawText = typeof funcNode.text === 'string' ? funcNode.text : '<unknown>';
    const safeName = rawText.length <= 60 ? rawText : '<unknown>';
    out.push(this._mkCallSite(safeName, 'unresolved', line, column, callerContext));
  }

  /**
   * FR-2 行 #3, #4: 解开 parenthesized_expression 的 callee。
   *
   * 实测形态（与 go-call-extractor.mjs `_classifyCallExpression` 行 1.6 节段一致）：
   * - `(T)(nil)` → parenthesized(identifier "T") → free + "T"
   * - `(*T)(nil)` → parenthesized(unary_expression("*", identifier "T")) → free + "T"
   * - `(*pkg.T)(nil)` → parenthesized(unary_expression("*", selector(pkg, T))) → cross-module + "T" + qualifier "pkg"
   */
  private _classifyParenthesized(parenNode: Parser.SyntaxNode): {
    calleeKind: CalleeKind;
    calleeName: string;
    calleeQualifier?: string;
  } {
    let cursor: Parser.SyntaxNode | null = parenNode;
    while (cursor && cursor.type === 'parenthesized_expression') {
      cursor = cursor.namedChild(0);
    }
    if (!cursor) return { calleeKind: 'unresolved', calleeName: '<paren-callee>' };

    // 解开 unary_expression（*X 形态：表达式上下文中的指针）
    let target: Parser.SyntaxNode = cursor;
    if (cursor.type === 'unary_expression') {
      const operand = cursor.namedChild(0);
      if (operand) target = operand;
    }

    // identifier T → free
    if (target.type === 'identifier' && typeof target.text === 'string') {
      return { calleeKind: 'free', calleeName: target.text };
    }

    // selector_expression(pkg, T) → cross-module + qualifier=pkg
    if (target.type === 'selector_expression') {
      const operandNode = target.childForFieldName('operand');
      const fieldNode = target.childForFieldName('field');
      if (
        operandNode?.type === 'identifier' &&
        typeof operandNode.text === 'string' &&
        fieldNode?.text
      ) {
        return {
          calleeKind: 'cross-module',
          calleeName: fieldNode.text,
          calleeQualifier: operandNode.text,
        };
      }
    }

    // 罕见类型位置（pointer_type / qualified_type / generic_type / type_identifier）
    if (target.type === 'type_identifier' && typeof target.text === 'string') {
      return { calleeKind: 'free', calleeName: target.text };
    }
    if (target.type === 'qualified_type') {
      const innerName = this._extractTypeNameRecursive(target);
      if (innerName) {
        // qualified_type 第一个子节点通常是 package_identifier
        let qualifier: string | undefined;
        for (let i = 0; i < target.namedChildCount; i++) {
          const inner = target.namedChild(i);
          if (inner?.type === 'package_identifier' && typeof inner.text === 'string') {
            qualifier = inner.text;
            break;
          }
        }
        return {
          calleeKind: 'cross-module',
          calleeName: innerName,
          calleeQualifier: qualifier,
        };
      }
    }
    if (target.type === 'pointer_type' || target.type === 'generic_type') {
      const innerName = this._extractTypeNameRecursive(target);
      if (innerName) return { calleeKind: 'free', calleeName: innerName };
    }

    return { calleeKind: 'unresolved', calleeName: '<paren-callee>' };
  }

  /**
   * FR-6: phantom call 检测。
   *
   * - funcNode 缺失 / hasError → phantom（skip 抽取）
   * - sibling 含 ERROR/MISSING → phantom
   * children 仍由 _walkCallSites 递归 walk（不会因 phantom skip 整个子树）。
   */
  private _isPhantomCall(callExpr: Parser.SyntaxNode): boolean {
    const fn = callExpr.childForFieldName('function');
    if (!fn) return true;
    if (fn.hasError === true) return true;
    const parent = callExpr.parent;
    if (parent) {
      for (let i = 0; i < parent.namedChildCount; i++) {
        const sib = parent.namedChild(i);
        if (sib === callExpr || !sib) continue;
        if (sib.type === 'ERROR' || sib.type === 'MISSING') return true;
      }
    }
    return false;
  }

  /** 构造单个 CallSite 记录。 */
  private _mkCallSite(
    calleeName: string,
    calleeKind: CalleeKind,
    line: number,
    column: number,
    callerContext: string | undefined,
    calleeQualifier?: string,
  ): CallSite {
    const cs: CallSite = {
      calleeName,
      calleeKind,
      line,
    };
    if (column !== undefined) cs.column = column;
    if (callerContext !== undefined) cs.callerContext = callerContext;
    if (calleeQualifier !== undefined) cs.calleeQualifier = calleeQualifier;
    return cs;
  }
}
