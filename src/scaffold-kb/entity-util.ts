/**
 * F192 — 实体共享工具（id 归一 + confidence clamp），供 heuristic/LLM 抽取 + matcher 复用
 */

/** 归一字符串：trim + 小写 + 折叠空白 */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 实体稳定唯一 id：qualified_name + kind (+ overload_key) 归一。
 * 同名重载靠 overload_key 区分（W-2）。
 */
export function makeEntityId(
  qualifiedName: string,
  kind: string,
  overloadKey?: string | null,
): string {
  const base = `${norm(qualifiedName)}#${kind}`;
  return overloadKey && overloadKey.trim() ? `${base}#${norm(overloadKey)}` : base;
}

/** confidence clamp 到 [0,1]；非数值 → fallback（I-1） */
export function clampConfidence(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
