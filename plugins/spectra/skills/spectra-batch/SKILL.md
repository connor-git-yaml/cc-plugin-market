---
name: spectra-batch
description: |
  Use this skill when the user asks to:
  - Generate specs for an entire project or codebase
  - Document all modules systematically
  - Create a complete specification index for the project
  - Batch process multiple modules for spec generation
  This skill generates an architecture overview index, then iterates through modules producing individual .spec.md files.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Systematically reverse-engineer specs for an entire codebase. Generates an index spec with architecture overview, then iterates through modules producing individual .spec.md files.

## Execution Flow

### 1. Project Survey

Scan the project root to understand structure:

1. **Detect project type**: monorepo, single app, library, CLI, etc.
2. **Identify top-level modules**: `src/` subdirectories, packages in monorepo, major feature folders
3. **Estimate total scope**: file count, LOC per module
4. **Detect existing specs**: Check `specs/` directory for already-generated specs

### 2. Generate Batch Plan

Present the analysis plan to the user:

```markdown
## Spectra Batch Plan

**Project**: <name>
**Type**: <project type>
**Total scope**: N files, ~N LOC

### Modules to analyze (in dependency order):

| # | Module | Files | LOC | Existing Spec? | Priority |
|---|--------|-------|-----|----------------|----------|
| 1 | core/utils | 5 | 320 | No | Foundation |
| 2 | models/ | 8 | 890 | No | Data layer |
| 3 | auth/ | 12 | 1450 | Yes (outdated) | Critical |
| ... | | | | | |

**Estimated effort**: ~N minutes with AI analysis

Proceed with all? Or select specific modules (e.g., "1,3,5" or "auth/ models/")
```

Wait for user confirmation before proceeding.

### 3. Run Batch Pipeline

Execute the batch pipeline using the globally installed `spectra` CLI:

```bash
spectra batch
```

如果需要强制重新生成所有 spec：

```bash
spectra batch --force
```

如果需要自定义输出目录：

```bash
spectra batch --output-dir specs
```

如果需要启用 LLM hyperedge 提取（生成超边，用于 `graph_hyperedges` MCP 工具）：

```bash
spectra batch --hyperedges
```

#### Hyperedges 相关选项与环境变量

| 选项 / 环境变量 | 类型 | 说明 |
|---|---|---|
| `--hyperedges` | CLI flag | 启用 LLM hyperedge 提取；等价于设置 `SPECTRA_HYPEREDGES_ENABLED=true` |
| `SPECTRA_HYPEREDGES_ENABLED` | `true` \| `false` | 环境变量方式控制 hyperedge 提取（默认 `false`） |
| `SPECTRA_EMBEDDING_PROVIDER` | `local` \| `openai` | 语义嵌入提供方（默认 `local`；选 `openai` 时需要 `OPENAI_API_KEY`） |
| `OPENAI_API_KEY` | string | 仅当 `SPECTRA_EMBEDDING_PROVIDER=openai` 时需要提供 |

**注意**：启用 `--hyperedges` 会额外调用 LLM 对 design-doc 进行超边提取，会增加 token 消耗和批量运行时间。建议仅在需要架构流程分析时启用。

### 4. Final Summary

After batch completes:

```markdown
## Batch Spectra Complete

**Generated**: N/M specs
**Index**: specs/_index.spec.md
**Total time**: ~N minutes

### Generated Specs:
- specs/auth.spec.md (high confidence)
- specs/models.spec.md (medium confidence)
- specs/api.spec.md (skipped by user)

### Project-Wide Observations:
- <Cross-module patterns noticed>
- <Shared technical debt themes>
- <Architecture recommendations>
```

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容、注释
- **保留英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 `## 1. 意图`、`## 2. 接口定义`
- **表格表头**：使用中文，例如 `| 模块 | 规格 | 用途 | 依赖 |`
- **Frontmatter**：保留英文（YAML 键名）

## Guidelines

- 按**依赖顺序**处理模块（基础模块优先）
- **可恢复**：如果中断，检查已有 specs 并跳过已完成的模块
- **不重复生成**已存在的 spec，除非用户指定 `--force`
- 每个模块的 spec 保持**自包含**，但通过索引交叉引用

## 图查询工具（MCP）

Batch 完成后，Spectra 自动生成 `specs/_meta/graph.json` 和 `specs/_meta/GRAPH_REPORT.md`，并暴露 5 个 MCP 图查询工具。在支持 MCP 的 AI 助手中可直接调用：

### `graph_query` — 关键词子图查询

按自然语言查询词匹配节点并扩展邻居子图。

- 用途：探索"认证模块"、"数据库连接"等抽象主题的相关代码
- 典型调用：`graph_query({ question: "认证模块", budget: 30, depth: 2 })`
- 返回：JSON 格式的节点和边列表

### `graph_node` — 单节点详情

查询某个节点的详细信息和直接邻居。

- 用途：追踪某个函数、模块或类的完整影响范围
- 典型调用：`graph_node({ id: "src/auth/login.ts", budget: 20 })` 或 `graph_node({ keyword: "login" })`
- 返回：目标节点元数据 + 邻居列表

### `graph_path` — 最短路径

查找两个节点间的最短调用/依赖路径。

- 用途：理解"模块 A 是如何最终影响到模块 B 的"
- 典型调用：`graph_path({ source: "src/cli/main.ts", target: "src/db/connection.ts" })`
- 返回：有序的节点 ID 列表（起点 → 终点）

### `graph_community` — 社区节点查询

列出某个社区（模块聚类）的所有节点，识别代码边界。

- 用途：从社区层面审视架构划分是否合理
- 典型调用：`graph_community({ communityId: "c-0" })`
- 返回：该社区下的全部节点

### `graph_god_nodes` — 枢纽节点识别

识别图谱中度数最高的核心节点，定位过度耦合或架构瓶颈。

- 用途：代码审查、重构规划的起点
- 典型调用：`graph_god_nodes({ limit: 10 })`
- 返回：按度数降序的节点列表
