/**
 * cache 命令 handler 单元测试
 * 覆盖 stats 输出、clear 操作、help 输出
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCacheCommand } from '../../src/cli/commands/cache.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';
import { writeAtomicJson } from '../../src/utils/atomic-write.js';
import type { CacheManifest } from '../../src/panoramic/cache/schemas.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cache-cmd-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 创建基础 CLICommand */
function createCommand(overrides: Partial<CLICommand> = {}): CLICommand {
  return {
    subcommand: 'cache',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    ...overrides,
  };
}

describe('runCacheCommand', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('help: true 时输出 CACHE_HELP', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = createCommand({ help: true });

    await runCacheCommand(command);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('spectra cache'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stats'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('clear'));
  });

  it('stats 输出包含预期字段', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });

    // 写入测试 manifest
    const manifest: CacheManifest = {
      version: '1',
      updatedAt: 1712900000000,
      entries: {
        'key-1': {
          cacheKey: 'key-1',
          generatorId: 'workspace-index',
          inputFiles: [
            { path: '/test.ts', hash: 'h1', mtime: 1, size: 2048 },
          ],
          outputFiles: ['/out.md'],
          createdAt: Date.now(),
        },
        'key-2': {
          cacheKey: 'key-2',
          generatorId: 'cross-package',
          inputFiles: [
            { path: '/test2.ts', hash: 'h2', mtime: 2, size: 1024 },
          ],
          outputFiles: ['/out2.md'],
          createdAt: Date.now(),
        },
      },
    };
    writeAtomicJson(path.join(metaDir, '_cache-manifest.json'), manifest);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = createCommand({
      cacheOperation: 'stats',
      outputDir: tmpDir,
    });

    await runCacheCommand(command);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Cache manifest:');
    expect(output).toContain('Entries:   2');
    expect(output).toContain('Total size:');
    expect(output).toContain('Last updated:');
    expect(output).toContain('workspace-index');
    expect(output).toContain('cross-package');
  });

  it('clear 无参调用后删除 manifest 文件', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });

    const manifestPath = path.join(metaDir, '_cache-manifest.json');
    const manifest: CacheManifest = {
      version: '1',
      updatedAt: Date.now(),
      entries: {
        'key-1': {
          cacheKey: 'key-1',
          generatorId: 'test-gen',
          inputFiles: [],
          outputFiles: [],
          createdAt: Date.now(),
        },
      },
    };
    writeAtomicJson(manifestPath, manifest);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = createCommand({
      cacheOperation: 'clear',
      outputDir: tmpDir,
    });

    await runCacheCommand(command);

    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已清除全部缓存'));
  });

  it('clear --generator 后指定 generator 条目消失', async () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });

    const manifestPath = path.join(metaDir, '_cache-manifest.json');
    const manifest: CacheManifest = {
      version: '1',
      updatedAt: Date.now(),
      entries: {
        'key-1': {
          cacheKey: 'key-1',
          generatorId: 'workspace-index',
          inputFiles: [],
          outputFiles: [],
          createdAt: Date.now(),
        },
        'key-2': {
          cacheKey: 'key-2',
          generatorId: 'cross-package',
          inputFiles: [],
          outputFiles: [],
          createdAt: Date.now(),
        },
      },
    };
    writeAtomicJson(manifestPath, manifest);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = createCommand({
      cacheOperation: 'clear',
      outputDir: tmpDir,
      cacheGeneratorId: 'workspace-index',
    });

    await runCacheCommand(command);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("workspace-index"));

    // manifest 文件应仍存在，仅删除了指定 generator 的条目
    expect(fs.existsSync(manifestPath)).toBe(true);
    const updatedContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(updatedContent.entries['key-1']).toBeUndefined();
    expect(updatedContent.entries['key-2']).toBeDefined();
  });
});
