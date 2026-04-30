# Feature 143 — Verification Report

**Branch**: `feature/143-large-project-e2e-baseline`  
**Date**: 2026-04-30  
**Spec**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md) | **Tasks**: [../tasks.md](../tasks.md)

---

## 1. 交付现状

本 Feature 在当前 sandbox 环境完成 **Phase 0（infrastructure skeleton）+ Phase 3（CI workflow 模板）**；**Phase 1 / Phase 2（实际 baseline 数据采集）需要用户在配置好 ANTHROPIC_API_KEY + 网络可访问 GitHub 的环境授权后跑**，原因是：

| 障碍 | 说明 |
|------|------|
| API Key | sandbox 不持有 ANTHROPIC_API_KEY；Wave 1 跑 micrograd / self-dogfood / continue 都需要真实 LLM 调用 |
| 网络 | git clone Continue / khoj 需要 ~700MB 下载 |
| 时间预算 | Continue full mode 预估 30-60 分钟；khoj 20-40 分钟；本会话不应阻塞用户 |
| 成本预算 | Wave 1 + Wave 2 总成本估算 $1.5-3.0；超出"测试基础设施"自治授权范围（参考"不要把一次授权当成长期授权"原则）|

**Infrastructure 已就绪**，用户授权后可一键跑：

```bash
# 单 target
npm run baseline:collect -- --target self-dogfood --mode full

# 多 target（CI 友好）
npm run baseline:collect -- --targets karpathy/micrograd,self-dogfood --mode full

# 验收 SC-001
npm run baseline:collect -- --verify-artifacts
```

---

## 2. Phase 进度

| Phase | 状态 | Commit | 说明 |
|-------|------|--------|------|
| Plan | ✅ 完成 | b4dbd7a | plan.md（492 行）+ Codex critical 4 条全部修复 |
| Tasks | ✅ 完成 | 3c8fccf | tasks.md（353 行）按 Phase 0-3 + Verification 拆分 |
| Phase 0 | ✅ 完成 | 5b19c78 | collector + diff + 38 单测 + 报告骨架 + Codex critical 5 条全部修复 |
| Phase 1 | ⏸ 待用户授权 | — | 需 ANTHROPIC_API_KEY + git clone + cost 预算 |
| Phase 2 | ⏸ 待用户授权 | — | 同 Phase 1 + 重跑 reproducibility 验证 |
| Phase 3 | ✅ 完成 | 65b5079 | CI workflow_dispatch 模板（不绑 cron）|
| Verification | ✅ 本文件 | （即将 commit） | infrastructure ready，SC 验收映射见 §4 |

---

## 3. 自动化校验结果

### 3.1 单元测试

```bash
$ npx vitest run
Test Files  237 passed | 1 skipped (238)
Tests       2339 passed | 1 skipped (2340)
Duration    ~26s
```

新增 38 个 baseline 测试（[tests/unit/baseline-collect.test.ts](../../../tests/unit/baseline-collect.test.ts) + [tests/unit/baseline-diff.test.ts](../../../tests/unit/baseline-diff.test.ts)）全绿，覆盖：
- collector：parseArgs / parseTargetFiles / parseBatchSummary / findLatestBatchSummary / parseGraph / parseLlmCalls / parseTimeStderr / verifyArtifacts（含 SC-001 ≥500 文件、commit 字段、null 字段、schema mismatch 全部失败路径）
- diff：parseArgs / regression 三档 / reproducibility / schema compat / na severity / 0 分母处理

### 3.2 类型检查 + Build

```bash
$ npm run build
> spectra-cli@4.1.0 prebuild → tsx scripts/inline-d3.ts
> spectra-cli@4.1.0 build → tsc
（零错误）
```

### 3.3 仓库同步链路

```bash
$ npm run repo:check
[repo-check] status=pass
（41 个检查项全绿，包括 release-contract / spec-driver-wrappers / runtime-boundaries 等）
```

### 3.4 文档骨架完整性

| 文件 | 行数 | 必含章节 grep |
|------|------|--------------|
| [perf-baseline-report.md](../perf-baseline-report.md) | 117 | ✅ "总耗时" / "P95" / "项目概况" / "dry-run 偏差" |
| [bottleneck-analysis.md](../bottleneck-analysis.md) | 92 | ✅ "F145" / "F146" / "瓶颈排行" / "并发数建议" |

---

## 4. SC 验收映射（按 spec.md §3）

| SC | 标准 | 当前状态 | 后续路径 |
|----|------|---------|---------|
| SC-001 | 2 个项目各完成至少 1 次完整 full-mode batch | ❌ infrastructure ready / 数据待跑 | Phase 1（continue full） + Phase 2（khoj full）；跑完后 `npm run baseline:collect -- --verify-artifacts` 自验 |
| SC-002 | perf-baseline-report.md 包含 §5.1 所有数据维度 | ⚠ 章节齐全 / 数据 placeholder | Phase 1 完成后填入 fixture 真实数字 |
| SC-003 | bottleneck-analysis.md 列出按影响排序的 ≥3 个瓶颈 | ⚠ 章节齐全 / 数据 placeholder | Phase 1 完成后基于 fixture phases 段填入 |
| SC-004 | 基线数据中 LLM 耗时占比 / graph 规模 / token 总量有具体数字 | ⏸ 待 Phase 1 | Phase 1 commit 守卫含 `grep -E "(约\|估计\|大约)" \| grep -v estimatedTokens` 自动校验 |
| SC-005 | 对 F145 的"并发数建议"有明确结论 | ⚠ 章节齐全 / 结论 placeholder | Phase 1 完成后基于 fixture llmCallDurationsMs / phases 算 |

---

## 5. Codex Adversarial Review 应用记录

设计阶段（plan）和实现阶段（Phase 0）各跑一次 codex adversarial review，应用了：

### Plan 阶段（4 critical / 4 warning / 2 info）

- C1 schema 补 fileCountsByType / locEstimate / spectraModuleCount / dryRun.* / memoryPeakKb / command / args / envAllowlist / outputDir
- C2 D4 明确 collector 解析 stdout/stderr log + /usr/bin/time 的字段映射
- C3 §10 阶段守卫：Phase 0 commit 不标 SC-002/SC-003 PASS
- C4 §10.2 SC-001 本地验证命令（不依赖 CI）
- W1 schemaVersion + quality placeholder 升级路径明确化（F140 回填 → 1.1 + --ignore-quality）
- W2 拆 reproducibility gate（同 commit < 5%）vs regression diff（跨 commit ±10/20%）
- W3 Wave 1 标注 SC-001 完整满足需 Wave 2 补 khoj
- W4 §5.3 meta 加 command / args / envAllowlist

### Phase 0 实现阶段（5 critical / 4 warning / 2 info）

- C1 spawn ENOBUFS 检查 + maxBuffer 调到 256MB
- C2 git --depth 50 fallback：commit 不在 shallow 历史时 fetch --depth 1 origin <commit> 再 checkout
- C3 verifyArtifacts 检查 targetFileCountsByType ≥ 500 + targetCommit 非空
- C4 diff 0 分母处理（0→0 green / 0→非0 red / null→null na）
- C5 parseLlmCalls 改正则匹配实际 stderr 格式 `[<mod>] ... | LLM#1: 12.3s | ...`，传 stderr
- W1 collector 加 --targets 多 target 支持
- W3 formatText 在非 TTY / NO_COLOR 时不输出 ANSI 颜色
- W4 fixture meta 新增 stdoutLogPath / stderrLogPath

I1（git submodule .git 文件检测）和 I2（diff 单测 mock 完整性）作为 follow-up，不阻塞 Phase 0。

---

## 6. 已知偏差与后续跟进

| 项 | 说明 | 跟进 |
|----|------|------|
| `phases.*` 字段始终 null（schemaVersion 1.0）| batch-orchestrator 没有稳定的 phase 边界 marker | F140 工作的一部分；schemaVersion 1.0 容忍此情况，标 `extractionMethod: "unavailable"` |
| `perf.tokensCacheRead` 始终 null | batch-summary.md 当前不输出 cache_read 字段 | 待 batch-orchestrator 加输出后回填，schemaVersion 1.0 容忍 |
| 无 self-dogfood / micrograd 真实 fixture | 需 ANTHROPIC_API_KEY | Phase 1 第一批落地 |
| 单测覆盖率不计 scripts/ 内 collector / diff | vitest coverage include 是 src/**/*.ts | 已通过 38 个单测覆盖 collector 和 diff 的关键解析路径，覆盖率门槛适用范围未变 |

---

## 7. 推荐用户下一步

按优先级：

1. **不实跑 Phase 1/2，直接交付 infrastructure**：当前 4 个 commit（plan / tasks / Phase 0 / Phase 3）足以构成"baseline infrastructure ready"的完整交付。后续在用户认为合适时通过 GitHub Actions `workflow_dispatch` 或本地 `npm run baseline:collect` 触发实跑。
2. **本地实跑 Wave 1**：用户在配置好 ANTHROPIC_API_KEY 的本地环境执行：
   ```bash
   npm run baseline:collect -- --target self-dogfood --mode full     # ~5 min, ~$0.05
   npm run baseline:collect -- --target karpathy/micrograd --mode full  # ~3 min, ~$0.02
   npm run baseline:collect -- --target continuedev/continue --mode full --commit v0.9.245  # ~30-60 min, ~$1-2
   ```
   跑完后回填 perf-baseline-report.md / bottleneck-analysis.md 并补 Phase 1 commit。
3. **CI 触发**：用户在 GitHub UI 中 Actions → Baseline Collection → Run workflow，输入 targets / mode / commit。

---

## 8. Push 守卫

按 [CLAUDE.md](../../../CLAUDE.md) "交付到 master" 约定：

```bash
git fetch origin master:master
git rebase master
npx vitest run && npm run build && npm run repo:check
# 等待用户明确授权再 push origin master
```

**当前状态**：本 verification commit 之后即可 rebase，但 push 必须由用户明确授权。

---

*Verification report 由主线程（Opus 4.7）于 2026-04-30 生成。*
