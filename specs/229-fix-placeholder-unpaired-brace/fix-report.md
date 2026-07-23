# 问题修复报告 — F229 占位符检测「不成对花括号」存量绕过

## 问题描述

`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 的占位符空壳判据要求花括号**成对**：
`PLACEHOLDER_BRACE_REGEX = /\{[^}]*\}/` 与 `CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*\}/`
都以 `\}` 结尾。把模板占位符的右花括号删掉即可让整段占位文本通过 `checkArtifactSection`。

实证输入（用户提供，F228 期间以 A/B 基线确认修复前后行为一致 → 属存量缺口，非 F228 引入）：

```text
# 报告

## 判定依据
{为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果
```

当前 `checkArtifactSection(content, /^##\s*判定依据\s*$/m)` 返回 `placeholderResidue: false`。

这是**可主动触发的门禁绕过**：no-op 收口只要保留模板原文并删掉一个 `}`，就能让 fix 依从性
Stop hook 判定 `## 判定依据` 章节"有实质内容"，与 F224 / F228 记录的同类风险同源。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 占位空壳为何被判为合规？ | 四段 OR 判据全部落空：正文 40 个非空白字符越过 `MIN_SECTION_BODY_CHARS`（>20），两条花括号判据均未命中 |
| Why 2 | 两条花括号判据为何未命中？ | 二者的正则都以字面 `\}` 收尾，要求**闭合**的花括号对；输入只有 `{` 没有 `}` |
| Why 3 | 为何写成"要求闭合"？ | 判据从"识别 canonical 模板占位符 `{根本原因一句话总结}`"这一**正例形态**反推而来——模板里的占位符天然成对，于是把"成对"一并写进了模式 |
| Why 4 | 为何"照着正例写模式"会漏？ | 门禁判据的对手不是模板本身而是**改写模板的人**：把模式中任何非必要的形态约束（此处是闭合）当作判据组成部分，等于向对手公开了一条只需删一个字符的逃逸路径。占位符的语义标志是"存在未替换的模板起始标记 `{`"，闭合与否与"是否已替换为真实内容"无关 |
| Why 5 | 为何未被现有机制捕获？ | F228 已在测试里以 characterization test 钉住了该行为（`plugins/spec-driver/tests/fix-compliance-core.test.mjs:2196`），但当轮明确"不动这三处判据本身"，缺口被显式记录而非修复；无任何 CI 断言把它标为 must-fix |

**Root Cause**: 花括号占位判据把 canonical 模板的**闭合形态**误当作判据的必要组成部分，而占位符的真实语义标志只是"存在未替换的模板起始标记（左花括号）"；闭合要求是纯粹的多余约束，构成删一个字符即可通过的逃逸面。

**Root Cause Chain**: 占位空壳被判合规 → 四段 OR 全落空 → 两条花括号判据均以右花括号收尾 → 判据照 canonical 模板正例形态反推 → 多余的形态约束即逃逸面 → F228 仅钉住不修。

> 行文约定：本章节刻意不出现花括号字面量。原因是本仓当前**已安装**的插件快照（cache 4.3.0）早于 F228，
> 其 `checkArtifactSection` 尚无代码区豁免，会把行内 code span 里的花括号误判为占位残留——
> Stop hook 消费的正是该快照而非仓库源码（详见「工具使用反馈」）。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L139 | `PLACEHOLDER_BRACE_REGEX = /\{[^}]*\}/` | 去掉闭合要求，收窄为"存在**任何 ASCII U+007B**"。**措辞订正（Codex 核实）**：不得表述为"未转义的模板起始标记"——`/\{/` 不检查 Markdown 转义，`\{` 同样命中 |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L150 | `CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*\}/` | 闭合改为"`}` 或**行尾**"，且拆成两分支 alternation（成对分支逐字保留旧形态；不成对分支排除 `\n` 并配 `/m`）。**订正**：首版写成单分支 `(?:\}\|$)` 且不带 `/m` 是真实回归——`$` 于是表示章节末尾，未闭合 `{` 会跨围栏跨段落一直吞到章节结束 |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L735 | 第 4 段 `PLACEHOLDER_BRACE_REGEX.test(proseBody) && strippedChars <= 20` | 无需单独改动，随 L139 常量自动收口 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| 全仓其余 `.mjs` | — | `/\{[^}]*\}/` 形态 | **安全**：`grep -rn '\{\[\^}\]' plugins/spec-driver/{scripts,tests}` 全仓仅 L139 一处生产定义，无第二消费点 |
| `stripCodeRegions` / `stripInlineCodeSpans` | L606-686 | 反引号 run 配对 | **安全**：F228 已按"未闭合不剥离"处理，未闭合围栏/反引号不构成豁免（该方向的对偶缺口已修） |
| 跨行 code span 误报、4 空格缩进块误报 | test L2206 / L2218 | characterization | **不在本次范围**：二者是**误报**（把合法制品判成占位）而非绕过，方向相反，仍按 F228 结论保留钉住 |

### 同步更新清单

- 调用方：无（`checkArtifactSection` 签名与返回结构不变，`judgeCompliance` 两支分支零改动）
- 测试：翻转 `fix-compliance-core.test.mjs:2196` 的 characterization 断言为期望行为（`residue=true`），并补不成对花括号的正/反例边界用例
- 文档：`specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md` 第 28 行、`specs/208-fix-mode-process-compliance/data-model.md` 第 80 行的四段判据描述需同步"不要求闭合"

## 修复策略

### 方案 A（推荐）：把闭合要求从两条正则中移除，判据锚点收窄为"未替换的模板起始标记"

- `PLACEHOLDER_BRACE_REGEX`：`/\{[^}]*\}/` → `/\{/`（并相应改名为语义准确的 `PLACEHOLDER_OPEN_BRACE_REGEX`）
- `CANONICAL_PLACEHOLDER_REGEX`：`/\{(?=[^}]*[一-鿿])[^}:]*\}/` →
  `/\{(?=[^}]*[一-鿿])[^}:]*\}|\{(?=[^}\n]*[一-鿿])[^}:\n]*$/m`
  （闭合边界放宽为"`}` 或**行尾**"，CJK 与"不含 ASCII 冒号"两项判别力在**两个分支中**逐字保留）

**为何这是结构性判据而非内容启发式**：不去猜"这段花括号是不是占位符"，而是复用 F228 已确立的**结构性边界**——
代码区（闭合 fenced 块 + 行内 code span）剥离后剩下的就是散文，散文里出现模板起始标记 `{` 即判占位。
判别力全部来自"文本处于代码区还是散文区"这一结构事实，不含任何对花括号内容的语义猜测。

**为何两条正则的收口方式不同**：`PLACEHOLDER_BRACE_REGEX` 的**主消费点**（四段 OR 第 3 段）作用在**已剥离代码区**
的文本上，真实代码花括号已被结构性豁免，因此可以退化为最朴素的 `/\{/`；`CANONICAL_PLACEHOLDER_REGEX` 作用在
**未剥离**的原文上（F228 R2-2 刻意为之，堵"占位符包一层反引号"），仍须靠 CJK + 无 ASCII 冒号两项把真实代码
字面量排除在外，故只能放宽闭合边界，不能退化为 `/\{/`。

> **订正（Codex 核实）**：上文"作用在已剥离代码区的文本上"只覆盖第 3 段。该常量还有**第 4 个消费点**——
> 四段 OR 第 4 段对**未剥离**的 `proseBody` 求值，再与 `strippedChars <= MIN_SECTION_BODY_CHARS` 取合取
> （F228 R3-1 的代码区豁免边界判据）。第 4 段不靠正则排除真实代码，靠剥离后剩余散文量作判别锚点。
> 详见 plan.md §2 扫描对象表。

> **订正（Codex 核实）**：ASCII 冒号排除**只是每个 `{` 起点的局部条件**，不能泛化为"JSON 含冒号即可可靠豁免"。
> 引擎在某个 `{` 失败后会从后续每个 `{` 重新起匹配。实测反例：`{"claim":"{症状已消除` —— 第一个 `{` 被冒号挡住，
> 第二个 `{` 之后是纯 CJK 直到行尾，不成对分支命中。可靠的 JSON 豁免仍靠 F216 `stripReconSubblock` 与 F228 代码区剥离。

**验证**：新 canonical 正则在既有正/反例上是旧正则的**严格超集**（已实测：canonical 成对占位、含引号 canonical、
**跨行成对** canonical 仍 HIT；JSON 字面量 `{"claim":...}`、纯 ASCII 对象 `{ path: null }`、无花括号散文、
**闭合围栏内截断代码 + 后续中文散文** 仍 miss；不成对占位由 miss → HIT）。全仓 217 份
`fix-report.md` / `verification-report.md` × 2 条 heading 探针 = 434 次新旧对拍，差异 0。

### 方案 B（备选）：新增第 5 段 OR，专门检测"有 `{` 无 `}`"

保持两条既有正则不动，另加 `hasUnpairedOpenBrace(text)` 判据。
**不推荐**：四段判据再加一段会让"哪段管什么"更难推理，且没有解决根因——闭合要求这个多余约束仍留在原判据里，
未来任何基于它的推理都会重蹈覆辙。方案 A 是在原判据上修正抽象，符合"不在错误抽象上叠加 workaround"。

## Spec 影响

需要更新的文档（描述性同步，非行为定义）：

- `specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md:28`
- `specs/208-fix-mode-process-compliance/data-model.md:80`

两处均需把"正则 `/\{[^}]*\}/`"及 canonical 占位符的描述改为"不要求花括号闭合"。
