# Tasks: Script Platform 共享层收敛

**Input**: Design documents from `/specs/078-script-platform-shared-layer/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`  

**Tests**: 本 Feature 明确要求共享层 unit tests、六条主链 integration tests，以及 `npm run lint`、`npm run build`、`npm test`。  

**Organization**: 任务按共享基础设施、User Story 和验证阶段分组，确保每个故事能独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US3）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 为 078 建立共享层文件、测试入口和 feature 制品骨架。

- [x] T001 创建 `plugins/spec-driver/scripts/lib/script-report-io.mjs` 骨架
- [x] T002 [P] 创建 `plugins/spec-driver/scripts/lib/product-artifact-patchers.mjs` 骨架
- [x] T003 [P] 创建 `plugins/spec-driver/scripts/lib/script-diagnostics.mjs` 骨架
- [x] T004 [P] 在 `tests/unit/spec-driver-script-platform.test.ts` 创建共享层 unit test 骨架
- [x] T005 [P] 对齐 `specs/078-script-platform-shared-layer/plan.md`、`data-model.md`、`contracts/script-platform-shared-contract.md` 的字段命名

**Checkpoint**: 共享层文件落点和测试入口稳定，可开始实现基础 primitive。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 实现六条主链都会复用的 YAML、IO、patch、diagnostics 基础能力。

- [x] T006 在 `plugins/spec-driver/scripts/lib/simple-yaml.mjs` 中实现共享 `stringifyYaml()`，并保持现有 `parseYamlDocument()` 行为稳定
- [x] T007 [P] 在 `plugins/spec-driver/scripts/lib/script-report-io.mjs` 中实现 `ensureArtifactDir()`、`writeJsonArtifact()`、`writeMarkdownArtifact()`、`writeYamlArtifact()`、`readJsonArtifact()`
- [x] T008 [P] 在 `plugins/spec-driver/scripts/lib/product-artifact-patchers.mjs` 中实现共享 YAML 读改写骨架与 `catalog-index.yaml` patch helper
- [x] T009 [P] 在 `plugins/spec-driver/scripts/lib/script-diagnostics.mjs` 中实现 `dedupeStringValues()`、warning section helper 和轻量 Markdown helper
- [x] T010 [P] 在 `tests/unit/spec-driver-script-platform.test.ts` 中补共享 YAML / IO / patch / diagnostics 的基础单测

**Checkpoint**: 共享 primitive 已成形，六条主链可以开始按批迁移。

---

## Phase 3: User Story 1 - 六条主链共享同一套 YAML 能力 (Priority: P1) 🎯 MVP

**Goal**: 消除六条主链脚本中的本地 `parseYamlDocument` / `stringifyYaml` 重复定义，让 YAML 能力回到共享层。

**Independent Test**: 运行共享层 unit tests 与 `workflow / quality / scorecard / entity / suggestions` 集成测试，验证 YAML 读写结果兼容且代码中不再保留多份本地实现。

### Tests for User Story 1

- [x] T011 [P] [US1] 在 `tests/unit/spec-driver-script-platform.test.ts` 中增加 YAML roundtrip 用例，覆盖 object / array / scalar / quoted string
- [x] T012 [P] [US1] 在 `tests/unit/spec-driver-script-platform.test.ts` 中增加源文件扫描断言，检查目标脚本不再包含本地 `function parseYamlDocument` / `function stringifyYaml`
- [x] T013 [P] [US1] 更新 `tests/integration/spec-driver-workflow-registry.test.ts`，覆盖共享 YAML 迁移后的 override 和 markdown/json 产物稳定性
- [x] T014 [P] [US1] 更新 `tests/integration/spec-driver-product-quality-reports.test.ts` 与 `tests/integration/spec-driver-product-scorecards.test.ts`，覆盖共享 YAML 迁移后的 entity/catalog 回写稳定性

### Implementation for User Story 1

- [x] T015 [US1] 修改 `plugins/spec-driver/scripts/generate-workflow-registry.mjs`，改为导入 `plugins/spec-driver/scripts/lib/simple-yaml.mjs`
- [x] T016 [US1] 修改 `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`，移除本地 YAML parse/stringify 实现并接入共享 helper
- [x] T017 [US1] 修改 `plugins/spec-driver/scripts/generate-product-scorecards.mjs`，移除本地 YAML parse/stringify 实现并接入共享 helper
- [x] T018 [US1] 修改 `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`，把本地 `stringifyYaml()` 迁到共享 helper
- [x] T019 [US1] 修改 `plugins/spec-driver/scripts/generate-project-context-suggestions.mjs`，把本地 `stringifyYaml()` 迁到共享 helper

**Checkpoint**: User Story 1 完成后，YAML 已有单一来源，满足蓝图 078 的首条核心验收标准。

---

## Phase 4: User Story 2 - 主要生成脚本共享基础 IO、patch 与 diagnostics 合同 (Priority: P1)

**Goal**: 让主要生成脚本共享 report IO、entity/catalog patch 骨架和 warnings contract，减少重复 mkdir/write/patch 模板代码。

**Independent Test**: 运行 `entity / quality / scorecard / adoption / suggestions` 相关集成测试，验证产物路径、回写行为和 warnings 区块未回归。

### Tests for User Story 2

- [x] T020 [P] [US2] 更新 `tests/integration/spec-driver-product-entity-catalog.test.ts`，验证共享 IO 写出的 `entity.yaml` 与 `catalog-index.yaml` 保持稳定
- [x] T021 [P] [US2] 更新 `tests/integration/spec-driver-adoption-insights.test.ts`，验证共享 IO 与 diagnostics helper 后 warnings 和 markdown 区块保持稳定
- [x] T022 [P] [US2] 更新 `tests/integration/spec-driver-project-context-suggestions.test.ts`，验证共享 YAML/IO/diagnostics 后 `.specify/project-context.suggestions.*` 产物保持稳定
- [x] T023 [P] [US2] 在 `tests/unit/spec-driver-script-platform.test.ts` 中增加 patch helper 与 warnings helper 单测

### Implementation for User Story 2

- [x] T024 [US2] 修改 `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`，接入 `script-report-io.mjs`、`product-artifact-patchers.mjs`、`script-diagnostics.mjs`
- [x] T025 [US2] 修改 `plugins/spec-driver/scripts/generate-product-scorecards.mjs`，接入共享 IO、patch、diagnostics helpers
- [x] T026 [US2] 修改 `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`，接入共享 IO 和 diagnostics helpers
- [x] T027 [US2] 修改 `plugins/spec-driver/scripts/generate-adoption-insights.mjs`，接入共享 IO 和 diagnostics helpers
- [x] T028 [US2] 修改 `plugins/spec-driver/scripts/generate-project-context-suggestions.mjs`，接入共享 IO 和 diagnostics helpers

**Checkpoint**: User Story 2 完成后，主要脚本共享一套基础 IO 与 diagnostics 合同，`quality/scorecard` 的 patch 骨架也已收敛。

---

## Phase 5: User Story 3 - 重构后对外合同保持稳定且共享层有专门测试 (Priority: P2)

**Goal**: 在保持脚本入口和输出合同稳定的前提下，为共享层补可维护的单测与回归验证。

**Independent Test**: 共享层 unit tests、六条主链 integration tests、`lint`、`build`、`test` 全部通过。

### Tests for User Story 3

- [x] T029 [P] [US3] 在 `tests/unit/spec-driver-script-platform.test.ts` 中增加 report IO 细节用例，覆盖 trailing newline、missing file、JSON parse fallback
- [x] T030 [P] [US3] 运行并必要时调整 `tests/integration/spec-driver-product-entity-catalog.test.ts`
- [x] T031 [P] [US3] 运行并必要时调整 `tests/integration/spec-driver-workflow-registry.test.ts`
- [x] T032 [P] [US3] 运行并必要时调整 `tests/integration/spec-driver-product-quality-reports.test.ts`
- [x] T033 [P] [US3] 运行并必要时调整 `tests/integration/spec-driver-product-scorecards.test.ts`
- [x] T034 [P] [US3] 运行并必要时调整 `tests/integration/spec-driver-adoption-insights.test.ts` 与 `tests/integration/spec-driver-project-context-suggestions.test.ts`

### Implementation for User Story 3

- [x] T035 [US3] 统一六条主链脚本中剩余的重复 `dedupeStringValues` / warning section / table escape 等 helper 到共享层
- [x] T036 [US3] 检查并清理目标脚本内的死代码、重复 helper 和未使用 import，保持对外 JSON payload 不变
- [x] T037 [US3] 更新 `specs/products/spec-driver/current-spec.md` 与必要的产品事实源，记录 078 已落地 script platform 共享层收敛

**Checkpoint**: User Story 3 完成后，共享层有专门测试，对外合同保持稳定，并为 081 留下更薄的入口脚本。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 完成验证、主线同步与提交准备。

- [x] T038 [P] 运行 `npx vitest run tests/unit/spec-driver-script-platform.test.ts`
- [x] T039 [P] 运行 `npx vitest run tests/integration/spec-driver-product-entity-catalog.test.ts tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-product-quality-reports.test.ts`
- [x] T040 [P] 运行 `npx vitest run tests/integration/spec-driver-product-scorecards.test.ts tests/integration/spec-driver-adoption-insights.test.ts tests/integration/spec-driver-project-context-suggestions.test.ts`
- [x] T041 [P] 运行 `npm run lint`
- [x] T042 [P] 运行 `npm run build`
- [x] T043 [P] 运行 `npm test`
- [x] T044 执行代码检索，确认 `plugins/spec-driver/scripts/*.mjs` 中不再保留多份功能等价的本地 `parseYamlDocument` / `stringifyYaml`
- [x] T045 更新 `specs/078-script-platform-shared-layer/verification/verification-report.md`
- [x] T046 提交前执行 `git fetch origin && git rebase origin/master`
- [ ] T047 更新任务状态并完成代码提交

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001 | T006, T011, T015-T019 |
| FR-002 | T013-T019 |
| FR-003 | T007, T020-T029 |
| FR-004 | T008, T023-T025 |
| FR-005 | T009, T021-T023, T027-T028, T035 |
| FR-006 | T015-T028 |
| FR-007 | T013-T014, T020-T022, T030-T036, T039-T040 |
| FR-008 | T006-T043, T046 |
| FR-009 | T006-T009, T015-T028 |
| FR-010 | T010-T014, T020-T023, T029-T043 |
| FR-011 | T005, T037, T045-T047 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup，阻塞所有 User Story
- **US1 (Phase 3)**: 依赖 Foundational 完成
- **US2 (Phase 4)**: 依赖 Foundational，且最佳在 US1 迁完 YAML 后推进
- **US3 (Phase 5)**: 依赖 US1 和 US2 基本完成后清理与稳态验证
- **Polish (Phase 6)**: 依赖目标故事完成

### User Story Dependencies

- **US1**: MVP，先拿下 YAML 单一来源
- **US2**: 建立在 US1 的共享 YAML 之上，继续统一 IO / patch / diagnostics
- **US3**: 负责回归、清理和产品事实同步，依赖 US1 + US2

### Parallel Opportunities

- Setup 中新增文件骨架和文档对齐任务可并行
- Foundational 中 IO / patch / diagnostics helper 可并行实现
- US1/US2 内部的集成测试更新可并行
- Polish 阶段的定向测试、lint、build 和全量测试可顺序或分组执行

### Recommended Implementation Strategy

1. 先实现共享 `stringifyYaml` 和 IO / patch / diagnostics primitives
2. 再迁 `workflow / quality / scorecard / entity / suggestions` 的 YAML 与 IO 依赖
3. 最后迁 `adoption` 的 IO / diagnostics，并清理残余重复 helper
4. 跑单测、集成测试、全量验证，最后更新产品活文档与 verification report
