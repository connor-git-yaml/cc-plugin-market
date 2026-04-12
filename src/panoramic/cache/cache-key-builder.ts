/**
 * cache key 构建器
 *
 * cache key 材料构成：
 *   generator.id | projectRoot | workspaceType | packageManager | detectedLanguages | aggregatedFileHash
 *
 * 明确排除 existingSpecs（每次运行都变化）和 configFiles（Map 序列化顺序不稳定）
 * 以避免运行时易变数据导致缓存频繁失效。
 *
 * fallback 路径：当 generator 未实现 getDependencies() 时，
 * 退回到全量源文件扫描。性能影响：中大型项目首次扫描可能耗时数百 ms，
 * 但结果会被 CacheManager 缓存为 manifest entry，后续检查仅做 mtime/hash 比对。
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentGenerator, ProjectContext } from '../interfaces.js';
import type { ContentHasher } from './content-hasher.js';

// ============================================================
// 常量
// ============================================================

/** fallback 扫描时排除的目录 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '_meta',
  'dist',
  '.cache',
]);

/** fallback 扫描时收集的文件扩展名 */
const INCLUDED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.json', '.md', '.yaml', '.yml',
  '.toml', '.lock',
]);

/** fallback 扫描时：无扩展名但需要包含的文件名前缀（Dockerfile, .env 等） */
const INCLUDED_FILENAME_PREFIXES = ['Dockerfile', '.env'];

// ============================================================
// 辅助函数
// ============================================================

/**
 * 递归扫描 projectRoot 下所有源文件
 * 排除噪声目录，仅收集指定扩展名，结果排序后返回
 */
export function scanSourceFiles(root: string, excludePaths: string[] = []): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // 目录不可读时跳过
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // 跳过明确排除的路径（如 outputDir）
      if (excludePaths.some((excluded) => fullPath.startsWith(excluded))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (INCLUDED_EXTENSIONS.has(ext) || INCLUDED_FILENAME_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(root);
  return results.sort();
}

/**
 * 解析 generator 的输入文件列表
 * 优先使用 getDependencies()，fallback 为全量扫描
 */
export async function resolveInputFiles(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  outputDir?: string,
): Promise<string[]> {
  // 优先使用 generator 声明的依赖
  if (typeof generator.getDependencies === 'function') {
    const deps = await Promise.resolve(generator.getDependencies(context));
    return [...deps].sort();
  }

  // fallback: 扫描 projectRoot 下所有源文件（排除 outputDir 避免自我引用）
  return scanSourceFiles(context.projectRoot, outputDir ? [outputDir] : []);
}

/**
 * 构建 generator 的 cache key
 *
 * key 材料：generator.id | projectRoot | workspaceType | packageManager
 *          | detectedLanguages(sorted) | aggregatedFileHash
 *
 * @param generator - DocumentGenerator 实例
 * @param context - 项目上下文
 * @param hasher - ContentHasher 实例
 * @returns SHA256 hex 字符串
 */
export async function buildGeneratorCacheKey(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  hasher: ContentHasher,
  outputDir?: string,
): Promise<string> {
  // 解析输入文件列表
  const inputFiles = await resolveInputFiles(generator, context, outputDir);

  // 计算文件集合的聚合哈希
  const aggregatedFileHash = await hasher.hashFiles(inputFiles);

  // 构建 key 材料字符串
  const keyMaterial = [
    generator.id,
    context.projectRoot,
    context.workspaceType,
    context.packageManager,
    [...context.detectedLanguages].sort().join(','),
    aggregatedFileHash,
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(keyMaterial)
    .digest('hex');
}
