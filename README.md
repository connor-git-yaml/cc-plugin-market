# Reverse-Spec

![Version](https://img.shields.io/badge/version-2.0.0-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Node.js](https://img.shields.io/badge/Node.js-20.x+-339933)
![Tests](https://img.shields.io/badge/tests-175%20passed-brightgreen)

> 通过 AST 静态分析 + LLM 混合流水线，将遗留源代码逆向工程为结构化的 9 段式中文 Spec 文档。TypeScript/JavaScript 项目享有 AST 增强的精确分析，其他语言通过纯 LLM 模式提供降级支持。

## 功能特性

- **CLI 全局分发** — `npm install -g` 后提供 `reverse-spec` 全局命令，支持 `generate`/`batch`/`diff` 三个子命令
- **Skill 自动注册** — 全局安装后自动将 `/reverse-spec` 系列 skill 注册到 Claude Code，卸载时自动清理
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
| 测试框架 | Vitest（单元/集成/Golden Master/自举） |

## 快速开始

### 环境要求

- Node.js 20.x+
- Claude Code CLI
- Anthropic API Key（设置 `ANTHROPIC_API_KEY` 环境变量）

### 全局安装（推荐）

```bash
npm install -g reverse-spec
```

全局安装后：

- `reverse-spec` CLI 可在任意项目中使用
- `/reverse-spec` 系列 skill 自动注册到 Claude Code
- 卸载时自动清理已注册的 skill

### 本地开发安装

```bash
git clone <repo-url>
cd reverse-spec
npm install
```

### CLI 使用

```bash
# 单模块 Spec 生成
reverse-spec generate src/auth/ --deep

# 全项目批量生成
reverse-spec batch --force

# Spec 漂移检测
reverse-spec diff specs/auth.spec.md src/auth/

# 自定义输出目录
reverse-spec generate src/auth/ --output-dir out/

# 查看版本
reverse-spec --version

# 查看帮助
reverse-spec --help
```

### Claude Code Skill 使用

在 Claude Code 中执行以下命令：

```bash
# 单模块 Spec 生成
/reverse-spec src/auth/

# 全项目批量生成
/reverse-spec-batch

# Spec 漂移检测
/reverse-spec-diff specs/auth.spec.md src/auth/
```

### 开发命令

```bash
# 编译
npm run build

# 运行全部测试
npm test

# 监听模式测试
npm run test:watch

# 覆盖率报告
npm run test:coverage

# 仅单元测试
npm run test:unit

# 仅集成测试
npm run test:integration

# 类型检查
npm run lint
```

## 项目结构

```text
src/
├── core/                          # 核心分析流水线
│   ├── ast-analyzer.ts            # ts-morph AST → CodeSkeleton
│   ├── tree-sitter-fallback.ts    # AST 容错降级
│   ├── context-assembler.ts       # Skeleton + 依赖 → LLM prompt
│   ├── llm-client.ts              # Claude API 客户端（重试、解析）
│   ├── single-spec-orchestrator.ts # 单模块生成编排
│   ├── secret-redactor.ts         # 敏感信息脱敏
│   └── token-counter.ts           # Token 预算管理
├── graph/                         # 依赖图谱
│   ├── dependency-graph.ts        # dependency-cruiser 封装
│   ├── topological-sort.ts        # 拓扑排序 + Tarjan SCC
│   └── mermaid-renderer.ts        # Mermaid 依赖图生成
├── diff/                          # 差异引擎
│   ├── structural-diff.ts         # CodeSkeleton 结构比对
│   ├── semantic-diff.ts           # LLM 行为变更评估
│   ├── noise-filter.ts            # 空白/注释噪声过滤
│   └── drift-orchestrator.ts      # 漂移检测编排
├── generator/                     # Spec 生成与输出
│   ├── spec-renderer.ts           # Handlebars 九段式渲染
│   ├── frontmatter.ts             # YAML frontmatter + 版本管理
│   ├── mermaid-class-diagram.ts   # Mermaid 类图生成
│   └── index-generator.ts         # _index.spec.md 生成
├── batch/                         # 批处理编排
│   ├── batch-orchestrator.ts      # 批量 Spec 生成
│   ├── progress-reporter.ts       # 终端进度显示
│   └── checkpoint.ts              # 断点续传状态
├── models/                        # Zod Schema 类型定义
│   ├── code-skeleton.ts           # CodeSkeleton
│   ├── drift-item.ts              # DriftItem + DriftSummary
│   ├── dependency-graph.ts        # DependencyGraph + SCC
│   └── module-spec.ts             # ModuleSpec + DriftReport + BatchState
├── utils/                         # 工具函数
│   ├── file-scanner.ts            # 文件发现 + .gitignore 过滤
│   └── chunk-splitter.ts          # >5k LOC 分块策略
├── cli/                           # CLI 全局命令入口
│   ├── index.ts                   # bin 入口（#!/usr/bin/env node）
│   ├── commands/
│   │   ├── generate.ts            # generate 子命令
│   │   ├── batch.ts               # batch 子命令
│   │   └── diff.ts                # diff 子命令
│   └── utils/
│       ├── parse-args.ts          # 参数解析
│       └── error-handler.ts       # 错误处理
├── scripts/                       # npm lifecycle 脚本
│   ├── postinstall.ts             # 全局安装后注册 skill
│   └── preuninstall.ts            # 卸载前清理 skill
└── skills-global/                 # 全局版 Skill（使用 CLI 调用）
    ├── reverse-spec/SKILL.md
    ├── reverse-spec-batch/SKILL.md
    └── reverse-spec-diff/SKILL.md

templates/                         # Handlebars 输出模板
├── module-spec.hbs                # 九段式 Spec 模板
├── index-spec.hbs                 # 架构索引模板
└── drift-report.hbs               # 漂移报告模板

skills/                            # 本地版 Skill（使用 npx tsx 调用）
├── reverse-spec/SKILL.md          # /reverse-spec 命令
├── reverse-spec-batch/SKILL.md    # /reverse-spec-batch 命令
└── reverse-spec-diff/SKILL.md     # /reverse-spec-diff 命令

tests/                             # 测试套件（175 用例）
├── unit/                          # 14 个单元测试文件
├── integration/                   # 3 个集成测试文件
├── golden-master/                 # Golden Master 结构相似度测试
└── self-hosting/                  # 自举测试（分析自身）
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

## 测试

项目包含 4 级测试体系，共 175 个测试用例：

| 层级 | 文件数 | 用例数 | 覆盖范围 |
|------|--------|--------|----------|
| 单元测试 | 14 | 138 | 各模块独立功能（含 CLI 解析、Skill 注册） |
| 集成测试 | 3 | 23 | 端到端流水线 + 漂移检测 + CLI e2e |
| Golden Master | 1 | 9 | AST 提取精度 ≥ 90% 结构相似度 |
| 自举测试 | 1 | 5 | 项目分析自身的完整性验证 |

## 设计文档

项目采用 Spec 驱动开发（SDD）方法论：

| 文档 | 内容 |
|------|------|
| [spec.md](specs/001-reverse-spec-v2/spec.md) | 功能规格：7 个用户故事、27 条功能需求、9 条成功标准 |
| [plan.md](specs/001-reverse-spec-v2/plan.md) | 实现计划：项目结构、Constitution 合规检查 |
| [data-model.md](specs/001-reverse-spec-v2/data-model.md) | 数据模型：8 个核心实体、ER 图、状态转换、数据流 |
| [tasks.md](specs/001-reverse-spec-v2/tasks.md) | 任务清单：52 个任务、8 个阶段、依赖关系图 |
| [contracts/](specs/001-reverse-spec-v2/contracts/) | API 契约：6 个模块的完整接口定义 |
| [002 spec.md](specs/002-cli-global-distribution/spec.md) | CLI 全局分发：4 个用户故事、12 条功能需求 |
| [002 tasks.md](specs/002-cli-global-distribution/tasks.md) | CLI 任务清单：24 个任务、7 个阶段 |

## Constitution 原则

本项目遵循 6 条不可妥协的 Constitution 原则：

1. **AST 精确性优先** — 所有结构化数据来自 AST，LLM 不得捏造接口
2. **混合分析流水线** — 强制三阶段流水线，原始源码不直接输入 LLM
3. **诚实标注不确定性** — 推断内容必须显式标记并附带理由
4. **只读安全性** — 所有命令严格只读，写入仅限 `specs/` 和 `drift-logs/`
5. **纯 Node.js 生态** — 所有依赖限于 npm 包，不引入非 Node.js 运行时
6. **双语文档规范** — 中文散文 + 英文代码标识符
