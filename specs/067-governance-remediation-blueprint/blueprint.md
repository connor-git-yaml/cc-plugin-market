# Governance Remediation Milestone 蓝图

**版本**: 0.1.0
**创建日期**: 2026-04-05
**最后更新**: 2026-04-05
**状态**: Active

---

## 1. 目标

这轮里程碑不再扩新能力，而是修正 065 治理层的两个现实问题：

1. `verification-freshness` 把历史 `Draft` / blueprint 也算进主治理口径，导致分数失真
2. `docs-coverage` / `docs-conflicts` 缺少产品级 `quality-report.json` 输入，只能长期降级为 `WARN`

原则：

- 不为“让分变绿”而弱化治理语义
- 只把“当前应纳入治理的已实现能力”纳入 scorecard 主口径
- 复用现有 `quality-report` 合同，不新造第四套治理 schema

---

## 2. 范围

本蓝图占用 `067` 编号，规划两个小 Feature：

| 编号 | 类型 | 名称 | 说明 |
|------|------|------|------|
| 067 | BLUEPRINT | Governance Remediation Milestone 蓝图 | 当前文档 |
| 068 | FEATURE | Scorecard 信号校准与产品级 Quality Reports | 修正当前治理信号失真，并补齐产品级质量报告 |
| 069 | FEATURE | 历史 Spec 治理基线规范化 | 后续再处理 legacy draft / status 回写 / verification 历史债 |

---

## 3. 设计原则

### 3.1 治理只覆盖“已实现能力”

- `verification-freshness` 只统计 `spec.md` 存在且 `Status=Implemented` 的 feature
- blueprint 与历史 `Draft` 仍保留在产品映射中，但在 evidence 中显式列为 `ignored`
- 这样既不丢历史，也不让历史草稿污染当前健康度

### 3.2 产品级 quality-report 复用现有合同

- 报告沿用 `059` 的核心字段：`status`、`stats.totalRequiredDocs`、`stats.coveredRequiredDocs`、`conflicts`
- 只补一层最小产品事实聚合，不引入新的评分模型

### 3.3 优先修“真实 fail”

- 先把当前两个产品的 scorecard 从 `FAIL` 修到“信号可信”
- legacy 规范化（069）单独处理，不和本轮信号修正混做

---

## 4. Feature 068 定义

### 4.1 交付物

- `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`
- `specs/products/<product>/quality-report.md`
- `specs/products/<product>/quality-report.json`
- `specs/products/quality-report-index.yaml`
- `generate-product-scorecards.mjs` 的治理范围校准
- 缺失的已实现 feature verification 补齐或刷新

### 4.2 验收标准

1. `spec-driver` scorecard 从当前 `FAIL` 变为 `PASS`
2. `reverse-spec` scorecard 从当前 `FAIL` 变为 `PASS` 或至少只剩真实冲突，而不是口径问题
3. `verification-freshness` evidence 中明确列出 `ignored.blueprint` 与 `ignored.nonImplemented`
4. `docs-coverage` / `docs-conflicts` 不再因缺少 `quality-report.json` 而固定降级

---

## 5. Feature 069 预留

069 不在本轮立即执行，目标仅预留：

- 统一回写历史已落地 feature 的 spec 状态
- 识别哪些 legacy spec 应继续保留为 `Draft`
- 建立“历史记录”与“当前治理口径”的长期边界

---

## 6. 完成定义

本里程碑可视为完成，当且仅当：

1. 两个产品的 scorecard 进入可信状态
2. 产品级 `quality-report` 已进入 `sync -> scorecard` 主链路
3. 当前剩余治理问题只属于真实内容债，而不是缺输入或统计口径错误
