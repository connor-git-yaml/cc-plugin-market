# F296 问题修复报告 — F291a per-target 阻断预算（M11 卡 B，门禁类）

**模式**: fix（M11 §9.2；`/goal` 授权下主线程直接实现，TDD + 镜像旧代码 RED 证明 + 9 变异体 + 两路异构对抗 + 重设计后回归）
**日期**: 2026-09-15
**审查档位**: Codex 审查暂停，异构档位缺席 → 内部异构对抗复审 ×2（fail-open 面 / 误伤面），门禁类常设档位

## 问题描述

`fix-compliance` 判定器的 blockCount / 降级状态按 **session** 持久（`<sid>.json`）。同会话 Fix-A 付满 2 次真实阻断后，**全新** Fix-B
首次评估即满足「blockCount ≥ 上限 + 佐证够」⟹ 0 往返降级放行（F289 delta CRITICAL，Tier 2 resume 绑定 + 提名 last-writer-wins 构造在 HEAD 判定器上复现：B 首次 exit 0）。

## 5-Why 根因

| Why | 结论 |
|---|---|
| 1 | 阻断预算与目标无关，只看会话 |
| 2 | F288 状态模型只有一个桶 |
| 3 | F289 的 Tier 2 绑定锚点不随新目标前移，暴露此桶 |
| **Root Cause** | **预算的记账粒度（会话）比裁决对象（目标）粗** |

## 修复策略（方案①′，两轮对抗后从方案①改来）

首版按设计稿方案①（复合键文件 `<sid>__<sha256(dir) 前 8 位>` + legacy 回落）实现并让六套套件全绿，但两路异构对抗各出 3–4 个 CRITICAL（受控 A/B 实跑成立）：
32-bit dirhash 可离线碰撞 + sidechain `candidatePath` 零校验；裸 sid 兜底文件由判定器自己产生、经 legacy 回落成为每个目标的「万能捐赠者」；
合规清零不清兄弟桶（新 fail-open 回归）；逐轮改名 / 重编号键漂移 ⇒ 8 轮零自愈（方案③被否决的同型）；会话级在途推迟预算被按目标放大 N 倍。

终版：
- `fix-compliance-io.mjs`：状态仍每会话一份 `<sid>.json`、锁按会话；文件内 `targets[桶键]` 分桶（blockCount / degradedRecorded / nonBlockStopCount / lastCountedFingerprint），`inFlightDeferCount` 留顶层；
  `targetBudgetKey` = 规范化目录字面量（`path.posix.normalize` + `FIX_DIR_NAME_REGEX`，否则 `__no-target__`）；`migrateTargetBudget` 沿身份链搬桶；`resetBlockState` 整份删除；`listSidechainMarkers` 读侧规范化 `candidatePath`；改造前顶层计数**不迁移**（fail-closed 迁移）。
- `fix-compliance-core.mjs`：`resolveFeatureDirCandidate` 登记被跟随的改名事件 `renames[]`（候选历史里的「另一个目标」与「同一目标改名前身」形状相同，预算只能沿后者迁移）。
- `fix-compliance-judge.mjs`：`evaluate` 返回 `targetDir` / `budgetKey`（提名身份优先）/ `budgetLineage`（改名链 + 被判目录）；`openTargetBudget` 在锁内 RMW 上迁移 + 取桶；两条路由改桶；defer 留会话级；合规整份清零；审计事件与 `--mode report` 带 `targetDir` / `budgetKey`（schema 加两键）。

## Spec 影响

- `specs/208/.../data-model.md §8` 状态形状；`contracts/fix-compliance-judge-cli.md` 分桶说明；`contracts/fix-compliance-verdict-event.schema.json` 加 `targetDir` / `budgetKey`。
- 行为变化：同会话切换目标不继承前一目标预算；改造前会话的旧计数不迁移（至多多付一轮）；无目标轮次自成一桶。

## 测试与变异

`fix-compliance-f291a-per-target.test.mjs` 10 例（Tier 2 跨目标 / 无目标桶不捐赠 / 旧文件不迁移 / 兄弟桶不残留 / 8 轮自愈 / 逐轮 mv 改名 `[2,2,2,0]` / 逐轮复合 git mv 重编号 `[2,2,2,0]` / 推迟预算会话级 / sidechain 非规范拼写折回 / report 与审计字段）；
io 79 / card-b 28 / judge-cli 225 / card-a 21 / tier2 25 / core 604 全绿。方案①阶段 9 个自建变异体全杀；审查者变异 12 + 8 个中存活的
M2 / M3 / M7 / M9 / RM3 / RM6 在方案①′下要么结构消失（dirhash / legacy 已删）要么被新语料钉住（推迟会话级 / 提名身份 / E5b）。
镜像旧判定器（`git show HEAD:`）上 Tier 2 语料 B 首次 exit 0（fail-open 复现），新判定器 exit 2。

## 残余（如实登记）

- 目标从第 1 轮即可定位且不改名的诚实用户与改动前逐轮相同；合法改名一次 = 桶迁移、零额外阻断（E3a 语料同型已覆盖于逐轮改名用例）。
- 非规范的目标目录名（不匹配 `FIX_DIR_NAME_REGEX`）落无目标桶，多个这类目标共用一桶。
- 状态文件无 GC（一会话一文件，与改造前相同）。
- F291b 仍暂不实施。

## 工具使用反馈

见 ledger「M11 第一批五卡」节（本卡：判定器对「改判定器自身」的卡结构性失明；`resolvedPath` 三来源需要「变量赋值点 + 守卫条件」形状的查询，Spectra 无此形状）。
