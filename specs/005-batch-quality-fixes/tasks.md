# Tasks: Batch 模块级聚合与生成质量提升

**Input**: Design documents from `/specs/005-batch-quality-fixes/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: 包含构建和测试验证任务（代码已完成，验证通过即可）。

**Organization**: 按用户故事分组。由于代码已完成，任务聚焦于将 005 contracts 的变更同步回 001 的对应文档，并验证实现与文档一致。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件，无依赖关系）
- **[Story]**: 任务所属的用户故事（US1, US2, US3）

---

## Phase 1: Setup (验证基础)

**Purpose**: 确认代码状态正确，所有测试通过

- [x] T001 运行 `npm run build` 确认 TypeScript 编译通过
- [x] T002 运行 `npm test` 确认所有测试通过（含 `module-grouper.test.ts` 和 `llm-client.test.ts`）

---

## Phase 2: Foundational (同步 001 contracts)

**Purpose**: 将 005 contracts 的增量变更合并入 001 的对应文档，这是所有用户故事文档同步的前置条件

**⚠️ CRITICAL**: 每个 contract 更新必须保留 001 原有内容，仅追加/修改漂移部分

- [x] T003 [P] 更新 `specs/001-reverse-spec-v2/contracts/batch-module.md`：
  - 新增 `module-grouper` 章节（含 `groupFilesToModules` API、`ModuleGroup`、`ModuleGroupResult`、`GroupingOptions` 类型定义）
  - 更新 `batch-orchestrator` 章节：`BatchOptions` 新增 `grouping` 字段；行为描述从文件级改为模块级聚合；`generateIndex()` 参数更新
  - 参考 `specs/005-batch-quality-fixes/contracts/batch-module.md`

- [x] T004 [P] 更新 `specs/001-reverse-spec-v2/contracts/graph-module.md`：
  - 在 `buildGraph` 行为描述中新增 `process.chdir()` + `finally` 恢复 cwd 的说明
  - 新增 dependency-cruiser v16.x 异步 API 兼容说明（`instanceof Promise` 检测）
  - 新增空结果防护行为（返回空 `DependencyGraph`）
  - 在错误列表中补充 cruise 返回空 output 的场景
  - 参考 `specs/005-batch-quality-fixes/contracts/graph-module.md`

- [x] T005 [P] 更新 `specs/001-reverse-spec-v2/contracts/llm-client.md`：
  - 更新 `parseLLMResponse` 章节：章节标题匹配从单标题扩展为多变体容错；缺失章节占位文本更新
  - 更新 `buildSystemPrompt` 章节：`spec-generation` 模式的提示词内容大幅扩展
  - 新增完整的 `SECTION_TITLES` 映射表
  - 参考 `specs/005-batch-quality-fixes/contracts/llm-client.md`

- [x] T006 [P] 更新 `specs/001-reverse-spec-v2/contracts/core-pipeline.md`：
  - 更新 `GenerateSpecResult` 类型定义：新增 `moduleSpec: ModuleSpec` 字段
  - 更新流水线步骤 8：新增 `generateDependencyDiagram()` 调用
  - 新增 `fileInventory` 路径从绝对路径改为相对路径的说明
  - 参考 `specs/005-batch-quality-fixes/contracts/core-pipeline.md`

- [x] T007 [P] 更新 `specs/001-reverse-spec-v2/contracts/generator.md`：
  - 新增 `mermaid-dependency-graph` 章节（含 `generateDependencyDiagram` API）
  - 参考 `specs/005-batch-quality-fixes/contracts/generator.md`

**Checkpoint**: 001 的所有 5 个 contracts 已与代码同步

---

## Phase 3: User Story 1 - 按模块级聚合生成 batch spec (Priority: P1) 🎯 MVP

**Goal**: 验证模块级聚合的文档与代码实现一致

**Independent Test**: 对比 `src/batch/module-grouper.ts` 和 `src/batch/batch-orchestrator.ts` 的实际代码与更新后的 `batch-module.md` 契约描述

### 实现 for User Story 1

- [x] T008 [US1] 验证 `src/batch/module-grouper.ts` 的导出 API 与 `batch-module.md` 中 `groupFilesToModules` 的签名、参数、返回类型完全一致
- [x] T009 [US1] 验证 `src/batch/batch-orchestrator.ts` 的 `runBatch` 行为与更新后的 `batch-module.md` 描述一致（模块级处理、root 模块特殊逻辑、`collectedModuleSpecs` 收集）
- [x] T010 [US1] 验证 `tests/unit/module-grouper.test.ts` 覆盖 `groupFilesToModules` 的核心场景（分组规则、拓扑排序、空输入）

**Checkpoint**: US1 文档与代码实现一致

---

## Phase 4: User Story 2 - 提升 spec 生成质量 (Priority: P2)

**Goal**: 验证 LLM 系统提示词增强和章节匹配容错的文档与代码一致

**Independent Test**: 对比 `src/core/llm-client.ts` 实际代码与更新后的 `llm-client.md` 契约描述

### 实现 for User Story 2

- [x] T011 [P] [US2] 验证 `src/core/llm-client.ts` 中 `SECTION_TITLES` 映射与 `llm-client.md` 中的完整映射表一致
- [x] T012 [P] [US2] 验证 `src/core/llm-client.ts` 中 `buildSystemPrompt('spec-generation')` 的实际内容与 `llm-client.md` 中的行为描述一致
- [x] T013 [US2] 验证 `src/core/single-spec-orchestrator.ts` 中 `generateSpec` 的返回类型包含 `moduleSpec` 字段，且 `mermaidDiagrams` 包含依赖图
- [x] T014 [US2] 验证 `src/generator/mermaid-dependency-graph.ts` 的导出 API 与 `generator.md` 中 `generateDependencyDiagram` 的签名一致

**Checkpoint**: US2 文档与代码实现一致

---

## Phase 5: User Story 3 - dependency-cruiser 兼容性修复 (Priority: P3)

**Goal**: 验证 dependency-graph 修复的文档与代码一致

**Independent Test**: 对比 `src/graph/dependency-graph.ts` 实际代码与更新后的 `graph-module.md` 契约描述

### 实现 for User Story 3

- [x] T015 [US3] 验证 `src/graph/dependency-graph.ts` 中 `buildGraph` 的 chdir + finally 逻辑与 `graph-module.md` 描述一致
- [x] T016 [US3] 验证 `src/graph/dependency-graph.ts` 中 `instanceof Promise` 异步兼容逻辑与 `graph-module.md` 描述一致
- [x] T017 [US3] 验证 `src/graph/dependency-graph.ts` 中空结果防护返回的 DependencyGraph 结构与 `graph-module.md` 描述一致

**Checkpoint**: US3 文档与代码实现一致

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 最终验证和清理

- [x] T018 运行 `quickstart.md` 中的 6 步验证流程，确认所有验证点通过
- [x] T019 更新 `CLAUDE.md` 的 Recent Changes 章节，记录 005-batch-quality-fixes 的变更

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 — 可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 通过 — 阻塞所有用户故事
- **US1 (Phase 3)**: 依赖 Phase 2 中 T003 完成
- **US2 (Phase 4)**: 依赖 Phase 2 中 T005、T006、T007 完成
- **US3 (Phase 5)**: 依赖 Phase 2 中 T004 完成
- **Polish (Phase 6)**: 依赖 Phase 3 + Phase 4 + Phase 5 完成

### User Story Dependencies

- **User Story 1 (P1)**: 仅依赖 T003（batch-module 契约更新）— 与 US2/US3 无依赖
- **User Story 2 (P2)**: 依赖 T005、T006、T007（llm-client、core-pipeline、generator 契约更新）— 与 US1/US3 无依赖
- **User Story 3 (P3)**: 仅依赖 T004（graph-module 契约更新）— 与 US1/US2 无依赖

### Within Each User Story

- 契约更新（Phase 2）必须在验证（Phase 3-5）之前完成
- 验证任务标记 [P] 的可以并行执行

### Parallel Opportunities

**Phase 2 内部并行**：

```text
T003 (batch-module) ‖ T004 (graph-module) ‖ T005 (llm-client) ‖ T006 (core-pipeline) ‖ T007 (generator)
```

**Phase 3/4/5 跨用户故事并行**：

```text
US1 (T008-T010) ‖ US2 (T011-T014) ‖ US3 (T015-T017)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: 构建和测试验证
2. 完成 Phase 2: T003（batch-module 契约更新）
3. 完成 Phase 3: US1 验证
4. **STOP and VALIDATE**: 确认 batch 模块级聚合的文档与代码一致

### Incremental Delivery

1. Phase 1 + 2 → 所有 001 contracts 与代码同步
2. Phase 3 (US1) → batch 模块聚合文档验证完成
3. Phase 4 (US2) → spec 生成质量文档验证完成
4. Phase 5 (US3) → dependency-graph 修复文档验证完成
5. Phase 6 → 全面验证和 CLAUDE.md 更新

---

## Summary

| 指标 | 值 |
| ------ | ----- |
| 总任务数 | 19 |
| Phase 1 (Setup) | 2 |
| Phase 2 (Foundational) | 5 |
| Phase 3 (US1) | 3 |
| Phase 4 (US2) | 4 |
| Phase 5 (US3) | 3 |
| Phase 6 (Polish) | 2 |
| 可并行任务 | 12 (标记 [P] 或跨 US 并行) |
| 修改文件 | 5 个 001 contracts + CLAUDE.md |
| 新增文件 | 0 |
| MVP 范围 | Phase 1-3 (10 tasks) |

## Notes

- 本特性为追溯记录，所有代码已完成（提交 4a58c04..fcfddc9）
- Phase 2 的核心工作是将 005 contracts 中的增量变更合并入 001 的对应文档
- Phase 3-5 的验证任务确保合并后的文档与实际代码完全一致
- [P] 任务 = 不同文件，无互相依赖
- [Story] 标签将任务映射到具体用户故事
- 每个用户故事的验证可独立完成
