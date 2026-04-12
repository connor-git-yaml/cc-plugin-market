---
contract: batch-options-extension
feature: 107-multi-modal-extraction
version: 1.0.0
status: Draft
---

# 契约：`BatchOptions` 和 `CLICommand` 扩展

本契约描述 Feature 107 对 `BatchOptions`（`batch-orchestrator.ts`）、`BuildGraphOptions`（`graph-types.ts`）和 `CLICommand`（`parse-args.ts`）接口的扩展。

## `BatchOptions` 新增字段

```typescript
// src/batch/batch-orchestrator.ts
export interface BatchOptions {
  // ... 现有字段（不变）

  /** 启用 Markdown 文档 + OpenAPI/AsyncAPI 规范提取，默认 false */
  includeDocs?: boolean;

  /** 启用图像/图表 Vision 提取，默认 false */
  includeImages?: boolean;
}
```

**向后兼容承诺**：两个字段均为可选，默认值为 `false`。未传递这两个字段时，`runBatch()` 行为与 Feature 107 引入前完全一致（SC-006）。

## `BuildGraphOptions` 新增字段

```typescript
// src/panoramic/graph/graph-types.ts
export interface BuildGraphOptions {
  // ... 现有三路数据源字段（不变）

  /** 多模态提取结果（可选，缺失或为空数组时跳过提取路） */
  extractionResults?: ExtractionResult[];
}
```

**向后兼容承诺**：字段可选，缺失时 `buildKnowledgeGraph()` 跳过步骤 3.5，不影响现有三路合并结果。

## `CLICommand` 新增字段

```typescript
// src/cli/utils/parse-args.ts
export interface CLICommand {
  // ... 现有字段（不变）

  /** 启用 Markdown + API 规范提取（仅 batch 子命令）*/
  includeDocs?: boolean;

  /** 启用图像/图表 Vision 提取（仅 batch 子命令）*/
  includeImages?: boolean;
}
```

## CLI 帮助文本（--help 输出）

在 `batch` 子命令说明中新增以下两行：

```
  --include-docs     启用 Markdown 文档和 OpenAPI/AsyncAPI 规范提取，将 api/document 节点加入 graph.json
  --include-images   启用图像/图表 Vision 提取（需要 ANTHROPIC_API_KEY），将 diagram 节点加入 graph.json
```

## `GraphNode.kind` 扩展

```typescript
// src/panoramic/graph/graph-types.ts
export interface GraphNode {
  // ... 现有字段（不变）
  kind: 'module' | 'package' | 'component' | 'spec' | 'document'
      | 'api' | 'api-schema' | 'event' | 'diagram';  // Feature 107 扩展
}
```

**向后兼容承诺**：TypeScript union 扩展不破坏现有代码。现有处理 `kind` 字段的代码若有 exhaustive switch，编译器会提示新增 case（需处理），否则按默认分支处理（向后兼容）。
