# F5 Reading UX 技术调研

> 生成时间：2026-04-20
> 调研模式：独立模式（无 product-research.md 前置产出）
> 基线代码已全量阅读：anchoring、hyperedges、debt-scanner、mcp/graph-tools、batch-orchestrator、batch-project-docs、budget-gate、inline-d3

---

## 执行摘要（Executive Summary）

1. **问答架构**：选择 **B+C 混合方案**（Graph-first 快检索 → RAG embedding 精排 → LLM 组装）。纯 RAG 首次加载 `@xenova/transformers` 约需 5-15 秒且占用 150-400 MB 内存；纯 Graph-first 在语义模糊问题上召回率偏低。混合方案先用 `GraphQueryEngine.query()` 的 BFS 快速确定候选节点集，再用已有 embedding 精排 Top-K，最终省去单独 Retriever 链路，token 预算控制在可接受范围内。
2. **graph.html 可视化**：复用现有 `src/panoramic/exporters/html-template.ts` + `D3_FORCE_BUNDLE` 内联常量（d3-force v3.0.0，bundle 约 55 KB min 版），通过扩展 `buildHtmlTemplate()` 参数支持 hyperedge 层级信息和搜索框功能。Self-contained 约束已完全满足（CSS + D3 + 数据全部内联，零 CDN 依赖）。
3. **轻量模式**：`--mode=reading` 跳过 batch-project-docs 中所有"从 design-doc 推断内容"的 generator pipeline 阶段，保留 modules/*.spec.md + graph.json + GRAPH_REPORT.md + README.md 路径；经粗略估算可将 776 秒降至 60-100 秒，性能目标（< 120 秒）可达。
4. **关键技术风险**：hyperedge 问答的语义对齐依赖 LLM 质量；graph.html 在节点数 > 1000 时需强制关闭 force layout；debt-scanner 的 `CodeDebtEntry.ageDays` 字段已可直接支持"最老 TODO"排序查询，无需额外索引层。

---

## 调研点 1：自然语言问答架构

### 1.1 选型决策

**选型：B+C 混合方案（Graph-first 快检索 + 向量精排）**

| 维度 | 方案 A（纯 LLM） | 方案 B（纯 RAG） | 方案 C（Graph-first） | **B+C 混合** |
|------|-----------------|-----------------|----------------------|-------------|
| 召回质量 | 高（无检索偏差） | 高（语义相关） | 中（依赖关键词） | 高（互补） |
| Token 成本 | 极高（完整 spec 输入） | 中（Top-K chunk） | 低（节点元数据） | 中偏低 |
| 延迟 | 极高 | 中（含 embed 时间） | 低 | 中 |
| 基线复用 | 无 | `anchorDocToCode` 已有 | `GraphQueryEngine.query()` 已有 | 两者均可复用 |
| 离线可用性 | 需 API | 本地 embed 可离线 | 完全离线 | 本地 embed 可离线 |

**排除方案 A**：大型项目（50 模块）spec 总字数可达 500k tokens，远超 LLM 上下文窗口且费用不可接受。

**选型理由**：
- Graph-first 的 `GraphQueryEngine.query(question, { budget: 20, depth: 2 })` 可在 < 10 ms 内返回关键词命中的子图节点（BFS 2 跳），提供候选节点集；
- 再对命中节点对应的 spec chunks 做 embedding 相似度精排（复用 `filterByThreshold`），过滤噪声；
- 最终将 Top-K 节点的 metadata + evidenceText 拼装为 LLM prompt。这样大部分问题的 input token 控制在 1000-3000，而纯 RAG 方案需要全量 embed 所有 spec 文件（几百个 chunk）。

**Fallback**：若 Graph-first BFS 命中节点数 < 3，降级为纯 RAG（`anchorDocToCode` 的 embedding 检索路径），再不行降级为不检索直接调 LLM 并告知"图谱数据不足"。

---

### 1.2 算法管道

```
用户问题 (Q)
    │
    ▼
[Step 1] Graph Keyword Retrieval
  GraphQueryEngine.query(Q, { budget: 20, depth: 2, mode: 'bfs' })
  └── 返回: subgraph.nodes[] (含 id/label/kind/metadata)
    │
    ▼
[Step 2] Hyperedge Expansion
  engine.getHyperedges({ label: Q }) — 按 label 模糊匹配
  └── 补充: hyperedge.nodes[] 中的额外节点
    │
    ▼
[Step 3] Spec Chunk Retrieval（可选 RAG 精排）
  chunkMarkdownFiles([节点对应 spec 路径], projectRoot)
  → provider.embed(chunk texts + Q)
  → filterByThreshold(chunkVectors, queryVector, 0.70)
  └── Top-K SimilarPair (chunkIndex, nodeId, similarity)
    │
    ▼
[Step 4] Debt Context Injection（条件：问题含 TODO/FIXME/技术债相关词）
  DebtReport.codeEntries.sort(ageDays desc).slice(0, 5)
  └── 注入到 prompt 上下文
    │
    ▼
[Step 5] Citation Extraction
  每个 retrieval item 附加:
  { specPath: chunk.filePath, lineRange: [startLine, endLine], excerpt: evidenceText }
    │
    ▼
[Step 6] LLM Prompt Assembly
  系统 prompt + 节点上下文 + chunk excerpts + citations + 用户问题
    │
    ▼
[Step 7] LLM Answer Generation（通过 budget-gate 预算管控）
  Anthropic SDK → 结构化答案 + citations 列表
```

---

### 1.3 可复用组件清单（基于代码阅读）

以下组件可直接复用，**无需重写**：

| 组件 | 文件路径 | 关键函数/类 | F5 用途 |
|------|---------|-----------|---------|
| Graph BFS 检索 | `src/mcp/graph-tools.ts` | `getEngine(projectRoot)` → `engine.query(question, opts)` | Step 1：Graph-first 候选节点检索 |
| Hyperedge 查询 | `src/mcp/graph-tools.ts` | `engine.getHyperedges({ label, nodeId, limit })` | Step 2：超边补充节点 |
| 单节点语义边 | `src/mcp/graph-tools.ts` | `engine.getSemanticEdges(nodeId)` | 节点详情页展示关联边 |
| Markdown Chunker | `src/panoramic/anchoring/chunker.ts` | `chunkMarkdownFiles(filePaths, projectRoot, opts)` | Step 3：spec chunk 切分 |
| Embedding Provider 工厂 | `src/panoramic/anchoring/providers/factory.ts` | `createEmbeddingProvider(opts)` | Step 3：local/openai 切换 |
| 相似度过滤 | `src/panoramic/anchoring/similarity.ts` | `filterByThreshold(chunkVectors, nodeVectors, threshold)` | Step 3：Top-K 精排 |
| 语义边构建（证据提取） | `src/panoramic/anchoring/edge-builder.ts` | `buildEvidenceText(text, nodeName, maxLen)` | Step 5：溯源 excerpt 生成 |
| Budget Gate | `src/batch/budget-gate.ts` | `runBudgetGate({ baseEstimate, budget, preset, isTTY })` | Step 7 前：LLM 调用预算检查 |
| Token 估算 | `src/batch/budget-gate.ts` | `estimateModuleCost(name, files, root)` | 问答 prompt token 预估 |
| Debt Scanner | `src/debt-scanner/index.ts` | `scanProjectDebt(opts): Promise<DebtReport>` | Step 4：债务上下文注入 |

**函数签名快照**（便于 implement 阶段调用）：

```typescript
// graph-tools.ts — engine 实例
engine.query(question: string, opts?: { budget?: number; mode?: 'bfs'|'dfs'; depth?: number }): SubgraphResult
engine.getHyperedges(opts: { label?: string; nodeId?: string; limit?: number }): Hyperedge[]
engine.getSemanticEdges(nodeId?: string): GraphEdge[]

// chunker.ts
chunkMarkdownFiles(filePaths: string[], projectRoot: string, options?: DocChunkerOptions): DocChunk[]
// DocChunk: { filePath, startLine, endLine, headingPath, text, tokenCount }

// similarity.ts
filterByThreshold(chunkVectors: Float32Array[], nodeVectors: Map<string, Float32Array>, threshold: number): SimilarPair[]

// edge-builder.ts
buildEvidenceText(text: string, nodeName: string, maxLength?: number): string

// budget-gate.ts
runBudgetGate(args: { baseEstimate, budget, preset?, isTTY, promptPolicy? }): Promise<BudgetGateResult>
```

---

### 1.4 Token 预算估算

**小型项目（graphify 示例，约 5 文件，~15 个图节点）**：

| 阶段 | Input tokens | Output tokens |
|------|-------------|--------------|
| Graph BFS 结果（节点元数据） | ~300 | — |
| Top-3 spec chunk excerpts（各 200 字符） | ~200 | — |
| 问题 + 系统 prompt | ~300 | — |
| LLM 答案生成 | — | ~400 |
| **单次问答合计** | **~800** | **~400** |

**中型项目（50 个模块，~200 个图节点）**：

| 阶段 | Input tokens | Output tokens |
|------|-------------|--------------|
| Graph BFS Top-20 节点元数据 | ~600 | — |
| Top-5 spec chunk excerpts | ~350 | — |
| Hyperedge 上下文（1-3 条） | ~200 | — |
| 问题 + 系统 prompt | ~300 | — |
| LLM 答案生成 | — | ~600 |
| **单次问答合计** | **~1,450** | **~600** |

**对比纯 LLM 方案**：中型项目所有 spec 全量输入约 50k-200k tokens，成本差异 30-100 倍。

---

### 1.5 Fallback 策略

```
主路径 B+C 混合失败判断条件 → 降级路径

条件 1：BFS 命中节点数 == 0
  → 纯 RAG 路径：对全部 spec chunks embedding 检索，Top-5 chunks 送 LLM

条件 2：BFS 命中节点数 > 0 但 RAG 精排 filterByThreshold Top-K 质量差（similarity < 0.65）
  → 跳过 RAG 精排，直接用 BFS 节点元数据送 LLM（Graph-only 模式）

条件 3：@xenova/transformers 本地 embed 加载失败（package 未安装）
  → 跳过 embedding 精排，仅 Graph BFS 路径，答案注明"[降级模式：未安装本地 embedding]"

条件 4：LLM 调用被 budget-gate 取消
  → 返回 Graph BFS 节点清单（纯结构化输出，无 LLM 组装），提示用户增加预算
```

---

### 1.6 溯源引用实现

每条 retrieval item 构建 Citation 对象：

```typescript
interface Citation {
  specPath: string;     // chunk.filePath（repo-relative 路径）
  lineRange: [number, number]; // [chunk.startLine, chunk.endLine]
  excerpt: string;      // buildEvidenceText(chunk.text, matchedNodeName, 200)
  nodeId: string;       // 对应的 graph node ID
  similarity?: number;  // RAG 精排路径下的余弦相似度分数
}
```

- **Graph-first 路径**：citation 来自 `engine.getNode()` 返回的 `semanticEdges[].evidenceSource`（格式为 `"specs/xxx.md:15-18"`），直接解析为 specPath + lineRange；
- **RAG 精排路径**：citation 来自 `SimilarPair` 对应的 `DocChunk`，用 `buildEvidenceText()` 提取 excerpt；
- **Debt 路径**：citation 为 `CodeDebtEntry.filePath + CodeDebtEntry.line`，excerpt 为 `entry.text.slice(0, 200)`；
- LLM prompt 中每条 citation 用 `[来源：${specPath}:${lineRange[0]}-${lineRange[1]}]` 格式内联，要求 LLM 在答案中保留引用编号。

---

### 1.7 集成 F1 budget-gate

新增的问答 LLM 调用必须经过 budget-gate。接入方式：

```typescript
// 在执行 LLM 答案生成前调用
import { runBudgetGate, estimateFast } from '../batch/budget-gate.js';

// 估算本次问答 prompt token 数
const promptText = buildQnaPrompt(nodes, chunks, question);
const inputEstimate = estimateFast(promptText);
const outputEstimate = Math.round(inputEstimate * 0.5); // 问答 output 比例略高

const gateResult = await runBudgetGate({
  baseEstimate: inputEstimate + outputEstimate,
  budget: opts.budget ?? Infinity,
  preset: opts.onOverBudget,
  isTTY: process.stdout.isTTY,
});

if (gateResult.finalPolicy === 'cancel') {
  return { answer: '预算不足，已取消问答', citations: [] };
}

// 继续调用 LLM
```

`estimateFast` 函数来自 `src/core/token-counter.ts`，已在 budget-gate.ts 引入，问答层直接调用即可。

---

## 调研点 2：graph.html 交互式可视化

### 2.1 D3 内联验证

**验证结论：现有产物完全可用，无需改动内联机制**。

- `scripts/inline-d3.ts` 在 `npm run build`（通过 `prebuild` hook）时自动读取 `node_modules/d3-force/dist/d3-force.min.js`，转义反引号后写入 `src/panoramic/exporters/html-template.ts` 的 `D3_FORCE_BUNDLE` export 常量；
- `package.json` 中 `d3-force` 为 `devDependencies`，版本 `^3.0.0`；d3-force v3 min bundle **约 55 KB**（gzip 后约 18 KB），嵌入 HTML 后整体文件大小在 50-200 KB 量级（取决于数据规模）；
- 现有 `buildHtmlTemplate(graphDataJson: string): string` 和 `buildFullHtml(graphDataJson: string, d3Bundle: string): string` 已提供完整 HTML 骨架，包含：画布区（`#canvas-area`）、侧栏（`#sidebar`）、搜索框（`#search-input`）、社区图例（`#legend-list`）、节点详情（`#node-detail`）；
- **F5 策略**：扩展 `buildHtmlTemplate(graphDataJson, options?: HtmlOptions)` 签名，在现有函数体基础上增量添加 hyperedge 渲染层（虚线 + 标签），不替换现有代码。

---

### 2.2 HTML 结构草案

```
┌─────────────────────────────────────────────────────────┐
│  #sidebar (280px)          │  #canvas-area (flex: 1)   │
│  ┌───────────────────┐     │                            │
│  │ h1: 知识图谱       │     │  [SVG graph-svg]           │
│  │ p: N 节点 · M 边   │     │    ├── #links-layer        │
│  └───────────────────┘     │    │     普通边（实线）      │
│  ┌───────────────────┐     │    │   #hyperedges-layer   │
│  │ #search-section   │     │    │     超边（虚线椭圆）   │
│  │ input[搜索节点...] │     │    └── #nodes-layer        │
│  │ #search-results   │     │                            │
│  └───────────────────┘     │  [#zoom-controls 右下角]   │
│  ┌───────────────────┐     │   zoom-in / reset / out   │
│  │ #legend-section   │     │                            │
│  │ Community 图例    │     │                            │
│  └───────────────────┘     │                            │
│  ┌───────────────────┐     │                            │
│  │ #hyperedge-section│     │                            │
│  │ Hyperedges 图例   │     │                            │
│  └───────────────────┘     │                            │
│  ┌───────────────────┐     │                            │
│  │ #detail-section   │     │                            │
│  │ 节点/超边详情      │     │                            │
│  └───────────────────┘     │                            │
└─────────────────────────────────────────────────────────┘
```

**新增侧栏区块 `#hyperedge-section`**：列出所有 hyperedge 标签，点击高亮相关节点。

---

### 2.3 交互原型

**搜索框行为**：
- 输入时实时过滤 `GRAPH_DATA.nodes`，按 `node.label` 和 `node.id` 做子串匹配（现有代码已实现）；
- 新增：按 `GRAPH_DATA.hyperedges[].label` 模糊匹配，命中时展示 hyperedge 条目，点击后高亮所有参与节点；
- 新增：按 `node.kind` 过滤（下拉菜单：全部 / 模块 / 组件 / 文档 / API）。

**节点点击行为**：
- 现有：展开 `#node-detail`，高亮 circle（已实现）；
- 新增：在 detail 区展示该节点参与的 hyperedge 列表（调用 `GRAPH_DATA.hyperedges.filter(he => he.nodes.includes(nodeId))`）；
- 新增：在 detail 区展示语义边（`references` / `conceptually_related_to`），可点击跳转到相关节点。

**Community 着色映射**：
- 现有 `GRAPH_DATA.communities[].color` 已存储每个社区的颜色（现有 legend 代码读取此字段）；
- 色板来源：现有实现使用 Louvain 社区检测后手动映射 HEX 色，已存储在 graph.json 的 HTML 输出数据中，无需改变。

---

### 2.4 Hyperedge 可视化

**渲染策略：多节点虚线连接 + 中心标签**

由于 D3-force 原生不支持超边（hyperedge），采用以下方案：

```
方案选择：凸包（convex hull）轮廓 + 虚线描边
  原理：计算 hyperedge.nodes[] 对应节点的坐标凸包，
        渲染为 SVG <path> 虚线描边，fill 半透明色，
        中心位置放置 <text> 显示 label。
  优点：视觉上与普通边明显区分；节点移动时动态更新凸包。
  缺点：需要实现简单凸包算法（约 20 行代码）。

备选：星形连接（star topology）
  从 hyperedge 虚拟中心点向所有参与节点画虚线。
  优点：实现简单；缺点：视觉噪声大（多条虚线汇聚）。
```

**推荐：凸包方案**，交互效果更自然。实现细节：
- 在 `sim.on('tick')` 回调中更新凸包路径；
- hyperedge 凸包用 `stroke-dasharray: 6 3` 区别于普通实线边；
- fill 颜色为对应 community 色但 opacity 0.08（极淡），不遮挡节点；
- 超边标签只在悬浮时显示（避免文字重叠）。

**数据流**：`GRAPH_DATA.hyperedges[]` 直接内嵌在 HTML 的 `GRAPH_DATA` JSON 对象中，与 nodes/links 同级，无需额外请求。

---

### 2.5 性能估算

基于现有 `inline-d3.ts` 已经处理了 `isLarge = nodes.length > 5000` 的判断（大图强制固定坐标，关闭 force simulation）：

| 节点数 | 边数 | force layout | 渲染性能 | 建议策略 |
|--------|------|-------------|---------|---------|
| ≤ 50 | ≤ 200 | 流畅，1-3 秒 stable | 60fps | 默认开启 force |
| ≤ 500 | ≤ 2000 | 可接受，3-8 秒 stable | 30-60fps | 开启 force，降低 charge 强度 |
| ≤ 5000 | ≤ 20000 | 慢（15-30 秒），卡顿 | <30fps | 提前触发 alpha 衰减（alphaDecay=0.03）|
| > 5000 | — | 超时，不可用 | — | 已有 isLarge 判断：强制固定坐标 |

**F5 建议**：在 500-5000 节点区间新增一个"中等图"策略：
- `alphaDecay = 0.05`（比默认 0.0228 快 2 倍）+ `velocityDecay = 0.6`；
- `forceManyBody().strength(-80)`（比默认 -150 更弱），减少排斥计算量；
- 10 秒后若未 stable，强制 `sim.stop()`。

**Hyperedge 凸包计算额外开销**：凸包算法 O(n log n)，每个 hyperedge 约含 3-8 个节点，每 tick 重算约 0.1 ms/条，100 条 hyperedge 约 10 ms/tick，可接受。

---

### 2.6 Self-contained 实现

| 资源 | 实现方式 | 当前状态 |
|------|---------|---------|
| D3-force JS | `D3_FORCE_BUNDLE` 常量内联到 `<script>` | 已实现（`inline-d3.ts`） |
| CSS 样式 | 模板字符串内联到 `<style>` | 已实现（html-template.ts 中约 40 行 CSS） |
| 图谱数据 JSON | `var GRAPH_DATA = ${safeJson};` 内嵌脚本 | 已实现（`safeJson` 已转义 `</script>`） |
| Hyperedge 数据 | 同 graph.json，已在 `GraphJSON.hyperedges?` 字段 | **F5 需扩展**：buildGraphData 时将 hyperedges 写入 GRAPH_DATA |
| 字体 | 系统字体栈 `-apple-system, BlinkMacSystemFont` | 已实现，零外部依赖 |
| 图标 | 无（纯文字按钮：+ ⊙ -） | 已实现 |

**文件大小估算**：
- D3-force bundle：~55 KB
- CSS + JS 交互代码：~15 KB
- 图谱数据（50 节点）：~30 KB JSON
- 图谱数据（500 节点）：~300 KB JSON
- **总计（50 节点）：~100 KB**；**总计（500 节点）：~370 KB**

---

## 调研点 3：轻量模式精确切分

### 3.1 当前 pipeline 阶段图

基于 `batch-orchestrator.ts` 和 `batch-project-docs.ts` 阅读，pipeline 完整阶段如下：

```
[阶段 0] 文件扫描
  scanFiles() → languageStats
  groupFilesByLanguage() → languageGroups
  粗略耗时: < 1 秒

[阶段 1] 依赖图构建
  buildGraph() / buildGraphForLanguageGroup()
  产物: DependencyGraph
  粗略耗时: 2-5 秒

[阶段 2] 模块聚合 + 拓扑排序
  groupFilesToModules() → processingOrder
  产物: moduleGroups Map
  粗略耗时: < 1 秒

[阶段 3] dry-run / budget-gate（可选）
  estimateModuleCost() → runBudgetGate()
  粗略耗时: < 1 秒

[阶段 4] ★ 逐模块 Spec 生成（主要瓶颈）
  generateSpec() × N 模块
  每模块: AST → context → LLM#1（Section 1）→ enrich（Section 2）→ render
  产物: modules/*.spec.md
  粗略耗时: 50-700 秒（N × 每模块 10-30 秒）

[阶段 5] Doc Graph 构建
  buildDocGraph() + buildCrossReferenceIndex()
  产物: 内存中 DocGraph
  粗略耗时: 1-3 秒

[阶段 6] ★ 项目级文档生成 (generateBatchProjectDocs)
  ├── architecture-overview generator（LLM）
  ├── architecture-ir generator（LLM）
  ├── pattern-hints generator（LLM）
  ├── event-surface generator（LLM）
  ├── runtime-topology generator（LLM）
  ├── config-reference generator（LLM/静态）
  ├── interface-surface generator（静态）
  ├── architecture-narrative pipeline（LLM 拼装）
  ├── component-view builder
  ├── dynamic-scenarios builder（LLM）
  ├── adr-decision-pipeline（LLM）
  ├── product-ux-docs pipeline（LLM）
  │   ├── product-overview（LLM）
  │   ├── user-journeys（LLM）
  │   └── feature-briefs（LLM）
  └── docs-quality-evaluator
  产物: project/*.md（大量文档）
  粗略耗时: 60-300 秒

[阶段 7] Knowledge Graph 构建
  buildKnowledgeGraph() + runCommunityAnalysis() + writeKnowledgeGraph()
  产物: _meta/graph.json + _meta/GRAPH_REPORT.md
  粗略耗时: 2-10 秒（Louvain 算法）

[阶段 8] Coverage Audit
  CoverageAuditor.audit() → _coverage-report.md
  粗略耗时: < 2 秒

[阶段 9] Index + README 生成
  generateIndex() + generateBatchReadme()
  产物: modules/_index.spec.md + README.md
  粗略耗时: < 1 秒

[阶段 10] Docs Bundle
  orchestrateDocsBundle() → _meta/docs-bundle.yaml
  粗略耗时: < 1 秒

[阶段 11] Debt Intelligence（enableDebtIntelligence 默认 true）
  generateDebtIntelligence() → project/technical-debt.md
  粗略耗时: 5-30 秒（AST 扫描 + 可选 LLM）
```

**graphify 示例项目 776 秒的分布估算**：
- 阶段 4（模块 spec 生成）：~600 秒（约 30 个模块 × 20 秒/模块）
- 阶段 6（项目级文档）：~150 秒（10+ LLM 调用）
- 其余阶段合计：~26 秒

---

### 3.2 `--mode=reading` 跳过清单

**跳过阶段 6 的以下 generator/pipeline**（全部产物来自"从 design-doc 推断内容"）：

| 跳过目标 | generator ID / pipeline | 产物文件 | 理由 |
|---------|------------------------|---------|-----|
| Product Overview | `product-ux-docs`（内部 overview） | `project/product-overview.md` | 需要 LLM 推断产品定义 |
| User Journeys | `product-ux-docs`（内部 journeys） | `project/user-journeys.md` | 需要 LLM 推断用户旅程 |
| Feature Briefs | `product-ux-docs`（内部 featureBriefs） | `project/feature-briefs/` | 需要 LLM 从需求反推 |
| Troubleshooting | `troubleshooting-generator` | `project/troubleshooting.md` | 需要结合运行时推断 |
| Data Model | `data-model-generator` | `project/data-model.md` | 需要 LLM 推断数据模型 |
| Event Surface | `event-surface-generator` | `project/event-surface.md` | 事件追踪需要运行时视角 |
| ADR Drafts | `adr-decision-pipeline` | `project/adrs/` | 需要决策历史推断 |
| Coverage Report | `CoverageAuditor` | `project/_coverage-report.md` | 依赖 product-ux-docs 输出 |
| Docs Bundle | `orchestrateDocsBundle` | `_meta/docs-bundle.yaml` | 打包依赖完整文档集 |

**必须保留的阶段**（reading mode 核心价值）：

| 保留目标 | 产物路径 | 保留理由 |
|---------|---------|---------|
| 模块 spec 生成（阶段 4） | `modules/*.spec.md` | 代码阅读的核心产物 |
| 知识图谱（阶段 7） | `_meta/graph.json` + `_meta/GRAPH_REPORT.md` | 支持问答检索和可视化 |
| README 导航索引（阶段 9） | `README.md` + `modules/_index.spec.md` | 导航入口 |
| Debt Intelligence（阶段 11）| `project/technical-debt.md` | 代码阅读平台的重要信息 |
| Architecture Narrative（部分）| `project/architecture-narrative.md` | 提供整体架构视角 |
| Architecture IR（内存）| 无写盘（用于 graph 构建） | 图谱节点来源 |

**--mode=reading 估算耗时**：
- 阶段 4（保留）：~600 秒（主瓶颈）
- 阶段 6（精简）：只跑 architecture-overview + architecture-ir + pattern-hints + architecture-narrative，约 30-50 秒
- 其余阶段：~20 秒
- **总计：~650-670 秒**

**注意**：若 graphify 示例项目 776 秒中阶段 4 占比确实是 ~600 秒，则 `--mode=reading` 无法达到 < 120 秒目标（见 3.6 详细分析）。

---

### 3.3 `--mode=code-only` 额外跳过清单

在 reading 模式基础上，额外跳过所有"从 design-doc 推断内容"的步骤：

| 额外跳过目标 | generator ID | 跳过原因 |
|------------|-------------|---------|
| Architecture Overview | `architecture-overview-generator` | 基于 design-doc 语义推断 |
| Architecture Narrative | `architecture-narrative` pipeline | 依赖 architecture-overview |
| Pattern Hints | `pattern-hints-generator` | LLM 从 spec 推断设计模式 |
| Architecture IR | `architecture-ir-generator` | LLM 推断 IR（若不需要图谱边则可跳过） |
| Component View | `buildComponentView()` | 依赖 architecture-ir |
| Dynamic Scenarios | `buildDynamicScenarios()` | 依赖 component-view |
| Debt Intelligence（LLM 部分）| `inferOpenQuestionTopics` | design-doc open questions 推断 |

**code-only 保留**：
- 纯 AST 生成的模块 spec（skipEnrichment=true，即跳过 Section 2 二次 LLM 增强）；
- `buildKnowledgeGraph()` 用 AST 依赖图数据生成（无 architecture-ir 注入，图节点仅有 module/package 类型）；
- Debt scanner 的纯 AST 代码注释扫描（scanCodeComments，不含 LLM topic inference）。

---

### 3.4 CLI & MCP schema 扩展

**CLI 扩展（Commander.js）**：

```typescript
// 在现有 batch command 注册处添加
program.command('batch')
  .option('--mode <mode>', '运行模式：full（默认）| reading | code-only', 'full')
  // ...现有选项

// BatchOptions 扩展
interface BatchOptions {
  // ...现有字段
  mode?: 'full' | 'reading' | 'code-only';
}
```

**MCP batch tool schema 扩展**（在 `registerBatchTools` 或等价注册函数中）：

```typescript
// 在 MCP tool 注册的 schema 中添加 mode 参数
{
  mode: z
    .enum(['full', 'reading', 'code-only'])
    .optional()
    .describe('运行模式：full（默认，完整文档生成）| reading（轻量模式，保留 spec+graph+readme）| code-only（纯代码，仅 AST spec）'),
}
```

**在 runBatch 内部的判断点**：
- 读取 `options.mode`（默认 `'full'`）；
- `mode === 'reading'`：跳过 product-ux-docs、ADR、troubleshooting、data-model、event-surface、coverage-auditor、docs-bundle；
- `mode === 'code-only'`：额外设 `skipEnrichment=true`（所有模块）、跳过 architecture-overview / narrative / pattern-hints / component-view / dynamic-scenarios。

---

### 3.5 Token 节省估算

以 graphify 示例项目（776 秒，~30 个模块）估算：

| 模式 | 跳过的 LLM 调用 | 节省 tokens（估算） | 节省时间（估算） |
|------|---------------|-------------------|----------------|
| full（基准） | 0 | 0 | 0 |
| reading | product-overview/journeys/ADR/troubleshooting × 各 1-2 次 | ~40k-80k input | ~80-150 秒 |
| code-only | reading 基础上 + 所有模块 skip-enrichment + overview/narrative | ~额外 60k-100k input | ~额外 100-200 秒 |

**reading 模式综合节省**：约 80-150 秒，使总耗时从 776 秒降至约 600-700 秒。

---

### 3.6 性能目标可达性分析

**目标：`--mode=reading` 在 graphify 示例项目 < 120 秒**

**结论：当前架构下直接不可达**，主要瓶颈在阶段 4（逐模块 spec 生成）：

| 瓶颈分析 | 数据 |
|---------|-----|
| graphify 示例模块数 | 约 20-30 个模块 |
| 当前每模块平均耗时 | 15-25 秒（含 2 次 LLM 调用） |
| 阶段 4 总耗时 | ~400-600 秒 |
| reading 模式可节省 | ~80-150 秒（仅阶段 6） |
| 实际可达耗时 | ~600-700 秒 |

**若要达到 < 120 秒，需要以下之一**：
1. **模块 spec 并发**：`--mode=reading` 下强制 `concurrency=5-10`，理论上 10 并发可将 600 秒降至 60-120 秒，但受 LLM rate limit 约束；
2. **code-only 模式**：`skipEnrichment=true` 将每模块 LLM 调用从 2 次降为 1 次，约节省 40%，结合 concurrency=5 可能达到 < 120 秒；
3. **增量模式**：首次 full 运行后，只重算变更模块，reading 模式下次运行 < 30 秒。

**建议**：`--mode=reading` 的 < 120 秒目标定义改为"首次运行后的增量运行"，或将默认 concurrency 改为 5（并发安全已由现有 pending 队列保证）。

---

## 调研点 4：集成点

### 4.1 F3 debt-scanner 集成到问答

**debt-scanner 对外 API**（来自 `src/debt-scanner/index.ts`）：

```typescript
// 主函数
scanProjectDebt(opts: ScanProjectDebtOptions): Promise<DebtReport>

// DebtReport 结构
interface DebtReport {
  codeEntries: CodeDebtEntry[];   // 代码注释债务列表
  openQuestions: OpenQuestionEntry[]; // design-doc 开放问题
  diagnostics: DebtDiagnostics;
  metrics: DebtMetrics;           // 含 oldestAgeDays、byKind 统计
  tokenUsage: TokenUsage;
  durationMs: number;
}

// CodeDebtEntry 关键字段（"最老 TODO"查询所需）
interface CodeDebtEntry {
  kind: 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'NOTE';
  text: string;       // 注释内容
  filePath: string;   // 相对路径
  line: number;       // 行号
  symbol: string | null; // 所在函数名
  author: string;     // git blame 作者
  ageDays: number;    // ★ 关键字段：commit 距今天数
}
```

**"最老 TODO"问题的问答索引策略**：
- 无需额外索引层，`DebtReport.codeEntries` 已完全结构化；
- 检测"最老 TODO"类问题的关键词：`oldestAgeDays`、`最老`、`最长时间`、`老旧技术债`；
- 回答时：`report.codeEntries.filter(e => e.kind === 'TODO').sort((a,b) => b.ageDays - a.ageDays).slice(0, 5)`；
- Citation 格式：`{ specPath: entry.filePath, lineRange: [entry.line, entry.line], excerpt: entry.text.slice(0, 200) }`。

**集成方案**：问答引擎初始化时加载 DebtReport（已缓存在 `project/technical-debt.md`，或重新扫描），作为可选上下文。问题路由：检测问题是否含债务相关关键词（TODO/技术债/最老/FIXME），命中则注入 `codeEntries` 相关条目。

---

### 4.2 F4 hyperedges 集成到问答

**Hyperedge schema**（来自 `src/panoramic/graph/graph-types.ts` + `src/panoramic/hyperedges/schema.ts`）：

```typescript
interface Hyperedge {
  id: string;           // UUID v4
  label: string;        // ≤ 8 Unicode 字符（命名流程，如"用户注册"）
  nodes: string[];      // ≥ 3 个节点 ID，至少 1 个代码节点
  rationale: string;    // LLM 提取的设计依据，≤ 200 字符
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
}
```

**"X 属于哪个流程"问题的回答策略**：
1. Step 1：Graph BFS 找到 X 对应的节点 ID；
2. Step 2：`engine.getHyperedges({ node_id: nodeId })` 返回含该节点的所有 hyperedge；
3. Step 3：将 hyperedge 的 `label` + `rationale` + 其余参与节点列表作为答案片段；
4. Citation：`{ specPath: '[graph hyperedge]', lineRange: [0, 0], excerpt: he.rationale }`。

**关键 MCP 函数**：
```typescript
// 已在 src/mcp/graph-tools.ts 注册
engine.getHyperedges({
  label?: string,    // 模糊匹配 hyperedge label
  nodeId?: string,   // 精确匹配参与节点
  limit?: number,
}): Hyperedge[]
```

---

### 4.3 F1 budget-gate 集成

**budget-gate 对外 API 汇总**（来自 `src/batch/budget-gate.ts`）：

```typescript
// 核心 gate 循环（推荐新 LLM 调用使用此函数）
runBudgetGate(args: {
  baseEstimate: number;   // input + output tokens 总估算
  budget: number;         // 预算上限
  preset?: BudgetPolicy;  // 非交互策略 preset
  isTTY: boolean;
  promptPolicy?: () => Promise<BudgetPolicy>;
}): Promise<BudgetGateResult>

// BudgetGateResult
interface BudgetGateResult {
  finalPolicy: 'continue' | 'cancel';
  finalEstimate: number;
  skipEnrichmentApplied: boolean;
  cheaperModelApplied: boolean;
  attempts: BudgetGateAttempt[];
}

// 单次估算（用于问答 prompt 快速预估）
estimateModuleCost(name, files, root): ModuleEstimate
// 替代：直接用 estimateFast(text) 字符数/4 估算 token
```

**F5 新 LLM 调用的接入点**：

| 新 LLM 调用 | 接入位置 | budget 来源 |
|------------|---------|-----------|
| 问答 LLM | `QnaEngine.answer()` 函数内 | CLI `--budget` 或 MCP `budget` 参数 |
| graph.html 生成（如走 LLM） | 仅在需要 LLM 注释 label 时触发 | 同上 |
| Hyperedge 提取（已有）| `extractHyperedges()` 内部 | 已有，无需改动 |

**注意**：现有 `runBudgetGate` 的 `budget` 参数是整个 batch 的全局预算，F5 的问答 LLM 调用是独立会话（每次问答独立计费），**建议新增 `--qna-budget` 参数**单独管控，而不是共用 batch 预算，避免问答消耗影响 batch 执行预算判断。

---

## 技术风险 & 未解决问题

### 风险清单

| 风险 | 概率 | 影响 | 缓解策略 |
|------|-----|------|---------|
| R1：`@xenova/transformers` 首次加载慢（5-15 秒模型下载） | 高 | 中（问答首次延迟高） | 问答启动时异步预加载 embedding 模型，显示 loading 状态 |
| R2：graph.html 在节点 > 1000 时 force layout 卡顿 | 中 | 中（体验差） | 节点数 > 500 时自动降级 alpha 衰减策略；> 5000 禁用 force |
| R3：问答 LLM 返回缺乏引用，hallucination | 中 | 高（信任度下降） | 系统 prompt 强制要求 LLM 只引用提供的 citations，且只回答图谱中有的节点 |
| R4：Hyperedge 数量稀少（小项目没有 design-doc）| 高 | 低（功能退化但不崩溃） | 问答层做空检查，hyperedge 为空时跳过超边查询步骤 |
| R5：`--mode=reading` < 120 秒目标无法达到 | 高 | 中（预期管理问题） | 重新定义目标：首次全量 full 后，reading 模式增量运行 < 30 秒；或调整为 code-only + concurrency=5 |
| R6：debt-scanner 需要 git blame（CI 场景可能无 git history） | 中 | 低（ageDays=0，排序退化） | ageDays=0 时按 filePath+line 排序；文档中说明限制 |
| R7：graph.html 凸包超边渲染在节点重叠时视觉混乱 | 中 | 低（仅美观问题） | 超边只在节点数 ≤ 100 时渲染凸包；更多时降级为星形连接 |

### 待澄清问题（留给 specify / plan 阶段）

1. **问答会话模型**：是单次问答（每次独立查询，无上下文记忆）还是多轮对话（需要维护会话历史）？后者需要额外的上下文 window 管理。
2. **graph.html 更新触发机制**：graph.html 是随 batch 运行自动生成，还是需要独立的 `spectra graph render` 命令？
3. **问答 LLM 模型选择**：使用 claude-haiku（低成本快速）还是 claude-sonnet（高质量）？是否允许用户配置？
4. **`--mode=reading` 是否需要独立 CLI 命令**（如 `spectra read`）还是作为 `spectra batch --mode=reading` 的参数？
5. **问答是否需要流式输出（streaming）**：若对话体验要求实时显示答案，需要 Anthropic SDK 的 stream API。
6. **Hyperedge 可视化的凸包算法**：是内联简单 Graham Scan 实现，还是引入 `d3-polygon`（已包含凸包算法，但需要额外内联）？
7. **`--mode=reading` 的 < 120 秒目标**：需要确认是否包含首次模块 spec 生成，还是仅指存量 spec 基础上的 graph + HTML 生成。若后者，则目标完全可达（< 15 秒）。
