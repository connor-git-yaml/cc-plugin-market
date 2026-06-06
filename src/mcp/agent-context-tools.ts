/**
 * Feature 155 — Agent-Context MCP Tools (impact / context / detect_changes)
 *
 * 3 个 tool handler，建在 Feature 151 已 ship 的 UnifiedGraph + call-resolver 之上：
 *   - impact: blast radius — 反向 BFS 找受影响 symbols
 *   - context: 360° symbol 视图 — definition + callers + callees + imports + relatedSpec
 *   - detect_changes: git diff → changedSymbols → impact 链
 *
 * 数据流：
 *   getCachedGraphData(projectRoot)  // 来自 graph-tools.ts，含 mtime/size stale 检测
 *     ↓
 *   query-helpers.ts (bfsTraverse / canonicalizeSymbolId / findFuzzyMatches / ...)
 *     ↓
 *   tool handler 输出 JSON envelope
 *
 * 错误处理（FR-050）：统一 envelope `{ isError: true, content: [{type:'text', text: JSON({code, message, hint?, context?})}]}`
 * 错误 code: graph-not-built / symbol-not-found / invalid-symbol-id / invalid-input /
 *           invalid-diff / payload-too-large / git-spawn-failed / git-timeout / internal-error
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GraphEdge, GraphJSON, GraphNode } from '../panoramic/graph/graph-types.js';
import { getCachedGraphData } from './graph-tools.js';
import {
  bfsTraverse,
  canonicalizeSymbolId,
  computeRiskTier,
  findFuzzyMatches,
  findNode,
  moduleFileFromId,
  resolveEdgeConfidence,
  type BfsAffected,
  type BfsDirection,
} from '../knowledge-graph/query-helpers.js';
import {
  buildTopImpactedRanking,
  buildTopRelevantCallers,
  generateNextStepHint,
  safeStderrLog,
  type TopImpacted,
  type TopRelevantCaller,
} from './lib/response-helpers.js';

// ============================================================
// 共享响应原语 + Telemetry（Feature 171 抽到 lib/ 复用，解 C-4 / TELEMETRY-COUPLING）
// ============================================================

import {
  buildErrorResponse,
  buildSuccessResponse,
  type ErrorCode,
  type ToolResult,
} from './lib/tool-response.js';
import { recordAndReturn } from './lib/telemetry.js';

// 向后兼容 re-export：既有 tests/unit/mcp/telemetry.test.ts 从本模块 import 这些符号
export { recordAndReturn, writeTelemetry, type TelemetryEntry } from './lib/telemetry.js';

// ============================================================
// impact tool
// ============================================================

const ImpactInputSchema = {
  target: z.string().describe('symbol id (e.g. "micrograd/engine.py::Value.__add__")'),
  depth: z.number().int().min(0).max(20).optional().describe('BFS depth (default 2, max 5; 超出 clamp)'),
  minConfidence: z.number().min(0).max(1).optional().describe('confidence 阈值 (default 0.65)'),
  direction: z.enum(['upstream', 'downstream', 'both']).optional().describe('BFS 方向 (default upstream)'),
  budget: z.number().int().min(0).max(10000).optional().describe('节点上限 (default 200, max 1000; 超出 clamp)'),
  projectRoot: z.string().optional().describe('default cwd'),
};

interface ImpactArgs {
  target: string;
  depth?: number;
  minConfidence?: number;
  direction?: BfsDirection;
  budget?: number;
  projectRoot?: string;
}

export async function handleImpact(args: ImpactArgs): Promise<ToolResult> {
  // Feature 158 telemetry: 入口采样
  const _telStart = Date.now();
  const _telReqSize = (() => {
    try {
      return JSON.stringify(args).length;
    } catch {
      return 0;
    }
  })();
  try {
    if (typeof args.target !== 'string' || args.target.length === 0) {
      return recordAndReturn('impact', _telStart, _telReqSize, buildErrorResponse('invalid-input', 'target 必填且为非空字符串'));
    }

    const projectRoot = args.projectRoot ?? process.cwd();
    const cached = getCachedGraphData(projectRoot);
    if (cached === null) {
      return recordAndReturn('impact', _telStart, _telReqSize, buildErrorResponse(
        'graph-not-built',
        `graph.json 不存在或加载失败 (projectRoot=${projectRoot})`,
        '请先运行 `spectra batch` 或 `spectra prepare` 生成图谱',
      ));
    }
    const { graphData, graphPath, mtimeMs, sizeBytes } = cached;

    // 入参 clamp（FR-015）— handler 层负责 clamp 并附 warning，不依赖 zod max
    const warnings: string[] = [];
    const reqDepth = args.depth ?? 2;
    const effectiveDepth = Math.min(Math.max(reqDepth, 0), 5);
    if (effectiveDepth !== reqDepth) warnings.push('depth-clamped');
    const reqBudget = args.budget ?? 200;
    const effectiveBudget = Math.min(Math.max(reqBudget, 0), 1000);
    if (effectiveBudget !== reqBudget) warnings.push('budget-clamped');
    const reqMinConf = args.minConfidence ?? 0.65;
    const minConfidence = Math.min(Math.max(reqMinConf, 0), 1);
    if (minConfidence !== reqMinConf) warnings.push('minConfidence-clamped');
    const direction: BfsDirection = args.direction ?? 'upstream';

    // canonicalize symbol id
    const canon = canonicalizeSymbolId(args.target, graphData, { projectRoot });
    if (canon.reason === 'invalid') {
      return recordAndReturn('impact', _telStart, _telReqSize, buildErrorResponse('invalid-symbol-id', `target 含非法字符或格式: ${args.target}`));
    }
    if (canon.reason === 'not-found' || canon.canonicalId === null) {
      const fuzzy = findFuzzyMatches(graphData, args.target, 5);
      return recordAndReturn('impact', _telStart, _telReqSize, buildErrorResponse(
        'symbol-not-found',
        `target 在 graph 中未找到: ${args.target}`,
        '请检查 symbol id 格式或参考 fuzzyMatches 候选',
        { fuzzyMatches: fuzzy },
      ));
    }
    const startId = canon.canonicalId;

    // BFS
    const r = bfsTraverse(graphData, startId, {
      depth: effectiveDepth,
      minConfidence,
      direction,
      budget: effectiveBudget,
      graphPath,
      graphMtimeMs: mtimeMs,
      graphSizeBytes: sizeBytes,
      relations: ['calls'],
    });

    // 合并 warnings
    for (const w of r.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }

    // summary
    const directCallers = r.affected.filter((a) => a.depth === 1).length;
    const transitive = r.affected.length;
    const riskTier = computeRiskTier(directCallers, transitive);

    const data: Record<string, unknown> = {
      affected: r.affected,
      summary: { directCallers, transitive, riskTier },
      effectiveDepth,
      effectiveMinConfidence: minConfidence,
      effectiveBudget,
      effectiveDirection: direction,
    };
    if (warnings.length > 0) data['warnings'] = warnings;

    // F170c enrichment 三路径（plan G 节）：临时变量 + 显式 catch reset 避免 partial fill
    let topImpacted: TopImpacted[];
    let nextStepHint: string;
    let enrichmentDegraded: boolean;
    try {
      const _topImpacted = buildTopImpactedRanking(r.affected, 5);
      const _nextStepHint = generateNextStepHint(
        'impact',
        { topImpacted: _topImpacted, affected: r.affected },
        'success',
      );
      topImpacted = _topImpacted;
      nextStepHint = _nextStepHint;
      enrichmentDegraded = false;
    } catch (e) {
      topImpacted = [];
      nextStepHint = '';
      enrichmentDegraded = true;
      safeStderrLog(`[F170c] impact enrichment degraded: ${String(e)}\n`);
    }
    data['topImpacted'] = topImpacted;
    data['nextStepHint'] = nextStepHint;
    if (enrichmentDegraded) data['_enrichmentDegraded'] = true;

    return recordAndReturn('impact', _telStart, _telReqSize, buildSuccessResponse(data, ['affected']));
  } catch (err) {
    return recordAndReturn('impact', _telStart, _telReqSize, buildErrorResponse(
      'internal-error',
      err instanceof Error ? err.message : String(err),
      undefined,
      { stack: err instanceof Error && err.stack ? err.stack.slice(0, 200) : undefined },
    ));
  }
}

// ============================================================
// context tool
// ============================================================

const ContextInputSchema = {
  symbolId: z.string().describe('symbol id'),
  include: z
    .array(z.enum(['callers', 'callees', 'imports', 'related-spec']))
    .optional()
    .describe('字段子集 (default ["callers","callees","imports"])'),
  projectRoot: z.string().optional(),
};

interface ContextArgs {
  symbolId: string;
  include?: Array<'callers' | 'callees' | 'imports' | 'related-spec'>;
  projectRoot?: string;
}

export async function handleContext(args: ContextArgs): Promise<ToolResult> {
  // Feature 158 telemetry: 入口采样
  const _telStart = Date.now();
  const _telReqSize = (() => {
    try {
      return JSON.stringify(args).length;
    } catch {
      return 0;
    }
  })();
  try {
    if (typeof args.symbolId !== 'string' || args.symbolId.length === 0) {
      return recordAndReturn('context', _telStart, _telReqSize, buildErrorResponse('invalid-input', 'symbolId 必填且为非空字符串'));
    }

    const projectRoot = args.projectRoot ?? process.cwd();
    const cached = getCachedGraphData(projectRoot);
    if (cached === null) {
      return recordAndReturn('context', _telStart, _telReqSize, buildErrorResponse(
        'graph-not-built',
        `graph.json 不存在 (projectRoot=${projectRoot})`,
        '请先运行 `spectra batch` 生成图谱',
      ));
    }
    const { graphData } = cached;

    const include = args.include ?? ['callers', 'callees', 'imports'];

    const canon = canonicalizeSymbolId(args.symbolId, graphData, { projectRoot });
    if (canon.reason === 'invalid') {
      return recordAndReturn('context', _telStart, _telReqSize, buildErrorResponse('invalid-symbol-id', `symbolId 含非法字符: ${args.symbolId}`));
    }
    if (canon.reason === 'not-found' || canon.canonicalId === null) {
      const fuzzy = findFuzzyMatches(graphData, args.symbolId, 5);
      return recordAndReturn('context', _telStart, _telReqSize, buildErrorResponse(
        'symbol-not-found',
        `symbolId 在 graph 中未找到: ${args.symbolId}`,
        '请检查 id 格式或参考 fuzzyMatches 候选',
        { fuzzyMatches: fuzzy },
      ));
    }

    const node = findNode(graphData, canon.canonicalId);
    if (node === null) {
      return recordAndReturn('context', _telStart, _telReqSize, buildErrorResponse('symbol-not-found', `节点对象未找到: ${canon.canonicalId}`));
    }

    const definition = buildDefinition(node);
    const data: Record<string, unknown> = { definition };

    if (include.includes('callers')) {
      data['callers'] = collectNeighbors(graphData, canon.canonicalId, 'inbound', 'calls');
    }
    if (include.includes('callees')) {
      data['callees'] = collectNeighbors(graphData, canon.canonicalId, 'outbound', 'calls');
    }
    if (include.includes('imports')) {
      // imports 来自 module 节点的 outbound depends-on / cross-module
      const moduleId = moduleFileFromId(canon.canonicalId);
      const importEntries = collectNeighbors(graphData, moduleId, 'outbound', 'depends-on').concat(
        collectNeighbors(graphData, moduleId, 'outbound', 'cross-module'),
      );
      // 转换为 import schema
      data['imports'] = importEntries.map((x) => ({
        moduleId: x.id,
        file: moduleFileFromId(x.id),
        confidence: x.confidence,
      }));
    }
    if (include.includes('related-spec')) {
      data['relatedSpec'] = deriveRelatedSpec(canon.canonicalId, projectRoot);
    }

    // F170c enrichment 三路径（plan G 节）
    const callersRaw = (data['callers'] as Array<{ id: string; confidence: number; relation?: string }> | undefined) ?? [];
    let topRelevantCallers: TopRelevantCaller[];
    let nextStepHint: string;
    let enrichmentDegraded: boolean;
    try {
      const _top = buildTopRelevantCallers(callersRaw, 3);
      const _hint = generateNextStepHint(
        'context',
        { definition, callers: callersRaw },
        'success',
      );
      topRelevantCallers = _top;
      nextStepHint = _hint;
      enrichmentDegraded = false;
    } catch (e) {
      topRelevantCallers = [];
      nextStepHint = '';
      enrichmentDegraded = true;
      safeStderrLog(`[F170c] context enrichment degraded: ${String(e)}\n`);
    }
    data['topRelevantCallers'] = topRelevantCallers;
    data['nextStepHint'] = nextStepHint;
    if (enrichmentDegraded) data['_enrichmentDegraded'] = true;

    return recordAndReturn('context', _telStart, _telReqSize, buildSuccessResponse(data, ['callers', 'callees', 'imports']));
  } catch (err) {
    return recordAndReturn('context', _telStart, _telReqSize, buildErrorResponse(
      'internal-error',
      err instanceof Error ? err.message : String(err),
      undefined,
      { stack: err instanceof Error && err.stack ? err.stack.slice(0, 200) : undefined },
    ));
  }
}

function buildDefinition(node: GraphNode): Record<string, unknown> {
  const md = node.metadata;
  const def: Record<string, unknown> = {
    id: node.id,
    file: (md['sourceFile'] as string | undefined) ?? (md['sourcePath'] as string | undefined) ?? moduleFileFromId(node.id),
    kind: node.kind,
    label: node.label,
  };
  const lineRange = md['lineRange'] as { start?: number; end?: number } | undefined;
  if (lineRange) {
    if (typeof lineRange.start === 'number') def['lineStart'] = lineRange.start;
    if (typeof lineRange.end === 'number') def['lineEnd'] = lineRange.end;
  }
  const conf = md['confidence'];
  if (typeof conf === 'string') def['confidence'] = conf;
  return def;
}

function collectNeighbors(
  graphData: Readonly<GraphJSON>,
  nodeId: string,
  direction: 'inbound' | 'outbound',
  relation: string,
): Array<{ id: string; confidence: number; relation: string }> {
  const out: Array<{ id: string; confidence: number; relation: string }> = [];
  for (const link of graphData.links) {
    if (link.relation !== relation) continue;
    const conf = resolveEdgeConfidence(link);
    if (conf === null) continue;
    if (direction === 'inbound' && link.target === nodeId) {
      out.push({ id: link.source, confidence: conf, relation: link.relation });
    } else if (direction === 'outbound' && link.source === nodeId) {
      out.push({ id: link.target, confidence: conf, relation: link.relation });
    }
  }
  return out;
}

function deriveRelatedSpec(
  symbolId: string,
  projectRoot: string,
): { kind: 'module-coarse'; path: string } | { kind: 'unknown' } {
  const moduleFile = moduleFileFromId(symbolId);
  const slug = path.basename(moduleFile, path.extname(moduleFile));
  const candidates = [
    path.join(projectRoot, 'panoramic', 'modules', `${slug}.spec.md`),
    path.join(projectRoot, 'specs', 'products', 'spectra', '_generated', 'modules', `${slug}.spec.md`),
    path.join(projectRoot, '_meta', 'modules', `${slug}.spec.md`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return { kind: 'module-coarse', path: path.relative(projectRoot, c) };
    }
  }
  return { kind: 'unknown' };
}

// ============================================================
// detect_changes tool
// ============================================================

const DetectChangesInputSchema = {
  diff: z.string().optional().describe('unified diff 文本'),
  baseRef: z.string().optional().describe('git ref (e.g. HEAD~1)'),
  projectRoot: z.string().optional(),
  depth: z.number().int().min(0).max(10).optional().describe('default 2, max 5'),
  budget: z.number().int().min(0).max(10000).optional().describe('default 200, max 1000'),
  minConfidence: z.number().min(0).max(1).optional().describe('default 0.65'),
};

interface DetectChangesArgs {
  diff?: string;
  baseRef?: string;
  projectRoot?: string;
  depth?: number;
  budget?: number;
  minConfidence?: number;
}

const MAX_DIFF_BYTES = 5 * 1024 * 1024; // 5 MB
const BASEREF_WHITELIST = /^[A-Za-z0-9_./~^@{}-]+$/;
const GIT_TIMEOUT_MS = 30_000;
const REVPARSE_TIMEOUT_MS = 5_000;

interface ChangedFile {
  file: string;
  changeKind: 'modified' | 'rename';
}

export async function handleDetectChanges(args: DetectChangesArgs): Promise<ToolResult> {
  // Feature 158 telemetry: 入口采样
  const _telStart = Date.now();
  const _telReqSize = (() => {
    try {
      return JSON.stringify(args).length;
    } catch {
      return 0;
    }
  })();
  try {
    const hasDiff = typeof args.diff === 'string' && args.diff.length > 0;
    const hasBaseRef = typeof args.baseRef === 'string' && args.baseRef.length > 0;
    if (!hasDiff && !hasBaseRef) {
      return recordAndReturn('detect_changes', _telStart, _telReqSize, buildErrorResponse(
        'invalid-input',
        '必须提供 diff 或 baseRef 之一',
        undefined,
        { reason: 'diff-or-baseref-required' },
      ));
    }

    const warnings: string[] = [];
    if (hasDiff && hasBaseRef) {
      warnings.push('baseRef-ignored');
    }

    const projectRoot = args.projectRoot ?? process.cwd();
    const cached = getCachedGraphData(projectRoot);
    if (cached === null) {
      return recordAndReturn('detect_changes', _telStart, _telReqSize, buildErrorResponse(
        'graph-not-built',
        `graph.json 不存在 (projectRoot=${projectRoot})`,
        '请先运行 `spectra batch` 生成图谱',
      ));
    }
    const { graphData, graphPath, mtimeMs, sizeBytes } = cached;

    // 1) 拿改动文件列表
    let changedFiles: ChangedFile[];
    let unmappedFromInput: Array<{ file: string; reason: 'deleted-file' | 'binary' | 'new-file-not-in-graph-yet' | 'not-in-graph' }> = [];
    if (hasDiff) {
      // 5MB 上限校验前置（CRITICAL fix：返回 payload-too-large 而非 invalid-diff）
      if (Buffer.byteLength(args.diff!, 'utf-8') > MAX_DIFF_BYTES) {
        return recordAndReturn('detect_changes', _telStart, _telReqSize, buildErrorResponse(
          'payload-too-large',
          `diff 超过上限 ${MAX_DIFF_BYTES} 字节`,
          undefined,
          { limitBytes: MAX_DIFF_BYTES },
        ));
      }
      const parsed = parseUnifiedDiff(args.diff!);
      if (parsed.error !== undefined) {
        return recordAndReturn('detect_changes', _telStart, _telReqSize, buildErrorResponse('invalid-diff', parsed.error));
      }
      changedFiles = parsed.changed;
      unmappedFromInput = parsed.unmapped;
    } else {
      const r = runGitDiffNameStatus(args.baseRef!, projectRoot);
      if (!r.ok) {
        return recordAndReturn('detect_changes', _telStart, _telReqSize, buildErrorResponse(r.code, r.message, undefined, r.context));
      }
      changedFiles = r.changed;
      unmappedFromInput = r.unmapped;
    }

    // 没有改动文件 → success warning（FR-050 'no-changed-files' 是 warning 不是 error）
    if (changedFiles.length === 0 && unmappedFromInput.length === 0) {
      warnings.push('no-changed-files');
    }

    // 2) file → graph symbols 映射
    const fileToSymbols = buildFileSymbolIndex(graphData);
    const changedSymbolsOut: Array<{ file: string; changeKind: 'modified' | 'rename'; symbols: string[] }> = [];
    const unmappedFiles: Array<{ file: string; reason: 'deleted-file' | 'binary' | 'new-file-not-in-graph-yet' | 'not-in-graph' }> = [...unmappedFromInput];
    const allChangedSymbolIds: string[] = [];

    for (const cf of changedFiles) {
      const symbols = fileToSymbols.get(cf.file);
      if (symbols === undefined || symbols.length === 0) {
        unmappedFiles.push({ file: cf.file, reason: 'not-in-graph' });
        continue;
      }
      changedSymbolsOut.push({ file: cf.file, changeKind: cf.changeKind, symbols });
      for (const s of symbols) allChangedSymbolIds.push(s);
    }

    // 3) 跨 changedSymbol 共享 budget BFS
    const reqDepth = args.depth ?? 2;
    const effectiveDepth = Math.min(Math.max(reqDepth, 0), 5);
    if (effectiveDepth !== reqDepth) warnings.push('depth-clamped');
    const reqBudget = args.budget ?? 200;
    const effectiveBudget = Math.min(Math.max(reqBudget, 0), 1000);
    if (effectiveBudget !== reqBudget) warnings.push('budget-clamped');
    const minConfidence = args.minConfidence ?? 0.65;

    const sharedVisited = new Set<string>();
    for (const s of allChangedSymbolIds) sharedVisited.add(s);

    const affectedAcc: BfsAffected[] = [];
    let remaining = effectiveBudget;
    for (const startId of allChangedSymbolIds) {
      if (remaining <= 0) {
        warnings.push('budget-truncated');
        break;
      }
      const r = bfsTraverse(graphData, startId, {
        depth: effectiveDepth,
        minConfidence,
        direction: 'upstream',
        budget: remaining,
        sharedVisited,
        graphPath,
        graphMtimeMs: mtimeMs,
        graphSizeBytes: sizeBytes,
        relations: ['calls'],
      });
      affectedAcc.push(...r.affected);
      remaining = effectiveBudget - affectedAcc.length;
      for (const w of r.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
      if (r.warnings.includes('budget-truncated')) break;
    }

    // de-warning（去重）
    const uniqWarnings = [...new Set(warnings)];

    const totalChanged = allChangedSymbolIds.length;
    const totalAffected = affectedAcc.length;
    const riskTier = computeRiskTier(0, totalAffected);

    const data: Record<string, unknown> = {
      changedSymbols: changedSymbolsOut,
      affectedSymbols: affectedAcc,
      riskSummary: { totalChanged, totalAffected, riskTier },
      unmappedFiles,
      effectiveBudget,
      effectiveDepth,
      effectiveMinConfidence: minConfidence,
    };
    if (uniqWarnings.length > 0) data['warnings'] = uniqWarnings;

    // F170c enrichment（plan G + D 节）
    const enrichment = _computeDetectChangesEnrichment(affectedAcc, riskTier, totalChanged);
    data['riskTier'] = riskTier;
    data['topImpacted'] = enrichment.topImpacted;
    data['nextStepHint'] = enrichment.nextStepHint;
    if (enrichment.degraded) data['_enrichmentDegraded'] = true;

    // telemetry sample（Feature 165）
    const { symbolSample, fileSample } = _buildTelemetrySamples(changedSymbolsOut);
    return recordAndReturn(
      'detect_changes',
      _telStart,
      _telReqSize,
      buildSuccessResponse(data, ['affectedSymbols']),
      { changedSymbolsCount: totalChanged },
      { symbols: symbolSample, files: fileSample },
    );
  } catch (err) {
    return recordAndReturn('detect_changes', _telStart, _telReqSize, buildErrorResponse(
      'internal-error',
      err instanceof Error ? err.message : String(err),
      undefined,
      { stack: err instanceof Error && err.stack ? err.stack.slice(0, 200) : undefined },
    ));
  }
}

// ─── detect_changes 私有辅助函数（F170c T-GREEN-2 cleanup） ───

function _computeDetectChangesEnrichment(
  affectedAcc: BfsAffected[],
  riskTier: 'low' | 'medium' | 'high',
  totalChanged: number,
): { topImpacted: TopImpacted[]; nextStepHint: string; degraded: boolean } {
  try {
    const topImpacted = buildTopImpactedRanking(affectedAcc, 5);
    const nextStepHint = generateNextStepHint(
      'detect_changes',
      { topImpacted, riskTier, totalChanged },
      'success',
    );
    return { topImpacted, nextStepHint, degraded: false };
  } catch (e) {
    safeStderrLog(`[F170c] detect_changes enrichment degraded: ${String(e)}\n`);
    return { topImpacted: [], nextStepHint: '', degraded: true };
  }
}

function _buildTelemetrySamples(
  changedSymbolsOut: Array<{ file: string; changeKind: 'modified' | 'rename'; symbols: string[] }>,
): { symbolSample: string[]; fileSample: string[] } {
  const sampleMaxN = 10;
  const symbolSample: string[] = [];
  for (const cf of changedSymbolsOut) {
    for (const sym of cf.symbols) {
      if (symbolSample.length >= sampleMaxN) break;
      symbolSample.push(sym);
    }
    if (symbolSample.length >= sampleMaxN) break;
  }
  const fileSample: string[] = [];
  for (const cf of changedSymbolsOut) {
    if (fileSample.length >= sampleMaxN) break;
    fileSample.push(cf.file);
  }
  return { symbolSample, fileSample };
}

// ─── unified diff 解析 ─────────────────────────────────────

function parseUnifiedDiff(diff: string): {
  changed: ChangedFile[];
  unmapped: Array<{ file: string; reason: 'deleted-file' | 'binary' | 'new-file-not-in-graph-yet' }>;
  error?: string;
} {
  const lines = diff.split('\n');
  const changed: ChangedFile[] = [];
  const unmapped: Array<{ file: string; reason: 'deleted-file' | 'binary' | 'new-file-not-in-graph-yet' }> = [];

  interface PendingHeader {
    aPath?: string;
    bPath?: string;
    sawContent: boolean;  // 是否见过 --- / +++ / rename / binary 等"实质内容"标记
  }
  let pendingHeader: PendingHeader | null = null;
  let sawAnyHeader = false;

  const flushPending = (binary: boolean) => {
    if (pendingHeader === null) return;
    const aPath = pendingHeader.aPath;
    const bPath = pendingHeader.bPath;
    // mode-only diff（仅 diff --git 头，没有 --- / +++ / rename / binary）→ 跳过
    if (!binary && !pendingHeader.sawContent) {
      pendingHeader = null;
      return;
    }
    if (binary) {
      const file = bPath ?? aPath;
      if (file !== undefined && file !== '/dev/null') {
        unmapped.push({ file: stripDiffPrefix(file), reason: 'binary' });
      }
    } else {
      // 删除：bPath 为 /dev/null
      if (bPath === '/dev/null' && aPath !== undefined && aPath !== '/dev/null') {
        unmapped.push({ file: stripDiffPrefix(aPath), reason: 'deleted-file' });
      } else if (aPath === '/dev/null' && bPath !== undefined && bPath !== '/dev/null') {
        // 新增文件
        unmapped.push({ file: stripDiffPrefix(bPath), reason: 'new-file-not-in-graph-yet' });
      } else if (bPath !== undefined && bPath !== '/dev/null') {
        const cleanB = stripDiffPrefix(bPath);
        const cleanA = aPath !== undefined ? stripDiffPrefix(aPath) : cleanB;
        const isRename = cleanA !== cleanB;
        changed.push({ file: cleanB, changeKind: isRename ? 'rename' : 'modified' });
      }
    }
    pendingHeader = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      // 上一组结束
      flushPending(false);
      sawAnyHeader = true;
      // 解析 a/<path> b/<path>，可能含引号 + 路径含空格
      // 优先匹配 quoted: diff --git "a/foo bar" "b/foo bar"
      const quotedM = line.match(/^diff --git "(a\/.+?)" "(b\/.+?)"$/);
      const unquotedM = line.match(/^diff --git (a\/[^\s]+) (b\/[^\s]+)$/);
      if (quotedM) {
        pendingHeader = { aPath: quotedM[1], bPath: quotedM[2], sawContent: false };
      } else if (unquotedM) {
        pendingHeader = { aPath: unquotedM[1], bPath: unquotedM[2], sawContent: false };
      } else {
        // 兜底（rename 等场景 diff --git 头可能没 a/ b/ 前缀）
        pendingHeader = { sawContent: false };
      }
    } else if (line.startsWith('--- ')) {
      if (pendingHeader === null) pendingHeader = { sawContent: false };
      pendingHeader.aPath = line.slice(4).trim().replace(/^"|"$/g, '');
      pendingHeader.sawContent = true;
    } else if (line.startsWith('+++ ')) {
      if (pendingHeader === null) pendingHeader = { sawContent: false };
      pendingHeader.bPath = line.slice(4).trim().replace(/^"|"$/g, '');
      pendingHeader.sawContent = true;
    } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      flushPending(true);
    } else if (line.startsWith('rename to ')) {
      if (pendingHeader === null) pendingHeader = { sawContent: false };
      pendingHeader.bPath = 'b/' + line.slice('rename to '.length).trim().replace(/^"|"$/g, '');
      pendingHeader.sawContent = true;
    } else if (line.startsWith('rename from ')) {
      if (pendingHeader === null) pendingHeader = { sawContent: false };
      pendingHeader.aPath = 'a/' + line.slice('rename from '.length).trim().replace(/^"|"$/g, '');
      pendingHeader.sawContent = true;
    }
  }
  flushPending(false);

  if (!sawAnyHeader && diff.trim().length > 0) {
    return {
      changed: [],
      unmapped: [],
      error: 'unified diff 格式不合法：未找到 `diff --git` 头',
    };
  }

  return { changed, unmapped };
}

function stripDiffPrefix(p: string): string {
  if (p.startsWith('a/')) return p.slice(2);
  if (p.startsWith('b/')) return p.slice(2);
  return p;
}

// ─── git diff baseRef 路径 ──────────────────────────────────

function runGitDiffNameStatus(
  baseRef: string,
  projectRoot: string,
):
  | { ok: true; changed: ChangedFile[]; unmapped: Array<{ file: string; reason: 'deleted-file' | 'binary' | 'new-file-not-in-graph-yet' }> }
  | { ok: false; code: ErrorCode; message: string; context?: Record<string, unknown> } {
  if (!BASEREF_WHITELIST.test(baseRef) || baseRef.startsWith('-')) {
    return {
      ok: false,
      code: 'invalid-input',
      message: `baseRef 含非法字符或以 - 开头: ${baseRef}`,
      context: { reason: 'baseref-format' },
    };
  }
  // 1) rev-parse 验证
  const rev = spawnSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], {
    cwd: projectRoot,
    shell: false,
    timeout: REVPARSE_TIMEOUT_MS,
    encoding: 'utf-8',
  });
  if (rev.error !== undefined && (rev.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ok: false, code: 'git-timeout', message: `rev-parse 超时 (${REVPARSE_TIMEOUT_MS} ms)` };
  }
  if (rev.status !== 0) {
    const stderr = (rev.stderr ?? '').toString().slice(0, 200);
    return {
      ok: false,
      code: 'git-spawn-failed',
      message: `rev-parse 失败: ${stderr || 'unknown'}`,
      context: { reason: 'baseref-invalid', stderr },
    };
  }
  const sha = rev.stdout.trim();
  if (sha.length === 0) {
    return { ok: false, code: 'git-spawn-failed', message: 'rev-parse 返回空 sha' };
  }
  // 2) git diff --name-status
  const diff = spawnSync('git', ['diff', '--name-status', `${sha}...HEAD`], {
    cwd: projectRoot,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf-8',
  });
  if (diff.error !== undefined && (diff.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ok: false, code: 'git-timeout', message: `git diff 超时 (${GIT_TIMEOUT_MS} ms)` };
  }
  if (diff.status !== 0) {
    const stderr = (diff.stderr ?? '').toString().slice(0, 200);
    return { ok: false, code: 'git-spawn-failed', message: `git diff 失败: ${stderr}` };
  }
  const changed: ChangedFile[] = [];
  const unmapped: Array<{ file: string; reason: 'deleted-file' | 'binary' | 'new-file-not-in-graph-yet' }> = [];
  const out = diff.stdout.toString();
  for (const rawLine of out.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    if (status.startsWith('R')) {
      // R<score>\told\tnew
      const newPath = parts[2];
      if (typeof newPath === 'string' && newPath.length > 0) {
        changed.push({ file: newPath, changeKind: 'rename' });
      }
    } else if (status === 'M') {
      const file = parts[1];
      if (typeof file === 'string') changed.push({ file, changeKind: 'modified' });
    } else if (status === 'A') {
      const file = parts[1];
      if (typeof file === 'string') unmapped.push({ file, reason: 'new-file-not-in-graph-yet' });
    } else if (status === 'D') {
      const file = parts[1];
      if (typeof file === 'string') unmapped.push({ file, reason: 'deleted-file' });
    } else {
      // 其他状态（C / T / U 等）按 modified 处理
      const file = parts[parts.length - 1];
      if (typeof file === 'string') changed.push({ file, changeKind: 'modified' });
    }
  }
  return { ok: true, changed, unmapped };
}

// ─── file → symbols 索引 ───────────────────────────────────

function buildFileSymbolIndex(graphData: Readonly<GraphJSON>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of graphData.nodes) {
    const file = moduleFileFromId(node.id);
    const list = index.get(file) ?? [];
    list.push(node.id);
    index.set(file, list);
  }
  return index;
}

// ============================================================
// 注册入口
// ============================================================

/**
 * 把 3 个 Agent-Context tool 注册到 MCP server。
 * 在 server.ts 里 registerGraphTools(server) 之后调用。
 */
export function registerAgentContextTools(server: McpServer): void {
  server.tool(
    'impact',
    `查询 symbol 改动的 blast radius — 反向/正向 BFS 遍历调用链，返回受影响 symbols + risk summary。

Use this tool when:
- 改动前评估 caller 影响面
- 重构前看 transitive 影响（depth=3-5）
- 决定 PR review 范围

Example:
- Input: { target: "engine.py::Value.add", depth: 2 }
- Output: { affected, summary, topImpacted: [{ id, score }], nextStepHint }

Typical chained usage:
- 修代码前: detect_changes → impact → context`,
    ImpactInputSchema,
    async (args) => handleImpact(args as ImpactArgs),
  );

  server.tool(
    'context',
    `查询 symbol 360° 上下文 — definition + callers + callees + imports + topRelevantCallers。

Use this tool when:
- 第一次接触某 symbol，理解位置/调用方/依赖
- 修改前查 caller 风格保持一致
- 调试时定位上游引用源头

Example:
- Input: { symbolId: "engine.py::Value" }
- Output: { definition, callers, callees, imports, topRelevantCallers, nextStepHint }

Typical chained usage:
- impact → context（查 top 受影响节点的上下文）`,
    ContextInputSchema,
    async (args) => handleContext(args as ContextArgs),
  );

  server.tool(
    'detect_changes',
    `从 git diff（unified diff 或 baseRef）派生 changedSymbols + BFS 影响链 + risk 总结。

Use this tool when:
- 收到 patch/PR diff 找实际改动 symbol
- 提交前自检本次改动的上游影响
- review 大型 PR 按 risk tier 分级

Example:
- Input: { diff: "diff --git a/engine.py..." } 或 { baseRef: "HEAD~3" }
- Output: { changedSymbols, affectedSymbols, riskSummary, riskTier, topImpacted, nextStepHint }

Typical chained usage:
- detect_changes → impact → context`,
    DetectChangesInputSchema,
    async (args) => handleDetectChanges(args as DetectChangesArgs),
  );
}
