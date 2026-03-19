# Implementation Plan: 配置参考手册生成

**Branch**: `039-config-reference-generator` | **Date**: 2026-03-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/039-config-reference-generator/spec.md`

## Summary

实现 ConfigReferenceGenerator，作为 DocumentGenerator<ConfigReferenceInput, ConfigReferenceOutput> 的具体实现。从项目中发现 YAML/TOML/.env 配置文件，解析每个配置项的键路径、类型、值和注释说明，通过 Handlebars 模板渲染为 Markdown 配置参考手册。Feature 037 的 ArtifactParser 依赖降级为内部直接实现解析逻辑。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: handlebars（模板渲染）、zod（数据验证）— 均为现有依赖，无新增
**Storage**: 文件系统（specs/ 目录写入生成的 Markdown）
**Testing**: vitest（单元测试）
**Target Platform**: Node.js CLI / MCP server
**Project Type**: single（扩展现有 src/panoramic/ 模块）
**Performance Goals**: 解析 50 个配置文件在 1 秒内完成
**Constraints**: 不引入新 npm 依赖（Constitution VII）；仅使用行级正则解析配置文件
**Scale/Scope**: 支持 YAML/TOML/.env 三种格式；项目根目录及一级子目录扫描

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 双语文档规范 | PASS | 中文文档 + 英文代码标识符 |
| II. Spec-Driven Development | PASS | 完整走 specify → plan → tasks → implement → verify 流程 |
| III. 诚实标注不确定性 | PASS | 类型推断结果本身即为推断值，在数据模型中明确 |
| IV. AST 精确性优先 | N/A | 本 Feature 处理配置文件而非代码 AST |
| V. 混合分析流水线 | N/A | 不涉及 LLM 分析源代码 |
| VI. 只读安全性 | PASS | 仅读取配置文件，写入 specs/ 目录 |
| VII. 纯 Node.js 生态 | PASS | 不引入新依赖，使用行级正则解析 |

**Post-Phase 1 Re-check**: PASS — 设计未引入违反 Constitution 的元素

## Project Structure

### Documentation (this feature)

```text
specs/039-config-reference-generator/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/panoramic/
├── interfaces.ts                    # 已有：DocumentGenerator 接口定义
├── project-context.ts               # 已有：ProjectContext 构建
├── generator-registry.ts            # 已有：注册中心（需更新 bootstrap）
├── mock-readme-generator.ts         # 已有：Mock 示例
└── config-reference-generator.ts    # 新增：ConfigReferenceGenerator 实现

templates/
└── config-reference.hbs             # 新增：Handlebars 模板

tests/panoramic/
└── config-reference-generator.test.ts  # 新增：单元测试
```

**Structure Decision**: 遵循现有 `src/panoramic/` 模块结构，新增源文件与 MockReadmeGenerator 同级。模板文件放在项目根 `templates/` 目录。测试文件放在 `tests/panoramic/` 与现有测试同级。
