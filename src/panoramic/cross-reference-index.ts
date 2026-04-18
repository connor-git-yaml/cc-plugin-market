/**
 * CrossReferenceIndex
 * 将 DocGraph 投影为单个 ModuleSpec 可直接渲染的 related spec 索引。
 */
import * as path from 'node:path';
import type {
  CrossReferenceLink,
  ModuleCrossReferenceIndex,
  ModuleSpec,
} from '../models/module-spec.js';
import type { DocGraph, DocGraphReferenceSample, DocGraphSpecNode } from './builders/doc-graph-builder.js';
import { MODULE_SPEC_ANCHOR_ID } from './builders/doc-graph-builder.js';

interface CrossModuleAccumulator {
  targetSpecPath: string;
  targetSourceTarget: string;
  outboundCount: number;
  inboundCount: number;
  samples: DocGraphReferenceSample[];
}

export function buildCrossReferenceIndex(
  moduleSpec: ModuleSpec,
  docGraph: DocGraph,
): ModuleCrossReferenceIndex {
  const currentSpecPath = normalizeProjectPath(moduleSpec.outputPath, docGraph.projectRoot);
  const currentSourceTarget = normalizeProjectPath(
    moduleSpec.frontmatter.sourceTarget,
    docGraph.projectRoot,
  );
  const currentNode = docGraph.specs.find(
    (spec) => spec.specPath === currentSpecPath || spec.sourceTarget === currentSourceTarget,
  );

  if (!currentNode) {
    return {
      generatedAt: docGraph.generatedAt,
      sameModule: [],
      crossModule: [],
    };
  }

  const sameModuleEvidence = docGraph.references
    .filter(
      (reference) => reference.kind === 'same-module'
        && reference.fromSpecPath === currentNode.specPath
        && reference.toSpecPath === currentNode.specPath,
    );

  const sameModule: CrossReferenceLink[] = [];
  if (sameModuleEvidence.length > 0) {
    const evidenceCount = sameModuleEvidence.reduce(
      (sum, item) => sum + item.evidenceCount,
      0,
    );
    const samples = flattenSamples(sameModuleEvidence.flatMap((item) => item.evidenceSamples));
    sameModule.push({
      label: '当前模块内部关联',
      href: `#${MODULE_SPEC_ANCHOR_ID}`,
      targetSpecPath: currentNode.specPath,
      targetSourceTarget: currentNode.sourceTarget,
      kind: 'same-module',
      direction: 'internal',
      evidenceCount,
      summary: summarizeEvidence(evidenceCount, samples),
    });
  }

  const crossModuleMap = new Map<string, CrossModuleAccumulator>();
  for (const reference of docGraph.references) {
    if (reference.kind !== 'cross-module') {
      continue;
    }

    if (reference.fromSpecPath === currentNode.specPath) {
      const entry = getOrCreateCrossModuleAccumulator(
        crossModuleMap,
        reference.toSpecPath,
        reference.toSourceTarget,
      );
      entry.outboundCount += reference.evidenceCount;
      entry.samples.push(...reference.evidenceSamples);
      continue;
    }

    if (reference.toSpecPath === currentNode.specPath) {
      const entry = getOrCreateCrossModuleAccumulator(
        crossModuleMap,
        reference.fromSpecPath,
        reference.fromSourceTarget,
      );
      entry.inboundCount += reference.evidenceCount;
      entry.samples.push(...reference.evidenceSamples);
    }
  }

  // 补充：从 skeleton imports 推断跨模块引用（适用于无相对 import 的项目，如 Python）
  supplementCrossModuleFromSkeletonImports(
    moduleSpec,
    docGraph,
    currentNode,
    crossModuleMap,
  );

  const crossModule = [...crossModuleMap.values()]
    .map((entry) => {
      const evidenceCount = entry.outboundCount + entry.inboundCount;
      const samples = flattenSamples(entry.samples);
      const direction: CrossReferenceLink['direction'] = entry.outboundCount > 0 && entry.inboundCount > 0
        ? 'bidirectional'
        : entry.outboundCount > 0
          ? 'outbound'
          : 'inbound';

      return {
        label: entry.targetSourceTarget,
        href: buildRelativeSpecHref(currentNode.specPath, entry.targetSpecPath),
        targetSpecPath: entry.targetSpecPath,
        targetSourceTarget: entry.targetSourceTarget,
        kind: 'cross-module' as const,
        direction,
        evidenceCount,
        summary: summarizeDirectionalEvidence(
          entry.outboundCount,
          entry.inboundCount,
          samples,
        ),
      };
    })
    .sort((left, right) => {
      if (right.evidenceCount !== left.evidenceCount) {
        return right.evidenceCount - left.evidenceCount;
      }
      return left.label.localeCompare(right.label);
    });

  return {
    generatedAt: docGraph.generatedAt,
    sameModule,
    crossModule,
  };
}

/**
 * 从 skeleton imports 补充跨模块引用
 *
 * 当 docGraph.references 不含引用（如 Python 绝对 import 项目）时，
 * 遍历 skeleton 的 isRelative=false imports，将包名式 specifier 解析为
 * docGraph 中已知的 spec，并增加出站引用计数。
 */
function supplementCrossModuleFromSkeletonImports(
  moduleSpec: ModuleSpec,
  docGraph: DocGraph,
  currentNode: DocGraphSpecNode,
  crossModuleMap: Map<string, CrossModuleAccumulator>,
): void {
  // 预构建已覆盖引用的 Set，将内层查询从 O(references) 降到 O(1)
  const coveredKeys = new Set<string>();
  for (const ref of docGraph.references) {
    if (ref.kind === 'cross-module') {
      coveredKeys.add(`${ref.fromSpecPath}:${ref.toSpecPath}`);
    }
  }

  for (const imp of moduleSpec.baselineSkeleton.imports) {
    // 相对 import 已由 docGraph.references 覆盖
    if (imp.isRelative) continue;

    const targetSpecPath = resolveSpecifierToSpecPath(imp.moduleSpecifier, docGraph.specs);
    if (!targetSpecPath || targetSpecPath === currentNode.specPath) continue;

    // 若 docGraph.references 已包含该跨模块引用，跳过（避免重复计数）
    if (coveredKeys.has(`${currentNode.specPath}:${targetSpecPath}`)) continue;

    const targetSpec = docGraph.specs.find((spec) => spec.specPath === targetSpecPath);
    if (!targetSpec) continue;

    const entry = getOrCreateCrossModuleAccumulator(
      crossModuleMap,
      targetSpecPath,
      targetSpec.sourceTarget,
    );
    entry.outboundCount += 1;
    entry.samples.push({
      fromSource: currentNode.sourceTarget,
      toSource: targetSpec.sourceTarget,
    });
  }
}

/**
 * 将模块标识符（点分包名）解析为 docGraph 中匹配的 spec 路径
 *
 * 优先精确匹配 sourceTarget，其次匹配 specifier 是 sourceTarget 的子路径前缀。
 * 返回最长匹配（最具体的 spec）。
 */
function resolveSpecifierToSpecPath(
  specifier: string,
  specs: DocGraphSpecNode[],
): string | undefined {
  const asPath = specifier.replace(/\./g, '/');

  let bestMatch: { specPath: string; length: number } | undefined;

  for (const spec of specs) {
    // 规范化 sourceTarget：统一分隔符并去掉文件扩展名
    const st = spec.sourceTarget.replace(/\\/g, '/').replace(/\.(py|pyi|ts|tsx|js|jsx|go|java|rs)$/, '');
    if (asPath === st || asPath.startsWith(`${st}/`)) {
      if (!bestMatch || st.length > bestMatch.length) {
        bestMatch = { specPath: spec.specPath, length: st.length };
      }
    }
  }

  return bestMatch?.specPath;
}

function getOrCreateCrossModuleAccumulator(
  index: Map<string, CrossModuleAccumulator>,
  targetSpecPath: string,
  targetSourceTarget: string,
): CrossModuleAccumulator {
  if (!index.has(targetSpecPath)) {
    index.set(targetSpecPath, {
      targetSpecPath,
      targetSourceTarget,
      outboundCount: 0,
      inboundCount: 0,
      samples: [],
    });
  }
  return index.get(targetSpecPath)!;
}

function buildRelativeSpecHref(fromSpecPath: string, toSpecPath: string): string {
  const relative = path.relative(path.dirname(fromSpecPath), toSpecPath);
  const normalized = relative.split(path.sep).join('/');
  return `${normalized}#${MODULE_SPEC_ANCHOR_ID}`;
}

function flattenSamples(samples: DocGraphReferenceSample[]): DocGraphReferenceSample[] {
  const deduped: DocGraphReferenceSample[] = [];
  const seen = new Set<string>();

  for (const sample of samples) {
    const key = `${sample.fromSource}->${sample.toSource}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(sample);
    if (deduped.length >= 3) {
      break;
    }
  }

  return deduped;
}

function summarizeEvidence(
  evidenceCount: number,
  samples: DocGraphReferenceSample[],
): string {
  const sampleText = formatSamples(samples);
  return sampleText.length > 0
    ? `${evidenceCount} 条文件级引用；示例：${sampleText}`
    : `${evidenceCount} 条文件级引用`;
}

function summarizeDirectionalEvidence(
  outboundCount: number,
  inboundCount: number,
  samples: DocGraphReferenceSample[],
): string {
  const sampleText = formatSamples(samples);
  const directionText = `出站 ${outboundCount}，入站 ${inboundCount}`;
  return sampleText.length > 0
    ? `${directionText}；示例：${sampleText}`
    : directionText;
}

function formatSamples(samples: DocGraphReferenceSample[]): string {
  return samples
    .map((sample) => `${sample.fromSource} -> ${sample.toSource}`)
    .join('；');
}

function normalizeProjectPath(inputPath: string, projectRoot: string): string {
  const relative = path.isAbsolute(inputPath)
    ? path.relative(projectRoot, inputPath)
    : inputPath;
  return relative.split(path.sep).join('/');
}
