/**
 * F190 scaffold-kb — CJK/符号感知的索引规范化（唯一 canonical 形式）
 *
 * 写入侧与查询侧共用同一个 `tokenize` / `normalizeForIndex`，保证同构（plan §4.1.2）。
 * 设计要点：
 * - SQLite FTS5 默认 unicode61 不切中文、对 `.`/`-`/`_` 等符号按分隔处理；
 *   故不依赖 tokenizer 的 CJK 感知，而是在写入/查询前把文本规范化成"空格分隔、
 *   unicode61 能逐 token 索引"的形式。
 * - CJK 连续段 → unigram + bigram（单字保证短查询不零召回，bigram 提精度）。
 * - ASCII 符号段（含 `._-<>@()/`）→ 各组件 + 拼接形（既能按组件查，也能按整符号查）；
 *   不保留原始 `sdk.Init()` 字面（unicode61 下必被切），不使用任何特殊编码。
 */

/** 符号内连接符：出现在 ASCII 符号串内部、需被拆成组件的字符 */
const SYMBOL_CONNECTOR = /[._\-<>@()/]/;
/** 单个 ASCII 字母数字 */
const ALNUM = /[A-Za-z0-9]/;
/** Han（CJK 表意文字）—— 用 Unicode Script 属性，覆盖主区 + 扩展区 */
const HAN = /\p{Script=Han}/u;

type CharClass = 'han' | 'ascii' | 'sep';

/**
 * Unicode 兼容归一化（NFKC）——**全仓唯一**一份实现。
 *
 * 把全角 ASCII（`ＡＰＩ１２３`）、兼容字符折叠为标准形。写入侧、查询侧与
 * `query-redaction.ts` 的 redaction 入口共用此函数：三者若各自归一化（或有先有后），
 * 就会出现「redaction 看到的是全角、落盘的是被还原成 ASCII 的敏感串」这类绕过
 * （F241 B2-1）。因此**禁止**在别处再写 `.normalize('NFKC')`。
 */
export function normalizeUnicode(text: string): string {
  return text.normalize('NFKC');
}

function classify(ch: string): CharClass {
  if (HAN.test(ch)) return 'han';
  if (ALNUM.test(ch) || SYMBOL_CONNECTOR.test(ch)) return 'ascii';
  return 'sep';
}

/**
 * 将 CJK 连续段展开为 unigram + bigram。
 * 例：`错误码` → ['错','误','码','错误','误码']
 */
function expandCjkRun(run: string): string[] {
  const chars = Array.from(run);
  const out: string[] = [];
  for (const c of chars) out.push(c); // unigrams
  for (let i = 0; i + 1 < chars.length; i++) {
    out.push(chars[i]! + chars[i + 1]!); // bigrams
  }
  return out;
}

/**
 * 将 ASCII 符号段拆为组件 + 拼接形。
 * 例：`sdk.Init()` → ['sdk','Init','sdkInit']；`E01` → ['E01']；`hello` → ['hello']
 */
function expandAsciiRun(run: string): string[] {
  const components = run.split(/[._\-<>@()/]+/).filter((s) => s.length > 0);
  if (components.length === 0) return [];
  if (components.length === 1) return [components[0]!];
  const joined = components.join('');
  return [...components, joined];
}

/**
 * 把文本切成有序 token 数组（写入侧与查询侧共用）。
 *
 * - 按字符类别（han / ascii / sep）切分为 run；sep run 丢弃
 * - han run → unigram + bigram
 * - ascii run → 组件 + 拼接形
 */
export function tokenize(rawText: string): string[] {
  // NFKC 规范化：避免全角字符被当 sep 静默丢弃（修 Codex WARNING）。
  // 写入侧、查询侧与 redaction 入口共用 normalizeUnicode → 仍同构。
  const text = normalizeUnicode(rawText);
  const tokens: string[] = [];
  let runStart = 0;
  let runClass: CharClass | null = null;

  const flush = (end: number): void => {
    if (runClass === null) return;
    const run = text.slice(runStart, end);
    if (runClass === 'han') tokens.push(...expandCjkRun(run));
    else if (runClass === 'ascii') tokens.push(...expandAsciiRun(run));
  };

  const chars = Array.from(text);
  let byteIdx = 0;
  for (const ch of chars) {
    const cls = classify(ch);
    if (cls !== runClass) {
      flush(byteIdx);
      runStart = byteIdx;
      runClass = cls;
    }
    byteIdx += ch.length;
  }
  flush(byteIdx);
  return tokens;
}

/**
 * 规范化为 FTS5 索引/查询用的空格分隔字符串。
 * `normalizeForIndex(t) === tokenize(t).join(' ')`，写入与查询同构的单一事实源。
 */
export function normalizeForIndex(text: string): string {
  return tokenize(text).join(' ');
}

/**
 * 规范化到「同一问题」的等价类字符串：`normalizeForIndex` 之上再做 case-fold 与去重。
 *
 * 用途是判定两次查询是不是同一个问题（F241 的 `normalizedQueryHash`）。
 * 只做 NFKC + 切词不足以收敛：`retry alpha` 与 `retry Alpha` 会得到两个 hash，
 * 于是同一个问题问两遍就能把共同 term 顶过 `distinctQueries` 阈值（F241 B2-6）。
 *
 * 保留 token 首次出现顺序（不排序）：词序不同的查询仍算不同问题。
 */
export function normalizeForEquivalence(text: string): string {
  return [...new Set(tokenize(text).map((t) => t.toLowerCase()))].join(' ');
}
