/**
 * Feature 166 — claude CLI stream-json 输出解析器
 *
 * claude CLI 在 `--output-format stream-json --verbose` 模式下输出 NDJSON：
 * 每行一个 JSON object，按时序对应：
 *   - type:'system' subtype:'init'（session 初始化）
 *   - 0..N 行 type:'assistant'（含 content[] = text / thinking / tool_use / redacted_thinking）
 *   - 0..N 行 type:'user'（含 content[] = tool_result）
 *   - type:'result' subtype:'success'|'error'（最终汇总，含 total_cost_usd / usage）
 *
 * 容错处理：
 *   - EC-001：malformed JSON 行容错跳过，计入 malformedLineCount
 *   - EC-008：流式按行解析（split + 逐行 parse），避免大输出 OOM
 *   - EC-009：partial last line（无换行结尾 + 不完整 JSON）按 malformed 处理
 *   - EC-010：redacted_thinking blocks 保留在 events，但不进 reasoningTrace 聚合
 *
 * reasoningTrace 聚合规则：
 *   - 仅 type:'assistant' 事件的 message.content[]
 *   - block.type === 'text' → 拼接 block.text
 *   - block.type === 'thinking' → 拼接 block.thinking
 *   - 排除 tool_use / redacted_thinking / 其他类型
 *   - 多 block / 多事件按出现顺序 \n 拼接
 */

/**
 * 解析 claude CLI stream-json stdout 为结构化对象。
 *
 * @param {string} stdout - claude CLI 完整 stdout（NDJSON 格式）
 * @returns {{
 *   events: Array<object>,
 *   reasoningTrace: string,
 *   malformedLineCount: number,
 *   totalLineCount: number,
 *   truncated: boolean,
 *   originalLength: number
 * }}
 */
export function parseClaudeStreamJson(stdout) {
  // 非 string 容错（null / undefined / number 等）
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return {
      events: [],
      reasoningTrace: '',
      malformedLineCount: 0,
      totalLineCount: 0,
      truncated: false,
      originalLength: 0,
    };
  }

  // Feature 166 Codex implement review CRITICAL 1：50 MB size guard 防 OOM。
  // 45 min driver run with --verbose 可能产出超大 stdout；超出上限截断到 50 MB 并标记 truncated:true。
  // 截断从开头保留（保留 session init + 早期 reasoning，丢弃后期，符合 sanity check 用途）。
  const SIZE_GUARD_BYTES = 50 * 1024 * 1024;
  const originalLength = stdout.length;
  const truncated = originalLength > SIZE_GUARD_BYTES;
  const workingStdout = truncated ? stdout.slice(0, SIZE_GUARD_BYTES) : stdout;

  const rawLines = workingStdout.split('\n');
  const events = [];
  let malformedLineCount = 0;
  let totalLineCount = 0;

  for (const line of rawLines) {
    totalLineCount += 1; // Codex W-3 修复：含空行（对齐 spec FR-008 "stdout 总行数（含空行 + 坏行 + 好行）"）
    const trimmed = line.trim();
    if (trimmed.length === 0) continue; // 空行不计入 malformed 但已计入 totalLineCount

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      malformedLineCount += 1;
      continue;
    }

    // 合法 JSON 但需是 event object（顶层 type: string）
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.type === 'string') {
      events.push(parsed);
    } else {
      malformedLineCount += 1;
    }
  }

  // 聚合 reasoningTrace
  const reasoningParts = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        reasoningParts.push(block.text);
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        reasoningParts.push(block.thinking);
      }
      // 排除 tool_use / redacted_thinking / 其他 block 类型
    }
  }
  const reasoningTrace = reasoningParts.join('\n');

  return {
    events,
    reasoningTrace,
    malformedLineCount,
    totalLineCount,
    truncated,
    originalLength,
  };
}
