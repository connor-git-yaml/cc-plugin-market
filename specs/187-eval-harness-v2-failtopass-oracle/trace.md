# Trace — F187 评测设施 v2（FAIL_TO_PASS oracle）

特性分支: claude/nostalgic-curie-ab8ca4（worktree 集成分支）
模式: feature（动态编排，17 phase）
基线: origin/master 含 F183(ac43c0c)+F196(49dd490) ✓

## Gate 配置（feature mode）
- GATE_RESEARCH: auto
- GATE_DESIGN: always / HARD GATE(critical) → 必停
- GATE_ANALYSIS: on_failure
- GATE_TASKS: always(critical)
- GATE_IMPLEMENT_MID: on_failure
- GATE_VERIFY: always(critical)

## 关键环境约束（已 verify）
- docker 可用 v29.2.1；conda 不可用；python 3.14.3
- host arch = arm64（Apple Silicon）；SWE-Bench 官方镜像为 x86_64 → 仿真问题是 plan 选型关键
- swebenchMeta 四字段齐全（failToPass[]/passToPass[]/goldPatch/testPatch），importer 零改动确认
- fixtures: tests/baseline/swe-bench-lite/fixtures/ (10 个 SWE-L)

## Phase 进度
[1b] tech_research: COMPLETED | model=sonnet | 制品=research/tech-research.md | 推荐=混合(官方swebench harness+Epoch arm64镜像为主, 轻量自建回退)
[GATE_RESEARCH] AUTO_CONTINUE | policy=auto
[2] specify: STARTED | model=sonnet
[2] specify: COMPLETED | model=sonnet | 制品=spec.md | 12 FR / 10 SC / 12 EdgeCase / 复杂度=HIGH
[3] clarify+checklist: COMPLETED [并行] | 3 歧义全 auto-resolved(oracleSpecHash→选项A) | checklist 15PASS/2GAP(仅遗留澄清标记)/1RISK
[design-codex] codex adversarial review of spec.md: STARTED (background) | 重点=三分类反向污染/freezeBlock 绕过/cleanup 竞态
[GATE_DESIGN] HARD GATE — 等 codex 返回后向用户呈报，必停
[GATE_DESIGN] PAUSE→APPROVED | HARD GATE | 用户裁决 Q1=分阶段判定 / Q2=冻结oracle语义
[design-codex] codex review: COMPLETED | 4 CRITICAL+4 WARNING+1 INFO 全部认定真实，spec 已修订落实
[2-rev] specify(修订): COMPLETED | spec.md 重写 — 穷尽式决策表14行/failureSource分阶段归因/候选patch合同/语义冻结/可执行护栏/16 SC
