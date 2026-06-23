#!/usr/bin/env node
/**
 * @fileoverview F206 T-C2：分层 disjoint 集合划分。
 *
 * 读入 calibrated-pool.json（C1 输出），按 c3 passRate 分箱分层切两半：
 *   frozen  — 里程碑对比用（不用于 /goal 迭代）
 *   validation — /goal 每轮优化的指标数据集
 *
 * 要求（spec FR-004/009）：
 *   - 两集合 disjoint（无共同 taskId）
 *   - 分层：按 c3 passRate 分 low/mid/high 三箱，各箱内均分
 *   - validation 偏 c3 中段（W-4：多收 mid 档任务）
 *   - 池太小（<2×目标）报错，不强切
 *   - 输出冻结锚（taskSetHash + seed + fixtureContentHash）入库清单（gold 不落库）
 *
 * 用法：
 *   node scripts/eval-split-sets.mjs --pool <calibrated-pool.json> [--target <n>] [--seed <n>]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { taskIdOf } from './lib/warmup-planner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_VALIDATION_TARGET = 10; // validation 集目标任务数
const BIN_LABELS = ['low', 'mid', 'high'];

// validation 集各档权重（spec FR-009/W-4：偏中段）
const VALIDATION_BIN_WEIGHTS = { low: 0.25, mid: 0.50, high: 0.25 };

function parseArgs(argv) {
  const args = {
    pool: null,
    target: DEFAULT_VALIDATION_TARGET,
    seed: 42,
    outputDir: path.join(PROJECT_ROOT, '.calibration-output'),
    outFile: null,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--pool': args.pool = argv[++i]; break;
      case '--target': args.target = Number(argv[++i]); break;
      case '--seed': args.seed = Number(argv[++i]); break;
      case '--output-dir': args.outputDir = argv[++i]; break;
      case '--out': args.outFile = argv[++i]; break;
    }
  }
  return args;
}

/**
 * 按 c3 passRate 分箱（低/中/高）。
 * - low:  passRate < 0.33
 * - mid:  0.33 ≤ passRate ≤ 0.67
 * - high: passRate > 0.67
 *
 * @param {object[]} pool  calibrated-pool entries（有 perCohort.c3.passRate）
 * @returns {{ low: object[], mid: object[], high: object[] }}
 */
export function binByC3PassRate(pool) {
  const bins = { low: [], mid: [], high: [] };
  for (const entry of pool) {
    const c3Rate = entry.perCohort?.c3?.passRate ?? null;
    if (c3Rate === null || c3Rate < 0.33) bins.low.push(entry);
    else if (c3Rate <= 0.67) bins.mid.push(entry);
    else bins.high.push(entry);
  }
  return bins;
}

/**
 * 分层 disjoint 切两半（frozen + validation）。
 *
 * 每档 validation 上限 cap = floor(binItems/2)，保证 frozen ≥ validation（同档难度均衡 + 不泄漏）。
 * W-3：按权重的初始配额若被某档 cap 削减，余额重分配给仍有余量的档；重分配后仍欠填则显式告警，
 *      绝不静默让 validation < target。
 *
 * @param {object[]} pool     discriminating 任务列表（已过 calibration filter）
 * @param {number}   target   validation 集目标任务数
 * @param {number}   seed     固定 seed 保证可复现
 * @param {object}   [opts]
 * @param {Function} [opts.onUnderfill]  ({target,actual,deficit,cap}) => void：欠填回调（默认 console.warn）
 * @returns {{ frozen: object[], validation: object[] }}
 */
export function stratifiedSplit(pool, target, seed, opts = {}) {
  const { onUnderfill } = opts;
  if (pool.length < 2 * target) {
    throw new Error(
      `[split] 池太小（${pool.length} < 2×${target}=${2 * target}）。` +
      '请扩大候选集重跑校准，或降低 --target。'
    );
  }

  // 合同（FR-004）：pool 内 taskId 必须唯一。重复 taskId 会让同一任务分别落入 frozen 与 validation，
  // 破坏 disjoint 隔离 → 验证集泄漏。校准池本应已去重，此处 fail-fast 而非静默去重（codex W-4/W-6）。
  // 用 taskIdOf 解析 canonical 字符串 id（兼容 taskId/task/instanceId 多种条目形态）；
  // 无法解析（返回 null）直接 fail-fast，避免退化为对象引用比较而漏判真实重复（codex W-6）。
  const seenIds = new Set();
  for (let i = 0; i < pool.length; i++) {
    const id = taskIdOf(pool[i]);
    if (id == null || id === '') {
      throw new Error(
        `[split] pool[${i}] 无法解析 taskId（缺 taskId/task/swebenchMeta.instanceId/instance_id）。` +
        '无 id 的条目会破坏 disjoint 去重，请检查上游 calibrate 产物。'
      );
    }
    if (seenIds.has(id)) {
      throw new Error(
        `[split] pool 含重复 taskId（${id}）。校准池应已去重；` +
        '重复 taskId 会破坏 frozen/validation disjoint 合同，请检查上游 calibrate 产物。'
      );
    }
    seenIds.add(id);
  }

  const rng = seededRng(seed);
  const bins = binByC3PassRate(pool);

  // 各档按权重的初始配额（round，mid 消化余数到精确 target）
  const want = {};
  let wantTotal = 0;
  for (const label of BIN_LABELS) {
    want[label] = Math.round(target * VALIDATION_BIN_WEIGHTS[label]);
    wantTotal += want[label];
  }
  const diff = target - wantTotal;
  if (diff !== 0) want.mid += diff;

  // 每档洗牌 + 算容量上限 cap = floor(binItems/2)
  const shuffled = {};
  const cap = {};
  for (const label of BIN_LABELS) {
    shuffled[label] = shuffle(bins[label], rng);
    cap[label] = Math.floor(shuffled[label].length / 2);
  }

  // 初始分配：take = min(want, cap)
  const take = {};
  for (const label of BIN_LABELS) take[label] = Math.min(want[label], cap[label]);

  // W-3 重分配：把被 cap 削减的欠额转给仍有余量（cap-take>0）的档（mid→high→low 顺序吸收）
  let deficit = target - BIN_LABELS.reduce((sum, l) => sum + take[l], 0);
  if (deficit > 0) {
    for (const label of ['mid', 'high', 'low']) {
      while (deficit > 0 && take[label] < cap[label]) { take[label]++; deficit--; }
      if (deficit === 0) break;
    }
  }

  const frozen = [];
  const validation = [];
  for (const label of BIN_LABELS) {
    validation.push(...shuffled[label].slice(0, take[label]));
    frozen.push(...shuffled[label].slice(take[label]));
  }

  // W-3：重分配后仍欠填（池在各分档处的有效容量不足）→ 显式告警，绝不静默
  if (deficit > 0) {
    const info = { target, actual: validation.length, deficit, cap };
    if (onUnderfill) onUnderfill(info);
    else console.warn(
      `[split] ⚠️ validation 欠填：目标 ${target}，实得 ${validation.length}（缺 ${deficit}）。`
      + `各档容量 cap=${JSON.stringify(cap)}，分档过偏所致。建议扩大候选集或调整分档阈值后重跑。`
    );
  }

  return { frozen, validation };
}

/**
 * 计算 taskSetHash（SHA-256 of sorted taskId list）。
 * 用 taskIdOf 解析 canonical id，与 stratifiedSplit 的 disjoint 去重口径一致，保证 anchor hash 稳定。
 */
export function computeTaskSetHash(tasks) {
  const sorted = [...tasks].map((t) => taskIdOf(t) ?? '').sort();
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.pool) {
    console.error('[split] 必须传 --pool <calibrated-pool.json>');
    process.exit(1);
  }

  const poolData = JSON.parse(fs.readFileSync(args.pool, 'utf-8'));
  // 只取 discriminating=true 且 lowConfidence=false 的任务
  const eligiblePool = (poolData.calibratedPool ?? poolData).filter(
    (e) => e.discriminating && !e.lowConfidence
  );
  console.log(`[split] eligible discriminating 任务: ${eligiblePool.length} / ${(poolData.calibratedPool ?? poolData).length}`);

  const { frozen, validation } = stratifiedSplit(eligiblePool, args.target, args.seed);
  console.log(`[split] frozen=${frozen.length} / validation=${validation.length}`);
  // 复用 binByC3PassRate 保证日志分箱口径与实际切分一致（手写 filter 链会重复计数，codex INFO-3）
  const valBins = binByC3PassRate(validation);
  console.log(`[split] validation bin 分布: ${BIN_LABELS.map((l) => `${l}=${valBins[l].length}`).join(', ')}`);

  // 冻结锚（taskSetHash + seed，入库作为 held-out 合同；gold json 不入库）
  const frozenAnchor = {
    taskSetHash: computeTaskSetHash(frozen),
    seed: args.seed,
    frozenCount: frozen.length,
    generatedAt: new Date().toISOString(),
  };
  const validationAnchor = {
    taskSetHash: computeTaskSetHash(validation),
    seed: args.seed,
    validationCount: validation.length,
    generatedAt: new Date().toISOString(),
  };

  const output = {
    frozen, validation, frozenAnchor, validationAnchor,
    meta: { seed: args.seed, target: args.target, eligiblePool: eligiblePool.length },
  };

  fs.mkdirSync(args.outputDir, { recursive: true });
  const outFile = args.outFile ?? path.join(args.outputDir, 'sets.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`[split] 输出: ${outFile}`);
  console.log(`[split] frozen anchor taskSetHash: ${frozenAnchor.taskSetHash.slice(0, 16)}...`);
  console.log(`[split] validation anchor taskSetHash: ${validationAnchor.taskSetHash.slice(0, 16)}...`);
}

// 工具函数
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
