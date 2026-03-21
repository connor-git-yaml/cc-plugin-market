# Feature Specification: 产品 / UX 事实接入

**Feature Branch**: `060-product-ux-fact-ingestion`  
**Created**: 2026-03-22  
**Status**: Implemented  
**Input**: User description: "推进 060"

## User Scenarios & Testing

### User Story 1 - 从多源事实生成产品概览与用户旅程 (Priority: P1)

作为维护者或文档消费者，我希望 `reverse-spec` 在已有技术文档之外，还能从 `current-spec.md`、README、本地设计 Markdown 和可用的 GitHub issue / PR 中提炼产品定位、目标用户和关键任务流，而不是继续只输出纯技术结构文档。

**Why this priority**: 060 是 `054` 蓝图的最后一块汇合项；如果没有产品事实层，Reverse Spec 仍然无法覆盖“产品和用户体验项”的理解需求。

**Independent Test**: 对包含 `specs/products/*/current-spec.md`、README 和本地产品说明文档的项目执行 060，验证输出目录生成 `product-overview.md` 与 `user-journeys.md`。

**Acceptance Scenarios**:

1. **Given** 一个包含 `current-spec.md`、README 和产品说明 Markdown 的项目，**When** 执行 060 文档生成，**Then** 系统输出 `product-overview.md/.json` 和 `user-journeys.md/.json`，并在内容中列出目标用户、核心场景和任务流。
2. **Given** 一个存在 `current-spec.md` 用户画像表和场景列表的项目，**When** 生成产品文档，**Then** 输出中的目标用户和旅程优先引用这些显式事实，而不是只做推断。

---

### User Story 2 - 生成可追溯的 Feature Brief 集合并接入 bundle / quality (Priority: P1)

作为维护者，我希望 issue / PR 或 journey 派生出的产品 brief 能作为一等文档进入 docs bundle 和 quality report，而不是散落在 narrative 或 README 里。

**Why this priority**: 060 不只是单独多生成几个 Markdown 文件，还要把产品事实层接进 055 docs bundle 和 059 quality / provenance 治理链路。

**Independent Test**: 执行 batch 集成测试，验证 `docs-bundle.yaml` 中包含 `product-overview`、`user-journeys`、`feature-briefs/index`，且 quality report 把这些文档视为 covered。

**Acceptance Scenarios**:

1. **Given** 一个可生成项目级文档套件的项目，**When** 运行 `runBatch()`，**Then** `specs/docs-bundle.yaml` 中的 `developer-onboarding` profile 会纳入产品概览、用户旅程和 feature brief 索引。
2. **Given** 一个存在 GitHub issue / PR 事实的项目，**When** 生成 feature brief，**Then** 系统输出 `feature-briefs/index.md` 和多篇 `feature-briefs/*.md`，并把证据链与状态写入 JSON / Markdown。

---

### User Story 3 - 在缺少 GitHub 或产品事实时保守降级 (Priority: P2)

作为维护者，我希望 060 在缺少 `gh` CLI、远端仓库、`current-spec.md` 或本地设计文档时仍然保守工作，而不是阻断整个 batch 主流程。

**Why this priority**: 产品事实源天然比技术事实更不稳定；第一版必须明确支持“弱输入但不断流”的降级策略。

**Independent Test**: 对没有 `current-spec.md` 或无法解析 GitHub 远端的 fixture 执行 060，验证系统只输出 warning / candidate brief，而不是抛出异常。

**Acceptance Scenarios**:

1. **Given** 一个没有 GitHub 远端或本机没有 `gh` CLI 的项目，**When** 生成产品文档，**Then** 系统跳过 issue / PR 接入并记录 warning，但仍输出 overview / journeys / feature briefs。
2. **Given** 一个缺少 `current-spec.md` 的项目，**When** 生成产品文档，**Then** 系统回退使用 README、本地设计文档和 journey synthesis，并显式标记推断或 warning。

## Edge Cases

- 仓库存在多个 `specs/products/*/current-spec.md` 时，需要聚合而不是只读取单一产品。
- `feature-briefs/index.md` 作为嵌套路径接入 bundle 时，不能覆盖 bundle landing page `index.md`。
- GitHub issue / PR 接入不可假设始终可用；远端解析失败或 `gh` 返回非零退出码时只能 warning，不得中断。
- 本地 Markdown 扫描必须避开 `node_modules`、`dist`、`coverage`、`specs` 和 bundle 输出目录，避免把生成物再次吸回事实层。
- 当 issue / PR 不存在时，feature brief 必须保守回退到基于 journey 的 `candidate` brief，而不是空结果或虚构 GitHub 事实。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 支持从 `specs/products/*/current-spec.md`、README、本地产品/设计 Markdown、GitHub issue/PR 与近期 git commit 采集产品 / UX 事实。
- **FR-002**: `current-spec.md` MUST 作为第一优先级事实源，README / 本地设计文档 / issue / PR 作为补充源。
- **FR-003**: 系统 MUST 输出 `product-overview.md/.json`，包含产品定位、目标用户、核心场景、关键任务流、warnings、evidence 与 confidence。
- **FR-004**: 系统 MUST 输出 `user-journeys.md/.json`，包含旅程标题、角色、目标、结果、关键步骤、证据与 confidence。
- **FR-005**: 系统 MUST 输出 `feature-briefs/index.md/.json` 与多篇 `feature-briefs/*.md/.json`，并为每篇 brief 记录 `status`、`audience`、`evidence`、`confidence` 与 `inferred`。
- **FR-006**: 当 GitHub issue / PR 可用时，feature briefs MUST 优先由 issue / PR 事实生成；当不可用时 MUST 回退到基于旅程的 candidate brief。
- **FR-007**: 060 MUST 接入 `batch-project-docs.ts`，把 `product-overview`、`user-journeys`、`feature-briefs/index` 纳入项目级文档输出。
- **FR-008**: 060 MUST 接入 docs bundle 编排，使 `developer-onboarding` 和 `api-consumer` profile 能消费产品 / UX 文档。
- **FR-009**: 060 MUST 接入 059 quality / provenance 流程，把产品文档纳入 required-doc 与 provenance 评估。
- **FR-010**: 060 MUST 在 GitHub / current-spec / 设计文档缺失时保守降级，仅输出 warning 或 inferred 结论，不得阻断 batch 主流程。
- **FR-011**: 060 的 canonical facts MUST 由确定性规则抽取和聚合生成；LLM MAY 参与解释层，但 MUST NOT 决定产品事实本身。
- **FR-012**: 实现 MUST 保持 Codex / Claude 双端兼容，不引入仅依赖单一运行时的产品事实接入方案。

### Key Entities

- **ProductEvidenceRef**: 产品证据引用，记录来源类型、标签、可选路径/引用、摘录、confidence 和 inferred 标记。
- **ProductOverviewOutput**: 产品概览模型，汇总 summary、targetUsers、coreScenarios、keyTaskFlows、warnings 与 evidence。
- **UserJourney**: 单条用户旅程模型，记录 actor、goal、outcome、steps、evidence 与 confidence。
- **FeatureBrief**: 单份产品 brief，记录来源 ID、文件名、问题、方案、目标受众、状态与证据链。
- **ProductFactCorpus**: 060 的中间事实集合，聚合 current-spec、README、设计文档、GitHub issue / PR、commit 与 warning。

## Success Criteria

- **SC-001**: 在含 `current-spec.md`、README 与设计 Markdown 的 fixture 上运行 060 后，输出目录中存在 `product-overview.md`、`user-journeys.md`、`feature-briefs/index.md`。
- **SC-002**: `runBatch()` 集成后，`docs-bundle.yaml` 中的 `developer-onboarding` profile 能纳入 `product-overview`、`user-journeys`、`feature-briefs/index` 三类文档。
- **SC-003**: quality report 能把产品文档识别为 `covered`，并为这些文档生成 provenance 记录。
- **SC-004**: 在无 GitHub 事实的情况下，系统仍能输出至少 1 份 candidate brief 或明确 warning，而不会导致 batch 失败。
- **SC-005**: 相关单测、batch 集成测试、`npm run lint`、`npm run build` 全部通过。

## Clarifications

### Session 2026-03-22

- [AUTO-CLARIFIED: 060 第一版只支持 `current-spec.md` + GitHub issue/PR + 本地 Markdown 设计说明，不在本次实现中接入 Figma 或其他私有设计 API]
- [AUTO-CLARIFIED: GitHub 事实接入是可选增强，`gh` CLI 不可用时必须降级为 warning，而不是报错退出]
- [AUTO-CLARIFIED: 产品 / UX 文档属于项目级文档套件的一部分，必须进入 docs bundle 与 quality report，而不是只写零散 Markdown]
