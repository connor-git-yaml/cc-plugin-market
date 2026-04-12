/**
 * 内容哈希缓存集成测试
 * 端到端验证缓存命中、部分变更、原子性、版本兼容、frontmatter 跳过
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CacheManager } from '../../../src/panoramic/cache/cache-manager.js';
import { ContentHasherImpl } from '../../../src/panoramic/cache/content-hasher.js';
import { ManifestManagerImpl } from '../../../src/panoramic/cache/manifest-manager.js';
import type { DocumentGenerator, ProjectContext } from '../../../src/panoramic/interfaces.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cache-integ-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 创建测试用 ProjectContext */
function createTestContext(projectRoot: string): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'npm',
    workspaceType: 'single',
    detectedLanguages: ['typescript'],
    existingSpecs: [],
  };
}

/** 创建 mock generator（声明依赖） */
function createMockGenerator(id: string, deps: string[]): DocumentGenerator<unknown, unknown> {
  return {
    id,
    name: `Test ${id}`,
    description: `Test generator ${id}`,
    isApplicable: () => true,
    extract: async () => ({}),
    generate: async () => ({}),
    render: () => '',
    getDependencies: () => deps,
  };
}

describe('缓存集成测试', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('场景 1: 全量命中 — 首次 record 后二次 check 全部命中', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    // 创建源文件
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    const file1 = path.join(srcDir, 'a.ts');
    const file2 = path.join(srcDir, 'b.ts');
    fs.writeFileSync(file1, 'export const a = 1;');
    fs.writeFileSync(file2, 'export const b = 2;');

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir);

    const context = createTestContext(tmpDir);
    const gen1 = createMockGenerator('gen-a', [file1]);
    const gen2 = createMockGenerator('gen-b', [file2]);

    // 首次执行
    const cm1 = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm1.initialize(outputDir);
    await cm1.record(gen1, context, ['out/a.md']);
    await cm1.record(gen2, context, ['out/b.md']);
    await cm1.flush();

    // 二次执行（模拟重新启动）
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cm2 = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm2.initialize(outputDir);

    const hit1 = await cm2.check(gen1, context);
    const hit2 = await cm2.check(gen2, context);

    expect(hit1).not.toBe(false);
    expect(hit2).not.toBe(false);
    expect(logSpy).toHaveBeenCalledTimes(2);
    const logCalls = logSpy.mock.calls.map(c => String(c[0]));
    expect(logCalls.some(msg => msg.includes('[cache-hit]') && msg.includes('gen-a'))).toBe(true);
    expect(logCalls.some(msg => msg.includes('[cache-hit]') && msg.includes('gen-b'))).toBe(true);
  });

  it('场景 2: 部分变更 — 修改部分文件后只有对应 generator miss', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    const fileA = path.join(srcDir, 'a.ts');
    const fileB = path.join(srcDir, 'b.ts');
    fs.writeFileSync(fileA, 'export const a = 1;');
    fs.writeFileSync(fileB, 'export const b = 2;');

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir);

    const context = createTestContext(tmpDir);
    const genA = createMockGenerator('gen-a', [fileA]);
    const genB = createMockGenerator('gen-b', [fileB]);

    // 首次执行
    const cm1 = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm1.initialize(outputDir);
    await cm1.record(genA, context, ['out/a.md']);
    await cm1.record(genB, context, ['out/b.md']);
    await cm1.flush();

    // 修改 fileA（file B 不变）
    fs.writeFileSync(fileA, 'export const a = 999;');

    // 二次执行
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cm2 = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm2.initialize(outputDir);

    const hitA = await cm2.check(genA, context);
    const hitB = await cm2.check(genB, context);

    // gen-a miss（fileA 变了），gen-b hit
    expect(hitA).toBe(false);
    expect(hitB).not.toBe(false);
  });

  it('场景 3: manifest 原子性 — .tmp 残留不影响下次 load', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    const metaDir = path.join(tmpDir, 'output', '_meta');
    fs.mkdirSync(metaDir, { recursive: true });

    // 模拟 .tmp 残留（写入中断场景）
    const manifestPath = path.join(metaDir, '_cache-manifest.json');
    const tmpPath = `${manifestPath}.tmp`;
    fs.writeFileSync(tmpPath, '{partial json...');

    // 正常 manifest 不存在，.tmp 残留
    const cm = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm.initialize(path.join(tmpDir, 'output'));

    // 应正常工作（空 manifest）
    expect(cm.stats().entryCount).toBe(0);
  });

  it('场景 4: 版本不兼容 — version 为 "0" 时清空继续不抛错', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    const metaDir = path.join(tmpDir, 'output', '_meta');
    fs.mkdirSync(metaDir, { recursive: true });

    // 手写版本不兼容的 manifest
    const manifestPath = path.join(metaDir, '_cache-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '0',
      updatedAt: Date.now(),
      entries: {
        'old-key': {
          cacheKey: 'old-key',
          generatorId: 'old-gen',
          inputFiles: [],
          outputFiles: [],
          createdAt: Date.now(),
        },
      },
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cm = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm.initialize(path.join(tmpDir, 'output'));

    // 不抛错，清空缓存
    expect(cm.stats().entryCount).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('场景 5: frontmatter-only 变更 — 修改 .md frontmatter 正文不变时仍命中', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    const mdFile = path.join(srcDir, 'doc.md');
    fs.writeFileSync(mdFile, '---\ntitle: v1\nupdated: 2024-01-01\n---\n# Hello\nBody content here');

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir);

    const context = createTestContext(tmpDir);
    const gen = createMockGenerator('doc-gen', [mdFile]);

    // 首次执行
    const cm1 = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm1.initialize(outputDir);
    await cm1.record(gen, context, ['out/doc.md']);
    await cm1.flush();

    // 修改 frontmatter（正文不变）
    fs.writeFileSync(mdFile, '---\ntitle: v2\nupdated: 2026-04-12\nauthor: test\n---\n# Hello\nBody content here');

    // 二次执行
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cm2 = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
    await cm2.initialize(outputDir);

    const result = await cm2.check(gen, context);

    // frontmatter 变了但正文没变，应该仍命中
    // 注意：由于 mtime 变了，会触发 hash 重算，但 hash 应该相同
    expect(result).not.toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[cache-hit]'));
  });
});
