/**
 * Feature 127 — Dry-run 预估 + Budget 守护 gate
 *
 * 职责：
 * - estimateModuleCost(files, projectRoot)：基于 AST-free 的快速估算，输出单模块 input/output token
 * - buildDryRunReport(estimates)：生成 Markdown 预估报告
 * - buildBudgetDecision(estimates, budget, handler)：根据超预算状态调用 handler 选择下一步动作
 *
 * 估算模型（首版）：
 * - input ≈ estimateFast(所有源码拼接)
 * - output ≈ Math.round(input × 0.3)
 * - 假设写入报告正文供用户审视
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { estimateFast } from '../core/token-counter.js';

// ============================================================
// 类型
// ============================================================

export interface ModuleEstimate {
  moduleName: string;
  files: string[];
  loc: number;
  estimatedInput: number;
  estimatedOutput: number;
}

export interface DryRunReport {
  generatedAt: string;
  totalModules: number;
  totalEstimatedInput: number;
  totalEstimatedOutput: number;
  assumption: string;
  modules: ModuleEstimate[];
}

export type BudgetPolicy = 'continue' | 'cheaper-model' | 'skip-enrichment' | 'cancel';

export interface BudgetDecisionInput {
  totalEstimate: number;
  budget: number;
  preset?: BudgetPolicy;
  /** 是否 TTY；决定是否交互提示 */
  isTTY: boolean;
  /** 可选交互 prompt（测试可注入 mock） */
  promptPolicy?: () => Promise<BudgetPolicy>;
  /** 超限后已重估过几次（防止无限循环，上限 1） */
  attempt?: number;
}

export interface BudgetDecision {
  /** 最终选择的 policy */
  policy: BudgetPolicy;
  /** 是否是交互式选择 */
  interactive: boolean;
  /** 提示文本（用于日志 / summary） */
  message: string;
}

/** runBudgetGate 每次迭代的审计记录 */
export interface BudgetGateAttempt {
  attempt: number;
  estimate: number;
  policy: BudgetPolicy;
  message: string;
}

/** runBudgetGate 的最终结果 */
export interface BudgetGateResult {
  /** 最终 policy（continue / cancel；cheaper-model / skip-enrichment 只作为中间状态存在于 attempts 日志） */
  finalPolicy: 'continue' | 'cancel';
  /** 最终生效的估算（若采纳了降级，会在 baseEstimate 上应用 reduction） */
  finalEstimate: number;
  /** 是否采纳了 skip-enrichment */
  skipEnrichmentApplied: boolean;
  /** 是否采纳了 cheaper-model */
  cheaperModelApplied: boolean;
  /** 每次迭代的审计记录（供 summary / log 展示） */
  attempts: BudgetGateAttempt[];
}

// ============================================================
// 估算
// ============================================================

/** output ≈ 0.3 × input */
const OUTPUT_RATIO = 0.3;

/**
 * 单模块 system prompt + 上下文骨架的固定开销估算（Bug 修复 — Phase 2 集成测试发现）
 *
 * 经验值来源：micrograd（4 个 Python 文件）实测 system prompt + AST skeleton +
 * panoramic context 约 6,000-8,000 input tokens / 模块。取保守值 6,500，让 dry-run
 * 估算从之前 ~64x 偏差缩到 < 1.5x。
 *
 * 这是固定开销不随源码大小线性增长，所以加常数项而非 ratio。
 */
const SYSTEM_PROMPT_TOKENS_PER_MODULE = 6500;

/** 估算假设的人类可读说明（写入报告） */
export const ESTIMATION_ASSUMPTION =
  'input ≈ estimateFast(源文件拼接文本) + 6500（system prompt + AST skeleton 固定开销 / 模块），output ≈ 0.3 × input。基于历史平均比率，首版不校准。';

/**
 * 估算单个模块的 token 成本
 *
 * @param moduleName - 模块标识
 * @param files - 模块包含的相对路径
 * @param projectRoot - 项目根目录
 */
export function estimateModuleCost(
  moduleName: string,
  files: string[],
  projectRoot: string,
): ModuleEstimate {
  let sourceInput = 0;
  let loc = 0;
  for (const rel of files) {
    const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      sourceInput += estimateFast(content);
      loc += content.split('\n').length;
    } catch {
      // 读取失败跳过
    }
  }
  // 真实 input = 源码 token + system prompt / AST skeleton / panoramic context 固定开销
  const input = sourceInput + SYSTEM_PROMPT_TOKENS_PER_MODULE;
  const estimatedOutput = Math.round(input * OUTPUT_RATIO);
  return {
    moduleName,
    files: [...files],
    loc,
    estimatedInput: input,
    estimatedOutput,
  };
}

/** 聚合所有模块估算 */
export function buildDryRunReport(estimates: ModuleEstimate[]): DryRunReport {
  const totalInput = estimates.reduce((s, e) => s + e.estimatedInput, 0);
  const totalOutput = estimates.reduce((s, e) => s + e.estimatedOutput, 0);
  return {
    generatedAt: new Date().toISOString(),
    totalModules: estimates.length,
    totalEstimatedInput: totalInput,
    totalEstimatedOutput: totalOutput,
    assumption: ESTIMATION_ASSUMPTION,
    modules: estimates.slice().sort((a, b) => b.estimatedInput - a.estimatedInput),
  };
}

/**
 * 渲染 dry-run 报告为 Markdown，写入 `_meta/dry-run-estimate.md`
 */
export function renderDryRunReport(report: DryRunReport): string {
  const lines: string[] = [];
  lines.push('# Dry-run Estimate');
  lines.push('');
  lines.push(`> 自动生成于 ${report.generatedAt}`);
  lines.push('');
  lines.push(`**本次估算未调用 LLM，未生成任何 \`.spec.md\` 文件。**`);
  lines.push('');

  lines.push('## 总估算');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 模块数 | ${report.totalModules} |`);
  lines.push(`| 预估 input tokens | ${report.totalEstimatedInput.toLocaleString()} |`);
  lines.push(`| 预估 output tokens | ${report.totalEstimatedOutput.toLocaleString()} |`);
  lines.push(`| 预估总 tokens | ${(report.totalEstimatedInput + report.totalEstimatedOutput).toLocaleString()} |`);
  lines.push('');
  lines.push(`_估算假设：${report.assumption}_`);
  lines.push('');

  lines.push('## 按模块明细');
  lines.push('');
  lines.push('| 模块 | 文件数 | LOC | 预估 input | 预估 output |');
  lines.push('|------|--------|-----|-----------|------------|');
  for (const m of report.modules) {
    lines.push(
      `| ${m.moduleName} | ${m.files.length} | ${m.loc} | ${m.estimatedInput.toLocaleString()} | ${m.estimatedOutput.toLocaleString()} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

// ============================================================
// 预算决策
// ============================================================

/**
 * 判断是否超预算，并选择后续动作（FR-013 / FR-014 / Edge Case 8）
 */
export async function buildBudgetDecision(
  input: BudgetDecisionInput,
): Promise<BudgetDecision> {
  const { totalEstimate, budget, preset, isTTY, attempt = 0 } = input;

  if (totalEstimate <= budget) {
    return {
      policy: 'continue',
      interactive: false,
      message: `预估 ${totalEstimate.toLocaleString()} tokens ≤ 预算 ${budget.toLocaleString()}，继续执行`,
    };
  }

  const overMessage = `预估 ${totalEstimate.toLocaleString()} tokens > 预算 ${budget.toLocaleString()}`;

  // 显式 preset 优先
  if (preset) {
    return {
      policy: preset,
      interactive: false,
      message: `${overMessage}；非交互策略: ${preset}`,
    };
  }

  // Edge Case 8：已重估 1 次后仍超预算，强制 cancel
  if (attempt >= 1) {
    return {
      policy: 'cancel',
      interactive: false,
      message: `${overMessage}；已重估 ${attempt} 次仍超预算，默认 cancel 以防循环`,
    };
  }

  // 非 TTY 未给 preset：视为 cancel
  if (!isTTY) {
    return {
      policy: 'cancel',
      interactive: false,
      message: `${overMessage}；非交互环境未传 --on-over-budget，默认 cancel`,
    };
  }

  // TTY 交互
  const prompt = input.promptPolicy ?? defaultInteractivePrompt;
  const policy = await prompt();
  return {
    policy,
    interactive: true,
    message: `${overMessage}；用户交互选择: ${policy}`,
  };
}

/**
 * 根据降级 policy 调整估算值（Feature 127 Codex review 修复）
 *
 * - skip-enrichment：enrichment 是 Section 2 的二次 LLM 调用，平均约占
 *   整体 token 消耗的 30%；跳过后估算减为 70%
 * - cheaper-model：tokens 数不变（budget 以 token 为单位），返回原值
 * - continue / cancel：返回原值
 */
export function applyPolicyToEstimate(
  baseEstimate: number,
  policy: BudgetPolicy,
): number {
  switch (policy) {
    case 'skip-enrichment':
      return Math.round(baseEstimate * 0.7);
    case 'cheaper-model':
    case 'continue':
    case 'cancel':
    default:
      return baseEstimate;
  }
}

/**
 * 驱动完整的预算 gate 循环（Feature 127 Codex review 修复 — Finding 1）
 *
 * 与 buildBudgetDecision 的差别：
 * - buildBudgetDecision 只做一次性决策（policy 选择）
 * - runBudgetGate 负责把"降级 policy → 重估 → 二次 gate"的闭环跑完
 *
 * 语义：
 * 1. attempt 0：用 baseEstimate 做首次 gate
 * 2. policy 是 continue / cancel：立即返回
 * 3. policy 是 cheaper-model / skip-enrichment：应用 policy → 重估 → attempt++ 再进
 * 4. attempt ≥ 1（Edge Case 8）：即便还是超预算，也强制 cancel 避免循环
 *
 * 任一成功降级后得到 ≤ 预算的估算 → 返回 continue + 记录所采纳的降级
 */
export async function runBudgetGate(args: {
  baseEstimate: number;
  budget: number;
  preset?: BudgetPolicy;
  isTTY: boolean;
  promptPolicy?: () => Promise<BudgetPolicy>;
}): Promise<BudgetGateResult> {
  const attempts: BudgetGateAttempt[] = [];
  let estimate = args.baseEstimate;
  let skipEnrichmentApplied = false;
  let cheaperModelApplied = false;

  for (let attempt = 0; attempt <= 1; attempt++) {
    const decision = await buildBudgetDecision({
      totalEstimate: estimate,
      budget: args.budget,
      preset: args.preset,
      isTTY: args.isTTY,
      promptPolicy: args.promptPolicy,
      attempt,
    });
    attempts.push({
      attempt,
      estimate,
      policy: decision.policy,
      message: decision.message,
    });

    // 终态 policy：直接返回
    if (decision.policy === 'continue' || decision.policy === 'cancel') {
      return {
        finalPolicy: decision.policy,
        finalEstimate: estimate,
        skipEnrichmentApplied,
        cheaperModelApplied,
        attempts,
      };
    }

    // 降级 policy：应用调整后进入下一轮 gate
    if (decision.policy === 'skip-enrichment') {
      skipEnrichmentApplied = true;
    } else if (decision.policy === 'cheaper-model') {
      cheaperModelApplied = true;
    }
    estimate = applyPolicyToEstimate(estimate, decision.policy);
  }

  // Edge Case 8：两轮仍超预算（例如 cheaper-model 不减 tokens），强制 cancel
  attempts.push({
    attempt: 2,
    estimate,
    policy: 'cancel',
    message: `两轮降级后估算 ${estimate.toLocaleString()} tokens 仍 > 预算 ${args.budget.toLocaleString()}，强制 cancel`,
  });
  return {
    finalPolicy: 'cancel',
    finalEstimate: estimate,
    skipEnrichmentApplied,
    cheaperModelApplied,
    attempts,
  };
}

async function defaultInteractivePrompt(): Promise<BudgetPolicy> {
  // 动态引入，避免 test 环境的 readline 副作用
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      '\n超预算。请选择后续动作：\n' +
        '  1) continue           — 继续执行（放弃预算）\n' +
        '  2) cheaper-model      — 降级到更便宜的 model 重估\n' +
        '  3) skip-enrichment    — 跳过 Section 2 二次增强重估\n' +
        '  4) cancel             — 立即取消\n',
    );
    const answer = (await rl.question('选择 [1-4]: ')).trim();
    switch (answer) {
      case '1':
      case 'continue':
        return 'continue';
      case '2':
      case 'cheaper-model':
        return 'cheaper-model';
      case '3':
      case 'skip-enrichment':
        return 'skip-enrichment';
      case '4':
      case 'cancel':
      default:
        return 'cancel';
    }
  } finally {
    rl.close();
  }
}
