---
title: Milestone M11 — 诚实工具面、引擎还债与评测前置
status: active（2026-09-14 用户逐条拍板 §8 五点 + 三项追加决策，见 decisions）
created: 2026-09-14
parent_milestone: milestone-M10-ship-honest-graph-evidence-gate.md（2026-09-14 代码面收官；§13 收官账 + M11 种子）
stepback_revision_of: milestone-M10-ship-honest-graph-evidence-gate.md §13.3「M11 候选清单（种子）」（本文件把种子立成可派发的批次，取代该节的排期；候选池保留）
planning_horizon: 单里程碑；Wiki / KB 消费面仍不进（md/yaml 入图仅作 P1-J 的可选延伸）
sources:
  - milestone-M10 §12（三路架构审查 1C+29W，2026-09-12）与 §12.4 债务结账表 / §13 收官账
  - docs/design/dogfooding-feedback-ledger.md（2026-09-14 两轮 milestone-next 流转 45 条 → 簇①–⑦；同日 sync 补聚合 5 条 + 引擎三轮对抗 7 条 + publish-gap 第二角 7 条）
  - docs/design/f291-per-target-budget-and-reentry-corroboration.md（F291a 设计稿 + 实测爆炸半径；F291b 裁决暂不实施）
  - 2026-09-14 全项目未做/未验证盘点（本文 §6 逐条承接）
  - specs/277-spec-driver-engine-hardening/verification-report.md（后续卡候选 6 项）、specs/276-*/handoff/
decisions:
  - "2026-09-14 用户拍板：第一批四卡并行（各开 worktree，先 ship 先 push）"
  - "2026-09-14 用户拍板：P1-I 走 feature 全流程（调研 + 外部语料 A/B）"
  - "2026-09-14 用户拍板：typecheck:tests:full 燃尽目标 ≤ 100（M11 内基本清零），高于主线程推荐的 ≤ 300"
  - "2026-09-14 用户拍板：交界调研只跑聚焦增量版（工具面诚实化的外部范式），挂在 P1-I 立卡前"
  - "2026-09-14 用户拍板：P1-H 评测前置（含 F170c/F170d SC 复测）在第一批四卡 ship 后再跑，避免与对抗审查子代理争 Claude Max 配额"
  - "2026-09-14 用户拍板：perf 归因两项改进（collector 拆 cache 字段按单价估成本；cli-proxy spec 调用禁工具 / MCP + --max-turns 1）并入第一批，开一张 small fix 卡"
  - "2026-09-14 用户拍板：本机卫生由主线程直接清理，保留三个基线目标与 F150 的 HikariCP / GORM / hono"
---

# Milestone M11 — 诚实工具面、引擎还债与评测前置

> **状态：草案，待用户拍板**。M10 已代码面收官（4.6.0 已发布并完成本机验收）。本文把 M10 §13.3 的种子按写入路径与前置依赖排成三批，并把 2026-09-14 盘点出的"未做 / 未验证"逐条承接为可关闭的项。**任何一批派发前，先跑一轮 milestone-next 体检刚合入的 Feature**。

## 1. 主题与边界

三条主线，对应 M10 三条主题的欠账与副产物：

1. **诚实工具面**（承 M10「诚实的图」唯一欠账）：图边解析 stage / 策略标签进 MCP 返回面；confidence 双词汇收敛；`tokenBudget`；top-N 与 `tools/list` 确定性回归；callers / callees 带调用点与语境（F277 账本 #22）。
2. **引擎还债**（承 §12.4 与账本簇①④⑤⑥⑦）：spec-driver 引擎 / CLI 小补合集、对抗审查与 implement 纪律固化、模板与验收判据、repo 引擎（sync 局部再生 / check 断言集下界）、图新鲜度自动化、sync 的 fix-report 消费通道（FR 按 spec 分桶已于 09-14 落地）；架构债按 §12 证据复核后逐项立卡。
3. **评测前置**（P1-H）：33-run 坏题审计 + 重钉 GStack 锚；在此之前**禁止**任何「c3 更有效」的对外表述（F237 84.8% < GStack 90.9%）。F170c SC-004 / F170d SC-004（chained call rate，从未在 CI 跑过）并入本轨道一次性测清。

**不进 M11**：可浏览 Wiki / KB 消费面（仍移交后续）；F291b（裁决暂不实施，重开条件见设计稿）；F288 R-6（保持登记）。

## 2. 承接清单（2026-09-14 已落地 / 已验证，不再排期）

| 项 | 落地方式 | 证据 |
|---|---|---|
| 簇② charterPayload 版本归一化 | `scrubRuntimeNoise` 版本串 → `<VERSION>` + 场景10c 守护；快照外科替换 18+25 | 9 个 `full:` hash 由快照冻结全文重算全中 |
| 簇③ publish-gap 自证 | registry 缺 `gitHead`（或非 40 位 sha）时以项目根为 cwd `npm pack <pkg>@<精确版本>` 到专属临时目录、枚举唯一 tgz、回验 name/version 后读 tarball `dist/.spectra-build-meta.json`；三轮对抗（fail-open 角 / 假红角 / delta） | 49/49 + 变异 12 红；生产实现由 npm shim 单测覆盖；活体 4.6.0 走 registry 路径 pass |
| sync-merge-engine FR 抽取 / 身份键 / 子编号 / 编号语法 / 路由累加 / 写回保留注释 | 身份键 `(sourceSpec, id)`；条目 = 列表位 / 行首粗体段落 / 标题起始位；编号语法覆盖 `FR-1` / `FR-A-001` / `FR-1.1` / `FR-003A` 等；需求类 H2 累加 + 负向词；`extractSpecId` 目录与 mapping 同口径；候选编号集合差 warning + 需求节之外条目写法 warning + 零 FR / 悬空映射提示；`fr-count` 改合并守恒；字母后缀目录（170c/170d）纳入；三轮异构对抗（两轮 delta 各抓 3–4 CRITICAL） | 31/31 + 变异 37 红；真实仓库 spectra 1586 / spec-driver 792 FR，2 冲突（157 自身重复），0 候选 warning |
| 产品活文档补聚合（4 月 → 9 月） | 98 份未映射 spec：digest → 增量合并；spec-driver 915 行 / 58 spec，spectra 108 spec（FR-078 → FR-142 + 170c/170d 补聚合）；34 份明示排除（14 模板占位 + 13 评测设施 + 7 其它，mapping 头部登记） | 二级标题 / 链接 / FR 唯一性机械校验通过 |
| F245 headless 基线 / Stop payload 字段 | Claude Code 2.1.270 实录 | M10 §11 09-14 |
| 知识图谱陈旧 | `batch --mode graph-only` 重建，repo:check 转 pass | — |

## 3. 批次规划

### 第一批（写入路径 disjoint，可并行；F291a 前置已满足）

| 卡 | 模式 | 内容 | 前置 / 备注 |
|---|---|---|---|
| **P1-I 诚实工具面** | feature · medium | 见 §1.1 五项；图解析类，验收必带外部语料 A/B（GORM / HikariCP 09-12 基线） | 主题欠账，优先级最高 |
| **F291a per-target 阻断预算** | fix · medium · **门禁类·异构对抗常设** | 按设计稿「下一轮执行要点」：先把 `T1-E4` / `T2-E6` 改为按 `stateKeyFor` 推导路径并断言「预置的是当前键的锁」，再上复合键 | 两条前置（publish 活体验证 + 新 harness F245 基线）09-14 均已满足 |
| **簇④ 引擎 / CLI 小补合集** | story · small~medium | `get-phases` 补门挂载字段；scope 候选集现取；Constitution Check FR 归属机械检测；补登矩阵差集化；plan.md (ii) 共享块；`generate-template` phase id 字符串化；verify.md 分层；共享制品类别规则；**sync fix-report 消费通道**（FR 按 sourceSpec 分桶已落地）；sync 派发前 mapping / digest 机械对拍；`fr-count` 绝对下界；spec 写法 lint | P1-K 第二卡 |
| **簇⑦ 图新鲜度自动化** | fix · small | `repo:sync` 顺带 `graph-only`（或 pre-push） | 三次再现 |
| **CLI-proxy 无头调用瘦身 + collector 成本口径** | fix · small | `src/auth/cli-proxy.ts` 的 spec 生成调用禁工具 / MCP（`--strict-mcp-config` + 空 `--mcp-config` 或等价）并 `--max-turns 1`；`scripts/baseline-collect.mjs` 与 batch-summary 把 cache_creation / cache_read 单列并按各自单价估算 `estimatedCostUsd` | 09-14 归因：一次单词回复 ≈ 67k input 侧 token，全是 harness 开销；验收 = micrograd 单次 batch 每模块 input 从 ~70k 降到 ~10k 量级，且 spec 产物结构不变 |

### 第二批

- **P1-F 多语言 parity**（图解析类，外部语料 A/B 必带）：Python import 双 kernel 收敛；Java caller recall 3.4% 病根；`stored-module-specs` sourceKind 分叉。
- **簇① 对抗审查 / implement 纪律 story**：冻结 commit 进 prompt；「声称有守护但变异不红」固定切入角；「论据本身」列为攻击面；修法可证伪性核对；清单类断言附命令；变异注入先自证落位；守护语料复刻生产环境变量；CI 日志门禁先剥色；delta 轮专攻新判据；变异运行器骨架。
- **簇⑤ 模板与验收判据纪律**、**簇⑥ repo 引擎**（`repo:sync --only`、断言集下界声明）。
- **P1-H 评测前置**（含 F170c/F170d 未跑的 SC）。

### 第三批（按容量）

P1-J 检索内核 v1 + 离线基准；P1-L brainstorm 轻量入口；P1-M Spec Drift adoption；P1-N Codex 运行时（Agent Plugins 1.0 spike）；§12.4 架构债——**立卡前按 §12 证据复核，不照单开工**。

## 4. 门禁与纪律（沿用 M10 §9，新增四条）

1. 对抗审查 prompt 须把「论据本身」列为独立攻击面（4.6.0 实证：三条论据全被判无效而结论成立）。
2. 冻结型行为快照严禁 `vitest -u`；升版已由簇② 消除触发面，若仍需外科替换，验收 = 回代重建 + 逐字节零残差 + preimage。
3. 变异体注入后先断言命中再看红绿；守护语料必须复刻生产环境变量（F292：`GITHUB_ACTIONS=true`）。
4. 重活动子代理与全量门禁 / 性能基线采集**串行**；子代理停摆只认 ListAgents 状态与 watchdog。

## 5. 收官判定标准（可量化）

| 主题 | 判定 |
|---|---|
| 诚实工具面 | P1-I 五项交付且外部语料 A/B 零假边回归；`tools/list` 确定性回归进 CI |
| 引擎还债 | 簇④⑤⑥⑦ 交付；typecheck:tests:full 错误 **1042 → ≤ 100**（用户 09-14 拍板，高于主线程推荐的 ≤ 300；09-14 实测：160 文件，TS2532 272 / TS2339 250 / TS18048 116 为主）；F291a 交付且 F240 基线套件不改语义 |
| 评测前置 | P1-H 坏题审计 + GStack 重锚完成；F170c/F170d SC-004 有 CI 外可复跑的一次实测 |

## 6. 已知未做 / 未验证承接（2026-09-14 盘点）

| 项 | 承接 |
|---|---|
| 性能基线两个版本未跑 | 09-14 安静窗口已重跑三目标（4.3.0 → 4.6.0）：`baseline:diff` 三档 red，但归因为 **Claude Code 无头调用的 harness 开销**（一次单词回复 ≈ 67k input 侧 token，llm-client 把 cache_creation / cache_read 计入 input），非 spectra prompt 变化；新 fixture 已接受入库。改进候选进第一批：collector 拆 cache 字段并按单价估成本；`cli-proxy` spec 调用禁工具 / MCP、`--max-turns 1`（见账本「4.6.0 perf 基线重跑」） |
| F170c SC-002/SC-004、F170d SC-004 只在 `it.skip` | 并入 P1-H |
| 真实 LLM e2e 靠 `HAS_LLM_E2E=1` | 09-14 首次真跑：T-010-2 通过（128s）；T-010-1 需 300s 预算；T-010-4/5「两次 LLM full batch 逐字节相同」前提不成立（第二次输入含第一次写出的 specs + LLM 重生文本改 INFERRED 边），已改为断言代码派生子图稳定并钉住差异边界；改后复跑结果见账本；产品侧观察「图是否含 spec 派生边取决于 specs 是否预存」→ 簇④/⑦候选 |
| typecheck:tests:full 1042 错 | 簇④ 附带燃尽任务，目标 ≤ 100（用户拍板） |
| SDK 模式 Stop payload 未实录 | F291b 重开条件之一，随 P1-N 顺带 |
| adoption census 复测 | ≈ 2026-09-21，M11 首轮 milestone-next 输入 |
| F277 FR-018 独立观察 0/3 | 观察窗口保持开启，随 P1-K 第二卡结算 |

## 7. 第一批写入路径矩阵

| 卡 | 主要写入 | 冲突 |
|---|---|---|
| P1-I | `src/mcp/*`、`src/graph/*` 边属性、`tests/unit/mcp/*` | disjoint |
| F291a | `plugins/spec-driver/scripts/fix-compliance-judge.mjs`、`lib/fix-compliance-io.mjs`、`tests/fix-compliance-*` | disjoint |
| 簇④ | `plugins/spec-driver/scripts/orchestrator-cli.mjs`、`agents/*.md`、`sync-merge-engine.mjs`、`templates/` | 与 F291a 同目录不同文件，先 ship 先 push |
| 簇⑦ | `scripts/repo-sync*.mjs`（或 pre-push hook） | disjoint |

## 8. 待拍板决策点

全部已于 2026-09-14 由用户拍板（结论见 frontmatter `decisions`）：

1. 第一批四卡并行 → **是**。
2. P1-I 升 feature 全流程 → **是**。
3. typecheck 燃尽目标 → **≤ 100**（高于推荐的 ≤ 300；TS2578 类零风险项先清，其余按文件分配到各卡顺带修）。
4. 评测前置时段 → **第一批四卡 ship 后**。
5. 交界调研 → **聚焦增量版，挂 P1-I 立卡前**。
6. （追加）perf 归因两项改进 → **并入第一批，开一张 small fix 卡**（§3 第五行）。
7. （追加）本机卫生 → 主线程直接清理，保留三个基线目标与 F150 的 HikariCP / GORM / hono。

## 9. 第一批派发 prompt（2026-09-14，用户拍板后由主线程代拟；每张在独立 worktree 执行）

### 9.0 五张卡共用前置（逐条复制进每张 prompt）

- 启动前 `git fetch origin master`，确认 HEAD ≥ `0adc83f6`；在独立 worktree 跑（`git worktree add`），**不要**在主仓工作目录里做；worktree 的 `node_modules` 软链若为空，删软链后按本分支 lockfile `npm ci`。
- 编号：启动时以 `specs/` 与远端 `feature/* fix/*` 分支的最大编号 +1 为准（2026-09-14 最大为 292；多卡并行会撞号，先 fetch 再取号）。
- 模式按卡指定；每完成一个 phase 立即做对抗审查：Codex 配额耗尽期间用独立子代理异构对抗，**门禁 / 判定器 / 守护 / 安全类改动至少两个切入角**（fail-open 面 / 绕过构造面），且对抗 prompt 须把「论据本身」列为攻击面；commit message 标注「Codex 审查暂停，异构档位缺席」。
- 每处修复单独做变异体检查（先自证变异注入落位）；「声称有守护但变异不红」是固定切入角；冻结型快照严禁 `vitest -u`。
- 提交只用显式路径；`specs/src.spec.md` 是再生噪声，`git checkout --` 还原、永不入 commit；`specs/products/_generated/*` 与 `.specify/project-context.suggestions.*` 只在有意的 sync 运行时才提交。
- 任何真实 LLM 运行走订阅优先凭据（`.env.local` 的 SILICONFLOW 只给 jury）；重子代理不得与全量 vitest 或基线采集并发。
- 交付前：`git fetch origin master:master` → `git rebase master` → `npx vitest run` + `npm run build` + `npm run typecheck:tests` + `npm run test:plugins` + `npm run repo:check` + `npm run release:check` 零失败 → 列 7 字段 report（commit / 改动统计 / 关键 finding / 审查档位与结论 / verify / rebase 状态 / 下一步）等用户「确认 push」→ `git push origin HEAD:master`（ff）→ 删分支。
- 交付报告末尾必附「工具使用反馈」一节（Spectra MCP 可用性 / 信息完整性 / 流程顺畅度 / 结果准确性；无则写「无」），有实质反馈按条目格式 append 到 `docs/design/dogfooding-feedback-ledger.md` 随需求一并 commit。
- typecheck 燃尽（里程碑目标 1042 → ≤ 100）：每张卡对**自己触及的测试文件**把类型错误清零；零风险类（TS2578 等）由簇④卡统一清。

### 9.1 卡 A · P1-I 诚实工具面（`/spec-driver:spec-driver-feature`，medium）

问题（verify 过的现状）：M10「诚实的图」只兑现一半。MCP 返回面仍缺：图边解析 stage / 策略标签（消费方无法区分 AST 直解析、启发式、INFERRED）；`confidence` 在两套词汇间漂移；无 `tokenBudget`；`impact` / `context` 的 top-N 顺序与 `tools/list` 顺序无确定性回归；callers / callees 不带调用点行号与语境（F277 账本 #22）。
方案：五项按「返回面契约先行」做：先在 `contracts/` 定义字段与枚举，再改 `src/mcp/**` 与 `src/agent-context/**`，最后补 `tests/e2e/*mcp*` 的确定性回归（同输入两次 `tools/list` 与 top-N 逐字节相同）。调研阶段**聚焦**「工具面诚实化」的外部范式（其它竞品维度不重跑，09-12 三路审查证据仍新鲜）。
🔴 回归护栏：F266 空图 fail-loud 与诚实 envelope 不得回退；相似度命中永不进 impact / context（裁决不变量）；builder 戳只可见不判定（F261 D1）。
验收：外部语料 A/B 必带（GORM / HikariCP 的 09-12 基线，`scripts/graph-accuracy.mjs` 调用范式）；每一项返回面变化都有客户端侧解析可见性测试；`tools/list` 与 top-N 确定性回归绿。
预算：medium；LLM 只在 A/B 建图时用（订阅）。
写入路径：`src/mcp/**`、`src/agent-context/**`、`contracts/`、`tests/e2e/*mcp*`、`tests/unit/mcp/**`。

### 9.2 卡 B · F291a per-target 阻断预算（`/spec-driver:spec-driver-fix`，medium，门禁类 · 异构对抗常设）

问题：fix-compliance 判定器的 `blockCount` 是 per-session 而非 per-target；同一会话内切换目标后预算被前一目标消耗（F290 残余，设计稿 `docs/design/f291-per-target-budget-and-reentry-corroboration.md` 有实测爆炸半径）。
方案：按设计稿「下一轮执行要点」：**先**把 `T1-E4` / `T2-E6` 两类用例改造成按 `stateKeyFor` 推导路径并断言「预置的是当前键的锁」，**再**上复合键；不改 F270 既有裁决；`enforcement: warn` 逃生口保留。
🔴 回归护栏：F289 两处锚 fix 的反向缺陷史（earliest → 跨目标 fail-open；latest-activity → 同目标永久 fail-closed）；改门禁窗口**必同目标 + 跨目标双语料对拍**；harness 回灌计数上界（F276）不得放宽。
验收：同目标 8 轮自愈、跨目标切换不 fail-open 的双语料全绿；headless（`--print`）Stop payload 实录一次（2.1.270 字段：`background_tasks` / `last_assistant_message` / `stop_hook_active`）；变异体全红。
预算：medium；零 LLM。
写入路径：`plugins/spec-driver/hooks/**`、`plugins/spec-driver/scripts/fix-compliance*`、`plugins/spec-driver/tests/**`（与卡 C 同目录不同文件，先 ship 先 push，后者 rebase 重验）。

### 9.3 卡 C · 簇④ 引擎 / CLI 小补合集（`/spec-driver:spec-driver-story`，small~medium）

问题与方案（每项独立可测，按顺序做，做不完的如实登记移交）：
1. `get-phases` 补 `gates_before / gates_after`；2. scope 阶段 `agents-byte-budget` 候选集从 `AGENTS_CANDIDATES` 现取；3. Constitution Check 引用的 FR 须 ∈ 矩阵已认领集合（机械检测）；4. verify 补登由矩阵差集机械生成；5. `agents/plan.md` (ii) 门禁类升格条款改第 6 个共享块；6. `generate-template` phase id 字符串化；7. verify.md 分层（定义层 / 流程层）；8. 共享制品的类别判定规则；9. sync：fix-report 消费通道（94 个仅 fix-report 的目录进变更历史 / 已知限制）；10. sync：派发前 mapping 条目数 / digest 节数 / 归属判定机械对拍；11. sync：`fr-count` 绝对下界（与 spec 原文条目数对账）+ spec 写法 lint；12. 三套 `parseProductMapping` 收敛到 `sync-product-mapping.mjs`（顺带修 catalog `specCount: 0` 假数与「上轮有本轮产不出」字段脱落 warning）；13. mapping 写回改 in-place 补丁或改掉「可手动编辑」自述；14. typecheck 零风险类（TS2578 等）清零。
🔴 回归护栏：`plugins/spec-driver/tests/sync-merge-engine-*.test.mjs` 36 例 + 40 变异体口径不得退（同一标识符共享 helper；护栏取数路径独立于被护对象）。
验收：每项有红先行测试与变异体；`npm run test:plugins` 零失败；第 12 项后 `catalog-index.yaml` 的 `specCount` 为真值。
预算：small~medium；零 LLM。
写入路径：`plugins/spec-driver/scripts/**`（不含 fix-compliance*）、`plugins/spec-driver/agents/*.md`、`plugins/spec-driver/templates/**`、`plugins/spec-driver/tests/**`。

### 9.4 卡 D · 簇⑦ 图新鲜度自动化（`/spec-driver:spec-driver-fix`，small）

问题：`graph-quality:freshness` 在每次 commit 后必 warn（图记录的 sourceCommit 与 HEAD 不一致），F270 / F275 / F277 三次再现，09-14 又手动重建两次；MCP 因此只能作旁证。
方案：`repo:sync` 顺带 `spectra batch --mode graph-only`（纯 AST、零 LLM、<2 min），或 pre-push 钩子；明确 sourceCommit 的比较语义（HEAD vs 最近一次触及采集面的 commit）并写进 `docs/shared/agent-repo-maintenance.md`。
🔴 回归护栏：`spectra graph` 会静默毁图（F239）勿误触；`graph-quality` 其余门禁语义不变；`.worktreeinclude` 机制不受影响。
验收：连续两次只改 docs 的 commit 后 `repo:check` 无 freshness warn；改 `src/` 后 warn 出现且 `repo:sync` 一次消除。
预算：small；零 LLM。
写入路径：`scripts/repo-sync*.mjs`、`scripts/lib/graph-quality-core.mjs`、`docs/shared/agent-repo-maintenance.md`、`.githooks/`（如走 pre-push）。

### 9.5 卡 E · CLI-proxy 无头调用瘦身 + collector 成本口径（`/spec-driver:spec-driver-fix`，small）

问题（09-14 实测）：一次只回「ok」的 `claude --print --output-format stream-json` 今天的 usage = input 3 + cache_creation 40,747 + cache_read 26,085 ≈ 67k / 次；`src/core/llm-client.ts`（Fix 134）把三项相加记作 input，spec 生成的每个模块调用因此报 70k 起步，带一轮工具迭代就 140k；`scripts/baseline-collect.mjs` 的 `estimatedCostUsd` 把缓存读按全价计，虚高约 5×。4.3.0 → 4.6.0 基线 diff 三档 red 全部由此而来。
方案：(1) `src/auth/cli-proxy.ts` 的 spec 生成调用加 `--max-turns 1`，禁工具与 MCP（`--strict-mcp-config` + 空 `--mcp-config`，工具用 `--disallowedTools` 或等价；以 `claude --help` 实测的旗标为准）；(2) collector 与 batch-summary 把 `cache_creation_input_tokens` / `cache_read_input_tokens` 单列，`estimatedCostUsd` 按各自单价（创建 1.25×、读取 0.1×）估算；(3) A/B：改前改后各跑一次 micrograd `--mode full`，断言每模块 input 从 ~70k 降到 ~10k 量级、spec 产物结构（章节集合、FR 行数）不变，把改后的 fixture 作为新基线入库并在 CHANGELOG 记录口径变化。
🔴 回归护栏：F222 CLI 零认证降级语义不变（`llmDegraded` 结构化字段）；`--require-llm` 行为不变；不得为省 token 换更弱模型。
验收：A/B 数字入 fix-report；`tests/baseline/*/spectra/full.json` 三档重采并 `baseline:diff`（新 vs 09-14 fixture）token 降幅 ≥ 70%；单测覆盖 cli-proxy 的 argv 构造（PATH 上 claude shim）。
预算：small；LLM 只在 A/B（micrograd 两次约 6 min）。
写入路径：`src/auth/cli-proxy.ts`、`src/core/llm-client.ts`、`scripts/baseline-collect.mjs`、`tests/unit/auth/**`、`tests/baseline/**`。

## 10. 第一批交付账（2026-09-15，`/goal` 落地）

| 卡 | 制品 | 审查档位 | 结论 |
|---|---|---|---|
| A · P1-I 诚实工具面 | `specs/297-honest-tooling-surface/`（spec / plan / tasks / verification） | 一般代码档位：主线程自审 + 护栏（未派对抗子代理，如实登记缺席） | 8/8 FR；外部语料 A/B（GORM / HikariCP）节点 / 边 / 准确率逐字不变，calls 边 100% 带 resolution + callSites；breaking 词表改名 3 处登记合同 |
| B · F291a per-target 阻断预算 | `specs/296-fix-per-target-block-budget/`（fix-report / verification）+ 设计稿证伪表 | 门禁类常设：两路异构（fail-open / 误伤）3C+5W / 4C+8W，全部处置 | 方案① → 方案①′（会话文件内分桶 + 改名链迁移 + 无目标桶 + 整份清零）；10 例判别语料 |
| C · 簇④ 引擎 / CLI 小补 | `specs/295-engine-cli-small-fixes/`（spec / plan / tasks / verification） | 门禁类档位：两路异构 3C+6W+8I / 3C+11W+8I，CRITICAL 全处置 | 14/14 项；fix-report 通道双计（本仓 49 条假冲突）、fr-floor 同源自证、in-place 补丁守卫不对称三处 CRITICAL 已修 |
| D · 簇⑦ 图新鲜度自动化 | `specs/294-fix-graph-freshness-automation/fix-report.md` | 门禁类档位：两轮 + delta | `sourceTreeDirty` / committed diff / `repo:sync graph-freshness` 步 |
| E · cli-proxy 无头瘦身 + 成本口径 | `specs/293-fix-cli-proxy-headless-cost/fix-report.md` | 一般代码档位：两轮 + delta | tokens in+out micrograd −89.1% / nanoGPT −79.1% / self-dogfood −48.2%（三目标已在已提交树重采）；成本以 CLI 真值为准；**self-dogfood 墙钟 +65.5% / 输出 token +87% 判红，待复测** |

§9 各卡 prompt 保留作派发记录；§6 未做 / 未验证盘点中由本批承接的条目按上表回填。第二批（P1-F 多语言 parity / 对抗审查纪律 story / P1-H 评测前置）不在本次交付。
