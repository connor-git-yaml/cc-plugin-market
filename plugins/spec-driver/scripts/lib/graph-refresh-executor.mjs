// Feature 241（M9 轨道 B4）— 刷新执行层（FR-007）。
//
// 这一层刻意做得很薄：唯一职责是把 F239 `attemptLocalGraphBuild` 的 `reason` 映射到
// `DEGRADED_REASONS` 的四个 `refresh-failed-*` 值，并记一次墙钟耗时。
//
// **不在这里重实现任何 spawn / deadline / 进程组清理 / 产物校验逻辑**（D8 硬约束）。
// F239 的源码注释已写明「两份各自维护的 deadline 逻辑迟早会漂移」，且历史上其中一份就完全
// 没有 deadline。单测用静态断言守这条：本文件出现 `child_process` / `spawn` / `setTimeout`
// 中任何一个即判红。
//
// 出口改写（刷新失败后落 consume-degraded 还是 unavailable）**不在这一层**——那取决于刷新前的
// `graphAvailability`，属决策层的 `finalizeAfterRefresh`。这里只回报"刷新这件事发生了什么"。

import { attemptLocalGraphBuild as defaultAttemptLocalGraphBuild } from './graph-bootstrap-status.mjs';
import { DEGRADED_REASONS } from './graph-consumption-decision.mjs';

/**
 * F239 `attemptLocalGraphBuild` 的 reason → FR-004 枚举。
 *
 * `spawn-error` 统一映射到 `spectra-missing`：canonical 只回传 `detail`（错误消息）不回传
 * errno，ENOENT（没装）与 EACCES（装了但不可执行）在此不可区分，而两者对消费方的动作相同
 * ——都是"这台机器上 spectra 起不来"。
 *
 * 三个产物类 reason 合并为 `artifact-unusable`：进程 exit 0 但图缺失 / 不可解析 / 缺
 * `graph.sourceCommit`，本质都是"假成功"，消费方的处置完全一致。
 */
const REASON_MAP = Object.freeze({
  'spawn-error': DEGRADED_REASONS.REFRESH_FAILED_SPECTRA_MISSING,
  timeout: DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT,
  'non-zero-exit': DEGRADED_REASONS.REFRESH_FAILED_NONZERO_EXIT,
  'graph-missing-after-build': DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE,
  'graph-unparsable': DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE,
  'graph-not-queryable': DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE,
});

/**
 * 按需执行一次图重建。
 *
 * FR-008 进程内 single-flight 由调用方保证「一次 CLI 调用只调本函数一次」，本函数自身也不会
 * 重试——重试等于第二次 spawn，会突破那条硬保证。
 *
 * @param {{
 *   projectRoot: string,
 *   spectraBin?: string,
 *   refreshPolicy: 'allowed'|'declined',
 *   deadlineMs?: number,
 *   attemptLocalGraphBuild?: (options: object) => Promise<{ ok: boolean, reason?: string, detail?: string }>
 * }} options `attemptLocalGraphBuild` 是依赖注入缝（P-W2）：生产路径不传，走 canonical 真实实现；
 *            测试注入 fake 才能穷举四类失败分支而不必真的卸载 spectra。
 *            `deadlineMs` 缺省时沿用 canonical 的默认预算，只在调用方有明确时间预算时才透传
 *            ——deadline 语义与实现仍然只有 canonical 一份，这里不做任何计时。
 * @returns {Promise<{ attempted: boolean, ok: boolean, degradedReason: string|null,
 *                     durationMs: number|null, detail: string|null }>}
 */
export async function executeRefresh({
  projectRoot,
  spectraBin = 'spectra',
  refreshPolicy,
  deadlineMs,
  attemptLocalGraphBuild = defaultAttemptLocalGraphBuild,
}) {
  // 防御性守卫：正常调用路径下 outcome 为 refresh-then-consume 才会走到这里，
  // 而那已隐含 allowed。这里不做二次猜测，policy 说不刷就一次都不 spawn。
  if (refreshPolicy !== 'allowed') {
    return { attempted: false, ok: false, degradedReason: null, durationMs: null, detail: null };
  }

  const buildOptions = { projectRoot, spectraBin };
  if (Number.isFinite(deadlineMs) && deadlineMs > 0) buildOptions.deadlineMs = deadlineMs;

  const startedAt = Date.now();
  const result = await attemptLocalGraphBuild(buildOptions);
  const durationMs = Date.now() - startedAt;

  if (result?.ok === true) {
    return { attempted: true, ok: true, degradedReason: null, durationMs, detail: null };
  }

  const rawReason = result?.reason ?? 'unknown';
  const mapped = REASON_MAP[rawReason];
  // 未登记的 reason 归入 artifact-unusable（最保守的桶），但原始值必须保留进 detail：
  // 静默吞掉一个新失败形态，会让"刷新其实一直在以新方式失败"变得不可观测。
  const degradedReason = mapped ?? DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE;
  const detailParts = [`reason=${rawReason}`];
  if (result?.detail !== undefined && result.detail !== null) detailParts.push(String(result.detail));
  if (result?.code !== undefined && result.code !== null) detailParts.push(`code=${result.code}`);
  if (result?.signal !== undefined && result.signal !== null) detailParts.push(`signal=${result.signal}`);

  return { attempted: true, ok: false, degradedReason, durationMs, detail: detailParts.join(' ') };
}
