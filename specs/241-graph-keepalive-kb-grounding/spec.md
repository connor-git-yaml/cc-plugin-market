---
feature: 241-graph-keepalive-kb-grounding
title: 图条件保活消费接线 + KB 三薄层 + Grounding Pilot（M9 轨道 B4 / 轨道 E）
status: draft
created: 2026-08-03
research_basis: specs/241-graph-keepalive-kb-grounding/research/tech-research.md
baseline_basis: specs/241-graph-keepalive-kb-grounding/pilot/baseline-observations.md
measurement_basis: specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md
milestone_source: docs/design/milestone-M9-codex-trusted-live-graph.md#B4
milestone_sc: M9-SC-007
---

# Feature 241：图条件保活消费接线 + KB 三薄层 + Grounding Pilot

> 修订 v2（Codex 对抗审查整改）：C1-C6/W1-W7/I1 落地，整改单见 review-dispositions.md
> 修订 v3（plan 阶段 Codex 审查回灌）：审计双事件模型 + KB 语义钉死，整改单见 review-dispositions.md 的 Plan phase 节

## 概述与目标

本 feature 同时收口 M9 里程碑的两块余项：

1. **轨道 B4 — 条件保活的「消费接线」**。F239 已经建成 graph provenance / freshness 底座（`checkFreshness` / `buildStatusPayload` / `attemptLocalGraphBuild`），但**插件侧零消费**（调研 A1：全仓唯一生产调用方是 `scripts/sync-worktree-local-state.sh`）。结果是基线观测 O-1 记录的现状：图 `stale` 时 `impact` / `context` 照常返回结果，返回体里**没有任何 freshness 标记**，goal_loop、implement 子代理和人都无从判断手里的影响面是不是过期的。本 feature 把「什么时候该刷图、什么时候不该消费 impact、消费降级时留什么证据」做成一份**可测的判定**，并接到实际消费路径上。

2. **轨道 E — KB 三薄层 + grounding pilot**。在 F190-F192 已有的 doc-graph / FTS5 / 实体层 / 异构 ingest 之上，补三个治理性薄层：coverage-gap（no-hit 缺口 backlog）、version selection（依赖版本推断）、freshness status（KB 新鲜度可见）。并以 F241 自身开发过程为载体，按已冻结的 `pilot/measurement-design.md` 口径取 grounding 三指标数据。

对应 **M9-SC-007**（KB no-hit backlog、版本自动识别、freshness 状态完成；一个 grounding pilot 有可执行报告）与 **B 轨验收**中「HEAD 变化后查询能看到 freshness 状态」一项。

---

## 措辞红线（贯穿全文，实现与文案都受其约束）

**禁止 over-claim「freshness 通过 ⇒ impact 可信」。**

依据基线观测 O-3 复核结论：在**重建后的 fresh 图**上（6092 节点 / 8062 边、`freshness: fresh` @ `2e3a4cd`、`overallVerdict: pass`），`impact(src/kb-mcp/tools/kb-search.ts::executeKbSearch)` 仍然返回 `directCallers: 0, riskTier: "low"`，而实际调用方存在于同文件 `kb-search.ts:147` 的 inline arrow callback 内——调用抽取器不下钻实参箭头函数体，`executeKbSearch` 入边只有 1 条 `contains`、零 `calls`。

因此：

- freshness 状态是**图与 HEAD/工作树是否对齐**的判定，**不是**图覆盖面是否完整的判定。
- 词汇表**必须**能表达「图是新的，但覆盖面本身有已知缺口」这一态：`coverage-gap-out-of-graph-scope` 走 degraded reason 通道（FR-004），`coverage-gap-known-extraction-limit` 走 caveat 通道（FR-004b / FR-006），不能只有 fresh/stale 二元。
- 任何产出文案（CLI 输出、注入给 agent 的 grounding 包、pilot 报告）都不得出现「图已 fresh，影响面完整/可信」这类表述。

---

## Scope（范围决策记录）

以下 D1-D8 是编排器在 spec 阶段已经拍板的范围决策，**不再作为开放问题重新论证**。

### D1 — B4 的「增量刷图」读作「条件刷新」，不是「部分刷新」

**决策**：刷新机制沿用既有全量 `spectra batch --mode graph-only`；本 feature 的产出是**决策矩阵**（何时该刷、何时该降级、何时根本不该消费 impact），**不新建任何建图引擎**。

**依据**：调研 A4 证实仓内不存在按变更集部分刷新的能力——`buildAstGraphOnly(projectRoot, { outputDir })` 不接受任何 changed-files / file-filter 参数；`command.incremental` 只作用于非 graph-only 路径的 spec-gen regenPlan，graph-only 分支在 `resolveRegenPlan` 之前就已 return。编排器实测本仓全量 `graph-only` 重建 = **4.4s**（6092 节点 / 8062 边）。为省 4 秒去造增量建图引擎属于 CLAUDE.md 明令禁止的过度设计。轨道名「条件保活」的重点本就在「条件」。

### D2 — B4 决策核心做成「纯函数 core + CLI 子命令」两层，不改 orchestration schema

**决策**：
- 决策逻辑写成**新增独立纯函数**，放在 `plugins/spec-driver/scripts/lib/`，用 `node:test` 单测。
- 通过**新增 CLI 子命令**暴露，使 goal_loop 与 SKILL.md 散文层（`agent_mode: single` 的常规 implement/verify 路径）调用**同一份判定**，避免两套逻辑漂移。
- **禁止**修改 `plugins/spec-driver/contracts/orchestration-schema.mjs` 新增字段（CLAUDE.md 明确 MVP 不支持任意新字段）。
- **禁止**改造 `decideStop` / `interpretImpactResult` 本体。

**依据**：调研 A5——goal-loop-core 现有 13 个函数全部有配套 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 单测，纯函数可测性最高，但纯函数路线**只覆盖 goal_loop**；CLI 子命令层是把同一判定同时供给散文层的唯一低成本方式（B5 已有 `scaffold-kb query` 子命令服务编排层的分工先例）。调研 C1 警告：`decideStop` 源码注释密度极高（多轮对抗审查加固），`interpretImpactResult` 的四条测试用例（`goal-loop-core.test.mjs:560-589`）是冻结型断言，**新逻辑对「无 freshness 字段」的旧调用形态必须优雅降级，这四条断言零回归**。

### D3 — 任务分类信号 = git diff porcelain 机械判定，不用 agent 自报；双时点、双合同

**决策**：变更类别（`modifies-existing` / `additive-only`）由 `git status --porcelain -z` / `git diff --name-status -z` 机械解析得出，**不接受** agent 自报。

**依据**：调研 A6——仓内无可复用的任务分类先例；自报有 F204 记录的「对抗性自我误标」风险（`validateFullCommandKinds` 自身即标注了「能挡遗漏不能挡对抗性自我误标」的边界）；porcelain 解析在 `goal-loop-core.mjs` 的 `parsePreservedConfigStates` 已有先例。

**关于鸡生蛋问题的明确处置（v2 修订，落 C4）**：A6 指出「执行前无法知道会改哪些文件」。goal_loop 的注入时点发生在该轮 implement **之前**，第一轮根本不存在「本轮 diff」。因此本 feature 定义**两个不同名、不同权威度的合同**，实现与文案都不得混用：

| 合同 | 时点 | 信号来源 | 权威度与允许后果 |
|------|------|----------|-----------------|
| `pre-implement advisory` | implement **前**（含 goal_loop 每轮注入前） | 轮 1：tasks.md 已声明目标文件路径的**存在性**（`fs.existsSync`，纯文件系统事实，非 agent 自报）+ 相对 `--base-ref`（phase 起点 ref）的 diff；轮 ≥2：相对同一 `--base-ref` 的**累计** diff | **非权威**。输出必须含 `advisory: true`。**只允许**决定「要不要提前刷一次图」与注入时的语气/caveat；**禁止**产生「impact 不适用」这类权威结论，即 advisory 模式下不得输出 `skip-impact` 作为终态结论（可作为「本轮预计无需 impact」的提示，但必须带 `advisory: true` 且不写入权威审计判定字段） |
| `pre-verify authoritative` | implement **后** / verify **前** | 本轮实际 `git diff --name-status -z <base-ref>..` + `git status --porcelain -z`（含未跟踪文件） | 权威。所有 degraded reason 落审计、所有「是否消费 impact」的最终出口都以此为准。输出 `advisory: false` |

若 tasks.md 未声明目标文件路径且 diff 为空，advisory 结果为 `unknown`，按 FR-003 矩阵行 7 处理。

### D4 — E 三薄层落地形态：E1/E2 走 CLI 子命令，E3 走 CLI 子命令 + 既有 MCP 响应字段扩展

**决策**：coverage-gap 与 version selection 作为 `spectra scaffold-kb` 的新子命令；freshness status 同时提供 CLI 子命令与**在既有 `kb_search` / `kb_api_lookup` 响应中新增字段**。**不新增任何独立 MCP tool。**

**依据**：调研 B5——`query` 子命令是 F191 为预查注入设计的非 MCP 消费路径，仓内已有「CLI 子命令服务编排层，MCP tool 服务 agent 对话」的分工先例；KB MCP 当前只有 `kb_search` / `kb_api_lookup` / `kb_doc_lookup` 三个工具，为三个治理薄层各加一个 tool 会显著增加 agent 侧工具选择负担。

### D5 — 脱敏采用「redaction + minimum-occurrence threshold」双层，并如实声明残余风险（v2 修订，落 C5）

**决策**：no-hit 查询词入库前必须过两层处理，缺一不可。这是编排器对「什么算敏感」的产品判断，不是代码走读能回答的问题（调研 B2 已确认仓内零现成能力：`sanitizeQuery` 是 FTS5 语法构造器，`defangSentinel` 是防 prompt injection 的 sentinel 拆解，两者都不可复用）。

- **第一层 redaction**（入库前，逐查询串）：对**结构性可识别**的敏感形态做占位替换。规则见 FR-012。
- **第二层 minimum-occurrence threshold**（输出时，聚合层）：某个 term 只有出现在 **≥ k 个不同 normalizedQuery hash** 中才允许进入 backlog 输出，**k = 2**（proposed-default，见 OQ-2）。理由：一次性出现的串最可能是误粘的敏感信息，同时聚合价值也最低（单次 no-hit 不构成"文档缺口"信号）。
- **⚠️ 命名与能力边界（v2 更正）**：该阈值**不是 k-匿名**。no-hit 记录中没有任何主体标识（无 user-id / session-id），不存在"等价类"概念，因此不提供任何匿名性保证。全文一律称 **minimum-occurrence threshold（最小出现阈值）**，禁止在代码、输出、文档中使用「k-匿名 / k-anonymity」措辞。
- **⚠️ 落盘范围与残余风险（v2 更正，删除原「原文在任何环节都不落盘」的绝对化表述）**：
  - **落盘的是**：redaction 后再经仓内 tokenizer（`src/scaffold-kb/tokenizer.ts`）切词得到的 **term 列表** + 归一化查询串的 **hash**（`normalizedQueryHash`）+ redaction 命中标记。
  - **不落盘的是**：原始查询串的**整串字段**——记录里**不新增** `query` / `redactedQuery` 这类承载完整查询串的字段（既不存原文，也不存 redaction 后的完整串）。
  - **⚠️ 该红线的精确边界（v3 收窄，落 B2-5）**：落盘粒度是 **term**。当查询**本身就是单个 token** 时（如 `ProjectFalcon`），该 term 在字节上就等于原串——这是 term 粒度落盘的直接后果，属**已知且接受**的残余，不是红线被击穿。原表述「原串在任何环节都绝不出现」按字节口径不成立，故收窄为「不新增整串字段」。之所以不做「单 token 只留 hash」：单个 API 名 / 错误码正是 coverage-gap 最有价值的缺口信号，抹掉它等于废掉 E1 的目的。敏感形态由 redaction 先行遮蔽（FR-012），单 token 的 `sk-xxx` 落盘为 `<TOKEN>` 切词后的占位标记而非原串。
  - **残余风险如实声明**：term 是自然语言切词结果，仍可能包含 redaction 六规则**未能识别**的敏感内容（中文姓名、内部项目代号、自然语言口令、带分隔符的电话号码、无点域名地址如 `user@localhost` 等结构上不可判别的形态）；单 token 查询时该内容即等于原串。本 feature **不声称**已消除该风险，改以四层兜底控制暴露面：(1) 采集默认关闭（opt-in）；(2) 数据目录被 gitignore 且有自举保障（FR-024）；(3) 30 天保留期滚动清理；(4) 纯本机文件，不进任何上报通道。
- **默认关闭（opt-in）**。理由：(a) O-4 记录既有 telemetry 本身就是默认不采集、仅 env 开启，保持一致；(b) 记录用户查询词是本仓库首次落盘此类数据，脱敏是全新代码、未经实战验证，默认开启等于把未验证的隐私风险推给所有安装者；(c) coverage-gap 是治理/运维用途，消费者是仓库维护者，opt-in 的摩擦成本可接受。**代价与缓解**：默认关闭意味着 backlog 默认无数据，因此 FR-014 强制要求关闭态与"有数据但无缺口"必须输出**可区分**的状态，绝不允许用空 backlog 冒充"没有文档缺口"。本仓库自身在 dogfood 时显式开启。
- **存哪里 / 留多久 / 谁能读**：见 FR-013 与 Key Entities「KB no-hit 记录」。

### D6 — `.mjs` 扩展名缺口（O-5）显式登记 out-of-scope，本 feature 不修

**决策**：不在 F241 内让 `plugins/**/*.mjs` 进入知识图谱。

**依据**：用户未要求；O-5 已定位根因为 `walkTsJsFiles` 的扩展名白名单只收 `.ts/.tsx/.js/.jsx`（`source-discovery.ts:509-514`），修它会一次性把 84 个 `.mjs` 文件的节点/边灌入图，直接改动 F217 质量门六指标基线与 golden-master 断言，需要独立的回归预算。

**后果必须如实登记**：B4 的接线代码全部落在 `plugins/spec-driver/scripts/lib/*.mjs`，pilot 的 grounding 命中率在这部分**结构性封顶为 0**（O-2 已实测：`goal-loop-core.mjs::interpretImpact` 返回 symbol-not-found 且 fuzzyMatches 为空）。pilot 报告必须写明这一封顶及其根因指针（O-5）。

### D7 — 措辞红线

见上方独立章节。此处仅登记它是范围决策的一部分：degraded reason / caveat 词汇表设计（FR-004 / FR-004b）与所有输出文案都受其约束，实现时不得简化为 fresh/stale 二元。

### D8 — 分发拓扑：canonical 模块移入插件，仓根改薄 re-export（**v2 定案，落 C1**）

**事实**（`orchestrator-verifications.md` V-1，已实查已安装插件缓存）：F239 的 `graph-bootstrap-status.mjs` 位于**仓根** `scripts/lib/`，而插件只分发 `plugins/spec-driver/**`（双 marketplace source 均只指该目录）。已安装的 spec-driver 4.4.0 缓存目录下 `scripts/lib/` 有 20 个文件但**没有** `graph-bootstrap-status.mjs`。这使 spec 原有的三条约束（FR-007 复用 `attemptLocalGraphBuild` + RG-006 禁止第二份实现 + D2 决策核心放插件侧）在旧拓扑下不可同时满足。

**决策（spec 层直接定死，不再推给 plan）：采用方案 A。**

1. **canonical 实现移入插件**：`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 成为唯一实现所在地。
2. **仓根改薄 re-export**：`scripts/lib/graph-bootstrap-status.mjs` 退化为对 canonical 路径的 re-export 薄壳，保持仓内既有调用方（`scripts/sync-worktree-local-state.sh`、worktree lifecycle hook）导入路径不变。
3. **三个消费方全部可达**：B4 决策 CLI 在插件内（相对路径直达 canonical）；sync 脚本与 lifecycle hook 均跑在仓内 checkout（经薄 re-export 到达同一实现）。
4. **禁止复制**：无论如何**禁止**在插件侧复制一份 F239 的有界子进程 / 超时 / 进程组清理 / 输出校验逻辑。F239 源码注释已明确警告「两份各自维护的 deadline 逻辑迟早会漂移」（且其中一份历史上就完全没有 deadline）。

**已知代价（入 plan 落实，不是开放问题）**：`tests/unit/worktree-lifecycle-hook.test.ts:109` 现有的 copy 行为需改为**从 canonical 路径 copy**——薄 re-export 单独被拷走会断相对路径。

**FR-007 相应固化**：其「必须复用同一份实现」现在有确定路径 = `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`；「不得另写一份 spawn 逻辑」不放宽。安装态可达性由 SC-019 实测断言（把 `plugins/spec-driver/` 整体拷到仓外临时目录跑 `--dry-run`）。

---

## 非目标（Non-Goals）

1. **不新建增量/部分建图引擎**（D1）。
2. **不修改 `orchestration-schema.mjs` / `orchestration.yaml` 的 phase 或 gate 结构**（D2）。
3. **不改造 `decideStop` / `interpretImpactResult` 函数本体**（D2 / 调研 C1）。
4. **不修复 `.mjs` 扩展名缺口**（D6，O-5）。
5. **不修复调用抽取器不下钻 inline arrow callback 的漏边缺陷**（O-3 复核结论已明确"属 Spectra AST 抽取面，另开"）。本 feature 只登记该缺口并让 caveat 能表达它。
6. **不新增独立 KB MCP tool**（D4）。
7. **不做 KB 分级刷新 / 条件 rerank / 自动重建调度器**——M9 §7 明确 freshness 只做「状态可见」，调度器属 M10。
8. **不做 npm 以外生态的 lockfile 版本推断**（本轮只覆盖 npm 生态，见 FR-016；其他生态返回明确的 unsupported 状态而非猜测）。
9. **不改 KB 现有查询/排序/仲裁语义**——三薄层只加治理面，检索行为零变更。
10. **不把 goal_loop 默认开关从 off 改为 on**。
11. **不跑 SWE-bench 批或消耗评测配额做 pilot**——pilot 载体就是 F241 自身开发过程（measurement-design 已冻结）。
12. **不引入跨进程锁 / 不让生产决策代码读审计文件**（C3 / W3；FR-008、RG-006）。

---

## User Scenarios

### 场景 A：改既有代码的任务，图已 stale（B4① 主路径）

- **Given** 开发者在某 worktree 内跑 feature 流程，implement 阶段改了 `src/**` 下若干既有文件，图记录的 sourceCommit 落后于 HEAD
- **When** verify 阶段前以 `pre-verify authoritative` 合同调用 B4 决策 CLI
- **Then** 决策结果为 `refresh-then-consume`；执行全量 `graph-only` 重建（有界超时 + 产物可用性校验）；重建成功后按 FR-003「刷新后收口规则」直接落 `consume-impact`；整个过程（决策输入、出口、是否刷新、耗时）落一条审计记录

### 场景 B：纯新增、无 caller 的任务（B4② 主路径）

- **Given** implement 后的实际 diff 全部是新增文件（porcelain 状态码 `A` / `??`），无任何已存在文件被修改
- **When** 以权威合同调用 B4 决策
- **Then** 决策结果为 `skip-impact`，degraded reason = `impact-not-applicable-additive-only`，**不触发任何图重建**（不为无价值的 impact 付 4.4s + 图覆写风险），并在输出中给出替代建议（改用 `context` / `graph_query` 做模块级定位，或 Grep）。**不得**返回一个空的 impact 结果假装"影响面为零"

### 场景 C：图 fresh，但目标落在已登记覆盖缺口内（D7 实证场景）

- **Given** 图刚重建完（`freshness: fresh`、`overallVerdict: pass`），但本轮改动文件是 `plugins/spec-driver/scripts/lib/*.mjs`
- **When** 调用 B4 决策
- **Then** 出口为 `consume-degraded`，degraded reason = `coverage-gap-out-of-graph-scope`（矩阵行 2 命中，早于任何刷新分支），输出明确说明「该路径整体不在图内（根因见 O-5），impact 结果不具参考性，请退回 Grep/Read」——**不得**因为 freshness=fresh 就给出"可信"结论，也**不得**为范围外目标白白重建 4.4s

### 场景 D：goal_loop 循环内消费 impact（B4③）

- **Given** goal_loop 已开启（opt-in）并进入某一轮迭代
- **When** 该轮准备把 impact 结果注入 prompt（此时该轮 implement **尚未执行**）
- **Then** 先以 `pre-implement advisory` 合同调用 B4 决策（输出带 `advisory: true`）；仅在出口为 `consume-impact` / `refresh-then-consume`（且刷新成功）时注入，注入内容标注为 advisory grounding；其余出口一律跳过注入，并把 degraded reason 写入该轮的 iteration log 条目。**advisory 结论不得被当作「impact 不适用」的权威判定**——权威判定发生在 implement 之后的 `pre-verify authoritative` 调用

### 场景 E：KB 缺口治理（E1）

- **Given** 仓库维护者已显式开启 no-hit 采集，并在一段时间内正常使用 `kb_search` / `kb_api_lookup`
- **When** 运行 coverage-gap 子命令
- **Then** 得到一份 redaction 后、且满足最小出现阈值（k=2 个不同 normalizedQuery hash）的文档缺口 backlog（按 term 聚合，含出现次数、distinctQueries、涉及工具、时间跨度）；原始查询串整串不落盘（残余风险声明见 D5）

### 场景 F：KB 版本选择（E2）

- **Given** 某项目根目录有 `package-lock.json`，其中 `some-sdk` 版本为 `3.2.1`
- **When** 用户查询未指定版本 / 指定了 `4.0.0`
- **Then** 未指定时 `resolved = { status: "lockfile", version: "3.2.1" }`；指定时 `resolved = { status: "explicit", version: "4.0.0" }`，但结果**同时呈现**推断值 `3.2.1` 并标 `version-conflict`；多 lockfile 且无显式版本时 `resolved = { status: "ambiguous", version: null }` + 全量 `candidates[]`，**不擅自选一个**

### 场景 G：KB 新鲜度可查（E3）

- **Given** KB 库已 build 若干天、含来自不同 ingest 源的内容
- **When** 运行 KB status 子命令，或调用 `kb_search` / `kb_api_lookup`
- **Then** 能看到 `activityAt = max(built_at, ingested_at)` 及其派生的 age、`oldestBuiltAt`（仅可见性）、source version 列表、no-hit 采集态与近期 no-hit 计数，以及 `current` / `aging` / `stale` 三元新鲜度状态（不可评估时为 `unknown`）；**系统不因此自动触发任何重建**

---

## Functional Requirements

> 标注含义：`[必须]` 去掉后核心功能无法实现；`[可选]` 去掉后核心功能仍可实现但体验/可维护性受损；`[YAGNI-移除]` 当前迭代不需要。

### B4 — 图消费决策

- **FR-001（决策纯函数）** `[必须]`：新增一个独立纯函数（放在 `plugins/spec-driver/scripts/lib/` 下的新模块，**不写入** `goal-loop-core.mjs`），签名为 `decideGraphConsumption(input) -> decision`，输入/输出为纯 JSON 对象（无 I/O、无 spawn、无文件读写），输入输出契约见 Key Entities。
  *验证*：`node --test plugins/spec-driver/tests/<新测试文件>.mjs`；断言该模块导出的函数在给定固定输入时返回确定输出，且模块内无 `child_process` / `fs` import。

- **FR-002（决策输入维度完备，严格五维）** `[必须]`：决策函数的输入必须且只须包含以下五个维度，缺任一维度必须 fail-loud（返回 `invalid-input`），**不得**用默认值静默补齐；**不得**接受第六个业务字段（impact 结果不进入本函数，见 FR-006）：
  1. `changeClass`：`modifies-existing` | `additive-only` | `unknown`
  2. `graphAvailability`：`present` | `missing` | `corrupt`
  3. `freshness`：`fresh` | `dirty` | `stale` | `unknown-provenance`（与 F217 `evaluateFreshness` 四态逐字对齐）
  4. `coverageScope`：`in-graph-scope` | `out-of-graph-scope`（本轮判据：目标文件扩展名是否在图 walker 白名单内，见 O-5）
  5. `refreshPolicy`：`allowed` | `declined`（是否允许本次触发重建；由调用方按预算/开关/调用方合同 FR-008 决定）
  *验证*：单测覆盖「缺任一字段 → 返回 `invalid-input`」共 5 条用例；一条「传入未知 freshness 字面量 → `invalid-input`」；一条「传入 `impactResult` 等额外业务字段 → 该字段被忽略且不影响出口」（断言五维严格性未被第六字段污染）。

- **FR-003（决策矩阵 v2：每种组合都有确定出口）** `[必须]`：决策按下述**固定顺序**求值，第一个命中的分支即为出口。出口枚举为 `consume-impact` | `refresh-then-consume` | `consume-degraded` | `skip-impact` | `unavailable`。

  | 序 | 条件 | 出口 | degraded reason |
  |----|------|------|----------------|
  | 1 | `changeClass = additive-only` | `skip-impact` | `impact-not-applicable-additive-only` |
  | 2 | `coverageScope = out-of-graph-scope` | `consume-degraded` | `coverage-gap-out-of-graph-scope` |
  | 3 | `graphAvailability = corrupt` 且 `refreshPolicy = allowed` | `refresh-then-consume` | —（刷新失败时由 FR-007 改写） |
  | 4 | `graphAvailability = corrupt` 且 `refreshPolicy = declined` | `unavailable` | `graph-corrupt` |
  | 5 | `graphAvailability = missing` 且 `refreshPolicy = allowed` | `refresh-then-consume` | — |
  | 6 | `graphAvailability = missing` 且 `refreshPolicy = declined` | `unavailable` | `graph-missing` |
  | 7 | `changeClass = unknown` | `consume-degraded` | `classification-unknown` |
  | 8 | `freshness = stale` 且 `refreshPolicy = allowed` | `refresh-then-consume` | — |
  | 9 | `freshness = stale` 且 `refreshPolicy = declined` | `consume-degraded` | `graph-stale-refresh-declined` |
  | 10 | `freshness = dirty` 且 `refreshPolicy = allowed` | `refresh-then-consume` | — |
  | 11 | `freshness = dirty` 且 `refreshPolicy = declined` | `consume-degraded` | `graph-dirty-uncommitted` |
  | 12 | `freshness = unknown-provenance` | `consume-degraded` | `graph-unknown-provenance` |
  | 13 | 其余（即 `fresh` + `in-graph-scope` + `modifies-existing` + `present`） | `consume-impact` | —（仍受 FR-006 caveat 约束） |

  **顺序设计说明（v2 修订，落 C2 两条反例）**：

  - **行 2（coverage 判定升到第 2 位）**：范围外的目标即便重建也进不了图，刷新纯属浪费 4.4s + 承担一次图覆写风险（Codex 反例 2：`stale` + `out-of-scope` + `allowed` 在 v1 下先命中刷新行、重建完仍降级）。因此**只要 `coverageScope = out-of-graph-scope`，无论图是 missing / corrupt / stale 还是 fresh，一律直接给 `coverage-gap-out-of-graph-scope`**——这些情形下消费方的正确动作完全相同：退回 Grep/Read。
  - **行 7（classification-unknown 下移到 availability 之后、freshness 之前）**：放在 availability 之后，是因为「图在手」才谈得上「降级消费」——图都不存在时给 `consume-degraded` 等于让消费方去消费一份不存在的图（Codex 反例 1：`unknown` + `missing` + `allowed` 在 v1 下命中行 2 直接降级，违背 EC-01「图不存在且允许刷新就该刷」）。v2 下该组合正确落**行 5** 刷新，与 EC-01 一致。放在 freshness 之前，是因为变更类别都判不出来时，不值得为它额外花一次刷新预算。
  - **`dirty` 与 `unknown-provenance` 明确不折进 `fresh`**：`dirty` 表示工作树有未提交改动，图内容与实际待验证代码不一致；`unknown-provenance` 表示无法判定，把不可知当作可信是最危险的静默降级。
  - **`unknown-provenance` 不进入刷新分支（行 12 无 allowed/declined 分叉）**：调研（`graph-bootstrap-status.mjs:355-399`）显示该状态的绝大多数成因是**工具面失败**（`spectra-cli-missing` / `freshness-timeout` / `unparseable-output` / `unexpected-exit-code` / `killed-by-signal`），刷新不能解决工具面失败，反而会在每次调用上叠加一次超时预算。

  **刷新成功后的收口规则（v2 新增，显式定义）**：行 3 / 5 / 8 / 10 触发刷新且 `attemptLocalGraphBuild` 返回 `ok: true` 后，**不重跑本矩阵**——重跑会因「dirty 工作树重建后依然 dirty」（EC-07）把刚刷好的图误判为需要再次降级/刷新。收口规则固定为：

  - `changeClass = unknown` → `consume-degraded` + `classification-unknown`；
  - 否则 → `consume-impact`（随后按 FR-006 做 caveat 注解）。

  刷新失败的改写规则见 FR-007。

  **⚠️ 维度非独立（编排器实测，见 orchestrator-verifications.md V-5 与 pilot O-6）**：`graphAvailability` 与 `freshness` **不是**独立维度。实测 `spectra graph-quality --json --graph <path>`：图缺失或图损坏时 `freshness.state` **必然**返回 `unknown-provenance`（`overallVerdict: cannot-assess`，exit 2）。因此 `{missing, corrupt} × {fresh, dirty, stale}` 共 **6 类组合 unreachable-by-construction**。本矩阵之所以对这 6 类仍然正确，**依赖求值顺序**：availability 判定（行 3-6）排在 freshness 判定（行 8-12）之前。**这是必须锁住的不变量**。

  *验证*：单测仍穷举 `3 × 3 × 4 × 2 × 2 = 144` 种输入组合作为**防御性**断言（每种组合都返回上表规定的出口与 `matchedRule`、无 `undefined`、不 throw），且**必须**：
  (a) 对上述 6 类 unreachable 组合加显式注释标注其不可达性与理由（内容沿用 O-6，行号引用按 v2 表更新）；
  (b) **两条顺序不变量探针**——
   · **missing 探针**：`graphAvailability=missing` + 人为构造的 `freshness=fresh` + `in-graph-scope` + `modifies-existing`，断言 `matchedRule ∈ {5, 6}`（按 policy）而非 13；
   · **out-of-scope 探针**：`coverageScope=out-of-graph-scope` + `freshness=stale` + `refreshPolicy=allowed`，断言 `matchedRule = 2` 且 `outcome = "consume-degraded"`、**未触发刷新**，而非落到行 8；
  (c) 一条「刷新成功后收口」单测：分别以 `changeClass=unknown` 与 `modifies-existing` 走刷新成功路径，断言终态为 `consume-degraded/classification-unknown` 与 `consume-impact`，且矩阵未被二次求值（用求值计数桩断言）。
  另断言出口集合恰为上述 5 个值（`invalid-input` 单列）。

- **FR-004（`DEGRADED_REASONS` 封闭枚举，12 值）** `[必须]`：degraded reason 必须是下述**封闭枚举**之一，实现必须导出 `DEGRADED_REASONS` 常量供测试与消费方引用（禁止散落字符串字面量）：

  | 枚举值 | 语义 |
  |--------|------|
  | `impact-not-applicable-additive-only` | 纯新增任务，impact 语义上不适用 |
  | `classification-unknown` | 变更类别无法机械判定 |
  | `graph-missing` | 图不存在且未刷新 |
  | `graph-corrupt` | 图存在但不可解析/不可查询，且未刷新 |
  | `graph-stale-refresh-declined` | 图落后于 HEAD，本次不允许刷新 |
  | `graph-dirty-uncommitted` | 工作树有未提交改动，图不反映实际待验证代码 |
  | `graph-unknown-provenance` | freshness 无法判定（多为工具面失败） |
  | `refresh-failed-spectra-missing` | 刷新失败：`spectra` CLI 不可执行（ENOENT） |
  | `refresh-failed-timeout` | 刷新失败：超出 deadline |
  | `refresh-failed-nonzero-exit` | 刷新失败：非零退出码 |
  | `refresh-failed-artifact-unusable` | 刷新进程 exit 0，但产物缺失/不可解析/缺 `graph.sourceCommit` |
  | `coverage-gap-out-of-graph-scope` | **目标路径整体不在图覆盖范围内**（O-5）——与图是否 fresh 无关，矩阵行 2 命中 |

  *验证*：单测断言 `DEGRADED_REASONS` 恰含上述 12 项；另用 grep 断言实现文件内无该枚举之外的 reason 字面量出现在 `degradedReason` 返回路径上。

- **FR-004b（`CAVEAT_CODES` 封闭枚举，与 degraded reason 分离）** `[必须，v2 新增，落 C6]`：caveat 是**不改变出口**的附注，走独立通道，必须导出独立常量 `CAVEAT_CODES`：

  | 枚举值 | 语义 | 唯一产生路径 |
  |--------|------|-------------|
  | `coverage-gap-known-extraction-limit` | **图是新的且目标在图覆盖范围内，但命中已登记的抽取器漏边形态**（O-3） | FR-006 的 `annotateImpactCaveat`，仅写入 `caveats[]` |

  `CAVEAT_CODES` 的值**不得**出现在 `degradedReason` 字段；`DEGRADED_REASONS` 的值**不得**出现在 `caveats[]`。两组枚举的交集必须为空。这一分离即是 D7 措辞红线的机器化落地：让「fresh、在范围内、但仍可能漏边」成为一个可表达、可断言、且不与降级混淆的状态。
  *验证*：单测断言两组常量交集为空、`CAVEAT_CODES` 恰含 1 项；断言 `caveats[]` 中出现的任意值都属于 `CAVEAT_CODES`。

- **FR-005（变更类别机械判定，NUL 分隔契约）** `[必须]`：提供一个纯函数把 git 输出文本解析为 `changeClass` + 变更文件清单。**输入格式锁定为 NUL 分隔**：`git diff --name-status -z <base-ref>..` 与 `git status --porcelain -z`（`-z` 同时规避文件名转义/引号/空格/中文路径三类歧义）。解析契约：
  - `--name-status -z`：记录为 `<status>\0<path>\0`；重命名/复制记录为 `<status><score>\0<old-path>\0<new-path>\0`（**三段**，即 `R100` 后跟两个 NUL 分隔路径；**不存在** ` -> ` 这一人读形态）。
  - `--porcelain -z`：记录为 `XY <path>\0`；重命名记录为 `XY <new-path>\0<old-path>\0`（**注意与 name-status 的新旧顺序相反**）。
  判定规则：存在任一状态码为 `M` / `R` / `C` / `D`（修改/重命名/复制/删除既有文件）→ `modifies-existing`；全部为 `A` / `??`（新增/未跟踪）→ `additive-only`；输入为空或不可解析 → `unknown`。解析实现应复用 `goal-loop-core.mjs` 中 `parsePreservedConfigStates` 已建立的 porcelain 解析范式（同一套字段切分口径），但**不修改该函数本体**。
  *验证*：单测输入固定的 **NUL 分隔** fixture（用 `\0` 字面构造，含 `M`、`A`、`??`、`R100` 三段重命名记录、`C75` 复制记录、空输入、含空格文件名、含中文与引号字符的路径），断言分类与文件清单；另有一条负例断言「若实现误按 ` -> ` 人读格式切分，重命名 fixture 会得到错误文件清单」——该负例即是格式契约的守卫。

- **FR-006（fresh 结果的 caveat 后置注解）** `[必须，v2 改为独立后置纯函数，落 W1]`：新增独立纯函数 `annotateImpactCaveat(decision, impactResult) -> decision'`，**不改变** `decideGraphConsumption` 的五维入参。语义：
  - 仅当 `decision.outcome === "consume-impact"` 时生效，其余出口原样返回（`caveats` 保持空数组）。
  - 触发条件：`impactResult.directCallers === 0` 且目标为 TS/JS 源。
  - **「目标为 TS/JS 源」的判据 = 与 `coverageScope` 完全同一份扩展名白名单**（`.ts/.tsx/.js/.jsx`，O-5 对齐；采纳 clarify C-002）。该白名单必须由单一常量模块导出并被两处共同 import，**不得出现第二份白名单**。事实上能走到 `consume-impact`（矩阵行 13）就已隐含 `coverageScope = in-graph-scope`，因此该条件对可达输入恒真——保留判据只为让函数在被单独调用时仍自洽。
  - 效果：向 `decision.caveats` 追加 `coverage-gap-known-extraction-limit`（FR-004b），**不改变 `outcome`、不写 `degradedReason`**。
  - **CLI 时序固定为**：决策 → （若出口需要消费）调用 impact → `annotateImpactCaveat` 注解 → 输出/落审计。
  *验证*：单测（a）`consume-impact` + `directCallers: 0` → `caveats` 含该值、`outcome` 与 `degradedReason` 不变；（b）`consume-impact` + `directCallers: 3` → `caveats` 为空；（c）`consume-degraded` + `directCallers: 0` → `caveats` 为空（非消费出口不注解）；（d）grep 断言扩展名白名单常量在全仓仅定义一处。

- **FR-007（刷新执行与失败改写）** `[必须]`：刷新执行层（I/O 层，与 FR-001 纯函数分离）必须复用 F239 的 `attemptLocalGraphBuild`，其 canonical 路径由 D8 定为 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`，**不得**另写一份 spawn / deadline / 进程组清理 / 产物校验逻辑。刷新返回失败时，最终出口从 `refresh-then-consume` 改写为 `consume-degraded`（图仍可用时，即刷新前 `graphAvailability = present`）或 `unavailable`（刷新前为 `missing` / `corrupt`），degraded reason 按 `attemptLocalGraphBuild` 的 `reason` 字段映射到 FR-004 的 `refresh-failed-*` 四值（`spawn-error`+ENOENT → `refresh-failed-spectra-missing`；`timeout` → `refresh-failed-timeout`；`non-zero-exit` → `refresh-failed-nonzero-exit`；`graph-missing-after-build` / `graph-unparsable` / `graph-not-queryable` → `refresh-failed-artifact-unusable`）。
  *验证*：以注入的 fake `attemptLocalGraphBuild` 跑单测，断言四类失败各自映射到对应枚举值；另断言同一失败在「刷新前 present」与「刷新前 missing」下分别得到 `consume-degraded` 与 `unavailable`。

- **FR-008（刷新次数约束：进程内硬保证 + 跨调用为调用方合同）** `[必须，v2 收窄，落 C3]`：本条拆为两层，**权威度不同，实现与验收都不得混为一谈**：

  1. **进程内 single-flight（硬保证，可测）**：**一次 CLI 调用内最多 spawn 一次图构建**。即便内部逻辑分支再多，也不得出现同一进程两次调用 `attemptLocalGraphBuild`。刷新成功后按 FR-003 收口规则直接出结论，**不重跑矩阵、不因 freshness 仍非 `fresh` 而二次刷新**（EC-07：脏工作树重建后依然 `dirty`，把 `fresh` 当消费前置会造成无限刷新）。刷新后的消费前置条件是**产物可用性**（`attemptLocalGraphBuild` 返回 `ok: true`），不是 freshness 状态。
  2. **跨调用 once-ness（调用方合同，非 CLI 自保证）**：CLI 是无状态进程，且 EC-13 禁止跨进程锁、W3 禁止生产决策代码读审计文件——因此 CLI **无法也不试图**自行判断「本 phase 是否已刷过」。约束改由**调用方合同**承担并写入文档：

     > **调用方合同**：编排层（SKILL 散文层）与 goal_loop 在**同一 phase + 同一 projectRoot** 下，第一次调用可传 `--refresh-policy allowed`，**第二次起必须传 `--refresh-policy declined`**。`--phase` 缺省时使用固定 sentinel `"unscoped"`（采纳 clarify C-004），所有未指明 phase 的调用聚为同一组，同样受本合同约束——省略 `--phase` **不等于**豁免。

     该合同将来落进 SKILL.md 散文层与 goal_loop 调用点注释；CLI 侧只负责忠实执行传入的 `refreshPolicy`，不做二次猜测。
  **明确否决的路线（clarify C-001「CLI 读审计 JSONL 判已刷过」）**：不采纳。理由两条且均为硬理由——(a) 审计记录写在**决策与刷新之后**，它不是原子 claim，两个并发进程会各自读到「尚未刷过」而双双 spawn，把可用性问题伪装成已解决；(b) W3 处置明确禁止生产决策代码把审计文件当输入（审计是可被人工编辑、可被清理、可被 gitignore 丢弃的观测产物，让决策依赖它等于给决策引入一条不可信输入通道）。
  *验证*：见 SC-007（(a) 进程内 spawn 计数 ≤ 1；(b) 按调用方合同跑两次的集成断言）。

- **FR-009（CLI 两子命令契约：`decide` / `annotate-caveat`）** `[必须，v3 改两子命令，落 P-C1]`：决策 CLI 暴露**两个子命令**而非一个。拆分的硬性依据：CLI 是 `.mjs` 脚本、**不持有 MCP client**，无法在单命令内自行发起 `impact` 调用（plan 已论证），impact 必须由调用方（编排层 / goal_loop）发起。

  1. **`decide`**：参数为 `--project-root <path>`、`--phase <name>`（缺省 sentinel `"unscoped"`）、`--base-ref <ref>`（**权威判定必传**，phase 起点 ref；goal_loop 用该轮快照 S_i 的锚点；缺省时退化为仅用 `git status --porcelain -z` 的工作树差异并在输出标 `baseRefMissing: true`）、`--refresh-policy allowed|declined`、`--advisory`（切换 `pre-implement advisory` 合同，见 FR-011）、`--dry-run`、`--format json|text`（默认 json）。内部完成「采集五维输入（含调用 D8 canonical 模块的 `checkFreshness`） → 调用 FR-001 纯函数 → 按需刷新（受 FR-008 进程内 single-flight 约束） → 输出决策 JSON（含 `decisionId` 与决策时的 `graphSourceCommit`） → **非 dry-run 时当场**追加 `kind:"decision"` 审计事件（FR-010）」。`--dry-run` 下只打印将要执行的操作计划，**不 spawn 任何构建、不写任何审计事件**。
  2. **`annotate-caveat`**：参数为 `--project-root <path>`、`--decision <json|@file>`（`decide` 的原样输出）、`--impact-result <json|@file>`（调用方拿到的 impact 结果）、`--impact-status completed|failed|skipped`、`--format json|text`。内部完成「快照校验（比对 decision 的 `graphSourceCommit` 与当下图内嵌值，见 FR-010） → 调 `annotateImpactCaveat`（FR-006） → 输出注解后的 decision → 追加 `kind:"caveat-annotation"` 审计事件」。

  **CLI 时序固定为**：`decide` → （若出口需要消费 impact）**由调用方**发起 MCP `impact` → `annotate-caveat`。**不消费 impact 的出口**（`skip-impact` / `consume-degraded` / `unavailable`）与 **goal_loop authoritative 路径**只跑 `decide` 一步即为完整形态，没有注解事件不算漏（FR-010）。
  *验证*：`node plugins/spec-driver/scripts/<cli>.mjs decide --dry-run --format json` 输出可被 `JSON.parse`，含 `outcome` / `degradedReason` / `caveats` / `inputs` / `advisory` / `matchedRule` / `decisionId` 七个顶层键；断言 dry-run 下图文件 SHA-256 不变（RG-008）且审计文件零新增事件；断言 `--advisory` 下输出 `advisory: true` 且 `outcome !== "skip-impact"` 不被当作权威结论字段写出（见 FR-011）；`annotate-caveat` 以 `decide` 的真实输出为入参跑一次，断言其输出 `caveats` 与新增的注解事件内容一致、`decisionId` 回链正确。

- **FR-010（审计：双事件模型，decision 事件独立满足）** `[必须，v3 改双事件，落 P-C1]`：审计不再是「一决策一行」，而是 `.specify/graph-consumption-audit.jsonl` 上的**事件日志**，共两种 `kind`：

  1. **`kind: "decision"`**：`decide` 在**非 dry-run** 时**无条件当场**追加一条——无论出口为何、无论后续是否消费 impact、无论调用方是否再跑 `annotate-caveat`。字段：`{ kind: "decision", decisionId(uuid), ts, phase, advisory, inputs: <五维入参对象>, outcome, degradedReason, caveats: []（此刻恒空）, graphSourceCommit（决策时图内嵌值 | null）, refreshAttempted, refreshOk }`。**FR-010「每次决策必留证据」由该事件独立满足**，与后续任何步骤无关——两步之间 crash 也不会漏记。
  2. **`kind: "caveat-annotation"`**：`annotate-caveat` 被调用时追加一条。字段：`{ kind: "caveat-annotation", decisionId（回链 decision 事件）, ts, impactStatus: "completed"|"failed"|"skipped"|"snapshot-mismatch", caveats: [...], graphSourceCommitAtAnnotation }`。
     **入参快照校验（必须）**：把 decision JSON 里的 `graphSourceCommit` 与注解时刻的图内嵌值比对；**不相等**时 `impactStatus` 置为 `"snapshot-mismatch"`、`caveats` **置空且不采信**该 impact 结果——「decide 读的是 G1、impact 却跑在 G2 上」这类跨快照拼接必须被显式检出，而不是静默拼接。

  **goal_loop authoritative 路径（本就不消费 impact）= `decide` 单步即完整形态**，缺注解事件是正确形态，不得据此判为漏审计。

  该路径必须被 gitignore 且有自举保障（FR-024）。写入必须是 append-only 且对并发写安全（单次 `appendFileSync` 写完整一行，行内不含裸换行）。审计写失败**不得**阻断决策返回（降级为 stderr warning）。审计是**只写不读**的观测产物：生产决策代码禁止把它当输入（RG-006）。
  *验证*：跑两次非 dry-run `decide` 后断言文件恰有 **2 条 `kind:"decision"` 事件**、0 条注解事件；再跑一次 `annotate-caveat`，断言新增恰 1 条 `kind:"caveat-annotation"` 事件且 `decisionId` 与对应 decision 事件一致；构造「注解前图被重建」的场景，断言注解事件 `impactStatus: "snapshot-mismatch"` 且 `caveats` 为空；把审计目录设为只读后跑一次 `decide`，断言进程退出码仍为 0 且 stderr 含 warning。

- **FR-011（goal_loop 接线：双合同，零改造既有函数）** `[必须，v2 拆双合同，落 C4]`：goal_loop 与散文层通过 FR-009 的 CLI（或直接 import FR-001 纯函数）消费同一份判定，但按 D3 的两个合同区分调用：

  1. **`pre-implement advisory`（goal_loop 每轮注入前调用）**：以 `--advisory` 调用；输入的 `changeClass` 来自「轮 1：tasks.md 已声明目标文件路径存在性 + 相对 `--base-ref` 的 diff；轮 ≥2：相对同一 `--base-ref` 的累计 diff」。输出**必须**含 `advisory: true`。允许的后果**仅限于**：(a) 决定是否预刷新一次图；(b) 决定注入的 grounding 语气与 caveat 文案。**禁止**据此产生「impact 不适用」的权威结论——advisory 模式下 `skip-impact` 只能表述为「本轮预计无需 impact（advisory）」，不得落成权威判定字段、不得据此让 verify 跳过影响面复核。
  2. **`pre-verify authoritative`（implement 之后、verify 之前调用）**：不带 `--advisory`，`--base-ref` 为 phase 起点 ref，使用本轮实际 diff。输出 `advisory: false`。所有权威 degraded reason 与最终「是否消费 impact」以此为准。

  注入规则：仅在出口为 `consume-impact` 或刷新成功的 `refresh-then-consume` 时注入；其余出口跳过注入并把 degraded reason 写入该轮 iteration log 条目。**`interpretImpactResult` 与 `decideStop` 函数体不得修改**；iteration log 条目的新增字段必须以**新增可选字段**方式实现，对不含该字段的旧调用形态优雅降级。
  *验证*：`node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` 全绿（含 `interpretImpactResult (FR-012)` 的四条冻结断言）；新测试断言（a）advisory 调用输出含 `advisory: true`；（b）advisory 下即便 `changeClass=additive-only`，权威判定字段未被写入、verify 侧仍会发起 authoritative 调用；（c）缺 freshness 相关字段的旧形态输入不抛错、行为与改动前一致。

### E1 — KB coverage-gap

- **FR-012（no-hit 记录与 redaction 第一层）** `[必须]`：在 `kb_search`、`kb_api_lookup`、`spectra scaffold-kb query` 三个入口，当结果命中数为 0 **且本次至少真正检索过一个库**时记录一条 no-hit 事件。

  **前置条件「至少查过一个库」（v4 增，落 B2-7）**：`source_filter` 与可用库求交后为空（例如只有 vendor 却请求 `source_filter: "project"`）、或两侧 handle 均为 `null` 时，零结果是**可用性**问题而非文档缺口，**不得**记录——否则 backlog 会被"没有库可查"污染成"文档缺失"。三个入口共用这条前置条件。

  **入库前**必须先对查询串施加 redaction。redaction **入口先做 NFKC 归一化再匹配规则**，且归一化必须复用 `src/scaffold-kb/tokenizer.ts` 导出的**同一个**函数（v4 钉死，落 B2-1）：顺序颠倒或各写一份，全角形态（`１２３４５６７８`）会绕过规则、却在落盘切词时被还原成 ASCII 敏感串。规则中**凭据参数名**（`?TOKEN=`）、**认证 scheme**（`bearer`）、**home 路径段**（`c:\users\`）一律**大小写不敏感**；`sk-` / `ghp_` 等小写字面量前缀保持敏感（放宽会误遮普通大写词）。规则如下，逐条替换为占位类型标记：

  | 形态 | 判据 | 替换为 |
  |------|------|--------|
  | email | 含 `@` 的地址形态 | `<EMAIL>` |
  | 带凭据的 URL | URL 中含 `user:pass@` 或 `token=` / `key=` / `secret=` 查询参数 | `<URL_WITH_CRED>` |
  | 高熵串 | 长度 ≥ 20 的连续 hex / base64 字符集片段 | `<HIGH_ENTROPY>` |
  | 疑似 token | 命中常见 token 前缀形态（`sk-` / `ghp_` / `Bearer ` 等） | `<TOKEN>` |
  | 绝对路径 home 段 | `/Users/<name>` / `/home/<name>` / `C:\Users\<name>` | `<HOME>` |
  | 连续数字串 | 长度 ≥ 8 的纯数字 | `<DIGITS>` |

  规则集必须以数据表形式声明（而非散落正则），便于测试穷举与后续扩充。redaction **不是** `sanitizeQuery`（FTS5 语法构造）也 **不是** `defangSentinel`（防注入拆解），必须新写独立模块，不复用二者。
  **能力边界必须在模块文档注释中如实写明**：本规则集只覆盖**结构上可判别**的形态，对中文姓名、内部项目代号、自然语言口令、带分隔符的电话号码等**无结构特征**的敏感内容无效（D5 残余风险声明）。
  **fallback 分支不豁免（v3 补充，落 P-W3）**：`kb_api_lookup` 走 `document_fallback` 分支且 `hits.length === 0` 时**必须记录** no-hit——这是**真实的零结果**（用户问了、KB 什么也没给出），不得因为入口是 fallback 就把该分支整体排除在采集之外，否则 coverage-gap backlog 会系统性漏掉 API 类缺口。
  *验证*：单测对每条规则各给 ≥ 2 个正例 + 1 个反例，断言输出串中不含原文敏感片段；另有一条断言模块导出的规则表长度与文档表一致（防规则悄悄减少）；另有一条断言 `kb_api_lookup` 的 `document_fallback` + `hits.length === 0` 路径确实产生了一条 no-hit 记录。

- **FR-013（no-hit 记录的落盘范围、存储与保留）** `[必须，v2 收窄落盘声明，落 C5]`：no-hit 记录写入 `.specify/kb-nohit/nohit-<YYYYMMDD>.jsonl`。**落盘内容严格限定为**：
  - `terms: string[]` —— redaction 后的串再经仓内 tokenizer（`src/scaffold-kb/tokenizer.ts`）切词、去重后的 term 列表；
  - `normalizedQueryHash: string` —— 归一化查询串的 hash（用于 `distinctQueries` 计数，不可逆、不用于还原）；
  - `redactionTags: string[]`、`tool`、`timestamp`、`resultCount: 0`、`dbPathHash`、`schemaVersion`。

  **不新增承载整串的字段**（无 `query` / `redactedQuery`；既不存原文，也不存 redaction 后的完整串）。**如实声明**：`terms` 仍可能包含 redaction 未识别的敏感词，且**单 token 查询时该 term 在字节上等于原串**——属 D5 已收窄并接受的残余（B2-5），本条不声称已消除该风险。
  `normalizedQueryHash` 的输入是**等价类归一化**结果（NFKC + tokenizer 切词 + case-fold + 去重后重组，见 `tokenizer.ts::normalizeForEquivalence`）：大小写/全角变体必须收敛为同一 hash，否则同一个问题换个大小写问两遍就能把共同 term 顶过 FR-015 阈值（v4 钉死，落 B2-6）。
  该路径必须被 gitignore 且有自举保障（FR-024）。保留期 **30 天**滚动（proposed-default，见 OQ-2）：写入时清理 mtime 超过 30 天的同目录文件。可读范围 = 本机文件系统权限（不上传、不外发、不进任何 telemetry 上报通道）。写失败一律静默降级为 no-op（不得影响 KB 查询本身的返回）。
  *验证*：单测断言落盘对象的键集合恰为上列字段（**无** `redactedQuery` 等整串字段）；单测伪造 40 天前 mtime 的文件，跑一次写入后断言该文件被删除；把目录设为只读后跑一次查询，断言查询正常返回。gitignore 断言见 SC-020。

- **FR-014（采集开关钉死为单一 env + 状态可区分）** `[必须，v3 钉死开关，落 P-W3]`：no-hit 采集**默认关闭**，开关**钉死**为**单一环境变量 `SPECTRA_KB_NOHIT_TELEMETRY`**：其值 = no-hit 记录目录路径（约定为 `.specify/kb-nohit/`，见 FR-013）；**未设置或值为空字符串 = 关闭**。该形态对齐 O-4 记录的既有先例 `SPECTRA_MCP_TELEMETRY_PATH`（env 直接携带路径、不设即不采集）。**不引入 config 字段、不引入「布尔开关 + 路径」两个变量**——「env 或 config 由 plan 决定」这一悬置表述在 v3 作废。FR-012 的三个 recorder 入口（`kb_search` / `kb_api_lookup` / `scaffold-kb query`）**必须共用同一个解析函数**读取该 env，禁止三处各自 `process.env` 取值导致语义漂移。

  coverage-gap 子命令的输出必须区分至少**四种**状态且**不得混淆**（v4 增第四态，落 B2-3）：`collection-disabled`（env 未设或为空，无从判断有无缺口）、`no-data`（已开启但尚无记录）、`data-unreadable`（匹配到 no-hit 文件但**全部读取失败**——权限/断链/IO——同样无从判断有无缺口）、`no-gap-above-threshold`（有记录但无条目满足最小出现阈值）。**禁止**在采集关闭、或数据存在却读不出来时返回空 backlog 而不标明状态。判定顺序：`readErrors > 0 且 totalRecords === 0` → `data-unreadable`，优先于 `no-data`。
  *验证*：四种条件各跑一次子命令，断言输出 `status` 字段分别为上述四值；断言四种情况下 `items` 均为空数组但 `status` 互不相同；断言 `readErrors` 是恒在字段（关闭态为 0）；grep 断言全仓仅有一处读取 `SPECTRA_KB_NOHIT_TELEMETRY` 的实现，三个 recorder 均 import 该解析函数；断言 env 设为空字符串时行为等同未设置（`collection-disabled`）。

- **FR-015（最小出现阈值聚合与 backlog 输出）** `[必须，v2 锁死聚合键，落 C5]`：coverage-gap 子命令读取 no-hit JSONL，按 **term** 聚合，仅输出满足 `distinctQueries ≥ 2`（k = 2）的条目。字段语义**锁死**：

  - `distinctQueries` = 包含该 term 的记录中**不同 `normalizedQueryHash` 的个数**。同一查询被重复执行 N 次只计 **1**（否决 clarify C-003 的「按行数/事件数计」——那恰是 C5 指出的绕过形态：把同一句话查两遍就能突破阈值）。
  - `occurrences` = 包含该 term 的**记录总行数**（即事件次数），仅作热度可见性，**不参与阈值判定**。

  每个条目另含：涉及工具集合、首次/末次时间。输出支持 `--format json|markdown`。损坏行（JSON 不可解析）跳过并在输出中报告跳过行数（`skippedLines`），**不得**因单行损坏而整体失败；**文件级读取失败**（权限/断链/IO）同样不得中断聚合，但必须计入独立字段 `readErrors` 并按 FR-014 参与 `data-unreadable` 判定——静默跳过会把"数据不可读"伪装成"尚无记录"（v4 增，落 B2-3）。
  *验证*：见 SC-011（fixture 含「同一 normalizedQueryHash 重复 3 行的 term」，断言其 `distinctQueries = 1` 因而**被阈值挡在 backlog 之外**——这条即是绕过形态的守卫）。

### E2 — KB version selection

- **FR-016（lockfile 版本推断，npm 生态）** `[必须]`：新增一个 lockfile 解析器，从 `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` 中提取指定包名的**已解析具体版本**。仓内既有 `LOCK_FILE_PRIORITY`（`src/panoramic/project-context.ts:27-38`）只做包管理器**检测**、不解析内容，可复用其优先级顺序但必须新写解析逻辑；`AbstractConfigParser` 语义只覆盖 YAML/ENV/TOML，**不适用**于本需求。非 npm 生态（go / maven / gradle / uv / pipenv）返回明确的 `ecosystem-unsupported`，**不猜测**（proposed-default，见 OQ-3）。
  *验证*：对三种 lockfile 各给一份最小 fixture，断言解析出预期版本；对 `go.sum` fixture 断言返回 `ecosystem-unsupported`。

- **FR-017（版本优先级、resolved.status 语义与冲突双呈现）** `[必须，v2 定死多 lockfile 语义，落 W6]`：版本决议优先级自高到低为：(1) 查询中显式指定的版本；(2) lockfile 推断的具体版本；(3) `package.json` 中声明的 range（弱信号）；(4) 无信息。`resolved.status` 为封闭枚举，语义如下：

  | `resolved.status` | 含义 | `resolved.version` |
  |---|---|---|
  | `explicit` | 采用查询显式指定的版本 | 该版本 |
  | `lockfile` | 采用唯一 lockfile 推断出的具体版本 | 该版本 |
  | `range-only` | 只有 `package.json` range，无具体版本 | `null`（range 值进 `candidates[]`） |
  | `ambiguous` | **存在多个 lockfile 且无显式版本**，无法收敛 | **`null`** |
  | `none` | 无任何版本信息 / 生态不支持 | `null` |

  当 (1) 与 (2) 同时存在且不一致时，`status = "explicit"`，但输出必须**同时呈现** (2) 的值并标 `version-conflict`。当存在多个 lockfile 且无显式版本时，**必须**输出 `resolved = { status: "ambiguous", version: null }` + **全量** `candidates[]`（每个 lockfile 各一条），**不得**擅自按 `LOCK_FILE_PRIORITY` 收敛为单值。lockfile 与实际安装版本不一致时同样双呈现并标 `lockfile-install-mismatch`。
  *验证*：五组 fixture（仅显式 / 仅 lockfile / 两者冲突 / 多 lockfile 无显式 / 多 lockfile + 显式）各跑一次，断言 `resolved.status` 分别为 `explicit` / `lockfile` / `explicit` / `ambiguous` / `explicit`，且第四组 `resolved.version === null`、`candidates.length ≥ 2`、`flags` 含 `multiple-lockfiles`；冲突组断言 `flags` 含 `version-conflict`。

- **FR-018（版本信息进入 KB 查询）** `[可选]`：把决议出的版本作为 KB 查询的过滤/加权信号（对齐 `chunk_meta.sdk_version` / `ApiEntity.sinceVersion`）。标 `[可选]` 的理由：即便不接入检索，E2 的独立子命令输出本身已满足「版本自动识别」的验收；接入检索会触碰 F190-F192 的排序语义，回归面显著扩大。**若 plan 阶段发现无法在不改检索语义的前提下接入，本条降级为 `MAY` 并从本轮移除**，只保留 FR-016/FR-017 的独立决议能力。`resolved.status = "ambiguous"` 时**不得**接入过滤（无单一版本可用），只能原样透出候选。
  *验证*：若实现，断言同一查询在不同决议版本下返回的 chunk 的 `sdk_version` 分布有差异，且 `ambiguous` 下过滤未生效；若不实现，在 plan 中记录移除理由。

### E3 — KB freshness status

- **FR-019（KB 状态子命令与 freshness 公式）** `[必须，v2 定死公式，落 W6]`：新增 `spectra scaffold-kb` 的状态子命令，输出：库路径与是否存在、schema 兼容态、`activityAt`、`activityAgeDays`、`oldestBuiltAt`、`ingestAgeDays`、source version 列表（`sdk_version` 去重）、no-hit 采集态与近期计数、以及三元新鲜度。**公式定死**：

  - `activityAt = max(built_at, ingested_at)`（"最近一次活动"；两者任一缺失时取存在的那个；都缺失则 `activityAt = null`）；
  - `freshness` 由 `now - activityAt` 对阈值表求值：`current`（≤ 30 天）/ `aging`（> 30 天）/ `stale`（> 90 天）[推断，proposed-default，见 OQ-2]；`activityAt = null` 或 schema 不兼容时为 `unknown`；
  - `oldestBuiltAt` = 最早的 `built_at`，**仅供可见性输出，不参与任何判级**（用于让维护者看出"库里有很老的分片"，但不能因此把整库判为 stale）。

  **只报告状态，不触发任何重建或 ingest。**
  *验证*：对一份 fixture 库跑子命令，断言输出含全部字段；构造 `built_at` = 100 天前但 `ingested_at` = 5 天前的库，断言 `freshness: "current"`（验证取 max 而非 min）且 `oldestBuiltAt` 如实反映 100 天前；构造两者均 100 天前的库，断言 `stale`；断言运行前后库文件 SHA-256 不变。

- **FR-020（旧 schema 库的探测-兼容；`unknown` 恒定）** `[必须，v3 钉死语义，落 P-W4]`：状态与聚合逻辑读取 `chunk_meta` 的 provenance 类列（`built_at` / `ingested_at` / `ingest_source_type` 等）前，必须先用 `PRAGMA table_info` 探测列是否存在，沿用 `src/scaffold-kb/schema-compat.ts:19-33` 的 `hasProvenanceColumns` 模式；旧库缺列时相应字段返回 `null` 并把新鲜度状态置为 `unknown`，**不得**抛错、**不得**假定所有历史库都有新字段。若本 feature 需要新增列或新表，同样必须走探测-兼容路径，且必须能在旧库上只读运行。

  **`freshness: "unknown"` 在旧 schema 下是恒定结论（v3 钉死）**：即便旧库恰好有一列 `built_at` 且其值很新（例如 5 天前），也**不得**据此判为 `current`。理由：FR-019 的判级输入是 `activityAt = max(built_at, ingested_at)`，缺 provenance 列意味着 `ingested_at` 不可知，单凭 `built_at` 一列无法支撑任何判级声明——那属于 D7 措辞红线禁止的 over-claim。
  *验证*：准备一份缺 provenance 列的旧 schema fixture 库，跑状态子命令，断言退出码 0、相关字段为 `null`、`freshness: "unknown"`；另准备一份缺 provenance 列但 `built_at` 为 **5 天前**的旧库，断言 `freshness` 仍为 `"unknown"`（不得回落为 `current`），见 SC-013。

- **FR-021（MCP 响应字段扩展，向后兼容；追加范围钉死）** `[必须，v3 钉死追加范围，落 P-W4]`：`kb_search` 与 `kb_api_lookup` 的响应新增一个状态子对象 `kb_status`（含 `activityAgeDays`、source version 列表、三元新鲜度）。必须是**纯新增字段**，既有字段名、类型、层级零变更（`kb_search` 的 `results` / `total_found`、`kb_api_lookup` 的 `not_found` 等一律保持）。**不新增独立 MCP tool**（D4）。

  **追加范围钉死**：`kb_status` 追加到**全部成功 envelope**，明确包含 `kb_api_lookup` 的 `document_fallback` 分支与 `not_found: true` 的早返回路径——这两条同样是**成功响应**，调用方同样需要知道「查不到，是不是因为库太旧」。**error envelope 不追加**（明定：错误响应保持既有形状，不因治理字段扩大错误路径的契约面）。
  *验证*：`npx vitest run tests/kb/kb-contract.test.ts tests/kb/kb-search-tool.test.ts tests/kb/kb-api-lookup-tool.test.ts` 全绿；新增断言：(a) 常规成功响应含 `kb_status` 且既有字段快照不变；(b) `document_fallback` 分支与 `not_found: true` 早返回两条路径的响应**均含** `kb_status`；(c) error envelope **不含** `kb_status`。

### 数据路径自举

- **FR-024（新增数据路径的 gitignore 自举同步）** `[必须，v2 新增，落 C5-4]`：本 feature 新增的两条本机数据路径 `.specify/kb-nohit/` 与 `.specify/graph-consumption-audit.jsonl` 必须**同时**加入两处清单，缺一不可：

  1. 仓库根 `.gitignore`（保障本仓开发态）；
  2. `plugins/spec-driver/scripts/lib/ensure-gitignore.sh` 的自举清单（保障第三方安装态——F207 已建立该自举机制，新数据路径不入清单即等于对所有安装者默认泄露）。

  两处内容必须一致；新增条目不得放宽既有条目的匹配范围。
  *验证*：见 SC-020（本仓 `git check-ignore` 断言 + 把插件拷入临时全新 git repo 跑自举脚本后再断言）。

### Pilot

- **FR-022（按冻结口径取数 + 机器台账 + 三段执行）** `[必须，v2 增机器台账落 W5；v3 增三段执行与 ledger 迁移条款落 P-C2]`：pilot 三指标（M-1 grounding 命中率 / M-2 impact coverage / M-3 review 发现率）严格按 `pilot/measurement-design.md` 已冻结的定义采集，**口径不得修改**；如发现口径缺陷，只在报告中追加「口径缺陷」一节。具体要求：

  - **执行分三段（v3）**：**preflight**（批 1 开始**之前**：`pilot/predicted-impact-set.md` 已冻结的存在性校验 + `pilot/ledger.jsonl` 的 schema 校验）/ **continuous capture**（**横跨批 1-3**：每次 MCP 调用**当下**双写）/ **finalize**（批 4：实际集比对、M-3、报告撰写、ledger 重算校验）。只有 finalize 属于批 4；`predicted-impact-set.md` 与 `ledger.jsonl` **不是批 4 新增制品**（前者已冻结、后者持续记账中），plan / tasks 不得把它们标为批 4 新增。
  - **M-1 双写台账**：调用当下同时写入人读 `pilot/mcp-call-log.md` 与**机器可读** `pilot/ledger.jsonl`（每行含 timestamp、tool、target、四分类判读结果、备注）。另提供一个 dev-only 小验证脚本，从 `ledger.jsonl` 重算 M-1 四类计数与命中率，并与报告中的数字逐项比对，不一致即报错退出非 0。
  - **ledger 迁移条款（v3）**：schema 定稿**之前**写入的既有行允许 `"timestamp": null`，但**必须**带 `"timestampNote"`（说明「schema 定稿前记录，先后次序见 `pilot/mcp-call-log.md` 的 git 历史」）；schema 定稿**之后**的新行**必须**带真实 ISO timestamp。**禁止**为既有行伪造事后时间戳——回填假时间会把"无法重建的时序"伪装成已知事实，属于本 feature 全篇禁止的 over-claim。
  - **M-2**：预测集必须在 implement 开始**之前**冻结写入 `pilot/predicted-impact-set.md`（含时间戳与所用 target 列表），且**覆盖全部计划改动文件**，不允许只挑图内的。
  - **M-3**：两组同构对抗审查的**完整 prompt 与被审 diff 的 hash** 必须落盘（`pilot/m3/` 下，A/B 各一份），使"两组确实同构、审的确实是同一份 diff"可事后核验。
  - **诚实边界（不得省略）**：台账仍是**自报**——它消除的是算术漂移与事后追记，**不消除**自我选择偏置。该声明必须进报告（FR-023）。

  *验证*：`pilot/predicted-impact-set.md` 的首次提交时间早于首个 implement 代码提交；验证脚本退出码 0 且输出「ledger 重算 = 报告数字」；ledger schema 校验断言「凡 `timestamp` 为 null 的行必须有 `timestampNote`，且此类行仅存在于 schema 定稿 commit 之前」；`pilot/m3/` 下 A/B 两份 prompt 存在且记录的 diff hash 相同。

- **FR-023（pilot 报告的诚实性约束）** `[必须]`：pilot 报告必须显式写明：N=1、判读者非盲、单次采样、M-1 存在自我选择偏置（含「机器台账只治算术漂移、不治自报偏置」这一句）、`plugins/**/*.mjs` 部分命中率结构性封顶为 0（根因 O-5，处置 D6）。若 M-3 实验组 B 独有真 finding 数为 0，如实报 0，不得改判口径去凑正向结果。**禁止外推表述**（如「提升 X%」）——该项因黑名单不可穷举，改为 push gate 的人工审查项而非机器断言（见 SC-017）。
  *验证*：见 SC-017。

---

## Key Entities / 数据契约

### 1. `GraphConsumptionDecisionInput`（FR-001/FR-002 纯函数入参，严格五维）

```
{
  changeClass:      "modifies-existing" | "additive-only" | "unknown",
  graphAvailability:"present" | "missing" | "corrupt",
  freshness:        "fresh" | "dirty" | "stale" | "unknown-provenance",
  coverageScope:    "in-graph-scope" | "out-of-graph-scope",
  refreshPolicy:    "allowed" | "declined"
}
```

**无第六字段**。impact 结果不进入本函数——caveat 由后置纯函数 `annotateImpactCaveat(decision, impactResult)` 施加（FR-006 / W1）。

### 2. `GraphConsumptionDecision`（纯函数返回值）

```
{
  outcome:        "consume-impact" | "refresh-then-consume" | "consume-degraded" | "skip-impact" | "unavailable" | "invalid-input",
  degradedReason: <DEGRADED_REASONS 枚举值> | null,     // 12 值，FR-004
  caveats:        Array<CAVEAT_CODES>,                  // 仅 FR-004b 的值；由 annotateImpactCaveat 填充
  fallbackHint:   string | null,     // 例如「改用 context/graph_query 做模块级定位」
  matchedRule:    number             // 命中的 FR-003 v2 矩阵行号，便于测试与排障定位
}
```

`decide` 子命令输出（FR-009）在此基础上再加顶层键：`decisionId`、`graphSourceCommit`、`advisory: boolean`、`inputs`、`refreshAttempted` / `refreshOk` / `refreshDurationMs`、`baseRefMissing?: boolean`。`decisionId` 与 `graphSourceCommit` 是 `annotate-caveat` 的回链与快照校验入参（FR-010）。

### 3. 图消费审计事件日志 `.specify/graph-consumption-audit.jsonl`（FR-010，v3 双事件模型）

每行一个事件对象，由 `kind` 区分两种形态：

**(a) `kind: "decision"`** —— `decide` 在非 dry-run 时**无条件当场**追加：

```
{
  kind:            "decision",
  schemaVersion:   2,
  decisionId:      string,          // uuid，供 caveat-annotation 回链
  ts:              string,          // ISO
  projectRoot:     string,
  phase:           string,          // 缺省 sentinel "unscoped"
  advisory:        boolean,
  inputs:          <五维入参对象>,
  outcome:         <出口枚举>,
  degradedReason:  <DEGRADED_REASONS> | null,
  caveats:         [],              // 此刻恒空——caveat 只可能由注解事件产生
  graphSourceCommit: string|null,   // 决策时图内嵌值，供跨快照检出
  refreshAttempted:  boolean,
  refreshOk:         boolean|null,
  refreshDurationMs: number|null
}
```

**(b) `kind: "caveat-annotation"`** —— `annotate-caveat` 被调用时追加：

```
{
  kind:            "caveat-annotation",
  schemaVersion:   2,
  decisionId:      string,          // 回链上面的 decision 事件
  ts:              string,
  impactStatus:    "completed" | "failed" | "skipped" | "snapshot-mismatch",
  caveats:         Array<CAVEAT_CODES>,   // snapshot-mismatch 时必须为空
  graphSourceCommitAtAnnotation: string|null
}
```

append-only，gitignored（FR-024）。**「每次决策必留证据」由 (a) 独立满足**；(b) 缺失不构成漏记——不消费 impact 的出口与 goal_loop authoritative 路径本就只产生 (a)。`graphSourceCommit` 与 `graphSourceCommitAtAnnotation` 不相等时，注解事件必须记 `impactStatus: "snapshot-mismatch"` 且 `caveats` 置空、不采信该 impact 结果。

### 4. freshness 事实源（**不新建**）

freshness 的**唯一权威计算源**是 D8 canonical 模块 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 的 `checkFreshness`（现算）；provenance 一律读 F239 已有的 `graph-bootstrap-status.json`。本 feature **不新增第二份 freshness 状态文件、不缓存 freshness 判定、不复制 provenance 字段**。审计记录中的 `inputs.freshness` 是**决策当时的观测快照**，显式**非权威**：任何消费者（尤其生产决策代码）不得反向读取审计文件当作 freshness 或"是否已刷新过"的输入（RG-006 / FR-008）。

### 5. KB no-hit 记录 `.specify/kb-nohit/nohit-<YYYYMMDD>.jsonl`（FR-012/FR-013）

每行：`{ schemaVersion: 1, timestamp, tool: "kb_search"|"kb_api_lookup"|"scaffold_kb_query", terms: string[], normalizedQueryHash: string, redactionTags: string[], resultCount: 0, dbPathHash: string }`。
- `terms` = redaction 后再经 `src/scaffold-kb/tokenizer.ts` 切词去重的结果；**不存原始查询串整串，也不存 redaction 后的完整串**。
- `terms` 仍可能含 redaction 未识别的敏感词（D5 残余风险，如实声明，不冒充已消除）。
- `normalizedQueryHash` 用于 `distinctQueries` 计数（同一查询重复 N 次只计 1），不可逆。
- `dbPathHash` 是库路径的哈希（区分多库，不泄露路径）。
- 存放于 gitignored 目录（FR-024）；保留 30 天滚动；可读范围 = 本机文件系统权限；不进任何上报通道。

### 6. coverage-gap backlog 输出（FR-015）

```
{
  schemaVersion: 1,
  status: "collection-disabled" | "no-data" | "data-unreadable" | "no-gap-above-threshold" | "ok",
  minOccurrenceThreshold: 2,          // 原 kAnonymityThreshold 更名（C5）；非匿名性保证
  totalRecords: number,
  skippedLines: number,               // JSON 不可解析的行数（EC-18）
  readErrors: number,                 // 整份读取失败的文件数（v4 增，落 B2-3）
  items: [ { term, occurrences, distinctQueries, tools: string[], firstSeen, lastSeen } ]
}
```

`distinctQueries` = 不同 `normalizedQueryHash` 数（阈值判据）；`occurrences` = 记录行数（仅热度可见性）。

### 7. 版本决议输出（FR-017）

```
{
  resolved:  { status: "explicit"|"lockfile"|"range-only"|"ambiguous"|"none", version: string|null },
  candidates:[ { version, source, detail } ],
  flags:     Array<"version-conflict"|"range-only"|"multiple-lockfiles"|"ecosystem-unsupported"|"lockfile-install-mismatch">
}
```

`status = "ambiguous"` 时 `version` **必须**为 `null` 且 `candidates` 含全部 lockfile 的解析结果。

### 8. KB 状态输出（FR-019）

```
{
  schemaVersion: 1,
  dbExists: boolean,
  schemaCompat: "full" | "legacy-missing-provenance" | "unreadable",
  activityAt: string|null,            // max(built_at, ingested_at)
  activityAgeDays: number|null,       // now - activityAt，freshness 的唯一判级输入
  oldestBuiltAt: string|null,         // 仅可见性，不参与判级
  ingestAgeDays: number|null,
  sourceVersions: string[],
  noHitCollection: "enabled"|"disabled",
  recentNoHitCount: number|null,
  freshness: "current"|"aging"|"stale"|"unknown"
}
```

`dbExists` 与 `schemaCompat` 是**两个独立信号**：前者只回答「库文件在不在磁盘上」，后者回答「能不能读」。
**库文件存在但加载失败**（损坏 / 非 sqlite / schema 探测抛错）→ `dbExists: true` + `schemaCompat: "unreadable"`；
只有文件确实不存在才 `dbExists: false`。二者压成一个信号会把「要修库」误报成「要建库」。

MCP 响应扩展字段为该对象的子集（`activityAgeDays` / `sourceVersions` / `freshness`），纯新增。

---

## Edge Cases

### B4 侧

| # | 场景 | 期望行为 |
|---|------|---------|
| EC-01 | 图文件不存在（且目标在图范围内、非纯新增） | `refreshPolicy=allowed` → 矩阵行 5 尝试重建；`declined` → 行 6 `unavailable` + `graph-missing`。**不返回空 impact 假装无影响**。注意 v2 下 `changeClass=unknown` **不会**抢在 availability 之前把这一情形误降级（C2 反例 1 已闭合） |
| EC-02 | 图存在但 JSON 不可解析 / 缺 `graph.sourceCommit` | 归为 `graphAvailability=corrupt`，走 FR-003 行 3/4。判存一律用 `lstat`（`existsSync` 对 broken symlink 返回 false） |
| EC-03 | `spectra` CLI 不存在（ENOENT） | `checkFreshness` 返回 `unknown-provenance` + `spectra-cli-missing` → 出口 `consume-degraded` / `graph-unknown-provenance`（行 12）；刷新路径返回 `refresh-failed-spectra-missing`。**全流程不崩** |
| EC-04 | 重建超时 | 有界 deadline + TERM→grace→KILL 进程组（复用 D8 canonical 模块的 `runBoundedProcess`，**不另写 spawn**）→ `refresh-failed-timeout` |
| EC-05 | **重建 exit 0 但产物不可用** | F239 已踩过（`/usr/bin/true` 复现，图根本不存在却被记为 `local-build`）。必须复用 `inspectBuiltGraph` 三条件（常规文件 + JSON 可解析 + 含非空 `graph.sourceCommit`）→ 失败则 `refresh-failed-artifact-unusable` |
| EC-06 | 重建 launcher 秒退、后台 worker 仍在写图 | 复用 F239 的「按剩余 deadline 轮询产物就绪 + 结束时 `killProcessGroup`」，不立刻判失败也不留孤儿进程 |
| EC-07 | **`dirty` 重建后仍是 `dirty`** | 工作树有未提交改动时，重建后 freshness 依然 `dirty`。因此 FR-003 的刷新后收口规则**不重跑矩阵**、FR-008 规定刷新后的消费前置是**产物可用性**而非 `freshness=fresh`，否则无限刷新。必须有一条集成测试在脏工作树上验证「进程内只刷一次」 |
| EC-08 | `unknown-provenance` 反复出现 | 不进刷新分支（FR-003 行 12 无 allowed 分叉），避免每次调用叠加一次超时预算。审计里必须能看出连续多次同因降级 |
| EC-09 | **纯新增任务却恰好有 caller**（分类判错） | 出口是 `skip-impact`，此时**不会**产生错误的 impact 结论——最坏后果是少一次影响面提示，不是给出误导性的「零影响」。但 `skip-impact` 的输出文案必须写明「本判定基于本轮 diff 全为新增文件；若你认为存在既有调用方，请手工用 `context` / Grep 复核」，**不得**表述为「本改动无影响面」。advisory 合同下该出口另受 FR-011 限制（不得当权威结论） |
| EC-10 | diff 含重命名 | 归为 `modifies-existing`（既有 symbol 位置变化会影响 caller），文件清单同时收录 old 与 new 路径。解析必须按 FR-005 的 **NUL 三段**契约（`R100\0old\0new\0`），**不得**按人读的 ` -> ` 形态切分；且注意 `--porcelain -z` 的新旧路径顺序与 `--name-status -z` 相反 |
| EC-11 | diff 全为 `specs/**` 文档改动 | 仍按 porcelain 状态码机械分类（文档文件被修改 → `modifies-existing`）；但 `coverageScope` 因扩展名不在图 walker 白名单而为 `out-of-graph-scope`，v2 下命中**矩阵行 2**（早于任何刷新分支）→ `consume-degraded` + `coverage-gap-out-of-graph-scope`，**且不会为此白白重建 4.4s**。结论与 v1 相同，行号由 12 变为 2 |
| EC-12 | 非 git 仓库 / git 命令不可用 | `changeClass=unknown`。若图可用则命中行 7 → `consume-degraded` + `classification-unknown`；若图缺失且允许刷新则先命中行 5 刷新，刷新成功后按收口规则仍落 `consume-degraded` + `classification-unknown` |
| EC-13 | 同一 phase 内并发两次决策 | 审计文件用单次 `appendFileSync` 写完整行保证行原子性。刷新的并发控制**只有两层**：进程内 single-flight（硬保证）+ 跨调用的**调用方合同**（第二次起传 `--refresh-policy declined`）。本 feature **不引入跨进程锁**（会引出 stale lock 清理这一整类新问题），也**不读审计文件反推「已刷过」**（写在决策后、非原子，且违反 RG-006）。**如实声明的残余**：若调用方违反合同，两个并发进程各刷一次仍会发生——代价是一次多余的 4.4s 重建，不产生错误结论 |
| EC-14 | 审计目录不可写 | 决策仍正常返回，退出码 0，stderr 输出 warning |
| EC-15 | `--dry-run` 下的隔离 | 绝不 spawn 构建、绝不写审计文件、绝不触碰图文件（F239 曾踩过 dry-run 打印"最终状态对象"其实与真实执行不等价的坑，本 feature 的 dry-run 只打印**操作计划**，不声称结果） |
| EC-29 | `--base-ref` 缺失（散文层调用未提供） | 退化为仅用 `git status --porcelain -z` 的工作树差异做分类，输出标 `baseRefMissing: true`。**不得**静默假装拿到了 phase 起点基线；advisory 合同下这属可接受降级，authoritative 合同下应在输出中明确警示 |

### KB 侧

| # | 场景 | 期望行为 |
|---|------|---------|
| EC-16 | KB 库不存在 | 状态子命令 `dbExists: false`、`freshness: "unknown"`、退出码 0；coverage-gap 与版本决议同样不崩 |
| EC-17 | 旧 schema 库（无 provenance 列） | `PRAGMA table_info` 探测后走兼容分支，相关字段 `null`、`schemaCompat: "legacy-missing-provenance"`、`freshness: "unknown"`（FR-020） |
| EC-18 | no-hit JSONL 单行损坏 | 跳过该行、`skippedLines` 计数、整体退出码 0（FR-015） |
| EC-19 | no-hit JSONL 并发写 | 单次追加写完整一行（含结尾换行，`O_APPEND`），行内容不含裸换行；不引入锁 |
| EC-20 | no-hit 目录不可写 / 磁盘满 | 静默 no-op，**KB 查询本身照常返回结果**（治理层绝不影响主链路） |
| EC-31 | **daily 文件名被非常规文件占位（FIFO / symlink / 设备）**（v4 增，落 B2-2） | 写入用 `O_APPEND｜O_CREAT｜O_WRONLY｜O_NOFOLLOW｜O_NONBLOCK` 打开并对 fd `fstat` 校验 `isFile()`，非常规文件**放弃本条记录**（静默降级，不抛）。`O_NONBLOCK` 不可省：无 reader 的 FIFO 会让打开操作永久阻塞在 KB 查询的同步返回路径上，外层 try/catch 对"永不返回"无效。清理侧用 `lstatSync` 且跳过非常规文件，不跟随链接判定 mtime |
| EC-32 | **`recordNoHit` 收到畸形入参**（v4 增，落 B2-8） | `tool` 不属三值 allowlist、`rawQuery`/`dbPath` 非 string（或 `dbPath` thunk 求值结果非 string）→ **直接 no-op，零 append**；保持 total 函数不抛。类型只在编译期生效，导出边界必须自己校验，否则等于开了一条绕过 redaction 落盘任意串的通道 |
| EC-33 | **`dbPath` 计算过程抛错**（v4 增，落 B2-9） | 挂点以 thunk 形式传入路径计算，由 `recordNoHit` 在其 try 内求值 → 抛错走静默降级；**禁止**在挂点处先求值（那会绕过保护边界、连采集关闭态都能把异常穿透到主链） |
| EC-34 | **no-hit 文件存在但整份读不出来**（v4 增，落 B2-3） | `readErrors` 计数 +1、继续聚合其余文件；若最终 `totalRecords === 0` 则 `status: "data-unreadable"`，**不得**报 `no-data` |
| EC-21 | **redaction + 切词后 term 列表为空** | 若切词结果为空数组或只剩占位标记 token，该条记录**不进入 backlog 聚合**（无治理价值），但仍计入总记录数以便区分 `no-data` 与 `no-gap-above-threshold` |
| EC-22 | 阈值下 backlog 为空 | 输出 `status: "no-gap-above-threshold"` + 空 `items`，**明确区别于** `collection-disabled` 与 `no-data`（FR-014） |
| EC-30 | **同一查询被重复执行多次** | 该 term 的 `occurrences` 增长但 `distinctQueries` 恒为 1，**不满足阈值、不进 backlog**（FR-015 锁死聚合键；这是 C5 指出的绕过形态的直接防线） |
| EC-23 | lockfile 缺失 | 回落到 `package.json` range → `resolved.status: "range-only"`、`version: null`；都没有则 `resolved.status: "none"` |
| EC-24 | 多个 lockfile 并存（无显式版本） | 各自解析出的版本全部进 `candidates[]`，`resolved = { status: "ambiguous", version: null }`，`flags` 含 `multiple-lockfiles`，**不擅自按优先级收敛为单值** |
| EC-25 | lockfile 与实际安装版本不一致 | 若可检测（读 `node_modules/<pkg>/package.json`），两者均进 `candidates[]` 并标 `lockfile-install-mismatch`；不可检测时不猜测 |
| EC-26 | 查询显式版本与推断版本冲突 | `resolved.status: "explicit"`，但推断值必须同时呈现，`flags` 含 `version-conflict`（FR-017） |
| EC-27 | 非 npm 生态 | `flags` 含 `ecosystem-unsupported`，`resolved.status: "none"`，**不猜测版本** |
| EC-28 | 巨大 lockfile（数十 MB） | 设置解析上限（复用 F239 `MAX_JSON_BYTES` 同类保护思路），超限返回明确失败而非 OOM |

---

## Acceptance Criteria

> 每条写明如何实测。所有命令均在 worktree 根目录执行。

- **SC-001（决策矩阵穷举 + 顺序不变量）**：`node --test plugins/spec-driver/tests/<决策核心测试>.mjs` 全绿，且该测试文件包含：(a) 一条穷举 144 种输入组合的用例，断言每种组合返回 FR-003 v2 表格规定的出口与 `matchedRule`，无 `undefined`、无 throw；(b) **missing 探针**（`missing` + 人为 `fresh` → `matchedRule ∈ {5,6}`）；(c) **out-of-scope 探针**（`out-of-graph-scope` + `stale` + `allowed` → `matchedRule = 2`、未触发刷新）；(d) 6 类 unreachable 组合的显式注释存在（grep 断言注释关键词）。

- **SC-002（B4① 改既有代码 → 真实 stale worktree 上非 dry-run 实测走刷新路径）**（v3 明确非 dry-run + 事件语义，落 P-C1 / P-W2）：在图**确为** `stale` 的**真实** worktree 上（freshness 由 `checkFreshness` 实算得出，不是桩造输入），改动一个 `src/**` 既有文件后**以非 dry-run** 运行 `decide`（authoritative 合同 + `--base-ref`），断言输出 `outcome: "refresh-then-consume"` 且刷新成功后终态为 `consume-impact`、`refreshAttempted: true`、`refreshOk: true`；审计新增**恰 1 条 `kind:"decision"` 事件**，含上述字段与非空 `graphSourceCommit`，刷新耗时记录在该事件的 `refreshDurationMs`（本仓参考值 ~4.4s）。**必须非 dry-run**——dry-run 既不刷新也不写事件，用它验刷新路径等于没验。

- **SC-003（B4② 纯新增 → 非 dry-run 实测不刷新 + 图 SHA-256 不变）**（v3 明确非 dry-run + 事件语义，落 P-C1 / P-W2）：在只新增文件的工作树上**以非 dry-run** 运行 `decide`，断言 `outcome: "skip-impact"`、`degradedReason: "impact-not-applicable-additive-only"`、`refreshAttempted: false`，审计新增**恰 1 条 `kind:"decision"` 事件**；且 `specs/_meta/graph.json` 的 **SHA-256 在命令前后完全不变**（证明 additive-only 路径确实未触发重建）。**该 SHA 断言必须在非 dry-run 下做**——dry-run 天然不写图，在其下断言无鉴别力。

- **SC-004（B4③ 覆盖缺口 → fresh 也降级 + 结构化 over-claim 约束）**：在 `freshness: fresh` 的图上，对改动集全为 `plugins/**/*.mjs` 的情形运行决策 CLI，断言 `outcome: "consume-degraded"`、`degradedReason: "coverage-gap-out-of-graph-scope"`、`matchedRule: 2`、`refreshAttempted: false`。
  **over-claim 防线改为结构化约束**（v2 弃用中文关键词黑名单，落 W4）：(a) 断言 CLI 的 JSON 输出**不含任何自由文本评价字段**——顶层键集合等于契约声明的封闭集合，`fallbackHint` 取值必须来自导出的固定模板表；(b) 断言人读 `--format text` 的 summary 行是 `degradedReason → 固定模板` 的纯映射——测试对 12 个 `DEGRADED_REASONS` 逐一渲染，断言输出逐字等于模板表对应项（模板表本身作为常量被测试引用，任何新增自由文案都会使该断言失败）。

- **SC-005（两组枚举分别可达，按事件语义断言）**（v2 拆分落 C6；v3 改事件语义落 P-C1）：
  (a) **degraded reason**：为 `DEGRADED_REASONS` 的 **12** 个值各构造一次非 dry-run `decide`（可用注入桩模拟 refresh 失败四态），断言审计中 **`kind:"decision"` 事件**的 `degradedReason` 覆盖全部 12 个值，且无枚举外的值；并断言这些 decision 事件的 `caveats` 恒为空数组；
  (b) **caveat**：单独跑一次 `decide`（得 `consume-impact`）+ 一次 `annotate-caveat`（`impactResult.directCallers: 0`），断言新增的 **`kind:"caveat-annotation"` 事件**的 `caveats` 含 `coverage-gap-known-extraction-limit`、其 `decisionId` 回链到对应 decision 事件；且该值**从未**出现在任何 `kind:"decision"` 事件的 `degradedReason` 字段。

- **SC-006（刷新失败四态映射）**：注入 fake `attemptLocalGraphBuild` 分别返回 `spawn-error(ENOENT)` / `timeout` / `non-zero-exit` / `graph-not-queryable`，断言 degraded reason 分别为 `refresh-failed-spectra-missing` / `refresh-failed-timeout` / `refresh-failed-nonzero-exit` / `refresh-failed-artifact-unusable`；另断言刷新前 `present` 与 `missing` 分别得到 `consume-degraded` 与 `unavailable`。

- **SC-007（刷新次数：进程内硬保证 + 调用方合同）**（v2 拆两段落 C3；v3 审计断言改事件语义落 P-C1）：
  (a) **进程内 spawn 计数**：在脏工作树上以 `--refresh-policy allowed` 跑**一次** `decide`，用 spawn 计数桩断言 `attemptLocalGraphBuild` 被调用次数**恰为 1**（覆盖「刷新成功后不重跑矩阵、不二次刷新」这一 EC-07 防线）；
  (b) **按调用方合同跑两次**：第一次传 `--refresh-policy allowed`、第二次按合同传 `--refresh-policy declined`（同 `--phase`、同 projectRoot），断言第二次 `refreshAttempted: false`、`outcome: "consume-degraded"` + `graph-dirty-uncommitted`，审计中共**恰 2 条 `kind:"decision"` 事件**，且第二次总耗时不含构建。
  **不断言**跨进程互斥（CLI 无状态、不加锁、不读审计——该 once-ness 由调用方合同承担，见 FR-008 与 EC-13 的残余声明）。

- **SC-008（goal_loop 零回归 + 接线正反两向生效）**：`node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` 与 `plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs` 全绿（含 `interpretImpactResult (FR-012)` 四条冻结断言）；新增测试给出**正反两向**断言：
  (a) **允许态确实注入**：出口为 `consume-impact`（或刷新成功的 `refresh-then-consume`）时，断言该轮 iteration log 条目含注入标记字段且 impact 内容进入 prompt 组装结果；
  (b) **拒绝态确实不注入**：出口为 `consume-degraded` / `skip-impact` / `unavailable` 时，断言 prompt 组装结果**不含** impact 内容，且 iteration log 条目含对应 `degradedReason`；
  (c) 缺该字段的旧形态输入不抛错。
  **如实标注的残余**：SKILL.md 散文层的调用行为无自动化断言先例，本 SC 只覆盖 goal_loop 路径与 CLI 输出这两个可自动化的证据面；散文层依从性属人工审查项。

- **SC-009（no-hit 落盘范围实证）**：构造含 email、`sk-` token、64 位 hex、`/Users/<name>/...`、10 位数字的查询各触发一次 no-hit，读取落盘 JSONL，断言：(a) 每条原文敏感片段在文件全文中**零出现**；(b) `redactionTags` 含对应类型标记；(c) 落盘对象键集合恰为 FR-013 列举的字段，**不含任何整串字段**（无 `redactedQuery`、无 `query`）；(d) 同一查询串执行两次，两行的 `normalizedQueryHash` 相同。

- **SC-010（coverage-gap 四状态可区分）**（v4 三态→四态，落 B2-3）：分别在「采集关闭」「采集开启但无记录」「有文件但全部读取失败」「有记录但无条目达阈值」四种条件下运行 coverage-gap 子命令，断言 `status` 分别为 `collection-disabled` / `no-data` / `data-unreadable` / `no-gap-above-threshold`，且四者 `items` 均为空但状态互不相同；断言不可读场景的 `readErrors ≥ 1`、关闭态 `readErrors === 0`，且 markdown/json 两种格式都打出该状态与计数；断言输出含 `minOccurrenceThreshold: 2` 且全文**不含**「k-匿名 / k-anonymity」字样。

- **SC-011（backlog 产出、绕过防线与损坏容忍）**：用 fixture（term X 出现在 3 行、分属 **2 个不同 `normalizedQueryHash`**；term Y 出现在 3 行但同属 **1 个 `normalizedQueryHash`**；1 条独有词；1 行损坏 JSON）运行 coverage-gap，断言：输出恰含 **1 个条目（term X）**、其 `distinctQueries: 2` 且 `occurrences: 3`；**term Y 不在 items 中**（同一查询重复三次不构成缺口信号——C5 绕过形态防线）；`skippedLines: 1`；退出码 0。

- **SC-012（版本推断命中 + 显式优先 + ambiguous）**：对三种 npm lockfile fixture 各断言解析出预期版本；对「显式 `4.0.0` + lockfile `3.2.1`」断言 `resolved.status = "explicit"`、`resolved.version = "4.0.0"`、`candidates` 含 `3.2.1`、`flags` 含 `version-conflict`；对「多 lockfile + 无显式版本」断言 `resolved.status = "ambiguous"`、`resolved.version === null`、`candidates.length ≥ 2`、`flags` 含 `multiple-lockfiles`；对 `go.sum` fixture 断言 `flags` 含 `ecosystem-unsupported`、`resolved.status = "none"`。

- **SC-013（KB freshness 公式与三元状态可查）**（v3 增旧库钉死用例，落 P-W4）：对 fixture 库构造三组 provenance——(i) `built_at` 5 天前；(ii) `built_at` 45 天前；(iii) `built_at` 100 天前——运行状态子命令断言 `freshness` 分别为 `current` / `aging` / `stale`；另构造 (iv) `built_at` 100 天前 + `ingested_at` 5 天前，断言 `freshness: "current"`（验证 `activityAt = max(...)`）且 `oldestBuiltAt` 反映 100 天前、未影响判级；对缺 provenance 列的旧 schema 库断言 `unknown` + `schemaCompat: "legacy-missing-provenance"` + 退出码 0；**另构造 (v) 缺 provenance 列但 `built_at` 为 5 天前的旧库，断言 `freshness` 恒为 `"unknown"`**（FR-020 v3 钉死：单列 `built_at` 再新也不足以判级，不得回落为 `current`）；断言运行前后库文件 SHA-256 不变（只读证明）。

- **SC-014（MCP 响应向后兼容）**：`npx vitest run tests/kb/` 全绿；断言 `kb_search` / `kb_api_lookup` 响应新增状态子对象，且既有字段（`results` / `total_found` / `not_found`）名称、类型、层级零变更。

- **SC-015（pilot 口径合规取数）**：`pilot/predicted-impact-set.md` 存在且其首次提交时间早于首个 implement 代码提交；`pilot/mcp-call-log.md` 与 `pilot/ledger.jsonl` 均存在且 ledger 行数 ≥ markdown 记录的调用条数；`pilot/measurement-design.md` 相对**其首次 commit 的具体 SHA**（该 SHA 在 pilot 文档首次 commit 后回填进本 SC 与 pilot 报告，形成锚定）**无 diff**——即 `git diff <锚定SHA> -- specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md` 输出为空。

- **SC-016（pilot 三指标有对照数据 + ledger 重算一致）**：pilot 报告含 M-1 四类计数与命中率、M-2 的 coverage/precision/missed-list 三个数（missed-list 逐条归因）、M-3 的 A/B 两组真 finding 数与「B 独有」「A 独有」两个差异数；**并且**运行 FR-022 的验证脚本，断言其从 `pilot/ledger.jsonl` 重算出的 M-1 四类计数与命中率与报告中的数字**逐项一致**，脚本退出码 0。

- **SC-017（pilot 报告诚实性：机器 + 人工两段）**（v2 拆分，落 W5）：
  (a) **机器可断言部分**：对报告文本 grep，断言含「N=1」「判读者非盲」「单次采样」「自我选择偏置」「结构性封顶」五项声明关键词；
  (b) **人工审查项**：「禁止外推表述」因黑名单不可穷举（同义改写空间无限），**不做机器断言**，改为 push 前的人工审查检查项，记录在交付 report 中。SC 文案在此如实登记该项无自动化。

- **SC-018（全局零失败）**：`npx vitest run`、`npm run build`、`npm run repo:check`、`npm run release:check` 四项全部零失败。

- **SC-019（安装态可达性：插件自包含 import 不断链）**（v2 新增，落 C1）：把 `plugins/spec-driver/` 整体拷贝到**仓外**临时目录（模拟第三方安装态，无仓根 `scripts/`），从该目录运行决策 CLI 的 `--dry-run --format json`，断言：进程退出码 0、输出可 `JSON.parse`、stderr 无 `ERR_MODULE_NOT_FOUND` / `Cannot find module`。该 SC 即是 D8 方案 A「canonical 在插件内」的可执行守卫。

- **SC-020（数据路径 gitignore 自举）**（v2 新增，落 C5-4）：
  (a) **本仓**：`git check-ignore -v .specify/kb-nohit/nohit-20260803.jsonl` 与 `git check-ignore -v .specify/graph-consumption-audit.jsonl` 均有命中（退出码 0）；
  (b) **安装态**：在临时目录 `git init` 一个全新 repo，拷入 `plugins/spec-driver/`，运行 `plugins/spec-driver/scripts/lib/ensure-gitignore.sh` 后，对上述两条路径再跑 `git check-ignore -v`，断言同样命中——证明第三方安装者不会因为清单遗漏而把 no-hit 数据与审计提交进自己的仓库。

---

## 回归护栏（逐条可验证）

- **RG-001（goal_loop 机制零回归）**：F201/F203/F204 建立的 goal-loop-core 纯函数与命令集完整性校验行为不变。
  *验证*：`node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` 全绿且**测试文件本身未被修改**（`git diff --stat` 对该文件为 0 行改动，新增断言写入新测试文件）。

- **RG-002（goal_loop 默认 off 不变）**：本 feature 不改变 goal_loop 的启用条件与默认值。
  *验证*：`git diff` 对 `orchestration.yaml` 与 goal_loop 开关相关配置为空；另跑一次不带 goal_loop 的默认 feature 流程 dry-run，断言未调用 goal_loop 路径。

- **RG-003（`decideStop` / `interpretImpactResult` 函数体零改动）**：
  *验证*：`git diff` 显示 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中这两个函数的行区间无改动（若该文件完全未改动则更强）。

- **RG-004（orchestration schema 零改动）**：
  *验证*：`git diff plugins/spec-driver/contracts/orchestration-schema.mjs plugins/spec-driver/config/orchestration.yaml` 为空。

- **RG-005（KB 现有链零回归）**：F190-F192 的检索、仲裁、ingest、隔离、降级行为不变。
  *验证*：`npx vitest run tests/kb/` 全绿（含 `kb-contract` / `kb-degradation` / `kb-isolation` / `arbitration` / `url-fetcher` / `office-parser`）；`kb-contract.test.ts` 中既有字段断言未被放宽。

- **RG-006（`checkFreshness` 是唯一权威计算源；审计只写不读）**（v2 措辞修订，落 W3）：本 feature 不新建第二份 freshness/provenance 状态文件，不缓存 freshness 判定。审计文件中的 freshness 是**观测快照**，显式**非权威**、不得被反向消费。
  *验证*：(a) 全仓 grep 新增文件，断言无新的 `*source-commit*` / `*freshness*.json` 类产物；(b) 断言新增代码中 freshness 获取路径唯一（全部经 D8 canonical 模块的 `checkFreshness`），无独立读 `graph.json` 的 `sourceCommit` 再自行比对 HEAD 的第二实现；(c) **新增依赖测试**：对所有新增的生产决策代码文件做静态检查，断言其中不存在对 `.specify/graph-consumption-audit.jsonl` 的读取（无 `readFile` / `createReadStream` / `readFileSync` 指向该路径，也无该路径常量被 import 进决策模块），即"审计不可作为决策输入"这一约束可机器验证。

- **RG-007（F217 图质量门全绿）**：
  *验证*：`spectra graph-quality --json` 的 `overallVerdict` 为 `pass` 或 `pass-with-warnings`（仅 freshness 告警），五项结构指标全 pass；`npm run repo:check` 中 graph-quality 族通过。

- **RG-008（不覆写图，SHA-256 比对）**（v2 强化，落 W4）：除 SC-002 明确验证刷新路径的用例外，本 feature 的任何命令（尤其 `--dry-run`、KB 侧全部命令、状态查询）都不得修改 `specs/_meta/graph.json`。
  *验证*：对上述命令逐一记录运行前后图文件的 **SHA-256 摘要**，断言完全一致（**不用** mtime + size——两者都可在内容变化时保持不变，是可被伪装的弱证据）。

- **RG-009（KB 主链路不被治理层影响，含退出码与 stderr）**（v2 强化，落 W4）：no-hit 记录、状态字段扩展的任何失败都不得改变查询结果、退出码或污染 stdout。
  *验证*：在 no-hit 目录只读、库缺 provenance 列两种故障注入下，断言：(a) `kb_search` 返回的 `results` 与故障注入前**逐字节相同**；(b) **进程退出码为 0**；(c) stdout 无治理层错误输出（错误只允许进 stderr，且必须是 warning 级、不含 stack trace 泄露路径）。

---

## Open Questions

> D1-D8 已拍板的不在此列。以下三条是真正需要用户/运行期决定的。**注意 v2 修订**：OQ-2 / OQ-3 涉及的参数已按 **proposed-default 实现**（spec 由此 decision-complete），OQ 只登记「用户可否决」这一后续动作，不阻塞 implement。

- **OQ-1（M-3 A/B 的配额降级口径）**：`measurement-design.md` 冻结的 M-3 要求对同一份 diff 并行启动两个同构 Codex 对抗审查子代理。若 implement 期 Codex 订阅配额紧张导致无法并行执行两组，应当：(a) 如实报「M-3 未执行」并说明原因，还是 (b) 顺延到配额恢复后补做（阻塞 F241 收口）？口径本身已冻结不可改，此处只决定**执行不了时怎么办**。

- **OQ-2（隐私参数取舍 — 已按默认实现）**：三个参数已定为 **proposed-default 并按此实现**：最小出现阈值 k = **2**、no-hit 记录保留 **30 天** [推断]、采集**默认关闭**；KB freshness 阈值同为 proposed-default（30 天 aging / 90 天 stale）[推断]。这些取舍（k 调高更安全但缺口信号更稀疏，保留期缩短更安全但跨周聚合窗口更小）将在 push gate 的交付 report 中列出供用户过目；**若用户否决，以后续 fix 流程调参**。实现要求：四个参数必须集中在**单一常量模块**导出（不得散落），使调参成本为改一处常量 + 改对应测试期望值。

- **OQ-3（E2 生态范围 — 已按默认实现）**：本轮已按 **npm-only** 实现，go / maven / gradle / uv / pipenv 一律返回 `ecosystem-unsupported`。若用户实际使用场景以非 npm 生态为主，本轮 E2 对其价值有限；该结论在 push gate 报告中列出，**用户可否决并以后续 feature 排范围**（不回改本轮已交付部分）。

> **另需 plan 阶段核实（非 open question，是可查事实但本轮调研未查）**：
> - `plugins/spec-driver/agents/tasks.md` 模板是否已有目标文件路径字段——决定 D3 的 `pre-implement advisory` 预判信号是否可得（若无，advisory 轮 1 退化为仅用 `--base-ref` diff）。
> - `scripts/lib/repo-maintenance-core.mjs` 的精确 family 总数，以及本 feature 是否需要新增 `validate*` family（参照 F217/F239 的 `namespaceCheck` 接入模式）。
>
> （原第一条「分发清单是否含 `graph-bootstrap-status.mjs`」已由 **D8 定案**消解：canonical 移入插件、仓根改薄 re-export，不再是待核实项。）

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 |
|------|-----|
| **组件总数** | **6**：(1) 图消费决策纯函数模块（含 `annotateImpactCaveat` 与两组枚举常量）；(2) 决策 CLI 子命令（I/O 层）；(3) KB no-hit 记录器 + redaction 模块；(4) coverage-gap 聚合器（最小出现阈值）；(5) lockfile 版本解析器 + 决议器；(6) KB 状态报告器 |
| **接口数量** | **约 9**：新增 CLI 子命令 4（图决策 / coverage-gap / 版本决议 / KB 状态）；新增导出纯函数 ≥ 3（决策、porcelain 分类、redaction；`annotateImpactCaveat` 与扩展名白名单常量随决策模块导出）；MCP 响应字段扩展 2 处（`kb_search` / `kb_api_lookup`） |
| **依赖新引入数** | **0**（Node 内置 + 仓内既有依赖；lockfile YAML 解析复用仓内既有 YAML 能力；切词复用 `src/scaffold-kb/tokenizer.ts`） |
| **跨模块耦合** | **是**——需触碰 ≥ 2 个现有模块的边界：`plugins/spec-driver/`（goal_loop 接线 + **接收 F239 canonical 模块迁入**）与 `src/kb-mcp/` + `src/scaffold-kb/` + `src/cli/commands/`（KB 三薄层）。**D8 已定案**：`graph-bootstrap-status.mjs` 的 canonical 实现移入 `plugins/spec-driver/scripts/lib/`，仓根改薄 re-export——因此**不存在**「插件跨目录 import 仓根」这一依赖，安装态可达性由 SC-019 守卫；代价是仓根薄壳与 `tests/unit/worktree-lifecycle-hook.test.ts:109` 的 copy 源路径需同步调整 |
| **复杂度信号** | **2 个**：① 并发控制（no-hit JSONL 与审计 JSONL 的并发追加写；已按"行原子性 + 不引入锁 + 跨调用交由调用方合同"约束降级处理）；② 数据迁移/兼容（KB 旧 schema 库的 `PRAGMA` 探测-兼容路径；以及 D8 的模块迁移 + re-export 兼容）。**无**递归结构、**无**状态机 |
| **总体复杂度** | **HIGH**（组件 6 > 5，且存在 2 个复杂度信号） |

**交付批次约束（v2 新增落 I1；v3 pilot 改三段落 P-C2）**：**不拆分为多个 feature**——B4 + E + pilot 合一线是用户明示的需求形态，拆 feature 会割裂 M9 收口的组织归属与 pilot 载体。但 implement **必须按四批次序推进，每批独立跑完门禁（`npx vitest run` / `node --test` / `npm run build` / `npm run repo:check` 对应子集零失败）后再进下一批**：

1. **批 1 — B4**（组件 1-2 + D8 模块迁移 + goal_loop 接线）：FR-001~FR-011、FR-024 的审计路径部分；
2. **批 2 — E1**（组件 3-4）：FR-012~FR-015、FR-024 的 no-hit 路径部分；
3. **批 3 — E2/E3**（组件 5-6）：FR-016~FR-021；
4. **批 4 — pilot finalize**：FR-022~FR-023 的收口部分（实际集比对、M-3、报告撰写、ledger 重算校验）。

**pilot 不是只发生在批 4（v3 更正）**：按 FR-022 的三段执行，**preflight** 在批 1 开始之前完成（预测集存在性 + ledger schema 校验），**continuous capture** 横跨批 1-3 持续记账（每次 MCP 调用当下双写），批 4 只做 **finalize**。因此 `pilot/predicted-impact-set.md` 与 `pilot/ledger.jsonl` 在 plan / tasks 中**不得**被标为「批 4 新增制品」——它们分别已冻结、已在持续写入。

该约束将在 tasks.md 中体现为四个任务分组，组间为硬依赖边（前一组门禁未过不得启动下一组）。

**给 GATE_DESIGN 的建议**：本 feature 达 HIGH，建议人工审查，重点看两件事——

1. **四批次序是否足以替代拆分交付**。B4（组件 1-2）与 E（组件 3-6）之间**无功能耦合**，只共享「M9 收口」这一组织归属。若审查认为分批门禁仍不足以控制一次交付面，可在 plan 阶段进一步把批 3 拆为 E2 / E3 两批。
2. **FR-018 的去留**。它是本 spec 中唯一标 `[可选]` 的 FR，且是唯一会触碰 F190-F192 检索排序语义的条目。若 plan 阶段确认无法在不改检索语义的前提下接入，应直接移除而非勉强实现——E2 的验收（「版本自动识别」）由 FR-016/FR-017 独立满足。

**YAGNI 检验结论**：本 spec 无 `[YAGNI-移除]` 条目——原本可能膨胀的四处（增量建图引擎、独立 MCP tool、自动重建调度器、跨进程刷新锁/审计回读状态机）已在范围决策 D1 / D4、非目标第 7 与第 12 条阶段被前置剔除，未进入 FR。
