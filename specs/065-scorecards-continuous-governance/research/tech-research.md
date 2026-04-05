# Tech Research: 065 Scorecards 与持续治理报告

## 现有事实源

- `specs/products/<product>/current-spec.md`
- `specs/products/<product>/_generated/entity.yaml`
- `specs/products/_generated/catalog-index.yaml`
- `specs/products/spec-driver/_generated/workflow-index.json`
- `specs/quality-report.json`
- `specs/<feature>/verification/verification-report.md`

## 借鉴点

- 063/064 已经采用 “Git-native helper + YAML contract + 生成索引” 模式
- 059 已经提供 `quality-report.json` 的稳定结构，可直接复用
- Blueprint 062 明确 065 不引入 OPA/Rego，先做 report-first

## 结论

- 采用 `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- 默认规则放在 `plugins/spec-driver/scorecards/default-governance.yaml`
- 项目级覆盖放在 `.specify/scorecards/*.yaml`
- scorecard 生成完成后回写 `entity.yaml` / `catalog-index.yaml` 摘要，避免 Catalog 与治理结果割裂
