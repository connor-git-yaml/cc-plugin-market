/**
 * sync-fr-floor.mjs — fr-floor 的**独立**取数路径（M11 簇④ 第 11 项，对抗审查 C-2 后重写）。
 *
 * 首版 `collectFREntryIds` 与抽取器 `extractFunctionalRequirements` 共享全部判据（同一 classifyLines / FR_ENTRY_HEAD /
 * FR_RANGE_TAIL），于是 floor ≡ 抽取去重集大小——178 份真 spec 恒等 178/178、20,000 份随机文档零反例：它守的只是
 * 「命中之后的 flush 逻辑」，对判据本身的收窄完全失明，且 detail 文案「原文 N 条」对源文档说了假话。
 *
 * 本模块**不 import 引擎的任何正则 / helper**，自己实现围栏跟踪与条目行形态判据。覆盖面与抽取器约定的条目形态相同
 * （列表位 / 标题位 / 行首粗体段落；排除 fenced code、区间标签、缩进续行），但实现独立——判据改坏一边时另一边仍会报数。
 * 表格行 / 反引号包裹 / 引用块**不算条目**（那些是候选，由 candidate-not-extracted lint 兜住），否则 floor 会在
 * 「需求写成表格」的合法 spec 上假红。
 */

const FLOOR_FENCE = /^\s*(?:`{3,}|~{3,})/;
// 行首（不缩进）的三种条目载体：`- ` / `* ` / `+ ` / `1. ` / `1) ` 列表位、`###`~`######` 标题位、`**` 粗体段落；
// 载体后可紧跟 `**`（粗体编号），编号后允许 `**`、冒号、破折号、空白或行尾。
const FLOOR_ENTRY = /^(?:(?:[-*+]|\d+[.)])[ \t]+\**|#{3,6}[ \t]+\**|\*\*)FR-(?:[A-Z]-?)?\d{1,3}(?:\.\d+)*(?:[A-Za-z]|-(?!FR-)[A-Za-z0-9]+)?(?=\*|[:：]|[ \t]|$)/;
const FLOOR_ID = /FR-(?:[A-Z]-?)?\d{1,3}(?:\.\d+)*(?:[A-Za-z]|-(?!FR-)[A-Za-z0-9]+)?/;
// 编号后紧跟区间符再接编号（`~ FR-005` / `～005` / `— FR-003`）是分组标签，不是条目
const FLOOR_RANGE = /^\**[ \t]*(?:[~～][ \t]*\**(?:FR-)?\d|[–—-][ \t]*\**FR-)/;

/**
 * 需求节正文里「按条目写法」出现的 FR 编号集合（去重）。
 * @param {string} sectionContent
 * @returns {Set<string>}
 */
export function scanRequirementEntryIds(sectionContent) {
  const ids = new Set();
  let inFence = false;
  for (const rawLine of String(sectionContent ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (FLOOR_FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const head = FLOOR_ENTRY.exec(line);
    if (!head) continue;
    const id = FLOOR_ID.exec(head[0])[0];
    if (FLOOR_RANGE.test(line.slice(head[0].length))) continue;
    ids.add(id);
  }
  return ids;
}
