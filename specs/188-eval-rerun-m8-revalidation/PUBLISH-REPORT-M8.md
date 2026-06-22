# PUBLISH-REPORT-M8 — M8 评测复测：真 oracle 离线重判 + 触发率工程复测

**Feature**: 188-eval-rerun-m8-revalidation
**日期**: 2026-06-22
**状态**: 🚧 草稿（P1 结果回填中 / P2 触发率待 `claude /login` 后跑）
**交叉链接**: [F176 预注册](../176-swe-bench-verified-cross-cohort/verification/preregistration.md) · [M7 收官报告](../147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md) · [F176 m8-fix-candidates](../176-swe-bench-verified-cross-cohort/verification/m8-fix-candidates.md)

> **定位**：F188 是 M8 Track A 价值传导链修复（增量正确性 / 触发率工程 F184 / 评测设施 v2 F187+F197）的**闭环验证**，为"trust-repair 是否真有效"提供两个新证据维度（真 oracle 排名 + 触发率实测），**非单点定论**。结论强度严格受样本量与方法局限约束，诚实标注、不外推。

---

## 0. TL;DR

- **子任务 1（离线重判，SC-004）✅ 完成**: 真 FAIL_TO_PASS oracle 重判 133/133（84 pass / 47 fail / 2 error）。**fuzzy 翻案【成立且强化】**：真 oracle 下 workflow/framework cohort 全部追平或反超裸 Claude（c4 79% / c5 67% / c3 62% > c1 55% / c2 56%），**M7 fuzzy "重流程降低完成率"被定性推翻**（系测试稀释测量伪影）；c3/c1 完成率 lift=1.13（vs fuzzy 0.10 / core-files 0.80）。**但**任务经可解性筛选（非难度代表样本，绝对率不可外推）+ 小样本（n=20-29，control 仅 20/30），cohort 次序与 lift 均为 **directional 噪声带内信号**，非统计显著强断言。
- **子任务 2（触发率复测，SC-002）⏳ setup-ready，launch-pending**: 范围定为 **c1/c3 最小集 60 runs**（用户拍板，定为日后标准）。能力已就绪（cohort 子集 commit `0e10310` + manifest + 凭据 + prereg/spike/版本门禁全绿）；**唯一 launch 阻塞 = 全局 spectra plugin 需先 disable**（否则污染 c3 MCP 测量）；执行 ~9-12hr 烧 Claude 周配额，待用户配额窗口启动。

---

## 1. 方法论与可信度护栏

### 1.1 零方法论改动
oracle 语义（`swebench-oracle` / `classify-oracle` / `phase-markers` / `swebench-dataset-build` / `swebench_fetch_rows`）、importer、fuzzy 算法、cohort 注册表、jury 全部**零改动复用**。F188 唯一新增 tracked 代码是薄离线重判驱动 `scripts/eval-offline-rejudge.mjs`（reuse `runSwebenchInstance`，不碰其语义）。

### 1.2 fixture 同源确认（C2）
P1 的 10 个 Verified fixtures 从 F176 原始产物（worktree `suspicious-sinoussi-d41c88`）恢复，**`computeFixtureContentHash` 精确等于 F176 冻结值 `19d8d42187d98235c4fa5369b898ac7308eb21e6ddc3b0788f0787cef53a71e0`** → 字节级同源，零 re-import 漂移风险。10 个 instanceId：
`sympy__sympy-{24661,24562,24539,24443,24213,24066,23950,23824}` + `pytest-dev__pytest-{10356,10081}`（sympy×8 + pytest×2）。

### 1.3 oracle 语义零漂移核验（FR-013）
5 个 oracle 语义模块自 F176 冻结提交 `538498740659551289c93029dcfd07f0f5797307`（2026-06-14）起 **git 比对零变动（含未提交工作区）** → P1 判分 oracle 与 F176 冻结口径字节一致，无"跑中换判分"。`taskSetHash` 一致 `6c5ed1c0…`。

### 1.4 candidatePatch 构造（CL-1 经验退化）
CL-1 拍板策略 = 排除候选自写测试、并入非测试新建源码。**经验抽检 133 份 `untracked.tgz`：零候选源码 / 零候选测试**（全是 `.specify/` 脚手架、runner 日志、spec-driver 自身在目标 repo 生成的 `specs/NNN-*` workflow 产物、pytest `changelog/*.rst` 文档）→ **CL-1 退化为 `candidatePatch = patch.diff` 原文**，Codex 担忧的 C3 合成偏置 / W2 分类歧义对本数据集**实际不存在**（驱动仍保留防御逻辑 + ambiguous 人工复核桶）。

### 1.5 判分口径与有效性（FR-002/012）
`pass→分子+分母`、`fail→分母`、`error/缺失→剔分母`（`classifyRunForRanking`）。每 cohort 同报 `n_total/n_valid/error_rate`；`error_rate > 30%` 标 `lowConfidence` 且 `rankEligible=false`，不入翻案排名（防剔分母虚高）。

### 1.6 跨轨不可比红线（C1，FR-015）
P1（M7-era 已存答卷重判）与 P2（post-F184 全新 runs）是**不同 epoch + 不同 candidatePatch 构造**（P1=patch.diff 原文；P2=live runner `git add -A` 全量 diff）。**禁横向比 P1-c3 与 P2-c3 的 passRate**；P1 只对 M7 fuzzy，P2 只对 F176 telemetry。

### 1.7 运行环境与操作发现
- 执行根 = 本 worktree（主仓库 stale 于 F171、缺 F187/F197 脚本）。docker + `scripts/.swebench-venv`（swebench 4.1.0）。
- **超时操作发现**：harness `--cache_level env` 下首个 sympy/pytest 实例需冷建 conda env 镜像（~8-9min），超 oracle 默认 300s watchdog → smoke 实测误判 infra。驱动加 `--timeout-ms`（默认 20min）容纳冷建；env 镜像建一次缓存复用，后续 instance run 快。

---

## 2. 子任务 1 — 离线重判 133 份（SC-004）

### 2.1 答卷构成与覆盖
133 份 `{task}/{cohort}/r{N}/patch.diff`（control 20 / gstack 27 / spec-driver 28 / spec-driver-spectra-mcp 29 / superpowers 29）。其中 **42/133 为空 patch**（候选未产出修复 → oracle 判 fail）。

**⚠️ 覆盖率限制（诚实标注）**：M7 共 150 runs（5 cohort × 10 × N=3），F188 只重判**留存了 patch.diff 的 133 份**（17 份缺答卷未捕获，主要在 control：20/30）。故 F188 per-cohort N 为 20-29（非满 30），与 M7 的 /30 口径**不完全可比**，对照取**方向性**（排名次序），不做绝对 passRate 等值比较。

### 2.0 M7 双基线（待 F188 真 oracle 裁决）
M7 报告（[PUBLISH-REPORT-M7](../147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md) §4.1/§4.5）给出两套相互矛盾的 cohort 排名，F188 真 FAIL_TO_PASS oracle 用来裁决哪套成立：

| cohort | M7 fuzzy primary（预注册 token-Jaccard）| M7 core-files-only 修正（"翻案"）|
|--------|------------------------------------------|----------------------------------|
| c1 control | 10/30 = 33.3% | 33.3% |
| c2 spec-driver | 2/30 = 6.7% | 33.3% |
| c3 spec-driver-spectra-mcp | 1/30 = 3.3% | 26.7% |
| c4 superpowers | 1/30 = 3.3% | 30.0% |
| c5 gstack | 3/30 = 10.0% | 36.7% |
| **lift c3/c1** | **0.10**（SC-006 在此口径证伪）| **0.80**（N=30 噪声带内，"五组打平"）|

**fuzzy 翻案核心主张**（M7 §4.5）：预注册 fuzzy oracle 对"修复+补测试"形态有结构性惩罚（额外 diff 稀释 Jaccard），单向打击 workflow cohort；core-files-only 重判后"五组真实修复能力无显著差异"。**F188 真 oracle（跑真实 FAIL_TO_PASS 测试，补测试无害）是这一翻案的权威裁决者。**

### 2.2 真 oracle per-cohort 通过率（133/133 完成）
总分布：**84 pass / 47 fail / 2 error**（error_rate 1.5%，2 个 infra 散落 spec-driver V009r2 + superpowers V010r1，非系统性，已剔分母）。剔分母**对称受益**（非偏向单一 cohort）：c2 15/28→15/27（53.6%→55.6%）、c4 22/29→22/28（75.9%→78.6%），两组各因自己的 1 个 error 被剔而小幅上升，不影响排序结论。

| cohort（c#）| n_total | n_valid | n_pass | passRate | error | rankEligible |
|------------|---------|---------|--------|----------|-------|--------------|
| control (c1) | 20 | 20 | 11 | **55.0%** | 0 | ✅ |
| spec-driver (c2) | 28 | 27 | 15 | **55.6%** | 1 | ✅ |
| spec-driver-spectra-mcp (c3) | 29 | 29 | 18 | **62.1%** | 0 | ✅ |
| superpowers (c4) | 29 | 28 | 22 | **78.6%** | 1 | ✅ |
| gstack (c5) | 27 | 27 | 18 | **66.7%** | 0 | ✅ |

抽验真实性（排除"恒 pass" bug）：superpowers V001r1（FAIL_TO_PASS `test_issue_24288` 真转绿 + PASS_TO_PASS 全过）、control V002r1（`test_issue_24543` 真转绿）—— 均 `patch_applied:true, resolved:true`，且 47 个 fail 证明 oracle 有区分度。

### 2.3 三套 oracle 排名对照

| cohort | M7 fuzzy primary | M7 核心文件修正（翻案）| **F188 真 oracle** |
|--------|------------------|------------------------|--------------------|
| c1 control | 33.3% | 33.3% | **55.0%** |
| c2 spec-driver | 6.7% | 33.3% | **55.6%** |
| c3 spectra-mcp | 3.3% | 26.7% | **62.1%** |
| c4 superpowers | 3.3% | 30.0% | **78.6%** |
| c5 gstack | 10.0% | 36.7% | **66.7%** |
| **lift c3/c1** | **0.10** | **0.80** | **1.13** |
| 排序 | c1≫其余 | 大体打平 | c4>c5>c3>c2≈c1 |

### 2.4 结论 — fuzzy 翻案【成立，且强化】

**M7 fuzzy 的核心结论被真 oracle 定性推翻**：fuzzy primary 断言"workflow cohort 完成率灾难性低于裸 Claude（c3 3.3% vs c1 33%）→ 重流程显著降低完成率"。F188 真 FAIL_TO_PASS oracle（跑真实测试，补测试无害）显示 **在这 10 个经可解性筛选的任务上**，workflow / framework cohort 追平或反超裸 Claude（c4 78.6% / c5 66.7% / c3 62.1% 均 > c1 55.0%；c2 55.6% ≈ c1）——**此排序仅在该非代表性任务子集内成立，绝对率不可外推到 Verified 全集（见 §2.4 局限 1）**。**fuzzy "重流程降低完成率"是测量伪影**（对"修复+补测试"形态的结构性惩罚），M7 §4.5 的翻案诊断**成立**。

**关于"评测设施修复有效"的克制表述（codex W3/W4）**：真 oracle 给出了与 fuzzy **根本不同**的答案，且 2 个跨 cohort 抽验确认其**判分机制正确**（candidate patch 真应用 + FAIL_TO_PASS 测试真 fail→pass + PASS_TO_PASS 全过）。但"真 oracle 比 fuzzy **更可信**"这一步——虽有强先验（FAIL_TO_PASS 执行是 SWE-bench 正统、fuzzy 退化 oracle 的结构性偏差有 M7 §4.5 法医证据）——**仍只由 2 个抽验支撑，未做全 133 份判分的人工复核**，故属 **directional 结论**：评测设施修复**方向正确**（给出可信度更高维度的证据），但"逐份判分零误判"待更大样本核验。

**c3（spectra-mcp，SC-002 完成率维度）**：62.1% > c1 55.0%，**lift = 1.13**（vs fuzzy 0.10 / core-files 0.80），方向转正。

**⚠️ 必须同时声明的局限（否则 over-claim）**：
1. **任务可解性偏置**：10 task 在 F176 import 时按"可解性 / 依赖轻"筛选（host-runbook 4a），**非 Verified 难度代表样本** → 55-79% 绝对率显著高于 Verified 全集典型解出率（~40-55%），**只有 cohort 间次序有意义，绝对率不可外推**。
2. **小样本 + 覆盖缺口**：每 cohort n=20-29（control 仅 20/30，全局 133/150），CI 宽；**lift 1.13 与 cohort 次序均为 directional，落在 N≈20-30 噪声带内，不构成统计显著的"workflow 优于 baseline"强断言**。
3. 2 个 infra error 剔分母（已标注），不影响定性结论。

**一句话**：trust-repair 在"评测可信度"维度**成了** —— 真 oracle 推翻了 fuzzy 的误导性结论，workflow/MCP cohort 不再被冤判为"拖累完成率"；但受任务筛选 + 小样本所限，"workflow 显著优于 baseline"仍是待规模化验证的方向性信号，不是定论。

---

## 3. 子任务 2 — 触发率复测（SC-002）【setup-ready，launch-pending】

### 3.1 设计与范围（用户拍板：c1/c3 最小集，定为日后标准）
c1（control，零 MCP 基线）+ c3（spec-driver-spectra-mcp，唯一注入 MCP）× 10 task × N=3 = **60 runs**（**非**全 5 cohort 150 runs——全跑 = 重跑整个 M7，~10-20hr 多天 + 重 Claude Max 周配额，用户明确"太多"；c1/c3 定为日后 cohort 对比默认标准）。

driver = `claude-opus-4-7`（**非** codex——cohort-batch 用 claude OAuth），judge jury = claude-opus + GLM-5.1 + Kimi-K2.6（SiliconFlow 实付）。

### 3.2 已就绪 / launch 前置
- ✅ **c1/c3 cohort 子集能力**：cohort-batch 加 `manifest.cohorts`（commit `0e10310`，7 单测）；manifest 写好（`swebenchOracle:true, swebenchTimeoutMs:300000` 匹配 F176 冻结 oracleSpecHash `f4fbd0f9`, `cohorts:[c1,c3]`），dry-run 确认 60-run 计划。
- ✅ 凭据：SiliconFlow key、`claude --print`（OAuth 已恢复）、`claude --version` 全绿。
- ✅ prereg 三 hash 不受 cohort 子集影响；spike gate PASS；spectra 版本门禁 PASS（build 含 F177+F181）；env 镜像经 P1 暖缓存。
- ❌ **唯一 launch 阻塞**：全局 spectra plugin（`spectra@cc-plugin-market`）启用 → entryValidation hard-fail（与 cohort3 本地 plugin 同名加载歧义，污染 MCP 版本审计 → 触发率测量失真）。**launch 前须 `claude plugin disable spectra@cc-plugin-market --scope user`**（干净）或 `--allow-global-spectra`（自担 c3 测量歧义风险，不推荐）。
- ⏳ 执行成本：~9-12hr 多 session（claude opus 现场生成每 run 是完整 workflow 执行），烧 Claude Max 周配额，每 6 runs 人工查配额 dashboard，≥60% weekly 暂停。建议用户有配额窗口 + 能盯时启动；loop 看门狗自动续跑抗进程夭折。

### 3.3 双指标〔待跑回填〕
- 指标 1 — 触发率：c3 均值 + bootstrap 95% CI；机判 "显著提升 vs F176（1.77）" ⟺ CI 下界 > 1.77、"达标" ⟺ CI 下界 ≥ 2.0。
- 指标 2 — 完成率 lift：c3/c1 真 oracle passRate lift。

### 3.4 结论〔待跑回填〕

---

## 4. 综合结论与 M9/Fix 候选

**trust-repair 两维度（各自范围内）**：
- **维度 1（评测可信度，P1/SC-004）✅ 成立**：真 FAIL_TO_PASS oracle 定性推翻 M7 fuzzy 的"重流程降低完成率"误判（系测试稀释伪影）；评测设施 F187/F197 修复**方向正确**（给出可信度更高维度的证据，2 抽验确认判分机制正确）。结论受任务筛选 + 小样本限制为 directional。
- **维度 2（触发率工程，P2/SC-002）⏳ 待测**：setup-ready，launch 阻塞于全局 spectra plugin + 9-12hr 配额窗口（见 §3.2）。

**M9/后续候选**：
1. **触发率复测落地**（P2）：disable 全局 plugin 后跑 c1/c3 60 runs（本轮已备 capability + manifest）。
2. **真 oracle 全量复核**（提升 P1 结论从 directional → 强）：人工复核 133 份判分（当前仅 2 抽验），或扩任务集到难度代表样本。
3. **fuzzy oracle 退役**：M7 §4.5 + F188 双重证据表明 token-Jaccard 退化 oracle 对"修复+测试"形态系统性误判，建议非 swebench-execution 路径弃用或限定适用边界。

---

## 5. Falsification 附录（偏离如实记录）

- **P1 fixture 来源**：F176 原始产物（worktree `suspicious-sinoussi-d41c88`）恢复，`fixtureContentHash` 字节同源 `19d8d42`，**非**重新 HF import（规避 import 启发式选 task 不可复现风险）。
- **P1 candidatePatch**：经验全 = `patch.diff`（实测 133 份 untracked.tgz 零候选源码/测试，CL-1"并入非测试源码"分支 vacuous）。
- **P1 覆盖**：133/150（缺 17，control 仅 20/30）；per-cohort N=20-29。
- **P1 timeout**：离线重判驱动用 1.2M ms（容冷建 env 镜像）；**与 F176 冻结的 oracleSpecHash timeout（300000）不同**——但 P1 驱动走自有 git-module-drift 前置（非 manifest oracleSpecHash 重算），5 语义模块自 F176 commit `538498740` 零漂移，判分语义一致。P2 用 300000 匹配冻结 hash。
- **P1 process 事故**：后台进程反复夭折（nohup 存活但 tracker 误报 killed）→ 一次并发双实例污染 5 个假 infra（已加 PID 锁修复 + 隔离污染 checkpoint + clean 重跑）。
- **2 infra error**：剔分母对称受益 c2+c4，非偏向。
- **P2 driver**：claude-opus-4-7（cohort-batch 设计），**非** task 列的 codex——codex 用于其他 eval 路径。

---

## 6. Dogfooding 反馈（Spectra / Spec Driver 自用，四维度）

本需求用 `/spec-driver:spec-driver-feature` 全流程编排（spec→plan→tasks→implement→verify + gates + 每 phase codex 对抗审查）。

- **MCP 可用性**：Spectra MCP 本需求**几乎未用**——F188 是评测执行任务，不需代码库结构化上下文（依赖/影响面/symbol）；研究阶段用 Explore agent + grep 测绘 eval 脚本更直接。**非问题，是任务形态不匹配**（评测任务 ≠ 代码理解任务）。Spec Driver 编排 MCP（gate/phase CLI）全程可用。
- **返回信息够用**：spec-driver orchestrator-cli（get-phases/get-gate-behavior）字段完整；preregistration-check / cohort-aggregate 的导出函数契约清晰，离线重判驱动复用 `runSwebenchInstance` 零障碍。
- **流程顺畅**：5 phase + 6 gate 编排对评测任务**偏重**（评测无"生产代码"产物，spec/plan/tasks 部分仪式化）；但 **GATE_DESIGN 硬门禁 + 每 phase codex 审查价值极高**——codex 在 spec/plan/driver 三轮共抓 1 个 no-op 校验 bug（taskSetHash 字段名）、并发污染隐患、untracked 处理盲区等真缺陷，"设计阶段抓 bug 比 implement 后便宜 100×"再次验证。
- **结果准确**：离线重判真 oracle 判分准确（2 抽验 fail→pass 真转绿）；fuzzy-match 退化 oracle 的结构性偏差被真 oracle 证实（评测设施自身的准确性问题，正是本需求要复证的）。

**转化为后续候选**：评测类任务可考虑 spec-driver 的轻量编排变体（跳过部分生产代码导向的 gate）；Spectra MCP 在评测任务中天然低频，非缺陷。
