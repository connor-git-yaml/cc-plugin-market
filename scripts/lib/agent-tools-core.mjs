/**
 * agent-tools-core.mjs
 * FR-017 —— spec-driver 子代理 frontmatter `tools` 面的结构守护（Feature 277）
 *
 * 为什么必须新建一族而不是扩 `namespace-consistency`：后者取到 `tools` 后立即
 * `filter((t) => t.startsWith('mcp__'))`（`namespace-consistency-core.mjs:133-134`），
 * 后续两个判定分支只看 `mcpTools`——`Edit` / `Bash` 在它眼里结构性不可见；
 * 而它又对在册文件强制「必须含 `mcp__` 工具」，把 `specify` / `tasks` 直接加进它的
 * `AGENT_FILES` 会凭空造出 2 个必红。故解析器复用、判定另起一族。
 *
 * 断言集共 8 条（换算式 6 + 1 + 1 = 8，单位：断言条；与 SC-003 的分母同源）：
 *   (i)   正向 6：`specify` / `plan` / `tasks` 三份 agent × `Edit` / `Bash` 两个工具
 *   (ii)  护栏 1：`agents/verify.md` 的 `tools` 与冻结快照**逐字相等**（含顺序）
 *   (iii) 文本 1：协议文本对 verify 标注「不适用」**且**附 FR-016 (ii) 的独立性口径声明
 *
 * (ii) 的比对源**是钉在本文件里的落地时快照**，不是运行时自取——运行时自取会让
 * 「当前值 == 当前值」恒真，测不出任何新增。
 * (ii) 的判据在 Phase A 对抗修订第二轮由「单向集合差（只判新增）」改为**逐字相等**
 * （β-C1）：单向集合差的射程是「解析器看得见的那几项」，输入残缺时射程缩到零而结论
 * 仍是 pass。逐字相等把射程钉死在快照的 6 项上，它**严格强于** FR-017 (ii) 的
 * 「不得新增任何工具项」——删减与改序原先只进 detail 附注，现在一并判红。
 *
 * (iii) 明确**不使用**「断言 verify 的 tools 不含 Write / Edit」：该断言在现状下恒真、
 * 且测的是与独立性无关的量（verify 实测持有 `Bash`，写能力并未封闭）。
 *
 * 依赖纪律（FR-037）：零 npm 依赖；除 `node:` 内置外只从**同目录第一方** helper
 * 复用 frontmatter 解析器（见 D-6 对 FR-037 可执行内核的读法）。
 * FR-045：catch 分支禁止返回空结果或 pass。
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractFrontmatterTools } from './namespace-consistency-core.mjs';

export { extractFrontmatterTools };

/** 正向断言的三份 agent（不含 `verify`——协议对它不适用，见 (iii)） */
export const REQUIRED_TOOL_AGENTS = Object.freeze(['specify', 'plan', 'tasks']);

/**
 * 必须在场的两个工具。
 * `Edit` 撑 FR-014 的「逐节 Edit 填充」；`Bash` 撑 FR-027 / FR-028 / FR-030 的
 * 「原样复跑检索命令取实际输出计数」与 `git show <sha>:<path>` 历史原文引用。
 * 只补 `Edit` 是治了一半。
 */
export const REQUIRED_TOOLS = Object.freeze(['Edit', 'Bash']);

/** 护栏断言的对象 */
export const VERIFY_AGENT = 'verify';

/**
 * `agents/verify.md` 的 `tools` 在 Feature 277 落地时点的**逐字快照**。
 * FR-016 (i) 的护栏比对源。改这个常量 == 主动放宽护栏，须走 spec 修订。
 *
 * 比对语义是**逐字相等（含顺序）**，不是单向集合差（Phase A 对抗修订第二轮 · β-C1）：
 * 单向集合差 `added = 实测 \ 快照` 对**残缺输入恒真**——解析器每漏读一项 `added` 就少
 * 一项，完全读不出时 `added = ∅`，于是「解析器失效」与「确实零新增」在那条判据上是
 * 同一个观测值。射程（要比几项）由被比对的那份数据自己决定，是本条的根因。
 * 逐字相等把射程钉死为快照的 6 项：少一项、多一项、换个顺序都判红。
 */
export const VERIFY_TOOLS_FROZEN_SNAPSHOT = Object.freeze([
  'Read',
  'Bash',
  'Grep',
  'Glob',
  'mcp__plugin_spectra_spectra__detect_changes',
  'mcp__plugin_spectra_spectra__impact',
]);

/** 文本断言的事实源：共享块 1 的单一事实源（Phase C 新建） */
export const PROTOCOL_TEXT_SOURCE = 'plugins/spec-driver/templates/agent-output-discipline.md';

/**
 * FR-016 (ii) 要求的独立性口径声明的**短语契约**（机器可读的落地目标）。
 * 逐条对应 plan Phase C 落点 1 点名的那段原文；比对前先做 markdown 归一化
 * （去 `*` 与反引号），使 `**持有 `Bash`**` 这类排版不影响判定。
 */
export const PROTOCOL_VERIFY_DISCLOSURE_PHRASES = Object.freeze([
  '不适用',
  '不得为其新增任何工具项',
  '持有 Bash',
  '写能力未在工具层封闭',
  '自律',
  '未取得',
]);

/** 文本断言还要求该段确实在谈 verify 这份 agent */
const PROTOCOL_SUBJECT_ANCHOR = 'verify.md';

const AGENTS_DIR = 'plugins/spec-driver/agents';

/** 去掉 markdown 强调排版，使短语比对不被 `**` / 反引号切断 */
function normalizeProse(text) {
  return text.replace(/[*`_]/g, '');
}

/**
 * 把实测 `tools` 与冻结快照做**逐字相等**比对，并给出可读的差异归因。
 *
 * 三类差异都判红，因为三类都改变了 verify 的实际工具面或其可核对性：
 * 新增（扩写面）、删减（快照失去比对基准，且多半是解析器读残）、
 * 同集不同序 / 重复度不同（YAML 里逐字不同，快照不再是「逐字快照」）。
 *
 * @param {string[]} tools
 * @returns {{ equal: boolean, added: string[], removed: string[], reason: string }}
 */
function diffAgainstFrozenSnapshot(tools) {
  const snapshot = [...VERIFY_TOOLS_FROZEN_SNAPSHOT];
  const equal = tools.length === snapshot.length && tools.every((t, i) => t === snapshot[i]);
  const added = tools.filter((t) => !snapshot.includes(t));
  const removed = snapshot.filter((t) => !tools.includes(t));
  if (equal) return { equal, added, removed, reason: '' };

  const parts = [];
  if (added.length > 0) parts.push(`新增 [${added.join(', ')}]`);
  if (removed.length > 0) parts.push(`删减 [${removed.join(', ')}]`);
  if (parts.length === 0) parts.push('条目集合相同但顺序或重复度不同');
  return { equal, added, removed, reason: parts.join('；') };
}

/**
 * 读文本；文件不存在返回 null，其他 I/O 错误上抛（由族入口的 catch 收敛为 fail）。
 * 「不存在」与「读不动」是两个事实，不合并——合并会让权限问题伪装成缺席。
 */
function readTextOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function makeAssertion(id, kind, title, ok, detail) {
  return { id, kind, title, status: ok ? 'pass' : 'fail', detail };
}

/**
 * 逐条求值 8 条断言。
 *
 * **纯函数**：输入是已读好的事实，不碰文件系统——这样每条断言的变异体都能被
 * 独立构造，不必先把仓库改坏。
 *
 * 判不出⇒从严：任一输入取不到，对应断言一律判 `fail`，绝不因「读不到」默认放行。
 *
 * @param {object} input
 * @param {Record<string, string[]|null|undefined>} [input.toolsByAgent] agent 名 → tools 数组；null 表示文件缺席
 * @param {string[]|null|undefined} [input.verifyTools] `agents/verify.md` 的 tools
 * @param {string|null|undefined} [input.protocolText] 协议文本全文；null 表示事实源缺席
 * @returns {Array<{id: string, kind: string, title: string, status: 'pass'|'fail', detail: string}>}
 */
export function evaluateAgentToolsAssertions({ toolsByAgent, verifyTools, protocolText } = {}) {
  const assertions = [];

  // (i) 正向 6 条
  for (const agent of REQUIRED_TOOL_AGENTS) {
    const tools = toolsByAgent ? toolsByAgent[agent] : undefined;
    for (const tool of REQUIRED_TOOLS) {
      const id = `tools:${agent}:${tool}`;
      const title = `agents/${agent}.md 的 tools 含 ${tool}`;
      if (!Array.isArray(tools)) {
        assertions.push(makeAssertion(
          id, 'required-tool', title, false,
          `取不到 ${AGENTS_DIR}/${agent}.md 的 tools（文件缺席或 frontmatter 无 tools 字段）——判不出⇒判失败`,
        ));
        continue;
      }
      const present = tools.includes(tool);
      assertions.push(makeAssertion(
        id, 'required-tool', title, present,
        present
          ? `tools = [${tools.join(', ')}]`
          : `${AGENTS_DIR}/${agent}.md 的 tools 缺 ${tool}；实测 tools = [${tools.join(', ')}]`,
      ));
    }
  }

  // (ii) 护栏 1 条 —— 与冻结快照**逐字相等**（含顺序），任何差异都判红
  {
    const id = `${VERIFY_AGENT}:tools-frozen`;
    const title = `agents/${VERIFY_AGENT}.md 的 tools 与冻结快照逐字相等`;
    if (!Array.isArray(verifyTools)) {
      assertions.push(makeAssertion(
        id, 'guard', title, false,
        `取不到 ${AGENTS_DIR}/${VERIFY_AGENT}.md 的 tools——判不出⇒判失败`,
      ));
    } else {
      const diff = diffAgainstFrozenSnapshot(verifyTools);
      assertions.push(makeAssertion(
        id, 'guard', title, diff.equal,
        diff.equal
          ? `与冻结快照逐字相等：[${verifyTools.join(', ')}]`
          : `与冻结快照不一致——${diff.reason}；`
            + `实测 [${verifyTools.join(', ')}]，冻结快照 [${VERIFY_TOOLS_FROZEN_SNAPSHOT.join(', ')}]`
            + '（新增即扩写面、删减即失去比对基准，两者都须走 spec 修订）',
      ));
    }
  }

  // (iii) 文本 1 条
  {
    const id = 'protocol:verify-not-applicable-disclosure';
    const title = '协议文本对 verify 标注「不适用」且附 FR-016 (ii) 独立性口径声明';
    if (typeof protocolText !== 'string') {
      assertions.push(makeAssertion(
        id, 'text', title, false,
        `协议文本事实源缺席：${PROTOCOL_TEXT_SOURCE}（共享块 1，由 Phase C 新建；Phase A 时点预期红）`,
      ));
    } else {
      const prose = normalizeProse(protocolText);
      const missing = PROTOCOL_VERIFY_DISCLOSURE_PHRASES.filter((p) => !prose.includes(p));
      const hasSubject = prose.includes(PROTOCOL_SUBJECT_ANCHOR);
      const ok = hasSubject && missing.length === 0;
      const reasons = [];
      if (!hasSubject) reasons.push(`未指名 ${PROTOCOL_SUBJECT_ANCHOR}`);
      if (missing.length > 0) reasons.push(`缺短语 [${missing.join(', ')}]`);
      assertions.push(makeAssertion(
        id, 'text', title, ok,
        ok
          ? `${PROTOCOL_TEXT_SOURCE} 含全部 ${PROTOCOL_VERIFY_DISCLOSURE_PHRASES.length} 条短语契约`
          : `${PROTOCOL_TEXT_SOURCE}：${reasons.join('；')}——缺独立性口径声明即判 FAIL`,
      ));
    }
  }

  return assertions;
}

/**
 * `repo:check` 族入口。
 *
 * @param {object} params
 * @param {string} params.projectRoot
 * @returns {{status: 'pass'|'fail', checks: Array, warnings: string[], errors: string[]}}
 */
export function validateAgentTools({ projectRoot }) {
  const resolvedRoot = path.resolve(projectRoot);
  let assertions;

  try {
    const toolsByAgent = {};
    for (const agent of [...REQUIRED_TOOL_AGENTS, VERIFY_AGENT]) {
      const content = readTextOrNull(path.join(resolvedRoot, AGENTS_DIR, `${agent}.md`));
      toolsByAgent[agent] = content === null ? null : extractFrontmatterTools(content);
    }
    const protocolText = readTextOrNull(path.join(resolvedRoot, PROTOCOL_TEXT_SOURCE));

    assertions = evaluateAgentToolsAssertions({
      toolsByAgent,
      verifyTools: toolsByAgent[VERIFY_AGENT],
      protocolText,
    });
  } catch (err) {
    // FR-045：catch 分支禁止返回空结果或 pass。读不出 frontmatter 时默认放行，
    // 等于把「三个子代理有没有 Edit / Bash」这个量重新变成不可见。
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      checks: [{
        id: 'required',
        title: 'spec-driver 子代理 tools 面的 8 条断言',
        status: 'fail',
        evidence: { degraded: true, reason: `工具面守护项内部错误：${message}`, assertions: [] },
      }],
      warnings: [],
      errors: [`工具面守护项内部错误（判不出⇒判失败，不放行）：${message}`],
    };
  }

  const failed = assertions.filter((a) => a.status === 'fail');
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    checks: [{
      id: 'required',
      title: 'spec-driver 子代理 tools 面的 8 条断言',
      status: failed.length === 0 ? 'pass' : 'fail',
      evidence: {
        assertions,
        passed: assertions.length - failed.length,
        total: assertions.length,
      },
    }],
    warnings: [],
    errors: failed.map((a) => `${a.id}：${a.title} —— ${a.detail}`),
  };
}
