# Tasks: LLM 并发优化器（Feature 146）

**Input**: `specs/146-llm-concurrency-optimizer/`（spec.md、plan.md、research/tech-research.md）
**Feature Branch**: `146-llm-concurrency-optimizer`
**Created**: 2026-04-29

---

## 格式说明

- `[P]`：可并行执行（不同文件、无依赖关系）
- `[US1/2/3/4/5]`：所属 User Story
- Setup / Foundational / Polish 阶段不加 User Story 标记
- **关键路径任务**以 `★ CRITICAL PATH` 标注

---

## Phase 1: Setup — 依赖引入与配置入口（前置，无风险）

**目标**：引入外部依赖，建立配置入口。不改动任何运行时逻辑，零业务风险。

- [ ] T001 引入 `p-limit ^6.1.0` 到 `package.json` 的 `dependencies` 节（非 devDependencies），安装并验证 ESM import 正常
  - **文件**: `package.json`（修改），`package-lock.json`（自动更新）
  - **验收**: `node -e "import('p-limit').then(m => console.log('ok', typeof m.default))"` 输出 `ok function`
  - **估算**: 15 min
  - **依赖**: 无
  - **是否阻塞其他 task**: 是（T003、T004、T007、T008 依赖 p-limit 安装）
  - ★ CRITICAL PATH

- [ ] T002 [P] 在 `.specify/spec-driver.config.yaml` 新增 `batch.concurrency` 配置节
  - **文件**: `.specify/spec-driver.config.yaml`（修改）
  - **变更内容**: 在顶层新增 `batch:` 键，其下新增 `concurrency: 3`，附注释说明 CLI 优先级规则
  - **验收**: `cat .specify/spec-driver.config.yaml | grep -A3 'batch:'` 显示 `concurrency: 3`
  - **估算**: 10 min
  - **依赖**: 无（独立文件，可与 T001 并行）
  - **是否阻塞其他 task**: 是（T005 CLI 读取 config 时依赖此字段已存在）

**Checkpoint Phase 1**: p-limit 可正常 import，config 字段已就位。Phase 2 可以开始。

---

## Phase 2: Foundational — 核心重构（关键路径，最高优先级）

**目标**：用 `p-limit` 替换 `batch-orchestrator.ts` lines 920-951 的手写信号量，消除 `Promise.race([])` 死锁风险，修改默认值，添加边界规范化。这是整个 Feature 的核心变更。

**⚠️ CRITICAL**: 此 Phase 必须在 Phase 1 完成后执行，且其完成是 Phase 3/4 测试能运行的前提。

- [ ] T003 替换手写信号量为 `p-limit`，改写 `batch-orchestrator.ts` 步骤 4 并发调度段
  - **文件**: `src/batch/batch-orchestrator.ts`（修改）
  - **变更内容**:
    1. 文件顶部添加 `import pLimit from 'p-limit';`
    2. 删除 lines 920-951 的 `pending: Promise<void>[]`、`activeCount` 手写信号量、`Promise.race` 代码（约 30 行）
    3. 替换为 `pLimit` 统一路径（约 7 行）：`const limit = pLimit(concurrency); const tasks = processingOrder.map(m => limit(() => processOneModule(m))); await Promise.allSettled(tasks);`
  - **验收**: `grep -n 'Promise.race\|pending: Promise\|activeCount' src/batch/batch-orchestrator.ts` 输出为空（手写信号量已移除）；`npm run build` 零 TS 错误
  - **估算**: 45 min
  - **依赖**: T001（p-limit 已安装）
  - **是否阻塞其他 task**: 是，关键路径核心
  - ★ CRITICAL PATH

- [ ] T004 修改 `BatchOptions.concurrency` 默认值从 1 到 3，强化 JSDoc 注释，添加边界规范化逻辑
  - **文件**: `src/batch/batch-orchestrator.ts`（修改，接续 T003 的同一文件）
  - **变更内容**:
    1. 更新 `BatchOptions.concurrency` 的 JSDoc 注释，记录默认值变更原因、双层重试语义（FR-016）、9N 放大分析
    2. 在 `runBatch` 函数体 concurrency 读取处添加边界规范化：`Math.floor`、`<= 0 → 1 + logger.warn`
    3. 明确优先级链注释：`CLI flag > spec-driver.config.yaml batch.concurrency > 默认值 3`
    4. 添加 tokenUsage `+=` 操作的 JS 单线程安全性注释（FR-008）
  - **验收**: `npm run build` 零错误；`grep -A30 'concurrency\?' src/batch/batch-orchestrator.ts` 显示更新后 JSDoc；`grep 'Math.floor\|logger.warn' src/batch/batch-orchestrator.ts` 找到规范化代码
  - **估算**: 30 min
  - **依赖**: T003（须在同一文件修改完成后顺序执行）
  - **是否阻塞其他 task**: 是（US1/US2/US5 的正确性依赖此规范化）
  - ★ CRITICAL PATH

**Checkpoint Phase 2**: 核心重构完成。`batch-orchestrator.ts` 已使用 `p-limit`，默认值为 3，边界规范化就位。运行 `npm run build` 确认零错误后继续。

---

## Phase 3: User Story 1 — 一键开启并发加速（Priority: P1）

**Goal**: 用户可通过 CLI `--concurrency=N` flag 或配置文件 `batch.concurrency` 控制并发数，系统以正确并发数运行，总耗时明显低于顺序执行。

**Independent Test**: 运行 `spectra batch --concurrency=5`（或 mock 环境下的等价命令），验证最大同时活跃 LLM 调用数 ≤ 5 且 > 1。

### Implementation for User Story 1

- [ ] T005 [US1] 在 CLI 入口文件新增 `--concurrency=N` flag 解析，建立优先级链
  - **文件**: `src/cli/`（实现阶段确认具体文件路径，可能是 `src/cli/batch-command.ts` 或类似）
  - **变更内容**:
    1. 新增 `--concurrency` 参数解析（支持 `--concurrency=N` 和 `--concurrency N` 两种语法）
    2. 读取 `spec-driver.config.yaml` 的 `batch.concurrency` 字段作为中间层默认值
    3. 将解析结果传入 `BatchOptions.concurrency`，优先级：CLI flag > config > 默认值 3
    4. 非数字输入给出明确错误提示
  - **验收**: `spectra batch --help` 输出包含 `--concurrency`；`spectra batch --concurrency=abc` 报错并退出非零码
  - **估算**: 45 min
  - **依赖**: T002（config 字段已存在），T004（BatchOptions 默认值和规范化已就位）
  - **是否阻塞其他 task**: 否（US1 验证只需 T003/T004 完成，CLI 是额外暴露层）

### Tests for User Story 1

- [ ] T006 [P] [US1] 新建并发 E2E 测试文件，写测试桩（测试用例先行，验证当前状态下测试应失败或通过）
  - **文件**: `tests/e2e/batch-concurrency.e2e.test.ts`（新建）
  - **变更内容**: 参考 tech-research Q6 代码示例，使用 `vi.hoisted()` + `vi.mock('@anthropic-ai/sdk')` 模式，建立 mock 并发计数器基础设施；写以下 4 个测试用例框架（内容在 T007/T008 中填充）：
    - `concurrency=3` 时同时执行不超过 3 个 LLM 调用（SC-003）
    - 单模块失败不阻塞其余模块（SC-004）
    - tokenUsage 并发累加正确（SC-005）
    - 并行加速效果验证（SC-006）
  - **验收**: `npx vitest run tests/e2e/batch-concurrency.e2e.test.ts` 文件可被 vitest 发现并执行（即使测试失败，确认 mock 基础设施无 ESM 解析错误）
  - **估算**: 30 min
  - **依赖**: T001（p-limit 安装），T003（runBatch 已使用 p-limit）
  - **是否阻塞其他 task**: T007、T008 依赖此文件基础设施

- [ ] T007 [US1] 补全 E2E 测试：并发上限严格执行（SC-003）+ 并行加速（SC-006）
  - **文件**: `tests/e2e/batch-concurrency.e2e.test.ts`（修改）
  - **变更内容**:
    1. 并发上限测试：mock LLM 每次调用延迟 20ms，跟踪最大同时调用数，断言 `maxConcurrentCalls <= 3` 且 `> 1`
    2. 并行加速测试：每个模块 mock 延迟 100ms，10 个模块以 `concurrency=3` 运行，断言总耗时 `< 700ms`
    3. fixture 至少 10 个模块（扩展 `tests/fixtures/e2e/small-ts-project/` 或新建 `tests/fixtures/e2e/concurrency-test-project/`，实现阶段确认）
  - **验收**: `npx vitest run tests/e2e/batch-concurrency.e2e.test.ts` 并发上限和加速两个用例通过
  - **估算**: 60 min
  - **依赖**: T006（测试文件基础设施）
  - **是否阻塞其他 task**: 否

**Checkpoint US1**: CLI flag 可用，并发上限生效，加速验证通过。独立可交付的 P1 MVP。

---

## Phase 4: User Story 2 — 单模块失败不阻塞整体（Priority: P1）

**Goal**: 某个模块的 LLM 调用失败后，该模块进入 `BatchResult.failed[]`，其余模块继续处理并进入 `successful[]`，整批不中断。

**Independent Test**: 构造 6 个模块 fixture（1 个必然失败 + 5 个正常），运行 `runBatch()`，断言 `failed.length === 1`、`successful.length === 5`。

### Implementation for User Story 2

> **注**：失败隔离逻辑（FR-006、FR-007）已在 T003 中通过 `p-limit` 封装 + `Promise.allSettled` 实现。本 Phase 主要任务是验证正确性，并确认外层无遗漏 catch 路径。

- [ ] T008 [US2] 验证并强化失败隔离：确认 `p-limit` 封装层 catch 路径完整，必要时补充兜底 catch
  - **文件**: `src/batch/batch-orchestrator.ts`（可能修改）
  - **变更内容**: 检查 T003 写入的 `limit(() => processOneModule(m))` 调用链：若 `processOneModule` 内部已 catch 所有异常，确认无改动需要；若存在边界异常路径，在 `limit` 封装层添加兜底 `catch` 块（参考 tech-research Q4 代码示例）
  - **验收**: `grep -A5 'limit(' src/batch/batch-orchestrator.ts` 显示 try/catch 兜底结构
  - **估算**: 20 min
  - **依赖**: T003（核心重构已完成）
  - **是否阻塞其他 task**: 否

### Tests for User Story 2

- [ ] T009 [US2] 补全 E2E 测试：单模块失败不阻塞（SC-004）
  - **文件**: `tests/e2e/batch-concurrency.e2e.test.ts`（修改 T006 建立的文件）
  - **变更内容**: 实现"1 个必然失败 + 5 个正常模块"场景：`mockCreate` 第 N 次调用抛出 `Error('Network error')`，断言 `result.failed.length === 1`、`result.successful.length === 5`
  - **验收**: `npx vitest run tests/e2e/batch-concurrency.e2e.test.ts` 失败隔离用例通过
  - **估算**: 30 min
  - **依赖**: T006（测试文件），T008（失败隔离实现确认）
  - **是否阻塞其他 task**: 否

**Checkpoint US2**: 并发下失败隔离验证通过，P1 两个核心故事全部完成。

---

## Phase 5: User Story 3 — 并发下进度可视化（Priority: P2）

**Goal**: TTY 终端中运行 batch 时，进度条展示「已完成 / 进行中 / 排队」三维状态；pipe 模式不受影响；`concurrency=1` 顺序模式向后兼容。

**Independent Test**: 在 TTY 环境下运行 `spectra batch --concurrency=3`，观察进度行显示 `进行中: N` 计数（N ≤ 3）。

### Implementation for User Story 3

- [ ] T010 [P] [US3] 修复 `ProgressMode` 类型：新增 `'silent'` 值（FR-012，TD-002 同步修复）
  - **文件**: `src/batch/progress-reporter.ts`（修改）
  - **变更内容**:
    1. `ProgressMode` 类型从 `'tty' | 'pipe'` 扩展为 `'tty' | 'pipe' | 'silent'`
    2. `createReporter` 工厂函数新增 `'silent'` 模式处理：返回所有方法为 no-op 的 reporter（`start`/`stage`/`complete` 不输出，`finish` 返回最小化 `BatchSummary`）
  - **验收**: `npm run build` 零错误；`tests/e2e/batch-pipeline.e2e.test.ts` 中 `progressMode: 'silent'` 不再产生 TS 类型错误
  - **估算**: 25 min
  - **依赖**: 无（独立文件，可与 T008 并行）
  - **是否阻塞其他 task**: T011 依赖此类型修复

- [ ] T011 [US3] 扩展 `renderProgressBar` 支持三维状态，注入 `limit.activeCount`
  - **文件**: `src/batch/progress-reporter.ts`（修改），`src/batch/batch-orchestrator.ts`（修改）
  - **变更内容**:
    1. `renderProgressBar(completed, total)` 签名扩展为 `renderProgressBar(completed, total, active = 0)`：`active > 0` 时渲染 `[bar] X/N | 进行中: Y | 排队: Z`，`active = 0` 时降级为原始二维格式（向后兼容）
    2. 在 `batch-orchestrator.ts` TTY 模式进度渲染处传入 `limit.activeCount`（或通过 `getActiveCount: () => number` getter 注入，具体方式根据代码实际结构决定）
    3. 不修改 `ProgressReporter` 接口签名（FR-011）
  - **验收**: `npm run build` 零错误；手动或单元测试验证 `renderProgressBar(5, 10, 2)` 输出包含 `进行中: 2`
  - **估算**: 40 min
  - **依赖**: T010（`ProgressMode` 类型修复），T003（`limit` 实例在 batch-orchestrator 中可用）
  - **是否阻塞其他 task**: 否

**Checkpoint US3**: TTY 进度三维状态可见，pipe/silent 模式不受影响，P2 进度功能完成。

---

## Phase 6: User Story 4 — 可观测性：Token 累加与耗时准确（Priority: P2）

**Goal**: 并发运行后 `costSummary.totalInputTokens` 与顺序执行数值一致；`BatchResult.duration` 反映真实墙钟耗时（而非各模块耗时之和）。

**Independent Test**: 同一 fixture 分别以 `concurrency=1` 和 `concurrency=3` 运行，比较 `totalInputTokens`——两次数值相同；`durationMs` 在并发模式下明显小于顺序模式。

### Implementation for User Story 4

> **注**：tokenUsage 累加安全性已由 JS 单线程模型保证（tech-research Q3 确认）。`BatchResult.duration` 应已是墙钟耗时（`Date.now()` 在 runBatch 开始和结束各取一次），此 Phase 主要验证现有实现是否正确，并在必要时补充注释。

- [ ] T012 [US4] 验证 `tokenUsage` 累加路径和 `durationMs` 计算方式，补充安全性注释
  - **文件**: `src/batch/batch-orchestrator.ts`（修改注释，可能无逻辑改动）
  - **变更内容**:
    1. 确认 `cumulativeInputTokens +=` 操作在 `await` 之后的同步位置（无读-await-写模式），添加注释：`// JS 单线程保证：此 += 在 await 返回后同步执行，无并发竞态风险（FR-008）`
    2. 确认 `BatchResult.duration` 计算为 `endTime - startTime`（真实墙钟耗时），若不是则修正
  - **验收**: `grep -n 'FR-008\|单线程' src/batch/batch-orchestrator.ts` 找到注释；`npm run build` 零错误
  - **估算**: 20 min
  - **依赖**: T003（核心重构完成）
  - **是否阻塞其他 task**: 否

### Tests for User Story 4

- [ ] T013 [US4] 补全 E2E 测试：tokenUsage 并发累加正确性（SC-005）
  - **文件**: `tests/e2e/batch-concurrency.e2e.test.ts`（修改）
  - **变更内容**: 实现"10 个模块各返回 `input_tokens: 100`，以 `concurrency=3` 运行，断言 `costSummary.totalInputTokens === 1000`（严格相等）"用例
  - **验收**: `npx vitest run tests/e2e/batch-concurrency.e2e.test.ts` tokenUsage 用例通过
  - **估算**: 20 min
  - **依赖**: T006（测试文件），T012（可观测性验证完成）
  - **是否阻塞其他 task**: 否

**Checkpoint US4**: tokenUsage 并发累加验证通过，durationMs 反映墙钟时间，P2 可观测性完成。

---

## Phase 7: User Story 5 — 向后兼容验证（Priority: P1）

**Goal**: F144 现有 E2E 测试 4/4 不回归；现有调用方不传 `concurrency` 时行为等同（或更快，功能输出不变）；`concurrency=1` 顺序路径正确。

**Independent Test**: `npm run test:e2e` 4/4 通过，无失败无超时（SC-007）。

### Implementation for User Story 5

> **注**：F144 E2E 使用 `vi.mock` 模拟 LLM（无真实网络延迟），并发与顺序在 mock 场景下行为等同。此 Phase 主要是运行验证 + 必要时修复。

- [ ] T014 [US5] 运行 F144 E2E 套件，若 `progressMode: 'silent'` 类型错误已修复则无需改动，否则在测试文件中适配
  - **文件**: `tests/e2e/batch-pipeline.e2e.test.ts`（可能修改）
  - **变更内容**: 运行 `npm run test:e2e`，确认 4/4 通过。若发现时序相关失败，在该文件显式传入 `concurrency: 1` 锁定顺序路径；TD-002 已在 T010 修复后 `progressMode: 'silent'` 不再有类型错误
  - **验收**: `npm run test:e2e` 输出 4/4 通过，零失败零超时（SC-007）
  - **估算**: 20 min（运行验证 + 可能的修复）
  - **依赖**: T010（ProgressMode 类型修复），T003/T004（核心重构完成）
  - **是否阻塞其他 task**: 是（T016 回归验收依赖此通过）

### Tests for User Story 5

- [ ] T015 [US5] 新建单元测试：边界规范化逻辑（`concurrency=0/-1/3.7/超出模块数`）
  - **文件**: `tests/batch/`（具体文件实现阶段确认，可能是 `tests/batch/batch-orchestrator.test.ts`）
  - **变更内容**: 新增以下 4 个单元测试用例（mock `processOneModule`，不启动完整 pipeline）：
    - `concurrency=0` → 修正为 1，`logger.warn` 被调用
    - `concurrency=-1` → 修正为 1，`logger.warn` 被调用
    - `concurrency=3.7` → `Math.floor` 后为 3，无 warn
    - `concurrency=50`，3 个模块 → 正常运行不报错（p-limit 内部处理）
  - **验收**: `npx vitest run tests/batch/` 新增 4 个用例全部通过
  - **估算**: 30 min
  - **依赖**: T004（边界规范化逻辑已写入）
  - **是否阻塞其他 task**: 否

**Checkpoint US5**: F144 E2E 4/4 通过，边界规范化单元测试通过，向后兼容确认。

---

## Phase 8: Polish & 回归验收

**目标**：全量回归验证，确保 SC-007/SC-008/SC-009/SC-010 全部满足，清理冗余代码，补充遗漏文档。

- [ ] T016 全量回归验收：运行完整测试套件和构建检查
  - **文件**: 无新改动
  - **执行命令（顺序）**:
    1. `npx vitest run`——确认通过数 ≥ 2268，零失败（SC-008）
    2. `npm run test:e2e`——确认 F144 4/4 通过（SC-007）
    3. `npm run build`——确认 TypeScript 零编译错误（SC-009）
    4. `grep -n 'Promise.race\|pending: Promise<void>\[\]' src/batch/batch-orchestrator.ts`——确认输出为空（SC-010）
  - **验收**: 所有命令零失败零错误；SC-010 grep 无匹配
  - **估算**: 30 min
  - **依赖**: T001 ~ T015 全部完成
  - **是否阻塞其他 task**: 是（此为最终门禁）
  - ★ CRITICAL PATH

- [ ] T017 [P] 检查 `npm run repo:check` 与 `npm run release:check`（仓库同步合规）
  - **文件**: 无改动（仅运行检查）
  - **验收**: 两个命令均无错误输出
  - **估算**: 10 min
  - **依赖**: T016 完成后（或与 T016 并行确认无修改文件冲突）
  - **是否阻塞其他 task**: 否

---

## FR 覆盖映射表

| Functional Requirement | 对应 Task |
|------------------------|-----------|
| FR-001 替换手写信号量为 p-limit | T003 |
| FR-002 边界规范化（≤0 → 1 + warn，非整数 Math.floor） | T004、T015（验证） |
| FR-003 默认值从 1 改为 3，代码注释记录原因 | T004 |
| FR-004 CLI `--concurrency=N` flag | T005 |
| FR-005 配置文件 `batch.concurrency`，CLI 优先级高于 config | T002、T005 |
| FR-006 单模块失败不影响其他模块（p-limit 内 try/catch） | T008 |
| FR-007 `Promise.allSettled` 替代 `Promise.all` | T003 |
| FR-008 tokenUsage 累加并发安全性注释 | T012 |
| FR-009 `BatchResult.duration` 为真实墙钟耗时 | T012 |
| FR-010 TTY 进度三维状态（已完成/进行中/排队） | T011 |
| FR-011 不修改 ProgressReporter 接口签名 | T011 |
| FR-012 ProgressMode 新增 `'silent'`（可选，随本次修复） | T010 |
| FR-013 package.json 新增 p-limit 到 dependencies | T001 |
| FR-014 `runBatch()` 签名向后兼容 | T003、T014（验证） |
| FR-015 `concurrency=1` 顺序路径正确（pLimit(1) 语义等同） | T003（统一 pLimit 路径），T015（验证） |
| FR-016 双层重试语义注释 | T004 |

**FR 覆盖率**: 16/16（100%）

---

## 依赖关系与并行说明

### Phase 依赖

```
Phase 1（T001, T002）→ Phase 2（T003, T004）→ Phase 3-7（可部分并行）→ Phase 8（T016, T017）
```

- **Phase 1**: 无依赖，可立即开始；T001 与 T002 互相独立（[P]）
- **Phase 2**: 依赖 Phase 1 完成（T001 必须先于 T003）；T003 → T004 必须顺序（同一文件）
- **Phase 3-7**: 依赖 Phase 2 完成后开始
- **Phase 8**: 依赖 Phase 3-7 全部完成

### User Story 间依赖

- **US1（T005, T006, T007）**: 可在 Phase 2 完成后立即开始
- **US2（T008, T009）**: 可与 US1 的 T005 并行（T008 不依赖 T005）
- **US3（T010, T011）**: T010 可与 US1/US2 并行（独立文件）；T011 依赖 T010
- **US4（T012, T013）**: T012 可与 US3 并行；T013 依赖 T006（测试文件已建立）
- **US5（T014, T015）**: T014 依赖 T010（ProgressMode 修复）；T015 依赖 T004

### Story 内部并行机会

- T001 ‖ T002（Phase 1 完全并行）
- T006 ‖ T010（测试基础设施 ‖ ProgressMode 修复，不同文件）
- T007、T009、T013 依次填充同一测试文件，可顺序累积或由同一人连续完成
- T016 ‖ T017 可同时发起（T017 无文件改动风险）

### 关键路径（Critical Path）

```
T001 → T003 → T004 → T014（US5 E2E 验证）→ T016（全量回归）
```

最短完成路径约 **2.5 小时**（T001 15min + T003 45min + T004 30min + T014 20min + T016 30min），其余任务可并行分布在此路径上。

---

## 实施策略推荐

### MVP First（单人执行推荐顺序）

1. 完成 Phase 1（T001、T002）——30 min
2. 完成 Phase 2（T003、T004）——75 min
3. 完成 Phase 7 US5（T014、T015）——快速验证向后兼容——50 min
4. **STOP and VALIDATE**：`npm run build` + `npm run test:e2e` 确认 P1 最小可交付
5. 完成 Phase 3 US1（T005、T006、T007）——135 min
6. 完成 Phase 4 US2（T008、T009）——50 min
7. 完成 Phase 5/6 US3/US4（T010-T013）——105 min
8. 完成 Phase 8（T016、T017）——40 min

### 并行团队策略（2 人执行）

- **开发者 A**（关键路径）：T001 → T003 → T004 → T005 → T014 → T016
- **开发者 B**（并行支线）：T002 → T010 → T011 → T006 → T007 → T008 → T009 → T012 → T013 → T015

---

## 备注

- `[P]` 任务 = 不同文件，无依赖，可并行启动
- CLI 入口具体文件路径（`src/cli/` 下）在 implement 阶段确认后填入 T005
- tests/batch/ 下单元测试具体文件在 implement 阶段确认后填入 T015
- fixture 模块数（10 个或扩展）在 implement 阶段根据现有 `tests/fixtures/e2e/small-ts-project/` 情况决定
- T010 的 `'silent'` 修复是 TD-002 的顺带修复，不影响其他 task 的验收
- 每个 task 完成后建议即时运行 `npm run build` 确认零 TS 错误，避免积累类型问题到 T016
