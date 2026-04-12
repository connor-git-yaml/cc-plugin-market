/**
 * ManifestManager 单元测试
 * 覆盖加载、查询、写入、删除、统计、性能基准
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ManifestManagerImpl } from '../../../src/panoramic/cache/manifest-manager.js';
import type { CacheManifest, ManifestEntry } from '../../../src/panoramic/cache/schemas.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-mgr-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 创建测试 entry */
function createTestEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    cacheKey: 'test-key-' + Math.random().toString(36).slice(2),
    generatorId: 'test-generator',
    inputFiles: [
      { path: '/test/file.ts', hash: 'abc123', mtime: Date.now(), size: 1024 },
    ],
    outputFiles: ['/output/test.md'],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('ManifestManagerImpl', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  describe('load', () => {
    it('文件不存在时静默保持空 manifest', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mgr = new ManifestManagerImpl();

      await mgr.load(path.join(tmpDir, 'nonexistent.json'));

      expect(mgr.stats().entryCount).toBe(0);
    });

    it('加载有效 manifest 后 get 返回正确 entry', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const manifestPath = path.join(tmpDir, 'manifest.json');
      const entry = createTestEntry({ cacheKey: 'my-key' });
      const manifest: CacheManifest = {
        version: '1',
        updatedAt: Date.now(),
        entries: { 'my-key': entry },
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const mgr = new ManifestManagerImpl();
      await mgr.load(manifestPath);

      const result = mgr.get('my-key');
      expect(result).toBeDefined();
      expect(result?.generatorId).toBe('test-generator');
    });

    it('version 不兼容打印 warn 并清空不抛错', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const manifestPath = path.join(tmpDir, 'manifest.json');
      const badManifest = {
        version: '0',
        updatedAt: Date.now(),
        entries: {},
      };
      fs.writeFileSync(manifestPath, JSON.stringify(badManifest));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mgr = new ManifestManagerImpl();

      await expect(mgr.load(manifestPath)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      expect(mgr.stats().entryCount).toBe(0);
    });

    it('JSON 损坏打印 warn 并清空不抛错', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const manifestPath = path.join(tmpDir, 'manifest.json');
      fs.writeFileSync(manifestPath, '{invalid json!!!');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mgr = new ManifestManagerImpl();

      await expect(mgr.load(manifestPath)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      expect(mgr.stats().entryCount).toBe(0);
    });
  });

  describe('set + flush', () => {
    it('set + flush 后文件内容正确', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const manifestPath = path.join(tmpDir, 'manifest.json');

      const mgr = new ManifestManagerImpl();
      await mgr.load(manifestPath);

      const entry = createTestEntry({ cacheKey: 'write-key' });
      mgr.set(entry);
      await mgr.flush(manifestPath);

      // 重新读取验证
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(content) as CacheManifest;
      expect(parsed.version).toBe('1');
      expect(parsed.entries['write-key']).toBeDefined();
      expect(parsed.entries['write-key']?.generatorId).toBe('test-generator');
    });
  });

  describe('delete', () => {
    it('delete(generatorId) 只删指定条目', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mgr = new ManifestManagerImpl();
      await mgr.load(path.join(tmpDir, 'manifest.json'));

      mgr.set(createTestEntry({ cacheKey: 'a', generatorId: 'gen-a' }));
      mgr.set(createTestEntry({ cacheKey: 'b', generatorId: 'gen-b' }));
      mgr.set(createTestEntry({ cacheKey: 'c', generatorId: 'gen-a' }));

      mgr.delete('gen-a');

      expect(mgr.get('a')).toBeUndefined();
      expect(mgr.get('c')).toBeUndefined();
      expect(mgr.get('b')).toBeDefined();
      expect(mgr.stats().entryCount).toBe(1);
    });

    it('delete() 清空全部', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mgr = new ManifestManagerImpl();
      await mgr.load(path.join(tmpDir, 'manifest.json'));

      mgr.set(createTestEntry({ cacheKey: 'x' }));
      mgr.set(createTestEntry({ cacheKey: 'y' }));

      mgr.delete();

      expect(mgr.stats().entryCount).toBe(0);
    });
  });

  describe('stats', () => {
    it('totalSizeBytes 为 inputFiles.size 累加值', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mgr = new ManifestManagerImpl();
      await mgr.load(path.join(tmpDir, 'manifest.json'));

      mgr.set(createTestEntry({
        cacheKey: 'k1',
        inputFiles: [
          { path: '/a.ts', hash: 'h1', mtime: 1, size: 100 },
          { path: '/b.ts', hash: 'h2', mtime: 2, size: 200 },
        ],
      }));
      mgr.set(createTestEntry({
        cacheKey: 'k2',
        inputFiles: [
          { path: '/c.ts', hash: 'h3', mtime: 3, size: 300 },
        ],
      }));

      const stats = mgr.stats();
      expect(stats.totalSizeBytes).toBe(600);
    });

    it('byGenerator 分组正确', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mgr = new ManifestManagerImpl();
      await mgr.load(path.join(tmpDir, 'manifest.json'));

      mgr.set(createTestEntry({ cacheKey: 'a', generatorId: 'workspace-index' }));
      mgr.set(createTestEntry({ cacheKey: 'b', generatorId: 'workspace-index' }));
      mgr.set(createTestEntry({ cacheKey: 'c', generatorId: 'cross-package' }));

      const stats = mgr.stats();
      expect(stats.byGenerator['workspace-index']).toBe(2);
      expect(stats.byGenerator['cross-package']).toBe(1);
    });
  });

  describe('性能基准', () => {
    it('1000 条 entry 的 load + flush < 100ms', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const manifestPath = path.join(tmpDir, 'perf-manifest.json');

      // 构建 1000 条 entry 的 manifest
      const entries: Record<string, ManifestEntry> = {};
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}`;
        entries[key] = createTestEntry({
          cacheKey: key,
          generatorId: `gen-${i % 10}`,
        });
      }
      const manifest: CacheManifest = {
        version: '1',
        updatedAt: Date.now(),
        entries,
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const mgr = new ManifestManagerImpl();

      const start = performance.now();
      await mgr.load(manifestPath);
      await mgr.flush(manifestPath);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(mgr.stats().entryCount).toBe(1000);
    });
  });
});
