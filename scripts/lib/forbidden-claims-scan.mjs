/**
 * Feature 176 — 报告禁用词扫描（tasks T-F2；spec SC-007 / FR-C-008）。
 *
 * internal-cohort-only 立论要求报告不出现"绝对 SOTA / 跨实验室绝对可比"类措辞，
 * 除非每处都带 internal-cohort-only 限定。本扫描器找出裸用的禁用词，供 verify 与人工 review。
 *
 * 判定：命中禁用词的那一行/句，若同句（或紧邻）含限定语（internal-cohort-only / 仅组内 /
 * directional / 不声称绝对可比）则放行，否则记为 violation。
 */

export const FORBIDDEN_PATTERNS = [
  { id: 'sota', re: /\bSOTA\b|state[- ]of[- ]the[- ]art/i, desc: '绝对 SOTA 声称' },
  { id: 'absolute-best', re: /绝对(领先|最优|第一|最强)/, desc: '绝对最优声称' },
  { id: 'cross-lab', re: /跨实验室(绝对)?可比|跨厂商绝对可比/, desc: '跨实验室绝对可比' },
  { id: 'beats-absolute', re: /\boutperforms\b|碾压|全面超越/i, desc: '无限定的超越声称' },
  { id: 'world-best', re: /世界第一|业界第一|最佳模型/, desc: '业界第一声称' },
  { id: 'absolute-passrate', re: /绝对\s*pass\s*rate.*(可比|领先)/i, desc: '绝对 pass rate 可比' },
];

/** 限定语：同句出现则视为已声明 internal-cohort-only，放行。 */
export const QUALIFIERS = [
  /internal[- ]cohort[- ]only/i,
  /仅(限)?组内/,
  /directional/i,
  /不声称(绝对)?可比/,
  /同\s*harness/,
];

function hasQualifier(s) {
  return QUALIFIERS.some((q) => q.test(s));
}

/** 按句切分（codex WARNING：限定语要"同句"而非"同行"才放行；长行塞一个限定语不应豁免全行）。 */
function splitSentences(line) {
  // 句末标点：中英文句号/分号/问号/感叹号/右括号 + 换行
  return line.split(/(?<=[。；;.!?）)])\s*/).filter((s) => s.trim().length > 0);
}

/**
 * 扫描报告文本，返回违规（按句判定限定语）。
 * @param {string} text
 * @returns {{violations: Array<{line:number, sentence:string, pattern:string, desc:string}>, ok:boolean}}
 */
export function scanForbiddenClaims(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const violations = [];
  lines.forEach((line, i) => {
    for (const sentence of splitSentences(line)) {
      if (hasQualifier(sentence)) continue; // 同句带限定语 → 放行该句
      for (const p of FORBIDDEN_PATTERNS) {
        if (p.re.test(sentence)) {
          violations.push({ line: i + 1, sentence: sentence.trim().slice(0, 160), pattern: p.id, desc: p.desc });
        }
      }
    }
  });
  return { violations, ok: violations.length === 0 };
}
