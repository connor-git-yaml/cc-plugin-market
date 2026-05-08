# Codebase Scan — Feature 155 Agent-Context MCP Tools

**Feature**: 155
**Branch**: 155-agent-context-mcp-tools
**Date**: 2026-05-08
**Mode**: codebase-scan（设计文档已成熟，仅扫描内部集成点）

参考设计文档：[docs/design/spectra-mcp-evolution.md](../../../docs/design/spectra-mcp-evolution.md) §Feature 151。

---

## 1. UnifiedGraph Schema（Feature 151 已 ship）

**文件**：[src/knowledge-graph/unified-graph.ts](src/knowledge-graph/unified-graph.ts)

- 节点类型：module / package / component / service / spec / document / api / api-schema / event / diagram / **symbol**（symbol 节点为 Feature 151 新增）
- 边关系：**calls** / depends-on / cross-module / contains / documents / references / conceptually_related_to / rationale_for / groups / deploys
- `directional` 规则（Feature 151 CL-07）：
  - calls / depends-on / cross-module / contains 必须 `directional: true`，反向邻接表由 GraphQueryEngine 维护
  - 其他关系 `directional: false`（对称）
- Confidence 三档：`high`（0.95，extracted）/ `medium`（0.65，inferred-from-MRO 等）/ `low`（推断 / fallthrough）。
- 节点 ID 命名：
  - module：`/abs/path/to/file.py`
  - free function：`/abs/path/to/file.py::funcName`
  - class member：`/abs/path/to/file.py::ClassName::methodName`
- 入口签名：`buildUnifiedGraph({ projectRoot, codeSkeletons, preBuiltNodes? }): UnifiedGraph`
- 单例缓存：`setCurrentUnifiedGraph(ug)` / `getCurrentUnifiedGraph()`（在 batch-orchestrator 内提前注入，给 ComponentViewBuilderGenerator 用）

**结论**：本 Feature **不动 schema**，只读消费。symbol 节点 + calls 边已具备，是 impact/context tool 的数据基础。

---

## 2. call-resolver（Feature 151 已 ship）

**文件**：[src/knowledge-graph/call-resolver.ts](src/knowledge-graph/call-resolver.ts)

- CALLS edge 的 4 阶段流水线已实现：
  - Stage 1（free，high）/ 2a（class self method，high）/ 2b（MRO ≤ 8 层，medium）/ 2c（class placeholder，medium）/ 3（cross-module import，medium）/ 3 star import（low）/ 4 super（low）/ fallthrough（low）。
  - mapper skip（dynamic import / decorator-only）→ **不输出**边。
- 每条边有 `confidence: 'high' | 'medium' | 'low'`（内部）。
- 对外（GraphJSON）：通过 [src/knowledge-graph/confidence-mapper.ts](src/knowledge-graph/confidence-mapper.ts) 映射为 `EXTRACTED` / `INFERRED` / `AMBIGUOUS` 字符串。

**结论**：impact tool 的 `minConfidence` 阈值 0.7 用 high(0.95) + medium(0.65) 数值即可（或在 query 层把 high → 0.95、medium → 0.65、low → 0.30）。

---

## 3. BFS / DFS 复用基础

**文件**：[src/graph/topological-sort.ts](src/graph/topological-sort.ts)

**实际导出**：`detectSCCs(graph): SCC[]`（Tarjan 算法），`topologicalSort(graph): TopologicalResult`（Kahn 算法）。
**无 BFS / DFS 导出**！⚠️

输入类型是早期 `DependencyGraph`（module 级 from→to 边），不是 UnifiedGraph，不带 budget / depth / confidence 过滤。

**对 Feature 155 的影响**：
- 用户 task 描述里的"复用 src/graph/topological-sort.ts (BFS/DFS)"理解为**借鉴算法风格**，而非直接 import；topological-sort 不会被本 Feature 修改。
- BFS / DFS 落在 `src/knowledge-graph/query-helpers.ts`（新增），输入是 UnifiedGraph 反向邻接表，输出 `affected: [{ id, depth, confidence, reason }]`。
- 必须支持：`maxDepth`、`nodeBudget`（**遍历前**截断 — 即按 visited count 即时检查）、`minConfidence`、`direction: upstream | downstream | both`。

---

## 4. MCP server 注册模式

**文件**：[src/mcp/server.ts](src/mcp/server.ts)、[src/mcp/graph-tools.ts](src/mcp/graph-tools.ts)

现有 11 个 tool：5 个 workflow（prepare/generate/batch/diff/panoramic-query）+ 6 个 graph 查询（graph_query / graph_node / graph_path / graph_community / graph_god_nodes / graph_hyperedges）。

**注册模式**（Zod schema + closure handler）：
```ts
server.tool(
  'graph_query',
  '描述',
  { query: z.string(), budget: z.number().optional() },
  async (args) => ({ content: [{ type: 'text', text: JSON.stringify(result) }] })
);
```

**DI 模式**：
- 模块级 `engineCache = new Map<string, GraphQueryEngine>()`
- closure `getEngine(projectRoot)`：lazy load `_meta/graph.json`，缓存 GraphQueryEngine。
- 没有 IoC 容器；tool handler 拿 graph 走"模块级单例 + 路径参数"。

**Feature 155 推荐**：
- 新增 [src/mcp/agent-context-tools.ts](src/mcp/agent-context-tools.ts)，导出 `registerAgentContextTools(server)`。
- 复用 `engineCache.get(projectRoot)`（或暴露 `getCachedGraph(projectRoot)` helper）拿 UnifiedGraph。
- 在 server.ts 里 `registerAgentContextTools(server)` 紧跟 `registerGraphTools(server)` 调用。

---

## 5. Graph 数据源 / runtime-bootstrap

**文件**：[src/runtime-bootstrap.ts](src/runtime-bootstrap.ts)、[src/batch/batch-orchestrator.ts](src/batch/batch-orchestrator.ts)

- `bootstrapRuntime(outputDir?)` 在 entry 调用，初始化 LanguageAdapterRegistry / GeneratorRegistry / ParserRegistry。
- batch-orchestrator 在生成 graph.json **之前** `setCurrentUnifiedGraph(earlyUg)`，让下游 generator 拿到 in-memory graph。
- MCP graph-tools.ts 走的是磁盘路径：`resolveGraphJsonPath(root) → GraphQueryEngine.loadFromFile()`。

**Feature 155 选择**：
- impact / context tool 沿用 graph-tools.ts 的"磁盘 + lazy cache"模式，**不强求 in-memory bootstrap**（避免本 Feature 改动 server.ts 启动顺序）。
- detect_changes tool：先用 git diff 列出改动文件，再 re-parse CodeSkeleton 算 symbol delta。这一路也只读取 graph.json + git。

---

## 6. MCP 测试模式

**文件**：[tests/unit/mcp-server.test.ts](tests/unit/mcp-server.test.ts)、[tests/unit/graph-tools-v2.test.ts](tests/unit/graph-tools-v2.test.ts)

- FakeMcpServer：记录 `tool(name, description, zodSchema, handler)` 调用；测试时拿 `tools.find(t => t.name === ...)` 调 handler。
- mock 路径：`vi.mock('../../src/mcp/graph-tools', ...)` 或直接 mock `GraphQueryEngine.loadFromFile`。
- 断言：`result.content[0].text` 用 JSON.parse / contains。

**Feature 155 测试目录建议**：[tests/unit/mcp/agent-context-tools.test.ts](tests/unit/mcp/agent-context-tools.test.ts)（new）。

---

## 7. batch-orchestrator specPath 持久化（relatedSpec stretch goal）

**文件**：[src/batch/batch-orchestrator.ts](src/batch/batch-orchestrator.ts)

- `specPath` 已写入 `checkpoint.json`（resume 用），**未写入** graph.json 节点 metadata。
- 每个 module 一个 `${moduleName}.spec.md`，路径形如 `panoramic/modules/<module>.spec.md`。

**对 Feature 155 的影响**：
- context tool 的 `relatedSpec` 字段是 stretch goal。本 Feature **不改 batch-orchestrator**，不向 graph.json 注入 specPath（避免触动 Feature 151 已 ship 的 schema）。
- 降级方案：context tool 在 graph 上对 symbol 节点定位其所属 module，再查 `panoramic/modules/<module>.spec.md` 是否存在；存在则返回 `{ kind: 'module-coarse', path }`，不存在则返回 `{ kind: 'unknown' }`。
- 设计文档已明确：anchor 精确到 section 留 Feature 155b。

---

## 8. git diff parser 现状

**文件**：[src/diff/structural-diff.ts](src/diff/structural-diff.ts)、[src/diff/semantic-diff.ts](src/diff/semantic-diff.ts)

- 现有 `compareSkeletons(oldSkeleton, newSkeleton): DriftItem[]` 做 symbol 级 drift（severity / category / changeType / location / symbolName / description）。
- **无** git diff 文本 parser、**无** baseRef → 文件列表的能力。

**Feature 155 实现路径**：
- detect_changes tool 的 input：`{ diff: string }` 或 `{ baseRef: string }`
- 处理：
  - input 为 `baseRef` → spawn `git diff --name-only <baseRef>...HEAD` 拿到改动文件
  - input 为 `diff` 文本 → 解析 `diff --git` 头拿到文件路径（unified diff 格式即可，最小可用）
- 改动文件 → 在 graph.json 里查所属 symbol 节点（按 file 前缀匹配 + 行号近似）→ changedSymbols
- 复用 impact tool 的 BFS：每个 changedSymbol 取 callers within depth=2，affectedSymbols = union 去重
- riskSummary：基于 affectedSymbols 数量分档（low/medium/high tier）

**最小可用决策**：第一版只接受 `git diff --name-only` 输出的"文件路径列表" + 基于 graph.json 的"file → symbols" 映射；不做 hunk 解析（stretch goal）。

---

## 9. baseline 路径

- `~/.spectra-baselines/micrograd`、`~/.spectra-baselines/nanoGPT`（cross-worktree 共享，CLAUDE.local.md 已说明）
- 仓库内 `tests/baseline/micrograd/`、`tests/baseline/nanoGPT/` （perf anchor，跨版本对比）
- impact tool 验收路径：在 micrograd 上 query `Value.__add__` → 期望 ≥ 5 callers within 2 ms。

---

## 10. 风险与假设清单

| # | 风险 / 假设 | 影响 | 缓解 |
|---|------------|------|------|
| R-1 | topological-sort.ts 无 BFS | 必须自实现 | 新增 `src/knowledge-graph/query-helpers.ts`（BFS 反向邻接表 + budget cutoff） |
| R-2 | confidence 数值映射 | 用户要 minConfidence 数值 0.7，graph 用三档枚举 | query helper 内置 `tierToScore({high:0.95, medium:0.65, low:0.30})` |
| R-3 | budget 必须**遍历前**截断 | Codex WARNING #6 已点名 | BFS 维护 `visitedCount`，每次 enqueue 前检查 ≤ budget；切勿"先全 BFS 再 slice" |
| R-4 | git diff hunk 解析 | 复杂度高 | 第一版只 file-level，hunk-level 留 155b |
| R-5 | relatedSpec 精确到 section | 依赖 batch-orchestrator 改动 | 第一版只到 module-coarse，stretch 属于 155b |
| R-6 | MCP server.ts 注册顺序 | 已有 12 处 tool | 在 registerGraphTools 之后 append registerAgentContextTools，不改前序逻辑 |
| R-7 | tool handler 错误响应格式 | MCP isError 结构 | 沿用 graph-tools.ts buildErrorResponse 模式 |
| R-8 | symbol id 双冒号 vs 单冒号 | call-resolver 用 `file::Class::method`（双冒号 separator） | tool 接收 symbol id 时按 `::` split，最后段是 method name |

---

## 11. 推荐文件结构

```
src/
├── mcp/
│   ├── server.ts                        (改：调用 registerAgentContextTools)
│   ├── graph-tools.ts                   (不改，可暴露 getCachedGraph helper)
│   └── agent-context-tools.ts           (新增 — 3 个 tool 注册 + handler)
├── knowledge-graph/
│   ├── unified-graph.ts                 (不改，Feature 151 已 ship)
│   ├── call-resolver.ts                 (不改，Feature 151 已 ship)
│   └── query-helpers.ts                 (新增 — BFS / DFS / changeDetect 子工具)
└── git/
    └── diff-files.ts                    (新增，可选 — 仅当 detect_changes 需要 spawn git；若只接受 diff 文本可省)

tests/unit/mcp/
└── agent-context-tools.test.ts          (新增 ≥ 12 case)

tests/unit/knowledge-graph/
└── query-helpers.test.ts                (新增 ≥ 8 case，遍历前截断 / minConfidence / direction)
```

---

## 12. 与设计文档的差异 / 调整

| 设计文档说法 | 实际方案 | 理由 |
|------------|---------|-----|
| "复用 src/graph/topological-sort.ts (BFS/DFS)" | BFS/DFS 在新文件 query-helpers.ts | topological-sort.ts 不导出 BFS，且其类型基于早期 DependencyGraph，不适合直接扩展 |
| relatedSpec 精确到 section | 第一版降级为 module-coarse | 与设计文档 §Feature 151 stretch goal 一致 |
| detect_changes 接受 diff hunk | 第一版仅接受 file 列表 | 控制本 Feature 复杂度；hunk 解析留 155b |

---

**结论**：技术路径清晰，无 schema 破坏，集成点全部已 ship。开始撰写 spec.md。
