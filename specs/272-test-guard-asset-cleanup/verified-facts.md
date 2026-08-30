# F272 卡面七项 — 开工前逐条实证复核（F248 纪律）

> 本文件是编排器在 specify 之前**亲自实跑**得出的事实基线。所有下游子代理（specify / plan /
> tasks / implement / verify）**必须以本文件为准**，不得沿用卡面原文里已被证伪的表述，也不得
> 在未重跑的情况下推翻本文件的结论。
>
> 基线 commit：`f7a65aa9`；分支 `claude/test-guard-asset-cleanup-6b29b3`；复核日期 2026-08-31。

---

## ① `src/panoramic/qa/__tests__` — **卡面前提两处被证伪**

### 卡面原文
> "8 个文件从未被 vitest include 且已腐烂（10/10 失败）——修或删；删除即死代码清理，
> qa 模块本身是否死代码一并查证"

### 实证结论

| 卡面断言 | 实证结果 | 判定 |
|---|---|---|
| 8 个文件从未被 vitest include | ✅ 成立 | `vitest.config.ts` 的 `unit` project include 只有 `src/panoramic/graph/**/*.test.ts` 与 `src/batch/**/*.test.ts`，无 `src/panoramic/qa/**`；实跑 `npx vitest run --project unit 'src/panoramic/qa/__tests__/**'` 返回 `No test files found` |
| 10/10 失败 | ❌ **证伪** | 用临时探针配置实跑：**8 文件中 7 个全绿**，79 用例 **69 passed / 10 failed**。10 条失败全部集中在**单个**文件 `qa-integration.test.ts` |
| qa 模块是死代码 | ❌ **证伪** | qa 是**活生产代码**，见下 |

### qa 模块的生产引用链（实证）

```
src/panoramic/query.ts:11              import { answerQuestion } from './qa/index.js';
src/panoramic/query.ts:55              const answer = await answerQuestion(...)
src/batch/batch-orchestrator.ts:90     import type { BatchMode } from '../panoramic/qa/types.js';
src/batch/model-override-decision.ts:10 import type { BatchMode } from '../panoramic/qa/types.js';
```

且**已在跑**的测试 `tests/unit/panoramic-query-natural-language.test.ts` 通过
`vi.mock('../../src/panoramic/qa/index.js')` 对 `answerQuestion` 建立契约断言。

⇒ **qa 模块不是死代码**。「删除测试 = 死代码清理」这一卡面前提不成立。

### 10 条失败的唯一根因（实证）

全部 10 条失败签名逐字相同：

```
Error: 问答 LLM 调用失败：[vitest] No "existsSync" export is defined on the "node:fs" mock.
       Did you forget to return it from "vi.mock"?
  ❯ Module.answerQuestion src/panoramic/qa/index.ts:236:11
```

即 `qa-integration.test.ts` 对 `node:fs` 做了**部分 mock 但未用 `importOriginal`**，
被测代码路径后来新增了 `existsSync` 调用，mock 未跟随。这是**测试侧单点缺陷**，
不是被测代码腐烂。

### ⚠️ 第二轮复核：裁决再次翻转 —— 存在一份**在跑的同名副本**

第一轮复核漏查了一件事：`tests/panoramic/qa/` 下**有同名的 8 个文件**，而
`tests/panoramic/**/*.test.ts` **在 vitest 的 unit include 里**。

实跑 `npx vitest run --project unit tests/panoramic/qa`：

```
Test Files  8 passed (8)
     Tests  83 passed (83)
```

| | `src/panoramic/qa/__tests__/` | `tests/panoramic/qa/` |
|---|---|---|
| 是否被 vitest 收集 | ❌ 从不 | ✅ 是 |
| 用例数 | 79（69 绿 / 10 红）| **83 全绿** |
| git 历史 | `1b9a7113`（Step 5）建立后**再未被碰过** | `7dbc9682`（Step 2）建立，`18ddc479` 收过 post-review 修复（W-001/W-002/W-004 + P1-2/P1-4/P1-6）|

⇒ `src/panoramic/qa/__tests__/` 是一份**陈旧副本**；`tests/panoramic/qa/` 才是在维护的那份。

### 但不能直接删 —— src 侧有 3 条独有用例

逐用例名差分后，src 侧有 3 条 `tests/` 侧没有的：

| 独有用例 | 断言 | 变异验证结果 | 处置 |
|---|---|---|---|
| `debt-context`「包含 technical debt 时应返回 true」| `isDebtQuestion('what technical debt exists')` | **不可替代**：把实现 `DEBT_KEYWORD_PATTERN` 里的 `technical\s*debt` 分支删掉后，`tests/` 侧现有 6 条 isDebtQuestion 用例**全部仍绿**，只有这条会红 | ✅ **必须移植** |
| `debt-context`「架构问题不应匹配」| `isDebtQuestion('模块间的依赖关系是什么') === false` | `tests/` 侧已有同类负向用例（`什么调用了认证模块`），但词面不同（"依赖关系" vs "调用"）| ✅ 移植（成本为零）|
| `llm-caller`「应从项目配置读取模型 ID（不硬编码）」| 实际只断言 `expect(runBudgetGate).toHaveBeenCalled()`；注释自认「由于 Anthropic 是 mock，这里验证 runBudgetGate 被调用即可」| 名不副实，零守护力 —— 属 ⑦ 的 B7 类 | ❌ **不移植**，理由入裁决记录 |

### ⚠️ 本节曾有一处错误，已被批 A 的变异验证纪律抓出并更正

**原写**（错误）：「src 侧用例名与断言是「durationMs > 0」，`tests/` 侧被弱化成「>= 0」（恒真），
应在 `tests/` 侧修回。」

**实证更正**（`git show 1b9a7113:src/panoramic/qa/__tests__/index.test.ts` 与当前 `tests/` 侧原文对照）：

| | it 名 | 断言 |
|---|---|---|
| src 侧（已删的陈旧副本）| 「应包含 durationMs 字段（**> 0**）」 | `expect(result.durationMs).toBeGreaterThanOrEqual(0)` |
| `tests/` 侧（在维护的那份）| 「应包含 durationMs 字段（**>= 0**）」 | `expect(result.durationMs).toBeGreaterThanOrEqual(0)` |

**两侧断言逐字相同**。差异只在 it 名——`tests/` 侧其实是把名字**改对了**（让名实相符），
不是"弱化"。我把它读反了。

**而且「修回 `> 0`」这条指令本身会制造确定性红**：批 A 实测，在全 mock 管线下
`answerQuestion` 的 `Date.now() - t0` **确定性返回 0**（连续 5 次独立运行全部 0ms，
`[info] qa: ... total_ms=0` 日志印证），不是环境抖动。按字面执行会往 `tests/panoramic/qa`
引入一条恒红用例（已实测复现 `84 passed | 1 failed`）。批 A **拒绝执行该字面指令、
保持文件原状并把裁决上交**，是正确处置。

**正确裁决（编排器定）**：**删掉 `tests/panoramic/qa/index.test.ts` 第 185-191 行整条 it**。
理由：`>= 0` 对一个 number 恒真，而**同文件第 169 行 `expect(typeof result.durationMs).toBe('number')`
已经覆盖了存在性与类型**——这条 it 是纯冗余的恒真断言，删除零覆盖损失。这与
`inventory-item7.md` B4 给该类条目的处置建议「删，或断言字段类型 + 存在性」一致
（类型断言已有 ⇒ 就是删）。**不收紧为 `> 0`**（造确定性红），**不保留**（恒真噪声）。

### 要移植的 2 条用例（逐字原文 + 落点）

从 `src/panoramic/qa/__tests__/debt-context.test.ts` 第 80-94 行取，
插入 `tests/panoramic/qa/debt-context.test.ts` 的 `describe('isDebtQuestion', ...)` 块内
（该块现有 6 条，位于第 55 行起，以「普通问题不应匹配」收尾）：

```ts
  it('包含 technical debt 时应返回 true', () => {
    expect(isDebtQuestion('what technical debt exists')).toBe(true);
  });

  it('架构问题不应匹配', () => {
    expect(isDebtQuestion('模块间的依赖关系是什么')).toBe(false);
  });
```

被测实现（`src/panoramic/qa/debt-context.ts:47`，**本卡不改**）：

```ts
const DEBT_KEYWORD_PATTERN = /TODO|FIXME|HACK|XXX|technical\s*debt|技术债|最老|最旧|最长时间|债务/i;
```

**变异验证脚本**（证明第一条不可替代）：把上面正则里的 `technical\s*debt|` 删掉，
`tests/panoramic/qa/debt-context.test.ts` 必须**恰好红 1 条**（新移植的那条），
其余 7 条全绿。改完记得还原。

### ① 的最终裁决

1. **删除** `src/panoramic/qa/__tests__/`（8 文件，陈旧副本，从不执行，10 条红）
2. **移植 2 条**真实独有覆盖进 `tests/panoramic/qa/debt-context.test.ts`
3. **不移植** llm-caller 那条（名不副实）
4. **不改** `vitest.config.ts` 的 include（原设想的"加 `src/panoramic/qa/**`"不再需要——
   加了反而会让同一套测试跑两遍）
5. **不动** qa 生产代码（卡面硬约束；且已实证它是活代码）
6. `qa-integration.test.ts` 的 `node:fs` mock 缺口**随副本删除一并消失**，无需单独修

### 零执行测试文件的全仓普查（守卫的覆盖面依据）

`find src tests -name '*.test.ts'` 得 **551** 个；`npx vitest list --filesOnly` 收集到 **542** 个。
差集恰好 **9** 个：

```
src/panoramic/qa/__tests__/*.test.ts          ← 8 个，本项处置对象
tests/fixtures/graph-quality-ts/greeter-service.test.ts  ← 1 个，图构建的输入语料，本就不该跑
```

⇒ ① 处置后零执行集合恰好只剩那 1 个 fixture 语料文件，**守卫可以做得极精确**：
断言「磁盘 `*.test.ts` 减去 vitest 收集到的」等于一份明确白名单（只含 `tests/fixtures/**`）。
任何新增的零执行测试文件都会当场变红。这直接封死本项缺陷的复发面。

**当前 `.test.ts` 的顶层分布**：`src/` **21** 个 + `tests/` **530** 个 = 551，
`plugins/` 与 `scripts/` 下**没有** `.test.ts`（那两处是 `.test.mjs`，由 `npm run test:plugins`
的独立 runner 跑，不在 vitest 域内）。

⚠️ **守卫的扫描面必须是全仓（排除 `node_modules` / `dist` / `.git`），不能写死
`find src tests`**。写死两个目录 = 将来有人新建顶层目录放测试时守卫看不见——
这正是本仓 F259 记过的教训「判据写窄了，每加一个新形态就漏一次」。
守卫的白名单管的是"允许零执行的文件"，不是"允许被扫描的目录"。

---

### ① 删除后的旧名残留面（Constitution XIV 预扫，已完成）

`grep -rn "panoramic/qa/__tests__"` 全仓（排除 node_modules/dist/.git）命中三处，
**处置结论已定，verify 阶段照此核对即可**：

| 位置 | 性质 | 处置 |
|---|---|---|
| `specs/src.spec.md`（8 行）| **生成产物**，卡面明令排除提交 | 不处理，下次再生自动消失 |
| `specs/132-reading-ux/tasks.md`（8 行）| **历史 spec 制品**，如实记录 F132 当时做了什么 | **保持原样** —— 改写历史设计文档会让它不再是历史记录 |
| `tsconfig.json:46` 的 `"src/**/__tests__/**"` exclude | 防御性配置 | **保留** —— 删掉反而会让将来新增的 `src/**/__tests__` 进入 tsc 编译面 |

⇒ ① 的删除**不会**留下需要修的悬挂引用。

### 附带发现（不在本卡处置范围，已如实登记）

`vitest.config.ts` 的 `coverage.include: ['src/**/*.ts']` 会把 `src/` 下的 `*.test.ts` 与
`__tests__/**` 一并算作**被覆盖目标**（exclude 只排了 `*.d.ts` 与 `index.ts`）。
① 删除副本后这一面自然缩小，但配置本身的问题仍在。不在七项之内，不顺手改，登记备查。

---

## ② `graph-mcp-snapshot` Layer B self-dogfood 块 — **成立**

- 位置：`tests/integration/graph-mcp-snapshot.test.ts:211-262`
- 机制不是硬 `describe.skip`，而是**条件跳过**：
  `const describeIfSelfDogfoodFixture = SELF_DOGFOOD_FIXTURE_EXISTS ? describe : describe.skip;`
- fixture 路径 `tests/integration/__fixtures__/self-dogfood-graph.json` —— **整个 `__fixtures__` 目录都不存在**
- 删除 commit：`f9edd13f`（2026-05-10，"feat(158): micrograd-track + 共存方案"）⇒ 静默跳过 **3.7 个月**
- `git check-ignore` 判定：**NOT_IGNORED**（不是被 gitignore 吞掉，是真的被删了）
- **残留孤儿快照 2 条**仍留在 `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap`
  的第 343 行与第 414 行（`layer-b-self-dogfood-graph_god_nodes` / `layer-b-self-dogfood-graph_query`）
- **孤儿快照当前完全不可见**：实跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts`
  输出 `Tests 11 passed | 2 skipped (13)`，对这 2 条过时快照**一个字都不报**。
  ⇒ 该块目前的全部产出就是两行 `skipped` + 两坨死快照，信号量为零

### 重建成本实测

self-dogfood 图当前体量：**7708 节点 / 13094 边 / 6.5 MB**（`specs/_meta/graph.json`）。
把 6.5 MB 冻结图入库做 snapshot 基线，与本卡 ④ 实证的「pinned 图会静默陈旧」直接冲突。

### 覆盖面重叠实证

该块的两条断言（真实 src/ 节点 + calls 边影响 degree）在别处**已有覆盖**：
- `graph-mcp-snapshot.test.ts:200` Layer B MVP `graph_god_nodes top=3 — Layer B degree 受 calls 影响`
- `graph-quality-lang-matrix.test.ts` 对四份真实 pinned 图跑 CLI
- `micrograd-baseline-graph`（33 节点 / 38 边，含 8 条 calls 边）是真实 Python 图

### ② 删除时的三处连带清理（tsc 抓不出来，必须显式做）

`tsconfig.json` 与三份 type-test tsconfig **都没有开 `noUnusedLocals`**，
所以下面这些残留不会有任何工具替你发现：

| # | 位置 | 处置 | 依据 |
|---|---|---|---|
| 1 | 第 15 行 `import * as fs from 'node:fs'` | **删除** | `fs.` 全文只在第 215、217 行出现，都在待删块内。注意第 19 行另有 `import { mkdtempSync, rmSync } from 'node:fs'`（供第 144 行用），**那个要保留** |
| 2 | 第 23 行 `import type { GraphJSON }` | **保留** | 第 32 行 `MVP_GRAPH_WITH_CALLS: GraphJSON` 与第 105 行 `filterOutCallEdges(json: GraphJSON)` 仍在用 |
| 3 | 文件 docblock 第 10-13 行 | **改写** | 现写「Layer B 真实 self-dogfood fixture……已入库」「总 snapshot：6 Layer A + 2 Layer B MVP + 2 Layer B self-dogfood = **10**」。删除后应为 **8**（6 Layer A + 2 Layer B MVP），且要去掉"已入库"这句不实陈述 |

第 26 行的 `path.dirname` 与第 144 行的 `path.join` 仍在用 → `path` import 保留。

### 关于"改用 live 图"的可行性（已排除）

实证：**当前没有任何 vitest 测试消费本仓自身的 `specs/_meta/graph.json`**。
所有集成测试都把 pinned fixture 拷进临时目录消费。CI 注释里说的"graph-quality / spec-drift
相关测试硬依赖它存在"指的是 `repo:check` 内的判据，不是 vitest。
⇒ 让测试读 live 图会新增一条「本机没建图就红」的耦合，且 live 图每次 commit 都变，
`toMatchSnapshot` 恒churn。此路不通。

---

## ③ `typecheck:tests` 未接 CI/repo:check — **成立**

- `package.json` 有 `typecheck:tests = tsc -p tests/type-tests/tsconfig.json --noEmit && tsc -p tests/type-tests/f220.tsconfig.json --noEmit && tsc -p tests/type-tests/f222.tsconfig.json --noEmit`
- 三份守护资产实际存在：
  - `tests/type-tests/feature-170c-enrichment-optional.test-d.ts`（+ `tsconfig.json`）
  - `tests/type-tests/f220-orchestrator-exports.typecheck.ts`（+ `f220.tsconfig.json`）
  - `tests/type-tests/f222-llm-degraded-required.typecheck.ts`（+ `f222.tsconfig.json`）
- **`.github/workflows/ci.yml` 全文无 typecheck:tests**（现有步骤：Checkout / Setup Node /
  Install / Type Check(`npm run lint`) / Build / Build Knowledge Graph / Test / Repo Check /
  Release Check / Test Plugins）
- **`npm run lint` 覆盖不到它们**：`lint = tsc --noEmit` 走根 `tsconfig.json`，其
  `include: ["src/**/*.ts"]`、`exclude` 含 `"tests"`。三份守护资产在 tsc 的**盲区外**——
  这也正是它们各自带独立 tsconfig 的原因。
- `repo:check`（`scripts/repo-check.mjs` → `scripts/lib/repo-maintenance-core.mjs`
  的 `validateRepository`）当前是纯 JS 校验族聚合，**不 spawn 任何编译器**
- 现状实跑：`npm run typecheck:tests` **exit=0，耗时 2.39s**（接入成本可忽略）
- `repo:check` 调用面（确认不碰 hooks）：仅 `package.json` 的 `prepublishOnly` 与 CI 两处

---

## ④ 四语言 lang-matrix pinned graph 陈旧 — **成立，且仅 TS 一份**

按各 fixture README 的 SOP，用**当前 dist**（`f7a65aa9` + `npm run build`）重建后逐边差分：

| 语言 | pinned | 重建 | 差分 |
|---|---|---|---|
| **TS/JS** | 10 节点 / **11 边**（depends-on 1 + calls 2 + contains 8）| 10 节点 / **14 边**（depends-on 1 + **calls 5** + contains 8）| ⚠️ **+3 条 calls 边**，节点零差异，无丢失边 |
| Java | 18 节点 / 13 边（contains 13）| 18 节点 / 13 边 | ✅ 一致 |
| Go | 13 节点 / 9 边（contains 9）| 13 节点 / 9 边 | ✅ 一致 |
| Python（micrograd）| 33 节点 / 38 边（calls 8 + contains 28 + depends-on 2）| 33 / 38 | ✅ 一致（源 clone commit `c911406e` 已校验未漂移）|

新增的 3 条边（全部从测试文件指向被测模块，是 F242/F260 调用边覆盖增强的**纯增益**）：

```
greeter-service.test.ts --calls--> greeter-service.ts::formatGreeting
greeter-service.test.ts --calls--> greeter-service.ts::GreeterService.greet
greeter-service.test.ts --calls--> greeter-service.ts::GreeterService
```

消费方断言在 `tests/integration/graph-quality-lang-matrix.test.ts:130-137`：
`{ lang: 'TS/JS', expectedNodeCount: 10, expectedSymbolCount: 8, expectedEdgeCount: 11 }`。

⇒ 这是**静默陈旧**：断言仍绿（因为它断言的是 pinned 文件自身，不是重建结果），
但 pinned 图早已不代表当前 builder 的行为。**当前无任何"pinned 是否陈旧"检查**。

### 重建图的六指标实测（确认"只改一个数字"是安全的）

对重建产物跑 `node dist/cli/index.js graph-quality --graph <重建图> --json`：

```
overallVerdict      = pass
duplicateCanonicalId= pass
containsCoverage    = pass  total=8 covered=8 ratio=1
orphanRatio         = pass  totalSymbolNodes=8 offending=[]
danglingEdges       = pass
legacyAndIgnored    = pass  legacy=[] ignored=[]
freshness           = unknown-provenance  recordedSourceCommit=null
```

与 `graph-quality-lang-matrix.test.ts:180-210` 的现有断言**逐字一致**。
⇒ TS 项唯一需要改的断言是 `expectedEdgeCount: 11 → 14`；
`expectedNodeCount: 10` / `expectedSymbolCount: 8` / 六指标断言全部不动。

### ④ 的处置四件套

1. 覆盖 `tests/fixtures/graph-quality-ts-graph/graph.json` 为重建产物（按该目录 README 的 SOP）
2. `graph-quality-lang-matrix.test.ts:136` 的 `expectedEdgeCount: 11` → `14`
3. 更新 `tests/fixtures/graph-quality-ts-graph/README.md` 的**人工推导表**：
   边总数 11→14、`calls` 2→5，并列出新增的 3 条（测试文件 → 被测模块的调用边）+ 记录
   producer commit。⚠️ 按 F223/F220 纪律，这里是**手工推导后逐处替换**，禁止 `vitest -u`
4. 新增"pinned 是否陈旧"守卫（见下）

### 守卫的诚实性设计要点（Constitution 原则 IV + F266 教训）

四份 pinned graph 的源分两类：

| fixture | 源 | CI 可重建？ |
|---|---|---|
| TS / Java / Go | `tests/fixtures/graph-quality-{ts,java,go}/`（**仓内**）| ✅ |
| Python（micrograd）| `~/.spectra-baselines/micrograd`（**仓库外 clone**）| ❌ |

守卫**不得**因为 micrograd 源不在就静默 skip——本仓有惨痛先例（graph-quality 缺图时
静默 skip、CI 照绿，门禁形同虚设）。诚实形态：守卫产出一份**逐资产的核验状态表**
（`verified` / `unverifiable:external-source`），并断言：

1. 每一份**仓内有源**的 fixture 都是 `verified` **且**重建产物与 pinned 逐边一致
2. 状态为 `unverifiable` 的集合**恰好等于**一份显式声明的白名单

第 2 条是关键：将来有人再加一份外部源 fixture 而不声明，守卫会当场红，
不会让"未核验集合"悄悄变大。

---

### 两个新守卫的成本实测（决定能否进 CI 常规测试面）

| 守卫 | 依赖的命令 | 实测耗时 | 备注 |
|---|---|---|---|
| FR-011 零执行测试文件 | `npx vitest list --filesOnly` | **0.28s**，exit 0，输出 542 行 | **不触发 globalSetup**（不会连带跑 dist 构建），这是它这么快的原因；输出格式为 `[project] path/to/file.test.ts`，需按 `(src\|tests)/...\.test\.ts` 提取 |
| ④ pinned 陈旧 | 三次 `node dist/cli/index.js batch <tmp> --mode graph-only` | TS **369ms** / Java **251ms** / Go **243ms**，合计 **~0.86s** | 需要 dist 已构建（vitest globalSetup 已保证）|

⇒ 两个守卫合计增量 < 1.2s，放进常规测试面不构成负担。

⚠️ FR-011 若做成 vitest test，会形成"vitest 里 spawn vitest"。实测安全（子进程独立、
不跑 globalSetup、0.28s 返回），但 plan 需显式确认这一形态可接受，或改放 repo:check。
**不要**改成"自己解析 `vitest.config.ts` 的 include 再 glob"——那是重新实现 vitest 的
解析逻辑，会随 vitest 升级漂移，守卫本身就成了新的失真源。

---

## ⑤ `regen-collector-fingerprint-fixtures.ts` 放行路径丢弃 differences — **成立**

`scripts/regen-collector-fingerprint-fixtures.ts`：

- **拒绝分支**（第 570-580 行）：逐条打印 `[...aTrack.differences, ...bTrack.differences]`
- **放行分支**（第 588-591 行）：只打三个布尔量

  ```
  console.log(
    `[regen] 放行：contentMismatch=${aTrack.mismatch || bTrack.mismatch}、` +
      `fingerprintUnchanged=${fingerprintUnchanged}、inputHashChanged=${inputHashChanged}`,
  );
  ```

  `differences` 数组此时**已经算好**（第 558-559 行的 `compareGraphOnlyStructure` /
  `compareModuleGraphSnapshot` 已返回），却被直接丢弃。

⇒ 维护者在 `contentMismatch=true` 放行时，看得到"内容变了"，看不到"变了什么"——
资产被覆写后差异信息永久丢失。

### ⑤ 的既有测试覆盖与一个必须避开的陷阱

现有端到端覆盖：`tests/integration/collector-fingerprint-regen-script.test.ts:157`
（`pinned 指纹结构合法但与当前不等（已 bump 场景）→ exit 0、明确报告放行`），
经 `node_modules/.bin/tsx` spawn 真实脚本，第 165 行已断言 `run.stdout).toContain('放行')`。

⚠️ **陷阱**：该用例的场景是"bump `behaviorVersion`"⇒ `fingerprintUnchanged=false`，
但 **`contentMismatch` 在这个场景下不一定为 true**。若直接在这条用例上加
`expect(stdout).toContain('节点仅存在于…')` 之类的断言，而实际 `differences` 为空数组，
断言就会变成**恒真**——正好犯下本卡 ⑦ 要治的病。

⇒ implement 必须**构造一个 `contentMismatch === true` 且被放行**的场景（改 fixture 源码
使重建产物与 pinned 真的不同，同时让指纹也变），才能让"differences 已落盘"这条断言
具备真实守护力。**变异验证**：把打印 `differences` 的那几行删掉，该断言必须变红。

---

## ⑥ it.todo — **数量成立（23），但"待 fixture 落地"的阻塞前提已失效**

### 精确计数

- 限 `*.test.ts` / `*.test.mjs` 内的 `it.todo(` / `test.todo(` 调用点：**21 条**
- 放宽到全部 `*.ts` / `*.mjs` / `*.js`（排除 node_modules）：**23 条**（与卡面一致）

### 分布（21 条测试内调用点）

| 文件 | 条数 | 内容 |
|---|---|---|
| `tests/integration/cross-project-isolation.test.ts` | 5 | 4 fixture 真实 batch + FR-005 evidenceRef 占比 |
| `tests/integration/adr-cross-fixture.test.ts` | 4 | 4 fixture 真实 batch + ADR 内容 |
| `tests/integration/hyperedge-first-run.test.ts` | 4 | 4 fixture hyperedges 计数 |
| `tests/integration/graph-html-generation.test.ts` | 4 | 4 fixture graph.html banner |
| `tests/integration/include-docs-integration.test.ts` | 3 | 3 fixture include-docs 日志 / narrative / prompt |
| `tests/unit/mcp/agent-context-sanitize.test.ts` | 1 | **不是待办测试**，是"有意豁免"的记录（见下）|

### 阻塞前提复核

todo 的自述阻塞理由是"待 Phase 1a fixture 落地后填充"。**实证：4 个 fixture 全部已存在**
（`tests/fixtures/{micrograd,nanoGPT,ky,empty-project}`）——所述阻塞已消失。

但**真实阻塞是另一个**：这 20 条要求"**spectra batch 真实跑 + 真实 LLM 调用**"
（`cross-project-isolation.test.ts` 的 docblock 原文："本测试不直接驱动完整 batch pipeline
（需要真实 LLM 调用 + 复杂 mock 链）……留 it.todo()，在 Step 2 / Step 4 真实接通
anthropicClient 之后由 user 手动驱动 T51"）。本仓所有 e2e 测试都走
`vi.mock('@anthropic-ai/sdk')`，CI 里**不存在**真实 LLM 通道。⇒ 本卡内无法"填充"。

### 逐条可填充性复核（比"全部不可填充"更细）

按**断言的对象是不是 LLM 的语义产出**分类——这是决定"能不能填"的唯一判据，因为本仓
所有 e2e 都用 `vi.mock('@anthropic-ai/sdk')`（`tests/e2e/batch-pipeline.e2e.test.ts:88`），
mock 得出的"LLM 语义"是测试自己写进去的，断言它等于恒真。

| 组 | 条数 | 断言对象 | 可填充？ |
|---|---|---|---|
| `cross-project-isolation` | 5 | ADR 标题/内容含特定领域词（"Value/Neuron/MLP"、"causal attention"）| ❌ **结构性不可填充** —— 断言 LLM 语义产出，mock 后成恒真 |
| `adr-cross-fixture` | 4 | 同上 | ❌ 同上 |
| `hyperedge-first-run` | 4 | `graph.json.hyperedges.length >= 1` —— hyperedge 由 LLM 提取（`src/panoramic/hyperedges/extractor.ts:16` 直接 `import Anthropic`）| ❌ 同上 |
| `graph-html-generation` | 4 | graph.html 是否含 small-graph banner —— `buildHtmlTemplate` 是**纯函数** | ✅ 可填充（不依赖 LLM）|
| `include-docs-integration` | 3 | ①batch 末尾**日志**含 "include-docs: 已加入 N 份" ②`narrative.readmeExcerpt` 反映 README（该字段是**纯截断**，同文件上方已有真跑用例断言 ≤1001 且以 `…` 结尾）③发给 LLM 的 **prompt** 含 README virtual DocChunk（断言的是入参不是出参）| ✅ 可填充（三条都不依赖 LLM **输出**）|

⇒ 卡面隐含的"这 20 条都填不了"**不成立**：7 条技术上可填充，只是一直没人写。

### 删除 todo 不会留下空 describe（已核）

| 文件 | 真实 `it(` | `it.todo(` | 删 todo 后 |
|---|---|---|---|
| `cross-project-isolation.test.ts` | 6 | 5 | 留 6 条真实用例 ✅ |
| `adr-cross-fixture.test.ts` | 3 | 4 | 留 3 条 ✅ |
| `hyperedge-first-run.test.ts` | 7 | 4 | 留 7 条 ✅ |
| `graph-html-generation.test.ts` | 4 | 4 | （保留组，不删）|
| `include-docs-integration.test.ts` | 4 | 3 | （保留组，不删）|

### ⚠️ 附带发现：`graph-html-generation.test.ts` 当前守护力为零

该文件的 **4 条真实 `it(` 全部**出现在 ⑦ 的 A7 虚化清单里
（`inventory-item7.md` A7：L24/32/38/46，grep `options.generateHtml ?? true`、
`SMALL_GRAPH_THRESHOLD = 3`、`typeof opts?.nodeCount === 'number'` 等源码文本），
另外 4 条是 `it.todo`。

⇒ 整个文件当前的产出是「4 条对源码做子串匹配的断言 + 4 条待办」，**没有一条真正调用被测代码**。
它是 A 类移交卡里优先级最高的一个——而且 `buildHtmlTemplate` 是纯函数，
传 `nodeCount: 2 / 30` 就能直接验 banner，改造成本很低。
本卡按裁决不动它（A 类整文件重写属独立卡），但这个事实要写进交付报告。

### 第 21 条是 it.todo 的误用

`tests/unit/mcp/agent-context-sanitize.test.ts:142` 的 todo 文本是
"stale 分支按设计回传含外来绝对路径的 err.message——故意诊断信号，豁免见 specs/186 plan.md"。
这不是"待写的测试"，是一条**豁免理由记录**，其上方已有等价注释。用 `it.todo` 承载它，
会在 vitest 报告里长期显示为"待办测试"，属于虚假欠账信号。

---

## ⑦ 源码文本 grep 式测试与恒真断言

由只读子代理清点，结论见 `specs/272-test-guard-asset-cleanup/inventory-item7.md`。

**判别红线（写进子代理 prompt 的）**：本仓有大量**正当**的文本合同守护
（wrapper 同步、SKILL.md 片段同步、release contract 同步、生成产物一致性），
这些读文本做 `toContain` 是设计如此，必须判"合理"，不得为凑数计入。
只标"本可直接跑代码验行为却退化成文本匹配"与"断言恒真"两类。

---

## 全局护栏（卡面 🔴，逐条已确认在本仓生效）

1. **预存 flaky 清单勿当回归修**：`watch-command`（chokidar/fsevents）、
   `batch-orchestrator-incremental`、`community-analysis` perf（并发负载超 30s，隔离 ~13s）、
   `cli-e2e --version`（runCLI 10s timeout 打穿）
2. **冻结型快照严禁 `vitest -u` 一把梭**（F223/F220 纪律）——④ 的 TS pinned 断言是
   测试文件里的**显式数字**，必须手工按 README 重新人工推导后逐个替换，不得用 `-u` 生成
3. **变异测试证明新接的守护真的会红**——③ 与 ④ 新接的守护必须各做一次变异体验证
4. **CI 改动验收走 F269 惯例**：报告先落盘 + PENDING 节 + 真实 CI run 回填
5. **写入路径 disjoint**：本卡禁碰 `src/mcp/`、`fix-compliance*`、`hooks/`；
   `ci.yml` 若与 F270/F271 冲突，后 ship 者 rebase 重验
