# 问题修复报告 — Feature 179

## 问题描述

三个互相独立的一致性问题需要同步修复：

1. **Problem 1（核心 over-claim）** — `graph.json` 落盘后含实时时间戳，非真 byte-stable
2. **Problem 2（eval 语义脆弱）** — 3 处 eval code-only batch 缺 `--full` flag
3. **Problem 3（eval 事实失真）** — 2 处 eval prompt 仍引用 F174 已删的 `findFuzzyMatches`

---

## Problem 1: graph.json 非真 byte-stable（核心）

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 同语义两次 full run 的 graph.json 逐字节不同？ | `graph.generatedAt` 是实时墙钟时间戳，每次运行都不同 |
| Why 2 | `graph.generatedAt` 为何保留了实时时间戳？ | `batch-orchestrator.ts:1565` 调 `normalizeGraphForWrite(graphJson)` 时未传 `stripTimestamps: true` |
| Why 3 | `stripTimestamps` 为何未在调用点开启？ | F175 实现时在测试读取侧加了 `delete generatedAt` workaround，使 E2E 测试通过，但落盘侧未真正固定 |
| Why 4 | 为何 workaround 而非落盘侧修复？ | 对测试通过结果等价（两种方式都能让 deepEqual 成立），但 commit 声称 "byte-stable graph.json" 是 over-claim（真实落盘文件不是 byte-stable）|
| Why 5 | 为何现有护栏未发现落盘不稳定？ | F175 E2E 测试函数 `readNormalizedGraph` 在读取侧剥 `generatedAt` 再 deepEqual，掩盖了落盘侧的真实时间戳存在 |

**Root Cause**: `normalizeGraphForWrite` 调用点缺少 `{ stripTimestamps: true }`；F175 在读取侧做了时间戳剥除 workaround，使测试通过但掩盖了落盘不稳定事实。

**Root Cause Chain**: 落盘字节不同 → `graph.generatedAt` 每次不同 → `stripTimestamps` 默认 off → 调用点未传参 → F175 用读取侧 workaround 绕过 → 测试护栏无法感知落盘侧真实状态

### 影响范围扫描

**消费方依赖 `graph.generatedAt` 分析**（须确认固定 epoch 无副作用）：

经 grep `generatedAt` 全仓扫描：
- `src/panoramic/cross-reference-index.ts:37,138` — 读 `docGraph.generatedAt`，类型是 `DocGraph`（非 `GraphJSON`），**不受影响**
- `src/panoramic/builders/*` — 各 builder 的自有 `generatedAt` 字段，非 `graph.json` 的 `graph.generatedAt`，**不受影响**
- `src/panoramic/graph/graph-builder.ts:459` — 设置 `graphJson.graph.generatedAt = new Date().toISOString()`（创建侧），`stripTimestamps: true` 调用后 in-place 改为固定 epoch，**不影响其他消费方**
- `buildHtmlTemplate` 接收 `{ ...graphJson, nodes: enrichedNodes }`（浅 spread）— 在 `normalizeGraphForWrite` 之后执行，`enrichedGraphJson.graph.generatedAt` 将是固定 epoch `'1970-01-01T00:00:00.000Z'`，HTML 中仅作显示元数据，**无语义依赖，安全**
- 测试中的 `graph-builder.test.ts:140` — `expect(typeof result.graph.generatedAt).toBe('string')` — epoch 字符串仍是 string，**不受影响**

**结论**：`graph.generatedAt` 设为固定 epoch 对所有消费方安全，无任何消费方依赖真实生成时间做缓存失效、条件判断或报告展示。

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/batch/batch-orchestrator.ts` | L1565 | `normalizeGraphForWrite(graphJson)` | 改为 `normalizeGraphForWrite(graphJson, { stripTimestamps: true })` |

### 类似模式（评估结果）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `tests/e2e/feature-175-batch-incremental.e2e.test.ts` | L210-236 `readNormalizedGraph` | `delete graphMeta['generatedAt']` + 注释声称 batch 路径未传 stripTimestamps | 落盘侧修复后，此处 delete 操作变为删除固定 epoch（无害）。**需更新注释**说明实际状态，`delete` 语句可保留作防御兜底 |

### 同步更新清单

- 调用方：`src/batch/batch-orchestrator.ts:1565` — 修改 normalizeGraphForWrite 调用
- 测试：`tests/e2e/feature-175-batch-incremental.e2e.test.ts` — 更新 `readNormalizedGraph` 注释，说明落盘侧已 byte-stable，delete 为防御兜底
- 文档：无需额外更新

---

## Problem 2: eval code-only batch 缺 --full

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | eval 脚本多次运行时结果语义不一致？ | 未传 `--full`，第二次运行命中增量缓存，不全量重建 |
| Why 2 | 不传 `--full` 会怎样？ | `resolveRegenPlan` 无参数默认 `{ incremental: true, full: false }`（`src/batch/regen-plan.ts:77`）|
| Why 3 | eval 脚本为何未显式传 `--full`？ | 这些脚本写于 F175 增量化之前，或实现时未考虑到默认 incremental 翻转的影响 |

**Root Cause Chain**: eval 脚本第二轮命中增量缓存 → 未传 `--full` → `resolveRegenPlan` 默认 incremental=true → 新旧 eval 结果语义不对等

### 影响范围（3 处 spectra code-only batch 调用）

| 文件 | 位置 | 当前调用 | 需补 |
|------|------|---------|------|
| `scripts/eval-task-runner.mjs` | L286 | `batch --mode code-only --no-html` | `--full` |
| `scripts/feature-170c-sc002-driver-eval.mjs` | L121 | `batch --mode code-only --no-html` | `--full` |
| `scripts/feature-170d-driver-preference.mjs` | L145 | `batch --mode code-only --no-html` | `--full` |

**注**：`scripts/eval-competitor.mjs:340` 的 `['build', '--no-llm', '--code-only']` 是 graphify 工具的参数（非 spectra），不在修复范围。

---

## Problem 3: eval prompt 引用已删函数

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | eval prompt 中 `findFuzzyMatches` 不存在？ | F174 将其改名/替换为 `resolveSymbolFuzzy` |
| Why 2 | F174 改动时为何未更新 eval prompt？ | eval prompt 是 JS 字符串，TypeScript 类型检查不覆盖字符串内容 |
| Why 3 | 影响是什么？ | LLM driver 尝试验证/调用一个已不存在的函数，测试场景（SC-002）返回虚假成功或低质量结果 |

**Root Cause Chain**: eval prompt 含过期 API 引用 → 非代码字符串不受类型检查 → F174 改动后未同步更新

### 影响范围（2 处 findFuzzyMatches 引用）

| 文件 | 位置 | 当前内容 | 修复 |
|------|------|---------|------|
| `scripts/lib/driver-eval-core.mjs` | L17 | `findFuzzyMatches` | 改为 `resolveSymbolFuzzy` |
| `scripts/feature-170c-sc002-driver-eval.mjs` | L50 | `findFuzzyMatches` | 改为 `resolveSymbolFuzzy` |

---

## 修复策略

### 方案 A（推荐）— 精准点修复，最小化变更

**Problem 1**:
```typescript
// src/batch/batch-orchestrator.ts:1565
// Before:
normalizeGraphForWrite(graphJson);
// After:
normalizeGraphForWrite(graphJson, { stripTimestamps: true });
```

并更新 `tests/e2e/feature-175-batch-incremental.e2e.test.ts` 中 `readNormalizedGraph` 的注释，说明落盘侧已真 byte-stable，delete 为防御兜底。

**Problem 2**:
在 3 处 spectra code-only batch 调用后补 `'--full'` 参数。

**Problem 3**:
在 2 处 eval prompt 字符串中将 `findFuzzyMatches` 改为 `resolveSymbolFuzzy`。

### 方案 B（不推荐）— 修改 `normalizeGraphForWrite` 函数签名

将 `stripTimestamps` 默认改为 `true`，所有调用方自动生效。风险：可能改变 test 中 unit 级别对 `normalizeGraphForWrite` 的调用预期，且破坏"选项显式传入"的设计意图。**不推荐**。

---

## Spec 影响

- 不需要更新现有 spec 文件（此次修复是 over-claim 闭合，非新功能）
- F175 E2E 测试需更新注释（非逻辑变更）

---

## 修复摘要（3 文件，5 处改动）

| # | 文件 | 改动 | 性质 |
|---|------|------|------|
| 1 | `src/batch/batch-orchestrator.ts:1565` | 补 `{ stripTimestamps: true }` | **核心修复** |
| 2 | `tests/e2e/feature-175-batch-incremental.e2e.test.ts` | 更新注释 | 说明真实状态 |
| 3 | `scripts/eval-task-runner.mjs:286` | 补 `--full` | eval 语义修复 |
| 4 | `scripts/feature-170c-sc002-driver-eval.mjs:121` | 补 `--full` | eval 语义修复 |
| 5 | `scripts/feature-170d-driver-preference.mjs:145` | 补 `--full` | eval 语义修复 |
| 6 | `scripts/lib/driver-eval-core.mjs:17` | `findFuzzyMatches` → `resolveSymbolFuzzy` | eval 事实修复 |
| 7 | `scripts/feature-170c-sc002-driver-eval.mjs:50` | `findFuzzyMatches` → `resolveSymbolFuzzy` | eval 事实修复 |
