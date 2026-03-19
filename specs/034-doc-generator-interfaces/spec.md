# Feature Specification: DocumentGenerator + ArtifactParser 接口定义

**Feature Branch**: `034-doc-generator-interfaces`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "为 Reverse Spec 的全景文档化能力定义两个核心接口：DocumentGenerator<TInput, TOutput> 和 ArtifactParser<T>，包含接口定义、Zod Schema、Mock Generator 和单元测试。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - DocumentGenerator 接口定义与编译验证（Priority: P1）

作为后续 Phase 1-3 的 Generator 实现者（开发者或 AI agent），我需要一个通过 TypeScript 编译的 DocumentGenerator 泛型接口定义，包含 isApplicable / extract / generate / render 四步生命周期方法，以便在实现具体 Generator（如 DataModelGenerator、ConfigReferenceGenerator）时有明确的接口契约可遵循。

**Why this priority**: DocumentGenerator 是全景文档化 Milestone（17 个 Feature）的核心抽象基础。Phase 1-3 的所有 Generator 均需实现此接口——如果接口定义不存在或无法编译，后续 12 个依赖 Feature（037-050 中的大部分）将全部阻塞。

**Independent Test**: 运行 `npm run build`，确认 `src/panoramic/interfaces.ts` 编译通过零错误；在 IDE 中引用 DocumentGenerator 接口定义一个空实现类，TypeScript 编译器能正确提示需要实现的方法列表。

**Acceptance Scenarios**:

1. **Given** `src/panoramic/interfaces.ts` 已创建，**When** 运行 `npm run build`，**Then** 编译通过零错误，且 DocumentGenerator 接口的泛型参数 `<TInput, TOutput>` 可被具体类型实例化（如 `DocumentGenerator<DataModelInput, DataModelOutput>`）
2. **Given** DocumentGenerator 接口已定义，**When** 查看接口签名，**Then** 包含 `id`（只读标识符）、`name`（显示名称）、`isApplicable(context)`、`extract(context)`、`generate(input, options?)`、`render(output)` 全部成员
3. **Given** DocumentGenerator 接口已定义，**When** 一个实现类仅实现了部分方法（如缺少 `render`），**Then** TypeScript 编译器报出缺失成员的类型错误

---

### User Story 2 - ArtifactParser 接口定义与编译验证（Priority: P1）

作为非代码制品解析功能的实现者，我需要一个通过 TypeScript 编译的 ArtifactParser 泛型接口定义，包含 filePatterns 属性和 parse / parseAll 方法，以便在实现具体 Parser（如 SkillMdParser、BehaviorYamlParser、DockerfileParser）时有明确的解析契约可遵循。

**Why this priority**: ArtifactParser 与 DocumentGenerator 同为 Phase 0 基础设施的两大核心抽象。Feature 037（非代码制品解析）直接强依赖此接口，后续的 Feature 039（配置参考手册）和 Feature 043（部署运维文档）间接依赖。与 Story 1 同为 P1 因为两者共同构成 `interfaces.ts` 的完整交付。

**Independent Test**: 运行 `npm run build`，确认 ArtifactParser 接口编译通过；在 IDE 中定义一个具体 Parser 类实现 ArtifactParser 接口，TypeScript 编译器能正确提示需要实现的方法。

**Acceptance Scenarios**:

1. **Given** `src/panoramic/interfaces.ts` 已创建，**When** 运行 `npm run build`，**Then** ArtifactParser 接口编译通过，泛型参数 `<T>` 可被具体类型实例化（如 `ArtifactParser<SkillMdData>`）
2. **Given** ArtifactParser 接口已定义，**When** 查看接口签名，**Then** 包含 `id`（只读标识符）、`filePatterns`（glob 模式数组）、`parse(filePath)` 和 `parseAll(filePaths)` 全部成员
3. **Given** ArtifactParser 接口已定义，**When** 一个实现类的 `parse` 方法返回类型与泛型参数 `T` 不匹配，**Then** TypeScript 编译器报出类型不兼容错误

---

### User Story 3 - Zod Schema 运行时验证（Priority: P1）

作为 MCP 工具集成的开发者，我需要 DocumentGenerator 和 ArtifactParser 的输入/输出数据结构有对应的 Zod Schema 定义，以便在运行时对 Generator 的输入输出进行验证，并支持 MCP 参数描述的自动生成。

**Why this priority**: Zod Schema 是蓝图验证标准的明确要求（"接口定义通过 TypeScript 编译且有对应 Zod Schema"）。运行时验证是保障 Generator 输入输出正确性的关键手段——TypeScript 类型在编译后消失，只有 Zod Schema 能在运行时捕获无效数据。与 Story 1/2 同为 P1 因为三者共同构成接口定义的完整交付。

**Independent Test**: 构造一个符合 Schema 的数据对象调用 `schema.parse()`，确认通过；构造一个缺少必填字段的数据对象调用 `schema.parse()`，确认抛出 ZodError。

**Acceptance Scenarios**:

1. **Given** DocumentGenerator 相关的 Zod Schema 已定义，**When** 用一个有效的 GeneratorMetadata 对象调用 `GeneratorMetadataSchema.parse(data)`，**Then** 解析成功并返回类型化对象
2. **Given** ArtifactParser 相关的 Zod Schema 已定义，**When** 用一个缺少 `id` 字段的数据对象调用 `ArtifactParserMetadataSchema.parse(data)`，**Then** 抛出 ZodError 且错误信息指明缺少 `id` 字段
3. **Given** Zod Schema 已定义，**When** Zod Schema 推导出的 TypeScript 类型与手写的 interface 进行类型兼容性检查，**Then** 两者类型兼容（`z.infer<typeof Schema>` 可赋值给对应 interface）

---

### User Story 4 - Mock Generator 全生命周期验证（Priority: P1）

作为 Phase 0 基础设施的验证者，我需要至少一个 Mock Generator 实现 DocumentGenerator 接口的全部方法（isApplicable / extract / generate / render），并通过单元测试验证完整的四步生命周期，以便确认接口设计在实际使用中是可行的、符合预期的。

**Why this priority**: Mock Generator 是蓝图验证标准的明确要求（"至少编写一个 Mock Generator 实现 DocumentGenerator 接口的全部方法，单元测试通过"）。接口定义是否合理，只有通过实际实现才能验证——Mock Generator 充当接口设计的"冒烟测试"。

**Independent Test**: 运行 `npm test` 执行 Mock Generator 的单元测试，确认 isApplicable / extract / generate / render 四步调用链测试全部通过。

**Acceptance Scenarios**:

1. **Given** MockReadmeGenerator（或等价的 Mock 实现）已创建，**When** 调用 `isApplicable(context)` 传入一个包含 `package.json` 的 ProjectContext，**Then** 返回 `true`
2. **Given** MockReadmeGenerator 已创建，**When** 调用 `isApplicable(context)` 传入一个不包含 `package.json` 的 ProjectContext，**Then** 返回 `false`
3. **Given** MockReadmeGenerator 已创建，**When** 按顺序调用 `extract(context)` -> `generate(input)` -> `render(output)`，**Then** 每步返回预期的数据结构，最终 `render` 返回包含项目名称和描述的 Markdown 字符串
4. **Given** Mock Generator 单元测试文件已创建，**When** 运行 `npm test`，**Then** 全部测试用例通过，退出码为 0

---

### User Story 5 - 与现有代码库正交性保障（Priority: P2）

作为 Reverse Spec 项目的维护者，我需要新引入的 DocumentGenerator 和 ArtifactParser 接口与现有的 LanguageAdapter、CodeSkeleton、ModuleSpec 等数据类型正交，互不干扰，以便全景文档化能力可以独立演进而不影响现有的代码 spec 生成流程。

**Why this priority**: 正交性是架构健壮性的基础保障。新接口应放在独立的 `src/panoramic/` 目录，不修改现有 `src/adapters/` 或 `src/models/` 中的任何文件。但正交性可通过代码审查确认，不需要额外的功能开发，故优先级低于核心接口定义。

**Independent Test**: 运行 `npm test` 确认现有全部测试仍然通过；通过检查 `git diff` 确认未修改 `src/adapters/` 和 `src/models/` 目录下的任何文件。

**Acceptance Scenarios**:

1. **Given** `src/panoramic/interfaces.ts` 已创建，**When** 运行项目的全部现有测试（`npm test`），**Then** 全部测试通过，无新增失败
2. **Given** 新接口文件已提交，**When** 检查 `src/adapters/` 和 `src/models/` 目录的 git diff，**Then** 这两个目录下无任何文件变更
3. **Given** DocumentGenerator 接口中使用了 ProjectContext 类型参数，**When** 检查 ProjectContext 的定义，**Then** 它定义在 `src/panoramic/` 目录下而非 `src/models/`，与现有 CodeSkeleton / ModuleSpec 无导入依赖

---

### Edge Cases

- **空项目上下文**: 当 `isApplicable()` 接收到一个属性全为空/undefined 的 ProjectContext 时，Generator 应返回 `false` 而非抛出异常
- **extract 返回空数据**: 当 `extract()` 在项目中未找到任何可提取的数据时，应返回一个合法的空 TInput 对象（如空数组、空映射），而非 null 或 undefined
- **render 输入不完整**: 当 `render()` 接收到 `generate()` 产生的输出对象中某些可选字段缺失时，应生成降级的 Markdown（省略缺失部分），而非抛出异常
- **filePatterns 无匹配**: 当 ArtifactParser 的 `filePatterns` 在项目中无任何匹配文件时，`parseAll([])` 应返回空数组
- **parse 文件不存在**: 当 `parse(filePath)` 的目标文件不存在时，应抛出明确的错误（包含文件路径信息），而非静默返回空对象
- **泛型类型约束**: 当 `TInput` 或 `TOutput` 泛型参数被实例化为不兼容类型（如 `generate()` 期望 `DataModelInput` 但传入 `ConfigInput`），TypeScript 编译器应在编译期捕获此错误
- **Zod Schema 验证失败路径**: 当 Zod Schema 的 `parse()` 接收到类型错误的数据时，错误消息应包含足够的上下文信息（字段名、期望类型、实际值类型）

## Requirements *(mandatory)*

### Functional Requirements

**DocumentGenerator 接口定义**

- **FR-001**: 系统 MUST 在 `src/panoramic/interfaces.ts` 中定义 `DocumentGenerator<TInput, TOutput>` 泛型接口，包含以下成员：`id`（只读字符串标识符）、`name`（只读显示名称）、`description`（只读描述） `[关联: Story 1]`
- **FR-002**: DocumentGenerator 接口 MUST 定义 `isApplicable(context: ProjectContext): boolean | Promise<boolean>` 方法，用于判断当前项目是否适用此 Generator。返回类型为联合类型 `boolean | Promise<boolean>` 是有意设计——简单的文件存在性检查可同步返回（避免不必要的 async 开销），而需要文件 I/O 或复杂分析的判断可异步返回。调用方应统一用 `await` 或 `Promise.resolve()` 包装处理 `[关联: Story 1]` `[AUTO-CLARIFIED: 同步/异步联合类型 — 参考 LanguageAdapter.buildDependencyGraph 的可选异步模式，此处为轻量化适配性判断提供灵活性]`
- **FR-003**: DocumentGenerator 接口 MUST 定义 `extract(context: ProjectContext): Promise<TInput>` 方法，用于从项目中提取该 Generator 需要的输入数据 `[关联: Story 1]`
- **FR-004**: DocumentGenerator 接口 MUST 定义 `generate(input: TInput, options?: GenerateOptions): Promise<TOutput>` 方法，用于将提取的原始数据转换为结构化的文档输出对象 `[关联: Story 1]`
- **FR-005**: DocumentGenerator 接口 MUST 定义 `render(output: TOutput): string | Promise<string>` 方法，用于将文档输出对象渲染为 Markdown 字符串 `[关联: Story 1]`
- **FR-006**: DocumentGenerator 接口的生命周期 MUST 遵循 `isApplicable -> extract -> generate -> render` 四步顺序，与蓝图第 6.1 节定义的契约概要一致 `[关联: Story 1]`

**ArtifactParser 接口定义**

- **FR-007**: 系统 MUST 在 `src/panoramic/interfaces.ts` 中定义 `ArtifactParser<T>` 泛型接口，包含以下成员：`id`（只读字符串标识符）、`name`（只读显示名称） `[关联: Story 2]`
- **FR-008**: ArtifactParser 接口 MUST 定义 `filePatterns: readonly string[]` 只读属性，声明该 Parser 支持的文件匹配模式（glob 格式，如 `**/SKILL.md`、`**/Dockerfile`） `[关联: Story 2]`
- **FR-009**: ArtifactParser 接口 MUST 定义 `parse(filePath: string): Promise<T>` 方法，用于解析单个制品文件并返回结构化数据 `[关联: Story 2]`
- **FR-010**: ArtifactParser 接口 MUST 定义 `parseAll(filePaths: string[]): Promise<T[]>` 方法，用于批量解析多个同类制品文件 `[关联: Story 2]`

**Zod Schema 定义**

- **FR-011**: 系统 MUST 为 DocumentGenerator 的元数据（id、name、description）定义对应的 Zod Schema，支持运行时验证。Schema 与接口定义放在同一文件 `src/panoramic/interfaces.ts` 中（Zod Schema 在前，`z.infer` 推导类型在后，手写 interface 引用推导类型） `[关联: Story 3]` `[AUTO-CLARIFIED: 同文件组织 — 参考现有 code-skeleton.ts 的 Zod + type 同文件模式]`
- **FR-012**: 系统 MUST 为 ArtifactParser 的元数据（id、name、filePatterns）定义对应的 Zod Schema，支持运行时验证。Schema 放在 `src/panoramic/interfaces.ts` 中，与 FR-011 的 Schema 共同组织 `[关联: Story 3]`
- **FR-013**: Zod Schema 推导的 TypeScript 类型（`z.infer<typeof Schema>`）MUST 与手写的 interface 类型兼容 `[关联: Story 3]`
- **FR-014**: 系统 SHOULD 为 GenerateOptions（生成选项）定义 Zod Schema，支持运行时验证选项参数 `[关联: Story 3]`

**辅助类型定义**

- **FR-015**: 系统 MUST 定义 `GenerateOptions` 类型，包含以下可选字段：`useLLM`（布尔，是否启用 LLM 增强，默认 false）、`templateOverride`（字符串，自定义 Handlebars 模板路径）、`outputFormat`（枚举 'markdown'，预留未来扩展）。此为最小可用版本，后续 Phase 1 各 Generator 可通过类型交叉（intersection）扩展 Generator 特定选项 `[关联: Story 1, Story 4]` `[AUTO-CLARIFIED: 最小字段集 — 参考蓝图 6.1 节和 tech-research 5.1 节降级机制设计]`
- **FR-016**: 系统 MUST 定义 `ProjectContext` 类型占位（最小可用版本），包含 `projectRoot`（项目根目录）和 `configFiles`（配置文件映射）属性，作为 Feature 035 完整实现前的临时依赖 `[AUTO-RESOLVED: ProjectContext 是 Feature 035 的交付物，但 034 的接口定义和 Mock Generator 需要引用它——此处定义最小占位版本，Feature 035 负责扩展为完整实现]`

**Mock Generator 实现**

- **FR-017**: 系统 MUST 提供至少一个 Mock Generator 实现（如 MockReadmeGenerator），完整实现 DocumentGenerator 接口的全部方法 `[关联: Story 4]`
- **FR-018**: Mock Generator 的 `isApplicable()` MUST 基于 ProjectContext 中的条件返回布尔值（如检查 package.json 是否存在） `[关联: Story 4]`
- **FR-019**: Mock Generator 的 `extract()` MUST 返回一个符合 TInput 类型的数据对象 `[关联: Story 4]`
- **FR-020**: Mock Generator 的 `generate()` MUST 将 extract 的输出转换为符合 TOutput 类型的文档数据对象 `[关联: Story 4]`
- **FR-021**: Mock Generator 的 `render()` MUST 将 generate 的输出渲染为有效的 Markdown 字符串 `[关联: Story 4]`

**单元测试**

- **FR-022**: 系统 MUST 为 Mock Generator 编写单元测试，测试文件路径为 `tests/panoramic/mock-generator.test.ts`，覆盖 isApplicable（适用/不适用两种场景）、extract、generate、render 四个方法 `[关联: Story 4]` `[AUTO-CLARIFIED: 测试路径 — 遵循现有 tests/ 目录结构，新建 panoramic/ 子目录与 src/panoramic/ 对称]`
- **FR-023**: 系统 MUST 为 Zod Schema 编写单元测试，测试文件路径为 `tests/panoramic/schemas.test.ts`，覆盖合法输入通过验证和非法输入抛出 ZodError 两种场景 `[关联: Story 3]`
- **FR-024**: 单元测试 MUST 全部通过（`npm test` 退出码为 0） `[关联: Story 4]`

**代码组织与正交性**

- **FR-025**: 所有新增代码 MUST 放在 `src/panoramic/` 目录下，不修改 `src/adapters/`、`src/models/`、`src/core/` 等现有目录中的任何文件 `[关联: Story 5]`
- **FR-026**: 新增的接口 MUST 与现有的 LanguageAdapter、CodeSkeleton、ModuleSpec 等类型正交——不继承、不依赖、不修改现有类型 `[关联: Story 5]`
- **FR-027**: `npm run build` MUST 在新增代码后零错误通过 `[关联: Story 1, Story 2]`

**设计模式一致性**

- **FR-028**: DocumentGenerator 接口 MUST 采用 Strategy 模式，与现有 LanguageAdapter 接口的设计模式保持一致 `[关联: Story 1, Story 5]`
- **FR-029**: DocumentGenerator 接口 SHOULD 为未来 GeneratorRegistry（Feature 036）的注册机制预留兼容性——即 Generator 具有唯一 `id` 标识符，Registry 可通过 `id` 查询 `[关联: Story 1]`

### Key Entities

- **DocumentGenerator<TInput, TOutput>**: 文档生成策略接口。定义从项目中提取信息并生成特定类型文档的统一契约。TInput 表示 extract 步骤的输出数据结构，TOutput 表示 generate 步骤的输出数据结构。每个具体文档类型（数据模型、API 端点、配置参考等）实现一个 DocumentGenerator
- **ArtifactParser<T>**: 非代码制品解析接口。定义非代码制品（SKILL.md、behavior YAML、Dockerfile、CI 配置等）的解析契约。T 表示 parse 步骤的输出数据结构。与 LanguageAdapter 正交——LanguageAdapter 处理代码文件的 AST 分析，ArtifactParser 处理非代码制品的结构提取
- **ProjectContext（最小占位版本）**: 项目元信息容器。包含 projectRoot 和 configFiles 两个最小属性。完整版本由 Feature 035 交付，此处为临时占位以满足接口定义和 Mock Generator 的编译需求
- **GenerateOptions**: 文档生成的通用选项。包含 LLM 增强开关、模板覆盖路径等可选配置，由 `generate()` 方法的第二个参数传入
- **MockReadmeGenerator**: 接口设计验证用的 Mock 实现。模拟一个 README 文档生成器，从 ProjectContext 的 package.json 信息中提取项目名称和描述，生成简单的 README Markdown。其唯一目的是验证 DocumentGenerator 接口的四步生命周期在实际使用中是可行的

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm run build` 在包含 `src/panoramic/interfaces.ts` 的项目上零错误通过，确认 DocumentGenerator 和 ArtifactParser 接口定义的 TypeScript 类型正确性
- **SC-002**: 至少一个 Mock Generator 实现 DocumentGenerator 接口的全部四个方法（isApplicable / extract / generate / render），单元测试覆盖全生命周期并全部通过
- **SC-003**: Zod Schema 运行时验证可捕获非法输入——合法数据通过 `schema.parse()` 成功，非法数据（缺失字段、类型错误）抛出 ZodError
- **SC-004**: 现有测试套件（`npm test`）在新增代码后全部通过，无新增失败——证明新接口与现有代码库正交
- **SC-005**: `src/panoramic/interfaces.ts` 中的接口设计与蓝图第 6 章定义的契约概要一致——接口名称、核心方法名、泛型参数设计均匹配

## Clarifications

### Auto-Resolved

| # | 问题 | 影响 | 自动选择 | 理由 |
|---|------|------|---------|------|
| 1 | ProjectContext 是 Feature 035 的交付物，但 034 的接口定义和 Mock Generator 需要引用它——如何处理这一跨 Feature 依赖？ | FR-016 | 在 034 中定义最小占位版本的 ProjectContext（仅含 projectRoot 和 configFiles），Feature 035 负责扩展为完整实现 | 蓝图依赖矩阵明确标注 034 和 035 无相互依赖（可并行），因此 034 不应依赖 035 的完整交付物。最小占位版本既满足编译需求，又保持独立性。Feature 035 可通过扩展（不修改）此占位定义来添加 detectedLanguages、workspaceType 等完整属性 `[AUTO-RESOLVED]` |
| 2 | ArtifactParser 的 `parseAll()` 是否应该有默认实现（遍历调用 parse）？还是强制每个 Parser 独立实现？ | FR-010 | 接口层面仅定义 `parseAll` 方法签名，不在接口中提供默认实现。后续可通过抽象基类（abstract class）提供默认的遍历实现 | TypeScript interface 不支持默认实现。为保持接口的纯粹性（纯契约定义），将默认实现推迟到 Feature 037 实施时的抽象基类中。此决策不影响接口的可用性——Mock Generator 自行实现 parseAll 即可 `[AUTO-RESOLVED]` |

### Session 2026-03-19（需求澄清）

| # | 问题 | 影响 | 自动选择 | 理由 |
|---|------|------|---------|------|
| 3 | GenerateOptions 类型的内部字段未具体化——FR-015 仅提到"LLM 增强开关和模板覆盖"，实现者无法确定最小字段集 | FR-015 | 定义最小字段集：`useLLM`（boolean）、`templateOverride`（string）、`outputFormat`（枚举），后续 Phase 1 各 Generator 通过类型交叉扩展 | 蓝图 6.1 节明确 generate(input, options?) 的 options 为可选参数，034 仅需定义最小可用版本。参考 tech-research 5.1 节降级机制设计，`useLLM` 是核心开关。`templateOverride` 对标现有 Handlebars 模板机制。`outputFormat` 预留但当前仅 markdown `[AUTO-CLARIFIED]` |
| 4 | Zod Schema 的文件组织方式未明确——Schema 应放在 interfaces.ts 同文件还是独立 schemas.ts？ | FR-011, FR-012 | Schema 与接口定义放在同一文件 `src/panoramic/interfaces.ts`，Zod Schema 在前、`z.infer` 推导类型在后 | 现有代码库 `src/models/code-skeleton.ts` 采用 Zod Schema + type 同文件组织模式，034 应保持一致。同文件组织避免 Schema 与 interface 的类型兼容性 drift `[AUTO-CLARIFIED]` |
| 5 | `isApplicable` 返回 `boolean \| Promise<boolean>` 而其他方法均为 `Promise<T>`，是否为有意设计？ | FR-002 | 有意设计——`isApplicable` 支持同步/异步联合返回类型，调用方统一用 `Promise.resolve()` 包装 | 适用性判断通常为轻量检查（如文件是否存在），强制 async 增加不必要开销。参考 LanguageAdapter.buildDependencyGraph 的可选异步模式，此联合类型为不同复杂度的判断提供灵活性 `[AUTO-CLARIFIED]` |
| 6 | Mock Generator 和 Zod Schema 的单元测试文件路径未指定 | FR-022, FR-023 | Mock Generator 测试放 `tests/panoramic/mock-generator.test.ts`，Schema 测试放 `tests/panoramic/schemas.test.ts` | 遵循现有 tests/ 目录结构，新建 `tests/panoramic/` 子目录与 `src/panoramic/` 对称。参考 tests/ 下已有的文件组织模式 `[AUTO-CLARIFIED]` |
