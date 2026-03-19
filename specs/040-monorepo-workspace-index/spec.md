# Feature Specification: Monorepo 层级架构索引

**Feature Branch**: `040-monorepo-workspace-index`
**Created**: 2026-03-19
**Status**: Draft
**Input**: 实现 WorkspaceIndexGenerator（DocumentGenerator 接口），为 Monorepo 项目生成 packages/apps 层级索引文档

## User Scenarios & Testing *(mandatory)*

### User Story 1 - npm/pnpm Monorepo 层级索引生成 (Priority: P1)

开发者对一个使用 npm workspaces 或 pnpm workspaces 的 Monorepo 项目运行 WorkspaceIndexGenerator，系统自动检测 workspace 配置、解析 glob 模式展开子包目录、提取每个子包的 package.json 元信息（名称、描述、依赖），生成包含层级结构和包级 Mermaid 依赖图的 Markdown 索引文档。

**Why this priority**: npm/pnpm 是 JavaScript/TypeScript 生态中最主流的 Monorepo 管理方式，覆盖了绝大多数 Node.js Monorepo 项目，且 glob 展开逻辑是所有 workspace 类型共享的基础能力

**Independent Test**: 创建一个包含 `package.json` workspaces 字段和 `packages/*/package.json` 子包的测试项目，运行 WorkspaceIndexGenerator 的全生命周期（isApplicable -> extract -> generate -> render），验证输出的 Markdown 包含所有子包信息和 Mermaid 依赖图

**Acceptance Scenarios**:

1. **Given** 项目 `package.json` 包含 `workspaces: ["packages/*"]` 字段且 `packages/` 下有 3 个子包，**When** 运行 WorkspaceIndexGenerator，**Then** 生成的索引文档列出全部 3 个子包的名称、描述和内部依赖关系
2. **Given** 项目使用 pnpm 且存在 `pnpm-workspace.yaml`（内容 `packages: ["packages/*", "apps/*"]`），**When** 运行 WorkspaceIndexGenerator，**Then** 生成的索引文档分别展示 `packages/` 和 `apps/` 两个层级分组下的子包
3. **Given** 子包 A 的 `package.json` dependencies 引用了同一 workspace 内的子包 B，**When** 运行 WorkspaceIndexGenerator，**Then** 生成的 Mermaid 依赖图包含从 A 指向 B 的依赖边

---

### User Story 2 - uv (Python) Monorepo 层级索引生成 (Priority: P1)

开发者对一个使用 uv workspace 的 Python Monorepo 项目（如 OctoAgent）运行 WorkspaceIndexGenerator，系统解析根 `pyproject.toml` 的 `[tool.uv.workspace]` 段，提取 members 列表，然后解析每个子包的 `pyproject.toml` 元信息，生成层级索引文档。

**Why this priority**: OctoAgent 作为蓝图验证目标项目使用 uv workspace，此 Story 直接关联蓝图验证标准，与 npm/pnpm 同等重要

**Independent Test**: 创建一个包含根 `pyproject.toml`（含 `[tool.uv.workspace]` 段）和多个子包 `pyproject.toml` 的测试项目，运行全生命周期，验证子包信息完整

**Acceptance Scenarios**:

1. **Given** 项目根 `pyproject.toml` 包含 `[tool.uv.workspace]` 段，members 列出 `packages/core` 和 `apps/gateway`，**When** 运行 WorkspaceIndexGenerator，**Then** 生成的索引文档正确列出这两个子包的名称和描述
2. **Given** 子包 `pyproject.toml` 的 `[project]` 表包含 `name`、`description`、`dependencies` 字段，**When** 运行 WorkspaceIndexGenerator，**Then** 提取的子包信息中名称、描述、内部依赖均正确
3. **Given** uv workspace 的 members 使用精确路径（如 `"packages/core"`）而非 glob 模式，**When** 运行 WorkspaceIndexGenerator，**Then** 系统正确识别每个精确路径并定位子包

---

### User Story 3 - isApplicable 适用性判断 (Priority: P2)

系统根据 ProjectContext 的 workspaceType 字段判断当前项目是否为 Monorepo。仅当 workspaceType 为 'monorepo' 时 WorkspaceIndexGenerator 才适用。

**Why this priority**: 适用性判断是 Generator 生命周期的入口守卫，确保非 Monorepo 项目不会误触发索引生成，但功能价值依赖于 P1 Story 的核心生成逻辑

**Independent Test**: 分别传入 workspaceType 为 'monorepo' 和 'single' 的 ProjectContext，验证 isApplicable 返回值

**Acceptance Scenarios**:

1. **Given** ProjectContext 的 workspaceType 为 'monorepo'，**When** 调用 isApplicable，**Then** 返回 true
2. **Given** ProjectContext 的 workspaceType 为 'single'，**When** 调用 isApplicable，**Then** 返回 false

---

### User Story 4 - Mermaid 包级依赖图生成 (Priority: P2)

系统在生成索引文档时，分析所有子包之间的内部依赖关系（仅 workspace 内引用），生成 Mermaid `graph TD` 格式的包级依赖拓扑图，嵌入到最终 Markdown 文档中。

**Why this priority**: Mermaid 依赖图是蓝图验证标准要求的关键输出，让开发者直观理解子包间的层级关系，但核心价值建立在 P1 子包信息提取正确的基础之上

**Independent Test**: 构造包含明确内部依赖的多子包项目，运行 generate 步骤，验证输出的 dependencyDiagram 字段为合法的 Mermaid graph TD 语法

**Acceptance Scenarios**:

1. **Given** workspace 包含子包 A、B、C，其中 A 依赖 B、B 依赖 C，**When** 运行 generate，**Then** 输出的 Mermaid 图包含 `A --> B` 和 `B --> C` 两条边
2. **Given** workspace 内所有子包之间无内部依赖，**When** 运行 generate，**Then** 输出的 Mermaid 图包含所有子包节点但无依赖边，并附注"无内部依赖"

---

### User Story 5 - Handlebars 模板渲染 (Priority: P2)

系统通过 Handlebars 模板 `workspace-index.hbs` 将结构化的 WorkspaceOutput 渲染为格式一致的 Markdown 文档，包含标题、生成时间、子包列表表格和 Mermaid 依赖图。

**Why this priority**: 模板渲染是 Generator 生命周期的最后一步，决定最终文档的呈现质量，但其价值依赖于前序步骤的数据正确性

**Independent Test**: 构造一个 WorkspaceOutput 对象，调用 render 方法，验证输出 Markdown 的结构和格式

**Acceptance Scenarios**:

1. **Given** 一个包含 3 个子包和依赖图的 WorkspaceOutput，**When** 调用 render，**Then** 输出的 Markdown 包含标题、生成日期、子包列表表格（含名称/路径/描述/语言列）和 Mermaid 代码块
2. **Given** WorkspaceOutput 中的 dependencyDiagram 为非空字符串，**When** 调用 render，**Then** 输出的 Markdown 包含 ` ```mermaid ` 代码块且可在 GitHub 正确渲染

---

### Edge Cases

- workspace 配置中的 glob 模式匹配到空目录（无 package.json 或 pyproject.toml）时，应跳过该目录而非报错
- 子包的 package.json 或 pyproject.toml 格式异常（JSON 解析失败或缺少必要字段）时，应记录警告并跳过该子包，继续处理其他子包
- workspace 配置文件本身不可读或格式异常时，extract 应返回空的 packages 列表，不应抛出异常
- pnpm-workspace.yaml 使用 YAML 格式但内容为空或无 packages 字段时，应返回空 packages 列表
- pyproject.toml 的 `[tool.uv.workspace]` 段 members 列表为空数组时，应返回空 packages 列表
- glob 模式（如 `packages/*`）展开时目标目录不存在，应静默跳过
- 子包之间存在循环依赖时，Mermaid 依赖图应如实呈现循环边而非过滤或报错
- 子包名称包含特殊字符（如 `@scope/package`）时，Mermaid 节点 ID 应正确转义

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 实现 `DocumentGenerator<WorkspaceInput, WorkspaceOutput>` 接口的完整生命周期（isApplicable -> extract -> generate -> render）
- **FR-002**: isApplicable MUST 当且仅当 `projectContext.workspaceType === 'monorepo'` 时返回 true
- **FR-003**: extract MUST 支持从 `package.json` 的 `workspaces` 字段解析 npm/yarn workspace 的 members 列表
- **FR-004**: extract MUST 支持从 `pnpm-workspace.yaml` 的 `packages` 字段解析 pnpm workspace 的 members 列表
- **FR-005**: extract MUST 支持从 `pyproject.toml` 的 `[tool.uv.workspace]` 段解析 uv workspace 的 members 列表
- **FR-006**: extract MUST 使用 `fs.readdirSync` 展开 npm/pnpm workspace 的 glob 模式（如 `packages/*`），不引入额外 glob 库
- **FR-007**: extract MUST 使用纯正则解析 `pyproject.toml`，不引入 TOML 解析库
- **FR-008**: extract MUST 为每个子包提取名称（name）、相对路径（path）、描述（description）、主要语言（language）和内部依赖列表（dependencies）
- **FR-009**: generate MUST 生成 Mermaid `graph TD` 格式的包级依赖拓扑图，仅包含 workspace 内部的引用关系
- **FR-010**: render MUST 通过 Handlebars 模板 `templates/workspace-index.hbs` 渲染最终 Markdown 输出
- **FR-011**: 系统 MUST 在 `bootstrapGenerators()` 函数中注册 WorkspaceIndexGenerator 实例
- **FR-012**: extract SHOULD 根据子包目录内的文件特征自动推断主要语言（如存在 `pyproject.toml` 推断为 Python，存在 `package.json` 推断为 TypeScript/JavaScript）
- **FR-013**: generate SHOULD 按层级分组展示子包（如将 `packages/` 和 `apps/` 分为不同分组）
- **FR-014**: 系统 MUST 在子包元信息提取失败（JSON/TOML 解析错误）时记录警告并跳过该子包，不中断整体流程

### Key Entities

- **WorkspacePackageInfo**: 单个子包的元信息，包含 name（包名）、path（相对路径）、description（描述）、language（主要语言）、dependencies（workspace 内部依赖列表）
- **WorkspaceInput**: extract 步骤输出，包含 projectName（项目名）、workspaceType（workspace 管理器类型：npm/pnpm/uv）、packages（WorkspacePackageInfo 数组）
- **WorkspaceOutput**: generate 步骤输出，包含 title（文档标题）、projectName、generatedAt（生成日期）、packages、dependencyDiagram（Mermaid graph TD 字符串）、totalPackages（子包总数）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对 OctoAgent 项目（uv workspace，7 个 packages + 1 个 app）运行 WorkspaceIndexGenerator，生成的索引文档正确列出全部 8 个子包的名称、路径和描述
- **SC-002**: 生成的 Mermaid 依赖图语法正确，反映子包间的实际内部依赖关系，可在 GitHub Markdown 预览中正常渲染
- **SC-003**: 对 npm workspaces 项目，glob 模式展开正确匹配所有子包目录，零遗漏零误报
- **SC-004**: 对不包含 workspace 配置的单包项目，isApplicable 返回 false，不触发任何文件 I/O
- **SC-005**: 全生命周期（isApplicable -> extract -> generate -> render）单元测试通过率 100%
- **SC-006**: WorkspaceIndexGenerator 在 bootstrapGenerators() 中成功注册，可通过 GeneratorRegistry 按 id 'workspace-index' 查询到
