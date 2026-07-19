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

## Phase PREP · 批勘验 ✅ 全部完成（用户"继续推进到做完"授权后升级为 full-prep）
- [x] PR-1 全局 plugin：**须 disable 两个**（spec-driver + spectra，c3 preflight 硬 fail 无 bypass）——发射器自动 disable + trap 恢复
- [x] 凭据：SiliconFlow ✅ / Codex ✅（CLI 0.142 用 `-m gpt-5.5`）/ Claude OAuth ❌ 401（**唯一剩余人工步骤 `claude /login`**）
- [x] 基线 4d1fb05 ✅；Docker 已拉起 ✅；Surge 6152 在监听 ✅（HTTPS_PROXY 陷阱活门禁进发射器）
- [x] **PR-3 基座重建**：venv（swebench 4.1.0）+ **F206 全池 11 task 从转录三角恢复**（POOL-RECOVERY.md）+ fixtures 30 个双批重导入**字节级命中 F176 锚 19d8d42** + frozen/validation 集合锚前缀命中（298cf127/b7b961ed）
- [x] **PR-2 oracle 语义 re-freeze**：frozen f4fbd0f9→live f4044f21（漂移源唯一=415e46e 陈旧缓存修复；**T0 零贡献实证**——5 语义模块 sha T0 前后一致）；re-freeze 后三 hash 门 PASS；taskSetHash/fixtureContentHash/promptSha256 零变化
- [x] PR-4 headline 驱动 `eval-pool-rerun.mjs`（15 单测 + dry-run 33 计划 + 锚校验）+ A/B `ab-manifest.json`（cohort-batch dry-run 60 计划 ✓）+ F208 enforcement=block 确认为 eval 环境默认（208 W-1/FR-015 无需开关）
- [x] 发射器 f212-launch.sh（preflight→stamped build→plugin disable/trap→headline→A/B→标记文件）
- [x] 🚦 go 已由用户"继续推进直到 Feature 整个做完"给出；执行阻塞仅剩 OAuth 登录（监视器自动点火）

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
