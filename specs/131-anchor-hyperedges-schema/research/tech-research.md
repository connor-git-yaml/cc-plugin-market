# 技术调研报告: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**特性分支**: `131-anchor-hyperedges-schema`
**调研日期**: 2026-04-19
**调研模式**: 在线
**产品调研基础**: [独立模式] 本次技术调研未参考产品调研结论，直接基于需求描述和代码上下文执行

---

## 1. 调研目标

### 核心问题

1. **Embedding 技术选型**：在本地推理（`@xenova/transformers`）、OpenAI API（`text-embedding-3-small`）、Voyage AI（`voyage-code-3`）之间，哪个方案在质量 / 成本 / 依赖侵入性三个维度上最契合 Spectra 的现实约束？
2. **Chunking 策略**：如何将 design-doc markdown 分块，使 chunk 质量与 evidenceSource（文件:行号）回溯需求同时被满足？
3. **graph.json schema v2.0 升级策略**：新增边类型（`references`、`conceptually_related_to`、`rationale_for`）、hyperedges 顶层数组、schemaVersion 升级如何在不破坏现有消费方的前提下完成？
4. **Edge 去重与 confidence 冲突解决**：同一 (source, target, type) 三元组在不同 confidence 等级之间如何合并？
5. **MCP 工具 `graph_hyperedges` API 设计约束**：过滤参数、返回结构、与现有 `graph_node` / `graph_community` 工具的风格一致性。

### 需求 MVP 范围

- Story 1 (P1)：schema v2.0 升级 + direction-audit 适配
- Story 2 (P1)：Chunked markdown embedding → references / conceptually_related_to 边
- Story 3 (P2)：Hyperedge 提取（LLM prompt 工程）
- Story 4 (P2)：MCP graph_hyperedges 工具 + graph_node / graph_community 适配

---

## 2. 核心技术决策：Embedding 方案选型

### 2.1 方案对比表

| 维度 | 方案 A: Local（@xenova/transformers） | 方案 B: OpenAI（text-embedding-3-small） | 方案 C: Voyage AI（voyage-code-3） |
|------|--------------------------------------|----------------------------------------|----------------------------------|
| **模型** | all-MiniLM-L6-v2（384 维）或 all-mpnet-base-v2（768 维） | text-embedding-3-small（1536 维） | voyage-code-3（1024 维） |
| **代码+自然语言混合质量** | 中等；MiniLM 在通用语料训练，代码理解有限；mpnet 略强；[推断] 0.75 阈值下可能产生较多 false positive | 良好；通用语义理解强，代码 docstring 理解优秀；代码 token 级语法理解弱 | 最佳；专为代码 + 自然语言混合语料优化；在 CodeSearchNet 上比 text-embedding-3-large 高 5-8 NDCG 点 |
| **成本（500K tokens，季度 1 次，年 4 次）** | $0（零 API 成本）；首次启动下载 ~90MB 模型文件 | 年成本 = 500K × 4 × $0.02/1M = **$0.04**（极低） | 年成本 = 500K × 4 × $0.18/1M = **$0.36**；首 200M tokens 免费（新账户） |
| **依赖侵入性** | 高：npm 包体 ~200MB（含 ONNX runtime）；首次运行需下载模型；增加冷启动时间 10-30 秒 | 低：无新 npm 包；需要 `OPENAI_API_KEY` 环境变量；破坏"零 API key 可运行"假设 | 低：无新 npm 包；需要 `VOYAGE_API_KEY`；破坏"零 API key 可运行"假设；用户已有 key 概率较低 |
| **网络依赖** | 仅首次下载模型；之后完全离线运行 | 每次调用都需要网络；速度取决于网络和 OpenAI API 可用性 | 每次调用都需要网络；Voyage AI 可用性 SLA 未被广泛验证 |
| **与现有批处理 pipeline 集成** | 需要在 Node.js 环境中加载 ONNX runtime；与 budget-gate.ts 集成时需要异步加载 | 与现有 `@anthropic-ai/sdk` 集成模式相似，直接 HTTP 调用；可在 budget-gate 中计费 | 与 OpenAI SDK 调用模式相似；需要单独安装 voyageai SDK 或直接 fetch |
| **许可证** | Apache-2.0（transformers.js）；MIT（all-MiniLM-L6-v2 模型） | 商业 API，按使用量计费 | 商业 API，按使用量计费 |
| **社区规模** | transformers.js：~13K GitHub stars；活跃维护 | OpenAI：业界标杆，最大社区 | Voyage AI：由前 Meta/Stanford 研究员创立，2024 年融资；社区较小但专注代码场景 |
| **可测试性** | 高：本地可确定性测试，无外部依赖 | 中：需 mock 或真实 API key；CI 测试需要注意成本 | 中：同上 |

### 2.2 成本推演（中等项目，500K tokens）

```
假设：
- 中等项目文本体量：50 万 tokens（doc + 代码签名 + docstring）
- 运行频率：每季度 1 次 full batch（年 4 次）
- 年度 embedding token 总量：500K × 4 = 2M tokens

方案 A（Local）:
  API 成本 = $0.00
  首次依赖：~200MB npm 包 + 首次运行 ~90MB 模型下载
  运行时内存：~300MB 增量（ONNX inference）

方案 B（OpenAI text-embedding-3-small）:
  标准价格：$0.02 / 1M tokens
  年成本 = 2M × $0.02/1M = $0.04
  批量价格：$0.01 / 1M tokens → 年成本 $0.02（可忽略）

方案 C（Voyage AI voyage-code-3）:
  标准价格：$0.18 / 1M tokens
  年成本 = 2M × $0.18/1M = $0.36
  首 200M tokens 免费（新账户约可支撑 100 个中等项目年用量）
```

**结论**：三个方案的 API 成本差距在中等规模下几乎不是决策因素（年费用均 < $1）。真正的决策维度是**依赖侵入性**和**零 API key 可运行**的现有约束。

### 2.3 推荐决策

**主方案推荐：方案 A（Local，`@xenova/transformers` + `all-MiniLM-L6-v2`）**

**理由**：

1. **零 API key 可运行**：Spectra 作为开源工具，用户环境高度异构。现有 pipeline（budget-gate.ts、spectra graph 命令）均无需外部 API key 即可运行。引入 embedding API key 会打破这一基线，降低开箱即用体验。
2. **成本完全可预测**：本地推理无运行时成本，不受 API 定价变动影响；200MB 的一次性依赖对于已有 Node.js `web-tree-sitter`、`ts-morph`、`graphology` 等大型依赖的项目而言可接受。
3. **数据不出本地**：代码 docstring 和 spec 文档可能包含敏感商业逻辑，本地推理保证数据不离开用户设备，符合企业用户的安全要求。
4. **可离线运行**：模型首次下载后完全离线。CI 环境可预先缓存模型，避免网络依赖。
5. **可测试性强**：embedding 向量可在测试中确定性重现，不需要 mock API，测试稳定性高。

**质量折衷说明**：all-MiniLM-L6-v2 在代码+自然语言混合语料上的表现弱于 voyage-code-3。[推断] 在 F4 的具体场景（代码节点的 signature/docstring 匹配 doc 片段的 heading/paragraph）中，由于 docstring 通常是自然语言表达，MiniLM 的语义理解基本够用。可通过**适当调低阈值**（如从 0.75 下调至 0.70）补偿精度差。阈值可配置是已有设计（Story 2 要求），用户可按实际效果调整。

**Fallback 方案：方案 B（OpenAI `text-embedding-3-small`）**

- 触发条件：本地推理在 CI 或受限环境中不可用（如 Node.js ARM 版 ONNX 兼容性问题）；或用户已有 OPENAI_API_KEY（通过现有 LLM 增强流程推测已有概率较高）。
- 成本极低（$0.04/年），API 稳定性最高。
- 实现方式：embedding 模块抽象为 `EmbeddingProvider` interface，local 实现和 OpenAI 实现均可插拔；通过环境变量 `SPECTRA_EMBEDDING_PROVIDER=openai|local` 切换。

**不推荐方案 C（Voyage AI）**：voyage-code-3 质量最佳，但需要独立 API key，用户持有概率低；且 Voyage AI 知名度低于 OpenAI，用户接受度不确定。适合作为**高级可选配置**，不作为默认 fallback。

---

## 3. 次要技术点分析

### 3.1 Chunking 策略

#### 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| Heading-based | 按 H1/H2/H3 边界分块 | 语义边界清晰；chunk 通常对应一个完整主题 | chunk 大小差异极大（1 行到 200 行）；小 heading section 可能上下文不足 |
| Paragraph-based | 按空行分块（单段落为单位） | chunk 粒度均匀；行号映射精确 | 上下文丢失（段落不包含所属 heading 信息）；过碎 |
| Hybrid（推荐） | H2/H3 边界切割 + 段落合并 + 最大 token 上限兜底 | 保留语义 heading 上下文；chunk 大小可控；行号范围可追踪 | 实现略复杂 |
| Semantic（LLM-based） | 用 LLM 判断语义边界 | 理论质量最高 | 成本高；速度慢；不适合批处理 |

**推荐：Hybrid 策略**

实现规则：
1. 以 `## ` 和 `### ` 为主要分割边界（H2/H3），保留 heading 文本附加到每个 chunk 的前缀
2. 每个 heading section 内部按段落（空行）进一步分割，同一 section 的相邻段落合并直到接近 token 上限
3. 单个 chunk 最大 token 数：**512 tokens**（实验基准；MiniLM 输入上限 512 tokens，超过会截断）
4. 每个 chunk 记录：`filePath`、`startLine`、`endLine`、`headingPath`（如 `## Design > ### API`）

**evidenceSource 回溯**：每个 chunk 必须保留 `startLine` / `endLine`，生成 evidence 时取 `filePath:startLine` 格式，满足 Story 1 的 `evidenceSource: "文件:行号"` 要求。

**chunk 最大 token 限制**：512 tokens 对应约 400 汉字或 350 英文单词。code fence 内的代码片段也计入该上限；若代码块本身超过 512 tokens，则单独作为一个 chunk。

### 3.2 Edge 去重与 confidence 冲突解决

#### 现有基础

当前 `graph-builder.ts` 已有边去重逻辑（`undirectedEdgeKey` / `directedEdgeKey`），基于 `(source, target, relation)` 三元组去重，后写覆盖先写。

#### F4 场景问题

Embedding 批处理可能多次为同一 (source, target, type) 三元组生成边，且 confidence 等级可能不同（如第一次 `INFERRED`，第二次因更强证据提升为 `EXTRACTED`）。

**推荐策略：Higher-confidence Wins**

```
去重键：(source, target, relation)
冲突规则：
  EXTRACTED  优先于  INFERRED  优先于  AMBIGUOUS
  同等 confidence 时：保留较高 confidenceScore（数值分数）的一条
  evidenceText：保留触发更高 confidence 的那条
```

对应代码：在 embedding pipeline 的边合并阶段（不在 graph-builder 通用层），添加 confidence 感知的合并逻辑，避免影响现有 AST 边的去重行为。

#### evidence_text 截断策略

- 200 字符硬限制（Story 1 要求）
- **策略**：从匹配位置向两侧各扩展，优先包含完整句子（以 `. ` 或 `\n` 为边界）
- 若匹配发生在 chunk 中间：取 `matchOffset - 80` 到 `matchOffset + 120` 的滑动窗口（偏向后文，因为后文通常包含解释）
- **是否保留 markdown 格式**：去除 heading `#`、code fence 标记 ` ``` `；保留 inline code `` ` ``（有助于识别 API 名称）
- 若截断后结果以 `...` 开头或结尾，补充省略标记

### 3.3 Hyperedge 提取 Prompt 工程

#### 输入设计

每次 LLM 调用的输入构成：

```
系统 prompt：
  - 你是代码知识图谱分析专家
  - 输入：一批代码节点（含 id、label、signature、docstring）+ 相关 doc 片段（含 headingPath、text）
  - 任务：识别 ≥3 个节点之间的高阶语义关联，输出 hyperedges

用户 prompt 变量：
  - nodes：最多 20 个节点的 JSON 列表（id + label + signature 前 100 字符）
  - docChunks：最多 10 个相关 doc 片段（headingPath + text 前 200 字符）
  - projectSummary：可选，来自 .specify/project-context.yaml 的 description 字段
```

**输入体积控制**：每个 batch 的 nodes 列表 + docChunks 合计 token 数建议控制在 4000 tokens 以内，以保证 LLM 输出质量并满足 budget-gate 约束（Story 3 要求走 F1 budget 基础设施）。

#### 输出 Schema 稳定性

使用 JSON mode（结构化输出）而非自由文本，配合 Zod schema 验证：

```typescript
// 期望输出 schema
const HyperedgeOutputSchema = z.object({
  hyperedges: z.array(z.object({
    label: z.string().min(2).max(8).describe("2-8 个词的简洁标签"),
    nodes: z.array(z.string()).min(3).describe("节点 ID 列表，至少 3 个"),
    rationale: z.string().max(200),
    confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
  })).max(10),
});
```

**防噪声措施**：
1. 限制每 batch 最多 10 个 hyperedge（Story 3 要求）
2. `nodes.length >= 3` 硬约束（小于 3 节点的是普通边，不是 hyperedge）
3. Zod 验证失败时降级：返回空数组 + 记录 warning，不抛出异常（保持 graceful degradation 原则）
4. confidence 仅允许 `INFERRED` 或 `AMBIGUOUS`（LLM 生成的 hyperedge 不能标 `EXTRACTED`，`EXTRACTED` 保留给 AST 直接提取的关系）

#### budget-gate 集成

Hyperedge 提取批次需要通过 `runBudgetGate`，估算逻辑：
- 输入 tokens：按 `estimateFast(nodesList + docChunks)` 估算
- 输出 tokens：按输入的 0.2 倍估算（hyperedge JSON 较短）

### 3.4 MCP 工具 `graph_hyperedges` API 设计

#### 过滤参数（与现有工具风格对齐）

现有工具（`graph_query`、`graph_node`、`graph_community`）均接受 `projectRoot?: string` 和数量上限 `budget?: number`，`graph_hyperedges` 应延续此风格：

```typescript
{
  label?: string,           // 精确匹配或 substring match
  nodeId?: string,          // hyperedge 必须包含此节点
  confidenceMin?: string,   // 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'（枚举下限）
  limit?: number,           // 返回数量上限（默认 20）
  projectRoot?: string,
}
```

**返回结构**：完整 hyperedge（label + nodes + rationale + confidence），nodes 字段展开为节点摘要（id + label），不展开完整邻居（避免响应体积膨胀）。

#### graph_node 适配

`graph_node` 返回结果中新增 `hyperedges` 字段（关联当前节点的 hyperedge 列表，默认最多 5 条），按 confidence 降序排列。需要修改 `NodeResult` 接口。

#### graph_community 适配

`graph_community` 返回结果中新增 `crossCommunityHyperedges` 字段：仅展示 nodes 跨越多个社区的 hyperedge（即 nodes 列表中包含来自不同 communityId 的节点），用于识别跨社区的高阶语义关联。

---

## 4. 架构方案选型：schema v2.0 升级路径

### 方案对比

| 维度 | 方案 A: 原地扩展 | 方案 B: 新文件分离 |
|------|----------------|------------------|
| **概述** | 在现有 `graph.json` 中直接扩展：新增顶层 `hyperedges` 数组、在 `links` 中增加可选字段 | 将 hyperedges 输出到独立的 `hyperedges.json`；graph.json 仅扩展 links 字段 |
| **向后兼容性** | 需要谨慎：新字段（`evidenceText`、`evidenceSource`、`hyperedges`）对旧消费方透明（JSON 额外字段通常被忽略）；`schemaVersion` 升级是唯一显式 breaking change | 完全兼容：旧消费方读 `graph.json` 看不到 hyperedges；但需要维护两个文件 |
| **查询引擎复杂度** | 单文件加载；`GraphQueryEngine` 改动局限在 load + 新查询方法 | 需要协调加载两个文件；缓存策略复杂化 |
| **direction-audit CLI 影响** | 需要适配新边类型（白名单）；`schemaVersion` 感知逻辑 | 影响较小 |
| **推荐** | **推荐** | 不推荐 |

**推荐方案 A（原地扩展）**，理由：
1. Spectra 现有消费方（MCP 工具、graph-query engine）均通过 TypeScript interface 读取 graph.json；新增可选字段不会破坏编译
2. 单文件维护比双文件更简单；`GraphQueryEngine.loadFromFile` 改动最小
3. `schemaVersion: '1.0'` → `'2.0'` 升级配合检查逻辑即可实现版本感知降级

### schema v2.0 关键类型变更（摘要）

```typescript
// GraphEdge 新增可选字段
interface GraphEdge {
  // ...现有字段保留...
  relation: string;          // 新增允许值：'references' | 'conceptually_related_to' | 'rationale_for'
  confidence: ConfidenceLevel;
  confidenceScore: number;
  evidenceText?: string;     // 新增（最大 200 字符）
  evidenceSource?: string;   // 新增（格式："文件路径:行号"）
}

// GraphJSON 新增顶层字段
interface GraphJSON {
  // ...现有字段保留...
  graph: {
    schemaVersion: '1.0' | '2.0';  // 升级为联合类型
    // ...
  };
  hyperedges?: Hyperedge[];         // 新增（可选保持向后兼容）
}

// 新增 Hyperedge 类型
interface Hyperedge {
  id: string;                       // UUID v4
  label: string;                    // 2-8 个词
  nodes: string[];                  // 节点 ID 列表，≥3
  rationale: string;                // 最大 200 字符
  confidence: ConfidenceLevel;
}
```

### schemaVersion 感知逻辑

- `GraphQueryEngine.loadFromFile` 中添加版本检查：读取 `graph.schemaVersion`，若为 `'1.0'` 则 `hyperedges` 视为空数组，`evidenceText`/`evidenceSource` 视为 undefined。
- 不阻止加载（graceful degradation），仅在 v2.0 字段查询时返回空结果 + 提示信息。

### direction-audit CLI 适配

现有 direction-audit 白名单扩展：新增 `references`、`conceptually_related_to`、`rationale_for` 到允许的 edge relation 类型列表。在 audit 规则中这三种边均为"文档到代码"方向，方向规则：`document → code`（允许）；`code → document`（标记警告）。

---

## 5. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 当前版本 | 许可证 | 引入状态 | 评级 |
|------|------|---------|--------|---------|------|
| `@xenova/transformers` | 本地 embedding 推理（主方案） | 2.17.x（稳定）；注意：已被 `@huggingface/transformers` v3 接管但 v2 仍维护 | Apache-2.0 | 待引入（optional） | 推荐 |
| `@huggingface/transformers` | 下一代 transformers.js（v3） | 3.x（2024 末发布） | Apache-2.0 | 待引入（optional，优选） | 推荐优先于 @xenova |
| `openai` | OpenAI embedding API（fallback） | ^4.x | MIT | 待引入（optional） | 仅 fallback |
| `zod` | Hyperedge 输出 schema 验证 | ^3.24.1 | MIT | **已有** | 直接使用 |
| `@anthropic-ai/sdk` | LLM 调用（Hyperedge 提取） | ^0.39.0 | MIT | **已有** | 直接使用 |
| `graphology` | 图数据结构（现有） | ^0.26.0 | MIT | **已有** | 直接使用 |

**重要说明**：`@xenova/transformers` 已被官方迁移到 `@huggingface/transformers`（v3），v3 API 基本兼容但有 breaking changes。建议直接引入 `@huggingface/transformers@^3`，而非 `@xenova/transformers`，避免未来迁移成本。

### 与现有依赖的兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| `@anthropic-ai/sdk ^0.39.0` | 兼容 | Hyperedge 提取直接复用，无冲突 |
| `zod ^3.24.1` | 兼容 | Hyperedge 输出验证直接复用 |
| `graphology ^0.26.0` | 兼容 | Hyperedge 可作为 graph attribute 存储（graphology 支持 multigraph 和自定义属性） |
| `web-tree-sitter ^0.24.7` | 兼容 | 无依赖冲突 |
| `@huggingface/transformers` (待引入) | 注意：ONNX runtime 体积约 200MB；ESM 模块；需要 Node.js ≥ 18（当前 engines 要求 ≥ 20，满足） | 建议作为 `optionalDependencies` 引入，避免强制所有用户下载 |

**关键建议**：将 `@huggingface/transformers` 列为 `optionalDependencies`，并在 embedding 模块的初始化逻辑中捕获 `MODULE_NOT_FOUND` 异常，自动降级到 OpenAI fallback。这样在 CI 或轻量环境中不强制安装大型依赖。

---

## 6. 设计模式推荐

### 6.1 Strategy Pattern — EmbeddingProvider

```
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly name: string;
}

class LocalEmbeddingProvider implements EmbeddingProvider { ... }   // @huggingface/transformers
class OpenAIEmbeddingProvider implements EmbeddingProvider { ... }  // fallback
class VoyageEmbeddingProvider implements EmbeddingProvider { ... }  // 高级可选
```

工厂函数 `createEmbeddingProvider(config)` 根据环境变量和 optionalDependencies 可用性自动选择实现。

**应用案例**：LangChain.js 的 `Embeddings` 抽象层采用相同模式，支持 OpenAI、Cohere、HuggingFace 等多后端。

### 6.2 Registry Pattern — 边类型注册表

在 `graph-types.ts` 中建立 edge relation 类型注册表（白名单），新增 v2.0 边类型时只需在注册表中添加条目，无需散改多处：

```typescript
export const GRAPH_EDGE_RELATIONS = {
  // v1.0 边类型
  SAME_MODULE: 'same-module',
  CROSS_MODULE: 'cross-module',
  CONTAINS: 'contains',
  // v2.0 新增
  REFERENCES: 'references',
  CONCEPTUALLY_RELATED_TO: 'conceptually_related_to',
  RATIONALE_FOR: 'rationale_for',
} as const;
```

direction-audit CLI 通过读取注册表白名单自动适配，无需手工维护字符串列表。

### 6.3 Pipeline Pattern — Chunked Embedding Batch

```
DocChunker → EmbeddingBatch → SimilarityScorer → EdgeGenerator
```

每个阶段独立可测，中间产物（chunks、embeddings、similarity matrix）可落盘用于调试；与现有 `budget-gate.ts` 的集成点在 `EmbeddingBatch` 阶段（batch token 估算）。

---

## 7. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | `@huggingface/transformers` 在某些 Node.js 环境（ARM Linux、Alpine Docker）中 ONNX runtime 加载失败 | 中 | 高 | 设为 `optionalDependencies`；捕获加载异常自动 fallback 到 OpenAI；CI 测试 mock embedding provider |
| 2 | all-MiniLM-L6-v2 在 code+doc 混合语料下 false positive 过多（相似度 > 0.75 但语义无关） | 中 | 中 | 阈值设为可配置（默认 0.70 更保守）；首批运行后人工采样 20 条边验证质量；提供 `--embedding-threshold` CLI 参数 |
| 3 | LLM 生成 hyperedge 的 JSON 输出不稳定（缺字段、nodes < 3、label 超长） | 高 | 低 | Zod schema 验证 + graceful degradation（验证失败返回空数组）；不抛出异常打断主流程 |
| 4 | schema v2.0 升级后 `schemaVersion: '2.0'` 字符串字面量导致旧消费方 TypeScript 类型报错 | 低 | 中 | 将 `schemaVersion` 类型从 `'1.0'` 字面量类型扩展为 `'1.0' \| '2.0'`；旧消费方重新编译后自然通过 |
| 5 | Hyperedge 提取 LLM 调用成本超出 budget-gate 预设阈值导致 batch 被 cancel | 中 | 中 | Story 3 中明确要求走 F1 budget 基础设施（`runBudgetGate`）；每 batch 最多 10 个 hyperedge 的限制降低 output tokens；skip-enrichment policy 可跳过 hyperedge 提取 |
| 6 | direction-audit CLI 对新边类型（references 等）产生 false-positive 审计警告 | 高 | 低 | 在 direction-audit 白名单中提前注册新边类型；Story 1 中明确要求适配，不遗留 |
| 7 | 首次模型下载（~90MB）在网络受限的 CI 环境超时 | 中 | 中 | 提供 `SPECTRA_EMBEDDING_MODEL_PATH` 环境变量允许指定预下载路径；CI 配置 Docker layer 缓存模型文件 |
| 8 | graph.json 体积膨胀：大型项目加入 evidenceText 和 hyperedges 后文件过大影响 MCP 加载速度 | 低 | 中 | evidenceText 限 200 字符（已有约束）；hyperedges 每 batch 限 10 条；[推断] 100 个模块规模的项目 graph.json 增量约 50-200KB，可接受 |

---

## 8. 需求-技术对齐度评估

### 覆盖评估

| 需求功能 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| Story 1: 新边类型（references/conceptually_related_to/rationale_for） | 完全覆盖 | 在 `GRAPH_EDGE_RELATIONS` 注册表 + `GraphEdge.relation` 类型扩展中实现 |
| Story 1: confidence + evidenceText + evidenceSource 字段 | 完全覆盖 | `GraphEdge` 新增可选字段；confidence 复用现有 `ConfidenceLevel` 枚举 |
| Story 1: hyperedges 顶层数组 | 完全覆盖 | `GraphJSON.hyperedges?: Hyperedge[]` 可选字段 |
| Story 1: direction-audit CLI 适配 | 完全覆盖 | 白名单注册表扩展；schemaVersion 感知逻辑 |
| Story 2: Chunked markdown embedding | 完全覆盖 | Hybrid 分块策略 + EmbeddingProvider abstraction + SimilarityScorer |
| Story 2: 阈值可配置 | 完全覆盖 | `--embedding-threshold` CLI 参数；默认值可调 |
| Story 3: Hyperedge 提取 | 完全覆盖 | Prompt 工程 + Zod schema 验证 + budget-gate 集成 |
| Story 4: graph_hyperedges MCP 工具 | 完全覆盖 | 新增工具 + filter 参数设计 |
| Story 4: graph_node 含关联 hyperedges | 完全覆盖 | NodeResult 扩展 + GraphQueryEngine 新查询方法 |
| Story 4: graph_community 跨社区 hyperedges | 完全覆盖 | crossCommunityHyperedges 字段 |

### 扩展性评估

- **EmbeddingProvider Strategy Pattern** 支持未来接入更多 embedding 后端（如 Ollama 本地模型、Cohere）而无需修改核心逻辑
- **Hyperedge 数据结构**（label + nodes + rationale + confidence）为未来的 hyperedge 可视化、社区分析、diff 展示预留了足够的元数据
- **schemaVersion 机制**为 v3.0 扩展（如函数级锚点的 AST 节点类型）打下基础

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| TypeScript 5.x + Node.js 20.x | 兼容 | `@huggingface/transformers` v3 支持 Node.js ≥ 18；ESM 模块兼容项目 `"type": "module"` |
| 不修改 src/spec-store/（F2 领地） | 兼容 | 所有新代码在 `src/panoramic/anchoring/`、`src/panoramic/hyperedges/` 新目录 |
| 不修改 src/debt-scanner/（F3 领地） | 兼容 | 无交叉 |
| 不修改 plugins/spec-driver/ | 兼容 | 无触碰 |
| 新增依赖须通过 optionalDependencies | 兼容 | `@huggingface/transformers` 设为 optional |

---

## 9. 结论与建议

### 核心技术决策汇总

| 决策点 | 推荐 | Fallback |
|--------|------|---------|
| Embedding 方案 | Local（`@huggingface/transformers` + `all-MiniLM-L6-v2`）作为 `optionalDependencies` | OpenAI `text-embedding-3-small`（环境变量切换） |
| Chunking 策略 | Hybrid（H2/H3 边界 + 段落合并 + 512 tokens 上限） | 纯 Heading-based（退化实现） |
| schema 升级路径 | 原地扩展（v2.0 向后兼容字段） | 不适用 |
| Edge 去重 | Higher-confidence Wins | 不适用 |
| Hyperedge 输出验证 | Zod schema + graceful degradation（验证失败返回空数组） | 不适用 |
| 架构抽象 | Strategy Pattern（EmbeddingProvider）+ Registry Pattern（边类型） | 不适用 |

### 对产研汇总 / plan 阶段的建议

1. **阈值配置化是 P0**：embedding 阈值（初始 0.75，建议调整为 0.70）必须作为 CLI 参数暴露，不应硬编码；这直接影响 references 边的召回率，是用户可感知的质量参数。
2. **`optionalDependencies` 安装体验需要 plan 关注**：`@huggingface/transformers` 体积大，plan 中需要明确"首次使用时的提示信息"（模型下载进度条 / 下载大小 / 缓存路径说明），避免用户困惑。
3. **Hyperedge 提取的 budget 估算需要校准**：Story 3 的 LLM 调用量难以提前估算（取决于项目中 code 节点数量），plan 中应设计"dry-run 模式"（仅估算 hyperedge batch 数量，不实际调用）。
4. **direction-audit 白名单扩展必须在 Story 1 同批交付**：否则 CI 中 direction-audit 会对新边类型产生误报，阻塞后续 PR 合入。

---

*文档版本：v1.0 | 调研者：tech-research 子代理 | 基于 2026-04-19 代码库快照*
