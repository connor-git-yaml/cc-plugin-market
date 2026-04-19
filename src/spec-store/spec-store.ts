/**
 * SpecStore — spec 集合统一查询入口
 *
 * 封装"本次生成 + 历史存储 + orphan 识别 + 身份过滤"，
 * 泛化自 batch-orchestrator.ts 的 mergeIndexSpecs 私有函数。
 * 所有消费方必须通过此类获取 spec 集合，不得自行合并。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModuleSpec, SpecFrontmatter } from '../models/module-spec.js';
import type {
  StoredModuleSpecSummary,
  ExistingSpecDocument,
} from '../panoramic/builders/doc-graph-builder.js';
import type { IndexableModuleSpec } from '../generator/index-generator.js';
import { getDefaultSourceKind, type SpecSourceKind } from './spec-identity.js';

// ============================================================
// IndexableModuleSpec — SpecStore 对外暴露的统一 spec 视图
// ============================================================
// 从 src/generator/index-generator.ts 重导出，保证所有消费方共享一份类型定义，
// 避免 SpecStore 和 index-generator 各自声明导致的类型不兼容。
export type { IndexableModuleSpec };

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
  /**
   * 文件存在性检查函数（可注入，用于测试）
   * 生产环境默认使用 fs.existsSync
   */
  existsFn?: (filePath: string) => boolean;
}

// ============================================================
// SpecStore 类实现
// ============================================================

export class SpecStore {
  private readonly mergedMap: Map<string, IndexableModuleSpec>;
  private readonly orphans: Set<string>;
  private readonly currentSpecPaths: Set<string>;
  private readonly storedSpecsInput: StoredModuleSpecSummary[];
  private readonly currentSpecsInput: ModuleSpec[];

  constructor(options: SpecStoreOptions) {
    const { currentSpecs, storedSpecs, projectRoot, toProjectPath } = options;
    const existsFn = options.existsFn ?? fs.existsSync;

    this.storedSpecsInput = storedSpecs;
    this.currentSpecsInput = currentSpecs;
    this.mergedMap = new Map();
    this.orphans = new Set();
    this.currentSpecPaths = new Set();

    // 迁移自 batch-orchestrator.ts mergeIndexSpecs（第 912-966 行）的合并逻辑：
    // 1. 先插入磁盘已存储的 spec（有 skeletonHash 校验）
    for (const storedSpec of storedSpecs) {
      // 原 mergeIndexSpecs 中的 skeletonHash 存在性检查：无 hash 则跳过
      if (!storedSpec.skeletonHash) {
        continue;
      }

      // 从 storedSpec 构造 IndexableModuleSpec，将 sourceKind 携带进 frontmatter
      // 这样 allKnownSpecs() 的 sourceKind 过滤才能正确工作
      const storedSourceKind = (storedSpec as StoredModuleSpecSummary & { sourceKind?: string }).sourceKind;
      const frontmatterFromStored: SpecFrontmatter & { sourceKind?: string } = {
        type: 'module-spec',
        version: storedSpec.version ?? 'v1',
        generatedBy: 'spectra v3.0',
        sourceTarget: storedSpec.sourceTarget,
        relatedFiles: storedSpec.relatedFiles,
        lastUpdated: new Date().toISOString(),
        confidence: storedSpec.confidence ?? 'medium',
        skeletonHash: storedSpec.skeletonHash,
        language: storedSpec.language,
        crossLanguageRefs: storedSpec.crossLanguageRefs,
      };
      if (storedSourceKind !== undefined) {
        frontmatterFromStored.sourceKind = storedSourceKind;
      }

      this.mergedMap.set(storedSpec.outputPath, {
        frontmatter: frontmatterFromStored,
        outputPath: storedSpec.outputPath,
        intentSummary: storedSpec.intentSummary,
      });
    }

    // 2. 用本次生成的 spec 覆盖（同一 outputPath 时本次生成优先）
    for (const currentSpec of currentSpecs) {
      const normalizedOutputPath = path.isAbsolute(currentSpec.outputPath)
        ? toProjectPath(path.resolve(currentSpec.outputPath))
        : currentSpec.outputPath;

      this.mergedMap.set(normalizedOutputPath, {
        frontmatter: currentSpec.frontmatter,
        outputPath: normalizedOutputPath,
        sections: {
          intent: currentSpec.sections.intent,
        },
      });

      this.currentSpecPaths.add(normalizedOutputPath);
    }

    // 3. Orphan 检测：仅对 canonical（或字段缺失）的 storedSpec 做文件存在性检查
    for (const storedSpec of storedSpecs) {
      const sourceKind = getDefaultSourceKind(
        (storedSpec as StoredModuleSpecSummary & { sourceKind?: string }).sourceKind,
      );

      // bundle_copy 和 derived 的派生 spec 不做 orphan 判断（其源是另一个 spec，不是代码文件）
      if (sourceKind !== 'canonical') {
        continue;
      }

      const absoluteSourceTarget = path.join(projectRoot, storedSpec.sourceTarget);
      if (!existsFn(absoluteSourceTarget)) {
        this.orphans.add(storedSpec.outputPath);
      }
    }
  }

  // ============================================================
  // 视图 1：所有已知 spec（canonical，排除 orphan 和非 canonical）
  // ============================================================

  /**
   * 返回本次生成 + 历史存储的合集，已去重。
   * 默认：排除 orphan + 排除 sourceKind 为 bundle_copy/derived 的 spec。
   */
  allKnownSpecs(options?: {
    includeOrphans?: boolean;
    includeNonCanonical?: boolean;
  }): IndexableModuleSpec[] {
    const includeOrphans = options?.includeOrphans ?? false;
    const includeNonCanonical = options?.includeNonCanonical ?? false;

    return [...this.mergedMap.values()]
      .filter((spec) => {
        // orphan 过滤
        if (!includeOrphans && this.orphans.has(spec.outputPath)) {
          return false;
        }

        // sourceKind 身份过滤（从 frontmatter 中读取，缺失默认为 canonical）
        if (!includeNonCanonical) {
          const sourceKind = getDefaultSourceKind(
            (spec.frontmatter as SpecFrontmatter & { sourceKind?: string }).sourceKind,
          );
          if (sourceKind !== 'canonical') {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => a.outputPath.localeCompare(b.outputPath));
  }

  // ============================================================
  // 视图 2：本次 batch 生成的 spec
  // ============================================================

  /** 仅返回本次运行中新生成的 spec，不含历史缓存。 */
  currentRunSpecs(): ModuleSpec[] {
    return [...this.currentSpecsInput];
  }

  // ============================================================
  // 视图 3：磁盘已有的 spec（不含本次生成的部分）
  // ============================================================

  /**
   * 返回磁盘中存在但本次未重新生成的 spec 摘要。
   * 可按 sourceKind 过滤。
   */
  storedOnlySpecs(options?: {
    sourceKind?: SpecSourceKind;
  }): StoredModuleSpecSummary[] {
    return this.storedSpecsInput.filter((storedSpec) => {
      // 排除本次已生成的路径（outputPath 规范化后已在 currentSpecPaths 中）
      if (this.currentSpecPaths.has(storedSpec.outputPath)) {
        return false;
      }

      // 按 sourceKind 过滤（若有）
      if (options?.sourceKind !== undefined) {
        const actualKind = getDefaultSourceKind(
          (storedSpec as StoredModuleSpecSummary & { sourceKind?: string }).sourceKind,
        );
        if (actualKind !== options.sourceKind) {
          return false;
        }
      }

      return true;
    });
  }

  // ============================================================
  // 视图 4：orphan spec（源文件已不存在的磁盘 spec）
  // ============================================================

  /** 返回磁盘上存在但对应源文件已不存在的 spec 摘要列表。 */
  orphanSpecs(): StoredModuleSpecSummary[] {
    return this.storedSpecsInput.filter((storedSpec) =>
      this.orphans.has(storedSpec.outputPath),
    );
  }

  // ============================================================
  // 辅助方法：转为 buildDocGraph 所需的输入参数
  // ============================================================

  /**
   * 替代原来直接传 collectedModuleSpecs + existingStoredSpecs 的调用方式。
   * currentRunSpecs → moduleSpecs（标记 currentRun: true）
   * storedSpecs（非本次生成，已过滤 orphan）→ existingSpecs
   */
  asDocGraphInput(): {
    moduleSpecs: ModuleSpec[];
    existingSpecs: ExistingSpecDocument[];
  } {
    // existingSpecs：仅包含 canonical + 非 orphan 的存储 spec，且不含本次生成的（避免重复）
    const existingSpecs: ExistingSpecDocument[] = this.storedSpecsInput
      .filter((storedSpec) => {
        // 排除 orphan
        if (this.orphans.has(storedSpec.outputPath)) {
          return false;
        }
        // 排除本次已生成（doc-graph-builder 会从 moduleSpecs 中取，不需要再放进 existingSpecs）
        if (this.currentSpecPaths.has(storedSpec.outputPath)) {
          return false;
        }
        // 排除 bundle_copy / derived（docGraph 只处理 canonical spec）
        const sourceKind = getDefaultSourceKind(
          (storedSpec as StoredModuleSpecSummary & { sourceKind?: string }).sourceKind,
        );
        if (sourceKind !== 'canonical') {
          return false;
        }
        return true;
      })
      .map((storedSpec) => ({
        specPath: storedSpec.specPath,
        sourceTarget: storedSpec.sourceTarget,
        relatedFiles: storedSpec.relatedFiles,
        linked: storedSpec.linked,
        confidence: storedSpec.confidence,
      } satisfies ExistingSpecDocument));

    return {
      moduleSpecs: this.currentSpecsInput,
      existingSpecs,
    };
  }

  // ============================================================
  // 辅助方法：canonical spec 总数（排除 orphan）
  // ============================================================

  /**
   * 所有已知 canonical spec 的总数（排除 orphan）。
   * 等价于 allKnownSpecs().length，但语义更明确。
   */
  totalKnownCount(): number {
    return this.allKnownSpecs().length;
  }
}
