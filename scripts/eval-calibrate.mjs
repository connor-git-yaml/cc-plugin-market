#!/usr/bin/env node
/**
 * @fileoverview F206 T-C1：难度校准脚本。
 *
 * 两阶段校准（spec CL-1）：
 *   1. 启发式预筛：从 SWE-bench Verified 500 行按难度代理指标缩到 ~30 候选。
 *      + 随机保底桶（codex W3）：一部分候选不经预筛随机入池，审计预筛偏差。
 *   2. N=3 经验校准：对候选 × {c1,c3} × N=3，parallel-run-pool 跑真 oracle。
 *      early-stop：每候选判完即更新 discriminating 计数，够数即停（spec FR-002 MUST）。
 *   3. noise-aware discriminating 判据（spec FR-003）：
 *      per-cohort bootstrapCI；聚合 passRate∈[LO,HI] **且** 至少一对 cohort CI 不重叠 → 保留。
 *
 * 用法：
 *   node scripts/eval-calibrate.mjs [--dry-run] [--target <N>] [--candidate-pool <json>]
 *   node scripts/eval-calibrate.mjs --list-candidates   # 只做启发式预筛，不跑 oracle
 *
 * 输出：calibrated-pool.json（不入库）+ calibration-report.md（manual 入库）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapProportionCi } from './lib/cohort-aggregate.mjs';
import { ParallelRunPool, serialWarmup } from './lib/parallel-run-pool.mjs';
import { planWarmupJobs, taskIdOf } from './lib/warmup-planner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── 校准参数（难度区间、保底桶比例、目标数） ───────────────────────────────────
const CALIBRATION_PARAMS = {
  /** pass rate 中等难度区间下界（c3 pass∈[LO,HI] 才保留） */
  PASS_LO: 0.15,
  /** pass rate 中等难度区间上界 */
  PASS_HI: 0.85,
  /** N=3 每 cohort repeats */
  REPEATS: 3,
  /** 目标 discriminating 任务数（早停阈值） */
  TARGET_DISCRIMINATING: 10,
  /** infra 失败率上限（超过则候选被标 low_confidence） */
  INFRA_FAIL_RATE_CEIL: 0.30,
  /** 弱分离判据：n < 此值的零宽（退化）bootstrap CI 不足以支撑稳健分离（W-2） */
  WEAK_SEPARATION_MIN_N: 5,
  /** 随机保底桶占候选比例（codex W3：审计启发式偏差） */
  RANDOM_BUCKET_RATIO: 0.20,
  /** 默认候选数（启发式预筛目标，含保底桶） */
  CANDIDATE_COUNT: 30,
};

/** 支持的校准 cohort（spec CL-1：{c1, c3}） */
const CALIBRATION_COHORTS = ['c1', 'c3'];

// ── 命令行参数解析 ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    dryRun: false,
    listCandidates: false,
    target: CALIBRATION_PARAMS.TARGET_DISCRIMINATING,
    concurrency: 4,
    candidatePool: null,   // 已有候选 pool json 路径（跳过启发式预筛）
    outputDir: path.join(PROJECT_ROOT, '.calibration-output'),
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dry-run': args.dryRun = true; break;
      case '--list-candidates': args.listCandidates = true; break;
      case '--target': args.target = Number(argv[++i]); break;
      case '--concurrency': args.concurrency = Number(argv[++i]); break;
      case '--candidate-pool': args.candidatePool = argv[++i]; break;
      case '--output-dir': args.outputDir = argv[++i]; break;
    }
  }
  return args;
}

// ── 启发式难度打分 ─────────────────────────────────────────────────────────────
/**
 * 对单个 SWE-bench Verified 行打难度分（越接近 0.5 = 越中等）。
 * 指标：patch 行数 / 改文件数 / fail_to_pass 数 / pass_to_pass 数。
 * 返回 score∈[0,1]，0.5 最佳（中等），0/1 最差（极易/极难）。
 *
 * @param {object} row SWE-bench Verified 行（含 patch / fail_to_pass / pass_to_pass 等字段）
 * @returns {number} score∈[0,1]
 */
export function heuristicDifficultyScore(row) {
  // patch 行数（+/- 两侧各算）
  const patchText = row.patch ?? '';
  const patchLines = patchText.split('\n').filter((l) => /^[+-]/.test(l) && !l.startsWith('+++') && !l.startsWith('---')).length;
  // 改文件数
  const filesChanged = (patchText.match(/^diff --git/gm) ?? []).length;
  // fail_to_pass 数（主要测试难度）
  const failToPassCount = Array.isArray(row.FAIL_TO_PASS) ? row.FAIL_TO_PASS.length
    : typeof row.FAIL_TO_PASS === 'string' ? JSON.parse(row.FAIL_TO_PASS || '[]').length : 0;
  // pass_to_pass 数（维持现有测试，越多越复杂）
  const passToPassCount = Array.isArray(row.PASS_TO_PASS) ? row.PASS_TO_PASS.length
    : typeof row.PASS_TO_PASS === 'string' ? JSON.parse(row.PASS_TO_PASS || '[]').length : 0;

  // 归一化每个指标到 [0,1]，越接近 0 = 越简单，越接近 1 = 越复杂
  const normLines = Math.min(1, patchLines / 200);       // 0-200 行归一化
  const normFiles = Math.min(1, filesChanged / 10);      // 0-10 文件归一化
  const normF2P   = Math.min(1, failToPassCount / 15);   // 0-15 测试归一化
  const normP2P   = Math.min(1, passToPassCount / 50);   // 0-50 归一化

  // 综合难度（0=极简，1=极难）
  const rawDifficulty = 0.35 * normLines + 0.25 * normFiles + 0.30 * normF2P + 0.10 * normP2P;

  // 转为"中等分"：越接近 0.5 的难度得分越高（bell-curve around 0.5）
  const midScore = 1 - 2 * Math.abs(rawDifficulty - 0.5);
  return Math.max(0, Math.min(1, midScore));
}

/**
 * 启发式预筛：从 rows 中选出 ~count 个候选，含随机保底桶。
 * 固定 seed（基于 count + rows.length），保证可复现。
 *
 * @param {object[]} rows   SWE-bench Verified 行列表
 * @param {number}   count  目标候选数（含保底桶）
 * @returns {{ heuristic: object[], random: object[] }}  各组候选
 */
export function heuristicPrefilter(rows, count = CALIBRATION_PARAMS.CANDIDATE_COUNT) {
  const randomBucketCount = Math.max(1, Math.round(count * CALIBRATION_PARAMS.RANDOM_BUCKET_RATIO));
  const heuristicCount = count - randomBucketCount;

  // 固定 seed（伪随机 shuffle，seed = rows.length × count）
  const seed = rows.length * count;
  const rng = seededRng(seed);

  // 按难度分降序（最中等的排前面）
  const scored = rows.map((r, i) => ({ row: r, score: heuristicDifficultyScore(r), origIdx: i }));
  scored.sort((a, b) => b.score - a.score);
  const heuristic = scored.slice(0, heuristicCount).map((x) => x.row);

  // 从剩余行随机取 randomBucketCount（保底桶，codex W3）
  const heuristicIds = new Set(heuristic.map((r) => r.instance_id));
  const remaining = rows.filter((r) => !heuristicIds.has(r.instance_id));
  const shuffled = shuffle(remaining, rng);
  const random = shuffled.slice(0, randomBucketCount);

  return { heuristic, random };
}

// ── noise-aware discriminating 判据 ──────────────────────────────────────────
/**
 * 判断一个候选任务是否 discriminating（spec FR-003）。
 * 条件：
 *   1. 聚合 passRate（所有 cohort 加权 pass / valid）∈ [PASS_LO, PASS_HI]（非饱和/非极难）
 *   2. 至少一对 cohort 的 bootstrap CI 不重叠（有统计上的区分度）
 *
 * W-2：N 很小时（如 N=3）一对 [1,1,1] vs [0,0,0] 会给出零宽退化 CI，使"不重叠"判据
 * 形同虚设（真 p=0.5 也有 ~3-5%/task 概率伪分离）。此时仍判 discriminating=true（保留统计结论），
 * 但置 weakSeparation=true 供下游 / 人工警惕；不剔出池（剔会在 N=3 下清空整池）。
 *
 * @param {Map<string, number[]>} cohortPasses  cohort → boolean[] (pass=1/fail=0)
 * @returns {{ discriminating: boolean, weakSeparation: boolean, reason: string, perCohort: object }}
 */
export function isDiscriminating(cohortPasses) {
  const perCohort = {};
  let totalPass = 0, totalValid = 0;

  for (const [cohort, passes] of cohortPasses) {
    if (passes.length === 0) {
      perCohort[cohort] = { passRate: null, ci: null };
      continue;
    }
    const passRate = passes.reduce((s, v) => s + v, 0) / passes.length;
    const samples = passes.map((v) => v); // 0/1 samples
    const ci = bootstrapProportionCi(samples);
    perCohort[cohort] = { passRate, ci, n: passes.length };
    totalPass += passes.reduce((s, v) => s + v, 0);
    totalValid += passes.length;
  }

  // 条件 1：聚合 passRate 中等
  const aggPassRate = totalValid > 0 ? totalPass / totalValid : null;
  if (aggPassRate === null || aggPassRate < CALIBRATION_PARAMS.PASS_LO || aggPassRate > CALIBRATION_PARAMS.PASS_HI) {
    return { discriminating: false, weakSeparation: false, reason: `aggPassRate=${aggPassRate?.toFixed(2) ?? 'null'} outside [${CALIBRATION_PARAMS.PASS_LO},${CALIBRATION_PARAMS.PASS_HI}]`, perCohort };
  }

  // 条件 2：至少一对 cohort CI 不重叠。同时甄别"稳健分离"（两端都不是退化小样本 CI）。
  // bootstrapProportionCi 返回 {low,high}；n<3 时 low/high 为 null（剔出不参与比较）。
  const cohortList = Object.entries(perCohort).filter(([, v]) => v.ci && v.ci.low !== null && v.ci.high !== null);
  const EPS = 1e-9;
  const MIN_N = CALIBRATION_PARAMS.WEAK_SEPARATION_MIN_N;
  const isDegenerateSmallN = (c) => (c.ci.high - c.ci.low) < EPS && (c.n ?? 0) < MIN_N;
  let anyNonOverlap = false;
  let anyRobustNonOverlap = false;
  for (let i = 0; i < cohortList.length; i++) {
    for (let j = i + 1; j < cohortList.length; j++) {
      const [, a] = cohortList[i];
      const [, b] = cohortList[j];
      // CI 不重叠：a.ci.high < b.ci.low 或 b.ci.high < a.ci.low
      if (a.ci.high < b.ci.low || b.ci.high < a.ci.low) {
        anyNonOverlap = true;
        // 稳健：不依赖任一端的退化（零宽）小样本 CI
        if (!isDegenerateSmallN(a) && !isDegenerateSmallN(b)) anyRobustNonOverlap = true;
      }
    }
  }

  if (!anyNonOverlap) {
    return { discriminating: false, weakSeparation: false, reason: 'no cohort pair with non-overlapping CI', perCohort };
  }

  // W-2：有分离但全部依赖退化小样本 CI → 弱分离（discriminating 仍 true，仅标记不剔）
  const weakSeparation = !anyRobustNonOverlap;
  const reason = weakSeparation ? 'pass (weak separation: degenerate small-n CI)' : 'pass';
  return { discriminating: true, weakSeparation, reason, perCohort };
}

// ── 主校准流程 ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  // 读候选 pool（外部传入 or 启发式生成）
  let candidates;
  if (args.candidatePool) {
    const data = JSON.parse(fs.readFileSync(args.candidatePool, 'utf-8'));
    candidates = data.candidates ?? data;
    console.log(`[calibrate] 外部候选 pool: ${candidates.length} 个`);
  } else {
    // 从 Verified fixture 加载并预筛
    const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-verified/fixtures');
    if (!fs.existsSync(fixtureDir)) {
      console.error(`[calibrate] fixture dir 不存在: ${fixtureDir}`);
      console.error('[calibrate] 请先跑 npm run baseline:import 或提供 --candidate-pool');
      process.exit(1);
    }
    const fixtureFiles = fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
    const rows = fixtureFiles.map((f) => JSON.parse(fs.readFileSync(path.join(fixtureDir, f), 'utf-8')));
    const { heuristic, random } = heuristicPrefilter(rows, CALIBRATION_PARAMS.CANDIDATE_COUNT);
    candidates = [...heuristic, ...random];
    console.log(`[calibrate] 启发式预筛: ${heuristic.length} + 随机保底 ${random.length} = ${candidates.length} 候选`);
  }

  if (args.listCandidates) {
    console.log(JSON.stringify(candidates.map((c) => taskIdOf(c) ?? c), null, 2));
    return;
  }

  if (args.dryRun) {
    console.log(`[calibrate] --dry-run: 计划跑 ${candidates.length} × ${CALIBRATION_COHORTS.length} × ${CALIBRATION_PARAMS.REPEATS} = ${candidates.length * CALIBRATION_COHORTS.length * CALIBRATION_PARAMS.REPEATS} runs`);
    console.log('[calibrate] early-stop 阈值:', args.target, 'discriminating 任务');
    return;
  }

  // 创建输出目录
  fs.mkdirSync(args.outputDir, { recursive: true });

  // 串行预热 env 镜像（C-2 合同）：按 (repo,version) 去重，每个 unique env 串行建一次镜像，
  // 防多 repo / 多 version 并行 cold-build race。预热是真实 run（--swebench-oracle），
  // 构建并缓存 env 镜像后续并行 run 直接命中暖缓存。
  if (candidates.length > 0) {
    const warmupJobs = planWarmupJobs(candidates, {
      cohort: CALIBRATION_COHORTS[0], // 预热只建 env 镜像，与 cohort 无关，取首个
      tool: 'spec-driver',
      onDegrade: (err) =>
        console.warn(`[calibrate] ⚠️  env 解析降级 repo-only（同 repo 多 version 仍可能 cold-build race）：${err.message}`),
    });
    console.log(`[calibrate] 串行预热 ${warmupJobs.length} 个 unique env：${warmupJobs.map((j) => j.envKey).join(', ')}`);
    // N 个 env 串行，每个冷构建可达 ~15-20min；budget 给足，超时则降级（未暖 env 退回并行 cold-build）
    const warmupResults = await serialWarmup(warmupJobs, { budgetMs: 90 * 60 * 1000, runTimeoutMs: 20 * 60 * 1000 });
    // 预热失败（infra/gen_timeout/error）= 该 env 镜像可能未暖，后续并行 run 首次命中会 cold-build（race + 更慢）。
    // 校准对 infra 失败本就剔分母、容忍噪声，故 warn-and-continue 而非 fail-closed（避免一次瞬时 401 阻断 6hr 批）；
    // 但必须把"哪些 env 没暖"显式打出来，不能静默假装预热成功（codex W-1）。
    // 规范化为安全数组：serialWarmup 正常返回 RunResult[]；空数组 / 非数组（防御性）一律不声称 success（codex W-2）。
    const safeWarmup = Array.isArray(warmupResults) ? warmupResults : [];
    const warmupFailed = safeWarmup.filter((r) => r && r.status !== 'success');
    if (warmupFailed.length > 0 || safeWarmup.length === 0) {
      const detail = safeWarmup.length === 0
        ? '预热未产出任何结果（env 解析为空 / 预热被跳过 / 返回非数组）'
        : `${warmupFailed.length}/${safeWarmup.length} 个 env 预热未成功（${warmupFailed.map((r) => `${r.envKey ?? r.task}:${r.status}`).join(', ')}）`;
      console.warn(`[calibrate] ⚠️  ${detail}。后续并行 run 可能 cold-build（race 风险 + 更慢），不阻断校准；如担心 race 可重跑预热。`);
    } else {
      console.log(`[calibrate] 预热完成（全部 ${safeWarmup.length} 个 env success）`);
    }
  }

  // 并行跑校准（每候选判完即更新 discriminating 计数，早停）
  const pool = new ParallelRunPool({
    concurrency: args.concurrency,
    budgetMs: 6 * 60 * 60 * 1000, // 校准批最多 6hr
    runTimeoutMs: 20 * 60 * 1000,
    onProgress: (res, done, total) => {
      console.log(`[calibrate] ${done}/${total} ${res.task} × ${res.cohort}: ${res.status}`);
    },
  });

  // 逐候选 early-stop 跑（非一次性全 dispatch）
  const calibratedPool = [];
  let discriminatingCount = 0;

  for (const candidate of candidates) {
    if (discriminatingCount >= args.target) {
      console.log(`[calibrate] ✅ 早停：已找到 ${discriminatingCount} 个 discriminating 任务`);
      break;
    }
    const taskId = taskIdOf(candidate);
    const jobs = CALIBRATION_COHORTS.flatMap((cohort) =>
      Array.from({ length: CALIBRATION_PARAMS.REPEATS }, (_, i) => ({
        task: taskId, tool: 'spec-driver', cohort, repeatNo: i + 1,
        extraArgs: ['--swebench-oracle'],
      }))
    );
    const results = await pool.run(jobs);

    // 按 cohort 聚合 pass/fail
    const cohortPasses = new Map();
    for (const cohort of CALIBRATION_COHORTS) cohortPasses.set(cohort, []);
    let infraCount = 0;
    for (const r of results) {
      if (r.status === 'infra') { infraCount++; continue; }
      // 从 fixture 读 oracle 结果（passed）
      const passed = r.fixturePath && fs.existsSync(r.fixturePath)
        ? readOraclePassed(r.fixturePath) : false;
      cohortPasses.get(r.cohort)?.push(passed ? 1 : 0);
    }
    const infraRate = infraCount / results.length;
    const { discriminating, weakSeparation, reason, perCohort } = isDiscriminating(cohortPasses);

    const entry = {
      taskId, discriminating, weakSeparation, reason, infraRate, perCohort,
      lowConfidence: infraRate > CALIBRATION_PARAMS.INFRA_FAIL_RATE_CEIL,
    };
    calibratedPool.push(entry);
    if (discriminating && !entry.lowConfidence) discriminatingCount++;
    console.log(`[calibrate] ${taskId}: discriminating=${discriminating}${weakSeparation ? ' (弱分离)' : ''}, infraRate=${infraRate.toFixed(2)}, reason=${reason}`);
  }

  // 写 calibrated pool（不入库）
  const weakSeparationCount = calibratedPool.filter((e) => e.discriminating && e.weakSeparation).length;
  const poolPath = path.join(args.outputDir, 'calibrated-pool.json');
  fs.writeFileSync(poolPath, JSON.stringify({ calibratedPool, meta: {
    generatedAt: new Date().toISOString(),
    discriminatingCount,
    weakSeparationCount,
    totalCandidates: candidates.length,
    params: CALIBRATION_PARAMS,
    cohorts: CALIBRATION_COHORTS,
  }}, null, 2));
  console.log(`[calibrate] 校准产物: ${poolPath} (${discriminatingCount} discriminating / ${calibratedPool.length} total)`);
  if (weakSeparationCount > 0) {
    console.warn(`[calibrate] ⚠️  ${weakSeparationCount} 个 discriminating 任务为弱分离（退化小样本 CI，N=${CALIBRATION_PARAMS.REPEATS}）。若占比高建议提高 REPEATS 或人工复核。`);
  }
}

/** 从 fixture JSON 读 oracle passed 状态 */
function readOraclePassed(fixturePath) {
  try {
    const fix = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    // F187 oracle 存储位置（swebench result）
    const sr = fix.swebenchResult ?? fix.oracleResult ?? fix.result ?? {};
    return sr.passed === true;
  } catch { return false; }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────
/** 简单线性同余伪随机数生成器（固定 seed，保证可复现） */
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Fisher-Yates shuffle（用 rng 保证可复现） */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 直接执行时跑 main
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
