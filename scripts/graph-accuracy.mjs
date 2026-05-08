#!/usr/bin/env node
/**
 * F147 Sprint 3 Phase B.1 — Graph topology accuracy
 *
 * 兑现 spec §2.1.B 第 3 维度承诺："边对应真实 import/call 的命中率"。
 *
 * 用法：
 *   node scripts/graph-accuracy.mjs --source <python-source-root> --graph <graph.json> [--write-fixture <fixture-path>]
 *
 * 输出 schema（写入 fixture quality.graphAccuracy）：
 *   {
 *     language: 'python',
 *     truthSet: { imports: 3, callTargets: 25 },
 *     graph: { totalEdges: 56, callEdges: 21, containmentEdges: 31, otherEdges: 4 },
 *     callPrecision: 0.85,    // graph 中 call edge 命中真实 call 的 %
 *     callRecall: 0.80,       // 真实 call 中 graph 覆盖的 %
 *     coverageMethod: 'label-only',
 *     notes: '...'
 *   }
 *
 * Limitations:
 * - label-only 匹配（不验证 caller 上下文）
 * - Python only（self-dogfood TS 暂 N/A）
 * - 不区分 method 与 function
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const CALL_RELATIONS = new Set(['calls', 'uses', 'invoke', 'call']);
const CONTAIN_RELATIONS = new Set(['contains', 'method', 'has', 'defines']);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source') out.source = argv[++i];
    else if (k === '--graph') out.graph = argv[++i];
    else if (k === '--write-fixture') out.writeFixture = argv[++i];
    else if (k === '--language') out.language = argv[++i];
    else if (k === '--baseline-repo') out.baselineRepo = argv[++i];
    else if (k === '--baseline-commit') out.baselineCommit = argv[++i];
    else if (k === '--baseline-scope') out.baselineScope = argv[++i];
    // Codex Round 1 CRITICAL fix: 支持透传 ignoreDirs 给 Go extractor (FR-016 GORM 顶层包)
    // 用法：--ignore-dirs schema,callbacks,clause,migrator,logger,internal,utils,tests
    // Codex Round 2 WARNING #1 fix: 检查 next arg 存在且不是另一个 flag，避免 swallow 后续 --quiet
    else if (k === '--ignore-dirs') {
      const nextArg = argv[i + 1];
      if (nextArg === undefined || nextArg.startsWith('--')) {
        throw new Error(`[graph-accuracy] --ignore-dirs requires a comma-separated value (e.g. --ignore-dirs schema,callbacks)`);
      }
      i++;
      out.ignoreDirs = nextArg.split(',').map((s) => s.trim()).filter(Boolean);
    }
    else if (k === '--quiet') out.quiet = true;
    // Feature 151 SC-001 fill-rate metric — 计算 graph.json 中含 callSites 的 .py 文件占
    // python-call-extractor.py 输出的 filesWithCalls 的比例
    else if (k === '--metric') out.metric = argv[++i];
  }
  return out;
}

/**
 * Feature 151 SC-001 — 计算 callSites 字段填充率
 *
 * @param {{ nodes: Array<{metadata?: { callSitesCount?: number, codeSkeleton?: { callSites?: unknown[] } }, language?: string, filePath?: string, kind?: string }> }} graph
 * @param {{ filesWithCalls?: number, fileCount: number }} truthSet  来自 python-call-extractor.py 的输出
 * @returns {{ callsiteFillRate: number, filesWithCallSites: number, denominator: number }}
 */
export function computeFillRate(graph, truthSet) {
  // 分子：graph.json 中 metadata.callSitesCount > 0 的 module 节点（Codex C-4：T-012a 写入此字段）
  // 兼容路径：node.metadata.codeSkeleton.callSites?.length > 0
  const filesWithCallSites = new Set();
  for (const node of graph.nodes) {
    if (node.kind && node.kind !== 'module') continue;
    const filePath = node.filePath ?? node.id;
    const explicitCount = node.metadata?.callSitesCount;
    if (typeof explicitCount === 'number' && explicitCount > 0) {
      filesWithCallSites.add(filePath);
      continue;
    }
    const cs = node.metadata?.codeSkeleton?.callSites;
    if (Array.isArray(cs) && cs.length > 0) {
      filesWithCallSites.add(filePath);
    }
  }

  // 分母：truth set 的 filesWithCalls；老 fixture 没有此字段时回退到 fileCount（更宽松，低估填充率）
  const denominator = truthSet.filesWithCalls ?? truthSet.fileCount;
  const callsiteFillRate = denominator > 0 ? filesWithCallSites.size / denominator : 0;
  return {
    callsiteFillRate,
    filesWithCallSites: filesWithCallSites.size,
    denominator,
  };
}

function extractTruthSetPython(sourceRoot) {
  const py = path.join(__dirname, 'lib', 'python-call-extractor.py');
  if (!fs.existsSync(py)) {
    throw new Error(`python-call-extractor.py not found at ${py}`);
  }
  const stdout = execFileSync('python3', [py, sourceRoot], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function loadGraph(graphPath) {
  const raw = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  // graphify / spectra 都用 NetworkX node-link 格式：nodes + links
  const nodes = raw.nodes ?? [];
  const links = raw.links ?? raw.edges ?? [];
  return { nodes, links };
}

function buildNodeLabelIndex(nodes) {
  // map: node id → 优先 label，否则 name 字段
  const index = new Map();
  for (const n of nodes) {
    const id = n.id ?? n._id ?? null;
    if (!id) continue;
    const label = n.label ?? n.name ?? id;
    index.set(id, label);
  }
  return index;
}

function classifyEdges(links) {
  const callEdges = [];
  const containmentEdges = [];
  const otherEdges = [];
  for (const l of links) {
    const rel = (l.relation ?? l.type ?? l.kind ?? '').toLowerCase();
    if (CALL_RELATIONS.has(rel)) callEdges.push(l);
    else if (CONTAIN_RELATIONS.has(rel)) containmentEdges.push(l);
    else otherEdges.push(l);
  }
  return { callEdges, containmentEdges, otherEdges };
}

function normalizeName(s) {
  // 去掉路径前缀 / 文件后缀，只保留 symbol 名
  // graphify 节点 label 形如 "test_sanity_check()" / "Value" / "engine.py" / ".tanh"
  if (!s) return null;
  let n = String(s).trim();
  // 去 () 调用括号
  n = n.replace(/\(\)$/, '');
  // 去掉 attribute access 的前导点 .tanh → tanh
  n = n.replace(/^\./, '');
  // 如果含 :: 或 / 取最后一段
  if (n.includes('::')) n = n.split('::').pop();
  if (n.includes('/')) n = n.split('/').pop();
  // 如果含 # (e.g. "engine.py#Value") 取后段
  if (n.includes('#')) n = n.split('#').pop();
  // 去掉 .py / .ts 后缀
  n = n.replace(/\.(py|ts|tsx|js|jsx)$/, '');
  return n;
}

function computeCallAccuracy(callEdges, nodeLabelIdx, truthCallTargets) {
  // 提取每条 call edge 的 target label
  const graphCallees = new Set();
  for (const e of callEdges) {
    const tgtId = e.target ?? e._tgt ?? null;
    if (!tgtId) continue;
    const lbl = nodeLabelIdx.get(tgtId) ?? tgtId;
    const norm = normalizeName(lbl);
    if (norm) graphCallees.add(norm);
  }
  const truthSet = new Set([...truthCallTargets].map(normalizeName).filter(Boolean));

  // Precision: graph 命中真实的占比
  const hits = [...graphCallees].filter((c) => truthSet.has(c));
  const precision = graphCallees.size === 0 ? null : hits.length / graphCallees.size;
  // Recall: 真实被 graph 覆盖的占比
  const covered = [...truthSet].filter((c) => graphCallees.has(c));
  const recall = truthSet.size === 0 ? null : covered.length / truthSet.size;

  return {
    graphCalleeCount: graphCallees.size,
    truthCalleeCount: truthSet.size,
    hits: hits.length,
    callPrecision: precision == null ? null : Math.round(precision * 1000) / 1000,
    callRecall: recall == null ? null : Math.round(recall * 1000) / 1000,
    sampleHits: hits.slice(0, 10),
    sampleMissed: [...truthSet].filter((c) => !graphCallees.has(c)).slice(0, 10),
    sampleFalsePositives: [...graphCallees].filter((c) => !truthSet.has(c)).slice(0, 10),
  };
}

/** Feature 150：受支持的 language 全集 */
export const SUPPORTED_LANGUAGES = Object.freeze(['python', 'ts', 'go', 'java']);

/**
 * 主入口：根据 language 分派到 python anchor 或 ts/go/java extractor。
 *
 * - language='python'（缺省）→ 走现有 python-call-extractor.py 路径，输出 byte-stable
 * - language='ts'|'go'|'java' → 分派到对应 extractor（当前抛 not yet implemented）
 * - language ∉ SUPPORTED_LANGUAGES → 抛 "Unsupported language" 错误
 *
 * 注：Python 路径完全保留原始逻辑，不引入任何 schema 漂移（FR-002 / FR-021 / SC-005）。
 *
 * @param {{sourceRoot: string, graphPath: string, language?: string}} args
 */
export function analyzeGraphAccuracy({ sourceRoot, graphPath, language = 'python' }) {
  // 未知 language → 直接抛错（FR-004）
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new Error(
      `[graph-accuracy] Unsupported language: "${language}". ` +
        `Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }

  // ts / go / java：分派到对应 extractor。ts (Phase 4D) / java (Phase 4B) / go (Phase 4C)
  // 都已实现，但因 extractor 是 async（web-tree-sitter Parser.init/Language.load 是 async），
  // 保留本 sync API 仅支持 python；ts/go/java 用户应通过 CLI（main async）或调用
  // extractTruthSetTs / analyzeGraphAccuracyGo / analyzeGraphAccuracyJava 等 async 包装。
  if (language !== 'python') {
    throw new Error(
      `[graph-accuracy] language="${language}" extractor not yet implemented in this phase ` +
        `(Phase 4 阶段 A 仅搭 dispatch，extractor 在 Phase 4B/C/D 实现)`,
    );
  }

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`source root does not exist: ${sourceRoot}`);
  }
  if (!fs.existsSync(graphPath)) {
    throw new Error(`graph not found: ${graphPath}`);
  }

  const truth = extractTruthSetPython(sourceRoot);
  const graph = loadGraph(graphPath);
  const nodeLabelIdx = buildNodeLabelIndex(graph.nodes);
  const classified = classifyEdges(graph.links);

  const truthCalleeNames = new Set(truth.calls.map((c) => c.split('::').pop()));
  const accuracy = computeCallAccuracy(classified.callEdges, nodeLabelIdx, truthCalleeNames);

  return {
    language,
    coverageMethod: 'label-only',
    truthSet: {
      filesAnalyzed: truth.fileCount,
      imports: truth.imports.length,
      callsTotal: truth.calls.length,
      uniqueCallTargets: truth.uniqueCallTargets,
    },
    graph: {
      totalEdges: graph.links.length,
      callEdges: classified.callEdges.length,
      containmentEdges: classified.containmentEdges.length,
      otherEdges: classified.otherEdges.length,
    },
    accuracy,
    notes: [
      'label-only matching: 比较 graph callee label 与源码 callee 名是否相同',
      'precision: graph 中 call-类边命中真实 call 的占比',
      'recall: 真实 call 中被 graph 覆盖的占比',
      classified.callEdges.length === 0 ? '⚠️ 该 graph 不含 call/uses 类型边（可能是 contains-only graph，如 spectra v4.x）' : null,
    ].filter(Boolean),
  };
}

/**
 * Feature 150 Phase 4D — TS extractor async 包装。
 *
 * 当 --language ts 时调用此函数，返回 graph-accuracy 风格的 result 对象（含 truthSet /
 * graph / accuracy 字段，与 python sync 路径 schema 对齐）。
 *
 * 当 graphPath 缺省（仅 truth set 生成模式，--write-fixture 用），返回精简形态：
 *   {language: 'ts', truthSet: {...}, baseline?, generatedAt, extractorVersion}
 *
 * @param {{sourceRoot: string, graphPath?: string, baseline?: object}} args
 */
export async function analyzeGraphAccuracyTs({ sourceRoot, graphPath, baseline }) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`source root does not exist: ${sourceRoot}`);
  }
  // 动态 import 避免 sync 路径加载 web-tree-sitter（Parser.init 有 IO 副作用）
  const { extractTsCallSites } = await import('./lib/ts-call-extractor.mjs');

  const extracted = await extractTsCallSites({
    sourceRoot,
    ...(baseline ? { baseline } : {}),
  });

  // 仅 truth set 生成模式：无需 graph 比对
  if (!graphPath) {
    return {
      language: 'ts',
      ...(extracted.baseline ? { baseline: extracted.baseline } : {}),
      truthSet: {
        callsTotal: extracted.truthCalls.length,
        uniqueCallTargets: new Set(extracted.truthCalls.map((c) => c.callee)).size,
        warningsCount: extracted.warnings.length,
      },
      truthCalls: extracted.truthCalls,
      warnings: extracted.warnings,
    };
  }

  // 完整 graph 比对模式（与 python 路径 schema 对齐）
  if (!fs.existsSync(graphPath)) {
    throw new Error(`graph not found: ${graphPath}`);
  }
  const graph = loadGraph(graphPath);
  const nodeLabelIdx = buildNodeLabelIndex(graph.nodes);
  const classified = classifyEdges(graph.links);

  const truthCalleeNames = new Set(extracted.truthCalls.map((c) => c.callee));
  const accuracy = computeCallAccuracy(classified.callEdges, nodeLabelIdx, truthCalleeNames);

  return {
    language: 'ts',
    coverageMethod: 'label-only',
    ...(extracted.baseline ? { baseline: extracted.baseline } : {}),
    truthSet: {
      callsTotal: extracted.truthCalls.length,
      uniqueCallTargets: truthCalleeNames.size,
      warningsCount: extracted.warnings.length,
    },
    graph: {
      totalEdges: graph.links.length,
      callEdges: classified.callEdges.length,
      containmentEdges: classified.containmentEdges.length,
      otherEdges: classified.otherEdges.length,
    },
    accuracy,
    notes: [
      'label-only matching: 比较 graph callee label 与源码 callee 名是否相同',
      classified.callEdges.length === 0
        ? '⚠️ 该 graph 不含 call/uses 类型边'
        : null,
    ].filter(Boolean),
  };
}

/**
 * Feature 150 Phase 4B — Java extractor async 包装。
 *
 * 当 --language java 时调用此函数，返回 graph-accuracy 风格的 result 对象（含 truthSet /
 * graph / accuracy 字段，与 python sync 路径 schema 对齐）。
 *
 * 当 graphPath 缺省（仅 truth set 生成模式，--write-fixture 用），返回精简形态：
 *   {language: 'java', truthSet: {...}, baseline?, generatedAt, extractorVersion}
 *
 * @param {{sourceRoot: string, graphPath?: string, baseline?: object}} args
 */
export async function analyzeGraphAccuracyJava({ sourceRoot, graphPath, baseline }) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`source root does not exist: ${sourceRoot}`);
  }
  // 动态 import 避免 sync 路径加载 web-tree-sitter（Parser.init 有 IO 副作用）
  const { extractJavaCallSites } = await import('./lib/java-call-extractor.mjs');

  const extracted = await extractJavaCallSites({
    sourceRoot,
    ...(baseline ? { baseline } : {}),
  });

  // 仅 truth set 生成模式：无需 graph 比对
  if (!graphPath) {
    return {
      language: 'java',
      ...(extracted.baseline ? { baseline: extracted.baseline } : {}),
      truthSet: {
        callsTotal: extracted.truthCalls.length,
        uniqueCallTargets: new Set(extracted.truthCalls.map((c) => c.callee)).size,
        warningsCount: extracted.warnings.length,
      },
      truthCalls: extracted.truthCalls,
      warnings: extracted.warnings,
    };
  }

  // 完整 graph 比对模式（与 python 路径 schema 对齐）
  if (!fs.existsSync(graphPath)) {
    throw new Error(`graph not found: ${graphPath}`);
  }
  const graph = loadGraph(graphPath);
  const nodeLabelIdx = buildNodeLabelIndex(graph.nodes);
  const classified = classifyEdges(graph.links);

  const truthCalleeNames = new Set(extracted.truthCalls.map((c) => c.callee));
  const accuracy = computeCallAccuracy(classified.callEdges, nodeLabelIdx, truthCalleeNames);

  return {
    language: 'java',
    coverageMethod: 'label-only',
    ...(extracted.baseline ? { baseline: extracted.baseline } : {}),
    truthSet: {
      callsTotal: extracted.truthCalls.length,
      uniqueCallTargets: truthCalleeNames.size,
      warningsCount: extracted.warnings.length,
    },
    graph: {
      totalEdges: graph.links.length,
      callEdges: classified.callEdges.length,
      containmentEdges: classified.containmentEdges.length,
      otherEdges: classified.otherEdges.length,
    },
    accuracy,
    notes: [
      'label-only matching: 比较 graph callee label 与源码 callee 名是否相同',
      classified.callEdges.length === 0
        ? '⚠️ 该 graph 不含 call/uses 类型边'
        : null,
    ].filter(Boolean),
  };
}

/**
 * Feature 150 Phase 4C — Go extractor async 包装。
 *
 * 当 --language go 时调用此函数，返回 graph-accuracy 风格的 result 对象（含 truthSet /
 * graph / accuracy 字段，与 python sync 路径 schema 对齐）。
 *
 * 当 graphPath 缺省（仅 truth set 生成模式，--write-fixture 用），返回精简形态：
 *   {language: 'go', truthSet: {...}, baseline?, generatedAt, extractorVersion}
 *
 * Codex Round 1 CRITICAL fix：透传 `ignoreDirs` 选项到 extractor，让 CLI 路径
 * （`--language go --ignore-dirs callbacks,schema,...`）能实现 GORM 顶层包 only scope（FR-016）。
 *
 * @param {{sourceRoot: string, graphPath?: string, baseline?: object, ignoreDirs?: readonly string[]}} args
 */
export async function analyzeGraphAccuracyGo({ sourceRoot, graphPath, baseline, ignoreDirs }) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`source root does not exist: ${sourceRoot}`);
  }
  // 动态 import 避免 sync 路径加载 web-tree-sitter（Parser.init 有 IO 副作用）
  const { extractGoCallSites } = await import('./lib/go-call-extractor.mjs');

  const extracted = await extractGoCallSites({
    sourceRoot,
    ...(baseline ? { baseline } : {}),
    ...(ignoreDirs ? { ignoreDirs } : {}),
  });

  // 仅 truth set 生成模式：无需 graph 比对
  if (!graphPath) {
    return {
      language: 'go',
      ...(extracted.baseline ? { baseline: extracted.baseline } : {}),
      truthSet: {
        callsTotal: extracted.truthCalls.length,
        uniqueCallTargets: new Set(extracted.truthCalls.map((c) => c.callee)).size,
        warningsCount: extracted.warnings.length,
      },
      truthCalls: extracted.truthCalls,
      warnings: extracted.warnings,
    };
  }

  // 完整 graph 比对模式（与 python 路径 schema 对齐）
  if (!fs.existsSync(graphPath)) {
    throw new Error(`graph not found: ${graphPath}`);
  }
  const graph = loadGraph(graphPath);
  const nodeLabelIdx = buildNodeLabelIndex(graph.nodes);
  const classified = classifyEdges(graph.links);

  const truthCalleeNames = new Set(extracted.truthCalls.map((c) => c.callee));
  const accuracy = computeCallAccuracy(classified.callEdges, nodeLabelIdx, truthCalleeNames);

  return {
    language: 'go',
    coverageMethod: 'label-only',
    ...(extracted.baseline ? { baseline: extracted.baseline } : {}),
    truthSet: {
      callsTotal: extracted.truthCalls.length,
      uniqueCallTargets: truthCalleeNames.size,
      warningsCount: extracted.warnings.length,
    },
    graph: {
      totalEdges: graph.links.length,
      callEdges: classified.callEdges.length,
      containmentEdges: classified.containmentEdges.length,
      otherEdges: classified.otherEdges.length,
    },
    accuracy,
    notes: [
      'label-only matching: 比较 graph callee label 与源码 callee 名是否相同',
      classified.callEdges.length === 0
        ? '⚠️ 该 graph 不含 call/uses 类型边'
        : null,
    ].filter(Boolean),
  };
}

function writeFixtureQualityField(fixturePath, accuracy) {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`fixture not found: ${fixturePath}`);
  }
  const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  fx.quality = fx.quality ?? {};
  fx.quality.graphAccuracy = accuracy;
  fs.writeFileSync(fixturePath, JSON.stringify(fx, null, 2) + '\n', 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv);
  const language = args.language ?? 'python';

  if (!args.source) {
    console.error(
      'usage: node scripts/graph-accuracy.mjs --source <root> [--graph <graph.json>] [--write-fixture <path>] [--language python|ts|go|java]',
    );
    process.exit(1);
  }
  // python 路径需要 --graph；ts truth-set-only 模式可省略 --graph，仅写 fixture
  if (language === 'python' && !args.graph) {
    console.error('[graph-accuracy] --graph is required for --language python');
    process.exit(1);
  }

  let result;
  if (language === 'ts') {
    // 构造 baseline metadata（FR-014）。三字段中只要 scope 必填，其它可缺省
    const baseline = args.baselineScope
      ? {
          ...(args.baselineRepo ? { repo: args.baselineRepo } : {}),
          ...(args.baselineCommit ? { commit: args.baselineCommit } : {}),
          scope: args.baselineScope,
        }
      : undefined;
    result = await analyzeGraphAccuracyTs({
      sourceRoot: args.source,
      graphPath: args.graph,
      ...(baseline ? { baseline } : {}),
    });
  } else if (language === 'java') {
    // Phase 4B Java extractor async 包装（同 ts 路径）
    const baseline = args.baselineScope
      ? {
          ...(args.baselineRepo ? { repo: args.baselineRepo } : {}),
          ...(args.baselineCommit ? { commit: args.baselineCommit } : {}),
          scope: args.baselineScope,
        }
      : undefined;
    result = await analyzeGraphAccuracyJava({
      sourceRoot: args.source,
      graphPath: args.graph,
      ...(baseline ? { baseline } : {}),
    });
  } else if (language === 'go') {
    // Phase 4C Go extractor async 包装（同 ts/java 路径）
    const baseline = args.baselineScope
      ? {
          ...(args.baselineRepo ? { repo: args.baselineRepo } : {}),
          ...(args.baselineCommit ? { commit: args.baselineCommit } : {}),
          scope: args.baselineScope,
        }
      : undefined;
    result = await analyzeGraphAccuracyGo({
      sourceRoot: args.source,
      graphPath: args.graph,
      ...(baseline ? { baseline } : {}),
      // Codex Round 1 CRITICAL: 透传 --ignore-dirs (GORM 顶层包 scope, FR-016)
      ...(args.ignoreDirs ? { ignoreDirs: args.ignoreDirs } : {}),
    });
  } else {
    result = analyzeGraphAccuracy({
      sourceRoot: args.source,
      graphPath: args.graph,
      language,
    });
  }

  // Feature 151 SC-001 — fill-rate 度量。仅 python 路径，且 --metric=fill-rate 时输出
  if (args.metric === 'fill-rate') {
    if (language !== 'python') {
      console.error('[graph-accuracy] --metric fill-rate currently supports --language python only');
      process.exit(1);
    }
    const truth = extractTruthSetPython(args.source);
    const graph = loadGraph(args.graph);
    const fill = computeFillRate(graph, truth);
    if (!args.quiet) {
      console.log(JSON.stringify({ ...result, fillRate: fill }, null, 2));
    }
    if (args.writeFixture) {
      writeFixtureQualityField(args.writeFixture, { ...result, fillRate: fill });
    }
    return;
  }

  if (!args.quiet) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (args.writeFixture) {
    // ts / java truth-set-only 模式：把整个 truth set + metadata 直接写到 fixture
    // （不嵌入 quality.graphAccuracy）
    const isAsyncTruthSetOnly =
      (language === 'ts' || language === 'java' || language === 'go') && !args.graph;
    if (isAsyncTruthSetOnly) {
      const writePayload = {
        language: result.language,
        ...(result.baseline ? { baseline: result.baseline } : {}),
        truthCalls: result.truthCalls,
        warnings: result.warnings,
      };
      const dir = path.dirname(args.writeFixture);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        args.writeFixture,
        JSON.stringify(writePayload, null, 2) + '\n',
        'utf-8',
      );
      console.error(
        `[graph-accuracy] wrote ${language} truth set → ${args.writeFixture} (${result.truthCalls.length} calls)`,
      );
    } else {
      writeFixtureQualityField(args.writeFixture, result);
      console.error(`[graph-accuracy] wrote quality.graphAccuracy → ${args.writeFixture}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[graph-accuracy] error: ${e.message}`);
    process.exit(1);
  });
}
