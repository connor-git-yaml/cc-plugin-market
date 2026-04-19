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
} from '../../src/batch/budget-gate.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-budget-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('estimateModuleCost', () => {
  it('空文件列表返回零估算', () => {
    const est = estimateModuleCost('empty', [], tmpDir);
    expect(est.estimatedInput).toBe(0);
    expect(est.estimatedOutput).toBe(0);
    expect(est.loc).toBe(0);
  });

  it('基于 estimateFast 计算 input，output 为 0.3 × input', () => {
    const file = 'a.ts';
    fs.writeFileSync(path.join(tmpDir, file), 'const x = 1;\n'.repeat(100));
    const est = estimateModuleCost('m', [file], tmpDir);
    expect(est.estimatedInput).toBeGreaterThan(0);
    expect(est.estimatedOutput).toBe(Math.round(est.estimatedInput * 0.3));
    expect(est.loc).toBe(101); // 100 行 + 1 trailing newline
  });

  it('读取失败的文件静默跳过', () => {
    const est = estimateModuleCost('bad', ['nonexistent.ts'], tmpDir);
    expect(est.estimatedInput).toBe(0);
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
