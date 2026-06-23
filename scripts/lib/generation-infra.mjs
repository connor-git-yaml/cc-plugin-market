/**
 * Feature 188 — 生成阶段 infra 失败判定（共享）。
 *
 * 背景：评测 driver（`claude --print`）OAuth 过期 / 限流 / 过载时，生成 run 会产出**空 patch**。
 * 若把它当"候选 fail"（能力），会系统性污染 cohort 对比——M7 实测 42/133（32%）run 被此污染，
 * 不均匀分布（22-45%/cohort），曾使竞争结论失真。这与 fuzzy 退化 oracle 同类（把测量故障当能力信号）。
 *
 * 本判定是**单一事实源**，被离线重判驱动（eval-offline-rejudge：空 patch 剔分母）与生成 runner
 * （eval-task-runner：生成 infra 失败退非零 → cohort-batch 标 broken → resume 重跑）共用。
 *
 * 只认机读 API 级错误标记，且**仅看最终 result 行**（stream-json 一行一 JSON，末个 `"type":"result"`）：
 *   - 该行 `"is_error": true` **且** `"api_error_status"` ∈ 白名单 {401,408,429,500,502,503,504,529}
 *     （auth 过期 / 超时 / 限流 / 服务端 / 过载），或含 `authentication_failed` / `Invalid authentication`。
 * **关键边界（codex W1/W3）**：
 *   - 只查**最终 result 行**——瞬时 `api_retry`（中间行、且 key 是 `error_status` 非 `api_error_status`）
 *     后恢复、最终 `is_error:false` 的 run **不算 infra**（生成成功，空 patch 是能力问题）。
 *   - 状态码**白名单**，不是任意 3 位码——避免误把非 infra 码剔分母。
 *   - `error_max_turns`（跑满轮次没产出，is_error:true 但无 api_error_status）**不算 infra**——流程效率/能力问题。
 * **不覆盖**：纯 timeout / 网络 reset（无 stream-json result 行）—— 调用方须另以 `runResult.timedOut` 等
 * 旁证判定（codex W2；本函数只判有日志的 API 级失败）。
 *
 * @param {string} logText  task-runner stdout（stream-json）文本
 * @returns {{failed: boolean, marker?: string}}
 */
const INFRA_STATUS_CODES = new Set([401, 408, 429, 500, 502, 503, 504, 529]);

export function isGenerationInfraFailure(logText) {
  if (!logText) return { failed: false };
  // 取最终 result 行（避免瞬时重试中间行误判，W1）。
  const resultLines = String(logText).split('\n').filter((l) => /"type"\s*:\s*"result"/.test(l));
  const finalLine = resultLines.length ? resultLines[resultLines.length - 1] : '';
  if (!finalLine || !/"is_error"\s*:\s*true/.test(finalLine)) return { failed: false };
  const m = finalLine.match(/"api_error_status"\s*:\s*(\d{3})/);
  if (m && INFRA_STATUS_CODES.has(Number(m[1]))) return { failed: true, marker: `api_error_status=${m[1]}` };
  if (/authentication_failed|Invalid authentication credentials/.test(finalLine)) return { failed: true, marker: 'auth_failed' };
  return { failed: false };
}
