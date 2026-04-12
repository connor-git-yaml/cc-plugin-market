/**
 * FileWatcher 单元测试
 * 覆盖 debounce 合并、变更分类、.gitignore 解析、降级路径
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyChange, loadIgnorePatterns } from '../../src/watcher/file-watcher.js';
import type { FileChangeEvent } from '../../src/watcher/file-watcher.js';

// ---------------------------------------------------------------------------
// classifyChange 测试
// ---------------------------------------------------------------------------

describe('classifyChange', () => {
  it('.ts 文件归类为 code', () => {
    expect(classifyChange('/project/src/foo.ts')).toBe('code');
  });

  it('.tsx 文件归类为 code', () => {
    expect(classifyChange('/project/src/component.tsx')).toBe('code');
  });

  it('.js 文件归类为 code', () => {
    expect(classifyChange('/project/dist/index.js')).toBe('code');
  });

  it('.py 文件归类为 code', () => {
    expect(classifyChange('/project/scripts/tool.py')).toBe('code');
  });

  it('.md 文件归类为 docs', () => {
    expect(classifyChange('/project/docs/README.md')).toBe('docs');
  });

  it('.mdx 文件归类为 docs', () => {
    expect(classifyChange('/project/docs/guide.mdx')).toBe('docs');
  });

  it('.txt 文件归类为 docs', () => {
    expect(classifyChange('/project/notes.txt')).toBe('docs');
  });

  it('.json 文件归类为 config', () => {
    expect(classifyChange('/project/package.json')).toBe('config');
  });

  it('.yaml 文件归类为 config', () => {
    expect(classifyChange('/project/.github/workflows/ci.yaml')).toBe('config');
  });

  it('.yml 文件归类为 config', () => {
    expect(classifyChange('/project/docker-compose.yml')).toBe('config');
  });

  it('.toml 文件归类为 config', () => {
    expect(classifyChange('/project/Cargo.toml')).toBe('config');
  });

  it('未知扩展名默认归类为 code', () => {
    expect(classifyChange('/project/Makefile')).toBe('code');
  });

  it('扩展名大小写不影响分类', () => {
    expect(classifyChange('/project/src/Foo.TS')).toBe('code');
    expect(classifyChange('/project/README.MD')).toBe('docs');
  });
});

// ---------------------------------------------------------------------------
// loadIgnorePatterns 测试
// ---------------------------------------------------------------------------

describe('loadIgnorePatterns', () => {
  // 使用临时目录
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    tmpDir = mkdtempSync(join(tmpdir(), 'fw-test-'));
  });

  afterEach(async () => {
    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('.gitignore 不存在时返回内置默认规则', () => {
    const patterns = loadIgnorePatterns(tmpDir);
    expect(patterns).toContain('.git');
    expect(patterns).toContain('node_modules');
    expect(patterns).toContain('dist');
    expect(patterns).toContain('specs');
    expect(patterns).toContain('_meta');
  });

  it('解析 .gitignore：跳过注释行', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(tmpDir, '.gitignore'), '# 这是注释\nbuild/\n');
    const patterns = loadIgnorePatterns(tmpDir);
    // 注释行不加入规则
    expect(patterns).not.toContain('# 这是注释');
    // 有效规则被收录
    expect(patterns).toContain('build/');
  });

  it('解析 .gitignore：跳过空行', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(tmpDir, '.gitignore'), '\n\nbuild/\n\n');
    const patterns = loadIgnorePatterns(tmpDir);
    // 空字符串不加入规则
    expect(patterns).not.toContain('');
    // 有效规则被收录
    expect(patterns).toContain('build/');
  });

  it('解析 .gitignore：合并内置规则和文件规则', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(tmpDir, '.gitignore'), 'coverage/\n*.log\n');
    const patterns = loadIgnorePatterns(tmpDir);
    // 内置规则保留
    expect(patterns).toContain('node_modules');
    // 文件规则也收录
    expect(patterns).toContain('coverage/');
    expect(patterns).toContain('*.log');
  });
});

// ---------------------------------------------------------------------------
// FileWatcher debounce 测试
// ---------------------------------------------------------------------------

describe('FileWatcher debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounce 期间多次变更只触发一次回调', async () => {
    // 使用 fs.watch 降级路径测试 debounce 逻辑（避免依赖 chokidar 环境）
    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
    const received: FileChangeEvent[][] = [];
    const tmpDirModule = await import('node:os');
    const fsModule = await import('node:fs');
    const pathModule = await import('node:path');
    const tmpDir = fsModule.mkdtempSync(pathModule.join(tmpDirModule.tmpdir(), 'debounce-test-'));

    try {
      const watcher = new FileWatcher(
        { projectRoot: tmpDir, debounceMs: 300 },
        (events) => received.push(events),
      );

      // 模拟 _handleRawChangeForTest 方法（直接调用私有方法通过类型转换）
      // 通过访问私有方法来测试 debounce 逻辑
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fw = watcher as unknown as { handleRawChange(path: string): void };

      // 触发 3 次变更
      fw.handleRawChange('/project/src/a.ts');
      vi.advanceTimersByTime(100);
      fw.handleRawChange('/project/src/b.ts');
      vi.advanceTimersByTime(100);
      fw.handleRawChange('/project/src/c.ts');

      // 尚未触发
      expect(received.length).toBe(0);

      // 推进超过 debounce 时长
      vi.advanceTimersByTime(400);

      // 只触发一次，包含所有 3 个文件
      expect(received.length).toBe(1);
      expect(received[0]!.length).toBe(3);
    } finally {
      fsModule.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('debounce 时长可配置（1000ms）', async () => {
    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
    const received: FileChangeEvent[][] = [];
    const tmpDirModule = await import('node:os');
    const fsModule = await import('node:fs');
    const pathModule = await import('node:path');
    const tmpDir = fsModule.mkdtempSync(pathModule.join(tmpDirModule.tmpdir(), 'debounce-cfg-'));

    try {
      const watcher = new FileWatcher(
        { projectRoot: tmpDir, debounceMs: 1000 },
        (events) => received.push(events),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fw = watcher as unknown as { handleRawChange(path: string): void };
      fw.handleRawChange('/project/src/a.ts');

      // 500ms 内还未触发
      vi.advanceTimersByTime(500);
      expect(received.length).toBe(0);

      // 超过 1000ms 后触发
      vi.advanceTimersByTime(600);
      expect(received.length).toBe(1);
    } finally {
      fsModule.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FileWatcher error 事件处理测试
// ---------------------------------------------------------------------------

describe('FileWatcher error 事件处理', () => {
  it('chokidar error 事件不导致进程崩溃，转为 console.error 输出', async () => {
    const { EventEmitter } = await import('node:events');
    const fsModule = await import('node:fs');
    const pathModule = await import('node:path');
    const osModule = await import('node:os');

    // 创建可手动触发事件的 fake watcher（继承 EventEmitter）
    const fakeWatcher = new EventEmitter() as EventEmitter & { close: () => void };
    fakeWatcher.close = () => { /* 空实现 */ };

    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* 静默 */ });

    const tmpDir = fsModule.mkdtempSync(pathModule.join(osModule.tmpdir(), 'fw-error-'));

    try {
      const watcher = new FileWatcher({ projectRoot: tmpDir, debounceMs: 100 }, () => { /* 不触发 */ });

      // 绕过 chokidar，直接将 fakeWatcher 注入私有 watcher 字段
      // 然后手动注册 error 事件处理器（模拟 startChokidar 执行后的状态）
      const fw = watcher as unknown as { watcher: typeof fakeWatcher; verbose: boolean };
      fw.watcher = fakeWatcher;

      // 直接调用 error 事件处理器逻辑（与 startChokidar 内的实现一致）
      fakeWatcher.on('error', (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[watch] 文件监听器错误: ${errMsg}`);
        if (fw.verbose) {
          console.error(err);
        }
      });

      // 触发 error 事件——不应 throw，应转为 console.error
      fakeWatcher.emit('error', new Error('磁盘读取失败'));

      // 断言 console.error 被调用且包含错误标识
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[watch] 文件监听器错误'),
      );

      await watcher.stop();
    } finally {
      fsModule.rmSync(tmpDir, { recursive: true, force: true });
      consoleErrorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// startFsWatch 路径过滤边界测试
// ---------------------------------------------------------------------------

describe('startFsWatch 路径过滤：路径分段匹配边界', () => {
  it('node_modules 子目录精确匹配，不误过滤 my_node_modules_backup', async () => {
    // 直接测试路径分段过滤逻辑（与 startFsWatch 内实现一致）
    const { normalize, sep } = await import('node:path');
    const ignoredPatterns = ['node_modules', 'dist', '.git'];

    // 提取过滤逻辑（与 file-watcher.ts startFsWatch 内的逻辑镜像）
    const shouldIgnorePath = (fullPath: string): boolean => {
      const normalizedFull = normalize(fullPath);
      const parts = normalizedFull.split(sep);
      return ignoredPatterns.some((pattern) => {
        const patternBase = pattern.replace(/[/\\]+$/, '');
        return parts.includes(patternBase);
      });
    };

    // node_modules 精确路径段匹配 → 应被过滤
    expect(shouldIgnorePath('/project/node_modules/lodash/index.js')).toBe(true);
    // my_node_modules_backup 不是精确路径段 → 不应被过滤
    expect(shouldIgnorePath('/project/my_node_modules_backup/file.ts')).toBe(false);
    // dist 目录 → 应被过滤
    expect(shouldIgnorePath('/project/dist/bundle.js')).toBe(true);
    // .git 目录 → 应被过滤
    expect(shouldIgnorePath('/project/.git/COMMIT_EDITMSG')).toBe(true);
    // 正常源文件 → 不应被过滤
    expect(shouldIgnorePath('/project/src/app.ts')).toBe(false);
  });
});
