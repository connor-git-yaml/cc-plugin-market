# Tasks: 批量 Spec 生成体验优化

**Input**: Design documents from `/specs/006-batch-progress-timeout/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational (Shared Types)

**Purpose**: 新增所有 User Story 共用的类型定义，为后续阶段提供基础

- [x] T001 [P] 在 `src/models/module-spec.ts` 中新增 `StageId`、`StageProgress`、`StageProgressCallback` 类型定义（参见 data-model.md）
- [x] T002 [P] 在 `src/core/llm-client.ts` 中新增 `RetryEvent`、`RetryCallback` 类型定义（参见 data-model.md）

**Checkpoint**: 类型定义就绪，`npm run build` 通过

---

## Phase 2: User Story 2 - 大模块快速失败 (Priority: P1) 🎯 MVP

**Goal**: 修复 CLI 代理路径的错误包装 Bug，优化超时重试策略，确保大模块在 5 分钟内出结果（含降级）

**Independent Test**: 对超大模块执行 spec 生成，验证：(1) 不再报 failed 而是 degraded；(2) 总耗时显著低于 18 分钟

### Implementation for User Story 2

- [x] T003 [US2] **Bug 修复**: 在 `src/core/llm-client.ts` 的 `callLLMviaCliProxy` 函数末尾（约第 289 行），将 `throw lastError` 修改为 `throw new LLMUnavailableError(...)` 以统一两条调用路径的错误包装（参见 contracts/timeout-strategy.md "Bug 修复"章节）
- [x] T004 [US2] 在 `src/core/llm-client.ts` 的 `callLLMviaSdk` 重试循环中（约第 197-248 行），添加超时快速失败逻辑：当错误为 `LLMTimeoutError` 且 `attempt >= 1` 时提前跳出循环（超时类错误最多 2 次尝试），其他可重试错误保持 3 次尝试不变
- [x] T005 [US2] 在 `src/core/llm-client.ts` 的 `callLLMviaCliProxy` 重试循环中（约第 270-287 行），添加相同的超时快速失败逻辑：当 `lastError instanceof LLMTimeoutError && attempt >= 1` 时提前跳出循环
- [x] T006 [US2] 在 `src/core/llm-client.ts` 中修改 `callLLM` 函数签名，新增可选参数 `onRetry?: RetryCallback`，并将其传递到 `callLLMviaSdk` 和 `callLLMviaCliProxy`。在两个函数的重试循环中，每次即将 `sleep()` 退避前触发 `onRetry` 回调（参见 contracts/timeout-strategy.md "onRetry 回调集成"章节）

**Checkpoint**: `callLLM` 超时快速失败生效 + CLI 代理错误包装与 SDK 一致 → `generateSpec` 中的 `LLMUnavailableError` 降级逻辑对两条路径均有效，`npm test` 通过

---

## Phase 3: User Story 1 - 模块处理过程实时进度可见 (Priority: P1)

**Goal**: 在模块处理的 6 个关键阶段输出进度信息，让用户看到实时处理状态

**Independent Test**: 执行 batch 生成，观察终端输出中每个模块至少有 4 条阶段进度行（→ 开始 / ✓ 完成）

### Implementation for User Story 1

- [x] T007 [US1] 在 `src/batch/progress-reporter.ts` 中扩展 `ProgressReporter` 接口，新增 `stage(modulePath: string, progress: StageProgress): void` 方法，并在 `createReporter` 中实现终端输出逻辑：`duration` 为 undefined 时输出 `"  → {message}"`，有值时输出 `"  ✓ {stage}完成 ({duration}ms)"`（参见 contracts/progress-reporter.md）
- [x] T008 [US1] 在 `src/core/single-spec-orchestrator.ts` 中扩展 `GenerateSpecOptions` 接口，新增 `onStageProgress?: StageProgressCallback` 可选字段
- [x] T009 [US1] 在 `src/core/single-spec-orchestrator.ts` 的 `prepareContext` 函数中注入进度回调：在 `scanFiles` 前后触发 `scan` 阶段事件，在 `analyzeFiles` 前后触发 `ast` 阶段事件（含文件数量上下文），在 `assembleContext` 前后触发 `context` 阶段事件（含 token 数警告：当 `context.tokenCount > 80_000`——即 100,000 预算的 80%——时输出 ⚠ 警告，FR-007）。当 `filePaths.length === 1` 时跳过 `scan` 阶段的独立进度行，直接从 `ast` 阶段开始报告
- [x] T010 [US1] 在 `src/core/single-spec-orchestrator.ts` 的 `generateSpec` 函数主体中注入进度回调：在 `callLLM` 前后触发 `llm` 阶段事件，在 `parseLLMResponse` 前后触发 `parse` 阶段事件，在 `renderSpec` + 文件写入前后触发 `render` 阶段事件。同时将 `onRetry` 回调（转换为阶段进度格式）传递给 `callLLM` 的第三个参数
- [x] T011 [US1] 在 `src/batch/batch-orchestrator.ts` 中修改 `genOptions` 构建逻辑（约第 144-148 行），传入 `onStageProgress: (progress) => reporter.stage(moduleName, progress)` 回调，将模块内阶段进度连线到终端报告器

**Checkpoint**: 执行 batch 生成，每个模块处理过程中终端输出 6 个阶段的开始/完成信息，重试时显示次数和原因，`npm test` 通过

---

## Phase 4: User Story 3 - 进度条反映真实处理进度 (Priority: P2)

**Goal**: 进度条在模块处理中途有中间状态更新，而非仅在模块完成时跳变

**Independent Test**: 观察 batch 处理时进度条在 LLM 调用前（AST 分析完成后）是否有视觉反馈

### Implementation for User Story 3

- [x] T012 [US3] 在 `src/cli/commands/batch.ts` 中修改 `onProgress` 回调（约第 24-28 行），支持接收子阶段完成事件。具体连线方式：在 `src/batch/batch-orchestrator.ts` 的 `onStageProgress` 回调中，当 `context` 阶段完成时（即 LLM 调用前），调用 `options.onProgress?.(completed + 0.5, total)` 触发进度条的半步更新；`batch.ts` 中的 `onProgress` 回调已能处理浮点数的 completed 值

**Checkpoint**: 进度条在模块处理过程中有中间态更新

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 验证、测试和清理

- [x] T013 运行 `npm test` 确保所有现有测试通过，无回归
- [x] T014 运行 `npm run lint` 确保代码风格一致
- [x] T015 执行 quickstart.md 中的验证步骤，确认端到端行为符合预期

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: 无依赖 — 立即开始
- **US2 (Phase 2)**: 依赖 Phase 1 中的 T002（RetryEvent 类型）
- **US1 (Phase 3)**: 依赖 Phase 1 中的 T001（StageProgress 类型）和 Phase 2 中的 T006（onRetry 回调）
- **US3 (Phase 4)**: 依赖 Phase 3 完成（进度条更新依赖阶段回调机制就绪）
- **Polish (Phase 5)**: 依赖所有 User Story 完成

### User Story Dependencies

- **User Story 2 (P1)**: 依赖 Phase 1 → 可独立于 US1 实现和测试
- **User Story 1 (P1)**: 依赖 Phase 1 + US2 的 T006（onRetry 回调） → 需要 US2 先完成
- **User Story 3 (P2)**: 依赖 US1 完成 → 需要 US1 先完成

### Within Each User Story

- US2: T003 → T004/T005（可并行，不同函数） → T006
- US1: T007/T008（可并行，不同文件） → T009 → T010 → T011
- US3: T012（单任务）

### Parallel Opportunities

- Phase 1 的 T001 和 T002 可并行（不同文件）
- Phase 2 的 T004 和 T005 可并行（同一文件但不同函数，需谨慎）
- Phase 3 的 T007 和 T008 可并行（不同文件）

---

## Parallel Example: Phase 1

```bash
# 两个类型定义任务可并行（不同文件）：
Task: "T001 在 src/models/module-spec.ts 中新增 StageProgress 类型"
Task: "T002 在 src/core/llm-client.ts 中新增 RetryEvent 类型"
```

## Parallel Example: User Story 1

```bash
# 接口扩展可并行（不同文件）：
Task: "T007 在 progress-reporter.ts 中新增 stage() 方法"
Task: "T008 在 single-spec-orchestrator.ts 中扩展 GenerateSpecOptions"
```

---

## Implementation Strategy

### MVP First (User Story 2 Only)

1. 完成 Phase 1: Foundational Types
2. 完成 Phase 2: US2 — Bug 修复 + 超时快速失败
3. **验证**: 大模块不再报 failed，而是 degraded，耗时 < 5 分钟
4. 可直接部署，解决用户最痛的"总是失败"问题

### Incremental Delivery

1. Phase 1 + Phase 2 → US2 就绪 → 验证/部署（修复核心 Bug）
2. + Phase 3 → US1 就绪 → 验证/部署（进度可见性大幅提升）
3. + Phase 4 → US3 就绪 → 验证/部署（进度条细化）
4. Phase 5 → 完整验证和清理

---

## Notes

- 所有新增参数均为可选（`?:`），不影响现有调用方
- US2 的 Bug 修复（T003）是最关键的单个任务——它修复了 CLI 代理用户完全无法降级的问题
- US1 的 6 个阶段回调需要在 `prepareContext` 和 `generateSpec` 两个函数中分别注入
- 进度信息使用中文，代码标识符保持英文（遵循 Constitution VI）
