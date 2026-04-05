# Implementation Plan: 066 Adoption / Friction Insights

## Goals

1. 增加最小 run summary 记录 helper，落本地 `.specify/runs/*.jsonl`
2. 增加 adoption / friction 聚合 helper，生成 `specs/products/spec-driver/_generated/adoption-report.md/.json`
3. 将 adoption report 接入 `spec-driver-sync`、workflow registry 与初始化目录

## Workstreams

### 1. Run Event Contract

- 新增 `plugins/spec-driver/scripts/record-workflow-run.mjs`
- 支持记录：
  - `workflowId`
  - `runId`
  - `result`
  - `durationMs`
  - `rerunPhase`
  - `gatePauses`
  - `verificationFailures`
  - `artifacts`

### 2. Adoption Aggregation

- 新增 `plugins/spec-driver/scripts/generate-adoption-insights.mjs`
- 读取：
  - `.specify/runs/*.jsonl`
  - `specs/products/spec-driver/_generated/workflow-index.json`
  - `specs/products/spec-driver/_generated/scorecard-report.json`
- 输出：
  - `specs/products/spec-driver/_generated/adoption-report.md`
  - `specs/products/spec-driver/_generated/adoption-report.json`

### 3. Product Chain Integration

- `init-project.sh` 创建 `.specify/runs/`
- `.gitignore` 忽略 `.specify/runs/`
- `spec-driver-sync` skill 文档追加 adoption helper 步骤
- `spec-driver-sync` workflow artifacts 纳入 adoption report
- skill 文档补 run summary 记录约定

### 4. Validation

- 集成测试覆盖：
  - run summary 记录
  - adoption report 聚合
  - 损坏 JSONL 行容错
  - init-project 创建 `.specify/runs/`
  - workflow registry 暴露 adoption artifacts

## Non-Goals

- 不做远程 telemetry
- 不做 UI dashboard
- 不把 adoption 直接接成 gate
- 不记录 prompt 正文
