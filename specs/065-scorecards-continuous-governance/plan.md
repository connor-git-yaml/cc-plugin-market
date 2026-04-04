# Implementation Plan: 065 Scorecards 与持续治理报告

**Date**: 2026-04-04  
**Feature**: [`specs/065-scorecards-continuous-governance/spec.md`](/Users/connorlu/.codex/worktrees/b92c/cc-plugin-market/specs/065-scorecards-continuous-governance/spec.md)

## 1. 目标

把已有的 `current-spec`、`entity/catalog`、`workflow-index`、`quality-report` 和 feature `verification-report` 接成一层稳定的持续治理评分，而不是让治理只停留在单次流程 gate。

## 2. 架构决策

### 决策 1: 065 继续采用“确定性 helper + YAML ruleset”

- **原因**: 063/064 已经把 Catalog 和 workflow registry 做成 Git-native helper，065 应复用同样的交付方式，避免新增数据库或服务端状态。
- **影响**: 默认规则放在 `plugins/spec-driver/scorecards/`，项目级覆盖放在 `.specify/scorecards/`。

### 决策 2: 评分与阻断解耦

- **原因**: 蓝图明确要求 065 先做 report-first，不引入 OPA/Rego，也不自动 block。
- **影响**: scorecard 结果只写入 `scorecard-report` 与 Catalog 摘要；后续若要接 gate，可由 066 之后再决定。

### 决策 3: 尽量复用现有结构化事实

- **原因**: 065 不应再发明另一套扫描器，否则会和 059/063/064 形成重复事实层。
- **影响**:
  - `docs-coverage/docs-conflicts` 直接读取 `quality-report.json`
  - `verification-freshness` 直接读取 `verification-report.md` + mtime
  - `workflow-readiness` 直接读取 `workflow-index.json` + `entity.workflowRefs`

## 3. 实施步骤

1. 新增默认 scorecard ruleset 与 project override 目录约定
2. 实现 `generate-product-scorecards.mjs`
3. 将 scorecard 摘要回写到 `entity.yaml` / `catalog-index.yaml`
4. 更新 `spec-driver-sync` / workflow registry / init-project 接入点
5. 补集成测试与真实仓库输出

## 4. 风险与回退

- **风险**: verification 历史报告格式不一致  
  **缓解**: 使用宽松状态正则和文件时间兜底，不要求统一 frontmatter

- **风险**: 当前仓库缺少 `quality-report.json` 导致规则失真  
  **缓解**: 缺失时降级为 `warn`，明确写入 evidence，不直接 fail 整个 helper

- **风险**: scorecard 输出回写到 entity/catalog 后引入漂移  
  **缓解**: helper 每次重新生成并覆盖摘要字段，避免增量 patch 累积旧值
