/**
 * Feature 127: dry-run 估算 + 预算 gate 单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  estimateModuleCost,
  buildDryRunReport,
  renderDryRunReport,
  buildBudgetDecision,
  applyPolicyToEstimate,
  runBudgetGate,
} from '../../src/batch/budget-gate.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-budget-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('estimateModuleCost', () => {
  // system prompt + AST skeleton + panoramic context 固定开销（来自 budget-gate.ts SYSTEM_PROMPT_TOKENS_PER_MODULE）
  const SYSTEM_PROMPT_TOKENS = 6500;

  it('空文件列表只含 system prompt 固定开销（修正 dry-run 64x 偏差）', () => {
    const est = estimateModuleCost('empty', [], tmpDir);
    // 不再是 0 — 即使没源码也要算 system prompt 开销
    expect(est.estimatedInput).toBe(SYSTEM_PROMPT_TOKENS);
    expect(est.estimatedOutput).toBe(Math.round(SYSTEM_PROMPT_TOKENS * 0.3));
    expect(est.loc).toBe(0);
  });

  it('基于 estimateFast 计算 input + system prompt 累加，output 为 0.3 × input', () => {
    const file = 'a.ts';
    fs.writeFileSync(path.join(tmpDir, file), 'const x = 1;\n'.repeat(100));
    const est = estimateModuleCost('m', [file], tmpDir);
    // estimatedInput = 源码 token + system prompt 固定开销
    expect(est.estimatedInput).toBeGreaterThan(SYSTEM_PROMPT_TOKENS);
    expect(est.estimatedOutput).toBe(Math.round(est.estimatedInput * 0.3));
    expect(est.loc).toBe(101); // 100 行 + 1 trailing newline
  });

  it('system prompt 固定开销让 dry-run 偏差从 64x 缩到 < 1.5x（Phase 2 集成测试发现）', () => {
    // 模拟 micrograd 单文件场景：源文件 ~30 行 ≈ 200 tokens
    const file = 'engine.py';
    fs.writeFileSync(path.join(tmpDir, file), 'class Value:\n    pass\n'.repeat(15));
    const est = estimateModuleCost('engine', [file], tmpDir);
    // 源码估算约 100-200 token；加上 6500 system prompt 后总估算应 ≥ 6500
    // 实测真实 LLM 调用约 7000-8000 input/模块（micrograd 案例），偏差应 < 1.5x
    expect(est.estimatedInput).toBeGreaterThanOrEqual(SYSTEM_PROMPT_TOKENS);
    expect(est.estimatedInput).toBeLessThan(SYSTEM_PROMPT_TOKENS + 5000);
  });

  it('读取失败的文件静默跳过，但 system prompt 开销仍算', () => {
    const est = estimateModuleCost('bad', ['nonexistent.ts'], tmpDir);
    // 即使所有文件都读取失败，仍有 system prompt 固定开销
    expect(est.estimatedInput).toBe(SYSTEM_PROMPT_TOKENS);
  });
});

describe('buildDryRunReport + renderDryRunReport', () => {
  it('按 estimatedInput 降序排列模块', () => {
    const ests = [
      { moduleName: 's', files: [], loc: 10, estimatedInput: 100, estimatedOutput: 30 },
      { moduleName: 'b', files: [], loc: 50, estimatedInput: 5000, estimatedOutput: 1500 },
      { moduleName: 'm', files: [], loc: 30, estimatedInput: 1000, estimatedOutput: 300 },
    ];
    const report = buildDryRunReport(ests);
    expect(report.modules.map((m) => m.moduleName)).toEqual(['b', 'm', 's']);
    expect(report.totalEstimatedInput).toBe(6100);
    expect(report.totalEstimatedOutput).toBe(1830);
  });

  it('渲染报告含"未调用 LLM"声明', () => {
    const report = buildDryRunReport([]);
    const md = renderDryRunReport(report);
    expect(md).toContain('Dry-run Estimate');
    expect(md).toContain('未调用 LLM');
    expect(md).toContain('估算假设');
  });
});

describe('buildBudgetDecision', () => {
  it('未超预算 → continue', async () => {
    const d = await buildBudgetDecision({
      totalEstimate: 100,
      budget: 500,
      isTTY: true,
    });
    expect(d.policy).toBe('continue');
    expect(d.interactive).toBe(false);
  });

  it('超预算 + 显式 preset = cheaper-model', async () => {
    const d = await buildBudgetDecision({
      totalEstimate: 1000,
      budget: 500,
      preset: 'cheaper-model',
      isTTY: true,
    });
    expect(d.policy).toBe('cheaper-model');
    expect(d.interactive).toBe(false);
  });

  it('超预算 + 非 TTY + 无 preset → cancel', async () => {
    const d = await buildBudgetDecision({
      totalEstimate: 1000,
      budget: 500,
      isTTY: false,
    });
    expect(d.policy).toBe('cancel');
  });

  it('超预算 + TTY + promptPolicy 注入 → 使用注入值', async () => {
    const d = await buildBudgetDecision({
      totalEstimate: 1000,
      budget: 500,
      isTTY: true,
      promptPolicy: async () => 'skip-enrichment',
    });
    expect(d.policy).toBe('skip-enrichment');
    expect(d.interactive).toBe(true);
  });

  it('attempt >= 1 + 超预算 → 强制 cancel（防无限循环）', async () => {
    const d = await buildBudgetDecision({
      totalEstimate: 1000,
      budget: 500,
      isTTY: true,
      attempt: 1,
      promptPolicy: async () => 'cheaper-model',
    });
    expect(d.policy).toBe('cancel');
    expect(d.message).toContain('已重估');
  });

  it('未超预算时不消费 promptPolicy', async () => {
    let promptCalled = false;
    const d = await buildBudgetDecision({
      totalEstimate: 100,
      budget: 500,
      isTTY: true,
      promptPolicy: async () => {
        promptCalled = true;
        return 'cancel';
      },
    });
    expect(d.policy).toBe('continue');
    expect(promptCalled).toBe(false);
  });
});

describe('applyPolicyToEstimate', () => {
  it('skip-enrichment 把估算降至 70%', () => {
    expect(applyPolicyToEstimate(1000, 'skip-enrichment')).toBe(700);
  });

  it('cheaper-model / continue / cancel 不改变估算（token 口径不变）', () => {
    expect(applyPolicyToEstimate(1000, 'cheaper-model')).toBe(1000);
    expect(applyPolicyToEstimate(1000, 'continue')).toBe(1000);
    expect(applyPolicyToEstimate(1000, 'cancel')).toBe(1000);
  });
});

describe('runBudgetGate', () => {
  it('未超预算 → finalPolicy=continue，attempts 仅 1 轮', async () => {
    const r = await runBudgetGate({
      baseEstimate: 100,
      budget: 500,
      isTTY: true,
    });
    expect(r.finalPolicy).toBe('continue');
    expect(r.finalEstimate).toBe(100);
    expect(r.attempts).toHaveLength(1);
    expect(r.skipEnrichmentApplied).toBe(false);
    expect(r.cheaperModelApplied).toBe(false);
  });

  it('超预算 + preset=cancel → 单轮 cancel', async () => {
    const r = await runBudgetGate({
      baseEstimate: 1000,
      budget: 500,
      preset: 'cancel',
      isTTY: true,
    });
    expect(r.finalPolicy).toBe('cancel');
    expect(r.attempts).toHaveLength(1);
  });

  it('超预算 + preset=skip-enrichment + 降级后仍在预算内 → continue', async () => {
    // 预算 800, baseEstimate 1000, 降级至 700 < 800 → continue
    const r = await runBudgetGate({
      baseEstimate: 1000,
      budget: 800,
      preset: 'skip-enrichment',
      isTTY: true,
    });
    expect(r.finalPolicy).toBe('continue');
    expect(r.skipEnrichmentApplied).toBe(true);
    expect(r.cheaperModelApplied).toBe(false);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0]!.policy).toBe('skip-enrichment');
    expect(r.attempts[1]!.policy).toBe('continue');
    expect(r.finalEstimate).toBe(700);
  });

  it('超预算 + preset=skip-enrichment + 降级后仍超预算 → 强制 cancel（Edge Case 8）', async () => {
    // baseEstimate=10000, budget=100; skip-enrichment → 7000, 仍超
    // 第二轮强制走 attempt=1 分支触发 cancel
    const r = await runBudgetGate({
      baseEstimate: 10000,
      budget: 100,
      preset: 'skip-enrichment',
      isTTY: false,
    });
    expect(r.finalPolicy).toBe('cancel');
    expect(r.skipEnrichmentApplied).toBe(true);
  });

  it('超预算 + preset=cheaper-model → tokens 不变 → 必然 cancel（Codex review 揭示的设计事实）', async () => {
    const r = await runBudgetGate({
      baseEstimate: 1000,
      budget: 500,
      preset: 'cheaper-model',
      isTTY: false,
    });
    // 第 1 轮选 cheaper-model，但 applyPolicyToEstimate 不降 token；
    // 第 2 轮 attempt=1 强制 cancel（buildBudgetDecision 的 Edge Case 8）
    expect(r.finalPolicy).toBe('cancel');
    expect(r.cheaperModelApplied).toBe(true);
  });

  it('支持连续两轮的交互式 prompt（首轮 skip-enrichment 失败后，Edge Case 8 强制 cancel）', async () => {
    const choices: ('skip-enrichment' | 'cancel')[] = ['skip-enrichment', 'cancel'];
    let i = 0;
    const r = await runBudgetGate({
      baseEstimate: 10000,
      budget: 100,
      isTTY: true,
      promptPolicy: async () => choices[i++]!,
    });
    // 降级 10000 → 7000 仍超预算，第 2 轮 attempt=1 强制 cancel（不消费第二个 choice）
    expect(r.finalPolicy).toBe('cancel');
  });
});
