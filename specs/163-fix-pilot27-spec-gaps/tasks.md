---
feature_id: 163
phase: tasks
mode: fix
status: completed
generated_at: 2026-05-15
---

# Feature 163 — Fix Tasks

## T163-1 [P1] plan.md 新增 §0.4 启动前置 section

- **文件**: `specs/162-codex-driver-glm-judge-eval/plan.md`
- **改动**: 在 §0.3 之后插入 §0.4，含 3 个 step（clone / build / plugin update）
- **验收**: §0.4 文本存在，3 个命令可独立执行
- **LOC**: ~25 行
- **时长**: 10 min

## T163-2 [P1] clone-swe-bench-upstream.sh 幂等校验升级

- **文件**: `scripts/baselines/clone-swe-bench-upstream.sh`
- **改动**: clone_repo() 函数内，在 dir 存在分支中加：
  1. `.git/config` 不可读 → rm -rf + 重 clone
  2. `git remote get-url origin` 不匹配期望 URL → warn + 跳过
- **验收**: 重跑脚本对已存在 clone → 秒级跳过，exit 0；对中断残留 → 自动 rm 重 clone
- **LOC**: ~15 行
- **时长**: 15 min

## T163-3 [P1] npm run build + Pilot 27 重跑（全 27 runs）

- **前置**: T163-1, T163-2
- **步骤**:
  1. `npm run build` → 确认 dist/cli/index.js 存在
  2. 确认 `~/.spectra-baselines/pytest|astropy|sympy` 存在（已有）
  3. 重跑 pilot-27-batch.sh（A+B+C 各 9 runs）
  4. 跑 scripts/pilot-27-analyze.mjs → 更新 pilot-27-analysis.json
  5. 填入 §10.2 pass rate 矩阵 + §10.5.5 error.phase 分布更新
- **验收**: Cohort C prepareWorktree 成功率 ≥ 80%
- **时长**: 2.5-4.5h（LLM 等待）

## T163-4 [P2] vitest 全量验证

- **改动**: 跑 `npx vitest run` 确认零失败
- **验收**: 3626+ tests all pass
- **时长**: 5 min
