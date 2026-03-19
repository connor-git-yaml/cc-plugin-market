# Feature Specification: ProjectContext 统一上下文

**Feature Branch**: `035-project-context-unified`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "扩展 Feature 034 中定义的最小 ProjectContext 占位版本，添加完整的项目元信息。实现 buildProjectContext(projectRoot) 构建函数，支持包管理器检测、workspace 类型识别、多语言检测、配置文件扫描和已有 spec 文件发现。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 包管理器自动检测（Priority: P1）

作为全景文档化流程的调用方（Generator 或 CLI 命令），我需要 `buildProjectContext(projectRoot)` 能根据项目根目录下的 lock 文件自动识别使用的包管理器（npm / yarn / pnpm / uv / go / maven / gradle / pipenv），以便后续 Generator（如 ConfigReferenceGenerator、WorkspaceAnalyzer）无需重复实现包管理器探测逻辑。

**Why this priority**: 包管理器是项目元信息中最基础的判断依据之一。它决定了依赖解析方式、workspace 配置格式和 lock 文件位置。Feature 040（Monorepo 层级架构索引）和 Feature 039（配置参考手册）均需要此信息来选择正确的解析策略。且检测逻辑简单明确（基于 lock 文件存在性判断），是 buildProjectContext 最核心的子能力。

**Independent Test**: 在一个包含 `package-lock.json` 的临时目录上调用 `buildProjectContext()`，验证返回的 `packageManager` 为 `"npm"`；在一个包含 `uv.lock` 的临时目录上调用，验证返回 `"uv"`。

**Acceptance Scenarios**:

1. **Given** 项目根目录下存在 `package-lock.json`，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `packageManager` 值为 `"npm"`
2. **Given** 项目根目录下存在 `uv.lock` 和 `pyproject.toml`，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `packageManager` 值为 `"uv"`
3. **Given** 项目根目录下不存在任何已知的 lock 文件或包管理器标识文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `packageManager` 值为 `"unknown"`

---

### User Story 2 - Workspace 类型识别（Priority: P1）

作为 Monorepo 层级架构索引（Feature 040）的调用前提，我需要 `buildProjectContext()` 能判断项目是单包（single）还是 Monorepo（monorepo），以便 WorkspaceAnalyzer 决定是否启用子包扫描逻辑。

**Why this priority**: workspace 类型是蓝图验证标准的两大核心检测项之一（"对 OctoAgent 项目运行 ProjectContext 构建，workspaceType 为 monorepo"）。Feature 040（Monorepo 索引）和 Feature 041（跨包依赖分析）的 `isApplicable()` 判断直接依赖 `workspaceType` 属性。与 Story 1 同为 P1 因为两者是蓝图验证标准的必选验证项。

**Independent Test**: 在一个包含 `pnpm-workspace.yaml` 的临时目录上调用 `buildProjectContext()`，验证 `workspaceType` 为 `"monorepo"`；在一个仅包含 `package.json`（无 workspaces 字段）的临时目录上调用，验证 `workspaceType` 为 `"single"`。

**Acceptance Scenarios**:

1. **Given** 项目根目录的 `package.json` 包含 `"workspaces"` 字段，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `workspaceType` 值为 `"monorepo"`
2. **Given** 项目根目录存在 `pnpm-workspace.yaml` 文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `workspaceType` 值为 `"monorepo"`
3. **Given** 项目根目录的 `pyproject.toml` 包含 `[tool.uv.workspace]` 配置段，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `workspaceType` 值为 `"monorepo"`
4. **Given** 项目根目录存在 `lerna.json` 文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `workspaceType` 值为 `"monorepo"`
5. **Given** 项目根目录仅有 `package.json`（无 workspaces 字段）且无 monorepo 标识文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `workspaceType` 值为 `"single"`

---

### User Story 3 - 多语言检测（Priority: P1）

作为全景文档化流程的消费者，我需要 `buildProjectContext()` 检测项目中使用的编程语言列表，以便后续 Generator 的 `isApplicable()` 判断（如 DataModelGenerator 检查是否存在 Python 代码来决定是否提取 Pydantic model）。

**Why this priority**: 语言检测是蓝图验证标准的另一核心检测项（"正确检测 Python + TypeScript 多语言"）。几乎所有 Phase 1 的 Generator 都依赖 `detectedLanguages` 来判断自身是否适用于当前项目。且检测逻辑可完全复用现有 `file-scanner.ts` 的 `scanFiles()` 返回的 `languageStats`，开发成本低。

**Independent Test**: 在一个同时包含 `.py` 和 `.ts` 文件的临时目录上调用 `buildProjectContext()`，验证 `detectedLanguages` 同时包含 `"python"` 和 `"typescript"`。

**Acceptance Scenarios**:

1. **Given** 项目目录中包含 `.ts` 和 `.py` 文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `detectedLanguages` 数组同时包含 `"typescript"` 和 `"python"`
2. **Given** 项目目录中仅包含 `.ts` 和 `.js` 文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `detectedLanguages` 数组包含 `"typescript"`，不包含 `"python"`
3. **Given** 项目目录中无任何已注册语言适配器能识别的文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `detectedLanguages` 为空数组 `[]`

---

### User Story 4 - 配置文件扫描（Priority: P2）

作为 ConfigReferenceGenerator（Feature 039）的数据来源，我需要 `buildProjectContext()` 扫描项目中的已知配置文件（package.json、tsconfig.json、pyproject.toml、docker-compose.yml 等）并建立文件名到绝对路径的映射，以便后续 Generator 直接通过 `configFiles` 获取配置文件路径而无需重复扫描。

**Why this priority**: configFiles 是 Feature 034 占位版本已有的属性，本 Feature 需要扩展其扫描逻辑以覆盖更多已知配置文件类型。但相比包管理器、workspace 类型和语言检测这三个蓝图验证标准的必选项，configFiles 扫描属于增强能力——即使扫描结果不完整，后续 Generator 仍可自行查找配置文件。

**Independent Test**: 在一个包含 `package.json`、`tsconfig.json` 和 `docker-compose.yml` 的临时目录上调用 `buildProjectContext()`，验证 `configFiles` Map 包含这三个文件的键值对。

**Acceptance Scenarios**:

1. **Given** 项目根目录下存在 `package.json` 和 `tsconfig.json`，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `configFiles` Map 包含键 `"package.json"` 和 `"tsconfig.json"`，值为对应的绝对路径
2. **Given** 项目根目录下存在 `pyproject.toml` 和 `octoagent.yaml`，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `configFiles` Map 包含键 `"pyproject.toml"`；对于 `octoagent.yaml`，由于不属于预定义的已知配置文件列表，MAY 不包含此项（扫描仅覆盖已知配置文件名）
3. **Given** 项目根目录下无任何已知配置文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `configFiles` 为空 Map

---

### User Story 5 - 已有 spec 文件发现（Priority: P2）

作为文档完整性审计（Feature 046）和增量重生成（Feature 049）的前置数据，我需要 `buildProjectContext()` 扫描项目中已有的 spec 文件路径列表，以便后续流程了解哪些模块已被文档化。

**Why this priority**: existingSpecs 是蓝图定义的完整属性之一，但其消费方（Feature 046 和 049）位于 Phase 2-3，距离当前 Phase 0 较远。在 MVP 范围内，existingSpecs 更多是"提前收集、备用"的数据。因此优先级低于蓝图验证标准的必选项。

**Independent Test**: 在一个包含 `specs/` 目录和若干 `.spec.md` 文件的临时项目上调用 `buildProjectContext()`，验证 `existingSpecs` 包含正确的文件路径。

**Acceptance Scenarios**:

1. **Given** 项目根目录下存在 `specs/some-feature/some-module.spec.md` 文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `existingSpecs` 数组包含该文件的路径
2. **Given** 项目根目录下无 `specs/` 目录且无 `*.spec.md` 文件，**When** 调用 `buildProjectContext(projectRoot)`，**Then** 返回对象的 `existingSpecs` 为空数组 `[]`

---

### User Story 6 - ProjectContextSchema 向后兼容扩展（Priority: P1）

作为 Feature 034 已交付的 ProjectContext 占位版本的消费者，我需要本 Feature 的 Schema 扩展不破坏已有代码——即 Feature 034 中引用 ProjectContext 类型的 Mock Generator 和单元测试在扩展后仍能通过编译和测试。

**Why this priority**: 向后兼容是蓝图和技术调研的明确设计约束（"使用 ProjectContextSchema.extend() 保持向后兼容"）。如果扩展破坏了 Feature 034 已交付的代码，将导致 Phase 0 基础设施层内部的回归问题。与 Story 1/2/3 同为 P1 因为这是扩展操作本身的安全性保障。

**Independent Test**: 在扩展 ProjectContextSchema 后运行 `npm test`，确认 Feature 034 的 Mock Generator 测试和 Schema 测试全部通过。

**Acceptance Scenarios**:

1. **Given** Feature 034 已交付的 MockReadmeGenerator 使用 ProjectContext 类型，**When** 本 Feature 扩展 ProjectContextSchema 后运行 `npm run build`，**Then** 编译零错误，Mock Generator 代码无需修改
2. **Given** Feature 034 已交付的 Schema 测试引用 ProjectContextSchema，**When** 本 Feature 扩展 Schema 后运行 `npm test`，**Then** 所有既有测试通过，无新增失败

---

### Edge Cases

- **projectRoot 不存在**: 当 `buildProjectContext()` 接收到一个不存在的目录路径时，应抛出明确的错误（包含路径信息），而非返回空对象或静默降级
- **projectRoot 不是目录**: 当传入一个文件路径而非目录路径时，应抛出明确的错误
- **多 lock 文件共存**: 当项目根目录同时存在 `package-lock.json` 和 `yarn.lock` 时，应按优先级规则选择一个包管理器（优先取最先匹配的），不应抛出异常 `[关联: FR-002]`
- **package.json 解析失败**: 当 `package.json` 存在但内容不是合法 JSON 时，workspace 检测应跳过该文件（降级为 `"single"`），不应导致整个构建函数失败 `[关联: FR-005]`
- **pyproject.toml 解析失败**: 当 `pyproject.toml` 存在但格式损坏时，workspace 检测应跳过该文件，不应中断构建 `[关联: FR-006]`
- **scanFiles 未初始化 Registry**: 当语言检测依赖的 LanguageAdapterRegistry 未初始化时，`detectedLanguages` 应返回空数组而非抛出异常 `[关联: FR-008]`
- **specs 目录权限不足**: 当 `specs/` 目录存在但不可读时，`existingSpecs` 应返回空数组并记录警告，不应中断构建
- **符号链接循环**: 当项目目录中存在符号链接形成循环引用时，文件扫描不应陷入无限循环（依赖 scanFiles 的现有保护机制）
- **超大项目**: 当项目包含数万个文件时，buildProjectContext 应在合理时间内（秒级）完成构建，因为语言检测复用 scanFiles 的文件遍历而非独立遍历

## Requirements *(mandatory)*

### Functional Requirements

**ProjectContextSchema 扩展**

- **FR-001**: 系统 MUST 在 `src/panoramic/interfaces.ts` 中使用 `ProjectContextSchema = ProjectContextSchema.extend({...})` 方式（重新赋值同名变量）扩展 ProjectContext Schema，新增以下属性：`packageManager`、`workspaceType`、`detectedLanguages`、`existingSpecs`。扩展后原有的 `projectRoot` 和 `configFiles` 属性保持不变，确保向后兼容。`src/panoramic/project-context.ts` 仅包含 `buildProjectContext()` 构建函数，不定义新 Schema `[关联: Story 6]` `[AUTO-CLARIFIED: 在 interfaces.ts 中原地扩展 — project-context.ts 仅负责构建逻辑，保持导入路径和 Schema 名称不变，不影响现有消费方]`
- **FR-002**: `packageManager` 属性 MUST 为枚举类型，可选值包括：`"npm"` / `"yarn"` / `"pnpm"` / `"pip"` / `"uv"` / `"go"` / `"maven"` / `"gradle"` / `"pipenv"` / `"unknown"`。当无法识别包管理器时使用 `"unknown"`。注意：`"pip"` 作为预留枚举值存在于 Schema 中，但 FR-009 的自动检测规则不包含 `pip` 的映射（`pip` 无标准 lock 文件），因此当前版本不会自动检测出 `"pip"` `[关联: Story 1]` `[AUTO-CLARIFIED: 保留 pip 预留值 — pip 是 Python 最基础的包管理器，枚举中保留以支持未来扩展（如 requirements.txt 检测），但本 Feature 不实现其自动检测]`
- **FR-003**: `workspaceType` 属性 MUST 为枚举类型，可选值为 `"single"` 或 `"monorepo"` `[关联: Story 2]`
- **FR-004**: `detectedLanguages` 属性 MUST 为字符串数组类型（`string[]`），数组元素为语言适配器的 id（如 `"typescript"`、`"python"`） `[关联: Story 3]`
- **FR-005**: `existingSpecs` 属性 MUST 为字符串数组类型（`string[]`），元素为 spec 文件的**绝对路径** `[关联: Story 5]` `[AUTO-CLARIFIED: 绝对路径 — 与 configFiles value 格式保持一致，便于后续 Generator 直接读取文件]`

**buildProjectContext 构建函数**

- **FR-006**: 系统 MUST 在 `src/panoramic/project-context.ts` 中导出 `buildProjectContext(projectRoot: string): Promise<ProjectContext>` 异步构建函数 `[关联: Story 1, Story 2, Story 3, Story 4, Story 5]`
- **FR-007**: `buildProjectContext()` MUST 验证 `projectRoot` 参数指向一个存在的目录，若不存在或不是目录则抛出包含路径信息的错误 `[关联: Edge Case - projectRoot 不存在/不是目录]`
- **FR-008**: `buildProjectContext()` 返回的 ProjectContext 对象 MUST 通过扩展后的 `ProjectContextSchema.parse()` 验证 `[关联: Story 6]`

**包管理器检测**

- **FR-009**: 系统 MUST 通过检查项目根目录下的 lock 文件和包管理器标识文件来检测包管理器。检测规则（按优先级从高到低）：`pnpm-lock.yaml` -> `"pnpm"`、`yarn.lock` -> `"yarn"`、`package-lock.json` -> `"npm"`、`uv.lock` -> `"uv"`、`Pipfile.lock` -> `"pipenv"`、`go.sum` 或 `go.mod` -> `"go"`、`pom.xml` -> `"maven"`、`build.gradle` 或 `build.gradle.kts` -> `"gradle"`。若均不存在，返回 `"unknown"` `[关联: Story 1]` `[AUTO-RESOLVED: lock 文件优先级顺序 -- 按照技术调研 tech-research.md 第 3 节建议的检测顺序，pnpm 优先于 yarn 和 npm 因为 pnpm-lock.yaml 文件名最无歧义]`
- **FR-010**: 当多个 lock 文件共存时，系统 MUST 按 FR-009 定义的优先级选择第一个匹配项，不抛出异常 `[关联: Edge Case - 多 lock 文件共存]`

**Workspace 类型识别**

- **FR-011**: 系统 MUST 通过以下条件判断 workspaceType 为 `"monorepo"`（满足任一即可）：(a) `package.json` 中存在 `"workspaces"` 字段；(b) 项目根目录存在 `pnpm-workspace.yaml` 文件；(c) `pyproject.toml` 中存在 `[tool.uv.workspace]` 配置段；(d) 项目根目录存在 `lerna.json` 文件。其余情况判定为 `"single"` `[关联: Story 2]`
- **FR-012**: 当 `package.json` 或 `pyproject.toml` 内容解析失败（非法 JSON / TOML）时，系统 MUST 跳过该文件的 workspace 判断逻辑，降级为 `"single"`，不中断构建函数执行 `[关联: Edge Case - 解析失败]`

**多语言检测**

- **FR-013**: 系统 MUST 复用 `src/utils/file-scanner.ts` 的 `scanFiles()` 函数获取 `languageStats`，从中提取语言适配器 id 列表作为 `detectedLanguages`。调用时传入 `scanFiles(projectRoot, { projectRoot })` 以确保 `.gitignore` 和内置排除列表（`node_modules`、`.git` 等）正确生效 `[关联: Story 3]` `[AUTO-CLARIFIED: 使用默认 ScanOptions + projectRoot — 复用 scanFiles 现有的排除逻辑，与 batch-orchestrator 的调用方式一致]`
- **FR-014**: 当 LanguageAdapterRegistry 未初始化或 scanFiles 返回空 languageStats 时，`detectedLanguages` MUST 返回空数组，不抛出异常 `[关联: Edge Case - Registry 未初始化]`

**配置文件扫描**

- **FR-015**: 系统 MUST 扫描项目**根目录**（深度 1，不递归子目录）下的已知配置文件并填充 `configFiles` Map。已知配置文件的最小集合 MUST 包含：`package.json`、`tsconfig.json`、`tsconfig.*.json`（通配）、`pyproject.toml`、`docker-compose.yml`、`docker-compose.yaml`、`Dockerfile`、`.eslintrc`、`.eslintrc.json`、`.prettierrc`、`.prettierrc.json`、`jest.config.ts`、`jest.config.js`、`vitest.config.ts`、`vitest.config.js` `[关联: Story 4]` `[AUTO-CLARIFIED: 仅扫描根目录 — 避免 Map key 冲突（多个子包有同名 package.json），Monorepo 子包配置由 Feature 040 负责]`
- **FR-016**: `configFiles` Map 的 key MUST 为文件名（如 `"package.json"`），value MUST 为该文件的绝对路径 `[关联: Story 4]`

**已有 spec 文件发现**

- **FR-017**: 系统 MUST 扫描项目根目录下 `specs/` 目录中的所有 `*.spec.md` 文件，将**绝对路径**收集到 `existingSpecs` 数组 `[关联: Story 5]`
- **FR-018**: 当 `specs/` 目录不存在时，`existingSpecs` MUST 返回空数组，不抛出异常 `[关联: Story 5]`

**单元测试**

- **FR-019**: 系统 MUST 为 `buildProjectContext()` 编写单元测试，测试文件路径为 `tests/panoramic/project-context.test.ts` `[关联: Story 1-6]`
- **FR-020**: 单元测试 MUST 覆盖以下场景：(a) 各包管理器的 lock 文件检测（至少覆盖 npm、pnpm、uv 三种）；(b) monorepo 识别（至少覆盖 package.json workspaces、pnpm-workspace.yaml、pyproject.toml [tool.uv.workspace] 三种）；(c) single 项目识别；(d) 多语言检测（至少覆盖 TypeScript + Python 共存场景）；(e) configFiles 扫描（至少覆盖 package.json + tsconfig.json）；(f) existingSpecs 扫描（有 spec 和无 spec 两种场景） `[关联: Story 1-5]`
- **FR-021**: 单元测试 MUST 覆盖向后兼容性验证——扩展 Schema 后，Feature 034 已交付的测试仍全部通过 `[关联: Story 6]`
- **FR-022**: `npm test` MUST 在新增代码后退出码为 0 `[关联: Story 1-6]`

**代码组织与正交性**

- **FR-023**: 新增的 `project-context.ts` MUST 放在 `src/panoramic/` 目录下 `[关联: 蓝图设计约束]`
- **FR-024**: 系统 MUST NOT 修改现有 `src/batch/batch-orchestrator.ts` 或其他现有文件的逻辑 `[关联: 蓝图设计约束]`
- **FR-025**: `npm run build` MUST 在新增代码后零错误通过 `[关联: Story 6]`

### Key Entities

- **ProjectContext（完整版本）**: 项目元信息容器。在 Feature 034 占位版本（projectRoot + configFiles）的基础上扩展 packageManager、workspaceType、detectedLanguages、existingSpecs 四个属性。是只读数据对象，在分析流程开始时由 buildProjectContext() 一次性构建，作为参数传递给所有 DocumentGenerator 和 ArtifactParser
- **buildProjectContext**: 异步构建函数。接收 projectRoot 字符串参数，执行包管理器检测、workspace 类型识别、多语言检测、配置文件扫描和 spec 文件发现五个子流程，返回通过 Schema 验证的完整 ProjectContext 对象
- **packageManager**: 枚举值。标识项目使用的包管理器类型，由 lock 文件存在性检测得出。影响后续 Generator 选择依赖解析策略
- **workspaceType**: 二值枚举（single / monorepo）。标识项目是单包还是多包结构。Feature 040 的 WorkspaceAnalyzer 以此为 isApplicable 判断依据

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对包含 `uv.lock` 和 `pyproject.toml`（含 `[tool.uv.workspace]`）的 Python Monorepo 项目（如 OctoAgent）运行 `buildProjectContext()`，返回的 `packageManager` 为 `"uv"`、`workspaceType` 为 `"monorepo"`、`detectedLanguages` 包含 `"python"`
- **SC-002**: 对包含 `package-lock.json` 且无 workspaces 配置的单包 Node.js 项目运行 `buildProjectContext()`，返回的 `packageManager` 为 `"npm"`、`workspaceType` 为 `"single"`、`configFiles` 包含 `"package.json"` 键
- **SC-003**: 扩展 ProjectContextSchema 后，Feature 034 已交付的全部测试（Mock Generator 测试、Schema 测试）仍通过——`npm test` 退出码为 0
- **SC-004**: `npm run build` 在包含扩展后的 `interfaces.ts` 和新增的 `project-context.ts` 的项目上零错误通过
- **SC-005**: 单元测试覆盖至少 3 种包管理器检测、3 种 monorepo 识别方式和 1 种多语言共存场景，全部测试通过

## Clarifications

### Auto-Resolved

| # | 问题 | 影响 | 自动选择 | 理由 |
|---|------|------|---------|------|
| 1 | 多个 lock 文件共存时的优先级未在蓝图中明确规定 | FR-009, FR-010 | 按 pnpm > yarn > npm > uv > pipenv > go > maven > gradle 的优先级顺序，取第一个匹配项 | 技术调研 tech-research.md 第 3 节已给出检测文件列表但未定义优先级。pnpm-lock.yaml 文件名最无歧义（不会与其他工具产生冲突），因此优先级最高。Node.js 生态中 pnpm > yarn > npm 的优先级是社区 monorepo 工具（如 Turborepo、Nx）的常见约定 `[AUTO-RESOLVED]` |
| 2 | pyproject.toml 解析方式——是否引入 TOML 解析库？ | FR-011, FR-012 | 不引入 TOML 解析库，使用正则表达式或行级文本匹配检测 `[tool.uv.workspace]` 段落头 | 技术调研明确建议"最小外部依赖：仅用 fs.existsSync() + fs.readFileSync() 检测，不引入新依赖"。`[tool.uv.workspace]` 段落头可通过简单的正则匹配（如 `/^\[tool\.uv\.workspace\]/m`）检测，无需完整 TOML 解析 `[AUTO-RESOLVED]` |

### Session 2026-03-19（需求澄清）

| # | 问题 | 影响 | 自动选择 | 理由 |
|---|------|------|---------|------|
| 3 | `existingSpecs` 路径格式未定义——绝对路径还是相对路径？ | FR-005, FR-017 | 绝对路径 | 与 `configFiles` Map value 的格式保持一致（均为绝对路径），便于后续 Generator 直接通过路径读取文件，无需再拼接 `projectRoot` `[AUTO-CLARIFIED]` |
| 4 | Schema 扩展位置歧义——FR-001 说在 `interfaces.ts` 中扩展，FR-006/FR-023 说新建 `project-context.ts` | FR-001, FR-006, FR-023 | 在 `interfaces.ts` 中原地扩展 Schema（重新赋值同名变量），`project-context.ts` 仅包含 `buildProjectContext()` 构建函数 | 保持 `ProjectContextSchema` 和 `ProjectContext` 类型的导出路径不变（`src/panoramic/interfaces.ts`），现有消费方（Feature 034 测试、Mock Generator）的 import 语句无需修改。符合 FR-024"不修改现有逻辑"的约束——仅扩展 Schema，不改变模块结构 `[AUTO-CLARIFIED]` |
| 5 | `configFiles` 扫描深度未明确——仅根目录还是递归扫描？ | FR-015 | 仅扫描项目根目录（深度 1） | FR-015 原文"扫描项目根目录下"。递归扫描会导致 Map key 冲突（Monorepo 子包各有 `package.json`）。子包级配置文件扫描属于 Feature 040（Monorepo 索引）的职责范围 `[AUTO-CLARIFIED]` |
| 6 | `pip` 枚举值在 FR-002 中定义但 FR-009 检测规则无对应映射 | FR-002, FR-009 | 保留 `"pip"` 作为预留枚举值，本 Feature 不实现其自动检测 | `pip` 是 Python 最基础的包管理器，枚举保留支持未来扩展。`pip` 无标准 lock 文件（`requirements.txt` 非严格 lock 文件），在本 Feature 范围内不增加检测规则 `[AUTO-CLARIFIED]` |
| 7 | `scanFiles` 调用参数未明确——是否需要自定义排除模式？ | FR-013 | 使用默认 ScanOptions，传入 `{ projectRoot }` | `scanFiles` 默认已处理 `.gitignore` 和内置排除列表（`node_modules/`、`.git/` 等），与 `batch-orchestrator.ts` 的调用方式一致。无需自定义排除模式 `[AUTO-CLARIFIED]` |
