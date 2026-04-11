# panoramic-bridge 输出格式合同

**schemaVersion**: 1.0.0
**创建日期**: 2026-04-11
**说明**: 定义 `reverse-spec panoramic` CLI 子命令和 `panoramic-query` MCP tool 三种操作的 JSON 输出字段契约。

---

## cross-package 操作输出

**适用条件**: 仅在 monorepo 项目中可用。单包项目调用时返回错误。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | 是 | 文档标题 |
| generatedAt | string | 是 | 生成日期（YYYY-MM-DD） |
| projectName | string | 是 | 项目名称 |
| workspaceType | `'npm' \| 'pnpm' \| 'uv'` | 是 | Workspace 管理器类型 |
| mermaidDiagram | string | 是 | Mermaid 依赖图源代码（含循环标注） |
| levels | TopologyLevel[] | 是 | 按层级分组的拓扑排序结果 |
| topologicalOrder | string[] | 是 | 包名线性拓扑顺序（叶子优先） |
| hasCycles | boolean | 是 | 是否存在循环依赖 |
| cycleGroups | CycleGroup[] | 是 | 循环依赖组列表（无循环时为空数组） |
| stats | DependencyStats | 是 | 统计摘要 |

### TopologyLevel

| 字段 | 类型 | 说明 |
|------|------|------|
| level | number | 拓扑层级编号 |
| packages | string[] | 该层级包含的包名列表 |

### CycleGroup

| 字段 | 类型 | 说明 |
|------|------|------|
| packages | string[] | 参与循环的包名列表 |
| cyclePath | string | 循环路径的可读表示（如 `A -> B -> C -> A`） |

### DependencyStats

| 字段 | 类型 | 说明 |
|------|------|------|
| totalPackages | number | 子包总数 |
| totalEdges | number | 总依赖边数 |
| rootPackages | string[] | 入度为 0 的包列表 |
| leafPackages | string[] | 出度为 0 的包列表 |

---

## architecture-ir 操作输出

**适用条件**: 需要至少一个数据源（runtime topology 或 workspace index）可用。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| projectName | string | 是 | 项目名称 |
| generatedAt | string | 是 | 生成日期（ISO 8601） |
| sourceTags | string[] | 是 | 数据来源标签列表 |
| warnings | string[] | 是 | 分析警告信息列表 |
| elements | ArchitectureIRElement[] | 是 | 架构元素列表 |
| relationships | ArchitectureIRRelationship[] | 是 | 架构关系列表 |
| views | ArchitectureIRView[] | 是 | 架构视图列表 |
| stats | ArchitectureIRStats | 是 | 统计摘要 |
| metadata | Record<string, unknown> | 否 | 扩展元数据（透传字段，可选） |

---

## overview 操作输出

**适用条件**: 在单包和 monorepo 项目中均可用。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | 是 | 文档标题 |
| generatedAt | string | 是 | 生成日期 |
| model | ArchitectureOverviewModel | 是 | 架构概览模型 |
| warnings | string[] | 是 | 分析警告信息列表 |
| systemContext | ArchitectureViewSection | 否 | 系统上下文视图 |
| deploymentView | ArchitectureViewSection | 否 | 部署视图 |
| layeredView | ArchitectureViewSection | 否 | 分层视图 |

### ArchitectureOverviewModel 关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| sections | ArchitectureViewSection[] | 视图章节列表 |
| stats | object | 统计摘要 |
| moduleSummaries | object[] | 模块职责摘要列表 |

---

## 错误响应格式

当操作因条件不满足而失败时（如单包项目调用 cross-package）：

**CLI**: 标准错误输出可读错误信息，进程退出码非零。

**MCP**: 返回包含 `error` 字段的 JSON 文本（非 MCP isError）。

| 字段 | 类型 | 说明 |
|------|------|------|
| error | string | 可读错误描述 |
