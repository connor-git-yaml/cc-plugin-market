# Tasks: Go LanguageAdapter 实现

**Feature**: 029-go-language-adapter
**Input**: `specs/029-go-language-adapter/plan.md`, `specs/029-go-language-adapter/spec.md`
**Prerequisites**: plan.md (已完成), spec.md (已完成)
**Scope**: 1 个新建源文件 + 2 个修改文件 + 1 个测试文件
**Tests**: spec SC-006 要求测试数量 >= 15，plan 设计 23 个 test case

---

## Phase 1: User Story 1 -- Go 项目的 spec 生成 (Priority: P1)

**Goal**: 实现 GoLanguageAdapter 核心类，使 `analyzeFile()` 能对 Go 文件提取完整的函数签名、struct 结构、interface 定义、method receiver 信息

**Independent Test**: 对 fixture 中的 `basic.go`、`visibility.go`、`methods.go` 调用 `analyzeFile()`，验证返回的 CodeSkeleton 包含正确的导出符号

### Tests for US1 (先写测试，确认失败)

- [ ] T001 [P] [US1] 编写测试: 静态属性验证 -- `id` 为 `'go'`、`languages` 为 `['go']`、`extensions` 包含 `.go`（size 为 1）、`defaultIgnoreDirs` 包含 `vendor`、接口完整性检查 (6 个 test case) -- `tests/adapters/go-adapter.test.ts`
- [ ] T002 [P] [US1] 编写测试: `analyzeFile()` 集成测试 -- 提取导出函数/struct/interface/const/var、首字母大小写可见性、method receiver 关联到 struct、空文件处理、语法错误容错 (5 个 test case) -- `tests/adapters/go-adapter.test.ts`

### Implementation for US1

- [ ] T003 [US1] 新建 `src/adapters/go-adapter.ts` -- 实现 GoLanguageAdapter 类：静态属性（`id`、`languages`、`extensions`、`defaultIgnoreDirs`）+ `analyzeFile()` 方法（委托 `TreeSitterAnalyzer.getInstance().analyze(filePath, 'go', options)`）+ `analyzeFallback()` 方法（委托 `tree-sitter-fallback.ts` 的 `analyzeFallback(filePath)`）+ `getTerminology()` + `getTestPatterns()`
- [ ] T004 [US1] 运行 T001、T002 的测试，确认 US1 相关 test case 通过

**Checkpoint**: GoLanguageAdapter 可对 Go 文件进行 AST 分析，返回有效的 CodeSkeleton

---

## Phase 2: User Story 2 -- Go 项目的 import 依赖识别 (Priority: P1)

**Goal**: 验证 `analyzeFile()` 正确解析 Go 的多种 import 形式（单行导入、分组导入）

**Independent Test**: 对 `basic.go` fixture 调用 `analyzeFile()`，验证返回的 CodeSkeleton.imports 包含所有 import 形式且属性正确

### Tests for US2

- [ ] T005 [US2] 编写测试: import 解析集成测试 -- 验证单行导入 `import "strings"` / 分组导入 `import ( "fmt"; "os" )` / `isTypeOnly` 为 false (1 个 test case，内含多项断言) -- `tests/adapters/go-adapter.test.ts`

### Implementation for US2

- [ ] T006 [US2] 验证 import 测试通过 -- `analyzeFile()` 已在 T003 中实现，此处运行 T005 确认 GoMapper 的 import 提取逻辑正确覆盖所有 import 形式

**Checkpoint**: Go 文件的 import 依赖被完整解析，包括单行导入和分组导入

---

## Phase 3: User Story 3 -- Go 文件自动路由到正确适配器 (Priority: P1)

**Goal**: 将 GoLanguageAdapter 注册到 LanguageAdapterRegistry，使 `.go` 文件自动路由

**Independent Test**: 调用 `registry.getAdapter('example.go')`，验证返回 GoLanguageAdapter 实例

### Tests for US3

- [ ] T007 [US3] 编写测试: Registry 集成测试 -- `getAdapter('example.go')` 返回 GoLanguageAdapter、不与 TS/JS 和 Python 适配器冲突、`getDefaultIgnoreDirs()` 包含 Go + Python + TS/JS 合集 (3 个 test case) -- `tests/adapters/go-adapter.test.ts`

### Implementation for US3

- [ ] T008 [US3] 修改 `src/adapters/index.ts` -- 三处改动: (1) 新增 `export { GoLanguageAdapter } from './go-adapter.js';` (2) 新增 `import { GoLanguageAdapter } from './go-adapter.js';` (3) 替换注释行 `// registry.register(new GoLanguageAdapter());` 为 `registry.register(new GoLanguageAdapter());`
- [ ] T009 [US3] 运行 T007 的 Registry 集成测试，确认路由正确

**Checkpoint**: `.go` 文件通过 Registry 自动路由到 GoLanguageAdapter，与其他适配器无冲突

---

## Phase 4: User Story 4 -- Go 解析降级的容错处理 (Priority: P2)

**Goal**: 验证 tree-sitter 失败时 `analyzeFallback()` 能通过正则提取返回基本的 CodeSkeleton；在 `tree-sitter-fallback.ts` 中新增 Go 正则降级支持

**Independent Test**: 对 Go fixture 文件调用 `analyzeFallback()`，验证返回的 CodeSkeleton 包含基本结构信息

### Tests & Implementation for US4

- [ ] T010 [US4] 编写测试: `analyzeFallback()` 验证 -- 对 `basic.go` 调用 `analyzeFallback()`，验证返回的 CodeSkeleton 至少包含基本的导出符号和 import 信息 (1 个 test case) -- `tests/adapters/go-adapter.test.ts`
- [ ] T011 [US4] 修改 `src/core/tree-sitter-fallback.ts` -- 新增 `extractGoExportsFromText()` 函数（正则提取首字母大写的 func/type/const/var）和 `extractGoImportsFromText()` 函数（正则提取 import 语句）；修改 `regexFallback()` 添加 `language === 'go'` 分支
- [ ] T012 [US4] 运行 T010，确认 analyzeFallback() 对 Go 文件正常工作

**Checkpoint**: tree-sitter 降级路径验证通过，Go 文件在 AST 不可用时仍能获取基本结构

---

## Phase 5: User Story 5 -- Go 特有术语在 LLM prompt 中的参数化 (Priority: P2)

**Goal**: `getTerminology()` 返回 Go 社区惯用术语

**Independent Test**: 调用 `getTerminology()` 验证每个字段的内容

### Tests for US5

- [ ] T013 [US5] 编写测试: `getTerminology()` 验证 -- `codeBlockLanguage` 为 `'go'`、`exportConcept` 描述首字母大写规则、`interfaceConcept` 描述隐式接口实现 (3 个 test case) -- `tests/adapters/go-adapter.test.ts`

### Implementation for US5

- [ ] T014 [US5] `getTerminology()` 已在 T003 中实现（返回静态对象）。运行 T013 确认术语映射正确

**Checkpoint**: LLM prompt 使用 Go 社区惯用术语生成文档

---

## Phase 6: User Story 6 -- Go 测试文件的正确识别 (Priority: P2)

**Goal**: `getTestPatterns()` 返回 Go 标准的测试文件匹配模式

**Independent Test**: 对 `server_test.go`、`main_test.go`、`server.go`、`test.go` 测试匹配结果

### Tests for US6

- [ ] T015 [US6] 编写测试: `getTestPatterns()` 验证 -- `filePattern` 匹配 `server_test.go` 和 `main_test.go`、不匹配 `server.go`、`main.go` 和 `test.go`、`testDirs` 为空数组 (4 个 test case) -- `tests/adapters/go-adapter.test.ts`

### Implementation for US6

- [ ] T016 [US6] `getTestPatterns()` 已在 T003 中实现（返回静态对象）。运行 T015 确认匹配模式正确

**Checkpoint**: 测试文件识别准确率 100%（SC-007）

---

## Phase 7: User Story 7 -- Go 生态特有目录的自动忽略 (Priority: P3)

**Goal**: `defaultIgnoreDirs` 包含 Go 的 `vendor` 目录

**Independent Test**: 检查属性值，验证 Registry 聚合后的忽略目录包含 Go 的 `vendor` 目录

### Tests & Verification for US7

- [ ] T017 [US7] US7 的验证已包含在 T001（静态属性测试 `defaultIgnoreDirs`）和 T007（Registry 集成测试 `getDefaultIgnoreDirs()`）中，无需额外 task

**Checkpoint**: Go 的 `vendor` 目录自动排除，无需用户手动配置

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 零回归验证、代码质量检查

- [ ] T018 运行完整测试套件 `npm test`，验证现有 TS/JS 和 Python 测试 100% 通过（FR-026, SC-004）
- [ ] T019 运行 `npm run lint`，确认无 lint 错误
- [ ] T020 检查 `package.json`，确认无新增运行时依赖（FR-027）
- [ ] T021 验证 SC-005: GoLanguageAdapter 仅新建 1 个源文件 + 修改 `index.ts` 注册代码 + 修改 `tree-sitter-fallback.ts` 添加 Go 正则降级，未修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts`

---

## FR 覆盖映射表

| FR | 级别 | 描述 | 覆盖 Task |
|-----|------|------|-----------|
| FR-001 | MUST | GoLanguageAdapter 实现 LanguageAdapter 接口全部方法和属性 | T003, T001 |
| FR-002 | MUST | `id` 为 `'go'` | T003, T001 |
| FR-003 | MUST | `languages` 为 `['go']` | T003, T001 |
| FR-004 | MUST | `extensions` 包含 `.go` | T003, T001 |
| FR-005 | MUST | `analyzeFile()` 委托 TreeSitterAnalyzer | T003, T002 |
| FR-006 | MUST | `language: 'go'`, `parserUsed: 'tree-sitter'` | T002 |
| FR-007 | MUST | 提取导出函数声明（含多返回值） | T002 |
| FR-008 | MUST | 提取导出 struct 定义 | T002 |
| FR-009 | MUST | 提取导出 interface 定义 | T002 |
| FR-010 | MUST | method receiver 关联到 struct | T002 |
| FR-011 | MUST | 首字母大小写可见性规则 | T002 |
| FR-012 | MUST | 提取导出 const/var 声明 | T002 |
| FR-013 | MUST | 解析单行导入 `import "fmt"` | T005 |
| FR-014 | MUST | 解析分组导入 | T005 |
| FR-015 | MUST | 处理别名导入 | T005 |
| FR-016 | MUST | `isTypeOnly` 为 `false` | T005 |
| FR-017 | MUST | `analyzeFallback()` 提供降级分析 | T003, T010, T011 |
| FR-018 | MUST | Go 正则降级识别 func/type/import 模式 | T011 |
| FR-019 | MUST | `getTerminology()` 返回 Go 术语 | T003, T013 |
| FR-020 | MUST | `getTestPatterns()` 匹配 `*_test.go` | T003, T015 |
| FR-021 | MUST | `defaultIgnoreDirs` 包含 `vendor` | T003, T001 |
| FR-022 | MUST | 在 `bootstrapAdapters()` 中注册 | T008, T007 |
| FR-023 | MUST | 不与其他适配器扩展名冲突 | T007 |
| FR-024 | MUST | file-scanner 自动扫描 `.go`，排除 `vendor` | T007 |
| FR-025 | MAY | `buildDependencyGraph()` -- 初始版本不实现 | T003（不实现） |
| FR-026 | MUST | 零回归：现有 TS/JS 和 Python 测试 100% 通过 | T018 |
| FR-027 | MUST | 无新增运行时依赖 | T020 |

**覆盖率**: 27/27 FR = 100%

---

## 依赖与并行说明

### Phase 依赖关系

```
Phase 1 (US1: 核心实现) --- 无依赖，立即开始（fixture 已有）
       |
       |-- Phase 2 (US2: import) --- 依赖 T003（适配器已实现）
       |-- Phase 4 (US4: 降级)  --- 依赖 T003 + T011（Go 正则降级）
       |-- Phase 5 (US5: 术语)  --- 依赖 T003
       |-- Phase 6 (US6: 测试模式) -- 依赖 T003
       \-- Phase 7 (US7: 忽略目录) -- 依赖 T003
       |
       v
Phase 3 (US3: 注册集成) --- 依赖 T003（适配器文件存在）
       |
       v
Phase 8 (Polish) --- 依赖所有 Phase 完成
```

### 并行机会

- **T001, T002**: 测试编写可与适配器实现并行（先写测试、确认失败）
- **T005, T010, T013, T015**: US2/US4/US5/US6 的测试编写可在 T003 实现前并行编写
- **Phase 2-7**: T003 完成后，US2-US7 的验证步骤可并行执行（除 US4 需 T011 先完成）

### 推荐实现策略: MVP First

1. **编写所有测试** T001, T002, T005, T007, T010, T013, T015（确认全部失败）
2. **实现核心** T003（`go-adapter.ts`）-- 大部分测试将自动通过
3. **注册集成** T008（`index.ts` 修改）-- Registry 测试通过
4. **Go 正则降级** T011（`tree-sitter-fallback.ts` 修改）-- analyzeFallback 测试通过
5. **验证通过** T004, T006, T009, T012, T014, T016
6. **零回归** T018-T021（Polish）

**MVP 范围**: US1 (Phase 1) + US3 (Phase 3) = Go 文件可分析 + 自动路由，即可交付基本的 Go 支持能力。

---

## 任务统计

| 指标 | 值 |
|------|-----|
| 总任务数 | 21 |
| 测试 test case 数 | 23 (>= 15, 满足 SC-006) |
| 覆盖 User Stories | 7 |
| 可并行任务占比 | 40% (T001-T002, T005, T010, T013, T015 可并行) |
| 新建源文件 | 1 (`src/adapters/go-adapter.ts`) |
| 修改源文件 | 2 (`src/adapters/index.ts`, `src/core/tree-sitter-fallback.ts`) |
| 新建测试文件 | 1 (`tests/adapters/go-adapter.test.ts`) |
| 新建 fixture 文件 | 0（复用 Feature 027 已有 Go fixture） |
