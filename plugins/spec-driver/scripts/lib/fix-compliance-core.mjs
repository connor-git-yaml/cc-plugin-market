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
 *
 * F218 拆分：F216 证据门纯函数与共享 fix-report 解析原语已下沉到
 * fix-compliance-execution-record.mjs（单向底层）。core 留守函数按需 import back，
 * 并在文件尾部统一 re-export 转发，保 judge.mjs / io.mjs / 测试的既有 import 面零改动。
 */

import {
  flattenToolResultContent,        // normalizeTranscriptEntry 复用
  computeFenceMask,                // extractSectionBody / stripReconSubblock / classifyClosureForm 复用
  computeFenceRegions,             // stripCodeRegions 复用（F228 R2-1：未闭合围栏不剥离）
  NOOP_JUDGMENT_HEADING_REGEX,     // classifyClosureForm / judgeCompliance 复用
  NOOP_RECON_HEADING_REGEX,        // stripReconSubblock 复用
  parseNoopReconLines,             // judgeCompliance 复用
  classifyReproEvidence,           // judgeCompliance 复用
  toSingleMatchProbe,              // 章节判据函数构造单次匹配探针（不 re-export，新符号无兼容约束）
} from './fix-compliance-execution-record.mjs';

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

/**
 * 改名目标合法命名校验（F224 FR-001）：改名后的新目录必须仍满足 `specs/NNN-fix-<name>` 命名规范
 * 才能被采信为新候选。否则说明候选已被移动到无法机械识别的位置（改名到非规范目录），
 * 此时继续拿旧路径去撞磁盘核验只会产生误报，须转入 FR-004 降级路径。
 * 整串锚定并允许尾随斜杠，与 ARTIFACT_PATH_REGEX 的目录前缀语义同源。
 */
export const FIX_DIR_NAME_REGEX = /^specs\/\d+-fix-[a-z0-9-]+\/?$/;

/**
 * 目录改名命令**段**识别（F224 FR-001 + Codex 复审保守化）：捕获 `mv` / `git mv` 之后、
 * 到最近一个命令分隔符（换行 / `;` / `&` / `|`）之前的整段参数文本，交由 parseRenameOperands
 * 做 token 级解析。全局匹配以支持同一条复合命令内串联的多次改名。
 *
 * 改为"先取段、再数操作数"是因为旧的"直接捕获相邻两 token 当 src/dst"写法会误解析异常形态：
 * `mv A B C`（真实语义是把 A、B 移入目录 C）会被读成 `A → B` 的改名，进而误置 ambiguous 触发降级。
 * 段捕获量词有界（≤ 400 字符）且字符类排除分隔符 → 单趟贪婪匹配，无灾难性回溯风险。
 */
export const RENAME_COMMAND_SEGMENT_REGEX = /(?:\bgit\s+mv\b|\bmv\b)([^\n;&|]{0,400})/g;

/**
 * 其后紧跟独立参数的 option（`mv -t DIR SRC` / `mv -S SUFFIX SRC DST`）。
 * 这类形态下操作数位次与常规 `mv SRC DST` 错位，出现即整条跳过（保守化：宁可漏跟随，不可跟错）。
 */
const RENAME_ARG_TAKING_OPTIONS = new Set(['-t', '--target-directory', '-S', '--suffix']);

/** option token 数量上界：超界视为无法可靠解析的异常形态，整条跳过（与既有有界量词语义等价） */
const RENAME_MAX_OPTION_TOKENS = 8;

/**
 * 解析一段 `mv` 参数文本，仅在能**唯一确定** `<src> <dst>` 时返回二元组，否则返回 null（整条跳过）。
 * 保守化规则（F224 Codex 复审）：
 * - 非 option 操作数不恰好为 2 个 → null（覆盖 `mv A B C` 多操作数、含空格引号路径被拆散等形态）
 * - 出现带参数 option（`-t` / `-S` / `--target-directory` / `--suffix`）→ null（位次错位）
 * - option token 数超过上界 → null
 * 引号仅剥除"首尾成对且内部无引号"的简单包裹；specs/NNN-fix-<name> 命名规范本身不含空格，
 * 故刻意不解析 shell 转义/通配符——不匹配即退化为"不识别"，不会误跟随。
 * 注意：本函数只决定"命令形态能否被识别"，**不**放宽"仅当 src 精确等于当前已跟踪目录才采信"这一安全约束。
 * @param {string} segment
 * @returns {[string, string]|null}
 */
export function parseRenameOperands(segment) {
  const tokens = String(segment).trim().split(/\s+/).filter(Boolean);
  const operands = [];
  let optionCount = 0;
  let endOfOptions = false;
  for (const token of tokens) {
    if (!endOfOptions && token === '--') {
      endOfOptions = true;
      optionCount += 1;
      continue;
    }
    if (!endOfOptions && token.length > 1 && token.startsWith('-')) {
      if (RENAME_ARG_TAKING_OPTIONS.has(token.split('=')[0])) return null;
      optionCount += 1;
      continue;
    }
    operands.push(token);
  }
  if (optionCount > RENAME_MAX_OPTION_TOKENS) return null;
  if (operands.length !== 2) return null;
  const unquote = (t) => (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]
    && !t.slice(1, -1).includes(t[0])
    ? t.slice(1, -1)
    : t);
  return [unquote(operands[0]), unquote(operands[1])];
}

/**
 * 原地编辑命令识别（F224 FR-002/FR-003）：可追加的正则列表，当前覆盖 `sed -i` 与 `perl -i`。
 * 这一组正则只放宽"这条 Bash 命令要不要进入路径扫描"的**准入**，绝不放宽"扫描到什么才算写入"的
 * **判据**——命中后仍必须让命令文本完整匹配 ARTIFACT_PATH_REGEX 才会更新候选，避免把纯路径提及误判为写入。
 * `.{0,40}?` 为有界惰性量词（杜绝长命令下的灾难性回溯），兼容 `sed -i ''` / `sed -i.bak` / `perl -i -pe` 等变体。
 * FR-003 的可扩展性以"向本数组追加一条正则"这一最轻形式满足，不引入 handler 注册表或策略接口。
 */
export const INLINE_EDIT_INDICATOR_REGEXES = [
  /\bsed\b.{0,40}?-i\b/,
  /\bperl\b.{0,40}?-i\b/,
];

/** 修复收口制品必填章节锚点（既有 Phase 1 模板固有 Root Cause 行） */
export const ROOT_CAUSE_HEADING_REGEX = /Root Cause/i;

/**
 * 未替换花括号占位符探测（FR-012a 空壳判据）——代码区豁免（F228 剥离后文本上扫描）。
 * F229：锚点收窄为"存在**任何 ASCII U+007B**"，**不要求闭合**——闭合与否与"是否已替换为
 * 真实内容"无关，把 canonical 模板的成对形态写进判据等于公开一条删掉一个 `}` 即可通过的逃逸路径。
 * 措辞注意：本正则**不检查 Markdown 转义**（`\{` 同样命中），故不要表述为"未转义的起始标记"。
 *
 * 本常量有**两个消费点**（见 checkArtifactSection 的四段 OR，勿再写成"只作用于已剥离文本"）：
 * - 第 3 段：作用在 `stripCodeRegions` 之后的 `placeholderScanText` 上。真实代码的花括号已被结构性
 *   豁免清空，故这里可以退化为最朴素的 `/\{/`：剥完代码区还剩 `{`，就一定不是"作者引用的代码"。
 * - 第 4 段：作用在**未剥离**的 `proseBody` 上，与 `strippedChars <= MIN_SECTION_BODY_CHARS` 取合取
 *   （F228 R3-1 边界判据）。这一段不靠正则排除真实代码，靠"剥离后剩余散文量"作判别锚点。
 */
const PLACEHOLDER_OPEN_BRACE_REGEX = /\{/;

/**
 * canonical 模板占位符（形如 `{根本原因一句话总结}`）：含中日韩表意文字、且不含 ASCII 冒号（F228 R2-2，
 * 排除集收窄自协调方复审：ASCII 冒号才是"这是代码/JSON 字面量"的可靠标志——对象字面量与 JSON
 * 必然靠键值 `:` 表达结构；ASCII 引号不是可靠标志，canonical 中文占位符本身也可能含引号
 * （如 `{spec 文件列表，或"无需更新"}`），若继续排除引号会把这类合法占位符误判为代码而漏判）。
 * 这类占位符是本仓 no-op/repair 模板固有的纯中文描述短语，即便被作者包进反引号 code span 也不构成
 * 豁免理由——代码区豁免只应给"作者引用真实代码"的花括号（含 ASCII 冒号，或不含中文），
 * 故本判据直接在**剥离代码区之前**的 proseBody 上扫描（见 checkArtifactSection），不吃 stripCodeRegions 的豁免。
 * F229：闭合边界从"必须是 `}`"放宽为"`}` 或**行尾**"——不成对花括号同样是未替换的模板起始
 * 标记，不应因少一个 `}` 而豁免。判据由两个 alternation 分支组成，职责刻意分离：
 * - 分支 1 `\{(?=[^}]*[一-鿿])[^}:]*\}`：**成对**形态，与 F229 之前逐字一致（含跨行成对占位符，
 *   如 `{根本原因\n一句话总结}`），保证新判据是旧判据的严格超集，不削弱任何既有判别力。
 * - 分支 2 `\{(?=[^}\n]*[一-鿿])[^}:\n]*$`（配合 `/m`，`$` = 行尾）：**不成对**形态，两处字符类
 *   与 lookahead 都排除 `\n`，把匹配硬锚在**同一行**内。
 *
 * 分支 2 必须排除 `\n` 且必须带 `/m`（F229 R1 回归教训，勿合并回单分支的 `(?:\}|$)`）：不带 `/m` 时
 * `$` 是**整段章节末尾**而非行尾，加上 `[^}:]*` 本身能跨换行，未闭合的 `{` 会一路吞过闭合围栏、
 * 吞过段落，直到章节结束才判定——于是"合法 repair 报告引用一段被截断的代码（含未闭合 `{`）、
 * 围栏之后再写中文说明"会被误判为占位空壳，违反 F228 已确立的代码区豁免语义。
 *
 * 因本判据作用在**未剥离**的原文上，无法借结构性豁免排除真实代码，故 CJK 前置断言与 ASCII 冒号
 * 排除集两项判别力在**两个分支中都逐字保留**、不可删：例如 `{"claim":"症状已消除",...`
 * （含 CJK 也含 ASCII 冒号）在遇到 `:` 时字符类被迫停止、停止点既非 `}` 也非行尾，两分支均失败，
 * 放宽后依旧正确豁免。切勿按旧注释里"成对花括号"的措辞重新引入全局闭合要求。
 *
 * 但 ASCII 冒号排除**只是每个 `{` 起点的局部条件**，不是"整段文本含冒号即整体豁免"的全局性质——
 * 某个 `{` 失败后引擎会从**后续每一个 `{`** 重新起匹配。反例 `{"claim":"{症状已消除`：第一个 `{`
 * 被冒号挡住，第二个 `{` 之后是纯 CJK 直到行尾，不成对分支命中。可靠的 JSON 豁免仍靠 F216 的
 * stripReconSubblock 结构性剔除与 F228 的代码区剥离，不要把本判据的局部条件当作 JSON 豁免保证。
 */
const CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*\}|\{(?=[^}\n]*[一-鿿])[^}:\n]*$/m;

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
// 说明：flattenToolResultContent 已下沉到 fix-compliance-execution-record.mjs，
// 本层 import back 供 normalizeTranscriptEntry 复用。

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
 * 段分隔符（F225）：`&&` / `||` / `;` / 换行。
 * alternation 中双字符 token 在前，落单的 `|` / `&` 不会被命中——裸管道与后台符刻意不作为分隔符
 * （`... | tee <path>` 语义上不是独立动作边界，切开会产生失真分段）。
 * 不带 `/g`：`String.prototype.split` 内部用带 `y` 的 species 克隆匹配，既不读也不写原正则的
 * lastIndex，`/g` 在此无作用且会让读者误以为该常量有跨调用状态。
 */
const SEGMENT_SPLIT_REGEX = /&&|\|\||;|\r?\n/;

/**
 * 行连接（line continuation）：反斜杠 + 换行。
 * alternation 第一支 `\\\\` 先吃掉成对的转义反斜杠，使 `\\`（字面反斜杠）后面的换行不会被
 * 误判为续行；第二支才是真正的续行序列。
 */
const LINE_CONTINUATION_REGEX = /\\\\|\\\r?\n/g;

/**
 * 消解 shell 行连接：`\` + 换行会被 shell 整体删除、两侧拼成同一条逻辑行，
 * 因此必须在切段**之前**还原，否则 `printf x > \<换行>specs/.../fix-report.md` 会被
 * 换行分隔符拆成「有写指示符无路径」+「有路径无写指示符」两段而漏提名（F225 R-1）。
 * 已知限界：不感知 quoted heredoc（`<<'EOF'`）——其 body 内的行尾反斜杠在真实 shell 中是字面量、
 * 不构成续行，这里仍会被消解，效果是把该 body 的两行并成一段（合并而非划分）。
 * @param {string} command
 * @returns {string}
 */
function unfoldLineContinuations(command) {
  return command.replace(LINE_CONTINUATION_REGEX, (match) => (match === '\\\\' ? match : ''));
}

/**
 * 把一条 Bash 命令切成保序的文本片段序列（F225）。
 * 只做字面分隔符切分，**不是**语法级解析：引号内、`$()` 内、heredoc body 内出现的 `;` / `&&`
 * 同样会被切开，所以片段不保证等价于真正的 Bash 子命令。这对本模块够用——切分是**划分**而非合并，
 * 只会让「写指示符与 artifact 路径共现」判据更严，不会新增劫持面（代价见「已知限界」测试用例）。
 * @param {string} command
 * @returns {string[]}
 */
function splitCommandTextSegments(command) {
  return unfoldLineContinuations(command).split(SEGMENT_SPLIT_REGEX);
}

/**
 * 单个子命令段是否含写入指示符（重定向/heredoc/tee，或 F224 的原地编辑 `sed -i` / `perl -i`）。
 * 写入形态判定收口为单一谓词：新形态并入此处的 OR 分支即可自动获得 F225 的「同段共现」语义，
 * 无需改动 resolveFeatureDirCandidate 的分段循环（F225 plan §合并预案指定的单点合并位）。
 * @param {string} segment
 * @returns {boolean}
 */
function hasBashWriteIndicator(segment) {
  return BASH_WRITE_INDICATOR_REGEX.test(segment)
    || INLINE_EDIT_INDICATOR_REGEXES.some((re) => re.test(segment));
}

/**
 * 从锚点后的制品写入痕迹提名特性目录候选，取最后出现者（codex implement 审查 C-2 硬化）：
 * - Write/Edit：`input.file_path` 必须命中 required artifact 路径（fix-report.md / verification-report.md）
 * - Bash：`input.command` 命中 artifact 路径 **且** 含写入指示符（重定向/heredoc/tee）——
 *   排除 `echo specs/301-fix-old` / `cat .../fix-report.md` 等纯提及旧路径的读形态
 * - Bash 同段共现（F225）：写入指示符与 artifact 路径必须落在**同一文本片段**（先消解 `\` 行连接，
 *   再按 `&&`/`||`/`;`/换行 切分）才提名；跨段命中不再互相背书——否则
 *   `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md`
 *   这类复合命令中，前段的无关写入会为后段纯读形态的历史合规目录背书，绕过 FR-007 判定窗口
 *   （见 specs/225-fix-compound-command-hijack/fix-report.md R2-R4）。
 * 提名后取 artifact 路径的目录前缀作为候选；提名≠判据——磁盘核验（io 层）才采信。
 * 说明：诚实流程的 fix-report.md 由编排器亲自（Phase 1 inline 豁免）经 Write 写入主 transcript，
 * 提名可靠；verification-report.md 由 verify 子代理在 sidechain 写入、主 transcript 可能不可见，
 * 但目录前缀由 fix-report.md 提名即可，verification-report 的存在性走磁盘核验。
 *
 * F224 在上述语义之上补两处解析盲区（判据不放宽，只放宽准入与跟随）：
 * - 盲区 A 改名跟随（FR-001）：`git mv`/`mv` 把已提名的候选目录搬走后，候选须跟随到新路径，
 *   否则拿已不存在的旧路径去撞磁盘核验必然误报"未建立特性目录"。改名识别刻意**不受**写指示符门禁约束
 *   （改名命令天然不含重定向符），但只在 src **精确等于**当前已知候选时才采信——不响应 transcript 中
 *   任意无关的 mv，天然维持 FR-007 的锚定语义；与写入提名一样按段执行（见下方循环）。
 * - 盲区 B 原地编辑准入（FR-002）：`sed -i` / `perl -i` 这类不含重定向符但确实写入制品的命令，
 *   过去被写指示符门禁挡在扫描之外。现以 INLINE_EDIT_INDICATOR_REGEXES 拓宽门禁，命中后仍走同一条
 *   ARTIFACT_PATH_REGEX 判据，写入证据的认定标准与改动前逐字一致。
 *
 * `ambiguous` 仅在"制品目录已被改名搬走、但当前目录名不满足 NNN-fix-<name> 从而无法机械确定位置"时置真，
 * 供编排层转入 FR-004/FR-005 的 fail-open 降级 + 诊断留痕。刻意不为"只写了非制品文件"置真——
 * 目录路径已知时磁盘检查足以裁决，该情形应继续交既有严格判据硬阻断，不得借降级通道放行。
 *
 * 实现上分离两个状态（Codex 复审订正，FR-008）：`trackedDir` 无论命名是否规范都跟踪制品当前所在目录，
 * `candidate` 只在 trackedDir 命名规范时才等于它。故 `ambiguous` 是**可恢复**的——
 * `合法 → 非规范 → 合法` 的多跳改名链能一路续跟到最终态并恢复出确定候选，而不会停在中间态。
 * 若只用单一 candidate 变量，第一跳置 null 后 `src === candidate` 判断即失效，后续跳无法续跟。
 *
 * F227（方案 D）新增只读旁路字段 `candidates`——候选提名历史。**状态转移逻辑逐字不变**：
 * 本函数不接受任何磁盘探针参数、不做任何 I/O，`path`/`ambiguous` 的计算路径与取值对任意输入
 * 与改动前逐字相同；`candidates` 只是把状态机已经产生的序列旁路记录下来，供 judge 层在
 * "主候选磁盘不可用"时按需兜底消费，不参与、不影响本函数内部任何判定。
 * 不变量：
 * - `candidates` 中每个元素都曾在某一时刻满足 `FIX_DIR_NAME_REGEX`
 * - 顺序 = 最近一次被合法提名的先后顺序（move-to-end，非首次出现顺序）
 * - `path` 非 null 时，`path === candidates[candidates.length - 1]`
 * - `path` 为 null 时，`candidates` 仍保留此前全部合法提名历史，供调用方按需兜底
 *
 * 已知限界一（冒用已存在且制品齐全的历史特性目录）：用户已明确知情并接受。这在改动前已存在
 * （只需把该提名放在最后一条使其成为 last-writer-wins 的赢家）；方案 D 的效果是让它在**主候选不可用**
 * 这一分支里对提名位置不再敏感——不需要是最后一条，只要曾被合法提名过就可能被兜底选中。
 * 真实案例（会话写入自己的目录）与该攻击构造（会话写入他人的目录）在 transcript 文本上完全同构，
 * 判定器原理上无法区分意图；彻底关闭需要"制品确由本次会话创建"的带外证据（mtime/git 状态），
 * 而这类证据在 commit/rebase/worktree 重新检出后会失准，代价超出本次修复范围。
 *
 * 已知限界二（F224 fail-open 降级通道可被 transcript 中伪造的 `mv` 文本触发）：改动前既有缺陷
 * （编排器已在未修改源码 + 磁盘零目录场景下独立复现），方案 D **不引入、不修复、也不使其更易触发**——
 * 状态机零改动意味着可触发该降级通道的 transcript 输入集合与改动前逐字相同。已另开独立跟进项。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ path: string|null, ambiguous: boolean, candidates: string[] }}
 */
export function resolveFeatureDirCandidate(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  // trackedDir：制品当前实际所在目录，**无论命名是否规范**都持续跟踪，使多跳改名可续跟（FR-008）
  // candidate：对外暴露的合法候选，仅当 trackedDir 命中 FIX_DIR_NAME_REGEX 时才等于 trackedDir
  let trackedDir = null;
  let candidate = null;
  let ambiguous = false;
  // F227 D：候选历史只读旁路——move-to-end 去重，仅供 judge 层"主候选不可用时"兜底消费，
  // 不参与、不影响本函数内部任何状态转移判定（状态机逻辑与改动前逐字一致）。
  //
  // 容器必须是 Map 而非数组：Map 保证插入序，`delete` 后 `set` 即 O(1) 的 move-to-end。
  // **不要改回 `indexOf`+`splice` 的数组实现**——那是每次提名一次线性扫描、N 个不同候选累计 O(N²)。
  // 实测（单条 Bash 命令内 N 个互不相同的合法 artifact 路径，体积远低于 20MB transcript 上限）：
  //   数组版 N=20,000 → 3,034ms；N=40,000（1.26MB）→ 12,004ms；Map 版两者均为个位数 ms。
  // 本判定器跑在**同步** Stop hook 里，几 MB 的合法 transcript 就足以把门禁推到分钟级或宿主超时，
  // 导致门禁不可用或异常 fail-open。回归锚点见 fix-compliance-core.test.mjs 的 F227 性能用例。
  const candidateHistory = new Map();
  const pushCandidateHistory = (dir) => {
    candidateHistory.delete(dir); // 已存在则先移除，保证重新 set 落到末尾（move-to-end）
    candidateHistory.set(dir, true);
  };

  const stripTrailingSlash = (p) => p.replace(/\/+$/, '');

  /** 由当前 trackedDir 重算对外候选与降级标记（命名规范 ↔ 合法候选，非规范 ↔ ambiguous） */
  const syncCandidateFromTrackedDir = () => {
    if (trackedDir !== null && FIX_DIR_NAME_REGEX.test(trackedDir)) {
      candidate = trackedDir;
      ambiguous = false;
      pushCandidateHistory(trackedDir); // F227 D：只在合法命名时记入候选历史
    } else {
      // 目录确定已搬走但新位置无法机械确定 → 转降级路径，而非继续用旧路径撞磁盘核验产生误报
      candidate = null;
      ambiguous = true;
    }
  };

  const scanArtifactPath = (text) => {
    if (typeof text !== 'string') return;
    let match;
    ARTIFACT_PATH_REGEX.lastIndex = 0;
    while ((match = ARTIFACT_PATH_REGEX.exec(text)) !== null) {
      // 取 artifact 路径的特性目录前缀（specs/NNN-fix-<name>）
      trackedDir = match[0].replace(/\/(?:fix-report\.md|verification\/verification-report\.md)$/, '');
      syncCandidateFromTrackedDir();
    }
  };

  const applyRename = (command) => {
    if (trackedDir === null) return; // 尚无已跟踪目录时的改名与本次收口无关（FR-001 只跟随"已知"目录）
    let match;
    RENAME_COMMAND_SEGMENT_REGEX.lastIndex = 0;
    while ((match = RENAME_COMMAND_SEGMENT_REGEX.exec(command)) !== null) {
      const operands = parseRenameOperands(match[1]);
      if (operands === null) continue; // 异常形态整条跳过（保守化：不跟随、也不置 ambiguous）
      const src = stripTrailingSlash(operands[0]);
      if (src !== trackedDir) continue;
      trackedDir = stripTrailingSlash(operands[1]);
      syncCandidateFromTrackedDir();
    }
  };

  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      const input = block.input || {};
      if ((block.name === 'Write' || block.name === 'Edit') && typeof input.file_path === 'string') {
        scanArtifactPath(input.file_path);
      } else if (block.name === 'Bash' && typeof input.command === 'string') {
        // 逐段判定并按段顺序推进 candidate（不提前 return），保持「取最后出现者」语义。
        // 段内先写入提名、再改名跟随：复合命令 `写制品 && mv 旧 新` 下，先提名才能让改名的 src 精确命中候选。
        // applyRename 同样按段执行（F225 plan §合并预案指定方向）：若对整条命令一次性扫描，
        // 「某段 mv」会与「另一段 artifact 提及」跨段误关联，与 F225 Root Cause 同构。
        for (const segment of splitCommandTextSegments(input.command)) {
          if (hasBashWriteIndicator(segment)) scanArtifactPath(segment);
          applyRename(segment); // 改名识别不受写指示符门禁约束（改名命令天然不含重定向符）
        }
      }
    }
  }
  return { path: candidate, ambiguous, candidates: Array.from(candidateHistory.keys()) };
}

// F216 C4 · fence-aware 标题/锚点识别原语 computeFenceMask 已下沉到
// fix-compliance-execution-record.mjs，本层 import back 供章节判据函数复用。

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
  const probe = toSingleMatchProbe(requiredHeading);
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
  const headMatch = toSingleMatchProbe(requiredHeading).exec(lines[startLine]);
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
 *
 * F228 R3-3：改用 `computeFenceRegions` 并对 `unclosedFrom` 之后的行强制视为未 fenced——
 * 与 `stripCodeRegions` 统一围栏语义。此前直接消费 `computeFenceMask` 时，若子块内出现
 * 未闭合围栏，该围栏会被当成"直到 EOF 都在代码区内"，导致子块下方任何本该终止子块的
 * H1/H2/H3 标题都被误判为"仍在 fenced 区、不算标题"，子块永不终止，把后续所有正文
 * （含标题与模板占位符）一并当作子块内容剔除——两姊妹函数各持一套围栏语义正是本次修复
 * 要消灭的根因模式，故收口为同一套。
 * @param {string} body
 * @returns {string}
 */
function stripReconSubblock(body) {
  const lines = String(body).split('\n');
  const { mask: rawFenceMask, unclosedFrom } = computeFenceRegions(lines);
  const fenceMask = rawFenceMask.map((v, i) => (unclosedFrom !== -1 && i >= unclosedFrom ? false : v));
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
 * 单行「反引号 run 长度精确配对」扫描剥离（F228 Q2 算法，不导出，仅供 stripCodeRegions 使用）。
 *
 * 规则：从左到右扫描一行，遇到反引号即读出连续反引号 run 的长度 N；从该 run 结束处继续向右找
 * **长度恰好等于 N** 的下一个反引号 run（长度不符的 run 整体跳过、不消费、也不作为新的候选起点）；
 * 找到即判定为一对 code span 定界符，把「起始 run + 中间内容 + 结束 run」整体替换为**单个空格**
 * （不是删空，避免两侧文本被拼接出假匹配）；找不到则判定为未闭合，反引号字符原样保留，
 * 从该 run 结束处继续扫描下一段。
 *
 * 逐行独立扫描（不跨行缓冲）——与本文件既有 fence-aware 判据（extractSectionBody /
 * stripReconSubblock / classifyClosureForm）保持同一处理模型，架构一致。
 * 显式 non-goal（见 plan.md Q3）：不处理跨行 code span（反引号跨两行不闭合时，
 * 每一行各自独立判定，互不感知）。
 *
 * F228 R3-2：`\` 是 Markdown 转义反斜杠，`\\`` 使紧随的反引号变为字面量、根本不是 code span
 * 定界符——旧实现把它当定界符用，会误把该反引号包裹的散文当成"代码区"剥离掉（codex 第二轮
 * CRITICAL：转义反引号包一层模板占位符即可让占位符从扫描中消失）。判定规则：向左数该 run 起点
 * 前连续的反斜杠个数，奇数即该 run 被转义（`\\\\` 是转义反斜杠自身，其后的反引号仍是定界符，
 * 偶数个反斜杠不构成转义）。转义 run 按 run 级整体处理（不拆到单字符）——与本文件其余
 * fence-aware 判据一致的简化取舍，足以覆盖单反引号转义的常见形态，不引入跨行/字符级复杂度。
 * @param {string} line - 单行文本（调用方保证不含换行符）
 * @returns {string}
 */
function stripInlineCodeSpans(line) {
  const text = String(line);
  const runRegex = /`+/g;
  const runs = [];
  let match;
  while ((match = runRegex.exec(text)) !== null) {
    let backslashCount = 0;
    let k = match.index - 1;
    while (k >= 0 && text[k] === '\\') { backslashCount += 1; k -= 1; }
    runs.push({
      start: match.index,
      end: match.index + match[0].length,
      length: match[0].length,
      escaped: backslashCount % 2 === 1,
    });
  }
  if (runs.length === 0) return text;

  let result = '';
  let cursor = 0;
  let i = 0;
  while (i < runs.length) {
    const openRun = runs[i];
    if (openRun.escaped) {
      // 转义 run 不作为候选起点：原样保留在输出中（cursor 不推进，交由后续非转义 run 或
      // 循环结束时的尾部拼接统一带出），不参与开/闭配对
      i += 1;
      continue;
    }
    result += text.slice(cursor, openRun.start);
    // 向右找长度恰好等于 openRun.length 的下一个**非转义** run；长度不符或已转义的 run 整体跳过、不消费
    let closeIdx = -1;
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[j].escaped) continue;
      if (runs[j].length === openRun.length) { closeIdx = j; break; }
    }
    if (closeIdx === -1) {
      // 未闭合：反引号原样保留，从该 run 结束处继续扫描
      result += text.slice(openRun.start, openRun.end);
      cursor = openRun.end;
      i += 1;
      continue;
    }
    // 配对成功：起始 run + 中间内容 + 结束 run 整体替换为单个空格
    result += ' ';
    cursor = runs[closeIdx].end;
    i = closeIdx + 1;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * 从文本中剥离代码区（F228 语义收口：代码区不参与散文占位符扫描）——fenced code 块与行内
 * code span 均不再参与 `checkArtifactSection` 的花括号占位符判据。
 *
 * 语义边界（显式 non-goal，见 plan.md Q3，勿在此基础上扩展）：
 * - **闭合**的 fenced 代码块（``` / ~~~）整体清空（含开/闭围栏行本身），复用 `computeFenceRegions`
 *   （与 F216 C4 标题/锚点识别同一套 fence 语义，避免两套"什么算围栏"各自为政）
 * - 未闭合的围栏（开围栏行直到 EOF 都没有匹配闭合）不剥离——F228 R2-2 CRITICAL-2 修复：
 *   未闭合围栏在真实 markdown 渲染中不构成有效代码块，若仍整段清空，会把开围栏行之后**全部**
 *   正文（含后续 H2 标题与其下的模板占位符）一并吞掉，制造可主动触发的门禁绕过
 * - 非 fenced 行按 `stripInlineCodeSpans` 逐行剥离行内 code span，未闭合反引号原样保留
 * - **不处理**缩进代码块（4 空格）——`computeFenceMask` 本身也不识别缩进代码块，为其单独加
 *   特殊分支会制造"fence 识别"与"code-region 剥离"两套语义不一致，正是本次修复要消灭的根因模式
 * - **不处理**跨行 code span——逐行独立扫描，反引号跨行不闭合时各行互不感知
 * @param {string} text - 待剥离文本（通常是 `checkArtifactSection` 抽出的章节正文）
 * @returns {string}
 */
export function stripCodeRegions(text) {
  const value = typeof text === 'string' ? text : '';
  const lines = value.split('\n');
  const { mask: fenceMask, unclosedFrom } = computeFenceRegions(lines);
  const out = lines.map((line, i) => {
    // 未闭合围栏起点之后的行一律不剥离（原样保留，含开围栏行本身），使其中的花括号
    // 继续参与占位符扫描（F228 R2-2 CRITICAL-2）
    if (unclosedFrom !== -1 && i >= unclosedFrom) return line;
    return fenceMask[i] ? '' : stripInlineCodeSpans(line);
  });
  return out.join('\n');
}

/**
 * 机械校验制品章节（FR-012a）。
 *
 * F228 语义收口：长度判据与占位符判据的输入来源**不同**——长度判据（`bodyChars`）继续吃
 * `stripReconSubblock(body)`（即 `proseBody`）原文，逐字不变；占位符判据改吃「再剥离代码区」
 * 之后的 `placeholderScanText`（见 `stripCodeRegions`）。这一分离是刻意的：若长度判据也改用
 * 剥离后的文本，"散文简短但有实质 fenced code 证据"的合规章节会被误判为占位空壳，等于按下
 * 葫芦浮起瓢（详见 plan.md「为何长度判据必须留在未剥代码的文本上」）。
 *
 * F228 R2-2：占位符判据本身细分两段 OR——canonical 中文模板占位符（`CANONICAL_PLACEHOLDER_REGEX`）
 * 直接在剥离前的 `proseBody` 上扫描、代码区不豁免（堵 CRITICAL-1：模板占位符包一层反引号
 * 就能同时"贡献长度"又"从占位扫描中消失"的绕过）；通用花括号（`PLACEHOLDER_OPEN_BRACE_REGEX`）
 * 仍在剥离后的 `placeholderScanText` 上扫描、代码区豁免（保留"作者引用真实代码字面量"的既有合规行为）。
 *
 * F229：两条花括号判据均不再要求闭合——通用判据退化为"存在裸 `{`"，canonical 判据的闭合边界放宽为
 * "`}` 或**行尾**"（两个 alternation 分支：成对形态与不成对形态，后者锚定在同一行内、不跨行匹配，
 * 详见 `CANONICAL_PLACEHOLDER_REGEX` 上方注释）。占位符的语义标志是"存在未替换的模板起始标记"，
 * 与闭合无关；旧判据的闭合要求是
 * 从 canonical 模板正例形态反推出的多余约束，构成删一个 `}` 即可通过的门禁绕过。
 *
 * F228 R3-1：代码区豁免新增第 4 段边界判据——原文有花括号、但剥离代码区后实质散文不足阈值，
 * 说明这些花括号只是被代码区包着"充数"，整段正文实质就是包在代码里的占位符（而非"作者在实质
 * 散文之外另行引用代码"），此时豁免不成立，仍判占位空壳。这堵住 codex 第二轮对抗审查发现的三个
 * 绕过变体：中文占位符里塞 ASCII 冒号躲开 canonical 判据、纯 ASCII 模板字段（本就不含中文）、
 * 转义反引号（`\\\`` 在 Markdown 里不是 code span 定界符，见 stripInlineCodeSpans 的 R3-2 修复）
 * ——三者共同点都是"整段正文被代码区形态包裹、剥完之后所剩无几"，与"作者在长散文之外顺带引用
 * 一段代码"的合法形态在"剥离后剩余散文量"这一维度上截然不同，故用 strippedChars 作判别锚点。
 * @param {string} content - 制品文件内容
 * @param {RegExp} requiredHeading - 必填章节锚点正则
 * @returns {{ nonEmpty:boolean, hasRequiredSection:boolean, placeholderResidue:boolean }}
 */
export function checkArtifactSection(content, requiredHeading) {
  const text = typeof content === 'string' ? content : '';
  const nonEmpty = text.replace(/\s/g, '').length > 0;
  const headingProbe = toSingleMatchProbe(requiredHeading);
  const hasRequiredSection = headingProbe.test(text);
  if (!hasRequiredSection) {
    return { nonEmpty, hasRequiredSection: false, placeholderResidue: false };
  }
  const body = extractSectionBody(text, requiredHeading);
  // F216 C1：复现对账子块的单行 JSON 花括号不参与散文占位符扫描——先定向剔除该子块再评估
  const proseBody = stripReconSubblock(body);
  // 长度判据：输入逐字不变（仍是 proseBody），MIN_SECTION_BODY_CHARS 不被放宽
  const bodyChars = proseBody.replace(/\s/g, '').length;
  // 占位符判据：额外剥离代码区（fenced code + 行内 code span）后再扫花括号（F228）
  const placeholderScanText = stripCodeRegions(proseBody);
  const strippedChars = placeholderScanText.replace(/\s/g, '').length;
  // 占位空壳 = 散文正文过短（≤20 非空白字符），或 canonical 中文模板占位符残留（代码区不豁免，F228 R2-2），
  // 或残留未替换的通用花括号占位符（代码区豁免），或原文有花括号但剥离代码区后散文不足阈值（F228 R3-1：
  // 代码区豁免的边界——豁免只服务于"作者在实质散文之外引用代码"，不服务于"整段正文就是包在代码里的占位符"）
  const placeholderResidue = bodyChars <= MIN_SECTION_BODY_CHARS
    || CANONICAL_PLACEHOLDER_REGEX.test(proseBody)
    || PLACEHOLDER_OPEN_BRACE_REGEX.test(placeholderScanText)
    // 第 4 段：F229 后随 PLACEHOLDER_OPEN_BRACE_REGEX 的收口自动收紧（"原文含花括号"的判定由
    // "必须闭合"放宽为"存在裸 `{`"），判据结构本身无需任何额外分支——语义仍是"整段正文被代码区
    // 形态包裹、剥完所剩无几"，strippedChars 阈值门槛逐字不变。
    || (PLACEHOLDER_OPEN_BRACE_REGEX.test(proseBody) && strippedChars <= MIN_SECTION_BODY_CHARS);
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
  const noopProbe = toSingleMatchProbe(NOOP_JUDGMENT_HEADING_REGEX);
  const repairProbe = toSingleMatchProbe(ROOT_CAUSE_HEADING_REGEX);
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

// F216 · no-op 复现对账解析（NOOP_RECON_HEADING_REGEX / normalizeCommandConservative /
// parseNoopReconLines）与受控断言判定 + 执行证据配对（SENTINEL_PASS/FAIL /
// EXECUTION_OUTPUT_SUMMARY_LIMIT / deriveAssertionStatus / extractExecutionRecordsAfter /
// classifyReproEvidence）已下沉到 fix-compliance-execution-record.mjs。
// 其中仅 NOOP_RECON_HEADING_REGEX / parseNoopReconLines / classifyReproEvidence 被本层
// import back（供 stripReconSubblock / judgeCompliance 复用）；其余符号无本地绑定，
// 仅经文件尾部 re-export 转发保持既有 import 面。

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

// ────────────────────────────────────────
// F218 拆分 · re-export 转发（保 judge.mjs / io.mjs / 测试的既有 import 面）
// ────────────────────────────────────────
// F216 证据门纯函数与共享解析原语的定义体在 fix-compliance-execution-record.mjs；
// 消费者仍从本模块 import，导出面与拆分前完全一致（toSingleMatchProbe 为新符号，不在此列）。
export {
  flattenToolResultContent, deriveAssertionStatus, extractExecutionRecordsAfter,
  normalizeCommandConservative, parseNoopReconLines, classifyReproEvidence,
  SENTINEL_PASS, SENTINEL_FAIL, EXECUTION_OUTPUT_SUMMARY_LIMIT,
  NOOP_RECON_HEADING_REGEX, computeFenceMask, computeFenceRegions, NOOP_JUDGMENT_HEADING_REGEX,
} from './fix-compliance-execution-record.mjs';
