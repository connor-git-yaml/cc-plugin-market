# 产品调研报告: Feature 158 — SWE-Bench Grounding Eval

**特性分支**: `claude/focused-booth-ff2be2`
**调研日期**: 2026-05-09
**调研模式**: 在线（WebSearch × 3）

---

## 1. 需求概述

**需求描述**: 借鉴 SWE-Bench 风格 task fixture，验证 Spectra MCP（impact / context / detect_changes 3 个工具）相对于裸 Claude Code 和 spec.md push 模式的 grounding lift 效果。

**核心功能点**:
- 5-10 个 task fixture 入库（含 oracle 答案）
- 3 组对比跑批：baseline / spec.md push / mcp pull
- token 效率量化（10k → 120 tokens）+ task pass rate 矩阵输出

**目标用户**: Spectra 内部研发团队、开源社区（验证 MCP pull 价值的证明材料）

---

## 2. 市场现状

### SWE-Bench 系列基准的市场地位

SWE-Bench（2023）是 LLM 编程能力评测的事实标准，社区认可度极高，已被 Anthropic、OpenAI、Google 等主要 AI 厂商用于 Claude / GPT-4 / Gemini 能力对标。SWE-Bench Lite（300 task，Python-only）是最常用的子集，被称为"精心筛选的可复现子集"，核心筛选标准包括：

- 仅 bug-fixing（不含 feature request）
- patch 为单文件修改
- 问题描述 ≥ 40 词，无图片/外部链接
- 测试在 patch 前失败、patch 后通过（oracle 可执行验证）

Multi-SWE-bench（ByteDance，2025 年 4 月）将此扩展至 8 种语言（Python / Java / TypeScript / JavaScript / Go / Rust / C / C++），包含 2132 个高质量实例，经 68 名专家标注。这与 Spectra 已支持的语言（TypeScript / Python / Go / Java）高度匹配。

**来源**: [Multi-SWE-bench: A Multilingual Benchmark](https://arxiv.org/abs/2504.02605), [SWE-bench Multilingual](https://www.swebench.com/multilingual.html)

### MCP Pull vs Push 的市场定位

2025 年主流共识是：RAG / system prompt push 是静态知识注入（"knowing more"），而 MCP pull 是主动工具调用（"doing more"）。MCP-Bench（2025）专门评测 agent 在 tool-use 场景的能力，覆盖 schema 理解和 trajectory-level task completion。

**关键数据点**：Feature 147（eval-grounding.mjs）已有 4 组对照（control / spectra / graphify / aider-repomap），但均属于 push 模式。Feature 158 要增加 MCP pull 作为第 5 组，是当前架构中尚未验证的核心假设。

---

## 3. 竞品对比

| 维度 | SWE-agent (Princeton) | Aider (aider-chat) | GitNexus eval/ | 本产品（Spectra MCP） |
|------|----------------------|-------------------|---------------|----------------------|
| 核心定位 | end-to-end agent benchmark | 本地 coding assistant + eval | repo-level context eval | MCP-augmented grounding eval |
| 语言支持 | Python-only (SWE-Bench Lite) | Python 为主 | 多语言 | TS / Python / Go / Java |
| 对照组设计 | agent vs 无 agent | repomap vs 无 repomap | [未公开] | 3 组（baseline / push / pull）|
| task 数量 | 300 (SWE-Bench Lite) | 全量跑 | [未公开] | 5-10（精选）|
| oracle 验证 | 自动化测试执行 | 自动化测试执行 | [未公开] | 需定义（见 §5）|
| 公开数据泄露风险 | 高（训练集已见） | 高 | 低（内部数据）| 低（自选 task）|

**差异化机会**:
1. **MCP pull 专项评测**：业内无成熟的 MCP tool-call vs system prompt push 对比框架，本 Feature 可作为首批公开数据点
2. **多语言 + callSites 匹配**：选取 Spectra 已支持语言（TS/Go/Java）的 task，可直接验证 callSites 对 grounding 的边际贡献
3. **token 效率硬指标**：10k → 120 tokens 的量化是独特卖点，竞品均未在 report 中重点呈现

---

## 4. 用户场景验证

**Persona: Spectra 核心用户（LLM-augmented dev tool 开发者）**
- 背景：构建 AI coding assistant，需要 evidence 说服团队采用 MCP 而非 system prompt
- 目标：一份有数据支撑的对比报告，可引用于内部提案或开源 README
- 痛点：无法量化"MCP pull 比 push 好在哪"，只能凭直觉判断

**关键需求假设验证**:

| 假设 | 验证状态 | 证据 |
|------|---------|------|
| MCP pull 比 push 有更高 task pass rate | ⚠️ 待验证 | Feature 155 已 ship，待 eval |
| spec.md push grounding lift = 0 | ✅ 已验证（Sprint 3 Phase 5） | 本仓库 eval-grounding.mjs 实测 |
| 5-10 task 足够区分信号 | ⚠️ 待确认 | 见 §5 风险分析 |
| token 效率 10k → 120 可测量 | ✅ 已验证 | Feature 155 设计文档 |

---

## 5. MVP 范围建议

### Must-have（P1，~2 周预算内必交付）

**task 筛选维度**（选 6-8 个，覆盖 2-3 种语言）:
- 语言覆盖：TypeScript（hono）+ Python（micrograd/nanoGPT）+ Go 各选 2-3 个
- patch 规模：单文件修改、≤ 200 行 diff（避免 multi-file reasoning 干扰 grounding 信号）
- bug 类型优先：逻辑 bug（有明确的 oracle 断言）> API 误用 > 配置错误
- 测试可执行：task 必须配套可运行的 assert / unit test 作为 oracle

**3 组对比设计**（沿用 eval-grounding.mjs 架构扩展）:
- Group A: baseline（裸 Claude Code，仅文件名列表）
- Group B: spec.md push（Spectra spec.md 作为 system prompt）
- Group C: mcp pull（Claude Code + Spectra MCP impact/context 工具调用）

**token 效率报告**: 在 report §6 中单独一节，列出每组 context token 数（Group A ~80 tokens / Group B ~10k tokens / Group C ~120 tokens per call），配合 pass rate 计算"每 token 信噪比"。

### Nice-to-have（P2，可延后）

- **第 4 组对照**（Group D: baseline + Read/Grep 让 agent 自己搜索）：可更干净地孤立 MCP 的结构化 context 价值 vs 原始文件搜索；建议在 report 中作为"未来方向"提及，本次预算不够
- N=3 重复跑取均值：每个 task × 每组跑 3 次（LLM 随机性），预算 ~$50 可支持（5 task × 3 组 × 3 次 ≈ 45 次调用）

### Future（远期）

- 接入 Multi-SWE-bench 官方 harness，实现完全自动化 oracle 验证
- 扩展到 300 task 级别，支持统计显著性检验

### 优先级排序理由

5-10 task 在 LLM 高方差下统计显著性有限（p-value 难以达标），但**目的不是发 paper，而是内部 evidence + 开源 README 的可信度**。6-8 task × N=3 已足够区分 20%+ 的 lift（如 Y - X ≥ 2 tasks），这与 Feature 147 的 grounding 评测规模一致。

---

## 6. 结论与建议

### 总结

Feature 158 的产品价值清晰：提供业内稀缺的 MCP pull vs push 直接对比数据。SWE-Bench 系列是业内认可度最高的 eval 框架，Multi-SWE-bench（2025）的多语言扩展与 Spectra 支持的语言完全匹配，可直接借鉴其筛选方法论。

### 对技术调研的建议
- 重点确认 eval-grounding.mjs 是否可以直接扩展增加 mcp pull 组，还是需要新的 eval-swe-bench.mjs
- oracle 验证机制（可执行测试 vs LLM judge）的技术选型，会直接影响 task fixture 的设计
- Multi-SWE-bench 的 harness 架构是否可以局部复用（特别是 Java/Go 的 test runner）

### 风险与不确定性

| 风险 | 严重性 | 缓解建议 |
|------|--------|---------|
| mcp pull 也无 lift（Y ≈ X） | 中 | 诚实呈现；token 效率仍是硬数据；推测性原因标 [推断] |
| 5-10 task 统计功效不足 | 中 | 明确说明"pilot study"性质，不声明统计显著性 |
| SWE-Bench Lite task 泄露训练集 | 低-中 | 优先选 Spectra 自有 baseline 项目（hono/micrograd）的 task，非公开 SWE-Bench 题目 |
| 对照组设计缺第 4 组（自由 grep）| 低 | report 中标注"MCP vs 原始 grep 的对比为 future work" |

---

**来源**:
- [SWE-bench Lite 官方页面](https://www.swebench.com/lite.html)
- [SWE-bench 原始论文 (ICLR 2024)](https://proceedings.iclr.cc/paper_files/paper/2024/file/edac78c3e300629acfe6cbe9ca88fb84-Paper-Conference.pdf)
- [Multi-SWE-bench arXiv (2025)](https://arxiv.org/abs/2504.02605)
- [SWE-bench Multilingual](https://www.swebench.com/multilingual.html)
- [MCP vs RAG 架构对比 (TrueFoundry)](https://www.truefoundry.com/blog/mcp-vs-rag)
- [MCP-Bench arXiv (2025)](https://arxiv.org/pdf/2508.20453)
