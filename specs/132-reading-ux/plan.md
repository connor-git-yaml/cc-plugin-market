---
feature: F5 Reading UX
branch: 132-reading-ux
phase: plan
created: 2026-04-20
spec: specs/132-reading-ux/spec.md
---

# F5 Reading UX 技术规划

## 1. 概览

F5 通过三条并行 Story 将 Spectra 升级为"可交互、可问答、可轻量运行"的代码阅读平台。技术上，本 feature **零新依赖**，完全复用以下已有基线：`GraphQueryEngine`（BFS 检索）、`chunkMarkdownFiles`（chunk 切分）、`filterByThreshold`（embedding 精排）、`buildEvidenceText`（溯源 excerpt）、`runBudgetGate`（预算守护）、`scanProjectDebt`（债务扫描）、`engine.getHyperedges`（超边查询）、`D3_FORCE_BUNDLE` + `buildHtmlTemplate`（graph.html 底座）。

核心架构选择（synthesis §1 已锁定）：问答采用 **B+C 混合方案**（Graph-first BFS → embedding 精排 Top-K → LLM 组装），graph.html 复用现有 D3_FORCE_BUNDLE 内联机制，轻量模式在 `batch-orchestrator.ts` 的 `runBatch()` 入口通过 `options.mode` 分派，不动核心流程。

---

## 2. 模块边界

### 新增模块

| 路径 | 新增/修改 | 职责 | 对外接口 |
|------|----------|------|---------|
| `src/panoramic/qa/types.ts` | 新增 | F5 所有核心类型定义 | `QnAQuery`、`QnAAnswer`、`Citation`、`GraphContext`、`QnAOptions`、`QnABudgetConfig` |
| `src/panoramic/qa/graph-retriever.ts` | 新增 | Step 1-2：BFS 候选检索 + hyperedge 扩展 | `retrieveGraphContext(query, engine, options): GraphContext` |
| `src/panoramic/qa/rag-reranker.ts` | 新增 | Step 3：chunk 切分 + embedding 精排 | `rerankWithEmbedding(ctx, specPaths, projectRoot, options): RerankResult` |
| `src/panoramic/qa/debt-context.ts` | 新增 | Step 4：债务上下文注入 | `injectDebtContext(query, projectRoot, registry): DebtContextResult` |
| `src/panoramic/qa/citation.ts` | 新增 | Step 5：Citation 对象构建 + lineRange 验证 | `buildCitations(rerankResult, graphCtx): Citation[]` |
| `src/panoramic/qa/prompt-builder.ts` | 新增 | Step 6：LLM prompt 组装 | `buildQnAPrompt(ctx, citations, query, options): string` |
| `src/panoramic/qa/llm-caller.ts` | 新增 | Step 7：budget-gate 注入 + Anthropic SDK 调用 | `callQnALlm(prompt, options): QnALlmResult` |
| `src/panoramic/qa/index.ts` | 新增 | 公开 API 汇聚点 | `answerQuestion(query: QnAQuery, options: QnAOptions): Promise<QnAAnswer>` |

### 修改模块

| 路径 | 修改范围 |
|------|---------|
| `src/batch/batch-orchestrator.ts` | `BatchOptions` 新增 `mode?: BatchMode`；`runBatch()` 入口处读取 `mode` 并向下传递至 `generateBatchProjectDocs()` 和 `generateDebtIntelligence()`；单次判断约 30 行 |
| `src/mcp/server.ts` | `batch` tool schema 新增 `mode` enum 参数；`panoramic-query` tool 新增 `natural-language` operation；注册新增问答 tool（`graph_qna`）|
| `src/panoramic/exporters/html-template.ts` | `buildHtmlTemplate()` 签名扩展 `options?: GraphHtmlOptions`；新增 hyperedge 渲染层（凸包 SVG path）、大图模式横幅、点击跳转 handler、力导向阈值检查（约 +150 行 JS，+30 行 CSS）|
| `src/panoramic/batch-project-docs.ts` | `generateBatchProjectDocs()` 接收 `mode` 参数；在 for 循环中按 mode 跳过特定 generator |
| `src/panoramic/query.ts` | `queryPanoramic()` 的 operation 枚举扩展 `natural-language`；路由到 `answerQuestion()` |
| `src/cli/` | batch 子命令新增 `--mode=` flag（Commander.js `option()`），graph 子命令新增 `--html` flag |
| `plugins/*/SKILL.md` | 更新 MCP 工具说明，记录新增 operation 和 schema |

### 读写边界合规性说明

- `src/panoramic/anchoring/**`、`src/spec-store/**`、`src/debt-scanner/**`、`src/panoramic/hyperedges/**` 仅作只读 API 调用，不修改任何文件。
- `src/panoramic/qa/**` 为全新创建，无历史包袱。
- `src/batch/batch-orchestrator.ts` 修改严格限于 `BatchOptions` 类型扩展 + `runBatch()` 入口前置的 mode 分派逻辑，不改动任何模块处理循环、检查点、并发控制等核心路径。

---

## 3. 接口契约（TypeScript 类型）

以下为 F5 新增的全部关键类型定义（仅类型，不含实现）：

```typescript
// --- src/panoramic/qa/types.ts ---

/** 批处理运行模式 */
export type BatchMode = 'full' | 'reading' | 'code-only';

/** 用户提交的自然语言问题（单轮无状态） */
export interface QnAQuery {
  /** 问题文本（不允许空字符串，> 2000 字符时截断） */
  text: string;
  /** 可选：提示查询聚焦的模块名或节点 ID */
  focusNodeId?: string;
}

/** 溯源引用单元 */
export interface Citation {
  /** repo-relative spec 文件路径 */
  specPath: string;
  /** 行区间（1-based，含边界） */
  lineRange: { startLine: number; endLine: number };
  /** 原文摘要（buildEvidenceText 截断到 200 字符） */
  excerpt: string;
  /** 对应 graph 节点 ID（可选，hyperedge citation 可能无对应节点） */
  nodeId?: string;
  /** 余弦相似度得分（RAG 精排路径下填充） */
  similarity?: number;
}

/** 问答 B+C 混合架构中间态 */
export interface GraphContext {
  /** BFS 命中的候选节点列表 */
  bfsNodes: Array<{ id: string; label: string; kind: string; specPath?: string }>;
  /** embedding 精排后的 Top-K chunk 列表 */
  topChunks: Array<{ chunk: import('../anchoring/chunker.js').DocChunk; similarity: number }>;
  /** F4 hyperedge 关联信息 */
  hyperedges: Array<import('../graph/graph-types.js').Hyperedge>;
  /** BFS 降级模式标识 */
  fallbackMode?: 'rag-only' | 'bfs-only' | 'graph-insufficient';
}

/** 问答预算配置（Q2 已锁定：record-only，不阻断） */
export interface QnABudgetConfig {
  /** hardcode 单次上限：约 $0.05/query（估算 5k input + 1k output tokens） */
  readonly hardcodeLimitUsd: 0.05;
  /** 超额时行为：仅记账不阻断 */
  readonly onOverLimit: 'record-only';
}

/** 问答选项 */
export interface QnAOptions {
  /** 项目根目录 */
  projectRoot: string;
  /** 图谱数据路径（默认从 projectRoot 推断） */
  graphJsonPath?: string;
  /** BFS 节点预算（默认 20） */
  bfsBudget?: number;
  /** BFS 遍历深度（默认 2） */
  bfsDepth?: number;
  /** embedding 精排相似度阈值（默认 0.70） */
  similarityThreshold?: number;
  /** budget 配置（使用 QnABudgetConfig 默认值） */
  budgetConfig?: Partial<QnABudgetConfig>;
}

/** 问答结果 */
export interface QnAAnswer {
  /** 回答文本 */
  text: string;
  /** 溯源引用列表（100% 覆盖率要求） */
  citations: Citation[];
  /** LLM token 使用记录 */
  tokenUsage: {
    input: number;
    output: number;
    /** Q2 锁定：超额时标记为 true，不阻断调用 */
    overBudget: boolean;
  };
  /** 处理耗时（ms） */
  durationMs: number;
  /** 降级模式（如有） */
  fallbackMode?: GraphContext['fallbackMode'];
}

/** graph.html 生成配置 */
export interface GraphHtmlOptions {
  /** force layout 启停阈值（Q3 锁定：< 2000 启用，≥ 2000 切静态） */
  readonly forceLayoutThreshold: 2000;
  /** 是否渲染 hyperedge 凸包层（默认 true） */
  showHyperedges?: boolean;
  /** 是否启用搜索框（默认已有，此项控制 hyperedge 搜索扩展） */
  enableSearch?: boolean;
  /** 是否启用节点点击跳转 spec 文件（默认 true） */
  enableJumpToSpec?: boolean;
  /** 文件体积警告阈值（字节，默认 5 MB = 5 * 1024 * 1024） */
  fileSizeWarnThreshold?: number;
}
```

### MCP schema 扩展

```typescript
// batch tool 新增 mode 参数
{
  mode: z
    .enum(['full', 'reading', 'code-only'])
    .optional()
    .describe('运行模式：full（默认，完整文档）| reading（轻量，跳过产品文档层）| code-only（纯 AST，跳过所有 LLM 推断）'),
}

// panoramic-query tool 扩展 operation
{
  operation: z
    .enum(['cross-package', 'architecture-ir', 'overview', 'natural-language'])
    .describe('分析操作类型；natural-language 触发自然语言问答'),
  question: z
    .string()
    .optional()
    .describe('问题文本（operation=natural-language 时必填）'),
  projectRoot: z.string().describe('项目根目录绝对路径（必需）'),
}
```

---

## 4. 问答 pipeline 实现结构

基于 synthesis §1.2 算法管道，`src/panoramic/qa/` 内部文件结构及每文件职责：

```
src/panoramic/qa/
├── index.ts           — 公开 API：answerQuestion(query, options): Promise<QnAAnswer>
│                        入参校验（空字符串拒绝、> 2000 字符截断）；串联 Step 1-7；
│                        空图谱检查（nodes.length === 0 时返回"图谱为空"提示）
│
├── graph-retriever.ts — Step 1-2: BFS + hyperedge 扩展
│                        getEngine(projectRoot) → engine.query(text, { budget, depth, mode:'bfs' })
│                        engine.getHyperedges({ label: text.slice(0,20) }) 补充节点
│                        命中 < 3 节点时设置 fallbackMode = 'rag-only'
│
├── rag-reranker.ts    — Step 3: chunk 切分 + embedding 精排
│                        chunkMarkdownFiles([specPaths], projectRoot)
│                        createEmbeddingProvider() + provider.embed(texts)
│                        filterByThreshold(chunkVectors, queryVector, threshold)
│                        embedding 加载失败时降级为 'bfs-only' 模式（R2 缓解）
│
├── debt-context.ts    — Step 4: debt-scanner 集成
│                        检测问题是否含债务关键词（TODO/技术债/最老/FIXME）
│                        调用 scanProjectDebt()（每次问答调用，不缓存——见§7 集成点说明）
│                        返回 top-5 codeEntries 按 ageDays 倒序
│
├── citation.ts        — Step 5: Citation 构建 + lineRange 验证
│                        Graph-first 路径：解析 evidenceSource "specs/xxx.md:15-18"
│                        RAG 精排路径：DocChunk → buildEvidenceText(chunk.text, nodeName, 200)
│                        Debt 路径：{ specPath: entry.filePath, lineRange: { startLine: entry.line, endLine: entry.line }, excerpt: entry.text.slice(0,200) }
│                        Hyperedge 路径：{ specPath: '[graph hyperedge]', lineRange: { startLine: 0, endLine: 0 }, excerpt: he.rationale }
│                        lineRange 越界检查：超出文件实际行数时记录 warn 并跳过该 citation
│
├── prompt-builder.ts  — Step 6: LLM prompt 组装
│                        系统 prompt（要求 LLM 100% 引用 citation，不自由发挥）
│                        节点元数据 + chunk excerpts + hyperedge 候选列表（R3 缓解）
│                        citation 内联格式 [来源：path:startLine-endLine]
│
├── llm-caller.ts      — Step 7: budget-gate + Anthropic SDK 调用
│                        estimateFast(promptText) 预估 token
│                        runBudgetGate({ baseEstimate, budget: Infinity, preset: 'continue', isTTY: false })
│                        — 使用 record-only 语义：budget 设 Infinity 不触发阻断
│                        — 超额时在返回结果中标记 tokenUsage.overBudget = true
│                        — 日志输出 "[warn] qna token cost over hardcode limit, recorded only"
│                        Anthropic SDK messages.create()（模型 ID 从项目配置读取）
│
└── types.ts           — 所有 F5 核心类型（见§3 接口契约）
```

**调整说明**：`debt-context.ts` 单独成文件（而非并入 `graph-retriever.ts`），是因为债务查询有独立的关键词路由逻辑，职责清晰后测试也更容易独立模拟。`llm-caller.ts` 单独成文件，将 budget 合规逻辑与 Anthropic SDK 调用解耦，便于单测时 mock SDK。

---

## 5. 轻量模式切分清单

### Codebase Reality Check

基于实际代码阅读（`batch-orchestrator.ts` + `batch-project-docs.ts` + `generator-registry.ts`），确认 generator 完整列表如下：

**`generateBatchProjectDocs()` 中激活的生成器**（来自 `bootstrapGenerators()` + 批处理流水线）：

| 生成器 ID | full | reading | code-only | 备注 |
|----------|------|---------|-----------|------|
| `architecture-overview` | ✅ | ✅ | ❌ 跳过 | LLM 从 spec 推断架构概览；code-only 去掉 LLM 推断 |
| `architecture-ir` | ✅ | ✅ | ❌ 跳过 | LLM 推断 IR；code-only 保留 AST 图但跳过 IR 注入 |
| `pattern-hints` | ✅ | ✅ | ❌ 跳过 | LLM 推断设计模式 |
| `event-surface` | ✅ | ✅ | ❌ 跳过 | 事件追踪需要运行时视角（LLM） |
| `runtime-topology` | ✅ | ✅ | ❌ 跳过 | LLM 推断运行时拓扑 |
| `config-reference` | ✅ | ✅ | ✅ 保留 | 静态 + LLM 混合，config 文件扫描为主，code-only 保留 |
| `interface-surface` | ✅ | ✅ | ✅ 保留 | 纯静态（AST 接口提取），无 LLM |
| `architecture-narrative` | ✅ | ✅ | ❌ 跳过 | 依赖 architecture-overview；code-only 跳过 |
| `component-view` | ✅ | ✅ | ❌ 跳过 | 依赖 architecture-ir |
| `dynamic-scenarios` | ✅ | ✅ | ❌ 跳过 | 依赖 component-view |
| `adr-pipeline` | ✅ | ❌ 跳过 | ❌ 跳过 | 设计决策推断，纯产品文档层 |
| `product-ux-docs` | ✅ | ❌ 跳过 | ❌ 跳过 | 产品文档层（overview/journeys/featureBriefs） |
| `troubleshooting` | ✅ | ❌ 跳过 | ❌ 跳过 | 运行时推断，产品文档层 |
| `data-model` | ✅ | ❌ 跳过 | ❌ 跳过 | LLM 推断数据模型，产品文档层 |
| `workspace-index` | ✅ | ✅ | ✅ 保留 | 静态，Monorepo 索引 |
| `cross-package-analyzer` | ✅ | ✅ | ✅ 保留 | 静态跨包依赖分析 |
| `api-surface` | ✅ | ✅ | ✅ 保留 | 静态 API 扫描 |
| `docs-quality-evaluator` | ✅ | ❌ 跳过 | ❌ 跳过 | 依赖完整产品文档集才有意义 |

**batch-orchestrator.ts 层面的阶段分派**（阶段 4-11）：

| 阶段 | full | reading | code-only | 备注 |
|------|------|---------|-----------|------|
| 阶段 4 模块 spec（`generateSpec`） | ✅ full | ✅ full | `skipEnrichment=true`（跳过 Section 2 LLM） | code-only 每模块 LLM 从 2 次降为 1 次 |
| 阶段 6 `generateBatchProjectDocs` | ✅ all | ✅ 过滤（仅架构层） | ✅ 过滤（仅静态） | mode 向下传递 |
| 阶段 7 知识图谱 | ✅ | ✅ | ✅ | 必须保留（问答基础） |
| 阶段 8 Coverage Audit | ✅ | ❌ | ❌ | 依赖产品文档集 |
| 阶段 9 Index + README | ✅ | ✅ | ✅ | 导航入口，必须保留 |
| 阶段 10 Docs Bundle | ✅ | ❌ | ❌ | 依赖完整文档集 |
| 阶段 11 Debt Intelligence | ✅ | ✅ | 纯 AST 模式（不含 LLM 主题推断） | debt 基础能力必须保留 |

### dispatcher 位置

**精确位置**：`src/batch/batch-orchestrator.ts` 的 `runBatch()` 函数，具体有三个注入点：

1. **模块 spec 生成降级**（约第 617 行 `genOptions` 构建处）：
   ```typescript
   skipEnrichment: isSmallModule || budgetSkipEnrichmentAll || options.mode === 'code-only',
   ```

2. **`generateBatchProjectDocs` 调用处**（约第 869 行）：
   ```typescript
   projectDocsResult = await generateBatchProjectDocs({
     projectRoot: resolvedRoot,
     outputDir: projectDir,
     specsRootDir: resolvedOutputDir,
     mode: options.mode ?? 'full',  // 新增透传
   });
   ```

3. **Coverage Audit / Docs Bundle 跳过判断**（约第 934 行后，两处各加一行）：
   ```typescript
   if ((options.mode ?? 'full') === 'full') { /* coverage audit */ }
   // ...
   if ((options.mode ?? 'full') === 'full') { /* docs bundle */ }
   ```

**`generateBatchProjectDocs` 内部过滤**：在 `src/panoramic/batch-project-docs.ts` 的 `applicableGenerators` 过滤循环内，按 mode 排除特定 generator ID：

```typescript
// reading 模式跳过的 generator ID 集合
const READING_SKIP_IDS = new Set(['adr-pipeline', 'product-ux-docs', 'troubleshooting', 'data-model', 'docs-quality-evaluator']);
// code-only 模式额外跳过（在 reading 基础上）
const CODE_ONLY_SKIP_IDS = new Set([...READING_SKIP_IDS, 'architecture-overview', 'architecture-ir', 'pattern-hints', 'event-surface', 'runtime-topology', 'architecture-narrative', 'component-view', 'dynamic-scenarios']);
```

---

## 6. graph.html 扩展方案

### 基线确认

当前 `buildHtmlTemplate(graphDataJson: string): string`（376 行）已实现：
- 内联 CSS（40 行）、D3_FORCE_BUNDLE、图谱数据 JSON
- 搜索框（`#search-input`）、社区图例（`#legend-list`）、节点详情（`#node-detail`）
- 力导向布局（`isLarge = nodes.length > 5000` 时切固定坐标）
- 平移 + 滚轮缩放

### F5 扩展签名

```typescript
export function buildHtmlTemplate(
  graphDataJson: string,
  options?: GraphHtmlOptions,
): string
```

`options` 的默认值：`forceLayoutThreshold: 2000`、`showHyperedges: true`、`enableSearch: true`、`enableJumpToSpec: true`、`fileSizeWarnThreshold: 5 * 1024 * 1024`。

调用方（batch-orchestrator.ts 知识图谱写盘后）透传 `options`，生成 graph.html 时检查文件体积，超 5 MB 输出 warn。

### 新增 HTML 区块

**1. 大图模式横幅**（节点数 ≥ 2000 时动态插入 DOM）：

```html
<div id="large-graph-banner" style="display:none;position:fixed;top:0;left:0;right:0;background:#d29922;color:#0d1117;padding:8px 16px;font-size:13px;font-weight:600;z-index:100;text-align:center;">
  大图模式（<span id="banner-node-count"></span> 个节点），力导向布局已关闭，部分交互受限
</div>
```

**2. 超边图例区块**（`#hyperedge-section`，插入 `#legend-section` 之后）：

```html
<div id="hyperedge-section" style="display:none;">
  <h3>流程超边</h3>
  <div id="hyperedge-list"></div>
</div>
```

**3. 点击跳转 spec 提示区域**（在 `#node-detail-rows` 之后）：

```html
<div id="spec-link-row" style="display:none;margin-top:8px;">
  <button id="open-spec-btn" style="...">打开 Spec 文件</button>
  <div id="spec-link-error" style="display:none;color:#f85149;font-size:11px;"></div>
</div>
```

**4. Hyperedge SVG 层**（在 `#links-layer` 之前插入）：

```html
<g id="hyperedges-layer"></g>
```

### JS 核心逻辑变更

**力导向阈值检查**（替换现有 `isLarge = nodes.length > 5000`）：

```javascript
// Q3 锁定：< 2000 force layout，≥ 2000 静态坐标
var FORCE_THRESHOLD = 2000;
var isLarge = nodes.length >= FORCE_THRESHOLD;

if (isLarge) {
  // 显示横幅
  document.getElementById('large-graph-banner').style.display = 'block';
  document.getElementById('banner-node-count').textContent = String(nodes.length);
  // 注意：生成时已经输出 warn，HTML 内无法再次输出日志，但横幅已满足 FR-023
  // drag event 不挂载（节点 fx/fy 固定）
  // 使用 community 预计算坐标（graph.json communities[].center 或 louvain 聚类中心）
}
```

**Hyperedge 凸包渲染**（在 `sim.on('tick')` 或固定坐标后调用）：

```javascript
function convexHull(points) {
  // Graham Scan 内联实现（约 25 行，闭包复用，无外部依赖）
}

function renderHyperedges(hyperedges, nodePositions) {
  var layer = document.getElementById('hyperedges-layer');
  hyperedges.forEach(function(he) {
    var pts = he.nodes.map(function(nid) { return nodePositions.get(nid); }).filter(Boolean);
    if (pts.length < 3) return; // 少于 3 个节点跳过凸包
    var hull = convexHull(pts);
    var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', hullToPathD(hull));
    pathEl.setAttribute('stroke-dasharray', '6 3');
    pathEl.setAttribute('stroke', he.color || '#8b949e');
    pathEl.setAttribute('stroke-width', '1.5');
    pathEl.setAttribute('fill', he.color || '#8b949e');
    pathEl.setAttribute('fill-opacity', '0.06');
    // 悬浮显示 label
    pathEl.addEventListener('mouseenter', function() { showHyperedgeTooltip(he.label); });
    pathEl.addEventListener('mouseleave', hideHyperedgeTooltip);
    layer.appendChild(pathEl);
  });
}
```

**节点点击打开 spec 文件**（机制决策：使用 `window.open('file://' + specPath)`，理由：self-contained HTML 在本地文件系统打开时，`file://` 协议可以触发 OS 默认关联打开行为；比 postMessage 不需要宿主环境，比详情侧栏链接更直接符合 FR-020 和 SC-005 "打开 spec 文件"的语义）：

```javascript
function showDetail(node) {
  // ...现有逻辑...

  // F5 新增：spec 文件跳转
  var specLinkRow = document.getElementById('spec-link-row');
  var openSpecBtn = document.getElementById('open-spec-btn');
  var specLinkError = document.getElementById('spec-link-error');

  if (node.specPath) {
    specLinkRow.style.display = 'block';
    specLinkError.style.display = 'none';
    openSpecBtn.textContent = '打开 Spec 文件';
    openSpecBtn.onclick = function() {
      try {
        // file:// URL 在本地浏览器中触发 OS 默认程序打开（如 VSCode、TextEdit）
        window.open('file://' + node.specPath, '_blank');
      } catch (e) {
        specLinkError.textContent = 'spec 文件未找到：' + node.specPath;
        specLinkError.style.display = 'block';
      }
    };
  } else {
    specLinkRow.style.display = 'none';
  }
}
```

**spec 文件不存在的友好提示**：`window.open('file://' + path)` 对不存在文件浏览器会显示"无法打开"，但无法在 HTML 内捕获。解决方案：预先在 `GRAPH_DATA.nodes[].specPathExists` 字段存储是否存在（由生成时 `fs.existsSync()` 检查填充），HTML 内根据此字段判断是否显示"spec 文件未找到"提示而非尝试打开。

**Self-contained 内联策略**：`GRAPH_DATA.hyperedges` 直接写入 `GRAPH_DATA` JSON 对象（与 nodes/links/communities 同级），无需额外请求。`buildGraphData()` 调用侧需传入 `hyperedges` 字段，由 `buildKnowledgeGraph()` 产物提供。

---

## 7. 集成点

### F1 budget-gate 集成

**问答调用注入位置**：`src/panoramic/qa/llm-caller.ts` 的 `callQnALlm()` 函数内，在 `messages.create()` 调用之前。

**Q2 锁定的 record-only 模式实现方案**：

当前 `runBudgetGate()` 的 API 没有原生的 "record-only 不阻断" 语义（只有 `continue / cancel`）。实现方案：

```typescript
// budget = Infinity + preset = 'continue' 组合实现 record-only
const budgetConfig: QnABudgetConfig = { hardcodeLimitUsd: 0.05, onOverLimit: 'record-only' };
const HARDCODE_LIMIT_TOKENS = Math.round(budgetConfig.hardcodeLimitUsd / 0.000015); // ~3333 tokens（claude-sonnet input price）

const promptText = buildQnAPrompt(ctx, citations, query.text, options);
const inputEstimate = estimateFast(promptText);
const outputEstimate = Math.round(inputEstimate * 0.5);
const totalEstimate = inputEstimate + outputEstimate;

// 使用 Infinity budget 确保不阻断；但记录超额状态
const gateResult = await runBudgetGate({
  baseEstimate: totalEstimate,
  budget: Infinity,       // 永不触发阻断
  preset: 'continue',
  isTTY: false,
});

const overBudget = totalEstimate > HARDCODE_LIMIT_TOKENS;
if (overBudget) {
  logger.warn('[warn] qna token cost over hardcode limit, recorded only');
}

// 继续调用 LLM，overBudget 标记附到返回结果
```

**`estimateFast`** 来自 `src/core/token-counter.ts`，已被 `budget-gate.ts` 引用，`llm-caller.ts` 直接 import 即可。

### F3 debt-scanner 集成

**触发位置**：`src/panoramic/qa/debt-context.ts` 的 `injectDebtContext()` 函数。

**触发条件**（关键词路由）：问题文本包含以下任一词（大小写不敏感）：`TODO`、`FIXME`、`HACK`、`技术债`、`最老`、`最长时间`、`债务`、`technical debt`。

**缓存策略**：`scanProjectDebt()` **每次问答都调用，不缓存**。理由：
- `scanProjectDebt` 主要是 AST 扫描 + git blame，不含 LLM 调用，单次耗时约 0.5-3 秒，可接受。
- 缓存需要管理失效策略（文件变更时过期），增加复杂度超出 F5 scope。
- 若用户连续多次问债务相关问题，重复扫描比引入缓存状态更简单。
- 如果实测性能不可接受，tasks 阶段可在 `llm-caller.ts` 加 module-level Map 作轻量 TTL 缓存（30 秒），但 plan 阶段不预设。

**"最老 TODO"回答路径**：

```typescript
const report = await scanProjectDebt({ projectRoot, registry });
const oldest = report.codeEntries
  .filter(e => e.kind === 'TODO')
  .sort((a, b) => b.ageDays - a.ageDays)
  .slice(0, 5);
```

Citation 格式：`{ specPath: entry.filePath, lineRange: { startLine: entry.line, endLine: entry.line }, excerpt: entry.text.slice(0, 200) }`。

### F4 hyperedges 集成

**Step 2 调用位置**：`src/panoramic/qa/graph-retriever.ts` 的 `retrieveGraphContext()` 内，BFS 完成后。

**label 和 nodeId 两种命中方式**：

```typescript
// 方式 1：按 label 模糊匹配（问题含流程名时适用）
const heByLabel = engine.getHyperedges({ label: query.text.slice(0, 30) });

// 方式 2：按 nodeId 精确匹配（BFS 已命中节点时适用）
const heByNode: Hyperedge[] = [];
for (const bfsNode of bfsNodes.slice(0, 5)) {
  const hes = engine.getHyperedges({ nodeId: bfsNode.id });
  heByNode.push(...hes);
}

// 合并去重
const allHyperedges = dedup([...heByLabel, ...heByNode], he => he.id);
```

**注意**：`graph-tools.ts` 的 `graph_hyperedges` 工具中，参数名为 `node_id`（snake_case），但 engine API 是 `engine.getHyperedges({ nodeId })` (camelCase)，两者在 `graph-tools.ts` 第 265 行已做映射。`qa/graph-retriever.ts` 直接调用 engine API，使用 camelCase `nodeId`。

---

## 8. 测试策略

### Story 1 — 轻量批处理模式

**单元测试**（`src/batch/`）：
- `runBatch()` 接收 `mode='reading'` 时，`generateBatchProjectDocs` 被调用且不含 adr-pipeline/product-ux-docs
- `runBatch()` 接收 `mode='code-only'` 时，`skipEnrichment` 为 true 且跳过架构层 generator
- `runBatch()` 接收无效 mode 时，启动阶段抛出含枚举值列表的错误
- `generateBatchProjectDocs()` 接收 `mode` 后，`READING_SKIP_IDS` / `CODE_ONLY_SKIP_IDS` 过滤逻辑正确
- MCP `batch` tool schema 解析 mode 参数（Zod enum 校验）

**集成测试**：
- 对 graphify 示例项目（5 文件）运行 `--mode=reading`，验证输出文件清单中不含 `product-overview.md`、`adrs/` 等
- 对 graphify 示例项目运行 `--mode=code-only`，验证不含 `architecture-narrative.md`
- `--mode=full` 行为与无 mode 参数等价（回归）

**性能测试**（E2E，NFR-001 / SC-001）：
- `--mode=reading` 冷启动实测耗时 < 300 秒（输出日志记录各阶段耗时）
- `--mode=reading` 热启动（SpecStore 已缓存）实测耗时 < 60 秒
- `--mode=code-only` 同等目标

### Story 2 — 自然语言问答

**单元测试**（`src/panoramic/qa/` 每个文件）：

| 文件 | 测试点 |
|------|--------|
| `graph-retriever.ts` | BFS 命中 < 3 节点时 fallbackMode = 'rag-only'；hyperedge 合并去重 |
| `rag-reranker.ts` | embedding 加载失败时降级为 'bfs-only'；filterByThreshold Top-K 正确 |
| `debt-context.ts` | 关键词路由正确触发（含 TODO、不含 TODO 两种 case）；citation 格式符合规范 |
| `citation.ts` | lineRange 越界检查跳过并记录 warn；三种路径 citation 格式均合法 |
| `prompt-builder.ts` | 输出 prompt 包含所有 citation 内联格式；hyperedge 候选列表存在 |
| `llm-caller.ts` | overBudget 标记在超额时为 true；LLM 调用不被阻断；warn 日志输出 |
| `index.ts` | 空字符串查询拒绝（不调用 LLM）；> 2000 字符截断；空图谱返回友好提示 |

**集成测试**：
- `panoramic-query` MCP tool，operation = `natural-language`，端到端返回 QnAAnswer 结构
- 5 类典型问题各执行 1 次（graphify 示例项目），均返回 citation 列表

**溯源正确性测试**（R6 缓解）：
- 抽取 5 条 Citation，逐一验证 `fs.readFileSync(specPath).split('\n').slice(startLine-1, endLine)` 能找到 excerpt 内容（允许部分匹配）

**性能测试**：
- 单次问答冷启动（首次加载 embedding 模型）< 20 秒
- 单次问答热启动（模型已加载）< 5 秒（纯 BFS + LLM 路径）

### Story 3 — graph.html 交互可视化

**单元测试**：
- `buildHtmlTemplate(json, options)` 签名扩展后向后兼容（无 options 等价旧行为）
- 节点数 ≥ 2000 时，生成的 HTML 包含 `large-graph-banner` 且 `D3.forceSimulation` 不在 main() 中被调用
- 节点数 < 2000 时，force simulation 正常初始化
- 文件体积超 5 MB 时，生成工具输出 warn（不阻断）

**集成测试（浏览器人工验证）**：
- 在 Chrome/Firefox/Safari 离线打开生成的 graph.html，验证：节点可拖动、搜索框可过滤、点击节点有响应（SC-003）
- 点击节点后 `open-spec-btn` 可见，触发 `file://` 打开行为（SC-005）
- hyperedge 凸包在画布中可见（虚线轮廓）

**E2E 验证路径**（整合验证 R1-R7）：
- graphify 示例项目跑 5 类问答（SC-002）
- 至少 1 次 hyperedge 相关问答（SC-004）
- `--mode=reading` 冷/热耗时测量（SC-001）
- `batch --html` 生成 graph.html 后离线打开验证（SC-003 / SC-005）
- F5 所有 LLM 调用在日志中有 tokenUsage 记录（SC-006）
- 模拟 BFS < 3 节点降级验证（SC-007）

---

## 9. 实施步骤（5 步）

### Step 1 — `--mode=reading/code-only` 切分 + CLI + 单测（Story 1）

**改动范围**：
- `src/batch/batch-orchestrator.ts`：`BatchOptions` + `runBatch()` 入口（3 处注入点）
- `src/panoramic/batch-project-docs.ts`：`GenerateBatchProjectDocsOptions` + generator 过滤
- `src/mcp/server.ts`：batch tool schema 新增 mode enum
- `src/cli/`：batch 子命令 `--mode=` flag

**Exit Criteria**：`batch --mode=reading` 和 `batch --mode=code-only` 对 graphify 示例项目运行不抛错；unit test 全绿；CLI `--mode=invalid` 返回枚举值错误提示；MCP batch tool schema Zod 校验通过。

**预期影响范围**：LOW（仅 batch 入口 + MCP schema，不动任何 generator 实现）

---

### Step 2 — 问答后端 RAG 检索 + LLM 组装 + 单测（Story 2 后端）

**改动范围**：
- 新建 `src/panoramic/qa/`（8 个文件，全量创建）

**Exit Criteria**：`answerQuestion({ text: "什么调用了 X?" }, { projectRoot })` 对有图谱数据的项目返回 `QnAAnswer`，包含至少 1 条 Citation；所有单元测试绿；空字符串查询被拒绝；LLM 不被调用时 overBudget 为 false。

**预期影响范围**：LOW（全新模块，无历史耦合）

---

### Step 3 — MCP `natural-language` operation 接入（Story 2 前端）

**改动范围**：
- `src/panoramic/query.ts`：`queryPanoramic()` 扩展 `natural-language` 路由
- `src/mcp/server.ts`：`panoramic-query` tool schema 新增 `natural-language` + `question` 参数
- `plugins/*/SKILL.md`：更新工具说明

**Exit Criteria**：通过 MCP 调用 `panoramic-query` with `operation: "natural-language"` 返回 JSON 化的 `QnAAnswer`；schema 校验通过；SKILL.md 说明更新。

**预期影响范围**：LOW（扩展现有 operation enum，向后兼容）

---

### Step 4 — graph.html 生成器扩展（Story 3）

**改动范围**：
- `src/panoramic/exporters/html-template.ts`：签名扩展 + 约 180 行 JS/CSS/HTML 增量（hyperedge 凸包 + 大图横幅 + 点击跳转）
- `src/batch/batch-orchestrator.ts`：知识图谱写盘后调用 `buildHtmlTemplate(json, options)` 生成 graph.html
- `src/cli/`：graph 子命令 `--html` flag（或 batch `--html`）

**Exit Criteria**：`batch --html` 生成 `_meta/graph.html`；离线浏览器打开正常；节点 < 2000 时 force layout 激活；节点 ≥ 2000 时横幅可见；点击节点 `open-spec-btn` 出现；超过 5 MB 时 warn 输出。

**预期影响范围**：MEDIUM（修改 html-template.ts + batch 写盘逻辑，需要回归 graph.html 生成测试）

---

### Step 5 — E2E 验证（整合）

**改动范围**：仅修复 Step 1-4 发现的 bug，不新增功能。

**Exit Criteria**：SC-001 ~ SC-007 全部通过；R1-R7 每条都有对应验证用例通过；`npx vitest run` 零失败；`npm run build` 零错误；`npm run repo:check` + `npm run release:check` 通过。

**预期影响范围**：仅 bugfix，低风险

---

## 10. 风险应对（承接 spec Risks & Mitigations）

| # | 风险 | plan 落地位置 | 缓解措施 |
|---|------|-------------|---------|
| R1 | BFS 命中 < 3 节点 | `graph-retriever.ts`：fallbackMode = 'rag-only' | 降级到纯 RAG；再失败返回"图谱数据不足"；Step 5 E2E 验证（SC-007）|
| R2 | `@xenova/transformers` 首次加载 5-15 秒 | `rag-reranker.ts`：embedding 加载失败时降级 'bfs-only' | 复用 F4 anchoring 已加载实例（共享 module-level singleton）；问答首次延迟可接受 |
| R3 | Hyperedge 问答召回不稳定 | `prompt-builder.ts`：显式列出 hyperedge.label 候选 | 让 LLM 从列表中选择而非自由发散 |
| R4 | graph.html force layout 卡顿 | `html-template.ts`：FORCE_THRESHOLD = 2000（Q3 锁定）| 500-2000 节点区间额外设 alphaDecay=0.05 + strength=-80 加速 stable |
| R5 | `--mode=reading` 性能收益低于预期 | Step 1 实现后 Step 5 实测 | verify 阶段实测冷/热耗时；收益不足时记录日志提示（不阻断交付）|
| R6 | Citation 漂移到错误 chunk | `citation.ts`：强制 lineRange + 越界检查 | Step 5 E2E 验证每条 Citation 可定位到实际行（SC-002）|
| R7 | graph.html 体积膨胀 | `buildHtmlTemplate`：超 5 MB 输出 warn | gzip-friendly minified JSON；warn 不阻断生成 |

---

## 11. Plan 阶段未解决问题

以下问题留给 tasks 阶段或 implement 阶段确认：

1. **graph.html 生成入口**：是通过 `batch --html` flag 自动生成，还是需要独立的 `spectra graph render` 命令？目前规划是 `batch --html` 触发，若 CLI 已有 graph 子命令则复用，tasks 阶段确认入口。

2. **`node.specPath` 字段来源**：`graph.json` 中的节点是否已有 `specPath` 字段（指向 `modules/*.spec.md`）？需要在 implement 阶段检查 `buildKnowledgeGraph()` 输出的 `GraphNode` 类型，若无此字段需在知识图谱构建时补充。

3. **community 预计算坐标**：大图模式（≥ 2000 节点）使用 `graph.communities[].center` 作为初始坐标。需确认 `GRAPH_REPORT.md` / `graph.json` 中社区数据是否已含 `center` 坐标字段，否则 implement 阶段需从 Louvain 结果中推算。

4. **`@huggingface/transformers` vs `@xenova/transformers`**：synthesis 提到 `@xenova/transformers`，但 `providers/factory.ts` 实际代码用的是 `@huggingface/transformers`（LocalEmbeddingProvider）。F5 直接复用现有 factory，无歧义，但 tasks 阶段应明确测试的 mock 策略。

5. **CLI 路径**：当前 `src/cli/` 目录结构未在本次阅读中覆盖，tasks 阶段需确认 `--mode` flag 具体注册在哪个 Command 下，以及是否需要新增 `--html` flag 或复用现有 graph 子命令。
