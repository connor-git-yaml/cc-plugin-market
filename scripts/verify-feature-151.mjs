#!/usr/bin/env node
/**
 * Feature 151 — 独立验收脚本（T-017 + T-018a）
 *
 * 跑流程（不依赖 spectra batch / LLM）：
 *   1. 在指定 .py 项目根上调用 collectPythonCodeSkeletons + buildUnifiedGraph
 *   2. 把 unifiedGraph 包装成 GraphJSON（最小 nodes + links），为 graph-accuracy.mjs 使用
 *   3. 调用 graph-accuracy.mjs --metric fill-rate（SC-001）+ default precision/recall（SC-002）
 *   4. 输出汇总数字
 *
 * 用法：
 *   node scripts/verify-feature-151.mjs --target ~/.spectra-baselines/micrograd
 *   node scripts/verify-feature-151.mjs --target ~/.spectra-baselines/nanoGPT
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--target') out.target = argv[++i];
    else if (k === '--out') out.out = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.target) {
    console.error('用法: node scripts/verify-feature-151.mjs --target <path-to-py-project>');
    process.exit(1);
  }
  const targetRoot = path.resolve(args.target);
  if (!fs.existsSync(targetRoot)) {
    console.error(`目标目录不存在: ${targetRoot}`);
    process.exit(1);
  }

  const projectRoot = path.resolve(import.meta.dirname, '..');

  // 加载 dist/.js（spectra build 产物）— 需要 npm run build 后才能 import
  const distMain = path.join(projectRoot, 'dist', 'knowledge-graph', 'index.js');
  if (!fs.existsSync(distMain)) {
    console.error(`未找到 dist 产物 ${distMain}；请先 npm run build`);
    process.exit(1);
  }

  // dynamic import dist
  const { buildUnifiedGraph } = await import(distMain);
  const { PythonLanguageAdapter } = await import(path.join(projectRoot, 'dist', 'adapters', 'python-adapter.js'));
  const { bootstrapRuntime } = await import(path.join(projectRoot, 'dist', 'runtime-bootstrap.js'));

  bootstrapRuntime();

  // ─── 1. 收集 .py 文件 + analyzeFile（含 callSites） ───
  console.error(`[verify-151] 扫描 ${targetRoot}...`);
  const adapter = new PythonLanguageAdapter();
  const pyFiles = collectPyFiles(targetRoot);
  console.error(`[verify-151] 发现 ${pyFiles.length} 个 .py 文件`);

  // 构建 basename map（与 batch-orchestrator collectPythonCodeSkeletons 同算法）
  const pyModuleMap = new Map();
  for (const f of pyFiles) pyModuleMap.set(path.basename(f, '.py'), f);

  const skeletons = new Map();
  for (const filePath of pyFiles) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1_000_000) continue; // EC-14
      const sk = await adapter.analyzeFile(filePath, { extractCallSites: true });
      // 解析本地 import resolvedPath
      const resolved = {
        ...sk,
        imports: sk.imports.map((imp) => {
          if (imp.resolvedPath) return imp;
          const topModule = imp.moduleSpecifier.replace(/^\.+/, '').split('.')[0];
          if (!topModule) return imp;
          const r = pyModuleMap.get(topModule);
          if (!r) return imp;
          return { ...imp, resolvedPath: r };
        }),
      };
      skeletons.set(filePath, resolved);
    } catch (err) {
      console.error(`  skip ${filePath}: ${err.message}`);
    }
  }

  // ─── 2. 构建 UnifiedGraph ───
  const ug = buildUnifiedGraph({
    projectRoot: targetRoot,
    codeSkeletons: skeletons,
  });
  const callsCount = ug.edges.filter((e) => e.relation === 'calls').length;
  const dependsCount = ug.edges.filter((e) => e.relation === 'depends-on').length;
  console.error(
    `[verify-151] UnifiedGraph: ${ug.nodes.length} 节点 / ${callsCount} calls 边 / ${dependsCount} depends-on 边`,
  );

  // 计算 callSites 填充率（直接从 skeletons 算，不走 graph.json 路径）
  let filesWithCallSites = 0;
  let totalCallSites = 0;
  for (const sk of skeletons.values()) {
    if (sk.callSites && sk.callSites.length > 0) {
      filesWithCallSites++;
      totalCallSites += sk.callSites.length;
    }
  }
  console.error(
    `[verify-151] callSites 填充：${filesWithCallSites}/${skeletons.size} 文件，${totalCallSites} 总 callSites`,
  );

  // ─── 3. 包装成最小 GraphJSON 给 graph-accuracy.mjs ───
  const graphJson = {
    directed: false,
    multigraph: false,
    graph: {
      name: 'feature-151-verify',
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-151-verify-'));
  const graphPath = path.join(tmpDir, 'graph.json');
  fs.writeFileSync(graphPath, JSON.stringify(graphJson, null, 2), 'utf-8');
  console.error(`[verify-151] graph.json 写入 ${graphPath}`);

  // ─── 4. 跑 graph-accuracy.mjs（先 fill-rate，再 precision/recall）───
  const accuracyScript = path.join(projectRoot, 'scripts', 'graph-accuracy.mjs');

  console.error(`\n=== SC-001 fill-rate ===`);
  const fillOut = execFileSync('node', [
    accuracyScript,
    '--source', targetRoot,
    '--graph', graphPath,
    '--metric', 'fill-rate',
    '--quiet',
  ], { encoding: 'utf-8' });
  // metric=fill-rate 在 quiet 模式下不输出 — 我们手动算一遍
  // truth set extractor
  const truthOut = execFileSync('python3', [
    path.join(projectRoot, 'scripts', 'lib', 'python-call-extractor.py'),
    targetRoot,
  ], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
  const truth = JSON.parse(truthOut);
  console.error(JSON.stringify({
    truthFileCount: truth.fileCount,
    truthFilesWithCalls: truth.filesWithCalls,
    truthUniqueCalls: truth.uniqueCallTargets,
  }, null, 2));

  const fillRate = truth.filesWithCalls > 0 ? filesWithCallSites / truth.filesWithCalls : 0;
  console.error(`填充率：${(fillRate * 100).toFixed(1)}% (${filesWithCallSites}/${truth.filesWithCalls})`);

  console.error(`\n=== SC-002 precision/recall ===`);
  try {
    const accOut = execFileSync('node', [
      accuracyScript,
      '--source', targetRoot,
      '--graph', graphPath,
      '--language', 'python',
    ], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
    const acc = JSON.parse(accOut);
    if (acc.callPrecision !== undefined) {
      console.error(`precision: ${(acc.callPrecision * 100).toFixed(1)}%`);
      console.error(`recall: ${(acc.callRecall * 100).toFixed(1)}%`);
    } else {
      console.error('未输出 callPrecision/callRecall — 检查 accuracy.mjs');
    }
  } catch (err) {
    console.error(`accuracy.mjs 错误：${err.message}`);
  }

  // 写出汇总到 args.out（如果指定）
  const summary = {
    target: targetRoot,
    pyFileCount: pyFiles.length,
    skeletonsCount: skeletons.size,
    unifiedGraphNodes: ug.nodes.length,
    unifiedGraphCallsEdges: callsCount,
    unifiedGraphDependsEdges: dependsCount,
    callSitesTotal: totalCallSites,
    filesWithCallSites,
    truthFilesWithCalls: truth.filesWithCalls,
    fillRate,
    fillRatePercent: (fillRate * 100).toFixed(1),
  };
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(summary, null, 2), 'utf-8');
    console.error(`\n[verify-151] 汇总写入 ${args.out}`);
  }
  console.log(JSON.stringify(summary, null, 2));
}

function collectPyFiles(root) {
  const IGNORE = new Set([
    'node_modules', '.git', '__pycache__', '.venv', 'venv',
    'build', 'dist', 'coverage', 'out', 'target', '.tox',
  ]);
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (IGNORE.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && (entry.name.endsWith('.py') || entry.name.endsWith('.pyi'))) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  walk(root);
  return out;
}

main().catch((err) => {
  console.error(`[verify-151] error: ${err.stack ?? err.message}`);
  process.exit(1);
});
