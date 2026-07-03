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
 *   - **或**（F206 fix B）该行 `"is_error": true` 且 `result` 字段值以 CLI 固定前缀 `API Error: `
 *     开头并含连接级标记（`Unable to connect` / `ConnectionRefused` / 网络 errno）——此类失败没有
 *     HTTP 状态码（`api_error_status:null`），曾漏判为能力 fail：host shell HTTPS_PROXY 指向未运行
 *     的本地代理（Surge 127.0.0.1:6152）时 106/106 run 全 ConnectionRefused 静默烧 ~10hr 却报
 *     "0 discriminating"。锚定前缀是为了不误伤 agent 复述错误文本的能力失败（见下）。
 * **关键边界（codex W1/W3）**：
 *   - 只查**最终 result 行**——瞬时 `api_retry`（中间行、且 key 是 `error_status` 非 `api_error_status`）
 *     后恢复、最终 `is_error:false` 的 run **不算 infra**（生成成功，空 patch 是能力问题）。
 *   - 状态码**白名单**，不是任意 3 位码——避免误把非 infra 码剔分母。连接失败同理走**模式白名单**
 *     （CLI 固定文案 + 网络 errno），且必须 `is_error:true` 才检——agent 正常完成时复述过错误文本
 *     （`is_error:false`）不误伤。
 *   - `error_max_turns`（跑满轮次没产出，is_error:true 但无 api_error_status）**不算 infra**——流程效率/能力问题。
 * **不覆盖**：纯 timeout / 网络 reset（无 stream-json result 行）—— 调用方须另以 `runResult.timedOut` 等
 * 旁证判定（codex W2；本函数只判有日志的 API 级失败）。
 *
 * @param {string} logText  task-runner stdout（stream-json）文本
 * @returns {{failed: boolean, marker?: string}}
 */
import { spawn } from 'node:child_process';

const INFRA_STATUS_CODES = new Set([401, 408, 429, 500, 502, 503, 504, 529]);

/**
 * 连接级失败标记（F206 fix B）：claude CLI 固定文案 + Node 网络 errno。
 * 两个使用位形态不同：
 *   - result 行判定（isGenerationInfraFailure）用**锚定**形态：`result` 字段值必须以 CLI 固定
 *     前缀 `"API Error: "` 开头再含连接标记——error_max_turns 等能力失败（is_error:true）里
 *     agent 最终消息若复述过 "ECONNREFUSED"（如任务本身是修网络库），值不以该前缀开头，不误伤。
 *   - preflight 用**裸文本**形态：`--output-format text` 输出无 JSON 结构；prompt 是固定
 *     "say only ok"，误伤面为零，且 preflight 假阴性只会拒绝起批（安全方向）。
 */
const CONNECTION_FAILURE_MARKERS =
  'Unable to connect|Connection ?[Rr]efused|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH';
const CONNECTION_FAILURE_RESULT_FIELD = new RegExp(
  `"result"\\s*:\\s*"API Error: (?:[^"\\\\]|\\\\.)*?(?:${CONNECTION_FAILURE_MARKERS})`
);
const CONNECTION_FAILURE_TEXT = new RegExp(CONNECTION_FAILURE_MARKERS);

export function isGenerationInfraFailure(logText) {
  if (!logText) return { failed: false };
  // 取最终 result 行（避免瞬时重试中间行误判，W1）。
  const resultLines = String(logText).split('\n').filter((l) => /"type"\s*:\s*"result"/.test(l));
  const finalLine = resultLines.length ? resultLines[resultLines.length - 1] : '';
  if (!finalLine || !/"is_error"\s*:\s*true/.test(finalLine)) return { failed: false };
  const m = finalLine.match(/"api_error_status"\s*:\s*(\d{3})/);
  if (m && INFRA_STATUS_CODES.has(Number(m[1]))) return { failed: true, marker: `api_error_status=${m[1]}` };
  if (/authentication_failed|Invalid authentication credentials/.test(finalLine)) return { failed: true, marker: 'auth_failed' };
  if (CONNECTION_FAILURE_RESULT_FIELD.test(finalLine)) return { failed: true, marker: 'connection_failure' };
  return { failed: false };
}

/**
 * 起批前 API 连接门禁（F206 fix B）：以与 pool→runner→claude 相同的 env 继承
 * （runner:567 语义：继承 process.env，仅删空串 ANTHROPIC_API_KEY）真连一次 API。
 *
 * 背景：host shell 常导出 HTTPS_PROXY 指向本地代理（如 Surge 127.0.0.1:6152）；代理没在跑时
 * 每个 claude 子进程 ECONNREFUSED，批"看着在跑"（Docker oracle 不走该 env）却全是空 patch。
 * 连接失败必须在起批前拒绝，而非烧 ~10hr 后假报 0 discriminating。
 *
 * 判定：exit 0 且 stdout 非空且无连接失败标记 → ok。其余（非零退出 / 连接文案 / 超时 / spawn 失败）
 * 一律 not-ok 并带 detail（供调用方打修复提示）。
 *
 * @param {{model?: string, timeoutMs?: number, spawnImpl?: typeof spawn}} [opts]
 *   spawnImpl 注入式（单测 mock 子进程，不真连网）
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export function preflightClaudeConnectivity({
  model = 'claude-haiku-4-5',
  timeoutMs = 120_000,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY;
    let child;
    try {
      child = spawnImpl('claude', ['--print', '--model', model, '--max-turns', '1', '--output-format', 'text'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, detail: `spawn claude 失败：${e.message}` });
      return;
    }
    let out = '';
    let settled = false;
    const settle = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      settle({ ok: false, detail: `preflight 超时（${timeoutMs}ms 无响应）` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', (e) => settle({ ok: false, detail: `spawn claude 失败：${e.message}` }));
    child.on('close', (code) => {
      const trimmed = out.trim();
      if (CONNECTION_FAILURE_TEXT.test(trimmed)) {
        settle({ ok: false, detail: `连接失败：${trimmed.slice(0, 200)}` });
      } else if (code !== 0) {
        settle({ ok: false, detail: `claude 退出码 ${code}：${trimmed.slice(0, 200) || '(无输出)'}` });
      } else if (!trimmed) {
        settle({ ok: false, detail: 'claude 退出 0 但无输出（异常）' });
      } else {
        settle({ ok: true, detail: trimmed.slice(0, 80) });
      }
    });
    try {
      child.stdin?.end('say only ok\n');
    } catch { /* 子进程可能已挂，close 事件兜底 */ }
  });
}
