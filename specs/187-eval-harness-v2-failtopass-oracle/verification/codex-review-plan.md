# Codex 对抗审查 — plan.md（plan phase）

日期：2026-06-14 | 审查方：codex:codex-rescue（foreground 重试，首次 background stall）| 结论：6 CRITICAL

主线裁决：**全部认定为真实缺陷**，并已用代码核验关键点（runPrimaryOracle 同步 + 7 处 sync 调用方 + :289 error 漏判 + :741 截断）。plan 需修订后再进 tasks。无新增需用户拍板项（均为"按已定 Q1/Q2 + 集成现实把 plan 修正确"）。

| 编号 | Codex 结论 | 代码核验 | 主线裁决 + 处置 |
|------|-----------|---------|----------------|
| C-1 | 旧 classifyOracle 兼容层把 Q1 修复洗出分母；且新 `error` 值未被现有 `'unavailable'` 排除逻辑识别 | ✅ 确认 swe-bench-verified-cohort-batch.mjs:289 `oraclePassed: oracleState==='unavailable'?null:oracleState==='pass'` → 新 `error` 会落入 false=计入 fail 分母 | 接受。新增 ranking classifier：pass→true/fail→false/**error→null/unavailable→null**；swebench 路径读 primaryOracle.classification；旧 classifyOracle 重命名 classifyLegacyOracle 仅服务 legacy/fuzzy secondary；:289 映射改为同时排除 error+unavailable；F176 测试更新 |
| C-2 | oracleSpecHash 只 hash classify-oracle.mjs，漏 phaseReached 打点逻辑（swebench-oracle.mjs）+ predictions 构造 = 判分语义可绕过 | ✅ 设计确认 | 接受。oracleSpecHash 输入扩展覆盖**全部判分语义模块**：classify-oracle.mjs + marker-parser 模块 + dataset/command builder。把语义代码拆成可 hash 的纯模块（phase-markers.mjs 等）。测试：改 marker 表 → oracleSpecHash 必变 |
| C-3 | marker 缺失默认 image→error/infra = 放过烂 patch，重开反向污染，与 Q1 矛盾 | ✅ 设计确认 | 接受。引入 phaseReached='unknown' + evidence-based 判定：log 有 pytest/test-id/OOMKilled 证据 → 按 test_exec → fail；真 unknown → 强告警 + marker-missing 指标 + 超阈值 fail CI；不把缺失伪装成 image |
| C-4 | 本地 JSONL 未实证（--help grep 不够）；方案 B 仅冻结 HF revision 不闭合 W1 | ✅ 设计确认 | 接受。本地 dataset 可行性升为 **Phase 0 hard gate**（真跑 run_evaluation 到可解析 report，非 --help）；方案 B 必须从冻结 HF revision 重生 fixture + 记录 HF row canonical hash + 逐字段比对 + 不一致 hard-fail |
| C-5 | runPrimaryOracle 同步 vs swebench 异步；assembleTaskFixture 截断 details；checkPreregistration 未传 oracle kind/manifest；freezeBlock 签名变更需重冻结 | ✅ **全确认**：runPrimaryOracle 是 `export function`（sync），7 处 sync 调用（fixture-check/mcp-augmented(-classic)/executor×2/prepare/runner×2/finalize）；:741 `JSON.stringify(details).slice(0,1000)` 且只存 {kind,passed,details}；:113 `checkPreregistration(taskIds,PREREG)` 无 kind/manifest | 接受。**用 spawnSync({timeout}) 保持同步**（零调用方迁移，不动竞品路径），phaseReached 从捕获的 stdout/stderr/log 事后用纯函数解析；assembleTaskFixture 写完整 OracleResult（含 classification/failureSource/phaseReached/exitCode/signal/timedOut/stdoutTail/stderrTail，details 不截断）；checkPreregistration 加 {oracleKind, oracleSpecInput, manifest} 参数；freeze 脚本加 oracle/dataset/manifest 参数 + 现有 preregistration.md 重冻结；spawnSync timeout 后清理可能残留的 docker 容器 |
| C-6 | phaseReached marker 解析本身无默认跑测试（只在默认 skip 的 smoke 跑）→ 决策表全绿不等于判分对 | ✅ 设计确认 | 接受。marker parser 拆纯函数 + 默认跑单测（每 marker→期望 phase / 阶段单调前进 / 缺失→unknown+evidence）；加不依赖 docker 的 fake subprocess 输出夹具集成测试（"marker 后 timeout→fail"/"无 marker 有 pytest evidence→fail+告警"/"无 evidence→unknown 告警"） |

## 关键设计收敛（C-5 驱动）
**spawnSync 替代 async spawn** 是本轮最大简化：消除 async 迁移（C-5）、phaseReached 改为对捕获输出的事后纯函数解析（天然满足 C-6 可测性 + C-3 evidence-based），三个 CRITICAL 一并收口。代价：phaseReached 非实时（但 evidence-based 后置解析足够且更稳）。
