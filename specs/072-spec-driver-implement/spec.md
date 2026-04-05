# Feature Specification: `spec-driver-implement` Skill

**Feature Branch**: `072-spec-driver-implement`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 落地 `070` 蓝图中的 Feature 072，为成熟 `spec/plan` 场景提供独立的 Spec 级实施入口

## User Scenarios & Testing

### User Story 1 - 成熟 Spec/Plan 直接进入实施 (Priority: P1)

作为已有完整 `spec.md` 和 `plan.md` 的开发者，我希望直接调用独立的 `spec-driver-implement`，让系统聚焦计划审查、任务细化、代码实施和验证，而不是重新回到完整调研链路。

**Independent Test**: 阅读新 Skill 文档，确认默认阶段只覆盖 `intake -> plan-review -> task-refinement -> implementation -> verification -> closure`，且明确要求现成 `spec.md + plan.md`。

### User Story 2 - 双端安装与 Workflow Library 同步感知新入口 (Priority: P1)

作为插件用户，我希望 Claude 和 Codex 两端都能安装 `spec-driver-implement`，且 workflow registry、entity catalog、scorecard / adoption 输入都认识这个新入口。

**Independent Test**: 运行 Codex 安装脚本和 workflow registry helper，确认 `spec-driver-implement` 包装、workflow definition 和 machine-readable index 都存在。

### User Story 3 - Resume 与 Implement 的边界清晰 (Priority: P2)

作为中断流程恢复者，我希望 `resume` 继续负责断点恢复，而 `implement` 只负责成熟 `spec/plan` 的聚焦实施，避免两个入口语义重叠。

**Independent Test**: 检查 `spec-driver-resume`、README、product current-spec，确认都明确说明“resume 恢复中断流程，implement 面向成熟 Spec/Plan 实施”。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`
- **FR-002**: `spec-driver-implement` MUST 以现有 `specs/<feature>/` 目录为输入，且至少要求 `spec.md` 与 `plan.md`
- **FR-003**: `spec-driver-implement` MUST 聚焦 `plan-review`、`task-refinement`、`implementation`、`verification`，不得重新要求完整调研链路
- **FR-004**: 若 `spec.md` 或 `plan.md` 缺失，Skill MUST 明确提示回退到 `spec-driver-feature` 或 `spec-driver-story`
- **FR-005**: Codex 安装脚本 MUST 安装 `spec-driver-implement` 包装 Skill
- **FR-006**: Workflow registry MUST 新增 `spec-driver-implement` workflow definition，并提供至少一条 implement-oriented golden path
- **FR-007**: Product entity catalog、scorecard、adoption 等派生产物 MUST 将 `spec-driver-implement` 视为正式 workflow ref
- **FR-008**: README、postinstall 提示、product current-spec 和 `resume` 文档 MUST 同步解释 `implement` 的定位与边界

## Success Criteria

- `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` 已存在并可安装到 `.codex/skills/spec-driver-implement/`
- `specs/products/spec-driver/_generated/workflow-index.json` 显示 `workflowCount = 7`
- `specs/products/spec-driver/_generated/entity.yaml` 和 scorecard / adoption 相关产物已识别 `spec-driver-implement`
- README / current-spec / postinstall 不再只写“六种模式”
