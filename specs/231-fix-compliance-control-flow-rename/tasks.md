# 任务分解（F231）— 改名跟随白名单闸门

> ⚠️ **本文件是历史制品，其任务分解对应的技术方案已被后续轮次取代，不代表最终实现。保留仅为审计轨迹。**
>
> 下列 T001–T015 是**「结构白名单」阶段**（`blankHeredocBodies` + `isSimpleRenameSequence`）的分解。该方案第 5 轮被 Codex 判「不宜合入」后作废，两个函数已从源码删除。**最终实现**（光杆单命令 token 化判据 + 严格 option 白名单 + 路径合法性 + 注入式磁盘嵌套否证探针）见 `fix-report.md`「修复策略（最终采纳）」与「逐轮审查记录」。

**输入**：`plan.md`（§1 精确文件改动、§3 测试矩阵、§5 实施顺序）、`fix-report.md`（锁定设计）
**模式**：fix（无任务确认质量门，直接进实现）
**核心文件**：
- 实现：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- 测试：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`、`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
- 文档：`specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md`

**组织原则**：本次是单文件安全闸门修复（非多 User Story 功能），任务按 plan.md §5 TDD 顺序组织为 6 个 Phase，而非按 User Story。每个测试任务对应 plan.md §3 矩阵的一个字母段。

## Format: `[ID] [P?] Description`

- **[P]**：可并行（不同文件或同文件不同独立用例块、无数据依赖）
- 所有任务标注：目标文件、动作、依赖的前序任务、验收标准

---

## Phase 1：反向回归先行（红）— 对应 plan §5 步骤 1

**目的**：在 HEAD 源码（无本次改动）上证明测试矩阵确实抓住了洞——新增用例此刻必须失败。

**⚠️ 依赖**：Phase 1 全部任务必须先于 Phase 2 起笔的实现代码提交；Phase 1 内部任务可并行（写在不同测试块，无共享可变状态）。

- [ ] T001 [P] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增 §3.1-A「11 类 Codex 反例」反向回归用例（C-S1/C-S2/C-S3/C-S4/C-ST1/C-ST2/C-ST3/C-ST4/C-D1/C-D2/C-D3），每条双断言：`assert.deepEqual(scanRenameCommandEvents(cmd), [])` + `assert.equal(resolveWith(cmd).path, 'specs/900-fix-x')` + `assert.equal(resolveWith(cmd).ambiguous, false)`。
  - 验收标准：11 条用例全部写入，此时（HEAD 源码）跑 `npm run test:plugins` **必须全部失败**（事件非空或 `ambiguous===true`），确认测试确在抓这个洞；失败原因需人工核对与 fix-report「逐 Codex-发现闭合对照」表逐条对应。

- [ ] T002 [P] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增 §3.1-B「6 类原始构造」反向回归用例（短路 RHS / 函数体 / 死 if / 未命中 case / 命令替换 / 零迭代循环），同样双断言（`scanRenameCommandEvents(cmd)===[]` 且候选不 `ambiguous`）。
  - 依赖：与 T001 各自独立可并行；建议紧邻 T001 写在同一 describe 块内便于维护。
  - 验收标准：6 条用例全部写入，HEAD 源码上跑 `npm run test:plugins` **必须全部失败**（fail-open：`{path:null, ambiguous:true}`）。

- [ ] T003 [P] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 新增 §3.2-H「端到端反向回归」（H1 短路 RHS 伪造+零委派、H2 死 if 伪造+零委派、H3 命令替换伪造+零委派），复用 `writeTranscript` + `TOOL_USE` helper。
  - 验收标准：3 条用例写入，HEAD 源码上跑该测试文件 **必须全部失败**（`runCli().status===0`，因 `ambiguous→feature-dir-unresolvable→exit 0` 放行，与断言的 `exit 2` 相悖）。

**Checkpoint**：`npm run test:plugins` 此刻应有 20 条新增用例（11+6+3）红，且失败模式与设计文档描述的洞一致。**不得跳过此 Checkpoint 直接进 Phase 2**——红色是证明测试有效性的唯一证据。

---

## Phase 2：heredoc 剥离 helper（实现）— 对应 plan §5 步骤 2

**目的**：先把 heredoc 正文等长空白剥离 helper 实现好并独立验证，为白名单闸门提供输入前置处理。

**依赖**：Phase 1 完成（红色确认）之后开始；T004（测试先行）与 T005（实现）之间是同文件红绿对，串行。

- [ ] T004 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增 §3.1-E「heredoc 剥离与 offset 对齐」专门 characterization 用例：
  - `scanRenameCommandEvents('cat <<EOF\nmv a b\nEOF')` → `[]`（正文剥离后无事件）
  - `cat <<EOF\nx\nEOF\nmv S D` 形态：产出事件 `offset` 落在剥离后 `text` 中 `mv` 的真实位置，且经 `resolveFeatureDirCandidate` 归段后正确跟随（复用 C5 形态断言最终 `path`）
  - 等长不变量：若 `blankHeredocBodies` 导出则直测 `blankHeredocBodies(cmd).length === unfoldLineContinuations(cmd).length` 且换行数不变；否则经 offset 一致性间接断言
  - 未闭合定界词：`cat <<EOF\nmv S D`（无闭合 `EOF`）→ `scanRenameCommandEvents===[]`
  - 依赖：T001-T003（Phase 1 checkpoint 已确认红）
  - 验收标准：用例写入后此刻仍应失败（尚未实现 helper 与闸门）。

- [ ] T005 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 实现新增导出纯函数 `blankHeredocBodies(command) → string`（plan §1.1）：识别 `<<[-]?\s*(WORD|'WORD'|"WORD"|\WORD)` 引入符（区分 herestring `<<<`）、支持 `<<-` 前导 tab 剥离、同行多 heredoc、正文用等长空白替换（保留换行结构）、定界词未闭合返回标记供闸门判不平衡。附 JSDoc 说明职责与不变量（等长、保换行）。
  - 依赖：T004（红）
  - 验收标准：`npm run test:plugins` 中 T004 新增的 §3.1-E 用例全部转绿；此时闸门 `isSimpleRenameSequence` 尚未接入 `scanRenameCommandEvents`，其余 Phase 1 用例（T001-T003）仍应保持红（因为闸门还没前置）。

**Checkpoint**：`blankHeredocBodies` 独立可测、等长不变量成立、offset 对齐验证通过；Phase 1 用例仍红（预期，闸门未接入）。

---

## Phase 3：白名单闸门（实现）— 对应 plan §5 步骤 3

**目的**：实现 `isSimpleRenameSequence` 并前置到 `scanRenameCommandEvents`，逐条转绿 Phase 1 的反向回归。

**依赖**：Phase 2 完成（`blankHeredocBodies` 已就绪）。T006 单任务、无法拆分（闸门 5 条规则共用同一状态机语义，拆分会引入词法漂移风险，plan §1.1 明确要求「二选一、避免第二套词法」）。

- [ ] T006 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 实现新增导出纯函数 `isSimpleRenameSequence(command) → boolean`（plan §1.1，逐条落地 fix-report 子语言 5 条规则）：
  1. heredoc 剥离已由 `blankHeredocBodies` 完成，定界词未闭合 → `false`
  2. 分隔符白名单：仅 `;`/换行/`|`/`|&`/单个 `&` 连接；未引用 `&&`/`||` → `false`
  3. 无分组/替换/子壳：未引用 `(`/`)`/`{`/`}`/`$(`/反引号/`<(`/`>(`/`$((` → `false`
  4. 命令位保留字/危险内建黑名单（`if then elif else fi while until for select do done case esac function time coproc ! [[ [` + `exit return exec eval source . alias shopt set trap logout break continue`）→ `false`；命令位 token 识别复用现有 `isWordStart` 完整 token 边界口径
  5. 词法平衡：引号必须闭合（`quote!==null → false`）、heredoc 必须闭合、游离 closer underflow → `false`
  然后在 `scanRenameCommandEvents` 开头前置该闸门（plan §1.1 示例代码）：`raw = unfoldLineContinuations(command)` → `text = blankHeredocBodies(raw)` → `if (!isSimpleRenameSequence(text)) return []` → 既有 F230 逐字扫描逻辑作用于 `text`（而非 `raw`）。
  - 依赖：T005
  - 验收标准：`npm run test:plugins` 中 Phase 1 全部用例（T001 的 11 类 + T002 的 6 类 + T003 的 H1/H2/H3）**全部转绿**；同时 Phase 1 checkpoint 中记录的失败模式（事件非空/ambiguous/exit 0）不再出现。

**Checkpoint**：反向回归矩阵（§3.1-A/B、§3.2-H）17 条用例全绿。**此时正向 characterization 与冻结用例可能被误伤（预期未测）**，进入 Phase 4 前不得跳过。

---

## Phase 4：更新 C4（冻结用例适配）— 对应 plan §5 步骤 4

**目的**：`&&` 收紧后，`cd . && mv …` 这条既有冻结用例（约 L1978）的预期行为已变，须显式更新断言与理由注释——这是本次**唯一被修改**的冻结用例。

**依赖**：Phase 3 完成。

- [ ] T007 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 更新 C4（`cd . && mv specs/900-fix-x specs/901-fix-y`）：断言改为 `assert.deepEqual(cand, {path:'specs/900-fix-x', ambiguous:false})`，描述文案改为「`&&` 条件右侧改名不跟随（F231）」，并追加理由注释：白名单拒绝 `&&`/`||`，方向保守（误阻断而非误放行），真实 `prep && mv` 链式改名须拆成独立 `git mv` 才跟随。
  - 验收标准：`npm run test:plugins` 中 C4 用例转绿（新断言）；grep 确认仓库内无其他位置引用 C4 旧断言值 `{path: 'specs/901-fix-y', ...}` 残留。

**Checkpoint**：C4 转绿，且是本次唯一改动的冻结断言（可用 `git diff` 核对 `fix-compliance-core.test.mjs` 除新增块外，既有断言仅此一处变化）。

---

## Phase 5：正向 characterization 补全（防过度收窄）— 对应 plan §5 步骤 5

**目的**：确认闸门未误伤合法简单改名序列与 F224 SC-005/SC-005b 放行路径。若任一用例被误收窄（红），需回到 T006 的规则 2/3/4 边界字符集核对。

**依赖**：Phase 4 完成。T008-T011 各自独立、不同断言块，可并行编写；但都需在 T006 之后才可能转绿，且需顺序验证（发现红时优先修 T006，避免多人同时改边界条件产生冲突）。

- [ ] T008 [P] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增/核对 §3.1-D「简单序列正向 characterization」用例：`mv A B`、`git mv A B`、`mv -f A B`（保 C3）、heredoc 后 mv（保 C5）、`mv A B | mv B C`（保 C6b）、`mv A B & mv B C`（保 C6c）、`mv A B; mv B C`（保 C6）、`|&` 分隔两跳（新正向）、`mv A B # 注释`（保 L2139）。
  - 验收标准：全部产出事件并正确跟随到最终 `path`；`npm run test:plugins` 绿。若某条红，定位是规则 2（`|&` 原子性）、规则 3（重定向边界）还是规则 4（命令位 token 边界与 `mv -f` 冲突）导致，修正 T006 后重跑本任务全部用例。

- [ ] T009 [P] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 核对 §3.1-F「全部 F230 直测」（L2026-2097 区段，行号可能因 T001-T008 新增用例而偏移，以内容定位而非行号）逐条保留：喂「简单 mv 命令」（白名单照常产出）或「引号/注释/非 mv」（前后皆 `[]`）——断言不变、不修改文案。
  - 验收标准：`npm run test:plugins` 中该区段全部用例绿，且与 git 历史比对（`git diff` 该区段除 C4 外零改动）。

- [ ] T010 [P] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 核对 §3.1-G 真实会话 `67720241` 测试用例（mv 在单引号 heredoc 数据内）：`compliant:true` 结论保持。
  - 验收标准：`npm run test:plugins` 绿；确认剥离逻辑未误判该会话内单引号数据为 heredoc 正文外内容。

- [ ] T011 [P] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 核对 §3.2-I（F224 SC-005，L798-832，单条裸 `git mv FEATURE_DIR specs/renamed-nonstandard` + implement+verify 委派 → `exit 0` 静默放行、`compliant:null` + `degraded:true` + `diagnostics` 含 `feature-dir-unresolvable`）与 §3.2-J（SC-005b，L834-902，零委派 + 单条非规范 `git mv` → `exit 2`；Codex 构造 A `sed -i …; mv …` 保持 `exit 2`）逐字保留，不修改断言。
  - 验收标准：`npm run test:plugins` 该文件全部绿；`git diff` 确认这两段测试代码零改动（仅新增 H1-H3 属 Phase 1 已完成的改动）。

**Checkpoint**：`npm run test:plugins` 全绿（Phase 1-5 全部新增/修改用例 + 全部既有冻结用例）。若仍有红用例，禁止进入 Phase 6。

---

## Phase 6：文档同步与全量验证 — 对应 plan §5 步骤 6-7

**依赖**：Phase 5 全绿。T012（文档）可与 T013 起点并行；T014（全量验证）必须在 T012/T013 完成后最后执行，且内部命令严格串行（任一失败即停并回到对应 Phase 修复）。

- [ ] T012 [P] 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 补齐 `scanRenameCommandEvents` 的 JSDoc：写明白名单子语言定义（「产出改名事件 ⟺ 整条命令是简单改名序列子语言成员」）与 soundness 一句话；`blankHeredocBodies`、`isSimpleRenameSequence` 各自补充职责 JSDoc（若 T005/T006 未随手写全，此处补齐收尾）。
  - 验收标准：三处导出函数均有完整 JSDoc（含 `@param`/`@returns`/不变量说明）；`npm run build` 类型检查通过（JSDoc 类型标注无冲突）。

- [ ] T013 核对 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md` 场景表，视需要补一行「非简单命令序列内的伪造改名不触发降级」说明改名跟随的新边界。
  - 验收标准：若判定需要补充，场景表新增一行且措辞与 fix-report/plan 术语一致（「简单改名序列」「白名单闸门」）；若判定不需要（场景表已足够抽象、未绑定具体判据细节），在本任务勾选时注明「核对后判定无需修改」，不得静默跳过核对动作本身。

- [ ] T014 按 plan §4 顺序执行全量验证命令，任一失败即停并修：
  1. `npm run test:plugins`（覆盖全部矩阵 §3.1-A~G + §3.2-H~J）
  2. `npx vitest run`（仓库级单测零失败）
  3. `npm run build`（类型检查零错误）
  4. `npm run repo:check`（source-of-truth / 包装层同步链路）
  - 依赖：T012、T013
  - 验收标准：4 条命令按序全绿，退出码均为 0；记录本次运行的失败次数与修复轮次（若有）供 verification 阶段引用。

- [ ] T015（人工核验，不入自动化门禁）对 Phase 1 的 11 类 Codex 反例逐条经真实 GNU Bash 5.x + 同名 `mv` shim 实跑，证明其确不执行 `mv`（双证）。
  - 依赖：T014 通过
  - 验收标准：11 条命令逐条在真实 shell 环境跑通，`mv` shim 均未被调用（无劫持输出/无副作用文件生成）；结果记录供 verification 阶段的「实现证据」引用，不写入自动化测试断言。

---

## FR 覆盖映射表

| 设计要求（fix-report / plan） | 对应任务 |
|---|---|
| 白名单闸门核心不变量（产出事件 ⟺ 简单改名序列子语言成员） | T005, T006 |
| 规则 1（heredoc 正文剥离，等长空白） | T004, T005 |
| 规则 2（分隔符白名单，拒绝 `&&`/`||`，`|&` 原子纳入） | T006, T008 |
| 规则 3（无分组/替换/子壳） | T006, T008 |
| 规则 4（保留字/危险内建命令位黑名单） | T006 |
| 规则 5（词法平衡，游离 closer） | T006 |
| 11 类 Codex 反例反向回归 | T001 |
| 6 类原始构造反向回归 | T002 |
| C4 冻结用例更新（唯一被改） | T007 |
| 正向 characterization（防过度收窄） | T008, T009, T010 |
| heredoc offset 对齐专项 | T004 |
| 端到端反向回归（judge CLI exit 2） | T003 |
| F224 SC-005 / SC-005b 放行保留 | T011 |
| JSDoc 不变量文档化 | T012 |
| contracts 场景表核对 | T013 |
| 全量验证序列 | T014 |
| 真实 shell 双证（人工，非自动化门禁） | T015 |

**覆盖率**：plan.md §3 测试矩阵 A-J 全部段落均有对应任务（100%）；fix-report 子语言 5 条规则全部映射到 T005/T006 的实现细分点。

---

## 依赖关系与并行说明

### Phase 依赖关系（严格串行，TDD 驱动）

```
Phase 1（反向回归·红）
   ↓ 必须先确认红色
Phase 2（heredoc helper·实现+单测转绿）
   ↓
Phase 3（白名单闸门·实现，Phase 1 转绿）
   ↓
Phase 4（更新 C4）
   ↓
Phase 5（正向 characterization 补全防过度收窄）
   ↓
Phase 6（文档 + 全量验证 + 人工双证）
```

**不可跳过或重排**：本次是安全闸门修复，红→绿的顺序本身就是证明「测试确实在抓洞」与「实现确实堵住洞」的证据链，plan.md §5 明确要求先红后绿。

### Phase 内部并行机会

- **Phase 1**：T001 / T002 / T003 三个任务写在不同 describe 块或不同测试文件，无共享可变状态，可并行编写。
- **Phase 2**：T004（测试）→ T005（实现）同文件红绿对，必须串行。
- **Phase 3**：T006 单任务不可拆（规则 2/3/4/5 共用同一状态机语义，拆分引入词法漂移风险）。
- **Phase 5**：T008 / T009 / T010 / T011 分属不同断言块（部分同文件不同区段），可并行编写；但转绿验证建议顺序跑 `npm run test:plugins` 避免边界调整互相覆盖。
- **Phase 6**：T012（源码 JSDoc）与 T013（contracts 文档）不同文件，可并行；T014 全量验证必须最后单独跑、内部 4 条命令严格按序。

### 推荐实施策略

**单线程串行执行**（本次不建议拆分给多人并行）：安全闸门的 5 条规则互相依赖同一状态机语义，且测试矩阵的红绿证据链要求严格顺序，拆分给多人会破坏「先红后绿」的验证价值。建议单一实现者按 Phase 1 → 6 顺序推进，每个 Phase Checkpoint 处停下确认后再进入下一 Phase。
