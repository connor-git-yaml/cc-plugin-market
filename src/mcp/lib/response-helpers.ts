/**
 * F170c — MCP response 共享 helper（纯函数模块）
 *
 * RED phase stub：所有函数 throw "not implemented"，让测试可加载并 fail（assertion fail 而非 module load error）。
 * GREEN phase（T-GREEN-1）实施真实逻辑。
 */

/** TopImpacted 排名条目 */
export interface TopImpacted {
  id: string;
  score: number;
}

/** TopRelevantCaller 排名条目 */
export interface TopRelevantCaller {
  id: string;
  confidence: number;
  score: number;
}

/** impact tool 新增字段（producer success path 总产出） */
export interface ImpactEnrichment {
  topImpacted?: TopImpacted[];
  nextStepHint?: string;
  _enrichmentDegraded?: true;
}

/** detect_changes tool 新增字段 */
export interface DetectChangesEnrichment {
  riskTier?: 'low' | 'medium' | 'high';
  topImpacted?: TopImpacted[];
  nextStepHint?: string;
  _enrichmentDegraded?: true;
}

/** context tool 新增字段 */
export interface ContextEnrichment {
  topRelevantCallers?: TopRelevantCaller[];
  nextStepHint?: string;
  _enrichmentDegraded?: true;
}

/**
 * 安全 stderr 日志，吞掉 write 自身异常（响应 codex C-6：避免 enrichment failure 升级为 handler error）。
 */
export function safeStderrLog(_message: string): void {
  throw new Error('not implemented (F170c RED phase)');
}

/**
 * 从 BFS affected 列表构建 topImpacted 排名。
 * 按 score = 1/depth 降序、confidence 降序、id 字母升序，取前 maxItems 项。
 * @pure
 */
export function buildTopImpactedRanking(
  _affected: ReadonlyArray<{ id: string; depth: number; confidence?: number }>,
  _maxItems: number,
): TopImpacted[] {
  throw new Error('not implemented (F170c RED phase)');
}

/**
 * 生成 nextStepHint 引导文本（中文）。
 * success 路径返回非空字符串（≥ 5 字符）；degraded 路径固定返回 ""。
 * @pure
 */
export function generateNextStepHint(
  _toolName: 'impact' | 'detect_changes' | 'context',
  _responseData: Record<string, unknown>,
  _path: 'success' | 'degraded',
): string {
  throw new Error('not implemented (F170c RED phase)');
}

/**
 * 从 context callers 列表构建 topRelevantCallers 排名。
 * 按 confidence 降序（同分按 id 字母升序），取前 maxItems 项。
 * @pure
 */
export function buildTopRelevantCallers(
  _callers: ReadonlyArray<{ id: string; confidence: number; relation?: string }>,
  _maxItems: number,
): TopRelevantCaller[] {
  throw new Error('not implemented (F170c RED phase)');
}
