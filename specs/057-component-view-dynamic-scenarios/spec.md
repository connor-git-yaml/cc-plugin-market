# Feature Specification: 组件视图与动态链路文档

**Feature Branch**: `057-component-view-dynamic-scenarios`  
**Created**: 2026-03-21  
**Status**: Implemented  
**Input**: User description: "推进任务 57"

---

## User Scenarios & Testing

### User Story 1 - 输出关键组件视图 (Priority: P1)

作为维护者，我希望在现有项目级架构文档之上继续下钻到关键组件，而不是只看到 `src/` / `tests/` 级别的模块摘要，这样我才能快速识别项目的核心 class / function / adapter 边界。

**Why this priority**: 057 的第一价值就是把 056 的 component 层“结构占位”扩展成真正可读的组件文档；如果没有这一层，下游 ADR 和质量门依然只能停留在粗粒度模块视角。

**Independent Test**: 对已有 `architecture-ir` 和 module specs 的 fixture 执行 057，验证生成 `component-view.md/.json/.mmd`，且输出包含关键组件、职责、关系和证据引用。

**Acceptance Scenarios**:

1. **Given** 一个已经生成 `architecture-ir` 和 module specs 的项目，**When** 运行 057，**Then** 输出的 component view 会列出关键组件、组件职责、上下游关系和证据来源，而不是仅复述目录名称。
2. **Given** 一个类似 `claude-agent-sdk-python` 的单包 Python 项目，**When** 运行 057，**Then** component view 至少能识别 `Query`、`ClaudeSDKClient`、`InternalClient`、`SubprocessCLITransport` 这类关键组件或同等级关键对象。

---

### User Story 2 - 输出可讲述的动态场景链路 (Priority: P1)

作为新维护者，我希望系统给出关键动态场景的步骤链路，让我能看懂“入口函数如何把请求送到 transport、再到解析或状态处理层”，而不是自己从多个模块 spec 和测试里手工拼图。

**Why this priority**: 蓝图把 “dynamic scenario” 明确作为 057 的核心交付物；如果只有 component list 没有链路说明，架构文档仍然缺少真正可操作的阅读价值。

**Independent Test**: 对带有 `query()` / transport / parser 信号的 fixture 执行 057，验证生成 `dynamic-scenarios.md/.json`，且至少 1 条 scenario 具有有序步骤、参与者、hand-off 描述和 evidence。

**Acceptance Scenarios**:

1. **Given** 一个存在请求入口、transport 和解析步骤信号的项目，**When** 运行 057，**Then** 至少 1 条 scenario 能清晰描述从 `query()` 到 CLI transport 再到消息解析的链路，而不是只罗列方法名。
2. **Given** 一个事件流或 session 流证据较弱的项目，**When** 运行 057，**Then** 系统会保守输出可确认的步骤并降低 confidence，而不是编造完整链路。

---

### User Story 3 - 批量项目文档套件保持兼容 (Priority: P2)

作为维护者，我希望 057 能被接入现有 batch 项目级文档套件，同时不破坏现有 `architecture-overview`、`architecture-ir`、`event-surface`、ADR 等输出，这样项目级文档链路可以持续保持单次 batch 即可交付。

**Why this priority**: 057 强依赖 053；如果不能无缝接回 batch 套件，它就会变成另一个需要手工补跑的孤立工具。

**Independent Test**: 运行 batch 集成测试，验证原有 project docs 仍然可用，并新增 `component-view.*` 与 `dynamic-scenarios.*` 输出。

**Acceptance Scenarios**:

1. **Given** 一个现有 batch fixture，**When** 执行 `runBatch()`，**Then** 原有项目级文档仍全部生成，同时新增 `component-view.md/.json/.mmd` 与 `dynamic-scenarios.md/.json`。
2. **Given** 一个缺失部分组件或链路证据的项目，**When** 057 在 batch 中运行，**Then** 它只对自身输出 warning 或部分降级，不影响其他项目级文档生成。

---

### Edge Cases

- 当 `ArchitectureIR` 存在但 component view 元素较少时，057 仍需输出可用组件与 warning，而不是直接判定“不适用”。
- 当 stored module specs 中测试类、fixture helper、`test_*` 方法数量很多时，组件排序必须抑制测试噪音，避免测试实现挤占关键组件位次。
- 当同一主链路可从 request flow、event flow、session flow 多个角度描述时，系统需要合并或排序，避免输出大量重复 scenario。
- 当事件流或 runtime 信号缺失时，dynamic scenarios 仍需基于 module spec / baseline skeleton / IR 关系保守输出主要请求链路。
- 当项目是 monorepo 时，component view 不能把所有包都摊平成同一级组件清单；需要保留 package / subsystem 归属。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 以 056 `ArchitectureIR` 作为 057 的主结构输入，不得重新建立另一套项目级架构事实模型。
- **FR-002**: 系统 MUST 生成 `component-view.md`、`component-view.json`、`component-view.mmd` 三种输出。
- **FR-003**: 系统 MUST 生成 `dynamic-scenarios.md`、`dynamic-scenarios.json` 两种输出。
- **FR-004**: component view MUST 输出关键组件、组件职责、组件关系、组件归属和证据引用，而不是只输出目录或 package 名称。
- **FR-005**: 系统 MUST 复用 batch 已生成的 module specs / baseline skeleton / narrative 级符号信息，对 `ArchitectureIR` 做组件粒度下钻。
- **FR-006**: 系统 MUST 对候选组件做角色化排序，优先保留 runtime entrypoint、client、transport、parser、session、store、adapter 等高信号组件，并抑制测试噪音。
- **FR-007**: dynamic scenarios MUST 以有序步骤表达关键链路，每一步至少包含参与者、动作说明、可选目标对象、evidence 和 confidence。
- **FR-008**: 系统 MUST 支持在有足够证据时生成 request flow、control flow、event flow、session flow 等关键场景中的至少一部分，而不是只支持单一模板。
- **FR-009**: 当 event/runtime/test 证据缺失时，系统 MUST 保守降级，只输出能由现有静态证据支持的组件或步骤，并显式记录 warning。
- **FR-010**: 057 MUST 接入现有 batch 项目级文档套件，并将新增输出纳入 `BatchResult.projectDocs` 可见结果。
- **FR-011**: 057 MUST 不破坏现有 `architecture-overview`、`architecture-ir`、`event-surface`、`pattern-hints`、ADR pipeline 与其他 batch 项目文档合同。
- **FR-012**: 057 的共享结构化输出 MUST 为后续 059 provenance / quality gate 预留 `evidence` 与 `confidence` 字段，但 MUST NOT 在本 Feature 中提前实现 059 的治理逻辑。
- **FR-013**: 057 的实现 MUST 保持 Codex / Claude 双端兼容，不引入要求用户额外启动服务、运行 tracing agent 或依赖单一运行时的工作流。

### Key Entities

- **ComponentViewModel**: 组件视图的共享结构化模型，包含组件清单、分组、关系、Mermaid 元数据、warnings 和 summary。
- **ComponentDescriptor**: 单个关键组件的结构化条目，记录名称、类别、职责、归属子系统、关键方法、上下游关系、evidence 和 confidence。
- **DynamicScenarioModel**: 动态场景文档的共享结构化模型，汇总项目中识别出的关键 scenario、warnings 和统计摘要。
- **DynamicScenario**: 单条关键场景，包含标题、类型、触发入口、参与组件、步骤列表、结果和 confidence。
- **DynamicScenarioStep**: 场景中的单个步骤，记录 actor、action、target、evidence、sourceType 和可选的 inferred 标记。
- **ComponentEvidenceRef**: 组件或场景步骤的证据引用，指向 `architecture-ir`、module spec、baseline skeleton、event-surface、runtime-topology 或测试文件的具体来源。

## Success Criteria

- **SC-001**: 在带有 `architecture-ir` 和 module specs 的项目上执行 057 后，输出目录中存在 `component-view.md/.json/.mmd` 与 `dynamic-scenarios.md/.json`。
- **SC-002**: 对 `claude-agent-sdk-python` 或等价 fixture，component view 至少能稳定识别 `Query`、`ClaudeSDKClient`、`InternalClient`、`SubprocessCLITransport` 这类关键组件。
- **SC-003**: 至少 1 条 dynamic scenario 能清晰表达从 `query()` 到 CLI transport 再到消息解析的链路，并包含 ordered steps 与 evidence。
- **SC-004**: 接入 057 后，相关 unit/integration tests、`npm run lint` 和 `npm run build` 全部通过，且现有 batch 项目级文档套件不回归。
- **SC-005**: 057 的结构化输出中包含 `evidence` / `confidence` 字段，能为后续 059 提供直接可消费的输入，而不需要再次重建模型。

## Clarifications

### Session 2026-03-21

- [AUTO-CLARIFIED: 组件粒度以“关键 exported class/function + runtime boundary object”为主，不追求全量符号铺开 — 这样才能满足可读性与 057 的交付边界]
- [AUTO-CLARIFIED: dynamic scenario 的 canonical steps 由确定性证据构建，后续如需 explanation 只作为渲染增强 — 这样能避免 057 过早引入 059 级别的可信度问题]
- [AUTO-CLARIFIED: `event-surface`、`runtime-topology`、测试文件属于弱增强信号，不作为 057 的阻塞前提 — 这样既符合蓝图“关键链路”目标，也保持单包项目可降级运行]
