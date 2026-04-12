# Tasks: Feature 106 - 文件监听 + 自动增量同步

**Feature Branch**: `106-watch-incremental`
**Generated**: 2026-04-12
**总任务数**: 13
**User Stories 覆盖**: US1（P1）、US2（P1）、US3（P2）、US4（P2）、US5（P3）

---

## Phase 1: Setup（依赖安装）

**目标**: 安装 chokidar，确保依赖就绪后再开始实现

- [x] T001 安装 `chokidar@^4.0.0` 依赖，更新 `package.json`（`dependencies` 字段添加 `"chokidar": "^4.0.0"`）并执行 `npm install`

**Checkpoint**: `node_modules/chokidar` 存在，TypeScript 可 import chokidar 类型

---

## Phase 2: Foundational（核心监听模块）

**目标**: 实现 `FileWatcher` 核心模块——所有 User Story 的共同底座

**注意**: watch CLI handler 依赖此模块，必须先完成

- [x] T002 [US1][US3][US4][US5] 新建 `src/watcher/file-watcher.ts`，实现 `FileWatcher` 类，包含：
  - chokidar v4.x 动态 `import()` 初始化（`ignoreInitial: true`、`awaitWriteFinish`）
  - 降级路径：初始化失败时回退 `fs.watch` 递归轮询（`interval: 5000`），打印降级警告（FR-005）
  - `.gitignore` 读取与解析（`loadIgnorePatterns`），合并内置默认忽略规则 `.git`、`node_modules`、`dist`、`specs`、`_meta`（FR-004）
  - debounce 逻辑：`setTimeout` + `clearTimeout`，`debounceMs` 默认 3000ms，`pendingChanges: Set<string>`（FR-002）
  - 变更分类 `classifyChange(filePath)`：按扩展名返回 `'code' | 'docs' | 'config'`（FR-006）
  - `FileChangeEvent` 类型定义（含 `path`、`category` 字段）
  - `WatchOptions` 类型定义（含 `debounceMs`、`verbose`、`projectRoot` 字段）
  - 导出 `start()` / `stop()` 生命周期接口

**验收标准**:
- [ ] `start()` 成功调用 chokidar.watch，挂载文件变更事件
- [ ] `stop()` 清理 debounce 计时器并关闭 watcher
- [ ] 300ms 内两次修改同一文件只触发一次回调（debounce 合并验证可在测试中确认）

**实现提示**:
- chokidar v4.x 是 ESM-only，必须用动态 `import('chokidar')` 包裹在 try/catch 中以捕获降级
- `loadIgnorePatterns` 跳过空行和 `#` 注释行
- debounce timer 在 `stop()` 中调用 `clearTimeout` 避免泄漏

---

## Phase 3: User Story 1 + US2 - Watch CLI Handler（优先级：P1）

**目标**: 实现 `runWatchCommand`，将 FileWatcher 与已有的 `runBatch({ incremental: true })` 串联，交付"代码变更 → 自动文档同步"核心价值

**Independent Test**: 执行 `spectra watch`，修改一个源文件，确认约 3 秒后控制台打印增量更新已触发（mock `runBatch` 不调用真实 LLM）

- [x] T003 [US1][US2] 新建 `src/cli/commands/watch.ts`，实现 `runWatchCommand(command: CLICommand)`，包含：
  - 解析 `WatchOptions`（从 `command.watchDebounce`、`command.watchVerbose` 读取）
  - 打印启动消息，实例化 `FileWatcher`，调用 `watcher.start()`（FR-001）
  - 启动完成后打印"已就绪"消息（FR-013）
  - `onChange` 回调内：
    - 打印变更文件列表及分类标签（FR-006）
    - 调用 `isExternalBatchRunning()` 检测外部进程（FR-010）；若检测到则打印提示并跳过
    - `isRunning` 为 true 时将变更记入 `pendingNextRound`（FR-011）
    - 否则设置 `isRunning = true`，调用 `runBatch({ incremental: true })`（FR-007）
    - batch 完成后检查 `pendingNextRound`，非空则立即发起下一轮；最后设置 `isRunning = false`
    - batch 失败时不清空"待更新"状态，保证下次触发仍会重新处理（FR-009）
  - `isExternalBatchRunning()` 辅助函数：`pgrep -f "spectra batch"`，try/catch 异常时返回 `false`（FR-010）
  - `setupSignalHandlers(watcher)` 函数：注册 `SIGINT` / `SIGTERM`，`pendingShutdown` 标志 + 等待 `isRunning` 完成后调用 `watcher.stop()` 优雅退出（FR-003）

**验收标准**:
- [ ] 进程启动后 2 秒内打印"已就绪"
- [ ] 文件变更后 debounce 到期后调用 `runBatch`
- [ ] `isRunning` 期间新变更进入 `pendingNextRound`，不立即触发
- [ ] Ctrl+C 等待当前 batch 完成后退出，不留孤儿进程

**实现提示**:
- `isRunning` 和 `pendingShutdown` 用模块级 `let` 变量，不需要 class 封装（LOW 复杂度）
- `pendingNextRound: Set<string>` 收集等待中的变更文件，batch 完成后将其合并触发
- 失败处理：`try/catch` 包裹 `runBatch`，catch 中打印错误但**不**重置脏文件状态

---

## Phase 4: CLI 注册（parse-args + index.ts）

**目标**: 将 `watch` 注册为合法子命令，完成端到端的命令行入口

- [x] T004 [US1] 修改 `src/cli/utils/parse-args.ts`，添加 `watch` 子命令支持：
  - `CLICommand.subcommand` 联合类型添加 `'watch'`
  - `CLICommand` 接口新增可选字段 `watchDebounce?: number`、`watchVerbose?: boolean`
  - `parseArgs` 在 `cache` 分支后添加 `watch` 解析分支（`--debounce <seconds>` → `watchDebounce`、`--verbose` → `watchVerbose`）
  - L290 多联子命令合法性校验字符串添加 `'watch'`

**验收标准**:
- [ ] `parseArgs(['watch'])` 返回 `{ ok: true, command: { subcommand: 'watch', ... } }`
- [ ] `parseArgs(['watch', '--debounce', '5'])` 返回 `watchDebounce: 5`
- [ ] `parseArgs(['watch', '--verbose'])` 返回 `watchVerbose: true`
- [ ] 现有测试不回归

- [x] T005 [US1] 修改 `src/cli/index.ts`，注册 watch 子命令：
  - 新增 `import { runWatchCommand } from './commands/watch.js'`
  - `HELP_TEXT` 添加 watch 子命令说明：`spectra watch [--debounce <seconds>] [--verbose]`
  - `HELP_TEXT` 选项说明添加 `--debounce`、`--verbose` 条目
  - `switch` 块添加 `case 'watch': await runWatchCommand(command); break;`

**验收标准**:
- [ ] `spectra --help` 输出包含 `watch` 子命令描述
- [ ] `spectra watch` 可正常触发 `runWatchCommand`

---

## Phase 5: 单元测试

**目标**: 验证 FileWatcher 核心逻辑和 parse-args 扩展的正确性

- [x] T006 [US1][US2][US3][US4][US5] 新建 `src/watcher/file-watcher.test.ts`，覆盖以下测试点：
  - debounce 合并：300ms 内多次变更只触发一次回调（mock 计时器）
  - debounce 时长可配置（传入 `debounceMs: 1000`）
  - 变更分类：`.ts` → `[代码变更]`，`.md` → `[文档变更]`，`.json` → `[配置变更]`
  - `.gitignore` 解析：注释行和空行被跳过，合法规则被收录
  - `.gitignore` 不存在时使用内置默认规则（`node_modules` 等）
  - chokidar 初始化抛出异常时触发降级逻辑，打印降级警告（mock `import('chokidar')` 抛错）

- [x] T007 [US1] 修改 `src/cli/utils/parse-args.test.ts`，扩展 watch 相关测试：
  - `spectra watch` → `subcommand: 'watch'`
  - `spectra watch --debounce 5` → `watchDebounce: 5`
  - `spectra watch --verbose` → `watchVerbose: true`

---

## Phase 6: 集成测试

**目标**: 验证完整 watch 生命周期的端到端行为

- [x] T008 [US1][US2][US3] 新建 `src/cli/commands/watch.integration.test.ts`，覆盖以下测试点（mock `runBatch`，使用临时目录制造文件变更）：
  - 启动后 2 秒内打印"已就绪"（FR-013）
  - 文件变更后 debounce 到期触发 `runBatch({ incremental: true })` 调用
  - `isRunning` 期间新变更被 pending 而非立即触发第二次 batch（FR-011）
  - SIGINT 时等待当前 batch 完成后退出（FR-003）
  - mock `.gitignore` 包含 `node_modules/`，在该目录中制造变更后不触发回调（US3）

---

## Phase 7: Polish & Cross-Cutting

**目标**: 确保新模块结构完整，并与现有测试体系兼容

- [x] T009 新建 `src/watcher/index.ts`，导出 `FileWatcher`、`FileChangeEvent`、`WatchOptions` 类型，保持模块边界清晰

**验收标准**:
- [ ] `import { FileWatcher } from '../watcher/index.js'` 在 `watch.ts` 中可正常使用

- [x] T010 运行 `npm run repo:check` 确认无同步链路断裂，运行 `npm test` 确认全量测试通过

---

## FR 覆盖映射

| 功能需求 | 对应任务 | 状态 |
|----------|----------|------|
| FR-001 `spectra watch` 子命令 | T003, T004, T005 | 覆盖 |
| FR-002 debounce 3 秒，`--debounce` 可配置 | T002, T004 | 覆盖 |
| FR-003 SIGINT/SIGTERM 优雅退出 | T003 | 覆盖 |
| FR-004 `.gitignore` 解析 + 默认忽略规则 | T002 | 覆盖 |
| FR-005 chokidar 失败降级到 `fs.watch` | T002 | 覆盖 |
| FR-006 变更类型分类展示 | T002, T003 | 覆盖 |
| FR-007 复用 `runBatch({ incremental: true })` | T003 | 覆盖 |
| FR-008 变更文件集传递给增量判定（日志层） | T003 | 覆盖 |
| FR-009 失败保留"待更新"状态 | T003 | 覆盖 |
| FR-010 外部 batch 进程检测 | T003 | 覆盖 |
| FR-011 进程内串行执行（pending 机制） | T003 | 覆盖 |
| FR-012 变更检测 3 秒内完成 | T002（debounce 设计） | 覆盖 |
| FR-013 启动 2 秒内打印"已就绪" | T003 | 覆盖 |
| FR-014 内存占用不超过 50MB | T002（chokidar v4.x 轻量） | 覆盖 |
| FR-015 仅引入一个外部依赖（chokidar） | T001 | 覆盖 |

**覆盖率**: 15/15 FR，100%

---

## 依赖与执行顺序

### Phase 依赖关系

```
Phase 1 (T001) → Phase 2 (T002) → Phase 3 (T003) → Phase 4 (T004, T005) → Phase 5-6 (T006-T008) → Phase 7 (T009, T010)
```

- T004 和 T005 可并行执行（不同文件：`parse-args.ts` vs `index.ts`）
- T006 和 T007 可并行执行（不同测试文件）
- T008 依赖 T003 完成

### User Story 内部依赖

- **US1（核心功能）**: T001 → T002 → T003 → T004 + T005
- **US2（手动增量保持不变）**: 无新代码，通过 T003 复用 `runBatch` 路径验证
- **US3（.gitignore 过滤）**: T002 中 `loadIgnorePatterns` 已覆盖
- **US4（变更分类展示）**: T002 中 `classifyChange` + T003 中控制台输出
- **US5（降级保证）**: T002 中降级逻辑

### 推荐实现策略：MVP First

1. 完成 T001（依赖安装）
2. 完成 T002（FileWatcher 核心）
3. 完成 T003（watch CLI handler）
4. 完成 T004 + T005（CLI 注册，可并行）
5. **验证 MVP**：`spectra watch` 可启动并响应文件变更
6. 完成 T006 + T007（单元测试，可并行）
7. 完成 T008（集成测试）
8. 完成 T009 + T010（polish）

---

## 备注

- 所有文件路径均相对于项目根目录 `src/`
- chokidar v4.x ESM-only，`import('chokidar')` 动态导入是处理降级的必要模式
- `watch.ts` 中 `isRunning` 等状态用模块级变量（非 class），符合 LOW 复杂度定级
- `parse-args.ts` 修改后 LOC 约 483，未超过 500 清理阈值，无需前置重构
