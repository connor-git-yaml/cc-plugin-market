# Feature Specification: Scorecards 与持续治理报告

**Feature Branch**: `065-scorecards-continuous-governance`  
**Created**: 2026-04-04  
**Status**: Implemented  
**Input**: User description: "开始做 065"

## User Scenarios & Testing

### User Story 1 - 为产品生成可解释的持续治理评分 (Priority: P1)

作为产品维护者，我希望 `reverse-spec` 和 `spec-driver` 都能生成一份持续治理评分报告，而不是只依赖一次性的 gate 暂停，这样我能看到产品事实、验证、文档和 workflow 是否健康。

**Why this priority**: 065 是 062 里程碑的治理层；没有 scorecard，063/064 仍停留在“有事实、无持续判断”。

**Independent Test**: 运行 scorecard helper，验证两个产品都输出 `scorecard-report.md/.json`，且报告中包含 6 个首批评分维度和分数来源。

**Acceptance Scenarios**:

1. **Given** 产品实体目录、workflow registry、verification 报告与 quality-report 存在，**When** 运行 helper，**Then** 每个产品都生成 `scorecard-report.md/.json`。
2. **Given** 任意单条 scorecard 规则，**When** 打开 JSON 报告，**Then** 可以看到 `status/score/summary/evidence`，而不只是总分。

---

### User Story 2 - 评分规则可 Git 管理、可项目级覆盖 (Priority: P1)

作为仓库维护者，我希望 scorecard 规则通过 YAML 定义并支持 `.specify/scorecards/*.yaml` 项目级覆盖，这样治理逻辑能像 workflow registry 一样可 review、可版本化、可渐进演化。

**Why this priority**: 065 不能把规则硬编码成另一套黑盒逻辑，否则后续 066 的 adoption 分析无法稳定复用。

**Independent Test**: 运行 `init-project.sh`，验证会创建 `.specify/scorecards/default-governance.yaml`；运行 helper，验证它能读取默认 ruleset。

**Acceptance Scenarios**:

1. **Given** 首次初始化项目，**When** 运行 `init-project.sh --json`，**Then** `.specify/scorecards/` 和默认 scorecard YAML 存在。
2. **Given** scorecard helper 运行，**When** 输出 JSON，**Then** `rulesetId = default-governance` 且规则数量为 6。

---

### User Story 3 - sync 流程将 scorecard 作为产品事实层的一部分 (Priority: P2)

作为 `spec-driver-sync` 的使用者，我希望同步产品事实时顺手生成 scorecard，并在 workflow / catalog 中体现出来，这样 `doc`、后续 governance 和 adoption 都能直接消费同一份治理视图。

**Why this priority**: 063/064 已经把 Catalog 和 workflow registry 接入 sync，上下游都在同一条链上，065 不该另起一条孤立脚本流。

**Independent Test**: 刷新 `spec-driver-sync` workflow artifacts，验证包含 `scorecard-report.md/.json` 和 `scorecard-index.yaml`，同时 `workflow-index.md/.json` 同步更新。

**Acceptance Scenarios**:

1. **Given** `spec-driver-sync` workflow definition，**When** 生成 workflow registry，**Then** artifacts 中包含 scorecard 产物路径。
2. **Given** scorecard helper 执行完成，**When** 查看 `entity.yaml` 与 `catalog-index.yaml`，**Then** 可以看到 `scorecardStatus` / `scorecardScore` 等治理摘要。

## Edge Cases

- 缺少 `quality-report.json` 时，scorecard 仍应生成，但 `docs-coverage` / `docs-conflicts` 必须降级为 `warn` 并说明原因。
- verification 报告历史格式不一致时，helper 应通过宽松正则和 mtime 兜底，而不是直接报错。
- `spec-driver` 以外的产品没有 `workflow-index.json` 时，`workflow-readiness` 应基于 `workflowRefs + current-spec` 降级判断。
- branch hygiene 只检查稳定事实（remote/default branch/branch policy 文档），不把当前工作区脏状态写进版本库报告。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供 `generate-product-scorecards.mjs`，输出 `specs/products/<product>/scorecard-report.md/.json`。
- **FR-002**: 系统 MUST 输出 `specs/products/scorecard-index.yaml`，汇总各产品的 scorecard 状态与分数。
- **FR-003**: scorecard 规则 MUST 通过 YAML 定义，并提供默认 ruleset `default-governance`。
- **FR-004**: `init-project.sh` MUST 预创建 `.specify/scorecards/` 并导入默认 scorecard YAML。
- **FR-005**: 首批 scorecard 维度 MUST 包含：`spec-freshness`、`verification-freshness`、`docs-coverage`、`docs-conflicts`、`branch-hygiene`、`workflow-readiness`。
- **FR-006**: `docs-coverage` 与 `docs-conflicts` MUST 直接复用现有 `quality-report.json` 的结构化结果。
- **FR-007**: `verification-freshness` MUST 直接复用 `specs/<feature>/verification/verification-report.md` 及其 mtime。
- **FR-008**: helper MUST 在生成 scorecard 后回写 `entity.yaml` / `catalog-index.yaml` 的 scorecard 摘要。
- **FR-009**: `spec-driver-sync` 的产物声明 SHOULD 包含 scorecard 产物路径，使 workflow registry 可见这些治理输出。
- **FR-010**: scorecard 报告默认只做“生成报告”，不得自动阻断流程或引入 OPA/Rego。

### Key Entities

- **ScorecardRule**: 单条持续治理规则的 machine-readable 定义。
- **ScorecardReport**: 单个产品的治理评分报告，包含规则结果、总分、摘要与 evidence。
- **ScorecardIndex**: 所有产品 scorecard 的汇总索引。
- **GovernanceEvidence**: 来自 current-spec、verification、quality-report、workflow registry、branch policy 的结构化证据。

## Success Criteria

- **SC-001**: `reverse-spec` 与 `spec-driver` 都能生成 `scorecard-report.md/.json`。
- **SC-002**: 报告中 6 条首批规则均有 `status/score/summary/evidence`。
- **SC-003**: 至少 1 条规则复用 `quality-report`，至少 1 条规则复用 `verification-report`。
- **SC-004**: `init-project.sh` 会创建 `.specify/scorecards/default-governance.yaml`。
- **SC-005**: 相关集成测试、`npm run lint`、`npm run build` 全部通过。

## Clarifications

### Session 2026-04-04

- [AUTO-CLARIFIED: 065 先做 report-first，不把 scorecard 直接接成 gate]
- [AUTO-CLARIFIED: branch-hygiene 只看稳定仓库事实，不把当前工作区脏状态写入报告]
- [AUTO-CLARIFIED: `.specify/scorecards` 第一版用于默认规则和项目级阈值覆盖，不引入 OPA/Rego]
