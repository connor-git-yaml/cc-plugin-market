# 任务清单 — 212 M8 收官评测 closeout

## Phase T0 · calibrate oracle_error 对齐（$0，代码）✅ 完成（commit b757ce7 docs + 465fc11 fix）
- [x] T0-1 `eval-calibrate.mjs`：新增 `oracleOutcomeFromFixture` + `readOracleOutcome`（tri-state，镜像 F210 classification 映射）
- [x] T0-2 `eval-calibrate.mjs`：`resolvePass` 改用 tri-state；`aggregateRunResults` 增 `oracleErrorCount` + 哨兵剔分母（顺序先于 truthy）+ `excludedRate` 计入
- [x] T0-3 调用点解构 + entry `oracleErrorRate` + console.log + abortReason 文案（Codex LOW）
- [x] T0-4 `feature-206-calibrated-harness.test.ts`：+19 用例（aggregate oracle_error 剔分母/顺序锁定/混合桶 + oracleOutcomeFromFixture 四态/malformed/legacy）
- [x] T0-5 目标测试 139 passed；全量 tests/unit 2972 passed / 0 regression；node --check 双绿
- [x] T0-6 **Codex(gpt-5.5 high, 新 session 019f787c 无 resume)**：0 HIGH / 0 MED / 1 LOW（abortReason 文案）已闭环
- [x] T0-7 commit（显式路径，无 add -A）；**freeze 确认**：oracleSpecHash 由 manifest+fixture/prompt hash 派生，**不含 eval-calibrate.mjs** → T0 不扰动冻结 oracle 语义，无需 re-freeze，无 hash-guard 触发

## Phase P2 · 133 离线重判·复核（≈$0）— ⚠️ 待用户裁定（见 go/no-go）
> **勘验发现（改变成本/价值）**：`eval-offline-rejudge.mjs` **不 import eval-calibrate.mjs**，自带聚合
> （:111-140，classification pass/fail/error + error_rate>30% lowConfidence）——**已正确 error 剔分母，
> 从无 calibrate 的 bug**。故 **T0 与 133 重判正交**：re-run 只会复现 188 P1（c3 85.7%，fuzzy 误判已推翻
> directional 成立），不验证 T0。且 re-run **非真 $0**：fixtures 未 materialize（仅 dir）+ 无 .swebench-venv
> → 需重建 SWE-bench env（188 记录 Docker 涉入、进程反复夭折、1.2M ms/instance 冷建 timeout），实为数小时重活。
- [ ] P2-1 抽检 untracked.tgz（188 §5 已实测零候选源码，CL-1 vacuous）——待定是否复核
- [ ] P2-DECISION 用户裁：(A) 引用 188 P1 结论（推荐，T0 正交/已答）/ (B) 重建 env 全量 re-run 求新鲜复现（数小时）
- [ ] P2-2/3/4 仅在选 (B) 时执行

## Phase PREP · 批勘验（$0，不真跑）— 部分勘验完成
- [x] PR-1 全局 spectra plugin 状态：**`spectra@cc-plugin-market` 当前 enabled（launch 阻塞在）** → RUN 前须 `claude plugin disable spectra@cc-plugin-market --scope user`
- [x] 凭据勘验：SiliconFlow key ✅ / Claude OAuth ❌ **401 已过期**（RUN 前须 `claude /login`）/ Codex ✅（但 CLI 0.142 须 `-m gpt-5.5`，config 默认 gpt-5.6-sol 太新）
- [x] 基线：cc-plugin-market master = origin/master = 4d1fb05 ✅（≥ 要求）；worktree m8-closeout-212 off 4d1fb05
- [ ] PR-2 `freeze-preregistration.mjs` 三 hash 冻结/比对（RUN 前跑；T0 已确认不扰 oracleSpecHash）
- [ ] PR-3 fixtures + `.swebench-venv` 重建（`setup-swebench-venv.sh`）—— **当前 fixtures 未 materialize / 无 venv**，headline+A/B 判分与 133 re-run 都依赖
- [ ] PR-4 cohort-batch manifest（c1/c3）+ F208 enforcement=block 定位（在 specs/208 / fix-compliance plugin config）+ dry-run run 计划
- [ ] 🚦 **交用户 go/no-go**（当前状态：见本轮报告）

## Phase RUN · 付费批（用户 go 后，另起会话）
- [ ] RUN-1 OAuth `claude /login` preflight + 全局 spectra disable
- [ ] RUN-2 全池 33-run headline（每 6 run 查配额，≥60% weekly 停）
- [ ] RUN-3 A/B 60-run（c1/c3×10×3，telemetry 采集）

## Phase REPORT
- [ ] RP-1 四方终表更新 + 坍塌率对照
- [ ] RP-2 133 重判结论 + 触发率 A/B 双指标
- [ ] RP-3 PUBLISH-REPORT-M8（交叉链接 188/F176/F206）+ M8-SC-002/004 闭合裁定
- [ ] RP-4 dogfooding 四维度反馈节
- [ ] RP-5 push 前列 report 等用户确认
