# Verification Report: F228 fix 依从性占位符误判（代码区花括号）

**特性分支**: `claude/admiring-blackburn-b42375`
**验证日期**: 2026-07-23（本次为**第 3/4/5 轮改动后的刷新版**，覆盖 Phase 4a/4b 合同修订 + 第二轮 Codex 对抗审查修复 + 文档滞后即时修复）
**验证范围**: Layer 1（Spec-Code 对齐）+ Layer 1.5（验证铁律合规）+ Layer 1.9（文档一致性）+ Layer 2（原生工具链）+ 用户验收口径逐条核对

> 本报告替换早前基于第 2 轮改动写就的旧版本。第 2 轮之后又发生三轮改动：
> **第 3 轮**——Phase 4a/4b 审查发现 `no-op-report-template.md` / `data-model.md` 两处合同描述与代码判据方向不符，已修（当时代码为三段判据，文档同步改写为三段）；
> **第 4 轮**——第二轮 Codex 对抗审查发现 3 处可被主动改写触发的绕过（中文占位符塞 ASCII 冒号 / 纯 ASCII 模板字段 / 转义反引号），经 A/B 基线确认均为本次改动引入的真实回归，已用新增的**第 4 段结构性判据**堵上，并统一了 `stripReconSubblock` 与 `stripCodeRegions` 的围栏语义——但两处合同文档当时未同步第 4 段，本报告上一版据此报了 1 项 DOC_DRIFT；
> **第 5 轮**——协调方在收到上一版报告后**当场修复**了该 DOC_DRIFT，把两处文档从"三段判据"改写为"四段判据"并补上第 4 段描述。本版报告已逐字复核该修复与代码的一致性（见下方 Layer 1.9），确认**已修复**，不再是待跟进项。

## Layer 1: Spec-Code 对齐（T1-T10 任务级）

| 任务 | 描述 | 状态 | 依据 |
|------|------|------|------|
| T1 | 实现 `stripInlineCodeSpans(line)` | ✅ 已实现（第 4 轮追加转义反引号识别） | `node --test` 中 `stripCodeRegions` 单测 + R3-2 转义反引号系列 3 例全绿 |
| T2 | 实现并导出 `stripCodeRegions(text)` | ✅ 已实现（第 4 轮改用单一扫描器 `computeFenceRegions`） | `grep -n "stripCodeRegions"` 命中导出与调用点；`computeFenceRegions` 单测 2 例通过 |
| T3 | 改造 `checkArtifactSection`：拆分长度判据与占位符判据输入源 | ✅ 已实现（第 4 轮追加第 4 段结构性判据） | `git diff --numstat` 显示 `fix-compliance-core.mjs` 累计 +158/-5；源码第 732-735 行确认现网为四段 OR |
| T4 | `stripCodeRegions` 单元测试（8 例） | ✅ 已实现 | `node --test` 输出全部 `✔` |
| T5 | `checkArtifactSection` 集成测试（R1/A/B/C/D/E + 2 边界） | ✅ 已实现 | `node --test` 输出对应用例全部 `✔` |
| T6 | `MIN_SECTION_BODY_CHARS` / 代码剥离交互专项断言 | ✅ 已实现 | `node --test` 输出 2 例全部 `✔` |
| T7 | 复现脚本 R1/A/B 从 FAIL 转 ok | ✅ 已实现 | 见下方「必须真实执行」第 6 项（`repro-f228-r3-adapted.mjs`） |
| T8 | 全量验证（vitest 全量 / build / repo:check） | ✅ 已实现（本轮零失败，无 flaky） | 见下方 Layer 2 详情 |
| T9（第 3 轮追加，第 5 轮完成） | 同步 `no-op-report-template.md` / `data-model.md` 判据描述与代码实现一致 | ✅ **已实现** | 第 3 轮先改写为三段判据描述（当时代码亦为三段）；第 4 轮代码追加第 4 段后文档一度滞后（本报告上一版据此报 DOC_DRIFT）；**第 5 轮已同步补齐第 4 段**，本轮逐字复核确认两处文档与现网代码四段 OR/AND 语义完全一致，见下方 Layer 1.9 |
| T10（第 4 轮追加） | 新增第 4 段结构性判据 + `stripInlineCodeSpans` 转义反引号识别 + `stripReconSubblock`/`stripCodeRegions` 围栏语义统一 | ✅ 已实现 | `node --test` 中 `F228 R3 · Codex 第二轮对抗审查修复反向断言` describe 块 9 例全绿；`probe-round3.mjs` 3 项回归全转 `ok` |

### 覆盖率摘要

- **总任务数**: 10（T1-T8 原有 + T9/T10 本轮新纳入）
- **已实现**: 10
- **部分实现**: 0
- **未实现**: 0
- **覆盖率**: 100%（10/10）

## Layer 1.5: 验证铁律合规

**状态**: COMPLIANT

- 本轮验证由验证闭环子代理**直接执行**全部命令（非转述 implement/fix 子代理的声称），每条命令均记录真实退出码 / stdout 摘要，见下方「必须真实执行」章节的原始输出。
- 未检测到推测性表述（未见"should pass"/"looks correct"等）。
- 缺失验证类型：无。构建、测试（`test:plugins` + `node --test` + `npx vitest run`）、Lint（本次改动为 `.mjs`/`.md`，无独立 lint 命令，由 `npm run build` 的 tsc 类型检查与 `repo:check` 兜底）均已覆盖。

## 必须真实执行并记录真实输出的验证命令

### 1. `npm run test:plugins`

第 5 轮修复后重跑：

```
ℹ tests 715
ℹ suites 141
ℹ pass 715
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2175.649625
```

**结果**: ✅ PASS（715/715，零失败）——文档改动（`.md`）不影响 `.mjs` 测试执行路径，用例数与第 4 轮改动后一致，零失败。

### 2. `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`

```
ℹ tests 282
ℹ suites 57
ℹ pass 282
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 70.380791
```

**结果**: ✅ PASS（282/282，零失败）。较第 2 轮报告的 273 例增长 9 例，新增 describe 块 `F228 R3 · Codex 第二轮对抗审查修复反向断言`（9 子用例）与 `computeFenceRegions 单测`（2 例，含在其中）全部 `✔`，覆盖：
- R3-1a：中文占位符塞 ASCII 冒号再包 code span → 仍判 `residue=true`
- R3-1b：纯 ASCII 模板字段包 code span → 仍判 `residue=true`
- R3-2：转义反引号包裹模板字段 → 仍判 `residue=true`（另有 `stripCodeRegions` 对转义反引号恒等保留、对照组"偶数反斜杠+真实定界符正常剥离" 2 例专项断言）
- R3-3：`### 复现对账` 子块内含未闭合围栏、其后有真实 H2 与占位符 → 仍判 `residue=true`（子块正确终止，不再吞掉后续正文）
- R3 回归保护：3 个既有合法用例（行内 code span 对象字面量+长散文 / fenced JSON+真实散文 / 散文空洞但 fenced code 无花括号撑长度）仍判 `false`，未被第 4 段判据误伤

存量行为钉住区块（3 例，非本次回归，characterization 测试）与 R2（第一轮 Codex 对抗审查修复反向断言，6 例）均保持全绿。

### 3. `npx vitest run`

```
Test Files  483 passed | 4 skipped (487)
     Tests  5769 passed | 18 skipped | 21 todo (5808)
   Duration  50.84s
```

**结果**: ✅ PASS（本轮零失败，包括第 2 轮报告中标注为满载 flaky 的 `tests/integration/graph-quality-adversarial.test.ts` 本轮全量跑也一次性通过，未复现）。第 5 轮为纯 `.md` 文档改动，不影响该套测试范围，沿用第 4 轮跑批结果，未重跑（文档改动无 `.ts`/`.mjs` 代码路径变更）。

### 4. `npm run build`

```
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> tsc
[postbuild:stamp] 盖章: commit=18d3706e (dirty)
```

**结果**: ✅ PASS（tsc 类型检查零错误，构建流程完整跑通含 prebuild/postbuild 钩子）。第 5 轮为纯 `.md` 改动，不影响 tsc 编译面，沿用第 4 轮结果。

### 5. `npm run repo:check`

第 5 轮修复后重跑：

```
[repo-check] status=warn
（80 项 pass，1 项 warn）
warnings:
  - [graph-quality] 图产物记录的 sourceCommit（23ffc8f7...）与当前 HEAD（18d3706e...）不一致（commit 级 stale），请重新建图。
```

**结果**: ✅ PASS（仅 1 处 `graph-quality:freshness` warn，属既有状态——图产物未随本次代码改动重建，与本次改动的合规逻辑或文档改动均无关，任务书要求"不视为回归"）。其余全部 80 项检查（含 `spec-drift:anchors-status`）均 pass，无 fail。**第 5 轮的文档改动未引入任何新的 repo:check 项**。

### 6. 复现脚本 `repro-f228-r3-adapted.mjs`（替代已失效的 `repro-f228.mjs`）

**关于替代原因（如实说明）**：原 `repro-f228.mjs` 的 R0/R1 用例依赖读取姊妹 worktree（`codex-plugin-distribution-2940d3`）的 `specs/227-fix-compliance-candidate-disk-filter/fix-report.md`，对其中 `path=null/ambiguous=true` 这一具体字面串做反事实还原（改回 `{path: null, ambiguous: true}`）再跑判据。该姊妹 worktree 的文件已被其自身后续并行会话改写，不再含目标字面串，导致 R0/R1 的前置断言直接抛错、无法运行——用改动前的 `core-before.mjs`（第 3/4 轮改动前的代码快照）重跑同一读盘逻辑同样报错，**证明这是外部 fixture 漂移，与本次 F228 改动无关**。`repro-f228-r3-adapted.mjs` 用与 `fix-compliance-core.test.mjs` 中"R1（用户硬性验收①）：还原 F227 报告写法"逐字等价的内联构造替代读盘的 R0/R1，其余 A-E 用例与原脚本逐字一致，并追加第 4 轮新增的 F 用例（转义反引号绕过）。

```
  ok   R1（内联等价构造，替代读盘 R0/R1）：Root Cause Chain 正文含行内 code span 花括号描述返回值形状      expect=false actual=false
  ok   A. 行内 code span 含花括号（锚点之后的散文里）      expect=false actual=false
  ok   B. fenced code 块含花括号（同源第二形态）          expect=false actual=false
  ok   C. 散文裸花括号（真实未替换占位符，必须仍判 residue） expect=true actual=true
  ok   D. 正文过短（MIN_SECTION_BODY_CHARS，必须仍判 residue） expect=true actual=true
  ok   E. 散文空洞但 fenced code 撑长度（既有行为：不判 residue）expect=false actual=false
  ok   F（R3 新增）. codex 第二轮 CRITICAL：转义反引号包裹的纯 ASCII 模板字段（必须判 residue） expect=true actual=true

合计 7 例，不符预期 0 例
```

**结果**: ✅ PASS（7/7 全部符合预期，含第 4 轮新增用例 F）

### 7. `verify-codex-claims.mjs`（第一轮 Codex 对抗审查回归验证）

```
  ok    CRITICAL-1a 模板占位符包进行内 code span（repair 形态）  应判 residue=true  实际=true
  ok    CRITICAL-1b 模板占位符包进行内 code span（no-op 形态）   应判 residue=true  实际=true
  ok    CRITICAL-2 未闭合 fence 吞掉整段（含后续 H2）           应判 residue=true  实际=true
 GAP    FINDING-5 缺右花括号（存量绕过，非本次回归）           应判 residue=true  实际=false
 GAP    WARNING-3a 跨行 code span（存量误报，非本次回归）       应判 residue=false 实际=true
 GAP    WARNING-3b 缩进代码块（存量误报，非本次回归）          应判 residue=false 实际=true

合计 6 项，与"应然"不符 3 项
```

**结果**: ✅ 符合预期——CRITICAL-1a/1b/CRITICAL-2 三项第一轮 Codex 对抗审查发现的回归均已修复为 `ok`；FINDING-5 / WARNING-3a / WARNING-3b 三项为存量缺口，行为与修复前完全一致（详见 fix-report.md「已知残余」表），非本次引入。

### 8. `probe-round3.mjs`（第二轮 Codex 对抗审查回归验证）

```
用例                                             现网   加第4段
----------------------------------------------------------------------
codex-a  中文占位符含 ASCII 冒号 + code span           ok =true  ok =true
codex-b  纯 ASCII 模板字段 + code span              ok =true  ok =true
codex-c  转义反引号（Markdown 非 code span）           ok =true  ok =true
W1  中文解构真实代码（存量误报，非回归）                         BAD=true  BAD=true
keep-A  行内 code span 对象字面量 + 长散文               ok =false ok =false
keep-B  fenced JSON + 真实散文                     ok =false ok =false
keep-C  散文裸花括号 → 仍判 residue                    ok =true  ok =true
keep-E  散文空洞但 fenced code 无花括号撑长度              ok =false ok =false
----------------------------------------------------------------------
现网不符预期 1 项；加入第 4 段判据后不符预期 1 项
```

**结果**: ✅ 符合预期——脚本的"现网"列直接调用现网 `checkArtifactSection`（已含第 4 段判据），"加第 4 段"列是对同一输入的独立手工推演，两列结果逐条一致，交叉印证第 4 段判据在现网代码中的行为与设计意图相符。codex-a/b/c 三项第二轮 Codex 发现的回归均转 `ok`；`W1`（中文解构真实代码，如 `` const {结果} = f() ``）仍判 `BAD`（即 `residue=true`），这是 fix-report.md「已知残余」表第一条明确记录的**已知代价，非回归**——canonical 判据本身即以此为代价换取"堵住中文占位符绕过"，触发面窄（需真实代码在花括号内使用中文标识符）。

## 用户验收口径逐条核对

### 1. `npm run test:plugins` 零失败

**判定**: ✅ 达成
**证据**: 第 5 轮后重跑，命令输出 `ℹ pass 715` / `ℹ fail 0`。

### 2. 必填章节散文含行内 code span 花括号 → 不判 placeholderResidue

**判定**: ✅ 达成
**证据**: `node --test` 中 `R1（用户硬性验收①）` 及 `A` 均 `✔`；`repro-f228-r3-adapted.mjs` R1/A 两例 `actual=false` 与 `expect=false` 一致；`probe-round3.mjs` 中 `keep-A`/`keep-B` 两条含行内 code span 花括号的合法用例在第 4 段判据加入后仍判 `false`，未被误伤。

### 3. 散文裸花括号占位符 → 仍判 placeholderResidue

**判定**: ✅ 达成
**证据**: `node --test` 中 `C（用户硬性验收②，回归锁定）` 为 `✔`；`repro-f228-r3-adapted.mjs` C 例 `actual=true` 与 `expect=true` 一致；`verify-codex-claims.mjs` CRITICAL-1a/1b 与 `probe-round3.mjs` codex-a/b/c 进一步证明"把模板占位符包进代码区"（含转义反引号、纯 ASCII 字段、塞 ASCII 冒号三种改写变体）均仍判 `residue=true`。

### 4. `MIN_SECTION_BODY_CHARS` 判据未被放宽，且"剥离代码区后正文变短"的交互已在测试中固定预期

**判定**: ✅ 达成
**证据**: `node --test` 中「`MIN_SECTION_BODY_CHARS` 与代码剥离交互专项断言」2 例保持 `✔`；`D（回归锁定）` 亦保持 `✔`。源码第 724 行注释明确"长度判据：输入逐字不变（仍是 `proseBody`），`MIN_SECTION_BODY_CHARS` 不被放宽"，第 4 段新判据（第 735 行）是**追加**而非**修改**长度判据本身——它是"花括号存在于原文 && 剥离代码区后正文不足阈值"的**新增**独立 OR 分支，不改变 `bodyChars <= MIN_SECTION_BODY_CHARS` 这条既有判据的输入与阈值。`git diff --numstat` 显示 `fix-compliance-core.mjs` 累计 +158/-5，无对 `bodyChars` 计算路径的删改。

### 5. `fix-compliance-core.test.mjs` 的 F216 C1/C4 断言全部保留

**判定**: ✅ 达成
**证据**: `git diff --numstat HEAD -- plugins/spec-driver/tests/fix-compliance-core.test.mjs` 输出 `433 0`——433 行新增、**0 行删除**（`git diff | grep -c '^-[^-]'` 二次确认为 0），即本次三轮代码改动累计对该测试文件是纯追加，未触碰任何既有断言。`node --test` 全量输出 282/282 全部 pass，含所有 F216/F224/F225/F228 R2/F228 R3 历代回归用例。

### 6. 占位符检测未被削弱成"永不命中"

**判定**: ✅ 达成
**证据**: `verify-codex-claims.mjs`（第一轮 3 项修复）与 `probe-round3.mjs`（第二轮 3 项修复）合计 6 项 Codex 对抗审查发现的绕过路径均已堵上，`residue` 判定均为 `ok`。第 4 段结构性判据（"花括号存在 + 剥离代码区后实质散文不足阈值"）不依赖对花括号内容的任何猜测，覆盖了"整段正文被包进代码区"这一类改写变体的**结构性**特征，而非逐个枚举具体写法——检测范围收窄的对象仍仅限于"作者真实引用代码字面量且散文实质充分"这一具体、有限的形态，不构成整体失效。

## Layer 1.9: 文档一致性检查——DOC_DRIFT 已修复（第 5 轮）

**背景**：本报告上一版发现第 4 轮新增了第 4 段结构性判据（代码层面 `placeholderResidue` 现为四段 OR），但 `no-op-report-template.md` / `data-model.md`（第 3 轮修订）未在第 4 轮同步更新，仍描述"三段判据"，标记为 DOC_DRIFT。协调方在收到该报告后**第 5 轮当场修复**，本轮逐字复核修复内容与源码语义的一致性。

### 复核方法

直接读取源码 `checkArtifactSection` 现网实现（`fix-compliance-core.mjs` 第 732-735 行）与两处文档修订后的文本，逐段比对方向（`≤`/`>`、OR/AND、命中/不命中）：

```js
const placeholderResidue = bodyChars <= MIN_SECTION_BODY_CHARS
  || CANONICAL_PLACEHOLDER_REGEX.test(proseBody)
  || PLACEHOLDER_BRACE_REGEX.test(placeholderScanText)
  || (PLACEHOLDER_BRACE_REGEX.test(proseBody) && strippedChars <= MIN_SECTION_BODY_CHARS);
```

| 段 | 代码语义（true=占位空壳） | `data-model.md`（`placeholderResidue`，"或"连接，true 条件） | `no-op-report-template.md`（"非占位空壳"，"且"连接，false 条件） | 一致性 |
|----|------|------|------|--------|
| 1 | `bodyChars <= MIN_SECTION_BODY_CHARS` | "正文去空白 ≤ 20 字符" | "正文（去空白）长度 > 20 字符"（即第 1 段的逻辑否定） | ✅ 一致，`>`/`≤` 互为否定，方向正确 |
| 2 | `CANONICAL_PLACEHOLDER_REGEX.test(proseBody)`（未剥离代码区，即跨代码区一律命中） | "canonical 中文模板占位符…跨代码区一律命中" | "canonical…在正文原文上不命中——该判据跨代码区不豁免" | ✅ 一致，均正确反映"作用于 `proseBody` 原文、不剥代码区"这一关键细节 |
| 3 | `PLACEHOLDER_BRACE_REGEX.test(placeholderScanText)`（剥离**闭合**围栏+行内 code span 后的文本，未闭合围栏不剥、转义反引号不作定界符） | "通用花括号占位符仅在剥离闭合围栏与行内 code span 之后的文本上扫描命中（未闭合围栏不剥离，转义反引号不作 code span 定界符）" | "通用花括号…在剥离闭合围栏与行内 code span 之后的文本上不命中——未闭合围栏…不剥离，转义反引号…不作 code span 定界符" | ✅ 一致，两处均补全了"闭合"限定词与转义反引号细节，与源码注释第 700-707 行逐字对应 |
| 4 | `PLACEHOLDER_BRACE_REGEX.test(proseBody) && strippedChars <= MIN_SECTION_BODY_CHARS` | "正文原文含花括号、但剥离代码区后的实质散文（去空白）仍 ≤ 20 字符" | "若正文原文含花括号，则剥离代码区后的实质散文（去空白）须 > 20 字符" | ✅ 一致，`data-model.md` 用直接合取表述、`no-op-report-template.md` 用条件式表述，两者对 `AND` 子句的逻辑否定（De Morgan：`!(A && B) = !A || !B`，此处用条件式 `若 A 则 !B` 等价表达）正确 |

**复核结论**: 两处文档修订后的文本与现网代码的四段 OR（`data-model.md`）/ 其逻辑否定四段 AND（`no-op-report-template.md`）语义**逐段一致**，`≤`/`>` 方向、"命中"/"不命中"方向、"跨代码区不豁免" vs "剥离后豁免"的区分均准确，未发现新的不一致。

**标记**: ✅ **已修复**（原 DOC_DRIFT 状态更正）

### 处置状态

- `git diff HEAD -- specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md specs/208-fix-mode-process-compliance/data-model.md` 确认两文件在原第 3 轮改动基础上各自又发生 1 行改动（合计每文件仍是 `1 1`，因为是对同一行的再次编辑，而非新增行），标题与正文均已从"三段判据"改为"四段判据"并补齐第 4 段描述。
- `npm run test:plugins`（715/715）与 `npm run repo:check`（80 pass / 1 既有 warn）第 5 轮后重跑均零失败，纯文档改动未引入任何新问题。

## 前序审查结论汇总与处置状态

### Phase 4a Spec 合规审查（第 3 轮触发）

**结论**: PASS + 1 WARNING
**WARNING 内容**: `no-op-report-template.md`「机械判据锚点」表对"非占位空壳"的描述与代码实现（分层扫描）不符
**处置状态**: ✅ 已修复（第 3 轮初次改写为三段判据描述；第 4 轮代码追加第 4 段后文档一度滞后；**第 5 轮已补齐第 4 段，本轮复核确认与现网代码逐段一致**，见上方 Layer 1.9）

### Phase 4b 代码质量审查（第 3 轮触发）

**结论**: GOOD，0 CRITICAL / 2 WARNING / 2 INFO

| 编号 | 内容 | 处置状态 |
|------|------|---------|
| WARNING-1 | 同上合同文档问题 | ✅ 已修复（第 5 轮补齐第 4 段后确认与代码一致，见 Layer 1.9） |
| WARNING-2 | `fix-compliance-core.mjs` 跨 F225/F224/F228 三个 feature 连续增长（621→758→870 行） | ⏭️ 本次不处理，记为后续拆分候选（用户明确要求本次不处理） |
| INFO-1 | `[一-鿿]` 不覆盖 CJK 扩展 A 区 | ⏭️ 本次不处理 |
| INFO-2 | 注释交叉引用可补 | ⏭️ 本次不处理 |

### 第一轮 Codex 对抗审查（对初版方案 A）

**结论**: 2 CRITICAL，A/B 基线确认均为真实回归
**处置状态**: ✅ 已修复——CRITICAL-1（模板占位符包进 code span 逃逸检测）与 CRITICAL-2（未闭合围栏吞掉整段）均通过修订后的判据（canonical 判据跨代码区不豁免 + 单一围栏扫描器 `computeFenceRegions`）解决，`verify-codex-claims.mjs` 确认。**注**：该轮修复落地时判据为三段，第 4 轮（下条）在此基础上再追加第 4 段成为现网四段判据，两轮修复不冲突、是渐进收口关系。

### 第二轮 Codex 对抗审查（对已落地实现）

**结论**: 2 CRITICAL（实测暴露 3 项具体回归构造），A/B 基线确认均为真实回归
**处置状态**: ✅ 已修复——新增第 4 段结构性判据（"花括号存在 + 剥离代码区后实质散文不足阈值"），不依赖对花括号内容的猜测，一次性堵住"中文占位符塞 ASCII 冒号"「纯 ASCII 模板字段」「转义反引号」三个改写变体；`stripInlineCodeSpans` 同步识别转义反引号；`stripReconSubblock` 改用 `computeFenceRegions` 与 `stripCodeRegions` 统一围栏语义。`node --test` 中 9 例专项反向断言与 `probe-round3.mjs` 交叉验证均确认修复生效，且未误伤既有合法用例（keep-A/B/C/E）。

**附带发现的存量漏洞**（非本次引入，已钉住）：`### 复现对账` 子块内出现未闭合围栏时，修复前后均判 `false`（漏报），暴露 `stripReconSubblock` 与 `stripCodeRegions` 曾各持一套围栏语义——本轮已通过统一为 `computeFenceRegions` 消除该结构性隐患的**根因**，但具体这一漏报现象本身未被单独判定为需修复的回归（因为它在修复前后行为一致）。

### 验证闭环发现的文档滞后（第 5 轮已修复）

**结论**: 1 项 DOC_DRIFT——第 4 轮代码追加第 4 段判据后，两处合同文档未同步
**处置状态**: ✅ 已修复——协调方第 5 轮当场修复，本轮逐字复核确认文档与代码四段判据语义逐段一致，详见上方 Layer 1.9

## Layer 2: 原生工具链

| 语言/工具链 | 构建 | Lint | 测试 |
|------|------|------|------|
| Node.js/TypeScript (spec-driver 插件 node:test) | N/A（无独立构建目标） | N/A（依赖 tsc build 兜底） | ✅ 715/715（test:plugins）+ 282/282（fix-compliance-core.test.mjs 专项） |
| Node.js/TypeScript（vitest 全量） | ✅ PASS（`npm run build` tsc 零错误） | ⏭️ 未检测到独立 lint 脚本目标（本次改动为 .mjs/.md） | ✅ 5769/5769 有效（本轮零失败，无 flaky） |
| 仓库级同步/合同校验 | — | — | ✅ 80 项 pass / 1 项既有 warn（`repo:check`，图产物新鲜度，非回归） |

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| 任务覆盖 | 100%（10/10，含 T9 文档同步于第 5 轮完成） |
| test:plugins | ✅ PASS（715/715，第 5 轮后重跑确认） |
| fix-compliance-core.test.mjs 专项 | ✅ PASS（282/282） |
| vitest 全量 | ✅ PASS（5769/5769，本轮零失败无 flaky） |
| Build Status | ✅ PASS（tsc 零错误） |
| repo:check | ✅ PASS（80 pass / 1 项既有 warn，非回归，第 5 轮后重跑确认） |
| 复现脚本（repro-f228-r3-adapted.mjs） | ✅ PASS（7/7，含第 4 轮新增用例） |
| 第一轮 Codex 对抗审查回归验证（verify-codex-claims.mjs） | ✅ PASS（3 项修复项全 ok，3 项存量缺口按预期为 GAP） |
| 第二轮 Codex 对抗审查回归验证（probe-round3.mjs） | ✅ PASS（3 项修复项全 ok，1 项已知残余按预期为 BAD） |
| 用户验收口径 6 条 | ✅ 全部达成 |
| **文档一致性（Layer 1.9）** | ✅ **已修复（第 5 轮），逐字复核确认与代码一致** |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题

无。本次三轮代码改动 + 两轮 Codex 对抗审查修复 + 一轮文档同步修复后，未发现真实缺陷、回归或未处置的文档不一致。

### 遗留项（存量缺口，非本次范围，已在 fix-report.md / plan.md / 测试中显式钉住）

1. **FINDING-5**：缺右花括号绕过（`{未闭合的占位文本`）——修复前后行为一致（`residue=false`），非本次引入，测试中已作为"存量绕过"钉住并注明"改动需另立 feature"。
2. **WARNING-3a**：跨行 code span——按行独立扫描，反引号跨两行不闭合时不能正确识别为同一 span，属显式 non-goal（plan.md Q3 已论证方向性安全：最坏情况是残留极小概率误报，不产生漏报风险）。
3. **WARNING-3b**：4 空格缩进代码块——`computeFenceMask`/`computeFenceRegions` 本身不识别缩进代码块，`stripCodeRegions` 同样不处理，属显式 non-goal。
4. **W1（第 4 轮附带发现）**：花括号内含中文标识符的真实代码（如中文解构 `` const {结果} = f() ``）仍被误判为占位符残留——canonical 判据的已知代价，非回归，触发面窄（需代码在花括号内用中文标识符）。
5. **WARNING-2（代码质量审查）**：`fix-compliance-core.mjs` 连续三个 feature（F225→F224→F228）+ 本次三轮累计增长（621→758→870→现网约 900+ 行），建议下次涉及该文件时评估拆分，本次不处理。
6. **INFO-1/INFO-2（代码质量审查）**：CJK 扩展 A 区未覆盖、注释交叉引用可补充，本次不处理。

### 未采纳的 Codex 建议（第二轮，摘录）

- **彻底移除 canonical 判据、改用"已知模板 token 精确目录"**：不采纳，理由见 fix-report.md——会在 core 与 SKILL 文本之间新建强耦合，第 4 段结构性边界已不依赖内容猜测地堵住改写绕过，canonical 判据退居补充层。
- **行内扫描性能优化（O(R²) → 线性）**：不采纳，实测 96 万字符病态输入耗时 210ms，真实制品章节正文规模远小于此，且文本非对抗性 DoS 面。
- **根因表述精确化（INFO 6）**：接受其实质但不改写现有 5-Why 表述，已足够准确。

### 未验证项（工具未安装）

无——本次涉及的全部验证工具（node、npx vitest、npm、tsc）均已安装并成功执行。

### 本轮验证方法论说明（关于 repro-f228.mjs 失效）

原 `repro-f228.mjs` 的 R0/R1 用例读取姊妹 worktree 的真实 F227 报告文件做反事实替换，该文件已被姊妹 worktree 的并行会话改写、字面串不复存在，导致脚本报错。已用 `core-before.mjs`（改动前代码快照）对同一读盘逻辑重跑验证同样报错，确认这是**外部 fixture 漂移，与本次 F228 改动无关**。已改用 `repro-f228-r3-adapted.mjs`（内联构造等价场景，逐字对应 `fix-compliance-core.test.mjs` 中的 R1 用例）完成同等验证，7/7 全部符合预期。
