# Feature 175 — Batch Incremental Wrapper · 编排 Trace

分支: claude/hardcore-mendeleev-ad8c9a（worktree）
模式: feature（完整编排，17 phases）
master HEAD: bb97d70 ✓

## 执行链路

- [init] 环境检查 PASS（NEEDS_CONSTITUTION=false, config exists）；git fetch HEAD=bb97d70 ✓
- [init] 编号核查：现有最高 170（170a-e），175 无冲突
- [init] 编排器 zod 解析：plugin cache 缺 zod → 改用 in-repo `plugins/spec-driver`（可解析项目 node_modules）
- [phase 0.5] research_mode = codebase-scan（内部 perf 特性，无产品/Web 调研）
- [phase 1b] tech_research/codebase-scan: 主编排器亲自核查 7 条架构主张 → research-synthesis.md（全部确认，"3次AST扫"修正为2次）
- [GATE_RESEARCH] auto → AUTO_CONTINUE
- [phase 2] specify: COMPLETED | spec.md（5 US / 15 FR / 7 SC / 6 EC）
- [phase 2] CODEX 对抗审查: 4 CRITICAL + 5 WARNING + 1 INFO → 全部真实，全部修复
    - C-001 FR-004 正交性 vs mode-aware cache 矛盾 → 拆"flag 解析正交"vs"mode 进 cache key"；FR-013 升 MUST
    - C-002 "无 LLM/全 mtime 不变"over-claim → FR-005/008/SC-002 限定模块级
    - C-003 byte-stable 仅剥 generatedAt 不足 → FR-006 覆盖 inputHash 嵌套时间戳
    - C-004 checkpoint 绕过 force → 新增 EC-007 + FR-016
    - W-001 传播验收同义反复 → FR-018 独立断言（diamond/cycle）
    - W-002 删除/重命名缺失 → EC-008 + FR-017 文件集收敛
    - W-003 绝对性能数 over-claim → SC-001/002 改 goal+相对门禁
    - W-004 排序须在写盘边界 → FR-007 writeKnowledgeGraph normalize
    - W-005 target 口径错位 → FR-019 共享 resolveRegenPlan
    - I-001 → OQ-1 标注 tasks 前必关闭；新增 OQ-5
    - 复杂度 MEDIUM → MEDIUM-HIGH（组件 6，含 BFS 信号）
    - 注：fix 后再审折叠进 GATE_DESIGN 前的统一 codex 复审
- [GATE_RESEARCH] auto → AUTO_CONTINUE
- [phase 3] clarify + checklist (DESIGN_PREP_GROUP 并行): COMPLETED
    - clarify: 0 CRITICAL；自动决议 FR-017 孤儿策略=删除（+Clarifications 段）
    - checklist: 初判 11/16 FAIL（全为"spec 混入实现细节"写作口径）→ 主线路径 A 闭合：加"平台基础设施约定"前言（[实现参考] + 双重验收口径）→ 16/16 实质达标
- [phase 3] CODEX 复审（fix 后 verification）: 8 CLOSED / 1 PARTIAL / 1 NEW
    - C-002 PARTIAL（US-2 narrative 与 SC-002 口径矛盾）→ 修：US-2 限定"模块级 LLM 调用"
    - N-001 NEW（FR-017 删除缺 ownership 边界，恐误删手写 spec）→ 修：FR-017 加 ownership 条款 + EC-009 + SC-007 用例
    - 其余 C-001/003/004 + W-001..005 + I-001 全 CLOSED
- [GATE_DESIGN] is_hard_gate=true → PAUSE → 用户 **通过，进入 plan**
    - OQ-1 决议：regen 全量逃生口 = 新增 `--full`（plan 收尾 --full/--force 边界 + help 措辞）
    - OQ-2 决议：MCP incremental 默认同步翻 true；评测需显式 --full（连 OQ-4）
- [phase 4] plan: COMPLETED | plan.md + research.md + data-model.md + contracts/ + quickstart.md
    - 风险 HIGH（默认翻转破坏性 + MCP 契约变更 + 6 包跨界）→ 强制分阶段 Phase0[CLEANUP]/RED/GREEN/REFACTOR
    - 核心决策：resolveRegenPlan（src/batch/regen-plan.ts 消三处漂移）；--full + --force 别名；normalizeGraphForWrite 写盘边界；baseline-collect 显式 --full
    - 主线收口核查：baseline-collect :761-762 跑前清 outputDir 属实 → 但改为显式 --full（防御 + 自文档）
- [phase 4] CODEX 对抗审查: 4 CRITICAL + 3 WARNING + 1 INFO → verdict 不可进 tasks
    - C-1 inputHash 用 count 替代 → cache 碰撞 → 改 SHA-256(剥 generatedAt 后内容)
    - C-2 config.full 不存在 + 9 字段 over-eng + CLI 合并在 batch.ts → 收窄扁平 3 字段，不改 project-config schema
    - C-3 checkpoint 伪代码不可达分支 + full 应清空非忽略 → 加载时 clear + target 前移
    - C-4 孤儿 ownership 论证与代码相反（getDefaultSourceKind=canonical）会误删手写 → generatedBy 设为删除必要条件
    - W-1(force 别名可观测性)/W-2(Phase0 不插调用点)/W-3(research↔plan baseline 矛盾)/I-1(index 导出) 全修
- [phase 4] CODEX 复审: 7 CLOSED + 1 PARTIAL(C-2 data-model/plan force 字段不一致) → 修齐 → CONDITIONAL PASS 条件已满足
- [GATE_ANALYSIS] on_failure → 见 analyze phase
- [phase 5] tasks: COMPLETED | tasks.md（39 task / 4 Phase / 19 FR 100%）
- [phase 5] CODEX 对抗审查: 6 CRITICAL + 3 WARNING + 1 INFO → verdict 不可进 implement
    - C1 T025 改错文件(spec-store→doc-graph-builder) / C2 ownership 用 generatedBy 误判(应 generatedByMode，generatedBy 所有 spec 都写) / C3 路径 startsWith 目录穿越(改 path.relative) / C4 help 漏 src/cli/index.ts / C5 T004↔T009 互斥断言 / C6 FR-012 伪覆盖(加场景9)
    - W1 mtime 无真实断言 / W2 T021 [P] 误标 / W3 硬编码 3859 → N_baseline 动态基线
    - C2 关键修正跨 4 制品传播：spec FR-017/EC-009 + plan + data-model + tasks 全改 generatedBy→generatedByMode
- [phase 5] CODEX 复审 + 跨制品一致性: 6 CRITICAL 全 CLOSED；查出 5 处多轮编辑残留（T025 并行说明文件名、T021 [P]、tasks:221 generatedBy、plan E2E 清单缺场景9、plan/spec 残留 3859）→ 全修
- [phase 5.5 analyze/GATE_ANALYSIS] on_failure：折叠进 codex 复审，跨 4 制品一致性 PASS（generatedByMode/RegenPlanInput/FR 覆盖/path.relative 全一致）
- [GATE_TASKS] behavior=always → **PAUSE 等用户确认**（设计制品全就绪：spec 19FR/9EC/7SC + plan + tasks 39task/4Phase + data-model + research + contracts；4 轮 codex 全闭合）
