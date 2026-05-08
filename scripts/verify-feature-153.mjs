#!/usr/bin/env node
/**
 * Feature 153 — 独立验收脚本（T-014 + T-015 + T-016）
 *
 * 端到端流程（不依赖 spectra batch / LLM）：
 *   1. 在 Go 项目根上 dynamic import dist/.js
 *   2. 收集顶层 .go 文件 (默认 GORM ignoreDirs)，调 GoLanguageAdapter.analyzeFile + extractCallSites: true
 *   3. buildUnifiedGraph(skeletons) → UnifiedGraph (含 calls 边)
 *   4. extractGoCallSites(sourceRoot, ignoreDirs) → truth-set
 *   5. label-only matching: precision/recall (caller/callee 二元组 IoU)
 *   6. 计算 callSites 填充率 (filesWithNonEmptyCallSites / totalGoFiles)
 *   7. N=3 重测取中位数
 *
 * 输出 schema 严格对齐 verify-feature-151.mjs（Codex Round-1 implement CRITICAL J 修订）。
 * FR-11 验收门槛通过 exit code 表达：exit 0 = SC-1 + SC-2 全部通过；exit 1 = 任一未通过。
 *
 * 用法：
 *   npm run build
 *   node scripts/verify-feature-153.mjs --target ~/.spectra-baselines/gorm
 *   node scripts/verify-feature-153.mjs --target /custom/go/project --ignore-dirs internal,vendor
 *   node scripts/verify-feature-153.mjs --target ~/.spectra-baselines/gorm --out summary.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

// GORM 顶层包默认 ignoreDirs（与 spec.md FR-10 + go-call-extractor.mjs:79-82 注释一致）
const DEFAULT_GORM_IGNORE_DIRS = [
  'callbacks',
  'clause',
  'internal',
  'logger',
  'migrator',
  'schema',
  'tests',
  'utils',
];

function parseArgs(argv) {
  const out = { repeats: 3 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--target') out.target = argv[++i];
    else if (k === '--out') out.out = argv[++i];
    else if (k === '--repeats') out.repeats = parseInt(argv[++i], 10);
    else if (k === '--ignore-dirs') {
      out.ignoreDirs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (k === '--help' || k === '-h') {
      console.error(`用法：node scripts/verify-feature-153.mjs [options]

Options:
  --target <path>       Go 项目根目录（默认 ~/.spectra-baselines/gorm）
  --ignore-dirs a,b,c   跳过的子目录名（默认 GORM 顶层 scope）
  --repeats N           重测次数取中位数（默认 3）
  --out <file.json>     summary 写入此文件
  --help, -h            显示此帮助

默认 ignoreDirs: ${DEFAULT_GORM_IGNORE_DIRS.join(', ')}

退出码:
  0 = SC-1 (fillRate ≥ 0.95) + SC-2 (precision ≥ 0.70 && recall ≥ 0.30) 全部通过
  1 = 任一未通过 / 异常`);
      process.exit(0);
    }
  }
  return out;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 收集 .go 文件（POSIX 归一），默认 GORM 顶层包 scope。
 * @param {string} root
 * @param {string[]} extraIgnoreDirs
 * @returns {string[]} 绝对路径数组
 */
function collectGoFiles(root, extraIgnoreDirs) {
  const COMMON_IGNORE = new Set([
    'node_modules',
    '.git',
    'vendor',
    'dist',
    'build',
    '.cache',
  ]);
  const ignoreSet = new Set([...COMMON_IGNORE, ...extraIgnoreDirs]);
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
        if (ignoreSet.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.go')) {
        // GORM scope: 排除 _test.go (避免测试库 dot import 干扰评估)
        if (entry.name.endsWith('_test.go')) continue;
        out.push(path.join(dir, entry.name));
      }
    }
  }
  walk(root);
  return out;
}

/**
 * label-only matching: caller/callee 二元组 IoU。
 *
 * caller 归一化合约（plan.md §3.4）:
 *   - graph edge.source 格式: <absPath>::<callerContext>
 *     例: /Users/foo/.spectra-baselines/gorm/finisher_api.go::DB.First
 *   - truth caller 格式: <relPath>:<callerContext>
 *     例: finisher_api.go:DB.First
 *   - normalize(graphSrc) = posixRel + ':' + callerContext
 *
 * @param {Array} graphEdges UnifiedGraph.edges
 * @param {Array} truthCalls TruthCall[]
 * @param {string} sourceRoot
 * @returns {{precision: number, recall: number, sampleHits: Array}}
 */
function labelOnlyMatch(graphEdges, truthCalls, sourceRoot) {
  // 把 graph caller (absPath::ctx) 归一到 truth 格式 (relPath:ctx)
  const normalizeGraphSource = (graphSrc) => {
    const parts = graphSrc.split('::');
    if (parts.length < 2) return graphSrc;
    const absPath = parts[0];
    const ctx = parts.slice(1).join('::');
    let relPath;
    try {
      const relRaw = path.relative(sourceRoot, absPath);
      relPath = relRaw.split(path.sep).join('/');
    } catch {
      relPath = absPath;
    }
    return `${relPath}:${ctx}`;
  };

  // 从 graph edge.target 提取 callee 名（target 格式: <absPath>::<calleeName> 或 ?::Method）
  const extractCalleeFromTarget = (target) => {
    const idx = target.lastIndexOf('::');
    if (idx === -1) return target;
    const tail = target.slice(idx + 2);
    // tail 可能是 "Method" / "Class.method" / "?::Name" 形态
    // 取最后一个 . 之后（如果有）作为 callee leaf
    const dotIdx = tail.lastIndexOf('.');
    return dotIdx === -1 ? tail : tail.slice(dotIdx + 1);
  };

  const callsEdges = graphEdges.filter((e) => e.relation === 'calls');

  // graph pairs: Set<"caller_normalized||callee_leaf">
  const graphPairs = new Set();
  for (const e of callsEdges) {
    const caller = normalizeGraphSource(e.source);
    const callee = extractCalleeFromTarget(e.target);
    graphPairs.add(`${caller}||${callee}`);
  }

  // truth pairs: Set<"truth.caller||truth.callee">
  const truthPairs = new Set();
  for (const t of truthCalls) {
    truthPairs.add(`${t.caller}||${t.callee}`);
  }

  // 交集
  const sampleHits = [];
  let hitCount = 0;
  for (const p of graphPairs) {
    if (truthPairs.has(p)) {
      hitCount++;
      if (sampleHits.length < 10) sampleHits.push(p);
    }
  }

  const precision = graphPairs.size > 0 ? hitCount / graphPairs.size : 0;
  const recall = truthPairs.size > 0 ? hitCount / truthPairs.size : 0;
  return { precision, recall, sampleHits };
}

async function main() {
  const args = parseArgs(process.argv);
  const targetRoot = path.resolve(
    args.target ?? path.join(os.homedir(), '.spectra-baselines/gorm'),
  );
  if (!fs.existsSync(targetRoot)) {
    console.error(`目标目录不存在: ${targetRoot}`);
    process.exit(1);
  }
  const ignoreDirs = args.ignoreDirs ?? DEFAULT_GORM_IGNORE_DIRS;

  const projectRoot = path.resolve(import.meta.dirname, '..');
  const distMain = path.join(projectRoot, 'dist', 'knowledge-graph', 'index.js');
  if (!fs.existsSync(distMain)) {
    console.error(`未找到 dist 产物 ${distMain}；请先 npm run build`);
    process.exit(1);
  }

  // dynamic import dist
  const { buildUnifiedGraph } = await import(distMain);
  const { GoLanguageAdapter } = await import(
    path.join(projectRoot, 'dist', 'adapters', 'go-adapter.js')
  );
  const { bootstrapRuntime } = await import(
    path.join(projectRoot, 'dist', 'runtime-bootstrap.js')
  );
  // 注: extractGoCallSites 不在主进程 dynamic import — 通过子进程 (scripts/go-truth-set-cli.mjs)
  // 调用，避免 web-tree-sitter ESM/CommonJS 双实例 Parser.init 冲突
  const truthSetCliPath = path.join(projectRoot, 'scripts', 'go-truth-set-cli.mjs');

  bootstrapRuntime();

  // 1. 收集 .go 文件
  console.error(`[verify-153] 扫描 ${targetRoot}（ignoreDirs: ${ignoreDirs.join(', ')}）...`);
  const goFiles = collectGoFiles(targetRoot, ignoreDirs);
  console.error(`[verify-153] 发现 ${goFiles.length} 个 .go 文件（顶层 scope）`);

  // 2. analyzeFile + extractCallSites: true
  const adapter = new GoLanguageAdapter();
  const skeletons = new Map();
  const wallStart = performance.now();
  for (const filePath of goFiles) {
    try {
      const sk = await adapter.analyzeFile(filePath, { extractCallSites: true });
      skeletons.set(filePath, sk);
    } catch (err) {
      console.error(`  skip ${filePath}: ${err.message}`);
    }
  }
  const wallMapperMs = performance.now() - wallStart;

  // 3. buildUnifiedGraph
  const ug = buildUnifiedGraph({
    projectRoot: targetRoot,
    codeSkeletons: skeletons,
  });
  const callsCount = ug.edges.filter((e) => e.relation === 'calls').length;
  console.error(
    `[verify-153] UnifiedGraph: ${ug.nodes.length} 节点 / ${callsCount} calls 边 / ${wallMapperMs.toFixed(0)}ms 耗时`,
  );

  // 4. callSites 填充率（mapper 端基础数据）
  let filesWithCallSites = 0;
  let totalCallSites = 0;
  for (const sk of skeletons.values()) {
    if (sk.callSites && sk.callSites.length > 0) {
      filesWithCallSites++;
      totalCallSites += sk.callSites.length;
    }
  }
  // fillRate 暂用 skeletons.size 作分母占位；真实分母应是"truth 端有 calls 的文件数"
  // （在 SC-2 第一次跑完 truth-set 后修订），见下文 fillRateAdjusted
  const fillRateOverAll = skeletons.size > 0 ? filesWithCallSites / skeletons.size : 0;
  console.error(
    `[verify-153] callSites mapper 端: ${filesWithCallSites}/${skeletons.size} 文件 (${(fillRateOverAll * 100).toFixed(1)}% over all .go) / ${totalCallSites} 总 callSites`,
  );

  // 5. precision/recall N=3 重测
  console.error(`\n[verify-153] === SC-2 precision/recall (N=${args.repeats}) ===`);
  const precisionRuns = [];
  const recallRuns = [];
  let lastSampleHits = [];
  let truthFilesWithCalls = 0;
  let truthCallsCount = 0;
  for (let run = 1; run <= args.repeats; run++) {
    try {
      // 子进程跑 truth-set extractor (避免 web-tree-sitter ESM/CommonJS 冲突)
      // --exclude-test-files: 与主进程 collectGoFiles 排除 _test.go 行为对齐
      const cliArgs = ['--source', targetRoot, '--exclude-test-files'];
      if (ignoreDirs.length > 0) {
        cliArgs.push('--ignore-dirs', ignoreDirs.join(','));
      }
      const truthJson = execFileSync('node', [truthSetCliPath, ...cliArgs], {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
      });
      const truth = JSON.parse(truthJson);
      const truthFiles = new Set(truth.truthCalls.map((t) => t.file));
      truthFilesWithCalls = truthFiles.size;
      truthCallsCount = truth.truthCalls.length;
      const { precision, recall, sampleHits } = labelOnlyMatch(
        ug.edges,
        truth.truthCalls,
        targetRoot,
      );
      precisionRuns.push(precision);
      recallRuns.push(recall);
      lastSampleHits = sampleHits;
      console.error(
        `  run ${run}: precision=${(precision * 100).toFixed(1)}% recall=${(recall * 100).toFixed(1)}% (truth: ${truthCallsCount} calls / ${truthFilesWithCalls} files)`,
      );
    } catch (err) {
      console.error(`  run ${run} 错误：${err.message}`);
    }
  }
  // Codex Round-1 verify-phase CRITICAL C 修订：N=K 中任一失败必须 hard-fail，
  // 不能让 median 静默吞掉部分失败让 gate 被架空
  if (precisionRuns.length !== args.repeats || recallRuns.length !== args.repeats) {
    console.error(
      `\n[verify-153] ❌ N=${args.repeats} 重测中有 ${args.repeats - precisionRuns.length} 次失败，gate 不可信，硬失败退出`,
    );
    process.exit(1);
  }
  const precisionMedianVal = median(precisionRuns);
  const recallMedianVal = median(recallRuns);
  console.error(
    `\n[verify-153] 中位数 (N=${args.repeats}): precision=${(precisionMedianVal * 100).toFixed(1)}% recall=${(recallMedianVal * 100).toFixed(1)}%`,
  );

  // 重算 fillRate：分母用 truthFilesWithCalls（真实有 call 的文件数，type-only 文件不纳入）
  // 这与 SC-1 spec 意图"mapper 在有 call 的文件上 fill rate ≥ 95%"严格对齐
  // truthFilesWithCalls 应已经过 _test.go 过滤（cli 端 --exclude-test-files），与 mapper 端 scope 一致
  // 计算 mapper 端 ∩ truth-with-calls 的文件数
  const truthFilePathsWithCalls = new Set();
  // 重新 collect truth-side file set（最后一次 run 已经有数据；用 truthFilesWithCalls 数字 + sample 不够，需要重读 truth）
  // 简单做法：再跑一次 truth-set 拿 file set
  try {
    const cliArgs = ['--source', targetRoot, '--exclude-test-files'];
    if (ignoreDirs.length > 0) cliArgs.push('--ignore-dirs', ignoreDirs.join(','));
    const truthJson = execFileSync('node', [truthSetCliPath, ...cliArgs], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const truth = JSON.parse(truthJson);
    for (const t of truth.truthCalls) {
      // truth.file 是 relPath（POSIX），mapper 端 absPath；做归一化
      truthFilePathsWithCalls.add(path.resolve(targetRoot, t.file));
    }
  } catch (err) {
    console.error(`[verify-153] 重算 fillRate truth file set 失败: ${err.message}`);
  }

  // mapper 端在 truth-with-calls 文件上的 fill rate
  let mapperHitsOnTruthFiles = 0;
  for (const filePath of truthFilePathsWithCalls) {
    const sk = skeletons.get(filePath);
    if (sk && sk.callSites && sk.callSites.length > 0) {
      mapperHitsOnTruthFiles++;
    }
  }
  const fillRateOnTruthFiles =
    truthFilePathsWithCalls.size > 0
      ? mapperHitsOnTruthFiles / truthFilePathsWithCalls.size
      : 0;
  console.error(
    `[verify-153] callSites fillRate (over truth-with-calls): ${mapperHitsOnTruthFiles}/${truthFilePathsWithCalls.size} = ${(fillRateOnTruthFiles * 100).toFixed(1)}%`,
  );

  // 6. 输出 summary（schema 严格对齐 verify-feature-151.mjs + 加 fillRateOnTruthFiles）
  const summary = {
    target: targetRoot,
    ignoreDirs,
    goFileCount: goFiles.length,
    skeletonsCount: skeletons.size,
    unifiedGraphNodes: ug.nodes.length,
    unifiedGraphCallsEdges: callsCount,
    unifiedGraphDependsEdges: ug.edges.filter((e) => e.relation === 'depends-on')
      .length,
    callSitesTotal: totalCallSites,
    filesWithCallSites,
    truthFilesWithCalls,
    truthCallsTotal: truthCallsCount,
    // fillRate 取 fillRateOnTruthFiles（truth-with-calls 分母），符合 SC-1 spec 意图
    fillRate: fillRateOnTruthFiles,
    fillRatePercent: (fillRateOnTruthFiles * 100).toFixed(1),
    fillRateOverAll: fillRateOverAll,
    fillRateOverAllPercent: (fillRateOverAll * 100).toFixed(1),
    mapperHitsOnTruthFiles,
    wallMapperMs: wallMapperMs.toFixed(0),
    precisionRuns: precisionRuns.map((p) => p.toFixed(3)),
    recallRuns: recallRuns.map((r) => r.toFixed(3)),
    precisionMedian: precisionMedianVal.toFixed(3),
    recallMedian: recallMedianVal.toFixed(3),
    precisionMedianPercent: (precisionMedianVal * 100).toFixed(1),
    recallMedianPercent: (recallMedianVal * 100).toFixed(1),
    sampleHits: lastSampleHits,
  };

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(summary, null, 2), 'utf-8');
    console.error(`\n[verify-153] 汇总写入 ${args.out}`);
  }
  console.log(JSON.stringify(summary, null, 2));

  // FR-11 验收门槛通过 exit code 表达（不污染公共 summary schema）
  const sc1Pass = fillRateOnTruthFiles >= 0.95;
  const sc2Pass = precisionMedianVal >= 0.7 && recallMedianVal >= 0.3;
  if (sc1Pass && sc2Pass) {
    console.error(`\n[verify-153] ✅ SC-1 PASS (fillRate ${(fillRateOnTruthFiles * 100).toFixed(1)}% ≥ 95%) + SC-2 PASS (precision ${(precisionMedianVal * 100).toFixed(1)}% ≥ 70% && recall ${(recallMedianVal * 100).toFixed(1)}% ≥ 30%)`);
    process.exit(0);
  } else {
    console.error(`\n[verify-153] ❌ SC-1 ${sc1Pass ? 'PASS' : 'FAIL'} / SC-2 ${sc2Pass ? 'PASS' : 'FAIL'}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[verify-153] error: ${err.stack ?? err.message}`);
  process.exit(1);
});
