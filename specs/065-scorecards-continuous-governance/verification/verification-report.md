# Verification Report: 065 Scorecards 与持续治理报告

## Result

- Status: PASS
- Date: 2026-04-04

## Commands

```bash
npx vitest run tests/integration/spec-driver-product-scorecards.test.ts tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-init-project.test.ts tests/integration/spec-driver-product-entity-catalog.test.ts
npm run lint
npm run build
node plugins/spec-driver/scripts/generate-workflow-registry.mjs --project-root . --json
node plugins/spec-driver/scripts/generate-product-scorecards.mjs --project-root . --json
```

## Evidence

- `tests/integration/spec-driver-product-scorecards.test.ts` 验证了：
  - scorecard helper 能为 `reverse-spec` 与 `spec-driver` 生成 `scorecard-report.md/.json`
  - helper 会回写 `entity.yaml` 中的 `quality.scorecard`
  - `catalog-index.yaml` 会附带 `scorecardStatus / scorecardScore`
- `tests/integration/spec-driver-init-project.test.ts` 验证 `init-project.sh` 会创建 `.specify/scorecards/` 并复制 `default-governance.yaml`
- `tests/integration/spec-driver-workflow-registry.test.ts` 验证 `spec-driver-sync` 的 workflow artifacts 已包含：
  - `specs/products/<product>/_generated/scorecard-report.md`
  - `specs/products/<product>/_generated/scorecard-report.json`
  - `specs/products/_generated/scorecard-index.yaml`
- `tests/integration/spec-driver-product-entity-catalog.test.ts` 回归通过，说明 065 没破坏 063 的 Catalog helper
- 在当前仓库执行 helper 后，真实输出已写入：
  - `specs/products/reverse-spec/_generated/scorecard-report.md`
  - `specs/products/spec-driver/_generated/scorecard-report.md`
  - `specs/products/_generated/scorecard-index.yaml`

## Observations

- 当前真实仓库的两个产品 scorecard 都是 `FAIL`，但失败原因是真实治理缺口，而不是链路错误：
  - `reverse-spec`: verification 覆盖率仅 28%，且缺少 `quality-report.json`
  - `spec-driver`: verification 覆盖率约 69%，且缺少 `quality-report.json`
- `branch-hygiene` 与 `workflow-readiness` 均为 `PASS`，说明 063/064 与本次 065 的目录层、入口层和治理层已经接通

## Notes

- 065 维持 `report-first`，不会自动阻断流程，也没有引入 OPA/Rego
- verification 历史报告格式不完全统一，因此 helper 采用了“状态正则 + mtime”双重兜底策略
