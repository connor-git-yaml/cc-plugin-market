# Implementation Plan: 053 Batch 全景项目文档套件与架构叙事输出

## 目标

让 `reverse-spec batch` 在模块级 spec 之后，自动产出适用的 panoramic 项目级文档，并新增一份面向人类阅读的 `architecture-narrative`。

## 修改范围

### 核心编排

- `src/batch/batch-orchestrator.ts`
  - 接入项目级 panoramic 输出编排
  - 合并当前与已有 module spec 事实
  - 在 `BatchResult` 中返回项目级输出摘要

### 新增辅助模块

- `src/panoramic/batch-project-docs.ts`
  - 发现适用 generators
  - 统一写出 `md/json/mmd`
  - 返回已生成文档路径与结构化输出缓存

- `src/panoramic/architecture-narrative.ts`
  - 从 module spec、project context 与已有 panoramic 输出构建可读叙事模型
  - 渲染 `architecture-narrative.md/.json`

- `src/panoramic/output-filenames.ts`
  - generator 输出文件名共享映射

### 现有模块调整

- `src/panoramic/coverage-auditor.ts`
  - 复用共享命名映射

- `src/cli/commands/batch.ts`
  - 打印项目级输出摘要

### 模板

- `templates/architecture-narrative.hbs`

### 测试

- `tests/integration/batch-panoramic-doc-suite.test.ts`
- `tests/panoramic/architecture-narrative.test.ts`
- 视需要补 `tests/integration/batch-incremental.test.ts` 的断言

## 验证策略

1. 针对包含 API / 配置 / Docker Compose 的 fixture 运行 `runBatch()`，验证项目级文档写出。
2. 针对单包项目运行 `runBatch()`，验证 `architecture-narrative.md` 在无 runtime/workspace 情况下仍生成。
3. 跑 `lint`、`build` 与新旧相关 integration/panoramic tests，确认 batch 主链路未回归。
