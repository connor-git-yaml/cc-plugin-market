---
feature: 030-java-language-adapter
title: Java LanguageAdapter 实现
status: Draft
created: 2026-03-17
blueprint: 024-multilang-blueprint
research_mode: codebase-scan
---

# Feature Specification: Java LanguageAdapter 实现

**Feature Branch**: `030-java-language-adapter`
**Created**: 2026-03-17
**Status**: Draft
**Blueprint**: 024-multilang-blueprint (Feature 6 - P1)
**Dependencies**: Feature 025（LanguageAdapter 接口）-- 已完成；Feature 027（tree-sitter 多语言后端 + JavaMapper）-- 已完成
**Input**: 实现 JavaLanguageAdapter 类（实现 LanguageAdapter 接口），为 reverse-spec 工具提供 Java 语言的完整支持。这是 Blueprint 024 多语言支持里程碑的第三个适配器（续 028-Python、029-Go），采用与现有适配器完全同构的委托模式。

[无调研基础] 本规范基于 codebase-scan 模式的代码上下文摘要和需求描述直接生成。

---

## 概述与动机

### 现状

Feature 025 建立了 LanguageAdapter 抽象层和 LanguageAdapterRegistry，Feature 027 引入了 web-tree-sitter 多语言解析后端，并已完成 JavaMapper（`query-mappers/java-mapper.ts`，482 行完整实现）。JavaMapper 已实现完整的 Java AST 解析能力——能够从 Java 源文件中提取 class 声明（含泛型、继承、实现）、interface 声明、enum 声明、record 声明（Java 16+）、方法（含返回类型和参数签名）、字段（含多声明符）、构造器、import 声明（含 static import 和通配 import）以及注解（marker_annotation 和 annotation），并正确处理 Java 的 public/protected/private/package-private 可见性修饰符。

`tree-sitter-fallback.ts` 的 `getLanguage()` 已将 `.java` 映射到 `'java'` 语言标识，但 `regexFallback()` 函数尚未包含 Java 语言的正则降级提取器——目前 Java 文件在正则降级时会 fallback 到默认的 TS/JS 正则提取逻辑。

`bootstrapAdapters()` 中尚未注册 JavaLanguageAdapter。用户无法对 Java 项目运行 `reverse-spec generate` 或 `reverse-spec batch`。

### 动机

1. **延续多语言扩展路线**: Java 是 Blueprint 024 规划的第三种新语言（P1 优先级），在 PythonLanguageAdapter（Feature 028）和 GoLanguageAdapter（Feature 029）成功验证架构可扩展性后，Java 适配器进一步巩固 LanguageAdapter 模式的通用性，同时覆盖企业级 Java 生态的代码分析需求。
2. **交付用户价值**: Java 是企业级开发的主流语言，在 Spring Boot、Android 等领域有广泛应用。支持 Java 将覆盖大量企业级项目的代码分析需求。
3. **复用已有基础设施**: JavaMapper 和 TreeSitterAnalyzer 已提供完整的 Java 解析能力，JavaLanguageAdapter 主要是一个"胶水层"——委托已有模块完成实际工作。实现模式与 PythonLanguageAdapter、GoLanguageAdapter 完全对称。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Java 项目的 spec 生成 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望对一个标准 Java 项目运行 `reverse-spec generate`，能够生成完整的功能规范文档，包含准确的类签名、方法签名、字段信息、继承关系和接口实现信息。

**Why this priority**: 这是 JavaLanguageAdapter 的核心用户价值。如果无法对 Java 项目生成有效的 spec，则整个 Feature 失去意义。

**Independent Test**: 对一个包含 class、interface、enum、record、method、field、constructor、import 和 annotation 的标准 Java 项目运行 `reverse-spec generate`，验证生成的 spec 包含所有 public 符号的结构信息。

**Acceptance Scenarios**:

1. **Given** 一个包含 `class`、`interface`、`enum` 声明的标准 Java 文件，**When** 运行 `reverse-spec generate <target.java>`，**Then** 生成的 spec 包含所有 public 类型的签名信息（含继承和接口实现），且不包含 private/protected 的顶层类型。
2. **Given** 一个包含泛型类（如 `public class Repository<T extends Serializable>`）的 Java 文件，**When** 生成 spec，**Then** 类签名中包含完整的泛型参数和约束信息。
3. **Given** 一个包含 Java 16+ record 类型（如 `public record Point(int x, int y)`）的 Java 文件，**When** 生成 spec，**Then** record 被正确识别为 `data_class` 类型。
4. **Given** 一个包含 `abstract class` 和 `@Override` 注解方法的 Java 文件，**When** 生成 spec，**Then** abstract 类的签名中包含 `abstract` 修饰符，方法的注解信息被正确提取。

---

### User Story 2 - Java 类成员的完整提取 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望生成的 spec 能准确反映 Java 类的成员结构，包括方法（含 static 方法）、字段（含 static 字段）和构造器，并正确处理可见性修饰符。

**Why this priority**: 类成员是 Java 代码结构的核心组成部分。准确的成员提取使 spec 能呈现完整的类 API 表面，这对代码审查和架构分析至关重要。

**Independent Test**: 对包含多种成员类型（public/protected/private 方法、static 方法、字段、构造器）的 Java 类文件进行分析，验证每种成员被正确提取并标记可见性。

**Acceptance Scenarios**:

1. **Given** 一个包含 public/protected 方法的 Java 类，**When** 以默认选项（`includePrivate: false`）分析，**Then** 返回的成员列表包含 public 和 protected 方法，不包含 private 方法。
2. **Given** 一个包含 static 方法和 static 字段的 Java 类，**When** 分析该类，**Then** 成员的 `isStatic` 属性正确标记为 `true`，签名中包含 `static` 前缀。
3. **Given** 一个包含多个构造器（重载）的 Java 类，**When** 分析该类，**Then** 每个构造器被提取为独立的 `constructor` 类型成员，签名包含参数列表。
4. **Given** 一个包含泛型方法（如 `<T> List<T> filter(Predicate<T> pred)`）的 Java 类，**When** 分析该类，**Then** 方法签名中包含方法级泛型参数。

---

### User Story 3 - Java import 依赖识别 (Priority: P1)

作为一个 **reverse-spec 用户**，我希望生成的 spec 能准确反映 Java 文件的 import 依赖关系，包括普通 import、static import 和通配 import。

**Why this priority**: import 依赖是理解项目架构和包间关联关系的关键信息。

**Independent Test**: 对包含多种 import 形式（`import java.util.List`、`import static java.util.Collections.sort`、`import java.util.*`）的 Java 文件进行分析，验证每种 import 形式被正确解析。

**Acceptance Scenarios**:

1. **Given** 一个包含 `import java.util.List;` 的 Java 文件，**When** 分析其 import 依赖，**Then** `moduleSpecifier` 为 `java.util`，`namedImports` 包含 `List`，`isRelative` 为 `false`。
2. **Given** 一个包含 `import static java.util.Collections.sort;` 的 Java 文件，**When** 分析其 import 依赖，**Then** `moduleSpecifier` 为 `java.util.Collections`，`namedImports` 包含 `sort`。
3. **Given** 一个包含 `import java.util.*;` 的 Java 文件，**When** 分析其 import 依赖，**Then** `moduleSpecifier` 为 `java.util`，`namedImports` 包含 `*` 通配标记。

---

### User Story 4 - Java 文件自动路由到正确适配器 (Priority: P1)

作为一个 **reverse-spec 用户**，在一个混合语言项目中运行 reverse-spec 时，我希望 `.java` 文件能够自动被路由到 JavaLanguageAdapter 进行分析，而 `.ts`、`.py` 和 `.go` 文件仍由各自的适配器处理。

**Why this priority**: 自动路由是 LanguageAdapter 架构的核心承诺之一。

**Independent Test**: 在一个包含 `.ts`、`.py`、`.go` 和 `.java` 文件的项目中运行 `reverse-spec batch`，验证四种文件分别被正确的适配器处理。

**Acceptance Scenarios**:

1. **Given** LanguageAdapterRegistry 中已注册 TsJsLanguageAdapter、PythonLanguageAdapter、GoLanguageAdapter 和 JavaLanguageAdapter，**When** 调用 `registry.getAdapter('Example.java')`，**Then** 返回 JavaLanguageAdapter 实例。
2. **Given** 一个混合语言项目，**When** file-scanner 扫描目录，**Then** `.java` 文件出现在扫描结果中，且 `target`、`build`、`out`、`.gradle` 等 Java 生态目录被自动忽略。

---

### User Story 5 - Java 解析降级的容错处理 (Priority: P2)

作为一个 **reverse-spec 用户**，当 tree-sitter 解析 Java 文件失败时（如 WASM grammar 加载异常），我希望系统能降级到正则提取模式，仍然提供基本的代码结构信息，而非整体失败。

**Why this priority**: 降级容错是生产级工具的基本要求。当前 `regexFallback()` 尚未包含 Java 正则降级提取器，Java 文件在正则降级时会错误地使用 TS/JS 提取逻辑，需要新增 Java 专用正则提取。

**Independent Test**: 模拟 TreeSitterAnalyzer 解析失败的场景，验证 `analyzeFallback()` 方法能通过 Java 专用正则提取返回基本的 CodeSkeleton。

**Acceptance Scenarios**:

1. **Given** tree-sitter 解析正常时，**When** 对 Java 文件调用 `analyzeFile()`，**Then** 返回的 CodeSkeleton 的 `parserUsed` 为 `'tree-sitter'`，包含完整的导出符号和 import 信息。
2. **Given** tree-sitter 解析失败，**When** 对 Java 文件调用 `analyzeFallback()`，**Then** 系统降级到 Java 专用正则提取，返回的 CodeSkeleton 至少包含通过正则匹配到的 `class`、`interface`、`enum`、`import` 信息。

---

### User Story 6 - Java 特有术语在 LLM prompt 中的参数化 (Priority: P2)

作为一个 **reverse-spec 用户**，我希望生成 Java 项目 spec 时，LLM prompt 中使用 Java 社区的惯用术语（如"访问修饰符（public/protected/private/package-private）"而非简单的"导出"、"interface + abstract class"而非"协议"），使生成的文档对 Java 开发者更自然可读。

**Why this priority**: 术语参数化使 LLM 生成符合 Java 社区习惯的文档。

**Independent Test**: 调用 JavaLanguageAdapter 的 `getTerminology()` 方法，验证返回的术语映射包含 Java 特有的概念描述。

**Acceptance Scenarios**:

1. **Given** JavaLanguageAdapter 已注册，**When** 调用 `getTerminology()`，**Then** `codeBlockLanguage` 为 `'java'`，`exportConcept` 描述 Java 的访问修饰符体系（public 类和成员），`interfaceConcept` 描述 Java 的 interface 和 abstract class。
2. **Given** JavaLanguageAdapter 已注册，**When** 调用 `getTerminology()`，**Then** `typeSystemDescription` 描述 Java 的静态强类型系统（含泛型），`moduleSystem` 描述 Java 的 package/import 和 JPMS 模块系统。

---

### User Story 7 - Java 测试文件的正确识别 (Priority: P2)

作为一个 **reverse-spec 用户**，我希望系统在分析 Java 项目时，能正确识别测试文件（`*Test.java`、`Test*.java`、`*Tests.java`、`*IT.java`）并按预期处理（如 noise-filter 中降低测试文件权重）。

**Why this priority**: 测试文件识别影响 spec 生成的质量——测试代码不应与生产代码以同等权重出现在架构概览中。

**Independent Test**: 调用 JavaLanguageAdapter 的 `getTestPatterns()` 方法，验证返回的匹配模式能正确区分测试文件和生产代码。

**Acceptance Scenarios**:

1. **Given** JavaLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `filePattern` 正则能匹配 `UserServiceTest.java`、`TestUserService.java`、`UserServiceTests.java`、`UserServiceIT.java`。
2. **Given** JavaLanguageAdapter 已注册，**When** 调用 `getTestPatterns()`，**Then** `testDirs` 包含 `src/test/java`（Maven/Gradle 标准测试目录）。
3. **Given** 调用 `getTestPatterns().filePattern`，**When** 测试 `UserService.java`，**Then** 不匹配（非测试文件不被误判）。

---

### User Story 8 - Java 生态特有目录的自动忽略 (Priority: P3)

作为一个 **reverse-spec 用户**，我希望在分析 Java 项目时，`target`（Maven）、`build`（Gradle）、`out`（IntelliJ）、`.gradle` 等 Java 生态的构建/缓存目录被自动排除在扫描范围外，无需手动配置。

**Why this priority**: 这些目录包含编译产物和构建缓存，不是用户编写的源代码，扫描它们只会增加噪音和处理时间。自动忽略提升用户体验，但不影响核心功能。

**Independent Test**: 检查 JavaLanguageAdapter 的 `defaultIgnoreDirs` 属性，验证包含 Java 生态的常见忽略目录。

**Acceptance Scenarios**:

1. **Given** JavaLanguageAdapter 已注册，**When** 查看 `defaultIgnoreDirs`，**Then** 至少包含 `target`、`build`、`out`、`.gradle`。
2. **Given** JavaLanguageAdapter 已注册到 Registry，**When** 调用 `registry.getDefaultIgnoreDirs()`，**Then** 返回结果中包含 Java、Go、Python 和 TS/JS 四种适配器的忽略目录合集。

---

### Edge Cases

- **空 Java 文件（仅含 package 声明）**: 如 `package com.example;`，应返回空的导出列表和 import 列表，不抛出异常。（关联: FR-005, US-1）
- **仅含注释的 Java 文件**: 当 `.java` 文件仅包含 Javadoc 注释或行注释而无类声明时，应返回空的导出列表。（关联: FR-005）
- **Java 语法错误**: 当 Java 文件包含语法错误（如未闭合括号、缺少分号）时，tree-sitter 应尽可能提取有效节点，将错误记录到 `parseErrors`。（关联: FR-005, FR-006）
- **package-private 可见性（无显式修饰符）**: Java 中没有显式修饰符的顶层类/成员默认为 package-private。在 `includePrivate: false` 时，无显式修饰符的顶层类型仍应被包含（因为 package-private 在 Java 中是合理的 API 边界）。[AUTO-RESOLVED: 与 JavaMapper 现有行为一致——`extractVisibility()` 返回 `undefined` 时，`_extractClassLike()` 的过滤条件 `visibility !== undefined && visibility !== 'public'` 不会排除 package-private 类型]
- **内部类（inner class / nested class）**: 当 Java 文件包含内部类声明时，当前 JavaMapper 仅提取顶层声明（`rootNode` 的直接子节点），内部类不会出现在顶层导出列表中。内部类作为外层类的 members 可能被部分提取。属于已知限制。[AUTO-RESOLVED: 与逐文件分析的统一模式一致，内部类信息通过外层类的 members 间接呈现]
- **多类文件**: Java 文件可以包含多个非 public 类（同一文件中仅允许一个 public 类）。所有符合可见性过滤条件的顶层类声明都应被提取。（关联: FR-005）
- **Java Modules（module-info.java）**: `module-info.java` 文件包含 JPMS 模块声明（`module xxx { ... }`），其 AST 结构与普通 Java 文件不同。当前 JavaMapper 可能无法正确解析 module 声明，应优雅降级——返回空的导出列表而非报错。（关联: FR-005, FR-017）
- **超大 Java 文件（>10000 行）**: 应能正常解析，性能可能下降但不应超时或内存溢出。（关联: FR-005）
- **annotation 的提取范围**: 当前 JavaMapper 的 `extractAnnotations()` 提取 modifiers 中的 marker_annotation 和 annotation 节点文本，但这些注解信息未直接映射到 CodeSkeleton 的标准字段。注解信息作为成员签名的上下文存在，不作为独立导出符号处理。（关联: US-1 Scenario 4）
- **static import 的语义**: `import static java.util.Collections.sort` 导入的是方法而非类。当前 JavaMapper 正确地将 `Collections` 作为 `moduleSpecifier`、`sort` 作为 `namedImports`，这是合理的映射。（关联: US-3 Scenario 2）

---

## Requirements *(mandatory)*

### Functional Requirements

#### JavaLanguageAdapter 核心

- **FR-001**: 系统 MUST 提供 `JavaLanguageAdapter` 类，实现 `LanguageAdapter` 接口的全部必要方法（`analyzeFile`、`analyzeFallback`、`getTerminology`、`getTestPatterns`）以及全部必要属性（`id`、`languages`、`extensions`、`defaultIgnoreDirs`）。
  - *关联: US-1, US-4*
- **FR-002**: `JavaLanguageAdapter` 的 `id` 属性 MUST 为 `'java'`。
  - *关联: US-4*
- **FR-003**: `JavaLanguageAdapter` 的 `languages` 属性 MUST 声明支持 `['java']` 语言。
  - *关联: US-4*
- **FR-004**: `JavaLanguageAdapter` 的 `extensions` 属性 MUST 声明支持 `.java` 文件扩展名。
  - *关联: US-4*

#### 文件分析（analyzeFile）

- **FR-005**: `JavaLanguageAdapter.analyzeFile()` MUST 委托 `TreeSitterAnalyzer.analyze(filePath, 'java')` 完成 AST 解析，返回有效的 `CodeSkeleton`。
  - *关联: US-1*
- **FR-006**: `analyzeFile()` 返回的 `CodeSkeleton` 的 `language` 字段 MUST 为 `'java'`，`parserUsed` 字段 MUST 为 `'tree-sitter'`。
  - *关联: US-1*
- **FR-007**: `analyzeFile()` MUST 正确提取 Java 文件中的所有 public 类型声明（class、interface、enum、record），包括类型名、泛型参数、继承关系（extends）和接口实现（implements）。
  - *关联: US-1 Scenario 1, 2, 3*
- **FR-008**: `analyzeFile()` MUST 正确提取 Java 类的成员方法，包括方法名、参数签名、返回类型，并正确标记 static 和 abstract 修饰符。
  - *关联: US-2 Scenario 1, 2*
- **FR-009**: `analyzeFile()` MUST 正确提取 Java 类的字段声明，包括字段名、字段类型和 static 修饰符。支持单条声明中的多变量声明符（如 `int x, y;`）。
  - *关联: US-2 Scenario 2*
- **FR-010**: `analyzeFile()` MUST 正确提取 Java 类的构造器声明，包括参数签名。
  - *关联: US-2 Scenario 3*
- **FR-011**: `analyzeFile()` MUST 正确处理 Java 的可见性修饰符——默认仅在成员级别过滤 private（`includePrivate: false` 时排除 private 成员）；当 `includePrivate` 为 `true` 时，应包含所有可见性级别的成员。
  - *关联: US-2 Scenario 1*
- **FR-012**: `analyzeFile()` MUST 正确提取方法级泛型参数（如 `<T> List<T> filter(...)`），并将其包含在方法签名中。
  - *关联: US-2 Scenario 4*

#### import 依赖分析

- **FR-013**: `analyzeFile()` MUST 正确解析 Java 普通导入 `import java.util.List;` 形式，提取包路径作为 `moduleSpecifier`、类名作为 `namedImports`。
  - *关联: US-3 Scenario 1*
- **FR-014**: `analyzeFile()` MUST 正确解析 Java static 导入 `import static java.util.Collections.sort;` 形式，提取类全限定名作为 `moduleSpecifier`、成员名作为 `namedImports`。
  - *关联: US-3 Scenario 2*
- **FR-015**: `analyzeFile()` MUST 正确处理通配导入（`import java.util.*;`），将 `namedImports` 标记为 `['*']`。
  - *关联: US-3 Scenario 3*
- **FR-016**: `analyzeFile()` MUST 将所有 Java import 的 `isRelative` 标记为 `false`、`isTypeOnly` 标记为 `false`——Java 的 import 均为绝对包路径，且不区分类型导入和值导入。
  - *关联: US-3*

#### 正则降级（analyzeFallback）

- **FR-017**: `JavaLanguageAdapter.analyzeFallback()` MUST 提供降级分析能力。优先尝试 tree-sitter AST 解析；当 tree-sitter 不可用时，降级到 Java 专用正则提取。
  - *关联: US-5*
- **FR-018**: `tree-sitter-fallback.ts` 的 `regexFallback()` 函数 MUST 新增 Java 语言分支，提供 Java 专用正则降级支持，至少能识别以下 Java 语法模式：`public class <Name>`、`public interface <Name>`、`public enum <Name>`、`import <path>;`。仅提取 public 的顶层类型声明。
  - *关联: US-5 Scenario 2*

#### 术语映射（getTerminology）

- **FR-019**: `JavaLanguageAdapter.getTerminology()` MUST 返回 Java 特有的 `LanguageTerminology` 对象，其中：
  - `codeBlockLanguage` 为 `'java'`
  - `exportConcept` 描述 Java 的访问修饰符体系（"public 类和成员——通过 public/protected/private/package-private 访问修饰符控制可见性"）
  - `importConcept` 描述 Java 的 `import`（含 static import）机制
  - `typeSystemDescription` 描述 Java 的静态强类型系统（含泛型、类型擦除）
  - `interfaceConcept` 描述 Java 的 `interface`（含 default method）和 `abstract class`
  - `moduleSystem` 描述 Java 的 package/import 系统和 JPMS（Java Platform Module System）
  - *关联: US-6*

#### 测试文件模式（getTestPatterns）

- **FR-020**: `JavaLanguageAdapter.getTestPatterns()` MUST 返回 Java 社区标准的测试文件匹配模式：
  - `filePattern` 正则 MUST 匹配 `*Test.java`、`Test*.java`、`*Tests.java`、`*IT.java` 四种命名约定
  - `testDirs` MUST 包含 `src/test/java`（Maven/Gradle 标准测试目录）
  - *关联: US-7*

#### 默认忽略目录

- **FR-021**: `JavaLanguageAdapter.defaultIgnoreDirs` MUST 包含以下 Java 生态特有的目录：`target`（Maven 构建输出）、`build`（Gradle 构建输出）、`out`（IntelliJ 编译输出）、`.gradle`（Gradle 缓存）。
  - *关联: US-8*
- **FR-022**: `JavaLanguageAdapter.defaultIgnoreDirs` SHOULD 额外包含 `.idea`（IntelliJ 项目配置）、`.settings`（Eclipse 项目配置）和 `.mvn`（Maven Wrapper 目录）。[AUTO-CLARIFIED: CL-003]
  - *关联: US-8*

#### 注册与集成

- **FR-023**: `JavaLanguageAdapter` MUST 在 `bootstrapAdapters()` 函数中被注册到 `LanguageAdapterRegistry`，使 `.java` 文件能通过 Registry 自动路由到该适配器。
  - *关联: US-4*
- **FR-024**: 注册 `JavaLanguageAdapter` MUST NOT 与 `TsJsLanguageAdapter`、`PythonLanguageAdapter` 或 `GoLanguageAdapter` 产生扩展名冲突——Java 的 `.java` 扩展名与其他语言无重叠。
  - *关联: US-4*
- **FR-025**: 注册 `JavaLanguageAdapter` 后，`file-scanner` MUST 能自动扫描到 `.java` 文件，且 `target`、`build`、`out`、`.gradle` 等 Java 忽略目录被自动排除。
  - *关联: US-4 Scenario 2, US-8*

#### 依赖图构建（可选能力）

- **FR-026**: `JavaLanguageAdapter` MAY 实现 `buildDependencyGraph()` 方法。初始版本可不实现此方法。
  - *关联: US-3*

#### 零回归约束

- **FR-027**: 注册 `JavaLanguageAdapter` MUST NOT 影响现有 TS/JS、Python 和 Go 文件的分析行为——对任何纯 TS/JS、Python 或 Go 项目运行 reverse-spec 的任意命令，其输出与注册前完全一致。
  - *关联: 全局约束*
- **FR-028**: 本 Feature MUST NOT 引入任何新的运行时依赖——JavaLanguageAdapter 仅使用 Feature 025/027 已引入的基础设施。
  - *关联: 全局约束*

### Key Entities

- **JavaLanguageAdapter**: Java 语言适配器。实现 LanguageAdapter 接口，作为 reverse-spec 对 Java 源文件进行代码分析的入口。通过委托 TreeSitterAnalyzer（主解析）和正则表达式（降级）完成文件分析，并提供 Java 特有的术语映射、测试文件模式和忽略目录配置。注册到 LanguageAdapterRegistry 后，`.java` 文件自动路由到此适配器。
- **JavaMapper**（已有）: Java 的 tree-sitter AST 到 CodeSkeleton 映射器。从 AST 中提取 class/interface/enum/record 声明、方法声明、字段声明、构造器声明、import 声明和注解信息，并正确处理 public/protected/private/package-private 可见性修饰符。已在 Feature 027 中实现（482 行），JavaLanguageAdapter 通过 TreeSitterAnalyzer 间接使用。
- **TreeSitterAnalyzer**（已有）: 多语言 tree-sitter 解析入口。已支持 Java AST 解析（包含 JavaMapper 注册和 Java grammar 加载）。JavaLanguageAdapter 的 `analyzeFile()` 委托此组件完成实际解析。
- **LanguageAdapterRegistry**（已有）: 适配器注册中心。JavaLanguageAdapter 通过 `bootstrapAdapters()` 注册到此 Registry，使流水线各环节能按文件扩展名路由到正确的适配器。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对一个标准 Java 项目（包含至少 5 个 `.java` 文件、涵盖 class/interface/enum/record/method/field/constructor/import/annotation）运行 `reverse-spec generate`，成功生成完整 spec，不报错。
- **SC-002**: Java 的访问修饰符被正确处理——public 类型出现在导出列表中，private 成员在 `includePrivate: false` 时不出现，所有可见性级别的成员在 `includePrivate: true` 时均出现。
- **SC-003**: Java 泛型信息被完整保留——泛型类的签名包含类型参数和约束（如 `<T extends Serializable>`），泛型方法的签名包含方法级类型参数。
- **SC-004**: 现有全部测试套件在 Feature 完成后 100% 通过——注册 JavaLanguageAdapter 不引入任何现有功能的回归。
- **SC-005**: 新增 JavaLanguageAdapter 仅需一个新源文件（适配器实现）+ 修改 `bootstrapAdapters()` 注册代码 + `tree-sitter-fallback.ts` 新增 Java 正则降级——不需修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts` 或任何核心流水线文件。
- **SC-006**: JavaLanguageAdapter 的单元测试覆盖所有 Functional Requirements 中 MUST 级别的需求，测试数量不少于 15 个。
- **SC-007**: `getTestPatterns().filePattern` 对 `UserServiceTest.java`、`TestUserService.java`、`UserServiceTests.java`、`UserServiceIT.java` 返回匹配，对 `UserService.java`、`Main.java` 返回不匹配——测试文件识别准确率 100%。

---

## Clarifications

### Session 2026-03-17

#### CL-001: Java 正则降级是否需要提取 `record` 声明 [AUTO-CLARIFIED: 不包含 — 降级模式以最小可用为原则]

**上下文**: FR-018 列出 Java 正则降级需识别 `public class`、`public interface`、`public enum`、`import` 四种模式，但 FR-007 在 tree-sitter 模式下还要求支持 `record` 类型（Java 16+）。正则降级模式是否需要覆盖 `record`。

**决策**: 正则降级不要求提取 `record`。理由：(1) 降级模式的目标是提供"基本可用"的结构信息，`record` 是 Java 16+ 的较新语法，在降级场景下不属于核心需求；(2) Python/Go 的正则降级也仅覆盖最常见的语法模式，不追求完整性；(3) FR-018 的 MUST 级别要求已明确列出四种模式，不含 `record`。若未来需要可作为增量增强。

#### CL-002: `getTestPatterns().filePattern` 匹配目标是文件名还是全路径 [AUTO-CLARIFIED: 仅匹配文件名 — 与 Go/Python 适配器的实际使用方式对齐]

**上下文**: US-7 的测试示例使用纯文件名（如 `UserServiceTest.java`），但 Go 适配器的 `filePattern` 为 `^.*_test\.go$`（能匹配含路径的字符串）。需明确 Java `filePattern` 的匹配范围。

**决策**: Java 的 `filePattern` 应设计为能同时匹配纯文件名和含路径的字符串（与 Go 适配器一致使用 `^.*` 前缀），如 `/^(.*Test|Test.*|.*Tests|.*IT)\.java$/`。这样无论调用方传入文件名还是全路径都能正确匹配。SC-007 的验证用例使用纯文件名，正则设计需兼容两种输入。

#### CL-003: `defaultIgnoreDirs` 是否应包含 `.mvn` 目录 [AUTO-CLARIFIED: 包含 — 与 `.gradle` 同理，属于构建工具包装器目录]

**上下文**: FR-021 列出 `target`、`build`、`out`、`.gradle`，FR-022 列出 `.idea`、`.settings`。`.mvn`（Maven Wrapper 目录）也是 Java 生态中常见的非源码目录，与 `.gradle` 性质类似。

**决策**: 将 `.mvn` 加入 FR-022 的 SHOULD 级别推荐目录列表中。理由：`.mvn` 包含 Maven Wrapper 配置和下载的 jar 文件，不属于用户源码。与 `.gradle` 同理但使用频率略低，故放在 SHOULD 而非 MUST 级别。

#### CL-004: `extensions` 是否应仅包含 `.java` [AUTO-CLARIFIED: 仅 `.java` — Java 没有其他标准源文件扩展名]

**上下文**: Python 适配器支持 `.py` 和 `.pyi`（类型存根），Go 适配器仅支持 `.go`。Java 是否有类似的额外扩展名需要支持。

**决策**: 仅支持 `.java`。理由：Java 生态中不存在类似 `.pyi` 的类型存根扩展名。`.jav` 等非标准扩展名在实际项目中极为罕见，不值得支持。`module-info.java` 使用的也是 `.java` 扩展名。与 FR-004 一致。
