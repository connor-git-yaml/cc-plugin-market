# API 契约：图模块

**模块**：`src/graph/`
**覆盖**：FR-010、FR-011、FR-013、FR-014

---

## dependency-graph

**文件**：`src/graph/dependency-graph.ts`

### `buildGraph(projectRoot: string, options?: GraphOptions): Promise<DependencyGraph>`

使用 dependency-cruiser 构建项目级依赖关系图。

**参数**：
- `projectRoot` — 项目根目录路径
- `options.includeOnly` — 用于过滤分析文件的 Glob 模式（默认：`'^src/'`）
- `options.excludePatterns` — 排除模式（默认：测试文件、构建产物）
- `options.tsConfigPath` — tsconfig.json 路径（默认：自动检测）

**返回**：`DependencyGraph`（参见 [data-model.md](../data-model.md#2-dependencygraph)）

**错误**：
- `ProjectNotFoundError` — projectRoot 不存在
- `NoDependencyCruiserError` — dependency-cruiser 未安装
- `TsConfigNotFoundError` — tsconfig.json 未找到

**性能**：200+ 模块在 2-5 秒内完成

---

## topological-sort

**文件**：`src/graph/topological-sort.ts`

### `topologicalSort(graph: DependencyGraph): TopologicalResult`

使用 Kahn 算法或 DFS 计算处理顺序。

**返回**：
```typescript
interface TopologicalResult {
  order: string[];         // 按依赖顺序排列的文件路径（叶子节点优先）
  levels: Map<string, number>;  // 模块 → 拓扑层级
  hasCycles: boolean;
  cycleGroups: string[][];  // 大小 > 1 的 SCC
}
```

**保证**：
- 若 `hasCycles === false`，则 `order` 是有效的拓扑排序
- 若 `hasCycles === true`，循环依赖将被折叠为 SCC 并作为整体处理（FR-011）

---

### `detectSCCs(graph: DependencyGraph): SCC[]`

基于 Tarjan 算法的强连通分量检测。

**返回**：`SCC[]` — 所有 SCC。单模块 SCC 的 `modules.length === 1`。

---

## mermaid-renderer

**文件**：`src/graph/mermaid-renderer.ts`

### `renderDependencyGraph(graph: DependencyGraph, options?: RenderOptions): string`

为依赖关系图生成 Mermaid 源代码。

**参数**：
- `graph` — 待渲染的 DependencyGraph
- `options.collapseDirectories` — 按目录分组（默认：模块数 > 20 时为 `true`）
- `options.highlightCycles` — 高亮循环依赖为红色（默认：`true`）
- `options.maxNodes` — 限制可见节点数量（默认：`50`，使用聚类处理）

**返回**：有效的 Mermaid `graph TD` 源代码字符串

**约束**：
- 输出必须可被任何 Mermaid 兼容的查看器渲染（FR-007）
- 循环依赖以醒目样式高亮显示
