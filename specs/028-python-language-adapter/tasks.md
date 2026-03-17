# Tasks: Python LanguageAdapter 实现

**Feature**: 028-python-language-adapter
**Input**: `specs/028-python-language-adapter/plan.md`, `specs/028-python-language-adapter/spec.md`
**Prerequisites**: plan.md (已完成), spec.md (已完成)
**Scope**: 1 个新建源文件 + 1 个修改文件 + 1 个测试文件 + 5 个 fixture 文件
**Tests**: spec SC-006 要求测试数量 >= 15，plan 设计 21 个 test case

---

## Phase 1: Setup (Fixture 文件准备)

**Purpose**: 创建 Python 测试 fixture 文件，为 TDD（先写测试、确认失败、再实现）做准备

- [ ] T001 [P] 创建 `tests/fixtures/python/basic.py` — 包含公开函数（`def greet(name: str) -> str`）、async 函数（`async def fetch_data(url: str) -> dict`）、类型注解参数、私有函数（`def _helper()`）
- [ ] T002 [P] 创建 `tests/fixtures/python/classes.py` — 包含带基类的类定义、`@staticmethod`、`@classmethod`、`@property` 装饰器方法、普通成员方法
- [ ] T003 [P] 创建 `tests/fixtures/python/with_all.py` — 包含 `__all__ = ['PublicFunc', 'PublicClass']`，同时定义不在 `__all__` 中的函数和类
- [ ] T004 [P] 创建 `tests/fixtures/python/imports.py` — 包含 `import os`、`from os.path import join, exists`、`from . import utils`、`from ..models import User`、`from module import *`、普通 `import sys`
- [ ] T005 [P] 创建 `tests/fixtures/python/empty.py` — 空文件（0 字节）

**Checkpoint**: 所有 fixture 文件就绪，可开始编写测试

---

## Phase 2: User Story 1 — Python 项目的 spec 生成 (Priority: P1)

**Goal**: 实现 PythonLanguageAdapter 核心类，使 `analyzeFile()` 能对 Python 文件提取完整的函数签名、类结构、导出符号

**Independent Test**: 对 fixture 中的 `basic.py`、`classes.py`、`with_all.py` 调用 `analyzeFile()`，验证返回的 CodeSkeleton 包含正确的导出符号

### Tests for US1 (先写测试，确认失败)

- [ ] T006 [P] [US1] 编写测试: 静态属性验证 — `id` 为 `'python'`、`languages` 为 `['python']`、`extensions` 包含 `.py` 和 `.pyi`、`defaultIgnoreDirs` 包含必要目录、接口完整性检查 (6 个 test case) — `tests/adapters/python-adapter.test.ts`
- [ ] T007 [P] [US1] 编写测试: `analyzeFile()` 集成测试 — 提取公开函数（含 async def）、提取类定义和装饰器、`__all__` 过滤、空文件返回空 CodeSkeleton (4 个 test case) — `tests/adapters/python-adapter.test.ts`

### Implementation for US1

- [ ] T008 [US1] 新建 `src/adapters/python-adapter.ts` — 实现 PythonLanguageAdapter 类：静态属性（`id`、`languages`、`extensions`、`defaultIgnoreDirs`）+ `analyzeFile()` 方法（委托 `TreeSitterAnalyzer.getInstance().analyze(filePath, 'python', options)`）+ `analyzeFallback()` 方法（委托 `tree-sitter-fallback.ts` 的 `analyzeFallback(filePath)`）
- [ ] T009 [US1] 运行 T006、T007 的测试，确认 US1 相关 test case 通过

**Checkpoint**: PythonLanguageAdapter 可对 Python 文件进行 AST 分析，返回有效的 CodeSkeleton

---

## Phase 3: User Story 2 — Python 项目的 import 依赖识别 (Priority: P1)

**Goal**: 验证 `analyzeFile()` 正确解析 Python 的多种 import 形式（绝对导入、相对导入、通配导入）

**Independent Test**: 对 `imports.py` fixture 调用 `analyzeFile()`，验证返回的 CodeSkeleton.imports 包含所有 import 形式且属性正确

### Tests for US2

- [ ] T010 [US2] 编写测试: import 解析集成测试 — 验证 `import os` / `from os.path import join, exists` / 相对导入 / `from module import *` / `isTypeOnly` 为 false (1 个 test case，内含多项断言) — `tests/adapters/python-adapter.test.ts`

### Implementation for US2

- [ ] T011 [US2] 验证 import 测试通过 — `analyzeFile()` 已在 T008 中实现，此处运行 T010 确认 PythonMapper 的 import 提取逻辑正确覆盖所有 import 形式

**Checkpoint**: Python 文件的 import 依赖被完整解析，包括绝对导入、相对导入、通配导入

---

## Phase 4: User Story 3 — Python 文件自动路由到正确适配器 (Priority: P1)

**Goal**: 将 PythonLanguageAdapter 注册到 LanguageAdapterRegistry，使 `.py`/`.pyi` 文件自动路由

**Independent Test**: 调用 `registry.getAdapter('example.py')` 和 `registry.getAdapter('example.pyi')`，验证返回 PythonLanguageAdapter 实例

### Tests for US3

- [ ] T012 [US3] 编写测试: Registry 集成测试 — `getAdapter('example.py')` 返回 PythonLanguageAdapter、`getAdapter('example.pyi')` 同样返回、`getDefaultIgnoreDirs()` 包含 Python + TS/JS 合集 (3 个 test case) — `tests/adapters/python-adapter.test.ts`

### Implementation for US3

- [ ] T013 [US3] 修改 `src/adapters/index.ts` — 三处改动: (1) 新增 `export { PythonLanguageAdapter } from './python-adapter.js';` (2) 新增 `import { PythonLanguageAdapter } from './python-adapter.js';` (3) 取消注释 `registry.register(new PythonLanguageAdapter());`
- [ ] T014 [US3] 运行 T012 的 Registry 集成测试，确认路由正确

**Checkpoint**: `.py`/`.pyi` 文件通过 Registry 自动路由到 PythonLanguageAdapter，与 TsJsLanguageAdapter 无冲突

---

## Phase 5: User Story 4 — Python 解析降级的容错处理 (Priority: P2)

**Goal**: 验证 tree-sitter 失败时 `analyzeFallback()` 能通过正则提取返回基本的 CodeSkeleton

**Independent Test**: 对 Python fixture 文件调用 `analyzeFallback()`，验证返回的 CodeSkeleton 包含基本结构信息

### Tests & Verification for US4

- [ ] T015 [US4] 编写测试: `analyzeFallback()` 验证 — 对 `basic.py` 调用 `analyzeFallback()`，验证返回的 CodeSkeleton 至少包含通过正则匹配到的 `def`、`class`、`import` 信息 (1 个 test case) — `tests/adapters/python-adapter.test.ts`

### Implementation for US4

- [ ] T016 [US4] `analyzeFallback()` 已在 T008 中实现（委托 `tree-sitter-fallback.ts`，该文件已内置 Python 正则降级支持）。运行 T015 确认通过

**Checkpoint**: tree-sitter 降级路径验证通过，Python 文件在 AST 不可用时仍能获取基本结构

---

## Phase 6: User Story 5 — Python 特有术语在 LLM prompt 中的参数化 (Priority: P2)

**Goal**: `getTerminology()` 返回 Python 社区惯用术语

**Independent Test**: 调用 `getTerminology()` 验证每个字段的内容

### Tests for US5

- [ ] T017 [US5] 编写测试: `getTerminology()` 验证 — `codeBlockLanguage` 为 `'python'`、`exportConcept` 包含 `__all__`、`interfaceConcept` 包含 `Protocol` 和 `ABC`、`typeSystemDescription` 包含 type hints、`moduleSystem` 包含 package (3 个 test case) — `tests/adapters/python-adapter.test.ts`

### Implementation for US5

- [ ] T018 [US5] `getTerminology()` 已在 T008 中实现（返回静态对象）。运行 T017 确认术语映射正确

**Checkpoint**: LLM prompt 使用 Python 社区惯用术语生成文档

---

## Phase 7: User Story 6 — Python 测试文件的正确识别 (Priority: P2)

**Goal**: `getTestPatterns()` 返回 Python 社区标准的测试文件匹配模式

**Independent Test**: 对 `test_example.py`、`example_test.py`、`conftest.py`、`main.py` 测试匹配结果

### Tests for US6

- [ ] T019 [US6] 编写测试: `getTestPatterns()` 验证 — `filePattern` 匹配 `test_example.py`、匹配 `example_test.py` 和 `conftest.py`、不匹配 `main.py` 和 `utils.py`、`testDirs` 包含 `tests` 和 `test` (4 个 test case) — `tests/adapters/python-adapter.test.ts`

### Implementation for US6

- [ ] T020 [US6] `getTestPatterns()` 已在 T008 中实现（返回静态对象）。运行 T019 确认匹配模式正确

**Checkpoint**: 测试文件识别准确率 100%（SC-007）

---

## Phase 8: User Story 7 — Python 生态特有目录的自动忽略 (Priority: P3)

**Goal**: `defaultIgnoreDirs` 包含 Python 生态的缓存/临时目录

**Independent Test**: 检查属性值，验证 Registry 聚合后的忽略目录包含 Python 项目常见目录

### Tests & Verification for US7

- [ ] T021 [US7] US7 的验证已包含在 T006（静态属性测试）和 T012（Registry 集成测试 `getDefaultIgnoreDirs()`）中，无需额外 task

**Checkpoint**: Python 生态目录自动排除，无需用户手动配置

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 零回归验证、代码质量检查

- [ ] T022 运行完整测试套件 `npm test`，验证现有 TS/JS 测试 100% 通过（FR-027, SC-004）
- [ ] T023 运行 `npm run lint`，确认无 lint 错误
- [ ] T024 检查 `package.json`，确认无新增运行时依赖（FR-028）
- [ ] T025 验证 SC-005: PythonLanguageAdapter 仅新建 1 个源文件 + 修改 `bootstrapAdapters()` 1 行注册代码，未修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts`

---

## FR 覆盖映射表

| FR | 级别 | 描述 | 覆盖 Task |
|-----|------|------|-----------|
| FR-001 | MUST | PythonLanguageAdapter 实现 LanguageAdapter 接口全部方法和属性 | T008, T006 |
| FR-002 | MUST | `id` 为 `'python'` | T008, T006 |
| FR-003 | MUST | `languages` 为 `['python']` | T008, T006 |
| FR-004 | MUST | `extensions` 包含 `.py` 和 `.pyi` | T008, T006 |
| FR-005 | MUST | `analyzeFile()` 委托 TreeSitterAnalyzer | T008, T007 |
| FR-006 | MUST | `language: 'python'`, `parserUsed: 'tree-sitter'` | T007 |
| FR-007 | MUST | 提取公开函数定义（含 async def） | T007 |
| FR-008 | MUST | 提取公开类定义 | T007 |
| FR-009 | MUST | 识别装饰器（staticmethod, classmethod, property） | T007 |
| FR-010 | MUST | 尊重 `__all__` 列表 | T007 |
| FR-011 | MUST | 默认排除 `_` 前缀私有符号 | T007 |
| FR-012 | MUST | 解析 `import <module>` | T010 |
| FR-013 | MUST | 解析 `from <module> import <names>` | T010 |
| FR-014 | MUST | 识别相对导入 | T010 |
| FR-015 | MUST | 处理通配导入 `from module import *` | T010 |
| FR-016 | MUST | `isTypeOnly` 为 `false` | T010 |
| FR-017 | MUST | `analyzeFallback()` 提供正则降级 | T008, T015 |
| FR-018 | SHOULD | 降级识别 import/def/class 模式 | T015 |
| FR-019 | MUST | `getTerminology()` 返回 Python 术语 | T008, T017 |
| FR-020 | MUST | `getTestPatterns()` 匹配 Python 测试文件 | T008, T019 |
| FR-021 | MUST | `defaultIgnoreDirs` 包含 5 个必要目录 | T008, T006 |
| FR-022 | SHOULD | 额外包含 `.pytest_cache`、`.eggs` | T006 |
| FR-023 | MUST | 在 `bootstrapAdapters()` 中注册 | T013, T012 |
| FR-024 | MUST | 不与 TsJsLanguageAdapter 扩展名冲突 | T012 |
| FR-025 | MUST | file-scanner 自动扫描 `.py`/`.pyi`，排除 Python 忽略目录 | T012 |
| FR-026 | MAY | `buildDependencyGraph()` — 初始版本不实现 | T008（不实现） |
| FR-027 | MUST | 零回归：现有 TS/JS 测试 100% 通过 | T022 |
| FR-028 | MUST | 无新增运行时依赖 | T024 |

**覆盖率**: 28/28 FR = 100%

---

## 依赖与并行说明

### Phase 依赖关系

```
Phase 1 (Setup/Fixtures) ─── 无依赖，立即开始
       │
       ▼
Phase 2 (US1: 核心实现) ─── 依赖 Phase 1 的 fixture 文件
       │
       ├── Phase 3 (US2: import) ─── 依赖 T008（适配器已实现）
       ├── Phase 5 (US4: 降级)  ─── 依赖 T008
       ├── Phase 6 (US5: 术语)  ─── 依赖 T008
       ├── Phase 7 (US6: 测试模式) ── 依赖 T008
       └── Phase 8 (US7: 忽略目录) ── 依赖 T008
       │
       ▼
Phase 4 (US3: 注册集成) ─── 依赖 T008（适配器文件存在）
       │
       ▼
Phase 9 (Polish) ─── 依赖所有 Phase 完成
```

### User Story 间依赖

- **US1 (spec 生成)**: 独立，核心实现
- **US2 (import 依赖)**: 依赖 US1 的 `analyzeFile()` 实现，但测试可并行编写
- **US3 (自动路由)**: 依赖 US1 的适配器文件存在，需修改 `index.ts`
- **US4-US7**: 均依赖 US1 的适配器实现，但测试编写可与 US1 实现并行

### 并行机会

- **T001-T005**: 5 个 fixture 文件完全独立，可并行创建
- **T006, T007**: 测试编写可与 fixture 创建并行（同一文件不同 describe 块）
- **T010, T015, T017, T019**: US2/US4/US5/US6 的测试编写可在 T008 实现前并行编写（先写测试、确认失败）
- **Phase 3-8**: T008 完成后，US2-US7 的验证步骤可并行执行

### 推荐实现策略: MVP First

1. **并行创建** T001-T005（fixture 文件）
2. **编写所有测试** T006, T007, T010, T012, T015, T017, T019（确认全部失败）
3. **实现核心** T008（`python-adapter.ts`）— 所有测试中的大部分将自动通过
4. **注册集成** T013（`index.ts` 修改）— Registry 测试通过
5. **验证通过** T009, T011, T014, T016, T018, T020
6. **零回归** T022-T025（Polish）

**MVP 范围**: US1 (Phase 2) + US3 (Phase 4) = Python 文件可分析 + 自动路由，即可交付基本的 Python 支持能力。

---

## 任务统计

| 指标 | 值 |
|------|-----|
| 总任务数 | 25 |
| 测试 test case 数 | 21 (>= 15, 满足 SC-006) |
| 覆盖 User Stories | 7 |
| 可并行任务占比 | 40% (T001-T007 可并行) |
| 新建源文件 | 1 (`src/adapters/python-adapter.ts`) |
| 修改源文件 | 1 (`src/adapters/index.ts`) |
| 新建测试文件 | 1 (`tests/adapters/python-adapter.test.ts`) |
| 新建 fixture 文件 | 5 (`tests/fixtures/python/*.py`) |
