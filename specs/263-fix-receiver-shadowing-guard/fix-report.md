# 问题修复报告 — F263 receiver 类型定位本地导出分支缺失遮蔽守卫

## 问题描述

F260（a9c338dc）ship 的实例方法调用边解析中，`src/knowledge-graph/receiver-type-resolution.ts`
的 `locateClassFile` 存在**分支不对称**：

- **分支 (a)（本地导出路径，:169）**：`ctx.moduleSymbolIndex.get(cs.callerFile)?.has(receiverType)`
  命中即 `return cs.callerFile`，**零守卫**。函数注释断言「类名在 caller 自己的导出表里时，
  它指的必然是本模块那个符号」——该「必然」已被**词法作用域遮蔽**证伪。
- **分支 (b)（import 路径，:172-175）**：三道闸（`receiverTypeSoleImportBinding === true` /
  非 renamed alias / 非 default alias）。

mapper 侧（`typescript-receiver-env.ts` 表 1）**已经算出**遮蔽事实（`total` / `fromImport`），
但只 surface 成 `receiverTypeSoleImportBinding`（语义 = `total===1 && fromImport===1`）供分支 (b) 用；
分支 (a) 拿不到**纯遮蔽计数**（`total===1`），因而无从判断本模块那个名字是否被局部绑定遮蔽。

### 已实证复现（真实 graph-only 流水线，非纸面推演）

fixture：`scratchpad/repro`，`node dist/cli/index.js batch --mode graph-only`（HEAD=64b1d72f 重建 dist 后）。
实测 calls 边：

```
INFERRED src/a.ts::schedule -> src/a.ts::Task.run      ← ① 假边
EXTRACTED src/a.ts::schedule -> src/a.ts::Task          ← 旁证（另一 stage，见「类似模式」）
INFERRED src/b.ts::process  -> src/b.ts::Handler.run    ← ② 假边
INFERRED src/c.ts::driver   -> src/c.ts::Real.go        ← 对照真边（必须保留）
```

① 局部类遮蔽导出类（`src/a.ts`）：

```ts
export class Task { run(): void {} }
export function schedule(): void { class Task { run(): void {} } const t = new Task(); t.run(); }
```

`t` 的运行时类型是**函数内的局部 `Task`**（不是图节点），边却连到了导出的 `Task`。

② 类型形参遮蔽导出类（`src/b.ts`）：

```ts
export class Handler { run(): void {} }
export function process<Handler>(h: Handler): void { h.run(); }
```

`h` 的类型是泛型形参，运行时由调用方决定，与导出的 `Handler` 无关。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 假边为何产生？ | `locateClassFile` 分支 (a) 把 `receiverType` 定位到 `cs.callerFile`，条件 ④⑤（`kind==='class'` + 成员命中）随后被同名导出类**恰好满足** |
| Why 2 | 分支 (a) 为何定位错？ | 它的唯一判据是「名字在本文件导出表里」——这是**文件级导出可见性**，回答不了「调用点处这个名字绑定到谁」这一**词法作用域**问题 |
| Why 3 | 为何用文件级判据回答作用域问题？ | 注释里的设计假设「类名在 caller 自己的导出表里 ⇒ 它指的必然是本模块那个符号」把「同名」当成了「同一」；该假设在**任何局部绑定遮蔽**（局部类 / 泛型形参 / 局部 const / 形参）下不成立 |
| Why 4 | 该假设为何被写下且没被挡住？ | F260 的六条件与门把全部安全性押在「类名定位」上（文件头 H2 论证），但收紧动作（②③④⑤）只作用在**import 来源**这一侧；本地导出侧被当成「无歧义的短路出口」直接放行——**判据不对称**，而 mapper 早已把遮蔽事实算出来了，只是没 surface 到分支 (a) 能用的形态 |
| Why 5 | 为何未被现有机制捕获？ | F260 的用例表（R4–R12 / M1–M15d）遮蔽面只测了**「遮蔽 ⇒ `soleImportBinding=false` ⇒ 分支 (b) 弃权」**这一条通路（如 M10 / R6），从未构造「遮蔽 + 本模块自己导出同名类」的组合——而这正是绕开分支 (b) 全部三道闸、直接走分支 (a) 的形态。用例表的遮蔽维度与本地导出维度**正交但未交叉** |

**Root Cause**：`locateClassFile` 分支 (a) 用**文件级导出可见性**充当**调用点作用域内名字归属**的判据，
且未消费 mapper 已算出的遮蔽计数，导致任何局部绑定遮蔽同名导出类的形态都产出确定性假边。

**Root Cause Chain**：`schedule → a.ts::Task.run` 假边 → 分支 (a) 返回 `callerFile` →
判据是「名字在导出表里」而非「名字在此作用域绑定到本模块符号」→ 设计假设把同名当同一 →
F260 收紧只覆盖 import 侧、遮蔽计数未 surface 到本地侧 → 用例表遮蔽维度与本地导出维度未交叉。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/knowledge-graph/receiver-type-resolution.ts` | L169 | 分支 (a) 零守卫 | 加「无遮蔽」判据，与分支 (b) 对称 |
| `src/core/query-mappers/typescript-receiver-env.ts` | L544-548 | 表 1 只 surface `isSoleImportBinding` | 新增纯遮蔽计数查询（`total===1`） |
| `src/core/query-mappers/typescript-mapper.ts` | L1399-1400 | `_mkCallSite` 只写 2 个 receiver 字段 | 同源写入第 3 个字段 |
| `src/models/call-site.ts` | L88-100 | CallSiteSchema | 新增 optional boolean 字段 + fail-closed 语义注释 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/knowledge-graph/call-resolver.ts` | L580-589（Stage 1 free 分支） | 同款「本地导出表命中即出边」，无作用域判据 | **确认存在同根因假边**（实测 `EXTRACTED src/a.ts::schedule -> src/a.ts::Task`：局部 `class Task` 的 `new Task()` 连到导出类）。**不在本次修复范围**：属 F260 之前就存在的既有 stage、置信度 EXTRACTED/high、修它需要作用域级 caller 环境（mapper 当前只有文件级表），改动面远超本卡。登记为残余风险 F263-R-3，后续 Feature 候选 |
| `src/knowledge-graph/call-resolver.ts` | L635（Stage 2 类启发式本地命中） | 同款文件级判据 | 同上，同一根因家族，同样超范围，并入 F263-R-3 |
| `src/knowledge-graph/receiver-type-resolution.ts` | L172-175 分支 (b) | import 侧三道闸 | **安全**：`soleImportBinding` 已含 `total===1`，遮蔽下必为 false |

**评估：非 TS/JS 语言不受影响**。`receiverType` 仅由 TS/JS mapper 产出（`call-site.ts` L94 注释 +
全仓 grep 证实：`src/core/query-mappers/` 下只有 `typescript-mapper.ts:1399` 写该字段），
而条件 ① 要求 `receiverType` 存在才进本分支，故 python/java/go 调用点**从不进入**该分支，
新守卫的 fail-closed 语义对它们零影响。

### 同步更新清单

- 调用方：`resolveReceiverTypeCall` 唯一调用点在 `call-resolver.ts:599`，签名不变，无需改
- 测试：`tests/unit/knowledge-graph/call-resolver.test.ts`（resolver 侧红先行 ①②+对照真边）、
  `tests/unit/typescript-mapper-callsite.test.ts`（mapper 侧新字段抽取用例）
- 文档：`receiver-type-resolution.ts` 的 `locateClassFile` 注释（现有注释里那句「必然」是**错的**，
  必须改写而非仅补充）；`call-site.ts` 新字段 doc comment
- 图产物口径：见下方「BEHAVIOR_VERSION / collector 指纹评估」

## 修复策略

### 方案 A（推荐）— surface 纯遮蔽计数，分支 (a) 加对称判据

> ⚠️ **本节的判据 `total===1` 已在第 2 轮被对抗审查实测证伪并取代**（既误伤 TS 声明合并、
> 又被 `export { X as Y }` 别名导出绕过）。最终落地判据为
> `topLevel >= 1 && nested === 0`，见下方「第 2 轮」章节与 [plan-delta-r2.md](plan-delta-r2.md)。
> 本节原文保留以留痕判据的演进过程，**不代表最终实现**。

1. `typescript-receiver-env.ts`：`ReceiverTypeEnv` 新增 `isSoleBinding(className): boolean`
   （`slot.total === 1`，**不要求** `fromImport`）；`ReceiverBinding` 新增 `soleBinding: boolean`。
2. `call-site.ts`：`CallSiteSchema` 新增 `receiverTypeSoleBinding: z.boolean().optional()`。
3. `typescript-mapper.ts` `_mkCallSite`：与既有两字段**同源同处**写入（保持「不存在半开组合」不变量）。
4. `receiver-type-resolution.ts` `locateClassFile`：分支 (a) 改为

   ```ts
   if (ctx.moduleSymbolIndex.get(cs.callerFile)?.has(receiverType)) {
     // 与分支 (b) 对称：判不出遮蔽状态（字段缺席）按「有遮蔽」弃权
     return cs.receiverTypeSoleBinding === true ? cs.callerFile : null;
   }
   ```

   **注意**：命中本地导出但被遮蔽时必须 `return null`（整体弃权），**不得** fallthrough 到分支 (b)——
   fallthrough 会让「本模块有同名符号」这一事实被 import 表另一个答案顶替，是新造的一类假边面。

**为什么判据是 `total===1` 而非 `total===1 && fromImport===0`**：后者更强（要求唯一绑定是本地声明），
但实证不必要——已探针验证 `import { Foo } from './x'; export { Foo };` 形态下 `moduleSymbolIndex`
**不含** `y.ts::Foo`（re-export 在节点派生与符号索引两侧同款跳过），分支 (a) 根本不会命中，
真正的解析走分支 (b) 并正确落到 `x.ts::Foo.m`（探针实测）。加 `fromImport===0` 属无实证收益的额外收紧，
按「不自行添加未要求的优化」不做。

**保守优先（与分支 (b) `!== true` 语义逐字对齐）**：字段缺席（旧 baseline / 非 TS mapper）
按「有遮蔽」弃权。代价是旧 baseline 上本分支整体停摆（少出边），符合「宁可少出边，不可出错边」。

**已知取舍（如实登记）**：表 1 是**文件级**计数，不感知块级作用域。因此
「函数 A 里有局部 `Task`、函数 B 里的 `new Task().run()` 指的其实是导出类」这种形态会被**误伤**弃权
（少一条真边）。这与 `typescript-receiver-env.ts` 文件头已登记的 R-8（文件级环境「歧义即弃权」）
是同款既定取舍，方向一致（纯 recall 损失，无 precision 风险）。生产图影响由「238 入边数不变」验证。

### 方案 B（备选）— resolver 侧自建作用域索引

在 resolver 侧从 codeSkeletons 重建「文件内所有绑定名」索引，不改 CallSite 面。
**不推荐**：codeSkeletons 只有 exports/imports，没有函数体内的局部绑定与泛型形参，
重建不出案例 ①②所需的事实；真要做等于在 resolver 侧复制一份 tree-sitter walk，
既重复 mapper 已有能力，又违反「不在错误的抽象上叠加 workaround」。

## BEHAVIOR_VERSION / collector 指纹评估

**结论：不 bump**（`BEHAVIOR_VERSION` 保持 3）。

- `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类条件全部是「**哪些文件被计入采集**」维度
  （ignore-dirs 剪枝 / gitignore 解释 / 大小写匹配 / symlink / size guard / 采集失败降级），
  本次改的是**边解析语义**，六类均不适用。
- `extensionSurface` 不变（未增删任何扩展名）。
- **先例对齐**：F260 本身对 calls 边语义的改动远大于本次（新增整条 D2b 分支），同样未 bump——
  同类改动同款处置，见 `collector-fingerprint.ts` bump 记录（2←1 F255、3←2 F259）均非边语义变更。

## Spec 影响

- 需要更新的 spec：**无需更新**。`specs/src.spec.md` 为再生产物且按工程约定排除提交；
  本次不新增/变更任何对外 CLI / MCP 合同。

---

## F260 残余风险登记 R-2 的更正（本节按 F263 任务卡要求补记）

> **范围声明**：F260 已 ship，其 `plan.md` / `verification/verification-report.md` 的正文**不修改**，
> 本节以引用方式在 F263 侧留痕更正。

F260 登记的 R-2 原文（`specs/260-fix-instance-method-call-edges/plan.md:608`，
`verification/verification-report.md:238` 同款）：

> | R-2 | 既有 Stage 2 `Class.method()` 路径的同款暴露面（嵌套非导出同名 class + 同名 import） | D2 |

### 更正 1：「既有 Stage 2 同款暴露面」这一措辞**低估了范围**

该措辞把假边面框定为「Stage 2 本来就有的老问题，新分支只是同款」，暗示 F260 没有扩大暴露面。
实际不成立：**F260 之前，`new X().m()` / `const x: X = …; x.m()` 等接收者形态从不产出 calls 边**
（`receiverType` 是 F260 才引入的字段，D2b 分支也是 F260 才新增的）。因此这些形态下的假边
是 **F260 新引入**的暴露面，而非既有 Stage 2 暴露面的延续。

实证：fix-report 案例① 的 fixture 里，`schedule` 有两条出边——
`INFERRED …::Task.run`（F260 新分支产出，F263 已收口）与 `EXTRACTED …::Task`（Stage 1 既有路径）。
两者根因同源（文件级导出可见性 ≠ 调用点名字归属），但**属于不同 stage、不同引入时点**，
R-2 把二者混为一谈。

### 更正 2：**类型形参遮蔽变体未被 R-1..R-22 任何一条枚举**

R-2 只写了「嵌套非导出同名 class + 同名 import」这一种遮蔽形态。fix-report 案例②
（`export class Handler {}` + `export function process<Handler>(h: Handler)`）是**泛型形参遮蔽**，
既不是「嵌套 class」也不涉及「同名 import」，R-1..R-22 全表无一条覆盖。

R-8（「文件级（非作用域感知）绑定环境的固有误伤」）方向也不对：它登记的是**误伤**
（recall 损失），而案例①② 是**假边**（precision 损失），两者不是同一类风险。

### 更正后应有的登记

| ID | 内容 | 状态 |
|---|---|---|
| R-2（更正） | F260 新分支在**本地导出路径**（分支 (a)）零遮蔽守卫，任何词法遮蔽（局部类 / **泛型形参** / 局部 const / 形参）同名导出类的形态均产确定性假边。这是 F260 **新引入**的暴露面，不是既有 Stage 2 暴露面的延续 | **F263 已修**（本卡） |
| F263-R-3（新登记） | `call-resolver.ts` Stage 1（L580-589）与 Stage 2（L635）的**本地导出表命中即出边**，同款缺作用域判据。实证假边：`EXTRACTED src/a.ts::schedule -> src/a.ts::Task`（局部 `class Task` 的 `new Task()` 连到导出类）。**F260 之前即存在**，修它需要作用域级 caller 环境（mapper 当前只有文件级表），改动面远超本卡 | **未修，后续 Feature 候选** |

---

## 第 2 轮：对抗审查证伪首版判据，判据精化（`total===1` → 顶层/嵌套分计）

第 1 轮把判据定为 `slot.total === 1`（纯遮蔽计数，即任务卡「方案方向」的字面口径）。
两路异构对抗审查**各自独立实测证伪**，主线程用真实 `batch --mode graph-only` 流水线复现确认。
详细规格见 [plan-delta-r2.md](plan-delta-r2.md)，此处只记结论与证据。

### 证伪 1（误伤面 · CRITICAL）— TS 声明合并被误判为遮蔽

`class F` + `namespace F` / `interface F` 是 TS **声明合并**（同一符号，运行时 `F` 恒指向那个 class），
表 1 却把它计成 2 个绑定点 ⇒ `total===1` 失败 ⇒ 该类在本文件的**全部**分支 (a) 真边消失。

主线程实测（fixture `scratchpad/verify`，第 1 轮 dist）：

```
INFERRED src/h2.ts::usePlain -> src/h2.ts::Plain.retrieve      ← 对照（无合并），边在
(src/h1.ts::useModels -> src/h1.ts::Models.retrieve 缺席)       ← 真边被误杀
```

审查方量化（node_modules 语料 999 个 `.ts`）：384 个导出类中 **98 个（25.5%）**命中，
98/98 全部是 `class_declaration + internal_module`（companion namespace），
覆盖 openai / @anthropic-ai/sdk / onnxruntime-web —— **现代 TS SDK 的主流写法**。
本仓自身语料该形态为 0，所以「238 锚点不变」这条验收**看不出**这个问题，
是一次典型的「锚点通过 ≠ 判据正确」。

### 证伪 2（绕过面 · CRITICAL）— `export { X as Y }` 别名导出让守卫整体失效

主线程实测（同 fixture）：`INFERRED src/x1.ts::goAlias -> src/x1.ts::Task.run` —— **假边仍在**。

```ts
class Impl { run(): void {} }
export { Impl as Task };
export function goAlias<Task>(t: Task): void { t.run(); }
```

根因：`total===1` 回答「这个名字被绑了几次」，而分支 (a) 真正需要的不变量是
**「该名字的绑定就是 `moduleSymbolIndex` 命中的那条顶层导出声明」**。别名导出制造了一个
**没有对应本地绑定**的导出名，那唯一 1 次计数完全来自遮蔽者自己，守卫反被它满足。

### 精化后的判据

```
isSoleBinding(name) := slot.topLevel >= 1 && slot.nested === 0
```

按绑定点所在**作用域位置**分两栏计数（顶层 = 祖先链只经过 `program` / `export_statement` /
`ambient_declaration` / `expression_statement` / `lexical_declaration` / `variable_declaration`
这类透明包装节点；该集合由 tree-sitter 探针**实测**归纳，非猜测）。

- `topLevel >= 1` 而非 `=== 1`：合法 TS 里同名的多个**顶层**绑定只可能是声明合并
  （重复的值级顶层声明是编译错误），故顶层多条恒为同一符号，用 `>=1` 正是为放行声明合并
- 同时要求 `topLevel >= 1`（而不只判 `nested === 0`）：挡住证伪 2 ——
  别名导出的 `Task` 在本文件**没有任何顶层绑定**（顶层绑定名是 `Impl`），`topLevel===0` 直接弃权

`isSoleImportBinding`（F260 A1 判据 / 分支 (b)）的语义与实现**一字未动**。

### 精化后逐案实测（主线程独立复跑，真实流水线）

| 形态 | 期望 | 实测 |
|---|---|---|
| 案例①局部类遮蔽 | 不出边 | `a.ts::schedule -> Task.run` 缺席 ✓ |
| 案例②泛型形参遮蔽 | 不出边 | `b.ts::process -> Handler.run` 缺席 ✓ |
| 对照真边 | 出边 | `INFERRED c.ts::driver -> c.ts::Real.go` ✓ |
| 声明合并（证伪 1） | **出边** | `INFERRED h1.ts::useModels -> h1.ts::Models.retrieve` ✓ 已修复 |
| 声明合并对照 | 出边 | `INFERRED h2.ts::usePlain -> h2.ts::Plain.retrieve` ✓ |
| 别名导出绕过（证伪 2） | **不出边** | `x1.ts::goAlias -> Task.run` 缺席 ✓ 已修复 |

### 生产图影响（主线程受控 A/B，非纸面）

先 `git checkout -- src/` 建基线图，再还原改动重建，两图逐边 diff：

```
calls BEFORE(pre-F263) 3996   AFTER(round2) 3996
REMOVED: []   ADDED: []
nodes ADDED: [ReceiverBinding.soleBinding, ReceiverTypeEnv.isSoleBinding]
```

`legacy.classMethodWithInEdge = 238`（F260 锚点保持）、`headline.methodWithInEdge = 236`（保持）。
`headline.methodNodes` 由 **517 → 518**：唯一来源是本次新增的接口方法
`ReceiverTypeEnv.isSoleBinding` 被抽取为 method 节点（接口方法签名本身不是调用目标，无入边）。
**这不是判据行为造成的边增减**——逐边 diff 已证 calls 边集完全相同。

## 残余风险登记（F263 未修，按证据分级）

| ID | 内容 | 证据 | 处置 |
|---|---|---|---|
| F263-R-3 | `call-resolver.ts` Stage 1（L580-589）/ Stage 2（L635）「本地导出表命中即出边」同款缺作用域判据 | 实测 `EXTRACTED src/a.ts::schedule -> src/a.ts::Task` | 未修（F260 之前即存在，需作用域级 caller 环境） |
| F263-R-4 | `export { LocalX as Y }` + 顶层同名 `import { Y }` ⇒ 分支 (a) 抢在 import 分支前把边错绑到本文件 | 审查方实测 `x2.ts::draw -> x2.ts::Widget.render`（正解应为 `x2-other.ts`） | 未修（根因是导出名与本地绑定名解耦，非遮蔽） |
| F263-R-5 | `import conn = NS.Http` / `export import x = NS.C`（TS 限定名 import 别名）在 `registerImportBindings` **表 1、表 2 双缺席** | 审查方实测 `y1.ts::go1 -> y1.ts::Client.send`（真身是 `y-other.ts::Http.send`） | 未修（**F260 既有** mapper 登记缺口，与本卡判据无关） |
| F263-R-6 | `required_parameter` 不区分值函数形参与**纯类型位置**形参（`interface Sink { accept(c: Client): void }`），使未声明裸标识符白拿该类型 | 审查方实测 `y3.ts::go3 -> y3.ts::Logger.warn` | 未修（F260 既有缺口） |
| F263-R-7 | 具名类表达式自身名 / 嵌套 namespace 体内同名声明 / 函数级泛型形参 仍计入 `nested` ⇒ 连坐弃权同文件同名类真边 | 审查方实测 minimatch 丢 3 条真边；外部 `.js` 语料分支 (a) 候选 24 条中拦掉 3 条（12.5%） | 未修（文件级环境不感知块级作用域的固有代价，F260 R-8 同款；彻底解决需作用域级绑定环境） |
| F263-R-8 | 虚分派：`b: Base` 声明类型出边指向 `Base.run`，运行时实际进子类覆写 | 审查方实测 | 未修（F260 R-10 既定取舍，`medium` 置信度已表达该不确定性） |

---

## 第 3 轮：delta 对抗审查在第 2 轮**新代码**里抓到缺陷，顶层判定收口

按「审查轮新代码必须再审」的既定约定，第 2 轮新增的 128 行顶层/嵌套判定逻辑单独送了一轮
异构对抗审查。审查方构造 fixture 跑真实流水线，**并用 `node` 实跑验证运行时语义**，抓到两条：

### 缺陷 1（CRITICAL）— 「顶层同名必是声明合并」这条安全前提被证伪

顶层**赋值 / 重绑**也被计成 `topLevel`，而赋值**必然不是**声明合并——它真的改变了名字所指。

```js
function withLogging(_C) { return class Wrapped { m() { return 'wrapped'; } }; }
export class Eye { m() { return 'eye'; } }
Eye = withLogging(Eye);                       // mixin / 装饰器包裹，常见写法
export function runI() { const v = new Eye(); return v.m(); }
```

实测出边 `runI -> Eye.m`，但实跑 `runI() === 'wrapped'` ⇒ 真正执行的是 `Wrapped.m`，**假边**。
同款还有顶层裸重赋值（`Foo = Other;`）与顶层 `for (Cee of [Other])` 重绑，均实测出假边。

根因：`expression_statement` 在透明白名单里 ⇒ 顶层裸赋值的 `assignment_expression`
拿到 `isTopLevel===true`；`for_in_statement` 直挂 `program` 同理。

**旁证（说明第 2 轮的计数是偶然而非有原则）**：语义相同的顶层解构赋值
`({ Eee } = { Eee: Other })` **却被正确挡住**，仅因为 `parenthesized_expression`
恰好不在透明白名单里——同一件事两种结论。

### 缺陷 2（WARNING）— 箭头函数无括号单形参被计成 topLevel

`case 'arrow_function'` 用**箭头节点自己收到的** `isTopLevel` 绑定无括号单形参，
箭头直挂 `export_statement` 时该**函数作用域形参**被记成顶层：

```ts
export class Kay { m(): string { return 'kay'; } }
export default Kay => { const v = new Kay(); return v.m(); };
```

实测出边；`.js` 版实跑 `default(Other) === 'other'` ⇒ `v` 是调用方传入的任意类实例，**假边**。
（带括号形参走 `formal_parameters` ⇒ 已正确记 nested，只有无括号单参形态漏。）

### 处置

在**消费侧**（三个 case）收口，`bindName` 恒传 `false`（按 nested 计）：
`assignment_expression` / `augmented_assignment_expression`、`for_in_statement`、
`arrow_function` 无括号单形参。理由：这三类形态在语法上就不可能是声明合并，
降级为 nested 只让判据更保守（多弃权、不放行），不影响真正的声明合并
（`class` + `interface` + `namespace` 走声明类分支，不经这三个 case）。

**刻意不改透明白名单**：`expression_statement` 是顶层裸 `namespace Foo {}` 所必需
（第 2 轮探针实测），删掉会重新引入声明合并误伤。收口点选在消费侧而非白名单侧。

红先行用例 M10j（顶层重赋值）/ M10k（顶层 for-of 重绑）/ M10l（箭头无括号形参），
三条改实现前均实测红（`expected true to be false`），改后转绿；M10h（声明合并 ⇒ true）回归仍绿。

### 第 3 轮后主线程独立复验（真实流水线）

```
scratchpad/repro   : 假边①② 缺席；INFERRED c.ts::driver -> c.ts::Real.go 在 ✓
scratchpad/verify  : INFERRED h1.ts::useModels -> Models.retrieve 在（声明合并未回退）；
                     h2 对照边在；x1.ts::goAlias -> Task.run 缺席 ✓
scratchpad/round3  : 四条新假边（mixin 重赋值 / 裸重赋值 / for-of 重绑 / 箭头无括号形参）
                     的 INFERRED `.m()` 边全部缺席，只剩 EXTRACTED 构造边（属 F263-R-3 家族）✓
```

## 最终验证（主线程亲跑，非转录）

| 项 | 结果 |
|---|---|
| `npx vitest run` | 530 files passed / **7458 passed** / 0 failed |
| `npm run build` | tsc 零错误 |
| `npm run test:plugins` | pass 1580 / fail 0 |
| `npm run repo:check` | exit 0（graph-quality 六指标全 pass） |
| `npm run release:check` | exit 0 |
| 生产图 `legacy.classMethodWithInEdge` | **238**（F260 锚点保持） |
| 生产图 `headline.methodWithInEdge` | **236**（保持） |
| 生产图 `headline.methodNodes` | 517 → **518**，见下 |
| 全量 calls 边 vs pre-F263 基线逐边 diff | **0 added / 0 removed**（3996 → 3996） |

**517 → 518 的精确归因**（主线程实测 `metadata.memberKind`，非推断）：新增节点恰为 2 个，
`ReceiverBinding.soleBinding`（`memberKind: 'property'`，**不计入** methodNodes）与
`ReceiverTypeEnv.isSoleBinding`（`memberKind: 'method'`，**贡献那唯一的 +1**）。
二者都是本次改动自身新增的接口成员；接口方法签名不是调用目标，故无入边。
分子 236 与 F260 锚点 238 逐位不变，**分母 +1 与判据行为无关**。

> ⚠️ 一处需留意的口径：第 3 轮子代理曾把 +2 节点归因为「新增测试用例产生的符号」——
> **该归因是错的**，主线程按 `memberKind` 实测已更正为上述两个接口成员。留痕以免后续转录传谬。

## 审查档位声明（Codex 配额耗尽期）

按 `CLAUDE.local.md` 暂停节执行，**Codex 对抗审查缺席**，改用独立子代理异构对抗，共 5 轮：

| 轮次 | 切入角 | 结论 |
|---|---|---|
| 1 | Spec 合规审查 | 0C / 0W / 1I |
| 1 | 代码质量审查（含变异测试 5 个变异体） | 0C / **1W**（R36 fixture 无区分力，已修）/ 2I |
| 1 | 对抗 A：新守卫自身的绕过构造面 | **3C**（别名导出绕过等，1 条已修，2 条登记 R-4/R-5） |
| 1 | 对抗 B：误伤面（守卫会不会把真边也弃了） | **1C**（声明合并误伤，已修）/ 3W |
| 2 | delta 对抗：第 2 轮新代码的顶层判定面 | **1C**（顶层重赋值）/ 1W（箭头形参），**均已修** |
| 2 | verify：工具链验证 + 证据核查 + over-claim 扫描 | 0C / 0W / 1I |

**残余风险如实登记**：Codex 异构档位缺席，上述结论不构成安全证据；F263-R-3..R-8 见上方登记表。
