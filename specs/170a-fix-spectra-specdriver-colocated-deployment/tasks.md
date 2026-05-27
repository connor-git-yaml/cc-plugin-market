# 修复任务 — Feature 170a

## Commit 1: RED phase

- [ ] T1.1 新建 `tests/e2e/feature-170a-spectra-spec-driver-integration.test.ts`
  - US-1 测试: 断言 src/mcp/server.ts 导入 registerAgentContextTools + build 后 dist/mcp/agent-context-tools.js 存在
  - US-2 测试: 断言 5 个 agent frontmatter 包含 `mcp__plugin_spectra_spectra__` 前缀工具名
  - US-3 测试: 断言不含旧 namespace `mcp__spectra__` 前缀（plan/implement/verify/spec-review/quality-review）
- [ ] T1.2 跑 `npx vitest run tests/e2e/feature-170a-*` 确认全 FAIL (RED)
- [ ] T1.3 git commit: `test(170a): E2E test scaffolding — RED phase`

## Commit 2: GREEN phase — Phase 1 (Bug-1)

- [ ] T2.1 修改 `contracts/release-contract.yaml`: spectra.version → 4.2.0，spec-driver.version → 4.2.0
- [ ] T2.2 运行 `npm run release:sync`
- [ ] T2.3 确认 package.json / plugins/spectra/.claude-plugin/plugin.json / plugins/spec-driver/.claude-plugin/plugin.json 版本均已更新为 4.2.0
- [ ] T2.4 运行 `npm run build` 确认 `dist/mcp/agent-context-tools.js` 存在
- [ ] T2.5 运行 `npm publish` 发布 spectra-cli@4.2.0 (**需 npm login 权限，失败则 skip + 标 follow-up**)
- [ ] T2.6 (可选) 验证 `npm view spectra-cli versions --json` 含 4.2.0

## Commit 2: GREEN phase — Phase 2 (Bug-2)

- [ ] T3.1 修改 `plugins/spec-driver/agents/plan.md` frontmatter:
  - `mcp__spectra__context` → `mcp__plugin_spectra_spectra__context`
  - `mcp__spectra__impact` → `mcp__plugin_spectra_spectra__impact`
- [ ] T3.2 修改 `plugins/spec-driver/agents/implement.md` frontmatter（同上）
- [ ] T3.3 修改 `plugins/spec-driver/agents/verify.md` frontmatter:
  - `mcp__spectra__detect_changes` → `mcp__plugin_spectra_spectra__detect_changes`
  - `mcp__spectra__impact` → `mcp__plugin_spectra_spectra__impact`
- [ ] T3.4 修改 `plugins/spec-driver/agents/spec-review.md` frontmatter:
  - `mcp__spectra__impact` → `mcp__plugin_spectra_spectra__impact`
  - `mcp__spectra__context` → `mcp__plugin_spectra_spectra__context`
- [ ] T3.5 修改 `plugins/spec-driver/agents/quality-review.md` frontmatter（同 spec-review）
- [ ] T3.6 grep 验证：`grep -r "mcp__spectra__" plugins/spec-driver/agents/` 无输出

## Commit 2: GREEN phase — Phase 3 (Bug-3)

- [ ] T4.1 新建 `plugins/spec-driver/docs/` 目录
- [ ] T4.2 新建 `plugins/spec-driver/docs/spectra-mcp-integration.md`（部署指引 + 故障排查 + fork RFC follow-up）
- [ ] T4.3 新建 `plugins/spec-driver/docs/customization.md`（fork 用户 sed/awk 一键替换指引）
- [ ] T4.4 更新 `plugins/spec-driver/README.md`（加 "Spectra MCP 集成" 章节 + 链接到 docs/）
- [ ] T4.5 更新 `specs/147-competitor-evaluation-platform/PUBLISH-REPORT.md`（§6 标注 2 步开箱即用）

## Commit 3: 验证 + Codex Review

- [ ] T5.1 运行 `npx vitest run` — 全部 pass（含新 E2E 3 个 + 现有 3708）
- [ ] T5.2 运行 `npm run build` — 零错误
- [ ] T5.3 运行 `npm run repo:check` — 零错误
- [ ] T5.4 运行 `npm run release:check` — 零错误
- [ ] T5.5 Codex 对抗审查 — critical 全修
- [ ] T5.6 git commit: `feat(170a): implement Phase 1/2/3 — GREEN phase`
- [ ] T5.7 Push 前列 deliverable report 等用户确认
