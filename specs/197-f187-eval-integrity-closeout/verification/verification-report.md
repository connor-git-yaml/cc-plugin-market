---
feature: 197
artifact: verification-report
phase: fix-verify
generated: 2026-06-14
status: PASS
---

# 验证报告 — F197 评测设施公正性收口

## 执行摘要

**阶段**: 验证闭环（FIX 模式 Phase 4c）
**状态**: PASS（全部门禁绿）
**产出制品**: specs/197-f187-eval-integrity-closeout/verification/verification-report.md
**关键发现**: 6 缺陷（C1/C2/W1/W2/W3/W4）+ CRITICAL fixtureContentHash 全部达成；构建零错误；全量 4522 测零失败；repo:check 通过。
**后续建议**: 当前存在 5 个未提交的 quality 收口改动（preregistration-check.mjs regex 收窄 + fail-closed 加固 / swebench-oracle.mjs regex 收窄 / 两测试文件），这些改动已通过测试，需提交纳入正式版本后方可进入 F188 fresh-freeze 流程。

---

## Layer 1: Spec-Code 对齐

### FR 覆盖统计

| 缺陷 | FR 来源 | 验收点 | 状态 |
|------|---------|--------|------|
| C1 排名污染 | FR-001-f / fix-report §C1 | classify-oracle 决策表行序：report.completed===true 上移到 OOM/timeout 启发式之前 | ✅ 已实现 |
| C2 freeze 不写 hash | FR-005 / fix-report §C2 | freeze-preregistration.mjs 产三字段（oracleSpecHash/fixtureContentHash/promptSha256）+ round-trip | ✅ 已实现 |
| W1 dataset 错配 | FR-A-002b / fix-report §W1 | datasetTagToHfId 映射 + DATASET_MISMATCH 归 fixture | ✅ 已实现 |
| W2 promptSha256 只写 | FR-005/FR-005-a / fix-report §W2 | 解析+比对+渲染三环闭合；computeDriverPromptSha256 export | ✅ 已实现 |
| W3 git 外锚未实现 | FR-005-d / fix-report §W3 | parsePreregistration 解析 gitCommit；checkPreregistration 注入 gitState；fail-closed | ✅ 已实现 |
| CRITICAL fixtureContentHash | Codex 审查升级 / fix-report §C2+ | computeFixtureContentHash 闭环比对；freeze 写入；cohort-batch 注入 live | ✅ 已实现 |
| W4 oracleSpecHash 覆盖面 | fix-report §W4 | 采用选项(b)：W3 git 外锚覆盖 runner 抽取逻辑，不纳入 runner 全文件 hash | ✅ 已实现（设计文档化） |

**覆盖率：7/7 FR（100%）**

---

## Layer 1.5: 验证铁律合规

**状态: COMPLIANT**

本次验证为 verify 子代理亲自执行命令所得，非前序实现子代理的声称，具体证据见 Layer 2。

---

## Layer 1.75: 深度检查

### C1 调用链完整性

`classifySwebenchResult` 内：行 7.5（`if (report && report.completed === true)`）位于 `isOOM/timedOut` 启发式（原行 8）之前，`resolved===null` 时显式 fall through（无 return），继续到原启发式。原行 9-11 中 `completed===true` 的 pass/fail 分支已删为死代码，`completed===false` 分支保留原位。调用链无断点。

### C2 数据持久化验证

`renderFrozenPrereg` 函数：条件渲染四扩展字段（oracleSpecHash/fixtureContentHash/promptSha256/schemaVersion），仅当 block 含该字段时输出，向后兼容非 swebench 冻结。`parsePreregistration` 已补解析三字段（promptSha256/gitCommit/fixtureContentHash）。round-trip 测试验证不丢字段。

### W3 fail-closed 验证

未提交 quality 改动将条件从 `!opts.gitState.trackedClean` 收窄为 `opts.gitState.trackedClean !== true`，并对 `codeMatchesFrozen` 同样收窄为 `!== true`。含配套测试三条（gitState 注入但字段 undefined → 拦截）。此为 Codex 处置 W2（gitState fail-closed）的体现。

### 配置贯穿验证

`computeDriverPromptSha256` 在 `eval-task-runner.mjs` 新增 export → `preregistration-check.mjs` 解析+比对 → `freeze-preregistration.mjs`（freeze 侧写入）→ `swe-bench-verified-cohort-batch.mjs` entryValidation（live 注入）。四环完整。

---

## Layer 1.8: 残留扫描

### 改动文件清单（相对 09f90ac）

已提交改动（9f90ac → HEAD，8 个脚本 + 5 个 spec/test 文件）：
- `scripts/eval-task-runner.mjs`
- `scripts/freeze-preregistration.mjs`
- `scripts/lib/classify-oracle.mjs`
- `scripts/lib/preregistration-check.mjs`
- `scripts/lib/swebench-dataset-build.mjs`
- `scripts/lib/swebench-oracle.mjs`
- `scripts/lib/swebench_fetch_rows.py`
- `scripts/swe-bench-verified-cohort-batch.mjs`
- `tests/unit/feature-176-batch.test.ts`（新增）
- `tests/unit/feature-176-preregistration.test.ts`（新增测试块）
- `tests/unit/feature-187-classify-oracle.test.ts`（新增 C1 三交叉）
- `tests/unit/feature-187-dataset-build.test.ts`（新建）
- `tests/unit/feature-187-freeze-block.test.ts`（新增 C2 块）
- `tests/unit/feature-187-swebench-oracle.test.ts`（新增 W1 块）

未提交 quality 收口改动（5 个文件）：
- `scripts/lib/preregistration-check.mjs`：regex 收窄 + fail-closed 加固 + 新增 W-2 测试
- `scripts/lib/swebench-oracle.mjs`：regex 收窄（去除宽泛 "不在" 匹配词）
- `tests/unit/feature-176-preregistration.test.ts`：W-2 fail-closed 三条测试
- `tests/unit/feature-187-classify-oracle.test.ts`：resolved=null 用例语义收紧（钉死 fail/candidate）
- `specs/src.spec.md`：自动生成产物，不应提交（已确认不在 staged）

**未发现旧 API 名称残留或孤立文件。**

---

## Layer 1.9: 文档一致性检查

fix-report.md 已记录 W4 覆盖关系说明（git 外锚覆盖 runner 抽取逻辑）。specs/176 host-runbook.md 已更新。无已删除概念的悬空引用。

---

## Layer 2: 原生工具链验证

**检测到**: TypeScript (Node.js) + vitest

注：macOS 环境无 `timeout`/`gtimeout` 命令，命令直接执行（无超时前缀）。

### 2.1 构建 — npm run build

```
命令：npm run build
退出码：0

输出摘要：
> spectra-cli@4.2.0 prebuild
> tsx scripts/inline-d3.ts

[inline-d3] d3-force 3.0.0 内容无变化，跳过写入

> spectra-cli@4.2.0 build
> tsc
（零 TypeScript 错误）
```

结果：✅ PASS

### 2.2 全量测试 — npx vitest run

```
命令：npx vitest run
退出码：0

Test Files  378 passed | 4 skipped (382)
Tests  4522 passed | 18 skipped | 20 todo (4560)
Start at  20:30:46
Duration  35.31s
```

**零失败。** 已知 flaky 文件 `batch-orchestrator-incremental.test.ts` 在本次运行中未失败（4522 通过包含该文件）。

结果：✅ PASS

### 2.3 repo:check — npm run repo:check

```
命令：npm run repo:check
退出码：0

全部规则通过（包含 release-contract / orchestration-overrides / preference-rules / delegation-contract / orchestrator-model / namespace-consistency）
```

结果：✅ PASS

---

## 逐验收点判定

### C1：classify-oracle 三交叉

| 用例 | 测试名 | 结果 |
|------|--------|------|
| resolved=true × log 含 "Killed" → pass | C1: resolved=true × log 含 "Killed" → pass/none | ✅ |
| resolved=true × log 含 "OOMKilled" × exit137 → pass | C1: resolved=true × log 含 "OOMKilled" × exit137 → pass/none | ✅ |
| resolved=true × harnessExitCode=137 → pass | C1: resolved=true × harnessExitCode=137 → pass/none | ✅ |
| resolved=null → fall through → fail/candidate（未提交收紧）| C1: report.completed=true × resolved=null → fall through 到 fallback，归 fail/candidate | ✅ |

**C1 达成。** 三交叉全绿，resolved=null 钉死 fail/candidate。

### C2：freeze-block 端到端

| 用例 | 测试名 | 结果 |
|------|--------|------|
| freezeBlock 含三字段 | freezeBlock 含三字段 | ✅ |
| renderFrozenPrereg frontmatter 含四扩展字段 | renderFrozenPrereg 产物 frontmatter 含四扩展字段 | ✅ |
| round-trip（render → parse）三字段不丢 | renderFrozenPrereg → parsePreregistration round-trip 三字段不丢 | ✅ |
| 重跑 renderFrozenPrereg 字段不丢 | 重跑 renderFrozenPrereg（相同 block 再渲染）字段不丢 | ✅ |
| freeze 端到端 → checkPreregistration(swebench-execution) → ok | freeze 端到端 → checkPreregistration(swebench-execution, 同一 oracleSpecInput) → ok | ✅ |

**C2 达成。**

### W1：dataset-build 映射 + 错配诊断

| 用例 | 测试名 | 结果 |
|------|--------|------|
| datasetTagToHfId('lite') 映射 | datasetTagToHfId('lite') | ✅ |
| datasetTagToHfId('verified') 映射 | datasetTagToHfId('verified') | ✅ |
| datasetTagToHfId(null) 向后兼容 | datasetTagToHfId(null) | ✅ |
| datasetTagToHfId('unknown') throw | datasetTagToHfId('unknown') | ✅ |
| 错配诊断 failureSource='fixture' + reason 含 '数据集错配' | 错配诊断 | ✅ |
| 未知 tag → classification=error / failureSource=fixture（swebench-oracle 层）| 未知 dataset tag → 不逃出 / classification=error / failureSource=fixture | ✅ |
| 真 infra 错误不被误归 fixture（regex 收窄后仍正确）| 非 DATASET_MISMATCH（真 infra）→ failureSource=infra | ✅ |

**W1 达成。** 未提交的 regex 收窄（移除宽泛 "不在"，保留 `DATASET_MISMATCH|未知 dataset tag`）已通过测试验证归因正确。

### W2/W3/CRITICAL：preregistration 三比对

| 用例 | 测试名 | 结果 |
|------|--------|------|
| computeDriverPromptSha256() 确定性 | computeDriverPromptSha256() 确定性 + 钉死定义 | ✅ |
| 改 buildDriverPrompt 源一字节 → hash 变 | 改 buildDriverPrompt 源一字节 → hash 变 | ✅ |
| 不符 promptSha256 → ok=false | prereg 含 promptSha256 + opts 传不符 live → ok=false 且 reason 含 promptSha256 | ✅ |
| prereg 无 promptSha256 → ok=true（向后兼容）| prereg 无 promptSha256，opts 传 live → ok=true | ✅ |
| prereg 有 promptSha256，opts 不传 → ok=true | prereg 有 promptSha256，opts 不传 → ok=true | ✅ |
| trackedClean=false → ok=false | W3 trackedClean=false → ok=false | ✅ |
| codeMatchesFrozen=false → ok=false | W3 codeMatchesFrozen=false → ok=false | ✅ |
| 两者均 true → ok=true | W3 两者均 true → ok=true | ✅ |
| gitState 仅 swebench-execution 生效 | W3 gitState 仅在 swebench-execution kind 生效 | ✅ |
| gitState 注入但 trackedClean=undefined → ok=false（fail-closed，未提交）| W-2: gitState 注入但缺 trackedClean（undefined）→ ok=false | ✅ |
| gitState 注入但 codeMatchesFrozen=undefined → ok=false（fail-closed，未提交）| W-2: prereg 含 gitCommit 但 gitState 缺 codeMatchesFrozen（undefined）→ ok=false | ✅ |
| 无 gitCommit + gitState 仅 trackedClean=true → ok=true（未提交）| W-2: prereg 无 gitCommit + gitState 缺 codeMatchesFrozen → 仅靠 trackedClean=true 放行 | ✅ |
| fixtureContentHash 内容敏感（改一字节 → hash 变）| computeFixtureContentHash 对 fixture 内容变化敏感 | ✅ |
| fixtureContentHash 顺序/重复无关 | computeFixtureContentHash 顺序/重复无关 | ✅ |
| 缺文件 → throw | computeFixtureContentHash 缺文件 → throw | ✅ |
| fixture 内容换版 → 比对拦截 | taskId 不变但 fixture 内容换版 → checkPreregistration 比对拦截 | ✅ |
| 旧格式无 fixtureContentHash → ok=true（向后兼容）| prereg 无 fixtureContentHash（旧格式）→ ok=true | ✅ |
| fixtureContentHash 一致 → ok=true | prereg 有 fixtureContentHash 且 opts 一致 → ok=true | ✅ |

**W2/W3/CRITICAL 全部达成。** 29 条用例（含未提交新增 3 条）全绿。

### feature-176-batch.test.ts — computePreregGitState

| 用例 | 结果 |
|------|------|
| clean + 无漂移 → trackedClean=true, codeMatchesFrozen=true | ✅ |
| worktree dirty → trackedClean=false | ✅ |
| 代码漂移（drift diff 非空）→ codeMatchesFrozen=false | ✅ |
| drift diff git 报错（exit≠0）→ codeMatchesFrozen=false（不因 stdout 空误放行）| ✅ |
| 无 frozenGitCommit → codeMatchesFrozen=true（无锚可比）| ✅ |

**computePreregGitState 达成。** 25 条用例全绿。

---

## 回归护栏核查

| 护栏 | 检查方法 | 结论 |
|------|---------|------|
| buildDriverPrompt 函数体零改 | `git diff 09f90ac..HEAD -- scripts/eval-task-runner.mjs` 仅新增 10 行 export computeDriverPromptSha256，函数体/签名/措辞无任何改动 | ✅ |
| classify-oracle spawnSync/harness 零改 | diff 仅插入 C1 行序块（8 行新增）+ 删除死分支 2 行；`spawnSync`/harness 调用链无触碰 | ✅ |
| 新增 export 均为纯新增 | `computeDriverPromptSha256`（eval-task-runner）、`computeFixtureContentHash`（preregistration-check）、`datasetTagToHfId`（dataset-build）均纯新增，无修改现有函数 | ✅ |
| importer/swebenchMeta 零改 | cohort-batch 改动限于 entryValidation preregOpts 注入块，importer 路径零触碰 | ✅ |
| 无评测产物入库 | `git status --short` 显示改动均为源码/测试/spec 文件；`specs/src.spec.md`（auto-generated）未 staged | ✅ |
| oracleSpecHash 变更预期 | C1（classify-oracle.mjs in SEMANTIC_MODULES）/ W1（swebench-dataset-build.mjs / swebench_fetch_rows.py in SEMANTIC_MODULES）改动使 hash 变为设计预期；旧 F176 prereg 不可用于 swebench-execution 模式（F188 fresh-freeze 前已知约束）| ✅ 设计预期 |
| 现有 swebench 正向单测保持绿 | feature-187-freeze-block.test.ts 全 17 条绿（含 swebench-execution + oracleSpecHash 正向用例）| ✅ |
| 无 specs/src.spec.md 纳入改动 | specs/src.spec.md 在 uncommitted 列表但未 staged，为 auto-generated 排除项 | ✅ |

---

## 未提交质量收口改动说明

以下 5 个文件存在未提交的改动，已通过所有测试，需在下次提交中纳入：

1. `scripts/lib/preregistration-check.mjs` — W3 fail-closed 加固（`!== true` 语义）+ 注释
2. `scripts/lib/swebench-oracle.mjs` — W1 regex 收窄（移除宽泛 `不在`，避免误归）
3. `tests/unit/feature-176-preregistration.test.ts` — W-2 fail-closed 三条新测试
4. `tests/unit/feature-187-classify-oracle.test.ts` — resolved=null 语义收紧（钉死 fail/candidate）
5. `specs/src.spec.md` — 自动生成产物，不应提交

这些改动对应 fix-report.md 中 Codex 审查处置的 W1（regex 收窄）和 W3（fail-closed undefined 拦截），是正式 quality review 阶段的收口，不属于遗漏实现。

---

## 总体结果

| 层级 | 结果 |
|------|------|
| Layer 1: Spec-Code 对齐 | ✅ 7/7 FR（100%） |
| Layer 1.5: 验证铁律合规 | ✅ COMPLIANT（本报告为亲自执行证据）|
| Layer 1.75: 深度检查 | ✅ 调用链完整 / 无 commit 遗漏 / 配置贯穿 |
| Layer 1.8: 残留扫描 | ✅ 无旧名称残留；specs/src.spec.md 未 staged |
| Layer 1.9: 文档一致性 | ✅ fix-report.md / host-runbook.md 已更新 |
| Layer 2: 构建（npm run build）| ✅ PASS（退出码 0，零 TypeScript 错误）|
| Layer 2: 测试（npx vitest run）| ✅ PASS（4522 passed / 0 failed / 18 skipped）|
| Layer 2: repo:check | ✅ PASS（全部规则通过）|

### 总体结论：✅ READY FOR REVIEW（有条件）

条件：需将 5 个未提交 quality 收口改动（preregistration-check.mjs + swebench-oracle.mjs + 两测试文件）提交后，再进入 F188 fresh-freeze 流程。`specs/src.spec.md` 不应提交。
