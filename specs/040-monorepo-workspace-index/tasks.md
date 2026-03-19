# Tasks: Monorepo 层级架构索引

**Input**: Design documents from `specs/040-monorepo-workspace-index/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md (required)

**Tests**: spec.md 的 SC-005 明确要求"全生命周期单元测试通过率 100%"，因此包含完整测试任务。

**Organization**: 任务按 User Story 分组，支持独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3, US4, US5）
- 每个任务包含精确文件路径

## Path Conventions

- 源码: `src/panoramic/`
- 模板: `templates/`
- 测试: `tests/panoramic/`

---

## Phase 1: Setup (共享基础设施)

**Purpose**: 类型定义、模板文件创建——所有 User Story 的公共基础

- [x] T001 [P] 在 `src/panoramic/workspace-index-generator.ts` 中定义 WorkspacePackageInfo、WorkspaceGroup、WorkspaceInput、WorkspaceOutput 四个 TypeScript 接口，与 data-model.md 对齐
- [x] T002 [P] 创建 Handlebars 模板 `templates/workspace-index.hbs`，包含标题、生成日期、按分组展示的子包列表表格（名称/路径/描述/语言列）和 Mermaid 依赖图代码块占位
- [x] T003 [P] 在 `src/panoramic/workspace-index-generator.ts` 中创建 WorkspaceIndexGenerator 类骨架，实现 `DocumentGenerator<WorkspaceInput, WorkspaceOutput>` 接口，填入 id='workspace-index'、name、description 元数据，四个生命周期方法暂留 stub

**Checkpoint**: 类型定义 + 模板 + 类骨架就绪，后续 Phase 可并行展开

---

## Phase 2: Foundational (阻塞性前置依赖)

**Purpose**: 公共工具函数——glob 展开、YAML 正则解析、TOML 正则解析，被多个 User Story 共享

- [x] T004 在 `src/panoramic/workspace-index-generator.ts` 中实现 `expandGlobPatterns(projectRoot: string, patterns: string[]): string[]` 私有辅助函数，使用 `fs.readdirSync` 展开 `*` 通配符匹配单层目录，精确路径直接返回，不存在的目录静默跳过
- [x] T005 [P] 在 `src/panoramic/workspace-index-generator.ts` 中实现 `parsePnpmWorkspaceYaml(content: string): string[]` 私有辅助函数，正则逐行解析 `- "pattern"` 或 `- 'pattern'` 或 `- pattern` 条目，返回 packages 列表；空内容或无 packages 字段返回 `[]`
- [x] T006 [P] 在 `src/panoramic/workspace-index-generator.ts` 中实现 `parseUvWorkspaceToml(content: string): string[]` 私有辅助函数，正则提取 `[tool.uv.workspace]` 段下 `members = [...]` 列表；空列表或段不存在返回 `[]`
- [x] T007 [P] 在 `src/panoramic/workspace-index-generator.ts` 中实现 `detectLanguage(packageDir: string): string` 私有辅助函数，根据目录内文件特征推断语言（存在 `tsconfig.json` -> TypeScript；存在 `package.json` 且无 tsconfig -> JavaScript；存在 `pyproject.toml` -> Python；否则 Unknown）
- [x] T008 [P] 在 `src/panoramic/workspace-index-generator.ts` 中实现 `sanitizeMermaidId(name: string): string` 私有辅助函数，将 `@`、`/`、`-`、`.` 等特殊字符替换为 `_`，确保生成合法的 Mermaid 节点 ID

**Checkpoint**: 公共工具函数就绪，User Story 实现可以开始

---

## Phase 3: User Story 1 - npm/pnpm Monorepo 层级索引生成 (Priority: P1) -- MVP

**Goal**: 对 npm workspaces 或 pnpm workspaces 的 Monorepo 项目，完成 extract -> generate -> render 全生命周期，输出包含子包列表和 Mermaid 依赖图的 Markdown 索引文档

**Independent Test**: 创建测试用的 npm/pnpm workspace 目录结构，运行全生命周期，验证输出 Markdown 内容

### Tests for User Story 1

> **NOTE: 先写测试，确认 FAIL，再实现**

- [x] T009 [P] [US1] 在 `tests/panoramic/workspace-index-generator.test.ts` 中创建测试文件，编写 npm workspace extract 测试：构造包含 `package.json` workspaces 字段和 3 个子包目录的 tmp 文件系统，验证 extract 返回 workspaceType='npm' 且 packages 长度为 3
- [x] T010 [P] [US1] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 pnpm workspace extract 测试：构造包含 `pnpm-workspace.yaml` 和多个子包目录的 tmp 文件系统（packages/* + apps/*），验证 extract 返回 workspaceType='pnpm' 且按层级正确分组
- [x] T011 [P] [US1] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写内部依赖提取测试：子包 A 的 dependencies 引用同 workspace 的子包 B，验证 extract 返回的 A.dependencies 包含 B 的包名

### Implementation for User Story 1

- [x] T012 [US1] 在 `src/panoramic/workspace-index-generator.ts` 的 `extract()` 方法中实现 workspace 管理器类型检测逻辑：优先检查 `pnpm-workspace.yaml` -> 检查 `package.json` workspaces 字段 -> 返回 'npm'/'pnpm' 类型
- [x] T013 [US1] 在 `src/panoramic/workspace-index-generator.ts` 的 `extract()` 方法中实现 npm/pnpm workspace 的 members 解析 + glob 展开：调用 T004 的 expandGlobPatterns，然后逐个读取子包 `package.json`，提取 name、description、dependencies/devDependencies 中的 workspace 内部引用
- [x] T014 [US1] 在 `src/panoramic/workspace-index-generator.ts` 的 `extract()` 方法中实现子包元信息容错：JSON 解析失败时 console.warn 并跳过该子包；缺少 name 时降级为目录名；空目录（无 package.json）静默跳过
- [x] T015 [US1] 在 `src/panoramic/workspace-index-generator.ts` 的 `generate()` 方法中实现 WorkspaceInput -> WorkspaceOutput 转换：构建 title、generatedAt、按路径第一级目录分组为 WorkspaceGroup[]、计算 totalPackages
- [x] T016 [US1] 在 `src/panoramic/workspace-index-generator.ts` 的 `render()` 方法中实现 Handlebars 模板渲染：读取 `templates/workspace-index.hbs`，注册必要的 helper（如分组展示），编译并渲染 WorkspaceOutput 为 Markdown 字符串

**Checkpoint**: npm/pnpm Monorepo 全生命周期可工作，测试通过

---

## Phase 4: User Story 2 - uv (Python) Monorepo 层级索引生成 (Priority: P1)

**Goal**: 扩展 extract 以支持 uv workspace 的 `pyproject.toml` 解析，提取 Python 子包的元信息

**Independent Test**: 创建测试用的 uv workspace 目录结构（根 pyproject.toml + 子包 pyproject.toml），运行全生命周期

### Tests for User Story 2

> **NOTE: 先写测试，确认 FAIL，再实现**

- [x] T017 [P] [US2] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 uv workspace extract 测试：构造包含根 `pyproject.toml`（含 `[tool.uv.workspace]` 段，members 列出 packages/core 和 apps/gateway）和对应子包 `pyproject.toml` 的 tmp 文件系统，验证 extract 返回 workspaceType='uv' 且 packages 包含两个子包
- [x] T018 [P] [US2] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 uv 子包元信息提取测试：验证子包 pyproject.toml 的 `[project]` 表中 name、description、dependencies 被正确提取
- [x] T019 [P] [US2] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 uv workspace 精确路径测试：members 使用精确路径（非 glob），验证系统正确定位每个子包目录

### Implementation for User Story 2

- [x] T020 [US2] 在 `src/panoramic/workspace-index-generator.ts` 的 `extract()` 方法中扩展 workspace 检测链：在 npm/pnpm 检测之后增加 `pyproject.toml` 的 `[tool.uv.workspace]` 段检测，调用 T006 的 parseUvWorkspaceToml
- [x] T021 [US2] 在 `src/panoramic/workspace-index-generator.ts` 中实现 `extractPyprojectInfo(packageDir: string, allPackageNames: string[]): WorkspacePackageInfo | null` 私有方法，正则解析子包 `pyproject.toml` 的 `[project]` 表提取 name、description，从 `dependencies` 列表中匹配 workspace 内部引用
- [x] T022 [US2] 在 `src/panoramic/workspace-index-generator.ts` 的 `extract()` 方法中整合 uv 路径：对 uv workspace 的 members 列表调用 expandGlobPatterns（支持精确路径直通），然后逐个调用 extractPyprojectInfo，容错处理同 npm

**Checkpoint**: uv workspace 全生命周期可工作，Python 和 Node.js Monorepo 均支持

---

## Phase 5: User Story 3 - isApplicable 适用性判断 (Priority: P2)

**Goal**: 仅当 ProjectContext.workspaceType === 'monorepo' 时 WorkspaceIndexGenerator 才适用

**Independent Test**: 分别传入 monorepo 和 single 类型的 ProjectContext，验证返回值

### Tests for User Story 3

- [x] T023 [P] [US3] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 isApplicable 测试：workspaceType='monorepo' 时返回 true
- [x] T024 [P] [US3] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 isApplicable 测试：workspaceType='single' 时返回 false

### Implementation for User Story 3

- [x] T025 [US3] 在 `src/panoramic/workspace-index-generator.ts` 的 `isApplicable()` 方法中实现逻辑：`return context.workspaceType === 'monorepo'`（同步返回，无文件 I/O）

**Checkpoint**: 非 Monorepo 项目不会误触发索引生成

---

## Phase 6: User Story 4 - Mermaid 包级依赖图生成 (Priority: P2)

**Goal**: 分析所有子包的内部依赖关系，生成 Mermaid graph TD 拓扑图

**Independent Test**: 构造明确内部依赖的多子包项目，验证 generate 输出的 dependencyDiagram 为合法 Mermaid 语法

### Tests for User Story 4

- [x] T026 [P] [US4] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 Mermaid 依赖图测试：A 依赖 B、B 依赖 C，验证输出包含 `A --> B` 和 `B --> C`
- [x] T027 [P] [US4] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写无内部依赖测试：所有子包无相互引用，验证输出包含所有节点但无边
- [x] T028 [P] [US4] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写特殊字符转义测试：子包名为 `@scope/package`，验证 Mermaid 节点 ID 不含非法字符
- [x] T029 [P] [US4] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写循环依赖测试：A 依赖 B、B 依赖 A，验证 Mermaid 图如实呈现循环边

### Implementation for User Story 4

- [x] T030 [US4] 在 `src/panoramic/workspace-index-generator.ts` 的 `generate()` 方法中实现 `buildMermaidDiagram(packages: WorkspacePackageInfo[]): string` 私有方法，遍历所有子包的 dependencies 列表，生成 `graph TD` 格式的 Mermaid 源码，使用 sanitizeMermaidId 转义节点 ID
- [x] T031 [US4] 在 `buildMermaidDiagram` 中处理边界情况：无内部依赖时生成仅含节点的图并附注 `%% 无内部依赖`；循环依赖如实呈现

**Checkpoint**: Mermaid 依赖图正确生成，覆盖正常、空依赖、特殊字符、循环依赖场景

---

## Phase 7: User Story 5 - Handlebars 模板渲染 (Priority: P2)

**Goal**: 通过 Handlebars 模板将 WorkspaceOutput 渲染为格式一致的 Markdown 文档

**Independent Test**: 构造 WorkspaceOutput 对象，调用 render，验证输出 Markdown 结构

### Tests for User Story 5

- [x] T032 [P] [US5] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 render 测试：传入包含 3 个子包和依赖图的 WorkspaceOutput，验证输出 Markdown 包含标题、日期、子包表格和 Mermaid 代码块
- [x] T033 [P] [US5] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 render 分组展示测试：WorkspaceOutput 含 packages 和 apps 两个 group，验证输出 Markdown 按分组展示

### Implementation for User Story 5

- [x] T034 [US5] 完善 `templates/workspace-index.hbs` 模板：实现标题区（项目名 + 生成日期）、按 groups 迭代展示子包列表表格（名称 | 路径 | 描述 | 语言）、Mermaid 依赖图代码块、统计信息（总包数）
- [x] T035 [US5] 在 `src/panoramic/workspace-index-generator.ts` 的 `render()` 方法中注册 Handlebars helpers（如有需要），完善模板渲染逻辑，确保输出 Markdown 在 GitHub 可正确渲染

**Checkpoint**: 完整 Markdown 文档渲染正确，格式和结构达标

---

## Phase 8: Integration & Registration (集成注册)

**Purpose**: 将 WorkspaceIndexGenerator 注册到 GeneratorRegistry 并导出

- [x] T036 在 `src/panoramic/generator-registry.ts` 的 `bootstrapGenerators()` 函数中导入并注册 `new WorkspaceIndexGenerator()`
- [x] T037 [P] 在 `src/panoramic/index.ts` 中导出 WorkspaceIndexGenerator 类及 WorkspacePackageInfo、WorkspaceInput、WorkspaceOutput、WorkspaceGroup 类型
- [x] T038 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写注册测试：验证 bootstrapGenerators() 后 GeneratorRegistry 可通过 id='workspace-index' 查询到 WorkspaceIndexGenerator 实例

**Checkpoint**: Generator 注册完成，可通过 Registry 发现和调用

---

## Phase 9: Edge Cases & Error Handling (边界情况)

**Purpose**: 覆盖 spec.md 中列出的所有 Edge Cases

- [x] T039 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 edge case 测试：glob 模式匹配到空目录（无 package.json），验证静默跳过
- [x] T040 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 edge case 测试：子包 package.json 格式异常（非法 JSON），验证 console.warn 并跳过该子包
- [x] T041 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 edge case 测试：workspace 配置文件不可读，验证 extract 返回空 packages 列表
- [x] T042 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 edge case 测试：pnpm-workspace.yaml 为空或无 packages 字段，验证返回空列表
- [x] T043 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 edge case 测试：pyproject.toml 的 members 为空数组，验证返回空列表
- [x] T044 [P] 在 `tests/panoramic/workspace-index-generator.test.ts` 中编写 edge case 测试：glob 目标目录不存在，验证静默跳过

**Checkpoint**: 所有 edge case 覆盖完成，系统在异常输入下行为可预期

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: 代码清理、文档和最终验证

- [x] T045 [P] 在 `src/panoramic/workspace-index-generator.ts` 顶部添加完整的文件级 JSDoc 注释，说明模块职责、依赖和使用方式
- [x] T046 [P] 确认 `templates/workspace-index.hbs` 输出的 Markdown 在 GitHub Preview 中正确渲染 Mermaid 图
- [x] T047 运行 `npm test` 确认全部测试通过，运行 `npm run lint` 确认无 lint 错误
- [x] T048 [P] 检查所有新增文件的 import 路径使用 `.js` 后缀（ESM 规范），确认 TypeScript 编译无错误

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|---------|
| FR-001 | 实现 DocumentGenerator 完整生命周期 | T003, T012-T016, T025, T030, T035 |
| FR-002 | isApplicable 仅 monorepo 返回 true | T025 |
| FR-003 | extract 支持 npm workspace | T012, T013 |
| FR-004 | extract 支持 pnpm workspace | T005, T012, T013 |
| FR-005 | extract 支持 uv workspace | T006, T020, T021, T022 |
| FR-006 | fs.readdirSync 展开 glob 模式 | T004 |
| FR-007 | 纯正则解析 pyproject.toml | T006, T021 |
| FR-008 | 提取子包 name/path/description/language/dependencies | T013, T014, T021, T007 |
| FR-009 | 生成 Mermaid graph TD 依赖图 | T030, T031 |
| FR-010 | Handlebars 模板渲染 | T002, T034, T035 |
| FR-011 | bootstrapGenerators() 注册 | T036 |
| FR-012 | 自动推断主要语言 | T007 |
| FR-013 | 按层级分组展示子包 | T015, T034 |
| FR-014 | 子包提取失败时记录警告并跳过 | T014, T039, T040, T041 |

**FR 覆盖率**: 14/14 = **100%**

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)        -> 无依赖，立即开始
Phase 2 (Foundational) -> 依赖 Phase 1（T001 类型定义）
Phase 3 (US1 npm/pnpm) -> 依赖 Phase 2（glob 展开、YAML 解析工具函数）
Phase 4 (US2 uv)       -> 依赖 Phase 2（TOML 解析工具函数）+ Phase 3（extract 框架）
Phase 5 (US3 isAppl.)  -> 依赖 Phase 1（类骨架）
Phase 6 (US4 Mermaid)  -> 依赖 Phase 3（generate 框架 + sanitizeMermaidId）
Phase 7 (US5 Template) -> 依赖 Phase 3（render 框架 + 模板）
Phase 8 (Integration)  -> 依赖 Phase 3-7 全部完成
Phase 9 (Edge Cases)   -> 依赖 Phase 3-4（extract 实现完成）
Phase 10 (Polish)      -> 依赖 Phase 8-9 完成
```

### User Story 间依赖

- **US1 (npm/pnpm)** 和 **US2 (uv)**: US2 依赖 US1 的 extract 框架结构，但 uv 解析逻辑独立。建议 US1 先完成。
- **US3 (isApplicable)**: 独立于 US1/US2，可与 Phase 3 并行。
- **US4 (Mermaid)**: 依赖 US1 的 generate 框架和 T008 的 sanitizeMermaidId。
- **US5 (Template)**: 依赖 US1 的 render 框架。

### 并行机会

- Phase 1 内 T001、T002、T003 全部可并行
- Phase 2 内 T005、T006、T007、T008 可并行（T004 无依赖也可并行）
- Phase 3 与 Phase 5 (US3) 可并行
- Phase 6 (US4) 与 Phase 7 (US5) 可并行（均依赖 Phase 3 完成）
- Phase 9 全部 edge case 测试可并行
- Phase 10 的 T045、T046、T048 可并行

### Implementation Strategy

**推荐: Incremental Delivery (增量交付)**

1. Phase 1 + Phase 2 -> 基础设施就绪
2. Phase 3 (US1) -> npm/pnpm Monorepo 可工作 -> **MVP!**
3. Phase 5 (US3) -> 适用性守卫就位（可与 Phase 3 并行）
4. Phase 4 (US2) -> uv workspace 支持
5. Phase 6 (US4) + Phase 7 (US5) -> 依赖图和模板完善（可并行）
6. Phase 8 -> 注册集成
7. Phase 9 -> edge case 加固
8. Phase 10 -> 打磨验证

**MVP 范围**: US1 (npm/pnpm Monorepo 层级索引生成) + US3 (isApplicable 适用性判断)

---

## Notes

- 所有新增代码在单一文件 `src/panoramic/workspace-index-generator.ts` 中实现（遵循项目现有 Generator 单文件模式）
- 类型定义内联于同文件，不单独拆分 types 文件
- 测试集中在单一文件 `tests/panoramic/workspace-index-generator.test.ts`
- 不引入任何新的运行时依赖（仅使用 Node.js 内置模块 + 现有 handlebars）
- [P] 标记的任务操作不同文件或同文件的不同独立区域，无写入冲突
- Commit 建议：每个 Phase 完成后提交一次
