/**
 * 模块骨架哈希（skeleton-hash）—— 增量缓存的唯一权威 hash 实现（Feature 182）
 *
 * 背景：F175 增量再生成链中写侧（single-spec-orchestrator）与读侧（delta-regenerator）
 * 各自合成 skeletonHash，两套排序口径（code-unit vs localeCompare）+ 文件集来源不同，
 * 混合大小写 / 混语言下必然分叉，导致增量永久 cache miss。
 *
 * 本模块拆两层单点权威：
 *   - combineSkeletonHashes（纯函数）：写侧 + 读侧共用的唯一 hash 合并公式
 *   - computeModuleSkeletonHash（wrapper）：读侧与测试便捷入口，内部 analyzeFiles 后调纯函数
 *
 * 放在 src/core/ 中性层位（而非 src/batch/），batch→core 依赖方向不变。
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { analyzeFiles } from './ast-analyzer.js';

/** combineSkeletonHashes 的输入条目 */
export interface SkeletonHashEntry {
  /** 排序键（项目相对 POSIX 路径）；仅用于确定性排序，不进 hash */
  sortKey: string;
  /** 单文件 skeleton 的 SHA-256 哈希 */
  hash: string;
}

/**
 * 确定性 code-unit 比较器（逐 UTF-16 char code，禁 localeCompare）。
 *
 * 设计注记：localeCompare 依赖 ICU/locale，混合大小写文件名下两机结果可能相反，
 * 且与上游 file-scanner 的 code-unit 序口径分叉。统一用 `<`/`>` 逐字符比较，
 * 保证跨机、跨写读两侧排序一致。
 */
function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 唯一权威 skeleton hash 合并公式（纯函数）。
 *
 * - entries.length === 1：直接返回该文件 hash（兼容单文件语义，不经二次 sha256）
 * - 否则：按 sortKey 做确定性 code-unit 排序 → 各 hash 拼接 → sha256
 *
 * 设计注记：hash 值只依赖 skeleton hash 集合与排序结果，sortKey 本身不进 hash；
 * 同一文件集下任意公共祖先作 relative base 排序结果不变（code-unit 比较下公共前缀
 * 不影响相对序），故写侧（cwd-relative）与读侧（projectRoot-relative）顺序一致。
 *
 * @param entries 各文件的 { sortKey, hash } 条目（顺序无关，内部排序）
 * @returns 合并后的模块级 skeletonHash
 */
export function combineSkeletonHashes(entries: SkeletonHashEntry[]): string {
  if (entries.length === 1) {
    return entries[0]!.hash;
  }

  const combinedContent = entries
    .slice()
    .sort((left, right) => compareCodeUnit(left.sortKey, right.sortKey))
    .map((entry) => entry.hash)
    .join('');

  return createHash('sha256').update(combinedContent).digest('hex');
}

/**
 * 便捷 wrapper：分析文件集后调用 combineSkeletonHashes（读侧 delta-regenerator 与测试使用）。
 *
 * 写侧（single-spec-orchestrator）不调用本 wrapper —— 复用 prepareContext 已有的 skeletons
 * 直接调 combineSkeletonHashes，避免对同一文件集二次 analyzeFiles（2× AST 性能回归）。
 *
 * @param projectRoot 项目根绝对路径
 * @param files 项目相对路径列表（POSIX 或系统分隔符均可，内部 path.join）
 * @returns 模块级 skeletonHash；文件集为空或全部分析失败时返回 undefined
 */
export async function computeModuleSkeletonHash(
  projectRoot: string,
  files: string[],
): Promise<string | undefined> {
  if (files.length === 0) {
    return undefined;
  }

  const analyzed = await analyzeFiles(files.map((filePath) => path.join(projectRoot, filePath)));

  if (analyzed.length === 0) {
    return undefined;
  }

  const entries: SkeletonHashEntry[] = analyzed.map((skeleton) => ({
    // sortKey = 项目相对 POSIX 路径（analyzed.filePath 为 path.join 后的绝对路径）
    sortKey: path.relative(projectRoot, skeleton.filePath).split(path.sep).join('/'),
    hash: skeleton.hash,
  }));

  return combineSkeletonHashes(entries);
}
