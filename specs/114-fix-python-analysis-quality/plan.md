# 114 — 技术规划

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/batch/module-grouper.ts` | 修改 | 新增文件级分组自动降级逻辑 |
| `src/mcp/graph-tools.ts` | 修改 | 5 个 tool handler 添加 projectRoot 参数，getEngine 改为按路径缓存 |
| `src/panoramic/project-context.ts` | 修改 | detectPackageManager 追加 pyproject.toml 降级检测 |
| `src/panoramic/interfaces.ts` | 修改 | PackageManagerSchema 新增 `poetry` 枚举值 |
| `tests/unit/module-grouper.test.ts` | 修改 | 新增文件级分组测试用例 |
| `tests/unit/project-context.test.ts` | 修改 | 新增 pyproject.toml 检测测试 |

## 实现策略

### Fix 1: 文件级分组自动降级

在 `groupFilesToModules` 的步骤 2 之后、步骤 3 之前插入判断逻辑：

```
if 目录级分组后只有 1 个非 root 模块 且 该模块文件数 > 1:
  拆分为文件级模块（每个文件一个 ModuleGroup，name = stem）
```

这样对多目录项目无影响（命中条件的只有扁平单包项目）。

### Fix 2: MCP graph 工具 projectRoot

将模块级 `cachedEngine` 从单实例改为 `Map<string, GraphQueryEngine>` 按 projectRoot 缓存。`getEngine(projectRoot?: string)` 接受可选路径参数。5 个 tool schema 各新增一个可选 `projectRoot` z.string()。

### Fix 3: pyproject.toml 检测

在 `detectPackageManager` 末尾 `return 'unknown'` 前插入 pyproject.toml 检测。读取内容判断是否包含 `[tool.poetry]` 段，分别返回 `poetry` 或 `pip`。

## 风险评估

- 低风险：所有改动都有明确的向后兼容保证
- 文件级分组仅在"1 个模块"条件下触发，不影响已有多目录项目
