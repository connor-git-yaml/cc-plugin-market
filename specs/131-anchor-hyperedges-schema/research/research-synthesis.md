# 产研汇总: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**特性分支**: `131-anchor-hyperedges-schema`
**汇总日期**: 2026-04-19
**输入**: [product-research.md](product-research.md) + [tech-research.md](tech-research.md)
**执行者**: 主编排器（非子代理）

---

## 1. 产品×技术交叉分析矩阵

| MVP 功能 | 产品优先级 | 技术可行性 | 实现复杂度 | 综合评分 | 建议 |
|---------|-----------|-----------|-----------|---------|------|
| Story 1：graph.json schema v2.0（`references` / `conceptually_related_to` / `rationale_for` 边 + `evidenceText` / `evidenceSource` / `confidence` 字段 + `hyperedges` 顶层数组 + schemaVersion 1.0→2.0） | P1（信任链必备） | 高（原地扩展，零破坏性） | 低（类型改造 + 向后兼容判断） | ⭐⭐⭐ | **纳入 MVP，必须独立 commit** |
| Story 2：Chunked markdown embedding → pair edge（Hybrid chunking + Local embedding + 阈值 0.75） | P1（函数级锚定的机械底座） | 高（社区方案成熟） | 中（新增 anchoring 模块 + 处理 ≥512 token chunk） | ⭐⭐⭐ | **纳入 MVP** |
| Story 4：新增 `graph_hyperedges` MCP 工具 + `graph_node` / `graph_community` 适配 | P1（外部消费方入口；API 不变等于能力不可见） | 高（扩展现有 MCP 工具层） | 低 | ⭐⭐⭐ | **纳入 MVP（提升为 P1）** |
| Story 3：LLM Hyperedges 提取（label + ≥3 nodes + rationale + confidence；≤10/batch） | P2（差异化但风险偏高） | 中（LLM prompt 工程 + Zod 降级） | 中（新建 hyperedges 模块 + budget 对接） | ⭐⭐ | **纳入 MVP 但带 feature flag** |
| direction-audit CLI 适配新边类型 | P1（不可破坏 F2.5 交付） | 高 | 低（白名单注册） | ⭐⭐⭐ | **随 Story 1 同批交付** |

**评分说明**：
- ⭐⭐⭐: 高优先 + 高可行 + 低/中复杂度 → 纳入 MVP
- ⭐⭐: 中等匹配 → 纳入 MVP 但带风险控制（feature flag 或 confidence 阈值）
- ⭐: 低匹配 → 推迟

**跨调研一致发现**：Story 4（MCP 工具适配）在产品调研被视为用户感知入口，在技术调研被视为低复杂度扩展；两者一致建议**提升至 P1**，避免"能力做完但外部不可见"。

---

## 2. 可行性评估

### 技术可行性

整体高。技术调研选定 **Local Embedding（`@huggingface/transformers` + `all-MiniLM-L6-v2`）** 作为主方案，`optionalDependencies` 安装，保留"零 API key 可运行"基线；Fallback 为 OpenAI `text-embedding-3-small`（通过 `SPECTRA_EMBEDDING_PROVIDER=openai` 切换，年成本 <$1）。schema v2.0 通过原地扩展 + schemaVersion 联合类型实现，不破坏现有消费方。Hyperedge 通过 Zod 校验 LLM 输出 + 校验失败返回空数组保证流程不中断。

### 资源评估

- **预估工作量**：M（中等）— schema 升级 + 2 个新建模块（anchoring / hyperedges）+ MCP 工具适配 + 单测 + golden-master fixture
- **关键技能需求**：TypeScript 5、Node.js ESM、Zod、`@huggingface/transformers`、Anthropic SDK（已有）
- **外部依赖（新）**：
  - `@huggingface/transformers`（optionalDependencies，~200MB 包体 + ~90MB 模型首次下载）
  - `zod`（若未已有；需确认 `package.json`）
  - 已有依赖可复用：`graphology`、`gray-matter`、`@anthropic-ai/sdk`、F1 budget-gate、F2 SpecStore

### 约束与限制

- 不破坏 F1/F2/F2.5 基线：所有 LLM 调用必须通过 `BudgetGate` 记录 `tokenUsage`；embedding 本地模式也需记录 `durationMs` 和 `llmModel: 'local-embedding'`
- 不碰 F3 领地（`specs/project/technical-debt.md`、`src/debt-scanner/**`）和 `plugins/spec-driver/**`
- schema 升级（v1.0→v2.0）**必须独立 commit**，不与其他改动混合
- 代码读写边界由用户 Prompt 明确锁死：可写 `src/panoramic/builders/doc-graph-builder.ts`、`src/panoramic/anchoring/**`（新建）、`src/panoramic/hyperedges/**`（新建）、`src/mcp/graph-tools.ts`、`src/models/doc-graph-types.ts`
- direction-audit CLI 必须继续通过（新边类型走白名单，不当方向问题处理）

---

## 3. 风险评估

### 综合风险矩阵

| # | 风险 | 来源 | 概率 | 影响 | 缓解策略 | 状态 |
|---|------|------|------|------|---------|------|
| 1 | Embedding 假阳性导致 INFERRED 边噪声淹没正确信号 | 产品+技术 | 中 | 高 | (a) `confidence: INFERRED` 边强制要求 `evidenceText` 非空；(b) 阈值 0.75 作为起点并暴露为可配置；(c) 产品验收标准要求 INFERRED 假阳性率 <20% | 待验证 |
| 2 | Hyperedge 数量失控导致认知负担 | 产品 | 中 | 中 | (a) 每 batch ≤10 个；(b) 产品规则：仅从 design-doc 显式命名的"Pipeline/Stage/Phase"提取，不自动对连通子图建模；(c) `confidence ≥ INFERRED` 才展示 | 待验证 |
| 3 | `@huggingface/transformers` 依赖加载失败或平台不兼容（如 ARM / macOS 特定版本） | 技术 | 低 | 高 | (a) 列为 `optionalDependencies`；(b) factory 检测失败时抛出清晰错误 + 提示启用 OpenAI fallback；(c) CI 覆盖 3 平台（linux-x64 / macos-arm64 / macos-x64） | 待验证 |
| 4 | schema v2.0 破坏下游已有消费方 | 技术 | 低 | 高 | (a) 原地扩展（新增字段全部 optional）；(b) `schemaVersion` 从字面量扩为联合类型；(c) golden-master fixture 双版本（1.0 + 2.0）；(d) 旧消费方代码扫描检查；(e) direction-audit 通过边类型注册表白名单适配 | 待验证 |
| 5 | LLM 输出 hyperedge 不符合 schema | 技术 | 中 | 中 | (a) Zod schema 严格校验；(b) 校验失败返回空数组，**不中断主流程**；(c) 失败样本记录到 trace.md 供 prompt 迭代 | 待验证 |
| 6 | Embedding 调用未记录 tokenUsage 破坏 F1 成本透明度 | 技术 | 低 | 高 | 通过 `BudgetGate` 统一入口；Local 模式也记 `durationMs` 和 `llmModel: 'local-embedding'`；单测覆盖 | 待验证 |
| 7 | 函数级锚定在"纯代码无 design-doc"项目上错误地产出边 | 产品+技术 | 低 | 中 | 诚实降级：零 doc chunk → 零新边 / 零 hyperedge；测试覆盖 5+ 文件纯代码 fixture | 待验证 |
| 8 | `evidence_text` 200 字符截断破坏关键上下文（如跨段的完整引语） | 产品 | 中 | 低 | (a) 从 match 位置向两侧对称扩展直到 200；(b) heading 行整行纳入；(c) 可配置上限但默认 200 | 待验证 |

### 风险分布

- **产品风险**：2 项（高:0 中:2 低:0）— 假阳性噪声、Hyperedge 认知负担
- **技术风险**：4 项（高:0 中:2 低:2）— schema 兼容、LLM 输出不合规、依赖兼容、tokenUsage 遗漏
- **交叉风险**：2 项（纯代码项目降级、evidence_text 截断）

---

## 4. 最终推荐方案

### 推荐架构

在 `src/panoramic/` 下新增 `anchoring/` 和 `hyperedges/` 两个兄弟模块，分别负责 Story 2 和 Story 3，`doc-graph-builder.ts` 作为编排入口串起 v2.0 schema 组装。MCP 工具层通过 `src/mcp/graph-tools.ts` 适配新字段并新增 `graph_hyperedges`。Embedding 通过 `EmbeddingProvider` Strategy Pattern 抽象，工厂函数按 `SPECTRA_EMBEDDING_PROVIDER` 环境变量在 Local / OpenAI 间切换，默认 Local 并静默降级。

```
src/panoramic/
  builders/
    doc-graph-builder.ts      [改] schema v2.0 组装；调用 anchoring/ + hyperedges/
  anchoring/                  [新] Story 2：chunking + embedding + pair edge 生成
    chunker.ts
    embedding-provider.ts     (Strategy interface)
    providers/
      local-provider.ts       (@huggingface/transformers)
      openai-provider.ts      (fallback)
    similarity.ts
    edge-builder.ts           (references / conceptually_related_to / rationale_for)
  hyperedges/                 [新] Story 3：LLM 提取 + Zod 校验
    prompt.ts
    extractor.ts              (走 BudgetGate)
    schema.ts                 (Zod)
src/models/
  doc-graph-types.ts          [改] schema v1.0 → v2.0 类型扩展
src/mcp/
  graph-tools.ts              [改] 适配新字段 + 新增 graph_hyperedges
plugins/spectra/SKILL.md      [改] 工具说明更新
specs/_meta/graph.json        [改-产物] schemaVersion: "2.0"
```

### 推荐技术栈

| 类别 | 选择 | 理由 |
|------|------|------|
| Embedding（主） | `@huggingface/transformers` + `all-MiniLM-L6-v2`（384 维） | 零 API key；数据不出本地；可离线；可确定性测试；成本零 |
| Embedding（fallback） | OpenAI `text-embedding-3-small` | 年成本 <$1；质量更好；通过环境变量切换；用户有 `OPENAI_API_KEY` 概率较高 |
| Chunking | Hybrid（H2/H3 边界 + 段落合并 + 512 tokens 上限） | 对齐 MiniLM 输入上限；保留 `filePath:startLine` 供 `evidenceSource` 回溯 |
| Similarity | Cosine（`graphology` 已间接提供或直接实现） | 标准选择；阈值 0.75 可配置 |
| LLM Hyperedge 提取 | Anthropic SDK（已有）+ Zod 输出校验 | 与现有 LLM 增强链路一致；Zod 失败静默降级 |
| Schema 版本策略 | `schemaVersion: '1.0' \| '2.0'` 联合类型 + 新字段 optional | 零破坏性；消费方按 schemaVersion 分支 |
| MCP 工具扩展 | 新增 `graph_hyperedges`，适配 `graph_node` / `graph_community` | 与现有 MCP 风格一致 |
| direction-audit 适配 | 边类型白名单注册表 | 新边不走方向校验，仅旧有 references 层 |

### 推荐实施路径

1. **Phase 1（独立 commit · Story 1）**：`doc-graph-types.ts` 升级 + `schemaVersion` 联合类型 + direction-audit 白名单 + golden-master fixture（v1.0 + v2.0）
2. **Phase 2（Story 2 + Embedding 选型落地）**：Hybrid chunker + EmbeddingProvider + Local 实现 + pair edge 生成 + tokenUsage 记录
3. **Phase 3（Story 3）**：Hyperedge LLM 提取 + Zod 校验 + budget 对接 + ≤10/batch 限制
4. **Phase 4（Story 4）**：`graph_node` / `graph_community` 适配 + 新增 `graph_hyperedges` + SKILL.md 更新
5. **Phase 5（验证）**：graphify 示例项目实跑（≥10 条函数级边 + 1-3 个 hyperedge）+ 纯代码项目诚实降级验证 + direction-audit CLI 通过

---

## 5. MVP 范围界定

### 最终 MVP 范围

**纳入**：

- **schema v2.0 扩展**：3 种新边类型 + `evidenceText` / `evidenceSource` / `confidence` + `hyperedges` 顶层数组 + `schemaVersion` 联合类型。理由：信任链必备；产品侧 INFERRED 边不带 evidence 实际使用率极低；技术侧原地扩展风险低
- **Hybrid Chunking + Local Embedding + pair edge 生成**：references / conceptually_related_to / rationale_for 边。理由：函数级锚定的机械底座；阈值 0.75 起步，可配置
- **Hyperedge LLM 提取**：label（2-8 字）+ ≥3 nodes + rationale + confidence，≤10 per batch，走 budget-gate，Zod 校验失败静默降级。理由：核心差异化；feature flag 启用以控制风险
- **MCP 工具扩展**：`graph_node` / `graph_community` 新字段适配 + 新增 `graph_hyperedges`。理由：外部可见才算能力完成
- **direction-audit 白名单适配**：新边类型不当方向问题。理由：F2.5 交付契约

**排除（明确不在 MVP）**：

- 图可视化交互 UI（graph.html） → F5 Reading UX
- 自然语言问答 → F5 Reading UX
- 债务节点集成到 hyperedge → F3 后续
- Embedding 远程 API（OpenAI fallback）作为**默认开关** → MVP 只提供实现，默认关闭

### MVP 成功标准

**产品维度**：
- 在 `graphify` 示例项目上，`graph.json` `schemaVersion: "2.0"`
- 至少 **10 条** `references` / `conceptually_related_to` 边连接 design-doc chunk 和代码函数节点，且每条 INFERRED 边都含非空 `evidenceText` 和 `evidenceSource`
- 至少识别出 **1-3 个** hyperedges，其中至少一个对应已知的 "Full Ingestion Pipeline" 类流程
- 新增 MCP 工具 `graph_hyperedges` 可按 `label` / `node_id` 过滤查询
- 在 5+ 文件纯代码无 design-doc 的项目上：诚实降级（零新边、零 hyperedge、不报错、不中断）

**技术维度**：
- `npx vitest run` 零新增失败
- `npm run build` 零错误
- schema v2.0 独立单测 + golden-master fixture（v1.0 + v2.0 双版本）
- `direction-audit` CLI 对新边类型通过
- 所有 LLM + embedding 调用记录 tokenUsage（local 模式记 `llmModel: 'local-embedding'` + `durationMs`）

---

## 6. 结论

### 综合判断

本次 F4 Feature 在产品方向上填补 Spectra 与 Graphify 等竞品的"函数级语义锚定 + Hyperedges"能力差距，差异化点在于 spec 文档 × KG 的双向溯源闭环（doc-section 节点来自 Spectra 自己生成的 spec 文件）；技术方案选定 Local Embedding 作为主路径、OpenAI 作为 fallback，通过 Strategy Pattern 实现两套 Provider 共存，保持"零 API key 可运行"现状；schema 升级通过原地扩展 + `schemaVersion` 联合类型零破坏地完成；LLM Hyperedge 提取通过 Zod 校验 + 静默降级保证主流程不受 LLM 输出不稳定性影响。MVP 覆盖全部 4 个 Story，风险集中在 INFERRED 边假阳性与 Hyperedge 数量控制，两者均有可测量的缓解策略。

### 置信度

| 维度 | 置信度 | 说明 |
|------|--------|------|
| 产品方向 | 高 | 竞品 Graphify 已验证该方向的用户价值；Spectra 差异化点（spec × KG 双向溯源）清晰 |
| 技术方案 | 高 | Embedding 选型、chunking、schema 扩展均有成熟社区方案；LLM 输出校验有明确降级路径 |
| MVP 范围 | 高 | 4 个 Story 均有明确验收标准；Story 4 被双份调研一致提升为 P1 |

### 后续行动建议

- 进入 Phase 2（specify），产出 `spec.md`，把 Story 1-4 转成可测量的功能验收准则
- specify 阶段需要明确：阈值 0.75 的产品侧验收定义（如"假阳性率 <20%"如何测）、Hyperedge 最少个数下限（1 个？3 个？）
- plan 阶段将本汇总的架构分层具象为文件级 diff 计划，并把 schema 升级独立 commit 的规则写入 plan
