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

// ============================================================
// 估算
// ============================================================

/** output ≈ 0.3 × input */
const OUTPUT_RATIO = 0.3;

/** 估算假设的人类可读说明（写入报告） */
export const ESTIMATION_ASSUMPTION =
  'input ≈ estimateFast(源文件拼接文本)，output ≈ 0.3 × input。基于历史平均比率，首版不校准。';

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
  let input = 0;
  let loc = 0;
  for (const rel of files) {
    const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      input += estimateFast(content);
      loc += content.split('\n').length;
    } catch {
      // 读取失败跳过
    }
  }
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
