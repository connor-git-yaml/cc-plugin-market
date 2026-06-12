---
feature: 176
milestone: M7
title: "M7 收官报告：SWE-Bench Verified 5-cohort 横向对比（Spec Driver + Spectra MCP 产品化验收）"
created: 2026-06-10
status: final（150/150 runs 实测数据已回填，2026-06-12；锚点口径按 research/report-anchors.md 锁定）
data_source: tests/baseline/swe-bench-verified/aggregate/cohort-aggregate.json（host 产物，不入库；taskSetHash=6c5ed1c0709e… 绑定预注册）
---

# M7 收官报告 — SWE-Bench Verified 5-cohort 横向对比

> **阅读前提（internal-cohort-only）**：本报告所有对比均为**同 harness / 同数据子集 / 同 driver（claude-opus-4-7）/ 同 judge 的组间 directional 对比**，不声称与任何外部发布的绝对 pass rate 可比（依据见 §2 leakage 背景）。所有业界数字仅作量级参照锚点。

## 1. TL;DR

> **⚠️ 2026-06-12 重大更正（先读这条）**：发布后对 140 个失败 run 的留存 worktree 做法医取证，发现**预注册 oracle（整 diff vs goldpatch 的 token Jaccard）存在系统性设计偏差**——workflow 类 cohort 按纪律补写的测试改动稀释了相似度，把"核心修复完全正确"的 run 判死（实测 V003 六个 c2/c3 run 核心文件相似度 78-85% 全部过阈，整 diff 被稀释到 38-45% 全部判负；baseline 从不写测试故零受损）。**core-files-only 修正重判后五组基本打平**：c1 33.3% / c2 33.3% / c3 26.7% / c4 30.0% / c5 36.7%，修正 lift(c2/c1)=1.00、lift(c3/c1)=0.80（N=30 噪声带内）。原始（预注册）结果按学术诚实保留为 primary（见下），修正分析为 post-hoc 诊断（§4.5）；原"重流程显著降低完成率"的解读**撤回**，token 成本结论（11.7×）不受影响仍然成立。

- **预注册 primary 结果（按冻结协议如实记录）**：lift = 0.100（1/30 vs 10/30），未达 ≥1.5× —— M7-SC-006 在该 oracle 口径下证伪。但见上方更正：该口径对"修复+测试"形态存在结构性惩罚，**完成率排名主要由测量偏差驱动而非能力差异**（归因分解见 §4.5）。
- **机制层与验收层分开陈述**：机制链路打通（plugin-namespace MCP 真实传播到 Task 子代理；cohort 3 平均 **1.77 次 spectra MCP 调用/run**，cohort 2 = 0，调用在子代理内 parent_tool_use_id 归因；F170a/c/d 链端到端工作）——但**频次验收 SC-002（≥2/run）未达标（1.77，verify 最终 12/13）**。工程机制成立 ≠ 验收通过，两个结论并存且都如实记录。
- **任务形态呈现强调节信号**（fixture-level 假设性信号，n=3/任务，待规模化验证；FR-B-004）：唯一的 68 行"大"任务 V004 上 **spec-driver 反超 baseline（2/3 vs 1/3），+spectra 打平（1/3）**；而 ≤33 行的小任务全部由 baseline/轻量 cohort 拿下。与 Lite 时代结论（medium-complexity multi-file 任务 directional lift 1.66×）方向一致，构成"小修复不上重流程"的**待验适用边界假设**。
- **token-per-completed-task**：cohort 3 为 baseline 的 **11.7×**（57.5k vs 4.9k）—— 流程开销在小任务上完全无法摊销（对照锚点量级见 §5）。
- cohort 3 vs SuperPowers（SC-004）：aggregate **精确打平**（1/30 vs 1/30，CI 重叠）；GStack（轻量 skills）10% 居中 —— 横向印证"流程重量与小任务完成率负相关"。

## 2. 为什么只做 internal-cohort-only（leakage 背景）

2026 年业界共识：**SWE-Bench Verified 的绝对 pass rate 已不可跨实验室比较**。

- **OpenAI 于 2026-02-23 官宣停报 Verified**（"Why SWE-bench Verified no longer measures frontier coding capabilities"）：原文结论 "SWE-bench Verified is increasingly contaminated. We recommend SWE-bench Pro."，并对高失败子集审计发现 **≥59.4% 含 flawed test**（拒绝功能正确的提交）。
- 污染实证：受测前沿模型均能复现 gold patch 或 verbatim 问题描述；60.8% resolved 实例的解在 issue 里被明示/强暗示（SWE-Bench Illusion / LessLeak-Bench / SEAL 多方一致）。
- **harness 效应**："the harness is half the score" —— 同一模型不同 scaffold 在 Verified 上可差 10-20pp（极端 42%→78%）。
- 因此本报告：固定同一 harness + 预注册 task 集（`specs/176/.../preregistration.md`，git 历史锚定防跑后换 task）+ functional oracle 真值（非 LLM 判 pass/fail），只做组间 directional 对比。

## 3. 实验设计

| Cohort | 配置 | 形态 |
|--------|------|------|
| 1 `baseline-claude` | 裸 Claude Code（opus-4-7）| 对照底座 |
| 2 `spec-driver` | + Spec Driver workflow（4.1.0）| workflow 纪律 |
| 3 **`spec-driver-spectra-mcp`** | + Spectra MCP（plugin namespace，本地 F177-F181 build，版本门禁 + dist sha256 审计）| **被验产品形态** |
| 4 `SuperPowers` | + SuperPowers framework | 同类竞品 |
| 5 `GStack` | + GStack 23 skills | 同类竞品 |

- 数据集：SWE-Bench Verified 子集 10 task（预注册冻结：task id + 筛选规则 + seed + hash）。
- 规模：5 cohort × 10 task × N=3 = 150 runs；每 (task,cohort,repeat) 独立 worktree（`r<i>` 路径隔离）。
- **pass/fail 真值 = functional oracle**（FAIL_TO_PASS 测试真实执行）；3-judge jury（opus + GLM + Kimi，anonymized + blindingHash）仅作质量叠加层，不参与 pass/fail。`ORACLE-UNAVAILABLE`（exit 126/127 全环境信号）从分母剔除并如实计数。
- cohort 间 prompt 主体逐字一致（promptSha256 入 fixture 审计）；treatment 仅为 workflow/MCP/skill 注册差异。

## 4. 核心结果

### 4.1 Pass rate 矩阵（oracle 真值 + bootstrap 95% CI；150/150 runs，2026-06-11/12 实测）

| Cohort | oracle pass | pass rate | bootstrap CI95 | ORACLE-UNAVAILABLE |
|--------|------------|-----------|----------------|--------------------|
| 1 baseline-claude | 10/30 | **0.333** | [0.17, 0.50] | 0 |
| 2 spec-driver | 2/30 | 0.067 | [0.00, 0.17] | 0 |
| 3 spec-driver-spectra-mcp | 1/30 | 0.033 | [0.00, 0.10] | 0 |
| 4 SuperPowers | 1/30 | 0.033 | [0.00, 0.10] | 0 |
| 5 GStack | 3/30 | 0.100 | [0.00, 0.20] | 0 |

（超时=0/150，max wall 1127s < 1800s 上限 —— 低 pass rate 非截断所致；TOKENS-UNAVAILABLE=0）

### 4.2 Directional lift（M7-SC-006）

**lift = c3 / c1 = 0.033 / 0.333 = 0.100** —— 未达 ≥1.5×，且方向相反（详细分析与定位重评见 §10.6 falsification）。N=3/任务的小样本 CI 宽（见上表），但 0.10 与 1.5 的差距远超 CI 重叠所能解释。

### 4.3 cohort 3 vs 同类框架（SuperPowers / GStack）

- aggregate：cohort 3 (1/30) 与 SuperPowers (1/30) **精确打平**（diff=0.000，CI 重叠）→ SC-004 的 "c3 ≥ c4" 以平局达成；GStack (3/30) 高于两者。
- fixture-by-fixture（pass/3 per task；允许互有胜负，如实呈现）：

| Task（goldpatch 行数）| c1 裸Claude | c2 spec-driver | c3 +spectra | c4 SuperPowers | c5 GStack |
|------|-----|-----|-----|-----|-----|
| V001 (33) / V002 (29) / V007 (17) / V008 (9) / V009 (13) / V010 (15) | 0/3 ×6 task | 0/3 | 0/3 | 0/3 | 0/3 |
| V003 (20) | **3/3** | 0/3 | 0/3 | 1/3 | 2/3 |
| **V004 (68，最大)** | 1/3 | **2/3** | **1/3** | 0/3 | 0/3 |
| V005 (12) | **3/3** | 0/3 | 0/3 | 0/3 | 1/3 |
| V006 (54) | **3/3** | 0/3 | 0/3 | 0/3 | 0/3 |

关键 nuance（fixture-level，n=3/任务，假设性信号）：**唯一出现 workflow 形态反超的任务恰是 goldpatch 最大的 V004（68 行）—— 精确地说：spec-driver 2/3 反超 baseline 1/3，+spectra 1/3 打平**。方向与 Lite 时代"medium-complexity 任务 directional lift 1.66×"一致，但 n=3 不足以下定论，作为 M8 规模化验证的候选假设。6/10 任务全员 0/3（任务难度天花板，各 cohort 公平受限）。

### 4.4 MCP 触发率（机制变量）

- cohort 3 平均 **1.77 次 mcp_tool_calls per run**（分母=task×repeat 每次任务执行；53 次调用/30 runs）；cohort 2 = 0.00 ✓（机制变量分离成立）。
- 与 SC-002 阈值 ≥2/run 相比**差 0.23 未达标**（如实记录；W-3-FLAGGED 的 0 调用 run 仍存在于部分小任务上——子代理判断无需图查询时不调用，这本身是 F170d "任务→工具匹配"规则的预期行为而非故障）。
- 调用分布：impact 与 context 为主（与 F170d 优先规则的 caller-analysis 匹配模式一致），全部发生在子代理上下文（parent_tool_use_id 归因）。

### 4.5 ⚠️ Post-hoc oracle 偏差诊断与修正分析（2026-06-12，发布后更正）

**发现路径**：发布后追问"为什么裸 Claude 最强"，对失败 run 留存 worktree 取证 → V003（baseline 3/3 的任务）全部 6 个 c2/c3 失败 run 都改对了核心文件（rings.py，与 goldpatch 同构），但都按 workflow 纪律加改了测试文件 → 整 diff Jaccard 被稀释至 38-45%（<60 阈值）判负，而**核心文件-only 相似度 78-85% 全部过阈**。

**偏差机理**：预注册 oracle = `git diff HEAD` 全量 ± 行 token multiset Jaccard vs goldpatch（F158 退化 oracle 设计，无文件过滤）。该设计奖励"最小 diff 模仿 goldpatch"，惩罚任何对已跟踪文件的额外修改 —— 而"修复必须带测试"正是 Spec Driver/各框架的核心纪律（真实 SWE-bench 判分跑 FAIL_TO_PASS 测试，补测试无害）。baseline 从不补测试 → 零受损。**偏差只单向打击框架类 cohort**。

**修正重判**（失败 run 以 goldpatch 触及文件过滤 diff 后重算；原 pass 保留——去噪只会提高其相似度）：

| Cohort | 原 oracle | 修正后 | 失败构成（原pass + 测试稀释翻案 / 核心偏离 / 没碰核心）|
|---|---|---|---|
| baseline-claude | 33.3% | 33.3% | 10 + **0** / 11 / 9 |
| spec-driver | 6.7% | **33.3%** | 2 + **8** / 11 / 9 |
| spec-driver-spectra-mcp | 3.3% | **26.7%** | 1 + **7** / 12 / 10 |
| SuperPowers | 3.3% | **30.0%** | 1 + **8** / 15 / 6 |
| GStack | 10.0% | **36.7%** | 3 + **8** / 11 / 8 |

修正 lift：**c2/c1 = 1.00，c3/c1 = 0.80**（均在 N=30 的 CI 噪声带内）。"核心偏离 + 没碰核心"在五组间大体均匀（20-21 个/组）——**真实修复能力五组无显著差异**。

**解读边界（诚实声明）**：(1) 这是 post-hoc 二次分析，预注册 primary 仍如实保留；(2) core-files-only Jaccard 同样是代理指标（非真实测试执行），但消除了已识别的单向偏差；(3) token 结论不受影响：同等完成率下 workflow 花费 4-12× token 的事实仍成立 —— "重流程在小任务上无增益"保留，"重流程降低完成率"撤回。**M8 必改**：oracle 换真实 FAIL_TO_PASS 测试执行或至少按 goldpatch 文件过滤（已记 m8-fix-candidates 高优先）。

## 5. 第二指标：token-per-completed-task

| Cohort | token/完成任务（input+output，仅 oracle-pass run）|
|--------|------------------------------------------------|
| 1 baseline-claude | 4,932 |
| 2 spec-driver | 21,414 |
| 3 spec-driver-spectra-mcp | **57,536** |
| 4 SuperPowers | 3,789 |
| 5 GStack | 2,582 |

**c3/c1 = 11.7×** —— 在 1 文件小修复上，workflow + MCP 的流程开销完全无法被完成率摊销（internal-cohort-only；TOKENS-UNAVAILABLE=0）。

业界量级锚点（仅 internal-cohort-only 参照，不可绝对对比）：

- **Augment Code 70.6%**（SWE-Bench Verified，Sonnet 4 + Context Engine，single-pass —— 此为 Augment 自报口径、仅作量级锚点，不声称绝对可比；截至 2026-06 调研，其公开材料以此为旗舰数字）。说明 "context engine 类产品" 投入对 Verified 成绩的量级影响；其宣传口径还含 "~3× token 效率" 类比。
- **Anthropic −98.7% token**：特指 **code-execution-with-MCP** 模式（复杂多工具工作流 ~150k→~2k tokens），**不是**通用 context editing（后者另有 ~84% / +39% 的独立口径）。该模式与 Spectra MCP "按需调用结构化工具、只回压缩结果" 是最贴近的业界类比，作为 MCP 工具编排可达 token 削减的量级上界。

## 6. 业界锚点：graph 检索路线（为什么做 Spectra MCP）

- **RepoGraph（ICLR 2025）**：line-level 代码图作为 **plug-in 模块**接入 4 个既有框架（agent + procedural），SWE-bench Lite 上平均 **+32.8% 相对成功率提升**（注意是相对值：如 Agentless+GPT-4 27.33%→29.67%；**不是** +30 个百分点绝对）。支撑 "代码图作为可插拔层" 的设计方向。
- **graph-RAG > embedding-RAG 共识（复杂 repo 任务）**：CodeRAG（DevEval Pass@1 40.43→58.14，+17.71pts vs embedding RAG）、CGM（SWE-bench Lite 43.0%，开源权重 Graph RAG）、RANGER（CodeSearchNet/RepoQA 超 Qwen3-8B embedding baseline）。边界：共识限定在跨文件依赖推理任务；简单任务 dense embedding 仍有竞争力。

### Serena peer 对比（部署门槛差异化）

| | **Spectra（本产品）** | Serena |
|--|--|--|
| 代码智能来源 | **纯 AST（tree-sitter）** | LSP（wrap 语言服务器 / JetBrains）|
| 工程前提 | **免 build / 免配置**：对未配置、编译失败、依赖缺失的工程仍可工作 | 需工程**可被索引**：正确 root + tsconfig/Cargo.toml/pom.xml 等配置齐全、依赖可解析，否则降级丢失跨文件 symbol |
| 代价 | type-aware 跨文件消歧弱于 LSP（泛型/多态）| 语义深但环境要求重 |
| 评测含义 | SWE-Bench 类"陌生 repo 快速上手"场景零环境前提 | 同场景需先满足 LSP 索引条件 |

## 7. drift 定性栏（M8 roadmap，本期不量化）

| Cohort | spec-drift 检测 | living-doc 能力 | 备注 |
|--------|----------------|----------------|------|
| 1 baseline | 无 | 无 | |
| 2 spec-driver | workflow 内 spec→code 单向纪律 | spec.md 产物 | drift 检测靠人 |
| 3 spec-driver-spectra-mcp | `detect_changes`/`diff` 工具可查 | spec.md + graph 可再生 | **M8 旗舰方向：AST-anchored drift detection** |
| 4/5 SuperPowers/GStack | 无第一方 | 无第一方 | |

（全量未触发 drift 类场景 —— 1 文件小修复不产生 spec-code 漂移压力；定性栏维持上表，量化留 M8 AST-anchored drift detection。）

## 8. Codex 对抗审查：两模型重叠（高置信）+ 独有（盲点）分类

F176 全程每 phase 跑 Codex 对抗审查（spec/plan/tasks/implement×4），与 Claude 自审交叉分类：

- **两模型重叠（高置信缺陷，双方独立同指）**：版本门禁可证伪性、falsification 防规避（预注册）、OAuth 下 token 来源、repeat worktree 隔离、judge blinding、prompt confound 审计、统计口径（proportion CI）。
- **Codex 独有（Claude 盲点）**：bootstrap CI 误用 median（0/1 样本无意义）、"调用被发起≠成功返回"（tool_result 校验）、盖章后重 tsc 绕过（dist sha256）、host gate 无交接合同可被 synthetic 冒充、全局 plugin 加载歧义只 warn。
- **Claude 独有（Codex 盲点）**：oracle vs LLM-jury 真值角色混淆（最根本 validity 问题）、`--allowedTools` variadic 吃 prompt（host 实证 exit 1 真因）、`/401/` 正则被 UUID 误伤、driver model 硬编码与 stream-json 缺失。

累计 **9+ CRITICAL 全修**（记录：`specs/176/.../verification/codex-review-*.md` 7 份）。方法论结论：双模型审查的重叠项置信度高，独有项证明单审查存在系统性盲点 —— 与 internal-cohort-only 的谨慎立场同源。

## 9. 工具使用反馈（Dogfooding，FR-D 四维度）

> 完整记录：`specs/176-swe-bench-verified-cross-cohort/verification/m8-fix-candidates.md`（含每条去向）。

### Spec Driver（编排"评测执行+报告"类需求）

| 维度 | 摘要 |
|------|------|
| 可用性 | 5 阶段编排 + spike-first 硬 gate 自然融入；orchestrator-cli 在 plugin cache 缺 zod 不可用（fallback 序列绕过）→ M8。**🥇 已发布 spec-driver 4.1.0 不含 F170a**（agents frontmatter 旧 namespace，开箱用户子代理调不到 spectra）→ M8 最高优先发版 |
| 信息完整性 | 设计阶段产物链（spec/plan/tasks/trace）完整；fixture 审计字段（promptSha256/版本门禁/blindingHash）支撑了全部事后取证 |
| 流程顺畅度 | 每 phase codex 审查节奏顺；codex-rescue 偶发 stall 需后台+重试容错。**fix-skill 编排器在小任务上 inline 化跳过委派**（prompt MUST 无效，sonnet 无视；改 opus 编排器后服从）→ 已修 + M8 hook 级强制候选 |
| 结果准确性 | 评测自身的护栏（版本门禁/预注册/oracle-jury 分离）在 7 轮迭代中全部按设计拦截了真实错误 —— 无误放行 |

### Spectra MCP（cohort 3 真实调用）

| 维度 | 摘要 |
|------|------|
| 可用性 | ✅ plugin-namespace 传播到 `--print` 子代理（spike 实证）；✅ 全量 30/30 run MCP server status:connected 零连接故障；⚠️ `--version` 无法区分含/不含 F177-F181 的 build；⚠️ 全局/本地同名 plugin 加载歧义无第一方机制 → 均 M8 |
| 信息完整性 | ✅ `context` 返回 definition/callers/topRelevantCallers/**nextStepHint**，子代理能按 hint 链式思考（F170c 设计生效）；全量中实际触达 impact/context 两类工具（17 工具中其余未被子代理选用 —— 工具面利用率是 M8 观察项）|
| 流程顺畅度 | ✅ `batch --mode code-only` 微型 repo <30s 出图；sympy 级仓库 graph 生成 ~2-3 分钟/worktree（cohort3 每 run 固定开销，小任务下占比显著）|
| 结果准确性 | ✅ spike 中 callers 关系与置信度正确（add←multiply 0.95）；全量未观察到 MCP 返回错误数据（但注意：调用量 53 次样本有限，且无法区分"结果对但没帮上"与"结果被忽略"——准确性深评留 M8）|

## 10. 限制声明 + falsification

### 10.1-10.5 限制

- 样本量 N=3/任务、10 task：CI 宽，directional 而非显著性结论。
- 预注册外的唯一剔除是 ORACLE-UNAVAILABLE（实际=0）；TOKENS-UNAVAILABLE 同（=0）。
- judge jury 仅质量叠加层；其分歧/偏好不影响 pass/fail。jury 写回缺陷在全量后发现（task fixture 多目录解析缺口 + worktree 缺 openai 依赖），修复后 3-judge 全量补评：**150/150 覆盖，opus 150 + GLM/Kimi 298/300（2 个 GLM 超时 → 该 2 run 为 2-judge 多数，spec 降级条款内）**；blinding（anonymize + blindingHash）在原 run 时已生效，补评不影响 oracle 真值与任何 pass-rate 结论。jury overlay 信号（仅参考）：c3 尝试质量分最高（median 均值 1.97）但完成率最低 —— "方案有模有样但没修对"，与 token 11.7× 共同指向流程产出与小任务收敛的不匹配。
- spike 验证用 global-stock plugin（Q1 传播）；F177-F181 build 接线（Q2）由版本门禁 + smoke 收口。
- **任务集形态偏窄（核心限制）**：可解性筛选（max-patch-files≤3）+ Verified 数据集天然分布 + 降级到 dataset-max-date（全部 ≤2023-02，泄漏风险见 `_DEGRADATION_NOTE`）→ 10 任务全为 **1 文件、9-68 行**的小修复。本报告结论的适用边界即此形态；对 multi-file / 大改动任务**不可外推**（fixture-level 的 V004 反向信号正提示边界另一侧存在不同行为）。
- 预注册偏离记录：V005×cohort3×r2 因 infra error（fixture 落盘缺失）按预注册条款重跑 1 次（≤1 次上限内，原因已记），其余 149 runs 一次成形。
- cohort 2/3 经三层产品修复后才跑通（slash 位置参数 / 委派硬约束 / 编排器 opus）——所测为"修复后产品形态"，与 milestone 对 cohort 3 的定位一致；修复全程 git 可审计。

### 10.6 Falsification（如实记录 — spec FR-C-009）

> **2026-06-12 更正**：本节写于 §4.5 偏差诊断之前。预注册口径下 lift=0.100 的记录保留，但其解读已被 §4.5 实质修正——完成率差异主要由 oracle 设计偏差（整 diff 惩罚补测试）驱动，修正后五组打平（lift c2/c1=1.00、c3/c1=0.80）。下文 1、2 两点中涉及"流程开销降低完成率"的因果解读**撤回**，token 成本与"MCP 价值前提是跨文件任务"的分析仍然成立。

**结论（更正后）：预注册 oracle 口径下 lift = 0.100（M7-SC-006 在该口径证伪）；post-hoc 修正口径下五组完成率无显著差异 —— 真实结论是"重流程在 1 文件小修复上无增益且 token 贵 4-12×"，而非"降低完成率"。** 不藏、不挑数据、不选择性重跑（预注册 taskSetHash=6c5ed1c0709e… + git 历史 + aggregate 绑定可审计；更正过程同样全程留痕）。

internal-cohort-only 框架下的定位分析（三因素分解）：

1. **任务难度分布**：6/10 任务全 cohort 0/9 —— 这些任务对所有形态都是天花板，不产生区分度；产生区分度的 4 任务里 3 个是 ≤20 行小修复，裸 Claude "读 issue → 改文件" 的最短路径完胜任何流程。**结构性结论：流程开销（spec/plan/委派/验证 ≈ 数倍 wall time 与 token）在小任务上是纯损耗**。
2. **MCP 触发与价值传导**：机制全通（1.77 次/run、子代理内、工具选择符合 F170d 规则），但调用结果未转化为完成率 —— 1 文件任务里"找 caller/评估影响面"的图查询本身价值有限（改动不出文件边界）。**Spectra MCP 的价值前提是跨文件依赖推理需求**，与 §6 学界共识（graph-RAG 优势限定复杂 repo 任务）一致。
3. **judge 一致性**：pass/fail 全程由 functional oracle 决定，jury 不参与判定 —— 本结论对 judge 偏好免疫。
4. **正面信号（边界另一侧）**：V004（68 行，最大任务）上 workflow cohort 反超 baseline（c2 2/3 / c3 1/3 vs c1 1/3），与 Lite 时代 1.66× 结论同向。

**产品定位重评 —— 以下均为 M8 待验假设（依据是本次 n=3 fixture-level 信号 + Lite 时代结论的方向一致性，不足以作为已验结论固化）**：(a) Spec Driver 增加任务规模感知 —— 小修复走轻路径（或显式建议用户不启用 workflow），重流程保留给 multi-file/大改动【待 M8 规模化验证后再决定是否写入产品文档】；(b) Spectra MCP 的下一轮评测主场建议为跨文件任务集（Lite 的 medium-complexity 集或自建 multi-file fixture）——Verified 小修复子集与其设计目标（跨文件依赖推理，§6 学界共识同向）不匹配，这一点由本次数据直接支撑；(c) "何时该用/不该用"的使用指引在 M8 验证后再固化进产品文档。

## 11. 工程链路与复现

- 入口：`specs/176/.../verification/host-runbook.md`（build+盖章 → 凭据 → spike → 禁用全局 plugin → import+预注册冻结 → smoke → full → verify）。
- 验收：`node scripts/verify-feature-176.mjs`（SC-001..008 逐条断言，synthetic 拒收）。**最终结果 12/13 PASS，SC-002（mcp≥2/run）以 1.77 未达标** —— 非全过，与正文 §4.4 一致。
- 数据边界：评测 fixture/aggregate 全部不入库（事实源=预注册 + 本报告 manual 数字）。
