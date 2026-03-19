# Tasks: ProjectContext 统一上下文

**Input**: Design documents from `/specs/035-project-context-unified/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md (required)

**Tests**: spec.md 明确要求单元测试（FR-019 ~ FR-022），所有 Story Phase 均包含测试任务。

**Organization**: 任务按 User Story 组织，支持增量交付。Story 6（向后兼容）贯穿 Phase 2（Schema 扩展阶段），不独立成 Phase。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1~US6）
- 每个任务包含精确文件路径

## Path Conventions

- **Source**: `src/panoramic/` 目录
- **Tests**: `tests/panoramic/` 目录
- **Existing files**: `src/panoramic/interfaces.ts`（修改）、`src/utils/file-scanner.ts`（复用，不修改）

---

## Phase 1: Setup

**Purpose**: 创建新文件骨架，确认现有基础设施完整

- [x] T001 创建 `src/panoramic/project-context.ts` 空模块骨架（包含文件头注释、zod/fs/path 导入占位、空 `buildProjectContext` 函数签名导出）
- [x] T002 [P] 创建 `tests/panoramic/project-context.test.ts` 空测试骨架（包含 vitest 导入、describe 块占位）
- [x] T003 [P] 运行 `npm run build` 和 `npm test` 确认现有代码基线通过——记录 Feature 034 测试通过状态作为向后兼容基准

**Checkpoint**: 新文件就位，现有代码编译和测试均通过。

---

## Phase 2: Schema 扩展 — US6 向后兼容 + Schema 定义（Priority: P1）

**Goal**: 在 `interfaces.ts` 中使用 `.extend()` 扩展 ProjectContextSchema，新增四个属性（全部提供 `.default()` 值），确保 Feature 034 已交付代码零修改通过编译和测试。

**Independent Test**: 扩展后运行 `npm test`，Feature 034 的 `schemas.test.ts` 和 `mock-generator.test.ts` 全部通过；`ProjectContextSchema.parse({ projectRoot: '/tmp', configFiles: new Map() })` 成功返回包含新属性默认值的对象。

### 测试先行

- [x] T004 [US6] 在 `tests/panoramic/project-context.test.ts` 中编写向后兼容测试组 `describe('Schema 向后兼容性')`：验证仅传入 `{ projectRoot, configFiles }` 的 parse 调用成功，新增字段使用默认值（packageManager='unknown', workspaceType='single', detectedLanguages=[], existingSpecs=[]）——此测试应当前 FAIL

### 实现

- [x] T005 [US6] 在 `src/panoramic/interfaces.ts` 中新增 `PackageManagerSchema` 枚举 Schema 及 `PackageManager` type（10 个枚举值：npm/yarn/pnpm/pip/uv/go/maven/gradle/pipenv/unknown）——插入在 ProjectContext 区块之前
- [x] T006 [US6] 在 `src/panoramic/interfaces.ts` 中新增 `WorkspaceTypeSchema` 枚举 Schema 及 `WorkspaceType` type（2 个枚举值：single/monorepo）——紧接 PackageManagerSchema 之后
- [x] T007 [US6] 在 `src/panoramic/interfaces.ts` 中将现有 `ProjectContextSchema` 改为 `BaseProjectContextSchema`（内部常量），然后重新导出 `ProjectContextSchema = BaseProjectContextSchema.extend({ packageManager, workspaceType, detectedLanguages, existingSpecs })`，所有新字段带 `.default()` 值。更新 `ProjectContext` type 为 `z.infer<typeof ProjectContextSchema>`。确保 `export` 名称和导入路径不变

### 验证

- [x] T008 [US6] 运行 `npm run build` 确认编译零错误；运行 `npm test` 确认 Feature 034 的 `schemas.test.ts`（3 个 ProjectContextSchema 测试）和 `mock-generator.test.ts` 全部通过；确认 T004 新增的向后兼容测试也通过

**Checkpoint**: Schema 扩展完成，向后兼容验证通过。后续 Phase 可开始实现 buildProjectContext 的各子流程。

---

## Phase 3: US1 — 包管理器自动检测（Priority: P1）

**Goal**: 实现 `detectPackageManager()` 内部函数，根据 lock 文件优先级检测包管理器类型。

**Independent Test**: 在临时目录放置 `package-lock.json` 后调用 `buildProjectContext()`，验证 `packageManager` 为 `"npm"`。

### 测试先行

- [x] T009 [US1] 在 `tests/panoramic/project-context.test.ts` 中编写 `describe('detectPackageManager')` 测试组：(a) npm 检测（`package-lock.json`）；(b) pnpm 检测（`pnpm-lock.yaml`）；(c) uv 检测（`uv.lock`）；(d) 多 lock 文件共存按优先级选择（`pnpm-lock.yaml` + `package-lock.json` -> `"pnpm"`）；(e) 无 lock 文件返回 `"unknown"`——使用 `os.tmpdir()` + `fs.mkdtempSync` 创建临时目录

### 实现

- [x] T010 [US1] 在 `src/panoramic/project-context.ts` 中实现 `detectPackageManager(projectRoot: string): PackageManager` 内部函数——定义 LOCK_FILE_PRIORITY 数组（按 pnpm > yarn > npm > uv > pipenv > go > maven > gradle 顺序），遍历检查 `fs.existsSync(path.join(projectRoot, lockFile))`，第一个匹配即返回

### 验证

- [x] T011 [US1] 运行 T009 测试组确认全部通过

---

## Phase 4: US2 — Workspace 类型识别（Priority: P1）

**Goal**: 实现 `detectWorkspaceType()` 内部函数，判断项目是 single 还是 monorepo。

**Independent Test**: 在临时目录创建 `pnpm-workspace.yaml` 后调用 `buildProjectContext()`，验证 `workspaceType` 为 `"monorepo"`。

### 测试先行

- [x] T012 [US2] 在 `tests/panoramic/project-context.test.ts` 中编写 `describe('detectWorkspaceType')` 测试组：(a) `package.json` 含 `workspaces` 字段 -> monorepo；(b) `pnpm-workspace.yaml` 存在 -> monorepo；(c) `pyproject.toml` 含 `[tool.uv.workspace]` 段 -> monorepo；(d) `lerna.json` 存在 -> monorepo；(e) 仅有无 workspaces 的 `package.json` -> single；(f) `package.json` 为非法 JSON 时降级为 single

### 实现

- [x] T013 [US2] 在 `src/panoramic/project-context.ts` 中实现 `detectWorkspaceType(projectRoot: string): WorkspaceType` 内部函数——检查 `pnpm-workspace.yaml` 和 `lerna.json` 存在性，解析 `package.json` 检查 `workspaces` 字段（JSON.parse 失败时 catch 跳过），正则匹配 `pyproject.toml` 中 `/^\[tool\.uv\.workspace\]/m`（readFileSync 失败时 catch 跳过）

### 验证

- [x] T014 [US2] 运行 T012 测试组确认全部通过

---

## Phase 5: US3 — 多语言检测（Priority: P1）

**Goal**: 实现 `detectLanguages()` 内部函数，复用 `scanFiles()` 提取项目语言列表。

**Independent Test**: 在临时目录创建 `.ts` 和 `.py` 文件后调用 `buildProjectContext()`，验证 `detectedLanguages` 包含对应语言。

### 测试先行

- [x] T015 [US3] 在 `tests/panoramic/project-context.test.ts` 中编写 `describe('detectLanguages')` 测试组：(a) TypeScript + Python 文件共存——先 `bootstrapAdapters()` 初始化 Registry，验证 `detectedLanguages` 包含两种语言 id；(b) Registry 未初始化时返回空数组；(c) 无已知语言文件返回空数组——每个测试后 `LanguageAdapterRegistry.resetInstance()` 清理

### 实现

- [x] T016 [US3] 在 `src/panoramic/project-context.ts` 中实现 `detectLanguages(projectRoot: string): string[]` 内部函数——导入 `LanguageAdapterRegistry` 和 `scanFiles`，检查 `registry.isEmpty()` 后调用 `scanFiles(projectRoot, { projectRoot })`，从 `result.languageStats` 提取 key 列表返回

### 验证

- [x] T017 [US3] 运行 T015 测试组确认全部通过

---

## Phase 6: US4 — 配置文件扫描（Priority: P2）

**Goal**: 实现 `scanConfigFiles()` 内部函数，扫描根目录已知配置文件。

**Independent Test**: 在临时目录创建 `package.json` 和 `tsconfig.json` 后调用 `buildProjectContext()`，验证 `configFiles` Map 包含对应条目。

### 测试先行

- [x] T018 [US4] 在 `tests/panoramic/project-context.test.ts` 中编写 `describe('scanConfigFiles')` 测试组：(a) `package.json` + `tsconfig.json` 存在时 Map 包含两个条目且 value 为绝对路径；(b) `tsconfig.build.json` 被 `tsconfig.*.json` 通配匹配；(c) 无已知配置文件时返回空 Map

### 实现

- [x] T019 [US4] 在 `src/panoramic/project-context.ts` 中实现 `scanConfigFiles(projectRoot: string): Map<string, string>` 内部函数——定义 `KNOWN_CONFIG_FILES` 精确匹配列表（15 个文件名）和 `KNOWN_CONFIG_PATTERNS` 正则列表（`/^tsconfig\..+\.json$/`），对精确匹配使用 `fs.existsSync`，对正则匹配使用 `fs.readdirSync(projectRoot)` 过滤

### 验证

- [x] T020 [US4] 运行 T018 测试组确认全部通过

---

## Phase 7: US5 — 已有 spec 文件发现（Priority: P2）

**Goal**: 实现 `discoverExistingSpecs()` 内部函数，递归扫描 `specs/` 目录下 `*.spec.md` 文件。

**Independent Test**: 在临时目录创建 `specs/feature/module.spec.md` 后调用 `buildProjectContext()`，验证 `existingSpecs` 包含该文件绝对路径。

### 测试先行

- [x] T021 [US5] 在 `tests/panoramic/project-context.test.ts` 中编写 `describe('discoverExistingSpecs')` 测试组：(a) `specs/` 目录含 `.spec.md` 文件时返回绝对路径数组；(b) `specs/` 目录不存在时返回空数组；(c) `specs/` 目录为空时返回空数组

### 实现

- [x] T022 [US5] 在 `src/panoramic/project-context.ts` 中实现 `discoverExistingSpecs(projectRoot: string): string[]` 内部函数——递归遍历 `path.join(projectRoot, 'specs')` 目录，收集所有 `*.spec.md` 文件的绝对路径，目录不存在或不可读时返回空数组

### 验证

- [x] T023 [US5] 运行 T021 测试组确认全部通过

---

## Phase 8: buildProjectContext 集成组装

**Goal**: 将五个子流程组合为完整的 `buildProjectContext()` 异步构建函数，通过 Schema 验证返回 ProjectContext。

### 测试先行

- [x] T024 在 `tests/panoramic/project-context.test.ts` 中编写 `describe('buildProjectContext 集成')` 测试组：(a) `projectRoot` 不存在时抛出包含路径的 Error；(b) `projectRoot` 是文件而非目录时抛出 Error；(c) 包含 `package-lock.json` + `package.json`（无 workspaces）+ `.ts` 文件的标准项目返回完整 ProjectContext 对象，`packageManager='npm'`、`workspaceType='single'`、`configFiles` 包含 `package.json`、通过 `ProjectContextSchema.parse()` 验证；(d) 空目录返回全默认值对象

### 实现

- [x] T025 在 `src/panoramic/project-context.ts` 中实现 `buildProjectContext(projectRoot: string): Promise<ProjectContext>` 主函数——(1) `fs.existsSync` + `fs.statSync` 验证目录；(2) 调用 detectPackageManager、detectWorkspaceType、detectLanguages、scanConfigFiles、discoverExistingSpecs 五个子流程；(3) 组装 raw 对象；(4) `ProjectContextSchema.parse(raw)` 验证后返回

### 验证

- [x] T026 运行 T024 测试组确认全部通过

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 全局验证、代码质量和文档完善

- [x] T027 运行 `npm run build` 确认整个项目编译零错误（FR-025）
- [x] T028 [P] 运行 `npm test` 确认所有测试通过（包含 Feature 034 回归测试和所有新增测试）——退出码为 0（FR-022）
- [x] T029 [P] 运行 `npm run lint` 确认新增代码符合项目 lint 规范
- [x] T030 [P] 检查 `src/panoramic/project-context.ts` 代码注释完整性——每个内部函数和主函数需有中文 JSDoc 注释
- [x] T031 确认 FR-024 约束——验证 `src/batch/batch-orchestrator.ts` 和其他现有文件未被修改（git diff 检查）

**Checkpoint**: 全部任务完成，Feature 035 交付就绪。

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|---------|
| FR-001 | Schema 扩展方式（.extend + 重新赋值同名变量） | T005, T006, T007 |
| FR-002 | packageManager 枚举值定义 | T005 |
| FR-003 | workspaceType 枚举值定义 | T006 |
| FR-004 | detectedLanguages 类型定义 | T007 |
| FR-005 | existingSpecs 类型定义 | T007 |
| FR-006 | buildProjectContext 函数签名与导出 | T001, T025 |
| FR-007 | projectRoot 验证（不存在/非目录） | T024, T025 |
| FR-008 | 返回值通过 Schema.parse 验证 | T024, T025 |
| FR-009 | lock 文件优先级检测规则 | T009, T010 |
| FR-010 | 多 lock 文件共存按优先级选择 | T009, T010 |
| FR-011 | monorepo 四种检测条件 | T012, T013 |
| FR-012 | package.json/pyproject.toml 解析失败降级 | T012, T013 |
| FR-013 | 复用 scanFiles 提取语言列表 | T015, T016 |
| FR-014 | Registry 未初始化返回空数组 | T015, T016 |
| FR-015 | 已知配置文件列表扫描（15 个精确 + 通配） | T018, T019 |
| FR-016 | configFiles Map key/value 格式 | T018, T019 |
| FR-017 | specs/ 目录 *.spec.md 扫描 | T021, T022 |
| FR-018 | specs/ 不存在时返回空数组 | T021, T022 |
| FR-019 | 测试文件路径 tests/panoramic/project-context.test.ts | T002 |
| FR-020 | 测试覆盖场景（6 类场景） | T009, T012, T015, T018, T021, T024 |
| FR-021 | 向后兼容性测试 | T004, T008 |
| FR-022 | npm test 退出码 0 | T028 |
| FR-023 | project-context.ts 位于 src/panoramic/ | T001 |
| FR-024 | 不修改现有文件逻辑 | T031 |
| FR-025 | npm run build 零错误 | T027 |

**FR 覆盖率**: 25/25 = 100%

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**: 无依赖，立即开始
- **Phase 2（Schema 扩展）**: 依赖 Phase 1——是所有后续 Phase 的前置条件
- **Phase 3~7（US1~US5）**: 均依赖 Phase 2 完成；Phase 3/4/5 为 P1 优先级可按顺序执行，Phase 6/7 为 P2 优先级
- **Phase 8（集成组装）**: 依赖 Phase 3~7 全部完成
- **Phase 9（Polish）**: 依赖 Phase 8 完成

### User Story Dependencies

- **US6（向后兼容）**: Phase 2 独立完成，是所有其他 Story 的前置
- **US1（包管理器）**: 依赖 Phase 2，与 US2/US3 无直接依赖
- **US2（Workspace）**: 依赖 Phase 2，与 US1/US3 无直接依赖
- **US3（多语言）**: 依赖 Phase 2，与 US1/US2 无直接依赖
- **US4（配置文件）**: 依赖 Phase 2，与 US1/US2/US3 无直接依赖
- **US5（spec 发现）**: 依赖 Phase 2，与 US1~US4 无直接依赖

### Parallel Opportunities

- **Phase 1**: T002 和 T003 可与 T001 并行
- **Phase 2**: T005 和 T006 可并行（不同代码区块）；T004 需在 T007 之前编写以验证 fail-first
- **Phase 3~7**: US1(Phase 3)、US2(Phase 4)、US3(Phase 5) 三者互相独立，可并行实现；US4(Phase 6)、US5(Phase 7) 也与前三者独立
- **Phase 9**: T028、T029、T030 可并行

### 推荐实现策略

**MVP First（推荐）**:
1. Phase 1 + Phase 2 -> Schema 扩展 + 向后兼容验证
2. Phase 3 + Phase 4 + Phase 5 -> P1 三个核心检测能力（包管理器 + Workspace + 语言）
3. Phase 8 -> 集成组装 buildProjectContext（此时 P2 功能使用默认空值）
4. **STOP & VALIDATE**: 对本项目运行 buildProjectContext，验证 SC-001/SC-002
5. Phase 6 + Phase 7 -> P2 增强能力（配置文件扫描 + spec 发现）
6. Phase 9 -> 收尾验证

---

## Notes

- 所有测试使用 `os.tmpdir()` + `fs.mkdtempSync()` 创建隔离临时目录，`afterEach` 清理
- 语言检测测试需 `bootstrapAdapters()` / `LanguageAdapterRegistry.resetInstance()` 生命周期管理
- pyproject.toml 解析使用正则 `/^\[tool\.uv\.workspace\]/m`，不引入 TOML 库
- `configFiles` 扫描仅根目录（深度 1），Monorepo 子包配置由 Feature 040 负责
- 任务总计 31 个，覆盖 6 个 User Stories，约 65% 任务可并行
