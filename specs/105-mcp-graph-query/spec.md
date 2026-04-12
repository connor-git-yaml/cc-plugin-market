# Feature Specification: MCP Graph Query 工具集

**Feature Branch**: `105-mcp-graph-query`
**Created**: 2026-04-12
**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Claude Code 通过 MCP 工具查询知识图谱 (Priority: P1)

作为使用 Claude Code 的开发者，我希望 Claude 能够通过 MCP 工具直接查询当前项目的知识图谱，以便在对话过程中获取相关模块的架构信息和代码关系，而无需手动翻阅代码文件。

**Why this priority**: 这是本 Feature 的核心价值主张。没有 MCP 工具集，后续所有功能都失去意义；其他四个 tool 都依赖这一基础能力（图加载、工具注册模式）建立之后才能追加。

**Independent Test**: 可单独测试：在已有 `_meta/graph.json` 的项目中启动 MCP server，通过 MCP 客户端调用 `graph_query` 并传入任意自然语言问题，验证返回包含节点和关系数据的子图摘要即可确认 MVP 可用。

**Acceptance Scenarios**:

1. **Given** 项目根目录下存在有效的 `_meta/graph.json`，**When** Claude Code 调用 `graph_query` 并传入查询词（如"CLI 命令处理模块"），**Then** 返回结果包含相关节点列表、节点间关系摘要，以及 `truncated`（是否裁剪）和 `totalMatches`（总匹配数）字段。
2. **Given** `_meta/graph.json` 不存在，**When** 调用任意 graph query tool，**Then** 返回带有友好错误提示的响应（`isError: true`），不发生进程崩溃。
3. **Given** 查询结果超出 `budget` 参数限制，**When** 执行 `graph_query`，**Then** 返回结果 `truncated: true`，且优先保留起点节点和最短路径节点，节点总数不超过 `budget`。

---

### User Story 2 - 精确查找节点详情与最短路径 (Priority: P1)

作为开发者，我希望能够精确定位某个节点的详细信息（邻居、所属社区、元数据），以及查找两个节点之间的最短调用路径，以便理解模块依赖关系。

**Why this priority**: `graph_node` 和 `graph_path` 是 Claude Code 进行架构分析时最高频的两类查询——定位某个具体函数/类并追踪其依赖链。它们与 `graph_query` 共同构成 MVP 不可缺少的核心。

**Independent Test**: 在测试 graph 数据集中，分别调用 `graph_node`（按 id 查找）和 `graph_path`（已知两个节点的 id），验证返回数据结构正确、响应时间符合要求（node < 50ms，path < 100ms）。

**Acceptance Scenarios**:

1. **Given** 知识图谱已加载，**When** 调用 `graph_node` 并传入精确节点 ID，**Then** 返回该节点的属性、邻居节点列表和所属社区信息。
2. **Given** 知识图谱已加载，**When** 调用 `graph_node` 并传入关键词，**Then** 返回所有标签包含该关键词的节点列表（支持模糊匹配）。
3. **Given** 知识图谱已加载，**When** 调用 `graph_path` 并指定两个有效节点 ID，**Then** 返回两节点间最短路径的有序节点序列。
4. **Given** 两节点间不存在路径，**When** 调用 `graph_path`，**Then** 返回"路径不存在"的明确提示，而非空结果或报错。

---

### User Story 3 - 社区分析与 God Nodes 识别 (Priority: P2)

作为架构师，我希望快速获取整个代码库中的核心枢纽节点（God Nodes）和社区结构，以便识别潜在的架构风险点（过度耦合模块）和自然聚类边界。

**Why this priority**: `graph_community` 和 `graph_god_nodes` 提供宏观视角，对架构审查有直接价值，但在 MVP 阶段不影响基础查询能力。优先级低于精确查询但高于 CLI 命令（CLI 是非 MCP 用户的辅助入口）。

**Independent Test**: 调用 `graph_god_nodes`（limit=5），验证返回的节点列表按度数降序排列；调用 `graph_community` 并传入任意社区 ID，验证返回该社区的节点列表。无需 Feature 102 数据即可通过测试。

**Acceptance Scenarios**:

1. **Given** 知识图谱已加载，**When** 调用 `graph_god_nodes`（limit=10），**Then** 返回度数最高的前 10 个节点，按度数降序排列，每个节点包含 id、label 和 degree 信息。
2. **Given** 知识图谱已加载且 Feature 102 的 `graph-report.md` 不存在，**When** 调用 `graph_community`，**Then** 返回该社区的节点列表，cohesion 字段为空或标注"不可用"（graceful degrade）。
3. **Given** Feature 102 的 `graph-report.md` 存在，**When** 调用 `graph_community`，**Then** 返回结果额外包含 cohesion 评分信息。
4. **Given** 传入不存在的社区 ID，**When** 调用 `graph_community`，**Then** 返回明确的"社区不存在"提示。

---

### User Story 4 - CLI query 命令供终端用户使用 (Priority: P2)

作为开发者，当我在终端工作时，我希望能够直接用 `spectra query "<问题>"` 命令查询知识图谱，获取文本格式的可读摘要或 JSON 格式的原始数据，而无需启动 MCP 客户端。

**Why this priority**: CLI 命令为非 Claude Code 场景（如 CI 脚本、终端调试）提供了独立的查询入口，是 MCP 工具集之外的补充。核心图查询能力已在 P1 中覆盖，CLI 是其在终端场景的映射。

**Independent Test**: 在已有 `_meta/graph.json` 的目录下执行 `spectra query "模块依赖关系" --budget 20 --format text`，验证终端输出包含可读的文本摘要；再用 `--format json` 验证输出为合法 JSON。

**Acceptance Scenarios**:

1. **Given** 当前目录下存在 `_meta/graph.json`，**When** 执行 `spectra query "查询词" --format text`，**Then** 终端打印包含相关节点和关系的人类可读摘要。
2. **Given** 执行 `spectra query "查询词" --format json`，**Then** 终端输出合法 JSON，包含节点列表、边列表和元数据（含 `truncated` 和 `totalMatches`）。
3. **Given** 使用 `--budget 10` 参数，**When** 执行查询，**Then** 返回结果节点数不超过 10。
4. **Given** `_meta/graph.json` 不存在，**When** 执行 `spectra query`，**Then** 打印友好错误信息，exit code 非零。

---

### Edge Cases

- `graph_query` 传入完全无关的查询词（在 graph 中找不到任何匹配节点）时，返回空节点列表而非报错，并包含友好的"未找到相关内容"提示。
- `graph_path` 的 source 和 target 传入同一节点 ID 时，返回包含单个节点的路径。
- `graph_node` 同时传入 `id` 和 `keyword` 时，`id` 精确匹配优先，`keyword` 作为回退。[AUTO-RESOLVED: id 精确优先于模糊匹配是通用搜索语义惯例]
- `budget` 参数传入 0 或负数时，系统使用默认值（50）并在响应中标注。
- 图数据极大（节点数接近 5,000）时，加载时间应在 2 秒以内；加载超时时返回错误而非无限等待。
- `graph.json` 存在但格式损坏（非合法 JSON 或不符合 GraphJSON schema）时，返回结构化错误提示，不 crash。
- MCP server 运行期间 `graph.json` 被外部进程更新时，通过 `reloadGraph()` 刷新缓存；未刷新前返回旧数据（不自动热更新）。[AUTO-RESOLVED: 内存缓存模型中不自动热更新是标准做法，批处理完成后手动 reload]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**：系统 MUST 在 MCP server 启动时将 `_meta/graph.json` 加载到内存缓存，作为所有 graph tool 的数据源。`[必须]`
- **FR-002**：系统 MUST 提供 `graph_query` tool，接受自然语言查询词和 `budget` 参数，通过 BFS/DFS 遍历返回相关子图及文本摘要。`[必须]`
- **FR-003**：系统 MUST 提供 `graph_node` tool，支持按精确 ID 或关键词查找节点，返回节点属性、邻居列表和所属社区信息。`[必须]`
- **FR-004**：系统 MUST 提供 `graph_path` tool，返回两节点间的 BFS 最短路径节点序列。`[必须]`
- **FR-005**：系统 MUST 提供 `graph_community` tool，返回指定社区的节点列表；若 Feature 102 cohesion 数据可用则一并返回，否则 graceful degrade。`[必须]`
- **FR-006**：系统 MUST 提供 `graph_god_nodes` tool，返回按度数降序排列的 Top N 节点列表。`[必须]`
- **FR-007**：所有 graph tool 的 Zod schema MUST 包含完整的参数 `description` 字段（供 Claude 决策何时调用）。`[必须]`
- **FR-008**：所有 graph tool handler MUST 在 `graph.json` 不存在时返回 `isError: true` 及友好错误提示，不触发进程崩溃。`[必须]`
- **FR-009**：`graph_query`、`graph_node`、`graph_community`、`graph_god_nodes` MUST 支持 `budget` 参数（默认值 50），限制返回节点总数。`[必须]`
- **FR-010**：当结果被 budget 裁剪时，系统 MUST 在响应中标注 `truncated: true` 和 `totalMatches` 字段，并按优先级策略保留节点（起点 > 最短路径节点 > hub 节点 > 高置信度边连接节点）。`[必须]`
- **FR-011**：系统 MUST 提供 `reloadGraph()` 机制，允许在 batch 操作完成后刷新内存缓存。`[必须]`
- **FR-012**：系统 MUST 提供 `spectra query "<问题>"` CLI 子命令，支持 `--budget <N>` 和 `--format json|text` 选项。`[必须]`
- **FR-013**：CLI `--format text` MUST 输出人类可读的文本摘要；`--format json` MUST 输出包含节点列表、边列表和元数据的合法 JSON。`[必须]`
- **FR-014**：系统 MUST NOT 引入新的运行时依赖（图遍历逻辑纯 JavaScript 实现）。`[必须]`
- **FR-015**：`graph.json` 格式损坏时，系统 SHOULD 返回结构化错误提示，标明具体解析失败原因。`[可选]`
- **FR-016**：`graph_node` 同时收到 `id` 和 `keyword` 参数时，系统 SHOULD 优先使用 `id` 精确匹配，`keyword` 作为回退逻辑。`[可选]`

### Key Entities

- **GraphJSON**：内存中知识图谱的完整表示，采用 NetworkX node-link 格式，包含 `nodes` 数组和 `links` 数组；来源为 Feature 101 已定义的 `_meta/graph.json`。
- **GraphNode**：图中的单个节点，具有 `id`（唯一标识符）、`kind`（节点类型，如 function/class/module）、`label`（显示名称）和可选的 `metadata` 字段。
- **GraphEdge**：图中的有向边，具有 `source`、`target`、`relation`（关系类型）、`confidence`（置信度标签）和 `confidenceScore`（数值）字段。
- **SubgraphResult**：查询返回的子图结果，包含 `nodes`、`edges`、`summary`（文本摘要）、`truncated`（是否被裁剪）和 `totalMatches`（总匹配数）。
- **Token Budget**：查询时允许返回的最大节点数，默认 50，通过 `budget` 参数覆盖。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：在 5,000 节点规模的 `graph.json` 上，`graph_query` 单次查询（图已加载到内存）的端到端响应时间小于 500ms，覆盖 P95 场景。
- **SC-002**：`_meta/graph.json`（5,000 节点规模）从磁盘加载到内存的时间小于 2 秒。
- **SC-003**：`graph_path` 最短路径查找在图已加载条件下响应时间小于 100ms。
- **SC-004**：`graph_node` 按 id 精确查找在图已加载条件下响应时间小于 50ms。
- **SC-005**：在 `_meta/graph.json` 不存在的环境中，调用任意 graph tool 时，100% 情况下返回带有友好提示的错误响应，不发生进程 crash。
- **SC-006**：带 `budget` 参数的查询结果中，返回节点数严格不超过指定 budget 值，且 `truncated` 字段正确反映裁剪状态。
- **SC-007**：所有 5 个 MCP graph tool 均可通过 MCP 客户端（如 Claude Code）正常调用，并返回结构正确的响应。
- **SC-008**：`spectra query` CLI 命令在 `--format json` 模式下输出的内容可通过 JSON.parse 解析，无格式错误。
- **SC-009**：Feature 102 数据缺失时，`graph_community` tool 仍可正常返回节点列表（不报错），验证 graceful degrade 路径。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估结果 |
|------|----------|
| **组件总数** | 4 个新增模块（graph-tools.ts、graph-loader.ts、graph-query-engine.ts、graph-index.ts）+ 1 个新增 CLI 命令（query.ts）= 共 5 个 |
| **接口数量** | 5 个 MCP tool 接口 + 1 个 CLI 子命令接口 + `reloadGraph()` 内部方法 = 约 7 个 |
| **依赖新引入数** | 0（无新运行时依赖，BFS/DFS 纯 JS 实现） |
| **跨模块耦合** | 需修改 `src/mcp/server.ts`（注册新 tool）和 `src/cli/index.ts`（新增 query 子命令）= 2 个现有模块 |
| **复杂度信号** | 图遍历算法（BFS/DFS）属于"递归/迭代结构"信号；token 预算裁剪涉及多优先级排序逻辑 |
| **总体复杂度** | **MEDIUM** |

**判定依据**：组件数 5 个（在 3-5 区间上限）、接口数 7 个（在 4-8 区间）、存在 1 个复杂度信号（图遍历算法），综合评定为 MEDIUM。不涉及状态机、并发控制或数据迁移，无需强制人工审查，但建议关注 BFS/DFS 实现的边界条件测试覆盖率。
