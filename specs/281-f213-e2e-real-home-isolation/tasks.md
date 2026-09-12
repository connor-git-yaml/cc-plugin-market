# F281 tasks

- [x] T001 探针：`HOME=<tmp>` + cwd=仓根 → 项目级 config 不生效；真 HOME + cwd=/tmp → 真家目录 server 列表
- [x] T002 临时 HOME 隔离 + `cwd: fixtureRoot`（`tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`）
- [x] T003 清理链 +`rm 临时 HOME`；W4 守卫取证点前移到删家目录之前
- [x] T004 `.gitignore` +`.codex/config.toml`
- [x] T005 worktree 实跑 2/2 绿；真 `~/.codex/plugins/cache` 零 e2e 残留
- [x] T006 独立子代理对抗复审（≥1）——0C/2W/8I，W-1/W-2/I-8 已修
- [x] T006b 修补后主线程复跑：worktree e2e 2/2 绿 + skip 态零泄漏实测
- [x] T007 verify 子代理 verification/verification-report.md（PASS；合成环境同侧 A/B 复现 `'node'` 签名）
- [ ] T008 全量门禁（vitest 零失败 / build / repo:check / release:check）
- [ ] T009 rebase master → ff push origin master → 删分支
