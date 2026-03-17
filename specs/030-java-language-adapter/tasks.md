# Tasks: Java LanguageAdapter 实现

**Feature**: 030-java-language-adapter
**Input**: specs/030-java-language-adapter/ (plan.md, spec.md, data-model.md, contracts/)
**Generated**: 2026-03-17
**Total**: 18 个任务，覆盖 8 个 User Stories，61% 可并行

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[USN]**: 所属 User Story（US1 ~ US8）
- 每个任务包含精确的文件路径

---

## Phase 1: Setup

**Purpose**: 无需额外初始化。项目结构、TypeScript 配置、Vitest 框架均已就绪。Java 测试 fixture 已在 Feature 027 中创建（`tests/fixtures/multilang/java/`）。本 Feature 直接进入 Foundational 阶段。

> Phase 1 跳过（零 Setup 任务）。

---

## Phase 2: Foundational (Java 适配器核心实现)

**Purpose**: 创建 JavaLanguageAdapter 源文件并注册到 bootstrapAdapters()。这两个任务是所有 User Story 测试的前置依赖。

- [ ] T001 创建 `src/adapters/java-adapter.ts` -- JavaLanguageAdapter 类实现（~90 行）。包含：id/languages/extensions/defaultIgnoreDirs 静态属性、analyzeFile() 委托 TreeSitterAnalyzer、analyzeFallback() 委托 tree-sitter-fallback、getTerminology() 返回 Java 术语映射、getTestPatterns() 返回测试文件模式。完全遵循 GoLanguageAdapter 的委托模式。
- [ ] T002 修改 `src/adapters/index.ts` -- 新增 JavaLanguageAdapter 的导入、导出和 bootstrapAdapters() 注册（+4 行）。将注释 `// registry.register(new JavaLanguageAdapter());` 替换为实际注册代码。

**Checkpoint**: JavaLanguageAdapter 已可用，`.java` 文件通过 Registry 自动路由到该适配器。

---

## Phase 3: User Story 4 -- Java 文件自动路由到正确适配器 (Priority: P1)

**Goal**: 验证 `.java` 文件能通过 LanguageAdapterRegistry 自动路由到 JavaLanguageAdapter，不与其他适配器冲突。

**Independent Test**: 调用 `registry.getAdapter('Example.java')` 返回 JavaLanguageAdapter 实例；确认 TS/JS、Python、Go 适配器路由不受影响。

### Tests

- [ ] T003 [P] [US4] 新增 `tests/adapters/java-adapter.test.ts` -- 静态属性与 Registry 集成测试部分（~80 行）。包含：id/languages/extensions/defaultIgnoreDirs 属性断言、LanguageAdapter 接口方法签名检查、Registry.getAdapter('Example.java') 路由验证、与 TS/JS/Python/Go 无冲突验证、getDefaultIgnoreDirs() 合集包含 Java 目录验证。覆盖 FR-001~FR-004, FR-023~FR-025。

---

## Phase 4: User Story 1 -- Java 项目的 spec 生成 (Priority: P1)

**Goal**: 对标准 Java 项目运行 `reverse-spec generate`，生成完整的功能规范文档，包含准确的类签名、泛型、继承关系和接口实现信息。

**Independent Test**: 对包含 class/interface/enum/record/泛型/abstract 的 Java fixture 文件调用 `analyzeFile()`，验证 CodeSkeleton 的 exports 包含完整结构信息。

### Tests

- [ ] T004 [P] [US1] 扩展 `tests/adapters/java-adapter.test.ts` -- analyzeFile() 类型声明提取测试（~60 行）。包含：Basic.java 提取 class/interface/enum 验证、Generics.java 泛型参数和约束验证、Record.java record 识别为 data_class 验证、Modifiers.java abstract 修饰符验证、CodeSkeleton 的 language='java' 和 parserUsed='tree-sitter' 验证。覆盖 FR-005~FR-007。

---

## Phase 5: User Story 2 -- Java 类成员的完整提取 (Priority: P1)

**Goal**: 验证 analyzeFile() 能准确提取 Java 类的方法（含 static）、字段（含 static）、构造器，并正确处理可见性修饰符。

**Independent Test**: 对包含多种成员类型的 Java fixture 文件进行分析，验证 members 数组中每种成员的名称、类型和修饰符。

### Tests

- [ ] T005 [P] [US2] 扩展 `tests/adapters/java-adapter.test.ts` -- analyzeFile() 成员提取测试（~60 行）。包含：public/protected 方法提取验证、private 成员在 includePrivate=false 时被排除验证、static 方法/字段的 isStatic 标记验证、构造器提取验证、泛型方法签名验证、includePrivate=true 时包含所有成员验证。覆盖 FR-008~FR-012。

---

## Phase 6: User Story 3 -- Java import 依赖识别 (Priority: P1)

**Goal**: 验证 analyzeFile() 能准确解析普通 import、static import 和通配 import。

**Independent Test**: 对包含多种 import 形式的 Java fixture 文件进行分析，验证 imports 数组的 moduleSpecifier、namedImports、isRelative 和 isTypeOnly 字段。

### Tests

- [ ] T006 [P] [US3] 扩展 `tests/adapters/java-adapter.test.ts` -- analyzeFile() import 解析测试（~50 行）。包含：普通 import（moduleSpecifier + namedImports）验证、static import 解析验证、通配 import（namedImports=['*']）验证、isRelative=false 和 isTypeOnly=false 全局验证。覆盖 FR-013~FR-016。

---

## Phase 7: User Story 5 -- Java 解析降级的容错处理 (Priority: P2)

**Goal**: 当 tree-sitter 解析失败时，通过 Java 专用正则降级提取器仍能返回基本的 CodeSkeleton。

**Independent Test**: 直接调用 analyzeFallback()，验证返回有效的 CodeSkeleton；模拟正则降级场景验证 Java 正则提取器工作正常。

### Implementation

- [ ] T007 [US5] 修改 `src/core/tree-sitter-fallback.ts` -- 新增 `extractJavaExportsFromText()` 函数（~40 行）。正则匹配 `public class <Name>`、`public abstract class <Name>`、`public final class <Name>`、`public interface <Name>`、`public enum <Name>`。仅提取 public 顶层类型（排除缩进行以忽略内部类）。返回 ExportSymbol[]，signature 前缀为 `[REGEX]`。
- [ ] T008 [US5] 修改 `src/core/tree-sitter-fallback.ts` -- 新增 `extractJavaImportsFromText()` 函数（~40 行）。正则匹配三种 import 形式：普通 import（`import path.ClassName;`）、static import（`import static path.ClassName.member;`）、通配 import（`import path.*;`）。所有 isRelative=false、isTypeOnly=false。
- [ ] T009 [US5] 修改 `src/core/tree-sitter-fallback.ts` -- 在 `regexFallback()` 函数中新增 Java 语言分支（+6 行）。exports 和 imports 的语言判断链中各新增 `language === 'java'` 分支，分别委托 `extractJavaExportsFromText()` 和 `extractJavaImportsFromText()`。

### Tests

- [ ] T010 [US5] 扩展 `tests/adapters/java-adapter.test.ts` -- analyzeFallback() 测试（~30 行）。包含：对 Java 文件返回有效 CodeSkeleton 验证、language='java' 验证、exports 非空验证。覆盖 FR-017。

---

## Phase 8: User Story 6 -- Java 特有术语在 LLM prompt 中的参数化 (Priority: P2)

**Goal**: 验证 getTerminology() 返回 Java 社区惯用术语，使 LLM 生成的文档对 Java 开发者自然可读。

**Independent Test**: 调用 getTerminology()，验证每个字段的值包含 Java 特有概念。

### Tests

- [ ] T011 [P] [US6] 扩展 `tests/adapters/java-adapter.test.ts` -- getTerminology() 测试（~30 行）。包含：codeBlockLanguage='java' 验证、exportConcept 包含"访问修饰符"或"public"描述验证、importConcept 包含"static import"描述验证、typeSystemDescription 包含"静态"和"泛型"描述验证、interfaceConcept 包含"interface"和"abstract"描述验证、moduleSystem 包含"package"或"JPMS"描述验证。覆盖 FR-019。

---

## Phase 9: User Story 7 -- Java 测试文件的正确识别 (Priority: P2)

**Goal**: 验证 getTestPatterns() 返回的匹配模式能正确识别 Java 测试文件并区分生产代码。

**Independent Test**: 调用 getTestPatterns()，验证 filePattern 和 testDirs 的匹配行为。

### Tests

- [ ] T012 [P] [US7] 扩展 `tests/adapters/java-adapter.test.ts` -- getTestPatterns() 测试（~30 行）。包含：匹配 UserServiceTest.java / TestUserService.java / UserServiceTests.java / UserServiceIT.java 验证、不匹配 UserService.java / Main.java 验证、匹配含路径 path/to/UserServiceTest.java 验证、testDirs 包含 'src/test/java' 验证。覆盖 FR-020, SC-007。

---

## Phase 10: User Story 8 -- Java 生态特有目录的自动忽略 (Priority: P3)

**Goal**: 验证 defaultIgnoreDirs 包含 Java 生态的构建/缓存目录。

**Independent Test**: 已在 Phase 3（T003）的静态属性测试中覆盖。

> 无额外任务。US8 的验证已包含在 T003 中（defaultIgnoreDirs 属性断言覆盖 FR-021, FR-022）。

---

## Phase 11: Edge Cases & Polish

**Purpose**: 边界用例验证和代码清理

- [ ] T013 [P] 扩展 `tests/adapters/java-adapter.test.ts` -- 边界用例测试（~40 行）。包含：空 Java 文件（empty.java）返回空导出/导入列表验证、多类文件（非 public 类被正确处理）验证。覆盖 Edge Cases 中的空文件和多类文件场景。
- [ ] T014 [P] 修改 `src/core/tree-sitter-fallback.ts` -- 正则降级函数导出为具名 export（如 `export { extractJavaExportsFromText, extractJavaImportsFromText }`），以便未来单元测试可直接导入验证正则降级逻辑。与 Python/Go 的正则函数保持一致的导出风格。
- [ ] T015 运行完整测试套件（`npm test`）确认零回归 -- 验证 SC-004（现有全部测试 100% 通过）和 FR-027（不影响 TS/JS、Python、Go 文件分析）。
- [ ] T016 运行 lint 检查（`npm run lint`）确认代码风格合规。
- [ ] T017 [P] 更新 `specs/030-java-language-adapter/quickstart.md` -- 补充 Java 适配器的使用示例（如果该文件已存在）。
- [ ] T018 最终验证：确认 SC-005 约束 -- 检查本 Feature 未修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts` 或任何核心流水线文件。

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|---------|
| FR-001 | JavaLanguageAdapter 实现 LanguageAdapter 全部方法和属性 | T001, T003 |
| FR-002 | id = 'java' | T001, T003 |
| FR-003 | languages = ['java'] | T001, T003 |
| FR-004 | extensions = Set(['.java']) | T001, T003 |
| FR-005 | analyzeFile() 委托 TreeSitterAnalyzer | T001, T004 |
| FR-006 | CodeSkeleton language='java', parserUsed='tree-sitter' | T001, T004 |
| FR-007 | 提取 class/interface/enum/record 含泛型/继承/实现 | T004 |
| FR-008 | 提取方法含参数签名/返回类型/static/abstract | T005 |
| FR-009 | 提取字段含多声明符 | T005 |
| FR-010 | 提取构造器含参数签名 | T005 |
| FR-011 | 可见性修饰符处理（includePrivate） | T005 |
| FR-012 | 方法级泛型参数 | T005 |
| FR-013 | 普通 import 解析 | T006 |
| FR-014 | static import 解析 | T006 |
| FR-015 | 通配 import 解析 | T006 |
| FR-016 | isRelative=false, isTypeOnly=false | T006 |
| FR-017 | analyzeFallback() 降级能力 | T007, T008, T009, T010 |
| FR-018 | regexFallback() 新增 Java 正则分支 | T007, T008, T009 |
| FR-019 | getTerminology() 返回 Java 术语 | T001, T011 |
| FR-020 | getTestPatterns() 返回测试文件模式 | T001, T012 |
| FR-021 | defaultIgnoreDirs MUST 包含 target/build/out/.gradle | T001, T003 |
| FR-022 | defaultIgnoreDirs SHOULD 包含 .idea/.settings/.mvn | T001, T003 |
| FR-023 | bootstrapAdapters() 注册 | T002, T003 |
| FR-024 | 无扩展名冲突 | T003 |
| FR-025 | file-scanner 自动扫描 .java 文件 | T003 |
| FR-026 | buildDependencyGraph() 可选 | N/A（初始版本不实现） |
| FR-027 | 零回归 | T015 |
| FR-028 | 零新增运行时依赖 | T001（仅使用现有依赖） |

**覆盖率**: 27/28 FR 有对应任务（FR-026 为 MAY 级别，初始版本不实现）= **100% MUST/SHOULD 覆盖**

---

## Dependencies & Execution Order

### Phase 依赖关系

```text
Phase 2 (Foundational)
  T001 → T002（T002 依赖 T001 创建的 java-adapter.ts）

Phase 3~10 (User Stories)
  全部依赖 Phase 2 完成
  Phase 7 (US5) 的 T007~T009 修改 tree-sitter-fallback.ts，与其他 Phase 无冲突

Phase 11 (Polish)
  T015, T016 依赖所有实现任务完成
  T013, T014, T017 可与 Phase 3~10 并行
```

### User Story 间依赖

- **US4**（路由）: 仅依赖 Phase 2，与其他 US 无依赖
- **US1**（类型提取）: 仅依赖 Phase 2，与其他 US 无依赖
- **US2**（成员提取）: 仅依赖 Phase 2，与其他 US 无依赖
- **US3**（import 提取）: 仅依赖 Phase 2，与其他 US 无依赖
- **US5**（降级容错）: 依赖 Phase 2 + T007~T009（自身实现任务）
- **US6**（术语映射）: 仅依赖 Phase 2，与其他 US 无依赖
- **US7**（测试文件识别）: 仅依赖 Phase 2，与其他 US 无依赖
- **US8**（忽略目录）: 已在 T001/T003 中覆盖，无额外依赖

### Story 内部并行机会

- **T003, T004, T005, T006**: 全部是 `java-adapter.test.ts` 的不同 describe 块。建议按顺序在同一文件中编写，但测试本身可并行执行。
- **T007, T008**: 同在 `tree-sitter-fallback.ts` 中新增函数，但 T007（exports）和 T008（imports）是独立函数，可并行开发后合并。T009 依赖 T007 + T008。
- **T011, T012**: 独立的 getTerminology/getTestPatterns 测试，可并行编写。

### 推荐实现策略

**MVP First**（推荐）:

1. T001 + T002 (Foundational) -- 创建适配器 + 注册
2. T003 (US4 路由验证) -- 确认基础设施工作
3. T004 + T005 + T006 (US1/US2/US3 核心功能测试) -- 验证 JavaMapper 委托链
4. T007 + T008 + T009 + T010 (US5 降级) -- 补全正则降级
5. T011 + T012 (US6/US7 辅助功能测试)
6. T013 ~ T018 (Polish)

MVP 范围为 **T001~T006**（6 个任务），交付 US1~US4 的核心价值。

---

## Notes

- 本 Feature 是典型的"胶水层"实现，核心解析能力由已有的 JavaMapper（482 行）提供
- `java-adapter.ts` 的实现与 `go-adapter.ts`（73 行）和 `python-adapter.ts`（80 行）高度同构
- 所有测试集中在一个测试文件 `tests/adapters/java-adapter.test.ts` 中，按 describe 块组织
- `tree-sitter-fallback.ts` 的修改遵循现有 Python/Go 分支的模式，保持代码风格一致
- 不引入任何新依赖，不修改核心流水线文件
