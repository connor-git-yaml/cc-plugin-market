# Implementation Plan: 通用数据模型文档生成

**Branch**: `038-data-model-doc` | **Date**: 2026-03-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/038-data-model-doc/spec.md`

## Summary

实现 DataModelGenerator，从 Python dataclass / Pydantic model / TypeScript interface 等提取字段定义，生成数据模型参考文档和 Mermaid ER 图。基于 tree-sitter AST 分析，复用现有 TreeSitterAnalyzer 基础设施，自定义 Python 字段声明提取逻辑。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: tree-sitter（AST 解析）、handlebars（模板渲染）、zod（数据验证）——均为现有依赖，无新增
**Storage**: 文件系统（`specs/` 目录写入）
**Testing**: vitest
**Target Platform**: CLI + MCP Server（Claude Code 沙箱）
**Project Type**: single
**Performance Goals**: 500 个文件的 AST 解析在 10 秒内完成（复用现有 tree-sitter 性能保证）
**Constraints**: 不引入非 Node.js 运行时依赖
**Scale/Scope**: 支持 Python（dataclass、Pydantic）和 TypeScript（interface、type alias）两种语言

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 检查结果 | 说明 |
|------|---------|------|
| I. 双语文档规范 | ✅ PASS | 代码注释中文、标识符英文 |
| II. Spec-Driven Development | ✅ PASS | 遵循 specify → plan → tasks → implement → verify 流程 |
| III. 诚实标注不确定性 | ✅ PASS | 不涉及 LLM 推断（useLLM=false） |
| IV. AST 精确性优先 | ✅ PASS | 所有字段定义从 tree-sitter AST 提取 |
| V. 混合分析流水线 | ✅ PASS | 仅使用 AST 预处理阶段，不调用 LLM |
| VI. 只读安全性 | ✅ PASS | 仅写入 specs/ 目录 |
| VII. 纯 Node.js 生态 | ✅ PASS | 无新增依赖 |

## Project Structure

### Documentation (this feature)

```text
specs/038-data-model-doc/
├── spec.md
├── plan.md              # 本文件
├── research.md          # 技术调研报告
├── data-model.md        # 数据模型定义
├── quickstart.md        # 快速验证指南
├── checklists/
│   └── requirements.md  # 规范质量检查清单
└── tasks.md             # 任务清单（由 /spec-driver.tasks 生成）
```

### Source Code (repository root)

```text
src/
├── panoramic/
│   ├── interfaces.ts                  # （已有）核心接口定义
│   ├── project-context.ts             # （已有）ProjectContext 构建
│   ├── generator-registry.ts          # （已有）GeneratorRegistry — 需更新 bootstrap
│   ├── mock-readme-generator.ts       # （已有）Mock Generator
│   └── data-model-generator.ts        # 【新增】DataModelGenerator 主实现
├── models/
│   └── code-skeleton.ts               # （已有）ExportSymbol / MemberInfo 类型
└── core/
    ├── tree-sitter-analyzer.ts        # （已有）TreeSitterAnalyzer 单例
    └── query-mappers/
        ├── python-mapper.ts           # （已有）Python AST 映射
        └── typescript-mapper.ts       # （已有）TypeScript AST 映射

templates/
└── data-model.hbs                     # 【新增】数据模型文档 Handlebars 模板

tests/
└── panoramic/
    └── data-model-generator.test.ts   # 【新增】DataModelGenerator 单元测试
```

**Structure Decision**: 所有新代码放在 `src/panoramic/` 下。DataModelGenerator 作为单文件实现（含类型定义、提取逻辑、Generator 类和 Mermaid 生成），避免过度拆分。模板放在现有 `templates/` 目录下。

## 实现方案

### 1. 数据类型定义（Zod Schema + TypeScript 类型）

在 `data-model-generator.ts` 顶部定义：
- `DataModelFieldSchema` / `DataModelField`
- `DataModelSchema` / `DataModel`（kind: dataclass | pydantic | interface | type）
- `ModelRelationSchema` / `ModelRelation`
- `DataModelInputSchema` / `DataModelInput`
- `DataModelOutputSchema` / `DataModelOutput`

### 2. Python 字段提取策略

使用 TreeSitterAnalyzer 获取 AST Tree，自定义遍历 class body：

1. 通过 `extractExports()` 获取 CodeSkeleton，筛选 `kind === 'class'` 的导出
2. 检查 signature 中是否包含 `@dataclass` 装饰器（通过 re-parse 或 signature 字符串匹配）
3. 检查基类列表是否包含 `BaseModel`（signature 中 `class Foo(BaseModel)`）
4. 对符合条件的类，使用 tree-sitter 重新解析源文件，遍历 class body 中的：
   - `expression_statement` > `assignment`（带类型注解的字段赋值）
   - `expression_statement` > `type`（纯类型注解字段）
5. 对 `Field(...)` 调用，解析 `keyword_argument` 提取 `default` 和 `description`

### 3. TypeScript 接口/类型提取策略

直接从 CodeSkeleton 数据提取：

1. 筛选 `exports` 中 `kind === 'interface' || kind === 'type'` 的条目
2. 从 `members` 中提取 `kind === 'property'` 的条目
3. 从 member.signature 解析属性名、类型和可选标记
4. 对于缺失的 JSDoc，使用 tree-sitter 补充提取

### 4. 关系分析策略

1. **继承关系**: 从 DataModel.bases 直接提取，如果基类名在已知模型名集合中则建立 inherits 关系
2. **引用关系**: 遍历每个字段的 typeStr，检查是否包含已知模型名：
   - 单值引用 `field: ModelName` → `has` 关系
   - 集合引用 `field: List[ModelName]` / `ModelName[]` → `contains` 关系

### 5. Mermaid ER 图生成

使用 `erDiagram` 语法：
```
erDiagram
    User {
        string name
        int age
        string email
    }
    Admin ||--o{ User : "inherits"
```

### 6. Handlebars 模板

`data-model.hbs` 包含：
- 文档标题和统计摘要
- 按语言分组的模型列表，每个模型包含字段表格
- Mermaid ER 图代码块

## Complexity Tracking

无 Constitution 违规，无需记录。
