# Tasks: 架构中间表示（Architecture IR）导出 (Feature 056)

**Input**: Design documents from `/specs/056-architecture-ir-export/`  
**Prerequisites**: `spec.md`, `research.md`, `plan.md`

**Tests**: 需要覆盖 IR builder、Structurizr/JSON exporter、batch 集成、registry 发现与多格式写盘。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `research.md`、`spec.md`、`plan.md`、`tasks.md`
- [x] T002 创建 `src/panoramic/architecture-ir-model.ts`
- [x] T003 [P] 创建 `src/panoramic/architecture-ir-builder.ts`
- [x] T004 [P] 创建 `src/panoramic/architecture-ir-exporters.ts`
- [x] T005 [P] 创建 `src/panoramic/architecture-ir-mermaid-adapter.ts`
- [x] T006 [P] 创建 `templates/architecture-ir.hbs`

## Phase 2: Foundations

- [x] T007 实现 `ArchitectureIR` 共享模型与来源/证据类型
- [x] T008 实现基于 `architecture-overview` 主入口的 IR builder
- [x] T009 实现 Structurizr DSL 与 JSON exporter
- [x] T010 实现 Mermaid 互通适配层
- [x] T011 扩展 multi-format writer 支持额外导出文件

## Phase 3: User Story 1 - 统一导出现有 panoramic 架构事实 (P1)

- [x] T012 [P] [US1] 编写 builder 单测：045/043/040/041 组合输出映射到统一 IR
- [x] T013 [US1] 实现 `ArchitectureIRGenerator.extract()`，组合调用现有 generators
- [x] T014 [US1] 实现 `ArchitectureIRGenerator.generate()`，输出 IR + export bundle
- [x] T015 [US1] 实现 `ArchitectureIRGenerator.render()` 摘要 Markdown

## Phase 4: User Story 2 - 导出 Structurizr DSL 与结构化 JSON (P1)

- [x] T016 [P] [US2] 编写 exporter 单测：JSON / Structurizr DSL 都包含 system context / deployment 所需实体
- [x] T017 [US2] 接入 `generator-registry.ts`、`index.ts` 与 `output-filenames.ts`
- [x] T018 [US2] 在 `batch-project-docs.ts` 中写出 `architecture-ir.dsl`

## Phase 5: User Story 3 - Mermaid / architecture-overview 互通 (P2)

- [x] T019 [P] [US3] 编写 generator / interop 测试：IR 可导出 Mermaid section
- [x] T020 [US3] 在 batch / writer 流程中写出 `architecture-ir.mmd`
- [x] T021 [US3] 更新集成测试：batch 项目级文档套件包含 `architecture-ir.*`

## Phase 6: Verification

- [x] T022 运行 `tests/panoramic/architecture-ir-builder.test.ts`
- [x] T023 [P] 运行 `tests/panoramic/architecture-ir-generator.test.ts`
- [x] T024 [P] 运行 `tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T025 运行相关 registry / writer 回归测试
- [x] T026 运行 `npm run lint`
- [x] T027 运行 `npm run build`
- [x] T028 生成 `verification.md`，记录样例导出与验证证据
