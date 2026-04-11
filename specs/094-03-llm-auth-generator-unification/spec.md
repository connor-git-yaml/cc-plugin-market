# Feature Specification: F-094-03 LLM/Auth 依赖收敛与 Generator 接口统一

**Feature Branch**: `feature/089-skill-orchestration-split`
**Created**: 2026-04-11
**Status**: Draft
**关联蓝图**: M-094 Panoramic 架构整洁化里程碑
**前置 Feature**: [F-094-01](../094-01-api-surface-split/spec.md)、[F-094-02](../094-02-panoramic-dir-restructure/spec.md)、[F-094-05](../094-05-mcp-cli-param-symmetry/spec.md)

---

## 1. 背景与问题

### 问题一：LLM 调用链路重复耦合（Part A）

`pattern-hints-generator.ts` 和 `utils/llm-enricher.ts` 各自独立导入同一组四件套函数：`detectAuth`、`callLLMviaCli`、`callLLMviaCodex`、`resolveReverseSpecModel`。两者内部各自实现了约 30 行完全相同的路由逻辑（`detectAuth()` → 分支路由 → 返回 `string | null`）。此外，`extractJsonArray` 工具函数也在两处独立实现。

这一重复导致：
- 任何路由逻辑修改需同时在两处同步
- 单元测试需覆盖相同路径两次
- 对 LLM 后端的理解分散在多处，增加认知负担

**调研关键数据**（来自 [tech-research.md](./research/tech-research.md)）：
- `pattern-hints-generator`：`timeout: 2500ms`，`max_tokens: 1024`，`temperature: 0.2`（速度敏感场景）
- `llm-enricher`：`timeout: 60000ms`，`max_tokens: 4096`，`temperature: 0.3`（批量处理场景）
- 核心路由逻辑完全相同，仅参数不同

### 问题二：6 个模块未实现 DocumentGenerator 接口（Part B）

以下 6 个模块暴露独立函数而非 `DocumentGenerator` 接口实现，无法被 `GeneratorRegistry` 自动发现和管理：

| 模块（F-094-02 后的新路径） | 主入口函数 | 类型 |
|---------------------------|-----------|------|
| `builders/component-view-builder.ts` | `buildComponentView()` | 纯计算型 |
| `builders/dynamic-scenarios-builder.ts` | `buildDynamicScenarios()` | 纯计算型 |
| `pipelines/architecture-narrative.ts` | `buildArchitectureNarrative()` | 纯计算型 |
| `pipelines/adr-decision-pipeline.ts` | `generateBatchAdrDocs()` | 编排+副作用型 |
| `pipelines/product-ux-docs.ts` | `generateProductUxDocs()` | 编排+副作用型 |
| `pipelines/docs-quality-evaluator.ts` | `evaluateDocsQuality()` | 聚合评估型 |

当前 `bootstrapGenerators()` 注册 13 个 Generator，这 6 个模块无法被统一的 Registry 管道驱动，导致 Panoramic 文档生成能力碎片化。

---

## 2. 目标

1. 消除 LLM 调用四件套的重复导入，`src/panoramic/` 内部仅有一处（`llm-facade.ts`）直接依赖底层认证/调用模块
2. 将上述 6 个模块适配为 `DocumentGenerator` 接口实现，纳入 `GeneratorRegistry` 统一管理
3. 全过程保持向后兼容：原有导出函数继续可用，现有测试通过

---

## 3. 方案设计

### Part A：LLM 调用门面（llm-facade）

#### A-1 新增 `llm-facade.ts`

在 `src/panoramic/utils/` 下新增 `llm-facade.ts`，提供统一的 LLM 调用入口：

```typescript
// 调用参数对象，所有字段可选，调用方覆盖默认值
export interface LLMCallOptions {
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
}

// 统一入口函数：内部封装 detectAuth → 路由 → 降级逻辑
export async function callLLM(
  prompt: string,
  options?: LLMCallOptions
): Promise<string | null>
```

**设计约束**：
- `callLLM` 内部封装完整的 `detectAuth()` → 路由到 `callLLMviaCli` / `callLLMviaCodex` / 直接 SDK 调用的逻辑
- `PANORAMIC_LLM_MODEL` 环境变量优先级逻辑（来自 `resolveReverseSpecModel`）必须在 facade 内部保留（F3）
- `timeout`、`maxTokens`、`temperature` 均通过 `LLMCallOptions` 透传，**不可硬编码**（F2）
- 降级语义与现有一致：auth 失败或 LLM 错误时返回 `null`，不抛异常

#### A-2 共享 `extractJsonArray`

`llm-facade.ts`（或 `src/panoramic/utils/`）导出统一的 `extractJsonArray` 工具函数，替代 `pattern-hints-generator.ts` 和 `llm-enricher.ts` 中的两份私有实现（F4）。

#### A-3 改造现有调用方

`pattern-hints-generator.ts` 和 `llm-enricher.ts` 均改为：
```typescript
import { callLLM, extractJsonArray } from '../utils/llm-facade.js';
```
删除各自的四件套 import 和私有路由逻辑，将原 `callPatternHintsLLM` / `callLLMSimple` 替换为对 `callLLM` 的直接调用，保留各自的参数配置（`timeout: 2500` vs `timeout: 60000` 等）。

---

### Part B：Generator 接口适配

#### B-1 通用适配原则

每个 Adapter 类：
- 实现 `DocumentGenerator<TInput, TOutput>` 接口，4 个方法全部必须实现
- 委托模式：`generate()` / `render()` 内部调用现有函数，**不复制逻辑**
- 现有导出函数（`buildComponentView`、`generateBatchAdrDocs` 等）保留为便利快捷方式
- Adapter 类与现有函数**同文件**存放，无需新增文件

#### B-2 纯计算型 Adapter（3 个）

适用模块：`component-view-builder`、`dynamic-scenarios-builder`、`architecture-narrative`

**特点**：无 I/O 副作用，`extract` → `generate` → `render` 三段均为内存计算。

| Adapter 类 | id | TInput | TOutput |
|------------|-----|--------|---------|
| `ComponentViewBuilderGenerator` | `component-view-builder` | `ArchitectureIR` | `ComponentViewOutput` |
| `DynamicScenariosBuilderGenerator` | `dynamic-scenarios-builder` | `ComponentViewModel`（注意：非完整 TOutput，见 F9） | `DynamicScenariosOutput` |
| `ArchitectureNarrativeGenerator` | `architecture-narrative` | `ArchitectureIR` | `NarrativeOutput` |

**`extract` 策略**：从 `ProjectContext` 中提取 IR 子集作为 TInput。options 参数不属于 TInput，在 `generate(input, options?)` 调用时由调用方传入。`dynamic-scenarios-builder` 的 `TInput` 为 `ComponentViewModel`，由 `extract` 从 context 中获取（要求 `component-view-builder` 先运行并将 ViewModel 存入 context）。若 context 中尚无 ViewModel，`isApplicable` 应返回 false 过滤掉此 Generator。

**副作用位置**：`generate()` 和 `render()` 均为纯函数，无副作用。

**`architecture-narrative` 额外处理**：同步补充 `src/panoramic/index.ts` 导出（当前缺失，F8）。

#### B-3 编排+副作用型 Adapter（2 个）

适用模块：`adr-decision-pipeline`、`product-ux-docs`

**特点**：`generateBatchAdrDocs()` / `generateProductUxDocs()` 包含 `fs.writeFileSync` 文件写出副作用（F6）。

**副作用位置决策**：副作用（文件写出）保留在 `generate()` 中，`render()` 专职纯文本渲染（返回索引摘要字符串）。

理由：
- `DocumentGenerator` 接口设计中，`generate()` 负责"产生输出"，文件写出属于核心产出行为而非渲染格式化
- 将副作用移入 `render()` 会违反"render 应为幂等纯渲染"的架构预期
- 现有函数签名包含 `outputDir` 参数，在 `extract` 阶段从 `ProjectContext` 或调用参数中提取，在 `generate()` 中使用

| Adapter 类 | id | `extract` 产物 | `generate()` 行为 | `render()` 行为 |
|------------|-----|--------------|-------------------|----------------|
| `AdrDecisionPipelineGenerator` | `adr-decision-pipeline` | `{ outputDir, context, options }` | 调用 `generateBatchAdrDocs()`，写出 ADR 文件 | 返回 `AdrIndexOutput` 的 Markdown 摘要字符串 |
| `ProductUxDocsGenerator` | `product-ux-docs` | `{ outputDir, context, options }` | 调用 `generateProductUxDocs()`，写出 UX 文档 | 返回文档清单摘要字符串 |

**`isApplicable` 策略**：检查 `ProjectContext` 中是否存在必要的 ADR / UX 相关数据，以及 `outputDir` 是否可写（[推断]，具体检查条件由实现时确认）。

#### B-4 聚合评估型 Adapter（1 个）

适用模块：`docs-quality-evaluator`

**特点**：`evaluateDocsQuality()` 依赖多达 11 个可选上游输出（F7），标准 `extract(context: ProjectContext)` 无法从单一 context 获取所有依赖。

**`extract` 策略：编排感知型**

`extract` 实现为"从 outputDir 读取已生成的 JSON 快照"模式：
```typescript
extract(context: ProjectContext): EvaluateDocsQualityOptions {
  // 从 context 或已输出目录读取 11 个上游产物
  // 每个上游产物均为可选（与原函数参数一致）
  // outputDir 通过 Adapter 构造函数注入（在 bootstrapGenerators 注册时绑定）
  // 构造函数签名: constructor(outputDir: string)
}
```

这一策略依赖 docs-quality-evaluator 在 Generator 管道最后执行（F10），确保上游 JSON 产物已写出。

**`generate()` 行为**：调用 `evaluateDocsQuality(options)` 返回 `DocsQualityReport`，无文件写出副作用。

**`render()` 行为**：将 `DocsQualityReport` 渲染为 Markdown 质量报告字符串。

| Adapter 类 | id | TInput | TOutput |
|------------|-----|--------|---------|
| `DocsQualityEvaluatorGenerator` | `docs-quality-evaluator` | `EvaluateDocsQualityOptions` | `DocsQualityReport` |

#### B-5 GeneratorRegistry 注册顺序

在 `bootstrapGenerators()` 中按依赖图排列注册顺序（F10）：

```
... 现有 13 个 Generator ...
component-view-builder      // 无前置依赖
architecture-narrative      // 无前置依赖
adr-decision-pipeline       // 依赖 IR（与现有 Generator 同级）
product-ux-docs             // 无前置依赖
dynamic-scenarios-builder   // 依赖 component-view-builder 产出
docs-quality-evaluator      // 依赖所有上游，最后注册
```

注册后 `GeneratorRegistry.getInstance().list()` 应返回 **19 个** Generator。

---

## 4. 功能需求（Functional Requirements）

### Part A：LLM 门面

#### FR-A01 [必须] 新增 `llm-facade.ts` 统一入口

**系统 MUST** 在 `src/panoramic/utils/llm-facade.ts` 中实现 `callLLM(prompt, options?)` 函数，封装完整的 `detectAuth → 路由 → 降级` 逻辑。

**必要性标注**: `[必须]` — 无此文件则重复耦合无法消除

---

#### FR-A02 [必须] `LLMCallOptions` 参数透传

**系统 MUST** 通过 `LLMCallOptions` 接口透传 `timeout`、`maxTokens`、`temperature` 等参数，不可在 facade 内硬编码任何默认调用参数（允许设置合理的兜底默认值，但调用方可覆盖）。

**必要性标注**: `[必须]` — 两个调用方的 timeout 差异达 24 倍，硬编码会破坏现有行为

---

#### FR-A03 [必须] 保留 `PANORAMIC_LLM_MODEL` 环境变量优先级

**系统 MUST** 在 `llm-facade.ts` 内部保留 `resolveReverseSpecModel()` 的语义：优先读取 `PANORAMIC_LLM_MODEL` 环境变量作为模型名。

**必要性标注**: `[必须]` — 该配置为用户级运行时配置，遗失会破坏生产使用

---

#### FR-A04 [必须] 消除四件套直接导入

**系统 MUST** 修改 `pattern-hints-generator.ts` 和 `llm-enricher.ts`，移除对 `auth-detector.js`、`cli-proxy.js`、`codex-proxy.js` 的直接导入，改为通过 `llm-facade.ts` 调用。

**目标状态**：`src/panoramic/` 目录（含子目录）中，直接 `import` 上述三个文件的位置仅剩 `llm-facade.ts` 一处。

**必要性标注**: `[必须]` — 这是 Part A 的核心验收标准

---

#### FR-A05 [必须] 导出共享 `extractJsonArray`

**系统 MUST** 从 `llm-facade.ts`（或 `src/panoramic/utils/` 下的独立工具文件）导出统一的 `extractJsonArray` 函数，并移除 `pattern-hints-generator.ts` 和 `llm-enricher.ts` 中的私有重复实现。

**必要性标注**: `[必须]` — 两份私有实现存在行为分歧风险，应收敛为单一事实源

---

#### FR-A06 [必须] 降级语义不变

**系统 MUST** 确保 `callLLM` 在 auth 检测失败、LLM 调用超时或返回错误时，返回 `null` 而不抛出异常，与现有私有函数行为一致。

**必要性标注**: `[必须]` — 上层调用方均按"null = 无 LLM 增强"处理，异常会导致崩溃

---

### Part B：Generator 适配

#### FR-B01 [必须] 为 6 个模块创建 Adapter 类

**系统 MUST** 为以下 6 个模块各创建一个实现 `DocumentGenerator` 接口的 Adapter 类：
- `ComponentViewBuilderGenerator`
- `DynamicScenariosBuilderGenerator`
- `ArchitectureNarrativeGenerator`
- `AdrDecisionPipelineGenerator`
- `ProductUxDocsGenerator`
- `DocsQualityEvaluatorGenerator`

每个类必须实现 `isApplicable`、`extract`、`generate`、`render` 全部 4 个方法。

**必要性标注**: `[必须]` — 这是 Part B 的核心产出

---

#### FR-B02 [必须] 委托模式，保留原有导出函数

**系统 MUST** 采用委托模式实现 Adapter：`generate()` 和 `render()` 内部调用现有函数，不复制业务逻辑。原有导出函数（`buildComponentView`、`buildDynamicScenarios`、`buildArchitectureNarrative`、`generateBatchAdrDocs`、`generateProductUxDocs`、`evaluateDocsQuality`）继续从原模块文件导出，保持向后兼容。

**必要性标注**: `[必须]` — 蓝图验收标准明确要求原函数保持可用

---

#### FR-B03 [必须] 副作用保留在 `generate()` 中

**系统 MUST** 将 `adr-decision-pipeline` 和 `product-ux-docs` 的文件写出副作用保留在 `generate()` 方法中，`render()` 方法必须为纯渲染（无文件 I/O）。

**必要性标注**: `[必须]` — 明确的职责边界是 DocumentGenerator 接口的架构预期；`render()` 幂等性对测试重要

---

#### FR-B04 [必须] docs-quality-evaluator 使用编排感知型 extract

**系统 MUST** 实现 `DocsQualityEvaluatorGenerator.extract()` 为"从 outputDir 读取上游产物 JSON"的策略，能够从 `ProjectContext` 或已输出目录中获取最多 11 个可选上游输出。每个上游输入均为可选，与原 `EvaluateDocsQualityOptions` 接口一致。

**必要性标注**: `[必须]` — 标准 extract 无法满足 11 个上游依赖的聚合需求，此策略是唯一可行路径

---

#### FR-B05 [必须] 注册 6 个新 Adapter 至 GeneratorRegistry

**系统 MUST** 在 `bootstrapGenerators()` 中按依赖顺序注册 6 个新 Adapter，使 `GeneratorRegistry.getInstance().list()` 返回的 Generator 数量从 13 增至 19。

**必要性标注**: `[必须]` — 未注册则 Registry 管道无法驱动这些 Generator

---

#### FR-B06 [必须] 6 个 Adapter 均有 `isApplicable` 测试用例

**系统 MUST** 为每个新 Adapter 的 `isApplicable` 方法提供至少一个"返回 true"和一个"返回 false"的测试用例。

**必要性标注**: `[必须]` — 蓝图验收标准明确要求此测试覆盖

---

#### FR-B07 [必须] 补充 `architecture-narrative` 的 index.ts 导出

**系统 MUST** 在 `src/panoramic/index.ts` 中添加 `architecture-narrative` 模块的导出（当前缺失）。

**必要性标注**: `[必须]` — 缺少导出导致外部消费方无法通过公共 API 访问该功能（F8）

---

#### FR-B08 [可选] 为各 Adapter 提供独立的类型声明文件注释

**系统 MAY** 为每个 Adapter 类添加 JSDoc 注释，说明 TInput / TOutput 的来源语义和 extract 策略。

**必要性标注**: `[可选]` — 有助于未来维护，但不影响功能正确性

---

## 5. 非功能需求（NFR）

### NFR-001 零破坏性变更

Part A 和 Part B 的所有改动不得破坏现有公共 API。`npm run build` 零错误，全量测试零失败。原有导出函数的函数签名不变。

### NFR-002 ESM 模块规范

所有新增文件和修改文件须遵循项目 ESM 规范：`import` 路径使用 `.js` 后缀（如 `from './llm-facade.js'`）。

### NFR-003 `llm-facade.ts` 不引入新外部依赖

`llm-facade.ts` 内部仅依赖已有的 `src/auth/` 模块，不引入任何新的 npm 外部依赖。

### NFR-004 无循环依赖

新增的 `llm-facade.ts` 和 6 个 Adapter 类不得在 `src/panoramic/` 内部形成循环依赖。

### NFR-005 Adapter 不持有状态

6 个 Adapter 类均为无状态实现（无实例变量），方便 Registry 以单例模式管理。[推断]

---

## 6. 用户故事

### User Story 1 - 开发者修改 LLM 调用逻辑只需改一处（Priority: P1）

作为 Panoramic 模块的维护开发者，当我需要调整 LLM 认证路由逻辑或新增一种 LLM 后端时，我希望只修改 `llm-facade.ts` 一个文件，而不是同时修改多个调用方。

**Why this priority**: 这是 Part A 的核心价值。减少重复逻辑是防止未来 Bug 不一致的根本手段。

**Independent Test**: 可通过检查 `src/panoramic/` 目录（含子目录）中对 `auth-detector.js`、`cli-proxy.js`、`codex-proxy.js` 的直接导入数量，确认仅 `llm-facade.ts` 一处导入即视为通过。

**Acceptance Scenarios**:

1. **Given** 修改完成后的代码库，**When** 执行 `grep -r "auth-detector" src/panoramic/ --include="*.ts"`，**Then** 只返回 `utils/llm-facade.ts` 一行结果
2. **Given** 修改完成后的代码库，**When** 查看 `pattern-hints-generator.ts` 的 import 列表，**Then** 不包含对 `auth-detector`、`cli-proxy`、`codex-proxy` 的直接导入
3. **Given** 修改后的 `pattern-hints-generator.ts` 调用 `callLLM`，**When** 传入 `{ timeout: 2500, maxTokens: 1024, temperature: 0.2 }`，**Then** 底层调用行为与修改前一致（降级语义、返回类型不变）

---

### User Story 2 - Generator 管道可统一驱动所有文档生成器（Priority: P1）

作为使用 Panoramic 文档生成框架的开发者，当我通过 `GeneratorRegistry` 获取所有 Generator 并批量执行时，我希望 6 个此前"游离在外"的模块也能被统一管道驱动，而不需要为它们编写单独的调用代码。

**Why this priority**: 这是 Part B 的核心价值，与 P1 Story 1 并列。Registry 的统一性是 Panoramic 框架架构一致性的基础。

**Independent Test**: 可通过 `GeneratorRegistry.getInstance().list().length === 19` 独立验证。

**Acceptance Scenarios**:

1. **Given** Part B 实施完成后，**When** 调用 `GeneratorRegistry.getInstance().list()`，**Then** 返回数组长度为 19
2. **Given** 一个有效的 `ProjectContext`，**When** 对 `ComponentViewBuilderGenerator` 调用 `isApplicable(context)`，**Then** 返回值为 `boolean`（不抛异常）
3. **Given** `AdrDecisionPipelineGenerator`，**When** 调用 `generate(input)`，**Then** ADR 文件被写出到 outputDir，且函数返回 `AdrIndexOutput` 结构

---

### User Story 3 - 原有调用方代码无需修改（Priority: P1）

作为依赖 `generateBatchAdrDocs`、`evaluateDocsQuality` 等函数的现有调用方，当 Part B 完成后，我的代码无需任何修改即可继续运行。

**Why this priority**: 零破坏性变更是硬性约束，与前两个 P1 Story 同等重要。

**Independent Test**: 全量测试套件通过即可验证。

**Acceptance Scenarios**:

1. **Given** 现有测试套件，**When** Part A + Part B 实施完成后运行 `npm test`，**Then** 全部测试通过，无回归失败
2. **Given** `pattern-hints-generator.test.ts`，**When** 运行测试，**Then** 所有用例通过（LLM 调用路径经由 facade 但行为不变）
3. **Given** 外部代码调用 `import { generateBatchAdrDocs } from '...'`，**When** 运行时，**Then** 函数仍可调用，行为不变

---

### Edge Cases

- **`PANORAMIC_LLM_MODEL` 环境变量未设置时**：`llm-facade.ts` 应降级使用默认模型解析逻辑，与现有 `resolveReverseSpecModel()` 行为完全一致。
- **`callLLM` 调用时 auth 全部失败**：返回 `null`，不抛异常，上层调用方的降级处理逻辑不变。
- **`dynamic-scenarios-builder` 的 `extract` 依赖 `ComponentViewModel`**：若 context 中尚无 `ComponentViewModel`，`extract` 应在内部调用 `buildComponentView` 生成，或返回 null 使 `isApplicable` 预先过滤。[推断]，实现时需确认具体策略。
- **`docs-quality-evaluator` 上游产物部分缺失**：`extract` 读取 outputDir 时某些 JSON 文件不存在，应返回对应字段为 `undefined` 的 `EvaluateDocsQualityOptions`，与原函数的"全可选"语义一致，不中断评估流程。
- **`bootstrapGenerators()` 注册顺序隐式依赖**：若 `docs-quality-evaluator` 在上游 Generator 前注册并立即执行，outputDir 中无 JSON 产物可读。应通过注册顺序（最后注册）或在 `isApplicable` 中检查前置产物存在性来规避。
- **`architecture-narrative` 补充 `index.ts` 导出时可能引发类型名称冲突**：需检查现有导出中是否已有同名符号。

---

## 7. 验收标准

| 编号 | 标准 | 验证方式 |
|------|------|----------|
| AC-001 | `src/panoramic/` 目录（含子目录）中，直接 import `auth-detector.js` / `cli-proxy.js` / `codex-proxy.js` 的文件仅有 `utils/llm-facade.ts` | `grep -r "auth-detector\|cli-proxy\|codex-proxy" src/panoramic/ --include="*.ts"` 仅返回 `llm-facade.ts` |
| AC-002 | `GeneratorRegistry.getInstance().list()` 返回 Generator 数量为 19 | 单元测试断言 `registry.list().length === 19` |
| AC-003 | 6 个新 Adapter 均有 `isApplicable` 的 true/false 测试用例 | 测试文件覆盖率检查，每个 Adapter 至少 2 个 `isApplicable` 用例 |
| AC-004 | 原有 6 个导出函数均可继续调用 | 集成测试或编译时类型检查验证函数签名存在 |
| AC-005 | `pattern-hints-generator.test.ts` 全量通过 | `npm test -- pattern-hints` 零失败 |
| AC-006 | `llm-enricher` 相关测试全量通过 | `npm test -- llm-enricher` 零失败 |
| AC-007 | `npm run build` 零错误完成 | CI 构建日志 |
| AC-008 | `src/panoramic/index.ts` 新增 `architecture-narrative` 导出 | `grep "architecture-narrative" src/panoramic/index.ts` 返回结果 |
| AC-009 | `adr-decision-pipeline` 和 `product-ux-docs` 的 `render()` 方法无文件写出副作用 | 代码审查：render() 方法体中无 `fs.` 调用 |
| AC-010 | 全量测试套件无回归失败 | `npm test` 输出全绿 |

---

## 8. 影响范围

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `src/panoramic/utils/llm-facade.ts` | LLM 调用统一门面（Part A 核心产出） |

### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/panoramic/generators/pattern-hints-generator.ts` | 移除四件套 import，改用 `callLLM` 和共享 `extractJsonArray` |
| `src/panoramic/utils/llm-enricher.ts` | 移除四件套 import，改用 `callLLM` 和共享 `extractJsonArray` |
| `src/panoramic/builders/component-view-builder.ts` | 新增 `ComponentViewBuilderGenerator` 类 |
| `src/panoramic/builders/dynamic-scenarios-builder.ts` | 新增 `DynamicScenariosBuilderGenerator` 类 |
| `src/panoramic/pipelines/architecture-narrative.ts` | 新增 `ArchitectureNarrativeGenerator` 类 |
| `src/panoramic/pipelines/adr-decision-pipeline.ts` | 新增 `AdrDecisionPipelineGenerator` 类 |
| `src/panoramic/pipelines/product-ux-docs.ts` | 新增 `ProductUxDocsGenerator` 类 |
| `src/panoramic/pipelines/docs-quality-evaluator.ts` | 新增 `DocsQualityEvaluatorGenerator` 类 |
| `src/panoramic/generator-registry.ts` | `bootstrapGenerators()` 新增 6 个 Adapter 注册 |
| `src/panoramic/index.ts` | 新增 `architecture-narrative` 导出 |

### 不受影响的文件

- `src/auth/auth-detector.ts`、`src/auth/cli-proxy.ts`、`src/auth/codex-proxy.ts`：不修改，仅 `llm-facade.ts` 依赖它们
- `src/panoramic/interfaces.ts`：`DocumentGenerator` 接口定义不变
- 其余已有 13 个 Generator 实现：不修改

---

## 9. 风险与缓解

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| `callLLM` facade 引入行为差异，导致 LLM 调用结果与原有私有函数不一致 | 高 | 改造完成后对比运行 `pattern-hints-generator.test.ts` 和 `llm-enricher` 测试；实现时优先对比原私有函数逻辑逐行核查 |
| `docs-quality-evaluator` 的 extract 策略在上游产物未生成时静默返回空数据 | 中 | `isApplicable` 检查 outputDir 中必要的上游 JSON 是否存在；或在 extract 返回空时 generate 快速跳出并返回空报告 |
| `dynamic-scenarios-builder` extract 依赖 ComponentViewModel 导致隐式 extract 执行开销 | 中 | 明确 `isApplicable` 检查条件，避免在不适用时执行昂贵的 extract；[推断] 实现时复核 |
| `bootstrapGenerators()` 注册顺序调整破坏现有隐式顺序依赖 | 中 | 新增 Generator 追加在末尾，不调整现有 13 个的注册顺序 |
| Part B 的 Adapter 与现有函数同文件，增加文件体积 | 低 | 接受权衡；如后续文件超过合理长度，可在 F-094-04 时随索引收缩一并处理 |

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|-----|------|
| 组件总数 | 7 | 1 个新文件（llm-facade.ts）+ 6 个新 Adapter 类 |
| 接口数量 | 2 | 新增 `LLMCallOptions` 接口 + `extractJsonArray` 导出函数（不修改现有 `DocumentGenerator` 接口） |
| 依赖新引入数 | 0 | 不引入任何新 npm 外部依赖，仅整合已有 `src/auth/` 模块 |
| 跨模块耦合 | 是（受控） | 修改 10 个现有文件，但多数为追加内容（新增类），不修改现有函数逻辑 |
| 复杂度信号 | 1 | `docs-quality-evaluator` 的编排感知型 extract 涉及文件系统读取和多上游聚合，属于状态感知逻辑 |
| **总体复杂度** | **MEDIUM** | 组件 7 个（超过 LOW 阈值 3），接口 2 个，存在 1 个复杂度信号；但无新外部依赖，无递归/状态机/并发控制/数据迁移 |

> **MEDIUM 复杂度判定理由**：Part A 为机械性重构（移除重复、抽取 facade），风险可控；Part B 的 6 个 Adapter 中 5 个为直接委托，复杂度来源主要是 `docs-quality-evaluator` 的编排感知型 extract 策略，需要对上游产物目录结构有精确理解。建议实现前先确认 outputDir 约定和 JSON 产物的文件命名规范。

---

## 澄清记录

### Session 2026-04-11

| ID | 问题 | 决议 | 状态 |
|----|------|------|------|
| Q-01 | `extractJsonArray` 放置位置歧义：FR-A05 给出两个选项 | 放在 `llm-facade.ts` 内部导出。A-3 节示例 import `from '../utils/llm-facade.js'` 为隐含约定 | 已确认 |
| Q-02 | `callLLM` 第三路由"直接 SDK 调用"的触发条件未定义 | 第三路由触发条件与现有 `detectAuth` 返回值语义完全对齐，facade 复制现有路由逻辑 | 已确认 |
| Q-03 | `adr-decision-pipeline` 和 `product-ux-docs` 的 `isApplicable` 检查条件 | `isApplicable` 检查 ProjectContext 中相关 IR 数据是否存在，不检查 outputDir 可写性 | 已确认 |
| Q-04 | `outputDir` 来源策略 | 通过 Adapter 构造函数注入（`bootstrapGenerators` 注册时绑定），与 docs-quality-evaluator 策略一致 | 已确认 |
| Q-05 | `architecture-narrative` 补充导出时潜在符号冲突 | 实施前 `grep` 检查现有 index.ts 导出，确认无同名符号 | 已确认 |
| Q-06 | `dynamic-scenarios-builder` 的 `extract` 依赖策略 | 选项 A：extract 纯读取 context 中已有 ViewModel（要求 component-view-builder 先运行），`isApplicable` 检查 ViewModel 是否已存在 | 已确认 |

> Q-06 原为 CRITICAL 待确认项。基于 B-5 注册顺序（`component-view-builder` 在 `dynamic-scenarios-builder` 之前注册）和 extract 纯读取语义一致性，决定采用选项 A。
