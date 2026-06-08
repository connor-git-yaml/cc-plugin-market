---
feature: 176
phase: research（轻量 — 报告锚点核对）
created: 2026-06-08
scope: 仅核对 PUBLISH-REPORT-M7 的业界锚点数据是否最新/准确；不重新设计 cohort
sources: Perplexity detailed research × 4（2026-06 检索）
---

# F176 研究 — 报告业界锚点核对

> 目的：milestone §3 已固定实验设计，本阶段只验证报告增强（stepback-2 §4 + 第一轮 §2）引用的 8 处业界锚点数据是否准确，并修正口径。**所有锚点在报告中均须标注 `internal-cohort-only`，不声称与外部绝对可比**（见锚点 6 的 leakage 背景）。

## 核对结论速查

| # | 锚点 | 原始表述 | 核对结论 | 报告中应如何表述 |
|---|------|---------|---------|----------------|
| 1 | Augment SWE-Bench Verified | 70.6% | ✅ 准确 | "Augment 开源 agent 70.6%（Sonnet 4 + Context Engine，单趟 single-pass）" |
| 2 | Anthropic token 削减 | -98.7% | ⚠️ 口径需修正 | "-98.7% 特指 code-execution-with-MCP（~150k→~2k tokens）" |
| 3 | RepoGraph ICLR2025 | 插件式 +30% | ⚠️ 改为相对值 | "+32.8% 平均**相对**提升（plug-in，4 框架均值，SWE-bench Lite）" |
| 4 | graph-RAG > embedding | RANGER/CGM/CodeRAG 共识 | ✅ 准确（任务相关） | 见下 §4 具体数字 |
| 5 | Serena peer | 纯 AST 无需 build vs LSP | ⚠️ 主体反了 | "Spectra 纯 AST 免 build vs Serena LSP 需可索引工程" |
| 6 | leakage 背景 | OpenAI 停报 Verified | ✅ 准确 | OpenAI 2026-02-23 官宣停报，见下 |
| 7 | 第二指标 | token-per-completed-task | （指标设计，非外部锚点）| 对标 Augment 3× / Anthropic -98.7% 量级 |
| 8 | drift 定性栏 | 各 cohort drift 能力 | （内部定性，标 M8 roadmap）| 无需外部核对 |

---

## 1. Augment Code 70.6%（✅ 准确）

- **来源**：Augment 博客 "Claude Sonnet 4: The best model. With the best Context Engine."
- **口径**：SWE-Bench Verified，Claude Sonnet 4 + Augment Context Engine，**single-pass（单趟，无 ensemble）**，自称开源 SOTA。
- **演进**：早期 65.4%（Sonnet 3.7 + OpenAI o1，5-pass majority-voting ensemble）→ Sonnet 4 单趟 60.6%→70.6%。
- **2026 现状**：MorphLLM / 多家 2026 评测仍以 70.6% 为 Augment 旗舰开源数字。另有一个 **Opus 4.6 配置自报 72.0%**（不同 scaffold，非开源 Sonnet-4 agent）。
- **报告用法**：作为"Context Engine 类产品在 Verified 上的业界标杆量级"锚点；**不与本仓 cohort 绝对对比**（harness/数据集子集不同）。

## 2. Anthropic -98.7% token（⚠️ 口径修正 — 这是关键修正）

- **真相**：-98.7% **不是** Claude Code 通用 context editing，也不是 memory tool；它特指 **code execution with MCP** 模式 —— 模型写代码调用 tool API，只有压缩摘要进入上下文。复杂多工具工作流从 **~150,000 → ~2,000 tokens**（≈98.7% 削减）。
- **Anthropic 同期其它效率数字（避免混用）**：
  - Tool Search：tool-definition tokens ↓ ~85%
  - Programmatic Tool Calling：task-level tokens ↓ ~37%（均值）
  - Context editing + memory tool：100-turn 评测 token ↓ ~84%，性能 ↑ ~39%
- **为何对 Spectra 重要**：code-execution-with-MCP 是与 Spectra MCP「按需调用结构化工具、只回压缩结果」最贴近的业界类比 —— 报告应用 -98.7% 作为"MCP 工具编排可达的 token 削减量级上界"，并明确这是 Anthropic 特定场景数字。

## 3. RepoGraph（ICLR 2025）（⚠️ 改为相对值）

- **真相**：headline 是 **32.8% 平均相对提升**（average relative improvement in success rate），跨 4 个框架（agent + procedural）在 **SWE-bench Lite** 上，作为 plug-in line-level 代码图模块。
- **绝对增益其实不大**：如 RAG + GPT-4：2.67%→5.33%；Agentless + GPT-4：~27.33%→29.67%。
- **报告用法**："graph 作为插件接入既有方法可带来 ~32.8% 相对成功率提升（RepoGraph, ICLR2025）"，**严禁写成 +30 个百分点（绝对）**。支撑"Spectra 把代码图作为可插拔 MCP 工具层"的论点方向。

## 4. graph-RAG > embedding-RAG 共识（✅ 准确，任务相关）

- **CodeRAG**：DevEval repo-level Pass@1，embedding-RAG 40.43 → bigraph 检索 ~58.14（+17.71 pts；较 no-RAG +40.90）。
- **CGM（Code Graph Model）**：SWE-bench Lite 43.00%（Qwen2.5-72B，agentless Graph RAG），称 Graph RAG "typically outperforms other RAG methods"（CrossCodeEval / ComplexCodeEval）。
- **RANGER**：CodeSearchNet / RepoQA 上 NDCG@10 / Recall@10 超 Qwen3-8B embedding baseline；RepoBench 跨文件检索亦提升。
- **边界**：共识限定在**跨文件依赖推理的复杂 repo-level 任务**；简单/非图结构任务 dense embedding 仍有竞争力甚至更优。
- **报告用法**：作为"图检索 > 向量检索（复杂 repo 任务）的学界共识"锚点，支撑 Spectra graph/impact/context 工具的设计方向；标 internal-cohort-only。

## 5. Serena peer 对比（⚠️ 主体反了 — 修正）

- **真相**：Serena 是 **LSP-backed**（wrap LSP / JetBrains），**不是纯 AST**。它不编译工程，但**要求工程可被语言服务器索引**：正确 root、`tsconfig/Cargo.toml/pom.xml/go.mod` 等配置齐全、依赖可解析，否则降级为文本级、丢失跨文件 symbol 解析 → 环境要求更重。
- **纯 AST（tree-sitter）一侧 = Spectra**：免 build、易部署、对坏工程鲁棒；代价是 type-aware 跨文件解析、泛型/多态消歧弱于 LSP。
- **报告正确框架**：**Spectra（纯 AST，免 build，对未配置/编译失败工程仍可工作）vs Serena（LSP，需可索引/配置正确的工程）** —— 这是 Spectra 在"开箱即用、零环境前提"上的真实差异化，而非劣势。原 task 措辞"纯 AST 无需 build vs LSP"中，"纯 AST 无需 build"指 Spectra 这一侧。

## 6. SWE-Bench Verified leakage 背景（✅ 准确 — 支撑 internal-cohort-only 立论）

- **OpenAI 2026-02-23 官方博客** "Why SWE-bench Verified no longer measures frontier coding capabilities"：
  - 结论原文："SWE-bench Verified is increasingly contaminated. We recommend SWE-bench Pro."
  - "we have stopped reporting SWE-bench Verified scores, and we recommend that other model developers do so too."
- **测试质量审计**：对 27.6% 高失败子集，**≥59.4% 含 flawed test**（拒绝功能正确的提交）。
- **污染**：所有受测前沿模型都能复现 gold patch 或 verbatim 问题描述 → 见过训练数据；60.8% resolved 实例的解在 issue 里被明示/强暗示。
- **harness 效应**："the harness is half the score" —— 同一模型不同 scaffold 在 Verified 上可差 **10-20 个百分点**（甚至 42%→78%）。LessLeak-Bench：Verified 10.6% / SWE-bench 8.7% 直接训练集重叠（StarCoder）。SEAL：~59% Verified 任务对至少一个前沿模型有可检测训练集重叠。
- **报告用法**：作为 §leakage 背景段，论证"2026 业界共识 —— Verified 绝对 pass rate 跨实验室不可比"，因此本报告所有 cohort 对比**严格限定 internal-cohort-only（同 harness / 同数据子集 / 同 driver / 同 judge），只做组间 directional 对比，不声称绝对 SOTA**。

---

## 对 spec 的影响（research → specify 输入）

1. spec 的"报告锚点增强"FR 须按本文修正 3 处口径（#2/#3/#5），其余照搬。
2. 实验设计（cohort / 数据集 / N）不动 —— milestone §3 已固定。
3. leakage 背景（#6）是报告 falsification 立论基石：即便 cohort3 lift<1.5×，也在 internal-cohort-only 框架下如实写，不藏。
