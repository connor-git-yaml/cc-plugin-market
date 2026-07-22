# 问题修复报告（F228）

## 问题描述

fix 依从性 Stop hook 报 `[FIX-COMPLIANCE] 制品为占位空壳：请把模板占位符替换为真实内容`，但制品内容完整、无任何未替换模板占位符。

触发条件：在 `fix-report.md` 的必填章节（Root Cause 段 / 判定依据段）正文里，用**行内代码 span**（反引号包裹）写含花括号的对象字面量、类型字面量或模板示例，例如描述某函数返回值形状时写出对象字面量的行内代码。

实际发生场景：`specs/227-fix-compliance-candidate-disk-filter/fix-report.md` 编写过程中，作者用行内代码描述 `resolveFeatureDirCandidate` 的返回值形状而被误阻断，被迫改写为不含花括号的等价散文（该报告 L35 现存的 `path=null/ambiguous=true` 写法即绕开痕迹）。

与 F216 C1 同族：C1 当时只按"复现对账子块"这一具体形态定向打补丁，没有收口到通用的「代码区不参与散文占位符扫描」语义，于是同一根因换个形态（行内 code span / fenced code 块）再次复发。

## 复现证据

复现脚本对现网源码逐例断言，7 例中 3 例不符预期（`R1` 为对真实 F227 报告做**反事实还原**——只把作者的绕开写法改回自然写法，其余逐字不动）：

```text
  ok   R0. 真实 F227 报告（作者已绕开写法）              expect=false actual=false
 FAIL  R1. 同一报告 · 还原为行内 code span 花括号写法      expect=false actual=true
 FAIL  A. 行内 code span 含花括号（锚点之后的散文里）      expect=false actual=true
 FAIL  B. fenced code 块含花括号（同源第二形态）          expect=false actual=true
  ok   C. 散文裸花括号（真实未替换占位符，必须仍判 residue） expect=true  actual=true
  ok   D. 正文过短（MIN_SECTION_BODY_CHARS，必须仍判）     expect=true  actual=true
  ok   E. 散文空洞但 fenced code 撑长度（既有行为）        expect=false actual=false
```

`R1` 是本缺陷"真实发生过、且已造成生产阻断"的硬证据：合规制品仅因作者选择了自然的代码写法就被判占位空壳。

`B` 暴露了报告人未提及的**第二条同源通路**：fenced code 块内的花括号同样进入扫描。F216 C4 已为标题/锚点识别做过 fence-aware 处理（`computeFenceMask`），但占位符扫描完全没有复用这套语义。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 合规制品为何被判占位空壳？ | `placeholderResidue` 为真，因为章节正文里扫到了花括号 |
| Why 2 | 正文里为何有花括号？ | 作者在散文中用行内代码 span 写对象字面量／JSON 示例，或贴了 fenced code 块——都是**真实内容**而非模板残留 |
| Why 3 | 扫描为何分不清代码与散文？ | 扫描目标 `proseBody` 只经过 `stripReconSubblock` 一道处理，该函数**仅**剔除「复现对账」子块，对行内 code span 与 fenced code 块一无所知 |
| Why 4 | 为何只剔除了复现对账子块？ | F216 C1 修同类误报时按**具体形态**定向打补丁（当时只有复现对账这一种已知触发形态），没有把语义收口为通用的"代码区不参与散文占位符扫描" |
| Why 5 | 为何未被现有机制捕获？ | 单测只覆盖了 C1 当时那一种形态（复现对账 JSON），缺少"散文里含代码区"的通用回归用例；且同文件已有的 fence-aware 原语 `computeFenceMask` 未被占位符扫描复用，两套语义各自为政无人对账 |

**Root Cause**：占位符扫描把「章节正文」整体当作散文处理，缺少"代码区不参与散文语义判据"这一层归一化；已有的 fence-aware 原语只服务于标题／锚点识别，未被占位符扫描复用，导致同一份文本在同一个文件里存在两套互不一致的"什么算散文"语义。

**Root Cause Chain**：合规会话被阻断 → 判 `artifact:placeholder` → 章节正文扫到花括号 → 花括号来自行内代码 span 或 fenced code 块 → 扫描目标只剔除了复现对账子块 → **F216 C1 按形态打补丁而非按语义收口，且未复用同文件既有的 fence-aware 原语**。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L582 | 占位符扫描直接作用于未剥离代码区的章节正文 | 扫描前先剥离 fenced code 块与行内 code span |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `fix-compliance-core.mjs` | L511 `extractSectionBody` | 逐行判定 + fence-aware | **安全**：F216 C4 已 fence-aware |
| `fix-compliance-core.mjs` | L548 `stripReconSubblock` | 逐行判定 + fence-aware | **安全**：已 fence-aware，且本次修复与其**串联组合**而非替换 |
| `fix-compliance-core.mjs` | L602 `classifyClosureForm` | 锚点识别 + fence-aware | **安全**：F216 C4 已 fence-aware |
| 全仓其他脚本 | — | 花括号扫描 | **安全**：`PLACEHOLDER_BRACE_REGEX` 全仓仅 L582 一个消费点（已 grep 核实） |

结论：爆炸半径极小——单一正则、单一消费点。`checkArtifactSection` 的生产调用方只有 `judgeCompliance` 的两支（no-op 分支 L676 / repair 分支 L684），两支都因本修复而同向收益，无分支需要差异化处理。

### 同步更新清单

- 调用方：无需改动（函数签名与返回结构不变）
- 测试：`plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增回归用例；F216 C1/C4 既有断言全部保留
- 文档：`checkArtifactSection` / 新增辅助函数的 JSDoc 需说明语义边界

## 修复策略

### 方案 A（推荐）：语义收口 —— 剥离代码区后再扫占位符，长度判据输入保持不变

在 `checkArtifactSection` 中把「长度判据」与「占位符判据」的输入分离：

- **长度判据**继续作用于 `stripReconSubblock(body)`，与今日**逐字一致**——这是保住 `MIN_SECTION_BODY_CHARS` 不被放宽、且不引入新误报的关键
- **占位符判据**作用于「再剥离 fenced code 块与行内 code span」之后的文本

新增 `stripCodeRegions(text)` 辅助函数：fenced code 块复用同文件既有的 `computeFenceMask`（与 F216 C4 保持同一套 fence 语义），行内 code span 按 CommonMark 的"同长度反引号 run 配对"逐行剥离，未闭合的反引号原样保留。

**为何长度判据必须留在未剥代码的文本上**：若长度也改用剥离后的文本，上表 `E` 例（散文简短但有实质 fenced code 证据的章节）会从"通过"翻成"占位空壳"——那正是本次要消灭的误报类型，等于按下葫芦浮起瓢。用户约束"`MIN_SECTION_BODY_CHARS` 判据不得被放宽"在此方案下自然满足：同一输入的长度结论与修复前**完全相同**。

**已知残留权衡**：把整段模板占位符包进代码块可绕过占位符检测。评估为可接受——(1) 用户验收口径明确要求的是"模板里**散文位置**的花括号仍须命中"，该口径完整保住；(2) 这需要作者刻意把模板包进代码围栏，而现状是每个诚实作者写对象字面量都被误伤；(3) 长度判据仍作用于含代码的文本，无法靠删空散文过关。以"误伤诚实作者" 换 "堵刻意绕过"是负收益交易。

### 方案 B（备选）：扩展 `PLACEHOLDER_BRACE_REGEX` 精确匹配模板占位符形态

改为只匹配"花括号内是纯描述性文本、不含代码特征字符"的形态。

**不推荐**：这正是本缺陷根因批评的"按形态打补丁"——形态枚举永远追不上真实写法，且会与 F216 C1 一样在下一种形态上复发。用户亦明确要求"避免继续按形态打补丁"。

## Spec 影响

`checkArtifactSection` 的**代码合同**不变（签名、返回结构、`missing` 枚举均不变），`contracts/fix-compliance-judge-cli.md` 的 canonical 反馈文案也不变。

但**机械判据合同必须同步更新**（此结论修正本报告初版的"无需更新 spec"——由 Codex 对抗审查证伪）：

- `specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md`「机械判据锚点」表把"非占位空壳"写死为"正文……不含未替换的花括号占位符（正则 `/\{[^}]*\}/` 不命中）"，没有代码区例外
- `specs/208-fix-mode-process-compliance/data-model.md` 第 6 节 `placeholderResidue` 字段同样描述为"章节内容是否仍含未替换的 `{...}` 模板占位符"

本次改动让扫描面从"整段正文"变成"分层扫描"，上述两处描述已过期，必须改写为准确的判据描述（最终落地为**四段判据**，见下方「第二轮 Codex 审查（对实现）与第 4 段判据」）。

## Codex 对抗审查处置

对初版方案 A 跑了 Codex 对抗审查，报 2 项 CRITICAL。我用 **A/B 基线实测**（同一组载荷分别跑 `HEAD` 版与修复版）判定其真伪，结论：**两项 CRITICAL 均属实，且是本次修复引入的真实回归**——它们在修复前判 `residue=true`，修复后翻成 `false`，即门禁被削弱、出现可主动触发的绕过。

| 载荷 | 修复前 | 初版方案 A | 判定 |
|------|--------|-----------|------|
| 模板占位符包进行内 code span（repair 形态） | `true` | `false` | **本次引入的回归** |
| 模板占位符包进行内 code span（no-op 形态） | `true` | `false` | **本次引入的回归** |
| 未闭合围栏吞掉整段（含后续 H2） | `true` | `false` | **本次引入的回归** |
| 缺右花括号 `{未闭合的占位文本` | `false` | `false` | 存量缺口，不在本次范围 |
| 跨行 code span | `true` | `true` | 存量误报，显式 non-goal |
| 4 空格缩进代码块 | `true` | `true` | 存量误报，显式 non-goal |

这印证了 F224 已记录的通用教训：**门禁的豁免必须按维度收窄，整体放行等于送出一条可主动触发的绕过。** 初版方案 A 把"代码区"整体豁免出占位扫描，就是一次整体放行。

### 修订后的方案（最终实现）

**CRITICAL-2 修法**：`computeFenceMask` 对"开了但至 EOF 未闭合"的围栏会把开围栏行到文件尾**全部**标记为 fenced，于是初版实现把整段正文连同后续章节的占位符一并剥掉。修订为：把围栏扫描逻辑提取为**单一扫描器** `computeFenceRegions(lines) → { mask, unclosedFrom }`，`computeFenceMask` 改为委托它（既有语义零变化）；`stripCodeRegions` 只剥离**真正闭合**的围栏区，未闭合尾部原样保留继续参与扫描。这里刻意不复制一份平行扫描逻辑——单一事实源正是本次修复的核心原则。

**CRITICAL-1 修法**：占位符判据升为三段 OR——正文过短、**canonical 模板占位符（跨代码区一律命中）**、通用花括号（仅扫剥离代码区之后的文本）：

- canonical 模板占位符判据：花括号内含中日韩表意文字**且不含 ASCII 冒号**
- 判别依据：ASCII 冒号才是"这是代码/JSON 字面量"的可靠标志（对象字面量与 JSON 必有键值冒号）；ASCII 引号不是——canonical 中文占位符里也会出现引号（如 `{spec 文件列表，或"无需更新"}`，实测该引号为 ASCII U+0022）
- 实测判别力 14/14：8 条 canonical 占位符全命中，6 条代码字面量（含对象字面量、JSON、解构、rest）全豁免

于是"把模板占位符包进反引号"不再构成豁免理由，而作者引用真实代码的花括号仍然豁免——豁免按维度收窄，而非整体放行。

### 第二轮 Codex 审查（对实现）与第 4 段判据

对已落地的实现再跑一轮 Codex 对抗审查，又报 2 项 CRITICAL。仍用 A/B 基线逐条判真伪：

| 构造 | 修复前 | 三段判据 | 判定 |
|------|--------|---------|------|
| 中文占位符里塞 ASCII 冒号 + 行内 code span | `true` | `false` | **回归**：ASCII 冒号被当成"这是代码"的充分信号，占位符借此逃逸 canonical 判据 |
| 纯 ASCII 模板字段（如影响范围表的字段占位）+ 行内 code span | `true` | `false` | **回归**：canonical 判据要求含中文，纯 ASCII 占位符不命中 |
| **转义**反引号 `\`` 包裹占位符 | `true` | `false` | **回归**：Markdown 里转义反引号不是 code span 定界符，实现却当成定界符剥掉了散文 |
| `### 复现对账` 子块内出现未闭合围栏 | `false` | `false` | 存量漏洞（非本次引入），但暴露 `stripReconSubblock` 与 `stripCodeRegions` 围栏语义不一致 |

前三项确认为本次引入的真实回归——它们共同暴露了三段判据的结构性弱点：**canonical 判据是在猜"这段花括号是不是模板占位符"，而猜测必然可被改写绕过。**

修法不是继续加猜测规则，而是给代码区豁免划一条**结构性边界**（第 4 段判据）：

> 若正文原文含花括号，但**剥离代码区之后的实质散文不足阈值**，则判占位空壳。

语义：代码区豁免只服务于"作者在实质散文之外引用代码"，不服务于"整段正文就是包在代码里的占位符"。这条边界不依赖对花括号内容的任何猜测，因此上述三个改写变体（以及未来同类改写）一并失效。原型实测：三个绕过构造全部转 `true`，四条合法用例（行内 code span 对象字面量 + 长散文、fenced JSON + 真实散文、散文裸花括号、散文空洞但 fenced code 无花括号撑长度）判定全部不变。

同轮附带收口：
- `stripInlineCodeSpans` 识别转义反引号（向左数连续反斜杠，奇数视为已转义、不作定界符）
- `stripReconSubblock` 改用 `computeFenceRegions`，与 `stripCodeRegions` 统一围栏语义——两个姊妹函数各持一套围栏语义正是本次要消灭的根因模式

### 已知残余（非回归，已在测试中钉住）

| 现象 | 修复前 | 修复后 | 处置 |
|------|--------|--------|------|
| 花括号内含中文标识符的**真实代码**（如中文解构 `` `const {结果} = f()` ``）仍被判占位 | `true` | `true` | 残余误报。canonical 判据的代价，非回归；触发面窄（需代码在花括号内用中文标识符） |
| 缺右花括号的占位文本（`{未闭合的占位文本`）不被判占位 | `false` | `false` | 存量绕过，与代码区无关，本次不修 |
| 跨行 code span 内的花括号仍被判占位 | `true` | `true` | 存量误报，显式 non-goal |
| 4 空格缩进代码块内的花括号仍被判占位 | `true` | `true` | 存量误报，显式 non-goal |

四项均以 characterization 测试钉住**当前行为**（而非"期望行为"），注释标明属存量缺口、修复需另立 feature。

### 未采纳的 Codex 建议

- **缩进代码块与跨行 code span**：Codex 建议改用跨全文状态机覆盖二者。不采纳——A/B 实测显示这两类在修复前后行为**完全一致**（均判 `true`），不是本次引入的回归，属存量误报；且 `computeFenceMask` 本身不识别缩进代码块，为其单开分支会再造两套围栏语义。已在测试中**钉住当前行为**并注明"存量、非 F228 回归、改动需另立 feature"。
- **缺右花括号绕过**（`{未闭合的占位文本`）：同为存量缺口（修复前后均 `false`），本次不修，已钉住行为并留注。
- **彻底移除 canonical 判据、改用"已知模板 token 精确目录"**（第二轮建议）：不采纳。维护一份与 SKILL.md 模板同步的 token 目录会在 core 与 SKILL 文本之间新建一条强耦合，模板一改就静默失效；第 4 段结构性边界已不依赖内容猜测地堵住改写绕过，canonical 判据退居"锦上添花"的补充层（捕获"长散文中夹带一处中文占位符残留"），其残余误报面窄且非回归。
- **行内扫描性能优化（O(R²) → 线性）**（第二轮建议）：不采纳。实测 96 万字符病态输入耗时 210ms，而真实制品章节正文是数百到数千字符；且该文本由 agent 自己撰写，不构成对抗性 DoS 面。按"不做未要求的优化"原则明确不做。
- **根因表述精确化**（INFO 6）：接受其实质——F216 C1 处理的复现对账 JSON 是结构化子块而非 Markdown code region，严格说属"同一大类（非散文内容误入通用花括号扫描）"而非同一 Markdown 根因。上文 5-Why 的 Why 4 描述已足够准确，不再改写。
