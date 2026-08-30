# Dogfooding 反馈账本

> 每个需求收尾时，交付报告的「工具使用反馈」节除写在 chat 外，**同步 append 一条到本文件**
> （反馈为"无"则不落账）。`milestone-next` 循环的 §2.5 统一 review 待处理条目、聚类、
> 设计改进计划并回用户拍板；拍板后由 milestone-next 更新条目状态。
>
> 事实源关系：反馈约定的 SSoT 在 `docs/shared/agent-dogfooding-policy.md`（同步进
> CLAUDE.md / AGENTS.md）；本文件只是**账本载体**，不定义约定本身。

## 条目格式

```markdown
### F<NNN> · YYYY-MM-DD
状态：待处理
来源：specs/<NNN>-*/（交付报告反馈节）
- [维度][工具] 问题一句话 + 关键证据；改进方向（如有）
```

- 维度取 dogfooding policy 四维度：`MCP 可用性` / `信息完整性` / `流程顺畅度` / `结果准确性`
- 状态枚举：`待处理` → `已分流 → F<NNN> / M<N> roadmap` / `裁决不做（理由一句话）` / `已修复 → F<NNN>`
- 同一问题被多个需求重复报告时**不去重**，在旧条目上追加 `再现：F<NNN>` —— 复现频次本身是排期信号

---

## 待处理

### F266 · 2026-08-30
状态：待处理
来源：specs/266-honest-graph-quality-gate/（交付报告反馈节）
- [结果准确性][Spectra MCP] 再现：F261 —— MCP context 对广泛被 import 的纯类型 symbol 返回
  不诚实零结果：F266 Phase 1 实施中实测 `context('quality-types.ts::GraphQualityReport')`
  返回 `callers: []`，nextStepHint 提示「无已知调用方，可能为顶层入口」，但该类型实际被 8+
  文件 import（F261 旧条目案例是 `writeKnowledgeGraph`，非同一 symbol，但症状同型：图 stale
  漏边 + 返回体无 freshness 信号 + nextStepHint 误导推论）。备注：该缺陷正是 F266 本卡（诚实
  图质量门）的修复对象——修复后同一查询已返回 boundary-exposed + coverage 缺口 + freshness
  dirty 三态区分，可作为既有分流项（M10 P0 卡③）的验收信号之一，留 milestone-next 裁决是否
  收窄/关闭该分流
- [MCP 可用性][Spectra MCP] 子代理会话中 Spectra MCP 工具不可用（新）——F266 的 specify 子代理
  实测调用 `mcp__plugin_spectra_spectra__context` 与 `mcp__spectra__context` 均返回 "No such
  tool available"，而 system-reminder 的 MCP server instructions 声明其可用，spec-driver 的
  5 个子代理 frontmatter 也已授权这些工具。影响：spec-driver 全链「工具优先使用规则」在子代理
  侧实际落空，各 phase 只能靠主线程注入事实兜底。改进方向：排查子代理运行时的 MCP 工具注入
  链路是否与主线程隔离（frontmatter 授权 ≠ 运行时可达）
- [信息完整性][Spectra 图产物] 本仓 live 图 linkageRatio 仅 3.1%（123767/126411 已探测调用点
  未成边，新）——F266 Phase 3 首次如实暴露该数字（非本卡引入，是长期存量）。含义：coverage-gap
  在本仓任何非导出 symbol 的零结果上恒成立、confirmed-zero 实际不可达；改进方向：M10 P1「边
  stage 标签」（producer 侧 call-site 归因持久化）应按该数量级重估优先级
- [流程顺畅度][Spec Driver] 跨语言外部语料选型验收前须先数目标扩展名文件数（新）——F266 plan
  Q8 纸面推演选了 nanoGPT 验证"非 src 布局告警"，实测其为纯 Python 项目（0 个 TS/JS 文件），
  而 FR-001 判据只对 TS/JS 生效，会跑出"看似通过实则测了另一件事"的假验收；已换 hono（284 个
  真实 .ts 文件）语料。改进方向：验收语料选型 checklist 增加"先用 `find`/`grep -c` 数目标扩展
  名文件数，确认判据适用范围覆盖该语料"一项

## 已处理

### F261 · 2026-08-09
状态：已处理（4 条：2 已分流 / 1 已修复 / 1 裁决不做）
来源：specs/261-fix-graph-builder-stamp-notes/（交付报告反馈节）
- [结果准确性][Spectra MCP] `impact(writeKnowledgeGraph, upstream)` 返回 `directCallers: 0` /
  `affected: []`，`context` 返回 `callers: []` 并提示"可能为顶层入口"——实际有 4 个生产调用方。
  根因是在盘图 stale，但**返回体没有任何新鲜度信号**，`callers: []` 与"真的没有调用方"不可区分，
  nextStepHint 还主动往错误推论上引。改进方向：MCP 返回体带 freshness 状态（F261 已把 builder
  这一维 provenance 落进图产物，缺的是接到 MCP 返回面），stale 时对空结果显式降级措辞
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → **M10 P0 卡③**「MCP impact/context 返回面接入图新鲜度状态」（builder 戳 F261 已落图，只差返回面）
- [流程顺畅度][Spec Driver] 子代理无 git 写权限 + plan/spec 只读的组合，导致"主线程裁决推翻了
  plan 口径"只能记在 implementation-notes 偏差节里，plan.md 与实现持续背离（F261 第三/四轮
  D1-D6 裁决实证）。改进方向：给 fix/feature 流程补"裁决回写 plan（就地批注、保留原文）"的显式步骤
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → M10 roadmap「引擎硬化」轨道：fix/feature 流程补"主线程裁决回写 plan（就地批注、保留原文）"显式步骤
- [流程顺畅度][审查派发] 对抗审查子代理默认在主 worktree 做变异测试，与主线程抢文件（触发过
  "file modified on disk"）；主线程审查期间重建 dist 也让两路审查报告"移动靶"困扰。改进方向：
  把"变异/对抗实验必须在 /tmp 副本上做 + 派发前冻结改动面"升格为派发 prompt 模板硬约束
  （F261 第三轮起已在单个 prompt 里手工加此约束，实证有效，缺的是模板化）
  ↳ **处置（2026-08-23 milestone-next）**：已修复 → 737075e7 已把"/tmp 副本 + 冻结改动面"写入 milestone-next SKILL §5；本轮追加 stash/checkout 禁令
- [MCP 可用性][harness] 一路对抗审查中途 API 断连（`Connection closed mid-response`），换新代理
  带自包含 prompt 后正常完成。与 memory `feedback_resumed_subagent_api_error_recovery` 一致；
  F261 缺陷②（implement 每 Phase 落 notes）已缓解 implement 侧，审查类子代理的断连损失暂靠
  自包含 prompt 重派。低优先级：harness 层问题，应用侧已有工作缓解
  ↳ **处置（2026-08-23 milestone-next）**：裁决不做：harness 层问题（SDK 断连），应用侧 implement 每 Phase notes + 自包含 prompt 重派已缓解

### F260 · 2026-08-11
状态：已处理（2 条：1 已分流 / 1 记录）
来源：F260 假边面异构对抗审查（主线程派发的独立子代理，交付报告反馈节）
- [信息完整性][Spectra 图产物] 边 `confidence` 落盘为 `EXTRACTED/INFERRED/AMBIGUOUS` 三态，
  而 resolver 内部是 `high/medium/low`，两套词汇要靠 `confidence-mapper.ts` 反查才能对应；
  且边**无 provenance/stage 标记**——审查"哪些边是 F260 新分支产出"时无法从图直接区分
  （F260 边与 Stage 2/3 的 medium 边都塌成 INFERRED），逐边归因只能重跑流水线或读源码补齐。
  改进方向：图边可选带 `resolverStage` 类溯源字段，利于回归审计与逐边 diff 归因
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → M10 roadmap「可信活图审计面」：图边可选 `resolverStage`/provenance 溯源字段 + confidence 双词汇收敛（再现：F263）
- [MCP 可用性][Spectra MCP] 对抗审查场景未走 MCP 工具链——`impact`/`context` 是加工视图，
  证伪需要逐边裸数据，直读 `graph.json` + CLI graph-only（0.1s 建临时图、零认证）更合适。
  非缺陷，属工具定位记录：MCP 面向消费、裸图面向审计，两者互补
  ↳ **处置（2026-08-23 milestone-next）**：裁决不做：非缺陷，定位记录——MCP 面向消费、裸图 + CLI graph-only 面向审计，两者互补

### F263 · 2026-08-11
状态：已处理（2 条：1 已修复 / 1 并入 F260）
来源：specs/263-fix-receiver-shadowing-guard/（交付报告反馈节）
- [结果准确性][Spectra 图产物] 图解析类改动的验收锚点「本仓重建图 method 有 calls 入边数 = 238」
  存在**本仓语料盲区**：F263 三轮判据演进中该锚点始终为 238，但两轮对抗审查各自实测出真实缺陷
  （首版 `total===1` 误伤 TS 声明合并——外部语料 25.5% 的导出类命中该形态；第二版顶层判定
  又放行顶层重赋值假边）。根因是本仓自身不写这些语法形态，**锚点通过 ≠ 判据正确**。
  改进方向：图解析类改动的验收增加第二口径「外部语料抽样 A/B 差分」
  （node_modules 或既有 baseline projects），不单靠自用仓库指标不变
  ↳ **处置（2026-08-23 milestone-next）**：已修复 → 2026-08-23 milestone-next SKILL §5 新增硬约束：图解析/采集面类改动验收必须带"外部语料 A/B 差分"第二口径
- [信息完整性][Spectra 图产物] 再现：F260 —— 边无 provenance/stage 标记，
  逐边归因「哪条边是新分支产出」只能重跑流水线或读源码，本次三轮 A/B diff 均受此拖累
  ↳ **处置（2026-08-23 milestone-next）**：并入 F260 条目（同一改进候选，复现计数 +1 → 排期信号）

### F262 · 2026-08-13
状态：已处理（3 条：2 已分流 / 1 已修复+分流）
来源：specs/262-fix-codex-hooks-warnings/（fix 流程主线程实证 + 修复子代理交付报告反馈节）
- [流程顺畅][spec-driver fix-compliance] Stop hook 判定器在 Claude Agent SDK harness 下**结构性失明**：
  主 transcript 懒刷盘（实测滞后 25+ 分钟、停格在 38 行），判定器读到的快照里没有编排器已发生的
  mkdir/Write/委派 tool_use 证据 → 误报「未建立特性目录/缺少诊断报告」并 block（磁盘上两制品俱在；
  A/B 双 project-root 手动跑判定器同结论，排除根目录错配）。blockCount 到 2 后按 F256 有界降级放行，
  DoS 有界但每次 fix 会话结尾必吃 2 次假 block。改进方向：判定器磁盘侧兜底已有（候选历史），
  可考虑对「transcript 尾部时间戳明显早于当前时刻」的陈旧快照显式降级为 indeterminate 放行并记审计，
  而非按"证据缺失"判 block
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → **M10 P0 卡①**「fix-compliance 判定器对陈旧 transcript 快照的处置」——门禁类，须异构对抗档位；方向是"陈旧快照→indeterminate+审计"而非"证据缺失→block"，但任何放宽都是新绕过面（F256/F257 史），spec 阶段须给出被判方无法伪造"陈旧"的判据
- [流程顺畅][spec-driver 编排] 多代理共享同一 worktree 时两处摩擦：①修复子代理用 `git stash push`
  做受控 A/B 隔离，把并行代理的未提交实现一并卷走（即刻 pop + 逐字节 diff 确认恢复；F261 codex-rescue
  stash 教训在内部子代理上再现）——派发 prompt 须显式禁用 stash/checkout 类隔离手段，A/B 改用
  "复制副本→就地改→从副本还原"；②审查后修复轮的派活粒度（单 CRITICAL）与 tasks.md 任务粒度
  （整个 W 条目）不对齐，且共享树上"全量绿"验收对单代理不可达（他人红在途），验收口径应改为
  "目标文件组绿 + 受控 A/B 零 delta"
  ↳ **处置（2026-08-23 milestone-next）**：已修复 → 本轮 SKILL §5：禁 stash/checkout 隔离 + 共享树验收口径"目标文件组绿 + A/B 零 delta"；派活粒度不对齐 → 已分流 → M10 引擎硬化（task right-sizing 卡）
- 指针：本卡审查另产出一批**产品缺陷分流候选**（Claude 侧 hook-installer/atomic-write 问题群、
  doctor `.find` 首匹配漏诊、doctor-io 词法段抽 lexer），已详录于 fix-report「影响范围扫描 · 同源但分流」
  节，milestone 规划时从该处回收，不在本 ledger 重复展开
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → **M10 P0 卡②**「Claude 侧 atomic-write 缺陷群」：`src/utils/atomic-write.ts`（mode 保全 + 软链跟随 + tmp 随机名 + 失败清理）+ `src/hooks/hook-installer.ts`（chmod 0755 放宽 / .bak COPYFILE_EXCL / remove 备份）+ doctor-io `.find` 首匹配漏诊；详单见 specs/262 fix-report「同源但分流」


### F264 · 2026-08-24
状态：待处理（3 条）
来源：specs/264-fix-codex-hooks-distribution/（fix 流程主线程实证 + 对抗审查回收）
- [结果准确性][Spec Driver / spec-driver-fix] **fix 模式没有"前提证伪"环节，这是本卡根因所在的同类缺口**：
  F213 FR-006 与 F240 FR-011 都由一条**未经运行时验证的推断**（"Codex plugin manifest 无 hooks 字段"
  ⇒ "Codex 不读插件 hooks"）承重，两个 feature 的全部门禁（`validate-codex-hooks` /
  `codex-plugin-consistency` / repo:check）却只校验**我方磁盘产物之间的一致性**，没有任何一处去问
  "运行时实际注册了几条"。F240 的 `_grounding.md` 甚至已经记下 `hooks/list` 这条 RPC 是"探测入口"，
  但从未真正跑过。改进方向：spec/plan 阶段对"由推断（而非实测）得出的关键前提"强制显式登记，
  并在 verify 阶段要求至少一条**运行时口径**的验证命令（不是产物一致性口径）
- [流程顺畅][Spec Driver / 对抗审查档位] 异构对抗档位在本卡**再次抓到同构审查抓不到的东西**：
  实现子代理自审 + 全量单测 296 条全绿的前提下，切入角"绕过面"的独立代理用**完整生产 shell 链**
  实跑出一条真实双注册（symlink 快照绕过），且顺带指出该缺陷的根因是"从 doctor 抄判据时安全方向
  没跟着翻"——这类**方向性**错误恰恰是同构审查（与实现者共享同一心智模型）的结构盲区。
  另一价值点：审查方把 10 条看似互不相干的 WARNING 归因为同一个结构性错误（对等 AND ⇒ 判不出即放行），
  使修法从"逐条打补丁"变成"翻转判据方向"。建议把"要求审查方给出**归因**而非仅列现象"写进对抗审查 prompt 模板
- [返回信息够用][Spectra MCP] 本卡未调用 Spectra MCP：改动面是 shell 脚本 + `.mjs` 插件脚本 + Markdown，
  而知识图谱覆盖的是 `src/**` TypeScript。`plugins/spec-driver/scripts/**`（本仓 hooks / 门禁 / 分发链路的
  实际所在地，且是历史上最容易出静默失效的一层）在图里**没有节点**，`impact` / `context` 对它零可用性，
  只能退回 Grep + Read。这不是本次的偶发，是 F229/F230/F231/F245/F256/F257/F262 一整条门禁卡系的共同处境
### F267 · 2026-08-25
状态：待处理（3 条）
来源：specs/267-fix-atomic-write-defects/（fix 流程主线程实证 + 两角异构对抗审查回收）
- [结果准确][spec-driver 对抗审查档位] **修复本身引入的新破坏面，只有异构对抗抓得到，测试全绿抓不到**：
  本卡按卡面把「软链跟随」加进 `writeAtomicJson` 后，本卡相关单测全绿（143 个用例）、7 条点名缺陷全部修复，
  但对抗审查用受控 A/B + 真实 `git clone` 实证：跟随把「拆链」升级成「**写穿当前用户可写的任意路径**」
  （git 原生存储软链 mode 120000，克隆即落盘；第三方仓库自带 `specs/_meta/graph.json -> ~/.ssh/authorized_keys`
  跑一次 batch 即写穿），3 个我方产物消费方无任何 JSON 闸。**根因是卡面点名的修复动作本身在
  某些消费方上是净负**——"按卡面修完 + 测试绿"不蕴含"改动是安全的"。改进方向：安全相关卡的
  验收增加一条硬判据「逐消费方问：这个能力对**这个**消费方是收益还是攻击面」，能力默认 opt-in
  而非全局开启；卡面点名的修法在 spec 阶段就要过一遍"谁不该拿到这个能力"
- [流程顺畅][Claude Agent SDK 子代理] **长 transcript 子代理在本卡连续死亡 3 次**：并发面审查代理
  第一次 API 断连（机器休眠）、重启后第二次 watchdog 停滞 600s 判失败；权限面代理跑满 1890s /
  169k token 才交付。已完成实验的结论可回收（本卡即从死亡代理的 partial transcript 回收了 3 条
  确证结论并全部处置），但**代理死亡时其结论默认丢失**——需要主线程主动去读 partial 输出才捞得回来。
  改进方向：长跑对抗代理改为「分段交付」（每完成一个切入角就落盘一份 partial 报告到 specs/ 下），
  而非全程憋到最后一次性返回；主线程在代理死亡时应默认检查 partial 产出而非直接重启
- [信息完整性][spec-driver fix SKILL] fix 模式 Phase 4「轻量 vs 完整」路径判据只看**改动规模**
  （文件数/行数），不看**改动性质**。本卡若只改 `atomic-write.ts` 一处（<150 行、1 文件）就会判
  轻量路径、跳过 4a/4b 独立审查——而它恰恰是 security-adjacent、且实际引入了 CRITICAL 级破坏面。
  改进方向：路径判据加一条"性质闸"：触及权限/软链/子进程/门禁判定器的改动一律走完整路径，
  规模判据只对性质中立的改动生效

### F265 · 2026-08-30
状态：待处理（3 条）
来源：specs/265-ship-cli-release-gate0/（story 流程编排器实证 + plan/spec-review 子代理交付报告反馈节）
- [流程顺畅][spec-driver 编排] 插件 cache 安装（4.4.0）下 `resolve-project-context.mjs` 与
  `orchestrator-cli.mjs effective-orchestration` 均报 `zod-unavailable` 降级——后者的直接后果是
  **项目级 `orchestration-overrides.yaml` 在缺 zod 时整体不被应用**（diagnostics 原文明说），
  gate 行为解析只能落回 base 默认。源码侧优雅降级已达标（不崩、有诊断），但"配置静默不生效"
  对用户是隐性行为差异；且 4-tier gate 行为链的 user_config 层在 CLI 路径本就恒空（P1-K 已认领
  `orchestrator-cli.mjs:73`），两层叠加后项目级 gate 定制实际全线失效。改进方向：P1-K 修
  userConfig 注入时一并评估 zod 缺失下 overrides 的非 zod 校验路径（手写归一化已有先例）
- [流程顺畅][spec-driver 子代理工具面] spec-review 子代理工具清单无 Bash，本卡三处合规核验
  （CHANGELOG `[Unreleased]` 归属的 git 时序、`[推断]` 边界的 commit message 比对、Out of Scope
  的 `.find` 字节级 diff）只能凭文件内容特征间接判断，全部回抛编排器补验。改进方向：spec-review
  的 frontmatter 增加只读 git 白名单（`git log`/`git diff`/`git show`），或在 SKILL 注入块里
  约定"git 考古类证据由编排器预跑并随 prompt 注入"
- [信息完整性][Spectra MCP] plan 子代理反馈（原判"未达落账阈值"，编排器复核后升格落账，
  因同卡 implement/审查子代理全程同样纯 Read/Grep）：本卡核心任务是**值级数据流追踪**
  （"commit 串从哪读、在哪比对、在哪被丢弃、生命周期不跨出哪个函数"），`context`/`impact` 的
  symbol 级 caller/callee 摘要无法替代逐行读代码确认变量生命周期，MCP 在此场景零采用。
  非缺陷定位记录 + 能力缺口候选：若 P1-J 检索内核考虑"符号内数据流"维度，本卡是一个真实需求样本

### F269 · 2026-08-30
状态：待处理（2 条）
来源：specs/269-fix-ci-birpc-false-red/（fix 流程编排器实证）
- [流程顺畅][spec-driver fix SKILL] fix 模式复用 `create-new-feature.sh` 会在特性目录落一个
  未填充的 feature `spec.md` 模板（`[FEATURE NAME]` 占位符原样），而 fix 流程制品集是
  fix-report/plan/tasks/verification（F268 先例无 spec.md）——每个 fix 都需手工识别并删除
  该模板，本卡即 `rm` 后才 commit。改进方向：`create-new-feature.sh` 加 `--mode fix` 跳过
  spec.md 脚手架，或 fix SKILL 初始化步骤显式声明删除动作
- [流程顺畅][fix-compliance Stop hook × 长异步验证] 本卡验收判据是真实 CI 连续 2 次 run
  （30+ 分钟异步等待），而 Stop hook 要求 verification-report.md 先存在才放行 idle——两者
  张力靠「报告先落盘 + 真实 CI 验收节标 PENDING + 完成后回填」的两段式惯例化解。该惯例
  目前无处成文，属编排器现场发明；若判定器未来加「PENDING 节视为未完成」的严格化，这类
  长异步验证流会被卡死。改进方向：把「异步验证 PENDING→回填」惯例写进 fix SKILL，或判定
  器显式支持 in-flight 状态
