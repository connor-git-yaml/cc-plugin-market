/**
 * fix-compliance-execution-record.mjs
 * Feature 218 — 从 fix-compliance-core 拆出的 F216 证据门纯函数与共享 fix-report 解析原语。
 *
 * 承载两类内容：
 *  - 分区 A『共享 fix-report 解析原语』：computeFenceMask 与 no-op 标题锚点正则等
 *    通用 markdown 掩码/锚点原语，被 core 留守函数与本模块证据门共同复用。
 *  - 分区 B『执行记录证据门』：F216 no-op 复现对账解析、受控断言判定、执行证据配对、
 *    复现证据决策表等纯函数，直接决定 fix 模式 no-op 复现证据门的放行/阻断。
 *
 * 设计约束：本模块全部为纯函数——零 I/O（不读文件、不碰 process.env、不调网络/LLM/子代理），
 * 且零 fix-compliance-core 依赖（单向底层，core → execution-record 无回边）。所有迁移符号由
 * core 通过 re-export 转发，保 judge.mjs / io.mjs / 测试的既有 import 面零改动。
 */

// ────────────────────────────────────────
// 分区 A · 共享 fix-report 解析原语（通用 markdown 掩码/锚点，非证据门专属）
// ────────────────────────────────────────

/** no-op 收口制品必填章节锚点（D5 新模板 canonical 标题） */
export const NOOP_JUDGMENT_HEADING_REGEX = /^##\s*判定依据\s*$/m;

/** `### 复现对账` 子标题锚点（整行精确匹配，容忍尾随空白） */
export const NOOP_RECON_HEADING_REGEX = /^###\s*复现对账\s*$/;

/**
 * 计算 fenced code block 掩码与未闭合围栏起点（F216 C4 + F228 R2-1 单一扫描器）。
 * 唯一事实源：computeFenceMask 与 stripCodeRegions 均基于本函数，不得各自平行扫描。
 * 闭合规则遵循 CommonMark：同围栏字符、长度 ≥ 开围栏、且闭合行无 info string（trim 后仅围栏字符）。
 * @param {string[]} lines
 * @returns {{ mask:boolean[], unclosedFrom:number }} mask 语义与既有 computeFenceMask 逐字等价；
 *   unclosedFrom = 开围栏行下标（该围栏直到 EOF 都未闭合），全部闭合时为 -1。
 */
export function computeFenceRegions(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const mask = new Array(list.length).fill(false);
  let open = null; // { char:'`'|'~', len:number, lineIndex:number }
  for (let i = 0; i < list.length; i += 1) {
    const trimmed = String(list[i]).trim();
    const fm = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (open === null) {
      if (fm) {
        open = { char: fm[1][0], len: fm[1].length, lineIndex: i };
        mask[i] = true; // 开围栏行本身算 fenced
      }
    } else {
      mask[i] = true; // 位于 fenced 区（含闭围栏行）
      if (fm && fm[1][0] === open.char && fm[1].length >= open.len && fm[2].trim().length === 0) {
        open = null; // 闭合
      }
    }
  }
  return { mask, unclosedFrom: open === null ? -1 : open.lineIndex };
}

/**
 * 计算 fenced code block 掩码（F216 C4）。返回与 lines 等长的布尔数组，
 * true = 该行位于 ``` / ~~~ 围栏代码块内（含开/闭围栏行本身），MUST 不参与标题/锚点识别。
 * 目的：合规报告在附录 fenced code 里演示 `## 判定依据` / `Root Cause` 时不得被误判为真实锚点，
 * 否则会错误触发 no-op 证据门（FR-007：纯 repair 报告零介入被破坏）。
 * 实现委托给 computeFenceRegions（F228 R2-1 单一扫描器），本函数语义逐字不变。
 * @param {string[]} lines
 * @returns {boolean[]}
 */
export function computeFenceMask(lines) {
  return computeFenceRegions(lines).mask;
}

/**
 * 把带 /g 的正则转成单次匹配探针（去 g 标志，保留 source 与其余 flags）。
 * 逐行 heading 探测须避开全局正则的 lastIndex 状态陷阱，各判据函数统一经此构造探针。
 * @param {RegExp} re
 * @returns {RegExp}
 */
export function toSingleMatchProbe(re) {
  return new RegExp(re.source, re.flags.replace('g', ''));
}

// ────────────────────────────────────────
// 分区 B · 执行记录证据门（F216 no-op 复现证据门纯函数，plan §1/§2）
// ────────────────────────────────────────

/** sentinel 字面量冻结（整行 trim 后精确等值，ANSI/装饰一律拒绝） */
export const SENTINEL_PASS = 'SPEC-DRIVER-REPRO: PASS';
export const SENTINEL_FAIL = 'SPEC-DRIVER-REPRO: FAIL';
/** outputSummary 展示截断上限（仅供反馈展示，绝不参与判定） */
export const EXECUTION_OUTPUT_SUMMARY_LIMIT = 2000;

/**
 * 把 tool_result 的 content 展平为纯文本（F216 AD-2）。
 * 判定源须换行统一：CRLF 与 lone-CR 归一为 \n，使下游 sentinel 整行末行匹配不受行尾差异干扰。
 * 只认顶层 `type==='text'` 块、不递归嵌套数组——嵌套形态本期 runtime 未观测（fixture README T001），
 * 递归会放大解析面且无对应真实来源。
 * @param {string|{type:string,text:string}[]|unknown} content - tool_result block 的 content
 * @returns {string} 完整展平文本（不预截断，内存边界由 io 层 20MB transcript 上限自然约束）
 */
export function flattenToolResultContent(content) {
  let raw;
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    raw = parts.join('\n');
  } else {
    raw = '';
  }
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 保守命令规范化（plan §2，C1 修正）：仅去首尾空白，**不去引号**。
 * 报告侧与 transcript 侧各自 normalize 后 `===` 精确比对——引号差异即视为不等价命令，
 * 抬高"文本近似即算复现"的绕过成本。
 * @param {string} cmd
 * @returns {string}
 */
export function normalizeCommandConservative(cmd) {
  const s = typeof cmd === 'string' ? cmd : '';
  // trim 覆盖"去首尾空白 + 折叠尾随换行"；内部空白与引号一律保留
  return s.replace(/^\s+/, '').replace(/\s+$/, '');
}

/**
 * 解析 `## 判定依据 > ### 复现对账` 区块的逐声明单行 JSON 对账（plan §2，C1/C3 机械冻结）。
 * malformed 行**不可静默丢弃**——计入 malformedCandidateCount 供块级前置短路（防"一绿一坏"误放行）。
 * 区块 = `### 复现对账` 行之后至下一个一/二/三级标题或文件尾；区块内除空白行外每行 MUST 是
 * `- <单行 JSON>`，且 JSON 为 object、`claim`/`command` 非空 string、`expected==="PASS"` 字面量冻结。
 * @param {string} fixReportContent
 * @returns {{ records: {claim:string, command:string, expected:string}[], malformedCandidateCount:number }}
 */
export function parseNoopReconLines(fixReportContent) {
  const text = typeof fixReportContent === 'string' ? fixReportContent : '';
  const lines = text.split('\n');
  const fenceMask = computeFenceMask(lines);
  const records = [];
  let malformedCandidateCount = 0;

  // F216 C3：先定位 canonical `## 判定依据`，只在其到下一 H1/H2 的范围内认直接子标题 `### 复现对账`——
  // 范围外的同名子标题（如挂在 `## 其他章节` 下）不认，堵"对账块放错父层级仍被采信"的绕过。
  const judgeProbe = toSingleMatchProbe(NOOP_JUDGMENT_HEADING_REGEX);
  let judgeStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!fenceMask[i] && judgeProbe.test(lines[i])) { judgeStart = i; break; }
  }
  if (judgeStart === -1) return { records, malformedCandidateCount };
  // 判定依据区块范围 = judgeStart+1 .. 下一个 H1/H2（fenced 内的 `## ` 不算标题）
  let judgeEnd = lines.length;
  for (let i = judgeStart + 1; i < lines.length; i += 1) {
    if (!fenceMask[i] && /^#{1,2}\s/.test(lines[i])) { judgeEnd = i; break; }
  }
  // 在判定依据范围内找直接子标题 `### 复现对账`
  let start = -1;
  for (let i = judgeStart + 1; i < judgeEnd; i += 1) {
    if (!fenceMask[i] && NOOP_RECON_HEADING_REGEX.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return { records, malformedCandidateCount };

  for (let i = start + 1; i < judgeEnd; i += 1) {
    const line = lines[i];
    // 区块终止：下一个一/二/三级标题（同级 ### 或上级 ##/#）；fenced 内的标题不终止
    if (!fenceMask[i] && /^#{1,3}\s/.test(line)) break;
    if (line.trim().length === 0) continue; // 空白行跳过
    // 区块内非 bullet 正文即 malformed（普通说明文字 MUST 放区块外）
    const m = /^\s*-\s+(.+)$/.exec(line);
    if (!m) { malformedCandidateCount += 1; continue; }
    let payload;
    try { payload = JSON.parse(m[1]); } catch { malformedCandidateCount += 1; continue; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      malformedCandidateCount += 1;
      continue;
    }
    const { claim, command, expected } = payload;
    if (typeof claim !== 'string' || claim.length === 0
      || typeof command !== 'string' || command.length === 0
      || expected !== 'PASS') {
      malformedCandidateCount += 1;
      continue;
    }
    records.push({ claim, command, expected });
  }
  return { records, malformedCandidateCount };
}

/**
 * 从完整执行输出派生断言状态（plan §1 sentinel 整行末行精确匹配，C2/W5）。
 * 先归一化 CRLF/lone-CR 为 \n；非空行 = trim 后非空。合法 sentinel 行 = 原行 trim 后精确等于
 * SENTINEL_PASS/FAIL（含 ANSI 装饰一律拒绝——不做去色规范化，整行约束天然排除 grep 模式串/源码摘录噪声）。
 * @param {string} flattenedContent
 * @returns {'PASS'|'FAIL'|'INCONCLUSIVE'|'CONTRADICTION'}
 */
export function deriveAssertionStatus(flattenedContent) {
  const text = (typeof flattenedContent === 'string' ? flattenedContent : '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const nonEmpty = text.split('\n').filter((line) => line.trim().length > 0);
  const sentinels = [];
  nonEmpty.forEach((line, idx) => {
    const t = line.trim();
    if (t === SENTINEL_PASS) sentinels.push({ value: 'PASS', idx });
    else if (t === SENTINEL_FAIL) sentinels.push({ value: 'FAIL', idx });
  });
  if (sentinels.length === 0) return 'INCONCLUSIVE';
  const hasPass = sentinels.some((s) => s.value === 'PASS');
  const hasFail = sentinels.some((s) => s.value === 'FAIL');
  if (sentinels.length >= 2 || (hasPass && hasFail)) return 'CONTRADICTION';
  // 恰好 1 个合法 sentinel：须为最后一个非空输出行，否则 INCONCLUSIVE
  const only = sentinels[0];
  return only.idx === nonEmpty.length - 1 ? only.value : 'INCONCLUSIVE';
}

/**
 * 抽取 fix 锚点后窗口内的 Bash 执行证据（plan §1，AD-1）。
 * 镜像 driver-eval-core.mjs 的 use/result 配对模式（tool_use.id ↔ tool_result.tool_use_id）
 * 但自包含实现、零跨目录 import。仅收 name==='Bash' 且 lineIndex > anchorLineIndex 的 tool_use。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ id:string|null, name:string, command:string, toolUseLineIndex:number, toolResultLineIndex:number|null, paired:boolean, isError:boolean|null, flattenedOutput:string, assertionStatus:string, outputSummary:string }[]}
 */
export function extractExecutionRecordsAfter(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  // 先建 tool_use_id → results[] 映射（收集全部命中，用于窗口约束与同 ID 重复检测；W1）
  const resultsById = new Map();
  for (const entry of list) {
    if (!entry || !Array.isArray(entry.toolResultBlocks)) continue;
    for (const r of entry.toolResultBlocks) {
      if (typeof r.toolUseId === 'string' && r.toolUseId.length > 0) {
        if (!resultsById.has(r.toolUseId)) resultsById.set(r.toolUseId, []);
        resultsById.get(r.toolUseId).push({
          isError: r.isError === true,
          flattenedContent: typeof r.flattenedContent === 'string' ? r.flattenedContent : '',
          lineIndex: entry.lineIndex,
        });
      }
    }
  }
  // 统计锚点后每个 tool_use id 的出现次数（W1：同 ID 多 use 即歧义，拒绝可靠配对）
  const useCountById = new Map();
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (block.name !== 'Bash') continue;
      if (typeof block.id === 'string' && block.id.length > 0) {
        useCountById.set(block.id, (useCountById.get(block.id) || 0) + 1);
      }
    }
  }
  const records = [];
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (block.name !== 'Bash') continue; // 非 Bash 一律不产出 ExecutionRecord（EC-007）
      const input = block.input || {};
      const command = typeof input.command === 'string' ? input.command : '';
      const id = typeof block.id === 'string' ? block.id : null;
      const allResults = id ? (resultsById.get(id) || []) : [];
      // W1 窗口约束：result MUST 严格晚于 tool_use（result.lineIndex > use.lineIndex），
      // 锚点前的 result 与锚点后同 ID 的 use 不构成合法配对（时序上不可能是其执行结果）。
      const windowResults = allResults.filter((r) => r.lineIndex > entry.lineIndex);
      // W1 歧义：同 ID 多 use，或窗口内 result 多于 1 → 无法唯一配对，判 inconclusive 语义（拒绝可靠配对）。
      const ambiguous = (id !== null && (useCountById.get(id) || 0) > 1) || windowResults.length > 1;
      const result = (!ambiguous && windowResults.length === 1) ? windowResults[0] : undefined;
      const paired = Boolean(result);
      const flattenedOutput = paired ? result.flattenedContent : '';
      records.push({
        id,
        name: 'Bash',
        command,
        toolUseLineIndex: entry.lineIndex,
        toolResultLineIndex: paired ? result.lineIndex : null,
        paired,
        ambiguous,
        isError: paired ? result.isError : null,
        flattenedOutput,
        // 未配对记录 assertionStatus 不参与判定（决策表按 paired===false / ambiguous 独立判）
        assertionStatus: paired ? deriveAssertionStatus(flattenedOutput) : 'INCONCLUSIVE',
        outputSummary: flattenedOutput.length > EXECUTION_OUTPUT_SUMMARY_LIMIT
          ? `${flattenedOutput.slice(0, EXECUTION_OUTPUT_SUMMARY_LIMIT)}…[截断]`
          : flattenedOutput,
      });
    }
  }
  return records;
}

/**
 * 复现证据决策表（plan §2 条件并行判定表，C2/C3）。逐声明累计全部适用键、跨声明并集去重。
 * 行 0 块级前置短路（缺区块/records 空/malformed>0 → repro-fields）先于逐声明判定；
 * 行 1 与行 2-5 互斥（E 空 vs 非空）；行 2-5 之间可同时命中（条件并行）。
 * @param {{ records:{claim:string,command:string,expected:string}[], malformedCandidateCount:number }} parsedRecon
 * @param {ReturnType<typeof extractExecutionRecordsAfter>} executionRecords
 * @returns {string[]} canonical missing key 集合（去重）
 */
export function classifyReproEvidence(parsedRecon, executionRecords) {
  const records = parsedRecon && Array.isArray(parsedRecon.records) ? parsedRecon.records : [];
  const malformedCount = parsedRecon && Number.isInteger(parsedRecon.malformedCandidateCount)
    ? parsedRecon.malformedCandidateCount : 0;
  // 行 0：块级前置短路（区块缺失 → records 空；一绿一坏 → malformed>0）
  if (records.length === 0 || malformedCount > 0) return ['noop:repro-fields'];

  const execs = Array.isArray(executionRecords) ? executionRecords : [];
  const missing = new Set();
  for (const rec of records) {
    const normCmd = normalizeCommandConservative(rec.command);
    // 证据集合 E：命令保守规范化后精确相等的全部执行记录（采信整个集合，拒绝"任一绿即绿"）
    const E = execs.filter((er) => normalizeCommandConservative(er.command) === normCmd);
    if (E.length === 0) { missing.add('noop:repro-command-mismatch'); continue; }
    // 行 2-5 并行判定（可同时命中多键）
    // W1：ambiguous（同 ID 重复 use / 窗口内多 result）→ 无法唯一配对，判 INCONCLUSIVE 语义（output-mismatch）；
    // 非歧义的未配对（窗口内无 result）→ result-missing。二者互斥归类，避免歧义记录误落 result-missing。
    if (E.some((er) => er.ambiguous === true)) missing.add('noop:repro-output-mismatch');
    if (E.some((er) => er.paired === false && er.ambiguous !== true)) missing.add('noop:repro-result-missing');
    if (E.some((er) => er.paired && er.isError === true)) missing.add('noop:repro-tool-error');
    const clean = E.filter((er) => er.paired && er.isError !== true);
    const hasFail = clean.some((er) => er.assertionStatus === 'FAIL');
    const hasContra = clean.some((er) => er.assertionStatus === 'CONTRADICTION');
    const hasPass = clean.some((er) => er.assertionStatus === 'PASS');
    // 行 4：FAIL/CONTRADICTION，或集合内 PASS/FAIL 冲突（时序拒绝任一绿即绿）
    if (hasFail || hasContra || (hasPass && hasFail)) missing.add('noop:repro-contradiction');
    // 行 5：INCONCLUSIVE（0 sentinel / 非末行）
    if (clean.some((er) => er.assertionStatus === 'INCONCLUSIVE')) missing.add('noop:repro-output-mismatch');
  }
  return [...missing];
}
