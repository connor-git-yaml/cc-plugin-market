/**
 * delegation-contract — 「编排器必须委派子代理」硬约束块渲染核心（plugin-owned，自包含，无 root 依赖）
 *
 * canonical 源：templates/delegation-contract.md 的 block-start/block-end 之间内容。
 * 与 preference-rules 不同：delegation-contract 是**整块原样注入**（无 per-row tool 过滤），
 * 被注入到 5 个主编排器 SKILL.md 正文（fix/story/feature/implement/resume）。
 *
 * 被两处消费：
 *   - plugins/spec-driver/scripts/sync-delegation-contract.mjs（按各 SKILL 锚点注入约束块）
 *   - tests（纯函数级断言）
 *
 * 设计意图：plugin 必须自包含（发布后不依赖仓库 root scripts/），故渲染逻辑落在 plugin lib。
 */

export const BEGIN_MARKER = '<!-- BEGIN delegation-contract (generated from templates/delegation-contract.md; do not edit) -->';
export const END_MARKER = '<!-- END delegation-contract -->';

const BLOCK_START_RE = /<!--\s*delegation-contract:block-start\s*-->/;
const BLOCK_END_RE = /<!--\s*delegation-contract:block-end\s*-->/;

/**
 * 提取 canonical 块文本：取 block-start/block-end marker 之间的内容。
 * 若无 block-start → 原样返回（兼容单测直接传 block 内容的场景）。
 * 有 block-start 却无 block-end → fail-loud（对齐 preference-rules，禁止静默截断到 EOF）。
 */
export function extractCanonicalBlock(templateText) {
  const lines = String(templateText ?? '').split('\n');
  const start = lines.findIndex((l) => BLOCK_START_RE.test(l));
  if (start < 0) return String(templateText ?? '');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (BLOCK_END_RE.test(lines[i])) { end = i; break; }
  }
  if (end < 0) {
    throw new Error('[delegation-contract] template 含 block-start 但缺 block-end，拒绝静默截断');
  }
  return lines.slice(start + 1, end).join('\n');
}

/** 将 canonical 块包裹 BEGIN/END marker（供 SKILL 文件嵌入）。 */
export function wrapWithMarkers(block) {
  return `${BEGIN_MARKER}\n${String(block).trimEnd()}\n${END_MARKER}`;
}

/**
 * 计算 SKILL 文件应有的内容（注入或替换约束块）。
 * - 若已含 BEGIN..END → 仅替换 marker 之间内容（锚点不移动，幂等）。
 * - 否则 → 在 anchorHeading 行**之后**（紧随该标题行的下一行）插入 wrapped 块，前后各留一空行。
 * - anchorHeading 在 skillText 中未找到 → fail-loud（不静默跳过）。
 *
 * @param {string} skillText SKILL.md 全文
 * @param {string} templateText delegation-contract.md 全文（或仅 block 内容）
 * @param {string} anchorHeading 形如 '## 工作流定义'，必须与 SKILL 中某行完整匹配
 * @returns {string}
 */
export function computeExpectedSkillContent(skillText, templateText, anchorHeading) {
  const block = extractCanonicalBlock(templateText);
  const wrapped = wrapWithMarkers(block);

  const beginIdx = skillText.indexOf(BEGIN_MARKER);
  // 在 BEGIN 之后查找 END，避免匹配到文档引用里的字面 marker
  const endIdx = beginIdx >= 0 ? skillText.indexOf(END_MARKER, beginIdx + BEGIN_MARKER.length) : -1;
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = skillText.slice(0, beginIdx);
    const after = skillText.slice(endIdx + END_MARKER.length);
    return before + wrapped + after;
  }
  // fail-loud（codex CRITICAL）：孤儿 BEGIN（有 BEGIN 无 END，如手动截断/上次写入中断）若放行
  // 会落入首次插入路径 → 文件出现双 BEGIN 单 END，且此后 --check 稳定假绿，守护永远看不见
  if (beginIdx >= 0) {
    throw new Error('[delegation-contract] SKILL 含 BEGIN marker 但缺 END marker（畸形块），拒绝重复注入；请手动修复或删除残块后重跑 sync');
  }

  // 首次插入：定位锚点标题行
  const lines = skillText.split('\n');
  const anchorIdx = lines.findIndex((l) => l === anchorHeading);
  if (anchorIdx < 0) {
    throw new Error(`[delegation-contract] 锚点未找到: ${JSON.stringify(anchorHeading)}`);
  }
  // 在锚点标题行之后插入，前后各留一空行
  const head = lines.slice(0, anchorIdx + 1).join('\n');
  const tail = lines.slice(anchorIdx + 1).join('\n').replace(/^\n+/, '');
  return `${head}\n\n${wrapped}\n\n${tail}`;
}
