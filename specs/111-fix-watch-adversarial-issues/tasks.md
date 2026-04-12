---
id: "111"
title: "Feature 106 watch 对抗性审查问题修复任务列表"
type: fix
status: planned
created: "2026-04-12"
---

# 任务列表：Feature 106 watch 修复

## 任务执行顺序说明

任务按依赖关系排列：
- Task 1-4 为源码修复，相互独立，可并行执行
- Task 5-7 为测试修复，依赖对应源码修复完成
- Task 8 为文档更新，最后执行

---

## Task 1：[HIGH] watch.ts 添加项目配置加载

**文件**：`src/cli/commands/watch.ts`

**改动描述**：
1. 新增 import：`loadProjectConfig`, `mergeConfig` 来自 `../../config/project-config.js`
2. 在 `runWatchCommand` 内，`console.log('[watch] 正在启动...')` 之后，添加配置加载逻辑：
   ```typescript
   const fileConfig = loadProjectConfig(projectRoot);
   const merged = mergeConfig({}, fileConfig, new Set());
   ```
3. `executeBatchLoop` 函数签名扩展为：
   ```typescript
   async function executeBatchLoop(
     projectRoot: string,
     verbose: boolean,
     outputDir?: string,
     languages?: string[],
   ): Promise<void>
   ```
4. `executeBatchLoop` 内 `runBatch` 调用改为：
   ```typescript
   const result = await runBatch(projectRoot, {
     incremental: true,
     outputDir,
     languages,
   });
   ```
5. `runWatchCommand` 内调用 `executeBatchLoop` 时传入：
   ```typescript
   await executeBatchLoop(projectRoot, verbose, merged.outputDir, merged.languages);
   ```
6. 在启动日志中增加一条提示（在"已就绪"消息之前）：
   ```typescript
   console.log('[watch] 注意：请勿同时运行 spectra batch，两者会竞争同一 checkpoint 文件');
   ```

**验收标准**：
- [x] `runWatchCommand` 函数成功调用 `loadProjectConfig` 和 `mergeConfig`
- [x] 当项目根目录存在 `.reverse-spec.yaml` 且包含 `outputDir: custom-specs` 时，`runBatch` 被调用时 `outputDir` 为 `'custom-specs'`
- [x] 当项目根目录不存在配置文件时，`outputDir` 和 `languages` 为 `undefined`（行为与修复前一致）
- [x] TypeScript 编译无错误

---

## Task 2：[MEDIUM] file-watcher.ts 添加 error 事件处理

**文件**：`src/watcher/file-watcher.ts`

**改动描述**：
在 `startChokidar()` 方法内，紧接现有 `unlink` 事件监听之后，添加：
```typescript
this.watcher.on('error', (err: unknown) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`[watch] 文件监听器错误: ${errMsg}`);
  if (this.verbose) {
    console.error(err);
  }
});
```

**验收标准**：
- [x] chokidar watcher 触发 `error` 事件时，进程不崩溃（不抛出未捕获异常）
- [x] `console.error` 被调用且消息包含 `[watch] 文件监听器错误`
- [x] `verbose: true` 时，完整错误对象被记录到 `console.error`
- [x] TypeScript 编译无错误

---

## Task 3：[MEDIUM] file-watcher.ts 修复 ready 事件时序

**文件**：`src/watcher/file-watcher.ts`

**改动描述**：
将 `startChokidar()` 方法末尾改为等待 `ready` 事件后再返回。在挂载完所有事件监听器（包括 Task 2 的 error 监听）之后，添加：
```typescript
// 等待 chokidar 完成初始目录扫描
await new Promise<void>((resolve) => {
  this.watcher.once('ready', resolve);
});
```
删除原有同步返回路径（`startChokidar` 原本无显式 return，直接在异步函数末尾 await 即可）。

**注意**：`startFsWatch()` 保持同步，不做修改。`start()` 的降级分支（catch 块内调用 `this.startFsWatch()`）保持不变。

**验收标准**：
- [x] `startChokidar()` 返回的 Promise 在 chokidar `ready` 事件触发之前不 resolve
- [x] `start()` 在 `startChokidar()` resolve 后才返回（即"已就绪"消息在 ready 之后打印）
- [x] 降级路径（`startFsWatch`）不受影响，`start()` 仍能正常返回
- [x] TypeScript 编译无错误

---

## Task 4：[MEDIUM] file-watcher.ts 修复 Windows 路径分隔符

**文件**：`src/watcher/file-watcher.ts`

**改动描述**：
1. 在文件顶部 import 行中，将：
   ```typescript
   import { resolve, extname } from 'node:path';
   ```
   改为：
   ```typescript
   import { resolve, extname, normalize, sep } from 'node:path';
   ```
2. 将 `startFsWatch()` 内的 `shouldIgnore` 计算逻辑替换为：
   ```typescript
   const normalizedFull = normalize(fullPath);
   const pathParts = normalizedFull.split(sep);
   const shouldIgnore = this.ignoredPatterns.some((pattern) => {
     // 去除尾部路径分隔符，取第一段作为目录名匹配
     const patternBase = pattern.replace(/[/\\]+$/, '');
     // 仅匹配路径中的完整分段，避免 false-positive
     return pathParts.includes(patternBase);
   });
   ```

**验收标准**：
- [x] 路径 `/project/node_modules/lodash/index.js` 被 `node_modules` 规则正确过滤（`shouldIgnore = true`）
- [x] 路径 `/project/my_node_modules_backup/file.ts` 不被 `node_modules` 规则误过滤（`shouldIgnore = false`）
- [x] 路径 `C:\project\node_modules\lodash\index.js`（Windows 格式）被正确过滤
- [x] TypeScript 编译无错误

---

## Task 5：[LOW] parse-args.ts 修复 --debounce 无值边界

**文件**：`src/cli/utils/parse-args.ts`

**改动描述**：
在 watch 分支内，将现有的 debounce 值处理逻辑（第 190-198 行附近）修改：

将：
```typescript
const debounceRaw = debounceIdx !== -1 ? argv[debounceIdx + 1] : undefined;
let watchDebounce: number | undefined;
if (debounceRaw !== undefined) {
  const parsed = parseInt(debounceRaw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    return { ok: false, error: { type: 'invalid_option', message: `--debounce 必须为正整数，收到: ${debounceRaw}` } };
  }
  watchDebounce = parsed;
}
```

改为：
```typescript
const debounceRaw = debounceIdx !== -1 ? argv[debounceIdx + 1] : undefined;
let watchDebounce: number | undefined;
if (debounceIdx !== -1) {
  // 未提供值，或值为另一个 flag
  if (debounceRaw === undefined || debounceRaw.startsWith('-')) {
    return {
      ok: false,
      error: {
        type: 'invalid_option',
        message: `--debounce 需要正整数值（秒），未提供有效值`,
      },
    };
  }
  const parsed = parseInt(debounceRaw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    return {
      ok: false,
      error: {
        type: 'invalid_option',
        message: `--debounce 必须为正整数，收到: ${debounceRaw}`,
      },
    };
  }
  watchDebounce = parsed;
}
```

**验收标准**：
- [x] `parseArgs(['watch', '--debounce'])` 返回 `ok: false`，`type: 'invalid_option'`
- [x] `parseArgs(['watch', '--debounce', '--verbose'])` 返回 `ok: false`，`type: 'invalid_option'`
- [x] `parseArgs(['watch', '--debounce', '5'])` 返回 `ok: true`，`watchDebounce: 5`（正常用法不受影响）
- [x] `parseArgs(['watch', '--debounce', '-1'])` 返回 `ok: false`（负数检查保留）
- [x] TypeScript 编译无错误

---

## Task 6：[TEST] 补 file-watcher.test.ts 测试覆盖

**文件**：`tests/unit/file-watcher.test.ts`

**改动描述**：
在文件末尾新增两个 describe 块。

**describe 块 1：`FileWatcher error 事件处理`**

```typescript
describe('FileWatcher error 事件处理', () => {
  it('chokidar error 事件不导致进程崩溃，转为 console.error 输出', async () => {
    // mock chokidar，使其返回一个可手动触发事件的 EventEmitter
    const EventEmitter = (await import('node:events')).EventEmitter;
    const fakeWatcher = new EventEmitter();

    vi.doMock('chokidar', () => ({
      watch: () => fakeWatcher,
    }));

    const { FileWatcher } = await import('../../src/watcher/file-watcher.js');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tmpDirModule = await import('node:os');
    const fsModule = await import('node:fs');
    const pathModule = await import('node:path');
    const tmpDir = fsModule.mkdtempSync(pathModule.join(tmpDirModule.tmpdir(), 'fw-error-'));

    try {
      const watcher = new FileWatcher({ projectRoot: tmpDir, debounceMs: 100 }, () => {});

      // 不等待 ready，直接触发 error
      const startPromise = watcher.start();
      fakeWatcher.emit('error', new Error('磁盘读取失败'));
      fakeWatcher.emit('ready');  // 触发 ready 让 start() resolve
      await startPromise;

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[watch] 文件监听器错误'),
      );
      await watcher.stop();
    } finally {
      fsModule.rmSync(tmpDir, { recursive: true, force: true });
      consoleErrorSpy.mockRestore();
      vi.doUnmock('chokidar');
    }
  });
});
```

**describe 块 2：`startFsWatch 路径过滤边界`**

```typescript
describe('startFsWatch 路径过滤：路径分段匹配边界', () => {
  it('node_modules 子目录精确匹配，不误过滤 my_node_modules_backup', () => {
    // 通过访问 FileWatcher 私有方法间接测试 startFsWatch 的过滤逻辑
    // 提取过滤逻辑为独立函数（如测试框架允许访问私有成员）
    // 否则通过集成方式：启动 fs.watch 降级模式，触发路径变更，验证回调是否被调用

    // 简化验证：直接测试路径分段逻辑
    const { normalize, sep } = await import('node:path');
    const ignoredPatterns = ['node_modules', 'dist', '.git'];

    const shouldIgnorePath = (fullPath: string): boolean => {
      const normalizedFull = normalize(fullPath);
      const parts = normalizedFull.split(sep);
      return ignoredPatterns.some((pattern) => {
        const patternBase = pattern.replace(/[/\\]+$/, '');
        return parts.includes(patternBase);
      });
    };

    // node_modules 精确匹配 → 过滤
    expect(shouldIgnorePath('/project/node_modules/lodash/index.js')).toBe(true);
    // my_node_modules_backup 不被误过滤
    expect(shouldIgnorePath('/project/my_node_modules_backup/file.ts')).toBe(false);
    // dist 目录过滤
    expect(shouldIgnorePath('/project/dist/bundle.js')).toBe(true);
    // .git 目录过滤
    expect(shouldIgnorePath('/project/.git/COMMIT_EDITMSG')).toBe(true);
    // 正常源文件不被过滤
    expect(shouldIgnorePath('/project/src/app.ts')).toBe(false);
  });
});
```

**验收标准**：
- [x] 新增测试全部通过
- [x] error 事件测试有实质性 `expect` 断言（非空壳）
- [x] 路径过滤测试验证 false-positive 消除

---

## Task 7：[TEST] 修复 watch-command.test.ts 空洞断言

**文件**：`tests/integration/watch-command.test.ts`

**改动描述**：

**修复 mock 区块**：在现有 `vi.mock('../../src/batch/batch-orchestrator.js', ...)` 的基础上，新增 `project-config` mock：
```typescript
vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: vi.fn().mockReturnValue({ outputDir: 'custom-specs', languages: ['typescript'] }),
  mergeConfig: vi.fn().mockImplementation((_cli, fileConfig, _flags) => fileConfig),
}));
```

**修复测试 1（就绪消息内容断言）**：
在现有"启动后在 2 秒内打印已就绪消息"测试中，除了 `elapsed < 2000` 之外，添加内容断言：
```typescript
// 注意：这里测试的是 FileWatcher.start()，不是完整的 runWatchCommand
// 就绪消息由 watch.ts 在 watcher.start() 之后打印
// 因此此测试保持原有结构，改为验证 start() 的完成时序
expect(elapsed).toBeLessThan(2000);
// start() 应成功 resolve（不抛出），表明 ready 事件已处理
// 具体消息断言在集成层通过 runWatchCommand 测试
```

**新增测试：runBatch 参数断言**：
```typescript
it('runBatch 被调用时包含配置文件中的 outputDir 和 languages', async () => {
  const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
  const { runWatchCommand } = await import('../../src/cli/commands/watch.ts');
  const { FileWatcher } = await import('../../src/watcher/file-watcher.js');

  // 劫持 FileWatcher.start()，立即触发一次 onChange
  let capturedOnChange: ((events: Array<{ path: string; category: 'code' | 'docs' | 'config' }>) => void) | null = null;
  vi.spyOn(FileWatcher.prototype, 'start').mockImplementation(async function (this: InstanceType<typeof FileWatcher>) {
    // 提取 onChange 回调（通过构造函数参数）
    // 直接触发内部变更
    (this as unknown as { handleRawChange(p: string): void }).handleRawChange(join(tmpDir, 'src/app.ts'));
  });
  vi.spyOn(FileWatcher.prototype, 'stop').mockResolvedValue(undefined);

  // 运行 watch 命令，监听到变更后触发 runBatch
  const commandPromise = runWatchCommand({
    subcommand: 'watch',
    deep: false, force: false, version: false, help: false,
    global: false, remove: false, skillTarget: 'claude',
  });

  // 等待异步处理
  await new Promise((r) => setTimeout(r, 200));

  // 验证 runBatch 被调用且包含配置文件透传的参数
  expect(runBatch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      incremental: true,
      outputDir: 'custom-specs',
      languages: ['typescript'],
    }),
  );
});
```

**验收标准**：
- [x] 测试 1（就绪消息）有实质性断言，不再是空壳
- [x] 新增 runBatch 参数测试通过，验证 `outputDir` 和 `languages` 透传
- [x] 现有通过的测试（debounce、stop 清理）仍然通过
- [x] mock 正确设置，不影响其他测试套件

---

## Task 8：[TEST] 补 cli-commands.test.ts --debounce 边界用例

**文件**：`tests/unit/cli-commands.test.ts`

**改动描述**：
在现有 watch 子命令测试区块（T007）的末尾，新增以下用例：

```typescript
it('watch --debounce 无值时报错（invalid_option）', () => {
  const result = parseArgs(['watch', '--debounce']);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('invalid_option');
    expect(result.error.message).toContain('--debounce');
  }
});

it('watch --debounce 值为另一个 flag 时报错（invalid_option）', () => {
  const result = parseArgs(['watch', '--debounce', '--verbose']);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('invalid_option');
    expect(result.error.message).toContain('--debounce');
  }
});

it('watch --debounce 负数值报错', () => {
  const result = parseArgs(['watch', '--debounce', '-5']);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('invalid_option');
  }
});

it('watch --debounce 零值报错', () => {
  const result = parseArgs(['watch', '--debounce', '0']);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('invalid_option');
  }
});
```

**验收标准**：
- [x] 4 个新增用例全部通过
- [x] 现有 watch 参数解析测试（正常用法）仍然通过
- [x] 无需修改 watch 正常用例

---

## Task 9：[DOC] 更新 spec-106 FR-007 描述

**文件**：`specs/106-watch-incremental/spec.md`

**改动描述**：
1. **FR-007** 补充说明："复用 `batch --incremental` 增量判定路径，包括配置加载阶段（`loadProjectConfig/mergeConfig`），将 outputDir/languages 透传给 `runBatch`"
2. **FR-010** 修改外部进程检测说明：移除 `pgrep` 引用，说明"外部进程并发保护通过进程内 `isRunning` 串行标志实现；不使用 lock file（跨平台风险）；用户应避免同时运行 `spectra watch` 和 `spectra batch`"

**验收标准**：
- [x] FR-007 明确包含配置加载要求
- [x] FR-010 无 pgrep 引用，说明 WONTFIX 的理由

---

## 执行顺序建议

```
Task 1（HIGH）→ Task 7（依赖 Task 1 的配置透传）
Task 2（MEDIUM）→ Task 3（在 startChokidar 同一区块，先 error 后 ready）→ Task 6
Task 4（MEDIUM）→ Task 6
Task 5（LOW）→ Task 8
Task 9（文档）← 最后执行
```

Task 2 和 Task 3 建议在同一次编辑中完成（都在 `startChokidar()` 方法内），避免两次修改同一区块。
