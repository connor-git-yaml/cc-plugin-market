# Research Synthesis — Feature 140

> **状态**：fast-track 跳过 product-research / tech-research，因 3 个 seed 文档已包含完整调研结论
> **创建**：2026-04-28

---

## 调研路径说明

本 Feature 跳过 spec-driver 标准 research 流程的原因：

1. **product-research 已完成**：业务需求由 [01-feature-plan.md](./01-feature-plan.md) §一/§二/§三 直接固化，含 6 子能力详细范围、Open Questions Q1-Q15 决议、DoD 10 条
2. **tech-research 已完成**：技术调研结果在 [02-mapreduce-architecture.md](./02-mapreduce-architecture.md) §一，覆盖 4 个外部参考系统（Microsoft GraphRAG / LangChain MapReduce / Cursor / Cody / LLMxMapReduce 论文）+ 4 类反模式
3. **架构决策已锁定**：架构文档 §二-§十二 完整定义 cluster orchestrator 接口、3 个生成器 pipeline 改造、风险登记表、决策日志

---

## 关键调研结论速览

### 来自 product-research（业务侧）

- **6 类质量问题**（详见 01-feature-plan.md §三）：ADR hallucinate / hyperedges 失效 / narrative template化 / --include-docs 半实现 / graph.html 不一致 / context 不可观测
- **决策日志 Q1-Q15**：所有 Open Question 全决议，禁止 re-litigate（见 01-feature-plan.md §决策日志）
- **预期工作量**：22-30 人天（v3 架构升级后）

### 来自 tech-research（技术侧）

- **MapReduce 模式选型**：基于 Microsoft GraphRAG（社区聚类） + LangChain MapReduce（Map/Reduce 分模型） + Cursor/Cody（语义切块）
- **核心抽象**：`src/panoramic/cluster-orchestrator.ts`（3 个生成器复用）
- **关键设计**：Sonnet map / Opus reduce / Louvain 聚类（复用现有）/ maxSize=15 / chunk budget 100k
- **明确不做**：10 项过度设计（多层级 hierarchy / recursive reduce / embedding dedup 等）

### 来自 codebase-scan（已隐式完成）

- ADR pipeline 当前是 8 个 hardcoded candidate 函数（详见 01-feature-plan.md §二）
- hyperedge 集成函数 `runHyperedgeIntegration` 已实现，问题在触发条件
- context-assembler 已存在，改造它即可
- --include-docs CLI 链路已实现，spec 生成路径未消费 extraction 结果
- 现有社区检测用 `graphology-communities-louvain`（不是 Leiden）

---

## 不做额外调研的理由

| 标准 research 阶段 | 跳过理由 |
|------------------|---------|
| product-research | 6 子能力业务范围、Open Q 决议、DoD 已在 seed 文档完整定义 |
| tech-research | MapReduce 架构、cluster orchestrator 设计、外部参考系统已在 seed 文档完整调研 |
| online-research | seed 文档已基于 Microsoft GraphRAG / LangChain / Cursor 等做调研，本次不需补充 |

如 spec / plan / tasks 阶段在执行中发现需要补充调研，将单独写入 `research/supplementary-*.md`。

---

## 权威 seed 文档（按重要性）

1. [01-feature-plan.md](./01-feature-plan.md) — 业务范围 + 决策日志（**禁止重新决议**）
2. [02-mapreduce-architecture.md](./02-mapreduce-architecture.md) — 技术架构（**权威**）
3. [00-roadmap-context.md](./00-roadmap-context.md) — 三 Feature 路线图

后续阶段（specify / plan / tasks / implement）必须以这 3 个文档为输入，生成详化的 spec.md / plan.md / tasks.md。
