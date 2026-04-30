#!/usr/bin/env node
/**
 * Feature 147 Phase 1 — multi-tool competitor collector
 *
 * 复用 baseline-collect 的 spectra 实现，新增 graphify / aider-repomap / cody dispatch。
 * 输出 fixture 到 tests/baseline/<project>/<tool>/<mode>.json（schema 1.1，含 quality 段）。
 *
 * 用法：
 *   node scripts/eval-competitor.mjs --target karpathy/micrograd --tool graphify --frozen
 *   node scripts/eval-competitor.mjs --target karpathy/micrograd --tool aider-repomap --frozen
 *   node scripts/eval-competitor.mjs --target karpathy/micrograd --tool cody --frozen  # stub
 *
 * 不依赖 npm 包；只用 node:* 内置。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildQualitySection } from './lib/baseline-quality.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = '1.1';
const COLLECTOR_VERSION = '0.3.0';
const STALE_AFTER_MONTHS = 6;

export const SUPPORTED_COMPETITOR_TOOLS = ['spectra', 'graphify', 'aider-repomap', 'cody'];

function getBaselineHome() {
  return process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
}

const KNOWN_TARGETS = {
  'self-dogfood': { type: 'local', name: 'self-dogfood', path: PROJECT_ROOT, repoUrl: null },
  'karpathy/micrograd': { type: 'clone', name: 'micrograd', repoUrl: 'https://github.com/karpathy/micrograd.git' },
  'karpathy/nanoGPT': { type: 'clone', name: 'nanoGPT', repoUrl: 'https://github.com/karpathy/nanoGPT.git' },
};

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    target: null,
    tool: 'spectra',
    mode: 'full',
    frozen: false,
    upstreamVersion: null,
    skipInstallCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--target': args.target = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--mode': args.mode = argv[++i]; break;
      case '--frozen': args.frozen = true; break;
      case '--upstream-version': args.upstreamVersion = argv[++i]; break;
      case '--skip-install-check': args.skipInstallCheck = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!SUPPORTED_COMPETITOR_TOOLS.includes(args.tool)) {
    throw new Error(`--tool must be one of ${SUPPORTED_COMPETITOR_TOOLS.join('|')}`);
  }
  return args;
}

// ============================================================
// Tool installation 探测
// ============================================================

export function detectToolInstalled(tool) {
  switch (tool) {
    case 'graphify': {
      // graphify 不支持 --version flag；用 --help 退出码探测安装
      const r = spawnSync('graphify', ['--help'], { encoding: 'utf-8' });
      if (r.status === 0 || r.status === 2) { // help 输出 0 或 click 默认 2 都视为已装
        // 尝试从 PyPI 装包记录提取版本（uv tool list 或 pip show）
        const v = spawnSync('uv', ['tool', 'list'], { encoding: 'utf-8' });
        const m = (v.stdout ?? '').match(/graphifyy\s+v?([\d.]+)/);
        return { ok: true, version: m ? m[1] : 'installed' };
      }
      return { ok: false, hint: 'install: uv tool install graphifyy && graphify install' };
    }
    case 'aider-repomap': {
      const r = spawnSync('aider', ['--version'], { encoding: 'utf-8' });
      return r.status === 0 ? { ok: true, version: (r.stdout ?? '').trim() } : { ok: false, hint: 'install: uv tool install aider-chat' };
    }
    case 'cody':
      return { ok: false, hint: 'cody is optional/manual (Sourcegraph account + source upload)；不在本 Feature 自动化范围。详见 specs/147-*/research/competitive-landscape.md §1.3' };
    case 'spectra': {
      const cliPath = path.join(PROJECT_ROOT, 'dist/cli/index.js');
      return fs.existsSync(cliPath) ? { ok: true, version: 'self' } : { ok: false, hint: 'run npm run build first' };
    }
    default:
      return { ok: false, hint: `unknown tool: ${tool}` };
  }
}

// ============================================================
// Tool dispatch（生产 fixture）
// ============================================================

/**
 * graphify update <path> → 解析 NetworkX graph.json → 组装 fixture
 *
 * graphify 实际 CLI 是 `graphify update <path>`（不是 build），把产物写到 cwd 的 ./graphify-out/。
 * 为避免污染持久 workspace（~/.spectra-baselines/<project>/），在临时目录里 rsync 一份再跑。
 */
export function runGraphify({ targetPath, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  // 临时 workdir：避免污染 ~/.spectra-baselines/<project>/
  const tmpWorkdir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-eval-'));
  // 把 target 内容复制到 tmpWorkdir（仅源码，不含 .git / node_modules）
  const cpResult = spawnSync(
    'rsync',
    ['-a', '--exclude=.git', '--exclude=node_modules', '--exclude=dist', `${targetPath}/`, `${tmpWorkdir}/`],
    { encoding: 'utf-8' },
  );
  if (cpResult.status !== 0) {
    fs.rmSync(tmpWorkdir, { recursive: true, force: true });
    throw new Error(`rsync target → tmpWorkdir failed: ${cpResult.stderr}`);
  }
  const start = process.hrtime.bigint();
  const r = spawnSync('graphify', ['update', '.'], {
    cwd: tmpWorkdir,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const totalWallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  if (r.status !== 0) {
    fs.rmSync(tmpWorkdir, { recursive: true, force: true });
    throw new Error(`graphify update failed: ${r.stderr}`);
  }
  // graphify 默认输出 ./graphify-out/{graph.json, GRAPH_REPORT.md, graph.html}
  const graphifyOut = path.join(tmpWorkdir, 'graphify-out');
  const graphPath = path.join(graphifyOut, 'graph.json');
  let graphStats = { graphNodeCount: null, graphEdgeCount: null, graphHyperedgeCount: 0, graphSizeBytes: null };
  if (fs.existsSync(graphPath)) {
    // 复制产物到 outputDir
    const cpOut = spawnSync('cp', ['-R', graphifyOut + '/.', outputDir], { encoding: 'utf-8' });
    if (cpOut.status !== 0) console.warn('[runGraphify] cp graphify-out failed:', cpOut.stderr);
    const stat = fs.statSync(graphPath);
    const g = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    graphStats = {
      graphNodeCount: Array.isArray(g.nodes) ? g.nodes.length : null,
      graphEdgeCount: Array.isArray(g.links) ? g.links.length : Array.isArray(g.edges) ? g.edges.length : null,
      graphHyperedgeCount: Array.isArray(g.hyperedges) ? g.hyperedges.length : 0,
      graphSizeBytes: stat.size,
    };
  }
  fs.rmSync(tmpWorkdir, { recursive: true, force: true });
  return { totalWallMs, graphStats, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * aider --show-repo-map → markdown ranked symbol list → 抽取 symbol count + token estimate
 *
 * aider 默认要走 OAuth；用 ANTHROPIC_API_KEY=dummy + --model anthropic/claude-3-5-sonnet 跳过实际 LLM 调用。
 * --show-repo-map 仅本地 tree-sitter + PageRank，不发 API 请求，dummy key 不会被实际使用。
 */
export function runAiderRepomap({ targetPath, mapTokens = 2048 }) {
  const start = process.hrtime.bigint();
  const r = spawnSync(
    'aider',
    [
      '--show-repo-map',
      '--map-tokens', String(mapTokens),
      '--no-fancy-input',
      '--no-stream',
      '--yes-always',
      '--weak-model', 'none',
      '--model', 'anthropic/claude-3-5-sonnet',
      '--no-auto-commits',
      '--no-suggest-shell-commands',
      '--no-check-update',
      '--no-gitignore',
    ],
    {
      cwd: targetPath,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'dummy',
        AIDER_NO_AUTO_COMMIT: '1',
      },
    },
  );
  const totalWallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  if (r.status !== 0) throw new Error(`aider --show-repo-map failed: ${r.stderr}`);
  const stdout = r.stdout ?? '';
  // 解析 markdown ranked symbol list：每行形如 `path/to/file.py:` + 后续 def/class 行
  const lines = stdout.split('\n');
  const fileLines = lines.filter((l) => /^[^\s].*:\s*$/.test(l));
  const symbolLines = lines.filter((l) => /^[│|]?\s+(def|class|function|async def|export|interface|type)\s/.test(l));
  return {
    totalWallMs,
    repoMapStats: {
      filesInMap: fileLines.length,
      symbolsInMap: symbolLines.length,
      mapTokensRequested: mapTokens,
      mapBytes: stdout.length,
    },
    stdout,
    stderr: r.stderr ?? '',
  };
}

// ============================================================
// Fixture 组装
// ============================================================

function readSpectraVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function getGitCommit(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

export function assembleCompetitorFixture({ tool, target, mode, frozen, upstreamVersion, perf, output, qualitySection, command, args, extraMeta = {} }) {
  const nowIso = new Date().toISOString();
  const staleAfterDate = new Date(Date.now() + STALE_AFTER_MONTHS * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      tool,
      spectraVersion: readSpectraVersion(),
      collectorVersion: COLLECTOR_VERSION,
      targetProject: target.spec,
      targetCommit: target.commit,
      targetFileCountsByType: target.fileCountsByType,
      targetLocEstimate: target.locEstimate,
      spectraModuleCount: null, // 竞品工具不识别 spectra 的 module；保持 null
      mode,
      model: tool === 'spectra' ? 'claude-sonnet-4-6' : null,
      runTimestampUtc: nowIso,
      runHostOs: process.platform,
      command,
      args,
      envAllowlist: {},
      outputDir: target.outputDir,
      stdoutLogPath: path.join(target.outputDir, `${tool}-stdout.log`),
      stderrLogPath: path.join(target.outputDir, `${tool}-stderr.log`),
      pinnedAt: nowIso,
      staleAfterDate,
      upstreamVersion: upstreamVersion ?? 'unknown',
      frozenFixture: frozen,
      ...extraMeta,
    },
    dryRun: { estimatedTokens: null, actualTokens: null, biasRatio: null },
    perf: {
      totalWallMs: perf?.totalWallMs ?? null,
      llmCallCount: perf?.llmCallCount ?? 0,
      llmCallDurationsMs: null,
      tokensInput: perf?.tokensInput ?? 0,
      tokensOutput: perf?.tokensOutput ?? 0,
      tokensCacheRead: null,
      estimatedCostUsd: perf?.estimatedCostUsd ?? 0,
      memoryPeakKb: perf?.memoryPeakKb ?? null,
    },
    output: {
      graphNodeCount: output?.graphNodeCount ?? null,
      graphEdgeCount: output?.graphEdgeCount ?? null,
      graphHyperedgeCount: output?.graphHyperedgeCount ?? 0,
      graphSizeBytes: output?.graphSizeBytes ?? null,
      specModuleCount: output?.specModuleCount ?? null,
      specSuccessCount: output?.specSuccessCount ?? null,
      specSkippedCount: output?.specSkippedCount ?? null,
      specFailedCount: output?.specFailedCount ?? null,
    },
    phases: {
      specGenerationMs: null,
      graphBuildMs: perf?.totalWallMs ?? null, // 竞品大多只做 graph build；记录到 graphBuildMs
      docsGenerationMs: null,
      embeddingCacheMs: null,
      otherMs: null,
      extractionMethod: 'tool-specific',
    },
    quality: qualitySection ?? null,
  };
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const def = KNOWN_TARGETS[args.target];
  if (!def) throw new Error(`unknown target: ${args.target}; known: ${Object.keys(KNOWN_TARGETS).join(', ')}`);

  // 安装探测
  const install = detectToolInstalled(args.tool);
  if (!install.ok && !args.skipInstallCheck) {
    console.error(`[eval-competitor] ${args.tool} not installed: ${install.hint}`);
    console.error(`[eval-competitor] use --skip-install-check to write a stub fixture (frozen=true) for documentation`);
    process.exit(2);
  }

  const targetPath = def.type === 'local' ? def.path : path.join(getBaselineHome(), def.name);
  if (def.type === 'clone' && !fs.existsSync(targetPath)) {
    throw new Error(`target workspace ${targetPath} not found; run baseline-collect first to clone`);
  }
  const targetCommit = getGitCommit(targetPath);
  const outputDir = path.join(getBaselineHome(), `${def.name}-output`, `${args.tool}-${args.mode}`);
  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });

  // target 文件计数（复用 baseline-quality 不行，因为它分析 spec 不分析 source code；这里简化）
  const fileStats = quickFileStats(targetPath);

  let perf, output, qualitySection, command, runArgs;

  if (install.ok) {
    if (args.tool === 'graphify') {
      const r = runGraphify({ targetPath, outputDir });
      perf = { totalWallMs: r.totalWallMs };
      output = r.graphStats;
      // graphify 没产 spec.md，quality.specStructure 留空；只 graphSanity 可填（基于 graph.json）
      qualitySection = {
        specStructure: null,
        graphSanity: parseGraphSanityForCompetitor(path.join(outputDir, 'graph.json')),
        crossLinks: null,
        codingContextGrounding: null,
        graphTopologyAccuracy: null,
      };
      command = 'graphify';
      runArgs = ['build', '--no-llm', '--code-only'];
      fs.writeFileSync(path.join(outputDir, 'graphify-stdout.log'), r.stdout, 'utf-8');
      fs.writeFileSync(path.join(outputDir, 'graphify-stderr.log'), r.stderr, 'utf-8');
    } else if (args.tool === 'aider-repomap') {
      const r = runAiderRepomap({ targetPath });
      perf = { totalWallMs: r.totalWallMs };
      output = {
        graphNodeCount: r.repoMapStats.symbolsInMap, // aider 没 graph，把 symbol count 当 nodeCount
        graphEdgeCount: null, // aider repomap 是 ranked list 不是 graph
        graphSizeBytes: r.repoMapStats.mapBytes,
      };
      qualitySection = {
        specStructure: null,
        graphSanity: null, // aider 没 graph
        crossLinks: null,
        codingContextGrounding: null,
        graphTopologyAccuracy: null,
      };
      command = 'aider';
      runArgs = ['--show-repo-map', '--map-tokens', '2048'];
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'aider-repomap-stdout.log'), r.stdout, 'utf-8');
      fs.writeFileSync(path.join(outputDir, 'aider-repomap-stderr.log'), r.stderr, 'utf-8');
    } else if (args.tool === 'cody') {
      throw new Error('cody is optional/manual; see CLAUDE.local.md');
    } else if (args.tool === 'spectra') {
      console.error('use scripts/baseline-collect.mjs for spectra (eval-competitor only handles competitors)');
      process.exit(2);
    }
  } else {
    // skipInstallCheck=true：写 stub fixture（perf null，记录为 not-installed-locally）
    perf = null;
    output = null;
    qualitySection = null;
    command = `${args.tool}:not-installed-locally`;
    runArgs = [];
  }

  const fixture = assembleCompetitorFixture({
    tool: args.tool,
    target: { spec: args.target, commit: targetCommit, fileCountsByType: fileStats.fileCountsByType, locEstimate: fileStats.locEstimate, outputDir },
    mode: args.mode,
    frozen: args.frozen,
    upstreamVersion: args.upstreamVersion ?? install.version ?? 'unknown',
    perf,
    output,
    qualitySection,
    command,
    args: runArgs,
    extraMeta: install.ok ? {} : { installStatus: 'not-installed-locally', installHint: install.hint },
  });

  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline', def.name, args.tool);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, `${args.mode}.json`);
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.log(`[eval-competitor] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}${install.ok ? '' : ' (stub, tool not installed)'}`);
}

// ============================================================
// 辅助
// ============================================================

function quickFileStats(targetDir) {
  const counts = { ts: 0, tsx: 0, py: 0, md: 0, other: 0 };
  let locEstimate = 0;
  const skip = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '.spectra-baseline-output']);
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        if (/\.tsx$/.test(e.name)) counts.tsx++;
        else if (/\.tsx?$/.test(e.name)) counts.ts++;
        else if (/\.py$/.test(e.name)) counts.py++;
        else if (/\.md$/.test(e.name)) counts.md++;
        else counts.other++;
        if (/\.(tsx?|py)$/.test(e.name)) {
          try { locEstimate += fs.readFileSync(full, 'utf-8').split('\n').length; } catch {}
        }
      }
    }
  }
  walk(targetDir);
  return { fileCountsByType: counts, locEstimate };
}

function parseGraphSanityForCompetitor(graphJsonPath) {
  if (!fs.existsSync(graphJsonPath)) return null;
  let g;
  try { g = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8')); } catch { return null; }
  const nodes = g.nodes ?? [];
  const links = g.links ?? g.edges ?? [];
  const ids = new Set(nodes.map((n) => n.id ?? n.name));
  let selfLoops = 0, missing = 0, withoutType = 0;
  const deg = new Map();
  for (const e of links) {
    const s = e.source ?? e.from, t = e.target ?? e.to;
    if (s === t) selfLoops++;
    if (!ids.has(s) || !ids.has(t)) missing++;
    if (!e.type && !e.kind) withoutType++;
    deg.set(s, (deg.get(s) ?? 0) + 1);
    deg.set(t, (deg.get(t) ?? 0) + 1);
  }
  const isolated = nodes.filter((n) => !deg.has(n.id ?? n.name)).length;
  const degVals = [...deg.values()];
  const avgDeg = nodes.length > 0 ? Math.round((degVals.reduce((s, v) => s + v, 0) / nodes.length) * 10) / 10 : 0;
  return {
    isolatedNodes: isolated,
    selfLoops,
    edgesWithMissingTarget: missing,
    averageDegree: avgDeg,
    maxDegree: degVals.length > 0 ? Math.max(...degVals) : 0,
    edgesWithoutType: withoutType,
  };
}

const isCliEntry = process.argv[1]?.endsWith('eval-competitor.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[eval-competitor] error: ${err.message}`);
    process.exit(1);
  });
}
