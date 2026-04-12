# 问题修复报告

## 问题描述
Codex 对 Feature 106（spectra watch）的对抗性审查发现 6 个问题（2 HIGH + 3 MEDIUM + 1 LOW）及测试覆盖空洞。所有问题均需在本 fix 中一并修复。

---

## 5-Why 根因追溯

### 问题 1 (HIGH): watch.ts 不加载项目配置

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | watch 触发的 `runBatch` 没有 outputDir/languages 等选项 | `watch.ts:154` 直接调用 `runBatch(projectRoot, { incremental: true })`，未传配置 |
| Why 2 | 为什么没有传配置？ | 实现时只关注了"复用 `runBatch` 增量路径"，忽略了 `batch.ts` 的 `loadProjectConfig/mergeConfig` 阶段 |
| Why 3 | 为什么没有被 spec 捕获？ | spec.md FR-007 只说"复用 `batch --incremental` 增量判定路径"，未明确说明需要同步配置加载行为 |
| Why 4 | 为什么 spec 没写清楚？ | FR 的粒度集中在"增量逻辑"，而配置加载属于框架约定，没有显式列为需求 |
| Why 5 | 为什么未被基础测试发现？ | 单元测试 mock 了 `runBatch`，不验证其参数；集成测试对 `runBatch` 调用参数无断言 |

**Root Cause**: 实现者把"复用增量路径"理解为"只传 `{ incremental: true }`"，而 `batch.ts` 的配置加载流程是隐式契约，未在 spec 中明确要求  
**Root Cause Chain**: runBatch 缺少 outputDir/languages → watch.ts 直接调用未传配置 → 实现未参照 batch.ts 完整模式 → spec FR-007 未明确配置加载要求 → 配置加载属隐式框架约定

---

### 问题 2 (HIGH): 并发批次竞争共享 checkpoint

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 两个 `spectra batch` 进程同时写 `specs/.reverse-spec-checkpoint.json` 会互相覆盖 | `checkpoint.ts:11` DEFAULT_CHECKPOINT_PATH 固定为 `specs/.reverse-spec-checkpoint.json`，无实例隔离 |
| Why 2 | 为什么没有锁？ | 架构简化时移除了 lock file 机制，认为"watch 内部串行执行即可"，但忽略了用户手动运行 `batch` 的场景 |
| Why 3 | 为什么移除 lock file？ | zero-based 简化决策：watch 进程内串行已经足够，FR-010 只要求"检测到外部 batch 则跳过" |
| Why 4 | 为什么 FR-010 的 pgrep 实现被移除？ | pgrep 跨平台问题（Windows 无 pgrep），被从代码中删除，但没有替代方案补上 |
| Why 5 | 为什么没有其他防护？ | checkpoint 文件路径基于 outputDir 推导，默认总是同一路径，无法天然隔离 |

**Root Cause**: pgrep 实现因跨平台问题被移除后，没有等效替代方案填补外部进程检测职责  
**Root Cause Chain**: checkpoint 并发写冲突 → 无外部进程检测 → pgrep 被删除无替代 → 跨平台约束 → FR-010 检测机制实现缺口

---

### 问题 3 (MEDIUM): watcher 无 error 事件处理器

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | chokidar/fs.watch 发出 error 事件时，Node.js 默认行为是抛出未捕获异常 | `startChokidar()` 挂载了 add/change/unlink，但未挂载 error |
| Why 2 | 为什么没有挂载？ | 实现时只参考了 chokidar 文档的变更事件示例，遗漏了 error 事件 |
| Why 3 | 为什么降级路径也没有？ | `startFsWatch()` 使用回调模式，回调中有 null 检查，但 watcher 本身的 error 事件未处理 |
| Why 4 | 为什么测试未捕获？ | 单元测试 mock 了 chokidar，从未触发 error 事件 |

**Root Cause**: error 事件是 Node.js EventEmitter 的特殊约定，未处理时会 crash；实现时只关注了正常路径的事件

---

### 问题 4 (MEDIUM): "已就绪"消息在 chokidar ready 前打印

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `watch.ts:136` 在 `watcher.start()` 返回后立即打印"已就绪" | `startChokidar()` 在挂载事件后直接返回，不等待 `ready` 事件 |
| Why 2 | 为什么不等 ready？ | chokidar `ready` 事件是异步的，`start()` 没有返回 Promise 等待它 |
| Why 3 | 为什么设计成立即返回？ | FR-013 要求"2 秒内打印已就绪"被实现为"启动后立即打印"，忽略了 chokidar 初始化扫描时间 |
| Why 4 | 为什么未被发现？ | 集成测试 `watch-command.test.ts:91` 声称测试"2 秒内打印已就绪"，但该测试块内无实际断言 |

**Root Cause**: `startChokidar()` 未将 `ready` 事件转为 Promise 返回，导致 `start()` 过早结束

---

### 问题 5 (MEDIUM): 降级 ignore matcher 使用 POSIX 路径分隔符

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `startFsWatch()` 中 `fullPath.includes('/pattern/')` 在 Windows 上失效 | Windows 路径分隔符为 `\`，但代码硬编码 `/` |
| Why 2 | 为什么硬编码？ | 开发环境为 macOS，未考虑 Windows 兼容性 |
| Why 3 | 为什么还有 false-positive？ | `fullPath.includes('/node_modules')` 会匹配 `/foo/my_node_modules_backup/` 等路径 |
| Why 4 | 为什么 chokidar 路径没问题？ | chokidar 本身处理了跨平台路径，且 `ignored` 接受 glob 模式；降级路径没有复用这套逻辑 |

**Root Cause**: 降级路径 `startFsWatch()` 自行实现了简陋的路径过滤，未使用 `path.sep` 且缺乏边界检测

---

### 问题 6 (LOW): `--debounce` 无值时静默失败

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `spectra watch --debounce` (无值) 时 `argv[debounceIdx + 1]` 可能是下一个 flag 或 undefined | `parse-args.ts` 中 `debounceRaw` 不检查是否以 `-` 开头 |
| Why 2 | 为什么没检查？ | 初始实现只加了 NaN 和 `<= 0` 检查，忽略了"值为另一个 flag"的边界情况 |

**Root Cause**: 参数解析缺少"值不能是另一个 flag"的守卫（同 `parseInitTarget` 中已有的模式但未复用）

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/cli/commands/watch.ts` | L77, L154 | 未调用 `loadProjectConfig/mergeConfig` | 添加配置加载，透传 outputDir/languages |
| `src/watcher/file-watcher.ts` | `startChokidar()` | 缺少 `error` 事件处理 | 添加 `.on('error', ...)` |
| `src/watcher/file-watcher.ts` | `startChokidar()` | 未等待 `ready` 事件 | 将 ready 转为 Promise，`start()` await |
| `src/watcher/file-watcher.ts` | `startFsWatch()` | POSIX `/` + 无边界检测 | 使用 `path.sep` 和 `path.normalize`；整段路径分割检测 |
| `src/cli/utils/parse-args.ts` | `watch` 分支 | `--debounce` 无值时 `debounceRaw` 可能是另一个 flag | 添加 `raw.startsWith('-')` 检查 |
| `src/cli/commands/watch.ts` | 外部进程检测 | pgrep 被删除无替代 | 使用 `.spectra.lock` 文件检测（与 batch.ts 协作） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/cli/commands/generate.ts` | — | 其他子命令是否也缺少 error handler | [安全] generate 不使用 EventEmitter 监听器 |

### 同步更新清单

- **调用方**: 无（watch 是终端命令，无上游调用者）
- **测试**: 
  - `tests/unit/file-watcher.test.ts` — 补 error 事件测试、ready 事件测试
  - `tests/integration/watch-command.test.ts` — 补 `runBatch` 参数断言、SIGINT 测试、添加实际断言
  - `tests/unit/cli-commands.test.ts` — 补 `--debounce` 边界测试

---

## 修复策略

### 方案 A（推荐）：最小化改动，精准修复各问题

1. **watch.ts**: 复制 `batch.ts` 的 `loadProjectConfig/mergeConfig` 模式，将 outputDir/languages 透传给 `runBatch()`
2. **watch.ts**: 外部进程检测改用 `.spectra-batch.lock` 临时文件（`batch.ts` 写入，watch 读取检测）
3. **file-watcher.ts**: `startChokidar()` 添加 `error` 事件处理，`ready` 转 Promise 让 `start()` await
4. **file-watcher.ts**: `startFsWatch()` 路径过滤改用 `path.sep` + 路径分段匹配
5. **parse-args.ts**: `--debounce` 值检查添加 `startsWith('-')` 守卫

### 方案 B（备选）：cross-process 保护改用 Node.js process pid 文件

写更完整的 lock file 机制，但这属于 YAGNI（spec 明确已排除 lock file），增加不必要复杂度。

---

## Spec 影响

**需要更新**: `specs/106-watch-incremental/spec.md`  
- FR-007 补充"复用 batch 增量路径包括配置加载阶段"
- FR-010 说明外部进程检测机制改为 lock file 方式（移除 pgrep 引用）

**无需修改**: plan.md、tasks.md（任务级别描述不涉及实现细节变化）
