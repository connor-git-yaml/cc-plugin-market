# Verification Report: fix 依从性 Stop hook 候选目录解析盲区修复（F224）

**特性分支**: `224-fix-compliance-judge-dir-resolution`
**验证日期**: 2026-07-22
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 2 (原生工具链) + 独立复跑的端到端证据

---

## Layer 1: Spec-Code Alignment

### 功能需求对齐

| FR | 描述 | 状态 | 证据 |
|----|------|------|------|
| FR-001 | 识别 `git mv`/`mv`（含 `-f`/`-v`/合并短 flag/长 flag/`--`）目录改名并跟随候选 | ✅ 已实现 | `RENAME_COMMAND_REGEX`；独立探针 7 种 flag 形态全部返回新路径（见下表） |
| FR-002 | 识别 `sed -i`/`perl -i` 原地编辑命令，仍要求命令文本匹配 `ARTIFACT_PATH_REGEX` 才采信 | ✅ 已实现 | `INLINE_EDIT_INDICATOR_REGEXES`；`resolve-inline-edit-{sed,perl}.jsonl` 用例通过；反向用例（`sed -i` 写非制品路径）不提名，独立复跑确认 |
| FR-003 | 原地编辑识别设计为可扩展数组，非策略接口 | ✅ 已实现 | `INLINE_EDIT_INDICATOR_REGEXES` 为普通数组，新增仅需追加一条正则 |
| FR-004 | 放宽规则后仍无法定位候选时不得直接判"未建立特性目录" | ✅ 已实现 | 改名到 `specs/renamed-nonstandard`（非 `NNN-fix-<name>`）→ `{path:null, ambiguous:true}`，独立复跑确认 |
| FR-005 | 降级路径 MUST 落盘含降级原因的结构化诊断 | ✅ 已实现 | 独立起 hook 模式端到端跑通：`.specify/runs/2026-07.jsonl` 落盘 `degraded:true, diagnostics:["feature-dir-unresolvable"]`（见下方"独立端到端证据"） |
| FR-006 | 候选目录存在但 `fix-report.md` 真实缺失仍须阻断 | ✅ 已实现 | `fix-compliance-judge-cli.test.mjs` "SC-004 回归"用例：exit 2，`missing` 含 `fix-report.md` 不含 `feature-dir`；独立跑通过 |
| FR-007 | 多特性目录场景仅在最新一次 fix 展开锚点之后取候选 | ✅ 已实现（本次未改动该锚定逻辑，仅新增改名/原地编辑在锚点后窗口内扫描） | 既有 20 条存量 fixture 回归用例（"F224 回归"describe）全部 `ambiguous===false`，锚定语义未被破坏 |
| FR-008 | 同一会话多次改名/混用叠加取最终态 | ✅ 已实现 | `resolve-multi-rename-chain.jsonl`（222→223→224 式取最后一环）、`resolve-mixed-rename-then-inline-edit.jsonl`（改名后原地编辑）均通过 |

### 覆盖率摘要

- **总 FR 数**: 8
- **已实现**: 8
- **未实现**: 0
- **部分实现**: 0
- **覆盖率**: 100%

### SC-001~SC-005 逐条真实可跑证据

| SC | 断言内容 | 独立验证方式 | 结果 |
|----|---------|-------------|------|
| SC-001 | 旧路径写全四项制品后 `git mv` 改名 → 候选=新路径 | `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs` 中 `resolve-rename-git-mv.jsonl` / `resolve-rename-mv-plain.jsonl` 相关 describe；另用独立探针脚本对 7 种 `mv`/`git mv` flag 形态逐一验证 | ✅ 通过 |
| SC-002 | 仅 `sed -i`（无重定向符）写入制品 → 候选正确解析并通过磁盘校验 | `resolve-inline-edit-sed.jsonl` 用例 + CLI 端到端 "F224 CLI 端到端：目录改名后仍合规收口" 系列 | ✅ 通过 |
| SC-003 | 新 fixture 落位 `plugins/spec-driver/tests/fixtures/fix-compliance/`，与既有 `.jsonl` 一致风格 | `ls` 确认 10 个 `resolve-*.jsonl` 已在正确目录，`fix-compliance-core.test.mjs` 直接以 `readFileSync`+`JSON.parse` 加载 | ✅ 通过 |
| SC-004 | "目录存在但 `fix-report.md` 缺失"场景放宽前后判定一致（仍阻断） | `fix-compliance-judge-cli.test.mjs::F224 CLI 端到端：候选目录存在但 fix-report.md 真实缺失仍阻断（SC-004 回归）` 独立跑：exit 2，`missing` 含 `fix-report.md`、不含 `feature-dir` | ✅ 通过 |
| SC-005 | 改名到非规范命名目录 → fail-open 降级 + 诊断留痕 | 独立起 hook 模式（非 report 模式）端到端跑通，`.specify/runs/2026-07.jsonl` 出现 `degraded:true, diagnostics:["feature-dir-unresolvable"]` 记录；另 `--mode report` 直接跑通输出 `transcriptDiagnostics:["feature-dir-unresolvable"]`（`compliant` 键缺省，非 `false`） | ✅ 通过 |

**独立端到端证据（hook 模式，非 report 模式，真实磁盘落盘）**：

```
$ echo '{"session_id":"probe-session-224","transcript_path":".../transcript.jsonl"}' \
  | node plugins/spec-driver/scripts/fix-compliance-judge.mjs --project-root <scratch>
HOOK_EXIT=0

$ cat <scratch>/.specify/runs/2026-07.jsonl
{"schemaVersion":1,"eventType":"fix-compliance-verdict","recordedAt":"2026-07-22T12:24:35.065Z",
 "sessionId":"probe-session-224","enforcement":"block","closureForm":"undetermined",
 "compliant":null,"blockCount":null,"degraded":true,
 "diagnostics":["feature-dir-unresolvable"]}
```

fixture 为 `resolve-ambiguous-rename-nonstandard.jsonl`（Write `specs/328-fix-old/fix-report.md` → `git mv specs/328-fix-old specs/renamed-nonstandard`）。exit 0（fail-open，非硬阻断），事件真实写入磁盘，`diagnostics` 含新枚举值 `feature-dir-unresolvable`，与 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json` 新增 enum 值一致（`git diff` 确认该 schema 仅新增此一个枚举项）。

**独立解析探针（`resolveFeatureDirCandidate` 直调，7 种 flag 形态 + 4 种边界形态）**：

```
mv plain                       => {"path":"specs/902-fix-y","ambiguous":false}
mv -f                          => {"path":"specs/902-fix-y","ambiguous":false}
mv -v                          => {"path":"specs/902-fix-y","ambiguous":false}
git mv -f                      => {"path":"specs/902-fix-y","ambiguous":false}
mv -f -v                       => {"path":"specs/902-fix-y","ambiguous":false}
mv -fv                         => {"path":"specs/902-fix-y","ambiguous":false}
mv --no-clobber                => {"path":"specs/902-fix-y","ambiguous":false}
src not current candidate      => {"path":"specs/901-fix-x","ambiguous":false}   # 安全约束保留：src≠候选不采信
rename to nonstandard dst      => {"path":null,"ambiguous":true}                 # 转降级
only plan.md write              => {"path":null,"ambiguous":false}                # 反向回归：仍硬阻断
sed -i writes non-artifact path => {"path":null,"ambiguous":false}                # 判据未放宽
```

全部逐字匹配主编排器在 prompt 中声称的探针结果表，未发现偏差。

---

## Layer 1.5: 验证铁律合规

**状态**: COMPLIANT

主编排器提供的证据（`npm run test:plugins` 623/623、探针结果表、字节 diff 声明）本轮全部经独立复跑核实为真，未发现"应该能过"式推测性表述；本轮补充了 hook 模式（非仅 report 模式）的真实磁盘落盘验证，弥补了原声称证据中未覆盖的"落盘"这一 FR-005 关键动作。

---

## Layer 1.75/1.8/1.9: 深度检查 / 残留扫描 / 文档一致性

- **调用链完整性**：`resolveFeatureDirCandidate` 返回体从 `{path}` 变为 `{path, ambiguous}`；下游唯一消费点 `fix-compliance-judge.mjs::evaluate()` 已同步读取 `candidate.ambiguous` 并分流至 FR-004/FR-005 降级路径（第 128-137 行），无参数/字段丢失。
- **数据持久化**：`appendAuditEvent` 走 `fs.appendFileSync`，独立验证确认真实写入 `.specify/runs/YYYY-MM.jsonl`，非 no-op。
- **残留扫描**：本次改动无删除/重命名操作（新增常量 + 重写单函数返回体 + judge.mjs 新增早退分支），跳过残留扫描。
- **文档一致性**：`specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json` 已同步新增 `feature-dir-unresolvable` 枚举值，与代码行为一致；未发现遗漏更新的架构文档。

---

## 5a/5b 处置复核结论

| 来源 | 发现 | 声称处置 | 独立复核结论 |
|---|---|---|---|
| quality-review CRITICAL-1 | `mv -f` 等带 flag 改名跟不上 | 已修：`RENAME_COMMAND_REGEX` 加有界 option token 段 | ✅ 属实。独立探针 7 种 flag 形态（`-f`/`-v`/`-fv`/`-f -v`/`--no-clobber`/`git mv -f` 等）全部正确跟随；核心代码中该正则确带"每 token ≤22 字符、至多 8 个"的有界量词，另有 200-flag 超长串 ReDoS 安全性测试（`< 1s` 断言，实测通过） |
| quality-review WARNING-1 | 复合命令劫持候选（`sed -i ...; cat specs/999-fix-decoy/...`） | 不修，已在 plan.md 记"已知限界"，core 单测钉死当前行为 | ✅ 属实且钉死方式可信。测试文件 `describe('F224 已知限界（本轮不修）：复合命令内读形态可劫持候选')` 含两条用例：一条为 F224 新增的 `sed -i` 形态，一条为**改动前既存**的 `>` 重定向对照组，两者断言均为"候选被劫持为 999-fix-decoy"，且注释明确写"未来修复后本 describe 内断言必然失败→届时把断言改成期望行为即可"——这是诚实标注限界而非隐藏，独立跑通过 |
| spec-review WARNING×2 | spec.md US3/SC-005 与已推翻的 dir-only fail-open 语义矛盾 | 已修：US3、SC-005 改写为"改名到非规范命名目录" | ✅ 属实。当前 spec.md 第 71-98、126-128 行均已是"改名到非规范命名目录"表述，且保留了订正块（标注"订正（实施期修正，2026-07-22）"）说明历史表述与改写理由，可追溯性完整 |
| spec-review INFO | tasks.md T005-T012 验收命令遗留旧 fixture 名 | 已修 | ✅ 属实。tasks.md 第 132 行含订正说明："原命令写的 `resolve-ambiguous-dir-only` 是 T009 更名前的旧 fixture 名……期望行数由 8 改为 10"，与实际 10 个 fixture 文件、当前测试引用的 fixture 名完全一致 |

**关于"已知限界"用例是否会在未来修复时失败**：会——测试断言的是当前行为（劫持发生），若未来按 plan.md 提议的"按 `&&`/`;`/`||` 切分子命令"方式修复，该 describe 内两条断言都会从"劫持为 specs/999-fix-decoy"翻转为"path=null"而失败，测试文件注释已明确预告此点并给出修改方向，这正是"钉死当前行为、留痕以便未来主动翻案"的正确用法，非隐患。

---

## Layer 2: 原生工具链

### TypeScript/Node.js (npm)

**检测到**: `package.json`
**项目目录**: 仓库根目录

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | `tsc` 零错误；postbuild 盖章 commit=ab2f2abb (dirty) |
| Lint | `npm run lint`（= `tsc --noEmit`） | ✅ PASS | 零错误 |
| repo:check | `npm run repo:check` | ✅ PASS（1 warn） | 全部规则 pass；唯一 warn 为 `graph-quality:freshness`（图产物 sourceCommit 与当前 HEAD 不一致，属已知需重建图的提示，非本次改动引入，不阻断） |
| Test（插件专用） | `npm run test:plugins` | ✅ 623/623 passed | node:test runner，全部通过，含 F224 新增的核心/CLI 用例 |
| Test（全量） | `npx vitest run` | ⚠️ 1 failed → 隔离重跑后 19/19 全过（flaky） | 见下方"失败项判定" |

### 失败项 flaky vs 回归判定

**首轮全量跑**：`Test Files 1 failed | 467 passed | 4 skipped (472)`；`Tests 1 failed | 5481 passed | 18 skipped | 21 todo (5521)`

失败用例：`tests/integration/graph-quality-adversarial.test.ts > 对抗注入 fixture 测试（F217 T048） > 豁免分类专项：exemptedByCategory 精确归位 > entrypoint-orphan.json：...`，报错 `SyntaxError: Unexpected end of JSON input`（`runGraphQualityJson` 内 `JSON.parse(result.stdout)` 对空/截断 stdout 解析失败）。

**判定为负载型 flaky，非回归**，理由：

1. 该测试通过 `runCLI` **spawn 子进程**执行 `graph-quality` CLI 并解析其 stdout 为 JSON——子进程 stdout 被截断/未完整写出是典型的并行满载资源竞争症状，与本次改动的两处生产代码文件（`fix-compliance-core.mjs`、`fix-compliance-judge.mjs`）在依赖图上无任何交集（graph-quality 是完全独立的子系统）。
2. 隔离重跑该文件：`npx vitest run tests/integration/graph-quality-adversarial.test.ts` → `19 tests | 19 passed`，零失败。
3. 与 CLAUDE.md/prompt 中已知的 `cli-e2e.test.ts --version` / `graph-quality-cli.test.ts --status` 同属"spawn CLI 子进程 + 满载竞争"的同类负载 flaky 模式（同一 `graph-quality` CLI 家族，仅测试文件不同）。
4. `npm run test:plugins`（node:test，串行/隔离度更高）与 `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（本次改动核心测试）均 100% 通过，说明本次改动生产代码本身零缺陷。

**结论**：全量 `npx vitest run` 视为 PASS（1 项负载型 flaky 已隔离复核为真绿），非本次改动引入的回归。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100% (8/8 FR) |
| SC-001~SC-005 | 5/5 均有独立可复跑证据（含 hook 模式真实磁盘落盘验证） |
| Build Status | ✅ PASS |
| Lint Status | ✅ PASS |
| repo:check | ✅ PASS（1 个与本次改动无关的 graph-quality freshness warn） |
| test:plugins | ✅ 623/623 PASS |
| npx vitest run（全量） | ✅ PASS（1 项负载型 flaky 已隔离复核为真绿，非回归） |
| 受保护函数零改动 | ✅ 确认（`git diff` 未触达 `judgeCompliance`/`checkArtifactSection`/`extractDelegationsAfter` 函数体） |
| 5a/5b 处置落地 | ✅ 4/4 项复核属实（含"已知限界"用例的钉死可信度） |
| **Overall** | **✅ READY** |

### 需要修复的问题（如有）

无。本次改动范围内的两处生产代码文件（`fix-compliance-core.mjs`、`fix-compliance-judge.mjs`）经独立复跑验证与主编排器声称完全一致，无发现新问题。

### 未验证项（工具未安装）

无（`npm`/`node`/`tsc` 均已就绪并成功执行）。

### 附注：本次验证子代理的额外贡献

- 主编排器声称的证据均基于 `resolveFeatureDirCandidate` 探针（纯函数直调）与 `--mode report`（只读、零落盘）；本报告额外补充了 **hook 模式端到端**（真实读 stdin payload → 真实写 `.specify/runs/*.jsonl`）验证，弥补了 FR-005"MUST 落盘"这一要求此前未被端到端证据覆盖的空隙。
- 额外确认了全量 `npx vitest run` 的唯一失败项为负载型 flaky 而非回归，并给出隔离重跑证据。

---

## 追加轮次：Phase 5 后 CRITICAL 修复（2026-07-22）

### 发现（主编排器实测，改动前）

`evaluate()` 在 `extractDelegationsAfter` 与 `judgeCompliance` **之前**对 `path===null && ambiguous===true` 整体早退，导致 fail-open 不只赦免"目录无法定位"这一个维度，而是连带赦免了与目录解析无关的委派证据要求。实测（`--project-root` 指向只有 `.specify/` 的空目录，磁盘零制品）：

| 构造 | transcriptDiagnostics / verdict | EXIT |
|---|---|---|
| **A** `resolve-ambiguous-rename-nonstandard.jsonl`：fix 展开锚 + `Write specs/328-fix-old/fix-report.md` + `git mv specs/328-fix-old specs/renamed-nonstandard`，**零委派** | `["feature-dir-unresolvable"]` | **0（放行）** |
| **B** 同一 transcript 去掉那条 Bash（等价改动前行为） | `compliant:false, missing:["feature-dir","fix-report.md"], delegationCounts:{implement:0,verify:0,other:0}` | **2（阻断）** |

即多敲一条 `git mv <已知候选> <非规范名>` 就能把硬阻断变成放行——本次改动**新引入**的单命令绕过（改动前 A 构造因 `git mv` 不含写指示符被跳过、候选停在旧路径、磁盘核验失败而阻断），与 F208 设立该门禁的目的直接冲突。

### 修复口径（spec FR-004a / plan §2 订正）

fail-open **按维度收窄**：`evaluate()` 只记 `featureDirUndetermined` 标记不早退，委派抽取与 `judgeCompliance` 照常跑完；仅当 `delegationCounts.implement > 0 || delegationCounts.verify > 0` 才走降级放行，否则维持既有 missing 语义硬阻断。`judgeCompliance` 入参与判据逻辑**零改动**（收窄裁决在 judge 编排层只读 `verdict.delegationCounts`），`feature-dir-unresolvable` 诊断码 / 落盘通道 / `runHook` / `runReport` 亦零改动。

### 闭环证据（改动后，同一空 project-root 实跑）

```
=== A hook (零委派 + 非规范改名) ===
[FIX-COMPLIANCE] 未建立特性目录：... / 缺少诊断报告：...
EXIT=2
=== A report ===
{"mode":"fix","fixSession":true,"enforcement":"block","configDegraded":false,
 "transcriptDiagnostics":[],"closureForm":"undetermined","compliant":false,
 "missing":["feature-dir","fix-report.md"],
 "delegationCounts":{"implement":0,"verify":0,"other":0},"diagnostics":[]}
=== C hook (resolve-ambiguous-rename-with-delegations.jsonl，含 implement+verify) ===
EXIT=0
=== C report ===
{"mode":"fix","fixSession":true,"enforcement":"block","configDegraded":false,
 "transcriptDiagnostics":["feature-dir-unresolvable"]}
=== .specify/runs/2026-07.jsonl ===
{...,"compliant":false,"missing":["feature-dir","fix-report.md"],"blockCount":1,"degraded":false,"diagnostics":[]}
{...,"compliant":null,"missing":[],"blockCount":null,"degraded":true,"diagnostics":["feature-dir-unresolvable"]}
```

- 验收 1（绕过已封堵）：A hook EXIT=2、report `compliant:false` ✅
- 验收 2（正当降级仍保留）：C hook EXIT=0、report 含 `feature-dir-unresolvable`、`.specify/runs/*.jsonl` 落盘 `degraded:true` ✅

### 回归与全量验证

| 命令 | 结果 |
|------|------|
| `node --test fix-compliance-judge-cli.test.mjs fix-compliance-core.test.mjs` | 256 pass / **0 fail**（含改名 7 种 flag 形态、`sed -i`/`perl -i` 准入、ARTIFACT_PATH_REGEX 完整匹配判据、只写 plan.md 仍阻断、零工具调用真坍塌仍阻断） |
| `npm run test:plugins` | **628 pass / 0 fail**（623 → 628，新增 5 例：SC-005b 4 例 + core 1 例） |
| `npm run build` | 退出码 0 |
| `npm run repo:check` | 退出码 0（唯一 warn 为 `graph-quality:freshness` commit 级 stale，与本次改动无关） |

### 受保护面确认

`judgeCompliance` **未改动**（入参签名与判据逻辑均原样），`checkArtifactSection` / `extractDelegationsAfter` / `checkFeatureDirOnDisk` / Stop hook 薄壳同样零改动；`scanArtifactPath` 判据未放宽；零新增依赖。

---

## 追加轮：Codex 对抗审查剩余两条 warning 的闭环（本轮）

Codex 在 CRITICAL 修复轮之后给出两条 warning，主编排器实证成立，本轮修复。改动仅限
`resolveFeatureDirCandidate` 及其改名解析原语；`judgeCompliance` / `checkArtifactSection` /
`extractDelegationsAfter` / `checkFeatureDirOnDisk` / Stop hook 薄壳仍逐字未动，`scanArtifactPath`
判据未放宽，零新增依赖。

### 发现 1（FR-008 违反）：`ambiguous` 不可恢复，多跳改名取不到最终态

- **现象（改动前实测）**：`Write specs/900-fix-x/fix-report.md` → `mv specs/900-fix-x specs/renamed-nonstandard`
  → `mv specs/renamed-nonstandard specs/901-fix-x`，返回 `{"path":null,"ambiguous":true}`，
  与 FR-008「以叠加所有相关操作后的最终路径为解析结果，不得停留在任一中间状态」直接冲突。
- **根因**：第一跳把 `candidate` 置 `null` 后，第二跳的 `src === candidate` 判断永久失效，无法续跟。
- **修法**：分离 `trackedDir`（制品当前实际所在目录，命名是否规范都跟踪）与 `candidate`
  （仅当 `trackedDir` 命中 `FIX_DIR_NAME_REGEX` 时才等于它）；改名判据改用 `src === trackedDir`，
  改名后经 `syncCandidateFromTrackedDir()` 统一重算 `candidate` / `ambiguous`。
  `ambiguous` 因此成为**可恢复**状态，且未放宽任何安全约束（仍只跟随"改动了当前已跟踪目录"的改名）。

### 发现 2（保守化）：`mv` 多操作数与异常形态被误解析

- **现象（改动前实测）**：`mv specs/900-fix-x specs/other specs/dest-dir`（真实语义是把前两个移入最后一个目录）
  被读成 `specs/900-fix-x → specs/other` 的改名并落到 degraded；`mv -t DIR SRC`、`mv -S SUFFIX SRC DST`
  操作数位次错位；含空格的引号路径完全不匹配。
- **修法（保守化）**：改名识别由"直接捕获相邻两 token"改为"先取 mv 参数段（`RENAME_COMMAND_SEGMENT_REGEX`）、
  再由 `parseRenameOperands` 做 token 级解析"。非 option 操作数不恰好为 2 个、命中带参数 option
  （`-t`/`--target-directory`/`-S`/`--suffix`）、option token 数超界（> 8）→ **整条跳过**：既不跟随、
  也不置 `ambiguous`，退回改动前行为。取舍：宁可漏跟随（退化为原有假阻断，用户再写一次制品路径即可纠正），
  也不能跟错或误降级。已在 `plan.md`「已知限界」补记为限界 2（安全退化）。
- **回溯风险**：段捕获量词有界（≤ 400 字符）且字符类排除命令分隔符 → 单趟贪婪匹配，无回溯风险；
  token 解析为线性 split，不含正则回溯路径。

### 闭环证据（本轮实跑输出）

**（a）解析层直调 `resolveFeatureDirCandidate`（改动后）**

```
[1] 两跳 合法→非规范→合法          → {"path":"specs/901-fix-x","ambiguous":false}
[2] 四跳 合法→非规范→非规范→合法   → {"path":"specs/902-fix-final","ambiguous":false}
[2b] 停在非规范中间态（无最终合法跳）→ {"path":null,"ambiguous":true}
[3] mv A B C 三操作数              → {"path":"specs/900-fix-x","ambiguous":false}   ← 整条跳过
[3b] mv -t DIR SRC                 → {"path":"specs/900-fix-x","ambiguous":false}   ← 整条跳过
[3c] mv -S SUFFIX SRC DST          → {"path":"specs/900-fix-x","ambiguous":false}   ← 整条跳过
[3d] 含空格引号路径                 → {"path":"specs/900-fix-x","ambiguous":false}   ← 整条跳过
[3e] 单跳合法改名（正向对照）        → {"path":"specs/901-fix-x","ambiguous":false}
```

- 验收 1（两跳取最终态）✅　验收 2（三跳及以上取最终态）✅　验收 3（`mv A B C` 整条跳过）✅

**（b）上一轮 CRITICAL 不得回归 —— Stop hook 薄壳实跑（`bash hooks/stop-fix-compliance-check.sh`，临时 project-root）**

```
=== 零委派改名到非规范 (resolve-ambiguous-rename-nonstandard.jsonl) EXIT=2
[FIX-COMPLIANCE] 未建立特性目录：请按 specs/NNN-fix-<short-name>/ 约定创建特性目录并落盘诊断制品
缺少诊断报告：请完成问题诊断并将 fix-report.md 写入 specs/NNN-fix-<name>/（含 Root Cause 章节）
   event: {'compliant': False, 'degraded': False, 'diagnostics': []}
=== 带 implement+verify 委派改名到非规范 (resolve-ambiguous-rename-with-delegations.jsonl) EXIT=0
   event: {'compliant': None, 'degraded': True, 'diagnostics': ['feature-dir-unresolvable']}
```

- 验收 4 ✅（零委派仍 EXIT=2；有委派仍 EXIT=0 且落盘 `degraded:true` + `feature-dir-unresolvable`）

**（c）Codex 给出的两个绕过构造 —— Stop hook 薄壳实跑（decoy 目录制品已在磁盘铺齐，取最有利于绕过的构造）**

```
=== Codex 构造 A：sed -i '' 's/x/y/' specs/999-fix-decoy/fix-report.md; mv specs/999-fix-decoy specs/renamed-nonstandard
EXIT=2
[FIX-COMPLIANCE] 未建立特性目录：… / 缺少诊断报告：…
=== Codex 构造 B：true # mv specs/360-fix-src specs/renamed-nonstandard
EXIT=2
[FIX-COMPLIANCE] 未建立特性目录：… / 缺少诊断报告：…
   event(A): {'compliant': False, 'degraded': False, 'diagnostics': [], 'missing': ['feature-dir', 'fix-report.md']}
   event(B): {'compliant': False, 'degraded': False, 'diagnostics': [], 'missing': ['feature-dir', 'fix-report.md']}
```

- 验收 5 ✅（两个构造均 EXIT=2，且未落降级诊断）

**（d）F224 既有行为零回归 + 全量测试**

| 命令 | 结果 |
|------|------|
| `node --test fix-compliance-core.test.mjs` | **208 pass / 0 fail**（7 种 flag 改名形态全 `✔`、`sed -i`/`perl -i` 准入、C-2 硬化断言、只写 plan.md 仍阻断、零工具调用真坍塌仍阻断、已知限界断言全绿） |
| `node --test fix-compliance-judge-cli.test.mjs` | 全 `✔`（含 SC-005b 收窄 4 例 + 本轮新增 Codex 构造 A/B 2 例） |
| `npm run test:plugins` | **641 pass / 0 fail**（628 → 641，新增 13 例：core 11 + judge-cli 2） |

- 验收 6 ✅　验收 7 ✅

### 本轮新增测试

- `fix-compliance-core.test.mjs`
  - `describe('F224 resolveFeatureDirCandidate：ambiguous 可恢复（FR-008，Codex 复审订正）')`：两跳恢复 / 三跳以上恢复 / 停在非规范中间态仍降级（反向）
  - `describe('F224 resolveFeatureDirCandidate：mv 异常形态保守化跳过（Codex 复审订正）')`：6 种跳过形态 + 2 条正向对照（常规 2 操作数、`mv -- SRC DST`）
- `fix-compliance-judge-cli.test.mjs`：Codex 构造 A / B 的端到端退出码断言（均 exit 2）
