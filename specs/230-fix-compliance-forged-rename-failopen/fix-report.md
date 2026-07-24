# 问题修复报告（F230）

## 问题描述

fix 依从性门禁（Stop hook → `fix-compliance-judge.mjs`）的 F224 fail-open 降级通道可被 transcript 中**伪造的 `mv` 文本**触发。一个坍塌会话只需三步即可静默 exit 0 放行，不需要任何真实制品、不需要任何目录存在：

1. 一次 `Write` 提名 `specs/300-fix-decoy/fix-report.md`（文件可以根本没写成功）
2. 一次 verify 类委派
3. 一条**注释掉的假 mv**：`Bash: true # mv specs/300-fix-decoy specs/renamed-nonstandard`

本缺陷是 F227 流程中由 Codex 对抗审查暴露、经编排器实测确认的**既有缺陷**，F227 已在其 fix-report「已知限界二」中如实记录并另开跟进项（即本 F230）；F227 不引入、不修复、也不使其更易触发。

### 实测差分矩阵（当前 master `ff78417` 源码 · 空 project-root · `--mode report`）

统一前缀：fix 展开锚点 + `Write specs/300-fix-decoy/fix-report.md` + 1 次委派，仅末条 Bash 与委派类型不同。

| 构造 | 末条 Bash / 委派 | 实测输出 | 门禁结果 |
|------|------------------|----------|----------|
| **A 注释假 mv** | `true # mv specs/300-fix-decoy specs/renamed-nonstandard` | `transcriptDiagnostics` 为 `feature-dir-unresolvable` | **exit 0 静默放行（缺陷）** |
| **B 去掉该 Bash** | 无 | `compliant:false`，missing 为 feature-dir 与 fix-report.md | exit 2 硬阻断（正确） |
| **C 真实 mv** | `mv specs/300-fix-decoy specs/renamed-nonstandard` | 同 A | exit 0（F224 合法降级，须保住） |
| **D 引号内 mv** | `echo 'mv specs/300-fix-decoy specs/renamed-nonstandard'` | 同 A | **exit 0 静默放行（同根因第二向量）** |
| **E 仅 implement 委派 + 真实 mv** | 委派改为 implement，零 verify 类 | 同 A | **exit 0 静默放行（第二层缺陷）** |

A 与 B 的唯一差异是那一条被注释掉的 mv 文本 —— 这直接证明「伪造 mv 文本」本身就是放行开关。
A 与 C 的唯一结构差异是 `#` 注释符 —— 这直接证明**唯一能区分伪造与合法的判据在词法层**。

### 复现命令

```bash
node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode report \
  --transcript-path /tmp/bypass.jsonl --project-root "$EMPTY_DIR"
```

构造脚本见 `specs/230-fix-compliance-forged-rename-failopen/plan.md` 附录。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 伪造的 mv 文本为何能让门禁静默 exit 0？ | `fix-compliance-judge.mjs:173` 判定 `featureDirUndetermined` 且存在收口委派时**整条 return**，`verdict` 为 null，只带出 `feature-dir-unresolvable`；`runHook:357` 见到该诊断即 `return 0` |
| Why 2 | 一条判定诊断为何会走到 fail-open 出口？ | 它被塞进了 `transcriptDiagnostics` 字段 —— 该字段原本的语义是「transcript 不可读 / 超限」即**判定能力整体失效**（FR-013）。判定层的单维度不确定复用了这条能力失效通道，于是继承了它的无条件放行 |
| Why 3 | 为何会判 `featureDirUndetermined`？ | `resolveFeatureDirCandidate` 跟随了注释里的假 mv，`trackedDir` 被带到 `specs/renamed-nonstandard`，不满足 `FIX_DIR_NAME_REGEX` → `syncCandidateFromTrackedDir` 置 path 为 null、ambiguous 为真 |
| Why 4 | 为何注释里的 mv 会被当成真实改名？ | `RENAME_COMMAND_SEGMENT_REGEX` 是纯词法匹配；分段只按换行与 `;` `&` `|` 切，`#` 注释与引号区**不参与切分**。core 自述该切分「不是语法级解析」，但该自述只被当作精度限界，未被当作**可被主动构造的放行开关** |
| Why 5 | 为何这条通道从未被判据兜住？ | F224 收窄时选的下界是「存在任一收口委派」（implement 或 verify 任一为正）。该下界**弱于两种收口形态各自合同的交集** —— repair 合同要求 verify 至少 1 次、no-op 合同要求核实类至少 1 次，二者交集是「必须有验证类委派」。取了并集当下界，等于把 implement-only 的坍塌也一并赦免 |

**Root Cause**：降级的**触发前提**由一段可被自由伪造的词法信号单独决定（注释 / 引号内的 mv 文本即可置位），而降级的**作用范围**又是整条判定短路（复用 FR-013 的能力失效通道）。一个可伪造的开关直接控制一条无条件放行通道，中间没有任何独立判据兜底。

**Root Cause Chain**：静默 exit 0 → `runHook` 把判定诊断当作能力失效放行 → 判定层单维度不确定被整条 return 升格为能力失效 → 该不确定由词法层跟随假 mv 产生 → 词法层不感知 `#` 与引号 → 且降级下界取了两收口合同的并集而非交集，无判据可兜。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L471-483 `applyRename` | 把 `mv` 当**关键字**匹配（段内任意位置），而非当**命令**匹配 | 在完整命令上做引号 / 转义感知的命令位扫描（`extractRenameCommandParams`），只认真正处于命令位的 mv |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | L171-178 | 降级下界弱于两种收口合同各自的要求 | 收窄为「必须存在验证类委派」：`roleClass` 为 verify 或 `noopVerify` 为真（不得附加排除项，见第 2 轮 W2） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `fix-compliance-core.mjs` `scanArtifactPath` 提名路径 | L460-469 | 同样不感知 `#` 与引号 | **有意不改**，且最终方案下该风险不存在：命令位锚定**不引入任何注释剥离逻辑**，提名侧逐字未动。（若走原扫描器方案则须小心 —— 提名侧剥注释会误伤 `echo "# 修复报告" > specs/NNN-fix-x/fix-report.md` 这类真实写法，吃掉整条路径造成误阻断） |
| `fix-compliance-core.mjs` heredoc body | L385 `splitCommandTextSegments` | heredoc 正文被按行切成独立段，正文里的 mv 会被跟随 | **本次不修**（记为已知限界）：正确处理需要真正的 shell 解析器，会动到 F224 已冻结的「复合命令内先写制品再改名」用例（该用例正依赖 heredoc 后的 mv 被跟随） |
| `fix-compliance-judge.mjs` `evaluate` L110 | transcript 诊断早退 | 真正的能力失效 | **安全**：transcript 读不到时确实无任何判据可跑 |
| `fix-compliance-judge.mjs` `evaluate` L120 | 非 fix 会话早退 | 零接触放行 | **安全**：不在门禁适用范围 |
| `fix-compliance-execution-record.mjs` L253 `ambiguous` | 执行证据配对歧义 | 同名不同物 | **安全**：语义为同 ID 重复 use，与目录解析无关 |
| `resolveFeatureDirCandidate` 的 path / ambiguous 语义 | L437-504 | F224/F225 冻结面 | **不得改动**：本次只在 `applyRename` 内部加前置过滤，对不含注释与引号的输入逐字等价 |

### 关于「制品存在性」方向的评估（已否决，不重蹈 F227 覆辙）

用「改名目标是否真实存在于磁盘」来证伪伪造 mv 的方向**不采纳**：F227 已实证该类方案连续三版被推翻，根因是 transcript 描述的是**历史事件序列**、磁盘给的是**终态快照**，改名跟随的前提恰恰是「被提名目录在终态已不存在」，二者混入同一状态机必然自相矛盾。本次沿用 F227 的结论，不把磁盘事实注入状态机。

同理，「降级时改用 trackedDir 直接读制品」也不采纳：F224 端到端用例（真实 `git mv` 到非规范名、磁盘上无任何制品）被显式钉为 exit 0 降级，任何要求「制品必须可定位」的方案都会把它翻成 exit 2，属新增误阻断。

### 同步更新清单

- 调用方：`fix-compliance-judge.mjs`（`resolveFeatureDirCandidate` 的唯一生产消费方）
- 测试：`fix-compliance-core.test.mjs`（新增改名侧 shell 上下文用例）、`fix-compliance-judge-cli.test.mjs`（新增 A/D/E 三条端到端反向回归 + C 正向保住）
- fixture：`plugins/spec-driver/tests/fixtures/fix-compliance/` 新增伪造改名 fixture + README 表格补行
- 文档：`applyRename` 与 `evaluate` 降级段的 JSDoc 契约说明（含 heredoc 已知限界）
- 类型定义：无（.mjs + JSDoc）

## 修复策略

> **方案演进说明**：原方案 A 第 1 层为「注释 / 引号扫描器」，已被 Codex 设计阶段对抗审查用具体反例推翻并由编排器实测替换为**命令位锚定**。下方记录的是最终采纳版本；被推翻的过程见「Codex 对抗审查处置」节。

### 方案 A（最终采纳）：改名识别锚定命令位 + 降级下界取两收口合同交集

**第 1 层 —— 改名识别只认命令位（关闭伪造开关）**

把 `applyRename` 的改名识别从「段内**任意位置**出现 `mv` 关键字」收紧为「`mv` / `git mv` 必须位于**命令位**」，且命令位判定**在完整命令文本上**做（不逐段）。

最终实现由两个纯函数 + 一处调用点重排构成：

- **`scanRenameCommandEvents(command)`**（新增导出）：在完整命令上单趟线性扫描，状态含单引号（内部无转义）、双引号、反斜杠转义、`#` 注释、重定向操作符（`>&` `<&` `&>`）。只有在**未被引用、未被转义、且不属于重定向**的控制操作符（`;` `|` `&` 换行，天然覆盖 `&&` `||`）之后或文本开头，才认为进入命令位；命令位上用 sticky 正则 `RENAME_COMMAND_NAME_REGEX` 试匹配**命令名本身**，参数文本由同一状态机继续扫描收集。返回 `{offset, paramText}[]`——带字符偏移是为了把事件归回所属段落。
- **`splitCommandTextSegmentSpans(command)`**（新增内部函数）：与 `splitCommandTextSegments` 同源分段，额外给出每段跨度。
- **主循环**：先在整条命令上扫出改名事件，再遍历段跨度，段内先 `scanArtifactPath` 提名、再应用**偏移落在本段内**的改名事件。

**判据只在改名识别这一路收紧**；`scanArtifactPath` / `splitCommandTextSegments` / `hasBashWriteIndicator` / `parseRenameOperands` / `SEGMENT_SPLIT_REGEX` / `unfoldLineContinuations` 逐字不动 → F225 同段共现语义与 F224 全部改名用例零影响。`resolveFeatureDirCandidate` / `judgeCompliance` 返回形状逐字不变。原 `RENAME_COMMAND_SEGMENT_REGEX` 切换后失去全部消费方，按仓库「删除死代码」约定一并删除（全仓穷举确认零引用）。

四条关键判断（后三条各由一轮对抗审查用具体构造推翻更弱的写法得来）：

1. **逐个伪造形态打补丁是打地鼠，必须换判据维度**。旧写法把 `mv` 当**关键字**而非**命令**，于是任何把 mv 当普通文本写出来的命令都会被误读为真实改名。
2. **命令位判定必须扫全命令，不能逐段**。第 1 轮实现用「段首锚定 + 引号字符奇偶配平」，被第 2 轮 Codex 审查用转义引号构造证伪：`splitCommandTextSegments` 不感知引号，引号内的 `;` 会把文本碎片切到后段段首冒充命令位，而碎片在段内看起来良构——**段级守卫在原理上不可行**。
3. **参数文本不能让正则一次吞掉**。第 2 轮实现的 sticky 正则连参数一并捕获，参数里的引号 / 转义因而不参与状态转移，被第 3 轮审查用 `mv src "dst;mv <候选> <非规范名>"` 证伪：引号内的 `;` 被当真实分隔符，凭空多识别一条改名。故参数改由同一状态机继续收集——**正则吞参数就会丢状态**。
4. **扫全命令与「段内先提名、再改名」的时序必须同时成立**。若为了拿到完整词法上下文而改成「先跑完所有段提名、再统一改名」，早于提名发生的改名会被倒灌到后来才出现的候选上（第 3 轮审查以 `mv A B; printf x > A/fix-report.md` 证伪）。带偏移扫出事件、再按偏移归段，是同时满足二者的解法。

落库实现实测：13 种伪造构造全部归零，9 种合法形态全部保留（含裸 `|` / `&` 两跳，恢复与改动前一致的行为），时序回归与 HEAD 一致。

**第 2 层 —— 降级下界收窄（结构性收口，可证明不产生误阻断）**

`evaluate` 中的 `hasClosureDelegation`（implement 或 verify 任一为正）改为「存在验证类委派」：`roleClass` 为 verify **或** `noopVerify` 为真。

可证明不误阻断：repair 合同要求 `counts.verify` 至少 1、no-op 合同要求 `noopVerifyCount` 至少 1；二者都不满足时，**无论制品落在哪个目录**该会话都不可能合规，故拒绝降级不会冤枉任何本可合规的会话。

判据形状由一条不变量定死：**降级下界必须被合规合同蕴含** —— 凡 `judgeCompliance` 可能判合规的委派构成，降级都必须放行，否则会出现「目录可定位时判合规、目录改名后却拒绝降级」的状态依赖不一致。故只能取两种收口合同各自要求的并集形式，不得附加额外排除项。

- `noopVerify` 分支不可省 —— canonical no-op 委派文案「交叉核实无需改动判定」实测 `roleClass` 为 other、`noopVerify` 为真，只查 `roleClass` 会误伤合法 no-op 收口
- `noopVerify` 分支也不可排除 implement —— 见下方第 2 轮 Codex 审查 W2（原设计中的排除项已被证伪并撤销）

同时把该分支的诊断与真正的「transcript 能力失效」在**注释与契约上**明确区分，说明它复用 `transcriptDiagnostics` 字段仅为保持既有落盘与 report 输出形状不变（F224 端到端用例已钉死该形状）。

### 方案 B（备选）：仅做第 1 层

只加改名侧过滤，不动降级下界。能通过用户给出的两条验收，但把 E（implement-only 零验证委派 + 真实改名）这条**已实测存在**的放行留在原地。不推荐。

## Codex 对抗审查处置（设计阶段）

Codex 子代理在 12 分 33 秒后异常终止（未产出完整报告），但其阶段性结论已给出两条高价值方向，编排器逐条独立复现核实：

| 编号 | Codex 结论 | 核实 | 处置 |
|---|---|---|---|
| C1 | 「新扫描器仍把未引用的 `mv` 参数文本当作命令」 | **成立且致命**。实测 `echo mv specs/900-fix-x specs/renamed-nonstandard`（既无注释也无引号）同样打开降级通道，比用户原始复现还少一个字符。原第 1 层设计（注释 + 引号扫描）对其零作用 | **原方案作废，换判据维度**：改为命令位锚定。7 种伪造构造（注释 / 单引号 / 双引号 / 裸参数 / 参数位 / 引号藏 `;` / 引号藏 `&&`）实测全部归零，6 种合法形态全部保留，既有 343 条测试零失败 |
| C2 | 「`noopVerify` 宽正则可让 `roleClass=implement` 的同一条委派满足新降级下界」 | **成立**。实测 `subagent_type: spec-driver:implement` + 描述含「确认」→ `roleClass` 为 implement 且 `noopVerify` 为真 | **采纳**：第 2 层判据补 `roleClass !== 'implement'` 排除项，并新增 E2 端到端反向用例钉住 |

未及给出结论的三项（其余绕过构造、提名侧不对称风险、`evaluate` 其余早退分支）由编排器自行补做：绕过构造已扩展为 7 条表驱动用例；提名侧不剥注释的论证经复核成立（`echo "# 修复报告" > specs/NNN-fix-x/fix-report.md` 是真实写法，剥注释会误阻断），且本次改为命令位锚定后**根本不再引入任何注释剥离逻辑**，该不对称风险自然消失；`evaluate` 其余两处早退（transcript 不可读、非 fix 会话）经复核为真正的能力失效与适用范围判断，不构成放行面。

实施后须对**实际 diff** 再跑一轮 Codex 对抗审查（仓库约定：commit 前必审）。

### 第 2 轮（对实际 diff 的对抗审查）

全部 4 条结论均由编排器独立复现后处置：

| 编号 | 档 | 结论 | 核实 | 处置 |
|---|---|---|---|---|
| C1 | CRITICAL | 转义引号可绕过 `hasUnbalancedQuotes` | **成立且致命**。`echo "a;mv <候选> <非规范名>\""` 与 `echo 'a;mv <候选> <非规范名>'\''x'` 实测均得 `{path: null, ambiguous: true}`，即重新打开 fail-open。根因是「引号字符出现次数的奇偶」不是 shell 引号配平判定；且 `splitCommandTextSegments` 不感知引号，引号内的 `;` 会把文本碎片切到后段段首冒充命令位——碎片在段内看起来良构，**段级守卫在原理上无法修复** | **换实现层级**：删除 `hasUnbalancedQuotes` 与 `RENAME_COMMAND_HEAD_REGEX`，新增导出纯函数 `extractRenameCommandParams`，在**完整命令**上单趟线性扫描并跟踪单引号 / 双引号 / 反斜杠转义状态，只在未被引用的分隔符之后进入命令位；`applyRename` 改为消费整条命令。10 种伪造构造全部归零，8 种合法形态全部保留 |
| W1 | WARNING | 裸 `|` / `&` 行为相对旧实现变化 | **成立**。`mv A B \| mv B C` 旧实现得 C、第 1 轮实现只得 B（`SEGMENT_SPLIT_REGEX` 不切裸 `\|` `&`） | 由 C1 修法顺带修好：新扫描器把 `\|` `&` 也计为分隔符，两跳恢复识别。新增 characterization 测试钉住裸管道 / 后台符两跳；同时删除代码里「一段至多一条命令」这一错误论断 |
| W2 | WARNING | 第 2 层的 `roleClass !== 'implement'` 排除项造成状态依赖不一致 | **成立，原 C2 处置被证伪**。`{subagent_type: null, description: '确认无需代码修复'}` 实测得 `roleClass='implement'`（`IMPLEMENT_ROLE_REGEX` 的「代码修复」命中了"无需**代码修复**"）且 `noopVerify=true`，而 `judgeCompliance` 的 no-op 分支只看 `noopVerify === true`，会判这条**合规** | **撤销排除项**，谓词回到 `roleClass === 'verify' \|\| noopVerify === true`；注释改写为「降级下界必须被合规合同蕴含」。原 E2 反向用例（期望 exit 2）与合规合同冲突，改为正向用例（期望 exit 0 降级）。`NOOP_VERIFY_ROLE_REGEX` 偏宽是**既有 no-op 合同**的判据宽度，收紧它须连同 `judgeCompliance` 一起改，属独立取舍 |
| W3 | WARNING | CLI 反向测试断言过弱 | **成立**。三处 `assert.notEqual(status, 0)` 在 CLI 崩溃返回 1 或 `status: null` 时也会通过，会把"门禁挂了"误读成"门禁生效了" | 全部改为 `assert.equal(status, 2, stderr)`，并补断言 report 模式下 `compliant === false` 且 `transcriptDiagnostics` 不含 `feature-dir-unresolvable` |

### 第 3 轮（对第 2 轮修法 diff 的对抗审查）

4 条 CRITICAL 全部成立并已修复，1 条 WARNING 经核实为改动前既有行为、本次不修：

| 编号 | 档 | 结论 | 核实 | 处置 |
|---|---|---|---|---|
| R3-C1 | CRITICAL | sticky 正则一次吞掉参数文本，参数里的引号 / 转义不参与状态转移 | **成立且致命**。`mv src "dst;mv <候选> <非规范名>"` 中引号内的 `;` 被当真实分隔符，凭空多识别一条改名，重新打开 fail-open；`mv src dst\;mv ...` 转义分号同理 | 正则收窄为只匹配**命令名**（`RENAME_COMMAND_NAME_REGEX`），参数由同一状态机继续扫描收集到真正未引用的控制操作符为止。core 与 CLI 两层各补反向用例 |
| R3-C2 | CRITICAL | 扫描器无 comment / redirection 状态 | **成立**。`true # ; mv ...`（分号在注释里）与 `echo hi >& mv ...`（`>&` 是重定向而非控制操作符）均被误判为开启命令位 | 新增 `#` 注释状态（须在词首、消费到行尾）与重定向操作符识别（`>&` `<&` `&>` 中的 `&` 不计为控制操作符） |
| R3-C3 | CRITICAL | `\b` 不是 shell token 边界 | **成立**。`mv-f a b` 中 `\b` 在 `v`/`-` 之间成立，自定义命令 `mv-f` 被读成 `mv -f` | 命令名终止判据改为 `(?=$\|[ \t])`；`mv-f` / `git mv-f` 两形态各补反向用例 |
| R3-C4 | CRITICAL | 「先跑完所有段提名、再统一改名」破坏同一条命令内的时序 | **成立**。`mv A B; printf x > A/fix-report.md` 中改名早于提名，HEAD 会整条忽略该 mv；第 2 轮实现却把它倒灌到后来才出现的候选上，相对 HEAD **新增**一条 fail-open | 改名事件带字符偏移扫出，按偏移归回所属段落，恢复「段内先提名、再改名」的原有时序。新增时序 characterization 用例钉住与 HEAD 逐字一致的语义 |
| R3-W1 | WARNING | `mv A B 2>&1` 不被跟随 | **成立但非本次引入**。`2>` 被当作操作数 → 3 操作数 → `parseRenameOperands` 整条跳过；改动前的旧正则同样在 `&` 处截断，行为一致 | **本次不修**，方向保守（漏跟随而非误放行）。如实记入「已知限界」第 5 条 |

第 3 轮修法还带来一处**行为变化**（非放宽）：`mv A B # 注释` 过去因 `#` 与注释词被当成多余操作数而整条跳过，现在注释被正确剥离、改名被跟随。这是正确性改进——真实改名本就该被跟随，且目标名仍须符合 `NNN-fix-<name>` 命名规范才不触发降级。两条 characterization 用例（跟随到规范名 / 非规范名仍降级）已钉住该语义。

### 第 4 轮（对第 3 轮修法 diff 的对抗审查）

5 条 CRITICAL 全部成立并已修复。每条构造均由编排器在隔离副本上以真实 shell（`bash -n` / 同名函数实跑对照）核实语义后 A/B 实测：修复前 5 条全部泄漏，修复后全部归零，合法形态零回归。

| 编号 | 档 | 结论 | 核实（真实 shell 语义） | 处置 |
|---|---|---|---|---|
| R4-1 | CRITICAL | `#` 词首判据的字符类漏了 `)` | **成立**。`( : )# ; mv <候选> <非规范名>`：真实 shell 里 `)` 是元字符，其后的 `#` 仍处词首、整行是注释，mv 从不执行；旧判据把 `#` 当普通字符，注释内的 `;` 开启命令位，伪造 mv 被采信 | `isWordStart` 字符类补 `)`（`/[\s;\|&()]/`） |
| R4-2 | CRITICAL | `>\|` 强制覆盖重定向中的 `\|` 被当管道控制符 | **成立**。`echo hi >\|mv <候选> <非规范名>`：`>\|` 是忽略 noclobber 的单个重定向操作符，其后的 `mv` 是**目标文件名**而非命令，只会创建一个名为 mv 的文件 | 重定向识别在 `>&` / `<&` 基础上补 `>\|` / `<\|` |
| R4-3 | CRITICAL | 未闭合引号的命令仍被提交改名事件 | **成立**。`mv <候选> <非规范名>"`（单引号同理）在真实 shell 是 `unexpected EOF while looking for matching quote` 语法错误，命令**根本不会执行**，其中的 mv 文本不构成任何一次真实改名 | 扫描结束时若 `quote !== null` → 返回空事件数组 |
| R4-4 | CRITICAL | 参数超 `RENAME_PARAM_MAX_LENGTH` 后被**截断**再解析 | **成立且致命**。`mv SRC NONSTANDARD` + 400 空格 + `DEST_DIR` 实测 bash 收到 argc=3（语义为"移入目录"，不是改名）；截断把第三操作数抹掉，形态退化成看似合法的二操作数改名 —— 长度上限成了绕过「多操作数 mv 必须整条跳过」保守化合同的通道 | 超长参数**整条作废**（`events.pop()`），不再截断解析 |
| R4-5 | CRITICAL | 主循环对每个 span 重扫全部事件，最坏 `O(spans × events)` | **成立**。`'mv a b;'.repeat(8000)` 实测 141.4ms；本判定跑在**同步 Stop hook** 路径上，本仓库有过 O(N²) 致 11.8s 的先例 | spans 与 events 均按偏移升序 → 改为单指针归并，实测降到 5.0ms（本次复核 5.7ms）。等价性成立：事件偏移落在命令名字符上，不可能落进 span 之间的分隔符间隙，故原 `offset >= span.start` 条件被升序推进天然蕴含 |

## Spec 影响

- 需要更新的 spec：无（本次不改变对外契约，`resolveFeatureDirCandidate` 与 `judgeCompliance` 的返回形状逐字不变）
- `contracts/fix-compliance-judge-cli.md` 场景表：需确认降级场景描述是否需补「伪造改名不触发降级」一行（实施阶段核对）

## 已知限界（如实记录，不得表述为已解决）

**总括性声明（最重要的一条，先于下列逐条）**：`scanRenameCommandEvents` 是一个**保守的词法近似**，不是 shell 解析器，**更不判断命令是否真的被执行**——它只回答「这段文本在语法上是不是一条处于命令位的 mv」。五轮对抗审查逐轮收敛判据维度（关键字 → 命令位 → 全命令引号/转义 → 注释/重定向/长度上界 → 执行可达性），但**不排除仍存在未覆盖的 shell 构造**。设计上的兜底是**方向保守**：识别失败时候选停留在改名前目录、按既有严格判据裁决（后果可能是误阻断一次合法收口），而非误放行。下列逐条限界是这一总声明的**具体实例，而非穷举**。

**限界 0 —— 语法命令位 ≠ 实际被执行（第 5 轮 Codex 审查发现，本次不修）**

出现在**不会被执行的控制流分支**里的 mv 文本仍会被采信为改名事件，从而打开降级通道。实测构造（每条都通过 `bash -n`，且用同名 `mv` 函数实跑确认**真实 shell 并未执行 mv**）：

| 构造 | 命令（`S`=候选目录，`D`=非规范名）|
|---|---|
| 短路 RHS | `true \|\| mv S D` |
| 函数定义体（从未调用）| `f() {` 换行 `mv S D` 换行 `}; :` |
| 死 if 分支 | `if false; then` 换行 `mv S D` 换行 `fi` |
| 未命中 case 分支 | `case x in y)` 换行 `mv S D` 换行 `;; esac` |
| 命令替换内 | `: $(false && mv S D)` |
| 循环体（零次迭代）| `while false; do` 换行 `mv S D` 换行 `done` |

**为何本次不修（三条理由，缺一不可）**：

1. **不是本次引入的回归**：同一组构造在 HEAD（无本次改动）上逐条实测得到**完全相同**的结果（均 `{path: null, ambiguous: true}`）。本次改动严格缩小了可被采信的伪造集合，未扩大。
2. **词法层不可判定**：「这条命令会不会执行」需要求值 shell 控制流，不是任何词法近似能回答的。连 `mv A B` 单独一条也可能运行时失败。
3. **收窄子集会打破已冻结语义**：唯一可机械实施的收紧是「只认整条命令就是一条 mv」，但 F224 已冻结的用例要求跟随 `cat > <制品> <<EOF … EOF` 换行后的 mv（mv 不是整条命令），该收紧会直接打破它。

**唯一可靠的修法**是改用**执行证据**而非文本证据：核验该 Bash tool_use 对应的 tool_result（F216 的 `extractExecutionRecordsAfter` 已有配对机制），只采信真实执行成功的改名。这是判据来源的更换而非词法层修补，应作为独立 Feature 立项，不塞进本次。

1. **heredoc 正文首行若恰为裸 `mv <候选> <非规范名>`，仍会被跟随**：段切分按换行拆开 heredoc 正文，正文行与真实命令行同形。命令位锚定把伪造成本从「任意位置写 mv」抬高到「必须让 mv 独占一行的行首」，但未归零。彻底关闭需真正的 shell 解析器，会动到 F224 已冻结的「heredoc 后 mv 须被跟随」用例，属独立取舍。
2. **真实执行的 mv 仍可打开降级通道**：会话若真的把自己的特性目录 `mv` 到非规范名，仍会 fail-open（这正是 F224 的设计意图）。本次只关闭「不真的执行、仅在文本里伪造」这一面，以及「零验证类委派」这一面。
3. **命令位锚定会漏跟随若干不常见的合法前缀形态**（`sudo mv` / `FOO=1 mv` / `xargs mv` 等）。后果不是无害的"少跟随一次"，而是**可能误阻断一次合法收口**：真实目录已被移动、且此后再无新的制品路径写入痕迹时，判定器仍拿改名前的旧路径去撞磁盘核验，会报"未建立特性目录"并 exit 2。方向上仍属保守（宁可误阻断，不可误放行），但代价须如实写明。刻意不做前缀白名单——白名单本身就是新的可构造面（`sudo` 之类前缀词可被自由写入 transcript）。
4. **F227 已知限界一（冒用已存在的历史特性目录）不在本次范围**，与本次修复正交。
5. **`mv A B 2>&1` 这类带重定向的改名不被跟随**（Codex 第 3 轮 W1）：`2>` 被 `parseRenameOperands` 当作第 3 个操作数，整条跳过。这是**改动前既有行为**（旧正则同样在 `&` 处截断），本次不修——方向保守（漏跟随而非误放行），修它需要在操作数解析层引入重定向剥离，属独立取舍。
