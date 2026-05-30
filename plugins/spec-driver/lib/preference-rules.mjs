/**
 * preference-rules — 「工具优先使用规则」渲染核心（plugin-owned，自包含，无 root 依赖）
 *
 * canonical 渲染逻辑：从 templates/preference-rules.md 的 canonical 块按 agent frontmatter
 * tools 过滤规则行。被三处消费：
 *   - plugins/spec-driver/scripts/sync-preference-rules.mjs（生成 agent 块）
 *   - scripts/feature-170d-driver-preference.mjs（harness 注入，经 driver-eval-core 复用）
 *   - tests（经 driver-eval-core re-export）
 *
 * 设计意图：plugin 必须自包含（发布后不依赖仓库 root scripts/），故渲染逻辑落在 plugin lib。
 */

export const NS = 'mcp__plugin_spectra_spectra__';
export const BEGIN_MARKER = '<!-- BEGIN preference-rules (generated from templates/preference-rules.md; do not edit) -->';
export const END_MARKER = '<!-- END preference-rules -->';

const ROW_ANCHOR_RE = /<!--\s*preference-rules:(R\d)\s+tool=([a-z_]+)\s*-->/;
const ROWS_END_RE = /<!--\s*\/preference-rules:rows\s*-->/;
const SKIP_MARKER_RE = /<!--\s*preference-rules:(block-start|block-end|meta\b[^>]*)\s*-->/;
const BLOCK_START_RE = /<!--\s*preference-rules:block-start\s*-->/;
const BLOCK_END_RE = /<!--\s*preference-rules:block-end\s*-->/;

/**
 * 提取 canonical 块文本：若含 block-start/block-end marker 则取其间内容；
 * 否则原样返回（兼容仅传 block 内容的调用，如单测合成 TPL）。
 */
export function extractCanonicalBlock(templateText) {
  const lines = String(templateText ?? '').split('\n');
  const start = lines.findIndex((l) => BLOCK_START_RE.test(l));
  if (start < 0) return String(templateText ?? '');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (BLOCK_END_RE.test(lines[i])) { end = i; break; }
  }
  // fail-loud（codex C3）：有 block-start 却无 block-end → template 损坏，禁止静默截断到 EOF
  if (end < 0) {
    throw new Error('[preference-rules] template 含 block-start 但缺 block-end，拒绝静默截断');
  }
  return lines.slice(start + 1, end).join('\n');
}

/** 从 fully-qualified agentTools 提取 toolKey 集合（impact/context/detect_changes）。 */
export function toolKeysFromAgentTools(agentTools) {
  const keys = new Set();
  for (const t of agentTools || []) {
    if (typeof t === 'string' && t.startsWith(NS)) keys.add(t.slice(NS.length));
  }
  return keys;
}

/** 解析 agent .md frontmatter 的 tools: 行，返回 fully-qualified spectra MCP 工具数组。 */
export function parseFrontmatterTools(agentText) {
  const m = String(agentText ?? '').match(/^tools:\s*\[(.*)\]/m);
  if (!m) return [];
  const re = new RegExp(`${NS}\\w+`, 'g');
  return m[1].match(re) ?? [];
}

/**
 * 纯函数：按 agentTools 过滤 canonical 块的规则行，渲染「工具优先使用规则」块。
 * 入参可为完整 template 文本（含 block-start/block-end）或仅 block 内容；二者皆可。
 * 输出不含任何 anchor / block 注释。
 * @param {string} templateText
 * @param {string[]} agentTools 形如 ['mcp__plugin_spectra_spectra__impact', ...]
 * @returns {string}
 */
export function renderInjectionBlock(templateText, agentTools) {
  const keys = toolKeysFromAgentTools(agentTools);
  // 先抽取 canonical 块（丢弃 template 文件的人类文档头），再过滤规则行
  const lines = extractCanonicalBlock(templateText).split('\n');
  const out = [];
  let inRows = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_MARKER_RE.test(line)) continue;
    const anchor = line.match(ROW_ANCHOR_RE);
    if (anchor) {
      inRows = true;
      const tool = anchor[2];
      const rowLine = lines[i + 1] ?? '';
      if (keys.has(tool)) out.push(rowLine);
      i++;
      continue;
    }
    if (ROWS_END_RE.test(line)) { inRows = false; continue; }
    if (inRows) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** 将渲染块包裹 BEGIN/END marker（供 agent 文件嵌入）。 */
export function wrapWithMarkers(renderedBlock) {
  return `${BEGIN_MARKER}\n${renderedBlock.trimEnd()}\n${END_MARKER}`;
}
