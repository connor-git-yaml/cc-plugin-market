# 修复规划（F231）— 改名跟随白名单闸门

> ⚠️ **本文件是历史制品，其技术方案已被后续轮次取代，不代表最终实现。保留仅为审计轨迹。**
>
> 本 plan 描述的是**「结构白名单」阶段**的方案（`blankHeredocBodies` heredoc 正文剥离 + `isSimpleRenameSequence` 五条子语言规则）。该方案在第 5 轮被 Codex 终审判「不宜合入」并作废——根因是"判断整条命令是不是简单命令序列"等于手写半个 bash 解析器，每个缺口都是新的误放行。
>
> **最终实现**见 `fix-report.md`「修复策略（最终采纳）」节：整条命令必须就是一条**光杆改名**（无回溯 token 化校验 + 严格 option 白名单 + 路径合法性 + 注入式磁盘嵌套否证探针）。`blankHeredocBodies` / `isSimpleRenameSequence` 及其常量**已从源码删除**。
>
> 下文中凡提及这两个函数、heredoc 等长空白剥离、锚定正则者，均为已作废内容。

## Summary

- **问题**：`scanRenameCommandEvents` 只判语法命令位、不判执行可达性，藏在不会执行的控制流分支（短路 RHS / 死 if / 未命中 case / 命令替换 / 零迭代循环 / 函数体 / 前缀内建 / heredoc 正文 / 语法错误脚本）里的 `mv` 文本仍被采信为真实改名事件，把候选跟随到非规范名（`ambiguous=true`），打开 F224 fail-open 降级通道（1 条命令即可绕过阻断型门禁）。
- **修法（锁定）**：在 `scanRenameCommandEvents` 产出事件**之前**前置一道**简单命令白名单闸门**。不变量：**产出改名事件 ⟺ 整条命令（`unfoldLineContinuations` 后、heredoc 正文剥离后）是「简单改名序列」子语言成员**；否则返回 `[]`。白名单「未知即拒绝」，soundness 不依赖穷举坏形态。
- **收窄方向**：只收窄（更严）事件产出。`resolveFeatureDirCandidate` / `judgeCompliance` 返回形状、offset 归段、`scanArtifactPath` 提名侧、`parseRenameOperands` / `applyRenameEvent` 逐字不动。对「简单改名序列」内的输入，事件集合与改动前逐字相同。
- **唯一被更新的冻结用例**：`fix-compliance-core.test.mjs` 的 C4（`cd . && mv …` 含 `&&` → 白名单拒绝 → 候选停在 `specs/900-fix-x`、`ambiguous:false`）。

## Technical Context

- 语言/运行时：纯 `.mjs` + JSDoc，Node 20（`node --test` 经 `npm run test:plugins`）；上层还有 vitest（`npx vitest run`）与 `npm run build` 类型检查。
- 目标模块：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（单文件，纯函数为主）。
- 无新增依赖、无类型定义文件（JSDoc 内联）、不改对外契约（返回形状逐字不变）。
- `NEEDS CLARIFICATION`：无（设计已三次拍板 + Codex 定稿）。

## Codebase Reality Check

| 目标文件 | LOC | 关键消费链 | 已知 debt |
|---|---|---|---|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | ~1000+（本次只改 D1 区约 L444-524 与新增 helper） | `scanRenameCommandEvents`（L466）唯一消费方 = `resolveFeatureDirCandidate`（L607，L677 调用）；后者被 io 层 `judgeCompliance` 链路消费，最终由 `fix-compliance-judge-cli.mjs` 落 exit code | 无阻断性 debt；D1 区已是 F224/F225/F227/F230 多轮硬化的高密度合约区，**盲改风险高**，改动须严格局部化 |

被改动的既有函数（均已完整阅读，改动前后行为对「简单改名序列」逐字一致）：

- `scanRenameCommandEvents`（L466-524）：单趟线性扫描状态机（单/双引号、`\` 转义、`#` 注释、重定向 `>&`/`<&`/`&>`/`>|`/`<|`、控制操作符 `;`/`|`/`&`/换行、`RENAME_PARAM_MAX_LENGTH` 整条作废、`quote!==null → []`）。**本次唯一改动**：函数开头前置白名单闸门；闸门内先做 heredoc 正文剥离，再判子语言成员性，非成员 `return []`；成员则维持既有逐字扫描逻辑。
- `splitCommandTextSegmentSpans`（L534-547）：与 `scanRenameCommandEvents` 同源经 `unfoldLineContinuations`，给出每段跨度供 offset 归段。**不改**。
- `resolveFeatureDirCandidate`（L607-691）：offset 单指针归并（L677-686）。**不改**。

### 前置清理规则评估

- 目标文件 LOC 虽 >500，但本次**新增 < 50 行**（一个白名单谓词 + 一个 heredoc 剥离 helper），不触发「LOC>500 且新增>50 行」的强制前置 cleanup。
- 无与本次相关的 >3 个 TODO/FIXME；无 >30 行重复逻辑。
- **结论：无 `[CLEANUP]` 前置任务**。

## Impact Assessment

| 维度 | 评估 |
|---|---|
| 直接修改文件 | 1（`fix-compliance-core.mjs`）+ 2 测试文件（`fix-compliance-core.test.mjs`、`fix-compliance-judge-cli.test.mjs`） |
| 间接受影响 | `resolveFeatureDirCandidate`（唯一消费方，行为随事件集合收窄而更严，无接口改动）→ io 层 `judgeCompliance` → `fix-compliance-judge-cli.mjs`（exit code）；均无签名/形状改动 |
| 跨包影响 | 0（全在 `plugins/spec-driver/scripts/`） |
| 数据迁移 | 无（不改 schema / 配置 / 状态文件格式 / fixture 落盘格式） |
| API/契约变更 | 无（`scanRenameCommandEvents` / `resolveFeatureDirCandidate` / `judgeCompliance` 返回形状逐字不变；仅事件产出集合收窄） |
| 风险等级 | **MEDIUM** |

**风险等级判定**：影响文件 < 10、无跨包影响、无数据迁移、不改公共契约形状 → 本应 LOW；但目标是**安全门禁**（阻断型 gate，误收窄会误伤合法收口 = 误阻断，误放宽会重开绕过面），且改动落在多轮对抗审查高密度合约区，故上调为 **MEDIUM**。未触发 HIGH（无强制分阶段），但测试矩阵作为核心安全资产必须完备。

## Constitution Check

> `.specify/memory/constitution.md` 未在本 worktree 定位到；改以仓库级 `AGENTS.md` / `CLAUDE.md` 行为约定作评估锚点（标注风险：未跑正式 constitution gate）。

| 原则 | 适用 | 评估 | 说明 |
|---|---|---|---|
| source-of-truth 盲改风险 | 是 | PASS | 改动前已完整阅读 D1 区全部相关函数；改动严格局部化于闸门前置 |
| 不超出问题范围 | 是 | PASS | 只收窄事件产出，不新增功能、不改提名侧、不改 judge 降级下界 |
| 简洁之道 / 白名单默认拒绝 | 是 | PASS | 一个纯谓词 + 一个 helper；不引入注册表/策略接口/前缀白名单（fix-report 明确「刻意不做前缀白名单」） |
| 测试同提交 | 是 | PASS | 测试矩阵与实现同一提交；TDD 先红后绿 |
| 类型系统第一防线 | 是 | N/A | 纯 `.mjs`，以 JSDoc + 单测覆盖不变量 |

**无 VIOLATION**。

## 1. 精确文件改动清单

### 1.1 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`

**新增导出纯函数 · 白名单闸门**（建议名 `isSimpleRenameSequence(command) → boolean`）：
- 输入：`unfoldLineContinuations` 后、`blankHeredocBodies` 剥离后的命令文本。
- 语义：整条命令是「简单改名序列」子语言成员返回 `true`，否则 `false`。
- 实现须逐条落地 fix-report「子语言定义」5 条规则：
  1. **heredoc 正文已剥离**（由 helper 完成，见下）：定界词未闭合 → 视为不平衡 → `false`。
  2. **分隔符白名单**：只允许「简单命令」经 `;` / 换行 / `|` / `|&` / 单个 `&`（后台）连接；出现任何**未引用**的 `&&` / `||` → `false`。（`|&` 作为原子管道操作符纳入白名单。）
  3. **无分组 / 替换 / 子壳**：出现任何**未引用**的 `(` / `)` / `{` / `}` / `` $( `` / 反引号 / `<(` / `>(` / `$((` → `false`。
  4. **命令位不得是保留字 / 危险内建**：每个简单命令的**命令位** token（引用/转义/注释感知，沿用现有 `isWordStart` + `(?=$|[\s;)(&|<>])` 完整 token 边界口径）命中以下集合任一 → `false`：
     - 保留字：`if then elif else fi while until for select do done case esac function time coproc ! [[ [`
     - 流程控制 / 注入内建：`exit return exec eval source . alias shopt set trap logout break continue`
  5. **词法平衡**：扫描结束引号必须闭合（`quote!==null → false`）、heredoc 必须闭合、游离 closer（`)`/`}` 使深度 underflow）→ `false`。
- **实现取向**：规则 2/3/5 的字符级判定与规则 4 的命令位 token 识别应与 `scanRenameCommandEvents` **共用同一趟单引号/双引号/转义/注释/重定向状态机**语义（可在同一扫描内顺带做闸门判定，也可拆为独立扫描，二者取一，避免出现与既有状态机语义漂移的第二套词法）。规则 4 的命令位判定必须复用现有 `isWordStart`（L480 内联，扩展边界字符集需与 fix-report 规则 4 一致），确保 `mv-f` 类边界与 F230 的 `(?=$|[ \t])` 口径不冲突。

**新增 heredoc 正文等长空白剥离 helper**（建议名 `blankHeredocBodies(command) → string`）：
- 识别 heredoc 引入符 `<<[-]?\s*(WORD|'WORD'|"WORD"|\WORD)`，区分 herestring `<<<`（不触发正文剥离）；支持 `<<-` 前导 tab 剥离、同行多 heredoc、引用定界词禁展开语义（对本次剥离而言只需正确定位闭合行）。
- 把「引入行之后 → 仅含定界词的闭合行」之间的正文**用等长空白替换**（保留字符偏移与换行结构），使事件 offset 仍对齐 `splitCommandTextSegmentSpans` 的原命令跨度。
- 定界词未闭合 → 返回原串并由闸门规则 1/5 判为不平衡 `false`（或直接由 helper 标记不平衡，二选一，须与闸门契合）。
- **关键不变量**：输出与输入**等长、换行位置不变**（Codex I-ST1：新增状态不改字符索引即无归段回归）。

**`scanRenameCommandEvents` 开头前置闸门**：
```
export function scanRenameCommandEvents(command) {
  const raw = unfoldLineContinuations(String(command));
  const text = blankHeredocBodies(raw);       // 等长空白剥离，保 offset
  if (!isSimpleRenameSequence(text)) return []; // 白名单闸门：非成员零事件
  // …… F230 既有逐字扫描逻辑（对 text 扫描，events offset 仍对齐原命令跨度）……
}
```
- **保留 F230 既有全部判据**：未闭合引号 → `[]`、`#` 注释、重定向 `>&`/`<&`/`&>`/`>|`/`<|` 的 `&`/`|` 不开命令位、参数由同一状态机收集、`RENAME_PARAM_MAX_LENGTH` 整条作废、offset 归段。闸门**只在其前串接**，不改既有分支。
- **offset 对齐**：既有扫描须作用在 `blankHeredocBodies` 后的 `text` 上（而非 `raw`），因为 `resolveFeatureDirCandidate` 的 `splitCommandTextSegmentSpans` 走 `unfoldLineContinuations(command)`（未剥离 heredoc）——两者字符索引因「等长空白替换」保持一致，故 offset 归段不受影响。**实现时须确认这一点**：heredoc 正文被空白化后，正文里的 mv 不再匹配（关闭 C-S4），而正文外的 mv offset 与 `raw` 完全一致。

**JSDoc 更新**：`scanRenameCommandEvents` 补白名单子语言定义与不变量（「产出改名事件 ⟺ 整条命令是简单改名序列子语言成员」+ soundness 一句话），新 helper/谓词各附职责 JSDoc。

### 1.2 不改动清单（逐字保留，写入 plan 作为回归护栏）

- `resolveFeatureDirCandidate`（含 `scanArtifactPath` 提名侧、`applyRenameEvent`、`syncCandidateFromTrackedDir`、candidateHistory）、`splitCommandTextSegmentSpans`、`parseRenameOperands`、`hasBashWriteIndicator`、`judgeCompliance` 返回形状。
- judge 层降级下界（F230 第 2 层 `hasClosureDelegation`）——与本次正交，不改。

## 2. 回归风险评估

| 风险点 | 缓解 |
|---|---|
| 返回形状漂移 | `resolveFeatureDirCandidate` / `judgeCompliance` 返回对象逐字不变；闸门只让 `scanRenameCommandEvents` 在非成员时早退 `[]`（其返回类型 `{offset,paramText}[]` 不变） |
| offset 与 span 跨度错位 | heredoc 用**等长空白**替换正文（保换行）；专门 characterization 用例断言 heredoc 后 mv 的 offset 与归段结果（见测试矩阵 §3.1-E） |
| 误伤合法多跳 / 分隔符形态 | 正向 characterization 覆盖 `mv`/`git mv`/`mv -f`/heredoc 后 mv/`|` 两跳/`&` 两跳/`;` 链/`|&` 分隔/`# 注释`（见 §3.1-B/-D）|
| 提名侧被误动 | `scanArtifactPath` 逐字不动；C7（L2015）等提名用例保留；heredoc 剥离**只作用于改名扫描输入**，`resolveFeatureDirCandidate` 内提名走的仍是 `splitCommandTextSegmentSpans(input.command)`（未剥离），提名行为与改动前一致 |
| F224 SC-005 被翻掉 | SC-005 用**单条裸 `git mv FEATURE_DIR specs/renamed-nonstandard`**——白名单合法成员 → 照常产出事件 → 候选跟随非规范名 → `ambiguous` → fail-open exit 0；**必须保留**（见 §3.2）|
| 冻结面回归 | 全部 F230 直测（L2026-2097）喂「简单 mv 命令」或「引号/注释/非 mv」，白名单不改其结论；唯一更新 C4 |

## 3. 测试矩阵（核心安全资产 · 逐条断言）

### 3.1 `fix-compliance-core.test.mjs`

复用既有 helper：`resolveWithCandidate(command)`（首写 `specs/900-fix-x/fix-report.md` + 一条 Bash）、`scanRenameCommandEvents` 直测、`params(command)`。

**A. 11 类 Codex 反例（反向：`scanRenameCommandEvents(cmd)` 返回 `[]`，且 `resolveWith(cmd).path==='specs/900-fix-x'` && `ambiguous===false`）**
以 `S=specs/900-fix-x`、`D=specs/renamed-nonstandard` 构造，逐条对照 fix-report「逐 Codex-发现闭合对照」表：

| 用例 | 命令 | 关闭规则 |
|---|---|---|
| C-S1 短路续行 | `true \|\|\nmv S D` | 规则 2（`\|\|`）|
| C-S2 `\|&` + 短路 | `true \|\| false \|& mv S D` | 规则 2（含 `\|\|`）|
| C-S3 exit 前置 | `exit 0; mv S D` | 规则 4（`exit`）|
| C-S4 heredoc 正文 | `cat <<EOF\nmv S D\nEOF` | 规则 1（正文空白化）|
| C-ST1 case done) | `case x in done) mv S D ;; esac` | 规则 4（`case`）|
| C-ST2 `}` 参数位 | `f() { echo }\nmv S D\n}` | 规则 3（`(`/`{`/`}`）|
| C-ST3 heredoc 伪 fi | `if false; then cat <<EOF\nfi\nEOF\nmv S D\nfi` | 规则 4（`if`）+ 规则 1 |
| C-ST4 游离 closer / 未闭合关键字 | `) ; mv S D`（及 `mv S D; if`）| 规则 5 underflow / 规则 4（`if`）|
| C-D1 前缀 time/!/coproc | `time if false; then mv S D; fi` | 规则 4（`time`/`if`）|
| C-D2 `for((` / `if<` | `for((i=0;i<0;i++)); do mv S D; done`（及 `if</dev/null false; then mv S D; fi`）| 规则 3（`(`）/ 规则 4（`if`）|
| C-D3 alias | `shopt -s expand_aliases; alias g="if false; then"; g :; mv S D; fi` | 规则 4（`shopt`/`alias`）|

每条断言两项：`assert.deepEqual(scanRenameCommandEvents(cmd), [])` 与 `assert.equal(resolveWith(cmd).path, 'specs/900-fix-x')` + `assert.equal(resolveWith(cmd).ambiguous, false)`。**实现须以真实 GNU Bash 双证**（在 plan 阶段不跑，实施 TDD 时逐条经 bash 验其确不执行 mv）。

**B. 6 类原始构造反向回归**（fix-report 问题描述表 6 类：短路 RHS / 函数体 / 死 if / 未命中 case / 命令替换 / 零迭代循环）——同样断言 `scanRenameCommandEvents(cmd)===[]` 且候选不 `ambiguous`：
- `true \|\| mv S D`
- `f() {\nmv S D\n}; :`
- `if false; then\nmv S D\nfi`
- `case x in y)\nmv S D\n;; esac`
- `: $(false && mv S D)`
- `while false; do\nmv S D\ndone`

**C. 更新 C4（约 L1978）**——`cd . && mv specs/900-fix-x specs/901-fix-y` 含 `&&` → 白名单拒绝：
- 断言改为 `assert.deepEqual(cand, {path:'specs/900-fix-x', ambiguous:false})`（即 `path==='specs/900-fix-x'` && `ambiguous===false`），并把描述改为「`&&` 条件右侧改名不跟随（F231）」+ 追加理由注释：白名单拒绝 `&&`/`||`，方向保守（误阻断而非误放行），真实 `prep && mv` 链式改名须拆成独立 `git mv` 才跟随。

**D. 简单序列正向 characterization**（断言照常产出事件与跟随，防过度收窄）：
- `mv specs/900-fix-x specs/901-fix-y` → `path==='specs/901-fix-y'`
- `git mv specs/900-fix-x specs/901-fix-y` → `901-fix-y`
- `mv -f specs/900-fix-x specs/901-fix-y` → `901-fix-y`（保 C3，L1972）
- heredoc 后 mv：`cat > specs/900-fix-x/fix-report.md <<EOF\nbody\nEOF\nmv specs/900-fix-x specs/901-fix-y` → `901-fix-y`（保 C5，L1984；剥离后 `cat`+`mv` 均简单命令）
- `mv A B \| mv B C`：`mv specs/900-fix-x specs/901-fix-y | mv specs/901-fix-y specs/902-fix-z` → `902-fix-z`（保 C6b，L2003）
- `mv A B & mv B C`：单 `&` 后台两跳 → `902-fix-z`（保 C6c，L2009）
- `mv A B; mv B C` 分号链 → `902-fix-z`（保 C6，L1994）
- `|&` 分隔两跳：`mv specs/900-fix-x specs/901-fix-y \|& mv specs/901-fix-y specs/902-fix-z` → `902-fix-z`（新正向：`|&` 原子纳入白名单）
- `mv specs/900-fix-x specs/901-fix-y # 迁移` → `901-fix-y`（注释剥离后跟随，保 L2139）

**E. heredoc 剥离与 offset 对齐专门 characterization**（回归风险 §2 直接护栏）：
- 断言 heredoc 正文里的 mv 不产出事件：`scanRenameCommandEvents('cat <<EOF\nmv a b\nEOF')` → `[]`。
- 断言正文**外**的 mv offset 与未含 heredoc 时一致：对 `cat <<EOF\nx\nEOF\nmv S D`，产出事件的 `offset` 指向剥离后 `text` 中 `mv` 的真实位置，且经 `resolveFeatureDirCandidate` 归段后正确跟随（复用 C5 形态断言最终 `path`，并新增一条直接断言 `scanRenameCommandEvents(cmd)[0].offset` 落在正确字符位）。
- 断言等长不变量：`blankHeredocBodies(cmd).length === unfoldLineContinuations(cmd).length` 且换行数不变（若 helper 导出则直测；否则经 offset 一致性间接断言）。
- 未闭合定界词：`cat <<EOF\nmv S D`（无闭合 `EOF`）→ `scanRenameCommandEvents===[]`（规则 1/5 不平衡）。

**F. 全部 F230 直测（L2026-2097）逐条保留不变**——喂「简单 mv 命令」（白名单照常产出）或「引号/注释/非 mv」（前后皆 `[]`），断言不变。

**G. 真实会话 `67720241`**（其 mv 在单引号 heredoc 数据内）——若既有测试引用则保持 `compliant:true`；剥离后更稳（正文空白化不影响其单引号数据外的判定）。

### 3.2 `fix-compliance-judge-cli.test.mjs`

**H. 端到端反向回归（≥ 2-3 条，伪造改名 transcript → 硬阻断，不落降级诊断）**
构造复用 `writeTranscript` + `TOOL_USE`；关键：改名文本藏在控制流里 + **坍塌形态**（零委派或制品缺失），断言 `exit 2` 且 `transcriptDiagnostics` 不含 `feature-dir-unresolvable`：
- H1 短路 RHS 伪造 + 零委派：`Write specs/NNN-fix-x/fix-report.md` + `Bash: true || git mv specs/NNN-fix-x specs/renamed-nonstandard`，磁盘不建目录 → `runCli().status===2`；report 模式 `compliant===false`、`transcriptDiagnostics===[]`、`missing` 含 `fix-report.md`（改名未跟随 → 候选停在标准名 → 走制品缺失/委派缺失判据，非 `feature-dir-unresolvable`）。
- H2 死 if 伪造 + 零委派：`Bash: if false; then git mv specs/NNN-fix-x specs/renamed-nonstandard; fi` → 同 H1 断言。
- H3 命令替换伪造：`Bash: : $(false && mv specs/NNN-fix-x specs/renamed-nonstandard)` → 同 H1 断言。
- 断言要点：与 HEAD 对比，HEAD 上这些构造会 `ambiguous → feature-dir-unresolvable → exit 0` 放行；修复后必须 `exit 2` 且 `transcriptDiagnostics===[]`。

**I. 保住 F224 SC-005 放行（L798-832）不变**——单条裸 `git mv FEATURE_DIR specs/renamed-nonstandard`（白名单合法成员）+ implement+verify 委派 → `exit 0` 静默放行、落盘 `compliant:null` + `degraded:true` + `diagnostics` 含 `feature-dir-unresolvable`。**断言逐字不动**（验证白名单未误伤真实单条 git mv）。

**J. 保住 SC-005b（L834-902）不变**——零委派 + 单条非规范 `git mv` → `exit 2`（收窄口径不受本次影响）；Codex 构造 A（`sed -i …; mv …`，分号链两简单命令、命令位非保留字 → 白名单合法 → 改名照常扫出 → 但零委派 → exit 2）保持 `exit 2`。

### 3.3 断言原则

- 每条 case 独立、无共享可变状态（沿用现有 `resolveWith`/`writeTranscript` 每次新建）。
- 反向回归**必须双断言**：既断言 `scanRenameCommandEvents` 层 `[]`，又断言 `resolveFeatureDirCandidate` 层候选不 `ambiguous`（防止将来某层单独回归）。

## 4. 验证命令序列

按序全绿（任一失败即停并修）：
1. `npm run test:plugins`（`node --test`，覆盖 `fix-compliance-core.test.mjs` / `fix-compliance-judge-cli.test.mjs` 新增矩阵 + 全部冻结回归）
2. `npx vitest run`（仓库级单测零失败）
3. `npm run build`（类型检查零错误）
4. `npm run repo:check`（source-of-truth / 包装层同步链路）
- 专项：heredoc 剥离与 offset 对齐 characterization（§3.1-E）必须在 `test:plugins` 中作为独立命名用例存在并绿。
- 实施期额外：11 类 Codex 反例逐条经真实 GNU Bash + 同名 `mv` shim 实跑，证明其确不执行 `mv`（双证，不入自动化门禁，作为实现期人工核验）。

## 5. 实施顺序建议（TDD）

1. **先写反向回归（红）**：在 `fix-compliance-core.test.mjs` 加 §3.1-A（11 类）+ §3.1-B（6 类）；在 `fix-compliance-judge-cli.test.mjs` 加 §3.2-H（H1/H2/H3）。此时 HEAD 源码上这些用例**应为红**（伪造改名被采信 → 事件非空 / `ambiguous` / exit 0），确认测试真的在抓这个洞。
2. **实现 heredoc 剥离 helper** `blankHeredocBodies`：先让 §3.1-E 的等长/未闭合/正文空白化用例（可先写）通过。
3. **实现白名单闸门** `isSimpleRenameSequence` 并前置到 `scanRenameCommandEvents`：逐条转绿 §3.1-A/-B 与 §3.2-H。
4. **更新 C4**（§3.1-C）：改断言 + 加 F231 理由注释，转绿。
5. **补正向 characterization（防过度收窄）**：§3.1-D/-E/-F + §3.2-I/-J，确认简单序列与 SC-005 放行全部保留；若任一正向用例被误收窄（红），回到规则 2/3/4 边界字符集核对（尤其 `|&` 原子性、单 `&` vs `&&`、命令位 token 边界与 `mv-f` 不冲突）。
6. **JSDoc 与文档核对**：补 `scanRenameCommandEvents` 白名单不变量 JSDoc；核对 `contracts/fix-compliance-judge-cli.md` 场景表是否需补「非简单命令序列内的伪造改名不触发降级」一行。
7. **全量验证**：跑 §4 全序列零失败。

## Complexity Tracking

| 决策 | 简单替代 | 为何偏离 |
|---|---|---|
| 白名单（默认拒绝）而非黑名单（抑制坏形态）| 直接在 `scanRenameCommandEvents` 内抑制嵌套/条件位 mv | Codex 用 11 条真实 bash 反例证明黑名单洞太多，且 exit/alias/heredoc 是静态无法枚举的根本洞（fix-report「Codex 对抗审查」节）；白名单 soundness 不依赖穷举 |
| heredoc 等长空白剥离而非删除 | 直接删除 heredoc 正文 | 删除会改字符索引 → offset 归段与 `splitCommandTextSegmentSpans` 跨度错位；等长替换保 offset（Codex I-ST1）|
| 刻意不做前缀白名单（`time mv`/`FOO=bar mv` 等一律不跟随）| 在白名单里再开前缀白名单 | fix-report 已知限界 1：白名单里再开白名单即新可构造面；方向保守（误阻断而非误放行），缓解=改名单独用一条 `git mv` |

## 已知限界（承接 fix-report，不表述为已解决）

1. 合法但非简单形态的改名不被跟随（`X && mv` / `( mv )` / `{ mv; }` / `time mv` / `FOO=bar mv` / 带重定向多操作数等）→ 可能误阻断一次合法收口；方向保守，缓解=单条 `git mv`。
2. 真实执行的 mv 仍可打开降级通道（F224 设计意图，SC-005 保留）。
3. 极冷门**预置环境 alias**（命令文本不出现 `shopt`/`alias`/保留字）静态无法识别 → 误放行方向的根本残留，独立跟进候选，本次不佯装闭合。
4. F227 已知限界一（冒用历史特性目录）与本次正交，不在范围。
5. 裸管道/后台两跳并发语义（Codex C-R1）属既有冻结 characterization，不改。
