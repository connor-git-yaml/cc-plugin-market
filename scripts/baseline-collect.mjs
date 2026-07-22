#!/usr/bin/env node
/**
 * Feature 143 — baseline collector
 *
 * 跑指定工具（spectra / graphify / llm-agent）在指定 target 项目上，
 * 解析产物并落 fixture JSON 到 tests/baseline/<project>/<tool>/<mode>.json。
 *
 * Workspace 持久化在 ~/.spectra-baselines/<project>/（用户偏好 Q2=A，跨 worktree 共享）。
 * 设置 SPECTRA_BASELINE_HOME 环境变量可覆盖。
 *
 * 用法：
 *   node scripts/baseline-collect.mjs --target <name> --mode <full|reading|code-only> [--tool spectra]
 *   node scripts/baseline-collect.mjs --target self-dogfood --mode full
 *   node scripts/baseline-collect.mjs --verify-artifacts
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
const SCHEMA_VERSION = '1.1'; // F147 升级：加 quality 段 + frozenFixture/pinnedAt/staleAfterDate/upstreamVersion
const COLLECTOR_VERSION = '0.3.0'; // F147 minor bump
const STALE_AFTER_MONTHS = 6; // 竞品 fixture 超期 warning 阈值（自己 fixture 的 staleAfterDate 实际不强制）

// Workspace 家目录：跨 worktree 共享，避免每次重 clone（Q2=A）
export function getBaselineHome() {
  return process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
}

// 支持的 tools（Q3=A 留接口；spectra 完整实现，竞品后续 PR 填充）
export const SUPPORTED_TOOLS = ['spectra', 'graphify', 'llm-agent'];
const DEFAULT_TOOL = 'spectra';

// SC 验收（用户决策 Q1=C：放弃 spec §2.1 硬性 500+，改成"已选定 baseline 的 fixture 存在 + schema 完整"）
const SC001_REQUIRED_PROJECTS = ['micrograd', 'nanoGPT', 'self-dogfood'];
const SC001_REQUIRED_MODE = 'full';
const SC001_REQUIRED_TOOL = 'spectra'; // 验收 spectra 自己的基线；竞品 fixture 不卡 SC-001

const KNOWN_TARGETS = {
  'self-dogfood': {
    type: 'local',
    name: 'self-dogfood',
    path: PROJECT_ROOT,
    repoUrl: null,
  },
  'karpathy/micrograd': {
    type: 'clone',
    name: 'micrograd',
    repoUrl: 'https://github.com/karpathy/micrograd.git',
  },
  'karpathy/nanoGPT': {
    type: 'clone',
    name: 'nanoGPT',
    repoUrl: 'https://github.com/karpathy/nanoGPT.git',
  },
  // Sprint 3 Phase C.2: production-grade OSS TS API 框架，~30k LOC（src/ 仅源码部分）
  'honojs/hono': {
    type: 'clone',
    name: 'hono',
    repoUrl: 'https://github.com/honojs/hono.git',
    subdir: 'src', // 排除 docs / benchmarks / build
  },
};

const FILE_TYPE_GLOBS = {
  ts: /\.tsx?$/,
  tsx: /\.tsx$/,
  py: /\.py$/,
  md: /\.md$/,
};

// ============================================================
// argv 解析（不依赖 commander）
// ============================================================

export function parseArgs(argv) {
  const args = {
    target: null,
    targets: null, // 逗号分隔多 target，CI workflow_dispatch 友好
    mode: 'full',
    tool: DEFAULT_TOOL, // spectra | graphify | llm-agent
    commit: null,
    verifyArtifacts: false,
    output: null,
    skipBatch: false, // 测试用：仅生成 fixture skeleton 不实际跑 batch
    upgradeOnly: false, // F147：仅升级现有 fixture schema 1.0 → 1.1（不重跑 batch，零 cost）
    force: false, // F147：upgrade-only 时强制重算 quality 段（即使 schemaVersion 已是 1.1）
    frozen: false, // F147：标记 frozenFixture true（竞品冷冻；自己 fixture 默认 false）
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--target':
        args.target = argv[++i];
        break;
      case '--targets':
        args.targets = argv[++i];
        break;
      case '--mode':
        args.mode = argv[++i];
        break;
      case '--tool':
        args.tool = argv[++i];
        break;
      case '--commit':
        args.commit = argv[++i];
        break;
      case '--verify-artifacts':
        args.verifyArtifacts = true;
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--skip-batch':
        args.skipBatch = true;
        break;
      case '--upgrade-only':
        args.upgradeOnly = true;
        break;
      case '--frozen':
        args.frozen = true;
        break;
      case '--force':
        args.force = true;
        break;
      default:
        if (a.startsWith('--')) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
  }
  if (!SUPPORTED_TOOLS.includes(args.tool)) {
    throw new Error(`--tool must be one of ${SUPPORTED_TOOLS.join('|')}, got: ${args.tool}`);
  }
  return args;
}

// ============================================================
// Target 文件统计
// ============================================================

export function parseTargetFiles(targetDir, opts = {}) {
  const counts = { ts: 0, tsx: 0, py: 0, md: 0, other: 0 };
  let locEstimate = 0;
  const skip = new Set([
    'node_modules', 'dist', '.git', '.next', 'build', 'coverage',
    '.workspaces', 'tests/baseline/.workspaces',
    '.spectra-baseline-output', // collector 自己产物
  ]);
  if (opts.extraSkip) {
    for (const s of opts.extraSkip) skip.add(s);
  }

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        if (FILE_TYPE_GLOBS.tsx.test(e.name)) {
          counts.tsx++;
        } else if (FILE_TYPE_GLOBS.ts.test(e.name)) {
          counts.ts++;
        } else if (FILE_TYPE_GLOBS.py.test(e.name)) {
          counts.py++;
        } else if (FILE_TYPE_GLOBS.md.test(e.name)) {
          counts.md++;
        } else {
          counts.other++;
        }
        if (
          FILE_TYPE_GLOBS.ts.test(e.name) ||
          FILE_TYPE_GLOBS.tsx.test(e.name) ||
          FILE_TYPE_GLOBS.py.test(e.name)
        ) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            locEstimate += content.split('\n').length;
          } catch {
            // ignore unreadable file
          }
        }
      }
    }
  }
  walk(targetDir);
  return { fileCountsByType: counts, locEstimate };
}

// ============================================================
// 解析 batch-summary*.md（找最新一份）
// ============================================================

export function findLatestBatchSummary(metaDir) {
  if (!fs.existsSync(metaDir)) return null;
  const candidates = fs
    .readdirSync(metaDir)
    .filter((n) => n.startsWith('batch-summary-') && n.endsWith('.md'))
    .sort()
    .reverse();
  return candidates.length > 0 ? path.join(metaDir, candidates[0]) : null;
}

export function parseBatchSummary(summaryPath) {
  const content = fs.readFileSync(summaryPath, 'utf-8');

  function pickRow(label) {
    const re = new RegExp(`\\| ${label} \\| ([^|\\n]+?) \\|`, 'i');
    const m = content.match(re);
    return m ? m[1].trim() : null;
  }

  const totalModulesStr = pickRow('总模块数');
  const successStr = pickRow('成功');
  const failedStr = pickRow('失败');
  const skippedStr = pickRow('跳过');
  const inputTokensStr = pickRow('总 input tokens');
  const outputTokensStr = pickRow('总 output tokens');
  const llmDurationStr = pickRow('LLM 总耗时'); // 形如 "123.4s"

  const num = (s) => (s == null ? null : Number(s.replace(/[, ]/g, '')));
  const llmSecs = llmDurationStr
    ? Number(llmDurationStr.replace(/[^\d.]/g, ''))
    : null;

  return {
    specModuleCount: num(totalModulesStr),
    specSuccessCount: num(successStr),
    specFailedCount: num(failedStr),
    specSkippedCount: num(skippedStr),
    tokensInput: num(inputTokensStr),
    tokensOutput: num(outputTokensStr),
    llmTotalDurationMs: llmSecs != null ? Math.round(llmSecs * 1000) : null,
  };
}

// ============================================================
// 解析 graph.json
// ============================================================

export function parseGraph(metaDir) {
  const graphPath = path.join(metaDir, 'graph.json');
  if (!fs.existsSync(graphPath)) {
    return {
      graphNodeCount: null,
      graphEdgeCount: null,
      graphHyperedgeCount: null,
      graphSizeBytes: null,
    };
  }
  const stat = fs.statSync(graphPath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  } catch {
    return {
      graphNodeCount: null,
      graphEdgeCount: null,
      graphHyperedgeCount: null,
      graphSizeBytes: stat.size,
    };
  }
  // graph.json 用 networkx node-link format：nodes + links（不是 edges）
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes.length : null;
  const edges = Array.isArray(parsed?.links)
    ? parsed.links.length
    : Array.isArray(parsed?.edges)
      ? parsed.edges.length
      : null;
  const hyperedges = Array.isArray(parsed?.hyperedges)
    ? parsed.hyperedges.length
    : 0;
  return {
    graphNodeCount: nodes,
    graphEdgeCount: edges,
    graphHyperedgeCount: hyperedges,
    graphSizeBytes: stat.size,
  };
}

// ============================================================
// 解析 stdout log（LLM 调用次数 + 耗时分布 + phase 占比）
//
// 当前 batch CLI 的 stdout 没有稳定的 [LLM] / [phase] 边界格式，
// 因此 schemaVersion 1.0 的 collector 仅尽力解析能识别的关键字。
// 不可用的字段写 null + extractionMethod 标注。
// ============================================================

/**
 * 解析 batch-orchestrator 的 stderr log。实际格式（src/batch/batch-orchestrator.ts:912）：
 *   `[<moduleName>] AST: 0.1s | context: 0.2s | LLM#1: 12.3s | enrich: 0.4s | render: 0.0s | total: 13.5s`
 * 单位是秒，可能是 "-" 表示 stage 跳过。
 *
 * 同时接受 stdout（兼容未来格式变化）和 stderr（实际格式）。
 */
export function parseLlmCalls(combinedLog) {
  const durationsMs = [];
  const re = /\|\s*LLM#\d+:\s+([\d.]+)s/g;
  let m;
  while ((m = re.exec(combinedLog)) !== null) {
    durationsMs.push(Math.round(Number(m[1]) * 1000));
  }
  if (durationsMs.length === 0) {
    return {
      llmCallCount: null,
      llmCallDurationsMs: null,
      _extractionNote: 'stderr-format-unrecognized',
    };
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    llmCallCount: durationsMs.length,
    llmCallDurationsMs: {
      p50: pct(0.5),
      p95: pct(0.95),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      samplesCount: durationsMs.length,
    },
    _extractionNote: null,
  };
}

export function parsePhases(stdoutLog) {
  // batch-orchestrator 当前没有稳定的 phase 边界 marker。
  // schemaVersion 1.0 不强制；写 null + extractionMethod 标注，留给 F140 后续改进。
  return {
    specGenerationMs: null,
    graphBuildMs: null,
    docsGenerationMs: null,
    embeddingCacheMs: null,
    otherMs: null,
    extractionMethod: 'unavailable',
  };
}

// ============================================================
// 解析 /usr/bin/time stderr
// ============================================================

export function parseTimeStderr(stderr) {
  // GNU time -v: "Maximum resident set size (kbytes): 524288"
  // BSD time -l: "  524288  maximum resident set size"
  const linuxMatch = stderr.match(/Maximum resident set size[^:]*:\s*(\d+)/i);
  if (linuxMatch) return Number(linuxMatch[1]);
  const bsdMatch = stderr.match(/(\d+)\s+maximum resident set size/i);
  if (bsdMatch) return Math.round(Number(bsdMatch[1]) / 1024);
  return null;
}

// ============================================================
// 资源准备（clone or local）
// ============================================================

export function prepareTarget(targetSpec, commit) {
  const def = KNOWN_TARGETS[targetSpec];
  if (!def) {
    throw new Error(`unknown target: ${targetSpec}; known: ${Object.keys(KNOWN_TARGETS).join(', ')}`);
  }
  if (def.type === 'local') {
    return {
      name: def.name,
      path: def.path,
      commit: getGitCommit(def.path) ?? 'unknown',
    };
  }
  // clone — 持久化在 ~/.spectra-baselines/<project>/，跨 worktree 共享，已存在则不重 clone
  const workspaceDir = path.join(getBaselineHome(), def.name);
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(path.dirname(workspaceDir), { recursive: true });
    console.log(`[baseline] cloning ${def.repoUrl} → ${workspaceDir}`);
    const cloneArgs = commit
      ? ['clone', def.repoUrl, workspaceDir]
      : ['clone', '--depth', '50', def.repoUrl, workspaceDir];
    const clone = spawnSync('git', cloneArgs, { stdio: 'inherit' });
    if (clone.status !== 0) {
      throw new Error(`git clone failed for ${def.repoUrl}`);
    }
  } else {
    console.log(`[baseline] reusing existing workspace ${workspaceDir}`);
  }
  if (commit) {
    let checkout = spawnSync('git', ['-C', workspaceDir, 'checkout', commit], { stdio: 'inherit' });
    if (checkout.status !== 0) {
      // shallow clone 中 hash 不存在；fetch 该 commit 后重试
      console.error(`[baseline] checkout ${commit} failed in shallow clone, fetching...`);
      const fetch = spawnSync('git', ['-C', workspaceDir, 'fetch', '--depth', '1', 'origin', commit], { stdio: 'inherit' });
      if (fetch.status !== 0) {
        throw new Error(`git fetch ${commit} failed; consider pre-cloning full history`);
      }
      checkout = spawnSync('git', ['-C', workspaceDir, 'checkout', commit], { stdio: 'inherit' });
      if (checkout.status !== 0) {
        throw new Error(`git checkout ${commit} failed even after fetch`);
      }
    }
  }
  // Sprint 3 Phase C.2: 对大型 production 项目，subdir 让 batch 只扫描源码子目录
  const effectivePath = def.subdir ? path.join(workspaceDir, def.subdir) : workspaceDir;
  return {
    name: def.name,
    path: effectivePath,
    commit: getGitCommit(workspaceDir) ?? commit ?? 'unknown',
  };
}

function getGitCommit(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

// ============================================================
// 实跑 batch（包 /usr/bin/time）
// ============================================================

/**
 * 真实 LLM batch 的 CLI 参数构造（纯函数，供单测锁定不变量）。
 *
 * 两个 flag 缺一不可，且必须只出现在真实调用路径：
 *   --full：F175/OQ-4 起默认走增量，缺它则上一次失败写下的 AST-only 产物会被 cache 命中
 *           跳过（记为 skipped 而非 degraded），严格校验读到空降级列表后放行 exit 0。
 *   --require-llm：Feature 222 起零认证降级继续并 exit 0，仅靠退出码不再能证明产物是 LLM 增强。
 * baseline fixture 是入库的跨版本 perf 对比锚点，被 AST-only 产物污染后果长期且难察觉。
 */
export function buildRealBatchArgs({ cliPath, targetPath, mode, outputDir }) {
  return [
    'node',
    cliPath,
    'batch',
    targetPath,
    '--full',
    '--require-llm',
    '--mode',
    mode,
    '--output-dir',
    outputDir,
  ];
}

/**
 * dry-run 预估的 CLI 参数构造（纯函数）。
 * 零 LLM 路径：估算的是"全量真实跑"的成本故保留 --full，但不得携带 --require-llm
 * （批处理在 dry-run 分支提前返回，降级列表恒空，严格校验只会变成静默的假通过）。
 */
export function buildDryRunBatchArgs({ cliPath, targetPath, mode }) {
  return ['node', cliPath, 'batch', targetPath, '--full', '--mode', mode, '--dry-run'];
}

export function runBatchAndCapture({ targetPath, mode, outputDir }) {
  const isMacOs = process.platform === 'darwin';
  const timeBin = isMacOs ? '/usr/bin/time' : '/usr/bin/time';
  const timeFlag = isMacOs ? '-l' : '-v';
  const cliPath = path.join(PROJECT_ROOT, 'dist/cli/index.js');
  if (!fs.existsSync(cliPath)) {
    throw new Error(`spectra CLI not built (missing ${cliPath}); run "npm run build" first`);
  }
  const args = [timeFlag, ...buildRealBatchArgs({ cliPath, targetPath, mode, outputDir })];
  const env = { ...process.env };
  const start = process.hrtime.bigint();
  const r = spawnSync(timeBin, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    maxBuffer: 256 * 1024 * 1024, // 256MB；大项目 batch stderr 可能超 64MB
  });
  const end = process.hrtime.bigint();
  const totalWallMs = Number((end - start) / 1_000_000n);
  if (r.error) {
    const code = r.error.code ?? 'unknown';
    if (code === 'ENOBUFS') {
      throw new Error(
        `batch stdout/stderr exceeded maxBuffer (256MB). Re-run with stream-mode collector or split target into smaller chunks.`,
      );
    }
    throw new Error(`spawn failed: ${code} — ${r.error.message}`);
  }
  return {
    totalWallMs,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status,
    command: timeBin,
    args,
  };
}

// ============================================================
// dry-run（只跑预估）
// ============================================================

export function runDryRun({ targetPath, mode }) {
  const cliPath = path.join(PROJECT_ROOT, 'dist/cli/index.js');
  if (!fs.existsSync(cliPath)) return { estimatedTokens: null, note: 'cli-not-built' };
  const [bin, ...args] = buildDryRunBatchArgs({ cliPath, targetPath, mode });
  const r = spawnSync(bin, args, {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return { estimatedTokens: null, note: 'dry-run-failed' };
  // 实际格式：`[dry-run] 预估总 tokens: 35,534 (input ... + output ...)`
  const m = (r.stdout ?? '').match(/预估总\s*tokens?:\s*([\d,]+)/i);
  return {
    estimatedTokens: m ? Number(m[1].replace(/,/g, '')) : null,
    note: m ? null : 'estimate-not-found',
  };
}

// ============================================================
// Fixture 组装
// ============================================================

export function assembleFixture({
  spectraVersion,
  target,
  mode,
  tool,
  model,
  fileStats,
  command,
  args,
  envAllowlist,
  outputDir,
  dryRun,
  perfRaw,
  llmStats,
  phases,
  batchStats,
  graphStats,
  memoryPeakKb,
  qualitySection,           // F147: quality 段（来自 buildQualitySection）；如无 outputDir 则 null
  frozen = false,           // F147: frozenFixture 标记
  upstreamVersion,          // F147: 竞品的版本/commit；自己等于 spectraVersion
}) {
  const nowIso = new Date().toISOString();
  const staleAfterDate = new Date(Date.now() + STALE_AFTER_MONTHS * 30 * 24 * 3600 * 1000)
    .toISOString().slice(0, 10);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      tool, // 必含：spectra | graphify | aider-repomap | cody | superpowers | gstack | spec-driver | control
      spectraVersion,
      collectorVersion: COLLECTOR_VERSION,
      targetProject: target.spec,
      targetCommit: target.commit,
      targetFileCountsByType: fileStats.fileCountsByType,
      targetLocEstimate: fileStats.locEstimate,
      spectraModuleCount: batchStats.specModuleCount,
      mode,
      model,
      runTimestampUtc: nowIso,
      runHostOs: process.platform,
      command,
      args,
      envAllowlist,
      outputDir,
      stdoutLogPath: path.join(outputDir, 'spectra-stdout.log'),
      stderrLogPath: path.join(outputDir, 'spectra-stderr.log'),
      // F147 schema 1.1 新增字段
      pinnedAt: nowIso,
      staleAfterDate,
      upstreamVersion: upstreamVersion ?? spectraVersion,
      frozenFixture: frozen,
    },
    dryRun: {
      estimatedTokens: dryRun?.estimatedTokens ?? null,
      actualTokens:
        batchStats.tokensInput != null && batchStats.tokensOutput != null
          ? batchStats.tokensInput + batchStats.tokensOutput
          : null,
      biasRatio:
        dryRun?.estimatedTokens && batchStats.tokensInput != null && batchStats.tokensOutput != null
          ? Math.round(((batchStats.tokensInput + batchStats.tokensOutput) / dryRun.estimatedTokens) * 100) / 100
          : null,
    },
    perf: {
      totalWallMs: perfRaw.totalWallMs,
      llmCallCount: llmStats.llmCallCount,
      llmCallDurationsMs: llmStats.llmCallDurationsMs,
      tokensInput: batchStats.tokensInput,
      tokensOutput: batchStats.tokensOutput,
      tokensCacheRead: null, // batch-summary 当前未输出 cache_read，留 null
      estimatedCostUsd: estimateCostUsd(batchStats, model),
      memoryPeakKb,
    },
    output: {
      graphNodeCount: graphStats.graphNodeCount,
      graphEdgeCount: graphStats.graphEdgeCount,
      graphHyperedgeCount: graphStats.graphHyperedgeCount,
      graphSizeBytes: graphStats.graphSizeBytes,
      specModuleCount: batchStats.specModuleCount,
      specSuccessCount: batchStats.specSuccessCount,
      specSkippedCount: batchStats.specSkippedCount,
      specFailedCount: batchStats.specFailedCount,
    },
    phases,
    quality: qualitySection ?? null, // F147 schema 1.1：quality 段（静态分析）
  };
}

/**
 * F147 schema 升级：读现有 1.0 fixture + outputDir 现存产物 → 输出 1.1 fixture（零 LLM cost）
 */
export function upgradeFixtureToV11({ fixturePath, outputDir, projectRoot, frozen = false, force = false }) {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`fixture not found: ${fixturePath}`);
  }
  const old = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  if (old.schemaVersion === SCHEMA_VERSION && !force) {
    return { upgraded: false, reason: 'already at 1.1 (use --force to recompute quality)' };
  }
  // 读现有 outputDir 算 quality 段（不重跑 batch）
  const qualitySection = outputDir && fs.existsSync(outputDir)
    ? buildQualitySection(outputDir, projectRoot)
    : null;
  const nowIso = new Date().toISOString();
  const staleAfterDate = new Date(Date.now() + STALE_AFTER_MONTHS * 30 * 24 * 3600 * 1000)
    .toISOString().slice(0, 10);
  const upgraded = {
    ...old,
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...old.meta,
      collectorVersion: COLLECTOR_VERSION,
      pinnedAt: old.meta?.runTimestampUtc ?? nowIso,
      staleAfterDate,
      upstreamVersion: old.meta?.spectraVersion ?? 'unknown',
      frozenFixture: frozen,
    },
    quality: qualitySection,
  };
  fs.writeFileSync(fixturePath, JSON.stringify(upgraded, null, 2) + '\n', 'utf-8');
  return { upgraded: true, fixturePath, qualityNonNull: qualitySection != null };
}

function estimateCostUsd(batchStats, model) {
  if (batchStats.tokensInput == null || batchStats.tokensOutput == null) return null;
  // sonnet-4-6 价格：input $3/Mtok, output $15/Mtok（文档值，非 fact-checked，可在 plan 后续修订）
  if (model && /sonnet/.test(model)) {
    const cost = (batchStats.tokensInput * 3 + batchStats.tokensOutput * 15) / 1_000_000;
    return Math.round(cost * 100) / 100;
  }
  return null;
}

// ============================================================
// Verify Artifacts（SC-001）
// ============================================================

/**
 * SC-001 验收（用户决策 Q1=C 后）：
 *   要求 SC001_REQUIRED_PROJECTS 每个项目在 SC001_REQUIRED_TOOL 下有 SC001_REQUIRED_MODE 的 fixture，
 *   且 fixture schema 完整（targetCommit / targetFileCountsByType / perf 关键字段非 null）。
 *   不再 enforce "≥ 500 文件"硬性要求；改成"已选定 baseline 的覆盖完整"。
 */
export function verifyArtifacts({ rootDir }) {
  const baselineDir = path.join(rootDir, 'tests/baseline');
  const errors = [];
  for (const proj of SC001_REQUIRED_PROJECTS) {
    const fixturePath = path.join(baselineDir, proj, SC001_REQUIRED_TOOL, `${SC001_REQUIRED_MODE}.json`);
    if (!fs.existsSync(fixturePath)) {
      errors.push(`missing fixture: ${path.relative(rootDir, fixturePath)}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    } catch (e) {
      errors.push(`invalid JSON: ${path.relative(rootDir, fixturePath)}: ${e.message}`);
      continue;
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      errors.push(`schemaVersion mismatch in ${path.relative(rootDir, fixturePath)}: ${parsed.schemaVersion}`);
    }
    if (parsed.perf?.totalWallMs == null) {
      errors.push(`fixture ${path.relative(rootDir, fixturePath)} has null perf.totalWallMs`);
    }
    if (parsed.perf?.tokensInput == null) {
      errors.push(`fixture ${path.relative(rootDir, fixturePath)} has null perf.tokensInput`);
    }
    if (!parsed.meta?.targetFileCountsByType) {
      errors.push(`fixture ${path.relative(rootDir, fixturePath)} missing meta.targetFileCountsByType`);
    }
    if (!parsed.meta?.targetCommit) {
      errors.push(`fixture ${path.relative(rootDir, fixturePath)} missing meta.targetCommit (spec §6 reproducibility)`);
    }
    if (!parsed.meta?.tool) {
      errors.push(`fixture ${path.relative(rootDir, fixturePath)} missing meta.tool`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ============================================================
// 入口
// ============================================================

function readSpectraVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.verifyArtifacts) {
    const result = verifyArtifacts({ rootDir: PROJECT_ROOT });
    if (result.ok) {
      console.log('[baseline] verify-artifacts: PASS');
      process.exit(0);
    } else {
      console.error('[baseline] verify-artifacts: FAIL');
      for (const e of result.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
  }

  if (!args.target && !args.targets) {
    throw new Error('--target or --targets is required (e.g. self-dogfood, karpathy/micrograd, karpathy/nanoGPT)');
  }
  if (!['full', 'reading', 'code-only'].includes(args.mode)) {
    throw new Error(`--mode must be one of full|reading|code-only, got: ${args.mode}`);
  }

  const targetSpecs = args.targets
    ? args.targets.split(',').map((s) => s.trim()).filter(Boolean)
    : [args.target];

  // F147 schema 1.1 升级模式：仅读现有 fixture + outputDir → 写 1.1 fixture（零 LLM cost）
  if (args.upgradeOnly) {
    for (const targetSpec of targetSpecs) {
      const def = KNOWN_TARGETS[targetSpec];
      if (!def) {
        console.error(`[upgrade-only] unknown target: ${targetSpec}`);
        continue;
      }
      const projectRoot = def.type === 'local' ? def.path : path.join(getBaselineHome(), def.name);
      const fixturePath = path.join(PROJECT_ROOT, 'tests/baseline', def.name, args.tool, `${args.mode}.json`);
      const outputDir = path.join(getBaselineHome(), `${def.name}-output`, `${args.tool}-${args.mode}`);
      try {
        const r = upgradeFixtureToV11({ fixturePath, outputDir, projectRoot, frozen: args.frozen, force: args.force });
        if (r.upgraded) {
          console.log(`[upgrade-only] ${path.relative(PROJECT_ROOT, fixturePath)} → schema ${SCHEMA_VERSION}, quality=${r.qualityNonNull ? 'filled' : 'null'}`);
        } else {
          console.log(`[upgrade-only] ${path.relative(PROJECT_ROOT, fixturePath)} skipped: ${r.reason}`);
        }
      } catch (e) {
        console.error(`[upgrade-only] ${targetSpec}: ${e.message}`);
      }
    }
    return;
  }

  for (const targetSpec of targetSpecs) {
    await runOneTarget({ ...args, target: targetSpec });
  }
}

async function runOneTarget(args) {
  const target = prepareTarget(args.target, args.commit);
  target.spec = args.target;

  const fileStats = parseTargetFiles(target.path);
  console.log(`[baseline] target=${target.spec} commit=${target.commit.slice(0, 7)} files=${JSON.stringify(fileStats.fileCountsByType)} loc=${fileStats.locEstimate}`);

  // outputDir 默认放到 baseline home 的 -output 子目录（与 target workspace 同级），
  // 避免 collector 自己产物污染 parseTargetFiles 的目标项目文件计数。
  // 跑前清理保证从干净状态测量（baseline 测的是冷启动性能，不是 incremental 运行）。
  const outputDir = args.output
    ?? path.join(getBaselineHome(), `${target.name}-output`, `${args.tool}-${args.mode}`);
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  const model = 'claude-sonnet-4-6';

  let perfRaw, llmStats, phases, batchStats, graphStats, memoryPeakKb, dryRun, command, runArgs, envAllowlist;

  if (args.skipBatch) {
    // 测试用：跳过实跑，生成空 fixture 骨架
    perfRaw = { totalWallMs: null };
    llmStats = { llmCallCount: null, llmCallDurationsMs: null };
    phases = parsePhases('');
    batchStats = {
      specModuleCount: null,
      specSuccessCount: null,
      specFailedCount: null,
      specSkippedCount: null,
      tokensInput: null,
      tokensOutput: null,
      llmTotalDurationMs: null,
    };
    graphStats = {
      graphNodeCount: null,
      graphEdgeCount: null,
      graphHyperedgeCount: null,
      graphSizeBytes: null,
    };
    memoryPeakKb = null;
    dryRun = { estimatedTokens: null };
    command = 'skip-batch';
    runArgs = [];
    envAllowlist = {};
  } else {
    // tool dispatch（Q3=A）：spectra 完整实现，竞品留 stub
    if (args.tool === 'graphify' || args.tool === 'llm-agent') {
      throw new Error(
        `tool=${args.tool} 的 collector 实现待 follow-up PR；当前仅 spectra 实现完整。\n` +
        `参考 CLAUDE.local.md "Baseline 测试 / 扩展竞品 collector" 章节。`,
      );
    }
    dryRun = runDryRun({ targetPath: target.path, mode: args.mode });
    perfRaw = runBatchAndCapture({ targetPath: target.path, mode: args.mode, outputDir });
    if (perfRaw.exitCode !== 0) {
      console.error(`[baseline] batch exited with code ${perfRaw.exitCode}; stderr tail:`);
      console.error(perfRaw.stderr.split('\n').slice(-30).join('\n'));
      throw new Error(`batch failed for ${target.spec}/${args.mode}`);
    }
    const metaDir = path.join(outputDir, '_meta');
    const summaryPath = findLatestBatchSummary(metaDir);
    if (!summaryPath) {
      throw new Error(`no batch-summary-*.md under ${metaDir}`);
    }
    batchStats = parseBatchSummary(summaryPath);
    graphStats = parseGraph(metaDir);
    // batch-orchestrator 的 LLM stage 耗时写到 stderr（src/batch/batch-orchestrator.ts:912），
    // stdout 仅有 CLI 的汇总行；同时拼接两端避免格式漂移
    llmStats = parseLlmCalls(`${perfRaw.stdout}\n${perfRaw.stderr}`);
    phases = parsePhases(perfRaw.stdout);
    memoryPeakKb = parseTimeStderr(perfRaw.stderr);
    command = perfRaw.command;
    runArgs = perfRaw.args;
    envAllowlist = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '<redacted>' : null,
      SPECTRA_LOG_LEVEL: process.env.SPECTRA_LOG_LEVEL ?? null,
    };
    // 持久化 stdout/stderr，便于 verification 复审
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'spectra-stdout.log'), perfRaw.stdout, 'utf-8');
    fs.writeFileSync(path.join(outputDir, 'spectra-stderr.log'), perfRaw.stderr, 'utf-8');
  }

  const fixture = assembleFixture({
    spectraVersion: readSpectraVersion(),
    target,
    mode: args.mode,
    tool: args.tool,
    model,
    fileStats,
    command,
    args: runArgs,
    envAllowlist,
    outputDir,
    dryRun,
    perfRaw,
    llmStats,
    phases,
    batchStats,
    graphStats,
    memoryPeakKb,
    // F147 schema 1.1：实跑模式下也填 quality 段（静态分析 outputDir 产物）
    qualitySection: !args.skipBatch ? buildQualitySection(outputDir, target.path) : null,
    frozen: args.frozen,
  });

  // 多工具 fixture 路径：tests/baseline/<project>/<tool>/<mode>.json
  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline', target.name, args.tool);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, `${args.mode}.json`);
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.log(`[baseline] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}`);
}

const isCliEntry =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isCliEntry) {
  main().catch((err) => {
    console.error(`[baseline] error: ${err.message}`);
    process.exit(1);
  });
}
