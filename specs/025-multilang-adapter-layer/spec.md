---
feature: 025-multilang-adapter-layer
title: 语言适配器抽象层（LanguageAdapter）
status: Draft
created: 2026-03-16
blueprint: 024-multilang-blueprint
research_mode: tech-only
---

# Feature Specification: 语言适配器抽象层（LanguageAdapter）

**Feature Branch**: `025-multilang-adapter-layer`
**Created**: 2026-03-16
**Status**: Draft
**Blueprint**: 024-multilang-blueprint (Feature 1)
**Input**: 为 reverse-spec 引入 LanguageAdapter 抽象层，将现有 TS/JS 专用逻辑封装为 TsJsLanguageAdapter，扩展 CodeSkeleton 数据模型支持多语言，参数化 file-scanner 和编排器的语言依赖。零行为变更——现有 TS/JS 功能必须完全不受影响。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - TS/JS 用户无感知升级 (Priority: P1)

作为一个 **现有 reverse-spec 用户**，我对纯 TS/JS 项目运行 `reverse-spec generate` 或 `reverse-spec batch`，期望产出的 spec 与升级前完全一致——我不需要知道底层架构发生了变化。

**Why this priority**: 零回归是本 Feature 的核心约束。如果现有 TS/JS 功能出现任何行为差异，则整个 Feature 失败。这是所有后续多语言工作的信任基础。

**Independent Test**: 对现有 TS/JS 项目（包括 reverse-spec 自身）运行全量 spec 生成，将产出与升级前的 golden-master 快照逐字节比对，确认零差异。

**Acceptance Scenarios**:

1. **Given** 一个纯 TS/JS 项目且已有 golden-master 快照，**When** 在 LanguageAdapter 重构后运行 `reverse-spec generate <target>`，**Then** 产出的 spec 内容与 golden-master 快照完全一致。
2. **Given** 一个纯 TS/JS 项目，**When** 运行 `reverse-spec batch`，**Then** 批量生成的所有 spec 与重构前逐一比对无差异，且 exit code 为 0。
3. **Given** 现有全部 42 个测试文件，**When** 运行 `npm test`，**Then** 所有测试通过，无跳过、无失败。

---

### User Story 2 - 语言适配器开发者注册新语言 (Priority: P1)

作为一个 **语言适配器开发者**（reverse-spec 维护团队成员），我希望通过实现一个标准接口并注册到 Registry，即可让 reverse-spec 支持一种新语言，而无需修改核心流水线代码。

**Why this priority**: 这是本 Feature 的核心价值——建立可扩展的抽象层。如果注册一种新语言仍需大量修改核心代码，则抽象层形同虚设。

**Independent Test**: 编写一个最小化的 mock 语言适配器（例如 `MockLanguageAdapter`），注册到 Registry，验证 file-scanner 能识别其声明的扩展名，编排器能将对应文件路由到该适配器。

**Acceptance Scenarios**:

1. **Given** 一个实现了 LanguageAdapter 接口的 mock 适配器声明支持 `.mock` 扩展名，**When** 将其注册到 LanguageAdapterRegistry，**Then** `registry.getAdapter('example.mock')` 返回该适配器实例。
2. **Given** 已注册 mock 适配器，**When** file-scanner 扫描包含 `.mock` 文件的目录，**Then** `.mock` 文件出现在扫描结果中。
3. **Given** 已注册 mock 适配器，**When** 编排器处理 `.mock` 文件，**Then** 调用的是 mock 适配器的 `analyzeFile` 方法而非 ts-morph 逻辑。

---

### User Story 3 - 非支持语言文件的友好提示 (Priority: P2)

作为一个 **用户**，当我将 reverse-spec 指向一个包含不支持语言文件（如 `.py`、`.go`）的目录时，我希望收到清晰的提示信息，告知哪些文件因语言不支持而被跳过，而不是静默忽略。

**Why this priority**: 当前系统静默忽略所有非 JS/TS 文件，用户可能误以为"没有文件需要处理"。友好提示为后续多语言支持铺路，让用户知道"reverse-spec 知道这些文件存在，只是暂时不支持"。

**Independent Test**: 在一个混合语言目录（含 `.ts` 和 `.py` 文件）运行 `reverse-spec generate`，验证 `.py` 文件被跳过时输出提示信息。

**Acceptance Scenarios**:

1. **Given** 一个包含 `.ts` 和 `.py` 文件的目录，**When** 运行 `reverse-spec generate <目录>`，**Then** `.py` 文件被排除在分析范围外，且输出中包含跳过提示（含文件扩展名或路径）。
2. **Given** 一个仅包含不支持语言文件的目录，**When** 运行 `reverse-spec generate <目录>`，**Then** 系统报告"目标路径中未找到支持的源文件"（而非"未找到 TS/JS 文件"）。

---

### User Story 4 - CodeSkeleton 数据模型的前向兼容 (Priority: P2)

作为一个 **持有已生成 baseline 的用户**，我希望升级 reverse-spec 后，旧版 baseline JSON 仍能被正常加载和使用，drift 检测功能不受影响。

**Why this priority**: baseline 是用户积累的资产。如果模型扩展导致旧 baseline 不可用，会严重损害用户信任。

**Independent Test**: 加载一份在旧版 schema 下生成的 CodeSkeleton baseline JSON，验证新版 Zod schema 能够成功解析，且 drift 检测正常工作。

**Acceptance Scenarios**:

1. **Given** 一份旧版 CodeSkeleton baseline JSON（`language: 'typescript'`, `filePath` 以 `.ts` 结尾），**When** 使用新版 CodeSkeleton schema 执行 `parse()`，**Then** 解析成功，无 ZodError。
2. **Given** 旧版 baseline 与新版代码之间存在 drift，**When** 运行 drift 检测，**Then** 检测结果与升级前一致。

---

### User Story 5 - Registry 扩展名冲突检测 (Priority: P3)

作为一个 **适配器开发者**，如果我错误地注册了一个已被其他适配器占用的文件扩展名，我希望系统在注册时立即报错，而不是运行时产生不可预测的行为。

**Why this priority**: 防御性编程，防止多个适配器争抢同一扩展名导致不确定路由。在只有 TsJsLanguageAdapter 的当前阶段不是关键路径，但对未来多适配器共存至关重要。

**Independent Test**: 注册两个声明相同扩展名的适配器，验证第二次注册时抛出错误。

**Acceptance Scenarios**:

1. **Given** TsJsLanguageAdapter 已注册（占用 `.ts`、`.tsx`、`.js`、`.jsx`），**When** 尝试注册另一个声明支持 `.ts` 的适配器，**Then** 注册操作抛出错误，包含冲突扩展名和已占用适配器的标识。

---

### Edge Cases

- 当目标路径中混合存在已支持和未支持的文件扩展名时，系统应正确处理已支持文件并对未支持文件给出提示，不应中断整体流程。
- 当 LanguageAdapterRegistry 中没有注册任何适配器时（例如启动初始化失败），系统应给出明确的错误信息而非运行时崩溃。
- 当文件无扩展名或扩展名为空字符串时，`getAdapter()` 应返回 null 而非抛出异常。
- 当 TsJsLanguageAdapter 的 `analyzeFile` 遇到 ts-morph 解析失败时，应按现有行为降级到正则 fallback，行为不变。
- 当多次调用 `LanguageAdapterRegistry.getInstance()` 时，应返回同一实例（单例保证）。
- 当在测试环境中调用 `resetInstance()` 后再次 `getInstance()` 时，应返回新的空白实例，不残留之前注册的适配器。

## Requirements *(mandatory)*

### Functional Requirements

#### LanguageAdapter 接口定义

- **FR-001**: 系统 MUST 定义一个 `LanguageAdapter` 接口，包含以下能力声明：唯一标识（`id`）、支持的语言列表、支持的文件扩展名集合、默认忽略目录集合、文件分析能力、正则降级分析能力、语言术语映射、测试文件匹配模式。
- **FR-002**: `LanguageAdapter` 接口 MUST 声明文件分析能力——接受文件路径，返回结构化的 CodeSkeleton 数据。
- **FR-003**: `LanguageAdapter` 接口 MUST 声明正则降级分析能力——当主分析器不可用时，提供基于正则表达式的兜底分析。
- **FR-004**: `LanguageAdapter` 接口 SHOULD 声明依赖图构建能力——该能力为可选，因为并非所有语言在初始阶段都需要依赖图支持。
- **FR-005**: `LanguageAdapter` 接口 MUST 声明语言术语映射能力——返回该语言特有的术语（代码块标记、导出/导入概念、类型系统描述、接口概念、模块系统描述），供 LLM prompt 参数化使用。
- **FR-006**: `LanguageAdapter` 接口 MUST 声明测试文件匹配模式——返回该语言的测试文件名正则和测试目录名集合。

#### LanguageAdapterRegistry

- **FR-007**: 系统 MUST 提供一个 `LanguageAdapterRegistry`，支持按文件扩展名查找对应的 LanguageAdapter 实例。
- **FR-008**: Registry MUST 支持注册适配器——接受一个 LanguageAdapter 实例，将其声明的所有扩展名映射到该实例。
- **FR-009**: Registry MUST 在注册时检测扩展名冲突——如果某个扩展名已被另一个适配器注册，则注册操作必须失败并报告冲突详情。
- **FR-010**: Registry MUST 提供查询当前所有已注册扩展名的能力。
- **FR-011**: Registry MUST 提供聚合所有已注册适配器默认忽略目录的能力。
- **FR-012**: Registry MUST 为单例模式，整个进程内共享一个实例。
- **FR-013**: Registry MUST 提供重置能力（用于测试隔离），重置后实例恢复为无任何适配器注册的空白状态。

#### TsJsLanguageAdapter 封装

- **FR-014**: 系统 MUST 提供 `TsJsLanguageAdapter` 作为 `LanguageAdapter` 接口的 TS/JS 实现，封装当前所有 TS/JS 专用逻辑。
- **FR-015**: `TsJsLanguageAdapter` MUST 声明支持 `.ts`、`.tsx`、`.js`、`.jsx` 四种扩展名。
- **FR-016**: `TsJsLanguageAdapter` 的文件分析能力 MUST 与当前 `ast-analyzer.ts` 的 `analyzeFile()` 行为完全一致——对相同输入产出相同的 CodeSkeleton。
- **FR-017**: `TsJsLanguageAdapter` 的降级分析能力 MUST 与当前 `tree-sitter-fallback.ts` 的 `analyzeFallback()` 行为完全一致。
- **FR-018**: `TsJsLanguageAdapter` SHOULD 封装当前基于 dependency-cruiser 的依赖图构建逻辑。
- **FR-019**: `TsJsLanguageAdapter` MUST 提供 TS/JS 的语言术语映射（代码块标记为 `typescript`、导出概念为 `export`、导入概念为 `import`、模块系统为 `ES Modules / CommonJS` 等）。
- **FR-020**: `TsJsLanguageAdapter` MUST 提供 TS/JS 的测试文件匹配模式（匹配 `.test.ts`、`.spec.ts`、`.test.tsx`、`.spec.tsx`、`.test.js`、`.spec.js`、`.test.jsx`、`.spec.jsx`）。
- **FR-021**: `TsJsLanguageAdapter` MUST 声明 TS/JS 生态的默认忽略目录（`node_modules`、`.next`、`.nuxt`、`dist`、`build` 等，与当前 `file-scanner.ts` 中的 `DEFAULT_IGNORE_DIRS` 一致）。

#### CodeSkeleton 数据模型扩展

- **FR-022**: `LanguageSchema` MUST 扩展为支持以下语言值：保留现有 `typescript`、`javascript`，新增 `python`、`go`、`java`、`rust`、`kotlin`、`cpp`、`ruby`、`swift`。
- **FR-023**: `ExportKindSchema` MUST 扩展为支持以下新值：`struct`、`trait`、`protocol`、`data_class`、`module`——保留所有现有值不变。
- **FR-024**: `MemberKindSchema` MUST 扩展为支持以下新值：`classmethod`、`staticmethod`、`associated_function`——保留所有现有值不变。
- **FR-025**: CodeSkeleton 的文件路径验证 MUST 放宽为支持所有目标语言的文件扩展名（`.ts`、`.tsx`、`.js`、`.jsx`、`.py`、`.pyi`、`.go`、`.java`、`.kt`、`.kts`、`.rs`、`.cpp`、`.cc`、`.cxx`、`.c`、`.h`、`.hpp`、`.rb`、`.swift`）。
- **FR-026**: 所有 CodeSkeleton 模型变更 MUST 为纯扩展（只增不减），旧版数据仍然通过新版 schema 验证。

#### file-scanner 参数化

- **FR-027**: `file-scanner` 的支持文件扩展名 MUST 从 LanguageAdapterRegistry 动态获取，不再硬编码。
- **FR-028**: `file-scanner` 的默认忽略目录 MUST 从 LanguageAdapterRegistry 聚合所有已注册适配器的忽略目录，并合并通用忽略目录（如 `.git`）。
- **FR-029**: `file-scanner` 的扫描选项 SHOULD 支持调用方显式传入扩展名集合，覆盖 Registry 默认值。

#### 编排器 Registry 路由

- **FR-030**: `single-spec-orchestrator` MUST 通过 LanguageAdapterRegistry 路由文件分析请求——根据文件扩展名选择对应适配器，而非直接调用 TS/JS 专用函数。
- **FR-031**: `batch-orchestrator` MUST 通过 LanguageAdapterRegistry 路由依赖图构建请求。
- **FR-032**: 编排器中的错误消息 MUST 使用语言无关的表述（如"支持的源文件"），不再包含"TS/JS"等特定语言名称。

#### 启动与初始化

- **FR-033**: 系统 MUST 在 CLI 入口和 MCP 服务器启动时自动完成 TsJsLanguageAdapter 的注册，无需用户干预。
- **FR-034**: 如果 Registry 在被查询时尚未注册任何适配器，系统 MUST 给出明确的错误提示而非无声失败。

#### 零行为变更约束

- **FR-035**: 在本 Feature 完成后，对任何纯 TS/JS 项目运行 reverse-spec 的任意命令（`generate`、`batch`、`diff`、`prepare`），其输出 MUST 与 Feature 实施前完全一致。
- **FR-036**: 本 Feature MUST NOT 引入任何新的运行时依赖，也 MUST NOT 移除任何现有依赖。

### Key Entities

- **LanguageAdapter**: 语言适配器的标准能力契约。定义了一种编程语言支持所需的全部能力：文件分析、降级分析、依赖图构建（可选）、术语映射、测试文件模式。每个适配器通过唯一标识和支持的扩展名集合与 Registry 关联。
- **LanguageAdapterRegistry**: 全局适配器注册中心。维护"文件扩展名 → 适配器实例"的映射关系，为流水线各环节提供按文件路由到正确适配器的能力。单例，进程级生命周期。
- **TsJsLanguageAdapter**: TS/JS 语言适配器。将当前分散在 `ast-analyzer.ts`、`tree-sitter-fallback.ts`、`dependency-graph.ts` 中的 TS/JS 专用逻辑聚合为一个内聚的适配器实例。是 LanguageAdapter 接口的首个（也是本 Feature 唯一的）具体实现。
- **LanguageTerminology**: 语言术语映射。包含代码块语言标记、导出概念、导入概念、类型系统描述、接口概念、模块系统描述。用于 LLM prompt 的语言参数化。
- **TestPatterns**: 测试文件匹配模式。包含测试文件名正则和测试目录名集合，用于 secret-redactor 和 noise-filter 识别测试文件。
- **CodeSkeleton**（扩展）: 现有数据模型。本 Feature 扩展其 `LanguageSchema`、`ExportKindSchema`、`MemberKindSchema` 枚举值和 `filePath` 验证规则，使其能表达多语言的代码骨架。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 现有全部测试套件（42 个测试文件）在 Feature 完成后 100% 通过，零跳过、零失败。
- **SC-002**: 对 reverse-spec 自身（self-hosting）运行 `generate` 和 `batch`，产出 spec 与 Feature 实施前的 golden-master 快照逐字节比对无差异。
- **SC-003**: 新增语言适配器（通过 mock 适配器验证）仅需实现 LanguageAdapter 接口并调用一次 `registry.register()`，无需修改 `file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts` 或任何核心流水线文件。
- **SC-004**: 旧版 CodeSkeleton baseline JSON（Feature 实施前生成）能被新版 schema 成功解析，`parse()` 不抛出 ZodError。
- **SC-005**: 运行时零新增依赖——`package.json` 的 `dependencies` 字段在 Feature 实施前后保持一致。
- **SC-006**: LanguageAdapterRegistry 的适配器查找操作为 O(1) 时间复杂度（基于 Map 的扩展名查找）。
- **SC-007**: 新增的单元测试覆盖 LanguageAdapter 接口定义、Registry 注册/查找/冲突检测/重置、TsJsLanguageAdapter 与现有行为的等价性，测试数量不少于 20 个。
