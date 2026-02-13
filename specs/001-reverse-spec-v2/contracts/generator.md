# API 契约：生成器模块

**模块**：`src/generator/`
**覆盖**：FR-006、FR-007、FR-008、FR-009

---

## spec-renderer

**文件**：`src/generator/spec-renderer.ts`

### `renderSpec(moduleSpec: ModuleSpec): string`

使用 Handlebars 模板将 ModuleSpec 渲染为最终的 Markdown。

**参数**：
- `moduleSpec` — 完整的 ModuleSpec 数据（参见 [data-model.md](../data-model.md#3-modulespec)）

**返回**：包含 YAML frontmatter + 9 个章节 + Mermaid 图表的完整 Markdown 字符串

**模板**：`templates/module-spec.hbs`

**保证**：

- 9 个章节按序全部存在（FR-006）
- YAML frontmatter 包含所有必填字段，包括 `skeletonHash`（FR-009）
- Mermaid 图表以围栏代码块形式嵌入（FR-007）
- 保留不确定性标记：`[推断]`、`[不明确]`、`[SYNTAX ERROR]`（FR-008）
- 散文使用中文，代码标识符使用英文（Constitution VI）
- **基线骨架被序列化**为规格末尾的 HTML 注释块：`<!-- baseline-skeleton: {JSON} -->`。这使得无需反向解析 Markdown 即可实现无损漂移检测。JSON 是通过 `JSON.stringify()` 序列化的完整 `CodeSkeleton`。对 Markdown 渲染器不可见。

---

### `initRenderer(): void`

一次性初始化：编译模板、注册辅助函数、注册局部模板。

必须在首次调用 `renderSpec()` 之前执行。

---

## frontmatter

**文件**：`src/generator/frontmatter.ts`

### `generateFrontmatter(data: FrontmatterInput): SpecFrontmatter`

生成 YAML frontmatter 数据，支持自动版本递增。

**参数**：
```typescript
interface FrontmatterInput {
  sourceTarget: string;
  relatedFiles: string[];
  confidence: 'high' | 'medium' | 'low';
  skeletonHash: string;       // baseline CodeSkeleton 的 SHA-256 哈希
  existingVersion?: string;   // e.g., 'v3' — will produce 'v4'
}
```

**返回**：`SpecFrontmatter`，包含：
- `version`：新规格为 `v1`，或在 `existingVersion` 基础上递增
- `generatedBy`：`'reverse-spec v2.0'`
- `lastUpdated`：当前 ISO 8601 时间戳
- `type`：`'module-spec'`

---

## mermaid-class-diagram

**文件**：`src/generator/mermaid-class-diagram.ts`

### `generateClassDiagram(skeleton: CodeSkeleton): string`

从 CodeSkeleton 生成 Mermaid classDiagram 源代码。

**返回**：有效的 Mermaid `classDiagram` 源代码

**规则**：
- 类仅显示公共方法和属性
- 继承（`--|>`）和组合（`*--`）关系来自 AST
- 接口以 `<<interface>>` 构造型渲染

---

## mermaid-dependency-graph

**文件**：`src/generator/mermaid-dependency-graph.ts`

### `generateDependencyDiagram(skeleton: CodeSkeleton, skeletons?: CodeSkeleton[]): string | null`

从 CodeSkeleton 的 `imports` 数据生成 Mermaid 依赖关系图。

**参数**：

- `skeleton` — 合并后的 CodeSkeleton（包含所有文件的 imports）
- `skeletons` — 可选，原始各文件的 CodeSkeleton（用于展示文件间关系）

**返回**：

- Mermaid `graph LR` 源码字符串
- `null`（无依赖时）

**行为**：

1. 遍历 `skeleton.imports`，将依赖分为内部（`isRelative: true`）和外部
2. 去重（同一模块只出现一次）
3. 排除 type-only 外部依赖
4. 限制显示数量：内部最多 15 个，外部最多 10 个（超出部分用"...其他 N 个"占位）
5. 内部依赖用实线箭头（`-->`），外部依赖用虚线箭头（`-.->`）加包标记
6. 为当前模块节点添加高亮样式

**输出示例**：

```text
graph LR
  M["auth"]
  M --> core_llm_client["core/llm-client"]
  M --> cli_proxy["cli-proxy"]
  M -.-> node_child_process["📦 node:child_process"]
  M -.-> node_fs["📦 node:fs"]
  style M fill:#f9f,stroke:#333,stroke-width:2px
```

**约束**：

- 节点 ID 通过 `sanitizeId()` 过滤非法字符（仅保留 `[a-zA-Z0-9_]`）
- 模块名通过 `extractModuleName()` 从 import 路径提取（移除 `./` 前缀和文件扩展名）
- 输出必须可被 Mermaid 渲染器解析

---

## index-generator

**文件**：`src/generator/index-generator.ts`

### `generateIndex(specs: ModuleSpec[], graph: DependencyGraph): ArchitectureIndex`

生成项目级架构索引。

**参数**：
- `specs` — 所有已生成的 ModuleSpec 对象
- `graph` — 项目 DependencyGraph

**返回**：`ArchitectureIndex`（参见 [data-model.md](../data-model.md#4-architectureindex)）

**模板**：`templates/index-spec.hbs`

**保证**：
- 模块映射包含所有规格及其链接（FR-013）
- 依赖图表为完整的项目 Mermaid 图
- 横切关注点通过共享依赖识别
