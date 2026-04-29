# Feature Specification: LLM 并发优化器

**Feature Branch**: `146-llm-concurrency-optimizer`
**Created**: 2026-04-29
**Status**: Draft
**里程碑**: M-103 Phase 3「大规模可靠性」

---

## 背景与现状澄清

**重要**：本 Feature 并非"新增并发"，而是**重构 + 优化现有并发实现**。

`src/batch/batch-orchestrator.ts` 已存在手写信号量并发控制（约 30 行，steps 4 并发调度段），但历史上出现过 `Promise.race([])` 死锁 bug（注释"H2 修复"可见）。`BatchOptions.concurrency` 字段已存在但当前默认值为 1（顺序处理）。

Feature 146 的真实范围：
1. 将手写信号量**替换**为成熟库 `p-limit`
2. 将 `concurrency` 默认值从 1 提升到 3
3. 暴露 CLI `--concurrency=N` flag
4. 明确双层重试关系（SDK 层 + 应用层），降低 9N 请求放大风险
5. 扩展进度展示支持并发下三维状态（已完成 / 进行中 / 排队）
6. 确保可观测性正确性（tokenUsage 累加、durationMs 含义）

---

## 关键决策（DQ 决策拍板）

| 编号 | 问题 | 决策 | 理由 |
|------|------|------|------|
| DQ1 | 默认 concurrency 值 | **3** | tech-research Q1 分析：Sonnet 单次调用 15-30s，并发 3 时总吞吐量显著提升且 429 风险可控；5 超出 Anthropic 免费/低配额下的安全窗口 |
| DQ2 | 应用层重试是否移除 | **保留，但明确语义** | SDK 已处理单请求级 429/529 重试（v0.39.0 `>= 500` 覆盖）；应用层 `maxRetries` 的语义是"模块级重试"，两者职责不同。并发场景下通过 `concurrency=3` 限流，不单独移除应用层 |
| DQ3 | 是否引入 p-limit | **是** | 100M 周下载、~400B gzip、纯 ESM；当前手写实现有 bug 历史，替换成本远低于维护成本 |
| DQ4 | E2E 测试文件归属 | **新建独立文件** `tests/e2e/batch-concurrency.e2e.test.ts` | 关注点隔离，不增加 F144 已有 E2E 的运行时间 |
| DQ5 | CLI flag 命名 | **`--concurrency=N`** | 与 `BatchOptions.concurrency` 字段名对齐，符合已有内部命名约定 |

---

## User Scenarios & Testing

### User Story 1 — 一键开启并发加速（Priority: P1）

作为使用 Spectra 分析大型项目的开发者，当项目有 50+ 模块时，我希望通过简单配置开启并发处理，让 batch 总耗时大幅缩短，而不需要改动任何业务逻辑。

**Why this priority**: 这是 Feature 146 的核心价值主张。无此能力，Feature 146 就不存在意义。

**Independent Test**: 在中型项目（≥ 10 模块）上运行 `spectra batch --concurrency=5`，观察总耗时是否明显低于顺序执行。

**Acceptance Scenarios**:

1. **Given** 一个含 10 个模块的项目、LLM API 可用，**When** 用户执行 `spectra batch --concurrency=3`，**Then** 系统以最多 3 个模块并发调用 LLM，总耗时小于顺序执行耗时。
2. **Given** 用户在 `spec-driver.config.yaml` 的 `batch.concurrency` 节中设置 `concurrency: 5`，**When** 执行 `spectra batch`（不附带 CLI flag），**Then** 系统以 `concurrency=5` 运行。
3. **Given** CLI flag `--concurrency=2` 和配置文件 `concurrency: 5` 同时存在，**When** 执行命令，**Then** CLI flag 优先，以 `concurrency=2` 运行（CLI 高于配置文件）。
4. **Given** 用户执行 `spectra batch`（无任何 concurrency 配置），**When** 系统初始化，**Then** 以 `concurrency=3` 运行（新默认值）。

---

### User Story 2 — 单模块失败不阻塞整体进度（Priority: P1）

作为开发者，当我对大型项目执行 batch 时，某个模块的 LLM 调用网络超时或 API 返回错误，我希望该模块被标记失败后跳过，其余模块继续处理，而不是整批中断。

**Why this priority**: 对于 50+ 模块的大型项目，单点失败导致全部中止是不可接受的。此能力与 P1 并发加速协同——并发下任何一个模块的异常都可能影响其他模块，必须确保隔离。

**Independent Test**: 构造一个包含 1 个必然失败模块（mock LLM 抛出异常）和 5 个正常模块的 fixture，运行 batch，验证 `BatchResult.failed` 包含 1 项、`successful` 包含 5 项。

**Acceptance Scenarios**:

1. **Given** 6 个模块的 batch，其中第 2 个模块的 LLM 调用抛出网络异常，**When** 执行 `runBatch()`，**Then** `BatchResult.failed` 包含该模块，其余 5 个模块正常完成，`BatchResult.successful` 长度为 5。
2. **Given** 并发数为 3，第 1 批次中某个模块超时，**When** 超时发生，**Then** 该槽位释放，下一个排队模块立即开始处理，不影响同批次其他进行中的模块。
3. **Given** `concurrency=1`（顺序模式），某模块失败，**When** 处理下一个模块，**Then** 下一模块正常开始，顺序处理不受影响。

---

### User Story 3 — 并发下进度可视化（Priority: P2）

作为开发者，当多个模块同时被处理时，我希望命令行进度条能展示「已完成 / 进行中 / 排队」三维状态，而不是只有一个单调的百分比。

**Why this priority**: P2 是用户体验改善而非功能正确性。P1 的并发控制实现后，此功能可独立迭代。

**Independent Test**: 在 TTY 终端中运行 `spectra batch --concurrency=3`，观察进度条是否在并发期间实时显示「进行中: N」计数。

**Acceptance Scenarios**:

1. **Given** TTY 环境、`concurrency=3`、共 10 个模块，**When** batch 运行中（前几批正在处理），**Then** 进度行同时展示：`已完成: X / 进行中: Y / 排队: Z / 总计: 10`，其中 `Y ≤ 3`。
2. **Given** pipe 模式（非 TTY）或 `progressMode: 'pipe'`，**When** batch 运行，**Then** 每个模块完成时输出独立日志行，不使用原地重绘（与现有 pipe 模式行为一致）。
3. **Given** `concurrency=1`（顺序模式），**When** batch 运行，**Then** 进度展示与现有行为相同（向后兼容，不强制展示三维状态）。

---

### User Story 4 — 可观测性：Token 累加与耗时准确（Priority: P2）

作为开发者，运行 batch 后查看 cost summary，我希望 `tokenUsage` 的总量准确（与顺序模式一致），`durationMs` 反映真实墙钟耗时（并发完成后减去开始时间，而非各模块耗时之和）。

**Why this priority**: 可观测性数据影响用户对 LLM 成本和时间节省的判断，但不影响核心功能正确性，故为 P2。

**Independent Test**: 用同一 fixture 分别以 `concurrency=1` 和 `concurrency=3` 运行，比较两次的 `costSummary.totalInputTokens`——数值应相同；`durationMs` 在并发模式下应明显小于顺序模式。

**Acceptance Scenarios**:

1. **Given** 10 个模块，每个模块 LLM 调用消耗 100 input tokens，**When** 以 `concurrency=3` 运行，**Then** `costSummary.totalInputTokens` 为 1000（与 `concurrency=1` 运行结果相同）。
2. **Given** 10 个模块，每个模块 LLM 调用耗时约 1s，**When** 以 `concurrency=3` 运行，**Then** `BatchResult.duration` 约为 4-5s（而非 10s），体现并行加速。
3. **Given** 某模块 LLM 调用失败，**When** 该模块被记录到 `failed[]`，**Then** 其 token 消耗（即使仅为估算值 `ESTIMATED_FAILED_CALL_INPUT`）仍计入 `costSummary`。

---

### User Story 5 — 向后兼容：不破坏现有工作流（Priority: P1）

作为已在 CI 中使用 `spectra batch` 的开发者（参考 F144 的 E2E 流程），Feature 146 上线后，我的现有命令和测试不应出现行为变化或测试失败。

**Why this priority**: 破坏现有 E2E 测试是不可接受的回归。列为 P1 是验收门禁而非可选项。

**Independent Test**: 在不传 `--concurrency` 参数的情况下运行 `npm run test:e2e`，4/4 通过。

**Acceptance Scenarios**:

1. **Given** 现有 F144 E2E 测试套件（`tests/e2e/batch-pipeline.e2e.test.ts`），**When** 执行 `npm run test:e2e`，**Then** 全部 4 个测试通过，无失败无超时。
2. **Given** 现有调用方通过代码直接调用 `runBatch(projectRoot, options)`（不传 `concurrency`），**When** 升级到 Feature 146 后，**Then** 行为与升级前等同（新默认值 `concurrency=3` 可能加快速度，但功能输出不变）。
3. **Given** 现有调用方显式传入 `concurrency: 1`，**When** 运行，**Then** 采用顺序处理路径，结果与之前完全一致。

---

### Edge Cases

| 场景 | 期望行为 | 关联需求 |
|------|----------|----------|
| `concurrency=0` | 系统视为 `concurrency=1`（顺序处理），并在日志中输出警告 | FR-002 |
| `concurrency<0`（如 `-1`） | 同 `concurrency=0`，视为 `concurrency=1` + 警告 | FR-002 |
| `concurrency` 超过模块总数（如 50 个并发但只有 3 个模块） | 以 `min(concurrency, moduleCount)` 实际并发，不报错 | FR-003 |
| 网络中断（所有 LLM 调用同时失败） | 所有模块进入 `failed[]`，`BatchResult` 正常返回，不抛出未捕获异常 | FR-005 |
| 单模块 LLM 调用持续超时（超过 SDK timeout） | 该模块被标记失败，超时槽位释放，其余模块继续 | FR-005 |
| `concurrency=3` 时恰好有 3 个模块同时完成 | `p-limit` 正确处理槽位回收，下一批次正常启动 | FR-001 |
| `concurrency` 从 config.yaml 读取为字符串（如 `"3"`） | 系统自动转换为整数，或给出明确错误提示 | FR-002 |
| `Promise.race([])` 边界（空 pending 数组） | 由 `p-limit` 内部处理，此场景不再出现于代码路径 | FR-001 |
| 检查点文件并发写入（多模块同时完成） | 写入顺序不确定但最终状态正确（JS 单线程 `writeFileSync` 不会真正并发写） | 技术债务记录 |

---

## Requirements

### Functional Requirements

#### 核心并发控制

- **FR-001** [必须]: 系统 MUST 将 `batch-orchestrator.ts` 中现有的手写信号量实现（steps 4 并发调度段，约 30 行）**替换**为 `p-limit` 库，消除 `Promise.race([])` 死锁边界风险。[AUTO-RESOLVED: tech-research Q2 推荐方案 B，p-limit 技术成熟度高，替换风险低]

- **FR-002** [必须]: 系统 MUST 对 `concurrency` 参数进行边界规范化：当传入值 ≤ 0 时，静默修正为 1 并写入 warn 日志；当传入非整数时，向下取整。

- **FR-003** [必须]: 系统 MUST 将 `BatchOptions.concurrency` 的默认值从 1 改为 3，并在代码注释中记录此变更原因及 SDK 重试放大分析。

#### CLI 与配置暴露

- **FR-004** [必须]: CLI MUST 支持 `--concurrency=N`（亦支持空格语法 `--concurrency N`）flag，将值传入 `BatchOptions.concurrency`。

- **FR-005** [必须]: 配置文件 `spec-driver.config.yaml` 在新增的 `batch.concurrency` 节下 MUST 支持 `concurrency` 字段，在 CLI flag 未传入时作为默认值来源；CLI flag 优先级高于配置文件（决议 C-001：配置位置统一在 spec-driver.config.yaml）。

#### 失败隔离

- **FR-006** [必须]: 系统 MUST 保持单模块失败不影响其他模块的行为：每个并发任务在 `p-limit` 封装层内通过 try/catch 处理所有异常，任意模块的 reject 不传播到调度层。

- **FR-007** [必须]: 系统 MUST 在整批调度结束处使用 `Promise.allSettled()`（而非 `Promise.all()`），确保即使存在内部未预期的 reject，批处理仍能正常收尾。

#### 可观测性

- **FR-008** [必须]: 系统 MUST 保证 `tokenUsage` 的累加在并发下正确：利用 JavaScript 单线程事件循环特性，`+=` 操作在 `await` 之后同步执行，无竞态风险。代码注释必须标注此安全性依据。[AUTO-RESOLVED: tech-research Q3 明确确认 JS 单线程无竞态]

- **FR-009** [必须]: `BatchResult.duration` MUST 反映批处理的真实墙钟耗时（从 `runBatch` 开始到所有模块完成），不得为各模块耗时之和。

#### 进度展示

- **FR-010** [应当]: TTY 模式下的进度渲染 SHOULD 展示三维状态：`已完成: X / 进行中: Y / 排队: Z / 总计: N`，其中「进行中」计数通过 `p-limit` 的 `activeCount` 属性获取。

- **FR-011** [应当]: 进度展示扩展 SHOULD 在不修改现有 `ProgressReporter` 接口签名的前提下实现，通过向 reporter 注入 `activeCount` getter 的方式扩展渲染逻辑。

- **FR-012** [可选]: ProgressMode 类型 MAY 新增 `'silent'` 值，以解决 `tests/e2e/batch-pipeline.e2e.test.ts` 中传入 `'silent'` 但类型不包含该值的 mismatch 问题（当前为测试 bug，可酌情同步修复）。

#### 依赖引入

- **FR-013** [必须]: 项目 MUST 在 `package.json` 的 `dependencies`（非 devDependencies）中新增 `p-limit`，版本约束与项目当前 Node.js 20.x 和纯 ESM 要求兼容。

#### 向后兼容

- **FR-014** [必须]: `runBatch()` 的函数签名 MUST 保持向后兼容：`concurrency` 字段已存在于 `BatchOptions` 接口，本 Feature 仅改变默认值，不新增必填参数。

- **FR-015** [必须]: `concurrency=1` 时 MUST 采用顺序处理路径（与现有 for-await 顺序循环行为等同），不引入 `p-limit` 的调度开销（可通过 `if concurrency <= 1` 分支保持）。[可选: 简化为统一 p-limit 路径，若 p-limit(1) 语义等同则移除分支]

#### 双层重试语义澄清

- **FR-016** [应当]: 代码注释 SHOULD 明确记录双层重试关系：SDK 层（`maxRetries=2`，含退避）处理单请求级 429/529；应用层 `maxRetries`（默认 3 次模块级重试）处理更高层次的模块失败。两层独立，理论最差情况每模块产生 9 次 HTTP 请求（3 × 3）。此为已知设计取舍，通过 `concurrency=3` 限制总体流量。

### Key Entities

- **BatchOptions.concurrency**: 并发处理的模块数上限，整数，默认 3，范围 1-N（N 无上限，但超过模块数时等效于模块数）
- **p-limit 实例**: 替换现有手写信号量，在 `runBatch` 步骤 4 并发调度段创建，生命周期与一次 `runBatch` 调用等同
- **ProgressReporter 活跃计数扩展**: 向现有 reporter 注入 `p-limit.activeCount` 以支持「进行中」维度展示

---

## Success Criteria

### 可测量成果

- **SC-001**: `spectra batch --concurrency=N` CLI flag 生效——执行后实际并发数不超过 N（通过 E2E 测试 mock LLM 计数验证）。

- **SC-002**: `concurrency` 可通过配置文件设置——配置文件中设定 `concurrency: 5` 后，不传 CLI flag 时以 5 并发运行。

- **SC-003**: 并发上限严格执行——在含 10 个模块的测试中，`concurrency=3` 时同时活跃的 LLM 调用数始终 `≤ 3`（E2E mock 峰值计数断言）。

- **SC-004**: 单模块失败不阻塞——1 个必然失败模块 + 5 个正常模块的 fixture，`BatchResult.failed.length === 1` 且 `BatchResult.successful.length === 5`。

- **SC-005**: tokenUsage 并发累加正确——同一 fixture 以 `concurrency=1` 和 `concurrency=3` 运行，`costSummary.totalInputTokens` 数值相同（误差 < 1%，允许估算误差）。

- **SC-006**: durationMs 反映并行加速——每个模块模拟 100ms LLM 耗时，10 个模块以 `concurrency=3` 运行，总耗时 `< 700ms`（理论最优约 400ms，留 75% 余量）。

- **SC-007**: F144 E2E 不回归——`npm run test:e2e` 4/4 通过，无超时无失败。

- **SC-008**: 全量单元测试不回归——`npx vitest run` 通过数 ≥ 2268，零失败。

- **SC-009**: 类型检查零错误——`npm run build` 零 TypeScript 编译错误。

- **SC-010**: 手写信号量代码已移除——`batch-orchestrator.ts` 中不再存在 `pending: Promise<void>[]` + `activeCount` 手写信号量实现，由 `p-limit` 替代。

---

## 技术边界与约束

### 可修改范围

- `src/batch/batch-orchestrator.ts`：步骤 4 并发调度段重构（替换手写信号量），默认值修改
- `src/batch/progress-reporter.ts`：进度渲染逻辑扩展（新增 activeCount 参数）
- `src/cli/`（CLI 入口）：新增 `--concurrency=N` flag 解析
- `tests/batch/`：相关单元测试更新
- `tests/e2e/`：新增 `batch-concurrency.e2e.test.ts`
- `package.json`：新增 `p-limit` 依赖

### 不可修改范围

- `src/core/llm-client.ts`：SDK 重试逻辑保持原样，不改动 `maxRetries` 设置
- `src/panoramic/`：蓝图文档链路不受影响
- `BatchOptions` 接口签名：仅允许修改 `concurrency` 字段的默认值注释，不新增必填参数

### 外部依赖约束

- `p-limit` 版本需满足：支持纯 ESM、Node.js 20.x、TypeScript 类型定义内置
- 不得引入 `p-queue`、`bottleneck`、`ora`、`cli-progress` 等额外依赖

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估值 |
|------|--------|
| 新增组件/模块数量 | 0（无新模块，仅修改现有文件） |
| 新增或修改接口数量 | 2（`BatchOptions.concurrency` 默认值变更；`ProgressReporter` 渲染逻辑扩展） |
| 新增外部依赖数量 | 1（`p-limit`） |
| 跨模块耦合 | 低（修改 `batch-orchestrator.ts` + `progress-reporter.ts` + CLI 入口，接口契约不变） |
| 复杂度信号 | 无递归结构；无状态机；无数据迁移；并发控制但委托给 `p-limit` 封装 |
| **总体复杂度** | **LOW** |

**GATE_DESIGN 判定依据**：组件 = 0，接口 = 2，依赖 = 1，无高复杂度信号。按判定规则落入 LOW 区间，可进入自动化执行流程，无需人工架构审查。

---

## 技术债务记录

以下问题已在调研阶段识别，本 Feature 不处理，记录为待处理债务：

- **TD-001**：checkpoint 文件并发写入顺序不确定。并发下多模块同时完成时，`saveCheckpoint`（`fs.writeFileSync`）被多次调用。JS 单线程保证不会真正并发写，但写入顺序与处理顺序可能不一致。最终态正确，暂不处理。
- **TD-002**：`progressMode: 'silent'` 类型 mismatch。`tests/e2e/batch-pipeline.e2e.test.ts` 传入了 `'silent'` 但 `ProgressMode` 类型为 `'tty' | 'pipe'`。本 Feature 在 FR-012（`[可选]`）中记录，可酌情同步修复。
- **TD-003**：9N 请求放大理论上限。SDK `maxRetries=2` + 应用层 `maxRetries=3` 在最差情况下产生 9 次 HTTP 请求。`concurrency=3` 限流可降低实际影响，但未从根本上解决。若未来需要更精确的限速控制，可考虑引入全局退避协调或降低 SDK `maxRetries`。
