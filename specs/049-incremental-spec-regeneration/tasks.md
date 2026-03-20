# Tasks: 增量差量 Spec 重生成 (Feature 049)

**Input**: Design documents from `/specs/049-incremental-spec-regeneration/`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖 DeltaRegenerator、batch 增量跳过/级联重生成、CLI 参数透传。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `src/batch/delta-regenerator.ts`
- [x] T002 [P] 创建 `templates/delta-report.hbs`
- [x] T003 [P] 创建 `tests/panoramic/delta-regenerator.test.ts`
- [x] T004 [P] 创建 `tests/integration/batch-incremental.test.ts`

## Phase 2: Foundations

- [x] T005 扩展既有 spec 扫描，新增 `StoredModuleSpecSummary`
- [x] T006 扩展 `src/generator/index-generator.ts` 使其可消费“本次生成 spec + 旧 spec 摘要”
- [x] T007 扩展 batch 接口类型，补充 `incremental` / `deltaReportPath` 调度契约

## Phase 3: User Story 1 - 仅重生成直接受影响 spec (P1)

- [x] T008 [P] [US1] 编写单测：skeleton hash 未变化时返回 unchanged
- [x] T009 [P] [US1] 编写单测：缺失旧 spec / 缺失 skeletonHash 时命中 direct change
- [x] T010 [US1] 实现 sourceTarget 粒度的直接变化检测
- [x] T011 [US1] 在 batch 中接入 `--incremental`，跳过未受影响 module spec

## Phase 4: User Story 2 - 依赖方级联重生成 (P1)

- [x] T012 [P] [US2] 编写单测：反向依赖传播命中依赖方
- [x] T013 [P] [US2] 编写集成测试：修改被依赖模块时依赖方被一起重生成、无关模块不变
- [x] T014 [US2] 实现 dependency graph 反向传播 + doc graph owner resolution
- [x] T015 [US2] 处理 root 散文件 sourceTarget 的文件级判断

## Phase 5: User Story 3 - 差量报告与 CLI 集成 (P2)

- [x] T016 [P] [US3] 编写单测：delta report 正确列出 direct / propagated / unchanged
- [x] T017 [P] [US3] 编写 CLI runner 测试：batch 输出 delta report 路径
- [x] T018 [US3] 输出 `_delta-report.md` 与 `_delta-report.json`
- [x] T019 [US3] 在 CLI 参数解析与帮助文本中加入 `--incremental`

## Phase 6: Polish & Validation

- [x] T020 运行 `tests/panoramic/delta-regenerator.test.ts`
- [x] T021 [P] 运行 `tests/integration/batch-incremental.test.ts`
- [x] T022 [P] 运行 `tests/unit/cli-commands.test.ts` 与 `tests/unit/cli-command-runners.test.ts`
- [x] T023 运行相关 044/046 回归测试
- [x] T024 运行 `npm run lint`
- [x] T025 运行 `npm run build`
