# Tech Research: 066 Adoption / Friction Insights

## Decision

采用 **单条 run summary + 本地 JSONL 聚合** 的最小实现，不引入多事件会话状态机或远程遥测。

## Why

1. `Spec Driver` 当前仍是 skill / prompt 驱动，而不是统一运行时；复杂会话跟踪会把 logging 逻辑散进多个 skill 和 gate 分支。
2. 063-065 已经证明“Git-native helper + Markdown/JSON 产物”是本仓库最稳的演进方式。
3. 066 的核心价值是先回答“哪些 workflow 最常用、最容易卡住”，不需要完整 observability 平台。

## Alternatives Considered

### 1. 多事件会话日志（start / gate / finish）

- 优点：可恢复更精细的阶段耗时
- 缺点：需要稳定保存 runId 和跨阶段状态，在 skill 驱动环境中维护成本过高
- 结论：暂不采用

### 2. 远程 telemetry / 数据库

- 优点：更适合多仓库、多团队统计
- 缺点：违背 062 Milestone 的 Git-native / local-first 原则
- 结论：明确排除

### 3. 直接扫描 Git 历史推导 adoption

- 优点：无需本地日志
- 缺点：无法稳定区分 workflow、rerun phase、gate pause、verification hotspots
- 结论：仅可作为未来 backfill 辅助，不适合 066 正式合同

## Final Contract

- 运行事件：`.specify/runs/*.jsonl`
- 报告：`specs/products/spec-driver/_generated/adoption-report.md/.json`
- 输入只允许最小字段：workflow、result、duration、rerun、gate pause、verification failure、artifact paths
- 不记录完整 prompt 正文
