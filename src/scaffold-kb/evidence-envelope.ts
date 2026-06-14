/**
 * F190/F191 — untrusted-evidence envelope 共享工具（从 kb-search 抽出，kb-search + injection-format 同源）
 *
 * 信任边界（F190 FR-011 / SC-010）：把 KB 检索内容包成定界 evidence 区，
 * 中和内嵌 sentinel（防提前闭合逃逸）、编码属性值、surrogate-safe 截断。
 * 依赖方向：本模块在 scaffold-kb，不 import kb-mcp（SourceKind 取自 ./types）。
 */

import type { SourceKind } from './types.js';

/** envelope 属性值编码：去除可破坏头部的 `]` `"` 换行（防注入逃逸） */
export function safeAttr(v: string): string {
  return v.replace(/[\]"\r\n]/g, ' ');
}

/** 中和正文内的 envelope sentinel，防止提前闭合把注入文本放到 envelope 外（trust boundary） */
export function defangSentinel(content: string): string {
  return content
    .replace(/\[\s*\/\s*KB-EVIDENCE\s*\]/gi, '[ /KB-EVIDENCE ]')
    .replace(/\[\s*KB-EVIDENCE/gi, '[ KB-EVIDENCE');
}

/** 按 UTF-16 code unit 截断但不切开代理对（避免孤立 surrogate） */
export function safeTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // 末位是高代理 → 回退一位
  return s.slice(0, end);
}

/** 把单条内容包成 `[KB-EVIDENCE …]…[/KB-EVIDENCE]` evidence 块 */
export function buildEvidenceEnvelope(
  content: string,
  docId: string,
  src: SourceKind,
  builtAt: string,
): string {
  return `[KB-EVIDENCE doc_id="${safeAttr(docId)}" src="${src}" built_at="${safeAttr(builtAt)}"]\n${defangSentinel(content)}\n[/KB-EVIDENCE]`;
}
