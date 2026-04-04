# Implementation Plan: 063 产品实体目录与 Catalog 生成

**Date**: 2026-04-04  
**Feature**: [`specs/063-product-entity-catalog/spec.md`](/Users/connorlu/.codex/worktrees/b92c/cc-plugin-market/specs/063-product-entity-catalog/spec.md)

## 1. 目标

在不引入新运行时依赖、不重写 `current-spec.md` 聚合逻辑的前提下，为 `spec-driver-sync` 增加一个最小 Catalog 层：

- `specs/products/<product>/entity.yaml`
- `specs/products/catalog-index.yaml`

并让 `sync` skill 把这两类制品视为正式交付物。

## 2. 架构决策

### 决策 1: 用确定性 helper 生成 Catalog，而不是继续交给 LLM

- **原因**: 063 的输出是元数据壳，不需要再让模型组织长文；交给确定性脚本更稳定，也更容易给 064–066 复用。
- **影响**: 新增 `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`，由 skill 在 `sync` 聚合完成后调用。

### 决策 2: `current-spec.md` 继续作为正文事实层

- **原因**: 062 蓝图已经明确 Catalog 不能变成第二份 README 或第二份 current-spec。
- **影响**: `entity.yaml` 只保留路径、状态、workflow refs、repo metadata 和质量元信息。

### 决策 3: 063 先用静态 workflowRefs，完整 registry 留给 064

- **原因**: 063 只需提供 Catalog 的最小可用字段，不提前把 064 的 workflow schema 一起做掉。
- **影响**: `reverse-spec` 和 `spec-driver` 先写入稳定 workflow 引用列表；完整 workflow definition 留给下一 Feature。

## 3. 实施步骤

1. 新增 Catalog helper 脚本，解析 `product-mapping.yaml` 与 `current-spec.md`
2. 生成 `entity.yaml` 和 `catalog-index.yaml`
3. 更新 `spec-driver-sync` source skill 与 Codex skill
4. 更新 sync 子代理提示，明确 Catalog 由后置 helper 负责
5. 为 helper 增加集成测试
6. 在当前仓库生成真实 `entity.yaml` / `catalog-index.yaml`

## 4. 风险与回退

- **风险**: `product-mapping.yaml` 解析规则过于脆弱  
  **缓解**: 只支持当前仓库已使用的稳定结构；遇到缺失 `current-spec.md` 时输出 warning 而不是 silent fail

- **风险**: Catalog 字段过多，和 current-spec 重复  
  **缓解**: 保持最小字段集，不加入长摘要或章节正文

- **风险**: 本地 Codex skill 与 plugin source skill 漂移  
  **缓解**: 本次同步修改两份 `spec-driver-sync/SKILL.md`
