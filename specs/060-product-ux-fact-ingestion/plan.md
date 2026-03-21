# Implementation Plan: 060 产品 / UX 事实接入

## 目标

在不破坏现有 053/055/058/059 主链路的前提下，为 Reverse Spec 增加一层产品事实文档输出，使 batch 套件能够同时交付技术文档和产品 / UX 文档。

## 技术方案

### 1. 新增产品事实聚合模块

创建 `src/panoramic/product-ux-docs.ts`，内部按四层组织：

1. **Corpus 采集**
   - `specs/products/*/current-spec.md`
   - 根目录 `README.md`
   - 本地 design/product/roadmap/journey/ux/persona/brief Markdown
   - `gh issue list` / `gh pr list`（可选）
   - `git log -n 10`

2. **规则抽取**
   - 概述段落提炼
   - 用户画像表解析
   - 场景 / 任务流抽取
   - issue/PR -> feature brief 映射
   - 无 GitHub 时 journey -> candidate brief 回退

3. **结构化模型**
   - `ProductEvidenceRef`
   - `ProductOverviewOutput`
   - `UserJourney`
   - `FeatureBrief`
   - `FeatureBriefIndexOutput`

4. **渲染与写盘**
   - `product-overview.md/.json`
   - `user-journeys.md/.json`
   - `feature-briefs/index.md/.json`
   - `feature-briefs/*.md/.json`

### 2. 接入 batch 项目级文档编排

修改 `src/panoramic/batch-project-docs.ts`：

- 在 ADR pipeline 之后调用 `generateProductUxDocs(...)`
- 把新生成文件纳入 `generatedDocs`
- 把 overview / journeys / brief index 的 structured outputs 传给质量评估器

### 3. 接入 docs bundle 与质量门

修改：

- `src/panoramic/docs-bundle-orchestrator.ts`
- `src/panoramic/docs-bundle-profiles.ts`
- `src/panoramic/docs-quality-model.ts`
- `src/panoramic/docs-quality-evaluator.ts`

具体目标：

- `developer-onboarding`、`api-consumer` profile 增加产品入口文档
- required-doc 规则新增 `product-managed`
- provenance 支持 `design-doc`、`issue`、`pull-request`
- 修复嵌套路径 `feature-briefs/index.md` 在 bundle 中的路径保留，避免覆盖 landing page

### 4. 验证策略

- 单测：产品事实聚合、issue/PR + current-spec 抽取、文件写盘
- 集成：batch 产出产品文档并进入 docs bundle / quality
- 回归：docs bundle 主链路仍可工作
- 真实样例：在当前仓库上直接运行 060，验证 `current-spec + README + 本地 Markdown + GitHub PR` 可生成产品文档

## 风险与缓解

1. **产品事实过度推断**
   - 以 `current-spec` 为首要事实源；其余来源只补充，不反客为主

2. **GitHub CLI 不可用**
   - 所有 `gh` 调用都保守降级为 warning

3. **bundle 路径冲突**
   - 对 project-doc 保留相对 outputDir 的子目录结构，不再仅使用 basename

4. **不同产品 current-spec 混合后摘要过载**
   - 第一版只截取有限段落、场景和 brief 数量，优先保持可读规模
