# F263 plan delta（第 2 轮）— 判据由「绑定点总数」改为「顶层/嵌套分计」

## 为什么要改（对抗审查实测，主线程已独立复现）

第 1 轮实现把判据定为 `slot.total === 1`（纯遮蔽计数）。两路异构对抗审查各自实测证伪，
主线程用真实 `batch --mode graph-only` 流水线独立复现（fixture `scratchpad/verify`）：

### 证伪 1（误伤面 · CRITICAL）— TS **声明合并**被误判为遮蔽

```ts
// h1.ts
export class Models { retrieve(id: string): string { return id; } }
export declare namespace Models { export type Model = { id: string } }
export function useModels(m: Models): string { return m.retrieve('gpt'); }
// h2.ts（对照，无合并）
export class Plain { retrieve(id: string): string { return id; } }
export function usePlain(m: Plain): string { return m.retrieve('gpt'); }
```

实测（含第 1 轮守卫的 dist）：

```
INFERRED src/h2.ts::usePlain -> src/h2.ts::Plain.retrieve     ← 对照，边在
(src/h1.ts::useModels -> Models.retrieve 缺席)                 ← 真边被守卫误杀
```

`class F` + `namespace F` / `interface F` 是 TS **声明合并**——它们是**同一个符号**，
运行时 `F` 恒指向那个 class，不存在「遮蔽」。表 1 把它们计成 2 个绑定点，
`total===1` 失败，该类在本文件的**全部**分支 (a) 真边消失。

审查方量化（node_modules 语料 999 个 .ts）：384 个导出类中 **98 个（25.5%）**命中该形态，
且 98/98 全部是 `class_declaration + internal_module`（companion namespace），
覆盖 openai / @anthropic-ai/sdk / onnxruntime-web 等主流包——**是现代 TS SDK 的主流写法，
不是极端构造**。本仓自身语料 `lost=0`，所以 238 锚点看不出这个问题。

### 证伪 2（绕过面 · CRITICAL）— `export { X as Y }` 别名导出让守卫整体失效

```ts
// x1.ts
class Impl { run(): void {} }
export { Impl as Task };
export function goAlias<Task>(t: Task): void { t.run(); }
```

实测：`INFERRED src/x1.ts::goAlias -> src/x1.ts::Task.run` —— **假边仍在**。

根因：`total===1` 回答的是「这个名字被绑了几次」，但分支 (a) 真正需要的不变量是
**「该名字的绑定就是 `moduleSymbolIndex` 命中的那条顶层导出声明」**。
`export { Impl as Task }` 制造了一个**没有对应本地绑定**的导出名 `Task`，
于是那唯一的 1 次计数完全来自遮蔽者（泛型形参 `<Task>`）自己，守卫反被它满足。

## 新判据

把表 1 的绑定点计数**按作用域位置分两栏**：

- `topLevel`：绑定点位于**文件顶层作用域**（祖先链只经过 `program` / `export_statement` /
  `ambient_declaration` / `lexical_declaration` / `variable_declaration` 这类透明包装节点）
- `nested`：其余一切（函数体、类体、namespace 体、形参表、泛型形参表…）

```
isSoleBinding(name) := slot.topLevel >= 1 && slot.nested === 0
```

**为什么 `topLevel >= 1` 而不是 `=== 1`**：合法 TS 里同一名字的多个顶层绑定只可能是
**声明合并**（`class` + `interface` + `namespace`）——重复的值级顶层声明是编译错误。
因此顶层多条恒为「同一符号」，不构成遮蔽；用 `>= 1` 正是为了让声明合并通过。

**为什么还要 `topLevel >= 1`（而不只判 `nested === 0`）**：这一条挡住证伪 2 ——
别名导出的 `Task` 在本文件**没有任何顶层绑定**（顶层绑定名是 `Impl`），
`topLevel === 0` 直接弃权，不再被「唯一那次计数来自遮蔽者」蒙混过关。

## 逐案对照（新判据）

| 形态 | topLevel | nested | sole | 结论 |
|---|---|---|---|---|
| 案例①（`export class Task` + 函数内 `class Task`） | 1 | 1 | false | 弃权 ✓ 假边仍被挡 |
| 案例②（`export class Handler` + `function process<Handler>`） | 1 | 1 | false | 弃权 ✓ 假边仍被挡 |
| 对照真边（`export class Real` + `new Real().go()`） | 1 | 0 | true | 出边 ✓ |
| 声明合并（`class Models` + `declare namespace Models`） | 2 | 0 | **true** | **出边 ✓ 修复误伤** |
| 别名导出绕过（`export { Impl as Task }` + `<Task>`） | **0** | 1 | **false** | **弃权 ✓ 修复绕过** |

## 明确**不**在本轮修的（登记为残余风险）

- **F263-R-4**：`export { LocalX as Y }` + 顶层同名 `import { Y }` ⇒ 分支 (a) 抢在 import 分支前
  把边错绑到本文件（实测 `x2.ts::draw -> x2.ts::Widget.render`，正确答案是 `x2-other.ts`）。
  新判据下 `topLevel===1`（那条 import）、`nested===0` ⇒ 仍放行。根因是**导出名与本地绑定名解耦**，
  不是遮蔽，需要 `exportByName` 侧记录「该导出条目的本地绑定名」才能收口，属另一件事。
- **F263-R-5**：`import conn = NS.Http` / `export import x = NS.C`（TS 限定名 import 别名）在
  `registerImportBindings` **完全未登记**（表 1、表 2 双缺席），使同名类型位形参成为该名字的唯一答案。
  这是 **F260 既有**的 mapper 登记缺口，与本卡判据无关。
- **F263-R-6**：`required_parameter` 分支不区分形参处在**值函数**还是**纯类型位置**
  （`interface Sink { accept(c: Client): void }` / `type Cb = (t: T) => void` 的形参名会以真类型写进表 2），
  使未声明的裸标识符白拿该类型。同为 F260 既有缺口。
- **F263-R-7**：具名类表达式自身名、嵌套 namespace 体内的同名声明、函数级泛型形参 ——
  这些绑定在新判据下仍计入 `nested` ⇒ 连坐弃权该文件同名类的真边（实测 minimatch 丢 3 条真边，
  外部 .js 语料分支 (a) 候选 24 条中拦掉 3 条）。属文件级环境不感知块级作用域的固有代价
  （F260 R-8 同款），彻底解决需要作用域级绑定环境，远超本卡。
- **F263-R-3**（第 1 轮已登记）：`call-resolver.ts` Stage 1/2 的同根因假边。
</content>
