# Feature 177 — 技术规划（Plan）

> 配套 `spec.md`。本计划聚焦**核心架构决策**（telemetry 分区）+ 实现策略 + 与现有抽象的融合。

## 1. 架构决策（核心）

### AD-1 telemetry 双源分区（解决 EC-1 双发射）

17 工具按"是否需要富采样（responseSummary/responseSamples）"分为两组，**telemetry 发射点严格分区，互斥不重叠**：

| 组 | 工具 | telemetry 发射点 | 理由 |
|----|------|----------------|------|
| **装饰器组（11）** | graph_query/node/path/community/god_nodes/hyperedges（6）+ prepare/generate/batch/diff/panoramic-query（5） | **注册层 `withTelemetry` 包裹** | 无富采样需求，注册层统一发射最省样板 |
| **自采样组（6）** | impact/context/detect_changes（agent-context 3）+ view_file/search_in_file/list_directory（file-nav 3） | **handler 内部 `recordAndReturn`**（经 `runAgentContextTool` / `runFileNavTool` 骨架） | 需在 handler 内计算 responseSummary/responseSamples，必须在内部发射 |

**不变量**：装饰器组**不**在 handler 内调 `recordAndReturn`；自采样组**不**被 `withTelemetry` 包裹。→ 每个**到达 handler 的**调用恰 1 行（AC-3）。测试用 17-工具调用矩阵锁死（spec §8）。

> **边界（Codex CRITICAL-1，spec EC-10）**：MCP SDK 在 handler 前做 schema 校验，校验失败走 SDK 自身 createToolError（纯文本、0 telemetry），不进入我们的层。这是 SDK 框架合约，F177 不拦截（YAGNI/零依赖）。范围限定"到达 handler 的调用"。

### AD-2 `withTelemetry` 设计

位置：`src/mcp/lib/telemetry.ts`（与 `recordAndReturn` 同模块，零新依赖）。

```ts
// 不用泛型（Codex F-YAGNI）：args 用 unknown，SDK 传的 extra 形参被忽略（17 工具均不用 extra）。
export function withTelemetry(
  toolName: string,
  handler: (args: unknown) => Promise<ToolResult> | ToolResult,
): (args: unknown) => Promise<ToolResult> {
  return async (args: unknown): Promise<ToolResult> => {
    const start = Date.now();
    let reqSize = 0;
    try { reqSize = JSON.stringify(args).length; } catch { /* 循环引用兜底 */ }
    try {
      const result = await handler(args);
      return recordAndReturn(toolName, start, reqSize, result);
    } catch {
      // 顶层未预期异常 → 脱敏 internal-error（不泄漏 err.message/stack，C-4）
      return recordAndReturn(toolName, start, reqSize, buildErrorResponse('internal-error', `${toolName} 内部错误`));
    }
  };
}
```

职责：① 入口 start/reqSize；② 出口 recordAndReturn 透传（含 errorCode 提取）；③ 顶层 internal-error 安全网。
withTelemetry **不**支持 responseSummary/responseSamples（装饰器组无此需求）—— 富采样仍走 recordAndReturn 直调（自采样组）。
依赖方向：telemetry.ts 新增 value-import `buildErrorResponse`（来自 tool-response.ts），tool-response.ts 不 import telemetry → **单向，无循环**（Codex INFO 确认）。
注册处类型衔接：handler 内部仍用各自强类型 args（如 `({question, budget}) => …`），包裹时 `withTelemetry('graph_query', (a) => handler(a as GraphQueryArgs))` 或在注册闭包内直接断言。

### AD-3 graph-tools 错误分类（解决 Codex CRITICAL-1）

删除 `graph-tools.ts:140` 本地 `buildErrorResponse`。每个 handler 拆 engine 加载边界：

```ts
async (args) => {                          // 注册时外层再包 withTelemetry
  let engine: GraphQueryEngine;
  try { engine = getEngine(args.projectRoot); }
  catch { return buildErrorResponse('graph-not-built', '图谱未构建或加载失败', '运行 `spectra graph` 先生成图谱'); }
  try { const result = engine.query(...); return buildSuccessResponse-或现有成功返回; }
  catch (err) { return buildErrorResponse('graph-query-failed', err instanceof Error ? err.message : String(err)); }
}
```

- `getEngine` 失败（statSync ENOENT / loadFromFile 解析失败）→ `graph-not-built`（复用既有码）
- 查询期异常 → `graph-query-failed`（新增码）。**脱敏护栏（Codex AD-3-SANITIZE）**：getEngine 已隔离文件加载边界（其失败走 graph-not-built 固定文案，不含 err.message）。查询方法（query/getNode/findPath/getCommunity/getGodNodes/getHyperedges）操作纯内存 `rawGraph`，理论上 err.message 不含路径。**实现时实读 `src/panoramic/graph/graph-query.ts` 确认这些方法无文件 IO**：确认无 → 保留 err.message（更可诊断）；若有任何文件 IO → 改用固定脱敏文案 `'图谱查询失败'`（不拼 err.message）。
- `graph_hyperedges` 空串校验 → `invalid-input`（保留现有中文提示）
- **no-result 不动**（findPath 无路径 / 空社区 / keyword 无匹配 → engine 返回成功 payload，保持成功响应，WARNING-3）
- 成功响应**保持现状字段**（`JSON.stringify(result)` / hyperedges 的 `{hyperedges,total,filtered}` 二空格缩进等逐字不变，AC-5）

> 注：是否改用 `buildSuccessResponse` 替换成功路径的 `JSON.stringify`？**不改** —— 引入 truncatable 收缩会改变 payload（破坏 AC-5 byte 兼容）。成功路径维持原样，只动错误路径。

### AD-4 server.ts 5 工具

- prepare/generate/batch/diff：移除各自外层 try/catch，注册时包 `withTelemetry`，未预期异常由 withTelemetry → `internal-error`。
  - 注意 prepare 内层 detectedLanguages 的局部 try/catch（server.ts:62-71）**保留**（它本就吞错不外抛，与顶层无关）。
- panoramic-query：保留 handler 内显式分支——`!result.ok`（预期失败）→ `buildErrorResponse('invalid-input', result.error)` 置 isError（修隐性 bug EC-6）；其余异常由 withTelemetry → internal-error。成功路径不变。

### AD-5 `runAgentContextTool` 骨架（REFACTOR）

对标 `runFileNavTool`，但需透传富采样。草案：

```ts
// body 统一返回 { result, summary?, samples? }（Codex AD-5：避免 ToolResult 索引签名导致
// 'result' in out 误判；summary/samples 可选，仅 detect_changes 成功路径填充，impact/context 只返回 {result}）。
interface AgentContextBodyOut {
  result: ToolResult;
  summary?: Record<string, number>;
  samples?: { symbols?: string[]; files?: string[] };
}

async function runAgentContextTool(
  toolName: string,
  args: object,
  body: () => AgentContextBodyOut,
): Promise<ToolResult> {
  const start = Date.now();
  let reqSize = 0; try { reqSize = JSON.stringify(args).length; } catch { /* 兜底 */ }
  try {
    const out = body();
    return recordAndReturn(toolName, start, reqSize, out.result, out.summary, out.samples);
  } catch {
    return recordAndReturn(toolName, start, reqSize, buildErrorResponse('internal-error', `${toolName} 内部错误`));
  }
}
```

三 handler（impact/context/detect_changes）改写为薄 body：移除各自 `_telStart` / `_telReqSize` 定义（各 3 份）+ 散落的 `recordAndReturn` 调用（handleImpact 6 次）。body 内错误路径 `return { result: buildErrorResponse(...) }`，成功路径 `return { result, summary?, samples? }`。**所有现有错误码 / warning / success 字段 / context 透传（detect_changes 的 r.context）逐字保留**（behavior-preserve）。message 文案不改（含现有 projectRoot 回显，遗留-2）。
> 注：富采样仅 detect_changes 用（impact/context 现状只调普通 recordAndReturn，Codex AD-5-SAMPLE）→ summary/samples 设为可选，零 YAGNI 负担。

## 2. 与现有抽象的融合

- 复用 `lib/tool-response.ts`（buildErrorResponse/buildSuccessResponse/ToolResult/ErrorCode）+ `lib/telemetry.ts`（recordAndReturn/writeTelemetry/extractErrorCode）。零新增运行时依赖（宪法 VIII/X）。
- `withTelemetry` 与 `runFileNavTool` 是同一 telemetry 原语的两种封装形态（注册层 vs handler 骨架），共享 recordAndReturn。
- ErrorCode union 扩展沿用 F155/F171 既有增量模式（注释标注 Feature 来源）。

## 3. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 双发射（装饰器组误自采样 / 自采样组误包装饰器） | 17-工具调用矩阵测试断言每调用恰 1 行（spec §8） |
| 成功响应 byte 漂移（AC-5 破坏） | 成功路径维持原 `JSON.stringify`，不引入 buildSuccessResponse 收缩；snapshot/现有成功断言不变 |
| graph 分类误判（no-result 转 error） | 仅迁移 catch + 空串校验；no-result 保持成功（EC-9 测试） |
| 现有测试断言旧错误形态 | RED 阶段定位全部旧断言，GREEN 同步更新（mcp-server.test 4 处 + graph 错误断言） |
| internal-error 丢 err.message 影响调试 | 可接受：stderr 日志（batch console.error）保留；telemetry 记 errorCode；C-4 优先 |
| SDK 预校验失败绕过我们的层（CRITICAL-1） | 范围收窄到"到达 handler 的调用"（spec EC-10/AC-2/AC-3）；明确声明非 F177 范围，不 over-claim |
| RED 测试 import 未实现符号致编译错误（T-RED-1） | RED 针对注册 handler 可观测行为（旧 {error}/纯文本/0 telemetry），不 import withTelemetry；其单测放 GREEN |

## 4. 验证策略

- 增量验证 Level 2（动 src/mcp 核心 + 新测试）：全量 `npx vitest run` + `npm run build` + `npm run repo:check`。
- TDD：RED（测试先 fail）→ GREEN（实现）→ REFACTOR（骨架收口，测试保持绿）。
- 每个 commit 前 Codex 对抗审查（CLAUDE.local.md）。
