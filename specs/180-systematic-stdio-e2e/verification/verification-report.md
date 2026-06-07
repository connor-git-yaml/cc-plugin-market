# F180 — 系统性 stdio E2E 补齐：验证闭环报告

**Feature**: 180-systematic-stdio-e2e
**模式**: Story
**验证时间**: 2026-06-08
**总判定**: ✅ **PASS**（独立 verify 子代理判 CONDITIONAL-PASS，唯一条件项 SC-007 为 spec 原文明确接受的 HAS_LLM_E2E gate，不构成 FAIL）

---

## 1. 工具链验证证据

| 检查 | 命令 | 结果 |
|------|------|------|
| 全量单测零回归 | `npx vitest run` | **4153 passed / 16 skipped / 20 todo / 0 failed**（baseline 4113 + F180 净增 40，−4 HAS_LLM_E2E skip）|
| 类型检查 | `npm run build` (tsc) | 零错误 |
| 仓库同步校验 | `npm run repo:check` | status=pass（全部 47 项 pass）|
| F180 隔离跑 | `npx vitest run tests/e2e/feature-180-*.e2e.test.ts` | 40 passed / 4 skipped |

> 注：一次性连续多跑全量套件曾出现 8 个 batch/LLM 测试因 `[jury] rate limit` 级联失败（含 cli-e2e/batch-*/perf-threshold/community-analysis），与 F180 无逻辑关联（F180 纯新增测试文件，不改任何被测逻辑）；暂停 100s 待配额恢复后全量复跑回到 0 failed，确认为环境性 LLM 限流，非回归。

## 2. 12 项 scope traceability（全部实质覆盖，无悬空）

| # | scope（M7 §2）| 文件 | 用例 |
|---|------|------|------|
| 1 | graph 6 工具 schema 漂移 | feature-180-graph-tools | T-003-4..9 |
| 2 | 跨工具 symbolId 链 | feature-180-symbol-chain | T-004-1..4 |
| 3 | symlink 越界 | feature-180-symlink-security | T-005-1/2 |
| 4 | F177 telemetry 落盘 | feature-180-telemetry | T-006-1/2/3 |
| 5 | server 5 工具 envelope + graph-query-failed | feature-180-error-envelope | T-007-1..6 |
| 6 | panoramic 4 operation | feature-180-panoramic-ns | T-008-1..4 |
| 7 | file-nav 3 工具 | feature-180-file-nav-stdio | T-009-1..6 |
| 8 | listTools exact names（17）| feature-180-graph-tools | T-003-1..3 |
| 9 | batch regen 轴 | feature-180-batch-repro | T-010-1/2/3 |
| 10 | namespace 前缀边界 | feature-180-panoramic-ns | T-008-5 |
| 11 | F174 fuzzy stdio | feature-180-symbol-chain | T-004-5/6, T-011-1/2 |
| 12 | full batch reproducibility | feature-180-batch-repro | T-010-4/5 |

**FR-001..018 全覆盖；FR-018（零 src/ 改动）实证 `git diff --stat 989bf9b -- src/` 为空。**

## 3. 假绿复查（5 关键用例，独立 verify 确认强断言）

- T-006-1 telemetry：`lines.length === 1` 强不变量 + 反向断言 errorCode undefined
- T-007-6 graph-query-failed：精确 `toBe('graph-query-failed')`，malformed-but-loadable fixture
- T-004-4 / T-009-2 view_file round-trip：patch lineRange 45/60，断 startLine/endLine 精确相等（非巧合）；T-009-1 逐行内容比对
- T-010-3 batch enum：双侧约束（必须 -32602/invalid_enum_value + 反向排除业务 {code}）
- T-003-1 listTools：`toEqual` 17 名完整排序数组

## 4. SC 达成

SC-001~006、SC-008 全部达成；SC-007（reproducibility byte-stable）为 HAS_LLM_E2E gate 条件达成（spec 原文：keyless CI skip 不算 fail）。

## 5. 4 轮 Codex 对抗审查处置汇总

| 阶段 | critical | warning | 处置 |
|------|----------|---------|------|
| Specify | 2 | 6 | 全修（detect_changes 结构 / batch 双轴 / graph-query-failed 触发 / durationMs / search_in_file / architecture-ir / exact names / typo fuzzy）|
| Plan/Tasks | 3 | 4 | 全修（lineRange patch / 绝对路径 path-outside-root / component symbol / graph_query.question / diff header / batch LLM gate / telemetry spawn）|
| Implement | 5 | 4 | 全修（graph 工具 isError 断言 / telemetry env 清空 / panoramic 强断字段 / view_file 内容比对 / batch enum SDK 拒绝 / 脱敏正则 / fuzzy auto-resolve / 越界强断）|

## 6. 残留风险（push 后可选跟进，均低）

1. ✅ 已修：`docs/design/M7-stepback-revision-2.md` §2 #8「18」→「17」（本次随 verify 一并更正）
2. HAS_LLM_E2E gate 的 4 个 batch 用例在 keyless CI 永远 skip → 建议把 `HAS_LLM_E2E=1 npx vitest run tests/e2e/feature-180-batch-repro` 写入「动 batch/graph 管道后」checklist（spec 已接受，不阻断）
3. dist staleness guard 缺失（spec EC-7 已知局限，build-before-test 为约定，mtime guard 在 worktree/fsevents 下易 flaky 故未加）
