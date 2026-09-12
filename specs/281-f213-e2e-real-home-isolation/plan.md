# F281 plan

| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P1 | 环境探针：`HOME=<tmp>` 下项目级 `.codex/config.toml` 是否生效；真 HOME + 临时 cwd 行为 | 探针命令记录在 fix-report §1 | 结论可复现 |
| P2 | 隔离：每场景临时 HOME + `cwd: fixtureRoot`；effectiveCodexHome 从临时 HOME 派生 | `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts` | worktree 2/2 绿；真 `~/.codex` 零残留 |
| P3 | 清理链 +临时 HOME；W4 守卫取证点前移 | 同上 | 步数断言 6/7；`cacheResidueAfterRm` 非 null 且 false |
| P4 | `.gitignore` +`.codex/config.toml` | `.gitignore` | `git check-ignore .codex/config.toml` 命中；`.codex/skills/**` 仍 tracked |
| P5 | 独立子代理对抗复审 + verify 子代理；主 checkout 判别性 A/B | `verification/` | 无 CRITICAL；同环境改前红改后绿 |
| P6 | 全量门禁 + rebase master + ff push | — | vitest **零失败**（本卡即消掉主 checkout 唯一红） |

不做：改 codex 项目级配置的加载语义（Codex 自身行为）；处理 Windows `USERPROFILE`；把 e2e 改成 mock（真实 codex 安装链是本用例的存在意义）。
