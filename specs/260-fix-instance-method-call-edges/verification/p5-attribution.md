# F260 P5 + P5b 收口轮归因报告

> 承接 `plan.md` §15（v9）的裁决 **P5b-1 ~ P5b-5**。
> 本轮 = **P5 断连续接**（变异测试 + 归因）+ **P5b 四项收口**（两个被证伪的等价结论补杀手 /
> N43·N44 守护力缺口 / `for_in_statement` 白名单 recall bug / `h1-phantom-key-stats.mjs` 三处）。
>
> ⚠️ **审查档位：Codex 对抗审查暂停（配额耗尽），异构档位缺席。**
> 本轮改动含判定器性质的面（`h1-phantom-key-stats.mjs` 的 dist 新鲜度闸），按 `CLAUDE.local.md`
> 顶部暂停节的要求**显式标注档位缺席**，配额恢复后可回补 Codex 审查。
>
> ⚠️ **本轮为续接轮**：P5 实现代理在「修 3 个撞 `bracketAwareSplit` 的锚点」处断连，
> 其源码改动（语言分流 / `kind==='class'` 收窄 / `implements` 顶层截断 / `stripGenericParams`
> 支持 `<`）与 R13–R22 用例已落盘且全绿，本轮**未重做**，只完成剩余的变异测试、归因与收口。
> 本报告如实区分「承接既有」与「本轮新做」。

---

## 0. 本轮做了什么 / 没做什么

| 项 | 状态 | 备注 |
|---|---|---|
| P5 源码（`buildClassMroIndex` TS 分支 / `extractTsExtendsClause` / `indexOfTopLevelKeyword` / `stripGenericParams`） | 承接（前一代理落盘） | **本轮一行未改** |
| P5 用例 R13–R22 | 承接 | 本轮未改 |
| **P5 变异测试（§13-M5 独立枚举 + §14-P4b-4 双证）** | **本轮完成** | 32 变异体 / **31 杀死 + 1 TYPE_KILLED / 零存活**（§1） |
| **P5 归因（P4b→P5 逐边 diff + 特性 A/B）** | **本轮完成** | §3 |
| **P5b-1 Q01 / U11 杀手用例** | **本轮完成** | N46 / N46b / N47 / N47b（§2.1） |
| **P5b-2 N44 改写 + N43 因果订正** | **本轮完成** | 7 变异体**全杀**（§2.2） |
| **P5b-3 `for_in_statement` 白名单** | **本轮完成** | 唯一的源码改动；修前/修后实测见 §2.3 |
| **P5b-4 `h1-phantom-key-stats.mjs` 三处** | **本轮完成** | 三道闸逐条实跑验证（§2.4） |
| R-16（解构默认值同族 recall） | **不修**（裁决 P5b-3 已登记） | — |
| `call-resolver.ts` / `edge-diff.mjs` / 其余源码 | **一行未碰** | 环境硬约束 4 |
| git 写操作 | **零** | 只用了只读 `git show HEAD:<file>` |

---

## 1. P5 变异测试（断连续接的主交付）

### 1.1 断连点的处置

前一代理停在「3 个撞 `bracketAwareSplit` 的锚点」：`I01`–`I03` 的锚点文本
`if (ch === '[' || ch === '(' || ch === '<') depth++;` 在
`indexOfTopLevelKeyword` 与 `bracketAwareSplit` 里**逐字相同**（hits=2 ⇒ 跑批器判 `ANCHOR_ERROR`
并跳过，这是跑批器的 fail-closed 行为，不是缺陷）。

处置：把锚点扩到**带上各自的 `else if` 行**（前者带 `=>` 例外、后者没有），两侧因此可区分；
并**顺带把 `bracketAwareSplit` 那一侧也补进枚举**（`I01b` / `I03b`）—— 原清单只枚举了
`indexOfTopLevelKeyword` 一侧，那本身就是一处枚举缺口。

### 1.2 跑法

- 跑批器：`p5b/mutation-run.mjs`（sha256 `1213bd0c2264a35e740e5571936dd02c292b5072e79412abf07ccc09b9db1273`）
- 变异体清单：`p5b/p5-mutants.mjs`（sha256 `85eaf1bebe61653c716ea108307c706319423f6f8ef74734da847a2c55c67d25`）
- 每个变异体：锚点替换（**命中次数必须恰好 1**）→ `npm run build`（不过判 `TYPE_KILLED`）→
  `npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts` → 逐字还原源码
- 严格性承接 P5 原版：JSON 必须可解析**且** `numTotalTests` 与基线逐字相等，否则判 `INVALID_RUN`
  （防「vitest 崩了也吐 numTotalTests=0 的 JSON」被误读成 SURVIVED）
- 基线：**109 tests / 0 failed**（补完 R30/R31 后 111）；
  收尾 `源码逐字还原: true`，`call-resolver.ts` sha256 跑前跑后一致
  （`03809b1f71d49df2419ff1e3098ef042a181afc545ad6887f2946bf60e26894d`）

### 1.3 枚举口径（禁从断言反推）

按 `call-resolver.ts` 的**源码判据面**独立枚举，7 组：

| 前缀 | 判据面 | 个数 |
|---|---|---|
| `L` | 语言分流 `isTsJs`（B7） | 4 |
| `K` | `kind` 收窄（A7） | 3 |
| `E` | `extractTsExtendsClause` 的截取与 `implements` 截断 | 4 |
| `I` | `indexOfTopLevelKeyword` 深度计数 / 词边界 / 钳制 + `bracketAwareSplit` 同款判据 | 11 |
| `S` | `stripGenericParams` 切点 | 3 |
| `F` | 父类列表清洗（object 过滤 / bracket-aware split / 空表 / 守卫） | 4 |
| `M` | `lookupInMro` 的表消费与深度上限 | 3 |
| | **合计** | **32** |

plan §15 点名必须覆盖的五条**逐条对位**：去 `implements` 截断 `E02` / 去 `kind==='class'` 收窄
`K01` / 反向语言判据 `L01` / `stripGenericParams` 只剥一种括号 `S01`+`S02` / MRO 深度上限
`M02`+`M03`。

### 1.4 结果：32 变异体 / 31 杀死 + 1 TYPE_KILLED / **零存活**

| 变异体 | 被破坏的判据 | 结果 | 杀手用例 |
|---|---|---|---|
| `L01-reverse-predicate` | 反向判据「非 Python 即 TS」 | ☠ 杀死 | R14c |
| `L02-ts-only` | 语言分流漏掉 javascript | ☠ 杀死 | R13b |
| `L03-always-ts` | 恒走 TS 分支 | ☠ 杀死 | R14c, R15, Codex-W3 等 5 条 |
| `L04-never-ts` | 恒走 Python 分支（= P5 未实现） | ☠ 杀死 | R13, R13b, R13c, R14, R18–R29 共 14 条 |
| `K01-drop-ts-narrowing` | **A7 撤回**：TS 分支也放 interface 进 MRO | ☠ 杀死 | R14b |
| `K02-narrow-everywhere` | 收窄扩到非 ts/js 分支 | ☠ 杀死 | R15 |
| `K03-no-kind-filter` | kind 过滤整体移除 | ☠ 杀死 | R14b |
| `E01-naive-indexof-extends` | 顶层扫描退化为文本首次出现 | ☠ 杀死 | R19, R24, R25 |
| `E02-drop-implements-truncation` | implements 截断整体移除 | ☠ 杀死 | R14 |
| `E03-naive-indexof-implements` | implements 截断退化为文本首次出现 | ☠ 杀死 | **R23（本轮补）** |
| `E04-wrong-slice-offset` | slice 偏移不跳过关键字本身 | ☠ 杀死 | 14 条 |
| `I01-drop-angle-open` | 深度计数不认 `<` | ☠ 杀死 | R19, R24 |
| `I02-drop-paren-open` | 深度计数不认 `(` | ☠ 杀死 | R24 |
| `I03-drop-bracket-open` | 深度计数不认 `[` | ☠ 杀死 | **R30（本轮补）** |
| `I01b-split-drop-angle-open` | `bracketAwareSplit` 不认 `<` | ☠ 杀死 | **R31（本轮补）** |
| `I03b-split-drop-bracket-open` | `bracketAwareSplit` 不认 `[` | ☠ 杀死 | R15, Codex-W3 |
| `I04-arrow-exception-off` | `=>` 例外撤回 | ☠ 杀死 | **R24（本轮补）** |
| `I05-drop-angle-close` | 深度计数不认 `>` 闭合 | ☠ 杀死 | R19, R24, R26 |
| `I06-ignore-depth` | 不要求 `depth===0` | ☠ 杀死 | R19, R24 |
| `I07-drop-left-boundary` | 不校验左词边界 | ☠ 杀死 | **R25（本轮补）** |
| `I08-drop-right-boundary` | 不校验右词边界 | ☠ 杀死 | **R23, R25（本轮补）** |
| `I09-no-clamp` | 深度不做下界钳制 | ☠ 杀死 | **R26（本轮补）** |
| `S01-bracket-only` | 只剥 `[`（P5 之前的行为） | ☠ 杀死 | R18, R27 |
| `S02-angle-only` | 只剥 `<`（Python Generic[T] 失守） | ☠ 杀死 | R15, Codex-W3 |
| `S03-max-not-min` | 取后出现的括号作切点 | ☠ 杀死 | **R27（本轮补）** |
| `F01-drop-object-filter` | 不再过滤 `object` | ☠ 杀死 | R15 |
| `F02-no-bracket-aware-split` | `split(',')` 退化 | ☠ 杀死 | R15, Codex-W3 |
| `F03-empty-list-registered` | 空父类列表也建条目 | ☠ 杀死 | R15 |
| `F04-no-superlist-guard` | 无继承子句时不 `continue` | **TYPE_KILLED** | `tsc` 拒绝（`string \| undefined` 传进 `bracketAwareSplit(input: string)`）——**编译器就是杀手** |
| `M01-drop-renamed-guard` | `renamedImportAliases` 拦截撤回 | ☠ 杀死 | R21 |
| `M02-mro-depth-1` | MRO 深度上限收到 1 | ☠ 杀死 | **R28（本轮补）** |
| `M03-mro-depth-unbounded` | MRO 深度上限拆除 | ☠ 杀死 | **R29（本轮补）** |

**零「非等价 + 无杀手」，且本轮无需任何等价性论证** —— 32 个全部被杀死或被编译器拒绝，
`plan §14-P4b-4` 的「结构论证 + 判别性样本双证」这一步在本轮**不适用**（没有幸存体要归类）。

### 1.5 本轮补的 9 条杀手用例（R23–R31）与它们的判别性设计

前一轮的 9 个幸存体全部是**判别性样本缺失**，不是等价：

| 用例 | 输入形态 | 为什么旧用例杀不掉 |
|---|---|---|
| R23 | `class Sub extends implements_base` | 旧用例的父类名不含 `implements` 子串 ⇒ 朴素 `indexOf` 与顶层整词判据结论相同 |
| R24 | `class Fn2<F extends () => void, T extends Cfg> extends Base` | R19(c) 的箭头是**最后一个**类型参数，提前归零发生在真正的顶层 `extends` 之前 ⇒ 两者结论相同。判别性要求箭头**后面**还有带 `extends` 的类型参数 |
| R25 | `class my_extends extends Base` / `class extends_helper extends Base` | 旧用例的类名不含 `extends` 子串 |
| R26 | `class Weird<A>> extends Base` | 旧用例括号平衡 ⇒ 钳制与不钳制永不分歧 |
| R27 | `class Sub extends Base<Item[]>` | 旧用例的父类名不会同时含 `<` 与 `[` ⇒ `min`/`max` 结论相同 |
| R28 | `C extends B extends A`，方法在 A | 旧用例只有一层继承 ⇒ 上限 1 与 8 结论相同 |
| R29 | 10 级链，方法只在最深一级 | 旧用例链长 ≤ 8 ⇒ 有界与无界结论相同 |
| R30 | `class Tup<T extends [number], U extends Cfg> extends Base` | 单个 `Item[]` 少加一次少减一次**抵消**；判别性要求元组之后还有带 `extends` 的类型参数 |
| R31 | `class Sub extends Base<K, V>` | 旧用例的泛型实参不含逗号 |

> **方法论承接**：这与裁决 P4b-4「真空绿」是同一族坑的第二层 —— 变异测试查**用例**的守护力，
> 而幸存体的等价判定要查**样本**的判别力。9 条里没有一条是靠"再跑一遍"翻案的，
> 全部靠**构造判别性输入**翻案。

### 1.6 P5b-3 引发的守护力回归复核（本轮新增，重要）

P5b-3 给 `for_in_statement` 加白名单后，**N43 的输入不再走到 `collectPatternNames`**
（在更靠前的闸就被挡下）⇒ P4b 变异体 `U16`（`collectPatternNames` 不再跳过
`property_identifier`）**从"被 N43 杀死"退化为存活**。这是一次真实的守护力回归，
若不复核就会被"新用例全绿"掩盖。

处置：补 **N43b**（`({ slot: rec.slot } = src)` —— 解构**赋值**左值是 `object_pattern`，在白名单内，
一路递归到 `member_expression` 才碰到 `property_identifier`），并重跑相关 P4b 变异体：

| P4b 变异体 | 复核结果 | 杀手 |
|---|---|---|
| `U15-collectPattern-pair-key` | ☠ 杀死 | N42（未受影响） |
| `U16-collectPattern-property-id` | ☠ 杀死 | **N43b（本轮补回）** |
| `V05-forin-skip` | ☠ 杀死 | N25, N45c, N45d |
| `S10-assign-whitelist-widen` | ☠ 杀死 | N16, N45 |
| `S11-assign-whitelist-narrow` | ☠ 杀死 | N14, N15, N45d |

清单 `p5b/p4b-recheck-mutants.mjs`（sha256 `bd1ebd5db94664cfe56fa7dff60f2a31a3854ab1106a07c40acbad467f3ea9ce`）。
**5 / 5 全杀，守护力无净损失。**

---

## 2. P5b 四项收口

### 2.1 裁决 P5b-1 —— 两个被证伪的「等价」结论补杀手

`typescript-receiver-env.ts` 侧变异测试（清单 `p5b/env-mutants.mjs`，sha256
`0081bf76a6581838bf40111d545abdd618bb8339c0140e41378b76ab5f315797`；基线 122→123 tests / 0 failed）：

| 变异体 | P4b 原判 | 本轮结果 | 杀手 |
|---|---|---|---|
| `Q01-this-bare-hijack`（形态 1 扩到裸 `this`） | 「等价」 | ☠ **杀死** | **N46, N46b** |
| `U11-memberHost-accept-any-parent` | 「等价」 | ☠ **杀死** | **N47, N47b** |

**Q01 的证伪结构（实测，非推演）**：`const this = new Foo(); class C { m(){ this.q(); } }`
在 tree-sitter TS 语法下**解析零 ERROR**，`this` 落在 `variable_declarator` 的 name 位、
节点类型就是 `identifier` ⇒ 表 2 的键 `'this'` 会被登记。原等价论证的前提
（「`this` 是保留字，键 `'this'` 永不可能被登记」）**为假**。
带 import 版（`const this: A = null as any`）更危险：`A` 恰好 1 个绑定点且来自 import ⇒
A1 放行 ⇒ 变异体产出的是一条 `soleImportBinding=true` 的**高置信假边**。
修前实测（当前源码）四种形态全部弃权，用例即钉住这一点。

**U11 的证伪结构（实测 AST）**：`class C { g!){ g: A = null as any; run(){ this.g.q(); } } }`
的树形为

```
class_declaration "C"
├── ERROR              ⚠  "{ g!)"
│   └── public_field_definition "g!"        ← parent 是 ERROR，parent.parent 是具名类 C
└── class_body
    ├── public_field_definition "g: A = …"  ← 正常字段
    └── method_definition "run"  → this.g.q()
```

原等价论证的前提（「`public_field_definition` 的 parent 恒为 `class_body`」）**为假**。
撤掉判据后，ERROR 里那个**无类型**的 `g` 会以 `C#g`（type=null）登记，
与 class_body 里 `g: A` 建的同名桶冲突 ⇒ 中毒 ⇒ 丢边。当前行为 `receiverType='A'`，用例钉住它。

> 两条都遵守裁决 P5b-1 的口径：**磁盘上的 WIP / 半成品文件是 Spectra 的真实采集面**，
> 「tsc 会报错」不构成豁免。

### 2.2 裁决 P5b-2 —— N44 改写 / N43 因果订正

**N44 改写**：从端到端断言改为**直接对 `buildReceiverTypeEnv` 的注册键集合断言** ——
表 2 的全部宿主分桶键（含 `#` 的键）必须逐字等于 `['anon#conn']`。
端到端断言（`this.conn.q()` 拿到 `B`）作为补充保留。

探针实现（测试内 `hostBucketKeys`）：调用期间把 `globalThis.Map` 换成记录实例的子类，
取回本次构建创建的全部 Map，再筛含 `#` 的键（表 1 的键是裸类名、绝不含 `#`，
故无需区分是哪张表，并集**就是**宿主分桶键空间）。
已知耦合如实登记在用例注释里：探针依赖「两张表用 `Map` 承载」，实现换容器会以
「键集合为空」**明红**，不是静默放行。

7 个兜底桶名变异体的复验结果 —— **7 / 7 全杀**：

| 变异体 | 兜底桶名 | 旧口径（端到端） | 新口径（键集合） |
|---|---|---|---|
| `V07a` | `'anon'` | ☠（靠字面量撞拼写） | ☠ |
| `V07b` | `'__anon__'` | 存活 | ☠ |
| `V07c` | `''` | 存活 | ☠ |
| `V07d` | `String(node.parent?.id)` | 存活 | ☠ |
| `V07e` | `'Base'` | 存活 | ☠ |
| `V07f` | `'D'` | 存活 | ☠ |
| `V07g` | 删 `host == null` 子句（键落 `null#conn`） | 存活 | ☠ |

> **跑批器 fail-closed 的一次实证**：`env-mutants.mjs` 的收尾整批复跑里，`W02` 一次返回
> `INVALID_RUN（total 0 != 123）` —— vitest 在满载下没跑起任何用例。严格版跑批器**没有**把
> 「一个用例都没跑」读成 SURVIVED，而是判 `INVALID_RUN` 并要求重跑；单独重跑得
> `KILLED（N45d）`。这条与 §4.1 的满载 flake 同源，一并如实登记。

> **与审查预判的差异，如实登记**：裁决 P5b-2 预计第 7 个（删子句）「大概率等价」。
> 实测**非等价**——它在旧口径下等价（`null#conn` 这个键永远不会被查），
> 在键集合口径下立刻现形。这正是改口径的价值：把「注册了一个永远不会被查的假键」
> 这一整类缺陷从不可观测变成可观测。

**N43 因果订正**：用例注释原先把守护归因给
`if (node.type === 'property_identifier') return;` —— 那是**死代码**
（`property_identifier` 是叶子，删掉后通用递归照样采不到它）。已改写注释：真正承重的是
`collectPatternNames` 的 `out.push` **白名单**；并注明 P5b-3 之后 `for_in_statement`
的左值白名单是更靠前的一道闸，N43 的输入已不再走到 `collectPatternNames`
（该通路的守护改由 **N43b** 承担，见 §1.6）。

### 2.3 裁决 P5b-3 —— `for_in_statement` 补 W-B 白名单（唯一源码改动）

`assignment_expression` 分支有 `ASSIGNMENT_BINDING_TARGET_TYPES` 白名单挡住
`a.b = 1` / `a[k] = 1`（改的是**属性**，名字 `a` 所指未变），`for_in_statement` 分支没有同款
—— for-of / for-in 的左值同样允许是**赋值目标**。

**修前 / 修后实测**（探针 `p5b/probe.mts`，走 `TreeSitterAnalyzer.analyze()` 真实抽取）：

| 输入（均含 `import { A }`，形参 `rec: A`） | 修前 `receiverType` | 修后 |
|---|---|---|
| `for (rec.slot of xs) {}` 后 `rec.m()` | **undefined**（误中毒） | **A**, sole=true |
| `for (rec[0] of xs) {}` 后 `rec.m()` | **undefined**（误中毒） | **A**, sole=true |
| 对照：无 for 语句，直接 `rec.m()` | A, sole=true | A, sole=true |
| 对照：`for (const it of xs) {}` 后 `rec.m()` | A, sole=true | A, sole=true |

方向是**丢边不是假边**，但两个入口是同一判据的两面，不对称本身就是 F259 型隐患。
实现上**共用同一张表**（不复制第二份），并在表的文档注释里写明两个消费点。

保真反向用例（防止把 recall 修成假边口子）：N45c（`for (const rec of xs)` 是真绑定，仍必须中毒）、
N45d（`for (const { rec } of xs)` 解构声明同样中毒）。AST 实测确认声明形态的 `left`
恒为 `identifier` / `object_pattern` / `array_pattern`（11 种写法逐一探测），全部在白名单内。

同族的解构默认值（`assignment_pattern`）问题按裁决**不修**，仍登记为 **R-16**。

### 2.4 裁决 P5b-4 —— `h1-phantom-key-stats.mjs` 三处收口

| 项 | 处置 | 实跑验证 |
|---|---|---|
| **W3** `b.isTypeOnly` 恒假死子句 | 删掉，改按 **import 条目级**（`imp.isTypeOnly`）判定 | 输出 `renamedSpecifiersTypeOnly: 3` / `ValueOnly: 34`，与 P4b 记录**逐字一致**（本仓无 inline 写法） |
| **W4** 陈旧 dist 全零 + exit 0 | 三道闸：关键符号缺席 → exit 2；全零 → exit 3；mtime 倒挂 → 告警并落 `distStaleWarning` | 三个场景**构造实跑**（§2.4.1），逐个确认闸真的响 |
| **W1** collisions 含注释/字符串/import 自身 | 加 `strictCollisions` 第二列，两口径并报；宽口径逐字保留 | 宽 22 / 严 14，差集 8 条逐条核对（§2.4.2） |
| **W2** `$` 词边界假阴性 | doc 登记为已知限制，并新增 `wordBoundaryUnverifiableNames` 计数**不再静默** | 本仓 0 实例 |

能力边界已写进文件头：inline `import { type X as Y }` 归**值**侧（`namedImportBindings`
的元素只有 `{imported, local}` 两个字段，schema 无说明符级 `isTypeOnly`），本仓 3 : 34 的拆分
碰巧正确，**换一个仓库即失真**。

#### 2.4.1 三道闸的构造验证（闸自己也要被验证）

```
场景 A：dist 有采集入口但缺 buildNamedImportBindings  → exit 2 + 明确错误行
场景 B：关键符号齐但采集返回空 Map                     → exit 3（先打印统计再 fail-loud）
场景 C：dist 目录整体缺失                              → exit 2
```

三个场景全部实跑（用构造的 fake dist），**闸全部响**。这一步是承接 F257 的教训：
新加的门禁自己 fail-open 是最常见的失效形态。

#### 2.4.2 严口径剔除的 8 条逐条核对

| 幽灵键 | 宽口径为何命中 | 严口径为何不命中 |
|---|---|---|
| `src/core/llm-client.ts\|callLLMviaCodex` | import 自身 + 注释里 `callLLMviaCodex()`（`callLLMviaCodexProxy` 不匹配词边界） | 两处都被挖空 |
| `src/batch/batch-orchestrator.ts\|SimpleLLMClient` | import 自身 + 注释 | 同上 |
| `src/scaffold-kb/ingest/url-fetcher.ts\|request` | 两条 import 自身（`node:https` / `node:http`） | 全是 import |
| `src/scaffold-kb/nohit-recorder.ts\|constants` / `scripts/eval-judge-jury.mjs\|TASK_FIXTURE_DIRS` / `src/core/llm-client.ts` 系余项 / `tests/unit/graph-quality-core.test.ts\|IGNORE_*_TOKEN` ×2 / `plugins/.../fix-compliance-judge-cli.test.mjs\|main` | 同族（import 自身 / 注释 / 字符串） | 同族 |

方向性结论**不变**（幽灵键的 `imported` 名在同文件存在同名标识符**并不罕见**），
只是强度从 22 收窄到 14。裁决 P4b-3 的「两口径接受并存」原样成立，现在两个数都在脚本输出里。

---

## 3. P5 归因

### 3.1 锚点与工具冻结

| 标签 | 定义 |
|---|---|
| **P4b** | 前一轮收尾态（`f260-p4b-r2/art/graph-P4b.json`，sha256 `016b079c…aa03`，建于 12:19） |
| **P5** | 当前工作树（P5 源码 + P5b 收口 + 全部新用例） |
| **P5off** | 当前工作树，但 `isTsJs` 恒 `false`（= 变异体 `L04`，等价于「P5 特性关闭」） |

**工具冻结**：`edge-diff.mjs` / `coverage-metric.mjs` / `dump-skeletons.mjs` /
`callsites-fingerprint.mjs` 本轮**一行未改**，两侧用的是同一份。
唯一改过的 `verification/*.mjs` 是 `h1-phantom-key-stats.mjs`，它**不参与任何 diff**，
但它**会被采集进图**，故其影响在 §3.3 里显式扣除（+1 个 module 节点、0 条边）。

**环境**：每次建图前 `npm run build`（退出码 0）；`node dist/cli/index.js --version` →
`spectra v4.4.0 (0d3e385)`，确认跑的是本 worktree 产物；`--output-dir` 一律指向 scratchpad，
**未覆写** `specs/_meta/graph.json`；构造 P5off 时对 `call-resolver.ts` 的临时替换跑前存副本、
跑后还原，sha256 跑前跑后一致（`03809b1f…894d`）。

### 3.2 主口径：P4b → P5 逐边 diff

```
before 12882 边 / 3975 calls  →  after 12886 边 / 3977 calls
新增 4 条 {"calls":2,"depends-on":2} / 减少 0 条 {}
retarget 对 0 / 不成对新增 calls 2 / 不成对减少 calls 0
新增边三分类: {retarget:0, new-symbol:0, new-endpoint-manual:0, phase-expected:2, unclassified:2}
断言 2 违规 1 / 断言 3 悬空 0
结论（机械判据）: FAIL（unclassified = 2）
```

**「只增不减」PASS**（减少边 = 0，retarget 对 = 0）。

#### 4 条新增边**全量**人工回源码核对（不是抽样）

| # | source | relation | target | 源码证据 | 结论 |
|---|---|---|---|---|---|
| 1 | `tests/unit/typescript-mapper-callsite.test.ts` | calls | `src/core/grammar-manager.ts::GrammarManager.getInstance` | 该文件 L1223 `const grammar = await GrammarManager.getInstance().getGrammar('typescript');`（N44 改写引入的 `hostBucketKeys` 探针） | ✅ 真边 |
| 2 | 同上 | calls | `src/core/query-mappers/typescript-receiver-env.ts::buildReceiverTypeEnv` | 同文件 L1238 `buildReceiverTypeEnv(tree);` | ✅ 真边 |
| 3 | 同上 | depends-on | `src/core/grammar-manager.ts` | 同文件 L30 `import { GrammarManager } from '../../src/core/grammar-manager.js';` | ✅ 真边 |
| 4 | 同上 | depends-on | `src/core/query-mappers/typescript-receiver-env.ts` | 同文件 L32 `import { buildReceiverTypeEnv } from '…/typescript-receiver-env.js';` | ✅ 真边 |

新增性证据：`git show HEAD:tests/unit/typescript-mapper-callsite.test.ts | grep -c "grammar-manager\|typescript-receiver-env"` → **0**（HEAD 版本没有这两条 import）。

**4 条全部源自本轮 N44 改写引入的键集合探针，与 P5 的 TS extends MRO 特性无关。**

#### 机械 FAIL 的两条 unclassified —— 沿用裁决 P4b-1，人工通道放行

两条 `depends-on` 边（表 3、4）被判 unclassified：裁决 P2-1 的三分类是为 **calls** 边设计的，
一条两端都是既有节点的 `depends-on` 无处可归，工具**拒绝自动盖章**、强制人工核对，
这正是 M4 收口想要的 fail-closed 行为。与 P4b §3.2 的那条 `depends-on` 完全同形。
**工具不改、判据不放宽、不排除违规项**，据实上报：机械 FAIL 两条，人工核对为真边。

#### 断言 2 的 1 条违规 —— 沿用裁决 P2-2 的作用域限定

| source | target | 工具给的理由 |
|---|---|---|
| `tests/unit/typescript-mapper-callsite.test.ts` | `…::buildReceiverTypeEnv` | `symbol 节点 exportKind=function` |

按裁决 P2-2，断言 2 的作用域限定为「**新分支 / MRO 分支产出的边**」；这条是测试文件对一个
普通导出**函数**的调用（F242 既有 callsite 面产出），属判据作用域外的误报。同 P4b-2 处置。

#### **interface-target 违规 = 0（本轮的硬要求）**

- 4 条新增边的 target 分别是：1 个 class 成员（`GrammarManager.getInstance`）、
  1 个 function、2 个 module 节点 —— **无一落在 interface 上**。
- 全图口径的独立佐证：`coverage-P5.json` 的 `symbolNodesByExportKind.interface`
  = `{total: 580, withInEdge: 0, pct: 0}` ⇒ **全仓 580 个 interface 节点入边数恒为 0**，
  A7 收窄的红线在整图层面成立，不只是在新增边上。

### 3.3 特性 A/B：P5off → P5 —— **图产物 byte 级完全相同**

```
before 12886 边 / 3977 calls  →  after 12886 边 / 3977 calls
新增 0 / 减少 0 / retarget 0 —— 机械判据 PASS
graph-P5off.json sha256 == graph-P5.json sha256 == b36f5278a561379b1e0b7437f9ff4c2967c730ac14a73c5502ee457ae1b38f41
```

即 **TS/JS extends MRO 特性在本仓语料上的图足迹 = 0 条边**。
这个结论必须区分两种成因，否则就是一个含糊的「没变化」：

| 成因 | 判定 |
|---|---|
| (a) 索引建起来了，但没有调用点满足 MRO 的触发前提 | ✅ **实测就是这一种** |
| (b) 索引根本是空的（signature 里没有 extends ⇒ 特性结构性失效 / premature no-op） | ❌ 已排除 |

**证据 1 —— 索引足迹**（`p5b/mro-footprint.mjs`，sha256 `07c65011…7378`）：
`buildClassMroIndex` 在真实语料上产出 **20 条 TS/JS 条目**（19 TS + 1 JS），逐条可读，例如
`src/panoramic/parsers/env-config-parser.ts::EnvConfigParser → ["AbstractConfigParser"]`、
`src/core/llm-client.ts::LLMTimeoutError → ["Error"]`。**特性确实在真实 signature 上生效。**

**证据 2 —— 触发前提命中数**（`p5b/mro-callsite-probe.mjs`，sha256 `40cce034…d133`）：
MRO 只在 Stage 2 的这条路径上生效——`className` 在 caller 模块 export 表里 **且** 方法
**不在**该类自身 `members`。对这 20 个类枚举其类内 member 调用点：

```
mroEntriesTsJs = 20 / totalMemberCalls = 17 / totalPrecondHits = 0
```

17 个 member 调用点**全部**调的是本类自己的方法 ⇒ 第一重验证（`classMemberIndex` 命中）
就返回 high 边，从不下探 MRO。8 个 `X extends Error` 的类更是零 member 调用点
（且 `Error` 是内建名，不在 `classMemberIndex` 里）。

> **残余风险（如实登记）**：P5 特性在本仓**没有自然实例**，其真实语料守护力目前**只由用例承担**
> （R13–R31 共 20 条，其中 R13c 走真实抽取）。这与 P4b §3.1 的处境同形：
> 「本仓无实例」不构成「不必修 / 不必测」——判据是给所有用户仓库跑的。

### 3.4 callSites 摘要（`--digest` 口径，主口径含 line/column）

```
P4b: total 123658 / files 1150 / global 48fee7a1362b0e16fefde36c5240b4a5f71a68e6280d65b019a9b7c2d5dfcd8a
P5 : total 124124 / files 1151 / global 37d6988d431559f4aece6b1b177607c7d8fe551039b40c3d988d36cb936bb791
```

逐文件摘要比对：**新增 1 个文件 + 4 个文件摘要变化，其余 1146 个文件逐字未变**。

| 文件 | 变化 | 归因 |
|---|---|---|
| `verification/h1-phantom-key-stats.mjs` | 新增（P4b 摘要生成于该文件创建之前） | P5b-4 |
| `src/knowledge-graph/call-resolver.ts` | 摘要变化 | **P5 源码**（承接） |
| `src/core/query-mappers/typescript-receiver-env.ts` | 摘要变化 | **P5b-3** |
| `tests/unit/knowledge-graph/call-resolver.test.ts` | 摘要变化 | R23–R31 新增 |
| `tests/unit/typescript-mapper-callsite.test.ts` | 摘要变化 | N43b / N44 改写 / N45–N47 新增 |

**改动面与摘要变化面逐一对应，无第五个文件被意外波及。**

### 3.5 覆盖率与图质量六指标（不劣于 P4b）

| 指标 | P4b | P5 | 判定 |
|---|---|---|---|
| method 覆盖率 | 45.6%（236/517） | **45.6%（236/517）** | 持平 |
| function 覆盖率 | 89.4%（1315/1471） | **89.4%** | 持平 |
| class 覆盖率 | 75.7%（81/107） | **75.7%** | 持平 |
| gapPct / gapRatio | 43.8 / 1.96 | **43.8 / 1.96** | 持平 |
| interface 入边 | 0 / 580 | **0 / 580** | 持平（A7 红线） |
| duplicateCanonicalId | pass | **pass** | — |
| containsCoverage | pass（6284/6284, ratio 1） | **pass（6284/6284, ratio 1）** | — |
| orphanRatio | pass（offending 0） | **pass（offending 0）** | — |
| danglingEdges | pass | **pass** | — |
| legacyAndIgnoredNodes | pass | **pass** | — |
| freshness | dirty（未提交改动） | **dirty**（同因） | 同 P4b |
| overallVerdict | **pass** | **pass** | — |

覆盖率持平是 §3.3 的直接推论（图足迹 0 ⇒ 覆盖率不可能变）。

### 3.6 §7.1 硬断言 1 —— **仍成立**

```
target    = src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes
direction = upstream, depth = 2
P5: affected = 30 | 含 batch-orchestrator: true | 含 graph-assembly: true
```

（`src/batch/batch-orchestrator.ts::runBatch` 与 `src/batch/stages/graph-assembly.ts::buildAstGraphOnly`
均在 depth=1 命中。）与 P4 记录的 30 条逐字一致。跑法：把 `graph-P5.json` 复制到
`p5b/impact-root-P5/specs/_meta/graph.json` 后直调 `dist/mcp/agent-context-tools.js::handleImpact`，
**未覆写仓库图**。

---

## 4. 门禁（plan §7.2）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 构建 | `npm run build` | 退出码 **0** |
| 全量单测 | `npx vitest run`（**只起这一个全量，不并行第二个**） | 退出码 **1**：`Test Files 5 failed \| 518 passed \| 4 skipped (527)` / `Tests 7 failed \| 7296 passed \| 18 skipped \| 21 todo (7342)` + 12 个 `[vitest-worker]: Timeout calling "onTaskUpdate"` —— **5 个文件隔离复跑全绿**，判定为满载 flake（详见下表） |
| 插件测试 | `npm run test:plugins` | 退出码 **0**；`tests 1580 / pass 1580 / fail 0` |
| 仓库校验 | `npm run repo:check` | 退出码 **0**（1 条 warning：`graph-quality:freshness` 图产物 stale —— 仓库图建于 `dfe6c479`，本轮**按硬约束未重建仓库图**，属预期） |
| 发布合同 | `npm run release:check` | 退出码 **0**，`Release contract valid` |

### 4.1 7 个失败的隔离复跑判定（如实登记，不掩饰）

| 失败文件 | 全量下 | 隔离复跑 | 判定 |
|---|---|---|---|
| `tests/unit/batch/batch-orchestrator-incremental.test.ts` | 1 failed | ✓ 全绿 | **预存 flaky**（memory 已登记） |
| `tests/integration/spec-driver-kb-prequery.test.ts` | 1 failed | ✓ 全绿 | 满载超时 flake |
| `tests/integration/batch-panoramic-doc-suite.test.ts` | 1 failed | ✓ 全绿 | 满载超时 flake（全量下耗时 88.8s） |
| `tests/e2e/batch-concurrency.e2e.test.ts` | 2 failed | ✓ 全绿 | 满载超时 flake（全量下耗时 288.8s） |
| `tests/e2e/feature-175-batch-incremental.e2e.test.ts` | 2 failed | ✓ 全绿 | 满载超时 flake（全量下耗时 316.5s） |

隔离复跑：`npx vitest run <前 3 个文件>` → 退出码 **0**，`3 passed / 13 tests`（25.5s）；
`npx vitest run <后 2 个 e2e>` → 退出码 **0**，`2 passed / 14 tests`（126.5s）。

**5 个失败文件与本轮改动面（`typescript-receiver-env.ts` + 两个测试文件）零交集**；
本轮直接改动的两个测试文件在全量下全绿（`typescript-mapper-callsite` 123 / `call-resolver` 111）。
12 个 `Timeout calling "onTaskUpdate"` 属 F235 记录的 birpc 硬超时族，同源于满载
（本次全量墙钟 489s，测试累计 3757s）。

---

## 5. 产物与复算命令

### 入库（`specs/260-fix-instance-method-call-edges/verification/`）

| 产物 | sha256 |
|---|---|
| `h1-phantom-key-stats.mjs`（P5b-4 收口后） | `63c5d51200b61394b4f4619f4666964b5a9782ef436c2507939d195884ad09c7` |
| `edge-diff-P4b-to-P5.json` | `fcd1d35f89fc91fe56902c237d65748b91b4d578d6b5f488f624d339ccf69812` |
| `edge-diff-P5off-to-P5.json` | `1c470363cd24887eb2752939e339e52b597bdd4243124044e816f5e4ff538bde` |
| `coverage-P5.json` | `013f21126f8642fab0e771be08c10b3241d476a352b6c55010b15369e578cbf0` |
| `P5-graph-quality.json` | `66a47e077426dd38e44466b15732452fcf3efe6855e5a00d1d6d31c55ca665ea` |
| `callsites-digest-P5.json`（global `37d6988d…b791`） | `a78f636436cda81ebd9aceaa1a2978cf079c10458d95a7753d1cd8f71f9ee053` |

### 不入库（scratchpad `<SP>/p5b/`，裁决 P2-4：大产物只留 sha256 + 生成命令）

| 产物 | sha256 |
|---|---|
| `art/graph-P5.json`（6.4 MB） | `b36f5278a561379b1e0b7437f9ff4c2967c730ac14a73c5502ee457ae1b38f41` |
| `art/graph-P5off.json`（**与上者逐字节相同**） | `b36f5278a561379b1e0b7437f9ff4c2967c730ac14a73c5502ee457ae1b38f41` |
| `art/exports-P5.json` | `c531cf476ced845600e84143332df4858a6849abceb9014a3986805a48a7b70d` |
| `art/callsites-P5.json`（23 MB） | `a16212a7ddc8c1332b0b43e9e13f084ea34e6e88b862a4d49f84781674ff6406` |
| `p5-mutants.mjs` | `85eaf1bebe61653c716ea108307c706319423f6f8ef74734da847a2c55c67d25` |
| `env-mutants.mjs` | `0081bf76a6581838bf40111d545abdd618bb8339c0140e41378b76ab5f315797` |
| `p4b-recheck-mutants.mjs` | `bd1ebd5db94664cfe56fa7dff60f2a31a3854ab1106a07c40acbad467f3ea9ce` |
| `mutation-run.mjs` | `1213bd0c2264a35e740e5571936dd02c292b5072e79412abf07ccc09b9db1273` |
| `mro-footprint.mjs` | `07c650110a2e605b808b310c5df0d9f2b4d79c00107673d36d626a81d44f7378` |
| `mro-callsite-probe.mjs` | `40cce034431549f8df7f4a6dc6297dad656046982d0b290e52ee9d09fb40d133` |
| `probe.mts`（抽取探针） | `c77df7377e5f181714bf77b63863d48afc044193de0bacebdc469a376050c344` |

### 复算命令（`<V>` = verification 目录，`<SP>` = scratchpad）

```bash
npm run build && node dist/cli/index.js --version      # 硬约束 + 确认跑本 worktree 产物

# P5（当前树）
node dist/cli/index.js batch --mode graph-only --output-dir <SP>/p5b/out-P5
cp <SP>/p5b/out-P5/_meta/graph.json <SP>/p5b/art/graph-P5.json
node <V>/dump-skeletons.mjs P5 && mv <V>/callsites-P5.json <V>/exports-P5.json <SP>/p5b/art/

# P5off（isTsJs 恒 false = 变异体 L04；跑后立即还原并重建 dist）
cp src/knowledge-graph/call-resolver.ts <SP>/p5b/call-resolver.P5.keep.ts
#   把 `const isTsJs = sk.language === 'typescript' || sk.language === 'javascript';` 换成 `= false;`
npm run build && node dist/cli/index.js batch --mode graph-only --output-dir <SP>/p5b/out-P5off
cp <SP>/p5b/out-P5off/_meta/graph.json <SP>/p5b/art/graph-P5off.json
cp <SP>/p5b/call-resolver.P5.keep.ts src/knowledge-graph/call-resolver.ts && npm run build

# 比较 / 验收
node <V>/edge-diff.mjs <SP>/f260-p4b-r2/art/graph-P4b.json <SP>/p5b/art/graph-P5.json \
  --phase P5 --skeletons <SP>/p5b/art/exports-P5.json [--json]
node <V>/edge-diff.mjs <SP>/p5b/art/graph-P5off.json <SP>/p5b/art/graph-P5.json \
  --phase P5 --skeletons <SP>/p5b/art/exports-P5.json --json
node <V>/coverage-metric.mjs <SP>/p5b/art/graph-P5.json
node dist/cli/index.js graph-quality --graph <SP>/p5b/art/graph-P5.json --json
node <V>/callsites-fingerprint.mjs --digest <SP>/p5b/art/callsites-P5.json
node <V>/h1-phantom-key-stats.mjs                      # W-E 重算器（含 P5b-4 三道闸）

# 特性足迹 / 变异测试（全在 scratchpad，仓库文件零改动）
node <SP>/p5b/mro-footprint.mjs "$(pwd)"
node <SP>/p5b/mro-callsite-probe.mjs "$(pwd)"
node <SP>/p5b/mutation-run.mjs "$(pwd)" <SP>/p5b/p5-mutants.mjs \
     src/knowledge-graph/call-resolver.ts tests/unit/knowledge-graph/call-resolver.test.ts
node <SP>/p5b/mutation-run.mjs "$(pwd)" <SP>/p5b/env-mutants.mjs \
     src/core/query-mappers/typescript-receiver-env.ts tests/unit/typescript-mapper-callsite.test.ts
node <SP>/p5b/mutation-run.mjs "$(pwd)" <SP>/p5b/p4b-recheck-mutants.mjs \
     src/core/query-mappers/typescript-receiver-env.ts tests/unit/typescript-mapper-callsite.test.ts
```

`impact` 硬断言跑法：把 `graph-P5.json` 复制到 `<SP>/p5b/impact-root-P5/specs/_meta/graph.json`
后直调 `dist/mcp/agent-context-tools.js::handleImpact({ target, direction:'upstream', depth:2, projectRoot })`，
返回体是 MCP 形状（`content[0].text` 里才是 JSON），**不覆写仓库图**。

---

## 6. 残余风险与未决项

| # | 项 | 状态 |
|---|---|---|
| 1 | P5 特性在本仓 0 自然实例 ⇒ 真实语料守护力只由用例承担 | 如实登记（§3.3），不掩饰 |
| 2 | R-16 解构默认值（`assignment_pattern`）同族 recall 问题 | 按裁决 P5b-3 **不修**，保持登记 |
| 3 | `edge-diff.mjs` 机械 FAIL 2 条 `depends-on` unclassified | 沿用裁决 P4b-1 人工通道，工具不改 |
| 4 | 断言 2 违规 1 条（函数 target） | 沿用裁决 P2-2 作用域限定 |
| 5 | Codex 对抗审查暂停，异构档位缺席 | 已在报告头标注，配额恢复后可回补 |
| 6 | N44 键集合探针耦合「两张表用 Map 承载」 | 已在用例注释登记；实现换容器会明红而非静默放行 |
| 7 | `h1` 严口径是词法级近似（正则字面量 / JSX 文本未处理），给的是**下界** | 已在脚本文件头登记 |
