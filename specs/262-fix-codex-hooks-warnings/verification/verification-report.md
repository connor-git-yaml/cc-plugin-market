# 验证报告 — F262 Codex hooks installer 权限位放宽 + doctor 三处误报收口

**特性目录**: `specs/262-fix-codex-hooks-warnings`
**验证轮次**: Phase 4c（独立复核，与实现轮 4a/4b/异构对抗 4 轮相互独立，全部命令亲自重跑）
**验证日期**: 2026-08-13
**被验改动**: `git diff HEAD` 7 文件（4 生产 .mjs + 3 测试 .ts），+1420/-55 行

## 1. 验证命令与结果表

| # | 命令 | 退出码 | 关键输出 |
|---|------|--------|---------|
| 1 | `npx vitest run tests/unit/codex-hooks-installer.test.ts tests/unit/codex-runtime-doctor.test.ts tests/unit/codex-runtime-doctor-cli.test.ts tests/unit/codex-runtime-doctor-redaction.test.ts tests/integration/codex-hooks-install-flow.test.ts tests/unit/codex-hooks-event-gate.test.ts tests/unit/hook-installer-semantics-parity.test.ts` | 0 | **7 files passed / 246 tests passed**（0 failed）。逐文件：hook-installer-semantics-parity 23、codex-hooks-installer 54、codex-runtime-doctor 71、codex-runtime-doctor-cli 14、codex-runtime-doctor-redaction 24、codex-hooks-install-flow 45、codex-hooks-event-gate（含在上述汇总内，未见独立 fail） |
| 2 | `npm run build` | 0 | `tsc` 零错误；`[postbuild:stamp] 盖章: commit=dd59ebbd (dirty)` |
| 3 | `npm run repo:check` | 0 | 全部 check 项 `pass`，唯一 `warnings`: `[graph-quality] 图产物已 stale（source-commit）`（记忆确认为 worktree 常态、与本卡无关） |
| 4 | `npm run release:check` | 0 | `Release contract valid (contracts/release-contract.yaml)` |
| 5 | `npx vitest run`（全量） | 1 failed | 见 §3 |

## 2. 抽查证据核查（护栏 ↔ 断言行号映射）

亲自 Read 测试源码逐条核实以下四条护栏均为**真实行为断言**（非恒真/非同义反复），均调用生产代码路径产出的实际状态做比对：

| 护栏 | 文件 | 关键断言行号 | 核实结论 |
|------|------|------------|---------|
| **W3 权限保全** | `tests/unit/codex-hooks-installer.test.ts` | L420-430（0600 保全，断言 `fs.statSync(target).mode & 0o777`）、L432-439（setgid `0o7777` 高位保全，`0o2640`）、L441-477（`umask 000` 子进程首次创建 `0600`，含目录 `0700`，L479-513）、L515-532（tmp 文件创建即 `mode:0o600` + `flag:'wx'`）、L534-557（`chmodSync` 抛 `ENOTSUP` → 降级继续 + `target-mode-preserve-failed` 诊断 + 零 tmp 残留） | 5 条断言全部存在且落在真实 `installer.installCodexHooks(...)` 调用后对 `fs.statSync`/`fs.readdirSync` 的实测结果上，非恒真 |
| **W1a 三连** | `tests/integration/codex-hooks-install-flow.test.ts` | FP 消除：L513-526（`{hooks:{Stop:[]}}` baseline + 正常安装 → `projectionEqual===true`、`lostCommands===[]`、无 `foreign-entries-mutated`、`exitCode===0`）；M1 检出：L528-547（安装器把用户空键整个删掉 → 仍 `projectionEqual===false` 且含 `foreign-entries-mutated`、`exitCode===1`）；RAW 槽检出：L602-616（`hooks:[]` RAW_HOOKS_KEY 形态 → 仍 fail，另有 L618-625 非空 RAW 槽变体） | 三条均存在，且额外发现测试文件在此基础上补了 4 个未点名的加固变体（W-1 强形态 L549、注入 L566、类型销毁 L591、RAW 非空 L618），覆盖面优于任务卡最低要求 |
| **CRITICAL-A 锚定** | `tests/unit/codex-runtime-doctor.test.ts` | L511-527：`🔴 单行 literal string 里的 "\"\"\"" 不是多行串定界符（主向量：偶数个杂散标记会吞掉整段）` | 用例存在，用 `expectNoPhantomSwallow` 断言两产品各自落到不同的 `status` 枚举值（`indeterminate` vs `ok` + `semver` 精确匹配），非字符串包含式弱断言；紧邻 L529 basic-string `'''` 变体、L547 注释变体，构成同一失效向量的三重覆盖 |
| **CRITICAL-B 锚定** | `tests/integration/codex-hooks-install-flow.test.ts` | `foreign-command-removed-by-declaration` warning：L700-728（谓词派生豁免 → `exitCode===0` 但 `status==='warning'` + `removedByDeclaration` 命令可见 + finding `level:'warning'`）；既有回归钉子：L747-765（`🔴 数组形态下归属误认仍 MUST fail（既有口径不因 C1 而放宽）` → `exitCode===1` + `foreign-command-lost`） | 两条并存于同一 `describe('🔴 C1 removedCommands 豁免可见性...')` 块（L697-766），互为对照（同一误认场景，第三形态走 warning、数组形态走 fail），能有效检测"豁免面越界吞掉数组形态"的回归 |

结论：4 条抽查护栏全部**真实存在、非同义反复、指向 fix-report 声称的具体行为**，与 fix-report/review-summary 描述一致，未发现证据造假或断言弱化迹象。

## 3. 全量测试裁量与依据

本轮**未采信** review-summary 记录的历史两轮判定，而是重新自跑一轮全量 `npx vitest run`（机器当时 `uptime` load 4.42/18 核，判定为空载可跑），结果：

- **1 failed / 7497 passed / 18 skipped / 21 todo**（534 test files，529 passed / 1 failed / 4 skipped）
- 失败用例：`tests/integration/codex-plugin-marketplace.test.ts > codex marketplace catalog > fresh-clone 物化验证（SC-006）> tracked marketplace.json 随 clone 物化，未 track 的 .agents/skills 不物化`，报错 `Hook timed out in 10000ms`（`afterEach` 里 `rmSync` 清理临时目录超时）

按任务指令的满载 flake 三条件协议逐一核验（本轮为第三次独立全量跑，此前 review-summary 已记两轮，三轮失败组合三次均不同——本身即符合"组合逐轮漂移"特征）：

1. **零交集**：`grep -l` 检索 `codex-plugin-marketplace.test.ts` 是否引用本次改动的四个生产文件（`codex-hooks-installer.mjs`/`validate-codex-hooks.mjs`/`codex-runtime-doctor-io.mjs`/`install-codex-hooks.mjs`）→ **无匹配，零交集**
2. **隔离绿**：`npx vitest run tests/integration/codex-plugin-marketplace.test.ts` 单独重跑 → **4 tests passed，977ms**（远低于全量跑时触发的 10000ms 超时阈值），确认失败是并发满载下 `fs.rmSync` 的 I/O 延迟导致，非逻辑回归
3. **组合漂移**：review-summary 记录的前两轮全量失败分别是「1 failed（tail 截断未存名）」与「feature-213 e2e 超时 1073s + architecture-ir-builder 文件级 error」，本轮（第三轮）失败对象又变为 `codex-plugin-marketplace.test.ts`——三轮三种不同失败组合，符合"资源竞争型 flake"而非"确定性回归"的判据

**裁决**：判定为满载 flake，非本次改动引入的回归。目标测试组（§1 命令 1）247 用例、生产代码直接相关的全部测试均 100% 通过，是本次改动质量的主要判据；全量套件里与改动无关的单个基础设施类用例的资源竞争超时不阻断验收。

## 4. tasks.md 完成度核对（T001-T013）

| 任务 | 声明状态 | 实证核对 |
|------|---------|---------|
| T001 权限位保全红先行测试 | 未勾选 checkbox（`- [ ]`），但 fix-report/实现轮记录已完成 | ✅ 实证：`(h) 权限位保全（W3）` describe 块存在于 `codex-hooks-installer.test.ts` L419-558，5 条断言齐全，当前全绿 |
| T002 writeJsonAtomic 实现 | 同上 | ✅ 生产代码 `codex-hooks-installer.mjs` 已改动（diff 中 +106 行），T001 测试转绿 |
| T003 W1a 红先行测试 | 同上 | ✅ `codex-hooks-install-flow.test.ts` L512 起 W1a describe 块存在，含 FP 消除/M1/RAW 三条 |
| T004 checkForeignPreservation 实现 | 同上 | ✅ `validate-codex-hooks.mjs` 已改动（diff +209 行），T003 测试转绿 |
| T005 W1b 红先行测试 | 同上 | ✅ 升版路径测试存在（C1 removedCommands 豁免可见性块，L697 起），已按 CRITICAL-B 裁决方案（warning 可见）落地，非任务卡原始设想的"零误报"（回归护栏已在 fix-report 显式修订为"零 fail 误报 + warning 可见"） |
| T006 移除清单一等化实现 | 同上 | ✅ `installCodexHooks` 返回值含 `removedCommands`（测试 L714 断言存在），`isInstallResultShape`/`collectInstallResultCommands` 判据落地 |
| T007 W2 红先行测试 | 同上 | ✅ `codex-runtime-doctor.test.ts` 新增 306 行，含 CRITICAL-A 收口后的单遍扫描器测试矩阵（L511 起等） |
| T008 doctor-io 实现 | 同上 | ✅ `codex-runtime-doctor-io.mjs` 已改动（diff +171 行） |
| T009 W4 红先行测试 | 同上 | ✅ `.bak` 可观测性用例存在于 `codex-hooks-install-flow.test.ts`（backup-already-exists / owned-entry-removed 提醒词 / 真实路径等） |
| T010 install-codex-hooks 实现 | 同上 | ✅ `install-codex-hooks.mjs` 已改动（diff +40 行） |
| T011 波及确认 | 同上 | ✅ `hook-installer-semantics-parity.test.ts`（23/23）与 `codex-hooks-event-gate.test.ts` 均在本轮命令 1 中全绿，无回归迹象 |
| T012 全量验证 | 同上 | ✅ 本轮命令 1-4 全部复核通过；命令 5（全量 vitest）按 §3 满载 flake 协议判定通过 |
| T013 制品收尾（对抗审查+commit message 标注） | 同上 | ⚠️ 未核实：commit 尚未创建（`git status` 显示改动仍在工作区，无对应 commit），故"commit message 标注「Codex 审查暂停，异构档位缺席」"这一子项**尚未发生**；fix-report 已完整记录两轮异构对抗结论（Phase 1 两路 + Phase 4 两路），实质审查工作已完成，仅差实际 `git commit` 落地 |

**说明**：tasks.md 全部 13 项 checkbox 均未勾选（`- [ ]`），但根据 fix-report.md 与 review-summary.md 的详实记录、以及本轮对生产代码/测试代码的实证核查，T001-T012 的**实质工作内容已完成**且验证通过；checkbox 未勾选应视为文档同步滞后（fix 模式下 tasks.md 常见现象），不代表工作未做。T013 的对抗审查部分已完成（见 fix-report「对抗审查裁决记录」），但**commit 尚未创建**，故该任务的"提交"动作严格意义上未闭环——留待编排器在验证通过后统一处理 commit。

## 5. 综合结论

**PASS**（附一条待办）

理由：
- 目标测试组（改动直接相关的 7 个测试文件、246/246 用例）100% 通过，无一失败
- `npm run build` / `npm run repo:check` / `npm run release:check` 三条工具链检查全部 0 退出码，仅有的 warning 是与本卡无关的图产物 staleness（worktree 常态）
- 全量 vitest 唯一失败项经三条件协议核实为满载 flake（隔离绿 977ms、零 grep 交集、三轮失败组合持续漂移），非本次改动引入的回归
- 抽查的 4 条关键护栏断言（W3 权限保全、W1a 三连、CRITICAL-A 幻影多行串主向量、CRITICAL-B 豁免可见性+回归钉子）均逐一 Read 源码核实为真实行为断言，与 fix-report 声称一致，无证据造假迹象
- fix-report 记录的两轮（诊断轮 + 实现轮）异构对抗审查均已完成并裁决收口，无遗留 CRITICAL

待办（不阻断本轮验证，留给编排器下一步处理）：
- T013 要求的 commit 尚未创建；commit message 需按约定标注「Codex 审查暂停，异构档位缺席」并记录审查结论
- tasks.md 的 13 项 checkbox 建议在 commit 前统一勾选为 `- [x]`，保持制品与实际状态一致
