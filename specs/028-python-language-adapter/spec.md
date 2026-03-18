---
feature: 028-python-language-adapter
title: Python LanguageAdapter 实现
status: Draft
created: 2026-03-17
blueprint: 024-multilang-blueprint
research_mode: story
---

# Feature Specification: Python LanguageAdapter 实现

**Feature Branch**: `028-python-language-adapter`
**Created**: 2026-03-17
**Status**: Draft
**Blueprint**: 024-multilang-blueprint (Feature 4 - P0)
**Dependencies**: Feature 025（LanguageAdapter 接口）— 已完成；Feature 027（tree-sitter 多语言后端 + PythonMapper）— 已完成
**Input**: 实现 PythonLanguageAdapter 类（实现 LanguageAdapter 接口），为 reverse-spec 工具提供 Python 语言的完整支持。作为第一种非 JS/TS 语言适配器，同时验证 LanguageAdapter 架构的可扩展性。

[无调研基础] 本规范基于 Blueprint 024 的需求定义和已有代码上下文直接生成。

---

## 概述与动机

### 现状

Feature 025 建立了 LanguageAdapter 抽象层和 LanguageAdapterRegistry，Feature 027 引入了 web-tree-sitter 多语言解析后端，并已完成 PythonMapper（query-mappers/python-mapper.ts）。这些基础设施已具备完整的 Python AST 解析能力——能够从 Python 源文件中提取函数定义、类定义、import 语句、装饰器、类型注解和 `__all__` 列表。

然而，目前这些能力尚未被整合为一个完整的 LanguageAdapter 实例。`bootstrapAdapters()` 中预留的 `PythonLanguageAdapter` 注册点仍被注释。用户无法对 Python 项目运行 `reverse-spec generate` 或 `reverse-spec batch`。

### 动机

1. **验证架构可扩展性**: Python 是 Blueprint 024 规划的第一种新语言（P0 优先级），成功实现将证明 LanguageAdapter 抽象层的设计是可行的——新增语言仅需实现接口并注册，无需修改核心流水线。
2. **交付用户价值**: Python 是全球使用最广泛的编程语言之一，支持 Python 将显著扩大 reverse-spec 的用户群。
3. **复用已有基础设施**: PythonMapper 和 TreeSitterAnalyzer 已提供完整的 Python 解析能力，PythonLanguageAdapter 主要是一个"胶水层"——委托已有模块完成实际工作。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Python 项目的 spec 生成 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望对一个标准 Python 项目运行 `reverse-spec generate`，能够生成完整的功能规范文档，包含准确的函数签名、类结构、模块依赖信息。

**Why this priority**: 这是 PythonLanguageAdapter 的核心用户价值。如果无法对 Python 项目生成有效的 spec，则整个 Feature 失去意义。作为第一种新语言，它同时验证了 LanguageAdapter 架构从接口定义到端到端产出的完整链路。

**Independent Test**: 对一个包含函数定义、类定义、import 语句、类型注解、装饰器的标准 Python 项目运行 `reverse-spec generate`，验证生成的 spec 包含所有公开符号的结构信息。

**Acceptance Scenarios**:

1. **Given** 一个包含 `def`、`class`、`import`、`from...import`、类型注解的标准 Python 项目，**When** 运行 `reverse-spec generate <target.py>`，**Then** 生成的 spec 包含所有公开函数和类的签名信息，且不包含以 `_` 开头的私有符号。
2. **Given** 一个包含 `@staticmethod`、`@classmethod`、`@property` 装饰器的 Python 类，**When** 生成 spec，**Then** 类的成员方法被正确分类为 staticmethod、classmethod、getter 等类型。
3. **Given** 一个定义了 `__all__` 列表的 Python 模块，**When** 生成 spec，**Then** 仅 `__all__` 中列出的名称出现在导出符号中。
4. **Given** 一个包含 `async def` 异步函数的 Python 文件，**When** 生成 spec，**Then** 函数签名中包含 `async` 前缀。

---

### User Story 2 - Python 项目的 import 依赖识别 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望生成的 spec 能准确反映 Python 模块之间的 import 依赖关系，包括标准库导入、第三方包导入和项目内相对导入。

**Why this priority**: import 依赖是理解项目架构的关键信息。准确的依赖识别使 spec 能够呈现模块间的关联关系，这对代码审查和架构分析至关重要。

**Independent Test**: 对包含多种 import 形式（`import os`、`from os.path import join`、`from . import utils`、`from ..models import User`）的 Python 文件进行分析，验证每种 import 形式被正确解析。

**Acceptance Scenarios**:

1. **Given** 一个包含 `import os` 和 `import os, sys` 的 Python 文件，**When** 分析其 import 依赖，**Then** 每个模块被识别为独立的 ImportReference，`isRelative` 为 `false`。
2. **Given** 一个包含 `from os.path import join, exists` 的 Python 文件，**When** 分析其 import 依赖，**Then** `moduleSpecifier` 为 `os.path`，`namedImports` 包含 `join` 和 `exists`。
3. **Given** 一个包含 `from . import utils` 或 `from ..models import User` 的 Python 文件，**When** 分析其 import 依赖，**Then** `isRelative` 为 `true`，`moduleSpecifier` 包含相对路径前缀（`.` 或 `..`）。
4. **Given** 一个包含 `from module import *` 的 Python 文件，**When** 分析其 import 依赖，**Then** `namedImports` 包含 `*` 通配标记。

---

### User Story 3 - Python 文件自动路由到正确适配器 (Priority: P1)

作为一个 **reverse-spec 用户**，在一个混合语言项目（如同时包含 TypeScript 和 Python 文件）中运行 reverse-spec 时，我希望 `.py` 和 `.pyi` 文件能够自动被路由到 PythonLanguageAdapter 进行分析，而 `.ts` 文件仍由 TsJsLanguageAdapter 处理。

**Why this priority**: 自动路由是 LanguageAdapter 架构的核心承诺之一。如果用户需要手动指定语言，则适配器注册机制形同虚设。

**Independent Test**: 在一个包含 `.ts` 和 `.py` 文件的项目中运行 `reverse-spec batch`，验证两种文件分别被正确的适配器处理。

**Acceptance Scenarios**:

1. **Given** LanguageAdapterRegistry 中已注册 TsJsLanguageAdapter 和 PythonLanguageAdapter，**When** 调用 `registry.getAdapter('example.py')`，**Then** 返回 PythonLanguageAdapter 实例。
2. **Given** LanguageAdapterRegistry 中已注册 PythonLanguageAdapter，**When** 调用 `registry.getAdapter('example.pyi')`，**Then** 返回 PythonLanguageAdapter 实例（`.pyi` stub 文件同样被支持）。
3. **Given** 一个混合语言项目，**When** file-scanner 扫描目录，**Then** `.py` 和 `.pyi` 文件出现在扫描结果中，且 `__pycache__`、`.venv`、`venv` 等 Python 特有目录被自动忽略。

---

### User Story 4 - Python 解析降级的容错处理 (Priority: P2)

作为一个 **reverse-spec 用户**，当 tree-sitter 解析 Python 文件失败时（如 WASM grammar 加载异常），我希望系统能降级到正则提取模式，仍然提供基本的代码结构信息，而非整体失败。

**Why this priority**: 降级容错是生产级工具的基本要求。虽然 tree-sitter 在绝大多数场景下稳定可靠，但用户环境的多样性要求系统具备兜底能力。

**Independent Test**: 模拟 TreeSitterAnalyzer 解析失败的场景，验证 `analyzeFallback()` 方法能通过正则提取返回基本的 CodeSkeleton。

**Acceptance Scenarios**:

1. **Given** tree-sitter 解析正常时，**When** 对 Python 文件调用 `analyzeFile()`，**Then** 返回的 CodeSkeleton 的 `parserUsed` 为 `'tree-sitter'`，包含完整的导出符号和 import 信息。
2. **Given** tree-sitter 解析失败（如 WASM 加载错误），**When** 对 Python 文件调用 `analyzeFallback()`，**Then** 系统降级到正则提取，返回的 CodeSkeleton 至少包含通过正则匹配到的 `def`、`class`、`import` 信息。

---

### User Story 5 - Python 特有术语在 LLM prompt 中的参数化 (Priority: P2)

作为一个 **reverse-spec 用户**，我希望生成 Python 项目 spec 时，LLM prompt 中使用 Python 社区的惯用术语（如"公开符号"而非"导出"、"Protocol/ABC"而非"接口"），使生成的文档对 Python 开发者更自然可读。

**Why this priority**: 术语参数化是 Feature 026 建立的能力，PythonLanguageAdapter 需要提供 Python 特有的术语映射才能让 LLM 生成符合 Python 社区习惯的文档。

**Independent Test**: 调用 PythonLanguageAdapter 的 `getTerminology()` 方法，验证返回的术语映射包含 Python 特有的概念描述。

**Acceptance Scenarios**:

1. **Given** PythonLanguageAdapter 已注册，**When** 调用 `getTerminology()`，**Then** `codeBlockLanguage` 为 `'python'`，`exportConcept` 描述 Python 的公开符号概念，`interfaceConcept` 包含 Protocol/ABC 的描述。
2. **Given** PythonLanguageAdapter 已注册，**When** 调用 `getTerminology()`，**Then** `typeSystemDescription` 描述 Python 的可选类型注解系统，`moduleSystem` 描述 Python 的 import/package 机制。

---

### User Story 6 - Python 测试文件的正确识别 (Priority: P2)

作为一个 **reverse-spec 用户**，我希望系统在分析 Python 项目时，能正确识别测试文件（`test_*.py`、`*_test.py`、`conftest.py`）并按预期处理（如 noise-filter 中降低测试文件权重）。

**Why this priority**: 测试文件识别影响 spec 生成的质量——测试代码不应与生产代码以同等权重出现在架构概览中。

**Independent Test**: 调用 PythonLanguageAdapter 的 `getTestPatterns()` 方法，验证返回的匹配模式能正确区分测试文件和生产代码。

**Acceptance Scenarios**:

1. **Given** PythonLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `filePattern` 正则能匹配 `test_example.py`、`example_test.py`、`conftest.py`。
2. **Given** PythonLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `testDirs` 包含 Python 社区常见的测试目录名（`tests`、`test`、`__tests__`）。
3. **Given** 调用 `getTestPatterns().filePattern`，**When** 测试 `main.py`，**Then** 不匹配（非测试文件不被误判）。

---

### User Story 7 - Python 生态特有目录的自动忽略 (Priority: P3)

作为一个 **reverse-spec 用户**，我希望在分析 Python 项目时，`__pycache__`、`.venv`、`venv`、`.tox`、`.mypy_cache` 等 Python 生态的临时/缓存目录被自动排除在扫描范围外，无需手动配置。

**Why this priority**: 这些目录不包含用户编写的源代码，扫描它们只会增加噪音和处理时间。自动忽略提升用户体验，但不影响核心功能。

**Independent Test**: 检查 PythonLanguageAdapter 的 `defaultIgnoreDirs` 属性，验证包含 Python 生态的常见忽略目录。

**Acceptance Scenarios**:

1. **Given** PythonLanguageAdapter 已注册，**When** 查看 `defaultIgnoreDirs`，**Then** 至少包含 `__pycache__`、`.venv`、`venv`、`.tox`、`.mypy_cache`。
2. **Given** PythonLanguageAdapter 已注册到 Registry，**When** 调用 `registry.getDefaultIgnoreDirs()`，**Then** 返回结果中包含 Python 和 TS/JS 两种适配器的忽略目录合集。

---

### Edge Cases

- **`__init__.py` re-export 处理**: 当 `__init__.py` 文件使用 `from .module import SomeClass` 形式进行 re-export 时，import 分析应正确识别这些相对导入。如果 `__init__.py` 同时定义了 `__all__`，则导出列表应以 `__all__` 为准。
- **空的 Python 文件**: 当 `.py` 文件内容为空（0 字节）时，应返回空的 CodeSkeleton（`exports: []`, `imports: []`），不抛出异常。
- **仅包含注释的 Python 文件**: 当 `.py` 文件仅包含注释（docstring 或 `#` 注释）而无可执行代码时，应返回空的导出列表。
- **Python 语法错误**: 当 Python 文件包含语法错误（如缩进错误、未闭合括号）时，tree-sitter 应尽可能提取有效节点，将错误记录到 `parseErrors`。
- **`.pyi` stub 文件**: `.pyi` 类型存根文件应与 `.py` 文件使用相同的解析逻辑和适配器实例。
- **动态 import（`importlib.import_module()`、`__import__()`）**: 动态 import 超出静态分析范围，不在 import 依赖识别中处理。不应因动态 import 的存在而导致分析失败。[AUTO-RESOLVED: Blueprint 024 已明确排除动态 import，仅支持静态 import 分析]
- **条件 import（`try...except ImportError`）**: 位于 `try` 块内的 import 语句可能不在文件顶层，当前 PythonMapper 仅分析顶层节点。这些 import 可能被遗漏，属于已知限制。[AUTO-RESOLVED: 初始版本仅分析顶层 import，后续版本可扩展支持非顶层 import]
- **Python 2 语法**: 当文件包含 Python 2 特有语法（如 `print` 语句、`except Exception, e`）时，tree-sitter 的 Python grammar 可能生成 ERROR 节点，应记录到 `parseErrors` 而非整体失败。
- **超大 Python 文件（>10000 行）**: 应能正常解析，性能可能下降但不应超时或内存溢出。
- **无扩展名的 Python 脚本**: 没有 `.py` 扩展名的 Python 脚本（如带 shebang 的可执行文件）不会被 LanguageAdapterRegistry 路由到 PythonLanguageAdapter——这是 Registry 基于扩展名的设计限制，属于预期行为。

---

## Requirements *(mandatory)*

### Functional Requirements

#### PythonLanguageAdapter 核心

- **FR-001**: 系统 MUST 提供 `PythonLanguageAdapter` 类，实现 `LanguageAdapter` 接口的全部必要方法（`analyzeFile`、`analyzeFallback`、`getTerminology`、`getTestPatterns`）以及全部必要属性（`id`、`languages`、`extensions`、`defaultIgnoreDirs`）。
  - *关联: US-1, US-3*
- **FR-002**: `PythonLanguageAdapter` 的 `id` 属性 MUST 为 `'python'`。
  - *关联: US-3*
- **FR-003**: `PythonLanguageAdapter` 的 `languages` 属性 MUST 声明支持 `['python']` 语言。
  - *关联: US-3*
- **FR-004**: `PythonLanguageAdapter` 的 `extensions` 属性 MUST 声明支持 `.py` 和 `.pyi` 两种文件扩展名。
  - *关联: US-3, Edge Case `.pyi`*

#### 文件分析（analyzeFile）

- **FR-005**: `PythonLanguageAdapter.analyzeFile()` MUST 委托 `TreeSitterAnalyzer.analyze(filePath, 'python')` 完成 AST 解析，返回通过 `CodeSkeletonSchema.parse()` 验证的有效 `CodeSkeleton`。
  - *关联: US-1*
- **FR-006**: `analyzeFile()` 返回的 `CodeSkeleton` 的 `language` 字段 MUST 为 `'python'`，`parserUsed` 字段 MUST 为 `'tree-sitter'`。
  - *关联: US-1*
- **FR-007**: `analyzeFile()` MUST 正确提取 Python 文件中的所有公开函数定义（`def` 和 `async def`），包括函数名、参数签名和返回类型注解。
  - *关联: US-1 Scenario 1, 4*
- **FR-008**: `analyzeFile()` MUST 正确提取 Python 文件中的所有公开类定义，包括类名、基类列表和成员方法。
  - *关联: US-1 Scenario 2*
- **FR-009**: `analyzeFile()` MUST 正确识别 Python 装饰器（`@staticmethod`、`@classmethod`、`@property`）并将类成员方法的 `kind` 标记为对应类型（`staticmethod`、`classmethod`、`getter`）。
  - *关联: US-1 Scenario 2*
- **FR-010**: `analyzeFile()` MUST 尊重 `__all__` 列表——当文件定义了 `__all__` 时，仅 `__all__` 中列出的名称出现在导出符号中。
  - *关联: US-1 Scenario 3*
- **FR-011**: `analyzeFile()` MUST 默认排除以 `_` 开头的私有符号；当 `options.includePrivate` 为 `true` 时，应包含私有符号。
  - *关联: US-1 Scenario 1*

#### import 依赖分析

- **FR-012**: `analyzeFile()` MUST 正确解析 `import <module>` 形式的导入，识别模块名并标记 `isRelative: false`。
  - *关联: US-2 Scenario 1*
- **FR-013**: `analyzeFile()` MUST 正确解析 `from <module> import <names>` 形式的导入，提取模块路径和命名导入列表。
  - *关联: US-2 Scenario 2*
- **FR-014**: `analyzeFile()` MUST 正确识别相对导入（`from . import`、`from .. import`、`from .module import`），将 `isRelative` 标记为 `true`。
  - *关联: US-2 Scenario 3*
- **FR-015**: `analyzeFile()` MUST 正确处理通配导入（`from module import *`），将 `namedImports` 标记为 `['*']`。
  - *关联: US-2 Scenario 4*
- **FR-016**: `analyzeFile()` MUST 将所有 Python import 的 `isTypeOnly` 标记为 `false`——Python 的类型导入在运行时仍有效（除 `TYPE_CHECKING` 守卫外，此为已知限制）。
  - *关联: US-2*

#### 正则降级（analyzeFallback）

- **FR-017**: `PythonLanguageAdapter.analyzeFallback()` MUST 提供基于正则表达式的降级分析能力，在 tree-sitter 不可用时仍能提取 Python 文件的基本结构（`import`、`def`、`class` 语句）。
  - *关联: US-4*
- **FR-018**: `analyzeFallback()` 的正则降级 SHOULD 至少能识别以下 Python 语法模式：`import <module>`、`from <module> import <names>`、`def <name>(`、`class <name>(`、`class <name>:`。
  - *关联: US-4 Scenario 2*

#### 术语映射（getTerminology）

- **FR-019**: `PythonLanguageAdapter.getTerminology()` MUST 返回 Python 特有的 `LanguageTerminology` 对象，其中：
  - `codeBlockLanguage` 为 `'python'`
  - `exportConcept` 描述 Python 的公开符号概念（非 `_` 前缀的模块级定义 + `__all__` 机制）
  - `importConcept` 描述 Python 的 `import` / `from...import` 机制
  - `typeSystemDescription` 描述 Python 的可选类型注解系统（PEP 484 type hints）
  - `interfaceConcept` 描述 Python 的 Protocol（PEP 544）和 ABC（Abstract Base Class）
  - `moduleSystem` 描述 Python 的 package/module 系统
  - *关联: US-5*

#### 测试文件模式（getTestPatterns）

- **FR-020**: `PythonLanguageAdapter.getTestPatterns()` MUST 返回 Python 社区标准的测试文件匹配模式：
  - `filePattern` 正则 MUST 匹配 `test_*.py`、`*_test.py`、`conftest.py` 三种命名约定
  - `testDirs` MUST 包含 `tests`、`test` 目录名
  - *关联: US-6*

#### 默认忽略目录

- **FR-021**: `PythonLanguageAdapter.defaultIgnoreDirs` MUST 包含以下 Python 生态特有的目录：`__pycache__`、`.venv`、`venv`、`.tox`、`.mypy_cache`。
  - *关联: US-7*
- **FR-022**: `PythonLanguageAdapter.defaultIgnoreDirs` SHOULD 额外包含 `.pytest_cache`、`.eggs`、`*.egg-info`（如适用于目录名匹配）。
  - *关联: US-7*

#### 注册与集成

- **FR-023**: `PythonLanguageAdapter` MUST 在 `bootstrapAdapters()` 函数中被注册到 `LanguageAdapterRegistry`，使 `.py` 和 `.pyi` 文件能通过 Registry 自动路由到该适配器。
  - *关联: US-3*
- **FR-024**: 注册 `PythonLanguageAdapter` MUST NOT 与 `TsJsLanguageAdapter` 产生扩展名冲突——Python 的 `.py`/`.pyi` 扩展名与 TS/JS 的 `.ts`/`.tsx`/`.js`/`.jsx` 扩展名无重叠。
  - *关联: US-3*
- **FR-025**: 注册 `PythonLanguageAdapter` 后，`file-scanner` MUST 能自动扫描到 `.py` 和 `.pyi` 文件，且 `__pycache__` 等 Python 忽略目录被自动排除。
  - *关联: US-3 Scenario 3, US-7*

#### 依赖图构建（可选能力）

- **FR-026**: `PythonLanguageAdapter` MAY 实现 `buildDependencyGraph()` 方法，基于静态 import 分析构建项目级 Python 模块依赖图。初始版本可不实现此方法。
  - *关联: US-2*

#### 零回归约束

- **FR-027**: 注册 `PythonLanguageAdapter` MUST NOT 影响现有 TS/JS 文件的分析行为——对任何纯 TS/JS 项目运行 reverse-spec 的任意命令，其输出与注册前完全一致。
  - *关联: 全局约束*
- **FR-028**: 本 Feature MUST NOT 引入任何新的运行时依赖——PythonLanguageAdapter 仅使用 Feature 025/027 已引入的基础设施。
  - *关联: 全局约束*

### Key Entities

- **PythonLanguageAdapter**: Python 语言适配器。实现 LanguageAdapter 接口，作为 reverse-spec 对 Python 源文件进行代码分析的入口。通过委托 TreeSitterAnalyzer（主解析）和正则表达式（降级）完成文件分析，并提供 Python 特有的术语映射、测试文件模式和忽略目录配置。注册到 LanguageAdapterRegistry 后，`.py` 和 `.pyi` 文件自动路由到此适配器。
- **PythonMapper**（已有）: Python 的 tree-sitter AST 到 CodeSkeleton 映射器。从 AST 中提取函数定义、类定义、import 语句、装饰器、`__all__` 列表等结构信息。已在 Feature 027 中实现，PythonLanguageAdapter 通过 TreeSitterAnalyzer 间接使用。
- **TreeSitterAnalyzer**（已有）: 多语言 tree-sitter 解析入口。已支持 Python AST 解析（包含 PythonMapper 注册和 Python grammar 加载）。PythonLanguageAdapter 的 `analyzeFile()` 委托此组件完成实际解析。
- **LanguageAdapterRegistry**（已有）: 适配器注册中心。PythonLanguageAdapter 通过 `bootstrapAdapters()` 注册到此 Registry，使流水线各环节能按文件扩展名路由到正确的适配器。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对一个标准 Python 项目（包含至少 5 个 `.py` 文件、涵盖函数/类/import/装饰器/类型注解）运行 `reverse-spec generate`，成功生成完整 spec，不报错。
- **SC-002**: Python 文件的 import 依赖图准确度达到 80% 以上（不含动态 import 和条件 import），以人工审核的标准 Python 项目为基准。
- **SC-003**: `__init__.py` 中通过 `from .module import X` 形式进行的 re-export 被正确识别为相对导入，re-export 的符号（如存在 `__all__`）被正确导出。
- **SC-004**: 现有全部测试套件在 Feature 完成后 100% 通过——注册 PythonLanguageAdapter 不引入任何现有功能的回归。
- **SC-005**: 新增 PythonLanguageAdapter 仅需一个新源文件（适配器实现）加上修改 `bootstrapAdapters()` 中的一行注册代码——不需修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts` 或任何核心流水线文件。
- **SC-006**: PythonLanguageAdapter 的单元测试覆盖所有 Functional Requirements 中 MUST 级别的需求，测试数量不少于 15 个。
- **SC-007**: `getTestPatterns().filePattern` 对 `test_example.py`、`example_test.py`、`conftest.py` 返回匹配，对 `main.py`、`utils.py` 返回不匹配——测试文件识别准确率 100%。
