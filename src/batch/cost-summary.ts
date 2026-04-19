/**
 * Feature 127 — Batch 成本汇总
 *
 * 提供：
 * - CostSummary 类型定义
 * - aggregateCostSummary() 聚合每模块 CostMetadata 为批级汇总
 * - renderSummaryCostSection() / renderQualityCostSection() 渲染 Markdown
 *
 * 职责边界：
 * - 只负责聚合与渲染；不触碰 LLM 调用、不落盘
 * - 渲染出的 Markdown 由调用方追加到 batch-summary.md / quality-report.md
 */
import type { CostMetadata } from '../models/module-spec.js';

// ============================================================
// 类型
// ============================================================

/** 单个模块的成本记录 */
export interface ModuleCostRecord {
  moduleName: string;
  /** 总代码行数（用于 tokens/kLOC 指标；未知时传 0） */
  loc: number;
  cost: CostMetadata;
}

/** 预估成本（dry-run / budget 场景） */
export interface EstimatedCost {
  /** 所有模块预估 input token 总和 */
  totalInput: number;
  /** 所有模块预估 output token 总和 */
  totalOutput: number;
  /** 用户可读的假设说明（例如 "output ≈ 0.3 × input"） */
  assumption: string;
}

/** 批处理成本汇总 */
export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  /** 按模块的明细，降序排列 */
  byModule: Array<{
    moduleName: string;
    input: number;
    output: number;
    durationMs: number;
    llmModel: string;
    fallbackReason: string | null;
    loc: number;
  }>;
  /** 按生成器（实际 llmModel）的聚合 */
  byGenerator: Array<{
    generator: string;
    input: number;
    output: number;
    /** 该生成器 token 总量占总量的百分比（0-100，保留一位小数） */
    share: number;
    moduleCount: number;
  }>;
  /** 总代码行数（用于 tokens/kLOC） */
  totalLoc: number;
  /** 预估（若传入） */
  estimated?: EstimatedCost;
  /** 实际 vs 预估偏差百分比（仅 estimated 存在时计算；> 20 时告警） */
  actualVsEstimatedDelta?: number;
}

// ============================================================
// 聚合
// ============================================================

/**
 * 聚合每模块 CostMetadata 为 CostSummary
 *
 * @param records - 模块级成本记录；允许为空（返回全零 summary）
 * @param estimated - 预估值（可选，来自 dry-run / budget 预检）
 */
export function aggregateCostSummary(
  records: ModuleCostRecord[],
  estimated?: EstimatedCost,
): CostSummary {
  let totalInput = 0;
  let totalOutput = 0;
  let totalDuration = 0;
  let totalLoc = 0;

  for (const rec of records) {
    totalInput += rec.cost.tokenUsage.input;
    totalOutput += rec.cost.tokenUsage.output;
    totalDuration += rec.cost.durationMs;
    totalLoc += rec.loc;
  }

  // 按模块明细：按 input+output 降序
  const byModule = records
    .map((rec) => ({
      moduleName: rec.moduleName,
      input: rec.cost.tokenUsage.input,
      output: rec.cost.tokenUsage.output,
      durationMs: rec.cost.durationMs,
      llmModel: rec.cost.llmModel,
      fallbackReason: rec.cost.fallbackReason,
      loc: rec.loc,
    }))
    .sort((a, b) => b.input + b.output - (a.input + a.output));

  // 按生成器分组：llmModel 为空字符串时归入 'ast-only'
  const generatorMap = new Map<
    string,
    { input: number; output: number; moduleCount: number }
  >();
  for (const rec of records) {
    const key = rec.cost.llmModel || 'ast-only';
    const existing = generatorMap.get(key) ?? { input: 0, output: 0, moduleCount: 0 };
    existing.input += rec.cost.tokenUsage.input;
    existing.output += rec.cost.tokenUsage.output;
    existing.moduleCount += 1;
    generatorMap.set(key, existing);
  }

  const totalTokens = totalInput + totalOutput;
  const byGenerator = [...generatorMap.entries()]
    .map(([generator, v]) => ({
      generator,
      input: v.input,
      output: v.output,
      share: totalTokens > 0
        ? Math.round(((v.input + v.output) / totalTokens) * 1000) / 10
        : 0,
      moduleCount: v.moduleCount,
    }))
    .sort((a, b) => b.input + b.output - (a.input + a.output));

  const summary: CostSummary = {
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalDurationMs: totalDuration,
    byModule,
    byGenerator,
    totalLoc,
  };

  // 预估对比
  if (estimated) {
    summary.estimated = estimated;
    const estimatedTotal = estimated.totalInput + estimated.totalOutput;
    if (estimatedTotal > 0) {
      const actualTotal = totalTokens;
      summary.actualVsEstimatedDelta =
        Math.round(((actualTotal - estimatedTotal) / estimatedTotal) * 1000) / 10;
    }
  }

  return summary;
}

// ============================================================
// 渲染
// ============================================================

/**
 * 渲染给 batch-summary.md 的 "LLM 成本汇总" 节
 * FR-008
 */
export function renderSummaryCostSection(summary: CostSummary): string {
  const lines: string[] = [];
  lines.push('## LLM 成本汇总');
  lines.push('');

  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
  if (totalTokens === 0) {
    lines.push('本次 batch 未调用 LLM（可能为 AST-only 或 dry-run 模式）。');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 总 input tokens | ${summary.totalInputTokens.toLocaleString()} |`);
  lines.push(`| 总 output tokens | ${summary.totalOutputTokens.toLocaleString()} |`);
  lines.push(`| 总 token 数 | ${totalTokens.toLocaleString()} |`);
  lines.push(`| LLM 总耗时 | ${(summary.totalDurationMs / 1000).toFixed(1)}s |`);
  if (summary.totalLoc > 0) {
    const tokensPerKLoc = Math.round((totalTokens / summary.totalLoc) * 1000);
    lines.push(`| tokens / kLOC | ${tokensPerKLoc.toLocaleString()} |`);
  }
  lines.push('');

  // 按生成器
  lines.push('### 按生成器分组');
  lines.push('');
  lines.push('| 生成器 / Model | 模块数 | input | output | 占比 |');
  lines.push('|----------------|--------|-------|--------|------|');
  for (const g of summary.byGenerator) {
    lines.push(
      `| \`${g.generator}\` | ${g.moduleCount} | ${g.input.toLocaleString()} | ${g.output.toLocaleString()} | ${g.share.toFixed(1)}% |`,
    );
  }
  lines.push('');

  // 按模块（从高到低，最多 20 条，避免报告过长）
  lines.push('### 按模块分组（Top 20，从高到低）');
  lines.push('');
  lines.push('| 模块 | Model | input | output | 耗时 | 降级 |');
  lines.push('|------|-------|-------|--------|------|------|');
  for (const m of summary.byModule.slice(0, 20)) {
    const fb = m.fallbackReason ? `⚠ ${m.fallbackReason}` : '—';
    const model = m.llmModel || 'ast-only';
    lines.push(
      `| ${m.moduleName} | \`${model}\` | ${m.input.toLocaleString()} | ${m.output.toLocaleString()} | ${(m.durationMs / 1000).toFixed(1)}s | ${fb} |`,
    );
  }
  if (summary.byModule.length > 20) {
    lines.push('');
    lines.push(`_...另有 ${summary.byModule.length - 20} 个模块未展示_`);
  }
  lines.push('');

  // 预估对比
  if (summary.estimated) {
    const est = summary.estimated;
    lines.push('### 预估 vs 实际');
    lines.push('');
    lines.push('| 指标 | 预估 | 实际 |');
    lines.push('|------|------|------|');
    lines.push(`| input tokens | ${est.totalInput.toLocaleString()} | ${summary.totalInputTokens.toLocaleString()} |`);
    lines.push(`| output tokens | ${est.totalOutput.toLocaleString()} | ${summary.totalOutputTokens.toLocaleString()} |`);
    lines.push('');
    lines.push(`- 预估假设：${est.assumption}`);
    if (typeof summary.actualVsEstimatedDelta === 'number') {
      const delta = summary.actualVsEstimatedDelta;
      const sign = delta > 0 ? '+' : '';
      const warn = Math.abs(delta) > 20 ? ' ⚠ 偏差超 20%，估算模型需调整' : '';
      lines.push(`- 偏差：${sign}${delta.toFixed(1)}%${warn}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 渲染给 quality-report.md 的 "LLM 成本与预算" 节
 * FR-009
 */
export function renderQualityCostSection(summary: CostSummary): string {
  const lines: string[] = [];
  lines.push('## LLM 成本与预算');
  lines.push('');

  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
  if (totalTokens === 0) {
    lines.push('本次 batch 未调用 LLM。成本为 0。');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('### 本次总成本');
  lines.push('');
  lines.push(`- 总 input tokens: **${summary.totalInputTokens.toLocaleString()}**`);
  lines.push(`- 总 output tokens: **${summary.totalOutputTokens.toLocaleString()}**`);
  lines.push(`- 总耗时: **${(summary.totalDurationMs / 1000).toFixed(1)}s**`);
  if (summary.totalLoc > 0) {
    const tokensPerKLoc = Math.round((totalTokens / summary.totalLoc) * 1000);
    lines.push(`- 性价比: **${tokensPerKLoc.toLocaleString()} tokens / kLOC** (${summary.totalLoc.toLocaleString()} LOC)`);
  }
  lines.push('');

  lines.push('### 按生成器占比');
  lines.push('');
  lines.push('| 生成器 | 占比 | 模块数 |');
  lines.push('|--------|------|--------|');
  for (const g of summary.byGenerator) {
    lines.push(`| \`${g.generator}\` | ${g.share.toFixed(1)}% | ${g.moduleCount} |`);
  }
  lines.push('');

  if (
    summary.estimated &&
    typeof summary.actualVsEstimatedDelta === 'number' &&
    Math.abs(summary.actualVsEstimatedDelta) > 20
  ) {
    lines.push('> ⚠ 本次估算与实际偏差超 20%（' +
      (summary.actualVsEstimatedDelta > 0 ? '+' : '') +
      summary.actualVsEstimatedDelta.toFixed(1) +
      '%），估算可靠性低，建议校准估算模型。');
    lines.push('');
  }

  return lines.join('\n');
}
