/**
 * Feature 193 — 路径相对化共享 helper（决策 2 / FR-001~FR-004）。
 *
 * 职责：把图节点 / 边 id 内嵌的**绝对路径前缀**相对化为 POSIX 相对路径，
 * 使 graph.json + 快照跨 worktree byte 可移植（同一 commit 的不同路径 worktree
 * 构建出 byte 一致的图）。
 *
 * 核心约定：
 * - symbol id 结构分隔符（`::` / `.`）不变，仅相对化其中的**路径部分**（第一个 `::` 之前）。
 * - projectRoot 之内 → strip 前缀 + POSIX 化（`\` → `/`）。
 * - projectRoot 之外（node_modules / 跨仓 / monorepo 外部）→ **保留绝对原样**，
 *   由调用方标记 external，绝不生成 `../` 越界链（越界链内嵌 worktree 目录深度，
 *   跨不同深度 worktree 不一致）。
 * - 幂等：输入已是相对路径（非绝对）时原样返回。
 */
import * as path from 'node:path';

/** relativizePosix 单值结果 */
export interface RelativizeResult {
  /** 相对化后的值（projectRoot 外时 = 原绝对值） */
  value: string;
  /** 是否为 projectRoot 之外的路径（调用方据此标 external） */
  external: boolean;
}

/**
 * 跨平台「绝对 / 异源路径」判定（Codex implement-C1.1 / new-2）。
 *
 * 命中任一即视为非 POSIX 相对路径：
 * - POSIX 绝对（`/...`）
 * - Windows 绝对（`C:\...` / `C:/...` / UNC `\\...`）
 * - Windows 盘符前缀（含 drive-relative `C:foo`，`path.win32.isAbsolute` 对其返回 false 会漏判）
 *
 * 用于：加载期 graph-format-stale 检测 + 写入前 portable 守卫——保证 POSIX 运行时也能识别
 * 旧 Windows 导出图里的绝对/盘符路径，三处调用点共用同一判定避免分叉。
 */
export function isAbsoluteForeignPath(p: string): boolean {
  return path.posix.isAbsolute(p) || path.win32.isAbsolute(p) || /^[a-zA-Z]:/.test(p);
}

/**
 * segment-aware 包含判定：filePart 是否真位于 root 之内（Codex implement-C1.2）。
 *
 * 用 `path.relative` 段级判定，避免两类误判：
 * - 前缀歧义：`/repo/app-old` 不应判为在 `/repo/app` 内（startsWith 会误判）
 * - 同名目录：`..foo`（合法子目录）不应被 `rel.startsWith('..')` 误判为越界
 *
 * 仅当 rel 恰为 `..` 或以 `../`(POSIX) / `..\`(Win) 起始 / 仍是绝对路径时，判为不在 root 内。
 */
export function isPathContainedUnder(root: string, filePart: string): boolean {
  const rel = path.relative(root, filePart);
  if (rel === '') return true; // filePart === root 本身
  if (rel === '..') return false;
  if (rel.startsWith(`..${path.sep}`) || rel.startsWith('../')) return false;
  if (path.isAbsolute(rel)) return false; // 跨盘符等 path.relative 退化为绝对
  return true;
}

/**
 * 把绝对路径相对化为相对 projectRoot 的 POSIX 路径。
 *
 * - 输入非绝对（已相对 / 逻辑名）→ 原样返回（幂等），external=false。
 * - 输入绝对且在 projectRoot 内 → strip 前缀 + POSIX 化，external=false。
 * - 输入绝对但在 projectRoot 外 → 返回原绝对值，external=true。
 *
 * @param absPath 待处理路径（可能绝对、可能已相对）
 * @param projectRoot 项目根（相对化基准）
 */
export function relativizePosix(absPath: string, projectRoot: string): RelativizeResult {
  // 幂等：已是相对路径 / 逻辑名，原样返回（不误把相对路径再次 path.relative）
  if (!path.isAbsolute(absPath)) {
    return { value: toPosix(absPath), external: false };
  }

  const root = path.resolve(projectRoot);
  const resolved = path.resolve(absPath);

  // rel === '' 表示 absPath === projectRoot 本身（罕见），视为 root 内的 '.'，非 external。
  if (resolved === root) {
    return { value: '.', external: false };
  }
  // projectRoot 之外（真正越界 `../` 或跨盘符）→ 保留原绝对值 + 标 external，不生成越界链。
  // Codex implement-C1.2：用 isPathContainedUnder 段级判定，避免 `..foo` 同名子目录被误判越界。
  if (!isPathContainedUnder(root, resolved)) {
    return { value: toPosix(absPath), external: true };
  }

  return { value: toPosix(path.relative(root, resolved)), external: false };
}

/** parseCanonicalSymbolId 解析结果（FR-006） */
export interface CanonicalSymbolIdParts {
  /** canonical id 的路径部分（第一个 `::` 之前；无 `::` 时为整 id） */
  filePart: string;
  /** symbol 部分（第一个 `::` 之后的剩余，含 `Class.member` 的点号；无 `::` 时 undefined） */
  symbolPart: string | undefined;
}

/**
 * Feature 214 FR-006 — canonical symbol ID 单点解析工具。
 *
 * 收敛此前分散在 relativizeSymbolId / graph-builder.filePartOf /
 * graph-query.nodeIdFilePart 三处几乎相同、各自独立的「取 file part」字符串切分，
 * 作为「转换只允许发生在一个兼容边界」约束在代码层的落地对象。
 *
 * 规则：以**首个** `::` 切分。
 * - `file::sym` → filePart=file, symbolPart=sym
 * - `file::Class.m` → filePart=file, symbolPart=Class.m（成员点号保留在 symbolPart）
 * - `file::A::b`（罕见）→ filePart=file, symbolPart=A::b（只切首个 ::）
 * - `file` / `file#legacy`（无 ::）→ filePart=整 id, symbolPart=undefined
 *   （`#` 不是 canonical 分隔符，不参与切分——旧格式识别由 FR-008 legacy 检测承担）
 */
export function parseCanonicalSymbolId(id: string): CanonicalSymbolIdParts {
  const sepIdx = id.indexOf('::');
  if (sepIdx < 0) {
    return { filePart: id, symbolPart: undefined };
  }
  return {
    filePart: id.slice(0, sepIdx),
    symbolPart: id.slice(sepIdx + 2), // 跳过 '::'
  };
}

/**
 * 相对化一个 symbol id（形如 `<path>::<name>` / `<path>::<name>.<member>` / 纯 `<path>`）。
 *
 * 只相对化第一个 `::` 之前的路径部分，保留 `::` / `.` 结构分隔符与 symbol 段不变。
 * FR-006：file part 切分复用 parseCanonicalSymbolId 单点解析。
 *
 * @param id 原始 symbol id（路径部分可能绝对）
 * @param projectRoot 相对化基准
 * @returns 相对化后的 id + 路径部分是否 external
 */
export function relativizeSymbolId(id: string, projectRoot: string): RelativizeResult {
  const { filePart, symbolPart } = parseCanonicalSymbolId(id);
  if (symbolPart === undefined) {
    // 纯路径节点（module id）或非路径逻辑 id
    return relativizePosix(id, projectRoot);
  }
  const r = relativizePosix(filePart, projectRoot);
  return { value: `${r.value}::${symbolPart}`, external: r.external };
}

/** Windows 反斜杠统一为 POSIX 正斜杠（FR-003 跨平台 byte 一致） */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
