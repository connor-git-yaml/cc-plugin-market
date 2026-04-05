# Verification Report: 081 可读性与维护性热点重构

## Summary

- 状态：PASS
- Feature：081 `可读性与维护性热点重构`
- 验证日期：2026-04-05
- 结论：四个热点入口已经收敛为更清晰的 orchestrator 边界；Node 热点逻辑下沉到 shared core modules，`init-project.sh` 拆出输出 helper 并保持 JSON/text 合同不变。
- 主线同步：提交前执行 `git fetch origin && git rebase --autostash origin/master`，结果为 up to date / no-op。

## Complexity Delta

| Hotspot Entry | Before | After | 变化 |
|---|---:|---:|---|
| `plugins/spec-driver/scripts/generate-workflow-registry.mjs` | 311 行 | 16 行 | 入口仅保留参数解析、core 调用和 stdout 分发 |
| `plugins/spec-driver/scripts/generate-product-quality-reports.mjs` | 599 行 | 18 行 | document refs / status / conflict / markdown 迁入 `product-quality-core.mjs` |
| `plugins/spec-driver/scripts/generate-product-scorecards.mjs` | 868 行 | 25 行 | ruleset loading / rule evaluation / rendering 迁入 `product-scorecard-core.mjs` |
| `plugins/spec-driver/scripts/init-project.sh` | 392 行 | 287 行 | phase runner 与 output render 解耦，文本/JSON 输出迁入 `init-project-output.sh` |

## Boundary Changes

- 新增 `plugins/spec-driver/scripts/lib/script-cli-args.mjs`，统一三类热点脚本的 `--project-root` / `--json` 参数处理。
- 新增 `plugins/spec-driver/scripts/lib/workflow-registry-core.mjs`，承接 workflow definition、override、golden path 和 markdown 生成。
- 新增 `plugins/spec-driver/scripts/lib/product-quality-core.mjs`，承接 document refs、required docs、conflicts、stats 与 markdown 生成。
- 新增 `plugins/spec-driver/scripts/lib/product-scorecard-core.mjs`，承接 ruleset、rule evaluation、report assembly 与 markdown 生成。
- 新增 `plugins/spec-driver/scripts/lib/product-governance-helpers.mjs`，收敛 product mapping/title/path/object 等共享辅助能力。
- 新增 `plugins/spec-driver/scripts/lib/init-project-output.sh`，让 `init-project.sh` 的阶段执行和输出渲染分层。

## Targeted Tests

- 新增 `tests/unit/workflow-registry-core.test.ts`
- 新增 `tests/unit/product-quality-core.test.ts`
- 新增 `tests/unit/product-scorecard-core.test.ts`
- 更新 `tests/unit/spec-driver-script-platform.test.ts`
- 更新 `tests/integration/spec-driver-init-project.test.ts`

## Commands

### Focused regressions

```bash
npx vitest run tests/unit/workflow-registry-core.test.ts tests/unit/product-quality-core.test.ts tests/unit/product-scorecard-core.test.ts tests/unit/spec-driver-script-platform.test.ts
npx vitest run tests/integration/spec-driver-init-project.test.ts tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-product-quality-reports.test.ts tests/integration/spec-driver-product-scorecards.test.ts
```

结果：
- 8 个测试文件 / 21 条测试通过

### Repository-wide validation

```bash
npm run lint
npm run build
npm test
```

结果：
- `npm run lint` 通过
- `npm run build` 通过
- `npm test` 通过，`117` 个测试文件 / `1035` 条测试全部通过

## Risks / Follow-ups

- `product-scorecard-core.mjs` 仍然是当前最厚的 core module；081 已把热点从入口文件转为可测试模块，但后续若继续做深层可维护性收敛，可再把 evaluator / renderer 拆成更细的子模块。
- 本次没有推进 079/080 的更大规模结构迁移，保持在 081 规定的“小范围热点重构”边界内。
