/**
 * F192 T007 — API 实体匹配（kb_api_lookup 用，FR-004 + W-2 消歧）
 *
 * 精确（name/qualified_name/末段 相等）优先，模糊（子串 / token 重叠）兜底；
 * 支持 kind / container 过滤；多命中返回 top-N（不静默取一）。纯函数。
 */

import type { ApiEntity } from './types.js';
import { tokenize } from './tokenizer.js';

export interface MatchQuery {
  apiName: string;
  kind?: ApiEntity['kind'] | null;
  /** 按所属 class/module 限定（消歧重载/同名） */
  container?: string | null;
  topN?: number;
}

export interface EntityMatch extends ApiEntity {
  matchType: 'exact' | 'fuzzy';
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function lastSegment(qualified: string): string {
  return qualified.includes('.') ? (qualified.split('.').pop() ?? qualified) : qualified;
}

/** 在实体集中匹配查询，返回按相关度排序的 top-N（精确在前） */
export function matchEntities(entities: ApiEntity[], q: MatchQuery): EntityMatch[] {
  const topN = q.topN ?? 10;
  const qn = norm(q.apiName);
  if (!qn) return [];
  const qTokens = new Set(tokenize(q.apiName).map(norm));

  const candidates = entities.filter((e) => {
    if (q.kind && e.kind !== q.kind) return false;
    if (q.container && norm(e.container ?? '') !== norm(q.container)) return false;
    return true;
  });

  const scored: Array<{ e: ApiEntity; matchType: 'exact' | 'fuzzy'; rank: number }> = [];
  for (const e of candidates) {
    const name = norm(e.name);
    const qualified = norm(e.qualifiedName);
    const last = norm(lastSegment(e.qualifiedName));

    if (name === qn || qualified === qn || last === qn) {
      scored.push({ e, matchType: 'exact', rank: 0 });
      continue;
    }
    const substr = name.includes(qn) || qualified.includes(qn) || (name.length >= 2 && qn.includes(name));
    const eTokens = new Set([...tokenize(e.name), ...tokenize(e.qualifiedName)].map(norm));
    let overlap = 0;
    for (const t of qTokens) if (t.length > 0 && eTokens.has(t)) overlap++;
    if (substr || overlap > 0) {
      // rank: 子串(1.0) < token 重叠(1 + 缺口比例)
      const rank = substr ? 1.0 : 2.0 - overlap / Math.max(1, qTokens.size);
      scored.push({ e, matchType: 'fuzzy', rank });
    }
  }

  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, topN).map(({ e, matchType }) => ({ ...e, matchType }));
}
