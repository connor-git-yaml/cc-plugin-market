# Feature Specification: 架构概览与系统上下文视图

**Feature Branch**: `045-architecture-overview-system-context`  
**Created**: 2026-03-20  
**Status**: Draft  
**Input**: User description: "推进 Feature 045，落地 ArchitectureOverviewGenerator，直接消费 043 的共享运行时模型以及 040/041 的结构化输出，生成系统上下文、部署视图和模块职责总览。"

---

## User Scenarios & Testing

### User Story 1 - 生成一份全局架构概览文档 (Priority: P1)

作为刚接手项目的维护者，我希望系统自动生成一份架构概览文档，把系统上下文、运行时部署拓扑和模块职责总览集中到同一份文档中，这样我无需分别阅读运行时拓扑、workspace 索引和跨包依赖图就能快速理解系统全貌。

**Why this priority**: 这是蓝图 4.3 为 Feature 045 定义的核心交付物，也是 043 共享运行时模型的第一位直接消费者。若不能生成这一份综合文档，045 的存在价值不成立。

**Independent Test**: 准备一个包含 Compose / Dockerfile、workspace 结构和跨包依赖关系的测试项目，运行 `ArchitectureOverviewGenerator` 的 `extract -> generate -> render` 全流程，验证输出中同时包含系统上下文视图、部署视图、分层视图和模块职责摘要。

**Acceptance Scenarios**:

1. **Given** 一个同时具备运行时拓扑和 workspace 结构的项目，**When** 运行 `ArchitectureOverviewGenerator`，**Then** 输出文档包含系统上下文视图、部署视图、packages/apps 分层视图和模块职责摘要四个核心版块。
2. **Given** 项目存在多个运行时服务和多个子包，**When** 生成架构概览，**Then** 文档能在同一处展示服务入口、部署单元和主要模块分层，而不是只输出原始数据列表。
3. **Given** 生成器完成渲染，**When** 用户查看文档，**Then** 可以从文档中识别系统入口、主要部署单元、关键模块组及其相互关系。

---

### User Story 2 - 保持与 043 / 041 输出一致的关系语义 (Priority: P1)

作为架构评审者，我希望架构概览中的系统/容器关系与 Feature 043 的运行时拓扑一致、包级依赖关系与 Feature 041 的跨包依赖拓扑一致，这样架构概览才能作为可信的上层总览，而不是另一套可能漂移的解释。

**Why this priority**: 蓝图把“一致性”列为 045 的第二条验收标准。若 045 自己重新解释或重建关系，后续 046/050 的上层能力会建立在不稳定事实之上。

**Independent Test**: 在测试中先生成 `RuntimeTopology` 与 `CrossPackageOutput`，再运行 `ArchitectureOverviewGenerator`，校验文档和结构化输出中的服务关系、容器映射和包依赖均能对齐原始上游输出。

**Acceptance Scenarios**:

1. **Given** `RuntimeTopology` 中存在 `gateway -> api` 的服务依赖和容器/镜像映射，**When** 生成部署视图，**Then** 045 的服务与容器关系保留相同的依赖方向和部署单元名称。
2. **Given** `CrossPackageOutput` 中存在 `apps/web -> packages/core -> packages/shared` 的依赖链，**When** 生成分层视图，**Then** 045 的模块分层和依赖摘要与该拓扑一致。
3. **Given** `RuntimeTopology` 中识别出 runtime stage 或目标 image，**When** 生成部署摘要，**Then** 045 不重新推断新的 stage 关系，而是直接引用 043 的结构化结果。

---

### User Story 3 - 在输入不完整时仍提供可读的降级架构概览 (Priority: P2)

作为使用 panoramic 生成器的用户，我希望当项目缺少 Compose、不是 monorepo，或者无法提供某一类上游结构化输出时，系统仍能生成一份“部分可用”的架构概览，并明确标注缺失项与降级原因，而不是直接失败。

**Why this priority**: Phase 2 的能力链需要尽可能覆盖不同项目形态。045 虽然强依赖 043 的实现路径，但在项目运行时信号不足时仍应保留静默降级能力，避免批量流程被单一输入缺失阻断。

**Independent Test**: 构造一个仅有 workspace 结构但没有 Compose 的项目，或只有运行时拓扑但无 monorepo 结构的项目，验证 045 仍能生成文档并列出缺失的视图版块。

**Acceptance Scenarios**:

1. **Given** 项目没有 Compose / Dockerfile 但存在 workspace 与跨包依赖信息，**When** 运行 045，**Then** 文档仍生成系统上下文和模块分层摘要，并明确标注部署视图不可用。
2. **Given** 项目不是 monorepo 但存在运行时拓扑，**When** 运行 045，**Then** 文档仍生成部署视图和系统上下文，并将 workspace / cross-package 相关版块降级为简化摘要。
3. **Given** 某个上游生成器因上下文不适用而返回空结果，**When** 生成 045，**Then** 输出包含 warning 或缺失提示，而不是抛出异常中断整体流程。

---

### User Story 4 - 通过 GeneratorRegistry 自动发现并调用 045 生成器 (Priority: P2)

作为 reverse-spec 用户，我希望 `ArchitectureOverviewGenerator` 能被 `GeneratorRegistry` 自动注册和发现，这样在 CLI / batch 流程中无需手动拼装依赖就能调用 045。

**Why this priority**: 若 045 不能被现有 panoramic 工具链发现，就无法在批量生成和后续验证链路中真正使用。

**Independent Test**: 调用 `bootstrapGenerators()` 后，通过 `GeneratorRegistry.getInstance().get('architecture-overview')` 获取到该生成器，并验证具备运行时或 workspace 信号的上下文能通过 `filterByContext()` 发现它。

**Acceptance Scenarios**:

1. **Given** 已执行 `bootstrapGenerators()`，**When** 通过 id `architecture-overview` 查询，**Then** 返回 `ArchitectureOverviewGenerator` 实例。
2. **Given** 一个具备运行时拓扑或 workspace 结构信号的项目上下文，**When** 调用 `filterByContext()`，**Then** 结果包含 `ArchitectureOverviewGenerator`。

---

### User Story 5 - 为 050 预留结构化架构视图模型 (Priority: P2)

作为后续 Feature 050 的实现者，我希望 045 除了渲染 Markdown 之外，还能产出一份与模板解耦的结构化架构视图模型，包含视图节点、关系、模块职责和证据来源，这样 050 可以直接在此基础上追加模式提示与解释，而不必重新拼装关系图。

**Why this priority**: 蓝图明确规定 050 作为 045 的增强层接入，而不是独立黑盒报告。若 045 的输出只剩 Markdown，050 会被迫重复建模。

**Independent Test**: 检查 `ArchitectureOverviewOutput` 中存在可独立消费的结构化视图模型，且模型不包含 Handlebars / Markdown 字段；验证 050 所需的证据来源字段已保留。

**Acceptance Scenarios**:

1. **Given** 045 的 `generate()` 输出，**When** 读取结构化视图模型，**Then** 可以直接访问系统上下文节点、部署单元、模块职责和关系边，而不依赖渲染结果。
2. **Given** 未来 050 需要追加模式解释，**When** 使用 045 的结构化输出，**Then** 能复用节点关系和来源证据，而无需再次解析 043/040/041 的原始输入。

---

### Edge Cases

- 项目只有单体目录结构，没有 `packages/` / `apps/` 分组时，系统仍应生成简化的模块职责总览。
- 项目只有 Dockerfile 没有 Compose，或只有 Compose 没有关联 workspace 结构时，生成器应只降级受影响的版块，而不是整体失败。
- `CrossPackageOutput` 含循环依赖组时，分层视图需要保留循环标记或警告，而不能假装依赖是严格 DAG。
- 多个服务都暴露端口时，系统上下文视图应能区分入口服务与内部服务，避免所有服务都被视为“外部入口”。
- 若上游结构化输出为空或来源文件缺失，文档必须显式标注缺失依据与降级原因。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 `src/panoramic/architecture-overview-generator.ts` 中实现 `DocumentGenerator<ArchitectureOverviewInput, ArchitectureOverviewOutput>`，使用 id `'architecture-overview'`。
- **FR-002**: 系统 MUST 通过组合现有 `RuntimeTopologyGenerator`、`WorkspaceIndexGenerator` 和 `CrossPackageAnalyzer` 的结构化输出构建架构概览，不得重新实现 Dockerfile / Compose / workspace / 依赖图的基础解析逻辑。
- **FR-003**: 系统 MUST 生成一份架构概览文档，至少包含系统上下文视图、部署视图、packages/apps 分层视图和模块职责摘要。
- **FR-004**: 系统 MUST 保证架构概览中的服务、容器、镜像和 stage 关系与 `RuntimeTopology` 一致，不得在 045 中重新推导另一套运行时关系。
- **FR-005**: 系统 MUST 保证分层视图与模块关系摘要和 `CrossPackageOutput` / `WorkspaceOutput` 一致，保留跨包依赖、循环依赖和 workspace 分组信息。
- **FR-006**: 系统 MUST 在上游输入缺失时对受影响版块做静默降级，并在输出中保留 warning / missing section 提示。
- **FR-007**: 系统 MUST 在 `generate()` 阶段产出与模板解耦的结构化架构视图模型，供未来 Feature 050 直接消费。
- **FR-008**: 系统 MUST 将 Handlebars / Markdown 细节限制在 `render()` 和 `templates/architecture-overview.hbs` 层，不得把渲染字段混入共享架构视图模型。
- **FR-009**: 系统 MUST 在 `src/panoramic/generator-registry.ts` 的 `bootstrapGenerators()` 中注册 `ArchitectureOverviewGenerator`。
- **FR-010**: 系统 MUST 在 `src/panoramic/index.ts` 中导出 `ArchitectureOverviewGenerator` 及其结构化输出类型 / helper。
- **FR-011**: 系统 MUST 为系统上下文视图、部署视图和分层视图生成可嵌入 Markdown 的 Mermaid 源文本。
- **FR-012**: 系统 SHOULD 在结构化输出中保留节点和关系的来源证据（例如来自 runtime topology、workspace index、cross-package analyzer），为 050 的解释链预留输入。
- **FR-013**: 系统 MAY 在存在数据模型文档或配置文档时，在架构概览中追加链接或引用摘要，但这不是 045 的阻塞项。

### Key Entities

- **ArchitectureOverviewInput**: `extract()` 阶段输出，包含 `RuntimeTopologyOutput`、`WorkspaceOutput`、`CrossPackageOutput` 及 warning / availability 元信息。
- **ArchitectureOverviewModel**: 045 的结构化架构视图模型，承载系统上下文、部署视图、分层视图、模块职责和来源证据，是 050 的直接输入边界。
- **ArchitectureContextNode**: 系统上下文中的节点定义，可表示系统入口、内部服务、外部依赖或模块组。
- **DeploymentUnit**: 部署视图中的服务/容器/image/stage 组合单元，来自 043 的共享运行时模型。
- **ArchitectureModuleGroup**: workspace 或逻辑层分组，包含子包列表、职责摘要和组间依赖。
- **ArchitectureRelationship**: 统一关系边，表示系统上下文、部署或模块层之间的依赖 / 调用 / 部署关系，并附带来源证据。

### Traceability Matrix

| FR | User Story |
|----|-----------|
| FR-001, FR-002, FR-003 | US1, US4 |
| FR-004, FR-005 | US2 |
| FR-006 | US3 |
| FR-007, FR-008, FR-012 | US5 |
| FR-009, FR-010 | US4, US5 |
| FR-011 | US1, US2 |
| FR-013 | US1, US3 |

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对具备运行时拓扑与 workspace 结构的测试项目运行 `ArchitectureOverviewGenerator` 后，输出文档同时包含系统上下文视图、部署视图、分层视图和模块职责摘要四类核心内容。
- **SC-002**: 架构概览中的服务/容器关系与 `RuntimeTopology` 一致，包级依赖关系与 `CrossPackageOutput` 一致，对应测试断言全部通过。
- **SC-003**: 在缺少 runtime topology 或缺少 workspace / cross-package 输入的降级场景中，生成器仍返回可渲染输出，并显式记录缺失版块和 warning。
- **SC-004**: `bootstrapGenerators()` 后可通过 `GeneratorRegistry.getInstance().get('architecture-overview')` 查询到该生成器；`filterByContext()` 在具备运行时或 workspace 信号的上下文中返回该生成器。
- **SC-005**: 新增单元 / 集成测试通过，至少覆盖一组“043 + 040 + 041 联合组合”测试和一组“部分输入缺失”的降级测试。
- **SC-006**: `npm run lint`、相关 `vitest` 用例和 `npm run build` 全部通过，无类型错误。
