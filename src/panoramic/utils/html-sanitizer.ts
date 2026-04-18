/**
 * Block-level HTML 净化工具
 *
 * Feature 125: 替代 Fix 124 的粗暴 `<[^>]+>` 全量 strip，
 * 只处理**行首锚定**的 HTML block，保留合法行内尖括号内容
 * （TypeScript 泛型、CLI 占位符、数值比较等）。
 *
 * 设计原则：
 * 1. 只识别常见 HTML block 元素（p/div/img/br/hr/h1-6/details/summary/table/iframe）
 * 2. 行首锚定：以 `^\s*<tag` 开头才判定为 block
 * 3. `<details>/<summary>` 保留内部文字内容（不粗暴剥除语义节点）
 * 4. 支持 HTML entity 解码（&lt; &gt; &amp; &quot; &#xxx;）
 */

/** 常见的 block-level HTML 标签 */
const BLOCK_TAGS = [
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav',
  'img', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'iframe', 'pre', 'ul', 'ol', 'li', 'blockquote',
];
const BLOCK_TAG_PATTERN = BLOCK_TAGS.join('|');

/**
 * 判定一行是否以 block HTML 开头（行首锚定，忽略缩进）
 */
const BLOCK_START_RE = new RegExp(`^\\s*<(${BLOCK_TAG_PATTERN})\\b[^>]*>`, 'i');
const BLOCK_SELF_CLOSING_RE = new RegExp(`^\\s*<(${BLOCK_TAG_PATTERN})\\b[^>]*\\/?\\s*>$`, 'i');

/**
 * 提取 `<details>...</details>` 中的文字内容
 * 保留 summary 内容（若有）和 details 内容，移除其他标签
 */
function extractDetailsContent(text: string): string {
  // 捕获最外层 details 块内容
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  return text.replace(detailsRe, (_, inner: string) => {
    // 提取 summary 内容
    let result = inner.replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, '$1');
    // 移除 details 内可能的其他 block 标签，保留文字
    result = result.replace(/<\/?(?:p|div|section|article)\b[^>]*>/gi, ' ');
    return result.trim();
  });
}

/**
 * 剥除行首锚定的 block HTML 标签，保留内部文字和行内内容
 *
 * 行为：
 *   - 逐行处理：整行为 block HTML 开头（如 `<p>...`）则剥除标签，保留内部文字
 *   - 对 `<details>/<summary>` 的嵌套块先做结构化提取（保留语义内容）
 *   - 不处理行内尖括号（`Array<T>`、`<target>`、`a < b` 等全部保留）
 *   - 多行 block（如 `<div>\n...\n</div>`）按块合并处理
 */
export function stripBlockHtml(text: string): string {
  if (!text) return text;

  // Step 1: 先处理 <details> 块（保留内部文字）
  let result = extractDetailsContent(text);

  // Step 2: 移除行首锚定的 block tag（开标签/闭标签/自闭合）
  // 逐行扫描，识别连续的 block 段
  const lines = result.split('\n');
  const cleaned: string[] = [];
  let inBlock = false;
  let blockTag = '';
  let blockContent: string[] = [];

  for (const line of lines) {
    if (inBlock) {
      // 在多行 block 内，寻找闭标签
      const closeRe = new RegExp(`</${blockTag}\\s*>`, 'i');
      const closeMatch = line.match(closeRe);
      if (closeMatch && closeMatch.index !== undefined) {
        // 闭合前内容保留
        blockContent.push(line.slice(0, closeMatch.index));
        const after = line.slice(closeMatch.index + closeMatch[0].length);
        const blockText = blockContent.join(' ').replace(/<[^>]+>/g, ' ').trim();
        if (blockText) cleaned.push(blockText);
        if (after.trim()) cleaned.push(after);
        inBlock = false;
        blockTag = '';
        blockContent = [];
      } else {
        blockContent.push(line);
      }
      continue;
    }

    // 未在 block 内：检测行首是否为 block 开标签
    const blockStart = line.match(BLOCK_START_RE);
    if (!blockStart) {
      cleaned.push(line);
      continue;
    }

    blockTag = (blockStart[1] ?? '').toLowerCase();
    const startIdx = (blockStart.index ?? 0) + blockStart[0].length;
    const afterOpen = line.slice(startIdx);

    // 自闭合（`<img .../>` 或 void 标签如 `<br>`、`<hr>`、`<img>`）
    if (
      BLOCK_SELF_CLOSING_RE.test(line) ||
      ['br', 'hr', 'img'].includes(blockTag)
    ) {
      if (afterOpen.trim()) cleaned.push(afterOpen);
      blockTag = '';
      continue;
    }

    // 同一行包含闭合
    const sameLineCloseRe = new RegExp(`</${blockTag}\\s*>`, 'i');
    const sameLineClose = line.match(sameLineCloseRe);
    if (sameLineClose && sameLineClose.index !== undefined) {
      const innerStart = startIdx;
      const innerEnd = sameLineClose.index;
      const inner = line.slice(innerStart, innerEnd).replace(/<[^>]+>/g, ' ').trim();
      const after = line.slice(sameLineClose.index + sameLineClose[0].length);
      if (inner) cleaned.push(inner);
      if (after.trim()) cleaned.push(after);
      blockTag = '';
      continue;
    }

    // 多行 block，进入 block 模式
    inBlock = true;
    if (afterOpen.trim()) blockContent.push(afterOpen);
  }

  // 未闭合的 block（容错）
  if (inBlock && blockContent.length > 0) {
    const tail = blockContent.join(' ').replace(/<[^>]+>/g, ' ').trim();
    if (tail) cleaned.push(tail);
  }

  return cleaned.join('\n');
}

/**
 * 解码常见的 HTML entity：&lt; &gt; &amp; &quot; &apos; &nbsp; 以及数字实体
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;

  const namedEntities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': ' ',
    '&copy;': '©',
    '&reg;': '®',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
  };

  let result = text;
  // 先处理命名实体
  for (const [entity, decoded] of Object.entries(namedEntities)) {
    result = result.split(entity).join(decoded);
  }
  // 数字实体 &#123; &#xAB;
  result = result.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCodePoint(Number(code)),
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
  // &amp; 可能引入其他 entity（如 &amp;lt; -> &lt; -> <），再跑一轮
  for (const [entity, decoded] of Object.entries(namedEntities)) {
    result = result.split(entity).join(decoded);
  }

  return result;
}

/**
 * 一步完成：block HTML 剥除 + entity 解码。
 * 这是 product-ux-docs 的主要调用点。
 */
export function sanitizeMarkdownContent(text: string): string {
  return decodeHtmlEntities(stripBlockHtml(text));
}
