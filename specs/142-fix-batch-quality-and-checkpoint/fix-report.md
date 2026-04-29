# 问题修复报告 — Feature 142：v4.0.2 Batch 质量 + 跨模式断点修复

## 问题描述

在 sindresorhus/p-queue（5 文件 TS / 1292 LOC）端到端验证中发现 4 类新问题。
经代码扫描核实，Bug 2（reading mode 无 batch-summary）为**误报**（代码和测试均证实会生成），
实际需修复 3 个 bug。

---

## Bug 1：单模块 LLM 重试无 token 预算上限

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | bench.ts 类文件消耗 45k 额外 token | 重试 3 次，每次消耗 ~15k input tokens |
| Why 2 | 为何重试 3 次仍 fail? | LLM 输出无法满足 spec 提取合同，相同 prompt 重跑同样失败 |
| Why 3 | 为何没有早期短路？ | 批处理只检查重试次数（`retryCount < maxRetries`，上限 3），无累计 token 预算检查 |
| Why 4 | 为何没有 token 预算检查？ | `src/batch/batch-orchestrator.ts:654-829` 重试循环仅检查 `moduleSuccess`，`tokenUsage` 累计值不参与 loop 控制 |
| Why 5 | 为何测试未捕获？| 现有测试 mock LLM 不计 token；无集成测试覆盖"高 token 消耗模块"场景 |

**Root Cause**（[ROOT CAUSE REACHED at Why 3]）：`while (retryCount < maxRetries && !moduleSuccess)` 循环缺少单模块累计 token 预算检查，相同 prompt 失败后会完整重跑 3 次，每次产生相同的 token 浪费。

**Root Cause Chain**：bench.ts 失败 → 重试 → prompt 相同结果相同 → 再重试 → 共 3 次 × 15k = 45k 浪费 → 无 token 预算短路机制

### 影响范围

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/batch/batch-orchestrator.ts` | L654-829 重试 loop | **[同源] 主修复点** | 加累计 token 跟踪 + 预算检查短路 |

### 修复策略（方案 A，推荐）

在重试 loop 入口前初始化 `let moduleTokenBudgetExceeded = false; let cumulativeInputTokens = 0`。
每次 LLM 调用后：`cumulativeInputTokens += result.tokenUsage.input`。
若 `cumulativeInputTokens > RETRY_TOKEN_BUDGET`（默认 40,000）：设 `moduleTokenBudgetExceeded = true`，break 退出 loop，
`failedResult.reason = 'retry-budget-exceeded'` 写入 batch-summary。

常量 `RETRY_TOKEN_BUDGET` 建议 40k（p-queue 单模块合理上限 ~10k，4× 仍算充足容忍）。

### 同步更新清单

- 调用方：batch-summary 的 failedResult 结构增加 `reason?: string` 字段（已有 `retryCount`）
- 测试：`tests/unit/batch-orchestrator-retry.test.ts` 新增：mock LLM 持续失败 + 累计 token 超限 → 验证早期短路

---

## Bug 2：Reading mode 无 batch-summary（确认误报，不修复）

**代码核实**：`src/batch/batch-orchestrator.ts:1307-1309` 无模式 gate：
```typescript
const summaryLogPathAbs = path.join(metaDir, `batch-summary-${Date.now()}.md`);
fs.mkdirSync(path.dirname(summaryLogPathAbs), { recursive: true });
writeSummaryLog(summary, summaryLogPathAbs, costSummary);
```

**测试核实**：Test 1（reading mode）产出明确记录 `specs/_meta/batch-summary-1777367050847.md 已生成`。

**结论**：Bug 2 为验证报告末尾 Known Limitations 节的错误总结，与详细 Test 1 数据矛盾。**不修复**，闭合。

---

## Bug 3：跨模式断点复用（mode-unaware cache）

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | full mode 接续 reading mode 后 root 模块立即 failed（1ms）| delta-regenerator 判断"无需重生成"但实际 spec 不满足 full mode 要求 |
| Why 2 | 为何 delta-regenerator 认为不需要重生成？ | `stored.skeletonHash === currentHash`（源码未变）→ 判断为 unchanged → 跳过生成 |
| Why 3 | 为何跳过 reading-spec 后 full mode 会 failed？| reading mode 生成的 spec 跳过了 `skipEnrichment=true`（`effectiveMode !== 'full'`），缺少 full mode spec 的若干段落；full mode 读取该 reading-spec 后下游验证失败 |
| Why 4 | 为何 skeletonHash 是 mode-unaware 的？| hash 基于源文件 AST 内容（`computeSkeletonHash`），不包含 `effectiveMode`；spec frontmatter 中无存储 mode 字段 |
| Why 5 | 为何测试未捕获？| 无测试场景：同一项目先 reading 后 full 的增量流程 |

**Root Cause**（[ROOT CAUSE REACHED at Why 4]）：`SpecFrontmatter` 无 `generatedByMode` 字段，delta-regenerator 在 unchanged 判定时不区分 mode，导致 full mode 误命中 reading mode 的 spec 缓存。

**Root Cause Chain**：full mode 运行 → `skeletonHash` 匹配 reading mode 存量 spec → "unchanged" 跳过 → reading spec 缺 full mode 内容 → 下游 failed

### 影响范围

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/models/module-spec.ts` | SpecFrontmatter type | **[同源]** | 增加 `generatedByMode?: BatchMode` 字段 |
| `src/generator/frontmatter.ts` | frontmatter 渲染 | **[同源]** | 写入 `generatedByMode: effectiveMode` |
| `src/batch/delta-regenerator.ts` | unchanged 判定 | **[同源] 主修复点** | 加 mode 检查：若 `stored.generatedByMode !== effectiveMode` → cache miss |
| `src/batch/batch-orchestrator.ts` | 模块生成调用方 | **[同源]** | 确保 `effectiveMode` 传入到 frontmatter 写入链路 |

### 修复策略（方案 A，推荐）

1. `SpecFrontmatter` 新增字段 `generatedByMode?: 'full' | 'reading' | 'code-only'`
2. 写入 frontmatter 时：`generatedByMode: effectiveMode`（仅 batch 流程，generate 单文件不影响）
3. delta-regenerator unchanged 判定处增加一行：
   ```typescript
   if (stored.generatedByMode && stored.generatedByMode !== effectiveMode) {
     return { mode: 'full', reason: 'mode-changed', ... };  // cache miss
   }
   ```
4. 老 spec（无 `generatedByMode` 字段）视为 cache miss（安全兜底：不假设 mode 一致）

### 同步更新清单

- 测试：新增集成测试：reading 生成后接 full 模式，断言所有模块均进入 LLM pipeline 而非被跳过

---

## Bug 4：Query 不识别 PascalCase 代码符号

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | "How does PQueue handle concurrency?" 返回空 | 无节点 label 包含 "pqueue" |
| Why 2 | 为何 label 不含 "pqueue"？ | 图谱节点 label 是模块文件名（"index", "priority-queue"），非类名 |
| Why 3 | 为何只用文件名而非类名？ | Spectra 当前是模块文件级图谱（Feature 141 才引入 symbol 级）；query 引擎只检查 `node.label` + `sourcePath`（`graph-query.ts:L217-228`）|
| Why 4 | 为何整词 "pqueue" 匹配失败？ | "pqueue" ≠ "index"；"pqueue" 不在 "source/index.ts" 路径中 |
| Why 5 | 为何没有 token 分割？ | 查询词 `toLowerCase()` 后整体匹配，无 PascalCase 拆分逻辑 |

**Root Cause**（[ROOT CAUSE REACHED at Why 3+5]）：query 引擎不做 PascalCase tokenization，`PQueue` 整体匹配失败；而现有模块级 label（"index"/"priority-queue"）中没有 "pqueue"，但有 "queue"，拆分后能命中 "priority-queue" 节点。

**Root Cause Chain**：英文 PascalCase 查询 → 整体 lowercase → 不含子词分割 → 无法命中模块文件名中的相关子词

### 影响范围

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/panoramic/graph/graph-query.ts` | L323-332 `query()` | **[同源] 主修复点** | 加 PascalCase tokenization |

### 修复策略（方案 A，推荐）

在 `query()` 的 keyword 处理段，增加 PascalCase splitting：
```typescript
// 原来：const terms = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);
// 新：先 PascalCase 拆分，再 lower + 去短词
function tokenize(q: string): string[] {
  const normalized = q
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // "PQueue" → "P Queue"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');  // "XMLParser" → "XML Parser"
  return Array.from(new Set(
    normalized.toLowerCase().split(/[\s\-_.]+/).filter(t => t.length > 1)
  ));
}
```

查询 "How does PQueue handle concurrency?" → tokens: `["how", "does", "pqueue", "p", "queue", "handle", "concurrency"]` → "queue" 匹配 "priority-queue" 节点 → 正确返回。

---

## 修复顺序

Bug 3 → Bug 1 → Bug 4（按架构影响 + 代价排序）

## Spec 影响

无需更新现有 spec 文件。
