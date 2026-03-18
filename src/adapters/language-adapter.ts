/**
 * 语言适配器接口定义
 * 定义一种编程语言支持所需的全部能力契约：文件分析、降级分析、
 * 依赖图构建（可选）、术语映射、测试文件模式。
 */
import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type { DependencyGraph } from '../models/dependency-graph.js';

// ============================================================
// 辅助类型
// ============================================================

/**
 * 文件分析选项
 */
export interface AnalyzeFileOptions {
  /** 包含非导出符号（默认 false） */
  includePrivate?: boolean;
  /** 类继承层级最大解析深度（默认 5） */
  maxDepth?: number;
}

/**
 * 依赖图构建选项
 */
export interface DependencyGraphOptions {
  /** 用于过滤分析文件的 Glob 模式 */
  includeOnly?: string;
  /** 排除模式 */
  excludePatterns?: string[];
  /** 语言特定配置文件路径（如 tsconfig.json） */
  configPath?: string;
}

/**
 * 语言特定术语映射
 * 每种语言对"导出"、"导入"等概念有不同的表达方式。
 * 此类型允许 LLM prompt 使用与目标语言一致的术语。
 */
export interface LanguageTerminology {
  /** 代码块语言标记（如 'typescript', 'python', 'go'） */
  codeBlockLanguage: string;
  /** "导出"概念的描述 */
  exportConcept: string;
  /** "导入"概念的描述 */
  importConcept: string;
  /** 类型系统描述 */
  typeSystemDescription: string;
  /** 接口/协议概念 */
  interfaceConcept: string;
  /** 模块系统描述 */
  moduleSystem: string;
}

/**
 * 测试文件匹配模式
 * 用于 secret-redactor 和 noise-filter 识别测试文件。
 */
export interface TestPatterns {
  /** 测试文件名正则 */
  filePattern: RegExp;
  /** 测试目录名集合 */
  testDirs: readonly string[];
}

// ============================================================
// 核心接口
// ============================================================

/**
 * 语言适配器接口
 * 定义一种编程语言支持所需的全部能力：文件分析、降级分析、
 * 依赖图构建（可选）、术语映射、测试文件模式。
 */
export interface LanguageAdapter {
  /** 适配器唯一标识（如 'ts-js', 'python', 'go'） */
  readonly id: string;

  /** 支持的语言列表（对应 CodeSkeleton.language 值） */
  readonly languages: readonly Language[];

  /**
   * 支持的文件扩展名集合（含前导点，小写）
   * 例：Set(['.ts', '.tsx', '.js', '.jsx'])
   */
  readonly extensions: ReadonlySet<string>;

  /**
   * 默认忽略目录集合（语言生态特有，如 node_modules、__pycache__）
   * 不包含通用忽略目录（如 .git），通用目录由 file-scanner 独立维护。
   */
  readonly defaultIgnoreDirs: ReadonlySet<string>;

  /**
   * AST 分析单个文件，返回结构化的 CodeSkeleton
   *
   * @param filePath - 源文件绝对路径
   * @param options - 分析选项（可选）
   * @returns CodeSkeleton
   * @throws FileNotFoundError 文件不存在时
   */
  analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton>;

  /**
   * 正则降级分析
   * 当主分析器（如 ts-morph）不可用或解析失败时，提供基于正则的兜底分析。
   *
   * @param filePath - 源文件绝对路径
   * @returns 部分填充的 CodeSkeleton，parserUsed 标记为降级解析器
   */
  analyzeFallback(filePath: string): Promise<CodeSkeleton>;

  /**
   * 构建项目级依赖图（可选能力）
   * 并非所有语言在初始阶段都需要依赖图支持。
   *
   * @param projectRoot - 项目根目录
   * @param options - 构建选项（可选）
   * @returns DependencyGraph
   */
  buildDependencyGraph?(
    projectRoot: string,
    options?: DependencyGraphOptions,
  ): Promise<DependencyGraph>;

  /**
   * 返回该语言的术语映射
   * 用于 LLM prompt 的语言参数化。
   */
  getTerminology(): LanguageTerminology;

  /**
   * 返回该语言的测试文件匹配模式
   * 用于 secret-redactor 和 noise-filter 识别测试文件。
   */
  getTestPatterns(): TestPatterns;
}
