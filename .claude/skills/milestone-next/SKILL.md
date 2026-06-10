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

### 3. 判断要不要 workflow（不要默认全量重跑）

实测经济学（本仓库）：全量三轨 workflow（竞品调研×3 + 代码审查×4 + 对抗验证）≈ 14 agent / ~1.1M token / ~15 min。调研边际收益按天衰减；审查轨只在有大批新代码时有料。

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
  - 🆕 工具使用反馈节（dogfooding policy 四维度：MCP 可用性 / 信息完整性 / 流程顺畅度 / 结果准确性）
  - ⚠️ 注明在独立 worktree 跑，避免与本窗口工作目录撞车
- **评测类 Feature（花真钱/烧配额）**：prompt 里前置订阅优先凭据检查（host shell verify 三件套）+ 成本与配额提醒；派发节奏先问用户（先例：F176 等 F180 ship 后串行，避免白烧评测费）

### 6. 收尾汇报（固定结构）

1. **master 增量**：哪些 Feature 合入
2. **体检/调研结论**：每个 Feature 的体检结果；workflow 跑没跑 + 为什么
3. **milestone 改动**：改了什么（或"无需改动"+ 理由）
4. **派发的 prompt**：哪些、并行还是串行 + 理由
5. **工具使用反馈**（dogfooding 四维度，本轮用 Spectra MCP / Spec Driver 的问题，没遇到写"无"）
