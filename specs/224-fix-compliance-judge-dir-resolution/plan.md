---
title: "fix 依从性 Stop hook 候选目录解析盲区修复 — 实现计划"
feature: "224-fix-compliance-judge-dir-resolution"
branch: "224-fix-compliance-judge-dir-resolution"
created: "2026-07-22"
status: "Draft"
---

# Implementation Plan: fix 依从性 Stop hook 候选目录解析盲区修复

**Branch**: `224-fix-compliance-judge-dir-resolution` | **Date**: 2026-07-22 | **Spec**: `specs/224-fix-compliance-judge-dir-resolution/spec.md`
**Input**: Feature specification from `specs/224-fix-compliance-judge-dir-resolution/spec.md`

## Summary

修复 `resolveFeatureDirCandidate`（`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`）的两个解析盲区：
（A）目录改名（`git mv`/`mv`）后候选仍停留旧路径，（B）不含重定向符的原地编辑命令（`sed -i`/`perl -i`）从未进入路径扫描。
技术方案：把该函数从"两类固定触发源的最后匹配覆盖"改造为**单次时间正序前向扫描**，在原有 Write/Edit + Bash 写指示符扫描基础上新增
（1）独立于写指示符门禁的改名命令识别（仅当改名源精确匹配"当前已知候选"时才采信，产出新目录或转入不确定态），
（2）用一组可追加的原地编辑命令正则（`sed -i`/`perl -i`）拓宽 Bash 写指示符门禁的准入条件（仍要求命令文本完整匹配 `ARTIFACT_PATH_REGEX` 才算写入证据），
（3）当已知候选被改名到**不符合 `NNN-fix-<name>` 命名**的目标目录、新位置确实无法机械确定时，返回体新增 `ambiguous: true` 标记。

> **实施期设计修正（2026-07-22，优先于本 plan 原文）**：`ambiguous` 的触发面**仅限**上述改名到非规范目录一种情形。原设计还打算在"命中松散 fix 目录痕迹但未命中制品全路径"时置 `ambiguous`（`FIX_DIR_LOOSE_REGEX` + `noteIfDirOnly`），经复核会把"建了特性目录、写了 plan.md/tasks.md、但从未写 fix-report.md"这一 F208 典型坍塌形态从硬阻断变为 fail-open 放行，属本次修复引入的新假阴性。故 **`FIX_DIR_LOOSE_REGEX` 与 `noteIfDirOnly` 均不落地**：该情形维持改动前语义（`path=null` → `missing` 含 `feature-dir`/`fix-report.md` → 硬阻断），既消除新假阴性，又使既有 codex C-2 反 Goodhart 断言（"仅目录路径 + 重定向不提名"、"Write 非 artifact 路径不提名"）零改动保留。详见 spec.md 该条 Edge Case 的订正说明。
`judgeCompliance` 与 `checkFeatureDirOnDisk`/`readArtifactFile` 等下游函数**零改动**——`ambiguous` 标记只在 `fix-compliance-judge.mjs` 的 `evaluate()` 编排层被消费：当 `path === null && ambiguous === true` 时，复用 F208 FR-013 既有的 fail-open 落盘通道（`transcriptDiagnostics` 早退路径 + `tryAppendFailOpenEvent`），追加诊断码 `feature-dir-unresolvable`，不产生 `compliant:false` 的确定性阻断结论；`path === null && ambiguous === false`（真坍塌，如 `collapsed-zero-delegation.jsonl`）维持原有"未建立特性目录"硬阻断语义不变。

## Technical Context

**Language/Version**: Node.js ≥20.x（`.mjs`，零外部运行时依赖，与 spec-driver 插件既有技术栈一致）
**Primary Dependencies**: 无新增；沿用仓库内 `node:test` + `node:assert/strict` 测试运行时
**Storage**: N/A（本次改动不涉及新的持久化结构；沿用 `.specify/runs/YYYY-MM.jsonl` 既有审计事件通道）
**Testing**: `node --test`（`plugins/spec-driver/tests/*.test.mjs`），CLI 层通过 `spawnSync` 端到端拉起 `fix-compliance-judge.mjs`
**Target Platform**: Claude Code / Codex Stop hook 运行时沙箱（Bash 5.x + Node ≥20.x）
**Project Type**: single（spec-driver 插件内部脚本修复，非新增模块）
**Performance Goals**: 与既有实现同量级（单次 O(entries × toolUseBlocks) 前向扫描，无新增 I/O，正则均为有界长度，不引入回溯风险）
**Constraints**: 零新增 npm 依赖；不改变 `judgeCompliance`/`checkFeatureDirOnDisk`/`readArtifactFile` 函数签名与行为；不新建平行诊断通道
**Scale/Scope**: 影响面收敛在单个函数（`resolveFeatureDirCandidate`）+ 其唯一编排层消费点（`evaluate()`），测试新增约 15-20 个用例 + 约 8 个新 fixture

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | plan/tasks 正文中文，标识符/正则/文件路径保留英文 |
| II. Spec-Driven Development | 适用 | PASS | 本次改动经 spec → plan → tasks → implement → verify 全流程，不直接改源码 |
| III. 如无必要勿增实体（YAGNI） | 适用 | PASS | 未引入 handler 注册表/策略接口/新抽象层；扩展点仅为 `INLINE_EDIT_INDICATOR_REGEXES` 一个可追加的正则数组（FR-003 要求的最小可扩展形式） |
| IV. 诚实标注不确定性 | 适用 | PASS | 本 plan 中的正则/命名细节均为具体设计而非推断；唯一 `[推断]` 项已在下方"改动清单"中标注 |
| IX. Prompt 编排 + Harness 强制 | 适用 | PASS | 未改变 Hook/Prompt 编排结构，仅修正判定核心的机械解析逻辑 |
| X. 零运行时依赖 | 适用 | PASS | 全部改动为 `.mjs` 内正则与纯函数逻辑，零新增依赖 |
| XI. 质量门控不可绕过 | 适用 | PASS | 不触碰 GATE_* 编排门禁；仅修正 Stop hook 内部一个纯函数的解析盲区 |
| XII. 验证铁律 | 适用 | PASS | tasks.md 中每个任务均含可执行验收命令；implement 阶段需实跑 `node --test` 全量 |
| XIII. 向后兼容 | 适用 | PASS（需验证） | 见下方"向后兼容论证"；新增 `ambiguous` 字段为返回体扩展而非替换，不破坏既有 `.path` 消费方 |
| XIV. 可观测性与架构守护 | 适用 | PASS | 降级路径复用既有可审计诊断落盘机制（FR-005），未引入静默吞异常分支 |

**结论**：Constitution Check 通过，无 VIOLATION，无需 Complexity Tracking 豁免条目。

## Codebase Reality Check

| 文件 | 行数 | 角色 | 已知 debt |
|------|------|------|-----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 562 | **主改动对象**：新增 3 个正则常量（修正后取消 FIX_DIR_LOOSE_REGEX） + 重写 `resolveFeatureDirCandidate` 函数体（预估净增 ~70-90 行） | 无 TODO/FIXME/HACK；无超长函数（现有最长函数 `judgeCompliance` ~80 行）；无循环依赖 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 429 | 改动对象：`evaluate()` 函数新增一个早退分支（约 6-8 行） | 无 debt 标记 |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | 335 | **零改动**（仅作为背景确认：`checkFeatureDirOnDisk`/`readArtifactFile` 接收字符串路径，与本次改动解耦） | 无 debt |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | 1447 | 测试新增落点：新增 describe 块（正/负向 + 既有 fixture 回归断言补充） | N/A（测试文件） |
| `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | ~710（估） | 测试新增落点：新增 CLI 端到端 describe 块 | N/A（测试文件） |

**前置清理判定**：`fix-compliance-core.mjs` 现 562 行 > 500 行阈值，且预估新增 ~70-90 行 > 50 行，触发系统默认的"前置清理"检查规则；但本 feature 的 Non-Goals 明确写明"不重构 `fix-compliance-core.mjs` 的整体判定链路或数据结构，仅在 `resolveFeatureDirCandidate` 及相关正则/扫描逻辑范围内做针对性修复"，且运行时上下文的 Guardrail 明确给出"改动后若逼近 800 行需评估是否先拆分"的更具体阈值。改动后预估行数 ≈ 562 + 85 ≈ 647 行，仍显著低于 800 行guardrail，且文件内部各函数职责边界清晰（无循环依赖、无超长函数）。**结论：不新增 [CLEANUP] 前置任务，不拆分文件**——这是对系统默认规则与本 feature 特定 Guardrail 冲突时，优先遵循后者（更具体、更贴合本次改动范围）的显式裁决。

## Impact Assessment

- **直接修改文件**：2 个（`fix-compliance-core.mjs`、`fix-compliance-judge.mjs`）
- **间接受影响（下游消费方）**：
  - `plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs`：仅在 doc 注释中提及 `resolveFeatureDirCandidate`，未实际 import/调用，**不受影响**
  - `plugins/spec-driver/hooks/stop-fix-compliance-check.sh`：薄壳调用 `fix-compliance-judge.mjs`，不感知内部返回体结构变化，**不受影响**
  - `judgeCompliance`、`checkFeatureDirOnDisk`、`readArtifactFile`：**零改动**，`ambiguous` 字段完全在 `evaluate()` 内被消费并短路，从不传入这些函数
- **跨包影响**：0（改动完全收敛在 `plugins/spec-driver/` 内部，不触及 `plugins/spectra/`、`src/`）
- **数据迁移**：涉及一处**纯增量**契约扩展——`specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json` 的 `diagnostics` 字段 `enum` 数组需追加 `"feature-dir-unresolvable"` 一项（该 schema 目前仅作文档契约，未被任何运行时 ajv/zod 校验消费，纯文档同步，无迁移脚本需要）
- **API/契约变更**：`resolveFeatureDirCandidate` 返回体从 `{ path }` 扩展为 `{ path, ambiguous }`——**新增字段、不删不改现有字段**，属于向后兼容的加法式变更；CLI `--mode report` 输出的 `transcriptDiagnostics` 字段值集合新增一个可能取值，字段结构不变
- **风险等级判定**：影响文件数 2（远低于 10）、跨包影响 0、无数据迁移脚本、公共契约变更为纯增量 → **风险等级：LOW**
- **是否强制分阶段**：风险等级 LOW，不触发 HIGH 风险强制分阶段规则；本次按单阶段交付（tasks.md 中仍保持"核心实现 → 正向测试 → 负向测试 → 既有回归 → 契约同步 → 全量验证"的顺序化任务流，作为质量把控而非风险分阶段）

## 改动清单

### 1. `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`

#### 1.1 新增正则常量（紧邻现有 `ARTIFACT_PATH_REGEX`/`BASH_WRITE_INDICATOR_REGEX` 之后）

```js
/**
 * 目录改名合法命名校验（FR-001）：改名后的新目录必须仍满足 `specs/NNN-fix-<name>` 命名规范，
 * 才能被采信为新候选；否则说明"改名到不符合命名规范的目录"（Edge Case 2），转入 FR-004 降级路径。
 * 整串锚定（^...$），允许尾随斜杠，与 ARTIFACT_PATH_REGEX 的目录前缀语义同源。
 */
export const FIX_DIR_NAME_REGEX = /^specs\/\d+-fix-[a-z0-9-]+\/?$/;

// 注：FIX_DIR_LOOSE_REGEX 原设计已按上方「实施期设计修正」取消，不落地。

/**
 * 目录改名命令**段**识别（FR-001 + 实施后 Codex 复审保守化订正）：
 * 捕获 `mv` / `git mv` 之后到最近一个命令分隔符（换行 / `;` / `&` / `|`）之前的整段参数文本，
 * 由 parseRenameOperands 做 token 级解析，仅在能唯一确定 `<src> <dst>` 时才返回二元组。
 * 全局匹配以支持复合命令内串联的多次改名。段捕获量词有界（≤ 400 字符）且字符类排除分隔符
 * → 单趟贪婪匹配，无灾难性回溯风险。
 *
 * 订正原因：原写法「直接捕获 option 段之后的相邻两 token 当 src/dst」会误解析异常形态——
 * `mv A B C`（真实语义是把 A、B 移入目录 C）被读成 `A → B` 的改名，进而误置 ambiguous 触发降级。
 */
export const RENAME_COMMAND_SEGMENT_REGEX = /(?:\bgit\s+mv\b|\bmv\b)([^\n;&|]{0,400})/g;

/** 其后紧跟独立参数的 option：出现即整条跳过（操作数位次错位，无法可靠解析） */
const RENAME_ARG_TAKING_OPTIONS = new Set(['-t', '--target-directory', '-S', '--suffix']);
/** option token 数量上界：超界视为异常形态，整条跳过（与旧实现的有界量词语义等价） */
const RENAME_MAX_OPTION_TOKENS = 8;

/**
 * 解析一段 mv 参数文本 → `[src, dst]` 或 `null`（null = 整条跳过：既不跟随、也不置 ambiguous）。
 * 保守化规则：非 option 操作数不恰好 2 个 → null；出现带参数 option → null；option 数超界 → null。
 * 引号仅剥除"首尾成对且内部无引号"的简单包裹；含空格的引号路径被空白拆散后操作数 ≠ 2 → 自然跳过。
 */
export function parseRenameOperands(segment) { /* 见实现 */ }

/**
 * 原地编辑命令识别（FR-002/FR-003）：可追加的正则列表——当前覆盖 `sed -i` 与 `perl -i`。
 * `.{0,40}?` 为有界惰性量词（防止长命令文本下的灾难性回溯），允许 `-i` 出现在工具名之后
 * 40 字符内的任意位置（兼容 `sed -i ''`、`sed -i.bak`、`perl -i -pe` 等常见变体）。
 * FR-003 的"可扩展"要求以此数组形式满足——新增形态只需向数组追加一条正则，无需改动
 * resolveFeatureDirCandidate 的扫描结构。
 */
export const INLINE_EDIT_INDICATOR_REGEXES = [
  /\bsed\b.{0,40}?-i\b/,
  /\bperl\b.{0,40}?-i\b/,
];
```

#### 1.2 重写 `resolveFeatureDirCandidate`

保持导出签名 `resolveFeatureDirCandidate(entries, anchorLineIndex)` 不变，函数体改为**单次按 `lineIndex` 正序的前向扫描**（原实现已是按序遍历，仅重组内部分支）：

- 维护**三个**累积状态（实施后 Codex 复审订正：原设计只有 `candidate` + `ambiguous` 两个状态，导致降级不可恢复、违反 FR-008）：
  - `trackedDir`：制品**当前实际所在目录**，无论命名是否规范都持续跟踪 —— 这是多跳改名能续跟的关键；
  - `candidate`：对外暴露的合法候选，仅当 `trackedDir` 命中 `FIX_DIR_NAME_REGEX` 时才等于 `trackedDir`，否则为 `null`；
  - `ambiguous`：`trackedDir` 非空但命名不规范时为真，**可恢复** —— 改名链后续跳回合法命名即自动撤销。
  订正前的缺陷：第一跳把 `candidate` 置 `null` 后，第二跳的 `src === candidate` 判断永远失效，
  `合法 → 非规范 → 合法` 的改名链会停在中间态返回 `{path:null, ambiguous:true}`，与 FR-008「以最终态为解析结果」相悖。
- 抽出三个内部辅助闭包（不导出，保持 `resolveFeatureDirCandidate` 为唯一公开入口；原设计的 `noteIfDirOnly` 已按「实施期设计修正」取消）：
  - `syncCandidateFromTrackedDir(): void` — 由当前 `trackedDir` 重算 `candidate` 与 `ambiguous`（命名规范 ↔ 合法候选，非规范 ↔ 降级），是"可恢复"语义的唯一收口点；
  - `scanArtifactPath(text): void` — 沿用现有 `ARTIFACT_PATH_REGEX` 扫描逻辑（取最后一次匹配的目录前缀写入 `trackedDir`，随后 sync），判据与改动前逐字一致；
  - `applyRename(command): void` — **独立于写指示符门禁**，对命令文本执行 `RENAME_COMMAND_SEGMENT_REGEX` 全局匹配，每段交 `parseRenameOperands` 解析：
    - 若 `trackedDir === null` → 整体忽略（尚无已知目录时的改名不产生任何信号，满足 FR-001「只跟随已知目录」）；
    - 若 `parseRenameOperands` 返回 `null`（异常形态）→ **整条跳过**：既不跟随、也不置 `ambiguous`，退回改动前行为（保守化：宁可漏跟随退化为原有假阻断，也不能跟错或误降级）；
    - 若 `src !== trackedDir` → 忽略（不相关的目录改名，满足 FR-007 锚定窗口与"不得混用/误取更早目录"的约束）；
    - 若 `src === trackedDir` → `trackedDir = dst` 并 `syncCandidateFromTrackedDir()`：`dst` 命名规范则跟随为新候选（FR-001 核心场景）、否则转入降级（Edge Case 2：目录已知失效但新位置无法确认，不继续用旧路径撞磁盘核验产生误报）。
- 主循环结构：
  ```js
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      const input = block.input || {};
      if ((block.name === 'Write' || block.name === 'Edit') && typeof input.file_path === 'string') {
        scanArtifactPath(input.file_path);
      } else if (block.name === 'Bash' && typeof input.command === 'string') {
        // 先提名再跟随改名：复合命令 `写制品 && mv 旧 新` 下，先提名才能让改名的 src 精确命中候选
        const writeGated = BASH_WRITE_INDICATOR_REGEX.test(input.command)
          || INLINE_EDIT_INDICATOR_REGEXES.some((re) => re.test(input.command));
        if (writeGated) scanArtifactPath(input.command);
        applyRename(input.command); // 改名识别不受写指示符门禁约束（FR-001）
      }
    }
  }
  return { path: candidate, ambiguous };
  ```
- **约束 #2 落地点**：`scanArtifactPath` 内部仍然要求命中完整 `ARTIFACT_PATH_REGEX`（含具体文件名后缀）才能定出 `trackedDir`/`candidate`；`INLINE_EDIT_INDICATOR_REGEXES` 只放宽"这条命令是否进入扫描"这一道**门禁**，不放宽"扫描到什么才算写入"这一道**判据**——两者严格分离，满足"新增的原地编辑识别必须要求命令文本完整匹配 `ARTIFACT_PATH_REGEX`"这一硬约束。
- **约束 #1 落地点**：`applyRename` 只在 `src === trackedDir`（精确匹配"当前已跟踪目录"）时才采信改名，不响应 transcript 中任何与当前追踪目标无关的 `mv` 命令，天然满足"多个 fix 特性目录场景不得混用"的既有 FR-007 语义（该语义本身由调用方传入的 `anchorLineIndex` 窗口 + 本次新增的"仅认已知候选"两道约束共同保障）。

### 2. `plugins/spec-driver/scripts/fix-compliance-judge.mjs`

`evaluate()` 函数内，在 `const candidate = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);` 之后、`checkFeatureDirOnDisk` 调用之前插入早退分支：

```js
const candidate = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);
if (candidate.path === null && candidate.ambiguous === true) {
  // FR-004/FR-005：候选目录无法唯一确定 ≠ 未建立特性目录的确定性不合规证据。
  // 复用既有 FR-013 fail-open 通道（与 transcript-unavailable 等诊断码同一落盘机制），
  // 追加可机读区分的降级原因 feature-dir-unresolvable，不产出 compliant:false 结论。
  return {
    enforcement, configDegraded, isFix: true, mode: anchor.mode,
    transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null,
  };
}
const delegations = extractDelegationsAfter(entries, anchor.anchorLineIndex);
const featureDirCheck = checkFeatureDirOnDisk(projectRoot, candidate.path);
// ...（其余逻辑不变）
```

> **Phase 5 后 CRITICAL 订正（2026-07-22，优先于上方代码片段）**：上述"在 `extractDelegationsAfter` / `judgeCompliance` **之前**早退"的写法**已废弃**。整体早退等于用"目录无法定位"一并赦免了与目录解析无关的委派证据要求，实测可被一条 `git mv <已知候选> <非规范名>` 利用：零委派、磁盘零制品的坍塌会话从 exit 2 变成 exit 0。落地口径改为**按维度收窄**（spec FR-004a）：
>
> ```js
> const candidate = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);
> // 只记标记、不早退：其余判据必须照常跑完
> const featureDirUndetermined = candidate.path === null && candidate.ambiguous === true;
>
> const delegations = extractDelegationsAfter(entries, anchor.anchorLineIndex);
> // ...（制品读取、closure 分类、judgeCompliance 全部原样执行；candidate.path=null 时
> //      checkFeatureDirOnDisk / readArtifactFile 已有 null 短路，返回 existsOnDisk:false / exists:false）
> const verdict = judgeCompliance({ ... });
>
> // 委派证据本身已足以证明坍塌 → 维持阻断；仅当存在收口类委派才降级放行
> const counts = verdict.delegationCounts;
> if (featureDirUndetermined && (counts.implement > 0 || counts.verify > 0)) {
>   return { enforcement, configDegraded, isFix: true, mode: anchor.mode,
>     transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null };
> }
> return { enforcement, configDegraded, isFix: true, mode: anchor.mode, transcriptDiagnostics: [], verdict };
> ```
>
> 判定口径为 `implement === 0 && verify === 0` 时阻断（而非要求二者同时 > 0）：no-op 合法收口只需 1 次 verify 类交叉核实、不含 implement，要求"两者皆有"会误伤该形态。降级仍走原通道，`feature-dir-unresolvable` 诊断码、落盘方式、`runHook`/`runReport` 零改动等约定全部不变；`judgeCompliance` 入参与判据逻辑同样**零改动**（收窄裁决发生在 judge 编排层，只读 `verdict.delegationCounts`）。

`runHook()`/`runReport()` **零改动**——两者已经统一处理 `result.transcriptDiagnostics.length > 0` 的早退分支（`runHook` 调 `tryAppendFailOpenEvent` 后 `return 0`，静默、不写 stderr、不 bump 阻断计数；`runReport` 原样把 `transcriptDiagnostics` 字段吐进输出 JSON）。这正是"复用既有机制、不新建平行诊断通道"约束的字面落地：新诊断码走的是**完全相同**的一段现有代码路径，没有新增任何 if/else 分支处理它。

### 3. `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`

`diagnostics.items.enum` 数组追加一项 `"feature-dir-unresolvable"`（放在 `"payload-invalid"` 之后），与代码新增的诊断码保持契约同步。该 schema 当前无运行时 ajv/zod 校验消费方（纯文档契约），此项改动零运行时风险，仅为避免契约文档漂移。

### 4. 关于"改名识别"与"原地编辑识别"的具体设计（汇总，呼应运行时上下文明确要求）

- **改名识别**：见 1.2 中 `applyRename` 设计——正则 `RENAME_COMMAND_REGEX` 抓取 `git mv`/`mv` 的 src/dst 两个 token；只有 src **精确等于**当前已解析出的 `candidate` 时才采信；dst 通过 `FIX_DIR_NAME_REGEX` 校验命名合法性决定是"确定性跟随"还是"转入降级"。**不识别**尚未有任何候选时发生的改名（`candidate === null` 时忽略），这是刻意的范围收敛（呼应 FR-001 原文"改变**已知**候选特性目录路径的操作"），避免把 transcript 中任意无关的 `mv` 命令都当作信号源。
- **原地编辑识别**：见 1.2 中 `writeGated` 判据——把原先单一的 `BASH_WRITE_INDICATOR_REGEX` 门禁，扩展为"命中写指示符 **或** 命中 `INLINE_EDIT_INDICATOR_REGEXES` 中任一原地编辑正则"的**或**门禁；命中门禁后仍必须让命令文本完整匹配 `ARTIFACT_PATH_REGEX`（未放宽这一判据），才会真正更新 `candidate`。这保证了"放宽准入、不放宽判据"的双层结构，直接响应约束 #2（禁止模糊匹配）。

## 无法定位候选时的 degraded 路径（FR-004/FR-005）

- **复用哪个 io 层函数**：不新增 io 层函数。`evaluate()` 早退分支直接返回 `{ ..., transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null }`，与 `readTranscriptEntries` 返回 `diagnostics: ['transcript-unavailable']` 时触发的早退分支**共享同一段 `runHook()`/`runReport()` 消费代码**（`if (result.transcriptDiagnostics.length > 0) { tryAppendFailOpenEvent(...); return 0; }`）。`tryAppendFailOpenEvent`（`fix-compliance-judge.mjs` 内既有函数，零改动）负责落盘：写入 `.specify/runs/YYYY-MM.jsonl` 的 `fix-compliance-verdict` 事件，`compliant: null`、`closureForm: 'undetermined'`、`degraded: true`、`diagnostics` 含 `feature-dir-unresolvable`（与配置层诊断如 `config-degraded` 合并去重后落盘）。
- **诊断 code 取值**：`'feature-dir-unresolvable'`——与既有 `transcript-unavailable`/`transcript-too-large`/`payload-invalid`/`internal-error`/`config-degraded`/`state-storage-unavailable` 并列，登记进 `fix-compliance-verdict-event.schema.json` 的 `diagnostics.items.enum` 数组（见改动清单第 3 项）。
- **与既有 code 的并列关系**：`transcript-unavailable` 类诊断发生在"连 transcript 都读不了/解析不了"这一更早的判定阶段（`readTranscriptEntries` 层面）；`feature-dir-unresolvable` 发生在"transcript 可读、fix 展开已锚定，但候选目录扫描后仍不确定"这一更晚的判定阶段（`resolveFeatureDirCandidate` 层面）。二者互斥（`evaluate()` 内部按顺序求值，命中前者直接早退，不会进入后者判定），但落盘的事件 schema 与处理路径完全一致，审计时可通过 `diagnostics` 数组的具体取值区分"哪一层判定失效"。

## 向后兼容论证（现有 20+ fixture 判定结果不变）

- **全量核对结论**：对 `plugins/spec-driver/tests/fixtures/fix-compliance/*.jsonl` 逐一核实（`Grep` 全目录 `"file_path":"specs/` 与 `"Bash".*"command":"[^"]*specs/` 两类模式），确认现存全部 fixture 中，凡涉及 `specs/301-fix-sample-bug` 路径的 `Write` 调用**均直接写入** `fix-report.md` 或 `verification/verification-report.md` 完整文件名，无一例外命中现有 `ARTIFACT_PATH_REGEX`；且**没有任何** fixture 的 `Bash` 工具调用文本中出现过 `specs/` 路径。这意味着：
  1. 所有既有 fixture 的 `candidate.path` 在改动前后**逐字保持一致**（`scanArtifactPath` 判据零改动；`applyRename` 只在命令含 `mv` 且 src 精确等于已知候选时才动作，既有 fixture 无一命中）；
  2. 新增的 `ambiguous` 字段对这些 fixture 恒为 `false`（唯一置真分支是 `applyRename` 的非规范 dst 分支，既有 fixture 从不触达），`evaluate()` 中新增的早退分支条件 `path === null && ambiguous === true` 对这些 fixture **恒不成立**，判定流程原样落入既有 `judgeCompliance` 分支，产出与改动前**完全相同**的 `compliant`/`missing`/`closureForm`。
  2b. 「实施期设计修正」取消 `noteIfDirOnly` 后，本次改动对**所有非改名、非原地编辑路径**的解析行为是**逐字零变化**——包括 codex C-2 硬化的三条负向断言（`echo` 纯提及不提名 / `cat` 读形态不提名 / 仅目录路径 + 重定向不提名）与 Write 非 artifact 路径不提名，全部原样保留、未做任何修改。
  3. `collapsed-zero-delegation.jsonl`（真坍塌场景，零工具调用）：`candidate.path === null`、`ambiguous === false`（循环体从未执行，两个状态量维持初始值），新增早退分支不触发，走原有 `featureDir: {path:null, existsOnDisk:false}` → `missing.push('feature-dir')` → 硬阻断，**行为不变**。
- **验证方式**：
  1. `implement` 阶段完成后，**不修改**任何既有 `.test.mjs` 文件中断言既有 fixture 结果的用例（除非本 plan 明确列出的"补充断言"任务），运行全量 `node --test "plugins/spec-driver/tests/fix-compliance-core.test.mjs"` 与 `"plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs"`，确认**零失败**即为回归证据；
  2. 额外补充一条 `describe('回归：改动前既有 fixture 判定结果不变')` 用例，遍历 `FIXTURE_DIR` 下全部 `.jsonl` 文件，对每个 fixture 调用 `resolveFeatureDirCandidate` 并断言 `ambiguous === false`（除非文件名以本次新增的 `resolve-ambiguous-*`/`resolve-rename-*`/`resolve-inline-edit-*` 前缀命名），把"新增字段不影响存量 fixture"这一论证转化为可执行、可长期防回归的机械断言，而非一次性人工核对。

## 风险与缓解（回应 spec"风险"一节）

- **核心张力**：放宽解析规则本质上扩大了"判定器认为已合规/需降级放行"的判定面，可能被利用来伪造无害操作换取放行。
- **本设计的三层闸门**：
  1. **判据不放宽，只放宽准入**——`scanArtifactPath` 内部判据（完整匹配 `ARTIFACT_PATH_REGEX`）在整个改动中未被触碰；`INLINE_EDIT_INDICATOR_REGEXES` 只决定"这条命令要不要被送进判据函数"，送进去之后能不能定出候选，标准与改动前完全一致。
  2. **降级 ≠ 静默放行**——`feature-dir-unresolvable` 命中后仍然落盘结构化诊断事件（`compliant: null`，非 `true`），事后审计可精确定位"这次放行是因为解析盲区、还是因为确实合规"（合规放行时 `judgeCompliance` 产出 `compliant: true` 且**不落盘** verdict 事件——两者在 `.specify/runs/` 审计轨迹上可机械区分：有 `feature-dir-unresolvable` 诊断事件 = 曾经历一次无法确认候选目录的放行）。
  3. **改名跟随范围收窄 + 降级触发面收窄**——`applyRename` 只响应"改动了当前已知候选"这一种改名，不响应 transcript 中任意目录改名；`ambiguous` 的唯一触发面是"已知候选被改名到非规范目录"，`noteIfDirOnly` 取消后不存在任何"只要出现目录字符串就转降级"的路径，fail-open 面较原设计显著缩小，"echo/cat 读形态排除"等既有反滥用语义逐字保留。
- **关于"决胜局"场景**（伪造一次无害 `sed -i` 命令但制品内容空洞）：即便攻击者让 `resolveFeatureDirCandidate` 定出一个"看似合法"的候选目录，`judgeCompliance` 后续的章节判据（`checkArtifactSection`）、委派计数、no-op 复现证据门等**全部现有严格标准原样生效**（本次改动完全不触碰这些函数），空洞制品仍会被 `artifact:placeholder`/`delegation:implement` 等既有 missing 枚举拦下。本次修复的作用半径严格限制在"候选目录路径的定位"这一个环节，不下放到"制品是否有实质内容"的判定。

## 已知限界（本轮不修）

> 记录于 Phase 5 quality-review，由主编排器实证。此节描述**当前行为**与不修理由，不是待办缺陷的隐藏。

### 限界 1：复合命令内的读形态可劫持候选目录

- **现象**：单条 Bash 命令由 `&&` / `;` / `||` 串联多个子命令时，只要**整条命令文本**任一处含写指示符（`>`/`>>`/`<<`/`tee`，或 F224 新增的 `sed -i`/`perl -i` 准入），另一处哪怕只是 `cat` **读取**某个无关特性目录的制品，该被读取的目录也会被提名为候选。
  - 实例：`sed -i '' 's/x/y/' notes.txt; cat specs/999-fix-decoy/fix-report.md` → 候选被劫持为 `specs/999-fix-decoy`。
- **根因**：写指示符门禁（`BASH_WRITE_INDICATOR_REGEX` / `INLINE_EDIT_INDICATOR_REGEXES`）与 `scanArtifactPath` 都对整条命令文本判定，未按子命令分段关联"写指示符"与"artifact 路径"是否共现于同一段。
- **改动前后同样存在（F224 非引入者）**：对照组 `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md` 只使用既有 `>` 门禁、完全不涉及 F224 新增的 `sed -i`/`perl -i` 准入，同样被劫持为 `specs/999-fix-decoy`。F224 只是让可复合出该形态的命令面略微变宽，未改变判据本身。两条实证均已在 `fix-compliance-core.test.mjs` 的 `describe('F224 已知限界（本轮不修）…')` 中钉死。
- **本轮不修的理由**：
  1. 按子命令切分会改动 C-2 反 Goodhart 硬化断言所依赖的**共享**扫描/门禁路径，影响面超出 `resolveFeatureDirCandidate` 一函数；
  2. 越过 spec Non-Goals「不重构 `fix-compliance-core.mjs` 的整体判定链路」；
  3. 越过 Constitution 约束 #1（禁止扩大改动面）。
- **危害有界**：劫持只影响"候选目录定位"这一环节，后续 `checkArtifactSection` / 委派计数 / no-op 复现证据门等严格判据原样生效；且被劫持指向的目录必须在磁盘上真实存在且制品齐全才能换来放行。
- **修法方向（留待后续 Feature）**：先按 `&&` / `;` / `||`（含换行）把命令切分为子命令序列，再要求「写指示符命中」与「artifact 路径命中」出现在**同一个**子命令内才允许提名；改名跟随（`applyRename`）同样按段处理。切分后需重跑 C-2 硬化用例与全量存量 fixture 回归，确认既有反滥用语义逐字不变。
- **回归可见性**：上述 `describe` 内的断言钉的是当前（有缺陷的）行为并在用例名标注「已知限界」；未来实现修复后这些断言必然失败，从而强制修复者显式把断言改写为期望行为（`path=null`），不会被静默跳过。

### 限界 2：`mv` 的异常形态一律**不识别**（安全退化，实施后 Codex 复审补记）

记录于实施后 Codex 对抗审查。以下 `mv` / `git mv` 形态**不被识别为改名**——整条跳过，既不跟随候选、也不置 `ambiguous`，行为等同于该命令不存在：

| 形态 | 示例 | 跳过判据 |
|------|------|---------|
| 多操作数（把多个源移入目录） | `mv specs/900-fix-x specs/other specs/dest-dir` | 非 option 操作数 ≠ 2 |
| 目标目录在前 | `mv -t DIR SRC` / `mv --target-directory DIR SRC` | 带参数 option 命中黑名单 |
| 备份后缀选项 | `mv -S .bak SRC DST` / `mv --suffix .bak SRC DST` | 同上 |
| 含空格的引号路径 | `mv "specs/900-fix-x" "some dir/x"` | 引号内空白拆散 token → 操作数 ≠ 2 |
| 单操作数 / option 数超界（> 8） | `mv SRC` / `mv -a0 -a1 … SRC DST` | 操作数 ≠ 2 / option 数超界 |

- **理由（保守化优先级）**：宁可**漏跟随**（退化为 F224 修复前的那类假阻断，用户再写一次制品路径即可纠正），也不能**跟错**或**误降级**。误跟随会把候选指向错误目录，误降级则会把硬阻断变成 fail-open 放行——后两者的代价远高于一次假阻断。
- **实证**：`mv A B C` 在订正前被读成 `A → B` 的改名并落到 degraded；订正后候选保持改名前的值、`ambiguous` 保持 `false`。
- **测试钉死**：`fix-compliance-core.test.mjs` 的 `describe('F224 resolveFeatureDirCandidate：mv 异常形态保守化跳过…')`（含 2 条对照用例证明常规 2 操作数形态与 `--` 结束符形态仍正常跟随）。
- **修法方向（若未来确有需求）**：引入真正的 POSIX 选项表（区分 flag 与 arg-taking option）+ shell 词法分析（处理引号与转义）。当前 YAGNI，不为低频形态引入 shell 解析器。

## Project Structure

### Documentation (this feature)

```text
specs/224-fix-compliance-judge-dir-resolution/
├── spec.md               # 已存在（story 模式前序制品）
├── plan.md                # 本文件
└── tasks.md               # Phase 2 输出（本次同批生成）
```

（story 模式跳过调研，不生成 research.md/data-model.md/contracts/quickstart.md；spec 已足够具体，无 `NEEDS CLARIFICATION` 待研究项）

### Source Code (repository root)

```text
plugins/spec-driver/
├── scripts/
│   ├── fix-compliance-judge.mjs           # 改：evaluate() 新增早退分支
│   └── lib/
│       ├── fix-compliance-core.mjs        # 改：新增 3 个正则常量（修正后取消 FIX_DIR_LOOSE_REGEX） + 重写 resolveFeatureDirCandidate
│       └── fix-compliance-io.mjs          # 不改（背景参考）
├── tests/
│   ├── fix-compliance-core.test.mjs       # 改：新增 describe 块（核心函数单测）
│   ├── fix-compliance-judge-cli.test.mjs  # 改：新增 describe 块（CLI 端到端）
│   └── fixtures/fix-compliance/
│       ├── resolve-rename-git-mv.jsonl            # 新增（US1 AS1）
│       ├── resolve-rename-mv-plain.jsonl           # 新增（US1 AS2）
│       ├── resolve-inline-edit-sed.jsonl           # 新增（US2 AS1）
│       ├── resolve-inline-edit-perl.jsonl          # 新增（US2 AS2）
│       ├── resolve-dir-only-plan-md.jsonl           # 新增（修正后：只写 plan.md → 仍硬阻断的反向回归）
│       ├── resolve-ambiguous-rename-nonstandard.jsonl  # 新增（Edge Case 2）
│       ├── resolve-multi-rename-chain.jsonl        # 新增（Edge Case：多次改名）
│       └── resolve-mixed-rename-then-inline-edit.jsonl # 新增（Edge Case：混用）
specs/208-fix-mode-process-compliance/contracts/
└── fix-compliance-verdict-event.schema.json  # 改：diagnostics enum 追加一项
```

**Structure Decision**：单项目结构（无 frontend/backend 拆分），改动完全落在既有 `plugins/spec-driver/scripts/lib/` 分层内，遵循该目录既有的 core（纯函数）/ io（I/O 边界）/ judge（CLI 编排）三层惯例，不新增文件、不新增分层。

## Complexity Tracking

> Constitution Check 无 VIOLATION，本节为空。
