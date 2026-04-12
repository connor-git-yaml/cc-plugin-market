# 技术决策研究：MCP Graph Query（Feature 105）

**Date**: 2026-04-12
**Status**: 已确定

---

## 决策 1：图加载和索引是否独立为单独文件

**问题**：spec.md 复杂度评估中列出了 4 个新增模块（`graph-loader.ts`、`graph-query-engine.ts`、`graph-index.ts`、`graph-tools.ts`）。是否应按此拆分？

**Decision**: 将 graph-loader.ts 和 graph-index.ts 的职责合并入 `GraphQueryEngine` 构造函数和静态 `loadFromFile()` 方法，不单独建文件。

**Rationale**:
- 加载（从磁盘读取 JSON）是引擎初始化的一个步骤，约 10 行代码，独立文件价值为负（增加 import 层但无复用场景）。
- 内存索引（`Map<string, GraphNode>` + 邻接表）在构造函数中构建，约 15 行，同样无独立文件理由。
- graphify 参考实现将加载放在 `serve()` 函数内，将索引构建放在图遍历函数头部——合并是成熟实践。
- Constitution III（YAGNI）明确要求："三行重复代码优于一个过早抽象；具体实现优于泛化框架。"

**Alternatives Rejected**:
- 独立 `graph-loader.ts`：被拒绝，因为调用方仅有 `graph-tools.ts` 和 `query.ts` 两处，不存在多消费者场景。
- 独立 `graph-index.ts`：被拒绝，因为索引是引擎的私有状态，没有理由对外暴露一个"索引对象"。

---

## 决策 2：MCP tool 定义是否独立文件

**问题**：5 个 graph tool 的 Zod schema + handler 是否应写入 `server.ts`，还是独立 `graph-tools.ts`？

**Decision**: 独立 `src/mcp/graph-tools.ts`。

**Rationale**:
- `server.ts` 现有 253 行，新增 5 个 tool（~150 行）后将达 400 行，超过合理的单文件阅读阈值。
- 功能边界清晰：`server.ts` 负责 server 生命周期管理，`graph-tools.ts` 负责图查询 tool 定义——职责不重叠。
- 参照现有 `panoramic-query` tool 的规模判断：1 个 tool ~35 行，5 个 tool ~175 行，独立文件合理。

**Alternatives Rejected**:
- 全部写入 `server.ts`：被拒绝，单文件过大且混合了不同领域的关注点。

---

## 决策 3：`graph_path` 使用 BFS 还是 Dijkstra

**问题**：最短路径实现使用 BFS（无权）还是 Dijkstra（加权）？

**Decision**: BFS（无权图最短路径）。

**Rationale**:
- `GraphJSON` 中边的 `confidenceScore` 字段范围为 [0.0, 1.0]，表示置信度，不是路径长度或代价权重，语义上不应作为 Dijkstra 的边权重。
- FR-004 要求"返回两节点间的 BFS 最短路径节点序列"——spec 本身已指定 BFS。
- 无权图 BFS 实现 ~20 行，Dijkstra 需要优先级队列实现 ~50 行，在语义等价的情况下 BFS 更简单。

**Alternatives Rejected**:
- Dijkstra（按 `confidenceScore` 倒数加权）：被拒绝，`confidenceScore` 的语义是关系可信度，不是图遍历距离，混用会产生语义错误。

---

## 决策 4：Lazy load 还是 Eager load

**问题**：MCP server 启动时应 eager load graph.json，还是首次 tool 调用时 lazy load？

**Decision**: Lazy load（首次 tool 调用时加载，缓存至模块级变量）。

**Rationale**:
- spec.md FR-001 描述"在 MCP server 启动时将 graph.json 加载到内存缓存"，但 US1 验收场景 2 要求文件不存在时返回友好错误而非启动失败——lazy load 更符合容错要求。
- `graph.json` 可能在 MCP server 启动后由 `spectra graph` 命令生成，eager load 会导致首次调用前必须已有文件。
- `graph-tools.ts` 模块级缓存变量足以满足 FR-001 的"内存缓存"语义；`reloadGraph()` 满足 FR-011。

**Alternatives Rejected**:
- Eager load（`createMcpServer()` 中加载）：被拒绝，若文件不存在则 server 启动即报错，与 US1 场景 2 的验收标准冲突。

---

## 决策 5：`community` 信息来源

**问题**：`GraphNode.metadata` 是否包含社区归属信息？如何实现 `getCommunity()`？

**Decision**: 通过 `GraphNode.metadata.community`（字符串或数字 ID）字段分组。若图中节点未携带社区信息，则返回空结果并在 summary 中标注。

**Rationale**:
- Feature 102 的社区分析结果写入 `_meta/graph-report.md`，但 graph.json 中节点的社区归属（Community Detection 结果）由 Feature 102 写回 node metadata 中。
- 如 Feature 102 未运行，`metadata.community` 字段缺失，`getCommunity()` 返回空节点列表并 graceful degrade——满足 FR-005 和 SC-009。
- Cohesion 评分来自 `_meta/graph-report.md`，`getCommunity()` 尝试读取该文件，失败时将 cohesion 字段标注"不可用"。

**Alternatives Rejected**:
- 要求 Feature 102 作为前置依赖：被拒绝，spec.md 明确要求在 Feature 102 数据缺失时 graceful degrade。
