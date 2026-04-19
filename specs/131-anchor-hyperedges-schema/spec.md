# Feature Specification: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**Feature Branch**: `131-anchor-hyperedges-schema`
**Created**: 2026-04-19
**Status**: Draft
**Wave**: Phase 2 Wave 2

> 调研依据：[产品调研](./research/product-research.md) · [技术调研](./research/tech-research.md) · [产研汇总](./research/research-synthesis.md)

---

## 背景与目标

当前 Spectra 的知识图谱（`graph.json`）只记录"代码节点"间的静态依赖关系，缺乏将 design-doc（spec 文档）与代码节点语义关联的能力。F4 Feature 通过以下三层能力闭合这一缺口：

1. **schema v2.0 扩展**：引入文档-代码语义边类型（`references` / `conceptually_related_to` / `rationale_for`）及 hyperedges（超边）顶层结构，同时保持与 v1.0 消费方的向后兼容。
2. **函数级语义锚定**：通过 Hybrid Chunking + Local Embedding 技术，从 design-doc 文本块中自动提取与代码节点语义相关的边，使 AI Agent 可在图中回溯"某段代码对应哪个 spec 章节"。
3. **Hyperedges 提取**：通过 LLM 从 design-doc 命名流程（如 "Full Ingestion Pipeline"）中提取跨越多节点的超边，为 AI Agent 提供流程级语义锚定。

本 Spec 仅描述**做什么（WHAT）和验收标准（HOW TO VERIFY）**，不涉及具体实现（HOW）。

---

## 用户故事与验收场景

### Story 1 — graph.json schema v2.0 升级（优先级：P1）

**角色**：下游 MCP 工具 / direction-audit CLI / 消费 `graph.json` 的 AI Agent

**描述**：当 Spectra 批处理流程执行完成后，下游工具和 AI Agent 可以读取包含语义边类型、证据字段和超边结构的 `graph.json` v2.0，同时旧消费方（期望 v1.0 schema）不会因新字段而崩溃。direction-audit CLI 对新增边类型不报方向违规。

**优先级理由**：这是所有后续 Story（Story 2、3、4）的数据合同基础。没有 schema v2.0，其他 Story 的产出无法写入或正确读取。技术侧原地扩展风险低，必须首先独立交付。

**独立可测试性**：在不运行 embedding 或 LLM 的情况下，可以通过单元测试验证 `src/panoramic/graph/graph-types.ts` 的类型导出和 golden-master fixture 的合规性，独立交付后下游工具即可开始适配新字段。

**验收场景**：

1. **Given** 现有 `graph.json`（`schemaVersion: "1.0"`），**When** 升级到 v2.0 schema 类型后运行 `npm run build`，**Then** 零 TypeScript 编译错误，所有现有消费方代码继续通过类型检查。
2. **Given** v2.0 `graph.json` 中包含 `references` / `conceptually_related_to` / `rationale_for` 边，**When** direction-audit CLI 对该文件执行方向审计，**Then** 新增边类型通过白名单注册，不触发方向违规报告。
3. **Given** 一份 v2.0 `graph.json` golden-master fixture，**When** 运行 `npx vitest run` 中的 schema 单元测试，**Then** 所有字段（包括 `hyperedges` 顶层数组、`evidenceText`、`evidenceSource`、`confidence`）均通过结构验证，零失败。
4. **Given** 一份 v1.0 `graph.json`（无 `hyperedges` 字段、无 `evidenceText`），**When** 消费方代码按 `schemaVersion` 字段分支读取，**Then** v1.0 分支正常解析，不报字段缺失错误。

---

### Story 2 — 函数级语义锚定边生成（优先级：P1）

**角色**：运行 `spectra batch` 的开发者 / 消费图的 AI Agent

**描述**：开发者在含有 design-doc（spec markdown 文件）和代码源文件的项目上运行 `spectra batch`，系统自动将 design-doc 文本按 Hybrid Chunking 分块并生成 embedding，与图中现有代码节点对比相似度，对超过阈值的 (doc-chunk, code-node) 对自动写入 `references` 或 `conceptually_related_to` 边，每条 INFERRED 边附带 `evidenceText`（原文摘录）和 `evidenceSource`（文件:行号）。

**优先级理由**：这是 F4 Feature 的核心产品价值——spec 文档 × KG 的双向溯源闭环。AI Agent 通过该能力可回答"哪段代码实现了这个 spec 章节"。Local Embedding 方案保持零 API key 可运行的现有基线。

**独立可测试性**：使用包含 design-doc 和代码文件的 graphify 示例项目 fixture，运行锚定模块，验证 `graph.json` 中出现 ≥10 条新边，每条 INFERRED 边含非空 `evidenceText` 和 `evidenceSource`。

**验收场景**：

1. **Given** 含 design-doc（≥3 个 H2/H3 章节）和 ≥5 个代码函数节点的项目，**When** 运行锚定流程，**Then** `graph.json` 中新增 ≥10 条 `references` 或 `conceptually_related_to` 边，每条边的 `confidence` 字段值为 `"INFERRED"`，`evidenceText` 非空，`evidenceSource` 格式为 `"文件路径:行号"`。
2. **Given** 阈值配置为 0.75（默认），**When** 两个 doc-chunk 与代码节点的 cosine 相似度分别为 0.80 和 0.60，**Then** 0.80 的 pair 生成边，0.60 的 pair 不生成边。
3. **Given** 5+ 文件的纯代码项目（无任何 markdown 文件），**When** 运行锚定流程，**Then** `graph.json` 中零新增边，流程正常结束不报错（诚实降级）。
4. **Given** `SPECTRA_EMBEDDING_PROVIDER=local`（默认），**When** 锚定流程执行完成，**Then** `tokenUsage` 记录包含 `llmModel: 'local-embedding'` 和 `durationMs` 字段，与 F1 BudgetGate 记录格式一致。
5. **Given** `SPECTRA_EMBEDDING_PROVIDER=openai` 且设置了 `OPENAI_API_KEY`，**When** 锚定流程执行，**Then** 系统切换至 OpenAI fallback provider，`tokenUsage` 记录对应 API 调用的 token 计数。

---

### Story 3 — LLM Hyperedge 提取（优先级：P1，带 feature flag）

**角色**：查询架构流程的 AI Agent / 使用 `graph_hyperedges` MCP 工具的 Claude Code

**描述**：在 design-doc 中明确命名的流程性概念（如 "Full Ingestion Pipeline"、"Batch Processing Stage"）被 LLM 自动提取为 hyperedge（超边），每个 hyperedge 包含 label（≤8 字）、≥3 个关联节点 ID（`nodes`）、rationale（提取理由）和 confidence 等级。提取通过 BudgetGate 管控 LLM 成本，每 batch ≤10 个 hyperedge，Zod 校验失败时静默降级返回空数组，不中断主流程。此功能默认通过 feature flag 启用，可独立关闭。

**优先级理由**：Hyperedge 是 Spectra 相对竞品 Graphify 的差异化能力，使 AI Agent 可获得流程级语义理解，而非仅节点级。产研汇总将其定性为"核心差异化但风险偏高"，故带 feature flag 纳入 MVP，允许在验证质量后推广。

**独立可测试性**：提供包含已知命名流程描述的 design-doc fixture，验证 LLM 提取结果通过 Zod 校验并写入 `graph.json` 的 `hyperedges` 数组；同时验证校验失败时返回空数组且不抛出未捕获异常。

**验收场景**：

1. **Given** design-doc 中含 "Full Ingestion Pipeline" 等流程描述，且 feature flag 已启用，**When** hyperedge 提取流程运行，**Then** `graph.json` 的 `hyperedges` 数组中包含 ≥1 个对应该流程的超边，该超边的 `label` ≤8 字、`nodes` 数量 ≥3、`rationale` 非空。
2. **Given** LLM 返回的 hyperedge 数据不符合 Zod schema（如 `nodes` 数量为 1），**When** Zod 校验执行，**Then** 该条 hyperedge 被丢弃，返回空数组，主流程继续执行不抛出异常，失败样本写入 trace 日志。
3. **Given** 单次 design-doc 处理，**When** hyperedge 提取执行，**Then** 每 batch 生成 hyperedge 数量 ≤10，BudgetGate 记录本次 LLM 调用的 tokenUsage（含 inputTokens、outputTokens）。
4. **Given** feature flag 未启用（默认关闭状态），**When** 运行批处理流程，**Then** 不执行任何 LLM hyperedge 提取，`graph.json` 的 `hyperedges` 数组为空或不存在。
5. **Given** 纯代码项目（无 design-doc），**When** feature flag 已启用，**Then** hyperedge 提取流程返回零 hyperedge，不报错（诚实降级）。

---

### Story 4 — graph_hyperedges MCP 工具 + 现有 MCP 工具适配（优先级：P1）

**角色**：Claude Code 等 MCP 客户端 / 使用 Spectra MCP 工具的 AI Agent

**描述**：MCP 工具层新增 `graph_hyperedges` 工具，支持按 `label`（模糊匹配）或 `node_id`（精确匹配）过滤查询超边；同时 `graph_node` 和 `graph_community` 工具适配 schema v2.0 新字段（如节点关联的 `references` 边列表），确保 AI Agent 通过 MCP 协议即可获取完整的 v2.0 语义信息，不需要直接解析 `graph.json` 文件。

**优先级理由**：MCP 工具层是外部 AI Agent 消费图能力的唯一入口。schema v2.0 和 hyperedge 能力做完但 MCP 不暴露，等同于"能力不可见"。产研汇总将 Story 4 从 P2 提升至 P1，与 Story 1-2 同优先级。

**独立可测试性**：可通过 MCP 工具调用测试（不依赖真实 embedding 或 LLM）：向 `graph_hyperedges` 发送 `{ label: "Pipeline" }` 过滤参数，验证返回结构符合预期格式。

**验收场景**：

1. **Given** 包含 hyperedges 的 `graph.json` v2.0，**When** 调用 `graph_hyperedges` 工具不带参数，**Then** 返回所有 hyperedge 列表，每条包含 `id`、`label`、`nodes`、`rationale`、`confidence` 字段。
2. **Given** 包含 label 为 "Full Ingestion Pipeline" 的 hyperedge，**When** 调用 `graph_hyperedges({ label: "Ingestion" })`，**Then** 返回结果包含该 hyperedge（模糊匹配），不含不相关的 hyperedge。
3. **Given** 某节点 ID 存在于多个 hyperedge 的 `nodes` 中，**When** 调用 `graph_hyperedges({ node_id: "<node_id>" })`，**Then** 返回所有包含该节点的 hyperedge。
4. **Given** `graph.json` v2.0 包含 `references` 边，**When** 调用 `graph_node({ id: "<code_node_id>" })`，**Then** 返回字段中包含该节点所关联的语义边（含 `evidenceText` 和 `evidenceSource`）。
5. **Given** `graph.json` v2.0 中 `hyperedges` 为空数组，**When** 调用 `graph_hyperedges()`，**Then** 返回空列表，不报错。

---

### 边界案例（Edge Cases）

- **零 doc chunk 降级**：项目无任何 markdown 文件时，锚定模块返回零边、零 hyperedge，不抛出错误，不影响现有图结构。
- **相似度阈值边界**：cosine 相似度恰好等于阈值（0.75）时**生成边**（`>= threshold`，含边界值），与行业标准一致。
- **evidenceText 截断**：当 match 位置周边文本超过 200 字符时，从 match 位置对称扩展直到 200 字符上限，heading 行整行纳入；文本中间的 spec 引用不因截断而丢失关键上下文。
- **LLM Zod 校验全失败**：单次 batch 的所有 LLM 返回均不通过 Zod 校验时，写入 trace 日志，`hyperedges` 写入空数组，主流程继续。
- **同一 (source, target, type) 三元组多次生成**：去重时保留 confidence 最高的边；相同 confidence 时保留最新生成的 `evidenceText`。
- **Local Embedding 依赖加载失败**：`@huggingface/transformers` 模块不可用时，factory 函数抛出明确错误信息，提示用户安装依赖或切换至 `SPECTRA_EMBEDDING_PROVIDER=openai`。
- **MCP 工具接收非法过滤参数**：`graph_hyperedges` 接收到 schema 不符的参数时，返回清晰错误响应，不崩溃。

---

## 功能需求

### Schema 与数据合同

- **FR-001**：系统 MUST 在 `src/panoramic/graph/graph-types.ts` 中新增以下边类型枚举值：`references`、`conceptually_related_to`、`rationale_for`，并更新现有边类型联合类型以包含这三项。`[必须]` [对应 Story 1]

- **FR-002**：系统 MUST 在边类型定义中新增 `confidence` 枚举字段，取值范围为 `EXTRACTED | INFERRED | AMBIGUOUS`；所有由 embedding 自动生成的边 MUST 标记为 `INFERRED`；从 design-doc 文本明确抽取（含直接引用函数名、文件路径等强证据）的边 MUST 标记为 `EXTRACTED`；证据不足、语义歧义的边 MUST 标记为 `AMBIGUOUS`。**注：此枚举为本 Feature 对外的数据合同命名，直接透传至 MCP 工具响应。**`[必须]` [对应 Story 1, Story 2]

- **FR-003**：系统 MUST 在 `INFERRED` 和 `AMBIGUOUS` 等级的边上强制要求 `evidenceText` 字段非空（字符串，最大 200 字符），`EXTRACTED` 边 SHOULD 包含 `evidenceText` 但不强制。`[必须]` [对应 Story 1, Story 2]

- **FR-004**：系统 MUST 定义 `evidenceSource` 字段格式为 `"<repo-relative-file-path>:<startLine>-<endLine>"`，其中行号为 1-based 整数，指向 embedding chunk 在原始文件中的位置。**路径必须为相对仓库根目录的相对路径（repo-relative），不得使用绝对路径，确保 fixture 跨设备可移植。**`[必须]` [对应 Story 1, Story 2]

- **FR-005**：系统 MUST 在 `graph.json` 顶层新增 `hyperedges` 数组字段；每个 hyperedge MUST 包含 `id`（唯一字符串）、`label`（≤8 字）、`nodes`（节点 ID 数组，≥3 个；允许混合包含 doc-section 节点和代码节点，但 MUST 至少包含 1 个代码节点）、`rationale`（字符串）、`confidence` 字段；`hyperedges` 字段对 v1.0 消费方 MUST 为 optional，缺失时视为空数组。`[必须]` [对应 Story 1, Story 3]

- **FR-006**：系统 MUST 将 `schemaVersion` 字段从字面量 `"1.0"` 扩展为联合类型 `"1.0" | "2.0"`；新生成的 `graph.json` MUST 写入 `schemaVersion: "2.0"`；v2.0 新增字段（`evidenceText`、`evidenceSource`、`confidence`、`hyperedges`）在类型层面 MUST 为 optional，保证 v1.0 数据仍可通过类型检查。`[必须]` [对应 Story 1]

- **FR-007**：direction-audit CLI MUST 通过边类型白名单注册表识别 `references`、`conceptually_related_to`、`rationale_for` 三种新边类型；注册后这三种边类型 MUST 不触发方向违规报警。`[必须]` [对应 Story 1]

- **FR-008**：系统 MUST 提供 golden-master fixture 文件，同时包含 v1.0 和 v2.0 格式的 `graph.json` 示例，用于回归测试；两个版本的 fixture 必须通过 schema 单元测试。`[必须]` [对应 Story 1]

### 函数级锚定（Anchoring）

- **FR-009**：锚定模块 MUST 实现 Hybrid Chunking 策略：以 H2/H3 标题为主边界、段落合并为辅，每个 chunk 的 token 上限为 512（以 `@huggingface/transformers` tokenizer 计）；每个 chunk MUST 记录其在原始文件中的 `startLine` 和 `endLine`，用于生成 `evidenceSource`。`[必须]` [对应 Story 2]

- **FR-010**：锚定模块 MUST 实现 `EmbeddingProvider` 接口抽象，支持通过 `SPECTRA_EMBEDDING_PROVIDER` 环境变量在 `local`（默认）和 `openai` 两种 provider 间切换；缺少该环境变量时默认使用 local provider。`[必须]` [对应 Story 2]

- **FR-011**：Local Embedding Provider MUST 使用 `@huggingface/transformers` 包（列为 `optionalDependencies`）加载 `all-MiniLM-L6-v2` 模型；模块加载失败时 MUST 抛出包含安装指引的清晰错误信息，而非静默失败。`[必须]` [对应 Story 2]

- **FR-012**：锚定模块 MUST 计算 doc-chunk embedding 与图中代码节点 embedding 之间的 cosine 相似度；相似度 **>= 阈值**（默认 0.75，**含边界值**）的 pair MUST 生成语义边；阈值 MUST 可通过配置项覆盖。`[必须]` [对应 Story 2]

- **FR-013**：锚定模块（Story 2 embedding 锚定）生成的语义边类型 SHOULD 按以下规则选择：文档 chunk 直接引用代码函数时选 `references`；概念相关但无直接引用时选 `conceptually_related_to`。`rationale_for` 边**不由 embedding 锚定生成**，仅由 Story 3 LLM hyperedge 提取流程附带产出；提取时 LLM prompt 应明确指示：当某个设计决策文本为代码实现提供了设计理由时，可生成 `rationale_for` 边。`[必须]` [对应 Story 2, Story 3]

- **FR-014**：同一 `(source, target, type)` 三元组出现多次时，系统 MUST 去重，保留 confidence 最高的版本；confidence 相同时保留最新生成的 `evidenceText`。`[必须]` [对应 Story 2]

- **FR-015**：项目无任何 markdown 文件（零 doc chunk）时，锚定模块 MUST 产出零新边、不写入新数据、不抛出异常，诚实降级。`[必须]` [对应 Story 2]

- **FR-016**：所有 embedding 调用（包括 local 模式）MUST 记录到 `tokenUsage` 中，local 模式记录 `llmModel: 'local-embedding'` 和 `durationMs`，与 F1 BudgetGate 的记录格式保持一致。`[必须]` [对应 Story 2]

### Hyperedge 提取

- **FR-017**：Hyperedge 提取模块 MUST 受 feature flag 控制，flag 默认关闭；启用方式为：(a) 设置环境变量 `SPECTRA_HYPEREDGES_ENABLED=true`，或 (b) 在 `spectra batch` 命令中传入 `--hyperedges` CLI 选项；两种方式均可独立开启，CLI 选项优先级高于环境变量。当 flag 启用时，模块通过 LLM（Anthropic SDK）从 design-doc 中提取 hyperedge，走 BudgetGate 记录 tokenUsage。`[必须]` [对应 Story 3]

- **FR-018**：每次 LLM 提取调用生成的 hyperedge 数量 MUST ≤10 per batch；若 design-doc 规模需要更多，MUST 分 batch 处理。`[必须]` [对应 Story 3]

- **FR-019**：系统 MUST 使用 Zod schema 对 LLM 返回的 hyperedge 数据进行结构校验；校验失败时 MUST 静默丢弃该条 hyperedge 并记录失败样本到 trace 日志，不中断主流程；整个 batch 全部校验失败时，写入空数组。`[必须]` [对应 Story 3]

- **FR-020**：合法 hyperedge 的 `label` MUST ≤8 字（Unicode 字符计）、`nodes` MUST 包含 ≥3 个有效节点 ID 且**至少 1 个为代码节点**（`sourceKind` 不为 `doc-section`）、`rationale` MUST 非空。不满足任一条件的 hyperedge 视为校验失败。`[必须]` [对应 Story 3]

- **FR-021**：Hyperedge 提取 MUST 仅针对 `sourceKind` 为 design-doc 的节点关联的文本内容执行，排除 `bundle_copy` 和 `derived` 类型源文件。`[必须]` [对应 Story 3]

### MCP 工具

- **FR-022**：系统 MUST 在 `src/mcp/graph-tools.ts` 中新增 `graph_hyperedges` MCP 工具，支持以下可选过滤参数：`label`（字符串，模糊匹配 hyperedge label）、`node_id`（字符串，精确匹配 `nodes` 数组中的节点 ID）；两个参数均不传时返回所有 hyperedge。`[必须]` [对应 Story 4]

- **FR-023**：`graph_hyperedges` 工具的响应结构 MUST 包含每个 hyperedge 的完整字段：`id`、`label`、`nodes`（节点 ID 数组）、`rationale`、`confidence`；响应格式 MUST 与现有 `graph_node` 工具的响应风格保持一致。`[必须]` [对应 Story 4]

- **FR-024**：`graph_node` 工具 MUST 适配 schema v2.0，在节点信息中包含该节点所关联的语义边列表（含 `evidenceText`、`evidenceSource`、`confidence`），当节点无关联语义边时返回空数组而非报错。`[必须]` [对应 Story 4]

- **FR-025**：`graph_community` 工具 SHOULD 适配 schema v2.0，在社区信息中包含涉及该社区成员节点的 hyperedge 列表（若有）。`[可选]` [对应 Story 4]

- **FR-026**：`plugins/spectra/SKILL.md`（或相关 SKILL.md 文件）MUST 更新以描述 `graph_hyperedges` 工具的用途、输入参数和输出格式，确保 AI Agent 可发现并正确使用该工具。`[必须]` [对应 Story 4]

---

## 非功能需求

- **NFR-001（性能）**：Local Embedding 首次冷启动（含模型下载）时间 SHOULD < 30 秒（在标准网络环境下）；模型已加载后每个 chunk 的推理时间 SHOULD < 200 毫秒。`[可选]`

- **NFR-002（成本）**：Local Embedding 主方案运行时 API 成本为零；OpenAI fallback 方案对中等项目（50 万 tokens，每季度一次）的年度成本 SHOULD < $1。`[必须]`

- **NFR-003（可观测性）**：所有 embedding 调用和 LLM hyperedge 提取调用 MUST 通过 F1 BudgetGate 统一记录 `tokenUsage`；local 模式缺少 token 计数时 MUST 补充 `llmModel: 'local-embedding'` 和 `durationMs` 替代。`[必须]`

- **NFR-004（可测试性）**：锚定模块和 hyperedge 提取模块 MUST 提供单元测试覆盖；schema 变更 MUST 提供 golden-master fixture（v1.0 + v2.0 双版本）；纯代码项目诚实降级场景 MUST 有对应 fixture 和测试用例。`[必须]`

- **NFR-005（依赖管理）**：`@huggingface/transformers` MUST 列为 `optionalDependencies`，不在 `dependencies` 中；主安装流程不因该包缺失而失败；缺失时 factory 函数抛出明确错误。`[必须]`

- **NFR-006（向后兼容）**：schema v2.0 新增字段全部为 optional；v1.0 `graph.json` 在 v2.0 类型系统下 MUST 通过类型检查，不需要数据迁移。`[必须]`

- **NFR-007（可配置性）**：embedding 相似度阈值（默认 0.75）MUST 可通过配置项覆盖；`evidenceText` 最大长度（默认 200 字符）SHOULD 可通过配置项覆盖。`[必须]`

---

## 关键实体（Key Entities）

- **SemanticEdge（语义边）**：连接 doc-section 节点和代码节点的有向边，包含 `type`（`references` | `conceptually_related_to` | `rationale_for`）、`confidence`（`EXTRACTED` | `INFERRED` | `AMBIGUOUS`）、`evidenceText`（最大 200 字符原文摘录）、`evidenceSource`（`文件:起止行号`）。

- **DocChunk（文档分块）**：从 design-doc markdown 按 Hybrid Chunking 策略提取的文本单元，最大 512 tokens，携带 `startLine`、`endLine` 用于 `evidenceSource` 回溯。

- **Hyperedge（超边）**：超越二元关系、连接 ≥3 个节点的语义单元，代表架构流程或概念群，包含 `id`、`label`（≤8 字）、`nodes`（节点 ID 数组）、`rationale`、`confidence`。

- **EmbeddingProvider**：负责将文本转换为向量表示的提供者接口，当前实现：Local（`@huggingface/transformers`，零 API 成本）和 OpenAI fallback（`text-embedding-3-small`，通过环境变量切换）。

---

## 验收准则（Acceptance Criteria）

### 产品维度

- **AC-001**：在 graphify 示例项目上运行完整批处理流程后，输出的 `graph.json` 文件中 `schemaVersion` 字段值为 `"2.0"`。（自动化：golden-master fixture 比对）

- **AC-002**：`graph.json` 的 `edges` 数组中包含 ≥10 条类型为 `references` 或 `conceptually_related_to` 的边；这些边全部携带非空 `evidenceText` 和符合 `"文件路径:行号"` 格式的 `evidenceSource`。（自动化：单元测试断言）

- **AC-003**：对 AC-002 中的 INFERRED 边抽样 ≥20 条，人工审查假阳性率 < 20%（即 ≥80% 的抽样边在语义上确实关联了 doc 内容与代码实现）。（人工验证，验收时执行）

- **AC-004**：`graph.json` 的 `hyperedges` 数组包含 ≥1 个 hyperedge，至少一个的 `label` 或 `rationale` 字段中涉及 "Full Ingestion Pipeline" 类流程，该 hyperedge 的 `nodes` 数量 ≥3。（自动化 + 人工确认 label 语义）

- **AC-005**：在 ≥5 个源文件、零 markdown 文件的纯代码项目上运行批处理流程，`graph.json` 的 `edges` 中零新增语义边，`hyperedges` 为空数组，流程返回码为 0（不报错）。（自动化：fixture 测试）

- **AC-006**：调用 `graph_hyperedges` MCP 工具（不带参数）可返回所有 hyperedge 列表；使用 `{ label: "<关键词>" }` 参数可返回 label 包含该关键词的 hyperedge 子集；使用 `{ node_id: "<id>" }` 可返回包含该节点的 hyperedge 子集。（自动化：MCP 工具集成测试）

### 技术维度

- **AC-007**：运行 `npx vitest run` 零新增测试失败（相对于本 feature 开始前的基线）。（CI 自动化）

- **AC-008**：运行 `npm run build` TypeScript 编译零错误。（CI 自动化）

- **AC-009**：schema v2.0 单元测试覆盖以下场景：新增边类型字段合规验证、`confidence` 枚举合规、`evidenceText` 长度上限、`hyperedges` 数组结构、schemaVersion 联合类型解析（v1.0 + v2.0 双版本 fixture 均通过）。（自动化：单元测试）

- **AC-010**：direction-audit CLI（`direction-audit` 命令）对包含 `references`、`conceptually_related_to`、`rationale_for` 三种新边类型的 `graph.json` 执行方向审计，返回码为 0，无方向违规输出。（自动化）

- **AC-011**：所有 embedding 调用（local 模式和 OpenAI fallback 模式）的 `tokenUsage` 记录均可被 F1 BudgetGate 聚合；local 模式的 `tokenUsage` 记录包含 `llmModel: 'local-embedding'` 和 `durationMs` 字段。（自动化：单元测试）

- **AC-012**：schema v2.0 升级（`src/panoramic/graph/graph-types.ts` 变更 + direction-audit 白名单）在独立 commit 中交付，不与 embedding 或 hyperedge 逻辑混合。（人工代码审查：commit 历史）

---

## 约束（Constraints）

### 读写边界（硬约束）

| 目录 / 文件 | 权限 | 说明 |
|-------------|------|------|
| `src/panoramic/builders/doc-graph-builder.ts` | 可写 | schema v2.0 组装入口 |
| `src/panoramic/anchoring/**`（新建） | 可写 | Story 2 锚定模块 |
| `src/panoramic/hyperedges/**`（新建） | 可写 | Story 3 超边提取模块 |
| `src/mcp/graph-tools.ts` | 可写 | MCP 工具适配 |
| `src/panoramic/graph/graph-types.ts` | 可写 | schema 类型定义（实际文件位置） |
| `plugins/*/SKILL.md` | 可写 | 工具说明更新 |
| `specs/_meta/graph.json` | 可写（产物） | 示例项目输出 |
| `src/spec-store/**` | **只读** | F2 SpecStore 不可修改 |
| `specs/project/technical-debt.md` | **禁止** | F3 领地 |
| `src/debt-scanner/**` | **禁止** | F3 领地 |
| `plugins/spec-driver/**` | **禁止** | spec-driver 不可修改 |

### 基线兼容性

- **F1 兼容**：所有 LLM 和 embedding 调用必须通过 `BudgetGate`（`src/batch/budget-gate.ts`）记录 `tokenUsage`，不得绕过。
- **F2 兼容**：`SpecStore`（`src/spec-store/`）仅作只读调用，不修改其接口或数据。
- **F2.5 兼容**：`direction-audit` CLI 在交付后必须继续通过（新边类型通过白名单注册解决）。

### 交付顺序约束

- schema v2.0 升级（Story 1）**必须独立 commit** 先于其他 Story 实现合并，确保类型合同先于消费方代码存在。
- Story 3 受 feature flag 保护，flag 默认关闭，允许在 Story 2 稳定后独立开启验证。

---

## Out of Scope（明确排除）

以下能力明确不在本 Feature（F4）范围内，归属后续 Feature：

| 排除项 | 归属 |
|--------|------|
| 图可视化交互 UI（`graph.html`） | F5 Reading UX |
| 自然语言问答（基于图的问答接口） | F5 Reading UX |
| 债务节点集成到 hyperedge | F3 后续迭代 |
| OpenAI Embedding fallback 作为默认开关 | 本 Feature 仅提供实现，默认关闭 |
| Voyage AI（`voyage-code-3`）embedding provider | 当前不纳入，保留扩展接口 |

---

## 开放问题（Open Questions）

> 状态：Phase 3 clarify 子代理与主编排器已将全部 3 个原始问题 + 3 个次要歧义点（阈值边界、confidence 枚举对齐原 Prompt、feature flag 命名）闭环，详见 [clarify.md](./clarify.md)。此处保留历史记录。

1. **[AUTO-CLARIFIED]**：`rationale_for` 边**仅由 Story 3 LLM hyperedge 提取**附带产出，Story 2 embedding 锚定不生成 — 理由：向量相似度无法区分"设计意图"语义，高阶推理属于 LLM 能力范畴。影响 FR-013（已更新）。

2. **[AUTO-CLARIFIED]**：`evidenceSource` 使用 **repo-relative 路径** — 理由：fixture 可移植性 + MCP 消费方期望 + 行业惯例。影响 FR-004（已追加强调）。

3. **[AUTO-CLARIFIED]**：hyperedge `nodes` **允许混合** doc-section 节点和代码节点，但至少 1 个为代码节点 — 理由：真实流程语义为 doc+code 混合结构；纯 doc 超边失去双向溯源价值。影响 FR-005 / FR-020（已追加约束）。

4. **[AUTO-CLARIFIED]**：相似度阈值边界使用 `>= threshold`（含边界值）— 理由：行业标准 + 直觉一致。影响 FR-012 / Edge Cases（已更新）。

5. **[AUTO-CLARIFIED]**：`confidence` 枚举使用 **`EXTRACTED | INFERRED | AMBIGUOUS`**，对齐用户原始 Prompt 的外部合同命名 — 理由：用户 Prompt 为事实源；此为对外 MCP 合同的一部分。影响 FR-002 / FR-003（已对齐）。

6. **[AUTO-CLARIFIED]**：feature flag 双入口 — 环境变量 `SPECTRA_HYPEREDGES_ENABLED=true` 或 CLI `--hyperedges`，CLI 优先级高，默认关闭。影响 FR-017（已补充）。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估值 | 说明 |
|------|--------|------|
| **组件总数** | 5 | `anchoring/`（新建）、`hyperedges/`（新建）、`doc-graph-builder.ts`（改）、`src/panoramic/graph/graph-types.ts`（改）、`graph-tools.ts`（改）|
| **接口数量** | 6 | `EmbeddingProvider` 接口、`DocChunk` 类型、`SemanticEdge` 类型、`Hyperedge` 类型、`graph_hyperedges` MCP 工具接口、direction-audit 白名单注册表接口 |
| **依赖新引入数** | 1 | `@huggingface/transformers`（optionalDependencies）；Zod 和 Anthropic SDK 已有 |
| **跨模块耦合** | 是 | 需修改 `doc-graph-builder.ts`（调用 anchoring + hyperedges）、`graph-tools.ts`（适配新类型）、`src/panoramic/graph/graph-types.ts`（类型合同）、direction-audit 白名单 4 个现有模块 |
| **复杂度信号** | 1 项 | Strategy Pattern（EmbeddingProvider）属于接口抽象；无递归结构、状态机、并发控制、数据迁移 |
| **总体复杂度** | **MEDIUM** | 组件数 5（处于 3-5 区间）、接口数 6（处于 4-8 区间）、1 个复杂度信号（Strategy Pattern） |

**GATE_DESIGN 建议**：MEDIUM 复杂度，建议人工审查以下两点：（1）`EmbeddingProvider` Strategy Pattern 的接口合同是否足够稳定，避免后续 fallback 扩展需要修改接口；（2）hyperedge 提取模块的 BudgetGate 集成路径是否与现有 LLM 增强链路复用，避免出现两套 tokenUsage 记录机制。

---

## YAGNI 最小必要性复核

| 组件 | 标注 | 说明 |
|------|------|------|
| `anchoring/` 模块（Hybrid Chunking + Local Embedding + edge 生成） | `[必须]` | Story 2 核心，去掉后 INFERRED 边无法生成，函数级锚定能力缺失 |
| `hyperedges/` 模块（LLM 提取 + Zod 校验） | `[必须]` | Story 3 核心，受 feature flag 保护，去掉后超边能力缺失；flag 保证不影响 MVP 基线 |
| `EmbeddingProvider` 接口抽象（Strategy Pattern） | `[必须]` | Local + OpenAI 双 provider 需要统一接口；若无接口，切换 provider 需改动调用方代码 |
| OpenAI Embedding fallback provider 实现 | `[可选]` | 去掉后核心功能仍可运行（Local 主方案完整）；但 fallback 已有明确需求，保留以降低用户切换成本 |
| `graph_community` 适配 hyperedge 列表（FR-025） | `[可选]` | 去掉后核心查询能力仍完整（`graph_hyperedges` 已提供过滤）；`graph_community` 适配为体验增强 |
| golden-master fixture（v1.0 + v2.0 双版本） | `[必须]` | 去掉后 schema 回归测试缺失，schema 破坏性变更无法被测试捕捉 |
| direction-audit 白名单适配 | `[必须]` | 去掉后 F2.5 交付契约被破坏，新边类型会误触发方向违规 |
