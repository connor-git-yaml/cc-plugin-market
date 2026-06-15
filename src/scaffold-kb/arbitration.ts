/**
 * F192 T006 — 冲突仲裁档 A（kb_api_lookup 实体级，FR-007/008 + §3.4 R-ARB-2）
 *
 * 同 id 实体在两库均命中且关键属性矛盾 → 冲突组。pairwise 归一加权打分：
 *   score = Σ(w_i · dim_i) / Σ(w_i over 活跃维)   —— 缺失维剔除并重归一（非填 0）
 * 维度：版本匹配度 / 时效 / confidence。安全默认（R-ARB-2）：
 *   - 缺 confidence/version → 该维中性化（剔除）；缺时间戳 → 按"最旧"（显式例外）
 *   - 推荐项 MUST 在版本或 confidence ≥1 主维严格占优；仅时效新不足以推荐
 *   - 分差 < ε → 并列，全 recommended=false（回退双呈现）
 */

import type { ApiEntity, SourceKind } from './types.js';

export interface ArbitrationInput extends ApiEntity {
  sourceKind: SourceKind;
  /** 来源库 sdk_version（ApiEntityFile 级，版本匹配兜底；实体无 sinceVersion 时用） */
  libSdkVersion?: string | null;
  /** recency 时间戳：导入实体用 ingested_at、厂商构建用 built_at（缺 → 按最旧） */
  timestamp?: string | null;
}

export interface Arbitration {
  recommended: boolean;
  score: number;
  reason: string;
  groupId: string;
}

export interface ArbitratedEntity extends ArbitrationInput {
  arbitration?: Arbitration;
}

export interface ArbitrateOptions {
  /** 查询显式版本；无则 fallback 到 kbSdkVersion（W-5 防版本维形同虚设） */
  targetSdkVersion?: string | null;
  kbSdkVersion?: string | null;
  weights?: { version: number; recency: number; confidence: number };
  epsilon?: number;
}

const DEFAULT_WEIGHTS = { version: 0.4, recency: 0.2, confidence: 0.4 };
const DEFAULT_EPSILON = 0.05;

/** 关键属性签名：用于判定组内是否"矛盾"（值不同即冲突） */
function keyAttrSignature(e: ApiEntity): string {
  const params = (e.params ?? []).map((p) => `${p.name}:${p.type ?? ''}`).join(',');
  const dep = e.deprecated?.isDeprecated ? `dep@${e.deprecated.since ?? ''}` : 'live';
  return `${e.signature ?? ''}|${params}|${dep}|${e.sinceVersion ?? ''}`;
}

/** 粗粒度版本比较：返回 -1/0/1（无法解析返回 null） */
function compareVersion(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const m = v.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return null;
    return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 版本匹配度：相对 target 的适用性（exact=1 / 适用旧=0.6 / 偏新=0.2）；无信息 → null（中性化） */
function versionScore(e: ArbitrationInput, target: string | null): number | null {
  const v = e.sinceVersion ?? e.libSdkVersion ?? null;
  if (target == null || v == null) return null;
  const cmp = compareVersion(v, target);
  if (cmp == null) return null;
  if (cmp === 0) return 1.0;
  return cmp < 0 ? 0.6 : 0.2;
}

/** 时效分：组内按时间戳归一（newest=1, oldest=0）；缺时间戳 → 0（最旧，显式例外） */
function recencyScores(group: ArbitrationInput[]): number[] {
  const ts = group.map((e) => e.timestamp ?? '');
  const present = ts.filter((t) => t.length > 0).sort();
  if (present.length === 0) return group.map(() => 0);
  const min = present[0]!;
  const max = present[present.length - 1]!;
  if (min === max) return group.map((_, i) => (ts[i] ? 1 : 0));
  return ts.map((t) => {
    if (!t) return 0;
    return t === max ? 1 : t === min ? 0 : 0.5;
  });
}

interface Dims {
  version: number | null;
  recency: number;
  confidence: number | null;
}

function weightedScore(d: Dims, w: typeof DEFAULT_WEIGHTS): number {
  let num = 0;
  let den = 0;
  if (d.version != null) {
    num += w.version * d.version;
    den += w.version;
  }
  if (d.confidence != null) {
    num += w.confidence * d.confidence;
    den += w.confidence;
  }
  // 时效维始终参与（缺时间戳已按最旧=0）
  num += w.recency * d.recency;
  den += w.recency;
  return den > 0 ? num / den : 0;
}

/**
 * 对一组匹配实体做冲突仲裁。返回标注 arbitration 的实体（同 id 冲突组共享 groupId）。
 * 非冲突（单库命中或组内属性一致）不标 arbitration。
 */
export function arbitrateEntities(
  entities: ArbitrationInput[],
  opts: ArbitrateOptions = {},
): ArbitratedEntity[] {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const epsilon = opts.epsilon ?? DEFAULT_EPSILON;
  const target = opts.targetSdkVersion ?? opts.kbSdkVersion ?? null;

  // 按 id 分组
  const groups = new Map<string, ArbitrationInput[]>();
  for (const e of entities) {
    const g = groups.get(e.id) ?? [];
    g.push(e);
    groups.set(e.id, g);
  }

  const out: ArbitratedEntity[] = [];
  for (const [groupId, group] of groups) {
    // 非冲突：单成员，或全员关键属性一致 → 不仲裁
    const sigs = new Set(group.map(keyAttrSignature));
    if (group.length < 2 || sigs.size < 2) {
      out.push(...group);
      continue;
    }

    const recScores = recencyScores(group);
    const dims: Dims[] = group.map((e, i) => ({
      version: versionScore(e, target),
      recency: recScores[i] ?? 0,
      confidence: Number.isFinite(e.confidence) ? e.confidence : null,
    }));
    const scores = dims.map((d) => weightedScore(d, weights));

    // 找最高分 + 次高分
    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) if ((scores[i] ?? 0) > (scores[bestIdx] ?? 0)) bestIdx = i;
    const sorted = [...scores].sort((a, b) => b - a);
    const best = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;

    // 主维严格占优判定（版本 或 confidence），仅时效不算
    const bestDim = dims[bestIdx]!;
    // 主维"占优"要求所有对手在该维**有值且严格更低**；对手该维缺失（中性化）
    // 不可被判为"被压过"——否则缺失即输，违背 R-ARB-2（C-3 修正）。
    const dominatesVersion =
      bestDim.version != null &&
      dims.every((d, i) => i === bestIdx || (d.version != null && d.version < bestDim.version!));
    const dominatesConfidence =
      bestDim.confidence != null &&
      dims.every((d, i) => i === bestIdx || (d.confidence != null && d.confidence < bestDim.confidence!));
    const hasMainAdvantage = dominatesVersion || dominatesConfidence;

    const recommend = hasMainAdvantage && best - second >= epsilon;

    group.forEach((e, i) => {
      const reason = !recommend
        ? '各维并列或仅时效占优 → 回退双呈现（R-ARB-2）'
        : i === bestIdx
          ? `推荐：${dominatesVersion ? '版本匹配' : ''}${dominatesVersion && dominatesConfidence ? '+' : ''}${dominatesConfidence ? 'confidence' : ''}占优（score ${best.toFixed(2)}）`
          : `备选（score ${(scores[i] ?? 0).toFixed(2)}）`;
      out.push({
        ...e,
        arbitration: { recommended: recommend && i === bestIdx, score: scores[i] ?? 0, reason, groupId },
      });
    });
  }
  return out;
}
