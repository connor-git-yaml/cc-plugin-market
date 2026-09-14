---
title: Milestone M11 — 诚实工具面、引擎还债与评测前置
status: draft-pending-user
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
  - "【待拍板】本文所有排期均为主线程代拟；正式启动前须用户逐条确认 §8 决策点（默认推荐项已标注）"
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
| 引擎还债 | 簇④⑤⑥⑦ 交付；typecheck:tests:full 错误 **1042 → ≤ 300**（09-14 实测：160 文件，TS2532 272 / TS2339 250 / TS18048 116 为主）；F291a 交付且 F240 基线套件不改语义 |
| 评测前置 | P1-H 坏题审计 + GStack 重锚完成；F170c/F170d SC-004 有 CI 外可复跑的一次实测 |

## 6. 已知未做 / 未验证承接（2026-09-14 盘点）

| 项 | 承接 |
|---|---|
| 性能基线两个版本未跑 | 09-14 安静窗口已重跑三目标（4.3.0 旧 fixture → 4.6.0）：`baseline:diff` **三档全 red**——同模块数、同 4 次 LLM 调用下每次调用输入 token ×2.3、输出 ×2.4，墙钟 +20% / +121% / +89%；新 fixture 未入库，**待用户拍板**（接受为新基线 / 先按 minor 二分追因，见账本「4.6.0 perf 基线重跑」）；追因若立卡进第一批 |
| F170c SC-002/SC-004、F170d SC-004 只在 `it.skip` | 并入 P1-H |
| 真实 LLM e2e 靠 `HAS_LLM_E2E=1` | 09-14 首次真跑：T-010-2 通过（128s）；T-010-1 需 300s 预算；T-010-4/5「两次 LLM full batch 逐字节相同」前提不成立（第二次输入含第一次写出的 specs + LLM 重生文本改 INFERRED 边），已改为断言代码派生子图稳定并钉住差异边界；改后复跑结果见账本；产品侧观察「图是否含 spec 派生边取决于 specs 是否预存」→ 簇④/⑦候选 |
| typecheck:tests:full 1042 错 | 簇④ 附带燃尽任务，目标 ≤ 300 |
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

1. **第一批是否四卡并行**（推荐：是；F291a 与簇④ 同目录不同文件，先 ship 先 push）。
2. **P1-I 是否升为 feature 全流程**（推荐：是，图解析类须调研 + 外部语料 A/B）。
3. **typecheck 燃尽目标**：≤ 300 是否合适，或改为「只报不阻断」永久化（推荐：≤ 300，且 TS2578 类零风险项先清）。
4. **评测前置的凭据与配额**：P1-H 与 F170c/d 复测走订阅优先；预计 Claude Max 配额消耗需你确认时段。
5. **交界全量调研 workflow**：是否在 M11 正式启动前跑一轮（约 14 agent / 1.1M token）；推荐：P1-I 立卡前跑聚焦增量版（只调研工具面诚实化的外部范式）。
