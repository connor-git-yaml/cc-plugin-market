# Tasks: Batch 全景项目文档套件与架构叙事输出 (Feature 053)

**Input**: Design documents from `/specs/053-panoramic-batch-doc-suite/`
**Prerequisites**: `spec.md`, `research.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖 batch 项目级文档输出、架构叙事输出、增量模式兼容，以及相关 CLI 摘要。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `research.md`、`research/tech-research.md`、`plan.md`、`data-model.md`
- [x] T002 创建 `src/panoramic/output-filenames.ts`
- [x] T003 [P] 创建 `templates/architecture-narrative.hbs`
- [x] T004 [P] 创建 `tests/panoramic/architecture-narrative.test.ts`
- [x] T005 [P] 创建 `tests/integration/batch-panoramic-doc-suite.test.ts`

## Phase 2: Foundations

- [x] T006 实现共享输出文件名映射，并让 `coverage-auditor` 复用该映射
- [x] T007 实现 batch 项目级文档编排 helper，统一发现 generators 并写出 `md/json/mmd`
- [x] T008 扩展 `BatchResult` / batch CLI 输出，使项目级文档摘要可见

## Phase 3: User Story 1 - Batch 自动产出项目级全景文档 (P1)

- [x] T009 [P] [US1] 编写集成测试：适用 generator 自动写出文档文件
- [x] T010 [US1] 在 `runBatch()` 中接入 project-level panoramic generation
- [x] T011 [US1] 统一 generator 输出命名，确保 batch 与 coverage audit 一致

## Phase 4: User Story 2 - 架构叙事文档 (P1)

- [x] T012 [P] [US2] 编写单测：从 module spec / baseline skeleton 提炼关键模块、类、方法
- [x] T013 [P] [US2] 编写集成测试：单包项目也能生成 `architecture-narrative`
- [x] T014 [US2] 实现 `architecture-narrative` 模型与渲染模板
- [x] T015 [US2] 在 batch 项目级输出阶段写出 `architecture-narrative.md/.json`

## Phase 5: User Story 3 - 覆盖率与输出口径一致 (P2)

- [x] T016 [P] [US3] 编写集成测试：coverage report 中 applicable generators 的 generatedCount 与文件存在情况一致
- [x] T017 [US3] 确保 `coverage-auditor` 与 batch 使用同一输出命名映射
- [x] T018 [US3] 更新 CLI batch 完成提示，显示项目级输出摘要

## Phase 6: Incremental Compatibility & Validation

- [x] T019 编写/更新测试：`--incremental` 模式下仍生成完整项目级文档
- [x] T020 运行 `tests/panoramic/architecture-narrative.test.ts`
- [x] T021 [P] 运行 `tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T022 [P] 运行相关 `batch-incremental` / `batch-coverage-report` 回归测试
- [x] T023 运行 `npm run lint`
- [x] T024 运行 `npm run build`
