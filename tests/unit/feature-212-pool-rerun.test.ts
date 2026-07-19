/**
 * F212 — eval-pool-rerun 薄驱动纯函数单测。
 * 驱动零新增判分语义（聚合复用 eval-validate computeValidationStats/readOracleOutcome，
 * 已被 feature-206 + F210/T0 测试钉死）；本文件只锁编排层：job 矩阵 / resume 分区 /
 * fail-closed 判定 / 逐任务行分桶口径。
 */
import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  buildTaskJobs,
  partitionResumed,
  isTaskFullyExcluded,
  perTaskRows,
} from '../../scripts/eval-pool-rerun.mjs';

describe('F212 buildTaskJobs（job 矩阵与 calibrate 形状一致）', () => {
  it('c3 → tool=spec-driver-spectra-mcp，repeatNo 1..N，带 --swebench-oracle', () => {
    const jobs = buildTaskJobs('SWE-V008-sympy-contains-as-set-returns', 'c3', 3);
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j: { repeatNo: number }) => j.repeatNo)).toEqual([1, 2, 3]);
    for (const j of jobs) {
      expect(j.tool).toBe('spec-driver-spectra-mcp');
      expect(j.cohort).toBe('c3');
      expect(j.extraArgs).toEqual(['--swebench-oracle']);
    }
  });
  it('c1 → tool=control（cohort→tool 走校准单源映射，不硬编码）', () => {
    expect(buildTaskJobs('T', 'c1', 1)[0].tool).toBe('control');
  });
});

describe('F212 partitionResumed（能力终态跳过 / infra 重跑）', () => {
  const prior = [
    { task: 'A', repeatNo: 1, status: 'success' },
    { task: 'A', repeatNo: 2, status: 'infra' },      // 可重试 → 重跑
    { task: 'A', repeatNo: 3, status: 'gen_timeout' }, // 能力终态 → 跳过
    { task: 'B', repeatNo: 1, status: 'success' },     // 他 task，不影响 A
  ];
  it('success/gen_timeout 跳过，infra 与缺失重跑', () => {
    const { skip, rerunKeys } = partitionResumed(prior, 'A', 3);
    expect([...skip.keys()].sort()).toEqual(['A__r1', 'A__r3']);
    expect([...rerunKeys]).toEqual(['A__r2']);
  });
  it('error 状态（基础设施类，validate 口径剔分母）→ 重跑，不永久固化', () => {
    const { rerunKeys } = partitionResumed([{ task: 'A', repeatNo: 1, status: 'error' }], 'A', 1);
    expect([...rerunKeys]).toEqual(['A__r1']);
  });
  it('无 prior → 全部重跑', () => {
    const { skip, rerunKeys } = partitionResumed([], 'A', 2);
    expect(skip.size).toBe(0);
    expect([...rerunKeys]).toEqual(['A__r1', 'A__r2']);
  });
});

describe('F212 isTaskFullyExcluded（fail-closed 判定）', () => {
  const oe = (r: { fixturePath?: string }) => (r.fixturePath === '/oe' ? 'oracle_error' : true);
  it('全 infra → true', () => {
    expect(isTaskFullyExcluded([{ status: 'infra' }, { status: 'infra' }], oe)).toBe(true);
  });
  it('infra + success(oracle_error) 混合 → true（都是剔除类）', () => {
    expect(isTaskFullyExcluded([
      { status: 'infra' }, { status: 'success', fixturePath: '/oe' },
    ], oe)).toBe(true);
  });
  it('含 gen_timeout（能力 fail）→ false（不算系统性故障）', () => {
    expect(isTaskFullyExcluded([{ status: 'infra' }, { status: 'gen_timeout' }], oe)).toBe(false);
  });
  it('含真 success → false', () => {
    expect(isTaskFullyExcluded([{ status: 'success', fixturePath: '/pass' }], oe)).toBe(false);
  });
  it('空结果 → false（不误触发中止）', () => {
    expect(isTaskFullyExcluded([], oe)).toBe(false);
  });
});

describe('F212 perTaskRows（分桶与 computeValidationStats 同口径）', () => {
  const outcome = (r: { fixturePath?: string }) => {
    if (r.fixturePath === '/pass') return true;
    if (r.fixturePath === '/fail') return false;
    if (r.fixturePath === '/oe') return 'oracle_error';
    return null;
  };
  it('pass/fail/gen_timeout/oracle_error/oracle_missing 各归各桶，score 分母 = pass+fail', () => {
    const rows = perTaskRows([
      { task: 'T', status: 'success', fixturePath: '/pass' },
      { task: 'T', status: 'success', fixturePath: '/fail' },
      { task: 'T', status: 'gen_timeout' },
      { task: 'T', status: 'success', fixturePath: '/oe' },
      { task: 'T', status: 'success', fixturePath: '/missing' },
      { task: 'T', status: 'infra' },
    ], outcome);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pass).toBe(1);
    expect(row.fail).toBe(2);         // /fail + gen_timeout
    expect(row.genTimeout).toBe(1);
    expect(row.excluded).toBe(2);     // oracle_error + infra
    expect(row.oracleMissing).toBe(1);
    expect(row.score).toBe('1/3');
  });
  it('多 task 按 id 排序', () => {
    const rows = perTaskRows([
      { task: 'B', status: 'success', fixturePath: '/pass' },
      { task: 'A', status: 'success', fixturePath: '/pass' },
    ], outcome);
    expect(rows.map((r: { task: string }) => r.task)).toEqual(['A', 'B']);
  });
});

describe('F212 parseArgs', () => {
  it('默认值：pool-11 / c3 / N=3 / conc=1', () => {
    const a = parseArgs(['node', 'x']);
    expect(a.pool).toContain('pool-11.json');
    expect(a.cohort).toBe('c3');
    expect(a.repeats).toBe(3);
    expect(a.concurrency).toBe(1);
    expect(a.resume).toBe(false);
  });
  it('未知参数抛错（防 flag 拼错静默吞掉——F206 --cohort 血泪同款防护）', () => {
    expect(() => parseArgs(['node', 'x', '--chort', 'c3'])).toThrow(/未知参数/);
  });
  it('--repeats 非正整数抛错', () => {
    expect(() => parseArgs(['node', 'x', '--repeats', '0'])).toThrow(/repeats/);
  });
});
