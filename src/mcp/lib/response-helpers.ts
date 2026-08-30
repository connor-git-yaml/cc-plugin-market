/**
 * F170c — MCP response 共享 helper（纯函数模块）
 *
 * 用于 handleImpact / handleContext / handleDetectChanges 的 enrichment 计算。
 * 所有函数为纯函数（无 side effect，无 LLM 调用，同步执行）；safeStderrLog 是 IO 但吞掉自身异常。
 */

import type { GraphHonesty, GraphFreshnessAdvisory, ResolutionVerdict } from './graph-honesty.js';

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
  /** F266 FR-009/011：图覆盖面与新鲜度的诚实标注（追加式） */
  honesty?: GraphHonesty;
  _enrichmentDegraded?: true;
}

/** detect_changes tool 新增字段 */
export interface DetectChangesEnrichment {
  riskTier?: 'low' | 'medium' | 'high';
  topImpacted?: TopImpacted[];
  nextStepHint?: string;
  /** F266 FR-009/011/012：诚实标注 + 比较口径声明（追加式） */
  honesty?: GraphHonesty;
  _enrichmentDegraded?: true;
}

/** context tool 新增字段 */
export interface ContextEnrichment {
  topRelevantCallers?: TopRelevantCaller[];
  nextStepHint?: string;
  /** F266 FR-009/011：图覆盖面与新鲜度的诚实标注（追加式） */
  honesty?: GraphHonesty;
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
 * F266 FR-010：把 resolution 判定翻译成一句"这个零结果能不能采信"。
 *
 * **本层 MUST NOT 按 `linkageRatio` 分档下断言**（对抗审查 A3）。原实现按 <0.2 / <0.9 分三档，
 * 最严那档说"解析未完成/覆盖不足，零调用方结论不可采信"——两个致命问题：
 *   ① 归因造假：`separable:false` 明说了缺口混合着"解析失败"与"合法图外调用"，把它单方面
 *      说成"解析未完成"正是本卡要消灭的那类假话；
 *   ② 零信息量：分母含 `console.log` / 宿主 API / 第三方包方法等永不成边的调用点，真实工程
 *      恒 <20%（实测本仓 3.1%、外部 TS 语料 6.9%），最严档在所有健康仓库上永久拉响。
 * 故本层只如实报**绝对数** + 明说不可区分，不下可采信 / 不可采信的判定。
 * @pure
 */
function describeResolutionForHint(resolution: ResolutionVerdict | undefined, honesty: GraphHonesty): string {
  // 第三轮审查 E5-2：标注自身算失败时（`annotationDegraded`），resolution 与 coverage 都不存在，
  // 原本会落到"缺席声明"分支再落到空串——于是"传了 honesty"反而比**完全不传**（兜底文案
  // 「图的覆盖范围未知，零结果不等于确实没有」）更裸。降级必须说出口，否则它就是一次静默 fail-open。
  if (honesty.annotationDegraded === true) {
    return '诚实标注计算失败，图覆盖面未知，零结果不等于确实没有';
  }
  // delta 审查 D5：resolution 缺席时 MUST 渲染缺席声明，不能留空串。
  // 原实现在 `callerOriented=false`（如 impact downstream）的零结果上产出
  // 「受影响范围为空，可改用 context 查看该 symbol 的定义与依赖」——一句不带任何 hedge 的
  // 确定性断言，比**完全不传 honesty** 的兜底文案（「图的覆盖范围未知，零结果不等于确实没有」）
  // 还裸。诚实缺席的前提是把"为什么缺席"说出口。
  if (resolution === undefined) return describeOmissionForHint(honesty.resolutionOmitted);
  if (resolution.reason === 'confirmed-zero') {
    return '图内调用点记账完整且全部成边，该零结果可采信';
  }
  if (resolution.reason === 'boundary-exposed') {
    return '该 symbol 有对外暴露面，图覆盖范围外仍可能存在调用方，零结果不等于确实没有';
  }
  // coverage-gap：②③合并态。coverage 字段只在"有量化缺口"时随行，其余成因（无记账 /
  // 记账不自洽 / 仅缺席数据源）没有数字可报，退回 resolution.detail 已说清的中性表述。
  const c = honesty.coverage;
  if (c === undefined) {
    return '图的覆盖范围不完整（无调用点记账 / 记账不自洽 / 存在缺席数据源），零结果应结合该缺口理解';
  }
  return (
    `图内有 ${c.unlinkedCallSites} 个已探测调用点未成边` +
    '（其中解析失败与合法的图外调用当前不可区分），零调用方结论应结合该缺口理解'
  );
}

/**
 * delta 审查 D5：把 `resolutionOmitted` 的每种成因各渲染成一句诚实缺席声明。
 *
 * 每句话都只说"本次没查/查不了什么"，不对结果本身作任何存在性断言——这正是缺席该有的语气。
 *
 * 第三轮审查 E5-1：**穷尽 switch，不留 `default`**。原先的 `default: return ''` 会让将来新增的
 * omission 成因静默渲染成空串——正好退回 D5 要修的那个缺陷（零结果一个字都不 hedge），
 * 而且不留任何报错痕迹。改成 `never` 兜底后，漏渲染在**编译期**就过不去。
 * @pure
 */
function describeOmissionForHint(omitted: GraphHonesty['resolutionOmitted']): string {
  if (omitted === undefined) return '';
  const reason = omitted.reason;
  switch (reason) {
    case 'non-caller-oriented-query':
      return '本工具当前无 callee 侧覆盖证据，零结果不等于该 symbol 无依赖';
    case 'callers-not-queried':
      return '本次未查询调用方，零结果不代表图中没有调用方';
    case 'no-symbols-in-graph':
      return '改动文件未落入图内，上游查询未执行，零结果不代表没有受影响的调用方';
    case 'query-constrained-to-zero':
      return '本次查询的 budget/depth 约束使遍历未执行，零结果与图内容无关，请放宽约束重试';
    default: {
      // 穷尽性证明：新增成因未在上面处理时，这里的赋值会在编译期报错。
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * F266 FR-011：把 freshness 四态翻译成一句人读提示（与 resolution 正交，恒可附加）。
 * @pure
 */
function describeFreshnessForHint(freshness: GraphFreshnessAdvisory | undefined): string {
  if (freshness === undefined) return '';
  switch (freshness.verdict.state) {
    case 'fresh':
      return '';
    case 'dirty':
      return '工作树有未提交的源码改动，图未包含这些改动';
    case 'stale':
      return '图已过期（源码或采集面已变），建议先运行 `spectra batch --mode graph-only` 重建';
    case 'unknown-provenance':
      return '图的来源版本不可知，无法判断是否已过期';
    default:
      return '';
  }
}

/** 用中文分号把非空片段拼成一句，避免出现空片段导致的连续分号 */
function joinSegments(segments: string[]): string {
  return segments.filter((s) => s.length > 0).join('；');
}

/**
 * 生成 nextStepHint 引导文本（中文）。
 * success 路径返回非空字符串（≥ 5 字符）；degraded 路径固定返回 ""。
 *
 * F266 FR-010：零结果场景的文案改为按 (resolution × freshness.state) 组合产出——
 * 原先"可能为顶层入口" / "暂无上游调用方" / "检查 symbol ID 是否正确"三句都用确定性口吻
 * 掩盖了不确定性（图的调用边覆盖率、导出面、图是否过期一概不提），是本卡要修的缺陷本体。
 * 未传 `honesty` 时退化为**不作确定性断言**的中性文案（不恢复旧的误导措辞）。
 *
 * @param honesty F266 追加入参；本函数只读它、不做任何 I/O，保持纯函数
 * @pure 无副作用，同步执行
 */
export function generateNextStepHint(
  toolName: 'impact' | 'detect_changes' | 'context',
  responseData: Record<string, unknown>,
  path: 'success' | 'degraded',
  honesty?: GraphHonesty,
): string {
  if (path === 'degraded') return '';

  const freshText = describeFreshnessForHint(honesty?.freshness);
  const zeroText =
    honesty === undefined ? '图的覆盖范围未知，零结果不等于确实没有' : describeResolutionForHint(honesty.resolution, honesty);

  if (toolName === 'impact') {
    const topImpacted = (responseData['topImpacted'] as TopImpacted[] | undefined) ?? [];
    const affected = (responseData['affected'] as unknown[] | undefined) ?? [];
    const top0 = topImpacted[0];
    // topImpacted 非空时优先按其内容生成 hint（包含 top id）
    if (top0 !== undefined) {
      const head =
        affected.length === 1
          ? `仅 1 个直接调用方 ${top0.id}，建议直接调 context 查看其上下文`
          : `建议接下来调 context for ${top0.id}（影响 score 最高，了解其调用链上下文）`;
      return joinSegments([head, freshText]);
    }
    // topImpacted 为空时根据 affected 数量决定
    if (affected.length === 0) {
      return joinSegments(['受影响范围为空', zeroText, freshText, '可改用 context 查看该 symbol 的定义与依赖']);
    }
    return joinSegments(['建议查看 affected 列表中的受影响 symbol', freshText]);
  }

  if (toolName === 'detect_changes') {
    const topImpacted = (responseData['topImpacted'] as TopImpacted[] | undefined) ?? [];
    const riskTier = (responseData['riskTier'] as string | undefined) ?? 'low';
    const totalChanged = (responseData['totalChanged'] as number | undefined) ?? 0;
    const top0 = topImpacted[0];
    const scopeText = honesty?.comparisonScope === undefined ? '' : '本次比较不含工作区未提交改动（三点记法）';
    if (top0 === undefined) {
      return joinSegments([
        `检测到 ${totalChanged} 个改动 symbol，图中未发现上游调用方`,
        zeroText,
        freshText,
        scopeText,
        '建议调 context 查看改动 symbol 的依赖',
      ]);
    }
    return joinSegments([
      `检测到 ${totalChanged} 个改动 symbol，风险等级 ${riskTier}，建议调 impact for ${top0.id} 评估影响范围`,
      freshText,
      scopeText,
    ]);
  }

  // context
  const definition = responseData['definition'] as { id?: string } | undefined;
  const rawCallers = responseData['callers'];
  const defId = definition?.id ?? '<unknown>';
  // 对抗审查 A1：`callers` 键**缺席**意味着本次 include 压根没查 caller 侧，
  // 不是"查了没有"。旧写法 `?? []` 把两者抹平，于是对一个图里确有几十个 caller 的 symbol
  // 一口咬定"在图中无调用方"。缺席时只如实说明未查询，不作任何存在性断言。
  if (!Array.isArray(rawCallers)) {
    return joinSegments([
      `本次未查询 ${defId} 的调用方（include 未包含 'callers'）`,
      freshText,
      "需要调用方时请带 include: ['callers'] 重查",
    ]);
  }
  const callers = rawCallers;
  if (callers.length === 0) {
    return joinSegments([`${defId} 在图中无调用方`, zeroText, freshText, '可查看 callees 确认其依赖']);
  }
  return joinSegments([
    `若将修改 ${defId}，建议调 impact for ${defId} 评估受影响的上游调用链`,
    freshText,
  ]);
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
