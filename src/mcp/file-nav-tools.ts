/**
 * Feature 171 — File Navigation MCP Tools（view_file / search_in_file / list_directory）
 *
 * 对标 SWE-Agent / OpenHands scaffolding 的文件导航工具，让 driver 按 line range / pattern /
 * 目录查看文件以省 token。建在 Feature 151 graph + Feature 155 agent-context 之上。
 *
 * 模块分层：
 *   - 纯逻辑/IO 在 lib/file-nav-helpers.ts（≥95% 单测）
 *   - 共享响应原语在 lib/tool-response.ts；telemetry 在 lib/telemetry.ts
 *   - 本文件只做薄 handler 编排 + Zod schema + F170c 4 要素 description
 *
 * 🔴 所有 path 经 resolveSafePath 校验（LFI 红线）；错误响应全部脱敏（不回传绝对路径/stack）。
 */

import { readFileSync, statSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCachedGraphData } from './graph-tools.js';
import { canonicalizeSymbolId, findNode, moduleFileFromId } from '../knowledge-graph/query-helpers.js';
import {
  buildErrorResponse,
  buildSuccessResponse,
  exceedsPayloadCap,
  type ToolResult,
} from './lib/tool-response.js';
import { recordAndReturn } from './lib/telemetry.js';
import {
  resolveSafePath,
  sliceLines,
  isBinary,
  matchInFile,
  buildDirListing,
  buildFileNavHint,
  type SafePathErrorCode,
} from './lib/file-nav-helpers.js';

// ============================================================
// 共享：path 校验 + 脱敏错误映射
// ============================================================

/** 把 SafePathErrorCode 映射为脱敏的 ToolResult（不含绝对路径） */
function safePathError(code: SafePathErrorCode): ToolResult {
  switch (code) {
    case 'path-outside-root':
      return buildErrorResponse('path-outside-root', 'path 超出 projectRoot 范围', '仅允许访问项目根内的文件');
    case 'file-not-found':
      return buildErrorResponse('file-not-found', 'path 指向的文件或目录不存在');
    case 'invalid-input':
    default:
      return buildErrorResponse('invalid-input', 'path 非法（为空或含非法字符）');
  }
}

function requestSize(args: unknown): number {
  try {
    return JSON.stringify(args).length;
  } catch {
    return 0;
  }
}

// ============================================================
// view_file
// ============================================================

interface ViewFileArgs {
  path: string;
  startLine?: number;
  endLine?: number;
  symbolId?: string;
  projectRoot?: string;
}

const ViewFileInputSchema = {
  path: z.string().describe('项目根内的相对/绝对文件路径'),
  startLine: z.number().int().optional().describe('起始行（1-indexed，含）'),
  endLine: z.number().int().optional().describe('结束行（1-indexed，含）'),
  symbolId: z.string().optional().describe('symbol id；提供时按其 graph lineRange 切片'),
  // 🔴 安全：projectRoot 不暴露给 MCP 客户端，固定为 server 启动 cwd（防客户端把安全边界放大到 /）。
  // 内部/测试经 handler 的 args.projectRoot 注入。
};

/** 用 symbolId 解析 graph node 的 file + lineRange；失败返回错误 ToolResult */
function resolveSymbolRange(
  projectRoot: string,
  symbolId: string,
): { ok: true; file: string | null; start?: number; end?: number } | { ok: false; result: ToolResult } {
  const cached = getCachedGraphData(projectRoot);
  if (cached === null) {
    return { ok: false, result: buildErrorResponse('graph-not-built', 'graph 未构建', '请先运行 `spectra batch` 生成图谱') };
  }
  const { graphData } = cached;
  const canon = canonicalizeSymbolId(symbolId, graphData, { projectRoot });
  if (canon.reason === 'invalid') {
    return { ok: false, result: buildErrorResponse('invalid-symbol-id', 'symbolId 格式非法') };
  }
  if (canon.reason === 'not-found' || canon.canonicalId === null) {
    return {
      ok: false,
      result: buildErrorResponse('symbol-not-found', 'symbolId 在 graph 中未找到', '请检查 id，或先调 context 确认 symbol，或改用 startLine/endLine'),
    };
  }
  const node = findNode(graphData, canon.canonicalId);
  /* v8 ignore next 3 — 防御性：canon 返回 ok 已隐含 hasNode 命中，findNode 不应为 null */
  if (node === null) {
    return { ok: false, result: buildErrorResponse('symbol-not-found', 'symbol 节点对象未找到') };
  }
  const md = node.metadata;
  const file = ((md['sourceFile'] as string | undefined) ?? (md['sourcePath'] as string | undefined) ?? moduleFileFromId(node.id)) || null;
  const lineRange = md['lineRange'] as { start?: number; end?: number } | undefined;
  return { ok: true, file, start: lineRange?.start, end: lineRange?.end };
}

/**
 * 判定 symbol 解析出的文件与用户 path 是否冲突。
 * 按 path segment 比较后缀（修 Codex W3：避免 'evil/xb.ts' endsWith 'b.ts' 的字符串误判）。
 * 一个是另一个的 segment 后缀（如 'sub/b.ts' vs 'b.ts'）视为一致。
 */
function fileMismatch(reqRel: string, nodeFile: string): boolean {
  const a = path.normalize(reqRel).split(path.sep).filter(Boolean);
  const b = path.normalize(nodeFile).split('/').filter((s) => s && s !== '.');
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  for (let i = 1; i <= shorter.length; i++) {
    if (shorter[shorter.length - i] !== longer[longer.length - i]) return true;
  }
  return false; // shorter 是 longer 的 segment 后缀
}

/**
 * 共享 handler 骨架：采样 telemetry → 校验 path → resolveSafePath → 执行 body → 统一 internal-error 边界。
 * body 收到已校验在根内的 realPath（必存在，故 body 内 statSync 不会 ENOENT）。
 * 所有错误码统一经 recordAndReturn 透传；任何未预期异常落到脱敏的 internal-error（FR-014）。
 */
async function runFileNavTool(
  toolName: string,
  args: { path?: unknown; projectRoot?: string },
  body: (projectRoot: string, realPath: string) => ToolResult,
): Promise<ToolResult> {
  const start = Date.now();
  const reqSize = requestSize(args);
  try {
    if (typeof args.path !== 'string' || args.path.length === 0) {
      return recordAndReturn(toolName, start, reqSize, buildErrorResponse('invalid-input', 'path 必填且为非空字符串'));
    }
    const projectRoot = args.projectRoot ?? process.cwd();
    const safe = resolveSafePath(projectRoot, args.path);
    if (!safe.ok) {
      return recordAndReturn(toolName, start, reqSize, safePathError(safe.code));
    }
    return recordAndReturn(toolName, start, reqSize, body(projectRoot, safe.realPath));
  } catch {
    // FR-014 脱敏：不回传 err.message/stack
    return recordAndReturn(toolName, start, reqSize, buildErrorResponse('internal-error', `${toolName} 内部错误`));
  }
}

export async function handleViewFile(args: ViewFileArgs): Promise<ToolResult> {
  return runFileNavTool('view_file', args, (projectRoot, realPath) => {
    if (statSync(realPath).isDirectory()) {
      return buildErrorResponse('invalid-input', 'path 是目录，请用 list_directory');
    }
    let startLine = args.startLine;
    let endLine = args.endLine;
    const warnings: string[] = [];
    if (typeof args.symbolId === 'string' && args.symbolId.length > 0) {
      const sym = resolveSymbolRange(projectRoot, args.symbolId);
      if (!sym.ok) return sym.result;
      // projectRoot 已在 resolveSafePath 成功 realpath，此处直接复用（不会抛）
      const reqRel = path.relative(realpathSync.native(projectRoot), realPath);
      if (sym.file !== null && fileMismatch(reqRel, sym.file)) {
        return buildErrorResponse('invalid-input', 'path 与 symbolId 所属文件不一致', '二选一：去掉 path 用 symbolId，或去掉 symbolId 用 path');
      }
      if (typeof sym.start === 'number') {
        // FR-003：symbolId 与显式行区间同存 → 以 symbolId 为准并 warning
        if (args.startLine !== undefined || args.endLine !== undefined) {
          warnings.push('symbolId-overrides-lines');
        }
        startLine = sym.start;
        endLine = typeof sym.end === 'number' ? sym.end : sym.start;
      }
    }

    const buf = readFileSync(realPath);
    if (isBinary(buf)) {
      return buildErrorResponse('binary-file', '目标为二进制文件，无法按行查看');
    }
    const slice = sliceLines(buf.toString('utf-8'), { startLine, endLine });
    const data: Record<string, unknown> = {
      path: args.path,
      lines: slice.lines,
      startLine: slice.startLine,
      endLine: slice.endLine,
      totalLines: slice.totalLines,
      truncated: slice.truncated,
    };
    if (warnings.length > 0) data['warnings'] = warnings;
    data['nextStepHint'] = buildFileNavHint('view_file', data);
    // lines 不做静默截断（丢代码行会误导）：超 cap 显式返回 payload-too-large，引导缩小区间
    const result = buildSuccessResponse(data, []);
    if (exceedsPayloadCap(result)) {
      return buildErrorResponse('payload-too-large', '响应过大，请缩小 startLine/endLine 区间');
    }
    return result;
  });
}

// ============================================================
// search_in_file
// ============================================================

interface SearchInFileArgs {
  path: string;
  pattern: string;
  isRegex?: boolean;
  maxMatches?: number;
  contextLines?: number;
  projectRoot?: string;
}

const SearchInFileInputSchema = {
  path: z.string().describe('项目根内的相对/绝对文件路径'),
  pattern: z.string().describe('搜索 pattern（literal 或 regex）'),
  isRegex: z.boolean().optional().describe('是否按正则匹配（默认 false）'),
  maxMatches: z.number().int().optional().describe('最多返回命中数（默认 50，上限 1000）'),
  contextLines: z.number().int().optional().describe('每条命中前后上下文行数（默认 0，上限 20）'),
  // 🔴 安全：projectRoot 不暴露给 MCP 客户端，固定为 server 启动 cwd（防客户端把安全边界放大到 /）。
  // 内部/测试经 handler 的 args.projectRoot 注入。
};

export async function handleSearchInFile(args: SearchInFileArgs): Promise<ToolResult> {
  return runFileNavTool('search_in_file', args, (_projectRoot, realPath) => {
    if (statSync(realPath).isDirectory()) {
      return buildErrorResponse('invalid-input', 'path 是目录，请用 list_directory');
    }
    const buf = readFileSync(realPath);
    if (isBinary(buf)) {
      return buildErrorResponse('binary-file', '目标为二进制文件，无法搜索');
    }
    const m = matchInFile(buf.toString('utf-8'), args.pattern, {
      isRegex: args.isRegex,
      maxMatches: args.maxMatches,
      contextLines: args.contextLines,
    });
    if (!m.ok) {
      return buildErrorResponse('invalid-input', `pattern 非法：${m.reason}`);
    }
    const data: Record<string, unknown> = {
      path: args.path,
      matches: m.matches,
      totalMatches: m.totalMatches,
      returnedMatches: m.returnedMatches,
    };
    if (m.warnings.length > 0) data['warnings'] = m.warnings;
    data['nextStepHint'] = buildFileNavHint('search_in_file', data);
    // matches 按字节截断（已带 totalMatches/returnedMatches）；path 已 ≤ MAX_PATH_LENGTH，
    // 其余字段有界 → 截断后必 ≤ cap，无需 payload-too-large 复核（修 Codex CRITICAL-2 的根因是超长 path）
    return buildSuccessResponse(data, ['matches']);
  });
}

// ============================================================
// list_directory
// ============================================================

interface ListDirectoryArgs {
  path: string;
  depth?: number;
  includeIgnored?: boolean;
  projectRoot?: string;
}

const ListDirectoryInputSchema = {
  path: z.string().describe('项目根内的相对/绝对目录路径'),
  depth: z.number().int().optional().describe('递归深度（默认 1，上限 10）'),
  includeIgnored: z.boolean().optional().describe('是否纳入 .git 等忽略项（默认 false）'),
  // 🔴 安全：projectRoot 不暴露给 MCP 客户端，固定为 server 启动 cwd（防客户端把安全边界放大到 /）。
  // 内部/测试经 handler 的 args.projectRoot 注入。
};

export async function handleListDirectory(args: ListDirectoryArgs): Promise<ToolResult> {
  return runFileNavTool('list_directory', args, (_projectRoot, realPath) => {
    if (!statSync(realPath).isDirectory()) {
      return buildErrorResponse('invalid-input', 'path 不是目录，请用 view_file');
    }
    const listing = buildDirListing(realPath, { depth: args.depth, includeIgnored: args.includeIgnored });
    const data: Record<string, unknown> = {
      path: args.path,
      entries: listing.entries,
      entryCount: listing.entries.length,
    };
    if (listing.warnings.length > 0) data['warnings'] = listing.warnings;
    data['nextStepHint'] = buildFileNavHint('list_directory', data);
    // entries 按字节截断（已带 listing-truncated / entryCount）；其余字段有界 → 截断后必 ≤ cap
    return buildSuccessResponse(data, ['entries']);
  });
}

// ============================================================
// 注册（F170c 4 要素 description）
// ============================================================

export function registerFileNavTools(server: McpServer): void {
  server.tool(
    'view_file',
    `按行区间或 symbol 定位查看文件片段（带行号），省 token 替代全文 Read。

Use this tool when:
- 只想看文件某一段而非全文（省 token）
- 拿到 context/impact 的 symbol 后定位其定义行段
- 按行号翻页查看大文件

Example:
- Input: { path: "src/a.ts", startLine: 10, endLine: 40 }
- Output: { lines, startLine, endLine, totalLines, truncated, nextStepHint }

Typical chained usage:
- context → view_file(symbolId)（按 symbol lineRange 看定义行段）`,
    ViewFileInputSchema,
    async (args) => handleViewFile(args as ViewFileArgs),
  );

  server.tool(
    'search_in_file',
    `在单个文件内按 pattern（literal 或 regex）搜索，返回带前后上下文行的命中列表。

Use this tool when:
- 在已知文件里定位某标识符/字符串出现处
- 需要命中行的前后上下文行
- 在大文件里快速跳到关键行

Example:
- Input: { path: "src/a.ts", pattern: "TODO", contextLines: 2 }
- Output: { matches: [{line, text, before, after}], totalMatches, nextStepHint }

Typical chained usage:
- search_in_file → view_file（查某命中处完整行段）`,
    SearchInFileInputSchema,
    async (args) => handleSearchInFile(args as SearchInFileArgs),
  );

  server.tool(
    'list_directory',
    `列出目录条目（name/type/size），可递归 depth 层，默认仅过滤 .git。

Use this tool when:
- 不清楚目录结构、决定下一步看哪个文件
- 探索三方/子模块代码布局
- 递归浏览某子树

Example:
- Input: { path: "src/mcp", depth: 1 }
- Output: { entries: [{name, type, size}], entryCount, nextStepHint }

Typical chained usage:
- list_directory → view_file（查目录里某个文件）`,
    ListDirectoryInputSchema,
    async (args) => handleListDirectory(args as ListDirectoryArgs),
  );
}
