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
import type { QueryMapper, MapperOptions } from './base-mapper.js';

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
}
