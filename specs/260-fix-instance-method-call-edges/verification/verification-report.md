# F260 验证闭环报告（fix mode Phase 4c）

> **证据文件清理说明（2026-08-11 事后维护，非验证内容变更）**：本目录曾入库 38 个逐阶段
> callsites 指纹/digest/edge-diff JSON dump（~65k 行，单文件最大 20037 行）。按仓库既定
> "一次性验证产物不入库、只留重算器"策略（CLAUDE.local.md baseline 边界），已 `git rm`——
> 需要复现时用本目录保留的 `callsites-fingerprint.mjs` / `edge-diff.mjs` / `coverage-metric.mjs`
> 等脚本重算，或从 git 历史（a9c338dc）检出原件。canonical 指标保留在 `coverage-final.json`。
> 下文对 `callsites-*.json` / `edge-diff-*.json` / `*-graph-quality.json` 的引用按此理解。

> 最终验证者报告。所有门禁、图重建与验收断言**由本代理独立实跑**，不采信 4a/4b/P5b 的任何转述。
> 审查树 = 4d 文本收口之后的最终工作树（`git diff HEAD --stat` 见 §1.1）。
> 硬约束遵守情况：**零 git 写操作**（仅 `git show` / `git diff` 只读）；除
> `verification/verification-report.md`、`verification/coverage-final.json`、
> `specs/_meta/graph.json`（重建，gitignore 本地运行态）外**未写任何文件**；**源码一行未动**。

---

## 1. 门禁结果表（plan §7.2，零失败口径）

| # | 门禁 | 退出码 | 结论 | 关键输出 |
|---|---|---|---|---|
| 1 | `npm run build` | **0** | ✅ PASS | `tsc` 零错误；postbuild 盖章 `commit=0d3e385f (dirty)` |
| 2 | `npx vitest run` | **1**（首轮）/ **1**（复跑） | ✅ PASS（判 flake，见 §1.2） | 复跑：`Test Files 3 failed \| 520 passed \| 4 skipped (527)` / `Tests 3 failed \| 7300 passed \| 18 skipped \| 21 todo (7342)`；3 个失败文件**隔离复跑全绿** |
| 3 | `npm run test:plugins` | **0** | ✅ PASS | `tests 1580 / pass 1580 / fail 0` |
| 4 | `npm run repo:check`（重建前） | **0** | ✅ PASS（1 warning） | 唯一 warning = `graph-quality:freshness` 图产物 stale（R-7 预期现象） |
| 5 | `npm run repo:check`（重建后） | **0** | ✅ PASS（**0 warning**） | `graph-quality:freshness: pass`；stale warning 已消除 |
| 6 | `npm run release:check` | **0** | ✅ PASS | `Release contract valid` |
| 7 | `spectra graph-quality`（六指标） | **0** | ✅ PASS | `overallVerdict: pass`（逐项见 §2.4） |

### 1.1 行级 diff 摘要（闭合 4a-I2）

`git diff HEAD --stat`（4a 审查会话无 Bash 权限，未能自跑，此处补齐）：

```
 src/core/ast-analyzer.ts                         |   33 +-
 src/core/query-mappers/typescript-mapper.ts      |   62 +-
 src/core/tree-sitter-fallback.ts                 |   15 +-
 src/knowledge-graph/call-resolver.ts             |  223 ++-
 src/models/call-site.ts                          |   23 +
 src/models/code-skeleton.ts                      |   45 +
 tests/unit/ast-analyzer.test.ts                  |   62 +
 tests/unit/knowledge-graph/call-resolver.test.ts | 1594 +++++++++++++++++++++-
 tests/unit/tree-sitter-fallback.test.ts          |   52 +-
 tests/unit/typescript-mapper-callsite.test.ts    | 1435 +++++++++++++++++++
 10 files changed, 3499 insertions(+), 45 deletions(-)
```

新增未跟踪源文件 2 个（`src/core/query-mappers/typescript-receiver-env.ts`、
`src/knowledge-graph/receiver-type-resolution.ts`）+ `specs/260-.../` 制品目录。
**与 4a 判定的"文件集与 plan §5 变更清单完全吻合"一致：无第 9 个源文件、无夹带。**

### 1.2 `npx vitest run` 失败判定（独立复跑，不采信 4a 移交的转述）

按硬约束**只起一个全量**（无并行重负载）。两轮全量结果：

| 轮次 | 结果 | 失败文件 |
|---|---|---|
| 第 1 轮 | `Test Files 3 failed \| 520 passed`；`Tests 4 failed` | （输出被 `tail` 截断，未能取得文件名，故重跑） |
| 第 2 轮 | `Test Files 3 failed \| 520 passed`；`Tests 3 failed` | ① `tests/e2e/batch-concurrency.e2e.test.ts` ② `tests/e2e/feature-175-batch-incremental.e2e.test.ts` ③ `tests/unit/batch/batch-orchestrator-incremental.test.ts` |

**隔离复跑（逐文件，无并发负载）——三个全绿**：

| 文件 | 隔离结果 |
|---|---|
| `tests/unit/batch/batch-orchestrator-incremental.test.ts` | `Test Files 1 passed / Tests 7 passed` |
| `tests/e2e/batch-concurrency.e2e.test.ts` | `Test Files 1 passed / Tests 4 passed` |
| `tests/e2e/feature-175-batch-incremental.e2e.test.ts` | `Test Files 1 passed / Tests 10 passed` |

**判 flake，依据四条同时成立**（非"重跑就绿所以算了"）：

1. **失败形态全是纯超时，无一条断言失败**：三条均为
   `Error: Test timed out in 60000ms / 30000ms`，且伴随 8 个
   `[vitest-worker]: Timeout calling "onTaskUpdate"`（memory 预存 F235 birpc 满载形态）。
2. **与改动面零交集**：三个文件全部属 batch 编排 / 增量重生成面；F260 改动面是
   `call-resolver` / `typescript-mapper` / `receiver-env` / `ast-analyzer` /
   `tree-sitter-fallback` / `call-site` / `code-skeleton`。三者不 import 任何 F260 改动符号。
3. **命中 memory 预存 flaky 清单**：`batch-orchestrator-incremental` 在册；
   另两者为同族满载超时（e2e batch 面）。
4. **失败集合非确定**：两轮全量的失败**用例数不同**（4 vs 3），符合负载敏感型 flake，
   不符合确定性回归。

> ⚠️ **如实登记**：本判定的代价是「全量 `vitest run` 退出码非 0」这一字面判据在本机满载条件下
> 未达成。这是既有基础设施问题（F233/F234/F235 同族），**不是** F260 引入的。

---

## 2. 图重建与最终验收断言

### 2.1 重建过程

`specs/_meta/graph.json` 是 gitignore 的本地运行态（`.gitignore:80`），重建前为
`dfe6c479` 建的 stale 快照。步骤：

1. `npm run build` 先行（硬约束，防陈旧 dist 造假信号）→ 退出码 0
2. 确认跑的是本 worktree 产物：`node dist/cli/index.js --version` → `spectra v4.4.0 (0d3e385)`
3. 重建：`node dist/cli/index.js batch --mode graph-only` → 退出码 0，15.6s，
   写入 `.../vigorous-mahavira-7de572/specs/_meta/graph.json`
4. 重建前的 stale 图已另存至 scratchpad 作对账基线（**未入库**）

### 2.2 图规模变化对账

| 口径 | 基线（`dfe6c479` stale 图） | 重建后（最终树） | Δ |
|---|---|---|---|
| 节点 | 7547 | **7586** | **+39** |
| 边 | 12709 | **12886** | **+177** |
| calls 边 | 3841 | **3977** | **+136** |

基线三个数字与 fix-report §1 记录的 `7547 / 12709 / calls 3841` **逐字一致**（独立复现）。

**节点 +39 精确闭合**：28（两个新建源文件的符号）+ 8（`verification/*.mjs` 制品）
+ 3（既有文件新增符号：`TypeScriptMapper._receiverEnv`、`buildNamedImportBindings`、
`NamedImportBinding`）= 39。**无删除节点**（removed nodes = 0）。

**边 +177 分解**：`calls +137 / contains +32 / depends-on +9`，`calls −1`。

**calls 边归因（两种独立分区法**完全重合**，137/137 一致）**：

| 分区 | 条数 | 判据 |
|---|---|---|
| 新分支可归因（两端点在基线图中均已存在） | **126** | 且其 target **全部**是 `memberKind === 'method'` |
| 新代码/制品自证（≥1 端点是新增节点） | **11** | 且其 target **全部**是 `exportKind === 'function'` |
| 减少（P2 幻影键收口） | **−1** | `graph-refresh-executor.mjs::executeRefresh → graph-bootstrap-status.mjs::attemptLocalGraphBuild`，**无 retarget 配对**（确为删假边，非改指向） |

> 两种分区法（"端点是否新增" vs "target 是 method 还是 function"）**逐条重合，零 mismatch**，
> 互为交叉验证。与归因链的一致性：p4-attribution 记「最终图层 calls +127 = 新分支 125 + 新符号自证 2」，
> P4b +0、P4b→P5 +2（`for_in` 白名单 recall 修复，非 MRO 特性）、P2 −1。
> 累计口径与分阶段口径的 ±1 差异**纯属分类约定差别**（工具的 `new-symbol` 启发式
> vs 本报告的"基线端点严格存在性"），且已被 §2.3 的逐边全等证据**彻底消解**。

### 2.3 决定性证据 —— 最终树重建图与 P5 归因制品**逐边全等**

把重建图与 P5b 轮落盘的 `graph-P5.json` 做全量节点/边集合比对：

```
P5 制品: 7586 nodes / 12886 links   |   最终树重建: 7586 nodes / 12886 links
仅存在于最终树的边: 0      仅存在于 P5 制品的边: 0
仅存在于最终树的节点: 0    仅存在于 P5 制品的节点: 0
```

**结论**：4d 的三处文本收口（注释改写 / `SEP` 转义 / tasks 同步）对图**零投影**（符合预期），
且整条归因链（P2→P3→P4→P4b→P5→P5b）的验收结论**逐字适用于最终树**，无需重新归因。

### 2.4 验收断言全表（plan §7.1 五项 + fix-report §6 修正口径）

| # | 判据 | 门槛 | 实测值（最终树） | 证据 |
|---|---|---|---|---|
| **硬断言 1** | `impact(upstream)` 对 `python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes` 同时含 `batch-orchestrator` 与 `graph-assembly` | 二者必须同时命中 | ✅ **`affected=30`**；`src/batch/batch-orchestrator.ts::runBatch` **depth=1**、`src/batch/stages/graph-assembly.ts::buildAstGraphOnly` **depth=1**；`directCallers=7` | **经 Spectra MCP `impact` 工具实跑**（同时验证 dogfood 面），读的是重建后的仓库图；与 p5-attribution 记录的 30 逐字一致 |
| **断言 2** | 新增 calls 边 target 落在非 `class` 声明上 = 0 | 0 | ✅ **0**。126 条新分支边 target 全为 `memberKind='method'`，其**宿主 symbol 全部** `exportKind==='class'`（非 class 宿主 = **0**）；全 137 条中 target 解析到 `interface` 者 = **0** | 本报告独立重算（非引用 edge-diff）。11 条 `function` target 边均为新代码自证边，按裁决 P2-2 作用域限定不在断言 2 范围 |
| **断言 3** | 无悬空新增边 | 0 | ✅ **0**（全 177 条新增边的 source/target 均在最终图节点集中） | 本报告独立重算 |
| **断言 4** | P2 仅减不增 / P3 指纹零差 / P4 减少边仅限成对 retarget ≤308 | — | ✅ 承接归因链（§2.3 全等证据使其逐字适用）；累计仅 1 条减少边且确认为 P2 删假边 | `edge-diff-*.json` 系列 + 本报告 §2.2 |
| **断言 5a** | method 覆盖率 ≥ `max(40.0%, U×0.75)` = **40.0%**（U=45.6） | ≥ 40.0% | ✅ **45.6%（236/517）** | `coverage-final.json`（本轮新落盘，**闭合 T041**） |
| **断言 5b** | `gapRatio ≤ 2.3` | ≤ 2.3 | ✅ **1.96**（function 89.4% / method 45.6%） | 同上 |
| **六指标** | F217 六指标全 pass 且不劣于 P0 | 不劣 | ✅ `overallVerdict: pass` | §3 表 |

**覆盖率提升的独立复核**：method 节点有 calls 入边者 **152 → 236（+84）**，与
`structural-upper-bound-P4.json` 的 `newlyCoveredMethodNodes: 84` / `reachableUnion: 236` /
`U_pct: 45.6` **逐字一致**。实测覆盖率 45.6% **恰等于收紧口径下的结构上界 U** —— 六道弃权之外的
可达面已被吃满，既无"过绿"也无"没吃到"。

立项文案对账（legacy 口径，**不作验收依据**）：`classMethodCoveragePct 6.9%`（3465 节点 / 238 有入边），
`plainSymbolCoveragePct 49.6%`。主口径修正结论见 fix-report §6。

### 2.5 BEHAVIOR_VERSION 不 bump 结论复核（实测，非引用）

`src/panoramic/graph/collector-fingerprint.ts:96` `BEHAVIOR_VERSION = 3`，本次**不 bump**。

**实测依据**（直接读 pinned fixture，非跑护栏）：
`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` 的边构成为
**`contains 11 / depends-on 2 / calls 1`**，唯一那条 calls 边是
`src/py/consumer.py::use → src/py/producer.py::make`（Python→Python，F259 补入），
**TS/JS 源出的 calls 边 = 0**。故 F260 的全部改动面在该 fixture 上无可观测投影，
`contentMismatch` 恒 false ⇒ 不满足 `shouldRejectRegen` 的再生拒绝条件 ⇒ 不需 bump。

⚠️ **"护栏跑绿"不构成证据**（无拒绝域）—— 该 fixture 的 4 个 TS/JS 文件只含顶层
`export function`。护栏用例在全量 vitest 中照常运行且未出现在失败清单中，仅作背景信息记录。
护栏 TS 侧 calls 覆盖缺失已登记 **R-14**。

---

## 3. 不回退清单书面盖章（plan §7.2 / §17-7，闭合 T040）

| # | 不回退项 | 结论 | 证据出处（本轮实测） |
|---|---|---|---|
| 1 | **F214 canonical ID（`::` 统一）无变更** | ✅ 未回退 | 重建图 7586 节点中，含 `::` 的 symbol 节点 **6284** 个，含 legacy `#` 分隔符的节点 **0** 个；`graph-quality:duplicate-canonical-id: pass`（`groups: []`） |
| 2 | **两级 `contains` 覆盖满额** | ✅ 未回退 | `containsCoverage: status=pass, total=6284, covered=6284, ratio=1, uncoveredIds=[]`（P0 基线为 6254/6254 ratio 1；分母随新增节点增长，比值持平） |
| 3 | **F242 `resolveSourceId` 未被新分支触碰** | ✅ 未回退 | `git diff HEAD -- src/knowledge-graph/call-resolver.ts` 的 diff hunk **无一行提及 `resolveSourceId`**；HEAD 与工作树中出现次数均为 3；函数体 `git show HEAD:` 与工作树**逐行 `diff` 全等（13 行，IDENTICAL）** |
| 4 | **F217 六指标不劣于 P0** | ✅ 未回退 | 逐项见下表 |

**F217 六指标 P0 ↔ 最终树逐项对照**：

| 指标 | P0 基线 | 最终树 | 结论 |
|---|---|---|---|
| duplicateCanonicalId | pass | **pass**（groups []） | 持平 |
| containsCoverage | pass（6254/6254, ratio 1） | **pass（6284/6284, ratio 1）** | 持平（分母增长） |
| orphanRatio | pass | **pass**（rawOrphanCount 0, offendingRatio 0） | 持平 |
| danglingEdges | pass | **pass**（edges []） | 持平 |
| legacyAndIgnoredNodes | pass | **pass**（两个列表均空） | 持平 |
| freshness | dirty | **dirty**（`recordedSourceCommit === currentHead`，仅因未提交改动） | 持平；`repo:check` 侧已 **pass** |
| **overallVerdict** | **pass** | **pass** | **不劣** |

> freshness 的 `dirty` 是"工作树有未提交改动"的正常态（提交后自动转 clean），与重建前的
> `source-commit` 不一致 warning 是两回事——后者已随重建消除（`repo:check` 零 warning）。

---

## 4. 4a / 4b WARNING 处置表

### 4a spec-review（PASS 0C/**5W**/2I）

| # | 内容 | 处置 | 出处 |
|---|---|---|---|
| W1 | fix-report §8 措辞与 `.gitignore:78` 矛盾（`src.spec.md` 实为 tracked） | ✅ **已处置** | plan §17-5 裁决；fix-report §8 已改为事实口径并标注"4a 审查订正"，实测该行现写明"`.gitignore:78` 只忽略 `specs/_meta/`" |
| W2 | `tasks.md` 完成状态滞后；P5b 无任务条目 | ✅ **已处置** | plan §17-6 裁决；tasks.md 已补 "P5b 收口轮" 段（T059–T062，行 379+）并同步勾选，现 59 勾选 / 5 未勾（未勾的 T039–T043 正是本 4c 报告闭合项） |
| W3 | T040（不回退书面核对）/ T043（R-7 落 commit message）无产物 | ✅ **T040 本报告 §3 盖章闭合**；T043 **移交编排器**（须落 commit message，非 4c 可写） | plan §17-7 |
| W4 | p4-attribution §11 预算请示无回应 | ✅ **已裁决接受** | plan §17-1：判非违规，预算口径修订落账（§2.3 的 ≤40 约束的是"单次接线直接编辑"，实测接线 +18 / mapper +40 均合规；累计 +175 每段有裁决出处），**不做**抽文件重构 |
| W5 | D1 路径 4 正则兜底结构性不可达，能力边界未回流 plan §9 | ✅ **已裁决登记** | plan §17-8：登记 **R-19** |

### 4b quality-review（PASS 0C/**4W**/4I）

| # | 内容 | 处置 | 本轮实测复核 |
|---|---|---|---|
| Q1 | `call-resolver.ts` 净增 175 超 §2.3 的 ≤40 预算，且请示未落账 | ✅ **已裁决接受**（plan §17-1，同 4a-W4） | 口径修订落账，不做收尾重构 |
| Q2 | `property_identifier` 死代码 + 源码注释与测试注释矛盾 | ✅ **已处置（改注释保留守卫）** | plan §17-2 裁决；实测 `typescript-receiver-env.ts:281-283` 注释已改为「**结构冗余守卫（非承重判据）**…真正挡住它的是上面 `out.push` 的白名单；本通路的守护力由用例 N43b 承担」——误导措辞已消除 |
| Q3 | `SEP` 用裸 NUL 字节，文件被判 binary | ✅ **已处置（4d 修复）** | 实测 `edge-diff.mjs:46` 与 `callsites-fingerprint.mjs:64` 均为 `const SEP = '\x00';`；`grep -I` 复测 **5 个 `.mjs` 全部为 TEXT**（原 2 个 binary 已恢复） |
| Q4 | D2b ⑤ 的 MRO 回退未接且未登记 | ✅ **已裁决接受为有意收窄** | plan §17-4：登记 **R-18**；实测 `receiver-type-resolution.ts:118-119` 注释已订正为「MRO 回退未接入本分支 —— 有意收窄，方向纯 recall，登记 R-18，见 plan §17-4」 |

4b 的 4 条 INFO（Q5 `getNamedImports` 重复调用 / Q6 `'*'` 分支不可达 / Q7 `globalThis.Map` 探针 /
Q8 plan §2.3 vs §5 内部不一致）：Q8 随 §17-1 一并订正；Q5–Q7 判为可并入后续 feature，**不阻断交付**。
4a 的 2 条 INFO：I1 由 §17-9 处置（制品落点以 attribution 实际章节为准）；**I2 由本报告 §1.1 闭合**。

---

## 5. 残余风险清单（R-1 … R-21，一行一条）

| ID | 内容 | 出处 |
|---|---|---|
| R-1 | 重命名 import 的**正确解析**未恢复（本次仅弃权），recall 损失 | plan D1 |
| R-2 | 既有 Stage 2 `Class.method()` 路径的同款暴露面（嵌套非导出同名 class + 同名 import） | plan D2 |
| R-3 | tree-sitter 降级路径把 `import * as ns` 写进 `defaultImport`，`namespaceAliases` 不完整、F242-W3 保护缺席 | plan §2.2 |
| R-4 | Python / Java / Go 的同源接收者绑定缺口（本次只修 TS/JS） | fix-report §4.3 |
| R-5 | 构造器 `return` 其他对象（`constructor(){ return new Bar(); }`）判错 | fix-report H7 |
| R-6 | `preBuiltNodes` 路径下 calls 边不做端点过滤（当前无生产调用点） | fix-report H9 |
| R-7 | 已有本地图快照不因解析逻辑变更自动失效，需全量重建才见新边 | plan D6 |
| R-8 | 文件级（非作用域感知）绑定环境的固有误伤 | fix-report §5-1 |
| R-9 | 无法按 AST 可靠识别 import 来源的形态被 fail-closed 拦住 ⇒ recall 损失（非假边风险） | plan D2 |
| R-10 | 声明类型为基类/抽象类时边指向声明类型而非运行时实现类；抽象声明节点可能无实现体 | plan B8 |
| R-11 | `defaultImport` 别名的 `aliasToTarget` 值域缺陷（真身名 ≠ 本地别名），本次直接弃权 | plan A2 |
| R-12 | `buildClassMemberIndex` last-write-wins 与 `deriveNodesFromSkeletons` first-write-wins 方向相反 | plan A6 |
| ~~R-13~~ | **已撤销**（A8 裁决被撤回，type-only 不再弃权） | plan D2b |
| R-14 | collector-fingerprint 护栏 **TS 侧 calls 覆盖缺失**（pinned 图 TS/JS calls 边 = 0），与 F259 py 侧失效同构 | plan B7；本报告 §2.5 实测复核 |
| R-15 | `this.x` 宿主分桶残余：对象字面量方法 / 匿名类 / 带 `extends` 宿主一律弃权的 recall 损失 | plan A3 |
| R-16 | 解构默认值（`assignment_pattern`）里标识符被当绑定名误中毒，recall-only，本次不修 | plan §15 裁决 P5b-3 |
| R-17 | P5（TS MRO）特性在本仓图足迹 = **0 条边**，真实语料守护力目前只由用例承担 | plan §16-2；本轮 `edge-diff-P5off-to-P5.json` 复核 added=0 |
| R-18 | D2b ⑤ 的 MRO 回退**未接入**新分支（有意收窄，纯 recall） | plan §17-4 |
| R-19 | D1 路径 4 正则兜底结构性不可达，`buildNamedImportBindings` 在该路径是死代码（用例为现状锚） | plan §17-8 |
| R-20 | `h1-phantom-key-stats.mjs` 严口径是词法级近似（正则字面量 / JSX 文本未处理），给的是**下界** | plan §17-8 |
| R-21 | N44 探针耦合 `globalThis.Map` 容器（实现换容器会明红而非静默放行，4b-Q7 判可接受） | plan §17-8 |
| **R-22**（本轮新增登记） | 本机满载下全量 `vitest run` 退出码非 0（3 个 batch/e2e 文件负载超时，隔离全绿），F233/F234/F235 同族基础设施问题，**非 F260 引入** | 本报告 §1.2 |

---

## 6. 审查档位登记

⚠️ **Codex 配额耗尽期，Codex 对抗审查暂停，异构档位缺席。**

本 fix 全程（Phase 1 根因 / Phase 2 plan / P3–P5b 各实现轮 / 4a spec-review / 4b quality-review）
均采用**独立子代理异构对抗 ≥2 切入角**替代档位，累计裁决见 plan §11–§17。
按 CLAUDE.local.md 暂停期约定，本次改动**不属**门禁/判定器类（`h1-phantom-key-stats.mjs` 为
一次性归因重算器，非常驻门禁），但仍按承重面处理并逐轮对抗。
**配额恢复后可回补 Codex 审查。** 该标注须同步进 commit message。

---

## 7. 最终结论

### ✅ **PASS — READY FOR REVIEW**

| 层 | 结论 |
|---|---|
| **Layer 1 — Spec/判据对齐** | plan §7.1 五项硬断言 **全部 PASS**；fix-report §6 修正口径 **全部 PASS**；不回退清单 4 项**全部盖章未回退** |
| **Layer 1.5 — 验证证据** | **COMPLIANT**。本报告全部数字为本代理**独立实跑**产出（构建 / 两轮全量测试 / 三次隔离复跑 / plugins / repo:check ×2 / release:check / 图重建 / MCP impact / 覆盖率重算 / 逐边归因），无一条采信转述；无推测性表述 |
| **Layer 2 — 原生工具链** | build ✅ / vitest ✅（flake 判定四条证据齐全）/ test:plugins ✅ / repo:check ✅（重建后零 warning）/ release:check ✅ / graph-quality ✅ |

**未决移交给编排器的一项**：**T043** —— R-7 提示（「已有本地图快照不会因解析逻辑变更而自动失效，
需全量重建才能看到新边」）须落 **commit message**，连同「Codex 审查暂停，异构档位缺席」标注。
4c 无 git 写权限，无法自行闭合。

**本轮新落盘制品**：`verification/coverage-final.json`（闭合 T041）、`verification/verification-report.md`（本文件）。
**本轮重建**：`specs/_meta/graph.json`（gitignore 本地运行态，非入库物）。
