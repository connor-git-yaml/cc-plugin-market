---
title: Fix 134 — 工具链验证 + 证据核查
mode: fix
phase: verify-4c
status: PASS
created: 2026-04-26
---

# 工具链验证 + 证据核查报告（Phase 4c）

**整体评级：PASS**

## 工具链验证

| 命令 | 结果 | 证据 |
|------|------|------|
| `npm run build`（tsc 编译） | ✅ 零错误 | 无任何 stderr 输出 |
| `npm run lint`（tsc --noEmit） | ✅ 零错误 | 无任何 stderr 输出 |
| `npx vitest run`（全量） | ✅ 2194 passed \| 1 skipped \| 226 files | 零新增失败；新增的 25 个测试全过（cli-proxy 13 + llm-client-token-extraction 4 + model-override-decision 8） |
| `npm run repo:check` | ✅ status=pass | 全部 39 项检查通过（含 marketplace / spec-driver-wrappers / spectra-skills / runtime-boundaries / release-contract 等） |
| `npm run release:check` | ✅ Release contract valid | `contracts/release-contract.yaml` 校验通过 |

## 偏差 1（spec-driver.config.yaml + sonnetModelId fallback bug）端到端验证

```bash
node -e "const { resolveReverseSpecModel } = require('./dist/core/model-selection.js');
console.log('specify        →', resolveReverseSpecModel({ agentId: 'specify' }).model);
console.log('specify-sonnet →', resolveReverseSpecModel({ agentId: 'specify-sonnet' }).model);
console.log('default        →', resolveReverseSpecModel().model);"
```

输出：
```text
specify        → claude-sonnet-4-6 (source: driver-config-agent)
specify-sonnet → claude-sonnet-4-6 (source: driver-config-preset)   <- fallback bug 已修
default        → claude-sonnet-4-6 (source: driver-config-agent)
```

✅ 三种 agentId 解析路径全部返回 `claude-sonnet-4-6`；`specify-sonnet`（yaml 不存在的 agent ID）通过 preset='balanced' fallback 命中 sonnet，而非旧的 quality-first/opus。

## 偏差 2（cli-proxy + llm-client cache token 累加）单测验证

```bash
npx vitest run tests/unit/cli-proxy.test.ts tests/unit/llm-client-token-extraction.test.ts
```

输出：
- `tests/unit/cli-proxy.test.ts`: 13 tests passed（含 3 个 Fix 134 cache 累加 case）
- `tests/unit/llm-client-token-extraction.test.ts`: 4 tests passed（含 null 边界 + 累加 + 退化 + 仅 cache_read）

✅ 单元测试覆盖：
- 真实 prompt caching 场景（input_tokens=100 + cache_creation=200 + cache_read=1500 → inputTokens=1800）
- 仅有 cache_read（input_tokens 缺失边界）
- 向后兼容（无 cache 子字段，旧响应格式）
- null 字段（与 SDK 类型 `number | null` 对齐）

## 偏差 3（reading 模式强制 sonnet override）决策矩阵验证

```bash
node -e "const { decideModelOverride } = require('./dist/batch/model-override-decision.js'); ..."
```

输出：
```text
reading 模式             → sonnet override (claude-sonnet-4-6)
code-only 模式           → sonnet override (claude-sonnet-4-6)
full + 普通模块          → 默认 model
full + 小模块            → sonnet override (claude-sonnet-4-6)
full + budget 降级       → sonnet override (claude-sonnet-4-6)
```

✅ 决策矩阵符合 fix-report 设计：
- `effectiveMode !== 'full'` → 强制 sonnet（核心 Fix 134 P0-3）
- `isSmallModule` 或 `budgetCheaperModelAll` → 沿用既有降级（保留 Phase 2 行为）
- full + 普通模块 + 无降级 → 沿用默认 model（不破坏 quality-first 用户场景）

## 偏差 4（CLI batch help --hyperedges）端到端验证

```bash
node dist/cli/index.js --help | grep -- "--hyperedges"
```

输出：
```text
  spectra batch [--force] [--incremental] [--languages <lang,...>] [--include-docs] [--include-images] [--mode <full|reading|code-only>] [--hyperedges] [--output-dir <dir>]
  --hyperedges   启用 hyperedge LLM 提取（仅 batch + mode=full 生效，默认 false；可用 env SPECTRA_HYPEREDGES_ENABLED=true 等价开启）
```

✅ help 输出包含 `--hyperedges` 用法行 + 选项说明行。

## Spec-review + Quality-review 三方核查

| Phase | 报告 | 评级 | 关键发现 |
|-------|------|------|---------|
| 4a Spec compliance | `verification/spec-review-report.md` | PASS | 8/8 核心变更点已实现；测试路径偏离 fix-report 但功能等价（项目结构原因） |
| 4b Quality | `verification/quality-review-report.md` | GOOD | 3 WARNING 中 2 个已应用（commit 43bbd9a），1 个 pre-existing 不在 scope |
| 4c Toolchain + Evidence | 本报告 | PASS | build / lint / vitest / repo:check / release:check 全部零失败 |

## 待跟进项（不阻塞本次交付）

- E2E perf 测试（`tests/manual/reading-mode-perf.test.ts`）未实现 — fix-report 明确"按需手动跑、不进 CI"，端到端验证将在 Phase 5（用户授权 push 前）通过 graphify 示例项目实跑覆盖
- `tests/unit/cli-proxy.test.ts:26` 的 `as any` 是 pre-existing 代码（commit 6dbde13），建议作为后续单独的 `chore: 测试规范整改` 处理

## 结论

Fix 134 的 4 个偏差全部修复，工具链零失败，单元测试覆盖完整（25 新增 + 1 调整）。**通过 Phase 4 验证闭环**。

下一步：在 graphify 示例项目执行端到端三场景验证，rebase master，等待用户授权 push。
