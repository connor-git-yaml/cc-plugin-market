# Feature 177 — 任务分解（Tasks）

> TDD 顺序（M7 强制）：RED → GREEN → REFACTOR。每个 commit 前 Codex 对抗审查。

## RED 阶段 — `test(177)` 契约统一 + telemetry 覆盖 scaffolding（先 fail）

> **RED 构造原则（Codex T-RED-1）**：RED 断言**注册 handler 的可观测行为**（经 createMcpServer 拿到的注册 handler 直接调用），**不 import 尚未实现的 withTelemetry/runAgentContextTool 符号**，避免编译错误遮蔽断言。withTelemetry / runAgentContextTool 的**单元**测试随 GREEN/REFACTOR commit 落地。
> **范围（spec EC-10）**：所有 RED 断言针对"入参通过 schema 校验、到达 handler 的调用"；不覆盖 SDK 预校验失败路径。

- **T-001** 新增 `tests/unit/mcp/response-contract.test.ts`：经注册 handler 断言 17/17 工具错误响应含统一 `code` 字段（无 `{error}` / 纯文本残留）。RED 时 graph 返回 `{error}`、server 返回纯文本 → 断言失败（真 RED，无编译错误）。
  - 覆盖：graph 6 错误路径（缺图→graph-not-built、查询失败→graph-query-failed、空串→invalid-input）；server 5（catch→internal-error；panoramic !result.ok→invalid-input）。
- **T-002** 扩展 `tests/unit/mcp/telemetry.test.ts`（telemetry 覆盖矩阵，针对注册 handler）：
  - 17-工具调用矩阵（spec §8）：固化 17 名单常量；用 fake server（参照 `graph-community-projectroot.test.ts`）捕获 `createMcpServer` 注册的 handler；设 `SPECTRA_MCP_TELEMETRY_PATH` 临时文件；逐个调用断言 JSONL 行数 == 调用数 + toolName 全覆盖 + 无双发射。RED 时 11 工具产 0 行 → 断言失败。
  - 注册数 ≠ 17 → 失败（防漂移）。
  - withTelemetry 单测（包裹后成功/错误各 1 行、顶层异常→internal-error）随 T-004 GREEN 落地（届时符号已存在）。

## GREEN 阶段 — `refactor(177)` 统一响应契约 + withTelemetry

- **T-003** `src/mcp/lib/tool-response.ts`：ErrorCode union 新增 `'graph-query-failed'`（注释标 Feature 177）。
- **T-004** `src/mcp/lib/telemetry.ts`：新增 `withTelemetry(toolName, handler)`（AD-2）。import buildErrorResponse。
- **T-005** `src/mcp/graph-tools.ts`：
  - 删除本地 `buildErrorResponse`（:140）。
  - 6 handler 拆 engine 加载边界（AD-3）：getEngine 失败→graph-not-built，查询异常→graph-query-failed，空串→invalid-input。成功路径 byte 不变。
  - 注册时 6 工具包 `withTelemetry`。
- **T-006** `src/mcp/server.ts`：
  - prepare/generate/batch/diff：移除外层 try/catch，包 `withTelemetry`（prepare 内层 detectedLanguages try/catch 保留）。
  - panoramic-query：`!result.ok`→`buildErrorResponse('invalid-input', result.error)` 置 isError；包 withTelemetry。
  - import buildErrorResponse + withTelemetry。
- **T-007** 更新现有测试到 `{code}`：
  - `tests/unit/mcp-server.test.ts` 4 处 `toContain('X 失败')` → 断言 `code:'internal-error'` + isError。
  - 扫描并更新任何断言 graph `{error}` 旧形态的测试（RED 阶段已定位）。
  - 确认 `graph-mcp-snapshot.test.ts` 不受影响（不经 handler，spec §7）。

## REFACTOR 阶段 — `refactor(177)` 收口 runAgentContextTool 骨架

- **T-008** `src/mcp/agent-context-tools.ts`：新增 `runAgentContextTool`（AD-5，支持 summary/samples 透传）。
- **T-009** 三 handler（impact/context/detect_changes）改写为薄 body：移除 `_telStart`/`_telReqSize`（各 3→0）+ 散落 recordAndReturn（handleImpact 6→0），错误经 body return buildErrorResponse。behavior-preserve（错误码/warning/success 字段/context 透传/message 文案全保留）。
- **T-010** 验证 `agent-context-tools.test.ts` / `agent-context-tools-snapshots.test.ts` 全绿（behavior 零变更）。

## 验证阶段

- **T-011** 全量 `npx vitest run` 零失败 + `npm run build` 零类型错误 + `npm run repo:check` pass。
- **T-012** 验收核对：AC-1（17/17 code）/ AC-2（telemetry 17/17）/ AC-3（恰 1 行）/ AC-5（成功 byte 兼容）/ AC-6（样板消除量化）。

## 依赖关系

```
T-001,T-002 (RED, 先 fail)
   ↓
T-003 → T-004 → {T-005, T-006} → T-007  (GREEN, 让 RED 转绿)
   ↓
T-008 → T-009 → T-010  (REFACTOR, 保持绿)
   ↓
T-011 → T-012  (验证)
```

## 测试矩阵（防假绿，Codex WARNING-2）

| 工具组 | 错误路径测试 | telemetry 测试 |
|--------|------------|---------------|
| graph 6 | 缺图/查询失败/空串 各 1 | 调用矩阵覆盖 |
| server 5 | catch→internal-error / panoramic !ok→invalid-input | 调用矩阵覆盖 |
| agent-context 3 | 现有用例（behavior-preserve） | 现有 + 矩阵 |
| file-nav 3 | 现有用例 | 现有 + 矩阵 |
| 全 17 | — | 行数==调用数 + 名单全覆盖 + 无双发射 |
