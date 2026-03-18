---
feature: 029-go-language-adapter
title: Go LanguageAdapter 实现
status: Draft
created: 2026-03-17
blueprint: 024-multilang-blueprint
research_mode: story
---

# Feature Specification: Go LanguageAdapter 实现

**Feature Branch**: `029-go-language-adapter`
**Created**: 2026-03-17
**Status**: Draft
**Blueprint**: 024-multilang-blueprint (Feature 5 - P1)
**Dependencies**: Feature 025（LanguageAdapter 接口）-- 已完成；Feature 027（tree-sitter 多语言后端 + GoMapper）-- 已完成
**Input**: 实现 GoLanguageAdapter 类（实现 LanguageAdapter 接口），为 reverse-spec 工具提供 Go 语言的完整支持。

[无调研基础] 本规范基于 Blueprint 024 的需求定义和已有代码上下文直接生成。

---

## 概述与动机

### 现状

Feature 025 建立了 LanguageAdapter 抽象层和 LanguageAdapterRegistry，Feature 027 引入了 web-tree-sitter 多语言解析后端，并已完成 GoMapper（`query-mappers/go-mapper.ts`）。GoMapper 已实现完整的 Go AST 解析能力——能够从 Go 源文件中提取函数声明、方法声明（含 receiver）、struct 定义（含字段）、interface 定义（含方法签名）、type alias、const/var 声明以及 import 语句，并正确处理 Go 特有的首字母大小写可见性规则。

然而，目前这些能力尚未被整合为一个完整的 LanguageAdapter 实例。`bootstrapAdapters()` 中预留的 `GoLanguageAdapter` 注册点仍被注释。用户无法对 Go 项目运行 `reverse-spec generate` 或 `reverse-spec batch`。

### 动机

1. **延续多语言扩展路线**: Go 是 Blueprint 024 规划的第二种新语言（P1 优先级），在 PythonLanguageAdapter（Feature 028）成功验证架构可扩展性后，Go 适配器进一步巩固 LanguageAdapter 模式的通用性。
2. **交付用户价值**: Go 是云原生和基础设施领域的主流语言，支持 Go 将覆盖大量基础设施项目的代码分析需求。
3. **复用已有基础设施**: GoMapper 和 TreeSitterAnalyzer 已提供完整的 Go 解析能力，GoLanguageAdapter 主要是一个"胶水层"——委托已有模块完成实际工作。实现模式与 PythonLanguageAdapter 完全对称。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Go 项目的 spec 生成 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望对一个标准 Go 项目运行 `reverse-spec generate`，能够生成完整的功能规范文档，包含准确的函数签名、struct 结构、interface 定义、method receiver 信息。

**Why this priority**: 这是 GoLanguageAdapter 的核心用户价值。如果无法对 Go 项目生成有效的 spec，则整个 Feature 失去意义。

**Independent Test**: 对一个包含函数声明、struct 定义、interface 定义、method（含 receiver）、const/var 声明的标准 Go 项目运行 `reverse-spec generate`，验证生成的 spec 包含所有导出符号的结构信息。

**Acceptance Scenarios**:

1. **Given** 一个包含 `func`、`type struct`、`type interface`、`const`、`var` 的标准 Go 文件，**When** 运行 `reverse-spec generate <target.go>`，**Then** 生成的 spec 包含所有首字母大写（导出）符号的签名信息，且不包含首字母小写的未导出符号。
2. **Given** 一个包含 method receiver（如 `func (s *Server) Start() error`）的 Go 文件，**When** 生成 spec，**Then** method 被正确关联到对应的 struct，方法签名中包含 receiver 信息。
3. **Given** 一个定义了 interface（如 `type Greeter interface { Greet(name string) string }`）的 Go 文件，**When** 生成 spec，**Then** interface 的方法签名被完整提取。
4. **Given** 一个包含多返回值函数（如 `func Process(data []byte) ([]byte, error)`）的 Go 文件，**When** 生成 spec，**Then** 函数签名中包含完整的参数列表和多返回值类型。

---

### User Story 2 - Go 项目的 import 依赖识别 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望生成的 spec 能准确反映 Go 文件的 import 依赖关系，包括标准库导入和第三方包导入。

**Why this priority**: import 依赖是理解项目架构的关键信息。准确的依赖识别使 spec 能够呈现包间的关联关系。

**Independent Test**: 对包含多种 import 形式（单行 `import "fmt"`、分组 `import ( "os"; "net/http" )`）的 Go 文件进行分析，验证每种 import 形式被正确解析。

**Acceptance Scenarios**:

1. **Given** 一个包含 `import "fmt"` 单行导入的 Go 文件，**When** 分析其 import 依赖，**Then** `moduleSpecifier` 为 `fmt`，`isRelative` 为 `false`。
2. **Given** 一个包含分组导入 `import ( "os"; "net/http" )` 的 Go 文件，**When** 分析其 import 依赖，**Then** 每个包被识别为独立的 ImportReference。
3. **Given** 一个包含别名导入 `import alias "some/package"` 的 Go 文件，**When** 分析其 import 依赖，**Then** `moduleSpecifier` 为 `some/package`。

---

### User Story 3 - Go 文件自动路由到正确适配器 (Priority: P1)

作为一个 **reverse-spec 用户**，在一个混合语言项目中运行 reverse-spec 时，我希望 `.go` 文件能够自动被路由到 GoLanguageAdapter 进行分析，而 `.ts` 和 `.py` 文件仍由各自的适配器处理。

**Why this priority**: 自动路由是 LanguageAdapter 架构的核心承诺之一。

**Independent Test**: 在一个包含 `.ts`、`.py` 和 `.go` 文件的项目中运行 `reverse-spec batch`，验证三种文件分别被正确的适配器处理。

**Acceptance Scenarios**:

1. **Given** LanguageAdapterRegistry 中已注册 TsJsLanguageAdapter、PythonLanguageAdapter 和 GoLanguageAdapter，**When** 调用 `registry.getAdapter('example.go')`，**Then** 返回 GoLanguageAdapter 实例。
2. **Given** 一个混合语言项目，**When** file-scanner 扫描目录，**Then** `.go` 文件出现在扫描结果中，且 `vendor` 目录被自动忽略。

---

### User Story 4 - Go 解析降级的容错处理 (Priority: P2)

作为一个 **reverse-spec 用户**，当 tree-sitter 解析 Go 文件失败时（如 WASM grammar 加载异常），我希望系统能降级到正则提取模式，仍然提供基本的代码结构信息，而非整体失败。

**Why this priority**: 降级容错是生产级工具的基本要求。

**Independent Test**: 模拟 TreeSitterAnalyzer 解析失败的场景，验证 `analyzeFallback()` 方法能通过正则提取返回基本的 CodeSkeleton。

**Acceptance Scenarios**:

1. **Given** tree-sitter 解析正常时，**When** 对 Go 文件调用 `analyzeFile()`，**Then** 返回的 CodeSkeleton 的 `parserUsed` 为 `'tree-sitter'`，包含完整的导出符号和 import 信息。
2. **Given** tree-sitter 解析失败，**When** 对 Go 文件调用 `analyzeFallback()`，**Then** 系统降级到正则提取，返回的 CodeSkeleton 至少包含通过正则匹配到的 `func`、`type`、`import` 信息。

---

### User Story 5 - Go 特有术语在 LLM prompt 中的参数化 (Priority: P2)

作为一个 **reverse-spec 用户**，我希望生成 Go 项目 spec 时，LLM prompt 中使用 Go 社区的惯用术语（如"导出标识符（首字母大写）"而非"export"、"隐式接口实现"而非"implements"），使生成的文档对 Go 开发者更自然可读。

**Why this priority**: 术语参数化使 LLM 生成符合 Go 社区习惯的文档。

**Independent Test**: 调用 GoLanguageAdapter 的 `getTerminology()` 方法，验证返回的术语映射包含 Go 特有的概念描述。

**Acceptance Scenarios**:

1. **Given** GoLanguageAdapter 已注册，**When** 调用 `getTerminology()`，**Then** `codeBlockLanguage` 为 `'go'`，`exportConcept` 描述首字母大写的导出规则，`interfaceConcept` 描述 Go 的隐式接口实现。
2. **Given** GoLanguageAdapter 已注册，**When** 调用 `getTerminology()`，**Then** `typeSystemDescription` 描述 Go 的静态强类型系统，`moduleSystem` 描述 Go modules 机制。

---

### User Story 6 - Go 测试文件的正确识别 (Priority: P2)

作为一个 **reverse-spec 用户**，我希望系统在分析 Go 项目时，能正确识别测试文件（`*_test.go`）并按预期处理（如 noise-filter 中降低测试文件权重）。

**Why this priority**: 测试文件识别影响 spec 生成的质量——测试代码不应与生产代码以同等权重出现在架构概览中。

**Independent Test**: 调用 GoLanguageAdapter 的 `getTestPatterns()` 方法，验证返回的匹配模式能正确区分测试文件和生产代码。

**Acceptance Scenarios**:

1. **Given** GoLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `filePattern` 正则能匹配 `server_test.go`、`main_test.go`。
2. **Given** GoLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `filePattern` 不匹配 `server.go`、`main.go`。
3. **Given** GoLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `testDirs` 为空数组——Go 测试文件与源文件共存于同一目录，不使用独立测试目录。

---

### User Story 7 - Go 生态特有目录的自动忽略 (Priority: P3)

作为一个 **reverse-spec 用户**，我希望在分析 Go 项目时，`vendor` 目录被自动排除在扫描范围外，无需手动配置。

**Why this priority**: `vendor` 目录包含第三方依赖代码副本，不是用户编写的源代码，扫描它只会增加噪音和处理时间。

**Independent Test**: 检查 GoLanguageAdapter 的 `defaultIgnoreDirs` 属性，验证包含 Go 生态的 `vendor` 目录。

**Acceptance Scenarios**:

1. **Given** GoLanguageAdapter 已注册，**When** 查看 `defaultIgnoreDirs`，**Then** 包含 `vendor`。
2. **Given** GoLanguageAdapter 已注册到 Registry，**When** 调用 `registry.getDefaultIgnoreDirs()`，**Then** 返回结果中包含 Go、Python 和 TS/JS 三种适配器的忽略目录合集。

---

### Edge Cases

- **`package main` 与 `func main()`**: `func main()` 首字母小写，属于未导出符号，默认不出现在导出列表中。当 `includePrivate: true` 时应包含。这是 Go 的设计哲学，属于预期行为。
- **空 Go 文件（仅含 package 声明）**: 如 `package empty`，应返回空的导出列表和 import 列表，不抛出异常。
- **Go 语法错误**: 当 Go 文件包含语法错误时（如未闭合括号），tree-sitter 应尽可能提取有效节点，将错误记录到 `parseErrors`。
- **嵌入 struct（embedded struct）**: 当 struct 中嵌入其他类型（如 `type Server struct { http.Handler }`）时，嵌入字段的提取可能不完整，属于已知限制。[AUTO-RESOLVED: 初始版本仅提取命名字段，嵌入字段后续版本可扩展]
- **init() 函数**: Go 的 `init()` 函数首字母小写但有特殊语义，默认不导出。用户如需查看可通过 `includePrivate: true` 选项。属于预期行为。
- **多文件 package**: Go 的一个 package 可由多个 `.go` 文件组成。当前逐文件分析模式下，每个文件独立产出 CodeSkeleton。跨文件 package 聚合不在本 Feature 范围内。[AUTO-RESOLVED: 逐文件分析是 reverse-spec 的统一模式，与 TS/JS 和 Python 行为一致]
- **Go generate 指令（`//go:generate`）**: 注释中的 Go generate 指令不属于代码结构，不在解析范围内。
- **cgo 代码（`import "C"`）**: cgo 导入 `import "C"` 会被识别为一个 import 条目，但 C 代码块不会被 Go grammar 解析。这是已知限制。
- **vendor 目录中的 `.go` 文件**: `vendor` 目录被 `defaultIgnoreDirs` 排除，其中的 `.go` 文件不会被扫描。
- **无扩展名的 Go 二进制文件**: 编译后的 Go 二进制文件没有 `.go` 扩展名，不会被 LanguageAdapterRegistry 路由到 GoLanguageAdapter。属于预期行为。

---

## Requirements *(mandatory)*

### Functional Requirements

#### GoLanguageAdapter 核心

- **FR-001**: 系统 MUST 提供 `GoLanguageAdapter` 类，实现 `LanguageAdapter` 接口的全部必要方法（`analyzeFile`、`analyzeFallback`、`getTerminology`、`getTestPatterns`）以及全部必要属性（`id`、`languages`、`extensions`、`defaultIgnoreDirs`）。
  - *关联: US-1, US-3*
- **FR-002**: `GoLanguageAdapter` 的 `id` 属性 MUST 为 `'go'`。
  - *关联: US-3*
- **FR-003**: `GoLanguageAdapter` 的 `languages` 属性 MUST 声明支持 `['go']` 语言。
  - *关联: US-3*
- **FR-004**: `GoLanguageAdapter` 的 `extensions` 属性 MUST 声明支持 `.go` 文件扩展名。
  - *关联: US-3*

#### 文件分析（analyzeFile）

- **FR-005**: `GoLanguageAdapter.analyzeFile()` MUST 委托 `TreeSitterAnalyzer.analyze(filePath, 'go')` 完成 AST 解析，返回有效的 `CodeSkeleton`。
  - *关联: US-1*
- **FR-006**: `analyzeFile()` 返回的 `CodeSkeleton` 的 `language` 字段 MUST 为 `'go'`，`parserUsed` 字段 MUST 为 `'tree-sitter'`。
  - *关联: US-1*
- **FR-007**: `analyzeFile()` MUST 正确提取 Go 文件中的所有导出函数声明（首字母大写的 `func`），包括函数名、参数列表和返回值类型（含多返回值）。
  - *关联: US-1 Scenario 1, 4*
- **FR-008**: `analyzeFile()` MUST 正确提取 Go 文件中的所有导出 struct 定义，包括 struct 名、导出字段和字段类型。
  - *关联: US-1 Scenario 1*
- **FR-009**: `analyzeFile()` MUST 正确提取 Go 文件中的所有导出 interface 定义，包括 interface 名和方法签名。
  - *关联: US-1 Scenario 3*
- **FR-010**: `analyzeFile()` MUST 将 method receiver（如 `func (s *Server) Start() error`）正确关联到对应的 struct，作为该 struct 的 `members` 成员。
  - *关联: US-1 Scenario 2*
- **FR-011**: `analyzeFile()` MUST 正确实现 Go 的可见性规则——默认仅导出首字母大写的标识符；当 `options.includePrivate` 为 `true` 时，应包含首字母小写的未导出符号。
  - *关联: US-1 Scenario 1*
- **FR-012**: `analyzeFile()` MUST 正确提取 Go 文件中的导出 const 和 var 声明。
  - *关联: US-1 Scenario 1*

#### import 依赖分析

- **FR-013**: `analyzeFile()` MUST 正确解析 Go 单行导入 `import "fmt"` 形式，识别包路径并标记 `isRelative: false`。
  - *关联: US-2 Scenario 1*
- **FR-014**: `analyzeFile()` MUST 正确解析 Go 分组导入 `import ( "os"; "net/http" )` 形式，将每个包识别为独立的 ImportReference。
  - *关联: US-2 Scenario 2*
- **FR-015**: `analyzeFile()` MUST 正确处理带别名的导入（`import alias "some/package"`），提取实际包路径作为 `moduleSpecifier`。
  - *关联: US-2 Scenario 3*
- **FR-016**: `analyzeFile()` MUST 将所有 Go import 的 `isTypeOnly` 标记为 `false`——Go 没有 type-only import 的概念。
  - *关联: US-2*

#### 正则降级（analyzeFallback）

- **FR-017**: `GoLanguageAdapter.analyzeFallback()` MUST 提供降级分析能力。优先尝试 tree-sitter AST 解析；当 tree-sitter 不可用时，降级到正则提取。
  - *关联: US-4*
- **FR-018**: `tree-sitter-fallback.ts` MUST 新增 Go 语言的正则降级支持，至少能识别以下 Go 语法模式：`func <Name>(`、`type <Name> struct`、`type <Name> interface`、`import "path"`。仅提取首字母大写的导出符号。
  - *关联: US-4 Scenario 2*

#### 术语映射（getTerminology）

- **FR-019**: `GoLanguageAdapter.getTerminology()` MUST 返回 Go 特有的 `LanguageTerminology` 对象，其中：
  - `codeBlockLanguage` 为 `'go'`
  - `exportConcept` 描述 Go 的首字母大写导出规则（"导出标识符——首字母大写即为公开"）
  - `importConcept` 描述 Go 的 `import` 机制（包路径导入）
  - `typeSystemDescription` 描述 Go 的静态强类型系统
  - `interfaceConcept` 描述 Go 的隐式接口实现（"interface 隐式实现——任何实现了 interface 方法集的类型自动满足该接口"）
  - `moduleSystem` 描述 Go modules 系统
  - *关联: US-5*

#### 测试文件模式（getTestPatterns）

- **FR-020**: `GoLanguageAdapter.getTestPatterns()` MUST 返回 Go 标准的测试文件匹配模式：
  - `filePattern` 正则 MUST 匹配 `*_test.go` 命名约定
  - `testDirs` MUST 为空数组——Go 测试文件与源文件共存于同一目录
  - *关联: US-6*

#### 默认忽略目录

- **FR-021**: `GoLanguageAdapter.defaultIgnoreDirs` MUST 包含 `vendor` 目录。
  - *关联: US-7*

#### 注册与集成

- **FR-022**: `GoLanguageAdapter` MUST 在 `bootstrapAdapters()` 函数中被注册到 `LanguageAdapterRegistry`，使 `.go` 文件能通过 Registry 自动路由到该适配器。
  - *关联: US-3*
- **FR-023**: 注册 `GoLanguageAdapter` MUST NOT 与 `TsJsLanguageAdapter` 或 `PythonLanguageAdapter` 产生扩展名冲突——Go 的 `.go` 扩展名与其他语言无重叠。
  - *关联: US-3*
- **FR-024**: 注册 `GoLanguageAdapter` 后，`file-scanner` MUST 能自动扫描到 `.go` 文件，且 `vendor` 目录被自动排除。
  - *关联: US-3 Scenario 2, US-7*

#### 依赖图构建（可选能力）

- **FR-025**: `GoLanguageAdapter` MAY 实现 `buildDependencyGraph()` 方法，后续版本可调用 `go list -json` 构建依赖图。初始版本可不实现此方法。
  - *关联: US-2*

#### 零回归约束

- **FR-026**: 注册 `GoLanguageAdapter` MUST NOT 影响现有 TS/JS 和 Python 文件的分析行为——对任何纯 TS/JS 或 Python 项目运行 reverse-spec 的任意命令，其输出与注册前完全一致。
  - *关联: 全局约束*
- **FR-027**: 本 Feature MUST NOT 引入任何新的运行时依赖——GoLanguageAdapter 仅使用 Feature 025/027 已引入的基础设施。
  - *关联: 全局约束*

### Key Entities

- **GoLanguageAdapter**: Go 语言适配器。实现 LanguageAdapter 接口，作为 reverse-spec 对 Go 源文件进行代码分析的入口。通过委托 TreeSitterAnalyzer（主解析）和正则表达式（降级）完成文件分析，并提供 Go 特有的术语映射、测试文件模式和忽略目录配置。注册到 LanguageAdapterRegistry 后，`.go` 文件自动路由到此适配器。
- **GoMapper**（已有）: Go 的 tree-sitter AST 到 CodeSkeleton 映射器。从 AST 中提取函数声明、方法声明（含 receiver）、struct 定义、interface 定义、type alias、const/var 声明和 import 语句，并正确处理首字母大小写可见性规则。已在 Feature 027 中实现，GoLanguageAdapter 通过 TreeSitterAnalyzer 间接使用。
- **TreeSitterAnalyzer**（已有）: 多语言 tree-sitter 解析入口。已支持 Go AST 解析（包含 GoMapper 注册和 Go grammar 加载）。GoLanguageAdapter 的 `analyzeFile()` 委托此组件完成实际解析。
- **LanguageAdapterRegistry**（已有）: 适配器注册中心。GoLanguageAdapter 通过 `bootstrapAdapters()` 注册到此 Registry，使流水线各环节能按文件扩展名路由到正确的适配器。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对一个标准 Go 项目（包含至少 5 个 `.go` 文件、涵盖函数/struct/interface/method/const/var/import）运行 `reverse-spec generate`，成功生成完整 spec，不报错。
- **SC-002**: Go 的首字母大小写可见性规则被正确实现——首字母大写的标识符出现在导出列表中，首字母小写的不出现（`includePrivate: false` 时）。
- **SC-003**: Method receiver 正确关联到对应 struct——`func (s *Server) Start()` 出现在 `Server` struct 的 `members` 中。
- **SC-004**: 现有全部测试套件在 Feature 完成后 100% 通过——注册 GoLanguageAdapter 不引入任何现有功能的回归。
- **SC-005**: 新增 GoLanguageAdapter 仅需一个新源文件（适配器实现）+ 修改 `bootstrapAdapters()` 注册代码 + `tree-sitter-fallback.ts` 新增 Go 正则降级——不需修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts` 或任何核心流水线文件。
- **SC-006**: GoLanguageAdapter 的单元测试覆盖所有 Functional Requirements 中 MUST 级别的需求，测试数量不少于 15 个。
- **SC-007**: `getTestPatterns().filePattern` 对 `server_test.go`、`main_test.go` 返回匹配，对 `server.go`、`main.go` 返回不匹配——测试文件识别准确率 100%。
