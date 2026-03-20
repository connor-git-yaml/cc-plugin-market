# Feature Specification: ADR 决策流水线

**Feature Branch**: `058-adr-decision-pipeline`  
**Created**: 2026-03-20  
**Status**: Implemented  
**Input**: User description: "开始推进需求 058"

---

## User Scenarios & Testing

### User Story 1 - 为批量文档结果自动生成 ADR 草稿 (Priority: P1)

作为维护者，我希望在 `reverse-spec batch` 产出项目级文档后，系统能继续自动生成一组候选 ADR 草稿和索引，而不是让我再手工从 blueprint、spec、commit 和架构文档里拼接“为什么这样设计”。

**Why this priority**: 058 的核心价值是把“结构化事实”提升为“结构化决策草稿”，这是后续 060 产品文档和 059 provenance 的直接上游。

**Independent Test**: 对一个已有项目级文档套件的输出目录执行 ADR pipeline，验证会生成 `docs/adr/index.md` 与多篇 ADR 草稿。

**Acceptance Scenarios**:

1. **Given** 一个已经有 `architecture-narrative`、`pattern-hints` 与模块 spec 的项目输出目录，**When** 运行 batch 项目级编排，**Then** 输出目录中新增 `docs/adr/index.md`、`index.json` 与多篇 ADR 草稿。
2. **Given** 一个缺少 `current-spec.md` 的外部仓库，**When** 运行 ADR pipeline，**Then** 系统仍可基于架构叙事、模式提示、git 提交和源码路径信号生成候选 ADR，而不是直接失败。

---

### User Story 2 - ADR 草稿必须有明确证据与候选状态 (Priority: P1)

作为阅读者，我希望 ADR 草稿明确区分“候选决策”和“既有事实”，并附带证据来源、替代方案和后果，而不是只输出一段解释性总结。

**Why this priority**: 如果 ADR 只有结论没有证据，它会退化成 narrative 的重复版本，不能支撑后续 review。

**Independent Test**: 检查任一生成的 ADR 草稿，验证包含 `Decision / Context / Consequences / Alternatives / Evidence` 五类段落，且状态为 `proposed`。

**Acceptance Scenarios**:

1. **Given** 一个识别到 CLI transport / JSON protocol 信号的项目，**When** 查看 ADR 草稿，**Then** 文档中能看到候选决策、上下文、后果、替代方案和证据清单。
2. **Given** 一个只能从模块职责和源码路径中推断边界的项目，**When** 查看 ADR 草稿，**Then** 文档会标记 `inferred` 或保守描述，而不是把推断伪装成确定事实。

---

### User Story 3 - 批量主链路保持兼容并对弱证据保守降级 (Priority: P2)

作为维护者，我希望新增 ADR pipeline 不会破坏现有 batch、coverage、项目级文档输出；当证据不足时，系统应保守地产出少量候选 ADR 或空索引，而不是拖垮整次批处理。

**Why this priority**: 058 是 batch 项目级文档编排的后置环节，不能因为 ADR 失败导致已有 panoramic 套件失效。

**Independent Test**: 运行现有 batch 集成测试，验证项目级文档仍正常生成，且新增 `docs/adr` 输出不会导致失败。

**Acceptance Scenarios**:

1. **Given** 一个适用 API / runtime / narrative 的 fixture，**When** 运行 `runBatch()`，**Then** 原有 project docs 仍全部生成，同时新增 `docs/adr/index.md` 和 ADR 草稿。
2. **Given** 一个证据不足的项目，**When** ADR pipeline 无法稳定识别决策候选，**Then** 系统只写空索引或 warning，不影响其他项目级文档输出。

---

### Edge Cases

- 仓库没有 `specs/`、没有 `current-spec.md`、甚至没有可读取 git 历史时，ADR pipeline 仍要尽量基于 `architecture-narrative` 与源码路径生成候选草稿或空索引。
- 仓库存在大量历史 spec/blueprint 时，证据抽取必须保守裁剪，避免把整仓 Markdown 全量塞进一个 ADR。
- 真实仓库可能同时命中多个决策规则；输出需要排序并截断到可读规模，而不是把所有候选都展开成十几篇草稿。
- 单个项目可能没有 deployment/runtime 事实；涉及容器化边界的 ADR 必须自动跳过而不是强行输出。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 batch 项目级文档编排中新增 ADR pipeline 阶段，并在 `architecture-narrative` 之后执行。
- **FR-002**: ADR pipeline MUST 从多源事实中抽取候选决策信号，至少支持 `architecture-narrative`、`pattern-hints`、`spec.md`/`blueprint.md`、`current-spec.md`、近期 git commit、源码路径信号。
- **FR-003**: 系统 MUST 输出 `docs/adr/index.md`、`docs/adr/index.json`，并为每篇 ADR 草稿输出对应的 `.md` 与 `.json` 文件。
- **FR-004**: 每篇 ADR 草稿 MUST 至少包含 `Decision`、`Context`、`Consequences`、`Alternatives`、`Evidence` 五类结构化段落。
- **FR-005**: ADR 草稿 MUST 使用候选状态 `proposed`，且明确标注 `confidence`、`sourceTypes` 与 `inferred`。
- **FR-006**: 系统 MUST 采用确定性规则匹配和模板渲染生成 ADR 草稿，不得让 LLM 直接决定 ADR 的 canonical facts。
- **FR-007**: 对缺少 `current-spec.md` 或 git 历史的项目，ADR pipeline MUST 保守降级，只使用可用证据源继续生成候选草稿或空索引。
- **FR-008**: batch 主链路 MUST 将 `docs/adr/*.md` 纳入 `BatchResult.projectDocs` 的可见输出列表。
- **FR-009**: 新增 ADR pipeline MUST 不破坏现有 project docs、架构叙事、coverage audit 与 batch 集成测试语义。

### Key Entities

- **AdrEvidenceRef**: 单条 ADR 证据引用，记录来源类型、标签、可选路径和证据摘录。
- **AdrDraft**: 单篇候选 ADR 草稿，包含标题、状态、分类、决策、上下文、后果、替代方案和证据列表。
- **AdrIndexOutput**: ADR 索引文档的结构化模型，汇总草稿数量、摘要、warning 和所有草稿元数据。
- **AdrCorpus**: ADR pipeline 的中间事实集合，聚合项目级文档、spec/current-spec、git 提交和源码路径信号。

## Success Criteria

- **SC-001**: 在现有 batch fixture 上执行 `runBatch()` 后，输出目录中新增 `docs/adr/index.md` 与至少 2 篇 ADR 草稿。
- **SC-002**: 对带有 CLI transport / JSON protocol 信号的项目，系统能产出至少 2 篇主题正确的 ADR 草稿，涵盖运行时宿主和协议层。
- **SC-003**: 对带有 current-spec / registry / fallback 信号的项目，系统能产出至少 2 篇主题正确的 ADR 草稿，涵盖扩展机制和产品事实源或诚实降级策略。
- **SC-004**: 新增 ADR pipeline 后，相关单测、batch 集成测试、`npm run lint` 和 `npm run build` 全部通过。
