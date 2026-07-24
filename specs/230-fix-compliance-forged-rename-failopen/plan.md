---
title: "fix 依从性门禁伪造 mv fail-open 修复 — 实现计划"
feature: "230-fix-compliance-forged-rename-failopen"
branch: "claude/dazzling-jackson-9457e2"
created: "2026-07-23"
status: "Draft"
---

# Implementation Plan: fix 依从性门禁伪造 mv fail-open 修复

**Branch**: `claude/dazzling-jackson-9457e2` | **Date**: 2026-07-23 | **Fix Report**: `specs/230-fix-compliance-forged-rename-failopen/fix-report.md`
**Input**: `specs/230-fix-compliance-forged-rename-failopen/fix-report.md`（方案 A，5-Why 根因、实测差分矩阵 A-E、影响范围扫描已完整给出，本 plan 只做精确变更清单化，不重复推导）

## Summary

fix-report 方案 A 的两层改动，均为**纯函数内部逻辑收窄**，零对外契约变更：

- **第 1 层（词法层，关闭伪造开关）**：把改名识别从「段内任意位置出现 `mv` 关键字」收紧为「`mv` 必须位于**命令位**」。命令位判定**在完整命令上**做（不逐段）：新增内部 sticky 正则 `RENAME_COMMAND_NAME_REGEX`（只匹配命令名）与导出纯函数 `scanRenameCommandEvents`，单趟线性扫描并跟踪单/双引号、反斜杠转义、`#` 注释与重定向操作符，只在未被引用、未被转义、且不属于重定向的控制操作符（`;` `|` `&` 换行，天然覆盖 `&&` `||`）之后进入命令位；参数文本由同一状态机继续收集，事件带字符偏移返回。主循环用新增内部函数 `splitCommandTextSegmentSpans` 把事件**按偏移归回所属段落**，保持「段内先提名、再改名」的原有时序；`applyRename(command)` 相应降级为 `applyRenameEvent(paramText)`。**判据只在改名识别这一路收紧**，`scanArtifactPath`/`splitCommandTextSegments`/`hasBashWriteIndicator`/`parseRenameOperands`/`SEGMENT_SPLIT_REGEX`/`unfoldLineContinuations` 逐字不动；原 `RENAME_COMMAND_SEGMENT_REGEX` 因失去全部消费方被一并删除（质量审查 WARNING，实测零引用）。
  > 设计初稿的「段级锚定 `^\s*` + 引号奇偶配平守卫」被第 2 轮 Codex 对抗审查（C1）用转义引号构造证伪；第 2 轮的「正则一次吞掉命令名 + 参数」又被第 3 轮（R3-C1/C2/C3/C4）用参数内藏 mv、注释藏分号、`mv-f`、跨段时序倒灌四类构造证伪。详见 §1.1 / §1.2。

  > **方案演进（编排器实测替换，取代原「注释/引号扫描器 `scanRenameShellContext`」设计）**：Codex 设计阶段对抗审查指出并经实测证实——注释与引号扫描只堵住两种写法，`echo mv <候选> <非规范名>`（**既无注释也无引号**，`mv` 只是 `echo` 的参数）同样能打开降级通道，比用户原始复现还少一个字符。词法层逐个形态打补丁是打地鼠；改为**命令位锚定**后，7 种伪造构造（注释 / 单引号 / 双引号 / 裸参数 / 引号内藏 `;` / 引号内藏 `&&` / 行连接）全部归零，且 6 种合法改名形态（`mv` / `git mv` / `mv -f` / `cd && mv` / heredoc 后 mv / 分号串联多跳）全部保留，既有 343 条测试零失败。原 `scanRenameShellContext` 设计作废，不实现。
- **第 2 层（判定层，收窄降级下界）**：`fix-compliance-judge.mjs` 的 `evaluate()` 中，把「是否存在收口类委派」的判据从 `counts.implement > 0 || counts.verify > 0` 改为 `delegations.some(d => d.roleClass === 'verify' || d.noopVerify === true)` —— repair 合同要求 verify、no-op 合同要求 noopVerify，`roleClass='implement'` 本身不再单独满足降级前提。判据必须严格取两种收口合同各自要求的这一形式、不得附加排除项，理由见 §2.1（降级下界须被合规合同蕴含）。

两层改动完全独立、无耦合：第 1 层堵住"文本从未真正执行"的伪造（差分矩阵 A/D），第 2 层堵住"确有其事但零验证类委派"的坍塌（差分矩阵 E）。差分矩阵 C（真实 mv + 有验证类委派）继续 exit 0，F224 的合法降级设计意图不变。

## Technical Context

**Language/Version**：Node.js ≥20.x（`.mjs`，零外部运行时依赖，与 F224/F225/F227 一致）
**Primary Dependencies**：无新增
**Storage**：N/A（不涉及新的持久化结构）
**Testing**：`node --test`（`plugins/spec-driver/tests/*.test.mjs`），CLI 端到端通过 `spawnSync` 拉起 `fix-compliance-judge.mjs`
**Target Platform**：Claude Code / Codex Stop hook 运行时沙箱
**Project Type**：single（spec-driver 插件内部脚本修复）
**Performance Goals**：与既有实现同量级——`scanRenameCommandEvents` 对命令文本单趟线性扫描（每字符 O(1) 状态转移，游标只前进不回退），sticky 正则只匹配定长命令名、无量词，零灾难性回溯面；`splitCommandTextSegmentSpans` 与既有 `splitCommandTextSegments` 同复杂度；事件归段初版为 O(段数 × 事件数)，被第 4 轮 Codex 对抗审查（R4-5）用 `'mv a b;'.repeat(8000)` 实测 141.4ms 证伪——本判定跑在 **Stop hook 同步路径**上，且本仓库有过 O(N²) 致 11.8s 的先例。最终实现改为**单指针归并**（spans 与 events 均按偏移升序，游标只前进不回退），归段降为 O(段数 + 事件数)，同一构造实测 5.0ms（复核 5.7ms）。等价性成立：事件偏移落在命令名字符上，不可能落进 span 之间的分隔符间隙，故原 `offset >= span.start` 下界被升序推进天然蕴含
**Constraints**：`resolveFeatureDirCandidate` 返回形状（`{path, ambiguous}`）与 `judgeCompliance` 返回形状逐字不变；`scanArtifactPath`/`splitCommandTextSegments`/`parseRenameOperands` 逐字不动；不改 `.specify/`、release contract、`dist/`
**Scale/Scope**：2 个生产文件各一处局部改动 + 1 个新增导出纯函数；测试新增约 20-25 个用例 + 1 个新 fixture 索引表行（本次不新增独立 fixture 文件，端到端用例复用既有 `writeTranscript` 内联构造风格，与 F224/F225 SC-005/SC-005b 测试一致）

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| 双语文档规范 | 适用 | PASS | 正文中文，正则/标识符保留英文 |
| Spec-Driven Development | 适用 | PASS | fix 模式走 fix-report → plan → tasks → implement → verify |
| 如无必要勿增实体（YAGNI） | 适用 | PASS | 未引入 shell 解析器/handler 注册表；只新增 1 个 sticky 正则常量 + 1 个长度上界常量 + 2 个单一职责纯函数（`scanRenameCommandEvents(command) => {offset,paramText}[]` 与内部 `splitCommandTextSegmentSpans(command) => {text,start,end}[]`），并顺带删除因本次改动失去全部消费方的孤儿导出 `RENAME_COMMAND_SEGMENT_REGEX` |
| 诚实标注不确定性 | 适用 | PASS | 已知限界（heredoc 正文 mv、真实执行 mv 仍可降级）如实延续自 fix-report，不表述为已解决 |
| 零运行时依赖 | 适用 | PASS | 纯 `.mjs` 正则与循环逻辑 |
| 质量门控不可绕过 | 适用 | PASS | 不触碰 GATE_* 编排门禁，只修正 Stop hook 内部判定核心的两处词法/判定逻辑 |
| 验证铁律 | 适用 | PASS | 覆盖差分矩阵 A/C/D/E 四个具名场景 + F224/F225/F228/codex C-2 全部既有回归 |
| 向后兼容 | 适用 | PASS（需验证） | 见下方「回归风险评估」；新函数为纯加法，`applyRenameEvent`/`evaluate` 改动对既有输入逐字等价（唯一例外见 §1.2：`mv A B # 注释` 由「整条跳过」变为「正确跟随」，属注释感知带来的正确性改进） |

**结论**：Constitution Check 通过，无 VIOLATION。

## Codebase Reality Check

| 文件 | 行数 | 本次改动 | 已知 debt |
|------|------|----------|-----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 911 | 新增内部常量 `RENAME_COMMAND_NAME_REGEX` / `RENAME_PARAM_MAX_LENGTH` + 导出纯函数 `scanRenameCommandEvents` + 内部函数 `splitCommandTextSegmentSpans`；`applyRename` 改写为 `applyRenameEvent`；主循环改为按偏移归段；删除孤儿导出 `RENAME_COMMAND_SEGMENT_REGEX`（质量审查 WARNING，实测零消费方） | 无 TODO/FIXME/HACK；无超长函数；无循环依赖 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 450 | `evaluate()` 内 L171-178 一处判据改写（约 5 行 → 约 8 行，净增 ≤5 行） | 无 debt 标记 |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | 2336 | 测试新增落点：2 个新 describe 块 | N/A（测试文件） |
| `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | 913 | 测试新增落点：1 个新 describe 块（4-6 条 `it`） | N/A（测试文件） |
| `plugins/spec-driver/tests/fixtures/fix-compliance/README.md` | — | 无需新增 fixture 行（本次端到端用例延续 F224 SC-005/SC-005b 的内联 `writeTranscript` 风格，不新增 `.jsonl` 文件） | N/A |

**前置清理判定**：`fix-compliance-core.mjs` 现 911 行 > 500 行阈值，但本次预估新增 ≤ 35 行，远低于 50 行触发线（"LOC > 500 **且**新增 > 50 行"为复合条件，二者须同时成立）；无 > 3 处相关 TODO/FIXME；无新增代码重复（`scanRenameCommandEvents` 是全新单一职责函数；`splitCommandTextSegmentSpans` 与 `splitCommandTextSegments` 共用 `SEGMENT_SPLIT_REGEX` 源，不复制切分规则）。**结论：不新增 `[CLEANUP]` 前置任务**——与 F224 plan 对同一文件的既往裁决口径一致。

## Impact Assessment

- **直接修改文件**：2 个生产文件（`fix-compliance-core.mjs`、`fix-compliance-judge.mjs`）+ 2 个测试文件
- **间接受影响（下游消费方）**：
  - `fix-compliance-judge.mjs` 是 `resolveFeatureDirCandidate` **唯一**生产消费方（fix-report 已确认）——新函数只在其内部消费，无第三方 import 面
  - `plugins/spec-driver/hooks/stop-fix-compliance-check.sh`：薄壳调用 `fix-compliance-judge.mjs`，不感知内部实现变化，**不受影响**
  - `judgeCompliance`、`checkFeatureDirOnDisk`、`readArtifactFile`：**零改动**，第 2 层改动只读 `delegations`（已在 `evaluate()` 作用域内），不触碰这些函数
- **跨包影响**：0（改动完全收敛在 `plugins/spec-driver/` 内部）
- **数据迁移**：无（`transcriptDiagnostics: ['feature-dir-unresolvable']` 诊断码复用既有通道，不新增枚举值、不改 schema）
- **API/契约变更**：无——`resolveFeatureDirCandidate` 与 `judgeCompliance` 返回形状逐字不变（硬约束，见运行时上下文）；对既有输入 `applyRenameEvent` 新旧行为逐字等价（唯一例外：`mv A B # 注释` 由跳过变为正确跟随）
- **风险等级判定**：影响文件 4（远低于 10）、跨包影响 0、无数据迁移、无公共契约变更 → **风险等级：LOW**
- **是否强制分阶段**：LOW 风险不触发强制分阶段；tasks.md 仍按"核心实现 → 正向/负向单测 → CLI 端到端 → 既有全量回归 → 文档同步"顺序化任务流交付

## 改动清单（函数级）

### 1. `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`

#### 1.1 新增内部 sticky 正则 `RENAME_COMMAND_NAME_REGEX` + 导出纯函数 `scanRenameCommandEvents`

> **本节已被三轮 Codex 对抗审查连续替换/收敛，下方是最终落库版本**。
> - 初稿：「段级命令位锚定（`RENAME_COMMAND_HEAD_REGEX` 锚 `^\s*`）+ 引号字符奇偶配平守卫（`hasUnbalancedQuotes`）」，被第 2 轮 C1 用转义引号构造证伪（`echo "a;mv <候选> <非规范名>\""`）。根因是**段级守卫在原理上不可行**：`splitCommandTextSegments` 不感知引号，引号内的 `;` 会把文本碎片切到后段段首冒充命令位，而碎片在段内看起来良构。
> - 第 2 轮：`RENAME_COMMAND_AT_POSITION_REGEX` 在命令位一次匹配命令名 + 参数，被第 3 轮 R3-C1 证伪——**正则吞参数就会丢状态**：参数里的引号 / 转义不参与状态转移，`mv src "dst;mv <候选> <非规范名>"` 中引号内的 `;` 被当真实分隔符，凭空多识别一条改名。
>
> - 第 4 轮：判据维度不再更换，只在同一状态机上补词法边界并加硬长度上界处置（R4-1 `#` 词首字符类补 `)`；R4-2 重定向补 `>|` / `<|`；R4-3 扫描结束时 `quote !== null` → 返回空事件数组，因为未闭合引号在真实 shell 是语法错误、命令根本不执行；R4-4 参数超上界改为**整条作废**而非截断，截断会藏掉第三操作数、使「多操作数 mv 整条跳过」的保守化合同失效）。
>
> 上述符号（`RENAME_COMMAND_HEAD_REGEX` / `hasUnbalancedQuotes` / `RENAME_COMMAND_AT_POSITION_REGEX` / `extractRenameCommandParams`）均已从代码库删除。

插入位置：`RENAME_COMMAND_NAME_REGEX` 取原 `RENAME_COMMAND_SEGMENT_REGEX` 的位置（连同其 JSDoc 一并删除）；`scanRenameCommandEvents` 与 `splitCommandTextSegmentSpans` 插在 `resolveFeatureDirCandidate` 的 JSDoc 之前。

```js
// 只匹配命令名、不吞参数（R3-C1）；终止判据用 (?=$|[ \t]) 而非 \b，否则 mv-f 被读成 mv -f（R3-C3）；
// git 与 mv 之间用 [ \t] 而非 \s：\s 含换行，会让行尾的 git 与下一行行首的 mv 跨命令拼接
const RENAME_COMMAND_NAME_REGEX = /(?:git[ \t]+mv|mv)(?=$|[ \t])/y;
const RENAME_PARAM_MAX_LENGTH = 400;
```

```js
/**
 * 从一条**完整** Bash 命令中扫出所有真正处于命令位的 mv / git mv 事件，带字符偏移供调用方归段。
 * 状态：单引号（内无转义）/ 双引号 / 反斜杠转义 / `#` 注释 / 重定向操作符（>& <& &>）。
 * 只在未被引用、未被转义、且不属于重定向的控制操作符（`;` `|` `&` 换行）之后或文本开头进入命令位。
 * 参数文本由同一状态机继续扫描收集（不能让正则一次吞掉，否则参数内引号/转义状态丢失）。
 * @returns {{ offset:number, paramText:string }[]}
 */
export function scanRenameCommandEvents(command) { /* 单趟线性扫描 */ }

/** 与 splitCommandTextSegments 同源分段，额外给出每段跨度，供改名事件按偏移归段 */
function splitCommandTextSegmentSpans(command) { /* => { text, start, end }[] */ }
```

#### 1.2 `applyRename(command)` → `applyRenameEvent(paramText)` + 主循环按偏移归段

改名闭包从「消费整条命令、内部自己找所有 mv」降级为「消费单条已扫出的事件参数文本」，找 mv 的职责上移到 `scanRenameCommandEvents`：

```diff
-  const applyRename = (command) => {
+  const applyRenameEvent = (paramText) => {
     if (trackedDir === null) return; // 尚无已跟踪目录时的改名与本次收口无关（FR-001 只跟随"已知"目录）
-    let match;
-    RENAME_COMMAND_SEGMENT_REGEX.lastIndex = 0;
-    while ((match = RENAME_COMMAND_SEGMENT_REGEX.exec(command)) !== null) {
-      const operands = parseRenameOperands(match[1]);
-      if (operands === null) continue;
-      const src = stripTrailingSlash(operands[0]);
-      if (src !== trackedDir) continue;
-      trackedDir = stripTrailingSlash(operands[1]);
-      syncCandidateFromTrackedDir();
-    }
+    const operands = parseRenameOperands(paramText);
+    if (operands === null) return; // 异常形态整条跳过（保守化：不跟随、也不置 ambiguous）
+    const src = stripTrailingSlash(operands[0]);
+    if (src !== trackedDir) return;
+    trackedDir = stripTrailingSlash(operands[1]);
+    syncCandidateFromTrackedDir();
   };
```

**主循环**（Bash 分支）：先在整条命令上扫出改名事件，再遍历段跨度，段内先提名、再应用偏移落在本段内的事件：

```diff
-        for (const segment of splitCommandTextSegments(input.command)) {
-          if (hasBashWriteIndicator(segment)) scanArtifactPath(segment);
-        }
-        applyRename(input.command);
+        const renameEvents = scanRenameCommandEvents(input.command);
+        for (const span of splitCommandTextSegmentSpans(input.command)) {
+          if (hasBashWriteIndicator(span.text)) scanArtifactPath(span.text);
+          for (const event of renameEvents) {
+            if (event.offset >= span.start && event.offset < span.end) applyRenameEvent(event.paramText);
+          }
+        }
```

**为何必须归段而非「先全段提名、再统一改名」**（第 3 轮 R3-C4）：后者破坏同一条命令内的执行时序。`mv A B; printf x > A/fix-report.md` 中改名早于提名，HEAD 会整条忽略该 mv（`trackedDir` 尚为 null）；若先跑完提名再改名，这条早于提名的改名会被**倒灌**到后来才出现的候选上，相对 HEAD 凭空新增一条 fail-open。带偏移扫出、按偏移归段，是「拥有完整命令词法上下文」与「保持段内先提名后改名时序」二者同时成立的唯一解。

初稿曾论证「一段至多一条命令，故可退化为单次匹配」——该论断**不成立**且已从代码中删除：`SEGMENT_SPLIT_REGEX` 并不切裸 `|` 与 `&`，`mv A B | mv B C` 是单段内的两条命令；扫描器把这两个符号也计为控制操作符，两跳均识别（与本 feature 硬化之前的全局匹配行为一致）。

**改动范围确认**：`resolveFeatureDirCandidate` 的其余部分（`trackedDir`/`candidate`/`ambiguous` 状态、`syncCandidateFromTrackedDir`、`scanArtifactPath`、`splitCommandTextSegments`、`hasBashWriteIndicator`、`parseRenameOperands`、`SEGMENT_SPLIT_REGEX`、`unfoldLineContinuations`、`return { path: candidate, ambiguous }`）**逐字不动**；原 `RENAME_COMMAND_SEGMENT_REGEX` 连同其 JSDoc 一并删除。

**实测等价性**：对全部既有 fixture 与内联用例（8 个 `resolve-*.jsonl` + 两个测试文件内所有 mv 构造），新旧输出逐字一致；裸 `|` / `&` 两跳与 R3-C4 时序回归均与 HEAD 一致（characterization 测试钉住）。**唯一行为变化**：`mv A B # 注释` 现在会被正确跟随（HEAD 因把 `#` 与注释词当多余操作数而整条跳过），属注释感知带来的正确性改进，目标名仍须符合命名规范才不触发降级。

### 2. `plugins/spec-driver/scripts/fix-compliance-judge.mjs`

#### 2.1 改写 `evaluate()` 内 F224 CRITICAL 收窄段（当前 L164-178）

```diff
-  // F224 CRITICAL 收窄（Phase 5 后修复轮）：fail-open 必须**按维度**生效，不得整体短路。
-  // 早前实现在 judge 之前直接 return，等于用"目录无法定位"一并赦免了与目录解析无关的委派证据要求，
-  // 于是只要多敲一条 `git mv <候选> <非规范名>`，零委派的坍塌会话也能把 exit 2 变成 exit 0——
-  // 直接击穿 F208 设立本门禁的目的。收窄口径：
-  //   委派证据本身已足以证明坍塌（implement 与 verify 均为 0，无论制品落在哪个目录都构不成一次合规收口）
-  //   → 维持阻断，按既有 missing 语义输出；
-  //   仅当存在收口类委派、唯一不确定的确实是"制品落在哪个目录"时 → 才走 degraded 放行。
-  const counts = verdict.delegationCounts;
-  const hasClosureDelegation = counts.implement > 0 || counts.verify > 0;
-  if (featureDirUndetermined && hasClosureDelegation) {
+  // F224 CRITICAL 收窄（Phase 5 后修复轮）：fail-open 必须**按维度**生效，不得整体短路（沿用不变）。
+  //
+  // F230 CRITICAL 第 2 层收窄：降级下界不得取「repair 合同」与「no-op 合同」两种收口形态各自要求的
+  // **并集**（F224 原判据 implement>0 || verify>0），而须取**交集**——repair 合同要求
+  // counts.verify ≥ 1、no-op 合同要求 noopVerifyCount ≥ 1，二者都不满足时，无论制品落在哪个目录，
+  // 该会话都不可能合规收口，故拒绝降级不会冤枉任何本可合规的会话（fix-report §方案 A 第 2 层可证明性）。
+  // 只查 roleClass==='verify' 不够——canonical no-op 委派文案「交叉核实无需改动判定」只命中
+  // NOOP_VERIFY_ROLE_REGEX（含"核实"/"确认"）、不命中更窄的 VERIFY_ROLE_REGEX，
+  // 故必须显式补 `d.noopVerify === true` 分支，否则会误伤合法 no-op 收口。
+  // 谓词的下界必须**被合规合同蕴含**：凡 judgeCompliance 可能判合规的委派构成，降级都必须放行，
+  // 否则会出现「目录可定位时判合规、目录改名后却拒绝降级」的状态依赖不一致。judgeCompliance 的
+  // no-op 分支只看 noopVerify===true（不看 roleClass），故这里不得附加 roleClass 排除项
+  // （设计阶段曾加 `roleClass !== 'implement'`，第 2 轮审查 W2 已证伪并撤销）。
+  const hasVerifyClassDelegation = delegations.some(
+    (d) => d && (d.roleClass === 'verify' || d.noopVerify === true),
+  );
+  if (featureDirUndetermined && hasVerifyClassDelegation) {
     return {
       enforcement, configDegraded, isFix: true, mode: anchor.mode,
       transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null,
     };
   }
```

**改动范围确认**：`evaluate()` 函数其余部分（`config`/`enforcement`/`transcriptDiagnostics` 早退、`anchor`/`isFix` 判定、`candidate`/`featureDirUndetermined` 计算、`delegations`/`featureDirCheck`/`fixReport`/`verificationReport`/`closure`/`executionRecords` 读取、`judgeCompliance` 调用、函数末尾的正常 return）**逐字不动**。`delegations` 变量已在 L133 声明并处于本改动的作用域内，无需新增读取或改变其产出方式（`extractDelegationsAfter` 本身零改动）。`verdict.delegationCounts` 不再被此分支读取，但 `verdict` 对象本身（含 `delegationCounts` 字段）作为函数最终返回值的一部分继续原样透传，不受影响——`judgeCompliance` 的输出契约无需变更。

## 回归风险评估

逐条列出可能被波及的既有 `describe` 块，并说明为何不受影响：

| 既有断言/构造 | 位置 | 是否受影响 | 理由 |
|---|---|---|---|
| F224 `sed -i '' 's#a#b#' ...` 中的 `#` 不得被当作注释 | `fix-compliance-core.test.mjs` L1846-1851、L1873-1878 | **不受影响** | 该命令位上的命令是 `sed` 而非 `mv`，`scanRenameCommandEvents` 在该命令位不匹配、扫不出任何改名事件。第 3 轮新增的 `#` 注释状态只影响**改名事件扫描**，不参与提名侧判据（`scanArtifactPath`/`hasBashWriteIndicator` 逐字不动），且 `sed -i '' 's#a#b#'` 中的 `#` 全部落在引号内、注释状态天然不触发 |
| F224 heredoc 后 mv 仍须被跟随 | `fix-compliance-core.test.mjs` L1853-1859（`cat > .../fix-report.md <<EOF\n...\nEOF\nmv <src> <dst>`） | **不受影响（已实测）** | `splitCommandTextSegments` 按换行切分后，末段就是纯净的 `mv specs/344-fix-a specs/345-fix-b`，换行是未被引用的分隔符，`mv` 恰在其后的命令位 → 命令位判定成立，行为逐字等价于改动前 |
| F225 同段共现（写指示符与 artifact 路径须同段） | `fix-compliance-core.test.mjs` L547-586（codex C-2 描述块的 F225 补充用例）、L1862-1889（F224×F225 共存描述块） | **不受影响** | 本次改动完全不触碰 `scanArtifactPath`/`hasBashWriteIndicator`/`splitCommandTextSegments`/`SEGMENT_SPLIT_REGEX`——这些是 F225 同段共现判据的全部构成，改名与提名在主循环中互不调用：写入提名仍逐段跑 `if (hasBashWriteIndicator(span.text)) scanArtifactPath(span.text);`，改名事件另行扫出后按偏移归段应用。段跨度由 `splitCommandTextSegmentSpans` 给出，其切分规则与 `splitCommandTextSegments` 同源（共用 `SEGMENT_SPLIT_REGEX`），段边界逐字一致 |
| F228 代码区豁免（`checkArtifactSection` 剥离围栏后再扫占位符） | `fix-compliance-core.test.mjs` 中 `stripCodeRegions`/`computeFenceRegions`/`CANONICAL_PLACEHOLDER_REGEX` 相关用例 | **不受影响** | F228 作用于制品**内容**的占位符扫描（`checkArtifactSection` 消费 `fixReport.content`），与本次改动作用的**命令文本**（`scanRenameCommandEvents` 消费 `input.command`）是完全不同的数据面，代码路径无交叉 |
| codex C-2 六条反 Goodhart 硬化断言 | `fix-compliance-core.test.mjs` L509-545（6 条 `it`：echo 纯提及不提名 / cat 读形态不提名 / 仅目录+重定向不提名 / heredoc 写提名 / Write 非 artifact 不提名 / Write verification-report 提名） | **不受影响** | 全部只涉及 `scanArtifactPath` 的 Write/Bash 写入证据判据，不含 `mv`/`git mv`，这些用例的命令文本扫不出任何改名事件（无命令位上的 `mv`），改动前后行为逐字一致 |
| F224 全部改名跟随用例（`resolve-rename-*.jsonl` 4 个 fixture + option token 形态 7 条 + mv 异常形态跳过 6 条 + 多跳改名链 3 条 + FR-007 锚定 3 条） | `fix-compliance-core.test.mjs` L1592-1889 | **不受影响** | 已逐一核对全部 `.jsonl` fixture 与内联 `command` 字符串（见下方"fixture 核对结论"），其 `mv`/`git mv` 无一例外位于真实命令位（未被引号包裹、无注释、无重定向、命令名后紧跟空白），故命令位判定对这些输入与改动前逐字等价，改名跟随复现原行为 |
| F224 SC-005/SC-005b CLI 端到端（`unresolvableTranscript`/`zeroDelegationRenamedTranscript`/仅 verify 类委派场景/两条 fixture 复核/Codex 构造 A/B） | `fix-compliance-judge-cli.test.mjs` L798-913 | **不受影响，且需继续通过** | 均为真实 `git mv`（无注释、无引号）→ 第 1 层照常识别；委派构成分别为「implement+verify 都有」「零委派」「仅 verify 类（`subagent_type:'spec-driver:verify'`，`roleClass==='verify'` 天然为真）」——`hasVerifyClassDelegation` 对这三种构成的求值结果与旧判据 `hasClosureDelegation` 在这些具体用例上**恰好一致**（"implement+verify 都有"时 `verify>0` 已满足旧判据也满足新判据；"零委派"两判据都为 false；"仅 verify 类"两判据都为 true），故这批用例期望值全部保持不变 |

**fixture 核对结论（已由实测取代静态核对）**：在 scratchpad 的隔离仓库副本上应用第 1 层完整改动后，`fix-compliance-core.test.mjs` + `fix-compliance-judge-cli.test.mjs` 全部通过、零失败（改动前同口径基线亦为全绿）。既有 8 个 `resolve-*.jsonl` fixture 与两个测试文件内的全部 `mv`/`git mv` 构造，其 `mv` 均位于真实命令位，故命令位判定对它们逐字等价。第 2 轮 C1 与第 3 轮 R3-C1/C2/C3/C4 替换实现后同口径重跑仍全绿（第 3 轮落库后两文件合计 **434 条通过、0 失败**）。

**关于第 2 层改动可能引入的新回归面**：`hasVerifyClassDelegation` 与旧判据 `hasClosureDelegation` 的唯一差异是「implement>0 但 verify==0 且 noopVerify 全假」这一种委派构成——搜索现有两个测试文件确认**不存在**任何现有断言依赖这一具体构成的降级期望值（现有全部 rename+delegation 组合测试要么零委派、要么含 verify 类），故第 2 层改动同样是**纯收窄、零已知回归**，唯一效果是让 fix-report 差分矩阵 E（implement-only）从"未覆盖"变为"新增覆盖并阻断"。

## 验证方案

### 新增单元测试（`fix-compliance-core.test.mjs`）

**describe 1：`resolveFeatureDirCandidate` 改名跟随命令位锚定 — 伪造形态表驱动（候选恒为 `specs/900-fix-x`，复用 F224 既有 `user`/`bash`/`write` 内联构造风格）**

全部期望一致：`path === 'specs/900-fix-x'` 且 `ambiguous === false`（候选保持原状、不得进入降级通道）。以下 13 条构造已在隔离副本实测通过（A-F7 为前两轮，F8-F13 为第 3 轮新增）。

| # | 伪造形态 | 命令文本 |
|---|---|---|
| A | 注释掉的 mv（用户原始复现） | `'true # mv specs/900-fix-x specs/renamed-nonstandard'` |
| D1 | 单引号包裹 | `"echo 'mv specs/900-fix-x specs/renamed-nonstandard'"` |
| D2 | 双引号包裹 | `'echo "mv specs/900-fix-x specs/renamed-nonstandard"'` |
| F1 | **裸参数**（既无注释也无引号，Codex 审查发现） | `'echo mv specs/900-fix-x specs/renamed-nonstandard'` |
| F2 | 其他命令的参数位 | `'grep mv specs/900-fix-x specs/renamed-nonstandard'` |
| F3 | 引号内藏 `;`（切段后落到后段段首，靠全命令引号跟踪拦） | `"echo 'a;mv specs/900-fix-x specs/renamed-nonstandard'"` |
| F4 | 引号内藏 `&&` | `"echo 'a&&mv specs/900-fix-x specs/renamed-nonstandard'"` |
| F5 | 双引号内藏 `;` + 尾部**转义引号**（第 2 轮 C1） | `'echo "a;mv specs/900-fix-x specs/renamed-nonstandard\\""'` |
| F6 | 单引号内藏 `;` + `'\\''` 拼接（第 2 轮 C1） | `"echo 'a;mv specs/900-fix-x specs/renamed-nonstandard'\\''x'"` |
| F7 | 引号内藏**裸管道**（分隔符不止 `;` 与 `&&`） | `"echo 'a|mv specs/900-fix-x specs/renamed-nonstandard'"` |
| F8 | **参数内引号藏 mv**（第 3 轮 R3-C1） | `'mv source "dest;mv specs/900-fix-x specs/renamed-nonstandard"'` |
| F9 | **参数内转义分号藏 mv**（第 3 轮 R3-C1） | `'mv source dest\\;mv specs/900-fix-x specs/renamed-nonstandard'` |
| F10 | **注释内藏分号**（第 3 轮 R3-C2） | `'true # ; mv specs/900-fix-x specs/renamed-nonstandard'` |
| F11 | **重定向 `>&` 的 `&` 不是控制操作符**（第 3 轮 R3-C2） | `'echo hi >& mv specs/900-fix-x specs/renamed-nonstandard'` |
| F12 | **`mv-f` 是另一个命令**（第 3 轮 R3-C3） | `'mv-f specs/900-fix-x specs/renamed-nonstandard'` |
| F13 | **`git mv-f` 同上**（第 3 轮 R3-C3） | `'git mv-f specs/900-fix-x specs/renamed-nonstandard'` |

**describe 2：命令位锚定不得误伤合法改名（正向保住，防过度收紧）**

| # | 合法形态 | 命令文本 | 期望 |
|---|---|---|---|
| C1 | 真实 mv 到非规范名 → 仍降级 | `'mv specs/900-fix-x specs/renamed-nonstandard'` | `path === null`，`ambiguous === true` |
| C2 | 真实 git mv 到非规范名 → 仍降级 | `'git mv specs/900-fix-x specs/renamed-nonstandard'` | 同上 |
| C3 | `mv -f` 带 flag | `'mv -f specs/900-fix-x specs/901-fix-y'` | `path === 'specs/901-fix-y'` |
| C4 | 前置命令 + `&&` 后的 mv（段首在切段后成立） | `'cd . && mv specs/900-fix-x specs/901-fix-y'` | `path === 'specs/901-fix-y'` |
| C5 | heredoc 之后的 mv（F224 既有语义） | `'cat > specs/900-fix-x/fix-report.md <<EOF\nbody\nEOF\nmv specs/900-fix-x specs/901-fix-y'` | `path === 'specs/901-fix-y'` |
| C6 | 分号串联两跳 | `'mv specs/900-fix-x specs/901-fix-y; mv specs/901-fix-y specs/902-fix-z'` | `path === 'specs/902-fix-z'` |
| C6b | 裸管道串联两跳（第 2 轮 W1 characterization） | `'mv specs/900-fix-x specs/901-fix-y | mv specs/901-fix-y specs/902-fix-z'` | `path === 'specs/902-fix-z'` |
| C6c | 裸后台符 `&` 串联两跳（同上） | `'mv specs/900-fix-x specs/901-fix-y & mv specs/901-fix-y specs/902-fix-z'` | `path === 'specs/902-fix-z'` |
| C7 | 提名侧不受影响（`scanArtifactPath` 逐字未改） | Bash: `'echo "# 修复报告" > specs/902-fix-comment/fix-report.md'` | `path === 'specs/902-fix-comment'` |

**describe 3（第 3 轮新增）：时序与行为变化 characterization**

| # | 构造 | 命令文本 | 期望 | 说明 |
|---|---|---|---|---|
| T1 | 改名早于提名，不得倒灌（R3-C4，无提名前缀） | `'mv specs/900-fix-x specs/renamed-nonstandard; printf x > specs/900-fix-x/fix-report.md'` | `path === 'specs/900-fix-x'`，`ambiguous === false` | 与 HEAD 逐字一致的时序语义；防「提名与改名跨段倒灌」回归 |
| T2 | 带尾注释的真实改名（行为变化） | `'mv specs/900-fix-x specs/901-fix-y # 迁移'` | `path === 'specs/901-fix-y'` | HEAD 因把 `#` 与注释词当多余操作数而整条跳过；注释感知后被正确跟随，属**正确性改进** |
| T3 | 同上但目标名非规范（收窄未被放宽） | `'mv specs/900-fix-x specs/renamed-nonstandard # 迁移'` | `path === null`，`ambiguous === true` | 目标名仍须符合 `NNN-fix-<name>` 规范才不触发降级 |

### 新增 CLI 端到端测试（`fix-compliance-judge-cli.test.mjs`，新增 describe「F230 伪造改名 fail-open 反向回归（差分矩阵 A/D/E）」，风格对齐既有 F224 SC-005/SC-005b 用例）

统一前缀（对齐 fix-report 实测构造）：`SKILL_EXPANSION_LINE('fix')` + `TOOL_USE('Write', {file_path: 'specs/300-fix-decoy/fix-report.md', ...})`（**不** `mkdirSync` 落盘，复现"文件可以根本没写成功"）+ 1 次委派 + 末条 Bash。

| it 描述 | 委派 | 末条 Bash | 期望 |
|---|---|---|---|
| **A** 注释假 mv + verify 类委派 → 不得 exit 0 | `subagent_type:'spec-driver:verify'` | `` `true # mv specs/300-fix-decoy specs/renamed-nonstandard` `` | `runCli(...).status === 2`（非 0）；`report` 模式 `v.transcriptDiagnostics` 不含 `'feature-dir-unresolvable'` |
| **D** 引号内假 mv + verify 类委派 → 不得 exit 0 | 同上 | `` `echo 'mv specs/300-fix-decoy specs/renamed-nonstandard'` `` | 同上 |
| **F1** 裸参数假 mv（无注释无引号）+ verify 类委派 → 不得 exit 0 | 同上 | `` `echo mv specs/300-fix-decoy specs/renamed-nonstandard` `` | 同上 |
| **F8** 参数内引号藏 mv（第 3 轮 R3-C1）+ verify 类委派 → 不得 exit 0 | 同上 | `` `mv source "dest;mv specs/300-fix-decoy specs/renamed-nonstandard"` `` | 同上 |
| **F10** 注释内藏分号（第 3 轮 R3-C2）+ verify 类委派 → 不得 exit 0 | 同上 | `` `true # ; mv specs/300-fix-decoy specs/renamed-nonstandard` `` | 同上 |
| **C（正向保住）** 真实 mv + verify 类委派 → 继续 exit 0（F224 合法降级不得被误伤） | 同上 | `` `git mv specs/300-fix-decoy specs/renamed-nonstandard` `` | `status === 0`；`degraded === true`；诊断含 `'feature-dir-unresolvable'`（等价于既有 `unresolvableTranscript` 用例，本条为差分矩阵语境下的显式复核） |
| **E** implement-only 零验证类委派 + 真实 mv → 不得 exit 0 | `subagent_type:'spec-driver:implement'`, `description:'执行代码修复'`（仅此一条，无 verify/noop-verify 类） | `` `git mv specs/300-fix-decoy specs/renamed-nonstandard` `` | `status === 2`（非 0）；`report` 模式 `v.compliant === false` |
| **E 对照 1** canonical no-op 委派（`roleClass==='other'` + `noopVerify`）+ 真实 mv → 仍走降级（证明第 2 层未过度收紧到只认 `roleClass`，不误伤合法 no-op 收口） | `subagent_type: null`, `description:'交叉核实无需改动判定'` | `` `git mv specs/300-fix-decoy specs/renamed-nonstandard` `` | `status === 0`；`degraded === true` |
| **E2** implement 委派 + 描述含"确认"（`roleClass==='implement'` 且 `noopVerify===true`）+ 真实 mv → 不得 exit 0（Codex 审查发现的滥用面：加两个字即可重开降级） | `subagent_type:'spec-driver:implement'`, `description:'执行代码修复并确认'` | `` `git mv specs/300-fix-decoy specs/renamed-nonstandard` `` | `status === 2` |

## 附录：差分矩阵 A-E 构造脚本（fix-report 复现命令的自包含展开）

以下脚本基于 fix-report「实测差分矩阵」与「复现命令」章节，补全为可独立运行的构造 + 复现流程（不依赖测试框架，直接跑 CLI `--mode report`，与 fix-report 实测手法一致）。

```js
#!/usr/bin/env node
// scratchpad 脚本：复现 F230 差分矩阵 A-E（不落库，仅供实施/复核阶段本地跑）
// 用法：node repro-f230-matrix.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = path.resolve('plugins/spec-driver/scripts/fix-compliance-judge.mjs');
const FEATURE_DIR = 'specs/300-fix-decoy';

const envelope = (type, contentBlocks) => JSON.stringify({
  type, message: { role: type, content: contentBlocks },
});

const skillExpansion = () => envelope('user', [{
  type: 'text',
  text: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix\n请修复问题`,
}]);
const writeNominate = () => envelope('assistant', [{
  type: 'tool_use', name: 'Write',
  input: { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' },
}]);
const delegate = (subagent_type, description) => envelope('assistant', [{
  type: 'tool_use', name: 'Agent', input: { subagent_type, description },
}]);
const bash = (command) => envelope('assistant', [{
  type: 'tool_use', name: 'Bash', input: { command },
}]);
const assistantText = (text) => envelope('assistant', [{ type: 'text', text }]);

/** 统一前缀：fix 展开锚点 + Write 提名 decoy fix-report.md（不落盘）+ 1 次 verify 类委派 */
const PREFIX = [
  skillExpansion(),
  writeNominate(),
  delegate('spec-driver:verify', '交叉核实无需改动'),
];

const VARIANTS = {
  A_comment_fake_mv: [...PREFIX, bash('true # mv specs/300-fix-decoy specs/renamed-nonstandard'), assistantText('已完成')],
  B_no_bash: [...PREFIX, assistantText('已完成')],
  C_real_mv: [...PREFIX, bash('mv specs/300-fix-decoy specs/renamed-nonstandard'), assistantText('已完成')],
  D_quoted_mv: [...PREFIX, bash("echo 'mv specs/300-fix-decoy specs/renamed-nonstandard'"), assistantText('已完成')],
  E_implement_only_real_mv: [
    skillExpansion(),
    writeNominate(),
    delegate('spec-driver:implement', '执行代码修复'), // 仅 implement，零 verify 类
    bash('git mv specs/300-fix-decoy specs/renamed-nonstandard'),
    assistantText('已完成'),
  ],
};

const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f230-repro-'));

for (const [name, lines] of Object.entries(VARIANTS)) {
  const transcriptPath = path.join(os.tmpdir(), `f230-${name}.jsonl`);
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8');
  const res = spawnSync('node', [
    CLI, '--mode', 'report',
    '--transcript-path', transcriptPath,
    '--project-root', emptyDir,
  ], { encoding: 'utf8' });
  console.log(`\n=== ${name} ===`);
  console.log('exit(report 恒 0):', res.status);
  console.log('stdout:', res.stdout.trim());
}
```

修复前（master `ff78417`）预期输出：A/D/E 三行的 `transcriptDiagnostics` 均含 `"feature-dir-unresolvable"`（对应 fix-report 矩阵中标注"缺陷"的行）；修复后预期：A/D/E 的 `transcriptDiagnostics` 为 `[]` 且 `compliant:false`，C 保持 `transcriptDiagnostics` 含 `"feature-dir-unresolvable"`（合法降级不变），B 保持 `compliant:false`。

## 已知限界（延续 fix-report，不得表述为已解决）

1. **heredoc 正文首行若恰为裸 `mv <候选> <非规范名>`，仍会被跟随**：段切分按换行拆开 heredoc 正文，正文行与真实命令行在词法上同形。命令位锚定把伪造成本从「任意位置写 mv」抬高到「必须让 mv 独占一行的行首」，但未归零。彻底关闭需真正的 shell 解析器（须识别 heredoc 边界），会动到 F224 已冻结的「heredoc 后 mv 须被跟随」用例，属独立取舍。
2. **真实执行的 mv 仍可打开降级通道**：会话若真的把自己的特性目录 `mv` 到非规范名，且确有验证类委派，仍会 fail-open（F224 设计意图，差分矩阵 C 保留）。
3. **F227 已知限界一（冒用已存在的历史特性目录）不在本次范围**，与本次修复正交。
4. **命令位锚定会漏跟随若干不常见的合法前缀形态**：`sudo mv A B`、`FOO=1 mv A B`、`command mv A B`、`xargs mv` 等 `mv` 不在命令位的写法不再被识别为改名。后果不是无害的"少跟随一次"，而是**可能误阻断一次合法收口**：真实目录已被移动、且此后再无新的制品路径写入痕迹时，判定器仍拿旧路径去撞磁盘核验，会报"未建立特性目录"并 exit 2。方向上仍属保守（宁可误阻断，不可误放行）。不做前缀白名单：白名单本身就是新的可构造面（`sudo` 之类前缀词可被自由写入 transcript）。
5. **命令位扫描是 shell 语义近似而非完整解析**：`scanRenameCommandEvents` 跟踪单/双引号、反斜杠转义、`#` 注释与重定向操作符，但不解析 `$()`、反引号命令替换、heredoc body、别名、`case`/`for` 等复合结构。误判方向保守（不进入命令位 → 不跟随）。设计初稿的「引号字符奇偶配平」启发式已在第 2 轮审查 C1 中被证伪并删除；第 2 轮的「正则一次吞参数」已在第 3 轮 R3-C1 中被证伪并删除。
6. **`mv A B 2>&1` 形态不被跟随**（第 3 轮 W1）：`2>` 被 `parseRenameOperands` 当作第 3 个操作数，整条跳过。属**改动前既有行为**（旧正则同样在 `&` 处截断），本次不修，方向保守。
6. **第 2 层的 `noopVerify` 判据宽度由既有 no-op 合同决定**：`NOOP_VERIFY_ROLE_REGEX` 含"确认"/"核实"等宽词，一条描述含这些词的委派即可满足降级下界（实测 `description='确认无需代码修复'` 同时得 `roleClass='implement'` 与 `noopVerify=true`）。这里不得单方面收紧——降级下界必须被 `judgeCompliance` 的合规合同蕴含，收紧须两处同改，属独立取舍。

## Project Structure

```text
plugins/spec-driver/
├── scripts/
│   ├── fix-compliance-judge.mjs           # 改：evaluate() L164-178 判据收窄（第 2 层）
│   └── lib/
│       └── fix-compliance-core.mjs        # 改：新增 RENAME_COMMAND_NAME_REGEX + scanRenameCommandEvents + splitCommandTextSegmentSpans，applyRename→applyRenameEvent，主循环按偏移归段，删除孤儿 RENAME_COMMAND_SEGMENT_REGEX（第 1 层）
├── tests/
│   ├── fix-compliance-core.test.mjs       # 改：新增 2 个 describe 块
│   └── fix-compliance-judge-cli.test.mjs  # 改：新增 1 个 describe 块（A/C/D/E + noopVerify 对照，共 5 条 it）
specs/230-fix-compliance-forged-rename-failopen/
├── fix-report.md                          # 已存在（前序制品）
└── plan.md                                # 本文件
```

**Structure Decision**：单项目结构，改动完全落在既有 `plugins/spec-driver/scripts/lib/`（core 纯函数层）与 `plugins/spec-driver/scripts/`（judge 编排层）内，遵循既有分层惯例，不新增文件、不新增分层、不新增 fixture 文件（端到端测试延续 F224 SC-005/SC-005b 的内联构造风格）。

## Complexity Tracking

> Constitution Check 无 VIOLATION，本节为空。
