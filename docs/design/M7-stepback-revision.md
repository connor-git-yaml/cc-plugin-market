---
title: M7 Step-Back 修订 — 竞品调研 + 架构审查 + E2E 缺口 → milestone 调整
status: confirmed (用户 2026-06 拍板 A=全做 / B=同意 / C=立项 / D=先加固)
created: 2026-06-XX
source: workflow wf_3b106574-ce7 (5 agent / 650k tokens / 12.5 min)
parent: milestone-M7-spectra-mcp-productization.md
verdict: M7 核心方向被业界验证正确，无结构性改动；新增 4 个 current-M7 收尾 feature + F176 报告增强 + M8 旗舰路线
decisions:
  - "A=🅰️ 全做 F177-F180（统一契约/纯函数/byte-stable/E2E 补口）"
  - "B=同意 F176 报告 6 处增强（纯文案零成本）"
  - "C=同意 M8 旗舰立项 AST-anchored spec drift detection"
  - "D=🅰️ F177-F180 先做再 F176（加固 MCP 工具层 + token 指标完整）"
执行顺序: F177 → F178 → F179 → F180 → F176（F177-F180 写入路径多 disjoint，部分可多 worktree 并行）
second_round_revision: M7-stepback-revision-2.md (2026-06-07；F177/F178 已 ship 后第二轮——本文 §1 F180 的 scope 已被第二轮取代为系统性 stdio 补齐，并新增 F181 import-resolver 收口；执行顺序更新为 F179→F181→F180→F176)
---

# M7 Step-Back 修订

F176 最终交付前的 step-back review。5 个 research/audit agent 并行（2 web 竞品调研 + 架构坏味道 + E2E 缺口 + 最近代码对抗审查）。主线程综合判断在 §4。

---

## 0. 总结论

| 维度 | 结论 |
|------|------|
| **M7 方向** | ✅ 被 2025-2026 业界验证正确，**无结构性改动**。"AST+call graph 结构化、非 embedding 主索引"是当前最强护城河叙事（embedding 频繁编辑下 stale 被反复印证）。spec-driver 的多 phase 编排 + gate + 跨模型对抗审查正是业界主流收敛形态 |
| **代码质量** | ✅ **0 critical / 6 warning**，无功能回归。F170-176 分层抽象方向正确，但收口不完整（2 类一致性债）|
| **E2E 覆盖** | ⚠️ 单工具正确性扎实，但 **3 个 high-risk 协同/进程边界缺口**（成本低，current-M7 应补）|
| **战略机会** | 业界已从"会写 spec 的 agent"推进到"spec-anchored 生态"（living docs 双向同步 / 机械化 drift detection / spec-as-source）。**Spectra 独有 AST 图谱资产 → AST-anchored drift detection 是最可防御差异化**（M8 旗舰）|

---

## 1. Current-M7 新增 feature（建议在 F176 前做，加固其依赖的 MCP 工具层）

### F177 (refactor) — 统一 MCP 工具响应契约 + telemetry 装饰器（~2 天）

**问题**（architecture-review）：
- `src/mcp/graph-tools.ts` 是抽象孤岛：本地 `buildErrorResponse(err,hint)` 返回 `{error,hint}`，与 `lib/tool-response.ts` 的 `buildErrorResponse(code,message,...)` 返回 `{code,...}` 是两套不兼容契约。6 个 graph_* 工具走旧 `{error}`，6 个 agent-context+file-nav 走新 `{code}` → MCP 客户端无法统一解析错误码
- F158 telemetry 只覆盖 6/17 工具（agent-context 3 + file-nav 3），graph_* 6 + prepare/generate/batch/diff/panoramic-query 5 共 11 工具是可观测盲区

**方案**：
- graph-tools.ts 6 工具迁移到 lib/tool-response.ts 统一 `{code}` 契约 + ErrorCode union（加 graph 专属码）
- 新增 `withTelemetry(toolName, handler)` 注册层装饰器，把 telemetry 从 2 模块推广到全 17 工具（file-nav 的 runFileNavTool 已证明骨架可行）
- agent-context 三工具引入 runAgentContextTool 骨架消除 _telStart/recordAndReturn 三段样板（handleImpact 里 recordAndReturn 出现 6 次）

**对 F176 的价值**：telemetry 覆盖全 17 工具 → F176 的 token-per-task 第二指标采集完整。

### F178 (refactor) — 抽取共享纯函数（~1 天，零行为变更）

**问题**（architecture-review）：
- Levenshtein 在 query-helpers.ts 与 adr-evidence-verifier.ts **照搬复制两份**（注释自承），F174 fuzzy 是新热路径
- normalizeProjectPath 仓库内 **10+ 份**近乎相同副本（batch 内 3 份）
- graph-builder.ts buildKnowledgeGraph 五路数据源的 "构造 edge → 算 key → 取高 confidence 覆盖" 模式**逐字复制 5 次**

**方案**：
- levenshtein → `src/utils/string-distance.ts` 单一实现，两调用方 import
- batch 内 normalizeProjectPath 三处合并到 regen-plan.ts 导出
- graph-builder 提取 `upsertEdge`/`upsertNode` helper（保留 unifiedGraph 路 directional 合并语义）

### F179 (fix) — graph.json 真 byte-stable + eval 脚本一致性（~1 天）

**问题**（recent-feature-adversarial，唯一 warning 级）：
- F175 落盘 graph.json：batch-orchestrator.ts:1566 调 `normalizeGraphForWrite(graphJson)` **未传 stripTimestamps**，仍保留实时 `generatedAt` → 同语义两次 full 跑出的 graph.json 逐字节不同。E2E 场景10 是在**读取侧** delete generatedAt 才 deepEqual。commit 声称 "byte-stable graph.json" 是 **over-claim**（实为剥时间戳后结构稳定）
- eval 脚本默认翻转 incremental 后，3 处 code-only batch 未补 --full（当前 fresh worktree 无回归但语义脆弱）
- F174 删 findFuzzyMatches 后，2 处 eval prompt 仍引用该已删函数（事实失真）

**方案**：
- batch-orchestrator:1566 传 `{stripTimestamps:true}` 让落盘真 byte-stable（确认无消费方依赖真实 generatedAt）
- 3 处 eval code-only batch 补 --full
- 2 处 eval prompt 把 findFuzzyMatches 改为 resolveSymbolFuzzy

### F180 (test) — E2E 协同/进程边界补口（~2-3 天）

**问题**（e2e-gap-analysis，3 个 high-risk）：
- **6 个 graph 工具从未经 stdio/JSON-RPC 子进程调用**（只 in-process snapshot）→ schema/序列化漂移盲区
- **工具链 chain（detect_changes→impact→context→view_file）无端到端串联**，view_file(symbolId) 全用自造 fixture 从不消费上游真实 symbolId → 跨工具 symbolId 格式契约盲区
- **F171 symlink 逃逸只有 in-process 单测无 stdio 级**，子进程 cwd/projectRoot 解析与 in-process 不同（W-4 已暴露过差异）

**方案**（均复用 mcp-server-stdio.test.ts 现成 transport + micrograd baseline gate）：
- graph 工具 stdio E2E：6 工具各 1 条 client.callTool 子进程用例
- 工具链 chain E2E：micrograd baseline 上全程真实 symbolId 透传，断言 view_file lineRange 与 context 一致
- symlink stdio E2E：view_file('../../../etc/passwd') + tempRoot 内指向外的 symlink → path-outside-root
- F170d driver preference sandbox 决策代理（用 stub driver 把"引导→选择"逻辑拉进 CI，真实 LLM 仍走 HOST_E2E）
- tools/list 从 ≥12 强化为精确 18 工具集合
- full batch reproducibility（同 commit 两次 full → 归一化 deepEqual）

---

## 2. F176 调整（不改工程范围 / 估时，纯报告增强）

| 调整 | 内容 | 来源 |
|------|------|------|
| 第二指标 | 新增 **token-per-completed-task**（含所有 tool 调用与 loop）作为与 cohort1 对比的第二维度——在"绝对 pass rate 因 leakage 不可比"约束下多一条站得住的相对维度。F176 已采集 product metrics，仅加聚合维度 | spectra-research（对标 Anthropic -98.7% / Augment 3×）|
| 业界锚点 | 报告引入 **Augment SWE-bench 70.6% / 质量+30-80% / 响应 3×** + **Anthropic code-exec-with-MCP -98.7% token** 作为外部参照（仍标 internal-cohort-only 不声称绝对可比）| spectra-research |
| Serena peer 对比 | 显式把 **Serena** 列为最直接 peer，阐明差异化：Spectra 纯 AST（无需 build、对 SWE-Bench 仓库快照鲁棒）vs Serena LSP（需语言 server）；Spectra 是 context-provider 非 editor（定位边界非缺陷）| spectra-research |
| drift 定性栏 | 报告新增 "各 cohort 是否具备 spec-drift/living-doc 能力" 定性维度，凸显 spec-driver+Spectra 在 AST-anchored drift 上的潜在差异化（标 roadmap）| sdd-research |
| Codex review 升级 | 把 codex:codex-rescue 对抗审查输出升级为 **"两模型重叠发现（高置信）+ Codex 独有发现（盲点）"** 分类呈现（借鉴 gstack /codex 三模式）。纯 prompt/约定层，零结构改动 | sdd-research |
| leakage 背景 | falsification/caveat 段补行业背景：2026 业界（OpenAI 停报 Verified、Verified→Pro 掉~50pt）已共识"绝对 pass rate 不可比"，与决策 4 完全吻合 | sdd-research |

---

## 3. M8 future-milestone roadmap（大改动 defer，不塞 M7）

### 🚩 M8 旗舰候选 — AST-anchored Spec Drift Detection

把 spec/plan 引用的代码实体锚定到 Spectra 的 symbol id，symbol 变化即标 spec stale，入 repo:check / CI。

**为何是最高战略价值**：
- 同时命中三大业界趋势：drift detection（Fiberplane Drift）+ living docs（Augment Cosmos/SpecWeave）+ long-horizon anchor（Tessl rebuild test）
- **独占利用 Spectra 现成 AST 图谱资产**（竞品需从零建图）→ spec-driver 在 SDD 赛道最可防御的护城河
- 已有 spectra-diff drift 雏形 + knowledge-graph symbol id 资产可复用

### M8 其他 defer 项

| 类别 | 项目 | 来源 |
|------|------|------|
| 架构大重构 | runBatch god 函数拆解（1460 行→职责子函数，需 baseline fixture 兜底）| architecture-review |
| 架构大重构 | graph_node 复用 F174 resolveSymbolFuzzy（消除两套并行模糊匹配）| architecture-review |
| 图引擎扩展 | CFG/数据流（PDG）层支撑精确 blast-radius（对标 CPG/Joern，4 语言×成本）| spectra-research |
| 图检索深化 | GraphRAG 风格 Leiden 层级社区摘要 + 渐进检索（粗集群→细节按需）| spectra-research |
| 可选语义旁路 | hybrid embedding rerank（仅二级信号非主索引，sqlite-vec 低成本，默认关保 AST-only 降级）| spectra-research |
| SDD 流程 | clarify / analyze / checklist 三轻量 phase（对标 Spec Kit）打包"spec 质量"小 milestone | sdd-research |
| SDD 流程 | EARS 句式约定（WHEN/SHALL/IF，对标 Kiro）+ verify 机械校验 | sdd-research |
| SDD 流程 | implement phase 拆 red/green 硬 gate（M7-SC-007 phase-order 检查升级为结构强制，对标 Superpowers TDD Iron Rule）| sdd-research |
| SDD living-doc | delta-spec + archive-merge 强化 sync skill（对标 OpenSpec）+ implement 完成 hook 自动 sync（对标 SpecWeave）| sdd-research |
| 测试基建 | cohort eval 流水线集成测试（mock spawn + 预录 trace）+ ts/go/java truth-set call-graph 门禁 | e2e-gap |
| 架构 info | 两层 incremental（graph-snapshot vs spec-doc）边界文档说明；file-nav 绝对路径 schema 名实对齐；ReDoS 无分组链盲点文档化 | arch + adversarial |

---

## 4. 竞品 Landscape（调研依据，供 M8 立项参考）

### Spectra 类（codebase → agent context）
| 项目 | 路线 | 对 Spectra |
|------|------|-----------|
| **Serena** (oraios) | LSP+AST symbol MCP，无 embedding 主索引，有 symbol 级写工具 | 最直接 peer，验证纯 AST 路线；差异：Spectra 无需 build + context-provider 定位 |
| **Augment** Context Engine | embedding+ranking 黑盒，400k+ 文件，SWE-bench 70.6% | F176 行业锚点数字 |
| **Sourcegraph** Deep Search | SCIP code graph + embedding + agentic loop，跨多仓 | Spectra 缺 multi-repo + NL→结构化检索层 |
| **code-graph-rag-mcp** (er77) | tree-sitter graph + sqlite-vec embedding，26 MCP method，per-repo DB+增量 5.5× | 正面同构 hybrid 阵营；工程做法可对标 |
| **CPG** (Fraunhofer/Joern) | AST+CFG+PDG code property graph | Spectra 缺 CFG/数据流层（M8 图深度方向）|
| **Anthropic** context-engineering | progressive disclosure + JIT + tool-result pruning，-98.7% token | Spectra MCP token 经济学官方指南 |

### SDD 类（spec-driven development）
| 项目 | 新颖点 | 对 spec-driver |
|------|--------|---------------|
| **GitHub Spec Kit** | clarify/checklist/analyze 三 phase + constitution | 缺这三个轻量 phase（M8 spec 质量 milestone）|
| **AWS Kiro** | EARS 语法 + SMT 需求矛盾检测 + steering files/hooks | EARS 可借鉴；SMT 重投入 |
| **OpenSpec** | delta-spec + propose→apply→archive + strict scenario gate | sync skill 升级范式 |
| **Tessl** | spec-as-source + rebuild test + Spec Registry | rebuild test 高阶 verify 断言；spec registry 与 Spectra 协同想象 |
| **Augment Cosmos/Intent** | Coordinator-Implementor-Verifier + 双向 spec-code sync + 跨 session memory | living docs 最强形态（领先一代）|
| **SpecWeave** | post-task hook 自动更新 spec/ADR + append-only 归档 | living-doc 自动触发蓝本 |
| **Fiberplane Drift** | AST-anchored 文档漂移检测，symbol 变即标 stale，入 CI | **M8 旗舰直接参照**（Spectra 有现成 AST 资产）|
| **Superpowers** (obra) | TDD Iron Rule 硬结构化 + subagent-driven + Evidence-First | implement red/green 硬 gate 参照 |
| **gstack** (garrytan) | 23 specialist + /codex 跨模型 review 重叠/独有综合 | Codex review 输出升级参照（current-M7）|

---

## 5. 修订后 M7 时间线

```
✅ 已 ship: F170a-e + F171 + F174 + F175

🟡 Current-M7 收尾（建议 F176 前做，加固 MCP 工具层）
   F177 统一 MCP 响应契约 + telemetry 装饰器 (2d)  ← 直接利好 F176 token 指标
   F178 抽取共享纯函数 (1d)
   F179 graph.json 真 byte-stable + eval 一致性 (1d)
   F180 E2E 协同/进程边界补口 (2-3d)
   （F177-F180 写入路径多 disjoint，部分可并行）

🟢 F176 SWE-Bench Verified 5-cohort (11d) — 5 决策已定 + 6 处报告增强

合计新增 ~6-7 工程日（current-M7）；F176 估时不变
```

---

## 6. scope 决策（用户 2026-06 已拍板）

| 决策 | 拍板结果 |
|------|---------|
| **A. Current-M7 新增 4 feature** | ✅ 🅰️ **全做** F177/F178/F179/F180（~6-7d 彻底收口）|
| **B. F176 报告 6 处增强** | ✅ **同意全采纳**（纯文案零成本）|
| **C. M8 旗舰立项** | ✅ **同意** AST-anchored spec drift detection 作为 M7 收尾后下一 milestone 旗舰 |
| **D. 新增 feature 与 F176 顺序** | ✅ 🅰️ **F177-180 先做再 F176**（加固 MCP 工具层 + token 指标完整）|

**确定执行顺序**：F177（统一契约+telemetry）→ F178（纯函数去重）→ F179（byte-stable+eval 一致性）→ F180（E2E 补口）→ F176（5-cohort 对比 + 6 处报告增强）。
F177-F180 写入路径多 disjoint，可多 worktree 并行加速；F177 必须先于 F176（telemetry 全覆盖是 F176 token 指标前提）。
