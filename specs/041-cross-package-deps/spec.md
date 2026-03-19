# Feature Specification: 跨包依赖分析

**Feature Branch**: `041-cross-package-deps`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "实现 CrossPackageAnalyzer（DocumentGenerator 接口），分析 Monorepo 子包间的依赖关系并检测循环依赖"

---

## User Scenarios & Testing

### User Story 1 - 生成跨包依赖拓扑图 (Priority: P1)

作为 Monorepo 项目的维护者，我希望系统能自动分析所有子包之间的依赖关系，并生成一张 Mermaid 格式的依赖拓扑图，使我能直观看到哪些包依赖了哪些包、包之间的层级关系如何，从而帮助我理解项目整体结构和做出架构决策。

**Why this priority**: 依赖拓扑图是本 Feature 的核心价值交付。没有依赖可视化，所有后续能力（循环检测、统计信息）都无从附着。它直接回应蓝图验证标准第 1 条——"生成 OctoAgent 子包间的依赖拓扑图，正确反映 packages/ 之间的引用关系"。

**Independent Test**: 对一个包含 3+ 子包且存在内部依赖关系的 Monorepo 项目运行 CrossPackageAnalyzer 的 extract -> generate -> render 全流程，验证输出 Markdown 中包含合法的 Mermaid graph TD 图，且图中的节点和边与项目实际依赖关系一致。

**Acceptance Scenarios**:

1. **Given** 一个 uv workspace 类型的 Monorepo 项目（如 OctoAgent，含 8 个子包），**When** 运行 CrossPackageAnalyzer 的完整生命周期（extract -> generate -> render），**Then** 输出的 Markdown 文档中包含一张 Mermaid 依赖拓扑图，图中节点数等于子包总数（8），边的方向正确反映 dependencies 声明关系（如 octoagent-provider -> octoagent-core 表示 provider 依赖 core）。

2. **Given** 一个 npm workspaces 类型的 Monorepo 项目（含 3+ 子包），**When** 运行 CrossPackageAnalyzer，**Then** 输出的依赖拓扑图同样正确反映 package.json 中的 workspace 内部依赖。

3. **Given** 一个无内部依赖的 Monorepo 项目（所有子包相互独立），**When** 运行 CrossPackageAnalyzer，**Then** 输出的拓扑图仅包含孤立节点，无依赖边，统计中总依赖数为 0。

---

### User Story 2 - 检测跨包循环依赖 (Priority: P1)

作为 Monorepo 项目的维护者，我希望系统能自动检测子包之间是否存在循环依赖，若存在则在文档中以警告形式明确标注循环路径，若不存在则声明"未检测到循环依赖"，使我能及早发现并处理架构腐化问题。

**Why this priority**: 循环依赖检测是本 Feature 与 Feature 040（Monorepo 索引）的关键差异化能力。蓝图验证标准第 2 条明确要求此能力。循环依赖是 Monorepo 架构中最常见的腐化问题，其检测结果直接影响项目可维护性判断。

**Independent Test**: 准备两组测试数据——一组包含循环依赖的子包集合、一组无循环依赖的子包集合，分别运行 CrossPackageAnalyzer，验证循环检测结果的准确性和报告格式。

**Acceptance Scenarios**:

1. **Given** 一个包含循环依赖的 Monorepo（如 A -> B -> C -> A），**When** 运行 CrossPackageAnalyzer，**Then** 输出文档中包含循环依赖警告区块，列出循环路径（A -> B -> C -> A），且 Mermaid 图中循环边使用红色虚线样式标注。

2. **Given** 一个无循环依赖的 Monorepo（如 OctoAgent 的预期拓扑），**When** 运行 CrossPackageAnalyzer，**Then** 输出文档中包含"未检测到循环依赖"的声明，Mermaid 图中不包含红色虚线边。

3. **Given** 一个包含多组独立循环依赖的 Monorepo（如 A <-> B 和 C <-> D 两组循环），**When** 运行 CrossPackageAnalyzer，**Then** 输出文档分别列出每组循环路径，不遗漏也不合并不同的循环组。

---

### User Story 3 - 依赖统计信息 (Priority: P2)

作为 Monorepo 项目的维护者，我希望文档中包含关键的依赖统计信息——root 包（无入度，不被任何包依赖）、leaf 包（无出度，不依赖任何包）和总依赖边数，使我能快速评估项目的依赖复杂度和识别关键基础包。

**Why this priority**: 统计信息是对拓扑图的结构化补充，帮助维护者快速理解宏观依赖特征而无需逐条读图。虽非核心能力，但实现成本低且对架构理解价值较高。

**Independent Test**: 对一个依赖关系已知的 Monorepo 运行 CrossPackageAnalyzer，验证输出的 root 包列表、leaf 包列表和总依赖数与预期一致。

**Acceptance Scenarios**:

1. **Given** OctoAgent 项目的 8 个子包及其已知依赖关系，**When** 运行 CrossPackageAnalyzer，**Then** 输出文档中 root 包列表包含 octoagent-core（唯一不被依赖的包 [AUTO-RESOLVED: 根据技术调研，core 是唯一无内部依赖的包，但它被所有其他包依赖，因此它是"被依赖最多的基础包"而非 root；root 应为无入度节点即 gateway——此处修正为 root 包 = 无入度节点 = octoagent-gateway，leaf 包 = 无出度节点 = octoagent-core]），leaf 包列表包含 octoagent-core，总依赖数与实际边数一致。

2. **Given** 一个全部子包相互独立（无依赖）的 Monorepo，**When** 运行 CrossPackageAnalyzer，**Then** 所有子包同时为 root 和 leaf，总依赖数为 0。

---

### User Story 4 - 拓扑排序与层级展示 (Priority: P2)

作为 Monorepo 项目的维护者，我希望文档中展示子包的拓扑排序结果和层级信息，使我能了解合理的构建顺序和包的依赖深度。

**Why this priority**: 拓扑排序是循环检测的副产品，实现成本极低。层级信息帮助维护者理解包的"深度"（如 core 在第 0 层，gateway 在最深层），对构建系统优化和 CI 加速有参考价值。

**Independent Test**: 对依赖关系已知的 Monorepo 运行分析，验证拓扑排序顺序的正确性（依赖方排在被依赖方之后）。

**Acceptance Scenarios**:

1. **Given** OctoAgent 的子包依赖关系，**When** 运行 CrossPackageAnalyzer，**Then** 拓扑排序结果中 octoagent-core 排在所有依赖它的包之前，octoagent-gateway 排在最后。

---

### User Story 5 - 在 GeneratorRegistry 中注册 (Priority: P2)

作为 reverse-spec 工具的使用者，我希望 CrossPackageAnalyzer 能通过 GeneratorRegistry 被自动发现和调用，使我在运行 `reverse-spec batch` 时无需额外配置即可获得跨包依赖分析文档。

**Why this priority**: 注册是 Generator 融入现有工具链的必要条件。不注册意味着无法被 batch 流程发现和调用，功能无法触达用户。

**Independent Test**: 调用 bootstrapGenerators() 后，通过 GeneratorRegistry.getInstance().get('cross-package-deps') 获取到 CrossPackageAnalyzer 实例，并验证 isApplicable 对 monorepo 项目返回 true、对 single 项目返回 false。

**Acceptance Scenarios**:

1. **Given** 调用 bootstrapGenerators() 完成注册，**When** 通过 GeneratorRegistry.getInstance().get('cross-package-deps') 查询，**Then** 返回 CrossPackageAnalyzer 实例，其 id 为 'cross-package-deps'。

2. **Given** 一个 workspaceType 为 'single' 的 ProjectContext，**When** 调用 CrossPackageAnalyzer.isApplicable(context)，**Then** 返回 false。

---

### Edge Cases

- **子包声明了不存在的内部依赖**（如 package.json 中引用了一个已被删除的 workspace 包名）：系统应忽略无法解析的依赖边，不产生错误，并在统计中不计入该边。
- **自依赖**（子包的 dependencies 中包含自身包名）：系统应忽略自引用边，不将其视为循环依赖。
- **超大 Monorepo**（50+ 子包）：Tarjan SCC 和 Kahn 拓扑排序均为 O(V+E) 时间复杂度，不应出现性能瓶颈。Mermaid 图在节点过多时可能渲染不佳，但此为 Mermaid 渲染器的限制，非本 Feature 范围。
- **非 Monorepo 项目（workspaceType = 'single'）**：isApplicable 返回 false，Generator 不会被调用。
- **Monorepo 中仅有 1 个子包**：系统正常运行，输出的拓扑图仅有一个孤立节点，统计信息显示 0 条依赖。
- **pnpm workspace 与 npm workspace 混合**：WorkspaceIndexGenerator.extract() 已有优先级检测逻辑（pnpm > npm > uv），CrossPackageAnalyzer 复用相同逻辑，不会重复检测。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 实现 `DocumentGenerator<CrossPackageInput, CrossPackageOutput>` 接口，遵循 `isApplicable -> extract -> generate -> render` 四步生命周期。
- **FR-002**: 系统 MUST 在 `isApplicable` 中判断 `context.workspaceType === 'monorepo'`，仅对 Monorepo 项目返回 true。
- **FR-003**: 系统 MUST 复用 `WorkspaceIndexGenerator.extract()` 获取子包列表及其内部依赖信息，不重复实现 workspace 解析逻辑。
- **FR-004**: 系统 MUST 将 `WorkspacePackageInfo[]` 转换为包级 `DependencyGraph` 格式，其中每个子包对应一个 `GraphNode`，每条内部依赖对应一条 `DependencyEdge`。
- **FR-005**: 系统 MUST 复用 `detectSCCs()` 函数（Tarjan 算法）检测子包间的循环依赖（强连通分量），不重写图算法。
- **FR-006**: 系统 MUST 复用 `topologicalSort()` 函数（Kahn 算法 + SCC 折叠）计算子包的拓扑排序和层级信息。
- **FR-007**: 系统 MUST 生成 Mermaid `graph TD` 格式的依赖拓扑图，其中每个子包为一个节点，每条依赖为一条有向边。
- **FR-008**: 系统 MUST 在 Mermaid 图中将循环依赖边（属于 SCC 内部的边）使用红色虚线样式标注，与正常依赖边在视觉上区分。
- **FR-009**: 系统 MUST 在存在循环依赖时，在文档中以警告区块形式列出每组循环路径（SCC 中的包名列表）。
- **FR-010**: 系统 MUST 在不存在循环依赖时，在文档中明确声明"未检测到循环依赖"。
- **FR-011**: 系统 MUST 统计并展示以下信息：root 包列表（入度为 0 的节点）、leaf 包列表（出度为 0 的节点）、总依赖边数。
- **FR-012**: 系统 MUST 使用 Handlebars 模板 `templates/cross-package-analysis.hbs` 渲染最终 Markdown 文档。
- **FR-013**: 系统 MUST 在 `bootstrapGenerators()` 函数中注册 CrossPackageAnalyzer 实例，使其可通过 GeneratorRegistry 被自动发现。
- **FR-014**: 系统 MUST 使用 id `'cross-package-deps'` 作为该 Generator 的唯一标识符。
- **FR-015**: 系统 SHOULD 复用 `sanitizeMermaidId()` 函数将包名转义为合法的 Mermaid 节点 ID。
- **FR-016**: 系统 SHOULD 在拓扑排序结果中展示子包的层级信息（level），帮助用户理解依赖深度。
- **FR-017**: 系统 MAY 在 Mermaid 图中对 SCC 内部的节点使用特殊颜色样式（如红色背景），增强循环依赖的视觉识别度。

### Key Entities

- **CrossPackageInput**: extract 步骤的输出数据结构，包含项目名称、workspace 类型、子包列表（复用 WorkspacePackageInfo）和构建的包级 DependencyGraph。
- **CrossPackageOutput**: generate 步骤的输出数据结构，包含文档标题、生成日期、Mermaid 拓扑图源代码、拓扑排序结果、循环依赖信息（是否存在、循环组列表）、统计信息（root 包、leaf 包、总依赖数）。
- **CrossPackageAnalyzer**: 实现 `DocumentGenerator<CrossPackageInput, CrossPackageOutput>` 的具体类，id 为 `'cross-package-deps'`。

### Traceability Matrix

| FR | User Story |
|----|-----------|
| FR-001, FR-002 | US-1, US-5 |
| FR-003, FR-004 | US-1 |
| FR-005, FR-006 | US-2, US-4 |
| FR-007, FR-008, FR-015 | US-1, US-2 |
| FR-009, FR-010 | US-2 |
| FR-011 | US-3 |
| FR-012 | US-1, US-2, US-3 |
| FR-013, FR-014 | US-5 |
| FR-016 | US-4 |
| FR-017 | US-2 |

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对 OctoAgent 项目运行 CrossPackageAnalyzer 全流程，输出的 Mermaid 拓扑图中包含 8 个节点（对应 8 个子包）且所有依赖边方向正确（与 pyproject.toml 声明一致）。
- **SC-002**: 对 OctoAgent 项目运行分析后，文档中包含"未检测到循环依赖"的声明（因 OctoAgent 预期无循环），统计信息中 leaf 包 = octoagent-core、root 包 = octoagent-gateway。
- **SC-003**: 对包含人为构造的循环依赖的测试 fixture 运行分析，循环路径被正确列出，Mermaid 图中循环边使用红色虚线，不遗漏任何 SCC。
- **SC-004**: CrossPackageAnalyzer 通过 `GeneratorRegistry.getInstance().get('cross-package-deps')` 可被发现，`isApplicable` 对 monorepo 项目返回 true、对 single 项目返回 false。
- **SC-005**: 全部单元测试通过（`npm test` 退出码 0），覆盖正常依赖图、循环依赖图、无依赖图、单包图四种场景。
