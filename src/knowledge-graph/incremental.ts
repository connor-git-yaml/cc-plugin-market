/**
 * Feature 156 W3 — 增量索引核心模块。
 *
 * 提供以下能力：
 *   - gitDiff：从 git diff 取变更文件清单（支持 post-commit / 工作区两种 ref 范围）
 *   - expandCallers：从 changed files 反向扩展直接 caller（基于 endpoint → owning file 映射）
 *   - mergeIncremental：把 partial graph 合并回 oldSnapshot，保持其他文件节点 / 边不变
 *   - buildIncremental：高层入口，协调 load → diff → expand → partial build → merge → save
 *
 * 关键设计决策（plan §2.2 + clarify Q3）：
 *   - UnifiedGraph 节点 id 形如 `<filePath>::<symbol>` / `<filePath>`，**不能**直接用文件路径匹配边
 *     必须先按 node.filePath 反查 owning nodes，再用 node.id 反查 edges
 *   - caller depth 默认 1（spec FR-7 / clarify Q3 决议）；接口预留 N，BFS 多跳
 *   - shallow clone 降级（EC-10）：gitDiff 失败时返回 null，调用方触发 full re-index
 *   - rename / delete（EC-9）：deletion 不留孤儿——移除该文件所有 nodes + 所有 endpoint 在该文件的 edges
 *
 * **FR-31 守约**：本模块禁止读取 getCurrentUnifiedGraph() 全局 cache；所有数据必须从参数 / snapshot 文件读入。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { analyzeFile } from '../core/ast-analyzer.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { scanFiles } from '../utils/file-scanner.js';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import {
  buildSnapshotWrapper,
  computeAllFileHashes,
  computeFileHash,
  detectStaleFiles,
  loadSnapshot,
  saveSnapshot,
  SnapshotWrapperSchema,
  type SnapshotWrapper,
} from './persistence.js';
import { buildUnifiedGraph } from './index.js';
import type { UnifiedGraph, UnifiedNode } from './unified-graph.js';

// ───────────────────────────────────────────────────────────
// gitDiff
// ───────────────────────────────────────────────────────────

export interface GitDiffOptions {
  projectRoot: string;
  /**
   * git diff ref 范围，默认 `HEAD`（取工作区相对 HEAD 的变更）。
   * post-commit hook 场景可传 `ORIG_HEAD HEAD`，对应一次 commit 的真实 diff。
   */
  range?: string;
  /**
   * 显式启用 shallow clone 检测；默认开启。
   * 当 `git rev-parse --is-shallow-repository` 返回 'true' 时，本函数返回 null
   * 让调用方降级为全量 hash stale 检测（EC-10）。
   */
  shallowFallback?: boolean;
}

/**
 * 校验 git ref range 是否符合白名单格式（W3 WARN-2 命令注入加固）。
 *
 * 仅允许：
 *   - 1~2 个 ref（空格分隔），如 'HEAD' / 'ORIG_HEAD HEAD' / 'HEAD~1 HEAD' / 'abc1234 def5678'
 *   - 每个 ref 仅含 [A-Za-z0-9_~^@/.-]，长度 ≤ 100
 *   - 拒绝任何 shell 元字符（;、&、|、`、$、空格 × 多 / 引号等）
 *
 * 不合法返回 null（gitDiff 调用方会触发 full re-index 降级）。
 */
function parseGitRange(raw: string): string[] | null {
  const REF_PATTERN = /^[A-Za-z0-9_~^@/.-]+$/;
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 2) return null;
  for (const p of parts) {
    if (p.length === 0 || p.length > 100) return null;
    if (!REF_PATTERN.test(p)) return null;
  }
  return parts;
}

/**
 * 调 `git diff --name-only <range>` 取变更文件绝对路径数组。
 *
 * W3 WARN-2 修订：使用 execFileSync / spawnSync 数组形参传递 ref，
 * 不再用模板字符串拼接 shell 命令；range 通过白名单 parseGitRange 校验。
 *
 * 失败 / shallow clone / 非 git 仓库 / range 格式非法 → 返回 null，由调用方触发 full re-index 降级。
 *
 * @returns 绝对路径数组，或 null（降级信号）
 */
export async function gitDiff(opts: GitDiffOptions): Promise<string[] | null> {
  const projectRoot = path.resolve(opts.projectRoot);
  const range = opts.range ?? 'HEAD';
  const shallowFallback = opts.shallowFallback ?? true;

  // 0. range 白名单校验（W3 WARN-2 命令注入加固）
  const refs = parseGitRange(range);
  if (refs === null) {
    return null;
  }

  // 1. shallow clone 检测：shallow 仓库的 ORIG_HEAD / 历史可能不可用
  if (shallowFallback) {
    try {
      const isShallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (isShallow === 'true') {
        return null;
      }
    } catch {
      // 非 git 仓库或 git 不可用 → 降级
      return null;
    }
  }

  // 2. 取 diff（spawnSync 数组形参，无 shell 解释；refs 已校验）
  const result = spawnSync('git', ['diff', '--name-only', ...refs], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const raw = result.stdout ?? '';

  // 3. 解析为绝对路径
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((rel) => (path.isAbsolute(rel) ? rel : path.join(projectRoot, rel)));
}

// ───────────────────────────────────────────────────────────
// expandCallers
// ───────────────────────────────────────────────────────────

export interface ExpandCallersOptions {
  /** 变更文件绝对路径列表 */
  changedFiles: string[];
  /** 已加载的旧 snapshot */
  snapshot: SnapshotWrapper;
  /** 反向扩展深度，默认 1（FR-7）；>1 时执行 BFS */
  depth?: number;
}

/**
 * 从 changed files 反向扩展直接（或 N 跳）caller 文件。
 *
 * 算法（plan §2.2 端点 → owning file 映射）：
 *   1. 按 node.filePath 字段建 file → node ids 索引
 *   2. 当前 frontier = changed files；每跳：
 *      a) 取 frontier 文件的所有 owning node ids
 *      b) 找出 edge.target 命中这些 ids 的 edges → 取 edge.source
 *      c) 反查 source node 的 owning file，加入下一跳 frontier（去重）
 *   3. 累积所有跳的文件并集（含 changed 自身）
 */
export function expandCallers(opts: ExpandCallersOptions): string[] {
  const depth = opts.depth ?? 1;
  const { snapshot } = opts;

  // 索引：file → node ids
  const fileToNodeIds = new Map<string, Set<string>>();
  // 索引：node id → owning file
  const nodeIdToFile = new Map<string, string>();
  for (const n of snapshot.graph.nodes) {
    if (!n.filePath) continue;
    nodeIdToFile.set(n.id, n.filePath);
    let s = fileToNodeIds.get(n.filePath);
    if (!s) {
      s = new Set();
      fileToNodeIds.set(n.filePath, s);
    }
    s.add(n.id);
  }

  const result = new Set<string>(opts.changedFiles);
  let frontier = new Set<string>(opts.changedFiles);

  for (let hop = 0; hop < depth; hop += 1) {
    // 当前跳的所有 owning node ids
    const frontierIds = new Set<string>();
    for (const f of frontier) {
      const ids = fileToNodeIds.get(f);
      if (ids) for (const id of ids) frontierIds.add(id);
    }

    // 遍历 edges：target 命中 frontierIds → 取 source 所在 file
    const nextFrontier = new Set<string>();
    for (const e of snapshot.graph.edges) {
      if (frontierIds.has(e.target)) {
        const ownerFile = nodeIdToFile.get(e.source);
        if (ownerFile && !result.has(ownerFile)) {
          nextFrontier.add(ownerFile);
        }
      }
    }

    if (nextFrontier.size === 0) break; // 收敛
    for (const f of nextFrontier) result.add(f);
    frontier = nextFrontier;
  }

  return Array.from(result);
}

// ───────────────────────────────────────────────────────────
// mergeIncremental
// ───────────────────────────────────────────────────────────

export interface MergeIncrementalOptions {
  oldSnapshot: SnapshotWrapper;
  /** expandCallers 输出 + 自身（绝对路径，含 deleted 文件） */
  changedSet: Set<string>;
  /** 仅 changed files 范围内的局部 graph */
  newPartialGraph: UnifiedGraph;
  /** 当前文件 hash 表（changedSet 内**仍存在**的文件，由 buildIncremental 计算） */
  newFileHashes: Record<string, string>;
}

/**
 * 把局部图合并回 oldSnapshot：
 *   - 移除 oldSnapshot.graph.nodes 中 filePath ∈ changedSet 的所有节点
 *   - 移除以这些节点为 source 或 target 的所有 edges（deletion 不留孤儿，EC-9）
 *   - 把 newPartialGraph.nodes / .edges 追加（按 node.id 去重）
 *   - fileHashes 三态更新：删除 changedSet 中已不存在的文件 key；写入新 hash
 */
export function mergeIncremental(opts: MergeIncrementalOptions): SnapshotWrapper {
  const { oldSnapshot, changedSet, newPartialGraph, newFileHashes } = opts;

  // 1. 找出旧图中需要被替换的 owning node id 集合
  const owningIds = new Set<string>();
  for (const n of oldSnapshot.graph.nodes) {
    if (n.filePath && changedSet.has(n.filePath)) {
      owningIds.add(n.id);
    }
  }

  // 2. 保留：filePath 不在 changedSet 的旧节点
  const retainedNodes = oldSnapshot.graph.nodes.filter(
    (n) => !(n.filePath && changedSet.has(n.filePath)),
  );

  // 3. 保留：source / target 都不命中 owningIds 的旧边
  const retainedEdges = oldSnapshot.graph.edges.filter(
    (e) => !owningIds.has(e.source) && !owningIds.has(e.target),
  );

  // 4. 合并新局部图节点（按 id 去重，新覆盖旧）
  const nodeMap = new Map<string, UnifiedNode>();
  for (const n of retainedNodes) nodeMap.set(n.id, n);
  for (const n of newPartialGraph.nodes) nodeMap.set(n.id, n);

  // 5. 合并 fileHashes：删除 changedSet 中不在 newFileHashes 的（= deleted）；新增 / 更新存在的
  const mergedHashes: Record<string, string> = { ...oldSnapshot.fileHashes };
  for (const f of changedSet) {
    delete mergedHashes[f];
  }
  for (const [f, h] of Object.entries(newFileHashes)) {
    mergedHashes[f] = h;
  }

  return {
    schemaVersion: oldSnapshot.schemaVersion,
    generatedAt: new Date().toISOString(),
    graph: {
      nodes: Array.from(nodeMap.values()),
      edges: [...retainedEdges, ...newPartialGraph.edges],
      metadata: {
        // 保留 oldSnapshot 的 projectRoot / schemaVersion，更新 generatedAt
        ...oldSnapshot.graph.metadata,
        generatedAt: new Date().toISOString(),
      },
    },
    fileHashes: mergedHashes,
  };
}

// ───────────────────────────────────────────────────────────
// buildIncremental — 高层入口
// ───────────────────────────────────────────────────────────

export type IncrementalFallbackReason =
  | 'no-snapshot'
  | 'shallow-clone'
  | 'corruption'
  | 'no-diff';

export interface BuildIncrementalOptions {
  projectRoot: string;
  /** caller 反向扩展深度，默认 1（clarify Q3） */
  callerDepth?: number;
  /**
   * 显式提供 changed files（来自 chokidar / 测试）；
   * 提供时跳过 gitDiff（EC-2 watch 无 git context）。
   */
  changedFilesOverride?: string[];
  /** 显式禁用 git shallow 检测（测试场景） */
  disableShallowFallback?: boolean;
  /** post-commit hook 场景的 ref range，默认 'HEAD' */
  gitRange?: string;
}

export interface BuildIncrementalResult {
  snapshot: SnapshotWrapper;
  /** 实际重索引的文件（含 caller expansion；deleted 文件也计入） */
  changedFiles: string[];
  /**
   * 原始 changed file 数（git diff / changedFilesOverride 输入数，**不含** caller expansion）。
   * W3 WARN-3：CLI 层 emit('caller-expand') 输出 = changedFiles.length - origChangedFilesCount。
   */
  origChangedFilesCount: number;
  /** 是否触发了 full re-index 降级 */
  fallbackToFull: boolean;
  fallbackReason?: IncrementalFallbackReason;
  /** 端到端耗时（ms） */
  durationMs: number;
}

/**
 * 增量构建主入口。
 *
 * 决策树：
 *   1. loadSnapshot 失败 / null → fallback to full（reason='no-snapshot'）
 *   2. changedFilesOverride 非 undefined → 直接用（EC-2 watch 路径）
 *   3. gitDiff 返回 null → fallback to full（reason='shallow-clone'）
 *   4. expandCallers 后跑 partial analyzeFile + buildUnifiedGraph
 *   5. mergeIncremental + saveSnapshot
 *
 * 注意：deletion 不重新跑 analyzeFile（文件已不存在），但仍在 changedSet 中，
 * mergeIncremental 会把对应节点 + 边 + hash 全部清掉。
 */
export async function buildIncremental(
  opts: BuildIncrementalOptions,
): Promise<BuildIncrementalResult> {
  const t0 = Date.now();
  const projectRoot = path.resolve(opts.projectRoot);
  const callerDepth = opts.callerDepth ?? 1;

  // ── 1. load snapshot ──
  const oldSnapshot = await loadSnapshot(projectRoot);
  if (!oldSnapshot) {
    const snapshot = await runFullReindex(projectRoot);
    return {
      snapshot,
      changedFiles: [],
      origChangedFilesCount: 0,
      fallbackToFull: true,
      fallbackReason: 'no-snapshot',
      durationMs: Date.now() - t0,
    };
  }

  // ── 2. 取 changed files ──
  let changedFiles: string[] | null;
  if (opts.changedFilesOverride !== undefined) {
    // 规范化为绝对路径
    const normalized = opts.changedFilesOverride.map((p) =>
      path.isAbsolute(p) ? p : path.join(projectRoot, p),
    );
    // chokidar / watch 路径用 detectStaleFiles 二次确认 hash 真变了，避免编辑器
    // 触摸文件（mtime 变但内容未变）触发不必要的重索引
    const stale = await detectStaleFiles(oldSnapshot, normalized);
    const staleSet = new Set(stale);
    // 保留原 override 中真正 stale 的，加上 detectStaleFiles 发现的 deleted 旧路径
    changedFiles = Array.from(new Set([...normalized.filter((f) => staleSet.has(f)), ...stale]));
  } else {
    changedFiles = await gitDiff({
      projectRoot,
      range: opts.gitRange,
      shallowFallback: !opts.disableShallowFallback,
    });
    if (changedFiles === null) {
      const snapshot = await runFullReindex(projectRoot);
      return {
        snapshot,
        changedFiles: [],
        origChangedFilesCount: 0,
        fallbackToFull: true,
        fallbackReason: 'shallow-clone',
        durationMs: Date.now() - t0,
      };
    }
  }

  // 仅保留可索引扩展名（避免 README.md 等触发增量）
  const supportedExts = LanguageAdapterRegistry.getInstance().getSupportedExtensions();
  changedFiles = changedFiles.filter((f) => {
    for (const ext of supportedExts) {
      if (f.endsWith(ext)) return true;
    }
    return false;
  });

  // 记录原始 changed file 数（W3 WARN-3：caller-expand emit 用作减数）
  const origChangedFilesCount = changedFiles.length;

  // ── 3. 空 diff 短路：写回 snapshot 仅刷新 generatedAt ──
  if (changedFiles.length === 0) {
    return {
      snapshot: oldSnapshot,
      changedFiles: [],
      origChangedFilesCount: 0,
      fallbackToFull: false,
      durationMs: Date.now() - t0,
    };
  }

  // ── 4. expandCallers ──
  const expanded = expandCallers({
    changedFiles,
    snapshot: oldSnapshot,
    depth: callerDepth,
  });
  const changedSet = new Set(expanded);

  // ── 5. 对 changedSet 中**仍存在**的文件跑 partial buildUnifiedGraph ──
  const codeSkeletons = new Map<string, CodeSkeleton>();
  for (const f of changedSet) {
    try {
      // fs.access 更轻；analyzeFile 自带 FileNotFoundError 但用 access 提前过滤
      await fsp.access(f);
    } catch {
      continue; // deleted 文件不参与 partial build
    }
    try {
      const sk = await analyzeFile(f, { projectRoot });
      if (sk) codeSkeletons.set(f, sk);
    } catch (err) {
      // 单文件失败不阻断（与 batch-orchestrator 一致策略）
      process.stderr.write(
        `[incremental] analyzeFile 失败 (${f}): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const newPartialGraph = buildUnifiedGraph({
    projectRoot,
    codeSkeletons,
  });

  // ── 6. 计算新 hash（仅存在文件）──
  const newFileHashes = await computeAllFileHashes(
    projectRoot,
    Array.from(codeSkeletons.keys()),
  );

  // ── 7. merge + save ──
  const merged = mergeIncremental({
    oldSnapshot,
    changedSet,
    newPartialGraph,
    newFileHashes,
  });

  // W3 WARN-1：merge 出口前 safeParse 验证；失败视为 corruption 降级（不让坏 snapshot 写盘）
  const validation = SnapshotWrapperSchema.safeParse(merged);
  if (!validation.success) {
    process.stderr.write(
      `[incremental] mergeIncremental 输出 schema 校验失败，降级 full re-index: ${validation.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; ')}\n`,
    );
    const snapshot = await runFullReindex(projectRoot);
    return {
      snapshot,
      changedFiles: expanded,
      origChangedFilesCount,
      fallbackToFull: true,
      fallbackReason: 'corruption',
      durationMs: Date.now() - t0,
    };
  }

  // saveSnapshot 失败 → 视为 corruption 降级（罕见路径）
  try {
    await saveSnapshot(merged, projectRoot);
  } catch (err) {
    process.stderr.write(
      `[incremental] saveSnapshot 失败，降级 full re-index: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    const snapshot = await runFullReindex(projectRoot);
    return {
      snapshot,
      changedFiles: expanded,
      origChangedFilesCount,
      fallbackToFull: true,
      fallbackReason: 'corruption',
      durationMs: Date.now() - t0,
    };
  }

  return {
    snapshot: merged,
    changedFiles: expanded,
    origChangedFilesCount,
    fallbackToFull: false,
    durationMs: Date.now() - t0,
  };
}

/**
 * 触发一次 full re-index（fallback 路径）。
 *
 * 与 src/cli/commands/index.ts 的全量逻辑保持等价（扫描 → analyzeFile → buildUnifiedGraph → save）；
 * 提取到本模块独立函数，避免 cli 层 ↔ incremental 层双向依赖。
 */
async function runFullReindex(projectRoot: string): Promise<SnapshotWrapper> {
  const registry = LanguageAdapterRegistry.getInstance();
  const supportedExts = registry.getSupportedExtensions();
  const scanResult = scanFiles(projectRoot, {
    projectRoot,
    extensions: supportedExts,
  });
  const absFiles = scanResult.files.map((rel) =>
    path.isAbsolute(rel) ? rel : path.join(projectRoot, rel),
  );

  const codeSkeletons = new Map<string, CodeSkeleton>();
  for (const absFile of absFiles) {
    try {
      const sk = await analyzeFile(absFile, { projectRoot });
      if (sk) codeSkeletons.set(absFile, sk);
    } catch (err) {
      // 单文件失败不阻断；与 buildIncremental 路径一致输出 stderr 便于排查
      process.stderr.write(
        `[full-reindex] analyzeFile 失败 (${absFile}): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const graph = buildUnifiedGraph({
    projectRoot,
    codeSkeletons,
  });
  const fileHashes = await computeAllFileHashes(projectRoot, absFiles);
  const snapshot = buildSnapshotWrapper(graph, fileHashes);
  await saveSnapshot(snapshot, projectRoot);
  return snapshot;
}

// 副作用避免：computeFileHash 仅在测试中可能用到，re-export 以方便单测
export { computeFileHash };
