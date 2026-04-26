---
title: Phase 2 收尾的清理 Fix（Fix 134）
mode: fix
status: diagnose-complete
created: 2026-04-26
parent: 133-fix-postmortem-phase2
---

# 问题修复报告

## 问题描述

Phase 2 集成回归测试在 graphify 示例项目（5 Python 文件）上发现 Fix 133 残留 4 个偏差：

1. **偏差 1（重要）**：`spec-driver.config.yaml` 锁死 `preset: quality-first` + 10 个 agent 全 `opus`，覆盖了 Fix 133 P0-3 的 sonnet 默认 — dogfood 跑 spec-driver 流程时仍是 `claude-opus-4-7`，不是用户原意的 `claude-sonnet-4-6`。
2. **偏差 2（次要）**：`tokenUsage.input` 异常低（5 模块累计 input=30 vs output=35,759）— Fix 133 P0-1 修了 output 提取（35,759 ✓），但 input 路径只读主字段 `input_tokens`，漏了 prompt caching 的 `cache_creation_input_tokens` 和 `cache_read_input_tokens`。
3. **偏差 3（次要）**：reading 模式 499s 仍超 SC-001 < 120s — Fix 133 P0-2 已跳过产品文档 + 模块 spec 的 LLM enrichment，但**模块 spec 主调用**仍走配置默认 model（当前是 opus），5 × ~100s ≈ 499s。
4. **偏差 4（次要）**：CLI 自定义 parse-args 已实现 `--hyperedges` flag 解析（`src/cli/utils/parse-args.ts:701`）+ batch handler 接入（`src/cli/commands/batch.ts:58`），但 `src/cli/index.ts:44` 的 batch help 字符串遗漏了 `[--hyperedges]`，用户 `spectra batch --help` 看不到。

## 5-Why 根因追溯

### 偏差 1：spec-driver.config.yaml 覆盖 sonnet 默认

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | dogfood 跑 spec-driver 流程时 model 为何是 opus？ | `resolveReverseSpecModel({ agentId: 'specify' })` 返回 `claude-opus-4-7` |
| Why 2 | 为何返回 opus？ | yaml `agents.specify.model: opus`（10 个 agent block 全是 opus） |
| Why 3 | 为何 yaml 写满 opus？ | 文件首行注释写"预设: quality-first（所有阶段均使用 Opus）"，是 Fix 133 之前的旧默认 |
| Why 4 | 为何 Fix 133 P0-3 改了 PRESET_MODEL_MAP.balanced 但没改 yaml？ | Fix 133 scope 限定在源码默认（`src/core/model-selection.ts:26`），未同步 dogfood 的实际配置文件 |
| Why 5 | 为何没同步 dogfood？ | dogfood config 历史上视为"用户层配置"应让用户自己改，但本仓库 dogfood = 产品默认验证场，必须跟随产品默认 |

**Root Cause**: `spec-driver.config.yaml` 同时锁死 `preset: quality-first`（PRESET_MODEL_MAP → opus） + 10 个 agent 显式 `model: opus`，覆盖了 Fix 133 P0-3 的 sonnet 默认；属于 dogfood 跟随产品默认的同步缺失。

**Root Cause Chain**: dogfood 跑出 opus → `resolveReverseSpecModel` 返回 opus → `agents.specify.model = opus` → yaml 显式锁死 opus → Fix 133 改源码默认未同步 yaml dogfood → 同步缺失。

**额外 bug**：`src/batch/batch-orchestrator.ts:584` 用 `agentId: 'specify-sonnet'` 调 `resolveReverseSpecModel`，但 yaml 中**不存在** `specify-sonnet` agent key，会 fallback 到 `preset`。当前 `preset = quality-first` → opus，使得"sonnetModelId"实际是 opus！这破坏了小模块优化和 budget gate 降级（应该用 sonnet 但用的是 opus）。**所以单改 agents 部分不够，必须同时改 preset → balanced**。

### 偏差 2：tokenUsage.input 异常低

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | spec frontmatter `tokenUsage.input` 为何只有 6（5 模块累计 30）？ | input 提取的数值就是这个低 |
| Why 2 | 为何提取这么低？ | `cli-proxy.ts:258-269` 只读 `msg.usage.input_tokens` 主字段 |
| Why 3 | 为何 SDK 主字段这么小？ | Anthropic prompt caching 时，主输入大量进 `cache_read_input_tokens`，`input_tokens` 只剩"非 cached"增量部分 |
| Why 4 | 为何代码没读 cache 子字段？ | Fix 133 P0-1 只补了"嵌套 vs 顶层"的兼容（`msg.usage.input_tokens` vs `msg.input_tokens`），没补全字段累加 |
| Why 5 | 为何没全字段累加？ | 设计假设"`input_tokens` = 总输入"，未考虑 prompt caching 拆字段语义 |

**Root Cause**: 两个 LLM 客户端（`src/auth/cli-proxy.ts`, `src/core/llm-client.ts`）都只读 `input_tokens` 主字段，未累加 `cache_creation_input_tokens` + `cache_read_input_tokens`，导致用 prompt caching 的真实场景下 input 严重偏小。

**Root Cause Chain**: input=6 → 只读 input_tokens → cache 输入跑去 cache_read_input_tokens → cache 子字段未累加 → Fix 133 P0-1 修复 scope 限定。

### 偏差 3：reading 模式 499s 超 SC-001 < 120s

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | reading 模式 499s 是怎么来的？ | 5 模块 × ~100s/模块（已跳过产品文档 + LLM enrichment） |
| Why 2 | 为何每模块 ~100s？ | 模块 spec **主调用**（specify 阶段）耗时显著 |
| Why 3 | 为何主调用慢？ | 主调用用 opus（来自 spec-driver.config.yaml 配置） |
| Why 4 | 为何 Fix 133 没修这个？ | Fix 133 P0-2 修了 reading 模式跳过产品文档层 + 模块 spec 的 enrichment，但没动**模块 spec 主调用**的 model 选择 |
| Why 5 | 为何 reading 模式没独立 model override？ | `batch-orchestrator.ts:657-658` 的 `modelOverride` 只覆盖 `isSmallModule` / `budgetCheaperModelAll`，未考虑 `effectiveMode` |

**Root Cause**: reading/code-only 模式没有独立的 model override 路径。当用户配置默认 model = opus（如当前 dogfood）时，reading 模式仍走 opus 主调用，无法稳定保证 < 120s。

**Root Cause Chain**: 499s → 5 × 100s opus → 主调用走 opus → modelOverride 不含 mode 条件 → Fix 133 P0-2 scope 不含 model override。

注：偏差 1 修完后（preset → balanced，agents 全 sonnet），reading 模式自然会快（sonnet 比 opus 快 + cache）。但**方向 A**（reading 强制 sonnet override）是双重保险——即使将来用户改回 quality-first/opus，reading 模式仍硬性 sonnet，确保 < 120s SC-001 始终满足。两个修一起做。

### 偏差 4：CLI --hyperedges flag 不可见

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `spectra batch --help` 为何看不到 `--hyperedges`？ | help 字符串里没列出 |
| Why 2 | 为何 help 字符串没列出？ | `src/cli/index.ts:44` batch 命令的 help 行没加 `[--hyperedges]` |
| Why 3 | 为何 Fix 133 加了实现没加 help？ | parse-args 解析 + batch handler 接入做了，但 help 字符串维护被遗漏 |
| Why 4 | 为何 help 字符串维护容易遗漏？ | help 字符串是手工维护的固定字符串，与 parse-args 解析逻辑没有耦合（无 commander 自动生成） |

[ROOT CAUSE REACHED at Why 4]

**Root Cause**: `src/cli/index.ts:44` batch 命令的 help 字符串遗漏了已实现的 `--hyperedges` flag。

**Root Cause Chain**: 用户 --help 看不到 → help 字符串硬编码缺一项 → 手工维护漏同步。

注：prompt 描述说"commander 注册一行 option"，但实际项目用**自定义 parse-args**（不是 commander），按实际架构修复（追加 help 字符串），不引入 commander 依赖。

## 影响范围扫描

### 同源问题（需同步修复）

| 偏差 | 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|------|----------|
| 1 | `spec-driver.config.yaml` | L1-26 | preset + 10 agent block 全 opus | preset → `balanced`、10 个 `model: opus` → `model: sonnet`、首行注释同步 |
| 2 | `src/auth/cli-proxy.ts` | L258-269 | input 提取仅读主字段 | 累加 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` |
| 2 | `src/core/llm-client.ts` | L319-322 | input 提取仅读主字段 | 同上累加 |
| 3 | `src/batch/batch-orchestrator.ts` | L657-658 | modelOverride 不含 mode 条件 | 追加 `effectiveMode !== 'full'` 条件，让 reading/code-only 强制 sonnet |
| 4 | `src/cli/index.ts` | L44 | batch help 字符串缺 flag | 在 mode 后追加 `[--hyperedges]` |

### 类似模式（已评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/auth/codex-proxy.ts` | L40-44, L234 | codex GPT-5.4 token 提取（仅 input_tokens / output_tokens） | **安全** — codex SDK 不使用 Anthropic 的 cache 字段格式，无需修改 |
| `src/panoramic/qa/llm-caller.ts` | L156, L179 | panoramic QA 独立 LLM 链路 | **不在 scope** — panoramic QA 走独立 facade，本次 fix scope 限定在 spec batch 主链路（cli-proxy + llm-client） |

### 同步更新清单

- **测试新增**：
  - `tests/auth/cli-proxy-token-extraction.test.ts`：mock 真实 Claude CLI stream 响应（含 `cache_creation_input_tokens` + `cache_read_input_tokens`），验证 inputTokens 累加正确
  - `tests/core/llm-client-token-extraction.test.ts`：mock Anthropic SDK 响应（含 cache 字段），验证 inputTokens 累加正确
  - `tests/batch/batch-orchestrator-reading-mode.test.ts`：单元测试 reading 模式必须 modelOverride = sonnet
  - **E2E perf 测试**：因 E2E 需真实 API key，标注为 `it.skip` 或 npm 独立 script，不进 CI 默认；用 `tests/manual/reading-mode-perf.test.ts` 形式归档（按需手动跑）
- **文档更新**：
  - `CHANGELOG.md`：列 Fix 134 修复点（4 项）
  - 不需要更新 `specs/products/spectra/current-spec.md`（dogfood 配置同步 + 内部 token 计算修复，不影响 spec 行为）
- **测试调整（如有副作用）**：现有测试若 mock 了 Anthropic SDK 响应但未提供 cache 字段，应保持兼容（缺失 cache 字段时累加为 0，等价旧行为）

## 修复策略

### 偏差 1（推荐唯一方案）

修改 `spec-driver.config.yaml`：

1. 首行注释 "预设: quality-first（所有阶段均使用 Opus）" → "预设: balanced（默认 Sonnet 4.6，Phase 2 新默认）"
2. `preset: quality-first` → `preset: balanced`
3. 10 个 `model: opus` → `model: sonnet`

### 偏差 2（推荐唯一方案）

- `src/auth/cli-proxy.ts`：在 `result` 类型分支提取 input 时，累加 `usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens`（任一缺失时 fallback 0）。output 已正确（不变）。
- `src/core/llm-client.ts`：`response.usage.input_tokens + response.usage.cache_creation_input_tokens + response.usage.cache_read_input_tokens`（同上 fallback 0）。
- 同步加单元测试覆盖真实 SDK shape

### 偏差 3（推荐方向 A）

- `src/batch/batch-orchestrator.ts:657-658` modelOverride 增加 `effectiveMode !== 'full'`：
  ```typescript
  modelOverride:
    isSmallModule || budgetCheaperModelAll || effectiveMode !== 'full' ? sonnetModelId : undefined,
  ```
- 即 reading/code-only 模式始终强制 sonnet override，与用户配置默认 model 解耦
- 加 reading 模式单测（modelOverride 必须 = sonnet）

**为何不选方向 B**：方向 B 调 SC-001 目标"比 full 快 50%+"语义弱，违反 Phase 2 已发布的硬指标承诺；方向 A 把硬指标作为代码不变量保证，长期主义。

### 偏差 4（推荐唯一方案）

- `src/cli/index.ts:44` batch 行追加 `[--hyperedges]`：
  ```
  spectra batch [--force] [--incremental] [--languages <lang,...>] [--include-docs] [--include-images] [--mode <full|reading|code-only>] [--hyperedges] [--output-dir <dir>]
  ```

## Spec 影响

- 需要更新的 spec：本特性目录 `specs/134-phase2-followup/spec.md`（写入本次 fix scope）
- 不影响 `specs/products/spectra/current-spec.md`（产品级合同未变）
- 不影响 `specs/133-fix-postmortem-phase2/`（历史 spec 保留）

## 范围检查

受影响文件：5 个源码 + 4 个新测试 + 1 个 CHANGELOG = ~10 个文件，跨 3 个模块（config / auth + core / cli）—— 在 fix 模式范围内（< 10 + ≤ 3 模块）。可继续 fix 模式，不需切换 story / feature。
