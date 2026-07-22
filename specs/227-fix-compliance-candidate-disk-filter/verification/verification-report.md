# Verification Report: F227 fix 依从性判定器候选目录解析盲区修复（方案 D）

**特性分支**: `claude/sweet-merkle-f04a1c`
**验证日期**: 2026-07-23
**验证范围**: Layer 1（Spec-Code 对齐，含六项证据核查）+ Layer 2（原生工具链）

本次验证针对 4 个改动文件（`plugins/spec-driver/scripts/fix-compliance-judge.mjs`、
`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`、
`plugins/spec-driver/tests/fix-compliance-core.test.mjs`、
`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`），设计依据
`fix-report.md`（方案 D 最终版）与 `tasks.md`（Phase 0-5，共 17 任务全部勾选）。

---

## Layer 1：六项证据核查

### 1. 状态机零改动

`git diff -U0 plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 核实：

- `resolveFeatureDirCandidate` 新增内容仅为：函数头 JSDoc（不变量说明 + 已知限界一/二）、
  函数体内新增 `candidateHistory`（`Map`）与 `pushCandidateHistory` helper 声明、
  `syncCandidateFromTrackedDir` 内新增一行 `pushCandidateHistory(trackedDir);` 调用、
  返回语句由 `{ path: candidate, ambiguous }` 改为
  `{ path: candidate, ambiguous, candidates: Array.from(candidateHistory.keys()) }`
- `scanArtifactPath`、`applyRename`、分段循环（`hasBashWriteIndicator`/`splitCommandTextSegments`
  调用顺序）**零增删行**——diff 中未出现这三处函数体的任何 hunk
- **结论：✅ 通过**。状态转移逻辑逐字未动，仅新增只读旁路。

### 2. 测试纯追加

`git diff -U0 plugins/spec-driver/tests/ | grep -cE "^-[^-]"` → **0**（无任何既有断言行被删除或修改）。

- **结论：✅ 通过**。

### 3. 单调性守卫在位

`fix-compliance-judge.mjs` 兜底触发条件确为：

```js
if (candidate.ambiguous === false && !usable(resolvedPath)) { ... }
```

对应回归用例 `fix-compliance-judge-cli.test.mjs:1064`「单调性不变量：ambiguous=true + 历史候选可用 →
兜底零介入，不得把 exit 0 反转为阻断」，其中 `withFixReportProbeSpy` 采集探针调用记录，
显式断言 `assert.deepEqual(probes, [], ...)`——ambiguous=true 时探针数组严格为空（连一次调用都没有，
不是"调用了但未选中"）。

- **结论：✅ 通过**。

### 4. 修复真实生效（亲自构造差分验证）

用 `git archive HEAD -- plugins/spec-driver | tar -x -C <tmp>/before` 取出改动前的完整源码树，
分别用改动前二进制与当前 worktree 源码对同一构造场景跑 CLI，比较 `--mode hook` 的进程退出码。

**场景 A · 幽灵覆写支**（`ambiguous=false`、主候选 `specs/300-fix-old` 磁盘不存在、
历史候选 `specs/300-fix-alpha` 磁盘上制品齐全——fix-report.md + verification/verification-report.md）：

| | BEFORE（改动前源码） | AFTER（当前 worktree） |
|---|---|---|
| `--mode report` | `compliant:false, missing:["feature-dir","fix-report.md"]` | `compliant:true, missing:[]` |
| `--mode hook` 退出码 | **exit 2**（硬阻断，输出"未建立特性目录""缺少诊断报告"） | **exit 0**（放行） |

与 fix-report.md 文档描述的复现结果逐字吻合。

**场景 B · F224 降级支**（`ambiguous=true`，transcript 内伪造 `mv specs/300-fix-alpha tmp/stage-a`
使候选被改名到非规范中间态）：

| | BEFORE | AFTER |
|---|---|---|
| `--mode report` | `transcriptDiagnostics:["feature-dir-unresolvable"]` | `transcriptDiagnostics:["feature-dir-unresolvable"]`（逐字相同） |
| `--mode hook` 退出码 | **exit 0** | **exit 0**（保持不变） |

- **结论：✅ 通过**。两条支路的差分结果与设计文档承诺（幽灵覆写支 exit 2→exit 0；
  F224 降级支 exit 0→exit 0 不变）完全一致，单调性不变量得到独立复现验证，非采信代码阅读。

### 5. 三条已知限界已写入 JSDoc

`grep -n "已解决\|已关闭\|完全保住\|彻底解决" plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
plugins/spec-driver/scripts/fix-compliance-judge.mjs` → **零命中**。

- 限界一（冒用已存在合规目录）与限界二（F224 fail-open 可被伪造 mv 触发，改动前既有缺陷、
  本次不引入不修复）写入 `fix-compliance-core.mjs` 的 `resolveFeatureDirCandidate` 头部 JSDoc
- 限界三（范围说明：本次修复只覆盖 `ambiguous===false` 支）就近写在
  `fix-compliance-judge.mjs::evaluate()` 兜底代码块的行内注释中
- 均无"已解决/已关闭/完全保住"字样，措辞与 fix-report.md 原文一致

- **结论：✅ 通过**。

### 6. tasks.md 勾选项抽查（非纸面接受）

抽查方式：对声称完成的关键任务做独立复核，不采信勾选本身。

| 任务 | 声称 | 独立复核方式 | 结果 |
|---|---|---|---|
| T009（core 层 `candidates` 只读旁路） | 已完成 | `git diff` 核实三处零改动 + `candidates` 字段存在 | ✅ 属实（见证据 1） |
| T010（judge 层兜底） | 已完成 | 核实兜底条件与单调性论证 | ✅ 属实（见证据 3、4） |
| T011（JSDoc 三条限界） | 已完成 | grep 禁用词 + 内容比对 | ✅ 属实（见证据 5） |
| T012/T013（既有回归零容忍） | 已完成 | 实跑 `node --test`，`test:plugins` 691 pass | ✅ 属实（见下方 Layer 2） |
| T015/T016/T017（收尾三项） | 已完成 | 实跑 `test:plugins`/`build`/`repo:check` | ✅ 属实（见下方 Layer 2） |

- **结论：✅ 通过**，抽查样本未发现"勾选但未落地"情形。

---

## 编排器声明的三项"已补齐"独立复核

编排器在本轮验证过程中声明前序收尾代理已补齐三项此前的未竟事项。**逐条独立复核**（不采信声明本身）：

### 未竟 1 · 性能回归用例

`grep -n "N = 20000" plugins/spec-driver/tests/fix-compliance-core.test.mjs` → 命中 `L2113`。
用例位于 `describe('F227 candidate history complexity - anti-regression anchor', ...)` 块，
构造单条 Bash 命令内 20,000 个互不相同的合法候选路径，断言：

- 语义不变量（`candidates.length === N`、首尾元素、`path === candidates[candidates.length-1]`、`ambiguous === false`）
- 性能不变量：`elapsedMs < 2000`（阈值取 2s，远高于 Map 版实测个位数 ms，远低于数组退化版本实测 3,034ms）

用例已计入 `npm run test:plugins` 通过总数（691，见下方 Layer 2），实测运行未见超时或 flaky。

- **结论：✅ 独立复核属实**。已从"未竟"转为已完成，本报告不再将其列为交付阻断项。

### 未竟 2 · 测试污染仓库运行态

`fix-compliance-judge-cli.test.mjs` L1119 起 `REPO_ROOT` 仍保留（供 `--mode report` 只读复验使用，
不落盘审计事件），但 L1176 附近的 `--mode hook` 用例已改用 `stageIsolatedRoot()`（隔离 tmp root）。

独立复核方式：单独隔离跑该测试文件前后比对 `.specify/runs/2026-07.jsonl` 行数：

```
before: 51
（node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs，70 tests all pass）
after:  51
```

增量为 0，污染已止血。**注**：历史遗留的 11 条既有伪造事件仍留在该文件中（该文件被 `.gitignore`
排除、不进仓，本次验证未擅自清理，处置交由用户决定）。

- **结论：✅ 独立复核属实**。已从"未竟"转为已完成。

### 未竟 3 · tasks.md 代码样例过时

`grep -n "ambiguous === false" specs/227-fix-compliance-candidate-disk-filter/tasks.md` → 3 处命中
（L137 显式禁止项说明、L140 代码样例、L165 显式禁止项标题），代码样例已与最终实现的带守卫版本一致，
无与实现相反的表述。

- **结论：✅ 独立复核属实**。已从"未竟"转为已完成。

**三项独立复核结论**：编排器的补齐声明**均属实**，非采信、已实测/实读验证。原任务书要求的
"未竟 1/2/3"不再作为 outstanding 项列入本报告，也不构成交付阻断。

---

## Layer 1.9：F224 spec.md 交叉对照（Phase 4a spec-review WARNING-2 闭合）

`specs/224-fix-compliance-judge-dir-resolution/spec.md`「核心权衡」段原文（L147）：

> 放宽仅作用于"候选目录路径的定位"这一环节，不改变判定器对制品内容实质性……与委派记录完整性的
> 既有校验逻辑；**候选目录被正确定位之后，后续所有实质性检查仍按现有严格标准执行，不因本次修复而降低。**

F227 的「已知限界一」（冒用已存在合规目录、位置不敏感化——不需要是最后一条提名，只要曾被合法
提名过就可能被兜底选中）实质是对上述隐含契约中"候选目录被**正确**定位"这一前提的一次收窄突破：
F227 之后，候选目录的"正确性"判据从"最后一条合法提名"放宽为"历史提名集合中任一磁盘可用者"，
且判定器原理上无法区分"会话写自己的目录"与"会话写他人的目录"（详见 fix-report.md 已知限界一原文）。

**偏离性质**：这不是对 F224 契约文字的直接违反（F224 承诺的是"实质性检查标准不降低"，
F227 未触碰任何实质性检查——章节校验、verification-report 存在性、委派计数、no-op 执行证据
逐字不变地作用在选中目录上），而是对"目录定位环节本身"松紧度的一次让步，且已被论证为**理论极限**：
真实案例（用户已知情、会话自身写自己的目录被 fixture 文本覆写）与冒用攻击（会话写他人已存在的
合规目录）在 transcript 文本上**完全同构**，判定器无法基于文本内容本身区分二者意图。

**独立兜底机制**：委派计数判据（`implement > 0 且 verify > 0`）与本限界正交，不受候选目录选择结果
影响——即便候选目录被冒用攻击命中，坍塌会话（无真实委派记录）仍会在下游判据独立触发阻断。
真实坍塌场景无法仅靠"冒用已存在目录"单一手段绕过完整判定链。

- **结论**：该偏离已如实记录、已交叉引用 F224 spec.md 原文对照、已论证为设计极限而非疏漏，
  且有独立正交机制兜底。**不构成新的未受控放宽**。

---

## Layer 2：原生工具链验证

**检测到**：`package.json`（JS/TS + npm），项目根目录。

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| 插件单测 | `npm run test:plugins` | ✅ PASS | 691 tests / 138 suites / **0 fail**（含 T004 F224 强不变量组、T005-T008 兜底触发条件、T002/T003 candidates 字段、性能回归用例，全部计入）|
| Build | `npm run build` | ✅ PASS | `tsc` 零错误；`postbuild:stamp` 正常盖章 |
| Repo Check | `npm run repo:check` | ✅ PASS | `status=pass`，全部约 75 项子检查（agent-docs 同步、marketplace、release-contract、graph-quality、spec-drift 等）逐项 pass，无 CRITICAL/WARNING |
| 全量测试 | `npx vitest run` | ✅ PASS | **483 test files passed \| 4 skipped (487)**；**5769 tests passed \| 18 skipped \| 21 todo (5808)**；耗时 51.71s；**本轮零 flaky 红，未触发隔离重跑**，因果上也不可能相关（本次 diff 仅 4 个 `.mjs` 文件、零 TS 源码改动）|

四条命令均**实际执行**并取得上述真实输出（非声称），退出码均为 0。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Layer 1 六项证据核查 | ✅ 全部通过（含亲自差分验证两条支路退出码）|
| 编排器声明的三项补齐 | ✅ 独立复核属实，非采信 |
| F224 spec.md 交叉对照（WARNING-2 闭合）| ✅ 已如实记录偏离性质，论证为设计极限，独立机制兜底 |
| 插件单测（`test:plugins`）| ✅ PASS 691/691 |
| Build | ✅ PASS |
| Lint | N/A（项目未配置独立 lint 命令，由 `tsc` 类型检查与 `repo:check` 承担） |
| Repo Check | ✅ PASS，无 CRITICAL/WARNING |
| 全量测试（`vitest run`） | ✅ PASS 5769/5769（本轮无 flaky 红需处置） |
| **Overall** | **✅ READY FOR REVIEW（通过）** |

### 结论：**通过**

本次 F227 修复的六项证据核查全部通过（含独立差分验证两条支路退出码，非仅代码阅读）；
此前任务书列出的三项"未竟事项"经独立复核，编排器补齐声明**均属实**——性能回归用例已落盘且
通过（N=20,000 < 2s）、测试污染已止血（实测 51→51 零增量）、tasks.md 代码样例已与实现一致。
三项均已从 outstanding 转为已验证完成，**不再构成交付阻断**。F224 spec.md 交叉对照显示本次
「已知限界一」是对候选目录定位环节松紧度的一次有据可查的让步，已被论证为理论极限、有独立
委派计数判据正交兜底，不构成新的未受控放宽。四条验证命令（`test:plugins`/`build`/`repo:check`/
`vitest run`）全部真实执行且零失败。

**唯一残留的非阻断性观察项**：`fix-compliance-judge-cli.test.mjs` 中历史遗留的 11 条伪造审计事件
仍留存在本地 `.specify/runs/2026-07.jsonl`（该文件被 gitignore、不进仓，不影响本次交付），
是否清理留待用户决定，本报告不代为处置。

### 需要修复的问题（如有）

无。

### 未验证项（工具未安装）

无（本仓库全部检测到的工具链均已安装并实际执行）。
