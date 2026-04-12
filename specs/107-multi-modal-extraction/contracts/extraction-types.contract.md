---
contract: extraction-types
feature: 107-multi-modal-extraction
version: 1.0.0
status: Draft
---

# 契约：`src/extraction/extraction-types.ts`

本契约定义 `extraction-types.ts` 文件的公开接口。下游代码（`extraction-pipeline.ts`、`graph-builder.ts`、测试文件）依赖此契约。

## 导出列表

```typescript
// Zod schema（用于运行时验证）
export const ExtractedNodeSchema: z.ZodObject<...>;
export const ExtractedEdgeSchema: z.ZodObject<...>;
export const ExtractionResultSchema: z.ZodObject<...>;

// TypeScript 类型（从 Zod 推断）
export type ExtractedNodeKind = 'document' | 'api' | 'api-schema' | 'event' | 'diagram';
export type ExtractedNode = z.infer<typeof ExtractedNodeSchema>;
export type ExtractedEdge = z.infer<typeof ExtractedEdgeSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// 常量
export const EMPTY_EXTRACTION_RESULT: ExtractionResult;  // { nodes: [], edges: [] }

// 枚举
export type ArtifactKind = 'document' | 'api-spec' | 'image';
```

## 不变量

- `EMPTY_EXTRACTION_RESULT` 是冻结对象（`Object.freeze`），调用方不得修改
- `ExtractionResultSchema.parse()` 失败时抛出 `ZodError`，调用方负责 catch 并丢弃
- `ExtractedNode.id` 在同一 `ExtractionResult` 内必须唯一（提取器层面保证）

## 向后兼容承诺

- `ExtractedNodeKind` 只扩展，不删除枚举值
- Zod schema 只增加 `.optional()` 字段，不删除现有必填字段
