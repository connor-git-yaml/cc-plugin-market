/**
 * Spec Drift —— 顶层门面（plan §6.2：唯一横向协调点）。
 *
 * 对外三个操作：`linkReferences` / `checkAnchors` / `unlinkAnchor`。
 * `validateSpecDrift`（`repo:check` 第 13 检查族契约）属 C2 阶段（T023），本文件暂不实现。
 *
 * 依赖方向：core → lock-io / resolve / check（均不反向 import core）。
 */
import path from 'node:path';

import { readLock, writeLockAtomic, createEmptyLock } from './spec-drift-lock-io.mjs';
import { parseManifest, resolveReferences } from './spec-drift-resolve.mjs';
import {
  checkAnchors as checkAnchorsInternal,
  buildReport,
  summarize,
  computeReportExitCode,
  STATE_MATRIX,
} from './spec-drift-check.mjs';

export const DEFAULT_LOCK_RELPATH = path.join('.specify', 'spec-drift.lock.json');

/** lock 条目的十项字段（顺序即写入顺序，便于 diff 稳定） */
function toAnchorRecord(result) {
  return {
    id: result.id,
    ref: result.ref,
    docPath: result.docPath,
    line: result.line,
    symbolId: result.symbolId,
    fingerprint: result.fingerprint,
    fingerprintVersion: result.fingerprintVersion,
    normalizationProfile: result.normalizationProfile,
    resolvedFrom: result.resolvedFrom,
    matchKind: result.matchKind,
  };
}

function lockCorruptResult(command, reason) {
  const report = buildReport({ reportStatus: 'lock-corrupt', reason });
  return { command, ok: false, ...report, results: [] };
}

function operationalFailure(command, reason, detail) {
  return {
    command,
    ok: false,
    exitCode: 2,
    reportStatus: 'ok',
    degraded: false,
    reason: detail ? `${reason}：${detail}` : reason,
    results: [],
    summary: summarize([]),
  };
}

/**
 * `drift link` / `drift link --refresh`（FR-002）。
 *
 * 原子批处理：内存中累积全部条目结果后**一次性** writeLockAtomic，不留半成品。
 */
export async function linkReferences({
  projectRoot,
  distRoot,
  manifestPath,
  lockPath,
  refresh = false,
  id = null,
}) {
  if (!manifestPath) {
    return operationalFailure('link', 'link 需要 --manifest <path>');
  }
  const lock = readLock(lockPath);
  if (lock.corrupt) return lockCorruptResult('link', lock.reason);

  const manifest = parseManifest(manifestPath);
  if (!manifest.ok) return operationalFailure('link', manifest.reason, manifest.detail);

  const existingById = Object.fromEntries(lock.anchors.map((a) => [a.id, a]));

  let entries = manifest.entries;
  if (id !== null) entries = entries.filter((e) => e.id === id);
  if (entries.length === 0) {
    return operationalFailure('link', `manifest 中没有匹配的条目${id === null ? '' : `（--id ${id}）`}`);
  }

  if (refresh) {
    // refresh 的语义是"重刷既有锚"，MUST NOT 顺带新增。放行不存在的 id 会让一次拼错的
    // --refresh 静默建出一条谁都没打算建的锚。
    const missing = entries.filter((e) => existingById[e.id] === undefined).map((e) => e.id);
    if (missing.length > 0) {
      return operationalFailure(
        'link',
        `--refresh 只能刷新 lock 中已存在的锚，以下 id 不存在（如需新增请去掉 --refresh）：${missing.join(', ')}`,
      );
    }
  } else {
    const duplicated = entries.filter((e) => existingById[e.id] !== undefined).map((e) => e.id);
    if (duplicated.length > 0) {
      return operationalFailure(
        'link',
        `以下 id 已存在于 lock，刷新请显式加 --refresh：${duplicated.join(', ')}`,
      );
    }
  }

  const resolved = await resolveReferences(entries, { projectRoot, distRoot, refresh, existingById });
  if (resolved.reportStatus !== 'ok') {
    const meta = STATE_MATRIX[resolved.reportStatus];
    return {
      command: 'link',
      ok: false,
      exitCode: meta.exitCode,
      reportStatus: resolved.reportStatus,
      machineCode: meta.machineCode,
      degraded: meta.degraded,
      nextStep: meta.nextStep,
      reason: resolved.reason,
      results: [],
    };
  }

  const results = resolved.results.map((r) => ({
    ...r,
    machineCode: STATE_MATRIX[r.status === 'ok' ? 'fresh' : r.status].machineCode,
    nextStep: STATE_MATRIX[r.status === 'ok' ? 'fresh' : r.status].nextStep,
  }));

  // 只有解析成功（或 refresh 时保留了刷新前基线）的条目才落 lock——
  // 半成品条目缺 symbolId/fingerprint，写进去会被 lock 校验判 lock-corrupt。
  const persistable = results.filter((r) => r.symbolId !== null && r.fingerprint !== null);
  const nextById = new Map(lock.anchors.map((a) => [a.id, a]));
  for (const result of persistable) nextById.set(result.id, toAnchorRecord(result));

  const nextLock = { ...createEmptyLock(), anchors: [...nextById.values()] };
  writeLockAtomic(lockPath, nextLock);

  const failed = results.filter((r) => r.status !== 'ok');
  return {
    command: 'link',
    ok: failed.length === 0,
    exitCode: failed.length === 0 ? 0 : 2,
    reportStatus: 'ok',
    results,
    summary: {
      total: results.length,
      linked: persistable.length,
      failed: failed.length,
    },
  };
}

/**
 * `drift check`（FR-004/005）。lock 损坏恒 exit 3；无锚视为 exit 0。
 */
export async function checkAnchors({ projectRoot, distRoot, lockPath }) {
  const lock = readLock(lockPath);
  if (lock.corrupt) {
    return { ...lockCorruptResult('check', lock.reason), anchors: [], summary: {} };
  }
  if (lock.anchors.length === 0) {
    const empty = { reportStatus: 'ok', degraded: false, anchors: [], summary: {} };
    return { command: 'check', ok: true, exitCode: computeReportExitCode(empty), ...empty };
  }

  const report = await checkAnchorsInternal(lock.anchors, { projectRoot, distRoot });
  return { command: 'check', ok: report.exitCode === 0, ...report };
}

/**
 * `drift unlink <id>`（FR-002）：按 id 精确删除，不接受 ref/docPath 反查。
 */
export function unlinkAnchor({ lockPath, id }) {
  if (!id) return operationalFailure('unlink', 'unlink 需要位置参数 <id>');

  const lock = readLock(lockPath);
  if (lock.corrupt) return lockCorruptResult('unlink', lock.reason);

  const remaining = lock.anchors.filter((a) => a.id !== id);
  if (remaining.length === lock.anchors.length) {
    return operationalFailure('unlink', `lock 中不存在 id "${id}"`);
  }

  writeLockAtomic(lockPath, { ...createEmptyLock(), anchors: remaining });
  return {
    command: 'unlink',
    ok: true,
    exitCode: 0,
    reportStatus: 'ok',
    removedId: id,
    results: [],
    summary: { removed: 1, remaining: remaining.length },
  };
}
