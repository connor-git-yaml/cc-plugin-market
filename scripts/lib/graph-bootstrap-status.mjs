import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Feature 239（M9 轨道 A/B）— graph provenance 状态机。
//
// 取代 F193 的 `specs/_meta/.graph-source-commit` sidecar：sidecar 只在"本次确实从主仓 copy 了图"
// 时才写，记录的还是主仓 HEAD 而非图的真实来源 commit，本地重建路径下 provenance 必然失准。
// 本模块改为读图内嵌的 `graph.sourceCommit`（batch/watch 两类真实构建入口都会写），并把
// bootstrap 时刻的 provenance 快照落进结构化状态文件。
//
// 三条硬约束：
// - freshness **不自己判定**：spawn 全局 `spectra graph-quality --json` 复用 F217 那一份实现，
//   四态原样透传不折叠（dirty 折进 fresh 会让"图已与工作树脱节"被静默忽略）
// - 生产路径零 repo `node_modules` / 零 repo `dist/` 依赖：只用 node 内置模块 + 全局可执行文件
// - 任何异常都不得让 bash 侧（`set -euo pipefail`）中断整条 sync：写状态失败只降级为 warning

export const SCHEMA_VERSION = 1;
export const DEFAULT_DEADLINE_MS = 45000;
export const DEFAULT_GRACE_MS = 2000;
// freshness 是每次 sync 都会走的路径，必须远小于 SC-001 的 60s 预算：CLI 卡死时
// 整条 sync/hook 会被拖住（审查实证：无 deadline 的 spawnSync 会把子进程留成孤儿）。
export const DEFAULT_FRESHNESS_DEADLINE_MS = 5000;
// W5：graph.json / 历史状态文件都会被整体读入并 JSON.parse，超大或恶意文件足以 OOM
// 或长时间阻塞。读取前先 stat，超限直接判不可评估，不读入内存。
export const MAX_JSON_BYTES = 256 * 1024 * 1024;

const FRESHNESS_STATES = new Set(['fresh', 'dirty', 'stale', 'unknown-provenance']);
const ACCEPTED_FRESHNESS_EXIT_CODES = new Set([0, 1, 2]);

const STATUS_REL = path.join('specs', '_meta', 'graph-bootstrap-status.json');
const LEGACY_SIDECAR_REL = path.join('specs', '_meta', '.graph-source-commit');
const GRAPH_REL = path.join('specs', '_meta', 'graph.json');

// 大图的 --json 输出可能超过 Node 默认 1MB stdout 上限（沿用 graph-quality-core.mjs 的先例）
const MAX_SPAWN_BUFFER_BYTES = 64 * 1024 * 1024;

const INHERITABLE_SOURCES = new Set(['primary-copy', 'local-build', 'unknown']);

/**
 * 读取图内嵌的 `graph.sourceCommit`，返回三态结果。
 *
 * 三态而非 `string | null`：调用方必须能区分"字段缺失（旧格式图，仍可评估）"与"图损坏
 * （不可评估）"——后者强制 `assessable: false`。
 *
 * @param {string} graphJsonPath
 * @returns {{ ok: true, value: string | null } | { ok: false, reason: 'file-missing'|'parse-error' }}
 */
export function readEmbeddedSourceCommit(graphJsonPath) {
  let stats;
  try {
    stats = fs.statSync(graphJsonPath);
  } catch {
    return { ok: false, reason: 'file-missing' };
  }
  // W5：先看尺寸再决定要不要读——超限文件绝不进内存
  if (stats.size > MAX_JSON_BYTES) {
    return { ok: false, reason: 'graph-too-large' };
  }

  let raw;
  try {
    raw = fs.readFileSync(graphJsonPath, 'utf-8');
  } catch {
    return { ok: false, reason: 'file-missing' };
  }

  try {
    const parsed = JSON.parse(raw);
    return { ok: true, value: parsed?.graph?.sourceCommit ?? null };
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
}

/**
 * @param {string} projectRoot
 * @returns {string | null} 40 位 HEAD；非 git 目录返回 null
 */
export function resolveWorktreeHead(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const head = (result.stdout ?? '').trim();
  return head.length > 0 ? head : null;
}

/**
 * 读取上一次写入的状态文件（供"本次未改变已有图"的 rerun 继承 provenance）。
 *
 * @param {string} projectRoot
 * @returns {object | null} 文件缺失/损坏一律返回 null——历史记录不可信时按"无记录"处理
 */
export function readPreviousStatus(projectRoot) {
  const statusPath = path.join(projectRoot, STATUS_REL);
  try {
    // W5：同样先 stat——历史状态文件被撑爆时按"无记录"处理，好过阻塞或 OOM
    if (fs.statSync(statusPath).size > MAX_JSON_BYTES) return null;
    return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 四事实状态机（C4）：只依据**发生过什么事实**判定，不从"图当前存在"反推来源。
 *
 * `snapshotCopiedThisRun` 显式入参但**永不参与判定**——snapshot 的来源不得传染给 graph 字段
 * （"本次只补了 snapshot"的 rerun 会把本地构建的图误标成 primary-copy）。
 *
 * @param {{ graphCopiedThisRun: boolean, snapshotCopiedThisRun: boolean, buildAttempted: boolean,
 *           buildSucceeded: boolean, graphTargetExists: boolean, previousStatus: object | null }} facts
 * @returns {'primary-copy'|'local-build'|'none'|'unknown'}
 */
export function determineBootstrapSource({
  graphCopiedThisRun,
  buildAttempted,
  buildSucceeded,
  graphTargetExists,
  previousStatus,
}) {
  if (graphCopiedThisRun === true) return 'primary-copy';
  if (buildAttempted === true && buildSucceeded === true) return 'local-build';
  if (graphTargetExists !== true) return 'none';

  // 图已存在但本次既未 copy 也未构建 = 未改变已有图的 rerun → 原样继承历史记录
  const inherited = previousStatus?.bootstrapSource;
  return INHERITABLE_SOURCES.has(inherited) ? inherited : 'unknown';
}

/**
 * 组装 schemaVersion 1 状态对象。
 *
 * @param {{ projectRoot: string, graphCopiedThisRun: boolean, snapshotCopiedThisRun: boolean,
 *           buildAttempted: boolean, buildSucceeded: boolean }} options
 * @returns {object}
 */
export function buildStatusPayload({
  projectRoot,
  graphCopiedThisRun,
  snapshotCopiedThisRun,
  buildAttempted,
  buildSucceeded,
}) {
  const graphJsonPath = path.join(projectRoot, GRAPH_REL);
  const graphTargetExists = fs.existsSync(graphJsonPath);
  const embedded = readEmbeddedSourceCommit(graphJsonPath);

  const bootstrapSource = determineBootstrapSource({
    graphCopiedThisRun,
    snapshotCopiedThisRun,
    buildAttempted,
    buildSucceeded,
    graphTargetExists,
    previousStatus: readPreviousStatus(projectRoot),
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    bootstrapSource,
    embeddedSourceCommitAtBootstrap: embedded.ok ? embedded.value : null,
    worktreeHeadAtBootstrap: resolveWorktreeHead(projectRoot),
    generatedAt: new Date().toISOString(),
    // 图不存在或图损坏时这份快照不足以支撑任何 provenance 判断
    assessable: bootstrapSource !== 'none' && embedded.ok === true,
  };
}

/**
 * 原子写状态文件 + 迁移性删除遗留 sidecar。
 *
 * temp 名带 pid + 随机片段（W1）：复用 `${path}.tmp` 固定命名会让并发 writer 互相踩 tmp
 * （后写者覆盖共享 tmp，或对已被 rename 走的 tmp 再 rename 而 ENOENT）。
 *
 * @param {string} projectRoot
 * @param {object} payload
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ written: boolean, statusPath: string, warnings: string[], removedLegacySidecar: boolean }}
 */
export function writeBootstrapStatus(projectRoot, payload, { dryRun = false } = {}) {
  const statusPath = path.join(projectRoot, STATUS_REL);
  const legacySidecarPath = path.join(projectRoot, LEGACY_SIDECAR_REL);
  const warnings = [];
  const plan = [];

  // W3：判存一律用 lstat——existsSync 对 broken symlink 返回 false，会让一个
  // 指向不存在目标的遗留 sidecar symlink 永远清理不掉。
  const legacySidecarPresent = (() => {
    try {
      fs.lstatSync(legacySidecarPath);
      return true;
    } catch {
      return false;
    }
  })();

  if (dryRun) {
    // W4：dry-run 下 payload 是按"尚未发生的 copy"推算出来的（例如 graphCopiedThisRun=true
    // 但图其实没被复制），与真实执行会产生的对象不等价。因此**不再声称打印最终状态对象**，
    // 只报告将要执行的操作计划。
    plan.push(`[dry-run] 拟写状态文件: ${statusPath}`);
    if (legacySidecarPresent) plan.push(`[dry-run] 拟删除遗留 sidecar: ${legacySidecarPath}`);
    for (const line of plan) process.stdout.write(`${line}\n`);
    return { written: false, statusPath, warnings, removedLegacySidecar: false, plan };
  }

  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const tmpPath = `${statusPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  let renamed = false;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
    fs.renameSync(tmpPath, statusPath);
    renamed = true;
  } finally {
    // W3：rename 失败（目标不可替换、只读目录等）会留下随机命名的 tmp 残渣，
    // 且因为名字唯一，下次运行也不会覆盖它——必须在 finally 里兜底清理。
    if (!renamed) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // tmp 本就没创建成功，忽略
      }
    }
  }

  // 迁移性删除必须在新状态文件**成功落盘之后**，避免"新文件没写成、旧 sidecar 先没了"的中间态
  let removedLegacySidecar = false;
  if (legacySidecarPresent) {
    try {
      fs.unlinkSync(legacySidecarPath);
      removedLegacySidecar = true;
    } catch (error) {
      warnings.push(
        `遗留 sidecar 删除失败（不影响主流程）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { written: true, statusPath, warnings, removedLegacySidecar, plan };
}

/** 对整个进程组发信号；进程组已消亡属正常竞态，静默忽略。 */
function killProcessGroup(pid, signal) {
  if (typeof pid !== 'number') return;
  try {
    process.kill(-pid, signal);
  } catch {
    // 已退出/已回收
  }
}

/**
 * 共享的有界子进程执行器（C5）。
 *
 * freshness 与本地构建都必须在**有界时间**内收口，且都要能清掉子进程派生的孙进程，
 * 因此抽成同一份实现——两份各自维护的 deadline 逻辑迟早会漂移（其中一份就曾完全没有 deadline）。
 *
 * 关键点：
 * - `detached: true` 让子进程成为独立进程组组长，`kill(-pid)` 覆盖整组
 * - deadline 到期先 TERM，grace 后再 KILL（TERM 可被忽略，KILL 不能）
 * - 参数一律以数组元素传入，杜绝 §M10 那种"空格被 shell 拆分成另一个子命令"的事故
 *
 * @param {{ command: string, args: string[], cwd: string, deadlineMs: number, graceMs: number,
 *           captureStdout: boolean }} options
 * @returns {Promise<{ status: number|null, signal: string|null, stdout: string, timedOut: boolean,
 *                     spawnError: (Error & { code?: string })|null, pid: number|undefined }>}
 */
function runBoundedProcess({ command, args, cwd, deadlineMs, graceMs, captureStdout }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        detached: true,
        stdio: captureStdout ? ['ignore', 'pipe', 'ignore'] : 'ignore',
      });
    } catch (error) {
      resolve({ status: null, signal: null, stdout: '', timedOut: false, spawnError: error, pid: undefined });
      return;
    }

    const childPid = child.pid;
    let stdout = '';
    let stdoutBytes = 0;
    if (captureStdout && child.stdout) {
      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (chunk) => {
        // 与 graph-quality-core.mjs 同样的理由：大图 --json 输出可能很大，但也不能无上限
        if (stdoutBytes >= MAX_SPAWN_BUFFER_BYTES) return;
        stdoutBytes += Buffer.byteLength(chunk, 'utf-8');
        stdout += chunk;
      });
      child.stdout.on('error', () => {
        // 子进程被 KILL 时管道可能提前断开，不影响结论
      });
    }

    let timedOut = false;
    let killTimer = null;
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(childPid, 'SIGTERM');
      killTimer = setTimeout(() => killProcessGroup(childPid, 'SIGKILL'), graceMs);
    }, deadlineMs);

    const finish = (outcome) => {
      clearTimeout(deadlineTimer);
      if (killTimer !== null) clearTimeout(killTimer);
      resolve({ pid: childPid, ...outcome });
    };

    child.on('error', (error) =>
      finish({ status: null, signal: null, stdout, timedOut, spawnError: error }),
    );
    child.on('close', (code, signal) => {
      if (timedOut) {
        // 超时路径：再补一次组 KILL，收拾"直接子进程已退出但孙进程仍在"的残留
        killProcessGroup(childPid, 'SIGKILL');
      }
      finish({ status: code, signal, stdout, timedOut, spawnError: null });
    });
  });
}

/**
 * freshness 薄 adapter：spawn 全局 `spectra graph-quality --json`，四态原样透传。
 *
 * 参数**必须**以数组元素形式传入：`spectra graph quality --help`（多一个空格）曾被解析成
 * `spectra graph` 并静默把 6079 节点的图覆写成 2 节点（§M10 事故），拼接字符串再交 shell 拆分
 * 是该事故的根因形态。
 *
 * @param {string} projectRoot
 * @param {{ graphJsonPath: string, spectraBin?: string }} options
 * @returns {{ state: string, recordedSourceCommit?: string|null, currentHead?: string|null, reason?: string }}
 */
export async function checkFreshness(
  projectRoot,
  {
    graphJsonPath,
    spectraBin = 'spectra',
    deadlineMs = DEFAULT_FRESHNESS_DEADLINE_MS,
    graceMs = DEFAULT_GRACE_MS,
  },
) {
  const result = await runBoundedProcess({
    command: spectraBin,
    args: ['graph-quality', '--json', '--graph', graphJsonPath],
    cwd: projectRoot,
    deadlineMs,
    graceMs,
    captureStdout: true,
  });

  if (result.spawnError) {
    const missing = result.spawnError.code === 'ENOENT';
    return {
      state: 'unknown-provenance',
      reason: missing ? 'spectra-cli-missing' : 'spawn-error',
      detail: result.spawnError.message,
    };
  }

  // C5：CLI 卡死不得拖垮整条 sync
  if (result.timedOut) {
    return { state: 'unknown-provenance', reason: 'freshness-timeout' };
  }

  // W2：接受面收窄——签发结论前先确认这次调用本身是"正常完成"的。
  // 旧实现只要 stdout 能解析出字符串 state 就原样透传，于是 exit 3、被信号杀死、
  // 甚至 state 为任意未来/恶意值都会被当成权威判定。
  if (result.signal !== null) {
    return { state: 'unknown-provenance', reason: 'killed-by-signal', detail: result.signal };
  }
  if (!ACCEPTED_FRESHNESS_EXIT_CODES.has(result.status)) {
    return { state: 'unknown-provenance', reason: 'unexpected-exit-code', detail: result.status };
  }

  // CLI 契约：pass/pass-with-warnings=0、fail-strong-invariant=1、cannot-assess=2，
  // 三者都会先输出完整 JSON——因此 0/1/2 都先取 stdout 解析（同 graph-quality-core.mjs）
  let report;
  try {
    report = JSON.parse(result.stdout ?? '');
  } catch {
    return { state: 'unknown-provenance', reason: 'unparseable-output' };
  }

  const freshness = report?.freshness;
  if (!freshness || typeof freshness.state !== 'string') {
    return { state: 'unknown-provenance', reason: 'freshness-missing' };
  }
  if (!FRESHNESS_STATES.has(freshness.state)) {
    // 回传原始值，供 sync 侧 warning 打印"收到了什么"，便于排查 CLI 版本漂移
    return {
      state: 'unknown-provenance',
      reason: 'unknown-state',
      receivedState: freshness.state,
    };
  }

  return {
    state: freshness.state,
    recordedSourceCommit: freshness.recordedSourceCommit ?? null,
    currentHead: freshness.currentHead ?? null,
  };
}

/**
 * 本地构建兜底：异步 spawn + 独立进程组 + deadline TERM→grace→KILL。
 *
 * 不用 `spawnSync(timeout)`：实测（Node v24 / darwin）子进程忽略 SIGTERM 时实际耗时可达超时值的
 * 10 倍，且子进程派生的孙进程不随之消亡——两者都会突破 SC-001 的 60 秒预算或留下继续写
 * `graph.json` 的孤儿进程。`detached: true` 让子进程成为独立进程组组长，`kill(-pid)` 覆盖整组。
 *
 * @param {{ projectRoot: string, spectraBin?: string, deadlineMs?: number, graceMs?: number }} options
 * @returns {Promise<{ ok: boolean, reason?: string, code?: number|null, signal?: string|null }>}
 */
export async function attemptLocalGraphBuild({
  projectRoot,
  spectraBin = 'spectra',
  deadlineMs = DEFAULT_DEADLINE_MS,
  graceMs = DEFAULT_GRACE_MS,
}) {
  const startedAt = Date.now();
  const result = await runBoundedProcess({
    command: spectraBin,
    args: ['batch', '--mode', 'graph-only'],
    cwd: projectRoot,
    deadlineMs,
    graceMs,
    captureStdout: false,
  });

  if (result.spawnError) {
    return { ok: false, reason: 'spawn-error', detail: result.spawnError.message };
  }
  if (result.timedOut) {
    return { ok: false, reason: 'timeout' };
  }
  if (result.status !== 0) {
    return { ok: false, reason: 'non-zero-exit', code: result.status, signal: result.signal };
  }

  // C4：直接子进程 exit 0 **不等于**构建成功。审查用 `/usr/bin/true` 复现过：图根本不存在，
  // 却被记成 bootstrapSource=local-build。成功必须同时满足三条：产物是常规文件、JSON 可解析、
  // 含 graph.sourceCommit（最小可查询性）。
  //
  // 另一种真实形态是 launcher 秒退、后台 worker 仍在写图，因此产物未就绪时按剩余 deadline
  // 轮询等待，而不是立刻判失败。
  const graphJsonPath = path.join(projectRoot, GRAPH_REL);
  const deadlineAt = startedAt + deadlineMs;
  let verdict = inspectBuiltGraph(graphJsonPath);
  while (!verdict.ok && Date.now() < deadlineAt) {
    await delay(Math.min(200, Math.max(0, deadlineAt - Date.now())));
    verdict = inspectBuiltGraph(graphJsonPath);
  }

  // 无论产物是否就绪，都清一次进程组：父进程已退出，此处只会命中残留的后台 worker
  killProcessGroup(result.pid, 'SIGKILL');

  return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 构建产物的最小可查询性检查（C4）。
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function inspectBuiltGraph(graphJsonPath) {
  let stats;
  try {
    stats = fs.lstatSync(graphJsonPath);
  } catch {
    return { ok: false, reason: 'graph-missing-after-build' };
  }
  if (!stats.isFile()) return { ok: false, reason: 'graph-missing-after-build' };
  if (stats.size > MAX_JSON_BYTES) return { ok: false, reason: 'graph-unparsable' };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
  } catch {
    return { ok: false, reason: 'graph-unparsable' };
  }
  if (typeof parsed?.graph?.sourceCommit !== 'string' || parsed.graph.sourceCommit.length === 0) {
    return { ok: false, reason: 'graph-not-queryable' };
  }
  return { ok: true };
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = 'true';
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

const isTrue = (value) => value === 'true';

/**
 * CLI 入口：write-status / check-freshness / attempt-build 三个子命令。
 *
 * @param {string[]} argv
 * @returns {Promise<number>} 进程退出码
 */
export async function main(argv) {
  const [subcommand, ...rest] = argv;
  const flags = parseFlags(rest);
  const projectRoot = flags['project-root'] ?? process.cwd();

  if (subcommand === 'write-status') {
    // 任何内部异常都必须收敛为退出码，绝不让未捕获异常冒泡——bash 侧 set -e 会中断整条 sync
    try {
      const payload = buildStatusPayload({
        projectRoot,
        graphCopiedThisRun: isTrue(flags['graph-copied']),
        snapshotCopiedThisRun: isTrue(flags['snapshot-copied']),
        buildAttempted: isTrue(flags['build-attempted']),
        buildSucceeded: isTrue(flags['build-succeeded']),
      });
      const outcome = writeBootstrapStatus(projectRoot, payload, {
        dryRun: isTrue(flags['dry-run']),
      });
      for (const warning of outcome.warnings) process.stderr.write(`${warning}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(
        `状态文件写入失败：${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }

  if (subcommand === 'check-freshness') {
    const verdict = await checkFreshness(projectRoot, {
      graphJsonPath: flags.graph ?? path.join(projectRoot, GRAPH_REL),
      spectraBin: flags['spectra-bin'] ?? 'spectra',
      deadlineMs: Number(flags['deadline-ms'] ?? DEFAULT_FRESHNESS_DEADLINE_MS),
      graceMs: Number(flags['grace-ms'] ?? DEFAULT_GRACE_MS),
    });
    // 紧凑 JSON：bash 侧按固定形态提取 state 字段
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    return 0;
  }

  if (subcommand === 'attempt-build') {
    const outcome = await attemptLocalGraphBuild({
      projectRoot,
      spectraBin: flags['spectra-bin'] ?? 'spectra',
      deadlineMs: Number(flags['deadline-ms'] ?? DEFAULT_DEADLINE_MS),
      graceMs: Number(flags['grace-ms'] ?? DEFAULT_GRACE_MS),
    });
    if (outcome.ok) return 0;
    process.stdout.write(`reason: ${outcome.reason}\n`);
    return 1;
  }

  process.stderr.write(`未知子命令: ${subcommand ?? '(空)'}\n`);
  return 2;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`graph-bootstrap-status 内部错误：${String(error)}\n`);
      process.exitCode = 1;
    });
}
