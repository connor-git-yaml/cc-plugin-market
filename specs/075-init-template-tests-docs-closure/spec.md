# Feature Specification: Init / Template / Tests / Docs Closure

**Feature Branch**: `075-init-template-tests-docs-closure`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 落地 `070` 蓝图中的 Feature 075，补齐 project-context 初始化模板、迁移说明、回归测试和文档收口

## User Scenarios & Testing

### User Story 1 - 新项目初始化时直接得到 canonical Project Context (Priority: P1)

作为首次在项目中启用 Spec Driver 的用户，我希望 `init-project.sh` 自动创建最小 `.specify/project-context.yaml`，这样我不必再自己摸索 canonical Project Context 应该长什么样。

**Independent Test**: 在空目录运行 `init-project.sh --json`，确认 `.specify/project-context.yaml` 与 `.specify/templates/project-context-template.yaml` 已创建，且不会生成 `.specify/project-context.md`。

### User Story 2 - 旧版 Markdown Project Context 有明确迁移路径 (Priority: P1)

作为已有 `.specify/project-context.md` 的存量项目使用者，我希望系统继续兼容旧文件，但能明确告诉我应迁移到 YAML，而不是静默制造双写冲突。

**Independent Test**: 在仅存在 `.specify/project-context.md` 的项目运行 `init-project.sh --json`，确认不会自动创建 YAML，且输出 `legacy-md` 模式和迁移提示。

### User Story 3 - 文档与产品事实源同步 075 合同 (Priority: P2)

作为维护插件和活文档的使用者，我希望 README、共享上下文规则、product mapping 与 current-spec 都明确记录 canonical YAML、legacy fallback 和 source-of-truth 规则。

**Independent Test**: 阅读 README、共享片段与产品活文档，确认 075 的初始化与迁移合同已被纳入。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供最小 `project-context-template.yaml` 模板源
- **FR-002**: `init-project.sh` MUST 在缺少 `.specify/project-context.yaml|md` 时自动创建最小 `.specify/project-context.yaml`
- **FR-003**: 当项目仅存在 `.specify/project-context.md` 时，`init-project.sh` MUST 保持兼容，不得自动双写 YAML
- **FR-004**: `init-project.sh` MUST 在 JSON / 文本结果中暴露 Project Context 初始化模式（如 `yaml`、`legacy-md`、`dual`）
- **FR-005**: README、共享上下文片段、product mapping、current-spec MUST 同步 075 的 canonical YAML 和迁移说明
- **FR-006**: 集成测试 MUST 覆盖空项目初始化和 legacy Markdown 迁移两条路径

## Success Criteria

- 新项目初始化后可直接看到 `.specify/project-context.yaml`
- legacy Markdown 项目不会被自动重写，但能收到迁移提示
- `spec-driver` README、根 README、共享文档和产品活文档都已同步 075 的规则
- 相关 init / resolver / wrapper 回归测试通过
