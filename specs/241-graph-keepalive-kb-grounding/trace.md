# F241 Trace — 编排执行链路

分支 `claude/f241-keepalive-kb-grounding-54ef99`，基线 `2e3a4cd`，worktree `modest-ellis-e4f0fe`。

[00:19:12] init: STARTED

## 初始化

- `init-project.sh --json` → `NEEDS_CONSTITUTION=false`、`config_schema:pass`、`PROJECT_CONTEXT_MODE=yaml`
- 编排配置：从**仓内源路径**加载有效（`is_fallback: false`，8 mode / 6 gate / 3 并行组）。
  注：从插件 cache 路径运行会因缺 zod 降级为 fallback，故统一走仓内源路径。
- KB 预查注入（F191）：**跳过** —— `.specify/project-context.yaml` 未配置 `knowledge_sources`
- 编号核对：`git fetch origin master` 后确认 241 无冲突（F240 在 `priceless-taussig` worktree，尚未落 specs 目录）

## Gate 策略偏离声明（编排器决定，须在交付报告中复述）

`GATE_DESIGN` 在 feature 模式下是 **hard gate（always / critical）**，标准流程要求暂停等人工确认。
本次为**非交互式自治执行**；用户在需求里只明确要求「push 前列 report 等确认」，
并要求「每 phase Codex 对抗审查」。

→ 处置：**各 GATE 以 Codex 对抗审查作为实质门禁自动推进**，唯独 push 到 `origin master` 前停下等用户确认。
此偏离在最终交付报告中显式标注，不隐藏。

## Phase 记录

| 时刻 | Phase | 结果 |
|------|-------|------|
| 00:19 | init | 完成 |
| 00:25 | 1b tech_research（codebase-scan） | 完成 → `research/tech-research.md`（202 行，逐条带行号证据 + 6 项如实标注的信息缺口）|
| 00:19-00:50 | 编排器并行取证 | `pilot/baseline-observations.md` O-1..O-7；`orchestrator-verifications.md` V-1..V-7 |
| 00:38 | 2 specify | 完成 → `spec.md`（23 FR / 28 EC / 18 SC / 9 RG）。**子代理误写入主仓**，已迁回 worktree 并清理主仓游离目录 |
| 00:48 | 2 specify / 编排器修订 | FR-003 维度非独立修订（V-5）；新增 D8 分发边界（V-1）|
| 01:0x | GATE_DESIGN — Codex 对抗审查 spec | `task-msc13f61-dgrxn8`：**6C/7W/1I**（首次尝试 API 断连已重试）。全部裁决 → review-dispositions.md；关键：C1 分发拓扑当场拍板方案 A、C2 矩阵 v2 顺序、C5 脱敏改名+gitignore 缺口、C6 枚举拆两组 |
| 01:0x | 3 clarify + checklist（并行）| clarifications.md（4 条推荐，其中 C-001/C-003 与 Codex 处置冲突→编排器否决，C-002/C-004 采纳）；checklist.md（6 组，含 12 条反纸面达成排查）|
| 01:10 | spec v2 修订（新 specify 代理）| 554→693 行，C1-C6/W1-W7/I1 全落；修订代理误写主仓 SENTINEL 占位文件已清理 |
| 01:14 | **spec 阶段 commit** | `0ee233c`（11 文件 +1679 行，pre-commit repo:check 全绿）|
| 01:23 | 4 plan | plan.md（385 行）：薄壳转发陷阱、两步 CLI 协议、FR-018 删除判定、四批次序；plan 代理 3 次 MCP 调用记入台账（1-6..1-8，发现 O-8 部分漏报）|
| 01:2x | 编排器补查 | V-8：SKILL.md 改动触发 wrapper SHA 门禁（plan 未覆盖）|
| 01:3x | GATE_ANALYSIS — Codex 对抗审查 plan | `task-msc2o01b-cf6m3v`：**BLOCKED，2C/7W**。P-C1 两步协议正常路径漏审计→改双事件审计模型；P-C2 pilot 批次依赖环+ledger 缺 timestamp（编排器自己的错，诚实回填 null）；P-W1..W7 全确认。裁决 → review-dispositions.md Plan phase 节 |
| 进行中 | spec v3 外科修正 ∥ plan v2 修订（并行两代理）| spec：FR-009/010 双事件+FR-014/020/021/022 钉死；plan：P-C1/C2/W1-W7 落地 |

## 编排器实测取证摘要（详见两份取证文件）

- 图重建实测 **4.4s** → 坐实 D1「条件刷新而非部分刷新」，否决增量建图引擎
- 图曾为 **stale**（`236de66` vs HEAD `2e3a4cd`），且 MCP 返回体**无任何 stale 标记** → B4③ 缺口实证
- 两类 calls 边漏建实证（O-3 回调体内 / O-7 动态 import 解构）→ 已立 follow-up 卡，本 feature out-of-scope
- `plugins/**/*.mjs` 不在图内的根因定位到 `source-discovery.ts:509-514` 扩展名白名单 → 已立卡，显式 out-of-scope
- F239 模块**不随插件分发** → spec FR-007 / RG-006 / D2 三者原本互斥，已补 D8

> **O-9（现场实证，plan commit 时）**：`0ee233c` 提交后 pre-commit repo:check 的
> `graph-quality:freshness` 立即转 warn（图锚 `2e3a4cd` vs 新 HEAD）——B4 动机的天然复现：
> 图在每次 commit 后必然 commit 级 stale；warn-not-fail 是正确门禁行为；刷新应由
> 消费需求驱动（implement 前重建一次），而非每 commit 无条件重建。此观测进 pilot 报告。

[02:25:34] phase_start_ref: implement=6950b084f5b3de7246ac0191cdfbdad55de555e5
[02:25:34] batch_base: batch1=6950b084f5b3de7246ac0191cdfbdad55de555e5

| 02:0x | 5 tasks | tasks.md v1（61 任务）；Codex 审查 `task-msc43enk-lprgh4`：**BLOCKED 6C/5W/1I**（T-C1 phase.id 恒 false / T-C4 continuous capture 未任务化 / T-C5 门禁可绕等）→ 全裁决落整改单 → tasks v2（73 任务/批 0-4）+ plan §3.1 勘误 |
| 02:2x | **tasks 阶段 commit** | `6950b08` |
| 02:2x | implement 前置 | 图重建 fresh@6950b08（3.5s）；trace 记 `phase_start_ref: implement` 与 `batch_base: batch1` 锚点 |
| 02:3x-03:1x | 6 implement 批 0+批 1（B4）| T001-T027 全 done：决策矩阵纯函数（144 穷举+顺序探针）/ 双事件审计 / D8 迁移三件套 / SKILL 三段接线（phase.name）/ wrapper 再生 / gitignore 自举。**T018 抓到真 bug：symlink realpath 守卫静默空转**（exit 0 零副作用——F239 警告过的形态在自家门口复现）；`refresh-failed-timeout` 不可达缺口补 `--refresh-deadline-ms`；3 处 tasks 描述缺陷如实上报 |
| 03:1x | 批 1 收尾（编排器裁决两项）| T027a symlink 守卫修 canonical+薄壳（判定收敛单一 `isInvokedDirectly` 导出）+ T027b D3 tasks.md 路径信号（仅 advisory 生效/git 优先/保守方向三红线落测）。node:test 1237 全绿 / vitest 54 全绿 / build 0 错 / repo:check 86 项 pass。评测脚本十余处同类 argv[1] 潜伏 bug → 立独立卡 |
| 03:1x | 编排器清理 | `specs/products/_generated` 与 suggestions 的 repo:sync 时间戳噪声 checkout 还原（并行 feature 约定）|
[04:04:18] batch_base: batch2=fd9af7f3a072fe1f160c0e0ac0a4c0dd9752072a

| 03:2x | 批 1 Codex 代码审查 | `task-msc6wt4l-emi1m9`：**7C/7W 全带复现证据**。B1-C3 最重（刷新主幸福路径必然 snapshot-mismatch 丢 caveat）；B1-C1/C2 availability 判定漏洞；B1-C4 caveat 与真实 MCP 形状不兼容。整改代理全修（净增 35 用例），并附带抓出 RG-004 此前对错误路径空转检查 |
| 03:5x | **批 1 commit** | `fd9af7f`（30 文件 +6981 行；node:test 1272 / vitest 54 / build / repo:check 86 族全 pass）|
| 04:04 | 批 2 前置 | 图重建 fresh@fd9af7f（3.5s）；trace 记 batch_base: batch2 |
| 04:0x-04:4x | 6 implement 批 2（E1）| T028-T049 全 done：redaction 六类 + nohit-recorder（total 函数契约）+ coverage-gap 聚合（distinct hash 键）+ 三挂点（含 document_fallback 零命中）+ CLI 可达性。实现期真 bug：placeholder token 碎片会让 EC-21 过滤失效（手跑抓到，单测按 id 写会全绿）。**dogfooding：5 次 MCP 调用 4 次被 grep 证伪**（1-11..1-15），其中 1-15 与 1-5 同 target 同错跨两版图复现 → O-7 稳定缺陷实证；新形态「同文件 export 互调不建边」浮出 |
| 04:4x | 批 2 门禁 | vitest tests/kb 35 文件 368 测试（基线 32/293 纯增）；全量 6092 pass；RG-005 kb-contract 0 diff；RG-009 四场景 SHA 逐字节相同 |
| 04:5x | **M-3 A/B 执行**（预注册兑现）| diff 冻结 1918 行 hash `7a888daa`；grounding 包 4 查询（错误结果按预注册**原样附上**）；A（no-grounding）/ B（grounded）同构 prompt 同时发起，兼作批 2 commit 前门禁审查 |
| 05:0x | M-3 判读 | A 组 BLOCKED（3C/4W/1I）+ B 组 BLOCK（2C/3W/1I）→ 判读后 **9 条真 finding / 0 误报**（交集 3：NFKC 顺序、FIFO/symlink、读取失败误报；A 独有 3；B 独有 2；不采纳 1）。批 2 门禁作废，不得在修完前提交 |
| 05:1x-05:5x | 批 2 M-3 整改（B2-1..B2-9）| 逐条修复 + 全量重验。取红方法：批 2 未 commit，用逆向替换脚本把 `src/**` 精确还原成审查形态（整份 + 25 反向 hunk）后跑新测取红，再还原。**38 红全绿**。B2-2 的 FIFO 阻塞会挂死 vitest worker（同步阻塞打不断，第一次全量跑 600s 无输出）——本身即 A-C3 的证明，改用 watchdog 子进程探针取证：`HUNG → RETURNED`、symlink 逃逸 `207B → 0B` |
| 05:5x | 整改后门禁 | vitest tests/kb 35 文件 **415** 测试（368 → +47）；全量 493 文件 / **6139** pass；插件 `node --test` 1272/1272；build + tsc + `repo:check`(86 pass) 全 EXIT=0；RG-005 `kb-contract.test.ts` 仍 0 diff；整改轮对 `plugins/spec-driver/scripts/**` 零改动。**如实标注两处偏差**：B2-2 加 `O_NONBLOCK`（整改单未列的必要超集）、B2-7 第三挂点负例结构性不可达故回退态即绿 |
