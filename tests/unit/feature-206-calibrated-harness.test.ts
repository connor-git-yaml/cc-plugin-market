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

// ── T-C1 eval-calibrate ────────────────────────────────────────────────────────
import {
  heuristicDifficultyScore,
  heuristicPrefilter,
  isDiscriminating,
  oraclePassedFromFixture,
  aggregateRunResults,
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
} from '../../scripts/eval-validate.mjs';

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
  it('无 oracle 字段 / null → false（不抛）', () => {
    expect(oraclePassedFromFixture({})).toBe(false);
    expect(oraclePassedFromFixture(null)).toBe(false);
  });
  it('passed 非严格 true（如 "true" / 1）→ false（避免误判）', () => {
    expect(oraclePassedFromFixture({ taskExecution: { primaryOracle: { passed: 'true' } } })).toBe(false);
    expect(oraclePassedFromFixture({ taskExecution: { primaryOracle: { passed: 1 } } })).toBe(false);
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

  it('W-6：error 与 gen_timeout 分开计数，均入分母算 fail', () => {
    const results: MockResult[] = [
      { task: 't1', cohort: 'c3', status: 'gen_timeout' },
      { task: 't2', cohort: 'c3', status: 'error' },
      { task: 't3', cohort: 'c3', status: 'success', fixturePath: '/pass' },
    ];
    const stats = computeValidationStats(results, oracle);
    expect(stats.n_gen_timeout).toBe(1);
    expect(stats.n_error).toBe(1);
    expect(stats.n_valid).toBe(3);          // gen_timeout + error + success 都入分母
    expect(stats.n_pass).toBe(1);
    expect(stats.passRate).toBeCloseTo(1 / 3, 5);
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
