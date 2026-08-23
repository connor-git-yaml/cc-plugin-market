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

（无——2026-08-23 milestone-next 全部流转，见下）

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
