---
title: Fix 134 — Spec 合规审查报告
mode: fix
phase: verify-4a
status: PASS
created: 2026-04-26
---

# Spec 合规审查报告（Phase 4a）

**整体评级：PASS**

## 逐条 FR 状态

fix-report.md 定义了 5 个变更点（同源问题）+ 4 个测试新增 + 2 个"类似模式"评估。逐条核验：

| 变更点 | 文件 + 位置 | 状态 | 证据 commit |
|-------|------------|------|-------------|
| 偏差 1-A：yaml preset → balanced | `spec-driver.config.yaml:4` | 已实现 | ebbda44 |
| 偏差 1-B：10 个 agent block model → sonnet | `spec-driver.config.yaml:7-26` | 已实现 | ebbda44 |
| 偏差 1-C：首行注释同步 | `spec-driver.config.yaml:2` | 已实现 | ebbda44 |
| 偏差 1 附带 bug：sonnetModelId fallback 修复 | `src/core/model-selection.ts:162` + yaml preset | 已实现（间接） | preset → balanced → PRESET_MODEL_MAP.balanced='sonnet'，fallback 路径返回 sonnet |
| 偏差 2-A：cli-proxy.ts input 累加 cache 字段 | `src/auth/cli-proxy.ts:266-270` | 已实现 | 20a706b |
| 偏差 2-B：llm-client.ts input 累加 cache 字段 | `src/core/llm-client.ts:324-326` | 已实现 | 20a706b |
| 偏差 3：reading/code-only 模式强制 sonnet override | `src/batch/model-override-decision.ts` + `batch-orchestrator.ts:661-666` | 已实现 | fd71436 |
| 偏差 4：CLI batch help 字符串追加 --hyperedges | `src/cli/index.ts:44` + `:98` | 已实现 | 08adb72 |

| 测试新增项 | fix-report 计划路径 | 实际路径 | 状态 |
|-----------|-------------------|---------|------|
| cli-proxy token 提取测试 | `tests/auth/cli-proxy-token-extraction.test.ts` | `tests/unit/cli-proxy.test.ts`（内嵌 Fix 134 cases） | 已实现（路径偏差，功能等价） |
| llm-client token 提取测试 | `tests/core/llm-client-token-extraction.test.ts` | `tests/unit/llm-client-token-extraction.test.ts` | 已实现（父目录路径偏差，功能等价） |
| batch reading-mode 测试 | `tests/batch/batch-orchestrator-reading-mode.test.ts` | `tests/batch/model-override-decision.test.ts` | 已实现（名称偏差，测试 helper 而非 orchestrator 直接） |
| E2E perf 测试 | `tests/manual/reading-mode-perf.test.ts`（标 skip） | 未实现 | 未实现（fix-report 明确"按需手动跑"，不进 CI 默认） |

**核心变更点合规率**：8/8（100%）；测试新增 3/4（75%，E2E perf 测试为可选）。

## 偏差清单

| 偏差 | 严重度 | 描述 | 建议 |
|------|--------|------|------|
| 测试路径命名偏离 fix-report | WARNING | fix-report.md 计划的 `tests/auth/` 和 `tests/core/` 子目录在项目中不存在（项目惯例是 `tests/unit/`）；batch 测试改名为 `model-override-decision.test.ts` 更准确反映被测对象 | 路径调整符合项目结构惯例，功能完全覆盖；fix-report 作为历史诊断报告保留即可，无需追溯调整 |
| E2E perf 测试未实现 | INFO | `tests/manual/reading-mode-perf.test.ts` 不存在 | fix-report 明确"按需手动跑、不进 CI"；端到端验证（Phase 4 后续）通过 graphify 示例项目实跑覆盖 |

## 过度实现检测

| 位置 | 描述 | 风险 |
|------|------|------|
| `src/batch/model-override-decision.ts`（新文件） | tasks.md T4.3 明确要求"通过提取 helper 函数 decideModelOverride 让逻辑可测试" | 在 spec scope 内 |
| `src/cli/index.ts:98` 增加 `--hyperedges` 选项详情说明 | fix-report 仅要求追加 L44 用法行；L98 选项说明属于合理超出（用户可见性改善） | INFO 级，无副作用 |

## "类似模式"评估复核

| 文件 | fix-report 评估 | 复核结论 |
|------|---------------|---------|
| `src/auth/codex-proxy.ts:35-47` | 安全，不使用 Anthropic cache 字段 | **确认**：`CodexJsonEvent.usage` 仅有 `input_tokens` / `output_tokens`，无 Anthropic cache 字段，无需修改 |
| `src/panoramic/qa/llm-caller.ts:179` | 不在 scope，独立 facade | **确认**：仅读 `response.usage?.input_tokens`，是独立链路；若该链路启用 prompt caching 同样会低估，但 Fix 134 限定 scope 在 batch 主链路，遗留可接受 |

## 问题分级汇总

- **CRITICAL**: 0
- **WARNING**: 1（测试路径命名，无功能影响）
- **INFO**: 2（E2E perf 测试可选；help 选项说明合理超出）

## 结论

所有 4 个偏差的 root cause 均已在代码层修复，且修复方式忠实对应 fix-report 诊断。未发现 scope 漂移（未触碰 `.codex/**` 或 `.claude/**`）。CHANGELOG T5 已正确列出全部 4 个偏差修复。
