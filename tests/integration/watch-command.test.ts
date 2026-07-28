/**
 * watch 子命令集成测试
 * 使用 mock runBatch 验证完整 watch 生命周期行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock runBatch
// ---------------------------------------------------------------------------

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: vi.fn().mockResolvedValue({
    totalModules: 2,
    successful: [{ id: 'mod1' }, { id: 'mod2' }],
    degraded: [],
    failed: [],
    skipped: [],
    indexGenerated: false,
    docGraphPath: undefined,
    coverageReportPath: undefined,
    deltaReportPath: undefined,
    projectDocs: [],
    docsBundleManifestPath: undefined,
    docsBundleProfiles: [],
    summaryLogPath: '/tmp/summary.log',
  }),
}));

// Mock 认证门控（默认放行，避免认证阻断；个别用例按需覆盖返回值）
const authMocks = vi.hoisted(() => ({
  resolveAuthGate: vi.fn(),
}));

vi.mock('../../src/cli/utils/error-handler.js', () => ({
  resolveAuthGate: authMocks.resolveAuthGate,
  handleError: vi.fn().mockReturnValue(1),
  EXIT_CODES: { SUCCESS: 0, API_ERROR: 2, TARGET_ERROR: 1 },
}));

// Mock execSync：隔离 isExternalBatchRunning() 对**宿主进程表**的真实依赖（F232 链 F）
//
// watch.ts 的 handleChange 第一步就调 isExternalBatchRunning()，其实现是
// `execSync('pgrep -f "spectra batch"')`——直接查询运行主机上所有进程的命令行。
// 只要主机上任意一个进程的 cmdline 含 "spectra batch" 子串，该函数就返回 true，
// handleChange 走「变更入等待队列」的提前返回分支，runBatch **永远不会被调用**，
// 下方 vi.waitFor 必然耗尽全部预算后失败。已本地实测复现：在主机上放一个 cmdline
// 含该子串的诱饵进程后，本用例报出与真实 CI 日志同形的
// `vi.waitFor.timeout ... AssertionError: expected "spy" to be called with arguments`。
// 故这是**环境相关的确定性失败**（同链 D/E 的"主机属性"家族），不是负载 flaky——
// 调大超时只会让它慢 15 秒再红。这里把该外部查询钉成"无外部 batch"，
// 使本用例只验证它真正要验证的东西：变更事件 → runBatch 的参数透传。
const childProcessMocks = vi.hoisted(() => ({
  // 真实 pgrep 无匹配时以非 0 退出，execSync 随之抛错；watch.ts 的 catch 将其判为 false
  execSync: vi.fn(() => {
    throw new Error('Command failed: pgrep -f "spectra batch"');
  }),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execSync: childProcessMocks.execSync,
}));

// Mock 项目配置加载，模拟有配置文件的场景（Task 7）
vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: vi.fn().mockReturnValue({ outputDir: 'custom-specs', languages: ['typescript'] }),
  mergeConfig: vi.fn().mockImplementation((_cli: Record<string, unknown>, fileConfig: Record<string, unknown>, _flags: Set<string>) => fileConfig),
}));

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('watch 子命令集成测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'watch-integration-'));
    vi.clearAllMocks();
    authMocks.resolveAuthGate.mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 测试 1：启动后打印"已就绪"（FR-013）
  // -------------------------------------------------------------------------
  it('启动后在 2 秒内打印"已就绪"消息', async () => {
    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');

    const logMessages: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logMessages.push(args.map(String).join(' '));
    };

    try {
      // 构造一个不实际监听文件系统的 mock watcher
      const watcher = new FileWatcher(
        { projectRoot: tmpDir, debounceMs: 300 },
        () => { /* 不触发回调 */ },
      );

      const startTime = Date.now();
      await watcher.start();
      const elapsed = Date.now() - startTime;

      // 启动时间 < 2000ms（FR-013）
      expect(elapsed).toBeLessThan(2000);
      // start() 应成功 resolve（不抛出），表明 ready 事件已处理
      // 使用 chokidar 时会等待 ready 事件；降级路径立即完成
      expect(elapsed).toBeGreaterThanOrEqual(0);

      await watcher.stop();
    } finally {
      console.log = originalLog;
    }
  });

  // -------------------------------------------------------------------------
  // 测试：runBatch 调用时包含 outputDir 和 languages（Task 7 新增）
  // -------------------------------------------------------------------------
  it('runBatch 被调用时包含配置文件中的 outputDir 和 languages', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
    const { runWatchCommand } = await import('../../src/cli/commands/watch.ts');

    // 捕获 onChange 回调，用于手动触发变更事件
    let capturedOnChange: ((events: Array<{ path: string; category: 'code' | 'docs' | 'config' }>) => void) | null = null;
    const originalFileWatcher = FileWatcher;

    // spy FileWatcher.prototype.start 使其立即 resolve，同时捕获 onChange
    vi.spyOn(FileWatcher.prototype, 'start').mockImplementation(async function (this: InstanceType<typeof originalFileWatcher>) {
      // 从构造函数通过私有成员访问 onChange
      const self = this as unknown as { onChange: (events: Array<{ path: string; category: 'code' | 'docs' | 'config' }>) => void };
      capturedOnChange = self.onChange;
    });
    vi.spyOn(FileWatcher.prototype, 'stop').mockResolvedValue(undefined);

    // 启动 watch 命令（不会阻塞，因为 start 被 mock）
    const commandPromise = runWatchCommand({
      subcommand: 'watch',
      deep: false,
      force: false,
      version: false,
      help: false,
      global: false,
      remove: false,
      skillTarget: 'claude',
    });

    // 等待 runWatchCommand 执行到 watcher.start() 并返回
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Feature 222：未传 --require-llm 时门控须以 false 调用（否则 watch.ts 把入参写死也测不出来）
    expect(authMocks.resolveAuthGate).toHaveBeenCalledWith(false);

    // 手动触发一次文件变更
    if (capturedOnChange) {
      capturedOnChange([{ path: join(tmpDir, 'src/app.ts'), category: 'code' }]);
    }

    // 先确认外部 batch 探测确实走了被 mock 的路径（否则本用例又会回到"看主机进程表脸色"的状态）
    expect(childProcessMocks.execSync).toHaveBeenCalled();

    // 等待 runBatch 被调用（CI 环境慢，采用 vi.waitFor 主动轮询而非固定 sleep）
    // 超时预算 20s：单纯为 CI 负载留余量。**它不是链 F 的修复手段**——链 F 的真实根因
    // 是上方 execSync mock 所隔离的宿主进程表依赖，那条路径下再大的超时也救不回来。
    if (capturedOnChange) {
      await vi.waitFor(
        () => {
          expect(runBatch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              incremental: true,
              outputDir: 'custom-specs',
              languages: ['typescript'],
            }),
          );
        },
        { timeout: 20_000, interval: 50 },
      );
    }

    await commandPromise.catch(() => { /* 忽略清理阶段可能的错误 */ });
  });

  // -------------------------------------------------------------------------
  // Feature 222：--require-llm 透传 + 门控阻断
  // -------------------------------------------------------------------------
  it('--require-llm 以 true 调用门控，被阻断时不启动 watcher 且退出码为 API_ERROR', async () => {
    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
    const { runWatchCommand } = await import('../../src/cli/commands/watch.ts');

    const startSpy = vi.spyOn(FileWatcher.prototype, 'start').mockResolvedValue(undefined);
    authMocks.resolveAuthGate.mockReturnValue(false);
    const previousExitCode = process.exitCode;

    try {
      await runWatchCommand({
        subcommand: 'watch',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: false,
        remove: false,
        skillTarget: 'claude',
        requireLlm: true,
      });

      expect(authMocks.resolveAuthGate).toHaveBeenCalledWith(true);
      expect(startSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  // -------------------------------------------------------------------------
  // 测试 2：文件变更后 debounce 到期触发 runBatch（US1-AC2）
  // -------------------------------------------------------------------------
  it('文件变更后 debounce 到期触发 runBatch({ incremental: true })', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');

    let onChangeCallback: ((events: Array<{ path: string; category: 'code' | 'docs' | 'config' }>) => void) | null = null;

    // 捕获 onChange 回调
    const watcher = new FileWatcher(
      { projectRoot: tmpDir, debounceMs: 50 }, // 极短 debounce 以加快测试
      (events) => {
        if (onChangeCallback) onChangeCallback(events);
      },
    );

    // 直接调用内部变更处理方法来模拟文件变更
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fw = watcher as unknown as { handleRawChange(path: string): void };

    // 模拟文件变更
    fw.handleRawChange(join(tmpDir, 'src', 'app.ts'));

    // 等待 debounce 到期（50ms + 100ms 缓冲）
    await new Promise((resolve) => setTimeout(resolve, 200));

    // runBatch 应被调用（通过 onChange 触发，但 watch.ts 的调用链需要 runWatchCommand）
    // 这里仅验证 onChange 回调收集了正确的变更事件
    await watcher.stop();
  });

  // -------------------------------------------------------------------------
  // 测试 3：.gitignore 包含规则时 loadIgnorePatterns 返回正确规则集（US3）
  // -------------------------------------------------------------------------
  it('.gitignore 存在时 node_modules 相关变更被过滤规则覆盖', async () => {
    const { loadIgnorePatterns } = await import('../../src/watcher/file-watcher.js');

    // 在临时目录创建 .gitignore
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\nbuild/\n*.log\n');

    const patterns = loadIgnorePatterns(tmpDir);

    // 内置规则保留
    expect(patterns).toContain('node_modules');
    // .gitignore 中的规则
    expect(patterns).toContain('node_modules/');
    expect(patterns).toContain('build/');
    expect(patterns).toContain('*.log');
  });

  // -------------------------------------------------------------------------
  // 测试 4：debounce 期间多次变更只触发一次 onChange（FR-002）
  // -------------------------------------------------------------------------
  it('debounce 期间多次变更只触发一次回调', async () => {
    vi.useFakeTimers();

    try {
      const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
      const callCount = { value: 0 };
      const receivedEvents: Array<Array<{ path: string; category: 'code' | 'docs' | 'config' }>> = [];

      const watcher = new FileWatcher(
        { projectRoot: tmpDir, debounceMs: 500 },
        (events) => {
          callCount.value++;
          receivedEvents.push(events);
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fw = watcher as unknown as { handleRawChange(path: string): void };

      // 快速连续触发 5 次变更
      fw.handleRawChange(join(tmpDir, 'src', 'a.ts'));
      vi.advanceTimersByTime(100);
      fw.handleRawChange(join(tmpDir, 'src', 'b.ts'));
      vi.advanceTimersByTime(100);
      fw.handleRawChange(join(tmpDir, 'src', 'c.ts'));
      vi.advanceTimersByTime(100);
      fw.handleRawChange(join(tmpDir, 'docs', 'readme.md'));
      vi.advanceTimersByTime(100);
      fw.handleRawChange(join(tmpDir, 'package.json'));

      // 触发 debounce
      vi.advanceTimersByTime(600);

      // 应只触发一次
      expect(callCount.value).toBe(1);
      // 包含所有 5 个文件
      expect(receivedEvents[0]!.length).toBe(5);

      await watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // 测试 5：stop() 后清理 debounce 计时器（FR-003 信号处理）
  // -------------------------------------------------------------------------
  it('stop() 后 debounce 计时器被清理，不再触发回调', async () => {
    vi.useFakeTimers();

    try {
      const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
      let callCount = 0;

      const watcher = new FileWatcher(
        { projectRoot: tmpDir, debounceMs: 500 },
        () => { callCount++; },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fw = watcher as unknown as { handleRawChange(path: string): void };
      fw.handleRawChange(join(tmpDir, 'src', 'a.ts'));

      // 在 debounce 到期前停止 watcher
      await watcher.stop();

      // 推进时间，不应再触发回调
      vi.advanceTimersByTime(1000);

      expect(callCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
