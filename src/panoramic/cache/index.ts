/**
 * cache 模块统一导出
 * 薄壳文件，不含业务逻辑，按 Phase 逐步补充导出
 */

// Phase A: 基础设施层
export {
  FileHashRecordSchema,
  ManifestEntrySchema,
  CacheManifestSchema,
  type FileHashRecord,
  type ManifestEntry,
  type CacheManifest,
} from './schemas.js';

export {
  type ContentHasher,
  ContentHasherImpl,
} from './content-hasher.js';

// Phase B: Manifest 管理层
export {
  type ManifestManager,
  type ManifestStats,
  ManifestManagerImpl,
} from './manifest-manager.js';

// Phase C: 缓存拦截层
export { CacheManager } from './cache-manager.js';
export { buildGeneratorCacheKey, scanSourceFiles, resolveInputFiles } from './cache-key-builder.js';
