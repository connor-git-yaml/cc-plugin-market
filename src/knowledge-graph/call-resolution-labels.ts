/**
 * M11 卡 A（P1-I 诚实工具面）— calls 边解析标签词表。
 *
 * call-resolver 四阶段 + F260 接收者类型解析产出的每条 calls 边都带 `metadata.resolution`
 * （stage / strategy / basis）与 `metadata.callSite`（line / column）。此前 mkEdge 只留下
 * high / medium / low 一个字，消费方分不清「AST 索引直查」与「按命名规则拼出来的占位」，
 * 也拿不到调用点行号（F277 账本 #22）。
 *
 * 本文件是 `contracts/mcp-return-surface-contract.yaml` 的 TS 侧事实源，两处由
 * `tests/unit/contracts/mcp-return-surface-contract.test.ts` 机械对拍。
 */

import type {
  CallEdgeBasis,
  CallEdgeResolution,
  CallEdgeStage,
  CallEdgeStrategy,
  CallSiteRef,
} from '../panoramic/graph/graph-types.js';

export type { CallEdgeBasis, CallEdgeResolution, CallEdgeStage, CallEdgeStrategy, CallSiteRef };

export const CALL_EDGE_STAGES: readonly CallEdgeStage[] = Object.freeze([
  'local-export',
  'receiver-type',
  'member',
  'cross-module',
  'fallback',
]);

/**
 * - `index`：由 AST 派生的确定性索引表命中（导出表 / 类成员表 / import 表 / MRO / 接收者类型索引）
 * - `heuristic`：占位或通配——目标按命名规则拼出，可能不存在；下游要么当悬空边丢弃，要么以
 *   low / medium 置信度保留
 */
export const CALL_EDGE_BASES: readonly CallEdgeBasis[] = Object.freeze(['index', 'heuristic']);

interface StrategyMapping {
  readonly stage: CallEdgeStage;
  readonly basis: CallEdgeBasis;
}

/** strategy → stage / basis。键的顺序即合同 YAML 的登记顺序。 */
export const CALL_EDGE_STRATEGIES = Object.freeze({
  'export-table': { stage: 'local-export', basis: 'index' },
  'receiver-type-index': { stage: 'receiver-type', basis: 'index' },
  'namespace-alias': { stage: 'member', basis: 'index' },
  'class-member': { stage: 'member', basis: 'index' },
  'class-mro': { stage: 'member', basis: 'index' },
  'class-member-placeholder': { stage: 'member', basis: 'heuristic' },
  'remote-class-member': { stage: 'member', basis: 'index' },
  'remote-class-placeholder': { stage: 'member', basis: 'heuristic' },
  'class-unlocated-placeholder': { stage: 'member', basis: 'heuristic' },
  'suppressed-dynamic-placeholder': { stage: 'member', basis: 'heuristic' },
  'import-table': { stage: 'cross-module', basis: 'index' },
  'star-import': { stage: 'cross-module', basis: 'heuristic' },
  'super-mro': { stage: 'fallback', basis: 'index' },
  'unresolved-placeholder': { stage: 'fallback', basis: 'heuristic' },
} as const satisfies Record<CallEdgeStrategy, StrategyMapping>);

export function resolutionFor(strategy: CallEdgeStrategy): CallEdgeResolution {
  const m = CALL_EDGE_STRATEGIES[strategy];
  return { stage: m.stage, strategy, basis: m.basis };
}

export function isCallEdgeStrategy(value: unknown): value is CallEdgeStrategy {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CALL_EDGE_STRATEGIES, value);
}

/**
 * 从任意 metadata 值里认出合法的 resolution：只信 strategy（词表键），stage / basis 一律由
 * 词表**重算**——旧 producer 或手改的 graph.json 写了自相矛盾的三元组时不照单透传。
 */
export function canonicalResolution(value: unknown): CallEdgeResolution | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const strategy = (value as { strategy?: unknown }).strategy;
  return isCallEdgeStrategy(strategy) ? resolutionFor(strategy) : undefined;
}

/** 一条边最多列出的调用点数；超出的只计入 callSiteCount。 */
export const CALL_SITES_CAP = 20;

export function callSiteRefFrom(cs: { line: number; column?: number | undefined }): CallSiteRef {
  return cs.column === undefined ? { line: cs.line } : { line: cs.line, column: cs.column };
}

export function isCallSiteRef(value: unknown): value is CallSiteRef {
  if (typeof value !== 'object' || value === null) return false;
  const { line, column } = value as { line?: unknown; column?: unknown };
  if (!Number.isInteger(line) || (line as number) < 1) return false;
  return column === undefined || (Number.isInteger(column) && (column as number) >= 0);
}

/**
 * 合并调用点：按 (line, column) 升序、同 (line, column) 去重、超过 cap 只计数。
 * column 缺席排在同 line 的任何 column 之前（缺席视作 -1），保证两次构建逐字节相同。
 */
export function finalizeCallSites(sites: ReadonlyArray<CallSiteRef>): { callSites: CallSiteRef[]; callSiteCount: number } {
  const seen = new Map<string, CallSiteRef>();
  for (const s of sites) {
    const key = `${s.line}:${s.column ?? ''}`;
    if (!seen.has(key)) seen.set(key, callSiteRefFrom(s));
  }
  const sorted = [...seen.values()].sort((a, b) => a.line - b.line || (a.column ?? -1) - (b.column ?? -1));
  return { callSites: sorted.slice(0, CALL_SITES_CAP), callSiteCount: sorted.length };
}
