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
- **T062 已执行（2026-08-31，codex 0.151.0）→ FAIL，派生 F275**〔doctor hook-trust 对插件主路径假阴性 + 「脚本内容哈希」spec 假设被证伪 + remediation 回填；诊断类，异构对抗档位；ship 后 SC-013 复测绿才闭合 A4〕；**T063 未完成**（报告空文件，需重做）。原前置已满足（Codex ≥0.149、P0-B 守卫已实测拦截）。原文：T062 / T063（M9 正式收官前置）改在 **Codex ≥0.149 且 P0-B 双注册守卫落地后**执行，并新增两项观察：linked worktree 信任校验（#39616）对 F239 managed worktree 是否触发新提示；受限环境下 `AGENTS.override.md` 是否可读（#39653，否则 turn setup 直接失败）。完成判据仍要求记录客户端版本号。
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

**2026-09-13（/goal 全量推进：M10 批次 3 门禁串行链收官 F280–F289 自执行 + 自验 + push）**：
- **批次 3 全 ship（F280–F289 均在 master）**：F280（9362f1a8）/ F281（9f08e128）/ F282（7615c82a）为批次 3 并行卡、本 session 前已交付；**本 session 主线程逐卡执行并推送**（实现 → 红先行 → 异构对抗 ≥2 角 → verify 子代理 → 全量门禁 → rebase → ff push）的为：F283（93b49956 hooks 归属表派生化 + 判据钉住）、F287（9df869e9 卡 A 门禁链头：诊断码 canonical 表 + G3/G4 + isInvokedDirectly）、F285（592f2b73 发布/CI 门补齐）+ F285b（6b595a04 coverage birpc 假红处置）、F284（a18cec22 采集面 SSoT 忽略目录 + 护栏三面）、F286（b9a4aa92 P1-K 移交承接：导出可达性检查）、**F288（c63d44ba 卡 B：状态文件锁 + 计数幂等 + 指纹路由半边 + 放行佐证）**、**F289（7e53c3fc 续做/旁链入口卡：Tier 2 续做合同）**。
- **门禁串行链闭合**：F287 卡 A → F288 卡 B → F289 续做/旁链入口，三卡串行交付，P0-A 门禁证据源换代残余全部收口。
- **异构对抗（Codex 暂停·档位缺席）实证再累积**：F288 两路 2C（同一缺陷两角：420 assistant-entry 放行腿被判方自产 = 0 往返绕过；同时冻结快照下「上界 420」为假）+ 8W；F289 spec 两路 3C×2（收敛为锚点坍缩 / sidechain 信任反转 / (b) 合同漂移 / 项目闸缺失四类定义层缺陷）——**均为同构审查结构性漏判类**（自产放行腿、-1 锚点坍缩、父 prompt 引用诱饵，跑一次才现形）。
- **本批最重教训**：(1) **F278「防线照错方向搭」再现**——F257 把「≥420 ⇒ 不再推迟」（fail-closed）在 F288 被接成「≥420 ⇒ 放行」（fail-open），同一常量方向反转；(2) **单锚点坍缩病根**（F257/F270 十轮修的正是它）在 F289 重现——证据窗口（要宽）与佐证/闸门（要 fail-closed）被塞进同一个 -1 锚点；(3) sidechain 首条 user 文本是**父编排器写**的，按 harness 采信 = 信任模型反转（isMeta 判据收口）；(4) **真实语料证伪纸面覆盖**——(a) resume 源 0 命中、(c) sidechain 唯一命中是诱饵，登记为前向占位而非已生效能力。
- **门禁基线**（F288 rebased 8e06f838）：build 0 / vitest 8248/0 / test:plugins 1912/0 / repo:check warn（publish-gap indeterminate=既有）/ release:check valid。
- **M11 债务追加**：F288 R-6（harness 不回灌环境阻断到底、逃生口 enforcement:warn）、stop_hook_active 第三佐证腿（曾 F270 P3 判死需重裁决）、enum→产出点反向守卫、F289 W-2（Tier 2 阻断可见性 = 绑定原因首行）、K-5（主 Stop/SubagentStop projectRoot 同源 worktree 未测）、K-6（标记无 TTL/sweep + 同项目他会话植标记 DoS）、resume skill 补 fix 恢复（(a) 源前向依赖）、检测侧闭包 doctor 覆盖（JUDGE_FILE_SET 不含 SubagentStop CLI）。
- **dogfooding**：对抗审查应冻结 commit 作基线（F289 spec 审查在 rebase 中途 + 实现并发漂移的树上进行，"实现只作对照"基线漂移）——append 账本。

**2026-09-12（/goal 全量推进：体检 + G0-4 两基线 + M9 正式收官 + 架构审查）**：
- **master 增量**（09-01 → 09-12）：F276-C（P0-A 残余卡 C：`!saved.ok` 反转 fail-closed + 反馈计数上界；routeNonBlock 死代码 −127 行；卡 A/B 输入在 `specs/276-…/handoff/`）、**F278**（诚实工具面四小补）、**F279**（护栏比较器 kind/label + metadata 递归 + graph.graph 四维收口）、**F277**（引擎硬化，**部分交付**：68 FR = 已实现 50 / 已核验 10 / 移交 4〔FR-010~013 审查 agent 写盘/证据契约〕/ 缺席 1〔FR-018〕/ 字面违反 2〔FR-037 两处仓内相对 import 非 `node:` 前缀、FR-040 AGENTS.md +704B 仍在预算内——均非缺陷是判据措辞〕/ 裁剪 1；合并律 fail **如实登记**而非按未裁剪口径报达成——F270 教训已生效）。
- **门禁基线**：build 0 / lint 0 / test:plugins 0 / repo:check 0 / release:check 0 / vitest **8178 passed · 1 failed**——唯一失败 = `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`「CODEX_HOME unset → 默认 ~/.codex」场景：断言 spectra MCP `command==='spectra'` 得 `node`，姊妹场景（自定义 CODEX_HOME）通过。**归因：环境耦合非回归**（F281 verify 校正早期归因）——该场景把开发者**真实 `~/.codex` 当默认家目录**执行 marketplace add / plugin add / 清理；`command` 得 `node` 的直接来源是 cwd=仓根时机器专属、未跟踪的项目级 `.codex/config.toml`（`[mcp_servers.spectra] command="node"`，Codex 只对真家目录登记为 trusted 的项目加载），**不是**用户级配置里的其它 server；且在真实 home 上做 mutation 本身是安全隐患（本次清理链已确认零残留）→ 立小卡「F213 e2e 真实 home 隔离」（见 §12），F281 已修：临时 HOME + cwd 独立。
- **G0-4a adoption census**（尺子 `scripts/adoption-census.mjs`，只读扫描 1003 Claude + 1331 Codex transcript）：Spectra 工具调用 **42 次 / 全部历史**（impact 33 · context 8 · graph_god_nodes 1），**17 工具 14 个零调用**（含整条"典型链路"detect_changes→view_file 从未跑过）；非 Spectra 的 232 次 MCP 调用落 unknown 桶（ccd_session/perplexity/playwright，命名空间匹配已核对无误）。⚠️ 与 08-23 交界审查的 ad-hoc 数字（70 次/月，impact 58）**口径不同不可比**（ad-hoc 含子代理逐行 grep）；census 读数作为 M10 adoption 基线，两者差异登记为尺子校准项。
- **G0-4b 图质量复测**（冻结协议 `docs/design/f265-graph-quality-rerun-plan.md` §2.2，builder == HEAD 37b1f814，语料 SHA 钉死，输出含 `baseline{repo,commit,scope}` 溯源）：

  | 语料 | 原始读数（冻结口径） | 归一化对照（scratchpad 副本，`Class.method`→method） | 图规模 |
  |---|---|---|---|
  | GORM (Go) | precision **0.496** / recall **0.273**（63/127/231） | precision **0.587** / recall **0.307**（71/121/231） | 1717 节点 / 1753 边 / 192 calls |
  | HikariCP (Java) | precision **0** / recall **0**（0/31/819） | precision **1.0** / recall **0.034**（28/28/819） | 1269 节点 / 1211 边 / 53 calls |

  **→ F282 已修尺子并重取读数；对抗复审（1C+3W+5I，代码层 0 真 bug）证伪了「GORM 0.587 可作收官对照组」：协议口径 scope 错位（图全仓建 / truth 只扫顶层 13 文件）→ precision = 100% 与随机数按子包边占比的加权平均，图越好读数越低；且 label-only 尺子在口径一致时 precision 结构性 ≈1.0（5/5 语料恰为 1.000），只有 recall 轴有信息量。M10 收官对照组改为口径一致 recall：GORM 0.184（121/658）、HikariCP 0.034（28/819；可达上界 0.085 = 28/329，truth 含 JDK/外部）。** 口径缺陷 1–3 + 分母 / 尺子换代说明已按协议只追加进计划文档（`f265-graph-quality-rerun-plan.md`）；修前读数保留作证据、不再引用。**实质信号**：Java 调用边 recall 3.4%（可达上界 8.5%）——P1-F 多语言 parity 缺口不是纸面推测，且一部分在符号抽取层（图缺 private 方法节点）；GORM recall 受"外部边界"（reflect/内建）结构性压制，正是 P0-C「诚实的零」三分的外部边界项；Py/TS 读数随尺子换代位移（micrograd 0.75→1.0 等），F151 阈值与 graphify anchor 与新尺子不可比。M-1/M-3 人工协议未执行（需人工）。symbol 级尺子 + Go 同名不同 receiver 合并节点 → M11 债务清单（§12.4）。
- **🏁 M9 正式收官**：T063 第二轮两层 PASS + 版本号从本机 Info.plist 读取回填（ChatGPT.app 26.908.40834 / Codex Desktop 0.151.0），T039 勾选，M9 文档 status→closed。
- **账本**：F279 ×5 + F278 ×5 全部流转（3 分流 F277 移交卡 / 1 新卡「scripts/tests 类型门禁」/ 1 分流 P1-F / 其余记录为 P0-C 收官证据）——按推荐项处置，可翻案。
- **架构整洁 / 坏味道审查**：三路异构子代理并行（src / spec-driver / 测试+CI，合计约 119 万 token），结论与债务清单见 **§12**；主线程复核三条最重发现全部成立。

**2026-09-01（批次 2 体检 + 账本 20 条流转 + 发版链）**：
- **F270（P0-A）部分交付 + 诚实更正**：账本主链落地（PostToolUse 采集器 / 判定器接账本 / `background_tasks` 在途三态 / 锚点三分修病根 iv / agent_id 归属 / US5 零落盘闸门 / 审计留痕 / 分发登记）；集成态审查（六 Phase 全 commit 后补做，五路异构三轮）再收 4 处 fail-open；**SC 诚实口径 6 真达成 / 4 部分 / 5 未达成**（vs 曾声称 13/15）。**病根 iii（GATE 暂停误判）原样存活、病根 v（状态竞态）零实现且被账本并发面加重、PENDING/长异步与 snapshot-stale 专码未做——全部移交 F276**。结构性教训入 F277：范围在 plan 阶段静默收缩且无对账点，是全部 over-claim 的根源。
- **F275 ✅ 活体验证**：本机 doctor hook-trust 三态正确（`app-server-hooks-list:found`，untrusted → warning + grant-hook-trust 实测文案）；SC-013 第 3 段 PENDING-user（本机 5 hook 待授信）。
- **发版链**：spec-driver 4.4.3 → **4.5.0**（f5a8a475）——本机门禁快照停旧判定器（judge:doctor 4 mismatch + 4 missing），F270/F275 生效需 publish + `claude plugin update`（用户动作）。
- **门禁串行序（用户拍板）**：F276（P0-A 残余：病根 iii + v + PENDING/in-flight〔含 F275② 等后台审查被 block〕+ snapshot-stale + routeNonBlock 死代码处置）→ 续做/旁链入口卡（设计已定稿 `docs/design/fix-compliance-continuation-binding-design.md`，F276 ship 后取号启动）。
- **账本 20 条全流转**：8 项 → **F277 引擎硬化**（头号：plan「FR→Phase」覆盖矩阵 + 裁剪登记；GATE 对抗收敛循环；反向普查标准产物；落盘纪律/时长分流；「随 Phase N 落」显式任务 + 生产可达性检查；verified-facts 附原文；数字换算式）；4 项 → **F278 诚实工具面小补**（impact 新符号 hint / 护栏 metadata-key 档 / --init 再生审计 / judge:doctor 增量漂移视图）；**异构对抗升常设档位**（SKILL §5 + CLAUDE.local.md + memory）；其余记录（值级数据流缺口 ×3 再现 + MCP 适用边界 → P1-J 定位参考；provenance 再现 → 审计面计数）。
- 门禁基线：vitest **8033/0** / plugins 0 / repo:check 0 / release:check 0。**G0-4 两基线（adoption census + F241 冻结口径复测）≈ 09-06 到期，下轮跑**。

- **2026-08-30/31 批次 1 全部 ship**：G0=F265（4.5.0 **已 npm 发布**、CI 接 repo:check/release:check、doctor/MCP commit 自省、度量基线尺子）+ 追加 2ad22eb3（CI 治理两步解除 Test 连坐）；P0-B=F264（双注册守卫 + 插件自带 hooks 为主；判据三轮异构对抗推翻重写两次）；P0-C=F266（空图 fail-loud 链 + MCP 三态诚实返回面，三轮异构九 CRITICAL 全闭环）；P0-D=F267（atomic-write 群；对抗抓到"软链跟随=写穿任意路径"新破坏面，能力改 opt-in）；CI 收尾 F268（真实 spectra 两级解析回退）+ F269（birpc 假红收敛，**仓史首次 CI 全绿**，master 连续 success）。
- **2026-08-31 milestone-next 体检**：vitest 7894/0、test:plugins 0、repo:check 0、release:check 0（publish-gap 报 indeterminate=fail-loud 正常，npm registry 缺 gitHead）；npm 4.5.0 已可安装；F264-c "scripts 层不在图"经主线程证伪（422 节点在图，当时零节点=旧 4.4.0 全局 MCP，发布断层症状；hooks/*.sh 无解析器不在图记能力边界）。账本 15 条全部流转（4 修复进模板 / 7 进 P1-K / 1 进 P0-A 必答 / 其余已修复或分流）。
- **批次 2（2026-08-31 派发）**：F270=P0-A 门禁证据源换代 ∥ F271=P1-E 产品表面清扫 ∥ F272=P1-G 测试资产清淤；P1-K 等 P0-A 落地（避免同碰 SKILL/judge）；P1-F 下批。
- **G0-4 两基线**：下轮（≈09-06，发布满一周）跑 adoption census + F241 冻结口径复测。
- **T062/T063**：等用户升级 Codex ≥0.149 后执行（P0-B 已落地，前置齐了）。

## 12. 架构整洁与坏味道审查结论（2026-09-12，三路异构子代理 + 主线程复核）

> 只读审查，全部证据带 file:line；主线程亲自复核 src C-1、spec-driver W-1/W-2（均成立）。08-23 交界审查留下的「待证伪池」10 条本次逐条给 verdict。本节是批次 3 各卡的 SSoT，prompt 只做薄指针。

### 12.1 src/（Spectra）— 1 critical + 15 warning，根因六条

| 根因 | 现象（file:line 见子代理报告，此处摘要） |
|---|---|
| **R1 编排体无"阶段"一等概念** | `runBatch` 1474 行单函数（`batch-orchestrator.ts:298–1771`，F220 只外移 6 个取数 helper）；graph.json **三套装配配方**（runBatch 内联 / `buildAstGraphOnly` / `spectra graph` 降级品 sourceCommit=null）且 5 处提示引导用户跑降级品；`parseArgs` 934 行；MCP 与 CLI 两个 batch 入口各拼 option，走 MCP 丢 outputDir/excludeDirs 等 5 字段且不过 authGate |
| **R2 事实源落在消费层** | 忽略目录 12 份字面量，`ignore-oracle.ts:107` 手抄一份 `source-discovery.ts:237/398` 已导出的常量，守卫只断言 `producer ⊆ oracle` 单向（生产者移除目录时 fail-open）——F254/F255/F258/F259 反复踩的同一片区 |
| **R3 横切能力无宿主层** | LLM 调用 kernel ≥6 处、auth 三路分发写两遍（`llm-client.ts:305` / `llm-facade.ts:50`）、4 处裸 `new Anthropic` 只认 API key（订阅口径下结构性不可用）、**1055 行 mapreduce 生产不可达**（`--enable-adr` 帮助文案仍写"v4.0.1 临时禁用"）；git 访问散落 7 模块 3 私有 runner、全仓无 `killSignal`（F268 纪律未传播，`source-commit.ts` 在 MCP 热路径无 timeout）；原子写 4 份（F267 只修 1）；深比较器 3 家 2 份逐字副本 |
| **R4 模块级可变单例 + 测试 reset 钩子** | 🔴 **C-1**：`panoramic/qa/index.ts:39` engineCache 无任何失效判据，`clearEngineCache` 生产零调用；MCP 同进程 `batch` 重建图后 `panoramic-query` **永远拿旧图**，且该工具不经 `runAgentContextTool`——F266 诚实返回面在此双重缺席。同根因：UnifiedGraph 进程级全局 + 12 个仅供测试的 reset 出口 |
| **R5 注册表/开关是名义上的** | GeneratorRegistry 19 注册仅 12 经派发（6 adapter 走裸函数 + `query.ts` 第 4 条路径）；`spectra index` 产物 `.spectra/unified-graph.json` 在 src 内零读者（`incremental.ts` 实为 589 行非 1575，有 1 消费者——池子该条**部分误报**）；`getDependencies` 零实现，每 generator 全仓 walk ×2 + hash ×1 |
| **R6 层级方向未定义** | 8 对跨目录依赖成环（logger 只在 panoramic、graph-types 反向依赖、utils→adapters、mcp→batch 内部）；`query-helpers.ts` 放错层；graph-quality ~900 行判定逻辑住在 CLI 文件里，MCP 侧只能另写 `isModuleNode` |

**待证伪池 verdict**：#1/#2/#4/#5/#7/#9/#10 成立（#4 数字 7/19、#5 ≥6 套、#10 7 模块）、#8 成立（"三遍"应为 2 walk+1 hash）、#3 部分误报（真问题是 index 产物零读者）、#6 一半（12 份字面量成立；"walker 各自 spawn git"误报）。正面结论：F266 返回面结构清晰未重复 graph-quality 判据；F267 opt-in 形态干净；F274 指纹不构成"第 N 套比较器"；两个 import-resolver 已按 F181 收口非待修。另：MCP 实际注册 **18** 个工具（`server.ts:3`），M10 §0 写的 17 为旧数。

### 12.2 plugins/spec-driver — 0 critical + 7 warning，根因三条

| 根因 | 现象 |
|---|---|
| **R1 局部副本 + 形态匹配式收敛** | 入口守卫 **8 处手写**（含判定器 `fix-compliance-judge.mjs:1228` 单侧 realpath 无 try → 理论 fail-open；`extract-wrapper-body.mjs:135` / `detect-codex-capability.mjs:189` `catch→false` 静默不执行——`codex-skills.sh:163/191` 两处 CRITICAL-1 补丁正是其症状），memory「F247 全仓唯一守卫实现」与实况不符；`classifyErrorClass`×3、`isPlainObject`×4、`DELEGATION_TOOL_NAMES`×3（core/writer/reader 各一份，core↔reader 无守卫）、文档注入引擎 ×3、参数解析器 ×9 |
| **R2 诊断族无共享结果模型** | 6 个 doctor/validator CLI 各自词表/退出码/解析器/渲染器：同一退出码 `1` 有 4 种含义、`2` 有 3 种；`judge-snapshot-doctor` 唯一无 JSON 通道；两份泛型 `parseFlags` 布尔哨兵类型不同（`'true'` vs `true`，F258 在 graph-consumption 修过的 `Number(true)` 隐患在 graph-bootstrap-status 未同步核查） |
| **R3 九轮对抗审计内嵌为注释、合同滞后实现** | 闭包 10 文件 5382 行、core 注释占 60.4%；`tool_use_id→tool_result` **三套配对索引**（窗口/角色/聚合三开关各自手写）；双 tokenizer（`parseRenameOperands` 用 `trim()/\s` 违反自述纪律，实为冗余第二道）；`evaluate()` 358 行编排层承载改判定的磁盘逻辑；审计 schema 保留 4 个零产出点枚举（F276-C 删的 nonblock 路由）；`buildAuditEvent`/`tryAppendFailOpenEvent` 各拼一份 11 字段字面量 |

**W-2（主线程复核成立）**：canonical `hooks.json` 新增未登记脚本会穿过 generator（`codex-hooks-generator.mjs:148–176` 第二循环只封 Claude-only 一侧）与两层门禁装进用户 `$CODEX_HOME/hooks.json`，`isOwnedEntry=false` ⇒ `--remove` 不回收、`validate --baseline` 当第三方数据保全——「守卫抓删不抓加」（F270 教训）在分发链未应用。**测试资产**：判定器主路径唯一真实 transcript 端到端用例硬编码本机 worktree slug，CI 恒 skip；F270「真实录制」只覆盖 3 个叶函数；8 处长度钉死断言。正面：F277 共享块 24 份副本 sha256 与模板逐一相等，SKILL↔脚本抽检 3 处无漂移。

### 12.3 测试守护资产 + CI — 0 critical + 7 warning（21 组变异实验）

- **W-1 类型检查结构性零覆盖量化**：`tsconfig` include 仅 src ⇒ tests 553 + src 测试 13 + scripts 3 个 `.ts` 与 242 个 `.mjs` 零类型门；临时 tsconfig 实跑 **543 处真实类型错误 / 117 文件**（`src/` 非测试 0 处）。
- **W-2 F249 双轨护栏对边属性零检测**（真实 builder 变异：边 confidence 改值 → 护栏 52/52 全绿，而 F272 pinned 深比较 4 红、F220 charter 8 红）——F279 Out-of-Scope #1-#3 未立卡。
- **W-3 门禁判据零钉住**：`fix-compliance-core.mjs:297` 操作数 `!== 2` 改 `< 2` → 829 用例零红（方向：跟随保真度非绕过）。
- W-4 零断言用例 `watch-command.test.ts:229`（9090 块中唯一真阳性）；W-5 `graph-mcp-snapshot` fixture 用不合法 kind/sources、Layer B 承诺未兑现；W-6 `prepublishOnly` 缺 `test:plugins`（1840 用例）与 `typecheck:tests`；W-7 coverage 阈值无任何门禁执行。
- INFO：7 处单点守护（变异只 1 红）；`repo-maintenance-sync-check` 主测试对 never-fail 零红；CI Test 步 13m07s（>10s 的 13 文件占累计 58.6%）；mjs gate 二跑；`claude-review.yml` 5 连败失效；Python pinned 在 CI 恒 unverifiable；perf anchor 停 4.3.0 且无自动消费者；**本地 pre-commit 的 graph-quality 结论建立在陈旧图上**（"只可见不判定"在开发机上=长期无人刷新，P0-C 收官时须裁决）。
- 预存 flaky 6 条 ×3 隔离重跑全部不可复现（18 核开发机），维持"满载/CI 条件下 flaky"口径；无新 flaky。
- **补交（串行全量）**：CI 同款 `VITEST_MAX_FORKS=1` 在干净 clone 上 8206 用例 **0 失败 / 414s**（并行 74s；用例累计 347s vs 并行 529s，并行争抢膨胀 35%）；预存 flaky 6 条在「隔离 ×3 / 并行全量 / 串行全量」三种条件下全部 0 失败。**旁证 F281 根因**：干净 clone 不含未跟踪的 `.codex/config.toml`，F213 e2e 在那里通过——主仓失败确由该项目级配置引起。CI 13m 主要是 4 vCPU runner 串行化，非测试失控；串行下最慢 5 文件占墙钟 31%（慢测试收敛卡收益依据）。

### 12.4 处置：批次 3 派发 + M10 尾 + M11 移交

**批次 3（2026-09-12 派发，编号已查空闲，写入路径 disjoint 可并行；门禁链串行）**：

| 卡 | 类型 | 内容 | 来源 |
|---|---|---|---|
| **F280** | fix · small · **critical** | `panoramic-query` 引擎缓存按 mtime+size 失效（复用 `graph-tools.ts:59–66` 判据）+ 接 F266 诚实 envelope | 12.1 C-1 |
| **F281** | fix · small · 安全 | F213 e2e「默认 ~/.codex」场景隔离：禁止对真实 home mutate、cwd 项目级 `.codex/config.toml` 不得影响断言；`.codex/config.toml` 入 gitignore（含机器绝对路径） | 批次 3 体检 |
| **F282** | fix · small | G0-4 尺子：`graph-accuracy.mjs normalizeName` 显式支持 `Class.method`；census 与 08-23 ad-hoc 口径差异核对；修完按协议重取原始读数作 M10 收官对照组 | §11 09-12 口径缺陷 |
| **F283** | fix · small · **门禁类** | Codex hooks 归属表派生化（generator 对非 owned∪claude-only handler fail-loud + 两表键集相等守卫）+ `DELEGATION_TOOL_NAMES` 单源 + `parseRenameOperands` 变异钉住矩阵 | 12.2 W-2 / 12.3 W-3 |
| **F284** | fix · small | 采集面 SSoT 扩到忽略目录（`collector-surface.ts` per-pipeline ignoreDirs，消费方改引用，守卫双向）+ F249 护栏补边属性/节点顶层/hyperedges 三面 | 12.1 W-5 / 12.3 W-2 |
| **F285** | story · small | 发布/CI 门补齐：`prepublishOnly` 加 `test:plugins` + `typecheck:tests`；coverage 阈值接 CI 或删并改 F150/F171 口径；`tsconfig.tests.json` 进 CI 只报不阻断；mjs gate 二跑清理；`claude-review.yml` 删/修 | 12.3 W-1/W-6/W-7 |
| **F286** | story · medium | P1-K/F277 移交承接：FR-010~013（审查 agent 写盘/证据契约、预跑注入证据包）+ 账本分流的「向后兼容类 SC 验证模板」「产出型子代理先 Write 主制品」等 | F277 verification-report + ledger |
| **F287** | fix · medium · **门禁类·串行链头** | P0-A 残余卡 A：G0 诊断码 canonical 表 + userFacing 白名单 / G3 PENDING / G4 snapshot-stale + **K-1 入口守卫收敛为 `isInvokedDirectly`**（同文件顺手） | specs/276 handoff + 12.2 W-1 |

门禁串行链：**F287（卡 A）→ 卡 B（G1 锁 + 计数幂等 + G2 路由半边，取号待 A ship）→ 续做/旁链入口卡**。F283 与 F287 主要文件 disjoint（generator/schema vs judge/io），先 ship 先 push。

**M10 尾（P1 既有轨道，按容量）**：P1-F 多语言 parity（Java 调用边 recall 3.4% 实锤 + `.mjs` 顶层具名导出 symbol 缺席待判）、P1-H 评测前置、P1-I 诚实工具面（tokenBudget / 确定性回归）、P1-J 检索内核 v1 + ARB 基准、P1-L brainstorm、P1-M Spec Drift adoption、P1-N Codex 运行时跟进。

**M11 移交（架构还债，立卡前按本节证据复核，不照单开工）**：共享 git runner（timeout+SIGKILL）；graph.json 单一装配函数 + `spectra graph` 裁决；LLM 调用面收敛 + mapreduce 1055 行接通或删；`spectra index` 产品面裁决；MCP/CLI batch option resolver 共用；原子写收编 3 处；深比较器合一；GeneratorRegistry 二选一；logger/graph-types 下沉 + query-helpers 归位 + graph-quality 判定逻辑下沉；getDependencies 实现或删；parseArgs 拆表；runBatch 真·分阶段（large）；spec-driver 诊断结果模型 `diagnostic-cli.mjs`；审计事件合同清扫；判定器主路径真实语料入库 + 长度钉死断言清理；回执索引抽象；文档注入引擎合一；小清扫（JSDoc/`--format` 双解析/SKILLS 单源/runId 同源/dev spike 移出）；慢测试收敛（CI 13m）；graph-mcp-snapshot 资产更新；零守护用例清理 + F272 A 类 64 条；perf anchor 重采 + 自动消费者；symbol 级 graph-accuracy 尺子（source×target；label-only 尺子 precision 在口径一致时结构性 ≈1.0，F282 复审缺陷 3）+ Go 同名不同 receiver 方法合并单节点（`callbacks.go::Register` lineRange {182,232}，F282 复审 I-4）。

**批次 3 收官追加（2026-09-13，F288/F289 门禁链残余）**：门禁串行链 **F287 卡 A → F288 卡 B → F289 续做/旁链入口卡全部 ship**，P0-A 门禁证据源换代残余收口。M11 新增债务（本批异构对抗 + verify 登记）：
- **fix-compliance 阻断预算 per-target 化**（F289 delta 复审 CRITICAL）：`blockCount`/降级状态现按 session 持久，同会话 Fix-A 付满 2 次阻断后新目标 Fix-B 可 per-session 复用 0 往返放行；根治需改 F288 状态键 `<sid>`→`<sid>+dir`（曾试「佐证锚逐目标前移」被证会误伤同目标合法重复编辑成永久 fail-closed，已还原）。**独立立卡，禁在已交付安全门上同 session 叠改**。
- **F288 R-6**：删 420 assistant-entry 放行腿后，harness 不回灌反馈的环境（Codex 方言 / 某些 headless）预算耗尽后阻断到底，逃生口仅 `enforcement: warn`；候选恢复机制 `stop_hook_active` 第三佐证腿（曾 F270 P3 判死，需重裁决）。
- **F288 锁竞态 trace 注入用例**（verify W1/W2）：M1-b（link vs open+write）/ M1-c（接管身份核对）微秒级竞态无生产侧 trace 注入的确定性回归用例（T1-C5 已补陈旧锁并发地板）。
- **F289 sidechain 无提名不覆盖**（残余 10）：子代理展开 fix 但无处定位目录 ⇒ 不绑定、门禁不覆盖（与 resume 无提名对称，诚实上限）。
- **F289 Tier 2 可观测性**：F224 fail-open 早退事件不带 `tier`；Tier 2 阻断 stderr 未告知绑定原因（W-2）。
- **enum→产出点反向守卫**（F288）；`JUDGE_FILE_SET` 纳入 SubagentStop CLI 检测侧闭包（F289）；resume skill 补 fix 恢复逻辑（F289 (a) 源前向依赖，现 0 真实语料命中）。
- **dogfooding**：对抗审查应冻结 commit 作基线（F289 spec 审查在 rebase 中途 + 实现并发漂移的移动靶上进行）。

