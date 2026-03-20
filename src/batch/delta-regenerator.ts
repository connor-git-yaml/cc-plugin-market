/**
 * DeltaRegenerator
 * 基于当前源码骨架哈希、既有 module spec 摘要和依赖图，推导增量重生成计划。
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { analyzeFiles } from '../core/ast-analyzer.js';
import type { DependencyGraph } from '../models/dependency-graph.js';
import {
  buildDocGraph,
  resolveSpecForSource,
  type StoredModuleSpecSummary,
} from '../panoramic/doc-graph-builder.js';
import { loadTemplate } from '../panoramic/utils/template-loader.js';
import type { ModuleGroup } from './module-grouper.js';

const ROOT_MODULE_RE = /^root(?:--.+)?$/;

export type DeltaChangeReason =
  | 'missing-spec'
  | 'metadata-missing'
  | 'skeleton-changed'
  | 'dependency-propagation';

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
  dependencyGraph: DependencyGraph;
  moduleGroups: ModuleGroup[];
  storedSpecs: StoredModuleSpecSummary[];
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

    const directChanges = detectDirectChanges(snapshots, options.storedSpecs);
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

  for (const group of moduleGroups) {
    if (ROOT_MODULE_RE.test(group.name)) {
      for (const filePath of group.files) {
        const normalizedFile = normalizeProjectPath(filePath);
        snapshots.push({
          sourceTarget: normalizedFile,
          sourceFiles: [normalizedFile],
          currentHash: await computeSkeletonHash(projectRoot, [filePath]),
        });
      }
      continue;
    }

    snapshots.push({
      sourceTarget: normalizeProjectPath(group.dirPath),
      sourceFiles: group.files.map((filePath) => normalizeProjectPath(filePath)).sort((a, b) => a.localeCompare(b)),
      currentHash: await computeSkeletonHash(projectRoot, group.files),
    });
  }

  return snapshots.sort((a, b) => a.sourceTarget.localeCompare(b.sourceTarget));
}

async function computeSkeletonHash(
  projectRoot: string,
  files: string[],
): Promise<string | undefined> {
  if (files.length === 0) {
    return undefined;
  }

  const analyzed = await analyzeFiles(
    files.map((filePath) => path.join(projectRoot, filePath)),
  );

  if (analyzed.length === 0) {
    return undefined;
  }

  if (analyzed.length === 1) {
    return analyzed[0]?.hash;
  }

  const combinedContent = analyzed
    .slice()
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .map((skeleton) => skeleton.hash)
    .join('');

  return createHash('sha256').update(combinedContent).digest('hex');
}

function detectDirectChanges(
  snapshots: CurrentTargetSnapshot[],
  storedSpecs: StoredModuleSpecSummary[],
): DeltaTargetState[] {
  const storedByTarget = new Map(storedSpecs.map((spec) => [spec.sourceTarget, spec]));

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

      return [];
    })
    .sort((left, right) => left.sourceTarget.localeCompare(right.sourceTarget));
}

function buildReverseEdges(graph: DependencyGraph): Map<string, string[]> {
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

function normalizeProjectPath(inputPath: string): string {
  return inputPath.split(path.sep).join('/');
}
