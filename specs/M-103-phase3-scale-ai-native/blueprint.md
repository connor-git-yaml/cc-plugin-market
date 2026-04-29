# Milestone M-103: Phase 3 — Large-Scale Reliability & AI-Native Output

> **让 Spectra 在真实大型项目（500+ 文件）上可靠运行，并成为 AI 编辑器生态的原生基础设施**

**版本**: 1.0  
**创建日期**: 2026-04-29  
**状态**: 🔵 Blueprint（Phase 3 已启动，等待第一波 Feature 实施）  
**前置 Milestone**: M-101（Phase 2 Reading Platform，✅ Delivered）  
**输入文档**: M-102 Proposal + M-101 Postmortem + Spectra v4 三方对比报告 + Spec Driver v4 验证报告

---

## 1. Milestone Goal

Phase 3 分两步实现：

1. **大规模可靠**：让 Spectra 在 500+ 文件的真实 monorepo 上，性能、成本、结果质量均可量化、可接受
2. **AI-Native 输出**：为 Claude Code / Cursor / Continue 等 AI 编辑器提供优化的"机器消费友好"格式，让 Spectra 成为 AI 生态的代码索引层

---

## 2. Strategic Context

### 为什么是现在

Phase 2 把 Spectra 做成了"功能完整的代码阅读平台"，但所有验证都在小项目上完成：
- karpathy/micrograd：6 文件，200 LOC，Python
- 本仓库 dogfood：~125 Feature，TypeScript

**从未在真实大型项目（500+ 文件 monorepo）上端到端验证过性能、成本、质量。** 这是进入 production 团队的最大障碍。

### 集成测试暴露的结构性问题

Spectra v4.0.0 三方对比报告（2026-04-29）发现：

| 问题 | 严重性 | 影响 |
|------|--------|------|
| Python 项目 graph.json 无代码节点 | P0 | 所有 MCP graph 工具在 Python 项目上无意义 |
| `--hyperedges` 前置条件悖论 | P1 | 90% 用户首次使用无法成功 |
| technical-debt.md tokenUsage=0 | P2 | Python 项目技术债分析功能失效 |
| dry-run 预估偏差 65x | P3 | 成本预估对用户无参考价值 |

Python AST 失败（P0）将由 v4.x patch（独立 Feature）修复，Phase 3 在此基础上拓展 Python 大型项目场景。

### M-101 Postmortem 的关键教训

7 条教训中对 Phase 3 影响最大的 3 条：
- **L4**：性能目标必须包含"项目规模"维度（< 120s 隐含了"5 文件"的假设）
- **L6**：Mock-only 单测覆盖率高 ≠ 端到端正确（reading 模式 + tokenUsage bug 在 2196 个单测里未被拦截）
- **L2**：代码层 default 变更时，必须主动检查项目根 yaml 覆盖配置

---

## 3. Phase 3 Theme & Sub-themes

### 主题：大规模 + AI 原生

```
Phase 3 = 大规模可靠性（主线）+ AI-Native 输出（支线，后半段）
```

**主线：Spectra at Scale（Wave 1-2，约 10-14 周）**

- 在真实 500+ 文件项目上建立性能基线
- 优化 LLM 调用并发、graph 存储、embedding cache
- E2E fixture 测试基础设施入 CI（L6 教训的直接产物）
- Python 大型项目能力（在 Python AST patch 基础上，支持大规模 Python monorepo）

**支线：AI-Native Output（Wave 3，约 4-6 周）**

- 新增"AI Essence"格式：每模块 ≤200 token 的机器消费友好摘要
- 多 AI runtime 适配调研（Cursor / Continue / Aider / OpenCode 扩展机制）
- 渐进探索 API：MCP 工具按需拉数据，不一次性塞完整 spec

---

## 4. First Wave Features（Phase 3 第一波，约 6-8 周）

### F1：大项目 E2E 基线测量（Feature 143）

**Scope**：选 1-2 个真实开源 monorepo（Khoj / Continue / ai-engineer-toolkit，500+ 文件），完整运行 Spectra batch，记录性能、成本、质量基线，定位瓶颈。

**关键产物**：
- `perf-baseline-report.md`：各项目的 LLM 调用耗时分布（P50/P95）、token 总量、graph.json 规模
- `bottleneck-analysis.md`：瓶颈排行（串行 LLM 调用 / graph 膨胀 / cache 命中率等）
- Phase 3 Wave 2 优化优先级决策的数据基础

**Effort**：2-3 人天（运行 + 分析，不写代码）  
**Dependency**：无（可立即启动）  
**关键约束（L4 教训）**：基线报告必须区分"小项目（<50 文件）/ 中项目（50-200 文件）/ 大项目（200-500 文件）/ 超大项目（500+ 文件）"四个规模维度

---

### F2：E2E Fixture 测试基础设施（Feature 144）

**Scope**：建立 CI 可运行的端到端测试框架，不调用真实 LLM，但完整走 pipeline。用预录 fixture 验证 pipeline 产物的结构和字段是否符合预期。

**关键产物**：
- `tests/e2e/` 目录：fixture-based E2E 测试套件（初始 3-5 个场景：TypeScript 项目 / Python 项目 / 大型 monorepo 截断模拟）
- `tests/fixtures/` 目录：预录 LLM 响应 + 预期产物（spec.md frontmatter / graph.json 结构 / batch-summary 字段）
- CI workflow 更新：新增 `npm run test:e2e` 步骤

**Effort**：4-6 人天  
**Dependency**：无（可与 F1 并行）  
**关键约束（L6 教训）**：必须覆盖"真实 batch 输出 graph.json 的节点数 > 0"这种 mock 单测发现不了的断言

---

### F3：LLM 并发优化（Feature 145）

**Scope**：将默认 LLM 调用从串行（concurrency=1）改为可配置并行（默认 3-5），添加 budget-gate 控制（并发 × 预估 token 不超过上限）。

**关键产物**：
- `--concurrency N` CLI flag（默认 3，可覆盖）
- `spec-driver.config.yaml` 新增 `performance.concurrency` 字段
- 对比基准：500 文件项目 batch 耗时从预期 ~30min 降至 ~10-12min

**Effort**：5-7 人天  
**Dependency**：F1（需要大项目基线数据确认瓶颈优先级后再动）  
**关键约束（L4 教训）**：性能 SC 必须标注"项目规模"前提（如"500 文件项目 < 15min，200 文件 < 6min"）

---

### F4：AI Essence 输出格式（Feature 146）

**Scope**：为每个模块新增"AI Essence"输出块：≤200 token 的高密度机器可读摘要（含模块意图、主类/函数、核心依赖、最重要 ADR），优化用于 Claude Code SYSTEM 或 cursor rules。

**关键产物**：
- `--format essence` CLI flag（可单独导出或附加在标准 batch 内）
- 每模块 `.essence.md` 文件（Markdown + JSON frontmatter 双格式）
- `bundle-essence.jsonl` 整个项目的 AI Essence 汇总（JSONL，方便 AI 消费）

**Effort**：5-7 人天  
**Dependency**：F2（E2E fixture 要先建，避免 AI Essence 格式无测试覆盖）  

---

## 5. Out of Scope（Phase 3 不做的事）

| 项目 | 理由 |
|------|------|
| F6 Graphify 深度集成 | 外部项目依赖风险高，先调研（1-2 人天）再决定；Python AST 接通后再评估是否还需要 Graphify 的功能 |
| spec-driver 平台化（C-1 ~ C-4） | 价值偏团队多人场景，当前 Spectra 主要是个人/小团队工具，等用户群扩大再做 |
| 新 LLM provider 支持（GPT-5 / Gemini） | 当前 Anthropic + Codex 双 runtime 已覆盖主要场景；多 provider 是维护负担 |
| graph.html 视觉美化（自动布局 / 节点聚类） | 边际效用低，可作为单独 chore |
| 重构核心 pipeline（SpecStore / sourceKind / budget-gate） | Phase 2 已稳定，除非 F1 基线测量发现 P0 性能瓶颈 |

---

## 6. 核心决策表态（DQ1-DQ5）

### DQ1：Phase 3 是单主题还是双主题？

**双主题**，但有明确主次：
- 主线：大规模可靠性（大项目基线 + 并发优化 + E2E 测试）
- 支线：AI-Native 输出（AI Essence 格式 + 多 runtime 调研）

支线在主线 Wave 1-2 完成后才启动，避免同时撑两个大方向导致 Phase 2 那种 postmortem 成本。

### DQ2：第一波启动哪 3-4 个 Feature？

Feature 143（基线测量）、144（E2E 测试基础）、145（并发优化）、146（AI Essence）——按依赖顺序分批启动，143+144 可并行，145 依赖 143，146 依赖 144。

### DQ3：Phase 3 预期持续多久？

**4 个月**（约 16-18 周）：
- Wave 1（6-8 周）：F143 + F144 + F145
- Wave 2（4-6 周）：F146 + Python 大型项目验证
- Wave 3（4-6 周）：多 runtime 适配调研 + Cursor/Continue 集成原型
- Buffer + postmortem（2 周）

### DQ4：Python AST 修复（Prompt A）是 Phase 3 的 prereq 还是平行进行？

**平行进行**，不是严格 prereq：
- Python AST patch 作为 v4.x 独立 Feature 启动，目标在 Phase 3 Wave 1 结束前完成
- Wave 2 的"Python 大型项目验证"依赖 Python AST patch 完成
- Phase 3 Wave 1 的 E2E fixture 测试（F144）可以先用 TypeScript 项目作为 fixture 基础

### DQ5：M-101 postmortem 的哪些教训是 Phase 3 的硬约束？

**硬约束（必须在每个 Phase 3 Feature 中执行）**：
1. **L6**（E2E fixture 测试）：Feature 144 正面解决，之后所有 Phase 3 Feature 新增的 pipeline 改动必须有对应 E2E 场景
2. **L4**（性能 SC 含项目规模维度）：所有 SC 必须写明"N 文件项目，< Xs"
3. **L1**（每阶段产物立刻 commit）：Phase 3 Prompt 模板第一步必须 `git fetch + verify spec`，最后步必须 `git add + commit + push`

**软约束（应做但不阻塞提交）**：
- L2（config 覆盖链路可见性）：新增 Phase 3 Feature 时，主动 grep 项目根 yaml 是否有覆盖
- L3（外部 SDK 字段提取）：涉及新 SDK 接口时列出所有子字段

---

## 7. Success Metrics

| 指标 | 目标值 | 测量方式 |
|------|--------|---------|
| 大项目 batch 耗时（500 文件 / full mode） | < 20 分钟 | F143 基线 → F145 并发优化后对比 |
| 大项目 batch token 成本（500 文件） | < $2.00（Sonnet 4.6 价格） | batch-summary.md tokenUsage 汇总 |
| E2E fixture 测试覆盖场景数 | ≥ 5 个场景（TS 小型 / TS 大型 / Python 小型 / Python 大型 / 边界空项目） | `npm run test:e2e` 通过 |
| AI Essence 单模块 token 数 | ≤ 200 tokens | essence 格式验收测试 |
| Python 项目 graph.json 代码节点数 | ≥ N（N = 源文件中 class/def 数量）| 在 Python AST patch 完成后验证 |
| dry-run 预估偏差 | < 3x（从当前 65x 下降） | dry-run 对比实际 token |

---

## 8. Risks & Mitigations

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 大型开源项目 batch 时 LLM API 速率限制 | 高 | 中 | F143 先用小并发跑，逐步提速；使用 `--budget` 硬上限 |
| Python AST patch 延误影响 Wave 2 | 中 | 中 | Wave 2 先做 TypeScript 大型项目验证，Python 部分作为 bonus |
| Cursor/Continue 扩展机制调研结果不支持集成 | 中 | 低 | AI Essence 格式本身仍有价值（可手动粘贴到 cursor rules） |
| 并发优化引入 race condition（L3 类 bug） | 低 | 高 | E2E fixture 测试（F144）必须在 F145 之前完成 |
| graph.json 在 500 文件项目膨胀到 MCP 响应慢 | 中 | 中 | 分层存储（graph 按需加载）列为 Wave 2 候选 Feature |

---

*Blueprint 由 claude-sonnet-4-6 基于 M-102 Proposal + M-101 Postmortem + Spectra v4 集成测试报告生成。决策时间：2026-04-29。*
