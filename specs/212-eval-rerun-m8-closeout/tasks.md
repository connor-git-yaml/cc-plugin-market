# 任务清单 — 212 M8 收官评测 closeout

## Phase T0 · calibrate oracle_error 对齐（$0，代码）
- [ ] T0-1 `eval-calibrate.mjs`：新增 `oracleOutcomeFromFixture` + `readOracleOutcome`（tri-state，镜像 F210 classification 映射）
- [ ] T0-2 `eval-calibrate.mjs`：`resolvePass` 改用 tri-state；`aggregateRunResults` 增 `oracleErrorCount` + 哨兵剔分母（顺序先于 truthy）+ `excludedRate` 计入
- [ ] T0-3 调用点解构 + entry `oracleErrorRate` + console.log 观测字段
- [ ] T0-4 `feature-206-calibrated-harness.test.ts`：新增 oracle_error 剔分母 + 顺序防误判 + readOracleOutcome 五态用例
- [ ] T0-5 `vitest run` 目标测试 + 全量单测零回归
- [ ] T0-6 **Codex 对抗审查**（禁 resume，校验 session ID）→ 处理 high/medium
- [ ] T0-7 commit（显式路径，禁 `git add -A`）；freeze oracle 语义

## Phase P2 · 133 离线重判·复核（≈$0）
- [ ] P2-1 抽检 untracked.tgz 分类复核（CL-1）+ freeze 工具重冻结 oracleSpecHash + 与 F176/F197 值比对
- [ ] P2-2 133 份 `runSwebenchInstance`(verified) 离线重判（独立 runId，取证隔离，禁覆盖 188）
- [ ] P2-3 cohort 聚合 + error_rate 门 + vs M7 fuzzy / vs 188 P1 一致性 → 成立/推翻结论
- [ ] P2-4 Codex 审查结论诚实性

## Phase PREP · 批勘验（$0，不真跑）
- [ ] PR-1 全局 spectra plugin 状态校验 + disable 方案
- [ ] PR-2 `checkPreregistration` 三 hash 比对无意外漂移
- [ ] PR-3 cohort-batch manifest 勘定（c1/c3 + enforcement=block 定位）+ dry-run run 计划
- [ ] PR-4 go/no-go 清单汇总（OAuth / 配额窗口 / SiliconFlow$ / 阻塞项）
- [ ] 🚦 **交用户 go/no-go**

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
