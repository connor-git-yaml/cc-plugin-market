---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-5-perf-baseline
created: 2026-04-20
updated: 2026-04-20
---

# F5 性能基准测量（T-041）

## T-040 预检结果

```
命令: npx vitest run
退出码: 0
测试结果: 220 test files passed, 2145 tests passed, 0 failed
构建结果: npm run build — 退出码 0，零错误
仓库检查: npm run repo:check — 全部 25 项 pass
```

## 冷热启动性能测量状态

**[E2E_DEFERRED]**：T-041 真实 E2E 性能测量需要 Anthropic API Key，当前环境 `ANTHROPIC_API_KEY=UNSET`。

**延期理由**：
1. `ANTHROPIC_API_KEY` 在当前执行环境未设置（`[ -n "$ANTHROPIC_API_KEY" ]` 返回 false）
2. `spectra batch --mode=reading` 完整流水线涉及多个 LLM 调用，无 API Key 无法正常执行
3. graphify 示例项目的 batch 运行需要真实网络连接到 Anthropic API

**延期到 verify 阶段**：验证者需要在配置了 `ANTHROPIC_API_KEY` 的环境中执行以下命令。

## 代码级结构验证（当前环境可完成）

已通过单元测试验证的 mode 分派行为：

| 验证项 | 状态 |
|--------|------|
| `effectiveMode = 'reading'` 时 Coverage Audit 跳过 | ✅（单测 + 代码审查，batch-orchestrator.ts L998-1000） |
| `effectiveMode = 'reading'` 时 Docs Bundle 跳过 | ✅（batch-orchestrator.ts L1042-1044） |
| `effectiveMode = 'code-only'` 时 `skipEnrichment=true` | ✅（batch-orchestrator.ts L642） |
| `--mode=invalid` 时抛出含枚举值的错误 | ✅（单测 + 代码审查，batch-orchestrator.ts L275-277） |
| FR-006：日志输出 `[info] batch mode: <mode>` | ✅（batch-orchestrator.ts L284） |

## 性能目标（来自 spec.md FR-008 / SC-001）

| 场景 | 目标 | 状态 |
|------|------|------|
| `--mode=reading` 冷启动 | < 300 秒（相对 full 节省 ≥ 60%） | [E2E_DEFERRED] |
| `--mode=reading` 热启动 | < 60 秒（相对 full 节省 ≥ 90%） | [E2E_DEFERRED] |
| `--mode=code-only` 冷启动 | < 300 秒 | [E2E_DEFERRED] |
| `--mode=code-only` 热启动 | < 60 秒 | [E2E_DEFERRED] |

## 预期性能收益分析

基于实现代码的 generator 切分清单（已在单测中验证）：

**reading 模式跳过的 generator**（`READING_SKIP_IDS`，5 个产品文档层）：
- `adr-pipeline`：ADR 推断（高 LLM 成本）
- `product-ux-docs`：产品文档层（overview/journeys/featureBriefs）
- `troubleshooting`：故障排查推断
- `data-model`：数据模型推断
- `docs-quality-evaluator`：依赖完整文档集

**code-only 模式额外跳过**（`CODE_ONLY_SKIP_IDS`，+8 个架构推断层）：
- `architecture-overview`、`architecture-ir`、`pattern-hints`
- `event-surface`、`runtime-topology`
- `architecture-narrative`、`component-view`、`dynamic-scenarios`

**batch-orchestrator 层面额外跳过**：
- Coverage Audit 阶段（reading/code-only）
- Docs Bundle 阶段（reading/code-only）

理论上 reading 模式节省 5 个 LLM 密集型 generator + 2 个 pipeline 阶段，预计节省 ≥ 60% 总耗时。

## verify 阶段验证命令

```bash
# 确认 API Key 已设置
[ -n "$ANTHROPIC_API_KEY" ] && echo "SET" || echo "UNSET"

# 清空缓存后冷启动测量
cd _reference/graphify/worked/example/raw
rm -rf graphify-out/_meta/ graphify-out/modules/ graphify-out/project/
time npx tsx ../../../../../../src/cli/index.ts batch . --mode=reading

# 热启动测量（缓存已存在）
time npx tsx ../../../../../../src/cli/index.ts batch . --mode=reading

# code-only 模式
rm -rf graphify-out/_meta/ graphify-out/modules/ graphify-out/project/
time npx tsx ../../../../../../src/cli/index.ts batch . --mode=code-only
time npx tsx ../../../../../../src/cli/index.ts batch . --mode=code-only
```

## 风险标记

- **R5 风险**：若实测超过 300s/60s 目标，参照 plan §10 R5 缓解策略决策。此为已知风险，不阻断交付。
