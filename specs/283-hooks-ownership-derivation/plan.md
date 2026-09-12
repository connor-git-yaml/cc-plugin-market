# F283 plan

| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P1 | (a) `OWNED_HOOK_SCRIPT_SUFFIXES` 由 `OWNED_HOOK_EXPECTED_EVENT` 派生；generator handler 级 `isOwnedEntry` fail-loud | `codex-hooks-schema.mjs` / `codex-hooks-generator.mjs` | 派生表逐项相同；未登记脚本抛错；hooks 7 套件绿 |
| P2 | (b) `delegation-tool-names.mjs` 单源；core / writer import、reader 转发导出；`JUDGE_FILE_SET` +1；钉数量测试改派生 | `lib/`、`judge-snapshot-core.mjs`、两处 doctor/snapshot 测试 | `test:plugins` 0 fail；闭包守卫绿 |
| P3 | (c) `parseRenameOperands` 22 行矩阵 + 方向钉 | `plugins/spec-driver/tests/f283-delegation-single-source.test.mjs` | `!== 2 → < 2` 变异红 |
| P4 | 红先行 A/B（origin/master 临时 worktree） | fix-report §3 | 改动前 3 红 + import 红 |
| P5 | 异构对抗复审 ≥2 角 + verify 子代理 | `verification/` | CRITICAL 清零；变异逐条红 |
| P6 | 门禁 + rebase master + ff push | — | vitest / build / test:plugins / repo:check / release:check 零失败 |

不做：双 tokenizer 收敛；hooks 事件集 / matcher 改动；`product-handler-*` 码族重构。
