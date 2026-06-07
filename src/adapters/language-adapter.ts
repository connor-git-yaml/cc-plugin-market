/**
 * 语言适配器接口定义
 * 定义一种编程语言支持所需的全部能力契约：文件分析、降级分析、
 * 模块图构建（可选）、术语映射、测试文件模式。
 *
 * Feature 156 W1.4：模块图统一使用 ModuleGraph
 * （UnifiedGraph 派生视图，src/knowledge-graph/module-derivation.ts）。
 */
import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type { ModuleGraph } from '../knowledge-graph/module-derivation.js';
import type { CommentRegion } from '../debt-scanner/types.js';
import type { TsConfigResolutionContext } from '../core/import-resolver.js';

export type { CommentRegion };

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
  /**
   * 抽取函数调用点（Feature 151 + CL-05），默认 false。
   *
   * 设计动机：抽 callSites 会增加 AST 遍历开销（NFR-1 性能），
   * spec drift check / 单文件分析等无 graph 需求的场景不需要 callSites，保持默认 false。
   * panoramic 流水线（batch-orchestrator / batch-project-docs / coverage-auditor）
   * 必须显式传 true 才能让 graph.json 含 calls 边。
   */
  extractCallSites?: boolean;
  /**
   * 项目根目录绝对路径（Feature 156 W1.0 新增，FR-28）。
   *
   * 用于 import-resolver 解析 tsconfig path alias 与跨包相对路径。
   * 缺失时仍可解析相对路径（fallback 用 path.dirname(filePath) 作 base），
   * 但 alias 会失效。
   */
  projectRoot?: string;
  /**
   * tsconfig 解析上下文（Feature 181 收口：统一替代历史 pathAliases + baseUrl 双字段）。
   *
   * 由 import-resolver.findNearestTsConfig + buildTsConfigContext 生成，承载
   * tsconfig.compilerOptions 的 baseUrl + paths（含 extends 链），交由
   * 单一权威 import-resolver.resolveTsJsImport 解析 alias / baseUrl。
   * 缺失时仍可解析相对路径，但 alias / baseUrl 会失效。
   */
  tsConfigContext?: TsConfigResolutionContext | null;
}

/**
 * 模块图构建选项（W1.4：ModuleGraphOptions）
 */
export interface ModuleGraphOptions {
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
 * 模块图构建（可选）、术语映射、测试文件模式。
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
   * 构建项目级模块图（可选能力）
   * 并非所有语言在初始阶段都需要模块图支持。
   *
   * Feature 156 W1.4：所有实现内部统一走 buildUnifiedGraph + deriveModuleGraph
   * 派生路径，不再依赖 dependency-cruiser 等外部工具。
   *
   * @param projectRoot - 项目根目录
   * @param options - 构建选项（可选）
   * @returns ModuleGraph（UnifiedGraph 派生视图）
   */
  buildModuleGraph?(
    projectRoot: string,
    options?: ModuleGraphOptions,
  ): Promise<ModuleGraph>;

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

  /**
   * 基于 AST 提取源文件中的所有注释 region（可选能力）。
   * 用于 Feature 130 debt-scanner：识别 TODO/FIXME 等注释，
   * 并且排除字符串字面量内的 "TODO" 字样，避免规则误判。
   *
   * 适配器如未实现该能力，debt-scanner 会跳过这些文件并在 diagnostics 中计数。
   *
   * @param filePath 源文件绝对路径
   * @returns 该文件的所有注释 region（已去掉注释起始/结束标记）
   */
  extractComments?(filePath: string): Promise<CommentRegion[]>;
}
