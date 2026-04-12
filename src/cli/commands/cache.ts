/**
 * cache 子命令 handler
 * 管理内容哈希缓存（stats / clear）
 *
 * 并发约束：不应与 batch 并发执行。
 * 当前 CLI 单进程，无实际并发场景。
 */

import * as path from 'node:path';
import type { CLICommand } from '../utils/parse-args.js';
import { CacheManager } from '../../panoramic/cache/cache-manager.js';
import { ContentHasherImpl } from '../../panoramic/cache/content-hasher.js';
import { ManifestManagerImpl } from '../../panoramic/cache/manifest-manager.js';

const CACHE_HELP = `spectra cache — 管理内容哈希缓存

用法:
  spectra cache stats [--output-dir <dir>]
  spectra cache clear [--generator <id>] [--output-dir <dir>]

子操作:
  stats    显示缓存 manifest 统计信息（条目数、总 size、分组）
  clear    清除缓存（全部或指定 generator）

选项:
  --output-dir   指定输出目录（默认为 <cwd>/specs）
  --generator    指定要清除的 generator ID（仅 clear）`;

/**
 * 执行 cache 子命令
 */
export async function runCacheCommand(command: CLICommand): Promise<void> {
  if (command.help || !command.cacheOperation) {
    console.log(CACHE_HELP);
    return;
  }

  const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');
  const cacheManager = new CacheManager(
    new ContentHasherImpl(),
    new ManifestManagerImpl(),
  );
  await cacheManager.initialize(outputDir);

  if (command.cacheOperation === 'stats') {
    const manifestPath = path.join(outputDir, '_meta', '_cache-manifest.json');
    const stats = cacheManager.stats();
    const sizeMB = (stats.totalSizeBytes / (1024 * 1024)).toFixed(1);
    const lastUpdated = stats.lastUpdatedAt
      ? new Date(stats.lastUpdatedAt).toISOString()
      : '无记录';
    const generators = Object.entries(stats.byGenerator)
      .map(([id, count]) => `${id} (${count})`)
      .join(', ') || '无';

    console.log(`Cache manifest: ${manifestPath}`);
    console.log(`Entries:   ${stats.entryCount}`);
    console.log(`Total size: ${sizeMB} MB`);
    console.log(`Last updated: ${lastUpdated}`);
    console.log(`Generators: ${generators}`);
    return;
  }

  if (command.cacheOperation === 'clear') {
    await cacheManager.clear(command.cacheGeneratorId);
    if (command.cacheGeneratorId) {
      console.log(`[cache] 已清除 generator '${command.cacheGeneratorId}' 的缓存条目`);
    } else {
      console.log('[cache] 已清除全部缓存');
    }
    return;
  }
}
