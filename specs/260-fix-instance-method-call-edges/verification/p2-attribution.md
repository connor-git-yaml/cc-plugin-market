# F260 P2 A/B 归因报告（T015）

> 本文件只记录**实跑得到的**数字与逐条核对结论。工具产物：
> `edge-diff-P0t-to-P2.json`（主锚点）/ `edge-diff-P0-to-P2.json`（含测试噪声，存档）/
> `callsites-fingerprint-P0t-to-P2.json` / `P0-graph-quality.json` / `P2-graph-quality.json` /
> `coverage-P0.json` / `coverage-P2.json`。

## 0. 基线口径修正：多引入一个 `P0t` 锚点

plan §6 的 P2 归因假设「P0 → P2 的差就是 P2 源码改动的差」。**实测该假设在本仓不成立**：
`collectTsJsCodeSkeletons` 会采集 `tests/**`（`graph-P0.json` 实测含 1305 个 `tests/` 节点、
1310 条 source 在 `tests/` 的 calls 边），而 P2 的红先行用例本身就是新增 TS 源码 ⇒
测试改动会混进边集 diff。

处置：在**红先行用例已落地、源码仍是 HEAD 版本**的中间态上多产一份基线 `graph-P0t.json`
（用 `git show HEAD:<file>` 只读还原 5 个 src 文件后建图，随后逐字还原实现，`git status`
两次核对）。**P2 的归因主锚点因此是 `P0t → P2`**，`P0 → P2` 仅存档。

实测差值印证了该处置的必要性：`P0 → P0t`（纯测试改动）= +1 条 `depends-on` 边、
+105 条 callSite、0 条 calls 边变化。

| 快照 | 节点 | 边 | calls | depends-on | callSites |
|---|---|---|---|---|---|
| P0（HEAD 源码 + HEAD 测试） | 7553 | 12713 | 3843 | 2616 | 122464 |
| P0t（HEAD 源码 + P2 测试） | 7553 | 12714 | 3843 | 2617 | 122569 |
| P2（P2 源码 + P2 测试） | 7555 | 12718 | 3845 | 2617 | 122608 |

## 1. 可复现性前置校验

同一 HEAD 连跑两次 `batch --mode graph-only`，`edge-diff.mjs` 输出
`addedTotal=0 / removedTotal=0`。⇒ 建图对同一输入确定性可复现，非零 diff 可归因到输入改动
（B5 要求的「第五路 dedup 顺序敏感性」在同一输入顺序下不构成噪声源）。

## 2. 主锚点：`P0t → P2` 逐边 diff

```
新增 5 条 {"calls":3,"contains":2} / 减少 1 条 {"calls":1}
retarget 对 0
不成对新增 calls 3 / 不成对减少 calls 1
```

**`edge-diff.mjs` 判定结论为 FAIL**（不成对新增 3 ≠ 0；断言 2 违规 3）。
下面逐条核对，**不修改判据、不调整工具**。

### 2.1 新增的 3 条 calls 边 —— 全部指向本次新增的源码符号

| # | source | target | 核对 |
|---|---|---|---|
| 1 | `src/core/ast-analyzer.ts`（模块节点，caller `extractImports` 未导出 ⇒ F242 模块兜底） | `src/models/code-skeleton.ts::buildNamedImportBindings` | 真实调用点 `ast-analyzer.ts:478` |
| 2 | `src/core/query-mappers/typescript-mapper.ts::TypeScriptMapper._extractImportStatement` | 同上 | 真实调用点 `typescript-mapper.ts:905` |
| 3 | `src/core/tree-sitter-fallback.ts`（模块节点） | 同上 | 真实调用点 `tree-sitter-fallback.ts:133` |

（`ast-analyzer.ts:683` 的第四个调用点在 `bindingNamesOf` 内，与 #1 同 source 同 target，
被第五路 dedup 折叠，故净增 3 而非 4。）

**性质判定**：这三条不是「解析逻辑变化派生出的边」，而是**新写的源码本身**产生的真实调用边
——`buildNamedImportBindings` 是本次为收敛 D1 产出规则新增的导出函数（同时带来 2 条
`contains` 边与 2 个新符号节点 `buildNamedImportBindings` / `NamedImportBinding`）。

**⚠️ 与判据的偏差（如实登记，未自行改判）**：
- plan §6 P2 行的「只减不增，例外仅 retarget 对」与 T015 的「非 retarget 新增边数 = 0」
  **没有预见到 P2 的实现会新增一个导出符号**（plan §5 变更 #2 只写了「`ImportReferenceSchema`
  新增 `namedImportBindings?`，+12 行」）。按判据字面，本次 P2 **判 FAIL**。
- 同理，§7.1 断言 2（新增 calls 边 target 必须是 class）对这三条也判违规
  （target 的 `exportKind === 'function'`）——该断言的设计对象是 P4 新分支产出的类成员边，
  对「新增源码符号自身的调用边」不适用。
- **未做的事**：没有为了让判据通过而改工具、改判据、或把这三条边排除在统计外。
- **可选的消除办法**（需编排器裁决，本轮未擅自执行）：把 D1 产出规则**内联复制**到四条抽取
  路径以避免新增导出符号。执行侧不建议：那正是 F259 记录的「两个函数协同才成立的隐式耦合」
  形态，四份副本 = 四份漂移风险，而 D1 明确要求「四条抽取路径必须全覆盖」。

### 2.2 减少的 1 条 calls 边 —— H1 幽灵键派生边

```
plugins/spec-driver/scripts/lib/graph-refresh-executor.mjs::executeRefresh
  --calls--> plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs::attemptLocalGraphBuild
```

回源码核对（`graph-refresh-executor.mjs`）：

- L14：`import { attemptLocalGraphBuild as defaultAttemptLocalGraphBuild } from './graph-bootstrap-status.mjs';`
  ⇒ 文件内**唯一**的 import 绑定名是 `defaultAttemptLocalGraphBuild`。
- L55-61：`export async function executeRefresh({ …, attemptLocalGraphBuild = defaultAttemptLocalGraphBuild })`
  ⇒ 文件里叫 `attemptLocalGraphBuild` 的东西是**解构形参（依赖注入缝）**，不是 import 绑定。
- L72：`const result = await attemptLocalGraphBuild(buildOptions);` ⇒ 调用的是那个形参。

**修改前**该边的来源是 `aliasToTarget` 里的幽灵键 `'attemptLocalGraphBuild'`（源导出名，
非本文件绑定名），Stage 3 用 `calleeName` 查表命中后产出 —— 正是 H1 描述的机制
（「键 `Foo` 能出边的唯一途径是文件里恰好有别的东西叫 `Foo`」，这里的「别的东西」是 DI 形参）。

**如实定性（不 over-claim「确为假边」）**：
- **推导链不成立**：该名字在本文件不绑定到该 import，边是靠一个不该存在的键碰出来的；
  若该形参被注入了别的实现（测试路径就是这么用的），同一条推导会指向错误目标。
- **但目标事实上正确**：形参默认值就是那个 import，生产路径下运行时确实调用它。
- ⇒ 结论是「**推导不健全、结论恰好为真**」的边被移除，属于 R-1 登记的 recall 代价，
  不是「移除了一条指向错误目标的边」。plan §6 的措辞（减少的都是假边）在本例上应按此收窄。

**无不成对减少之外的减少**：`unpairedRemovedCalls = 1`，`retargetPairs = 0`
（本仓不存在「同一 imported 名既有重命名条目又有非重命名条目」的文件，故 plan §6 预告的
retarget 例外本次零实例）。

### 2.3 断言 3（悬空新增边）

`danglingAdded = 0`，通过。弃权后该调用点落 `?::attemptLocalGraphBuild` 占位、被
graph-builder 悬空过滤丢弃，图上无残留（`executeRefresh` 在 P2 图中已无任何 calls 出边）。

## 3. H1 收口的实际面（爆炸半径量化）

用 P2 构建产物对全仓 TS/JS 重跑采集：

```
importEntriesWithBindings: 36     # 携带 namedImportBindings 的 import 条目
renamedSpecifiers:         37     # 重命名说明符总数
filesWithRenamed:          24     # 涉及文件数
distinctPhantomKeys:       32     # 从 aliasToTarget 移除的幽灵键（file|imported 去重）
distinctLocalNames:        35     # 进入 renamedImportAliases 的本地绑定名
```

32 个幽灵键中只有 1 个真的在派生边 —— 与 plan §6 的论证一致（幽灵键要出边，得文件里恰好有
别的东西叫那个名字）。**其余 31 个是已经关闭的潜在假边面**，不产生 diff。

> #### ⚠️ P4b 修正注记（plan §13 **W-E**；2026-08-09 补）
>
> 原文这五个数字**没有记采集口径**，独立复算落在 30–33 区间，等于一个不可复现的断言。
> 裁决 P2-4 对大产物要求「sha256 + 生成命令」，W-E 把同一要求推广到统计数。**原文保留不删**，
> 补口径与更正如下。
>
> **① 落了可重跑重算器**：`verification/h1-phantom-key-stats.mjs`。
>
> ```bash
> npm run build && node specs/260-fix-instance-method-call-edges/verification/h1-phantom-key-stats.mjs
> ```
>
> P4b 实跑输出（与原文五个数字**逐字一致**，口径确认可复现）：
>
> ```json
> { "collectedFiles": 1239, "importEntriesWithBindings": 36, "renamedSpecifiers": 37,
>   "renamedSpecifiersTypeOnly": 3, "renamedSpecifiersValueOnly": 34,
>   "filesWithRenamed": 24, "distinctPhantomKeys": 32, "distinctLocalNames": 35,
>   "sameFileNameCollisions": 22 }
> ```
>
> **② 采集口径（W-E 点名要写清的三件事）**：
>
> | 项 | 口径 |
> |---|---|
> | 文件清单来源 | `collectTsJsCodeSkeletons(projectRoot, { extractCallSites: true })` —— 与 `buildAstGraphOnly` 同一采集器入口，共 **1239** 个文件 |
> | 是否含 gitignore 文件 | **不含**（随采集器口径；`node_modules` / `dist` 同理） |
> | 是否含 type-only import | **含**。37 条重命名说明符里 type-only **3** 条、值侧 **34** 条；两种口径都已分列，不必再猜 |
>
> **③ 强度更正（W-E 明确要求）**：「其余 31 个是已经关闭的潜在假边面」**方向成立，但强度被高估**。
> 实测 32 个幽灵键里有 **22 个**（本轮口径：`imported` 名在同文件原文里以词边界出现 >1 次）
> 同文件内**确实存在**同名标识符 —— 也就是说「文件里恰好有别的东西叫那个名字」这个前提
> **并不罕见**。它们最终没出边，是因为 target 落到外部模块 / 悬空被 graph-builder 丢弃，
> **不是**因为幽灵键机制罕见。
>
> > 口径差异如实登记：plan §13 W-E 记的是 **26** 个，本轮重算口径给出 **22** 个。
> > 差异来自「同名标识符」的判法（本轮用原文词边界正则计数，含注释与字符串字面量中的出现；
> > 审查方口径未在裁决里写明）。**两个数字支撑的是同一个方向性结论**，
> > 故不追平数字，只把本轮口径固化进脚本以便后续复算。

## 4. callSites 指纹（辅助信号）

`P0t → P2`：`added 789 / removed 750`（总条数 122569 → 122608）。
**差异 100% 落在本次修改的 5 个 src 文件内**：

```
src/core/ast-analyzer.ts, src/core/query-mappers/typescript-mapper.ts,
src/core/tree-sitter-fallback.ts, src/knowledge-graph/call-resolver.ts,
src/models/code-skeleton.ts
```

成因是新增代码导致的行号位移 + 新代码自身的调用点，**不是抽取语义变化**
（P2 不触碰 `extractCallSites`）。全仓其余 1294 个文件的 callSite 指纹逐字不变。

## 5. 六指标与覆盖率

| 指标 | P0 | P2 |
|---|---|---|
| duplicate-canonical-id | pass | pass |
| contains-coverage | pass (1.000) | pass (1.000) |
| orphan-ratio | pass (0.0%) | pass (0.0%) |
| dangling-edge | pass | pass |
| legacy-ignored | pass | pass |
| freshness | dirty | dirty |
| overallVerdict | pass | pass |

freshness 两侧同为 `dirty`（工作区有未提交改动，`recorded == currentHead`），**不劣于 P0**。

覆盖率（主口径）：

| | P0 | P2 |
|---|---|---|
| method 节点 / 有入边 / 覆盖率 | 515 / 152 / 29.5% | 515 / 152 / 29.5% |
| function 节点 / 有入边 / 覆盖率 | 1465 / 1309 / 89.4% | 1466 / 1310 / 89.4% |
| gapRatio | 3.03 | 3.03 |

method 覆盖率零变化符合预期 —— P2 是**前置收口**，不新增任何解析能力（新增能力在 P3/P4）。
function 侧 +1/+1 就是新增的 `buildNamedImportBindings` 自身。

## 6. 已知的产物噪声源（供后续阶段沿用同一口径）

`specs/260-.../verification/*.mjs` 本身是 `.mjs` 源文件，**会被 TS/JS 采集器采集进图**
（P0 基线里就含这几个文件的节点与边）。因此：

- 取任何一份 `graph-P*.json` 之前必须先冻结 verification 目录下的 `.mjs` 工具，
  中途改工具就要重取基线（本轮为此重取过一次 P0）。
- `edge-diff.mjs` / `callsites-fingerprint.mjs` 在 `graph-P0t.json` / `graph-P2.json`
  两次建图时内容**完全一致**，故 P0t→P2 比较不受其影响；两份图之后对这两个文件做过一次
  「`process.exit` → `process.exitCode`」修正（`process.exit` 会截断管道里未 flush 的 JSON），
  该修正不影响已落盘的两份图之间的可比性，但会使二者相对当前磁盘状态略微过期。

## 7. 大体积产物出库记录（plan §11 裁决 P2-4，2026-08-08 P3 开工前补记）

裁决 P2-4 定稿「`callsites-P*.json` / `graph-P*.json` / `exports-P*.json` 不入库」。
本轮（P3 开工）把 P0/P0t/P2 三批共 9 份产物从 `verification/`（当时 172 MB → 现 664 KB）
**移出**到 scratchpad（**未删除**），路径：

```
<scratchpad>/f260-artifacts/
```

移动前逐份记录 sha256（`shasum -a 256`），同一份清单另存
`<scratchpad>/f260-artifacts/SHA256SUMS.txt`：

| 文件 | sha256 |
|---|---|
| `callsites-P0.json` | `f925e9f552d30c077acd06d2b4f2de1a1032708d0b23a63460aa2b211768a2cf` |
| `callsites-P0t.json` | `f6e657f6c2d622836bf5e319f837792ef7d300ced797b7dbb9d0a67da9728d77` |
| `callsites-P2.json` | `53e611b1277d189bb7fed37f80de6765e12d035e4bb0ff3bba951caf7b5ce2a3` |
| `graph-P0.json` | `6dd6886df19cc5e7ca0282922d49a0dd7a70c0702bec6daca9369575cb2eb2cb` |
| `graph-P0t.json` | `d53c3334e4aa040330437fb9bb8889f35392fc8e3b650ef9eb88a7cd18b5f5dd` |
| `graph-P2.json` | `3c98e67d80636875052c47f17cd4e49bf3872b56104acc7ba185a5aef178e1fd` |
| `exports-P0.json` | `a53865050b707eab3f970df46fb7c383842fc258686f30f95b81e3b9ff369a59` |
| `exports-P0t.json` | `cb88616f3576d398d6a514699fdad09a417bc7b2029a77a482789ce49a0d032c` |
| `exports-P2.json` | `1194fed5f89ab8d4d523456beba008cde86de695983771b8e902a765236266da` |

生成命令（两类产物）：

```bash
npm run build                                                        # 硬约束：先建 dist
# 图产物：--output-dir 指到临时目录，避免覆写 specs/_meta/graph.json（MCP 在用）
node dist/cli/index.js batch --mode graph-only --output-dir <tmp>    # → <tmp>/_meta/graph.json → 另存 graph-<tag>.json
node specs/260-.../verification/dump-skeletons.mjs <tag>             # → callsites-<tag>.json / exports-<tag>.json
node dist/cli/index.js graph-quality --graph <graph-<tag>.json> --json --output <tag>-graph-quality.json
```

⚠️ **移动动作本身会改变 `verification/` 目录的文件构成**。这些是 `.json`，不被 TS/JS 采集器
采集，理论上不进图；但为免争议，P3 的两份基线（`P2t` / `P3`）**都在移动完成之后**取，
两侧目录状态一致，比较不受此影响。
