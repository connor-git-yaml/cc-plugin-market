/**
 * ModuleSpec、ArchitectureIndex、DriftReport、BatchState、RedactionResult
 * 及所有相关嵌套实体的 Zod Schema 定义
 */
import { z } from 'zod';
import { CodeSkeletonSchema } from './code-skeleton.js';
import { DriftItemSchema, DriftSummarySchema } from './drift-item.js';

// ============================================================
// ModuleSpec 相关
// ============================================================

/** YAML Frontmatter */
export const SpecFrontmatterSchema = z.object({
  type: z.literal('module-spec'),
  version: z.string().regex(/^v\d+$/),
  generatedBy: z.string().min(1),
  sourceTarget: z.string().min(1),
  relatedFiles: z.array(z.string()),
  lastUpdated: z.string().datetime(),
  confidence: z.enum(['high', 'medium', 'low']),
  skeletonHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SpecFrontmatter = z.infer<typeof SpecFrontmatterSchema>;

/** 9 段式 Spec 内容 */
export const SpecSectionsSchema = z.object({
  intent: z.string().min(1),
  interfaceDefinition: z.string().min(1),
  businessLogic: z.string().min(1),
  dataStructures: z.string().min(1),
  constraints: z.string().min(1),
  edgeCases: z.string().min(1),
  technicalDebt: z.string().min(1),
  testCoverage: z.string().min(1),
  dependencies: z.string().min(1),
});
export type SpecSections = z.infer<typeof SpecSectionsSchema>;

/** Mermaid 图表 */
export const MermaidDiagramSchema = z.object({
  type: z.enum(['classDiagram', 'flowchart', 'graph']),
  source: z.string().min(1),
  title: z.string().optional(),
});
export type MermaidDiagram = z.infer<typeof MermaidDiagramSchema>;

/** 源文件清单条目 */
export const FileEntrySchema = z.object({
  path: z.string().min(1),
  loc: z.number().int().positive(),
  purpose: z.string().min(1),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

/** 单模块 Spec 文档结构化表示 */
export const ModuleSpecSchema = z.object({
  frontmatter: SpecFrontmatterSchema,
  sections: SpecSectionsSchema,
  mermaidDiagrams: z.array(MermaidDiagramSchema).optional(),
  fileInventory: z.array(FileEntrySchema),
  baselineSkeleton: CodeSkeletonSchema,
  outputPath: z.string().min(1),
});
export type ModuleSpec = z.infer<typeof ModuleSpecSchema>;

// ============================================================
// ArchitectureIndex 相关
// ============================================================

/** 架构索引 Frontmatter */
export const IndexFrontmatterSchema = z.object({
  type: z.literal('architecture-index'),
  version: z.string().regex(/^v\d+$/),
  generatedBy: z.string().min(1),
  projectRoot: z.string().min(1),
  totalModules: z.number().int().nonnegative(),
  lastUpdated: z.string().datetime(),
});
export type IndexFrontmatter = z.infer<typeof IndexFrontmatterSchema>;

/** 模块映射表条目 */
export const ModuleMapEntrySchema = z.object({
  name: z.string().min(1),
  specPath: z.string().min(1),
  description: z.string().min(1),
  level: z.number().int().nonnegative(),
  dependencies: z.array(z.string()),
});
export type ModuleMapEntry = z.infer<typeof ModuleMapEntrySchema>;

/** 技术栈条目 */
export const TechStackEntrySchema = z.object({
  category: z.string().min(1),
  name: z.string().min(1),
  version: z.string().nullable().optional(),
  purpose: z.string().min(1),
});
export type TechStackEntry = z.infer<typeof TechStackEntrySchema>;

/** 项目级架构索引文档 */
export const ArchitectureIndexSchema = z.object({
  frontmatter: IndexFrontmatterSchema,
  systemPurpose: z.string().min(1),
  architecturePattern: z.string().min(1),
  moduleMap: z.array(ModuleMapEntrySchema),
  crossCuttingConcerns: z.array(z.string()),
  technologyStack: z.array(TechStackEntrySchema),
  dependencyDiagram: z.string().min(1),
  outputPath: z.string().min(1),
});
export type ArchitectureIndex = z.infer<typeof ArchitectureIndexSchema>;

// ============================================================
// DriftReport 相关
// ============================================================

/** 漂移检测完整报告 */
export const DriftReportSchema = z.object({
  specPath: z.string().min(1),
  sourcePath: z.string().min(1),
  generatedAt: z.string().datetime(),
  specVersion: z.string().min(1),
  summary: DriftSummarySchema,
  items: z.array(DriftItemSchema),
  filteredNoise: z.number().int().nonnegative(),
  recommendation: z.string().min(1),
  outputPath: z.string().min(1),
});
export type DriftReport = z.infer<typeof DriftReportSchema>;

// ============================================================
// BatchState 相关
// ============================================================

/** 已完成模块 */
export const CompletedModuleSchema = z.object({
  path: z.string().min(1),
  specPath: z.string().min(1),
  completedAt: z.string().datetime(),
  tokenUsage: z.number().int().nonnegative().optional(),
});
export type CompletedModule = z.infer<typeof CompletedModuleSchema>;

/** 失败模块 */
export const FailedModuleSchema = z.object({
  path: z.string().min(1),
  error: z.string().min(1),
  failedAt: z.string().datetime(),
  retryCount: z.number().int().nonnegative(),
  degradedToAstOnly: z.boolean(),
});
export type FailedModule = z.infer<typeof FailedModuleSchema>;

/** 批处理断点恢复状态 */
export const BatchStateSchema = z.object({
  batchId: z.string().min(1),
  projectRoot: z.string().min(1),
  startedAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime(),
  totalModules: z.number().int().nonnegative(),
  processingOrder: z.array(z.string()),
  completedModules: z.array(CompletedModuleSchema),
  failedModules: z.array(FailedModuleSchema),
  currentModule: z.string().nullable().optional(),
  forceRegenerate: z.boolean(),
});
export type BatchState = z.infer<typeof BatchStateSchema>;

// ============================================================
// RedactionResult 相关
// ============================================================

/** 敏感信息检测项 */
export const SecretDetectionSchema = z.object({
  type: z.string().min(1),
  line: z.number().int().positive(),
  confidence: z.enum(['high', 'medium', 'low']),
  placeholder: z.string().min(1),
});
export type SecretDetection = z.infer<typeof SecretDetectionSchema>;

/** 敏感信息脱敏结果 */
export const RedactionResultSchema = z.object({
  originalHash: z.string().min(1),
  redactedContent: z.string(),
  detections: z.array(SecretDetectionSchema),
  falsePositivesFiltered: z.number().int().nonnegative(),
});
export type RedactionResult = z.infer<typeof RedactionResultSchema>;

// ============================================================
// 阶段进度相关
// ============================================================

/** 处理阶段标识符 */
export type StageId = 'scan' | 'ast' | 'context' | 'llm' | 'parse' | 'render';

/** 阶段进度事件 */
export interface StageProgress {
  /** 阶段标识符 */
  stage: StageId;
  /** 阶段中文描述 */
  message: string;
  /** 阶段耗时（毫秒，仅完成时有值） */
  duration?: number;
}

/** 阶段进度回调 */
export type StageProgressCallback = (progress: StageProgress) => void;
