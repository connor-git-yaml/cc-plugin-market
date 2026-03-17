---
feature: 027-multilang-tree-sitter-backend
title: 引入 tree-sitter 作为多语言解析后端
status: Draft
created: 2026-03-17
blueprint: 024-multilang-blueprint
research_mode: story
---

# Feature Specification: 引入 tree-sitter 作为多语言解析后端

**Feature Branch**: `027-multilang-tree-sitter-backend`
**Created**: 2026-03-17
**Status**: Draft
**Blueprint**: 024-multilang-blueprint (Feature 3)
**Dependencies**: Feature 025（LanguageAdapter 接口 + CodeSkeleton 扩展模型）— 已完成
**Input**: 引入 `web-tree-sitter`（WASM 版）作为统一的多语言 AST 解析后端，替换当前名不副实的正则降级 fallback。为 Python、Go、Java 编写 `.scm` 查询文件，建立 tree-sitter query 到 `CodeSkeleton` 的映射层。同时清理未使用的原生 `tree-sitter` + `tree-sitter-typescript` 依赖。TS/JS 主解析仍使用 ts-morph，tree-sitter 作为 TS/JS 降级解析器和非 JS/TS 语言的主解析器。

---

## 概述与动机

### 现状

当前代码库中存在一个严重的名实不符问题：`src/core/tree-sitter-fallback.ts` 文件名暗示使用了 tree-sitter 作为降级解析器，但实际上完全基于正则表达式，且仅支持 JS/TS 的 `export`/`import` 语法。同时，`package.json` 中声明了 `tree-sitter`（原生 C++ 绑定）和 `tree-sitter-typescript` 依赖，但源码中从未实际使用。

Feature 025 已建立 `LanguageAdapter` 抽象层和扩展的 `CodeSkeleton` 数据模型，为多语言支持奠定了架构基础。但目前缺乏一个真正的多语言 AST 解析引擎来驱动非 JS/TS 语言的代码分析。

### 动机

1. **解锁多语言解析能力**: `web-tree-sitter`（WASM 版）提供跨平台的统一 AST 解析，支持 300+ 种语言的 grammar。这是后续 Python、Go、Java 等语言适配器（Feature 028/029/030）的核心基础设施。
2. **清理技术债务**: 移除从未使用的原生 `tree-sitter` + `tree-sitter-typescript` 依赖，消除安装时的 C++ 编译问题。
3. **提升 TS/JS 降级质量**: 现有正则 fallback 准确性有限（无法处理嵌套作用域、装饰器等复杂语法），真正的 tree-sitter 解析可显著提升降级分析的质量。
4. **零安装摩擦**: WASM 版 grammar 随 npm 包分发，用户无需安装额外的本地工具链。

---

## User Stories

### User Story 1 - Python 项目的 AST 解析 (Priority: P0)

作为一个 **reverse-spec 开发者（后续 Feature 028 的实现者）**，我希望能通过 `TreeSitterAnalyzer` 解析 Python 源文件并获得结构化的 `CodeSkeleton`，以便在 `PythonLanguageAdapter` 中使用。

**Why this priority**: 这是本 Feature 的核心价值。如果 tree-sitter 无法正确解析 Python 并生成有效的 `CodeSkeleton`，则多语言扩展的整个链路断裂。

**Independent Test**: 对包含函数定义、类定义、import 语句、类型注解的标准 Python 文件调用 `TreeSitterAnalyzer.analyze()`，验证返回的 `CodeSkeleton` 通过 Zod schema 验证，且关键结构信息（函数名、类名、参数签名、import 路径）被正确提取。

**Acceptance Scenarios**:

1. **Given** 一个包含 `def`、`class`、`import`、`from...import` 语句的 Python 文件，**When** 调用 `TreeSitterAnalyzer.analyze(filePath, 'python')`，**Then** 返回的 `CodeSkeleton` 通过 `CodeSkeletonSchema.parse()` 验证，且 `language` 为 `'python'`，`parserUsed` 为 `'tree-sitter'`。
2. **Given** 一个包含类型注解（`def foo(x: int) -> str`）的 Python 文件，**When** 解析后检查对应 export 的 `signature` 字段，**Then** 签名包含参数类型和返回类型信息。
3. **Given** 一个包含 `@staticmethod`、`@classmethod`、`@property` 装饰器的 Python 类，**When** 解析后检查类的 `members`，**Then** 成员的 `kind` 正确标记为 `staticmethod`、`classmethod`、`getter`。

---

### User Story 2 - Go 项目的 AST 解析 (Priority: P0)

作为一个 **reverse-spec 开发者（后续 Feature 029 的实现者）**，我希望能通过 `TreeSitterAnalyzer` 解析 Go 源文件并获得结构化的 `CodeSkeleton`。

**Why this priority**: Go 是第二优先支持的语言，与 Python 并列为验证 tree-sitter 后端的关键场景。

**Independent Test**: 对包含 `func`、`struct`、`interface`、`type`、`import` 语句的标准 Go 文件调用分析，验证 `CodeSkeleton` 正确反映 Go 的导出规则（首字母大写 = public）。

**Acceptance Scenarios**:

1. **Given** 一个包含公开函数（`func Foo()`）和私有函数（`func bar()`）的 Go 文件，**When** 解析后检查 `exports`，**Then** 仅公开函数出现在 `exports` 中（或通过 `visibility` 区分）。
2. **Given** 一个包含 `struct` 定义和关联方法（method receiver）的 Go 文件，**When** 解析后检查 exports，**Then** struct 的 `kind` 为 `'struct'`，关联方法出现在 `members` 中。
3. **Given** 一个包含 `interface` 定义的 Go 文件，**When** 解析后检查 exports，**Then** interface 的 `kind` 为 `'interface'`，方法签名被正确提取。

---

### User Story 3 - Java 项目的 AST 解析 (Priority: P0)

作为一个 **reverse-spec 开发者（后续 Feature 030 的实现者）**，我希望能通过 `TreeSitterAnalyzer` 解析 Java 源文件并获得结构化的 `CodeSkeleton`。

**Why this priority**: Java 是企业环境中最常见的语言之一，是 reverse-spec 走向多语言通用工具的重要验证。

**Independent Test**: 对包含 `class`、`interface`、`enum`、`record`、`import` 语句的标准 Java 文件调用分析，验证 Java 特有的访问修饰符和泛型签名被正确处理。

**Acceptance Scenarios**:

1. **Given** 一个包含 `public class`、`private` 方法、`protected` 字段的 Java 文件，**When** 解析后检查 exports 和 members，**Then** `visibility` 字段正确反映 Java 访问修饰符。
2. **Given** 一个包含泛型类定义（`class Foo<T extends Bar>`）的 Java 文件，**When** 解析后检查 exports，**Then** `typeParameters` 和 `signature` 包含泛型信息。
3. **Given** 一个包含 `import` 语句的 Java 文件，**When** 解析后检查 `imports`，**Then** `moduleSpecifier` 包含完整包路径，`isRelative` 为 `false`。

---

### User Story 4 - TS/JS 降级解析质量提升 (Priority: P1)

作为一个 **现有 reverse-spec 用户**，当 ts-morph 解析失败时，我希望降级解析器能提供比正则更准确的代码结构信息，减少 `[SYNTAX ERROR]` 标记的出现。

**Why this priority**: 提升现有功能质量，但不是核心阻塞项。即使降级质量不变，也不影响多语言扩展的推进。

**Independent Test**: 对一个包含复杂 TypeScript 语法（如嵌套泛型、装饰器、条件类型）但 ts-morph 解析失败的文件，对比新旧 fallback 的 `CodeSkeleton` 输出。

**Acceptance Scenarios**:

1. **Given** ts-morph 解析 TS 文件失败触发降级，**When** 使用新的 tree-sitter fallback 分析同一文件，**Then** 提取的 `exports` 数量不少于旧正则 fallback，且 `signature` 字段不再包含 `[SYNTAX ERROR]` 前缀。
2. **Given** 降级到 tree-sitter 后解析成功，**Then** `parserUsed` 仍标记为 `'tree-sitter'`，`parseErrors` 数组为空或仅包含 ts-morph 原始错误记录。

---

### User Story 5 - grammar WASM 零安装体验 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望 `npm install reverse-spec` 后即可使用多语言解析功能，无需手动下载 grammar 文件或安装本地编译工具。

**Why this priority**: 安装摩擦直接影响用户采纳率。原生 `tree-sitter` 依赖需要 C++ 编译器，已在部分环境造成安装失败。

**Independent Test**: 在一个全新的 Node.js 环境（无 C++ 编译器）中运行 `npm install reverse-spec`，验证安装成功且多语言解析功能可用。

**Acceptance Scenarios**:

1. **Given** 一个未安装 C/C++ 编译工具的干净环境，**When** 运行 `npm install reverse-spec`，**Then** 安装成功，无原生编译错误。
2. **Given** 安装完成后，**When** 首次调用 `TreeSitterAnalyzer.analyze()` 解析 Python 文件，**Then** WASM grammar 自动加载，解析成功。

---

### Edge Cases

- 当 grammar WASM 文件损坏或缺失时，`TreeSitterAnalyzer` 应抛出明确的错误（包含语言名和预期 WASM 路径），而非运行时崩溃。
- 当 `.scm` 查询文件语法有误时，应在加载阶段检测并报错，而非在解析阶段静默返回空结果。
- 当源文件为空（0 字节）时，返回空的 `CodeSkeleton`（`exports: []`, `imports: []`），不抛出异常。
- 当源文件包含 BOM（Byte Order Mark）时，tree-sitter 应正常解析。
- 当源文件编码非 UTF-8（如 Latin-1）时，应在读取阶段给出明确错误。
- 当源文件中包含语法错误（如 Python 的缩进错误）时，tree-sitter 应尽可能提取有效节点，将错误记录到 `parseErrors`。
- 当多个文件并发调用 `TreeSitterAnalyzer` 时，grammar 加载应为单例（每种语言只加载一次 WASM）。
- 当未注册的语言（如 `.rb`）请求 tree-sitter 解析时，应返回明确的 "不支持的语言" 错误。

---

## 功能需求（Functional Requirements）

### TreeSitterAnalyzer 核心解析器

- **FR-001**: 系统 MUST 提供 `TreeSitterAnalyzer` 类，作为统一的多语言 tree-sitter 解析入口，接受文件路径和语言标识，返回结构化的 `CodeSkeleton`。
- **FR-002**: `TreeSitterAnalyzer` MUST 基于 `web-tree-sitter`（WASM 版）实现，不使用原生 C++ 绑定版 `tree-sitter`。
- **FR-003**: `TreeSitterAnalyzer` MUST 支持以下语言的解析：`python`、`go`、`java`、`typescript`、`javascript`。
- **FR-004**: `TreeSitterAnalyzer` MUST 为每种支持的语言返回通过 `CodeSkeletonSchema.parse()` 验证的有效 `CodeSkeleton` 数据。
- **FR-005**: `TreeSitterAnalyzer` MUST 在解析失败时将错误信息记录到 `CodeSkeleton.parseErrors` 数组，而非抛出异常（除文件不存在等 I/O 错误外）。
- **FR-006**: `TreeSitterAnalyzer` SHOULD 暴露一个 `dispose()` 方法，用于释放已加载的 grammar 和 parser 资源。

### Grammar WASM 管理

- **FR-007**: 系统 MUST 实现 `GrammarManager` 模块，负责 grammar WASM 文件的加载和缓存管理。
- **FR-008**: `GrammarManager` MUST 支持按需加载——仅在首次请求某语言解析时加载其 WASM grammar，非启动时全量加载。
- **FR-009**: `GrammarManager` MUST 为每种语言维护单例 grammar 实例——同一语言的 WASM 文件在进程生命周期内只加载一次。
- **FR-010**: grammar WASM 文件 MUST 随 npm 包分发（包含在 `package.json` 的 `files` 字段中），用户无需额外下载。
- **FR-011**: grammar WASM 文件 MUST 存放在包内的固定路径（如 `grammars/`），`GrammarManager` 通过相对于包根目录的路径定位 WASM 文件。
- **FR-012**: `GrammarManager` MUST 对 grammar 版本进行锁定——在 `grammars/manifest.json`（或等效机制）中记录每个 grammar 的版本和 SHA256 校验和，确保 WASM 文件与 `web-tree-sitter` 运行时 ABI 兼容。
- **FR-013**: 当 WASM 文件缺失或校验和不匹配时，`GrammarManager` MUST 抛出包含语言名、预期路径和校验详情的明确错误。

### .scm 查询文件

- **FR-014**: 系统 MUST 为每种支持的语言（Python、Go、Java）提供 `.scm` 查询文件，定义提取函数签名、类/struct/interface 定义、import 语句、类型定义所需的 tree-sitter query patterns。
- **FR-015**: `.scm` 查询文件 MUST 存放在包内的固定路径（如 `queries/<language>.scm`），与 grammar WASM 文件分别管理。
- **FR-016**: 每种语言的 `.scm` 查询 MUST 覆盖以下最小提取范围：
  - 函数/方法定义（名称、参数签名、返回类型）
  - 类/struct/interface/enum 定义（名称、泛型参数、继承关系）
  - 类/struct 成员（方法、字段、属性）
  - import/导入语句（模块路径、导入名称）
  - 类型别名/类型定义
- **FR-017**: `.scm` 查询文件 SHOULD 为每种语言的特有概念提供额外查询：
  - Python: 装饰器（`@staticmethod`、`@classmethod`、`@property`）、`__all__` 列表
  - Go: method receiver、首字母大写导出判定
  - Java: 访问修饰符（`public`/`protected`/`private`）、注解、record 类型
- **FR-018**: `.scm` 查询文件 MUST 在加载时进行语法校验——如果查询语法无效，应在初始化阶段报错而非解析阶段静默失败。

### Query 到 CodeSkeleton 映射层

- **FR-019**: 系统 MUST 实现 `QueryMapper`（或等效模块），将 tree-sitter query 的匹配结果（captures）转换为 `CodeSkeleton` 的 `ExportSymbol`、`ImportReference`、`MemberInfo` 等结构化数据。
- **FR-020**: `QueryMapper` MUST 为每种语言实现独立的映射逻辑，处理该语言特有的 AST 节点类型和命名约定。
- **FR-021**: `QueryMapper` 的 Python 映射 MUST 处理以下特有概念：
  - `def` → `ExportSymbol(kind: 'function')`，`async def` → `ExportSymbol(kind: 'function')`
  - `class` → `ExportSymbol(kind: 'class')`
  - `@staticmethod` 修饰的方法 → `MemberInfo(kind: 'staticmethod')`
  - `@classmethod` 修饰的方法 → `MemberInfo(kind: 'classmethod')`
  - `@property` 修饰的方法 → `MemberInfo(kind: 'getter')`
  - `import xxx` / `from xxx import yyy` → `ImportReference`
  - 类型注解提取到 `signature` 字段
- **FR-022**: `QueryMapper` 的 Go 映射 MUST 处理以下特有概念：
  - `func Foo()` → `ExportSymbol(kind: 'function')`（首字母大写 = public）
  - `type Foo struct {}` → `ExportSymbol(kind: 'struct')`
  - `type Foo interface {}` → `ExportSymbol(kind: 'interface')`
  - `func (f *Foo) Method()` → struct `Foo` 的 `MemberInfo(kind: 'method')`
  - `import "path"` / `import ( "path1"; "path2" )` → `ImportReference`
  - 多返回值签名完整保留在 `signature` 中
- **FR-023**: `QueryMapper` 的 Java 映射 MUST 处理以下特有概念：
  - `public class Foo` → `ExportSymbol(kind: 'class', visibility: 'public')`
  - `interface Foo` → `ExportSymbol(kind: 'interface')`
  - `enum Foo` → `ExportSymbol(kind: 'enum')`
  - `record Foo(...)` → `ExportSymbol(kind: 'data_class')`
  - 访问修饰符映射到 `visibility` 字段
  - 泛型参数映射到 `typeParameters`
  - `import java.util.List` → `ImportReference(moduleSpecifier: 'java.util.List')`

### 依赖变更

- **FR-024**: 系统 MUST 新增 `web-tree-sitter` 作为运行时依赖。
- **FR-025**: 系统 MUST 移除 `tree-sitter`（原生 C++ 绑定版）运行时依赖。
- **FR-026**: 系统 MUST 移除 `tree-sitter-typescript`（原生 TS grammar）运行时依赖。
- **FR-027**: 系统 MUST 将各语言的 grammar WASM 文件纳入 npm 包分发（通过 `package.json` 的 `files` 字段或等效机制），语言包括：`tree-sitter-python`、`tree-sitter-go`、`tree-sitter-java`、`tree-sitter-typescript`（WASM 版，用于 TS/JS 降级）。

### tree-sitter-fallback.ts 重写

- **FR-028**: 系统 MUST 重写 `src/core/tree-sitter-fallback.ts`，将其从纯正则实现改为基于 `TreeSitterAnalyzer` 的真正 tree-sitter 解析。
- **FR-029**: 重写后的 `analyzeFallback` 函数 MUST 保持与现有调用方（`TsJsLanguageAdapter.analyzeFallback()`、`ast-analyzer.ts` 降级路径）兼容的函数签名。
- **FR-030**: 当 tree-sitter 解析也失败时（如 WASM 加载失败），系统 SHOULD 保留正则作为最终降级手段，形成三级降级链：`ts-morph → tree-sitter → regex`。
- **FR-031**: 重写后的 `tree-sitter-fallback.ts` MUST 支持检测文件语言——对 TS/JS 文件使用 TypeScript/JavaScript grammar，为后续多语言适配器提供统一入口。

### 与现有系统的集成

- **FR-032**: `TsJsLanguageAdapter.analyzeFallback()` MUST 在重写后调用真正的 tree-sitter 解析（而非正则），保持现有委托模式不变。
- **FR-033**: `ast-analyzer.ts` 中 ts-morph 解析失败的降级路径 MUST 继续调用 `analyzeFallback()`，行为链不变，仅降级解析器的内部实现从正则升级为 tree-sitter。
- **FR-034**: 后续语言适配器（Feature 028/029/030）MUST 能通过 `TreeSitterAnalyzer` 实现其 `analyzeFile()` 方法，`TreeSitterAnalyzer` 的 API 设计需考虑此集成场景。
- **FR-035**: `TreeSitterAnalyzer` MUST 支持被 `LanguageAdapter.analyzeFile()` 和 `LanguageAdapter.analyzeFallback()` 两种场景调用——前者作为主解析器（非 JS/TS 语言），后者作为降级解析器（JS/TS 语言）。

---

## 非功能需求（Non-Functional Requirements）

### 性能

- **NFR-001**: 单个文件（1000 行以内）的 tree-sitter 解析时间 MUST 不超过 200ms（含 grammar 首次加载时间不计）。
- **NFR-002**: grammar WASM 文件首次加载时间 SHOULD 不超过 500ms。
- **NFR-003**: grammar 实例在首次加载后 MUST 被缓存复用，后续同语言文件的解析不再有 grammar 加载开销。
- **NFR-004**: 在批量分析场景（100+ 文件）中，tree-sitter 解析不应导致显著的内存泄漏——`TreeSitterAnalyzer` MUST 在每个文件解析完成后释放 AST tree 对象。

### 包体积

- **NFR-005**: 每个语言的 grammar WASM 文件大小 SHOULD 不超过 2MB。
- **NFR-006**: 所有 grammar WASM 文件的总大小 SHOULD 不超过 10MB，避免 npm 包体积过度膨胀。

### 兼容性

- **NFR-007**: `web-tree-sitter` 版本与所有 grammar WASM 文件的 ABI 版本 MUST 兼容。系统 MUST 在 CI 中验证此兼容性。
- **NFR-008**: WASM 运行时 MUST 兼容 Node.js 20.x LTS 和 Node.js 22.x 的 WASM 支持。
- **NFR-009**: 移除原生 `tree-sitter` 依赖后，MUST 不影响现有 `ts-morph` 和 `dependency-cruiser` 等依赖的正常工作。

### 可维护性

- **NFR-010**: 新增一种语言的 tree-sitter 支持 SHOULD 仅需：添加 grammar WASM 文件、编写 `.scm` 查询文件、实现语言特定的 `QueryMapper`，无需修改 `TreeSitterAnalyzer` 核心代码。
- **NFR-011**: `.scm` 查询文件 SHOULD 有内联注释说明每个 query pattern 的用途和预期匹配的 AST 节点类型。

### 测试

- **NFR-012**: 每种支持的语言 MUST 有至少 10 个单元测试用例，覆盖函数、类/struct/interface、import、类型定义、边界情况的解析。
- **NFR-013**: MUST 提供 tree-sitter 解析与正则 fallback 的对比测试（对相同文件，验证 tree-sitter 提取的 exports 数量不少于正则方式）。

---

## 数据模型变更

### 无 CodeSkeleton schema 变更

本 Feature 不需要修改 `CodeSkeleton` 的 Zod schema——Feature 025 已完成所有必要的模型扩展：
- `LanguageSchema` 已支持 `python`、`go`、`java` 等 10 种语言
- `ExportKindSchema` 已包含 `struct`、`trait`、`protocol`、`data_class`、`module`
- `MemberKindSchema` 已包含 `classmethod`、`staticmethod`、`associated_function`
- `ParserUsedSchema` 已包含 `'tree-sitter'` 值
- `filePath` 正则已支持 18 种文件扩展名

### 新增模块和类型

#### TreeSitterAnalyzer

```typescript
// src/core/tree-sitter-analyzer.ts

interface TreeSitterAnalyzeOptions {
  /** 包含非导出/私有符号（默认 false） */
  includePrivate?: boolean;
}

class TreeSitterAnalyzer {
  /**
   * 解析单个源文件，返回结构化的 CodeSkeleton
   * @param filePath - 源文件绝对路径
   * @param language - 目标语言标识
   * @param options - 解析选项
   */
  async analyze(
    filePath: string,
    language: Language,
    options?: TreeSitterAnalyzeOptions,
  ): Promise<CodeSkeleton>;

  /**
   * 检查指定语言是否有可用的 grammar
   */
  isLanguageSupported(language: Language): boolean;

  /**
   * 释放已加载的 grammar 和 parser 资源
   */
  async dispose(): Promise<void>;
}
```

#### GrammarManager

```typescript
// src/core/grammar-manager.ts

interface GrammarManifestEntry {
  language: string;
  wasmFile: string;
  version: string;
  sha256: string;
}

class GrammarManager {
  /**
   * 获取指定语言的 grammar（按需加载 + 缓存）
   */
  async getGrammar(language: Language): Promise<TreeSitterLanguage>;

  /**
   * 检查指定语言是否有可用的 grammar WASM 文件
   */
  hasGrammar(language: Language): boolean;

  /**
   * 释放所有已加载的 grammar
   */
  async dispose(): Promise<void>;
}
```

#### QueryMapper（每语言一个）

```typescript
// src/core/query-mappers/base-mapper.ts

interface QueryMapper {
  /**
   * 从 tree-sitter AST 和 query captures 中提取导出符号
   */
  extractExports(tree: Tree, queryCaptures: QueryCapture[]): ExportSymbol[];

  /**
   * 从 tree-sitter AST 和 query captures 中提取导入引用
   */
  extractImports(tree: Tree, queryCaptures: QueryCapture[]): ImportReference[];
}

// src/core/query-mappers/python-mapper.ts
// src/core/query-mappers/go-mapper.ts
// src/core/query-mappers/java-mapper.ts
// src/core/query-mappers/typescript-mapper.ts
```

### 新增文件结构

```
src/core/
  tree-sitter-analyzer.ts      # TreeSitterAnalyzer 主类
  grammar-manager.ts            # WASM grammar 加载与缓存
  tree-sitter-fallback.ts       # 重写：真正的 tree-sitter 降级（保留正则作为最终 fallback）
  query-mappers/
    base-mapper.ts              # QueryMapper 接口定义
    python-mapper.ts            # Python AST → CodeSkeleton 映射
    go-mapper.ts                # Go AST → CodeSkeleton 映射
    java-mapper.ts              # Java AST → CodeSkeleton 映射
    typescript-mapper.ts        # TypeScript/JavaScript AST → CodeSkeleton 映射

grammars/
  manifest.json                 # grammar 版本和校验清单
  tree-sitter-python.wasm       # Python grammar
  tree-sitter-go.wasm           # Go grammar
  tree-sitter-java.wasm         # Java grammar
  tree-sitter-typescript.wasm   # TypeScript grammar（用于 TS/JS 降级）
  tree-sitter-javascript.wasm   # JavaScript grammar（JSX 等场景）

queries/
  python.scm                    # Python 查询规则
  go.scm                        # Go 查询规则
  java.scm                      # Java 查询规则
  typescript.scm                # TypeScript 查询规则
  javascript.scm                # JavaScript 查询规则
```

### package.json 变更

```jsonc
{
  "dependencies": {
    // 新增
    "web-tree-sitter": "^0.24.x",  // WASM 版 tree-sitter 运行时
    // 移除
    // "tree-sitter": "^0.21.1",           ← 删除
    // "tree-sitter-typescript": "^0.23.2", ← 删除
  },
  "files": [
    "dist/",
    "grammars/",   // 新增：WASM grammar 文件
    "queries/",    // 新增：.scm 查询文件
    // ...其他现有条目
  ]
}
```

---

## 依赖和约束

### 外部依赖

| 依赖 | 版本 | 用途 | 变更类型 |
|------|------|------|---------|
| `web-tree-sitter` | ^0.24.x | WASM 版 tree-sitter 运行时 | **新增** |
| `tree-sitter-python`（WASM） | 与 `web-tree-sitter` ABI 兼容版本 | Python grammar | **新增（仅 WASM 文件，非 npm 依赖）** |
| `tree-sitter-go`（WASM） | 同上 | Go grammar | **新增（仅 WASM 文件）** |
| `tree-sitter-java`（WASM） | 同上 | Java grammar | **新增（仅 WASM 文件）** |
| `tree-sitter-typescript`（WASM） | 同上 | TS/JS 降级 grammar | **新增（仅 WASM 文件）** |
| `tree-sitter` | ^0.21.1 | 原生 C++ 绑定 | **移除** |
| `tree-sitter-typescript` | ^0.23.2 | 原生 TS grammar | **移除** |

### 内部依赖

| 模块 | 关系 | 说明 |
|------|------|------|
| Feature 025 `LanguageAdapter` 接口 | 前置依赖（已完成） | `TreeSitterAnalyzer` 的 API 需兼容 `LanguageAdapter.analyzeFile()` 和 `analyzeFallback()` 的调用场景 |
| Feature 025 `CodeSkeleton` 扩展模型 | 前置依赖（已完成） | tree-sitter 解析结果映射到已扩展的 `CodeSkeleton` schema |
| `TsJsLanguageAdapter` | 被修改 | `analyzeFallback()` 的内部实现从正则升级为 tree-sitter |
| `ast-analyzer.ts` | 间接影响 | 降级路径不变，仅 `analyzeFallback()` 内部实现变化 |
| Feature 028/029/030 语言适配器 | 下游消费者 | 将使用 `TreeSitterAnalyzer` 作为主解析器 |

### 约束

1. **TS/JS 主解析器不变**: ts-morph 仍为 TS/JS 的首选解析器，tree-sitter 仅作为降级方案。不得改变此优先级。
2. **ABI 兼容性锁定**: `web-tree-sitter` 运行时版本与所有 grammar WASM 文件必须 ABI 兼容。版本升级需同步更新所有 WASM 文件并验证。
3. **npm 包体积约束**: grammar WASM 文件会增加包体积，需监控总增量不超过 10MB。
4. **Node.js WASM 支持**: 依赖 Node.js 内置的 WASM 运行时（`WebAssembly` 全局对象），Node.js 20.x+ 已稳定支持。
5. **无运行时网络依赖**: grammar WASM 文件必须随包分发，不允许运行时从网络下载。

---

## 验收标准（Success Criteria）

### 核心验收

- **AC-001**: `TreeSitterAnalyzer` 可解析标准 Python 文件（含 `def`、`class`、`import`、类型注解、装饰器），生成通过 `CodeSkeletonSchema.parse()` 验证的有效 `CodeSkeleton`。
- **AC-002**: `TreeSitterAnalyzer` 可解析标准 Go 文件（含 `func`、`struct`、`interface`、`import`、method receiver），生成有效 `CodeSkeleton`，且公开/私有符号通过首字母大写规则正确区分。
- **AC-003**: `TreeSitterAnalyzer` 可解析标准 Java 文件（含 `class`、`interface`、`enum`、`record`、`import`、访问修饰符、泛型），生成有效 `CodeSkeleton`。
- **AC-004**: TS/JS 文件在 ts-morph 解析失败后，降级到 tree-sitter 解析（而非正则），提取质量不低于原正则 fallback。
- **AC-005**: grammar WASM 文件随 npm 包分发，`npm install reverse-spec` 后无需额外下载即可使用多语言解析。

### 依赖变更验收

- **AC-006**: `package.json` 中 `tree-sitter` 和 `tree-sitter-typescript` 依赖已移除。
- **AC-007**: `package.json` 中新增 `web-tree-sitter` 依赖。
- **AC-008**: 在无 C/C++ 编译器的环境中，`npm install` 成功（不再有原生编译步骤）。

### 零回归验收

- **AC-009**: 现有全部测试套件在 Feature 完成后 100% 通过，零跳过、零失败。
- **AC-010**: 对纯 TS/JS 项目运行 `reverse-spec generate` 和 `reverse-spec batch`，产出与 Feature 实施前一致——ts-morph 仍为首选，tree-sitter 仅在 ts-morph 失败时降级触发。

### 架构验收

- **AC-011**: 新增一种语言的 tree-sitter 支持仅需：(1) 添加 grammar WASM 文件到 `grammars/`，(2) 编写 `.scm` 查询文件到 `queries/`，(3) 实现语言特定的 `QueryMapper`——无需修改 `TreeSitterAnalyzer` 核心代码。
- **AC-012**: 每种已支持语言有不少于 10 个单元测试，覆盖主要语法结构的解析。

### 可量化指标

- **AC-013**: 单文件（1000 行以内）tree-sitter 解析时间不超过 200ms（不含 grammar 首次加载）。
- **AC-014**: 所有 grammar WASM 文件总大小不超过 10MB。
- **AC-015**: TS/JS 文件的 tree-sitter 降级提取的 `exports` 数量不少于旧正则 fallback（在相同测试文件集上对比）。
