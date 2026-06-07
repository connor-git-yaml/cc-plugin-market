# Feature 178 — 抽取共享纯函数 · 影响分析报告（Phase 1/5）

> 模式：refactor（5 阶段）｜目标：零行为变更的纯函数去重｜预算 ~1 天
> 设计来源：`docs/design/M7-stepback-revision.md` §1 F178
> 启动基线：master HEAD = `57ae7db`（≥ 要求）；与 F177 写入路径 disjoint

## 0. 重构目标（3 个独立提取，互不依赖）

| 批次 | 目标标识符 | 单一来源（提取后） | 调用方 |
|------|-----------|------------------|--------|
| A | `levenshtein` DP 实现 | `src/utils/string-distance.ts`（新建） | `query-helpers.ts`、`adr-evidence-verifier.ts` |
| B | `normalizeProjectPath`（batch 单参变体） | `src/batch/regen-plan.ts`（已有私有 → 改导出） | `delta-regenerator.ts`、`batch-orchestrator.ts` |
| C | `upsertEdge` / `upsertNode` / `edgeKey` | `src/panoramic/graph/graph-builder.ts`（文件内 helper） | buildKnowledgeGraph 五路数据源 |

## 1. 旧标识符 → 残留扫描清单（Phase 4 用）

重构后这些"私有副本"必须零残留：

- **levenshtein 私有定义**：
  - `src/knowledge-graph/query-helpers.ts:467` `function levenshtein(...)`（含 466 行"照搬"注释）
  - `src/panoramic/pipelines/adr-evidence-verifier.ts:168` `function levenshtein(...)`
- **normalizeProjectPath batch 单参副本**（`inputPath.split(path.sep).join('/')`）：
  - `src/batch/regen-plan.ts:85` `function normalizeProjectPath(inputPath)` → 升级为 `export`
  - `src/batch/delta-regenerator.ts:399` `function normalizeProjectPath(inputPath)` → 删除，import
  - `src/batch/batch-orchestrator.ts:434` `const normalizeProjectPath = (inputPath) => ...` → 删除，import

> ⚠️ 残留扫描需 **排除**以下不在范围的 `normalizeProjectPath`（双参变体 `(inputPath, projectRoot)`，先 `path.relative` 再 split，语义不同）：
> `src/panoramic/{cross-reference-index, builders/doc-graph-builder, pipelines/adr-decision-pipeline, pipelines/narrative-provenance-adapter, pipelines/coverage-auditor, pipelines/product-ux-docs, pipelines/docs-bundle-manifest-reader, pipelines/docs-quality-evaluator}.ts` 等 10+ 份 —— 标 **future-milestone**，本 Feature 不动。

## 2. 受影响文件清单（共 8 文件，无跨包 npm 依赖）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/utils/string-distance.ts` | 新建 | 单一 `levenshtein` 导出 + JSDoc |
| `tests/unit/string-distance.test.ts` | 新建 | RED 单测（边界 + DP 正确性） |
| `src/knowledge-graph/query-helpers.ts` | 改 | 删私有 levenshtein，import；调用点不变 |
| `src/panoramic/pipelines/adr-evidence-verifier.ts` | 改 | 删私有 levenshtein，import；调用点不变 |
| `src/batch/regen-plan.ts` | 改 | `normalizeProjectPath` 私有 → `export` |
| `src/batch/delta-regenerator.ts` | 改 | 删本地副本，从 regen-plan import |
| `src/batch/batch-orchestrator.ts` | 改 | 删本地 arrow 副本，从 regen-plan import |
| `src/panoramic/graph/graph-builder.ts` | 改 | 提取 `edgeKey`/`upsertEdge`/`upsertNode`，五路调用 |
| `tests/unit/graph/graph-builder-upsert.test.ts` | 新建 | upsert helper 单测 + byte-stable 回归 |

**影响文件数 = 9（含新建 3）** —— 远低于 100 阈值，风险评级 **low**。

## 3. 行为等价性论证（零行为变更的核心）

### Batch A — levenshtein
两份实现逻辑逐字等价（均为滚动数组、shorter/longer 分支、O(min(m,n)) 空间）。
`query-helpers.ts:467` 与 `adr-evidence-verifier.ts:168` 唯一差异是注释。
提取为单一实现后，两调用方 import，DP 数值结果不变 → `resolveSymbolFuzzy`（F174 fuzzy 热路径）
与 `snippetMatches`（ADR 证据校验）行为不变。

### Batch B — normalizeProjectPath（batch 单参）
三处实现逐字等价：`inputPath.split(path.sep).join('/')`。三文件均已 `import * as path from 'node:path'`。
合并到 regen-plan 导出后，纯字符串变换无状态，结果不变。

### Batch C — graph-builder upsert（🔴 byte-stable 硬门）
五路数据源边/节点写入拆为两类语义：

**(a) 同质 confidence-max-wins（边 4 路 / 节点 3 路）→ 提取 helper**
- `upsertEdge(edgeMap, edge, directed)`：`key = directed?directedEdgeKey:undirectedEdgeKey`，
  `!existing || edge.confidenceScore > existing.confidenceScore` 时覆盖。
  覆盖边路：DocGraph(124-131)、ArchitectureIR(198-204)、CrossReference(234-240)、Extraction(290-296)。
  等价性：四处原代码均用 `confidenceScore`（=构造时写入 `edge.confidenceScore`）比较，逐字一致。
- `upsertNode(nodeMap, node)`：`existing` 存在则 `node.metadata = {...existing.metadata, ...node.metadata}`，再 set。
  覆盖节点路：DocGraph specs(109)、ArchitectureIR(168-173)、Extraction(273-278)。
  等价性：DocGraph 是首个数据源，existing 恒 undefined → metadata 合并为 no-op → 与原"裸 set"逐字等价；
  ArchitectureIR/Extraction 与原"last-write-wins + metadata 合并"逐字一致。

**(b) 🔴 unifiedGraph 路（第 5 路）—— directional 合并语义不同，保留不动**
- 节点：first-write-wins（existing 仅扩展 `callSitesCount` 后 `continue`，不覆盖 kind/label）→ 与 (a) last-write-wins 相反，**保留内联**。
- 边：key 用 per-edge `isDirectional`（非全局 `directed`）；合并是"升级 directional 标志"（非 confidence 比较）→ **保留内联**。
- 「五路统一」落点：第 5 路的 **key 派生**改用共享 `edgeKey(source,target,relation,directed)`，
  与前 4 路统一；merge body 保留 directional 语义。这样 5 路都经 `edgeKey`，同时不破坏 byte-stable。

> **byte-stable 硬门**：提取前后 `buildKnowledgeGraph` 产物必须 byte-identical。
> 由 (a)(b) 等价性论证 + 新增 byte-stable 回归测试 + 既有 `tests/unit/graph-builder.test.ts` 全绿三重保证。

## 4. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| graph.json 产物漂移 | 🔴 high | byte-stable 回归测试 + 既有 graph-builder 测试 + 等价性逐行论证 |
| 误删/误改 panoramic 双参 normalizeProjectPath | mid | 残留扫描显式排除清单（§1 注） |
| F174 fuzzy resolveSymbolFuzzy 回归 | mid | 既有 query-helpers/fuzzy 测试全绿 + levenshtein 单测 |
| 与 F177 并行冲突 | low | 写入路径 disjoint（F177 改 `src/mcp/`） |

## 5. 顺序约束（交付协调）

- F178 触碰 `batch-orchestrator.ts`（normalizeProjectPath import）；F179 后续也碰同文件（`:1566` stripTimestamps）。
  → **F179 须在 F178 ship 后启动**，避免冲突。
