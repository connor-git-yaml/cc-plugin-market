# Phase E · 再生链与回归护栏归档（T104 / T106 / T107 ~ T112）

- 生成时点：2026-09-07 20:40，HEAD = `d86fa332`；执行者：编排器亲自（验证类任务）
- 终态证据文件：`scratchpad/delta-closeout.log`（清净窗口、串行；起始负载 1.06）与 `scratchpad/delta-repo-check.txt`（同轮 `repo:check` 全文）

## T104 · `npm run repo:sync` 再生并连带提交（FR-048）

- commit ② `d86fa332` 已连带 16 份 wrapper（换算式 |S| 8 × 2 分发目录 = 16，单位：wrapper 文件；S 由 T102 现取）。
- 提交后二跑幂等（T104 的「再生 diff 只含 S」在提交后的等价判据 = 插件 / `.codex` 侧零改动）：

```text
$ git status --porcelain | sort > e_before.txt; npm run repo:sync --silent >/dev/null 2>&1; git status --porcelain | sort > e_after.txt
  再生后改动条目: 19
  其中 plugins/.codex 侧: 0
  已回退无关产物 19；残余: 0
```
- 19 份无关再生产物（`specs/products/**/_generated/**` 与 `.specify/project-context.suggestions.*`，含时间戳 / 计数刷新）以 `git show HEAD:<path> > <path>` 定向回退，不提交。
- 与 FR-051 仲裁：再生产物与 A 交集为 0（见 `e-fr051-disjoint.md` §3），无「因冲突未执行的落点」。

## T106 · wrapper 守护项复跑（连带口径 (i)：须在 T104 之后）

```text
$ command grep -n 'spec-driver-wrappers:' delta-repo-check.txt
23:- spec-driver-wrappers:source-skills: pass
24:- spec-driver-wrappers:codex-wrapper-markers: pass
25:- spec-driver-wrappers:codex-plugin-distribution-markers: pass
26:- spec-driver-wrappers:codex-wrapper-runtime-namespace: pass
27:- spec-driver-wrappers:claude-project-overrides: pass
28:- spec-driver-wrappers:plugin-metadata-sync: pass
```

`codex-plugin-consistency:*` pass 计数：

```text
$ command grep -c 'codex-plugin-consistency:.*: pass' delta-repo-check.txt
12
```

第 3 项（`codex-wrapper-runtime-namespace`）pass ⇒ 本卡写入的散文块无 `mcp__` 字面量（连带口径 (ii)），与 `delta-closeout.log` 的 `mcp__: 0 文件` 一致。

## T107 ~ T111 · 五条护栏终态（清净窗口串行，全文引入）

```text
### start 20:26:10 load: { 1.06 1.14 1.17 }
### npm run build
> spectra-cli@4.5.0 postbuild
> node scripts/postbuild-stamp.mjs
[postbuild:stamp] 盖章: commit=4255212c (dirty)
build_exit=0
### npm run test:plugins
ℹ tests 1840
ℹ pass 1838
ℹ fail 0
### npx vitest run
 Test Files  548 passed | 4 skipped (552)
      Tests  8179 passed | 15 skipped | 12 todo (8206)
   Duration  63.53s (transform 5.97s, setup 0ms, collect 39.31s, tests 469.06s, environment 40ms, prepare 15.44s)
### npm run repo:check
[repo-check] status=warn
- graph-quality:freshness: warn
check id 总数: 95
### npm run release:check
Release contract valid (contracts/release-contract.yaml)
! [publish-gap] 发布断层领先量无法判定（sourceStatus: indeterminate）——npm registry 返回体缺 gitHead 字段。
release_exit=0
### FR-049 代理判据 + mcp__（相对 HEAD 的 SKILL/模板/agent 改动）
暂停: 1 文件
AskUserQuestion: 0 文件
mcp__: 0 文件
orchestration.yaml diff: 0
### end 20:28:01 load: { 17.97 6.15 3.04 }
done
```

| # | 命令 | 结果 | 归因需求 |
|---|---|---|---|
| T107 | `npx vitest run` | 548 files passed / 8179 tests passed / 0 failed | 不需要（零失败） |
| T108 | `npm run test:plugins` | 1840 tests / 1838 pass / 0 fail（差 2 = skipped） | 不需要 |
| T109 | `npm run build` | exit 0（类型检查零错误；不适用满载归因） | 不需要 |
| T110 | `npm run repo:check` | status=warn，仅 `graph-quality:freshness`（预存，sourceCommit 落后 HEAD） | 不需要 |
| T111 | `npm run release:check` | exit 0（`publish-gap` 提示为 registry 缺 gitHead，非失败） | 不需要 |

## T110 · check id 总数换算式（任务原文 94 → 实跑 95，追加而非改写）

```text
$ command grep -cE '^- [a-z][a-z0-9:_-]*: (pass|warn|fail)' delta-repo-check.txt
95
```
```text
$ command grep -n 'agent-docs:shared-section:\|agent-tools:required\|gate-mounting:effective-config' delta-repo-check.txt
6:- agent-docs:shared-section:branch-sync-policy: pass
7:- agent-docs:shared-section:mainline-focus: pass
8:- agent-docs:shared-section:context-layering: pass
9:- agent-docs:shared-section:release-contract: pass
10:- agent-docs:shared-section:repo-maintenance: pass
11:- agent-docs:shared-section:behavior-rules: pass
12:- agent-docs:shared-section:code-quality: pass
13:- agent-docs:shared-section:orchestration-overrides: pass
14:- agent-docs:shared-section:eval-credentials-policy: pass
15:- agent-docs:shared-section:dogfooding-policy: pass
16:- agent-docs:shared-section:orchestrator-gate-mounting-guard: pass
17:- agent-docs:shared-section:agent-output-discipline: pass
18:- agent-docs:shared-section:gate-tasks-scope-cut-acceptance: pass
19:- agent-docs:shared-section:gate-design-convergence-loop: pass
20:- agent-docs:shared-section:gate-verify-matrix-recompute: pass
99:- agent-tools:required: pass
100:- gate-mounting:effective-config: pass
```

换算式：**95 = 88（既有基线）+ 7（本卡新增）**，7 = `agent-docs:shared-section:*` **5**（块 1 ~ 4 + B+D 对抗修订新增的块 5 `gate-verify-matrix-recompute`，spec 修订记录 26）+ `agent-tools:required` 1 + `gate-mounting:effective-config` 1，单位：check id。任务原文的「94 = 88 + 6」写于块 5 之前，**不改任务原文、在此追加**；K14 `added` 清单同步为 15 项（裁定 I-1「当次已落地集合」）。与本卡直接相关：既有相关 21 + 新增 7 = **28** 项全 pass（单位：check id）。

## 历史红次登记（**不计入 SC-011**，仅留痕）

本卡 Phase A 期间两次全量跑批在满载下出现大面积失败（签名：`Timeout calling "onTaskUpdate"` birpc 假红 + 墙钟 3483 s / 3653 s，对照清净 63 ~ 69 s）：

```text
$ command grep -n 'Test Files|Tests  |Duration|load' phaseA2-full-verify.log
21: Test Files  28 failed | 519 passed | 4 skipped (551)
22:      Tests  46 failed | 8027 passed | 15 skipped | 12 todo (8100)
25:   Duration  3483.04s (transform 7.01s, setup 0ms, collect 548.10s, tests 26597.25s, environment 55ms, prepare 17.88s)
```
```text
$ command grep -n 'Test Files|Tests  |Duration|load|onTaskUpdate' phaseA2-isolated-rerun.log | head -6
1:### start 06:08:08 load: load averages: 1.11 3.45 5.14
64:Error: [vitest-worker]: Timeout calling "onTaskUpdate"
65:Error: [vitest-worker]: Timeout calling "onTaskUpdate"
66:Error: [vitest-worker]: Timeout calling "onTaskUpdate"
67:Error: [vitest-worker]: Timeout calling "onTaskUpdate"
68:Error: [vitest-worker]: Timeout calling "onTaskUpdate"
…（onTaskUpdate 共 22 行）
```

- 处置：按满载假红判定协议（F235 / F269 / F272 签名）改在清净窗口串行重跑，之后各阶段收口（`commit1-closeout.log` / `post-rebase-verify.log` / `phaseB-closeout.log` / `phaseD-closeout.log` / `fixBD-closeout.log` / `delta-closeout.log`）**六次全绿**。
- **诚实口径**：这两次红跑**未做 FR-050 三条件的正式归因记录**（当时以清净窗口重跑全绿收口，未逐条比对失败文件与 B 的交集、未登记 flaky 清单）；它们**不进入** SC-011 的分子或分母——SC-011 只计终态五命令。`phaseA-quiet-full.log` 的 10 个失败是 Phase A 中途（K14 / agent-tools 断言修前）的**真红**，非假红，已在后续任务修复。

## T112 · SC-011 汇总

换算式：（零失败命令数 5 + 已归因假红命令数 0）÷ 命令总数 5 = **100%**，单位：命令条。分母 5 = vitest 1 + test:plugins 1 + build 1 + repo:check 1 + release:check 1。归因记录：无需（分子全部来自零失败）。
