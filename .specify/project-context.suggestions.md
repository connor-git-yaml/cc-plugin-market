# Project Context Suggestions

- Generated At: `2026-07-06T07:40:40.111Z`
- Status: `advisory`
- Context Source: `yaml`

## Summary

- Critical: 0
- Recommended: 2
- Optional: 2
- Total Suggestions: 4

## Suggestions

### [OPTIONAL] 把稳定事实文档纳入 Project Context references

建议把产品活文档与治理报告声明进 Project Context，供 feature / implement / sync 等流程显式注入上下文，而不是依赖口头记忆。

- ID: `add-stable-reference-documents`
- Category: `references`

Suggested Changes:
- `references.paths` · append: `specs/products/reverse-spec/current-spec.md`, `specs/products/reverse-spec/_generated/quality-report.md`, `specs/products/reverse-spec/_generated/scorecard-report.md`, `specs/products/spec-driver/current-spec.md`, `specs/products/spec-driver/_generated/quality-report.md`, `specs/products/spec-driver/_generated/scorecard-report.md`, `specs/products/spec-driver/_generated/adoption-report.md`, `specs/products/spectra/current-spec.md`, `specs/products/spectra/_generated/quality-report.md`, `specs/products/spectra/_generated/scorecard-report.md`

Evidence:
- `document` · `specs/products/reverse-spec/current-spec.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/reverse-spec/_generated/quality-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/reverse-spec/_generated/scorecard-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spec-driver/current-spec.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spec-driver/_generated/quality-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spec-driver/_generated/scorecard-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spec-driver/_generated/adoption-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spectra/current-spec.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spectra/_generated/quality-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。
- `document` · `specs/products/spectra/_generated/scorecard-report.md` — 该文档已存在且长期稳定，可作为项目参考资料。

### [OPTIONAL] 把高频 workflow 路由固化到 Project Context

当前运行记录已经形成稳定的 workflow 使用偏好，建议把默认入口与成熟 spec 的专用入口写入 Project Context。

- ID: `codify-workflow-preferences`
- Category: `workflow-preferences`

Suggested Changes:
- `workflow_preferences.default_workflow` · set: `spec-driver-doc`
- `workflow_preferences.mature_spec_workflow` · set: `spec-driver-implement`

Evidence:
- `adoption-report` · `specs/products/spec-driver/_generated/adoption-report.json` — 最近 run summary 中最常使用的 workflow 是 spec-driver-doc（0 次）。
- `workflow-index` · `specs/products/spec-driver/_generated/workflow-index.json` — workflow registry 已包含成熟 spec 专用入口 spec-driver-implement。

### [RECOMMENDED] 把验证偏好固化到 Project Context

当前 verification 信号存在缺口，建议把验证偏好与最低完成标准显式写入 Project Context。

- ID: `codify-verification-policy`
- Category: `verification-policy`

Suggested Changes:
- `verification_policy.required_commands` · set: `npm run lint`, `npm run build`, `feature-scoped tests`
- `verification_policy.require_quality_review` · set: `true`
- `verification_policy.review_dimensions` · set: `architecture`, `readability`, `maintainability`

Evidence:
- `scorecard-report` · `specs/products/spec-driver/_generated/scorecard-report.json` — verification-freshness 当前状态为 warn。

### [RECOMMENDED] 补充默认 owner / reviewers

产品 Catalog 仍存在 owner 未声明的情况，建议在 Project Context 中补充默认 owner 与 reviewers，降低后续审查责任不清的问题。

- ID: `declare-default-owner-and-reviewers`
- Category: `ownership`

Suggested Changes:
- `ownership.default_owner` · set: `<team-or-maintainer>`
- `ownership.default_reviewers` · set: `<maintainer-or-team>`

Evidence:
- `entity-catalog` · `specs/products/reverse-spec/_generated/entity.yaml` — reverse-spec 的 entity.yaml 仍显示 owner=unknown。
- `entity-catalog` · `specs/products/spec-driver/_generated/entity.yaml` — spec-driver 的 entity.yaml 仍显示 owner=unknown。
- `entity-catalog` · `specs/products/spectra/_generated/entity.yaml` — spectra 的 entity.yaml 仍显示 owner=unknown。

