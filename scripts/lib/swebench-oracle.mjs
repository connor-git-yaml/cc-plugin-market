/**
 * Feature 187 — swebench-execution oracle 执行器（spec FR-001 / FR-002；plan Decision 4/11）。
 *
 * 同步 spawnSync 调官方 run_evaluation（保持 runPrimaryOracle 同步签名，7 处调用方零迁移，Codex C-5），
 * 事后对捕获日志做 phaseReached 纯函数解析 + 三分类。本模块源码摘要纳入 oracleSpecHash（Codex C-2）。
 *
 * 候选 patch 合同（Codex C-1/FR-001-e）：predictions.model_patch 必须 = candidatePatch（被评测产物），
 * 严禁用 goldPatch 顶替常规判分；details.candidatePatchSha 留审计。goldPatch 仅供显式正控场景。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { buildLocalDataset } from './swebench-dataset-build.mjs';
import { parsePhaseFromLog } from './phase-markers.mjs';
import { classifySwebenchResult } from './classify-oracle.mjs';

const MODEL_NAME = 'spectra-f187';
const DEFAULT_TIMEOUT_MS = 300_000;

const sha256 = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
const tail = (s, n = 2000) => { const t = String(s ?? ''); return t.length > n ? t.slice(-n) : t; };

/** 读 harness 产物（top-level report + per-instance report/log/test_output）。 */
function readHarnessArtifacts({ cwd, runId, instanceId }) {
  const topPath = path.join(cwd, `${MODEL_NAME}.${runId}.json`);
  const instDir = path.join(cwd, 'logs', 'run_evaluation', runId, MODEL_NAME, instanceId);
  const read = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; } };

  const top = readJson(topPath);
  const instReport = readJson(path.join(instDir, 'report.json'));
  const runLog = read(path.join(instDir, 'run_instance.log'));
  const testOutput = read(path.join(instDir, 'test_output.txt'));

  // 从 top-level id 列表推 completed / resolved（最权威）
  let completed = null;
  let resolved = null;
  let emptyPatch = false;
  if (top) {
    const inAny = (k) => Array.isArray(top[k]) && top[k].includes(instanceId);
    if (inAny('error_ids') || inAny('incomplete_ids')) { completed = false; }
    // 空 patch：候选未产出修复 = 任务未解 = candidate fail（completed 但 resolved=false），非环境故障
    else if (inAny('empty_patch_ids')) { completed = true; resolved = false; emptyPatch = true; }
    else if (inAny('completed_ids') || inAny('resolved_ids') || inAny('unresolved_ids')) { completed = true; resolved = inAny('resolved_ids'); }
  }
  // per-instance report 兜底/精化
  const instEntry = instReport && instReport[instanceId];
  if (instEntry) {
    if (typeof instEntry.resolved === 'boolean') resolved = instEntry.resolved;
    if (completed == null) completed = true;
  }
  const ts = instEntry?.tests_status || {};
  const f2p = ts.FAIL_TO_PASS || {};
  const p2p = ts.PASS_TO_PASS || {};
  return {
    report: completed == null && resolved == null ? null : { completed, resolved },
    emptyPatch,
    runLog,
    testOutput,
    patchApplied: instEntry?.patch_successfully_applied ?? null,
    failToPassExecuted: [...(f2p.success || []), ...(f2p.failure || [])],
    passToPassExecuted: [...(p2p.success || []), ...(p2p.failure || [])],
    logPath: path.join(instDir, 'run_instance.log'),
  };
}

/** 尽力清理可能残留的容器（timeout/异常时；容器名 = sweb.eval.<instanceId>.<runId>）。 */
function cleanupContainer(instanceId, runId) {
  try {
    spawnSync('docker', ['rm', '-f', `sweb.eval.${instanceId}.${runId}`], { encoding: 'utf-8', timeout: 30_000 });
  } catch { /* best-effort */ }
}

function runHarnessOnce({ datasetPath, predPath, instanceId, runId, cwd, timeoutMs, venvPath }) {
  const py = path.join(venvPath, 'bin', 'python');
  const args = ['-m', 'swebench.harness.run_evaluation',
    '--dataset_name', datasetPath, '--predictions_path', predPath,
    '--instance_ids', instanceId, '--run_id', runId, '--max_workers', '1', '--cache_level', 'env'];
  const res = spawnSync(py, args, { cwd, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = res.error && (res.error.code === 'ETIMEDOUT');
  if (timedOut) cleanupContainer(instanceId, runId);
  // spawn 自身失败（ENOENT/权限等）：surface 到 stderr，避免静默 status=null 被误判
  const spawnErr = res.error && !timedOut ? `[spawn error] ${res.error.code || ''} ${res.error.message || ''}` : '';
  return {
    harnessExitCode: typeof res.status === 'number' ? res.status : null,
    signal: res.signal || null,
    timedOut: Boolean(timedOut),
    stdout: res.stdout || '',
    stderr: [res.stderr || '', spawnErr].filter(Boolean).join('\n'),
    cmd: `${py} ${args.join(' ')}`,
  };
}

/**
 * 对单个 instance 跑真实 FAIL_TO_PASS oracle，返回统一合同 OracleResult。
 *
 * @param {object} opts
 * @param {string} opts.fixturePath    fixture 路径（取 swebenchMeta + W1 校验）
 * @param {string} opts.candidatePatch 被评测工具产出的 diff（= predictions.model_patch，FR-001-e）
 * @param {string} opts.artifactsDir   harness 产物根目录（run 隔离）
 * @param {string} opts.runId          run 标识（文件系统安全）
 * @param {number} [opts.timeoutMs]    外层超时（spawnSync timeout = watchdog）
 * @param {string} [opts.venvPath]
 * @returns {object} OracleResult（统一合同）
 */
export function runSwebenchInstance({ fixture: fixtureObj, fixturePath, candidatePatch, artifactsDir, runId, timeoutMs = DEFAULT_TIMEOUT_MS, venvPath = 'scripts/.swebench-venv' }) {
  // 接受已加载 fixture 对象（runner 集成）或 fixturePath（CLI/smoke）
  const fixture = fixtureObj || JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const instanceId = fixture.swebenchMeta.instanceId;
  const safeRunId = String(runId).replace(/[^A-Za-z0-9._-]/g, '_');
  const cwd = path.resolve(artifactsDir, safeRunId);
  fs.mkdirSync(cwd, { recursive: true });
  // venv 必须解析为绝对路径：harness 以 cwd=artifactsDir 运行，相对 venv 路径会 ENOENT（spawn 静默失败）
  const absVenv = path.resolve(venvPath);

  // 1) 合成本地 dataset（含 W1 逐字段校验；不一致 → fixture 级 error，不跑 harness）
  const datasetPath = path.join(cwd, 'dataset.json');
  const built = buildLocalDataset({ fixtures: [fixture], outPath: datasetPath, venvPath: absVenv });
  if (built.mismatches.length > 0) {
    return baseResult({ instanceId, candidatePatch, classification: 'error', failureSource: 'fixture',
      reason: `W1 字段不一致：${JSON.stringify(built.mismatches)}`, cmd: '(skipped: W1 mismatch)' });
  }

  // 2) 写 predictions（model_patch = 候选 patch，绝不用 goldPatch；FR-001-e）
  const candidatePatchSha = sha256(candidatePatch);
  const predPath = path.join(cwd, 'predictions.jsonl');
  fs.writeFileSync(predPath, JSON.stringify({ instance_id: instanceId, model_name_or_path: MODEL_NAME, model_patch: candidatePatch ?? '' }) + '\n', 'utf-8');

  // 3) 跑 harness（SIGSEGV/exit139 重试一次，E-02）
  let run = runHarnessOnce({ datasetPath, predPath, instanceId, runId: safeRunId, cwd, timeoutMs, venvPath: absVenv });
  let retried = false;
  if (run.harnessExitCode === 139 || run.signal === 'SIGSEGV') {
    retried = true;
    run = runHarnessOnce({ datasetPath, predPath, instanceId, runId: safeRunId, cwd, timeoutMs, venvPath: absVenv });
  }

  // 4) 读产物 + 解析 phase + pytest exit
  const art = readHarnessArtifacts({ cwd, runId: safeRunId, instanceId });
  const logText = [art.runLog, run.stdout, run.stderr].filter(Boolean).join('\n');
  const { phaseReached, markerMissing } = parsePhaseFromLog(logText);
  // "未收集到测试"（pytest exit 5 / E-04）精确判定：harness 已完成评分，但 fixture 期望的 failToPass
  // 一个都没被执行（success+failure 全空）= testPatch/node id 错配，非候选 PASS/FAIL 信号。
  // 不用 test_output 正则启发式（会在成功输出里误命中 → 把 pass 误判 error）。
  // 空 patch（候选未产出修复）走 report 行 10 → fail/candidate，不算"未收集到测试"的 fixture error。
  // noTestsCollected 仅在 patch 非空但 fixture 期望的 failToPass 一个都没跑（testPatch/node id 错配）时成立。
  const expectF2P = normalizeIds(fixture.swebenchMeta.failToPass);
  const noTestsCollected = !art.emptyPatch && art.report?.completed === true && expectF2P.length > 0 && art.failToPassExecuted.length === 0;
  const pytestExitCode = noTestsCollected ? 5 : null;

  // 5) 三分类
  const verdict = classifySwebenchResult({
    harnessExitCode: run.harnessExitCode, signal: run.signal, timedOut: run.timedOut,
    phaseReached, logText, report: art.report, pytestExitCode,
  });

  // 6) W1 执行集校验（SC-014）：实际跑的 failToPass 须覆盖 fixture 期望（不一致告警，不改判但记录）
  const executedF2P = normalizeIds(art.failToPassExecuted);
  const executedMatches = expectF2P.length === 0 || (executedF2P.length > 0 && expectF2P.every((x) => executedF2P.includes(x)));

  return baseResult({
    instanceId, candidatePatch, candidatePatchSha,
    classification: verdict.classification, failureSource: verdict.failureSource, reason: verdict.reason,
    harnessExitCode: run.harnessExitCode, signal: run.signal, timedOut: run.timedOut, cmd: run.cmd,
    stdoutTail: tail(run.stdout), stderrTail: tail(run.stderr),
    phaseReached, markerMissing, retried,
    report: art.report, patchApplied: art.patchApplied,
    failToPassExecuted: art.failToPassExecuted, passToPassExecuted: art.passToPassExecuted,
    executedMatches, logPath: art.logPath,
  });
}

function normalizeIds(v) {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { arr = []; } }
  return Array.isArray(arr) ? arr.map(String) : [];
}

/** 组装统一合同 OracleResult（details 结构化，不截断；FR-002）。 */
function baseResult(o) {
  const classification = o.classification;
  return {
    kind: 'swebench-execution',
    cmd: o.cmd ?? '',
    passed: classification === 'pass',
    exitCode: o.harnessExitCode ?? null,
    signal: o.signal ?? null,
    timedOut: Boolean(o.timedOut),
    classification,
    failureSource: o.failureSource,
    phaseReached: o.phaseReached ?? 'unknown',
    stdoutTail: o.stdoutTail ?? '',
    stderrTail: o.stderrTail ?? '',
    details: {
      instanceId: o.instanceId,
      candidatePatchSha: o.candidatePatchSha ?? null,
      resolved: o.report?.resolved ?? null,
      completed: o.report?.completed ?? null,
      patchApplied: o.patchApplied ?? null,
      failToPassExecuted: o.failToPassExecuted ?? [],
      passToPassExecuted: o.passToPassExecuted ?? [],
      executedMatchesFixture: o.executedMatches ?? null,
      markerMissing: Boolean(o.markerMissing),
      retried: Boolean(o.retried),
      classifyReason: o.reason ?? '',
      logPath: o.logPath ?? null,
    },
  };
}
