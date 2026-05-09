#!/usr/bin/env node
/**
 * Feature 156 W4 — 端到端验证脚本（plan §5.2 / §8.2）
 *
 * 验证 AC-3a / AC-3b：full vs incremental snapshot 的三类边一致性。
 *
 * 算法：
 *   1. 跑一次 full → snapshot A（baseline）
 *   2. 改一个 fixture .ts/.py 文件
 *   3. 再跑一次 full → snapshot B（baseline，作为 truth-set）
 *   4. 把 .spectra/unified-graph.json 还原为 snapshot A，
 *      跑 spectra index --incremental（强制走 changedFilesOverride 路径）→ snapshot C
 *   5. canonical sort 后 diff B.edges (filter 三类) === C.edges (filter 三类)
 *
 * 退出码：
 *   - 0：全部 pass
 *   - 1：任意失败（输出 JSON 报告到 stdout）
 *
 * 用法：
 *   node scripts/verify-feature-156.mjs --project-root <dir>
 *   node scripts/verify-feature-156.mjs --project-root <dir> --timeout 60000
 *
 * 参数：
 *   --project-root <dir>  必填；项目根目录（含可索引源文件）
 *   --timeout <ms>        可选；incremental 单次耗时上限（macOS M 系列默认 30000，CI 60000）
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// ───────────────────────────────────────────────────────────
// argv 解析
// ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { projectRoot: undefined, timeoutMs: 30000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project-root' && argv[i + 1]) {
      out.projectRoot = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--timeout' && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (!Number.isNaN(n) && n > 0) out.timeoutMs = n;
      i += 1;
    }
  }
  return out;
}

const { projectRoot, timeoutMs } = parseArgs(process.argv.slice(2));

if (!projectRoot) {
  process.stderr.write(
    'Usage: node scripts/verify-feature-156.mjs --project-root <dir> [--timeout 30000]\n',
  );
  process.exit(2);
}

if (!fs.existsSync(projectRoot)) {
  process.stderr.write(`项目目录不存在: ${projectRoot}\n`);
  process.exit(2);
}

// ───────────────────────────────────────────────────────────
// 工具
// ───────────────────────────────────────────────────────────

const RELEVANT_RELATIONS = new Set(['depends-on', 'calls', 'cross-module']);
const SNAPSHOT_REL_PATH = '.spectra/unified-graph.json';

/** 调用 spectra CLI（dist 已构建），同步等待退出 */
function runSpectra(args, opts = {}) {
  // 优先使用本仓库的 dist/cli/index.js（package.json bin 入口）；fallback 到 npx spectra
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.resolve(scriptDir, '..', 'dist', 'cli', 'index.js'),
    path.resolve(scriptDir, '..', 'dist', 'cli', 'spectra-cli.js'),
  ];
  let bin;
  let baseArgs;
  const repoCli = candidates.find((c) => fs.existsSync(c));
  if (repoCli) {
    bin = process.execPath;
    baseArgs = [repoCli, 'index', ...args, '--project-root', projectRoot];
  } else {
    bin = 'npx';
    baseArgs = ['spectra', 'index', ...args, '--project-root', projectRoot];
  }
  const result = spawnSync(bin, baseArgs, {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs ?? 120000,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

/** canonical sort: 三元组（relation/source/target）字典序 */
function canonicalSort(edges) {
  return [...edges].sort((a, b) => {
    const c1 = String(a.relation).localeCompare(String(b.relation));
    if (c1 !== 0) return c1;
    const c2 = String(a.source).localeCompare(String(b.source));
    if (c2 !== 0) return c2;
    return String(a.target).localeCompare(String(b.target));
  });
}

function filterRelevantEdges(edges) {
  return edges.filter((e) => RELEVANT_RELATIONS.has(e.relation));
}

function edgeKey(e) {
  return `${e.relation}::${e.source}::${e.target}`;
}

/** diff edge sets — 输出仅出现在 a 中 / 仅出现在 b 中的 edge keys */
function diffEdges(a, b) {
  const aKeys = new Set(a.map(edgeKey));
  const bKeys = new Set(b.map(edgeKey));
  const onlyInA = [...aKeys].filter((k) => !bKeys.has(k));
  const onlyInB = [...bKeys].filter((k) => !aKeys.has(k));
  return { onlyInA, onlyInB };
}

async function loadSnapshotJson() {
  const p = path.join(projectRoot, SNAPSHOT_REL_PATH);
  const raw = await fsp.readFile(p, 'utf-8');
  return JSON.parse(raw);
}

async function writeSnapshotJson(json) {
  const p = path.join(projectRoot, SNAPSHOT_REL_PATH);
  await fsp.writeFile(p, JSON.stringify(json, null, 2), 'utf-8');
}

/** 找一个可改动的源文件（.ts / .py / .js / .mjs 优先） */
function findMutableFile() {
  const exts = ['.ts', '.py', '.mjs', '.js'];
  const candidates = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (exts.some((x) => e.name.endsWith(x))) candidates.push(full);
      if (candidates.length > 50) return; // cap
    }
  }
  walk(projectRoot);
  return candidates[0] ?? null;
}

// ───────────────────────────────────────────────────────────
// 主流程
// ───────────────────────────────────────────────────────────

const report = {
  projectRoot,
  timeoutMs,
  steps: [],
  pass: false,
};

function step(name, ok, detail) {
  report.steps.push({ name, ok, ...detail });
  process.stdout.write(`${JSON.stringify({ step: name, ok, ...detail })}\n`);
}

try {
  // 1. 全量索引 → snapshot A
  let r = runSpectra([], { timeoutMs: 300000 });
  if (r.status !== 0) {
    step('full-index-A', false, { stderr: r.stderr.slice(0, 500) });
    throw new Error('full index A failed');
  }
  const snapshotA = await loadSnapshotJson();
  step('full-index-A', true, {
    nodes: snapshotA.graph.nodes.length,
    edges: snapshotA.graph.edges.length,
  });

  // 2. 改一个文件（追加无害注释）
  const mutFile = findMutableFile();
  if (!mutFile) {
    step('find-mutable-file', false, {});
    throw new Error('找不到可改动的 .ts / .py / .js / .mjs 文件');
  }
  const origContent = await fsp.readFile(mutFile, 'utf-8');
  const sentinel = `\n// spectra-verify-152 sentinel ${Date.now()}\n`;
  await fsp.writeFile(mutFile, origContent + sentinel, 'utf-8');
  step('mutate-file', true, { file: path.relative(projectRoot, mutFile) });

  try {
    // 3. 全量再跑一次 → snapshot B（truth-set）
    r = runSpectra([], { timeoutMs: 300000 });
    if (r.status !== 0) {
      step('full-index-B', false, { stderr: r.stderr.slice(0, 500) });
      throw new Error('full index B failed');
    }
    const snapshotB = await loadSnapshotJson();
    step('full-index-B', true, {
      nodes: snapshotB.graph.nodes.length,
      edges: snapshotB.graph.edges.length,
    });

    // 4. 还原 snapshot A → 跑 incremental → snapshot C
    await writeSnapshotJson(snapshotA);
    const tInc0 = Date.now();
    r = runSpectra(['--incremental'], { timeoutMs: timeoutMs + 30000 });
    const incElapsed = Date.now() - tInc0;
    if (r.status !== 0) {
      step('incremental', false, { stderr: r.stderr.slice(0, 500) });
      throw new Error('incremental failed');
    }
    if (incElapsed > timeoutMs) {
      step('incremental-timing', false, { elapsedMs: incElapsed, budgetMs: timeoutMs });
      throw new Error(`incremental 超时: ${incElapsed}ms > ${timeoutMs}ms`);
    }
    step('incremental', true, { elapsedMs: incElapsed, budgetMs: timeoutMs });
    const snapshotC = await loadSnapshotJson();

    // 5. canonical sort + diff 三类边
    const bEdges = canonicalSort(filterRelevantEdges(snapshotB.graph.edges));
    const cEdges = canonicalSort(filterRelevantEdges(snapshotC.graph.edges));
    const { onlyInA: onlyInB, onlyInB: onlyInC } = diffEdges(bEdges, cEdges);

    if (onlyInB.length === 0 && onlyInC.length === 0) {
      step('edge-diff', true, { bCount: bEdges.length, cCount: cEdges.length });
      report.pass = true;
    } else {
      step('edge-diff', false, {
        bCount: bEdges.length,
        cCount: cEdges.length,
        onlyInBSample: onlyInB.slice(0, 5),
        onlyInCSample: onlyInC.slice(0, 5),
      });
    }
  } finally {
    // 还原源文件
    await fsp.writeFile(mutFile, origContent, 'utf-8');
  }
} catch (err) {
  step('error', false, { message: err instanceof Error ? err.message : String(err) });
}

process.stdout.write(`${JSON.stringify({ report })}\n`);
process.exit(report.pass ? 0 : 1);
