# Feature Specification: Scorecard 信号校准与产品级 Quality Reports

**Feature Branch**: `068-scorecard-signal-alignment`
**Created**: 2026-04-05
**Status**: Implemented
**Input**: 修正 065 治理层的失真信号：只统计当前应纳入治理的已实现 feature，并为产品生成可被 scorecard 直接消费的 `quality-report.json`

## User Scenarios & Testing

### User Story 1 - 治理只统计已实现能力 (Priority: P1)

作为仓库维护者，我希望 scorecard 的 `verification-freshness` 只统计当前应纳入治理的已实现 feature，而不是把 blueprint 和历史 Draft 一并算进来，这样治理分数反映的是当前健康度，而不是历史文档欠账。

**Independent Test**: 运行 product scorecard 集成测试，确认 `ignored.blueprint` 与 `ignored.nonImplemented` 被显式列出，且 totalFeatures 仅统计已实现 feature。

### User Story 2 - 产品级质量报告可直接被治理层消费 (Priority: P1)

作为 Spec Driver 的治理消费者，我希望 `specs/products/<product>/quality-report.json` 稳定存在，且包含 required docs 与 conflicts 统计，这样 `docs-coverage` / `docs-conflicts` 不再只能退化成 `WARN`。

**Independent Test**: 运行 product quality report 集成测试，确认为两个产品生成 `quality-report.md/.json`，并回写 entity/catalog 摘要。

### User Story 3 - 当前 scorecard 从“口径 fail”回到真实信号 (Priority: P1)

作为产品负责人，我希望 `reverse-spec` 和 `spec-driver` 的 scorecard 不再因为缺输入或错误统计而失败，而只在真实治理缺口存在时才失败。

**Independent Test**: 在当前仓库执行 quality / scorecard helper，确认两个产品的 scorecard 进入 `PASS`。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 为每个产品生成 `quality-report.md/.json`
- **FR-002**: 产品级 quality report MUST 复用 `059` 的核心字段合同
- **FR-003**: `verification-freshness` MUST 仅统计 `spec.md` 存在且 `Status=Implemented` 的 feature
- **FR-004**: blueprint 与 non-implemented feature MUST 在 evidence 中显式列为 ignored
- **FR-005**: `spec-driver-sync` 的治理事实链路 MUST 先生成 product quality report，再生成 scorecard
- **FR-006**: 当前应纳入治理但缺 verification 的 feature MUST 在本次修复中补齐或刷新

## Success Criteria

- `specs/products/spec-driver/scorecard-report.md` 显示 `PASS`
- `specs/products/reverse-spec/scorecard-report.md` 显示 `PASS`
- `specs/products/quality-report-index.yaml` 已生成
- `catalog-index.yaml` 和 `entity.yaml` 已回写 quality report 摘要
