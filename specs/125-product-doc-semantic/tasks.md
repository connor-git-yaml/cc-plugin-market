# Tasks: 产品文档语义化增强

**Spec**: [spec.md](./spec.md) — 4 stories / 25 FR / 10 SC
**Plan**: [plan.md](./plan.md)

## Phase 1: 工具层（新建可独立测试的 utility 模块）

- [ ] **T1** 新建 `src/panoramic/utils/text-segmenter.ts`
  - 导出 `segmentText(text, granularity)`：包装 `Intl.Segmenter`
  - 导出 `truncateAtNaturalBoundary(text, maxLen)`：CJK 感知截断
  - 导出 `isLinkHeavyParagraph(text)`：基于字符数而非 word count 判断
  - 对应 FR-011~015
- [ ] **T2** 新建 `tests/panoramic/utils/text-segmenter.test.ts`
  - 测 CJK 长文截断落在标点/词边界
  - 测中英混排场景
  - 测 `Intl.Segmenter` 不可用时的 fallback（使用 vi.stubGlobal）
  - 测 link-heavy 判定按字符数
  - 对应 SC-005, SC-006
- [ ] **T3** 新建 `src/panoramic/utils/html-sanitizer.ts`
  - 导出 `stripBlockHtml(text)`：仅处理行首锚定的 block HTML
  - 导出 `decodeHtmlEntities(text)`：解码 `&lt;` `&gt;` `&amp;` `&quot;` 等
  - 导出 `extractDetailsContent(text)`：从 `<details>`/`<summary>` 提取文字
  - 对应 FR-006~010
- [ ] **T4** 新建 `tests/panoramic/utils/html-sanitizer.test.ts`
  - 测 `Array<T>` / `<target>` / `a < b` 保留
  - 测 `<p>/<div>/<img>` block 剥除
  - 测 `<details><summary>` 内容保留
  - 测 HTML entity 解码
  - 测 Markdown code block 不被误处理
  - 对应 SC-003, SC-004

## Phase 2: Pipeline 集成（替换 product-ux-docs.ts 中旧实现）

- [ ] **T5** 重构 `src/panoramic/pipelines/product-ux-docs.ts`：
  - 删除 `inferJourneyOutput`（若残留）
  - 新增 `deriveOutcomeFromScenario(scenario)`：优先 summary → evidence → fallback
  - 新增 `deriveTriggerFromScenario(scenario, actor)`：优先 summary 首句 → title
  - `buildUserJourneys` 改用新推导函数
  - `extractParagraphs` 用 `html-sanitizer.stripBlockHtml` 替代当前 `<[^>]+>` 全量 strip
  - `isDescriptiveParagraph` 用 `text-segmenter.isLinkHeavyParagraph` 替代当前 wordCount 逻辑
  - `extractScenariosFromReadmeCorpus` + `extractScenariosFromReadmeDocument` 使用 `truncateAtNaturalBoundary` 替代 `slice(0, 80)`
  - 对应 FR-001~015

## Phase 3: 回归测试（锁定语义不变量）

- [ ] **T6** 扩展 `tests/panoramic/product-ux-docs.test.ts`：
  - 新增 "消费输出雷同率 < 30%"（Khoj 4 条 feature fixture）
  - 新增 "合法尖括号保留"（`<target>` / `Array<T>` / `< 5ms` fixture）
  - 新增 "本仓库 current-spec 场景不误匹配"（读真实 `specs/products/spec-driver/current-spec.md`）
  - 新增 "长中文段落不被过滤"（100+ 字中文 + markdown link）
  - 新增 "长中文标题截断落在标点"
  - 新增 "<details><summary> 内容保留"
  - 对应 FR-021~024, SC-001, SC-002

## Phase 4: 端到端验证

- [ ] **T7** `npm run build` 零 TypeScript 错误
- [ ] **T8** `npx vitest run` 全量通过（基线 1579，期望 ≥ 1595）
- [ ] **T9** 在 `_reference/graphify` 和 `_reference/khoj` 上跑 `spectra batch --include-docs`
  - 对比修复前 vs 修复后 `user-journeys.md` 的消费输出雷同率
  - 对比产品定位字段的 HTML 残留
  - 对比中文 fixture 的保留情况
  - 对应 SC-001, SC-007, SC-010

## Phase 5: 提交

- [ ] **T10** 创建 fix-report 和 verification-report
- [ ] **T11** 合并为单次提交 `feat(125): 产品文档语义化增强` 并推送

---

## 执行顺序

- Phase 1 的 T1/T3 可并行（不同文件），T2 依赖 T1，T4 依赖 T3
- Phase 2 T5 依赖 T1/T3 完成
- Phase 3 T6 依赖 T5
- Phase 4 T7 → T8 → T9 串行
- Phase 5 串行
