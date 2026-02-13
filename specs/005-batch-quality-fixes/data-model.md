# Data Model: Batch 模块级聚合与生成质量提升

**Feature**: 005-batch-quality-fixes
**Date**: 2026-02-14

## 新增实体

### 1. ModuleGroup

模块分组单元，表示一个目录级模块及其包含的文件。

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 模块名称（如 `'auth'`、`'core'`、`'root'`） |
| `dirPath` | `string` | 模块对应的目录路径（相对于项目根，如 `'src/auth'`） |
| `files` | `string[]` | 模块内包含的文件路径（已排序） |

### 2. ModuleGroupResult

分组操作的完整结果，包含分组、排序和依赖关系。

| 字段 | 类型 | 说明 |
|------|------|------|
| `groups` | `ModuleGroup[]` | 所有模块分组 |
| `moduleOrder` | `string[]` | 模块级拓扑排序（叶子模块优先） |
| `moduleEdges` | `Array<{ from: string; to: string }>` | 模块间的聚合依赖边 |

### 3. GroupingOptions

分组配置参数。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `basePrefix` | `string?` | 自动检测 | 分组策略的基准目录前缀 |
| `depth` | `number?` | `1` | basePrefix 之后取几级目录 |
| `rootModuleName` | `string?` | `'root'` | 根目录散文件的模块名 |

## 修改的实体

### 4. BatchOptions（修改）

新增 `grouping` 字段。

| 字段 | 变更 | 说明 |
|------|------|------|
| `grouping` | **新增** `GroupingOptions?` | 模块分组选项，传递给 `groupFilesToModules()` |

### 5. GenerateSpecResult（修改）

新增 `moduleSpec` 字段。

| 字段 | 变更 | 说明 |
|------|------|------|
| `moduleSpec` | **新增** `ModuleSpec` | 完整的 ModuleSpec 对象，供 batch 索引生成使用 |

## 实体关系

```text
DependencyGraph
  │
  ▼ groupFilesToModules()
ModuleGroupResult
  ├── ModuleGroup[]
  ├── moduleOrder: string[]
  └── moduleEdges: {from, to}[]
        │
        ▼ batch-orchestrator 按 moduleOrder 遍历
      GenerateSpecResult（含 moduleSpec）
        │
        ▼ 收集所有 moduleSpec
      generateIndex(ModuleSpec[], graph)
        │
        ▼
      ArchitectureIndex
```

## 状态转换

无新增状态机。batch-orchestrator 的状态流与 001 一致，仅将处理粒度从文件改为模块。
