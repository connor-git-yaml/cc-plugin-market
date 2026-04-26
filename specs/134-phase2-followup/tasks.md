---
title: Fix 134 — 修复任务清单
mode: fix
status: tasks-complete
created: 2026-04-26
parent: plan.md
---

# 修复任务清单

每个任务对应一个独立 commit，按顺序执行。

## T1：偏差 1 — `spec-driver.config.yaml` 全改 sonnet + preset → balanced

- [ ] 1.1 改首行注释 `# 预设: quality-first（所有阶段均使用 Opus）` → `# 预设: balanced（默认 Sonnet 4.6，Phase 2 新默认）`
- [ ] 1.2 改 `preset: quality-first` → `preset: balanced`
- [ ] 1.3 改 10 个 `model: opus` → `model: sonnet`（product-research, tech-research, specify, plan, analyze, clarify, checklist, tasks, implement, verify）
- [ ] 1.4 commit + push: `chore(134): spec-driver.config.yaml 全改 sonnet（preset → balanced + 10 agents）`

## T2：偏差 4 — `src/cli/index.ts` 追加 `[--hyperedges]` help 字符串

- [ ] 2.1 src/cli/index.ts:44 batch 行 `[--mode <full|reading|code-only>]` 后追加 `[--hyperedges]`
- [ ] 2.2 验证 `npm run build` 通过（仅注释/字符串变更，预期无类型错误）
- [ ] 2.3 commit + push: `fix(134): CLI batch help 字符串追加 --hyperedges flag`

## T3：偏差 2 — input token 累加 cache 子字段

- [ ] 3.1 改 `src/auth/cli-proxy.ts:258-269` — input 提取累加 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- [ ] 3.2 改 `src/core/llm-client.ts:319-322` — 同上累加
- [ ] 3.3 新增测试 `tests/auth/cli-proxy-token-extraction.test.ts` — mock Claude CLI stream 含 cache 子字段，断言 inputTokens 累加正确
- [ ] 3.4 新增测试 `tests/core/llm-client-token-extraction.test.ts` — mock Anthropic SDK 响应含 cache 子字段，断言 inputTokens 累加正确
- [ ] 3.5 跑 `npx vitest run tests/auth/cli-proxy-token-extraction.test.ts tests/core/llm-client-token-extraction.test.ts` 确认通过
- [ ] 3.6 跑 `npx vitest run` 确认零新增失败
- [ ] 3.7 commit + push: `fix(134): cli-proxy + llm-client input 累加 cache_creation/cache_read 子字段`

## T4：偏差 3 — reading 模式 model override（方向 A）

- [ ] 4.1 改 `src/batch/batch-orchestrator.ts:657-658` — modelOverride 追加 `effectiveMode !== 'full'` 条件
- [ ] 4.2 注释更新："reading/code-only 模式强制 sonnet override（Fix 134 P0-3：保证 SC-001 < 120s）"
- [ ] 4.3 新增测试 `tests/batch/batch-orchestrator-reading-mode.test.ts`
  - 测试 reading 模式 modelOverride === sonnet
  - 测试 code-only 模式 modelOverride === sonnet
  - 测试 full 模式且非小模块且无 budget 降级时 modelOverride === undefined
  - 注：通过提取 helper 函数 `decideModelOverride(effectiveMode, isSmallModule, budgetCheaperModelAll, sonnetModelId)` 让逻辑可测试
- [ ] 4.4 跑 `npx vitest run` 确认零新增失败
- [ ] 4.5 commit + push: `fix(134): reading/code-only 模式强制 sonnet model override（SC-001 < 120s）`

## T5：CHANGELOG 更新

- [ ] 5.1 在 `CHANGELOG.md` 顶部 Unreleased 区域添加 Fix 134 条目，列出 4 个偏差修复点
- [ ] 5.2 commit + push: `docs(134): CHANGELOG 列出 Fix 134 修复点（4 偏差）`

## T6：端到端 3 场景验证（在 graphify 示例项目）

- [ ] 6.1 准备 graphify 示例项目路径（询问用户或使用项目内预置路径）
- [ ] 6.2 场景 1：默认 batch（修偏差 1+2 后）
  - `rm -rf specs && spectra batch .`
  - 验证 spec frontmatter `llmModel: "claude-sonnet-4-6"`，`tokenUsage.input > 1000`
- [ ] 6.3 场景 2：reading 模式（修偏差 3 后）
  - `rm -rf specs && spectra batch --mode reading .`
  - 验证总耗时 < 120s
- [ ] 6.4 场景 3：CLI --hyperedges flag 可见（修偏差 4 后）
  - `spectra batch --help | grep -- "--hyperedges"`
  - 验证能看到该 flag
- [ ] 6.5 验证报告写入 `specs/134-phase2-followup/verification/verification-report.md`

## T7：交付到 master（rebase + 等待用户授权 push）

- [ ] 7.1 `git fetch origin master:master`
- [ ] 7.2 `git rebase master`（解决冲突如有）
- [ ] 7.3 `npx vitest run` + `npm run build` + `npm run repo:check` 零失败
- [ ] 7.4 报告用户等待明确授权
- [ ] 7.5 用户授权后：`git checkout master && git merge --ff-only 134-phase2-followup && git push origin master`
- [ ] 7.6 删除本地和远端 fix 分支：`git branch -d 134-phase2-followup && git push origin --delete 134-phase2-followup`

## 总预估

- T1: 2 分钟（yaml 编辑）
- T2: 3 分钟（一行 + 验证）
- T3: 30-45 分钟（双文件改 + 双测试）
- T4: 20-30 分钟（一行改 + helper 重构 + 测试）
- T5: 5 分钟
- T6: 取决于真实 graphify 项目可达性 + API 调用耗时
- T7: 5-10 分钟（取决于 rebase 复杂度）

总计代码任务：~60-90 分钟（不含 E2E 验证 + push 等待授权）
