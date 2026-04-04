# Implementation Plan: 064 Workflow Registry 与 Golden Paths

**Date**: 2026-04-04  
**Feature**: [`specs/064-workflow-registry-golden-paths/spec.md`](/Users/connorlu/.codex/worktrees/b92c/cc-plugin-market/specs/064-workflow-registry-golden-paths/spec.md)

## 1. 目标

把 `spec-driver` 的六个入口从“README / SKILL 中的文字描述”升级成：

- `plugins/spec-driver/workflows/*.yaml` 的正式 machine-readable definitions
- `.specify/workflows/*.yaml` 的 metadata-only 项目级覆盖
- `specs/products/spec-driver/workflow-index.md/.json` 的可读索引

## 2. 架构决策

### 决策 1: workflow source of truth 放在 plugin 内 YAML

- **原因**: 064 的目标是可读、可 review、可 Git 管理的定义层，不需要新数据库或服务端 Catalog。
- **影响**: `plugins/spec-driver/workflows/*.yaml` 成为默认定义；helper 负责汇总为 index 输出。

### 决策 2: project override 只允许 metadata-only

- **原因**: 避免项目级覆盖偷偷改写 `feature/story/fix/...` 的业务语义。
- **影响**: `.specify/workflows` 只允许 `title/persona/useCases/recommendedWhen/templateVersion` 生效；其他字段只 warning 不覆盖。

### 决策 3: workflow index 生成在 `specs/products/spec-driver/`

- **原因**: registry 是 `spec-driver` 产品事实的一部分，应该与 `current-spec.md`、`entity.yaml` 同目录。
- **影响**: `spec-driver-doc` 可以在同一产品目录中发现 workflow index 并作为补充事实源消费。

## 3. 实施步骤

1. 新增 6 个 workflow definitions 和 1 个 golden-paths 定义
2. 实现 `generate-workflow-registry.mjs`
3. 预创建 `.specify/workflows/` 覆盖目录
4. 更新 `spec-driver-doc` 让其发现 `workflow-index`
5. 更新 063 entity helper，优先引用真实 workflow definitions
6. 生成真实 `workflow-index.md/.json` 与刷新 `entity.yaml`

## 4. 风险与回退

- **风险**: override 覆盖范围过大导致流程语义漂移  
  **缓解**: 严格 allowlist，其他字段直接 warning

- **风险**: workflow registry 与 README / current-spec 漂移  
  **缓解**: 让 `workflow-index` 成为同目录事实层，并由 helper 统一生成
