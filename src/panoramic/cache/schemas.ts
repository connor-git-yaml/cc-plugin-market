/**
 * 内容哈希缓存 Zod Schema 定义
 * 三层 schema：FileHashRecord → ManifestEntry → CacheManifest
 * 预留 dependencyGraph 字段供 Feature 101（graph-persistence）扩展
 */
import { z } from 'zod';

// ============================================================
// FileHashRecord — 单个源文件的哈希记录
// ============================================================

/** 单个源文件的哈希记录 Schema */
export const FileHashRecordSchema = z.object({
  /** 文件绝对路径 */
  path: z.string(),
  /** SHA256(filePath + fileContent) */
  hash: z.string(),
  /** 文件最后修改时间（Unix ms） */
  mtime: z.number(),
  /** 文件字节大小 */
  size: z.number(),
});

/** 单个源文件的哈希记录类型 */
export type FileHashRecord = z.infer<typeof FileHashRecordSchema>;

// ============================================================
// ManifestEntry — 单个 generator 的 manifest 条目
// ============================================================

/** 单个 generator 的 manifest 条目 Schema */
export const ManifestEntrySchema = z.object({
  /** cache key（SHA256 of generator + context + files） */
  cacheKey: z.string(),
  /** generator.id */
  generatorId: z.string(),
  /** 该 generator 输入的源文件列表 */
  inputFiles: z.array(FileHashRecordSchema),
  /** 生成的输出文件路径列表（相对于 outputDir） */
  outputFiles: z.array(z.string()),
  /** manifest entry 创建/更新时间（Unix ms） */
  createdAt: z.number(),
  /** 输出内容类型（对应 generator 生成的文档类型） */
  type: z.string().optional(),
  /** 预留字段：供 Feature 101（graph-persistence）扩展依赖图 */
  dependencyGraph: z.unknown().optional(),
});

/** 单个 generator 的 manifest 条目类型 */
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

// ============================================================
// CacheManifest — 顶层 manifest 结构
// ============================================================

/** 缓存 manifest Schema */
export const CacheManifestSchema = z.object({
  /** schema 版本，用于向前兼容校验 */
  version: z.literal('1'),
  /** manifest 最后写入时间（Unix ms） */
  updatedAt: z.number(),
  /** cacheKey → ManifestEntry 的映射 */
  entries: z.record(z.string(), ManifestEntrySchema),
});

/** 缓存 manifest 类型 */
export type CacheManifest = z.infer<typeof CacheManifestSchema>;
