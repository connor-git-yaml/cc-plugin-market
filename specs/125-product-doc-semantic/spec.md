# Feature Specification: 产品文档语义化增强

**Feature Branch**: `125-product-doc-semantic`
**Created**: 2026-04-18
**Status**: Draft
**Input**: User description: "基于 Fix 124 revert postmortem 和双路对抗性审查结论，重新设计产品文档语义化能力。核心问题：product-ux-docs 流水线在 HTML-heavy README、CJK 语料、泛型/占位符 Markdown 上质量差或主动破坏事实源。"

## User Scenarios & Testing *(mandatory)*

<!--
  本 feature 的"用户"有两类：
  - **直接用户**：运行 Spectra 的开发者/平台工程师，生成产品文档消费其输出
  - **下游用户**：产品经理、技术写作者、新团队成员，阅读生成的 product-overview.md / user-journeys.md / feature-briefs/ 理解项目
  用户故事按对下游阅读体验的影响优先级排序。
-->

### User Story 1 - 用户旅程"消费输出"反映场景的真实结果 (Priority: P1)

当开发者在 Python/TypeScript/多语言项目上运行 Spectra 批量生成产品文档后，阅读 `user-journeys.md` 的人应当看到每条旅程的"消费输出"步骤描述**该旅程场景的真实结果**，而不是雷同的通用模板字符串。

**Why this priority**: 这是双路对抗性审查中唯一同时被 Codex 和 Claude 标记为 HIGH 的问题。修复前（和 Fix 124 的错误修复后）在 Khoj 项目上 4 条旅程的"消费输出"100% / 75% 雷同；在 Graphify 上是 100% 雷同。阅读者完全无法从文档获取信息——这是产品文档的核心价值 failure。

**Independent Test**: 可以独立测试：给定一个项目，运行 Spectra，检查 `user-journeys.md` 里所有旅程的"消费输出"文本**雷同率**（identical text ratio），无需其他模块修复即可交付价值。

**Acceptance Scenarios**:

1. **Given** Khoj 项目（4 条 README feature-list 衍生场景），**When** 运行 `spectra batch --include-docs`，**Then** `user-journeys.md` 中所有旅程的"消费输出"文本雷同率 < 30%（即至少 3 条内容彼此不同）。
2. **Given** Graphify 项目（Python 工具，scenario 词汇不落在 chat/export/search 等模板桶内），**When** 运行 `spectra batch --include-docs`，**Then** "消费输出"不使用 fallback 通用句子，而是从 `scenario.summary` 或 `evidence.excerpt` 中提取具体描述。
3. **Given** 本仓库 `specs/products/spec-driver/current-spec.md` 中的场景 `批量项目文档化`（summary 提到生成 product-overview 等），**When** 生成 `user-journeys.md`，**Then** "消费输出"**不会**错误地出现 "数据已同步或索引更新完成" 或类似无关语句。

---

### User Story 2 - 产品文档不破坏 Markdown 中合法的尖括号内容 (Priority: P1)

当开发者的 README / design-doc / current-spec.md 中包含 TypeScript 泛型、CLI 占位符或路径模板（如 `Array<T>`、`<target>`、`specs/<feature-id>/`）时，生成的 `product-overview.md` 应**保留这些内容的可读性**，而不是把它们剥除或损坏。

**Why this priority**: 双路审查独立找到的 CRITICAL 问题。Spectra 本仓库的 Markdown 事实源（README.md / specs/*/spec.md / specs/products/*/current-spec.md）都大量使用尖括号语法。Fix 124 的粗暴 `<[^>]+>` 正则会把 `DocumentGenerator<RuntimeTopologyInput, RuntimeTopologyOutput>` 静默变成 `DocumentGenerator`，把 `specs/<feature-id>/` 变成 `specs//:`——这是**数据损坏**，比修复前的 HTML 残留更隐蔽。

**Independent Test**: 可以独立测试：构造一个 README fixture 同时包含真实 HTML block（`<p>`/`<div>`/`<img>`）和合法尖括号内容（`<target>` / `Array<T>` / `< 5ms`），运行生成器，检查输出既剥除了 HTML 又保留了合法内容。

**Acceptance Scenarios**:

1. **Given** README 以 `<p align="center"><img src="...logo.png">` 开头 + 正文段含 `Response time < 5ms`，**When** 生成 `product-overview.md`，**Then** HTML 块被剥除，`< 5ms` 内容**保留**。
2. **Given** spec 文件含 `spectra generate <target> --deep`，**When** 生成产品文档，**Then** 输出中保留 `<target>` 占位符（不被剥除）。
3. **Given** 文档含 TypeScript 泛型 `DocumentGenerator<RuntimeTopologyInput, RuntimeTopologyOutput>`，**When** 生成产品文档，**Then** 泛型参数**保留完整**。
4. **Given** 文档含 `<details><summary>点击展开</summary>...</details>`，**When** 生成产品文档，**Then** 系统至少保留摘要文字（不完全丢失语义节点——移除折叠交互但保留内容）。

---

### User Story 3 - CJK 语料不被文本工具误处理 (Priority: P1)

当项目的主要事实源（README、current-spec.md、design-doc）是中文/日文/韩文文档时，文本截断、段落过滤等操作应**正确处理无空格的表意文字**，而不是降级为按字符硬截断或直接过滤整段。

**Why this priority**: 本仓库（中文为主）自己的 `specs/products/*/current-spec.md` 就是主要受害语料。Fix 124 的 `truncateAtWordBoundary` 在中文上退化为硬截断（函数名误导），`isDescriptiveParagraph` 的 `wordCount = split(/\s+/).length` 对中文段落值为 1，配合任何 Markdown 链接都会把整段过滤掉。Spectra 的使用者主要在中文语境下工作，这是生产问题。

**Independent Test**: 可以独立测试：构造一段长中文段落 + 含一个 markdown 链接，验证该段落**不被过滤**；构造一个长中文标题触发截断，验证截断点**落在句子/词语边界**（如中文逗号/句号/标点）而非任意字符位置。

**Acceptance Scenarios**:

1. **Given** 一段 100+ 字的中文描述性段落包含 `详情见[文档](url)`，**When** 段落参与 `product-overview.md` 摘要选择，**Then** 该段落**不被** isDescriptiveParagraph 过滤掉。
2. **Given** 一条 120 字的中文场景标题，**When** 需要截断到 80 字，**Then** 截断点落在标点（句号/逗号/顿号）或词边界（如"批量项目"之间），而非任意字符中间。
3. **Given** 本仓库 `specs/products/spec-driver/current-spec.md:106+` 的长中文段落，**When** 纳入产品文档事实源，**Then** 文本内容不被按英文空格规则误拆分或误过滤。

---

### User Story 4 - 可选的 LLM 语义增强（零硬编码兜底可用时不丢精度） (Priority: P2)

当环境具备 LLM 能力（Anthropic API / Codex CLI / Claude CLI）时，产品文档生成应**可选地调用 LLM** 为"消费输出"、"outcome"等语义字段提供更自然的推断，但在无 LLM 可用时应优雅降级到 AST-only 路径，保持文档仍可生成。

**Why this priority**: 项目 CLAUDE.md 明确主线焦点是 panoramic Phase 1 的 LLM 语义增强。Story 1 的 evidence-backed mapping 已经能从场景事实源提取描述（不依赖 LLM），Story 4 是锦上添花——在有 LLM 的环境下进一步提升质量。

**Independent Test**: 可以独立测试：在 `ANTHROPIC_API_KEY` 存在时 vs 不存在时分别生成同一项目的 `user-journeys.md`，验证两者都能完成生成（降级路径可用），且 LLM 路径的内容质量（雷同率、信息密度）优于 AST-only 路径。

**Acceptance Scenarios**:

1. **Given** 环境无 LLM 认证，**When** 运行 `spectra batch --include-docs`，**Then** 文档生成**成功完成**，使用 Story 1 的 evidence-backed 映射，不抛异常。
2. **Given** 环境有 LLM 认证，**When** 运行生成，**Then** 旅程"消费输出"内容可能由 LLM 增强（具体实现可选是否接入）。
3. **Given** LLM 调用失败（超时 / 限流 / 错误响应），**When** 生成流程进行中，**Then** 自动降级到 AST-only 路径，不中断整体批量。

---

### Edge Cases

- **事实源完全为空**：项目无 README 无 current-spec 无 design-doc——此时产品文档应明确警告"事实源不足"，不产生误导性的推断内容
- **场景有但 summary 为空**：`scenario.summary` 为空但 `scenario.title` 存在——"消费输出"应基于 title 推断，而非 fallback 到通用模板
- **单字符/极短标题**：截断函数对 `maxLen > text.length` 的情况应直接返回原文，不加省略号
- **Markdown 嵌入的代码块中的 HTML 示例**：如 React 教程常见 ` ```jsx\n<Button onClick={...}>Click</Button>\n``` `——代码块内容应被 extractParagraphs 跳过，不被 HTML strip 处理
- **CJK 标点混排**：中英混排场景（如 `生成 user-journeys.md 和 product-overview.md`），截断应能正确识别两种标点边界
- **大量重复场景**：Khoj 有 10+ 条 README feature-list，但 scenarios.slice(0, 5) 只取前 5 条——旅程去重逻辑应避免产生"内容相似度 > 80% 的重复旅程"

## Requirements *(mandatory)*

### Functional Requirements

#### FR-001 ~ FR-005: Evidence-Backed Mapping（对应 Story 1）

- **FR-001**: 用户旅程的"消费输出"字段 MUST 基于 `scenario.summary` 或 `scenario.evidence.excerpt` 中的具体文本，而非仅基于预定义模板字符串。
- **FR-002**: 当 `scenario.summary` 存在且长度 ≥ 20 字时，系统 MUST 从 summary 中提取一句作为"消费输出"。
- **FR-003**: 当 summary 缺失或过短时，系统 MUST 从 `scenario.evidence[0].excerpt` 中提取描述。
- **FR-004**: 当两者都缺失时，系统 MAY 返回低置信度的通用 fallback（但此路径必须在 warnings 中记录）。
- **FR-005**: 旅程"outcome"字段 MUST 反映场景完成后的**状态变化**，而不是简单复述场景标题。

#### FR-006 ~ FR-010: Block-Level HTML Sanitization（对应 Story 2）

- **FR-006**: HTML 净化 MUST 只处理行首锚定的 HTML block（`<p>`, `<div>`, `<img>`, `<details>` 等），不处理行内任意尖括号。
- **FR-007**: 系统 MUST 保留 Markdown 中合法的尖括号内容，包括但不限于：
  - TypeScript 泛型（`Array<T>`, `Map<K, V>`, `DocumentGenerator<Input, Output>`）
  - CLI 占位符（`<target>`, `<feature-id>`, `<branch>`）
  - 数值比较（`< 5ms`, `> 100%`, `a < b`）
- **FR-008**: 系统 MUST 保留 HTML entity 编码的文字内容（`&lt;`, `&amp;` 应被解码为 `<` 和 `&`）。
- **FR-009**: Markdown fenced code block（` ```lang ... ``` `）内的内容 MUST 不被 HTML sanitization 处理。
- **FR-010**: 对于语义节点（如 `<details>/<summary>`），系统 MUST 保留内部文字内容（不是粗暴剥除全部）。

#### FR-011 ~ FR-015: CJK-Aware Text Processing（对应 Story 3）

- **FR-011**: 文本截断（truncation）MUST 使用 Unicode 感知的分段（Unicode segmentation），对 CJK 文本在自然断点（标点、字符边界）截断。
- **FR-012**: 段落过滤的"描述性段落"判定 MUST NOT 依赖按 ASCII 空格分词的 word count；对无空格分隔的 CJK 段落应使用字符数或 Unicode 分段词数。
- **FR-013**: 段落过滤的"纯链接段落"判定 MUST 按**链接字符数 / 段落总字符数**的比例判断，而非按 word count。
- **FR-014**: 截断函数 MUST 在文本长度 ≤ maxLen 时直接返回原文，不添加省略号。
- **FR-015**: 截断函数 MUST 对 CJK 标点（`，`, `。`, `、`, `；`, `：`, `！`, `？`）和英文标点（`,`, `.`, `;`, `:`）都识别为自然边界。

#### FR-016 ~ FR-020: LLM Enhancement with Graceful Degradation（对应 Story 4）

- **FR-016**: 系统 MAY 支持 LLM 语义增强路径（opt-in via config / env），但 MUST NOT 默认启用。
- **FR-017**: 当 LLM 路径启用时，系统 MUST 实现超时后降级；LLM 错误响应时必须降级。
- **FR-018**: LLM 路径降级时 MUST 使用 FR-001~FR-005 定义的 evidence-backed mapping。
- **FR-019**: 无论使用 AST-only 还是 LLM 路径，输出文档的**结构**（章节标题、字段存在性）MUST 完全一致——只有内容质量不同。
- **FR-020**: 系统 MUST 在生成的文档 front-matter 或 warnings 中记录"使用的增强路径"（e.g. `enhancement: llm | ast-only`）。

#### FR-021 ~ FR-025: 测试与验证（横切）

- **FR-021**: 测试 MUST 包含对抗性 fixture：HTML-heavy README、CJK 长段落、`Array<T>` / `<target>` 占位符、`<details>`/`<summary>`。
- **FR-022**: 测试 MUST 包含本仓库 `specs/products/*/current-spec.md` 的真实场景作为 regression fixture。
- **FR-023**: 测试 assertions MUST 锁定语义行为（不是"是否包含某关键字符串"），例如检查雷同率、保留字符存在、截断边界正确。
- **FR-024**: 测试 MUST 包含反向用例：fallback 路径是否被正确触发、错误输入是否被优雅处理。
- **FR-025**: 生成文档 MUST 在 Khoj、Graphify 两个已知项目上通过对比基线（修复前 vs 修复后）验证改善幅度。

### Key Entities

- **ProductScenario**：`{ id, title, summary, actors, evidence, confidence, inferred }` — 产品场景，是旅程的事实源；`summary` 是核心字段，当前被浪费
- **UserJourneyStep**：`{ title, detail, inferred }` — 旅程步骤（触发/动作/消费输出）；`detail` 当前被硬编码，需要从 scenario 事实推导
- **ProductEvidenceRef**：`{ sourceType, label, path, excerpt, confidence, inferred }` — 事实引用，`excerpt` 是实际文本内容，是 evidence-backed mapping 的原料
- **ProductFactCorpus**：`{ currentSpecs, readmes, designDocs, commits, warnings }` — 事实源聚合，需要考虑 HTML 净化边界、CJK 过滤
- **TextSegment**（新抽象）：Unicode 感知的文本片段，封装分段/截断/边界识别逻辑

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001（对应 Story 1）**：在 Khoj、Graphify、本仓库（Spectra 自身）三个项目上生成 `user-journeys.md`，所有旅程的"消费输出"字段**文本雷同率 < 30%**（即任意两条旅程的消费输出文字相同的比例低于 30%）。
- **SC-002（对应 Story 1）**：本仓库 `specs/products/spec-driver/current-spec.md` 中的 `批量项目文档化`、`仓库治理`、`产品与 UX 文档补全` 三个场景生成的"消费输出"**语义正确率 100%**（不出现如"数据已同步"等事实错误）。
- **SC-003（对应 Story 2）**：给定包含 `<p>/<div>/<img>` HTML block 和 `Array<T>` / `<target>` / `< 5ms` / `specs/<feature-id>/` 合法内容的测试 fixture，生成的产品文档中：HTML block **剥除率 = 100%**，合法尖括号内容 **保留率 = 100%**。
- **SC-004（对应 Story 2）**：本仓库 `README.md`、`specs/products/*/current-spec.md` 作为事实源时，输出产品文档中 `<target>`、`<feature-id>`、TypeScript 泛型等内容**不被破坏**。
- **SC-005（对应 Story 3）**：CJK 测试 fixture（100+ 字中文段落 + markdown link）在段落过滤后**保留率 = 100%**（不被 isDescriptiveParagraph 误过滤）。
- **SC-006（对应 Story 3）**：长中文标题（120+ 字）截断到 80 字时，截断点**落在标点或 Unicode 词边界**的比例 ≥ 95%（通过检查截断点前一字符是否为空格/标点/分段边界）。
- **SC-007（对应 Story 4）**：在无 LLM 环境下 `spectra batch --include-docs` **全量执行成功**，不抛异常，不产生空文档。
- **SC-008（对应 Story 4）**：LLM 路径遭遇超时/错误时 **100% 降级到 AST-only**，不中断整体批量。
- **SC-009（全局）**：所有修复完成后，`npx vitest run` 通过率 **100%**（现 1579/1579 基线），并新增至少 **15 个回归测试**（覆盖 FR-021 ~ FR-024）。
- **SC-010（全局）**：修复后 Spectra 在自身仓库上生成的 `product-overview.md` 作为阅读产物——由人类产品经理审阅——主观评分：**"内容比修复前显著更可读"的比例 ≥ 80%**（通过 3 人小样本评审达成）。

## Assumptions

基于缺失信息的合理假设：

1. **可用 Unicode 分段能力**：假设运行时 Node.js ≥ 16（package.json 要求 20+），具备 `Intl.Segmenter` API。若未来需要支持更老环境可增加 fallback。
2. **无新增重量级依赖**：假设修复优先使用标准库（`Intl.Segmenter`）和轻量工具库（如现有 `marked` 生态），避免引入如 `sanitize-html`（带 jsdom 依赖）等重型包。
3. **LLM 路径为 opt-in**：假设默认关闭 LLM 增强路径以保持 CLI 运行稳定，只有显式配置或环境变量启用。
4. **Markdown 解析器选择**：假设可用现有 `marked` 库（package.json 已含）进行 block-level HTML 识别，避免自己实现 HTML parser。
5. **测试项目语料**：假设 Khoj 和 Graphify 的 README/项目结构**在本次 feature 迭代期间不发生变化**（端到端基线对比有效）。
6. **保留现有接口**：假设 `generateProductUxDocs` 的入参/返回类型**不变**（`GenerateProductUxDocsOptions` / `GenerateProductUxDocsResult`），只改实现；本 feature 不涉及调用方适配。

## Dependencies

- Fix 124 已 revert（commit `c607d54`），本 feature 基于 Fix 123 基线（commit `93b5811`）开始
- Fix 120-123 已完成（batch 引擎、event-surface、cross-reference index 等）
- 双路对抗性审查报告（Codex `b8o603iot`、Claude `a488237593a4f902b`）作为设计参考

## Out of Scope

本 feature **不处理**以下相关但独立的问题：

- "README feature-list → 用户旅程" 这个抽象本身是否合理（Claude 审查的 MAJOR M1）——这是更深的架构问题，应另开 feature
- `feature-briefs` 的生成质量（本 feature 只聚焦 `product-overview` + `user-journeys`）
- 产品文档的视觉呈现（Mermaid 图、表格格式等）
- 跨语言项目（ts-js + python + java）的事实源优先级策略
- `targetUsers` 目标用户识别的准确性改善（当前只识别出"开发者"这一单一角色）
