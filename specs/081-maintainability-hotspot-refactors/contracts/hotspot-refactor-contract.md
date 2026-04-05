# Contract: 可读性与维护性热点重构

## 1. Scope

本合同定义 081 对四个热点入口文件的重构边界、核心模块职责以及必须保持稳定的外部行为。

适用入口：

- `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`
- `plugins/spec-driver/scripts/generate-workflow-registry.mjs`
- `plugins/spec-driver/scripts/init-project.sh`

## 2. Entry Stability Contract

### 2.1 CLI / Shell Entry

以下入口在 081 后必须继续保持：

- 原文件路径不变
- 原调用方式不变
- 原参数名不变
- 原 JSON payload 关键字段不变
- 原产物路径不变

### 2.2 Shared Primitive Reuse

081 必须继续复用以下 shared helpers，而不是重建等价实现：

- `simple-yaml.mjs`
- `script-report-io.mjs`
- `product-artifact-patchers.mjs`
- `script-diagnostics.mjs`

## 3. Core Module Contracts

### 3.1 `product-scorecard-core.mjs`

**Expected Responsibilities**

- ruleset loading / normalization
- product scorecard report assembly
- rule evaluation helpers
- scorecard markdown rendering

**Entry Boundary**

- 入口 `generate-product-scorecards.mjs` 仍负责参数解析、主循环 orchestration 和最终落盘

### 3.2 `product-quality-core.mjs`

**Expected Responsibilities**

- document reference collection
- required-doc / conflicts / stats calculation
- quality report assembly
- quality markdown rendering

**Entry Boundary**

- 入口 `generate-product-quality-reports.mjs` 仍负责参数解析、主流程 orchestration 和最终落盘

### 3.3 `workflow-registry-core.mjs`

**Expected Responsibilities**

- workflow definitions loading
- project override loading / merge
- golden path loading
- workflow registry index assembly
- markdown rendering

**Entry Boundary**

- 入口 `generate-workflow-registry.mjs` 仍负责参数解析、主流程 orchestration 和 CLI 输出

### 3.4 `init-project.sh`

**Expected Responsibilities After Refactor**

- 明确存在 parse args、directory init、template sync、scorecard sync、status detection、output render、main 等阶段函数
- 如引入 shell helper 文件，仅允许承载纯辅助逻辑，不改变入口路径和输出合同

## 4. Backward Compatibility Rules

- `generate-product-scorecards.mjs` 的 `scorecard-report.json/.md`、`scorecard-index.yaml` 路径与主字段不变
- `generate-product-quality-reports.mjs` 的 `quality-report.json/.md`、`quality-report-index.yaml` 路径与主字段不变
- `generate-workflow-registry.mjs` 的 `workflow-index.json/.md` 路径与主字段不变
- `init-project.sh --json` 的关键字段保持兼容：
  - `NEEDS_CONSTITUTION`
  - `NEEDS_CONFIG`
  - `HAS_SPEC_DRIVER_SKILLS`
  - `PROJECT_CONTEXT_MODE`
  - `SKILL_MAP`
  - `RESULTS`
- preferred / legacy artifact path 规则不变
- warnings 的去重和呈现 shape 不变

## 5. Verification Contract

081 交付前必须满足：

1. 至少新增 3 个 targeted unit tests，覆盖提取后的 core modules
2. 保留并通过相关 integration regressions：
   - `spec-driver-product-scorecards`
   - `spec-driver-product-quality-reports`
   - `spec-driver-workflow-registry`
   - `spec-driver-init-project`
   - `init-command`
   - `init-e2e`
3. `npm run lint` 通过
4. `npm run build` 通过
5. `npm test` 通过
6. verification report 记录热点文件重构前后复杂度对比
