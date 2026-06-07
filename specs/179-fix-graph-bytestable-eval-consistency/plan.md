# 修复规划 — Feature 179

## 背景

闭合 F175 的 over-claim：`graph.json` 落盘侧真 byte-stable，同时修复 eval 脚本的两个一致性问题。

## 修复策略

**方案 A（采用）**：精准点修复，最小化变更面，零架构改动。

## 变更清单（按优先级）

### P1 — 核心 byte-stable 修复

**文件**：`src/batch/batch-orchestrator.ts`  
**位置**：L1565  
**改动**：`normalizeGraphForWrite(graphJson)` → `normalizeGraphForWrite(graphJson, { stripTimestamps: true })`  
**为何安全**：`NormalizeGraphOptions.stripTimestamps` 已实现（graph-builder.ts:545-551），把 `graph.generatedAt` 原地改为 `'1970-01-01T00:00:00.000Z'`；所有消费方（HTML builder、社区分析等）均在此调用之前执行，无任何消费方在写盘后读取 `graph.generatedAt` 做语义决策。

### P2 — F175 E2E 注释更新

**文件**：`tests/e2e/feature-175-batch-incremental.e2e.test.ts`  
**位置**：`readNormalizedGraph` 函数（L210-226）  
**改动**：更新注释，说明落盘侧已真 byte-stable（batch-orchestrator 传 `stripTimestamps: true`），`delete generatedAt` 保留为防御兜底（无害）。逻辑无变更。

### P3 — eval code-only batch 补 --full

**文件**：3 个 eval 脚本  
- `scripts/eval-task-runner.mjs:286`
- `scripts/feature-170c-sc002-driver-eval.mjs:121`
- `scripts/feature-170d-driver-preference.mjs:145`

**改动**：在各调用的 args 数组末尾追加 `'--full'`。

### P4 — eval prompt 更新 API 引用

**文件**：2 个 eval 脚本  
- `scripts/lib/driver-eval-core.mjs:17`
- `scripts/feature-170c-sc002-driver-eval.mjs:50`

**改动**：字符串内 `findFuzzyMatches` → `resolveSymbolFuzzy`。

## 回归风险评估

| 风险 | 评级 | 说明 |
|------|------|------|
| graph.html 显示 epoch 时间戳 | 低 | 仅元数据展示，无功能依赖 |
| F175 E2E 测试失败 | 无 | readNormalizedGraph 仍 delete generatedAt（幂等），断言不变 |
| 其他 vitest 测试失败 | 无 | 无测试依赖 `graph.generatedAt` 非 epoch 值 |
| eval 脚本行为变化 | 低 | --full 使每次全量重建（更确定性，非退化） |

## 修复验证方案

1. **落盘 byte-stable 验证**：两次 `npx vitest run tests/e2e/feature-175-batch-incremental.e2e.test.ts` 均 pass
2. **全量单元测试**：`npx vitest run` → 4111+ pass, 0 fail
3. **构建验证**：`npm run build` 类型检查零错误
4. **仓库一致性**：`npm run repo:check` 零报错
