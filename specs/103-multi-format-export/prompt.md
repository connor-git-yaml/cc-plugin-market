# Feature 103: multi-format-export

## Prompt

```
/spec-driver:spec-driver-feature 103-multi-format-export

Obsidian vault 导出 + HTML 交互式可视化。将知识图谱和社区分析结果导出为可直接消费的格式。

## 需求概述

### 核心能力

1. **Obsidian Vault 导出 (`spectra export --format obsidian`)**
   - `spectra export --format obsidian --output vault/`
   - 生成结构：
     - `index.md`：总览页，包含图谱统计、社区列表链接、god nodes 链接
     - 每个社区一篇 wiki：`communities/community-{id}.md`
       - 内容：cohesion 评分、核心节点 Top 3、社区内模块列表、跨社区链接
     - 每个 God Node 一篇：`god-nodes/{node-name}.md`
       - 内容：度数、连接最多的关系类型、所属社区、直接邻居列表
   - `[[双向链接]]` 串联：
     - 社区页 → god node 页、模块 spec 页
     - god node 页 → 社区页、邻居节点页
     - 从 spec frontmatter 提取 `sourceTarget` 和 `relatedFiles` 生成链接
   - Obsidian Graph View 友好：确保文件名符合 Obsidian 命名规范（无特殊字符）

2. **HTML 交互式可视化 (`spectra export --format html`)**
   - 单文件 HTML（嵌入 CSS + JS，无外部依赖）
   - 使用 d3-force 力导向布局（内联 d3 minimal bundle）
   - 视觉设计：
     - 节点按社区着色（每社区一个色相）
     - 节点大小 ∝ 度数（对数缩放避免极端差异）
     - 边透明度 ∝ confidenceScore
   - 交互功能：
     - 搜索面板：按节点名/ID 模糊搜索，高亮匹配节点
     - 节点点击：侧栏显示详情（kind、度数、邻居列表、社区 ID）
     - 社区图例：可点击过滤显示/隐藏社区
     - 缩放/拖拽
   - 大图优化：> 5,000 节点跳过物理仿真，使用预计算网格布局

3. **CLI 命令**
   - `spectra export --format <obsidian|html> [--output <dir>]`
   - 默认输出到 `_meta/export/`
   - 新建 `src/cli/commands/export.ts`

### 性能目标

| 场景 | 目标 |
|------|------|
| Obsidian vault 生成（500 节点） | < 5 秒 |
| HTML 生成（500 节点） | < 3 秒 |
| HTML 渲染（5,000 节点，浏览器） | 60fps 交互 |
| 单文件 HTML 大小 | < 2 MB（含内联 d3） |

### 与现有系统的关系

- **Feature 101 graph.json** (`src/panoramic/graph/`)
  - `GraphJSON`：NetworkX node-link 格式 — `{ nodes: GraphNode[], links: GraphEdge[] }`
  - `GraphNode`：`{ id, kind, label, metadata? }`
  - `GraphEdge`：`{ source, target, relation, confidence, confidenceScore }`

- **Feature 102 community-analysis** (`src/panoramic/community/`)
  - `CommunityInfo`：communities、nodeCommunityMap、coreNodes (Top 3)
  - `graph-report-generator.ts`：Markdown 报告生成模式可参考
  - God Node 数据来自 `god-node-analyzer.ts`

- **CLI 命令注册**
  - `src/cli/index.ts`：switch 分支 + HELP_TEXT 新增 `export` 子命令
  - 参考 `src/cli/commands/graph.ts` 的命令模式

### 目录结构建议

```
src/export/
  obsidian-exporter.ts   # Obsidian vault 生成（index + 社区页 + god node 页）
  html-exporter.ts       # 单文件 HTML 生成（d3-force 内联）
  html-template.ts       # HTML 模板字符串（CSS + JS + 占位符）
  export-types.ts        # ExportOptions / ExportResult 类型
  index.ts               # 统一导出
src/cli/commands/
  export.ts              # spectra export 命令
tests/unit/
  obsidian-exporter.test.ts
  html-exporter.test.ts
tests/integration/
  export-e2e.test.ts     # 端到端：graph.json + community → vault/html 输出
```

### 约束

- d3-force 通过内联 bundle 方式嵌入 HTML，不作为 npm 运行时依赖（仅构建时或内联字符串）
- Obsidian 文件名规范：不含 `/ \ : * ? " < > |` 字符，长度 < 200
- 双向链接格式严格使用 `[[filename]]`（不含路径前缀）
- graph.json 或 community 数据不存在时 graceful exit + 提示先运行对应命令
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/panoramic/graph/graph-types.ts` | GraphNode / GraphEdge / GraphJSON 类型 |
| `src/panoramic/graph/graph-builder.ts` | buildKnowledgeGraph() + writeKnowledgeGraph() |
| `src/panoramic/community/community-detector.ts` | CommunityInfo 返回类型 |
| `src/panoramic/community/god-node-analyzer.ts` | God Node 分析结果 |
| `src/panoramic/community/graph-report-generator.ts` | Markdown 报告生成模式参考 |
| `src/cli/commands/graph.ts` | CLI 命令注册参考 |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 3
- 优先级 P3，目标版本 v3.3.0
- 前置依赖：Feature 102 (community-analysis) ✅ 已完成
- 与 Feature 104 (pretooluse-hook) **互不依赖**，可并行开发
