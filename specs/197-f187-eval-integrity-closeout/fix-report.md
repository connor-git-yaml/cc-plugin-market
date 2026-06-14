# 问题修复报告 — F197 评测设施公正性收口

## 问题描述

F187（评测设施 v2，FAIL_TO_PASS oracle）已 ship 并验证（HEAD=09f90ac）。但 M8 跨切面对抗审查
（wf_c4c0461a，对抗验证确认）挖出 6 个真实缺陷（2 critical + 4 warning），全部"休眠"——仅在
F188 真跑 swebench-execution oracle（`manifest.swebenchOracle`，默认 gated off）时才咬人。
F188 跑批前必须全修，否则竞品完成率排名不可信。

本报告基于**逐行复读源码 + 运行时调用链追踪**确认 6 缺陷成立，并给出收口策略。

### 关键运行时调用链（诊断基础）

> 缺陷清单原文把 W2/W3 的"跑批前比对"落点描述为 preregistration-check.mjs，但**真正的运行时
> 入口校验在 `scripts/swe-bench-verified-cohort-batch.mjs:161 entryValidation`**：它 line 180 构造
> `buildLiveOracleSpecInput(manifest)`、line 181 调 `checkPreregistration(taskIds, PREREG, preregOpts)`。
> 因此 W2/W3 的修复需 **lib（解析 + 比对原语）+ cohort-batch（注入 live 值）双侧落地**。

```
F188 跑批 → swe-bench-verified-cohort-batch.mjs main()
  → entryValidation(args)                         [入口 hard-gate]
    → buildLiveOracleSpecInput(manifest)          [:97 算 live oracleSpecInput]
    → checkPreregistration(taskIds, PREREG, opts) [:181 预注册一致性校验]
  → 每个 (task×cohort×repeat) → eval-task-runner.mjs
    → buildDriverPrompt(...)                       [:171 prompt 模板]
    → 抓候选 patch（git diff exclude-pathspec）    [:922-931 — hash 外]
    → runSwebenchInstance(...)                     [swebench-oracle.mjs]
      → buildLocalDataset(...)                     [:123 — 不传 datasetName = W1]
      → classifySwebenchResult(...)               [classify-oracle.mjs:79 短路 = C1]
  → classifyRunForRanking(primaryOracle)          [error→null 剔除分母]
```

冻结侧唯一 shipped 工具：`scripts/freeze-preregistration.mjs`（C2 落点）。

---

## 5-Why 根因追溯

### C1 — classify-oracle 排名污染

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 真实 resolved=true 的 PASS 为何被判 fail？ | classify-oracle.mjs:79 `(timedOut\|\|killed\|\|isOOM)&&reachedTestExec` 短路 return `fail/candidate` |
| Why 2 | 该短路为何先于 report 权威判定执行？ | 行 8（:79）排在行 9-11 report 判定（:84-88）**之前**；先到先 return |
| Why 3 | 为何 isOOM 会被触发？ | isOOM = `exit137 \|\| /OOMKilled\|\bKilled\b/.test(log)`（:55）；swebench-oracle.mjs:149 把容器 `run_instance.log` 拼进 logText |
| Why 4 | 为何"Killed"会出现在成功 run 的日志里？ | docker/pytest 子进程正常生命周期、OOM-reaper 历史行、依赖编译期 OOM 重试等都可能在 runLog 留 "Killed" 字样，即使最终 resolved=true |
| Why 5 | 为何未被现有机制捕获？ | 单测只覆盖"timeout→fail"正路，未构造 `{report.resolved=true} × {log 含 Killed/OOMKilled} × {exit137}` 交叉；该路径默认 gated off，CI 永不触发 |

**Root Cause**：决策表行序错误 —— 启发式（timeout/OOM/phase）排在 harness 权威 report 之前。
**污染机理**：日志含 "Killed"/exit137 与 cohort **内容相关**（不同 patch 触发不同依赖编译/内存行为）、
**不对称**（只把 PASS 洗成 fail，不会反向），直接污染竞品完成率排名。

**修复方向（C1）**：**仅把 `report.completed===true` 分支**（resolved===true→pass / resolved===false→fail）
**上移到行 8 timeout/OOM 启发式之前**，实现"report.completed===true 时无条件以 report.resolved 判，
仅 report==null 才回退启发式"。
- ⚠️ **不**整块上移：`report.completed===false → error/infra` 必须**留在原位（启发式之后）**。
  原因：候选 patch 致测试无限循环 → watchdog timeout → harness 被杀 → 若残留 completed=false report，
  此时应由行 8 启发式判 candidate fail（候选责任），不能被 completed===false 洗成 error 剔分母。
  （实测多数 timeout 下 report==null；但保守保留此序避免 completed===false×timeout 回归。）
- 保留行 1-7（docker daemon/命令缺失/镜像层/segfault/无-report-patch-apply-fail/pytest-exit5/
  pre-test-timeout）在 report 块之前——这些是 report 不可信的硬 infra 前置（spec line 10：
  exit139/SIGSEGV 例外优先级高于 Q1）。
- 落地形态：在行 7（pre-test timeout，:75-77）与行 8（:79）**之间**插入：
  `if (report && report.completed === true) return report.resolved===true ? pass : fail(candidate);`
  原行 9-11 的 completed===true 两分支随之成为死分支可删；completed===false 分支保留。
**测试**：`{resolved:true}×{log 含 "Killed"}`、`×{log 含 "OOMKilled"}`、`×{harnessExitCode:137}`
三交叉用例，断言 classification==='pass'（不被洗 fail）。

### C2 — 生产冻结工具不写 hash

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | swebench-execution 门禁为何对生产冻结产物必 hard-fail？ | preregistration-check.mjs:157 对 swebench-execution kind 缺 oracleSpecHash → hard-fail |
| Why 2 | 生产冻结产物为何缺 oracleSpecHash？ | freeze-preregistration.mjs:74 调 `freezeBlock(taskIds, {seed:176})`，不传 oracleSpecInput/fixtureContentHash/promptSha256 |
| Why 3 | 即便传了，frontmatter 为何仍无这些字段？ | renderFrozenPrereg（:39-52）**硬编码** frontmatter 行清单，不渲染 block 上的扩展字段 |
| Why 4 | 为何 lib 支持但工具不接？ | F187 扩展了 lib 的 freezeBlock（:177-195 已支持三字段）与 checkPreregistration 校验侧（焊死要求 oracleSpecHash），但生产冻结工具侧（T026）未同步实现 |
| Why 5 | 为何未被捕获？ | 唯一 shipped 冻结工具从未在 swebench-execution 模式下端到端跑过（gated off）；校验侧单测用手工构造 block，绕过了真实工具 |

**Root Cause**：校验侧（焊死要求）与生产冻结侧（无法满足）合约断裂 —— 单边实现。
**修复方向（C2）**：
1. freeze-preregistration.mjs 增 `--swebench-oracle`（可选 `--manifest`）开关；开启时
   **复用 cohort-batch 的 `buildLiveOracleSpecInput(manifest)`** 算 oracleSpecInput（保证 freeze↔check
   口径**逐字一致**，杜绝"算法分叉致永久 mismatch"），并算 fixtureContentHash + promptSha256，
   传入 freezeBlock。
2. renderFrozenPrereg 渲染 `schemaVersion / oracleSpecHash / fixtureContentHash / promptSha256`
   （仅当 block 含该字段时输出，向后兼容非 swebench 冻结）。
3. **再跑一次不抹掉**：复跑 freeze 不应丢字段。
**测试**：注入 stub 的 oracleSpecInput，断言产物 frontmatter 含三字段且 parsePreregistration 能解析；
端到端 freeze→checkPreregistration(oracleKind:swebench-execution, oracleSpecInput=同一输入) → ok。

### W1 — Lite/Verified dataset 错配

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | Verified 实例为何 oracle 报 error/infra？ | swebench-oracle.mjs:123 调 `buildLocalDataset({fixtures,...})` 不传 datasetName |
| Why 2 | 不传 datasetName 有何后果？ | buildLocalDataset 默认 `DEFAULT_DATASET='SWE-bench/SWE-bench_Lite'`（swebench-dataset-build.mjs:14/58） |
| Why 3 | 为何 Lite 取不到 Verified 行？ | swebench_fetch_rows.py:`missing → return 1`；Verified cohort 8/10 实例不在 Lite → 整批 fetch exit 1 → throw |
| Why 4 | throw 之后为何静默剔分母？ | swebench-oracle.mjs:124-128 catch → error/infra OracleResult → cohort-batch classifyRunForRanking=null → **静默移出分母** |
| Why 5 | 为何违反 spec 仍未被捕获？ | 违反 FR-A-002b（禁跑后剔 task）；但只有真跑 Verified fixture 才触发，gated off → 单测从未喂 Verified 实例 |

**Root Cause**：dataset 标识在 fixture（`swebenchMeta.dataset='verified'|'lite'`，importer 已写）里，
但取官方行链路全程硬编码 Lite，未透传 fixture 的 dataset 标签。
**修复方向（W1）**：
1. swebench-oracle.mjs 从 `fixture.swebenchMeta.dataset` 映射 HF id（`lite→SWE-bench/SWE-bench_Lite`、
   `verified→SWE-bench/SWE-bench_Verified`）透传给 buildLocalDataset。映射放共享小函数 `datasetTagToHfId`
   （单一来源，freeze/oracle 共用）。
2. buildLocalDataset / fetchOfficialRows 对"实例不在 dataset"产**明确"数据集错配"诊断**
   （failureSource='fixture' + reason 含 dataset 名 + missing 实例），与真 infra（venv 缺/网络）区分，
   不再笼统 error/infra。
3. **不静默剔分母**：dataset 错配是 fixture 级配置错误（应人工修 fixture 标签），区别于 candidate fail；
   仍标 error 但 reason 明确指向"错配"而非"infra"，便于 F188 跑前发现而非跑后才察觉 N 缩水。
**测试**：构造 swebenchMeta.dataset='verified' 的 fixture，stub fetch helper 返回 missing →
断言 reason 命中"数据集错配/dataset"且失败源可归因；映射函数单测覆盖 lite/verified/未知标签。

### W2 — promptSha256 write-only

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | prompt 模板漂移为何不被拦？ | checkPreregistration（:126-170）不比对 promptSha256 |
| Why 2 | 为何不比对？ | parsePreregistration（:72-108）根本不解析 promptSha256 字段 |
| Why 3 | freezeBlock:192 写了为何无效？ | 写入的是内存 block，被 renderFrozenPrereg（C2）硬编码 frontmatter 丢弃 → 文件里压根没有 |
| Why 4 | 为何设计成 write-only？ | F187 把 promptSha256 列入 freezeBlock schema（FR-005）但漏接解析 + 比对 + 渲染三处 |
| Why 5 | 为何未被捕获？ | 违反 FR-005/FR-005-a MUST；gated off 路径无端到端校验 |

**Root Cause**：promptSha256 的"写-渲染-解析-比对"四环只实现了"写"一环。
**修复方向（W2）**：
1. parsePreregistration 增解析 `promptSha256`（已支持 oracleSpecHash/fixtureContentHash 的同款逐行解析）。
2. checkPreregistration 在 swebench-execution kind 下，若 prereg 有 promptSha256 且 opts 传入 live
   promptSha256 → 不符则 hard-fail（含字段名 + 期望/实际前缀）。
3. live promptSha256 = `sha256(buildDriverPrompt.toString())`：新增 `export computeDriverPromptSha256()`
   于 eval-task-runner.mjs（与 buildDriverPrompt 同源；cohort-registry 已先例 side-effect-free import）。
   任一 cohort prompt 措辞改动 → 函数源变 → hash 变 → 拦截。
4. cohort-batch entryValidation 把 `computeDriverPromptSha256()` 注入 checkPreregistration opts；
   freeze 侧（C2）写入同值 → 冻结↔运行口径一致。
**测试**：改一个字节的 buildDriverPrompt 源 → computeDriverPromptSha256 变；checkPreregistration 喂
不符 promptSha256 → ok=false 且 reason 含 promptSha256。

### W3 — FR-005-d 未实现（git 外锚）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | dirty worktree / 代码漂移为何不拦？ | checkPreregistration 不核对 git 状态（:117-119 仅注释声称"git 是 anti-tamper"） |
| Why 2 | 为何只有注释？ | FR-005-d MUST 未实现；freezeBlock.gitCommit 写入但运行期无人核对 |
| Why 3 | 严格 HEAD===gitCommit 为何不可行？ | 冻结流程：freeze 记 gitCommit=当前 HEAD → `git commit prereg.md` 使 HEAD 前进一格 → 跑批时 HEAD≠gitCommit（176 prereg gitCommit=55696ab 早已落后 09f90ac 即证） |
| Why 4 | 那正确的外锚语义是什么？ | "自冻结 commit 起，除 prereg 文件本身外**无任何代码改动** + worktree clean" → 即 `git diff <gitCommit> HEAD -- . ':(exclude)<prereg>'` 为空 且 tracked 无未提交改动 |
| Why 5 | 为何未被捕获？ | 同 gated-off；且需真实 git 仓状态，单测需注入 gitState |

**Root Cause**：FR-005-d 仅停留在注释承诺，无运行期实现；且天真的 HEAD===gitCommit 因 prereg 自提交
前进 HEAD 而不可用。
**修复方向（W3）**：
1. parsePreregistration 增解析 `gitCommit`。
2. checkPreregistration 增 `opts.gitState`（由 caller 注入，保持 lib 可测、I/O 轻）：
   `{ trackedClean: boolean, codeMatchesFrozen: boolean, head?: string }`。
   swebench-execution kind 下：`!trackedClean` → hard-fail（dirty worktree，外锚失效）；
   prereg 有 gitCommit 且 `!codeMatchesFrozen` → hard-fail（代码自冻结后漂移）。
3. cohort-batch entryValidation 计算 gitState：
   - trackedClean = `git diff --quiet && git diff --cached --quiet`（仅 tracked，忽略 gitignore 的评测产物）；
   - codeMatchesFrozen = `git diff <gitCommit> HEAD -- . ':(exclude)<prereg-rel>'` 输出为空。
**测试**：注入 `{trackedClean:false}` → 拦截；`{codeMatchesFrozen:false}` → 拦截；都 true → 放行。

### W4 — oracleSpecHash 不覆盖候选 patch 抽取

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | "改判分输入但 hash 不变"反例为何成立？ | 决定 model_patch 内容的 git diff exclude-pathspec 在 eval-task-runner.mjs:922-931（runner 内） |
| Why 2 | 为何不在 hash 内？ | oracleSpecHash 只画 5 个 SEMANTIC_MODULES（classify/phase-markers/swebench-oracle/dataset-build/fetch-rows.py），runner 不在内 |
| Why 3 | 为何不直接把 runner 纳入 SEMANTIC_MODULES？ | eval-task-runner.mjs 58k、为无关原因频繁改动 → 全文件 hash 极脆（每次无关改动都 mismatch），得不偿失 |
| Why 4 | 那如何兜住该路径？ | 任务给两选项：(a) 抽取逻辑纳入 hash；(b) 落实 W3 外锚（gitCommit+clean）。W3 的 codeMatchesFrozen 检查 `git diff <gitCommit> HEAD -- . :(exclude)prereg` 为空 + trackedClean，**已逐字节覆盖 runner 抽取逻辑**（含未提交改动 + 自冻结后任何提交） |
| Why 5 | 为何未被捕获？ | 同 gated-off |

**Root Cause**：oracleSpecHash 的覆盖面（5 模块）与"实际决定判分输入的代码面"（含 runner 抽取）不一致。
**修复方向（W4）**：**采用选项 (b)**，由 W3 的 git 外锚兜住 —— `codeMatchesFrozen`（除 prereg 外零代码漂移）
+ `trackedClean`（零未提交改动）共同保证 eval-task-runner.mjs 的抽取逻辑（:922-931）与冻结时逐字节一致。
不引入 runner 文件全量 hash（避免脆性）。在 freeze 工具注释 + 本报告显式记录该覆盖关系。

---

## 影响范围扫描

### 同源 / 受影响文件（需改）
| 文件 | 缺陷 | 修复动作 |
|------|------|----------|
| scripts/lib/classify-oracle.mjs | C1 | 决策表行序：report 权威块上移到 timeout/OOM 启发式前（**会改 oracleSpecHash，预期**） |
| scripts/freeze-preregistration.mjs | C2 | 增 `--swebench-oracle`/`--manifest`；复用 buildLiveOracleSpecInput 算三字段；renderFrozenPrereg 渲染 |
| scripts/lib/swebench-oracle.mjs | W1 | datasetName 从 fixture.swebenchMeta.dataset 透传（**会改 oracleSpecHash，预期**） |
| scripts/lib/swebench-dataset-build.mjs | W1 | datasetTagToHfId 映射 + 数据集错配诊断（**会改 oracleSpecHash，预期**） |
| scripts/lib/swebench_fetch_rows.py | W1 | （视需要）区分 missing 诊断输出（**在 SEMANTIC_MODULES，改则改 hash，预期**） |
| scripts/lib/preregistration-check.mjs | W2/W3 | parse promptSha256+gitCommit；checkPreregistration 比对 promptSha256 + gitState |
| scripts/swe-bench-verified-cohort-batch.mjs | W2/W3 | entryValidation 注入 live promptSha256 + gitState |
| scripts/eval-task-runner.mjs | W2 | 新增 `export computeDriverPromptSha256()`（仅加导出，不改 buildDriverPrompt 行为） |

### oracleSpecHash 变更说明（预期，非回归）
C1/W1 改动**会**改 oracleSpecHash（classify-oracle.mjs / swebench-dataset-build.mjs / swebench_fetch_rows.py
均在 SEMANTIC_MODULES）。这是**设计预期**：判分语义变了，hash 必须变。F188 跑前用扩展后的 freeze 工具
（C2）**重新冻结基线**即可，frozen oracleSpecHash 自动捕获新语义。无需更新任何入库的 frozen 基线
（176 prereg 是旧格式无 oracleSpecHash；F188 freeze fresh）。

### 同步更新清单
- 调用方：cohort-batch（W2/W3 注入）；freeze 工具（C2）。其余 7 处 runPrimaryOracle 调用方零迁移（C1 不改签名）。
- 测试：classify-oracle（C1 三交叉）、swebench-dataset-build（W1 映射+错配）、preregistration-check（W2/W3）、
  freeze-preregistration（C2 端到端）、cohort-batch（W2/W3 注入路径）。
- 文档：freeze 工具注释（W4 覆盖说明）；本 fix-report.md。

## 回归护栏（来自需求）
- 不改 oracle 执行本体（SWE-L003 docker 42s 通路不变）；C1 只调决策表行序，不改 spawnSync/harness 调用。
- 不改竞品方法论（cohort golden 逐字一致 SC-013）；buildDriverPrompt 仅**新增导出**，措辞零改。
- 全量 4477 测零回归；importer 零改动；评测产物不入库约定不变。
- 凭据订阅优先（不写需 ANTHROPIC/OPENAI API key）。

## Spec 影响
- 无需新建/改 spec.md。本修复落实 F187 既有 FR-005/FR-005-a/FR-005-d/FR-001-f 的 MUST，
  属"已立 spec 未完整实现"的收口，不引入新需求。

## Codex 对抗审查处置（Phase 1 诊断后）

codex:codex-rescue 对本诊断做对抗审查，结论 1 CRITICAL + 5 WARNING + 3 INFO。逐条处置：

| 档 | 发现 | 处置 |
|----|------|------|
| 🔴 CRITICAL | fixtureContentHash 仍 write-only，无闭环比对；Verified fixture 不入库 → W3 git 外锚覆盖不到 → taskId 不变但 fixture 内容换版可绕过 | **采纳并扩 scope**：增 fixtureContentHash **live 比对**（FR-005-a "新增字段任一不匹配则拦截" 本就 MUST）。新增共享 `computeFixtureContentHash(taskIds, fixturesDir)`；freeze 写、cohort-batch 注入 live、checkPreregistration 比对（present+live→比对，缺则向后兼容）。见下 §C2+ |
| 🟡 W1 | C1 落地伪码 `resolved===true?pass:fail` 会把 resolved==null 误判 candidate fail（现码仅 resolved===false 判 fail，否则 fallthrough） | **采纳**：C1 改为**显式 true/false 双分支**，resolved==null **fall through** 到原启发式/fallback，不强判。见上 C1 落地形态（已改） |
| 🟡 W2 | W3 codeMatchesFrozen 若 PREREG 绝对路径则 `:(exclude)` 失效 → freeze commit 自身被误拦 | **采纳**：exclude 用 `path.relative(PROJECT_ROOT, PREREG)`。且 W3 git 检查**仅 swebench-execution kind 生效**，legacy full（swebenchOracle=false）跳过 → 不动 176 旧 prereg。见 W3（已注明） |
| 🟡 W3 | promptSha256=源码 hash 挡不住 taskPrompt/spectraContext 动态输入漂移 | **部分采纳+澄清**：prereg 是 batch 前**单**hash，无法是 per-task effective-prompt hash（哪个 task？）。源码 hash 是唯一可冻结的模板粒度；**taskPrompt 漂移由 fixtureContentHash 覆盖**（taskPrompt 来自 fixture），spectraContext 是 cohort3 运行时产物非冻结对象。两者合力覆盖输入。保留 toString() 方案 + 文档化 |
| 🟡 W4 | freeze 复用 buildLiveOracleSpecInput 无 venv 时 throw，main 无 catch → 崩 | **采纳**：freeze main 包 try/catch，无 venv 给可读错误（"swebench-execution 冻结需先 setup-swebench-venv.sh"）+ exit 2；补测 |
| 🟡 W5 | importer 用 `princeton-nlp/` 命名空间，builder 默认 `SWE-bench/` org → 映射来源可能不一致 | **澄清+一致化**：现有 Lite SWE-L 测试在 builder 默认 `SWE-bench/SWE-bench_Lite` 下通过 → 两 org 镜像字段等价（diffOfficialVsFixture 自洽）。verified 映射用同 org `SWE-bench/SWE-bench_Verified` 保持 builder 内部一致；不动 Lite 默认。文档化镜像等价性 |
| ℹ️ I1 | 旧 176 prereg 无 oracleSpecHash，swebench 模式复用会缺字段 hard-fail | 已在"oracleSpecHash 变更说明"注明 F188 fresh-freeze；补一句旧 prereg 不可复用于 swebench |
| ℹ️ I2 | computeDriverPromptSha256 新增 export 安全，但不可改 buildDriverPrompt 签名/模板文本（golden 测试 + 方法论） | 已纳入护栏：仅加 export，零改措辞 |
| ℹ️ I3 | 新校验须"字段存在才比对"，否则打红现有 swebench 正向单测（只含 oracleSpecHash） | 已定为设计原则：promptSha256/fixtureContentHash/gitState 均 present-and-live-provided 才比对 |

### C2+（fixtureContentHash 闭环，采纳 CRITICAL）
- 新增 `export computeFixtureContentHash(taskIds, fixturesDir)`（preregistration-check.mjs 或 paths 模块）：
  对 taskIds 排序，逐个读 `fixturesDir/<taskId>.json` 原始内容算 sha256，stableStringify({id:sha}) → sha256。
- freeze-preregistration.mjs：swebench 模式算 fixtureContentHash 传 freezeBlock（已支持字段）+ 渲染。
- cohort-batch entryValidation：算 live fixtureContentHash 注入 checkPreregistration opts。
- checkPreregistration：prereg 有 fixtureContentHash 且 opts 传 live → 不符 hard-fail（含字段名+前缀）；缺则向后兼容（warn）。
- 测试：fixture 内容改一字节 → live hash 变 → 比对拦截；taskId 不变内容换版被拦。

## 修复策略汇总（推荐方案）
按 TDD：先写失败测试（C1 三交叉 / W1 映射+错配 / W2 promptSha256 / W3 gitState / C2 端到端），
再实现至全绿。分文件原子提交不可行（合约耦合），按缺陷分组在单 implement phase 内完成，
全量 `npx vitest run` + `npm run build` + `npm run repo:check` 零失败后 commit。
