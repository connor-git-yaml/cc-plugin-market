/**
 * Manifest 管理器
 * 内存态 manifest 管理，含加载、查询、更新、删除、原子刷盘、统计
 * 版本不兼容或 JSON 损坏时打印 warn 并清空，不抛错
 */
import * as fs from 'node:fs';
import { writeAtomicJson } from '../../utils/atomic-write.js';
import {
  CacheManifestSchema,
  type CacheManifest,
  type ManifestEntry,
} from './schemas.js';

// ============================================================
// ManifestStats 类型
// ============================================================

/** manifest 统计摘要 */
export interface ManifestStats {
  /** 缓存条目总数 */
  entryCount: number;
  /** 所有 ManifestEntry.inputFiles[*].size 的累加值（字节） */
  totalSizeBytes: number;
  /** manifest 最后更新时间（Unix ms），无记录时为 undefined */
  lastUpdatedAt: number | undefined;
  /** generatorId → 条目数 */
  byGenerator: Record<string, number>;
}

// ============================================================
// ManifestManager 接口
// ============================================================

/**
 * manifest 管理接口
 */
export interface ManifestManager {
  /**
   * 加载 manifest 文件
   * 版本不兼容时自动清空并打印警告，不抛错
   * @param manifestPath _cache-manifest.json 的绝对路径
   */
  load(manifestPath: string): Promise<void>;

  /**
   * 根据 cacheKey 查询 manifest entry
   * @returns entry 对象，不存在时返回 undefined
   */
  get(cacheKey: string): ManifestEntry | undefined;

  /**
   * 更新或插入一条 manifest entry（内存操作，不立即写盘）
   */
  set(entry: ManifestEntry): void;

  /**
   * 删除指定 generatorId 的所有条目（内存操作）
   * generatorId 为 undefined 时删除全部条目
   */
  delete(generatorId?: string): void;

  /**
   * 将当前内存中的 manifest 原子写入磁盘
   * @param manifestPath 写入目标路径
   */
  flush(manifestPath: string): Promise<void>;

  /**
   * 返回当前 manifest 的统计摘要
   */
  stats(): ManifestStats;
}

// ============================================================
// ManifestManagerImpl 实现
// ============================================================

/** 创建空 manifest 的工厂函数 */
function createEmptyManifest(): CacheManifest {
  return {
    version: '1',
    updatedAt: 0,
    entries: {},
  };
}

/**
 * ManifestManager 的默认实现
 */
export class ManifestManagerImpl implements ManifestManager {
  /** 内存态 manifest */
  private manifest: CacheManifest = createEmptyManifest();

  /** manifest 文件路径 */
  private manifestPath: string = '';

  /**
   * 加载 manifest 文件
   * 文件不存在时静默保持空 manifest
   * version 不兼容或 JSON 损坏时 warn 并清空，不抛错
   */
  async load(manifestPath: string): Promise<void> {
    this.manifestPath = manifestPath;

    if (!fs.existsSync(manifestPath)) {
      this.manifest = createEmptyManifest();
      return;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const data: unknown = JSON.parse(content);
      const result = CacheManifestSchema.safeParse(data);

      if (!result.success) {
        console.warn('[cache] manifest 解析失败，自动清空缓存');
        this.manifest = createEmptyManifest();
        return;
      }

      this.manifest = result.data;
    } catch {
      // JSON.parse 失败等情况
      console.warn('[cache] manifest 文件损坏，自动清空缓存');
      this.manifest = createEmptyManifest();
    }
  }

  /**
   * 根据 cacheKey 查询 entry
   */
  get(cacheKey: string): ManifestEntry | undefined {
    return this.manifest.entries[cacheKey];
  }

  /**
   * 更新或插入 entry（内存操作）
   */
  set(entry: ManifestEntry): void {
    this.manifest.entries[entry.cacheKey] = entry;
  }

  /**
   * 删除条目（内存操作）
   * generatorId 为 undefined 时清空全部
   */
  delete(generatorId?: string): void {
    if (generatorId === undefined) {
      this.manifest.entries = {};
      return;
    }

    // 遍历删除匹配 generatorId 的条目
    const entries = this.manifest.entries;
    for (const key of Object.keys(entries)) {
      if (entries[key]?.generatorId === generatorId) {
        delete entries[key];
      }
    }
  }

  /**
   * 将内存 manifest 原子写盘
   */
  async flush(manifestPath: string): Promise<void> {
    this.manifest.updatedAt = Date.now();
    writeAtomicJson(manifestPath, this.manifest);
  }

  /**
   * 返回统计摘要
   */
  stats(): ManifestStats {
    const entries = this.manifest.entries;
    const keys = Object.keys(entries);
    let totalSizeBytes = 0;
    const byGenerator: Record<string, number> = {};

    for (const key of keys) {
      const entry = entries[key];
      if (!entry) continue;

      // 累加 inputFiles 的 size
      for (const file of entry.inputFiles) {
        totalSizeBytes += file.size;
      }

      // 按 generatorId 分组计数
      byGenerator[entry.generatorId] = (byGenerator[entry.generatorId] ?? 0) + 1;
    }

    return {
      entryCount: keys.length,
      totalSizeBytes,
      lastUpdatedAt: this.manifest.updatedAt > 0 ? this.manifest.updatedAt : undefined,
      byGenerator,
    };
  }
}
