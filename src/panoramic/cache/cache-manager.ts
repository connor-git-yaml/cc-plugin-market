/**
 * 缓存管理器
 * 组合 ContentHasher 和 ManifestManager，提供缓存检查、记录、刷盘、清除功能
 *
 * 并发约束：CacheManager 不应与 batch 并发执行。
 * 当前串行架构下无此问题，并发化时需引入写锁。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentGenerator, ProjectContext } from '../interfaces.js';
import type { ContentHasher } from './content-hasher.js';
import type { ManifestManager, ManifestStats } from './manifest-manager.js';
import type { FileHashRecord, ManifestEntry } from './schemas.js';
import { buildGeneratorCacheKey, resolveInputFiles } from './cache-key-builder.js';

/**
 * 缓存管理器
 * 组合 ContentHasher 和 ManifestManager，实现缓存检查 / 记录 / 清除
 */
export class CacheManager {
  private hasher: ContentHasher;
  private manifestManager: ManifestManager;
  private manifestPath: string = '';
  private outputDir: string = '';
  /** check() 阶段缓存的 cacheKey，供 record() 复用以避免重复计算 */
  private lastCacheKey: string | null = null;
  private lastInputFiles: string[] | null = null;

  constructor(hasher: ContentHasher, manifestManager: ManifestManager) {
    this.hasher = hasher;
    this.manifestManager = manifestManager;
  }

  /**
   * 初始化：计算 manifestPath 并加载 manifest
   * @param outputDir panoramic 输出目录
   */
  async initialize(outputDir: string): Promise<void> {
    this.outputDir = outputDir;
    this.manifestPath = path.join(outputDir, '_meta', '_cache-manifest.json');
    await this.manifestManager.load(this.manifestPath);
  }

  /**
   * 检查 generator 是否命中缓存
   * 内部计算 cacheKey，并对 manifest entry 的所有 inputFiles 做 stale 校验
   *
   * 三路 stale 校验（任一满足即判定 stale）：
   * 1. 文件不存在（已删除）
   * 2. 文件 mtime 早于记录的 mtime（文件被回滚）
   * 3. 文件内容 SHA256 与记录不一致
   *
   * @returns 命中时返回 ManifestEntry，未命中或 stale 时返回 false
   */
  async check(
    generator: DocumentGenerator<unknown, unknown>,
    context: ProjectContext,
  ): Promise<ManifestEntry | false> {
    let cacheKey: string;
    let inputFiles: string[];
    try {
      cacheKey = await buildGeneratorCacheKey(generator, context, this.hasher, this.outputDir || undefined);
      inputFiles = await resolveInputFiles(generator, context, this.outputDir || undefined);
    } catch {
      // cache key 计算失败（如依赖文件已删除），判定 stale
      this.lastCacheKey = null;
      this.lastInputFiles = null;
      return false;
    }

    // 缓存 cacheKey 和 inputFiles 供 record() 复用
    this.lastCacheKey = cacheKey;
    this.lastInputFiles = inputFiles;

    const entry = this.manifestManager.get(cacheKey);

    if (!entry) {
      return false;
    }

    // 对每个 inputFile 做 stale 校验
    for (const record of entry.inputFiles) {
      // 文件不存在
      if (!fs.existsSync(record.path)) {
        return false;
      }

      const stat = fs.statSync(record.path);

      // mtime 回滚（文件被回滚到更早的版本）→ 快速判定 stale
      if (stat.mtimeMs < record.mtime) {
        return false;
      }

      // 始终校验 hash（不以 mtime 相同作为跳过条件）
      // 确保内容变化但 mtime 保持不变时（如 --preserve-timestamps）也能检测到 stale
      const currentHash = await this.hasher.hashFile(record.path);
      if (currentHash !== record.hash) {
        return false;
      }
    }

    // 全部通过，缓存命中
    console.log(
      `[cache-hit] ${generator.id}: ${entry.inputFiles.length} files unchanged, reusing output`,
    );
    return entry;
  }

  /**
   * 记录 generator 的执行结果到 manifest（内存操作）
   * 仅由成功路径调用
   *
   * @param generator generator 实例
   * @param context ProjectContext
   * @param outputFiles 本次生成的输出文件路径列表
   */
  async record(
    generator: DocumentGenerator<unknown, unknown>,
    context: ProjectContext,
    outputFiles: string[],
  ): Promise<void> {
    // 优先复用 check() 阶段缓存的 cacheKey/inputFiles，避免重复计算
    const cacheKey = this.lastCacheKey ?? await buildGeneratorCacheKey(generator, context, this.hasher, this.outputDir || undefined);
    const inputFiles = this.lastInputFiles ?? await resolveInputFiles(generator, context, this.outputDir || undefined);
    // 用完后清空，避免跨 generator 误用
    this.lastCacheKey = null;
    this.lastInputFiles = null;

    // 为每个输入文件构建 FileHashRecord
    const fileRecords: FileHashRecord[] = [];
    for (const filePath of inputFiles) {
      try {
        const stat = fs.statSync(filePath);
        const hash = await this.hasher.hashFile(filePath);
        fileRecords.push({
          path: filePath,
          hash,
          mtime: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
        // 文件不可读时跳过
      }
    }

    const entry: ManifestEntry = {
      cacheKey,
      generatorId: generator.id,
      inputFiles: fileRecords,
      outputFiles,
      createdAt: Date.now(),
    };

    this.manifestManager.set(entry);
  }

  /**
   * 将内存 manifest 原子写盘
   */
  async flush(): Promise<void> {
    await this.manifestManager.flush(this.manifestPath);
  }

  /**
   * 清除缓存
   * @param generatorId 指定 generator 时仅清除该 generator 的条目，否则清除全部
   */
  async clear(generatorId?: string): Promise<void> {
    if (generatorId === undefined) {
      // 清除全部：删除 manifest 文件及 .tmp 残留
      this.manifestManager.delete();
      try {
        if (fs.existsSync(this.manifestPath)) {
          fs.unlinkSync(this.manifestPath);
        }
        const tmpPath = `${this.manifestPath}.tmp`;
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // 删除失败时静默处理
      }
    } else {
      // 清除指定 generator 的条目
      this.manifestManager.delete(generatorId);
      await this.flush();
    }
  }

  /**
   * 返回统计摘要（委托 ManifestManager）
   */
  stats(): ManifestStats {
    return this.manifestManager.stats();
  }
}
