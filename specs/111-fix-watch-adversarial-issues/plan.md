---
id: "111"
title: "修复 Feature 106 watch 对抗性审查问题"
type: fix
status: planned
priority: high
feature_ref: "106"
created: "2026-04-12"
---

# 修复规划：Feature 106 watch 对抗性审查问题

## Summary

本次修复针对 Codex 对 Feature 106（spectra watch）对抗性审查发现的 6 个问题（2 HIGH + 3 MEDIUM + 1 LOW）及测试覆盖空洞。所有修复遵循最小化变更原则，不引入新功能或新抽象。

**问题 2（外部进程并发保护）**已被重新评估：根据 spec 架构决策，lock file 方案已被明确排除。正确处置是接受此限制（进程内串行已足够，外部 batch 并发由 checkpoint 幂等性承接），并在日志中说明。该问题标记为 WONTFIX with documented limitation。

## 变更文件清单

| 文件 | 变更类型 | 修复问题 |
|------|----------|----------|
| `src/cli/commands/watch.ts` | 修改 | 问题 1（HIGH）：添加 loadProjectConfig/mergeConfig 配置加载 |
| `src/watcher/file-watcher.ts` | 修改 | 问题 3（MEDIUM）：添加 error 事件处理；问题 4（MEDIUM）：ready 事件转 Promise；问题 5（MEDIUM）：修复 Windows 路径分隔符 |
| `src/cli/utils/parse-args.ts` | 修改 | 问题 6（LOW）：--debounce 无值时边界检测 |
| `tests/unit/file-watcher.test.ts` | 修改 | 补 error 事件测试、ready 事件测试、路径过滤边界测试 |
| `tests/integration/watch-command.test.ts` | 修改 | 补 runBatch 参数断言、就绪消息时序断言 |
| `tests/unit/cli-commands.test.ts` | 修改 | 补 --debounce 边界用例（无值、值为 flag） |

## Codebase Reality Check

| 文件 | LOC | 公开方法数 | 已知 debt |
|------|-----|-----------|-----------|
| `src/cli/commands/watch.ts` | 183 | 1（runWatchCommand） + 1 内部（executeBatchLoop） | 无 TODO/FIXME；executeBatchLoop 未传配置是核心缺陷 |
| `src/watcher/file-watcher.ts` | 278 | classifyChange, loadIgnorePatterns, FileWatcher（start/stop） | 无 TODO/FIXME；startChokidar 缺 error/ready 事件处理 |
| `src/cli/utils/parse-args.ts` | 492 | parseArgs | 无 TODO/FIXME；watch 分支第 194 行 debounce 值检查不完整 |
| `tests/unit/file-watcher.test.ts` | 215 | — | 测试覆盖完整 classifyChange/debounce，缺 error/ready 路径 |
| `tests/integration/watch-command.test.ts` | 217 | — | 测试 2 无实质性 runBatch 参数断言（已知空洞） |
| `tests/unit/cli-commands.test.ts` | 215 | — | 缺 watch --debounce 边界用例 |

**前置清理规则判定**：所有目标文件 LOC < 500，无相关 TODO/FIXME，无明显代码重复。不需要前置 cleanup task。

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 6 |
| 间接受影响文件 | 0（watch 是终端命令，无上游调用者） |
| 跨包影响 | 无（全部在 src/cli + src/watcher + tests 内） |
| 数据迁移 | 无 |
| API/契约变更 | 无（runBatch 签名不变，仅新增参数透传） |
| **风险等级** | **LOW** |

风险等级判定依据：影响文件数 6 < 10，无跨包影响，无数据迁移，不修改公共 API 契约。单阶段执行即可。

## 各问题修复方案详述

### 问题 1（HIGH）：watch.ts 不加载项目配置

**文件**：`src/cli/commands/watch.ts`

**当前行为**：`executeBatchLoop` 第 154 行调用 `runBatch(projectRoot, { incremental: true })`，未传 outputDir/languages。

**修复方案**：
1. 在 `runWatchCommand` 顶部添加 `loadProjectConfig` + `mergeConfig` 调用，与 `batch.ts` 模式完全一致。
2. watch 命令无 CLI 配置覆盖标志（用户只能设 debounce/verbose），因此 `explicitFlags` 传空集合 `new Set()`。
3. 将 merged config 的 `outputDir`、`languages` 向下传入 `executeBatchLoop`，再透传给 `runBatch`。

**具体改动**：
- `runWatchCommand` 函数签名不变
- 新增 import：`loadProjectConfig`, `mergeConfig`（来自 `../../config/project-config.js`）
- `executeBatchLoop` 签名扩展：增加 `outputDir?: string` 和 `languages?: string[]` 参数
- `runBatch` 调用改为：`runBatch(projectRoot, { incremental: true, outputDir, languages })`

**回归风险**：低。`loadProjectConfig` 在配置文件不存在时返回 `{}`，不影响无配置文件的场景。

---

### 问题 2（HIGH/WONTFIX）：外部进程并发 checkpoint 竞争

**决策**：WONTFIX with documented limitation。

**理由**：
- spec 架构决策已明确排除 lock file 方案（零额外依赖、Windows 兼容性、异常不删除 lock 导致死锁）
- watch 进程内串行（`isRunning` 标志）已足够处理最常见场景
- `batch-orchestrator` 的 checkpoint 机制有内在幂等性，并发写入的最坏结果是一次重复生成，而非数据丢失
- 引入 lock file 属于 YAGNI，且与 spec 明确决策相悖

**缓解措施**：在 `executeBatchLoop` 日志中添加一条说明，提醒用户不要同时运行 `spectra batch` 和 `spectra watch`。

---

### 问题 3（MEDIUM）：watcher 无 error 事件处理器

**文件**：`src/watcher/file-watcher.ts`，`startChokidar()` 方法

**当前行为**：未挂载 `error` 事件，Node.js 默认行为是抛出未捕获异常，导致进程 crash。

**修复方案**：在 `startChokidar()` 的事件挂载区块添加：
```typescript
this.watcher.on('error', (err: unknown) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`[watch] 文件监听器错误: ${errMsg}`);
  if (this.verbose) {
    console.error(err);
  }
});
```

`startFsWatch()` 使用回调模式，无独立 error 事件，但需在回调内捕获 `filename` 为 null 的情况（现有代码已有 `if (!filename) return` 守卫，无需修改）。

**回归风险**：极低。纯增量添加事件监听器。

---

### 问题 4（MEDIUM）："已就绪"消息在 chokidar ready 前打印

**文件**：`src/watcher/file-watcher.ts`，`startChokidar()` 方法；`src/cli/commands/watch.ts`

**当前行为**：`startChokidar()` 挂载事件后立即返回，`watch.ts` 随即打印"已就绪"，但 chokidar 的初始扫描尚未完成。

**修复方案**：
将 `startChokidar()` 改为返回一个 Promise，在 `ready` 事件时 resolve：

```typescript
private async startChokidar(): Promise<void> {
  // ... 创建 watcher
  this.watcher.on('add', ...);
  this.watcher.on('change', ...);
  this.watcher.on('unlink', ...);
  this.watcher.on('error', ...);  // 问题 3 修复

  // 等待 chokidar ready 事件
  await new Promise<void>((resolve) => {
    this.watcher.once('ready', resolve);
  });
}
```

**降级路径兼容**：`startFsWatch()` 不使用 `await`（fs.watch 无 ready 事件），`start()` 方法的降级分支直接调用 `startFsWatch()` 并同步返回，因此降级路径"已就绪"消息在 fs.watch 注册后立即打印，语义正确（fs.watch 是同步注册，无初始扫描延迟）。

**FR-013 兼容性**："2 秒内打印已就绪"仍然满足——chokidar 的初始目录扫描通常在毫秒级完成。

**回归风险**：低。`start()` 原本已是 async，改为 await 内部 Promise 不影响外部接口。

---

### 问题 5（MEDIUM）：降级 ignore matcher 使用 POSIX 路径分隔符

**文件**：`src/watcher/file-watcher.ts`，`startFsWatch()` 方法

**当前行为**（第 233 行）：
```typescript
fullPath.includes(`/${pattern}/`) || fullPath.includes(`/${pattern}`) || fullPath.endsWith(`/${pattern}`)
```
问题：
1. 硬编码 `/`，Windows 上路径分隔符为 `\`，导致 ignore 规则失效
2. `includes('/node_modules')` 会误匹配 `/foo/my_node_modules_backup/` 等路径（无边界检测）

**修复方案**：使用 `path.sep` 替换硬编码 `/`，并改用路径分段（`path.normalize` + `split`）匹配来保证边界安全：

```typescript
import { resolve, extname, normalize, sep } from 'node:path';

// 在 startFsWatch 中：
const normalizedFull = normalize(fullPath);
const parts = normalizedFull.split(sep);
const shouldIgnore = this.ignoredPatterns.some((pattern) => {
  const normalizedPattern = normalize(pattern).replace(/[/\\]$/, '');
  return parts.includes(normalizedPattern);
});
```

注意：`.gitignore` 中的 glob 模式（如 `*.log`、`build/`）在 `startFsWatch` 降级路径下会被简化处理——仅精确匹配路径分段。这是已知的降级行为简化（chokidar 路径才支持完整 glob），无需改变。

**回归风险**：低。`startFsWatch` 仅在 chokidar 初始化失败时启用，影响范围极小。

---

### 问题 6（LOW）：`--debounce` 无值时静默失败

**文件**：`src/cli/utils/parse-args.ts`，watch 分支（第 189-198 行）

**当前行为**：
```typescript
const debounceRaw = debounceIdx !== -1 ? argv[debounceIdx + 1] : undefined;
// ...
if (isNaN(parsed) || parsed <= 0) { return error; }
```
当用户输入 `spectra watch --debounce --verbose` 时，`debounceRaw = '--verbose'`，`parseInt('--verbose', 10)` 返回 `NaN`，会正确报错。但错误信息 "收到: --verbose" 不直观，且行为依赖 `parseInt` 的隐式 NaN 转换。

更危险的边界：`spectra watch --debounce`（末尾无任何值），此时 `argv[debounceIdx + 1]` 为 `undefined`，`parseInt(undefined, 10)` 返回 `NaN`，也会报错，但报错信息为 "收到: undefined"。

**修复方案**：添加 `startsWith('-')` 守卫（与 `parseInitTarget` 中已有模式一致）：

```typescript
if (debounceRaw === undefined || debounceRaw.startsWith('-')) {
  return { ok: false, error: { type: 'invalid_option', message: '--debounce 需要正整数值（秒），未提供值或值为选项标志' } };
}
```

**回归风险**：极低。仅在 `--debounce` 后接 flag 或无值时改变行为（原来依赖 parseInt NaN，现在提前返回，效果等价但信息更清晰）。

---

## 测试修复方案

### tests/unit/file-watcher.test.ts — 新增测试

**新增 describe 块：`FileWatcher error 事件处理`**
- 用例 1：chokidar watcher 触发 `error` 事件时，不抛出未捕获异常，而是调用 `console.error`
  - 实现：mock chokidar，触发 error 事件，spy `console.error`，断言 console.error 被调用且包含错误信息

**新增 describe 块：`FileWatcher ready 事件（start() Promise 行为）`**
- 用例 2：`start()` 返回的 Promise 在 chokidar `ready` 事件触发后才 resolve
  - 实现：mock chokidar，控制 `ready` 事件触发时机，断言 `start()` 的 Promise 在 ready 前未 resolve

**新增用例：`startFsWatch 路径过滤使用路径分段匹配`**
- 用例 3：路径 `/project/my_node_modules_backup/file.ts` 不被 `node_modules` 规则过滤（无 false-positive）
- 用例 4：路径 `/project/node_modules/lodash/index.js` 被正确过滤

### tests/integration/watch-command.test.ts — 修复现有测试

**修复测试 2（runBatch 参数断言）**：
- 当前：测试直接调用 FileWatcher 内部方法，不验证 runBatch 参数
- 修复：改为调用 `runWatchCommand`，触发文件变更后，断言 `runBatch` 被调用时传入了 `outputDir` 和 `languages`（来自配置文件）

**修复测试 1（就绪消息时序）**：
- 当前：测试只断言 `elapsed < 2000ms`，无内容断言
- 修复：断言 `logMessages` 数组包含 `[watch] 已就绪` 字样的消息

### tests/unit/cli-commands.test.ts — 新增测试

**新增用例：`watch --debounce 无值报错`**
- `parseArgs(['watch', '--debounce'])` → `ok: false`，`type: 'invalid_option'`

**新增用例：`watch --debounce 值为 flag 报错`**
- `parseArgs(['watch', '--debounce', '--verbose'])` → `ok: false`，`type: 'invalid_option'`

---

## 回归风险汇总

| 修复项 | 回归风险 | 说明 |
|--------|----------|------|
| loadProjectConfig/mergeConfig 配置加载 | 低 | 无配置文件时返回 {} 不影响行为；新增参数透传不改变现有逻辑 |
| error 事件处理 | 极低 | 纯增量添加监听器，不影响正常路径 |
| ready 事件转 Promise | 低 | start() 已是 async，降级路径不受影响 |
| Windows 路径修复 | 极低 | 仅影响 fs.watch 降级路径，生产环境 macOS/Linux 基本不走此路径 |
| --debounce 守卫 | 极低 | 仅改变边界情况下的报错信息措辞，正常用法不受影响 |

---

## 不修复项说明

**问题 2（并发 checkpoint 竞争）**：标记为 WONTFIX。

根据 spec 架构决策：
1. lock file 方案已被明确排除（spec.md 中的架构约束）
2. watch 进程内串行（`isRunning` 标志）处理了 99% 的场景
3. `spectra watch` 与 `spectra batch` 同时运行是反模式使用，文档中注明即可
4. checkpoint 幂等性已提供足够保护

缓解措施：在启动日志中添加提示："请勿同时运行 spectra watch 和 spectra batch"。
