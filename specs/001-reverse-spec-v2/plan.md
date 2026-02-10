# Implementation Plan: Reverse-Spec Skill System v2.0

**Branch**: `001-reverse-spec-v2` | **Date**: 2026-02-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-reverse-spec-v2/spec.md`

## Summary

构建一套 Claude Code AI Agent Skill 套件（3 个 Slash Commands + 3 个内部工具链模块），通过 AST 静态分析（ts-morph）+ LLM 混合三阶段流水线（预处理 → 上下文组装 → 生成增强），将遗留 TypeScript/JavaScript 源代码逆向工程为结构化的 9 段式中文 Spec 文档。支持单模块生成、基于依赖拓扑排序的全项目批量生成、以及基于 AST 语义级 Diff 的 Spec 漂移检测。纯 Node.js 生态，文件系统存储，接口定义 100% AST 提取保证。

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js LTS (20.x+)
**Primary Dependencies**: ts-morph (AST), tree-sitter + tree-sitter-typescript (容错降级), dependency-cruiser (依赖图), handlebars (模板), zod (验证), Anthropic Claude API Sonnet/Opus (LLM)
**Storage**: 纯文件系统 — Markdown 写入 `specs/` 和 `drift-logs/`，JSON 用于断点状态，无数据库
**Testing**: Vitest (单元测试 + Golden Master 测试 + 自举测试)
**Target Platform**: Claude Code 沙箱环境 / 本地 Node.js (macOS/Linux)
**Project Type**: Single project (CLI 工具包 + Claude Code Skill 脚本)
**Performance Goals**: 500 文件 AST 预处理 ≤ 10s; 单文件上下文 ≤ 100k Token; 50 模块批处理端到端无人工干预
**Constraints**: 纯 npm 生态 (禁止 Python/Rust); 接口 100% AST 提取 (禁止 LLM 推断结构数据); 严格只读 (仅写 specs/ + drift-logs/); LLM 上下文前自动脱敏; 中文 Spec + 英文代码标识符
**Scale/Scope**: 200+ 模块 Monorepo; 单文件 >5k LOC 分块; 支持循环依赖 SCC 处理

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Check (Phase 0 Gate)

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | AST Accuracy First (NON-NEGOTIABLE) | PASS | FR-001: 所有结构数据来自 AST; ast-analyzer 模块独立于 LLM; CodeSkeleton 中间表示确保数据链路可审计 |
| II | Hybrid Analysis Pipeline | PASS | FR-002: 强制三阶段流水线; 项目结构按 core/(pre-processing, context-assembly, generation) 拆分 |
| III | Honest Uncertainty Marking | PASS | FR-008: 定义 `[推断]`/`[不明确]`/`[SYNTAX ERROR]` 三级标记体系，每个标记必须附带理由 |
| IV | Read-Only Safety | PASS | FR-023: 禁止修改源文件; FR-024: 写入限定 specs/ + drift-logs/; FR-022: 漂移更新需用户确认 |
| V | Pure Node.js Ecosystem | PASS | 所有依赖为 npm 包; Constitution Technology Stack Constraints 表明确限定; 非 TS/JS 降级为纯 LLM |
| VI | Bilingual Documentation Standard | PASS | FR-025: 中文 Spec + 英文代码标识符; 9 段式中文结构定义于 FR-006 |

**Pre-Design Gate Result**: ALL PASS — 无违规，进入 Phase 0。

### Post-Design Re-evaluation (Phase 1 Complete)

| # | Principle | Status | Design Artifact Evidence |
|---|-----------|--------|--------------------------|
| I | AST Accuracy First (NON-NEGOTIABLE) | PASS | data-model: CodeSkeleton.exports 全部来自 AST; contracts/core-pipeline: `analyzeFile()` 保证 `ExportSymbol.signature` 100% AST 提取; research R1: ts-morph 单 Project 实例 + skeleton 从 AST 重建 |
| II | Hybrid Analysis Pipeline | PASS | contracts/core-pipeline: `assembleContext()` 强制三阶段; data-model: 数据流 CodeSkeleton → RedactedSkeleton → LLM Prompt → ModuleSpec; research R5: Token 预算管理确保 ≤100k |
| III | Honest Uncertainty Marking | PASS | contracts/generator: `renderSpec()` 保留 `[推断]`/`[不明确]`/`[SYNTAX ERROR]` 标记; data-model: ParseError 实体捕获降级信息; contracts/core-pipeline: tree-sitter-fallback 标记受影响符号 |
| IV | Read-Only Safety | PASS | contracts/batch-module: `runBatch()` 仅写 specs/; contracts/diff-engine: `filterNoise()` 和 `compareSkeletons()` 纯计算无副作用; data-model: DriftReport.outputPath 限定 drift-logs/ |
| V | Pure Node.js Ecosystem | PASS | research R1: SWC(Rust) 明确 Rejected; research R3: Handlebars(npm) 选定; research R4: 自建扫描器无外部依赖; 所有 contracts API 均为 Node.js 模块 |
| VI | Bilingual Documentation Standard | PASS | contracts/generator: Handlebars 模板渲染 9 段式中文 Spec; data-model: SpecSections 定义 9 个中文段; research R3: Handlebars partial 继承支持统一格式 |

**Post-Design Gate Result**: ALL PASS — 设计阶段未引入任何违规。无需 Complexity Tracking 条目。

## Project Structure

### Documentation (this feature)

```text
specs/001-reverse-spec-v2/
├── spec.md              # Feature spec (已完成，27 条 FR + 9 条 SC)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (内部模块 API 契约)
├── checklists/
│   └── requirements.md  # Spec 质量检查 (已完成，16/16 通过)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── core/                          # 核心分析流水线
│   ├── ast-analyzer.ts            # ts-morph AST 解析 → CodeSkeleton
│   ├── tree-sitter-fallback.ts    # 语法错误容错降级
│   ├── context-assembler.ts       # Skeleton + 依赖 + 片段 → LLM Prompt
│   ├── secret-redactor.ts         # 敏感信息自动脱敏 (FR-027)
│   ├── token-counter.ts           # Token 计数与 100k 预算控制
│   ├── llm-client.ts              # Claude API 封装 (模型选择/重试/响应解析)
│   └── single-spec-orchestrator.ts # 单模块 Spec 生成编排 (/reverse-spec 入口)
├── graph/                         # 依赖图谱模块
│   ├── dependency-graph.ts        # dependency-cruiser 封装 → DAG
│   ├── topological-sort.ts        # 拓扑排序 + SCC 检测 (Tarjan)
│   └── mermaid-renderer.ts        # 依赖图 Mermaid 源码生成
├── diff/                          # 差异引擎模块
│   ├── structural-diff.ts         # CodeSkeleton 结构对比
│   ├── semantic-diff.ts           # LLM 语义变更评估
│   ├── noise-filter.ts            # 格式/注释/import 噪音过滤
│   └── drift-orchestrator.ts      # 漂移检测编排 (/reverse-spec-diff 入口)
├── generator/                     # Spec 生成与输出
│   ├── spec-renderer.ts           # Handlebars 9 段式模板渲染
│   ├── frontmatter.ts             # YAML Frontmatter + 版本递增
│   ├── mermaid-class-diagram.ts   # 类图生成
│   └── index-generator.ts         # _index.spec.md 架构索引
├── batch/                         # 批处理编排
│   ├── batch-orchestrator.ts      # 编排 (进度/重试/断点恢复)
│   ├── progress-reporter.ts       # 终端实时进度 + 摘要日志
│   └── checkpoint.ts              # 断点状态持久化 (JSON)
├── models/                        # 类型定义与 Zod Schema
│   ├── code-skeleton.ts           # CodeSkeleton
│   ├── drift-item.ts              # DriftItem
│   ├── dependency-graph.ts        # DependencyGraph
│   └── module-spec.ts             # ModuleSpec / ArchitectureIndex / DriftReport
└── utils/
    ├── file-scanner.ts            # 文件发现 + .gitignore 过滤
    └── chunk-splitter.ts          # >5k LOC 分块策略

skills/                            # Claude Code Skill 入口 (已存在)
├── reverse-spec/SKILL.md
├── reverse-spec-batch/SKILL.md
└── reverse-spec-diff/SKILL.md

templates/                         # Spec 输出模板
├── module-spec.hbs                # 9 段式 Module Spec 模板
├── index-spec.hbs                 # 架构索引模板
└── drift-report.hbs               # 漂移报告模板

tests/
├── unit/                          # 单元测试
│   ├── ast-analyzer.test.ts
│   ├── structural-diff.test.ts
│   ├── noise-filter.test.ts
│   ├── secret-redactor.test.ts
│   ├── topological-sort.test.ts
│   └── token-counter.test.ts
├── integration/                   # 集成测试
│   ├── pipeline.test.ts           # 三阶段流水线端到端
│   ├── batch-processing.test.ts
│   └── drift-detection.test.ts
├── golden-master/                 # Golden Master 测试
│   ├── fixtures/                  # 已知 TS 代码样本
│   └── expected/                  # 预验证标准 Spec
└── self-hosting/
    └── self-host.test.ts          # 自举测试
```

**Structure Decision**: 采用 Single Project 结构。按功能域拆分为 6 个子模块 (core, graph, diff, generator, batch, models) + utils，每个子模块对应一个或多个内部工具链 API。skills/ 目录保留现有 SKILL.md 作为 Claude Code 命令入口，新增 templates/ 目录存放 Handlebars/EJS 输出模板。测试按 unit / integration / golden-master / self-hosting 四层组织。

## Complexity Tracking

> 无 Constitution 违规，此表无需填充。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | —          | —                                   |
