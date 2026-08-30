---
title: Milestone M10 — 先发布、诚实的图、换证据源的门禁
status: planning
created: 2026-08-24
parent_milestone: milestone-M9-codex-trusted-live-graph.md（代码面 2026-08-23 收官；T062/T063 人工验证待办，正式收官前禁称"M9 已完成"）
stepback_revision_of: milestone-M9-codex-trusted-live-graph.md §10「M10 边界 — 体验扩张」（本文件取代该节的排期，保留其候选池）
planning_horizon: M10 单独交付门禁；Wiki 消费面整体移交 M11
sources:
  - 交界 workflow wf_0532a10b（2026-08-23/24，20 agent / 4.06M token / 48min）：3 路增量调研 + 4 维全仓审查 + 12 条逐条证伪 + 完整性批评
  - docs/design/dogfooding-feedback-ledger.md（F261/F260/F263/F262 共 11 条，2026-08-23 全部流转）
  - specs/262-fix-codex-hooks-warnings/fix-report.md「影响范围扫描 · 同源但分流」
  - specs/241-graph-keepalive-kb-grounding/pilot/metrics-raw.md（修复前 caller 命中 25% 的唯一在案数字）
  - Claude Code hooks 参考（transcript_path 异步滞后声明、last_assistant_message、background_tasks/session_crons）；issues #81825 / #87223
  - Codex changelog 0.145.0→0.149.0（SessionEnd、async hooks、mcp_tool handler、linked worktree 信任校验 #39616、AGENTS.md 沙箱 #39653）
  - Agent Retrieval Bench（arXiv 2607.24882）、DyCoder（ASE 2026）消融；LangChain OpenWiki Grounded Claims PR #638
  - Graphify-Labs/graphify CHANGELOG 0.9.17→0.9.48；DeusData/codebase-memory-mcp v0.10.0–0.10.8；GitNexus PR #2782/#2796/#2808/#2921
decisions:
  - "M10 主题从「体验扩张」改为「先发布、诚实的图、换证据源的门禁」；可浏览 Wiki 整体移交 M11（2026-08-24 用户拍板）"
  - "fix-compliance 门禁换证据源：hook 侧实时证据账本取代 transcript 判定器，不再在 F256 有界放行预算上打第十个补丁（用户拍板）"
  - "Codex hooks 分发：插件自带 hooks/hooks.json 为主路径（Codex 原生发现），全局合并器降为 skills-only 安装的 fallback 并加双注册守卫（用户拍板）"
  - "检索内核 v1 = 图结构分 + FTS5；embedding 只在离线基准测出提升才加第三腿，相似度命中永不进 impact/context（用户拍板）"
  - "builder 戳维持 F261 D1「只可见不判定」：graph-quality 退出码不因 builder 不一致翻转；MCP 返回面以 advisory 形式暴露（主线程裁决）"
  - "Agent Plugins 1.0 两路调研事实互斥（日期/TSC/采纳版本），任何 manifest 工作前须钉一手来源（主线程裁决）"
  - "brainstorm 卡立项文案去 overclaim：c3 84.8% 未反超 GStack 90.9%、锚版本已漂 17 版，「真有效」只有自比证据（主线程裁决）"
  - "不预占 Feature 编号；派发时查远端分支与 specs/ 后分配"
---

# Milestone M10 — 先发布、诚实的图、换证据源的门禁

## 0. 一句话定位

M9 把图做"对"了，但**没有一个用户拿到过**：npm `spectra-cli` 停在 4.4.0（build `0ae3eb7`），此后 18 个动 `src/` 的 commit（F243–F263 整条可信活图链）未发布，自用 MCP 跑的也是旧二进制；CI 从不执行治理链（`repo:check` 只出现在永不触发的 PR workflow 的 LLM prompt 里）；一个月 MCP 仅 70 次调用、17 个工具 14 个零调用。M10 先把 M9 的成果**发出去、量出来**，再把图的返回面做**诚实**（空结果可区分"已解析为 0 / 解析缺口 / 外部边界 / 图陈旧"），把 fix 门禁的证据源从**官方明言会滞后的 transcript** 换成 hook 侧实时账本。体验扩张（Wiki、brainstorm 入口）放在这三件之后。

## 1. 交界证据摘要

| 轨 | 结论 | 对 M10 的约束 |
|---|---|---|
| 调研① code-context 赛道 | graphify（32 版/5 周）、codebase-memory-mcp（40k★）、GitNexus（45k★）全在修与 M9 同款问题：stat 快路径陈旧摘要、残缺图覆盖完整图、receiver 仅按类型名绑定造假边、容量截断致 impact 运行间不可复现；并把"图没覆盖到什么"做成一等返回面（coverage / boundary / undecided 三分）。Cursor 官方关停 embedding 索引改本地 grep；Continue 停更 | 返回面要"诚实的零"；embedding 不预设 |
| 调研② harness / Codex | Claude Code 官方文档（07-14 起）：`transcript_path` 异步写入、Stop 时不保证含当前轮，推荐 `last_assistant_message`；`background_tasks`/`session_crons` 是官方"在途"判定字段；2.1.232 起子代理默认后台 → 每次委派触发一次 Stop。Codex 0.145–0.149：SessionEnd、async hook、`mcp_tool` handler、linked worktree 信任校验、AGENTS.md 沙箱。**隔离环境实测**：Codex 原生发现插件 `hooks/hooks.json` 并展开 `${CLAUDE_PLUGIN_ROOT}`——M9 F213/F240 的前提错误，叠加全局合并器得 10 条重复 hook | 门禁换证据源；Codex hooks 路线纠偏；T062/T063 须在 ≥0.149 做 |
| 调研③ 检索与评测 | ARB：RepoMap 族在 trace2code 上 MRR 0.274 压过全部 embedding，RRF 融合再 +0.04；DyCoder 消融两者互补；OpenWiki Grounded Claims（claim sidecar + 证据版本 + 懒暴露 debt）是 Wiki 最值得对齐的参考；GStack 锚版本已漂 17 版，33-run 任务池需坏题审计 | 内核 v1 先建基准；Wiki 移交 M11 但对齐点记下 |
| 审查 4 维 + 证伪 | 12 确认 / 0 否决 / 43 未证伪（info 或超上限）。主线程复核 6 条 critical：5 实锤（发布断层、isFix 取最晚任意展开、lineRange 零生产者、orchestrator-cli userConfig 恒空、post-commit 跑 `spectra graph` 毁图）、1 限定范围（非 src 布局 0 模块仅在全量 batch 的模块派生，graph-only 正常） | 见 §4/§5 各卡 |
| 完整性批评 | 最大盲区=发布断层；同一 F256 预算抽象被三路独立烧穿却被拆成三张卡；P0 与 P1 位置倒置（实时账本排 P1 是错的）；多语言 parity 矩阵缺失；Spec Drift 仅 3 个锚却在规划 rename-follow；43 条未证伪≠已排除 | §3 Gate 0；§4 P0-A 合卡；§7 待证伪池 |

## 2. 裁决的矛盾

1. **builder 戳升 freshness 判据 vs F261 D1**：维持 D1。`graph-quality` 的退出码/四态不因 `builder.commit ≠ sourceCommit` 翻转（dist 滞后是开发期常态，天天红即噪声）；但 **MCP 返回 envelope 以 advisory 暴露 `freshness.builderMismatch`**——"门禁不判、返回面如实说"。engine 的 mtime+size 缓存回答"内存是否落后磁盘"，与 builder 戳回答"谁建的图"是两个问题，不互为替代。
2. **embedding 进不进内核**：内核 v1 = 图结构分 + FTS5 的 RRF；先把 ARB/BCY@8k 离线基准搭起来；既有 `EmbeddingProvider` 作为**门控第三腿**，只在基准测出提升才接入；相似度命中只进 `graph_query` 类探索工具且标非确定，**永不进 impact/context/detect_changes**。
3. **Agent Plugins 1.0 事实互斥**（发布日 07-24 vs 08-06、TSC 成员、Codex 采纳版本 0.146 vs 0.147）：两路都未钉一手来源。任何 dual-manifest 工作前先核 agent-plugins.org 规范与 Codex changelog 原文；核不清就不做。
4. **P0 门禁卡方向**：从"陈旧快照 → indeterminate 放行"改为"换证据源"（§4 P0-A）。官方口径下 Stop 时 transcript 缺当前轮是**结构性常态**，"陈旧即放行"≈门禁默认关闭；F224→F257 九轮史证明在同一抽象上继续打补丁只会得到第十轮绕过。
5. **同一抽象三路烧穿**：审查"GATE 暂停被当收口尝试"、调研"子代理默认后台致 DEFER_LIMIT=3 四次委派即耗尽"、账本"陈旧快照每会话 2 次假 block"——都指向 F256 有界放行预算（`IN_FLIGHT_DEFER_LIMIT` / `BLOCK_LIMIT`）。合成一张卡，而不是三张互不引用的卡。
6. **brainstorm 立项文案**：M9 §10 写"实测优势 81.8% vs 66.7%"是 c3 对自家 c4 的自比；对外（GStack 90.9%）未反超且锚版本已漂。文案改为"入口可发现性有外部 adoption 证据（SuperPowers/BMAD/OpenSpec 三家都在减入口、改意图命名），有效性证据待 §5-H 评测前置完成后补"。
7. **四方一致性 doctor 报"一致"但二进制落后 18 个 src commit**：doctor 只比 semver（`codex-runtime-doctor-core.mjs:208` 丢弃 commit），release-contract 自 F186 后未 bump。进 Gate 0。

## 3. Gate 0 — 发布与度量（硬前置，其余卡不得绕过）

**G0-1 发布 spectra-cli 4.5.0 + spec-driver 同步版本**：`contracts/release-contract.yaml` bump → `npm run release:sync`；**CHANGELOG 从 4.1.1 补到 4.5.0**（按 F2xx 卡聚合，不逐 commit）；`npm publish` 由用户在 host shell 执行（E401/交互式 auth 先例）。验收：`npm view spectra-cli version` = 4.5.0；全局 `spectra --version` 的 commit 与 master 一致；`npm run judge:doctor` / `codex:doctor` 零漂移。
**G0-2 CI 接治理链**：`.github/workflows/ci.yml` 增加 `npm run repo:check` + `npm run release:check`（当前只 lint/build/graph-only/test）；`release:check` 新增 warning：master 领先已发布版本 N 个 `src/` commit（N≥5 warn）。验收：故意不 bump 版本推 1 个 src commit → CI warn 可见。
**G0-3 版本自省与 doctor 按 commit 比对**：MCP server `tools/list` 或专用自省暴露 `{version, commit, dirty}`（沿用 `dist/.spectra-build-meta.json`）；`codex-runtime-doctor-core.mjs` 四方比对改用 commit（semver 只作次级）；`plugins/spectra/.mcp.json` 的 `command: "spectra"` 评估可钉版本的启动方式（至少在 doctor 里报出实际二进制 build）。
**G0-4 adoption 与图质量基线**：发布后一周做本机 MCP 调用 census（当前 70 次/月、14/17 零调用、Codex 0 次）作为 M10 adoption 基线；按 F241 pilot **冻结口径 + 外部语料**复测 caller recall/precision（当前唯一在案数字是修复前 25%，F242–F263 之后无人量过）。这两条数字是 M10 收官判定的对照组，**不做则 M10 不得宣称"图更可信了"**。

## 4. P0 四卡

### P0-A fix-compliance 门禁证据源换代（门禁类，异构对抗档位必备）

**病根**：判定器以 transcript 为唯一证据源，而官方明言它异步滞后；SDK harness 下滞后 25 分钟+。三路证据烧同一个 F256 预算：(i) 陈旧快照 → 每会话 2 次假 block 后降级放行（F262 ledger）；(ii) 2.1.232 后每次委派触发 Stop，`IN_FLIGHT_DEFER_LIMIT=3` 在 diagnose→plan→fix→verify 四次委派即耗尽（调研②）；(iii) GATE 暂停等用户拍板被当收口尝试误阻断，烧光 `BLOCK_LIMIT` 后**人工门禁被绕过、会话末尾真实收口检查被自己废掉**（审查 `fix-compliance-judge.mjs:757-801, 534-630`）。另两处同文件缺陷一并收：(iv) `isFix = anchor.mode==='fix'` 取**最晚任意** spec-driver-* 展开——会话尾部展开 sync/doc 即整体跳过判定且零落盘（`:202/:719`，绕过面，spec FR-007 要求取最晚一次 *fix* 展开）；(v) block/defer 状态 load→modify→save 无锁，Codex 双注册下同一 Stop 并发两次判定互相覆写。
**方向**：PostToolUse hook 实时把 `{tool_use_id, tool_name, tool_input 摘要, ts}` 追加到会话证据账本；Stop 只读账本；`background_tasks`/`session_crons` 判在途（取代次数预算）；`last_assistant_message` 与 transcript 尾部交叉校验陈旧并打 `snapshot-stale` 专码（与"证据缺失"区分）；GATE 暂停识别为"等待用户"而非收口尝试；锚点改最晚一次 *fix* 展开。transcript 降为次级佐证，Codex 方言保持 indeterminate 语义。
**spec 阶段必答**：① 账本的威胁模型——被判方可经 Bash 写账本文件，"不经手"门槛如何达成（hook 进程独立写 + 结构/序列校验 + 与 harness 字段交叉，诚实写清只防"疏忽不合规"不防"蓄意伪造"的边界）；② 与 F227 磁盘候选历史、F257 闸门三的关系（协同还是取代，逐条列出保留/废除的闸门）；③ `stop_hook_active` 重入防护；④ 49 份 fixture 中 48 份手工合成——新增**真实会话录制**的 fixture 作为主验收语料。⑤ 长异步验证（真实 CI 等待 30min+）的 in-flight/PENDING 语义：把 F269 现场发明的「报告先落盘 + 真实验收节标 PENDING + 完成后回填」惯例成文并让判定器显式支持，避免未来严格化把长异步流卡死。
**护栏**：F208 三档语义、F211 补救清零、F216 no-op 证据门、F231 光杆命令判据不回退；JUDGE_FILE_SET 同步；本机门禁跑的是已安装快照（F236）——修完必须 `judge:doctor` 并说明生效时点。规模：medium-large；**串行于 P0-B 的双注册守卫**（同碰 `hooks/hooks.json` 与 installer）。

### P0-B Codex hooks 分发纠偏（M9 A3 前提错误）

**事实**（隔离 CODEX_HOME 于 0.144.6 与 0.149.0 实测）：`codex plugin add spec-driver` 后 `hooks/list` 直接返回 5 条 `source=plugin` 的 `hooks/hooks.json` 条目、`${CLAUDE_PLUGIN_ROOT}` 已展开、WorktreeCreate/Remove 被静默丢弃、全部 `trustStatus=untrusted`；再按 README 跑 `codex-skills.sh install --global` → 10 条同名 hook，判定器每次 Stop 跑两遍，`BLOCK_LIMIT=2` 一次 Stop 烧尽立即降级放行，postinstall 每 SessionStart 跑两遍。F213 FR-006 / F240 FR-011 的"Codex 不读插件 hooks.json"前提不成立。
**路线（已拍板）**：插件自带 `hooks/hooks.json` 为主；全局合并器降为 skills-only 安装的 fallback，**检测到插件已注册时拒绝重复安装**（双注册守卫，第一步，独立小 commit 先落）；项目级 `.codex/config.toml`（spec-kit 路线）记为候选不做。同步：修正 F213/F240 错误前提的文档与注释、README Codex 节（当前仍是 M9 前 skills-only 路径）、`codex-hooks-schema.mjs` 事件集补 SessionEnd（10→11）、`validate-codex-hooks` 按 handler 而非仅按事件判（Stop 事件缺 `stop-fix-compliance` handler 也应红）、Codex 包装 skill 里残留的 Claude 专属 `mcp__plugin_spectra_spectra__*` 命名空间。
**验收**：原生安装 + 合并器叠装 → hook 恒 5 条不重复；T062 在此之后于 Codex ≥0.149 执行（§8）。规模：small-medium。
**状态（2026-08-24）**：✅ 已交付 → `specs/264-fix-codex-hooks-distribution/`（卡面派发时写作 F265，按"不预占编号"实际落 **264**）。卡面事实已在隔离 `CODEX_HOME` / codex-cli 0.144.6 上逐条复现；验收 6 步端到端复验通过（原生 5 条 → 叠装仍 5 条且 `hooks.json` 未创建 → 幂等 → `enabled=false` 放行 → 历史条目点名 → `remove --global` 回到 5 条）。**新增两条本机一手事实**：`enabled` 键缺失时 Codex 照常注册（守卫判据据此取三态）；0.144.6 **不接受** `SessionEnd`（补入 schema 全集依 0.149.0 口径，已在代码内标注版本相关性）。T062 前置条件（双注册守卫）已具备。

### P0-C 空图/退化图 fail-loud 链 + 诚实返回面（吸收原卡③）

三条确认发现实为一条串联链：(a) `src/knowledge-graph/module-derivation.ts:359` 默认 `/^src\//` 过滤，非 src 布局的全量 batch 静默 `createEmptyModuleGraph`（0 模块、0 spec）——须报错/提示 `--include-only`，graph-only 路径不受影响；(b) `src/hooks/git-hook-installer.ts:29` post-commit 跑 `spectra graph`（只读 .spec.md 建 DocGraph、F217 已坐实写 null）把好图覆盖成贫图，README:158 / cli-reference:156,204 三处"incrementally rebuilds"文案失真——改跑 `batch --mode graph-only` 或删除并改文案；(c) `src/cli/commands/graph-quality.ts:196-204` 对 nodeCount==0 / sourceCommit=null 给 pass——至少 pass-with-warnings；(d) **MCP 返回 envelope**：impact/context/detect_changes 增加 `freshness{sourceCommit, builderMismatch(advisory), dirty, staleReasons}` 与 **coverage/boundary 维度**（scope 内解析缺口计数、外部边界调用计数、未决计数），空结果按"已解析为 0 / 解析缺口 / 外部边界 / 图陈旧"四分并改写 nextStepHint（当前往"没人调用"引导）；(e) `detect_changes` baseRef 模式忽略工作树未提交改动（`<sha>...HEAD`）——至少在返回体声明口径。
**护栏**：F217 六指标、F193 加载期 stale、F249 指纹、F254 自述面判据不冲突；byte-stable；`spectra graph` 命令本身的"静默毁图"陷阱（M9 §435-437 已记 M10 fix 卡）并入本卡。验收含 G0-4 的复测基线。规模：medium。

### P0-D Claude 侧 atomic-write 缺陷群（security-adjacent）

`src/utils/atomic-write.ts` `writeAtomicJson`：无 mode 保全 + **rename 拆软链**（dotfiles 管理 `.claude/settings.json` 的用户收不到更新，实测）+ tmp 固定名并发互截 + 失败不清理；5 个生产消费方（manifest-manager / graph-builder / extraction-cache / hook-installer×2）。`src/hooks/hook-installer.ts`：经它写项目级 settings（同丢 mode、remove 不备份）、L148 无条件 `chmodSync(scriptPath, 0o755)` 放宽用户收紧的 0700、`.bak` 无 COPYFILE_EXCL 被顶掉。`codex-runtime-doctor-io.mjs:273` `.find` 首匹配非首可用（畸形段屏蔽合法段→absent）。以 F262 W3 的 codex 侧实现为 parity 参照（stat 快照 → tmp 0o600 → chmod 还原 → rename；软链 realpath 跟随；随机 tmp 名；失败清理）。另 4 处 tmp+rename（persistence / checkpoint / kb-writer / graph-bootstrap-status）写的是我方产物，评估后可不改。规模：medium。

## 5. P1 轨道（Gate 0 + P0 之后，可并行）

- **P1-E 产品表面一致性清扫**（critical 1 + warning 12 + info 6）：`view_file(symbolId)` / `context.definition` 行号链路**死功能**（`metadata.lineRange` 全仓零生产者，`file-nav-tools.ts:84,240` / `agent-context-tools.ts:436` 只读不写——从 ExportSymbol span 生产）；`graph_community` 在所有文档路径上是死工具（只有 `spectra community` CLI 写 metadata）；graph-not-built 恢复提示三处不一致、`spectra index` 是死胡同；README MCP 示例参数名与 schema 不符且 zod 剥离未知键；退出码 2 四种语义；`spectra export --output` vs `--out`；CHANGELOG 停 4.1.1（G0-1 先补）；`plugins/spectra/README.md` 写"4 个工具"；Spec Drift 只在仓内 scripts/ 不在 `spectra` CLI；MCP 17 工具命名/参数词汇不统一；`prepare` 对不存在路径返回脱敏 internal-error。
- **P1-F 多语言解析 parity**：Python import 解析**两套语义分叉 kernel**（`python-adapter.ts:410-470`：batch 拓扑图与 graph.json 各信一套，第三套已死——critical/medium）；`python-mapper.ts` 0 处 receiver 处理，java/go 只处理声明侧；3 个 perf baseline 里 2 个是 Python。产出按语言的 parity 矩阵（free call / method call / import / receiver）后再补齐；同卡收 `stored-module-specs.ts:31-45` 两套 stored-spec 读取器 `sourceKind` 分叉（bundle 副本未过滤 → 项目级文档消费 3.03× 重复模块，即 F260 立项时的分母污染根因）。
- **P1-G 测试与守护资产清淤**：`src/panoramic/qa/__tests__` 8 个文件从未被 vitest include 且已腐烂（10/10 失败）——修或删；`graph-mcp-snapshot` Layer B 因 fixture 被删 describe.skip 三个月；`typecheck:tests`（F220 G3 / F222 llmDegraded / F170c 三份类型守护）未接 CI/repo:check；四语言 lang-matrix 的 TS pinned graph 落后 builder（11 边 vs 14）且无"pinned 是否陈旧"检查；`regen-collector-fingerprint-fixtures.ts` 放行路径丢弃已算出的 differences；23 条 it.todo 挂 4 个月；源码文本 grep 式测试与恒真断言清单。
- **P1-H 评测前置**：对既有 33-run 产物做坏题审计（分歧集法）+ 重钉 GStack 锚版本；之后才允许再投 run。brainstorm 卡与任何"c3 更有效"对外表述都以此为前置。
- **P1-I 诚实工具面**（优先级论据：F266 实测本仓 live 图 linkageRatio 仅 3.1%——123767/126411 已探测调用点未成边，coverage-gap 在非导出 symbol 上恒成立、confirmed-zero 不可达，producer 侧 call-site 归因持久化按此数量级重估）：图边携带解析 stage/策略标签并在 MCP callers/callees 暴露（账本 F260+F263 再现）；confidence 双词汇收敛；`tokenBudget` 参数（超预算按相关性收缩并顶部声明截断，现 `PAYLOAD_CAP_BYTES` 1MB 是安全上限非预算）；impact/context/graph_node top-N 裁剪与 `tools/list` 的确定性回归（同名平局 ≥14 次运行集合恒等，GitNexus #2796 教训）。
- **P1-J 检索内核 v1 + 离线基准**：先把 Spectra 当 retriever 接入 Agent Retrieval Bench 拿基线；内核 = 图结构分 + FTS5 RRF；embedding 门控（§2-2）；复合 `find` 工具（Code Finder 形态）留 kernel 落地后。
- **P1-K Spec Driver 引擎正确性与硬化**：`orchestrator-cli.mjs:73` 永远传空 userConfig → `spec-driver.config.yaml` 的 gate_policy/gates 在 CLI 路径被忽略（small，先修）；6 个 SKILL 仍写 `Task` 而真实委派是 `Agent`；`io.mjs` 20MB transcript 上限注释基于 0.31MB 实测而现网已 5.66MB；三套 doctor + 六套 validate/status CLI 各写各的状态词表/退出码/flag 解析且无一接入 repo:check（给统一输出契约）；**2026-08-31 账本流转追加 7 项**：zod 缺失下 orchestration-overrides 整体不生效（与 userConfig 恒空同修）；spec-review 只读 git 白名单或编排器预跑注入；`create-new-feature.sh --mode fix` 跳过 spec.md 脚手架；fix 轻量/完整路径判据加**性质闸**（触及权限/软链/子进程/门禁判定器一律完整路径）；spec/plan 对**推断得出的关键前提**强制登记 + verify 至少一条运行时口径验证（F264 根因）；子代理 MCP 注入链路诊断（frontmatter 授权 ≠ 运行时可达，F266 实测 "No such tool available"）；值级数据流需求样本 → P1-J。既有硬化项照 M9 §10 保留：TDD 红先行引擎化（吸收 GStack evidence ledger：命令哈希+退出码+树内容指纹）、任务级上下文精确构造、diff-file 审查纪律、task right-sizing、systematic-debugging、**plan 裁决回写**（账本 F261）、派发纪律（被派发子代理禁再派发；A/B 用副本；共享树验收"目标文件组绿 + A/B 零 delta"）。
- **P1-L brainstorm 轻量入口 + 入口意图化命名**：采用 SuperPowers v6.3 "spike/bounded/architectural 三路由，分类先行并宣告、审批不缩放、分类不得作逃逸口"骨架；我们的差异化（Spectra 影响面 grounding、brainstorm.md 一键转 feature）叠在 architectural 路径；立项文案按 §2-6 去 overclaim。
- **P1-M Spec Drift adoption 研究 → rename-follow**：先回答"为什么 `.specify/spec-drift.lock.json` 只有 3 个锚"（specs/** 可自动建锚比例、link 一条锚的实际步骤数），再决定 rename-follow / 全仓映射 / gap 分类的投入；Spec Drift 进 `spectra` CLI（P1-E 联动）。
- **P1-N Codex 运行时跟进**：Agent Plugins 1.0 spike（§2-3 事实核实前置；根 `plugin.json` + `mcp.json` dual-manifest；注意该模式排除 hooks 能力）；Codex rollout `.jsonl.zst`/分页格式翻转的 loud 诊断码 + tripwire（不写解析器）；`detect-codex-capability.mjs` 在 0.149 探测仍通过（已核）。

## 6. P2 / Defer / Reject

- **移交 M11**：可浏览 Wiki（对齐 OpenWiki Grounded Claims：claim sidecar + 证据版本 + 懒暴露 debt；锚用 symbol 指纹优先、行区间兜底的两级锚；CodeWiki 三类生成 bug 作反例清单）；KB 分级刷新与条件 rerank；goal_loop 扩面。
- **Defer（有触发条件）**：MCP 2026-07-28 / TS SDK v2 迁移——留 1.x legacy 线，触发条件：客户端开始要求无状态协议或 `server/discover`；Codex 侧用 `mcp_tool` hook 直调 Spectra 作证据通道 spike（P0-A 落地后）；外部 patch 级新鲜题池 pilot（SWE-rebench 20 题 × c1/c3，P1-H 之后）；Spectra 定向 orientation PreToolUse hook（graphify 0.9.19 形态：首次裸读重定向、at-most-once、fail-open、按目标文件陈旧度分级）——F206 实证 prompt 级强制会坍塌，须先有 P1-J 内核与 G0-4 基线再做 context-only 档位实测。
- **Reject**：自建增量图修复引擎（watcher 增量合并）；PR triage / `get_pr_impact` 类消费面与第三套记忆 overlay；OWL/SPARQL 本体层或 LLM 按需构图作为检索内核；在 Stop/PreToolUse 内用等待/重试读 transcript 规避滞后（官方口径：结构性缺席，重试无效）。

## 7. 架构待证伪候选池（43 条未证伪中的 warning 级；**立卡前必证伪**，不得直接照单开工）

`runBatch` 仍是 1,474 行单函数（F220 只外移 helper）；graph.json 三套装配配方（runBatch 内联 / buildAstGraphOnly / `spectra graph`）；`.spectra/unified-graph.json` 增量索引管线 ~1,575 行无消费者且 4 处恢复提示引向它；GeneratorRegistry 半门面（6/19 不经 registry）+ UnifiedGraph 全局单例；四套 LLM 调用 kernel、auth 路由实现两遍、三条 API-key-only 路径在订阅 OAuth 口径下结构性失效；6 个目录 walker + ≥8 份忽略目录字面量各自 spawn git；`query-helpers.ts` 放错层；generator 缓存快路径 `getDependencies` 零实现（每次三遍全仓 hash）；`parseArgs` 933 行；git 访问散落 6 模块。**提醒**：M9 曾把"core 回胖 1593 行"误判为负收益（74% 是注释），此池每条都要带行号证据和"拆了会不会再胖"的维度论证。

## 8. 人工验证与环境前置

- **本机版本落后**：Claude Code 2.1.215（最新 2.1.241，hooks 合同在 2.1.212/214/222/232 有变化）、Codex 0.144.6（最新 0.149.0）。升级后：Codex 杀 stale app-server（memory）；**F245 的 headless hook 基线在 2.1.241 重跑**；Stop hook payload 确认含 `background_tasks`/`last_assistant_message`。
- **T062 / T063**（M9 正式收官前置）改在 **Codex ≥0.149 且 P0-B 双注册守卫落地后**执行，并新增两项观察：linked worktree 信任校验（#39616）对 F239 managed worktree 是否触发新提示；受限环境下 `AGENTS.override.md` 是否可读（#39653，否则 turn setup 直接失败）。完成判据仍要求记录客户端版本号。
- 平台：CI 仅 ubuntu、hooks 全 .sh、README 无平台声明——M10 不承诺 Windows，但文档须明示；`npm audit` 纳入 release:check 前置。

## 9. 交付门禁与纪律

- **M10 收官判定**：G0-1..G0-4 全部完成 + P0 四卡 ship 并体检 + G0-4 两条基线数字在案；P1 按容量，P1-E/F/G/K 优先（它们是用户可见或门禁正确性），P1-J/L/M/N 其次。
- 门禁/判定器/安全类改动（P0-A、P0-B、P0-D、P1-K 部分）在 Codex 配额恢复前按 CLAUDE.local.md 暂停节走**异构对抗档位**并在 commit 标注。
- 图解析类改动（P0-C、P1-F、P1-I）验收必须带**外部语料 A/B 第二口径**（milestone-next SKILL §5，F263 教训）；一次性验证 dump 不入库只留重算器（3bf27a82 先例）。
- 每卡收尾 dogfooding 四维反馈 → ledger；milestone-next §2.5 统一流转。
- 不预占编号；派发时查远端分支与 specs/。

## 10. 派发顺序与写入路径矩阵

| 批次 | 卡 | 主要写入路径 | 并行性 |
|---|---|---|---|
| 1 | G0（发布+CI+自省+基线） | contracts/release-contract.yaml、CHANGELOG.md、.github/workflows/ci.yml、scripts/validate-release-contracts.mjs、src/mcp（自省）、plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs | 与 P0-B/C/D disjoint（doctor-core vs doctor-io 不同文件） |
| 1 | P0-B 双注册守卫 + 路线切换 | plugins/spec-driver/scripts/codex-skills.sh、lib/codex-hooks-installer.mjs、validate-codex-hooks.mjs、lib/codex-hooks-schema.mjs、README Codex 节、skills-codex/** | 与 G0/P0-C/P0-D disjoint |
| 1 | P0-C fail-loud 链 + 诚实返回面 | src/knowledge-graph/module-derivation.ts、src/hooks/git-hook-installer.ts、src/cli/commands/graph-quality.ts、src/mcp/agent-context-tools.ts、README/cli-reference 三处文案 | 与 P0-D 同目录不同文件（git-hook-installer vs hook-installer） |
| 1 | P0-D atomic-write 群 | src/utils/atomic-write.ts + 5 消费方、src/hooks/hook-installer.ts、lib/codex-runtime-doctor-io.mjs | 与 G0 的 doctor-core 不同文件 |
| 2 | P0-A 门禁证据源换代 | fix-compliance-judge.mjs、lib/fix-compliance-core/io.mjs、hooks/hooks.json、hooks/*.sh、tests fixtures | **串行于 P0-B**（同碰 hooks.json/installer） |
| 3 | P1-E/F/G/K（小卡优先） | 见各卡 | 按路径矩阵再判 |

先 ship 先 push；后者 rebase 最新 master 重跑全量验证。

---

## 11. 进展账（rolling）

- **2026-08-30/31 批次 1 全部 ship**：G0=F265（4.5.0 **已 npm 发布**、CI 接 repo:check/release:check、doctor/MCP commit 自省、度量基线尺子）+ 追加 2ad22eb3（CI 治理两步解除 Test 连坐）；P0-B=F264（双注册守卫 + 插件自带 hooks 为主；判据三轮异构对抗推翻重写两次）；P0-C=F266（空图 fail-loud 链 + MCP 三态诚实返回面，三轮异构九 CRITICAL 全闭环）；P0-D=F267（atomic-write 群；对抗抓到"软链跟随=写穿任意路径"新破坏面，能力改 opt-in）；CI 收尾 F268（真实 spectra 两级解析回退）+ F269（birpc 假红收敛，**仓史首次 CI 全绿**，master 连续 success）。
- **2026-08-31 milestone-next 体检**：vitest 7894/0、test:plugins 0、repo:check 0、release:check 0（publish-gap 报 indeterminate=fail-loud 正常，npm registry 缺 gitHead）；npm 4.5.0 已可安装；F264-c "scripts 层不在图"经主线程证伪（422 节点在图，当时零节点=旧 4.4.0 全局 MCP，发布断层症状；hooks/*.sh 无解析器不在图记能力边界）。账本 15 条全部流转（4 修复进模板 / 7 进 P1-K / 1 进 P0-A 必答 / 其余已修复或分流）。
- **批次 2（2026-08-31 派发）**：F270=P0-A 门禁证据源换代 ∥ F271=P1-E 产品表面清扫 ∥ F272=P1-G 测试资产清淤；P1-K 等 P0-A 落地（避免同碰 SKILL/judge）；P1-F 下批。
- **G0-4 两基线**：下轮（≈09-06，发布满一周）跑 adoption census + F241 冻结口径复测。
- **T062/T063**：等用户升级 Codex ≥0.149 后执行（P0-B 已落地，前置齐了）。
