# Feature 107: multi-modal-extraction

## Prompt

```
/spec-driver:spec-driver-feature 107-multi-modal-extraction

Markdown 文档提取 + OpenAPI/AsyncAPI 解析 + 图像/图表理解。扩展知识图谱的数据源，从代码之外的工程制品中提取结构化知识。

## 需求概述

### 核心能力

1. **Markdown 文档提取**
   - 扫描项目中的 .md 文件（排除 specs/、node_modules/、dist/）
   - 提取内容：
     - 概念/术语定义（标题 + 首段）
     - 设计决策（ADR 格式检测 或 "Decision"/"决策" 关键词段落）
     - 命名实体（组件名、服务名、技术栈名 — LLM 辅助提取）
   - 生成图谱节点：`kind: 'document'`，带 `metadata.section`、`metadata.concepts` 字段
   - 节点间关系：文档 → 代码模块（通过文件路径引用匹配），标记 `confidence: 'INFERRED'`

2. **OpenAPI / AsyncAPI 解析**
   - 检测项目中的 `openapi.yaml`/`openapi.json`/`swagger.yaml`/`asyncapi.yaml` 文件
   - 确定性提取（纯 AST/schema 解析，无 LLM）：
     - Endpoint：path + method + operationId → 图谱节点 `kind: 'api'`
     - Schema：requestBody/response schema 定义 → 节点 `kind: 'api-schema'`
     - Event（AsyncAPI）：channel + message → 节点 `kind: 'event'`
   - 所有关系标记 `confidence: 'EXTRACTED'`（确定性提取）
   - 使用 yaml 标准库解析，不引入 openapi-parser 等重依赖

3. **图像/图表理解**
   - 扫描项目中的 .png/.jpg/.svg 图片（位于 docs/、assets/、images/ 等目录）
   - 使用 Claude Vision（通过现有 @anthropic-ai/sdk）提取：
     - 架构图中的组件和关系
     - 流程图中的步骤和流向
     - 序列图中的参与者和消息
   - 生成图谱节点：`kind: 'diagram'`，关系标记 `confidence: 'INFERRED'`
   - 降级策略：无 API key 或图片过大 → 跳过图像分析，仅处理文本制品

4. **Batch 集成**
   - `spectra batch --include-docs`：启用 Markdown 文档提取
   - `spectra batch --include-images`：启用图像/图表理解
   - 默认不启用（保持现有 batch 行为不变）
   - 提取结果合并到 graph.json（通过 Feature 101 的 `buildKnowledgeGraph()` 扩展）

5. **GraphNode.kind 扩展**
   - 现有：`'module' | 'package' | 'component' | 'spec' | 'document'`
   - 新增：`'api' | 'api-schema' | 'event' | 'diagram'`
   - 类型定义修改在 `src/panoramic/graph/graph-types.ts`

### 性能目标

| 场景 | 目标 |
|------|------|
| Markdown 提取（100 个 .md 文件） | < 30 秒（含 LLM 调用） |
| OpenAPI 解析（单文件 5,000 行） | < 2 秒（纯 AST） |
| 图像提取（单图） | < 10 秒（Vision API 调用） |
| 图像提取降级跳过 | < 100ms |

### 与现有系统的关系

- **Feature 100 cache 系统** (`src/panoramic/cache/`)
  - 文档/图片的内容哈希纳入 manifest，二次 batch 跳过未变化文件

- **Feature 101 graph.json** (`src/panoramic/graph/`)
  - `GraphNode` kind 扩展（新增 api / api-schema / event / diagram）
  - `buildKnowledgeGraph()` 需要接收新的数据源输入（文档节点、API 节点、图表节点）
  - `GraphEdge.confidence` 三级标签：EXTRACTED（OpenAPI）、INFERRED（Markdown/图像）

- **Feature 102 community-analysis** (`src/panoramic/community/`)
  - 新增节点类型参与社区检测（API endpoint 作为一等公民）

- **batch-orchestrator.ts**
  - `BatchOptions`（L55）：新增 `includeDocs?: boolean`、`includeImages?: boolean`
  - 提取步骤在现有 generator pipeline 之后、graph 构建之前执行

- **现有 LLM 调用模式**
  - `src/auth/` — API key 检测和认证代理
  - `@anthropic-ai/sdk` — Vision 调用使用 `messages.create` + image content block

### 目录结构建议

```
src/extraction/
  markdown-extractor.ts   # .md 扫描 + 概念/决策/实体提取
  openapi-extractor.ts    # OpenAPI/AsyncAPI/Swagger 确定性解析
  image-extractor.ts      # Claude Vision 图表理解
  extraction-types.ts     # ExtractedNode / ExtractionResult 类型
  index.ts                # 统一导出
src/cli/utils/
  parse-args.ts           # 扩展 --include-docs / --include-images
tests/unit/
  markdown-extractor.test.ts
  openapi-extractor.test.ts
  image-extractor.test.ts
tests/integration/
  multi-modal-batch.test.ts  # 端到端：batch --include-docs → graph.json 包含文档节点
```

### 约束

- OpenAPI 解析不引入 openapi-parser 等重依赖，使用 yaml 标准库 + 手写 schema walker
- 图像提取必须有完整降级路径：无 API key → 跳过 + 日志提示
- 图片大小限制：> 10 MB 的图片自动跳过
- `--include-docs` 和 `--include-images` 默认 false，不改变现有 batch 的默认行为
- Markdown 中 LLM 提取的实体必须标记 `confidence: 'INFERRED'`，不允许标记为 EXTRACTED
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/panoramic/graph/graph-types.ts` | GraphNode kind 扩展处 |
| `src/panoramic/graph/graph-builder.ts` | buildKnowledgeGraph() 扩展处 |
| `src/panoramic/graph/confidence-mapper.ts` | 置信度映射 |
| `src/panoramic/community/community-detector.ts` | 新节点参与社区检测 |
| `src/batch/batch-orchestrator.ts` L55 | BatchOptions 扩展处 |
| `src/auth/` | API key 检测（Vision 调用前置） |
| `src/cli/utils/parse-args.ts` | CLI 参数扩展处 |
| `src/cli/commands/graph.ts` | CLI 命令参考 |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 6（最终阶段）
- 优先级 P6，目标版本 v3.6.0
- 前置依赖：Feature 100 (content-hash-cache) ✅ + Feature 101 (graph-persistence) ✅
- 后续无依赖（里程碑收官 Feature）
- 与 Feature 103、104 **互不依赖**，可并行开发
