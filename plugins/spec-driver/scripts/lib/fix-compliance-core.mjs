/**
 * fix-compliance-core.mjs
 * Feature 208 — fix 模式流程依从性判定核心（纯函数，零 I/O）
 *
 * 设计原则（research.md D3）：本模块全部函数为纯函数——不读文件、不碰 process.env、
 * 不调网络/LLM/子代理。transcript 已由 io 层解析为 TranscriptEntry 数组、配置已读为对象后传入，
 * core 只负责结构化判定。分层惯例参照 goal-loop-core.mjs（fail-loud + 类型守卫先例）。
 *
 * 反伪造硬化（research.md D1）：展开痕迹只认 user 消息 text 块、委派只认 assistant 消息
 * tool_use 块——这两类 envelope 由 harness 写入，模型无法在其中注入内容（模型输出落在
 * assistant text 块与 user 的 tool_result 块）。normalizeTranscriptEntry 在解析期即把
 * tool_result 排除出 textBlocks，从源头堵死"自导自演更新展开痕迹"的 Goodhart 洞。
 */

// ────────────────────────────────────────
// 常量
// ────────────────────────────────────────

/** enforcement 三档合法值（FR-015） */
export const ENFORCEMENT_VALUES = new Set(['block', 'warn', 'off']);

/**
 * 技能展开痕迹正则（research.md D1）。harness 注入的 user 文本块形如：
 * `Base directory for this skill: <pluginPath>/skills/spec-driver-<mode>`
 * mode 限定小写字母，避免把路径尾随字符误并入 mode。全局匹配便于取"最晚一次"。
 */
export const SKILL_EXPANSION_REGEX = /Base directory for this skill:\s*([^\n]+?)\/skills\/spec-driver-([a-z]+)/g;

/**
 * 特性目录提名正则（research.md D1 + codex implement 审查 C-2 硬化）：
 * 提名必须锚定**required artifact 路径**（fix-report.md / verification-report.md），
 * 而非任意目录字符串命中——否则当前会话仅在 Bash 里提及一个旧特性目录路径，
 * 就能把磁盘上前次会话的合规制品绑定为"本次收口的制品"，绕过 FR-007 判定窗口。
 * 提名≠判据，磁盘核验才采信。
 */
export const ARTIFACT_PATH_REGEX = /specs\/\d+-fix-[a-z0-9-]+\/(?:fix-report\.md|verification\/verification-report\.md)/g;

/** Bash 提名额外要求命令含写入指示符（重定向/heredoc/tee），排除 echo/cat 纯提及旧路径的读形态 */
export const BASH_WRITE_INDICATOR_REGEX = /(?:>>?|<<|\btee\b)/;

/** 修复收口制品必填章节锚点（既有 Phase 1 模板固有 Root Cause 行） */
export const ROOT_CAUSE_HEADING_REGEX = /Root Cause/i;

/** no-op 收口制品必填章节锚点（D5 新模板 canonical 标题） */
export const NOOP_JUDGMENT_HEADING_REGEX = /^##\s*判定依据\s*$/m;

/** 未替换花括号占位符探测（FR-012a 空壳判据） */
const PLACEHOLDER_BRACE_REGEX = /\{[^}]*\}/;

/** 章节正文非占位所需的最小非空白字符数（no-op-report-template.md 合同：> 20） */
const MIN_SECTION_BODY_CHARS = 20;

// 角色分类模式（research.md D6，双语窄模式，subagent_type 与 description 共用）
// 刻意不把裸"修复"纳入 implement——"规划修复方案"/"生成修复任务"含"修复"但非"代码修复"，
// 宽模式会把 plan/tasks 误判为 implement 造成假合规。
// 裸"实现"同样剔除（codex implement 审查 W-4）——"验证实现正确性"这类 verify 描述含"实现"，
// 会被误判为 implement 凑出假角色配额；canonical implement 文本"执行代码修复"由"代码修复"覆盖。
const IMPLEMENT_ROLE_REGEX = /implement|代码修复/i;
const VERIFY_ROLE_REGEX = /verify|quality-review|spec-review|review|验证|审查/i;
// no-op 交叉核实类（比 verify 更宽，额外含 核实/确认；codex plan 审查 W-2 堵廉价委派）
const NOOP_VERIFY_ROLE_REGEX = /verify|spec-review|quality-review|review|验证|审查|核实|确认/i;

/** 委派工具名白名单（Agent=当前 CLI 记录名，Task=历史/未来名，等价对待） */
const DELEGATION_TOOL_NAMES = new Set(['Agent', 'Task']);

/**
 * missing 枚举 → 固定 action 文案映射（contracts/fix-compliance-judge-cli.md）。
 * 放 core 便于 T011 CLI 机械拼装反馈文本；单测断言每枚举都有文案，防新增枚举漏配。
 */
export const MISSING_ACTION_TEXT = {
  'fix-report.md': '缺少诊断报告：请完成问题诊断并将 fix-report.md 写入 specs/NNN-fix-<name>/（含 Root Cause 章节）',
  'verification-report.md': '缺少验证报告：请委派 verify 子代理完成 Phase 4 验证闭环（产出 verification/verification-report.md）',
  'delegation:implement': '缺少 implement 类委派：代码修复必须经 Task 委派 implement 子代理执行（禁止编排器行内修改）',
  'delegation:verify': '缺少 verify 类委派：验证闭环必须经 Task 委派 verify/review 类子代理执行',
  'delegation:noop-verify': '缺少 no-op 交叉核实委派：请委派一次 verify 类子代理核实"确实无需改动"这一判断',
  'noop:judgment-section': 'no-op 判定记录不完整：fix-report.md 必须含"## 判定依据"章节且给出具体证据（非占位文本）',
  'artifact:placeholder': '制品为占位空壳：请把模板占位符替换为真实内容',
  'feature-dir': '未建立特性目录：请按 specs/NNN-fix-<short-name>/ 约定创建特性目录并落盘诊断制品',
  // F216 · no-op 复现证据门 6 键 canonical 文案（plan §2 表格逐字落地；含 FR-015 断言骨架）
  'noop:repro-fields': 'no-op 判定依据缺结构化复现对账：请先产出并经 Bash 工具亲自执行每条复现命令（使其在主 transcript 留下 tool_use/tool_result 执行记录），再在 `## 判定依据 > ### 复现对账` 下每条 bullet 写单行合法 JSON，如 `{"claim":"症状已消除","command":"<复现命令>","expected":"PASS"}`，其中 command 须与你经 Bash 执行的命令逐字一致，命令内换行用 \\n',
  'noop:repro-command-mismatch': '缺可执行复现痕迹：报告声称的复现命令在主 transcript 无对应 Bash 执行——请先经 Bash 亲自执行该命令再据实收口。断言骨架：`<断言> && printf \'SPEC-DRIVER-REPRO: PASS\\n\' || printf \'SPEC-DRIVER-REPRO: FAIL\\n\'`（FR-015）',
  'noop:repro-result-missing': '复现命令有调用但无执行结果（transcript 截断/未完成）：请确认命令执行完成并在主 transcript 留下 tool_result',
  'noop:repro-tool-error': '复现命令工具级报错（is_error）：无法据此判断 bug 不存在，请修正命令使其可执行',
  'noop:repro-output-mismatch': '复现输出无约定 PASS 标记：命令末行须精确输出 `SPEC-DRIVER-REPRO: PASS`（整行、唯一、末行），否则判 INCONCLUSIVE',
  'noop:repro-contradiction': '复现声明与执行记录冲突：报告声称已修但执行输出为 FAIL/矛盾 sentinel，请复核根因或转真实修复',
};

/** 双路径收口指引（尾部固定文案，逐字来自 contracts/fix-compliance-judge-cli.md） */
export const DUAL_PATH_GUIDANCE = [
  '两条合法收口路径任选其一：',
  '(A) 完整修复路径：诊断(fix-report.md) → 委派 implement 修复 → 委派 verify 验证(verification-report.md)',
  '(B) 确认无需改动路径：先经 Bash 亲自执行复现命令(使其在主 transcript 留下执行记录) + fix-report.md 写入"## 判定依据"章节(含具体证据与逐字一致的"### 复现对账"对账行) + 委派 1 次 verify 类子代理交叉核实',
].join('\n');

/** 降级放行前置说明行（GATE-DEGRADED 场景在缺口清单前追加） */
export const GATE_DEGRADED_PREFIX_LINE = '已达阻断上限(2 次)，本次降级放行——以下缺口仍未补齐，已落盘降级审计记录：';

// ────────────────────────────────────────
// transcript envelope → TranscriptEntry（纯转换，io 层复用以保证同源）
// ────────────────────────────────────────

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
 * 把单条 transcript envelope 归一化为 TranscriptEntry（data-model.md §2 + F216 ExecutionRecord 扩展）。
 * @param {object|null} raw - JSON.parse 后的 envelope；parseError 时传 null
 * @param {number} lineIndex
 * @param {boolean} parseError
 * @returns {{ lineIndex:number, role:string|undefined, textBlocks:string[], toolUseBlocks:{name:string,input:object,id:string|null}[], toolResultBlocks:{toolUseId:string|null,isError:boolean,flattenedContent:string}[], parseError:boolean }}
 */
export function normalizeTranscriptEntry(raw, lineIndex, parseError = false) {
  if (parseError || !raw || typeof raw !== 'object') {
    return { lineIndex, role: undefined, textBlocks: [], toolUseBlocks: [], toolResultBlocks: [], parseError: true };
  }
  const role = typeof raw.type === 'string' ? raw.type : undefined;
  const content = raw.message && raw.message.content;
  const textBlocks = [];
  const toolUseBlocks = [];
  const toolResultBlocks = [];

  if (typeof content === 'string') {
    // 字符串 content 视为单一文本块（T001 结论 2）
    textBlocks.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        toolUseBlocks.push({
          name: block.name,
          input: (block.input && typeof block.input === 'object') ? block.input : {},
          id: typeof block.id === 'string' ? block.id : null,
        });
      } else if (block.type === 'tool_result') {
        // tool_result 收进独立字段：由 harness 写入的可信 envelope，作复现执行证据配对源（F216 AD-2）；
        // 刻意不并入 textBlocks/toolUseBlocks——展开痕迹只认 user text、委派只认 assistant tool_use，
        // 这两个判定输入不被 tool_result 污染，反伪造语义不回退。
        toolResultBlocks.push({
          toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : null,
          isError: block.is_error === true,
          flattenedContent: flattenToolResultContent(block.content),
        });
      }
      // 其余块型刻意忽略（噪声容错）
    }
  }
  // 非 user/assistant 顶层类型或缺 content → 空集（T001 补充结论 7），toolResultBlocks 恒带空数组
  return { lineIndex, role, textBlocks, toolUseBlocks, toolResultBlocks, parseError: false };
}

// ────────────────────────────────────────
// 判定窗口锚定（D1）
// ────────────────────────────────────────

/**
 * 检测最晚一次 spec-driver 技能展开（只认 user 文本块）。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @returns {{ found:boolean, mode:string|null, anchorLineIndex:number|null }}
 */
export function detectFixSkillExpansion(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let latest = { found: false, mode: null, anchorLineIndex: null };
  for (const entry of list) {
    // 反伪造：只接受 user 角色（harness 注入）的 text 块，排除 assistant / tool_result
    if (!entry || entry.role !== 'user') continue;
    for (const text of entry.textBlocks) {
      // 全局匹配取该块内最后一次（同块多痕迹时取最晚）
      let match;
      let lastMode = null;
      SKILL_EXPANSION_REGEX.lastIndex = 0;
      while ((match = SKILL_EXPANSION_REGEX.exec(text)) !== null) {
        lastMode = match[2];
      }
      if (lastMode !== null) {
        latest = { found: true, mode: lastMode, anchorLineIndex: entry.lineIndex };
      }
    }
  }
  return latest;
}

// ────────────────────────────────────────
// 委派抽取与角色分类（D6）
// ────────────────────────────────────────

/** 对单个 pattern 做角色匹配，命中返回角色名，否则 null */
function matchRole(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // implement 优先于 verify：canonical 文本已精确切分，二者互斥，顺序仅为确定性
  if (IMPLEMENT_ROLE_REGEX.test(text)) return 'implement';
  if (VERIFY_ROLE_REGEX.test(text)) return 'verify';
  return null;
}

/**
 * 委派角色级联分类（D6）：subagent_type 权威优先，无角色信息回落 description。
 * @param {string|null} subagentType
 * @param {string|null} description
 * @returns {'implement'|'verify'|'other'}
 */
export function classifyDelegationRole(subagentType, description) {
  return matchRole(subagentType) ?? matchRole(description) ?? 'other';
}

/** 判定单条委派是否属 no-op 交叉核实类（级联，模式比 verify 宽） */
function isNoopVerifyDelegation(subagentType, description) {
  const hit = (t) => typeof t === 'string' && NOOP_VERIFY_ROLE_REGEX.test(t);
  return hit(subagentType) || hit(description);
}

/**
 * 抽取锚点之后的委派记录（只认 assistant tool_use，name ∈ {Agent,Task}）。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ lineIndex:number, toolName:string, subagentType:string|null, description:string|null, roleClass:string, noopVerify:boolean }[]}
 */
export function extractDelegationsAfter(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  const out = [];
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (!DELEGATION_TOOL_NAMES.has(block.name)) continue;
      const input = block.input || {};
      const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : null;
      const description = typeof input.description === 'string' ? input.description : null;
      out.push({
        lineIndex: entry.lineIndex,
        toolName: block.name,
        subagentType,
        description,
        roleClass: classifyDelegationRole(subagentType, description),
        noopVerify: isNoopVerifyDelegation(subagentType, description),
      });
    }
  }
  return out;
}

// ────────────────────────────────────────
// 特性目录提名（D1）
// ────────────────────────────────────────

/**
 * 从锚点后的制品写入痕迹提名特性目录候选，取最后出现者（codex implement 审查 C-2 硬化）：
 * - Write/Edit：`input.file_path` 必须命中 required artifact 路径（fix-report.md / verification-report.md）
 * - Bash：`input.command` 命中 artifact 路径 **且** 含写入指示符（重定向/heredoc/tee）——
 *   排除 `echo specs/301-fix-old` / `cat .../fix-report.md` 等纯提及旧路径的读形态
 * 提名后取 artifact 路径的目录前缀作为候选；提名≠判据——磁盘核验（io 层）才采信。
 * 说明：诚实流程的 fix-report.md 由编排器亲自（Phase 1 inline 豁免）经 Write 写入主 transcript，
 * 提名可靠；verification-report.md 由 verify 子代理在 sidechain 写入、主 transcript 可能不可见，
 * 但目录前缀由 fix-report.md 提名即可，verification-report 的存在性走磁盘核验。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ path: string|null }}
 */
export function resolveFeatureDirCandidate(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  let candidate = null;
  const scanArtifactPath = (text) => {
    if (typeof text !== 'string') return;
    let match;
    ARTIFACT_PATH_REGEX.lastIndex = 0;
    while ((match = ARTIFACT_PATH_REGEX.exec(text)) !== null) {
      // 取 artifact 路径的特性目录前缀（specs/NNN-fix-<name>）
      candidate = match[0].replace(/\/(?:fix-report\.md|verification\/verification-report\.md)$/, '');
    }
  };
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      const input = block.input || {};
      if ((block.name === 'Write' || block.name === 'Edit') && typeof input.file_path === 'string') {
        scanArtifactPath(input.file_path);
      } else if (block.name === 'Bash' && typeof input.command === 'string'
        && BASH_WRITE_INDICATOR_REGEX.test(input.command)) {
        scanArtifactPath(input.command);
      }
    }
  }
  return { path: candidate };
}

// ────────────────────────────────────────
// F216 C4 · fence-aware 标题/锚点识别（fenced code 区内的行不参与判定）
// ────────────────────────────────────────

/**
 * 计算 fenced code block 掩码（F216 C4）。返回与 lines 等长的布尔数组，
 * true = 该行位于 ``` / ~~~ 围栏代码块内（含开/闭围栏行本身），MUST 不参与标题/锚点识别。
 * 目的：合规报告在附录 fenced code 里演示 `## 判定依据` / `Root Cause` 时不得被误判为真实锚点，
 * 否则会错误触发 no-op 证据门（FR-007：纯 repair 报告零介入被破坏）。
 * 闭合规则遵循 CommonMark：同围栏字符、长度 ≥ 开围栏、且闭合行无 info string（trim 后仅围栏字符）。
 * @param {string[]} lines
 * @returns {boolean[]}
 */
export function computeFenceMask(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const mask = new Array(list.length).fill(false);
  let open = null; // { char:'`'|'~', len:number }
  for (let i = 0; i < list.length; i += 1) {
    const trimmed = String(list[i]).trim();
    const fm = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (open === null) {
      if (fm) {
        open = { char: fm[1][0], len: fm[1].length };
        mask[i] = true; // 开围栏行本身算 fenced
      }
    } else {
      mask[i] = true; // 位于 fenced 区（含闭围栏行）
      if (fm && fm[1][0] === open.char && fm[1].length >= open.len && fm[2].trim().length === 0) {
        open = null; // 闭合
      }
    }
  }
  return mask;
}

// ────────────────────────────────────────
// 制品章节判据（D6 / FR-012a）
// ────────────────────────────────────────

/**
 * 抽取 requiredHeading 命中处到下一个二级标题（或文件尾）之间的正文（F216 C1：终止符还原为 H1/H2 全局语义）。
 * heading 未命中 → 返回空字符串。fenced code 区内的行不参与 heading 定位/终止（F216 C4）。
 * 说明：合法 repair 报告常把证据放在 `### 直接原因` 等 H3 子节下，若以 H3 为终止符会把正文截空
 * 造成 placeholderResidue 误报——故终止符仅认 H1/H2；`### 复现对账` 子块的花括号误判改由
 * checkArtifactSection 定向剔除（stripReconSubblock），不牵动通用章节提取语义。
 */
function extractSectionBody(content, requiredHeading) {
  const text = typeof content === 'string' ? content : '';
  const lines = text.split('\n');
  const fenceMask = computeFenceMask(lines);
  const probe = new RegExp(requiredHeading.source, requiredHeading.flags.replace('g', ''));
  // 定位命中 heading 的行（跳过 fenced code 区）
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenceMask[i]) continue;
    // 逐行匹配 requiredHeading（对 /m 锚定的 `## 判定依据` 与内联 `Root Cause` 均适用）
    if (probe.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return '';
  // 正文起点包含"匹配行锚点之后的剩余文本"——修复形态 `**Root Cause**: <text>` 的证据与锚点同行，
  // no-op 形态 `## 判定依据` 的证据在后续行（同行剩余为空），二者统一处理。
  const headMatch = new RegExp(requiredHeading.source, requiredHeading.flags.replace('g', '')).exec(lines[startLine]);
  const remainder = headMatch ? lines[startLine].slice(headMatch.index + headMatch[0].length) : lines[startLine];
  const body = [remainder];
  for (let i = startLine + 1; i < lines.length; i += 1) {
    // 下一个一/二级标题终止（H3 子节如 `### 直接原因` / `### 复现对账` 仍算章节正文的一部分，
    // 避免 H3 子节把 repair 证据截空造成 placeholderResidue 误报——F216 C1）；fenced code 区内的 `## ` 不算标题
    if (!fenceMask[i] && /^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * 从章节正文中剔除 `### 复现对账` 子块（F216 C1 定向剔除）。
 * 复现对账走 parseNoopReconLines/classifyReproEvidence 机械 JSON 判据，其单行 JSON 花括号
 * MUST 不参与判定依据散文的占位符扫描——先摘除该子块（标题行 + 其下至下一个 H1/H2/H3 的行），
 * 再评估散文实质性与花括号残留。仅剔除复现对账，`### 直接原因` 等其他 H3 子节保留。
 * @param {string} body
 * @returns {string}
 */
function stripReconSubblock(body) {
  const lines = String(body).split('\n');
  const fenceMask = computeFenceMask(lines);
  const out = [];
  let inRecon = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!fenceMask[i] && NOOP_RECON_HEADING_REGEX.test(lines[i])) { inRecon = true; continue; }
    if (inRecon) {
      // 子块在遇到下一个一/二/三级标题时结束（该标题行本身保留）
      if (!fenceMask[i] && /^#{1,3}\s/.test(lines[i])) { inRecon = false; out.push(lines[i]); continue; }
      continue; // 子块内行剔除
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/**
 * 机械校验制品章节（FR-012a）。
 * @param {string} content - 制品文件内容
 * @param {RegExp} requiredHeading - 必填章节锚点正则
 * @returns {{ nonEmpty:boolean, hasRequiredSection:boolean, placeholderResidue:boolean }}
 */
export function checkArtifactSection(content, requiredHeading) {
  const text = typeof content === 'string' ? content : '';
  const nonEmpty = text.replace(/\s/g, '').length > 0;
  const headingProbe = new RegExp(requiredHeading.source, requiredHeading.flags.replace('g', ''));
  const hasRequiredSection = headingProbe.test(text);
  if (!hasRequiredSection) {
    return { nonEmpty, hasRequiredSection: false, placeholderResidue: false };
  }
  const body = extractSectionBody(text, requiredHeading);
  // F216 C1：复现对账子块的单行 JSON 花括号不参与散文占位符扫描——先定向剔除该子块再评估
  const proseBody = stripReconSubblock(body);
  const bodyChars = proseBody.replace(/\s/g, '').length;
  // 占位空壳 = 散文正文过短（≤20 非空白字符）或残留未替换花括号占位符
  const placeholderResidue = bodyChars <= MIN_SECTION_BODY_CHARS || PLACEHOLDER_BRACE_REGEX.test(proseBody);
  return { nonEmpty, hasRequiredSection: true, placeholderResidue };
}

/**
 * 按内容特征区分收口形态（no-op-report-template.md：两锚点集刻意互斥）。
 * 双锚点同时命中 → 按修复收口判据（取严，codex implement 审查 W-1）：若报告既声称
 * Root Cause 又带"## 判定依据"，不允许借 no-op 的更低门槛绕过 verification-report
 * 与 implement/verify 双角色要求。
 * F216 AD-4：返回正交结构 `{closureForm, hasRepairAnchor, hasNoopAnchor}`——双锚点时
 * closureForm 取严为 'repair'，但 hasNoopAnchor 仍保留 true，使 no-op 复现证据门与 repair
 * 合同并行判定（FR-018 可达），不再因塌缩为字符串 'repair' 而丢失 noop 锚点信息。
 * @param {string|null} fixReportContent
 * @returns {{ closureForm:'repair'|'no-op'|'undetermined', hasRepairAnchor:boolean, hasNoopAnchor:boolean }}
 */
export function classifyClosureForm(fixReportContent) {
  const text = typeof fixReportContent === 'string' ? fixReportContent : '';
  // F216 C4：fenced code 区内的 `## 判定依据` / `Root Cause` 是示例文本，不算真实锚点——
  // 逐行识别并跳过 fenced 行，防止合规 repair 报告的附录代码块被误判触发 no-op 证据门（FR-007）。
  const lines = text.split('\n');
  const fenceMask = computeFenceMask(lines);
  const noopProbe = new RegExp(NOOP_JUDGMENT_HEADING_REGEX.source, NOOP_JUDGMENT_HEADING_REGEX.flags.replace('g', ''));
  const repairProbe = new RegExp(ROOT_CAUSE_HEADING_REGEX.source, ROOT_CAUSE_HEADING_REGEX.flags.replace('g', ''));
  let hasNoopAnchor = false;
  let hasRepairAnchor = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenceMask[i]) continue;
    if (!hasNoopAnchor && noopProbe.test(lines[i])) hasNoopAnchor = true;
    if (!hasRepairAnchor && repairProbe.test(lines[i])) hasRepairAnchor = true;
  }
  let closureForm;
  if (hasNoopAnchor && hasRepairAnchor) closureForm = 'repair';
  else if (hasNoopAnchor) closureForm = 'no-op';
  else if (hasRepairAnchor) closureForm = 'repair';
  else closureForm = 'undetermined';
  return { closureForm, hasRepairAnchor, hasNoopAnchor };
}

// ────────────────────────────────────────
// F216 · no-op 复现对账解析与命令保守规范化（plan §2）
// ────────────────────────────────────────

/** `### 复现对账` 子标题锚点（整行精确匹配，容忍尾随空白） */
export const NOOP_RECON_HEADING_REGEX = /^###\s*复现对账\s*$/;

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
  const judgeProbe = new RegExp(NOOP_JUDGMENT_HEADING_REGEX.source, NOOP_JUDGMENT_HEADING_REGEX.flags.replace('g', ''));
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

// ────────────────────────────────────────
// F216 · 受控断言判定 + 执行证据配对（plan §1，AD-1/AD-3）
// ────────────────────────────────────────

/** sentinel 字面量冻结（整行 trim 后精确等值，ANSI/装饰一律拒绝） */
export const SENTINEL_PASS = 'SPEC-DRIVER-REPRO: PASS';
export const SENTINEL_FAIL = 'SPEC-DRIVER-REPRO: FAIL';
/** outputSummary 展示截断上限（仅供反馈展示，绝不参与判定） */
export const EXECUTION_OUTPUT_SUMMARY_LIMIT = 2000;

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

// ────────────────────────────────────────
// 合规最终判定（FR-002 三支）
// ────────────────────────────────────────

/**
 * 综合判定 fix 会话合规状态（data-model.md §7 ComplianceVerdict）。
 * 全部输入已由 io/judge 层解析：transcript 侧 delegations、磁盘侧 featureDir/artifacts、配置侧 enforcement。
 * @param {{
 *   delegations: {roleClass:string, subagentType:string|null, description:string|null, noopVerify?:boolean}[],
 *   featureDir: { path:string|null, existsOnDisk:boolean },
 *   fixReport: { exists:boolean, content:string|null },
 *   verificationReport: { exists:boolean, nonEmpty:boolean },
 *   enforcement: string, configDegraded: boolean, diagnostics: string[],
 * }} input
 * @returns {{ closureForm:string, compliant:boolean, missing:string[], delegationCounts:object, enforcement:string, configDegraded:boolean, diagnostics:string[] }}
 */
export function judgeCompliance(input) {
  const {
    delegations = [], featureDir = { path: null, existsOnDisk: false },
    fixReport = { exists: false, content: null }, verificationReport = { exists: false, nonEmpty: false },
    executionRecords = [], closure: providedClosure,
    enforcement = 'block', configDegraded = false, diagnostics = [],
  } = input || {};

  const counts = { implement: 0, verify: 0, other: 0 };
  let noopVerifyCount = 0;
  for (const d of delegations) {
    const cls = d && d.roleClass;
    if (cls === 'implement' || cls === 'verify' || cls === 'other') counts[cls] += 1;
    // noopVerify 优先用抽取时携带的标记；缺省时按角色回退（verify 类天然属核实语义）
    if (d && (d.noopVerify === true || (d.noopVerify === undefined && cls === 'verify'))) noopVerifyCount += 1;
  }

  // F216 AD-4：正交返回，closureForm 路由基础判据、hasNoopAnchor 独立触发复现证据门。
  // 若 caller（judge 编排层）已分类则透传复用，避免重复分类（plan I8）；否则本层自算（向后兼容）。
  const closure = (providedClosure && typeof providedClosure === 'object')
    ? providedClosure
    : (fixReport.exists
      ? classifyClosureForm(fixReport.content)
      : { closureForm: 'undetermined', hasRepairAnchor: false, hasNoopAnchor: false });
  const closureForm = closure.closureForm;
  const missing = [];

  // 特性目录：候选存在且磁盘核验通过才算就绪
  const featureDirOk = Boolean(featureDir && featureDir.path && featureDir.existsOnDisk);
  if (!featureDirOk) missing.push('feature-dir');

  if (closureForm === 'no-op') {
    const section = checkArtifactSection(fixReport.content, NOOP_JUDGMENT_HEADING_REGEX);
    if (!section.hasRequiredSection) {
      missing.push('noop:judgment-section');
    } else if (section.placeholderResidue) {
      missing.push('artifact:placeholder');
    }
    if (noopVerifyCount < 1) missing.push('delegation:noop-verify');
  } else if (closureForm === 'repair') {
    const section = checkArtifactSection(fixReport.content, ROOT_CAUSE_HEADING_REGEX);
    if (!section.hasRequiredSection) {
      missing.push('fix-report.md');
    } else if (section.placeholderResidue) {
      missing.push('artifact:placeholder');
    }
    if (!(verificationReport && verificationReport.exists && verificationReport.nonEmpty)) {
      missing.push('verification-report.md');
    }
    if (counts.implement < 1) missing.push('delegation:implement');
    if (counts.verify < 1) missing.push('delegation:verify');
  } else {
    // undetermined：既非有效修复报告也非 no-op 报告（含 F206 坍塌：连制品都没有）
    missing.push('fix-report.md');
  }

  // F216 no-op 复现证据门（与 closureForm 路由正交，AD-4）：hasNoopAnchor===true 即追加校验。
  // 双锚点（closureForm='repair' 但 hasNoopAnchor=true）时 repair 合同与 repro 合同并集 missing，
  // 使 FR-018"须同时满足两合同"可达；纯 repair（hasNoopAnchor=false）零介入（FR-007）。
  if (closure.hasNoopAnchor && fixReport.exists) {
    const reproMissing = classifyReproEvidence(
      parseNoopReconLines(fixReport.content),
      executionRecords,
    );
    for (const key of reproMissing) {
      if (!missing.includes(key)) missing.push(key);
    }
  }

  return {
    closureForm,
    compliant: missing.length === 0,
    missing,
    delegationCounts: counts,
    enforcement,
    configDegraded,
    diagnostics: Array.isArray(diagnostics) ? [...diagnostics] : [],
  };
}

// ────────────────────────────────────────
// 配置强制程度解析（FR-015 三步顺序）
// ────────────────────────────────────────

/**
 * 从（io 层读取的）配置状态解析生效 enforcement（fix-compliance-config-field.md 三步序）。
 * 纯函数：io 负责查找文件与捕获解析异常，本函数只做取值→归约。
 * @param {{ found:boolean, parseFailed:boolean, config:object|null }} input
 * @returns {{ enforcement:string, configDegraded:boolean }}
 */
export function resolveEnforcementFromConfig(input) {
  const { found = false, parseFailed = false, config = null } = input || {};
  // 步 1：无配置文件 → 默认 block，非降级
  if (!found) return { enforcement: 'block', configDegraded: false };
  // 步 2a：文件存在但解析失败 → block + 降级
  if (parseFailed) return { enforcement: 'block', configDegraded: true };
  const value = config && config.fix_compliance && config.fix_compliance.enforcement;
  // 缺 fix_compliance 字段 → 默认 block，非降级（缺字段=默认，不视作损坏）
  if (value === undefined || value === null) return { enforcement: 'block', configDegraded: false };
  // 步 3：合法取值直接采用；步 2b：非法取值 → block + 降级
  if (ENFORCEMENT_VALUES.has(value)) return { enforcement: value, configDegraded: false };
  return { enforcement: 'block', configDegraded: true };
}
