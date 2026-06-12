/**
 * DocGraphBuilder
 * 汇总当前批量生成的 ModuleSpec、既有 spec 文件以及文件级依赖图，
 * 产出源码 -> spec -> 交叉引用 -> 缺口的统一图谱。
 *
 * schema v2.0 集成（F4）：
 * - anchorDocToCode()：将 design-doc 与代码节点的语义边写入 GraphJSON.links
 * - tokenUsage 汇总记录供调用方（如 BudgetGate）审计
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ModuleGraph } from '../../knowledge-graph/module-derivation.js';
import type { ModuleSpec } from '../../models/module-spec.js';
import type { GraphNode, GraphEdge, Hyperedge } from '../graph/graph-types.js';
import type { EmbeddingProvider, EmbeddingTokenUsage } from '../anchoring/embedding-provider.js';
import { anchorDocToCode } from '../anchoring/index.js';
import type { DocChunk } from '../anchoring/chunker.js';
import { extractHyperedges } from '../hyperedges/index.js';

export const MODULE_SPEC_ANCHOR_ID = 'module-spec';
export const CROSS_REFERENCE_MARKER_PREFIX = '<!-- cross-reference-index: auto';

export interface ExistingSpecDocument {
  specPath: string;
  sourceTarget: string;
  relatedFiles: string[];
  linked: boolean;
  confidence?: 'high' | 'medium' | 'low';
}

export interface StoredModuleSpecSummary extends ExistingSpecDocument {
  version?: string;
  skeletonHash?: string;
  language?: string;
  crossLanguageRefs?: string[];
  intentSummary: string;
  outputPath: string;
  /** spec 身份类型；缺失时视为 'canonical' */
  sourceKind?: 'canonical' | 'derived' | 'bundle_copy';
  /** 派生来源 spec 的路径；canonical 时为 null 或 undefined */
  derivedFrom?: string | null;
  /** 生成本 spec 时的批处理模式（Bug 142）；旧 spec 缺失时为 undefined */
  generatedByMode?: 'full' | 'reading' | 'code-only';
  /**
   * 增量缓存 key（Feature 182）；仅同目录多语言拆分组的 spec 写入（`${sourceTarget}::${language}`），
   * 单语言目录与旧 spec 缺失。查询侧一律 `stored.sourceTargetKey ?? stored.sourceTarget`。
   * 注意：sourceTarget 自身保持纯路径，本字段独立承载带语言后缀的 cache key。
   */
  sourceTargetKey?: string;
}

/**
 * F175 FR-017/EC-009：判定一个 spec 是否为 batch 自身生成的产物（孤儿删除的 ownership 必要条件）。
 *
 * 必须用 `generatedByMode`（runBatch 写入）而非 `generatedBy`——后者对所有 spectra 生成的 spec
 * （含 `spectra generate` 单文件产物）都写入，会把非 batch 产物误判为 batch 产物。
 */
export function isBatchGenerated(summary: StoredModuleSpecSummary): boolean {
  return summary.generatedByMode != null;
}

export interface DocGraphSpecNode {
  specPath: string;
  sourceTarget: string;
  relatedFiles: string[];
  linked: boolean;
  confidence?: 'high' | 'medium' | 'low';
  currentRun: boolean;
}

export interface DocGraphSourceToSpec {
  sourcePath: string;
  specPath: string;
  sourceTarget: string;
  matchType: 'source-target' | 'related-file';
}

export interface DocGraphReferenceSample {
  fromSource: string;
  toSource: string;
}

export interface DocGraphReference {
  kind: 'same-module' | 'cross-module';
  fromSpecPath: string;
  toSpecPath: string;
  fromSourceTarget: string;
  toSourceTarget: string;
  evidenceCount: number;
  evidenceSamples: DocGraphReferenceSample[];
}

export interface DocGraphMissingSpec {
  sourcePath: string;
  reason: 'no-spec-owner';
}

export interface DocGraphUnlinkedSpec {
  specPath: string;
  sourceTarget: string;
}

export interface DocGraph {
  projectRoot: string;
  generatedAt: string;
  specs: DocGraphSpecNode[];
  sourceToSpec: DocGraphSourceToSpec[];
  references: DocGraphReference[];
  missingSpecs: DocGraphMissingSpec[];
  unlinkedSpecs: DocGraphUnlinkedSpec[];
}

export interface BuildDocGraphOptions {
  projectRoot: string;
  dependencyGraph: ModuleGraph;
  moduleSpecs: ModuleSpec[];
  existingSpecs?: ExistingSpecDocument[];
}

/**
 * 扫描输出目录下的既有 *.spec.md，仅提取 044 所需最小元数据。
 */
export function scanExistingSpecDocuments(
  specsDir: string,
  projectRoot: string,
): ExistingSpecDocument[] {
  return scanStoredModuleSpecs(specsDir, projectRoot)
    .map((summary) => ({
      specPath: summary.specPath,
      sourceTarget: summary.sourceTarget,
      relatedFiles: summary.relatedFiles,
      linked: summary.linked,
      confidence: summary.confidence,
    }))
    .sort((a, b) => a.specPath.localeCompare(b.specPath));
}

export function scanStoredModuleSpecs(
  specsDir: string,
  projectRoot: string,
): StoredModuleSpecSummary[] {
  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const specFiles: string[] = [];
  walkSpecFiles(specsDir, specFiles);

  return specFiles
    .flatMap((filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const metadata = extractStoredModuleSpecSummary(content);
      if (!metadata) {
        return [];
      }

      // bundle_copy / derived 的副本不参与 graph 构建；
      // 缺失 sourceKind 字段的历史 spec 视为 canonical（向后兼容）
      const sourceKind = metadata.sourceKind;
      if (sourceKind === 'bundle_copy' || sourceKind === 'derived') {
        return [];
      }

      const document: StoredModuleSpecSummary = {
        specPath: normalizeProjectPath(filePath, projectRoot),
        sourceTarget: normalizeProjectPath(metadata.sourceTarget, projectRoot),
        relatedFiles: metadata.relatedFiles.map((item) => normalizeProjectPath(item, projectRoot)),
        linked: content.includes(CROSS_REFERENCE_MARKER_PREFIX),
        confidence: metadata.confidence,
        version: metadata.version,
        skeletonHash: metadata.skeletonHash,
        language: metadata.language,
        crossLanguageRefs: metadata.crossLanguageRefs?.map(
          (item) => normalizeProjectPath(item, projectRoot),
        ),
        intentSummary: metadata.intentSummary,
        outputPath: normalizeProjectPath(filePath, projectRoot),
        sourceKind: metadata.sourceKind,
        derivedFrom: metadata.derivedFrom,
        generatedByMode: metadata.generatedByMode,
        // Feature 182：cache key 是字面 key（可能含 `::language` 后缀），非路径，不归一化
        sourceTargetKey: metadata.sourceTargetKey,
      };
      return [document];
    })
    .sort((a, b) => a.specPath.localeCompare(b.specPath));
}

/**
 * 构建统一 DocGraph。
 */
export function buildDocGraph(options: BuildDocGraphOptions): DocGraph {
  const { projectRoot, dependencyGraph } = options;
  const currentSpecs = options.moduleSpecs.map((moduleSpec) => ({
    specPath: normalizeProjectPath(moduleSpec.outputPath, projectRoot),
    sourceTarget: normalizeProjectPath(moduleSpec.frontmatter.sourceTarget, projectRoot),
    relatedFiles: dedupePaths(
      moduleSpec.frontmatter.relatedFiles.map((item) => normalizeProjectPath(item, projectRoot)),
    ),
    linked: true,
    confidence: moduleSpec.frontmatter.confidence,
    currentRun: true,
  } satisfies DocGraphSpecNode));

  const specMap = new Map<string, DocGraphSpecNode>();
  for (const spec of options.existingSpecs ?? []) {
    specMap.set(spec.specPath, {
      ...spec,
      relatedFiles: dedupePaths(spec.relatedFiles),
      currentRun: false,
    });
  }
  for (const spec of currentSpecs) {
    specMap.set(spec.specPath, spec);
  }

  const specs = [...specMap.values()].sort((a, b) => a.specPath.localeCompare(b.specPath));

  const sourceToSpec: DocGraphSourceToSpec[] = [];
  const sourceToSpecKey = new Set<string>();
  for (const spec of specs) {
    pushSourceToSpec(
      sourceToSpec,
      sourceToSpecKey,
      spec.sourceTarget,
      spec.specPath,
      spec.sourceTarget,
      'source-target',
    );
    for (const relatedFile of spec.relatedFiles) {
      pushSourceToSpec(
        sourceToSpec,
        sourceToSpecKey,
        relatedFile,
        spec.specPath,
        spec.sourceTarget,
        'related-file',
      );
    }
  }

  const references = buildReferenceList(specs, dependencyGraph);
  const missingSpecs = buildMissingSpecList(specs, dependencyGraph);
  const unlinkedSpecs = specs
    .filter((spec) => !spec.currentRun && !spec.linked)
    .map((spec) => ({
      specPath: spec.specPath,
      sourceTarget: spec.sourceTarget,
    }))
    .sort((a, b) => a.specPath.localeCompare(b.specPath));

  return {
    projectRoot,
    generatedAt: new Date().toISOString(),
    specs,
    sourceToSpec: sourceToSpec.sort((a, b) => {
      const left = `${a.sourcePath}:${a.specPath}:${a.matchType}`;
      const right = `${b.sourcePath}:${b.specPath}:${b.matchType}`;
      return left.localeCompare(right);
    }),
    references,
    missingSpecs,
    unlinkedSpecs,
  };
}

function buildReferenceList(
  specs: DocGraphSpecNode[],
  dependencyGraph: ModuleGraph,
): DocGraphReference[] {
  const aggregated = new Map<string, DocGraphReference>();

  for (const edge of dependencyGraph.edges) {
    const fromSpec = resolveSpecForSource(edge.from, specs);
    const toSpec = resolveSpecForSource(edge.to, specs);
    if (!fromSpec || !toSpec) {
      continue;
    }

    const kind = fromSpec.specPath === toSpec.specPath ? 'same-module' : 'cross-module';
    const key = `${kind}:${fromSpec.specPath}:${toSpec.specPath}`;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        kind,
        fromSpecPath: fromSpec.specPath,
        toSpecPath: toSpec.specPath,
        fromSourceTarget: fromSpec.sourceTarget,
        toSourceTarget: toSpec.sourceTarget,
        evidenceCount: 0,
        evidenceSamples: [],
      });
    }

    const entry = aggregated.get(key)!;
    entry.evidenceCount += 1;
    const duplicate = entry.evidenceSamples.some(
      (sample) => sample.fromSource === edge.from && sample.toSource === edge.to,
    );
    if (!duplicate && entry.evidenceSamples.length < 5) {
      entry.evidenceSamples.push({
        fromSource: edge.from,
        toSource: edge.to,
      });
    }
  }

  return [...aggregated.values()].sort((left, right) => {
    if (right.evidenceCount !== left.evidenceCount) {
      return right.evidenceCount - left.evidenceCount;
    }
    return `${left.fromSpecPath}:${left.toSpecPath}`.localeCompare(
      `${right.fromSpecPath}:${right.toSpecPath}`,
    );
  });
}

function buildMissingSpecList(
  specs: DocGraphSpecNode[],
  dependencyGraph: ModuleGraph,
): DocGraphMissingSpec[] {
  const missing = new Set<string>();

  for (const node of dependencyGraph.modules) {
    if (!resolveSpecForSource(node.source, specs)) {
      missing.add(node.source);
    }
  }

  return [...missing]
    .sort((a, b) => a.localeCompare(b))
    .map((sourcePath) => ({
      sourcePath,
      reason: 'no-spec-owner' as const,
    }));
}

export function resolveSpecForSource(
  sourcePath: string,
  specs: DocGraphSpecNode[],
): DocGraphSpecNode | undefined {
  let bestMatch: { spec: DocGraphSpecNode; score: number } | undefined;

  for (const spec of specs) {
    const exactSourceTarget = spec.sourceTarget === sourcePath;
    const exactRelatedFile = spec.relatedFiles.includes(sourcePath);
    const prefixMatch = sourcePath.startsWith(`${spec.sourceTarget}/`);
    if (!exactSourceTarget && !exactRelatedFile && !prefixMatch) {
      continue;
    }

    let score = spec.sourceTarget.length;
    if (prefixMatch) score += 1_000;
    if (exactRelatedFile) score += 2_000;
    if (exactSourceTarget) score += 3_000;
    if (spec.currentRun) score += 10;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { spec, score };
    }
  }

  return bestMatch?.spec;
}

function pushSourceToSpec(
  target: DocGraphSourceToSpec[],
  seen: Set<string>,
  sourcePath: string,
  specPath: string,
  sourceTarget: string,
  matchType: 'source-target' | 'related-file',
): void {
  const key = `${sourcePath}:${specPath}:${matchType}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push({
    sourcePath,
    specPath,
    sourceTarget,
    matchType,
  });
}

function extractModuleSpecMetadata(content: string): {
  sourceTarget: string;
  relatedFiles: string[];
  confidence?: 'high' | 'medium' | 'low';
} | null {
  const summary = extractStoredModuleSpecSummary(content);
  if (!summary) {
    return null;
  }

  return {
    sourceTarget: summary.sourceTarget,
    relatedFiles: summary.relatedFiles,
    confidence: summary.confidence,
  };
}

function extractStoredModuleSpecSummary(content: string): {
  sourceTarget: string;
  relatedFiles: string[];
  confidence?: 'high' | 'medium' | 'low';
  version?: string;
  skeletonHash?: string;
  language?: string;
  crossLanguageRefs?: string[];
  sourceKind?: 'canonical' | 'derived' | 'bundle_copy';
  derivedFrom?: string | null;
  generatedByMode?: 'full' | 'reading' | 'code-only';
  sourceTargetKey?: string;
  intentSummary: string;
} | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(content);
  if (!match?.[1]) {
    return null;
  }

  const lines = match[1].split(/\r?\n/);
  let typeValue: string | undefined;
  let sourceTarget: string | undefined;
  let version: string | undefined;
  let confidence: 'high' | 'medium' | 'low' | undefined;
  let skeletonHash: string | undefined;
  let language: string | undefined;
  let sourceKind: 'canonical' | 'derived' | 'bundle_copy' | undefined;
  let derivedFrom: string | null | undefined;
  let generatedByMode: 'full' | 'reading' | 'code-only' | undefined;
  let sourceTargetKey: string | undefined;
  const relatedFiles: string[] = [];
  const crossLanguageRefs: string[] = [];
  let inRelatedFiles = false;
  let inCrossLanguageRefs = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('type:')) {
      typeValue = stripYamlScalar(line.slice('type:'.length).trim());
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('version:')) {
      version = stripYamlScalar(line.slice('version:'.length).trim());
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('sourceTargetKey:')) {
      // Feature 182：cache key（可能含 `::language` 后缀），独立于纯路径 sourceTarget
      sourceTargetKey = stripYamlScalar(line.slice('sourceTargetKey:'.length).trim());
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('sourceTarget:')) {
      sourceTarget = stripYamlScalar(line.slice('sourceTarget:'.length).trim());
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('confidence:')) {
      const parsed = stripYamlScalar(line.slice('confidence:'.length).trim());
      if (parsed === 'high' || parsed === 'medium' || parsed === 'low') {
        confidence = parsed;
      }
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('skeletonHash:')) {
      skeletonHash = stripYamlScalar(line.slice('skeletonHash:'.length).trim());
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('language:')) {
      language = stripYamlScalar(line.slice('language:'.length).trim());
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('sourceKind:')) {
      const parsed = stripYamlScalar(line.slice('sourceKind:'.length).trim());
      if (parsed === 'canonical' || parsed === 'derived' || parsed === 'bundle_copy') {
        sourceKind = parsed;
      }
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('derivedFrom:')) {
      const val = stripYamlScalar(line.slice('derivedFrom:'.length).trim());
      derivedFrom = val === 'null' || val === '~' || val === '' ? null : val;
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line.startsWith('generatedByMode:')) {
      const parsed = stripYamlScalar(line.slice('generatedByMode:'.length).trim());
      if (parsed === 'full' || parsed === 'reading' || parsed === 'code-only') {
        generatedByMode = parsed;
      }
      inRelatedFiles = false;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line === 'relatedFiles:') {
      inRelatedFiles = true;
      inCrossLanguageRefs = false;
      continue;
    }

    if (line === 'crossLanguageRefs:') {
      inCrossLanguageRefs = true;
      inRelatedFiles = false;
      continue;
    }

    if (inRelatedFiles) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        relatedFiles.push(stripYamlScalar(trimmed.slice(2).trim()));
        continue;
      }
      inRelatedFiles = false;
    }

    if (inCrossLanguageRefs) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        crossLanguageRefs.push(stripYamlScalar(trimmed.slice(2).trim()));
        continue;
      }
      inCrossLanguageRefs = false;
    }
  }

  if (typeValue !== 'module-spec' || !sourceTarget) {
    return null;
  }

  const intentSummary = extractIntentSummary(content, sourceTarget);

  return {
    sourceTarget,
    relatedFiles,
    confidence,
    version,
    skeletonHash,
    language,
    crossLanguageRefs: crossLanguageRefs.length > 0 ? crossLanguageRefs : undefined,
    sourceKind,
    derivedFrom,
    generatedByMode,
    sourceTargetKey,
    intentSummary,
  };
}

function extractIntentSummary(content: string, sourceTarget: string): string {
  const match = /^##\s+1\.\s+意图\r?\n([\s\S]*?)(?=^##\s+\d+\.|\s*$)/m.exec(content);
  if (!match?.[1]) {
    return sourceTarget;
  }

  const firstMeaningfulLine = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstMeaningfulLine ?? sourceTarget;
}

function stripYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function walkSpecFiles(dir: string, results: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSpecFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.spec.md')) {
      results.push(fullPath);
    }
  }
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function normalizeProjectPath(inputPath: string, projectRoot: string): string {
  const relative = path.isAbsolute(inputPath)
    ? path.relative(projectRoot, inputPath)
    : inputPath;
  return relative.split(path.sep).join('/');
}

// ============================================================
// schema v2.0 — anchorDocToCode 集成接口（F4 Commit 2）
// ============================================================

/**
 * anchorDocToCode 集成选项
 * 供 doc-graph-builder 的调用方传入，驱动语义锚定链路
 */
export interface AnchorIntegrationOptions {
  /** Markdown 文档文件绝对路径列表 */
  markdownFiles: string[];
  /** 图谱中的代码节点列表 */
  graphNodes: GraphNode[];
  /** EmbeddingProvider 实例（Local 或 OpenAI） */
  provider: EmbeddingProvider;
  /** 相似度阈值（默认 0.75） */
  threshold?: number;
  /** evidenceText 最大字符数（默认 200） */
  maxEvidenceLength?: number;
}

/**
 * anchorDocToCode 集成结果
 */
export interface AnchorIntegrationResult {
  /** 生成的语义边（追加到 GraphJSON.links） */
  semanticEdges: GraphEdge[];
  /**
   * 所有 embedding 调用的 token 使用记录
   * 格式与 BudgetGate F1 的 BudgetGateAttempt 兼容（含 llmModel + durationMs）
   */
  tokenUsage: EmbeddingTokenUsage[];
}

/**
 * 在 doc-graph-builder 流程中调用 anchorDocToCode，
 * 将语义边追加到图谱 links 数组。
 *
 * - 零 markdownFiles 时直接返回空结果（FR-015 降级）
 * - tokenUsage 汇总记录供调用方审计（AC-011）
 *
 * @param projectRoot 项目根目录（绝对路径）
 * @param anchorOptions 锚定选项
 */
export async function runAnchorIntegration(
  projectRoot: string,
  anchorOptions: AnchorIntegrationOptions,
): Promise<AnchorIntegrationResult> {
  const result = await anchorDocToCode({
    projectRoot,
    markdownFiles: anchorOptions.markdownFiles,
    graphNodes: anchorOptions.graphNodes,
    provider: anchorOptions.provider,
    threshold: anchorOptions.threshold,
    maxEvidenceLength: anchorOptions.maxEvidenceLength,
  });

  return {
    semanticEdges: result.edges,
    tokenUsage: result.tokenUsage,
  };
}

// ============================================================
// schema v2.0 — hyperedge 集成接口（F4 Commit 4 T032）
// ============================================================

/**
 * hyperedge 集成选项
 *
 * feature flag 架构（analyze F06）：
 * - hyperedgesEnabled 由 caller 从 SPECTRA_HYPEREDGES_ENABLED env + --hyperedges CLI 合并后传入
 * - 此处不读取 process.env，遵循"env 读取在 CLI 层"的约定
 */
export interface HyperedgeIntegrationOptions {
  /**
   * 是否启用 hyperedge 提取
   * 由 CLI 层面从 SPECTRA_HYPEREDGES_ENABLED env 和 --hyperedges CLI flag 合并后传入
   * 如未提供则默认 false（功能默认关闭）
   */
  hyperedgesEnabled?: boolean;
  /** 图谱代码节点列表（用于 prompt 构造 + 语义校验） */
  graphNodes: GraphNode[];
  /** 文档切片列表（来自 chunkMarkdownFiles） */
  docChunks: DocChunk[];
  /** 可选项目摘要 */
  projectSummary?: string;
  /** LLM 模型 ID，默认 claude-haiku-4-5-20251001 */
  model?: string;
}

/**
 * hyperedge 集成结果
 */
export interface HyperedgeIntegrationResult {
  /** 提取并通过校验的超边列表（追加到 GraphJSON.hyperedges） */
  hyperedges: Hyperedge[];
  /** LLM 调用的 token 使用记录 */
  tokenUsage: EmbeddingTokenUsage[];
}

/**
 * 在 doc-graph-builder 流程中调用 extractHyperedges，
 * 将超边附加到图谱 hyperedges 数组。
 *
 * - feature flag 关闭时直接返回空结果（FR-017 feature flag 保护）
 * - docChunks 为空时直接返回空结果（FR-015 降级）
 * - tokenUsage 汇总记录供调用方审计（NFR-003）
 *
 * **Feature 140 T29 — MapReduce 接入**：
 * 当 docChunks 总 token 数超过单次 LLM call 容量（默认 50k）时，自动通过
 * `clusterDispatch`（来自 `src/panoramic/cluster-orchestrator.ts`）拆分为多批，
 * 每批独立调用 extractHyperedges（Map），最后程序化去重合并（Reduce by node-set hash）。
 *
 * 触发条件：docChunks 总 token > tokenBudget（50k）。小项目（README + 几份 docs）
 * 不会触发拆分，行为与原单次调用完全一致（向后兼容）。
 *
 * @param options HyperedgeIntegrationOptions
 */
export async function runHyperedgeIntegration(
  options: HyperedgeIntegrationOptions,
): Promise<HyperedgeIntegrationResult> {
  const enabled = options.hyperedgesEnabled ?? false;

  // 若未开启，提前返回空结果（不创建 Anthropic 客户端）
  if (!enabled) {
    return { hyperedges: [], tokenUsage: [] };
  }

  // docChunks 为空 → 提前返回（避免无意义 LLM 调用）
  if (options.docChunks.length === 0) {
    return { hyperedges: [], tokenUsage: [] };
  }

  // 创建 Anthropic SDK 客户端（仅在 flag 开启时才实例化）
  const anthropicClient = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
  });

  // Feature 140 T29 — 通过 cluster orchestrator 包装 extractHyperedges
  // 让 docChunks 在超 token 预算时自动 FFD 装箱拆分，每批独立 Map call，
  // 程序化 Reduce 按 node-set 哈希去重。
  const { clusterDispatch } = await import('../cluster-orchestrator.js');

  type MapOutput = {
    hyperedges: Hyperedge[];
    usage: EmbeddingTokenUsage[];
  };

  const dispatchResult = await clusterDispatch<DocChunk, MapOutput, MapOutput>({
    inputs: options.docChunks,
    clusterStrategy: { kind: 'single' }, // hyperedge 不需要语义聚类，按 token 装箱足够
    sharedHeader: async () => options.projectSummary ?? '',
    tokenBudget: {
      // 50k chunks + 10k shared header = 60k total，留余地避免 prompt 超限
      totalBudget: 60_000,
      sharedHeaderBudget: 10_000,
      // 用 DocChunk 自带 tokenCount（chunker 已估算），无需重新计算
      estimateInputTokens: (input) => (input as DocChunk).tokenCount,
    },
    map: {
      fn: async (chunks): Promise<{ output: MapOutput; telemetry: import('../cluster-orchestrator.js').CallTelemetry }> => {
        const startMs = Date.now();
        const result = await extractHyperedges({
          enabled: true,
          codeNodes: options.graphNodes,
          docChunks: chunks,
          ...(options.projectSummary !== undefined ? { projectSummary: options.projectSummary } : {}),
          anthropicClient,
          ...(options.model !== undefined ? { model: options.model } : {}),
        });
        const totalInput = result.usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0);
        const totalOutput = result.usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0);
        return {
          output: { hyperedges: result.hyperedges, usage: result.usage },
          telemetry: {
            inputTokens: totalInput,
            outputTokens: totalOutput,
            durationMs: Date.now() - startMs,
            modelId: options.model ?? 'claude-haiku-4-5-20251001',
          },
        };
      },
      maxConcurrency: 4,
    },
    reduce: {
      fn: async (mapOutputs): Promise<{ output: MapOutput; telemetry: import('../cluster-orchestrator.js').CallTelemetry }> => {
        const startMs = Date.now();
        // 程序化去重：按 sorted nodes 哈希聚合，保留 rationale 最长的（更高语义价值）
        //
        // **spec 偏离声明**（Feature 140 T29）：
        // spec 写"Reduce fn：单次去重合并（by node-set 相似度，sonnet 即可）"，
        // "sonnet 即可" 暗示 LLM 语义去重。本实现选择程序化 exact-match dedup
        // 的理由：
        // (1) 节点集合是结构化数据（已 normalize 的字符串数组），exact-match 在多数
        //     场景已足够；(2) hyperedge 在每 batch 最多 10 条，跨 batch 总数典型 <50，
        //     LLM dedup 成本/收益比低；(3) 程序化 dedup 是确定性的，避免 Reduce 阶段
        //     LLM 失败导致整个 hyperedge pipeline fail-closed 的级联风险。
        //
        // **已知限制**：节点集合近似（如 src/auth.ts vs src/Auth.ts 大小写差异）但
        // 不完全相同的语义重复 hyperedge 不会被合并。此情况罕见（chunker 输出节点 ID
        // 是稳定的），生产环境如果出现可以二期通过 sonnet rerank 二轮 dedup 处理。
        // 详见 specs/140-spectra-doc-pipeline-quality/verification/ 待补的 Step 3 偏离记录。
        const dedupMap = new Map<string, Hyperedge>();
        const aggregatedUsage: EmbeddingTokenUsage[] = [];
        for (const mo of mapOutputs) {
          aggregatedUsage.push(...mo.usage);
          for (const h of mo.hyperedges) {
            const key = [...h.nodes].sort().join('|');
            const existing = dedupMap.get(key);
            if (!existing || h.rationale.length > existing.rationale.length) {
              dedupMap.set(key, h);
            }
          }
        }
        return {
          output: { hyperedges: [...dedupMap.values()], usage: aggregatedUsage },
          telemetry: {
            inputTokens: 0, // 程序化 reduce，无 LLM
            outputTokens: 0,
            durationMs: Date.now() - startMs,
            modelId: 'programmatic-dedup',
          },
        };
      },
    },
  });

  // fail-closed: < 50% Map 成功 OR Reduce 失败
  if (dispatchResult.finalOutput === null) {
    return { hyperedges: [], tokenUsage: [] };
  }

  return {
    hyperedges: dispatchResult.finalOutput.hyperedges,
    tokenUsage: dispatchResult.finalOutput.usage,
  };
}
