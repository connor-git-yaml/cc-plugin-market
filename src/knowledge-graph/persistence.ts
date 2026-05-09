/**
 * Feature 156 W2 — UnifiedGraph snapshot 持久化层。
 *
 * 提供 .spectra/unified-graph.json 的读写 + 文件 hash 索引能力，
 * 让 `spectra index` 命令在多次运行之间复用图结构（FR-1 ~ FR-5、FR-30、AC-9）。
 *
 * 关键设计决策：
 * - 写盘格式 = pretty JSON（clarify Q1 决议；调试友好，1 MB 量级 parse/stringify < 50 ms）
 * - 不裁剪 symbol 节点（clarify Q2 决议；保留完整 UnifiedGraph 让 caller expansion 精确到 symbol 粒度）
 * - 原子写入 = 临时文件 + rename（process.pid 区分多进程，"最后写者胜"语义）
 * - SnapshotWrapperSchema 是独立的 Zod schema，**不修改** UnifiedGraphSchema（NG-3）
 * - load 失败 / corruption / schemaVersion 不匹配 → 返回 null，由调用方触发 full re-index（EC-3 / EC-8）
 * - 跨 worktree 隔离（EC-11）：每个 worktree 各自的 projectRoot/.spectra/，互不共享
 *
 * Spec v3.2 W1 → W2 handoff：SnapshotWrapper 必须**完整透传** UnifiedEdge.metadata 字段
 * （含 `importType`），不允许像 panoramic graph-builder 序列化路径那样静默丢失结构化扩展数据。
 * 本模块直接序列化 UnifiedGraph（走 Zod schema 派生 → JSON.stringify），天然保留所有字段。
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { UnifiedGraphSchema, type UnifiedGraph } from './unified-graph.js';

// ───────────────────────────────────────────────────────────
// Schema
// ───────────────────────────────────────────────────────────

/** SnapshotWrapper 自身版本（与内嵌 UnifiedGraph.metadata.schemaVersion 解耦） */
export const SNAPSHOT_WRAPPER_VERSION = '1.0' as const;

/**
 * SnapshotWrapper schema — `.spectra/unified-graph.json` 的顶层结构。
 *
 * 字段定义参见 spec.md §4.2：
 *   schemaVersion: SnapshotWrapper 自身版本（升版时本字段 bump）
 *   generatedAt:   ISO 8601 datetime
 *   graph:         完整 UnifiedGraph（不裁剪 symbol 节点）
 *   fileHashes:    绝对路径 → 该文件内容的 SHA-256 hex
 */
export const SnapshotWrapperSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_WRAPPER_VERSION),
  generatedAt: z.string().datetime(),
  graph: UnifiedGraphSchema,
  fileHashes: z.record(z.string(), z.string()),
});
export type SnapshotWrapper = z.infer<typeof SnapshotWrapperSchema>;

// ───────────────────────────────────────────────────────────
// 路径常量
// ───────────────────────────────────────────────────────────

const SNAPSHOT_DIR = '.spectra';
const SNAPSHOT_FILENAME = 'unified-graph.json';

/** 给定项目根，计算 `.spectra/unified-graph.json` 的绝对路径 */
export function snapshotPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), SNAPSHOT_DIR, SNAPSHOT_FILENAME);
}

// ───────────────────────────────────────────────────────────
// Hash 工具（FR-2 SHA-256）
// ───────────────────────────────────────────────────────────

/**
 * 计算单个文件内容的 SHA-256 hex digest。
 * 文件不存在时返回 null（让 detectStaleFiles 决定如何处理 deleted 路径）。
 */
export async function computeFileHash(absPath: string): Promise<string | null> {
  try {
    const content = await fsp.readFile(absPath);
    return createHash('sha256').update(content).digest('hex');
  } catch (err) {
    // 文件不存在 / 权限错误等 → 返回 null
    void err;
    return null;
  }
}

/**
 * 批量计算文件 hash（串行执行，clarify Q-D4 决议；与 SHA-256 计算量比较，IO 是瓶颈，并行收益有限）。
 *
 * @param files 绝对路径数组
 * @returns 路径 → hash 的 record；不存在的文件不出现在 record 中
 */
export async function computeAllFileHashes(
  _projectRoot: string,
  files: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const h = await computeFileHash(f);
    if (h !== null) {
      out[f] = h;
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────
// save（FR-1 / FR-5 原子写入）
// ───────────────────────────────────────────────────────────

/**
 * 持久化 SnapshotWrapper 到 `.spectra/unified-graph.json`。
 *
 * 写入策略（FR-5 / spec NG-3 amendment / W1 v3 多进程 tradeoff）：
 *   1. mkdir -p .spectra/
 *   2. JSON.stringify(snapshot, null, 2) → 写入 unified-graph.<pid>.tmp
 *   3. fs.rename(tmp, target) — POSIX rename 是原子操作
 * 多进程并发场景：`<pid>` 区分各进程的 tmp，rename 后写者覆盖前者；
 * 不会出现部分写入的损坏文件（worst case：丢失某次写入，可接受）。
 *
 * @param snapshot 要写入的 SnapshotWrapper（建议先经 schema 校验）
 * @param projectRoot 项目根目录（绝对或相对路径均可，内部会 resolve）
 */
export async function saveSnapshot(
  snapshot: SnapshotWrapper,
  projectRoot: string,
): Promise<void> {
  const targetPath = snapshotPath(projectRoot);
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });

  // pretty JSON（clarify Q1）
  const content = JSON.stringify(snapshot, null, 2);

  // 含 pid + 随机后缀的唯一 tmp 名，多进程 / 同进程并发时都不互相覆盖 tmp
  // （单进程同 pid 多次并发调用 saveSnapshot 时单纯用 pid 会导致 tmp 路径冲突）
  const tmpPath = path.join(
    dir,
    `${SNAPSHOT_FILENAME}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  );
  await fsp.writeFile(tmpPath, content, 'utf-8');
  // POSIX rename 原子覆盖目标文件
  await fsp.rename(tmpPath, targetPath);
}

// ───────────────────────────────────────────────────────────
// load（FR-3 / EC-8 corruption 降级）
// ───────────────────────────────────────────────────────────

/**
 * 读取并 safeParse `.spectra/unified-graph.json`。
 *
 * 返回 null 的 4 种情况（均不抛异常，让调用方触发 full re-index）：
 *   1. 文件不存在
 *   2. JSON 解析失败（磁盘损坏、手动编辑出错）
 *   3. SnapshotWrapperSchema.safeParse 失败（schema 漂移、版本不匹配）
 *   4. 内嵌 UnifiedGraphSchema 校验失败
 *
 * 降级原因写入 stdout（machine-readable JSON line），方便上游脚本判断。
 */
export async function loadSnapshot(projectRoot: string): Promise<SnapshotWrapper | null> {
  const targetPath = snapshotPath(projectRoot);

  let raw: string;
  try {
    raw = await fsp.readFile(targetPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null; // 文件不存在 — 静默返回 null，调用方触发 full re-index
    }
    // 其他读错误（权限等）记录后降级
    process.stdout.write(
      `${JSON.stringify({ event: 'snapshot-load-fallback', fallbackReason: 'read-error', error: String(err) })}\n`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ event: 'snapshot-load-fallback', fallbackReason: 'json-parse-error', error: String(err) })}\n`,
    );
    return null;
  }

  const result = SnapshotWrapperSchema.safeParse(parsed);
  if (!result.success) {
    process.stdout.write(
      `${JSON.stringify({
        event: 'snapshot-load-fallback',
        fallbackReason: 'schema-validation-failed',
        issues: result.error.issues.slice(0, 3).map((i) => ({ path: i.path, message: i.message })),
      })}\n`,
    );
    return null;
  }

  return result.data;
}

// ───────────────────────────────────────────────────────────
// stale 检测（FR-3 / EC-9 rename-delete）
// ───────────────────────────────────────────────────────────

/**
 * 比对 snapshot 中的 fileHashes 与磁盘实际 hash，找出需要重索引的文件集合。
 *
 * stale 判定规则（覆盖 EC-9）：
 *   - 当前文件存在 + hash 与 snapshot 记录不同 → stale（需重索引）
 *   - 当前文件存在 + snapshot 中无记录 → stale（新增文件）
 *   - 当前文件不存在 + snapshot 中有记录 → stale（被 rename / delete 的旧路径）
 *   - 当前文件存在 + hash 与 snapshot 一致 → 不 stale（可复用）
 *
 * @param snapshot 已加载的 SnapshotWrapper
 * @param currentFiles 当前项目扫描出的源文件绝对路径列表
 * @returns 需要重索引的绝对路径集合（含新增 / 修改 / 删除三类）
 */
export async function detectStaleFiles(
  snapshot: SnapshotWrapper,
  currentFiles: string[],
): Promise<string[]> {
  const stale = new Set<string>();
  const currentSet = new Set(currentFiles);

  // (1) 检查当前文件：新增或 hash 不一致 → stale
  for (const f of currentFiles) {
    const oldHash = snapshot.fileHashes[f];
    const newHash = await computeFileHash(f);
    if (newHash === null) {
      // 文件读不到（罕见：扫描时存在但现在消失）→ 视为 deleted
      if (oldHash !== undefined) stale.add(f);
      continue;
    }
    if (oldHash === undefined || oldHash !== newHash) {
      stale.add(f);
    }
  }

  // (2) 检查 snapshot 中存在但当前已不存在的路径 → deleted（也算 stale，调用方需移除节点）
  for (const oldPath of Object.keys(snapshot.fileHashes)) {
    if (!currentSet.has(oldPath)) {
      // 若 currentFiles 已包含则跳过（避免重复）
      if (!fs.existsSync(oldPath)) {
        stale.add(oldPath);
      }
    }
  }

  return Array.from(stale).sort();
}

// ───────────────────────────────────────────────────────────
// Helper：构建一个完整的 SnapshotWrapper（供 spectra index 命令使用）
// ───────────────────────────────────────────────────────────

/**
 * 把一个 UnifiedGraph + 文件 hash 表打包成 SnapshotWrapper。
 *
 * @param graph 已构建的 UnifiedGraph
 * @param fileHashes 路径 → SHA-256 hex
 */
export function buildSnapshotWrapper(
  graph: UnifiedGraph,
  fileHashes: Record<string, string>,
): SnapshotWrapper {
  return {
    schemaVersion: SNAPSHOT_WRAPPER_VERSION,
    generatedAt: new Date().toISOString(),
    graph,
    fileHashes,
  };
}
