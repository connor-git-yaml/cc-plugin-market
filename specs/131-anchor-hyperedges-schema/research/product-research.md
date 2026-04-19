# 产品调研报告: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**特性分支**: `131-anchor-hyperedges-schema`
**调研日期**: 2026-04-19
**调研模式**: 在线（Web 搜索 + 本地 spec 文档分析）

---

## 1. 需求概述

**需求描述**: 给 Spectra 增加三项能力——函数级语义锚定（design-doc 段落精确连接到代码函数节点）、Hyperedges（3+ 节点共同参与的多节点模式）、graph.json schema v2.0（含 `confidence`、`evidenceText`、`evidenceSource` 等字段）。

**核心功能点**:
- 新增边类型：`references` / `conceptually_related_to` / `rationale_for`，颗粒度从"doc 引用 module spec"下沉到函数级
- Hyperedges：将多个函数/组件节点组织为命名的多节点模式（如"Full Ingestion Pipeline"涵盖 parser + validator + processor + storage 四个函数）
- graph.json schema v2.0：为上述能力扩展 `confidence`（EXTRACTED/INFERRED/AMBIGUOUS）、`evidenceText`（原文片段）、`evidenceSource`（文件:行号）字段
- 新增 MCP 工具：`graph_hyperedges` 支持 hyperedge 查询

**目标用户**: 消费 `_meta/graph.json` 的 MCP 工具调用者（Claude Code Agent）、需要跨文档-代码语义追溯的开发者、架构分析师

---

## 2. 市场现状

### 2.1 市场趋势

**知识图谱 + 代码理解正在成为 AI 编程助手的核心差异化能力**。2025-2026 年间，以下几条趋势清晰显现：

1. **从"语法理解"到"语义理解"的跃升**：静态 AST 分析工具已相当成熟（tree-sitter、ts-morph），但它们只能回答"代码结构是什么"，无法回答"这个函数为什么这样写"、"这段设计文档对应哪个实现函数"。市场出现了明显的语义层缺口。

2. **RAG + KG 组合成为主流范式**：GraphRAG（GraphGen4Code、Neo4j LLM KG Builder）将知识图谱作为 RAG 的结构化骨架，通过图节点的语义关联大幅提升检索准确率。函数级锚定是其中最有价值的粒度。

3. **MCP 工具链成为 AI 代码助手的标准接入方式**：Claude Code、Cursor、OpenCode 等均支持 MCP。开发者期望 AI 在回答架构问题时能直接调用本地图查询工具，而不是依赖 LLM 的记忆。CodeGraphContext、Graphify、Sourcegraph Cody 都在这个方向竞争。

4. **文档-代码双向溯源需求强烈**：代码溯源（"这段代码从哪个需求来"）和文档溯源（"这个 spec 对应哪些函数"）被越来越多团队视为工程质量指标。传统工具（Jira 链接、注释 TODO）无法做到机器可查。

### 2.2 市场机会

Spectra 当前的 graph.json（schema v1.0）已具备模块级关系图，但存在一个明确的粒度鸿沟：**文档段落 → 代码函数** 之间没有可机器查询的语义边。F4 填补的正是这个空白，且是在已有知识图谱基础设施（F1-F3 基线）上的增量扩展，不需要重建整体图谱。

### 2.3 用户痛点

- **痛点 1（代码理解者）**：Claude Code 在回答"Parsing Stage 用了哪几个函数"时，只能依赖 LLM 记忆或全局 grep，无法通过图查询精确锚定。当前 `graph_node` 工具无法跨越文档-函数边界。
- **痛点 2（架构审查者）**："Full Ingestion Pipeline"这样的多函数协作模式无法在 graph.json 中表达为一个命名实体，只能通过文字描述或离线整理，导致 AI 无法直接查询"哪些函数共同构成一条关键链路"。
- **痛点 3（文档维护者）**：architecture.md 里的"Parsing Stage"段落修改后，无法知道影响了哪些函数节点，缺乏双向溯源机制。
- **痛点 4（MCP 工具调用者）**：返回的边数据缺乏 `evidenceText` / `evidenceSource`，无法验证 LLM 推断的语义关联是否可信，导致用户对 INFERRED 边不信任、实际使用率低。

---

## 3. 竞品分析

### 3.1 竞品对比表

| 维度 | Graphify v4 | Sourcegraph Cody | CodeGraphContext | Spectra F4（计划） |
|------|------------|-----------------|-----------------|-------------------|
| **核心能力** | 多模态 KG（AST + LLM），Leiden 聚类，Hyperedges | 精确代码图（symbols/references/deps），AI 查询 | 本地代码图索引，MCP 接入 | 函数级锚定 + Hyperedges + 置信度证据链 |
| **函数级锚定** | 支持（`rationale_for`、`references` 边直达函数节点） | 支持（symbol 级精确引用，但缺少文档-函数语义边） | 部分支持（AST 边，无语义层） | 支持（新增 `references`/`conceptually_related_to`/`rationale_for` 边） |
| **Hyperedges** | 支持（命名为"所有 auth flow 函数"等多节点组） | 不支持（仅 pair edges） | 不支持 | 支持（命名 hyperedge，含成员列表） |
| **置信度分级** | 支持（EXTRACTED/INFERRED/AMBIGUOUS + 数值分数） | 不暴露（内部置信度，用户不可见） | 不支持 | 支持（继承 v1.0 三级 + 新增 evidenceText/evidenceSource） |
| **文档-代码语义边** | 支持（从 Markdown 文档提取 `rationale_for` 边连接函数） | 弱（doc search 与 code search 分离，无语义边） | 不支持 | 支持（architecture.md 段落 → 函数节点精确边） |
| **MCP 工具** | 有（通过 Claude Code skill，`graph_query`/`graph_hyperedges`） | 有（Cody MCP，symbols/refs/deps） | 有（本地 MCP server） | 有（新增 `graph_hyperedges` 工具） |
| **schema 稳定性** | 弱（v3/v4 快速迭代，边类型不稳定） | 强（Sourcegraph 企业级，API 稳定） | 弱（实验性项目） | 中（graph.json schema v2.0，明确版本合同） |
| **本地部署** | 支持（纯本地，不发送代码） | 企业版支持，SaaS 为主 | 支持 | 支持（本地运行，写入 `_meta/`） |
| **与 spec 文档集成** | 不支持（无 spec 生成能力） | 不支持 | 不支持 | 深度集成（Spectra 同时持有 spec 和知识图谱） |
| **定价** | 免费开源 | 企业定价（自托管 + SaaS） | 免费开源 | 免费开源（Claude Code Plugin） |

### 3.2 竞品详细分析

**Graphify（最直接竞品）**

Graphify 是目前功能上最接近的竞品，已支持 `references`、`rationale_for`、`semantically_similar_to` 边，以及命名 hyperedges（"All functions in auth flow"）。其置信度系统与 Spectra F4 设计高度一致（EXTRACTED/INFERRED/AMBIGUOUS）。

核心差距：Graphify 是纯图谱工具，没有 Spectra 的 spec 生成能力、覆盖率审计、delta regeneration 等工程链路。Spectra F4 的优势在于图谱与 spec 文档系统深度集成——`conceptually_related_to` 边的 source 可以是已有的 spec 节点（如 `specs/095-deep-reverse-spec/spec.md` 的"解析阶段"章节），而不仅是通用 Markdown 文档。

**Sourcegraph Cody（企业竞品）**

symbol 级精确引用能力强，但文档-代码语义连接是弱点。其"precise code graph"仍是 AST/引用层面，没有从 architecture.md 的设计概念到函数实现的语义边。定价高、需要企业采购，对 Claude Code Plugin 用户不构成直接威胁，但代表了"语义精确度"的对标目标。

**CodeGraphContext（轻量竞品）**

实验性 MCP server，支持基本代码图索引，无语义层，无文档-代码边。功能子集远小于 Spectra。

### 3.3 差异化机会

1. **spec 文档 × 知识图谱双向溯源**：Spectra 同时持有 spec（`.md` 文档）和图谱节点，可以在 spec 段落和函数节点之间建立唯一的双向可机器查询的语义边。这是 Graphify 和 Sourcegraph 都没有的能力。

2. **Hyperedge 作为可查询的架构模式**：不是仅展示 hyperedge，而是让 `graph_hyperedges` MCP 工具返回"这条链路包含哪些函数、这些函数的当前置信度、证据来源"。AI Agent 可以直接问"Full Ingestion Pipeline 的函数列表"并获得精确结构化答案。

3. **置信度 + 证据链透明化**：`evidenceText`（原文片段）+ `evidenceSource`（文件:行号）使得 INFERRED 边可被人工验证，解决用户对 LLM 推断边的信任问题。这是竞品普遍缺失的 UX 设计。

---

## 4. 用户场景验证

### 4.1 核心用户角色

**Persona 1: AI 编程助手用户（主力 Persona）**

- 背景：使用 Claude Code 进行日常开发，频繁需要 Claude 回答跨文件/跨文档的架构问题
- 目标：希望 Claude 在回答"architecture.md 里的 Parsing Stage 对应哪些代码"时，能给出精确的函数级答案，而不是猜测
- 痛点：当前 `graph_node` 查询 spec 节点时，返回的邻居只有模块级边，无法精确到函数
- F4 价值：`graph_node("Parsing Stage")` 返回中包含 `references` 边直达 `parseModule()`、`validateAST()` 等具体函数

**Persona 2: 架构文档负责人**

- 背景：维护 architecture.md、ADR、设计文档，需要确保文档与代码同步
- 目标：当某个 design concept 修改时，知道影响了哪些函数；当重构某函数时，知道哪些设计文档引用了它
- 痛点：当前无机器可查的文档-函数双向关系，只能靠人工搜索
- F4 价值：`graph_node("src/core/parser.ts::parseModule")` 返回中含 `conceptually_related_to` 反向边，直达引用它的 spec 段落

**Persona 3: 代码 review 者 / Onboarding 者**

- 背景：接手遗留代码，或 review 涉及多模块的复杂 PR
- 目标：快速理解"Full Ingestion Pipeline"究竟涉及哪些函数、这些函数之间的调用关系和设计意图
- 痛点：当前 graph 无法将多函数组织为命名模式；`graph_path` 只返回路径，无法回答"哪些函数共同构成一个语义单元"
- F4 价值：`graph_hyperedges` 工具返回"Full Ingestion Pipeline" hyperedge，含成员函数列表、hyperedge 级置信度、证据文本

### 4.2 关键用户旅程

**旅程 1：从设计文档追溯到函数实现**

用户在 architecture.md 读到"Parsing Stage handles token normalization and type inference"，想知道这对应哪些函数。

当前（F4 之前）：只能靠 grep 或 Claude 的 LLM 记忆猜测。

F4 之后：Claude 调用 `graph_node`，查找 architecture.md 的"Parsing Stage" doc-section 节点，沿 `references` 边获取 `parseTokens()`、`inferTypes()` 等函数节点，返回精确列表 + 证据原文。

**旅程 2：查询多函数协作链路（Hyperedge）**

用户问 Claude："整个数据摄取管道包含哪些函数？"

F4 之后：Claude 调用 `graph_hyperedges`，搜索 "Ingestion" 相关命名，返回 hyperedge 成员列表（parser/validator/processor/storage 四个函数节点）、hyperedge 置信度、关联证据文档段落。

**旅程 3：验证 LLM 推断边（置信度 UX）**

Claude 返回一条 INFERRED 置信度的 `conceptually_related_to` 边，连接 `cacheManager.ts` 和 architecture.md 的"Storage Layer"章节。

用户存疑：F4 的 `evidenceText` 字段显示"'The caching layer directly interfaces with the storage abstraction'"（原文片段），`evidenceSource` 显示"architecture.md:47"。用户可直接跳转到该行验证，信任度提升。

### 4.3 需求假设验证

| 假设 | 验证结果 | 证据 |
|------|---------|------|
| 用户需要函数级而非模块级的语义锚定 | 已验证 | Graphify 已支持 `references` 直达函数节点，用户反馈积极；Sourcegraph "precise code graph"强调 symbol 级 |
| Hyperedges 比单纯 pair edges 能更好表达多函数模式 | 已验证 | Graphify 文档明确支持"all functions in auth flow"类 hyperedge；学术研究证实超图更适合表达 3+ 节点协作关系 |
| `evidenceText` / `evidenceSource` 对用户信任度有实质影响 | 已验证 | 置信度可视化的 AI 信任研究（Smashing Magazine 2025）证实：能展示"为什么这样推断"的系统获得更高用户信任度 |
| INFERRED 边在没有证据链时用户倾向于忽略 | 已验证 [推断] | 现有 v1.0 的 `INFERRED` 边未被用户主动查询（缺乏可验证锚点是核心原因） |
| Hyperedge 数量过多会产生认知负担 | 待确认 | 需要产品决策：hyperedge 是按置信度阈值筛选还是按文档显式标注生成 |

---

## 5. UX 约束分析

### 5.1 置信度三级分类在 MCP 工具返回结果上的呈现建议

MCP 工具（`graph_node` / `graph_hyperedges`）返回的结构化文本中，置信度应以如下方式影响信息呈现：

**EXTRACTED（高置信度，0.9-1.0）**
- 呈现方式：正常列出，不加特殊标注
- 用户心理：等同于 AST 静态事实，完全可信
- 示例输出：`references → parseTokens() [EXTRACTED, evidence: src/parser.ts:124]`

**INFERRED（中置信度，0.5-0.8）**
- 呈现方式：正常列出，但 `evidenceText` 字段必须非空，便于用户快速验证
- 用户心理：合理推断，希望看到推断依据
- 示例输出：`conceptually_related_to → "Storage Layer" [INFERRED, evidence: "the caching layer directly interfaces with storage" @ architecture.md:47]`

**AMBIGUOUS（低置信度，0.1-0.4）**
- 呈现方式：置于返回结果末尾，标注"[待确认]"
- 用户心理：弱信号，不应直接采信
- 示例输出：`conceptually_related_to → "Error Handling" [AMBIGUOUS, 待确认] `

**关键 UX 约束**：Claude 在引用 INFERRED/AMBIGUOUS 边得出结论时，必须同步输出 `evidenceText` 和 `evidenceSource`。这要求 `graph_hyperedges` 和 `graph_node` 工具的返回 schema 在 F4 后强制包含这两个字段（不可为空字符串）。

### 5.2 `evidenceText` + `evidenceSource` 的 UX 价值

这两个字段的核心价值不在于"显示原文"，而在于**让用户能用 3 秒验证一条 INFERRED 边的可信度**：

- `evidenceSource = "architecture.md:47"` → 用户直接跳转到该行
- `evidenceText = "Parsing Stage..."` → 用户在 MCP 返回中即可判断是否相关，无需打开文件

缺乏这两个字段时，INFERRED 边对用户的实际价值接近于零（无法区分高质量推断和 LLM 幻觉）。

### 5.3 `conceptually_related_to` vs `references` 的语义区分

这是 F4 最需要明确的产品决策，用户如何区分这两种边类型直接影响 API 的可用性：

| 维度 | `references` | `conceptually_related_to` |
|------|-------------|--------------------------|
| 语义 | 明确的、可确认的引用关系（A 章节说"参见函数 B"；代码 A 明确调用/导入 B） | 同一概念的不同表达，无明确引用标记 |
| 置信度预期 | 多为 EXTRACTED 或高置信度 INFERRED | 多为 INFERRED，少量 EXTRACTED（基于 embedding 相似性） |
| 用户理解 | "这个文档章节明确指向这个函数" | "这个文档概念和这个函数在语义上高度相关，但没有显式引用" |
| 产品规则（建议） | 由 LLM 从文档中提取显式引用标记时创建 | 由 embedding 相似度 >= 0.75 时创建，标注推断原因 |

**建议**：`references` 边的置信度下限应高于 `conceptually_related_to`，且 `references` 的 `evidenceText` 应包含原始引用的精确文字片段。

---

## 6. 风险与替代方案

### 6.1 Hyperedge 认知负担风险

**风险描述**：如果 hyperedge 自动生成数量过多（每个相互调用的函数组都被建模为 hyperedge），用户查询时面对大量 hyperedge 结果，反而难以定位感兴趣的那个。

**严重程度**：中。在 Graphify 的实践中，hyperedge 是由 LLM 在文档语义分析阶段显式命名生成的，不是对所有连通子图都建 hyperedge，因此数量受控。

**缓解建议（产品层面）**：
- Hyperedge 优先从 design-doc 明确描述的"流程/阶段/模式"中提取，而非从代码结构自动推断所有连通子图
- 提供 `graph_hyperedges --min-confidence INFERRED` 过滤参数
- hyperedge 的 `label` 字段必须为人类可读的命名（如"Full Ingestion Pipeline"），不能是 hash 或 UUID

### 6.2 embedding 假阳性边风险

**风险描述**：基于 embedding 相似度 >= 0.75 生成的 `conceptually_related_to` 边，可能包含语义相近但实际无关联的节点对（如两个都涉及"缓存"的模块，但处理完全不同的业务逻辑）。

**严重程度**：中。假阳性边会污染知识图谱，降低用户对 INFERRED 边的整体信任度。

**缓解建议**：
- 0.75 阈值不是产品决策，需技术调研确定合适阈值区间（交给 tech-research）
- 产品层面强制要求：`conceptually_related_to` 边必须携带 `evidenceText`（embedding 相似度计算所用的具体文本片段）
- 提供 `AMBIGUOUS` 分级作为安全网：0.75-0.85 之间标记为 INFERRED，低于 0.75 不建边（而非标记为 AMBIGUOUS），避免噪声过多

### 6.3 schema v2.0 迁移摩擦

**风险描述**：graph.json 从 v1.0 升级到 v2.0，下游消费者（Feature 102 community-analysis、Feature 105 MCP query tools）需要适配新字段。

**严重程度**：低。Feature 101 的 schema 合同已明确"新增可选字段 → minor bump"，不影响现有消费者。但需明确 `evidenceText`/`evidenceSource` 是可选还是必填字段。

**产品建议**：
- 对 EXTRACTED 边：`evidenceText`/`evidenceSource` 可为空（AST 事实无需原文引用）
- 对 INFERRED/AMBIGUOUS 边：`evidenceText` 必填（否则边的可信度无法被用户验证，等同于无效字段）
- `schemaVersion` 从 '1.0' 升级到 '2.0'，下游工具按 `schemaVersion` 做分支处理

---

## 7. MVP 范围建议

### Must-have（MVP 核心，v3.2.x）

1. **graph.json schema v2.0**：新增 `evidenceText`、`evidenceSource` 字段（INFERRED/AMBIGUOUS 边必填），`confidence` 字段扩展到所有边类型（继承 v1.0 已有的三级分类），`schemaVersion` 升级到 '2.0'
2. **新增边类型**：`references`、`conceptually_related_to`、`rationale_for`，颗粒度覆盖到函数节点（`kind: 'function'` 节点类型）
3. **Hyperedge 数据结构**：在 graph.json 中新增 `hyperedges` 数组字段，每个 hyperedge 含 `id`、`label`、`memberIds`、`confidence`、`evidenceText`
4. **`graph_hyperedges` MCP 工具**：支持按名称/关键词查询 hyperedge，返回成员节点列表和置信度证据

### Nice-to-have（二期，v3.3.x）

5. **Hyperedge 自动提取**：从 architecture.md 等 design doc 中自动识别并命名 hyperedge（当前 MVP 可支持手动或 LLM 单次提取）
6. **双向溯源 CLI**：`spectra anchor --from architecture.md:47` 查询某文档行对应的函数节点
7. **`graph_hyperedges` 支持过滤参数**：`--min-confidence`、`--include-members` 等

### Future（远期，v4.x）

8. **Hyperedge 图可视化**：在 HTML 导出（Feature 103）中高亮显示 hyperedge 成员，用不同颜色/形状区分（当前 F5 Reading UX 范围）
9. **实时 embedding 更新**：代码变更时增量重算 `conceptually_related_to` 边，与 `spectra watch` 集成
10. **自然语言问答**：基于 hyperedge 和函数级锚定的语义问答能力（F5 Reading UX 范围）

### 7.1 优先级排序理由

Schema v2.0 + 新边类型是整个 F4 的数据基础，必须首先完成，其他能力都依赖新 schema。`graph_hyperedges` MCP 工具是用户价值的直接入口——没有这个工具，Hyperedge 的数据结构无法被 Claude Code 消费。`evidenceText`/`evidenceSource` 是信任链的最后一块，不加入 MVP 会导致 INFERRED 边被用户忽略，整个函数级锚定的价值大打折扣。

---

## 8. 具体验收场景

以下是 3 条 "if A then B" 格式的具体验收描述，适用于在 graphify 示例项目上验证。

**验收场景 1：doc-section → 函数级 references 边**

- **Given** 已运行 F4 的 `spectra graph` 命令，且 architecture.md 中存在"Parsing Stage"章节，该章节文本中明确提到 `parseTokens` 函数
- **When** Claude Code 调用 `graph_node("Parsing Stage")`
- **Then** 返回结果中包含至少一条 `relation: "references"` 边，`target` 为对应函数节点的 id，`confidence` 为 `EXTRACTED` 或 `INFERRED`，`evidenceText` 包含 architecture.md 中引用 `parseTokens` 的具体原文片段，`evidenceSource` 为 `architecture.md:<行号>`

**验收场景 2：Hyperedge MCP 查询返回完整成员列表**

- **Given** graph.json schema v2.0 的 `hyperedges` 数组中存在一条 label 为"Full Ingestion Pipeline"的 hyperedge，成员包含 parser、validator、processor、storage 四个函数节点
- **When** Claude Code 调用 `graph_hyperedges`，查询关键词包含"Ingestion"或"Pipeline"
- **Then** 返回结果包含该 hyperedge 的完整成员 id 列表（四个函数节点均在列），hyperedge 级 `confidence` 字段存在且非空，`evidenceText` 包含触发该 hyperedge 识别的文档原文片段

**验收场景 3：INFERRED 边必须携带 evidenceText，AMBIGUOUS 边不建立**

- **Given** F4 图构建过程中，某两个节点的 embedding 相似度为 0.77（位于 0.75-0.85 阈值区间）
- **When** graph.json 构建完成后，检查对应的 `conceptually_related_to` 边
- **Then** 该边 `confidence` 为 `INFERRED`，`evidenceText` 字段非空（包含计算相似度所用的具体文本片段），`evidenceSource` 非空（指向相似度来源文档的行号）；若相似度低于 0.75，则该边不存在于 graph.json 中（不降级为 AMBIGUOUS，而是直接不建边，避免噪声）

---

## 9. 结论与建议

### 9.1 总结

F4 填补的是 Spectra 知识图谱的两个核心粒度缺口：**文档-函数跨层语义边**（当前只到文档-模块层）和**多节点协作模式命名**（当前只有 pair edges）。市场竞品（Graphify）已验证这两个方向的用户价值，Spectra 的差异化在于这些能力与现有 spec 文档系统的深度集成，以及更严格的 schema 版本合同。

`evidenceText` + `evidenceSource` 是 MVP 的必要条件而非可选项——它是 INFERRED 边从"存在但无用"到"存在且可信任"的关键转变。

### 9.2 对技术调研的建议

- **Embedding 选型**：`conceptually_related_to` 边的质量直接依赖 embedding 模型选择，需技术调研确定：本地 embedding（如 `@xenova/transformers`）vs LLM API、相似度阈值（建议从 0.75-0.85 区间入手）、假阳性率控制策略
- **Hyperedge 生成策略**：技术调研应关注是从文档 LLM 提取（Graphify 的做法）还是从 graph 连通性自动推断；MVP 阶段建议优先走文档 LLM 提取，减少假阳性风险
- **Function 节点类型扩展**：当前 v1.0 schema 的 `GraphNode.kind` 不含 `'function'` 类型，schema v2.0 需新增该类型及对应的 `filePath`、`lineStart`、`lineEnd` 等字段

### 9.3 风险与不确定性

- **Embedding 假阳性**：阈值选择对 `conceptually_related_to` 边的质量影响极大，需技术实验确定，不能拍脑袋定 0.75
- **Hyperedge 数量控制**：若自动提取策略过于激进，图谱中出现数百个 hyperedge 会严重影响 `graph_hyperedges` 工具的可用性；产品需定义明确的生成触发条件（建议：仅从设计文档中显式命名的"流程/阶段"提取，而非从代码结构推断）
- **schema v2.0 的 `schemaVersion` 升级**：需要 tech-research 确认 Feature 102/105 下游工具是否需要同步适配，以及适配工作量是否在 F4 的 scope 内

---

*调研来源：Graphify 官方文档（v4）、Sourcegraph 产品页、Code Intelligence Tools 对比研究（Ry Walker Research）、AI 信任度与置信度 UX 研究（Smashing Magazine 2025）、知识图谱超图应用研究（Awesome-Hypergraph-Network）、GraphGen4Code 学术论文（WALA）*
