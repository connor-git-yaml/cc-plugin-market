# Feature Specification: 架构中间表示（Architecture IR）导出

**Feature Branch**: `056-architecture-ir-export`  
**Created**: 2026-03-20  
**Status**: In Progress  
**Input**: User description: "落地 Feature 056 `架构中间表示（Architecture IR）导出`，按 Spec Driver 完整流程端到端完成"

---

## User Scenarios & Testing

### User Story 1 - 统一导出现有 panoramic 架构事实 (Priority: P1)

作为维护者，我希望把 `architecture-overview`、`runtime-topology`、`workspace-index`、`cross-package-deps` 统一映射成一份 `ArchitectureIR`，这样后续架构输出不会再各自维护一套关系模型。

**Why this priority**: 这是 056 的核心定义；如果没有统一 IR，后续多源架构文档体系会继续重复建模。

**Independent Test**: 对包含 runtime + workspace + cross-package 事实的 fixture 执行 056 生成，验证 `ArchitectureIR` 同时包含 system context、deployment、component 级基础实体与关系。

**Acceptance Scenarios**:

1. **Given** 一个已有 `architecture-overview` 所需事实的项目，**When** 生成 Architecture IR，**Then** `architecture-overview` 中的结构节点和关系会无损映射到 IR，而不是重新解析源码得到另一套结果。
2. **Given** 一个同时具备 runtime 和 workspace 信息的项目，**When** 生成 Architecture IR，**Then** 输出中同时包含 system context 和 deployment 所需的实体与关系。

---

### User Story 2 - 导出 Structurizr DSL 与结构化 JSON (Priority: P1)

作为架构文档消费者，我希望在同一份统一 IR 基础上得到 Structurizr DSL 和结构化 JSON，这样我既能接入外部渲染器，也能让后续流水线直接消费结构化数据。

**Why this priority**: 蓝图明确要求 056 成为统一架构 IR，并至少支持 Structurizr DSL 与 JSON 两种导出。

**Independent Test**: 对同一个 fixture 生成导出结果，验证 `.json` 和 `structurizr.dsl` 都存在，且都包含 system context / deployment 所需实体。

**Acceptance Scenarios**:

1. **Given** 一个存在 runtime/workspace 信息的项目，**When** 以 `all` 格式执行 056，**Then** 输出目录中存在 `architecture-ir.md`、`architecture-ir.json`、`architecture-ir.mmd` 与 `architecture-ir.dsl`。
2. **Given** 一个只请求 JSON 的调用，**When** 使用 `outputFormat=json`，**Then** 仍能得到可机器消费的 Architecture IR JSON，而不要求额外 DSL 文件。

---

### User Story 3 - 与 Mermaid / 现有 architecture-overview 保持互通 (Priority: P2)

作为维护者，我希望 056 与现有 Mermaid / architecture-overview 有清晰映射规则，这样新旧视图之间可以互通，而不是继续演化成两套不兼容模型。

**Why this priority**: 蓝图明确要求 “IR 与 Mermaid 输出之间有明确互通规则”。

**Independent Test**: 以已有 045 fixture 生成 Architecture IR，验证能够从 IR 重新得到 Mermaid 互通产物，并保留 system-context / deployment / component 三个 section 的边界。

**Acceptance Scenarios**:

1. **Given** 一个已有 `architecture-overview` 结果的项目，**When** 生成 Architecture IR，**Then** 输出中包含可回写 Mermaid 的 section 适配层，而不是只能生成 Structurizr。
2. **Given** 一个缺失 deployment 输入但存在 workspace 结构的项目，**When** 生成 Architecture IR，**Then** component/system context 仍能输出，缺失 deployment 必须显式标注为 unavailable/warning。

---

## Edge Cases

- 当 045 可用但 043 缺失时，IR 仍需保留 system context / component 事实，并对 deployment 视图做 section 级降级。
- 当项目是单包项目而非 monorepo 时，component 视图仍需至少包含 project 与关键 package / module group，而不是直接判定 056 不适用。
- 当 `architecture-overview` 的 section 没有 Mermaid 图源码时，056 仍需从结构模型生成 Mermaid 互通结果，不能依赖渲染后的 Markdown。
- 当某些关系只存在于 cross-package 或 runtime 输出中时，IR 必须保留其来源标签 `architecture-overview` / `runtime-topology` / `workspace-index` / `cross-package-deps`，避免事实不可追溯。
- 当 batch 运行 generator 失败时，056 的失败不能阻断其他 panoramic 文档输出。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增统一 `ArchitectureIR` 数据模型，作为 056 的唯一事实模型边界。
- **FR-002**: 056 MUST 优先从 `ArchitectureOverviewOutput.model` 映射现有架构节点、关系和证据，而不是重新解析源工程。
- **FR-003**: 056 MUST 允许使用 `RuntimeTopologyOutput`、`WorkspaceOutput` 与 `CrossPackageOutput` 作为属性补充和证据补充来源。
- **FR-004**: `ArchitectureIR` MUST 至少覆盖 `softwareSystem`、`container`、`component`、`deploymentNode`、`externalSystem` 五类基础实体映射。
- **FR-005**: `ArchitectureIR` MUST 至少覆盖 `systemContext`、`deployment`、`component` 三类 view，并保留 view 级可用性与 warning。
- **FR-006**: 系统 MUST 提供 Structurizr DSL 导出器，且导出结果必须来自 `ArchitectureIR`，不能把 Structurizr 当作新的事实源。
- **FR-007**: 系统 MUST 提供结构化 JSON 导出器，输出内容应可直接序列化并保留实体、关系、视图、证据与来源标签。
- **FR-008**: 系统 MUST 提供 Mermaid 互通适配层，明确 IR view 到 Mermaid section 的映射规则。
- **FR-009**: 系统 MUST 通过 `GeneratorRegistry` 注册 056 generator，并允许 batch 主链路自动发现和执行。
- **FR-010**: batch 项目级输出 MUST 在 `all` 模式下额外写出 `architecture-ir.dsl`，同时保持现有 `markdown/json/all` 合同兼容。
- **FR-011**: 056 MUST 复用现有 panoramic 结构化输出和模型，不得重新实现 Docker / Compose / workspace / cross-package / architecture-overview 的事实提取逻辑。
- **FR-012**: 056 的实现 MUST 保持 Codex / Claude 双端兼容，不引入依赖启动用户服务或绑定单一运行时的方案。

### Key Entities

- **ArchitectureIR**: 统一的架构中间表示，承载实体、关系、视图、证据、警告和导出元数据。
- **ArchitectureIRElement**: IR 内的实体节点，表示 system / container / component / deployment node / external system 等对象。
- **ArchitectureIRRelationship**: IR 内的关系边，表示依赖、部署、包含、调用或通信关系，并保留来源标签与证据。
- **ArchitectureIRView**: 对应 system context / deployment / component 的视图定义，包含元素选择、关系选择、可用性和 Mermaid 互通元数据。
- **ArchitectureIRExport**: 从统一 IR 派生的导出结果，包括 JSON 载荷、Structurizr DSL 文本和 Mermaid 互通结果。

## Success Criteria

- **SC-001**: 对存在 workspace/runtime 信息的项目执行 056 后，输出目录中存在 `architecture-ir.json` 或 `architecture-ir.dsl`，且至少覆盖 system context 与 deployment 所需实体。
- **SC-002**: `architecture-overview` 的结构节点与关系能够被无损映射到 `ArchitectureIR`，不需要重新解析源工程即可生成导出。
- **SC-003**: `GeneratorRegistry` 与 batch 主链路能够发现并调用 056 generator，且在 `all` 模式下写出 `.md/.json/.mmd/.dsl`。
- **SC-004**: IR 与 Mermaid 之间存在稳定互通规则；同一 fixture 上，IR 导出的 Mermaid section 数与 045 可用 section 对齐。
- **SC-005**: 至少 1 组 IR builder 单测、1 组 Structurizr/JSON exporter 测试、1 组集成测试通过，并补充 `npm run lint` 与 `npm run build` 结果。
