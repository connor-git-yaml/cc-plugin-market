/**
 * SpecStore 接口合同
 * Feature 128: Harden — SpecStore Abstraction
 *
 * 本文件定义 SpecStore 的 TypeScript 类型契约。
 * 实际实现位于 src/spec-store/index.ts。
 *
 * 合同版本：1.0.0
 */

import type { ModuleSpec, SpecFrontmatter } from '../../../src/models/module-spec.js';
import type {
  StoredModuleSpecSummary,
  ExistingSpecDocument,
} from '../../../src/panoramic/builders/doc-graph-builder.js';

// ============================================================
// SpecSourceKind — spec 身份枚举
// ============================================================

/**
 * spec 身份类型
 * - canonical：权威原始 spec，由 batch 生成并直接对应源代码模块
 * - derived：从 canonical 派生的变体（如翻译版、摘要版），内容可能不同
 * - bundle_copy：bundle 打包时原样复制的副本，内容与 canonical 完全一致
 *
 * 历史遗留 spec（缺少此字段）默认视为 canonical。
 */
export type SpecSourceKind = 'canonical' | 'derived' | 'bundle_copy';

// ============================================================
// IndexableModuleSpec — SpecStore 对外暴露的统一 spec 视图
// ============================================================

/**
 * 可被 index-generator、README 生成器、coverage auditor 使用的最小 spec 结构
 * 兼容 ModuleSpec（本次生成）和 StoredModuleSpecSummary（磁盘缓存）
 */
export interface IndexableModuleSpec {
  frontmatter: SpecFrontmatter;
  outputPath: string;
  sections?: {
    intent?: string;
  };
  intentSummary?: string;
}

// ============================================================
// SpecStoreOptions — 构造参数
// ============================================================

export interface SpecStoreOptions {
  /** 本次 batch 生成的 spec 列表 */
  currentSpecs: ModuleSpec[];
  /** 磁盘已有的 spec 摘要列表（来自 scanStoredModuleSpecs） */
  storedSpecs: StoredModuleSpecSummary[];
  /** 项目根目录绝对路径（用于 orphan 判断） */
  projectRoot: string;
  /** 将绝对路径转为项目相对路径的工具函数 */
  toProjectPath: (absPath: string) => string;
}

// ============================================================
// ISpecStore — SpecStore 接口定义
// ============================================================

/**
 * SpecStore 接口
 *
 * 封装"本次生成 + 历史存储 + orphan 识别 + 身份过滤"的统一查询入口。
 * 所有 5 个消费方必须通过此接口获取 spec 集合，不得自行合并。
 */
export interface ISpecStore {
  /**
   * 视图 1：所有已知 spec
   *
   * 返回本次生成 + 历史存储的合集，已去重，默认：
   * - 排除 orphan（源文件不存在的 spec）
   * - 排除 sourceKind === 'bundle_copy' 和 'derived' 的 spec
   *
   * 对应原 mergeIndexSpecs() 的语义，是 README footer 计数、
   * index generator、coverage auditor 的标准数据源。
   *
   * @param options.includeOrphans 是否包含 orphan spec，默认 false
   * @param options.includeNonCanonical 是否包含 derived/bundle_copy，默认 false
   */
  allKnownSpecs(options?: {
    includeOrphans?: boolean;
    includeNonCanonical?: boolean;
  }): IndexableModuleSpec[];

  /**
   * 视图 2：本次 batch 生成的 spec
   *
   * 仅返回本次运行中新生成的 spec，不含历史缓存。
   * 用于需要区分"新鲜生成"和"从缓存读取"的场景。
   */
  currentRunSpecs(): ModuleSpec[];

  /**
   * 视图 3：磁盘已有的 spec（不含本次生成的部分）
   *
   * 返回磁盘中存在但本次未重新生成的 spec 摘要。
   * 可按 sourceKind 过滤。
   *
   * @param options.sourceKind 若指定，只返回对应身份的 spec
   */
  storedOnlySpecs(options?: {
    sourceKind?: SpecSourceKind;
  }): StoredModuleSpecSummary[];

  /**
   * 视图 4：orphan spec
   *
   * 返回磁盘上存在但对应源文件已不存在的 spec。
   * 通常在源文件被删除后出现。
   */
  orphanSpecs(): StoredModuleSpecSummary[];

  /**
   * 辅助方法：转为 buildDocGraph 所需的输入参数
   *
   * 替代原来直接传 collectedModuleSpecs + existingStoredSpecs 的调用方式。
   * graph builder 需要同时知道"本次生成"和"历史已知"，以便标注 currentRun 标志。
   */
  asDocGraphInput(): {
    moduleSpecs: ModuleSpec[];
    existingSpecs: ExistingSpecDocument[];
  };

  /**
   * 辅助方法：所有已知 canonical spec 的总数（排除 orphan）
   *
   * 用于 README footer 和 coverage summary 的计数。
   * 等价于 allKnownSpecs().length，但避免重复构建数组。
   */
  totalKnownCount(): number;
}

// ============================================================
// SpecFrontmatter 扩展字段（新增到 src/models/module-spec.ts）
// ============================================================

/**
 * SpecIdentityFields — 新增到 SpecFrontmatterSchema 的身份字段
 *
 * 注意：这些字段是 optional，不破坏现有 spec。
 *
 * 在 src/models/module-spec.ts 的 SpecFrontmatterSchema 中追加：
 *   sourceKind: z.enum(['canonical', 'derived', 'bundle_copy']).optional(),
 *   derivedFrom: z.string().nullable().optional(),
 */
export interface SpecIdentityFields {
  /**
   * spec 身份类型（optional，缺失时默认 canonical）
   */
  sourceKind?: SpecSourceKind;

  /**
   * 派生来源的 spec outputPath（相对于 projectRoot）
   * canonical → null 或 undefined
   * derived/bundle_copy → 源 canonical spec 路径
   */
  derivedFrom?: string | null;
}
