/**
 * F170c — MCP response 共享 helper（纯函数模块）
 *
 * 用于 handleImpact / handleContext / handleDetectChanges 的 enrichment 计算。
 * 所有函数为纯函数（无 side effect，无 LLM 调用，同步执行）；safeStderrLog 是 IO 但吞掉自身异常。
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
export function safeStderrLog(message: string): void {
  try {
    process.stderr.write(message);
  } catch {
    // 静默吞掉 — stderr 不可用时不应进一步抛错破坏 handler success path
  }
}

/**
 * 从 BFS affected 列表构建 topImpacted 排名。
 * 按 score = 1/depth 降序、confidence 降序、id 字母升序（stable sort），取前 maxItems 项。
 * @pure 无副作用，同步执行
 */
export function buildTopImpactedRanking(
  affected: ReadonlyArray<{ id: string; depth: number; confidence?: number }>,
  maxItems: number,
): TopImpacted[] {
  if (maxItems <= 0) return [];
  return affected
    .map((a) => ({
      id: a.id,
      score: 1 / a.depth,
      _confidence: a.confidence ?? 0,
    }))
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      if (y._confidence !== x._confidence) return y._confidence - x._confidence;
      return x.id.localeCompare(y.id);
    })
    .slice(0, maxItems)
    .map(({ id, score }) => ({ id, score }));
}

/**
 * 生成 nextStepHint 引导文本（中文）。
 * success 路径返回非空字符串（≥ 5 字符）；degraded 路径固定返回 ""。
 * @pure 无副作用，同步执行
 */
export function generateNextStepHint(
  toolName: 'impact' | 'detect_changes' | 'context',
  responseData: Record<string, unknown>,
  path: 'success' | 'degraded',
): string {
  if (path === 'degraded') return '';

  if (toolName === 'impact') {
    const topImpacted = (responseData['topImpacted'] as TopImpacted[] | undefined) ?? [];
    const affected = (responseData['affected'] as unknown[] | undefined) ?? [];
    const top0 = topImpacted[0];
    // topImpacted 非空时优先按其内容生成 hint（包含 top id）
    if (top0 !== undefined) {
      if (affected.length === 1) {
        return `仅 1 个直接调用方 ${top0.id}，建议直接调 context 查看其上下文`;
      }
      return `建议接下来调 context for ${top0.id}（影响 score 最高，了解其调用链上下文）`;
    }
    // topImpacted 为空时根据 affected 数量决定
    if (affected.length === 0) {
      return '受影响范围为空，建议检查 symbol ID 是否正确，或改用 context 查看调用方';
    }
    return '建议查看 affected 列表中的受影响 symbol';
  }

  if (toolName === 'detect_changes') {
    const topImpacted = (responseData['topImpacted'] as TopImpacted[] | undefined) ?? [];
    const riskTier = (responseData['riskTier'] as string | undefined) ?? 'low';
    const totalChanged = (responseData['totalChanged'] as number | undefined) ?? 0;
    const top0 = topImpacted[0];
    if (top0 === undefined) {
      return `检测到 ${totalChanged} 个改动 symbol，暂无上游调用方，建议调 context 查看改动 symbol 的依赖`;
    }
    return `检测到 ${totalChanged} 个改动 symbol，风险等级 ${riskTier}，建议调 impact for ${top0.id} 评估影响范围`;
  }

  // context
  const definition = responseData['definition'] as { id?: string } | undefined;
  const callers = (responseData['callers'] as unknown[] | undefined) ?? [];
  const defId = definition?.id ?? '<unknown>';
  if (callers.length === 0) {
    return `${defId} 无已知调用方，可能为顶层入口，建议直接查看 callees 确认依赖`;
  }
  return `若将修改 ${defId}，建议调 impact for ${defId} 评估受影响的上游调用链`;
}

/**
 * 从 context callers 列表构建 topRelevantCallers 排名。
 * 按 confidence 降序（同分按 id 字母升序），取前 maxItems 项。
 * @pure 无副作用，同步执行
 */
export function buildTopRelevantCallers(
  callers: ReadonlyArray<{ id: string; confidence: number; relation?: string }>,
  maxItems: number,
): TopRelevantCaller[] {
  if (maxItems <= 0) return [];
  return callers
    .map((c) => ({ id: c.id, confidence: c.confidence, score: c.confidence }))
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      return x.id.localeCompare(y.id);
    })
    .slice(0, maxItems);
}
