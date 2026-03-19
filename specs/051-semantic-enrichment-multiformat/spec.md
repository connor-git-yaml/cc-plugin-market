# Feature Specification: 语义增强 + 多格式输出

**Feature Branch**: `051-semantic-enrichment-multiformat`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "为 Phase 1 的 Generator 增加 LLM 语义增强和多格式输出两项核心能力"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — DataModelGenerator LLM 语义增强 (Priority: P1)

作为文档消费者，我希望数据模型文档中每个字段都有含义说明，而不是大面积的空白 description，以便快速理解字段的业务含义而无需阅读源码。

当 `useLLM=true` 时，DataModelGenerator 在 `generate()` 阶段收集所有 `description` 为 null 的字段，按模型/文件分组批量调用 LLM 推断说明，并为所有 LLM 生成的说明添加 `[AI]` 前缀标注，使人工注释与机器推断清晰可区分。

**Why this priority**: 这是端到端验证发现的最核心可用性问题——25 个 dataclass 的字段 description 全为 null，导致生成的文档缺乏可读性。此 Story 直接解决文档的核心价值缺失。

**Independent Test**: 对 claude-agent-sdk-python 项目运行 DataModelGenerator（useLLM=true），验证 25 个 dataclass 的字段 description 不再全为 null，且包含 `[AI]` 标注。

**Acceptance Scenarios**:

1. **Given** 一个包含多个 Python dataclass 的项目，字段均无注释（description 为 null），**When** 以 `useLLM=true` 运行 DataModelGenerator，**Then** generate() 输出的 DataModelOutput 中，原本 description 为 null 的字段被填充了 LLM 推断的说明，且每条说明以 `[AI]` 前缀开头。
2. **Given** 部分字段已有人工注释（description 非 null），**When** 以 `useLLM=true` 运行 DataModelGenerator，**Then** 已有人工注释的字段保持不变，仅 description 为 null 的字段被 LLM 补充。
3. **Given** 一个包含 TypeScript interface 的项目，部分 property 有 jsDoc 注释，**When** 以 `useLLM=true` 运行 DataModelGenerator，**Then** 有 jsDoc 的字段保持原有 description，无 jsDoc 的字段被 LLM 补充并标注 `[AI]`。

---

### User Story 2 — ConfigReferenceGenerator LLM 语义增强 (Priority: P1)

作为文档消费者，我希望配置参考手册中每个配置项都有说明文本，以便理解每项配置的作用而无需查阅外部文档。

当 `useLLM=true` 时，ConfigReferenceGenerator 在 `generate()` 阶段收集所有 `description` 为空字符串的配置项，批量调用 LLM 推断说明，并添加 `[AI]` 前缀标注。

**Why this priority**: 与 Story 1 并列最高优先级——pyproject.toml 42 项配置无说明是端到端验证发现的另一个核心可用性问题。两个 Generator 的语义增强逻辑高度一致，应当一同实现以确保体验一致。

**Independent Test**: 对 claude-agent-sdk-python 项目运行 ConfigReferenceGenerator（useLLM=true），验证 pyproject.toml 的 42 项配置有说明文本且含 `[AI]` 标注。

**Acceptance Scenarios**:

1. **Given** pyproject.toml 中 42 项配置的 description 为空，**When** 以 `useLLM=true` 运行 ConfigReferenceGenerator，**Then** generate() 输出的 ConfigReferenceOutput 中，空 description 的配置项被填充 LLM 推断的说明，且以 `[AI]` 前缀开头。
2. **Given** 部分配置项已有注释提取的 description，**When** 以 `useLLM=true` 运行 ConfigReferenceGenerator，**Then** 已有说明的配置项保持不变，仅空 description 的项被补充。

---

### User Story 3 — 多格式输出（JSON + Mermaid） (Priority: P1)

作为集成开发者/自动化工具作者，我希望除了 Markdown 文档外，还能获得结构化 JSON 数据和独立的 Mermaid 源文件，以便程序化消费文档数据或在 VSCode/GitHub 中直接渲染图表。

OutputFormat 扩展为支持 `'json'` 和 `'all'`。当 `outputFormat='all'` 时，调用层为每个 Generator 同时输出 `{name}.md`、`{name}.json`、`{name}.mmd` 三个文件。

**Why this priority**: 与语义增强并列 P1——Mermaid ER 图嵌在 Markdown 中不便阅读是端到端验证发现的第三个核心问题；JSON 输出是程序化消费的基础，两者共同构成多格式输出 MVP。

**Independent Test**: 以 `outputFormat='all'` 运行任意 Generator，验证输出目录中同时生成 `.md`、`.json`、`.mmd` 三个文件，且内容分别为 Markdown 文档、结构化 JSON、独立 Mermaid 图。

**Acceptance Scenarios**:

1. **Given** `outputFormat='all'`，**When** 运行 DataModelGenerator，**Then** 输出目录中生成 `data-model.md`、`data-model.json`、`data-model.mmd` 三个文件。
2. **Given** `outputFormat='json'`，**When** 运行任意 Generator，**Then** 仅输出 `.json` 文件，不生成 `.md` 和 `.mmd`。
3. **Given** `outputFormat='markdown'`（默认值），**When** 运行任意 Generator，**Then** 行为与当前完全一致，仅输出 `.md` 文件。
4. **Given** `outputFormat='all'`，**When** 运行 ConfigReferenceGenerator（不含 Mermaid 图的 Generator），**Then** 输出 `.md` 和 `.json`，不输出 `.mmd`（因为该 Generator 不产生 Mermaid 图）。

---

### User Story 4 — LLM 不可用时的静默降级 (Priority: P2)

作为在无 API Key 环境中运行的用户，我希望即使 LLM 不可用，文档生成也能正常完成（只是缺少 AI 补充的说明），而不会报错中断。

**Why this priority**: 降级保障是可靠性要求，确保 `useLLM=true` 不会成为系统的脆弱点。优先级略低于核心功能，但在核心功能实现后必须立即验证。

**Independent Test**: 在未设置 ANTHROPIC_API_KEY 且未登录 Claude Code 的环境中，以 `useLLM=true` 运行 Generator，验证不报错且输出与 `useLLM=false` 一致。

**Acceptance Scenarios**:

1. **Given** LLM 认证不可用（无 API Key、未登录 CLI），**When** 以 `useLLM=true` 运行 DataModelGenerator，**Then** generate() 正常返回，description 为 null 的字段保持为 null，不抛出异常。
2. **Given** LLM 调用超时或返回错误，**When** 以 `useLLM=true` 运行 ConfigReferenceGenerator，**Then** 超时/错误的批次被静默跳过，已成功推断的说明正常填充，未成功的保持空。

---

### User Story 5 — 零回归保障 (Priority: P2)

作为现有用户，我希望在默认配置（`useLLM=false`，`outputFormat='markdown'`）下，系统行为与变更前完全一致，不产生任何回归。

**Why this priority**: 向后兼容是基本品质要求，与降级保障同属 P2。

**Independent Test**: 以默认选项运行所有现有 Generator，对比变更前后的输出是否一致。

**Acceptance Scenarios**:

1. **Given** `useLLM=false`（默认），**When** 运行 DataModelGenerator，**Then** generate() 不调用任何 LLM 接口，输出与变更前完全一致。
2. **Given** `outputFormat='markdown'`（默认），**When** 运行任意 Generator，**Then** 仅输出 `.md` 文件，不生成额外文件。
3. **Given** `useLLM` 参数未传递，**When** 运行任意 Generator，**Then** `useLLM` 默认为 false，行为与变更前一致。

---

### Edge Cases

- **LLM 批量调用部分失败**：一个批次中若部分字段/配置项的 LLM 推断失败，成功的应正常填充，失败的保持原始空值，不影响整体生成流程。
- **空项目（无模型/无配置）**：当 extract() 返回空数据（models=[] 或 files=[]）时，`useLLM=true` 不应触发任何 LLM 调用（无数据可增强），generate() 正常返回空结果。
- **超大项目**：当字段/配置项数量极大时（如 500+ 字段），批量调用 LLM 应分批处理，避免单次请求 token 超限。
- **JSON 序列化边界**：generate() 返回的 TOutput 中若包含特殊字符（如反斜杠、Unicode），JSON.stringify 应正确处理。
- **Mermaid 图不存在**：若 Generator 的输出不包含 Mermaid 图（如 ConfigReferenceGenerator），`outputFormat='all'` 时不应生成空的 `.mmd` 文件。
- **`[AI]` 前缀不叠加**：若多次运行（如缓存场景），已有 `[AI]` 前缀的 description 不应再次调用 LLM 或重复添加前缀。
- **outputFormat 无效值**：传入未定义的 outputFormat 值时，Zod Schema 验证应拒绝并给出清晰错误信息。

---

## Requirements *(mandatory)*

### Functional Requirements

**LLM 语义增强**

- **FR-001**: DataModelGenerator.generate() MUST 在 `useLLM=true` 时，收集所有 `description` 为 null 的字段，按模型/文件分组批量调用 LLM 推断字段说明。 *(Story 1)*
- **FR-002**: ConfigReferenceGenerator.generate() MUST 在 `useLLM=true` 时，收集所有 `description` 为空字符串的配置项，批量调用 LLM 推断配置说明。 *(Story 2)*
- **FR-003**: 所有 LLM 推断生成的 description MUST 以 `[AI]` 前缀标注，与人工注释明确区分。 *(Story 1, Story 2)*
- **FR-004**: LLM 批量调用 MUST 按模型/文件分组，减少 API 调用次数和 token 消耗。 *(Story 1, Story 2)*
- **FR-005**: LLM 调用 MUST 复用现有的 `src/core/llm-client.ts` 的 `callLLM` 函数。 *(Story 1, Story 2)*
- **FR-006**: 已有人工注释的字段/配置项（description 非空且不以 `[AI]` 开头）MUST 保持不变，不被 LLM 覆盖。 *(Story 1, Story 2)*

**LLM 降级**

- **FR-007**: 当 LLM 不可用（无认证、超时、API 错误）时，系统 MUST 静默降级——不抛出异常，description 保持原始空值，输出与 `useLLM=false` 一致。 *(Story 4)*
- **FR-008**: 批量调用中单个批次失败时，系统 MUST 继续处理后续批次，不中断整体流程。 *(Story 4, Edge Case)*

**多格式输出**

- **FR-009**: OutputFormat MUST 扩展支持 `'json'` 和 `'all'` 两个新枚举值，`'markdown'` 仍为默认值。 *(Story 3)*
- **FR-010**: 当 `outputFormat='json'` 时，系统 MUST 输出 Generator 的结构化数据为 JSON 文件（`{name}.json`）。 *(Story 3)*
- **FR-011**: 当 `outputFormat='all'` 时，系统 MUST 同时输出 `.md`、`.json` 文件；若 Generator 产生 Mermaid 图，还 MUST 输出独立的 `.mmd` 文件。 *(Story 3)*
- **FR-012**: `.mmd` 文件 MUST 仅包含 Mermaid 源代码（如 erDiagram），可被 VSCode Mermaid 插件和 GitHub 直接渲染。 *(Story 3)*
- **FR-013**: 多格式输出 MUST 在调用层（batch/MCP 入口）处理，DocumentGenerator 接口的 `render()` 方法签名 MUST 保持不变。 *(Story 3)*

**向后兼容**

- **FR-014**: `useLLM=false`（默认）时，系统 MUST 不调用任何 LLM 接口，行为与变更前完全一致。 *(Story 5)*
- **FR-015**: `outputFormat='markdown'`（默认）时，系统 MUST 仅输出 `.md` 文件，不生成额外文件。 *(Story 5)*
- **FR-016**: DocumentGenerator 接口签名 MUST 不发生变更。 *(Story 3, Story 5)*

### Key Entities

- **DataModelField**: 数据模型的单个字段，核心属性为 `description`（语义增强的目标字段）。当 LLM 推断后，description 从 null 变为 `[AI] ...` 格式的说明文本。
- **ConfigEntry**: 配置参考的单个配置项，核心属性为 `description`（语义增强的目标字段）。当 LLM 推断后，description 从空字符串变为 `[AI] ...` 格式的说明文本。
- **OutputFormat**: 输出格式枚举，从 `'markdown'` 扩展为 `'markdown' | 'json' | 'all'`。控制调用层输出哪些文件格式。
- **GenerateOptions**: 文档生成通用选项，包含 `useLLM` 和 `outputFormat` 两个关键选项。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对 claude-agent-sdk-python 项目运行 DataModelGenerator（useLLM=true），25 个 dataclass 中原本 description 为 null 的字段，至少 80% 被填充了含 `[AI]` 前缀的说明文本。
- **SC-002**: 对 claude-agent-sdk-python 项目运行 ConfigReferenceGenerator（useLLM=true），pyproject.toml 的 42 项配置中原本 description 为空的项，至少 80% 被填充了含 `[AI]` 前缀的说明文本。
- **SC-003**: `outputFormat='all'` 时，输出目录中包含 `.md`、`.json`、`.mmd`（如适用）三种格式文件，且 `.json` 可被 `JSON.parse()` 成功解析，`.mmd` 可被 Mermaid 渲染器成功渲染。
- **SC-004**: `useLLM=false` 且 `outputFormat='markdown'` 时，所有现有 Generator 的输出与变更前完全一致——零回归。
- **SC-005**: LLM 不可用环境中，`useLLM=true` 不报错，输出与 `useLLM=false` 一致——降级透明。
