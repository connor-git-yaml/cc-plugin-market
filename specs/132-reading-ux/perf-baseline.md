---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-1-perf-baseline
created: 2026-04-20
---

# F5 Step 1 性能基准测量（T-012）

## 冷启动基准测量状态

**[E2E_DEFERRED]**：Step 1 的冷启动基准测量在实施子代理的执行环境中无法完整执行。

**原因**：
1. `graphify` 示例项目需要真实的项目文件系统环境
2. 真实的冷启动测量需要 Anthropic API Key 和 LLM 网络访问
3. batch 完整流水线涉及多个文件系统操作和 LLM 调用，无法在无 API 密钥的 CI 环境中运行

**已完成的验证**：
- BatchMode 类型和 mode dispatcher 已实现并通过单元测试
- generator 过滤逻辑经过 21 条断言验证（三种 mode 各一组）
- CLI `--mode=` flag 解析和 MCP schema 扩展均通过集成测试

## 性能目标（来自 spec.md FR-008 / SC-001）

| 场景 | 目标 | 状态 |
|------|------|------|
| `--mode=reading` 冷启动 | < 300 秒（相对 full ~776s 节省 ≥ 60%） | [E2E_DEFERRED] |
| `--mode=reading` 热启动 | < 60 秒（相对 full 节省 ≥ 90%） | [E2E_DEFERRED] |
| `--mode=code-only` 冷启动 | < 300 秒 | [E2E_DEFERRED] |
| `--mode=code-only` 热启动 | < 60 秒 | [E2E_DEFERRED] |

## 预期性能收益分析

基于 plan §5 的 generator 切分清单：

**reading 模式跳过的 generator**（5 个产品文档层）：
- `adr-pipeline`：ADR 推断（高 LLM 成本）
- `product-ux-docs`：产品文档层（overview/journeys/featureBriefs）
- `troubleshooting`：故障排查推断
- `data-model`：数据模型推断
- `docs-quality-evaluator`：依赖完整文档集

**code-only 模式额外跳过**（+8 个架构推断层）：
- `architecture-overview`、`architecture-ir`、`pattern-hints`
- `event-surface`、`runtime-topology`
- `architecture-narrative`、`component-view`、`dynamic-scenarios`

**batch-orchestrator 层面**：
- Coverage Audit 阶段跳过（reading/code-only）
- Docs Bundle 阶段跳过（reading/code-only）

理论上 reading 模式可节省 5-7 个 LLM 密集型 generator 的执行时间，预计节省 ≥ 60% 总耗时。

## 待 verify 阶段补充

T-041（Step 5）将在有真实项目和 API Key 的环境中进行实际测量，补充本文件的实测数据。

验证命令（T-041 使用）：
```bash
# 清空缓存后冷启动
rm -rf specs/_meta/ specs/modules/ specs/project/
time spectra batch --mode=reading --project-root ./graphify-sample

# 热启动（缓存已存在）
time spectra batch --mode=reading --project-root ./graphify-sample
```
