/**
 * ts-morph AST 分析器
 * 使用单 Project 实例提取 CodeSkeleton（FR-001, Constitution I）
 * 参见 research R1, contracts/core-pipeline.md
 */
import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import { createHash } from 'node:crypto';
import type {
  CodeSkeleton,
  ExportSymbol,
  ExportKind,
  ImportReference,
  MemberInfo,
  Language,
  Visibility,
} from '../models/code-skeleton.js';
import { analyzeFallback } from './tree-sitter-fallback.js';

// ============================================================
// 选项类型
// ============================================================

export interface AnalyzeOptions {
  /** 包含非导出符号（默认 false） */
  includePrivate?: boolean;
  /** 类继承层级最大解析深度（默认 5） */
  maxDepth?: number;
}

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
// 文件语言检测
// ============================================================

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function getLanguage(filePath: string): Language {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    return 'typescript';
  }
  return 'javascript';
}

function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(
    filePath.slice(filePath.lastIndexOf('.')),
  );
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

  return exports;
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
 * 提取导入引用
 */
function extractImports(sourceFile: SourceFile): ImportReference[] {
  const imports: ImportReference[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
    const isTypeOnly = decl.isTypeOnly();

    const namedImports = decl.getNamedImports().map((n) => n.getName());
    const defaultImport = decl.getDefaultImport()?.getText() ?? null;

    imports.push({
      moduleSpecifier,
      isRelative,
      resolvedPath: null, // 不解析路径（性能优化）
      namedImports: namedImports.length > 0 ? namedImports : undefined,
      defaultImport,
      isTypeOnly,
    });
  }

  return imports;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 解析单个 TypeScript/JavaScript 文件并返回 CodeSkeleton
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
  // 验证文件类型
  if (!isSupportedFile(filePath)) {
    throw new UnsupportedFileError(filePath);
  }

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
    const imports = extractImports(sourceFile);

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
