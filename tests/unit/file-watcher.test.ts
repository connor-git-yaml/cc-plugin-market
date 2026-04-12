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
