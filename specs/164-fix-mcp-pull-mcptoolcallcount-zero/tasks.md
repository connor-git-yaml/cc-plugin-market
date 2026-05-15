# 修复任务列表 — Feature 164

## T1 [DONE] 代码修复
- [x] 修改 `scripts/eval-mcp-augmented.mjs` `buildGroupCPrompt`（L533-550）
  - export 函数（供测试导入）
  - 改首个强制工具：`context`（需 symbolId）→ `detect_changes`（只需 baseRef）
  - 明确步骤序列 + graph-not-built 错误处理指导

## T2 [TODO] 单元测试
- [ ] 新建 `tests/unit/eval-mcp-augmented-prompt.test.ts`
  - 验证 `buildGroupCPrompt` 返回 prompt 包含 `mcp__spectra__detect_changes`
  - 验证包含 `"HEAD~1"` 参数提示
  - 验证包含 `graph-not-built` 错误处理提示

## T3 [TODO] vitest + build 验证
- [ ] `npx vitest run` 零失败
- [ ] `npm run build` 零错误
- [ ] `npm run repo:check` pass

## T4 [TODO] Codex 对抗审查
- [ ] 通过 Agent codex:codex-rescue 子代理进行对抗性审查

## T5 [TODO] C cohort 9 runs 重跑验证
- [ ] 确认 dist/cli/index.js 最新
- [ ] 运行 C cohort pilot：`bash scripts/pilot-27-batch.sh`（或单独跑 C cohort）
- [ ] 验证 mcpToolCallCount > 0 ≥ 5/9 runs
- [ ] 更新 competitive-evaluation-report.md §10.4

## T6 [TODO] 更新文档
- [ ] 更新 §10.4 战略结论 line 616-625（填入 C cohort 重跑实测数据）
