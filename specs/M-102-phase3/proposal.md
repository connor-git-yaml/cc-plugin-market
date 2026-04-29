# Milestone M-102: Phase 3 — 主线方向提案

> **状态**: 🟡 Proposal（候选方向，待主理人决定，未启动实施）
> **创建日期**: 2026-04-26
> **前置**: [M-101 Phase 2 已闭环](../M-101-phase2-reading-platform/blueprint.md) + [Phase 2 Postmortem](../M-101-phase2-reading-platform/postmortem.md)

---

## Phase 3 该做什么 — 4 个候选方向

Phase 2 把 Spectra 做成了"代码阅读平台"，Phase 3 必须解决"接下来用户最痛的是什么"。下面是 4 个候选方向，按预期 ROI 排序。

---

### 方向 A：F6 Integrate — Spectra × Graphify 深度集成（Vision 兑现）

**用户痛点**：
- Phase 2 对比测试证明 Graphify 在"零 token 图拓扑导航 + God Node 识别 + 跨语料知识图"上独特强
- Spectra 在"分层叙事文档 + 设计意图锚定 + ADR 结构化"上独特强
- 两者抽象层不同，**用户为什么要二选一？**

**解决方案**：
- Spectra batch pipeline 最后一步可选调用 Graphify（library 模式 / CLI 模式）生成"兼容视图"
- Spectra 模块 spec 引用 Graphify 的 God Nodes 作为"核心抽象锚点"
- Spectra ADR 通过 Graphify 的 `rationale_for` 边自动追踪"这个决策影响了哪些代码"
- Coverage Report 基于 Graphify 的 `isolated_nodes` 检测 orphan 函数
- 输出：Spectra 叙事文档 + Graphify 可查询图 + 双向交叉引用

**前置调研**（必做，1-2 人天）：
- Graphify 是否提供 Python library API？还是只有 CLI？
- Graphify graph schema 和 Spectra v2.0 schema 兼容性如何？
- 如果只有 CLI 能用，subprocess 调用的稳定性 / 错误处理 / 性能开销
- Graphify 作者是否愿意配合调整？还是要 fork

**Effort**: 4-6 人周（含调研）
**Risk**: 高 — 依赖外部项目稳定性，可能需要 fork
**ROI**: 高 — 用户可获得"两个工具的全部价值，零额外切换成本"

**Phase 2 留下的开关**：
- Spectra 已支持 graph.json schema v2.0 + hyperedges + 函数级锚定，集成层只需新增 adapter，**核心数据模型不需要改**
- F2.5 删除原子 skill 后入口已统一，集成不会引入"双份入口"

---

### 方向 B：大型项目（500+ 文件）的实战优化

**用户痛点**：
- Phase 2 的所有验证都在 graphify 示例（5 文件）+ 本仓库 dogfood（~125 features） 上做
- **没有真正在 500+ 文件 monorepo 上跑过**
- F5 SC-001 的"5 模块 < 120s"假设过于乐观（见 Postmortem L4），未经大项目验证

**潜在问题**（基于 Phase 2 教训推测）：
- LLM 调用顺序串行 → 大项目动辄 30+ 分钟
- graph.json 节点 / 边数膨胀 → MCP 工具响应慢
- frontmatter cache 命中率未优化 → 增量场景仍然慢
- 自然语言问答（F5）的 RAG 检索在大项目可能漏召回

**解决方案候选**：
- LLM 调用并行化（concurrency 默认 1 → 3-5，按 budget gate 控制）
- graph.json 分层存储（>5,000 节点切片，按需加载）
- Embedding cache 层（chunk-level hash，命中跳过 embedding）
- 自然语言问答的 retrieval 评估 + chunk size 调优

**前置调研**：
- 找 1-2 个真实 500+ 文件项目（开源 Khoj / Continue / ai-engineer-toolkit / 等）跑一次 baseline
- 量化"大项目 vs 小项目"的瓶颈差异

**Effort**: 4-6 人周
**Risk**: 中 — 大项目场景多样，单次优化可能 cover 不全
**ROI**: 高 — 决定 Spectra 能否进真实 production 团队

---

### 方向 C：spec-driver 平台化深化

**用户痛点**：
- Feature 133 (orchestration-overrides) 已经引入"项目级流程定制"，但用户**不知道有这个能力**（推广是本次文档的工作之一）
- 团队级使用还需要：
  - **租户隔离 / 多项目共享配置**（base config 库）
  - **Gate 决策的审计日志**（谁批准了 GATE_VERIFY skip）
  - **Run 历史 + 回放**（同一 spec 跑过多次，结果对比）
  - **Failure recovery 的 skill**（中断后自动恢复，类似 spec-driver-resume 但更智能）

**解决方案**（拆成 3-4 个小 Feature）：
- C-1: Org-level base config（多项目共用的"组织 orchestration 模板"）
- C-2: Gate decision audit trail（写到 .specify/runs/，附决策人 + 时间 + 理由）
- C-3: Spec run 历史 + diff（同一 spec 在不同 model / preset 下跑的结果可对比）
- C-4: 智能 failure recovery（基于 .specify/runs/ 自动决定从哪个 phase 接续）

**Effort**: 6-8 人周（4 个小 Feature 累加）
**Risk**: 低 — 都是已有架构的扩展，不引入新外部依赖
**ROI**: 中 — 对单人用户价值有限，对团队 / 组织价值大

---

### 方向 D：新主线 — Reverse Engineering for AI（让 AI 反向"理解"代码）

**新发现的用户痛点**（来自 dogfood 体验）：
- 现在 Spectra 是"AI 帮人理解代码"，但很多场景需要的是 "**AI 帮 AI 理解代码**"：
  - Claude Code 在 codebase 跑 task 时，频繁重复读同样的文件
  - Cursor / Copilot 缺少"项目语义索引"，每次都从零理解
  - Spectra 的输出（spec / graph）**没有针对 AI consumption 优化**

**解决方案候选**：
- AI-optimized output format（除 .md 外，新增"AI prompt-friendly" 紧凑格式：每模块 200 token 以内的 essence）
- MCP tool 的"渐进探索 API"（按需拉数据，不一次性塞）
- 多 AI runtime 适配（不只 Claude Code，覆盖 Cursor / Continue / Aider / OpenCode）
- 让其他 AI 编辑器**自动**用 Spectra 的输出 — 通过插件 / hook / agent

**前置调研**：
- 调研 Cursor / Continue / Aider / OpenCode 的扩展机制
- 量化"AI 消费 Spectra 输出 vs 自己读源码"的 token 节约

**Effort**: 5-7 人周
**Risk**: 中 — 多 runtime 兼容性维护成本高
**ROI**: 极高 — 把 Spectra 从"个人工具"做成"AI 生态基础设施"

---

## 优先级矩阵

| 方向 | Effort | Risk | ROI | 短期价值 | 长期价值 |
|------|:------:|:----:|:---:|:--------:|:--------:|
| A. F6 Integrate（Graphify） | 4-6 周 | 高 | 高 | 立竿见影 | 中（依赖外部）|
| B. 大项目实战优化 | 4-6 周 | 中 | 高 | 中 | 高 |
| C. spec-driver 平台化深化 | 6-8 周 | 低 | 中 | 弱 | 中 |
| D. AI for AI（多 runtime + AI-optimized）| 5-7 周 | 中 | 极高 | 中 | 极高 |

---

## 推荐决策路径

### 推荐组合：B + D（错峰并行，6-12 周）

**理由**：
1. **B 大项目优化** 是 Phase 2 留下的最现实债务（性能在大项目未验证），必须做
2. **D AI for AI** 是最有想象力的新主线，把 Spectra 做成基础设施
3. **A F6 Integrate** 是 Vision 但依赖外部项目，**先调研别立刻动**
4. **C 平台化深化** 价值偏团队，等用户群扩大再做

### 启动顺序建议

```
Week 1:  ✅ Phase 2 文档化交付（本次工作）
Week 2-3: B 启动 — 找 1 个真实大项目跑 baseline，定瓶颈
         + 同时启动 A 调研（1-2 人天，决定是否 ship）
Week 4-7: B 主线优化（concurrency / cache / 分层存储）
Week 8-9: D 启动 — Cursor/Continue 适配调研 + AI-optimized format 原型
Week 10-12: D 主线（多 runtime 适配 + 渐进探索 API）
```

A 的调研结果决定：
- 调研 PASS → A 在 Week 8 之后并行启动
- 调研 FAIL（Graphify API 不稳定 / 不可集成）→ A 归档，资源给 D

---

## 不推荐做的事（Phase 3 反清单）

1. ❌ **不再做表层 UX 增强**（如更多 graph.html 主题、更多 bundle 角色）— Phase 2 已经把表层做到位，再加是边际效用递减
2. ❌ **不重构核心 pipeline**（除非有 P0 性能瓶颈）— SpecStore + sourceKind + budget-gate 三层抽象在 Phase 2 已稳定
3. ❌ **不引入新 LLM provider**（除非用户明确要 GPT-5 / Gemini）— 当前 Anthropic + Codex 双 runtime 已经覆盖主要场景
4. ❌ **不做"图自动美化"**（如自动布局、节点聚类视化）— 优先级低，可作为单独 chore

---

## 决策需要

主理人需要决定：
1. 推荐组合 B + D 是否合适，还是优先级要调整？
2. A 的调研先做（1-2 人天）还是 defer？
3. 启动顺序是否调整（如先 D 后 B）？

回答上述后即可启动 Phase 3 第一波（B 或 D 的第一个 Feature）。

---

## Resolution

Phase 3 主题已在 M-103 Blueprint 选定为：**"大规模可靠性（B）+ AI-Native 输出（D 的子集）"**

**理由（基于 4 份材料的客观证据）**：

1. **B（大项目实战优化）确认为最现实债务**：Spectra v4.0.0 三方对比报告验证时使用 karpathy/micrograd（6 文件），M-101 postmortem L4 教训明确指出"5 模块 < 120s"假设未在真实大项目验证。Phase 3 必须先建立 500+ 文件项目的实测基线，才能说 Spectra "生产就绪"。

2. **Python AST 失败（P0）改变了原 Proposal 的排序假设**：M-102 Proposal 在写 D（AI for AI）时隐含了"各语言 MCP 图工具可用"的前提，但 Python 项目的 graph.json 完全没有代码节点，所有 MCP graph 工具在 Python 项目上形同虚设。Python AST 修复作为 v4.x patch 独立进行，Phase 3 在其完成基础上拓展 Python 大型项目场景。

3. **D（AI for AI）的高 ROI 不变，但范围收窄**：Phase 3 先做"AI Essence 输出格式"（单模块 ≤200 token 机器可读摘要），这是 D 的核心价值落地，多 runtime 适配（Cursor/Continue 集成）列为 Wave 3 调研事项，不强制承诺交付。

**Python AST 真相对各候选的影响**：
- **A（F6 Graphify 集成）**：归档。Python AST 修复后，Spectra 自身可以提取 Python 图数据，Graphify 集成的差异化价值降低。外部依赖风险（fork 风险）不变，延期评估。
- **C（spec-driver 平台化）**：归档。价值偏团队多人场景，当前主要用户是个人/小团队，等用户群扩大再做。

**未选中的候选**：
- 方向 A（F6 Graphify 集成）→ 归档，等 Python AST 成熟后重新评估集成价值
- 方向 C（spec-driver 平台化深化）→ 延期，列为 Phase 4 候选
- 方向 D 的多 runtime 全量适配 → 缩减为 Wave 3 调研阶段，不列为 Phase 3 承诺交付

详见 `specs/M-103-phase3-scale-ai-native/blueprint.md`。

Resolved at: 2026-04-29
