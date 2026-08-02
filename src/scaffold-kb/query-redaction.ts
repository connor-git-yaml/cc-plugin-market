/**
 * F241 E1 — 查询串 redaction 第一层（FR-012）
 *
 * 用途：no-hit 治理记录**入库前**对查询串做结构性遮蔽。规则以数据表声明（非散落正则），
 * 便于测试穷举与后续扩充。
 *
 * ## 能力边界（D5 残余风险，如实声明，不冒充"已脱敏"）
 *
 * 本规则集**只覆盖结构上可判别的形态**。以下敏感内容**检测不到**，落盘的 `terms` 里仍可能出现：
 * - 中文姓名、内部项目代号、内部主机名等无结构特征的专有名词；
 * - 自然语言口令（"密码是芝麻开门"）；
 * - 带分隔符的电话号码（`138-0013-8000` 被拆成 <8 位数字段，不触发 DIGITS）；
 * - 非 npm/URL 形态的密钥（自定义前缀、纯小写短串）；
 * - 无点域名的地址形态（`user@localhost`）——EMAIL 判据要求域名含点，内网/单标签域名不命中。
 *
 * ## 归一化前置（F241 B2-1）
 *
 * 入口先过 `tokenizer.ts::normalizeUnicode`（NFKC）**再**匹配规则。顺序颠倒会开一个绕过口子：
 * 全角 `１２３４５６７８` 躲过 `DIGITS`，随后仍被落盘侧的 tokenizer 还原成 ASCII 数字。
 * 归一化只有一份实现（tokenizer 导出），此处禁止再写 `.normalize('NFKC')`。
 *
 * 反向边界（过度遮蔽）：`HIGH_ENTROPY` 按 spec 定义为「长度 ≥ 20 的 hex / base64 字符集连续片段」，
 * 该判据不区分随机串与普通长单词/长路径段，因此 ≥20 字符的普通英文词或长目录名也会被遮蔽。
 * 这会损失少量 coverage-gap 信号，但方向是**偏保守**（宁可多遮），符合治理数据的隐私取向。
 *
 * 本模块与 `query-sanitizer.ts::sanitizeQuery`（FTS5 语法构造）、
 * `evidence-envelope.ts::defangSentinel`（防注入拆解）**语义无关**，不得互相复用。
 */

import { normalizeUnicode, tokenize } from './tokenizer.js';

/** 一条 redaction 规则（数据表条目） */
export interface RedactionRule {
  /** 类型标记，同时作为 `redactionTags` 的取值与占位符名 */
  readonly id: string;
  /** 替换后的占位串，恒为 `<id>` */
  readonly placeholder: string;
  /** 判据 */
  readonly pattern: RegExp;
  /** 判据的人类可读说明（与 spec FR-012 表格对应） */
  readonly description: string;
}

/**
 * 六类规则表（FR-012）。
 *
 * **数组顺序即应用顺序**，两处顺序依赖是刻意的，改动会引入回归：
 * 1. `URL_WITH_CRED` 必须早于 `EMAIL`：`user:pass@host` 含 `@`，否则会被 EMAIL 先吃掉一半；
 * 2. `TOKEN` 与 `HOME` 必须早于 `HIGH_ENTROPY`：base64 字符集含 `/`，
 *    否则 `/Users/alice/projects/kb` 这类长路径会被整体判为高熵串，home 段标记丢失。
 *
 * **大小写敏感性是逐规则决定的**（F241 B2-1）：凭据参数名（`TOKEN=`）、认证 scheme（`bearer`）、
 * home 路径段（`c:\users\`）在真实输入里大小写随意，必须不敏感；而 `sk-` / `ghp_` 这类
 * token 前缀在各家规范里就是小写字面量，保持敏感以免误遮普通大写词。
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: 'URL_WITH_CRED',
    placeholder: '<URL_WITH_CRED>',
    // /i：凭据参数名大小写随意（`?TOKEN=` / `?Api_Key=` 与 `?token=` 等价）
    pattern:
      /(?:[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S*)|(?:[a-z][a-z0-9+.-]*:\/\/\S*[?&](?:token|key|secret|password|passwd|api_key|apikey|access_token)=\S*)/gi,
    description: 'URL 中含 user:pass@ 或 token/key/secret 类查询参数（参数名大小写不敏感）',
  },
  {
    id: 'EMAIL',
    placeholder: '<EMAIL>',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    description: '含 @ 的地址形态',
  },
  {
    id: 'TOKEN',
    placeholder: '<TOKEN>',
    // 前两段（sk- / ghp_）保持大小写敏感：这些前缀在各家规范里就是小写字面量，
    // 放宽会误遮普通大写词。第三段的 Bearer scheme 按 RFC 7235 大小写不敏感，
    // 用显式字符类逐字母放宽（整条规则加 /i 会连带放宽前两段）。
    pattern:
      /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}|\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}|\b[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9._+/=-]+/g,
    description: '常见 token 前缀形态（sk- / ghp_ / Bearer 等；Bearer scheme 大小写不敏感）',
  },
  {
    id: 'HOME',
    placeholder: '<HOME>',
    // `Users` / `home` 段大小写不敏感：Windows 路径本就不区分大小写，macOS 默认卷同样
    // 大小写不敏感（`/users/bob` 与 `/Users/bob` 指向同一目录）。方向偏保守（宁可多遮）。
    pattern: /(?:\/[Uu][Ss][Ee][Rr][Ss]\/|\/[Hh][Oo][Mm][Ee]\/)[^\s/\\]+|[A-Za-z]:\\[Uu][Ss][Ee][Rr][Ss]\\[^\s\\]+/g,
    description: '绝对路径 home 段（/Users/<name>、/home/<name>、C:\\Users\\<name>；段名大小写不敏感）',
  },
  {
    id: 'HIGH_ENTROPY',
    placeholder: '<HIGH_ENTROPY>',
    pattern: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=]{20,}(?![A-Za-z0-9+/=])/g,
    description: '长度 ≥ 20 的连续 hex / base64 字符集片段',
  },
  {
    id: 'DIGITS',
    placeholder: '<DIGITS>',
    pattern: /(?<!\d)\d{8,}(?!\d)/g,
    description: '长度 ≥ 8 的纯数字串',
  },
];

/**
 * 占位符经仓内 tokenizer 切词后残留的**全部** token（EC-21 用）。
 *
 * 注意不是简单的 rule.id：tokenizer 把 `_` 当分隔符并额外产出拼接形，
 * 因此 `<HIGH_ENTROPY>` 实际落成 `HIGH` / `ENTROPY` / `HIGHENTROPY` 三个 token
 * （dogfood 手跑实证，见 F241 批 2 报告）。coverage-gap 聚合器据此剔除占位 token，
 * 避免这些标记碎片冒充缺口词。
 *
 * 边界：比较是**大小写敏感**的，用户查询里小写的 `token` / `home` 不受影响；
 * 但如果用户真的全大写查 `TOKEN`，该词会被误剔（可接受，方向偏保守）。
 */
export const REDACTION_PLACEHOLDER_TOKENS: ReadonlySet<string> = new Set(
  REDACTION_RULES.flatMap((r) => tokenize(r.placeholder)),
);

export interface RedactionResult {
  /** 遮蔽后的查询串（**不落盘整串**，仅供切词，见 FR-013） */
  redacted: string;
  /** 命中的规则 id（去重，按规则表顺序） */
  tags: string[];
}

/**
 * 对原始查询串逐规则施加遮蔽。
 *
 * **先归一化再匹配**：入口 NFKC（见模块注释「归一化前置」），否则全角形态会绕过规则、
 * 却在落盘切词时被还原。因此 `redacted` 是**归一化后**的串，可能与入参逐字不同。
 *
 * 纯函数、不抛异常：任何输入都返回一个 `RedactionResult`。
 */
export function redactQuery(raw: string): RedactionResult {
  if (typeof raw !== 'string' || raw.length === 0) return { redacted: '', tags: [] };
  let redacted = normalizeUnicode(raw);
  const tags: string[] = [];
  for (const rule of REDACTION_RULES) {
    // 每条规则的正则带 /g，String.replace 用后 lastIndex 归零，规则表可安全复用
    const next = redacted.replace(rule.pattern, rule.placeholder);
    if (next !== redacted) {
      redacted = next;
      tags.push(rule.id);
    }
  }
  return { redacted, tags };
}
