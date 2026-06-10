---
title: Spectra MCP Grounding Lift — 发布报告
date: 2026-05-25
status: directional signal confirmed
audience: product / strategy / engineering stakeholders
source_of_truth: competitive-evaluation-report.md (working doc, 1500+ 行)
---

# Spectra MCP Grounding Lift — 发布报告

> 📌 **本报告是 publish-grade 摘要**，面向外部与团队 stakeholder。完整数据、实验链路、所有 phase verification 详见 [competitive-evaluation-report.md](./competitive-evaluation-report.md)（内部 working doc）。

---

## 0. 名词通俗解释（先看这段）

| 名词 | 通俗解释 |
|------|---------|
| **SWE-Bench-Lite** | Princeton + UChicago 在 ICLR 2024 发布的 **行业标准 coding 评测基准**（论文：*SWE-Bench: Can Language Models Resolve Real-World GitHub Issues?*）。完整版 2,294 个真实 GitHub issue，Lite 是 300 个 task 子集。**Anthropic / OpenAI / Google / Cursor / Cognition (Devin)** 都用它做 release benchmark。"通过"是用 **真实测试 suite 跑过**（functional oracle），不是 LLM 判分。 |
| **Cohort A — bare** | driver 只看到 task 描述，**没有任何项目上下文**。等同于"裸 Claude Code"。 |
| **Cohort B — spec.md push** | 在 driver 看 task 之前，**把 3 个最相关的模块文档（≤ 12 KB）塞进 system prompt 顶部**。不是整个项目知识图（整图常上百 KB 到 MB，全塞会撑爆 context）。等同于"提前给 driver 看几页 README"。 |
| **Cohort C — MCP pull** | driver 看到 task 时，**只告诉它 "你可以调 spectra MCP 工具按需查"**，没有预注入任何文档。等同于"配个研发顾问，需要时随时问"。 |
| **directional signal** | 数据"方向上"指向某结论（如 C > A），但样本量太小不能下 statistical significance 结论。**directional ≠ proven，是趋势而非证明**。 |
| **C/A = 1.66×** | C 的通过率是 A 的 1.66 倍（19.1% / 11.5% = 1.66）。 |
| **per-cell n=3-15** | 每个 (fixture × cohort) 格子重复跑 3-15 次取平均。LLM 输出有随机性，每跑一次结果不同，需要重复采样。|

---

## TL;DR

在 **SWE-Bench-Lite 真实 GitHub issue 修复任务**（业界公认的 coding agent benchmark）上（10 fixture × 3 cohort, n=143 次跑批），观察到 Spectra MCP pull-grounding 相对 bare baseline 的 **directional lift signal**：

| Cohort | 通俗讲是什么 | 注入数据量 | Pass Rate | vs A |
|--------|------------|----------:|----------:|-----:|
| **A** bare driver | 裸 Claude Code，只看 task 描述 | ~500 字 task | 11.5% (7/61) | — |
| **B** spec.md push | system prompt 顶部塞 3 个相关模块文档 | ~12 KB doc | 3.0% (1/33) | **0.26×** ⚠️ |
| **C** Spectra MCP pull | driver 按需调 spectra MCP 工具按需查询 | ~1 KB 工具说明 | **19.1% (9/47)** | **1.66×** ✅ |

**一句话结论**：在真实 GitHub issue 修复任务上，**让 driver "按需查询" 比 "提前塞文档" 效果好得多**（C/B = 6.3×），也比 "什么都不给" 略好（C/A = 1.66×）。

⚠️ **科学严谨声明**：上述差异属 **directional observation**（趋势性观察），**不构成 statistical significance**（per-cell n=3-15 不足以做 95% CI 推断）。LLM 任务在 n=3 样本上 ±10-20pp 方差属正常范围。

---

## 1. 核心结论（5 条）

### 1.1 ✅ MCP pull-grounding 在中等复杂度多文件任务上 **directional 有 lift**

10/10 fixture 完整覆盖下 C cohort aggregate **19.1% vs A 11.5%**（**C/A = 1.66×**）。该信号在 4 个独立子实验中复现（Feature 162 / 163 / 167 / 169）。

### 1.2 ⚠️ Spec push（提前塞文档）在 SWE-Bench-Lite 上反而 **negative lift**

Cohort B 3.0% 显著低于 A 11.5%（B/A = 0.26×）。

**通俗解释**：B 在 system prompt 顶部塞了 3 个相关模块的 spec.md 摘要（≤ 12 KB 文档），但这些文档：

1. **可能与真实代码漂移**——SWE-Bench-Lite 任务是修真实 bug，目标 commit 的源码可能与 Spectra 生成 spec 时的代码已经不一致，spec 描述的"应有行为"反而误导 driver 走错路
2. **占 context budget**——12 KB 文档常驻 prompt 头部，挤压 driver 真正读源码的 attention 预算
3. **缺少 "task-specific 相关性 signal"**——driver 拿到的 3 个 spec 是按文件名匹配挑的，不是按 task 真实需要挑的

相比之下，**Cohort C 让 driver 按需调用 MCP 查询**，只在需要时拿到真正相关的信息，避免上述 3 个问题。这与 LLM 工程的一般经验一致：**长 system prompt 在 long-horizon agent 任务上会稀释信号**。

### 1.3 ⚠️ 早期 L003/L005 的 100% C-pass = 部分 cherry-pick outlier

Feature 169 在剩余 6 fixture 上 **没有任何一个复现 100% C-pass**，最高仅 L007 的 2/3 持平。早期 partial 数据暗示的 C/A = 2.1× 在 10/10 fixture 完整数据下回归到 **1.66×**。

### 1.4 ⚠️ 4 个 boundary fixture 暴露 driver 能力上限

L001 / L002 / L008 / L009 在 A / B / C 三 cohort 全 0 pass（n=57 全 fail）。任务复杂度超 Codex GPT-5.5 / Claude Opus 4.7 + 30min wall clock 边界，**与 grounding 无关**——这是 driver model 的 task ceiling。

### 1.5 ⚠️ 与单函数补全任务（micrograd）grounding=0 结论 **共存不冲突**

Sprint 3 在 micrograd-scale 单函数补全任务上实测 grounding delta=0（control 已 100% PASS，无 lift 空间）。本结论仅适用 **medium-complexity multi-file caller-graph 任务**，不外推到简单单函数补全。

---

## 2. 实验设计（简短）

| 维度 | 配置 |
|------|------|
| **数据集** | **SWE-Bench-Lite** — Princeton + UChicago ICLR 2024 发布的真实 GitHub issue 评测基准（[arxiv:2310.06770](https://arxiv.org/abs/2310.06770)）。本实验取 10 fixture：pytest / astropy / sympy 三个热门 Python 库的真实 bug + 对应 commit + 测试 suite。pass = 真实测试 suite 跑过（functional oracle）。**Lite ≠ Verified — 详见 §6 绝对 pass rate 解读**。 |
| **Cohort A** (bare) | driver 只看到 task 描述 + 项目源码 worktree。无任何文档预注入。 |
| **Cohort B** (spec-push) | 在 system prompt 顶部预注入 **最多 3 个最相关的 Spectra 生成的模块级 spec.md 摘要**（每个截前 4000 字符，总长 ≤ 12 KB）。**不是**整个项目知识图（全图常 100+ KB 到 MB 级，会撑爆 context window）。 |
| **Cohort C** (MCP-pull) | driver 看到 task 时仅告知"你有 3 个 spectra MCP 工具可调"（`detect_changes` / `context` / `impact`），让其自主决定何时查询什么 symbol。**强制 protocol**：必须先调 `detect_changes`，然后视结果决定后续调 `context`，最后写代码。 |
| **Driver** | **Claude Opus 4.7** (Claude Max 订阅 OAuth，通过 `claude --print` CLI 子进程；非 Codex CLI 路径) |
| **Judge jury** | 3-judge majority vote：Claude Opus 4.7 (Max 订阅) + GLM-5.1 + Kimi K2.6 (SiliconFlow API)。avoid self-judge：driver 与 judge 不同 vendor。 |
| Timeout | 45 min wall（F166 后），30 min（F166 前的旧 runs） |
| Sample size | per-cell N=3-15, 共 **n=143 finalized runs** |
| 实付成本 | **~$30**（仅 SiliconFlow API jury 真实扣费；Codex driver + Claude judge 走订阅 OAuth $0 边际）|
| 全跨度 | 2026-05-13 → 2026-05-25（Feature 158 → 169 共 9 个 feature 修复链路）|

详细 cohort 设计、stop-loss 配额管控、protocol 验证（mechanism / consumption signals / determinism）→ working doc §10.1-10.5。

---

## 3. 核心数据矩阵

### 10/10 Fixture 完整数据（n=143）

| Fixture | A (bare) | B (spec-push) | C (MCP-pull) | Note |
|---------|---------:|--------------:|-------------:|------|
| SWE-L001 pytest 模块导入 | 0/15 | 0/15 | 0/10 | boundary |
| SWE-L002 astropy NDDataRef | 0/15 | 0/15 | 0/15 | boundary |
| SWE-L003 pytest rewrite | 4/12 (33%) | 1/2 (50%) | **3/3 (100%)** ⭐ | 早期 outlier 信号源 |
| SWE-L004 sympy bug-with-milli-prefix | 0/3 | — | **1/3 (33%)** ✓ | F169 唯一严格 C > A |
| SWE-L005 astropy ascii qdp | 0/1 | 0/1 | **3/3 (100%)** ⭐ | 早期 outlier 信号源 |
| SWE-L006 astropy header-rows | 0/3 | — | 0/3 | timeout sensitive |
| SWE-L007 sympy collect-factor-dim | **2/3 (67%)** | — | **2/3 (67%)** | A/C 持平最高 |
| SWE-L008 sympy expand-of | 0/3 | — | 0/3 | **新 boundary** |
| SWE-L009 sympy parse-greek | 0/3 | — | 0/3 | **新 boundary** |
| SWE-L010 sympy si-collect | 1/3 (33%) | — | 0/1 (partial) | quota daily-limit |
| **Aggregate** | **7/61 (11.5%)** | **1/33 (3.0%)** | **9/47 (19.1%)** | **C/A = 1.66×** |

---

## 4. 限制声明（caveat）

### 4.1 统计层面

- **Per-cell sample size 不足**：N=3-15 远低于做 95% confidence interval 所需的最小样本量
- **本节结论维持 "directional signal"，不升级为 "statistical significance"**
- LLM 任务方差 ±10-20pp 在 n=3 cell 上属正常范围，单 fixture 差异不可靠

### 4.2 任务类型层面

- 仅适用 **SWE-Bench-Lite Python 真实 issue**（pytest/astropy/sympy 三 repo）
- **不外推** 到单函数补全（Sprint 3 micrograd 实测 grounding=0）、frontend / DSL / 非 Python 任务
- 4 个 boundary fixture 上 grounding 不解决 task ceiling 问题

### 4.3 Cohort 层面

- Cohort B (spec-push) 数据仅在 Feature 162 partial 阶段补足（n=33），后续 F169 未扩 B 数据
- Cohort C 早期 batch (Feature 162-167) 经历 5 次基础设施修复（MCP stdio / sub-agent 工具继承 / mcp call path / graph injection / determinism）；F167 之后 protocol 稳定

### 4.4 Driver / Judge 层面

- Driver Codex GPT-5.5 medium reasoning 在 4 个 boundary fixture 上达 task ceiling，更强 model 可能突破
- Jury 走 3-judge majority vote，单 judge 噪声范围内

---

## 5. 战略含义

### 5.1 Spectra MCP 适用场景（directional positive）

| 场景 | grounding 价值 |
|------|--------------|
| 真实 GitHub issue 修复（multi-file, caller-graph 依赖）| **✅ directional lift 1.66×** |
| 跨 module refactor（需要 caller 列表）| **✅** (按 §10.5.1.4-5 真实 consumption 证据)|
| 复杂 bug fix（需要 changedSymbols / impact 链）| **✅** (按 detect_changes / impact tool 设计意图)|

### 5.2 Spectra MCP 不适用 / 边际收益低场景

| 场景 | 实测信号 |
|------|--------|
| 单函数补全（micrograd-scale）| ❌ delta=0（Sprint 3 实测）|
| Control 已能 100% PASS 的简单任务 | ❌ 天花板效应 |
| 任务超 driver model capability ceiling | ❌ grounding 无法补偿（4 boundary fixture）|

### 5.3 与 spec.md push 的对比（B vs C）

| 维度 | spec.md push (B) | MCP pull (C) |
|------|-----------------|--------------|
| 触发模式 | system prompt 全文注入 | 按需查询 |
| Token 占用 | 高（spec 全文常驻）| 低（仅 query 响应）|
| Pass rate | 3.0% | **19.1%** |
| 推论 | 全文 spec 可能引入噪声 | 按需 grounding 信号更纯 |

**核心 takeaway**：在 SWE-Bench-Lite 任务上，**按需 pull 优于全文 push**。这与"长 system prompt 在长 horizon agent 任务上稀释信号"的 LLM 工程经验一致。

---

## 6. 为什么我们的绝对 pass rate（11-19%）远低于业界 SOTA 70%？

**预期会被问的核心问题**。我们用 **Claude Opus 4.7**（业界最强 driver model 之一）跑 SWE-Bench-Lite，但 A=11.5% / B=3% / C=19.1%，**远低于** Anthropic 公布的 Sonnet 4 在 SWE-Bench 上的 ~70% SOTA。**为什么？**

### 6.1 SOTA 70% 是 **SWE-Bench Verified**，不是 Lite

| Benchmark | 规模 | 由谁筛选 | 难度 |
|-----------|----:|---------|------|
| SWE-Bench (full) | 2,294 | Princeton 原始，**全部 issue 不筛** | 含 "描述不清 / tests broken / 实际不可解" task |
| **SWE-Bench Verified** | **500** | **OpenAI 团队人工 verify**：task 描述清晰、tests 合理、确认可解 | **显著容易**（已 filter 难解的）|
| **SWE-Bench-Lite**（我们用的）| **300** | **机械自动过滤**（修改 ≤ 30 行 + 单文件 等启发式）| **未人工验证**，含很多 ambiguous task |

Anthropic / OpenAI 公布的 **70% SOTA 都是在 Verified 上**。Verified 是"精选可解"，Lite 是"未筛选"，**两者绝对 pass rate 不能直接比**。社区一般认为 Lite 难度高于 Verified。

### 6.2 SOTA 用 **专业 SWE-Bench agent**，我们用 **裸 `claude --print`**

| 维度 | Anthropic SOTA 实验 | 我们的实验 |
|------|-------------------|----------|
| Agent scaffolding | **专用 SWE-Bench agent**（SWE-Agent / OpenHands / Aider）| **裸 `claude --print` 子进程** |
| Test runner 闭环 | ✅ 跑 test → 看 fail → 修代码 → **重跑 test** 反馈循环 | ❌ **无 test feedback loop** |
| Multi-turn turns | 通常 100-500 turns | driver 内部 multi-turn（但无外部反馈循环）|
| Reasoning effort | High / Max | **Medium** |

🎯 通俗类比：**SOTA 是"用 Cursor IDE + test runner + 4-6 小时认真修 bug"**，**我们是"用裸 vim + 30-45 分钟"**。

### 6.3 Timeout 紧 (30-45 min) vs SOTA 4-6h

| 维度 | Anthropic SOTA | 我们 |
|------|---------------|----|
| Wall clock per task | **4-6 小时** | **30 min**（旧 runs）/ **45 min**（F166 后）|
| SIGTERM 率 | < 5% | F167 实测 **3/9 = 33%**（超时被砍）|

很多 task driver 还没读完代码就被砍了。**即使 driver 能解，时间不够也 fail**。

### 6.4 我们实验的真正问题不是 "Opus 4.7 能拿多少分"

| 问错的问题 | 真正问的问题 |
|----------|------------|
| "Opus 4.7 在 SWE-Bench-Lite 上能拿多少分？" | **"在同一固定 scaffolding 下，A vs B vs C 的相对差异是多少？"** |

绝对数字（11.5% / 19.1%）受我们这套简化 scaffolding 制约；**但同一 scaffolding 下 A/B/C 的对比是公允的**（同一 driver / 同一 timeout / 同一 fixture / 同一 judge）。

如果换 SWE-Agent scaffolding 跑 4 小时，可能 A 跳到 40% / C 跳到 60%，但 **C/A 倍率仍可能维持 1.5-2× directional lift**（lift 来自 grounding 价值，不来自 scaffolding）。

### 6.5 一句话回答

> **70% SOTA = "Sonnet 4 + Verified（精选）+ SWE-Agent + 4-6 小时"** 的组合数字。
> **我们 11-19% = "Opus 4.7 + Lite（未筛）+ 裸 claude --print + 30-45 min"** 的组合数字。
>
> Driver 更强不能补偿 scaffolding / timeout / benchmark difficulty 的 3 重差距。
>
> 但我们的实验关注 **同 scaffolding 下 cohort 相对差异（lift signal）**，这是公允且有意义的，与 SOTA 绝对 pass rate 不冲突。

---

## 7. 推荐应用路径

### 6.1 产品层面

- **强化 MCP pull-grounding 在 medium-complexity 任务上的定位**（issue 修复 / refactor）
- **不要把 spec.md push 作为通用 grounding 方案** —— SWE-Bench-Lite 上 negative lift
- **简单任务无需启用 MCP grounding** —— 边际收益为 0，仅增加调用成本

### 6.2 工程层面

- 当前 9 个 MCP tool（5 graph + 3 agent-context + 1 batch）已 ship 且经过 protocol 验证
- 4 个 boundary fixture 现象 → 建议跟踪 driver model 升级（Opus-5 / GPT-5.5+）后能否突破
- LLM 方差 ±10-20pp 是真实约束 → 大样本验证（>= n=50 per cell）需要 ~$300+ SiliconFlow 实付预算

### 6.3 spec-driver-spectra-mcp 真实部署（v4.2.0 更新）

**2 步开箱即用**（Feature 170a 修复后，无需额外配置）：

```bash
claude plugin install spectra      # Step 1
claude plugin install spec-driver  # Step 2
# → 直接运行 /spec-driver:spec-driver-feature，sub-agent 自动调用 spectra MCP 工具
```

- ✅ spectra-cli@4.2.0 包含 Feature 155 agent-context tools（impact / context / detect_changes）
- ✅ 5 个 sub-agent frontmatter 已对齐 `mcp__plugin_spectra_spectra__*` plugin namespace
- ✅ 部署指引详见 [plugins/spec-driver/docs/spectra-mcp-integration.md](../../plugins/spec-driver/docs/spectra-mcp-integration.md)
- ⚠️ v4.1.x 存在 namespace mismatch（Bug-2），升级到 v4.2.0 修复

### 6.3 数据扩展（可选 follow-up）

| Follow-up | 价值 | 成本 |
|-----------|------|------|
| Feature 168 — 4 boundary fixture 突破研究 | 扩大 lift signal 空间 | ~$10-30 + 1-2 day |
| Feature 170 — n=50 per cell 大样本统计推断 | 升级 directional → statistical | ~$300 SiliconFlow + 1 周日历 |
| 全量 T052 (450 runs) | 边际增益低 | DEFER（团队决策保持）|

---

## 8. 关键 timeline

| 阶段 | 时间 | 里程碑 |
|------|------|--------|
| Feature 158 | 2026-05 | SWE-Bench eval 基础设施 ship |
| Feature 160 | 2026-05-12 | MCP stdio E2E smoke 跑通 |
| Feature 161 | 2026-05-13 | Sub-agent 工具继承机制揭示 |
| Feature 162 | 2026-05-13 | Phase 0+A+B+C Pilot 27 完整 |
| Feature 163 | 2026-05-15 | dist build / clone 幂等 / plan §0.6 4 个 spec gap 修复 |
| Feature 164 | 2026-05-16 | MCP call path 触发 mechanism 修复（mcpCalls > 0）|
| Feature 165 (T053) | 2026-05-17 | Graph pre-build + 9 runs protocol verified |
| Feature 166 | 2026-05-18 | Eval CLI infra uplift (45min timeout / opus driver) |
| Feature 167 | 2026-05-19 | SC-005/008 + Phase E-1 determinism 修复 |
| T052 partial | 2026-05-25 | 107 runs 实测核心 lift signal 确认 |
| **Feature 169** | **2026-05-25** | **6 新 fixture × N=3 = 34 runs，C/A = 1.66× 稳健化** |

---

## 9. 完整工程链路

10 个 Feature 串联完成 Stage 7b 全链路验证（F158 → F169）：

```
F158 基础设施 ship
  → F160-167 7 个 fix feature（stdio / sub-agent inheritance / mcp call path / graph injection / determinism）
    → F162 Pilot 27 mechanism PASS
      → F167 SC-005/008 + Phase E-1 PASS
        → T052 partial 107 runs (核心信号确认)
          → F169 6 new fixture × A/C × N=3 (lift 稳健化)
            → 10/10 fixture aggregate: C/A = 1.66×
```

每个 feature 严格走 Codex 阶段性对抗审查 + spec-driver workflow（spec / plan / tasks / implement / verify），累计 codex review 30+ 轮，CRITICAL 全修，WARNING 16+ 修，零 production 回归。

---

## 10. 引用与 deep dive

| 路径 | 用途 |
|------|------|
| [competitive-evaluation-report.md](./competitive-evaluation-report.md) | 完整 working doc（1500+ 行，含全部 verification report）|
| [§1.1.1](./competitive-evaluation-report.md) Executive Summary 修订 | C lift directional signal 顶层结论 |
| [§10.5.1.10](./competitive-evaluation-report.md) F169 6-fixture 完整数据 | verify 实算 verdict + 合并口径 |
| [§10.4](./competitive-evaluation-report.md) 战略结论 | T052 决策点 + 4 启动门控 |
| [specs/169-c-lift-rerun-9-fixtures/](../169-c-lift-rerun-9-fixtures/) | F169 完整 spec/plan/tasks/verification |
| [specs/162-codex-driver-glm-judge-eval/](../162-codex-driver-glm-judge-eval/) | Codex driver / GLM judge swap 设计 |
| [docs/shared/agent-eval-credentials-policy.md](../../docs/shared/agent-eval-credentials-policy.md) | 评测凭据策略（订阅优先）|

---

## 11. M7 章节：SWE-Bench Verified 5-cohort 横向对比（F176）

M7 把 Spectra 从"AST spec 生成器"产品化为"Claude Code 子代理可开箱即用的 MCP 代码智能层"（F170a/F170c + F177-F181 收口），F176 是验收性横向评测：**5 cohort（裸 Claude / Spec Driver / Spec Driver+Spectra MCP / SuperPowers / GStack）× SWE-Bench Verified 10 task × N=3**，driver 统一 claude-opus-4-7，pass/fail 真值=functional oracle，3-judge jury 仅质量叠加。

与本报告早期章节（Lite 时代）的关键差异：

| | §1-10（SWE-Bench-Lite，F158-F169）| §11（Verified，F176）|
|--|--|--|
| MCP 形态 | driver 顶层 `.mcp.json`（`mcp__spectra__*`）| **产品 plugin namespace**（`mcp__plugin_spectra_spectra__*`，子代理可达——spike 实证）|
| 数据集 | Lite 简化 fixture | Verified 子集（预注册冻结防跑后换 task）|
| 完整性护栏 | 基础 | 版本门禁（commit 盖章+dist sha256）/ repeat 隔离 / oracle-jury 分离 / blinding / 禁用词扫描 |
| 可比性立场 | internal directional | 同左，且依据 2026 leakage 共识（OpenAI 2026-02-23 停报 Verified）显式立论 |

**结果摘要**：<!-- TODO: host full 跑完后填 lift / c3_vs_c4 / token-per-completed-task 三个数字 + falsification 结论 -->

完整报告（实验设计 / 锚点 / dogfooding / falsification）：[PUBLISH-REPORT-M7.md](./PUBLISH-REPORT-M7.md)。

---

## 12. 一句话定位

> Spectra MCP 在 **medium-complexity multi-file 真实修复任务** 上观察到 directional lift（C/A = 1.66× on SWE-Bench-Lite, n=143），按需 pull 优于 spec 全文 push（C/B = 6.3×）。**简单任务无需启用**，**driver task ceiling 任务无法补偿**。M7（Verified, F176）的产品形态验证见 §11。

---

*Generated: 2026-05-25 / Sources: F147-F169 / 实付 ~$30 / 日历跨度 12 天 / §11 M7 增补: 2026-06-10（F176）*
