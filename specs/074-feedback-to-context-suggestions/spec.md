# Feature Specification: Feedback to Context Suggestions

**Feature Branch**: `074-feedback-to-context-suggestions`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 落地 `070` 蓝图中的 Feature 074，把 adoption / scorecard / quality 信号转成可 review 的 Project Context 建议

## User Scenarios & Testing

### User Story 1 - 为 Project Context 生成独立建议文件 (Priority: P1)

作为维护长期项目约束的使用者，我希望系统把运行中的 adoption / quality / scorecard 信号转成单独的 `project-context.suggestions`，而不是直接修改我的 Project Context。

**Independent Test**: 运行 suggestions helper，确认会生成 `.specify/project-context.suggestions.yaml` 与 `.specify/project-context.suggestions.md`，且内容包含优先级、建议项和 evidence。

### User Story 2 - sync 流程自动刷新建议 (Priority: P1)

作为使用 `spec-driver-sync` 维护产品事实源的用户，我希望在刷新 Catalog、quality、scorecard 与 adoption 后，Context suggestions 也能一起更新。

**Independent Test**: 阅读 `spec-driver-sync` 技能与 workflow artifacts，确认 suggestions helper 已纳入同步链路，并暴露建议文件路径。

### User Story 3 - Feature / Implement / Sync 可消费建议但不覆盖用户配置 (Priority: P2)

作为执行 feature 或 implement 的用户，我希望系统能把 suggestions 当作 advisory-only 上下文注入，而不是替代用户显式配置或 Project Context 正文。

**Independent Test**: 阅读相关 Skill 文档与 Codex wrapper，确认会读取 `.specify/project-context.suggestions.yaml|md`，但明确标注为 advisory-only。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 Project Context suggestions 生成脚本
- **FR-002**: 生成脚本 MUST 读取至少以下信号源：`quality-report`、`scorecard-report`、`adoption-report`
- **FR-003**: 生成脚本 MUST 输出独立于 canonical Project Context 的 suggestions 文件，且不得自动改写 `.specify/project-context.yaml`
- **FR-004**: 每条建议 MUST 包含 `priority`、`category`、`summary` 与 `evidence`
- **FR-005**: suggestions 输出 MUST 至少覆盖以下建议类型中的可推断子集：参考资料、workflow 偏好、验证偏好、owner/reviewer、风险路径
- **FR-006**: `spec-driver-sync` MUST 在 quality / scorecard / adoption helper 之后执行 suggestions helper
- **FR-007**: `spec-driver-feature`、`spec-driver-implement`、`spec-driver-sync` MUST 能消费 suggestions 文件作为 advisory-only 上下文
- **FR-008**: README、workflow registry、product current-spec 与 product mapping MUST 同步 074 能力

## Success Criteria

- `.specify/project-context.suggestions.yaml` 与 `.specify/project-context.suggestions.md` 可生成且可 diff
- `spec-driver-sync` 的 workflow artifacts 包含 suggestions 文件
- `feature / implement / sync` 技能文档显式说明 suggestions 只做建议，不覆盖用户 Project Context
- `specs/products/spec-driver/current-spec.md` 和 `specs/products/product-mapping.yaml` 已纳入 074
