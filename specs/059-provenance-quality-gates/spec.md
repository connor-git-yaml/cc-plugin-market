# Feature Specification: Provenance 与文档质量门

**Feature Branch**: `059-provenance-quality-gates`  
**Created**: 2026-03-21  
**Status**: Draft  
**Input**: User description: "推进 059"

## User Scenarios & Testing

### User Story 1 - 为 explanation 型文档补来源追踪与可信度 (Priority: P1)

作为维护者或审查者，我希望 `architecture-narrative`、`component-view`、`dynamic-scenarios`、ADR 等 explanation 型文档里的结论都能追溯到来源类别和证据，而不是只看到一句“low confidence”。

**Why this priority**: 059 的第一目标是把“文档看起来合理”提升为“文档可追溯、可复核”；如果没有 provenance，后续 quality gate 只能做表面评分。

**Independent Test**: 对已有 045/050/057/058 输出的 fixture 运行 059，验证 narrative / component / dynamic / ADR 至少一种 explanation 型文档能带出处类别、evidence 和 confidence。

**Acceptance Scenarios**:

1. **Given** 一个已生成 `architecture-narrative`、`component-view`、`dynamic-scenarios` 和 ADR 的项目输出目录，**When** 运行 059，**Then** explanation 型文档中的关键结论必须带来源类别和 evidence 引用，而不是仅输出纯文本判断。
2. **Given** 某条结论只来自推断或弱证据，**When** 059 生成 provenance，**Then** 该结论必须标记 `inferred` 或低置信度，而不能伪装成确定事实。

---

### User Story 2 - 对冲突事实给出显式质量报告 (Priority: P1)

作为维护者，我希望当 README、`current-spec.md`、生成文档和代码派生事实之间出现矛盾时，系统能明确列出冲突，而不是静默选择其中一个版本。

**Why this priority**: 蓝图明确把 059 定位成治理层；如果冲突仍靠人工肉眼发现，文档系统就不具备可信度前置能力。

**Independent Test**: 构造一个 README 与 `current-spec.md` 对产品定位或运行时边界描述冲突的 fixture，运行 059 并验证 `quality report` 显式列出冲突记录。

**Acceptance Scenarios**:

1. **Given** README 和 `current-spec.md` 对同一产品定位给出不同表述，**When** 运行 059，**Then** quality report 中必须出现 conflict 项并引用两个来源。
2. **Given** `architecture-narrative` 与 `runtime-topology` 对运行时宿主或部署边界描述不一致，**When** 运行 059，**Then** quality report 必须记录冲突而不是只保留 warning。

---

### User Story 3 - 按项目类型校验最低文档集合 (Priority: P1)

作为文档发布者，我希望系统能按项目类型给出最低 required-doc 集合，并告诉我当前缺了哪些关键文档，而不是让我靠记忆判断“这个仓库到底还缺不缺 runtime / ADR / component view”。

**Why this priority**: 059 不只是做 provenance，还要把 bundle / panoramic / ADR 等产物组织成可审核的交付面；required-doc rule set 是治理闭环的核心。

**Independent Test**: 对 monorepo、runtime project 和普通库项目的 fixture 分别运行 059，验证 quality report 会输出不同的 required-doc 规则和缺失项。

**Acceptance Scenarios**:

1. **Given** 一个带 runtime / deployment 事实的项目，**When** 运行 059，**Then** required-doc 集合中必须包含 `runtime-topology`、`architecture-overview`、`component-view`、`dynamic-scenarios` 等运行时相关文档。
2. **Given** 一个只有部分 panoramic 输出的项目，**When** 运行 059，**Then** 系统必须明确列出缺失 required docs，并给出整体覆盖度或状态。

---

### User Story 4 - 批量主链路保持兼容并在依赖缺失时保守降级 (Priority: P2)

作为维护者，我希望 059 接入 batch 后，不会破坏现有模块 spec、panoramic 文档、ADR 输出；如果 055 bundle manifest 或 `current-spec.md` 不存在，系统应输出 partial report 和 warning，而不是让整次 batch 失败。

**Why this priority**: 059 是治理层，不是新的事实抽取主链；它必须站在已有输出上工作，并对缺失输入降级。

**Independent Test**: 运行 batch 集成测试，验证原有项目级文档仍正常生成，同时新增 quality report；缺失 055 / current-spec 时只影响 059 自身结论，不影响整个 batch 返回成功。

**Acceptance Scenarios**:

1. **Given** 一个已能生成 053/056/057/058 输出的 fixture，**When** 运行 `runBatch()`，**Then** 原有输出仍保持可用，并新增 059 的质量报告产物。
2. **Given** 当前分支或输出目录中没有 055 bundle manifest，**When** 运行 059，**Then** 系统必须标记 dependency warning 或 partial required-doc coverage，而不是整体失败。

### Edge Cases

- 当 `current-spec.md`、README、README 派生描述都缺失时，conflict detector 必须输出“无足够事实源”而不是编造冲突。
- 当 explanation 型文档本身没有细粒度 provenance block 时，059 必须使用已有结构化模型或 section-level wrapper 降级，而不是对 Markdown 做脆弱的字符串回填。
- 当 `055` bundle manifest 缺失但 `projectDocs` 列表存在时，required-doc rule set 仍需输出部分结果和 dependency warning。
- 当多个来源在同一主题上存在三方及以上冲突时，quality report 必须保留多源冲突组，而不是只截断成二元对比。
- 当项目不是 monorepo 或没有 runtime 事实时，required-doc rule set 不能错误要求 `workspace-index`、`runtime-topology` 或 deployment 相关文档。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 定义共享 provenance 结构，用于表达 explanation / narrative / ADR / product-like 文档中的来源类别、evidence、confidence 和 inferred 状态。
- **FR-002**: 059 MUST 复用现有 045、050、057、058 的结构化输出和 batch 已生成文档，不得重新实现一套源码事实抽取器。
- **FR-003**: 系统 MUST 生成 `quality-report.md` 与 `quality-report.json`，汇总 provenance、冲突、required-doc 覆盖度和 warnings。
- **FR-004**: 系统 MUST 至少覆盖以下 explanation 型文档的 provenance：`architecture-narrative`、`component-view`、`dynamic-scenarios`、`docs/adr/*.md`；若某类文档缺失则降级记录。
- **FR-005**: provenance 结果 MUST 明确区分来源类型，例如 `code`、`config`、`test`、`spec`、`current-spec`、`readme`、`commit`、`inference`。
- **FR-006**: 系统 MUST 实现 conflict detector，至少支持识别 README、`current-spec.md`、spec/blueprint 和代码派生文档之间的主题冲突。
- **FR-007**: 当冲突存在时，quality report MUST 输出冲突主题、冲突来源、冲突摘录或摘要，以及严重级别；系统 MUST NOT 静默选择其中一个版本。
- **FR-008**: 系统 MUST 提供 required-doc rule set，并按项目类型或可见事实判断最低文档集合。
- **FR-009**: 当 055 bundle manifest 可用时，required-doc 校验 MUST 优先消费其 profile / manifest 元数据；当 manifest 缺失时，系统 MUST 以 partial 模式降级并输出 dependency warning。
- **FR-010**: 059 MUST 接入现有 batch 项目级文档套件，新增质量报告产物，同时保持原有模块 spec、项目级 panoramic 文档和 ADR 输出合同不回归。
- **FR-011**: 059 MUST 对缺少 README、`current-spec.md`、055 bundle manifest 或部分 explanation 文档的项目保守降级，只影响 quality report 结论，不得阻断 batch 主流程。
- **FR-012**: 059 的 canonical conflict / required-doc / score 结论 MUST 由确定性规则生成；LLM MAY 用于解释性文案，但 MUST NOT 决定事实冲突本身。
- **FR-013**: 059 MUST 保持 Codex / Claude 双端兼容，不引入只依赖单一运行时或额外服务进程的工作流。

### Key Entities

- **DocumentProvenanceModel**: explanation 型文档的共享 provenance 结构，记录文档级、section 级或条目级的来源和可信度。
- **ProvenanceEntry**: 单条来源追踪记录，包含来源类型、路径/引用、摘要、confidence 和 inferred 标记。
- **ConflictRecord**: 单个冲突主题的检测结果，包含主题、来源集合、冲突描述、严重级别和证据。
- **RequiredDocRule**: 按项目类型、运行时事实或 bundle profile 定义的最低文档要求规则。
- **DocsQualityReport**: 059 的总报告模型，汇总 provenance 覆盖度、冲突、required-doc 覆盖度、warnings 和总状态。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对已有 045/050/057/058 输出的项目运行 059 后，输出目录中存在 `quality-report.md` 与 `quality-report.json`。
- **SC-002**: narrative / ADR / component / dynamic 文档中的任一关键结论都可追溯到来源类别或 evidence 引用，而不是仅标注 `low confidence`。
- **SC-003**: 对一个 README 与 `current-spec.md` 存在真实冲突的 fixture，quality report 能明确列出至少 1 条 conflict record。
- **SC-004**: 对不同项目类型运行 059 时，required-doc rule set 会输出不同的最低文档集合，并在缺失时给出明确覆盖度或 partial 状态。
- **SC-005**: 接入 059 后，相关 tests、`npm run lint`、`npm run build` 全部通过，且现有 batch 项目级文档主链路不回归。

## Clarifications

### Session 2026-03-21

- [AUTO-CLARIFIED: 059 的事实输入以现有结构化输出为主，Markdown 仅作为补充证据载体；不允许回到字符串级重新抽取 canonical facts]
- [AUTO-CLARIFIED: 当前代码线未包含 055 的 bundle 编排实现，因此 059 需要把 “manifest 缺失时输出 partial report / dependency warning” 作为明确降级路径]
- [AUTO-CLARIFIED: 059 只做 provenance / quality gate，不提前实现 060 的产品 / UX 外部事实接入]
