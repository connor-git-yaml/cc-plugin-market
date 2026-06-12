---
title: 领域知识 AI 脚手架 — 通用解决方案（厂商 SDK 知识内化 + 三方知识导入 + 工作流双库联查）
status: proposal (调研完成，方案综合于主线程；Phase 1 拟入 M8 轨道 C = F190，Phase 2/3 列 M9)
created: 2026-06-12
origin_requirement: 厂商 PaaS SDK 类业务（如无人机行业 SDK）希望基于我们的 CC plugin 体系构建"精通其 SDK 的 AI 脚手架"，集成商开箱即用；本方案做通用化抽象，不依赖任何具体厂商的文档/代码
research: 主线程经 Perplexity 4 域调研（知识内化选型 / 产品形态先例 / 异构 ingestion / 工作流注入模式）+ 仓内资产盘点（原计划 workflow 5-agent 因订阅月度限额失败，降级主线程亲自执行，结论质量未受影响）
adversarial_review: codex exec 直调（2026-06-12，5 critical / 6 warning 全采纳）——CJK tokenizer 硬课题、GraphRAG 否决措辞降级为"非 Phase 1 默认"+反例边界、估时 4-5d→5-7d、spec-driver 注入移出 MVP（schema 白名单实证）、kb_api_lookup 改名 kb_doc_lookup、untrusted-evidence 信任边界、recall@k 验收门禁、vendor>project 固定仲裁改双呈现
related:
  - milestone-M8-trust-repair-and-drift-flagship.md (轨道 C F190 = 本方案 Phase 1)
  - 输入样本: 厂商文档形态 = llms.txt 索引 + Markdown 文档集（已有现成 Go CLI 可批量下载）；三方知识样本 = 行业客户官网 / 会议纪要 / 口述需求
---

# 领域知识 AI 脚手架 — 通用解决方案

## 0. 诉求抽象（不绑定具体厂商）

| 角色 | 输入 | 要求 | 消费方式 |
|------|------|------|---------|
| **SDK 厂商** | 官方文档（llms.txt + Markdown 集）+ SDK 源码 | 内化**效果最佳，构建成本不是约束**；构建一次随 plugin 分发 | 集成商安装厂商定制 plugin → **开箱即用** |
| **集成商/客户** | 行业 know-how：客户网站 URL、会议纪要、口述需求等异构低结构源 | **导入效率 + 格式泛化 + 效果**三平衡 | 项目内运行时导入，与厂商库共存 |
| **开发者（集成商工程师）** | — | Feature/Story/Fix 工作流中**规划需求、查 bug、质量门禁**三环节自动联查双库 | spec-driver 工作流内无感/低摩擦消费 |

硬约束：**避免过度设计，优先效果与稳定性**。

## 1. 调研结论（证据驱动的选型，含被否决项）

### 1.1 知识内化引擎：❌ Microsoft GraphRAG → ✅ 「结构化轻图 + FTS + agentic 按需下钻」混合

用户点名候选 RAG / GraphRAG / Agentic RAG / Graphify 的调研裁决：

| 候选 | 裁决 | 证据 |
|------|------|------|
| **Microsoft GraphRAG** | ⛔ **不作为 Phase 1 默认路线**（非"技术否决"——codex 对抗审查校正措辞）| 独立评测：indexing $50-200 / 500 页、比 vector RAG 贵 10-40×、小语料数小时；2026 复评（"Do We Still Need GraphRAG?"）显示在**常规 API/事实查询上不优于强 vector RAG 基线**。**反例边界（保留）**：跨文档"connect the dots"/全局综合（版本迁移指南、兼容矩阵、行业流程类问题）正是其优势区间——若 Phase 2 评测发现此类问题占比高且我们的文档结构图+实体层不够，GraphRAG 式社区摘要是明确升级候选；其默认输出为磁盘 parquet 表，打包并非不可行（codex 核实官方文档），只是工程面更重 |
| **朴素 vector RAG** | ⚠️ 仅作补充 | 局部事实查询最具性价比、SQLite/Parquet 可打包；但多跳/跨文档弱，且业界实证 coding agent 场景 embedding 检索整体弱于 agentic search |
| **LightRAG（轻量图 RAG）** | ✅ 思路吸收 | ~70-90% GraphRAG 质量 @ ~1/100 索引成本；**原生增量更新**（新文档单独抽取合并，无需全量重建）；file-backed 产物可打包。我们不直接引依赖，而是吸收其「实体图 + 双层检索」思路用自有 graph 基建实现（理由见 1.4 复用盘点） |
| **Agentic RAG / agentic search** | ✅ **主范式** | coding agent 领域 2025-2026 主导结论："inline grep 在所有 harness-model 对上胜过 inline vector retrieval"；WarpGrep 类 RL agentic 检索 F1 0.73@3.8 步 vs embedding 0.72@12.4 步；Anthropic 自家路线即 agentic search + 工具按需调用（code-execution-with-MCP -98.7% token）。**我们的 17 个 MCP 工具本来就是这个范式** |

**最终选型**：
- **SDK 源码侧**：直接复用 Spectra（tree-sitter AST → code knowledge graph + impact/context/graph_* 工具）——业界已证明 agentic 工具循环就是代码检索最优解，无需为代码建 embedding 索引
- **厂商文档侧**：三件套（全部可序列化打包）：
  1. **文档结构图**：llms.txt 目录树 + 文档间引用 → doc-graph（复用 panoramic doc-graph-builder 思路泛化到外部文档）
  2. **API 实体层**：LLM 离线抽取 API/参数/错误码/版本/前置条件 为图节点，挂 来源文档锚点 +（可用源码时）**SDK 符号锚定**——"成本不是约束"的预算花在这里（一次性离线、效果最佳处）
  3. **全文检索层**：SQLite FTS5（**零外部服务**、单文件可打包；Node 侧依赖三选一在 plan 阶段定：`node:sqlite` 内置模块 / better-sqlite3 native / WASM sqlite，跨平台打包风险各不同——codex 校正"零运行时依赖"表述）。🔴 **CJK 分词是 Phase 1 硬课题**（codex critical，对照 sqlite.org/fts5 官方文档核实）：默认 `unicode61` tokenizer 不切中文词、`trigram` 对 <3 字符查询失效——而本方案的原始场景就是中文厂商文档。Phase 1 必须明确 tokenizer 策略（候选：写入侧 CJK 按字 bigram 预切 / jieba 类分词预处理 / trigram+查询侧改写组合）并配**中文回归集**作验收门禁；FTS 查询转义同步处理（`M300-RTK` / `foo.bar()` / `E-001` 类 API 符号与错误码 token 不被误切/报错）。不引向量库（维护成本 + 业界证据不支持其在本场景的必要性）；**向量 rerank 不是"可选项"而是"质量门驱动的明确升级路径"**：检索质量验收（见 §3 Phase 1 验收）不达标即触发 |
- **检索消费**：MCP 工具按需查询（token 经济最优）+ MCP server `instructions` 字段全局导览（直接复用 M8 F184 触发率工程的抓手与 A/B 设施）

### 1.2 产品形态：plugin 打包预建知识库 — 先例确认成立

- 业界收敛形态 = **MCP server 作为知识管道**（Kapa.ai 一键 Docs MCP、Inkeep MCP endpoint、Context7 MCP-first）；Claude Code plugin 生态已有**预打包知识/本地索引先例**（Context7 plugin、Zilliz claude-context 本地向量索引、社区 private-KB MCP）
- 我们的 marketplace 机制实测支持：plugin = 整目录分发（`plugins/<name>/` 含 `.claude-plugin/plugin.json` + skills/hooks/scripts），安装即整目录落缓存 → **`kb/` 预构建数据文件随 plugin 分发可行**（F176 已实测核验过缓存内容）
- **llms.txt 现状**：~844k 站点采用、devtools 圈事实约定（Anthropic/Stripe/Vercel/Mintlify 自动生成），但无官方平台承诺（Google 明确不用）→ **作为一等输入格式支持，但方案不押注它**（输入抽象为"Markdown 文档集 + 可选 llms.txt 索引"，无索引时退化为目录扫描）
- 交付边界参考业界：**厂商自助 CLI 构建**（我们提供工具与模板，厂商跑构建、拥有并分发其定制 plugin），我们不做托管

### 1.2.5 形态对比：离线 vs 在线 vs LLM Wiki（组合决策，2026-06-12 用户确认）

「离线/在线」是*知识放哪*的轴，「检索式/Wiki 式」是*知识长什么样*的轴——三者非互斥可组合：

| 维度 | 离线打包（本方案）| 在线托管（Kapa/Context7 式 remote MCP）| LLM Wiki（DeepWiki 式预整编）|
|------|------|------|------|
| 网络依赖 | ✅ 零（行业集成商常在内网/现场，近硬约束）| ❌ 断网即废 + 限流/认证 | 取决于部署（产物可离线打包）|
| 项目侧机密 | ✅ 永不出本地 | ❌ 客户纪要传云端不可接受 | 同部署 |
| 知识新鲜度 | ⚠️ 随 plugin 发版（月度节奏可接受）| ✅ 即时 | ❌ 更新=整本重生成 |
| 精确查询（API/错误码）| ✅ 检索原文 | ✅ | ❌ 预消化摘要，长尾细节弱 |
| 全局理解类（入门/架构/迁移）| ⚠️ 拼 chunk 费 token 且碎 | ⚠️ 同左 | ✅ **强项**，读一页顶检索十次 |
| 运维/商业边界 | ✅ 厂商自助 CLI、零服务 | ❌ 托管=另一种商业模式 | 一次性离线生成 |
| 厂商使用遥测 | ❌ | ✅ 独有优势 | — |

**组合决策**：
1. **离线分发底座不动摇**（内网/机密/零运维三条硬需求，在线全踩雷；在线真实优势在月度更新节奏下不构成翻盘）
2. **LLM Wiki 是该吸收的知识形态而非竞争形态**——Spectra batch 本就是"代码库 → LLM wiki"（9-section spec + 蓝图），把范式扩到外部文档 = Phase 2 在实体层旁加 **LLM 整编概述层**（快速上手/架构总览/常见任务 howto 预生成页），恰好填补检索式在全局理解类问题的弱项，也是被降级的 GraphRAG 优势区间的便宜替代；"厂商侧成本不限"预算正该花在这
3. **在线留接口不做实现**：`kb_sources` 分层天然可容纳 remote source kind（同一 MCP 工具接口换后端），厂商真要实时更新+遥测时加适配器即可

### 1.3 三方异构导入：轻量三档管线

| 来源 | 方案（调研推荐组合）| 档位 |
|------|----------------------|------|
| 网站 URL | Jina Reader 主链（中文政企站/PDF 附件/动态等待兼容好）→ Firecrawl 兜底（强交互页）→ trafilatura 批量补充 | 自动 |
| 办公文档 | MarkItDown 轻量转换为主（够用优先）；重版面/扫描件升级 Unstructured/Docling | 自动+确认 |
| 会议纪要/口述需求 | 四步流水线：结构化抽取（Decision/Task/Constraint/Person schema）→ 实体消歧 → 关系归并 → 入项目库（带来源+时间戳）| LLM 加工+人工确认 |

**质量护栏**（调研最佳实践）：来源白名单 / 正文长度与噪音比阈值 / 低信息密度检测 / **导入预览确认**（用户看到"将导入 N 条知识，摘要如下"再落库）。
**知识分层**（关键架构决策）：**厂商库（plugin 内只读）与项目库（项目 `.{tool}/kb/` 可写）物理分离**；厂商更新 plugin 不碰项目知识。冲突仲裁（codex 校正：固定 vendor>project 欠设计——项目知识可能是特定 SDK 版本适配、现场补丁、厂商 bug workaround）：**Phase 1 只做双呈现 + 强制标来源/时间戳，不做自动仲裁**；Phase 2 引入 version/time/source-confidence 共同决策的仲裁策略。
**信任边界**（codex critical 新增）：KB 内容（尤其项目库的三方导入物）一律按 **untrusted evidence** 消费——只能作为带来源引用的资料呈现，**绝不拼接为 instruction**；查询结果带 source/version trace + token cap，防 prompt-injection 经知识库进入工作流。

### 1.4 工作流注入：分层混合（调研四模式对比 + 我们 F176 实测教训）

调研结论与 F176 实测一致：单一模式都不够，**"工具可见 ≠ 工具被用"是首要风险**（F176：16/30 run 零调用）。三环节推荐：

| 环节 | 注入模式 | 落点 |
|------|---------|------|
| **规划需求**（spec/plan）| 编排器预查注入（不依赖子代理自觉）：spec-driver research/plan phase 自动以需求关键词调 kb 查询，结果作为上下文注入 | spec-driver phase 扩展 + project-context `knowledge_sources` 字段 |
| **查 bug**（fix 诊断）| MCP 按需查询 + 强引导：错误信息/错误码 → `kb_api_lookup`（known-issues/错误码表/版本兼容）；fix skill 诊断阶段写入"先查厂商库"硬引导 | fix SKILL 诊断 prompt + KB MCP 工具 |
| **质量门禁** | 轻量机械校验：plan/implement 审查时对引用的 API 实体做存在性 + deprecated + 前置条件校验（图谱精确匹配，非 LLM 判断）；客户侧约束（行业合规 know-how）作为 gate 检查清单注入 | spec-driver gate 扩展 + `kb_api_lookup` 批量模式 |

System-prompt 静态注入仅承载一句顶层策略（"涉及 SDK 细节先查厂商库"）；MCP server `instructions` 承载工具导览与典型链路（F184 同款抓手）。

### 1.5 仓内资产复用地图

| 已有资产 | 复用方式 |
|---------|---------|
| Spectra batch + code knowledge graph + 17 MCP 工具 | SDK 源码侧**直接用**（厂商构建时跑 `spectra batch`，graph.json 一并打包）|
| panoramic doc-graph-builder + natural-language query | 文档结构图的实现基础（需泛化：输入从 specs/ 扩到任意文档目录）|
| graph schema v2（references/conceptually_related_to/rationale_for + hyperedges）| API 实体↔文档↔SDK 符号的承载格式（无需新 schema 体系）|
| F174 fuzzy match（canonicalize + resolveSymbolFuzzy）| API 实体名容错查询 |
| F179/F181 byte-stable + 单一权威 resolver | 知识库构建可复现性的地基 |
| marketplace plugin 机制 + F170a namespace 体系 | 厂商定制 plugin 的分发底座 |
| spec-driver project-context / orchestration / gate | 工作流注入点（已有扩展机制，不需要新框架）|
| **F189 spec drift 的 AST 锚定引擎（M8 旗舰）** | **同构技术**：spec 实体↔symbol 锚定 与 文档 API 实体↔SDK 符号锚定是同一套底层能力 → Phase 2 与 F189 合用锚定引擎，互相摊薄成本 |
| **F184 触发率工程（M8）** | instructions/description 改造 + A/B 评测设施直接服务 KB 工具的 adoption |

**Gap（需新建）**：外部文档 ingestion（抓取/解析/llms.txt 消费）、API 实体 LLM 抽取管线、FTS 检索层、KB MCP 工具组、导入预览 UX、置信度分层仲裁。

## 2. 方案总览：三件套

```
┌─ 厂商侧（离线构建，效果优先）──────────────────────────┐
│ scaffold-kb CLI（新）                                    │
│   输入: llms.txt URL / 文档目录 + SDK 源码路径(可选)      │
│   产出: kb/ ── doc-graph.json（文档结构+引用图）          │
│           ├── api-entities.json（API/参数/错误码/版本图） │
│           ├── chunks.sqlite（FTS5 全文层）               │
│           └── code/graph.json（spectra batch 产物）      │
│   打包: 厂商定制 plugin（kb/ + KB MCP server + skills）  │
└──────────────────────────────────────────────────────┘
┌─ 集成商侧（运行时，效率优先）─────────────────────────┐
│ KB MCP server（新，复用 Spectra MCP 骨架/契约/telemetry）│
│   kb_search / kb_api_lookup / kb_ingest / kb_sources     │
│   厂商库(plugin 只读) + 项目库(项目内可写) 双层联查        │
└──────────────────────────────────────────────────────┘
┌─ 工作流侧（spec-driver 集成）─────────────────────────┐
│ 规划: phase 预查注入 │ 查bug: 诊断强引导 │ 门禁: API 机械校验 │
└──────────────────────────────────────────────────────┘
```

## 3. 分阶段（避免过度设计的 scope 切割）

| 阶段 | 内容 | 不做 | 验收 |
|------|------|------|------|
| **Phase 1 = F190（M8 轨道 C，MVP）** | scaffold-kb CLI（llms.txt/目录 → doc-graph + FTS sqlite，**含 CJK tokenizer 决策**）；KB MCP server 2 工具（`kb_search` / `kb_doc_lookup` 文档锚点版——codex 校正：不叫 kb_api_lookup，那个名字留给 Phase 2 实体版，避免暗示能校验参数/deprecated）；plugin 打包验证（demo 厂商 plugin 用真实公开 SDK 文档构建，中文/英文各一套 fixture）| spec-driver 预查注入（→Phase 1.5，codex 校正：project-context schema 是固定字段白名单、未知字段被忽略——`knowledge_sources` 需先扩 schema+resolver，非小接线；且 MVP 调试面要小）；实体图谱 LLM 抽取、三方导入、门禁 | 检索质量门禁（codex 强化）：**recall@k 测试集**（中文查询 + 同义改写 + 短错误码 + 含 `.`/`-`/`_` 的 API 符号）；E2E："集成商装 demo plugin → 问 SDK API 问题 → kb_search 命中并引用来源"；**质量不达标 → 触发向量 rerank 升级路径评估** |
| **Phase 1.5（M8 内或 M9 初）** | spec-driver research phase 预查注入：project-context schema 扩 `knowledge_sources` 字段（schema+resolver+注入块三处）+ 编排器预查 | 门禁集成 | E2E："spec-driver feature 流程 research phase 自动注入相关文档（标注 untrusted evidence envelope）" |
| **Phase 2（M9，与 F189 锚定引擎合流）** | API 实体 LLM 抽取 + **LLM 整编概述层**（Wiki 式预生成页：快速上手/架构总览/常见任务，填补检索式全局理解弱项，见 §1.2.5；同一笔离线效果优先预算双产物）；文档实体↔SDK 符号锚定（共用 F189 引擎；`kb_api_lookup` 实体版落地）；三方导入自动档（URL/办公文档 + 预览确认 + 质量护栏）；version/time/source 共同决策的冲突仲裁 | 会议纪要深加工 | 锚定准确率门禁；导入 E2E（真实行业网站样本）；Wiki 层立项前先用 Phase 1 查询日志判断全局类问题占比 |
| **Phase 3（M9+，按需）** | 会议纪要/口述四步流水线；质量门禁深度集成（API 误用机械校验入 gate）；触发率 A/B（复用 F184 设施）；embedding rerank（若 Phase 1 质量门已触发则提前）| — | 门禁 E2E + adoption 指标 |

## 4. 风险与反方案审视（诚实记录）

- **「为什么不直接全文塞上下文」**：厂商 SDK 文档集通常数百页~数千页，超出可静态注入范围；且 F176 实测静态大注入的 token 经济差（4-12×）。llms-full.txt 全量注入仅适合 <50k token 的小文档集，可作为 CLI 的 degenerate 模式保留
- **「为什么不上向量库」**：业界 2025-2026 实证 coding agent 场景 agentic+FTS 不劣于 embedding 且零运维（SQLite 单文件 vs 向量服务）；保留 Phase 3 rerank 旁路作为效果不足时的升级路径——**先用证据最硬的便宜方案，效果不足再加码**（避免过度设计原则）
- **触发率风险**（F176 最大教训）：KB 工具同样面临"可见不调用"——对策已内置：编排器预查注入（不靠子代理自觉）+ instructions + 诊断强引导 + Phase 3 A/B 验证；F184 先行趟路
- **知识时效**：厂商月度更新 → CLI 重建增量化（LightRAG 式按文档增量合并）列 Phase 2；MVP 接受全量重建（离线、分钟级、可接受）
- **质量边界**：三方导入的垃圾内容风险由"预览确认 + 护栏四道"控制；口述类知识置信度永远低于厂商文档并标注来源
