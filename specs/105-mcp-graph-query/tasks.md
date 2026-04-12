# Tasks: MCP Graph Query 工具集（Feature 105）

**Input**: `/specs/105-mcp-graph-query/plan.md`, `/specs/105-mcp-graph-query/spec.md`
**Prerequisites**: plan.md（必需）、spec.md（必需，包含 4 个 User Story 和 16 个 FR）

## 格式说明：`[ID] [P?] [Story?] 描述`

- **[P]**：可并行执行（无文件冲突，无依赖关系）
- **[Story]**：对应的用户故事编号（US1–US4）
- 每个任务包含具体文件路径和行为描述

---

## Phase 1: 类型定义与基础接口（Setup）

**目标**：在新文件中定义 `GraphQueryEngine` 所需的查询结果类型，为后续实现提供类型基础。所有类型仅在 `graph-query.ts` 内部声明，不修改现有 `graph-types.ts`。

- [x] T001 [P] 在 `src/panoramic/graph/graph-query.ts` 中新建文件骨架，声明内部结果接口：`QueryResult`（nodes/edges/summary/truncated/totalMatches）、`NodeResult`、`PathResult`、`CommunityResult`、`GodNodesResult`；在文件头部 import `GraphJSON`、`GraphNode`、`GraphEdge` 类型（来自 `./graph-types.js`）

**Checkpoint**：`graph-query.ts` 文件存在，类型定义通过 `tsc --noEmit` 检查，无编译错误。

---

## Phase 2: 核心引擎实现（阻塞前置）

**目标**：实现 `GraphQueryEngine` 类的完整逻辑，包括图加载、内存索引构建、BFS 遍历和 budget 裁剪。此阶段完成后，Phase 3–5 可并行推进。

**注意**：此阶段完成前，任何 MCP tool 或 CLI 命令实现均无法运行。

- [x] T002 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine` 构造函数：接受 `GraphJSON`，构建 `nodeMap: Map<string, GraphNode>`（id → node 索引）和 `adjacency: Map<string, Array<{ node: string; edge: GraphEdge }>>`（邻接表）

- [x] T003 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine.loadFromFile(graphPath: string)` 静态方法：读取文件（`fs.readFileSync`）→ JSON.parse → 基础 schema 校验（检查 `nodes`/`links` 数组存在）→ 返回 `new GraphQueryEngine(parsed)`；文件不存在或解析失败时抛出含明确原因的 Error

- [x] T004 在 `src/panoramic/graph/graph-query.ts` 中实现私有方法 `scoreNodes(terms: string[])`：遍历 `nodeMap` 中每个节点，计算关键词匹配分（label 完全包含词项得 1 分，metadata 路径字段包含词项得 0.5 分），返回按分数降序排列的 `Array<{ id: string; score: number }>`（参照 graphify `_score_nodes` 逻辑）

- [x] T005 在 `src/panoramic/graph/graph-query.ts` 中实现私有方法 `bfs(startIds: string[], depth: number)`：从起始节点集合出发，按层遍历邻接表（最大 depth 层），返回 `{ nodes: Set<string>; edges: Array<[string, string]> }`（参照 graphify `_bfs` 逻辑）；正确处理循环图（visited set 防止重复访问）

- [x] T006 在 `src/panoramic/graph/graph-query.ts` 中实现私有方法 `truncateByBudget(nodes: GraphNode[], budget: number)`：当节点数超过 budget 时，按节点在邻接表中的度数降序排列后截断，返回 `{ nodes: GraphNode[]; truncated: boolean; totalMatches: number }`；budget ≤ 0 时使用默认值 50 并在 `summary` 中标注

- [x] T007 [US1] 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine.query()` 方法：拆分查询词为词项 → `scoreNodes()` 获取得分节点 → `bfs()` 扩展子图 → `truncateByBudget()` 裁剪 → 生成 `summary` 文本（节点数量摘要 + 截断提示）→ 返回 `QueryResult`；空匹配时返回 `{ nodes: [], edges: [], summary: '未找到相关内容', truncated: false, totalMatches: 0 }`

- [x] T008 [US2] 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine.getNode()` 方法：`id` 参数存在时优先使用 `nodeMap.get(id)` 精确查找；回退到 `keyword` 模糊匹配（label 包含关键词）；同时传入 `id` 和 `keyword` 时 `id` 优先（FR-016）；返回 `NodeResult`（包含节点属性、邻居列表、所属社区信息）

- [x] T009 [US2] 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine.findPath()` 方法：BFS 最短路径算法（无权图，参照 graphify 思路）；`source === target` 时返回包含单节点的路径；不存在路径时返回 `{ path: null, message: '路径不存在：<source> → <target>' }`；返回 `PathResult`

- [x] T010 [P] [US3] 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine.getCommunity()` 方法：按节点 `metadata.community` 字段分组（Feature 101 graph.json 中社区归属信息），返回该社区所有节点；社区 ID 不存在时返回 `{ nodes: [], message: '社区不存在' }`；`cohesion` 字段从 `_meta/graph-report.md` 中读取（若文件不存在则 graceful degrade，cohesion 标注"不可用"）；返回 `CommunityResult`

- [x] T011 [P] [US3] 在 `src/panoramic/graph/graph-query.ts` 中实现 `GraphQueryEngine.getGodNodes()` 方法：计算每个节点的度数（邻接表 size）→ 按度数降序排列 → 截取前 limit 个（默认 10）→ 返回带 `degree` 字段的节点列表；返回 `GodNodesResult`

**Checkpoint**：`GraphQueryEngine` 完整实现，`tsc --noEmit` 通过，可手动 `import` 并调用所有方法。

---

## Phase 3: MCP Tool 注册（US1 + US2 MCP 入口）

**目标**：实现 `graph_query` 和 `graph_node` 两个 P1 优先级 MCP tool，串联到 `GraphQueryEngine`，接入 MCP server。

- [x] T012 [US1] 在 `src/mcp/graph-tools.ts` 中新建文件，实现 `registerGraphTools(server: McpServer)` 函数骨架：lazy load 机制（首次调用时 `GraphQueryEngine.loadFromFile(path.join(process.cwd(), '_meta/graph.json'))`，缓存至模块级变量）；实现 `reloadGraph()` 清除缓存函数；定义加载失败的统一错误响应格式（`isError: true`）

- [x] T013 [US1] 在 `src/mcp/graph-tools.ts` 中注册 `graph_query` tool：Zod schema（`question: z.string()`、`budget: z.number().optional()`、`mode: z.enum(['bfs','dfs']).optional()`、`depth: z.number().optional()`，每个字段含完整 `description`）→ handler 调用 `engine.query()` → 返回 `JSON.stringify(result)` 作为 `content[0].text`；tool description 说明调用时机（"查询知识图谱中与问题相关的模块和依赖关系子图"）

- [x] T014 [US2] 在 `src/mcp/graph-tools.ts` 中注册 `graph_node` tool：Zod schema（`id: z.string().optional()`、`keyword: z.string().optional()`、`budget: z.number().optional()`，含 description）→ handler 调用 `engine.getNode()` → 格式化响应；tool description 说明调用时机（"精确查找节点详情和邻居，适用于已知节点 ID 或名称关键词的场景"）

- [x] T015 在 `src/mcp/server.ts` 中 import `registerGraphTools` 并在 `createMcpServer()` 末尾（`return server` 前）添加调用（约 +3 行）

**Checkpoint（US1 MVP 验证点）**：启动 MCP server，通过 MCP 客户端调用 `graph_query`，验证在 `_meta/graph.json` 存在时返回 `QueryResult` 结构；在文件不存在时返回 `isError: true`。满足 SC-001、SC-002、SC-005、SC-007。

---

## Phase 4: MCP Tool 完善（US2 路径 + US3 社区/God Nodes）

**目标**：补全 `graph_path`、`graph_community`、`graph_god_nodes` 三个 MCP tool，完成全部 5 个 tool 的注册。

- [x] T016 [US2] 在 `src/mcp/graph-tools.ts` 中注册 `graph_path` tool：Zod schema（`source: z.string()`、`target: z.string()`，含 description）→ handler 调用 `engine.findPath()` → 格式化响应；tool description（"查找两个节点间的最短调用路径，适用于理解模块依赖链"）

- [x] T017 [P] [US3] 在 `src/mcp/graph-tools.ts` 中注册 `graph_community` tool：Zod schema（`communityId: z.string()`、`budget: z.number().optional()`，含 description）→ handler 调用 `engine.getCommunity()` → 格式化响应；tool description（"获取指定社区的节点列表，用于识别代码聚类和模块边界"）

- [x] T018 [P] [US3] 在 `src/mcp/graph-tools.ts` 中注册 `graph_god_nodes` tool：Zod schema（`limit: z.number().optional()`，含 description）→ handler 调用 `engine.getGodNodes()` → 格式化响应；tool description（"识别知识图谱中度数最高的枢纽节点，用于定位过度耦合的核心模块"）

**Checkpoint（US2 + US3 验证点）**：通过 MCP 客户端分别调用 `graph_path`（返回有序路径节点序列）、`graph_community`（无 Feature 102 数据时 graceful degrade）、`graph_god_nodes`（按度数降序，满足 SC-003、SC-004、SC-009）。

---

## Phase 5: CLI query 子命令（US4）

**目标**：实现 `spectra query` CLI 命令，将图查询能力暴露给终端用户和 CI 脚本。

- [x] T019 [US4] 新建 `src/cli/commands/query.ts`：实现 `runQueryCommand(command: CLICommand)` 函数；解析 `command.args[0]`（查询词）、`command.budget`（可选 `--budget`）、`command.format`（可选 `--format text|json`，默认 `text`）；`_meta/graph.json` 不存在时打印友好错误（`console.error`）并设 `process.exitCode = 1`；调用 `GraphQueryEngine.loadFromFile()` + `engine.query()` 执行查询

- [x] T020 [US4] 在 `src/cli/commands/query.ts` 中实现输出格式化：`--format json` 时 `console.log(JSON.stringify(result, null, 2))`（保证可通过 `JSON.parse` 解析，满足 SC-008）；`--format text` 时生成人类可读摘要（节点 label 列表 + 关系描述）

- [x] T021 [US4] 在 `src/cli/index.ts` 中：添加 `import { runQueryCommand } from './commands/query.js'`；在 `switch` 中新增 `case 'query': await runQueryCommand(command); break`；在 `HELP_TEXT` 中添加 `spectra query` 的用法描述（`spectra query "<问题>" [--budget <N>] [--format json|text]`）和子命令说明行

**Checkpoint（US4 验证点）**：在含 `_meta/graph.json` 的目录执行 `spectra query "CLI 命令" --format text`，终端输出可读摘要；`--format json` 输出可 `JSON.parse`；`--budget 5` 时结果节点数 ≤ 5；文件不存在时 exit code 非零（满足 US4 所有验收场景）。

---

## Phase 6: 集成与收尾

**目标**：完成模块导出更新、端到端验证、边界条件确认。

- [x] T022 在 `src/panoramic/graph/index.ts` 中新增 `export { GraphQueryEngine } from './graph-query.js'` 导出行

- [x] T023 [P] 执行端到端集成验证：在项目根目录运行 `npm run build`（确认 TypeScript 编译通过）；运行 `npm test`（确认现有测试不回归）；手动验证 `graph_query` 在 `budget=0` 时使用默认值 50 并标注 warning；验证 `graph_path` source === target 时返回单节点路径

- [x] T024 [P] 验证 `parse-args.ts` 是否需要支持 `query` 子命令的 `--budget` 和 `--format` 参数解析：检查 `src/cli/utils/parse-args.ts`，若当前 parser 不支持这两个新参数则补充对应解析逻辑（`--budget <N>` → `number`；`--format <value>` → `string`）

---

## 依赖与执行顺序

### 阶段依赖关系

- **Phase 1（类型定义）**：无依赖，立即开始
- **Phase 2（核心引擎）**：依赖 Phase 1 完成，**阻塞** Phase 3/4/5
- **Phase 3（MCP P1 tool）**：依赖 Phase 2；T015 依赖 T012/T013/T014
- **Phase 4（MCP P2 tool）**：依赖 Phase 2；可与 Phase 5 并行
- **Phase 5（CLI）**：依赖 Phase 2；可与 Phase 4 并行；T021 依赖 T019/T020
- **Phase 6（收尾）**：依赖所有实现阶段完成

### 任务内并行机会

- T010 和 T011（`getCommunity` 与 `getGodNodes`）可并行实现（无文件冲突）
- T017 和 T018（`graph_community` 与 `graph_god_nodes` MCP tool）可并行实现
- T019 和 T020（`runQueryCommand` 函数体与格式化输出）可在 T019 骨架完成后并行

### MVP 优先路径（最短可验证路径）

1. T001 → T002 → T003 → T004 → T005 → T006 → T007（核心 query 能力）
2. T012 → T013（`graph_query` MCP tool）
3. T015（接入 server.ts）
4. **验证 MVP**：`graph_query` 端到端可用

---

## 注意事项

- `parse-args.ts` 中 `CLICommand` 类型可能需要扩展 `budget` 和 `format` 字段（T024 先检查再决定）
- `graph_community` 中的 cohesion 读取依赖 Feature 102 产物（`_meta/graph-report.md`），缺失时必须 graceful degrade，不得抛出错误（FR-005、SC-009）
- 所有 MCP tool handler 不得使用 `process.exit()`，错误通过 `isError: true` 返回（FR-008）
- `GraphQueryEngine.loadFromFile()` 中的 schema 校验保持宽松（仅检查 `nodes`/`links` 数组），避免因 graph.json 字段扩展导致加载失败（FR-015 对应 SHOULD 而非 MUST）
