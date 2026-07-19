/**
 * F189 prototype —— symbol 级内容指纹（GATE_DESIGN 决策：现写 symbol 级，不复用 F182 文件级）。
 *
 * 设计（spec FR-002 / FR-007）：
 *   1. 调 analyzeFiles（生产 AST 分析器，只读复用）取目标 symbol 的 ExportSymbol.startLine/endLine
 *   2. 按 span 切源码 → 空白归一化（折叠空白串 + 去首尾）→ SHA-256
 *
 * 关键不变量：
 *   - check 时按 symbol **名字** 重新分析定位 span（不依赖 lock 里存的旧行号），
 *     因此同文件他处增删行导致 span 平移**不影响**指纹（symbol 级、不连累）
 *   - 仅空白/缩进重排 → 归一化后相同 → fresh（本期承诺「空白不敏感」）
 *   - span 内注释/字面值/结构变化 → 仍 stale（与全 AST 不敏感 = M9-C，本期不承诺）
 *   - ⚠️ 前导 JSDoc/注释在 span 外（ts-morph getStartLineNumber 默认排除前导 trivia）：
 *     其变化**静默判 fresh**——这是 under-report 盲区（非保守残留，方向与上一条相反），M9-C 一并修
 *   - 只读：不改任何 src/ 生产代码，analyzeFiles 当库调用
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { analyzeFiles } from '../../../../src/core/ast-analyzer.js';
import { bootstrapAdapters } from '../../../../src/adapters/index.js';

export interface SymbolFingerprint {
  fingerprint: string | null;
  reason: 'ok' | 'symbol-not-found' | 'analyze-failed';
  startLine?: number;
  endLine?: number;
}

/**
 * 逐行空白归一化（不剥注释）：折叠每行内的空格/Tab、去行首尾、丢弃空行，
 * **但保留换行结构**。
 *
 * 设计注记（Codex WARNING-1 修复）：早期版本用 `/\s+/g → ' '` 折叠**所有**空白（含换行），
 * 会把 `return\n1` 与 `return 1` 归一成相同——但 JS ASI 规则下前者实际返回 undefined，
 * 二者语义不同。保留换行可避免这类「语义不同却判 fresh」的漏报。
 * 因此本期口径：缩进 / 行内空白 / 空行不敏感；跨行重排（改变换行位置）会触发 stale（保守）。
 */
export function normalizeWhitespace(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * 计算 symbolId（形如 `relPath::Name` 或 `relPath::Class.method`）的 symbol 级指纹。
 *
 * member（`Class.method`）本期回退到其 top-level export（Class）的 span——
 * 因为 MemberInfo 不带 startLine/endLine（见 spec 已知 scope 边界），demo 用 top-level 函数。
 */
export async function computeSymbolFingerprint(
  symbolId: string,
  absFilePath: string,
): Promise<SymbolFingerprint> {
  const sep = symbolId.indexOf('::');
  if (sep < 0) {
    return { fingerprint: null, reason: 'symbol-not-found' };
  }
  const symbolName = symbolId.slice(sep + 2);
  // member 取 top-level 段（Class.method → Class）
  const topName = symbolName.includes('.') ? symbolName.slice(0, symbolName.indexOf('.')) : symbolName;

  let skeletons;
  try {
    bootstrapAdapters(); // 幂等：确保语言适配器已注册
    skeletons = await analyzeFiles([absFilePath]);
  } catch {
    return { fingerprint: null, reason: 'analyze-failed' };
  }
  const skeleton = skeletons[0];
  if (!skeleton) {
    return { fingerprint: null, reason: 'analyze-failed' };
  }

  const exp = skeleton.exports.find((e) => e.name === topName);
  if (!exp) {
    return { fingerprint: null, reason: 'symbol-not-found' };
  }

  let source: string;
  try {
    source = readFileSync(absFilePath, 'utf8');
  } catch {
    return { fingerprint: null, reason: 'analyze-failed' };
  }
  const lines = source.split('\n');
  // startLine/endLine 为 1-based，闭区间
  const slice = lines.slice(exp.startLine - 1, exp.endLine).join('\n');
  const normalized = normalizeWhitespace(slice);
  const fingerprint = createHash('sha256').update(normalized).digest('hex');

  return { fingerprint, reason: 'ok', startLine: exp.startLine, endLine: exp.endLine };
}
