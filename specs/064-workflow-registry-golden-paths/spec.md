# Feature Specification: Workflow Registry 与 Golden Paths

**Feature Branch**: `064-workflow-registry-golden-paths`  
**Created**: 2026-04-04  
**Status**: Implemented  
**Input**: User description: "开始完成 Feature 064"

## User Scenarios & Testing

### User Story 1 - 为六个入口生成 machine-readable workflow definition (Priority: P1)

作为维护者，我希望 `feature/story/fix/resume/sync/doc` 六个入口都拥有稳定的 machine-readable workflow definition，而不是只存在于 README 和 SKILL prompt 文本里，这样后续 Catalog、scorecards 和 adoption 分析都能复用统一的工作流合同。

**Why this priority**: 064 是 062 里程碑的第二步；没有正式 workflow definitions，063 的 `workflowRefs` 仍然只是弱引用。

**Independent Test**: 运行 workflow registry helper，验证输出包含 6 个 workflow，且每个 workflow 都包含 `id/title/persona/useCases/entryCommand/requiredInputs/keyGates/artifacts/recommendedWhen/templateVersion`。

**Acceptance Scenarios**:

1. **Given** 仓库包含 6 个 `plugins/spec-driver/workflows/*.yaml`，**When** 运行 registry helper，**Then** 输出 `workflow-index.json` 中的 `workflowCount = 6`。
2. **Given** 任一 workflow definition，**When** 读取其 JSON 表示，**Then** 该 definition 保留 machine-readable 的入口命令、关键 gate 和核心制品路径。

---

### User Story 2 - 项目级 `.specify/workflows` 只能覆盖 metadata，不改核心语义 (Priority: P1)

作为项目维护者，我希望可以在 `.specify/workflows/*.yaml` 对 persona、recommendedWhen、templateVersion 等元信息做项目级覆盖，但不能偷偷改 entry command、gates 或 artifacts 这种核心语义，这样 Golden Path 可以因项目而异，同时保持底层流程一致。

**Why this priority**: 064 蓝图明确要求项目级覆盖只允许 metadata / 推荐说明，不允许悄悄修改六个 skill 的业务逻辑。

**Independent Test**: 在临时项目里创建 `.specify/workflows/spec-driver-story.yaml`，覆盖 `persona` 和 `recommendedWhen`，同时尝试覆盖 `entryCommand`，验证 helper 只应用前两者，并输出 warning。

**Acceptance Scenarios**:

1. **Given** `.specify/workflows/spec-driver-story.yaml` 只覆盖 `persona` 和 `recommendedWhen`，**When** 生成 workflow index，**Then** index 中的 story workflow 应采用项目级 metadata。
2. **Given** override 文件尝试修改 `entryCommand` 或 `keyGates`，**When** 生成 workflow index，**Then** helper MUST 忽略这些字段并记录 warning。

---

### User Story 3 - 输出可读的 workflow-index 与 3 条 golden paths (Priority: P2)

作为文档消费者，我希望除了 YAML 定义以外，还能直接阅读一份 `workflow-index.md/.json`，其中包含“如何选择技能”和至少 3 条 golden paths，这样我能快速理解什么时候该用 feature、什么时候用 fix、什么时候只做 sync/doc。

**Why this priority**: 064 不只是注册表，还要把“定义与推荐”落成可消费的文档层，否则 registry 仍然只是内部元数据。

**Independent Test**: 运行 helper 后验证 `workflow-index.md` 包含“如何选择技能”表和 `新功能研发 / 快速修复 / 产品事实与文档更新` 三条 golden paths。

**Acceptance Scenarios**:

1. **Given** workflow registry helper 运行完成，**When** 打开 `workflow-index.md`，**Then** 文档包含 `如何选择技能` 和 `Golden Paths` 两个一级信息区块。
2. **Given** `spec-driver-doc` 发现同级存在 `workflow-index.md/.json`，**When** 后续生成 README / onboarding，**Then** 它可将 workflow registry 作为工作流选择的补充事实源。

## Edge Cases

- 项目级 override 目录不存在时，helper 应该静默回退到 plugin 默认 workflow definitions。
- override 只允许 metadata 字段生效；一旦发现试图覆盖 `entryCommand` / `keyGates` / `artifacts`，必须 warning 并忽略。
- `golden-paths.yaml` 只定义推荐路径，不应被当作第七个 workflow。
- workflow registry 的存在不应要求立即修改任何现有 skill 的业务语义。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 `plugins/spec-driver/workflows/` 下为 `feature/story/fix/resume/sync/doc` 六个入口提供 workflow definition YAML。
- **FR-002**: 每个 workflow definition MUST 包含最小字段集：`id`、`title`、`persona`、`useCases`、`entryCommand`、`requiredInputs`、`keyGates`、`artifacts`、`recommendedWhen`、`templateVersion`。
- **FR-003**: 系统 MUST 提供 registry helper，生成 `specs/products/spec-driver/_generated/workflow-index.md` 与 `workflow-index.json`。
- **FR-004**: 系统 MUST 输出至少 3 条 golden paths：`新功能研发`、`快速修复`、`产品事实与文档更新`。
- **FR-005**: helper MUST 支持 `.specify/workflows/*.yaml` 项目级覆盖。
- **FR-006**: 项目级覆盖 MUST 只允许修改 metadata / 推荐说明 / templateVersion，不得修改 `entryCommand`、`keyGates`、`artifacts` 等核心语义字段。
- **FR-007**: 当 override 尝试修改非允许字段时，helper MUST 记录 warning 并忽略该字段。
- **FR-008**: `init-project.sh` MUST 预创建 `.specify/workflows/` 目录，作为项目级 workflow 覆盖挂载点。
- **FR-009**: `spec-driver-doc` SHOULD 在发现同级 `workflow-index.md/.json` 时，将其作为“如何选择技能”章节的补充事实源。
- **FR-010**: `spec-driver` 产品实体目录的 `workflowRefs` SHOULD 优先来自真实 workflow definitions，而不是静态硬编码列表。

### Key Entities

- **WorkflowDefinition**: 单个技能入口的 machine-readable 工作流定义。
- **WorkflowRegistryIndex**: 汇总所有 workflow definitions 和 golden paths 的索引输出。
- **WorkflowOverride**: 项目级 metadata-only 覆盖片段。
- **GoldenPathDefinition**: 面向用户推荐的一条工作流组合路径。

## Success Criteria

- **SC-001**: `plugins/spec-driver/workflows/` 中存在 6 个 workflow definition YAML 和 1 个 golden-paths YAML。
- **SC-002**: registry helper 生成的 `workflow-index.json` 中 `workflowCount = 6`、`goldenPathCount = 3`。
- **SC-003**: `.specify/workflows` override 能覆盖 metadata，但无法覆盖 `entryCommand` 等核心语义字段。
- **SC-004**: `workflow-index.md` 能直接回答“如何选择技能”，并列出 3 条 golden paths。
- **SC-005**: 相关测试、`npm run lint`、`npm run build` 全部通过。

## Clarifications

### Session 2026-04-04

- [AUTO-CLARIFIED: 064 只做 registry 和推荐路径，不新增第七个编排器]
- [AUTO-CLARIFIED: golden path 是推荐组合，不是新的 runtime skill]
- [AUTO-CLARIFIED: `.specify/workflows` 第一版只支持 metadata-only 覆盖]
