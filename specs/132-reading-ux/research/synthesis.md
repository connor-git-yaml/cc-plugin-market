---
feature: F5 Reading UX
branch: 132-reading-ux
phase: research-synthesis
orchestrator_mode: feature
research_mode: full
synthesized_at: 2026-04-20
---

# F5 Reading UX 产研汇总

本文档由主编排器（研发总监）在 Phase 1c 对 [`product-research.md`](./product-research.md) 和 [`tech-research.md`](./tech-research.md) 的串联汇总，目的是给 specify / clarify / plan 阶段一份统一的**决策表 + 风险表 + 待澄清项**，避免两份独立调研被分散采纳。

---

## 1. 核心选型决策（已锁定）

| 维度 | 决策 | 依据 |
|------|------|------|
| 问答架构 | **B+C 混合**：Graph-first BFS 命中候选 → embedding 精排 Top-K → LLM 组装 | tech §1.1；token 便宜 30-100x、离线可用、全部基线可复用 |
| 问答引擎入口 | 扩展 `src/mcp/graph-tools.ts` 的 engine 实例 + 新增 `src/panoramic/qa/` 模块 | tech §1.3 可复用组件清单 |
| 溯源引用形式 | `{ specPath, lineRange, excerpt }` 来自 `chunkMarkdownFiles()` + `buildEvidenceText()` | tech §1.6 |
| graph.html 技术栈 | **复用** `scripts/inline-d3.ts` 的 `D3_FORCE_BUNDLE`（d3-force v3.0.0，~55 KB）+ 扩展 `src/panoramic/exporters/html-template.ts` | tech §2；零新依赖 |
| graph.html self-contained | CSS + D3 + 数据三合一内联，零 CDN | tech §2.6 |
| 轻量模式分派 | `options.mode: 'full' \| 'reading' \| 'code-only'` 参数在 `batch-project-docs` 的 pipeline dispatcher 层分派，**默认 `full`** | tech §3 |
| MCP `batch` tool schema | 新增 `mode` enum 参数 | tech §3.4 |
| LLM 调用合规 | 新问答调用**必须**走 F1 `runBudgetGate()` + 记录 tokenUsage | tech §1.7、CLAUDE.md 代码质量约束 |
| 问答状态模型 | **单轮**（无会话状态），多轮留给调用方组装 | 用户 Prompt "不做" + product §6 |
| Story 优先级 | **P1/P2** 如 Prompt 所定；product 建议 MVP = Story 1+2 必做、Story 3 可延后 | product §4.2 |

---

## 2. 用户价值锚点（已确认）

来自 product-research 的三条**必须超越 Graphify 的差异化点**，作为 spec 验收标准的锚：

1. **溯源跨代码 + 设计决策两个层次**（F4 hyperedges 价值暴露）
   - 问答必须能引用 spec.md 的 `[conceptually_related_to]` 区块内容，不仅是代码行
2. **点击节点直接跳转 spec 文件**（graph.html 差异化点）
   - Graphify graph.html 停在"节点详情弹窗"，Spectra 必须跳一步到"打开 spec"
3. **问答能覆盖 5 类典型问题并 100% 带引用**（RAG 最小验收）
   - "什么调用了 X" / "从 X 到 Y 路径" / "X 对应哪个设计决策" / "最老的 TODO" / "X 属于哪个流程"
   - 后两类强制集成 F3 debt-scanner 和 F4 hyperedges

---

## 3. 待澄清项（留给 clarify 阶段）

### 3.1 ⚠️ 性能目标定义冲突（P0 必须澄清）

tech-research **内部两处结论相矛盾**：

| 位置 | 结论 |
|------|------|
| 执行摘要 §3 | "粗略估算可将 776 秒降至 60-100 秒，性能目标（< 120 秒）可达" |
| 后续建议 §1 | "若目标包含首次 spec 生成则不可达；若目标是增量运行则完全可达" |

**根因**：当前 batch pipeline 的主要耗时在"阶段 4：逐模块 spec 生成"（约 600 秒，包含 LLM 调用）。`--mode=reading` 跳过的产品文档层只占约 80-150 秒。因此：
- 冷启动（无已有 spec 缓存）：`--mode=reading` ≈ 600 秒 → **不可达 < 120 秒**
- 热启动（有 SpecStore 缓存）：≈ 60-100 秒 → 可达

**澄清需求**：F5 Prompt 写的 "graphify 示例项目（5 文件）`--mode=reading` < 120 秒" 是指冷启动还是热启动？如果是冷启动，需要重新定义指标（例如 "`--mode=code-only` 冷启动 < X 秒" + "`--mode=reading` 热启动 < 120 秒"）。

**编排器建议**：在 clarify 阶段通过 AskUserQuestion 让用户明确性能目标的运行场景（冷 vs 热），不在 synthesis 擅自改指标。

### 3.2 问答的独立预算参数（P1）

tech-research 后续建议：是否为问答引入独立 `--qna-budget` 参数，避免和 batch 长任务的 budget 互相影响？

**选项**：
- A. 和 batch 共用 `CLAUDE_BATCH_BUDGET_USD`（简单，但单次问答失败可能被 budget gate 阻断）
- B. 新增独立 `SPECTRA_QNA_BUDGET_USD` 环境变量 + CLI flag（清晰但增加配置面）
- C. Hardcode 一个小额度（例如 $0.05/query）不走 budget gate 阻断，只记账

**编排器建议**：clarify 阶段定，默认倾向 C（最低摩擦，问答是交互级操作不适合"阻断"语义）。

### 3.3 graph.html 节点上限策略（P2）

tech-research §2.5：节点数 > 1000 时需强制关闭 force layout（用静态坐标 + 分页）。当前仓库最大项目有多大？是否需要 F5 包含"大图降级"逻辑？

**编排器建议**：clarify 阶段确认 F5 的节点数目标（< 500 / < 2000 / 无上限）；默认倾向 < 2000（覆盖 graphify 示例项目和 Spectra 自身仓库），更大规模留给 F6+。

### 3.4 `--mode=code-only` 的"design-doc 推断"边界（P1）

tech-research §3.3 提及要跳过"从 design-doc 推断内容"的生成器，但没有列完整清单。需要在 plan 阶段列出**精确的模块级 spec 生成器清单**（哪些走 design-doc、哪些走 AST），并决定 `--mode=code-only` 是否完全关闭 design-doc 路径。

**编排器建议**：plan 阶段产出，不在 clarify 消耗用户时间。

---

## 4. 技术风险表（合并）

| # | 风险 | 来源 | 缓解 |
|---|------|------|------|
| R1 | Graph-first BFS 命中节点数过少（< 3）时 RAG 精排失效 | tech §1.1 | Fallback 到纯 RAG（`anchorDocToCode` 路径）；再失败降级告知"图谱数据不足" |
| R2 | `@xenova/transformers` 首次加载 5-15 秒 + 150-400 MB 内存 | tech §1.1 | 混合方案只在 Top-K 精排阶段用 embedding，不做全量 embed；复用 F4 anchoring 已加载的实例 |
| R3 | Hyperedge 问答的语义对齐依赖 LLM 质量，可能召回不稳定 | tech 摘要 §4 | 在 prompt 里显式列出 hyperedge.label 作为候选，让 LLM 挑选而非发散 |
| R4 | graph.html 在节点数 > 1000 时 force layout 卡顿 | tech §2.5 | 节点数阈值检查：> 1000 自动切静态坐标模式（复用已有 community clustering） |
| R5 | `--mode=reading` 实际性能收益低于预期（待 3.1 澄清） | tech 后续建议 | 在 verify 阶段实际测量，收益不足时降级为文档层跳过 + 日志提示 |
| R6 | 问答答案溯源引用可能漂移到错误 chunk（chunk 边界 vs 语义边界不一致） | tech §1.6 | 强制 citation 含 `{startLine, endLine}`，verify 阶段 E2E 检查每条 citation 可定位到实际 spec 行 |
| R7 | graph.html 自包含时文件体积膨胀（500+ 节点数据 + D3 + CSS） | tech §2.6 | 使用 gzip-friendly 的 minified JSON；超过 5 MB 时输出警告 |

---

## 5. 可复用基线组件清单（来自 tech §1.3）

| 组件 | 路径 | F5 角色 |
|------|------|---------|
| `engine.query()` / BFS | `src/mcp/graph-tools.ts` | 问答 Step 1 |
| `engine.getHyperedges()` | `src/mcp/graph-tools.ts` | 问答 Step 2 + 流程级问答 |
| `engine.getSemanticEdges()` | `src/mcp/graph-tools.ts` | 节点详情展示 |
| `chunkMarkdownFiles()` | `src/panoramic/anchoring/chunker.ts` | 问答 Step 3 |
| `createEmbeddingProvider()` | `src/panoramic/anchoring/providers/factory.ts` | 问答 Step 3 |
| `filterByThreshold()` | `src/panoramic/anchoring/similarity.ts` | 问答 Step 3 |
| `buildEvidenceText()` | `src/panoramic/anchoring/edge-builder.ts` | 问答 Step 5（溯源 excerpt） |
| `runBudgetGate()` + `estimateModuleCost()` | `src/batch/budget-gate.ts` | 问答 Step 7 前的 budget |
| `scanProjectDebt()` → `DebtReport.codeEntries` | `src/debt-scanner/index.ts` | "最老 TODO" 的直接数据源（`ageDays` 已在 entry 上） |
| `buildHtmlTemplate()` + `D3_FORCE_BUNDLE` | `src/panoramic/exporters/html-template.ts` + `scripts/inline-d3.ts` | graph.html 扩展底座 |

---

## 6. 对下游阶段的输入锚

- **specify 阶段**：直接采纳本汇总 §1/§2 作为 Functional Requirements 的骨架；§3 作为 Open Questions 区块；§4 作为 Non-Functional Risks 区块。
- **clarify 阶段**：优先处理 §3.1 性能目标，其次 §3.2 问答预算，其余默认编排器建议。
- **plan 阶段**：§3.4 design-doc 推断边界在 plan 产出精确清单；§5 可复用组件直接进入 plan 的"复用合同"章节。
- **tasks 阶段**：按 Prompt 正文的 5 步实施顺序分解；每步独立 commit。
- **implement 阶段**：严格在读写边界内，新 LLM 调用必走 budget-gate。
- **verify 阶段**：R1-R7 风险每一条有对应验证用例。

---

## 7. 产研一致性检查

- ✅ product §1.3 痛点 C（小项目水土不服）↔ tech §3（`--mode=reading/code-only`）
- ✅ product §1.1 痛点 A（无问答）↔ tech §1（B+C 混合问答）
- ✅ product §1.2 痛点 B（无交互可视化）↔ tech §2（graph.html D3）
- ✅ product §3.3 差异化点（跳转 spec）↔ tech §2.3 交互原型（点击节点打开 spec）
- ⚠️ product §5 建议 MVP = Story 1+2、Story 3 可延后 ↔ Prompt 确定三者均做（Story 3 = P2 但仍在 scope 内）
  - **编排器裁决**：三个 Story 均纳入本轮 scope，Story 3 作为 P2 可在实施阶段遇阻时降级为"最小可用"（节点拖动 + 搜索，跳过高级功能如 hyperedge 可视化），不退出 scope。

---

**结论**：三条调研路径已在技术、产品、风险三个维度收敛。本 synthesis 作为 specify 的唯一输入，specify 阶段不再独立解读 product-research / tech-research 两个长文档。
