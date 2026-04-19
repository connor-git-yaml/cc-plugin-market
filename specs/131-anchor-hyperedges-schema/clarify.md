# Clarifications: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**特性分支**: `131-anchor-hyperedges-schema`
**澄清日期**: 2026-04-19
**状态**: 全部问题已自动闭环，无需决策者介入

---

## Q1 — `rationale_for` 边的自动生成触发条件

**影响**: FR-013 · Story 2（embedding 锚定）· Story 3（LLM hyperedge 提取）

**问题**：`rationale_for` 边是否由 embedding 锚定（Story 2）自动生成，还是仅由 LLM hyperedge 提取（Story 3）附带产出？

**推荐答案**：`rationale_for` 边**仅由 Story 3 LLM hyperedge 提取**附带产出，Story 2 embedding 锚定**不生成** `rationale_for` 边。

**理由**：
- Embedding（cosine similarity）是纯向量匹配，无法区分"这段文档是实现理由"与"这段文档描述了函数用法"；若强行从 embedding 推断"设计意图" vs "功能引用"，势必引入大量假阳性。
- `rationale_for` 的语义（"为什么这么设计"）是高阶推理，天然属于 LLM 能力范畴，而非向量相似度范畴。
- 保持 embedding 通路（Story 2）只生成 `references` 和 `conceptually_related_to`，逻辑判断路径单一，可测试性强；`rationale_for` 边随 Story 3 LLM 输出附带，实现链路清晰，无歧义。
- research-synthesis.md 架构图中 `edge-builder.ts` 的注释也列出了三种边类型，但 LLM 分支才是 `rationale_for` 的产生地。

**spec.md 补丁**：

> 修改 FR-013（第 147 行），将 `[NEEDS CLARIFICATION]` 替换为明确规则：

原文：
```
- **FR-013**：锚定模块生成的语义边类型 SHOULD 按以下规则选择：文档 chunk 直接引用代码函数时选 `references`；概念相关但无直接引用时选 `conceptually_related_to`；[NEEDS CLARIFICATION: `rationale_for` 边的自动生成触发条件是否有明确的 embedding 语义特征，或仅由 LLM 生成？]`[必须]` [对应 Story 2]
```

替换为：
```
- **FR-013**：锚定模块（Story 2 embedding 锚定）生成的语义边类型 SHOULD 按以下规则选择：文档 chunk 直接引用代码函数时选 `references`；概念相关但无直接引用时选 `conceptually_related_to`。`rationale_for` 边**不由 embedding 锚定生成**，仅由 Story 3 LLM hyperedge 提取流程附带产出；提取时 LLM prompt 应明确指示：当某个设计决策文本为代码实现提供了设计理由时，可生成 `rationale_for` 边。`[必须]` [对应 Story 2, Story 3]
```

同时，修改 Open Questions 第 1 条：将 `[NEEDS CLARIFICATION]` 替换为 `[AUTO-CLARIFIED: Story 2 embedding 不生成 rationale_for；仅由 Story 3 LLM 产出 — 理由：向量相似度无法区分"设计意图"语义，高阶推理属于 LLM 能力范畴]`

---

## Q2 — `evidenceSource` 文件路径格式

**影响**: FR-004 · Story 2 · AC-002 · fixture 可移植性

**问题**：`evidenceSource` 的文件路径使用 repo-relative 路径（相对仓库根目录）还是绝对路径？

**推荐答案**：使用 **repo-relative 路径**（相对仓库根目录），格式为 `"<repo-relative-path>:<startLine>-<endLine>"`。

**理由**：
- **fixture 可移植性**：绝对路径包含用户主目录（如 `/Users/connorlu/...`），导致同一 fixture 在不同机器上无法通过 golden-master 比对；repo-relative 路径在任意 checkout 路径下均稳定。
- **MCP 消费方期望**：MCP 客户端（Claude Code 等）通常在 repo 上下文中工作，拿到 repo-relative 路径可直接构造文件读取请求，不依赖运行时的绝对路径解析。
- **行业惯例**：LSP（Language Server Protocol）、代码覆盖率工具（Istanbul/c8）、linter 均以项目根目录为相对路径基准；spec.md 第 127 行 FR-004 文本中已写 `"<repo-relative-file-path>:<startLine>-<endLine>"`，路径格式本已选定为 repo-relative，此澄清仅确认该选择并消除歧义。

**spec.md 补丁**：

> FR-004 文本中已有 `repo-relative-file-path`，但 Open Questions 第 2 条仍标注 `[NEEDS CLARIFICATION]`。

修改 Open Questions 第 2 条：将 `[NEEDS CLARIFICATION]` 替换为 `[AUTO-CLARIFIED: 使用 repo-relative 路径 — 理由：fixture 可移植性 + MCP 消费方期望 + FR-004 原文已采用该格式]`

同时在 FR-004 末尾追加说明（加粗强调）：
```
- **FR-004**：系统 MUST 定义 `evidenceSource` 字段格式为 `"<repo-relative-file-path>:<startLine>-<endLine>"`，其中行号为 1-based 整数，指向 embedding chunk 在原始文件中的位置。**路径必须为相对仓库根目录的相对路径（repo-relative），不得使用绝对路径，确保 fixture 跨设备可移植。**`[必须]` [对应 Story 1, Story 2]
```

---

## Q3 — hyperedge 的 `nodes` 是否允许混合 doc-section 节点和代码函数节点

**影响**: FR-005 · FR-020 · Story 3 · F5 可视化呈现

**问题**：hyperedge 的 `nodes` 是否允许同时包含 doc-section 节点（来自 spec markdown）和代码函数节点？还是 `nodes` 只能引用代码节点？

**推荐答案**：**允许混合**，但 Zod 校验规则要求：`nodes` 中**至少 1 个为代码节点**（`sourceKind` 不为 `doc-section`）。

**理由**：
- hyperedge 的核心价值是"流程级语义锚定"，真实的流程描述往往是"spec 某章节描述了整体流程 + 多个代码函数分别实现了流程的各阶段"——这天然是 doc-section + code 的混合结构。
- 禁止混合会导致两个问题：(a) LLM 需要在 prompt 中过滤掉 doc-section 节点，增加 prompt 复杂度；(b) 丢失了"doc-section 作为流程入口"的语义，AI Agent 无法从 hyperedge 回溯到 spec 章节。
- "至少 1 个代码节点"约束保证 hyperedge 不退化为纯文档节点集合（那样就失去了代码 × doc 双向溯源的核心价值）。
- F5 可视化中，doc-section 节点和代码节点混合在同一 hyperedge 内是合理的展示单元，不增加 F5 的实现复杂度。

**spec.md 补丁**：

修改 FR-005，在 `nodes` 说明中追加约束：

原文（`nodes`（节点 ID 数组，≥3 个））替换为：
```
`nodes`（节点 ID 数组，≥3 个；允许混合包含 doc-section 节点和代码节点，但 MUST 至少包含 1 个代码节点）
```

修改 FR-020，追加混合节点校验规则：
```
- **FR-020**：合法 hyperedge 的 `label` MUST ≤8 字（Unicode 字符计）、`nodes` MUST 包含 ≥3 个有效节点 ID 且**至少 1 个为代码节点**（`sourceKind` 不为 `doc-section`）、`rationale` MUST 非空。不满足任一条件的 hyperedge 视为校验失败。`[必须]` [对应 Story 3]
```

修改 Open Questions 第 3 条：将 `[NEEDS CLARIFICATION]` 替换为 `[AUTO-CLARIFIED: 允许混合，但至少 1 个代码节点 — 理由：真实流程语义为 doc+code 混合结构；纯 doc 超边失去双向溯源价值]`

---

## Q4 — 相似度阈值边界（`>= threshold` 还是 `> threshold`）

**影响**: FR-012 · Story 2（AC-002 验收场景第 2 条）

**问题**：cosine 相似度恰好等于阈值（0.75）时，是否生成语义边？

**推荐答案**：使用 `>= threshold`（包含边界值）。

**理由**：
- 行业标准（scikit-learn cosine_similarity 过滤、FAISS 最近邻搜索等）均采用 `>=` 包含边界的写法；`>` 的语义会导致"恰好 0.75"的 pair 被无声丢弃，对用户来说不符合直觉。
- spec.md 中 AC-002 的验收场景第 2 条（0.80 生成边、0.60 不生成边）未覆盖边界值，此澄清补齐该场景。
- 在浮点数精度下，"恰好等于 0.75"的概率极低，`>=` 和 `>` 实际差异几乎为零，选 `>=` 不引入实质风险。

**spec.md 补丁**：

修改 FR-012，将语义从"≥ 阈值"改为明确的 `>= threshold`：
```
- **FR-012**：锚定模块 MUST 计算 doc-chunk embedding 与图中代码节点 embedding 之间的 cosine 相似度；相似度 **>= 阈值**（默认 0.75，含边界值）的 pair MUST 生成语义边；阈值 MUST 可通过配置项覆盖。`[必须]` [对应 Story 2]
```

修改边界案例（Edge Cases）第 2 条，将 `[NEEDS CLARIFICATION: 是否使用 >= threshold 还是 > threshold？]` 替换为：
```
- **相似度阈值边界**：cosine 相似度恰好等于阈值（0.75）时**生成边**（`>= threshold`，含边界值），与行业标准保持一致。
```

---

## Q5 — `confidence` 枚举命名对齐

**影响**: FR-002 · AC-003 · `doc-graph-types.ts` 外部接口合同

**问题**：spec.md FR-002 使用 `CONFIRMED | INFERRED | SPECULATIVE`，但部分上下文（如最初需求 Prompt）中出现 `EXTRACTED | INFERRED | AMBIGUOUS`。两套命名哪个为准？

**推荐答案**：以 **spec.md 现有的 `CONFIRMED | INFERRED | SPECULATIVE`** 为准，不做变更。

**理由**：
- spec.md 经过 specify 阶段正式产出，`CONFIRMED | INFERRED | SPECULATIVE` 已成为该 Feature 的内部数据合同；FR-002、FR-003、AC-003 均基于该命名写就，修改会造成连锁改动。
- 语义上，`CONFIRMED / INFERRED / SPECULATIVE` 三档与置信度概念更直接对应（高/中/低置信度），比 `EXTRACTED / INFERRED / AMBIGUOUS` 更符合图数据库领域惯例（如 Neo4j、Memgraph 的 provenance 标注）。
- `EXTRACTED` 在语义上描述的是"来源"而非"置信度"，与 `confidence` 字段的语义不匹配；`AMBIGUOUS` 与 `SPECULATIVE` 表达了相似含义但 `SPECULATIVE` 更准确（尚未证实的推测 vs 来源模糊）。
- 若需求 Prompt 中的 `EXTRACTED / INFERRED / AMBIGUOUS` 与外部接口合同有关，应在 SKILL.md 或 MCP 工具文档中做映射说明，不改动内部枚举。

**spec.md 补丁**：

无需修改 FR-002 枚举值。在 FR-002 末尾追加澄清注释：
```
- **FR-002**：系统 MUST 在边类型定义中新增 `confidence` 枚举字段，取值范围为 `CONFIRMED | INFERRED | SPECULATIVE`；所有由 embedding 自动生成的边 MUST 标记为 `INFERRED`。**注：此枚举为内部数据合同，不与外部 `EXTRACTED / AMBIGUOUS` 命名对齐；MCP 工具响应直接透传该枚举值。**`[必须]` [对应 Story 1, Story 2]
```

---

## Q6 — feature flag 命名和默认值

**影响**: FR-017 · Story 3（AC-004）

**问题**：Hyperedge 提取的 feature flag 通过什么方式控制？命名是什么？默认值是关闭还是开启？

**推荐答案**：两种入口并存：
1. **环境变量**：`SPECTRA_HYPEREDGES_ENABLED=true`（默认不设 = 关闭）
2. **CLI 选项**：`spectra batch --hyperedges`（显式开启）

默认**关闭**。

**理由**：
- research-synthesis.md 明确：Story 3"核心差异化但风险偏高"，带 feature flag 纳入 MVP 的目的是"允许在验证质量后推广"——默认关闭是合理的保守策略。
- spec.md FR-017 已明确"feature flag 默认关闭"。
- `SPECTRA_` 前缀与现有环境变量（`SPECTRA_EMBEDDING_PROVIDER`）保持命名一致性。
- CLI `--hyperedges` 选项让开发者在单次 batch 调用中临时开启，不需要修改环境变量，便于调试和验证。

**spec.md 补丁**：

修改 FR-017，在 feature flag 说明中补充具体命名：
```
- **FR-017**：Hyperedge 提取模块 MUST 受 feature flag 控制，flag 默认关闭；启用方式为：(a) 设置环境变量 `SPECTRA_HYPEREDGES_ENABLED=true`，或 (b) 在 `spectra batch` 命令中传入 `--hyperedges` CLI 选项；两种方式均可独立开启，CLI 选项优先级高于环境变量。当 flag 启用时，模块通过 LLM（Anthropic SDK）从 design-doc 中提取 hyperedge，走 BudgetGate 记录 tokenUsage。`[必须]` [对应 Story 3]
```

---

## 决策者介入清单

**无需决策者介入。** 全部 6 个问题均已自动闭环。

---

## 自动解决汇总

| # | 问题 | 自动选择 | 理由摘要 |
|---|------|---------|---------|
| Q1 | `rationale_for` 边生成来源 | 仅 LLM（Story 3）产出，Story 2 embedding 不生成 | 向量相似度无法区分"设计意图"语义 |
| Q2 | `evidenceSource` 路径格式 | repo-relative 路径 | fixture 可移植性 + MCP 消费方期望 + FR-004 原文已采用 |
| Q3 | hyperedge `nodes` 混合节点 | 允许混合，但至少 1 个代码节点 | 真实流程为 doc+code 混合结构；纯 doc 超边失去双向溯源价值 |
| Q4 | 相似度阈值边界 | `>= threshold`（含边界） | 行业标准 + 直觉一致 |
| Q5 | `confidence` 枚举命名 | 维持 `CONFIRMED \| INFERRED \| SPECULATIVE` | spec 内部合同已固化；语义比 EXTRACTED/AMBIGUOUS 更准确 |
| Q6 | feature flag 命名和默认值 | `SPECTRA_HYPEREDGES_ENABLED=true` + `--hyperedges` CLI，默认关闭 | 与现有命名规范一致；保守策略符合 research 建议 |
