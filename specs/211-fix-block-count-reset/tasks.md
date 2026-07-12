# 修复任务清单：blockCount 补救成功重置

**模式**: fix（精简任务列表）
**特性目录**: `specs/211-fix-block-count-reset`
**前序制品**: `fix-report.md`（5-Why 根因 + 影响范围扫描）、`plan.md`（变更清单 5 点）
**采用方案**: 方案 A——compliant 分支调用 `resetBlockState` 删除两级状态文件

策略：TDD，测试红灯先行。先写 5 个新用例（3 个 io 单测 + 2 个 CLI 端到端序列）确认失败，
再实现 `resetBlockState` + judge 接入使其转绿，最后同步 spec 增补句与收尾验证。

---

## T001 [P] io 层单测：resetBlockState 删除主路径状态文件（红灯）✅

- **目标**：在 `fix-compliance-io.test.mjs` 新增 `describe('resetBlockState：补救成功清零（两级存储均清）', ...)` 区块，写第 1 个用例——先 `saveBlockState` 写入主路径状态（blockCount>0），调用尚未存在的 `resetBlockState`，断言 `loadBlockState` 回到初始态（blockCount===0, degradedRecorded===false）且主路径文件已不存在
- **文件**：`plugins/spec-driver/tests/fix-compliance-io.test.mjs`（紧跟既有 `loadBlockState / saveBlockState` describe 之后新增区块）
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` 该用例因 `resetBlockState` 未导出而报错/失败（红灯，符合 TDD 预期）
- **依赖**：无
- **模型**：sonnet（测试任务）

## T002 [P] io 层单测：tmpdir 回落残留同样被清除（红灯）✅

- **目标**：在同一 describe 区块追加第 2 个用例——模拟主路径不可写（如通过 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` env 覆盖 + 只写 tmpdir 路径的方式复现降级写入场景），断言重置后 `loadBlockState` 也读不到 tmpdir 残留旧计数（回初始态）
- **文件**：`plugins/spec-driver/tests/fix-compliance-io.test.mjs`
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` 该用例红灯
- **依赖**：T001（同区块顺序追加，避免并发写同一测试文件冲突）
- **模型**：sonnet（测试任务）

## T003 [P] io 层单测：文件不存在时不抛出（红灯）✅

- **目标**：在同一 describe 区块追加第 3 个用例——对从未阻断过的 session（两级文件均不存在）调用 `resetBlockState`，断言不抛出异常且返回值/副作用符合预期（`void`）
- **文件**：`plugins/spec-driver/tests/fix-compliance-io.test.mjs`
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` 该用例红灯（因函数未导出报错）
- **依赖**：T002
- **模型**：sonnet（测试任务）

## T004 CLI 端到端单测：额度恢复序列（红灯）✅

- **目标**：在 `fix-compliance-judge-cli.test.mjs` 既有 `describe('阻断有界化（FR-006）', ...)` 区块内追加用例 `'补救成功清零：阻断×2 → compliant 收口 → 额度恢复，再次不合规从第 1 次重新计数'`——复用 `readRunsEvents()`/`collapsedTranscript()`/`compliantTranscript()`，序列为 bad×2(exit2,exit2) → good(exit0,静默) → bad×3(exit2,exit2,exit0+GATE-DEGRADED)，断言重置后进入新一轮完整 2→2→降级周期而非沿用旧计数
- **文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 该用例红灯（现有 compliant 分支不重置，第 3 次 bad 会直接降级而非从 1 计数）
- **依赖**：T003
- **模型**：sonnet（测试任务）

## T005 CLI 端到端单测：degradedRecorded 归位序列（红灯）✅

- **目标**：在同一 describe 区块追加用例 `'降级放行后补救成功：degradedRecorded 随重置归位，同一 session 可再次产生新的降级终态事件'`——序列为 bad×3（第 3 次降级产生 1 条 workflow-run-summary）→ good(compliant,exit0) → bad×3（应再次降级并产生第 2 条 workflow-run-summary），证伪"旧 degradedRecorded 幂等标记吞掉第二轮终态事件"
- **文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 该用例红灯
- **依赖**：T004
- **模型**：sonnet（测试任务）

## T006 实现：io.mjs 新增 resetBlockState 导出函数 ✅

- **目标**：在 `fix-compliance-io.mjs` 的 BlockCountState 组末尾（`saveBlockState` 定义之后）新增 `export function resetBlockState(projectRoot, sessionId)`——复用既有 `sanitizeSessionId`/`primaryStatePath`/`tmpStatePath`，两级路径均无条件 `fs.unlinkSync` 尝试删除，失败静默忽略（尽力而为，非抛出式），含完整 JSDoc（对齐 plan.md §3.1 给出的实现与注释原文）
- **文件**：`plugins/spec-driver/scripts/lib/fix-compliance-io.mjs`
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` 全绿（T001-T003 三个用例转绿，且既有 `loadBlockState / saveBlockState` 区块用例不回归）
- **依赖**：T003（红灯确认后再实现）
- **模型**：opus（生产代码）

## T007 实现：judge.mjs compliant 分支接入 resetBlockState ✅

- **目标**：`fix-compliance-judge.mjs` import 列表新增 `resetBlockState`；`runHook` 函数的 compliant 分支改为先调用 `resetBlockState(projectRoot, payload.session_id)` 再 `return 0`（对齐 plan.md §3.2 给出的代码与"无条件调用，不区分 enforcement"论证，不新增 if 分支）
- **文件**：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`
- **验收**：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 全绿（T004-T005 两个用例转绿，且既有阻断有界化区块全部用例——含 `state-storage-unavailable`、`不同 session 计数互不干扰`——不回归）
- **依赖**：T006（resetBlockState 已存在可导入）
- **模型**：opus（生产代码）

## T008 [P] Spec 增补：FR-006 补救成功重置语义 ✅

- **目标**：编辑 `specs/208-fix-mode-process-compliance/spec.md` FR-006 段落（现 L158），在"并发的多个 fix 会话不得共享同一份计数或降级状态。"之后、`**[必须]**——去掉有界化设计` 之前插入一句：`同一会话内合规收口成功时，阻断计数重置（中间停顿消耗的额度随补救成功自愈）。`（原文精确替换，见 plan.md §6）
- **文件**：`specs/208-fix-mode-process-compliance/spec.md`
- **验收**：目视核对该行插入位置与措辞与 plan.md §6 增补后原文一致；不新增 FR 编号
- **依赖**：无（可与 T006/T007 并行）
- **模型**：opus（规范文本，视同生产制品）

## T009 收尾验证：全量测试 + 回归 + repo:check + 红线自检 ✅

- **目标**：依次执行并确认零失败/零违规：
  1. `node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs`
  2. `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
  3. `npm run test:plugins`（全量插件测试零失败）
  4. `npx vitest run tests/integration/spec-driver-adoption-insights.test.ts`（回归确认无跨文件影响）
  5. `npm run repo:check`
  6. 红线自检：`git diff --stat` 确认改动文件集合仅为
     `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` +
     `plugins/spec-driver/scripts/fix-compliance-judge.mjs` +
     `plugins/spec-driver/tests/fix-compliance-io.test.mjs` +
     `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` +
     `specs/208-fix-mode-process-compliance/spec.md` + `specs/211-fix-block-count-reset/**`，
     零触碰 `scripts/eval-*.mjs` 与仓库根 `scripts/lib/**`
- **文件**：无新增文件（验证任务）
- **验收**：以上 6 步全部通过，红线自检确认改动范围合规
- **依赖**：T006, T007, T008

---

## 依赖链

```
T001 → T002 → T003 → T006 ─┐
                            ├→ T007 ─┐
                    T004 → T005 ─────┤
                                      ├→ T009
                            T008 ─────┘
```

- T001-T003（io 单测，[P] 标记可并行编写但同文件建议顺序追加避免冲突）→ T006（io 实现，转绿）
- T004-T005（CLI 端到端单测，依赖 T003 之后编写但语义独立于 io 实现，可与 T001-T003 并行构思，落笔到同一测试文件建议顺序）→ T007（judge 接入，依赖 T006 已提供 resetBlockState）
- T008（spec 增补）可与 T006/T007 并行进行
- T009（收尾）依赖 T006、T007、T008 全部完成

## FR 覆盖映射

| 需求点（来自 fix-report.md 同步更新清单） | 对应 Task |
|---|---|
| (a) 阻断×2 → compliant → 再次不合规应从第 1 次重新计数（额度恢复） | T004, T007 |
| (b) 始终不补救 → 既有行为不回归 | T004（复用既有序列断言）, T009（既有用例回归确认） |
| (c) 两级存储都被清（tmpdir 回落不复活旧计数） | T002, T006 |
| (d) degradedRecorded 随重置归位 | T005, T007 |
| FR-006 spec 增补"补救成功重置"语义 | T008 |
