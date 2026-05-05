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
    else if (k === '--quiet') out.quiet = true;
  }
  return out;
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

  // ts / go / java：分派到对应 extractor（当前阶段抛 not yet implemented）
  if (language !== 'python') {
    // 同步函数返回 promise 在调用方需要 await，但本 export 历史上是同步函数
    // 为保留同步签名，这里 throw（非 reject），调用方 sync catch 即可
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
  if (!args.source || !args.graph) {
    console.error('usage: node scripts/graph-accuracy.mjs --source <python-root> --graph <graph.json> [--write-fixture <path>] [--language python]');
    process.exit(1);
  }
  const result = analyzeGraphAccuracy({
    sourceRoot: args.source,
    graphPath: args.graph,
    language: args.language ?? 'python',
  });
  if (!args.quiet) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (args.writeFixture) {
    writeFixtureQualityField(args.writeFixture, result);
    console.error(`[graph-accuracy] wrote quality.graphAccuracy → ${args.writeFixture}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[graph-accuracy] error: ${e.message}`);
    process.exit(1);
  });
}
