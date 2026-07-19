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
  runKey,
} from '../../scripts/eval-pool-rerun.mjs';
import { ParallelRunPool } from '../../scripts/lib/parallel-run-pool.mjs';

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

describe('F212 partitionResumed（能力终态跳过 / infra+error 重跑 / 键含 tool+cohort）', () => {
  const T = 'spec-driver-spectra-mcp';
  const prior = [
    { task: 'A', tool: T, cohort: 'c3', repeatNo: 1, status: 'success' },
    { task: 'A', tool: T, cohort: 'c3', repeatNo: 2, status: 'infra' },      // 可重试 → 重跑
    { task: 'A', tool: T, cohort: 'c3', repeatNo: 3, status: 'gen_timeout' }, // 能力终态 → 跳过
    { task: 'B', tool: T, cohort: 'c3', repeatNo: 1, status: 'success' },     // 他 task，不影响 A
  ];
  it('success/gen_timeout 跳过，infra 与缺失重跑', () => {
    const { skip, rerunKeys } = partitionResumed(prior, 'A', 'c3', T, 3);
    expect([...skip.keys()].sort()).toEqual([`A__${T}__c3__r1`, `A__${T}__c3__r3`]);
    expect([...rerunKeys]).toEqual([`A__${T}__c3__r2`]);
  });
  it('error 状态（基础设施类，聚合剔分母）→ 重跑，不永久固化', () => {
    const { rerunKeys } = partitionResumed([{ task: 'A', tool: T, cohort: 'c3', repeatNo: 1, status: 'error' }], 'A', 'c3', T, 1);
    expect([...rerunKeys]).toEqual([`A__${T}__c3__r1`]);
  });
  it('codex HIGH：异 cohort/tool 的 success 不得冒名跳过（c1 结果不遮 c3 重跑）', () => {
    const alien = [{ task: 'A', tool: 'control', cohort: 'c1', repeatNo: 1, status: 'success' }];
    const { skip, rerunKeys } = partitionResumed(alien, 'A', 'c3', T, 1);
    expect(skip.size).toBe(0);
    expect([...rerunKeys]).toEqual([`A__${T}__c3__r1`]);
  });
  it('无 prior → 全部重跑', () => {
    const { skip, rerunKeys } = partitionResumed([], 'A', 'c3', T, 2);
    expect(skip.size).toBe(0);
    expect(rerunKeys.size).toBe(2);
  });
  it('runKey 含 task/tool/cohort/repeat 四元', () => {
    expect(runKey({ task: 'A', tool: T, cohort: 'c3', repeatNo: 2 })).toBe(`A__${T}__c3__r2`);
  });
});

describe('F212 ParallelRunPool._buildRunnerArgs repeat-index（codex HIGH：resume 部分重跑防错位）', () => {
  it('优先用 job.repeatNo（resume 只剩 r2 时 --repeat-index 必须是 2，不得回落 seqNo+1=1 覆盖 r1 现场）', () => {
    const pool = new ParallelRunPool({});
    const args = pool._buildRunnerArgs({ task: 't1', tool: 'control', cohort: 'c1', repeatNo: 2 }, 0, 'c1-r2');
    expect(args[args.indexOf('--repeat-index') + 1]).toBe('2');
  });
  it('无 repeatNo 的 legacy job 回退 seqNo+1（旧行为保持）', () => {
    const pool = new ParallelRunPool({});
    const args = pool._buildRunnerArgs({ task: 't1', tool: 'control', cohort: 'c1' }, 4, 'c1-r5');
    expect(args[args.indexOf('--repeat-index') + 1]).toBe('5');
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
  it('codex MED：success + outcome=null(oracle_missing) 也计剔除（系统性 oracle 读不到应尽早中止）', () => {
    const nullOracle = () => null;
    expect(isTaskFullyExcluded([
      { status: 'success', fixturePath: '/whatever' },
      { status: 'infra' },
    ], nullOracle)).toBe(true);
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
  it('五桶独立成列（infra/error/oracleError/oracleMissing/genTimeout），score 分母 = pass+fail', () => {
    const rows = perTaskRows([
      { task: 'T', status: 'success', fixturePath: '/pass' },
      { task: 'T', status: 'success', fixturePath: '/fail' },
      { task: 'T', status: 'gen_timeout' },
      { task: 'T', status: 'success', fixturePath: '/oe' },
      { task: 'T', status: 'success', fixturePath: '/missing' },
      { task: 'T', status: 'infra' },
      { task: 'T', status: 'error' },
    ], outcome);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pass).toBe(1);
    expect(row.fail).toBe(2);          // /fail + gen_timeout
    expect(row.genTimeout).toBe(1);
    expect(row.infra).toBe(1);
    expect(row.error).toBe(1);
    expect(row.oracleError).toBe(1);
    expect(row.oracleMissing).toBe(1);
    expect(row.excluded).toBe(3);      // infra + error + oracleError（派生和）
    expect(row.score).toBe('1/3');
    // 七桶完备性：pass+fail(含 genTimeout)+infra+error+oracleError+oracleMissing == nRuns
    expect(row.pass + row.fail + row.infra + row.error + row.oracleError + row.oracleMissing).toBe(row.nRuns);
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
