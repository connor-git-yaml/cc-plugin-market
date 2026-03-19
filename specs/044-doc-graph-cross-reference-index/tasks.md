# Tasks: 文档图谱与交叉引用索引 (Feature 044)

**Input**: Design documents from `/specs/044-doc-graph-cross-reference-index/`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖 DocGraphBuilder、CrossReferenceIndex、模板渲染和 batch 集成。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `src/panoramic/doc-graph-builder.ts` 骨架，导出图谱类型和 `buildDocGraph()`
- [x] T002 [P] 创建 `src/panoramic/cross-reference-index.ts` 骨架，导出 `buildCrossReferenceIndex()`
- [x] T003 [P] 创建 `tests/panoramic/doc-graph-builder.test.ts` 和 `tests/panoramic/cross-reference-index.test.ts` 骨架
- [x] T004 [P] 创建 `tests/integration/batch-doc-graph.test.ts` fixture 骨架

## Phase 2: Foundational

- [x] T005 在 `src/models/module-spec.ts` 中新增交叉引用 schema/type
- [x] T006 修改 `templates/module-spec.hbs`，增加稳定 anchor 与“关联 Specs”区块占位
- [x] T007 修改 `src/generator/spec-renderer.ts` 相关 render 测试基线，确保新字段不破坏无交叉引用场景

## Phase 3: User Story 1 - 自动插入关联 Spec 链接 (P1)

- [x] T008 [P] [US1] 编写 `doc-graph-builder` 单测：同模块内部引用被归类为 `same-module`
- [x] T009 [P] [US1] 编写 `doc-graph-builder` 单测：跨模块引用被归类为 `cross-module`
- [x] T010 [P] [US1] 编写 `cross-reference-index` 单测：索引正确转为 `ModuleSpec` 结构
- [x] T011 [P] [US1] 编写 render 单测：Markdown 中出现自链接和跨模块链接
- [x] T012 [US1] 实现 `buildDocGraph()` 的引用分类与 evidence 聚合
- [x] T013 [US1] 实现 `buildCrossReferenceIndex()` 并将结果注入 `ModuleSpec`
- [x] T014 [US1] 完成模板区块渲染与稳定 anchor 输出

## Phase 4: User Story 2 - 构建统一图谱并识别缺口 (P1)

- [x] T015 [P] [US2] 编写单测：`sourceTarget -> specPath` 映射正确
- [x] T016 [P] [US2] 编写单测：missing-spec 节点识别正确
- [x] T017 [P] [US2] 编写单测：unlinked-spec 节点识别正确
- [x] T018 [US2] 实现 on-disk spec metadata 读取与 linked/unlinked 判定
- [x] T019 [US2] 完成缺口节点建模与 JSON serializable 输出

## Phase 5: User Story 3 - batch 集成与调试输出 (P2)

- [x] T020 [P] [US3] 编写 batch 集成测试：输出目录中生成 doc-graph JSON
- [x] T021 [P] [US3] 编写 batch 集成测试：生成的 spec 自动带交叉引用区块
- [x] T022 [US3] 在 `src/batch/batch-orchestrator.ts` 中接入 044：构图、注入、重渲染、写 JSON

## Phase 6: Polish & Validation

- [x] T023 运行定向测试：`tests/panoramic/doc-graph-builder.test.ts`
- [x] T024 [P] 运行定向测试：`tests/panoramic/cross-reference-index.test.ts`
- [x] T025 [P] 运行定向测试：`tests/integration/batch-doc-graph.test.ts`
- [x] T026 [P] 运行现有 render/index/orchestrator 相关测试
- [x] T027 运行 `npm run lint`
- [x] T028 运行 `npm run build`
