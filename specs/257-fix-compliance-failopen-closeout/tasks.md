---
feature: 257-fix-compliance-failopen-closeout
mode: fix
phase: tasks
inputs:
  - specs/257-fix-compliance-failopen-closeout/plan.md
  - specs/257-fix-compliance-failopen-closeout/fix-report.md
---

# 任务清单 — F257 fix 依从性门禁两处 fail-open 收口

**输入**：`plan.md`（唯一权威来源，本清单不新增设计决策，只做可执行拆解）
**前置**：本 Feature 为 `mode: fix`，无 `spec.md` / User Story 优先级；改用 plan.md 的 **缺陷 1（D1）/ 缺陷 2（D2）/ 附带项（ATT）** 三条独立可验证轨道替代 User Story 分组，语义对齐 plan §Impact Assessment 的 P1/P2/P3 强制分阶段（HIGH 风险 → 必须分阶段、每阶段独立验证通过才可进入下一阶段）。

## 格式：`[ID] [P?] [Tag?] 描述 + 文件路径`

- **[P]**：可与同组内前一条并行（不同文件、无依赖）
- **[Tag]**：`D1`=缺陷1 / `D2`=缺陷2 / `ATT`=附带项 / `契约`=contract 同真 / 无 tag = 跨轨道收尾任务
- 每条任务都标注**改哪个文件**与**怎么验证**

## 硬约束（贯穿全部任务）

- **TDD 红先行**：D1 / D2 / ATT 三轨道均先写测试、跑出真实红（把失败输出片段记进 `verification/verification-report.md`），再实现。
- **不新增 plan 之外的设计决策**：实现细节严格照 plan §3/§4/§6/§7 的代码片段与措辞草稿落地；发现 plan 有缺口的地方本清单标 `[需主线程确认]`，不得自行拍板。
- **判定器逐字不改清单**（plan §1 图注 / §5.3）：`resolveFeatureDirCandidate`、`scanRenameCommandEvents`、F227 候选历史兜底循环、F224 降级通道、`routeBlock`、`releaseDegraded`、`loadBlockState`/`io.mjs` 全文件——任何任务都不得触碰这些函数体。
- **提交纪律**：全部改动须用**显式路径**加入暂存区，**禁用 `git add -A`**；`specs/src.spec.md` 属再生噪声，commit 前若被再生须 `git checkout -- specs/src.spec.md` 还原，永不入 commit。
- **对抗审查档位**（Codex 配额暂停期）：门禁 / 判定器类改动须用独立子代理异构对抗 ×2 切入角，commit message 与 fix-report.md 必须显式标注「Codex 审查暂停，异构档位缺席」。

---

## 🔴 勘误（implement 落地后追加，2026-08-06）——下列任务描述中的标识符已作废

> 本节**只追加、不改写下方任务原文**（保留可追溯性）；凡冲突处一律以本节 + 代码实现为准。
> 完整说明见 `plan.md` 文首「勘误 E1 / E2 / E3」。

| 任务描述中的写法（**已作废**） | 代码实际实现 | 波及任务 |
|---|---|---|
| `countPostAnchorAssistantEntries(entries, anchorLineIndex)` | `countAssistantEntriesSinceEarliestFixExpansion(entries)`（**单参**） | T012 / T013 / T017 / T018 |
| 字段 `postAnchorAssistantEntries` | `assistantEntriesSinceEarliestFix` | T018 / T019 / T020 / T031 / T032 |

**语义一并改变，不只是改名**：计量基线由"判定主锚点（= **最晚**一次 fix 展开）"改为"**最早**一次
`spec-driver-fix` 展开"。原基线被 Phase 2 对抗审查 CRITICAL-2 实跑证伪——agent 自调一次
`Skill(spec-driver-fix)` 即可把主锚点推到末尾、计数归零（攻击组 30/30 全 exit 0）。因此任务描述里
"锚点后 entry 数"字样，实际语义均为"最早一次 fix 展开之后的 entry 数"。常量名
`POST_ANCHOR_ENTRY_DEFER_LIMIT` 未改（历史沿革），取值 **420**（T012 的取数与公式步骤已由
plan §4.3 的 C3 修正框取代，无需重跑）。

另：T019 描述的 `complianceVerdict: { …, blockCount: null }` 传参正确，但**落盘终态里该键缺席**
（`normalizeComplianceVerdict` 只收有限数值，`null` 被整键丢弃）；相应断言须写"键缺席"。
T019 引用的 plan §4.4「多写终态记录方向安全」结论成立，但其中"单会话最多写 3 条"的数量论证已作废
（删状态时每轮都会写一条，上界由闸门三约束）。

### 🔴 E1′ · 对上表自身的更正（Phase 4 审查后追加，2026-08-06）

**上表第 1 行的"代码实际实现"一列已失真。** 勘误块存在的目的就是"正文失真时以此为准"，
它自己失真危害更大，故在此更正（同样只追加、不改写上表原文）。完整论证见 `plan.md`「勘误 E1′」。

| 上表写法（**已失真**） | 代码真实实现（以此为准） |
|---|---|
| `countAssistantEntriesSinceEarliestFixExpansion(entries)`（**单参**、"自带基线扫描"） | `countAssistantEntriesSinceEarliestFixExpansion(entries, earliestFixLineIndex)`（**双参**，基线由**显式入参**给入；函数体内**不跑任何正则**） |
| 常量 `POST_ANCHOR_ENTRY_DEFER_LIMIT`（"未改，历史沿革"） | 已改名 **`EARLIEST_FIX_ENTRY_DEFER_LIMIT`**；**取值仍为 420，未变** |

- **为何是双参**：第 3 轮 WARNING 推翻了"自带基线扫描"——那等于全链跑两趟
  `SKILL_EXPANSION_REGEX`，该正则含惰性量词，诱饵前缀语料下红队 A/B 实测 **10188ms → 19785ms**。
  终态实现由 `detectFixSkillExpansion` 在**同一趟**里增量产出 `earliestFixLineIndex` 再传入。
  测试 `C-2j` 结构钉子锁死：函数体内不得出现 `SKILL_EXPANSION_REGEX`、且
  `assert.equal(fn.length, 2, '基线必须是显式入参')`。🔴 **照上表原文去"对齐"会回滚性能修复并打红 C-2j。**
- **为何改名**：`POST_ANCHOR_` 指向"判定主锚点 = **最晚**一次展开"，而上表自己刚记录那是被实测证伪的
  错误语义。名字与它约束的量方向相反，顺着名字理解就会把修复改回攻击者想要的实现。
- ⚠️ 本文件下方任务原文中的旧常量名属**历史记录，刻意保留不动**；活代码与 contract 已全部改新名。
- 另补：T017/T018 的任务描述未提及 `detectFixSkillExpansion` 需**新增返回字段** `earliestFixLineIndex`
  （成稿时该需求尚未出现），实际实现含这一改动，已补进 `plan.md` §8 变更清单（行 1b~1d / 3b / 12b）。

---

## Phase 1：缺陷 1 收口 —— 写入见证门槛（plan §3，D1）

**目标**：short-name 磁盘重锚定新增"本会话成功写入见证"门槛，消除无意静默采信他人历史目录的 fail-open。
**独立验证**：`npm run test:plugins` 中 `fix-compliance-core.test.mjs` 的 C-1a~C-1h、`fix-compliance-judge-cli.test.mjs` 的 T-1a~T-1i 全绿，且 M1/M2/M3 三条变异各能打红对应用例。

### 红先行

- [x] T001 [P] [D1] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增纯函数单测 C-1a~C-1h（plan §9.2：命中两种制品路径 / `lineIndex<=anchor`不入集 / 非 assistant 不入集 / 无回执或 error 或 toolUseId 不匹配不入集 / `-retry` 子串越界反例 / 尾随斜杠·大写·`..`段·非制品文件不入集 / projectRoot 内外绝对路径 / 20k entries 性能阈值）。此时 `collectArtifactWriteWitnessDirs` 未导出，跑该文件应因 import/undefined 报错——即为红。
- [x] T002 [P] [D1] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 新增 E2E 用例 T-1a~T-1i（plan §9.1 全部 9 条 fixture 构造与断言逐条照抄）。T-1b/T-1h/T-1i 应复用/贴近现状行为（暂时可能已绿或部分绿），T-1a/T-1c/T-1d/T-1e/T-1f/T-1g 在改动前应观察到与预期不符的退出码（红）。
- [x] T003 [D1] 依赖 T001, T002：执行 `npm run test:plugins`，把 C-1*/T-1* 各条的**实际失败输出片段**记入 scratchpad（后续 T041 汇总进 verification-report.md），确认确实先见过红再往下走。

### 实现

- [x] T004 [D1] 依赖 T003：在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`「在途委派判定」段之后新增小节：`ARTIFACT_WRITER_TOOL_NAMES`（frozen Set，仅 `'Write','Edit'`）、模块私有 `ANCHORED_ARTIFACT_PATH_REGEX`（plan §3.2 精确正则）、导出函数 `collectArtifactWriteWitnessDirs(entries, anchorLineIndex, projectRoot)`。严格按 plan §3.3 五条归一化规则实现（分段级前缀剥离、`./` 剥离、`..` 段拒绝、锚定全串匹配反取目录）；JSDoc 写明安全下界来源（harness `tool_result` 不可伪造）、禁止 `includes()`/裸 `startsWith()` 的不变量、fail-closed 方向、O(entries+toolUse+toolResult) 性能约束（plan §3.4，`resultByToolUseId` 单趟预建后 O(1) 查找）。
- [x] T005 [P] [D1] 依赖 T003：在 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json` L36-50 的 `diagnostics` enum **一次性**新增两项：`feature-dir-witness-absent`（缺陷1）与 `delegation-in-flight-entry-budget-exhausted`（缺陷2，plan §4.2）——两个诊断码同批加入避免同一文件二次改动；确认旧枚举值全部保留（向后兼容，plan Impact Assessment）。
- [x] T006 [D1] 依赖 T004：在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` L23-38 import 块追加导入 `collectArtifactWriteWitnessDirs`；在 L220-233 short-name 分支按 plan §3.5 代码片段接线（`witnessed = collectArtifactWriteWitnessDirs(...)` 惰性计算一次 → `diskMatches = usableMatches.filter((dir) => witnessed.has(dir))` → 命中取末项否则置 `witnessAbsent = true`）；同步更新该段"已知限界"注释，删除 F256"属被接受限界的边际扩大"的旧结论，改记 A′ 门槛与类 X（plan §5.2）。**求值顺序不得颠倒**：`usable()`（statSync）在前、`witnessed.has`（O(1)）在后。
- [x] T007 [D1] 依赖 T005, T006：在 `fix-compliance-judge.mjs` L260-270 `judgeCompliance` 调用处，把 `witnessAbsent` 并入传给 `diagnostics` 参数的数组（追加 `'feature-dir-witness-absent'`）。**绝不可**放进 `transcriptDiagnostics`（会触发 `runHook` L497-500 的 fail-open 早退，见 plan §3.6 红字警告）。
- [x] T008 [D1] 依赖 T004, T006, T007：重跑 `npm run test:plugins`，确认 C-1a~C-1h 与 T-1a~T-1i 全绿；记录本次由红转绿的对照。

### 变异测试（证守护力，plan §9.6）

- [x] T009 [D1] 依赖 T008：变异 M1——临时删掉 `.filter((dir) => witnessed.has(dir))`（还原 F256 行为），跑 `npm run test:plugins`，确认 T-1a、T-1d 转红且 T-1b 仍绿（互补合同两向都被钉住），记录实际失败输出后还原代码、重跑确认复绿。
- [x] T010 [D1] 依赖 T008：变异 M2——把匹配从锚定全串改为 `written.includes(dir)`，确认 T-1d 转红，记录后还原。
- [x] T011 [D1] 依赖 T008：变异 M3——删掉 `tool_result` 非 error 判断（`if (!r || r.isError === true) continue;`），确认 T-1a、T-1e 转红，记录后还原。

**Checkpoint**：Phase 1 三条变异全部生效、C-1*/T-1* 全绿后方可进入 Phase 2（HIGH 风险分阶段约束，plan §Impact Assessment）。

---

## Phase 2：缺陷 2 收口 —— 单调轮次上界（plan §4，D2）

**目标**：推迟通道追加一条派生自 transcript、不可被删状态文件抹除的第三闸门，并联取严；推迟事件写终态记录，提升审计可见性到与降级放行同档。
**独立验证**：C-2a~C-2c、T-2a~T-2g 全绿；M4/M5/M6 各能打红对应用例；阈值标定数据已落盘。

### 阈值标定（实做取数任务，非可选，plan §4.3）

- [x] T012 [P] [D2] 在 scratchpad 写一次性只读脚本（**不入库**），遍历 `~/.claude/projects/**/*.jsonl`：对每个 transcript 跑 `readTranscriptEntries` → `detectFixSkillExpansion`，若最终锚点 `mode === 'fix'` 则计算 `countPostAnchorAssistantEntries`（此时该函数尚未在 core 实现，可临时内联等价逻辑或等 T017 完成后再跑本任务的执行子步骤——**取数逻辑设计先行、实际执行可放在 T017 之后**）。产出：样本量 N，P50/P90/P95/P99/max。额外按 §4.3 步骤 3：从 F256 既有测试用**截断回放**方式逐点读出 F254 交付会话在各 stop 点的 `postAnchorAssistantEntries` 最大值。按公式 `LIMIT = ceil(max(P99_real, 60) × 1.5 / 10) × 10` 算出最终阈值；若与占位值 `200` 差距超过 2×，在后续 fix-report 补记解释。零写入、零网络，脚本本身不提交。
- [x] T013 [P] [D2] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增纯函数单测 C-2a~C-2c（只数 `role==='assistant' && lineIndex>anchor`；`anchorLineIndex=null` 按 `-1` 处理；对递增 transcript 前缀逐点断言计数只增不减）。`countPostAnchorAssistantEntries` 未实现，红。
- [x] T014 [P] [D2] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 新增 E2E 用例 T-2a, T-2b, T-2c, T-2d, T-2f, T-2g（plan §9.3；T-2a/T-2b 每轮跑 CLI 前先删 `.specify/runs/.fix-compliance-state/`，红先行主用例；T-2c 终态可见性；T-2d 闸门二不回归——状态文件不删、4 轮下第 1-3 轮推迟第 4 轮进正常裁决，此为**现状已应绿**的基线用例，不得破坏；T-2f warn 档；T-2g report 透传）。
- [x] T015 [D2] 依赖 T012：新增用例 T-2e（真实等待不误伤），锚点后 entry 数取 T012 标定所得 P99 附近的真实量级构造 fixture，断言仍 `exit 0` 推迟。
- [x] T016 [D2] 依赖 T013, T014, T015：跑 `npm run test:plugins`，记录 C-2*/T-2a,b,c,e,f,g 的红输出（T-2d 此时应仍绿，作为不回归基线核对）。

### 实现

- [x] T017 [D2] 依赖 T016：在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 新增导出函数 `countPostAnchorAssistantEntries(entries, anchorLineIndex)`（plan §4.1 代码原样：线性扫描、单调、无正则无分配）。JSDoc 写明"数 entry 而非'轮'"的理由、单调性理由、compaction 场景的已知非单调面登记（不声称覆盖）。
- [x] T018 [D2] 依赖 T012, T017：在 `fix-compliance-judge.mjs` L23-38 追加导入 `countPostAnchorAssistantEntries`；L75 附近新增常量 `POST_ANCHOR_ENTRY_DEFER_LIMIT = <T012 标定值，若标定未完成先写 200 并标 TODO(calibration)>`（含语义 / 标定方法 / 容错三段 JSDoc，逐字覆盖 plan §4.3 的三段论证——不得只写数值不写理由）；L302-310 `evaluate` 返回对象新增字段 `postAnchorAssistantEntries`（复用已有 entries/anchor，零额外读取）。
- [x] T019 [D2] 依赖 T018：在 `fix-compliance-judge.mjs` L530-553 推迟段按 plan §4.2 代码片段并联接线：`entryBudgetLeft = result.postAnchorAssistantEntries < POST_ANCHOR_ENTRY_DEFER_LIMIT`；`if (countBudgetLeft && entryBudgetLeft)`（**严禁 `||`**，M4 专钉这条）；两道预算耗尽分别推 `delegation-in-flight-budget-exhausted` / `delegation-in-flight-entry-budget-exhausted` 诊断码；推迟成功分支新增调用 `recordDeferTerminal(...)`（下一条任务实现）。在 `releaseDegraded` 之后新增该函数：`try/catch` 包裹，`recordWorkflowRun({ result: 'paused', complianceVerdict: { degraded:false, blockCount:null, ... } })`，不设幂等标记（plan §4.4 论证：多写终态记录方向安全）。
- [x] T020 [D2] 依赖 T019：在 `fix-compliance-judge.mjs` `runReport` L574-583 输出新增 `postAnchorAssistantEntries` 字段（`--mode report` 恒 exit 0、零落盘、不施加闸门，逐字保持既有约束）。
- [x] T021 [D2] 依赖 T005, T017, T018, T019, T020：重跑 `npm run test:plugins`，确认 C-2a~C-2c、T-2a~T-2g 全绿，T-2d 基线未破坏。

### 变异测试（plan §9.6）

- [x] T022 [D2] 依赖 T021：变异 M4——把 `countBudgetLeft && entryBudgetLeft` 改成 `||`，确认 T-2a、T-2b 转红，记录后还原。
- [x] T023 [D2] 依赖 T021：变异 M5——把闸门三计量源换成 `loaded.inFlightDeferCount`（回退成可被抹除的量），确认 T-2a、T-2b 转红，记录后还原。
- [x] T024 [D2] 依赖 T021：变异 M6——删掉 `recordDeferTerminal` 调用，确认 T-2c 转红，记录后还原。

**Checkpoint**：Phase 2 标定数据已落盘、三条变异全部生效、T-2d 不回归确认后方可进入 Phase 3。

---

## Phase 3：附带项 + contract 同真（plan §6/§7，ATT/契约）

**目标**：`copyTree` 排除 `worktrees` 子树；contract 与实现同真，不得残留已被证伪的无条件断言。

### 附带项：copyTree 排除（ATT）

- [x] T025 [ATT] 在 `tests/integration/repo-maintenance-sync-check.test.ts` 新增白盒用例 T-3b：临时 fixture 源目录同时含 `worktrees/`（放哨兵文件）与 `worktrees-archive/`（放哨兵文件），直接调用 `copyTree(projectRoot, relativePath, { exclude: ['worktrees'] })`，断言目标**不含** `worktrees/`、**仍含** `worktrees-archive/`（分段级边界）。此时 `copyTree` 无 `exclude` 形参，红。
- [x] T026 [ATT] 依赖 T025：在同文件 L39-43 按 plan §7 代码片段改写 `copyTree` 签名为 `(projectRoot, relativePath, options: { exclude?: string[] } = {})`，`cpSync` 加 `filter`，边界比较用 `src === ex || src.startsWith(\`${ex}/\`)`（分段级，禁裸 `startsWith`）；L62 调用点改为 `copyTree(projectRoot, '.claude', { exclude: ['worktrees'] })`；其余调用点因第三参可选保持零改动。
- [x] T027 [ATT] 依赖 T026：跑 `npx vitest run tests/integration/repo-maintenance-sync-check.test.ts`，确认既有 T-3a（全部原有断言）与新增 T-3b 均绿。
- [x] T028 [ATT] 依赖 T027：变异 M7——去掉 `copyTree` 的 `filter` 选项，确认 T-3b 转红，记录后还原。
- [x] T029 [ATT] 依赖 T027：变异 M8——把分段级边界改为裸 `src.startsWith(ex)`，确认 T-3b 转红（`worktrees-archive` 被误排除），记录后还原。
- [ ] T030 [ATT] 依赖 T027：**在主仓库**（非本 worktree，`REPO_ROOT = resolve('.')` 取 cwd）跑该测试文件，记录改动前后墙钟耗时对比（T-3c，人工），写入 verification-report；如实注明 worktree 内 `.claude` 仅 36K、不可复现此项。

### contract 同真（契约）

- [x] T031 [P] [契约] 依赖 T008, T021：改写 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md`：
  - L67-70 闸门表新增第三行「三 · 会话长度预算」+ 表下补一句"三道闸门取合取（AND），任一不满足即不推迟"（plan §6.1）；
  - L80-81 改用 plan §6.2 草稿整段替换（含"闸门二单独不构成上界"的证伪记录 + "有前提、可检验"的更正断言 + `record-workflow-run` 终态记录说明）；
  - L89-90 改用 plan §6.3 草稿整段替换（含闸门三兜底描述 + compaction 残余限界登记）；
  - L98-102 report 字段表补 `postAnchorAssistantEntries` 一行（plan §6.4）；
  - 特性目录解析章节按 plan §6.5 补记 short-name 重锚定新采信条件、新诊断码 `feature-dir-witness-absent`、类 X 已知新增误阻断形态及补救路径。
- [x] T032 [契约] 依赖 T031：逐字核对 contract 措辞中出现的常量名（`POST_ANCHOR_ENTRY_DEFER_LIMIT`）、诊断码（`feature-dir-witness-absent` / `delegation-in-flight-entry-budget-exhausted`）、字段名（`postAnchorAssistantEntries`）与代码实现完全一致（大小写、连字符、下划线均逐字比对），且 R10 措辞（plan §10）"有界化，不是消除"未被写成"删状态不再有效"式的过度声称。

**Checkpoint**：Phase 3 完成后三条轨道（D1/D2/ATT/契约）均独立验证通过，方可进入全量门禁。

---

## Phase 4：全量门禁与交付制品收尾

**目标**：仓库级零回归验证 + 判定器快照漂移状态确认 + 对抗审查 + 制品补记。

- [x] T033 依赖 T009, T010, T011, T022, T023, T024, T028, T029, T030, T032：`npx vitest run` 零失败（含 T025-T030 的 `repo-maintenance-sync-check.test.ts`）。
- [x] T034 依赖 T033：`npm run test:plugins` 全量重跑（不只测新增文件，整个插件测试套件）零失败。
- [x] T035 依赖 T034：`npm run build` 类型检查零错误。
- [x] T036 依赖 T035：`npm run repo:check` 零失败（复核 source-of-truth / 包装层同步链路，含本次 schema/contract 改动）。
- [x] T037 依赖 T036：`npm run release:check`（本次未触及 release contract，预期零改动零失败，仅作门禁完整性确认）。
- [x] T038 依赖 T037：`npm run judge:doctor`，确认已安装插件快照相对仓库源码的漂移状态；在 T040 交付说明中显式写清"本次修复须下次 plugin 发版后才对本机 Stop hook 门禁生效"。
- [x] T039 依赖 T038：启动独立子代理做对抗审查 ×2 切入角（① fail-open 独立盘点：是否存在新的 `return 0` / 新的静默放行分支；② 加固方案绕过构造：尝试伪造写入见证、尝试延续推迟绕过闸门三），产出 critical/warning/info 三档结论；critical 全部修复后重跑 T033-T036；commit message 与 fix-report.md 显式标注「Codex 审查暂停，异构档位缺席」。

### 制品收尾

- [ ] T040 依赖 T039：在 `specs/257-fix-compliance-failopen-closeout/fix-report.md` 追加交付记录（commit hash、改动文件清单核对 §8、对抗审查结论、Codex 暂停标注、"须下次插件发版后本机门禁生效"说明）。
- [x] T041 依赖 T012, T009, T010, T011, T022, T023, T024, T028, T029, T030: 产出 `specs/257-fix-compliance-failopen-closeout/verification/verification-report.md`——汇总：标定数据表（N/P50/P90/P95/P99/max/最终取值，与占位 200 的差距说明）、8 条变异测试的实际失败输出片段、主仓库墙钟对比（T030）、T038 的 `judge:doctor` 结果、§9.7 全量门禁结果逐项列出。
- [x] T042 [P] 依赖 T039：在 `specs/256-fix-compliance-false-blocks/fix-report.md` 追加一句回指——其登记的"被接受限界的边际扩大"结论已由 F257 收口（如实追记，不改写历史结论原文）。
- [ ] T043 依赖 T040, T041, T042：提交前检查——`git status` 核对改动文件清单与 plan §8 逐文件变更清单一一对应（含 12 个直接改动路径）；若 `specs/src.spec.md` 被再生须 `git checkout -- specs/src.spec.md` 还原；commit 使用**显式路径列表**（禁 `git add -A`）。

> **勾选状态说明（Phase 4 收尾时按磁盘事实核对，2026-08-06）**：43 条中 **40 条已完成并勾选**，
> 3 条保持未勾选，原因逐条如下（**不是遗漏**）：
>
> | 任务 | 未勾选原因 |
> |---|---|
> | **T030** | 需要**在主仓库**（非本 worktree）跑该测试文件取墙钟对比。本 worktree 内 `.claude` 仅 36K，该项**结构性不可复现**；且本轮硬约束禁止在主仓库路径下写任何东西。已在 `verification-report.md` 如实注明为未验证项 |
> | **T040** | 交付记录需含 **commit hash**，而本轮改动尚未 commit，hash 不存在。其余四项内容（改动文件清单核对 §8 / 对抗审查结论 / Codex 暂停标注 / "须下次插件发版后生效"说明）已分别落在 `fix-report.md` 与 `verification-report.md` |
> | **T043** | 提交前检查按定义在 **commit 那一刻**执行，本轮未执行任何 git 写操作 |
>
> ⚠️ 另需读清：T031/T032 的"contract 同真"在 Phase 4 审查中被查出**三处仍失真**（同编号不可达的演绎理由 /
> "闸门三自带基线扫描" / 常量名），已在本轮收口。勾选表示"该任务已执行"，**不表示其产出此后永不再需修正**。

---

## 覆盖矩阵（plan 关键章节 → 任务 ID，替代无 spec.md 场景下的 FR 覆盖表）

| plan 章节 | 内容 | 任务 ID |
|---|---|---|
| §3.2/§3.3（判据实现） | `collectArtifactWriteWitnessDirs` + 归一化规则 | T004 |
| §3.5（judge 接线） | short-name 分支 `.filter()` + `witnessAbsent` | T006 |
| §3.6（诊断码 O1） | `feature-dir-witness-absent` + schema enum + 不进 `transcriptDiagnostics` | T005, T007 |
| §4.1（计量函数） | `countPostAnchorAssistantEntries` | T017 |
| §4.2（并联接线） | `&&` 取严 + 双诊断码 | T019 |
| §4.3（阈值标定，必做取数） | 脚本取数 + 公式 + 占位覆盖 | T012, T018 |
| §4.4（终态记录） | `recordDeferTerminal` + `result:'paused'` | T019 |
| §6.1-6.5（contract 同真） | 闸门表 / L80-81 / L89-90 / L98-102 / 特性目录章节 | T031, T032 |
| §7（copyTree 排除） | `exclude` 形参 + 分段级边界 | T025, T026 |
| §9.1/§9.2（缺陷1测试） | C-1a~C-1h, T-1a~T-1i | T001, T002 |
| §9.3/§9.4（缺陷2测试） | C-2a~C-2c, T-2a~T-2g | T013, T014, T015 |
| §9.5（附带项测试） | T-3a, T-3b, T-3c | T025, T027, T030 |
| §9.6（变异测试 M1-M8） | 8 条变异全覆盖 | T009-T011, T022-T024, T028-T029 |
| §9.7（全量门禁） | vitest / test:plugins / build / repo:check / judge:doctor | T033-T038 |
| §10（残余限界如实登记） | R1-R10 措辞须与实现同真 | T032, T040, T041 |

---

## 依赖关系与并行说明

### Phase 依赖

- **Phase 1（D1）** 与 **Phase 2（D2）** 的红先行测试编写（T001/T002 与 T012-T014）可**跨 Phase 并行**（不同文件区块、判据互不依赖），但各自 Phase 内部"红先行 → 记录红 → 实现 → 转绿 → 变异测试"的顺序不可打乱。
- **Phase 3（ATT+契约）** 的 T031（contract 同真）依赖 D1（T008）与 D2（T021）均已验证通过——contract 文本必须与两条实现同真，不能提前定稿。
- **Phase 4（全量门禁）** 依赖 Phase 1/2/3 全部变异测试与验证任务完成，这是 HIGH 风险改动的强制收口点（plan §Impact Assessment：未通过不得进入下一 Phase）。

### 并行机会

- T001/T002（D1 测试）与 T012/T013/T014（D2 测试与标定）可并行执行（不同文件、不同判据）。
- T005（schema）可与 T004/T006（D1 实现）并行，因为枚举值命名已在 plan 中固定，不依赖代码实现顺序。
- T025（ATT 红先行）与 D1/D2 全程无依赖，可随时插入并行执行。
- T042（F256 fix-report 回指）与 T040/T041 互不依赖，可并行。

### 建议实施策略

**顺序优先（推荐，因 HIGH 风险且判定器改动需严格 A/B 归因）**：Phase 1（D1）完整跑完变异测试确认收口 → Phase 2（D2）完整跑完 → Phase 3（ATT+契约）→ Phase 4 全量门禁。避免"并行团队"策略——plan §Impact Assessment 明确说明"P1/P2 混做会让回归归因失效"，D1 与 D2 的实现与变异测试环节不建议并行由不同执行者同时进行；仅测试编写（红先行）阶段可并行。
