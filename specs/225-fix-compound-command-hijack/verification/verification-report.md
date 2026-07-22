# 验证报告

**特性**: 225-fix-compound-command-hijack
**模式**: fix（快速问题修复，轻量验证路径，4a/4b 审查清单并入本报告）
**基线**: `7b0d7b3`（origin/master）
**验证时间**: 2026-07-22

## A. 工具链验证

### A1. `npm run test:plugins`

```
ℹ tests 565
ℹ suites 117
ℹ pass 565
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

结果：**PASS**。565 = 基线 552 + 本次新增 13（T001-T013），与 tasks.md T020 验收标准逐字吻合。

### A2. `npx vitest run`

```
Test Files  1 failed | 467 passed | 4 skipped (472)
     Tests  1 failed | 5481 passed | 18 skipped | 21 todo (5521)
```

唯一失败：`tests/integration/graph-quality-adversarial.test.ts` > `test-export-orphan.json：符合测试文件模式的 zero-degree 节点归类为 test-export`，报错 `SyntaxError: Unexpected end of JSON input`（`runCLI` 子进程 stdout 被截断，非本次改动相关文件）。

隔离复测：

```
npx vitest run tests/integration/graph-quality-adversarial.test.ts
 ✓ |integration| tests/integration/graph-quality-adversarial.test.ts (19 tests) 4546ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

隔离运行 19/19 全绿，证明是全量并行负载下的子进程 flaky（该测试文件与本次改动的两个文件 `fix-compliance-core.mjs` / `fix-compliance-core.test.mjs` 无任何依赖关系，`git diff` 未触及 graph-quality CLI 或其消费的任何模块）。判定：**非本次改动引入的回归**，与仓库已知的并行负载 flaky 模式一致（见 memory: `project_cli_e2e_version_flaky_load.md` 同类根因）。

结果：**PASS（含 1 项已定性为并行负载 flaky、隔离复测绿的无关失败，不阻断）**。

### A3. `npm run build`

```
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> tsc
[postbuild:stamp] 盖章: commit=7b0d7b37 (dirty)
```

结果：**PASS**（`tsc` 类型检查零错误，退出码 0）。

### A4. `npm run repo:check`

退出码：`0`（`EXIT_CODE=0` 实测确认）。80 条门禁全部 `pass`，唯一一条非 pass：

```
graph-quality:freshness: warn
  - [graph-quality] 图产物记录的 sourceCommit（23ffc8f...）与当前 HEAD（7b0d7b3...）不一致（commit 级 stale），请重新建图。
```

核实：**该 warn 是唯一 warn，且退出码为 0**。该 warn 与本次改动无因果关系（本次未触及任何图产物或 graph-quality 相关代码），属预存陈旧图状态（`sourceCommit=23ffc8f` 早于当前 HEAD `7b0d7b3`），符合运行时上下文预告。**未发现其它新增 warn/fail**。

结果：**PASS**。

### A5. `npm run release:check`

```
Release contract valid (contracts/release-contract.yaml)
```

结果：**PASS**。

---

## B. 验证证据核查（反 over-claim）

### B1. 红→绿证据链：T001-T013 与测试文件逐条对应

`plugins/spec-driver/tests/fix-compliance-core.test.mjs` L545-612（`codex C-2` describe 块内 6 条既有断言之后）：

| Task | 用例标题（逐字） | 命令 | 期望 | 文件行号 | 核对 |
|---|---|---|---|---|---|
| T001 | 复合命令 `;` 分隔：写段与读段跨段不再互相背书 → 不提名 | `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md` | `null` | L547-550 | ✅ |
| T002 | 复合命令 `&&` 分隔：写段与读段跨段不再互相背书 → 不提名 | `echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md` | `null` | L552-555 | ✅ |
| T003 | 复合命令 `\|\|` 分隔：写段与读段跨段不再互相背书 → 不提名 | `echo x > /tmp/y \|\| cat specs/999-fix-decoy/fix-report.md` | `null` | L557-560 | ✅ |
| T004 | 复合命令换行分隔：写段与读段跨段不再互相背书 → 不提名 | `echo x > /tmp/y\ncat specs/999-fix-decoy/fix-report.md` | `null` | L562-565 | ✅ |
| T005 | 混合分隔符 4 段、写段与读段不相邻 → 不提名 | `echo x > /tmp/y; echo mid1; echo mid2; cat specs/999-fix-decoy/fix-report.md` | `null` | L567-570 | ✅ |
| T006 | 写段在后、读段在前 → 不提名 | `cat specs/999-fix-decoy/fix-report.md && echo x > /tmp/y` | `null` | L572-575 | ✅ |
| T007 | tee 写指示符跨段（管道内 tee 与读路径分居 `;` 两侧）→ 不提名 | `cat specs/999-fix-decoy/fix-report.md; echo x \| tee /tmp/y` | `null` | L577-580 | ✅ |
| T008 | heredoc 写指示符与 artifact 路径分居不同子命令段 → 不提名 | `cat <<EOF > /tmp/y\nbody\nEOF; cat specs/999-fix-decoy/fix-report.md` | `null` | L582-585 | ✅ |
| T009 | 同段重定向写 → 仍提名 | `echo body > specs/300-fix-real/fix-report.md` | `specs/300-fix-real` | L589-592 | ✅ |
| T010 | 复合命令中同段写（mkdir 前段 + heredoc 写段同段共现）→ 仍提名 | `mkdir -p specs/300-fix-real && cat > specs/300-fix-real/fix-report.md <<EOF...EOF` | `specs/300-fix-real` | L594-597 | ✅ |
| T011 | 前段无关写 + 后段同段真写，跨段不互相污染，取最后 → 提名后者 | `echo x > /tmp/y; echo body > specs/301-fix-later/fix-report.md` | `specs/301-fix-later` | L599-602 | ✅ |
| T012 | 两段各自同段写不同特性目录 → 取最后出现者（后者） | `echo a > specs/300-fix-real/fix-report.md; echo b > specs/301-fix-later/fix-report.md` | `specs/301-fix-later` | L604-607 | ✅ |
| T013 | Bash 同段写 verification-report.md → 提名其特性目录前缀 | `echo v > specs/304-fix-v/verification/verification-report.md` | `specs/304-fix-v` | L609-612 | ✅ |

13/13 全部存在、命令与期望值均与 tasks.md 测试矩阵表逐字一致，无遗漏、无偷工（未发现用弱断言或 `.skip` 规避的用例）。

### B2. C-2 硬化断言零改动

```
git diff -U0 plugins/spec-driver/tests/fix-compliance-core.test.mjs | grep -c '^-[^-]'
0
```

实测输出 `0`——测试文件 diff 为纯新增，无任何删除行。逐字比对 L515-543（改动前）与当前文件 L515-543：6 条 `it(...)` 标题、命令字符串、`assert.equal` 期望值均逐字未变（Read 工具实测确认）。**核实通过**。

### B3. 复现闭合（node 直调实测）

```
echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md => null
echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md => null
echo x > /tmp/y || cat specs/999-fix-decoy/fix-report.md => null
cat specs/999-fix-decoy/fix-report.md => null
echo body > specs/300-fix-real/fix-report.md => specs/300-fix-real
```

R2/R3/R4 均输出 `null`（修复前 fix-report.md 记录三者均为 `specs/999-fix-decoy` ❌ 劫持），修复后**劫持已消除**。C1（纯读对照）`null` 不变，C2（同段真写对照）`specs/300-fix-real` 不变。**四项行为均与 fix-report.md / plan.md / tasks.md T022 验收预期完全吻合**。

### B4. 签名/导出面零漂移

- `resolveFeatureDirCandidate(entries, anchorLineIndex)` 签名未变；返回形状仍为 `{ path: candidate }`（L329 `return { path: candidate };`）。
- `git diff` 中无任何 `export` 增减行；`ARTIFACT_PATH_REGEX`（L50）与 `BASH_WRITE_INDICATOR_REGEX`（L53）两个常量的正则字面量与 `export` 关键字均未出现在 diff 中——`grep -E 'BASH_WRITE_INDICATOR_REGEX =|ARTIFACT_PATH_REGEX ='` 对 diff 结果为空，证明这两行未被触及。
- `git diff origin/master -- plugins/spec-driver/scripts/fix-compliance-judge.mjs` 输出行数为 `0`，**该文件零改动**，与 plan.md「不涉及」清单一致。

结果：**零漂移，核实通过**。

---

## C. 轻量合并审查清单（4a/4b 职责并入）

### [Spec 合规]

- **修复与 Root Cause 一致性**：**PASS**。fix-report.md 的 Root Cause 明确诊断为"写指示符门禁与 artifact 路径扫描共用整条命令文本作为判定单位，未要求共现于同一子命令"；实现（`splitBashSubcommands` + `hasBashWriteIndicator` + 逐段循环）精确对应这一诊断，未偏离。
- **是否引入未覆盖的行为变化 / spec 未定义的公共 API**：**PASS，无 CRITICAL**。两个新增函数（`splitBashSubcommands` / `hasBashWriteIndicator`）均为模块私有（未 `export`，实测 diff 无 `export` 新增行），符合 plan.md §5「保持模块私有」的决策与 tasks.md T015/T016 的完成判据。`resolveFeatureDirCandidate` 是唯一公开行为面变化点，其判定**收紧**（更严格要求同段共现），不新增判定路径、不改变枚举值或返回形状。
- **既有 spec 是否需要同步更新**：复核 fix-report.md「无需更新」判定——**成立**。`specs/208-fix-mode-process-compliance/` 的 FR-007 语义描述的是"提名必须锚定 artifact 路径 + 写指示符"这一意图层判据，本次修复只是让**实现**回归该意图（修正判定粒度的 bug），未改变 FR-007 定义的判据语义本身，也未新增/移除任何 FR。判定合理，不需要修改 208 的 spec.md。

### [代码质量]

- **改动最小且聚焦根因**：**PASS**。全部改动收敛在 `resolveFeatureDirCandidate` 函数体 + 两个紧邻的新增私有 helper，Write/Edit 分支与 `scanArtifactPath` 定义未被触碰（Read 源码实测确认 L318 Write/Edit 分支逐字未变）。
- **命名与注释**：**PASS**。`splitBashSubcommands` / `hasBashWriteIndicator` 命名准确表达行为；JSDoc（L257-296）用中文说明「同段共现」判据的 why（背书绕过 FR-007 判定窗口的危害），并引用 fix-report.md R2-R4 作为背景，符合"注释说明 why 而非 what"的仓库约定。
- **遗留调试代码/死代码**：**未发现**。
- **新增测试真实覆盖度**：**PASS**。13 条新用例覆盖 4 种分隔符（`;`/`&&`/`\|\|`/换行）× 跨段负向、多段混合、顺序反转、`tee`/heredoc 边界、以及 5 条同段/跨段正向回归（含"两段各写不同目录取最后者"这一语义等价性验证），非仅 happy path。
- **安全隐患专项——新判据是否可能被新构造绕过**：

  | 边界 | 结论 | 理由 |
  |---|---|---|
  | `\r` 单独出现（无 `\n`，即老式 Mac 换行 `\r`） | **可利用（低风险）** | `SUBCOMMAND_SPLIT_REGEX = /&&\|\\|\\|;\|\r?\n/g` 中的 `\r?\n` 要求 `\r` 后必须紧跟 `\n` 才匹配；若攻击者构造纯 `\r`（无 `\n`）分隔的命令文本，不会被切分，写段与读段仍在同一段内——但这只会让判据**更宽松地保留原有整条命令判定行为**（即退化为改造前状态，不构成"新引入"的洞，而是这条边界未被本次改动关闭）。危害方向：中性偏可用性（不切分=更严格要求写段与读段仍需共现文本，但由于二者本就在同一未切分段内，会被误判为共现→**属于误提名而非漏提名**，即理论上比"跨段不再背书"这一目标弱化，但仍不劣于修复前的全局状态）。**结论**：该边界是残留面而非新回归；实际攻击价值低（Bash tool_use 的 `input.command` 由 Claude Code harness 序列化生成，正常 shell 脚本极少使用孤立 `\r` 作为分隔符）。建议记入已知限界，不阻断本次交付。
  | Unicode 行分隔符 U+2028/U+2029 | **不可利用** | 同上分析：这些字符不被 `SUBCOMMAND_SPLIT_REGEX` 识别为分隔符，不会被切分，退化为"整条未切分文本"，与孤立 `\r` 同理——不构成新回归，是既有正则表达式设计范围外的字符集，且 shell 命令文本中出现这些字符的概率极低，不构成现实攻击面。
  | 反斜杠续行（`\` + 换行） | **不可利用（已被 plan.md §6#1 记录为已知限界，方向正确）** | 换行仍会被切分（`\r?\n` 命中），导致本应视为同一逻辑行的续行被错误拆段——**效果是"漏提名"（本应同段共现的合法写入未被提名），不是"误提名"**。危害方向是**更严**（可用性问题），不是安全回归。核实通过：plan.md 对该边界的定性准确。
  | Shell 注释 `#` | **不可利用（既有限界，非本次引入）** | 正则判据不做 shell tokenizer 级解析，`#` 后文本仍参与判定；但这一限界在改造前后同样存在（改造前是整条命令级判断，`#` 问题同样存在），不是本次切分逻辑新引入的洞。
  | 裸 `\|` / `&`（管道/后台变体） | **理论可利用，已被 plan.md 显式记录为已知限界待后续 Feature** | 例如 `echo x > /tmp/y | cat specs/999-fix-decoy/fix-report.md`（管道变体）不会被现有正则切分为两段，若整条文本同时含写指示符与 artifact 路径，仍可能被今日实现判定为"同段"从而误提名。**这是本次修复未完全关闭的原始漏洞面的一个子集**——fix-report.md 的复现矩阵 R1-R4 未覆盖裸管道形态，plan.md §1 已做出"不纳入，因无法用现有事实验证是否真实关闭"的显式取舍，且该风险在**修复前（整条命令判定）与修复后（同段判定但不拆裸管道）状态下危害程度相同或更低**（因为修复后至少 `;`/`&&`/`\|\|`/换行分隔的场景已被关闭，攻击面已经收窄，只是未收窄到 100%）。**结论**：不构成"新回归"，是已知残留面，已被诚实记录，不建议在本次范围内扩大改动。

  **总体安全隐患判定**：**WARNING（非 CRITICAL）**——所有识别到的边界均为「危害方向不劣于修复前」或「已被 plan.md 显式记录为已知限界」，未发现任何新构造能把攻击面**扩大**到修复前不存在的状态。裸 `\|`/`&` 变体建议后续独立 Feature 处理（plan.md 已如此建议）。
- **跨模块一致性**：**PASS**。`fix-compliance-judge.mjs:128` 唯一调用点依赖的签名与 `{path}` 返回形状均未变（B4 已核实零改动）；`fix-compliance-execution-record.mjs` / `fix-compliance-io.mjs` 未被触及，plan.md「不涉及」清单成立。

---

## D. 已知限界复核（危害方向评估）

| # | 限界 | plan.md 定性 | 本次复核结论 |
|---|---|---|---|
| 1 | 反斜杠续行漏提名 | 影响可用性，不处理 | **确认为"更严"方向**：本应同段共现的合法写入被错误拆段，导致漏提名（诚实用户体验受损），不放大安全面。**非安全回归**。 |
| 4（plan 编号）| Shell 注释 `#` 语义不识别 | 既有限界，非本次引入/关闭 | **确认"既有且中性"**：改造前后判定粒度不同（整条 vs 子命令段），但注释内容是否参与判定这一维度未被本次改动改变——若写指示符恰好出现在注释里，仍可能被段级判定误判为"该段含写指示符"，**这一风险在改造前后同等存在**（改造前是整条命令扫描同样不识别注释，改造后是子命令段扫描同样不识别注释），危害程度未被本次改动放大也未被缩小。**非本次引入的安全回归**。 |
| 5（plan 编号）| `ARTIFACT_PATH_REGEX` 不判断真实写入目标（字面量误提名） | 既有更底层局限，不在本次 Root Cause 范围 | **确认为既有限界**：该风险与"跨段背书"这一 Root Cause 正交，改造前后同等存在，不属于本次范围内的回归。 |
| 6（plan 编号）| 裸 `\|`/`&` 变体劫持 | 待复现证实后另开 Feature | **确认"收窄但未完全关闭"**：`;`/`&&`/`\|\|`/换行四种复合形态的劫持已被本次修复关闭（B3 复现实测证实），裸管道/后台变体的理论劫持面**在修复前后同等存在**（未被本次改动引入，也未被关闭）。危害方向未恶化，是诚实记录的残留面。**建议**：与 C 节裸 `\|`/`&` 分析一致，非 CRITICAL，适合另开 Feature 处理。 |

**未发现任何一条限界实际是"危害方向更宽松（新增安全回归）"**。全部 4 条限界要么方向"更严"（漏提名，可用性问题），要么是"既有且中性"（未被本次改动放大或缩小），符合 plan.md 的自我诚实记录。

---

## 总体判定

**READY-FOR-DELIVERY**

- Layer 1（Spec-Code 对齐）：修复与 fix-report.md Root Cause 一致，13/13 新增用例逐条对应 tasks.md T001-T013，无遗漏。
- Layer 1.5（验证铁律合规）：**COMPLIANT** —— 本报告全部结论基于实际执行命令的输出（`npm run test:plugins` / `npx vitest run` / `npm run build` / `npm run repo:check` / `npm run release:check` / `node` 直调复现 / `git diff` 实测），无推测性表述。
- Layer 2（原生工具链）：build ✅、test ✅（1 项已定性隔离复测绿的无关 flaky）、lint（无独立 lint 脚本，由 `tsc` 类型检查与 `repo:check` 覆盖）、repo:check ✅（唯一 warn 为预存陈旧图，与本次改动无因果）、release:check ✅。
- 无 CRITICAL 发现。安全隐患专项识别到裸 `\|`/`&`、`\r` 孤立换行等残留面，均为 plan.md 已诚实记录或危害方向不劣于修复前的既有限界，不阻断交付。

## CRITICAL/WARNING 汇总

- **CRITICAL**：无
- **WARNING**：
  1. 裸 `\|`/`&` 变体理论上仍可劫持（未被本次修复关闭，plan.md 已显式记录为已知限界，建议另开 Feature）
  2. 孤立 `\r`（无 `\n`）/ Unicode U+2028/U+2029 行分隔符不被识别为分隔符，退化为整条命令判定（危害方向中性，非新回归，未被 plan.md 逐字列出但已在本报告 C 节补充分析）
- **INFO**：`npx vitest run` 全量并行下出现 1 项 `graph-quality-adversarial.test.ts` flaky（隔离复测 19/19 绿，与本次改动文件无依赖关系，非回归）

---

# 附录 E · 第 2 轮：Codex 对抗审查处置与主线程独立复核

> 本节由**主编排器亲自**执行与撰写（不委派）。上文 A-D 为第 1 轮实现后的验证；本节记录 Codex
> 对抗审查（仓库 `CLAUDE.local.md` 规定的提交前硬门禁）的发现、处置与复验。

## E1. Codex 审查执行情况（含一次被拒）

| 轮次 | 提示词取向 | 结果 |
|------|-----------|------|
| 第 1 次 | 要求"构造能绕过门禁的命令" | **被 Codex 供应商侧内容策略拦截**（判为潜在网络安全风险），本轮无结论产出 |
| 第 2 次 | 改为"重构正确性 / 回归等价性审查"，不索取攻击载荷 | 正常完成，产出完整分档结论 |

第 1 次被拒后**未采取任何伪装或规避手段**，而是把请求收敛到本次真正需要的问题（行为等价性与回归），
这既符合供应商策略，也足以覆盖验收所需——安全方向的结论改由主编排器的穷举实测承担（见 E3）。

## E2. 发现与处置

Codex 结论：**CRITICAL 0 条**；集合单调性经其独立穷举 5,488 输入验证，`old===null && new!==null` **0 条**。

| 编号 | 发现 | 判定 | 处置 |
|------|------|------|------|
| W-1 | 反斜杠续行把写指示符与 artifact 路径拆到两段 → 合法写入漏提名（`printf 'body' > \⏎specs/…/fix-report.md`、`tee \⏎<path>` 两种形态） | **真实回归（本次改动引入）** | ✅ **已修**：新增 `unfoldLineContinuations`，切段前消解 `\`+换行；`\\`（字面反斜杠）经 alternation 先行吞掉，不误判 |
| W-2 | §4.1 只列"改善/中性"，遗漏**劣化**类别（`cp` 写入段不被识别 → 候选回退到前一个合格段） | **文档缺陷（真实）** | ✅ **已补**：plan.md §4.1 增补劣化行与完整差异类别论证 |
| W-3 | 13 条新增用例未覆盖实测到的 false negative，也无候选取值差异用例 | **测试覆盖缺口（真实）** | ✅ **已补**：追加 12 条（9 正向回归防护 + 1 取值差异 + 2 条「已知限界」钉死） |
| CRITICAL 区建议 | "保序划分"不足以证明**任意**匹配器单调，需补充"段内匹配必然是原串匹配"的前提 | **论证严密性（真实）** | ✅ **已补**：plan.md §4.1 增加措辞订正与未来引入锚点/环视时须重新论证的告警 |
| INFO-1 | `SUBCOMMAND_SPLIT_REGEX` 的 `/g` 对 `String.split` 冗余 | 可读性 | ✅ 已移除 `/g`，并改名 `SEGMENT_SPLIT_REGEX` |
| INFO-3 | `splitBashSubcommands` 命名/注释过强（实为不感知语法的文本切分） | 命名准确性 | ✅ 已改名 `splitCommandTextSegments`，注释如实声明非语法级解析 |
| INFO-2 | Codex 沙箱内 `npm run test:plugins` 因只读沙箱禁止 `mkdtemp` 报 EPERM | **非本次代码失败** | 主编排器在真实环境复跑 577/577 全绿（见 E4） |

新识别但**不修**的限界（`$()` 动态重定向目标、`cp`/`install` 类写形态、quoted heredoc 内行尾反斜杠）
已全部写入 plan.md「未决/已知限界」表，并以带「已知限界」字样的测试用例钉死当前行为。

## E3. 主线程独立复核（不依赖任何子代理结论）

穷举 11 类命令原子 × 3 段 × 4 种分隔符 = **21,296 个输入**，复刻旧实现做逐条对照：

```
样本=21296  单调性违规(旧null→新提名)=0  取值差异=1720
✅ 单调性成立：提名面未扩大
```

定点复核：

| 检查 | 结果 |
|------|------|
| `;` / `&&` / 换行 跨段劫持 | 均 `null` ✅ |
| **劫持 + 续行组合**（确认 R-1 修复未把劫持重新打开） | `null` ✅ |
| 重定向目标续行 / `tee` 目标续行 | 均正确提名 ✅ |
| 字面 `\\` 结尾后换行**不**被当作续行 | `null` ✅ |

## E4. 第 2 轮全量门禁（主线程实跑）

| 命令 | 结果 |
|------|------|
| `npm run test:plugins` | **577 pass / 0 fail**（基线 552 + 第 1 轮 13 + 第 2 轮 12） |
| `npm run build` | exit 0，`tsc` 零错误 |
| `npm run repo:check` | exit 0，唯一 warn 为预存 `graph-quality:freshness`（图产物 sourceCommit=23ffc8f 落后于 HEAD=7b0d7b3，与本次改动无因果） |
| `npm run release:check` | Release contract valid |
| `npx vitest run` | 5481 pass / **1 fail** —— 见下方 flaky 说明 |

**关于 `npx vitest run` 的 1 项失败**：两次全量运行失败的是**不同**测试
（第 1 次 `tests/integration/graph-quality-adversarial.test.ts`，第 2 次 `tests/panoramic/community-analysis.test.ts`），
两者隔离复跑均全绿（19/19、4/4，后者 5.06s 远低于 30s 阈值）。失败对象在运行间漂移是**负载相关 flaky**
的典型特征，而非确定性回归；且 `vitest.config.ts` 的 include 根本不含 `plugins/**`，本次改动的两个文件
**不会被 vitest 加载**，因果上不可能由本次改动引起。二者均与仓库既有 flaky 记录一致。

## E5. 第 2 轮总体判定

**READY-FOR-DELIVERY** —— Codex 发现的 1 项真实回归（W-1）已修复并补测；3 项文档/测试缺陷已补齐；
2 项可读性建议已采纳。集合单调性由主编排器与 Codex 两套独立穷举各自确认为 0 违规。
