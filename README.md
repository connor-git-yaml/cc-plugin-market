# Reverse-Spec

> 通过 AST 静态分析 + LLM 混合流水线，将遗留源代码逆向工程为结构化的 9 段式中文 Spec 文档。TypeScript/JavaScript 项目享有 AST 增强的精确分析，其他语言（Java、C++、Python 等）通过纯 LLM 模式提供降级支持。

## 功能特性

- **单模块 Spec 生成** (`/reverse-spec`) — 对任意模块生成完整的 9 段式规格文档；TS/JS 项目接口定义 100% 来自 AST 提取，其他语言通过 LLM 降级分析
- **批量项目处理** (`/reverse-spec-batch`) — 基于依赖拓扑排序的全项目批量 Spec 生成，支持断点恢复和架构索引
- **Spec 漂移检测** (`/reverse-spec-diff`) — AST 结构化 Diff + LLM 语义评估，三级严重级别分类，噪声自动过滤
- **混合分析流水线** — 三阶段引擎（预处理 → 上下文组装 → 生成增强），原始源码不直接输入 LLM
- **诚实标注不确定性** — 推断内容标记 `[推断]`，模糊代码标记 `[不明确]`，语法错误标记 `[SYNTAX ERROR]`
- **只读安全保证** — 所有命令严格只读，仅向 `specs/` 和 `drift-logs/` 写入输出

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言/运行时 | TypeScript 5.x, Node.js LTS (20.x+) |
| AST 引擎 | ts-morph（主力），tree-sitter + tree-sitter-typescript（容错降级） |
| 依赖分析 | dependency-cruiser |
| 模板引擎 | Handlebars |
| 数据验证 | Zod |
| 图表生成 | Mermaid（嵌入 Markdown） |
| AI 模型 | Claude 4.5/4.6 Sonnet/Opus（通过 Anthropic API） |
| 测试框架 | Vitest |

## 快速开始

### 环境要求

- Node.js 20.x+
- Claude Code CLI
- Anthropic API Key（设置 `ANTHROPIC_API_KEY` 环境变量）

### 安装

```bash
git clone https://github.com/connor-git-yaml/reverse-spec.git
cd reverse-spec
npm install
```

### 使用

在 Claude Code 中执行以下命令：

```bash
# 单模块 Spec 生成
/reverse-spec src/auth/

# 全项目批量生成
/reverse-spec-batch

# Spec 漂移检测
/reverse-spec-diff specs/auth.spec.md src/auth/
```

## 项目结构

```text
specs/                             # SDD 设计文档
└── 001-reverse-spec-v2/
    ├── spec.md                    # 功能规格（27 FR + 9 SC + 7 US）
    ├── plan.md                    # 实现计划
    ├── data-model.md              # 数据模型（8 实体 + Zod Schema）
    ├── tasks.md                   # 任务清单（59 任务 × 8 阶段）
    ├── research.md                # 技术调研
    ├── quickstart.md              # 快速验证指南
    ├── contracts/                 # 模块间 API 契约（6 文件）
    └── checklists/                # 质量检查清单

skills/                            # Claude Code Skill 入口
├── reverse-spec/SKILL.md          # /reverse-spec 命令
├── reverse-spec-batch/SKILL.md    # /reverse-spec-batch 命令
└── reverse-spec-diff/SKILL.md     # /reverse-spec-diff 命令
```

实现阶段将创建以下源码目录：

```text
src/
├── core/          # 核心分析流水线（AST、上下文组装、LLM 客户端）
├── graph/         # 依赖图谱（拓扑排序、SCC 检测、Mermaid 渲染）
├── diff/          # 差异引擎（结构化 Diff、语义 Diff、噪声过滤）
├── generator/     # Spec 生成与输出（Handlebars 渲染、Frontmatter）
├── batch/         # 批处理编排（进度报告、断点恢复）
├── models/        # Zod Schema 类型定义
└── utils/         # 文件扫描、分块策略

templates/         # Handlebars 输出模板
tests/             # Vitest 测试（单元/集成/Golden Master/自举）
```

## 架构概览

```text
SourceFile(s)
    ↓ [ast-analyzer.ts]              ← 阶段 1：预处理
CodeSkeleton
    ↓ [context-assembler.ts]         ← 阶段 2：上下文组装
    │  + secret-redactor.ts（脱敏）
    │  + token-counter.ts（≤100k 预算）
LLM Prompt
    ↓ [llm-client.ts → Claude API]   ← 阶段 3：生成增强
ModuleSpec → specs/*.spec.md
```

## 设计文档

项目采用 Spec 驱动开发（SDD）方法论，设计阶段已完成：

| 文档 | 内容 |
|------|------|
| [spec.md](specs/001-reverse-spec-v2/spec.md) | 功能规格：7 个用户故事、27 条功能需求、9 条成功标准 |
| [plan.md](specs/001-reverse-spec-v2/plan.md) | 实现计划：项目结构、Constitution 合规检查 |
| [data-model.md](specs/001-reverse-spec-v2/data-model.md) | 数据模型：8 个核心实体、ER 图、状态转换、数据流 |
| [tasks.md](specs/001-reverse-spec-v2/tasks.md) | 任务清单：59 个任务、8 个阶段、依赖关系图 |
| [contracts/](specs/001-reverse-spec-v2/contracts/) | API 契约：6 个模块的完整接口定义 |

## Constitution 原则

本项目遵循 6 条不可妥协的 Constitution 原则：

1. **AST 精确性优先** — 所有结构化数据来自 AST，LLM 不得捏造接口
2. **混合分析流水线** — 强制三阶段流水线，原始源码不直接输入 LLM
3. **诚实标注不确定性** — 推断内容必须显式标记并附带理由
4. **只读安全性** — 所有命令严格只读，写入仅限 `specs/` 和 `drift-logs/`
5. **纯 Node.js 生态** — 所有依赖限于 npm 包，不引入非 Node.js 运行时
6. **双语文档规范** — 中文散文 + 英文代码标识符

## 开发状态

> **当前状态：设计完成，待实现**

设计阶段产出物已通过跨制品一致性分析（`/speckit.analyze`），所有 CRITICAL/MAJOR/MODERATE/LOW 问题已修复。

实现路线：

```text
Phase 1: 初始化 ─────────────────────────────────────────┐
Phase 2: 基础设施（US4 流水线 + US7 模板）───────────────┤
Phase 3: US1 单模块 Spec 生成 🎯 MVP ───────────────────┤
Phase 4: US5 依赖图（可与 US1 并行）────────────────────┤
Phase 5: US2 批量处理（依赖 US1 + US5）─────────────────┤
Phase 6: US6 Diff 引擎（可与 US1/US5 并行）─────────────┤
Phase 7: US3 漂移检测（依赖 US1 + US6）─────────────────┤
Phase 8: 收尾（Golden Master、自举、性能验证）───────────┘
```
