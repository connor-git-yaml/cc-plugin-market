# Implementation Plan: 080-doc-version-release-contract-unification

## 概述

本 Feature 只做一件事：把“版本 bump + plugin metadata + README release 文案 + 产品事实 release 文案”收敛到单一 release contract，并提供同步与校验链路。

## 设计

### 1. Canonical source

- 新增 `contracts/release-contract.yaml`
- 每个产品声明：
  - version
  - plugin manifest path
  - plugin README path
  - current-spec path
  - product-mapping key
  - marketplace / plugin / product-mapping description
- reverse-spec 额外声明 `package.json` / `package-lock.json`
- spec-driver 额外声明 `postinstall.sh`

### 2. Sync / Validate 链路

- `scripts/lib/release-contract-core.mjs`
  - 统一读取 contract
  - 统一生成目标内容
  - 供 sync / validate 共享
- `scripts/sync-release-contracts.mjs`
- `scripts/validate-release-contracts.mjs`
- `scripts/check-plugin-sync.sh` 接入 CHECK-7

### 3. 文档边界

- 插件 README 顶部增加稳定 `当前发布版本` 行
- `current-spec.md` 顶部增加稳定 `发布版本` 行
- 根 README 去掉散落的 spec-driver 当前版本硬编码，仅保留受控 badge
- `docs/shared/agent-release-contract.md` 通过 `docs:sync:agents` 同步到 `AGENTS.md` / `CLAUDE.md`

### 4. 产品事实层

- `product-mapping.yaml` 同步 release 描述
- 顺手补齐已落地主线但未完全写回的 `078 / 080 / 081` 产品事实索引

## 风险与缓解

- 风险：README patch 规则脆弱
  - 缓解：尽量减少动态版本点，仅保留稳定 release 行
- 风险：package-lock 顶层版本与 package.json 漂移
  - 缓解：sync / validate 都显式检查 root version 与 `packages[""]`
- 风险：产品事实层只同步 header，正文仍需人工维护
  - 缓解：明确 080 只统一 release 文案，不替代完整 `spec-driver-sync`
