# Tasks: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**Feature 分支**: `131-anchor-hyperedges-schema`
**生成日期**: 2026-04-19
**输入制品**: spec.md · plan.md · clarify.md
**总 Task 数**: 40

---

## 说明

### 标签含义

- `[P]`：可并行执行（与其他 [P] Task 不共享文件、无依赖）
- `[S]`：必须串行（依赖前置 Task 的产出）
- `[!]`：阻断性（下一 Commit 不得在此 Task 完成前开始）

### 命名约定

- Task ID 连续递增：T001 – T040
- 每个 Task：动词开头（中文）+ 目标文件路径 + 简要说明
- FR/NFR/AC 映射写在"映射"字段
- `confidence` 枚举：`EXTRACTED | INFERRED | AMBIGUOUS`（以 spec.md + plan.md 最终合同为准）

---

## Commit 1 — schema v2.0 独立升级（Story 1 · P1）

> **目标**：建立类型合同基础，所有后续 Commit 依赖此 Commit 的类型定义。本 Commit 独立交付，禁止混入 embedding 或 hyperedge 实现代码（AC-012）。

**独立测试**：`npm run build` 零错误 + `npx vitest run tests/panoramic/graph-types-v2.test.ts` 零失败 + direction-audit 集成测试对含新边类型 fixture 返回码 0。

---

### T001 [x] [S] [!] 扩展 `graph-types.ts`：新增 SemanticEdgeRelation、SEMANTIC_EDGE_RELATIONS 注册表

**目标文件**: `src/panoramic/graph/graph-types.ts`

**输入**: plan.md §4（Schema v2.0 类型合同）· FR-001 · FR-006 · FR-007

**输出**:
- 新增 `SemanticEdgeRelation` 类型：`'references' | 'conceptually_related_to' | 'rationale_for'`
- 新增 `SEMANTIC_EDGE_RELATIONS` const 对象（供 direction-audit 白名单使用）
- `GraphEdge.relation` 字段类型保持 `string`（兼容旧值），注释说明新增允许值

**验收**: `npm run build` 零类型错误；`tsc --noEmit` 可通过；`SEMANTIC_EDGE_RELATIONS` 三个 key 均可从模块导入

**映射**: FR-001 · FR-007 · AC-012

**依赖**: 无

---

### T002 [x] [S] 扩展 `graph-types.ts`：GraphEdge 新增 optional evidence 字段

**目标文件**: `src/panoramic/graph/graph-types.ts`

**输入**: T001 · plan.md §4 · FR-002 · FR-003 · FR-004 · FR-006

**输出**:
- `GraphEdge` 接口追加字段：
  - `evidenceText?: string`（最大 200 字符，`INFERRED`/`AMBIGUOUS` 时非空）
  - `evidenceSource?: string`（格式 `"repo-relative-path:startLine-endLine"`）
- 已有字段（`source`, `target`, `relation`, `confidence`, `confidenceScore`）保持不变

**验收**: `npm run build` 零错误；现有消费 `GraphEdge` 的文件（`graph-query.ts`、`graph-builder.ts`）无需修改即通过类型检查

**映射**: FR-002 · FR-003 · FR-004 · FR-006 · NFR-006

**依赖**: T001

---

### T003 [x] [S] 扩展 `graph-types.ts`：新增 Hyperedge 接口 + 扩展 GraphJSON

**目标文件**: `src/panoramic/graph/graph-types.ts`

**输入**: T002 · plan.md §4 · FR-005 · FR-006 · FR-020

**输出**:
- 新增 `Hyperedge` 接口：`{ id: string; label: string; nodes: string[]; rationale: string; confidence: ConfidenceLevel; }`
- `GraphJSON.graph.schemaVersion` 从字面量 `'1.0'` 扩展为联合类型 `'1.0' | '2.0'`
- `GraphJSON` 顶层新增 `hyperedges?: Hyperedge[]`（optional，保持 v1.0 兼容）

**验收**: `npm run build` 零错误；`GraphJSON` 现有消费方代码（`graph-query.ts`）零改动通过类型检查；`schemaVersion: '1.0'` 的旧 fixture 仍可赋值给 `GraphJSON` 类型

**映射**: FR-005 · FR-006 · FR-020 · NFR-006 · AC-012

**依赖**: T002

---

### T004 [x] [S] 新增 `graph-v1.json` golden-master fixture（v1.0 格式）

**目标文件**: `tests/fixtures/graph-v1.json`

**输入**: T003 · plan.md §8（Golden-Master Fixture 规范）· FR-008

**输出**:
- 新建 v1.0 格式 JSON fixture
- 包含字段：`directed`, `multigraph`, `graph.schemaVersion: "1.0"`, `nodes[]`（至少 2 个节点）, `links[]`（至少 1 条 `imports` 边，含 `confidence: "EXTRACTED"`、`confidenceScore: 0.95`）
- 不含 `hyperedges`，不含 `evidenceText`/`evidenceSource` 字段

**验收**: JSON 文件可被 `JSON.parse` 解析；格式与 plan.md §8 示例对齐

**映射**: FR-008 · NFR-004 · NFR-006 · AC-009

**依赖**: T003

---

### T005 [x] [S] 新增 `graph-v2.json` golden-master fixture（v2.0 格式）

**目标文件**: `tests/fixtures/graph-v2.json`

**输入**: T003 · plan.md §8（Golden-Master Fixture 规范）· FR-005 · FR-008

**输出**:
- 新建 v2.0 格式 JSON fixture
- 包含字段：`graph.schemaVersion: "2.0"`；`links[]` 包含至少 1 条 `references` 边（带 `evidenceText`、`evidenceSource: "specs/ingestion.md:15-18"`、`confidence: "INFERRED"`）；`hyperedges[]` 包含至少 1 个 hyperedge（`id: "he-001"`, `label: "全量摄取"`, `nodes: ["src/a.ts", "src/b.ts", "specs/doc.md"]`, `rationale: "..."`, `confidence: "INFERRED"`）

**验收**: JSON 文件可被 `JSON.parse` 解析；`evidenceSource` 格式符合 `path:startLine-endLine`；hyperedge `label` ≤ 8 字符；`nodes` ≥ 3 个

**映射**: FR-005 · FR-008 · NFR-004 · AC-009

**依赖**: T004

---

### T006 [x] [S] 新增 `graph-types-v2.test.ts`：schema 单测（v1.0 + v2.0 双版本 fixture 验证）

**目标文件**: `tests/panoramic/graph-types-v2.test.ts`

**输入**: T003 · T005 · plan.md §8（测试策略）· FR-006 · FR-008

**输出**:
- 测试用例 1：读取 `tests/fixtures/graph-v1.json`，验证可赋值给 `GraphJSON` 类型，`schemaVersion` 为 `'1.0'`，无 `hyperedges` 字段
- 测试用例 2：读取 `tests/fixtures/graph-v2.json`，验证可赋值给 `GraphJSON` 类型，`schemaVersion` 为 `'2.0'`，`hyperedges` 非空
- 测试用例 3：验证 v2.0 fixture 中 `evidenceText` 字段长度 ≤ 200 字符
- 测试用例 4：验证 v2.0 fixture 中 hyperedge 结构合规（`label` ≤ 8 字符、`nodes.length >= 3`、`rationale` 非空）
- 测试用例 5：验证 `schemaVersion: '1.0'` 和 `'2.0'` 均可赋值给 `GraphJSON['graph']['schemaVersion']` 类型（编译期验证，via as const）

**验收**: `npx vitest run tests/panoramic/graph-types-v2.test.ts` 全部通过；新增测试计数 ≥ 5

**映射**: FR-006 · FR-008 · NFR-004 · AC-009

**依赖**: T005

---

### T007 [x] [S] 扩展 `direction-audit.ts`：白名单注册 3 种新边类型

**目标文件**: `src/cli/commands/direction-audit.ts`

**输入**: T001 · plan.md §4（direction-audit 白名单扩展说明）· FR-007

**输出**:
- 导入 `SEMANTIC_EDGE_RELATIONS` 常量（来自 `graph-types.ts`）
- 扩展 `classifyEdge()` 函数：对 `relation` 属于 `['references', 'conceptually_related_to', 'rationale_for']` 的边，若 source 或 target 至少一侧为文档类节点（`spec/document`）则分类为 `skipped`
- 在 direction-audit 帮助文本或注释中注明 3 种新边类型

**验收**: `npm run build` 零错误；`npx vitest run` 不引入新失败；对 `graph-v2.json` fixture 调用 direction-audit 相关函数时，新边类型分类为 `skipped` 而非 `incorrect`

**映射**: FR-007 · AC-010 · AC-012

**依赖**: T003

---

### T008 [x] [S] [!] 扩展 direction-audit 集成测试：新边类型不触发违规

**目标文件**: `tests/integration/direction-audit.test.ts`（现有文件，添加用例）

**输入**: T007 · T005 · FR-007

**输出**:
- 新增测试用例：加载 `tests/fixtures/graph-v2.json`，执行 direction-audit 核心逻辑，断言 `references`/`conceptually_related_to`/`rationale_for` 三种边类型的分类结果均为 `skipped`
- 断言 `incorrect` 列表中不包含这三种边类型的边

**验收**: `npx vitest run tests/integration/direction-audit.test.ts` 全部通过，无新失败；AC-010 场景可验证

**映射**: FR-007 · AC-010 · AC-012

**依赖**: T007

**Commit 1 完成门**：T001–T008 全部通过 `npx vitest run` + `npm run build` 零错误后，方可进入 Commit 2。

---

## Commit 2 — Story 2 主体（anchoring 模块 + Local Provider · P1）

> **目标**：实现 Hybrid Chunking + Local Embedding + 边生成完整链路，BudgetGate 集成。Local Provider 使用 `@huggingface/transformers`。

**独立测试**：在 `tests/fixtures/design-doc-project/` fixture 上验证 `anchorDocToCode()` 输出 ≥10 条语义边，每条 `INFERRED` 边含非空 `evidenceText`。

---

### T009 [x] [S] 新增 `package.json` optionalDependencies（@huggingface/transformers）

**目标文件**: `package.json`

**输入**: plan.md §2（Primary Dependencies）· FR-011 · NFR-005

**输出**:
- `optionalDependencies` 新增 `"@huggingface/transformers": "^3.x"`
- 不添加到 `dependencies`（主安装流程不因包缺失而失败）

**验收**: `npm install` 后 `optionalDependencies` 字段存在且值正确；`npm install --ignore-optional` 不报错

**映射**: FR-011 · NFR-005

**依赖**: T001（Commit 1 完整通过）

---

### T010 [x] [P] 新增 `embedding-provider.ts`：EmbeddingProvider 接口 + TokenUsage 类型

**目标文件**: `src/panoramic/anchoring/embedding-provider.ts`

**输入**: plan.md §4（EmbeddingProvider 接口）· FR-010 · FR-016 · NFR-003

**输出**:
- `EmbeddingTokenUsage` 接口：`{ llmModel: string; inputTokens?: number; outputTokens?: number; durationMs: number; }`
- `EmbedResult` 接口：`{ vectors: Float32Array[]; tokenUsage: EmbeddingTokenUsage; }`
- `EmbeddingProvider` 接口（Strategy Pattern）：`{ providerName: 'local' | 'openai'; llmModelLabel: string; dimensions: number; embed(texts: string[]): Promise<EmbedResult>; }`

**验收**: `npm run build` 零错误；类型文件可被其他模块导入

**映射**: FR-010 · FR-016 · NFR-003

**依赖**: T001（Commit 1 完整通过）

---

### T011 [x] [P] 新增 `chunker.ts`：Hybrid Chunking 实现

**目标文件**: `src/panoramic/anchoring/chunker.ts`

**输入**: plan.md §4（DocChunk 类型）· FR-009 · NFR-007

**输出**:
- `DocChunk` 接口：`{ filePath: string; startLine: number; endLine: number; headingPath: string; text: string; tokenCount: number; }`
- `DocChunkerOptions` 接口：`{ maxTokens?: number; }`（默认 512）
- `chunkMarkdownFiles(filePaths: string[], projectRoot: string, options?: DocChunkerOptions): DocChunk[]`
  - 以 H2/H3 标题为主边界，段落合并为辅
  - `markdownFiles` 为空时直接返回 `[]`（零 doc chunk 降级，FR-015）
  - 每个 chunk 记录 `startLine`/`endLine`（1-based）

**验收**: `npm run build` 零错误；模块可被 `index.ts` 导入

**映射**: FR-009 · FR-015 · NFR-007

**依赖**: T001

---

### T012 [x] [P] 新增 `chunker.test.ts`：Hybrid Chunking 单测

**目标文件**: `tests/panoramic/anchoring/chunker.test.ts`

**输入**: T011 · plan.md §8（测试策略）· FR-009 · FR-015

**输出**:
- 测试用例 1：正常 markdown 文件，H2/H3 边界正确分割
- 测试用例 2：段落合并，相邻段落合并到同一 chunk（不超 512 tokens）
- 测试用例 3：超长单段落，超过 512 tokens 时截断
- 测试用例 4：`startLine`/`endLine` 记录正确（1-based）
- 测试用例 5：空文件/空路径列表，返回 `[]` 不报错（FR-015 降级场景）

**验收**: `npx vitest run tests/panoramic/anchoring/chunker.test.ts` 全部通过

**映射**: FR-009 · FR-015 · NFR-004

**依赖**: T011

---

### T013 [x] [S] 新增 `providers/local-provider.ts`：LocalEmbeddingProvider

**目标文件**: `src/panoramic/anchoring/providers/local-provider.ts`

**输入**: T010 · plan.md §4（Local Provider 风险缓解）· FR-011 · FR-016 · NFR-005

**输出**:
- `LocalEmbeddingProvider` 类实现 `EmbeddingProvider` 接口
  - `providerName: 'local'`，`llmModelLabel: 'local-embedding'`，`dimensions: 384`
  - `embed(texts)` 方法：
    - 动态导入 `@huggingface/transformers`（`try { await import(...) } catch` 包裹）
    - 加载失败时抛出含安装指引的 `Error`（FR-011）
    - 使用 `all-MiniLM-L6-v2` 模型
    - `tokenUsage` 记录：`llmModel: 'local-embedding'`、`durationMs`（`performance.now()` 精确计时）、`inputTokens`（字符数 / 4 粗估）、`outputTokens: 0`

**验收**: `npm run build` 零错误；模块导入不会在 `@huggingface/transformers` 缺失时同步 crash

**映射**: FR-011 · FR-016 · NFR-003 · NFR-005

**依赖**: T010

---

### T014 [x] [P] 新增 `local-provider.test.ts`：Local Provider 单测（mock ONNX）

**目标文件**: `tests/panoramic/anchoring/providers/local-provider.test.ts`

**输入**: T013 · plan.md §8（测试策略）· FR-011 · FR-016

**输出**:
- 测试用例 1：`vi.mock('@huggingface/transformers')` 模拟模块不可用，验证 `embed()` 抛出包含安装指引的 `Error`
- 测试用例 2：模块可用时，`embed()` 返回 `EmbedResult`，`tokenUsage.llmModel === 'local-embedding'`
- 测试用例 3：`tokenUsage.durationMs` 为正数
- 测试用例 4：`tokenUsage.outputTokens === 0`

**验收**: `npx vitest run tests/panoramic/anchoring/providers/local-provider.test.ts` 全部通过

**映射**: FR-011 · FR-016 · NFR-004 · AC-011

**依赖**: T013

---

### T015 [x] [S] 新增 `similarity.ts`：Cosine 相似度计算 + 阈值过滤

**目标文件**: `src/panoramic/anchoring/similarity.ts`

**输入**: T010 · plan.md §6（similarity.ts 接口签名）· FR-012 · NFR-007

**输出**:
- `cosineSimilarity(a: Float32Array, b: Float32Array): number`（Float32Array 优化）
- `SimilarPair` 接口：`{ chunkIndex: number; nodeId: string; similarity: number; }`
- `filterByThreshold(chunkVectors, nodeVectors: Map<string, Float32Array>, threshold): SimilarPair[]`
  - `similarity >= threshold` 时纳入结果（含边界值，FR-012）
  - `chunkVectors` 或 `nodeVectors` 为空时返回 `[]`

**验收**: `npm run build` 零错误

**映射**: FR-012 · NFR-007

**依赖**: T010

---

### T016 [x] [P] 新增 `similarity.test.ts`：threshold 边界值单测

**目标文件**: `tests/panoramic/anchoring/similarity.test.ts`

**输入**: T015 · FR-012

**输出**:
- 测试用例 1：similarity 0.80 >= threshold 0.75，生成 pair
- 测试用例 2：similarity 0.75 >= threshold 0.75（含边界），生成 pair
- 测试用例 3：similarity 0.7499 < threshold 0.75，不生成 pair
- 测试用例 4：空 chunkVectors，返回 `[]` 不报错
- 测试用例 5：空 nodeVectors Map，返回 `[]` 不报错

**验收**: `npx vitest run tests/panoramic/anchoring/similarity.test.ts` 全部通过

**映射**: FR-012 · NFR-004

**依赖**: T015

---

### T017 [x] [S] 新增 `edge-builder.ts`：语义边生成 + evidenceText 截断算法

**目标文件**: `src/panoramic/anchoring/edge-builder.ts`

**输入**: T015 · plan.md §6（edge-builder.ts 接口签名）· plan.md §9（Risk 8 截断算法）· FR-003 · FR-004 · FR-013 · FR-014

**输出**:
- `BuildEdgesOptions` 接口（含 `chunks`, `pairs`, `projectRoot`, `maxEvidenceLength?`）
- `buildSemanticEdges(options): GraphEdge[]`：
  - 边类型选择：直接引用函数 → `references`；概念相关 → `conceptually_related_to`（不生成 `rationale_for`，FR-013）
  - 去重：同一 `(source, target, relation)` 保留 confidence 最高版本（FR-014）
  - `confidence === 'INFERRED'` 时强制 `evidenceText` 非空，否则丢弃该边（Risk 1 缓解）
  - `evidenceText` 对称扩展截断算法（从 match 位置向两侧扩展，heading 行整行纳入，plan §9 算法）
  - `evidenceSource` 格式：`${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`（repo-relative）

**验收**: `npm run build` 零错误

**映射**: FR-003 · FR-004 · FR-013 · FR-014 · NFR-007

**依赖**: T015

---

### T018 [x] [P] 新增 `edge-builder.test.ts`：边生成逻辑单测

**目标文件**: `tests/panoramic/anchoring/edge-builder.test.ts`

**输入**: T017 · plan.md §8（测试策略）· FR-003 · FR-004 · FR-014

**输出**:
- 测试用例 1：去重逻辑——同一三元组出现 2 次，保留 confidence 最高的版本
- 测试用例 2：`confidence: 'INFERRED'` 且 `evidenceText` 为空字符串时，该边被丢弃（返回空数组）
- 测试用例 3：`evidenceText` 对称截断——超过 200 字符时，结果 ≤ 200 字符且包含 match 位置周边内容
- 测试用例 4：`evidenceSource` 格式正确（`path:startLine-endLine`，repo-relative）
- 测试用例 5：heading 行整行纳入（以 `##` 开头的行不被截断）

**验收**: `npx vitest run tests/panoramic/anchoring/edge-builder.test.ts` 全部通过

**映射**: FR-003 · FR-004 · FR-014 · NFR-004

**依赖**: T017

---

### T019 [x] [S] 新增 `tests/fixtures/design-doc-project/` fixture

**目标文件**: `tests/fixtures/design-doc-project/`（目录）

**输入**: plan.md §6（fixture 规范）· FR-009 · AC-002

**输出**:
- `tests/fixtures/design-doc-project/spec.md`：含 ≥3 个 H2/H3 章节，每章节 ≥2 段文字
- `tests/fixtures/design-doc-project/src/pipeline.ts`（≥2 个函数）
- `tests/fixtures/design-doc-project/src/ingestion.ts`（≥2 个函数）
- `tests/fixtures/design-doc-project/src/processor.ts`（≥2 个函数）
- 合计 ≥5 个代码函数节点，design-doc 与代码有明确语义关联（用于验证 ≥10 条语义边生成）

**验收**: 目录结构存在；`spec.md` 可被 `chunkMarkdownFiles` 正确分块

**映射**: FR-009 · NFR-004 · AC-002

**依赖**: T011

---

### T020 [x] [S] 新增 `anchoring/index.ts`：anchorDocToCode 编排函数 + BudgetGate 集成

**目标文件**: `src/panoramic/anchoring/index.ts`

**输入**: T010 · T011 · T013 · T015 · T017 · plan.md §6（index.ts 对外接口）· FR-015 · FR-016 · NFR-003

**输出**:
- `AnchorOptions` / `AnchorResult` 接口
- `anchorDocToCode(options: AnchorOptions): Promise<AnchorResult>` 编排函数：
  1. `chunkMarkdownFiles()` → 若 chunks 为空，提前返回 `{ edges: [], tokenUsage: {...}, stats: {...} }`（FR-015）
  2. `factory.createEmbeddingProvider()` → 获取 provider
  3. `provider.embed(chunkTexts)` → 获取 chunk 向量
  4. `filterByThreshold()` → 过滤相似对
  5. `buildSemanticEdges()` → 生成边
  6. 汇总 `tokenUsage` 并通过 BudgetGate 记录（NFR-003）

**验收**: `npm run build` 零错误；`anchorDocToCode` 在 chunks 为空时不调用 EmbeddingProvider

**映射**: FR-015 · FR-016 · NFR-003

**依赖**: T013 · T017

---

**Commit 2 完成门**：T009–T020 全部通过 `npx vitest run` + `npm run build` 零错误后，方可进入 Commit 3。

---

## Commit 3 — Story 2 fallback（OpenAI Provider + factory · P1）

> **目标**：实现 OpenAI embedding fallback provider 和工厂函数，通过环境变量切换。factory 不自动 fallback（FR-011 + NFR-002 要求）。

**独立测试**：`SPECTRA_EMBEDDING_PROVIDER=openai` 时 `createEmbeddingProvider()` 返回 OpenAI provider；`SPECTRA_EMBEDDING_PROVIDER` 未设置时返回 local provider。

---

### T021 [x] [S] 新增 `providers/openai-provider.ts`：OpenAI text-embedding-3-small Provider

**目标文件**: `src/panoramic/anchoring/providers/openai-provider.ts`

**输入**: T010 · plan.md §7（Commit 3 变更）· FR-010 · FR-016 · NFR-002

**输出**:
- `OpenAIEmbeddingProvider` 类实现 `EmbeddingProvider` 接口
  - `providerName: 'openai'`，`llmModelLabel: 'text-embedding-3-small'`，`dimensions: 1536`
  - `embed(texts)` 方法：直接 `fetch` OpenAI Embeddings API（无需 `openai` SDK）
  - `tokenUsage`：`llmModel: 'text-embedding-3-small'`、`inputTokens`（使用 API 返回的实际 usage 计数）、`outputTokens: 0`、`durationMs`
  - `OPENAI_API_KEY` 未设置时抛出清晰错误

**验收**: `npm run build` 零错误；不引入 `openai` SDK 包依赖

**映射**: FR-010 · FR-016 · NFR-002 · NFR-003

**依赖**: T010（T020 已完成）

---

### T022 [x] [P] 新增 `openai-provider.test.ts`：OpenAI Provider 单测（mock fetch）

**目标文件**: `tests/panoramic/anchoring/providers/openai-provider.test.ts`

**输入**: T021 · FR-010 · FR-016

**输出**:
- 测试用例 1：mock `fetch`，返回合法 embedding 响应，验证 `embed()` 返回正确 `EmbedResult`
- 测试用例 2：`tokenUsage.inputTokens` 等于 API 响应中的 `usage.prompt_tokens`
- 测试用例 3：`OPENAI_API_KEY` 未设置时，`embed()` 抛出包含提示信息的错误
- 测试用例 4：API 请求失败（HTTP 500）时，`embed()` 抛出错误不静默失败

**验收**: `npx vitest run tests/panoramic/anchoring/providers/openai-provider.test.ts` 全部通过

**映射**: FR-010 · FR-016 · NFR-004

**依赖**: T021

---

### T023 [x] [S] 新增 `providers/factory.ts`：createEmbeddingProvider 工厂函数

**目标文件**: `src/panoramic/anchoring/providers/factory.ts`

**输入**: T013 · T021 · plan.md §7（factory 设计决策）· FR-010 · NFR-002

**输出**:
- `createEmbeddingProvider(): EmbeddingProvider` 函数：
  - 读取 `process.env.SPECTRA_EMBEDDING_PROVIDER`（默认 `'local'`）
  - `'local'` → 返回 `LocalEmbeddingProvider` 实例
  - `'openai'` → 返回 `OpenAIEmbeddingProvider` 实例
  - 未知值 → 抛出清晰错误
  - **不自动 fallback**（local 加载失败时不自动切换 openai，NFR-002）

**验收**: `npm run build` 零错误；factory 函数可被 `anchoring/index.ts` 正确调用

**映射**: FR-010 · NFR-002

**依赖**: T013 · T021

---

### T024 [x] [P] 新增 `factory.test.ts`：环境变量切换单测

**目标文件**: `tests/panoramic/anchoring/providers/factory.test.ts`

**输入**: T023 · FR-010

**输出**:
- 测试用例 1：`SPECTRA_EMBEDDING_PROVIDER` 未设置，`createEmbeddingProvider()` 返回 `providerName === 'local'` 的实例
- 测试用例 2：`SPECTRA_EMBEDDING_PROVIDER=local`，返回 local provider
- 测试用例 3：`SPECTRA_EMBEDDING_PROVIDER=openai`，返回 `providerName === 'openai'` 的实例
- 测试用例 4：未知值（如 `'voyage'`），抛出错误

**验收**: `npx vitest run tests/panoramic/anchoring/providers/factory.test.ts` 全部通过

**映射**: FR-010 · NFR-004

**依赖**: T023

---

**Commit 3 完成门**：T021–T024 全部通过 `npx vitest run` + `npm run build` 零错误后，方可进入 Commit 4。

---

## Commit 4 — Story 3（hyperedges 模块 + feature flag · P1）

> **目标**：实现 LLM hyperedge 提取全链路，受 feature flag 保护（`SPECTRA_HYPEREDGES_ENABLED` + `--hyperedges`），Zod 校验失败静默降级。

**独立测试**：feature flag 关闭时不执行 LLM 调用；feature flag 开启且 LLM mock 返回合法结构时，`extractHyperedges()` 返回 hyperedge 数组；Zod 校验全失败时返回空数组不抛出异常。

---

### T025 [x] [S] 新增 `hyperedges/schema.ts`：Zod schema 定义

**目标文件**: `src/panoramic/hyperedges/schema.ts`

**输入**: plan.md §4（HyperedgesOutputSchema）· FR-018 · FR-019 · FR-020

**输出**:
- `HyperedgeSchema`：`z.object({ label: z.string().min(1).max(8), nodes: z.array(z.string()).min(3), rationale: z.string().min(1).max(200), confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']) })`
- `HyperedgesOutputSchema`：`z.object({ hyperedges: z.array(HyperedgeSchema).max(10) })`（每 batch ≤ 10，FR-018）
- `HyperedgeOutput` 类型：`z.infer<typeof HyperedgesOutputSchema>`

**验收**: `npm run build` 零错误；Zod schema 可被其他模块导入

**映射**: FR-018 · FR-019 · FR-020

**依赖**: T003（Commit 1 的 Hyperedge 类型已存在）

---

### T026 [x] [P] 新增 `schema.test.ts`：Zod schema 边界值测试

**目标文件**: `tests/panoramic/hyperedges/schema.test.ts`

**输入**: T025 · FR-018 · FR-019 · FR-020

**输出**:
- 测试用例 1：`label` > 8 字符 → `safeParse` 失败
- 测试用例 2：`nodes` 长度 < 3 → `safeParse` 失败
- 测试用例 3：`rationale` 为空字符串 → `safeParse` 失败
- 测试用例 4：`hyperedges` 数组超过 10 个 → `safeParse` 失败（FR-018）
- 测试用例 5：合法结构（label ≤ 8 字、nodes ≥ 3、rationale 非空）→ `safeParse` 成功

**验收**: `npx vitest run tests/panoramic/hyperedges/schema.test.ts` 全部通过

**映射**: FR-018 · FR-019 · FR-020 · NFR-004

**依赖**: T025

---

### T027 [x] [S] 新增 `hyperedges/prompt.ts`：LLM prompt 构造

**目标文件**: `src/panoramic/hyperedges/prompt.ts`

**输入**: T025 · plan.md §7（Commit 4 变更）· FR-017 · FR-021

**输出**:
- `buildHyperedgePrompt(nodes: GraphNode[], docChunks: DocChunk[], projectSummary?: string): string`：
  - `nodes` 最多取 20 个（仅 `sourceKind !== 'doc-section'` 的代码节点，FR-021）
  - `docChunks` 最多取 10 个
  - prompt 体积控制在 4000 tokens 以内
  - prompt 明确指示 LLM："每次最多输出 10 个 hyperedge"（FR-018）
  - prompt 明确指示：`rationale_for` 边的生成条件（Q1 澄清）

**验收**: `npm run build` 零错误；`buildHyperedgePrompt` 函数签名与 plan §4 对齐

**映射**: FR-017 · FR-018 · FR-021

**依赖**: T025

---

### T028 [x] [S] 新增 `hyperedges/extractor.ts`：LLM 调用 + Zod 校验 + BudgetGate 集成

**目标文件**: `src/panoramic/hyperedges/extractor.ts`

**输入**: T025 · T027 · plan.md §4（extractor.ts 接口）· FR-017 · FR-019 · FR-020 · NFR-003

**输出**:
- `ExtractHyperedgesOptions` / `ExtractResult` 接口
- `extractHyperedges(options): Promise<ExtractResult>` 函数：
  1. 检查 feature flag（`SPECTRA_HYPEREDGES_ENABLED` 环境变量 + `--hyperedges` CLI 选项）；flag 未启用时直接返回空结果，不调用 LLM（FR-017）
  2. 过滤 `nodes`：仅传入 `sourceKind !== 'doc-section'` 的代码节点（FR-021）
  3. `buildHyperedgePrompt()` 构造 prompt
  4. 通过 BudgetGate + Anthropic SDK 调用 LLM（JSON mode，NFR-003）
  5. `HyperedgesOutputSchema.safeParse()` 校验；失败时将原始输出存入 `failedSamples`，trace 日志记录（FR-019）
  6. 过滤：`nodes` 中至少 1 个代码节点（FR-020）
  7. 汇总 `tokenUsage`，返回 `ExtractResult`

**验收**: `npm run build` 零错误；feature flag 关闭时不执行 LLM 调用（可通过 spy 验证）

**映射**: FR-017 · FR-019 · FR-020 · NFR-003

**依赖**: T027

---

### T029 [x] [P] 新增 `extractor.test.ts`：LLM 调用 + 降级 + BudgetGate 单测

**目标文件**: `tests/panoramic/hyperedges/extractor.test.ts`

**输入**: T028 · plan.md §8（测试策略）· FR-017 · FR-019 · FR-020

**输出（5 个分支测试用例）**:
- 测试用例 1：feature flag 关闭（环境变量未设置）→ Anthropic SDK 不被调用，返回 `{ hyperedges: [], ... }`
- 测试用例 2：feature flag 开启，LLM mock 返回合法结构 → 返回 hyperedge 数组
- 测试用例 3：LLM 返回非法结构（Zod 校验失败）→ 返回 `{ hyperedges: [], failedSamples: [...] }` 不抛出异常
- 测试用例 4：LLM 返回超过 10 个 hyperedge → Zod schema 拒绝（`max(10)`），返回空数组
- 测试用例 5：所有 `nodes` 均为 doc-section 节点 → 过滤后返回空数组（FR-020 至少 1 个代码节点）

**验收**: `npx vitest run tests/panoramic/hyperedges/extractor.test.ts` 全部通过

**映射**: FR-017 · FR-019 · FR-020 · NFR-004

**依赖**: T028

---

### T030 [x] [S] 新增 `hyperedges/index.ts`：模块对外接口

**目标文件**: `src/panoramic/hyperedges/index.ts`

**输入**: T028 · FR-017

**输出**:
- 从 `extractor.ts` re-export `extractHyperedges`、`ExtractHyperedgesOptions`、`ExtractResult`
- 从 `schema.ts` re-export `HyperedgesOutputSchema`、`HyperedgeOutput`

**验收**: `npm run build` 零错误；外部模块可通过 `import from 'src/panoramic/hyperedges'` 访问公开接口

**映射**: FR-017

**依赖**: T028

---

### T031 [x] [S] 新增 `tests/fixtures/pure-code-project/` fixture：零 markdown 降级测试

**目标文件**: `tests/fixtures/pure-code-project/`（目录）

**输入**: plan.md §7（Commit 4 验收）· FR-015 · AC-005

**输出**:
- 目录中包含 ≥5 个 `.ts` 文件（`src/a.ts`, `src/b.ts`, `src/c.ts`, `src/d.ts`, `src/e.ts`），每个文件含 1-2 个简单函数
- 目录中零 `.md` 文件

**验收**: 目录结构存在；`chunkMarkdownFiles([])` 在此 fixture 上返回 `[]`

**映射**: FR-015 · NFR-004 · AC-005

**依赖**: T011

---

### T032 [x] [S] 修改 `doc-graph-builder.ts`：添加 anchoring + hyperedges 协调调用入口

**目标文件**: `src/panoramic/builders/doc-graph-builder.ts`

**输入**: T020 · T030 · plan.md §2（数据流序列）· FR-015 · FR-017

**输出**:
- 在主构建流程中调用 `anchorDocToCode()`（Step 2）：将生成的语义边追加到 `graph.json links[]`
- 在主构建流程中调用 `extractHyperedges()`（Step 3，仅当 feature flag 启用）：将 hyperedge 写入 `graph.json hyperedges[]`
- `schemaVersion` 写入 `"2.0"`
- feature flag 读取：检查 `SPECTRA_HYPEREDGES_ENABLED` 环境变量和 `--hyperedges` CLI 选项

**验收**: `npm run build` 零错误；feature flag 未启用时 `extractHyperedges` 不被调用（可 spy 验证）；新增代码 ≤ 50 行（plan.md 约束）

**映射**: FR-015 · FR-017 · AC-001

**依赖**: T020 · T030

---

**Commit 4 完成门**：T025–T032 全部通过 `npx vitest run` + `npm run build` 零错误后，方可进入 Commit 5。

---

## Commit 5 — Story 4（MCP 工具适配 + graph_hyperedges + SKILL.md · P1）

> **目标**：新增 `graph_hyperedges` MCP 工具，适配 `graph_node` 返回语义边字段，更新 SKILL.md。

**独立测试**：调用 `graph_hyperedges({ label: "Ingestion" })` 过滤返回子集；调用 `graph_hyperedges({ node_id: "<id>" })` 返回包含该节点的 hyperedge；`graph_node` 返回关联语义边（含 `evidenceText`）。

---

### T033 [x] [S] 修改 `graph-tools.ts`：新增 graph_hyperedges MCP 工具

**目标文件**: `src/mcp/graph-tools.ts`

**输入**: T003 · plan.md §4（graph_hyperedges 工具签名）· FR-022 · FR-023

**输出**:
- 注册新工具 `graph_hyperedges`，参数 schema：
  - `label?: string`（substring 模糊匹配 `hyperedge.label`）
  - `node_id?: string`（精确匹配 `hyperedge.nodes[]` 中的元素）
  - `limit?: number`（默认 20）
  - `projectRoot?: string`
- 响应结构：`{ hyperedges: Array<{id, label, nodes, rationale, confidence}>, total: number, filtered: boolean }`
- 两参数均不传时返回所有 hyperedge
- `graph.json` 中 `hyperedges` 为 `undefined` 时返回空列表不报错（AC-006 最后一个场景）

**验收**: `npm run build` 零错误；`registerGraphTools` 函数注册工具数量增加 1

**映射**: FR-022 · FR-023 · AC-006

**依赖**: T003（Commit 1 的类型）

---

### T034 [x] [S] 修改 `graph-tools.ts`：graph_node 工具适配 v2.0 语义边

**目标文件**: `src/mcp/graph-tools.ts`

**输入**: T033 · FR-024

**输出**:
- `graph_node` 工具响应中追加 `semanticEdges` 字段：当前节点关联的语义边列表（`relation` 为 `references`/`conceptually_related_to`/`rationale_for`），每条边包含 `source`, `target`, `relation`, `confidence`, `evidenceText?`, `evidenceSource?`
- 节点无关联语义边时返回 `semanticEdges: []`（不报错，FR-024）

**验收**: `npm run build` 零错误；现有 `graph_node` 工具测试不回归

**映射**: FR-024 · AC-006

**依赖**: T033

---

### T035 [x] [P] 新增 `graph-tools-v2.test.ts`：MCP 工具 v2.0 集成测试

**目标文件**: `tests/panoramic/graph-tools-v2.test.ts`

**输入**: T033 · T034 · plan.md §8（测试策略）· FR-022 · FR-023 · FR-024

**输出**:
- 测试用例 1：`graph_hyperedges` 不带参数，返回所有 hyperedge（使用 `graph-v2.json` fixture）
- 测试用例 2：`graph_hyperedges({ label: "摄取" })` 模糊匹配，返回匹配子集
- 测试用例 3：`graph_hyperedges({ node_id: "src/a.ts" })` 精确匹配，返回包含该节点的 hyperedge
- 测试用例 4：`hyperedges` 为空时，`graph_hyperedges()` 返回 `{ hyperedges: [], total: 0, filtered: false }`（AC-006）
- 测试用例 5：`graph_node` 返回 `semanticEdges` 字段，含 `evidenceText`（FR-024）

**验收**: `npx vitest run tests/panoramic/graph-tools-v2.test.ts` 全部通过

**映射**: FR-022 · FR-023 · FR-024 · NFR-004 · AC-006

**依赖**: T034

---

### T036 [x] [P] 修改 `plugins/spectra/skills/spectra/SKILL.md`：新增 graph_hyperedges 工具说明

**目标文件**: `plugins/spectra/skills/spectra/SKILL.md`

**输入**: T033 · FR-026

**输出**:
- 新增章节描述 `graph_hyperedges` 工具：用途（查询 hyperedge 超边）、输入参数（`label`/`node_id`/`limit`）、输出格式（`id`/`label`/`nodes`/`rationale`/`confidence`）
- 示例调用

**验收**: SKILL.md 文件包含 `graph_hyperedges` 关键词；Markdown 格式正确

**映射**: FR-026

**依赖**: T033

---

### T037 [x] [P] 修改 `plugins/spectra/skills/spectra-batch/SKILL.md`：新增 --hyperedges 选项说明

**目标文件**: `plugins/spectra/skills/spectra-batch/SKILL.md`

**输入**: T030 · FR-017 · FR-026

**输出**:
- 在 `spectra batch` 命令文档中新增 `--hyperedges` CLI 选项说明：用途（启用 LLM hyperedge 提取）、与环境变量 `SPECTRA_HYPEREDGES_ENABLED=true` 的关系

**验收**: SKILL.md 文件包含 `--hyperedges` 关键词；格式正确

**映射**: FR-017 · FR-026

**依赖**: T030

---

**Commit 5 完成门**：T033–T037 全部通过 `npx vitest run` + `npm run build` 零错误后，方可进入 Commit 6。

---

## Commit 6 — 端到端验证（回归 + 降级 + 完整链路 · 无新功能代码）

> **目标**：验证所有 AC 通过，不新增功能代码。包括 direction-audit 回归、纯代码降级、`doc-graph-builder.ts` 集成完整性核查。

---

### T038 [x] [P] 新增纯代码项目降级集成测试

**目标文件**: `tests/integration/pure-code-degradation.test.ts`（新建）

**输入**: T031 · T032 · FR-015 · AC-005

**输出**:
- 测试用例：以 `tests/fixtures/pure-code-project/` 为输入，调用完整的 anchoring 链路（含 `anchorDocToCode`）
- 断言：返回的 `edges` 数组为空
- 断言：返回的 `hyperedges` 数组为空（或不存在）
- 断言：流程不抛出未捕获异常，返回码 0（`process.exitCode` 未被设置为非 0）

**验收**: `npx vitest run tests/integration/pure-code-degradation.test.ts` 全部通过；AC-005 可验证

**映射**: FR-015 · AC-005 · NFR-004

**依赖**: T031 · T032

---

### T039 [x] [P] direction-audit 回归验证：v2.0 fixture 零违规断言

**目标文件**: `tests/integration/direction-audit.test.ts`（在 T008 基础上补充端到端断言）

**输入**: T008 · T005 · FR-007 · AC-010

**输出**:
- 补充测试用例：完整调用 `runDirectionAuditCommand`（或其核心逻辑）以 `graph-v2.json` 为输入，断言：
  - 返回码为 0
  - 输出不含 "direction violation" 类错误
  - 所有 `references`/`conceptually_related_to`/`rationale_for` 边分类为 `skipped`

**验收**: `npx vitest run tests/integration/direction-audit.test.ts` 全部通过；AC-010 可验证

**映射**: FR-007 · AC-010

**依赖**: T008

---

### T040 [x] [S] 核查 `doc-graph-builder.ts` 端到端集成完整性

**目标文件**: `src/panoramic/builders/doc-graph-builder.ts`（核查，必要时补充）

**输入**: T032 · plan.md §7（Commit 6 变更）· AC-001 · AC-002 · AC-007 · AC-008

**输出**:
- 确认 `anchorDocToCode()` 调用入口完整：语义边正确追加到 `graph.json links[]`
- 确认 `extractHyperedges()` 调用入口完整：hyperedge 正确写入 `graph.json hyperedges[]`
- 确认 `schemaVersion: "2.0"` 写入
- 确认 `doc-graph-builder.ts` 中死代码 `extractModuleSpecMetadata`（plan.md §3 提及的潜在死代码）评估：若本次改动未触及该函数，保留现状；若有清晰证据表明确实为死代码，同一 commit 内一并清理

**验收**:
- `npm run build` 零错误（AC-008）
- `npx vitest run` 全量零失败（AC-007）
- `graph-v2.json` fixture 中 `schemaVersion` 为 `"2.0"`（AC-001）
- 端到端 anchoring 链路输出 ≥10 条语义边（AC-002，可使用 `design-doc-project` fixture 验证）

**映射**: AC-001 · AC-002 · AC-007 · AC-008 · NFR-004

**依赖**: T032 · T038 · T039

---

## FR 覆盖映射表

| FR 编号 | 功能需求摘要 | 对应 Task |
|---------|------------|----------|
| FR-001 | 新增 SemanticEdgeRelation 枚举值 | T001 |
| FR-002 | confidence 枚举字段（EXTRACTED / INFERRED / AMBIGUOUS） | T001 · T002 |
| FR-003 | INFERRED 和 AMBIGUOUS 边强制 evidenceText 非空 | T002 · T017 |
| FR-004 | evidenceSource 格式（repo-relative path:startLine-endLine） | T002 · T017 |
| FR-005 | graph.json 新增 hyperedges[] 顶层字段 | T003 |
| FR-006 | schemaVersion 联合类型 + optional 新字段 | T001 · T002 · T003 |
| FR-007 | direction-audit 白名单注册 3 种新边类型 | T007 · T008 |
| FR-008 | golden-master fixture（v1.0 + v2.0 双版本） | T004 · T005 · T006 |
| FR-009 | Hybrid Chunking（H2/H3 边界 + 512 tokens + startLine/endLine） | T011 · T012 |
| FR-010 | EmbeddingProvider 接口 + 环境变量切换 | T010 · T021 · T023 · T024 |
| FR-011 | Local Provider（@huggingface/transformers + 加载失败清晰错误） | T013 · T014 |
| FR-012 | cosine 相似度 >= 阈值（含边界）生成边 | T015 · T016 |
| FR-013 | embedding 只生成 references/conceptually_related_to（不生成 rationale_for） | T017 |
| FR-014 | 同一三元组去重（保留 confidence 最高版本） | T017 · T018 |
| FR-015 | 零 doc chunk 时诚实降级（零边、零 hyperedge、不报错） | T011 · T020 · T038 |
| FR-016 | 所有 embedding 调用记录 tokenUsage（含 local 模式） | T010 · T013 · T014 · T020 |
| FR-017 | feature flag 双入口（env + CLI），默认关闭 | T028 · T029 · T032 · T037 |
| FR-018 | 每 batch hyperedge ≤ 10 | T025 · T026 · T027 |
| FR-019 | Zod 校验失败静默丢弃 + trace 日志 + 全失败返回空数组 | T025 · T028 · T029 |
| FR-020 | hyperedge 合法性校验（label ≤ 8 字、nodes ≥ 3 且至少 1 代码节点） | T003 · T025 · T026 · T028 · T029 |
| FR-021 | hyperedge 提取仅针对 design-doc 类型节点内容 | T027 · T028 |
| FR-022 | 新增 graph_hyperedges MCP 工具（label 模糊 + node_id 精确过滤） | T033 · T035 |
| FR-023 | graph_hyperedges 响应包含完整 hyperedge 字段 | T033 · T035 |
| FR-024 | graph_node 适配 v2.0（返回关联语义边含 evidence 字段） | T034 · T035 |
| FR-025 | graph_community 适配（可选） | [可选，未列入必要 Task，可在 Polish 阶段追加] |
| FR-026 | SKILL.md 更新（graph_hyperedges 工具说明 + --hyperedges 选项） | T036 · T037 |

**NFR 覆盖**:

| NFR 编号 | 非功能需求 | 对应 Task |
|---------|-----------|---------|
| NFR-001 | Local Embedding 冷启动 < 30s，单 chunk 推理 < 200ms | T013（运行时行为，无独立测试 Task） |
| NFR-002 | Local 零 API 成本；factory 不自动 fallback | T021 · T023 |
| NFR-003 | 所有 LLM/embedding 调用通过 BudgetGate 记录 | T020 · T028 |
| NFR-004 | 单测覆盖 + golden-master fixture | T006 · T012 · T014 · T016 · T018 · T022 · T024 · T026 · T029 · T031 |
| NFR-005 | @huggingface/transformers 列为 optionalDependencies | T009 |
| NFR-006 | schema v2.0 新字段全部 optional，v1.0 向后兼容 | T002 · T003 · T006 |
| NFR-007 | 相似度阈值和 evidenceText 最大长度可配置 | T011 · T015 · T017 |

---

## 依赖与执行顺序

### Commit 间依赖

```
Commit 1（T001–T008）
  └── [必须先完成] → Commit 2（T009–T020）
                        └── [必须先完成] → Commit 3（T021–T024）
                                              └── [必须先完成] → Commit 4（T025–T032）
                                                                    └── [必须先完成] → Commit 5（T033–T037）
                                                                                          └── [必须先完成] → Commit 6（T038–T040）
```

### Commit 内并行机会

| Commit | 可并行组 |
|--------|---------|
| Commit 1 | T004 + T011（fixture 与 test 文件无依赖） |
| Commit 2 | T010 + T011 可同时开始（均依赖 T001，不共享文件）；T012 + T014 + T016 + T018 可与各自前置 Task 同时准备 |
| Commit 3 | T021 + T022 可同时进行（T022 对 T021 有 mock 依赖，但可提前准备测试框架）；T024 可与 T022 并行 |
| Commit 4 | T025 + T027 可同时进行；T026 可在 T025 完成后立即开始 |
| Commit 5 | T035 + T036 + T037 可并行（各自目标文件不同） |
| Commit 6 | T038 + T039 可并行 |

### 推荐执行策略

**MVP 优先路径**（单人开发）：
1. 完成 Commit 1（T001–T008）→ 独立验证 schema 和 direction-audit
2. 完成 Commit 2（T009–T020）→ 验证 Local Embedding 链路
3. 完成 Commit 3（T021–T024）→ 验证 OpenAI fallback 和 factory
4. 完成 Commit 4（T025–T032）→ 验证 hyperedge 提取
5. 完成 Commit 5（T033–T037）→ 验证 MCP 工具层
6. 完成 Commit 6（T038–T040）→ 端到端回归

**并行团队策略**（2+ 人）：
- Commit 1 共同完成（类型合同基础）
- Commit 2 和 Commit 3 可由不同成员并行准备（但 Commit 3 在 Commit 2 前不可合并）
- Commit 5 的 T036 + T037（SKILL.md 更新）可在 Commit 4 完成后独立执行

---

## Checkpoint 汇总

| Checkpoint | 完成条件 | 验收命令 |
|-----------|---------|---------|
| Commit 1 完成 | T001–T008 全部 ✓ | `npm run build` + `npx vitest run` 零失败 |
| Commit 2 完成 | T009–T020 全部 ✓ | `npm run build` + `npx vitest run` 零新增失败 |
| Commit 3 完成 | T021–T024 全部 ✓ | `npm run build` + `npx vitest run` 零新增失败 |
| Commit 4 完成 | T025–T032 全部 ✓ | `npm run build` + `npx vitest run` 零新增失败；feature flag 关闭时 LLM 不被调用 |
| Commit 5 完成 | T033–T037 全部 ✓ | `npm run build` + `npx vitest run` 零新增失败；SKILL.md 含 `graph_hyperedges` |
| Commit 6 完成（Feature 交付）| T038–T040 全部 ✓ | `npm run build` + `npx vitest run` 全量零失败；AC-001 到 AC-011 全部验证通过 |

---

*Tasks 版本：v1.0 | 生成者：tasks 子代理 | 基于 plan.md v1.0 + spec.md + clarify.md*
