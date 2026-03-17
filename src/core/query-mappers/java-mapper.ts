/**
 * Java 语言的 tree-sitter AST → CodeSkeleton 映射器
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

/** 从 modifiers 节点提取访问修饰符 */
function extractVisibility(node: Parser.SyntaxNode): Visibility | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const mod = child.child(j);
        if (!mod) continue;
        if (mod.text === 'public') return 'public';
        if (mod.text === 'protected') return 'protected';
        if (mod.text === 'private') return 'private';
      }
    }
  }
  return undefined;
}

/** 检查 modifiers 中是否包含指定修饰符 */
function hasModifier(node: Parser.SyntaxNode, modifier: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j)?.text === modifier) return true;
      }
    }
  }
  return false;
}

/** 提取类型参数 */
function extractTypeParameters(node: Parser.SyntaxNode): string[] {
  const typeParams = node.childForFieldName('type_parameters');
  if (!typeParams) return [];

  const params: string[] = [];
  for (let i = 0; i < typeParams.childCount; i++) {
    const child = typeParams.child(i);
    if (child && child.type === 'type_parameter') {
      params.push(child.text);
    }
  }
  return params;
}

/** 提取 superclass 文本 */
function extractSuperclass(node: Parser.SyntaxNode): string | undefined {
  const superclass = node.childForFieldName('superclass');
  return superclass?.text;
}

/** 提取 super_interfaces 列表 */
function extractInterfaces(node: Parser.SyntaxNode): string[] {
  const interfaces: string[] = [];
  const superInterfaces = node.childForFieldName('interfaces');
  if (!superInterfaces) return interfaces;

  // interfaces 节点是 super_interfaces, 子节点为 type_list
  for (let i = 0; i < superInterfaces.childCount; i++) {
    const child = superInterfaces.child(i);
    if (child && child.type === 'type_list') {
      for (let j = 0; j < child.childCount; j++) {
        const typeNode = child.child(j);
        if (typeNode && typeNode.type !== ',') {
          interfaces.push(typeNode.text);
        }
      }
    } else if (child && child.type !== 'implements' && child.type !== ',' && child.type !== 'extends') {
      interfaces.push(child.text);
    }
  }
  return interfaces;
}

/** 提取方法参数列表文本 */
function extractFormalParams(node: Parser.SyntaxNode): string {
  const params = node.childForFieldName('parameters');
  return params ? params.text : '()';
}

/** 提取方法返回类型 */
function extractReturnType(node: Parser.SyntaxNode): string {
  const typeNode = node.childForFieldName('type');
  return typeNode?.text ?? 'void';
}

/** 从 modifiers 提取注解列表 */
function extractAnnotations(node: Parser.SyntaxNode): string[] {
  const annotations: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const mod = child.child(j);
        if (mod?.type === 'marker_annotation' || mod?.type === 'annotation') {
          annotations.push(mod.text);
        }
      }
    }
  }
  return annotations;
}

// ============================================================
// JavaMapper
// ============================================================

export class JavaMapper implements QueryMapper {
  readonly language: Language = 'java';

  /**
   * 从 AST tree 提取导出符号
   * includePrivate: false 时只返回 public 顶层类型
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

    // Java 文件的顶层通常是 program -> class_declaration / interface_declaration 等
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      const symbol = this._extractTopLevelDeclaration(node, includePrivate);
      if (symbol) exports.push(symbol);
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

      const ref = this._extractImportDeclaration(node);
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
  // 内部方法 — 顶层声明提取
  // ============================================================

  /** 提取顶层声明 */
  private _extractTopLevelDeclaration(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): ExportSymbol | null {
    switch (node.type) {
      case 'class_declaration':
        return this._extractClassLike(node, 'class', includePrivate);
      case 'interface_declaration':
        return this._extractClassLike(node, 'interface', includePrivate);
      case 'enum_declaration':
        return this._extractClassLike(node, 'enum', includePrivate);
      case 'record_declaration':
        return this._extractClassLike(node, 'data_class', includePrivate);
      default:
        return null;
    }
  }

  /** 提取 class/interface/enum/record 声明 */
  private _extractClassLike(
    node: Parser.SyntaxNode,
    kind: ExportKind,
    includePrivate: boolean,
  ): ExportSymbol | null {
    const name = fieldText(node, 'name');
    if (!name) return null;

    // 可见性过滤
    const visibility = extractVisibility(node);
    if (!includePrivate && visibility !== undefined && visibility !== 'public') return null;

    // 类型参数
    const typeParameters = extractTypeParameters(node);

    // 构建签名
    let signature = '';
    const isAbstract = hasModifier(node, 'abstract');
    const isStatic = hasModifier(node, 'static');

    const modPrefix = [
      visibility,
      isAbstract ? 'abstract' : undefined,
      isStatic ? 'static' : undefined,
    ].filter(Boolean).join(' ');

    const keyword = kind === 'data_class' ? 'record' : kind;
    const typeParamStr = typeParameters.length > 0 ? `<${typeParameters.join(', ')}>` : '';

    signature = modPrefix ? `${modPrefix} ${keyword} ${name}${typeParamStr}` : `${keyword} ${name}${typeParamStr}`;

    // 继承和实现
    const superclass = extractSuperclass(node);
    if (superclass) {
      signature += ` extends ${superclass}`;
    }
    const interfaces = extractInterfaces(node);
    if (interfaces.length > 0) {
      const implKeyword = kind === 'interface' ? 'extends' : 'implements';
      signature += ` ${implKeyword} ${interfaces.join(', ')}`;
    }

    // 提取成员
    const members = this._extractMembers(node, includePrivate);

    return {
      name,
      kind,
      signature,
      jsDoc: null,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
      isDefault: false,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      members: members.length > 0 ? members : undefined,
    };
  }

  // ============================================================
  // 内部方法 — 成员提取
  // ============================================================

  /** 提取类/接口的成员 */
  private _extractMembers(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo[] {
    const members: MemberInfo[] = [];
    const body = node.childForFieldName('body');
    if (!body) return members;

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case 'method_declaration': {
          const member = this._extractMethodMember(child, includePrivate);
          if (member) members.push(member);
          break;
        }
        case 'field_declaration': {
          const fieldMembers = this._extractFieldMember(child, includePrivate);
          members.push(...fieldMembers);
          break;
        }
        case 'constructor_declaration': {
          const member = this._extractConstructorMember(child, includePrivate);
          if (member) members.push(member);
          break;
        }
        default:
          break;
      }
    }

    return members;
  }

  /** 提取方法成员 */
  private _extractMethodMember(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo | null {
    const name = fieldText(node, 'name');
    if (!name) return null;

    const visibility = extractVisibility(node);
    if (!includePrivate && visibility === 'private') return null;

    const isStatic = hasModifier(node, 'static');
    const isAbstract = hasModifier(node, 'abstract') || undefined;
    const returnType = extractReturnType(node);
    const params = extractFormalParams(node);
    const typeParams = extractTypeParameters(node);
    const typeParamStr = typeParams.length > 0 ? `<${typeParams.join(', ')}> ` : '';
    const staticStr = isStatic ? 'static ' : '';
    const signature = `${staticStr}${typeParamStr}${returnType} ${name}${params}`;

    return {
      name,
      kind: 'method' as MemberKind,
      signature,
      jsDoc: null,
      visibility,
      isStatic,
      isAbstract,
    };
  }

  /** 提取字段成员 */
  private _extractFieldMember(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo[] {
    const members: MemberInfo[] = [];
    const visibility = extractVisibility(node);
    if (!includePrivate && visibility === 'private') return members;

    const isStatic = hasModifier(node, 'static');
    const typeNode = node.childForFieldName('type');
    const typeName = typeNode?.text ?? 'Object';

    // 字段声明可能包含多个 variable_declarator
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'variable_declarator') {
        const name = fieldText(child, 'name');
        if (!name) continue;

        const staticStr = isStatic ? 'static ' : '';
        const signature = `${staticStr}${typeName} ${name}`;

        members.push({
          name,
          kind: 'property' as MemberKind,
          signature,
          jsDoc: null,
          visibility,
          isStatic,
        });
      }
    }

    return members;
  }

  /** 提取构造器成员 */
  private _extractConstructorMember(
    node: Parser.SyntaxNode,
    includePrivate: boolean,
  ): MemberInfo | null {
    const visibility = extractVisibility(node);
    if (!includePrivate && visibility === 'private') return null;

    const name = fieldText(node, 'name') ?? 'constructor';
    const params = extractFormalParams(node);
    const signature = `${name}${params}`;

    return {
      name,
      kind: 'constructor' as MemberKind,
      signature,
      jsDoc: null,
      visibility,
      isStatic: false,
    };
  }

  // ============================================================
  // 内部方法 — 导入提取
  // ============================================================

  /** 提取 import_declaration */
  private _extractImportDeclaration(node: Parser.SyntaxNode): ImportReference | null {
    // Java import 文本形如: import java.util.List; 或 import static java.util.Collections.sort;
    const text = node.text.trim();

    // 去掉 import 关键字和分号
    let importPath = text
      .replace(/^import\s+/, '')
      .replace(/;$/, '')
      .trim();

    // 检查是否为 static import
    const isStaticImport = importPath.startsWith('static ');
    if (isStaticImport) {
      importPath = importPath.replace(/^static\s+/, '').trim();
    }

    if (!importPath) return null;

    // 提取 namedImports（最后一个 . 后面的名称）
    const lastDotIdx = importPath.lastIndexOf('.');
    let moduleSpecifier: string;
    const namedImports: string[] = [];

    if (lastDotIdx > 0) {
      moduleSpecifier = importPath.slice(0, lastDotIdx);
      const importedName = importPath.slice(lastDotIdx + 1);
      if (importedName && importedName !== '*') {
        namedImports.push(importedName);
      } else if (importedName === '*') {
        namedImports.push('*');
      }
    } else {
      moduleSpecifier = importPath;
    }

    return {
      moduleSpecifier,
      isRelative: false,
      resolvedPath: null,
      namedImports: namedImports.length > 0 ? namedImports : undefined,
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
