# Feature Specification: Adoption / Friction Insights

**Feature Branch**: `066-adoption-friction-insights`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: User description: "开始做 066"

## User Scenarios & Testing

### User Story 1 - 为 Spec Driver 生成本地 adoption 报告 (Priority: P1)

作为 Spec Driver 维护者，我希望基于本地运行历史生成 adoption 报告，这样我可以知道哪些 workflow 被频繁使用、成功率如何、是否存在明显的 rerun 热点。

**Why this priority**: 066 是 062 里程碑的反馈层，没有 adoption report，063-065 仍然缺少“实际使用发生了什么”的闭环。

**Independent Test**: 写入若干 run summary 到 `.specify/runs/*.jsonl`，运行 adoption helper，验证输出 `specs/products/spec-driver/_generated/adoption-report.md/.json`。

**Acceptance Scenarios**:

1. **Given** 存在至少 3 条 workflow run summary，**When** 运行 adoption helper，**Then** 生成 `adoption-report.md/.json` 并统计 workflow 使用次数、成功率与 rerun 率。
2. **Given** `workflow-index.json` 已存在，**When** 输出 adoption report，**Then** workflow 维度带有 title/persona，而不只是裸 id。

---

### User Story 2 - friction 热点可解释且不泄露 prompt 正文 (Priority: P1)

作为流程维护者，我希望 adoption 报告能指出最常见的 gate pause、rerun phase 与 verification 失败热点，同时确保本地日志不记录完整 prompt 正文。

**Why this priority**: adoption 不是简单 usage count；如果看不到卡点，066 就无法为后续 workflow 优化提供依据。

**Independent Test**: 写入包含 `rerunPhase`、`gatePauses`、`verificationFailures` 的 run summary，验证 adoption report 中出现对应热点。

**Acceptance Scenarios**:

1. **Given** run summary 中包含 `rerunPhase`，**When** 生成 adoption report，**Then** `friction.rerunHotspots` 聚合该 phase。
2. **Given** run summary 中包含 `gatePauses` 与 `verificationFailures`，**When** 生成 adoption report，**Then** 报告能输出热点条目，且事件结构中不包含 prompt 正文。

---

### User Story 3 - sync 流程刷新 adoption 反馈视图 (Priority: P2)

作为 `spec-driver-sync` 的使用者，我希望刷新产品事实时顺手生成 adoption report，这样 Catalog / workflow / scorecard / adoption 四层事实保持同一条链路。

**Why this priority**: 如果 adoption 报告依赖手工单独运行，反馈层会很快与 063-065 脱节。

**Independent Test**: 更新 `spec-driver-sync` workflow artifacts，并验证 skill 文档包含 adoption helper 步骤。

**Acceptance Scenarios**:

1. **Given** `spec-driver-sync` workflow definition，**When** 生成 workflow registry，**Then** artifacts 中包含 `adoption-report.md/.json`。
2. **Given** 运行 `spec-driver-sync`，**When** 完成聚合，**Then** skill 文档要求执行 adoption helper，并在完成报告中展示 adoption 产物。

## Edge Cases

- `.specify/runs/` 不存在时，adoption helper 应输出空报告和 warning，而不是报错终止。
- 单个 `.jsonl` 文件包含损坏行时，helper 必须跳过损坏行并继续处理其余事件。
- workflow 已被删除但历史 run event 仍存在时，report 仍应保留该 workflow 的 usage summary，只是 title/persona 退回默认值。
- duration / phaseDurations 缺失时，report 仍可生成，但 `slowestPhases` 只统计有样本的数据。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供 `record-workflow-run.mjs`，将最小 run summary 追加到 `.specify/runs/*.jsonl`。
- **FR-002**: run summary MUST 只包含最小必要字段，如 `workflowId`、`runId`、`result`、`durationMs`、`rerunPhase`、`gatePauses`、`verificationFailures`、`artifacts`。
- **FR-003**: 系统 MUST 提供 `generate-adoption-insights.mjs`，输出 `specs/products/spec-driver/_generated/adoption-report.md/.json`。
- **FR-004**: adoption helper MUST 聚合 workflow 使用次数、成功率 / 失败率、rerun 热点、gate pause 热点、verification 失败热点。
- **FR-005**: helper MUST 在日志缺失或损坏时降级生成报告，并在 `warnings` 中解释原因。
- **FR-006**: `init-project.sh` MUST 预创建 `.specify/runs/`。
- **FR-007**: `spec-driver-sync` MUST 将 adoption report 视为产品事实链路的一部分，workflow artifacts 和 skill 文档需要反映该产物。
- **FR-008**: 本地运行日志 MUST NOT 记录完整 prompt 正文。

### Key Entities

- **WorkflowRunSummary**: 单次 skill 运行的最小摘要事件。
- **AdoptionReport**: 对 `spec-driver` 产品的本地使用、成功率与 friction 热点的汇总报告。
- **FrictionHotspot**: 由 rerun phase、gate pause 或 verification failure 聚合出的高频卡点。

## Success Criteria

- **SC-001**: adoption helper 能生成 `specs/products/spec-driver/_generated/adoption-report.md/.json`。
- **SC-002**: 报告中包含 workflow usage、rerun hotspots、gate pause hotspots、verification failure hotspots。
- **SC-003**: 缺少 run logs 或存在损坏 JSONL 行时，helper 仍然 PASS 并输出 warning。
- **SC-004**: `spec-driver-sync` workflow registry 中出现 adoption 产物路径。
- **SC-005**: 相关集成测试、`npm run lint`、`npm run build` 全部通过。

## Clarifications

### Session 2026-04-05

- [AUTO-CLARIFIED: 066 只做 repo 本地 run history，不做远程 telemetry 或数据库]
- [AUTO-CLARIFIED: run events 采用单条 run summary 模式，不引入多事件会话跟踪]
- [AUTO-CLARIFIED: adoption report 先聚焦 spec-driver 产品，不扩展到 reverse-spec 的泛化 usage 分析]
