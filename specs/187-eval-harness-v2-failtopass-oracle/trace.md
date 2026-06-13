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

## Plan 阶段输入（主线实测）
[empirical] arm64 镜像可用性：10/10 SWE-L fixture 全部命中 Epoch AI arm64 原生镜像
  命名约定：ghcr.io/epoch-research/swe-bench.eval.arm64.<instanceId>（__ 保留，非 _1776_）
  实例：pytest-11148/11143, astropy-14995/14365/14182, sympy-24909/24213/24152/24102/24066 全 ✅
  → 自测 smoke 全程 arm64 native，无需 Rosetta；Rosetta 回退降为 F188 规模的次要关切
[3] plan: STARTED | model=sonnet
[4] plan: COMPLETED | model=sonnet | 制品=plan.md+research.md+data-model.md+quickstart.md | 10 决策 + 4 Phase 实施序列 | 风险=MEDIUM
[plan-codex] codex adversarial review of plan: STARTED (background) | 重点=F176旧测固化bug/oracleSpecHash漏覆盖swebench-oracle.mjs打点逻辑/marker缺失反向污染/本地JSONL塌方
[主线核查] F176 feature-176-batch.test.ts:54-78 确认断言旧语义(timedOut→unavailable,line68)，与 Q1 矛盾；但 classifyOracle(旧) 与 classifySwebenchResult(新) 是两个函数 → 需锁定"排名用新分类器，旧降级 secondary"
[plan-codex] codex review(foreground 重试成功): COMPLETED | 6 CRITICAL 全认定真实 + 代码核验(runPrimaryOracle sync/7调用方/:289 error漏判/:741截断)
[4-rev] plan(修订): COMPLETED | spawnSync 收敛 C-5/C-6；Phase0 数据源 hard gate(C-4)；ranking classifier(C-1)；oracleSpecHash 覆盖3语义模块(C-2)；evidence-based marker(C-3)
[plan commit] 准备提交 plan 阶段
[5] tasks: COMPLETED | model=sonnet | 制品=tasks.md | 35 任务(Phase0×3 BLOCKING/A×11/B×4/C×9/D×8) | FR 100% + Codex CRITICAL 6/6 落地映射
[tasks-review] 目视审查（纯 markdown 制品，按 CLAUDE.local.md"纯文档可简化"条款；TDD配对/依赖链/覆盖全核验通过）
[GATE_TASKS] always/critical → PAUSE 呈报用户（FR-006 范围 + 实施推进方式）
[GATE_TASKS] APPROVED | 用户裁决: FR-006 一起做掉 / 全程自主推进(Phase0→D，最终 verify 汇报)
[6] implement: STARTED (主线驱动 Phase 0 真实执行 gate)
[Phase0] GATE PASSED ✓ | 真跑 run_evaluation 42s/resolved=1 | 方案A(本地JSONL)确认 | x86_64镜像+Rosetta透明运行无QEMU退化 | W1 10/10字段match官方 | 制品=verification/phase0-gate-result.md
[PhaseA-core] classify-oracle.mjs(14行决策表+ranking) + phase-markers.mjs(evidence-based) + oracle-pipeline 集成测试 | 47 tests pass | C-1/C-3/C-6 核心落地
[PhaseA-complete] cohort-registry.mjs(委托 buildDriverPrompt 逐字一致+golden) + preregistration 扩展(oracleSpecHash 覆盖3语义模块+checkPreregistration swebench-execution门禁) | F187 共 59 默认测试 + F176 零回归(156 pass)
[PhaseB-core] swebench-dataset-build.mjs(W1逐字段校验+emit) + swebench_fetch_rows.py + swebench-oracle.mjs(spawnSync同步/predictions候选patch/report解析/SIGSEGV重试/容器清理) | 真实 smoke 验证：goldPatch→pass, 空patch→fail/candidate, 环境信号→error
[剩余] T017 runner 接入 + Phase C(cohort-batch迁移/manifest/jury/重冻结) + Phase D(护栏+全量验证) + 完整 codex 复审
