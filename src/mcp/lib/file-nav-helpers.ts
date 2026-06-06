/**
 * Feature 171 — File Navigation 纯计算/IO helper（对标 response-helpers.ts，便于 ≥95% 单测）
 *
 * 把 view_file / search_in_file / list_directory 的全部可独立测试逻辑下沉到本模块，
 * 让 file-nav-tools.ts 的 handler 保持薄编排。
 *
 * 🔴 路径安全（resolveSafePath）是 LFI 红线：词法 containment 先于 fs，realpath 穿透 symlink，
 *    path.relative 防前缀碰撞，全部错误码脱敏（不回传绝对路径）。
 */

import * as path from 'node:path';
import { realpathSync, readdirSync, statSync, type Dirent } from 'node:fs';

// ============================================================
// 常量（REFACTOR 阶段集中）
// ============================================================

/** view_file 无定位参数时的默认窗口（对标 OpenHands 前 200 行） */
export const DEFAULT_VIEW_WINDOW = 200;
/** search_in_file 默认返回命中数 */
export const DEFAULT_MAX_MATCHES = 50;
/** maxMatches 安全上界（clamp） */
export const MAX_MATCHES_CAP = 1000;
/** 用户 pattern 长度上界（ReDoS 缓解：限制输入） */
export const MAX_PATTERN_LENGTH = 200;
/** contextLines 上界 */
export const MAX_CONTEXT_LINES = 20;
/** list_directory depth 上界 */
export const MAX_DIR_DEPTH = 10;
/** list_directory 单次最多返回条目（防超大目录灌爆 payload） */
export const MAX_DIR_ENTRIES = 5000;
/** isBinary 探测前缀字节数 */
const BINARY_SNIFF_BYTES = 8000;
/** path 参数长度上界（防超长 path 灌爆响应 / 异常输入） */
export const MAX_PATH_LENGTH = 4096;
/** 用户正则可搜索的内容字节上界（ReDoS 缓解：限制 regex 作用的输入规模） */
export const MAX_REGEX_CONTENT_BYTES = 2_000_000;

// ============================================================
// 路径安全（FR-010~014）
// ============================================================

export type SafePathErrorCode = 'path-outside-root' | 'invalid-input' | 'file-not-found';
export type SafePathResult = { ok: true; realPath: string } | { ok: false; code: SafePathErrorCode };

/**
 * 解析并校验用户路径在 projectRoot 内（含 symlink 穿透）。
 *
 * 判定顺序（FR-013，修 Codex PATH-CLASSIFICATION）：
 *   1. NUL 字节 → invalid-input
 *   2. realRoot = realpath(projectRoot)（projectRoot 自身 symlink 也解析）
 *   3. 词法 containment（path.relative）→ 越界(含不存在)立即 path-outside-root，不触 fs
 *   4. realpath 穿透候选 → ENOENT/error → file-not-found（脱敏）
 *   5. realpath 后再 containment → symlink 逃逸 → path-outside-root
 * posix-only（Windows 归一化 YAGNI）。
 */
export function resolveSafePath(projectRoot: string, userPath: string): SafePathResult {
  if (typeof userPath !== 'string' || userPath.length === 0 || userPath.length > MAX_PATH_LENGTH || userPath.includes('\0')) {
    return { ok: false, code: 'invalid-input' };
  }
  let realRoot: string;
  try {
    realRoot = realpathSync.native(projectRoot);
  } catch {
    return { ok: false, code: 'file-not-found' };
  }
  const candidate = path.resolve(realRoot, userPath);
  // 词法 containment 先于任何 fs（越界且不存在的路径也归类 path-outside-root，不泄露 fs 状态）
  if (isOutside(realRoot, candidate)) {
    return { ok: false, code: 'path-outside-root' };
  }
  let realCandidate: string;
  try {
    realCandidate = realpathSync.native(candidate);
  } catch {
    return { ok: false, code: 'file-not-found' };
  }
  // realpath 后再判，拦截 symlink 逃逸
  if (isOutside(realRoot, realCandidate)) {
    return { ok: false, code: 'path-outside-root' };
  }
  return { ok: true, realPath: realCandidate };
}

/**
 * 用 path.relative 判定 target 是否在 root 外。
 * 禁止裸 startsWith（避免 /repo vs /repo2 前缀碰撞）。rel==='' 视为 root 本身，contained。
 */
function isOutside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

// ============================================================
// 行切片（FR-001/002）
// ============================================================

export interface FileSlice {
  lines: string[]; // 每行带行号前缀 `${lineNo}\t${text}`
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

/**
 * 将内容拆为行数组：按 \r?\n 切分；末尾换行不计为额外空行；空内容 → []。
 */
export function splitLines(content: string): string[] {
  if (content === '') return [];
  const parts = content.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * 按行区间切片，带行号前缀。无定位参数时返回前 defaultWindow 行 + truncated 标志。
 * 区间端点被安全 clamp 到 [1, totalLines]，超界不抛错。
 */
export function sliceLines(
  content: string,
  opts: { startLine?: number; endLine?: number; defaultWindow?: number } = {},
): FileSlice {
  const allLines = splitLines(content);
  const totalLines = allLines.length;
  if (totalLines === 0) {
    return { lines: [], startLine: 0, endLine: 0, totalLines: 0, truncated: false };
  }
  const window = opts.defaultWindow ?? DEFAULT_VIEW_WINDOW;
  let start: number;
  let end: number;
  let truncated = false;
  if (opts.startLine === undefined && opts.endLine === undefined) {
    start = 1;
    end = Math.min(totalLines, window);
    truncated = totalLines > window;
  } else {
    start = opts.startLine ?? 1;
    end = opts.endLine ?? totalLines;
  }
  start = Math.max(1, Math.min(Math.trunc(start), totalLines));
  end = Math.max(start, Math.min(Math.trunc(end), totalLines));
  const lines = allLines.slice(start - 1, end).map((t, i) => `${start + i}\t${t}`);
  return { lines, startLine: start, endLine: end, totalLines, truncated };
}

/** UTF-8 byte / 4 的 token 代理（改名避开 token-counter.ts 的 estimateTokens 命名碰撞） */
export function estimateUtf8ByteTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf-8') / 4);
}

/** 二进制探测：前缀字节含 NUL 即判二进制 */
export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// ============================================================
// 数值 clamp（FR-008）
// ============================================================

/** 把数值 clamp 到 [min, max]，非法值（NaN/缺省）回退 fallback；返回是否被 clamp */
export function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): { value: number; clamped: boolean } {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { value: fallback, clamped: true };
  }
  const int = Math.trunc(value);
  if (int < min) return { value: min, clamped: true };
  if (int > max) return { value: max, clamped: true };
  return { value: int, clamped: int !== value };
}

// ============================================================
// 单文件搜索（FR-004/005）
// ============================================================

export interface SearchMatch {
  line: number;
  text: string;
  before: string[];
  after: string[];
}

export type MatchResult =
  | { ok: true; matches: SearchMatch[]; totalMatches: number; returnedMatches: number; warnings: string[] }
  | { ok: false; reason: string };

/** 转义 literal pattern 中的正则元字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ReDoS 启发式：探测高危结构，命中则拒绝。覆盖：
 *   - 嵌套量词组后接量词/有界重复：(a+)+ / (.*)* / (a{1,99}){1,99}
 *   - 量化的交替组：(a|a)+ / (a|b)*
 * 非完整 ReDoS 证明（配合 pattern 长度 + content byte 上界，FR-005 明示）。
 */
export function isRiskyRegex(pattern: string): boolean {
  const innerQuantGroup = /\([^)]*[+*{][^)]*\)/; // 组内含量词
  const outerRepeat = /\)\s*([+*]|\{\d+,?\d*\})/; // 组后接 + * 或 {n,m}
  if (innerQuantGroup.test(pattern) && outerRepeat.test(pattern)) return true;
  if (/\([^)]*\|[^)]*\)\s*[+*]/.test(pattern)) return true; // 量化交替组
  return false;
}

/**
 * 在内容内逐行匹配 pattern，返回带上下文行的命中列表。
 * 失败（空/超长/非法正则/高危正则）返回 { ok:false, reason }，由 handler 映射 invalid-input。
 */
export function matchInFile(
  content: string,
  pattern: string,
  opts: { isRegex?: boolean; maxMatches?: number; contextLines?: number } = {},
): MatchResult {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { ok: false, reason: 'pattern 必填且非空' };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: `pattern 过长（上限 ${MAX_PATTERN_LENGTH}）` };
  }
  const isRegex = opts.isRegex ?? false;
  const contextLines = clampInt(opts.contextLines ?? 0, 0, MAX_CONTEXT_LINES, 0);
  const maxMatches = clampInt(opts.maxMatches ?? DEFAULT_MAX_MATCHES, 1, MAX_MATCHES_CAP, DEFAULT_MAX_MATCHES);
  const warnings: string[] = [];
  if (maxMatches.clamped) warnings.push('maxMatches-clamped');
  if (contextLines.clamped) warnings.push('contextLines-clamped');

  let regex: RegExp;
  if (isRegex) {
    if (isRiskyRegex(pattern)) {
      return { ok: false, reason: 'pattern 含高危结构（嵌套/量化分组，ReDoS 风险）' };
    }
    // ReDoS 缓解：限制用户正则作用的内容规模（literal 搜索无回溯风险，不限制）
    if (Buffer.byteLength(content, 'utf-8') > MAX_REGEX_CONTENT_BYTES) {
      return { ok: false, reason: `内容超 ${MAX_REGEX_CONTENT_BYTES} 字节，正则搜索受限，请用 literal 或先 view_file 缩小范围` };
    }
    try {
      regex = new RegExp(pattern);
    } catch {
      return { ok: false, reason: '非法正则' };
    }
  } else {
    regex = new RegExp(escapeRegExp(pattern));
  }

  const lines = splitLines(content);
  const matches: SearchMatch[] = [];
  let totalMatches = 0;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]!)) {
      totalMatches++;
      if (matches.length < maxMatches.value) {
        matches.push({
          line: i + 1,
          text: lines[i]!,
          before: lines.slice(Math.max(0, i - contextLines.value), i),
          after: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines.value)),
        });
      }
    }
  }
  if (totalMatches > matches.length) warnings.push('matches-truncated');
  return { ok: true, matches, totalMatches, returnedMatches: matches.length, warnings };
}

// ============================================================
// 目录列举（FR-006/007）
// ============================================================

export interface DirEntry {
  name: string; // 相对 absDir 的路径
  type: 'file' | 'dir' | 'symlink';
  size: number | null; // 非文件为 null
}

/**
 * 列举目录条目（可递归 depth 层）。默认仅过滤 .git；includeIgnored=true 含 .git。
 * 超 MAX_DIR_ENTRIES 截断并加 listing-truncated warning。readdir 失败的子目录静默跳过。
 */
export function buildDirListing(
  absDir: string,
  opts: { depth?: number; includeIgnored?: boolean; maxEntries?: number } = {},
): { entries: DirEntry[]; warnings: string[] } {
  const depth = clampInt(opts.depth ?? 1, 1, MAX_DIR_DEPTH, 1);
  const includeIgnored = opts.includeIgnored ?? false;
  // maxEntries 仅供测试注入截断阈值；生产默认 MAX_DIR_ENTRIES
  const maxEntries = opts.maxEntries && opts.maxEntries > 0 ? opts.maxEntries : MAX_DIR_ENTRIES;
  const warnings: string[] = [];
  if (depth.clamped) warnings.push('depth-clamped');
  const entries: DirEntry[] = [];
  let truncated = false;

  const walk = (dir: string, rel: string, level: number): void => {
    if (truncated) return;
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (!includeIgnored && d.name === '.git') continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      const relName = rel ? `${rel}/${d.name}` : d.name;
      const type: DirEntry['type'] = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : 'file';
      let size: number | null = null;
      if (type === 'file') {
        try {
          size = statSync(path.join(dir, d.name)).size;
        } catch {
          size = null;
        }
      }
      entries.push({ name: relName, type, size });
      if (type === 'dir' && level < depth.value) {
        walk(path.join(dir, d.name), relName, level + 1);
      }
    }
  };
  walk(absDir, '', 1);
  if (truncated) warnings.push('listing-truncated');
  return { entries, warnings };
}

// ============================================================
// nextStepHint（FR-040，独立实现不碰 response-helpers.ts）
// ============================================================

/** 生成 file-nav 工具的下一步引导（风格对齐 generateNextStepHint，闭环 view_file ↔ context） */
export function buildFileNavHint(
  toolName: 'view_file' | 'search_in_file' | 'list_directory',
  data: Record<string, unknown>,
): string {
  if (toolName === 'view_file') {
    const startLine = (data['startLine'] as number | undefined) ?? 0;
    const endLine = (data['endLine'] as number | undefined) ?? 0;
    const totalLines = (data['totalLines'] as number | undefined) ?? 0;
    if (data['truncated'] === true) {
      return `已显示前 ${endLine}/${totalLines} 行（截断），建议用 startLine/endLine 翻页，或调 context 看该 symbol 的调用方与依赖`;
    }
    return `已显示第 ${startLine}-${endLine}/${totalLines} 行，建议调 context 查看该区域 symbol 的调用方与依赖`;
  }
  if (toolName === 'search_in_file') {
    const total = (data['totalMatches'] as number | undefined) ?? 0;
    if (total === 0) {
      return '未找到匹配，建议放宽 pattern、改用 isRegex，或确认文件路径';
    }
    return `找到 ${total} 处匹配，建议用 view_file 按某处行号查看完整上下文行段`;
  }
  const count = (data['entryCount'] as number | undefined) ?? 0;
  return `目录含 ${count} 项，建议用 view_file 查看具体文件，或 search_in_file 在文件内定位 symbol`;
}
