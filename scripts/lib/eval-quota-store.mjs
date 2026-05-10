#!/usr/bin/env node
/**
 * Feature 162 Phase C — Quota State Store + O_EXCL Lock
 *
 * 用途：
 *   为 SWE-Bench Lite 450 runs 跑批提供跨进程安全的 daily quota 计数 + 短锁
 *   reservation + partial run 四分类（finalized / partialRunning / partialStale /
 *   failedFinalized），支持中断后续跑。
 *
 * 设计要点（plan §2.3）：
 *   - reservation 阶段持锁 < 10ms，LLM spawn 期间不持锁，可并行 N 个 run
 *   - O_EXCL POSIX 文件锁；指数 backoff（50ms..1600ms / 30 retries / 30s 总超时）
 *   - 孤儿 lock 自动清理：PID 不存在 + age > 60s
 *   - partial 区分 4 类：active writer 持 lock 视为 running；started_at > 30min
 *     无 active lock 视为 stale；含 finalized_at + status='failed' 不归 partial
 *   - --accept-partial / --restart-partial 互斥（同时传入 exit 64）
 *
 * 导出：
 *   reserveQuota / acquireLock / releaseLock / acquirePerRunLock
 *   classifyRuns / checkAndCleanOrphanLock / atomicWriteJson
 *   validateAcceptRestartPartial / applyPartialDecision
 *
 * Spec / Plan：specs/162-codex-driver-glm-judge-eval/plan.md §2.3
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// ───────────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────────

export const SCHEMA_VERSION = '1.0';
export const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min
export const ORPHAN_LOCK_AGE_SEC = 60; // PID 不存在 + age > 60s 视为孤儿

const DEFAULT_BACKOFF_INITIAL_MS = 50;
const DEFAULT_BACKOFF_CAP_MS = 1600;
const DEFAULT_BACKOFF_TOTAL_CAP_MS = 30000;
const DEFAULT_BACKOFF_MAX_RETRIES = 30;

// sysexits.h
export const EX_USAGE = 64;
export const EX_CANTCREAT = 73;

// ───────────────────────────────────────────────────────────
// 工具函数
// ───────────────────────────────────────────────────────────

/** 当前 ISO 时间戳（含时区偏移） */
function nowIso() {
  return new Date().toISOString();
}

/** 当前 calendar day（YYYY-MM-DD），按指定 timezone（默认 Asia/Shanghai） */
function todayIso(timezone = 'Asia/Shanghai') {
  // 简化实现：用 Intl.DateTimeFormat 抽 year/month/day
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // 'YYYY-MM-DD'
}

/** 带 jitter 的 sleep（不阻塞 event loop） */
async function sleepWithJitter(baseMs) {
  const jitter = Math.random() * baseMs * 0.1;
  await sleep(baseMs + jitter);
}

/** 原子写 JSON：tmp + rename */
export function atomicWriteJson(targetPath, obj) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmpPath, targetPath);
}

// ───────────────────────────────────────────────────────────
// O_EXCL Lock
// ───────────────────────────────────────────────────────────

/**
 * 检测并清理孤儿 lock。
 * 返回 true 表示成功清理，调用方应重试 acquireLock。
 */
export function checkAndCleanOrphanLock(lockPath) {
  let meta = null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    meta = JSON.parse(raw);
  } catch (e) {
    // lock 文件读取/解析失败：可能正被另一进程写入；不尝试清理
    return false;
  }

  if (!meta || typeof meta.pid !== 'number') return false;

  // age 检查
  const createdAt = meta.createdAt ? new Date(meta.createdAt).getTime() : NaN;
  if (Number.isNaN(createdAt)) return false;
  const ageSec = (Date.now() - createdAt) / 1000;
  if (ageSec < ORPHAN_LOCK_AGE_SEC) return false;

  // PID 探测
  try {
    process.kill(meta.pid, 0); // signal 0：探测进程是否存在
    return false; // PID 仍在 → 真持锁
  } catch (e) {
    if (e.code === 'ESRCH') {
      // ESRCH: 进程真不存在 → 孤儿，清理
      try {
        fs.unlinkSync(lockPath);
        process.stderr.write(
          `[quota] 清理孤儿 lock: pid=${meta.pid}, age=${Math.floor(ageSec)}s, path=${lockPath}\n`,
        );
        return true;
      } catch (unlinkErr) {
        if (unlinkErr.code === 'ENOENT') return true; // 已被别人清掉
        return false;
      }
    }
    if (e.code === 'EPERM') {
      // iter-2 C-3 修复：EPERM 表示 PID 存在但跨用户无 signal 权限 → 不清理
      // 错误清理会破坏其他用户的活跃 lock；交由 acquireLock backoff + totalCapMs 兜底
      process.stderr.write(
        `[quota] EPERM 探测 pid=${meta.pid}: PID 存在但跨用户无权限，不清理 lock=${lockPath}\n`,
      );
      return false;
    }
    return false;
  }
}

/**
 * 异步获取 O_EXCL lock。
 * 失败策略：30s 总超时 → exit code 73（EX_CANTCREAT）；调用方可通过 onTimeout 选项接管行为。
 *
 * 实现注意：lock 内容为 `{ pid, createdAt, host }` JSON；持锁短期（< 10ms）；
 * 释放调用 releaseLock(lockPath) 解链。
 */
export async function acquireLock(lockPath, options = {}) {
  const {
    maxRetries = DEFAULT_BACKOFF_MAX_RETRIES,
    initialMs = DEFAULT_BACKOFF_INITIAL_MS,
    capMs = DEFAULT_BACKOFF_CAP_MS,
    totalCapMs = DEFAULT_BACKOFF_TOTAL_CAP_MS,
    onTimeout, // 默认 process.exit(73)；可注入测试 hook
  } = options;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const startedAt = Date.now();
  let delay = initialMs;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600,
      );
      const meta = { pid: process.pid, createdAt: nowIso(), host: os.hostname() };
      fs.writeSync(fd, JSON.stringify(meta));
      fs.closeSync(fd);
      return; // 成功
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
      // 检查孤儿
      if (checkAndCleanOrphanLock(lockPath)) {
        continue; // 立即重试
      }
      // 超时检查
      if (Date.now() - startedAt > totalCapMs) {
        const msg =
          `[quota] 30s 内未获 ${lockPath}\n` +
          `  解决：检查 PID 是否存在；手动 rm ${lockPath} 后重试\n`;
        if (typeof onTimeout === 'function') {
          onTimeout(msg);
          return;
        }
        process.stderr.write(msg);
        process.exit(EX_CANTCREAT);
      }
      // 退避
      await sleepWithJitter(delay);
      delay = Math.min(delay * 2, capMs);
    }
  }

  // 走完 maxRetries 仍失败
  const msg = `[quota] ${maxRetries} 次重试仍未获 ${lockPath}\n`;
  if (typeof onTimeout === 'function') {
    onTimeout(msg);
    return;
  }
  process.stderr.write(msg);
  process.exit(EX_CANTCREAT);
}

/** 释放 lock；容忍 ENOENT */
export function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

// ───────────────────────────────────────────────────────────
// Quota Store
// ───────────────────────────────────────────────────────────

/** 读 store；不存在则初始化 */
function readStoreOrInit({ storePath, feature, timezone }) {
  if (!fs.existsSync(storePath)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      feature,
      date: todayIso(timezone),
      timezone,
      runs: 0,
      run_ids: [],
      updatedAt: nowIso(),
    };
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const obj = JSON.parse(raw);
    // schemaVersion 校验（仅松检查，未来扩展）
    if (!obj || typeof obj !== 'object' || !('runs' in obj)) {
      throw new Error('quota store 结构异常');
    }
    return obj;
  } catch (err) {
    throw new Error(`quota store 解析失败: ${storePath}: ${err.message}`);
  }
}

/** 跨天 rotate：旧 store 写入 history 文件，新 store 重置计数 */
function rotateStore({ store, historyPath }) {
  if (historyPath) {
    try {
      fs.mkdirSync(path.dirname(historyPath), { recursive: true });
      const snapshot = {
        date: store.date,
        runs: store.runs,
        run_ids: store.run_ids,
        finalizedAt: nowIso(),
      };
      fs.appendFileSync(historyPath, JSON.stringify(snapshot) + '\n');
    } catch (err) {
      // history 写入失败不阻断 rotation
      process.stderr.write(`[quota] history 写入失败 ${historyPath}: ${err.message}\n`);
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    feature: store.feature,
    date: todayIso(store.timezone),
    timezone: store.timezone,
    runs: 0,
    run_ids: [],
    updatedAt: nowIso(),
  };
}

/**
 * 单次 quota reservation：短锁 + 计数 +1 + run_id append。
 *
 * 参数：
 *   { storePath, lockPath, runId, maxRunsPerDay, timezone, feature, historyPath, lockOptions }
 *
 * 返回：
 *   { reserved: true, currentRuns, maxRuns, runIds }    成功
 *   { reserved: false, reason, currentRuns, maxRuns }   失败（quota 已满 / 重复 runId）
 *
 * 持锁时长目标 < 10ms；不在锁内执行任何 IO 之外的逻辑。
 */
export async function reserveQuota({
  storePath,
  lockPath,
  runId,
  maxRunsPerDay,
  timezone = 'Asia/Shanghai',
  feature = '162',
  historyPath = null,
  lockOptions = {},
}) {
  if (!storePath || !lockPath || !runId || !Number.isInteger(maxRunsPerDay)) {
    throw new Error(
      'reserveQuota 参数缺失：需要 storePath / lockPath / runId / maxRunsPerDay (int)',
    );
  }

  await acquireLock(lockPath, lockOptions);
  try {
    let store = readStoreOrInit({ storePath, feature, timezone });
    // 跨天 rotate
    const today = todayIso(timezone);
    if (store.date !== today) {
      store = rotateStore({ store, historyPath });
    }
    // 配额检查
    if (store.runs >= maxRunsPerDay) {
      return {
        reserved: false,
        reason: 'quota_exceeded',
        currentRuns: store.runs,
        maxRuns: maxRunsPerDay,
      };
    }
    // 重复 runId 检查（idempotent：已在 list 直接返回成功，避免误增计数）
    if (store.run_ids.includes(runId)) {
      return {
        reserved: false,
        reason: 'duplicate_run_id',
        currentRuns: store.runs,
        maxRuns: maxRunsPerDay,
      };
    }
    // 增计数 + append + 原子写
    store.run_ids.push(runId);
    store.runs += 1;
    store.updatedAt = nowIso();
    atomicWriteJson(storePath, store);

    return {
      reserved: true,
      currentRuns: store.runs,
      maxRuns: maxRunsPerDay,
      runIds: store.run_ids.slice(),
    };
  } finally {
    releaseLock(lockPath);
  }
}

// ───────────────────────────────────────────────────────────
// Per-run Lock
// ───────────────────────────────────────────────────────────

/**
 * 拿一个 per-run lock（标记 active writer）。
 * 返回 { release: () => void }。
 *
 * 与 quota lock 不同：per-run lock 长期持有（覆盖 LLM spawn 周期），
 * 不能同时持 quota lock。调用顺序：reserveQuota（短锁） → acquirePerRunLock（长锁）→ run...
 */
export async function acquirePerRunLock({ runLockPath, lockOptions = {} }) {
  await acquireLock(runLockPath, lockOptions);
  return {
    release: () => releaseLock(runLockPath),
  };
}

// ───────────────────────────────────────────────────────────
// Run 四分类
// ───────────────────────────────────────────────────────────

/**
 * 扫描 runDir 中的 run-*.json，分四类：
 *   - finalized:        含 finalized_at + status='success'
 *   - partialRunning:   仅 started_at；per-run lock 存在 + active PID（writer 仍在跑）
 *   - partialStale:     仅 started_at；> 30min 阈值且无 active writer
 *   - failedFinalized:  含 finalized_at + status='failed'（含 error.phase）
 *
 * 注意：lock 文件命名约定 run-<id>.lock（与 run-<id>.json 同目录）
 *
 * iter-2 C-1 修复：加 recursive 选项。eval-mcp-augmented.mjs 实际把 run-N.json
 * 写到 RUNS_DIR/<group>/<taskId>/run-N.json（双层目录），仅扫顶层会漏掉。
 * 默认 recursive=false 保持向后兼容；recursive=true 时遍历所有子目录。
 */
export function classifyRuns({ runDir, recursive = false }) {
  const result = {
    finalized: [],
    partialRunning: [],
    partialStale: [],
    failedFinalized: [],
  };
  if (!fs.existsSync(runDir)) return result;

  // 收集 (parentDir, filename) 对：parentDir 用于正确解析 lock 同目录路径
  const entries = []; // [{ parentDir, file: 'run-x.json' }]

  const collectFromDir = (dir) => {
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      process.stderr.write(`[classify] readdir 失败 ${dir}: ${err.message}\n`);
      return;
    }
    for (const ent of dirents) {
      if (ent.isDirectory()) {
        if (recursive) {
          collectFromDir(path.join(dir, ent.name));
        }
        continue;
      }
      if (ent.isFile() && /^run-.+\.json$/.test(ent.name) && !ent.name.endsWith('.tmp')) {
        entries.push({ parentDir: dir, file: ent.name });
      }
    }
  };

  collectFromDir(runDir);

  for (const { parentDir, file: f } of entries) {
    const filePath = path.join(parentDir, f);
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      // 解析失败：当作 partial 但无 started_at；保守 skip
      process.stderr.write(`[classify] 跳过解析失败的 run 文件 ${filePath}: ${err.message}\n`);
      continue;
    }

    const runId = obj.run_id ?? f.replace(/\.json$/, '');
    const lockPath = path.join(parentDir, f.replace(/\.json$/, '.lock'));
    // 相对 runDir 的展示路径（双层目录场景便于定位）
    const relPath = path.relative(runDir, filePath) || f;

    // 已 finalized
    if ('finalized_at' in obj) {
      if (obj.status === 'failed') {
        result.failedFinalized.push({ id: runId, file: relPath, error: obj.error ?? null });
      } else {
        result.finalized.push({ id: runId, file: relPath });
      }
      continue;
    }

    // 仅有 started_at → partial
    if ('started_at' in obj) {
      const startedTs = new Date(obj.started_at).getTime();
      const ageMs = Date.now() - startedTs;
      const lockExists = fs.existsSync(lockPath);
      let writerAlive = false;
      let meta = null; // iter-3 W-7: scope 提到 try 外
      if (lockExists) {
        try {
          meta = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
          // PID 探测
          process.kill(meta.pid, 0);
          writerAlive = true;
        } catch (e) {
          // iter-2 fix（与 line 115 checkAndCleanOrphanLock 对齐）：仅 ESRCH 视为 dead；
          // EPERM = PID 存在但无权限（其他用户进程），保守视为 active 避免 restart 误删活跃 lock；
          // JSON parse / 其他 IO 错误视为 dead（lock 文件已损坏）
          if (meta == null) {
            // JSON.parse / readFileSync 失败 → lock 文件已损坏 → 视为 dead
            writerAlive = false;
            process.stderr.write(`[classify] lock 文件解析失败 ${lockPath}: ${e.message}\n`);
          } else if (e.code === 'EPERM') {
            // PID 真实存在（系统知道它）但本进程无权限 kill — 保守视为 active
            writerAlive = true;
            process.stderr.write(`[classify] PID ${meta.pid} 存在但无权限探测（EPERM），保守视为 active\n`);
          } else {
            // ESRCH (PID 不存在) 或其他错误 → dead
            writerAlive = false;
          }
        }
      }

      if (writerAlive) {
        result.partialRunning.push({ id: runId, file: relPath, pid: meta.pid });
      } else if (ageMs > STALE_THRESHOLD_MS) {
        result.partialStale.push({ id: runId, file: relPath, ageMs, lastPid: meta?.pid ?? null });
      } else {
        // 新鲜 partial 但 lock 状态不明 → 保守视为 running
        result.partialRunning.push({
          id: runId,
          file: relPath,
          pid: meta?.pid ?? 'unknown',
        });
      }
      continue;
    }

    // 既无 finalized_at 也无 started_at：异常文件，跳过
    process.stderr.write(`[classify] 跳过非 schema run 文件 ${filePath}\n`);
  }

  return result;
}

// ───────────────────────────────────────────────────────────
// --accept-partial / --restart-partial 互斥校验 + 处置
// ───────────────────────────────────────────────────────────

/**
 * 互斥 flag 校验：
 *   - 同时传入 → throw EX_USAGE (64)
 *   - 仅一个 → 返回 mode（'accept' | 'restart' | null）
 */
export function validateAcceptRestartPartial({ acceptPartial, restartPartial }) {
  if (acceptPartial && restartPartial) {
    const err = new Error(
      '--accept-partial 与 --restart-partial 互斥；同时指定不合法 (exit 64)',
    );
    err.exitCode = EX_USAGE;
    throw err;
  }
  if (acceptPartial) return 'accept';
  if (restartPartial) return 'restart';
  return null;
}

/**
 * 应用 partial 处置策略。
 *   - mode='accept'  : partialStale 视为已完成；append 到 quota.run_ids（去重）
 *   - mode='restart' : 二次 classify 确认仍 stale 后删除 run-N.json + run-N.lock
 *
 * 返回 { mode, processed: [{id, file, action}] }
 */
export function applyPartialDecision({ runDir, partialStaleList, mode, quotaStorePath }) {
  if (!mode) return { mode: null, processed: [] };
  const processed = [];

  if (mode === 'accept') {
    // append run_ids 到 quota store（调用方负责持锁）
    if (quotaStorePath && fs.existsSync(quotaStorePath)) {
      try {
        const store = JSON.parse(fs.readFileSync(quotaStorePath, 'utf-8'));
        const existingIds = new Set(store.run_ids ?? []);
        for (const p of partialStaleList) {
          if (!existingIds.has(p.id)) {
            store.run_ids.push(p.id);
            existingIds.add(p.id);
          }
        }
        store.updatedAt = nowIso();
        atomicWriteJson(quotaStorePath, store);
      } catch (err) {
        process.stderr.write(
          `[applyPartialDecision] accept 模式更新 quota 失败 ${quotaStorePath}: ${err.message}\n`,
        );
      }
    }
    for (const p of partialStaleList) {
      processed.push({ id: p.id, file: p.file, action: 'accepted' });
    }
    return { mode, processed };
  }

  if (mode === 'restart') {
    // 二次 classify 确认仍 stale 才删除（用同样的 recursive 模式以匹配 partialStaleList）
    // iter-2 C-1：partialStaleList 来自调用方 classifyRuns，可能含双层目录的相对路径，
    // 这里用 recursive=true 以确保二次 classify 同样可见
    const recheck = classifyRuns({ runDir, recursive: true });
    const stillStaleIds = new Set(recheck.partialStale.map((p) => p.id));
    for (const p of partialStaleList) {
      if (!stillStaleIds.has(p.id)) {
        processed.push({ id: p.id, file: p.file, action: 'skipped_no_longer_stale' });
        continue;
      }
      // p.file 来自 classifyRuns，可能是 'run-x.json'（顶层）或 'group/task/run-x.json'（递归）
      const jsonPath = path.join(runDir, p.file);
      const lockPath = jsonPath.replace(/\.json$/, '.lock');
      try {
        fs.unlinkSync(jsonPath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          processed.push({ id: p.id, file: p.file, action: `delete_failed:${err.code}` });
          continue;
        }
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      processed.push({ id: p.id, file: p.file, action: 'deleted' });
    }
    return { mode, processed };
  }

  return { mode, processed: [] };
}

// ───────────────────────────────────────────────────────────
// 写 run-N.json（started_at / finalized_at）
// ───────────────────────────────────────────────────────────

/**
 * 写 started_at 到 run-N.json（reservation 完成后的初始 marker）。
 */
export function writeRunStarted({ runFilePath, runId, extra = {} }) {
  const obj = {
    run_id: runId,
    started_at: nowIso(),
    ...extra,
  };
  atomicWriteJson(runFilePath, obj);
  return obj;
}

/**
 * 写 finalized_at + status='success' 到 run-N.json（含完整 perf / subAgentMeta / judge / oracle）。
 */
export function writeRunFinalizedSuccess({ runFilePath, runId, startedAt, payload }) {
  const obj = {
    run_id: runId,
    started_at: startedAt,
    finalized_at: nowIso(),
    status: 'success',
    ...payload,
  };
  atomicWriteJson(runFilePath, obj);
  return obj;
}

/**
 * 写 finalized_at + status='failed' + error 到 run-N.json（catch 兜底）。
 */
export function writeRunFinalizedFailed({ runFilePath, runId, startedAt, errorPhase, error }) {
  const obj = {
    run_id: runId,
    started_at: startedAt,
    finalized_at: nowIso(),
    status: 'failed',
    error: {
      phase: errorPhase,
      message: error?.message ?? String(error),
      stack: error?.stack ? String(error.stack).slice(0, 4000) : null,
    },
  };
  atomicWriteJson(runFilePath, obj);
  return obj;
}
