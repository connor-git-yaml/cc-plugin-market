#!/usr/bin/env node
/**
 * Feature 154 — Java callSites 独立验收脚本（T-4）
 *
 * 流程：
 *   1. 校验 dist/ 产物 + bootstrapRuntime
 *   2. 调 java-call-extractor.mjs 在 target 上重生成 truth-set
 *   3. 构建 truthIndex (file → Set<callerLabel|calleeName>)
 *   4. N 次重测：扫描 .java 文件，调 JavaLanguageAdapter.analyzeFile({extractCallSites:true})
 *   5. 计算 fillRate / precision / recall（label-only 三元组比对）
 *   6. median 取 N 次中位数
 *   7. 输出 JSON + exit code
 *
 * 用法：
 *   npm run build
 *   node scripts/verify-feature-154.mjs --target ~/.spectra-baselines/HikariCP/src/main \
 *     [--out /tmp/verify-154.json] [--repeats 3] [--debug] [--help]
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ──────────────────────────────────────────────────────────────
// T-4.1：纯函数 export
// ──────────────────────────────────────────────────────────────

/**
 * 把 truth-set extractor 的 caller 字段（"relPath:label"）拆出 callerLabel。
 *
 * 优先用 `file + ':'` 前缀精确匹配，避免 lambda `<lambda:42:18>` 内含冒号被
 * 错误截断（Codex P1 WARNING B）。
 *
 * @param {string} extractorCaller truth-set 输出的 caller 字段
 * @param {string} file truth-set 的 file 字段（已 POSIX 归一）
 * @returns {string} callerLabel（去除 relPath 前缀后的部分）
 */
export function extractCallerLabel(extractorCaller, file) {
  if (typeof extractorCaller !== 'string') return '';
  const filePrefix = file + ':';
  if (extractorCaller.startsWith(filePrefix)) {
    return extractorCaller.slice(filePrefix.length);
  }
  // 兜底：取首个 ':' 之后；正常情况下不会进入此分支
  const colonIdx = extractorCaller.indexOf(':');
  return colonIdx >= 0 ? extractorCaller.slice(colonIdx + 1) : extractorCaller;
}

/**
 * 中位数：奇数取中位，偶数取两中位平均，空数组返回 0。
 *
 * @param {number[]} nums
 * @returns {number}
 */
export function median(nums) {
  if (!Array.isArray(nums) || nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * label-only 三元组命中判定。
 *
 * @param {string} mapperTuple "relFile|callerContext|calleeName"
 * @param {Set<string>} truthSet truth-set 三元组集合
 * @returns {boolean}
 */
export function evaluateMatch(mapperTuple, truthSet) {
  return truthSet.has(mapperTuple);
}

/**
 * POSIX 路径归一（跨 OS 一致），Codex P1 WARNING W-5。
 *
 * @param {string} absPath 绝对路径
 * @param {string} target target 根目录
 * @returns {string} POSIX 风格相对路径
 */
export function normalizeRelPath(absPath, target) {
  return path.relative(target, absPath).split(path.sep).join('/');
}

// ──────────────────────────────────────────────────────────────
// T-4.3：主流程
// ──────────────────────────────────────────────────────────────

/** 解析 CLI 参数 */
function parseArgs(argv) {
  const out = {
    target: undefined,
    outFile: undefined,
    repeats: 3,
    debug: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--target') out.target = argv[++i];
    else if (k === '--out') out.outFile = argv[++i];
    else if (k === '--repeats') out.repeats = parseInt(argv[++i] ?? '3', 10);
    else if (k === '--debug') out.debug = true;
    else if (k === '--help' || k === '-h') out.help = true;
  }
  return out;
}

const HELP_TEXT = `用法:
  node scripts/verify-feature-154.mjs --target <hikari-src> [选项]

选项:
  --target <path>   HikariCP src/main 目录路径（必填）
  --out <path>      JSON 汇总输出路径（可选）
  --repeats <N>     重测次数（默认 3，取中位数）
  --debug           输出最差 recall 文件的 miss 示例
  --help, -h        显示本帮助

阈值（spec SC-001/SC-002）：
  fillRate ≥ 0.95（分母为 truth-set 真实有调用的文件）
  precision ≥ 0.70 / recall ≥ 0.30（label-only 三元组）

示例:
  node scripts/verify-feature-154.mjs \\
    --target ~/.spectra-baselines/HikariCP/src/main \\
    --out /tmp/verify-154.json --repeats 3
`;

/** 收集 .java 文件 */
function collectJavaFiles(root) {
  const IGNORE = new Set(['target', 'build', 'out', '.gradle', '.idea', '.settings', '.mvn']);
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (IGNORE.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  walk(root);
  return out;
}

async function runOnce(target, projectRoot) {
  // dist 产物动态 import
  const adapterMod = await import(path.join(projectRoot, 'dist', 'adapters', 'java-adapter.js'));
  const bootstrapMod = await import(path.join(projectRoot, 'dist', 'runtime-bootstrap.js'));
  bootstrapMod.bootstrapRuntime();

  const adapter = new adapterMod.JavaLanguageAdapter();

  // 收集 truth-set
  const extractorMod = await import(path.join(projectRoot, 'scripts', 'lib', 'java-call-extractor.mjs'));
  const truthRes = await extractorMod.extractJavaCallSites({ sourceRoot: target });
  /** @type {Map<string, Set<string>>} */
  const truthIndex = new Map();
  for (const t of truthRes.truthCalls) {
    const label = extractCallerLabel(t.caller, t.file);
    const key = `${t.file}|${label}|${t.callee}`;
    if (!truthIndex.has(t.file)) truthIndex.set(t.file, new Set());
    truthIndex.get(t.file).add(key);
  }
  const truthFilesWithCalls = new Set(truthIndex.keys());
  /** @type {Set<string>} */
  const truthTuples = new Set();
  for (const [, set] of truthIndex) {
    for (const k of set) truthTuples.add(k);
  }

  // 扫描文件 + analyzeFile + 收 mapper 输出
  const files = collectJavaFiles(target);
  /** @type {Set<string>} */
  const mapperTuples = new Set();
  /** @type {Set<string>} */
  const mapperFilesWithCalls = new Set();
  for (const absPath of files) {
    const relFile = normalizeRelPath(absPath, target);
    try {
      const sk = await adapter.analyzeFile(absPath, { extractCallSites: true });
      const cs = sk.callSites ?? [];
      if (cs.length > 0) mapperFilesWithCalls.add(relFile);
      for (const c of cs) {
        const label = c.callerContext ?? '<top-level>';
        mapperTuples.add(`${relFile}|${label}|${c.calleeName}`);
      }
    } catch (err) {
      console.warn(`[verify-154] skip ${absPath}: ${err.message}`);
    }
  }

  // SC-001 fillRate 分母 = truth-set 真实有调用文件数
  let intersectFiles = 0;
  for (const f of mapperFilesWithCalls) {
    if (truthFilesWithCalls.has(f)) intersectFiles++;
  }
  const fillRate = truthFilesWithCalls.size > 0
    ? intersectFiles / truthFilesWithCalls.size
    : 0;

  // SC-002 label-only precision/recall（NaN 防护）
  let intersectTuples = 0;
  for (const m of mapperTuples) {
    if (evaluateMatch(m, truthTuples)) intersectTuples++;
  }
  const precision = mapperTuples.size > 0 ? intersectTuples / mapperTuples.size : 0;
  const recall = truthTuples.size > 0 ? intersectTuples / truthTuples.size : 0;

  return {
    fillRate,
    precision,
    recall,
    truthFilesWithCalls: truthFilesWithCalls.size,
    truthTuples: truthTuples.size,
    mapperFilesWithCalls: mapperFilesWithCalls.size,
    mapperTuples: mapperTuples.size,
    intersectFiles,
    intersectTuples,
    truthIndex,
    mapperTuples,
    files: files.length,
  };
}

function debugOutput(lastRun) {
  // 找 recall 最差的 truth 文件
  const fileMissCount = new Map();
  for (const [file, truthSet] of lastRun.truthIndex) {
    let miss = 0;
    for (const k of truthSet) {
      if (!lastRun.mapperTuples.has(k)) miss++;
    }
    if (miss > 0) fileMissCount.set(file, { total: truthSet.size, miss });
  }
  const sorted = [...fileMissCount.entries()].sort((a, b) => b[1].miss - a[1].miss);
  console.error('\n[verify-154] debug — 最差 recall 文件 Top 5:');
  for (const [file, stat] of sorted.slice(0, 5)) {
    console.error(
      `  ${file}: truth=${stat.total} miss=${stat.miss} hit=${stat.total - stat.miss}`,
    );
    const truthSet = lastRun.truthIndex.get(file);
    let shown = 0;
    for (const k of truthSet) {
      if (!lastRun.mapperTuples.has(k) && shown < 3) {
        console.error(`    miss: ${k}`);
        shown++;
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (!args.target) {
    console.error(HELP_TEXT);
    console.error('错误：缺少 --target 参数');
    process.exit(2);
  }
  const target = path.resolve(args.target);
  if (!fs.existsSync(target)) {
    console.error(`错误：target 目录不存在 ${target}`);
    process.exit(2);
  }

  const projectRoot = path.resolve(import.meta.dirname, '..');
  const distAdapter = path.join(projectRoot, 'dist', 'adapters', 'java-adapter.js');
  if (!fs.existsSync(distAdapter)) {
    console.error(`错误：未找到 dist 产物 ${distAdapter}`);
    console.error('请先运行 npm run build');
    process.exit(2);
  }

  console.error(`[verify-154] target: ${target}`);
  console.error(`[verify-154] repeats: ${args.repeats}`);

  /** @type {Array<{fillRate:number,precision:number,recall:number}>} */
  const runsRaw = [];
  let lastRun;
  for (let i = 1; i <= args.repeats; i++) {
    console.error(`[verify-154] run ${i}/${args.repeats}...`);
    const r = await runOnce(target, projectRoot);
    runsRaw.push({
      fillRate: r.fillRate,
      precision: r.precision,
      recall: r.recall,
    });
    console.error(
      `  fillRate=${(r.fillRate * 100).toFixed(1)}% ` +
        `precision=${(r.precision * 100).toFixed(1)}% ` +
        `recall=${(r.recall * 100).toFixed(1)}% ` +
        `(truthFiles=${r.truthFilesWithCalls} truthTuples=${r.truthTuples} ` +
        `mapperFiles=${r.mapperFilesWithCalls} mapperTuples=${r.mapperTuples})`,
    );
    lastRun = r;
  }

  const fillRateMed = median(runsRaw.map((r) => r.fillRate));
  const precisionMed = median(runsRaw.map((r) => r.precision));
  const recallMed = median(runsRaw.map((r) => r.recall));

  const thresholds = { fillRate: 0.95, precision: 0.7, recall: 0.3 };
  const pass =
    fillRateMed >= thresholds.fillRate &&
    precisionMed >= thresholds.precision &&
    recallMed >= thresholds.recall;

  const summary = {
    target,
    repeats: args.repeats,
    runsRaw,
    median: {
      fillRate: fillRateMed,
      precision: precisionMed,
      recall: recallMed,
    },
    thresholds,
    pass,
    truthStats: lastRun
      ? {
          totalFiles: lastRun.files,
          filesWithCalls: lastRun.truthFilesWithCalls,
          totalCalls: lastRun.truthTuples,
        }
      : null,
  };

  if (args.outFile) {
    fs.writeFileSync(args.outFile, JSON.stringify(summary, null, 2), 'utf-8');
    console.error(`[verify-154] 汇总写入 ${args.outFile}`);
  }
  console.log(JSON.stringify(summary, null, 2));

  if ((args.debug || recallMed < thresholds.recall) && lastRun) {
    debugOutput(lastRun);
  }

  console.error(
    `\n[verify-154] median fillRate=${(fillRateMed * 100).toFixed(1)}% ` +
      `precision=${(precisionMed * 100).toFixed(1)}% ` +
      `recall=${(recallMed * 100).toFixed(1)}% pass=${pass}`,
  );
  process.exit(pass ? 0 : 1);
}

// CLI 入口（仅在直接运行时执行；import 测试不触发）
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('verify-feature-154.mjs');
if (isMain) {
  main().catch((err) => {
    console.error(`[verify-154] error: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
