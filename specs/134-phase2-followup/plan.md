---
title: Fix 134 — Phase 2 收尾的清理 Fix（4 个偏差修复规划）
mode: fix
status: plan-complete
created: 2026-04-26
parent: fix-report.md
---

# 修复规划

## 目标

修复 Phase 2 集成回归测试在 graphify 示例项目（5 Python 文件）上发现的 Fix 133 残留 4 个偏差，让 dogfood + reading 模式 + token 计算 + CLI help 全部跟随 Phase 2 新默认。

## 变更清单（最小化变更原则）

### 变更 1：`spec-driver.config.yaml`（偏差 1）

| 行 | 现状 | 修改后 |
|----|------|--------|
| L1-3 | `# 预设: quality-first（所有阶段均使用 Opus）` | `# 预设: balanced（默认 Sonnet 4.6，Phase 2 新默认）` |
| L4 | `preset: quality-first` | `preset: balanced` |
| L7-26 | 10 个 `model: opus` | 10 个 `model: sonnet` |

### 变更 2：`src/auth/cli-proxy.ts`（偏差 2）

| 行 | 现状 | 修改后 |
|----|------|--------|
| L256-269 | `inputTokens = msg.usage?.input_tokens ?? msg.input_tokens` | 累加 `usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens`（任一缺失 fallback 0），同步保留顶层兼容路径 |

实施细节：

- 新工具函数 `extractInputTokens(usage)`（或 inline 累加）：
  ```typescript
  const inputFromUsage = msg.usage
    ? (msg.usage.input_tokens ?? 0)
      + (msg.usage.cache_creation_input_tokens ?? 0)
      + (msg.usage.cache_read_input_tokens ?? 0)
    : undefined;
  ```
- 顶层 `msg.input_tokens` 兼容路径保持原行为（无 cache 字段）
- output 路径不变（已正确）

### 变更 3：`src/core/llm-client.ts`（偏差 2）

| 行 | 现状 | 修改后 |
|----|------|--------|
| L319-322 | `inputTokens: response.usage.input_tokens` | `inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0)` |

实施细节：

- Anthropic SDK `MessageCreateResponse` 已含 `cache_creation_input_tokens` 和 `cache_read_input_tokens` 类型字段
- output 路径不变

### 变更 4：`src/batch/batch-orchestrator.ts`（偏差 3，方向 A）

| 行 | 现状 | 修改后 |
|----|------|--------|
| L657-658 | `modelOverride: isSmallModule \|\| budgetCheaperModelAll ? sonnetModelId : undefined` | `modelOverride: isSmallModule \|\| budgetCheaperModelAll \|\| effectiveMode !== 'full' ? sonnetModelId : undefined` |

实施细节：

- 行内追加 `effectiveMode !== 'full'` 即可
- 注释更新："reading/code-only 模式强制 sonnet override（Fix 134 P0-3：保证 SC-001 < 120s）"

### 变更 5：`src/cli/index.ts`（偏差 4）

| 行 | 现状 | 修改后 |
|----|------|--------|
| L44 | `spectra batch [--force] ... [--mode <full\|reading\|code-only>] [--output-dir <dir>]` | 在 mode 后追加 `[--hyperedges]` |

最终：

```text
spectra batch [--force] [--incremental] [--languages <lang,...>] [--include-docs] [--include-images] [--mode <full|reading|code-only>] [--hyperedges] [--output-dir <dir>]
```

## 测试新增清单

### 单元测试

- **`tests/auth/cli-proxy-token-extraction.test.ts`**（偏差 2）
  - mock Claude CLI stream `result` 类型 message，包含 `usage.input_tokens=100`, `usage.cache_creation_input_tokens=200`, `usage.cache_read_input_tokens=300`, `usage.output_tokens=50`
  - 断言：parsed.inputTokens === 600（100+200+300），outputTokens === 50
  - 兼容性：旧顶层 `input_tokens` 无 cache 子字段时，inputTokens 等于顶层数值

- **`tests/core/llm-client-token-extraction.test.ts`**（偏差 2）
  - mock Anthropic SDK `messages.create` 返回 `usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 50 }`
  - 断言：result.inputTokens === 600，result.outputTokens === 50

- **`tests/batch/batch-orchestrator-reading-mode.test.ts`**（偏差 3）
  - 给定 effectiveMode = 'reading'，断言 modelOverride === sonnetModelId
  - 给定 effectiveMode = 'code-only'，断言 modelOverride === sonnetModelId
  - 给定 effectiveMode = 'full' 且 isSmallModule = false 且 budgetCheaperModelAll = false，断言 modelOverride === undefined
  - 注：可通过测试纯函数（重构出 `decideModelOverride` helper）或者通过暴露内部状态实现

### E2E perf 测试（手动跑，不进 CI 默认）

- **`tests/manual/reading-mode-perf.test.ts`**（标 `it.skip` 或独立 npm script）
  - 在真实 graphify 项目（5 Python 文件）跑 `spectra batch --mode reading`
  - 断言 `totalDurationMs < 120_000`（SC-001 硬指标）

## 验证方案

### 自动化验证

- `npx vitest run`：零新增失败（pre-existing `export-command.test.ts` 除外）
- `npm run build`：零类型错误
- `npm run repo:check`：全绿

### 端到端验证（按 prompt 三场景）

执行在 graphify 示例项目：

| 场景 | 命令 | 期望 |
|------|------|------|
| 1 | `rm -rf specs && spectra batch .`（修偏差 1+2 后） | spec frontmatter `llmModel: "claude-sonnet-4-6"`、`tokenUsage.input > 1000` |
| 2 | `rm -rf specs && spectra batch --mode reading .`（修偏差 3 后） | 总耗时 < 120s（SC-001） |
| 3 | `spectra batch --help \| grep -- "--hyperedges"`（修偏差 4 后） | help 中能看到 `--hyperedges` |

### Spec 同步

- 本特性目录 `specs/134-phase2-followup/spec.md` 已由 init 脚本生成（保持原状或后续 verify 阶段补 fix scope 描述）

## 回归风险评估

| 偏差 | 风险 | 应对 |
|------|------|------|
| 1 | dogfood 改 yaml 配置后，旧 `agents.specify-sonnet` 的 sonnet override 实际上之前是 opus（bug），改完才是真 sonnet — 预期：小模块优化和 budget 降级实际开始生效 | 这是修正旧 bug，预期变更但符合设计意图；CHANGELOG 标注 |
| 2 | inputTokens 数值显著增加（+ cache 子字段），可能影响下游 cost 计算/budget gate | budget gate 阈值是 token 总量，更准的 input 计数让 budget gate 更准；预期变化合理 |
| 3 | reading 模式 enrichment 已跳过，加 model override 后 spec 质量从 opus → sonnet | sonnet 4.6 模块 spec 质量足够代码阅读场景；与 Fix 133 P0-3 source code 默认对齐 |
| 4 | 仅 help 字符串变化，无运行时风险 | 无 |

## 执行顺序

按 prompt 推荐：

1. **Step 1**：偏差 1（spec-driver.config.yaml），最简单、独立 commit
2. **Step 2**：偏差 4（src/cli/index.ts:44），单行 help 字符串，独立 commit
3. **Step 3**：偏差 2（cli-proxy + llm-client + 单测），独立 commit
4. **Step 4**：偏差 3（batch-orchestrator + 单测），独立 commit
5. **Step 5**（合并到上一个 commit 或独立）：CHANGELOG 更新

## Spec 影响

- 不影响 `specs/products/spectra/current-spec.md`（产品级合同未变）
- 本特性目录的 spec.md 由 init 脚本生成；fix 模式下不强制刷写
