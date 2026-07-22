---
feature: 225-fix-compound-command-hijack
mode: fix
based_on: fix-report.md（方案 A：子命令切分 + 同段共现判据）
baseline_commit: 7b0d7b3
---

# 修复规划

## 摘要

`resolveFeatureDirCandidate`（`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` L270-296）当前把
写指示符门禁（`BASH_WRITE_INDICATOR_REGEX`）与 artifact 路径扫描（`scanArtifactPath` + `ARTIFACT_PATH_REGEX`）
都作用在**整条 Bash 命令文本**上，导致复合命令（`;` / `&&` / `||` / 换行拼接）中任一段的写指示符可以为
另一段的纯读路径"背书"，把候选劫持到磁盘上历史合规特性目录（详见 fix-report.md R2-R4 复现）。

本规划采纳 fix-report.md 的**方案 A**：新增两个模块私有 helper（`splitBashSubcommands` / `hasBashWriteIndicator`），
把 Bash 分支的判定粒度从"整条命令"下沉到"子命令段"，要求写指示符与 artifact 路径**同段共现**才提名。
改动收敛在 `resolveFeatureDirCandidate` 一个函数 + 两个新增私有 helper，不触碰其它判定链路、不改导出面、
不改调用方签名。

## 变更清单

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 修改 | 新增私有常量 `SUBCOMMAND_SPLIT_REGEX`、私有函数 `splitBashSubcommands(command)` / `hasBashWriteIndicator(segment)`；重写 `resolveFeatureDirCandidate` 的 Bash 分支为逐段判定；补充函数 JSDoc 说明"同段共现"判据 |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | 新增用例（tasks 阶段落地，本规划仅列清单） | 在 `codex C-2` describe 块内追加复合命令正/负向用例（见下方「验证方案」），**不修改任何既有断言** |
| `specs/225-fix-compound-command-hijack/fix-report.md` | 不改 | 诊断报告已完成，作为本规划输入 |

不涉及：调用方（`fix-compliance-judge.mjs:128`）、导出常量（`BASH_WRITE_INDICATOR_REGEX` / `ARTIFACT_PATH_REGEX`）、
其它模块（`fix-compliance-execution-record.mjs` / `fix-compliance-io.mjs`）。

## 设计问题逐一解答

### 1. 切分算法：分隔符集合与 `&&`/`||` 误切规避

**结论**：仅以 `&&` / `||` / `;` / 换行（`\r?\n`）四种作为分隔符，**不纳入**裸 `|`（管道）与裸 `&`（后台）。

**误切规避**：用单条正则 `/&&|\|\||;|\r?\n/g` 作为 `String.split` 的分隔符。正则引擎在每个匹配位置按
alternation 顺序尝试：`&&`（双字符）优先于 `\|\|`（双字符）优先于 `;` / 换行。由于 `&&` 与 `\|\|` 都要求
**两个连续同字符**才能匹配，落单的 `|` 或 `&` 在任何位置都不会被该正则命中——不需要 lookahead 或手工顺序
控制，"先切 `&&`/`||` 再切 `;`" 的顺序诉求由 alternation 本身保证。

**是否纳入裸 `|`/`&`：取舍结论**

| 判据 | 结论 |
|------|------|
| 是否存在同类劫持洞（如 `echo x > /tmp/y \| cat specs/999-fix-decoy/fix-report.md` 语义上的管道变体、`echo x > /tmp/y & cat ...` 后台变体） | 存在理论可能，但复现矩阵（R1-R4）与 C-2 六条硬化断言均未覆盖，纳入后无法用既有事实验证是否真实关闭 |
| 实现复杂度 | 裸 `&` 与常见 fd 重定向 token（`2>&1`、`&>`）视觉高度重叠，为避免误切诊断类命令中的合法 idiom，需要额外排除逻辑；裸 `\|` 与管道内合法写入 idiom（如 `... \| tee <path>`）语义上不是独立动作边界，强行切分会引入语义失真的分段 |
| 与"改动收敛在 resolveFeatureDirCandidate + 新增私有 helper"约束的匹配度 | fix-report.md 方案 A 原文即只列 `&&`/`||`/`;`/换行；扩大分隔符集合是本规划阶段的新增决策，需要独立复现验证，超出本次 fix 的最小化变更范围 |

**决定**：不纳入。若未来经复现证实裸管道/后台变体存在真实劫持面，另开 Feature 处理（记入「已知限界」）。

### 2. 同段共现判据：精确判定顺序 + "取最后出现者"语义保持

`resolveFeatureDirCandidate` 的 Bash 分支改造为：

```
for entry in entries (按 lineIndex 升序，即 transcript 原始时间序):
  if entry.role !== 'assistant' or entry.lineIndex <= anchor: continue
  for block in entry.toolUseBlocks:
    if block.name === 'Bash' and typeof input.command === 'string':
      for segment in splitBashSubcommands(input.command):   // 按原始左右顺序，等价于命令执行顺序
        if hasBashWriteIndicator(segment):
          scanArtifactPath(segment)   // 命中则 candidate = 该段匹配路径的目录前缀（不 return，继续扫）
```

`scanArtifactPath` 内部逻辑不变（`ARTIFACT_PATH_REGEX` 全局 `exec` 循环，每次命中覆盖 `candidate`），只是
现在的输入从"整条命令字符串"收窄为"单个已过写指示符门禁的子命令段字符串"。

**"取最后出现者"语义保持**：
- entries 层：仍按 transcript 原始顺序遍历，不变。
- Bash 命令内部：`splitBashSubcommands` 保序（`String.split` 天然保留原文本左右顺序），逐段判定时仍按
  命令文本从左到右（即 shell 执行的先后顺序）推进 `candidate` 赋值，不提前 `return`。
- 因此无论是"同一 entry 内多段命中"还是"跨多个 entries 命中"，最终 `candidate` 都是**扫描窗口内所有满足
  同段共现的命中中，出现位置最晚的那一个**——与改造前"整条命令文本内最后一次匹配"是同一语义在更细粒度
  下的精确延续，而非弱化或改变。

### 3. heredoc 安全性：C-2 第 4 条断言逐段论证

用例（L530-533）：`cat > specs/302-fix-real/fix-report.md <<EOF\n...\nEOF`

按换行切分为 3 段：

| 段 | 内容 | `hasBashWriteIndicator` | `ARTIFACT_PATH_REGEX` 命中 |
|----|------|:---:|:---:|
| 1 | `cat > specs/302-fix-real/fix-report.md <<EOF` | 是（`>` 与 `<<` 均命中） | 是（`specs/302-fix-real/fix-report.md`） |
| 2 | `...` | 否 | 否 |
| 3 | `EOF` | 否 | 否 |

写指示符与 artifact 路径**均落在 heredoc 的 header 行（第 1 段）**——heredoc 语法要求 `<<EOF` 与其重定向目标
（`>` 目标）必须写在同一物理行（这是 shell 语法本身的约束，不是本次实现刻意保证的），换行切分只会把
**heredoc body**（第 2、3 段，天然不含写指示符也不含 artifact 路径）与 header 行分开，不会拆散 header 行内部
的 indicator/path 共现关系。因此该用例在改造后依旧提名 `specs/302-fix-real`，C-2 第 4 条断言保持绿。

### 4. 引号/转义：naive 切分的单调性证明

**结论**：不做引号感知切分，相对现状**单调更严**，不会新增劫持面。

**证明**：`splitBashSubcommands` 是一个**保序划分（partition）**操作——它只在分隔符字符序列出现的位置切断
原字符串，绝不合并、复制或重排任何字符。设原字符串上存在字符位置 `i`（写指示符）与 `j`（artifact 路径）：

- 若切分后 `i` 与 `j` 落在**同一段**（即二者之间没有出现分隔符），该段的文本内容与原字符串在 `[i,j]` 区间
  完全一致（因为切分不改动段内内容），因此改造前后判定结果不变——仍然提名。
- 若切分后 `i` 与 `j` 落在**不同段**，则该 pair 不再共现，从"提名"变为"不提名"。

即：新判据下被提名的命令集合 ⊆ 旧判据下被提名的命令集合（严格子集或相等，取决于具体输入）。这个包含关系
**与是否做引号/heredoc 感知无关**——因为它只依赖"切分=划分而非合并"这一操作性质，不依赖切分点选得是否
"语义正确"。即便某次切分意外落在被引号包裹的字符串内部（例如 `printf "a;b" > specs/300-fix-real/fix-report.md`
在 `;` 处被误切成 `printf "a` 与 `b" > specs/300-fix-real/fix-report.md`），也只是把原本一个段进一步拆成更多
段——写指示符（`>`）与完整 artifact 路径文本仍在同一个"更细的段"里（因为 `ARTIFACT_PATH_REGEX` 的字符集
`[a-z0-9-]` 本身就不包含 `;`/`&`/`\n` 等分隔符，路径文本永远不会被这些分隔符从中间切开），因此该场景下
判定结果实际不受影响。真正会导致「原本应提名、现在漏提名」的场景，仅限于**写指示符与 artifact 路径之间
的字符区间恰好被分隔符跨越**（详见 §6 回归风险清单第 1 条），且这类场景本就属于"新判据比旧判据更保守"
的预期方向，不构成安全回归（安全回归的定义是"新判据比旧判据更宽松"，这里恰好相反）。

#### 4.1 单调性的适用边界（implement 后由主编排器实测补记）

上述证明成立的层级是**提名集合**（"哪些命令会提名"），**不覆盖候选取值**（"提名的是哪个目录"）。主编排器用
复刻旧判据的对照脚本实测 6 条构造，结果：**集合单调性违规 0 条**（不存在"旧 `null` → 新提名"，证明无新增
劫持面），但**候选取值变化 2 条**：

| 构造 | 旧判据 | 新判据 | 评价 |
|------|--------|--------|------|
| `echo b > specs/300-fix-a/fix-report.md; cat specs/999-fix-decoy/fix-report.md` | `specs/999-fix-decoy` | `specs/300-fix-a` | **改善** —— 旧判据取"整条命令最后一次匹配"恰好落在纯读的诱饵上，新判据取到真实写入段 |
| `echo specs/999-fix-decoy/fix-report.md > /tmp/y; cat specs/300-fix-a/fix-report.md` | `specs/300-fix-a` | `specs/999-fix-decoy` | **中性** —— 两者**都不是**真实写入目标（前者是纯读、后者是 `echo` 参数且重定向到别处），同属已知限界 4 的表现，非本次新引入 |
| `echo a > specs/321-fix-first/fix-report.md; cp /tmp/report specs/322-fix-copy/fix-report.md` | `specs/322-fix-copy` | `specs/321-fix-first` | **劣化** —— `cp` 确实写入了后一个 artifact，但 `cp` 不在 `BASH_WRITE_INDICATOR_REGEX` 认可的写形态内，该段不合格，于是回退到前一个合格段（见下方限界 5） |

**差异的完整类别**（Codex 对抗审查 W-2 补正）：当"整条命令的最后一个 artifact 路径"落在**无写指示符的段**、
而其前方存在至少一个"有写指示符 + 有 artifact 路径"的段时，两实现取值必然不同。该类别下改善 / 中性 / **劣化**
三种情形**都存在**，取决于那个"末尾无指示符段"到底是纯读（改善）还是未被识别的真实写入（劣化）。

**结论**：单调性断言在集合层面**成立且已实测**（主编排器 21,296 样本 + Codex 独立 5,488 样本，违规均为 0）；
取值层面的差异根源是已知限界 4 与 5（`ARTIFACT_PATH_REGEX` 只判"路径文本出现"不判"是否为重定向目标"；
`BASH_WRITE_INDICATOR_REGEX` 只认重定向/heredoc/tee，不认 `cp`/`install`/`mv` 等写形态）。要消除取值层面的
不确定性，必须做重定向目标解析 + 补全写形态集合——两者都超出本次最小化变更范围，留待后续 Feature。
**本次改动在集合层面未使判据变宽**；取值层面的劣化方向表现为**漏提名（偏严）**，不是劫持面扩大。

> 措辞订正（Codex 对抗审查 CRITICAL 区第 1 条建议）：单靠"保序划分"不足以证明**任意**匹配器都单调，
> 还需匹配器满足「段内匹配必然也是原串匹配」。当前两个正则均不含 `^`/`$`/lookaround，满足该条件；
> 未来若为判据引入锚点或环视模式，本单调性证明**必须重新论证**。

### 5. 新符号可见性：模块私有

**结论**：`splitBashSubcommands` 与 `hasBashWriteIndicator` 保持模块私有（不 `export`）。

**理由**：
- fix-report.md 方案 A 原文明确表述为"两个新私有 helper"，与本规划约束"改动限定在 `resolveFeatureDirCandidate`
  及其新增私有 helper"逐字一致。
- 模块既有惯例：同级别的内部 helper（`matchRole`、`isNoopVerifyDelegation`、`extractSectionBody`、
  `stripReconSubblock`）均未导出，均通过其消费的公开函数（`classifyDelegationRole`、`checkArtifactSection` 等）
  间接黑盒覆盖；`toSingleMatchProbe` 的既有注释更是明确写"不 re-export，新符号无兼容约束"——本模块对"新增
  非必要导出"是刻意收敛的。
- `resolveFeatureDirCandidate` 全仓仅 1 个生产调用点，且已有 C-2 六条断言 + 本次新增复合命令用例可完整
  覆盖 `splitBashSubcommands` / `hasBashWriteIndicator` 的全部分支（切分正确性、indicator 判定、同段/跨段
  共现），黑盒覆盖已经足够，无需为直测而扩大导出面。
- 导出面每增加一个符号即增加一份长期兼容承诺；当前无任何已知或计划中的外部消费者需要直接调用这两个
  helper（F224 的合并点是 `hasBashWriteIndicator` 内部的 OR 分支，不是从外部 import 调用它，详见 §合并预案）。

### 6. 回归风险清单

| # | 场景 | 影响 | 风险评估与处置 |
|---|------|------|----------------|
| 1 | 反斜杠续行（line continuation）把写指示符与 artifact 路径分居两行，如 `cat <<EOF > \`<br>`specs/300-fix-real/fix-report.md`<br>`EOF`（`\` 续行后紧跟换行） | 换行切分不感知 `\` 续行语义，会把 indicator 与 path 误判为跨段，导致本应提名的诚实写入漏提名 | **低风险，可接受**：(a) 本模块注释已明确"诚实流程的 fix-report.md 由编排器亲自经 Write 写入"，Bash 写入是兜底路径而非推荐路径；(b) 该续行写法在诊断/修复类单行 heredoc 场景中极少出现；(c) 后果是"漏提名"而非"误提名"，不放大安全面，只影响可用性；记为已知限界，不在本次处理 |
| 2 | heredoc body 内容行本身含 `;`/`&&`/`\|\|` | body 行被进一步切碎 | **无影响**：body 行本就不含写指示符也不含 artifact 路径，切碎多少份都不改变整体候选结果（见 §3） |
| 3 | 复合命令内先后写两个不同特性目录的 artifact（如 `echo x > specs/300-a/fix-report.md; echo y > specs/301-b/fix-report.md`） | 需确认"取最后出现者"是否仍取 B | **无影响，行为不变**：改造前对整条文本做全局 `exec` 循环本就取"最后一次匹配"（即 B）；改造后逐段判定，B 所在段仍是最后处理的段，结果一致，两种实现在此场景下等价 |
| 4 | Shell 注释 `#` 之后的文本本不会被执行，但正则判据不识别 `#` 注释语义 | 若写指示符出现在注释里、真实执行段落只有读操作，理论上仍可能被判定为"该段含写指示符" | **既有限界，非本次引入/关闭**：本次改动的判定粒度是"子命令段"，不做 shell tokenizer 级别的注释剥离；这与切分算法无关，是 `BASH_WRITE_INDICATOR_REGEX` 本身"文本模式匹配而非语义解析"的既有性质，维持现状 |
| 5 | 单一（非复合）命令内，写指示符与 artifact 路径同段共现，但 path 只是被打印的字符串字面量而非真正写入目标，如 `echo "specs/300-fix-real/fix-report.md" > /tmp/log` | 会被误提名（indicator 与 path 确实同段共现，但语义上 path 不是写入目标） | **既有限界，非本次引入/关闭**：这不是"跨段背书"问题（本 Feature 的 Root Cause），是 `ARTIFACT_PATH_REGEX`
只做文本匹配、不判断 path 是否为该次写入实际目标的更底层局限，在改造前后同样存在；不在本次 Root Cause
范围内，记录供未来单独评估（不建议在本次顺手扩大改动面） |
| 6 | 裸 `\|`/`&` 变体劫持（见 §1 取舍结论） | 未被本次改动关闭 | **已知限界**：待复现证实后另开 Feature |

## §合并预案（与并行 F224）

**背景**：`specs/224-fix-compliance-judge-dir-resolution/` 记录了本缺陷但未修（其 plan.md 明确把修复留给
后续 Feature，即本特性）。F224 **尚未合入 master**：spec commit 位于并行 worktree 分支
`claude/zen-aryabhata-95e0dc`（`ab2f2ab`），实现/测试仍是该 worktree 的未提交工作树改动。F224 引入
`INLINE_EDIT_INDICATOR_REGEXES`（`sed -i` / `perl -i` 等原地编辑写指示符准入）与改名跟随
（`applyRename`：`mv` / `git mv`，含 `-f` 等 flag 形态）。

### 单点合并位

本次改造后，"一条子命令段是否含写指示符"这一判定被收口到单一谓词 `hasBashWriteIndicator(segment)`，且该
谓词已经是在**逐段粒度**上被调用（不是整条命令）。F224 落地时只需把该函数体从：

```js
function hasBashWriteIndicator(segment) {
  return BASH_WRITE_INDICATOR_REGEX.test(segment);
}
```

改为：

```js
function hasBashWriteIndicator(segment) {
  return BASH_WRITE_INDICATOR_REGEX.test(segment)
    || INLINE_EDIT_INDICATOR_REGEXES.some((re) => re.test(segment));
}
```

即可自动获得同段共现语义——不需要改动 `resolveFeatureDirCandidate` 的循环结构，也不需要重新实现分段逻辑。
这是本规划刻意把"写指示符判定"与"分段/共现循环"解耦为两个独立职责的直接收益。

### 改名跟随（`applyRename`）在 F224 落地后应如何按段处理（方向，不实现）

`mv src dst` / `git mv src dst` 本质是"用新路径替换候选"，与"写入判据"是两类不同的信号，不应该塞进
`hasBashWriteIndicator`。建议方向：

- 新增一个独立的逐段谓词/抽取函数（如 `detectBashRename(segment)`，返回 `{from, to}` 或 `null`），同样运行在
  `splitBashSubcommands` 产出的**每个 segment** 上，而不是对整条命令做一次性扫描——这样可以避免"某段 `mv`
  与另一段 artifact 提及"发生与本 Feature Root Cause 同构的跨段误关联问题。
- from/to 参数的解析（含 `-f` 等 flag 跳过、`mv src dst` 与 `git mv src dst` 语序差异）留给 F224 自己的 plan
  设计；本 Feature 只负责保证 `splitBashSubcommands` 是复用友好的（同一文件内可直接调用，即便保持私有）。

### 两侧谁先落 master，另一侧 rebase 的具体动作清单

**场景 A：本特性（F225）先落 master**（当前更可能的顺序）

1. F224 worktree 执行 `git fetch origin master` + `git rebase master`。
2. 解决 `fix-compliance-core.mjs` 冲突：保留 F225 引入的 `splitBashSubcommands` / `hasBashWriteIndicator` /
   逐段循环结构；F224 只需在 `hasBashWriteIndicator` 内部并入 `INLINE_EDIT_INDICATOR_REGEXES` 判定分支
   （上述"单点合并位"），不再需要（如果曾经实现过）自己那一份整条命令级判定。
3. 若 F224 已经写了自己的复合命令测试用例，需要重新过一遍：确认这些用例本来就该受益于同段共现收紧，
   逐条核对是否仍然成立（多数应该是"更严格地成立"，因为 F225 关闭的洞是 F224 测试用例的上位问题）。
4. 若 `applyRename` 已实现，评估是否需要按上一节方向重构为逐段处理；若尚未实现，直接在新基线上按方向实现。
5. 重跑 F224 全部相关测试 + 全量 `npm run test:plugins`，确认 C-2 六条断言、F225 新增复合命令用例、F224 新增
   断言三方均保持绿。

**场景 B：F224 先落 master**（低概率，F224 plan.md 已声明把本缺陷推迟给后续 Feature，但仍需覆盖该分支）

1. 本特性 worktree 执行 `git fetch origin master` + `git rebase master`。
2. 解决冲突：以 F224 落地后的 `BASH_WRITE_INDICATOR_REGEX` / `INLINE_EDIT_INDICATOR_REGEXES` 为基础实现
   `hasBashWriteIndicator`，即直接 `||` 两者，而不是只用 `BASH_WRITE_INDICATOR_REGEX`。
3. 若 F224 在未修复本缺陷的前提下已经落了自己的"整条命令级"复合判定逻辑，需要把它替换/收编进本特性的
   `splitBashSubcommands` 逐段循环里，不保留两套并行判定。
4. 若 F224 已落地 `applyRename`，评估其是否也存在与本 Feature Root Cause 同构的跨段误关联洞（整条命令级
   判定 vs 逐段判定），若存在则本特性 rebase 时一并纳入修复范围（因为 Root Cause 相同，属于同一次改动的
   自然延伸，不是范围蔓延）。
5. 重跑全量测试确保两侧断言（C-2 六条 + F224 断言 + 本特性新增用例）全绿。

两个场景均强调：**不猜测 F224 未提交代码的具体实现**（当前不可见），rebase 时以到手的实际 diff 为准，
上述只是接口层面的合并预期，具体冲突解决以当时代码为准。

## 验证方案

### 复现命令（回归前必须先复现）

```bash
node -e "
import('./plugins/spec-driver/scripts/lib/fix-compliance-core.mjs').then(({ resolveFeatureDirCandidate, normalizeTranscriptEntry }) => {
  const bash = (command) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, 1, false);
  const user0 = normalizeTranscriptEntry({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }, 0, false);
  for (const cmd of [
    'echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md',
    'echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md',
    'echo x > /tmp/y || cat specs/999-fix-decoy/fix-report.md',
  ]) {
    console.log(cmd, '=>', resolveFeatureDirCandidate([user0, bash(cmd)], 0).path);
  }
});
"
```

修复前预期（复现）：三条均输出 `specs/999-fix-decoy`（劫持）。
修复后预期（验收）：三条均输出 `null`。

### 单元测试（tasks 阶段落地，本规划仅列清单，不在本次改动测试文件）

在 `codex C-2` describe 块新增：

| 用例 | 命令 | 期望 |
|------|------|------|
| 正向-负向共现（`;`） | `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md` | `null`（R2） |
| 正向-负向共现（`&&`） | `echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md` | `null`（R3） |
| 正向-负向共现（`\|\|`） | `echo x > /tmp/y \|\| cat specs/999-fix-decoy/fix-report.md` | `null`（R4） |
| 同段共现仍提名（`&&`） | `echo x > /tmp/y && echo body > specs/300-fix-real/fix-report.md` | `specs/300-fix-real` |
| 换行拼接负向共现 | `echo x > /tmp/y\ncat specs/999-fix-decoy/fix-report.md` | `null` |
| `\|\|` 不被误切为 `\|` | 已被 R4 覆盖，另加纯管道读形态 `cat specs/999-fix-decoy/fix-report.md \|\| true` 确认无写指示符时仍不提名 | `null` |

新增用例**只增不改**，C-2 既有 6 条断言（L515-543）逐字保留，作为回归红线。

### 验证命令清单

```bash
npm run test:plugins        # 全量插件测试，含 fix-compliance-core.test.mjs
npx vitest run               # 仓库级全量单测（若适用）
npm run build                 # 类型检查
```

验收标准：`npm run test:plugins` 全绿（既有 552 pass 基线 + 本次新增用例），C-2 六条硬化断言逐字不变且通过，
上述「复现命令」修复后三条均输出 `null`，且 C1（纯读对照）与 C2（同段真写对照）行为不变。

## 未决/已知限界（不在本次处理范围）

> 本节经 Codex 对抗审查（W-1/W-2/W-3）实证修订：原列的「反斜杠续行漏提名」已在**第 2 轮实现中修复**，
> 不再是限界；另新增 2 条此前未记录的限界。所有仍开放的限界均已在
> `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 以带「已知限界」字样的用例钉死当前行为。

| # | 限界 | 危害方向 | 处置 |
|---|------|---------|------|
| 1 | 裸 `\|`（管道）/ `&`（后台）不作为段分隔符 | 理论上可构造跨"管道段"的背书 | 待复现证实后另开 Feature（§1 已论证纳入的误杀代价） |
| 2 | `$( ... )` **动态生成的重定向目标**不被识别 —— `cat > "$(true; printf 'specs/NNN-fix-x/fix-report.md')"` → `null` | **漏提名（偏严）** | 钉死为「已知限界」用例；根治需 shell 语法级解析 |
| 3 | `ARTIFACT_PATH_REGEX` 只判"路径文本出现"，不判"该路径是否为重定向目标" | 取值可能落在非真实写入路径 | 既有更底层局限，非本次 Root Cause |
| 4 | Shell 注释 `#` 语义不识别 | 既有且中性 | 非本次 Root Cause |
| 5 | `BASH_WRITE_INDICATOR_REGEX` 不认 `cp` / `install` / `mv` 等写形态 —— 这类段不合格，候选回退到前一个合格段 | **漏提名（偏严）**，见 §4.1 劣化行 | 钉死为「已知限界」用例；补全写形态集合需独立评估（会放宽判据） |
| 6 | `unfoldLineContinuations` 不感知 quoted heredoc（`<<'EOF'`）—— body 内行尾反斜杠在真实 shell 中是字面量，这里仍被当作续行消解，把 body 两行**并段** | 合并方向（理论上可能放宽） | 主编排器 21,296 + Codex 5,488 样本穷举均未触发新增提名；根治需 heredoc-aware 词法解析 |

- F224 的两条「已知限界」断言在本仓库尚不存在，无法在本轮改写；由先落 master 的一方之后 rebase 时处理
  （见 §合并预案）。
