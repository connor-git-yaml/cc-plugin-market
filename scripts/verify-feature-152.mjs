#!/usr/bin/env node
/**
 * Feature 152 — 独立验收脚本（T-024 ~ T-030）
 *
 * 测量 Feature 152 的核心 SC（Success Criteria）指标：
 *   SC-001 fillRate         — callSites 填充率（分母用 truth set 含调用文件数）
 *   SC-002 precision/recall — TS call graph accuracy N=3 中位数
 *   SC-003 python-resolution — Python dotted import 解析正确率
 *   SC-006 perf             — collectTsJsCodeSkeletons baseline/enable 耗时 delta
 *   SC-008 sc008            — new Foo() → class Foo 图连通率（truth-set 对照）
 *
 * 用法：
 *   node scripts/verify-feature-152.mjs --target <path> [options]
 *
 * Options:
 *   --target <path>    目标项目根目录（必选；可重复指定多个）
 *   --repeats <n>      SC-002 precision/recall 重复次数（默认 3）
 *   --metric <name>    仅测单项：fill-rate | ts-precision-recall | python-resolution | perf | sc008 | all（默认 all）
 *   --out <path>       输出 JSON 路径（默认 stdout）
 *   --help             显示帮助
 *
 * 架构参考：scripts/verify-feature-151.mjs（整体架构、GraphJSON 包装方式、N=3 median 计算）
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ── CLI 解析 ──────────────────────────────────────────────────

function showHelp() {
  process.stdout.write(`\
verify-feature-152.mjs — Feature 152 验收脚本

用法:
  node scripts/verify-feature-152.mjs --target <path> [options]

Options:
  --target <path>         目标项目根目录（必选；可重复指定多个）
  --repeats <n>           SC-002 precision/recall 重复次数（默认 3）
  --metric <name>         仅测单项指标（fill-rate | ts-precision-recall |
                          python-resolution | perf | sc008 | all）（默认 all）
  --out <path>            输出 JSON 路径（默认 stdout）
  --help                  显示此帮助后退出

示例:
  node scripts/verify-feature-152.mjs --target ./src
  node scripts/verify-feature-152.mjs --target ./src --metric perf
  node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/micrograd --metric ts-precision-recall
  node scripts/verify-feature-152.mjs --target ./src --target ~/.spectra-baselines/micrograd --metric all
`);
  process.exit(0);
}

function parseArgs(argv) {
  // 默认配置
  const out = {
    targets: /** @type {string[]} */ ([]),
    repeats: 3,
    metric: 'all',
    outFile: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      showHelp();
    } else if (k === '--target') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        console.error('[verify-152] --target requires a path argument');
        process.exit(1);
      }
      out.targets.push(argv[++i]);
    } else if (k === '--repeats') {
      out.repeats = parseInt(argv[++i], 10);
    } else if (k === '--metric') {
      out.metric = argv[++i];
    } else if (k === '--out') {
      out.outFile = argv[++i];
    } else {
      console.error(`[verify-152] 未知参数: ${k}，运行 --help 查看帮助`);
      process.exit(1);
    }
  }

  return out;
}

// ── 工具函数 ──────────────────────────────────────────────────

/** 从数组计算中位数 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 把 UnifiedGraph 包装成 graph-accuracy.mjs 可读的最小 GraphJSON（node-link 格式）。
 * 与 verify-feature-151.mjs L128-158 保持一致。
 */
function wrapGraphJson(ug, label) {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: label ?? 'feature-152-verify',
      generatedAt: new Date().toISOString(),
      nodeCount: ug.nodes.length,
      edgeCount: ug.edges.length,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: ug.nodes.map((n) => ({
      id: n.id,
      kind: n.kind === 'symbol' ? 'component' : n.kind,
      label: n.label,
      sourceFile: n.filePath ?? n.id,
      metadata: n.metadata ?? {},
    })),
    links: ug.edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: e.confidence === 'high' ? 'EXTRACTED' : e.confidence === 'medium' ? 'INFERRED' : 'AMBIGUOUS',
      confidenceScore: e.confidence === 'high' ? 0.95 : e.confidence === 'medium' ? 0.65 : 0.25,
      directional: e.directional,
    })),
  };
}

/**
 * 写临时 graph.json 到 tmpDir，返回文件路径。
 * 调用方负责在用完后删除 tmpDir。
 */
function writeGraphJson(graphJson, tmpDir) {
  const graphPath = path.join(tmpDir, 'graph.json');
  fs.writeFileSync(graphPath, JSON.stringify(graphJson, null, 2), 'utf-8');
  return graphPath;
}

/** 运行 node 子进程，返回 stdout 字符串；失败时抛错 */
function runNode(scriptPath, scriptArgs) {
  return execFileSync('node', [scriptPath, ...scriptArgs], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

// ── SC 测量逻辑 ───────────────────────────────────────────────

/**
 * SC-001 fillRate（T-025，C-6 修复版本）
 *
 * 分子：collectTsJsCodeSkeletons 中 callSites.length > 0 的文件数
 * 分母：graph-accuracy.mjs --language ts truth set 中按 file 去重的含调用文件数
 */
async function measureFillRate(targetRoot, { collectTsJsCodeSkeletons, accuracyScript }) {
  // 1. 收集 TS/JS code skeletons（含 callSites）
  const codeSkeletons = await collectTsJsCodeSkeletons(targetRoot, { extractCallSites: true });

  // 2. 统计含 callSites 的文件数
  let fillRateFilesWithCallSites = 0;
  for (const sk of codeSkeletons.values()) {
    if (Array.isArray(sk.callSites) && sk.callSites.length > 0) {
      fillRateFilesWithCallSites++;
    }
  }

  // 3. 获取 truth set（不传 --graph，仅 truth set 模式），按 file 去重
  let fillRateTruthFiles = 0;
  let fillRate = null;
  try {
    const truthOut = runNode(accuracyScript, ['--language', 'ts', '--source', targetRoot]);
    const truthResult = JSON.parse(truthOut);
    // truthResult.truthCalls[].file 去重得到含调用文件数
    const truthFiles = new Set(
      (truthResult.truthCalls ?? []).map((c) => c.file),
    );
    fillRateTruthFiles = truthFiles.size;
    fillRate = fillRateTruthFiles > 0 ? fillRateFilesWithCallSites / fillRateTruthFiles : null;
  } catch (err) {
    console.error(`[verify-152] SC-001 truth set 获取失败: ${err.message}`);
    fillRate = null;
  }

  return {
    fillRate,
    fillRateFilesWithCallSites,
    fillRateTruthFiles,
    // 返回 codeSkeletons 供后续复用
    _codeSkeletons: codeSkeletons,
  };
}

/**
 * SC-002 precision/recall N=3 中位数测量（T-026）
 *
 * 构建 graph.json → 重复 N 次调用 graph-accuracy.mjs --language ts → 取中位数
 * 附带 FR-8.4 Python smoke test
 */
async function measurePrecisionRecall(targetRoot, {
  buildUnifiedGraph,
  accuracyScript,
  repeats,
  tmpDir,
  codeSkeletons,
}) {
  // 构建 UnifiedGraph
  const ug = buildUnifiedGraph({ projectRoot: targetRoot, codeSkeletons });
  const callsCount = ug.edges.filter((e) => e.relation === 'calls').length;
  const dependsCount = ug.edges.filter((e) => e.relation === 'depends-on').length;
  console.error(
    `[verify-152] UnifiedGraph: ${ug.nodes.length} 节点 / ${callsCount} calls 边 / ${dependsCount} depends-on 边`,
  );

  // 包装并写入临时 graph.json
  const graphJson = wrapGraphJson(ug, `feature-152-verify-${path.basename(targetRoot)}`);
  const graphPath = writeGraphJson(graphJson, tmpDir);
  console.error(`[verify-152] graph.json 写入 ${graphPath}`);

  // N 次重测 precision/recall
  const precisionRuns = [];
  const recallRuns = [];
  for (let run = 1; run <= repeats; run++) {
    try {
      const accOut = runNode(accuracyScript, [
        '--language', 'ts',
        '--source', targetRoot,
        '--graph', graphPath,
      ]);
      const acc = JSON.parse(accOut);
      if (acc.accuracy?.callPrecision !== undefined) {
        precisionRuns.push(acc.accuracy.callPrecision);
        recallRuns.push(acc.accuracy.callRecall);
        console.error(
          `  run ${run}: precision=${(acc.accuracy.callPrecision * 100).toFixed(1)}% recall=${(acc.accuracy.callRecall * 100).toFixed(1)}%`,
        );
      }
    } catch (err) {
      console.error(`  run ${run} 错误: ${err.message}`);
    }
  }

  const precisionMedian = median(precisionRuns);
  const recallMedian = median(recallRuns);
  console.error(
    `[verify-152] SC-002 中位数 (N=${repeats}): precision=${(precisionMedian * 100).toFixed(1)}% recall=${(recallMedian * 100).toFixed(1)}%`,
  );

  // FR-8.4 Python 路径回归保护（smoke test）
  let pythonSmokeOk = false;
  let pythonSmokeError = null;
  try {
    // Python smoke test 需要 --graph（python 路径必须传 graph）
    // 如果 target 没有 .py 文件，graph-accuracy 可能报错，视为 smoke ok（N/A）
    const pyFiles = countFiles(targetRoot, ['.py', '.pyi']);
    if (pyFiles === 0) {
      pythonSmokeOk = true; // 无 .py 文件，跳过 python smoke
      console.error(`[verify-152] FR-8.4 Python smoke: 目标无 .py 文件，跳过`);
    } else {
      runNode(accuracyScript, [
        '--language', 'python',
        '--source', targetRoot,
        '--graph', graphPath,
      ]);
      pythonSmokeOk = true;
      console.error(`[verify-152] FR-8.4 Python smoke: OK`);
    }
  } catch (err) {
    pythonSmokeError = err.message;
    console.error(`[verify-152] FR-8.4 Python smoke 警告（非阻断）: ${err.message}`);
  }

  return {
    precisionMedian,
    recallMedian,
    precisionRuns,
    recallRuns,
    pythonSmokeOk,
    pythonSmokeError,
    // 返回 graphPath 和 graphJson 供 SC-008 复用
    _graphPath: graphPath,
    _graphJson: graphJson,
    _ug: ug,
  };
}

/**
 * SC-003 Python import 解析正确率（T-027，C-7 完整路径比对）
 *
 * 筛选 isRelative===false && moduleSpecifier.includes('.') 的 import，
 * 用完整 dotted path 比对（不是末段比对）验证 resolvedPath 正确性。
 */
async function measurePythonResolution(targetRoot, { collectPythonCodeSkeletons }) {
  // 检查是否有 .py 文件
  const pyFileCount = countFiles(targetRoot, ['.py', '.pyi']);
  if (pyFileCount === 0) {
    console.error(`[verify-152] SC-003: 目标无 .py 文件，返回 N/A`);
    return {
      pythonResolutionRate: null,
      pythonResolutionEligible: 0,
      pythonResolutionHits: 0,
      pythonResolutionNa: true,
    };
  }

  const codeSkeletons = await collectPythonCodeSkeletons(targetRoot);

  // 筛选 eligibleImports：non-relative，**且期望路径文件存在于项目内**
  // （宽松化：同时覆盖 dotted package `from pkg.engine import X` 和单段 module `from model import X`）
  // 关键：通过"期望路径在项目中存在"自动排除 stdlib / 第三方包 — 它们的期望文件不在项目内
  const eligibleImports = [];
  for (const sk of codeSkeletons.values()) {
    for (const imp of (sk.imports ?? [])) {
      if (imp.isRelative !== false) continue;
      const spec = imp.moduleSpecifier;
      if (!spec) continue;

      // 期望路径：moduleSpecifier 中 '.' 换成 '/'
      const base = spec.split('.').join('/');
      const expectedPaths = [
        path.join(targetRoot, base + '.py'),
        path.join(targetRoot, base, '__init__.py'),
      ];
      const expectedExists = expectedPaths.some((p) => fs.existsSync(p));
      if (expectedExists) {
        eligibleImports.push({ sk, imp, expectedPaths });
      }
    }
  }

  if (eligibleImports.length === 0) {
    console.error(`[verify-152] SC-003: 未找到本仓库内 import，返回 N/A`);
    return {
      pythonResolutionRate: null,
      pythonResolutionEligible: 0,
      pythonResolutionHits: 0,
      pythonResolutionNa: true,
    };
  }

  // C-7 修复：完整路径比对 — resolvedPath 必须命中 expected 之一
  let hits = 0;
  for (const { imp, expectedPaths } of eligibleImports) {
    if (!imp.resolvedPath) continue;

    // 把 resolvedPath（绝对或相对）转换为绝对路径用于比对
    const absResolved = path.isAbsolute(imp.resolvedPath)
      ? imp.resolvedPath
      : path.resolve(targetRoot, imp.resolvedPath);

    // 比对：absResolved 必须等于 expectedPaths 之一（normalize 后）
    const matched = expectedPaths.some(
      (expected) => path.normalize(absResolved) === path.normalize(expected),
    );
    if (matched) hits++;
  }

  const pythonResolutionRate = eligibleImports.length > 0 ? hits / eligibleImports.length : null;
  console.error(
    `[verify-152] SC-003: ${hits}/${eligibleImports.length} 项目内 imports 命中正确路径 (${((pythonResolutionRate ?? 0) * 100).toFixed(1)}%)`,
  );

  return {
    pythonResolutionRate,
    pythonResolutionEligible: eligibleImports.length,
    pythonResolutionHits: hits,
  };
}

/**
 * SC-006 性能 baseline / enable / delta（T-028）
 *
 * 分别计时 extractCallSites=false 和 true 的耗时差
 */
async function measurePerf(targetRoot, { collectTsJsCodeSkeletons }) {
  console.error(`[verify-152] SC-006: 测量性能 baseline (extractCallSites=false)...`);
  const t0 = Date.now();
  await collectTsJsCodeSkeletons(targetRoot, { extractCallSites: false });
  const baselineMs = Date.now() - t0;

  console.error(`[verify-152] SC-006: 测量性能 enable (extractCallSites=true)...`);
  const t1 = Date.now();
  await collectTsJsCodeSkeletons(targetRoot, { extractCallSites: true });
  const enableMs = Date.now() - t1;

  const deltaMs = enableMs - baselineMs;
  console.error(
    `[verify-152] SC-006: baseline=${baselineMs}ms enable=${enableMs}ms delta=${deltaMs}ms`,
  );

  return {
    perf: {
      nodeVersion: process.version,
      platform: process.platform,
      cpuCount: os.cpus().length,
      baselineMs,
      enableMs,
      deltaMs,
    },
  };
}

/**
 * SC-008 new Foo() → class Foo 图连通率（T-029，C-8 truth-set 对照）
 *
 * 用 truth set 中 kind==='constructor' 条目对照 graph edges，
 * 仅统计本仓库 export class 的 new 调用（N-2 修复）
 */
async function measureSc008(targetRoot, {
  accuracyScript,
  codeSkeletons,
  graphPath,
  graphJson,
}) {
  // 检查是否有 .ts 文件
  const tsFileCount = countFiles(targetRoot, ['.ts', '.tsx', '.js', '.jsx']);
  if (tsFileCount === 0) {
    return { sc008Rate: null, sc008Hits: 0, sc008Total: 0, sc008Na: true };
  }

  // 1. 获取 truth set，筛选 kind==='constructor'
  let truthConstructors = [];
  try {
    const truthOut = runNode(accuracyScript, ['--language', 'ts', '--source', targetRoot]);
    const truthResult = JSON.parse(truthOut);
    truthConstructors = (truthResult.truthCalls ?? []).filter((c) => c.kind === 'constructor');
  } catch (err) {
    console.error(`[verify-152] SC-008 truth set 获取失败: ${err.message}`);
    return { sc008Rate: null, sc008Hits: 0, sc008Total: 0, sc008Na: true };
  }

  if (truthConstructors.length === 0) {
    console.error(`[verify-152] SC-008: truth set 无 constructor 调用，返回 N/A`);
    return { sc008Rate: null, sc008Hits: 0, sc008Total: 0, sc008Na: true };
  }

  // 2. 收集 codeSkeletons 中 kind==='class' 的 export name → localClassNames
  const localClassNames = new Set();
  for (const sk of codeSkeletons.values()) {
    for (const exp of (sk.exports ?? [])) {
      if (exp.kind === 'class' && exp.name) {
        localClassNames.add(exp.name);
      }
    }
  }

  // 3. 过滤 truthConstructors 仅保留 callee ∈ localClassNames（本仓库 class）
  const eligibleConstructors = truthConstructors.filter((c) => localClassNames.has(c.callee));
  console.error(
    `[verify-152] SC-008: ${truthConstructors.length} truth constructors，` +
    `过滤后 ${eligibleConstructors.length} 条属于本仓库 class（${localClassNames.size} classes）`,
  );

  if (eligibleConstructors.length === 0) {
    return { sc008Rate: null, sc008Hits: 0, sc008Total: 0, sc008Na: true };
  }

  // 4. 在 graph.json edges 中按 (file, line) 查找匹配的 calls 边
  //    graph 节点：sourceFile（相对路径 or 绝对路径）
  //    truth call：file（相对 targetRoot 的 POSIX 路径），line（1-based）
  const callsEdges = (graphJson.links ?? []).filter(
    (e) => e.relation === 'calls',
  );

  // 建立节点 id → sourceFile 的索引
  const nodeIdToSourceFile = new Map();
  const nodeIdToLabel = new Map();
  for (const n of (graphJson.nodes ?? [])) {
    nodeIdToSourceFile.set(n.id, n.sourceFile ?? n.id);
    nodeIdToLabel.set(n.id, n.label ?? n.id);
  }

  // 建立 source 节点 id → line 的索引（从 metadata 中取，或从 id 解析）
  // calls 边的 source 节点对应 callSite 所在文件+行，target 对应被调用的 class
  // 在 UnifiedGraph 里 calls 边 source 是 "file::callee@line" 类似的 id，或 file module id
  // 我们用宽松匹配：遍历 eligibleConstructors，对每条按 callee 名在 target 节点 label 里查找
  let hits = 0;
  for (const ec of eligibleConstructors) {
    // 查找 target 节点是 class <ec.callee> 的 calls 边
    // 策略：找 target 节点 label 中含 ec.callee（class 节点 label 通常是 "ClassName"）
    const matchingEdge = callsEdges.find((e) => {
      const tgtLabel = nodeIdToLabel.get(e.target) ?? '';
      // label 可能是 "ClassName" 或 "class ClassName" 或 "ClassName (class)"
      const normalized = tgtLabel.replace(/^class\s+/, '').replace(/\s*\(.*\)$/, '').trim();
      if (normalized !== ec.callee) return false;

      // 进一步验证 source 节点的 sourceFile 与 ec.file 对应
      const srcFile = nodeIdToSourceFile.get(e.source) ?? '';
      const srcFileBasename = path.posix.basename(srcFile.split(path.sep).join('/'));
      const ecFileBasename = path.posix.basename(ec.file);
      // 文件名后缀匹配（宽松：相同 basename 即可）
      return srcFileBasename === ecFileBasename || srcFile.endsWith(ec.file) || ec.file.endsWith(srcFileBasename.replace(/\.[^.]+$/, ''));
    });

    if (matchingEdge) {
      hits++;
    }
  }

  const sc008Rate = eligibleConstructors.length > 0 ? hits / eligibleConstructors.length : null;
  console.error(
    `[verify-152] SC-008: ${hits}/${eligibleConstructors.length} constructor calls 连通 class 节点 (${((sc008Rate ?? 0) * 100).toFixed(1)}%)`,
  );

  return {
    sc008Rate,
    sc008Hits: hits,
    sc008Total: eligibleConstructors.length,
  };
}

// ── 文件数统计辅助 ──────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'build', 'dist', 'coverage', 'out', 'target', '.tox', '.next',
]);

/** 递归统计目录下指定扩展名的文件数（不进入忽略目录） */
function countFiles(dir, exts) {
  let count = 0;
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
        walk(path.join(d, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (exts.includes(ext)) count++;
      }
    }
  }
  walk(dir);
  return count;
}

// ── 主流程 ─────────────────────────────────────────────────

async function analyzeTarget(targetRoot, args, distModules) {
  const { collectTsJsCodeSkeletons, collectPythonCodeSkeletons, buildUnifiedGraph } = distModules;
  const { repeats, metric } = args;
  const accuracyScript = path.join(__dirname, 'graph-accuracy.mjs');

  // 创建临时目录（所有中间文件写入这里）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-152-verify-'));

  console.error(`\n[verify-152] ===== target: ${targetRoot} =====`);

  try {
    /** @type {Partial<import('./verify-feature-152.mjs').VerifyResult>} */
    const result = { target: targetRoot };

    // 检查 target 是否有 TS/JS 文件
    const tsFileCount = countFiles(targetRoot, ['.ts', '.tsx', '.js', '.jsx']);
    const hasTsFiles = tsFileCount > 0;
    console.error(`[verify-152] 发现 ${tsFileCount} 个 TS/JS 文件`);

    // 如果无 TS 文件，部分 SC 返回 N/A
    if (!hasTsFiles) {
      console.error(`[verify-152] 警告：target 无 TS/JS 文件，SC-001/SC-002/SC-006/SC-008 返回 N/A`);
    }

    // ─ SC-001 fillRate ──────────────────────────────────────
    let codeSkeletons = new Map();
    if (metric === 'all' || metric === 'fill-rate') {
      console.error(`\n=== SC-001 fillRate ===`);
      if (!hasTsFiles) {
        Object.assign(result, {
          fillRate: null, fillRateFilesWithCallSites: 0, fillRateTruthFiles: 0,
        });
      } else {
        const fillResult = await measureFillRate(targetRoot, { collectTsJsCodeSkeletons, accuracyScript });
        codeSkeletons = fillResult._codeSkeletons;
        Object.assign(result, {
          fillRate: fillResult.fillRate,
          fillRateFilesWithCallSites: fillResult.fillRateFilesWithCallSites,
          fillRateTruthFiles: fillResult.fillRateTruthFiles,
        });
      }
    }

    // ─ SC-002 precision/recall ─────────────────────────────
    let graphPath = null;
    let graphJson = null;
    if (metric === 'all' || metric === 'ts-precision-recall') {
      console.error(`\n=== SC-002 precision/recall (N=${repeats}) ===`);
      if (!hasTsFiles) {
        Object.assign(result, {
          precisionMedian: null, recallMedian: null,
          precisionRuns: [], recallRuns: [],
        });
      } else {
        // 若前面 SC-001 已收集 codeSkeletons，直接复用；否则重新收集
        if (codeSkeletons.size === 0) {
          codeSkeletons = await collectTsJsCodeSkeletons(targetRoot, { extractCallSites: true });
        }
        const precResult = await measurePrecisionRecall(targetRoot, {
          buildUnifiedGraph,
          accuracyScript,
          repeats,
          tmpDir,
          codeSkeletons,
        });
        graphPath = precResult._graphPath;
        graphJson = precResult._graphJson;
        Object.assign(result, {
          precisionMedian: precResult.precisionMedian,
          recallMedian: precResult.recallMedian,
          precisionRuns: precResult.precisionRuns,
          recallRuns: precResult.recallRuns,
        });
      }
    }

    // ─ SC-003 Python 解析正确率 ────────────────────────────
    if (metric === 'all' || metric === 'python-resolution') {
      console.error(`\n=== SC-003 Python 解析正确率 ===`);
      const pyResult = await measurePythonResolution(targetRoot, { collectPythonCodeSkeletons });
      Object.assign(result, {
        pythonResolutionRate: pyResult.pythonResolutionRate,
        pythonResolutionEligible: pyResult.pythonResolutionEligible,
        pythonResolutionHits: pyResult.pythonResolutionHits,
      });
    }

    // ─ SC-006 性能 ─────────────────────────────────────────
    if (metric === 'all' || metric === 'perf') {
      console.error(`\n=== SC-006 性能 delta ===`);
      if (!hasTsFiles) {
        Object.assign(result, {
          perf: {
            nodeVersion: process.version,
            platform: process.platform,
            cpuCount: os.cpus().length,
            baselineMs: null,
            enableMs: null,
            deltaMs: null,
          },
        });
      } else {
        const perfResult = await measurePerf(targetRoot, { collectTsJsCodeSkeletons });
        Object.assign(result, perfResult);
      }
    }

    // ─ SC-008 new Foo() → class Foo 连通率 ─────────────────
    if (metric === 'all' || metric === 'sc008') {
      console.error(`\n=== SC-008 new Foo() → class Foo 连通率 ===`);
      if (!hasTsFiles) {
        Object.assign(result, { sc008Rate: null, sc008Hits: 0, sc008Total: 0 });
      } else {
        // 需要 codeSkeletons 和 graphJson
        if (codeSkeletons.size === 0) {
          codeSkeletons = await collectTsJsCodeSkeletons(targetRoot, { extractCallSites: true });
        }
        // 如果 SC-002 没跑（metric=sc008 单独跑），需要构建 graph
        if (!graphPath || !graphJson) {
          const ug = buildUnifiedGraph({ projectRoot: targetRoot, codeSkeletons });
          graphJson = wrapGraphJson(ug, `feature-152-sc008-${path.basename(targetRoot)}`);
          graphPath = writeGraphJson(graphJson, tmpDir);
        }
        const sc008Result = await measureSc008(targetRoot, {
          accuracyScript,
          codeSkeletons,
          graphPath,
          graphJson,
        });
        Object.assign(result, {
          sc008Rate: sc008Result.sc008Rate,
          sc008Hits: sc008Result.sc008Hits,
          sc008Total: sc008Result.sc008Total,
        });
      }
    }

    return result;
  } finally {
    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.targets.length === 0) {
    console.error('错误: 必须指定至少一个 --target <path>');
    console.error('运行 node scripts/verify-feature-152.mjs --help 查看帮助');
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, '..');

  // 验证 dist/ 产物存在
  const distBatchPath = path.join(projectRoot, 'dist', 'batch', 'batch-orchestrator.js');
  const distKgPath = path.join(projectRoot, 'dist', 'knowledge-graph', 'index.js');
  const distBootstrapPath = path.join(projectRoot, 'dist', 'runtime-bootstrap.js');

  for (const distPath of [distBatchPath, distKgPath, distBootstrapPath]) {
    if (!fs.existsSync(distPath)) {
      console.error(`[verify-152] 未找到 dist 产物 ${distPath}；请先运行 npm run build`);
      process.exit(1);
    }
  }

  // 动态 import dist 产物
  const { collectTsJsCodeSkeletons, collectPythonCodeSkeletons } = await import(distBatchPath);
  const { buildUnifiedGraph } = await import(distKgPath);
  const { bootstrapRuntime } = await import(distBootstrapPath);
  bootstrapRuntime();

  const distModules = { collectTsJsCodeSkeletons, collectPythonCodeSkeletons, buildUnifiedGraph };

  // 对每个 target 逐一运行
  const results = [];
  for (const rawTarget of args.targets) {
    const targetRoot = path.resolve(rawTarget);
    if (!fs.existsSync(targetRoot)) {
      console.error(`[verify-152] 目标目录不存在: ${targetRoot}`);
      results.push({ target: targetRoot, error: 'target directory not found' });
      continue;
    }
    try {
      const result = await analyzeTarget(targetRoot, args, distModules);
      results.push(result);
    } catch (err) {
      console.error(`[verify-152] target ${targetRoot} 分析失败: ${err.stack ?? err.message}`);
      results.push({ target: targetRoot, error: err.message });
    }
  }

  // 单 target 时直接输出对象，多 target 时输出数组
  const output = results.length === 1 ? results[0] : results;
  const outputJson = JSON.stringify(output, null, 2);

  if (args.outFile) {
    fs.writeFileSync(args.outFile, outputJson, 'utf-8');
    console.error(`\n[verify-152] 结果写入 ${args.outFile}`);
  }
  // 始终输出到 stdout
  console.log(outputJson);
}

main().catch((err) => {
  console.error(`[verify-152] fatal error: ${err.stack ?? err.message}`);
  process.exit(1);
});
