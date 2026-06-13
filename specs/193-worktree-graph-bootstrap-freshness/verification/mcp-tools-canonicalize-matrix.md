# T002 — 17 个 MCP 工具 canonicalize / 相对 id / stale 矩阵

**采集日期**: 2026-06-13 | **方法**: 逐工具读 `src/mcp/{graph-tools,agent-context-tools,file-nav-tools,server}.ts` + `src/knowledge-graph/query-helpers.ts`

## 矩阵

| # | 工具 | 文件 | 消费 graph？ | 经 canonicalizeSymbolId？ | 接受相对 id 输入？ | 对旧绝对图（copy 自主仓）行为 |
|---|------|------|--------------|---------------------------|---------------------|-------------------------------|
| 1 | `view_file` | file-nav-tools.ts | 否（直接读文件系统） | 否 | n/a（吃文件路径） | 不受影响 |
| 2 | `search_in_file` | file-nav-tools.ts | 否 | 否 | n/a | 不受影响 |
| 3 | `list_directory` | file-nav-tools.ts | 否 | 否 | n/a | 不受影响 |
| 4 | `impact` | agent-context-tools.ts | 是（getCachedGraphData → bfsTraverse） | **是**（resolveSymbolFuzzy → canonicalizeSymbolId） | 是 | 旧绝对图：canonicalize 的「相对→绝对」分支（query-helpers.ts:193-198）可命中 → 历史可用；T015 加载期 stale 检测会先于查询拦截，返回 graph-format-stale |
| 5 | `context` | agent-context-tools.ts | 是 | **是** | 是 | 同上 |
| 6 | `detect_changes` | agent-context-tools.ts | 是（git diff symbol 映射 + bfs） | **是** | 是 | 同上 |
| 7 | `graph_query` | graph-tools.ts | 是（GraphQueryEngine.query 关键词） | 否（关键词 tokenize，非 id exact） | 是（关键词不依赖 id 形态） | 相对图正常；旧绝对图 label/sourcePath 关键词仍可匹配，但 T015 加载期拦截 |
| 8 | `graph_node` | graph-tools.ts | 是（getNode → **exact nodeMap**） | **否**（直接 nodeMap.get） | **需输入与节点 id 同形** | **旧绝对图 + 相对输入 → exact miss**；T015 拦截 → graph-format-stale（避免静默 not-found）|
| 9 | `graph_path` | graph-tools.ts | 是（shortestPath → **exact nodeMap** 两端） | **否** | **需同形** | 同 graph_node（W5 重点）|
| 10 | `graph_community` | graph-tools.ts | 是（社区聚合，读 community id） | 否 | 是（按 community metadata，非文件 id） | T015 拦截 |
| 11 | `graph_hyperedges` | graph-tools.ts | 是（读 hyperedges 节点引用） | 否 | hyperedge.nodes 引用需与节点 id 同形 | 相对图正常；旧绝对图 hyperedge 引用绝对 → T015 拦截 |
| 12 | `graph_god_nodes` | graph-tools.ts | 是（degree 排序，返回 node id 原样） | 否 | 是 | 返回旧绝对 id 会误导用户 → T015 拦截 |
| 13 | `prepare` | server.ts | 否（生成流程编排） | 否 | n/a | 不受影响 |
| 14 | `generate` | server.ts | 否（生成流程） | 否 | n/a | 不受影响 |
| 15 | `batch` | server.ts | 否（batch 编排，写图） | 否 | n/a（producer 侧已相对化） | 产出相对图 |
| 16 | `diff` | server.ts | 否 | 否 | n/a | 不受影响 |
| 17 | `panoramic-query` | server.ts | 是（GraphQueryEngine 查询） | 视子查询而定 | 视子查询 | T015 拦截 |

## 关键发现

1. **exact nodeMap 工具（graph_node / graph_path / graph_hyperedges）是 W5 风险核心**：它们不经 canonicalize，直接 `nodeMap.get(id)` / 邻接表 exact 匹配。相对化后，节点 id 与用户传入的相对 id 必须**同形**。验证手段：T022 在 F180 E2E 中对这些工具补相对 id 匹配断言。
2. **canonicalize 工具（impact / context / detect_changes）天然兼容**：F174 的 canonicalizeSymbolId 已含「绝对↔相对」双向归一（query-helpers.ts:183-198），相对图 + 绝对输入或绝对图 + 相对输入都能命中。本 feature 不削弱此能力。
3. **加载期 stale 拦截（T015）覆盖全部 graph 消费工具**：在 `GraphQueryEngine.fromJSON`（所有 loadFromFile / MCP lazy load 的咽喉）加 graph-format-stale 检测，命中即抛明确错误（含重建指引），不让任何 exact-miss 退化为静默 not-found。这是对「旧绝对图 copy 到新 worktree」场景的统一防线。
4. **非 graph 工具（view_file / search_in_file / list_directory / prepare / generate / diff）不受 id 相对化影响**：它们吃文件路径或编排流程，不消费 graph node id。

## stale 判定规则（T015 落地）

- 全量扫描 node.id（命中即短路）：判定 = id 的 file part `path.isAbsolute()` 且 `!file.startsWith(当前 projectRoot)` → graph-format-stale。
- 不抽样（前 N 节点恰为 doc/相对形态时 100% 漏判，Codex plan-W3）。
- 不依赖 canonicalize（canonicalize 对非 projectRoot 前缀的绝对 id 无能为力）。
- external 节点（metadata.external=true）的绝对 id 是合法的，不触发 stale；判定时按 file part 是否在当前 projectRoot 外但**本图自带 external 标记**区分——实现上 stale 检测只看「绝对且非当前 projectRoot 前缀」，external 节点本就绝对且在 projectRoot 外，会被误判。故 stale 检测**仅当存在绝对 id 且该节点未标 external** 时触发。
