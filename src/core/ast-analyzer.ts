/**
 * ts-morph AST 分析器
 * 使用单 Project 实例提取 CodeSkeleton（FR-001, Constitution I）
 * 参见 research R1, contracts/core-pipeline.md
 */
import { Project, SourceFile, SyntaxKind, Node, type ExportSpecifier } from 'ts-morph';
import { createHash } from 'node:crypto';
import type {
  CodeSkeleton,
  ExportSymbol,
  ExportKind,
  ImportReference,
  ImportSemanticType,
  MemberInfo,
  Language,
  Visibility,
} from '../models/code-skeleton.js';
import { analyzeFallback } from './tree-sitter-fallback.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import type { AnalyzeFileOptions } from '../adapters/language-adapter.js';
import {
  resolveTsJsImportToAbsolute,
  type TsConfigResolutionContext,
} from './import-resolver.js';

// ============================================================
// 选项类型（统一使用 adapters 层定义的 AnalyzeFileOptions）
// ============================================================

/** @deprecated 使用 AnalyzeFileOptions 代替 */
export type AnalyzeOptions = AnalyzeFileOptions;

export interface BatchAnalyzeOptions extends AnalyzeOptions {
  /** 最大并发数（默认 50） */
  concurrency?: number;
  /** 进度回调 */
  onProgress?: (completed: number, total: number) => void;
}

// ============================================================
// 错误类型
// ============================================================

export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`文件不存在: ${filePath}`);
    this.name = 'FileNotFoundError';
  }
}

export class UnsupportedFileError extends Error {
  constructor(filePath: string) {
    super(`不支持的文件类型: ${filePath}`);
    this.name = 'UnsupportedFileError';
  }
}

// ============================================================
// 单例 Project 实例
// ============================================================

let sharedProject: Project | null = null;

/**
 * 获取或创建共享 Project 实例
 * 使用 skipFileDependencyResolution + noLib 优化性能
 */
function getProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: {
        noLib: true,
        skipLibCheck: true,
        noResolve: true,
        allowJs: true,
        jsx: 2, // React
        types: [],
      },
    });
  }
  return sharedProject;
}

/** 重置共享 Project（测试用） */
export function resetProject(): void {
  sharedProject = null;
}

// ============================================================
// 文件语言检测（TS/JS 内部使用）
// ============================================================

function getLanguage(filePath: string): Language {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    return 'typescript';
  }
  return 'javascript';
}

// ============================================================
// AST 提取工具
// ============================================================

/**
 * 提取导出符号
 */
function extractExports(sourceFile: SourceFile, _options: AnalyzeOptions): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const seen = new Set<string>();

  for (const declaration of sourceFile.getExportedDeclarations()) {
    const [name, nodes] = declaration;
    if (seen.has(name)) continue;
    seen.add(name);

    for (const node of nodes) {
      const symbol = extractSymbol(name, node);
      if (symbol) {
        exports.push(symbol);
      }
    }
  }

  // re-export 门面（`export { X } from './y'`）：单文件 Project + noResolve 下
  // getExportedDeclarations() 对跨文件目标要么静默返回空、要么返回名字但解析出
  // 无法分类的节点（extractSymbol 返回 null 被丢弃），符号无声丢失，需语法级独立提取。
  // 去重针对「实际产出的本地声明名」而非上面循环的 seen——seen 会被 getExportedDeclarations
  // 解析到却被丢弃的 re-export 名污染，用它去重会漏掉全部 re-export。
  extractReExports(sourceFile, exports);

  return exports;
}

/**
 * 语法级提取 named re-export（含 alias 与 type-only 形态）。
 * 本地声明优先：已作为真身产出的同名符号不被 re-export 别名覆盖。
 * 已知限界：`export * from` / `export * as ns from` 无解析不可枚举，不产条目。
 */
function extractReExports(sourceFile: SourceFile, exports: ExportSymbol[]): void {
  const emitted = new Set(exports.map((e) => e.name));

  for (const decl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    // 无 module specifier 的本地 `export { x }` 已由 getExportedDeclarations 覆盖
    if (!moduleSpecifier) continue;

    const startLine = decl.getStartLineNumber();
    const endLine = decl.getEndLineNumber();
    const stmtTypeOnly = decl.isTypeOnly();

    for (const spec of decl.getNamedExports()) {
      const aliasNode = spec.getAliasNode();
      const name = aliasNode ? specifierNodeName(aliasNode) : specifierNodeName(spec.getNameNode());
      if (emitted.has(name)) continue;
      emitted.add(name);

      const isTypeOnly = stmtTypeOnly || spec.isTypeOnly();
      exports.push({
        name,
        kind: 're-export',
        signature: buildReExportSignature(spec, moduleSpecifier, stmtTypeOnly),
        jsDoc: null,
        // `export { X as default } from` 把目标重导出为本模块默认导出，
        // 与 extractSymbol 的 name === 'default' 口径保持一致
        isDefault: name === 'default',
        startLine,
        endLine,
        reExportFrom: moduleSpecifier,
        isTypeOnly,
      });
    }
  }
}

/**
 * 说明符名节点转规范名：string-literal 形态（TS 4.7+ arbitrary module namespace
 * identifier，如 `export { foo as "default" }`）取字面值而非带引号原文，
 * 保证 name 与 isDefault 判定语义正确。
 */
function specifierNodeName(node: Node): string {
  return Node.isStringLiteral(node) ? node.getLiteralValue() : node.getText();
}

/**
 * 为单条 named specifier 规范化重建单行签名。
 * 每条目独立描述自身（不抄多名字语句原文），保证签名与该导出名一一对应。
 * clause 取源码原样（含 alias / 说明符级 `type` / string-literal 名）；
 * type 前缀只由语句级 type-only 驱动，避免产出 `export type { type T }` 非法双写。
 */
function buildReExportSignature(
  spec: ExportSpecifier,
  moduleSpecifier: string,
  stmtTypeOnly: boolean,
): string {
  const clause = spec.getText();
  const typeKeyword = stmtTypeOnly ? 'type ' : '';
  // specifier 含单引号（如文件名带撇号）时改用 JSON.stringify 的双引号+转义形态，签名文本保持合法语法
  const quoted = moduleSpecifier.includes("'")
    ? JSON.stringify(moduleSpecifier)
    : `'${moduleSpecifier}'`;
  return `export ${typeKeyword}{ ${clause} } from ${quoted}`;
}

/**
 * 从 AST 节点提取导出符号信息
 */
function extractSymbol(name: string, node: Node): ExportSymbol | null {
  const kind = getExportKind(node);
  if (!kind) return null;

  const startLine = node.getStartLineNumber();
  const endLine = node.getEndLineNumber();
  const isDefault = name === 'default';
  const jsDoc = getJsDoc(node);
  const typeParams = getTypeParameters(node);
  const signature = getSignature(node, name);
  const members = getMembers(node);

  return {
    name,
    kind,
    signature,
    jsDoc: jsDoc || null,
    typeParameters: typeParams.length > 0 ? typeParams : undefined,
    isDefault,
    startLine,
    endLine,
    members: members.length > 0 ? members : undefined,
  };
}

/**
 * 判断节点的导出类型
 */
function getExportKind(node: Node): ExportKind | null {
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
    return 'function';
  }
  if (Node.isClassDeclaration(node)) return 'class';
  if (Node.isInterfaceDeclaration(node)) return 'interface';
  if (Node.isTypeAliasDeclaration(node)) return 'type';
  if (Node.isEnumDeclaration(node)) return 'enum';
  if (Node.isVariableDeclaration(node)) {
    const decl = node.getParent();
    if (Node.isVariableDeclarationList(decl)) {
      const flags = decl.getFlags();
      // Const 或 Let 都属于 const/variable
      if (flags & 2 /* NodeFlags.Const */) return 'const';
    }
    return 'variable';
  }
  return null;
}

/**
 * 获取 JSDoc 注释
 */
function getJsDoc(node: Node): string | undefined {
  if (!Node.isJSDocable(node)) return undefined;
  const docs = node.getJsDocs();
  if (docs.length === 0) return undefined;
  return docs.map((d) => d.getText()).join('\n');
}

/**
 * 获取类型参数
 */
function getTypeParameters(node: Node): string[] {
  if (!('getTypeParameters' in node)) return [];
  const params = (node as any).getTypeParameters();
  if (!Array.isArray(params)) return [];
  return params.map((p: any) => p.getText());
}

/**
 * 从 AST 获取签名文本（Constitution I：100% 来自 AST）
 */
function getSignature(node: Node, name: string): string {
  if (Node.isFunctionDeclaration(node)) {
    // 提取函数签名（不含函数体）
    const params = node.getParameters().map((p) => p.getText()).join(', ');
    const returnType = node.getReturnTypeNode()?.getText() ?? 'void';
    const typeParams = node.getTypeParameters().map((t) => t.getText()).join(', ');
    const tp = typeParams ? `<${typeParams}>` : '';
    const asyncKw = node.isAsync() ? 'async ' : '';
    return `${asyncKw}function ${name}${tp}(${params}): ${returnType}`;
  }

  if (Node.isClassDeclaration(node)) {
    const ext = node.getExtends()?.getText();
    const impl = node.getImplements().map((i) => i.getText()).join(', ');
    const typeParams = node.getTypeParameters().map((t) => t.getText()).join(', ');
    const tp = typeParams ? `<${typeParams}>` : '';
    let sig = `class ${name}${tp}`;
    if (ext) sig += ` extends ${ext}`;
    if (impl) sig += ` implements ${impl}`;
    return sig;
  }

  if (Node.isInterfaceDeclaration(node)) {
    const ext = node.getExtends().map((e) => e.getText()).join(', ');
    const typeParams = node.getTypeParameters().map((t) => t.getText()).join(', ');
    const tp = typeParams ? `<${typeParams}>` : '';
    let sig = `interface ${name}${tp}`;
    if (ext) sig += ` extends ${ext}`;
    return sig;
  }

  if (Node.isTypeAliasDeclaration(node)) {
    return node.getText().replace(/\s*=\s*[\s\S]*$/, '');
  }

  if (Node.isEnumDeclaration(node)) {
    return `enum ${name}`;
  }

  if (Node.isVariableDeclaration(node)) {
    const typeNode = node.getTypeNode();
    if (typeNode) {
      return `const ${name}: ${typeNode.getText()}`;
    }
    // 尝试从初始化器推断
    const init = node.getInitializer();
    if (init) {
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        const params = init.getParameters().map((p) => p.getText()).join(', ');
        const returnType = init.getReturnTypeNode()?.getText() ?? 'void';
        return `const ${name} = (${params}): ${returnType}`;
      }
    }
    return `const ${name}`;
  }

  // 降级：直接取 getText 的第一行
  const text = node.getText();
  const firstLine = text.split('\n')[0] ?? text;
  return firstLine.slice(0, 200);
}

/**
 * 提取 class/interface 的成员
 */
function getMembers(node: Node): MemberInfo[] {
  const members: MemberInfo[] = [];

  if (Node.isClassDeclaration(node)) {
    for (const member of node.getMembers()) {
      const info = extractMember(member);
      if (info) members.push(info);
    }
  }

  if (Node.isInterfaceDeclaration(node)) {
    for (const member of node.getMembers()) {
      const info = extractMember(member);
      if (info) members.push(info);
    }
  }

  return members;
}

/**
 * 提取单个成员信息
 */
function extractMember(member: Node): MemberInfo | null {
  let name = '';
  let kind: MemberInfo['kind'] = 'property';
  let signature = '';
  let visibility: Visibility | undefined;
  let isStatic = false;
  let isAbstract: boolean | undefined;

  if (Node.isMethodDeclaration(member) || Node.isMethodSignature(member)) {
    name = member.getName();
    kind = 'method';
    if (Node.isMethodDeclaration(member)) {
      const params = member.getParameters().map((p) => p.getText()).join(', ');
      const returnType = member.getReturnTypeNode()?.getText() ?? 'void';
      signature = `${name}(${params}): ${returnType}`;
      isStatic = member.isStatic();
      isAbstract = member.isAbstract() || undefined;
    } else {
      const params = member.getParameters().map((p) => p.getText()).join(', ');
      const returnType = member.getReturnTypeNode()?.getText() ?? 'void';
      signature = `${name}(${params}): ${returnType}`;
    }
  } else if (Node.isPropertyDeclaration(member) || Node.isPropertySignature(member)) {
    name = member.getName();
    kind = 'property';
    const typeNode = member.getTypeNode();
    signature = typeNode ? `${name}: ${typeNode.getText()}` : name;
    if (Node.isPropertyDeclaration(member)) {
      isStatic = member.isStatic();
      isAbstract = member.isAbstract() || undefined;
    }
  } else if (Node.isGetAccessorDeclaration(member)) {
    name = member.getName();
    kind = 'getter';
    const returnType = member.getReturnTypeNode()?.getText() ?? 'any';
    signature = `get ${name}(): ${returnType}`;
    isStatic = member.isStatic();
  } else if (Node.isSetAccessorDeclaration(member)) {
    name = member.getName();
    kind = 'setter';
    const params = member.getParameters().map((p) => p.getText()).join(', ');
    signature = `set ${name}(${params})`;
    isStatic = member.isStatic();
  } else if (Node.isConstructorDeclaration(member)) {
    name = 'constructor';
    kind = 'constructor';
    const params = member.getParameters().map((p) => p.getText()).join(', ');
    signature = `constructor(${params})`;
  } else {
    return null;
  }

  // 访问修饰符
  if ('getScope' in member && typeof (member as any).getScope === 'function') {
    const scope = (member as any).getScope();
    if (scope === 'public' || scope === 'protected' || scope === 'private') {
      visibility = scope;
    }
  }

  const jsDoc = getJsDoc(member);

  return {
    name,
    kind,
    signature,
    jsDoc: jsDoc ?? null,
    visibility,
    isStatic,
    isAbstract,
  };
}

/**
 * 提取导入引用（Feature 156 W1.0 / FR-28 修订）。
 *
 * 现在覆盖 4 类 import：
 *   1. ES Module 静态 import（含 type-only）—— sourceFile.getImportDeclarations()
 *   2. 动态 import()  —— 遍历 CallExpression，callee = ImportKeyword
 *   3. CommonJS require() —— 遍历 CallExpression，callee = Identifier("require")
 *
 * 同时调用 resolveTsJsImport 填充 resolvedPath，让 deriveImportEdges 能产 depends-on 边。
 *
 * @param sourceFile - ts-morph SourceFile
 * @param filePath - 当前分析的文件路径（绝对或相对均可，传给 resolver 作 fromFile）
 * @param projectRoot - 项目根目录（可空字符串；空时 alias 失效）
 * @param tsConfigContext - tsconfig 解析上下文（可选；承载 alias / baseUrl）
 */
function extractImports(
  sourceFile: SourceFile,
  filePath: string,
  projectRoot: string,
  tsConfigContext?: TsConfigResolutionContext | null,
): ImportReference[] {
  const imports: ImportReference[] = [];

  // 1. 静态 import / import type
  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
    const isTypeOnly = decl.isTypeOnly();

    const namedImports = decl.getNamedImports().map((n) => n.getName());
    const defaultImport = decl.getDefaultImport()?.getText() ?? null;

    // 派生 importType（WARN-1 v2 修订）：
    //   (a) 顶层 `import type` → type-only
    //   (b) 否则若没有 default + 没有 namespace + 所有 named import 均为 type-only → type-only
    //   (c) 其他（含混合 default/namespace + type named）→ static（保留运行时值导入语义）
    let importType: ImportSemanticType = 'static';
    if (isTypeOnly) {
      importType = 'type-only';
    } else {
      const hasDefault = decl.getDefaultImport() != null;
      const hasNamespace = decl.getNamespaceImport() != null;
      if (!hasDefault && !hasNamespace) {
        const named = decl.getNamedImports();
        if (named.length > 0 && named.every((n) => n.isTypeOnly())) {
          importType = 'type-only';
        }
      }
    }

    const resolvedPath = resolveTsJsImportToAbsolute(
      moduleSpecifier,
      filePath,
      projectRoot,
      tsConfigContext,
    );

    imports.push({
      moduleSpecifier,
      isRelative,
      resolvedPath,
      namedImports: namedImports.length > 0 ? namedImports : undefined,
      defaultImport,
      isTypeOnly,
      importType,
    });
  }

  // 2 + 3. 动态 import() 与 CommonJS require()
  // 遍历所有 CallExpression；按 callee 类型区分
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    let kind: ImportSemanticType | null = null;
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      kind = 'dynamic';
    } else if (Node.isIdentifier(expr) && expr.getText() === 'require') {
      kind = 'commonjs-require';
    }
    if (!kind) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const firstArg = args[0]!;
    // 仅识别字符串字面量 specifier；模板字符串 / 动态拼接跳过（无法静态解析）
    if (!Node.isStringLiteral(firstArg) && !Node.isNoSubstitutionTemplateLiteral(firstArg)) {
      continue;
    }
    const moduleSpecifier = firstArg.getLiteralText();
    if (!moduleSpecifier) continue;

    const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
    const resolvedPath = resolveTsJsImportToAbsolute(
      moduleSpecifier,
      filePath,
      projectRoot,
      tsConfigContext,
    );

    imports.push({
      moduleSpecifier,
      isRelative,
      resolvedPath,
      isTypeOnly: false,
      importType: kind,
    });
  }

  return imports;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * TS/JS 专用的 AST 分析内部实现
 * 被 TsJsLanguageAdapter 委托调用，不做文件类型检查。
 *
 * @param filePath - 源文件路径
 * @param options - 分析选项
 * @returns CodeSkeleton
 * @throws FileNotFoundError
 * @internal 仅供 TsJsLanguageAdapter 和 analyzeFile 使用
 */
export async function analyzeFileInternal(
  filePath: string,
  options: AnalyzeOptions = {},
): Promise<CodeSkeleton> {
  const project = getProject();
  let sourceFile: SourceFile;

  try {
    sourceFile = project.addSourceFileAtPath(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.message?.includes('does not exist')) {
      throw new FileNotFoundError(filePath);
    }
    // ts-morph 解析失败，触发 tree-sitter 降级
    return analyzeFallback(filePath);
  }

  try {
    // 读取文件内容用于哈希
    const content = sourceFile.getFullText();
    const hash = createHash('sha256').update(content).digest('hex');
    const loc = sourceFile.getEndLineNumber();
    const language = getLanguage(filePath);

    // 提取导出和导入
    const exports = extractExports(sourceFile, options);
    // Feature 156 W1.0：传入 projectRoot 让 import-resolver 解析 alias / 跨包路径
    // Feature 181 收口：统一透传 tsConfigContext（替代历史 pathAliases + baseUrl）
    const imports = extractImports(
      sourceFile,
      filePath,
      options.projectRoot ?? '',
      options.tsConfigContext,
    );

    const skeleton: CodeSkeleton = {
      filePath,
      language,
      loc,
      exports,
      imports,
      hash,
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };

    return skeleton;
  } catch {
    // 解析过程中出错，降级到 tree-sitter
    return analyzeFallback(filePath);
  } finally {
    // 释放内存
    try {
      project.removeSourceFile(sourceFile!);
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 解析单个源文件并返回 CodeSkeleton
 * 通过 Registry 路由到对应的语言适配器。
 *
 * @param filePath - 源文件路径
 * @param options - 分析选项
 * @returns CodeSkeleton
 * @throws FileNotFoundError, UnsupportedFileError
 */
export async function analyzeFile(
  filePath: string,
  options: AnalyzeOptions = {},
): Promise<CodeSkeleton> {
  // 通过 Registry 路由到对应的语言适配器
  const adapter = LanguageAdapterRegistry.getInstance().getAdapter(filePath);
  if (adapter) {
    return adapter.analyzeFile(filePath, options);
  }

  // Registry 无匹配适配器，抛出不支持的文件类型错误
  throw new UnsupportedFileError(filePath);
}

/**
 * 使用单个 Project 实例对多个文件进行批量分析
 * 每个文件处理后调用 file.forget() 进行内存管理
 *
 * @param filePaths - 文件路径数组
 * @param options - 批量分析选项
 * @returns CodeSkeleton[] 与输入顺序一致
 */
export async function analyzeFiles(
  filePaths: string[],
  options: BatchAnalyzeOptions = {},
): Promise<CodeSkeleton[]> {
  const results: CodeSkeleton[] = [];
  const { onProgress } = options;

  for (let i = 0; i < filePaths.length; i++) {
    const skeleton = await analyzeFile(filePaths[i]!, options);
    results.push(skeleton);
    onProgress?.(i + 1, filePaths.length);
  }

  return results;
}
