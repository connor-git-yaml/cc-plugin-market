# Tasks: 多语言混合项目支持

**Input**: Design documents from `/specs/031-multilang-mixed-project/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/

**Tests**: 每个实施步骤包含对应的测试任务，确保可独立验证。

**Organization**: 任务按 plan.md 的 7 个实施步骤组织，映射到 spec.md 中的 6 个 User Story。每个 Phase 可独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（操作不同文件，无依赖）
- **[Story]**: 所属 User Story（如 US1、US2）
- 描述中包含精确的文件路径

## Path Conventions

- **Single project**: `src/`, `tests/`, `templates/` at repository root

---

## Phase 1: 数据模型扩展（Schema 定义）

**Purpose**: 扩展所有 Zod Schema 和 TypeScript 类型定义，为后续步骤提供类型基础。所有新增字段均为 optional，确保向后兼容。

- [X] T001 [P] 在 src/models/module-spec.ts 中新增 `LanguageDistributionSchema` 及其类型导出（含 language、adapterId、fileCount、moduleCount、percentage、processed 六个字段）
- [X] T002 [P] 在 src/models/module-spec.ts 中扩展 `SpecFrontmatterSchema`，新增 optional 字段 `language: z.string().optional()` 和 `crossLanguageRefs: z.array(z.string()).optional()`
- [X] T003 [P] 在 src/models/module-spec.ts 中扩展 `ArchitectureIndexSchema`，新增 optional 字段 `languageDistribution: z.array(LanguageDistributionSchema).optional()`
- [X] T004 [P] 在 src/models/module-spec.ts 中扩展 `BatchStateSchema`，新增 optional 字段 `languageGroups: z.record(z.string(), z.array(z.string())).optional()` 和 `filterLanguages: z.array(z.string()).optional()`
- [X] T005 [P] 在 src/models/module-spec.ts 中扩展 `StageId` 类型，新增 `'lang-detect'` 和 `'lang-graph'` 两个阶段标识
- [X] T006 [P] 在 src/models/dependency-graph.ts 中扩展 `GraphNodeSchema`，新增 optional 字段 `language: z.string().optional()`
- [X] T007 [P] 在 src/utils/file-scanner.ts 中新增 `LanguageFileStat` 接口定义（adapterId、fileCount、extensions），并扩展 `ScanResult` 接口新增 optional 字段 `languageStats?: Map<string, LanguageFileStat>`
- [X] T008 运行 `npm run build` 验证编译通过，运行 `npm test` 验证现有测试全部通过（新增字段均为 optional，向后兼容）

**Checkpoint**: 所有类型定义就绪，编译通过，现有测试零失败。后续步骤可基于这些类型开始实现。

---

## Phase 2: scanFiles 增强 — US1 多语言检测 + US5 友好警告 (P1/P2)

**Purpose**: 在文件扫描阶段统计各语言文件分布（FR-001），增强不支持语言的警告信息输出语言名称（FR-011）。

**Goal**: 扫描完成后 `ScanResult.languageStats` 包含各已支持语言的准确统计；不支持的语言警告包含人类可读的语言名称。

**Independent Test**: 准备包含多种语言文件的目录，调用 `scanFiles()`，验证 `languageStats` 统计准确且警告包含语言名称。

### 实现

- [X] T009 [US1] 在 src/utils/file-scanner.ts 中新增 `KNOWN_LANGUAGE_NAMES` 常量映射表（.rs→Rust、.cpp→C++、.c→C 等 20+ 常见扩展名→语言名称），用于不支持语言的友好警告
- [X] T010 [US1] 在 src/utils/file-scanner.ts 的 `walkDir` 函数中，对匹配到 LanguageAdapterRegistry 适配器的文件累加 `languageStats` Map（key 为 adapter.id，value 为 LanguageFileStat）
- [X] T011 [US5] 在 src/utils/file-scanner.ts 中重构不支持扩展名的警告逻辑，使用 `KNOWN_LANGUAGE_NAMES` 映射表输出聚合的语言名称警告（如"跳过 12 个 .rs 文件（Rust，不支持）"），而非仅输出扩展名

### 测试

- [X] T012 [P] [US1] 在 tests/unit/file-scanner.test.ts 中新增测试：多语言项目扫描后 languageStats 包含正确的语言条目（ts-js、python、go 各自的 fileCount 和 extensions）
- [X] T013 [P] [US1] 在 tests/unit/file-scanner.test.ts 中新增测试：纯单语言项目扫描后 languageStats 仅包含一个条目
- [X] T014 [P] [US5] 在 tests/unit/file-scanner.test.ts 中新增测试：包含 .rs 和 .cpp 文件时，警告信息包含 "Rust" 和 "C++" 语言名称
- [X] T015 [P] [US5] 在 tests/unit/file-scanner.test.ts 中新增测试：所有文件均为已支持语言时，不输出跳过警告
- [X] T016 [P] [US1] 在 tests/unit/file-scanner.test.ts 中新增测试：无扩展名文件（Makefile、Dockerfile）和非代码文件（.yaml、.json）不纳入 languageStats（CQ-002）
- [X] T017 在 tests/unit/file-scanner.test.ts 中新增测试：仅有极少量文件（1-2 个 .go 文件）的语言仍被检测并纳入 languageStats

**Checkpoint**: `scanFiles()` 返回完整的 `languageStats`，不支持语言警告包含人类可读名称。`npm test` 全部通过。

---

## Phase 3: buildDirectoryGraph 轻量级依赖图 (FR-003)

**Purpose**: 为无 dependency-cruiser 支持的语言（Python/Go/Java）提供基于目录结构 + import 推断的轻量级依赖图。

**Goal**: `buildDirectoryGraph()` 能基于 CodeSkeleton 的 imports 信息构建有意义的依赖拓扑，供 batch-orchestrator 消费。

**Independent Test**: 构造 Python/Go 文件的 CodeSkeleton 输入，验证产出的 DependencyGraph 包含正确的边和拓扑排序。

### 实现

- [X] T018 [US1] 新建 src/graph/directory-graph.ts，实现 `buildDirectoryGraph(files, projectRoot, skeletons)` 函数签名和基本结构（节点构建：每个文件创建一个 GraphNode，source 为相对路径，language 设置为对应 adapter.id）
- [X] T019 [US1] 在 src/graph/directory-graph.ts 中实现边推断逻辑：遍历 CodeSkeleton.imports，对 `isRelative: true` 的 import 使用 `path.resolve()` 解析到同组文件创建 DependencyEdge；`isRelative: false` 忽略（第三方包）
- [X] T020 [US1] 在 src/graph/directory-graph.ts 中实现 Python import 路径解析规则（`from .utils import helper` → 同目录 utils.py；`from ..models import User` → 上级目录 models.py 或 models/__init__.py）
- [X] T021 [US1] 在 src/graph/directory-graph.ts 中实现 Go import 路径解析规则（`"./internal/utils"` → internal/utils/ 目录下的 Go 文件；`"github.com/..."` → 忽略）
- [X] T022 [US1] 在 src/graph/directory-graph.ts 中集成拓扑排序（复用 src/graph/topological-sort.ts 的 `topologicalSort()`）、SCC 检测（复用 `detectSCCs()`）和 Mermaid 渲染（复用 `renderDependencyGraph()`），组装完整的 DependencyGraph 返回

### 测试

- [X] T023 [P] [US1] 新建 tests/unit/directory-graph.test.ts，测试：Python 相对 import（`from .utils import helper`）正确生成依赖边
- [X] T024 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：Go 本地 package import（`"./internal/utils"`）正确生成依赖边
- [X] T025 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：第三方 import（`import requests`、`"github.com/..."`）不生成依赖边
- [X] T026 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：空文件列表返回空的 DependencyGraph
- [X] T027 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：循环依赖（A→B→A）被 SCC 检测正确标识
- [X] T028 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：无法解析的 import 路径不产生边（宽容策略），不抛出异常
- [X] T029 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：所有生成的 GraphNode 均设置了正确的 `language` 字段
- [X] T030 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：拓扑排序结果符合依赖关系（被依赖文件排在依赖方之前）
- [X] T031 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：Python `from ..models import User` 跨目录相对 import 正确解析
- [X] T032 [P] [US1] 在 tests/unit/directory-graph.test.ts 中测试：混合有效和无效 import 的文件，有效 import 正确生成边，无效 import 静默跳过

**Checkpoint**: `buildDirectoryGraph()` 能为 Python/Go 文件生成有意义的依赖图。`npm test` 全部通过。

---

## Phase 4: module-grouper 语言感知分组 — US1 多语言分组 + CQ-005 双连字符命名

**Purpose**: 扩展 module-grouper 使其在同目录下检测到多种语言文件时，拆分为带语言后缀的子模块（FR-005）。

**Goal**: `groupFilesToModules()` 在 `languageAware: true` 模式下，同目录混合语言文件被拆分为 `services--ts`、`services--py` 等子模块；纯单语言目录保持不变。

**Independent Test**: 构造同目录混合 .ts/.py/.go 文件的图，验证分组结果包含正确的双连字符子模块名。

### 实现

- [X] T033 [US1] 在 src/batch/module-grouper.ts 的 `GroupingOptions` 接口中新增 `languageAware?: boolean` 字段
- [X] T034 [US1] 在 src/batch/module-grouper.ts 的 `ModuleGroup` 接口中新增 `language?: string` 字段
- [X] T035 [US1] 在 src/batch/module-grouper.ts 中实现语言感知分组逻辑：当 `languageAware: true` 时，使用 `(directory, language)` 元组作为分组键，通过 LanguageAdapterRegistry 获取每个文件的 adapter.id
- [X] T036 [US1] 在 src/batch/module-grouper.ts 中实现双连字符命名逻辑：统计每个目录下出现的语言种类数，若 >1 则为模块名追加 `--{adapterId}` 后缀；若仅一种语言则保持原名（向后兼容）
- [X] T037 [US1] 在 src/batch/module-grouper.ts 中确保 `languageAware: false` 或未设置时，行为与现有逻辑完全一致（回归保护）

### 测试

- [X] T038 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：同目录下 .ts + .py 文件，languageAware=true 时拆分为 `services--ts-js` 和 `services--python` 两个模块
- [X] T039 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：同目录下 .ts + .py + .go 三种语言文件，正确拆分为三个双连字符子模块
- [X] T040 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：纯单语言目录（仅 .ts 文件），languageAware=true 时模块名不追加语言后缀
- [X] T041 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：languageAware=false 时行为与现有逻辑完全一致（回归）
- [X] T042 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：root 模块（项目根目录文件）在多语言场景下正确拆分
- [X] T043 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：已包含连字符的模块名（如 `auth-service`）追加语言后缀后格式为 `auth-service--ts-js`
- [X] T044 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：每个 ModuleGroup 的 `language` 字段在语言感知模式下正确设置为 adapter.id
- [X] T045 [P] [US1] 在 tests/unit/module-grouper.test.ts 中新增测试：不同深度的目录分组与语言感知同时启用时正确交互

**Checkpoint**: module-grouper 语言感知分组功能完成，同目录多语言文件正确拆分，单语言目录不受影响。`npm test` 全部通过。

---

## Phase 5: batch-orchestrator 多语言编排核心 — US1 批量生成 + US3 语言过滤 (P1/P2) [高风险]

**Purpose**: 重构 `runBatch()` 核心流程，支持语言分组、分组依赖图构建、图合并、语言过滤、断点恢复多语言扩展。这是本特性的核心编排层。

**Goal**: 多语言混合项目运行 `runBatch()` 后，各语言模块均产出独立的 spec 文档；支持 `languages` 参数过滤；断点恢复正确还原语言分组状态。

**Independent Test**: 对包含 TS + Python + Go 的测试项目运行批量生成，验证各语言模块均产出独立 spec。

### 5a: language-grouper 新增文件

- [X] T046 [P] [US1] 新建 src/batch/language-grouper.ts，定义 `LanguageGroup` 接口（adapterId、languageName、files）和 `groupFilesByLanguage(files, filterLanguages?)` 函数签名
- [X] T047 [US1] 在 src/batch/language-grouper.ts 中实现 `groupFilesByLanguage()`：遍历文件列表，通过 LanguageAdapterRegistry.getAdapter() 按语言分组；应用 filterLanguages 过滤（如有）
- [X] T048 [US3] 在 src/batch/language-grouper.ts 中实现语言过滤的边界处理：指定的语言不存在时收集到警告列表返回；空 filterLanguages 表示不过滤

### 5a 测试

- [X] T049 [P] [US1] 新建 tests/unit/language-grouper.test.ts，测试：混合 .ts/.py/.go 文件正确分为三个语言组
- [X] T050 [P] [US3] 在 tests/unit/language-grouper.test.ts 中测试：filterLanguages=['typescript'] 时仅保留 ts-js 组
- [X] T051 [P] [US3] 在 tests/unit/language-grouper.test.ts 中测试：filterLanguages 指定不存在的语言（如 'rust'）时返回空结果和警告
- [X] T052 [P] [US1] 在 tests/unit/language-grouper.test.ts 中测试：空文件列表返回空分组
- [X] T053 [P] [US1] 在 tests/unit/language-grouper.test.ts 中测试：未注册扩展名的文件被忽略不纳入任何分组
- [X] T054 [P] [US3] 在 tests/unit/language-grouper.test.ts 中测试：filterLanguages=['typescript', 'python'] 时保留两个语言组

### 5b: batch-orchestrator 核心重构

- [X] T055 [US1] 在 src/batch/batch-orchestrator.ts 的 `BatchOptions` 接口中新增 `languages?: string[]` 字段
- [X] T056 [US1] 在 src/batch/batch-orchestrator.ts 的 `BatchResult` 接口中新增 `detectedLanguages?: string[]` 和 `languageStats?: Map<string, LanguageFileStat>` 字段
- [X] T057 [US1] 在 src/batch/batch-orchestrator.ts 的 `runBatch()` 中，在 `scanFiles()` 之后插入语言分组步骤：调用 `groupFilesByLanguage(scanResult.files, options.languages)`
- [X] T058 [US1] 在 src/batch/batch-orchestrator.ts 中实现分组依赖图构建逻辑：遍历每个语言组，adapter 有 `buildDependencyGraph` 则调用（如 ts-js），否则调用 `buildDirectoryGraph()` 兜底
- [X] T059 [US1] 在 src/batch/batch-orchestrator.ts 中实现 `mergeGraphsForTopologicalSort()`：将各语言独立的 DependencyGraph 的 modules 和 edges 合并（仅 concat），用于全局拓扑排序；SCC/Mermaid 按语言独立保留（CQ-004 选项 C）
- [X] T060 [US1] 在 src/batch/batch-orchestrator.ts 中将 `groupFilesToModules()` 调用改为传入 `{ languageAware: true }` 选项，启用语言感知分组
- [X] T061 [US1] 在 src/batch/batch-orchestrator.ts 中为逐模块 spec 生成环节注入 `language` 信息到 frontmatter（通过 single-spec-orchestrator 传参）
- [X] T062 [US6] 在 src/batch/batch-orchestrator.ts 中实现跨语言引用检测：扫描模块 imports 是否引用了其他语言组的路径，填充 frontmatter 的 `crossLanguageRefs` 字段
- [X] T063 [US6] 在 src/batch/batch-orchestrator.ts 中实现多语言项目通用提示注入：当 languageStats 包含 2+ 种语言时，在每个 spec 的 constraints section 末尾追加标准化跨语言调用提示文本（CQ-001）
- [X] T064 [US1] 在 src/batch/batch-orchestrator.ts 中扩展断点恢复逻辑：保存检查点时写入 `languageGroups` 和 `filterLanguages`；恢复时从检查点还原分组信息无需重新扫描
- [X] T065 [US1] 在 src/batch/batch-orchestrator.ts 中确保单语言项目（languageStats 仅一个条目）时行为与现有逻辑完全一致：不启用语言感知分组、不追加跨语言提示、不展示语言分布（FR-014 向后兼容）

### 5b 测试

- [X] T066 [P] [US1] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：多语言项目（TS+Python+Go）正确触发语言分组和分组依赖图构建
- [X] T067 [P] [US1] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：纯 TypeScript 项目行为与增强前完全一致（向后兼容回归）
- [X] T068 [P] [US3] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：`languages: ['typescript']` 过滤参数仅处理 TS 模块，Python/Go 被跳过
- [X] T069 [P] [US3] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：`languages` 参数指定不存在的语言时返回友好警告
- [X] T070 [P] [US1] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：`mergeGraphsForTopologicalSort()` 正确合并多个语言图的 modules/edges
- [X] T071 [P] [US1] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：断点恢复正确还原 languageGroups 和 filterLanguages（FR-013）
- [X] T072 [P] [US1] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：旧格式检查点（无 languageGroups）按单语言模式处理（向后兼容）
- [X] T073 [P] [US6] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：多语言项目的 spec constraints 包含标准化跨语言调用提示
- [X] T074 [P] [US6] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：纯单语言项目的 spec 不包含跨语言调用提示
- [X] T075 [P] [US1] 在 tests/unit/batch-orchestrator.test.ts 中新增测试：BatchResult 包含正确的 detectedLanguages 和 languageStats

**Checkpoint**: batch-orchestrator 多语言编排核心完成。多语言项目可成功运行批量 Spec 生成，各语言模块独立产出。`npm test` 全部通过。

---

## Phase 6: MCP 工具增强 + 索引模板增强 — US2 语言分布 + US4 prepare 语言列表 (P1/P2)

**Purpose**: 增强 MCP `prepare`/`batch` 工具参数和返回值（FR-009、FR-010）；更新架构索引模板和生成器以展示语言分布信息（FR-007、FR-008、FR-015）；更新 spec 模板支持 language frontmatter。

**Goal**: MCP prepare 返回 detectedLanguages；batch 支持 languages 过滤参数；架构索引多语言项目展示语言分布表格，单语言项目不展示。

**Independent Test**: 通过 MCP 调用 prepare 验证返回语言列表；对多语言项目生成索引验证包含语言分布表格。

### 6a: MCP 工具增强

- [X] T076 [P] [US4] 在 src/mcp/server.ts 的 `prepare` 工具中增强返回值：从 `scanFiles()` 的 `languageStats` 提取 `detectedLanguages` 数组（避免重复调用 scanFiles——透传 languageStats）
- [X] T077 [P] [US3] 在 src/mcp/server.ts 的 `batch` 工具中新增 `languages: z.array(z.string()).optional()` 参数，传递给 `runBatch()` 的 `BatchOptions.languages`

### 6b: 索引生成器增强

- [X] T078 [US2] 在 src/generator/index-generator.ts 的 `generateIndex()` 函数签名中新增 `languageStats` 和 `processedLanguages` 参数
- [X] T079 [US2] 在 src/generator/index-generator.ts 中实现 `LanguageDistribution[]` 计算逻辑：fileCount 来自 languageStats，moduleCount 来自 specs 的 language 分组统计，percentage 计算文件占比
- [X] T080 [US2] 在 src/generator/index-generator.ts 中实现条件渲染逻辑：单语言项目（languageDistribution.length <= 1）不填充该字段（FR-008）
- [X] T081 [US2] 在 src/generator/index-generator.ts 中实现 FR-015：语言过滤后索引仍展示全部语言，新增 `processed` 标注列区分本次处理和跳过的语言

### 6c: 模板增强

- [X] T082 [P] [US2] 在 templates/index-spec.hbs 中新增"语言分布"section，使用 `{{#if languageDistribution}}` 条件渲染表格（语言、文件数、模块数、占比、本次处理）
- [X] T083 [P] [US1] 在 templates/module-spec.hbs 的 frontmatter 区域新增 `{{#if language}}language: {{language}}{{/if}}` 和 `{{#if crossLanguageRefs}}crossLanguageRefs` 列表渲染

### 6d: frontmatter 和 single-spec-orchestrator 增强

- [X] T084 [P] [US1] 在 src/generator/frontmatter.ts 的 `FrontmatterInput` 接口中新增 `language?: string` 和 `crossLanguageRefs?: string[]` 字段，并在 frontmatter 生成逻辑中处理这些字段
- [X] T085 [US1] 在 src/core/single-spec-orchestrator.ts 的 `generateSpec()` 中接收并传递 `language` 参数到 frontmatter 生成

### 6e: 测试

- [X] T086 [P] [US2] 在 tests/unit/index-generator.test.ts 中新增测试：多语言项目索引包含正确的语言分布表格（fileCount、moduleCount、percentage 准确）
- [X] T087 [P] [US2] 在 tests/unit/index-generator.test.ts 中新增测试：纯单语言项目索引不包含"语言分布"section（FR-008）
- [X] T088 [P] [US2] 在 tests/unit/index-generator.test.ts 中新增测试：语言过滤后（仅处理 TS）索引展示全部语言但 processed 列正确标注（FR-015）
- [X] T089 [P] [US2] 在 tests/unit/index-generator.test.ts 中新增测试：languageDistribution 中各语言的 percentage 之和为 100%
- [X] T090 [P] [US4] 在 tests/unit/index-generator.test.ts 或 MCP 测试中新增测试：prepare 工具返回正确的 detectedLanguages 列表
- [X] T091 [P] [US3] 在 tests/unit/index-generator.test.ts 或 MCP 测试中新增测试：batch 工具接受 languages 参数并正确传递给 runBatch()
- [X] T092 [P] [US1] 在 tests/unit/index-generator.test.ts 中新增测试：module-spec.hbs 渲染的 frontmatter 包含 language 字段
- [X] T093 [P] [US6] 在 tests/unit/index-generator.test.ts 中新增测试：module-spec.hbs 渲染的 frontmatter 包含 crossLanguageRefs 列表

**Checkpoint**: MCP 工具和索引模板增强完成。prepare 返回语言列表，batch 支持过滤，索引正确展示语言分布。`npm test` 全部通过。

---

## Phase 7: 端到端集成验证

**Purpose**: 全面验证多语言支持的完整流程，确保所有 User Story 和 Success Criteria 达成。

**Goal**: 所有集成测试通过，SC-001 到 SC-007 全部满足。

### 7a: 测试 Fixture 准备

- [X] T094 [P] 新建 tests/fixtures/multilang-project/ 测试 fixture 目录，包含以下结构：src/api/ (routes.ts, middleware.ts)、src/services/ (auth.ts, auth.py, helpers.go)、scripts/ (deploy.py, cleanup.py)、go-services/auth/ (handler.go, middleware.go)、unsupported/ (lib.rs, main.cpp)，每个文件包含基本的 import 语句以触发依赖分析

### 7b: 集成测试

- [X] T095 [US1] 新建 tests/integration/multilang-batch.test.ts，测试 SC-001：对 multilang-project fixture 运行 `runBatch()`，验证 TypeScript、Python、Go 三种语言的模块均产出独立的 spec 文档
- [X] T096 [US1] 在 tests/integration/multilang-batch.test.ts 中测试 SC-003：对纯 TypeScript 项目运行 `runBatch()`，验证输出格式和内容与增强前完全一致（向后兼容）
- [X] T097 [US2] 在 tests/integration/multilang-batch.test.ts 中测试 SC-002：验证架构索引的语言分布统计数据（fileCount、moduleCount、percentage）与项目实际文件结构一致
- [X] T098 [US3] 在 tests/integration/multilang-batch.test.ts 中测试 SC-005：使用 `languages: ['typescript']` 参数运行，验证仅 TS 模块被处理，索引展示全部语言
- [X] T099 [US1] 在 tests/integration/multilang-batch.test.ts 中测试 SC-007：验证 src/services/ 下混合 .ts/.py/.go 文件被正确拆分为 `services--ts-js`、`services--python`、`services--go` 三个子模块
- [X] T100 [US5] 在 tests/integration/multilang-batch.test.ts 中测试 SC-004：验证 unsupported/ 下 .rs 和 .cpp 文件的警告包含 "Rust" 和 "C++" 语言名称
- [X] T101 [US4] 在 tests/integration/multilang-batch.test.ts 中测试 SC-006：通过 MCP prepare 验证返回的 detectedLanguages 与实际语言匹配
- [X] T102 [US1] 在 tests/integration/multilang-batch.test.ts 中测试 FR-013：模拟中断多语言批量生成后恢复，验证正确继续处理

**Checkpoint**: 所有集成测试通过，SC-001 ~ SC-007 全部满足。完整 `npm test` 通过。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 全局性优化和收尾工作

- [X] T103 [P] 运行完整的 `npm run lint` 并修复所有 lint 错误
- [X] T104 [P] 运行 `npm run build` 确保 TypeScript 编译零错误零警告
- [X] T105 检查所有新增/修改文件的代码注释使用中文（代码标识符保持英文）
- [X] T106 检查所有新增的 optional 字段在现有测试中不产生副作用（全量回归 `npm test`）
- [X] T107 [P] 验证 src/adapters/language-adapter-registry.ts 和 src/adapters/language-adapter.ts 未被修改（按 plan.md 要求属于"不变区域"）

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (数据模型)          ← 无依赖，立即开始
  │
  ▼
Phase 2 (scanFiles)        ← 依赖 Phase 1 的类型定义
  │
  ├──▶ Phase 3 (directoryGraph)  ← 可与 Phase 4 部分并行
  │       │
  ▼       ▼
Phase 4 (module-grouper)   ← 依赖 Phase 1 的类型定义
  │       │
  ▼       ▼
Phase 5 (batch-orchestrator) ← 依赖 Phase 2, 3, 4 全部完成
  │
  ▼
Phase 6 (MCP + 索引)       ← 依赖 Phase 5 的编排逻辑
  │
  ▼
Phase 7 (端到端集成)       ← 依赖 Phase 2-6 全部完成
  │
  ▼
Phase 8 (Polish)           ← 依赖所有功能 Phase 完成
```

### User Story 映射

| User Story | Priority | 主要覆盖 Phase | 任务范围 |
|:----------:|:--------:|:--------------:|---------|
| US1 - 多语言批量 Spec 生成 | P1 | Phase 2-5, 7 | T009-T010, T018-T032, T033-T045, T046-T075, T095-T099, T102 |
| US2 - 架构索引语言分布 | P1 | Phase 6, 7 | T078-T082, T086-T089, T097 |
| US3 - 按语言过滤 | P2 | Phase 5, 6, 7 | T048, T050-T051, T054, T068-T069, T077, T091, T098 |
| US4 - MCP prepare 语言列表 | P2 | Phase 6, 7 | T076, T090, T101 |
| US5 - 不支持语言友好警告 | P2 | Phase 2, 7 | T011, T014-T015, T100 |
| US6 - 跨语言边界标注 | P3 | Phase 5, 6 | T062-T063, T073-T074, T083-T084, T093 |

### Within Each Phase

- Schema/类型定义 → 实现逻辑 → 测试
- Phase 内标记 [P] 的任务可并行执行
- 每个 Phase 结束有 Checkpoint 验证点

### Parallel Opportunities

- Phase 1: T001-T007 全部可并行（操作同一文件不同 Schema，但无相互依赖）
- Phase 2: T012-T017 测试任务全部可并行
- Phase 3: T023-T032 测试任务全部可并行；Phase 3 与 Phase 4 的实现部分可并行
- Phase 4: T038-T045 测试任务全部可并行
- Phase 5: T049-T054 和 T066-T075 测试任务组内可并行；T046 与 T055 可并行（不同文件）
- Phase 6: T076/T077（MCP）、T082/T083（模板）、T084（frontmatter）可并行
- Phase 7: T094 fixture 准备后，T095-T102 按依赖顺序执行

---

## Parallel Example: Phase 1

```bash
# 所有 Schema 扩展可并行执行（虽在同一文件但操作不同 Schema）:
Task T001: "新增 LanguageDistributionSchema in src/models/module-spec.ts"
Task T002: "扩展 SpecFrontmatterSchema in src/models/module-spec.ts"
Task T003: "扩展 ArchitectureIndexSchema in src/models/module-spec.ts"
Task T006: "扩展 GraphNodeSchema in src/models/dependency-graph.ts"
Task T007: "新增 LanguageFileStat + 扩展 ScanResult in src/utils/file-scanner.ts"
```

## Parallel Example: Phase 3 + Phase 4

```bash
# Phase 3 和 Phase 4 的实现部分可并行（不同文件）:
Task T018-T022: "buildDirectoryGraph in src/graph/directory-graph.ts"  # Phase 3
Task T033-T037: "module-grouper 语言感知 in src/batch/module-grouper.ts"  # Phase 4
```

---

## Implementation Strategy

### MVP First (US1 + US2 = P1 故事)

1. 完成 Phase 1: 数据模型扩展
2. 完成 Phase 2: scanFiles 增强
3. 完成 Phase 3: buildDirectoryGraph
4. 完成 Phase 4: module-grouper 语言感知
5. 完成 Phase 5: batch-orchestrator 核心
6. 完成 Phase 6: 索引模板增强（US2 部分）
7. **STOP and VALIDATE**: 对多语言测试项目运行完整批量生成，验证 US1 和 US2

### Incremental Delivery

1. Phase 1-5 → 多语言批量生成核心可用（US1）
2. + Phase 6 索引部分 → 语言分布索引可用（US2）
3. + Phase 5b/6a 过滤部分 → 语言过滤可用（US3）
4. + Phase 6a prepare 部分 → MCP 语言检测可用（US4）
5. + Phase 2 警告部分 → 友好警告可用（US5，已在 Phase 2 完成）
6. + Phase 5b 跨语言部分 → 跨语言标注可用（US6）
7. Phase 7 → 全量集成验证
8. Phase 8 → 收尾

---

## Risk Mitigation

| 风险 | 缓解措施 | 对应任务 |
|------|---------|---------|
| R1: dependency-cruiser 与语言过滤的交互 | T058 中通过 includeOnly 参数限定 TS/JS 文件 | T058, T065 |
| R2: 同目录多语言分组边界不准确 | T038-T045 充分的单元测试覆盖 | T035-T036 |
| R3: import 路径解析不准确 | 宽容策略 + confidence: medium 标注 | T019-T021, T028 |
| R4: 旧检查点格式兼容 | optional 字段 + 回归测试 | T064, T072 |
| R5: 单语言项目回归 | T065, T067, T096 专项回归验证 | T065, T067, T096 |

---

## Summary

| 指标 | 数值 |
|------|------|
| 总任务数 | 107 |
| Phase 1 (数据模型) | 8 任务 |
| Phase 2 (scanFiles) | 9 任务 |
| Phase 3 (directoryGraph) | 15 任务 |
| Phase 4 (module-grouper) | 13 任务 |
| Phase 5 (batch-orchestrator) | 30 任务 |
| Phase 6 (MCP + 索引) | 18 任务 |
| Phase 7 (集成验证) | 9 任务 |
| Phase 8 (Polish) | 5 任务 |
| 新增源文件 | 2 (directory-graph.ts, language-grouper.ts) |
| 修改源文件 | 10 |
| 新增测试文件 | 3 (directory-graph, language-grouper, multilang-batch) |
| 扩展测试文件 | 4 (file-scanner, module-grouper, batch-orchestrator, index-generator) |
| 预估代码量 | ~1100 行实现 + ~800 行测试 |

---

## Notes

- [P] 标记的任务可并行执行（操作不同文件或无相互依赖）
- [USn] 标记表示该任务服务的 User Story，便于追溯
- 每个 Phase 结束有 Checkpoint，可独立验证该 Phase 的完成状态
- Phase 5 是高风险阶段（编排复杂度最高），建议分两轮实现：5a (language-grouper) + 5b (batch-orchestrator 核心)
- 所有新增字段均为 optional，确保向后兼容——Phase 8 的回归验证是最后一道防线
