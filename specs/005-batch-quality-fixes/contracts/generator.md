# API 契约更新：生成器模块

**Feature**: 005-batch-quality-fixes
**更新对象**: `specs/001-reverse-spec-v2/contracts/generator.md`
**涉及文件**: `src/generator/mermaid-dependency-graph.ts`（新增）

---

## 新增：mermaid-dependency-graph

**文件**：`src/generator/mermaid-dependency-graph.ts`（新增）

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
