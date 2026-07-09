# F208 验证报告 — fix 模式流程依从性结构化保障

**日期**: 2026-07-09 | **执行**: 主编排器（T014/T026/T027/T029-T034）+ implement 子代理（批 1/批 2 单测证据）
**版本**: spec-driver 4.2.2 → 4.3.0（minor，release-contract 已 sync）

## 1. 单元/集成测试（SC-005 + Tests FIRST 证据）

| 套件 | 结果 | 说明 |
|------|------|------|
| `node --test "plugins/spec-driver/tests/**/*.test.mjs"` | **439 pass / 0 fail** | 批 1 新增 62（core 39 + io 21 + adoption 2）；批 2 新增至 435；主编排器复核处置再 +4（FR-013 loud ×2 + FR-015 off 短路 ×2） |
| `npx vitest run`（仓库全量） | **5067 passed / 0 failed**（428 files，4 skipped/18 skipped tests/21 todo） | npm ci 修复 `@sqlite.org/sqlite-wasm` 缺包后全绿；本 feature 改动零回归 |
| Tests FIRST | T005/T008/T011 均先红（实现缺失 import 失败 / ERR_MODULE_NOT_FOUND）后绿 | 批 1/批 2 执行摘要留证 |

## 2. 手工验证记录（T014 + T027，脚本 scratchpad/manual-verify-208.sh，16/16 PASS）

沙箱隔离（mktemp），关键断言与实测输出：

| 场景 | 期望 | 实测 |
|------|------|------|
| `--mode report`（collapsed） | exit 0 + verdict JSON + 零落盘 | ✅ `{"fixSession":true,"compliant":false,"missing":["feature-dir","fix-report.md"],...}` |
| 场景 A：transcript 缺失 | exit 0（FR-013 fail-open） | ✅ 且落盘 `compliant:null` + `transcript-unavailable` 诊断事件（loud 半边） |
| 场景 B：collapsed 阻断 | exit 2 + `[FIX-COMPLIANCE]` 前缀 + 双路径指引 | ✅ |
| compliant 修复收口 | exit 0 静默 | ✅（首轮 FAIL 系沙箱制品正文 ≤20 字符被 FR-012a 判占位空壳——**判定器按合同工作**，换真实长度制品后 PASS） |
| 同 sid ×4 有界化 | 1/2 次 exit 2；第 3 次 exit 0 + `[GATE-DEGRADED]`；第 4 次幂等 | ✅ `workflow-run-summary` 终态恰 1 条（`complianceVerdict.degraded:true`），第 4 次未重复（degradedRecorded 幂等）；verdict 审计事件 6 条 |
| warn 档 | exit 0 + `[FIX-COMPLIANCE][WARN]` + 同口径落盘 | ✅ |
| off 档 | exit 0 + 零输出 + 零新增落盘 | ✅（另有单测证明 off 短路先于 transcript 读取：off + 目录型 transcript_path 零事件） |
| 双 Stop hook 并存（Edge Case） | 既有 `[提醒]` 行为不变 + 前缀可区分 | ✅ `stop-task-check.sh` 输出 `[提醒] 未完成任务: 000-demo(1)` exit 0；新 hook 经薄壳 exit 2 + `[FIX-COMPLIANCE]` |
| 非 fix 会话经薄壳 | 零接触（US5） | ✅ exit 0 零输出零落盘 |

## 3. Headless E2E spike 记录（T029，真实凭据 haiku，插件副本 + --plugin-dir）

- **compliant 对照**（非 fix 会话）：exit 0，stderr 无 `[FIX-COMPLIANCE]`，零接触，9.4s。
- **collapsed 场景**：255s 多轮闭环后 exit 0——haiku 首答"已修复"被 Stop hook 阻断，收到 `[FIX-COMPLIANCE]` 反馈后**按双路径指引选择路径 B 真实补救**：创建 `specs/001-fix-compliance-check/` + 写入含 `## 判定依据` 章节的 fix-report.md + 委派 verify 子代理交叉核实 → 判定器验实后合规放行。最终消息逐条复述反馈文本结构 = reason 驱动补救行为的因果证据。**阻断-反馈-补救-放行完整闭环在与评测同构环境实锤**（harness-verification 实锤 3 的真实模型版）。
- spike 脚本幂等挂载修复：T026 之后源码 hooks.json 已自带条目，重复追加会双挂双计数（主编排器修复，含判重）。

## 4. 性能基准（T030，C-003 / SC-003）

`--mode report` 全链（含 node 进程启动），N=20：

| 样本 | 尺寸 | p50 | p95 | max |
|------|------|-----|-----|-----|
| 真实合规 fix 会话 transcript（F206 V009 r1） | 0.24MB | 24.7ms | **26.3ms** | 28.9ms |
| 同目录最大非 fix 会话（最坏样本） | 7.61MB | 41.8ms | **42.4ms** | 42.6ms |

p95 < 100ms 目标达成（余量 2.4-3.8×）；`MAX_TRANSCRIPT_BYTES=20MB` 维持（实测 fix 会话 ≤0.31MB）。

## 5. 静态安全审查（T031，C-001/C-002/C-003/FR-011）

- **C-003**：judge/core/io 三文件及 import 链零 `Task(`/LLM/网络/child_process 命中；import 链 = node 内置 + simple-yaml + record-workflow-run + core/io（全零依赖）。
- **C-001**：`git diff` 证实 `scripts/eval-*.mjs`、仓库根 `scripts/lib/**`、`tests/baseline/**` 零触碰。
- **C-002**：手写源码改动全部落 `plugins/spec-driver/**` + `specs/208-*/` + `contracts/release-contract.yaml`（版本合同 canonical source，T033 授权动作）；`.codex/skills/**`、`specs/products/**/_generated/**`、README 受控行等均为 `repo:sync`/`release:sync` 管道派生（tasks C-3 处置口径），未手改。
- **FR-011**：core 判据零任务 ID/任务描述文本读取（委派 description 的角色分类属 FR-012b 机制，非任务文本判据）。

## 6. 合同一致性

- `npm run repo:check` → exit 0（含 delegation-contract / wrapper body-sha256 / release-contract 全链）
- `npm run release:check` → exit 0（4.3.0 已同步 plugin.json / README / postinstall / marketplace / product-mapping）
- `npm run build` → exit 0

## 7. SC 对照

| SC | 结论 | 证据 |
|----|------|------|
| SC-001 坍塌不再静默通过 | ✅（机制层） | collapsed fixture/沙箱/E2E spike 全部被拦截或降级标注；评测批量口径待慢验（goal-prompt-r3 协议） |
| SC-002 硬性层：无降级标注静默通过 = 0 | ✅（机制层） | 439 单测 + 16 手工断言零静默通过路径；统计层（≤5%）待慢验批量 |
| SC-003 p95<100ms + 零 LLM/委派 | ✅ | §4 基准 + §5 静态审查 |
| SC-004 诚实 no-op 一次合规收口 | ✅ | compliant-noop fixture 单测 + E2E spike 路径 B 实录 |
| SC-005 vitest 全量零失败 | ✅ | §1 |

## 7b. 慢验:validation 集真实评测机制铁证（2026-07-09，goal-prompt-r3 协议）

**评测环境**：`eval-validate.mjs --sets sets.json --goal --concurrency 1`，c3 cohort（spec-driver+Spectra MCP），全局插件已 disable、评测经 `--plugin-dir` 加载 worktree 源码版（stamped build commit `d65bd78` 含本 feature），与 F206 战役同构入口。task fixture 从 F206 worktree 补给（19 个，gitignore 不入库，符合 baseline 边界表）。

**决定性机制证据（V008，F206 坍塌重灾任务）**：take1 的 V008 c3 run（transcript `5f4a9544`）实测：
- fix 技能展开痕迹 ✅（`Base directory for this skill: .../skills/spec-driver-fix`）
- 建立特性目录 `specs/001-fix-contains-as-set/` + 写入 fix-report.md 含 `## 判定依据`（no-op 变体模板）
- **委派 1 次 `spec-driver:verify`，description = `交叉核实无需改动判定`**（本 feature 在 SKILL.md 写死的 canonical no-op 委派文本，逐字命中）
- `record-workflow-run` 落盘 `completedPhases=['diagnose', 'no-op-verify']`（本 feature 新增的 no-op 出口 phase 标识）

**对比 F206 基线**：同一 V008 任务在 F206 的 no-op 失败 run **从来是仪式坍塌**（0 委派、不建目录、不写 fix-report、行内 cosplay 收口，见 evidence-f206-r3.md §2）。本 feature 落地后，V008 走**完整结构化 no-op 出口 + 交叉核实委派**——坍塌形态在本 run 消失（该 run 坍塌率 = 0）。这直接兑现验收锚点"V008 c3 no-op 率从 20-29% 降到 <5%"的机制前提：no-op 不再等于坍塌，而是受判据认可的一等公民路径。

**hook 静默即合规的旁证**：全批评测 worktree 的 `.specify/runs/*.jsonl` 中 `fix-compliance-verdict` 事件计数 = 0——合规 run 的 happy path 不写审计事件（零 I/O 设计，contracts §D4）；VB003 走完整修复路径（`diagnose,plan,implement,verify`）同样合规静默。证明 Stop hook 在评测环境真实挂载且对合规 run 零干扰（US1 场景 3 / SC-003 正常路径不可感知，评测环境实证）。

**测量学意义**：V008 oracle 仍 FAIL，但性质从"opus freestyle 坍塌（结果不可归因于产品流程）"变为"诚实走 spec-driver no-op 流程但判断本身错误"（属 FR-009 深度语义识别范畴，明确不在本期）。c3 通过率此后测的是真实的 spec-driver 流程而非 opus freestyle——这正是本 feature 的核心测量学目标。

**oracle 基建修复（慢验血泪，goal-prompt-r3"仪器修复先例"）**：首两跑 passRate=0 是**假读数**——`primaryOracle.cmd="(skipped: dataset build error)"` + `failureSource=infra`，根因是本 worktree 从未搭 `scripts/.swebench-venv`（机器本地产物、gitignore，F206 在别 worktree 跑）。跑 `setup-swebench-venv.sh` 建 venv（swebench 4.1.0 + Python 3.12）后 `swebench_fetch_rows.py` 正常返回官方行，oracle 恢复真评分。**严格区分了"假报"与"真回归"，未拿 venv 缺失的 0% 误判为 feature 回归**。

**决定性 take1（oracle 修复后，N=3）**：

| 任务 | oracle | classification | 委派 | 收口形态 |
|------|--------|----------------|------|----------|
| SWE-VB003-astropy | **PASS** | pass / none | 4（plan/tasks/implement/verify） | 完整修复 |
| SWE-V008-sympy-contains | FAIL | **fail / candidate**（真候选失败非 infra） | 1（`spec-driver:verify` desc=`交叉核实无需改动判定`） | **结构化 no-op** |
| SWE-V009-sympy-hep | **PASS** | pass / none | 4（plan/tasks/implement/verify） | 完整修复 |

passRate=66.7%（2/3），infra=0，**坍塌率=0/3**（全部走结构化流程，真实委派）。

**三条硬结论**：
1. **无回归**：VB003 + V009 双双 PASS，与 F206 基线一致——Stop hook 对合规 run 全程静默（零 verdict 事件、exit=0），未干扰任何通过任务的 patch。
2. **坍塌治理达成（核心验收锚点）**：3/3 run 全部真实委派，V008（F206 坍塌重灾任务）走 canonical 结构化 no-op（`交叉核实无需改动判定`）而非 0 委派 cosplay——坍塌率从 F206 的 20-29% 降到本批 0%。
3. **V008 诚实失败**：其 oracle fail 是 `failureSource=candidate`（no-op 判断本身错，属 FR-009 深度语义识别范畴，明确不在本期），非 infra、非坍塌。这正是测量学目标——c3 现在测真实 spec-driver 流程。

**N=6 结算（take1+take2）**：

| 任务 | take1 | take2 | 合计 | take1 路径 | take2 路径 |
|------|-------|-------|------|-----------|-----------|
| SWE-VB003 | PASS | PASS | **2/2** | 4 委派完整修复 | 4 委派完整修复 |
| SWE-V008 | FAIL | FAIL | **0/2** | 1 委派**结构化 no-op** | 4 委派**完整修复**（真改 `contains.py`：`as_set` `raise NotImplementedError()`→`return self.args[1]`） |
| SWE-V009 | PASS | PASS | **2/2** | 4 委派完整修复 | 4 委派完整修复 |

**validation N=6 passRate = 4/6 = 66.7%**，**坍塌率 = 0/6**（6 run 全部真实委派，F206 基线 20-29%）。

**三条经得起对抗的结论**：

1. **坍塌治理达成（核心验收锚点，SC-001/SC-002）**：N=6 = 0/6 坍塌。V008（F206 坍塌重灾任务，历史 r1-r4/r6 皆 0 委派坍塌）在 F208 下两次都走结构化流程——take1 结构化 no-op、take2 完整修复。仪式坍塌从 20-29% 降到 0。

2. **无机制回归 + no-op 出口非 reward-hacking 面**：VB003/V009 各 2/2 PASS，与 F206 基线一致；Stop hook 对全部合规 run 静默（零 verdict 事件、exit=0）。**关键反证**：take2 的 V008 自由选择了完整修复路径（4 委派 + 真实代码改动），证明新增的 no-op 出口**没有**把 agent 诱导进过度 no-op——agent 认为需要修时照样走完整修复。

3. **pass-rate 未达 ~88% 投影，差异全在 V008 且属任务难度（FR-009/out-of-scope）**：N=6 4/6（0.667）vs F206 baseline 5/6（0.833），差异 100% 由 V008 贡献（0/2 vs F206 ~1/3）。V008 两条路径（结构化 no-op / 朴素修复 `return self.args[1]`）都 fail——正确解需要更完整的改动（gold patch 更复杂），是**任务本身难 + 推理/正确性问题**（FR-009 深度语义识别范畴），非 F208 结构化保障能解决的问题。原投影"~88%"基于"hook 阻断错误 no-op → 强制正确补救"的理论，但实际上 no-op 是合法出口（有核实委派即放行），agent 的错误 no-op / 朴素修复都会诚实通过合规而 fail oracle。

**测量学净收益**：F208 让 c3 通过率首次真实反映 spec-driver 流程本身（0 坍塌污染），而非掺杂两三成 opus freestyle。代价是暴露了 V008 这类"看似已修/难任务"上流程的真实短板——这是诚实的下限，不是回归。

> 慢验血泪补充：`.calibration-output/sets.json` 与 `tests/baseline/tasks/**`、`tests/baseline/swe-bench-verified/fixtures/**`、`scripts/.swebench-venv/` 均 gitignore（不入库，符合 CLAUDE.local.md baseline 边界表）。评测产物不 commit。

## 8. 残余风险（已明示接受）

- 委派内容与结论的深层相关性校验属 FR-009 可选范畴（contracts/no-op-report-template.md 记录）。
- 主动 sabotage 状态存储（chmod + tmpdir 占位）可诱导降级放行，但降级带 `[GATE-DEGRADED]` + `state-storage-unavailable` loud 标注且 sabotage 动作本身留在 transcript 可审计；F206 威胁模型为"遗弃/偷懒"非主动破坏。
- exit 2 阻断 + stderr 回注语义依赖当前 Claude Code CLI 行为（harness-verification 外推边界），E2E spike 脚本留作升级回归护栏。
