/**
 * 全景文档化核心接口定义
 * DocumentGenerator + ArtifactParser 泛型接口 + Zod Schema + 辅助类型
 *
 * 文件组织顺序（参考 code-skeleton.ts 的 Zod + type 同文件模式）：
 * 1. 导入（zod）
 * 2. OutputFormat 枚举 Schema + type
 * 3. GenerateOptions Schema + type
 * 4. ProjectContext Schema + type（最小占位版本）
 * 5. GeneratorMetadata Schema + type
 * 6. ArtifactParserMetadata Schema + type
 * 7. DocumentGenerator<TInput, TOutput> interface
 * 8. ArtifactParser<T> interface
 */
import { z } from 'zod';

// ============================================================
// OutputFormat 枚举
// ============================================================

/**
 * 输出格式枚举 Schema
 * 支持 markdown（默认）、json（结构化数据）、all（markdown + json + mermaid）
 */
export const OutputFormatSchema = z.enum(['markdown', 'json', 'all']);

/** 输出格式类型 */
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

// ============================================================
// GenerateOptions
// ============================================================

/**
 * 文档生成通用选项 Schema
 * - useLLM: 是否启用 LLM 增强生成（默认 false）
 * - templateOverride: 自定义 Handlebars 模板路径
 * - outputFormat: 输出格式（默认 'markdown'）
 */
export const GenerateOptionsSchema = z.object({
  /** 是否启用 LLM 增强生成。false 时仅使用 AST/正则分析 */
  useLLM: z.boolean().optional().default(false),
  /** 自定义 Handlebars 模板路径。未指定时使用内置模板 */
  templateOverride: z.string().optional(),
  /** 输出格式。支持 'markdown'（默认）、'json'（结构化数据）、'all'（全格式输出） */
  outputFormat: OutputFormatSchema.optional().default('markdown'),
});

/** 文档生成通用选项类型 */
export type GenerateOptions = z.infer<typeof GenerateOptionsSchema>;

// ============================================================
// PackageManager 枚举
// ============================================================

/**
 * 包管理器枚举 Schema
 * 10 个枚举值：npm/yarn/pnpm/pip/uv/go/maven/gradle/pipenv/unknown
 * pip 为预留值（无自动检测规则），unknown 为无法识别时的默认值
 */
export const PackageManagerSchema = z.enum([
  'npm', 'yarn', 'pnpm', 'pip', 'uv',
  'go', 'maven', 'gradle', 'pipenv', 'unknown',
]);

/** 包管理器类型 */
export type PackageManager = z.infer<typeof PackageManagerSchema>;

// ============================================================
// WorkspaceType 枚举
// ============================================================

/**
 * Workspace 类型枚举 Schema
 * single: 单包项目; monorepo: 多包/工作区项目
 */
export const WorkspaceTypeSchema = z.enum(['single', 'monorepo']);

/** Workspace 类型 */
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

// ============================================================
// ProjectContext（完整版本）
// ============================================================

/**
 * 项目上下文基础 Schema（Feature 034 原始定义）
 * 保留为内部常量，对外导出扩展后的完整版本
 */
const BaseProjectContextSchema = z.object({
  /** 项目根目录绝对路径 */
  projectRoot: z.string().min(1),
  /** 已识别的配置文件映射（文件名 -> 绝对路径） */
  configFiles: z.map(z.string(), z.string()),
});

/**
 * 项目上下文 Schema（完整版本）
 * 在基础版上扩展四个新属性，全部提供 .default() 值以保持向后兼容
 * - packageManager: 检测到的包管理器类型（默认 'unknown'）
 * - workspaceType: 项目类型（默认 'single'）
 * - detectedLanguages: 检测到的编程语言列表（默认 []）
 * - existingSpecs: 已有 spec 文件绝对路径列表（默认 []）
 */
export const ProjectContextSchema = BaseProjectContextSchema.extend({
  /** 检测到的包管理器类型 */
  packageManager: PackageManagerSchema.default('unknown'),
  /** 项目类型——单包或 Monorepo */
  workspaceType: WorkspaceTypeSchema.default('single'),
  /** 检测到的编程语言适配器 ID 列表 */
  detectedLanguages: z.array(z.string()).default([]),
  /** 已有 spec 文件的绝对路径列表 */
  existingSpecs: z.array(z.string()).default([]),
});

/** 项目上下文类型（完整版本） */
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

// ============================================================
// GeneratorMetadata
// ============================================================

/**
 * DocumentGenerator 元数据 Schema
 * 用于运行时验证 Generator 的 id、name、description
 * - id: kebab-case 唯一标识符，匹配 /^[a-z][a-z0-9-]*$/
 * - name: 显示名称（非空）
 * - description: 功能描述（非空）
 */
export const GeneratorMetadataSchema = z.object({
  /** 唯一标识符，kebab-case 格式 */
  id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/),
  /** 显示名称 */
  name: z.string().min(1),
  /** 功能描述 */
  description: z.string().min(1),
});

/** DocumentGenerator 元数据类型 */
export type GeneratorMetadata = z.infer<typeof GeneratorMetadataSchema>;

// ============================================================
// ArtifactParserMetadata
// ============================================================

/**
 * ArtifactParser 元数据 Schema
 * 用于运行时验证 Parser 的 id、name、filePatterns
 * - id: kebab-case 唯一标识符
 * - name: 显示名称（非空）
 * - filePatterns: 支持的文件匹配模式（glob 格式，至少一个）
 */
export const ArtifactParserMetadataSchema = z.object({
  /** 唯一标识符，kebab-case 格式 */
  id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/),
  /** 显示名称 */
  name: z.string().min(1),
  /** 支持的文件匹配模式（glob 格式），至少包含一个 */
  filePatterns: z.array(z.string().min(1)).min(1),
});

/** ArtifactParser 元数据类型 */
export type ArtifactParserMetadata = z.infer<typeof ArtifactParserMetadataSchema>;

// ============================================================
// DocumentGenerator<TInput, TOutput> 接口
// ============================================================

/**
 * 文档生成策略接口
 * 定义从项目中提取信息并生成特定类型文档的统一契约。
 * 采用 Strategy 模式，与现有 LanguageAdapter 接口设计一致。
 *
 * 生命周期：isApplicable -> extract -> generate -> render
 *
 * @typeParam TInput - extract 步骤的输出数据结构
 * @typeParam TOutput - generate 步骤的输出数据结构
 */
export interface DocumentGenerator<TInput, TOutput> {
  /** 唯一标识符，用于 GeneratorRegistry 注册和查询（kebab-case） */
  readonly id: string;

  /** 显示名称，用于日志和 CLI 输出 */
  readonly name: string;

  /** 功能描述，用于 help 信息和 MCP 工具描述 */
  readonly description: string;

  /**
   * 判断当前项目是否适用此 Generator
   * 支持同步/异步联合返回——轻量检查可同步，复杂分析可异步
   *
   * @param context - 项目上下文
   * @returns 是否适用
   */
  isApplicable(context: ProjectContext): boolean | Promise<boolean>;

  /**
   * 从项目中提取该 Generator 需要的输入数据
   * 强制异步——数据提取通常涉及文件 I/O
   *
   * @param context - 项目上下文
   * @returns 提取的输入数据
   */
  extract(context: ProjectContext): Promise<TInput>;

  /**
   * 将提取的原始数据转换为结构化的文档输出对象
   * 强制异步——转换可能涉及 LLM 调用
   *
   * @param input - extract 步骤的输出
   * @param options - 生成选项（可选）
   * @returns 结构化文档输出
   */
  generate(input: TInput, options?: GenerateOptions): Promise<TOutput>;

  /**
   * 将文档输出对象渲染为 Markdown 字符串
   * 支持同步/异步联合返回——简单拼接可同步，复杂渲染可异步
   *
   * @param output - generate 步骤的输出
   * @returns Markdown 字符串
   */
  render(output: TOutput): string | Promise<string>;
}

// ============================================================
// ArtifactParser<T> 接口
// ============================================================

/**
 * 非代码制品解析接口
 * 定义非代码制品（SKILL.md、behavior YAML、Dockerfile 等）的解析契约。
 * 与 LanguageAdapter 正交——LanguageAdapter 处理代码 AST，ArtifactParser 处理非代码制品。
 *
 * @typeParam T - parse 步骤的输出数据结构
 */
export interface ArtifactParser<T> {
  /** 唯一标识符（如 'skill-md'、'dockerfile'） */
  readonly id: string;

  /** 显示名称（如 'SKILL.md Parser'） */
  readonly name: string;

  /** 支持的文件匹配模式，glob 格式（如 ['SKILL.md']） */
  readonly filePatterns: readonly string[];

  /**
   * 解析单个制品文件，返回结构化数据
   * 强制异步——文件读取为 I/O 操作
   *
   * @param filePath - 制品文件绝对路径
   * @returns 结构化解析结果
   */
  parse(filePath: string): Promise<T>;

  /**
   * 批量解析多个同类制品文件
   *
   * @param filePaths - 制品文件路径数组
   * @returns 解析结果数组
   */
  parseAll(filePaths: string[]): Promise<T[]>;
}
