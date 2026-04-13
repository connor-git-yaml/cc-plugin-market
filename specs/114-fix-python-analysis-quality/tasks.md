# 114 — 任务分解

## Task 1: PackageManagerSchema 新增 poetry 枚举值
- 文件: `src/panoramic/interfaces.ts`
- 在 PackageManagerSchema 的 z.enum 数组中追加 `'poetry'`

## Task 2: detectPackageManager 追加 pyproject.toml 降级检测
- 文件: `src/panoramic/project-context.ts`
- 在 `return 'unknown'` 前检测 pyproject.toml
- 含 `[tool.poetry]` → 返回 `'poetry'`
- 否则 → 返回 `'pip'`

## Task 3: module-grouper 文件级分组自动降级
- 文件: `src/batch/module-grouper.ts`
- 在步骤 2（构建 ModuleGroup 列表）之后插入判断
- 条件：非 root 模块只有 1 个且文件数 > 1
- 动作：拆分为文件级 ModuleGroup（name = 文件 stem，dirPath 不变）

## Task 4: MCP graph 工具 projectRoot 参数
- 文件: `src/mcp/graph-tools.ts`
- cachedEngine 从单实例改为 `Map<string, GraphQueryEngine>`
- getEngine 接受可选 projectRoot 参数
- 5 个 tool schema 各新增可选 projectRoot 参数
- handler 内传递 projectRoot 给 getEngine

## Task 5: 单元测试
- module-grouper 测试：扁平单包分组 → 文件级模块
- project-context 测试：pyproject.toml → pip / poetry 检测

## Task 6: 构建 + 全量测试验证
- `npm run build`
- `npx vitest run`
