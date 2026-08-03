# Spec 合规审查报告（F251 dist 竞写测试隔离修复）

> 落盘说明：spec-review 子代理工具集无 Write 能力（已知流程缺口，同 F245 记录），本文件由主编排器**逐字转录**子代理返回的审查结论，未做内容改动；文末「编排器处置」一节为主编排器追加。

审查依据：`specs/251-fix-dist-race-test-isolation/{fix-report.md,plan.md,tasks.md}` + 实际代码（`tests/global-setup.ts`、`tests/helpers/dist-cli-guard.ts`、`vitest.config.ts`、8 处 beforeAll 替换点）。已逐行核对 tasks.md 声明的 T001-T017 与磁盘实际改动一致。

## 逐条问题点覆盖状态

| 问题点/FR（来自 fix-report/plan/tasks 映射表） | 状态 | 证据/说明 |
|---|---|---|
| Root Cause：dist/ 缺乏「构建期与消费期」时间隔离 | 已实现 | `tests/global-setup.ts` 在 vitest `test.globalSetup`（根级，与 `projects` 同级，`vitest.config.ts:63`）声明；8 处 beforeAll 全部替换为 `assertDistBuilt()`（`tests/helpers/dist-cli-guard.ts:13-26`），逐一 grep 核实无遗漏（`tests/unit/graph-quality-core.test.ts:87`、`cli-e2e.test.ts:35,139`、`init-e2e.test.ts:45`、`graph-quality-cli.test.ts:99`、`graph-quality-report-schema.test.ts:97`、`graph-quality-adversarial.test.ts:61`、`graph-quality-lang-matrix.test.ts:60`） |
| 指纹双底座错位窗口（放大项） | 已实现 | 新鲜度判据比较 `FULL_BUILD_INPUT_PATHS`（含 `BUILD_INPUT_PATHS` + `scripts/inline-d3.ts` + `scripts/postbuild-stamp.mjs` + `scripts/lib/spectra-version-gate.mjs`）mtime vs `dist/cli/index.js` mtime，源新则重建，保证消费前 dist 与源同步 |
| plan.md 修正表新发现的 3 处（#6-#8） | 已实现 | `graph-quality-report-schema.test.ts`、`graph-quality-adversarial.test.ts`、`graph-quality-lang-matrix.test.ts` 均已替换，且后两者原「只判存在」半条件逻辑被整体替换为强断言，闭合了独立潜伏缺口 |
| globalSetup 声明层级（根级 vs per-project） | 已实现 | 与 plan.md 决策点 1 描述一致，声明在 `test.*` 根级而非某个 `projects[]` 条目 |
| 共享 fail-fast helper 设计 | 已实现 | `assertDistBuilt()` 仅做 `existsSync` 同步断言，不触发构建，报错文案与 plan.md 三条排查项+手动修复提示完全一致 |
| `scripts/lib/spectra-version-gate.mjs` 只消费不修改 | 已实现 | 该文件未出现在本次 diff 清单中，`global-setup.ts` 仅 `import { BUILD_INPUT_PATHS }` |
| 回归风险：TDD「先红」语义未被弱化 | 已实现（结构上成立，未见 T014 实测记录） | mtime 判据下任何 `src/` 改动都会使 dist 判"不新鲜"从而重建，语义等价于原先的"每次强制 build"；但 tasks.md T014（满载全量复跑 ≥3 轮）审查时点仍是唯一未勾选任务，属"验证缺口"而非"实现缺口" |
| 变异验证：无运行期 build 残留 | 已实现 | grep 显示 `tests/` 下所有 `execFileSync('npm', ['run', 'build']...)` 已全部消失，仅 `global-setup.ts` 自身在测试执行前单点调用；其余散落 "npm run build" 字样均为注释/字符串消息，非可执行调用 |

## 总体合规率

7/7 结构性问题点已实现（100%）；1 项验证任务（T014）审查时点标记未完成，属验证证据缺口而非代码实现缺口。

## 偏差清单

| 项 | 状态 | 偏差描述 | 建议 |
|---|---|---|---|
| T014 未勾选 | WARNING | fix-report 要求"满载全量 vitest 复跑多轮（≥3 轮）零偶发"作为唯一能证明"竞写已消除"的直接证据。若未跑满就进入 commit / push 流程，未对齐 fix-report 自身验证标准 | 补跑 3 轮零失败再勾选 T014 |
| Spec 影响判定 | 已复核，判定成立 | F217 消费的是 `graph-quality-core.mjs` 输出契约，本次未触碰该 .mjs、未改变其被调用方式，只消除调用时机竞态；F249 双路指纹计算逻辑未变，仅新鲜度保障时机前移。均无需更新 spec.md | 无需修复 |

## 过度实现检测

| 位置 | 描述 | 风险评估 |
|---|---|---|
| graph-quality-adversarial / lang-matrix 原「只判存在不判新鲜」半条件逻辑被顺带修复 | fix-report/plan.md 均已显式记录为"副作用，非本次目标但值得记录"，改动量极小，未新增独立功能面 | INFO：已被制品自身充分说明和证成，不构成未声明的过度实现 |

未发现其他 spec 未定义的额外功能、公共 API、配置项或用户可见行为变化。

## 对抗视角：新鲜度判据的误判场景（核心发现）

**场景构造**：`npm run build` = `prebuild`(tsx inline-d3) → `build`(tsc 全量 emit) → `postbuild`(`postbuild-stamp.mjs` 写 `dist/.spectra-build-meta.json`，整条流水线**最后**落盘的产物)。若构建在 tsc 阶段被打断（180s 超时 SIGTERM / OOM-kill / 手动 Ctrl-C）：

- tsc 未开 `noEmitOnError`，`dist/cli/index.js` 可能已落盘且 mtime 是"刚刚"，必然新于全部源输入；
- postbuild 没跑到，`dist/.spectra-build-meta.json` 不存在或是上次成功构建的旧文件；
- 但 `isDistFresh()`（`tests/global-setup.ts:52-60`）只比较 `dist/cli/index.js` mtime → 误判 fresh，后续每次 vitest 都跳过重建，测试长期跑在"部分模块缺失/不完整"的 dist 上。

这正是 fix-report 想消灭的"半写 dist 被消费"症状，触发路径从"并发写"变成"构建中断后被误判新鲜"——且是**相对旧设计的自愈能力倒退**（旧设计每 beforeAll 无条件重建，半成品下一次即被修复）。fix-report 方案 A 原文判据本已写"或 `dist/.spectra-build-meta.json` 记录的构建输入已过期"，plan.md 决策点 2 细化为纯 `dist/cli/index.js` mtime 比较时隐性弱化了该锚点，未单独列为决策讨论。

建议判据：`existsSync(META) && statSync(META).mtimeMs >= newestMtimeMs(FULL_BUILD_INPUT_PATHS)`（以 meta 为锚点），从根上排除"构建中断残留半成品被误判新鲜"。

**结论与建议档位：WARNING**（非 CRITICAL 理由：需"构建被外部打断"前置条件，非本次修复直接引入的必现回归；但属真实设计缺口且有自愈倒退，建议合并前补齐 build-meta 判据或显式记录已知限制）。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 2 个（① T014 复跑证据缺口；② 新鲜度判据锚点应改用 `dist/.spectra-build-meta.json` 完成标记）
- INFO: 1 个（半条件 build 顺带修复，已充分说明）

---

## 编排器处置（主编排器追加）

- **W①（T014）**：首轮 3 连跑已执行（R1 出现 1 文件/2 用例失败、身份因日志截断丢失；R2/R3 全绿）。因 W② 修复会改动 global-setup.ts，T014 在修复后**重新完整执行 3 轮并全量留证**，以修复后的复跑作为最终判据。
- **W②（锚点）**：采纳。与 4b quality-review 的唯一 WARNING 完全同源，也与主编排器 diff 审查时独立标记的疑点一致，三方交叉确认为真缺陷。已委派 implement 子代理将 `isDistFresh()` 锚点改为 `dist/.spectra-build-meta.json`（postbuild 最后落盘 = 构建完整跑完的强完成标记），并同步修订 plan.md 决策点 2 的记录。
- **INFO**：无需处置。
