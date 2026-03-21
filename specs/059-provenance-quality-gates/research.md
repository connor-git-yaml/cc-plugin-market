# Research Summary: Provenance 与文档质量门

## 关键结论

1. 059 必须站在现有 shared outputs 之上实现，不应回到 Markdown 字符串后处理。
2. `architecture-narrative` 是当前唯一需要额外 adapter 的 explanation 文档；045/050/057/058 大多已经自带 `evidence` / `confidence`。
3. conflict detector 第一版只做高价值主题，不做泛化语义冲突。
4. 055 是蓝图中的强依赖，但当前代码线未包含其实现，因此 059 必须内建 `manifest missing -> partial report` 的降级策略。

## 推荐实现切分

- `docs-quality-model.ts`: 共享模型
- `narrative-provenance-adapter.ts`: narrative provenance wrapper
- `docs-bundle-manifest-reader.ts`: 可选读取 055 manifest
- `docs-quality-evaluator.ts`: provenance / conflict / required-doc deterministic evaluator
- `batch-project-docs.ts`: 写出 `quality-report.md/.json`

## 主要风险

- README / `current-spec.md` / spec 对同一主题的 canonical 文本归一化不稳
- 055 manifest 当前不在主线，bundle 覆盖率只能 partial
- narrative 粒度不足时，provenance 只能 section-level 降级

## 非目标

- 不新增 060 的 Issue/PR/设计稿外部事实接入
- 不让 LLM 决定 conflict / required-doc / score 的 canonical 结论
- 不修改既有 045/050/057/058 的事实抽取合同
