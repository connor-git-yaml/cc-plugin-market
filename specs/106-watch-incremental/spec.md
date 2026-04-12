# Feature Specification: 文件监听 + 自动增量同步

**Feature Branch**: `106-watch-incremental`  
**Created**: 2026-04-12  
**Status**: Draft  
**Input**: 让开发者在编码过程中自动保持文档与代码同步

---

## 用户场景与测试

### User Story 1 - 启动文件监听，代码改动自动触发文档更新（优先级：P1）

开发者在项目根目录执行 `spectra watch` 后，进入持续监听状态。每当他修改源代码文件，系统在静默等待约 3 秒后，自动检测哪些文档已过期，并仅对这些文件执行增量重新生成。开发者无需手动反复执行 `batch`，文档始终与代码保持同步。

**Why this priority**：这是整个 Feature 的核心用户价值——将文档同步从"手动触发"变成"自动持续"。没有这个 Story，Feature 无意义。

**Independent Test**：在包含源文件和已生成文档的项目中执行 `spectra watch`，修改一个源文件，观察系统是否在约 5 秒内（3 秒静默 + 处理时间）完成对应文档的增量更新。

**Acceptance Scenarios**:

1. **Given** 一个已有生成文档的项目，**When** 开发者执行 `spectra watch`，**Then** 系统打印启动成功消息并进入监听状态，进程持续运行直到收到停止信号。
2. **Given** 监听已启动，**When** 开发者修改一个源代码文件并保存，**Then** 系统在 3 秒静默期后自动触发增量 batch，仅重新生成受影响的文档，控制台打印已更新的文件列表。
3. **Given** 监听已启动，**When** 开发者在 3 秒内连续修改多个文件，**Then** 系统只触发一次批量更新，而不是多次独立触发（debounce 行为）。
4. **Given** 监听已启动，**When** 开发者按下 Ctrl+C（SIGINT），**Then** 系统等待当前正在运行的更新完成后优雅退出，不留下孤儿进程或损坏的文档索引。

---

### User Story 2 - 手动增量更新保持不变（优先级：P1）

开发者在一次集中修改后，希望一次性更新所有过期文档。他执行现有的 `spectra batch --incremental`，系统通过已有的差量分析机制判断哪些模块受影响，只处理这些模块。watch 模式与手动增量使用同一套增量判定逻辑。

**Why this priority**：确保 watch 不引入新的增量语义，复用已有的 `--incremental` 路径。开发者在 CI/CD 或非 watch 场景下仍可通过现有命令完成增量更新。

**Independent Test**：修改若干源文件后执行 `spectra batch --incremental`，验证只有受影响的模块被重新生成，行为与引入 watch 前完全一致。

**Acceptance Scenarios**:

1. **Given** 项目中有 3 个模块的源文件发生了变更，**When** 执行 `spectra batch --incremental`，**Then** 系统只处理这 3 个模块，跳过其余模块，运行结束后报告"处理 3/N 模块"。
2. **Given** 项目中无文件变更，**When** 执行 `spectra batch --incremental`，**Then** 系统打印"所有文档已是最新"并以成功状态退出。

---

### User Story 3 - 通过 `.gitignore` 过滤监听范围（优先级：P2）

开发者不希望 `node_modules`、`.git`、构建输出目录等噪音文件触发文档更新。系统自动读取项目的 `.gitignore` 文件，将这些路径从监听范围中排除。开发者不需要额外配置忽略规则。

**Why this priority**：没有过滤，监听会被大量无关文件变更持续误触发，严重影响使用体验。是 P1 能力的质量保障。

**Independent Test**：在包含 `node_modules` 并配置了 `.gitignore` 的项目中启动 watch，在 `node_modules` 中制造文件变更，验证系统不触发任何更新。

**Acceptance Scenarios**:

1. **Given** 项目根目录有 `.gitignore` 且包含 `node_modules/`，**When** 启动 `spectra watch` 并在 `node_modules/` 中修改文件，**Then** 系统不触发任何更新。
2. **Given** 项目无 `.gitignore` 文件，**When** 启动 `spectra watch`，**Then** 系统正常启动，使用内置默认忽略规则（`.git`、`node_modules`、`dist`、`specs`）。

---

### User Story 4 - 变更文件类型分类展示（优先级：P2）

开发者在 watch 模式下看到文件变更时，控制台能区分该变更属于"源代码"、"文档"还是"配置文件"，帮助他快速判断当前变更的影响范围。

**Why this priority**：分类显示提升可观察性，但不影响核心功能正确性。

**Independent Test**：在 watch 模式下分别修改 `.ts`、`.md` 和配置文件，观察控制台输出是否分别打印对应的变更类型标签。

**Acceptance Scenarios**:

1. **Given** watch 已启动，**When** 修改 `.ts` 源文件，**Then** 控制台打印 `[代码变更]` 类型标签及文件路径。
2. **Given** watch 已启动，**When** 修改 `.md` 文档文件，**Then** 控制台打印 `[文档变更]` 类型标签。
3. **Given** watch 已启动，**When** 修改配置文件，**Then** 控制台打印 `[配置变更]` 类型标签。

---

### User Story 5 - 文件监听降级保证（优先级：P3）

在文件监听库初始化失败的环境中（如受限的 Linux 容器），系统能自动降级到 Node.js 原生文件监听能力，保证基础功能可用，并在控制台打印降级提示。

**Why this priority**：降级策略是健壮性保障，不影响主流使用场景。

**Independent Test**：在文件监听库初始化被模拟为失败的测试环境中启动 watch，验证系统打印降级警告，且文件变更仍能被检测到。

**Acceptance Scenarios**:

1. **Given** 文件监听库初始化失败，**When** 启动 `spectra watch`，**Then** 系统打印降级警告并继续运行。
2. **Given** 降级到原生监听模式，**When** 修改源文件，**Then** 系统仍能检测到变更并触发增量更新（可能存在数秒额外延迟）。

---

### Edge Cases

- 当 watch 触发的增量更新正在运行时，开发者又修改了新文件——系统应记录新变更，等当前更新完成后再触发下一轮。
- 当监听的项目目录本身被删除或移动时，watch 应打印错误并优雅退出，而不是崩溃或进入无限重试循环。
- 当增量重新生成本身失败（如 LLM 调用超时）时，下次 watch 触发或手动 `batch --incremental` 仍应重新处理这些模块（失败不应被记为成功）。
- 当项目根目录有极大量文件（如 10,000+）时，启动 watch 时的初始扫描不应阻塞超过 2 秒。
- 当 `.gitignore` 文件在 watch 运行期间被修改时，忽略规则不会热重载（需重启 watch 生效）。[AUTO-RESOLVED: 热重载属于 YAGNI]
- 当用户同时运行 `spectra watch` 和手动 `spectra batch` 时，watch 应检测到手动 batch 正在运行，跳过本次触发并打印提示。

---

## 功能需求

### Watch 监听子命令

- **FR-001**: 系统 MUST 提供 `spectra watch` CLI 子命令，启动后进入持续文件监听状态，直到收到停止信号。 `[必须]`
- **FR-002**: 系统 MUST 在检测到文件变更后，等待 3 秒静默期（debounce）后再触发增量更新，3 秒内的多次变更合并为一次处理。用户可通过 `--debounce <seconds>` 自定义静默时长。 `[必须]`
- **FR-003**: 系统 MUST 在收到 SIGINT 或 SIGTERM 信号时，等待当前更新任务完成后优雅退出，保证文档索引完整性。 `[必须]`
- **FR-004**: 系统 MUST 读取项目根目录的 `.gitignore` 文件并排除匹配路径。`.git`、`node_modules`、`dist`、`specs`、`_meta` 目录默认排除。 `[必须]`
- **FR-005**: 系统 MUST 在文件监听库初始化失败时自动降级到原生文件监听（轮询间隔 5 秒），并打印降级警告。 `[必须]`
- **FR-006**: 系统 SHOULD 在控制台将检测到的文件变更按类型（源代码/文档/配置）分类展示。 `[可选]`

### 与现有增量机制的整合

- **FR-007**: 系统 MUST 在 watch 触发的增量更新中复用现有的 `batch --incremental` 增量判定路径，不引入新的增量语义或独立的"脏文件"跟踪机制。包括配置加载阶段（`loadProjectConfig/mergeConfig`），将 `outputDir` 和 `languages` 透传给 `runBatch`，与 `spectra batch` 的行为保持一致。 `[必须]`
- **FR-008**: 系统 MUST 在 watch 触发更新时，在控制台日志中输出本轮触发源（变更文件列表），增量判定仍由现有 DeltaRegenerator 全权负责，watch 不干预其决策过程。 `[必须]`
- **FR-009**: 系统 MUST 在增量生成失败时保留模块的"待更新"状态，确保下次触发或手动 `batch --incremental` 仍会重新处理。 `[必须]`

### 并发保护

- **FR-010**: 系统通过进程内 `isRunning` 串行标志实现并发保护：当前轮次更新未完成时，新的文件变更先被记录，等当前任务结束后再触发下一轮（FR-011）。不使用 lock file（跨平台风险高，且与架构决策冲突；已在 spec Clarifications #3 中明确排除）。用户应避免同时运行 `spectra watch` 和 `spectra batch`，两者共享同一 checkpoint 文件；启动时会打印提示信息。 `[必须]`
- **FR-011**: 系统 MUST 在 watch 进程内部串行执行更新任务——当前一轮更新未完成时，新的文件变更先被记录，等当前任务结束后再触发下一轮。 `[必须]`

### 性能约束

- **FR-012**: 系统 MUST 在文件变更发生后 3 秒内完成变更检测（不含生成时间，仅含 debounce + 变更收集）。 `[必须]`
- **FR-013**: 系统 MUST 在 watch 进程启动后 2 秒内完成初始化并打印"已就绪"消息。 `[必须]`
- **FR-014**: 系统 MUST 在 watch 持续运行时，进程内存占用不超过 50MB（不含生成器本身的内存）。 `[必须]`

### 依赖约束

- **FR-015**: 系统 MUST 仅引入一个新的外部文件监听依赖，且必须有原生降级路径。 `[必须]`

---

## Key Entities

- **WatchSession**：一次 watch 进程的运行实例，持有监听状态和当前运行中的更新任务引用；进程退出时负责确保资源清理。
- **FileChangeEvent**：一次文件变更的描述，含文件路径和变更分类（源代码/文档/配置）。
- **WatchOptions**：`spectra watch` 命令的用户配置，含 debounce 时长（默认 3 秒）和是否启用详细日志。

---

## 成功标准

### Measurable Outcomes

- **SC-001**：开发者修改源文件后，无需任何手动操作，在约 5 秒内（3 秒 debounce + 处理时间）看到增量更新启动。
- **SC-002**：`spectra watch` 进程启动时间不超过 2 秒（从命令执行到"已就绪"消息出现）。
- **SC-003**：watch 进程在持续运行 1 小时后，内存占用不超过 50MB（不含生成器内存）。
- **SC-004**：开发者能通过 Ctrl+C 干净退出 watch 进程，退出后文档索引完整、无损坏。
- **SC-005**：在 `.gitignore` 中被忽略的路径发生变更时，watch 不触发任何处理。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|-----|------|
| 组件总数 | 2 | Watcher（文件监听 + debounce）、watch CLI handler（`index.ts` 为薄壳导出，不计为独立组件） |
| 接口数量 | 3 | CLICommand 类型扩展、parseArgs watch 分支、WatchSession 生命周期 |
| 依赖新引入数 | 1 | 文件监听库（有原生降级路径） |
| 跨模块耦合 | 是 | 需修改 2 个现有文件：`parse-args.ts`（CLICommand 类型）、`index.ts`（子命令注册） |
| 复杂度信号 | 0 | watch 内部串行执行，无并发控制需求 |
| **总体复杂度** | **LOW** | 组件 2（< 3）+ 接口 3（< 4）+ 0 个复杂度信号 → LOW |

**架构简化说明**：

相比初始设计，本版本做了以下简化：

1. **移除 `_meta/needs_update.json`**：watch 进程已知道哪些文件变了，直接传递给增量 batch，无需中间文件。
2. **移除 `--update` flag**：与现有 `--incremental` 高度重叠。watch 直接复用 `--incremental` 路径。
3. **移除 lock file 机制**：watch 内部串行执行更新，无跨进程并发写入问题。对"用户同时手动 batch"场景，简单检测跳过即可。
4. **移除 StaleMarker 模块**：不再需要独立的脏文件跟踪组件。

**简化前后对比**：组件 4→2，接口 5→3，复杂度信号 1→0，总体 MEDIUM→LOW。

---

## Clarifications

### Session 2026-04-12

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| 1 | watch 应引入新的 `--update` 增量语义还是复用 `--incremental` | 复用 `--incremental` | `--update` 与 `--incremental` 目标相同（只处理变了的东西），区别仅在于"谁告诉你什么变了"。batch-orchestrator 的 DeltaRegenerator 已能通过 AST hash 判断变更，新增语义会导致两套并行的增量链路 |
| 2 | 脏文件状态持久化到 `_meta/needs_update.json` 还是不持久化 | 不持久化 | watch 进程已知变更文件列表，直接传递给 batch。持久化引入不必要的 I/O 和状态一致性问题 |
| 3 | 并发控制用 lock file 还是更简单的检测机制 | 简单检测 | watch 内部串行执行更新（同进程），无需跨进程锁。对用户手动运行 batch 的场景，检测到即跳过并提示 |
| 4 | `.gitignore` 热重载 | 仅启动时加载 | 热重载属于 YAGNI |
| 5 | 文件监听库版本 | chokidar v4.x | ESM-first，与项目 TypeScript ESM 配置一致 |
