# Feature 101: graph-persistence

## Prompt

```
/spec-driver:spec-driver-feature 101-graph-persistence

置信度标签 + 统一图持久化 _meta/graph.json。目标是将 architecture-ir、doc-graph、cross-reference-index 三个分散数据源合并为单一可消费的知识图谱文件。

## 需求概述

### 核心能力

1. **置信度标签系统**
   - 为所有 relationship 新增 `confidence` 和 `confidenceScore` 字段
   - 三级置信度：
     - `EXTRACTED`（AST 直接提取的 import/call/contains）— confidenceScore: 0.9-1.0
     - `INFERRED`（LLM 推理的 semantic 关系）— confidenceScore: 0.5-0.8
     - `AMBIGUOUS`（弱信号、间接引用）— confidenceScore: 0.1-0.4
   - 修改 `ArchitectureIRRelationship` 类型定义新增这两个字段（可选，向后兼容）
   - 现有 `DocGraphReference` 中已有 confidence（高/中/低），需映射到新的三级标签

2. **统一图构建器 (graph-builder.ts)**
   - 新增 `src/panoramic/graph/graph-builder.ts`
   - 合并三个数据源：
     - architecture-ir elements → 图节点（kind: module/package/component）
     - doc-graph nodes → 图节点（kind: spec/document）
     - cross-reference edges + architecture-ir relationships → 图边（带 confidence）
   - 输出格式：NetworkX node-link 兼容 JSON（`{ nodes: [...], links: [...] }`）
   - 节点去重策略：同一 filePath 的节点合并，保留最丰富的元数据

3. **graph.json 持久化**
   - 输出路径：`_meta/graph.json`
   - 原子写入（复用 `src/panoramic/cache/` 的 atomicWrite 模式）
   - batch 完成后自动生成（在 batch-orchestrator.ts 的 post-processing 钩子中注入）
   - `spectra graph` CLI 命令：可独立调用图构建（不跑完整 batch）
     - `spectra graph --directed`：输出有向图（默认无向）

4. **CLI 命令**
   - `spectra graph [--directed]`：构建并输出 graph.json
   - 注册方式：在 `src/cli/index.ts` switch 分支 + HELP_TEXT 新增 `graph` 子命令
   - 新建 `src/cli/commands/graph.ts`

### 性能目标

| 场景 | 目标 |
|------|------|
| 5,000 节点 / 10,000 边图构建 | < 10 秒 |
| graph.json 文件大小 | < 5 MB（5,000 节点规模） |
| graph 命令冷启动 | < 3 秒（中型项目 ~200 模块） |

### 与现有系统的关系

- **Architecture IR** (`src/panoramic/models/architecture-ir-model.ts`)
  - `ArchitectureIRElement` / `ArchitectureIRRelationship` — 当前 relationship 无 confidence 字段
  - 关系类型：`contains | depends-on | deploys | uses-image | groups`
  - 需新增 `confidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'` 和 `confidenceScore?: number`

- **Doc Graph Builder** (`src/panoramic/builders/doc-graph-builder.ts`)
  - `DocGraph` / `DocGraphSpecNode` / `DocGraphReference` 类型
  - `DocGraphReference` 已有 confidence（高/中/低字符串），需映射
  - `scanStoredModuleSpecs()` 扫描既有 spec 文件

- **Cross Reference Index** (`src/panoramic/cross-reference-index.ts`)
  - `buildCrossReferenceIndex()` — 产出模块间交叉引用边

- **batch-orchestrator.ts Post-processing**
  - L647-696：batch 完成后的 post-processing 链
  - 图构建应在 docs-bundle 之后、quality report 之前注入

- **Feature 100 cache 系统** (`src/panoramic/cache/`)
  - atomicWrite 模式可复用
  - manifest 可用于缓存 graph.json 的输入 hash

### 目录结构建议

```
src/panoramic/graph/
  graph-builder.ts      # 统一图构建器（合并 3 个数据源）
  graph-types.ts        # GraphNode / GraphEdge / GraphJSON 类型定义
  confidence-mapper.ts  # 置信度映射（各数据源 → 统一三级标签）
  index.ts              # 统一导出
src/cli/commands/
  graph.ts              # spectra graph [--directed] 命令
tests/unit/
  confidence-mapper.test.ts
  graph-builder.test.ts
tests/panoramic/
  graph-persistence.test.ts   # 端到端：batch → graph.json 生成
```

### 约束

- 纯 Node.js 标准库，不引入 graphology 等图库（留给 Feature 102 社区检测）
- graph.json 格式必须兼容 Python NetworkX `json_graph.node_link_graph()` 加载
- `ArchitectureIRRelationship` 的 confidence 字段必须可选（向后兼容，旧数据无此字段时默认 undefined）
- 图构建器必须容错：某个数据源不存在时（如 cross-reference-index 未运行）graceful skip 并在 graph.json 元数据中标注
- `.gitignore` 中 `_meta/` 已被忽略
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释

### NetworkX 兼容格式参考

```json
{
  "directed": false,
  "multigraph": false,
  "graph": {
    "name": "spectra-knowledge-graph",
    "generatedAt": "2026-04-12T00:00:00Z",
    "nodeCount": 5000,
    "edgeCount": 10000
  },
  "nodes": [
    { "id": "src/cli/index.ts", "kind": "module", "label": "CLI Entry", "metadata": {} }
  ],
  "links": [
    { "source": "src/cli/index.ts", "target": "src/mcp/server.ts", "relation": "depends-on", "confidence": "EXTRACTED", "confidenceScore": 0.95 }
  ]
}
```
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/panoramic/models/architecture-ir-model.ts` | Architecture IR 元素与关系类型定义 |
| `src/panoramic/builders/doc-graph-builder.ts` | 文档图构建，`DocGraph` / `DocGraphSpecNode` |
| `src/panoramic/cross-reference-index.ts` | 模块间交叉引用索引 |
| `src/batch/batch-orchestrator.ts` L647-696 | Post-processing 钩子链 |
| `src/panoramic/cache/` | Feature 100 缓存系统（atomicWrite 可复用） |
| `src/cli/index.ts` | CLI 入口，子命令 switch 分支 |
| `src/cli/commands/cache.ts` | Feature 100 新增的 CLI 命令（可参考模式） |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 2
- 优先级 P2，目标版本 v3.2.0
- 前置依赖：Feature 099 ✅ 已完成
- **后续依赖本 Feature 的有 3 个**：102 (community-analysis)、105 (mcp-graph-query)、107 (multi-modal-extraction)——本 Feature 是 Phase 2 的门控
