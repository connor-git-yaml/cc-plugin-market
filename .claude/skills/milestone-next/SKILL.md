---
name: milestone-next
description: |
  Milestone 推进循环：更新 master → 体检刚合入的 Feature → 按需调研/审查 →
  修订 Milestone（用户拍板）→ 派发下一批 Feature prompt（能并行就并行）。
  里程碑无关（M7/M8/... 通用）。用户说"推进 milestone"、"看下一步"、
  "/milestone-next" 时使用。决策点一律回用户拍板，不自动决策。
---

## User Input

```text
$ARGUMENTS
```

`$ARGUMENTS` 可临时调整侧重（如"只体检不调研" / "跳过体检直接派发" / "全量调研"）；为空则按完整循环走。

## 执行循环

按顺序执行。所有"要不要 / 怎么排期 / scope 取舍"类问题回用户拍板（按行为约定：产品/用户视角讲清实际影响，给推荐选项）。

### 0. 安全检查（任何写操作之前）

- `git fetch origin master`；确认当前分支与 working tree 状态
- ⚠️ 本 worktree 可能被另一个窗口的 spec-driver 流程占用（曾发生：另一窗口启动 feature 把本目录分支切走、commit 落错分支）。若当前分支不是预期工作分支、或出现非本 session 产生的未提交改动 → **停下问用户**，不要动
- `specs/src.spec.md` 是 self-dogfood 再生噪声：`git checkout --` 还原，永不入 commit；提交一律显式路径，禁 `git add -A`

### 1. 看增量（先于一切判断）

- 本 worktree HEAD 与 origin/master 的差就是上轮以来的增量（每轮收尾时 worktree 已 rebase 到当时的 master）：`git log --oneline HEAD..origin/master` 看哪些 Feature 合入、`git show --stat` 看动了哪些文件
- 然后 rebase 到最新 origin/master
- 定位当前活跃 milestone 文档：`docs/design/milestone-*.md` + frontmatter 里的 `stepback_revision*` 修订链

### 2. 体检刚合入的 Feature（默认动作，每轮最高价值步骤）

对每个新 ship 的 Feature（fix/refactor/story/feature 同理）：

- 读 `specs/<NNN>-*/verification/verification-report.md`（refactor 模式加读 `residual-report.md`）
- 主线程直接验证 2-5 个关键风险点——需要依赖/影响面/symbol 定位时**优先 Spectra MCP**（impact/context/graph_*），fallback Grep/Read（dogfooding policy）：
  - 它声称闭合的问题**真闭合了吗**？找最强断言，警惕假绿 / over-claim（先例：F175 声称 byte-stable 实为读取侧 workaround，F179 才真闭合）
  - 有没有**动到后续 Feature 的前提**（先例：F179 体检确认未碰 import-resolver，F181 前提不变）
  - milestone 文档有没有因它产生的**事实漂移**要校正（先例：F180 实测工具数 17 校正了 scope 文档里的 18）
- 体检结论如实汇报；发现真问题 → 转化为 Fix 候选或并入后续 Feature scope，**不在体检里顺手改源码**

### 2.5 Review Dogfooding 反馈账本（每轮固定动作）

读 `docs/design/dogfooding-feedback-ledger.md` 的「待处理」节（各需求交付时按 dogfooding policy 落账）：

- **聚类**：同一工具面的多条反馈合并为一个改进候选（复现频次是排期信号，账本刻意不去重）
- **对照**：候选是否已被 milestone 既有轨道 / 在途 Feature 覆盖？已覆盖 → 直接标 `已分流`
- **产出改进计划**：每个候选给 一句话问题 + 改进方向 + 预估规模 + 分流建议（当前 milestone 塞得下 / defer 到下个 roadmap），**回用户拍板**（产品视角讲清对使用体验的实际影响，给推荐项）
- **拍板后落账**：更新条目状态（`已分流 → F<NNN>/M<N> roadmap` / `裁决不做（理由）`），已处理条目移到「已处理」节；采纳项进 §4 的 milestone 修订或 §5 的派发
- 账本为空或全部已处理 → 输出"无待处理反馈"，合法结论，不硬造改进项

### 3. 判断要不要 workflow（不要默认全量重跑）

实测经济学（本仓库）：全量三轨 workflow（竞品调研×3 + 代码审查×4 + 对抗验证）早期实测 ≈ 14 agent / ~1.1M token / ~15 min；**2026-08-23 M9→M10 交界实跑 20 agent / 4.06M token / 48 min**（调研轨带网页抓取是大头，审查+证伪约占 1/3）——报预估时按后者口径，别再引 1.1M。调研边际收益按天衰减；审查轨只在有大批新代码时有料。

- **竞品/范式调研**：结论已沉淀在 stepback-revision 文档的 landscape 节——几天内重跑大概率重复旧结论。只在 (a) 距上次调研数周+，(b) milestone 交界（规划下一个 milestone 时必跑一轮全量），(c) 出现方向性外部事件时再跑，且聚焦增量
- **审查轨**：多个 Feature 并行合入或大 refactor 刚落地 → 只跑"审查 + 对抗验证"两段 workflow（审真实代码）。**保留对抗验证层**——它纠正过 critical 误报、证伪过"死代码"结论、修正过错误删除清单（无此层 F181 会删掉在用函数）
- **单个 Feature 增量** → §2 的 inline 体检即可（几分钟、≈0 token），这是 3 轮实测的默认路径
- 拿不准 → 把"跑/不跑 + 预估 token 成本"作为问题问用户
- "无需跑"与"无需改"都是合法结论，不要为了显得有产出硬跑硬改

### 4. 修订 Milestone（有真增量才改）

- 有改动：走 stepback-revision 文档链（新增 revision 文件或修订现有，frontmatter 互链溯源）；**大范围改动 defer 到下一个 milestone 的 roadmap 节，不塞当前 milestone**
- 涉及取舍的修订先列决策点问用户（产品视角 + 推荐项），拍板后落文档
- 改完 commit（pre-commit repo:check 自动跑）；push origin master 前列 7 字段 deliverable report（commit/统计/finding/codex 结论/verify/rebase 状态/下一步）**等用户明确确认**

### 5. 派发下一批 Feature prompt

- **模式选择**：纯重构→`spec-driver-refactor`；bug 修复→`spec-driver-fix`；测试补齐/小需求→`spec-driver-story`；完整需求/评测→`spec-driver-feature`
- **并行判定**：列写入路径冲突矩阵。disjoint → 多 worktree 并行 prompt（先 ship 先 push，后者必须 rebase 最新 master 重跑验证）；共享文件/前提依赖 → 串行并说明原因（先例：F179→F181 同碰 graph 链串行；F180 等 F181 的稳定 graph.json）
- **每个 prompt 必含**：
  - 启动前 `git fetch origin master` 确认 HEAD ≥ <最新 hash>
  - feature 编号（先查远端分支与 specs/ 防多 worktree 编号冲突）
  - 问题（verify 过的现状 + 行号）/ 方案 / 🔴回归护栏 / 验收 / 预算
  - 每 phase Codex 对抗审查；push 前列 report 等确认
  - `specs/src.spec.md` 排除出 commit（显式路径）
  - 🆕 工具使用反馈节（dogfooding policy 四维度：MCP 可用性 / 信息完整性 / 流程顺畅度 / 结果准确性），且有实质反馈时**同步 append 到 `docs/design/dogfooding-feedback-ledger.md`**（状态：待处理，随需求一并 commit；"无"不落账）——供 §2.5 下轮统一 review
  - 对抗/变异类实验必须在 /tmp 副本上做，不得在工作 worktree 改文件；派发对抗审查前先冻结改动面（不重建 dist、不继续改被审文件），避免移动靶
  - 🔴 **禁用 `git stash` / `git checkout` / `git switch` 类手段做 A/B 或隔离**（会卷走同 worktree 并行代理的未提交工作，F261 codex-rescue 与 F262 内部子代理各实证一次）；受控 A/B 一律"复制副本 → 就地改 → 从副本还原"。多代理共享同一 worktree 时，验收口径改为"**目标文件组绿 + 受控 A/B 零 delta**"，不要求全量绿（他人的红在途，全量绿对单代理结构性不可达）
  - **图解析 / 采集面类改动**（call-resolver、mapper、adapter、collector、gitignore oracle 等）验收必须带**第二口径：外部语料 A/B 差分**——在本仓之外的语料（`~/.spectra-baselines/` 既有 baseline projects 或 node_modules 抽样）上对改动前后建图做逐边 diff，并抽样核对；只靠"本仓锚点不变"不算验收（F263 实证：本仓锚点 238 对两轮真缺陷全盲——首版误伤 TS 声明合并、次版放行顶层重赋值假边，均由外部语料形态暴露）
  - ⚠️ 注明在独立 worktree 跑，避免与本窗口工作目录撞车
- **评测类 Feature（花真钱/烧配额）**：prompt 里前置订阅优先凭据检查（host shell verify 三件套）+ 成本与配额提醒；派发节奏先问用户（先例：F176 等 F180 ship 后串行，避免白烧评测费）

### 6. 收尾汇报（固定结构）

1. **master 增量**：哪些 Feature 合入
2. **体检/调研结论**：每个 Feature 的体检结果；workflow 跑没跑 + 为什么
3. **反馈账本处置**：本轮 review 了几条待处理反馈、聚类成哪些改进候选、拍板结果与状态流转（或"无待处理反馈"）
4. **milestone 改动**：改了什么（或"无需改动"+ 理由）
5. **派发的 prompt**：哪些、并行还是串行 + 理由
6. **工具使用反馈**（dogfooding 四维度，本轮用 Spectra MCP / Spec Driver 的问题，没遇到写"无"；有实质反馈同步落账 ledger）
