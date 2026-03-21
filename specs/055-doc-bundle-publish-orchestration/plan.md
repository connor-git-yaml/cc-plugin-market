# Implementation Plan: 055 文档 Bundle 与发布编排

## 目标

在现有 `reverse-spec batch` 已生成模块级 spec、`_index.spec.md` 与 053 panoramic 项目级文档之后，
新增一层面向交付的 docs bundle 编排，输出可被 MkDocs / TechDocs 直接消费的目录结构、manifest 与 landing page，
并按不同受众提供明确的阅读路径。

## 修改范围

### 核心编排

- `src/panoramic/docs-bundle-orchestrator.ts`
  - 汇总 batch 已生成的项目级文档、模块级 spec 与索引
  - 依据 profile 定义计算 bundle 清单、阅读顺序与输出目录
  - 写出 `docs-bundle.yaml`、`mkdocs.yml`、`docs/index.md` 与 bundle 内文档副本

### 新增共享模型

- `src/panoramic/docs-bundle-types.ts`
  - 定义 bundle manifest、profile summary、文档映射等共享结构
  - 作为未来 056/057/059 可能复用的交付层中间表示

- `src/panoramic/docs-bundle-profiles.ts`
  - 固化 `developer-onboarding`、`architecture-review`、`api-consumer`、`ops-handover`
  - 定义每个 profile 的选文规则、优先级与阅读路径

### 现有模块调整

- `src/batch/batch-orchestrator.ts`
  - 在 053 项目级文档生成与 `_index.spec.md` 完成后接入 docs bundle 编排
  - 扩展 `BatchResult`，暴露 manifest 路径与 profile 摘要

- `src/panoramic/batch-project-docs.ts`
  - 视需要增强项目级文档摘要，保留生成器 ID 与输出映射

- `src/cli/commands/batch.ts`
  - 打印 bundle manifest 与 profile 摘要，保持现有 batch 摘要不回归

### 模板

- `templates/docs-bundle-index.hbs`
  - 渲染每个 profile 的 landing page / `index.md`

### 测试

- `tests/panoramic/docs-bundle-orchestrator.test.ts`
- `tests/integration/batch-doc-bundle-orchestration.test.ts`
- 视需要更新 `tests/integration/batch-panoramic-doc-suite.test.ts`

## 实现策略

1. 复用 batch 已产出的事实源
   - 仅消费模块级 spec、`_index.spec.md`、053 panoramic 文档与其已知命名映射
   - 不重复运行 generators，不重新扫描源码生成另一套事实

2. 建立交付层共享模型
   - 将“源文档清单”“bundle profile”“导航顺序”“输出路径映射”独立建模
   - 模型保持模板无关，避免把 MkDocs/TechDocs 渲染细节写入共享层

3. 生成 bundle 目录与站点骨架
   - 在 `outputDir` 根下写出 `docs-bundle.yaml`
   - 为每个 profile 生成独立目录、`mkdocs.yml`、`docs/`、`docs/index.md`
   - 文档排序按 profile 定义的阅读路径生成，而非文件名排序

4. 做好缺失文档降级
   - 某些 panoramic 文档不适用时，对受影响 profile 跳过对应条目并写入 warning
   - bundle 仍可生成，且导航顺序对剩余文档保持稳定

5. 保持双端兼容与轻依赖
   - 仅使用现有 Node.js / TypeScript / Handlebars / built-ins
   - 不引入必须依赖单一 CLI 或重型站点框架才能运行的流程

## 输出结构草案

```text
<outputDir>/
  docs-bundle.yaml
  bundles/
    developer-onboarding/
      mkdocs.yml
      docs/
        index.md
        architecture-narrative.md
        architecture-overview.md
        runtime-topology.md
        ...
        modules/
          api.spec.md
          models.spec.md
    architecture-review/
      ...
```

## 验证策略

1. 单测验证 manifest 结构、profile 选文与导航顺序计算。
2. 集成测试运行 `runBatch()`，验证 `docs-bundle.yaml`、bundle 目录、`mkdocs.yml`、`docs/index.md` 与文档顺序。
3. 验证缺失 runtime / api / event 文档时，相关 profile 能降级而不阻断 batch。
4. 跑相关 tests、`npm run lint`、`npm run build`。
5. 若本地 fixture 可用，对 `claude-agent-sdk-python` 执行一次准真实 batch 验证，并写入 verification report。
