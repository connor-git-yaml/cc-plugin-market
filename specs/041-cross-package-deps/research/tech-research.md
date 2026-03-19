# Feature 041 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. Feature 040 提供的基础

WorkspaceIndexGenerator (`src/panoramic/workspace-index-generator.ts`) 已实现：
- `WorkspacePackageInfo { name, path, description, language, dependencies }`
- `dependencies` 已包含 workspace 内部依赖名称列表
- `buildMermaidDiagram()` + `sanitizeMermaidId()` 可复用
- 支持 npm/pnpm/uv 三种 workspace 类型

## 2. 现有图算法

`src/graph/topological-sort.ts`:
- `detectSCCs(graph)` — Tarjan 算法，O(V+E)
- `topologicalSort(graph)` — Kahn + SCC 折叠，返回 order/levels/hasCycles/cycleGroups

`src/models/dependency-graph.ts`:
- `DependencyGraph { modules, edges, topologicalOrder, sccs }`
- `DependencyEdge { from, to, isCircular, importType }`
- `SCC { id, modules }`

## 3. 041 需要的增量能力

| 040 已有 | 041 需新增 |
|---------|-----------|
| 子包列表 + 内部依赖 | 循环依赖检测（Tarjan SCC） |
| 简单 Mermaid 依赖图 | 循环边标注（红色虚线） |
| — | 拓扑排序 + 层级 |
| — | 统计（root/leaf/总依赖数） |
| — | 循环依赖警告报告 |

## 4. 设计决策

1. **复用 WorkspaceIndexGenerator.extract()**：不重复解析 workspace，直接获取 packages
2. **构建包级 DependencyGraph**：将 WorkspacePackageInfo[] 转换为 DependencyGraph 格式
3. **复用 detectSCCs + topologicalSort**：不重写图算法
4. **Mermaid 循环标注**：SCC 中的边用 `-->|cycle|` 标注，节点用红色样式
5. **模板**: `templates/cross-package-analysis.hbs`
6. **id**: 'cross-package-deps'

## 5. OctoAgent 跨包依赖预期

基于 pyproject.toml 分析：
- `octoagent-core` — 无内部依赖（root 包）
- `octoagent-protocol` → core
- `octoagent-provider` → core, protocol
- `octoagent-memory` → core
- `octoagent-skills` → core, protocol
- `octoagent-policy` → core
- `octoagent-tooling` → core
- `octoagent-gateway` → core, provider, protocol, skills, policy, memory, tooling（leaf 包）

预期无循环依赖，拓扑序：core → protocol/memory/policy/tooling → provider/skills → gateway
