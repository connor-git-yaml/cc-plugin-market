# Feature Specification: 架构模式提示与解释

**Feature Branch**: `050-pattern-hints-explanation`  
**Created**: 2026-03-20  
**Status**: Implemented
**Input**: User description: "推进 050，落地 `PatternHintsGenerator`，以 045 的架构概览为主载体输出架构模式提示、证据链和替代方案。"

---

## User Scenarios & Testing

### User Story 1 - 在架构概览中看到已识别的架构模式 (Priority: P1)

作为新接手项目的维护者，我希望在阅读架构概览时能直接看到系统可能采用的架构模式、置信度和简短说明，这样我无需再单独从部署图、模块分层图和包依赖关系中自己拼出“这是模块化单体还是服务拆分”的结论。

**Why this priority**: 蓝图明确要求 050 作为 045 的增强层，以架构概览为主载体追加模式提示；如果不能在现有架构概览中直接给出模式提示，050 的核心交付物就不成立。

**Independent Test**: 准备一个具有明确架构特征的 fixture，先生成 045 的架构概览，再运行 `PatternHintsGenerator`，验证输出包含至少一个模式名称、置信度和附录版块。

**Acceptance Scenarios**:

1. **Given** 一个在 045 中已生成 system context、deployment 和 layered 视图的项目，**When** 运行 `PatternHintsGenerator`，**Then** 架构概览中新增“架构模式提示”附录，列出至少一个模式名称、摘要和置信度。
2. **Given** 一个存在明显服务边界和独立部署单元的项目，**When** 050 生成模式提示，**Then** 输出能基于 045 的结构化结果识别出对应模式，而不是只复述原始节点列表。
3. **Given** 一个只有模块分层、没有复杂部署信号的项目，**When** 运行 050，**Then** 仍能输出适配该项目形态的模式判断或“未识别到高置信度模式”的明确结论。

---

### User Story 2 - 理解“为何判定”与“为何不是其他模式” (Priority: P1)

作为架构评审者，我希望每个模式提示都附带证据链，并且至少对一个高价值模式给出“为何判定 / 为何不是其他模式”的解释，这样模式输出不是一个黑盒标签，而是可复核、可质疑、可追踪的判断。

**Why this priority**: 蓝图将“证据链 + 至少一个 why/why-not explanation”写成了 050 的核心验收标准；如果没有解释，模式提示无法被后续评审信任。

**Independent Test**: 对一个同时具备多种候选信号的 fixture 运行 050，验证输出中至少一个模式包含 matched evidence、competing alternative 和 why/why-not 解释。

**Acceptance Scenarios**:

1. **Given** 一个识别出高置信度模式的项目，**When** 050 输出模式提示，**Then** 每个模式都附带来源于架构节点、关系或上游结构化结果的证据链。
2. **Given** 一个模式与另一候选模式存在竞争关系，**When** 050 生成 explanation，**Then** 至少一个模式说明中同时包含“为何判定”为该模式，以及“为何不是另一种相近模式”。
3. **Given** 一个 pattern hint 使用了弱信号或推断性描述，**When** 用户阅读说明，**Then** 输出中保留 `[推断]` 或等价标记，而不是把不确定性写成确定事实。

---

### User Story 3 - 在输入不完整或 LLM 不可用时仍输出可审查结果 (Priority: P2)

作为 panoramic 使用者，我希望当 045 的某些版块缺失、043/044 的弱依赖信息不可用，或者 `useLLM=true` 时外部模型不可用，系统仍然能输出一份基于规则的可审查结果，并明确标出置信度下降或证据不足，而不是整份模式提示失败。

**Why this priority**: 050 位于实验性增强层，但不能因为缺少某个弱依赖或在线能力就阻断主文档；蓝图要求这些高级能力在共享模型稳定后以增强方式接入。

**Independent Test**: 构造一个仅有部分 architecture sections 的 fixture，分别在 `useLLM=false` 和 `useLLM=true` 但 LLM 不可用场景下运行 050，验证仍有可渲染输出和 warning。

**Acceptance Scenarios**:

1. **Given** 045 只生成了 system context 和 layered view，没有 deployment view，**When** 运行 050，**Then** 输出仍能生成模式提示，但对依赖部署证据的模式降低置信度或给出缺失说明。
2. **Given** `useLLM=true` 且外部模型调用不可用，**When** 运行 050，**Then** 生成器静默降级为规则驱动输出，不抛出异常。
3. **Given** 没有任何模式达到最低置信度阈值，**When** 用户查看结果，**Then** 文档中明确显示“未识别到高置信度模式”，而不是输出空白版块。

---

### User Story 4 - 通过 registry 和 panoramic 主流程发现 050 生成器 (Priority: P2)

作为 reverse-spec 用户，我希望 `PatternHintsGenerator` 能像其他 panoramic generator 一样被 registry 发现，并在具备架构概览信号的项目中自动适用，这样我无需手工拼接调用链。

**Why this priority**: 如果 050 不能进入现有 panoramic 主流程，它就只能是一个手工调用的附属脚本，无法成为正式 feature。

**Independent Test**: 调用 `bootstrapGenerators()` 后，通过 `GeneratorRegistry` 查询 `pattern-hints`；同时验证具备 045 适用信号的项目能发现 050。

**Acceptance Scenarios**:

1. **Given** 已执行 `bootstrapGenerators()`，**When** 通过 id `pattern-hints` 查询，**Then** 返回 `PatternHintsGenerator` 实例。
2. **Given** 一个至少具备 045 架构概览信号的项目上下文，**When** 调用 `filterByContext()`，**Then** 结果包含 `PatternHintsGenerator`。

---

### User Story 5 - 维护一份可演进的模式知识库与结构化输出 (Priority: P2)

作为后续维护 050 规则集的开发者，我希望模式定义、证据规则和输出结构彼此解耦，这样新增一个模式或调整某个阈值时，不需要改动模板渲染或重新设计整个输出协议。

**Why this priority**: 050 属于实验性能力，后续规则会不断修正；如果没有稳定的知识库和结构化边界，后续演进成本会很高。

**Independent Test**: 检查 050 的 `generate()` 输出中存在模板无关的 pattern hints 结构，并验证知识库字段足以表达 pattern、signals、alternatives 和 warnings。

**Acceptance Scenarios**:

1. **Given** 050 的结构化输出，**When** 读取 pattern hints 数据，**Then** 可以直接访问 pattern、confidence、evidence、alternatives 和 explanation，而不依赖 Markdown。
2. **Given** 后续需要新增一个新的架构模式规则，**When** 调整知识库定义，**Then** 不需要同步修改 045 的共享视图模型结构。

---

### Edge Cases

- 一个项目可能同时命中多个模式，例如“模块化单体”与“分层架构”；系统需要支持多模式并列，而不是强制单选。
- 某些证据可能相互冲突，例如模块层强耦合但运行时部署相对分散；系统需要保留冲突说明或降低置信度。
- 045 某个版块不可用时，系统必须只降级受影响的模式判断，不能整体失败。
- 没有任何模式达到最低置信度时，文档必须输出明确结论而不是空白附录。
- `useLLM=true` 但外部模型不可用或超时时，结构化事实与置信度必须保持可追踪的规则驱动结果。
- 若 044 的文档图谱或其他弱依赖证据不存在，系统仍需继续工作，并标记相关 explanation 深度受限。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 `src/panoramic/pattern-hints-generator.ts` 中实现 `DocumentGenerator<PatternHintsInput, PatternHintsOutput>`，使用 id `'pattern-hints'`。
- **FR-002**: 系统 MUST 以 Feature 045 的 `ArchitectureOverviewModel` 或等价结构化输出作为 050 的主输入边界，不得重新解析 Dockerfile、Compose、workspace、import graph 或其他底层项目事实。
- **FR-003**: 系统 MUST 输出结构化 pattern hints，至少包含模式名称、摘要、置信度、证据链和对应的架构版块。
- **FR-004**: 系统 MUST 将 050 的用户可见结果以内嵌附录或等价追加版块的方式挂接到架构概览上，而不是交付脱离上下文的黑盒独立报告。
- **FR-005**: 系统 MUST 对至少一个已识别模式提供“为何判定 / 为何不是其他模式”的解释，并在解释中引用可追踪的证据。
- **FR-006**: 系统 MUST 保留 evidence 引用，能够指向 045 的视图节点/关系或其上游来源，供用户复核模式判断。
- **FR-007**: 系统 MUST 支持多个已识别模式并列输出，并能表达 competing alternatives、次优候选或冲突信号。
- **FR-008**: 系统 MUST 在输入不完整、证据不足或某类视图缺失时静默降级，并在输出中记录 warning、missing reason 或置信度下降原因。
- **FR-009**: 系统 MUST 在没有任何模式达到最低阈值时明确输出“未识别到高置信度模式”的结论。
- **FR-010**: 系统 MUST 维护一份内置的架构模式知识库或等价规则目录，将模式定义、命中信号、反证信号和解释元数据与模板渲染解耦。
- **FR-011**: 系统 MUST 将模板 / Markdown 细节限制在 `render()` 与模板层，结构化 `PatternHint` 输出不得混入 Handlebars 或 Markdown 字段。
- **FR-012**: 系统 SHOULD 在 `useLLM=true` 时使用模型增强 explanation、替代方案表述或摘要措辞，但结构化事实、置信度和证据链 MUST 仍由规则和共享模型决定。
- **FR-013**: 系统 MUST 在 `useLLM=false` 或 LLM 不可用时继续输出规则驱动结果，不得因 explanation 增强失败而中断。
- **FR-014**: 系统 SHOULD 在弱依赖信号可用时复用 043 / 044 的结构化证据增强说明深度，但缺失这些弱依赖时不得阻断 050 主流程。
- **FR-015**: 系统 MUST 在 `src/panoramic/generator-registry.ts` 中注册 `PatternHintsGenerator`，并在 `src/panoramic/index.ts` 中导出 generator、共享类型与 helper。

### Key Entities

- **PatternHintsInput**: 050 的输入边界，至少包含 `ArchitectureOverviewOutput` 或 `ArchitectureOverviewModel`，以及可选的弱依赖证据和 warning 元信息。
- **PatternKnowledgeBaseEntry**: 单个架构模式的定义项，描述模式名称、命中信号、反证信号、解释模板和替代模式关系。
- **PatternHint**: 单个已识别或近似命中的模式结果，包含模式名称、confidence、summary、evidence、matchedSignals、missingSignals 和 alternatives。
- **PatternEvidenceRef**: 证据引用，指向 architecture section、node、edge 或上游来源，用于解释 why/why-not。
- **PatternAlternative**: 与当前模式竞争的候选模式，包含名称、未命中原因和与主模式的区分点。
- **PatternHintsOutput**: 050 的结构化输出，承载 pattern hints、warnings、统计与可选 explanation 附录，是模板层的直接输入。

### Traceability Matrix

| FR | User Story |
|----|-----------|
| FR-001, FR-002, FR-003, FR-004 | US1, US4 |
| FR-005, FR-006, FR-007 | US2 |
| FR-008, FR-009, FR-012, FR-013, FR-014 | US3 |
| FR-010, FR-011, FR-015 | US5, US4 |

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对具备明确架构特征的 fixture 运行 045 + 050 后，输出中至少包含 1 个带模式名称、置信度和证据链的模式提示。
- **SC-002**: 至少 1 个模式提示包含“为何判定 / 为何不是其他模式”的 explanation，且 explanation 中引用的证据均可追溯到结构化输入。
- **SC-003**: 在 045 存在部分版块缺失、或 `useLLM=true` 但模型不可用的场景下，050 仍返回可渲染输出，并显式记录 warning / 降级原因。
- **SC-004**: 对无明显架构模式的 fixture，050 输出明确的“未识别到高置信度模式”提示，而不是空白或异常。
- **SC-005**: `bootstrapGenerators()` 后可通过 `GeneratorRegistry.getInstance().get('pattern-hints')` 查询到该生成器；适用上下文的 `filterByContext()` 结果包含它。
- **SC-006**: 新增测试至少覆盖一组“045 架构概览输入 -> 050 模式提示输出”场景和一组“LLM/弱依赖降级”场景，且 `npm run lint`、相关 `vitest` 用例与 `npm run build` 通过。
