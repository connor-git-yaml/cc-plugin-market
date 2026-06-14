/**
 * F190 KB MCP — 双库结果合并（跨库 BM25 归一 + 每库候选下限）
 *
 * 修 Codex CRITICAL-6：FTS5 bm25() 越负越相关，归一用 `(max - score)/(max - min + ε)`
 * 使最相关 → 1.0，再按归一分降序（方向与相关度一致）。
 * 修 Codex C-5：top_k≥2 且两库均有命中时，保证每库各 ≥1 条（双呈现不被挤出）。
 */

import type { CoreResult } from '../../scaffold-kb/search-core.js';

export type SourceKind = 'vendor' | 'project';

export interface MergedResult extends CoreResult {
  sourceKind: SourceKind;
  /** 归一相关度 [0,1]，越大越相关 */
  scoreNorm: number;
}

const EPS = 1e-9;

/** 对单库候选做 min-max 归一（最相关 → 1.0）；全等或单条时统一给 1.0 */
function normalizeLib(results: CoreResult[], sourceKind: SourceKind): MergedResult[] {
  if (results.length === 0) return [];
  const scores = results.map((r) => r.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  return results.map((r) => ({
    ...r,
    sourceKind,
    scoreNorm: range < EPS ? 1.0 : (max - r.score) / (range + EPS),
  }));
}

function key(r: MergedResult): string {
  return `${r.sourceKind}:${r.chunkId}`;
}

function topOf(list: MergedResult[]): MergedResult {
  return list.reduce((best, r) => (r.scoreNorm > best.scoreNorm ? r : best));
}

/**
 * 合并厂商库与项目库候选，返回最终 top_k（按归一分降序）。
 * - top_k ≤ 1：返回全局最高 1 条（双呈现不适用，合法降级）
 * - top_k ≥ 2 且两库均非空：先各预留 1 条最高分（每库下限），再按全局归一分补足
 */
export function mergeResults(
  vendor: CoreResult[],
  project: CoreResult[],
  topK: number,
): MergedResult[] {
  const v = normalizeLib(vendor, 'vendor');
  const p = normalizeLib(project, 'project');
  const all = [...v, ...p].sort((a, b) => b.scoreNorm - a.scoreNorm);

  if (topK <= 1) return all.slice(0, Math.max(0, topK));

  if (v.length > 0 && p.length > 0) {
    const reserved = [topOf(v), topOf(p)];
    const reservedKeys = new Set(reserved.map(key));
    const rest = all.filter((r) => !reservedKeys.has(key(r)));
    const chosen = [...reserved, ...rest.slice(0, topK - reserved.length)];
    return chosen.sort((a, b) => b.scoreNorm - a.scoreNorm);
  }

  return all.slice(0, topK);
}
