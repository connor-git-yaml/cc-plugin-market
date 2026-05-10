# Feature 162 — Spec 合规审查报告

> Reviewed at: 2026-05-10
> Subagent: spec-driver:spec-review (Opus, quality-first preset)
> 4 个 commit: 62e1db7 (设计制品) / ca436cd (Phase 0) / 5d96c86 (Phase A + B1) / a98bde5 (Phase B2)
> Scope: spec.md 共 40 FR + 5 SC + 8 EC（FR-009/018/019/028/029 编号在 spec 中跳号，FR-039 YAGNI 移除，实际有效 FR = 33 条）

## 1. FR 实施核查表

| FR | 描述（简）| commit | 实施文件 | 状态 | 证据 |
|----|---------|--------|---------|------|------|
| FR-001 | plan.md frontmatter 加 mcp__spectra__context/impact | ca436cd | plugins/spec-driver/agents/plan.md | ✅ 已实施 | plan.md:3 含 `mcp__spectra__context, mcp__spectra__impact` |
| FR-002 | implement.md 同上 | ca436cd | plugins/spec-driver/agents/implement.md | ✅ 已实施 | implement.md:3 含两项 |
| FR-003 | verify.md 加 detect_changes/impact | ca436cd | plugins/spec-driver/agents/verify.md | ✅ 已实施 | verify.md:3 含两项 |
| FR-004 | quality-review.md 加 impact/context | ca436cd | plugins/spec-driver/agents/quality-review.md | ✅ 已实施 | quality-review.md:3 含两项 |
| FR-005 | spec-review.md 加 impact/context | ca436cd | plugins/spec-driver/agents/spec-review.md | ✅ 已实施 | spec-review.md:3 含两项 |
| FR-006 | repo:sync + release:check + plugin update | ca436cd | 仓内同步 + Test 3 文档 | ⚠️ 部分实施 | repo:sync/release:check ✅；`claude plugin update` 由用户在新 session 触发；Test 3 实测 cache 仍 4.0.0 |
| FR-007 | release-contract version 4.0.0→4.1.0 | ca436cd | contracts/release-contract.yaml:22 | ✅ 已实施 | grep `version: "4.1.0"` |
| FR-008 | Test 3 重测结果落盘 | ca436cd | specs/161-.../verification/sub-agent-mcp-test.md:121-171 | ✅ 已实施 | "Test 3" 章节存在 |
| FR-010 | callExecutor 4 backend dispatch | 5d96c86 | scripts/lib/llm-backend-dispatcher.mjs + scripts/eval-task-executor.mjs | ✅ 已实施 | dispatcher 实现 callBackend + 4 handler |
| FR-011 | DEFAULT_EXECUTOR_MODEL=codex:gpt-5.5 + SPECTRA_EVAL_EXECUTOR | 5d96c86 | scripts/eval-task-executor.mjs:42 | ✅ 已实施 | `process.env.SPECTRA_EVAL_EXECUTOR \|\| 'codex:gpt-5.5'` |
| FR-012 | reasoningEffort=medium | 5d96c86 | scripts/lib/llm-backend-dispatcher.mjs:560,565 | ✅ 已实施 | `reasoningEffort = options.reasoningEffort ?? 'medium'` |
| FR-013 | 共享 dispatcher 模块（迁移 parseJudgeBackend） | 5d96c86 | scripts/lib/llm-backend-dispatcher.mjs + eval-judge-jury.mjs:32 | ⚠️ 部分实施 | dispatcher 已建立 + self-judge 入口已统一；T016 标 [DONE-MINIMAL-VIABLE]：parseJudgeBackend + 4 client adapter 仍保留 jury 本地，完整迁移留独立 feature。tasks.md:324-330 显式裁决 |
| FR-014 | retry 决策矩阵 + classifyError | 5d96c86 | scripts/lib/llm-backend-dispatcher.mjs:140 | ✅ 已实施 | classifyError 实现，retry-matrix RM-1~RM-4 已纳入测试 |
| FR-015 | ≥8 vitest unit case (4 backend × 3 维度) | 5d96c86 | tests/unit/eval-llm-backend-dispatcher.test.ts | ✅ 已实施 | 12 case + 3 sanity = 15 case |
| FR-016 | llm-pricing.mjs 含 codex:gpt-5.5 | (前置已存在) | scripts/lib/llm-pricing.mjs:25 | ✅ 已实施 | 含 codex:gpt-5.5 价格条目 |
| FR-020 | DEFAULT_JUDGES 替换 codex→GLM-5.1 | 5d96c86 | scripts/eval-judge-jury.mjs:91-95 | ✅ 已实施 | [Opus, GLM-5.1, Kimi-K2.6] |
| FR-021 | self-judge 禁忌注释 | 5d96c86 | scripts/eval-judge-jury.mjs:84-90 | ✅ 已实施 | 含 self-judge 说明 + FR-020/021 引用 |
| FR-022 | 5-fixture calibration（IoU≥0.7）+ frozen list | a98bde5 | calibration-fixture-list.json + calibrate-glm-judge.mjs | ⚠️ 部分实施 | fixture-list ✅；runner ✅；T039 实跑 [DEFERRED-TO-API-KEY-AVAILABLE] |
| FR-023 | Pearson ≥ 0.6 + ≥15 数据点 + 零依赖 | a98bde5 | scripts/lib/pearson.mjs + tests/unit/eval-pearson.test.ts | ⚠️ 部分实施 | pearson.mjs + 5 SciPy 等价 case ✅；阈值校验路径 ✅；实测 [DEFERRED] |
| FR-024 | refusal IoU ≥ 0.5 | a98bde5 | scripts/calibrate-glm-judge.mjs (detectRefusal) | ⚠️ 部分实施 | detectRefusal ✅；实测 [DEFERRED] |
| FR-025 | 回退 2-judge fail-closed | a98bde5 | scripts/calibrate-glm-judge.mjs:651-680 | ⚠️ 部分实施 | extractFallbackFailClosedPassSet ✅；DEFAULT_JUDGES 热切换依赖人工触发 |
| FR-026 | rubric 微调零回归 | a98bde5 | tests/unit/eval-pearson.test.ts | ✅ 已实施 | 5 case pass，无回归 |
| FR-027 | self-judge hard-fail（normalize + 3 入口） | 5d96c86 | scripts/lib/llm-backend-dispatcher.mjs:110/711 + 3 入口 | ✅ 已实施 | normalizeModelId 5 步；assertNoSelfJudge 3 处；5 case pass |
| FR-030 | pilot batch 27 runs | — | 待执行 | ⏭️ DEFERRED | Phase C T050 |
| FR-031 | 单 run token 决策分批 | — | 待执行 | ⏭️ DEFERRED | Phase C T051 |
| FR-032 | --max-runs-per-day + quota state + O_EXCL lock + partial | — | 未实施 | ⏭️ DEFERRED | Phase C T043-T045 |
| FR-033 | 450 runs 全量跑 | — | 待执行 | ⏭️ DEFERRED | Phase C T052 |
| FR-034 | §10.2 Pass Rate 矩阵填实测 | — | 待执行 | ⏭️ DEFERRED | Phase C T055 |
| FR-035 | §10.3 Token Cost 实测 | — | 待执行 | ⏭️ DEFERRED | Phase C T056 |
| FR-036 | §10.4 战略结论 | — | 待执行 | ⏭️ DEFERRED | Phase C T056 |
| FR-037 | §10.5 章节 + inheritance_status 三状态 | — | 未实施 | ⏭️ DEFERRED | Phase C T053 |
| FR-038 | 每 Phase Codex 对抗审查 artifact | 全 commit | specs/162-.../codex-reviews/{specify,plan,tasks,phase-0,phase-a,phase-b1,phase-b2}.md | ✅ 已实施 | 7 artifact 落地，每份 critical=0 |
| FR-039 | usage cache 查询 | — | YAGNI 移除 | ⏭️ N/A | spec.md:239 |
| FR-040 | §10.1 + Feature 158 detail 同步 | — | 待执行 | ⏭️ DEFERRED | Phase C T054, T057 |

**有效 FR 计数**：33 条；FR-039 YAGNI N/A。

## 2. SC 满足度

| SC | 状态 | 说明 |
|----|------|------|
| SC-001 | ⚠️ 部分满足 | 5 frontmatter ✅；release:check ✅；4.1.0 ✅；vitest hot path 165/165 ✅；`claude plugin update` 步骤需用户手动；Test 3 当前 outcome=tool-not-available（cache 4.0.0），用户重装后重测 |
| SC-002 | ⚠️ 部分满足 | 4 backend ✅；self-judge 5 case ✅；25 fixture byte-stable [DEFERRED-TO-OPS] |
| SC-003 | ⚠️ 部分满足 | DEFAULT_JUDGES ✅；fixture-list ✅；self-judge 注释 ✅；calibration 实测 [DEFERRED-TO-API-KEY-AVAILABLE] |
| SC-004 | ⏭️ 未启动 | Phase C 整段未启动 |
| SC-005 | ✅ 已满足（设计阶段+0+A+B1+B2） | 7 份 codex review artifact，每份 critical=0；Phase C review 待 Phase C 完成追加 |

## 3. EC 处置

| EC | 状态 | 说明 |
|----|------|------|
| EC-001 | ✅ 处置已落地 | release:check 检测仓内不一致；Test 3 显式记录 cache vs worktree 差异 |
| EC-002 | ✅ 处置已落地 | classifyError 4 类 + retry-matrix RM-1~RM-4 测试覆盖 |
| EC-003 | ⚠️ 部分处置 | calibrate runner 含 fallback fail-closed pass set；热路径 DEFAULT_JUDGES 切换依赖人工 |
| EC-004 | ⏭️ 未启动 | Phase C 范畴；--max-runs-per-day quota store 未实现 |
| EC-005 | ✅ 处置已落地 | assertNoSelfJudge 3 入口 hard-fail；5 case 单测覆盖 |
| EC-006 | ⏭️ 未启动 | canonical schema `perf.mcpToolCalls[]` 迁移在 T046/T047 |
| EC-007 | ✅ 处置已落地 | Test 3 实测：cache 4.0.0 时 fail-fast，明确提示 plugin update |
| EC-008 | ⏭️ 未启动 | partial run 三状态 + finalized_at 字段在 T043/T045 |

## 4. 验收漏洞 / 不一致

仅 1 条轻度不一致：

**FR-013 完整迁移 vs [DONE-MINIMAL-VIABLE] gap**：spec FR-013 措辞"建立可复用的 backend dispatcher 模块，避免 executor 和 jury 各自维护重复的 backend 调用路径"——当前 self-judge 入口已统一，但 jury 路径的 `parseJudgeBackend` + 4 client adapter 仍在 eval-judge-jury.mjs 本地。tasks.md:324-330 显式裁决"完整迁移涉及 jury anthropic SDK 路径，超出 Phase A 修复范围"，并声明 [DONE-MINIMAL-VIABLE] 留给独立重构 feature。

**裁决合理但与 spec 字面 MUST 措辞略有 gap**——建议 verify phase 把这条裁决纳入"已知限制清单"。

无其他 FR 标 ✅ 但代码不充分；无 FR 标 ⏭️ 但 deferred 路径不清晰；无 tasks 标 [DONE] 但 commit 无对应改动。

## 5. Scope 越界检查

逐 commit 扫描，**0 项越界**：

- ca436cd：5 frontmatter + release-contract + Test 3 文档 → 全部在 FR-001~008
- 5d96c86：dispatcher + executor wrapper + DEFAULT_JUDGES + self-judge + 2 unit test → 全部在 FR-010~021/027
- a98bde5：pearson + calibrate runner + fixture-list + 1 unit test → 全部在 FR-022~026

未发现引入 Feature 163/164/165 的功能。calibrate-glm-judge.mjs 的 `--use-fallback-jury` flag 与 fail-closed pass set 计算属 FR-025 回退方案的 runner 内置实现，spec EC-003 + FR-025 已预声明，**非越界**。

## 总结

- **FR 完整实施**：17/33 ✅（51.5%）+ 9/33 ⏭️ DEFERRED 合理（Phase C 范畴）+ 6/33 ⚠️ 部分实施（FR-006 cache update 待用户、FR-013 [DONE-MINIMAL-VIABLE]、FR-022/023/024/025 calibration runner 就绪/实测待 API key）+ 1/33 N/A（YAGNI FR-039）
- **DEFERRED 合理项**：11 项均与 4 commit 范围（设计 + Phase 0+A+B1+B2）一致；2 项 [DEFERRED-TO-API-KEY-AVAILABLE]（calibration 实跑），1 项 [DEFERRED-TO-OPS]（25 fixture byte-stable），8 项 Phase C 范畴
- **不一致项**：1 项轻度 gap（FR-013 局部完整性 vs [DONE-MINIMAL-VIABLE] 裁决），有显式 tasks.md 裁决，可接受
- **Scope 越界**：0 项
- **是否阻断 verify phase**：**否**

## verify (Phase 7c) 应执行

(a) FR-006 的 `claude plugin update` 由用户手动触发后 Test 3 复测 success
(b) FR-013 [DONE-MINIMAL-VIABLE] 列入"已知限制"
(c) Phase C / SC-004 单独 verify gate
