# F260 P4 A/B 归因报告 + 变异测试报告 + 抽样核对表

> 本文件只记录**实跑得到的**数字与逐条核对结论，不写推测。
> 入库工具产物：`edge-diff-P3t-to-P4.json` / `callsites-fingerprint-P3t-to-P4.json` /
> `callsites-fingerprint-positionfree-P3t-to-P4.json` / `callsites-digest-P3t.json` /
> `callsites-digest-P4.json` / `P3t-graph-quality.json` / `P4-graph-quality.json` /
> `coverage-P3t.json` / `coverage-P4.json` / `structural-upper-bound-P4.json`。
> 大体积产物（`graph-P*.json` / `callsites-P*.json` / `exports-P*.json`）按裁决 P2-4 不入库，
> sha256 与生成命令见 §9。
>
> ⚠️ **本阶段两条判据判 FAIL，已停下报告，未改工具、未改判据、未把违规项排除统计**（详见 §5.3 / §5.4）。
> 两条 FAIL 的实证性质均为**判据作用域缺口**（与裁决 P2-1 / P2-2 处理过的两次同构），
> 但**是否收窄判据由编排器裁决，执行侧不自行改判**。

---

## 0. 本轮做了什么 / 没做什么

- **做了**：T024 / T025 / T026 三项前置复核；R4–R12 / R16 + R9b / R10b / R10c 红先行落地；
  新建 `src/knowledge-graph/receiver-type-resolution.ts`（D2b 六条件与门）；
  `call-resolver.ts` 插入分支调用；13 个变异体的变异测试；P3t→P4 逐边 diff；
  硬断言 1 复验；22 条新增边人工回源码核对；全量门禁。
- **没做**：P5（`buildClassMroIndex` 的 TS `extends` 分支）一行未动，`stripGenericParams` 未动。
- **没做任何 git 写操作**（无 `add` / `commit` / `stash` / `checkout` / `clean`）；只用了只读的
  `git status`。P3t 中间基线通过**程序化逆向自己的 4 处 Edit** 构造（见 §2.2），不走 git。

---

## 1. 三项前置复核（T024 / T025 / T026）

探针 `p4-probe.mjs`（scratchpad，sha256 `f15c81b9b3419acb6c1d697e942972f2a35fbaa14ce563e4152a04c6e0d6b3b6`）
直接跑生产采集器（`collectPythonCodeSkeletons` + `collectTsJsCodeSkeletons` + `collectGenericLanguageCodeSkeletons`，
与 `buildAstGraphOnly` 同口径）+ dist 的 `buildImportIndex` / `buildModuleSymbolIndex`。

⚠️ 探针里的六条件与门是**在实现落地之前独立手写**的第二实现，事后与真实现交叉核对（§4.2 一致）。

### 1.1 T024 — 两个验收调用点均**未**落入 `suppressedDynamicAliases`

| 文件 | `suppressedDynamicAliases.has('PythonLanguageAdapter')` | 该文件抑制集大小 | `aliasToTarget.get('PythonLanguageAdapter')` |
|---|---|---|---|
| `src/batch/batch-orchestrator.ts` | **false** | 0 | `src/adapters/python-adapter.ts` |
| `src/batch/stages/graph-assembly.ts` | **false** | 0 | `src/adapters/python-adapter.ts` |

⇒ 复核 (a) **成立**。

### 1.2 T025 — 两个调用点的 `receiverTypeSoleImportBinding === true`

| 文件 | line | `calleeKind` | `calleeQualifier` | `callerContext` | `receiverType` | `receiverTypeSoleImportBinding` |
|---|---|---|---|---|---|---|
| `src/batch/batch-orchestrator.ts` | 1217 | `cross-module` | `pythonAdapter` | `runBatch` | `PythonLanguageAdapter` | **true** |
| `src/batch/stages/graph-assembly.ts` | 241 | `cross-module` | `new PythonLanguageAdapter()` | `buildAstGraphOnly` | `PythonLanguageAdapter` | **true** |

⇒ 复核 (b) **成立**。两条前置都成立，断言 1 在当前设计下可达，**无需**放宽 H5 拦截或 A1 判据。

（第二行的 `calleeQualifier` 是整段 new 表达式文本 —— fix-report §2 记录的形态在当前 HEAD 上原样复现。）

### 1.3 T026 — 收紧后口径的结构上界 `U`

基线 `graph-P3t2.json`。落盘 `structural-upper-bound-P4.json`。

```
method 节点总数             517
P3t 已有 calls 入边          152
带 receiverType 的调用点    2488
六条件全部通过的调用点        303
去重后的不同 target           85（全部是 memberKind==='method' 节点）
其中 P3t 尚无入边的            84
可达并集 = 152 ∪ 85          236
U = 236 / 517 = 45.6%
```

逐条弃权归因（2488 − 303 = 2185 条被拦，按**首个**不成立的条件计）：

| 弃权条件 | 条数 | 占比 |
|---|---|---|
| ③ `receiverTypeSoleImportBinding !== true`（A1：绑定点 ≥2 / 非 import 来源 / 零绑定） | 1995 | 91.3% |
| ③ import 别名表查不到该类名（`aliasToTarget` 未命中或值为 null） | 76 | 3.5% |
| ⑤ 成员验证失败（类定位到了但该方法不在其 `members`） | 45 | 2.1% |
| ④ 定位到的条目 `kind === 'interface'` | 38 | 1.7% |
| ④ 目标文件无同名 export 条目 | 28 | 1.3% |
| ③ A2 default import 别名弃权 | 2 | 0.1% |
| ④ 定位到的条目 `kind === 'type'` | 1 | 0.05% |
| ② `suppressedDynamicAliases` 抑制 | 0 | 0% |
| ③ D1 `renamedImportAliases` 弃权 | 0 | 0% |

**覆盖率下限 = `max(40.0%, 45.6% × 0.75 = 34.2%) = 40.0%`**；`gapRatio` 上限 2.3。

---

## 2. 归因口径与基线

### 2.1 主锚点

P4 的主锚点是**逐边 diff**（plan §6 P4 行）。callSites 指纹是 P3 的锚点，本阶段作为信息项记录（§6）。
新增边计数按 B5 裁决**两个数都记**：UnifiedGraph 层（去重前）+ 最终图层净增（§4）。

### 2.2 中间基线 P3t（承接裁决 P2-5，全程无 git 写操作）

`tests/**` 与 `verification/*.mjs` 都进图，故必须切开「测试改动」与「实现改动」：

- **P3t** = P3 源码 + **P4 测试**（R4–R16 全部落地，含补强的 R6b）+ 同一份 `verification/*.mjs`
- **P4** = P4 源码 + 同一份 P4 测试 + 同一份 `verification/*.mjs`

P3t 的构造方式：把本轮对 `call-resolver.ts` 的 4 处 Edit **程序化逐字逆向**（每个锚点断言命中次数
恰好 1），并把 `receiver-type-resolution.ts` 移出工作区；取完基线后从 scratchpad 备份还原，
逐份 `shasum -a 256` 复核与还原前一致：

```
d6052dce3ca7e6a506ff5457f8df4c28d12b2ef640098ccdb6635acc58e8b1de  src/knowledge-graph/call-resolver.ts
e4352cbf137e1ad3d6072ea1b3ba8caab589b2c7765bd0b33e64185d82780f17  src/knowledge-graph/receiver-type-resolution.ts
```

**基线重取过 2 次（如实登记）**：第一次 P3t 取在 R6b 落地**之前**（R6b 是变异测试暴露判别力缺口后
补强的用例，见 §7.2）。R6b 属于 `tests/**`，进图，故按裁决 P2-5 的口径 P3t 必须重取。
重取后两版 P3t 的图指标逐字相同（7566 节点 / 12732 边 / calls 3848 / method 152），
即 R6b 的图投影为零 —— 但**结论以重取后的那份为准**，第一版不参与结论。

### 2.3 工具冻结

本轮**没有改动任何 `verification/*.mjs`**（`edge-diff.mjs` / `callsites-fingerprint.mjs` /
`coverage-metric.mjs` / `dump-skeletons.mjs` 逐字沿用 P3 冻结版），因此不存在 P3 那种「改工具必须重取基线」的情形。
新写的三个脚本（`p4-probe.mjs` / `unified-layer-count.mjs` / `mutation-run-p4.mjs`）**全部放在 scratchpad**，
不进 `verification/`，不进图。

### 2.4 环境硬约束的执行

- 每次建图前先 `npm run build`（退出码 0）。
- 用 `node dist/cli/index.js` 显式调用**本 worktree 的构建产物**，不走 `PATH` 上的全局 `spectra`：
  `node dist/cli/index.js --version` → `spectra v4.4.0 (0d3e385)`。
- `--output-dir` 指向 scratchpad，**不覆写** `specs/_meta/graph.json`。

---

## 3. 红先行结果（如实登记：13 条里只有 5 条能在实现前判红）

`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts`，实现落地**前**：

```
Tests  5 failed | 83 passed (88)
```

| 用例 | 实现前 | 说明 |
|---|---|---|
| R4 / R5 / R9b / R16 | **红** | 「必须出边」型，新分支不存在 ⇒ 期望 1 条边、实际 `[]` |
| R10b（第一段：class 条目自己的成员应出边） | **红** | 同上 |
| R6 / R7 / R8 / R9 / R10 / R10c / R11 / R12 | **绿** | 「不得出边 / 应弃权」型 —— 新分支尚不存在时**没有任何东西会出边**，这类断言在实现前**结构性不可能为红** |

⚠️ 这 8 条是典型的**真空绿**（passes for the wrong reason）。按裁决 P3-2，它们的判别力**不由红先行证明，
而由变异测试证明**（§7）。这一点如实登记，不粉饰为「红先行全绿转红」。

（P2 的 R2 有过同款情形，当时的处理是另找一个实现前可判红的锚点；本轮的弃权型断言没有这样的锚点，
因为被断言的对象——新分支——在实现前完全不存在。）

---

## 4. 主锚点：逐边 diff（`P3t → P4`）

```
before 12732 边 / 3848 calls  →  after 12881 边 / 3975 calls
新增 149 条 {"calls":127,"depends-on":4,"contains":18} / 减少 0 条
retarget 对 0（上限 308）
新增边三分类（裁决 P2-1）: {"retarget":0,"new-symbol":21,"phase-expected":125,"unclassified":3}
```

### 4.1 B5 裁决 —— 两层计数都记

| 层 | 新增 | 减少 |
|---|---|---|
| **UnifiedGraph 层（去重前，`resolveCalls` 输出）** | **303 条**（125 个不同的 `source\|relation\|target\|confidence` 键） | **0 条** |
| **最终图层（graph-builder 第五路 dedup 后）** | **calls +127**（= 新分支 125 + 新符号自证 2）；总边 +149 | **0 条** |

UnifiedGraph 层的取数方式（`unified-layer-count.mjs`，scratchpad，sha256
`b44c114573b9c5ec94339d93706cef0687b4869de3bb5b93770590095eeff2ee`）：同一批 callSites 跑两次
`resolveCalls`，第二次把 `receiverType` / `receiverTypeSoleImportBinding` 剥掉
（新分支因条件 ① 恒不成立而静默失效，等价于 plan §8 声明的「摘 P4」），两侧边**多重集**求差。

`303 − 125 = 178` 条是同键重复（同一 source 符号对同一目标方法的多次调用），
被第五路 first-write-wins 折叠 —— 这正是 B5 要求「以去重前为准」的原因：只看最终图会把 303 低估成 125。

### 4.2 探针与实现的交叉核对

| 量 | 独立探针（实现前手写） | 真实现（实测） |
|---|---|---|
| 六条件通过的调用点 | 303 | 303 |
| 去重后不同 target | 85 | 85（125 个不同边键落在 85 个 target 上） |
| 可达 method 节点并集 | 236 | 236（`coverage-P4.json` 的 `methodWithInEdge`） |

两个独立实现给出同一组数字。

### 4.3 B6 的 retarget 例外**未被用到**（实测，非推演）

plan §6 预留了「≤308 条成对 retarget」的例外，理由是「308 个 receiver 形态调用点今天已产出存活边」。
本轮**两层的减少边都是 0**，`retargetPairs = 0`。

多重集口径下「减少 = 0」等价于：被新分支接管的 303 个调用点，**在改动前全部 `resolveOne` 返回 null**
（若其中任何一个此前产出过边 X，X 的多重度会掉 1 而进入 removed 集）。这与 fix-report §2 Why-2
的根因一致：它们是 `cross-module` + 接收者表达式 qualifier，Stage 3 查表必然未命中，
而 `cross-module` 不在 Stage 4 fallthrough 白名单 ⇒ 直接 `return null`。
那 308 条「已产出存活边的 receiver 形态调用点」与本轮的 303 条是**不相交**的两组
（前者走 Stage 2 大写 qualifier 路径，未通过六条件与门）。

### 4.4 判定 —— **两项 PASS，两项 FAIL**

```
✓ P4-只增不减（例外：成对 retarget ≤308） — 不成对减少边 = 0；retarget 对 = 0
✗ 裁决 P2-1 — 新增边逐条归入三分类 — retarget 0 / 新符号自证 21 / 阶段期望 125 / **无法归类 3**（须为 0）
✗ 断言 2 — 新增 calls 边 target 落在非 class 声明上的条数 = 0 — 违规 2 / 通过 125 / 未判定 0
✓ 断言 3 — 无悬空新增边 — 悬空新增边 = 0
结论: FAIL
```

---

## 5. 两条 FAIL 的逐条实证（**不自行改判**）

### 5.1 §7.1 断言 3（无悬空新增边）—— PASS

`danglingAdded = 0`。149 条新增边的 source 与 target 全部存在于最终图节点集。

### 5.2 §7.1 断言 4（P4 减少边仅限 ≤308 成对 retarget）—— PASS

减少边 = 0（两层）。见 §4.1 / §4.3。

### 5.3 FAIL(1) —— 裁决 P2-1 三分类出现 3 条 `unclassified`

三条**全部**是新建文件自己的 `depends-on` 出边：

```
src/knowledge-graph/receiver-type-resolution.ts --depends-on--> src/knowledge-graph/call-resolver.ts
src/knowledge-graph/receiver-type-resolution.ts --depends-on--> src/knowledge-graph/unified-graph.ts
src/knowledge-graph/receiver-type-resolution.ts --depends-on--> src/models/code-skeleton.ts
```

**成因（机械可核）**：裁决 P2-1 第 2 类「新符号自证边」的机械判据是
**「target 节点在上一阶段基线的节点集中不存在」**。这三条边的 **target 是既有模块**、
**source 才是本阶段新增的模块节点**，因此判据结构上无法把它们归入第 2 类。
反向的那条（`call-resolver.ts --depends-on--> receiver-type-resolution.ts`，target 是新节点）
则被正确归入第 2 类 —— 同一对依赖关系的两个方向被判成两类，可见缺口在判据的方向性上。

P3 没有暴露这个缺口，是因为 P3 新建的 `typescript-receiver-env.ts` 只 import 了外部包
`web-tree-sitter`（无项目内节点），出边为 0。本轮新建文件 import 了 3 个项目内模块。

**处置**：如实判 FAIL，**未改 `edge-diff.mjs`**、未把这 3 条排除统计。
是否按裁决 P2-1 的同款方式把第 2 类扩为「**source 或 target** 为本阶段新增节点」，请编排器裁决。
（这三条边本身经回源码核对为真实 import：`receiver-type-resolution.ts` 的 4 条 import 语句里，
`CodeSkeleton` / `UnifiedEdge` / `CallSiteWithFile` 三个来源模块即这三个 target。）

### 5.4 FAIL(2) —— §7.1 断言 2 出现 2 条违规

```
src/knowledge-graph/call-resolver.ts::resolveCalls --calls--> …::buildReceiverTypeIndex   (exportKind=function)
src/knowledge-graph/call-resolver.ts             --calls--> …::resolveReceiverTypeCall   (exportKind=function)
```

**机械核实**：这 2 条违规边与 125 条新分支边的**交集为空**（脚本核对
`assertion2 违规 ⊆ new-symbol calls = True`，`违规 ∩ phase-expected = 0`）。
即 —— **新分支产出的 125 条边全部通过断言 2**（`ok: 125`，`notEvaluated: 0`）：
每条边的 target 都是 member 节点，其所属 symbol 节点 `metadata.exportKind === 'class'`，
且该成员来自那个 `kind === 'class'` 的 export 条目自己的 `members`（`--skeletons exports-P4.json` 两跳判据）。

违规的 2 条是「本次改动新增了两个导出函数，调用方于是获得了指向它们的真实调用边」——
与 P2 的 `buildNamedImportBindings`、P3 的两条新符号自证边**逐字同构**，
正是裁决 P2-2 说的「过度外延」形态。

**但**：裁决 P2-2 的落地是「`edge-diff.mjs` 需按边的来源分类后再施加该断言」，而工具当前在
`--phase P4` 下对**全部**新增 calls 边施加断言（P2/P3 才退为信息项）。因此按字面判 FAIL。

**处置**：如实判 FAIL，**未改工具让断言只覆盖 `phase-expected` 类**、未把这 2 条排除统计。
是否把裁决 P2-2 的作用域限定延伸到 P4/P5 的 `new-symbol` 类边，请编排器裁决。

### 5.5 §7.1 断言 1（硬断言）—— **PASS**

`impact(upstream, depth=2)` 对 `src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes`
（直接调 `dist/mcp/agent-context-tools.js::handleImpact`，projectRoot 指向装有对应 `specs/_meta/graph.json`
的 scratchpad 目录，两侧口径完全一致）：

| 基线 | `affected` 条数 | 含 `batch-orchestrator` | 含 `graph-assembly` |
|---|---|---|---|
| **P3t（改动前）** | **0** | false | false |
| **P4（改动后）** | **30** | **true**（`src/batch/batch-orchestrator.ts::runBatch`） | **true**（`src/batch/stages/graph-assembly.ts::buildAstGraphOnly`） |

改动前的 `affected: []` 与 fix-report §1 描述的原始症状逐字一致（症状在当前 HEAD 上原样复现），
改动后两个真实调用者同时出现。**断言 1 成立。**

### 5.6 §7.1 断言 5（覆盖率下限）—— **PASS**

| | P3t | P4 |
|---|---|---|
| method 节点 / 有入边 / 覆盖率 | 517 / 152 / **29.4%** | 517 / 236 / **45.6%** |
| function 节点 / 有入边 / 覆盖率 | 1469 / 1313 / 89.4% | 1471 / 1315 / 89.4% |
| gapPct | 60.0 | 43.8 |
| **gapRatio** | 3.04 | **1.96** |

- 下限 `max(40.0%, U×0.75 = 34.2%) = 40.0%` ⇒ 实测 **45.6% ≥ 40.0%**，通过。
- `gapRatio = 89.4 / 45.6 = 1.96 ≤ 2.3`，通过。
- method 分母 517 未变：新建文件的导出接口成员全部是 `memberKind==='property'`（有意为之，
  避免新增纯类型的 method 节点稀释分母）；function 分母 +2 是新建的两个导出函数自身。
- 实测覆盖率**恰好等于**结构上界 `U`（45.6%）—— 因为 `U` 的定义就是「六条件可达面 ∪ 已有覆盖」，
  而新分支是确定性的：可达即出边。这说明该下限判据在本设计下**判别力偏弱**（`U×0.75` 恒不生效，
  实际生效的是 40.0% 地板），如实登记，不作它用。

### 5.7 图质量六指标（不劣于 P0 / P3t）

| 指标 | P0 | P2 | P2t | P3 | **P3t** | **P4** |
|---|---|---|---|---|---|---|
| duplicate-canonical-id | pass | pass | pass | pass | pass | **pass** |
| contains-coverage | pass 6254/6254 | pass 6256/6256 | pass 6257/6257 | pass 6266/6266 | pass 6266/6266 | **pass 6284/6284** |
| orphan-ratio | pass 0 | pass 0 | pass 0 | pass 0 | pass 0 | **pass 0** |
| dangling-edge | pass | pass | pass | pass | pass | **pass** |
| legacy-ignored | pass | pass | pass | pass | pass | **pass** |
| freshness | dirty | dirty | dirty | dirty | dirty | **dirty** |
| **overallVerdict** | pass | pass | pass | pass | pass | **pass** |

freshness 两侧同为 `dirty`（工作区有未提交改动，`recordedSourceCommit == currentHead`），不劣于 P0。

---

## 6. 信息项：callSites 指纹（`P3t → P4`）

**不是 P4 的判据**（B1 裁决只把它定为 P3 的主锚点），此处作信息项记录以确认抽取层未被扰动。

| 口径 | 结果 |
|---|---|
| 主口径（含 `line` / `column`） | before 123237 / after 123260；新增 166 / 减少 143 |
| 位置无关口径（`--position-free`） | 新增 29 / 减少 6 |
| 压缩摘要（`--digest`）逐文件指纹变化 | **2 / 1149 个文件**，恰为本次修改的 2 个源文件 |

位置无关口径下的 6 条「减少」**全部**在 `call-resolver.ts`，且与 6 条「新增」一一对应、
`callerContext` 只差一个固定偏移：

```
<arrow:312:10> → <arrow:318:10>   <arrow:313:10> → <arrow:319:10>
<arrow:385:8>  → <arrow:391:8>    <arrow:386:8>  → <arrow:392:8>
<arrow:446:13> → <arrow:452:13>   <arrow:447:13> → <arrow:453:13>
```

偏移恒为 **+6**，等于本轮在这些匿名箭头之前插入的行数（2 行 import + 1 行索引构建 +
2 行 `ResolverIndices` 字段 + 1 行 `receiverTypeIndex,` 实参 = 6）。
成因：**匿名上下文名本身把 `line:col` 编进了字符串**（`<arrow:L:C>`），
所以 `--position-free` 剔掉 `line`/`column` 两个字段仍拦不住行号位移经 `callerContext` 泄漏 ——
这是裁决 P3-1 处理过的那个结构性假阳性的**残余通道**，如实登记（不改工具）。

其余 23 条新增全部落在新建文件（18 条）与 `call-resolver.ts` 新写的 3 处调用（`buildReceiverTypeIndex` /
`resolveReceiverTypeCall` / `importIndex.get`）上。全局摘要 sha256：

```
global P3t = 3552a0388009fd770a7bffa556378a7557d69c0beef1bc272d6e3b8c90e042d5
global P4  = 1a75f680c605d7cdb450ade4226d36f68d93211997cabac3a8f1c184436df5b0
```

---

## 7. 变异测试报告（裁决 P3-2 强制）

### 7.1 跑法

跑批器 `mutation-run-p4.mjs`（scratchpad，sha256
`d9945127316e746be54d83a3d87e85471e86671671645647d8810a259c4440a4`）。
每个变异体：对 `src/knowledge-graph/receiver-type-resolution.ts` 做单/多锚点替换
（**每个锚点命中次数必须恰好 1**，否则抛错并还原）→ 跑
`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts --reporter=json` → 逐字还原源码。
基线（PRISTINE）先跑一遍：`89 tests / 0 failed`，非全绿即中止。收尾核对源码逐字还原为 true。

### 7.2 结果（13 个变异体，全部被杀死）

| 变异体 | 被移除 / 破坏的判据 | 转红的用例 |
|---|---|---|
| `C1-qualifier-fallback` | 条件 ① —— 改用裸 `calleeQualifier` 夺路 | **R12**（+ 既有 `Python case 3`） |
| `C2-drop-suppression` | 条件 ②（H5 抑制拦截）整体移除 | **R8** |
| `C2-after-local-export` | 条件 ② **后置**到本模块导出查找之后（只在走 import 表时拦） | **R8** |
| `C3-drop-sole-import-flag` | 条件 ③ 的 A1 正向许可整体移除 | **R6, R7** |
| `C3-flag-fail-open` | 条件 ③ 的 A1 判据 fail-open（`undefined` 放行） | **R7** |
| `C3-drop-renamed` | 条件 ③ 的 `renamedImportAliases` 子句（D1 弃权） | **R6b** |
| `C3-drop-default-import` | 条件 ③ 的 A2 default import 弃权 | **R10c** |
| `C4-accept-any-kind` | 条件 ④ 放宽为「有条目就行」 | **R9, R10** |
| `C5-drop-member-check` | 条件 ⑤ 成员验证移除（= 产 medium 占位） | **R10b, R11** |
| `A6-merge-members` | A6 攻击：声明合并时把同名条目 `members` 取**并集**（④⑤ 不再同一条目） | **R10b** |
| `A6-last-write-wins` | A6 攻击：条目选取改 last-write-wins（与节点派生反向） | **R10b** |
| `A6-prefer-class-entry` | A6 攻击：条目选取改「优先挑 `kind==='class'`」（不再与节点派生同序） | **R10b** |
| `T6-confidence-high` | 条件 ⑥ 置信度 `medium` → `high` | **R4, R5, R9b, R10b, R16** |

**每个变异体都被至少 1 个用例杀死；§3 里那 8 条实现前必然真空绿的弃权型断言，
现在每一条都有对应变异体将其杀死**：

| 弃权型断言 | 杀死它的变异体 |
|---|---|
| R6（③ A1 flag=false） | `C3-drop-sole-import-flag` |
| R6b（③ D1 重命名别名） | `C3-drop-renamed` |
| R7（③ fail-closed，flag 缺席） | `C3-drop-sole-import-flag` / `C3-flag-fail-open` |
| R8（② H5 + **拦截前置**） | `C2-drop-suppression` / `C2-after-local-export` |
| R9（④ 目标为 interface，经 import） | `C4-accept-any-kind` |
| R10（④ 目标为 interface，经本模块导出） | `C4-accept-any-kind` |
| R10b（⑤ 与 ④ 绑定同一条目 + 选条目顺序） | `C5-drop-member-check` / `A6-merge-members` / `A6-last-write-wins` / `A6-prefer-class-entry` |
| R10c（③ A2 default import） | `C3-drop-default-import` |
| R11（⑤ 成员验证失败不产占位） | `C5-drop-member-check` |
| R12（不夺路 + 弃权即 fallthrough） | `C1-qualifier-fallback` |

### 7.3 首轮暴露的判别力缺口（已补强）

首轮设计变异体时发现：**条件 ③ 的 `renamedImportAliases` 子句在 D5 的 R4–R16 清单里没有任何用例覆盖**。
R1/R1b 覆盖的是 P2 的两处消费点（Stage 2 import 回退 / Stage 3 查表），
**新分支这第三处消费点当时是裸的** —— 把该子句删掉，89 条用例里一条都不会红。

补强用例 **R6b**（承接 P3 补 M12e/M12f/M12g 的先例）。构造要点：
光把某个名字放进 `renamedImportAliases` 是**测不出来的** —— 重命名条目本来就不写 `aliasToTarget`，
条件 ③ 会先在「别名表查不到」这一步弃权，该子句不可观测。真正的承重形态来自
`ImportInfo.renamedImportAliases` 的字段注释：顶层 `import { Foo as X }` 让 `X` 成为重命名别名，
而**另一个作用域**的 `const { X } = await import('./c.js')` 会在 dynamic 收敛第二遍把键 `X` 写成 `c.ts`
（静态未占用该键）。此时表里**确实有** `X → c.ts`，少了这道闸就会产出跨作用域截胡的 medium 假边。
R6b 先断言前提（`aliasToTarget.get('X') === 'c.ts'` 且 `renamedImportAliases.has('X')`），再断言不出边。

### 7.4 未做变异的面（如实登记）

- **新分支在 `resolveOne` 中的插入位置**（Stage 1 之后、Stage 2 之前）没有对应变异体。
  把它挪到 Stage 2 之后在当前用例集下不可观测（本轮 303 个命中调用点在改动前全部返回 null，
  §4.3 已实证），因此构造不出有判别力的变异体。**这是一个已知的守护力缺口**，不粉饰。
- P2/P3 的判据未再做变异（P3 已做过，本轮无改动）。

---

## 8. 抽样核对表（T034，≥20 条，随机不挑好核的）

抽样口径：从 125 条 `phase-expected`（新分支产出）边中用固定种子 `random.seed(260)` 随机抽 **22** 条，
**不做任何人工筛选**。抽样集合已核对为重取基线后 `phase-expected` 集的子集。
逐条回源码 grep 定位真实调用点：

| # | source | target | 源码证据 | 结论 |
|---|---|---|---|---|
| 1 | `scripts/eval-calibrate.mjs` | `scripts/lib/parallel-run-pool.mjs::ParallelRunPool.run` | L318 `const pool = new ParallelRunPool({…})`；L345 `await pool.run(jobs)` | ✅ 真边 |
| 2 | `scripts/eval-pool-rerun.mjs` | 同上 | L402 `new ParallelRunPool({…})`；L415 `await pool.run(jobs)` | ✅ 真边 |
| 3 | `scripts/eval-validate.mjs` | 同上 | L335 `new ParallelRunPool({…})`；L346 `await pool.run(jobs)` | ✅ 真边 |
| 4 | `src/cli/commands/index.ts` | `src/watcher/file-watcher.ts::FileWatcher.start` | L274 `const watcher = new FileWatcher(…)`；L315 `await watcher.start()` | ✅ 真边 |
| 5 | `src/cli/commands/index.ts` | `…::FileWatcher.stop` | 同上；L323 `await watcher.stop()` | ✅ 真边 |
| 6 | `src/panoramic/batch-project-docs.ts::generateBatchProjectDocs` | `…/cache-manager.ts::CacheManager.flush` | L199 `const cacheManager = new CacheManager(…)`；L257 `await cacheManager.flush()` | ✅ 真边 |
| 7 | 同上 | `…::CacheManager.record` | L216 / L245 `await cacheManager.record(…)` | ✅ 真边 |
| 8 | `…/architecture-overview-generator.ts::ArchitectureOverviewGenerator.isApplicable` | `…/workspace-index-generator.ts::WorkspaceIndexGenerator.isApplicable` | L54 `isApplicable(context)` 内 L56 `new WorkspaceIndexGenerator().isApplicable(context)` | ✅ 真边（`new X().m()` 形态） |
| 9 | `…/pattern-hints-generator.ts::PatternHintsGenerator.extract` | `…::ArchitectureOverviewGenerator.extract` | L45 `private readonly architectureOverviewGenerator: ArchitectureOverviewGenerator`；L61 `await this.architectureOverviewGenerator.extract(context)` | ✅ 真边（`this.x` 按 `ClassName#x` 分桶命中） |
| 10 | `…/toml-config-parser.ts::parseTomlContent` | `…/comment-tracker.ts::CommentTracker.consume` | L49 `const tracker = new CommentTracker()`；L100 `tracker.consume()` | ✅ 真边 |
| 11 | `tests/adapters/java-extract-comments.test.ts` | `src/adapters/java-adapter.ts::JavaLanguageAdapter.extractComments` | L18 `const adapter = new JavaLanguageAdapter()`；L27 `await adapter.extractComments(file)` | ✅ 真边 |
| 12 | `tests/adapters/ts-js-adapter-equivalence.test.ts` | `…/ts-js-adapter.ts::TsJsLanguageAdapter.analyzeFile` | L28 `const adapter = new TsJsLanguageAdapter()`；L51 `await adapter.analyzeFile(filePath)` | ✅ 真边 |
| 13 | `tests/adapters/ts-js-adapter.test.ts` | `…::TsJsLanguageAdapter.getTestPatterns` | L9 `const adapter = new TsJsLanguageAdapter()`；L49 `adapter.getTestPatterns()` | ✅ 真边 |
| 14 | `tests/fixtures/ky/src/core.ts::Ky.execute` | `tests/fixtures/ky/src/retrier.ts::Retrier.waitBeforeRetry` | L10 `private readonly retrier: Retrier`；L31 `await this.retrier.waitBeforeRetry()` | ✅ 真边 |
| 15 | `tests/panoramic/cache/content-hasher.test.ts` | `…/content-hasher.ts::ContentHasherImpl.hashContent` | L23 `const hasher = new ContentHasherImpl()`；L158/159/164 `hasher.hashContent('…')` | ✅ 真边 |
| 16 | 同上 | `…::ContentHasherImpl.hashFile` | L42/43/47/58 `await hasher.hashFile(…)` | ✅ 真边 |
| 17 | `tests/panoramic/cache/manifest-manager.test.ts` | `…/manifest-manager.ts::ManifestManagerImpl.flush` | L51 起多处 `const mgr = new ManifestManagerImpl()`；L123/235 `await mgr.flush(manifestPath)` | ✅ 真边 |
| 18 | 同上 | `…::ManifestManagerImpl.load` | L53/71/92/106 `await mgr.load(…)` | ✅ 真边 |
| 19 | 同上 | `…::ManifestManagerImpl.stats` | L55/94 `mgr.stats()` | ✅ 真边 |
| 20 | `tests/panoramic/pattern-hints-generator.test.ts` | `…::PatternHintsGenerator.extract` | L214 `generator = new PatternHintsGenerator()`；L223/280/300 `await generator.extract(…)` | ✅ 真边 |
| 21 | `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | `src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes` | L472 `await new PythonLanguageAdapter().extractSymbolNodes(staged)` | ✅ 真边 |
| 22 | `tests/unit/ts-js-adapter-callsite.test.ts` | `…::TsJsLanguageAdapter.analyzeFile` | L26 `const adapter = new TsJsLanguageAdapter()`；L41 `await adapter.analyzeFile(filePath, options)` | ✅ 真边 |

**22 / 22 全部核对为真实调用点，假边 0 条。**（T034 的 `p4-sample-audit.md` 内容即本节，
不另立文件重复同一张表。）

样本覆盖到的形态：局部变量（1–3, 10–13, 15–22）、类实例字段 `this.x`（9, 14）、
即用即弃 `new X().m()`（8, 21）、跨包（`scripts/` → `scripts/lib/`、`tests/` → `src/`）。

---

## 9. 不入库大产物：sha256 与生成命令（裁决 P2-4）

留在 scratchpad `<scratchpad>/f260-p4/`，清单同时写入该目录的 `SHA256SUMS.txt`。

| 文件 | sha256 |
|---|---|
| `graph-P3t2.json` | `32bbc487fe3f67b2854fc197f8345b18e95bb29d72660ab4427aa743821bf944` |
| `callsites-P3t2.json` | `638c86f51e51c24c3079b944ec192e66a0eb19253c84c8e09d1a48e171a16de2` |
| `exports-P3t2.json` | `4e29fcf78bfa57603339fc70004e13d68332c48e627a2b533d635e0743aef086` |
| `graph-P4.json` | `7beb7b3d2cd01a1c0bab6b189128439644fcb3c768de3e7694e5312d4390b5b5` |
| `callsites-P4.json` | `1bfeb442b07cf629614eb8e441e4b84c8d5784f9e8e327e328399c053f3f1a78` |
| `exports-P4.json` | `7cc75eec247b71573eade88927ed2cf3241f24be6eec963687bb549a1227a160` |
| `p4-probe.mjs`（前置复核 + `U` 探针） | `f15c81b9b3419acb6c1d697e942972f2a35fbaa14ce563e4152a04c6e0d6b3b6` |
| `unified-layer-count.mjs`（B5 去重前计数） | `b44c114573b9c5ec94339d93706cef0687b4869de3bb5b93770590095eeff2ee` |
| `mutation-run-p4.mjs`（变异测试跑批器） | `d9945127316e746be54d83a3d87e85471e86671671645647d8810a259c4440a4` |

> `graph-P3t2.json` 的 `P3t2` 后缀是第二次重取的标签（§2.2）；报告正文一律称其为 **P3t**。

生成命令（`<tag>` ∈ {`P3t2`, `P4`}，`<V>` = `specs/260-fix-instance-method-call-edges/verification`，
`<SP>` = scratchpad 目录）：

```bash
npm run build                                                     # 硬约束：先建 dist
node dist/cli/index.js --version                                  # 确认跑的是本 worktree 产物
node dist/cli/index.js batch --mode graph-only --output-dir <SP>/out-<tag>
cp <SP>/out-<tag>/_meta/graph.json <SP>/graph-<tag>.json
node <V>/dump-skeletons.mjs <tag> && mv <V>/callsites-<tag>.json <V>/exports-<tag>.json <SP>/
node dist/cli/index.js graph-quality --graph <SP>/graph-<tag>.json --json > <V>/<tag>-graph-quality.json
node <V>/coverage-metric.mjs <SP>/graph-<tag>.json > <V>/coverage-<tag>.json
node <V>/callsites-fingerprint.mjs --digest <SP>/callsites-<tag>.json > <V>/callsites-digest-<tag>.json
```

比较 / 验收命令：

```bash
node <V>/edge-diff.mjs <SP>/graph-P3t2.json <SP>/graph-P4.json \
  --phase P4 --skeletons <SP>/exports-P4.json --json > <V>/edge-diff-P3t-to-P4.json
node <V>/callsites-fingerprint.mjs <SP>/callsites-P3t2.json <SP>/callsites-P4.json --json \
  > <V>/callsites-fingerprint-P3t-to-P4.json
node <V>/callsites-fingerprint.mjs <SP>/callsites-P3t2.json <SP>/callsites-P4.json --json --position-free \
  > <V>/callsites-fingerprint-positionfree-P3t-to-P4.json
node <SP>/p4-probe.mjs "$(pwd)" <SP>/graph-P3t2.json          # T024/T025/T026
node <SP>/unified-layer-count.mjs "$(pwd)"                    # B5 去重前计数
node <SP>/mutation-run-p4.mjs "$(pwd)"                        # 变异测试
```

`impact` 硬断言的跑法（不覆写仓库 `specs/_meta/graph.json`）：把待测图复制到
`<SP>/impact-root-<tag>/specs/_meta/graph.json`，再直调
`dist/mcp/agent-context-tools.js::handleImpact({ target, direction:'upstream', depth:2, projectRoot })`。

---

## 10. 门禁（§7.2）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 构建 | `npm run build` | 退出码 **0** |
| 全量单测 | `npx vitest run` | 退出码 **0**；`Test Files 523 passed \| 4 skipped (527)` / `Tests 7212 passed \| 18 skipped \| 21 todo (7251)`，**零失败** |
| 插件测试 | `npm run test:plugins` | 退出码 **0**；`pass 1580 / fail 0` |
| 仓库校验 | `npm run repo:check` | 退出码 **0**（warning 见下） |
| 发布合同 | `npm run release:check` | 退出码 **0**，`Release contract valid` |
| 图质量 | `graph-quality --graph graph-P4.json` | `overallVerdict = pass`，六指标不劣于 P0/P3t |

对账：P3 收尾为 `7198 passed`，本轮新增 R4–R12 / R16 + R9b / R10b / R10c 共 13 条 + 补强的 R6b 1 条
= `7198 + 14 = 7212`，与实跑数字一致，**没有失败被跳过或屏蔽**。

**`repo:check` 的 warning（预先存在，与 P4 无关）**：

```
[graph-quality] 图产物已 stale（source-commit）：图记录的 sourceCommit（dfe6c479…）
与当前 HEAD（0d3e385f…）不一致
```

指的是 `specs/_meta/graph.json`（建于 `dfe6c479`），本轮全程未触碰（所有建图都走 `--output-dir`
到 scratchpad）。这是 **R-7** 已登记的「图需全量重建」现象的一个实例。

**`collector-fingerprint` 护栏**：照常在全量 vitest 中跑绿，但按 B7 裁决**不构成 F260 的验证信号**
（pinned 图 TS/JS 侧 calls 边 = 0，本次改动对该 fixture 结构性无投影，R-14）。
`BEHAVIOR_VERSION` 未 bump，依据是这条实测事实本身而非护栏跑绿。

---

## 11. 实现要点与预算

| 文件 | 动作 | 实际增量 | 预算 |
|---|---|---|---|
| `src/knowledge-graph/receiver-type-resolution.ts` | **新建** —— D2b 六条件与门 + `buildReceiverTypeIndex` | 175 行（含 ~95 行注释） | +110（plan §5 #10） |
| `src/knowledge-graph/call-resolver.ts` | 2 行 import + 1 行索引构建 + 1 行实参 + 2 行 `ResolverIndices` 字段 + 12 行分支块 | **净 +18 行**（807 → 825，删除 0 行） | ≤ 40（plan §5 #11） |

**`call-resolver.ts` 净增量 18 行，在 ≤40 预算内**（`diff -u` 实测 +18 / −0）。
新建文件超出 +110 的估值（175 行），超出部分全部是注释与类型声明；判据代码本体约 40 行。
如编排器认为该预算是硬上限，请裁决。

### A6 落地形态（承重，逐条对应 plan 的要求）

- **④ 与 ⑤ 绑定同一个 export 条目**：`buildReceiverTypeIndex` 建 `file → name → { kind, members }`，
  ⑤ 用的是 ④ 命中的那一条自己的 `members`。**刻意不复用 `buildClassMemberIndex`**（last-write-wins，
  与节点派生反向，R-12）。
- **选条目走 first-write-wins**，与 `deriveNodesFromSkeletons` 逐字同序（同样跳过 `re-export`）。
  这一条不是可选风格 —— 若改成「挑出 `kind==='class'` 的那条」，声明合并且 interface 在前时，
  边会挂在 `metadata.exportKind === 'interface'` 的符号节点下，**直接打破断言 2**。
  代价是「interface 在前」的声明合并一律弃权（R10b 第三段把这条取舍钉死为回归断言）。
- **② 前置于 ③**：`suppressedDynamicAliases` 检查在 `locateClassFile` 之前，
  变异体 `C2-after-local-export` 证明这个顺序有守护力（R8 转红）。
- **A2 default import 弃权**：`defaultImportAliases` 建在新模块自己的索引里，
  **未改 `ImportInfo`**，既有 Stage 2/3 对 `defaultImport` 的处理一行未动（R-11 保持登记）。

---

## 12. 本轮未做 / 待编排器裁决的事

1. **两条判据 FAIL，已停下报告，未改工具 / 未改判据 / 未把违规项排除统计**（§5.3 / §5.4）。
   两条都是**判据作用域缺口**，与裁决 P2-1 / P2-2 处理过的两次同构，但**是否收窄由编排器裁决**。
2. **未碰 P5**：`buildClassMroIndex` / `stripGenericParams` 一行未动。
3. **未做任何 git 写操作**。
4. **红先行的如实登记**：13 条用例里只有 5 条能在实现前判红，8 条弃权型断言实现前**结构性必然真空绿**
   （§3）；其判别力由 §7 的变异测试建立，不由红先行建立。
5. **已知守护力缺口**：新分支在 `resolveOne` 中的**插入位置**没有变异体守护（§7.4）。
6. **判据判别力偏弱的登记**：断言 5 的 `U × 0.75` 项在本设计下恒不生效（实测覆盖率恒等于 `U`），
   实际生效的只有 40.0% 地板（§5.6）。
7. **审查档位**：Codex 配额耗尽期，本轮对抗面由**变异测试**（13 变异体 × 89 用例）承担，
   属「异构内部对抗」的一种形态，但**不等价于**独立子代理的双切入角对抗审查。
   如需按 CLAUDE.local.md 的暂停期档位补齐，应在 P4 收口 commit 前另行安排，
   并在 commit message 标注「Codex 审查暂停，异构档位缺席」。
