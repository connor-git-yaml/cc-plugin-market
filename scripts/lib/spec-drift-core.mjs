/**
 * Spec Drift —— 顶层门面（plan §6.2：唯一横向协调点）。
 *
 * 对外四个操作：`linkReferences` / `checkAnchors` / `unlinkAnchor` / `validateSpecDrift`
 * （最后一个是 `repo:check` 第 13 检查族契约，C2）。
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
  STATE_MATRIX,
  PACKAGE_ROOT,
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
  // W-1：lock-corrupt 与空 lock 两条早退分支 MUST 同样经由 buildReport 产出
  // 全零固定键 summary（FR-015）。手工覆盖成 `summary: {}` 会让消费方在这两条
  // 分支上读不到状态键，被迫写"空 lock 特判"分支。
  if (lock.corrupt) return lockCorruptResult('check', lock.reason);
  if (lock.anchors.length === 0) {
    return { command: 'check', ok: true, ...buildReport({ anchors: [] }), results: [] };
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

/**
 * `repo:check` 子检查项的形状，与 repo-maintenance-core.mjs::createCheck 保持一致
 * （字段名 `status`，被 namespaceCheck 加 `spec-drift:` 前缀后进入 checks[]）。
 */
function createCheck(id, title, status, evidence) {
  return { id, title, status, evidence };
}

/**
 * `repo:check` 第 13 检查族（FR-006/007/008，plan §11.3）。
 *
 * 三段式契约（照抄 F217 第 12 族）：lock-corrupt 恒 fail → 空锚 pass →
 * **先 report 级、后 anchor 级**判定。
 *
 * ⚠️ 本函数体内所有异步操作（动态 import / analyzeFiles）均已被 `await` 展开，
 * 返回值是一个已完成的普通对象；调用方 MUST 同样 `await`——否则 `aggregateValidation`
 * 拿到未展开的 Promise，`result.warnings ?? []` 会退化为空数组造成静默假通过（FR-008）。
 */
export async function validateSpecDrift({ projectRoot, strict = false, distRoot = PACKAGE_ROOT }) {
  const lockPath = path.join(projectRoot, DEFAULT_LOCK_RELPATH);
  const lock = readLock(lockPath);

  // (1) lock 损坏恒 fail，不受 strict 影响（FR-007）
  if (lock.corrupt) {
    return {
      status: 'fail',
      checks: [
        createCheck('lock-integrity', 'spec drift lock 可解析且 schema 兼容', 'fail', {
          machineCode: STATE_MATRIX['lock-corrupt'].machineCode,
          degraded: true,
          reason: lock.reason,
          nextStep: STATE_MATRIX['lock-corrupt'].nextStep,
        }),
      ],
      warnings: [],
      errors: [`lock 文件损坏：${lock.reason}`],
    };
  }

  // (2) 无锚 → pass，不产生噪声
  if (lock.anchors.length === 0) {
    return {
      status: 'pass',
      checks: [
        createCheck('anchors-status', 'spec drift 锚点全部 fresh', 'pass', {
          anchorCount: 0,
          nonFreshCount: 0,
          summary: summarize([]),
          exitCode: 0,
        }),
      ],
      warnings: [],
      errors: [],
    };
  }

  const report = await checkAnchorsInternal(lock.anchors, { projectRoot, distRoot });
  // 严重度提升单一定义（FR-007）：strict 把"非 fresh 且非 lock-corrupt"统一从 warn 提到 error。
  const severity = strict ? 'error' : 'warn';

  // (3) report 级状态 MUST 先于 anchor 级处理（C-5）。
  // graph-unavailable 不属于任何单条 anchor：只遍历 report.anchors 时 nonFresh 可能为空，
  // 整体会误贡献 pass。也 MUST NOT 把它伪造进每条 anchor 绕过（违反状态矩阵的作用域定义）。
  if (report.reportStatus !== undefined && report.reportStatus !== 'ok') {
    const meta = STATE_MATRIX[report.reportStatus];
    const message = `${report.reportStatus}：${report.reason ?? ''}（${report.nextStep ?? meta?.nextStep ?? ''}）`;
    return {
      status: strict ? 'fail' : 'warn',
      checks: [
        createCheck('analysis-environment', 'spec drift AST 分析环境可用', strict ? 'fail' : 'warn', {
          reportStatus: report.reportStatus,
          machineCode: report.machineCode ?? meta?.machineCode,
          degraded: true,
          reason: report.reason,
          nextStep: report.nextStep ?? meta?.nextStep,
        }),
      ],
      warnings: severity === 'error' ? [] : [message],
      errors: severity === 'error' ? [message] : [],
    };
  }

  // (4) anchor 级判定
  const nonFresh = (report.anchors ?? []).filter((anchor) => anchor.status !== 'fresh');
  const messages = nonFresh.map(
    (anchor) => `锚 ${anchor.id}（${anchor.symbolId ?? anchor.ref}）状态 ${anchor.status}：${anchor.reason ?? ''}`,
  );

  // W-3：子 check 的 status 必须随 strict 变化，不得恒为 'warn'——否则外部消费 checks[]
  // 的工具会看到"子检查 warn 但整体 fail"的自相矛盾结果。
  const checkStatus = nonFresh.length === 0 ? 'pass' : severity === 'error' ? 'fail' : 'warn';

  return {
    status: checkStatus,
    checks: [
      createCheck('anchors-status', 'spec drift 锚点全部 fresh', checkStatus, {
        summary: report.summary,
        exitCode: report.exitCode,
        anchorCount: report.anchors.length,
        nonFreshCount: nonFresh.length,
      }),
    ],
    warnings: severity === 'error' ? [] : messages,
    errors: severity === 'error' ? messages : [],
  };
}
