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
import type { CallSite, CalleeKind } from '../../models/call-site.js';
import type { QueryMapper, MapperOptions } from './base-mapper.js';

// ============================================================
// Feature 154 — callSites 抽取常量
// 集合内容与 scripts/lib/java-call-extractor.mjs 同名集合保持完全一致；
// java-mapper-callsite.test.ts 在常量同源 describe 块中通过 import extractor
// 侧 export 做集合相等断言，CI 全集校验，任一侧扩展时另一侧必失败提示。
// ============================================================

/** 大文件兜底阈值（FR-006）— 1 MB 字节数（非字符数） */
export const CALLSITES_MAX_FILE_BYTES = 1_048_576;

/**
 * 反射方法名集合（FR-005）— 与 java-call-extractor.mjs:REFLECTION_METHOD_NAMES 同源。
 * receiver 检查之前优先短路：callee 名命中此集合 → calleeKind: 'unresolved'。
 */
export const JAVA_REFLECTION_METHOD_NAMES: ReadonlySet<string> = new Set([
  'forName',
  'invoke',
  'newInstance',
  'getDeclaredMethod',
  'getMethod',
  'getDeclaredField',
  'getField',
  'getConstructor',
  'getDeclaredConstructor',
  'getConstructors',
  'getDeclaredConstructors',
  'newProxyInstance',
]);

/**
 * Java 标准库 acronym 类型白名单 — 与 java-call-extractor.mjs:JAVA_ACRONYM_TYPE_NAMES 同源。
 * 全大写但属于 Java 标准库类型（如 java.util.UUID, java.net.URL）；用于 _isJavaTypeName。
 */
export const JAVA_ACRONYM_TYPE_NAMES: ReadonlySet<string> = new Set([
  'URL', 'URI', 'UUID',
  'XML', 'JSON', 'CSV',
  'API', 'JDBC', 'JNDI',
  'AWS', 'TCP', 'UDP',
  'SQL', 'JPA',
  'IO',
]);

/**
 * Java 包根名白名单 — 与 java-call-extractor.mjs:JAVA_PACKAGE_ROOT_NAMES 同源。
 * 仅在 _looksLikePackageQualifiedType 内使用，用于判定 FQN 类型路径
 * （如 java.util.UUID）；**不在 _isJavaTypeName 内使用**，避免 `com` / `org`
 * 单独被误判为类型（Codex P1 WARNING W-2）。
 */
export const JAVA_PACKAGE_ROOT_NAMES: ReadonlySet<string> = new Set([
  'java', 'javax', 'jakarta',
  'com', 'org', 'net',
  'io', 'edu', 'gov', 'mil',
]);

/** classify 内部返回类型 */
type ClassifyResult = {
  calleeName: string;
  calleeKind: CalleeKind;
  calleeQualifier?: string;
};

/** _isPhantomCall 节点种类标记 */
type PhantomKind = 'method-invocation' | 'object-creation' | 'explicit-constructor';

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

  /**
   * Feature 154 — 抽取 Java 函数调用点（FR-001 ~ FR-013）。
   *
   * 节点覆盖（FR-001）：
   * - method_invocation：实例 / 静态方法调用
   * - object_creation_expression：构造器调用 (new ClassName())
   * - explicit_constructor_invocation：super(...) / this(...)
   * - lambda_expression 内部上述三类调用
   *
   * 大文件兜底（FR-006，Codex P1 WARNING W-1 修订：用字节数而非字符数）：
   * - Buffer.byteLength(source, 'utf8') > CALLSITES_MAX_FILE_BYTES → 直接返回 []
   *
   * Parse 异常兜底：
   * - 任何异常被外层 try-catch 捕获 → 返回 [] + warn 日志，不污染 CodeSkeleton
   *
   * 详细 kind 映射规则见 spec FR-003 + plan _classifyMethodInvocation 优先级 dispatch。
   */
  extractCallSites(tree: Parser.Tree, source: string): CallSite[] {
    const byteLength = Buffer.byteLength(source, 'utf8');
    if (byteLength > CALLSITES_MAX_FILE_BYTES) {
      // FR-006：大文件兜底必须 warn（Codex T-1 review CRITICAL B 修订）
      console.warn(
        `[java-mapper] extractCallSites 大文件跳过：byteLength=${byteLength} > ${CALLSITES_MAX_FILE_BYTES}`,
      );
      return [];
    }
    try {
      const out: CallSite[] = [];
      this._walkCallSites(tree.rootNode, out);
      return out;
    } catch (err) {
      // 异常兜底：保留诊断上下文（root node type + byteLength + stack）
      // 便于排错而非静默吞掉真实 bug（Codex T-1 review WARNING C 修订）
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.warn(
        `[java-mapper] extractCallSites 异常兜底：` +
          `rootType=${tree.rootNode.type} byteLength=${byteLength} message=${message}` +
          (stack ? `\n${stack}` : ''),
      );
      return [];
    }
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

  // ============================================================
  // Feature 154 — call sites walker（T-3.1 阶段填充逻辑）
  // ============================================================

  /**
   * 迭代式 DFS walker（手工栈，避免大文件递归爆栈）。
   *
   * 节点类型 dispatch（FR-001）：
   *   - method_invocation                    → _handleMethodInvocation
   *   - object_creation_expression           → _handleObjectCreation
   *   - explicit_constructor_invocation      → _handleExplicitConstructorInvocation
   *
   * ERROR / MISSING 跳过策略（FR-007）：
   *   - node.type === 'ERROR' 或 node.isMissing === true → 跳过该节点 + 不入栈子节点
   *   - 非 ERROR/MISSING 节点正常入栈 namedChildren
   */
  private _walkCallSites(root: Parser.SyntaxNode, out: CallSite[]): void {
    const stack: Parser.SyntaxNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;

      // ERROR / MISSING 子树整体跳过（不抽取本节点 + 不入栈子节点）
      if (node.type === 'ERROR' || node.isMissing === true) {
        continue;
      }

      switch (node.type) {
        case 'method_invocation':
          this._handleMethodInvocation(node, out);
          break;
        case 'object_creation_expression':
          this._handleObjectCreation(node, out);
          break;
        case 'explicit_constructor_invocation':
          this._handleExplicitConstructorInvocation(node, out);
          break;
        default:
          break;
      }

      // 入栈所有 namedChildren（继续 DFS）
      const children = node.namedChildren;
      if (children && children.length > 0) {
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (child) stack.push(child);
        }
      }
    }
  }

  // ============================================================
  // Feature 154 — callerContext 解析（T-3.2）
  // ============================================================

  /**
   * 向上 walk 找最近一层 function-like enclosing scope，输出 callerContext 字符串。
   *
   * 与 scripts/lib/java-call-extractor.mjs 的 _resolveJavaCaller 嵌套优先策略一致：
   *   - method_declaration            → "{TypeName}.{methodName}"
   *   - constructor_declaration       → "{TypeName}.<init>"
   *   - compact_constructor_declaration → "{TypeName}.<init>"  (Java 14+ record)
   *   - lambda_expression             → "<lambda:{startLine}:{startColumn}>"
   *   - 顶层（无 enclosing scope）    → "<top-level>"
   *
   * 嵌套优先：第一个匹配立即 return，不继续向上 walk。
   */
  private _resolveCallerContext(node: Parser.SyntaxNode): string {
    let cursor: Parser.SyntaxNode | null = node ? node.parent : null;
    while (cursor) {
      const t = cursor.type;

      if (t === 'method_declaration') {
        const nameNode =
          typeof cursor.childForFieldName === 'function'
            ? cursor.childForFieldName('name')
            : null;
        const methodName =
          nameNode && typeof nameNode.text === 'string' ? nameNode.text : '<anon-method>';
        const typeName = this._findEnclosingTypeName(cursor.parent);
        return `${typeName}.${methodName}`;
      }

      if (t === 'constructor_declaration' || t === 'compact_constructor_declaration') {
        const typeName = this._findEnclosingTypeName(cursor.parent);
        return `${typeName}.<init>`;
      }

      if (t === 'lambda_expression') {
        const line = (cursor.startPosition?.row ?? 0) + 1;
        const col = cursor.startPosition?.column ?? 0;
        return `<lambda:${line}:${col}>`;
      }

      cursor = cursor.parent;
    }
    return '<top-level>';
  }

  /**
   * 从给定节点向上找最近的类型容器，返回类型名或特殊标记。
   *
   * 支持的类型节点（Codex P1 CRITICAL C-7 修订：5 类全覆盖）：
   *   - class_declaration / interface_declaration / enum_declaration
   *   - record_declaration（Java 14+）
   *   - annotation_type_declaration（@interface）
   *
   * 特殊：遇 object_creation_expression 内层 class_body → 返回 '<anon-class>'。
   * 找不到容器 → '<top-level>'。
   */
  private _findEnclosingTypeName(node: Parser.SyntaxNode | null): string {
    let cursor: Parser.SyntaxNode | null = node;
    while (cursor) {
      const t = cursor.type;
      if (
        t === 'class_declaration' ||
        t === 'interface_declaration' ||
        t === 'enum_declaration' ||
        t === 'record_declaration' ||
        t === 'annotation_type_declaration'
      ) {
        const nameNode =
          typeof cursor.childForFieldName === 'function'
            ? cursor.childForFieldName('name')
            : null;
        if (nameNode && typeof nameNode.text === 'string') {
          return nameNode.text;
        }
        return '<anon-class>';
      }
      // 匿名类：method_declaration 父 class_body 父是 object_creation_expression
      if (t === 'object_creation_expression') {
        return '<anon-class>';
      }
      cursor = cursor.parent;
    }
    return '<top-level>';
  }

  // ============================================================
  // Feature 154 — phantom call 防护 + CallSite 构造（T-3.3 + T-3.4）
  // ============================================================

  /**
   * 判断 method_invocation / object_creation_expression / explicit_constructor_invocation
   * 是否是 phantom call（受 parse error 影响但本节点 type 仍非 ERROR）。
   *
   * Codex P1 CRITICAL C-6 修订：判定为 OR（不是 AND）：
   *   - 关键 callee 字段子树 hasError === true，OR
   *   - direct children 中含 ERROR / MISSING
   *
   * phantom 命中时调用方仅跳过当前 call 的抽取（不 push out），但 walker 继续
   * 入栈 namedChildren，避免内层真实 call 被误杀。
   */
  private _isPhantomCall(node: Parser.SyntaxNode, kind: PhantomKind): boolean {
    let calleeForCheck: Parser.SyntaxNode | null = null;
    if (typeof node.childForFieldName === 'function') {
      if (kind === 'method-invocation') {
        calleeForCheck = node.childForFieldName('name');
      } else if (kind === 'object-creation') {
        calleeForCheck = node.childForFieldName('type');
      } else if (kind === 'explicit-constructor') {
        calleeForCheck = node.childForFieldName('constructor');
      }
    }
    if (calleeForCheck && calleeForCheck.hasError === true) {
      return true;
    }
    const allChildren = Array.isArray(node.children) ? node.children : [];
    return allChildren.some((c) => c && (c.type === 'ERROR' || c.isMissing === true));
  }

  /** 构造单个 CallSite 记录（按 CallSiteSchema，可选字段仅在非 undefined 时写入） */
  private _mkCallSite(
    calleeName: string,
    calleeKind: CalleeKind,
    line: number,
    column: number,
    callerContext?: string,
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

  // ============================================================
  // Feature 154 — receiver 类型探测辅助（T-2.1）
  // 设计与 scripts/lib/java-call-extractor.mjs 同源（语义对齐 truth-set）
  // ============================================================

  /**
   * 判断 identifier text 是否符合 Java 类型命名约定。
   *
   * Java 命名约定：
   *   - PascalCase（首字母大写 + 含至少一个小写字母）：Math, Logger, FileInputStream
   *   - 全大写 Acronym（≥ 2 字符且属于白名单）：URL, UUID, JSON
   *   - 常量 SCREAMING_SNAKE_CASE：LOGGER, MAX_SIZE — **不**视为类型名
   *
   * Codex P1 WARNING W-2 修订：**不在此函数内**判定 JAVA_PACKAGE_ROOT_NAMES。
   * 包根判定只在 _looksLikePackageQualifiedType 内对完整 field_access 链使用，
   * 避免 `com` / `org` 单独被误归为类型。
   */
  private _isJavaTypeName(text: string): boolean {
    if (typeof text !== 'string' || text.length === 0) return false;
    if (!/^[A-Z]/.test(text)) return false;
    // PascalCase（含小写字母）
    if (/[a-z]/.test(text)) return true;
    // Acronym 白名单（全大写）
    if (JAVA_ACRONYM_TYPE_NAMES.has(text)) return true;
    return false;
  }

  /**
   * 判断 field_access 节点的末段 field 是否是类型名。
   *
   * 三层判定（Codex T-2 review CRITICAL C-1 修订：必须先要求整条链可拆为 segments，
   * 避免 `foo().bar.Baz.call()` 这种 leftmost 是 method_invocation 的链被误判为
   * 类型路径）：
   *   0. _fieldAccessSegments 拆链失败（leftmost 不是 simple identifier）→ false
   *   1. 末段 field 是 PascalCase / acronym → 类型路径（Outer.Inner）
   *   2. 末段 field 全大写但首字母大写 + 整条链是已知 Java 包路径 → FQN
   *      类型路径（java.util.UUID）
   */
  private _fieldAccessTerminalIsType(node: Parser.SyntaxNode): boolean {
    if (typeof node.childForFieldName !== 'function') return false;
    // 必须能拆为 [leftmost identifier, ..., field] segment 列表
    const segments = this._fieldAccessSegments(node);
    if (!segments) return false;
    const fieldNameNode = node.childForFieldName('field');
    if (!fieldNameNode || typeof fieldNameNode.text !== 'string') return false;
    const fieldText = fieldNameNode.text;
    // Path 1+2: PascalCase 或 acronym 白名单
    if (this._isJavaTypeName(fieldText)) return true;
    // Path 3: 全大写 field + 整条链是已知 Java 包路径 → FQN type
    if (/^[A-Z]/.test(fieldText)) {
      if (this._looksLikePackageQualifiedType(node)) return true;
    }
    return false;
  }

  /**
   * 把 field_access 链拆为 [leftmost, ..., field] 的 segment 数组。
   *
   * 例如 `java.util.UUID` 树形：
   *   field_access(field='UUID')
   *     └ field_access(field='util')
   *         └ identifier 'java'
   * 返回 ['java', 'util', 'UUID']。
   *
   * 任一节点缺 'object'/'field' 字段或 leftmost 非 identifier → 返回 null。
   */
  private _fieldAccessSegments(node: Parser.SyntaxNode): string[] | null {
    const reversed: string[] = [];
    let cursor: Parser.SyntaxNode | null = node;
    while (
      cursor &&
      cursor.type === 'field_access' &&
      typeof cursor.childForFieldName === 'function'
    ) {
      const fieldNode = cursor.childForFieldName('field');
      if (!fieldNode || typeof fieldNode.text !== 'string') return null;
      reversed.push(fieldNode.text);
      cursor = cursor.childForFieldName('object');
    }
    if (!cursor || cursor.type !== 'identifier' || typeof cursor.text !== 'string') {
      return null;
    }
    reversed.push(cursor.text);
    return reversed.reverse();
  }

  /**
   * 判断 field_access 链是否是"包路径.类型"形态。
   *
   * 三个条件全满足才返回 true：
   *   1. 链至少 3 段（leftmost + ≥ 1 中间 + 末段类型）
   *   2. leftmost 在 JAVA_PACKAGE_ROOT_NAMES（仅在此函数内使用）
   *   3. 末段之外每段都是 lowercase package segment 形态（^[a-z][a-z0-9_]*$）
   */
  private _looksLikePackageQualifiedType(node: Parser.SyntaxNode): boolean {
    const segments = this._fieldAccessSegments(node);
    if (!segments || segments.length < 3) return false;
    // Codex T-2 review WARNING W-2 修订：合同自洽 — 末段必须 PascalCase
    const terminal = segments[segments.length - 1];
    if (!terminal || !/^[A-Z]/.test(terminal)) return false;
    const packageSegments = segments.slice(0, -1);
    const leftmost = packageSegments[0];
    if (leftmost === undefined || !JAVA_PACKAGE_ROOT_NAMES.has(leftmost)) return false;
    return packageSegments.every((s) => /^[a-z][a-z0-9_]*$/.test(s));
  }

  /**
   * 把 scoped type name normalize 到末段（label-only 对齐 truth-set）。
   * 例如 `Outer.Inner` → `Inner`；`com.foo.Bar` → `Bar`。
   */
  private _normalizeJavaTypeName(name: string): string {
    if (typeof name !== 'string' || name.length === 0) return name;
    const lastDot = name.lastIndexOf('.');
    return lastDot === -1 ? name : name.slice(lastDot + 1);
  }

  /**
   * 剥离 generic_type.text 中的 type arguments。
   *
   * Codex T-2 review WARNING W-1 修订：用 depth-based 解析处理嵌套泛型，
   * 避免 `Outer<T>.Inner<K>` 被首个 `<` 截断为 `Outer`（应保留 `Outer.Inner`）。
   *
   * 例如：
   *   `ArrayList<String>`         → `ArrayList`
   *   `Outer.Inner<T,K>`          → `Outer.Inner`
   *   `Outer<T>.Inner<K>`         → `Outer.Inner`
   *   `Map<K, List<V>>`           → `Map`
   */
  private _stripTypeArgs(text: string): string {
    if (typeof text !== 'string' || text.length === 0) return text;
    let depth = 0;
    let out = '';
    for (const ch of text) {
      if (ch === '<') {
        depth += 1;
        continue;
      }
      if (ch === '>') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0) out += ch;
    }
    return out;
  }

  // ============================================================
  // Feature 154 — classify methods（T-2.2 + T-2.3）
  // 优先级 dispatch 详见 spec FR-003 + plan 修订版伪代码
  // ============================================================

  /**
   * 分类 method_invocation 节点 → CallSite 元数据。
   *
   * 优先级 dispatch（spec FR-003 + Codex CRITICAL E 修订）：
   *   1. objectNode.type === 'super'                 → super
   *   2. callee 名 ∈ JAVA_REFLECTION_METHOD_NAMES    → unresolved
   *   3. objectNode.type === 'this'                  → member + undefined
   *   4. type_identifier / scoped_type_identifier    → member + 末段类名
   *   5. identifier (PascalCase / acronym)           → member + identifier 文本
   *   6. identifier (lowercase 变量名)               → cross-module + identifier 文本
   *   7. field_access 末段 type                      → member + 末段类名
   *   8. field_access 末段非 type                    → cross-module + undefined
   *   9. 其它带 receiver                             → cross-module + undefined
   *  10. 无 receiver                                 → member + undefined
   */
  private _classifyMethodInvocation(node: Parser.SyntaxNode): ClassifyResult {
    if (typeof node.childForFieldName !== 'function') {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }
    const nameNode = node.childForFieldName('name');
    if (!nameNode || typeof nameNode.text !== 'string') {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }
    const calleeName = nameNode.text;

    const objectNode = node.childForFieldName('object');

    // 1. super.method() → super（super() / this() 由 _handleExplicitConstructorInvocation 处理）
    if (objectNode && objectNode.type === 'super') {
      return { calleeName, calleeKind: 'super' };
    }

    // 2. 反射方法名 short-circuit
    if (JAVA_REFLECTION_METHOD_NAMES.has(calleeName)) {
      return { calleeName, calleeKind: 'unresolved' };
    }

    // 3. this.method() — Codex CRITICAL E：tree-sitter 把 'this' 解析为独立 node type
    if (objectNode && objectNode.type === 'this') {
      return { calleeName, calleeKind: 'member' };
    }

    if (objectNode) {
      // 4. type_identifier / scoped_type_identifier
      if (
        objectNode.type === 'type_identifier' ||
        objectNode.type === 'scoped_type_identifier'
      ) {
        return {
          calleeName,
          calleeKind: 'member',
          calleeQualifier: this._normalizeJavaTypeName(objectNode.text),
        };
      }

      // 5/6. identifier
      if (objectNode.type === 'identifier' && typeof objectNode.text === 'string') {
        if (this._isJavaTypeName(objectNode.text)) {
          // PascalCase / acronym → static member
          return {
            calleeName,
            calleeKind: 'member',
            calleeQualifier: objectNode.text,
          };
        }
        // lowercase variable → instance method
        return {
          calleeName,
          calleeKind: 'cross-module',
          calleeQualifier: objectNode.text,
        };
      }

      // 7/8. field_access — Codex T-2 review CRITICAL C-1 修订：
      // _fieldAccessTerminalIsType 内已强制要求 _fieldAccessSegments 非空，
      // 此处 segs 必非空，直接取末段做 qualifier
      if (objectNode.type === 'field_access') {
        if (this._fieldAccessTerminalIsType(objectNode)) {
          const segs = this._fieldAccessSegments(objectNode);
          // _fieldAccessTerminalIsType 已验证 segs 非空，但 TS 类型仍需 narrowing
          const qualifier =
            segs && segs.length > 0
              ? segs[segs.length - 1]
              : this._normalizeJavaTypeName(objectNode.text);
          return { calleeName, calleeKind: 'member', calleeQualifier: qualifier };
        }
        return { calleeName, calleeKind: 'cross-module' };
      }

      // 9. 其它 receiver（method_invocation 链 / array_access / parenthesized 等）
      return { calleeName, calleeKind: 'cross-module' };
    }

    // 10. 无 receiver（含 static import 展开 free function）→ 统一归 member
    // spec FR-003 deferred 决策：不输出 free，与 truth-set kind=method 对齐
    return { calleeName, calleeKind: 'member' };
  }

  /**
   * 分类 object_creation_expression 节点（new ClassName()）→ CallSite 元数据。
   *
   * type 字段三种形态：
   *   - type_identifier (`new Foo()`)
   *   - generic_type (`new ArrayList<Integer>()`，内层 type_identifier 或 scoped_type_identifier)
   *   - scoped_type_identifier (`new Outer.Inner()`)
   *
   * 输出统一 calleeName = calleeQualifier = normalized 末段类名。
   */
  private _classifyObjectCreation(node: Parser.SyntaxNode): ClassifyResult {
    if (typeof node.childForFieldName !== 'function') {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }
    const typeNode = node.childForFieldName('type');
    if (!typeNode) {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }

    let rawName: string | undefined;
    if (typeNode.type === 'type_identifier' && typeof typeNode.text === 'string') {
      rawName = typeNode.text;
    } else if (typeNode.type === 'scoped_type_identifier' && typeof typeNode.text === 'string') {
      rawName = typeNode.text;
    } else if (typeNode.type === 'generic_type') {
      // 内层 type_identifier / scoped_type_identifier 优先
      const named = Array.isArray(typeNode.namedChildren) ? typeNode.namedChildren : [];
      const inner = named.find(
        (c) => c && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier'),
      );
      if (inner && typeof inner.text === 'string') {
        rawName = inner.text;
      } else if (typeof typeNode.text === 'string') {
        rawName = this._stripTypeArgs(typeNode.text);
      }
    } else if (typeof typeNode.text === 'string' && typeNode.text.length > 0) {
      rawName = this._stripTypeArgs(typeNode.text);
    }

    if (!rawName) {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }
    const className = this._normalizeJavaTypeName(rawName);
    return {
      calleeName: className,
      calleeKind: 'member',
      calleeQualifier: className,
    };
  }

  /**
   * 分类 explicit_constructor_invocation 节点（构造器内 super(...) / this(...)）。
   *
   * constructor 字段 type === 'super' / 'this' → kind=super，calleeName 为字面值。
   * 其它形态 → unresolved。
   */
  private _classifyExplicitConstructorInvocation(node: Parser.SyntaxNode): ClassifyResult {
    if (typeof node.childForFieldName !== 'function') {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }
    const ctorNode = node.childForFieldName('constructor');
    if (!ctorNode) {
      return { calleeName: '<unknown>', calleeKind: 'unresolved' };
    }
    if (ctorNode.type === 'super' || ctorNode.type === 'this') {
      return { calleeName: ctorNode.type, calleeKind: 'super' };
    }
    if (typeof ctorNode.text === 'string') {
      return { calleeName: ctorNode.text, calleeKind: 'unresolved' };
    }
    return { calleeName: '<unknown>', calleeKind: 'unresolved' };
  }

  // ============================================================
  // Feature 154 — handler 接通完整链路（T-3.4）
  // 流程：phantom 检查 → classify → callerContext → push out
  //
  // Codex T-3 review WARNING F 修订：3 个 handler 共用 _emitCallSite helper，
  // 避免 line/column/callerContext/push 写入逻辑在多处漂移。
  // ============================================================

  /** 共用 emit 流程：phantom check → classify → callerContext → push */
  private _emitCallSite(
    node: Parser.SyntaxNode,
    out: CallSite[],
    phantomKind: PhantomKind,
    classifier: (n: Parser.SyntaxNode) => ClassifyResult,
  ): void {
    if (this._isPhantomCall(node, phantomKind)) return;
    const cls = classifier(node);
    const callerCtx = this._resolveCallerContext(node);
    const line = (node.startPosition?.row ?? 0) + 1;
    const col = node.startPosition?.column ?? 0;
    out.push(
      this._mkCallSite(
        cls.calleeName,
        cls.calleeKind,
        line,
        col,
        callerCtx,
        cls.calleeQualifier,
      ),
    );
  }

  /** method_invocation handler */
  private _handleMethodInvocation(node: Parser.SyntaxNode, out: CallSite[]): void {
    this._emitCallSite(node, out, 'method-invocation', (n) =>
      this._classifyMethodInvocation(n),
    );
  }

  /** object_creation_expression handler */
  private _handleObjectCreation(node: Parser.SyntaxNode, out: CallSite[]): void {
    this._emitCallSite(node, out, 'object-creation', (n) =>
      this._classifyObjectCreation(n),
    );
  }

  /** explicit_constructor_invocation handler */
  private _handleExplicitConstructorInvocation(
    node: Parser.SyntaxNode,
    out: CallSite[],
  ): void {
    this._emitCallSite(node, out, 'explicit-constructor', (n) =>
      this._classifyExplicitConstructorInvocation(n),
    );
  }
}
