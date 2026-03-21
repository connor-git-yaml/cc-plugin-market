# Tech Research: 060 产品 / UX 事实接入

## 调研模式

- mode: `full`
- reason: 060 同时涉及产品事实源、GitHub 外部输入、batch 编排、docs bundle、quality/provenance 复用，既要看代码也要看产品层输入边界

## 代码库现状

### 已有上游能力

- `specs/products/*/current-spec.md` 已经通过 Spec Driver sync 成为产品级活文档事实源
- `src/panoramic/batch-project-docs.ts` 已负责项目级文档套件编排，是 060 最合适的接入点
- `src/panoramic/docs-bundle-orchestrator.ts` 与 `docs-bundle-profiles.ts` 已能把项目级文档组织成交付 bundle
- `src/panoramic/docs-quality-evaluator.ts` 已实现 provenance / required-doc / quality gate，可复用为 060 的治理出口

### 现有缺口

- batch 套件虽然有技术架构、运行时、ADR 和 quality，但没有产品定位、用户旅程和 feature brief
- docs bundle 的阅读路径还偏技术视角，缺少产品入口文档
- quality / provenance 还没有把产品文档作为 required-doc 和 evidence 对象

## 设计判断

1. **以 current-spec 为一等事实源，不从代码倒推产品目标**
   - 代码和配置无法稳定推出用户目标与产品定位
   - 既然仓库已经有 `current-spec.md`，060 应该优先消费它，而不是重新做弱推断

2. **GitHub issue / PR 作为可选增强，而不是硬依赖**
   - 本地或离线环境下不一定安装 `gh`
   - 第一版必须支持 warning 降级，这样 batch 主链路不会被外部 CLI 阻断

3. **本地 Markdown 设计文档只做补充源**
   - 这类文档结构差异很大，不适合成为 canonical fact
   - 但它们适合补充 UX 场景、roadmap 和产品术语

4. **Feature brief 必须保留嵌套目录**
   - `feature-briefs/index.md` 与 bundle landing `index.md` 同名
   - bundle 编排若只保留 basename，会发生 landing page 被覆盖的路径冲突

5. **继续坚持确定性事实、非 LLM 优先**
   - 产品 overview / journeys / briefs 的第一版以规则抽取、表格解析、标题/段落归并和 issue/PR 映射为主
   - 不引入额外 LLM 调用，避免扩大事实幻觉面

## 推荐实现

- 新增 `src/panoramic/product-ux-docs.ts`
  - 构建 `ProductFactCorpus`
  - 生成 `ProductOverviewOutput`
  - 生成 `UserJourneysOutput`
  - 生成 `FeatureBriefIndexOutput` 与多篇 brief
- 新增模板：
  - `templates/product-overview.hbs`
  - `templates/user-journeys.hbs`
  - `templates/feature-brief-index.hbs`
  - `templates/feature-brief.hbs`
- 接入：
  - `batch-project-docs.ts`
  - `docs-bundle-orchestrator.ts`
  - `docs-bundle-profiles.ts`
  - `docs-quality-evaluator.ts`
  - `docs-quality-model.ts`
- 增加测试：
  - `tests/panoramic/product-ux-docs.test.ts`
  - `tests/integration/batch-product-ux-docs.test.ts`
  - 现有 docs bundle / quality 回归测试更新
