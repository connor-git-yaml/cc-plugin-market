# Implementation Plan: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**Branch**: `131-anchor-hyperedges-schema` | **Date**: 2026-04-19 | **Spec**: [spec.md](./spec.md)
**Input**: [spec.md](./spec.md) · [research-synthesis.md](./research/research-synthesis.md) · [tech-research.md](./research/tech-research.md)

---

## Summary

F4 Feature 在 Spectra 现有知识图谱（`graph.json`）基础上，通过三层能力扩展实现 design-doc × 代码节点的双向语义溯源：(1) `graph.json` schema v2.0 原地扩展——引入三种语义边类型、evidence 字段和 `hyperedges` 顶层数组；(2) Hybrid Chunking + Local Embedding（`@huggingface/transformers` + `all-MiniLM-L6-v2`）自动生成 `references` / `conceptually_related_to` 边；(3) LLM hyperedge 提取（通过 feature flag 保护）从命名流程描述中提取超边。MCP 工具层新增 `graph_hyperedges` 并适配 `graph_node` / `graph_community`，对外暴露完整 v2.0 能力。

技术路线完全沿用 synthesis 推荐方案：Strategy Pattern（EmbeddingProvider）+ Registry Pattern（边类型白名单）+ Pipeline Pattern（Chunked Embedding Batch）。schema 升级通过原地扩展 + `schemaVersion` 联合类型实现零破坏性兼容。

---

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20.x+
**Primary Dependencies**:
- 已有（直接复用）：`zod ^3.24.1`、`@anthropic-ai/sdk ^0.39.0`、`graphology ^0.26.0`、`@modelcontextprotocol/sdk ^1.26.0`
- 新增（optionalDependencies）：`@huggingface/transformers ^3.x`（~200MB，含 ONNX runtime + `all-MiniLM-L6-v2` 模型首次下载 ~90MB）
- 新增（正式 dependencies，若用户选 fallback）：通过现有 `@anthropic-ai/sdk` 中已有 fetch 能力对接 OpenAI embedding API，不需要单独安装 `openai` SDK

**Storage**: 读写 `specs/_meta/graph.json`（原地扩展，schemaVersion 从 `"1.0"` 升级到 `"2.0"`）
**Testing**: vitest（已有）；单测放 `tests/panoramic/`，集成测试放 `tests/integration/`
**Target Platform**: Linux / macOS / macOS ARM64（Node.js 20+，ESM module）
**Performance Goals**: Local Embedding 冷启动 < 30 秒（含首次模型下载）；单 chunk 推理 < 200ms（对应 NFR-001）
**Constraints**:
- `@huggingface/transformers` 必须列为 `optionalDependencies`，不强制所有用户下载（对应 NFR-005）
- `SpecStore`（`src/spec-store/`）只读（spec 硬约束）
- 所有 LLM / embedding 调用必须通过 `src/batch/budget-gate.ts` 的 `runBudgetGate` 记录 tokenUsage（对应 NFR-003）
- direction-audit CLI（`src/cli/commands/direction-audit.ts`）必须继续通过，新边类型通过白名单注册解决（对应 F2.5 兼容）

---

## Codebase Reality Check

### 目标文件现状

| 文件 | LOC | 公开接口数 | 已知 Debt | 变更类型 |
|------|-----|-----------|-----------|---------|
| `src/panoramic/graph/graph-types.ts` | 123 | 4 类型/接口 | 无 TODO/FIXME；`BuildGraphOptions` 中用了 `any`（已有 eslint 忽略注释） | 改（schema v2.0 扩展） |
| `src/panoramic/builders/doc-graph-builder.ts` | 572 | 7 个导出函数 + 9 个接口 | 无 TODO；`extractModuleSpecMetadata` 函数未被导出但仍存在（潜在死代码） | 改（添加 anchoring/hyperedges 调用入口） |
| `src/mcp/graph-tools.ts` | 229 | 2 个导出函数（`registerGraphTools`、`reloadGraph`） | 无 TODO；5 个工具注册逻辑内联在单函数中（可接受） | 改（新增 `graph_hyperedges` + v2.0 字段适配） |
| `src/cli/commands/direction-audit.ts` | 563 | 1 个导出函数（`runDirectionAuditCommand`） | 无 TODO；`isCrossModuleEdge` 逻辑略简化（已知 debt，与本次变更不相关） | 改（白名单注册新边类型） |
| `src/panoramic/anchoring/`（新建） | 0 | — | — | 新建 |
| `src/panoramic/hyperedges/`（新建） | 0 | — | — | 新建 |

### 前置清理评估

- `doc-graph-builder.ts`（572 LOC）将新增约 20-30 行调用代码（协调入口），不超过 50 行新增阈值，无需前置清理 task
- `direction-audit.ts`（563 LOC）将新增约 5-10 行白名单条目，同样不触发清理规则
- 所有目标文件的 TODO/FIXME 均为 0 条，无相关债务

**结论**：无需前置 CLEANUP task，可直接进入功能实现阶段。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| **直接修改文件数** | 4 个（graph-types.ts、doc-graph-builder.ts、graph-tools.ts、direction-audit.ts） |
| **新建文件数** | 约 12-14 个（anchoring/ 模块约 7 个，hyperedges/ 模块约 4 个，测试 fixture 约 2 个） |
| **间接受影响** | `graph-query.ts`（加载 GraphJSON，字段 optional 不破坏）；`graph-builder.ts`（消费 GraphJSON 类型，optional 字段兼容） |
| **跨包影响** | `src/panoramic/`（新建 2 个子目录）+ `src/mcp/`（修改 graph-tools.ts）+ `src/cli/`（修改 direction-audit.ts）= 3 个顶层子包；`plugins/spectra/`（更新 SKILL.md）|
| **数据迁移** | 无强制迁移；`schemaVersion` 字段扩展为联合类型，v1.0 文件无需修改 |
| **API/契约变更** | `GraphJSON` 接口扩展（新增 optional 字段）；`GraphEdge` 接口扩展（新增 optional evidence 字段）；新增 `graph_hyperedges` MCP 工具（新增合同，非修改） |
| **风险等级** | **MEDIUM**（跨包影响 = 3，超过"= 1"的 MEDIUM 上界；但无数据迁移、无破坏性 API 变更；参见下方论证） |

**MEDIUM 风险论证**：影响文件数 16-18 个（边界值），跨 3 个子包但均为渐进式扩展（optional 字段 + 新增工具 + 白名单），无 schema 破坏性变更。降级为 MEDIUM 而非 HIGH 的依据：(a) 所有新字段 optional，v1.0 消费方零破坏；(b) 新 MCP 工具不删除现有工具；(c) 无数据迁移、无配置格式变更。

**MEDIUM 风险不强制分阶段**，但 spec 已有交付顺序约束（schema v2.0 独立 commit），实际执行仍按 6 个 commit 序列推进。

---

## Constitution Check

| 宪法原则 | 适用性 | 评估 | 说明 |
|---------|--------|------|------|
| TypeScript 5.x + Node.js 20.x+ | 适用 | **PASS** | `@huggingface/transformers` v3 要求 Node.js ≥ 18，当前 engines 要求 ≥ 20，满足 |
| 代码质量：单一职责、命名即文档 | 适用 | **PASS** | anchoring/ 和 hyperedges/ 各自独立封装；EmbeddingProvider Strategy Pattern 隔离变体实现 |
| 零基思维：不在错误抽象上叠加 workaround | 适用 | **PASS** | graph-types.ts 原地扩展（optional 字段）优于新建独立文件（避免双文件协调复杂性） |
| 提交前验证：`npx vitest run` + `npm run build` 零失败 | 适用 | **PASS** | 每个 commit 前强制执行，plan 中明确列出 |
| 不修改 `src/spec-store/`（F2 领地） | 适用 | **PASS** | 所有新代码在 `src/panoramic/` 新子目录；spec-store 仅只读调用 |
| 不修改 `src/debt-scanner/**`、`plugins/spec-driver/**` | 适用 | **PASS** | 无交叉；plan 明确将这些路径列为禁区 |
| 新增依赖须通过 optionalDependencies | 适用 | **PASS** | `@huggingface/transformers` 列为 optionalDependencies；不在正式 dependencies |
| 发布合同：version 改动走 `npm run release:sync` | 适用 | **PASS** | 本 feature 不更新 version（功能扩展），无需触发 release sync |
| 中文注释 + 英文标识符 | 适用 | **PASS** | 所有新建模块遵循此规范 |

**Constitution Check 结论**：零 VIOLATION，计划可进入执行。

---

## Project Structure

### 制品（本 feature）

```text
specs/131-anchor-hyperedges-schema/
├── spec.md                          # 需求规范（已完成）
├── plan.md                          # 本文件
├── clarify.md                       # 澄清决议（已完成）
├── checklist.md                     # 质量检查表（已完成）
└── research/
    ├── research-synthesis.md        # 产研汇总（已完成）
    └── tech-research.md             # 技术调研（已完成）
```

### 源码变更树（本 feature 完整产出）

```text
src/
├── panoramic/
│   ├── graph/
│   │   └── graph-types.ts              [改] schema v2.0 类型扩展
│   ├── builders/
│   │   └── doc-graph-builder.ts        [改] 添加 anchoring + hyperedges 协调入口
│   ├── anchoring/                      [新] Story 2 函数级锚定模块
│   │   ├── chunker.ts                  [新] Hybrid Chunking 实现
│   │   ├── embedding-provider.ts       [新] EmbeddingProvider 接口 + TokenUsage 类型
│   │   ├── providers/
│   │   │   ├── local-provider.ts       [新] @huggingface/transformers 实现
│   │   │   ├── openai-provider.ts      [新] OpenAI text-embedding-3-small fallback
│   │   │   └── factory.ts              [新] 按环境变量选择 provider
│   │   ├── similarity.ts               [新] Cosine 相似度计算 + 阈值过滤
│   │   ├── edge-builder.ts             [新] 生成 references / conceptually_related_to 边
│   │   └── index.ts                    [新] 模块对外接口
│   └── hyperedges/                     [新] Story 3 LLM 超边提取模块
│       ├── prompt.ts                   [新] LLM prompt 构造
│       ├── schema.ts                   [新] Zod 校验 schema
│       ├── extractor.ts                [新] LLM 调用 + 校验 + BudgetGate 集成
│       └── index.ts                    [新] 模块对外接口
├── mcp/
│   └── graph-tools.ts                  [改] 适配 v2.0 + 新增 graph_hyperedges
└── cli/
    └── commands/
        └── direction-audit.ts          [改] 白名单扩展（注册 3 种新边类型）

tests/
├── panoramic/
│   ├── anchoring/
│   │   ├── chunker.test.ts             [新] Hybrid Chunking 单测
│   │   ├── similarity.test.ts          [新] Cosine + 阈值边界单测
│   │   ├── edge-builder.test.ts        [新] 边生成逻辑单测
│   │   └── providers/
│   │       ├── local-provider.test.ts  [新] Local provider 单测（mock ONNX）
│   │       ├── openai-provider.test.ts [新] OpenAI provider 单测（mock fetch）
│   │       └── factory.test.ts         [新] 环境变量切换单测
│   ├── hyperedges/
│   │   ├── prompt.test.ts              [新] Prompt 构造单测
│   │   ├── schema.test.ts              [新] Zod schema 校验单测
│   │   └── extractor.test.ts           [新] LLM 调用 + 降级 + BudgetGate 单测
│   └── graph-types-v2.test.ts          [新] schema v2.0 类型 + golden-master 单测
└── fixtures/
    ├── graph-v1.json                   [新] golden-master v1.0 fixture
    ├── graph-v2.json                   [新] golden-master v2.0 fixture
    ├── pure-code-project/              [新] 纯代码项目降级测试 fixture（≥5 个 .ts 文件，无 .md）
    │   └── src/...
    └── design-doc-project/             [新] 含 design-doc 的锚定测试 fixture
        ├── spec.md                     （含 ≥3 个 H2/H3 章节）
        └── src/...                     （≥5 个代码函数节点）

plugins/
└── spectra/
    └── skills/
        ├── spectra/
        │   └── SKILL.md                [改] 新增 graph_hyperedges 工具说明
        └── spectra-batch/
            └── SKILL.md                [改] 新增 --hyperedges CLI 选项说明

package.json                            [改] optionalDependencies 新增 @huggingface/transformers
```

---

## Architecture

### 架构分层图

```mermaid
graph TB
    subgraph "Story 2: Anchoring Pipeline"
        A[DocChunker<br/>chunker.ts] -->|DocChunk[]| B[EmbeddingProvider<br/>embedding-provider.ts]
        B --> C[LocalProvider<br/>providers/local-provider.ts]
        B --> D[OpenAIProvider<br/>providers/openai-provider.ts]
        E[factory.ts<br/>SPECTRA_EMBEDDING_PROVIDER] --> C
        E --> D
        B -->|Float32Array[]| F[SimilarityScorer<br/>similarity.ts]
        F -->|filtered pairs >= 0.75| G[EdgeBuilder<br/>edge-builder.ts]
        G -->|SemanticEdge[]| H[BudgetGate<br/>budget-gate.ts]
    end

    subgraph "Story 3: Hyperedge Pipeline"
        I[prompt.ts<br/>LLM prompt 构造] --> J[Extractor<br/>extractor.ts]
        J -->|Anthropic SDK| K[LLM]
        K -->|raw JSON| L[Zod Schema<br/>schema.ts]
        L -->|Hyperedge[] / []| J
        J --> H
    end

    subgraph "Story 1: Schema v2.0"
        M[graph-types.ts<br/>GraphJSON / GraphEdge / Hyperedge]
    end

    subgraph "Story 4: MCP Layer"
        N[graph-tools.ts<br/>graph_hyperedges / graph_node / graph_community]
        O[GraphQueryEngine<br/>graph-query.ts]
        N --> O
        O --> P[graph.json v2.0]
    end

    H -->|tokenUsage 记录| P
    G --> P
    L --> P
    M --> P
```

### 数据流序列

```
spectra batch [--hyperedges]
  │
  ├── 1. buildKnowledgeGraph() → graph.json v2.0 骨架（Story 1）
  │
  ├── 2. anchorDocToCode()                        （Story 2）
  │     ├── DocChunker.chunk(markdownFiles)
  │     ├── EmbeddingProvider.embed(chunks)
  │     ├── SimilarityScorer.score(chunkVectors, nodeVectors)
  │     ├── EdgeBuilder.build(pairs >= threshold)
  │     └── 写入 graph.json links[]
  │
  ├── 3. extractHyperedges()  [if --hyperedges]   （Story 3）
  │     ├── prompt.buildPrompt(nodes, docChunks)
  │     ├── BudgetGate.run() → Anthropic SDK
  │     ├── Zod.safeParse(llmOutput)
  │     └── 写入 graph.json hyperedges[]
  │
  └── 4. MCP tools 适配 v2.0 graph.json            （Story 4）
```

---

## Schema v2.0 类型合同

### 核心类型扩展（`src/panoramic/graph/graph-types.ts`）

```typescript
// 已有（保持不变）
export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

// 新增：语义边类型
export type SemanticEdgeRelation =
  | 'references'
  | 'conceptually_related_to'
  | 'rationale_for';

// 修改：GraphEdge 新增 optional evidence 字段
export interface GraphEdge {
  source: string;
  target: string;
  relation: string;            // 新增允许值：SemanticEdgeRelation（string 联合，向后兼容）
  confidence: ConfidenceLevel;
  confidenceScore: number;
  evidenceText?: string;        // 新增，INFERRED/AMBIGUOUS 时非空，最大 200 字符
  evidenceSource?: string;      // 新增，格式 "repo/relative/path.md:startLine-endLine"
}

// 新增：Hyperedge 类型
export interface Hyperedge {
  id: string;                   // UUID v4
  label: string;                // ≤ 8 Unicode 字符
  nodes: string[];              // 节点 ID 数组，≥ 3 个，至少 1 个非 doc-section
  rationale: string;            // 提取理由，非空
  confidence: ConfidenceLevel;  // LLM 提取一般为 INFERRED 或 AMBIGUOUS
}

// 修改：GraphJSON.graph.schemaVersion 从字面量扩展为联合类型
export interface GraphJSON {
  directed: boolean;
  multigraph: false;
  graph: {
    name: 'spectra-knowledge-graph';
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
    sources: ('architecture-ir' | 'doc-graph' | 'cross-reference' | 'extraction')[];
    skippedSources?: Array<{ source: string; reason: string }>;
    inputHash?: string;
    schemaVersion: '1.0' | '2.0';  // 联合类型（原为字面量 '1.0'）
  };
  nodes: GraphNode[];
  links: GraphEdge[];
  hyperedges?: Hyperedge[];         // 新增，optional 保持向后兼容
}

// 新增：边类型注册表（供 direction-audit 白名单使用）
export const SEMANTIC_EDGE_RELATIONS = {
  REFERENCES: 'references',
  CONCEPTUALLY_RELATED_TO: 'conceptually_related_to',
  RATIONALE_FOR: 'rationale_for',
} as const;
```

### EmbeddingProvider 接口（`src/panoramic/anchoring/embedding-provider.ts`）

```typescript
// BudgetGate 兼容的 TokenUsage 格式（对齐 F1 基础设施）
export interface EmbeddingTokenUsage {
  llmModel: string;         // 'local-embedding' 或 'text-embedding-3-small'
  inputTokens?: number;     // OpenAI fallback 时有值；Local 模式估算或省略
  outputTokens?: number;    // embedding 无 outputTokens，固定为 0
  durationMs: number;       // 推理耗时（Local + OpenAI 均记录）
}

export interface EmbedResult {
  vectors: Float32Array[];
  tokenUsage: EmbeddingTokenUsage;
}

// Strategy Pattern 接口
export interface EmbeddingProvider {
  readonly providerName: 'local' | 'openai';
  readonly llmModelLabel: string;   // 用于 tokenUsage.llmModel
  readonly dimensions: number;      // 向量维度（Local: 384，OpenAI: 1536）
  embed(texts: string[]): Promise<EmbedResult>;
}
```

**Local Provider 的 tokenUsage 上报策略**：`inputTokens` 使用 `estimateFast(text)` 粗估（基于字符数，不做精确 tokenize），`outputTokens` 固定为 0，`durationMs` 精确计时（`performance.now()`）。这与 F1 BudgetGate 中已有的 `durationMs` 字段对齐（对应 FR-016）。

### DocChunk 类型（`src/panoramic/anchoring/chunker.ts`）

```typescript
export interface DocChunk {
  filePath: string;             // repo-relative 路径
  startLine: number;            // 1-based，chunk 起始行
  endLine: number;              // 1-based，chunk 结束行
  headingPath: string;          // 如 "## Design > ### API"
  text: string;                 // chunk 文本（已去除 markdown 格式符）
  tokenCount: number;           // 估算 token 数（用于上限控制）
}

// Chunker 公开接口
export interface DocChunkerOptions {
  maxTokens?: number;           // 默认 512
}

export function chunkMarkdownFiles(
  filePaths: string[],
  projectRoot: string,
  options?: DocChunkerOptions,
): DocChunk[];
```

---

## 文件级接口签名

### `src/panoramic/anchoring/similarity.ts`

```typescript
// Cosine 相似度计算（Float32Array 优化）
export function cosineSimilarity(a: Float32Array, b: Float32Array): number;

// 批量过滤超过阈值的 (chunkIndex, nodeId) 对
export interface SimilarPair {
  chunkIndex: number;
  nodeId: string;
  similarity: number;     // >= threshold
}

export function filterByThreshold(
  chunkVectors: Float32Array[],
  nodeVectors: Map<string, Float32Array>,
  threshold: number,       // 默认 0.75，含边界值
): SimilarPair[];
```

### `src/panoramic/anchoring/edge-builder.ts`

```typescript
// 从相似对生成 GraphEdge（SemanticEdge）
export interface BuildEdgesOptions {
  chunks: DocChunk[];
  pairs: SimilarPair[];
  projectRoot: string;
  maxEvidenceLength?: number;  // 默认 200
}

// 去重：同一 (source, target, relation) 保留 confidence 最高的版本
export function buildSemanticEdges(options: BuildEdgesOptions): GraphEdge[];
```

### `src/panoramic/anchoring/index.ts`（对外接口）

```typescript
export interface AnchorOptions {
  projectRoot: string;
  markdownFiles: string[];
  graphNodes: GraphNode[];
  threshold?: number;          // 默认 0.75
  maxEvidenceLength?: number;  // 默认 200
}

export interface AnchorResult {
  edges: GraphEdge[];
  tokenUsage: EmbeddingTokenUsage;
  stats: {
    chunksProcessed: number;
    edgesGenerated: number;
    durationMs: number;
  };
}

export async function anchorDocToCode(options: AnchorOptions): Promise<AnchorResult>;
```

### `src/panoramic/hyperedges/schema.ts`

```typescript
import { z } from 'zod';

// Zod schema for LLM output validation
export const HyperedgeSchema = z.object({
  label: z.string().min(1).max(8),
  nodes: z.array(z.string()).min(3),
  rationale: z.string().min(1).max(200),
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
});

export const HyperedgesOutputSchema = z.object({
  hyperedges: z.array(HyperedgeSchema).max(10),
});

export type HyperedgeOutput = z.infer<typeof HyperedgesOutputSchema>;
```

### `src/panoramic/hyperedges/extractor.ts`（对外接口）

```typescript
export interface ExtractHyperedgesOptions {
  projectRoot: string;
  nodes: GraphNode[];           // code nodes only（sourceKind !== 'doc-section'）
  docChunks: DocChunk[];
  projectSummary?: string;      // 来自 .specify/project-context.yaml description
}

export interface ExtractResult {
  hyperedges: Hyperedge[];      // 空数组 = LLM 未产出或全部 Zod 校验失败
  tokenUsage: EmbeddingTokenUsage;
  failedSamples: unknown[];     // Zod 校验失败的原始 LLM 输出（写入 trace 日志）
}

// 受 SPECTRA_HYPEREDGES_ENABLED=true 或 --hyperedges CLI 控制
export async function extractHyperedges(
  options: ExtractHyperedgesOptions,
): Promise<ExtractResult>;
```

### `src/mcp/graph-tools.ts` 新增工具签名

```typescript
// 新增工具：graph_hyperedges
// 过滤参数（全部可选）：
{
  label?: string,       // substring 模糊匹配 hyperedge.label
  nodeId?: string,      // 精确匹配 hyperedge.nodes 数组中的元素
  limit?: number,       // 返回数量上限（默认 20）
  projectRoot?: string,
}

// 返回结构（每条 hyperedge 完整字段）：
{
  hyperedges: Array<{
    id: string;
    label: string;
    nodes: string[];
    rationale: string;
    confidence: ConfidenceLevel;
  }>;
  total: number;
  filtered: boolean;
}
```

### `src/cli/commands/direction-audit.ts` 白名单扩展

在 `classifyEdge` 函数内增加对 `SemanticEdgeRelation` 的 `skipped` 分类规则：凡 `relation` 属于 `['references', 'conceptually_related_to', 'rationale_for']` 的边，若 source 或 target 之一为文档类节点（`spec/document`），则分类为 `skipped`（已有逻辑覆盖"两侧均为文档节点"，需扩展为"至少一侧为文档节点 + relation 属于语义边白名单"的情形）。同时在 direction-audit 帮助文本中注明新边类型。

---

## 分批交付序列

### Commit 1（独立，Story 1 — schema v2.0）

**变更内容**：
- `src/panoramic/graph/graph-types.ts`：扩展 `GraphEdge`（optional evidence 字段）、`GraphJSON`（`schemaVersion` 联合类型 + optional `hyperedges`）、新增 `Hyperedge` 接口和 `SEMANTIC_EDGE_RELATIONS` 注册表
- `src/cli/commands/direction-audit.ts`：白名单注册 3 种新边类型，扩展 `classifyEdge` 分类规则
- `tests/fixtures/graph-v1.json`：golden-master v1.0（含现有字段，无 `hyperedges`）
- `tests/fixtures/graph-v2.json`：golden-master v2.0（含 `hyperedges`、`evidenceText`、`evidenceSource`、`confidence`）
- `tests/panoramic/graph-types-v2.test.ts`：schema 单测（v1.0 + v2.0 双版本 fixture 均通过；`evidenceText` 长度上限；`hyperedges` 结构校验；`schemaVersion` 联合类型）

**验收门**：`npx vitest run` 零失败 + `npm run build` 零错误 + direction-audit 集成测试通过

**注意**：此 commit 必须单独交付，不混入后续 Story 代码（对应 AC-012）。

---

### Commit 2（Story 2 主体 — Local Embedding + 边生成）

**变更内容**：
- `src/panoramic/anchoring/chunker.ts`：`chunkMarkdownFiles()` 实现（Hybrid Chunking：H2/H3 边界 + 段落合并 + 512 tokens 上限，记录 startLine/endLine）
- `src/panoramic/anchoring/similarity.ts`：`cosineSimilarity()` + `filterByThreshold()`（threshold >= 0.75，含边界值）
- `src/panoramic/anchoring/edge-builder.ts`：`buildSemanticEdges()`（去重：higher-confidence wins；evidenceText 对称扩展截断算法；evidenceSource 格式拼装）
- `src/panoramic/anchoring/embedding-provider.ts`：`EmbeddingProvider` 接口 + `EmbeddingTokenUsage` 类型
- `src/panoramic/anchoring/providers/local-provider.ts`：`@huggingface/transformers` 实现（`all-MiniLM-L6-v2`；加载失败抛出带安装指引的 Error）
- `src/panoramic/anchoring/index.ts`：`anchorDocToCode()` 编排函数 + BudgetGate 集成
- `tests/panoramic/anchoring/chunker.test.ts`：Hybrid Chunking 单测（边界值、空文件、超长 chunk 截断）
- `tests/panoramic/anchoring/similarity.test.ts`：threshold 边界值（0.75 生成边；0.74 不生成）
- `tests/panoramic/anchoring/edge-builder.test.ts`：去重逻辑 + evidenceText 截断算法
- `tests/panoramic/anchoring/providers/local-provider.test.ts`：mock `@huggingface/transformers`，测试加载失败场景
- `tests/fixtures/design-doc-project/`：含 design-doc 的 fixture（≥ 3 个 H2/H3 章节 + ≥ 5 个代码节点）

**验收门**：`npx vitest run` 零新增失败 + `npm run build` 零错误 + tokenUsage 格式与 BudgetGate 兼容

---

### Commit 3（Story 2 fallback — OpenAI Provider + factory）

**变更内容**：
- `src/panoramic/anchoring/providers/openai-provider.ts`：OpenAI `text-embedding-3-small` 实现（直接 fetch OpenAI Embeddings API，无需 `openai` SDK；tokenUsage 记录实际 API input token 计数）
- `src/panoramic/anchoring/providers/factory.ts`：`createEmbeddingProvider()`（读取 `SPECTRA_EMBEDDING_PROVIDER` 环境变量，默认 `'local'`；local 模块不可用时抛出带提示的 Error，不自动 fallback 到 openai）
- `tests/panoramic/anchoring/providers/openai-provider.test.ts`：mock fetch，测试 API 调用 + tokenUsage 记录
- `tests/panoramic/anchoring/providers/factory.test.ts`：环境变量切换场景

**设计决策**：factory 不自动 fallback（用户需显式设置 `SPECTRA_EMBEDDING_PROVIDER=openai`），原因：静默 fallback 会产生意外的 API key 依赖，违背"零 API key 可运行"基线（对应 NFR-002）。

**验收门**：`npx vitest run` 零新增失败 + `npm run build` 零错误

---

### Commit 4（Story 3 — Hyperedge LLM 提取）

**变更内容**：
- `src/panoramic/hyperedges/prompt.ts`：`buildHyperedgePrompt(nodes, docChunks, projectSummary)`（输入体积控制在 4000 tokens 以内；nodes 最多 20 个，docChunks 最多 10 个）
- `src/panoramic/hyperedges/schema.ts`：`HyperedgesOutputSchema`（Zod，label ≤ 8 字、nodes ≥ 3、rationale 非空、confidence 枚举）
- `src/panoramic/hyperedges/extractor.ts`：`extractHyperedges()`（Anthropic SDK JSON mode 调用 + BudgetGate 记录 + Zod 校验 + graceful degradation + failedSamples trace）
- `src/panoramic/hyperedges/index.ts`：模块对外接口
- feature flag 读取（`SPECTRA_HYPEREDGES_ENABLED` 环境变量 + `--hyperedges` CLI 解析）在 `doc-graph-builder.ts` 入口处控制
- `tests/panoramic/hyperedges/schema.test.ts`：Zod schema 边界值测试（label > 8 字符拒绝、nodes < 3 拒绝、全部校验失败返回空数组）
- `tests/panoramic/hyperedges/extractor.test.ts`：mock Anthropic SDK，测试正常路径 + 降级 + BudgetGate 集成
- `tests/fixtures/pure-code-project/`：纯代码 fixture（≥ 5 个 .ts 文件，零 .md 文件）

**验收门**：`npx vitest run` 零新增失败 + `npm run build` 零错误 + feature flag 未启用时不执行 LLM 调用

---

### Commit 5（Story 4 — MCP 工具适配）

**变更内容**：
- `src/mcp/graph-tools.ts`：新增 `graph_hyperedges` 工具（label substring 匹配 + nodeId 精确匹配 + limit）；`graph_node` 适配返回关联语义边列表（含 evidenceText、evidenceSource）；`graph_community` 适配（可选）返回涉及社区成员的 hyperedge 列表
- `plugins/spectra/skills/spectra/SKILL.md`：新增 `graph_hyperedges` 工具说明（用途、输入参数、输出格式）
- `plugins/spectra/skills/spectra-batch/SKILL.md`：新增 `--hyperedges` CLI 选项说明
- `tests/panoramic/graph-tools-v2.test.ts`：`graph_hyperedges` 过滤参数测试（label 模糊、nodeId 精确、空结果）；`graph_node` 返回 semanticEdges 字段测试

**验收门**：`npx vitest run` 零新增失败 + `npm run build` 零错误 + `graph_hyperedges` 过滤逻辑通过集成测试

---

### Commit 6（验证 — 端到端验证）

**变更内容**（仅验证产物，无新建功能代码）：
- `doc-graph-builder.ts`：确认 `anchorDocToCode()` 和 `extractHyperedges()` 的协调调用入口完整
- 如存在 graphify 示例项目 fixture（待 Commit 2 后调研确认）：运行实跑验证，输出 ≥ 10 条语义边 + ≥ 1 个 hyperedge
- 确认 direction-audit CLI 对含新边类型的 graph.json 返回码为 0
- 确认纯代码项目诚实降级（零新边、零 hyperedge、返回码 0）

**验收门**：所有 AC 通过（AC-001 到 AC-012）；`npm run build` + `npx vitest run` 零失败

---

## 风险缓解计划

### Risk 1 — Embedding 假阳性（INFERRED 边噪声）

**FR 映射**：FR-002（confidence 枚举）+ FR-003（INFERRED 边强制 evidenceText 非空）

**缓解实现位置**：
- `src/panoramic/anchoring/edge-builder.ts`：`buildSemanticEdges()` 中强制检查：`confidence === 'INFERRED'` 时 `evidenceText` 不可为空字符串，否则丢弃该边
- `src/panoramic/anchoring/similarity.ts`：threshold 默认 0.75 且通过 `AnchorOptions.threshold` 可配置（对应 NFR-007）
- AC-003 的人工验证（INFERRED 边抽样 ≥ 20 条，假阳性 < 20%）在 Commit 6 验证阶段执行

### Risk 2 — Hyperedge 数量失控

**FR 映射**：FR-018（每 batch ≤ 10）

**缓解实现位置**：
- `src/panoramic/hyperedges/schema.ts`：`HyperedgesOutputSchema` 用 `z.array(...).max(10)` 强制上限
- `src/panoramic/hyperedges/extractor.ts`：prompt 中明确指示 LLM"每次最多输出 10 个 hyperedge"
- 若 design-doc 规模超出单 batch 处理能力，`extractor.ts` 将 docChunks 分 batch 处理，每 batch 独立调用 LLM

### Risk 3 — `@huggingface/transformers` 依赖加载失败

**FR 映射**：FR-011（加载失败抛出清晰错误）+ NFR-005（optionalDependencies）

**缓解实现位置**：
- `src/panoramic/anchoring/providers/local-provider.ts`：使用 `try { await import('@huggingface/transformers') } catch` 包裹动态导入，捕获 `MODULE_NOT_FOUND` 时抛出：`"Local embedding 不可用：请运行 npm install @huggingface/transformers 或设置 SPECTRA_EMBEDDING_PROVIDER=openai"`
- `package.json`：`optionalDependencies` 中添加 `"@huggingface/transformers": "^3.x"`
- 单测使用 vi.mock 模拟模块不可用场景

### Risk 4 — Schema 破坏下游消费方

**FR 映射**：FR-006（optional 字段）+ NFR-006（向后兼容）+ FR-008（golden-master fixture）

**缓解实现位置**：
- `src/panoramic/graph/graph-types.ts`：所有新增字段（`evidenceText`、`evidenceSource`、`hyperedges`）标注为 TypeScript optional（`?:`）
- `schemaVersion` 从 `'1.0'` 字面量扩展为 `'1.0' | '2.0'` 联合类型，不删除 `'1.0'`
- `tests/fixtures/graph-v1.json` + `graph-v2.json`：两个 golden-master fixture 均通过 `tests/panoramic/graph-types-v2.test.ts` 验证
- `GraphQueryEngine.loadFromFile()`（`src/panoramic/graph/graph-query.ts`）现有宽松 schema 校验（仅检查 nodes/links 数组存在）天然兼容 v2.0，无需修改

### Risk 5 — LLM 输出 Hyperedge 不合规

**FR 映射**：FR-019（Zod 校验失败静默丢弃 + trace 日志）

**缓解实现位置**：
- `src/panoramic/hyperedges/extractor.ts`：使用 `HyperedgesOutputSchema.safeParse(llmOutput)` 而非 `parse()`，解析失败时将原始输出写入 `failedSamples` 数组并记录到 trace 日志（通过 `src/panoramic/utils/logger.ts`）
- 单次 batch 全部校验失败时，返回空数组，主流程继续（不抛出异常）
- `tests/panoramic/hyperedges/extractor.test.ts`：覆盖全部校验失败场景

### Risk 6 — TokenUsage 遗漏破坏成本透明度

**FR 映射**：FR-016（embedding 调用统一记录）+ NFR-003（BudgetGate 统一入口）

**缓解实现位置**：
- `src/panoramic/anchoring/index.ts`：`anchorDocToCode()` 汇总所有 `EmbeddingProvider.embed()` 调用的 `tokenUsage`，通过 BudgetGate 的 `BudgetGateAttempt` 机制记录
- Local 模式：`llmModel: 'local-embedding'`、`durationMs: <实测>`、`inputTokens: <粗估>`（满足 F1 BudgetGate 格式要求）
- `tests/panoramic/anchoring/providers/local-provider.test.ts`：验证 tokenUsage 格式中 `llmModel === 'local-embedding'` 且 `durationMs` 为正数

### Risk 7 — 纯代码项目意外产出边

**FR 映射**：FR-015（零 doc chunk 诚实降级）+ AC-005

**缓解实现位置**：
- `src/panoramic/anchoring/chunker.ts`：`chunkMarkdownFiles()` 在 `markdownFiles` 为空时直接返回 `[]`，不调用 EmbeddingProvider
- `src/panoramic/anchoring/index.ts`：`anchorDocToCode()` 在 chunks 为空时提前返回 `{ edges: [], ... }`
- `tests/fixtures/pure-code-project/`：降级测试 fixture（零 .md 文件），在集成测试中验证 AC-005

### Risk 8 — evidenceText 截断破坏关键上下文

**FR 映射**：spec Edge Cases 第 2 条（对称扩展，heading 整行纳入）

**缓解实现位置**：
- `src/panoramic/anchoring/edge-builder.ts` 中的截断算法：

```
函数 truncateEvidence(fullText: string, matchOffset: number, maxLength: number = 200): string:
  1. 从 matchOffset 向左扩展，找到句子边界（'. '、'\n'）或达到 maxLength/2
  2. 从 matchOffset 向右扩展，找到句子边界或达到剩余长度上限
  3. 若截断处为 heading 行（以 '##' 开头），整行纳入（覆盖 200 字符上限，但 heading 通常 < 50 字符）
  4. 结果头部或尾部添加 '...' 省略标记
  5. 去除 '###'、'```' 等 markdown 格式符；保留 inline code '`'
```

---

## 测试策略

### 单元测试（覆盖率目标 ≥ 80%）

| 测试文件 | 覆盖场景 |
|---------|---------|
| `tests/panoramic/graph-types-v2.test.ts` | schema v2.0 类型结构、golden-master v1.0/v2.0 fixture 双版本通过、`evidenceText` 200 字符上限、`hyperedges` 结构验证、`schemaVersion` 联合类型 |
| `tests/panoramic/anchoring/chunker.test.ts` | H2/H3 边界分割、段落合并、512 tokens 上限、startLine/endLine 记录、空文件降级 |
| `tests/panoramic/anchoring/similarity.test.ts` | threshold 含边界值（0.75 生成边、0.7499... 不生成）、空向量列表处理 |
| `tests/panoramic/anchoring/edge-builder.test.ts` | 去重（higher-confidence wins）、evidenceText 对称截断算法、evidenceSource 格式 |
| `tests/panoramic/anchoring/providers/local-provider.test.ts` | 模块不可用时的清晰错误、tokenUsage 格式（llmModel + durationMs） |
| `tests/panoramic/anchoring/providers/openai-provider.test.ts` | fetch mock + tokenUsage inputTokens 记录 |
| `tests/panoramic/anchoring/providers/factory.test.ts` | 环境变量切换（local/openai）、default 为 local |
| `tests/panoramic/hyperedges/schema.test.ts` | Zod schema 边界（label > 8 字拒绝、nodes < 3 拒绝、正常路径通过） |
| `tests/panoramic/hyperedges/extractor.test.ts` | mock Anthropic SDK、Zod 全失败返回空数组、failedSamples 记录、BudgetGate 集成 |
| `tests/panoramic/graph-tools-v2.test.ts` | `graph_hyperedges` label 模糊匹配、nodeId 精确匹配、空结果不报错、`graph_node` 返回 semanticEdges |

### Golden-Master Fixture 规范

```json
// tests/fixtures/graph-v1.json（v1.0 — 无 hyperedges，无 evidence 字段）
{
  "directed": false,
  "multigraph": false,
  "graph": { "schemaVersion": "1.0", "name": "spectra-knowledge-graph", "..." },
  "nodes": [...],
  "links": [{ "source": "src/a.ts", "target": "src/b.ts", "relation": "imports", "confidence": "EXTRACTED", "confidenceScore": 0.95 }]
}

// tests/fixtures/graph-v2.json（v2.0 — 含 hyperedges + evidence 字段）
{
  "directed": false,
  "multigraph": false,
  "graph": { "schemaVersion": "2.0", "..." },
  "nodes": [...],
  "links": [
    { "source": "specs/ingestion.md", "target": "src/pipeline.ts",
      "relation": "references", "confidence": "INFERRED", "confidenceScore": 0.82,
      "evidenceText": "ingestion pipeline processes...", "evidenceSource": "specs/ingestion.md:15-18" }
  ],
  "hyperedges": [
    { "id": "he-001", "label": "全量摄取", "nodes": ["src/a.ts", "src/b.ts", "specs/doc.md"],
      "rationale": "三个节点共同构成全量摄取流程", "confidence": "INFERRED" }
  ]
}
```

### 集成测试

- `tests/integration/direction-audit.test.ts`（已有）：添加含新边类型的 fixture，验证审计结果为 `skipped` 而非 `incorrect`
- 降级测试：使用 `tests/fixtures/pure-code-project/` 验证 AC-005

### 开放问题（供 tasks 阶段补调研）

1. **graphify 示例项目 fixture 是否已存在**：synthesis 提到"在 graphify 示例项目上实跑"，需在 Commit 6 前确认 `specs/_meta/graph.json` 或专用示例 fixture 是否已有，或需新建。目前 `tests/fixtures/` 中无 graphify 示例项目。
2. **direction-audit 白名单扩展的精确插入位置**：`classifyEdge()` 中语义边的分类规则需同时处理"source 为文档节点 + relation 为语义边"和"target 为文档节点 + relation 为语义边"两种情形，实现前需阅读完整函数确认边界条件。
3. **`doc-graph-builder.ts` 的 `extractModuleSpecMetadata` 死代码**：该函数未被导出且仅被内部调用，本次添加 anchoring 入口时一并评估是否清理（不影响功能，但影响 Commit 1 前的代码质量判断）。
4. **`@huggingface/transformers` 模型缓存路径**：首次运行下载 ~90MB 模型后的缓存位置（默认 `~/.cache/huggingface`），CI 环境是否需要 `SPECTRA_EMBEDDING_MODEL_PATH` 环境变量支持预下载路径，待 tasks 阶段具体调研。
5. **BudgetGate 与 embedding 调用的精确集成方式**：`budget-gate.ts` 的 `runBudgetGate` 接受 `BudgetDecisionInput`（含 `totalEstimate` 和 `budget`），embedding 调用的"预估 token 数"如何传入需在 Commit 2 实现时确认接口细节。

---

## Complexity Tracking

| 决策 | 选择 | 更简单方案 | 放弃原因 |
|------|------|-----------|---------|
| EmbeddingProvider Strategy Pattern | Local/OpenAI 各自独立实现，工厂函数切换 | 硬编码 local，不提供 fallback | spec 明确要求 OpenAI fallback（FR-010）；若无接口抽象，切换 provider 需改调用方代码 |
| factory 不自动 fallback | 加载失败时抛出错误，提示用户显式切换 | local 失败自动切换 openai | 静默 fallback 会导致意外 API key 依赖，违背 NFR-002 零 API 成本基线 |
| evidenceText 对称扩展 | 从 match 位置向两侧扩展，heading 整行纳入 | 简单截取前 200 字符 | spec Edge Cases 明确要求"从 match 位置对称扩展"以保留关键上下文 |
| Hyperedge 分 batch 处理 | 每 batch 最多 20 nodes + 10 docChunks，输入 ≤ 4000 tokens | 一次传入所有内容 | FR-018 硬约束每 batch ≤ 10 个 hyperedge；输入体积过大影响 LLM 输出质量 |

---

*计划版本：v1.0 | 编制者：plan 子代理 | 基于 2026-04-19 代码库快照*
