/**
 * DeltaRegenerator
 * 基于当前源码骨架哈希、既有 module spec 摘要和依赖图，推导增量重生成计划。
 */
import { computeModuleSkeletonHash } from '../core/skeleton-hash.js';
import type { ModuleGraph } from '../knowledge-graph/module-derivation.js';
import {
  buildDocGraph,
  resolveSpecForSource,
  type StoredModuleSpecSummary,
} from '../panoramic/builders/doc-graph-builder.js';
import { loadTemplate } from '../panoramic/utils/template-loader.js';
import type { ModuleGroup } from './module-grouper.js';
import { buildSpecCacheKey, normalizeProjectPath, resolveSourceTarget } from './regen-plan.js';

const ROOT_MODULE_RE = /^root(?:--.+)?$/;

export type DeltaChangeReason =
  | 'missing-spec'
  | 'metadata-missing'
  | 'skeleton-changed'
  | 'dependency-propagation'
  | 'mode-changed';

export interface DeltaTargetState {
  sourceTarget: string;
  sourceFiles: string[];
  currentHash?: string;
  previousHash?: string;
  reason: DeltaChangeReason;
  impactedBy: string[];
}

export interface DeltaReport {
  title: string;
  generatedAt: string;
  projectRoot: string;
  mode: 'incremental' | 'full';
  totalTargets: number;
  regenerateTargets: string[];
  directChanges: DeltaTargetState[];
  propagatedChanges: DeltaTargetState[];
  unchangedTargets: string[];
  fallbackReason?: string;
}

export interface DeltaRegeneratorOptions {
  projectRoot: string;
  dependencyGraph: ModuleGraph;
  moduleGroups: ModuleGroup[];
  storedSpecs: StoredModuleSpecSummary[];
  /**
   * 当前批处理的有效模式（Bug 142）。
   * 传入时启用 mode-aware cache：旧 spec（无 generatedByMode）或 mode 不匹配时强制 cache miss。
   * 不传入时 mode 检查跳过（向后兼容旧调用方，如不区分模式的纯增量场景）。
   */
  effectiveMode?: 'full' | 'reading' | 'code-only';
}

interface CurrentTargetSnapshot {
  sourceTarget: string;
  sourceFiles: string[];
  currentHash?: string;
  previousHash?: string;
}

export class DeltaRegenerator {
  async plan(options: DeltaRegeneratorOptions): Promise<DeltaReport> {
    const snapshots = await collectCurrentSnapshots(options.projectRoot, options.moduleGroups);
    const generatedAt = new Date().toISOString();

    if (snapshots.length === 0) {
      return {
        title: 'Delta Regeneration Report',
        generatedAt,
        projectRoot: options.projectRoot,
        mode: 'incremental',
        totalTargets: 0,
        regenerateTargets: [],
        directChanges: [],
        propagatedChanges: [],
        unchangedTargets: [],
      };
    }

    if (options.storedSpecs.length === 0) {
      const directChanges = snapshots.map((snapshot) => ({
        sourceTarget: snapshot.sourceTarget,
        sourceFiles: snapshot.sourceFiles,
        currentHash: snapshot.currentHash,
        previousHash: snapshot.previousHash,
        reason: 'missing-spec' as const,
        impactedBy: [],
      }));
      return buildReport({
        generatedAt,
        projectRoot: options.projectRoot,
        mode: 'full',
        directChanges,
        propagatedChanges: [],
        unchangedTargets: [],
        fallbackReason: 'no-existing-specs',
        totalTargets: snapshots.length,
      });
    }

    const docGraph = buildDocGraph({
      projectRoot: options.projectRoot,
      dependencyGraph: options.dependencyGraph,
      moduleSpecs: [],
      existingSpecs: options.storedSpecs,
    });

    const sourceFileToTarget = new Map<string, string>();
    const snapshotsByTarget = new Map<string, CurrentTargetSnapshot>();
    for (const snapshot of snapshots) {
      snapshotsByTarget.set(snapshot.sourceTarget, snapshot);
      for (const sourceFile of snapshot.sourceFiles) {
        sourceFileToTarget.set(sourceFile, snapshot.sourceTarget);
      }
    }

    const directChanges = detectDirectChanges(
      snapshots,
      options.storedSpecs,
      options.effectiveMode,
    );
    if (directChanges.length === 0) {
      return buildReport({
        generatedAt,
        projectRoot: options.projectRoot,
        mode: 'incremental',
        directChanges: [],
        propagatedChanges: [],
        unchangedTargets: snapshots.map((snapshot) => snapshot.sourceTarget).sort((a, b) => a.localeCompare(b)),
        totalTargets: snapshots.length,
      });
    }

    const directTargets = new Set(directChanges.map((entry) => entry.sourceTarget));
    const reverseEdges = buildReverseEdges(options.dependencyGraph);
    const propagationMap = new Map<string, Set<string>>();
    const directSourceFiles = new Set(directChanges.flatMap((entry) => entry.sourceFiles));
    const queue = [...directSourceFiles];
    const visited = new Set(queue);

    while (queue.length > 0) {
      const sourceFile = queue.shift()!;
      for (const dependentFile of reverseEdges.get(sourceFile) ?? []) {
        if (!visited.has(dependentFile)) {
          visited.add(dependentFile);
          queue.push(dependentFile);
        }

        const owner =
          sourceFileToTarget.get(dependentFile)
          ?? resolveSpecForSource(dependentFile, docGraph.specs)?.sourceTarget;
        if (!owner || directTargets.has(owner)) {
          continue;
        }

        if (!propagationMap.has(owner)) {
          propagationMap.set(owner, new Set());
        }

        const impactedBy =
          sourceFileToTarget.get(sourceFile)
          ?? resolveSpecForSource(sourceFile, docGraph.specs)?.sourceTarget;
        if (impactedBy) {
          propagationMap.get(owner)!.add(impactedBy);
        }
      }
    }

    const propagatedChanges: DeltaTargetState[] = [...propagationMap.entries()]
      .map(([sourceTarget, impactedBy]) => {
        const snapshot = snapshotsByTarget.get(sourceTarget);
        return {
          sourceTarget,
          sourceFiles: snapshot?.sourceFiles ?? [],
          currentHash: snapshot?.currentHash,
          previousHash: snapshot?.previousHash,
          reason: 'dependency-propagation' as const,
          impactedBy: [...impactedBy].sort((a, b) => a.localeCompare(b)),
        };
      })
      .sort((a, b) => a.sourceTarget.localeCompare(b.sourceTarget));

    const regenerateTargets = new Set([
      ...directChanges.map((entry) => entry.sourceTarget),
      ...propagatedChanges.map((entry) => entry.sourceTarget),
    ]);

    const unchangedTargets = snapshots
      .map((snapshot) => snapshot.sourceTarget)
      .filter((sourceTarget) => !regenerateTargets.has(sourceTarget))
      .sort((a, b) => a.localeCompare(b));

    return buildReport({
      generatedAt,
      projectRoot: options.projectRoot,
      mode: 'incremental',
      directChanges,
      propagatedChanges,
      unchangedTargets,
      totalTargets: snapshots.length,
    });
  }

  render(report: DeltaReport): string {
    const template = loadTemplate('delta-report.hbs', import.meta.url);
    return template(report);
  }
}

async function collectCurrentSnapshots(
  projectRoot: string,
  moduleGroups: ModuleGroup[],
): Promise<CurrentTargetSnapshot[]> {
  const snapshots: CurrentTargetSnapshot[] = [];

  // FR-019：与 batch-orchestrator:673-684 同口径计算目录冲突集合（单文件模块共享 dirPath 时
  // 走文件级降级），供 resolveSourceTarget 判定 sourceTarget，消除与 processOneModule 的口径错位。
  const dirPathGroupCount = new Map<string, number>();
  for (const group of moduleGroups) {
    if (group.files.length === 1) {
      dirPathGroupCount.set(group.dirPath, (dirPathGroupCount.get(group.dirPath) ?? 0) + 1);
    }
  }
  const conflictingDirPaths = new Set(
    [...dirPathGroupCount.entries()].filter(([, count]) => count > 1).map(([dirPath]) => dirPath),
  );

  for (const group of moduleGroups) {
    if (ROOT_MODULE_RE.test(group.name)) {
      for (const filePath of group.files) {
        const normalizedFile = normalizeProjectPath(filePath);
        snapshots.push({
          // root 模块按文件展开，sourceTarget 维持纯文件路径（不加语言后缀）
          sourceTarget: normalizedFile,
          sourceFiles: [normalizedFile],
          currentHash: await computeModuleSkeletonHash(projectRoot, [filePath]),
        });
      }
      continue;
    }

    snapshots.push({
      // Feature 182：snapshot 的键改为 cache key（languageSplit 组带 `::language` 后缀），
      // 与 batch-orchestrator 的 moduleCacheKey 口径一致，消除同目录多语言组键碰撞。
      sourceTarget: buildSpecCacheKey(resolveSourceTarget(group, conflictingDirPaths, false), group),
      sourceFiles: group.files.map((filePath) => normalizeProjectPath(filePath)).sort((a, b) => a.localeCompare(b)),
      // Feature 182：读侧 hash 改调唯一权威 computeModuleSkeletonHash（code-unit 排序）
      currentHash: await computeModuleSkeletonHash(projectRoot, group.files),
    });
  }

  return snapshots.sort((a, b) => a.sourceTarget.localeCompare(b.sourceTarget));
}

function detectDirectChanges(
  snapshots: CurrentTargetSnapshot[],
  storedSpecs: StoredModuleSpecSummary[],
  effectiveMode?: 'full' | 'reading' | 'code-only',
): DeltaTargetState[] {
  // Feature 182：stored spec 以 cache key 入索引（languageSplit 组带 `::language` 后缀），
  // 与 snapshot.sourceTarget（已是 cache key）口径对齐；旧 spec 无 sourceTargetKey 时回落纯路径。
  const storedByTarget = new Map(storedSpecs.map((spec) => [spec.sourceTargetKey ?? spec.sourceTarget, spec]));

  return snapshots
    .flatMap<DeltaTargetState>((snapshot) => {
      const stored = storedByTarget.get(snapshot.sourceTarget);
      if (!stored) {
        return [{
          sourceTarget: snapshot.sourceTarget,
          sourceFiles: snapshot.sourceFiles,
          currentHash: snapshot.currentHash,
          previousHash: undefined,
          reason: 'missing-spec' as const,
          impactedBy: [],
        }];
      }

      snapshot.previousHash = stored.skeletonHash;

      if (!stored.skeletonHash || !snapshot.currentHash) {
        return [{
          sourceTarget: snapshot.sourceTarget,
          sourceFiles: snapshot.sourceFiles,
          currentHash: snapshot.currentHash,
          previousHash: stored.skeletonHash,
          reason: 'metadata-missing' as const,
          impactedBy: [],
        }];
      }

      if (stored.skeletonHash !== snapshot.currentHash) {
        return [{
          sourceTarget: snapshot.sourceTarget,
          sourceFiles: snapshot.sourceFiles,
          currentHash: snapshot.currentHash,
          previousHash: stored.skeletonHash,
          reason: 'skeleton-changed' as const,
          impactedBy: [],
        }];
      }

      // Bug 142：mode-aware cache 检查（仅当调用方传入 effectiveMode 时启用）。
      // 旧 spec（缺失 generatedByMode）或 mode 不匹配 → 强制 cache miss（安全降级）。
      // 不假设旧 spec 与当前 mode 兼容，宁可多生成一次。
      if (effectiveMode !== undefined) {
        if (!stored.generatedByMode || stored.generatedByMode !== effectiveMode) {
          return [{
            sourceTarget: snapshot.sourceTarget,
            sourceFiles: snapshot.sourceFiles,
            currentHash: snapshot.currentHash,
            previousHash: stored.skeletonHash,
            reason: 'mode-changed' as const,
            impactedBy: [],
          }];
        }
      }

      return [];
    })
    .sort((left, right) => left.sourceTarget.localeCompare(right.sourceTarget));
}

function buildReverseEdges(graph: ModuleGraph): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!reverse.has(edge.to)) {
      reverse.set(edge.to, []);
    }
    reverse.get(edge.to)!.push(edge.from);
  }

  for (const [source, dependents] of reverse) {
    dependents.sort((a, b) => a.localeCompare(b));
    reverse.set(source, [...new Set(dependents)]);
  }

  return reverse;
}

function buildReport(input: {
  generatedAt: string;
  projectRoot: string;
  mode: 'incremental' | 'full';
  directChanges: DeltaTargetState[];
  propagatedChanges: DeltaTargetState[];
  unchangedTargets: string[];
  totalTargets: number;
  fallbackReason?: string;
}): DeltaReport {
  return {
    title: 'Delta Regeneration Report',
    generatedAt: input.generatedAt,
    projectRoot: input.projectRoot,
    mode: input.mode,
    totalTargets: input.totalTargets,
    regenerateTargets: [
      ...input.directChanges.map((entry) => entry.sourceTarget),
      ...input.propagatedChanges.map((entry) => entry.sourceTarget),
    ].sort((a, b) => a.localeCompare(b)),
    directChanges: input.directChanges,
    propagatedChanges: input.propagatedChanges,
    unchangedTargets: input.unchangedTargets,
    fallbackReason: input.fallbackReason,
  };
}
