/**
 * F271 — symbol 节点 `metadata.lineRange` 的单点定义（结构校验 + 并集 + 退化条目识别）。
 *
 * 三个生产端共用同一套判据，避免镜像实现各自漂移：
 *   1. knowledge-graph/index.ts  deriveNodesFromSkeletons（unified 主路径）
 *   2. adapters/python-adapter.ts extractSymbolNodes（Python extraction 第四路）
 *   3. panoramic/graph/graph-builder.ts 五路合流（unified → GraphJSON 透传）
 *
 * 为什么必须严格校验：消费端（file-nav-tools 按行切片源文件、agent-context-tools 的
 * definition 行号）拿到畸形值不会报错，只会静默给出错误定位——比缺席更有害。
 * 不满足判据一律「诚实缺席」（返回 undefined，不写该 key）。
 */

/** graph 节点 metadata.lineRange 的形状（1-indexed，闭区间） */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * tree-sitter regex fallback 给 ExportSymbol.signature 打的前缀。
 * `src/core/tree-sitter-fallback.ts` 里三条退化提取路径（python / go / java-like）都打这个前缀，
 * 且三者的 `startLine`/`endLine` 一律是"匹配到的那一行"（`i + 1`）。
 */
export const REGEX_FALLBACK_SIGNATURE_PREFIX = '[REGEX] ';

/**
 * 判定该 ExportSymbol 是否来自 regex 退化解析。
 *
 * 退化条目的 span 恒为「签名所在的那一行」（startLine === endLine === 匹配行号），
 * 不是真实的符号 span——把它写进 lineRange 会让 view_file(symbolId) 把一个多行函数
 * 切成一行，agent 看到的是"函数只有签名"的假象。宁可缺席，让消费端走整文件/默认窗口。
 */
export function isRegexFallbackSymbol(signature: string | null | undefined): boolean {
  return typeof signature === 'string' && signature.startsWith(REGEX_FALLBACK_SIGNATURE_PREFIX);
}

/**
 * 结构校验 + 归一化：start/end 必须是整数、1-indexed（>= 1）、且 start <= end。
 *
 * 接受任意 unknown 输入（graph-builder 侧读到的是 `Record<string, unknown>`），
 * 不满足判据返回 undefined。
 */
export function normalizeLineRange(raw: unknown): LineRange | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const { start, end } = raw as { start?: unknown; end?: unknown };
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  const s = start as number;
  const e = end as number;
  if (s < 1 || e < s) return undefined;
  return { start: s, end: e };
}

/**
 * 两个 span 取并集（`{ start: min, end: max }`）。
 *
 * 用于同名符号折叠：Python 条件定义/遮蔽、TS 函数重载、declaration merging 会让同一个
 * canonical id 对应多条 ExportSymbol。first-wins 丢弃后续条目会把 lineRange 钉在第一条上
 * ——重载场景下第一条往往只是签名行，函数体整段落在 view_file 视野之外。
 */
export function mergeLineRanges(a: LineRange, b: LineRange): LineRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/**
 * 从 ExportSymbol（或任何带 signature/startLine/endLine 的条目）取合法 lineRange。
 *
 * 两道闸：regex 退化条目直接缺席（假 span），其余走 normalizeLineRange 结构校验。
 */
export function lineRangeFromSymbol(symbol: {
  signature?: string | null;
  startLine?: unknown;
  endLine?: unknown;
}): LineRange | undefined {
  if (isRegexFallbackSymbol(symbol.signature)) return undefined;
  return normalizeLineRange({ start: symbol.startLine, end: symbol.endLine });
}
