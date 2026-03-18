/**
 * Python 语言的 tree-sitter AST → CodeSkeleton 映射器
 * 直接遍历 AST 节点，不使用 .scm 查询文件
 */
import type Parser from 'web-tree-sitter';
import type {
  ExportSymbol,
  ImportReference,
  ParseError,
  MemberInfo,
  MemberKind,
  Language,
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

/** 判断是否为 `_` 开头的私有名称 */
function isPrivateName(name: string): boolean {
  return name.startsWith('_');
}

/** 获取 decorated_definition 内层的实际定义节点 */
function unwrapDecorated(node: Parser.SyntaxNode): Parser.SyntaxNode {
  if (node.type === 'decorated_definition') {
    // 最后一个非 decorator 子节点就是实际定义
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child && child.type !== 'decorator') {
        return child;
      }
    }
  }
  return node;
}

/** 收集节点上的 decorator 名称列表 */
function getDecorators(node: Parser.SyntaxNode): string[] {
  const decorators: string[] = [];
  if (node.type !== 'decorated_definition') return decorators;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'decorator') {
      // decorator 文本形如 @staticmethod、@property 等
      const text = child.text.replace(/^@/, '').trim();
      // 取最简名称（忽略括号和参数）
      const parenIdx = text.indexOf('(');
      decorators.push(parenIdx > 0 ? text.slice(0, parenIdx) : text);
    }
  }
  return decorators;
}

/** 提取函数参数签名文本 */
function extractParamSignature(node: Parser.SyntaxNode): string {
  const params = node.childForFieldName('parameters');
  return params ? params.text : '()';
}

/** 提取函数返回类型注解 */
function extractReturnType(node: Parser.SyntaxNode): string | undefined {
  const returnType = node.childForFieldName('return_type');
  if (!returnType) return undefined;
  // return_type 节点的文本可能包含 `-> ` 前缀，也可能是 type 子节点
  const text = returnType.text;
  return text.startsWith('->') ? text.slice(2).trim() : text;
}

/** 判断函数是否为 async def */
function isAsyncDef(node: Parser.SyntaxNode): boolean {
  // async def 时，节点内第一个子节点可能是 'async' 关键字
  // 或者源码中以 async 开头
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'async') return true;
    // 跳过非 keyword 的前缀
    if (child?.type !== 'comment') break;
  }
  return node.text.trimStart().startsWith('async ');
}

/** 提取 class 的基类列表 */
function extractBases(node: Parser.SyntaxNode): string[] {
  const bases: string[] = [];
  const argList = node.childForFieldName('superclasses');
  if (!argList) return bases;
  for (let i = 0; i < argList.childCount; i++) {
    const child = argList.child(i);
    if (child && child.type !== '(' && child.type !== ')' && child.type !== ',') {
      bases.push(child.text);
    }
  }
  return bases;
}

// ============================================================
// __all__ 解析
// ============================================================

/** 解析 __all__ 列表，返回 null 表示没有 __all__，返回 Set 表示有 */
function parseAllList(rootNode: Parser.SyntaxNode): Set<string> | null {
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (!child) continue;

    // 匹配 __all__ = [...]
    if (child.type === 'expression_statement') {
      const expr = child.child(0);
      if (expr?.type === 'assignment') {
        const left = expr.childForFieldName('left');
        const right = expr.childForFieldName('right');
        if (left?.text === '__all__' && right?.type === 'list') {
          const names = new Set<string>();
          for (let j = 0; j < right.childCount; j++) {
            const elem = right.child(j);
            if (elem?.type === 'string') {
              // 去掉引号
              const raw = elem.text;
              const unquoted = raw.replace(/^['"]|['"]$/g, '');
              if (unquoted) names.add(unquoted);
            }
          }
          return names;
        }
      }
    }
  }
  return null;
}

// ============================================================
// PythonMapper
// ============================================================

export class PythonMapper implements QueryMapper {
  readonly language: Language = 'python';

  /**
   * 从 AST tree 提取导出符号
   * 顶层 def/class 默认为导出；`_` 前缀在 includePrivate: false 时排除
   * 若存在 __all__，只导出 __all__ 中列出的名字
   */
  extractExports(
    tree: Parser.Tree,
    _source: string,
    options: MapperOptions = {},
  ): ExportSymbol[] {
    const rootNode = tree.rootNode;
    if (rootNode.childCount === 0) return [];

    const includePrivate = options.includePrivate ?? false;
    const allList = parseAllList(rootNode);
    const exports: ExportSymbol[] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const rawNode = rootNode.child(i);
      if (!rawNode) continue;

      // 解包 decorated_definition
      const node = unwrapDecorated(rawNode);
      const decorators = getDecorators(rawNode);

      if (node.type === 'function_definition') {
        const symbol = this._extractFunction(node, rawNode, decorators, includePrivate, allList);
        if (symbol) exports.push(symbol);
      } else if (node.type === 'class_definition') {
        const symbol = this._extractClass(node, rawNode, decorators, includePrivate, allList);
        if (symbol) exports.push(symbol);
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
      if (!node) continue;

      if (node.type === 'import_statement') {
        // import os / import os, sys
        const refs = this._extractImportStatement(node);
        imports.push(...refs);
      } else if (node.type === 'import_from_statement') {
        // from os.path import join
        const ref = this._extractImportFromStatement(node);
        if (ref) imports.push(ref);
      }
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

  /** 提取顶层函数定义 */
  private _extractFunction(
    node: Parser.SyntaxNode,
    wrapperNode: Parser.SyntaxNode,
    _decorators: string[],
    includePrivate: boolean,
    allList: Set<string> | null,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name');
    if (!name) return null;

    // 可见性过滤
    if (!includePrivate && isPrivateName(name)) return null;
    if (allList !== null && !allList.has(name)) return null;

    const asyncPrefix = isAsyncDef(node) ? 'async ' : '';
    const params = extractParamSignature(node);
    const returnType = extractReturnType(node);
    const returnSuffix = returnType ? ` -> ${returnType}` : '';
    const signature = `${asyncPrefix}def ${name}${params}${returnSuffix}`;

    return {
      name,
      kind: 'function',
      signature,
      jsDoc: null,
      isDefault: false,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
    };
  }

  /** 提取类定义 */
  private _extractClass(
    node: Parser.SyntaxNode,
    wrapperNode: Parser.SyntaxNode,
    _decorators: string[],
    includePrivate: boolean,
    allList: Set<string> | null,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name');
    if (!name) return null;

    // 可见性过滤
    if (!includePrivate && isPrivateName(name)) return null;
    if (allList !== null && !allList.has(name)) return null;

    // 基类
    const bases = extractBases(node);
    const baseSuffix = bases.length > 0 ? `(${bases.join(', ')})` : '';
    const signature = `class ${name}${baseSuffix}`;

    // 提取成员方法
    const members = this._extractClassMembers(node, includePrivate);

    return {
      name,
      kind: 'class',
      signature,
      jsDoc: null,
      isDefault: false,
      startLine: wrapperNode.startPosition.row + 1,
      endLine: wrapperNode.endPosition.row + 1,
      members: members.length > 0 ? members : undefined,
    };
  }

  /** 提取类成员（方法） */
  private _extractClassMembers(
    classNode: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo[] {
    const members: MemberInfo[] = [];
    const body = classNode.childForFieldName('body');
    if (!body) return members;

    for (let i = 0; i < body.childCount; i++) {
      const rawChild = body.child(i);
      if (!rawChild) continue;

      const child = unwrapDecorated(rawChild);
      const decorators = getDecorators(rawChild);

      if (child.type === 'function_definition') {
        const methodName = fieldText(child, 'name');
        if (!methodName) continue;

        // 私有方法过滤
        if (!includePrivate && isPrivateName(methodName) && methodName !== '__init__') continue;

        // 判断方法类型
        let kind: MemberKind = 'method';
        let isStatic = false;

        if (decorators.includes('staticmethod')) {
          kind = 'staticmethod';
          isStatic = true;
        } else if (decorators.includes('classmethod')) {
          kind = 'classmethod';
        } else if (decorators.includes('property')) {
          kind = 'getter';
        }

        const asyncPrefix = isAsyncDef(child) ? 'async ' : '';
        const params = extractParamSignature(child);
        const returnType = extractReturnType(child);
        const returnSuffix = returnType ? ` -> ${returnType}` : '';
        const signature = `${asyncPrefix}def ${methodName}${params}${returnSuffix}`;

        members.push({
          name: methodName,
          kind,
          signature,
          jsDoc: null,
          visibility: undefined,
          isStatic,
        });
      }
    }

    return members;
  }

  // ============================================================
  // 内部方法 — 导入提取
  // ============================================================

  /** 处理 import os / import os, sys */
  private _extractImportStatement(node: Parser.SyntaxNode): ImportReference[] {
    const refs: ImportReference[] = [];
    // import_statement 的子节点为 dotted_name
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && (child.type === 'dotted_name' || child.type === 'aliased_import')) {
        const modName = child.type === 'aliased_import'
          ? child.childForFieldName('name')?.text ?? child.text
          : child.text;
        if (modName && modName !== 'import') {
          refs.push({
            moduleSpecifier: modName,
            isRelative: false,
            resolvedPath: null,
            isTypeOnly: false,
          });
        }
      }
    }
    return refs;
  }

  /** 处理 from os.path import join */
  private _extractImportFromStatement(node: Parser.SyntaxNode): ImportReference | null {
    // 提取模块名
    const moduleName = node.childForFieldName('module_name');
    let moduleSpecifier = moduleName?.text ?? '';

    // 判断相对导入：from . import / from .foo import
    let isRelative = false;
    // 检查是否有 relative_import 或以 . 开头
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'relative_import') {
        moduleSpecifier = child.text;
        isRelative = true;
        break;
      }
    }

    // 如果没找到 relative_import，检查文本
    if (!isRelative && moduleSpecifier.startsWith('.')) {
      isRelative = true;
    }

    if (!moduleSpecifier) return null;

    // 提取 named imports
    const namedImports: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === 'dotted_name' && child !== moduleName) {
        namedImports.push(child.text);
      } else if (child.type === 'aliased_import') {
        const importName = child.childForFieldName('name')?.text ?? child.text;
        namedImports.push(importName);
      }
    }

    // 如果找不到命名导入，尝试 wildcard_import
    let hasWildcard = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'wildcard_import') {
        hasWildcard = true;
        break;
      }
    }

    return {
      moduleSpecifier,
      isRelative,
      resolvedPath: null,
      namedImports: namedImports.length > 0 ? namedImports : (hasWildcard ? ['*'] : undefined),
      isTypeOnly: false,
    };
  }

  // ============================================================
  // 内部方法 — 错误收集
  // ============================================================

  /** 递归收集 AST 中的 ERROR 节点 */
  private _collectErrors(node: Parser.SyntaxNode, errors: ParseError[]): void {
    if (node.type === 'ERROR') {
      errors.push({
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        message: `语法错误: 无法解析的节点 "${node.text.slice(0, 100)}"`,
      });
      return; // ERROR 节点内部不再递归
    }

    if (node.isMissing) {
      errors.push({
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        message: `语法错误: 缺少预期的 "${node.type}"`,
      });
      return;
    }

    // 仅在子树含错误时递归，减少遍历开销
    if (node.hasError) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          this._collectErrors(child, errors);
        }
      }
    }
  }
}
