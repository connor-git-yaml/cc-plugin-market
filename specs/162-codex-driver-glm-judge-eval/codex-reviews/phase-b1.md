# Codex 对抗审查 — Phase: B1 (DEFAULT_JUDGES 替换 + calibration-fixture-list)

> Feature: 162
> Reviewed at: 2026-05-10
> Subagent: codex:codex-rescue
> Final status: ✅ 与 Phase A iter-2/iter-3 合并审查后清零（详见 phase-a.md）

## 关联

Phase B1 与 Phase A 并行实施（plan §2.5 B1 + tasks T031-T034），合并入 Phase A iter-2 修复批次（解决 C-1 默认配置自启 self-judge hard-fail）。完整审查历史和 finding 处置见 `phase-a.md`。

## B1 落地证据

### T031 — DEFAULT_JUDGES 替换

文件：`scripts/eval-judge-jury.mjs:88`

```js
const DEFAULT_JUDGES = [
  'claude-cli:claude-opus-4-7',
  'siliconflow:Pro/zai-org/GLM-5.1',
  'siliconflow:Pro/moonshotai/Kimi-K2.6'
];
```

替换前 codex:gpt-5.5 已被移出 jury。

### T032 — self-judge 禁忌注释

文件：`scripts/eval-judge-jury.mjs:81-86`

注释内容覆盖：
- driver=codex:gpt-5.5 时 jury 不得含 GPT-5.5（self-judge 禁忌）
- 引用 FR-020 / FR-021 + plan §2.5 B1
- 提示 calibration 验证 IoU≥0.7 + Pearson≥0.6

### T033 — calibration-fixture-list.json

文件：`specs/162-codex-driver-glm-judge-eval/calibration-fixture-list.json`

5 frozen ids（plan §0.1 + iter-2 codex T033 修订）：

| id | label | task_type | expected_outcome | runs_per_fixture |
|----|-------|-----------|------------------|------------------|
| SWE-L001 | bug-fix-trivial | bug-fix | pass | 3 |
| SWE-L003 | refactor-medium | refactor | pass | 3 |
| SWE-L005 | feature-add-medium | feature-add | pass | 3 |
| SWE-L007 | refusal-test | refusal-test | refusal | 3 |
| SWE-L009 | cross-file-fail | cross-file | fail | 3 |

stratification_summary：`{ pass: 3, fail: 1, refusal: 1 }`，覆盖 plan §0.1 / FR-022 分层抽样要求。

总数据点 = 5 × 3 = 15（plan iter-2 W-3 决议：n < 15 不视为有效 calibration）。

### T034 — vitest 验证

```
命令: npx vitest run tests/unit/eval-llm-backend-dispatcher.test.ts tests/unit/eval-self-judge-hard-fail.test.ts
退出码: 0
输出摘要: Test Files 2 passed (2) | Tests 23 passed (23) | Duration 4.19s
```

无回归，与 Phase A 同样验证基线。

## Phase B2 启动条件

B1 完成后，Phase B2（calibration 跑批）启动条件：
- ✅ DEFAULT_JUDGES 已替换，self-judge 禁忌注释存在
- ✅ calibration-fixture-list.json 已落地，5 frozen ids 含 fail/refusal 分层
- ⏭️ 用户准备 SiliconFlow API Key（GLM-5.1 + Kimi-K2.6 调用）
- ⏭️ 实现 `scripts/lib/pearson.mjs`（零依赖 Pearson correlation 计算 + SciPy 对比测试）
- ⏭️ 实现 `scripts/calibrate-glm-judge.mjs`（5 fixture × 3 runs = 15 数据点跑批 + IoU + Pearson + surface refusal 计算）
