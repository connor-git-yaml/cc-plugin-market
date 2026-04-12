---
feature: 107-multi-modal-extraction
created: 2026-04-12
phase: Phase 1 — 设计与契约
---

# 数据模型：107 多模态工程制品提取

本文件定义 Feature 107 引入的所有新增实体及其与现有图谱类型的关系。

---

## 核心实体图

```
ExtractionPipeline
    │── produces ──→ ExtractionResult[]
                         │
                         ├── nodes: ExtractedNode[]
                         └── edges: ExtractedEdge[]

ExtractedNode
    ├── id: string           （图谱唯一 ID，由提取器生成）
    ├── label: string        （人类可读名称）
    ├── kind: ExtractedNodeKind  （'document' | 'api' | 'api-schema' | 'event' | 'diagram'）
    ├── source_file: string  （来源文件相对路径）
    ├── confidence: ConfidenceLevel  （'EXTRACTED' | 'INFERRED'）
    └── metadata: Record<string, unknown>  （扩展字段）

ExtractedEdge
    ├── source: string       （来源节点 ID）
    ├── target: string       （目标节点 ID）
    ├── relation: string     （关系类型）
    ├── confidence: ConfidenceLevel
    └── weight: number       （默认 1.0，FR-021）
```

---

## Zod Schema 定义

### `ExtractedNodeKind`

```typescript
// 对应 GraphNode.kind 新增的四个枚举值
type ExtractedNodeKind = 'document' | 'api' | 'api-schema' | 'event' | 'diagram';
```

### `ExtractedNode`

```typescript
const ExtractedNodeSchema = z.object({
  /** 全局唯一 ID，格式由提取器定义（见下方 ID 生成规则） */
  id: z.string(),
  /** 人类可读显示标签 */
  label: z.string(),
  /** 节点类型 */
  kind: z.enum(['document', 'api', 'api-schema', 'event', 'diagram']),
  /** 来源文件的绝对路径（提取层内部），合并到图谱时转换为相对路径 */
  source_file: z.string(),
  /** 置信度标签 */
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
  /** 扩展元数据（type-safe 但不约束 key） */
  metadata: z.record(z.unknown()).optional(),
});

type ExtractedNode = z.infer<typeof ExtractedNodeSchema>;
```

### `ExtractedEdge`

```typescript
const ExtractedEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  /** 关系类型（见下方枚举） */
  relation: z.string(),
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
  /** 社区检测边权重，默认 1.0（FR-021：统一权重） */
  weight: z.number().default(1.0),
});

type ExtractedEdge = z.infer<typeof ExtractedEdgeSchema>;
```

### `ExtractionResult`

```typescript
const ExtractionResultSchema = z.object({
  nodes: z.array(ExtractedNodeSchema),
  edges: z.array(ExtractedEdgeSchema),
});

type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/** 空结果常量（Null Object 模式，降级路径统一返回此值） */
const EMPTY_EXTRACTION_RESULT: ExtractionResult = { nodes: [], edges: [] };
```

---

## 节点 ID 生成规则

| 节点类型 | ID 格式 | 示例 |
|---------|---------|------|
| `document` | `doc:{相对文件路径}` | `doc:docs/adr-001.md` |
| `api` | `api:{method}:{path}:{来源文件相对路径}` | `api:GET:/users:openapi.yaml` |
| `api-schema` | `schema:{SchemaName}:{来源文件相对路径}` | `schema:UserSchema:openapi.yaml` |
| `event` | `event:{channelName}:{来源文件相对路径}` | `event:user.created:asyncapi.yaml` |
| `diagram` | `diagram:{相对文件路径}` | `diagram:docs/architecture.png` |

**规则**：
- 所有路径使用 posix 格式（`/` 分隔符），相对于 `projectRoot`
- ID 在同一次 batch 内必须唯一；跨 batch 重建时 ID 保持稳定（内容相关 ID，非随机 ID）
- `$ref` 循环截断占位节点：`schema:{SchemaName} [ref-truncated]:{来源文件}`

---

## 关系类型枚举

| relation 值 | 来源 | 语义 | confidence |
|------------|------|------|-----------|
| `documents` | Markdown 提取 | 文档记录了某个概念 | `INFERRED` |
| `references` | Markdown 文件路径引用 | 文档引用了某个代码模块 | `INFERRED` |
| `defines` | OpenAPI/AsyncAPI | API 规范定义了某个 Schema | `EXTRACTED` |
| `uses-schema` | OpenAPI | Endpoint 使用某个 Schema | `EXTRACTED` |
| `publishes` | AsyncAPI | 服务发布某个 Event | `EXTRACTED` |
| `subscribes` | AsyncAPI | 服务订阅某个 Event | `EXTRACTED` |
| `depicts` | 图像提取 | 图表描述了某个概念（Vision 推理） | `INFERRED` |

---

## 与现有 GraphNode 的关系

`ExtractedNode` 经过 `buildKnowledgeGraph()` 步骤 3.5 的合并后，转化为标准 `GraphNode`。映射规则：

```
ExtractedNode.id         → GraphNode.id
ExtractedNode.kind       → GraphNode.kind    （直接赋值，因 kind 已扩展）
ExtractedNode.label      → GraphNode.label
ExtractedNode.metadata   → GraphNode.metadata（合并 sourceTag: 'extraction'）
```

`ExtractedEdge` 转化为 `GraphEdge`，`weight` 字段存入 `GraphEdge.metadata.weight`（现有 `GraphEdge` 接口无 `weight` 字段，通过 metadata 传递，保持接口稳定）。

---

## `BuildGraphOptions` 扩展

```typescript
// src/panoramic/graph/graph-types.ts 新增字段
export interface BuildGraphOptions {
  // 现有三路数据源（不变）
  architectureIR?: any;
  docGraph?: any;
  crossReferenceLinks?: any[];
  directed?: boolean;
  // Feature 107 新增
  /** 多模态提取结果（可选，缺失或为空时跳过，不影响现有三路合并逻辑）*/
  extractionResults?: ExtractionResult[];
}
```

---

## `BatchOptions` 扩展

```typescript
// src/batch/batch-orchestrator.ts BatchOptions 接口新增字段
export interface BatchOptions {
  // 现有字段（不变）
  // ...
  // Feature 107 新增
  /** 启用 Markdown 文档 + API 规范提取，默认 false */
  includeDocs?: boolean;
  /** 启用图像/图表 Vision 提取，默认 false */
  includeImages?: boolean;
}
```

---

## 文件级缓存记录格式

缓存文件存储在 `{outputDir}/_meta/extraction-cache/{sha256-hash}.json`：

```typescript
interface ExtractionCacheEntry {
  /** 文件绝对路径（用于 debug，不用于 cache lookup） */
  filePath: string;
  /** 缓存写入时间（ISO 8601） */
  cachedAt: string;
  /** 提取结果 */
  result: ExtractionResult;
}
```
