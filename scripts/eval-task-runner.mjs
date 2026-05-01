#!/usr/bin/env node
/**
 * Feature 147 Phase 3 — Worktree task runner（spec-driver / SuperPowers / GStack / control 派发）
 *
 * 流程：
 *   1. 准备 worktree：clone target → ~/.spec-driver-bench-worktrees/<task>/<tool>/
 *   2. spawn `claude --print --plugin-dir <path> "<prompt>"` 让对应工具跑任务
 *   3. 监测产物：git log / files changed / wall / tokens
 *   4. 跑 primary oracle（ast-diff / unit-test）
 *   5. 写 fixture 到 tests/baseline/tasks/<task>/<tool>/full.json
 *
 * 用法：
 *   node scripts/eval-task-runner.mjs --task T1-micrograd-add-tanh --tool spec-driver
 *   node scripts/eval-task-runner.mjs --task T1-micrograd-add-tanh --tool control --cleanup on-success
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = '1.1';
const COLLECTOR_VERSION = '0.3.0';
const SUPPORTED_TOOLS = ['spec-driver', 'superpowers', 'gstack', 'control', 'spec-driver-spectra', 'spec-driver-opus'];

function getBenchHome() {
  return process.env.SPEC_DRIVER_BENCH_HOME ?? path.join(os.homedir(), '.spec-driver-bench-worktrees');
}

function getBaselineHome() {
  return process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
}

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    task: null,
    tool: null,
    cleanup: 'on-success', // always | on-success | never
    timeoutMs: 1800000, // 30 min hard limit
    skipRun: false, // 仅生成 fixture skeleton + 不实际 spawn claude
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task': args.task = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--cleanup': args.cleanup = argv[++i]; break;
      case '--timeout-ms': args.timeoutMs = Number(argv[++i]); break;
      case '--skip-run': args.skipRun = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.task) throw new Error('--task required');
  if (!SUPPORTED_TOOLS.includes(args.tool)) {
    throw new Error(`--tool must be one of ${SUPPORTED_TOOLS.join('|')}`);
  }
  return args;
}

// ============================================================
// Task fixture 加载
// ============================================================

export function loadTaskFixture(taskId) {
  const p = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures', `${taskId}.json`);
  if (!fs.existsSync(p)) throw new Error(`task fixture not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ============================================================
// Worktree 准备
// ============================================================

export function prepareWorktree({ taskId, tool, target, startCommit }) {
  const wtDir = path.join(getBenchHome(), taskId, tool);
  if (fs.existsSync(wtDir)) {
    fs.rmSync(wtDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(wtDir), { recursive: true });
  // 从 baseline workspace 复制（避免重新 clone）
  const sourceDir = path.join(getBaselineHome(), getTargetName(target));
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`baseline workspace ${sourceDir} not found; run baseline-collect first to clone`);
  }
  // rsync source → wtDir（含 .git，让 worktree 是独立 git 仓）
  const cp = spawnSync('rsync', ['-a', '--exclude=node_modules', `${sourceDir}/`, `${wtDir}/`], { encoding: 'utf-8' });
  if (cp.status !== 0) throw new Error(`rsync to worktree failed: ${cp.stderr}`);
  // checkout 起始 commit + 创建 task branch
  const branchName = `eval-bench/${taskId}/${tool}`;
  spawnSync('git', ['-C', wtDir, 'checkout', '-B', branchName, startCommit], { encoding: 'utf-8' });
  return { wtDir, branchName };
}

function getTargetName(targetSpec) {
  const map = { 'karpathy/micrograd': 'micrograd', 'karpathy/nanoGPT': 'nanoGPT', 'self-dogfood': 'self-dogfood' };
  return map[targetSpec] ?? targetSpec.split('/').pop();
}

// ============================================================
// Tool driver dispatch
// ============================================================

const SUPERPOWERS_PLUGIN_DIR = path.join(os.homedir(), '.claude/plugins/installed');
const GSTACK_SKILLS_DIR = path.join(os.homedir(), '.claude/skills/gstack');

export function buildDriverPrompt({ tool, taskPrompt, spectraContext }) {
  switch (tool) {
    case 'control':
      return taskPrompt;
    case 'spec-driver':
      return `请使用 spec-driver-fix workflow（specify → plan → implement → verify）完成以下任务，包括严格的 spec-driven discipline + 测试覆盖：\n\n${taskPrompt}`;
    case 'spec-driver-spectra':
      // 关键对照组：spec-driver workflow + 预先注入 spectra spec.md 作为项目理解 context
      // 测试 Spectra + Spec Driver 协同价值（"AI for AI" 叙事的真正实证）
      return `请使用 spec-driver-fix workflow（specify → plan → implement → verify）完成以下任务。**项目结构与关键 abstractions 已由 spectra 预先分析**，请充分利用以下 spec.md context 指导你的实施决策：\n\n## Spectra-generated context\n\n${spectraContext ?? '(spectra context unavailable)'}\n\n---\n\n## Task\n\n${taskPrompt}`;
    case 'superpowers':
      return `请使用 SuperPowers 框架的 brainstorm → plan → execute（含 RED/GREEN TDD）方法完成以下任务：\n\n${taskPrompt}`;
    case 'gstack':
      return `请使用 GStack 风格的 plan → build → review → test → ship 工作流完成以下任务：\n\n${taskPrompt}`;
    default:
      return taskPrompt;
  }
}

/**
 * 加载 spectra spec.md 作为 context（spec-driver-spectra 对照组用）
 * 取目标项目对应的 spec.md（micrograd / nanoGPT 在 ~/.spectra-baselines/<project>-output/spectra-full/modules/）。
 */
export function loadSpectraContext(targetSpec, maxBytes = 12000) {
  const targetName = { 'karpathy/micrograd': 'micrograd', 'karpathy/nanoGPT': 'nanoGPT', 'self-dogfood': 'self-dogfood' }[targetSpec];
  if (!targetName) return null;
  const modulesDir = path.join(os.homedir(), '.spectra-baselines', `${targetName}-output`, 'spectra-full', 'modules');
  if (!fs.existsSync(modulesDir)) return null;
  const files = fs.readdirSync(modulesDir).filter((n) => n.endsWith('.spec.md')).slice(0, 3);
  let content = '';
  for (const f of files) {
    const sample = fs.readFileSync(path.join(modulesDir, f), 'utf-8').slice(0, 4000);
    content += `### ${f}\n\n${sample}\n\n---\n\n`;
    if (content.length > maxBytes) break;
  }
  return content.slice(0, maxBytes);
}

export function findSuperPowersDir() {
  if (!fs.existsSync(SUPERPOWERS_PLUGIN_DIR)) return null;
  const entries = fs.readdirSync(SUPERPOWERS_PLUGIN_DIR);
  const match = entries.find((e) => /^superpowers/i.test(e));
  return match ? path.join(SUPERPOWERS_PLUGIN_DIR, match) : null;
}

export function buildClaudeArgs({ tool, prompt }) {
  // 注意：--add-dir / --allowed-tools 都是 variadic（<...>），把后续 prompt 吞掉。
  // 改用 cwd: wtDir 已让 claude 访问目标目录；--allowedTools 写在 plugin-dir 之前并明确分隔。
  const baseArgs = [
    '--print',
    '--model', 'claude-sonnet-4-6',
    '--output-format', 'text',
    '--permission-mode', 'acceptEdits',
  ];
  if (tool === 'superpowers') {
    const dir = findSuperPowersDir();
    if (dir) baseArgs.push('--plugin-dir', dir);
  } else if (tool === 'gstack') {
    if (fs.existsSync(GSTACK_SKILLS_DIR)) baseArgs.push('--plugin-dir', GSTACK_SKILLS_DIR);
  }
  baseArgs.push(prompt);
  return baseArgs;
}

// ============================================================
// 跑 task
// ============================================================

export function runTask({ tool, prompt, wtDir, timeoutMs }) {
  const args = buildClaudeArgs({ tool, prompt });
  const start = process.hrtime.bigint();
  // 不主动设 ANTHROPIC_API_KEY；让 claude CLI fallback 到 OAuth credentials
  // （之前设为 '' 会覆盖 OAuth 导致 401 auth error）
  const env = { ...process.env };
  if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY;
  const r = spawnSync('claude', args, {
    cwd: wtDir,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    env,
  });
  const wallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  return {
    wallMs,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status,
    timedOut: r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'),
  };
}

// ============================================================
// Oracle 验证
// ============================================================

export function runPrimaryOracle({ wtDir, oracle }) {
  // ast-diff 和 stop-condition 共享 checks 数组语义（每个 check 是 bash 命令，status=0 视为 PASS）
  if (oracle.kind === 'ast-diff' || oracle.kind === 'stop-condition') {
    let allPassed = true;
    const results = [];
    for (const cmd of oracle.checks) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wtDir, encoding: 'utf-8' });
      const passed = r.status === 0;
      if (!passed) allPassed = false;
      results.push({ cmd, passed, output: (r.stdout ?? '').slice(0, 200) });
    }
    return { kind: oracle.kind, passed: allPassed, details: results };
  } else if (oracle.kind === 'unit-test') {
    const r = spawnSync('bash', ['-c', oracle.command.replace('<workspace>', wtDir)], { cwd: wtDir, encoding: 'utf-8', timeout: 60000 });
    return { kind: 'unit-test', passed: r.status === oracle.expectedExit, details: { exitCode: r.status, stdout: (r.stdout ?? '').slice(0, 1000) } };
  }
  return { kind: oracle.kind, passed: false, details: 'unknown oracle kind' };
}

// ============================================================
// 测产物：commits / files changed
// ============================================================

export function captureProductMetrics(wtDir) {
  const commitLogR = spawnSync('git', ['-C', wtDir, 'log', '--oneline', '@{u}..HEAD', '||', 'true'], { encoding: 'utf-8', shell: true });
  const allCommitsR = spawnSync('git', ['-C', wtDir, 'log', '--oneline'], { encoding: 'utf-8' });
  const diffR = spawnSync('git', ['-C', wtDir, 'diff', '--stat', 'HEAD~1'], { encoding: 'utf-8' });
  const statusR = spawnSync('git', ['-C', wtDir, 'status', '--porcelain'], { encoding: 'utf-8' });

  const newCommits = (commitLogR.stdout ?? '').trim().split('\n').filter(Boolean).length;
  const filesChanged = (diffR.stdout ?? '').match(/(\d+)\s+files?\s+changed/);
  const uncommittedChanges = (statusR.stdout ?? '').trim().split('\n').filter(Boolean).length;

  return {
    commits: newCommits,
    filesChanged: filesChanged ? Number(filesChanged[1]) : 0,
    uncommittedChanges,
    diffStat: (diffR.stdout ?? '').slice(0, 2000),
  };
}

// ============================================================
// Fixture 组装
// ============================================================

function getGitCommit(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function readSpectraVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

export function assembleTaskFixture({ taskId, tool, taskFixture, wtDir, runResult, oracleResult, productMetrics }) {
  const nowIso = new Date().toISOString();
  const staleAfterDate = new Date(Date.now() + 6 * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      tool,
      spectraVersion: readSpectraVersion(),
      collectorVersion: COLLECTOR_VERSION,
      targetProject: taskFixture.target,
      targetCommit: taskFixture.startCommit,
      targetFileCountsByType: null,
      targetLocEstimate: null,
      spectraModuleCount: null,
      mode: 'task',
      model: 'claude-sonnet-4-6',
      runTimestampUtc: nowIso,
      runHostOs: process.platform,
      command: 'claude',
      args: ['--print', '--model', 'claude-sonnet-4-6'],
      envAllowlist: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '<redacted>' : null },
      outputDir: wtDir,
      stdoutLogPath: path.join(wtDir, 'task-runner-stdout.log'),
      stderrLogPath: path.join(wtDir, 'task-runner-stderr.log'),
      pinnedAt: nowIso,
      staleAfterDate,
      upstreamVersion: 'unknown',
      frozenFixture: ['superpowers', 'gstack'].includes(tool),
    },
    dryRun: { estimatedTokens: null, actualTokens: null, biasRatio: null },
    perf: {
      totalWallMs: runResult.wallMs,
      llmCallCount: null,
      llmCallDurationsMs: null,
      tokensInput: null, // claude --print 不返回 token usage 简单方式
      tokensOutput: null,
      tokensCacheRead: null,
      estimatedCostUsd: null,
      memoryPeakKb: null,
    },
    output: {
      graphNodeCount: null, graphEdgeCount: null, graphHyperedgeCount: 0, graphSizeBytes: null,
      specModuleCount: null, specSuccessCount: null, specSkippedCount: null, specFailedCount: null,
    },
    phases: { specGenerationMs: null, graphBuildMs: null, docsGenerationMs: null, embeddingCacheMs: null, otherMs: null, extractionMethod: 'task-execution' },
    quality: null,
    taskExecution: {
      taskId,
      tool,
      executionMode: 'non-interactive',
      wallMs: runResult.wallMs,
      tokensTotal: null,
      costUsd: null,
      userInterventions: 0,
      commits: productMetrics.commits,
      filesChanged: productMetrics.filesChanged,
      uncommittedChanges: productMetrics.uncommittedChanges,
      primaryOracle: {
        kind: oracleResult.kind,
        passed: oracleResult.passed,
        details: typeof oracleResult.details === 'string' ? oracleResult.details : JSON.stringify(oracleResult.details).slice(0, 1000),
      },
      testsPassed: null, testsFailed: null, testsBroken: null,
      rubricJudgeScore: null, // Phase 4 由 eval-judge 填
      rubricJudgeRationale: null,
      interRaterDelta: null,
      diffStat: productMetrics.diffStat,
      sonnetExitCode: runResult.exitCode,
      sonnetTimedOut: runResult.timedOut,
    },
  };
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskFixture = loadTaskFixture(args.task);

  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/tasks', args.task, args.tool);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, 'full.json');

  if (args.skipRun) {
    console.log(`[task-runner] skip-run mode: writing fixture skeleton at ${path.relative(PROJECT_ROOT, fixturePath)}`);
    const stub = assembleTaskFixture({
      taskId: args.task, tool: args.tool, taskFixture,
      wtDir: '<not-run>',
      runResult: { wallMs: null, stdout: '', stderr: '', exitCode: null, timedOut: false },
      oracleResult: { kind: taskFixture.primaryOracle.kind, passed: false, details: 'skip-run mode' },
      productMetrics: { commits: 0, filesChanged: 0, uncommittedChanges: 0, diffStat: '' },
    });
    fs.writeFileSync(fixturePath, JSON.stringify(stub, null, 2) + '\n', 'utf-8');
    console.log(`[task-runner] stub written`);
    return;
  }

  console.log(`[task-runner] task=${args.task} tool=${args.tool} timeout=${args.timeoutMs}ms`);
  const wt = prepareWorktree({
    taskId: args.task,
    tool: args.tool,
    target: taskFixture.target,
    startCommit: taskFixture.startCommit,
  });
  console.log(`[task-runner] worktree prepared: ${wt.wtDir} (branch ${wt.branchName})`);

  // 任务级 setupHook（如 T2 strip cosine LR，T3 注入 bug，T4 写 magic number，T6 violation 设置等）
  if (Array.isArray(taskFixture.setupCommands) && taskFixture.setupCommands.length > 0) {
    console.log(`[task-runner] running ${taskFixture.setupCommands.length} setup command(s)...`);
    const setupEnv = { ...process.env, SPECTRA_REPO_ROOT: PROJECT_ROOT };
    for (const cmd of taskFixture.setupCommands) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wt.wtDir, encoding: 'utf-8', env: setupEnv });
      if (r.status !== 0) {
        throw new Error(`setup command failed: ${cmd}\nstderr: ${r.stderr}`);
      }
    }
    // setup commit（让 task 起始 state 含 setup 修改，但仍是 task pre-state）
    spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: task setup'], { encoding: 'utf-8' });
  }

  // 仅 spec-driver-spectra 需要 spectra context（"AI for AI" 协同对照组）
  const spectraContext = args.tool === 'spec-driver-spectra' ? loadSpectraContext(taskFixture.target) : null;
  if (args.tool === 'spec-driver-spectra' && !spectraContext) {
    console.warn(`[task-runner] WARN: spec-driver-spectra 模式但 spectra context 不可用 (target=${taskFixture.target}); 退化为 spec-driver`);
  }
  const prompt = buildDriverPrompt({ tool: args.tool, taskPrompt: taskFixture.prompt, spectraContext });
  console.log(`[task-runner] running claude (${args.tool})...`);
  const runResult = runTask({ tool: args.tool, prompt, wtDir: wt.wtDir, timeoutMs: args.timeoutMs });
  console.log(`[task-runner] claude done: wall=${(runResult.wallMs/1000).toFixed(1)}s, exit=${runResult.exitCode}, timedOut=${runResult.timedOut}, output=${runResult.stdout.length}B`);

  // 持久化 stdout/stderr
  fs.writeFileSync(path.join(wt.wtDir, 'task-runner-stdout.log'), runResult.stdout, 'utf-8');
  fs.writeFileSync(path.join(wt.wtDir, 'task-runner-stderr.log'), runResult.stderr, 'utf-8');

  // 跑 oracle
  const oracleResult = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
  console.log(`[task-runner] oracle ${oracleResult.kind}: ${oracleResult.passed ? 'PASS' : 'FAIL'}`);

  const productMetrics = captureProductMetrics(wt.wtDir);
  console.log(`[task-runner] product: commits=${productMetrics.commits}, files=${productMetrics.filesChanged}, uncommitted=${productMetrics.uncommittedChanges}`);

  const fixture = assembleTaskFixture({
    taskId: args.task, tool: args.tool, taskFixture, wtDir: wt.wtDir,
    runResult, oracleResult, productMetrics,
  });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.log(`[task-runner] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}`);

  // Cleanup
  if (args.cleanup === 'always' || (args.cleanup === 'on-success' && oracleResult.passed)) {
    fs.rmSync(wt.wtDir, { recursive: true, force: true });
    console.log(`[task-runner] worktree cleaned up`);
  } else {
    console.log(`[task-runner] worktree retained for debug: ${wt.wtDir}`);
  }
}

const isCliEntry = process.argv[1]?.endsWith('eval-task-runner.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[task-runner] error: ${err.message}`);
    process.exit(1);
  });
}
