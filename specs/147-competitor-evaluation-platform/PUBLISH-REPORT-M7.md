---
feature: 176
milestone: M7
title: "M7 收官报告：SWE-Bench Verified 5-cohort 横向对比（Spec Driver + Spectra MCP 产品化验收）"
created: 2026-06-10
status: skeleton（实测数据待 host 跑 smoke/full 后填入；锚点口径已按 research/report-anchors.md 锁定）
data_source: tests/baseline/swe-bench-verified/aggregate/cohort-aggregate.json（host 产物，不入库）
---

# M7 收官报告 — SWE-Bench Verified 5-cohort 横向对比

> **阅读前提（internal-cohort-only）**：本报告所有对比均为**同 harness / 同数据子集 / 同 driver（claude-opus-4-7）/ 同 judge 的组间 directional 对比**，不声称与任何外部发布的绝对 pass rate 可比（依据见 §2 leakage 背景）。所有业界数字仅作量级参照锚点。

## 1. TL;DR

<!-- TODO: host full 跑完后填 5 条核心结论（lift / c3_vs_c4 / token / mcp 触发率 / falsification 与否） -->

- 核心命题：cohort 3（Spec Driver + Spectra MCP，F170a/F170c/F177-F181 修复后真实开箱即用形态）相对 cohort 1（裸 Claude Code）的 directional lift 是否 ≥ 1.5×（M7-SC-006）。
- 机制验证（已实证，spike 2026-06-10）：plugin-namespace MCP（`mcp__plugin_spectra_spectra__*`）在 `claude --print` 非交互下**真实传播到 Task 子代理**并返回结构化数据 —— 产品形态的 wiring 成立。
- <!-- TODO: lift 数字 + CI -->
- <!-- TODO: token-per-completed-task 对比 -->
- <!-- TODO: c3 vs c4(SuperPowers) aggregate -->

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

### 4.1 Pass rate 矩阵（oracle 真值 + bootstrap 95% CI）

<!-- TODO: host full 后从 cohort-aggregate.json 填表：每 cohort passRate + CI + ORACLE-UNAVAILABLE 计数 -->

### 4.2 Directional lift（M7-SC-006）

<!-- TODO: lift = c3.passRate / c1.passRate = ___（CI: ___）；≥1.5× 与否如实陈述 -->

### 4.3 cohort 3 vs 同类框架（SuperPowers / GStack）

<!-- TODO: aggregate 对比 + fixture-by-fixture 胜负矩阵（允许互有胜负，如实呈现） -->

### 4.4 MCP 触发率（机制变量）

<!-- TODO: cohort3 平均 mcp_tool_calls **per run**（分母=task×repeat 的每次任务执行，需≥2）
     vs cohort2（≈0）；W-3-FLAGGED 计数。单位与 verify-feature-176 SC-002 一致，回填勿改分母口径。 -->

## 5. 第二指标：token-per-completed-task

<!-- TODO: 每 cohort 的 token-per-completed-task（仅 oracle-pass run，TOKENS-UNAVAILABLE 剔除并计数）+ c3/c1 比值 -->

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

<!-- TODO: host 跑后若有 drift 相关观察补充定性证据 -->

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
| 可用性 | 5 阶段编排 + spike-first 硬 gate 自然融入；orchestrator-cli 在 plugin cache 缺 zod 不可用（fallback 序列绕过）→ M8 |
| 信息完整性 | <!-- TODO host 跑后补 --> 设计阶段产物链（spec/plan/tasks/trace）完整 |
| 流程顺畅度 | 每 phase codex 审查节奏顺；codex-rescue 偶发 stall 需后台+重试容错 |
| 结果准确性 | 无 |

### Spectra MCP（cohort 3 真实调用）

| 维度 | 摘要 |
|------|------|
| 可用性 | ✅ plugin-namespace 传播到 `--print` 子代理（spike 实证）；⚠️ `--version` 无法区分含/不含 F177-F181 的 build；⚠️ 全局/本地同名 plugin 加载歧义无第一方机制 → 均 M8 |
| 信息完整性 | ✅ `context` 返回 definition/callers/topRelevantCallers/**nextStepHint**，子代理能按 hint 链式思考（F170c 设计生效）<!-- TODO host full 后补 17 工具覆盖观察 --> |
| 流程顺畅度 | ✅ `batch --mode code-only` 微型 repo <30s 出图，输入门槛低 <!-- TODO --> |
| 结果准确性 | ✅ spike 中 callers 关系与置信度正确（add←multiply 0.95）<!-- TODO host full 后补 impact/graph/fuzzy 准确性 --> |

## 10. 限制声明 + falsification

### 10.1-10.5 限制

- 样本量 N=3/任务、10 task：CI 宽，directional 而非显著性结论。
- 预注册外的唯一剔除是 ORACLE-UNAVAILABLE（如实计数）；TOKENS-UNAVAILABLE 同。
- judge jury 仅质量叠加层；其分歧/偏好不影响 pass/fail。
- spike 验证用 global-stock plugin（Q1 传播）；F177-F181 build 接线（Q2）由版本门禁 + smoke 收口。
- <!-- TODO: host 跑后补充实际遇到的限制 -->

### 10.6 Falsification（无论结果如何本节必填）

<!-- TODO: host full 后如实填写：
  - 若 lift ≥ 1.5×：记录数值 + CI + M7-SC-006 达成；同时记录任何 fixture-level 反例。
  - 若 lift < 1.5×：按 spec FR-C-009 如实写 "M7 修复后 Spectra MCP 在 Verified 上 lift 不足 1.5×，
    需重新评估产品定位"，并在 internal-cohort-only 框架下分析（task 难度分布 / MCP 触发率 / judge 一致性），
    不藏、不挑数据、不选择性重跑（预注册 + git 历史可审计）。
-->

## 11. 工程链路与复现

- 入口：`specs/176/.../verification/host-runbook.md`（build+盖章 → 凭据 → spike → 禁用全局 plugin → import+预注册冻结 → smoke → full → verify）。
- 验收：`node scripts/verify-feature-176.mjs`（SC-001..008 逐条断言，synthetic 拒收）。
- 数据边界：评测 fixture/aggregate 全部不入库（事实源=预注册 + 本报告 manual 数字）。
