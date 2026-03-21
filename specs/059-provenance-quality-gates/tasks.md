# Tasks: Provenance 与文档质量门

**Input**: Design documents from `/specs/059-provenance-quality-gates/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本 Feature 明确要求覆盖 provenance 聚合、冲突检测、required-doc 规则、batch 集成与降级行为，并通过 `npm run lint`、`npm run build` 与 `npm test`。

**Organization**: 任务按共享基础设施、User Story 和验证阶段分组，确保每个故事可独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US4）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 为 059 建立共享模型、模板、fixture 和测试骨架。

- [ ] T001 创建 `src/panoramic/docs-quality-model.ts` 骨架，定义 provenance / conflict / required-doc / report 共享类型
- [ ] T002 [P] 创建 `src/panoramic/docs-quality-evaluator.ts` 骨架
- [ ] T003 [P] 创建 `src/panoramic/narrative-provenance-adapter.ts` 骨架
- [ ] T004 [P] 创建 `src/panoramic/docs-bundle-manifest-reader.ts` 骨架
- [ ] T005 [P] 创建 `templates/quality-report.hbs`
- [ ] T006 [P] 创建 `tests/panoramic/docs-quality-evaluator.test.ts` 测试骨架
- [ ] T007 [P] 创建 `tests/panoramic/narrative-provenance-adapter.test.ts` 测试骨架
- [ ] T008 [P] 创建 `tests/panoramic/docs-bundle-manifest-reader.test.ts` 测试骨架
- [ ] T009 [P] 创建 `tests/panoramic/fixtures/quality/` 冲突与 required-doc fixture 骨架

**Checkpoint**: 059 的文件落点、模板和测试入口已稳定，可进入共享基础实现。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 实现 059 的共享质量模型、输入归一化和 optional manifest 读取能力，阻塞后续所有 User Story。

- [ ] T010 在 `src/panoramic/docs-quality-model.ts` 中实现 `ProvenanceEntry`、`DocumentProvenanceRecord`、`ConflictRecord`、`RequiredDocRule`、`DocsQualityReport`
- [ ] T011 [P] 在 `src/panoramic/docs-quality-model.ts` 中实现 `pass | warn | fail | partial` 状态、coverage stats 与 dependency warning 结构
- [ ] T012 [P] 在 `src/panoramic/docs-quality-evaluator.ts` 中实现 explanation outputs 输入归一化接口，兼容 045/050/057/058 现有 shared models
- [ ] T013 [P] 在 `src/panoramic/narrative-provenance-adapter.ts` 中实现 `architecture-narrative` 到 section-level provenance record 的基础映射
- [ ] T014 [P] 在 `src/panoramic/docs-bundle-manifest-reader.ts` 中实现 `docs-bundle.yaml` 检测、轻量解析与 warning 返回协议
- [ ] T015 [P] 对齐 `specs/059-provenance-quality-gates/data-model.md` 与 `specs/059-provenance-quality-gates/contracts/provenance-quality-output.md` 的字段命名和降级语义

**Checkpoint**: 059 已具备稳定的共享模型、输入适配和 manifest reader，User Story 可以开始实现。

---

## Phase 3: User Story 1 - 为 explanation 型文档补来源追踪与可信度 (Priority: P1) 🎯 MVP

**Goal**: 让 `architecture-narrative`、`component-view`、`dynamic-scenarios`、ADR 等 explanation 文档拥有可消费的 provenance、confidence 和 inferred 语义。

**Independent Test**: 使用已有 045/050/057/058 fixture 运行 provenance adapter / evaluator，验证至少一种 explanation 文档能输出 document 或 section 级 provenance records。

### Tests for User Story 1

- [ ] T016 [P] [US1] 编写 `tests/panoramic/narrative-provenance-adapter.test.ts`，覆盖 executive summary、observations、key modules 的 provenance 映射
- [ ] T017 [P] [US1] 编写 `tests/panoramic/docs-quality-evaluator.test.ts`，覆盖 `component-view`、`dynamic-scenarios`、ADR 的 provenance 聚合
- [ ] T018 [P] [US1] 编写渲染测试，验证 `quality-report.md` 包含 provenance coverage、source types、confidence 和 inferred 标记

### Implementation for User Story 1

- [ ] T019 [US1] 在 `src/panoramic/narrative-provenance-adapter.ts` 中实现 narrative section 到 `DocumentProvenanceRecord` 的完整映射
- [ ] T020 [US1] 在 `src/panoramic/docs-quality-evaluator.ts` 中实现 explanation 型文档 provenance 收敛与 coverage 统计
- [ ] T021 [US1] 在 `templates/quality-report.hbs` 中实现 provenance 段落渲染，展示 coverage、source categories、low-confidence / inferred 结论

**Checkpoint**: User Story 1 可独立输出 explanation 文档的 provenance 结果，是 059 的 MVP。

---

## Phase 4: User Story 2 - 对冲突事实给出显式质量报告 (Priority: P1)

**Goal**: 对 README、`current-spec.md`、spec/blueprint 与代码派生文档之间的高价值主题冲突输出显式 conflict records。

**Independent Test**: 构造 README 与 `current-spec.md` 冲突 fixture，运行 evaluator 后得到至少 1 条 `ConflictRecord`，且能引用两个以上来源。

### Tests for User Story 2

- [ ] T022 [P] [US2] 编写 README vs `current-spec.md` 冲突测试：覆盖 `product-positioning` 或 `runtime-hosting`
- [ ] T023 [P] [US2] 编写多源冲突测试：覆盖 README / `current-spec.md` / `architecture-narrative` 三方冲突分组
- [ ] T024 [P] [US2] 编写不足证据测试：当缺少事实源时输出 `insufficient evidence` 或 warning，而不是伪造 conflict

### Implementation for User Story 2

- [ ] T025 [US2] 在 `src/panoramic/docs-quality-evaluator.ts` 中实现 conflict topic normalization，覆盖 `product-positioning`、`runtime-hosting`、`protocol-boundary`、`extensibility-boundary`、`degradation-strategy`
- [ ] T026 [US2] 在 `src/panoramic/docs-quality-evaluator.ts` 中实现 deterministic conflict detector，生成 severity、source summaries 和 evidence refs
- [ ] T027 [US2] 在 `templates/quality-report.hbs` 中渲染 conflict sections、冲突摘要和来源对比

**Checkpoint**: User Story 2 可独立识别并呈现高价值文档冲突，不再静默吞掉矛盾。

---

## Phase 5: User Story 3 - 按项目类型校验最低文档集合 (Priority: P1)

**Goal**: 按项目类型和可见事实输出 required-doc 集合、覆盖度和缺失项，并在 055 manifest 缺失时保守降级。

**Independent Test**: 对 runtime project、library project、monorepo fixture 分别运行 evaluator，验证 required-doc 规则不同；manifest 缺失时 report 降级为 partial 并带 dependency warning。

### Tests for User Story 3

- [ ] T028 [P] [US3] 编写 required-doc 规则测试：覆盖 runtime project、library / sdk project、monorepo 三类项目
- [ ] T029 [P] [US3] 编写 manifest 存在测试：`tests/panoramic/docs-bundle-manifest-reader.test.ts` 验证 profile / navigation 最小读取
- [ ] T030 [P] [US3] 编写 manifest 缺失降级测试：验证 `bundleCoverage = partial` 与 dependency warning

### Implementation for User Story 3

- [ ] T031 [US3] 在 `src/panoramic/docs-bundle-manifest-reader.ts` 中实现 profile、navigation、bundle path 的最小引用结构
- [ ] T032 [US3] 在 `src/panoramic/docs-quality-evaluator.ts` 中实现 required-doc rule set、project type 推断与 coverage 统计
- [ ] T033 [US3] 在 `src/panoramic/docs-quality-evaluator.ts` 中实现 055 manifest 优先消费与 missing-manifest 降级逻辑

**Checkpoint**: User Story 3 可独立输出 required-doc 集合和 partial / warn 结论，满足 059 治理闭环。

---

## Phase 6: User Story 4 - Batch 主链路保持兼容并保守降级 (Priority: P2)

**Goal**: 将 059 接入现有 batch 项目级文档套件，写出 `quality-report.md/.json`，并保持 053/056/057/058 输出不回归。

**Independent Test**: 运行 batch 集成测试，验证原有项目文档仍然产出，同时新增 `quality-report.md/.json`；缺失 manifest 或 `current-spec.md` 时仅影响 report 自身状态。

### Tests for User Story 4

- [ ] T034 [P] [US4] 修改 `tests/integration/batch-panoramic-doc-suite.test.ts`，断言新增 `quality-report.md` 与 `quality-report.json`
- [ ] T035 [P] [US4] 修改 `tests/integration/batch-panoramic-doc-suite.test.ts`，验证缺失 bundle manifest / `current-spec.md` 时 batch 仍成功
- [ ] T036 [P] [US4] 修改相关 panoramic 回归测试，验证 059 接入后现有 `projectDocs` / ADR / component / dynamic 输出合同不回归

### Implementation for User Story 4

- [ ] T037 [US4] 修改 `src/panoramic/batch-project-docs.ts`，在现有项目级文档主链路末尾接入 `evaluateDocsQuality(...)`
- [ ] T038 [US4] 修改 `src/panoramic/batch-project-docs.ts`，写出 `quality-report.md` 与 `quality-report.json` 并汇总 warnings
- [ ] T039 [US4] 修改 `src/batch/batch-orchestrator.ts`，把 `quality-report.md` 纳入 `BatchResult.projectDocs`
- [ ] T040 [US4] 修改 `src/panoramic/index.ts`，导出 059 shared model、evaluator、adapter、manifest reader 供 060 复用

**Checkpoint**: 059 已成为 batch 项目级文档套件的一部分，且现有主链路保持兼容。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 完成验证、真实样例检查、主线同步与提交准备。

- [ ] T041 [P] 运行 `npx vitest run tests/panoramic/narrative-provenance-adapter.test.ts tests/panoramic/docs-quality-evaluator.test.ts tests/panoramic/docs-bundle-manifest-reader.test.ts`
- [ ] T042 [P] 运行 `npx vitest run tests/integration/batch-panoramic-doc-suite.test.ts`
- [ ] T043 [P] 运行相关回归：`tests/panoramic/architecture-narrative.test.ts`、`tests/panoramic/pattern-hints-generator.test.ts`、`tests/panoramic/component-view-builder.test.ts`、`tests/panoramic/dynamic-scenarios-builder.test.ts`、`tests/panoramic/adr-decision-pipeline.test.ts`
- [ ] T044 [P] 运行 `npm run lint`
- [ ] T045 [P] 运行 `npm run build`
- [ ] T046 [P] 运行 `npm test`
- [ ] T047 使用 `claude-agent-sdk-python` 或等价真实 / 准真实输出目录验证 059 的 quality report，并将结果记录到 `specs/059-provenance-quality-gates/verification/verification-report.md`
- [ ] T048 提交前执行 `git fetch origin && git rebase origin/master`
- [ ] T049 更新任务状态并完成代码提交

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001 | T001, T010, T011, T020 |
| FR-002 | T012, T019, T020, T037 |
| FR-003 | T005, T018, T021, T038 |
| FR-004 | T016, T017, T019, T020 |
| FR-005 | T010, T011, T020, T021 |
| FR-006 | T022, T023, T025, T026 |
| FR-007 | T022-T027 |
| FR-008 | T028, T032 |
| FR-009 | T014, T029, T030, T031, T033 |
| FR-010 | T034-T040 |
| FR-011 | T024, T030, T035, T038 |
| FR-012 | T025, T026, T032, T033 |
| FR-013 | T037-T046, T048 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成，阻塞所有 User Story
- **User Stories (Phase 3-6)**: 都依赖 Foundational 完成
- **Polish (Phase 7)**: 依赖目标故事完成

### User Story Dependencies

- **US1**: MVP，最先落地
- **US2**: 依赖 US1 的 provenance 归一化基础
- **US3**: 依赖 Foundational，可与 US2 并行，但最终会并入 evaluator
- **US4**: 依赖 US1-US3 的 evaluator 和模板稳定后再接回 batch

### Parallel Opportunities

- Setup 中的模板、fixture 和测试骨架任务可并行
- Foundational 中的 shared model、adapter、manifest reader 可并行推进
- US1-US3 内的测试任务可并行
- Polish 阶段的定向测试、lint、build 和全量测试可并行安排

### Recommended Implementation Strategy

1. 先完成 shared quality model、narrative adapter 和 manifest reader，锁定 059 的 canonical 输入边界
2. 再交付 provenance coverage 作为 MVP，确保 explanation 文档可追溯
3. 在 provenance 稳定后叠加 conflict detector 与 required-doc 规则
4. 最后接回 batch，做真实项目验证、rebase 与提交
