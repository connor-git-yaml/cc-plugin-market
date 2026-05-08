---
feature: "Feature 154 — 给 Java LanguageAdapter 添加 callSites 字段"
branch: "154-java-callsites"
created: "2026-05-08"
status: Draft
mode: story
parent_feature: "Feature 151 — UnifiedGraph 框架（已 ship）"
parallel_features: "152, 153, 155, 156"
---

# Feature Specification: 给 Java LanguageAdapter 添加 callSites 字段

**Feature Branch**: `154-java-callsites`
**创建日期**: 2026-05-08
**状态**: Draft
**模式**: story（无调研阶段，直接基于代码上下文）

## 背景

Feature 151（commit 761488f）已在 UnifiedGraph 框架中完整建立了 Python callSites 抽取链路：`CallSite` schema（`src/models/call-site.ts`）、`TreeSitterAnalyzer` 的 `extractCallSites` flag 透传机制、以及 Python `extractCallSites` 参考实现。

Java LanguageAdapter 目前仅实现了 `extractExports` / `extractImports` / `extractParseErrors`，缺少 `extractCallSites`，导致 Java 项目在 UnifiedGraph 中无法建立调用边，图的完整性受损。本 Feature 是 design doc "150d java" 的独立实现单元，与 152/153/155/156 完全并行，不依赖其他 Feature 完成。

## User Scenarios & Testing

### User Story 1 — 核心 callSites 抽取：method 调用与构造器 (Priority: P1)

作为 Spectra 用户，当我对一个 Java 项目运行分析时，我希望分析结果中包含 Java 方法调用信息（实例方法调用、静态方法调用、构造器调用、显式构造器调用 super()/this()），以便 UnifiedGraph 能够为 Java 代码生成有效的调用边。

**Why this priority**: callSites 的核心价值在于调用图。没有 method_invocation 和 object_creation_expression 的抽取，Java 文件的调用边就完全缺失，是功能空白而非降级。这是本 Feature 的最小可交付单元。

**Independent Test**: 可以仅实现 method 调用和构造器调用的单测（跳过 lambda/反射），通过 `JavaMapper.extractCallSites` 在一段 Java 代码片段上验证输出的 `CallSite[]` 数组，并确认 `calleeName`、`calleeKind`（必须是 `CalleeKindSchema` 合法值）、`line`、`callerContext`、`calleeQualifier` 均正确填充。

**Acceptance Scenarios**:

1. **Given** 一段包含 `obj.method()` 的 Java 源码，**When** 调用 `JavaMapper.extractCallSites`，**Then** 输出包含 `calleeKind: "cross-module"`、`calleeQualifier: "obj"`、正确的 `calleeName`、`line` 和 `callerContext`（当前方法名）。

2. **Given** 一段包含 `ClassName.staticMethod()` 的 Java 源码（receiver 为 PascalCase 标识符或 FQN），**When** 调用 `JavaMapper.extractCallSites`，**Then** 输出包含 `calleeKind: "member"` 和 `calleeQualifier: "ClassName"`（与 Python mapper 的 PascalCase Class.method 处理对齐）。

3. **Given** 一段包含 `new HikariDataSource(config)` 的 Java 源码，**When** 调用 `JavaMapper.extractCallSites`，**Then** 输出包含 `calleeKind: "member"`、`calleeName: "HikariDataSource"`、`calleeQualifier: "HikariDataSource"`（构造器视为该 class 的特殊 member 调用）。

4. **Given** 一段包含 `super.close()` 和 `super()` 的 Java 源码，**When** 调用 `JavaMapper.extractCallSites`，**Then** 输出的对应条目 `calleeKind` 为 `"super"`。

5. **Given** 一个 Java 文件中有嵌套类（nested class）或接口 default method 的调用，**When** 调用 `JavaMapper.extractCallSites`，**Then** `callerContext` 反映**最近一层** enclosing class/interface 名 + 方法名（如 `"InnerClass.methodName"`，与 truth-set 抽取器 `_findEnclosingTypeName` 行为一致），不输出多层嵌套路径。

---

### User Story 2 — 边界场景：lambda 调用、反射调用与 method overloading (Priority: P2)

作为 Spectra 用户，当被分析的 Java 项目使用了 lambda 表达式、反射调用（JMX/动态加载）或同名方法重载时，我希望分析结果能正确区分这些调用类型，而不是丢弃或误标，以便调用图在复杂 Java 代码库（如 HikariCP）中具有足够的召回率。

**Why this priority**: HikariCP 内部大量使用 lambda 作为 callback 传入线程池、并有 JMX 相关的反射调用。这些边界场景不处理会导致 recall < 30% 目标难以达成，但不阻塞 P1 的核心抽取。

**Independent Test**: 可以为 lambda、反射、overloading 各写独立单测，通过构造包含对应模式的 Java 代码片段，在不依赖 HikariCP baseline 的情况下验证 `calleeKind` 映射和 `callerContext` 追踪逻辑是否正确。

**Acceptance Scenarios**:

1. **Given** 一段 Java 代码中包含 `executor.submit(() -> pool.getConnection())`，**When** 调用 `JavaMapper.extractCallSites`，**Then** lambda body 内部的调用（`pool.getConnection()`）被独立抽取，且 `callerContext` 标记 lambda 的位置（格式 `"<lambda:行号:列号>"`，与 truth-set extractor 的 `_resolveJavaCaller` 输出对齐）。

2. **Given** 一段代码包含 `Class.forName("com.zaxxer.hikari.HikariDataSource")`，**When** 调用 `JavaMapper.extractCallSites`，**Then** 输出 `calleeKind: "unresolved"` 且 `calleeName: "forName"`。

3. **Given** 一段代码包含 `method.invoke(obj, args)` 或 `constructor.newInstance()` 或 `clazz.getDeclaredConstructor()`，**When** 调用 `JavaMapper.extractCallSites`，**Then** 对应条目 `calleeKind` 为 `"unresolved"`。

4. **Given** 一个类中有两个同名但参数不同的 `connect(String url)` 和 `connect(Properties props)` 方法，并在同一调用点调用 `connect(url)`，**When** 调用 `JavaMapper.extractCallSites`，**Then** 输出的 `calleeName` 为 `"connect"`（label-only 静态选择，不做签名解析），不重复抽取、不丢失。

5. **Given** 一段包含 `Collections.sort(list, (a, b) -> a.compareTo(b))` 的代码，**When** 调用 `JavaMapper.extractCallSites`，**Then** `Collections.sort` 被抽取为 `calleeKind: "member"` + `calleeQualifier: "Collections"`，同时 lambda 内部的 `a.compareTo(b)` 也被抽取且 `callerContext` 包含 lambda 标记。

---

### User Story 3 — 透传集成与端到端验收（E2E Story） (Priority: P3)

作为 Spectra 开发者，我希望 `JavaLanguageAdapter.analyzeFile` 能够透传 `extractCallSites` flag，并通过在 HikariCP 项目上运行 `scripts/verify-feature-154.mjs` 脚本，一键验证 fillRate（按下文 SC-001 重新定义的分母）、callSites label-only precision/recall（按 SC-002 定义），以便在 CI 环境中或本地快速确认 Java callSites 功能达到质量基线。

**Why this priority**: 这是一个明确的 E2E（end-to-end）Story —— 它**依赖** P1 和 P2 的 mapper 实现完成后才能验证。本 Story 不是 INVEST 意义上的 fully independent，而是封装两个前置 Story 成果的最终交付层。Story 内部的"透传链路通畅"测试可以在不依赖 HikariCP baseline 的情况下独立做。

**Independent Test (partial)**: 仅 adapter 透传逻辑可独立测试 —— 单独验证 `JavaLanguageAdapter.analyzeFile({ extractCallSites: true })` 返回的 `CodeSkeleton.callSites` 字段类型和非空性，无需依赖 HikariCP。HikariCP baseline 达标本身是 P1 + P2 实现完整后才能跑的 E2E 验收。

**Acceptance Scenarios**:

1. **Given** `JavaLanguageAdapter` 收到 `options.extractCallSites = true`，**When** 分析一个非空 `.java` 文件（含至少一个 method_invocation），**Then** 返回的 `CodeSkeleton.callSites` 为非空数组（不是 undefined/null）。

2. **Given** `JavaLanguageAdapter` 收到 `options.extractCallSites = false`（默认值），**When** 分析任意 `.java` 文件，**Then** 返回的 `CodeSkeleton.callSites` 为 undefined 或空数组（与 Python 行为对齐）。

3. **Given** `scripts/verify-feature-154.mjs` 在已 build 的产物上执行，**When** 指向 HikariCP `src/main` 目录，**Then** 脚本输出 fillRate（按 SC-001 定义）、precision、recall（按 SC-002 定义），各指标全部达标时脚本以 exit code 0 退出，否则非零。

4. **Given** 现有 vitest 全集在同一 commit 上执行，**When** 运行 `npx vitest run`，**Then** 全集零失败、无回归（不固定具体测试数量，由实际仓库状态决定）。

---

### Edge Cases

以下边界场景需在实现和单测中明确覆盖：

- **Phantom call / ERROR / MISSING 节点**：tree-sitter 在语法错误处会插入 `ERROR` 或 `MISSING` 节点。本 Feature 的处理规则（与 truth-set extractor `_walkJavaAst` 对齐）：(a) `ERROR` 类型节点本身和其整个子树跳过，**不 walk 子节点**；(b) `isMissing === true` 节点同样跳过子树；(c) 非 ERROR 节点但被判定为 phantom call（callee 子树 hasError 或 sibling 含 ERROR/MISSING）时，**仅跳过当前 call 节点的抽取**，但继续 walk 其 children。对应 FR-007。

- **大文件兜底（> 1 MB）**：超过 1 MB 的 `.java` 文件跳过 callSites 抽取，返回空数组并记录 warn 日志（与 Python 实现的 `CALLSITES_MAX_FILE_BYTES` 机制对齐）。对应 FR-006。

- **嵌套 lambda**：lambda 内部再嵌套 lambda（如 `stream.map(x -> x.stream().filter(y -> y.check()))`），每层 lambda 作为独立的 callerContext 层叠，内部调用的 `callerContext` 反映**最近的** enclosing lambda 位置（`<lambda:行:列>`），而非外层 method 名（与 truth-set extractor `_resolveJavaCaller` 嵌套优先策略对齐）。

- **Java 14+ record 类型的 compact constructor**：`record Point(int x, int y) { Point { /* validation */ } }` 中 compact_constructor_declaration 内的方法调用，`callerContext` 标记为 `"Point.<init>"`（与 truth-set extractor 对 `compact_constructor_declaration` 的 `<init>` 归一化对齐）。

- **匿名类（anonymous class）**：`new Runnable() { public void run() { obj.method(); } }` 的匿名类内部调用，`callerContext` 标记 enclosing class 为 `<anon-class>` + 方法名，与 truth-set extractor 行为一致。

- **Static import 命名冲突**：`import static java.util.Collections.sort` 后直接调用 `sort(list)`，此时 method_invocation 节点没有 `object` 字段，`calleeKind` 为 `"free"`（与 Python 中的 free function 调用语义对齐），`calleeQualifier` 为 undefined。

- **PascalCase + 首字母缩写白名单**（URL、UUID、XML、JSON、HTTP、API、JDBC 等，与 java-call-extractor.mjs `JAVA_ACRONYM_TYPE_NAMES` 集合对齐）：`URLConnection.openConnection()` 的 receiver `URLConnection` 识别为 PascalCase 类型标识符，判定为 `calleeKind: "member"` + `calleeQualifier: "URLConnection"`（与 Python mapper PascalCase Class.method 处理一致）。

- **FQN 调用（fully qualified name）**：`com.zaxxer.hikari.HikariDataSource.getConnection()` 形式，receiver 链 leftmost 在 `JAVA_PACKAGE_ROOT_NAMES`（java/javax/com/org 等）+ 中间层全 lowercase + 末尾段是 PascalCase 类名时，判定为 `calleeKind: "member"`，`calleeQualifier` 取**末尾类名**（不是完整 FQN）。

- **interface default method 调用**：通过接口引用调用 default 方法时（`Connection conn = ...; conn.close()`），与普通 instance method 调用相同，判定为 `calleeKind: "cross-module"` + `calleeQualifier: "conn"`，无需特殊处理。当一个 interface 的 default method 内部含调用时，`callerContext` 反映 interface 名 + 方法名（如 `"Closeable.close"`），与 class.method 同等处理。

- **Method reference 不在范围**（Java 8+ `obj::method` / `Type::staticMethod`）：本 Feature 不抽取 `method_reference` 节点（truth-set extractor 同样不抽取），从而 SC-002 metric 不衡量此类调用。HikariCP 中存在但被一致地排除在双侧之外，不影响 precision/recall 比较。

- **Generic method invocation**（`<T>foo()` / `Class.<T>staticCall()`）：tree-sitter 仍解析为 `method_invocation`，多出 `type_arguments` 字段。本 Feature 忽略 `type_arguments`，按普通 method_invocation 处理，`calleeName` 为 erased label。

- **Try-with-resources 隐式 close()**：本 Feature 不合成隐式调用，仅抽取源码中**显式书写**的 method_invocation / object_creation_expression / explicit_constructor_invocation 节点。`try (Resource r = ...)` 的 initializer 表达式照常抽，但 JVM 自动调用的 `close()` 不在 callSites 中。

## Requirements

### Functional Requirements

- **FR-001**: `JavaMapper` MUST 实现 `extractCallSites(tree, source)` 方法，抽取以下四类 Java AST 节点中的调用：`method_invocation`、`object_creation_expression`、`explicit_constructor_invocation`（`super(...)` / `this(...)`）、`lambda_expression` 内部的调用。 `[必须]`

- **FR-002**: `JavaMapper.extractCallSites` MUST 输出严格符合 `src/models/call-site.ts` 中 `CallSiteSchema` 的对象数组，每个条目必须包含 `calleeName`（string）、`calleeKind`（CalleeKind enum）、`line`（1-based integer），并按需填充 `column`、`callerContext`、`calleeQualifier`。 `[必须]`

- **FR-003**: `JavaMapper.extractCallSites` MUST 严格按以下表将 Java AST 节点映射到合法的 `CalleeKind` 值（schema 仅允许 `{free, member, cross-module, dunder, super, decorator, unresolved}`）：

  | Java AST 形态 | calleeKind | calleeName | calleeQualifier | 备注 |
  |--------------|------------|------------|-----------------|------|
  | `super.method()` / `super(...)` / `this(...)` | `super` | 方法名 / `super` / `this` | undefined | 显式 super/this 链 |
  | 反射方法名（见 FR-005 集合） | `unresolved` | 方法名 | undefined | 短路于 receiver 检查之前 |
  | `object_creation_expression`（`new ClassName(...)`）| `member` | ClassName（normalize 末段） | ClassName | 构造器视为 class 的特殊 member |
  | `method_invocation`，receiver 为 `type_identifier` / `scoped_type_identifier` / PascalCase identifier / acronym 白名单 / FQN 包路径末段 PascalCase | `member` | 方法名 | receiver 末段类名 | 静态方法调用与 PascalCase Class.method（与 Python mapper 处理一致）|
  | `method_invocation`，receiver 为非 PascalCase identifier（小写变量名）或其他表达式 | `cross-module` | 方法名 | receiver 文本（identifier 时） | 实例方法调用，calleeQualifier 帮助 resolver lookup |
  | `method_invocation`，无 receiver / receiver 为 `this` | `member` | 方法名 | undefined | this.method() / 静态导入展开的裸调用看 caller 类自身（callerContext 兜底）|
  | `method_invocation`，无 receiver 且 callerContext 内无对应 method（裸 free function） | `free` | 方法名 | undefined | static import 展开后的 free function 调用 |

  当**多条规则同时命中**时，按表的从上到下顺序优先（super > 反射 > 构造器 > static / PascalCase member > instance cross-module > this/free）。 `[必须]`

- **FR-004**: `JavaLanguageAdapter.analyzeFile` MUST 将 `options?.extractCallSites` 透传给 `TreeSitterAnalyzer.analyze`，默认值为 `false`（与 Python adapter 的透传方式保持一致）。 `[必须]`

- **FR-005**: `JavaMapper.extractCallSites` MUST 将以下反射调用标识符识别为 `calleeKind: "unresolved"`，集合**必须与 `scripts/lib/java-call-extractor.mjs` 中的 `REFLECTION_METHOD_NAMES` 常量保持完全一致**：`forName`、`invoke`、`newInstance`、`getDeclaredMethod`、`getMethod`、`getDeclaredField`、`getField`、`getConstructor`、`getDeclaredConstructor`、`getConstructors`、`getDeclaredConstructors`、`newProxyInstance`。实现时建议直接将 mapper 内的常量与 extractor 常量保持同源（如重新 export，或在测试中校验两者集合相等），任一侧扩展时另一侧同步。 `[必须]`

- **FR-006**: `JavaMapper.extractCallSites` MUST 在源码字节数超过 1 MB（1,048,576 字节）时提前返回空数组，并输出 warn 级别日志（与 Python mapper 的 `CALLSITES_MAX_FILE_BYTES` 兜底机制保持一致）。 `[必须]`

- **FR-007**: `JavaMapper.extractCallSites` MUST 处理 tree-sitter parse error，规则与 `scripts/lib/java-call-extractor.mjs` 的 `_walkJavaAst` 严格一致：(a) 节点 `type === 'ERROR'` 时整个子树跳过、不 walk children；(b) 节点 `isMissing === true` 时同样跳过子树；(c) 非 ERROR 的 method_invocation / object_creation_expression / explicit_constructor_invocation 节点，若被 `_isPhantomCall` 判定为 phantom（关键字段 hasError 或 sibling 含 ERROR/MISSING），**仅跳过当前 call 的抽取**，但仍继续 walk 其 children（保护内层真实调用不被误杀）。这样语法错误的局部影响不会扩散到整个文件，但也不会产生 phantom callSite 污染 truth-set 比对。 `[必须]`

- **FR-008**: `JavaMapper.extractCallSites` MUST 维护调用者上下文（callerContext），与 `scripts/lib/java-call-extractor.mjs` 的 `_resolveJavaCaller` 嵌套优先策略对齐：从调用点向上找**最近一层** function-like scope（method_declaration / constructor_declaration / compact_constructor_declaration / lambda_expression），按以下表填 `callerContext`：

  | enclosing scope | callerContext |
  |-----------------|---------------|
  | `method_declaration` 内 | `{TypeName}.{methodName}`（取**最近**类/接口/枚举/记录名，不输出多层嵌套路径） |
  | `constructor_declaration` 内 | `{TypeName}.<init>` |
  | `compact_constructor_declaration` 内（Java 14+ record） | `{TypeName}.<init>` |
  | `lambda_expression` 内 | `<lambda:行:列>`（行列基于 lambda 节点起始位置，唯一化嵌套 lambda） |
  | enclosing 是 `object_creation_expression` 匿名类 method | `<anon-class>.{methodName}` |
  | 顶层（无 enclosing scope）| `<top-level>` |

  interface default method 的 callerContext 与普通 method_declaration 同处理（`{InterfaceName}.{methodName}`）。 `[必须]`

- **FR-009**: `JavaMapper.extractCallSites` MUST 正确处理 Java 14+ `record` 类型的 `compact_constructor_declaration` 节点，将其内部的调用纳入抽取范围，`callerContext` 反映 record 类名和构造器标识。 `[必须]`

- **FR-010**: `JavaMapper.extractCallSites` MUST 为 lambda 表达式内部的调用生成唯一化的 `callerContext`，格式 `<lambda:行:列>`，行列取自 lambda_expression 节点的 startPosition。同一方法中多个 lambda 因起始位置不同而 callerContext 不同，避免碰撞。 `[必须]`

- **FR-011**: 新增的 Java callSites 抽取逻辑 MUST NOT 修改除 `src/adapters/java-adapter.ts` 和 `src/core/query-mappers/java-mapper.ts` 之外的源代码文件，**包括但不限于**：其它 adapter、mapper、call-resolver、unified-graph schema、CallSite schema（`src/models/call-site.ts`）。本 Feature 严格遵守现有 `CalleeKindSchema` 的合法值集合，不扩展 enum。verify 脚本（`scripts/verify-feature-154.mjs`）和单测属于新增文件，不在此约束内。 `[必须]`

- **FR-012**: `scripts/verify-feature-154.mjs` MUST 实现独立的端到端验收脚本，加载 `dist/` build 产物，对 HikariCP `src/main` 下的 `.java` 文件执行 `analyzeFile({ extractCallSites: true })`，计算并输出 `fillRate`（callSites 非空文件比例）、`precision`（与 truth-set 对比的精确率）、`recall`（与 truth-set 对比的召回率），最终以 exit code 0（达标）或非零（未达标）退出。 `[必须]`

- **FR-013**: `scripts/verify-feature-154.mjs` MUST 在运行时调用 `scripts/lib/java-call-extractor.mjs` 自动重生成 HikariCP truth-set，而非依赖仓库中预先存储的 `tests/baseline/HikariCP/truth-set.json`（truth-set 不入库，每次运行重生，参照 CLAUDE.local.md 约定）。 `[必须]`

### Key Entities

- **CallSite**（已存在，`src/models/call-site.ts`）：表示一次函数/方法调用的结构化记录，关键字段：`calleeName`（被调用方名称）、`calleeKind`（CalleeKind 枚举，表示调用类型）、`line`（调用发生的行号，1-based）、`column`（可选，列号）、`callerContext`（可选，调用方的类/方法路径字符串）、`calleeQualifier`（可选，receiver 名称，用于 member/static 调用的来源标注）。

- **JavaMapper**（`src/core/query-mappers/java-mapper.ts`）：Java 语言的 tree-sitter AST 查询器，目前实现了 `extractExports`/`extractImports`/`extractParseErrors`，本 Feature 新增 `extractCallSites(tree, source)` 方法。

- **JavaLanguageAdapter**（`src/adapters/java-adapter.ts`）：Java 语言适配器，封装 `TreeSitterAnalyzer.analyze` 并暴露 `analyzeFile` 接口，本 Feature 新增对 `extractCallSites` flag 的透传。

- **Java AST 关键节点**（tree-sitter Java grammar）：
  - `method_invocation`：实例/static 方法调用，含 receiver（`object`）、方法名（`name`）、参数列表
  - `object_creation_expression`：构造器调用（`new ClassName()`）
  - `explicit_constructor_invocation`：显式构造器链（`super(...)` / `this(...)`）
  - `lambda_expression`：lambda 表达式节点，作为独立 callerContext 层

- **HikariCP truth-set**（运行时生成，`tests/baseline/HikariCP/truth-set.json`）：由 `scripts/lib/java-call-extractor.mjs` 从 `~/.spectra-baselines/HikariCP/` 抽取生成的 ground truth 调用集，用于计算 precision/recall。不入库，每次 verify 时重生。

- **java-call-extractor.mjs**（`scripts/lib/java-call-extractor.mjs`）：已有完整的 Java 调用抽取规则参考实现，包含 kind 映射、PascalCase 白名单、FQN 识别等逻辑，本 Feature 的 JavaMapper 实现须与之的分类逻辑保持语义对齐。

## Success Criteria

### Measurable Outcomes

- **SC-001**: `callSites` 填充率（fillRate）≥ 95% —— 分母为 **truth-set 中真实存在调用的文件**（即 `truthFilesWithCalls`，由 `java-call-extractor.mjs` 在 HikariCP `src/main` 上运行后给出，本地实测 ≈ 39 个文件），分子为 mapper 输出 `CodeSkeleton.callSites.length > 0` 且 truth-set 也认为该文件应有调用的文件数。空接口 / 纯常量 / 纯 import-only 文件不进分母（与 truth-set 行为对齐）。

- **SC-002**: callSites label-only 精确率（precision）≥ 70%，召回率（recall）≥ 30% —— 比对范围为 `JavaMapper.extractCallSites` 直接输出的 callSite 集合 vs `java-call-extractor.mjs` 运行时重生成的 HikariCP truth-set，比对方式为 **label-only**（`(file, callerLabel, calleeName)` 三元组是否在双侧均存在），不经过 call-resolver、不衡量 UnifiedGraph calls 边。N=3 次重测取中位数。**注**：本 SC 只衡量 mapper 输出质量，下游 call-resolver / UnifiedGraph 的 calls 边质量不在 154 Feature 范围（resolver 侧 Java 适配是后续 Feature 的工作）。

- **SC-003**: 新增单测 ≥ 7 个，覆盖以下场景（每条至少一个 test case）：(1) 实例 method call (`obj.method()` → cross-module + qualifier)、(2) method overloading 在同一调用点的 label-only 静态选择、(3) static / PascalCase Class.method (`List.of()` → member + qualifier)、(4) interface default method 调用与 enclosing interface 的 callerContext、(5) lambda 内部调用与 `<lambda:行:列>` callerContext 嵌套优先、(6) 反射调用 (`Class.forName` / `clazz.getDeclaredConstructor` 等) → unresolved、(7) callerContext 嵌套追踪（含 record compact_constructor + nested class 最近一层归属）、(8) generic method invocation（`<T>foo()` / `Class.<T>method()`）。所有新增单测在不依赖外部 baseline 的情况下独立执行。

- **SC-004**: `npx vitest run` 全集**零失败**、无回归（不固定具体测试数量；测试总数随并行 Feature 自然变化，由仓库当前实际状态决定）。

- **SC-005**: `scripts/verify-feature-154.mjs` 独立可执行 —— 在已完成 `npm run build` 后，脚本支持 `--target ~/.spectra-baselines/HikariCP/src/main` 参数，输出包含 fillRate（按 SC-001 定义的分母）、precision、recall（按 SC-002 定义）的 JSON 汇总，并以 exit code 表示是否达标（达标 0、未达 1）。脚本本身不重新实现 mapper 或 truth-set 抽取逻辑，仅串联 `JavaMapper.extractCallSites` + `java-call-extractor.mjs` + label-only 比对算法。

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 |
|------|-----|
| 组件总数（新增） | 2（`JavaMapper.extractCallSites` 方法 + `verify-feature-154.mjs` 脚本） |
| 接口数量（新增/修改） | 2（`JavaMapper` 新增 `extractCallSites`，`JavaLanguageAdapter.analyzeFile` 修改透传） |
| 依赖新引入数 | 0（tree-sitter Java grammar 已存在，`CallSiteSchema` 已存在） |
| 跨模块耦合 | 否（仅改 java-adapter + java-mapper，不触碰其他 adapter/mapper） |
| 复杂度信号 | 1 个：callerContext 嵌套栈为有状态的树遍历（类似状态机），需维护进入/退出类/方法/lambda 的堆栈 |
| **总体复杂度** | **MEDIUM** |

复杂度判定说明：组件总数 < 3，接口修改 < 4，存在 1 个复杂度信号（嵌套 callerContext 栈），判定为 MEDIUM。无需强制人工审查，但建议在实现阶段对 callerContext 栈逻辑做专项代码 review（尤其是 lambda 嵌套和 anonymous class 的出栈时机）。
