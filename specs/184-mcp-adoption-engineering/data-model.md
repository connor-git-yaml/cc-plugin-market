# Data Model: F184 响应 schema 变更

## 变更范围

F184 不引入新的数据实体或存储模型。所有变更为现有 MCP 响应 envelope 的**向后兼容扩展**。

---

## view_file 响应 schema 变更

### 成功响应（新增可选 warnings 值）

现有成功 envelope（`buildSuccessResponse` 输出）：

```typescript
{
  content: [{ type: 'text', text: JSON.stringify({
    path: string,
    lines: string,
    startLine: number,
    endLine: number,
    totalLines: number,
    truncated: boolean,
    // 现有可选字段（symbolId-overrides-lines 已有）：
    warnings?: string[],
    nextStepHint: string,
  })}]
}
```

F184 新增 warnings 值（仅在 fuzzy resolve 触发时写入）：

```typescript
warnings?: ['fuzzy-resolved']       // fuzzy 自动 resolve 成功
// 两者同存时（实现实际顺序，因 resolveSymbolRange 内 fuzzy 先发生、lines-override 后判定）：
warnings?: ['fuzzy-resolved', 'symbolId-overrides-lines']
```

**⚠️ warnings 顺序非合同（Codex Plan W-005）**：`warnings` 是无序集合语义。实现实际 push 顺序为 `fuzzy-resolved` 在前（在 `resolveSymbolRange` 解析阶段产生）、`symbolId-overrides-lines` 在后（`handleViewFile` 判定行区间覆盖时产生）。**测试一律用 `toContain` / `arrayContaining` 断言成员，禁止用 `toEqual` 断言数组精确相等**，客户端不得依赖顺序。

**向后兼容保证**：`warnings` 字段在现有 view_file 成功路径（symbolId-overrides-lines）中已存在，不感知新 warning 值的客户端忽略它即可。

### 错误响应（新增 context.fuzzyMatches 路径）

现有错误 envelope（`buildErrorResponse` 输出，`symbol-not-found` 场景）：

```typescript
{
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({
    code: 'symbol-not-found',
    message: string,
    hint?: string,
    // context 扩展点已存在于 F174（agent-context 工具）：
    context?: Record<string, unknown>,
  })}]
}
```

F184 在 fuzzy 解析失败（无高置信唯一命中）时，`context.fuzzyMatches` 填充候选列表：

```typescript
context: {
  fuzzyMatches: Array<{
    id: string,          // 候选 symbolId
    confidence: number,  // 置信度（0.0-1.0）
    matchKind: 'exact' | 'path-suffix' | 'partial-name' | 'levenshtein',  // 命中层次（SymbolCandidate 既有字段）
  }>  // 最多 top-3，按 confidence 降序
}
```

**⚠️ 必含 matchKind（Codex Plan W-003）**：`fuzzyMatches` 元素是完整的 `SymbolCandidate`（`query-helpers.ts:224`），**含 `matchKind`**。现有 `feature-180-symbol-chain.e2e.test.ts:221` 已断言 `{ id, confidence, matchKind }` 三字段——view_file 必须复用同一形状，不得裁成 `{ id, confidence }`，否则与 F174 既有契约漂移。

**向后兼容保证**：错误响应的 `context` 字段是既有的扩展点（F174 agent-context 工具已使用相同结构），`context.fuzzyMatches` 只新增于已有扩展点内，不新增顶层字段。

**与 F174 的一致性**：`fuzzyMatches` 结构与 `agent-context-tools.ts:183` 的现有实现完全一致（直接 `fuzzy.candidates.slice(0, 3)`，保留 `matchKind`），实现 17 工具 symbol 入参语义单一化。

---

## resolveSymbolRange 内部返回类型变更

`resolveSymbolRange` 是内部函数（`file-nav-tools.ts`），不暴露给外部 API。F184 扩展其返回类型：

```typescript
// 当前：
| { ok: true; file: string | null; start?: number; end?: number }
| { ok: false; result: ToolResult }

// F184 后：
| { ok: true; file: string | null; start?: number; end?: number; fuzzyResolved?: boolean }
| { ok: false; result: ToolResult }
```

`fuzzyResolved: true` 仅在 fuzzy autoResolved 成功时为 true，精确 resolve 路径此字段为 undefined（等同 false）。

---

## MCP Server 初始化 schema 变更

`McpServer` 构造函数第二参数新增 `instructions` 字段。此字段由 MCP SDK 透传到 `initialize` 结果中，**不出现在任何工具响应中**。

```typescript
// SDK ServerOptions（已有 interface，F184 使用已有字段）：
interface ServerOptions {
  instructions?: string;
  // ...其他字段
}
```

此变更不影响任何工具的响应 schema。
