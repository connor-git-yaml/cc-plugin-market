# F170c 快速上手指南

**Feature**：F170c — Spectra MCP Tool Description + Response 优化

---

## 实现者快速导航

### 需要修改的文件

1. `src/mcp/agent-context-tools.ts`
   - **T1**（cleanup 先做）：提取 `handleDetectChanges` 中的 BFS 循环逻辑为私有函数
   - **T3**：修改第 935 / 941 / 947 行（`registerAgentContextTools` 中 3 个 `server.tool` 调用的第二个字符串参数）
   - **T4**：在每个 handler 的主流程成功后，新增 inner try-catch 包裹 enrichment 调用

2. `src/mcp/lib/response-helpers.ts`（新增）
   - 4 个纯函数：`buildTopImpactedRanking` / `generateNextStepHint` / `assessRiskTier` / `buildTopRelevantCallers`
   - 3 个类型导出：`TopImpacted` / `TopRelevantCaller` / enrichment interface

### Description 升级位置

```
// agent-context-tools.ts 第 932-953 行 registerAgentContextTools
server.tool(
  'impact',
  '<-- 这里替换为新的 100-500（implement 阶段从 100-300 放宽） 字符 description -->',
  ImpactInputSchema,
  ...
);
```

description 文本需满足 4 要素：核心功能 lead-in（≥10 字符）+ "Use this tool when"（≥3 场景）+ "Example"（含 input/output）+ "Typical chained usage"（`impact` 必含 `detect_changes → impact → context` 链路）

### Enrichment 集成位置

在每个 handler 中，`buildSuccessResponse(data, ...)` 调用之前（内层 try-catch 包裹）：

```typescript
// 示例：handleImpact 的 enrichment 集成点
// 原有代码：
return recordAndReturn('impact', _telStart, _telReqSize, buildSuccessResponse(data, ['affected']));

// 修改为：
let topImpacted: TopImpacted[] = [];
let nextStepHint = '';
let enrichmentDegraded = false;
try {
  topImpacted = buildTopImpactedRanking(r.affected, 5);
  nextStepHint = generateNextStepHint('impact', { topImpacted, affected: r.affected }, 'success');
} catch (e) {
  enrichmentDegraded = true;
  process.stderr.write(`[F170c] impact enrichment degraded: ${String(e)}\n`);
}
Object.assign(data, { topImpacted, nextStepHint, ...(enrichmentDegraded ? { _enrichmentDegraded: true as const } : {}) });
return recordAndReturn('impact', _telStart, _telReqSize, buildSuccessResponse(data, ['affected']));
```

---

## 验证命令

```bash
# 单文件单测
npx vitest run tests/unit/mcp/agent-context-tools.test.ts

# helper 单测（含性能基准）
npx vitest run tests/unit/mcp/lib/response-helpers.test.ts

# description 静态断言
npx vitest run tests/e2e/feature-170c-description.e2e.test.ts

# 全量
npx vitest run && npm run build && npm run repo:check && npm run release:check
```

---

## SC-002 / SC-004 执行（T7 阶段）

SC-002 和 SC-004 需要在 **host shell**（非 worktree）中执行，因为需要 Claude Max OAuth。

执行前确认：
```bash
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text
# 应输出 ok
```

driver E2E 脚本位置：`tests/e2e/feature-170c-driver.e2e.test.ts`（由 T6 创建）
