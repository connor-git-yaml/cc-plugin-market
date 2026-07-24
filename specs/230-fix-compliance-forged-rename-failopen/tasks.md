---
title: "fix 依从性门禁伪造 mv fail-open 修复 — 任务分解"
feature: "230-fix-compliance-forged-rename-failopen"
branch: "claude/dazzling-jackson-9457e2"
created: "2026-07-23"
status: "Draft"
---

# Tasks: fix 依从性门禁伪造 mv fail-open 修复

**Input**: `specs/230-fix-compliance-forged-rename-failopen/plan.md`（精确变更清单权威来源，本文件不重复推导，仅任务化）
**Prerequisites**: `fix-report.md`（5-Why 根因 + 差分矩阵 A-E，必读）、`plan.md`（函数级 diff、回归风险评估、验证方案，必读）

**Tests**: 本 fix 显式要求 tests-first——差分矩阵 A/C/D/E 四条是验收硬指标，回归测试任务必须先于对应实现任务完成并确认失败（红），实现后转绿。

**Organization**: 按 plan.md 的两层改动组织（第 1 层词法过滤 / 第 2 层判定下界收窄），无 User Story 概念（fix 模式），用 `[L1]`/`[L2]` 标注所属层级替代 `[Story]`，便于追踪两层改动的独立回归证据。

> **实施期设计替换（务必先读）**：本文件生成于 plan 的**旧版第 1 层设计**（注释/引号扫描器 `scanRenameShellContext`）。
> 该设计已在 Codex 对抗审查中被反例推翻并作废——`echo mv <候选> <非规范名>`（既无注释也无引号）同样能绕过它。
> 实际实施以 plan.md「改动清单 §1.1/§1.2」的**命令位锚定**方案为准。该方案本身又经历了一次替换：
> 第 1 版落库实现（段级锚定 `RENAME_COMMAND_HEAD_REGEX` + 引号奇偶配平守卫 `hasUnbalancedQuotes`）
> 在**第 2 轮 Codex 对抗审查（C1）**中被转义引号构造证伪（`echo "a;mv <候选> <非规范名>\""`），
> 两个符号均已删除；第 2 版落库实现是在**完整命令**上跟踪引号/转义状态的导出纯函数
> `extractRenameCommandParams`（sticky 正则一次匹配命令名 + 参数），`applyRename` 消费整条命令。
> 该版又在**第 3 轮 Codex 对抗审查**中被 4 条 CRITICAL 证伪：
> R3-C1「正则吞参数就会丢状态」（`mv src "dst;mv <候选> <非规范名>"` 引号内的 `;` 被当真实分隔符）、
> R3-C2「无 comment / redirection 状态」（`true # ; mv ...` 与 `echo hi >& mv ...`）、
> R3-C3「`\b` 不是 shell token 边界」（`mv-f` 被读成 `mv -f`）、
> R3-C4「先全段提名再统一改名破坏同一条命令内的时序」（`mv A B; printf x > A/fix-report.md` 相对 HEAD 新增 fail-open）。
> **最终落库实现**：导出纯函数 `scanRenameCommandEvents(command)` 在完整命令上扫出带字符偏移的改名事件
> （状态含引号 / 转义 / 注释 / 重定向，参数由同一状态机继续收集，命令名终止判据为 `(?=$|[ \t])`），
> 主循环用内部函数 `splitCommandTextSegmentSpans` 把事件按偏移归回所属段落，
> 保持「段内先提名、再改名」的原有时序；`applyRename(command)` 相应降级为 `applyRenameEvent(paramText)`。
> `extractRenameCommandParams` / `RENAME_COMMAND_AT_POSITION_REGEX` 均已删除。
> **第 4 轮 Codex 对抗审查**未再更换判据维度，只在同一状态机上收敛 5 条 CRITICAL：
> R4-1「`#` 词首字符类漏 `)`」（`( : )# ; mv ...`）、R4-2「`>|` 中的 `|` 被当管道」（`echo hi >|mv ...`）、
> R4-3「未闭合引号在真实 shell 是语法错误、命令根本不执行，却仍提交改名事件」、
> R4-4「参数超上界被**截断**后解析会藏掉第三操作数，使『多操作数 mv 整条跳过』的保守化合同失效」→ 改为整条作废、
> R4-5「span × event 双重循环 O(N²)，8000 事件 141.4ms（跑在同步 Stop hook 路径）」→ 改为单指针归并，实测 5.0ms。
> 下文凡提及 `scanRenameShellContext` 的任务（T002/T005/T006/T010）均按该最终设计等价完成；
> 其余任务（测试、验证、文档）语义不变，仅测试用例数因四轮审查逐轮扩充（伪造构造 18 条、合法形态 9 条 + 3 条时序/行为 characterization + 3 条长度上界/引号守卫正向对照）。

## Format: `[ID] [P?] [L1|L2] 描述 + 文件路径`

- **[P]**：可并行（不同文件、无依赖）
- **[L1]**：第 1 层——`fix-compliance-core.mjs` 词法过滤（`scanRenameShellContext` + `applyRename`）
- **[L2]**：第 2 层——`fix-compliance-judge.mjs` 降级下界收窄（`evaluate()`）

---

## Phase 1: Setup

**目的**：确认改动前基线状态，为后续「改动前红 / 改动后绿」提供锚点

- [x] T001 在 scratchpad 落地 plan.md 附录的 `repro-f230-matrix.mjs` 复现脚本（路径示例：`/private/tmp/claude-501/.../scratchpad/repro-f230-matrix.mjs`），跑一次记录**改动前**基线输出：确认 A/D/E 三行 `transcriptDiagnostics` 含 `"feature-dir-unresolvable"`（缺陷复现），B/C 行为符合 fix-report 矩阵——作为本次修复前后对比的锚点，不写入仓库

**Checkpoint**：基线已记录，可开始 tests-first 编写

---

## Phase 2: Tests First（L1 + L2 回归测试，必须先写、先跑红，再进入 Phase 3 实现）

**目的**：把 plan.md「验证方案」章节的全部新增用例落地为可执行断言，在实现改动之前确认它们按预期失败（红）

### L1 单元测试 —— `scanRenameShellContext` 纯函数

- [x] T002 [P] [L1] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增 describe「`scanRenameShellContext`」，覆盖 plan.md 表格 7 条 it：无注释无引号原样透传 / 词首 `#` 截断 / 非词首 `#`（`sed -i '' 's#a#b#' x'` 边界回归，不截断）/ 单引号包裹 mv 关键字判 quoted / 双引号变体同上 / 引号外 mv 不受无关引号影响（截断位置正确）/ 未闭合引号安全退化（不截断，全段判 quoted）。此时 `scanRenameShellContext` 尚未定义，测试必须先跑红（`ReferenceError`/`is not a function`）

### L1 单元测试 —— `resolveFeatureDirCandidate` 改名跟随抗伪造

- [x] T003 [P] [L1] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增 describe「改名跟随抗伪造（F230 差分矩阵 A/D）」，覆盖 plan.md 表格 7 条 it：**A** 注释掉的整条 mv 不被跟随 / **D** 单引号包裹 mv 不被跟随 / **D2** 双引号包裹变体不被跟随 / **对照 C** 真实 mv 仍正常跟随（防过度收紧）/ 关键字未加引号仅操作数加引号仍正常跟随 / 真实尾部注释不影响跟随 / `scanArtifactPath` 侧注释形态提名不受影响（有意不改的对照组）。此时 `applyRename` 未接入新过滤逻辑，A/D/D2 三条必须先跑红（旧行为会跟随伪造 mv，`path`/`ambiguous` 与期望值不符）

### L2 CLI 端到端反向回归

- [x] T004 [L2] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 新增 describe「F230 伪造改名 fail-open 反向回归（差分矩阵 A/D/E）」，覆盖 plan.md 表格 5 条 it：**A** 注释假 mv+verify 类委派不得 exit 0 / **D** 引号内假 mv+verify 类委派不得 exit 0 / **C（正向保住）** 真实 mv+verify 类委派继续 exit 0（`degraded===true`）/ **E** implement-only 零验证类委派+真实 mv 不得 exit 0 / **E 对照** noopVerify 但 `roleClass!=='verify'` 的委派+真实 mv 仍走降级。统一前缀按 plan.md 附录脚本的 `PREFIX` 构造（`SKILL_EXPANSION_LINE('fix')` + Write 提名不落盘 + 委派 + 末条 Bash）。此时两层改动均未实现，A/D/E 三条必须先跑红（当前 master 行为是静默 exit 0），C 与 E 对照两条应已是绿（用于确认它们不是本次新增回归面，而是保住既有/新增覆盖的正向锚点）

**Checkpoint**：T002/T003/T004 全部写完并确认预期的红/绿状态后，方可进入 Phase 3 实现

---

## Phase 3: 实现（第 1 层 —— 词法过滤，关闭伪造开关）

- [x] T005 [L1] 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 新增导出纯函数 `scanRenameShellContext(segment)`，插入位置紧接 `parseRenameOperands`（当前 L96-121）之后、`INLINE_EDIT_INDICATOR_REGEXES` 注释块之前；实现单遍从左到右扫描，跟踪单/双引号开合状态，产出 `{ truncated, isQuoted(index) }`：`truncated` 截至未引用区第一个词首 `#`（词首＝段起始或前一字符是空白）为止；`isQuoted(index)` 判断 `truncated` 中某下标是否落在引号内；未闭合引号时 `quoteChar` 保持打开直至段尾，此后位置 `isQuoted` 恒真。JSDoc 按 plan.md 1.1 节原文（含 F224 `sed` 边界语义说明、heredoc 已知限界备注）。完整实现逐字对齐 plan.md 代码块（L102-126），不改动签名与返回形状
- [x] T006 [L1] 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 改写 `applyRename` 闭包（`resolveFeatureDirCandidate` 内部，当前 L471-483），按 plan.md 1.2 节 diff：新增 `const { truncated, isQuoted } = scanRenameShellContext(command);`；`RENAME_COMMAND_SEGMENT_REGEX.exec` 的匹配源从 `command` 改为 `truncated`；循环体内新增 `if (isQuoted(match.index)) continue;` 早退分支。`applyRename` 其余行（`trackedDir===null` 前置守卫、`parseRenameOperands`/`src`/`trackedDir=`/`syncCandidateFromTrackedDir()` 调用）与 `resolveFeatureDirCandidate` 其余部分（`candidate`/`ambiguous` 状态、`scanArtifactPath`、主循环、`return { path, ambiguous }`）逐字不动（依赖 T005 完成）
- [x] T007 [L1] 跑 `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`，确认 T002（`scanRenameShellContext` 单测）与 T003（改名跟随抗伪造用例）全部转绿；同时确认 plan.md「回归风险评估」表列出的既有 describe 块（F224 `sed` 边界、F224 heredoc 跟随、F225 同段共现、F228 代码区豁免、codex C-2 六条硬化断言、F224 全部改名跟随用例）零红（依赖 T005、T006）

**Checkpoint**：第 1 层改动完成，A/D 两条伪造改名不再被跟随；此时 T004 的 A/D 用例应转绿，E 与 E 对照两条仍应保持 T004 编写时记录的原状态（因第 2 层尚未实现）

---

## Phase 4: 实现（第 2 层 —— 判定下界收窄，取两收口合同交集）

- [x] T008 [L2] 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 改写 `evaluate()` 内 F224 CRITICAL 收窄段（当前 L164-178），按 plan.md 2.1 节 diff：删除 `const counts = verdict.delegationCounts; const hasClosureDelegation = counts.implement > 0 || counts.verify > 0;`，替换为 `const hasVerifyClassDelegation = delegations.some((d) => d && (d.roleClass === 'verify' || d.noopVerify === true));`；`if (featureDirUndetermined && hasClosureDelegation)` 条件改为 `if (featureDirUndetermined && hasVerifyClassDelegation)`；注释按 plan.md 原文更新（说明并集→交集的收窄理由、`noopVerify` 分支不可省的原因）。`evaluate()` 其余部分（早退、`anchor`/`isFix` 判定、`candidate`/`featureDirUndetermined` 计算、`delegations`/`featureDirCheck`/`fixReport`/`verificationReport`/`closure`/`executionRecords` 读取、`judgeCompliance` 调用、函数末尾正常 return）逐字不动
- [x] T009 [L2] 跑 `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`，确认 T004 全部 5 条用例（A/D/C/E/E 对照）转绿；同时确认既有 F224 SC-005/SC-005b CLI 端到端用例（`unresolvableTranscript`/`zeroDelegationRenamedTranscript`/仅 verify 类委派场景等，L798-913）零红（依赖 T005-T008 全部完成，因 CLI 端到端同时经过第 1 层与第 2 层）

**Checkpoint**：两层改动均完成，差分矩阵 A/D/E 从「静默 exit 0」变为「exit 2 阻断」，C 保持合法降级 exit 0

---

## Phase 5: 文档同步

- [x] T010 [P] 更新 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 中 `applyRename` 与 `resolveFeatureDirCandidate` 顶部既有 JSDoc（若有描述改名跟随判据的段落），补充引用 F230 与 `scanRenameShellContext` 的关系说明；确保不与 T005 已写入的新函数 JSDoc 重复
- [x] T011 [P] 更新 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 中 `evaluate()` 降级段的契约注释（已在 T008 中一并完成写入，本任务为核对项）：确认注释准确区分「transcript 能力失效」与「判定层单维度不确定复用同一通道」两种语义，避免未来维护者误读
- [x] T012 核对 `specs/230-fix-compliance-forged-rename-failopen/plan.md` 提及的 `contracts/fix-compliance-judge-cli.md` 场景表是否需要补「伪造改名不触发降级」一行；若该 contract 文件存在且场景表描述与新行为不一致则补充一行，若不存在或本次改动未新增对外可观察场景则不改动（plan.md 已标注为"实施阶段核对"，不属于新增改动范围）

---

## Phase 6: 全量验证（收尾门禁，必须全部零失败）

- [x] T013 跑 `npm run test:plugins`，确认零失败（覆盖 `plugins/spec-driver/tests/*.test.mjs` 全量，包括 T002-T004 新增用例与既有 F224/F225/F227/F228 全部回归）（依赖 T005-T009）
- [x] T014 跑 `npx vitest run`，确认零失败（覆盖仓库其余 TS 测试套件，验证本次改动未产生跨包副作用；预期本次改动完全收敛在 `.mjs` 脚本内，此步骤为确认无意外耦合）（依赖 T005-T009）
- [x] T015 跑 `npm run build`，确认类型检查零错误（本次改动为 `.mjs` 脚本，预期对 TS 构建零影响，此步骤为确认无意外破坏）（依赖 T005-T009）
- [x] T016 跑 `npm run repo:check`，确认零失败（source-of-truth 同步、release contract、charter 等仓库级校验通过）（依赖 T005-T012）
- [x] T017 用 T001 落地的 `repro-f230-matrix.mjs` 复现脚本再跑一次，确认**改动后**输出：A/D/E 三行 `transcriptDiagnostics` 为 `[]` 且 `compliant:false`；C 保持 `transcriptDiagnostics` 含 `"feature-dir-unresolvable"`（合法降级不变）；B 保持 `compliant:false`——与 plan.md「附录」章节末尾的预期输出逐条核对一致（依赖 T005-T009）

---

## Dependencies & Execution Order

### Phase 依赖

- **Phase 1（Setup）**：无前置依赖，立即开始
- **Phase 2（Tests First）**：依赖 Phase 1 完成（需要基线锚点先行记录，但 T002-T004 本身编写不依赖 T001 的执行结果，可与 T001 并行编写，仅要求在 Phase 3 开始前完成并确认红/绿状态）
- **Phase 3（L1 实现）**：依赖 Phase 2 完成（T002、T003 必须先存在且已跑红）
- **Phase 4（L2 实现）**：依赖 Phase 3 完成（T004 的 CLI 端到端用例同时经过 L1+L2 两层，必须 L1 先落地）
- **Phase 5（文档同步）**：依赖 Phase 4 完成（T008 已写入判据注释，T010-T012 是核对与补充）
- **Phase 6（全量验证）**：依赖 Phase 4（实现）与 Phase 5（文档）全部完成

### L1 / L2 独立性

- L1（T005-T007）与 L2（T008-T009）改动两个不同文件、两处独立逻辑，理论上可并行实现；但 T004（CLI 端到端）同时验证两层组合行为，必须等两层都完成才能全绿，故 Phase 4 不早于 Phase 3 完成后开始
- 若需要并行分工：一人做 T005-T007（L1），另一人同时做 T008 的代码改写（L2 代码本身不依赖 L1），但 T009（L2 验证）与 T013 起的全量验证仍需等两层都合并后再跑

### 并行机会

- T002、T003 可并行编写（不同 describe 块，同一文件但无耦合逻辑）
- T010、T011、T012（文档同步）三项互不依赖文件冲突，可并行
- T013、T014、T015 三条验证命令可并行执行（各自独立的命令行调用，互不干扰）；T016、T017 需在前三者确认通过后执行（T016 依赖代码与文档均已落地，T017 需要完整两层实现才有意义）

---

## Implementation Strategy

**Tests-First 严格顺序**（本 fix 的核心约束，对应用户要求「回归测试任务排在实现任务之前」）：

1. Phase 1：记录改动前基线（T001）
2. Phase 2：编写全部回归测试，确认预期红/绿状态（T002-T004）——**此时不得触碰生产代码**
3. Phase 3：实现 L1，转绿 L1 相关测试 + 确认既有回归零红（T005-T007）
4. Phase 4：实现 L2，转绿 L2 相关测试 + 确认既有回归零红（T008-T009）
5. Phase 5：文档同步（T010-T012）
6. Phase 6：全量验证门禁，四项命令零失败 + 差分矩阵复现脚本比对（T013-T017）

**范围边界**：本任务列表严格对齐 plan.md「改动清单（函数级）」，仅涉及 2 个生产文件（`fix-compliance-core.mjs`、`fix-compliance-judge.mjs`）各一处局部改动 + 1 个新增导出纯函数，以及 2 个测试文件新增 describe 块。不新增 fixture 文件（沿用 F224 SC-005/SC-005b 内联构造风格）。不触碰 `scanArtifactPath`、`splitCommandTextSegments`、`RENAME_COMMAND_SEGMENT_REGEX`、`parseRenameOperands`、heredoc 已知限界。

---

## Notes

- [P] 任务＝不同文件或同文件内互不冲突的独立代码块，无执行依赖
- [L1]/[L2] 标注替代 User Story 标签，用于追踪本 fix 两层独立改动各自的回归证据链
- 提交前须完成 Phase 6 全部四项命令验证（`npm run test:plugins`、`npx vitest run`、`npm run build`、`npm run repo:check`）零失败
- 按项目 CLAUDE.md 约定，`git commit` 前需经 Codex 对抗审查（`codex:codex-rescue` 子代理，对抗视角审视 L1/L2 两处判据收窄是否引入新的误阻断或遗留旁路）
