# 快速入门：Reverse-Spec Skill 系统 v2.0

**日期**: 2026-02-10 | **规格说明**: [spec.md](spec.md) | **计划**: [plan.md](plan.md)

## 前置条件

- Node.js LTS (20.x+)
- npm 9+
- Claude Code CLI（需支持 skill）
- TypeScript 5.x 项目，包含 `tsconfig.json`

## 安装

```bash
# 安装依赖
npm install ts-morph tree-sitter tree-sitter-typescript dependency-cruiser handlebars zod

# 开发依赖
npm install -D vitest @types/node typescript
```

## 项目初始化

```bash
# 初始化 TypeScript 项目（如尚未初始化）
npm init -y
npx tsc --init

# 创建输出目录
mkdir -p specs drift-logs templates

# 验证 skill 文件是否存在
ls skills/reverse-spec/SKILL.md
ls skills/reverse-spec-batch/SKILL.md
ls skills/reverse-spec-diff/SKILL.md
```

## 使用方法

### 单模块 Spec 生成

```bash
# 在 Claude Code 中
/reverse-spec src/auth/

# 深度分析（包含函数体）
/reverse-spec src/auth/ --deep

# 输出：specs/auth.spec.md
```

### 批量项目处理

```bash
# 在 Claude Code 中 — 全项目
/reverse-spec-batch

# 强制重新生成所有 spec
/reverse-spec-batch --force

# 输出：specs/*.spec.md + specs/_index.spec.md
```

### Spec 漂移检测

```bash
# 在 Claude Code 中
/reverse-spec-diff specs/auth.spec.md src/auth/

# 输出：drift-logs/auth-drift-2026-02-10.md
```

## 验证步骤

实现完成后，运行以下检查验证系统是否正常工作：

### 1. AST 提取准确性（Constitution I）

```bash
# 运行 AST 分析器单元测试
npx vitest run tests/unit/ast-analyzer.test.ts

# 预期结果：所有导出符号与源代码完全匹配
```

### 2. 流水线集成测试（Constitution II）

```bash
# 运行三阶段流水线集成测试
npx vitest run tests/integration/pipeline.test.ts

# 预期结果：预处理 → 上下文组装 → 生成 全流程完成
#           不向 LLM 发送原始源代码（仅发送 skeleton + 上下文）
```

### 3. 性能测试（SC-003）

```bash
# 对 500 文件测试夹具运行测试
npx vitest run tests/unit/ast-analyzer.test.ts --grep "performance"

# 预期结果：AST 解析 + skeleton 提取 ≤ 10 秒
```

### 4. Golden Master 测试（SC-004）

```bash
# 将生成的 spec 与预验证标准进行比对
npx vitest run tests/golden-master/

# 预期结果：与期望输出的结构相似度 ≥ 90%
```

### 5. 自举测试（SC-009）

```bash
# 为 reverse-spec 项目自身生成 spec
npx vitest run tests/self-hosting/self-host.test.ts

# 预期结果：为所有源模块生成有效且连贯的 spec
```

## 关键架构决策

| 决策项 | 选型 | 理由 |
|--------|------|------|
| AST 解析器 | ts-morph（主）+ tree-sitter（降级） | ts-morph 提供完整 TS 分析；tree-sitter 提供容错能力 |
| 依赖图 | dependency-cruiser + 自定义 Tarjan SCC | 可编程 API + 轻量级自建图算法 |
| 模板引擎 | Handlebars | 非开发人员可维护、支持 partial 继承、Markdown 安全 |
| 敏感信息检测 | 自定义正则 + 熵值扫描器 | 轻量级、无臃肿依赖、完全可控 |
| Token 计数 | 两阶段（快速估算 → 精确计数） | 兼顾速度（500 文件）与精度（预算控制） |
| 数据验证 | Zod schemas | 对所有中间数据结构进行运行时验证 |
| 测试框架 | Vitest | 快速、TypeScript 原生支持、兼容 Golden Master 模式 |

## 实现后的文件布局

```
reverse-spec/
├── src/
│   ├── core/
│   │   ├── ast-analyzer.ts        # ts-morph AST → CodeSkeleton
│   │   ├── tree-sitter-fallback.ts
│   │   ├── context-assembler.ts   # Skeleton + 依赖 → LLM prompt
│   │   ├── secret-redactor.ts     # 敏感信息脱敏
│   │   └── token-counter.ts       # Token 预算管理
│   ├── graph/
│   │   ├── dependency-graph.ts    # dependency-cruiser 封装
│   │   ├── topological-sort.ts    # 拓扑排序 + Tarjan SCC
│   │   └── mermaid-renderer.ts    # Mermaid 图表生成
│   ├── diff/
│   │   ├── structural-diff.ts     # CodeSkeleton 结构比对
│   │   ├── semantic-diff.ts       # LLM 行为变更评估
│   │   └── noise-filter.ts        # 空白/注释噪声过滤
│   ├── generator/
│   │   ├── spec-renderer.ts       # Handlebars 九段式渲染
│   │   ├── frontmatter.ts         # YAML frontmatter + 版本管理
│   │   ├── mermaid-class-diagram.ts
│   │   └── index-generator.ts     # _index.spec.md 生成
│   ├── batch/
│   │   ├── batch-orchestrator.ts  # 批处理编排
│   │   ├── progress-reporter.ts   # 终端进度显示
│   │   └── checkpoint.ts          # 断点续传状态
│   ├── models/
│   │   ├── code-skeleton.ts       # CodeSkeleton Zod schema
│   │   ├── drift-item.ts          # DriftItem Zod schema
│   │   ├── dependency-graph.ts    # DependencyGraph Zod schema
│   │   └── module-spec.ts         # ModuleSpec 及相关 schema
│   └── utils/
│       ├── file-scanner.ts        # 文件发现 + .gitignore 过滤
│       └── chunk-splitter.ts      # >5k LOC 分块策略
├── templates/
│   ├── module-spec.hbs            # 九段式 spec 模板
│   ├── index-spec.hbs             # 架构索引模板
│   └── drift-report.hbs           # 漂移报告模板
├── skills/
│   ├── reverse-spec/SKILL.md
│   ├── reverse-spec-batch/SKILL.md
│   └── reverse-spec-diff/SKILL.md
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── golden-master/
│   └── self-hosting/
├── specs/                         # 生成输出
└── drift-logs/                    # 漂移报告
```
