#!/usr/bin/env node
/**
 * Feature 176 — SWE-Bench Verified 5-cohort 批跑编排器（tasks T-E1）。
 *
 * 职责：入口校验（spike gate / 版本门禁 / 预注册 / 凭据）→ 跑 run 矩阵（runner CLI）
 * → fixture 归位到 Verified 路径 → oracle 三分类 → jury 质量叠加（blinding）→ 聚合。
 *
 * 用法（host shell，需 claude OAuth）：
 *   node scripts/swe-bench-verified-cohort-batch.mjs --smoke              # 5 cohort × 1 task × N=1
 *   node scripts/swe-bench-verified-cohort-batch.mjs --full               # 10 task × 5 cohort × N=3 = 150
 *   node scripts/swe-bench-verified-cohort-batch.mjs --full --resume      # 断点续跑（跳过已 finalized success）
 *   node scripts/swe-bench-verified-cohort-batch.mjs --smoke --dry-run    # 只列计划不跑
 * 选项：
 *   --skip-jury            跳过 jury（smoke 默认跳，--full 默认跑）
 *   --on-quota pause|continue   配额信号处置（默认 pause：写 checkpoint 退出，--resume 续）
 *   --quota-check-cmd "<cmd>"   每 6 runs 执行；exit!=0 视为配额告警（无则打印人工提醒）
 *   --allow-global-spectra      --full 时容忍全局 spectra plugin 存在（默认 hard-fail，见 runbook）
 *   --task <id>            smoke 指定 task（默认取预注册/fixtures 第一个）
 *
 * 复用：eval-task-runner CLI（单 run）/ eval-quota-store（状态+resume）/ swe-bench-verified-paths
 *       / spectra-version-gate / preregistration-check / cohort-aggregate / eval-judge-jury CLI。
 * 关联 spec：FR-A-006/007/007b/008b/009、FR-A-001b（oracle 三分类）、FR-B-*（聚合）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, VERIFIED_ROOT, fixturesDir, runFixturePath, aggregateDir, smokeDir } from './lib/swe-bench-verified-paths.mjs';
import { verifySpectraVersion } from './lib/spectra-version-gate.mjs';
import { checkPreregistration, parsePreregistration, readSemanticModuleShas, computeFixtureContentHash } from './lib/preregistration-check.mjs';
// C-3：静态 import（side-effect-free，与 cohort-registry.mjs 既有先例一致）→ entryValidation 保持 sync。
import { computeDriverPromptSha256 } from './eval-task-runner.mjs';
import { aggregateCohorts, COHORT_IDS } from './lib/cohort-aggregate.mjs';
import { classifyRunForRanking } from './lib/classify-oracle.mjs'; // Feature 187 C-1：error→null 剔除分母
import { COHORT_TO_TOOL } from './lib/cohort-registry.mjs'; // Feature 187 FR-004-b：cohort 映射单一来源
import { globalSpectraPluginPresent, globalSpecDriverPluginPresent } from './lib/local-spectra-plugin.mjs';
import { classifyRuns, writeRunStarted, writeRunFinalizedSuccess, writeRunFinalizedFailed, atomicWriteJson } from './lib/eval-quota-store.mjs';
import { anonymizeFixture } from './eval-judge.mjs';

const __filename = fileURLToPath(import.meta.url);
const RUNNER = path.join(PROJECT_ROOT, 'scripts', 'eval-task-runner.mjs');
const JURY = path.join(PROJECT_ROOT, 'scripts', 'eval-judge-jury.mjs');
const SPIKE_RESULT = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/spike-result.md');
const PREREG = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md');
const STATE_DIR = path.join(VERIFIED_ROOT, 'runs-state');

// cohort id → runner --tool 值：单一来源 cohort-registry.mjs（FR-004-b）。此处 re-export 保持
// 既有 import 兼容（F176 测试从本模块取 COHORT_TO_TOOL），内部用上方 import 的同一绑定。
export { COHORT_TO_TOOL };

// ───────────────────────────────────────────────────────────
// argv
// ───────────────────────────────────────────────────────────

// Feature 187（FR-006）：experiment manifest 去 F176 焊死的 ~6 处硬编码参数。manifest 未提供的字段
// 保留既有默认（向后兼容，不 break 已有跑批脚本）。
export const MANIFEST_DEFAULTS = {
  model: 'claude-opus-4-7',
  outputFormat: 'stream-json',
  cleanup: 'on-success',
  repeat: null, // null → 沿用 mode 默认（smoke=1 / full=3）
  skipJury: null, // null → 沿用 mode 默认（smoke 省 jury）
  quotaCheckInterval: 6,
  swebenchOracle: false, // 真实 FAIL_TO_PASS oracle（需 docker/venv）
  swebenchTimeoutMs: 300000,
  cohorts: null, // F188：cohort 子集（如 ["baseline-claude","spec-driver-spectra-mcp"] 跑 c1/c3 最小集）；null → 全 5。仅裁剪跑哪些组，不改任一组的设置/判分/jury（非方法论变更）。
};

/**
 * F188：解析 manifest.cohorts 为有效 cohort 子集（保持 COHORT_IDS 顺序）。
 * null/缺省 → 全 5 cohort（向后兼容）；非法 cohort id → throw（拒绝静默跑错子集）。
 */
export function resolveCohorts(manifest) {
  const requested = manifest?.cohorts;
  if (requested == null) return COHORT_IDS;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error(`manifest.cohorts 须为非空数组（如 ["baseline-claude","spec-driver-spectra-mcp"]），收到 ${JSON.stringify(requested)}`);
  }
  const invalid = requested.filter((c) => !COHORT_IDS.includes(c));
  if (invalid.length) throw new Error(`manifest.cohorts 含非法 cohort：${invalid.join(',')}；合法值：${COHORT_IDS.join(',')}`);
  return COHORT_IDS.filter((c) => requested.includes(c)); // 保持 registry 顺序
}

/** 读 experiment manifest（JSON 或 YAML），与 MANIFEST_DEFAULTS 合并。文件不存在/解析失败 → throw。 */
export function loadExperimentManifest(manifestPath) {
  if (!manifestPath) return { ...MANIFEST_DEFAULTS };
  if (!fs.existsSync(manifestPath)) throw new Error(`experiment manifest 不存在: ${manifestPath}`);
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 非 JSON → 极简 YAML（顶层 key: value，# 注释）；复杂结构请用 JSON
    parsed = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z][\w]*)\s*:\s*(.+?)\s*(?:#.*)?$/);
      if (!m) continue;
      let v = m[2].replace(/^["']|["']$/g, '');
      if (v === 'null' || v === '~') v = null; // Codex W6：识别 YAML null（否则 repeat: null 变 "null" 致 matrix=0）
      else if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (/^-?\d+$/.test(v)) v = Number(v);
      parsed[m[1]] = v;
    }
  }
  return { ...MANIFEST_DEFAULTS, ...parsed };
}

/**
 * Feature 187（C-2）：构造 live oracleSpecHash 输入 —— 判分语义模块当前源码摘要 + 运行时配置 +
 * swebench 版本（从 venv best-effort 读）。freeze 与 check 共用，保证"改判分代码→hash 变→拦截"。
 */
export function buildLiveOracleSpecInput(manifest = MANIFEST_DEFAULTS, venvPath = 'scripts/.swebench-venv') {
  // 路径锚定 PROJECT_ROOT（Codex W8：相对 cwd 会致不同目录算出不同 hash）
  const absVenv = path.isAbsolute(venvPath) ? venvPath : path.join(PROJECT_ROOT, venvPath);
  let swebenchVersion = null;
  try {
    const r = spawnSync(path.join(absVenv, 'bin', 'python'), ['-c', 'import swebench;print(swebench.__version__)'], { encoding: 'utf-8', timeout: 15000 });
    if (r.status === 0) swebenchVersion = (r.stdout || '').trim() || null;
  } catch { /* 下方 hard-fail */ }
  // Codex W8：swebench 模式必须读到确定版本，否则 oracleSpecHash 在有/无 venv 间漂移 → 误拦截或假放行
  if (!swebenchVersion) {
    throw new Error(`无法从 venv 读取 swebench 版本（${absVenv}）；swebench-execution 模式需先 bash scripts/setup-swebench-venv.sh`);
  }
  return {
    kind: 'swebench-execution',
    timeout: manifest.swebenchTimeoutMs ?? MANIFEST_DEFAULTS.swebenchTimeoutMs,
    arch: 'arm64-first',
    datasetSource: 'local-jsonl',
    swebenchVersion,
    semanticModuleShas: readSemanticModuleShas(),
  };
}

/**
 * F197 W3（Codex W-2）：计算预注册 git 外锚状态 —— 纯函数化，gitRun 可注入（默认 spawnSync 包装）便于单测。
 *   - trackedClean：tracked 文件无未提交改动（`git diff --quiet` && `git diff --cached --quiet`），
 *     忽略 gitignore 的评测产物（venv/harness 日志）。
 *   - codeMatchesFrozen：自冻结 commit 起，除 prereg 文件本身外无任何代码漂移
 *     （`git diff <frozenGitCommit> HEAD -- . ':(exclude)<preregRel>'`）。
 *     Codex W-3：必须 git exit 0 且 stdout 为空才算 match；frozen commit 不存在/歧义/git 报错（exit≠0）
 *     → NOT match → 拦截（不可因 stdout 空而误放行）。
 * @param {object} p
 * @param {string} p.projectRoot
 * @param {string} p.preregRel  PREREG 相对 projectRoot 的路径（Codex W2：绝对路径致 :(exclude) pathspec 失效）
 * @param {string|null} p.frozenGitCommit  冻结时记录的 commit；缺则 codeMatchesFrozen=true（无锚可比）
 * @param {(args: string[]) => {status: number|null, stdout: string}} [p.gitRun]
 * @returns {{ trackedClean: boolean, codeMatchesFrozen: boolean }}
 */
export function computePreregGitState({ projectRoot, preregRel, frozenGitCommit, gitRun }) {
  const run = gitRun || ((args) => {
    const r = spawnSync('git', ['-C', projectRoot, ...args], { encoding: 'utf-8' });
    return { status: typeof r.status === 'number' ? r.status : null, stdout: r.stdout || '' };
  });
  const diffClean = run(['diff', '--quiet']);
  const diffCached = run(['diff', '--cached', '--quiet']);
  const trackedClean = diffClean.status === 0 && diffCached.status === 0;
  let codeMatchesFrozen = true;
  if (frozenGitCommit) {
    const drift = run(['diff', frozenGitCommit, 'HEAD', '--', '.', `:(exclude)${preregRel}`]);
    // W-3：仅 exit 0 且 stdout 为空才 match；git 报错（exit≠0，含 commit 不存在/歧义）→ NOT match → 拦截
    codeMatchesFrozen = drift.status === 0 && (drift.stdout || '').trim() === '';
  }
  return { trackedClean, codeMatchesFrozen };
}

export function parseArgs(argv) {
  const args = {
    mode: null, // 'smoke' | 'full'
    dryRun: false, resume: false, skipJury: null,
    onQuota: 'pause', quotaCheckCmd: process.env.SPECTRA_QUOTA_CHECK_CMD ?? null,
    allowGlobalSpectra: false, task: null,
    manifestPath: null, manifest: { ...MANIFEST_DEFAULTS },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--smoke': args.mode = 'smoke'; break;
      case '--full': args.mode = 'full'; break;
      case '--dry-run': args.dryRun = true; break;
      case '--resume': args.resume = true; break;
      case '--skip-jury': args.skipJury = true; break;
      case '--on-quota': args.onQuota = argv[++i]; break;
      case '--quota-check-cmd': args.quotaCheckCmd = argv[++i]; break;
      case '--allow-global-spectra': args.allowGlobalSpectra = true; break;
      case '--task': args.task = argv[++i]; break;
      case '--manifest': args.manifestPath = argv[++i]; break;
      default: if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.mode) throw new Error('--smoke 或 --full 必选其一');
  if (!['pause', 'continue'].includes(args.onQuota)) throw new Error('--on-quota 须为 pause|continue');
  args.manifest = loadExperimentManifest(args.manifestPath); // FR-006：加载并合并默认
  // manifest.skipJury 优先；否则 --skip-jury；否则 mode 默认（smoke 省 jury）
  if (args.skipJury == null) args.skipJury = args.manifest.skipJury != null ? args.manifest.skipJury : args.mode === 'smoke';
  return args;
}

// ───────────────────────────────────────────────────────────
// 入口校验（FR-A-007b spike gate / FR-A-004b 版本门禁 / FR-A-002b 预注册 / 凭据）
// ───────────────────────────────────────────────────────────

export function readSpikeStatus(spikeResultPath = SPIKE_RESULT) {
  if (!fs.existsSync(spikeResultPath)) return null;
  const m = fs.readFileSync(spikeResultPath, 'utf-8').match(/^status:\s*(\S+)/m);
  return m ? m[1] : null;
}

function entryValidation(args) {
  const problems = [];

  // 1. spike gate：必须 PASS_SUBAGENT（synthetic 不写该文件 → 文件存在即 host 真跑过）
  const spike = readSpikeStatus();
  if (spike !== 'PASS_SUBAGENT') {
    problems.push(`spike gate 未过（spike-result status=${spike ?? '缺失'}，需 PASS_SUBAGENT）→ 先按 runbook 跑 spike（FR-A-007b）`);
  }

  // 2. 版本门禁：cohort3 的 spectra 必须是含 F177-F181 的 clean-src build
  const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  const gate = verifySpectraVersion(distCli, { allowDirty: false });
  if (!gate.ok) problems.push(`版本门禁未过: ${gate.reason}`);

  // 3. 预注册：--full 必须冻结一致；--smoke 仅提示
  const taskIds = listTaskIds(args);
  if (args.mode === 'full') {
    // Feature 187（FR-005 / C-2）+ F197（W2/W3/CRITICAL）：swebench-execution 模式下额外冻结+比对
    // oracle 语义（oracleSpecHash）、prompt 模板（promptSha256）、fixture 内容（fixtureContentHash）、
    // git 外锚（gitState）。任一漂移 → 拦截，杜绝跑前换判分/改 prompt/换 fixture/dirty worktree。
    let preregOpts = {};
    let liveOptsOk = true;
    if (args.manifest?.swebenchOracle) {
      // W2：PREREG 读盘（fs.readFileSync/parsePreregistration）+ git 外锚状态（computePreregGitState）+
      // live 指纹计算（oracleSpecInput/promptSha256/fixtureContentHash）均含读盘裸 throw 路径
      // （如 PREREG 缺失/损坏、fixture 缺失）。全部兜进 try → structured problem + 走统一 exit 2，而非顶层崩 exit 1。
      try {
        // W3：git 外锚状态（纯函数 computePreregGitState，内部 spawnSync 包装）
        const frozenGitCommit = parsePreregistration(fs.readFileSync(PREREG, 'utf-8')).gitCommit;
        const preregRel = path.relative(PROJECT_ROOT, PREREG); // 必须相对路径（绝对路径致 :(exclude) 失效）
        const gitState = computePreregGitState({ projectRoot: PROJECT_ROOT, preregRel, frozenGitCommit });
        preregOpts = {
          oracleKind: 'swebench-execution',
          oracleSpecInput: buildLiveOracleSpecInput(args.manifest),
          promptSha256: computeDriverPromptSha256(),
          fixtureContentHash: computeFixtureContentHash(taskIds, fixturesDir()),
          gitState,
        };
      } catch (e) {
        liveOptsOk = false;
        problems.push(`预注册 live 指纹计算失败: ${e.message}（检查 PREREG/fixture/prompt/manifest 是否完整）`);
      }
    }
    if (liveOptsOk) {
      const check = checkPreregistration(taskIds, PREREG, preregOpts);
      if (!check.ok) problems.push(`预注册校验未过: ${check.reason}（FR-A-002b：全量前必须冻结且一致）`);
    }
  } else if (!fs.existsSync(PREREG) || !parsePreregistration(fs.readFileSync(PREREG, 'utf-8')).frozen) {
    console.warn('[batch] ⚠️ 预注册未冻结 — smoke 可跑，但 --full 前必须冻结（FR-A-002b）');
  }

  // 4. 凭据：jury 需要 SILICONFLOW_API_KEY（.env.local）；driver 走 claude OAuth（CON-3 不查 API key）
  if (!args.skipJury) {
    const envLocal = path.join(PROJECT_ROOT, '.env.local');
    const hasKey = fs.existsSync(envLocal) && /^export SILICONFLOW_API_KEY=/m.test(fs.readFileSync(envLocal, 'utf-8'));
    if (!hasKey) problems.push('jury 需要 SILICONFLOW_API_KEY（.env.local），或 --skip-jury');
  }
  const claudeOk = spawnSync('claude', ['--version'], { encoding: 'utf-8' }).status === 0;
  if (!claudeOk) problems.push('claude CLI 不可用（driver 必需，host OAuth）');

  // 5. 全局 plugin 歧义（cohort 用 --plugin-dir 注入本地/仓内源；全局同名并存 → 加载歧义，
  //    版本审计失真，codex CRITICAL）。smoke/full 同规则：默认 hard-fail，--allow-global-spectra 显式放行
  if (globalSpectraPluginPresent() && !args.allowGlobalSpectra) {
    problems.push('全局 spectra plugin 启用 — 与 cohort3 本地 plugin 同名加载歧义（版本审计失真）。claude plugin disable spectra@cc-plugin-market --scope user 后再跑，或 --allow-global-spectra 显式放行并自担歧义');
  }
  if (globalSpecDriverPluginPresent() && !args.allowGlobalSpectra) {
    problems.push('全局 spec-driver plugin 启用 — 已发布 4.1.0 agents 是旧 namespace（无 F170a），与仓内源同名加载歧义。claude plugin disable spec-driver@cc-plugin-market --scope user 后再跑');
  }

  if (problems.length > 0) {
    console.error('[batch] 入口校验失败（hard-fail）：');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(2);
  }
  console.error(`[batch] 入口校验通过：spike=PASS_SUBAGENT / 版本门禁 ${gate.reason}`);
  return { gate };
}

// ───────────────────────────────────────────────────────────
// run 矩阵
// ───────────────────────────────────────────────────────────

function listTaskIds(args) {
  // 优先预注册冻结清单；未冻结（smoke 早期）退回 fixtures 目录扫描
  if (fs.existsSync(PREREG)) {
    const pre = parsePreregistration(fs.readFileSync(PREREG, 'utf-8'));
    if (pre.frozen && pre.taskIds.length > 0) return pre.taskIds;
  }
  const dir = fixturesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_')).map((n) => n.replace(/\.json$/, '')).sort();
}

export function buildRunMatrix(mode, taskIds, smokeTask = null, repeatOverride = null, cohortIds = COHORT_IDS) {
  // Feature 187 FR-006：manifest.repeat 覆盖 mode 默认（smoke=1 / full=3）
  const repeats = repeatOverride != null ? repeatOverride : (mode === 'smoke' ? 1 : 3);
  const tasks = mode === 'smoke' ? [smokeTask ?? taskIds[0]].filter(Boolean) : taskIds;
  if (tasks.length === 0) throw new Error('无可跑 task（先跑 Verified importer + 预注册）');
  const matrix = [];
  for (const taskId of tasks) {
    for (const cohort of cohortIds) { // F188：cohortIds 默认全 5，manifest.cohorts 可裁剪为 c1/c3 子集
      for (let r = 1; r <= repeats; r++) matrix.push({ taskId, cohort, repeatIndex: r });
    }
  }
  return matrix;
}

// ───────────────────────────────────────────────────────────
// oracle 三分类（FR-A-001b：环境不可用 ≠ 测试失败）
// ───────────────────────────────────────────────────────────

/**
 * Legacy oracle 三分类（ast-diff/fuzzy/functional），仅服务 legacy/secondary 路径（Feature 187 C-1：
 * 改名 classifyLegacyOracle，不再是排名权威）。exit 126/127 或全 check timedOut → unavailable 剔除分母。
 */
export function classifyLegacyOracle(oracleResult) {
  if (!oracleResult) return 'unavailable';
  if (oracleResult.passed === true) return 'pass';
  // fixture 落盘时 details 可能被 JSON.stringify 成字符串（assembleTaskFixture 行为）——安全解析
  let details = oracleResult.details;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch { details = []; }
  }
  if (!Array.isArray(details)) details = [];
  if (details.length > 0) {
    const envSignals = details.filter((d) => d.exitCode === 126 || d.exitCode === 127 || d.timedOut === true);
    if (envSignals.length === details.length) return 'unavailable'; // 全部是环境信号才判 unavailable（保守）
  }
  return 'fail';
}

/**
 * 排名口径的 oracle 状态（Feature 187 C-1）：
 * - swebench-execution（primaryOracle.classification 存在）→ 直接用其三分类（pass/fail/error）；
 * - legacy oracle（无 classification）→ classifyLegacyOracle（pass/fail/unavailable）。
 * 返回字符串状态；'error'/'unavailable' 都会在 oraclePassed 映射处剔除分母。
 */
export function classifyOracleState(oracleResult) {
  if (oracleResult && typeof oracleResult.classification === 'string') return oracleResult.classification;
  return classifyLegacyOracle(oracleResult);
}

/** fixture 里 oracle 结果的权威路径：taskExecution.primaryOracle（assembleTaskFixture 实际落盘位置） */
export function readOracleResult(fixture) {
  return fixture?.taskExecution?.primaryOracle ?? fixture?.taskExecution?.oracleResult ?? fixture?.oracleResult ?? null;
}

// ───────────────────────────────────────────────────────────
// 单 run 执行
// ───────────────────────────────────────────────────────────

function runOne({ taskId, cohort, repeatIndex }, args) {
  const tool = COHORT_TO_TOOL[cohort];
  const suffix = `f176r${repeatIndex}`;
  const runnerFixture = path.join(PROJECT_ROOT, 'tests/baseline/tasks', taskId, `${tool}-${suffix}`, 'full.json');
  const destFixture = runFixturePath(taskId, cohort, repeatIndex);

  // Feature 187 FR-006：model / output-format / cleanup 由 manifest 参数化（去 F176 焊死）
  const mf = args.manifest ?? MANIFEST_DEFAULTS;
  const runnerArgs = [
    RUNNER, '--task', taskId, '--tool', tool,
    '--repeat-index', String(repeatIndex),
    '--fixture-suffix', suffix,
    '--bypass-permissions', '--cleanup', mf.cleanup,
    // driver 统一参数（manifest 可覆盖 model/output-format）+ stdin（variadic 防吃）+ 真实 skill 调用
    '--model', mf.model,
    '--output-format', mf.outputFormat,
    '--prompt-via-stdin',
    '--skill-invocation',
    // Feature 187：opt-in 真实 FAIL_TO_PASS oracle（manifest swebenchOracle）
    ...(mf.swebenchOracle ? ['--swebench-oracle', '--swebench-timeout-ms', String(mf.swebenchTimeoutMs)] : []),
  ];
  if (args.dryRun) {
    console.log(`[batch][dry-run] node ${runnerArgs.map((a) => path.basename(a)).join(' ')}`);
    return { status: 'dry-run' };
  }
  console.error(`[batch] ▶ ${taskId} × ${cohort} × r${repeatIndex}`);
  // --allow-global-spectra 经 env 透传给 runner 的 cohort3 preflight（否则 runner 对全局 plugin hard-fail）
  const env = { ...process.env, ...(args.allowGlobalSpectra ? { F176_ALLOW_GLOBAL_SPECTRA: '1' } : {}) };
  const r = spawnSync('node', runnerArgs, { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['ignore', 'inherit', 'inherit'], timeout: 2400000, env });
  if (r.status !== 0 || !fs.existsSync(runnerFixture)) {
    return { status: 'broken', exitCode: r.status, reason: r.status !== 0 ? `runner exit ${r.status}` : 'fixture 未产出' };
  }
  // fixture 归位到 Verified 路径（runner 原生路径是 Lite 时代的 tasks/<task>/<tool>/）
  fs.mkdirSync(path.dirname(destFixture), { recursive: true });
  fs.copyFileSync(runnerFixture, destFixture);

  const fixture = JSON.parse(fs.readFileSync(destFixture, 'utf-8'));
  const oracleState = classifyOracleState(readOracleResult(fixture));

  // jury 质量叠加（blinding：jury 内部 anonymize；此处记 blindingHash 供审计 FR-A-008b）
  if (!args.skipJury) {
    const blindingHash = crypto.createHash('sha256').update(JSON.stringify(anonymizeFixture(fixture))).digest('hex');
    const jr = spawnSync('node', [JURY, '--fixture', destFixture], { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 600000 });
    const updated = JSON.parse(fs.readFileSync(destFixture, 'utf-8'));
    updated.meta = updated.meta ?? {};
    updated.meta.blindingHash = blindingHash;
    updated.meta.juryInvoked = jr.status === 0;
    atomicWriteJson(destFixture, updated);
    if (jr.status !== 0) console.warn(`[batch] ⚠️ jury 失败（不影响 oracle 真值）: exit ${jr.status}`);
  }
  return { status: 'success', oracleState, fixturePath: destFixture };
}

// ───────────────────────────────────────────────────────────
// 配额检查点（FR-A-009：每 6 runs；默认非交互 pause/resume）
// ───────────────────────────────────────────────────────────

function quotaCheckpoint(completedCount, args) {
  const quotaInterval = args.manifest?.quotaCheckInterval ?? 6; // FR-006：配额检查倍数可参数化
  if (completedCount === 0 || completedCount % quotaInterval !== 0) return 'ok';
  if (args.quotaCheckCmd) {
    const r = spawnSync('bash', ['-c', args.quotaCheckCmd], { encoding: 'utf-8', timeout: 60000 });
    if (r.status !== 0) {
      console.error(`[batch] 🔶 配额检查命令告警（exit ${r.status}）：${(r.stdout + r.stderr).slice(0, 200)}`);
      return args.onQuota === 'pause' ? 'pause' : 'ok';
    }
    return 'ok';
  }
  console.error(`[batch] ⏱ 已完成 ${completedCount} runs — 请人工查看 Claude Max / ChatGPT 配额 dashboard（≥60% weekly 建议 --resume 分日续跑）`);
  return 'ok';
}

// ───────────────────────────────────────────────────────────
// 聚合 + smoke 断言
// ───────────────────────────────────────────────────────────

export function loadRunRecords(taskIds, repeats, cohortIds = COHORT_IDS) {
  const records = [];
  for (const taskId of taskIds) {
    for (const cohort of cohortIds) { // F188：默认全 5；cohort 子集时只载跑过的组
      for (let r = 1; r <= repeats; r++) {
        const p = runFixturePath(taskId, cohort, r);
        if (!fs.existsSync(p)) continue;
        const fx = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const oracleState = classifyOracleState(readOracleResult(fx));
        const tokens = (fx.perf?.tokensInput ?? null) != null && (fx.perf?.tokensOutput ?? null) != null
          ? fx.perf.tokensInput + fx.perf.tokensOutput : null;
        records.push({
          cohort, taskId, repeatIndex: r,
          // Feature 187 C-1：error（swebench 环境故障）与 legacy unavailable 都剔除分母（null），
          // 不再把 error 当 oracleState!=='pass' → false 误计入 fail 分母（旧 :289 漏判）。
          oraclePassed: classifyRunForRanking({ classification: oracleState }),
          tokens,
        });
      }
    }
  }
  return records;
}

function smokeAssertions(results, matrix) {
  const broken = results.filter((x) => x.result.status !== 'success');
  const c3 = results.find((x) => x.run.cohort === 'spec-driver-spectra-mcp');
  let c3McpCalls = null;
  if (c3?.result.fixturePath && fs.existsSync(c3.result.fixturePath)) {
    const fx = JSON.parse(fs.readFileSync(c3.result.fixturePath, 'utf-8'));
    const trace = fx.perf?.mcpToolCalls ?? fx.perf?.mcpToolCallTrace ?? [];
    c3McpCalls = Array.isArray(trace) ? trace.reduce((s, t) => s + (t.callCount ?? 0), 0) : 0;
  }
  // F188（codex W1）：c3 MCP 调用断言仅在 c3 在本次 cohort 子集内时适用；排除 c3 的合法子集（如 c1/c2）
  // 不应因"无 c3 调用"误判 smoke 失败。c1/c3 子集含 c3，断言照常生效。
  const pass = broken.length === 0 && (c3 ? (c3McpCalls ?? 0) > 0 : true);
  // frontmatter 含机器可读断言字段 + source 标记（codex CRITICAL：verify 不能只看 status，
  // 需交叉核对计数；synthetic 防线 = 本文件仅由真实 batch 跑写出 + git 历史 + 人工 review）
  const body = `---
feature: 176
artifact: smoke-result
status: ${pass ? 'PASS' : 'FAIL'}
source: host(batch)
runCount: ${results.length}
brokenCount: ${broken.length}
c3McpCallCount: ${c3McpCalls ?? 'null'}
generatedAtIso: ${new Date().toISOString()}
---

# F176 smoke 结果（5 cohort × 1 task × N=1）

| 断言 | 结果 |
|------|------|
| 5/5 runs success（无 broken）| ${broken.length === 0 ? '✅' : `❌ broken=${broken.length}: ${broken.map((b) => `${b.run.cohort}(${b.result.reason ?? b.result.status})`).join('; ')}`} |
| cohort3 mcpToolCallCount > 0 | ${(c3McpCalls ?? 0) > 0 ? `✅ (${c3McpCalls})` : `❌ (${c3McpCalls ?? 'n/a'})`} |

runs: ${matrix.map((m) => `${m.taskId}×${m.cohort}`).join(', ')}
${pass ? '✅ SC-001 达成 → 解锁 --full（先冻结预注册 FR-A-002b）' : '❌ 阻断全量（FR-A-007）：修复后重跑 smoke'}
`;
  fs.mkdirSync(smokeDir(), { recursive: true });
  fs.writeFileSync(path.join(smokeDir(), 'smoke-result.md'), body, 'utf-8');
  // smoke 判定也写入 specs verification（入库侧 host 产物）
  fs.writeFileSync(path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/smoke-result.md'), body, 'utf-8');
  console.error(`[batch] smoke ${pass ? 'PASS ✅' : 'FAIL ❌'} → verification/smoke-result.md`);
  return pass;
}

// ───────────────────────────────────────────────────────────
// main
// ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { gate } = args.dryRun ? { gate: null } : entryValidation(args);
  if (args.dryRun) console.error('[batch] --dry-run：跳过入口校验的 hard-fail（仅列计划）');

  const taskIds = listTaskIds(args);
  const cohortIds = resolveCohorts(args.manifest); // F188：cohort 子集（默认全 5；c1/c3 最小集见 manifest.cohorts）
  const matrix = buildRunMatrix(args.mode, taskIds, args.task, args.manifest?.repeat, cohortIds); // FR-006：repeat 参数化
  console.error(`[batch] 计划：${matrix.length} runs（${args.mode}; cohorts=${cohortIds.length}/${COHORT_IDS.length}; jury=${args.skipJury ? 'skip' : 'on'}; resume=${args.resume}）`);
  if (args.dryRun) {
    for (const m of matrix) console.log(`[plan] ${m.taskId} × ${m.cohort} × r${m.repeatIndex}`);
    return;
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  // resume：跳过已 finalized success 的 run。注意 classifyRuns 只认 run-*.json 文件名，
  // finalized 条目的 id 来自文件内 run_id 字段（quota-store F162 合同）
  const done = new Set();
  if (args.resume) {
    const cls = classifyRuns({ runDir: STATE_DIR });
    for (const f of cls.finalized ?? []) done.add(f.id);
    console.error(`[batch] --resume：跳过 ${done.size} 个已完成 run`);
  }

  const results = [];
  let completed = 0;
  for (const run of matrix) {
    const runId = `${run.taskId}__${run.cohort}__r${run.repeatIndex}`;
    const stateFile = path.join(STATE_DIR, `run-${runId}.json`);
    if (done.has(runId)) { results.push({ run, result: { status: 'success', resumed: true } }); continue; }

    writeRunStarted({ runFilePath: stateFile, runId });
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = runOne(run, args);
    } catch (e) {
      result = { status: 'broken', reason: e.message };
    }
    if (result.status === 'success') {
      writeRunFinalizedSuccess({ runFilePath: stateFile, runId, startedAt, payload: { oracleState: result.oracleState } });
    } else {
      writeRunFinalizedFailed({ runFilePath: stateFile, runId, startedAt, errorPhase: 'run', error: result.reason ?? result.status });
    }
    results.push({ run, result });
    completed++;

    if (quotaCheckpoint(completed, args) === 'pause') {
      console.error(`[batch] ⏸ 配额暂停（--on-quota=pause）：已完成 ${completed}/${matrix.length}；隔日 \`--${args.mode} --resume\` 续跑`);
      process.exit(3);
    }
  }

  if (args.mode === 'smoke') {
    const ok = smokeAssertions(results, matrix);
    process.exit(ok ? 0 : 4);
  }

  // --full 完成：聚合（oracle-only pass rate / lift / c3_vs_c4 / token）
  const effectiveRepeats = args.manifest?.repeat ?? 3;
  const records = loadRunRecords(taskIds, effectiveRepeats, cohortIds); // F188：cohort 子集（缺组 fixture 本就跳过，显式传保口径一致）
  const agg = aggregateCohorts(records, { cohortIds }); // F188：只聚合跑过的 cohort，避免空 c2/c4/c5 统计
  fs.mkdirSync(aggregateDir(), { recursive: true });
  // taskSetHash 把 aggregate 绑回预注册（codex WARNING：防旧/手写 aggregate 纸面通过 verify）
  const { computeTaskSetHash } = await import('./lib/preregistration-check.mjs');
  atomicWriteJson(path.join(aggregateDir(), 'cohort-aggregate.json'), {
    generatedAtIso: new Date().toISOString(),
    source: 'host(batch--full)',
    spectraVersionGate: gate ? { commit: gate.meta.commit, distSha256: gate.meta.distSha256 } : null,
    taskSetHash: computeTaskSetHash(taskIds),
    // F188（codex W2）：仅 cohort 子集时附 cohortSubset 字段；全量跑不写此 key → aggregate 输出与改动前严格等价
    ...(cohortIds.length < COHORT_IDS.length ? { cohortSubset: cohortIds } : {}),
    // Codex W7：用 effective repeats（manifest.repeat 覆盖 full 默认 3）+ effective cohorts，否则 repeat/cohort 调整后报告失真
    expectedRunCount: taskIds.length * cohortIds.length * effectiveRepeats,
    runCount: records.length,
    ...agg,
  });
  console.error(`[batch] ✅ 全量完成：${records.length} run records → ${path.relative(PROJECT_ROOT, path.join(aggregateDir(), 'cohort-aggregate.json'))}`);
  console.error(`[batch] lift(c3/c1)=${agg.lift?.toFixed(3) ?? 'n/a'} | c3_vs_c4 diff=${agg.c3_vs_c4?.diff?.toFixed(3) ?? 'n/a'} | tokenRatio(c3/c1)=${agg.tokenRatioC3overC1?.toFixed(3) ?? 'n/a'}`);
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCliEntry) {
  main().catch((e) => { console.error(`[batch] error: ${e.message}`); process.exit(1); });
}
