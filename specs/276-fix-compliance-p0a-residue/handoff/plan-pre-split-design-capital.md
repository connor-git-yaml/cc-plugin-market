# 修复规划 — F276 fix-compliance 门禁 P0-A 残余收口

**分支**：`claude/f276-compliance-handoff-fixes-9a9fe1` | **日期**：2026-09-02 | **模式**：fix
**上游 FR 事实源**：`specs/270-compliance-evidence-ledger/spec.md`（本卡**不改**它）
**输入制品**：`fix-report.md`（G0..G4 定稿策略 / R-1..R-12）、`verification/gate-design-adversarial-round1.md`（D-1..D-8 设计约束）、
🔴 **`verification/gate-design-adversarial-round2.md`（R2-1..R2-14，8 新 CRITICAL + 6 采纳 WARNING，本次修订的指令源）**、
`research/reverse-census.md`（四条硬约束）、`research/baseline-reproduction.md`（B-1..B-9 对照组）、`verification/mainline-adversarial-pass1.md`

---

## Summary

F270 在 plan 阶段**静默收缩范围**，四组 `[必须]` FR 零 Phase / 零任务 / 零代码，经集成 review 与用户裁决移交本卡。
本卡按 **G0 → G1 → G2 → G3 ∥ G4** 五批收口：先建 judge 侧诊断码 canonical 表（补上不存在的 R-12 护栏，
含 `userFacing` 可见面收窄），再做**状态文件并发安全 + 计数幂等 + `!saved.ok` 方向收口**，
再接 GATE 证据指纹的**路由半边**（同时重写 `routeNonBlock` 返回契约、消灭死代码、加 `warn` 档门控），
最后并行做 PENDING 自愈路径与 snapshot-stale 专码。

🔴 **本版是第 2 轮异构对抗后的修订版**（8 新 CRITICAL 全部处置）。三处**结构性**变化，读旧版结论前须知：
1. **G1 / G2 边界重划**——计数幂等键（`lastCountedFingerprint`）从 G2 下沉到 G1，
   否则 G1 单独落地会**净变差**（一次 Stop 吃两格 `blockCount`）；
2. **G1 新增 `!saved.ok` 方向收口**——这是本卡范围的唯一一次扩张，理由与边界见「明确不做」开头；
3. **撤回 `prompt_id` 的 sentinel 兜底**——改为"降级不承重"，并诚实登记该通道上幂等键同样失效（K-13）。

**本卡的元目标与功能目标同等重要**：产出并遵守下方 **FR → Phase 覆盖矩阵**——
未认领的 FR **必须显式登记裁剪 + 理由 + 再做前置条件**，禁止静默省略。F270 的 over-claim 根因即在此。

---

## Technical Context

**Language/Version**：Node.js 20.x+ ESM（`.mjs`，**零运行时依赖**，宪法原则 X 硬约束——锁原语必须用 `fs` 内置能力实现，禁止引入 `proper-lockfile` 等 npm 包）
**Primary Dependencies**：无新增。仅 `node:fs` / `node:path` / `node:crypto`（指纹 hash）/ `Atomics.wait`（同步睡眠）
**Storage**：`.specify/runs/.fix-compliance-state/<sanitizedSessionId>.json`（gitignore 的本地运行态，tmpdir 两级回落）+ 同目录新增 `<sanitizedSessionId>.lock`
**Testing**：`node:test` + `node:assert`（plugins 侧，经 `npm run test:plugins`）。TS 侧 `vitest` 仅作连带回归
**Target Platform**：Claude Code Stop hook（同步执行，无 `await`）+ Codex 双注册；CLI 直调（`--project-root` / `--mode report`）
**Constraints**：Stop hook 同步、不可 brick 会话（F208）、不可抛（顶层 fail-open 会静默关门禁）、单次判定端到端 43–63ms 量级（F270 实测）
**Scale/Scope**：3 个生产文件 + 1 个 SKILL + 1 个 JSON 合同 + 3 个测试文件；新增 **7 个诊断码**、1 个状态字段、1 个锁原语

**新增诊断码逐 Phase 换算式（防口径漂移，SC 对照须复用本式）**：
G1 = `state-lock-unavailable` + `state-lock-taken-over` = **2**；
G2 = `gate-fingerprint-no-progress` + `gate-fingerprint-partial` = **2**；
G3 = `verification-report-pending` = **1**；
G4 = `snapshot-message-absent` + `snapshot-stale` = **2**。
**合计 2+2+1+2 = 7**；schema `diagnostics` enum 由 **27 → 34** 码（计数单位 = enum 条目数，G0 派生守卫全覆盖）。

🔴 **换算式不受第 2 轮修订影响，理由须一并登记**（否则下轮又要重算）：
- **R2-1 新增的 `!saved.ok` 处置复用既有 `state-storage-unavailable` 码**（io 侧已有、已在 enum 内），
  **不新增码**；errno 只作该码的 detail 字段值、**不参与判定分支**、**不新增 enum 条目**。
- **R2-4 撤回 sentinel 后 `gate-fingerprint-partial` 保留**（改为标记"本次不走指纹去重"的降级态），码数不变。
- **R2-7 的 `userFacing` 是 canonical 表的一列、不是码**，不进 schema enum，不计入换算式。
- **用户可见面计数（新口径，计数单位 = 表内 `userFacing===true` 的条目数）**：本卡新增 7 码
  **全部 `userFacing:false`**，即 **新增用户可见码 = 0**。G0 守卫钉死"新码默认 false，设 true 必须显式改表且配用例"。

**~~NEEDS CLARIFICATION~~ P-2 已由主编排器核实关闭（2026-09-02）**：
- **结论：Stop payload **确实携带** `prompt_id`，直证，非推断。** 证据：F270 `research/harness-field-probe.md`
  **§3.13 结论 P-12** 捕获的是一份**真实 Stop payload**（同一 JSON 体内 `"hook_event_name": "Stop"`、
  `"stop_hook_active": false`、`"background_tasks": [...]`），其中 `"prompt_id": "ac6ec233-…"`，
  且该表明确记「与前一用户轮的 `29b262ce` **不同**」——即「用户发新消息 ⟹ `prompt_id` 改变」在 **Stop 通道**上已直证。
  plan 初稿写的「F270 对它的观测来自 PostToolUse 通道」**不成立**（P-12 是 Stop 通道）。
- `reverse-census.md §9` 未列 `prompt_id`，原因是该表统计的是**当前被消费的字段**，`prompt_id` 今天零消费——
  「未被消费」≠「不存在于 payload」。两者不矛盾。
- 🔴 **缺席时的处置：撤回 sentinel 兜底（R2-4，第 2 轮对抗裁决，上一轮方向错了一并更正）**。
  四分量在冻结窗口内三项天然恒定，唯一由外部扰动的就是 `prompt_id`；用 sentinel 补齐 ⟹
  在缺该字段的通道（Codex 方言 / 老 harness）上**整个平台**指纹恒定 ⟹ `blockCount` 恒 0，
  被判方不必伪造字段、**只需选平台**。这违反 **F224「fail-open 必须按维度收窄，不得整体短路」**。
  **正确形态＝降级不承重**：`prompt_id` 不可得 ⟹ 本次 Stop **不走指纹去重**、按 `routeBlock` 处理
  （＝改动前行为，不更松），并落 `gate-fingerprint-partial` 使降级可见（宪法原则 IV）。
  **禁止**改从 transcript 反推 `prompt_id`（文本启发式，K-7 裁决禁止）。
- ⚠️ **该通道的不可消除代价须显式登记（K-13）**：不走指纹去重 ⟹ **G1 的计数幂等键在该通道上同样失效**
  ⟹ 「Codex 双注册 + 无 `prompt_id`」的组合下退回「一次 Stop 吃两格 `blockCount`」。
  这条代价**无法在本卡内消除**，只能诚实登记；SC 措辞不得写成"幂等键全平台生效"。
- G2 的 T-0 由「实测确证」降级为「**回归钉**」：用 F270 已录制的真实 Stop payload fixture 断言该键存在且被指纹消费。

---

## Codebase Reality Check

> 目标文件的当前实况（HEAD `e01611b2`）。LOC 由 `rg -c '^'` 实测。

| 文件 | LOC | 顶层函数 / export | 本卡预计新增 | 已知 debt |
|---|---|---|---|---|
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | **1160** | 13 顶层 function / 8 export | ≈ +160 | ① 诊断码**散落字面量 16 处、无 canonical 表**（G0 修）；② `routeNonBlock` + 2 常量 **生产零接线死代码**（G2 修）；③ 🔴 `saveBlockState().ok` 三个检查点**两处实为 fail-open、且可自诱发**（第 2 轮对抗 R2-1 主线程实跑复现）：`judge:659-668`（routeBlock 侧 ⟹ `releaseDegraded` ⟹ **exit 0**）与 `judge:780`（routeNonBlock 侧 ⟹ exit 0），仅 `judge:1044`（推迟路径）为 fail-closed。构造成本 = **两条 `mkdir`**（把主路径与 tmpdir 的状态文件位置各占成目录）⟹ 两级写 EISDIR ⟹ **首次 Stop 即 exit 0**。**G1 修（两处必须同时改，见 G1 处置 6）**；④ `releaseDegraded` 的 `inFlightDeferCount = 0` **默认值静默 fail-open**（G1 修）；⑤ `runHook` 单函数 165 行（911-1075），本卡**不拆**（见「明确不做」） |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | **417** | 17 顶层 function / 12 export | ≈ +90 | ⑥ `saveBlockState` JSDoc 明文「**刻意不做** read-modify-write 合并」——该论据在跨进程失效（G1 推翻并改写该 JSDoc） |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | **1877** | 36 顶层 function / 33 export | ≈ +40 | ⑦ 承重不对称：提名侧 `ARTIFACT_PATH_REGEX` 收 verification-report.md，见证侧 `ANCHORED_ARTIFACT_PATH_REGEX` 只收 fix-report.md（**本卡不碰**，R-8） |
| `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` | **573** | — | ≈ +25 行 | ⑧ 受控生成链：改后必须 `npm run repo:sync` 重生 `skills-codex/spec-driver-fix/SKILL.md`（596 行）并重算 `Source SHA256` |
| `specs/208-.../contracts/fix-compliance-verdict-event.schema.json` | 69 | — | **+7 enum 条目 + 1 property** | ⑨ diagnostics 是**闭集 enum（当前 27 码）**，缺码不报错、只是"没有这个码"（G0 修守卫） |
| `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | **3507** | — | ≈ +450 | ⑩ `routeNonBlock` 的 5 个用例是**直接 import 单元钉**，端到端零覆盖（G2 修） |
| `plugins/spec-driver/tests/fix-compliance-io.test.mjs` | 606 | — | ≈ +200 | ⑪ **全仓零并发测试**：全是单进程顺序调用（G1 修） |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | 4935 | — | ≈ +60 | ⑫ 大量把 `anchorLineIndex` 当窗口实参喂入——**测试自造的调用形态，与生产实参已不同**（本卡不修，登记） |

**TODO/FIXME/HACK 扫描**：`plugins/spec-driver/scripts/` 全目录 **0 命中**。技术债不以标记形式存在，而以上表 ①–⑫ 的形式存在。

### 前置清理判定

按「文件 LOC > 500 且新增 > 50 行 ⟹ 须前置 cleanup task」规则，`fix-compliance-judge.mjs`（1160 / +160）与
`fix-compliance-io.mjs`（417，未触发 LOC 门槛但触发 debt 门槛）命中。

**前置 cleanup 的落地形式 = G0 与 G1 本身**，不另设第三个 cleanup 批：
- **G0 [CLEANUP]**：收编 16 处散落诊断码字面量 → `JUDGE_DIAGNOSTICS` canonical 表（含 `userFacing` 列）+ 派生守卫。**零裁决变更**（退出码 / 计数器 / 审计事件逐字节不变），是后续三批新码的守卫前提（D-7）。⚠️ **不是"零行为变更"**：`userFacing` 过滤会收窄用户可见 stderr 的诊断码渲染面（R2-7），该差异须逐条登记。
- **G1 [CLEANUP+FIX]**：把 4 条手工透传 5 字段的 RMW 序列收敛为单一 `mutateBlockState` 原语，同时消灭 ④ 的默认值不一致。
  清理收益直接承重：**G2 新增 `lastCountedFingerprint` 字段后，若仍是"整体覆写 + 调用方带回"，等于把第 6 个字段扔进同一个抹平坑**（F270 正是这么把 `nonBlockStopCount` 加进去的）。

⚠️ **不做的清理**：`runHook` 165 行不拆（拆分会与 G2 的路由插入点冲突，且 F270 全部对抗结论都锚在现有行号上，重排会让护栏引用失效）。登记为遗留 debt。

---

## Impact Assessment

| 维度 | 评估 |
|---|---|
| **直接修改文件** | 8（judge / io / core / SKILL.md ×2（1 生成）/ schema.json / 测试 ×3） |
| **间接受影响** | `record-workflow-run.mjs`（消费 `complianceVerdict.blockCount`，G2 改终态 result 语义）；`judge-snapshot-core.mjs`（`JUDGE_FILE_SET` 闭包派生式扩张，R-10）；`hooks/hooks.json`（**不改**，无新 hook）；`stop-fix-compliance-check.sh`（**不改**） |
| **跨包影响** | **0 个跨顶层边界**。全部在 `plugins/spec-driver/` + `specs/208-.../contracts/`。**刻意不复用** `src/utils/atomic-write.ts`（F267）——跨 `src/` ↔ `plugins/` 边界，且 `JUDGE_FILE_SET` 闭包不含 `src/`，复用会把闭包撑破 |
| **数据迁移** | **有（向后兼容型）**：状态文件新增 `lastCountedFingerprint` 字段；`normalizeState` 对缺字段回落 `null`（同 `inFlightDeferCount` / `nonBlockStopCount` 的既有向后兼容口径）。**无破坏性迁移**，旧状态文件直接可读 |
| **API / 契约变更** | **有 3 处**：(a) 审计事件 schema diagnostics enum **+7 码（27 → 34）**；(b) schema 新增 `pendingItemCount` property（`additionalProperties:false` 下必须登记）；(c) schema `degraded` 字段 description 语义扩张（G2 让 `nonBlockStopCount` 耗尽也标 `degraded:true`）；(d) **`buildFeedbackText` 的诊断码渲染面收窄**（R2-7）：只渲染 canonical 表中 `userFacing===true` 的码，其余码只进审计事件——这是**用户可见面的契约变更**，既有"诊断码必然出现在 stderr"的断言会变红，逐条改断言而非放宽。另有 `routeNonBlock` 的**导出函数签名与返回契约变更**（+`semanticExitCode` 参数，返回值不再恒 0，且耗尽放行时 `complianceVerdict.blockCount` 由 `null` 改为**数值**） |
| **SKILL 协议变更** | 有：`spec-driver-fix` SKILL 增补 PENDING 惯例（受控生成链，须 `repo:sync`） |

### 风险等级：**HIGH**

判定依据（命中 2 条 HIGH 触发条件）：
1. **涉及数据迁移**（状态文件新增字段 + 归一层改动）；
2. **修改公共 API 契约**（审计事件 schema 三处 + `routeNonBlock` 导出签名）。

附加放大因子（不改变等级，但抬高验证要求）：改的是**门禁判定器本身**——失效即静默放行；
本仓已实证同构审查对此类改动结构性漏判（F229/F262/F264/F266/F270/F272/F275 七次）。

### HIGH 风险 ⟹ 强制分阶段（已满足）

实现拆为 **5 个可独立验证的 Phase**，每个 Phase 有下方「退出判据」定义的机械验证点，且：
- **G0 零裁决变更**（用户可见 stderr 的诊断码渲染面按 `userFacing` 收窄，须登记），可独立 commit 与回滚；
- **G1（第 2 轮重划边界后）＝并发安全 + 计数幂等 + `!saved.ok` 方向收口**。
  🔴 **不再声称"零裁决方向变更"**：R2-1 的 `!saved.ok` 收口**故意**把"存储不可用 ⟹ exit 0"翻成
  "保持本次裁决自身语义"，这是**有意的方向反转**（fail-open → fail-closed）。
  退出判据改为「B-2 对照组翻转（增量 = 1）+ B-1/B-3 **在存储可用前提下**序列逐字不变
  + 存储不可用语料**必须翻转**（exit 0 → exit 2）」；
- **G2 是唯一改变正常路径裁决路由的 Phase**，退出判据含逐轮序列断言 + 变异钉；
- **G3 / G4 纯可观测性**，零路由变更，可并行且可独立回滚。

---

## Constitution Check

| 原则 | 适用 | 评估 | 说明 |
|---|---|---|---|
| I 双语文档规范 | ✅ | PASS | 制品中文正文 + 英文标识符 |
| II Spec-Driven Development | ✅ | PASS | 走 fix mode；FR 事实源在 F270 spec，本卡以覆盖矩阵对账 |
| III YAGNI / 奥卡姆 | ✅ | PASS（有张力，已论证） | G0 建 canonical 表是"增实体"，但它是 D-7 认定的**守卫前提**（无表则新码漏登记零信号）。G1 锁原语是 FR-012 的最小实现（不引入库、不做通用锁服务）。见 Complexity Tracking |
| IV 诚实标注不确定性 | ✅ | PASS（承重） | P-2 悬空分量落 `gate-fingerprint-partial` 码；FR-032 未回填项计数；G4 缺席/陈旧分家；本文档的裁剪登记与「已知代价」表 |
| X 零运行时依赖 | ✅ | PASS | 锁用 `fs.openSync(path,'wx')`（O_EXCL）+ `Atomics.wait` 同步睡眠，零 npm 包 |
| XI 质量门控不可绕过 | ✅ | **需持续论证** | 本卡直接改门禁。G2 新增一条放行路径 ⟹ 必须满足 D-5（可见性 ≥ `releaseDegraded`）与 R-11（总上界存在）。第 2 轮异构对抗以此为主靶，**并反向抓出一条既有的 R-11 破口**（R2-1 `!saved.ok`，已纳入 G1 处置 7）。**第 3 轮继续以此为主靶** |
| XII 验证铁律 | ✅ | PASS | 每条新判据配 ≥1 端到端钉 + 变异钉（见下） |
| XIII 向后兼容 | ✅ | PASS | 状态文件新字段缺省回落；schema 只增不改既有码语义（FR-034） |
| XIV 可观测性与架构守护 | ✅ | PASS | G0 派生守卫 + G3/G4 诊断码 + 接管事件落码 |

**结论：无 VIOLATION**。原则 III 的张力记入 Complexity Tracking。

---

## 🔴 FR → Phase 覆盖矩阵（本卡的元交付物）

> **纪律**：每条 FR 必须落在「认领 / 部分认领（含缺口） / 显式裁剪（含理由 + 再做前置条件）」三态之一。
> **禁止**留空、禁止用"由 XX 顺带满足"敷衍。tasks.md 与 verification-report.md 的 SC 对照**必须逐条回到本表口径**。

| FR | 原文要点 | 状态 | Phase | 缺口 / 裁剪理由 | 再做前置条件 |
|---|---|---|---|---|---|
| **FR-012** | block/defer 状态更新 MUST 在多进程并发下不互相覆写 | ✅ **完整认领** | **G1**（含**计数幂等半边**，R2-2 重划边界后） | 🔴 **口径更正**：单纯"不互相覆写"是**不充分**的验收——生产并发源是「同一个 Stop → ≥2 判定器进程 → 同一 `session_id`」，`saveBlockState` 的丢更新此前**恰好充当了「每 Stop 只计一次」的去重**。只加锁不定义**计数幂等键**会让一次 Stop 吃两格 `blockCount`（净变差）。故 FR-012 的认领同时包含 `lastCountedFingerprint` 的**计数半边**（test-and-set） | — |
| **FR-026** | （结果性）证据状态无进展期间反复 Stop MUST 不产生误阻断、不消耗任何有界放行预算 | 🟠 **部分认领** | **G2** | **两处缺口，均显式登记**：<br>① **"不产生误阻断"未达成**——Design X 下冻结暂停仍会收到 2 次 `exit 2`（与基线持平，不更差，但**未修**）。用户已拍板「只做指纹去重，缺口显式登记」；<br>② **"不消耗任何有界放行预算"未达成**——按 FR-046 重写口径，这类态**必须**计入 `nonBlockStopCount`。FR-026 字面与 FR-046 冲突，本卡取 FR-046（更晚、经 delta 复审），差异在此登记 | ① 需 `AskUserQuestion` 权威信号（A-4 列为可选增强，伪造代价＝真停下等人）——**跨卡面，移交后续卡**；<br>② 需上游修订 FR-026 措辞与 FR-046 对齐 |
| **FR-027** | GATE 暂停裁决 MUST NOT 被判为不合规收口尝试，MUST 落专属诊断码 | 🟠 **部分认领** | **G2** | 专属诊断码 `gate-fingerprint-no-progress` **完整达成**；"MUST NOT 被判为不合规收口尝试"**未达成**——判定器仍按不合规裁决（只是不计 `blockCount`）。与 FR-026 ① 同源缺口 | 同 FR-026 ① |
| **FR-028** | GATE 裁决 MUST NOT 计入 `blockCount`，MUST NOT 消耗任何有界放行预算 | 🟠 **部分认领** | **G2** | 前半（不计 `blockCount`）**完整达成**，SC 可断言零增量；后半（不消耗任何有界预算）**按 FR-046 重写口径显式不实现**，同 FR-026 ② | 同 FR-026 ② |
| **FR-029** | 「证据陈旧 / 无法交叉校验 / 在途 undetermined / 重入」四类 MUST NOT 计 `blockCount`、MUST 计 `nonBlockStopCount` | 🟠 **部分认领（原四类中 0 类 + 1 个新类）** | **G2** | **逐类登记**：<br>· **指纹无进展**（FR-029 未列举、由 A-4 主方案引入）→ ✅ G2 认领；<br>· **证据陈旧** → ❌ **裁剪**：D-2 两路独立命中——接路由是已证伪路线 #21 的反向同型，且会吃光 `NON_BLOCK_LIMIT=2` 预算**静默抵消 G2**。G4 降级为纯诊断码；<br>· **在途 undetermined** → ❌ **裁剪**：现走 transcript 派生回退（judge:1019），改接 nonBlock 桶会与既有三闸门语义叠加，超出本卡四组；<br>· **重入** → ❌ **裁剪**：F270 P3 对抗已证伪并撤线（惩罚动作自身生成豁免），改判会重开该绕过面；<br>· **无法交叉校验** → ❌ **裁剪**：本卡无对应生产判据（该态在当前实现中不存在） | 陈旧类：先在 454 份真实 transcript 上实测 G4 判据触发率，证明信噪比可用且不吃满预算；<br>在途 undetermined：待「在途相关性过滤」（F270 移交项）落地后统一重估；<br>重入：需先给出不让惩罚动作生成豁免的新形态 |
| **FR-030** | MUST 识别验证报告中的 PENDING 标记，含合规 PENDING 的报告视为合法形态 | ✅ **认领（de facto 已满足，零代码）** | **G3** | 当前判据 `exists && nonEmpty`（core:1809-1810），含 PENDING 的报告**本就通过**。本卡不改判据，**补回归钉**证明该性质并防未来收紧误伤 | — |
| **FR-031** | 合规 PENDING 判据 MUST 是"写明回填触发条件"；裸 PENDING MUST 按缺失处理 | ❌ **显式裁剪** | — | **三条理由（D-3，两路独立命中）**：① **语料翻转风险** — 本仓 190 份 verification-report 中 12 份含 PENDING 类标记，形态是表格单元格 / checkbox / emoji 前缀加粗行，回填条件多在另一列或另一段，收紧后**大概率全部翻成 block**；② **与 K-7 裁决冲突** — 它引入的正是 A-4 已证伪的**文本启发式**，只是从 transcript 挪到制品内容上（与同一策略表里 G2 行"禁止任何文本启发式"内部不自洽）；③ **安全收益近零** — 伪造成本 ≈ 10 字，合同成本 ≈ 跑完验证。<br>**附带连锁（若强行做）**：新增 missing 键不入 `DEFERRABLE_MISSING_KEYS` ⟹ `isDeferrableMissingSet` 全称判定使**整条在途推迟通道关闭**（G3(b) 拆掉 G3(a)）；`buildFeedbackText` 的 `.filter(Boolean)` 使表外键**静默丢行** ⟹ 空阻断 | 先在这 190 份语料上跑判据 A/B 并**公布翻转清单**；且须先给出非文本启发式的替代判据 |
| **FR-032** | 判为合规 PENDING 时诊断 MUST 登记未回填项数量 | ✅ **完整认领** | **G3** | 纯可观测性、不改判 | — |
| **FR-033** | `last_assistant_message` **缺席** 与 **取到且判定陈旧** MUST 分配不同诊断码；`snapshot-stale` 专码 MUST 仅用于后者 | ✅ **完整认领** | **G4** | FR-033 只要求两态分配不同诊断码，纯诊断码**完整满足**（D-2 复核）。**附带诚实登记**：该量度量的是 **harness 刷盘行为**，不是"病根 i 残余误伤率"（F262 已实证主 transcript 懒刷盘滞后 25+ 分钟）——SC 措辞不得写成"已可度量残余误伤" | — |
| **FR-046** | 解锁计时器五点：不计 `blockCount` / 未耗尽按自身语义 / 耗尽走终态可见放行 / transcript 派生 backstop / save 失败 fail-closed | ✅ **完整认领** | **G1（第 5 点）+ G2（第 1–4 点）** | 🔴 **Phase 归属按 R2-2 重划边界更新**：第 5 点（`!saved.ok` fail-closed）**下沉到 G1**——它是既有 fail-open 的收口，且必须**同时**覆盖 `judge:659-668` 与 `judge:780` 两个检查点，与 G2 的路由重写解耦；G2 保留第 1–4 点（不计 `blockCount` / 未耗尽按自身语义 = 返回契约重写，B-7 实测现状恒 `return 0` / 终态可见性提档至 ≥ `releaseDegraded`（D-5）/ backstop） | — |

### 矩阵自检（tasks/verify 阶段必须复核）

- 认领 FR 数：**完整 5**（FR-012 / 030 / 032 / 033 / 046）+ **部分 4**（FR-026 / 027 / 028 / 029）+ **裁剪 1**（FR-031）= **5+4+1 = 10 条全覆盖，零遗漏** ✅
- 「部分认领」的 4 条**必须**在 verification-report.md 的 SC 对照里写"部分达成 + 缺口原文"，**禁止**写成"达成"。
- F270 移交的另 5 项（FR-043/044 活性自检、FR-010 坏行码、FR-011 超限、W-9 账本 `noopVerify` 回退、在途相关性过滤）**不在本卡四组内**，保持移交状态，SC 对照里逐条报"未认领（F270 移交，非本卡范围）"。

---

## Phase 划分与退出判据

**排序**：`G0 → G1 → G2 → G3 ∥ G4`

**排序的承重理由**（不是偏好）：
1. **G0 先行**：judge 侧无 canonical 诊断码表 ⟹ R-12 护栏在本卡范围内**不成立** ⟹ 后续四批新增的 7 个码漏登记 schema 不会被任何守卫抓到（D-7）。
2. **G1 先于 G2**：并发抹平 `nonBlockStopCount` 会让解锁计时器永不耗尽 ⟹ **无界阻断**（B-7 更正方向，仅受 420 backstop 封顶），把一次合法停顿拖成最多 ~420 entry 的连续阻断，撞 F208「Stop hook 不可 brick 会话」。
   **第二条理由**：G2 要往状态文件加第 6 个字段 `lastCountedFingerprint`；在"整体覆写 + 调用方手工带回"模型下新增字段就是新增抹平坑（F270 加 `nonBlockStopCount` 的原样重演）。G1 的 `mutateBlockState` 原语让新字段**自动保全**。
3. **G2 内部不可拆**：`routeNonBlock` 的返回契约重写与**任何**接线 MUST 同一 Phase / 同一提交（D-6）。
4. **G3 ∥ G4**：两者均为纯可观测性、零路由变更、触碰文件不重叠（G3 动 `judge:522` 传参 + core 判据 + SKILL；G4 动 payload 消费 + core helper），可并行。

### 🔴 G1 / G2 边界重划（第 2 轮对抗 R2-2 裁决，取代初稿边界）

**归因链**（主线程复核成立）：
1. 生产并发源经 F270 实证是「**同一个 Stop 事件 → ≥2 个判定器进程 → 同一 `session_id`**」（Codex 双注册 / 单会话内主线程 + 子代理）；
2. `saveBlockState` 的**丢更新此前恰好充当了「每 Stop 只计一次」的去重**；
3. 初稿 G1 只修写原子性、**没定义计数的幂等键** ⟹ 加锁后两个进程串行各 `+1`，`blockCount` 一次 Stop 从 1 跳到 2 ⟹ `BLOCK_LIMIT=2` 在**第 2 次 Stop** 就耗尽；
4. 后果三条：① FR-006「同会话至多 2 次阻断」实际降为 **1 次**，诚实用户少一次补救机会；② `judge:706` 的终态文案写死「在 **3** 次不合规尝试后降级放行」，而用户实际只被阻断 1 次 ⟹ **审计流里留下一句可证伪的假话**；③ 并发度 > 2 时跳得更多。

| 批 | 新边界 |
|---|---|
| **G1** | 并发安全 **+ 计数幂等 + `!saved.ok` 方向收口**：锁 + **锁内 test-and-set**「本次证据状态指纹是否已计过数」，指纹相同 ⟹ **不重复 `+1`**。即 `lastCountedFingerprint` 字段与 Design X 的**计数半边**在 G1 落地 |
| **G2** | 在幂等键之上只做**路由半边**：不计数的那些走哪条路由（`routeNonBlock`）、上界是什么（`nonBlockStopCount` + 420 backstop）、终态怎么可见、返回契约重写、`warn` 档门控 |

**为什么不能分两批各做一半**：幂等键与「无进展去重」在语义上是同一个机制的两半——同一 Stop 的两个进程与同一用户轮内的两次无进展 Stop，**在证据状态上不可区分，也不应被区分**。拆开会让 G1 单独落地时**净变差**，违反「每个 Phase 落地后都不得劣化」。

🔴 **G1 退出判据随之改写（把缺陷钉成合同的写法作废）**：初稿写的「N=2 并发 ⟹ 最终 `blockCount` = 2」
（`baseline-reproduction.md` B-2 的「串行等价值」列同样）**是错的**——它把「一次 Stop 吃两格」当成正确答案。
正确断言是「**同一 payload 的 2 个并发判定器 ⟹ `blockCount` 增量 = 1**」。TDD 清单与变异清单已同步改。

---

### G0 · judge 侧诊断码 canonical 表 + `userFacing` 可见面收窄 [CLEANUP · 零裁决变更]

**范围**：`fix-compliance-judge.mjs`

**做什么**
1. 新增 `export const JUDGE_DIAGNOSTICS = Object.freeze({...})`，收编 judge 自身产出的散落字面量（实测 16 个产出点，位于 `:246 / :291 / :531 / :564 / :693 / :783-784 / :975 / :1052 / :1054 / :1057 / :1060-1061 / :1135 / :1145`）。
   **表的边界**：只收 **judge 自身发出**的码；由 core / io / ledger-reader 返回并透传的码（`LEDGER_DIAGNOSTICS` / `FOREIGN_DIALECT_DIAGNOSTICS` / `state-storage-unavailable` 的 io 侧来源）保持在各自模块的表里，**不在 judge 表重复登记**（否则两表对同一码各持一份 = 新的漂移面）。
2. 全部产出点改为引用表项，**禁止模板串拼接**（沿用 `judge-cli.test:1636` 的 I-2 反向守卫形态）。
3. 🔴 **表结构增加 `userFacing:boolean` 一列（R2-7 裁决）**——表项形如
   `{ code: 'state-lock-unavailable', userFacing: false }`：
   - **唯一渲染点收窄**：`buildFeedbackText` 的 diagnostics 渲染改为**只渲染 `userFacing===true` 的码**，
     其余码只进 `buildAuditEvent`。理由：按 plan 初稿至少 5 个新码会直接进用户 stderr，其中
     `snapshot-stale` 可能 >90% 恒真、`state-lock-taken-over` 是纯内务事件（用户零可动作）；
     `judge:1021-1027` 正是 F270 P3 为此做的收窄纪律，本卡**必须复用**而不是各写一遍。
   - **默认值 = `false`**：新码不写这一列即视为不可见；要设 `true` 必须**显式改表**。
   - **`routeNonBlock` 的裸串打印一并纳入该纪律**（见 G2 处置 3：改走 `buildFeedbackText`）。
4. 守卫**从表派生**（与 `LEDGER_DIAGNOSTICS` / `FOREIGN_DIALECT_DIAGNOSTICS` 同源纪律）：
   - **正向**：`Object.values(JUDGE_DIAGNOSTICS).map(d => d.code)` ⊆ schema enum；
   - **反向**：表内每个码在 judge 源码中确有产出点（防合同登记死码，沿用 `judge-cli.test:1621-1634` 形态）；
   - **空表守卫**：`emitted.length > 0`（防守卫空转）；
   - **`userFacing` 守卫**：本卡新增的 7 个码 `userFacing` 全为 `false`（**新增用户可见码 = 0**），
     且表内**不存在缺 `userFacing` 键的条目**（防"忘写＝落进未定义态"）。

**退出判据（机械验证）**
- [ ] `rg "'(transcript-|feature-dir-|state-|nonblock-|delegation-in-flight|stop-hook-reentry|payload-invalid|internal-error)" plugins/spec-driver/scripts/fix-compliance-judge.mjs` 的命中**全部**落在 `JUDGE_DIAGNOSTICS` 定义块内（产出点零裸字面量）
- [ ] `npm run test:plugins` 零失败
- [ ] **G0 是零裁决变更 Phase**（口径更正，不再写"零行为变更"）：G0 前后跑同一组 B-1 / B-3 复现脚本，
      **退出码序列 + 三个计数器序列 + 审计事件 `diagnostics` 集合逐字节相同**；
      🔴 **唯一允许的差异是用户可见 stderr 的诊断码渲染面收窄**（`userFacing` 过滤，R2-7）——
      该差异**必须**逐条列在 verification-report 里，不得混进"零行为变更"的说法
- [ ] `userFacing` 守卫：表内零缺键条目；本卡 7 个新码全 `false`
- [ ] 变异 M0-a / M0-b / M0-c / **M0-d** 通过（见变异清单）

---

### G1 · 状态文件并发安全 + 计数幂等 + `!saved.ok` 收口（FR-012 / FR-046 第 5 点） [CLEANUP + FIX]

**范围**：`fix-compliance-io.mjs`（新原语 + `normalizeState` 加 `lastCountedFingerprint` 字段）+ `fix-compliance-judge.mjs`（4 条 RMW 迁移 + 计数 test-and-set + 两处 `!saved.ok` 方向收口）

> 🔴 **边界已按 R2-2 重划**（见上方「G1 / G2 边界重划」）：`lastCountedFingerprint` 字段与**计数半边**在本 Phase 落地；
> **路由半边**（走哪条路由 / 上界 / 终态可见性 / 返回契约）在 G2。

**做什么**

1. **新原语** `export function mutateBlockState(projectRoot, sessionId, mutator)`：
   - 语义：**锁内**完成 `load → mutator(state) → write`。**锁必须包住 load**（只包 write 等于没包，普查硬约束 2）。
   - 锁实现：`fs.openSync(lockPath, 'wx')`（O_EXCL）+ 有界重试 + 同步睡眠 `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)`（**不用忙等**，B-9 实测忙等在竞争下空转 CPU）。重试上界沿用 B-9 原型：**60 × 8ms ≈ 480ms**。
   - **临界区不裹 IO**：`recordWorkflowRun` / `appendAuditEvent` / stderr 一律放锁外（否则把磁盘写与 stderr 拖进同步 hook 的临界区 = DoS 面，F227 教训）。
   - **陈旧锁接管**：**pid 存活校验为主** + **墙钟兜底**（D-8：墙钟单独判据会被 F273 已实证的宿主合盖睡眠 ~5min 冻结击穿 ⟹ 持锁者仍活着却被接管 = 互斥被打破 = **比不加锁更坏**）。接管事件**落码** `state-lock-taken-over`。
     🔴 **R2-12 修订（pid 存活是「存在性判据冒充归属判据」）**：裸 `process.kill(pid, 0)` 只证明"有个进程叫这个号"，
     不证明"就是当初持锁那个"（pid 回卷 / 复用）。故锁内容写 `{ lockId, pid, pidStartedAt, startedAt }`：
     - `lockId` = 每次取锁新生成的随机串，**只由持有者 unlink**、unlink 前先比对 `lockId`（防误删别人的锁）；
     - 接管前除 `process.kill(pid, 0)` 外**再校验进程启动时刻**与 `pidStartedAt` 一致（pid 被复用则不一致 ⟹ 可接管）；
       `bootId` **不做**（成本不成比例，R2-12 明确）。
     - **墙钟兜底阈值由 60s 抬到 `300s`**——覆盖 F273 实证的宿主合盖睡眠 ~5min 冻结。
     - 🔴 **明写：安全性不押在该判据上**。长期占锁对被判方是**阻断方向 = 净损失**，不是绕过面；
       真正的保证是下方两条不变量——「**锁不可得不改变裁决方向**」+「**有界收敛**」。
       归属校验只用来降低"活着的持锁者被误接管"的概率，判错也不会打开放行通道。
   - **锁文件只由持有者 unlink**（撤回初稿「reset 顺手删锁」）。
   - **绝不抛**：任何 `fs` 异常都转成返回态（A-6：拿不到锁就 throw 会让顶层 catch fail-open 静默关门禁）。
   - 返回：`{ ok:boolean, state, lockUnavailable:boolean, degraded:boolean, diagnostics:string[] }`。
     🔴 **`lockUnavailable` 与 `ok:false` 是两个独立返回态，绝不合并**（D-1：`ok:false` 现有映射是「存储不可用＝已达上限」→ `releaseDegraded` → **exit 0**，而锁文件在被判方写域内，`touch` 一个即首次 Stop 放行）。

2. **锁不可得的处置（对 D-1 的精化，已按第 2 轮 R2-9 / R2-10 修订）**
   D-1 定的是"`return 2` + 专码，绝不复用 `ok:false`"。本 plan 按 **R-11（K-2 总上界必须存在）** 与 F208 把它细化为三级，理由是 D-1 未规定上界，而"return 2 且不计数"在字面上是**无界阻断**：

   | 级 | 条件 | 行为 |
   |---|---|---|
   | 1 | 480ms 内拿到锁 | 正常 RMW（含计数 test-and-set） |
   | 2 | 重试耗尽（`lockUnavailable`） | **保持本次裁决自身语义的退出码**：不合规 block 档 → `return 2`；**合规 → `return 0`**；推迟路径 → **不推迟、落回正常裁决**（与 judge:1044 既有 fail-closed 同向）。**不持久化任何计数**，落 `state-lock-unavailable` 专码。<br>🔴 **例外：`resetBlockState` 不得跳过（R2-9）**——见下方专段 |
   | 3 | 连续 `lockUnavailable` 达 **`NONLOCK_DEGRADE_ATTEMPTS = 3`** 次（**与会话长度解耦**的计量，R2-10）；`entryCount >= NONLOCK_DEGRADE_ENTRY_LIMIT` 只作**最终兜底** | **降级为无锁 RMW = 改动前行为** + 同时落 `state-lock-unavailable`。使 `blockCount` 能继续推进 → 2 次后 `releaseDegraded` 放行，会话必然收敛 |

   🔴 **R2-9：级 2 绝不能把 `resetBlockState` 一起跳过**。初稿的"锁不可得 ⟹ 不持久化任何东西"会把 reset 也吞掉
   ⟹ **F211 补救清零失效**（护栏 R-7 实际守不住：用户已经补齐制品、判为合规，旧 `blockCount` 却留着）。
   修法：**reset 是幂等删除、无 read-modify-write ⟹ 根本不需要互斥** ⟹ 锁不可得时走**无锁 `unlink`**。
   （该 unlink 只删状态文件，**不删锁文件**——锁文件仍只由持有者按 `lockId` 比对后 unlink。）

   🔴 **R2-10：级 3 的触发条件必须与会话长度解耦**。初稿用 `entryCount >= 420` 作唯一触发条件有两个致命面：
   ① 它与闸门三的 `entryCount < EARLIEST_FIX_ENTRY_DEFER_LIMIT` **靠常量巧合互斥**——W-c 复测 P95=392 已提议
   重标定 420，**任一方向下调即打开「持锁 + 无锁 RMW ⟹ 无界推迟放行」**；② 97% 的会话根本够不到 420，
   级 3 事实上不存在、级 2 的"无界阻断"没有真上界。
   改为**连续 `lockUnavailable` 次数**（`NONLOCK_DEGRADE_ATTEMPTS = 3`，计数落在状态文件外的**同一把锁的重试统计**上，
   拿不到锁时用 transcript 派生量做 tie-break），420 降为最终兜底。
   并把序关系写成**运行期断言 + 单元钉**：

   ```
   assert(NONLOCK_DEGRADE_ENTRY_LIMIT >= EARLIEST_FIX_ENTRY_DEFER_LIMIT)
   ```

   配变异 **M1-f**（把 `NONLOCK_DEGRADE_ENTRY_LIMIT` 调到小于闸门三 ⟹ 断言与端到端钉必须变红）。

   🔴 **不变量：锁的可得性不得改变裁决方向**（既不额外放行也不额外阻断）——级 2 与级 3 都严格保持"拿到锁时会给的那个退出码"，只是不持久化 / 退回旧持久化。

3. **4 条 RMW 序列全部迁移**到 `mutateBlockState`：
   | # | 现状 | 迁移要点 |
   |---|---|---|
   | ① `routeBlock` judge:638→644 | 同函数内 | 直接包 |
   | ② `routeBlock` judge:638 → `releaseDegraded` judge:721 | **跨函数 + 中间夹 `recordWorkflowRun` 磁盘写 + 5 字段手工透传**（最难） | 🔴 **按 R2-8 改写（初稿"拆两次 mutation"的方案作废）**：见本表后的专段 |

   | ③ `routeNonBlock` judge:763→778 | 同函数内 | 直接包（G2 会重写本函数其余部分，**结构由 G1 先就位**） |
   | ④ 推迟路径 judge:1030→1038 | 同函数内 | 直接包 |

   迁移后 **`releaseDegraded` 的 5 参数手工透传全部消失**（mutator 只改自己那个字段），普查硬约束 3 的 `inFlightDeferCount = 0` 默认值 fail-open 随之消灭。
   `releaseDegraded` **未 export**、生产入口仅 **2 个**（judge:660 / :670），签名变更面小。

   🔴 **序列 ② 的正确形态（R2-8：`degradedRecorded` 是 read-then-act，拆两次 mutation 会 TOCTOU 双写终态）**
   现状 `judge:697` 是 `shouldWriteTerminal = storageUnavailable || !alreadyRecorded`——
   `alreadyRecorded` 在**第一次 mutation 里读**、`degradedRecorded:true` 在**第二次 mutation 里写**，
   中间隔着锁外的 `recordWorkflowRun` 磁盘写。两个并发判定器都会读到 `false` ⟹ **都写终态**。
   初稿写的「幂等标记本就是"最后写赢"，不需要同一临界区」**不成立**——最后写赢的是*标记*，不是*副作用*。
   **正确形态：把「读 `degradedRecorded` + 置 `true`」合进同一次锁内 test-and-set**，返回
   `wasAlreadyRecorded`；`recordWorkflowRun` 依该返回值**在锁外**执行（临界区仍不裹 IO，F227 的 DoS 面不被打开）。
   即：**锁内决定"谁来写终态"，锁外真正去写**。配单元钉 T1-U8 + 并发钉 T1-C4 + 变异 M1-g；
   残余面（test-and-set 成功但锁外写抛错 ⟹ 终态缺失）登记为 **K-18**。

4. **`resetBlockState` 作为一次 mutation 走同一把锁**（D-8）；锁文件**不随 reset 删除**。
   🔴 **R-7 校验**：reset 后必须仍是"新增状态字段无需改 reset"的全量清零语义 —— 迁移后 reset 仍是**删状态文件**，只是删之前先取锁。

5. **`saveBlockState` 保留为底层写**（不删，io 其他消费点与测试依赖），但 JSDoc 中「刻意不做 read-modify-write 合并」的论据段**必须改写**：注明该论据只在单进程成立，跨进程失效，新调用点一律走 `mutateBlockState`。

6. 🔴 **计数幂等键（R2-2 重划边界后落在本 Phase，本 Phase 最重的一项）**

   只加锁而不定义计数幂等键 ⟹ 一次 Stop 的两个进程串行各 `+1` ⟹ 一次 Stop 吃两格 `blockCount`
   ⟹ FR-006 的 2 次补救降为 1 次，且 `judge:706` 的终态文案「在 3 次不合规尝试后降级放行」
   变成**审计流里可证伪的假话**。故：

   - **状态文件新增字段 `lastCountedFingerprint`（缺省 `null`）**，`normalizeState` 对缺字段回落 `null`
     （沿用 `inFlightDeferCount` / `nonBlockStopCount` 的既有向后兼容口径，旧状态文件直接可读）。
   - **计数分支改为锁内 test-and-set**：`mutateBlockState` 的 mutator 内先算本次**证据状态指纹**
     （四分量定义见 G2 处置 1，G1 只负责"算 + 比 + 写回"这条机械链），
     **若 `fp === state.lastCountedFingerprint` ⟹ 本次不重复 `+1`**，直接复用已有计数值；
     否则 `+1` 并在**同一次锁内 mutation** 写回 `lastCountedFingerprint = fp`。
   - **写回纪律**：本 Phase 的计数分支必须写回；G2 接线 `routeNonBlock` 后，**所有**路由分支
     同样 MUST 在同一次锁内 mutation 写回（见 G2 处置 2 的 `null` 吸收态修订）。
   - ⚠️ **失效通道诚实登记（K-13）**：`prompt_id` 不可得的通道（Codex 方言 / 老 harness）**不走指纹去重**
     ⟹ 幂等键在该通道上同样失效 ⟹ 退回「一次 Stop 吃两格」。**该代价不可消除**，只能登记。
   - **`resetBlockState` 无需改**（R-7）：删文件即连同本字段全量清零。

7. 🔴 **`!saved.ok` 方向收口（FR-046 第 5 点下沉到本 Phase · R2-1，主线程实跑复现）**

   **既有缺陷（改动前就存在，本卡因触碰同一路径而纳入）**：`ok:false` 是**自诱发**的。
   把状态文件位置做成目录（主路径 + tmpdir **各一条 `mkdir`**）⟹ 两级写都 EISDIR ⟹ `ok:false`
   ⟹ `routeBlock` 走「存储不可用＝已达上限」⟹ `releaseDegraded` ⟹ **首次 Stop 即 exit 0**。
   实跑对照（/tmp 副本，唯一变量＝状态文件位置是否被目录占位）：
   `A 正常首次 Stop {"exit":2}` vs `B 两级均被目录占位 {"exit":0, "[GATE-DEGRADED] 已达阻断上限(2 次)，本次降级放行"}`。
   **构造成本 = 两条 `mkdir`，零成本、确定性。**

   **归因**：第 1 轮 D-1 只把「存储不可用不可自诱发」这条**错误前提**从锁文件上摘掉，**没有回头复核
   它在 `ok:false` 自己身上是否成立**——而状态目录（`.specify/runs/…`，projectRoot 下）与锁文件
   **在同一个写域**。这正是本仓登记过的「载体复用而不重做失效方向论证」。

   **修法（明确不采纳 errno 分类**——`EISDIR` vs `EACCES` 可被换别的方式打，判据写成 errno 枚举
   等于每加一种打法漏一次，同 F259 教训）：

   > `saveBlockState` / `mutateBlockState` 两级写失败（`!saved.ok`）⟹ **保持本次裁决自身语义**
   > （不合规即 `exit 2`），放行上界挂 **transcript 派生的单调量** `assistantEntriesSinceEarliestFix`
   > （与闸门三 / `NON_BLOCK_ENTRY_LIMIT` 同源）。errno 只作 `state-storage-unavailable` 的诊断 detail、
   > **不参与判定分支**、不新增码。

   🔴 **必须同时覆盖两个检查点**（初稿只写了后者，是本条被漏判的直接原因）：
   | 检查点 | 现状 | 收口后 |
   |---|---|---|
   | **`judge:659-668`（`routeBlock` 侧）** | `!saved.ok` ⟹ `releaseDegraded(storageUnavailable:true)` ⟹ **exit 0** | 保持本次裁决语义 ⟹ **exit 2**；放行上界挂 `assistantEntriesSinceEarliestFix` |
   | **`judge:780`（`routeNonBlock` 侧）** | `!saved.ok` ⟹ 归入耗尽 ⟹ **exit 0** | 同上（G2 重写该函数时**必须保留**本 Phase 定下的方向，不得回退） |

   **范围登记**：这是本卡**新增**的处置项（既有 fail-open，第 2 轮对抗实测发现，不在初稿四组内）。
   **纳入理由**＝它直接破坏护栏 **R-11「总上界必须存在」**（首次 Stop 即无条件放行 = 上界为 0），
   且本卡正在改的就是这条 `!saved.ok` 路径——不修等于在明知缺陷的路径上重写代码。
   既 fail-closed 又不 brick（F208）：把这条绕过的成本从 **0** 抬到 **~420 个 assistant entry**。

**锁文件落点**：`.specify/runs/.fix-compliance-state/<sanitizedSessionId>.lock`（与状态文件同目录，tmpdir 同样两级回落）。
🔴 **R-2 校验**：`SPEC_DRIVER_PROJECT_MARKERS` 只看 `.specify/` 的**直接子项**，`.specify/runs/.fix-compliance-state/*.lock` 不命中 ⟹ 不会自举打开 US5 采集器闸门（对抗第四节点 10 已复核，本 Phase 须留一条回归钉）。

**退出判据（机械验证）**
- [ ] 🔴 **B-2 对照组翻转（判据已按 R2-2 改写，初稿写法作废）**：**同一 payload** 的 2 个并发判定器
      ⟹ `blockCount` **增量 = 1**（不是 2）；跑 **≥5 轮**全部为 1。
      ⚠️ 初稿与 `baseline-reproduction.md` B-2「串行等价值 = 2」列**是把缺陷钉成合同**，verify 阶段须一并更正该列口径
- [ ] **不同 payload**（指纹不同）的 2 次 Stop ⟹ `blockCount` 增量 = **2**（证明幂等键只压同一证据状态、不压真实进展）
- [ ] 8 进程并发各 `+1`，最终计数 = **8**、丢更新 = 0（B-9 加锁臂复现）。
      ⚠️ 这是 **`mutateBlockState` 原语层**的钉（mutator 无条件自增、不经幂等键），与上面两条判据**不是同一层**，不得互相替代
- [ ] **B-1 / B-3 序列逐字不变（限定前提：存储可用）**：退出码与三个计数器的序列与 G1 前逐字节相同
- [ ] 🔴 **存储不可用语料必须翻转**：主路径 + tmpdir 两级被目录占位 ⟹ 首次 Stop 由 **exit 0 翻为 exit 2**（R2-1）；
      且 `judge:659-668` 与 `judge:780` **两个检查点各一条**端到端钉
- [ ] 存储不可用 + `assistantEntriesSinceEarliestFix >= 420` ⟹ 仍走终态可见放行（R-11 上界存在）
- [ ] `grep -c "inFlightDeferCount = 0" fix-compliance-judge.mjs` = **0**（默认值 fail-open 消灭）
- [ ] 4 条 RMW 序列中 `loadBlockState(` 的直接调用点在 judge 中归零（全部走 `mutateBlockState`）
- [ ] 锁不可得三级行为的端到端断言全绿（含"合规 + 锁不可得 ⟹ exit 0"这条**反向**钉）
- [ ] 🔴 **`resetBlockState` 在锁不可得时仍生效**（R2-9）：预置活锁 + 合规会话 ⟹ 状态文件被删、`blockCount` 清零
- [ ] 🔴 **`degradedRecorded` 单写终态**（R2-8）：2 个并发判定器同时进 `releaseDegraded` ⟹ `recordWorkflowRun` 终态记录**恰好 1 条**
- [ ] 🔴 **序关系断言存在且为真**：`NONLOCK_DEGRADE_ENTRY_LIMIT >= EARLIEST_FIX_ENTRY_DEFER_LIMIT`（R2-10）
- [ ] 级 3 触发**与会话长度解耦**：短会话（`entryCount` 远小于 420）连续 3 次 `lockUnavailable` ⟹ 进级 3 降级、`blockCount` 恢复推进
- [ ] 尾延迟：8 路竞争下单进程 p100 < 无竞争基线的 20×（**相对倍数，非墙钟绝对值**，避 F234 教训）
- [ ] `npm run test:plugins` + `npx vitest run` 零失败
- [ ] 变异 **M1-a..M1-i** 全部按预期变红

---

### G2 · GATE 证据指纹**路由半边** + `routeNonBlock` 返回契约重写（FR-026..029 / FR-046 第 1–4 点）

**范围**：`fix-compliance-judge.mjs` + schema
（`lastCountedFingerprint` 字段、`normalizeState` 向后兼容、指纹计算与**计数半边**已在 **G1** 落地，本 Phase **不重复**）

🔴 **本 Phase 不可拆分提交**：返回契约重写与接线 MUST 同一提交（D-6）。

**T-0 前置回归钉（P-2，见 Technical Context）**：用 F270 已录制的真实 Stop payload fixture 断言 `prompt_id` 存在且被指纹消费。结论**必须**写进 `research/` 或本 Phase 的验证记录，不得口头带过。

**做什么**

1. **指纹定义**（四分量，全部由判定器自算或取 harness 字段，**禁止任何文本启发式**——A-4 已证伪、K-7 裁决）：

   | 分量 | 取值 | 来源 | 风险登记 |
   |---|---|---|---|
   | `prompt_id` | `payload.prompt_id`。🔴 **缺席 ⟹ 本次 Stop 不走指纹去重、按 `routeBlock` 处理（＝改动前行为）+ 落 `gate-fingerprint-partial`**（R2-4：**撤回 sentinel 兜底**） | harness | **W-a**：只随用户发新消息变；GATE 暂停里用户常来回 1-2 句 ⟹ 指纹变 ⟹ 计数恢复。对绕过面正确（防永久豁免），对误伤面负收益。<br>🔴 **W-d（R2-4）**：四分量在冻结窗口内三项天然恒定，本项是唯一由外部扰动的分量——**故它绝不能被 sentinel 补齐**：那会让缺该字段的整个平台指纹恒定、`blockCount` 恒 0，被判方**只需选平台**。违反 F224「fail-open 必须按维度收窄」 |
   | 缺失集合 | `verdict.missing` 排序后 join | 自算 | — |
   | 账本条目数 | 锚点窗口内账本委派条目数（`readLedgerDelegations` 返回长度） | 自算 | **W-b**：主线程持续派子代理 ⟹ 每次变 ⟹ G2 去重**零保护**（正是 B-6 现场形态）。**B-6 由 G3 覆盖，不由 G2 覆盖** |
   | 锚点位置 | `anchor.latestFixLineIndex` | 自算 | 🔴 **R-5**：**必须**用 `latestFixLineIndex`，**绝不**误取 `earliestFixLineIndex`（judge:95-100 红字"不要改回去"），也**不得**把两者合并 |

   存储：`crypto.createHash('sha256')` 摘要写入状态文件字段 `lastCountedFingerprint`（G1 已建，缺省 `null`）。
   🔴 **R-7**：reset 删文件即全量清零，本字段无需改 `resetBlockState` —— 该性质须留回归钉。

2. **路由规则（Design X，D-4；已按第 2 轮 R2-3 三处修正）**

   🔴 **修正 ①：所有路由分支 MUST 写回指纹**。初稿只规定「有进展 ⟹ `routeBlock` 并写回」，
   **没规定 `routeNonBlock` 写不写**。不写 ⟹ `lastCountedFingerprint` **永不脱离 `null`** ⟹ 每轮命中
   `=== null` 析取 ⟹ **`routeBlock` 在任何新会话中结构性不可达、`blockCount` 恒 0**（`null` 是吸收态）。
   故明写：**`routeNonBlock` 与 `routeBlock` 两条分支都 MUST 在同一次锁内 mutation 写回本次指纹**
   （与 G1 的计数 test-and-set 是同一次 mutation，不得拆成两次）。

   🔴 **修正 ②：判据改为互斥三分，消除 `last === null` 时两条子句同时成立的二义**：

   | 条件（互斥、穷尽） | 路由 | `blockCount` | 写回指纹 |
   |---|---|---|---|
   | `last === null`（会话内首次） | `routeNonBlock` + `gate-fingerprint-no-progress` | 不计 | ✅ MUST |
   | `last !== null && fp === last`（无进展） | `routeNonBlock` + `gate-fingerprint-no-progress` | 不计 | ✅ MUST（幂等写） |
   | `last !== null && fp !== last`（有进展） | `routeBlock` | `+1`（经 G1 的锁内 test-and-set） | ✅ MUST |

   - 🔴 **指纹只可用于收紧，不可用于放宽**（D-5）：只有"指纹变化"才允许推进 `blockCount` 计数，任何指纹状态都**不得**直接导致 `return 0`。
   - 🔴 **`prompt_id` 缺席 ⟹ 整条指纹路由不生效**（R2-4），直接走 `routeBlock` + `gate-fingerprint-partial`，见处置 1。
   - 🔴 **指纹路由仅在 `enforcement === 'block'` 下生效**（R2-6），见处置 5。

   **为什么是 Design X 而不是 Design Y**（无历史指纹 → `routeBlock`）：Y 会让冻结暂停多吃一次 exit 2（2 → 3），且 `blockCount` 增量 1 ≠ 卡面要求的 0。

   ⚠️ **并发下的交互（诚实登记，K-14）**：同一 Stop 的第 2 个进程会看到第 1 个刚写回的指纹 ⟹ 落入
   「无进展」格 ⟹ 走 `routeNonBlock` ⟹ **`blockCount` 增量正确为 1**（这正是 G1 幂等键与本规则是
   "同一机制两半"的体现），但代价是**每个 Stop 额外消耗 1 格 `nonBlockStopCount`**（并发度 N ⟹ N−1 格）。
   方向是 fail-open（组合跑道缩短、更早放行），上界仍由 `NON_BLOCK_LIMIT` + 420 backstop 封顶。
   **verify 阶段须实测该消耗速率并如实登记**，SC 不得写成"并发对预算零影响"。

   **逐轮序列（须成为端到端断言）**

   | 场景 | 序列 | vs 基线 |
   |---|---|---|
   | 零用户输入的冻结暂停（GATE / 等后台 / 等外部审批） | `exit2(nb=1) → exit2(nb=2) → exit0(终态可见)` | **持平**（基线 2 次阻断），`blockCount` **零增量** ✅ |
   | 有进展但不合规 | `exit2(nb=1) → 指纹变 exit2(b=1) → exit2(b=2) → exit0` | 多一次阻断（fail-closed，多给一次补救机会） |
   | 最短完全绕过 | 仍是吃 2 次 exit 2 后第 3 次放行 | **持平，不更松** |

   **放行地板不变**是采纳 Design X 的前提：两个同形桶阈值都是 2（`NON_BLOCK_LIMIT = BLOCK_LIMIT`，🔴 承重不变量 R-11），交替投桶只会让被判方**多吃** exit 2。

3. **`routeNonBlock` 返回契约重写**（B-7 实测现状为**无条件 `return 0`**，阈值只切审计 trigger、对退出码零影响）
   - 新增参数 `semanticExitCode`（裁决类自身语义的退出码）。GATE 指纹类传 **2**。
   - **未耗尽** → `return semanticExitCode`（不再恒 0）；stderr 文案**必须改**——现文案一律写"本次放行"，接入阻断语义类后会**说假话**（B-7 顺带结论）。
   - 🔴 **阻断分支 MUST 复用 `buildFeedbackText`（R2-5）**：`routeBlock` 的阻断文案走
     `buildFeedbackText(verdict.missing)`（`judge:656`），含**逐项动作行 + 双路径指引**；
     `routeNonBlock` 现在两条 stderr **都是裸模板串**（`judge:809` / `:821`）。
     Design X 下这条路径覆盖 **100% 的不合规首次 Stop（含全部诚实会话）** ⟹ 用户拿到一次 `exit 2`
     却**看不到该补什么**——这是本卡最大的误伤面。
     故：`semanticExitCode === 2` 的分支 MUST 走 `buildFeedbackText(verdict.missing, { diagnostics })`
     （诊断码渲染仍受 G0 的 `userFacing` 过滤约束）。补端到端钉「首次 `exit 2` 的 stderr 含 missing 动作行」。
   - **耗尽**（`fastPathExhausted || backstopExhausted`）→ `return 0`，且**终态可见性 ≥ `releaseDegraded`**（D-5）：
     | 维度 | 现状（更安静） | G2 后 |
     |---|---|---|
     | `recordWorkflowRun.result` | `'paused'` | **`'failed'`**（与 `releaseDegraded` 对齐） |
     | 审计 `degraded` | `false` | **`true`** |
     | stderr 前缀 | `[FIX-COMPLIANCE][WARN]` | **`[FIX-COMPLIANCE][GATE-DEGRADED]`** |
     | trigger 码 | `nonblock-limit-exhausted` / `nonblock-backstop-exhausted` | 保留（两条放行路径仍**可区分**） |
     **理由**：F257 缺陷 2 的原文教训——"两条放行路径可见性不对等，更安静那条成为首选绕过面"。
     **连带合同变更**：schema `degraded` 的 description 须从"达到阻断上限后的降级放行"扩为"**任一有界预算（`blockCount` 或 `nonBlockStopCount`）耗尽后的降级放行**"。
     ⚠️ 该改动会让既有"`degraded===true` ⟺ blockCount 降级"的断言变红——**这正是守卫有牙齿的证据**，逐条改断言而非放宽。
   - 🔴 **耗尽放行的 `complianceVerdict.blockCount` MUST 传数值，不得传 `null`（R2-11）**：
     主线程复核 `record-workflow-run.mjs:255` —— 该键**只在 `typeof === 'number'` 时被保留**，
     `routeNonBlock` 现在传 `null` ⟹ **键在终态记录里整个消失** ⟹ 完整绕过与合法暂停**在终态记录里同形**，
     D-5 的可见性对齐落空。改为传 `NON_BLOCK_LIMIT` 数值 + **配断言**（钉住"键存在且为 number"）。
   - **`!saved.ok` 的方向**：**已在 G1 处置 7 统一收口**（`judge:659-668` 与 `judge:780` 两个检查点同时改），
     本 Phase 重写 `routeNonBlock` 时 **MUST 保留 G1 定下的方向**（保持本次裁决自身语义 + transcript 派生上界），
     **不得**在重写中回退成"写不进就放行"。
     🔴 与 G1 的 `lockUnavailable` **严格分离**：`ok:false`（两级存储都写不进，**R2-1 已证可自诱发**）→ 按 G1 处置 7；`lockUnavailable` → G1 三级处置，两者**绝不**互相复用映射。
   - **transcript 派生 backstop 保持**：`entryCount >= NON_BLOCK_ENTRY_LIMIT(420)` 单调量直接比常量、不存锚。
     🔴 **诚实口径（见「已知下界」专段）**：该性质只保证「**不随状态目录被删而回退**」，**对 transcript 篡改零抵抗**——
     全文**不得**再写"不可擦 / 抹不掉"。

4. **死代码消灭**：`routeNonBlock` / `NON_BLOCK_LIMIT` / `NON_BLOCK_ENTRY_LIMIT` 的"生产零接线"JSDoc 段（judge:70-76 / :95 / :737-746）**全部改写为真实接线状态**，禁止留下与实现相反的注释（F270 的 spec 必答③"一字未改"教训）。

5. 🔴 **`warn` 档保护（R2-6，初稿全文零处提及此档 ⟹ 结构性盲区）**

   `runHook` 的既有推迟逻辑插在 **`warn` 分支（`judge:1064-1072`）之前**。G2 若照抄该插入点，
   `semanticExitCode = 2` 会让 **`warn` 档返回 2**，直接推翻 F208 三档语义（**`warn` 恒 `exit 0`** 是硬合同）。

   - **明写规则：指纹路由仅在 `enforcement === 'block'` 下生效。** `warn` / `off` 档一律走既有分支，
     指纹既不参与路由、也不影响退出码。
   - **`warn` 档是否写回指纹**：**不写回**（`warn` 档不产生任何计数语义，写回会让后续切回 `block` 档时
     首次 Stop 被误判为"无进展"）。
   - **补反向钉**：`warn` + 指纹无进展 ⟹ **`exit 0`**（T2-E9）；配变异 **M2-j**（把指纹路由插到 `warn` 分支之前）。

**退出判据（机械验证）**
🔴 **退出判据必须双向（R2-3 ③）**：初稿只写「冻结语料 `blockCount` 全程 0」——**一个指纹永不写回的
完全跑坏的实现 100% 满足它**（`null` 吸收态 ⟹ `routeBlock` 结构性不可达 ⟹ 恒 0），F231「全绿是反指标」原样重演。
以下前两条**必须成对通过**，缺一即 Phase 不通过：

- [ ] **（正向）B-1 对照组翻转**：GATE 暂停语料连续 4 次 Stop，`blockCount` **全程 0**（改动前 0→1→2）；`nonBlockStopCount` 序列为 `1→2→2→2`；退出码 `2,2,0,0`
- [ ] 🔴 **（反向，与上一条成对）有进展语料 `blockCount` 达 2**：证据状态每轮变化的语料 ⟹ `blockCount` 能推进到 `BLOCK_LIMIT` 并触发 `releaseDegraded`（证明 `routeBlock` 可达、指纹确实被写回）
- [ ] `nonBlockStopCount` 在生产路径上**非零**（B-1 的"全程 0"是零接线的直接观测证据，翻转即证接线成功）
- [ ] `rg -c "routeNonBlock\(" fix-compliance-judge.mjs` 在**非定义、非注释**处 ≥ 1（生产调用点存在）
- [ ] 三条逐轮序列端到端断言全绿（表见上）
- [ ] 🔴 **写回纪律**：`routeNonBlock` 分支执行后，状态文件的 `lastCountedFingerprint` **非 `null`**（R2-3 ①）
- [ ] 🔴 **`warn` 档反向钉**：`warn` + 指纹无进展 ⟹ **`exit 0`**（R2-6，F208 三档语义不被推翻）
- [ ] 🔴 **误伤面钉**：首次不合规 Stop 的 `exit 2` stderr **含 missing 逐项动作行**（R2-5，`buildFeedbackText` 已复用）
- [ ] 🔴 **缺 `prompt_id` 的 payload ⟹ `blockCount` 正常推进**（R2-4，撤回 sentinel 后不得整个平台恒 0）+ 落 `gate-fingerprint-partial`
- [ ] 🔴 **耗尽放行的终态记录里 `complianceVerdict.blockCount` 键存在且 `typeof === 'number'`**（R2-11，传 `null` 会让键消失）
- [ ] `NON_BLOCK_LIMIT >= BLOCK_LIMIT` 不变量断言仍在且为真（R-11）
- [ ] 指纹分量断言：改 `latestFixLineIndex` ⟹ 指纹变；改 `earliestFixLineIndex` ⟹ 指纹**不变**（R-5 方向钉）
- [ ] 状态文件被 `rm -rf` 后，420 backstop 仍独立生效（**"不随状态目录删除而回退"回归；不声称抗篡改**）
- [ ] **G2 新增的 2 个码**（`gate-fingerprint-no-progress` / `gate-fingerprint-partial`）已入 `JUDGE_DIAGNOSTICS`（`userFacing:false`）且经 G0 派生守卫确认 ⊆ schema enum
- [ ] 变异 **M2-a..M2-j** 全部按预期变红（尤其 **M2-a：`routeNonBlock` 首行改 `return 0` 必须有端到端失败**——这是本卡的核心教训钉）

---

### G3 · PENDING 自愈路径（FR-030 / FR-032）[纯可观测性 + 文档]

**范围**：`skills/spec-driver-fix/SKILL.md` + `fix-compliance-judge.mjs`（judge:522 传参）+ `fix-compliance-core.mjs`（判据）+ schema

🔴 **不动任何预算**（用户拍板）：不抬 `IN_FLIGHT_DEFER_LIMIT`。理由：`classifyInFlightFromPayload` 的判据是纯"数组非空"，
一条 `sleep` 即可触发，抬预算等于把一条已登记（F270「重大-5」）的、确定性的、零成本自诱发的放行通道从 3 次放大到 N 次。
**在途相关性过滤保持 F270 的移交状态。**

**做什么**

(a) **SKILL 成文（主要交付物）**——把 F269 现场发明的惯例写进 `spec-driver-fix` SKILL 的 verify 阶段：
   - 长等待（等用户拍板 / 等后台审查子代理 / 等外部审批）时，**先落盘** `verification/verification-report.md`；
   - 未完项标 `PENDING` 并**写明回填触发条件**；
   - 触发条件满足后回填并更新。
   ⟹ 长等待因此变成**合规态**，不必烧任何预算。
   🔴 **措辞边界**：SKILL 只写惯例，**不得**暗示判定器会校验"回填条件是否写明"（FR-031 已裁剪）。
   🔴 **受控生成链**：改后必须 `npm run repo:sync` 重生 `skills-codex/spec-driver-fix/SKILL.md` 并重算 `Source SHA256`。

   **附带登记（A-3 归因修正，非本卡代码改动）**：B-6 现场误伤的 `delegation:verify` 缺口**不会因等待自愈**——
   异构对抗子代理用 `subagent_type: general-purpose` + description「Phase1 对抗-误伤面」，
   `VERIFY_ROLE_REGEX = /verify|quality-review|spec-review|review|验证|审查/i`（core:375）**两项都不命中** ⟹ 分类为 `other`。
   修法是**改本仓派发约定**（对抗子代理 description 必须含"审查/核实/验证"），**不改判据**（把 `general-purpose` 计入 verify 类会放宽判据、与 F208 语义冲突）。
   该约定属 `CLAUDE.local.md` 档位表范畴，**本卡不改判定器**，登记为流程输入。

(b) **判定器识别 PENDING 并落诊断码 + 未回填项计数（FR-032，纯可观测性、不改判）**：
   - `judge:522` 增传 `content`（当前只传 `{exists, nonEmpty}` 两个布尔）。
     🔴 **R-8 / 普查硬约束 4**：唯一判据在 core:1809-1810，`readArtifactFile` 无体积上限不截断；
     **不得触碰**见证侧 `ANCHORED_ARTIFACT_PATH_REGEX` 只查 fix-report.md 的不对称（加回见证侧即复活红队绕过链）。
   - 判据宽松（因为**不改判**，误判成本仅为诊断噪声）：扫描 `PENDING` / `待用户` / `待回填` / `DEFERRED` / `⏸️` 等标记。
     🔴 **初稿判据实测超计 2–4×，必须按 R2-13 收窄**（子代理在 **190 份真实报告**上跑出：命中 **27 份 / 81 行**，
     其中「**等**待用户」类交付散文 **16/81 = 19.8%**、同行已标 ✅/已完成 **15/81 = 18.5%**）：
     | 修正 | 内容 |
     |---|---|
     | 词法 | `待用户` → **`(?<!等)待用户`**（排除"等待用户"这类交付散文） |
     | 已完成过滤 | 同行含 **✅ / 已完成 / 已回填** 的一律**不计** |
     | 🔴 计数单位 | **改「节」而非「命中行」**——`pendingItemCount` 计的是**未回填的 PENDING 条目（节）数**，同一节内多行命中只计 1。SC 与 schema description 必须写清该单位 |
     （代码围栏内误计已被数据推翻：81 行命中中围栏内 **0 行**，故**不另加**围栏排除逻辑。）
   - 落码 `verification-report-pending` + schema 新增 `pendingItemCount: {type:["integer","null"]}`（`additionalProperties:false` 下必须登记）。
   - 🔴 **绝不**把 PENDING 转成新的 missing 键（FR-031 裁剪的连锁：新键不入 `DEFERRABLE_MISSING_KEYS` ⟹ `isDeferrableMissingSet` 全称判定关闭整条推迟通道；`buildFeedbackText` 的 `.filter(Boolean)` ⟹ 空阻断）。

**退出判据（机械验证）**
- [ ] `npm run repo:check` 零失败（SKILL 双写与 `Source SHA256` 已同步）
- [ ] **FR-030 回归钉（语料按 R2-13 扩容）**：190 份真实 verification-report 中**判据实际触发的 27 份**
      （非初稿的 12 份——12 份是 FR-031 收紧风险的语料，与本判据触发面不是同一集合），
      改动前后判定结果**逐份一致且全部 PASS**（零翻转）
- [ ] 🔴 **超计回归**：27 份语料上，「等待用户」类命中 = **0**、同行含 ✅/已完成的命中 = **0**（R2-13 两条词法修正生效）
- [ ] FR-032 端到端：含 3 **节** 未回填 PENDING 的报告 ⟹ 审计事件 `diagnostics` 含 `verification-report-pending` 且 `pendingItemCount === 3`（**计数单位 = 节**）
- [ ] **不改判断言**：同一语料在 `pendingItemCount` 为 0 / 3 / 99 三种情况下，退出码与三个计数器**完全相同**
- [ ] `rg "DEFERRABLE_MISSING_KEYS" fix-compliance-core.mjs` 的键集与 G3 前**逐字节相同**（未偷偷加键）
- [ ] 变异 M3-a / M3-b 按预期变红

---

### G4 · snapshot-stale 专码（FR-033）[纯诊断码]

**范围**：`fix-compliance-judge.mjs`（payload 消费）+ `fix-compliance-core.mjs`（集合构造 helper）+ schema

🔴 **纯诊断码：不改路由、不进任何预算桶**（D-2，两路对抗独立命中）。
接路由既是已证伪路线 #21 的反向同型（自生成文本换取更宽处置），又会吃光 G2 的 `NON_BLOCK_LIMIT=2` 预算而**静默抵消 G2**。

**做什么**
- 判据用**集合归属**：`payload.last_assistant_message ∈ { 每条 assistant 条目的 textBlocks.join("\n").trim() }`。
  🔴 **绝不**用裸子串、**绝不**用"尾部相等"。真实语料实测（454 份 transcript）：末行**不是** assistant 条目 **453/454 = 99.8%**；`join("\n").trim()` 后含换行导致裸子串比对失败 **49/454 = 10.8%**。
- 三态分码（FR-033 原文要求）：
  | 态 | 码 |
  |---|---|
  | 键缺席 | `snapshot-message-absent` |
  | 取到且 ∈ 集合 | 无码（平凡态，不进 stderr 噪声） |
  | 取到且 ∉ 集合 | **`snapshot-stale`**（专码仅用于此态） |
- **命名区分**：与 F236 的 `judge-snapshot-*`（插件安装快照漂移）**同名不同物**，码名与注释须显式区分，避免语义撞车。
- 🔴 **落点严格限定（R2-7 / 绕过面 I-A）**：两码**只入 `buildAuditEvent` 的 `extraDiagnostics`**，
  **不入 `deferExtraDiagnostics`**。理由：`deferExtraDiagnostics` 会流进 `warn` 分支与推迟分支的
  `buildFeedbackText`，把纯内务码推到用户 stderr；且 `snapshot-stale` 可能 >90% 恒真，一旦进用户面
  就是**每次都出现的噪声**。两码在 canonical 表中 `userFacing: false`，G0 的渲染过滤是第二道闸。

**诚实登记（写进码的 JSDoc 与 SC，禁止 over-claim）**
该量度量的是 **harness 刷盘行为**，**不是**"病根 i 残余误伤率"——F262 已实证本 harness 主 transcript 懒刷盘滞后 25+ 分钟。
故 SC 只能写"缺席与陈旧在审计流中可区分"，**不得**写"残余误伤已可度量"。

**退出判据（机械验证）**
- [ ] **B-4 对照组翻转**：`rg "last_assistant_message" plugins/spec-driver/scripts/`（排除 tests）从**零命中**变为有生产消费点
- [ ] 三态端到端各 1 条钉（键缺席 / 命中 / 不命中），断言诊断码正确
- [ ] **零改判断言**：三态下退出码与三个计数器**完全相同**；`nonBlockStopCount` / `blockCount` / `inFlightDeferCount` 均无增量
- [ ] **触发率实测（防噪声码 over-claim）**：在本机 ≥454 份真实 transcript 上跑判据，登记 `snapshot-stale` 触发率。
      若近乎恒真（> 90%），**必须**在 verification-report 中登记"该码信噪比未达可用，仅满足 FR-033 的分码字面要求"，禁止声称"已具备可区分性"
- [ ] 🔴 **两码不进用户 stderr**（R2-7）：三态语料的 stderr **均不含** `snapshot-stale` / `snapshot-message-absent`；
      且 `rg "deferExtraDiagnostics.*snapshot-" fix-compliance-judge.mjs` **零命中**
- [ ] 变异 **M4-a / M4-b / M4-c** 按预期变红

---

## TDD 测试清单（红先行）

> 🔴 **本卡的核心教训**：`routeNonBlock` 的单元测试**直接 import 函数**，端到端零覆盖，
> 导致"生产零接线"在测试全绿下存活（F270 变异 M9：首行改 `return 0` 只红 5 个单元用例、**零端到端失败**）。
> 故 **每条新判据至少一条端到端钉**——走 `fix-compliance-judge.mjs` **CLI 进程**（`runCli`）+ 真实 payload，
> 不允许只有 `import { fn }` 形态的覆盖。

**落点**：单元 → `tests/fix-compliance-io.test.mjs` / `tests/fix-compliance-core.test.mjs`；端到端 → `tests/fix-compliance-judge-cli.test.mjs`（既有 `runCli` harness）。

### G0

| # | 类型 | 断言 |
|---|---|---|
| T0-U1 | 单元 | `JUDGE_DIAGNOSTICS` 是 `Object.isFrozen` 的；值集非空 |
| T0-U2 | 单元（派生守卫·正向） | `Object.values(JUDGE_DIAGNOSTICS)` ⊆ schema enum |
| T0-U3 | 单元（派生守卫·反向） | 表内每个码在 judge 源码中确有产出点（防死码） |
| T0-U4 | 单元（反模板串） | judge 源码中无 `` `...${...}` `` 形态拼接诊断码 |
| **T0-U5** | **单元（`userFacing` 守卫，R2-7）** | 表内**零条目缺 `userFacing` 键**；本卡 7 个新码全部 `userFacing===false`（新增用户可见码 = 0） |
| **T0-E1** | **端到端** | G0 前后同一 B-1 语料，退出码序列 + 三计数器序列 + 审计 `diagnostics` 集合**逐字节相同**（零**裁决**变更证明） |
| **T0-E2** | **端到端（`userFacing` 渲染面）** | 一条带 `userFacing:false` 码的裁决 ⟹ 该码**在审计事件中存在、在 stderr 中缺席**；把该码改成 `userFacing:true` ⟹ stderr 出现（双向钉，防过滤器空转） |

### G1

| # | 类型 | 断言 |
|---|---|---|
| T1-U1 | 单元 | `mutateBlockState` 锁内 load：mutator 收到的 state 是**取锁后**读的（用锁外并发改文件构造） |
| T1-U2 | 单元 | 重试上界：锁被长期占用时 ≤ 480ms 返回 `lockUnavailable:true`，**不抛** |
| T1-U3 | 单元 | 陈旧锁接管四态（阈值按 R2-12 抬到 **300s**）：pid 不存活 ⟹ 接管 + 落 `state-lock-taken-over`；**pid 存活但 `pidStartedAt` 不匹配**（pid 复用）⟹ 接管；**pid 存活 + 匹配 + 墙钟 > 300s** ⟹ 接管；**pid 存活 + 匹配 + 墙钟 < 300s** ⟹ **不接管**（D-8 反向钉，防 F273 合盖睡眠 ~5min 冻结击穿） |
| T1-U4 | 单元 | 锁文件只由持有者 unlink（**按 `lockId` 比对**，R2-12）；`resetBlockState` 后锁文件仍在 |
| T1-U5 | 单元 | `mutateBlockState` 保全所有未被 mutator 触碰的字段（含未来新增字段：用注入一个多余字段的状态文件测） |
| **T1-U8** | **单元（R2-8 · TOCTOU）** | `degradedRecorded` 的「读 + 置 `true`」在**同一次锁内 mutation** 完成并返回 `wasAlreadyRecorded`；第二次调用返回 `true`（test-and-set 语义） |
| **T1-U9** | **单元（R2-10 · 序关系）** | 断言 `NONLOCK_DEGRADE_ENTRY_LIMIT >= EARLIEST_FIX_ENTRY_DEFER_LIMIT` 存在且为真 |
| T1-U10 | 单元（向后兼容） | `normalizeState` 对缺 `lastCountedFingerprint` 的旧状态文件回落 `null` |
| **T1-C1** | **并发（多进程真跑，非单进程模拟）** | 🔴 **判据已按 R2-2 改写**：**同一 payload** 的 N=2 判定器 ⟹ `blockCount` **增量 = 1**（不是 2），**≥5 轮全部通过**（B-2 翻转的正确形态） |
| **T1-C3** | **并发（多进程，与 C1 成对）** | **不同 payload**（指纹不同）的 2 次 Stop ⟹ `blockCount` 增量 = **2**（证明幂等键不压真实进展） |
| **T1-C4** | **并发（R2-8）** | 2 个并发判定器同时进 `releaseDegraded` ⟹ `recordWorkflowRun` 终态记录**恰好 1 条** |
| **T1-C2** | **并发（多进程 · 原语层）** | 8 进程各 +1 ⟹ 最终 = 8、丢更新 0（mutator 无条件自增，**不经幂等键**，与 C1/C3 不同层） |
| **T1-E1** | **端到端** | 锁不可得（预置一个 pid 存活的锁）+ **不合规** ⟹ `exit 2` + `state-lock-unavailable` 码 + `blockCount` **无增量** |
| **T1-E2** | **端到端（反向钉，最关键）** | 锁不可得 + **合规** ⟹ **`exit 0`**（绝不能把合规会话变成阻断） |
| **T1-E3** | **端到端** | 锁不可得 + 推迟路径 ⟹ **不推迟**、落回正常裁决（fail-closed 方向钉） |
| **T1-E4** | **端到端（R2-10 改写）** | 锁不可得**连续 3 次**（`NONLOCK_DEGRADE_ATTEMPTS`，**短会话、`entryCount` 远小于 420**）⟹ 降级无锁写、`blockCount` 恢复推进 ⟹ 2 次后 `releaseDegraded`（K-2 总上界钉，且**与会话长度解耦**） |
| **T1-E5** | **端到端** | 🔴 **D-1 专钉**：被判方 `touch` 一个锁文件 ⟹ 首次 Stop **不放行**（`exit 2`），即"锁不可得 ≠ `ok:false` ≠ exit 0" |
| **T1-E6** | **端到端** | B-1 / B-3 全序列与 G1 前逐字相同（**限定前提：存储可用**） |
| **T1-E7** | **端到端（🔴 R2-1，本 Phase 最关键的翻转钉）** | **主路径 + tmpdir 两级均被目录占位**（两条 `mkdir`）+ 不合规 ⟹ 首次 Stop 由 **`exit 0` 翻为 `exit 2`**，走 `judge:659-668`（`routeBlock` 侧）路径 |
| **T1-E8** | **端到端（R2-1 第二个检查点）** | 同上构造但走 `routeNonBlock` 侧（`judge:780`）⟹ 同样**不放行**（两个检查点各一条，缺一即漏） |
| **T1-E9** | **端到端（R2-1 上界钉）** | 存储不可用 + `assistantEntriesSinceEarliestFix >= 420` ⟹ 仍走终态可见放行（R-11 上界存在，不 brick） |
| **T1-E10** | **端到端（🔴 R2-9）** | 预置**活锁**（pid 存活、`lockId` 匹配、墙钟 < 300s）+ **合规**会话 ⟹ `resetBlockState` 仍生效：状态文件被删、`blockCount` 清零（F211 补救清零不被锁吞掉） |
| T1-U6 | 单元（R-2 回归） | 锁文件路径不命中 `SPEC_DRIVER_PROJECT_MARKERS` ⟹ 采集器闸门不被自举打开 |
| T1-U7 | 单元（R-10） | `JUDGE_FILE_SET` 闭包在新增 lib 内容后仍自洽（守卫测试保持绿） |
| T1-P1 | 性能 | 8 路竞争 p100 相对无竞争基线 < 20×（**相对倍数，非墙钟绝对值**，避 F234 教训） |

### G2

| # | 类型 | 断言 |
|---|---|---|
| T2-U1 | 单元 | 指纹四分量：任一分量变 ⟹ 摘要变；全不变 ⟹ 摘要不变 |
| T2-U2 | 单元（R-5 方向钉） | `latestFixLineIndex` 变 ⟹ 指纹变；`earliestFixLineIndex` 变而 latest 不变 ⟹ 指纹**不变** |
| T2-U3 | 单元（🔴 R2-4 改写，sentinel 已撤回） | `prompt_id` 缺席 ⟹ **不走指纹去重、按 `routeBlock` 处理** + 落 `gate-fingerprint-partial`；断言**不存在**任何 sentinel 常量参与指纹计算 |
| T2-U4 | 单元 | `routeNonBlock` 未耗尽 ⟹ 返回 `semanticExitCode`（传 2 得 2，传 0 得 0）；耗尽 ⟹ 返回 0 |
| T2-U5 | 单元 | `routeNonBlock` `!saved.ok` ⟹ **保持本次裁决自身语义**（G1 处置 7 的方向，不得回退成 exit 0 放行） |
| T2-U6 | 单元（回归，字段本身在 G1 落地） | `normalizeState` 对缺 `lastCountedFingerprint` 的旧状态文件回落 `null`（向后兼容） |
| **T2-U10** | **单元（R2-6）** | 指纹路由只在 `enforcement === 'block'` 下被调用；`warn` 档不写回 `lastCountedFingerprint` |
| **T2-E1** | **端到端** | 🔴 **冻结暂停序列**：零用户输入、证据无进展，4 次 Stop ⟹ 退出码 `2,2,0,0`；`blockCount` **全程 0**；`nonBlockStopCount` `1,2,2,2`（B-1 翻转） |
| **T2-E2** | **端到端** | **有进展但不合规**序列：`exit2(nb=1) → 指纹变 exit2(b=1) → exit2(b=2) → exit0` |
| **T2-E3** | **端到端** | **最短完全绕过**不更松：仍是 2 次 exit 2 后第 3 次放行 |
| **T2-E4** | **端到端（D-5 可见性钉）** | `nonBlockStopCount` 耗尽放行 ⟹ `recordWorkflowRun.result === 'failed'` + 审计 `degraded === true` + stderr 带 `[GATE-DEGRADED]` + trigger 码在 `nonblock-*` 中（与 blockCount 降级**可区分**但**同档可见**） |
| **T2-E5** | **端到端（backstop 抗状态目录删除）** | 每轮 Stop 前 `rm -rf` 状态目录 ⟹ `entryCount >= 420` 时仍走终态放行。⚠️ **只钉这一个方向**——对 transcript 篡改不作任何声称（见「已知下界」） |
| **T2-E6** | **端到端（R-7）** | 合规 ⟹ `resetBlockState` ⟹ `lastCountedFingerprint` 一并清零（无需改 reset 的性质保持） |
| **T2-E7** | **端到端（R-3）** | `routeNonBlock` 这条**第 4 条放行路径**的审计事件同样带 `ledgerDiagnostics` |
| **T2-E8** | **端到端（R-11）** | 被判方主动"换桶"的最坏语料：会话非终态 Stop 次数 ≤ **7**（三计时器容量之和 2+2+3），且**最终必落终态放行** |
| **T2-E9** | **端到端（🔴 R2-6 · `warn` 档反向钉）** | `enforcement === 'warn'` + 指纹无进展 ⟹ **`exit 0`**（F208 三档语义：`warn` 恒 0，不被 `semanticExitCode=2` 推翻） |
| **T2-E10** | **端到端（🔴 R2-5 · 误伤面）** | 不合规**首次** Stop（走 `routeNonBlock` 阻断分支）⟹ `exit 2` 且 stderr **含 missing 逐项动作行 + 双路径指引**（与 `routeBlock` 文案同档） |
| **T2-E11** | **端到端（🔴 R2-3 ③ · 与 T2-E1 成对的反向钉）** | **有进展语料**：证据状态每轮变化 ⟹ `blockCount` 推进到 **2** 并触发 `releaseDegraded`。缺此条时 T2-E1 可被"指纹永不写回"的坏实现 100% 满足 |
| **T2-E12** | **端到端（🔴 R2-11）** | `nonBlockStopCount` 耗尽放行的终态记录中 `complianceVerdict.blockCount` **键存在且 `typeof === 'number'`**（传 `null` 会被 `record-workflow-run.mjs:255` 整个丢键，使完整绕过与合法暂停同形） |
| **T2-E13** | **端到端（🔴 R2-4）** | 缺 `prompt_id` 的 payload 连续 Stop ⟹ `blockCount` **正常推进到 2**（不得整个平台恒 0）+ 审计含 `gate-fingerprint-partial` |
| T2-U7 | 单元（不变量） | `NON_BLOCK_LIMIT >= BLOCK_LIMIT` |
| T2-U8 | 单元（合同） | G2 新增的 **2** 个码已入 `JUDGE_DIAGNOSTICS`（⊆ schema enum 由 G0 派生守卫自动覆盖） |
| T2-U9 | 单元（反注释漂移） | judge 源码中不再含 "生产零接线" / "本卡未实现" 等与实现相反的表述 |

### G3

| # | 类型 | 断言 |
|---|---|---|
| T3-U1 | 单元 | PENDING 标记识别：表格单元格 / checkbox / emoji 前缀加粗行 / `MANUAL-PENDING` 四种真实形态均计数正确 |
| T3-U2 | 单元 | `judgeCompliance` 收到 `content` 后，`verificationReport` 的判据仍是 `exists && nonEmpty`（**判据未变**） |
| **T3-E1** | **端到端（FR-030 语料回归 · 🔴 R2-13 扩容）** | **27 份**（判据在 190 份真实报告上的实际触发面，初稿写的 12 份是 FR-031 收紧风险语料、**不是同一集合**）改动前后判定**逐份一致且 PASS**（零翻转） |
| **T3-U5** | **单元（🔴 R2-13 超计回归）** | 「**等**待用户」类交付散文命中 **0**（`(?<!等)待用户`）；同行含 ✅/已完成/已回填 的命中 **0**；同一节内多行命中只计 **1**（计数单位 = 节） |
| **T3-E2** | **端到端（FR-032）** | 含 3 **节**未回填 PENDING ⟹ 审计 `diagnostics` 含 `verification-report-pending`、`pendingItemCount === 3` |
| **T3-E3** | **端到端（不改判钉）** | `pendingItemCount` 为 0 / 3 / 99 三种情况下退出码与三计数器完全相同 |
| T3-U3 | 单元（R-8） | `ANCHORED_ARTIFACT_PATH_REGEX` 与 judge:379-380/410/418 的见证侧集合与 G3 前逐字节相同 |
| T3-U4 | 单元（FR-031 裁剪守卫） | `DEFERRABLE_MISSING_KEYS` 键集与 G3 前逐字节相同（防偷偷加键触发连锁） |
| T3-D1 | 文档 | `repo:check` 通过：`skills-codex/spec-driver-fix/SKILL.md` 与源同步、`Source SHA256` 正确 |

### G4

| # | 类型 | 断言 |
|---|---|---|
| T4-U1 | 单元 | 集合归属判据：`join("\n").trim()` 后含换行的条目仍能命中（裸子串会失败的那 10.8% 形态） |
| T4-U2 | 单元 | 末条 assistant 无 text 块、值来自更早消息 ⟹ 仍命中（5/454 形态） |
| **T4-E1** | **端到端** | 键缺席 ⟹ `snapshot-message-absent`，**无** `snapshot-stale` |
| **T4-E2** | **端到端** | 取到且 ∈ 集合 ⟹ 两码都无 |
| **T4-E3** | **端到端** | 取到且 ∉ 集合 ⟹ `snapshot-stale`，**无** `snapshot-message-absent` |
| **T4-E4** | **端到端（零改判钉，最关键）** | 三态下退出码与 `blockCount` / `nonBlockStopCount` / `inFlightDeferCount` **完全相同**（证明未进任何预算桶、未抵消 G2） |
| **T4-E5** | **端到端（🔴 R2-7 / I-A · 用户可见面）** | 三态语料的 stderr **均不含**两码；两码只出现在审计事件的 `extraDiagnostics` 中，**不出现在** `deferExtraDiagnostics` |
| T4-M1 | 语料实测 | ≥454 份真实 transcript 上的 `snapshot-stale` 触发率，结果落 verification-report |

---

## 变异测试清单（证明守卫有牙齿）

> 方法论沿用 F270：把判据改坏 → 断言**指定测试变红**。
> 🔴 **每条变异必须点名至少一条 `-E` 端到端用例变红**——只红单元用例的变异**不算通过**（那正是 F270 变异 M9 暴露的盲区）。
> 🔴 变异实验在 **/tmp 副本**上跑，跑完**必须 `npm run build` 重建**（F266 教训：变异后忘重建会污染后续验证）。
>
> 🔴 **第 2 轮对抗 R2-14 的自查结论（本清单曾自我违反上述规矩）**：初稿 12 条变异里 **6 条只点名单元用例**、
> **2 条写「任一 `-E`」（不算点名）**。下表已**逐条补齐具体用例编号**；
> **唯一保留豁免的是 M0-a / M0-b / M0-c 三条**——理由与豁免登记见表后专段，**不得**默认扩用到其他 Phase。

| # | Phase | 变异 | 期望变红（**必须点名具体 `-E`**） |
|---|---|---|---|
| M0-a | G0 | 往 `JUDGE_DIAGNOSTICS` 加一个未登记 schema 的新码 | T0-U2（正向守卫）— 证明"加新码漏登记"方向可被抓（F270 教训：硬编码守卫只能抓删、抓不到加）。**`-E` 豁免（见表后）** |
| M0-b | G0 | 从 schema enum 删一个仍在产出的码 | T0-U2。**`-E` 豁免（见表后）** |
| M0-c | G0 | 把某产出点改回裸字面量 | T0-U3 或 T0-U4。**`-E` 豁免（见表后）** |
| **M0-d** | G0 | 🔴 **把 `userFacing` 过滤器改成恒真**（渲染全部诊断码） | **T0-E2**（`userFacing:false` 的码出现在 stderr）+ T0-U5 |
| M1-a | G1 | 把锁**只包 write 不包 load**（还原普查硬约束 2 的错误形态） | **T1-C1** + **T1-E6**（B-1/B-3 序列偏移） |
| M1-b | G1 | 陈旧锁判据**去掉 pid 存活 + `pidStartedAt` 校验、只留墙钟**且阈值调至 5s | **T1-U3 第四条** + **T1-E1**（活着的持锁者被接管 ⟹ 计数被并发覆写 ⟹ `blockCount` 增量偏离） |
| M1-c | G1 | 把 `lockUnavailable` 映射回 `ok:false` 通道（D-1 的原始缺陷） | **T1-E5**（`touch` 锁文件即放行） |
| M1-d | G1 | `mutateBlockState` 在拿不到锁时 `throw` | **T1-U2** + **T1-E1**（顶层 fail-open ⟹ 静默 exit 0，`state-lock-unavailable` 码缺席） |
| M1-e | G1 | 恢复 `releaseDegraded` 的 `inFlightDeferCount = 0` 默认值并在一处漏传 | T1-U5 + **T1-E3**（在途预算被抹平 ⟹ 推迟路径行为偏移） |
| **M1-f** | G1 | 🔴 **把 `NONLOCK_DEGRADE_ENTRY_LIMIT` 调到小于 `EARLIEST_FIX_ENTRY_DEFER_LIMIT`**（R2-10 的"常量巧合互斥"被打破） | **T1-U9**（序关系断言）+ **T1-E4**（持锁 + 无锁 RMW ⟹ 推迟放行失去上界） |
| **M1-g** | G1 | 🔴 **把 `degradedRecorded` 的 test-and-set 拆回"锁内读 / 锁外写"两次 mutation**（R2-8 的 TOCTOU 形态） | **T1-U8** + **T1-C4**（两个并发判定器**都写终态** ⟹ 终态记录 2 条） |
| **M1-h** | G1 | 🔴 **让 `!saved.ok` 改回 `releaseDegraded` 放行**（R2-1 的既有 fail-open 形态，`judge:659-668`） | **T1-E7**（两条 `mkdir` 即首次 Stop 放行）+ **T1-E8**（`routeNonBlock` 侧同形） |
| **M1-i** | G1 | 🔴 **删掉计数 test-and-set**（只加锁、不比指纹，R2-2 的"净变差"形态） | **T1-C1**（同一 payload 并发 ⟹ `blockCount` 增量变 2）+ **T2-E1**（冻结暂停序列被提前吃完预算） |
| **M2-a** | **G2** | 🔴 **`routeNonBlock` 首行改 `return 0`**（F270 变异 M9 的原样重放） | **T2-E1 / T2-E2 必须变红**。若仍只红单元用例 ⟹ **G2 未达成端到端接线**，Phase 不得通过 |
| M2-b | G2 | 指纹改用 `earliestFixLineIndex` | **T2-U2 + T2-E2**（R-5 方向钉） |
| M2-c | G2 | 改成 Design Y（无历史指纹 → `routeBlock`） | **T2-E1**（`blockCount` 不再全程 0） |
| M2-d | G2 | 指纹用于**放宽**（指纹相同即 `return 0`） | **T2-E1**（退出码序列变 `0,0,0,0`）+ T2-E3（最短绕过变松） |
| M2-e | G2 | `routeNonBlock` 耗尽放行改回 `result:'paused'` + `degraded:false` | **T2-E4**（D-5 可见性钉） |
| M2-f | G2 | `!saved.ok` 在 `routeNonBlock` 重写中被改回 exit 0 放行 | T2-U5 + **T1-E8**（存储不可用语料端到端翻回放行） |
| M2-g | G2 | `NON_BLOCK_LIMIT` 改为 1（破 `>= BLOCK_LIMIT`） | T2-U7 + **T2-E3**（放行地板跌破诚实地板） |
| **M2-h** | **G2** | 🔴 **删掉 `routeNonBlock` 的指纹写回**（R2-3 ① 的 `null` 吸收态形态） | **T2-E11 必须变红**（有进展语料的 `blockCount` 再也达不到 2 ⟹ `routeBlock` 结构性不可达）。⚠️ **注意 T2-E1 在此变异下仍然全绿**——这正是"单向判据无法证伪坏实现"的直接演示 |
| **M2-i** | **G2** | 🔴 **给 `prompt_id` 缺席补 sentinel**（R2-4 撤回的形态） | **T2-E13 必须变红**（缺该字段的通道上 `blockCount` 恒 0，整平台放行）+ T2-U3 |
| **M2-j** | **G2** | 🔴 **把指纹路由插到 `warn` 分支之前**（R2-6 的形态） | **T2-E9 必须变红**（`warn` 档返回 2，F208 三档语义被推翻）+ T2-U10 |
| M3-a | G3 | 把 PENDING 转成新的 missing 键（FR-031 的连锁形态） | **T3-E1**（**27 份**语料翻转）+ T3-U4 |
| M3-b | G3 | 让 `pendingItemCount` 参与判定（改判） | **T3-E3**（不改判钉） |
| **M3-c** | G3 | 🔴 **把 `(?<!等)待用户` 改回 `待用户`、并去掉 ✅ 同行过滤**（R2-13 的超计形态） | **T3-U5** + **T3-E2**（`pendingItemCount` 超计 2–4× ⟹ 断言值不再等于 3） |
| M4-a | G4 | 判据改用裸子串 | **T4-U1**（10.8% 形态失败）+ 🔴 **追加子变异：删掉 judge 侧的调用点**（helper 对但生产未接线，F270-M9 同形）⟹ **T4-E3 必须变红** |
| M4-b | G4 | 让 `snapshot-stale` 计入 `nonBlockStopCount`（D-2 判死的形态） | **T4-E4**（零改判钉）+ **T2-E1**（G2 预算被吃 ⟹ 冻结暂停序列变化，证明"静默抵消 G2"可被抓） |
| **M4-c** | G4 | 🔴 **把两码推进 `deferExtraDiagnostics`**（R2-7 / I-A 的用户可见面形态） | **T4-E5 必须变红**（两码出现在用户 stderr） |

**🔴 `-E` 豁免登记（仅 M0-a / M0-b / M0-c 三条，须逐条读，不得推广）**

| 变异 | 豁免理由 | 为什么可接受 |
|---|---|---|
| M0-a / M0-b | 变异对象是**合同守卫本身**（表 ⟷ schema enum 的一致性），**不产生任何运行期行为差**——没有任何 payload 能让"漏登记 schema"在退出码 / 计数器 / stderr 上显形 | 该守卫的价值恰恰在于**它是唯一能抓到这个方向的东西**（F270 已实证硬编码守卫只能抓删）。要求它配 `-E` 等于要求把合同错误伪装成行为错误 |
| M0-c | 变异是"把产出点改回裸字面量"，码值本身**不变** ⟹ 端到端可观测量逐字节相同 | 同上；它防的是**未来漂移**，不是当下行为 |

⚠️ **豁免的边界**：G0 的另一条变异 **M0-d 不在豁免内**——`userFacing` 过滤是**有行为差**的（用户可见 stderr），
故它**必须**点名 `T0-E2`。凡本卡后续再新增 G0 变异，**默认不豁免**，要豁免须按上表格式逐条论证。

---

## 回归护栏表（R-1..R-12 逐条处置）

> 🔴 直接引用 `fix-report.md` 的 R-1..R-12，**不重新发明**。
> R-12 在本卡范围内**当前不成立**（judge 侧无 canonical 诊断码表），**G0 就是为修它而设**。

| # | 不可回退的判据 | 本卡触碰？ | 处置 / 验证方式 |
|---|---|---|---|
| **R-1** | F270 `agent_id` 键存在性判据，writer / reader 谓词**对称** | ❌ 不触碰 | 零改动；F270 变异守卫已在，本卡不新增 |
| **R-2** | US5 白名单闸门（`.specify/` 白名单，非"存在即真"） | ⚠️ **G1 触碰**（新增锁文件） | 锁落 `.specify/runs/.fix-compliance-state/*.lock`；`SPEC_DRIVER_PROJECT_MARKERS` 只看 `.specify/` **直接子项** ⟹ 不命中。**T1-U6 专钉** |
| **R-3** | 审计留痕三路径（合规早退 / `feature-dir-unresolvable` / defer）带 `ledgerDiagnostics` | ⚠️ **G2 新增第 4 条放行路径** | `routeNonBlock` 的审计事件**必须**同样带 `ledgerDiagnostics`。**T2-E7 专钉** |
| **R-4** | 账本委派显式 `noopVerify:false`（`undefined` 是回退触发条件，不是中立值） | ❌ 不触碰 | 零改动 |
| **R-5** | **F257 闸门三取"最早" fix 展开**（judge:95-100 红字"不要改回去"） | ⚠️ **G2 触碰**（指纹含锚点位置） | 指纹**必须**用 `latestFixLineIndex`；两基线**绝不合并**。**T2-U2 双向钉 + M2-b 变异** |
| **R-6** | F208 **三档语义**（`block` / `warn` / `off`，**`warn` 恒 exit 0**）+ **Stop hook 不可 brick 会话** | ⚠️ **G1 + G2 均触碰** | G1 锁**必须有界**（480ms 重试上界 + 三级降级 + **绝不抛**）；G2 的 nonBlock 桶耗尽必放行 + 420 backstop。🔴 **新增（R2-6）**：指纹路由**仅在 `enforcement==='block'` 下生效**，`warn` 档不得因 `semanticExitCode=2` 返回 2。**T1-E4 / T1-U2 / T2-E5 / T2-E8 / T2-E9（`warn` 反向钉）+ M2-j** |
| **R-7** | F211 补救清零（`resetBlockState` 删文件即全量清零；**新增状态字段无需改 reset**） | ⚠️ **G1 + G2 均触碰** | G1：reset 走同一把锁但**仍是删文件**语义；G2：新字段 `lastCountedFingerprint` 随删文件自动清零。🔴 **新增（R2-9）**：**锁不可得时 reset 不得被跳过**——reset 是幂等删除、无 RMW ⟹ 走**无锁 `unlink`**，否则补救清零失效、本条护栏实际守不住。**T2-E6 + T1-E10 专钉**；锁文件**不随 reset 删**（D-8） |
| **R-8** | F216 no-op 证据门（`hasNoopAnchor` 独立触发、命令全文精确匹配 + 见证侧只查 fix-report.md 的不对称） | ⚠️ **G3 触碰**（`verificationReport` 加 `content`） | 只加传参、**不动见证侧**。对抗第四节点 9 已复核传播面很小（唯一判据 core:1809-1810）。**T3-U3 逐字节钉** |
| **R-9** | F231 光杆命令判据 | ❌ 不触碰 | 零改动 |
| **R-10** | `JUDGE_FILE_SET` 闭包（**派生式**，非硬编码） | ⚠️ **G1 可能触碰**（若锁原语拆成新 lib 文件） | 本卡**不新建 lib 文件**（`mutateBlockState` 加在既有 `fix-compliance-io.mjs` 内），闭包不扩张。若实施中确需新文件 ⟹ 闭包自动扩张，**T1-U7 守卫须仍绿** |
| **R-11** | **总上界必须存在（K-2）**：任何"不计数"裁决 MUST 同时规定放行路径；`NON_BLOCK_LIMIT >= BLOCK_LIMIT` 不变量 | 🔴 **G1 + G2 均触碰，且 G1 修的正是一处「上界为 0」的既有破口** | G2 的非计数裁决落 `nonBlockStopCount` + 420 双闸门（**G4 按 D-2 不进任何桶，故不受此条约束**）；G1 的 `lockUnavailable` 路径按三级方案获得上界（`NONLOCK_DEGRADE_ATTEMPTS=3` 为主 + 420 兜底，**序关系配断言 T1-U9 + 变异 M1-f**）。🔴 **新增（R2-1）**：`!saved.ok` 现状是**首次 Stop 即无条件放行 = 上界 0**、且**两条 `mkdir` 即可自诱发**——G1 处置 7 把它收成"保持裁决语义 + transcript 派生上界"，成本由 0 抬到 ~420 entry。**T2-U7 / T2-E8 / T1-E4 / T1-E7 / T1-E8 / T1-E9** |
| **R-12** | 诊断码闭集 enum ⊆ canonical 表（从表派生的同步守卫） | 🔴 **本卡范围内当前不成立** | **G0 建表 + 建守卫**（D-7）。**新增 7 码**（`state-lock-unavailable` / `state-lock-taken-over` / `gate-fingerprint-no-progress` / `gate-fingerprint-partial` / `verification-report-pending` / `snapshot-message-absent` / `snapshot-stale`）全部经表登记。**M0-a 变异证明"加新码漏登记"方向可被抓** |

**账本侧回归对照（不改实现，只作验收）**：`ledger-writer.mjs` 的 `appendFileSync`(O_APPEND) 多进程原子性（B-8 实测 8 进程 × 25 条零撕裂）——
G1 的修复范围**收窄到状态文件一处**，账本侧**零改动**，在 verify 阶段重跑 B-8 作正面对照。

---

## 风险与已知代价登记（F257 纪律：每个新增误阻断形态逐条登记）

| # | Phase | 新增误阻断形态 | 方向 | 可自愈？ | 上界 |
|---|---|---|---|---|---|
| **K-1** | G1 | **锁被活着的进程长期占用** ⟹ 本次不持久化计数、按裁决自身语义 `return 2`，`blockCount` 不增长 ⟹ 连续阻断 | fail-closed | ✅ 持锁者退出后下次即恢复；pid 不存活或 `pidStartedAt` 不匹配则立即接管；墙钟 300s 兜底 | 🔴 **上界按 R2-10 改写**：**连续 3 次 `lockUnavailable`**（`NONLOCK_DEGRADE_ATTEMPTS`，**与会话长度解耦**）即回落无锁写、`blockCount` 恢复推进 ⟹ 2 次后 `releaseDegraded`；420 只作最终兜底。初稿的「≤420 entry」在 97% 会话上够不到，等于**没有上界** |
| **K-2** | G1 | **锁重试延迟**（8 路竞争 p100 ≈ 24ms） | 无方向（纯延迟） | — | 480ms 硬上界（60 × 8ms）。真实竞争度为 2（Codex 双注册），典型代价 ≈ 一个睡眠步长 |
| **K-3** | G2 | **有进展但不合规的会话多吃 1 次 `exit 2`**（首次走 nonBlock 桶，指纹变后才进 block 桶） | fail-closed（多给一次补救机会） | ✅ 补齐制品即合规 | 三计时器容量之和 = **7 次非终态 Stop**（2+2+3） |
| **K-4** | G2 | **W-a**：`prompt_id` 只随用户发新消息变；GATE 暂停期间用户来回 1-2 句 ⟹ 指纹变 ⟹ `blockCount` 计数恢复 ⟹ 去重保护失效 | fail-closed | ✅ 回到基线行为（2 次阻断后降级放行） | 基线上界（`BLOCK_LIMIT=2`）。🔴 **SC 措辞必须钉死为「零用户输入的冻结暂停期间 `blockCount` 零增量」**，不得写成"GATE 暂停零增量" |
| **K-5** | G2 | **W-b**：主线程持续派子代理 ⟹ 账本条目数每次变 ⟹ 指纹变 ⟹ G2 去重**零保护**（正是 B-6 现场形态） | fail-closed | ✅ | 基线上界。🔴 **显式登记：B-6 由 G3 覆盖、不由 G2 覆盖**，SC 不得 over-claim |
| **K-6** | G2 | **组合跑道从"实际 ≤5"变为"≤7"**：接线前 `nonBlockStopCount` 恒 0，实际最坏非终态 Stop 为 5；接线后 nonBlock 桶真正被消耗 ⟹ 7 | 无方向（放行更晚 = fail-closed） | ✅ 必落终态 | **7**（spec SC-015 已登记该理论值，本卡使其成为实况） |
| **K-7** | G2 | schema `degraded` 语义扩张 ⟹ 下游若按"`degraded===true` ⟺ blockCount 降级"推理会误读 | 合同漂移风险（非误阻断） | — | 已盘点：生产侧零消费方（仅 `record-workflow-run.mjs` 消费 `blockCount`），影响面限于测试断言与 schema description |
| **K-8** | G3 | **无新增误阻断形态**（纯可观测性，不改判） | — | — | T3-E3 不改判钉背书 |
| **K-9** | G4 | **无新增误阻断形态**（纯诊断码，不进任何桶） | — | — | T4-E4 零改判钉背书 |
| **K-10** | G4 | **噪声风险**：若 `snapshot-stale` 在真实语料上近乎恒真 ⟹ 该码信噪比不可用 | 可观测性劣化（非误阻断） | — | 由 T4-M1 触发率实测量化并如实登记；**不得**因此声称"残余误伤已可度量" |
| **K-11** | 全卡 | **生效时点（F236）**：`npm run judge:doctor` 当前 `status: drift`（4 mismatch / 2 match / 4 missingInSnapshot），本机 Stop hook 跑的是已安装快照 **4.4.0**，连 F270 的 `ledger-*.mjs` 都不在其中 | — | 需发版 + 插件缓存更新 | 🔴 **所有验收走 worktree 源码直调**（`--project-root` 指向 /tmp 副本），不依赖本机 hook 行为。verify 阶段**必须如实登记**："源码里修好了" ≠ "本机不再误伤" |
| **K-12** | 全卡 | **`npm run lint` / `npm run build` 都是 `tsc`，对 `.mjs` 插件脚本结构性无覆盖**（F269 已登记"tsc 对 tests/ 是空网"同型） | 验证盲区 | — | 🔴 真正的门禁是 **`npm run test:plugins`**；`verificationPolicy.requiredCommands` 的两条**不足以**背书本卡，verify 阶段须显式说明 |

**第 2 轮对抗新增登记（K-13..K-19，按 F257 四要素：形态 / 方向 / 可自愈 / 上界）**

| # | Phase | 新增形态 | 方向 | 可自愈？ | 上界 |
|---|---|---|---|---|---|
| **K-13** | G1 + G2 | 🔴 **缺 `prompt_id` 的通道（Codex 方言 / 老 harness）上，指纹去重与计数幂等键 *同时* 失效** ⟹ 该通道退回「一次 Stop 吃两格 `blockCount`」（R2-4 撤回 sentinel 的**不可消除代价**） | fail-open（补救机会由 2 次减为 1 次）+ 审计文案不诚实（`judge:706` 仍写"3 次"） | ❌ **不可自愈、不可在本卡内消除**——修它需要 harness 侧提供稳定的轮次标识 | 仍受 `BLOCK_LIMIT=2` 与 420 backstop 封顶。🔴 **SC 措辞禁止写"幂等键全平台生效"**；须写"在携带 `prompt_id` 的通道上生效"。移交后续卡：为该通道寻找非文本启发式的替代轮次标识 |
| **K-14** | G2 | **并发度 N ⟹ 每个 Stop 有 N−1 个进程落入 `routeNonBlock`** ⟹ `nonBlockStopCount` 以每 Stop N−1 格的速率被消耗，组合跑道缩短 | fail-open（更早放行） | ✅ 并发度回到 1 即恢复 | `NON_BLOCK_LIMIT=2` + 420 backstop；最坏非终态 Stop 仍 ≤ 7。**verify 阶段须实测消耗速率**，SC 不得写"并发对预算零影响" |
| **K-15** | G1 + G2 | **指纹分量粒度不足 ⟹ 真实进展被误判为无进展**（四分量都没变但用户确实改了别的东西） | fail-open（少计一次 `blockCount`） | ✅ 下一次任一分量变动即恢复 | 基线上界。已由 T1-C3 / T2-E11 双向钉约束：**有进展语料 `blockCount` 必须达 2** |
| **K-16** | G2 | **`routeNonBlock` 复用 `buildFeedbackText` 后，文案与退出码可能不一致**（未耗尽放行分支若误用阻断文案，或反之）——F257「说假话」同型 | 可观测性劣化 / 审计不诚实 | — | 由 T2-E10（`exit 2` 必带动作行）+ 既有"未耗尽放行"文案钉双向约束；实现时**按 `semanticExitCode` 分支选文案**，不共用一条模板 |
| **K-17** | G2 | 🔴 **`warn` 档门控写漏 ⟹ 整个 `warn` 档返回 2**（R2-6）——影响面是**所有 `warn` 档用户的每一次 Stop**，是本卡潜在误伤面最大的一条 | fail-closed，但**大面积误阻断**（推翻 F208 合同） | ✅ 改回即恢复 | 无自然上界（`warn` 档本无计数器）⟹ **只能靠 T2-E9 反向钉 + M2-j 变异守住**，不得依赖人工审查 |
| **K-18** | G1 | **`degradedRecorded` 的 test-and-set 成功但锁外 `recordWorkflowRun` 抛错** ⟹ 标记已置 `true` 而终态未写 ⟹ 该会话终态记录永久缺失（R2-8 修法的残余面） | 可观测性劣化（非误阻断） | ❌ 同会话内不再重试 | 既有 `try/catch` 已保证不 brick；**登记为已知残余**，代价 = 一条审计记录缺失，优于初稿的"两条重复终态"。移交后续卡：若需消除，须把终态写入做成幂等可重放 |
| **K-19** | G1 | **无锁 `unlink`（reset）与持锁写并发** ⟹ 删除后持锁者的写又把状态文件建回来 ⟹ 本次补救清零被覆盖（R2-9 修法的残余面） | fail-closed（旧计数残留 ⟹ 可能多一次阻断） | ✅ 下一次合规 Stop 再次触发 reset 即清零 | `BLOCK_LIMIT=2` 基线上界。**窗口极小**（持锁者的写在 480ms 内完成），且方向是收紧不是放松，故接受 |

---

## 🔴 已知下界：transcript 派生 backstop 的真实强度（诚实化措辞，取代"不可擦"口径）

> 第 2 轮对抗把 `payload.transcript_path` 的写权列为"未复核前提"（若该 JSONL 可被被判方截断 / 重写，
> 则**所有** transcript 派生的兜底共享同一个未验证前提）。**主线程已实测，结论如下。**

**实测结果（两条，均可复现）**：

| 构造 | 效果 |
|---|---|
| **截断 transcript JSONL** | `assistantEntriesSinceEarliestFix` 从 **502 回退到 2** ⟹ 闸门三 / `NON_BLOCK_ENTRY_LIMIT` / G1 处置 7 的 420 兜底**全部被重置** |
| **删掉 fix 展开的锚点行** | `fixSession` 直接翻 **false** ⟹ **判定器零接触、`exit 0`**（连门禁都不进） |

**结论（全文口径，所有相关措辞按此统一）**：

- 所有 transcript 派生的 backstop（**闸门三** / `NON_BLOCK_ENTRY_LIMIT` / **G1 处置 7 新增的 `!saved.ok` 上界**）
  **只保证一件事：不随状态目录（`.specify/runs/…`）被删除而回退**。
- 它们**对 transcript 篡改零抵抗**。
- 🔴 **plan 全文不得再出现"不可擦" / "抹不掉" / "无法擦除"等表述**——那是 over-claim。
  正确写法是「**不随状态目录删除而回退**」。

**为什么仍然接受**：这在本卡**已接受的威胁模型下界**之内——门禁的设计目标是
**防疏忽、防顺手绕过，不防蓄意伪造**（同 F208 立论：伪造代价一旦高于"真的做完"，绕过就失去动机；
而改写自己的 transcript 属于蓄意伪造，已越过该下界）。本卡**不扩大**这个下界，也**不假装**它不存在。

**移交后续卡**：若要把下界抬到"抗篡改"，需要的是**判定器不可写的证据载体**（如 hook 侧实时账本的
只追加副本 + 校验和），属换载体级改动，跨本卡四组范围。

---

## 明确不做（范围边界 · 原样承接 `fix-report.md`，不得偷偷扩范围）

> 🔴 **本卡范围的唯一一次扩张（显式登记，不是偷偷扩）**：**G1 处置 7 的 `!saved.ok` 方向收口**
> （R2-1，第 2 轮对抗实测发现的**既有** fail-open）。
> **纳入理由**：① 它直接破坏护栏 R-11「总上界必须存在」——首次 Stop 即无条件放行、上界为 0；
> ② 构造成本是**两条 `mkdir`**，零成本、确定性；③ 本卡正在改的就是这条 `!saved.ok` 路径，
> 不修等于在明知缺陷的路径上重写代码。
> **不纳入的相邻项**（保持不做）：errno 分类、存储载体更换、`state-storage-unavailable` 之外的新码。

- **`AskUserQuestion` 权威信号增强** —— 用户已拍板移交后续卡。它是"停下来等用户"这层危害的唯一自洽修法（伪造代价＝真的停下等人，与绕过目的自相矛盾），属跨卡面
- **F270 移交的另 5 项**：FR-043/044 活性自检、FR-010 坏行码、FR-011 超限、W-9 账本 `noopVerify` 回退语义、**在途相关性过滤** —— 不在本卡四组内，保持移交状态，SC 对照里**逐条报真实状态**（禁止静默）
- **FR-031** 裸 PENDING 收紧 —— 见覆盖矩阵（D-3，附语料证据与再做前置条件）
- **闸门三 420 重标定** —— 本机独立复测 N=34：P50=202 / P75=276 / P90=322 / **P95=392** / max=1334，**越阈 2.9%**，P95 距阈值仅 7%。登记为**后续卡输入**；本卡不动预算故既有论据仍成立。
  🔴 **但本卡为它留了一道闸（R2-10）**：`NONLOCK_DEGRADE_ENTRY_LIMIT >= EARLIEST_FIX_ENTRY_DEFER_LIMIT`
  已写成**运行期断言 + 单元钉 T1-U9 + 变异 M1-f**——后续卡下调 420 时会**立刻撞红**，
  不会像初稿那样靠"两个常量恰好相等"的巧合维持互斥
- **病根 i 的其余 4 个证据窗口** —— 仍读 transcript，本卡只给它加**可观测量**（G4），不换载体
- **抬高 `IN_FLIGHT_DEFER_LIMIT`** —— 用户拍板不动预算（会把 F270「重大-5」的零成本自诱发放行通道从 3 次放大到 N 次）
- **拆分 `runHook`（165 行）** —— 会与 G2 路由插入点冲突，且 F270 全部对抗结论锚在现有行号上，重排会让护栏引用失效。登记为遗留 debt
- **复用 `src/utils/atomic-write.ts`（F267）** —— 跨 `src/` ↔ `plugins/` 边界，且 `JUDGE_FILE_SET` 闭包不含 `src/`
- **改 `hooks/hooks.json` / `stop-fix-compliance-check.sh`** —— 本卡零新增 hook
- **修改 F270 的 `spec.md`** —— 它是 F270 的历史事实源，本卡只在此 plan 中产出覆盖矩阵对账

---

## 验证命令与执行时点

| 命令 | 时点 | 作用 | 备注 |
|---|---|---|---|
| `npm run test:plugins` | **每个 Phase 结束（承重门禁）** | 跑 `.mjs` 插件测试（judge-cli / core / io） | 🔴 **本卡唯一真正覆盖改动面的验证**（K-12） |
| `npx vitest run` | 每个 Phase 结束 | TS 侧连带回归 | 期望零改动零失败；出现红先按 F251/F274 纪律排查 dist 陈旧（比 `dist/.spectra-build-meta.json` 的 commit vs HEAD） |
| `npm run build` | 每个 Phase 结束 + **每次变异实验后必重建**（F266） | `tsc` 类型检查 | 对 `.mjs` 无覆盖 |
| `npm run lint` | 每个 Phase 结束 | `tsc --noEmit` | 同上，`verificationPolicy.requiredCommands` 之一 |
| `npm run repo:sync` | **G3 改 SKILL.md 之后立即** | 重生 `skills-codex/spec-driver-fix/SKILL.md` + 重算 `Source SHA256` | 漏跑会在 `repo:check` 变红 |
| `npm run repo:check` | **G3 结束 + 最终提交前** | 校验受控生成链同步 | — |
| `npm run release:check` | **最终提交前**（若 bump 版本） | 校验 release contract | 是否 bump 由 verify 阶段决定；bump 则改 `contracts/release-contract.yaml` 后 `release:sync` |
| `npm run judge:doctor` | **最终 verify 阶段** | 登记生效时点 | 🔴 **仅用于如实登记 K-11，不作为通过判据**（当前 `status: drift`，本卡改动在本机 hook 上不会立即生效） |
| `verification/repro/` 复现脚本 | **每个 Phase 的退出判据** | B-1..B-9 对照组翻转验证 | 走 worktree 源码直调 + `--project-root` 指向 /tmp 副本 |

**交付前硬性顺序**（AGENTS.md 分支同步约定）：`git fetch origin master:master` → `git rebase master` → 重跑上述全量 → ff push。

---

## 审查档位（每 Phase 强制）

**常设异构对抗**（2026-09-01 起不随 Codex 配额变化）：每 Phase **≥2 个独立子代理、≥2 切入角**：
- **误伤面**：合法暂停 / 等待被 block；
- **绕过面**：伪装暂停 / 伪造在途 / 操纵锁文件 / 操纵指纹逃判定。

要求**归因而非仅列现象**；对抗实验在 /tmp 副本。GATE_DESIGN 走「对抗 → 修订 → 再对抗至零新 CRITICAL」循环（F270 实证单轮不够）。

**第 2 轮已完成**（8 新 CRITICAL + 6 采纳 WARNING，全部处置见 `verification/gate-design-adversarial-round2.md`，
本 plan 已逐条落实）。**第 2 轮判定：不通过 ⟹ 必须跑第 3 轮**（卡面规定 GATE_DESIGN 走
「对抗 → 修订 → 再对抗**至零新 CRITICAL**」；F270 已实证单轮不够，本卡已实证两轮仍不够）。

**第 3 轮对抗的指定靶子**（＝第 2 轮修订**新引入**的设计点，只审这些 + 自由发挥，不重复已确证项）：
1. **计数幂等键的绕过面**：能否构造让四分量指纹**恒定**（永久不计数）或**恒变**（幂等键失效）的会话形态；
   `crypto` 摘要的分量拼接是否存在**分隔符歧义**（如 missing 集合 join 后与账本条目数拼接产生同值碰撞）。
2. **"所有分支 MUST 写回指纹"是否真互斥穷尽**：三分表之外是否还有第四条路径（异常分支 / 早退 / `off` 档）
   会跳过写回，重新造出 `null` 吸收态。
3. **`warn` 档门控（R2-6）的缝**：`enforcement` 在 `runHook` 里是否存在**先算路由后定档**的顺序，
   使门控失效；`off` 档是否被一并覆盖。
4. **`!saved.ok` 收口（R2-1）后的新 fail-open**：当 `assistantEntriesSinceEarliestFix` **本身缺席/为 null**
   时，新上界是否退化为"立即耗尽 ⟹ 放行"——即把一个 fail-open 换成另一个。
5. **`NONLOCK_DEGRADE_ATTEMPTS=3` 的计量载体**：连续 `lockUnavailable` 次数存在哪里、能否被被判方清零
   （若存状态文件 ⟹ `rm -rf` 即清零 ⟹ 级 3 永不触发 ⟹ 回到"无上界"）。
6. **R2-13 词法修正的误伤面**：`(?<!等)待用户` 与"同行含 ✅ 不计"是否引入**新的漏计**
   （真实未回填项被误判为已完成）；"节"的切分规则在无标题的报告上是否退化。
7. **`userFacing` 过滤（R2-7）的反向误伤**：是否把用户**确实需要看到**的码也藏了
   （尤其 `gate-fingerprint-partial` 这类"判定器降级了"的信号）。
8. **K-13 / K-14 / K-17 三条新登记代价**是否被低估——特别是 K-17（`warn` 档大面积误阻断）没有自然上界。

**第 2 轮已实测确证、第 3 轮不重复审的项**：G4 集合归属判据（859 transcript / 53716 条目，误判率 0%）、
G4 耗时（0.91ms，占端到端 <2%）、G4 键缺席态归因、G3 不改判、锁重试参数（480ms / 8ms，N=2 下 20× 余量）、
R-2 锁文件落点、G0 派生守卫方向、代码围栏内误计数（81 行命中中围栏内 0 行）。

commit message 标注「**Codex 审查暂停，异构档位缺席**」。

---

## Complexity Tracking

> 仅记录偏离最简方案的决策。

| 决策 | 为何需要 | 更简方案为何被否 |
|---|---|---|
| **G0 新建 `JUDGE_DIAGNOSTICS` canonical 表**（增实体，张力于原则 III） | judge 侧诊断码是 16 处散落字面量、**无表** ⟹ R-12 护栏在本卡范围内不成立 ⟹ 新增 7 个码漏登记 schema **零信号**（D-7 实测） | "只把新码登记进 schema、不建表"：守卫只能硬编码码名 ⟹ 只抓得到"删码"、抓不到"加新码漏登记"（F270 已实证该方向盲区） |
| **G1 自建锁原语**（而非复用 `src/utils/atomic-write.ts`） | 宪法原则 X 零运行时依赖 + `JUDGE_FILE_SET` 闭包不含 `src/` | 复用会把闭包撑破跨包边界；引 npm 锁库违反原则 X |
| **G1 锁不可得的三级降级**（而非 D-1 字面的"return 2 + 专码"单级） | D-1 未规定上界，"return 2 且不计数"字面上是**无界阻断**，撞 R-11（K-2 总上界）与 F208 非 brick | 单级方案在被判方长期占锁时会把会话拖成最多 420 entry 的连续阻断且**无收敛机制**；本 plan 的级 3 用 transcript 派生单调量提供收敛。🔴 **已经第 2 轮对抗复审并被两处推翻**：触发条件改为**与会话长度解耦**的 `NONLOCK_DEGRADE_ATTEMPTS=3`（R2-10），且级 2 **不得吞掉 `resetBlockState`**（R2-9） |
| **G2 把返回契约重写与接线捆成同一 Phase / 同一提交** | D-6 明文；且 B-7 实测现状恒 `return 0`，先接线后重写等于送出一条"指纹稳定即免费放行"的一步绕过 | 分两步提交在中间态存在可利用窗口 |
| **G2 让 `nonBlock` 耗尽放行标 `degraded:true`（扩张 schema 语义）** | D-5：终态可见性必须 ≥ `releaseDegraded`，否则复发 F257 缺陷 2「更安静那条成为首选绕过面」 | "只加 trigger 码、终态仍 `paused`/`degraded:false`"：可区分但**不同档可见**，安静通道仍在 |
| **G4 降级为纯诊断码**（放弃接路由） | D-2 两路独立命中：接路由是已证伪路线 #21 的反向同型，且会吃光 `NON_BLOCK_LIMIT=2` 预算**静默抵消 G2** | 接路由方案在 FR-033 字面上并无额外收益（该 FR 只要求两态分码） |
| 🔴 **把计数幂等键下沉到 G1**（打破"G1 只改持久化、G2 才改语义"的整齐分层） | R2-2：`saveBlockState` 的丢更新此前**恰好充当了每 Stop 只计一次的去重**；只加锁不定义幂等键 ⟹ 一次 Stop 吃两格 ⟹ FR-006 的 2 次补救降为 1 次，且 `judge:706` 终态文案变成审计流里可证伪的假话 | "G1 先加锁、G2 再补幂等键"：中间态**净变差**，违反「每个 Phase 落地后都不得劣化」。幂等键与无进展去重本就是同一机制的两半，分批实现是错误切分 |
| 🔴 **G1 新增 `!saved.ok` 方向收口**（扩范围） | R2-1 主线程实跑复现：两条 `mkdir` ⟹ 首次 Stop `exit 0`。它破坏 R-11「总上界必须存在」（上界为 0），且本卡正在改同一条路径 | "留给后续卡"：本卡会在明知缺陷的路径上重写代码，重写后该缺陷仍在且更难归因。"用 errno 分类修"：`EISDIR`/`EACCES` 可被换别的方式打，判据写成值枚举=每加一种打法漏一次（F259 同型） |
| 🔴 **撤回 `prompt_id` sentinel，接受"该通道退回一次 Stop 吃两格"** | R2-4：sentinel 让四分量全落进被判方域 ⟹ 缺该字段的**整个平台** `blockCount` 恒 0，被判方只需选平台。违反 F224「fail-open 必须按维度收窄」 | "用 sentinel 保证全平台一致行为"：一致地失效不是一致地工作。当前取"降级不承重"＝该通道退回改动前行为（不更松），代价诚实登记为 K-13 |
| 🔴 **级 3 触发条件从 `entryCount >= 420` 改为连续 `lockUnavailable` 次数** | R2-10：420 与闸门三**靠常量巧合互斥**，任一方向下调即打开无界推迟放行；且 97% 会话够不到 420 ⟹ 级 3 事实上不存在 | "只把两个常量写进注释说明互斥"：注释不是守卫。现改为与会话长度解耦的计量 + **运行期断言** + 变异 M1-f |
| 🔴 **`degradedRecorded` 用锁内 test-and-set，而非两次 mutation** | R2-8：它是 read-then-act（`judge:697`），两个并发判定器都读到 `false` ⟹ **都写终态**。初稿的"幂等标记最后写赢"论据不成立——最后写赢的是标记，不是副作用 | "把 `recordWorkflowRun` 也拖进锁内"：临界区裹磁盘 IO = DoS 面（F227 教训）。现取"锁内决定谁写、锁外真正写"，残余面登记为 K-18 |
