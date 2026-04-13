# 114 — 修复 Python 项目分析质量三项问题

> 来源：Spectra v3.0.1 对 Graphify（22k+ star Python 项目）的实测暴露

## 背景

使用 Spectra batch 分析 Graphify（单包 Python 项目，20 个 .py 文件平铺在根包目录下）时发现三个问题：

1. **模块分组粒度过粗**：`module-grouper.ts` 使用目录级分组，20 个 .py 文件被归为 1 个模块，知识图谱仅 1 节点 0 边
2. **MCP graph 工具路径绑定错误**：5 个 graph tool handler 使用 `process.cwd()` 解析 graph.json 路径，MCP Server 的 cwd 通常不等于目标项目目录
3. **Python 包管理器未识别**：`detectPackageManager` 仅检测 lock 文件，纯 pyproject.toml 项目（无 uv.lock/Pipfile.lock）返回 `unknown`

## 需求（User Stories）

### US-1: 扁平 Python 包的文件级分组

**作为** Spectra 用户，分析单包扁平 Python 项目时，**我希望** 每个 .py 文件被识别为独立模块节点，**以便** 知识图谱能反映文件间真实的 import 依赖关系。

**验收标准**：
- AC-1.1: 当所有源文件在同一目录下且文件数 > 1 时，自动切换到文件级分组
- AC-1.2: 文件级模块名使用文件名去扩展名（如 `pipeline` 来自 `pipeline.py`）
- AC-1.3: 模块间依赖边正确聚合（文件级时即原始文件级边）
- AC-1.4: 拓扑排序正常工作
- AC-1.5: 不影响已有的目录级分组行为（多目录项目仍按目录分组）

### US-2: MCP graph 工具支持 projectRoot 参数

**作为** MCP 客户端调用者，**我希望** graph_query 等 5 个工具接受 `projectRoot` 参数指定目标项目路径，**以便** 在任意 cwd 下查询指定项目的知识图谱。

**验收标准**：
- AC-2.1: 5 个 graph tool 均新增可选 `projectRoot` 参数
- AC-2.2: 传入 `projectRoot` 时从该路径解析 graph.json
- AC-2.3: 未传入时保持 `process.cwd()` 行为（向后兼容）
- AC-2.4: `projectRoot` 变更时自动刷新缓存（不同项目不共享 engine 实例）

### US-3: 识别 pyproject.toml 作为 Python 包管理器标识

**作为** Spectra 用户，分析纯 pyproject.toml 管理的 Python 项目时，**我希望** 包管理器被正确识别为 `pip`，**以便** architecture-narrative 输出正确的包管理器信息。

**验收标准**：
- AC-3.1: 当项目根目录有 pyproject.toml 但无 uv.lock/Pipfile.lock 时，返回 `pip`
- AC-3.2: 已有 lock 文件时优先匹配 lock 文件（优先级不变）
- AC-3.3: pyproject.toml 含 `[tool.poetry]` 段时返回 `poetry` 而非 `pip`

## 功能需求

### FR-1: module-grouper.ts — 自动文件级分组

在 `groupFilesToModules` 中，当目录级分组后仅产生 1 个包含多文件的模块时（排除 root 模块），自动降级为文件级分组：每个文件作为独立 ModuleGroup，名称为文件 stem。

### FR-2: graph-tools.ts — projectRoot 参数注入

为 5 个 tool handler 的 schema 添加可选 `projectRoot` 参数。修改 `getEngine()` 为接受路径参数，按路径缓存 engine 实例。

### FR-3: project-context.ts — pyproject.toml 降级检测

在 `detectPackageManager` 的 lock 文件检测链之后，追加 pyproject.toml 检测：
- 含 `[tool.poetry]` → `poetry`
- 否则 → `pip`

需要先在 `PackageManagerSchema` 中新增 `poetry` 枚举值。

## 非功能需求

- NFR-1: 所有改动向后兼容，不改变现有项目的分析结果
- NFR-2: 单元测试覆盖新增逻辑
