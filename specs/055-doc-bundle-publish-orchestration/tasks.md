# Tasks: 文档 Bundle 与发布编排 (Feature 055)

**Input**: Design documents from `/specs/055-doc-bundle-publish-orchestration/`
**Prerequisites**: `spec.md`, `research.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖 manifest/profile 计算、batch 集成、导航顺序、缺失文档降级，以及 CLI 摘要不回归。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `plan.md`、`data-model.md`、`contracts/docs-bundle-output.md`、`quickstart.md`
- [x] T002 创建 `src/panoramic/docs-bundle-types.ts`
- [x] T003 [P] 创建 `src/panoramic/docs-bundle-profiles.ts`
- [x] T004 [P] 创建 `templates/docs-bundle-index.hbs`
- [x] T005 [P] 创建 `tests/panoramic/docs-bundle-orchestrator.test.ts`
- [x] T006 [P] 创建 `tests/integration/batch-doc-bundle-orchestration.test.ts`

## Phase 2: Foundations

- [x] T007 实现 bundle 共享类型、manifest 结构与 profile 摘要模型
- [x] T008 实现固定的 4 个 bundle profile 定义与阅读路径顺序
- [x] T009 实现源文档清单归一化 helper，统一接入 project docs、`_index.spec.md` 与 module specs
- [x] T010 实现 bundle landing page 渲染 helper
- [x] T011 实现 MkDocs / TechDocs 兼容 skeleton writer（`docs-bundle.yaml`、`mkdocs.yml`、`docs/`）
- [x] T012 扩展 `BatchResult` / CLI 摘要的数据合同，为 bundle manifest 和 profile 信息留出输出口

## Phase 3: User Story 1 - Batch 自动产出 docs bundle (P1)

- [x] T013 [P] [US1] 编写集成测试：`runBatch()` 结束后自动写出 `docs-bundle.yaml`
- [x] T014 [P] [US1] 编写单测：manifest 包含 4 个固定 profile 与源文档映射
- [x] T015 [US1] 实现 `DocsBundleOrchestrator` 主流程
- [x] T016 [US1] 在 `runBatch()` 中接入 docs bundle 编排
- [x] T017 [US1] 让 `BatchResult` 返回 manifest 路径、profile 根目录与摘要

## Phase 4: User Story 2 - 导航顺序体现阅读路径 (P1)

- [x] T018 [P] [US2] 编写单测：`developer-onboarding` 导航顺序固定为阅读路径，而非文件名排序
- [x] T019 [P] [US2] 编写集成测试：bundle `index.md` 与 `mkdocs.yml` 的顺序一致
- [x] T020 [US2] 实现 profile 导航构建逻辑
- [x] T021 [US2] 实现 landing page 自动目录与 next-step 提示
- [x] T022 [US2] 处理缺失文档时的稳定排序与 warning 记录

## Phase 5: User Story 3 - MkDocs / TechDocs 兼容输出骨架 (P1)

- [x] T023 [P] [US3] 编写集成测试：profile 目录包含 `mkdocs.yml`、`docs/index.md` 与文档副本
- [x] T024 [P] [US3] 编写单测：`mkdocs.yml` 的 nav 输出与 manifest 一致
- [x] T025 [US3] 实现每个 profile 的目录落盘与文档复制
- [x] T026 [US3] 实现 `docs-bundle.yaml` 写出与 profile 汇总
- [x] T027 [US3] 更新 CLI batch 完成提示，显示 bundle manifest 和 profile 摘要

## Phase 6: User Story 4 - 四种 profile 的选文逻辑明确区分 (P2)

- [x] T028 [P] [US4] 编写单测：`developer-onboarding` / `architecture-review` 包含 module specs
- [x] T029 [P] [US4] 编写单测：`api-consumer` / `ops-handover` 具有不同核心文档与顺序
- [x] T030 [US4] 实现 profile 选文规则与模块 spec 分组逻辑
- [x] T031 [US4] 保证 profile 仅消费现有 batch 输出，不重新生成事实

## Phase 7: User Story 5 - 现有 batch 输出不回归 (P2)

- [x] T032 [P] [US5] 更新现有集成测试：053 项目级文档套件仍保持可用
- [x] T033 [P] [US5] 更新 CLI runner 测试：已有摘要输出不回归
- [x] T034 [US5] 验证相对 `outputDir`、非默认 specs 目录与 incremental 模式兼容

## Phase 8: Verification

- [x] T035 运行 `tests/panoramic/docs-bundle-orchestrator.test.ts`
- [x] T036 [P] 运行 `tests/integration/batch-doc-bundle-orchestration.test.ts`
- [x] T037 [P] 运行 `tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T038 [P] 运行 `tests/unit/cli-command-runners.test.ts`
- [x] T039 运行 `npm run lint`
- [x] T040 运行 `npm run build`
- [x] T041 可行时对 `claude-agent-sdk-python` 做一次准真实 bundle 验证
- [x] T042 在 `verification/verification-report.md` 记录结果、风险与未完成项
