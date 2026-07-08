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
};

/** 双路径收口指引（尾部固定文案，逐字来自 contracts/fix-compliance-judge-cli.md） */
export const DUAL_PATH_GUIDANCE = [
  '两条合法收口路径任选其一：',
  '(A) 完整修复路径：诊断(fix-report.md) → 委派 implement 修复 → 委派 verify 验证(verification-report.md)',
  '(B) 确认无需改动路径：fix-report.md 写入"## 判定依据"章节(含具体证据) + 委派 1 次 verify 类子代理交叉核实',
].join('\n');

/** 降级放行前置说明行（GATE-DEGRADED 场景在缺口清单前追加） */
export const GATE_DEGRADED_PREFIX_LINE = '已达阻断上限(2 次)，本次降级放行——以下缺口仍未补齐，已落盘降级审计记录：';

// ────────────────────────────────────────
// transcript envelope → TranscriptEntry（纯转换，io 层复用以保证同源）
// ────────────────────────────────────────

/**
 * 把单条 transcript envelope 归一化为 TranscriptEntry（data-model.md §2）。
 * @param {object|null} raw - JSON.parse 后的 envelope；parseError 时传 null
 * @param {number} lineIndex
 * @param {boolean} parseError
 * @returns {{ lineIndex:number, role:string|undefined, textBlocks:string[], toolUseBlocks:{name:string,input:object}[], parseError:boolean }}
 */
export function normalizeTranscriptEntry(raw, lineIndex, parseError = false) {
  if (parseError || !raw || typeof raw !== 'object') {
    return { lineIndex, role: undefined, textBlocks: [], toolUseBlocks: [], parseError: true };
  }
  const role = typeof raw.type === 'string' ? raw.type : undefined;
  const content = raw.message && raw.message.content;
  const textBlocks = [];
  const toolUseBlocks = [];

  if (typeof content === 'string') {
    // 字符串 content 视为单一文本块（T001 结论 2）
    textBlocks.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        toolUseBlocks.push({ name: block.name, input: (block.input && typeof block.input === 'object') ? block.input : {} });
      }
      // tool_result 与其余块型刻意忽略（反伪造 + 噪声容错）
    }
  }
  // 非 user/assistant 顶层类型或缺 content → 空集（T001 补充结论 7）
  return { lineIndex, role, textBlocks, toolUseBlocks, parseError: false };
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
// 制品章节判据（D6 / FR-012a）
// ────────────────────────────────────────

/**
 * 抽取 requiredHeading 命中处到下一个二级标题（或文件尾）之间的正文。
 * heading 未命中 → 返回空字符串。
 */
function extractSectionBody(content, requiredHeading) {
  const text = typeof content === 'string' ? content : '';
  const lines = text.split('\n');
  const probe = new RegExp(requiredHeading.source, requiredHeading.flags.replace('g', ''));
  // 定位命中 heading 的行
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
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
    if (/^#{1,2}\s/.test(lines[i])) break; // 下一个一/二级标题终止
    body.push(lines[i]);
  }
  return body.join('\n');
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
  const bodyChars = body.replace(/\s/g, '').length;
  // 占位空壳 = 正文过短（≤20 非空白字符）或残留未替换花括号占位符
  const placeholderResidue = bodyChars <= MIN_SECTION_BODY_CHARS || PLACEHOLDER_BRACE_REGEX.test(body);
  return { nonEmpty, hasRequiredSection: true, placeholderResidue };
}

/**
 * 按内容特征区分收口形态（no-op-report-template.md：两锚点集刻意互斥）。
 * 双锚点同时命中 → 按修复收口判据（取严，codex implement 审查 W-1）：若报告既声称
 * Root Cause 又带"## 判定依据"，不允许借 no-op 的更低门槛绕过 verification-report
 * 与 implement/verify 双角色要求。
 * @param {string|null} fixReportContent
 * @returns {'repair'|'no-op'|'undetermined'}
 */
export function classifyClosureForm(fixReportContent) {
  const text = typeof fixReportContent === 'string' ? fixReportContent : '';
  const hasNoop = NOOP_JUDGMENT_HEADING_REGEX.test(text);
  const hasRepair = ROOT_CAUSE_HEADING_REGEX.test(text);
  if (hasNoop && hasRepair) return 'repair';
  if (hasNoop) return 'no-op';
  if (hasRepair) return 'repair';
  return 'undetermined';
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

  const closureForm = fixReport.exists ? classifyClosureForm(fixReport.content) : 'undetermined';
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
