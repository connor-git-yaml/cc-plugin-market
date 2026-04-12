# Feature 105: mcp-graph-query

## Prompt

```
/spec-driver:spec-driver-feature 105-mcp-graph-query

MCP graph query tool 集 + CLI query 命令 + token 预算控制。让 Claude Code 可以通过 MCP 工具直接查询知识图谱，获取相关子图和架构洞察。

## 需求概述

### 核心能力

1. **MCP Graph Query 工具集（5 个 tool）**
   - 在现有 `src/mcp/server.ts` 追加 5 个 MCP tool：
     - `graph_query`：自然语言查询 → BFS/DFS 遍历相关子图 + 文本摘要
     - `graph_node`：按 id 或关键词查找节点详情（属性、邻居列表、所属社区）
     - `graph_path`：两个节点间最短路径查找
     - `graph_community`：返回指定社区的节点列表和 cohesion 信息
     - `graph_god_nodes`：返回 God Nodes 列表（度数排序 Top N）
   - 自动加载 `_meta/graph.json`（启动时加载，内存缓存）
   - 每个 tool 使用 Zod schema 定义参数

2. **Token 预算控制**
   - `budget` 参数限制返回节点数（默认 50，可配置）
   - 超出时优先保留策略：
     1. 查询起点节点（必保留）
     2. 最短路径上的节点
     3. 度数最高的节点（hub 节点）
     4. 高置信度（EXTRACTED）边连接的节点
   - 返回结果包含 `truncated: true` + `totalMatches` 标记（让 Claude 知道结果被裁剪）

3. **CLI Query 命令**
   - `spectra query "<问题>" [--budget <N>] [--format json|text]`
   - 新建 `src/cli/commands/query.ts`
   - 默认 text 格式输出人类可读摘要；json 格式输出原始子图

4. **Graph 加载与缓存**
   - MCP server 启动时加载 `_meta/graph.json` 到内存
   - 提供 `reloadGraph()` 方法（batch 完成后调用以刷新缓存）
   - graph.json 不存在时 → tool 返回友好错误提示（非 crash）

### 性能目标

| 场景 | 目标 |
|------|------|
| 单次 query（graph 已加载） | < 500ms |
| graph.json 加载 | < 2 秒（5,000 节点） |
| graph_path 最短路径 | < 100ms（BFS） |
| graph_node 查找 | < 50ms（Map 索引） |

### 与现有系统的关系

- **MCP Server** (`src/mcp/server.ts`)
  - 现有 tool 注册模式：`server.tool(name, description, zodSchema, handler)`
  - handler 返回 `{ content: [{type: 'text', text: ...}], isError?: boolean }`
  - 现有 tool：prepare、generate、batch、diff + panoramic query
  - 新增 5 个 tool 遵循相同模式

- **Feature 101 graph.json** (`src/panoramic/graph/`)
  - `GraphJSON`：NetworkX node-link 格式（nodes + links）
  - `GraphNode`：`{ id, kind, label, metadata? }`
  - `GraphEdge`：`{ source, target, relation, confidence, confidenceScore }`
  - `buildKnowledgeGraph()` 和 `writeKnowledgeGraph()` 已实现

- **Feature 102 community-analysis**（可选集成，非硬依赖）
  - 若 graph-report.md 存在，graph_community tool 可从中读取 cohesion 评分
  - 若不存在，graceful degrade 为仅返回节点列表

- **CLI 命令**
  - `src/cli/index.ts`：switch 分支 + HELP_TEXT 新增 `query` 子命令
  - `src/cli/commands/graph.ts`：Feature 101 已有的 graph CLI（参考模式）

### 目录结构建议

```
src/mcp/
  graph-tools.ts         # 5 个 MCP graph tool 定义 + handler
  graph-loader.ts        # graph.json 加载 + 内存缓存 + reload
src/panoramic/graph/
  graph-query-engine.ts  # BFS/DFS 遍历 + token 预算裁剪
  graph-index.ts         # 节点/边索引（Map 加速查找）
src/cli/commands/
  query.ts               # spectra query 命令
tests/unit/
  graph-query-engine.test.ts
  graph-index.test.ts
  graph-tools.test.ts
tests/integration/
  mcp-graph-query.test.ts  # MCP tool 端到端测试
```

### 约束

- 不引入新运行时依赖（图遍历用纯 JS 实现，BFS/DFS 标准算法）
- graph.json 必须整体加载到内存（不支持流式查询——5,000 节点级别内存占用可控）
- MCP tool 的 Zod schema 必须包含完整参数描述（Claude 需要读取 description 来决定何时调用）
- 每个 tool handler 必须处理 graph.json 不存在的情况（返回 isError + 友好提示）
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释

### MCP Tool Schema 参考

```typescript
// graph_query
server.tool('graph_query', '自然语言查询知识图谱，返回相关子图', z.object({
  query: z.string().describe('查询问题'),
  budget: z.number().optional().default(50).describe('返回节点数上限'),
}), handler);

// graph_node
server.tool('graph_node', '查找节点详情', z.object({
  id: z.string().optional().describe('精确节点 ID'),
  keyword: z.string().optional().describe('关键词模糊搜索'),
}), handler);

// graph_path
server.tool('graph_path', '查找两节点间最短路径', z.object({
  source: z.string().describe('起点节点 ID'),
  target: z.string().describe('终点节点 ID'),
}), handler);

// graph_community
server.tool('graph_community', '返回指定社区的节点列表', z.object({
  communityId: z.string().describe('社区 ID'),
}), handler);

// graph_god_nodes
server.tool('graph_god_nodes', '返回 God Nodes 列表', z.object({
  limit: z.number().optional().default(10).describe('返回数量上限'),
}), handler);
```
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/mcp/server.ts` | MCP server 入口，现有 tool 注册模式 |
| `src/panoramic/graph/graph-types.ts` | GraphNode / GraphEdge / GraphJSON 类型 |
| `src/panoramic/graph/graph-builder.ts` | buildKnowledgeGraph() + writeKnowledgeGraph() |
| `src/panoramic/graph/confidence-mapper.ts` | 置信度映射 |
| `src/cli/commands/graph.ts` | Feature 101 graph CLI（参考模式） |
| `src/cli/index.ts` | CLI 入口，子命令 switch 分支 |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 4
- 优先级 P4，目标版本 v3.4.0
- 前置依赖：Feature 101 (graph-persistence) ✅ 已完成
- 可选增强依赖：Feature 102 (community-analysis) — 若已完成，graph_community tool 可集成 cohesion 数据
- 与 Feature 102 **互不阻塞**，可并行开发（102 不存在时 graceful degrade）
