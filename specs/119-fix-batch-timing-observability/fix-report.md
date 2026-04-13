# 问题修复报告

## 问题描述

1. Sonnet 基础超时偏短（120s），中大型 Python 模块 spec 生成频繁超时降级（实测降级率 50%）
2. batch 处理无阶段耗时可视化，无法区分 AST / context / LLM#1 / enrich / render 各阶段耗时，难以定位瓶颈

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 降级率高（50%）为何发生？ | LLM 调用超时触发降级为 AST-only |
| Why 2 | LLM 调用为何超时？ | `getTimeoutForModel('sonnet')` 返回 `120_000`（2 分钟），Python 复杂模块实测需要 3-8 分钟 |
| Why 3 | 120s 为何不够？ | 上下文拼装后 token 数可达 40k+，Sonnet 响应时间随上下文体积非线性增加 |
| Why 4 | 动态超时扩展为何未救回？ | `getTimeoutForSpecGeneration` 在 base=120s 时，即使扩展也上限不足（如 70k tokens → 360s），而且 batch 小模块优化强制 Sonnet 覆盖了部分中型模块 |
| Why 5 | 为何无法快速定位超时来源？ | `processOneModule` 没有阶段耗时汇总日志，无法区分 AST/context/LLM 各阶段耗时分布 |

**Root Cause**: `getTimeoutForModel` Sonnet 超时基准值 `120_000` 过低，且缺乏可观测性，无法快速诊断哪个阶段是真正瓶颈。

**Root Cause Chain**: 降级率 50% → LLM 超时 → Sonnet base timeout 120s 不足 + 动态扩展上限不够 → 代码写死 → 无测试/监控覆盖

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/core/llm-client.ts` | L138 | `return 120_000` (Sonnet) | 改为 `600_000`（10 分钟） |
| `src/core/single-spec-orchestrator.ts` | L500-545 | enrich 阶段无独立 stage 计时 | 拆出 `enrich` stage 并发射 duration 事件 |
| `src/models/module-spec.ts` | L252 | `StageId` 无 `enrich` | 添加 `'enrich'` 到 union type |
| `src/batch/batch-orchestrator.ts` | L443-448 | `onStageProgress` 不收集阶段耗时 | 收集 stageDurations，模块完成后打印耗时摘要行 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/core/llm-client.ts` | L136 | Opus/Codex 300s 上限 | 安全——大模型 5 分钟足够 |
| `src/core/llm-client.ts` | L153-162 | `getTimeoutForSpecGeneration` 动态扩展 | 安全——Sonnet base 改为 600s 后动态扩展仍有效 |

### 同步更新清单

- 类型: `src/models/module-spec.ts` StageId 添加 `enrich`
- 测试: 检查 batch-orchestrator 和 single-spec-orchestrator 相关测试是否需要更新
- 文档: 无需更新

## 修复策略

### 方案 A（推荐）

1. `llm-client.ts`: Sonnet timeout `120_000` → `600_000`，更新注释（实测中大型模块可达 5-8 分钟）
2. `module-spec.ts`: `StageId` 添加 `'enrich'`
3. `single-spec-orchestrator.ts`: enrich 阶段改发 `stage: 'enrich'` 事件并带 duration
4. `batch-orchestrator.ts`: `processOneModule` 中用闭包收集 stageDurations，成功/降级/失败后打印耗时摘要行

### 方案 B（备选）

仅修改 timeout，不添加 enrich 阶段——可观测性目标无法达成，不推荐。

## Spec 影响

- 需要更新的 spec: 无（`llm-client.ts` 和 `batch-orchestrator.ts` 暂无对应 spec.md）
