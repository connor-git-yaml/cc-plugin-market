/**
 * F206 单元测试：难度校准评测/验证 harness
 *
 * 覆盖（纯函数 mock，不跑 docker）：
 *   T-C0a  eval-task-runner exit 3/4 拆分语义（F188 回归）
 *   T-C0   parallel-run-pool：并发上限 / 唯一键确定性 / 超时 / over-budget kill / exit码分类
 *   T-C1   eval-calibrate：难度打分 / discriminating 判据（CI 重叠 vs 不重叠）/ 全饱和剔除
 *   T-C2   eval-split-sets：分层 disjoint / 无重叠 / 分箱分布 / 池太小报错 / seed 可复现
 *   T-C3   eval-validate：passRate 聚合 / infra 剔分母 / gen_timeout 计 fail / fail-closed
 *   T-C4   比较纪律（compareWithBaseline）：噪声内不 keep / 超 MIN_DELTA 才 keep
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

// ── T-C1 eval-calibrate ────────────────────────────────────────────────────────
import {
  heuristicDifficultyScore,
  heuristicPrefilter,
  isDiscriminating,
  oraclePassedFromFixture,
  oracleOutcomeFromFixture,
  aggregateRunResults,
  CALIBRATION_COHORT_TO_TOOL,
} from '../../scripts/eval-calibrate.mjs';

// ── T-C2 eval-split-sets ──────────────────────────────────────────────────────
import {
  binByC3PassRate,
  stratifiedSplit,
  computeTaskSetHash,
} from '../../scripts/eval-split-sets.mjs';

// ── T-C3/C4 eval-validate ─────────────────────────────────────────────────────
import {
  computeValidationStats,
  compareWithBaseline,
  readOraclePassed,
  readOracleOutcome,
  buildValidationJobs,
} from '../../scripts/eval-validate.mjs';

// ── T-C8 generation-infra 连接门禁（F206 fix B）──────────────────────────────
import { EventEmitter } from 'node:events';
import { preflightClaudeConnectivity } from '../../scripts/lib/generation-infra.mjs';

// ── T-C10 swebench-oracle 陈旧 report 清理（F206 仪器修复）───────────────────
import { purgeStaleEvaluationLogs, runSwebenchInstance } from '../../scripts/lib/swebench-oracle.mjs';

// ── T-C0 parallel-run-pool ───────────────────────────────────────────────────
import {
  ParallelRunPool,
  aggregatePassRate,
  classifyExitStatus,
  EXIT_INFRA,
  EXIT_GEN_TIMEOUT,
} from '../../scripts/lib/parallel-run-pool.mjs';

// ── T-C5 warmup-planner（C-2 env 去重）────────────────────────────────────────
import {
  planWarmupJobs,
  repoFromInstanceId,
  taskIdOf,
  instanceIdOf,
} from '../../scripts/lib/warmup-planner.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// T-C0a: eval-task-runner exit 码拆分（验证常量语义，不跑 runner）
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C0a exit 码语义', () => {
  it('EXIT_INFRA = 3（infra 失败，剔分母）', () => {
    expect(EXIT_INFRA).toBe(3);
  });
  it('EXIT_GEN_TIMEOUT = 4（生成超时，能力 fail，不剔分母）', () => {
    expect(EXIT_GEN_TIMEOUT).toBe(4);
  });
  it('两者不同，语义不混淆', () => {
    expect(EXIT_INFRA).not.toBe(EXIT_GEN_TIMEOUT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C0b: classifyExitStatus — 退出码→status 运行时映射（codex W-5：补运行时路径覆盖）
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C0b classifyExitStatus', () => {
  it('exit 0 → success', () => {
    expect(classifyExitStatus(0, null)).toBe('success');
  });
  it('exit 3（EXIT_INFRA）→ infra（剔分母）', () => {
    expect(classifyExitStatus(EXIT_INFRA, null)).toBe('infra');
  });
  it('exit 4（EXIT_GEN_TIMEOUT）→ gen_timeout（能力 fail，入分母）', () => {
    expect(classifyExitStatus(EXIT_GEN_TIMEOUT, null)).toBe('gen_timeout');
  });
  it('SIGKILL（over-budget/run-timeout kill）→ gen_timeout', () => {
    expect(classifyExitStatus(0, 'SIGKILL')).toBe('gen_timeout');
    expect(classifyExitStatus(-1, 'SIGKILL')).toBe('gen_timeout');
  });
  it('code=-1（无 code，被杀）→ gen_timeout', () => {
    expect(classifyExitStatus(-1, null)).toBe('gen_timeout');
  });
  it('其它非零（如 1/2）→ error', () => {
    expect(classifyExitStatus(1, null)).toBe('error');
    expect(classifyExitStatus(2, null)).toBe('error');
  });
  it('exit 3/4 与通用 error 不混淆（语义分明）', () => {
    expect(classifyExitStatus(3, null)).not.toBe('error');
    expect(classifyExitStatus(4, null)).not.toBe('error');
    expect(classifyExitStatus(5, null)).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C0: parallel-run-pool
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C0 ParallelRunPool', () => {
  // 回归契约（dogfooding 实跑捕获）：旧实现传 eval-task-runner 不存在的 --cohort flag →
  // "unknown flag: --cohort" 致每个 run error；且漏 6 个驱动参数使 spec-driver 退化提示词模式 / 卡权限。
  describe('_buildRunnerArgs 契约（回归：曾传不存在的 --cohort + 漏驱动参数）', () => {
    it('不含 --cohort（eval-task-runner 无此 flag）', () => {
      const pool = new ParallelRunPool({});
      const args = pool._buildRunnerArgs(
        { task: 't1', tool: 'spec-driver-spectra-mcp', cohort: 'c3', repeatNo: 1, extraArgs: ['--swebench-oracle'] },
        0, 'c3-r1',
      );
      expect(args).not.toContain('--cohort');
    });

    it('--tool 取 job.tool（cohort→tool 由调用方映射，非裸 --cohort）', () => {
      const pool = new ParallelRunPool({});
      const args = pool._buildRunnerArgs({ task: 't1', tool: 'control', cohort: 'c1', repeatNo: 1 }, 0, 'c1-r1');
      expect(args[args.indexOf('--tool') + 1]).toBe('control');
    });

    it('含 canonical runOne 全部驱动参数（缺则 spec-driver 退化提示词模式 / 卡权限）', () => {
      const pool = new ParallelRunPool({ driverModel: 'claude-sonnet-4-6', outputFormat: 'stream-json' });
      const args = pool._buildRunnerArgs({ task: 't1', tool: 'spec-driver-spectra-mcp', cohort: 'c3', repeatNo: 1 }, 0, 'c3-r1');
      for (const flag of ['--bypass-permissions', '--cleanup', '--prompt-via-stdin', '--skill-invocation', '--model', '--output-format']) {
        expect(args).toContain(flag);
      }
      expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-6');
      expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    });

    it('extraArgs（如 --swebench-oracle）透传追加', () => {
      const pool = new ParallelRunPool({});
      const args = pool._buildRunnerArgs({ task: 't1', tool: 'control', cohort: 'c1', repeatNo: 1, extraArgs: ['--swebench-oracle'] }, 0, 'c1-r1');
      expect(args).toContain('--swebench-oracle');
    });
  });

  describe('dry-run 模式（不 spawn）', () => {
    it('返回等长结果数组，每项 status=success', async () => {
      const pool = new ParallelRunPool({ dryRun: true });
      const jobs = [
        { task: 't1', tool: 'spec-driver', cohort: 'c3', repeatNo: 1 },
        { task: 't2', tool: 'spec-driver', cohort: 'c1', repeatNo: 1 },
      ];
      const results = await pool.run(jobs);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('success');
    });

    it('fixturePath 含唯一 suffix（cohort+repeatNo）', async () => {
      const pool = new ParallelRunPool({ dryRun: true });
      const jobs = [
        { task: 't1', tool: 'spec-driver', cohort: 'c3', repeatNo: 1 },
        { task: 't1', tool: 'spec-driver', cohort: 'c1', repeatNo: 1 },
      ];
      const results = await pool.run(jobs);
      // 两个 fixture 路径不同（防互覆盖）
      expect(results[0].fixturePath).not.toBe(results[1].fixturePath);
    });

    it('seqNo 从 0 递增，保证与 job 顺序对应', async () => {
      const pool = new ParallelRunPool({ dryRun: true });
      const jobs = Array.from({ length: 5 }, (_, i) => ({
        task: `t${i}`, tool: 'spec-driver', cohort: 'c3', repeatNo: 1,
      }));
      const results = await pool.run(jobs);
      results.forEach((r, i) => expect(r.seqNo).toBe(i));
    });

    it('空 job 列表返回空数组', async () => {
      const pool = new ParallelRunPool({ dryRun: true });
      const results = await pool.run([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('aggregatePassRate（不跑 runner）', () => {
    it('infra 剔分母，gen_timeout 计 fail', () => {
      const results = [
        { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/fake' },
        { task: 't2', cohort: 'c3', status: 'infra' },
        { task: 't3', cohort: 'c3', status: 'gen_timeout' },
        { task: 't4', cohort: 'c3', status: 'success', fixturePath: '/fake2' },
      ];
      // oracle: t1=pass, t4=fail
      const oracleMap: Record<string, boolean> = { '/fake': true, '/fake2': false };
      const stats = aggregatePassRate(results, (r) => oracleMap[r.fixturePath ?? ''] ?? null);
      expect(stats.n_total).toBe(4);
      expect(stats.n_infra).toBe(1);     // 1 infra 剔
      expect(stats.n_valid).toBe(3);     // 3 入分母（success×2 + gen_timeout×1）
      expect(stats.n_pass).toBe(1);      // 仅 t1 pass
      expect(stats.passRate).toBeCloseTo(1 / 3, 5);
    });

    it('全 infra → passRate = null', () => {
      const results = [
        { task: 't1', cohort: 'c3', status: 'infra' },
        { task: 't2', cohort: 'c3', status: 'infra' },
      ];
      const stats = aggregatePassRate(results);
      expect(stats.passRate).toBeNull();
      expect(stats.n_valid).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C1: eval-calibrate
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C1 eval-calibrate — 启发式难度打分', () => {
  const makeRow = (patchLines: number, filesChanged: number, failToPass: number, pasToPass = 5) => ({
    instance_id: `task-${patchLines}-${filesChanged}-${failToPass}`,
    patch: [
      ...Array(filesChanged).fill('diff --git a/x b/x'),
      ...Array(patchLines).fill('+line'),
    ].join('\n'),
    FAIL_TO_PASS: JSON.stringify(Array.from({ length: failToPass }, (_, i) => `test_${i}`)),
    PASS_TO_PASS: JSON.stringify(Array.from({ length: pasToPass }, (_, i) => `p_${i}`)),
  });

  it('极简任务（1 行 1 文件 1 测试）→ midScore 低', () => {
    const score = heuristicDifficultyScore(makeRow(1, 1, 1));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.9); // 不会得最高分
  });

  it('极难任务（200 行 10 文件 15 测试）→ midScore 低（两端都低）', () => {
    const score = heuristicDifficultyScore(makeRow(200, 10, 15));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.9);
  });

  it('中等任务（50 行 3 文件 5 测试）→ midScore 最高', () => {
    const easyScore = heuristicDifficultyScore(makeRow(1, 1, 1));
    const hardScore = heuristicDifficultyScore(makeRow(200, 10, 15));
    const midScore = heuristicDifficultyScore(makeRow(50, 3, 5));
    expect(midScore).toBeGreaterThanOrEqual(easyScore);
    expect(midScore).toBeGreaterThanOrEqual(hardScore);
  });

  it('相同输入 → 相同分数（无随机性）', () => {
    const row = makeRow(50, 3, 5);
    expect(heuristicDifficultyScore(row)).toBe(heuristicDifficultyScore(row));
  });

  it('分数范围 [0,1]', () => {
    for (const [p, f, t] of [[0,0,0], [1,1,1], [100,5,8], [200,10,15]]) {
      const score = heuristicDifficultyScore(makeRow(p, f, t));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C7: oracle 读取 + run 结果聚合（codex CRITICAL-1/2 回归，dogfooding 实跑捕获）
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C7 oraclePassedFromFixture（回归：曾误读字段致所有 pass 恒计 false）', () => {
  it('runner 真实结构 taskExecution.primaryOracle.passed=true → true', () => {
    expect(oraclePassedFromFixture({ taskExecution: { primaryOracle: { passed: true } } })).toBe(true);
  });
  it('taskExecution.primaryOracle.passed=false → false', () => {
    expect(oraclePassedFromFixture({ taskExecution: { primaryOracle: { passed: false } } })).toBe(false);
  });
  it('legacy swebenchResult.passed=true → true（向后兼容 fallback）', () => {
    expect(oraclePassedFromFixture({ swebenchResult: { passed: true } })).toBe(true);
  });
  it('无 oracle 字段 / null 入参 → null（缺失≠fail；calibrate 经 Boolean 归 fail，validate 归 oracle_missing）', () => {
    expect(oraclePassedFromFixture({})).toBe(null);
    expect(oraclePassedFromFixture(null)).toBe(null);
    expect(oraclePassedFromFixture({ taskExecution: {} })).toBe(null); // 有 taskExecution 但无 primaryOracle
  });
  it('passed 非严格 true（如 "true" / 1）→ false（避免误判）', () => {
    expect(oraclePassedFromFixture({ taskExecution: { primaryOracle: { passed: 'true' } } })).toBe(false);
    expect(oraclePassedFromFixture({ taskExecution: { primaryOracle: { passed: 1 } } })).toBe(false);
  });
});

describe('T0/F212 oracleOutcomeFromFixture（calibrate 侧 classification 四态，镜像 F210 readOracleOutcome）', () => {
  it('classification=pass → true', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: { classification: 'pass', passed: true } } })).toBe(true);
  });
  it('classification=fail → false（跑了但候选真挂）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: { classification: 'fail', passed: false } } })).toBe(false);
  });
  it('classification=error + failureSource=infra（venv 缺失等）→ oracle_error（核心：仪器坏了剔分母）', () => {
    expect(oracleOutcomeFromFixture({
      taskExecution: { primaryOracle: { classification: 'error', failureSource: 'infra', passed: false } },
    })).toBe('oracle_error');
  });
  it('classification=error + failureSource=fixture（dataset mismatch）→ oracle_error（夹具错同桶）', () => {
    expect(oracleOutcomeFromFixture({
      taskExecution: { primaryOracle: { classification: 'error', failureSource: 'fixture', passed: false } },
    })).toBe('oracle_error');
  });
  it('classification=unavailable（legacy）→ null（剔分母 fail-closed）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: { classification: 'unavailable' } } })).toBe(null);
  });
  it('classification 未知漂移值 → null（fail-closed）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: { classification: 'weird-future-value' } } })).toBe(null);
  });
  it('legacy 无 classification（{kind,passed:true}）→ true（向后兼容回退二值）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: { kind: 'swebench', passed: true } } })).toBe(true);
  });
  it('legacy 无 classification（{kind,passed:false}）→ false（向后兼容回退二值）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: { kind: 'swebench', passed: false } } })).toBe(false);
  });
  it('legacy swebenchResult fallback（无 classification，passed:true）→ true', () => {
    expect(oracleOutcomeFromFixture({ swebenchResult: { passed: true } })).toBe(true);
  });
  it('无任何 oracle 字段 / null 入参 → null', () => {
    expect(oracleOutcomeFromFixture({})).toBe(null);
    expect(oracleOutcomeFromFixture(null)).toBe(null);
    expect(oracleOutcomeFromFixture({ taskExecution: {} })).toBe(null);
  });
  it('malformed shape：primaryOracle 为数组 → null（不误判 legacy false）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: [] } })).toBe(null);
  });
  it('malformed shape：primaryOracle 空对象（无 classification 无 passed）→ null（不误判 false）', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: {} } })).toBe(null);
  });
  it('malformed shape：primaryOracle 为 primitive 字符串 → null', () => {
    expect(oracleOutcomeFromFixture({ taskExecution: { primaryOracle: 'weird-string' } })).toBe(null);
  });
});

describe('T-C7 aggregateRunResults（codex CRITICAL-2：error 剔分母，不当能力 fail）', () => {
  const cohorts = ['c1', 'c3'];
  const passAll = () => true;

  it('infra + error 都剔分母（不进 cohortPasses）', () => {
    const results = [
      { status: 'infra', cohort: 'c1' },
      { status: 'error', cohort: 'c1' },
      { status: 'success', cohort: 'c1', fixturePath: '/x' },
    ];
    const { cohortPasses, infraCount, errorCount, excludedRate } = aggregateRunResults(results, cohorts, passAll);
    expect(infraCount).toBe(1);
    expect(errorCount).toBe(1);
    expect(cohortPasses.get('c1')).toEqual([1]); // 只 success 入分母
    expect(excludedRate).toBeCloseTo(2 / 3, 5);
  });

  it('success → 读 resolvePass；gen_timeout → 入分母算 fail（能力 fail，非剔）', () => {
    const results = [
      { status: 'success', cohort: 'c3', fixturePath: '/x' },
      { status: 'gen_timeout', cohort: 'c3' },
    ];
    const { cohortPasses, errorCount } = aggregateRunResults(results, cohorts, (r) => r.status === 'success');
    expect(errorCount).toBe(0);
    expect(cohortPasses.get('c3')).toEqual([1, 0]); // success=pass, gen_timeout=fail
  });

  it('全 error → cohortPasses 空 + excludedRate=1（下游 isDiscriminating 判 non-discriminating）', () => {
    const results = [
      { status: 'error', cohort: 'c1' },
      { status: 'error', cohort: 'c3' },
    ];
    const { cohortPasses, errorCount, excludedRate } = aggregateRunResults(results, cohorts, passAll);
    expect(errorCount).toBe(2);
    expect(cohortPasses.get('c1')).toEqual([]);
    expect(cohortPasses.get('c3')).toEqual([]);
    expect(excludedRate).toBe(1);
  });

  it('全 infra（ConnectionRefused 类，F206 fix B）→ excludedRate=1，供 fail-closed 判系统性故障', () => {
    // 代理死时所有 run 落 infra 桶（error=0）——fail-closed 必须按 excludedRate 而非 errorRate 判
    const results = [
      { status: 'infra', cohort: 'c1' },
      { status: 'infra', cohort: 'c1' },
      { status: 'infra', cohort: 'c3' },
      { status: 'infra', cohort: 'c3' },
    ];
    const { infraCount, errorCount, excludedRate, cohortPasses } = aggregateRunResults(results, cohorts, passAll);
    expect(infraCount).toBe(4);
    expect(errorCount).toBe(0);
    expect(excludedRate).toBe(1);
    expect(cohortPasses.get('c1')).toEqual([]);
    expect(cohortPasses.get('c3')).toEqual([]);
  });

  // ── T0/F212：oracle_error 第四态剔分母（镜像 F210 validate 侧）─────────────────
  // resolvePass 返回 'oracle_error' 哨兵（oracle 仪器坏了）→ 剔 cohortPasses 分母 + 单独计
  // oracleErrorCount + 计入 excludedRate，不伪装成 passRate=0（不 push 0 进分母）。
  it('T0：resolvePass 返回 oracle_error → 计 oracleErrorCount，剔分母（不算 fail）', () => {
    const results = [
      { status: 'success', cohort: 'c3', fixturePath: '/oracle_error' },
      { status: 'success', cohort: 'c3', fixturePath: '/pass' },
    ];
    const resolve = (r: { fixturePath?: string }) => r.fixturePath === '/oracle_error' ? 'oracle_error' : true;
    const { cohortPasses, oracleErrorCount, excludedRate } = aggregateRunResults(results, cohorts, resolve);
    expect(oracleErrorCount).toBe(1);
    expect(cohortPasses.get('c3')).toEqual([1]); // 仅 /pass 入分母，未被 oracle_error 拉低
    expect(excludedRate).toBeCloseTo(0.5, 5);
  });

  it('T0：全 oracle_error → cohortPasses 空 + oracleErrorCount 全 + excludedRate=1（供 fail-closed）', () => {
    const results = [
      { status: 'success', cohort: 'c1', fixturePath: '/oe' },
      { status: 'success', cohort: 'c3', fixturePath: '/oe' },
    ];
    const { cohortPasses, oracleErrorCount, infraCount, errorCount, excludedRate } =
      aggregateRunResults(results, cohorts, () => 'oracle_error');
    expect(oracleErrorCount).toBe(2);
    expect(infraCount).toBe(0);
    expect(errorCount).toBe(0);
    expect(excludedRate).toBe(1);
    expect(cohortPasses.get('c1')).toEqual([]);
    expect(cohortPasses.get('c3')).toEqual([]);
  });

  it('T0：oracle_error 与 infra/error 混合 → 三剔除桶互不覆盖', () => {
    const results = [
      { status: 'infra', cohort: 'c3' },
      { status: 'error', cohort: 'c3' },
      { status: 'success', cohort: 'c3', fixturePath: '/oe' },
      { status: 'success', cohort: 'c3', fixturePath: '/pass' },
    ];
    const resolve = (r: { fixturePath?: string }) => r.fixturePath === '/oe' ? 'oracle_error' : true;
    const { infraCount, errorCount, oracleErrorCount, cohortPasses, excludedRate } =
      aggregateRunResults(results, cohorts, resolve);
    expect(infraCount).toBe(1);
    expect(errorCount).toBe(1);
    expect(oracleErrorCount).toBe(1);
    expect(cohortPasses.get('c3')).toEqual([1]); // 仅 /pass
    expect(excludedRate).toBeCloseTo(3 / 4, 5);
  });

  it('T0 truthy 哨兵防御：oracle_error 是 truthy 字符串但绝不计 pass（锁定分支顺序先于 ? 1 : 0）', () => {
    const results = [
      { status: 'success', cohort: 'c3', fixturePath: '/oe' },
      { status: 'success', cohort: 'c3', fixturePath: '/oe' },
    ];
    // 恒返 'oracle_error'（truthy）：若哨兵分支被挪到 push(p ? 1 : 0) 之后会被误计 pass(=1)
    const { cohortPasses, oracleErrorCount } = aggregateRunResults(results, cohorts, () => 'oracle_error');
    expect(oracleErrorCount).toBe(2);
    expect(cohortPasses.get('c3')).toEqual([]); // 绝无 1 混入
  });
});

// ── T-C8 preflightClaudeConnectivity（F206 fix B：起批前连接门禁，fake spawn 不真连网）──
describe('T-C8 preflightClaudeConnectivity', () => {
  type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: (s?: string) => void };
    kill: (sig?: string) => void;
  };
  const makeFakeChild = (opts: { code?: number; stdout?: string; neverExit?: boolean; onKill?: () => void } = {}): FakeChild => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => { opts.onKill?.(); };
    if (!opts.neverExit) {
      setImmediate(() => {
        if (opts.stdout) child.stdout.emit('data', opts.stdout);
        child.emit('close', opts.code ?? 0);
      });
    }
    return child;
  };
  const asSpawn = (fn: () => FakeChild) => fn as unknown as typeof import('node:child_process').spawn;

  it('exit 0 + 非空输出 → ok', async () => {
    const r = await preflightClaudeConnectivity({ spawnImpl: asSpawn(() => makeFakeChild({ code: 0, stdout: 'ok\n' })) });
    expect(r.ok).toBe(true);
  });

  it('ConnectionRefused 文案（真实事故输出）→ not ok，detail 指向连接失败', async () => {
    const r = await preflightClaudeConnectivity({
      spawnImpl: asSpawn(() => makeFakeChild({ code: 1, stdout: 'API Error: Unable to connect to API (ConnectionRefused)' })),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('连接失败');
  });

  it('exit 0 但输出含连接失败标记 → not ok（不被退出码骗过）', async () => {
    const r = await preflightClaudeConnectivity({
      spawnImpl: asSpawn(() => makeFakeChild({ code: 0, stdout: 'API Error: Unable to connect to API (ConnectionRefused)' })),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('连接失败');
  });

  it('非零退出（非连接类）→ not ok，detail 带退出码', async () => {
    const r = await preflightClaudeConnectivity({ spawnImpl: asSpawn(() => makeFakeChild({ code: 1, stdout: 'some other failure' })) });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('退出码 1');
  });

  it('exit 0 但零输出 → not ok（异常态不放行）', async () => {
    const r = await preflightClaudeConnectivity({ spawnImpl: asSpawn(() => makeFakeChild({ code: 0, stdout: '' })) });
    expect(r.ok).toBe(false);
  });

  it('超时 → kill 子进程 + not ok（detail 指向超时）', async () => {
    let killed = false;
    const r = await preflightClaudeConnectivity({
      timeoutMs: 30,
      spawnImpl: asSpawn(() => makeFakeChild({ neverExit: true, onKill: () => { killed = true; } })),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('超时');
    expect(killed).toBe(true);
  });

  it('spawn 同步抛错（如 claude 不存在）→ not ok 不崩', async () => {
    const throwingSpawn = (() => { throw new Error('ENOENT: claude not found'); }) as unknown as typeof import('node:child_process').spawn;
    const r = await preflightClaudeConnectivity({ spawnImpl: throwingSpawn });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('spawn claude 失败');
  });

  it("child 'error' 后又 'close' → 只 resolve 一次（settled 守卫），取 error 结论", async () => {
    const child = makeFakeChild({ neverExit: true });
    setImmediate(() => {
      child.emit('error', new Error('spawn EACCES'));
      child.emit('close', 0); // error 后 close 再触发——不得二次 resolve / 不得翻转结论
    });
    const r = await preflightClaudeConnectivity({ spawnImpl: asSpawn(() => child) });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('spawn claude 失败');
  });

  it('stdin.end 抛错（子进程秒挂管道破裂）→ 仍经 close 正常 resolve', async () => {
    const child = makeFakeChild({ code: 1, stdout: 'API Error: Unable to connect to API (ConnectionRefused)' });
    child.stdin = { end: () => { throw new Error('EPIPE'); } };
    const r = await preflightClaudeConnectivity({ spawnImpl: asSpawn(() => child) });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('连接失败');
  });
});

// ── T-C9 validate 接线合同（/goal Verify 腿；回归：曾硬编码 tool='spec-driver' + 读死字段）──
describe('T-C9 eval-validate 接线合同', () => {
  it('CALIBRATION_COHORT_TO_TOOL：c1=control / c3=spec-driver-spectra-mcp（validate 与 calibrate 共用单源）', () => {
    expect(CALIBRATION_COHORT_TO_TOOL.c1).toBe('control');
    expect(CALIBRATION_COHORT_TO_TOOL.c3).toBe('spec-driver-spectra-mcp');
  });

  it('buildValidationJobs：tool 经映射（c3→spec-driver-spectra-mcp），非硬编码（钉死调用点接线）', () => {
    const jobs = buildValidationJobs([{ taskId: 'SWE-X1' }, 'SWE-X2'], 'c3');
    expect(jobs).toEqual([
      { task: 'SWE-X1', tool: 'spec-driver-spectra-mcp', cohort: 'c3', repeatNo: 1, extraArgs: ['--swebench-oracle'] },
      { task: 'SWE-X2', tool: 'spec-driver-spectra-mcp', cohort: 'c3', repeatNo: 2, extraArgs: ['--swebench-oracle'] },
    ]);
    expect(buildValidationJobs([{ taskId: 'SWE-X1' }], 'c1')[0].tool).toBe('control');
  });

  describe('readOraclePassed（回归：曾读 swebenchResult/oracleResult/result 死字段 → /goal 度量恒 0）', () => {
    const tmpFixture = (obj: object): string => {
      const p = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f206-oracle-')), 'full.json');
      fs.writeFileSync(p, JSON.stringify(obj));
      return p;
    };

    it('canonical 路径 taskExecution.primaryOracle.passed=true → true', () => {
      expect(readOraclePassed(tmpFixture({ taskExecution: { primaryOracle: { passed: true } } }))).toBe(true);
    });
    it('canonical 路径 passed=false → false（跑了但 fail，非缺失）', () => {
      expect(readOraclePassed(tmpFixture({ taskExecution: { primaryOracle: { passed: false } } }))).toBe(false);
    });
    it('legacy fallback swebenchResult.passed=true → true（向后兼容）', () => {
      expect(readOraclePassed(tmpFixture({ swebenchResult: { passed: true } }))).toBe(true);
    });
    it('文件不存在 / JSON 损坏 → null（oracle_missing 桶，参与 fail-closed）', () => {
      expect(readOraclePassed('/nonexistent/f206/full.json')).toBe(null);
      const bad = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f206-oracle-')), 'full.json');
      fs.writeFileSync(bad, '{not json');
      expect(readOraclePassed(bad)).toBe(null);
    });
    it('fixture 可读但无任何 oracle 字段（schema 回归）→ null 而非 fail（codex W-1）', () => {
      expect(readOraclePassed(tmpFixture({ taskExecution: { wallMs: 123 } }))).toBe(null);
      expect(readOraclePassed(tmpFixture({}))).toBe(null);
    });
  });
});

describe('T-C1 heuristicPrefilter — 候选预筛', () => {
  const makeRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      instance_id: `t${i}`,
      patch: '+line\n'.repeat(i % 200),
      FAIL_TO_PASS: JSON.stringify(Array(i % 15).fill('test')),
      PASS_TO_PASS: '[]',
    }));

  it('结果总数 = count（启发式 + 随机保底桶）', () => {
    const rows = makeRows(100);
    const { heuristic, random } = heuristicPrefilter(rows, 20);
    expect(heuristic.length + random.length).toBe(20);
  });

  it('保底桶 ≥ 1（codex W3：不全靠启发式）', () => {
    const rows = makeRows(50);
    const { random } = heuristicPrefilter(rows, 10);
    expect(random.length).toBeGreaterThanOrEqual(1);
  });

  it('启发式 + 保底桶不重叠（id 唯一）', () => {
    const rows = makeRows(50);
    const { heuristic, random } = heuristicPrefilter(rows, 10);
    const hIds = new Set(heuristic.map((r) => r.instance_id));
    for (const r of random) expect(hIds.has(r.instance_id)).toBe(false);
  });

  it('固定 seed → 可复现', () => {
    const rows = makeRows(100);
    const a = heuristicPrefilter(rows, 20);
    const b = heuristicPrefilter(rows, 20);
    const aIds = [...a.heuristic, ...a.random].map((r) => r.instance_id).sort();
    const bIds = [...b.heuristic, ...b.random].map((r) => r.instance_id).sort();
    expect(aIds).toEqual(bIds);
  });
});

describe('T-C1 isDiscriminating — noise-aware 判据', () => {
  // 辅助：构造 0/1 pass 数组，再用 Map 包装
  const makePasses = (c1: number[], c3: number[]) =>
    new Map([['c1', c1], ['c3', c3]]);

  it('全饱和（c1=c3=1.0）→ not discriminating', () => {
    const { discriminating } = isDiscriminating(makePasses([1, 1, 1], [1, 1, 1]));
    expect(discriminating).toBe(false);
  });

  it('全不可能（c1=c3=0）→ not discriminating', () => {
    const { discriminating } = isDiscriminating(makePasses([0, 0, 0], [0, 0, 0]));
    expect(discriminating).toBe(false);
  });

  it('CI 重叠（c1≈c3）→ not discriminating（虽在范围内）', () => {
    // c1=2/3, c3=2/3 → passRate ok 但 CI 重叠
    const { discriminating, reason } = isDiscriminating(makePasses([1, 1, 0], [1, 1, 0]));
    expect(discriminating).toBe(false);
    expect(reason).toMatch(/non-overlapping|aggPassRate/);
  });

  it('c1 全过 c3 全不过（N=3）→ discriminating=true 但 weakSeparation=true（W-2 退化小样本）', () => {
    // c1=[1,1,1] CI=[1,1] vs c3=[0,0,0] CI=[0,0]：agg=0.5∈[0.15,0.85] 且 CI 不重叠
    // 但 N=3 两侧都是零宽退化 CI（degenerate），标 weakSeparation 但不剔除
    // （N=3 时几乎只有完美分离能过判据；剔除会清空池，故仅信息标注）
    const r = isDiscriminating(makePasses([1, 1, 1], [0, 0, 0]));
    expect(r.discriminating).toBe(true);
    expect(r.weakSeparation).toBe(true);
    expect(r.reason).toMatch(/weak separation|弱分离|degenerate/);
  });

  it('N=5 完美分离 → discriminating=true 且 weakSeparation=false（robust）', () => {
    // N=5 ≥ WEAK_SEPARATION_MIN_N：零宽 CI 不再判退化，视为稳健分离
    const r = isDiscriminating(makePasses([1, 1, 1, 1, 1], [0, 0, 0, 0, 0]));
    expect(r.discriminating).toBe(true);
    expect(r.weakSeparation).toBe(false);
  });

  it('回归：CI 字段名为 {low,high}（曾误用 {lo,hi} 致判据恒 false）', () => {
    // 锁定 bootstrapProportionCi 契约：perCohort.<c>.ci 暴露数值 .low/.high。
    // 历史 bug：isDiscriminating 读 .lo/.hi（undefined < undefined）→ 永远 not discriminating，
    // 校准池恒空 → split 抛"池太小"。此测试若退回旧字段名即红。
    const r = isDiscriminating(makePasses([1, 1, 1], [0, 0, 0]));
    for (const c of ['c1', 'c3'] as const) {
      expect(r.perCohort[c].ci).toHaveProperty('low');
      expect(r.perCohort[c].ci).toHaveProperty('high');
      expect(typeof r.perCohort[c].ci.low).toBe('number');
      expect(typeof r.perCohort[c].ci.high).toBe('number');
    }
  });

  it('N=5 mid 0.8 vs 0.2 → CI 重叠 → not discriminating（弱分离不误判 robust）', () => {
    const r = isDiscriminating(makePasses([1, 1, 1, 1, 0], [1, 0, 0, 0, 0]));
    expect(r.discriminating).toBe(false);
    expect(r.weakSeparation).toBe(false);
  });

  it('空 cohort passes → passRate=null，不 discriminating', () => {
    const { discriminating } = isDiscriminating(makePasses([], []));
    expect(discriminating).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C2: eval-split-sets
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C2 eval-split-sets', () => {
  // 构造有 perCohort.c3.passRate 的 calibratedPool 条目
  const makeEntry = (id: string, c3Rate: number) => ({
    taskId: id, discriminating: true, lowConfidence: false,
    perCohort: { c3: { passRate: c3Rate, ci: { low:c3Rate - 0.1, high:c3Rate + 0.1 }, n: 3 } },
  });

  describe('binByC3PassRate', () => {
    it('low < 0.33 / mid 0.33-0.67 / high > 0.67', () => {
      const pool = [makeEntry('t1', 0.1), makeEntry('t2', 0.5), makeEntry('t3', 0.9)];
      const { low, mid, high } = binByC3PassRate(pool);
      expect(low.map((e) => e.taskId)).toContain('t1');
      expect(mid.map((e) => e.taskId)).toContain('t2');
      expect(high.map((e) => e.taskId)).toContain('t3');
    });

    it('passRate=null → low 桶', () => {
      const pool = [{ taskId: 'tx', discriminating: true, lowConfidence: false, perCohort: {} }];
      const { low } = binByC3PassRate(pool);
      expect(low.map((e) => e.taskId)).toContain('tx');
    });
  });

  describe('stratifiedSplit', () => {
    const makeLargePool = (n: number) =>
      Array.from({ length: n }, (_, i) => makeEntry(`t${i}`, i / (n - 1)));

    it('frozen + validation 合并 = pool（disjoint，无遗漏）', () => {
      const pool = makeLargePool(30);
      const { frozen, validation } = stratifiedSplit(pool, 10, 42);
      const allIds = [...frozen, ...validation].map((e) => e.taskId).sort();
      const poolIds = pool.map((e) => e.taskId).sort();
      expect(allIds).toEqual(poolIds);
    });

    it('frozen ∩ validation = ∅（disjoint）', () => {
      const pool = makeLargePool(30);
      const { frozen, validation } = stratifiedSplit(pool, 10, 42);
      const frozenIds = new Set(frozen.map((e) => e.taskId));
      for (const e of validation) expect(frozenIds.has(e.taskId)).toBe(false);
    });

    it('validation 数 ≤ target（不超额）', () => {
      const pool = makeLargePool(30);
      const { validation } = stratifiedSplit(pool, 10, 42);
      expect(validation.length).toBeLessThanOrEqual(10);
    });

    it('同 seed → 可复现（两次相同）', () => {
      const pool = makeLargePool(30);
      const a = stratifiedSplit(pool, 10, 42);
      const b = stratifiedSplit(pool, 10, 42);
      expect(a.validation.map((e) => e.taskId).sort()).toEqual(b.validation.map((e) => e.taskId).sort());
    });

    it('不同 seed → 不同划分（大概率）', () => {
      const pool = makeLargePool(40);
      const a = stratifiedSplit(pool, 10, 42);
      const b = stratifiedSplit(pool, 10, 99);
      const aIds = a.validation.map((e) => e.taskId).sort().join(',');
      const bIds = b.validation.map((e) => e.taskId).sort().join(',');
      // 大概率不同（若完全相同说明 seed 效果差）
      expect(aIds).not.toBe(bIds);
    });

    it('池太小（< 2×target）→ 抛错', () => {
      const pool = makeLargePool(10);
      expect(() => stratifiedSplit(pool, 10, 42)).toThrow(/太小/);
    });

    it('W-4：pool 含重复 taskId → 抛错（disjoint 合同保护，不静默去重）', () => {
      // 20 条但其中 2 条同 id：足够过"池太小"门，但触发 disjoint 合同检查
      const pool = [
        ...Array.from({ length: 19 }, (_, i) => makeEntry(`t${i}`, i / 19)),
        makeEntry('t0', 0.5), // 与首条同 taskId
      ];
      expect(() => stratifiedSplit(pool, 10, 42)).toThrow(/重复 taskId/);
    });

    it('W-6：条目用 task（非 taskId）键 → canonical 解析仍识别真实重复（不退化为对象引用）', () => {
      // 旧实现 `e.taskId ?? e` 会因两条都无 .taskId 退化为对象引用比较 → 漏判；taskIdOf 解析 task 键能识别
      const mk = (id: string, rate: number) => ({
        task: id, discriminating: true, lowConfidence: false,
        perCohort: { c3: { passRate: rate, ci: { low: rate - 0.1, high: rate + 0.1 }, n: 3 } },
      });
      const pool = [
        ...Array.from({ length: 19 }, (_, i) => mk(`k${i}`, i / 19)),
        mk('k0', 0.5), // 同 task='k0'，但走 task 键而非 taskId
      ];
      expect(() => stratifiedSplit(pool, 10, 42)).toThrow(/重复 taskId/);
    });

    it('W-6：条目无任何 id 键 → fail-fast 抛错（不静默退化为对象引用）', () => {
      const noId = { discriminating: true, lowConfidence: false, perCohort: { c3: { passRate: 0.5, ci: { low: 0.4, high: 0.6 }, n: 3 } } };
      const pool = [...Array.from({ length: 19 }, (_, i) => makeEntry(`t${i}`, i / 19)), noId];
      expect(() => stratifiedSplit(pool, 10, 42)).toThrow(/无法解析 taskId/);
    });

    // W-3：某档配额被 cap 削减时，余额重分配给有余量的档；重分配后仍欠填则显式告警
    it('W-3 重分配：mid 档空但 low/high 有余 → 填满 target，不欠填', () => {
      // low=20 high=20 mid=0：want mid=4 无处可取，重分配给 low/high → validation=10
      const pool = [
        ...Array.from({ length: 20 }, (_, i) => makeEntry(`lo${i}`, 0.1)),
        ...Array.from({ length: 20 }, (_, i) => makeEntry(`hi${i}`, 0.9)),
      ];
      let underfill: unknown = null;
      const { validation } = stratifiedSplit(pool, 10, 42, { onUnderfill: (i) => { underfill = i; } });
      expect(validation.length).toBe(10);
      expect(underfill).toBeNull();
    });

    it('W-3 真欠填：各档 cap 之和 < target → onUnderfill 回调，绝不静默', () => {
      // low7/mid7/high7 → cap=floor(7/2)=3 各档，总 cap=9 < target=10
      const pool = [
        ...Array.from({ length: 7 }, (_, i) => makeEntry(`lo${i}`, 0.1)),
        ...Array.from({ length: 7 }, (_, i) => makeEntry(`md${i}`, 0.5)),
        ...Array.from({ length: 7 }, (_, i) => makeEntry(`hi${i}`, 0.9)),
      ];
      let underfill: { target: number; actual: number; deficit: number } | null = null;
      const { frozen, validation } = stratifiedSplit(pool, 10, 42, {
        onUnderfill: (i) => { underfill = i as typeof underfill; },
      });
      expect(validation.length).toBe(9);
      expect(underfill).not.toBeNull();
      expect(underfill!.deficit).toBe(1);
      // 欠填下仍保持 disjoint + 无遗漏
      const allIds = [...frozen, ...validation].map((e) => e.taskId).sort();
      expect(allIds).toEqual(pool.map((e) => e.taskId).sort());
    });
  });

  describe('computeTaskSetHash', () => {
    it('相同列表 → 相同 hash', () => {
      const tasks = [makeEntry('a', 0.5), makeEntry('b', 0.3)];
      expect(computeTaskSetHash(tasks)).toBe(computeTaskSetHash(tasks));
    });

    it('顺序无关（排序后 hash）', () => {
      const tasks1 = [makeEntry('a', 0.5), makeEntry('b', 0.3)];
      const tasks2 = [makeEntry('b', 0.3), makeEntry('a', 0.5)];
      expect(computeTaskSetHash(tasks1)).toBe(computeTaskSetHash(tasks2));
    });

    it('不同列表 → 不同 hash', () => {
      const tasks1 = [makeEntry('a', 0.5)];
      const tasks2 = [makeEntry('b', 0.5)];
      expect(computeTaskSetHash(tasks1)).not.toBe(computeTaskSetHash(tasks2));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C3: eval-validate — computeValidationStats
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C3 computeValidationStats', () => {
  type MockResult = { task: string; cohort: string; status: string; fixturePath?: string };
  const oracle = (r: MockResult) => {
    if (r.fixturePath === '/pass') return true;
    if (r.fixturePath === '/fail') return false;
    return null;
  };

  it('infra 剔分母，passRate 仅含 non-infra', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/pass' },
      { task: 't2', cohort: 'c3', status: 'infra' },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: '/fail' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_infra).toBe(1);
    expect(stats.n_valid).toBe(2);
    expect(stats.n_pass).toBe(1);
    expect(stats.passRate).toBeCloseTo(0.5, 5);
  });

  it('gen_timeout 计入分母算 fail', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'gen_timeout' },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_valid).toBe(2);
    expect(stats.n_pass).toBe(1);
    expect(stats.passRate).toBeCloseTo(0.5, 5);
  });

  it('全 infra → passRate = null，不报 fail-closed', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'infra' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.passRate).toBeNull();
    expect(stats.infraFailRate).toBe(1);
  });

  it('infraFailRate 计算正确（infra/total）', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'infra' },
      { task: 't2', cohort: 'c3', status: 'infra' },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.infraFailRate).toBeCloseTo(2 / 3, 5);
  });

  it('全 pass → passRate = 1', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/pass' },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.passRate).toBe(1);
    expect(stats.n_pass).toBe(2);
  });

  it('W-6（口径对齐 calibrate）：gen_timeout 入分母算 fail；error 剔分母计 infraFailRate', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'gen_timeout' },
      { task: 't2', cohort: 'c3', status: 'error' },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_gen_timeout).toBe(1);
    expect(stats.n_error).toBe(1);
    expect(stats.n_valid).toBe(2);          // gen_timeout + success 入分母；error 剔除
    expect(stats.n_pass).toBe(1);
    expect(stats.passRate).toBeCloseTo(1 / 2, 5);
    expect(stats.infraFailRate).toBeCloseTo(1 / 3, 5); // error 计入"无法评估"率
  });

  it('全 error（如 dist 版本门禁失败）→ n_valid=0（调用方 W-4 fail-closed exit 2，不假报 passRate=0）', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'error' },
      { task: 't2', cohort: 'c3', status: 'error' },
      { task: 't3', cohort: 'c3', status: 'error' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_valid).toBe(0);
    expect(stats.passRate).toBe(null);
    expect(stats.infraFailRate).toBe(1);
  });

  it('W-4：success 但 oracle=null → 计 n_oracle_missing，剔分母（不算 fail）', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/unknown' }, // oracle null
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_oracle_missing).toBe(1);
    expect(stats.n_valid).toBe(1);          // 仅 t2 入分母
    expect(stats.passRate).toBe(1);
    // oracle_missing 计入 infraFailRate（与 infra 同列"非能力失败"）
    expect(stats.infraFailRate).toBeCloseTo(0.5, 5);
  });

  it('W-4：全 oracle 缺失 → n_valid=0 + passRate=null（fail-closed 触发条件）', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/unknown' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_valid).toBe(0);
    expect(stats.passRate).toBeNull();
    expect(stats.n_oracle_missing).toBe(1);
    expect(stats.infraFailRate).toBe(1);
  });

  // ── F210：oracle-error 第四态（仪器坏了，非候选 fail）─────────────────────────
  // 回调返回 'oracle_error' 哨兵 → 剔分母、单独计数，不伪装成 passRate=0.0
  const outcomeOracle = (r: MockResult) => {
    if (r.fixturePath === '/pass') return true;
    if (r.fixturePath === '/fail') return false;
    if (r.fixturePath === '/oracle_error') return 'oracle_error';
    return null;
  };

  it('F210：success + getOraclePassed 返回 oracle_error → 计入 n_oracle_error，剔分母（不算 fail）', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, outcomeOracle);
    expect(stats.n_oracle_error).toBe(1);
    expect(stats.n_valid).toBe(1);           // 仅 t2 入分母
    expect(stats.n_pass).toBe(1);
    expect(stats.passRate).toBe(1);          // 未被 oracle_error 拉低成 0.5
    expect(stats.infraFailRate).toBeCloseTo(0.5, 5);
  });

  it('F210：全 oracle_error → n_valid=0 + passRate=null（fail-closed 触发条件），infraFailRate=1', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
    ];
    const stats = computeValidationStats(results, outcomeOracle);
    expect(stats.n_oracle_error).toBe(2);
    expect(stats.n_valid).toBe(0);
    expect(stats.passRate).toBeNull();
    expect(stats.infraFailRate).toBe(1);
  });

  it('F210：oracle_error 与 error/infra-status/oracle_missing 混合 → 四桶互不覆盖', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'infra' },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: '/unknown' }, // oracle null
      { task: 't4', cohort: 'c3', status: 'error' },
    ];
    const stats = computeValidationStats(results, outcomeOracle);
    expect(stats.n_infra).toBe(1);
    expect(stats.n_oracle_error).toBe(1);
    expect(stats.n_oracle_missing).toBe(1);
    expect(stats.n_error).toBe(1);
    expect(stats.n_valid).toBe(0);
  });

  it('F210 truthy 哨兵防御：oracle_error 是 truthy 字符串但绝不计 pass（锁定分支顺序，codex W-4）', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: '/oracle_error' },
    ];
    // 回调恒返 'oracle_error'（truthy）：若哨兵分支被挪到 if (passed) 之后会被误计 pass
    const stats = computeValidationStats(results, () => 'oracle_error');
    expect(stats.n_pass).toBe(0);
    expect(stats.n_valid).toBe(0);
    expect(stats.n_oracle_error).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F210: eval-validate — readOracleOutcome 四态读取（oracle-error 假报修复）
// ─────────────────────────────────────────────────────────────────────────────
describe('F210 readOracleOutcome（classification 四态：pass/fail/oracle_error/null）', () => {
  const tmpFixture = (obj: object): string => {
    const p = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f210-outcome-')), 'full.json');
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
  };

  it('classification=pass → true', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: { classification: 'pass', passed: true } } }))).toBe(true);
  });

  it('classification=fail → false（跑了但 fail，候选真挂）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: { classification: 'fail', passed: false } } }))).toBe(false);
  });

  it('classification=error + failureSource=infra（venv 缺失等）→ oracle_error（核心回归用例）', () => {
    expect(readOracleOutcome(tmpFixture({
      taskExecution: { primaryOracle: { classification: 'error', failureSource: 'infra', passed: false } },
    }))).toBe('oracle_error');
  });

  it('classification=error + failureSource=fixture（dataset mismatch）→ oracle_error（codex W-1：夹具错同桶）', () => {
    expect(readOracleOutcome(tmpFixture({
      taskExecution: { primaryOracle: { classification: 'error', failureSource: 'fixture', passed: false } },
    }))).toBe('oracle_error');
  });

  it('classification=unavailable（legacy）→ null（codex W-2：与 classifyRunForRanking 同口径剔分母）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: { classification: 'unavailable' } } }))).toBe(null);
  });

  it('classification 为未知漂移值（weird-future-value）→ null（codex W-2 fail-closed）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: { classification: 'weird-future-value' } } }))).toBe(null);
  });

  it('legacy 无 classification 字段（仅 {kind,passed:true}）→ true（向后兼容回退二值）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: { kind: 'swebench', passed: true } } }))).toBe(true);
  });

  it('legacy 无 classification 字段（仅 {kind,passed:false}）→ false（向后兼容回退二值）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: { kind: 'swebench', passed: false } } }))).toBe(false);
  });

  it('文件不存在 / JSON 损坏 → null', () => {
    expect(readOracleOutcome('/nonexistent/f210/full.json')).toBe(null);
    const bad = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f210-outcome-')), 'full.json');
    fs.writeFileSync(bad, '{not json');
    expect(readOracleOutcome(bad)).toBe(null);
  });

  it('fixture 无任何 oracle 字段（{} / {taskExecution:{}}）→ null', () => {
    expect(readOracleOutcome(tmpFixture({}))).toBe(null);
    expect(readOracleOutcome(tmpFixture({ taskExecution: {} }))).toBe(null);
  });

  it('codex W-1：primaryOracle 为数组 → null（malformed shape 不可评估，不误判 legacy false）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: [] } }))).toBe(null);
  });

  it('codex W-1：primaryOracle 为空对象（无 classification 无 passed）→ null（fail-closed，不误判 false）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: {} } }))).toBe(null);
  });

  it('codex W-1：primaryOracle 为 primitive 字符串 → null（malformed shape）', () => {
    expect(readOracleOutcome(tmpFixture({ taskExecution: { primaryOracle: 'weird-string' } }))).toBe(null);
  });

  it('take1 复现场景：3 条 success + classification=error(infra) → n_oracle_error=3 / n_valid=0 / passRate=null / infraFailRate=1', () => {
    // 钉死 fix-report 的故障复现语义：修复前此场景假报 n_valid=3 / n_infra=0 / passRate=0.0；
    // 修复后 3/3 oracle-error → n_valid=0，main 层由 FR-006 floor exit 2 拦截，不再让 /goal 拿到假 0
    const errorFixture = {
      taskExecution: {
        primaryOracle: {
          classification: 'error', failureSource: 'infra', passed: false,
          cmd: '(skipped: dataset build error)',
        },
      },
    };
    const results = [
      { task: 't1', cohort: 'c3', status: 'success', fixturePath: tmpFixture(errorFixture) },
      { task: 't2', cohort: 'c3', status: 'success', fixturePath: tmpFixture(errorFixture) },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: tmpFixture(errorFixture) },
    ];
    const stats = computeValidationStats(results, (r) => r.fixturePath ? readOracleOutcome(r.fixturePath) : null);
    expect(stats.n_oracle_error).toBe(3);
    expect(stats.n_valid).toBe(0);
    expect(stats.passRate).toBeNull();
    expect(stats.infraFailRate).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C4: compareWithBaseline — 比较纪律
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C4 compareWithBaseline', () => {
  const MIN_DELTA = 0.05;

  it('新 CI 下界 > 旧均值 + MIN_DELTA → KEEP', () => {
    // baseline passRate=0.60, minDelta=0.05 → 阈值=0.65
    // current CI=[0.68, 0.85] → lo=0.68 > 0.65 → KEEP
    const current = { passRate: 0.75, ci: { low:0.68, high:0.85 } };
    const baseline = { passRate: 0.60 };
    const { verdict } = compareWithBaseline(current, baseline, MIN_DELTA);
    expect(verdict).toBe('KEEP');
  });

  it('新 CI 下界 ≤ 旧均值 + MIN_DELTA → DISCARD（噪声内）', () => {
    // baseline passRate=0.60, 阈值=0.65
    // current CI=[0.55, 0.80] → lo=0.55 ≤ 0.65 → DISCARD
    const current = { passRate: 0.68, ci: { low:0.55, high:0.80 } };
    const baseline = { passRate: 0.60 };
    const { verdict } = compareWithBaseline(current, baseline, MIN_DELTA);
    expect(verdict).toBe('DISCARD');
  });

  it('新 CI 恰好 = 阈值 → DISCARD（边界不入 KEEP）', () => {
    // lo = 0.65 = 0.60 + 0.05 → DISCARD（> 而不是 >=）
    const current = { passRate: 0.70, ci: { low:0.65, high:0.85 } };
    const baseline = { passRate: 0.60 };
    const { verdict } = compareWithBaseline(current, baseline, MIN_DELTA);
    expect(verdict).toBe('DISCARD');
  });

  it('current CI 缺失 → INSUFFICIENT_DATA', () => {
    const current = { passRate: 0.70, ci: null };
    const baseline = { passRate: 0.60 };
    const { verdict } = compareWithBaseline(current as never, baseline, MIN_DELTA);
    expect(verdict).toBe('INSUFFICIENT_DATA');
  });

  it('baseline 缺失 → INSUFFICIENT_DATA', () => {
    const current = { passRate: 0.70, ci: { low:0.60, high:0.80 } };
    const { verdict } = compareWithBaseline(current, null as never, MIN_DELTA);
    expect(verdict).toBe('INSUFFICIENT_DATA');
  });

  it('baseline passRate=null → INSUFFICIENT_DATA', () => {
    const current = { passRate: 0.70, ci: { low:0.60, high:0.80 } };
    const { verdict } = compareWithBaseline(current, { passRate: null } as never, MIN_DELTA);
    expect(verdict).toBe('INSUFFICIENT_DATA');
  });

  it('minDelta=0 时 CI 下界 > 旧均值即 KEEP', () => {
    const current = { passRate: 0.61, ci: { low:0.601, high:0.70 } };
    const baseline = { passRate: 0.60 };
    const { verdict } = compareWithBaseline(current, baseline, 0);
    expect(verdict).toBe('KEEP');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C5: warmup-planner — env 去重（codex C-2：避免并行 cold-build 同一镜像 race）
// ─────────────────────────────────────────────────────────────────────────────
describe('T-C5 planWarmupJobs — env 去重', () => {
  type Fx = { taskId: string; swebenchMeta: { instanceId: string } };
  const fixtures: Fx[] = [
    { taskId: 'SWE-V001-a', swebenchMeta: { instanceId: 'sympy__sympy-100' } },
    { taskId: 'SWE-V002-b', swebenchMeta: { instanceId: 'sympy__sympy-200' } },
    { taskId: 'SWE-V003-c', swebenchMeta: { instanceId: 'django__django-300' } },
  ];

  it('repoFromInstanceId：连字符 repo 名只剥结尾 -<num>', () => {
    expect(repoFromInstanceId('scikit-learn__scikit-learn-12345')).toBe('scikit-learn/scikit-learn');
    expect(repoFromInstanceId('sympy__sympy-24661')).toBe('sympy/sympy');
  });

  it('taskIdOf 优先 taskId / instanceIdOf 取 swebenchMeta.instanceId（两者区分）', () => {
    const fx = { taskId: 'TASK-X', swebenchMeta: { instanceId: 'a__b-1' } };
    expect(taskIdOf(fx)).toBe('TASK-X');     // --task 取值
    expect(instanceIdOf(fx)).toBe('a__b-1'); // oracle/env 解析取值
  });

  it('同 (repo,version) → 去重为 1 个 env job；job.task 用 taskId', () => {
    const envMap = new Map([
      ['sympy__sympy-100', 'sympy/sympy@1.11'],
      ['sympy__sympy-200', 'sympy/sympy@1.11'], // 同 env
      ['django__django-300', 'django/django@4.0'],
    ]);
    const jobs = planWarmupJobs(fixtures, { cohort: 'c3', resolveEnvKeys: () => envMap });
    expect(jobs).toHaveLength(2); // sympy×2 合 1 + django×1
    expect(jobs.map((j) => j.envKey).sort()).toEqual(['django/django@4.0', 'sympy/sympy@1.11']);
    // job.task 取 taskId（--task 取值），非 instanceId
    expect(jobs.map((j) => j.task)).toContain('SWE-V001-a');
    expect(jobs.every((j) => j.repeatNo === 0)).toBe(true);
  });

  it('异 version 同 repo → 不去重（两个 env 各建一次）', () => {
    const envMap = new Map([
      ['sympy__sympy-100', 'sympy/sympy@1.11'],
      ['sympy__sympy-200', 'sympy/sympy@1.12'], // 异 version → 异 env
      ['django__django-300', 'django/django@4.0'],
    ]);
    const jobs = planWarmupJobs(fixtures, { cohort: 'c3', resolveEnvKeys: () => envMap });
    expect(jobs).toHaveLength(3);
  });

  it('env 解析失败 → onDegrade 回调 + 降级 repo-only 去重', () => {
    let degradeErr: Error | null = null;
    const jobs = planWarmupJobs(fixtures, {
      cohort: 'c3',
      resolveEnvKeys: () => { throw new Error('venv missing'); },
      onDegrade: (e: Error) => { degradeErr = e; },
    });
    expect(degradeErr).not.toBeNull();
    expect(degradeErr!.message).toMatch(/venv missing/);
    // 降级 repo-only：sympy×2 合 1（repo:sympy/sympy）+ django×1 = 2
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.envKey).sort()).toEqual(['repo:django/django', 'repo:sympy/sympy']);
  });

  it('extraArgs 默认 --swebench-oracle（预热须真建 env 镜像）', () => {
    const jobs = planWarmupJobs(fixtures, { cohort: 'c3', resolveEnvKeys: () => new Map() });
    expect(jobs.every((j) => j.extraArgs.includes('--swebench-oracle'))).toBe(true);
  });
});

// ── T-C10 purgeStaleEvaluationLogs（F206 仪器修复：陈旧 report 让 harness 跳过评测复用旧结论）──
describe('T-C10 purgeStaleEvaluationLogs', () => {
  it('两层缓存都清（instance report 子树 + run 级汇总）；本 run 其他产物（predictions 等）保留', () => {
    const cwd = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f206-oracle-purge-'));
    const staleInstDir = nodePath.join(cwd, 'logs', 'run_evaluation', 'rid', 'spectra-f187', 'inst');
    fs.mkdirSync(staleInstDir, { recursive: true });
    fs.writeFileSync(nodePath.join(staleInstDir, 'report.json'), '{"inst":{"resolved":false}}');
    fs.writeFileSync(nodePath.join(cwd, 'spectra-f187.rid.json'), '{"resolved_ids":[]}'); // run 级汇总（第二层缓存）
    fs.writeFileSync(nodePath.join(cwd, 'predictions.jsonl'), '{}');
    purgeStaleEvaluationLogs(cwd, 'rid');
    expect(fs.existsSync(nodePath.join(cwd, 'logs', 'run_evaluation'))).toBe(false);
    expect(fs.existsSync(nodePath.join(cwd, 'spectra-f187.rid.json'))).toBe(false);
    expect(fs.existsSync(nodePath.join(cwd, 'predictions.jsonl'))).toBe(true);
  });
  it('无 logs 目录 / 无汇总文件时幂等不抛', () => {
    const cwd = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f206-oracle-purge-'));
    expect(() => purgeStaleEvaluationLogs(cwd, 'rid')).not.toThrow();
    expect(() => purgeStaleEvaluationLogs(cwd)).not.toThrow();
  });

  it('runSwebenchInstance 起评即 purge（钉死调用点：fetchRows 注入 throw 免跑 docker，陈旧两层已被清）', () => {
    const artifactsDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f206-oracle-call-'));
    const runId = 'task__tool__r1';
    const cwd = nodePath.join(artifactsDir, runId);
    const staleInst = nodePath.join(cwd, 'logs', 'run_evaluation', runId, 'spectra-f187', 'inst');
    fs.mkdirSync(staleInst, { recursive: true });
    fs.writeFileSync(nodePath.join(staleInst, 'report.json'), '{"inst":{"resolved":false}}');
    fs.writeFileSync(nodePath.join(cwd, `spectra-f187.${runId}.json`), '{"resolved_ids":[]}');
    const fixture = { swebenchMeta: { instanceId: 'inst', dataset: 'verified', failToPass: [], passToPass: [] } };
    const r = runSwebenchInstance({
      fixture, candidatePatch: 'diff --git a/x b/x', artifactsDir, runId,
      fetchRows: () => { throw new Error('DATASET_MISMATCH: 测试注入'); },
    });
    expect(r.classification).toBe('error'); // dataset 阶段被注入中断（purge 之后才走到）
    expect(fs.existsSync(nodePath.join(cwd, 'logs', 'run_evaluation'))).toBe(false);
    expect(fs.existsSync(nodePath.join(cwd, `spectra-f187.${runId}.json`))).toBe(false);
  });

  it('退化 runId（.. / 空）→ 拒绝执行（purge 路径逃逸防护，codex W-1）', () => {
    const artifactsDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'f206-oracle-guard-'));
    const fixture = { swebenchMeta: { instanceId: 'inst', dataset: 'verified' } };
    for (const badId of ['..', '.', '']) {
      expect(() => runSwebenchInstance({ fixture, candidatePatch: '', artifactsDir, runId: badId }))
        .toThrow(/非法 runId/);
    }
  });
});
