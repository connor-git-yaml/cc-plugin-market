# MCP batch tool schema 变更契约 — F175

**变更类型**: 向后兼容扩展（新增可选参数 + 语义默认值变更）  
**影响入口**: `src/mcp/server.ts` — `batch` tool 定义

---

## 变更前（当前）

```typescript
{
  projectRoot: z.string().optional(),
  force: z.boolean().optional(),       // 强制重新生成所有 spec
  incremental: z.boolean().optional(), // 仅重生成受影响 spec（默认 false）
  languages: z.array(z.string()).optional(),
  mode: z.enum(['full', 'reading', 'code-only']).optional(),
}
```

**行为**：`incremental` 未传时默认 `false` → 走"仅看文件存在性"路径。

---

## 变更后（F175）

```typescript
{
  projectRoot: z.string().optional(),
  force: z.boolean().optional(),       // 强制全量（--force 别名，向后兼容）
  full: z.boolean().optional(),        // 新增：显式全量逃生口（regen 轴）
  incremental: z.boolean().optional(), // 语义不变，但默认值翻转
  languages: z.array(z.string()).optional(),
  mode: z.enum(['full', 'reading', 'code-only']).optional(),
}
```

**行为变更**：`incremental` 未传时默认 `true` → 走 DeltaRegenerator 增量路径。

---

## 向后兼容声明

| 调用方行为 | 翻转前结果 | 翻转后结果 | 破坏性？ |
|-----------|-----------|-----------|---------|
| 不传 `incremental`（最常见） | 全量（仅看文件存在） | 增量（DeltaRegenerator） | 是（有意变更，Feature 核心价值）|
| 传 `incremental: true` | 增量 | 增量（不变） | 否 |
| 传 `incremental: false` | 全量 | 全量（不变） | 否 |
| 传 `force: true` | 全量 | 全量（不变，force 合并到 full） | 否 |
| 传 `full: true`（新） | N/A | 全量 | 否（新增）|

**SWE-Bench cohort 3 等评测**（OQ-2 决议）：须显式传 `full: true` 或 `force: true` 以获得全量基线，不依赖默认值。

---

## 参数描述更新

```typescript
force: z.boolean().optional()
  .describe('强制全量重生成所有 spec（regen 轴，向后兼容别名，等同 full=true）'),
full: z.boolean().optional()
  .describe('显式全量重生成（regen 轴，绕过增量 cache）。注：与 mode 参数正交，可同时指定。'),
incremental: z.boolean().optional()
  .describe('增量模式（默认 true）：仅重生成受影响的 spec。传 false 可 opt-out 增量。'),
mode: z.enum(['full', 'reading', 'code-only']).optional()
  .describe('文档质量维度：full（默认，完整文档）| reading（轻量）| code-only（纯 AST）。注：与 full 参数（regen 轴）正交。'),
```
