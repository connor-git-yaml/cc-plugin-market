# Tasks: 修复 Batch 单语言非 TS/JS 依赖图选择

**Input**: Design documents from `specs/052-batch-singlelang-graph/`
**Prerequisites**: spec.md, research.md, plan.md

**Tests**: 新增纯 Python 项目 batch 回归集成测试；同时运行 batch-orchestrator 相关单元测试。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Foundational

**Purpose**: 明确 `runBatch()` 的图选择分支，让单语言非 TS/JS 不再误用 TS/JS 空图

- [x] T001 在 `src/batch/batch-orchestrator.ts` 中重排构图时序：先扫描语言，再根据单语言/多语言/TS-JS 路径选择主依赖图
- [x] T002 在 `src/batch/batch-orchestrator.ts` 中为单语言非 TS/JS 场景接入 adapter `buildDependencyGraph()` 与 `buildFallbackGraph()` 兜底逻辑

**Checkpoint**: 单语言非 TS/JS 项目不再固定使用 `buildGraph()` 的结果

---

## Phase 2: User Story 1 - 纯非 TS/JS 项目 batch 可用 (Priority: P1)

**Goal**: 让纯 Python/Go/Java 项目执行 batch 时能得到非空模块集合

**Independent Test**: 在纯 Python 临时项目中预建 spec 后运行 `runBatch()`，验证返回模块数大于 0 且全部走 skip

- [x] T003 [US1] 新增 `tests/integration/batch-singlelang.test.ts`：构造纯 Python 项目并验证 `runBatch()` 返回非空模块集合
- [x] T004 [US1] 在测试中覆盖“预创建 spec -> skip 分支”路径，确保不依赖真实 LLM 调用即可回归验证

**Checkpoint**: 纯 Python batch 回归被自动化测试锁定

---

## Phase 3: User Story 2 - 现有路径不回归 (Priority: P2)

**Goal**: 纯 TS/JS 与多语言逻辑保持兼容

**Independent Test**: 运行现有 `batch-orchestrator` 单元测试与相关集成测试

- [x] T005 [US2] 运行 `tests/unit/batch-orchestrator.test.ts`，确认现有单语言 TS/JS / 多语言断言仍通过
- [x] T006 [US2] 运行 `tests/integration/batch-paths.test.ts`，确认路径基准行为未受影响

---

## Phase 4: Polish & Validation

- [x] T007 运行定向测试：`tests/unit/batch-orchestrator.test.ts` + `tests/integration/batch-singlelang.test.ts` + `tests/integration/batch-paths.test.ts`
- [x] T008 运行 `npm run lint`

## Dependencies & Execution Order

- T001 → T002 是核心实现顺序
- T003/T004 依赖 T001/T002
- T005/T006/T007 依赖实现完成
- T008 最后执行

## Notes

- 本 feature 不新增语言适配器能力，只修复 orchestrator 分支选择
- Python 测试覆盖到位后，Go/Java 共享相同入口逻辑，不必重复添加 3 份近似集成测试
