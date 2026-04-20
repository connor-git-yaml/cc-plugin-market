---
name: spectra
description: |
  Use this skill when the user asks to:
  - Generate a spec/specification from existing code
  - Document or analyze a module's architecture
  - Reverse engineer what a piece of code does
  - Create .spec.md documentation for a file, directory, or module
  - Understand the intent, interfaces, and business logic of existing code
  Supports single files (e.g., src/auth/login.ts), directories (e.g., src/auth/), or entire modules.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

通过 AST 静态分析 + LLM 混合三阶段流水线，将源代码逆向工程为结构化的 9 段式中文 Spec 文档。TypeScript/JavaScript 项目享有 AST 增强的精确分析，接口定义 100% 来自 AST 提取。

## Execution Flow

### 1. Parse Target

Interpret `$ARGUMENTS` to determine the analysis target:

- **Single file**: e.g., `src/auth/login.ts`
- **Directory**: e.g., `src/auth/` — analyze all TS/JS source files recursively
- **`--deep` flag**: Include function bodies in LLM context for deeper analysis
- **No argument**: Ask user to specify a target path

If the target doesn't exist, ERROR with suggestions based on project structure.

### 2. Run Pipeline

Execute the analysis pipeline using the globally installed `spectra` CLI:

```bash
spectra generate $TARGET_PATH --deep
```

如果需要自定义输出目录：

```bash
spectra generate $TARGET_PATH --deep --output-dir specs
```

**Pipeline stages**:
1. **预处理**: 扫描 TS/JS 文件 → ts-morph AST 分析 → CodeSkeleton 提取 → 敏感信息脱敏
2. **上下文组装**: 骨架 + 依赖 spec + 代码片段 → ≤100k token 预算的 LLM prompt
3. **生成增强**: Claude API 生成 9 段式中文 Spec → 解析验证 → Handlebars 渲染 → 写入 `specs/*.spec.md`

### 3. Handle Results

If pipeline succeeds, report:

```
Spec 生成完成: specs/<name>.spec.md

分析摘要:
- 文件数: N
- 总行数: N LOC
- 导出 API: N 个
- Token 消耗: N
- 置信度: high|medium|low
- 警告: <warnings list>

后续步骤:
- 审查生成的 Spec 文档
- 使用 /spectra-batch 批量生成全项目 Spec
- 使用 /spectra-diff 检测 Spec 漂移
```

If pipeline fails, fall back to manual analysis following the sections below.

### 4. Fallback: Manual Analysis

If the CLI pipeline is unavailable, perform manual analysis:

1. **Scan & inventory** all source files in scope
2. **Read and analyze** each file's exports, imports, types, and logic
3. **Generate spec** following the 9-section structure defined below
4. **Write** to `specs/<target-name>.spec.md`

### 5. 9-Section Spec Structure

Each generated spec must contain these 9 sections in Chinese:

1. **意图** — 模块目的和存在理由
2. **接口定义** — 所有导出 API（签名必须精确，不可捏造）
3. **业务逻辑** — 核心算法、决策树、工作流
4. **数据结构** — 类型定义、接口、Schema
5. **约束条件** — 性能、安全、平台约束
6. **边界条件** — 错误处理、边界条件、降级策略
7. **技术债务** — TODO/FIXME、缺失测试、硬编码值
8. **测试覆盖** — 已测试行为、覆盖缺口
9. **依赖关系** — 内部/外部依赖

## Constitution Rules (不可违反)

1. **AST 精确性优先**: 接口定义 100% 来自 AST/代码，绝不由 LLM 捏造
2. **混合分析流水线**: 强制三阶段（预处理 → 上下文组装 → 生成增强）
3. **诚实标注不确定性**: 推断内容用 `[推断: 理由]`，模糊代码用 `[不明确: 理由]`
4. **只读安全性**: 仅向 `specs/` 写入输出，绝不修改源代码
5. **纯 Node.js 生态**: 所有依赖限于 npm 包
6. **双语文档**: 中文散文 + 英文代码标识符

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容
- **保留英文**：代码标识符、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 `## 1. 意图`、`## 2. 接口定义`
- **Frontmatter**：保留英文（YAML 键名）

## 架构问答工具（MCP）

### `panoramic-query` — 架构分析 + 自然语言问答

`panoramic-query` MCP 工具支持四种 operation：

| operation | 说明 | 必填参数 |
|-----------|------|----------|
| `cross-package` | 跨包依赖分析（monorepo 项目） | `projectRoot` |
| `architecture-ir` | 架构信息模型（IR）提取 | `projectRoot` |
| `overview` | 架构概览文档生成 | `projectRoot` |
| `natural-language` | **自然语言问答**（FR-009）| `projectRoot` + `question` |

#### `natural-language` operation（F5 新增）

通过自然语言问题查询项目架构，支持 5 类典型问题：调用关系、调用路径、设计决策映射、技术债、流程归属。

**参数**：
- `operation`（必填）：`"natural-language"`
- `projectRoot`（必填）：项目根目录绝对路径
- `question`（必填）：问题文本（`operation=natural-language` 时必填；空字符串会被拒绝）

**返回**：JSON 格式的 `QnAAnswer` 结构：
- `answer`（string）：LLM 生成的回答文本
- `citations`（Citation[]）：溯源引用列表（100% 覆盖率，每条含三字段）
  - `specPath`：引用来源的 spec 文件路径（repo-relative）
  - `lineRange`：`{ startLine, endLine }`（1-based，含边界）
  - `excerpt`：原文摘要（≤ 200 字符）
  - `nodeId`（可选）：对应 graph 节点 ID
  - `similarity`（可选）：余弦相似度得分（RAG 精排路径）
- `tokenUsage`：`{ input, output, overBudget }`（overBudget=true 时已超 $0.05 硬限额，但不阻断调用）
- `durationMs`：问答耗时（毫秒）
- `fallbackMode`（可选）：`'rag-only' | 'bfs-only' | 'graph-insufficient'`（降级模式）

**前置条件**：需先运行 `spectra batch` 生成 `specs/_meta/graph.json`。

**典型调用**：
```json
{
  "operation": "natural-language",
  "projectRoot": "/absolute/path/to/project",
  "question": "什么模块调用了认证逻辑？"
}
```

## 图查询工具（MCP）

单模块生成完成后，若项目已跑过 `spectra batch`，则 `specs/_meta/graph.json` 会提供 6 个 MCP 图查询工具供 AI 助手调用：

- `graph_query`：按关键词查询相关模块和子图（`{ question: "认证模块", depth: 2 }`）
- `graph_node`：查询指定节点的详情和邻居（`{ id: "src/auth/login.ts" }`）；v2.0 起返回额外的 `semanticEdges` 字段（见下）
- `graph_path`：查找两个节点间的最短路径（`{ source, target }`）
- `graph_community`：列出某社区的节点（`{ communityId: "c-0" }`）
- `graph_god_nodes`：识别度数最高的枢纽节点（`{ limit: 10 }`）
- `graph_hyperedges`：查询超边（Hyperedges），表达 3+ 节点共同参与的架构流程或概念群（见下）

使用场景：通过 `/spectra` 生成单模块 spec 后，想追问"这个模块被谁调用了"、"从 A 到 B 的依赖路径是什么"、"项目里哪个模块最核心"等结构性问题，即可使用这些工具。

### `graph_hyperedges`

查询 `graph.json` 中的超边（Hyperedges），表达 3+ 节点共同参与的架构流程或概念群。需要先运行 `spectra batch --hyperedges` 生成含超边的图谱。

**参数**（均可选）：
- `label`（string）：按 hyperedge label 模糊匹配（子串，大小写不敏感）
- `node_id`（string）：按节点 ID 精确匹配（返回 nodes 数组中含此 ID 的 hyperedge）
- `limit`（number）：返回数量上限（默认返回全部匹配的超边）

**返回**：hyperedge 列表，每条含 `id` / `label` / `nodes` / `rationale` / `confidence`，以及 `total`（匹配总数）和 `filtered`（是否使用了过滤参数）

**典型调用**：
```json
{ "label": "Ingestion Pipeline" }
{ "node_id": "src/auth/login.ts" }
{}
```

**使用场景**：
- 查询 "Full Ingestion Pipeline" 等命名流程涉及的所有函数/模块
- 反向溯源某个函数属于哪些架构流程（通过 `node_id` 过滤）
- 了解项目中有哪些跨模块的复杂协作关系

### `graph_node` v2.0 新增：`semanticEdges` 字段

v2.0 起，`graph_node` 响应额外返回 `semanticEdges` 数组，列出与当前节点关联的所有语义边（`references` / `conceptually_related_to` / `rationale_for`）。

每条语义边包含：
- `type`：边类型（`references` / `conceptually_related_to` / `rationale_for`）
- `direction`：相对当前节点的方向（`outgoing` / `incoming`）
- `peer`：对端节点 ID
- `evidenceText`：证据文本（可选）
- `evidenceSource`：证据来源（格式 `"path:startLine-endLine"`，可选）
- `confidence`：置信度（`EXTRACTED` / `INFERRED` / `AMBIGUOUS`）

节点无关联语义边时，`semanticEdges` 返回空数组（不报错）。
