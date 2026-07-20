---
title: Milestone M9 — Codex 一等支持 + 可信活图 + Spec Drift 发布
status: planning
created: 2026-07-19
parent_milestone: milestone-M8-trust-repair-and-drift-flagship.md (closing；F188 完成后进入 M9 实施)
planning_horizon: M9 与 M10 共用一份连续路线图，但保持两个交付门禁
sources:
  - milestone-M8-trust-repair-and-drift-flagship.md §5 (M8 defer 与 M9 候选池)
  - specs/189-ast-anchored-spec-drift-detection/decision/route-selection.md (M9-A~E)
  - specs/193-worktree-graph-bootstrap-freshness/ (worktree 图可移植与 bootstrap)
  - docs/design/domain-knowledge-scaffold-solution.md (KB Phase 2/3 边界)
  - https://learn.chatgpt.com/docs/build-plugins (Codex plugin manifest)
  - https://learn.chatgpt.com/docs/environments/git-worktrees (Codex-managed worktree)
  - https://learn.chatgpt.com/docs/agent-configuration/agents-md (AGENTS.override.md)
  - https://learn.chatgpt.com/docs/hooks (Codex hooks)
decisions:
  - "M9 先修产品底座：Codex 一等分发、worktree/local 开箱、图拓扑与新鲜度；底座不过门不得先做 Wiki/GraphRAG"
  - "M9 旗舰 = 把 F189 prototype 推到可用的 drift link/check + repo warning + normalized symbol AST hash"
  - "M9/M10 可合并为一份 program roadmap，不合并为一个交付 milestone；M10 保留体验扩张与高阶语义能力"
  - "不预占 Feature 编号；每条轨道进入实施时由 Spec Driver 独立立项，避免并行编号漂移"
---

# Milestone M9 — Codex 一等支持 + 可信活图 + Spec Drift 发布

## 0. 一句话定位

M9 不继续横向堆功能，而是把 Spectra + Spec Driver 在 Codex 中变成**可安装、可运行、可验证**的一等产品，并把代码图从“能生成”升级为“拓扑正确、状态可见、随 worktree 保活”的可信底座；在此基础上完成 Spec Drift 首次生产发布。

M8 的 F188 仍是进入 M9 实施的前置门禁。M9 可以先完成 spec/plan，但不得借“新 milestone”跳过 M8 收官。

---

## 1. 为什么 M9 必须先做底座

2026-07-19 的仓库级 Codex 适配与 graph-only dogfood 暴露四个结构性缺口：

1. **Codex 分发不完整**：现有 `.claude-plugin` 与 `.codex/skills` 能提供部分入口，但缺 `.codex-plugin/plugin.json`，`spectra init --target codex` 只装 skill，不保证 MCP / hook 同步可用。
2. **Spec Driver wrapper 覆盖不全**：canonical skills 含 `spec-driver-refactor`，Codex wrapper contract 与安装脚本未覆盖它；当前 repo check 因合同自身漏项而无法发现。
3. **worktree 支持未闭环到 Codex**：F193 的图可移植和 bootstrap 已落地，但现有 lifecycle 依赖 `WorktreeCreate/WorktreeRemove`；Codex-managed worktree 需要 `.worktreeinclude`、`AGENTS.override.md` 与显式 setup 路径。
4. **graph-only 拓扑仍不足**：本仓 dogfood 新图为 5,723 nodes / 2,784 edges，其中 4,173 个节点孤立（72.9%），并有 16 对 Python symbol 使用 `#` / `::` 双 ID。`buildUnifiedGraph` 产生 symbol 节点却没有普遍的 module→symbol `contains` 边，社区检测和未来 GraphRAG 排序不能直接建立在这个状态上。

因此，Wiki、GraphRAG、深层自治虽然有产品价值，但在 M9 底座门禁前实施会放大错误索引与分发不一致。

---

## 2. 范围总览

| 轨道 | 优先级 | M9 交付 | M10 边界 |
|---|---:|---|---|
| A. Codex First-Class | P0 | plugin manifest、MCP/skill/hook 一体分发、运行时适配 | 更多平台/市场体验优化 |
| B. Trusted Live Graph | P0 | contains、ID 单一化、freshness/doctor、worktree 保活 | GraphRAG、symbol semantic retrieval |
| C. Spec Drift Ship | P0 | link/check、repo warning、normalized symbol AST hash | rename-follow、全仓自动映射 |
| D. Architecture | P1 | `runBatch` 分段、scanner/walker 与 graph conversion contract | 大规模 pipeline 重构 |
| E. KB + Grounding | P1 | no-hit coverage gap、版本自动识别、freshness 输出、一个 grounding pilot | 分级刷新调度、embedding rerank、深层门禁 |

M9 只承诺 P0 全部和经容量确认的 P1；M10 候选不得反向挤占 P0 门禁。

---

## 3. 轨道 A — Codex First-Class

### A1. 原生 plugin 分发

- 为 Spectra 和 Spec Driver 增加 `.codex-plugin/plugin.json` canonical manifest。
- Spectra plugin 一次安装同时暴露 skills、`.mcp.json`、必要 hooks；不再要求用户分别执行 skill 安装和 MCP 手工注册。
- Spec Driver plugin 一次安装暴露全部 canonical skills、hooks 和运行时资源。
- release/repo check 增加 Codex manifest、MCP 配置、skill 数量与 canonical source 一致性矩阵。

### A2. Spec Driver Codex wrapper 完整性

- 补齐 `spec-driver-refactor` wrapper、安装脚本与 source-of-truth contract。
- 把“缺 Task tool 则内联/串行”的静态兼容文案升级为运行时 capability adapter；Codex 支持子代理时走原生调度，确实不可用时才降级并显式记录。
- 模型配置改成 runtime-neutral quality tier；未显式 pin 时允许 Codex CLI 选择当前默认模型，不把具体模型版本散落在 README、模板和 skill body。

### A3. Codex hooks 合同

- 只使用 Codex 当前支持的 hook event；`WorktreeCreate/WorktreeRemove` 保留为 Claude adapter，不作为 Codex setup 前提。
- 为 `apply_patch` / Edit / Write 建真实 payload E2E，确认 Pre/Post hook 能拿到目标路径并执行/阻断。
- Stop compliance 不以 transcript 的非稳定 wire format 作为唯一事实源；优先读取 `.specify/runs/` 的显式状态。
- 支持 `PLUGIN_ROOT`，同时保留 `CLAUDE_PLUGIN_ROOT` 兼容路径。

### A4. Codex runtime 位置与版本

- 所有全局 Codex 路径尊重 `CODEX_HOME`，仅在未设置时 fallback `~/.codex`。
- auth detector、skill installer、plugin install、worktree cache 使用同一 helper。
- 增加“仓库版本 / 全局 CLI / plugin build / MCP server”一致性诊断，不允许旧 server 静默服务新 worktree。

### A 轨验收

- 新环境一次 plugin 安装后，Codex 能发现 Spectra MCP、全部 Spec Driver skills（含 refactor）和受信 hooks。
- `codex mcp list` / plugin inventory 可机械确认 Spectra 已启用。
- Codex hook E2E 覆盖 allow / block / failure-degrade / Stop 四路径。
- 自定义 `CODEX_HOME` fixture 全绿，active defaults 不再硬编码已过时模型版本。

---

## 4. 轨道 B — Trusted Live Graph

### B1. 拓扑与身份正确性

- `buildUnifiedGraph` 为每个受支持 symbol 生成 module→symbol `contains` 边；class member 层级保持可追溯。
- Python `file.py#symbol` 与 UnifiedGraph `file.py::symbol` 收敛为单一 canonical ID；转换只允许发生在一个兼容边界。
- 明确 `src/graph`、`src/knowledge-graph`、`src/panoramic/graph` 的职责：canonical model、derived view、persisted/query representation 分离，转换合同有 schema 与 round-trip 测试。
- graph-only 与 full batch 对共同 AST 数据的节点/边口径做等价矩阵，差异必须是显式数据源差异。

### B2. 图质量门

新增 `graph quality/status/doctor` 级别的机器可查信号：

- duplicate canonical ID = 0；
- supported symbol 的 `contains` coverage = 100%；
- source symbol orphan ratio ≤ 5%，例外必须分类并计数；
- dangling edge = 0；
- ignored path / `_reference` 节点 = 0；
- graph source commit 与 HEAD 一致，或明确返回 stale，不允许静默使用旧图；
- TypeScript/JavaScript、Python、Java、Go fixture 都进入回归矩阵。

> **现实基线（2026-07-20 graph-only 4.3.0 实测，5723 节点/2784 边）**：孤立节点率 **72.9%**（symbol 级 4036/4881 = 82.7%）——主因即 B1 缺 module→symbol contains 边。B1 落地后此数应大幅收敛；B2 门禁上线以本基线为回归对照，验收 ≤5%。
> **B1 后实测（2026-07-21，F214 dist 重建本仓图）**：边 2784→**7689**（+4880 contains）；孤立率 **1.9%** ✅（symbol 级 **0.0%**，contains 覆盖 100%）；`#` ID 节点 **0** ✅；耗时 3.2s 无劣化——**B2 三项核心指标已被 B1 打到达标位，B2 剩余工作 = 把指标机器门禁化（quality/status/doctor + duplicate/dangling/ignored/freshness）+ 四语言 fixture 回归矩阵**，非修数据。

### B3. Worktree 与 Local 状态

- 新增仓库级 `.worktreeinclude`，仅复制适合复制的 ignored local file；secret 使用 copy，不使用跨 worktree symlink。
- 本地私有指令采用 ignored `AGENTS.override.md`；不新增 Codex 不识别的 `AGENTS.local.md`。
- Codex-managed worktree setup 优先运行快速 graph-only / incremental bootstrap；不得复制来源 commit 不明的陈旧 graph 后静默宣称 ready。
- `scripts/sync-worktree-local-state.sh` 保留给手工 Git/Claude worktree，并与 Codex setup 共用同一 target contract，避免两套清单漂移。
- `AGENTS.md` 保持在 Codex project instruction byte budget 内；任务专用流程继续下沉到 skill/reference。

### B4. 条件保活

- 改既有代码、需要 impact/context 的任务：进入 implement/verify 前按变更集合增量刷新图。
- 纯新增且无 caller 的任务：不无条件刷新并假装 impact 有价值，改用 module/context 或明确降级。
- goal_loop 只能在 graph freshness 通过后消费 impact；stale 时必须记录 degraded reason。

### B 轨验收

- 新 Codex-managed worktree 在一分钟内得到可查询的当前 graph 或明确的构建状态。
- 同 commit 跨 worktree graph/snapshot 可移植；HEAD 变化后查询能看到 freshness 状态。
- graph-only dogfood 不再出现 `#` / `::` 成对重复，孤立率达到质量门。
- `impact`、`context`、`graph_path`、`graph_node` 对 canonical ID 与相对路径行为一致。

---

## 5. 轨道 C — Spec Drift 首次生产发布

沿用 F189 的点锚路线，但把范围压到可发布闭环：

1. **C1 — `drift link` / `drift check`**：确定 lock schema、建锚 UX、刷新与删除语义，prototype 迁入生产脚本/CLI。
2. **C2 — `repo:check` 集成**：stale/orphaned 默认进入 warning；lock 损坏或显式 strict 才 hard fail。
3. **C3 — normalized symbol AST hash**：按 symbol AST 子树计算指纹，忽略格式与无关位置变化；注释/JSDoc 是否计入必须形成单一明确合同和 fixture。

M9 不做 rename-follow 与全仓推断。重命名在 M9 诚实标为 orphaned；M10 再加入 fuzzy + git rename provenance。

### C 轨验收

- 一条真实 spec→symbol 锚在格式化后保持 fresh，在语义变更后变 stale。
- 同文件其他 symbol 变化不误伤当前锚。
- orphaned、lock corrupt、unsupported language、parser degrade 均有稳定状态码和 next step。
- `repo:check` warning 语义不阻断普通开发，strict 模式可用于 CI hard gate。

---

## 6. 轨道 D — 架构收口

`src/batch/batch-orchestrator.ts` 已达 2,561 行，`runBatch` 约 1,496 行，并在新图中是全仓最高度节点。M9 在继续扩展索引前完成有边界的拆分：

- source discovery / language collection；
- graph assembly；
- generation scheduling；
- checkpoint / incremental state；
- artifact writing / reporting。

优先复用 `ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`，不创建平行 registry。walker/scanner 统一以 gitignore 与语言生态 ignore 的既有 shared helper 为准。

> **图自析补充（2026-07-20 god-nodes 实测）**：#2 耦合枢纽是 `src/panoramic/batch-project-docs.ts`（degree 28 / 155 callSites），不在原 scope——列为 D 轨第二拆解对象（或显式 defer 并说明理由）；watch-list：`single-spec-orchestrator.ts`（372 callSites）、`docs-quality-evaluator.ts`（313）、`component-view-builder.ts`（269）。KB 新码 `kb-api-lookup.ts` 已进枢纽榜（degree 10），E 轨硬化时留意增长。

验收以行为不漂移为核心：full/incremental/graph-only 输出合同、byte-stable 与 checkpoint 恢复全绿；拆分后的 stage 能独立测试，不以“文件变短”作为成功标准。

---

## 7. 轨道 E — KB 硬化与 Grounding Pilot

F190-F192 已实现 doc-graph、FTS5、API 实体、异构 ingest、双库联查和仲裁。M9 不重复实现 Phase 2，先补治理状态，再增加三个薄层能力：

1. **coverage-gap**：聚合 `kb_search` / `kb_api_lookup` no-hit telemetry，输出文档缺口 backlog；内容和查询先脱敏、再聚合。
2. **version selection**：从项目 lockfile / manifest 推断依赖版本，查询显式版本仍有最高优先级；无法确定时保持双呈现。
3. **freshness status**：暴露 build/ingest age、source version 与 no-hit，先做状态可见，不在 M9 引入复杂调度器。

图质量门通过后，选择一个有界 feature 做 Spectra→Spec Driver context-grounding + tests-as-spec pilot。验收看 grounding 是否命中、是否改善 impact coverage 和 review 发现率，不只看“hook 被调用”。

---

## 8. 执行顺序与 Gate

```
Gate 0: M8 F188 收官 + master 全绿 —— ✅ 已满足（2026-07-20 F212 收官，SC-002/004 闭合）
  （2026-07-20 用户拍板：A/B 两线开发与收官评测并行启动——worktree 隔离 + 三护栏；
   C/D/E 仍按下方顺序在 A/B P0 门禁后接力）
  （2026-07-21 进度：**A1✅ F213** ship——.codex-plugin 双 manifest + 一次安装真 codex
   CLI E2E 实证〔`mcp list` 见 spectra〕+ 一致性矩阵 4 check 入 repo:check + 漂移拦截
   100% 实证；SC-002 按 waiver 8/9 skill〔refactor wrapper 缺口 = A2 设计内，合同显式
   登记〕；SC-004 曾 PARTIAL〔仓外共享 baseline 被 B1 ID 改格式波及〕→ **计划外衍生
   F215✅**〔E2E 图输入解耦：in-repo pinned fixture + skip 语义拆分，结构性消除跨
   worktree 测试耦合〕后完全闭合。**B1✅ F214** ship——contains 边 + canonical ID 收敛
   + 三层合同 + graph-semantic-diff 工具；本仓 F214 dist 实测：孤立率 **72.9%→1.9%**、
   symbol contains 覆盖 **100%**、`#` 节点 **0**、耗时 3.2s 无劣化（见 §4 B2 实测注）；
   5145 测绿。W1 ".agents 原子过渡+双写" 经查为 A1 一体分发必要管线非越界，其 Codex
   审查另抓 1 CRITICAL〔遗留软链沿父链可删主仓 skills，已 fail-loud 修复〕。
   **判定：A/B P0 门禁通过 → C/D 解锁**〔A2-A4/B2-B4 继续按轨〕；
   下一批派发：**F216 V008 双向对账 ∥ F217 B2 质量门机器化**〔写入路径 disjoint：
   plugins/spec-driver fix 链 vs src/panoramic/graph+checks；C 排 F217 后——C2 与 B2
   同碰 repo:check 集成面；D 待下批〕）

**Gate 0 吸收点（2026-07-20 F212 终报落账，用户指示"未超 GStack，按结果调整规划"）**：

1. 🔴 **新增 M9 产品卡：fix 模式方向误读修复（V008 病根，对 GStack 剩余差距的全部结构性部分）**
   - 病理（F212 取证）：fix 流程的"先核实是否已修"步骤把 base 态误读为"已历史修复"→ 产出**穿 F208 合规外衣的自信 no-op**（流程制品齐全、结构化出口、fix-report 引行号断言"已修正"）；两 run MCP×0 未进代码分析；**裸 opus 无此步骤反而 V008 3/3**——流程步骤本身制造了这类失败
   - 已证伪路线：prompt 级对账合同（F206-R3 三版全被绕过）；F208 依从层（坍塌 0/29 但 V008 纹丝不动）
   - 候选机制（spec 阶段选型，均为结构化门非 prompt）：(a) 终报 §9-1 "issue 期望行为 vs 工作树现状"双向对账合同；(b) **red-repro-first**——修复前必须先写复现症状的红测试，红测试失败即证伪"已修复"（= M10 TDD 引擎化卡的 fix 模式切片**前移**，两机制或可合一：红测试就是最强的双向对账）
   - 排期：可与 A/B 轨并行（碰 plugins/spec-driver fix skill/agents；注意与 A2 wrapper 再生成的先后顺序）
2. **lift 负向信号（不显著但方向明确）强化两张既有卡的优先级论据**：强 driver（opus-4-8）上流程呈净开销方向 + 平均触发率 2.2× 达标但 V008 关键 run MCP×0——"自适应流程裁剪"（M8-deferred）与"任务级流程深度路由"的价值随 driver 变强而上升；§9-5 driver×流程交互研究列 M10 eval 候选（同链 c1/c3 对照才可下结论）
3. **评测 infra 三小件 + plugin 守卫内建 + upstream 上报**（终报 §9-2/3/4）→ backlog 小卡，不占 M9 轨道
4. 触发率工程（F184 路线）经预注册机判验证 → A 轨 instructions/description 方法论可信，继续沿用
  ├─ Track A Codex First-Class
  └─ Track B Trusted Live Graph
             ↓ A/B P0 门禁同时通过
       Track C Spec Drift Ship
       Track D runBatch/graph contract 收口
             ↓ 图质量门通过
       Track E KB + grounding pilot
             ↓
       M9 全期 Codex + Claude 双运行时 E2E / 架构审查 / 文档收口
```

并行原则：A（plugin/runtime）与 B（graph）可并行；C 依赖 B 的 symbol/指纹合同；E 的 grounding pilot 依赖 A+B；D 拆分与 B 重叠文件时串行，禁止双线同时改 `batch-orchestrator.ts`。

---

## 9. M9 Success Criteria

| SC | 描述 |
|---|---|
| M9-SC-001 | Codex 一次安装获得 Spectra MCP + 完整 Spec Driver skills + 可用 hooks |
| M9-SC-002 | 自定义 `CODEX_HOME`、Codex-managed worktree、手工 Git worktree 三路径 E2E 全绿 |
| M9-SC-003 | graph duplicate ID=0、contains coverage=100%、source symbol orphan≤5%、ignored path=0 |
| M9-SC-004 | graph freshness 可见；新 worktree 一分钟内 ready 或返回明确构建状态 |
| M9-SC-005 | Spec Drift link/check + repo warning + normalized symbol hash 生产闭环通过 |
| M9-SC-006 | `runBatch` 分段后 full/incremental/graph-only/checkpoint 合同零漂移 |
| M9-SC-007 | KB no-hit backlog、版本自动识别、freshness 状态完成；一个 grounding pilot 有可执行报告 |
| M9-SC-008 | Claude + Codex 双运行时全量测试、build、repo:check、release:check 零失败 |

---

## 10. M10 边界 — 体验扩张，不与 M9 合并交付

M10 与 M9 共用这份 program roadmap，但只有 M9 质量门通过后才进入实施：

- 可浏览 Wiki：overview→module→symbol、行级源码引用、页面 freshness、可审阅 overlay；
- GraphRAG + symbol-level semantic retrieval，共用单一 retrieval kernel，不新建第四套 embedding/rerank 栈；
- KB 分级刷新调度与条件触发的 embedding rerank；
- Spec Drift rename-follow、全仓自动映射与 gap/uncovered 分类；
- **brainstorm 轻量入口 + 入口可发现性改造**（2026-07-20 细化，源于 SuperPowers 对照审计）：
  - 痛点实证：现 9 个 skill 入口全为流程名词（feature/story/fix/…），description 是引擎语言（"基于 orchestration.yaml 动态编排"），用户须先学模式分类学才能进门；**brainstorm 能力零入口**——想探讨模糊想法只能 (a) 直接进 feature 流程被迫"立项"（占编号/建分支/建目录），或 (b) 裸聊无方法论且结论不沉淀；clarify/research/GATE_DESIGN 零件俱在但全埋在已立项之后
  - 形态：`/spec-driver:brainstorm <模糊想法>`——**零立项成本**（不占编号/不建分支/不建目录）；方法论 = 苏格拉底澄清 → 多方案发散（2-3 案 + trade-off）→ 收敛 → YAGNI 裁剪（参照 superpowers:brainstorming 实测方法论；但纪律不靠 prompt 级 MUST——F206 实证会坍塌——探索期轻、纪律留给转正后的流程门禁）
  - 差异化（SuperPowers 做不到的两件）：① Spectra graph 上下文注入——"这个想法会碰哪些既有模块/影响面"实时 ground；② 产出 `brainstorm.md` 制品 → 用户拍板后**一键转 `/spec-driver-feature`**，衔接既有自适应入口检测（检测到制品自动跳过对应阶段），探索结论直通研发流水线
  - 同卡：9 入口 description 全部从引擎语言改写为**意图语言**（"想做新功能但需求还模糊？先跑这个"）——F184 MCP 触发率工程的同款 adoption 逻辑应用到命令层；可选 intent 别名/router 二期
  - 立项依据：SuperPowers 火的解剖（方法论可读性 + 分钟级 time-to-value + 意图命名）vs 我们实测优势（81.8% vs 66.7%）——终局产品要"让人想用"与"用了真有效"兼得，此卡补前者；
- goal_loop 扩展到更多有界任务及 fallback/rollback 对抗验证。
- **implement/review 引擎硬化**（2026-07-20 SuperPowers 6.1.1 深读对照，机制级证据）：
  - **TDD 红先行引擎化**（P0，最高性价比）：现 implement agent TDD 指令 = 零（grep 实证），红绿纪律只散在仓库约定与个别 feature 自律。落法：implement.md 写入红绿重构流程 + tasks 模板默认"红测试→实现"配对（bite-sized：写红/跑红/最小实现/跑绿/commit）+ 完成声明加红证据字段 + verify Layer 1.5 查红证据。**协同乘法：goal_loop 的 metric 本就是红测试，TDD 普及后每任务天然 goal_loop-able**。不抄 prompt 级"删代码"威胁（F206 证伪路线），证据进 judge 查验
  - **任务级上下文精确构造**："为子代理构造恰好需要的上下文、永不全文 handoff"（SP implementer/reviewer 合同核心原则）——作为 M8-deferred「自适应流程裁剪」卡的设计方向，同解 4-12× token 与上下文污染
  - **diff-file 审查纪律**（SP task-reviewer 合同）：审查者只读预制 diff 文件（含 commit 清单+stat+全 diff）、禁爬库、named-risk 才许一次聚焦检查——直接可用于 spec-review/quality-review agent 的 token 纪律
  - **task right-sizing 定义**进 tasks 模板："任务 = 携带自己测试周期的最小单元 + 值得新鲜审查者把一次门"；**任务级两段审查（spec 合规+质量）作为 opt-in 档位**（风险分级触发/强化 GATE_IMPLEMENT_MID，不作默认——token 经济）
  - **systematic-debugging 四阶段**（根因先于修复的 Iron Law）作为 implement 中途遇挫的方法论段——fix mode 已有 5-Why，但 implement 阶段测试失败时无 debugging 纪律、goal_loop decide-stop 只管止损不管方法
  - 不学清单（有数据）：prompt 级强制（F206：20-30% 坍塌；其 c4=66.7% 垫底）/ 第二套制品树 / 进门即拦截；

**前移规则**：若某个 M10 候选实际是在修复 Codex 分发、worktree、图正确性或 Spec Drift 基础闭环，它不是“体验增强”，必须前移 M9；除此之外不合并。

---

## 11. 非目标与纪律

- M9 不以增加 MCP 工具数量为目标，优先让既有工具可安装、可发现、可相信。
- 不为 GraphRAG/Wiki 复制新的 graph、embedding provider 或索引模型。
- 不因 Codex 适配削弱 Claude Code 行为；通过 adapter 和双运行时 E2E 保持同一 canonical source。
- 不把机器路径、凭据、客户信息或本地 telemetry 原文写入仓库产物。
- 每个实施 feature 收尾继续记录 Spectra / Spec Driver dogfood 四维反馈，真实问题分流，不顺手扩大当前 scope。
