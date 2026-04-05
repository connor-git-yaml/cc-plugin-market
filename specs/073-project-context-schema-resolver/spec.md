# Feature Specification: Project Context Schema + Resolver

**Feature Branch**: `073-project-context-schema-resolver`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 落地 `070` 蓝图中的 Feature 073，把 `.specify/project-context.yaml|md` 从 Skill 文档约定升级为共享解析机制

## User Scenarios & Testing

### User Story 1 - Skill 使用统一 resolver 读取 Project Context (Priority: P1)

作为 Spec Driver 使用者，我希望 `feature/story/fix/resume/sync/doc/implement` 在读取 `.specify/project-context.*` 时都走同一个 resolver，这样注入行为、warning 和在线调研策略是一致且可解释的。

**Independent Test**: 阅读 Skill 文档，确认它们都不再描述各自的 ad-hoc 解析规则，而是统一调用 `resolve-project-context`。

### User Story 2 - YAML 成为 canonical source，Markdown 仅做兼容 (Priority: P1)

作为已有历史项目的维护者，我希望 `.specify/project-context.yaml` 成为确定性的 canonical source，而 `.specify/project-context.md` 只保留 legacy fallback；两者并存时行为必须固定且有迁移 warning。

**Independent Test**: 运行 resolver，验证 `yaml + md` 并存时只读取 YAML，并返回 migration warning。

### User Story 3 - Project Context 不能再偷偷承载执行语义 (Priority: P2)

作为项目规范维护者，我希望 `Project Context` 只描述项目级长期偏好、约束和参考资料，不再承载 `phase_focus`、`implementation_only` 之类的 Spec 级执行语义。

**Independent Test**: 给 resolver 输入包含被排除字段的 YAML，确认这些字段不会进入 resolved profile，并产生明确 diagnostics。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `resolve-project-context` 脚本与共享 helper
- **FR-002**: resolver MUST 支持 `.specify/project-context.yaml` 作为 canonical source
- **FR-003**: resolver MUST 兼容 `.specify/project-context.md` 作为 legacy fallback
- **FR-004**: 当 `.yaml` 与 `.md` 并存时，resolver MUST 只读取 `.yaml`，并返回迁移 warning
- **FR-005**: resolver MUST 输出 `ResolvedProjectProfile`、`projectContextBlock`、`onlineResearch` 和 `diagnostics`
- **FR-006**: resolver MUST 检查本地 references 的路径存在性，并区分 `existing` / `missing`
- **FR-007**: resolver MUST 忽略 `phase_focus`、`skip_spec`、`implementation_only`、`task_strategy` 等执行语义字段，并给出 diagnostics
- **FR-008**: `feature/story/fix/resume/sync/doc/implement` 这些 Skill MUST 统一引用 resolver，而不是继续复制各自的 project-context 解析规则
- **FR-009**: README 与产品活文档 MUST 同步说明 YAML canonical 与 shared resolver 合同

## Success Criteria

- `plugins/spec-driver/scripts/resolve-project-context.mjs` 可在仓库内独立运行并输出稳定 JSON
- 新增 integration test 覆盖 YAML、Markdown fallback、YAML 优先级和 excluded fields diagnostics
- 关键 Skill 文档中的 `project-context` 段落已统一收敛为 shared resolver 机制
- `specs/products/spec-driver/current-spec.md` 与 `product-mapping.yaml` 已纳入 073
