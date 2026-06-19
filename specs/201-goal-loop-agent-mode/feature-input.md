# Feature 201 — goal_loop agent_mode（原始需求输入）

## 目标

把 Goal 自主迭代融入 spec-driver 编排：新增 `goal_loop` agent_mode（MVP pilot 在单一 mode），用可执行验收测试集驱动 implement→verify 闭环。

## 背景（M9 开篇 / tests-as-spec 候选）

spec-driver 的 implement→verify 已是"单次版 Goal loop"，把它拧成可迭代闭环即可。TDAD 实证：自主 TDD 必须有结构化 impact 上下文才不退化（回归 6%→10%），Spectra graph 恰好提供此上下文——强协同。

## 已 verify 的现有钩子（行号实查）

- `plugins/spec-driver/config/orchestration.yaml`：`GATE_IMPLEMENT_MID`(implementation_checkpoint, after_task_50%, :84) + `GATE_VERIFY`(verification_checkpoint, 全 mode, always/critical, :96)
- refactor mode Phase 3 已有 `agent_mode: batch_loop`（orchestration.yaml:744，声明性标签 + 循环逻辑在 refactor SKILL.md）——goal_loop 完全复用此落地范式
- `agent_mode` 枚举定义在 `plugins/spec-driver/contracts/orchestration-schema.mjs`（含 batch_loop, ~:121）
- `agents/verify.md`：Layer 2 已实跑 build/lint/test（现成 metric）+ Layer 1.5 证据检查（COMPLIANT/EVIDENCE_MISSING/PARTIAL，现成反 reward-hacking 原语）
- F191 已把 KB 预查注入接到 specify 前（同 hook 可注入 Spectra impact）
- `autoresearch` skill = Goal loop driver（modify→verify→keep/discard，支持 bounded Iterations:N）

## 需求（MVP pilot，scope 收窄）

1. 新增 `goal_loop` agent_mode（orchestration.yaml 声明 + SKILL.md 循环逻辑，平行于 batch_loop）：wrap implement↔verify，metric = 任务可执行验收（verify Layer 2 全绿 + Layer 1 Spec-Code 对齐），未达标且有预算则迭代，达标/预算尽/N 轮无进展则停
2. pilot 仅 1 个 mode（plan 阶段选定，建议 refactor 先行——metric="行为不变"最难 reward-hack 且已有 batch_loop；fix 次之——red→green 最清晰）
3. Spectra impact 作为 loop 上下文注入（复用 F191 注入 hook 泛化）
4. keep/discard 用 git 原子回滚（autoresearch:fix 已是失败自动回滚）
5. bounding：max_iterations 上限 + N 轮无进展 fallback 到人工
6. opt-in：经 `orchestration-overrides.yaml` 做 per-mode agent_mode 覆盖（不动 base，渐进采纳）

## 回归护栏 / 边界（诚实）

- goal_loop 只融入 implement 阶段，不碰 research/design/spec；feature/story 整体不自动化
- GATE_VERIFY 人工终局 gate 不变（critical/always）；GATE_IMPLEMENT_MID + 每 phase Codex 对抗审查 + verify Layer 1.5 全部保留为护栏
- reward hacking / 测试过拟合 / 长程局部最优是真实残留风险 → 文档化 + 依赖 Codex 对抗审查 + 人工 gate 兜底，不 over-claim "全自动安全"
- 不破坏现有 8 mode 行为（goal_loop 是新增 opt-in，default 不启用）；batch_loop 不回归
- 本身是 spec-driver 产品变更 → 全程走 spec-driver 流程，不直接改源码绕过

## 验收

- pilot mode 下给一个有界任务 + 可执行验收测试集（红），goal_loop 自主迭代到测试转绿 + 全量不回归，人工 gate 收口；对照手工驱动记录收敛轮数/成本
- max_iterations / 无进展 fallback 实测触发；regression 触发 git 原子回滚
- opt-in：未配 override 时所有 mode 行为不变（默认 off 实测）
- plugins/spec-driver/ 改动必经 Codex 对抗审查；TDD + 全量 vitest/build/repo:check 零失败

## 范围 / 不做

- 仅 1 mode pilot + opt-in；多 mode 推广、自动 metric 推断、跨 feature 编排 loop 留后续
- 不动评测/KB；不碰 GATE_VERIFY 人工语义

## 工程约定

- feature 编号 201-goal-loop-agent-mode；显式路径提交禁 git add -A；specs/src.spec.md 排除
- 独立 worktree 跑；基线 ≥ 7958567（已确认 = origin/master）
