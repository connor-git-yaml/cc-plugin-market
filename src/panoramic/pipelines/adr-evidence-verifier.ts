/**
 * ADR Evidence Verifier (Feature 140 T40)
 *
 * 实现 spec FR-005 — ADR evidenceRef 自动真实性校验。
 *
 * 防止 LLM 在 ADR 草稿中编造不存在的代码引用。每条 evidenceRef 程序化校验：
 *  (1) source 文件存在（fs.existsSync）
 *  (2) location 行号范围有效（解析 "L42-58" 格式，检查文件实际行数）
 *  (3) snippet 与文件实际内容字符匹配（允许 ≤10% 空白差异：normalize whitespace 后
 *      Levenshtein 距离 / snippet.length ≤ 0.1）
 *
 * Validation gate：有效 evidenceRefs（verified=true）< 2 条的 ADR 应从产物中移除
 * （由 caller 实施；本模块只负责打 verified 标记）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// 类型定义
// ============================================================

/**
 * Feature 140 ADR evidenceRef 输入格式（来自 LLM Map 阶段输出）。
 *
 * 与既有 `AdrEvidenceRef` 不同：本结构是 LLM 必须填充的"代码 evidence"格式，
 * 强制要求 source（文件路径）+ location（行号范围）+ snippet（原文片段）三件套。
 */
export interface EvidenceRefInput {
  /** 文件路径（相对 projectRoot 或绝对路径）*/
  source: string;
  /** 行号范围（"L42-58" 格式，包含两端；单行可写 "L42" 或 "L42-42"）*/
  location: string;
  /** 文件实际内容片段（用于校验 snippet 匹配） */
  snippet: string;
}

/** 校验后的 evidenceRef，追加 verified + verificationReason 字段 */
export interface VerifiedEvidenceRef extends EvidenceRefInput {
  /** 是否通过 file/line/snippet 三重验证 */
  verified: boolean;
  /** 校验失败原因（仅 verified=false 时填充）*/
  verificationReason?:
    | 'file-not-found'
    | 'invalid-location-format'
    | 'line-out-of-range'
    | 'snippet-mismatch'
    | 'read-failed';
}

// ============================================================
// 常量
// ============================================================

/** spec FR-005 锁定：snippet 允许的空白差异比例上限（10%）*/
const SNIPPET_WHITESPACE_DIFF_TOLERANCE = 0.1;

/** location 格式正则：匹配 "L42" 或 "L42-58"（允许大写 L 或小写 l）*/
const LOCATION_REGEX = /^[Ll](\d+)(?:-(\d+))?$/;

// ============================================================
// 核心校验函数
// ============================================================

/**
 * 校验一组 evidenceRef 的真实性。
 *
 * @param refs LLM 输出的 evidenceRef 列表
 * @param projectRoot 项目根目录（绝对路径），用于解析相对 source
 * @returns 每条 ref 追加 verified + 失败原因；不抛错（无效 ref 标 verified=false 但保留在结果中）
 */
export function verifyEvidenceRefs(
  refs: EvidenceRefInput[],
  projectRoot: string,
): VerifiedEvidenceRef[] {
  return refs.map((ref) => verifyOne(ref, projectRoot));
}

function verifyOne(ref: EvidenceRefInput, projectRoot: string): VerifiedEvidenceRef {
  // 解析文件绝对路径
  const absPath = path.isAbsolute(ref.source)
    ? ref.source
    : path.join(projectRoot, ref.source);

  // 修复 Codex W-2: path traversal 防护 — evidence 必须在 projectRoot 内
  // 防止 LLM 用 `../../../etc/passwd` 这类相对路径拿到任意文件作 fake evidence
  const normalizedAbs = path.resolve(absPath);
  const normalizedRoot = path.resolve(projectRoot);
  if (!normalizedAbs.startsWith(normalizedRoot + path.sep) && normalizedAbs !== normalizedRoot) {
    return { ...ref, verified: false, verificationReason: 'file-not-found' };
  }

  // (1) 文件存在性
  if (!fs.existsSync(absPath)) {
    return { ...ref, verified: false, verificationReason: 'file-not-found' };
  }

  // (2) 解析 location 格式
  const locationMatch = LOCATION_REGEX.exec(ref.location);
  if (!locationMatch) {
    return { ...ref, verified: false, verificationReason: 'invalid-location-format' };
  }
  const startLine = parseInt(locationMatch[1]!, 10);
  const endLine = locationMatch[2] !== undefined ? parseInt(locationMatch[2], 10) : startLine;

  // 行号必须 ≥ 1 且 startLine ≤ endLine
  if (startLine < 1 || endLine < startLine) {
    return { ...ref, verified: false, verificationReason: 'invalid-location-format' };
  }

  // (3) 读取文件内容并校验行号范围 + snippet
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return { ...ref, verified: false, verificationReason: 'read-failed' };
  }

  const lines = fileContent.split('\n');
  // 行号越界（注：文件最后一行可能没有 trailing newline，lines.length 可能 = endLine 或 endLine+1）
  if (endLine > lines.length) {
    return { ...ref, verified: false, verificationReason: 'line-out-of-range' };
  }

  // 提取 location 指定行的实际内容（1-based, 含两端）
  const actualSnippet = lines.slice(startLine - 1, endLine).join('\n');

  // (4) snippet 匹配（≤10% 空白差异）
  if (!snippetMatches(ref.snippet, actualSnippet)) {
    return { ...ref, verified: false, verificationReason: 'snippet-mismatch' };
  }

  return { ...ref, verified: true };
}

// ============================================================
// snippet 匹配算法
// ============================================================

/**
 * 比较两个 snippet 是否"实质相等"，允许 ≤10% 空白差异。
 *
 * 算法：
 *  1. Normalize 双方：折叠所有连续空白（含换行）为单个空格、首尾 trim
 *  2. 计算 Levenshtein 距离（normalize 后）
 *  3. 距离 / max(len1, len2) ≤ 0.1 → 视为匹配
 *
 * 这种宽容匹配兼容 LLM 输出中的空白格式漂移（缩进 / 换行风格 / trailing space）。
 */
function snippetMatches(llmSnippet: string, fileSnippet: string): boolean {
  const a = normalizeWhitespace(llmSnippet);
  const b = normalizeWhitespace(fileSnippet);
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;

  const distance = levenshtein(a, b);
  const ratio = distance / Math.max(a.length, b.length);
  return ratio <= SNIPPET_WHITESPACE_DIFF_TOLERANCE;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Levenshtein 距离（编辑距离）— 标准 DP 实现。
 * 复杂度 O(m*n)。snippet 通常 < 200 字符，性能可接受。
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 滚动数组优化：只需保留 prev 行（O(min(m, n)) 空间）
  const m = a.length;
  const n = b.length;
  // 选短的一边作内层循环，长的作外层（减少内层数组大小）
  const [shorter, longer] = m <= n ? [a, b] : [b, a];
  const sm = shorter.length;
  const ln = longer.length;

  let prev: number[] = Array.from({ length: sm + 1 }, (_, i) => i);
  for (let i = 1; i <= ln; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= sm; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      curr.push(
        Math.min(
          prev[j]! + 1,        // 删除
          curr[j - 1]! + 1,    // 插入
          prev[j - 1]! + cost, // 替换 / 匹配
        ),
      );
    }
    prev = curr;
  }
  return prev[sm]!;
}
