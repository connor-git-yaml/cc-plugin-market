# Verification Report: 066 Adoption / Friction Insights

## Result

- Status: PASS
- Date: 2026-04-05

## Commands

```bash
npx vitest run tests/integration/spec-driver-adoption-insights.test.ts tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-init-project.test.ts tests/integration/spec-driver-product-scorecards.test.ts
npm run codex:spec-driver:install
node plugins/spec-driver/scripts/generate-workflow-registry.mjs --project-root . --json
node plugins/spec-driver/scripts/generate-adoption-insights.mjs --project-root . --json
npm run lint
npm run build
```

## Evidence

- `tests/integration/spec-driver-adoption-insights.test.ts` 验证了：
  - `record-workflow-run.mjs` 会把 run summary 追加到 `.specify/runs/*.jsonl`
  - `generate-adoption-insights.mjs` 能输出 adoption report
  - 损坏 JSONL 行不会阻断聚合
  - rerun / gate pause / verification failure 热点会被正确聚合
- `tests/integration/spec-driver-init-project.test.ts` 验证 `init-project.sh` 会创建 `.specify/runs/`
- `tests/integration/spec-driver-workflow-registry.test.ts` 验证 `spec-driver-sync` 的 workflow artifacts 已包含 adoption report
- `npm run codex:spec-driver:install` 用于刷新 `.codex/skills/*` 包装技能，使 Codex 侧也带上 066 的 run logging / adoption 合同

## Notes

- `.specify/runs/` 被明确视为本地输入，不默认提交到 Git
- 066 没有将 adoption 直接升级为 gate，仅生成反馈报告
