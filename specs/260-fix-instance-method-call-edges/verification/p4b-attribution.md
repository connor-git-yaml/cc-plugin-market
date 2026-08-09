# F260 P4b 收口轮归因报告

> 承接 `plan.md` §13（v7，P3/P4 对抗审查裁决）的 **M1–M5 必修 CRITICAL** 与 **W-A–W-E WARNING**。
> P4b 不新增能力，只做**弃权面收口 + 归因工具收口 + 证据链收窄**。
>
> ⚠️ **审查档位：Codex 对抗审查暂停（配额耗尽），异构档位缺席。**
> 本轮改动含判定器性质的面（`edge-diff.mjs` 的 M4 分类闸），按 `CLAUDE.local.md` 顶部暂停节
> 的要求**显式标注档位缺席**，配额恢复后可回补 Codex 审查。
>
> ⚠️ **本轮为续接轮**：前一名实现代理在「M5 变异测试 15 个幸存体待分类」处因周配额中断。
> 其代码改动（M1/M2/M3/W-A/W-B/W-C + M4）已全部落盘且全绿，本轮**未重做**，只完成
> 剩余的验证与文档收口。本报告如实区分「承接既有」与「本轮新做」。

---

## 0. 本轮做了什么 / 没做什么

| 项 | 状态 | 备注 |
|---|---|---|
| M1 值级绑定进表 2 中毒 | 承接（前一代理落盘） | 本轮以 BEFORE/AFTER 探针独立复核（§4） |
| M2 静态方法 `this` 弃权 | 承接 | 同上 |
| M3 `type_parameter` 进表 1 | 承接 | 同上 |
| M4 `edge-diff.mjs` 双向判定 | 承接 | 本轮实跑验证其分类闸生效（§3.3） |
| W-A 类表达式桶弃权 | 承接 | 同上；且是本轮唯一在真实语料上产生实际收口的项（§2.3） |
| W-B 增广赋值 + 解构赋值左值 | 承接 | 同上 |
| W-C ts-morph / 正则兜底路径补测 | 承接 | 本轮实测其对图的投影（§3.2 的那 1 条 `depends-on`） |
| **M5 变异测试收尾** | **本轮完成** | 70 变异体 / 65 杀死 / 5 个实测证明等价 / **零「非等价 + 无杀手」**（§1） |
| **P4→P4b 归因重跑** | **本轮完成** | §2 / §3 |
| **W-D p3 §3.2 结论收窄** | **本轮完成** | 已写进 `p3-attribution.md` §3.2 修正注记 |
| **W-E P2 统计口径 + 重算器** | **本轮完成** | `h1-phantom-key-stats.mjs`；已写进 `p2-attribution.md` §3 修正注记 |
| P5（`buildClassMroIndex` / `stripGenericParams`） | **一行未碰** | 环境硬约束 5 |

---

## 1. M5 —— 变异测试收尾（本轮主交付）

### 1.1 方法论（plan §13 M5 定稿）

P3 的 19 个变异体是**从既有断言反推**的，证明的是「用例覆盖了自己针对的判据」而非
「判据都被覆盖」。P4b 按裁决要求**按被测模块 `typescript-receiver-env.ts` 的源码判据面
独立枚举**，禁止从断言反推。枚举维度是源码结构本身：

| 前缀 | 判据面 | 个数 |
|---|---|---|
| `S` | 4 个节点类型集合（`VALUE_/TYPE_ONLY_/NAMED_VALUE_EXPRESSION_/ASSIGNMENT_BINDING_TARGET_/THIS_REBINDING_`）的成员增删 | 12 |
| `U` | 8 个 AST 小工具（`stripParens` / `skipParenParents` / `isDynamicImportCall` / `isRequireCall` / `hasExtendsClause` / `classBucketName` / `memberHostBucket` / `classNameFromTypeAnnotation` / `classNameFromNewExpression` / `collectPatternNames`） | 16 |
| `D` | D2「import 来源」判据表两行（`declaratorValueIsImportSourced` / `paramIsImportThenFirstParam`） | 9 |
| `P` | 参数属性（`isParameterProperty` / `constructorPropertyHost`） | 4 |
| `B` | 两张表的写入与查询（`bindName` / `bindReceiver` / `bindValue` / `isSoleImportBinding`） | 10 |
| `V` | `visit()` 的 10 个 case 分支 | 10 |
| `T` | `resolveThisHostBucket` 的 5 条上溯弃权判据 | 5 |
| `Q` | `resolveCallSiteReceiver` 的 3 种接收者形态 | 4 |
| | **合计** | **70** |

plan §13 M5 点名必须覆盖的清单**逐条对位**（全部有对应变异体）：
类型参数遮蔽 `S07` / 非 `require` 裸调用初值 `D02` / 非 `import()` 的 await `D01` /
`.then` 非首参 `D04`·`D05`·`D08` / `interface`·`enum`·`type`·`namespace` 遮蔽
`S05`·`S02`·`S06`·`S04` / `for-in`·`catch`·箭头单形参·解构中毒 `V05`·`V04`·`V03`·`V01`/`V02` /
静态字段 `V06` / `const K = class Foo {}` `S08`+`U09` / `readonly` 参数属性 `P01` /
`stripParens` 剥到底 `U01`+`U02`。

### 1.2 跑法

跑批器 `mutation-run-r3.mjs`（scratchpad，sha256
`67c1f8598f574ec068c471815e98b014f0d48f0fa7c1d2b4bd7e4afebf3fff2e`），
变异体清单 `mutants.mjs`（sha256 `36e8405bc14329b1ed97eb1303c7e19677a7c43231140c42f3cfa94e627e79d1`）。
每个变异体：锚点替换（**每个锚点命中次数必须恰好 1**，否则报错并跳过）→ 跑
`npx vitest run tests/unit/typescript-mapper-callsite.test.ts tests/unit/knowledge-graph/call-resolver.test.ts`
→ 逐字还原源码。基线（PRISTINE）先跑，非全绿即中止。

- 基线：**204 tests / 0 failed**
- 收尾：`源码逐字还原: true`，且 `typescript-receiver-env.ts` 的 sha256 跑前跑后一致
  （`1a42f1d0f1242238d00e8dae8650f65cc227c103dddf1d17c7682562cd9e9880`）

> **如实登记的一处返工**：接手时 scratchpad 里那份「15 个幸存」的结果
> （`mutation-results-p4b.json`，18:33）是**陈旧**的 —— 测试文件在 18:35 才被前一代理补上
> N36–N41。用当前测试集重跑（r2）得 **62 杀死 / 8 存活**，其中 5 个是 N36–N41 已经杀死的。
> 本轮结论一律以重跑为准，不沿用陈旧数字。

### 1.3 结果：70 变异体 / 65 杀死 / 5 存活（全部实测证明等价）

| 变异体 | 被破坏的判据 | 结果 | 杀手用例 |
|---|---|---|---|
| `S01-drop-class-decl` | VALUE_DECLARATION_TYPES 去掉 class_declaration | ☠ 杀死 | M10, N3, R17 |
| `S02-drop-enum-decl` | 去掉 enum_declaration | ☠ 杀死 | N4, N23 |
| `S03-drop-function-decl` | 去掉 function_declaration | ☠ 杀死 | N2 |
| `S04-drop-namespace` | 去掉 internal_module（namespace） | ☠ 杀死 | N5, N24 |
| `S05-drop-interface` | TYPE_ONLY 去掉 interface_declaration | ☠ 杀死 | N21 |
| `S06-drop-type-alias` | TYPE_ONLY 去掉 type_alias_declaration | ☠ 杀死 | N22 |
| `S07-drop-type-parameter` | **M3 撤回**：去掉 type_parameter | ☠ 杀死 | N9, N10 |
| `S08-drop-class-expression` | NAMED_VALUE_EXPRESSION 去掉 class | ☠ 杀死 | N6, N24b |
| `S09-drop-function-expression` | 去掉 function_expression | ☠ 杀死 | N6b |
| `S10-assign-whitelist-widen` | **W-B 反向**：白名单放宽到 member_expression | ☠ 杀死 | N16 |
| `S11-assign-whitelist-narrow` | **W-B 撤回**：白名单收回到只认 identifier | ☠ 杀死 | N14, N15 |
| `S12-drop-this-rebind-fn-expr` | THIS_REBINDING 去掉 function_expression | ☠ 杀死 | N40 |
| `U01-stripParens-once` | stripParens 只剥一层 | ☠ 杀死 | N32 |
| `U02-stripParens-noop` | stripParens 完全不剥 | ☠ 杀死 | N32 |
| `U03-skipParenParents-once` | skipParenParents 只剥一层 | ☠ 杀死 | N33 |
| `U04-skipParenParents-noop` | skipParenParents 完全不剥 | ☠ 杀死 | N33 |
| `U05-dynamic-import-any-call` | isDynamicImportCall 放宽为任意 call | ☠ 杀死 | N18, N20 |
| `U06-require-any-identifier` | isRequireCall 放宽为任意 identifier | ☠ 杀死 | N17 |
| `U07-extends-always-false` | hasExtendsClause 恒 false | ☠ 杀死 | M12c |
| `U08-classBucket-accept-anonymous` | 匿名类不再弃权（常量桶名 `class`） | **存活** | **等价，见 §1.5** |
| `U09-classBucket-accept-class-expression` | **W-A 撤回**：重新接受类表达式 | ☠ 杀死 | N11 |
| `U10-classBucket-ignore-extends` | classBucketName 不再对 extends 弃权 | ☠ 杀死 | M12c |
| `U11-memberHost-accept-object` | memberHostBucket 不再要求 parent 是 class_body | **存活** | **等价，见 §1.5** |
| `U12-typeAnnotation-any-shape` | A5 放宽：任意类型节点取 text | ☠ 杀死 | M12d |
| `U13-typeAnnotation-drop-generic` | A5 收窄：移除 generic_type 分支 | ☠ 杀死 | M12d |
| `U14-newExpression-any-ctor` | H7 放宽：非裸 identifier 也取 text | ☠ 杀死 | M7 |
| `U15-collectPattern-pair-key` | pair_pattern 的 key 也当绑定名 | ☠ 杀死 | **N42（本轮补）** |
| `U16-collectPattern-property-id` | 不再跳过 property_identifier | ☠ 杀死 | **N43（本轮补）** |
| `D01-await-any` | 非 `import()` 的 await 也算 import 来源 | ☠ 杀死 | N18 |
| `D02-bare-call-is-require` | 任意裸调用初值都算 import 来源 | ☠ 杀死 | N17 |
| `D03-declarator-no-strip` | 初值判定不剥括号 | ☠ 杀死 | N32 |
| `D04-then-any-param-index` | `.then` 任意形参都算首参（formal_parameters 侧） | ☠ 杀死 | N19 |
| `D05-then-arrow-any-param` | 箭头单形参形态不再校验身份 | **存活** | **等价，见 §1.5** |
| `D06-then-any-method` | 不校验方法名是 `then` | ☠ 杀死 | N20b |
| `D07-then-any-receiver` | 不校验 `.then` 接收者是 `import()` | ☠ 杀死 | N20 |
| `D08-then-any-arg-index` | 回调不在首个实参位也放行 | ☠ 杀死 | N20c |
| `D09-then-no-paren-skip` | `.then` 回调不剥外层括号 | ☠ 杀死 | N33 |
| `P01-drop-readonly` | isParameterProperty 不认 `readonly` | ☠ 杀死 | N31 |
| `P02-drop-accessibility` | 不认 accessibility_modifier | ☠ 杀死 | N31b |
| `P03-param-property-always` | isParameterProperty 恒 true | ☠ 杀死 | N31d |
| `P04-drop-constructor-check` | 不再要求宿主方法名是 constructor | ☠ 杀死 | N31c |
| `B01-bindName-always-import` | bindName 恒记 fromImport | ☠ 杀死 | M10c, N17, N18, N19 …+3 |
| `B02-bindReceiver-no-poison` | 冲突时不中毒（保留先写的类型） | ☠ 杀死 | M8, M9, M9b, M12 …+9 |
| `B03-bindReceiver-null-not-poison` | 对 null 类型不中毒（**M1 承重点**） | ☠ 杀死 | M9, M9b, N12, N13 …+7 |
| `B04-bindValue-no-receiver` | **M1 撤回**：bindValue 不写表 2 | ☠ 杀死 | N1, N1b, N1c, N2 …+6 |
| `B05-import-bindName-only` | **M1 撤回（import 侧）** | ☠ 杀死 | N1, N1b, N1c |
| `B06-decl-bindName-only` | **M1 撤回（声明侧）** | ☠ 杀死 | N2, N3, N4, N5 …+3 |
| `B07-sole-total-ge1` | A1 放宽：`total === 1` → `>= 1` | ☠ 杀死 | M10, N9, N10, N21 …+4 |
| `B08-sole-fromimport-ge1` | A1 放宽：`fromImport === 1` → `>= 1` | **存活** | **等价，见 §1.5** |
| `B09-sole-fail-open` | A1 fail-open：零绑定也返回 true | ☠ 杀死 | M10c |
| `B10-sole-drop-import-requirement` | A1 不再要求来自 import | ☠ 杀死 | M10c, N17, N18, N19 …+3 |
| `V01-declarator-destructure-no-poison` | 变量解构绑定不再中毒 | ☠ 杀死 | N28 |
| `V02-param-destructure-no-poison` | 形参解构绑定不再中毒 | ☠ 杀死 | N29 |
| `V03-arrow-single-param-skip` | 箭头单形参整体不登记 | ☠ 杀死 | N27 |
| `V04-catch-skip` | catch 参数整体不登记 | ☠ 杀死 | N26 |
| `V05-forin-skip` | for-in/of 绑定整体不登记 | ☠ 杀死 | N25 |
| `V06-static-field-registered` | 静态字段也登记进实例桶 | ☠ 杀死 | N30 |
| `V07-field-host-null-ignored` | 宿主判不出时改用常量兜底桶名 | ☠ 杀死 | **N44（本轮补）** |
| `V08-drop-augmented-assignment` | **W-B 撤回**：增广赋值不算绑定点 | ☠ 杀死 | N12, N13 |
| `V09-assignment-skip` | A4 整体撤回 | ☠ 杀死 | M9b, N12, N13, N14 …+1 |
| `V10-ctor-property-second-bucket-skip` | 参数属性不登记 `ClassName#x` 桶 | ☠ 杀死 | N31, N31b |
| `T01-static-method-not-abstain` | **M2 撤回**：静态方法不再弃权 | ☠ 杀死 | N8 |
| `T02-static-block-not-abstain` | 静态块不再弃权 | ☠ 杀死 | M12g |
| `T03-this-rebinding-not-abstain` | 普通 function 重绑 this 不再弃权 | ☠ 杀死 | M12f, N40 |
| `T04-object-literal-not-abstain` | 对象字面量宿主不再弃权 | ☠ 杀死 | N36 |
| `T05-arrow-stops-uphill` | 箭头也当作重绑 this（上溯提前停） | ☠ 杀死 | N37 |
| `Q01-this-bare-hijack` | 形态 1 扩到裸 `this`（夺路） | **存活** | **等价，见 §1.5** |
| `Q02-this-field-host-fallback` | 形态 2 宿主判不出时用裸属性名当键 | ☠ 杀死 | N38 |
| `Q03-inner-not-this` | 形态 2 不再要求内层是 `this` | ☠ 杀死 | N39 |
| `Q04-new-expression-skip` | 形态 3（`new Foo().m()`）整体移除 | ☠ 杀死 | M6, M14 |

### 1.4 (b) 类：非等价 + 无杀手 ⇒ 本轮补的 3 条杀手用例

这是本轮**唯一**的代码改动面（`tests/unit/typescript-mapper-callsite.test.ts`，新增 describe
「绑定名收集边界：只有真正重绑的名字才算绑定点（N42–N44）」）：

| 变异体 | 为什么非等价（可达性论证） | 补的杀手 | 该用例钉住的不变量 |
|---|---|---|---|
| `U15` | `{ [sel.id]: picked }` 的 key 是 `computed_property_name`，其中的 `sel` 是**表达式**不是绑定名。移除 pair_pattern 短路后，泛型递归会把 `sel` 采成绑定名 ⇒ 同名形参被中毒 | **N42** | 解构**计算键**里的标识符不是绑定名 |
| `U16` | `for (rec.slot of xs)` 的左值是 `member_expression`（for-of 允许赋值目标），其 `slot` 是 `property_identifier`。不跳过它就会把 `slot` 误记为绑定点 | **N43** | 赋值型左值的**属性名**不是绑定名 |
| `V07` | 宿主判不出的字段若落到常量兜底桶，会与**真名恰为该常量的类**串桶（`class D extends Base` 的 `conn` 写进 `class anon` 的桶）⇒ 冲突中毒，白掉真边 | **N44** | 宿主判不出的字段必须**整条不登记** |

三条用例的 AST 形态均以 tree-sitter 探针实测确认（非凭记忆构造），三条各自 **1:1 干净归因**
（N42→U15、N43→U16、N44→V07，无交叉）。

> **N44 的诚实边界**：该杀手依赖变异体所选兜底常量恰为 `anon`。这不是巧合而是**结构必然** ——
> 「登记到共享兜底桶」这件事在**查表侧不可达**（查表侧走未变异的 `memberHostBucket`，
> 对同一批宿主照样返回 null），因此其唯一可观测通道就是与某个**真实同名类**的桶碰撞。
> 任何常量兜底都存在这样一个碰撞形态，N44 演示的就是该形态。

### 1.5 (c) 类：5 个等价变异体的等价性论证 + 实测

**实测器**：`equiv-probe.mts`（sha256 `64ef43264c9308593c04be60bf7692b4cde5d9e779cfb2fb67bb1016ee041c7f`）。
把 pristine 与变异副本**都从 scratchpad 加载**（**仓库文件零改动**），
对**同一棵 tree** 逐个 `member_expression` / `optional_member_expression` 调用
`resolveCallSiteReceiver`，比对返回值**逐字 JSON**。

语料 = **31 条合成样本 + 987 个全仓真实 `.ts`/`.mts`/`.cts` 文件 = 1018 棵树 / 78,579 个采点**
（扫 `src/` + `tests/` + `scripts/`，排除 `node_modules` / `dist` / `.d.ts`；
§3.4 的 A/B 探针另加扫 `specs/` 故为 1000 个文件 —— 两个数不同是**扫描范围不同**，非矛盾）。

| 变异体 | 等价性论证（结构可达性） | 实测分歧 |
|---|---|---|
| `U08` | `classBucketName` 的 `!name` 分支只在 `type` 已是 `class_declaration`/`abstract_class_declaration` 时可达。tree-sitter TS 语法下**匿名类根本不产生 class_declaration**：`export default class {}` 的节点类型是 `class`（类表达式，已被前置类型闸挡掉），`export default abstract class {}` 直接落 `ERROR` 节点。⇒ 该分支对匿名类不可达 | **0 / 78,579** |
| `U11` | 两者仅在「`memberNode.parent.type !== 'class_body'` 且 `classBucketName(parent.parent) !== null`」时分歧。`method_definition` 的 parent 只可能是 `class_body` 或 `object`；`public_field_definition` 的 parent 恒为 `class_body`。而 `class_declaration` 的成员容器**就是** `class_body`，故 parent 非 class_body 时 parent.parent 必非类声明 ⇒ 分歧条件不可达 | **0 / 78,579** |
| `D05` | 被删的身份校验位于 `else if (fn?.type === 'arrow_function')` 分支，该分支**只**由 `visit()` 的 `arrow_function` case 到达，而那里传入的 `paramNode` **按构造就是** `node.childForFieldName('parameter')` ⇒ 校验恒真。`required_parameter` 的 parent 恒为 `formal_parameters`，走另一分支 | **0 / 78,579** |
| `B08` | `bindName` 的不变量：`total` 每次 +1，`fromImport` 仅在其子集上 +1 ⇒ **`fromImport ≤ total` 恒成立**。在 `total === 1` 的前提下 `fromImport >= 1 ⟺ fromImport === 1` | **0 / 78,579** |
| `Q01` | 变异后对 `this` 节点查 `env.lookupReceiverType('this')`。表 2 的键来自「标识符绑定名」与 `` `${host}#${name}` ``，而 `this` 是保留字不能作声明名；TS 的 `this` 形参在语法树里节点类型是 **`this` 而非 `identifier`**，`collectPatternNames` 对它采不到任何名字 ⇒ 键 `'this'` **永不可能被登记** ⇒ 查表恒 `undefined` | **0 / 78,579** |

> #### ⚠️ 本轮踩到并记录的方法论坑：**等价性实测本身也会「真空绿」**
>
> `equiv-probe` 的**第一次**运行对全部 8 个幸存变异体都给出「0 分歧」，
> 差点把 `U15` / `U16` / `V07` 三个**真·非等价**变异体误判成等价。
>
> 根因：合成语料里虽然有 `const { [sel.id]: picked } = rec;` 这类**形态正确**的样本，
> 但被攻击的名字 `sel` **没有类型注解** —— pristine 与变异体在该点上同为 `undefined`，
> **分歧不可观测**。补上带类型注解的判别样本后，三者立刻现形（分歧 2 / 1 / 1）。
>
> **教训**：「变异体在语料上零分歧」只有在**语料含判别性样本**时才等于等价。
> 判别性 = 「若该判据真被破坏，输出必须在此样本上改变」。这与 F232 确立的
> 「判测试守护力用变异测试」是同一个坑的两层 —— 变异测试查用例的守护力，
> 而**等价性论证要查语料的判别力**。故上表每一行都同时给出**结构可达性论证**，
> 不单靠「0 分歧」这一个信号。

### 1.6 终态

**零「非等价 + 无杀手」**：70 个变异体中 65 个被杀死、5 个经**结构论证 + 78,579 采点实测**
双重确认为等价变异。达成 plan §13 M5 的终态要求。

---

## 2. 归因口径与基线

### 2.1 三个锚点

| 标签 | 定义 |
|---|---|
| **P4** | 前一轮收尾态（scratchpad `f260-p4/graph-P4.json`，建于 17:57） |
| **P4t** | **当前工作树**，但 `typescript-receiver-env.ts` 换回 P4 快照 —— 测试 / 工具 / 其余源码全同 P4b |
| **P4b** | 当前工作树（收口后终态） |

**为什么必须有 P4t**（承接裁决 P2-5 的既有方法论）：`tests/**` 与 `verification/*.mjs`
都会被采集进图。P4→P4b 之间同时发生了三件事 —— 源码收口、W-C 补测试、M4 改 `edge-diff.mjs`。
不切开就会把测试与工具自身的变化算进源码归因。

**P4t 的可构造性是实测确认的**：把 P4 源码快照（`f260-p4b/pristine-P4/`）与当前树逐文件比对，
**8 个文件里只有 `typescript-receiver-env.ts` 有差异（128 行）**，其余 7 个源码文件
与 `edge-diff.mjs` 均为 0 差异。故 P4t 只需换这一个文件，替换面最小且无歧义。

### 2.2 工具冻结

`edge-diff.mjs`（M4 收口）在取 P4b 基线**之前**已改完并冻结，P4t / P4b 两侧用的是**同一份**工具。
本轮**没有**再改任何 `verification/*.mjs`；新增的 `h1-phantom-key-stats.mjs` 是 W-E 的重算器，
它在两个基线取完**之后**才创建，不参与本轮任何 diff（登记在此避免下一轮误判）。

### 2.3 环境硬约束的执行

- 每次建图前 `npm run build`（退出码 0）；`node dist/cli/index.js --version` → `spectra v4.4.0 (0d3e385)`，
  确认跑的是**本 worktree 构建产物**而非 `PATH` 上的全局 `spectra`。
- `--output-dir` 一律指向 scratchpad，**未覆写** `specs/_meta/graph.json`。
- **全程零 git 写操作**（只用了 `git show HEAD:<file>` 只读核对）。
- 构造 P4t 时对 `typescript-receiver-env.ts` 的临时替换：跑前存副本、跑后还原，
  sha256 跑前跑后一致（`1a42f1d0…9880`）。变异测试同理，收尾 `源码逐字还原: true`。

---

## 3. 主锚点：逐边 diff

### 3.1 P4t → P4b（源码改动隔离口径）—— **零变化**

```
before 12882 边 / 3975 calls  →  after 12882 边 / 3975 calls
新增 0 条 {} / 减少 0 条 {}
retarget 对 0 / 不成对新增 calls 0 / 不成对减少 calls 0
新增边三分类: {retarget:0, new-symbol:0, new-endpoint-manual:0, phase-expected:0, unclassified:0}
结论（机械判据）: PASS
```

**M1/M2/M3/W-A/W-B 五项弃权收口在本仓语料上没有减少任何一条边，也没有增加任何一条边。**

这**不是**「收口没生效」，而是「收口关掉的假边形态在本仓不存在实例」。两条独立证据：

1. **§4 的 BEFORE/AFTER 探针**证明五项收口在各自的构造反例上**确实生效**（11/11 全部由出边转为闸断）。
2. **§3.4 的推断层 A/B** 证明在真实语料上确实有 4 处推断结论被改变，只是它们本来就
   过不了 D2b 的与门，所以在图上不可见。

> 这也顺带印证了 plan §13 M1 那三个反例是**构造样本**：它们描述的是一条**真实可达**的假边路径
> （§4 实测复现），但该形态在本仓 987 个 TS 文件里**没有自然实例**。
> 「本仓无实例」不构成「不必修」—— 判据是给所有用户仓库跑的。

### 3.2 P4 → P4b（原始口径，含测试与工具变化）

```
before 12881 边 / 3975 calls  →  after 12882 边 / 3975 calls
新增 1 条 {"depends-on":1} / 减少 0 条
calls 边：新增 0 / 减少 0
新增边三分类: {retarget:0, new-symbol:0, new-endpoint-manual:0, phase-expected:0, unclassified:1}
结论（机械判据）: **FAIL**（unclassified = 1）
```

**⚠️ 机械判据 FAIL，如实登记，未改判据、未改工具、未把违规项排除统计。**

唯一那条 unclassified 边：

| source | relation | target |
|---|---|---|
| `tests/unit/tree-sitter-fallback.test.ts` | `depends-on` | `src/core/tree-sitter-analyzer.ts` |

**人工回源码核对结论：真边，来自 W-C。** 证据：
- 当前文件 L9 `import { TreeSitterAnalyzer } from '../../src/core/tree-sitter-analyzer.js';`
- `git show HEAD:tests/unit/tree-sitter-fallback.test.ts | grep -c tree-sitter-analyzer` → **0**

即 W-C 要求「tree-sitter 兜底路径补一条走**真实抽取**的用例」，实现方式就是引入真实
`TreeSitterAnalyzer`，因而产生这条新的 `depends-on`。

**它被判 unclassified 是判据的已知边界，不是缺陷**：裁决 P2-1 的三分类是为 **calls** 边设计的
（retarget / 两端全新自证 / 阶段期望），一条两端都是既有节点的 `depends-on` 边在该分类体系里
无处可归。M4 收口后工具**拒绝**给它盖「已核实」的章，把它顶到人工面 —— 这正是 M4 想要的行为
（**fail-closed 而非 fail-open**）。故本项**不自行改判**，据实上报：
**机械 FAIL 一条，人工核对为真边，成因为 W-C 测试新增 import。**

### 3.3 M4 收口的实跑验证（本轮新增证据）

以 `P3t → P4b` 为口径（即 F260 新分支产出的完整边面）跑 `edge-diff.mjs`：

```
新增 calls 127 / 减少 calls 0 / retarget 0
新增边三分类: {retarget:0, new-symbol:18, new-endpoint-manual:6, phase-expected:125, unclassified:1}
```

**`new-endpoint-manual` 桶实际接住了 6 条边**（M4 之前它们会被「target 是本阶段新增符号」
一句话判成 `new-symbol` 自证边而**静默放行**）。6 条逐条回源码核对：

| # | source | relation | target | 源码证据 | 结论 |
|---|---|---|---|---|---|
| 1 | `call-resolver.ts::resolveCalls` | calls | `receiver-type-resolution.ts::buildReceiverTypeIndex` | `call-resolver.ts` L51 `export function resolveCalls(`，L60 `const receiverTypeIndex = buildReceiverTypeIndex(codeSkeletons);` | ✅ 真边 |
| 2 | `call-resolver.ts` | calls | `…::resolveReceiverTypeCall` | L530 `const receiverEdge = resolveReceiverTypeCall(cs, {` | ✅ 真边 |
| 3 | `call-resolver.ts` | depends-on | `receiver-type-resolution.ts` | L18/L19 两条 import | ✅ 真边 |
| 4 | `receiver-type-resolution.ts` | depends-on | `call-resolver.ts` | L24 `import type { CallSiteWithFile } from './call-resolver.js';` | ✅ 真边 |
| 5 | `receiver-type-resolution.ts` | depends-on | `unified-graph.ts` | L22 `import type { UnifiedEdge } from './unified-graph.js';` | ✅ 真边 |
| 6 | `receiver-type-resolution.ts` | depends-on | `code-skeleton.ts` | L21 `import type { CodeSkeleton } from '../models/code-skeleton.js';` | ✅ 真边 |

**6 / 6 全部核对为真。** M4 的价值不在于「抓出了假边」，而在于**把「未被归入 unclassified」
和「已核实为真」这两件事分开**了 —— 这 6 条以前是被自动盖章的。

`edge-diff.mjs --self-test` → **22 / 22 通过**（退出码 0），其中 M4 相关 5 条**直接复现了
审查方的构造攻击**：

| self-test 用例 | 覆盖的 fail-open 面 |
|---|---|
| `M4 — 单端新增（target 新 / source 旧）进人工核对清单而非自证` | 原缺陷主面 |
| `M4 — 单端新增时 verdict 标 notEvaluated 且明说 unclassified=0 不等于已核实` | 「未归类 ≠ 已核实」的语义分离 |
| **`M4 — 捏造假边（target 新）不得被机械层判成已核实`** | **审查方原始构造**：source 既有、target 指向新增符号的凭空假边 |
| `M4/W4 — 新文件调用既有符号不得被误判 unclassified` | 反向假阳性（W4） |
| `M4 — 两端全新才算「新符号自证」，且不产生 notEvaluated` | 收紧后判据的正向边界 |

同口径下 `assertion2` 仍有 **2 条违规**（与 P4 报告 §5.4 记录的**同两条**，非本轮新增）：

| source | target | 工具给的理由 |
|---|---|---|
| `call-resolver.ts::resolveCalls` | `…::buildReceiverTypeIndex` | `symbol 节点 exportKind=function` |
| `call-resolver.ts` | `…::resolveReceiverTypeCall` | `symbol 节点 exportKind=function` |

按裁决 P2-2，断言 2 的作用域限定为「**新分支产出的边**」，而这两条是**普通函数调用**
（F242 既有 callsite 面产出，不经 F260 新分支），属判据作用域外的误报。**本轮不改判据**，
沿用 P4 报告的处置：如实登记，交编排器。

### 3.4 推断层 A/B（比图边更敏感的仪器）

图边要过 D2b 六道与门，推断层的差异可能被吞掉。故用
`ab-receiver-env.mts`（sha256 `e89b5339…2528`）直接比对 P4 版与 P4b 版
`typescript-receiver-env.ts` 在**全仓 1000 个文件 / 78,592 个 member 采点**上的推断结论：

```
文件 1000 / member 采点 78592 / 分歧 4
{ "A出结论→B弃权(假边面收口)": 4 }
```

**4 处分歧、方向 100% 一致（全是收紧），零 recall 损失**（无「A弃权→B出结论」，无「结论不同」）。

四处逐条归因 —— **全部归于 W-A（类表达式桶弃权）**：

| # | 文件 | 位置 | P4 | P4b |
|---|---|---|---|---|
| 1 | `tests/integration/mcp-batch-graph-only.test.ts` | 52:6 `this.tools.push` | `receiverType=Array, sole=false` | 弃权 |
| 2 | `tests/unit/mcp-server.test.ts` | 36:6 `this.tools.push` | 同上 | 弃权 |
| 3 | `tests/unit/mcp/response-contract.test.ts` | 42:6 `this.tools.push` | 同上 | 弃权 |
| 4 | `tests/unit/mcp/telemetry-coverage.test.ts` | 38:6 `this.tools.push` | 同上 | 弃权 |

四处是**同一个惯用法**：`vi.hoisted(() => ({ FakeMcpServer: class FakeMcpServer { … } }))` ——
`class FakeMcpServer {…}` 出现在赋值右侧，节点类型是 `class`（**类表达式**）而非 `class_declaration`。
W-A 让 `classBucketName` 对类表达式弃权，于是 `FakeMcpServer#tools` 桶不再建立。

**为什么图上看不到**：这四处的 `soleImportBinding` 本来就是 `false`（`Array` 是内建名，
零 import 绑定点 ⇒ A1 fail-closed），D2b 条件 ③ 早已把它们闸断。
换言之 W-A 在这里是**第二道闸**，收的是「推断出 `receiverType=Array` 这种垃圾结论」本身。

### 3.5 callSites 指纹（`P4 → P4b`，按 W-D 收窄后的正确读法）

```
主口径（含 line/column）:  123260 → 123658 条；新增 826 / 减少 428
位置无关口径（6 语义字段）: 新增 498 / 减少 100 / zeroDiff = false
```

位置无关口径的差异**全部落在 6 个文件内，且这 6 个文件正是 P4→P4b 之间被改动的那 6 个**
（计数已核对完整：498 = 37+15+29+31+110+276，100 = 4+5+0+0+91+0，清单未被 `--limit` 截断）：

| 文件 | 新增 / 减少 | 归因 |
|---|---|---|
| `verification/edge-diff.mjs` | 37 / 4 | **M4** 工具改动（该工具自身进图） |
| `src/core/query-mappers/typescript-receiver-env.ts` | 15 / 5 | **M1/M2/M3/W-A/W-B** 源码收口 |
| `tests/unit/typescript-mapper-callsite.test.ts` | 276 / 0 | N 系列用例新增（含本轮 N42–N44） |
| `tests/unit/tree-sitter-fallback.test.ts` | 110 / 91 | **W-C** 补真实抽取用例（重写幅度较大） |
| `tests/unit/knowledge-graph/call-resolver.test.ts` | 31 / 0 | R 系列用例新增 |
| `tests/unit/ast-analyzer.test.ts` | 29 / 0 | **W-C** 补 `namedImportBindings` 用例 |

⇒ **全仓其余 1144 个产出过 callSite 的文件（1150 − 6），其既有 callSite 的 6 个语义字段逐字未变。**
（`callsites-P4b.json`：采集 1301 个骨架文件、其中 1150 个产出过 callSite、共 123,658 条。）

> **按 W-D 的口径如实读这条结论**：位置无关口径是多重集，对「同文件内两条 callSite 语义字段互换」
> 守恒，故上面这句只覆盖**未改动文件**。对上述 6 个被改动文件，本证据链**不排除**内部语义置换；
> 它们的语义保真由 §1 的变异测试（70 体 / 65 杀）、§3.4 的推断层 A/B（78,592 采点 / 4 处分歧全部定向）
> 与 §4 的反例探针共同承担。这正是 W-D 要求的表述收窄，此处不再复述过强版本。

---

## 4. plan §13 反例的 BEFORE / AFTER 实证

探针 `counterexample-probe.mts`（sha256 `04449cf7…615f`）**同时加载**两份
`typescript-receiver-env.ts` 副本（P4 快照 / P4b 当前），对同一份代码片段跑
`buildReceiverTypeEnv` + `resolveCallSiteReceiver`，**不改动仓库文件**。

判「是否还会出边」的口径：D2b 条件 ③ 消费的是 `soleImportBinding === true`，
故 `弃权` 与 `sole=false` 都等于闸断。

| 反例（plan §13 原文） | BEFORE (P4) | AFTER (P4b) | 还会出边？ |
|---|---|---|---|
| **M1-a** import 绑定（`logger`） | `receiverType=A, sole=true` | **弃权** | 否 |
| **M1-b** 函数声明（`send`） | `receiverType=A, sole=true` | **弃权** | 否 |
| **M1-c** 本地 class（`Local`）— 净回归钉 | `receiverType=A, sole=true` | **弃权** | 否 |
| **M1-d** enum（`Level`） | `receiverType=A, sole=true` | **弃权** | 否 |
| **M1-e** namespace（`NS`） | `receiverType=A, sole=true` | **弃权** | 否 |
| **M2** 静态方法 `this.x` 查实例字段桶 | `receiverType=A, sole=true` | **弃权** | 否 |
| **M3-a** 函数级类型参数遮蔽 | `receiverType=Foo, sole=true` | `receiverType=Foo, **sole=false**` | 否 |
| **M3-b** 类级类型参数遮蔽 | `receiverType=Foo, sole=true` | `receiverType=Foo, **sole=false**` | 否 |
| **W-A** 类表达式同名桶串台 | `receiverType=A, sole=true` | **弃权** | 否 |
| **W-B-1** `\|\|=` 重绑 | `receiverType=A, sole=true` | **弃权** | 否 |
| **W-B-2** 解构赋值重绑 | `receiverType=A, sole=true` | **弃权** | 否 |

**11 / 11 修前全部 `sole=true`（会产出假边），修后全部闸断。**

> **M3 的收口形态与其他项不同，如实说明**：M3 走的是**表 1**（绑定点计数），
> 泛型形参 `Foo` 进表 1 后使 `total=2`，A1 判 `false`。`receiverType` 仍是 `Foo`
> （表 2 侧的形参类型注解没变），但 D2b 条件 ③ 拿不到 `sole=true` ⇒ 不出边。
> plan §13 写的「退化为弃权」在 M3 上应读作「**A1 闸断**」，而非「receiverType 消失」。

---

## 5. 验收硬断言与覆盖率

### 5.1 硬断言 1（§7.1）—— **PASS**

`impact(direction=upstream, depth=2)` on
`src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes`，
跑法为把 P4b 图复制到 `<SP>/impact-root-P4b/specs/_meta/graph.json` 后直调
`dist/mcp/agent-context-tools.js::handleImpact`（**不覆写仓库图**）：

```json
{ "error": null, "warnings": [], "affectedCount": 30,
  "hasBatchOrchestrator": true, "hasGraphAssembly": true }
```

两个必须存在的调用者均在列：
- `src/batch/batch-orchestrator.ts::runBatch`
- `src/batch/stages/graph-assembly.ts::buildAstGraphOnly`

⇒ **M1 的中毒扩面没有误伤该断言**。（若被误伤，按任务约束应停下报告而非放宽 M1；本项未触发。）

### 5.2 覆盖率（§7.1 断言 5）—— **PASS**

| 指标 | P4 | P4b | 判定 |
|---|---|---|---|
| `methodCoveragePct` | 45.6% | **45.6%** | 下限 `max(40.0%, U×0.75) = max(40.0%, 34.2%) = 40.0%` ⇒ 通过 |
| `gapPct` | 43.8% | **43.8%** | 未劣化 |
| `gapRatio` | 1.96 | **1.96** | 未劣化 |
| `functionCoveragePct` | 89.4% | **89.4%** | 未劣化 |
| `methodWithInEdge / methodNodes` | 236 / 517 | **236 / 517** | 逐字一致 |

覆盖率**逐字未变**，与 §3.1「零边变化」互相印证，无矛盾。

### 5.3 图质量六指标 —— **不劣于 P4**

`graph-quality --graph graph-P4b.json --json` → `overallVerdict = **pass**`。
与 `P4-graph-quality.json` 逐字段比对，**唯三差异**是 `graphPath` / `generatedAt` /
`freshness.dirtyFiles`（均为环境噪声），六个门的判定与数值**完全一致**。

---

## 6. 抽样核对（≥20 条，重抽）

**抽样口径**：从 `P3t → P4b` 的 **125 条 `phase-expected`**（F260 新分支产出）边池中，
用 `sample-edges.mjs`（sha256 `6032a071…6a64`）以 **mulberry32 固定种子 4260**
（P4 用的是 python `random.seed(260)`，本轮**换种子重抽**）洗牌后取前 **22** 条，
**不做任何人工筛选、不挑好核的**。与 P4 的 22 条样本**仅 1 条重合**（#17）。

| # | source | target | 源码证据 | 结论 |
|---|---|---|---|---|
| 1 | `tests/panoramic/anchoring/providers/local-provider.test.ts` | `…/local-provider.ts::LocalEmbeddingProvider.embed` | L43 `new LocalEmbeddingProvider()`；L44/59 `provider.embed(…)` | ✅ 真边 |
| 2 | `…/architecture-overview-generator.ts::ArchitectureOverviewGenerator.extract` | `…/workspace-index-generator.ts::WorkspaceIndexGenerator.extract` | L63 `const workspaceGenerator = new WorkspaceIndexGenerator();`；L80 `await workspaceGenerator.extract(context)` | ✅ 真边 |
| 3 | `…/batch-project-docs.ts::generateBatchProjectDocs` | `…/cache-manager.ts::CacheManager.initialize` | L199 `new CacheManager(`；L203 `await cacheManager.initialize(…)` | ✅ 真边 |
| 4 | `…/component-view-builder.ts::ComponentViewBuilderGenerator.extract` | `…/architecture-ir-generator.ts::ArchitectureIRGenerator.generate` | L950 `this.irGenerator = new ArchitectureIRGenerator();`；L962 `await this.irGenerator.generate(irInput)` | ✅ 真边（`this.x` 分桶） |
| 5 | `…/toml-config-parser.ts::parseTomlContent` | `…/comment-tracker.ts::CommentTracker.append` | L49 `new CommentTracker()`；L63 `tracker.append(commentText)` | ✅ 真边 |
| 6 | 同上 | `…::CommentTracker.reset` | L56/71/78 `tracker.reset()` | ✅ 真边 |
| 7 | `scripts/eval-validate.mjs` | `scripts/lib/parallel-run-pool.mjs::ParallelRunPool.run` | L335 `new ParallelRunPool({`；L346 `await pool.run(jobs)` | ✅ 真边 |
| 8 | `tests/panoramic/cache/content-hasher.test.ts` | `…/content-hasher.ts::ContentHasherImpl.hashFiles` | L23 `new ContentHasherImpl()`；L147–149 `await hasher.hashFiles([…])` | ✅ 真边 |
| 9 | `…/pattern-hints-generator.ts::PatternHintsGenerator.extract` | `…::ArchitectureOverviewGenerator.extract` | L45 `private readonly architectureOverviewGenerator`；L61 `await this.architectureOverviewGenerator.extract(context)` | ✅ 真边（`this.x` 分桶） |
| 10 | `tests/panoramic/config-reference-generator.test.ts` | `…/config-reference-generator.ts::ConfigReferenceGenerator.isApplicable` | L355 `new ConfigReferenceGenerator()`；L373/379/385 `generator.isApplicable(ctx)` | ✅ 真边 |
| 11 | `src/debt-scanner/index.ts::describeScannedLanguages` | `…/language-adapter-registry.ts::LanguageAdapterRegistry.getAllAdapters` | L199 `export function describeScannedLanguages(`，L203 `const adapters = registry.getAllAdapters();`（同文件 L185 另有一处属 `resolveAllowedExtensions`，归属正确未串） | ✅ 真边 |
| 12 | `src/batch/generic-language-skeleton-collector.test.ts` | `…/java-adapter.ts::JavaLanguageAdapter.analyzeFile` | L139 `const realAdapter = new JavaLanguageAdapter();`；L150 `realAdapter.analyzeFile(filePath, options)` | ✅ 真边 |
| 13 | `tests/panoramic/cache/content-hasher.test.ts` | `…::ContentHasherImpl.hashContent` | L158/159 `hasher.hashContent('test content')` | ✅ 真边 |
| 14 | `src/panoramic/query.ts::queryPanoramic` | `…/cross-package-analyzer.ts::CrossPackageAnalyzer.generate` | L77 `const analyzer = new CrossPackageAnalyzer();`；L86 `await analyzer.generate(input)` | ✅ 真边 |
| 15 | `src/batch/batch-orchestrator.ts::runBatch` | `…/coverage-auditor.ts::CoverageAuditor.audit` | L1571 `new CoverageAuditor()`；L1572 `await coverageAuditor.audit({` | ✅ 真边 |
| 16 | `tests/unit/graph-query-tokenize.test.ts` | `…/graph-query.ts::GraphQueryEngine.query` | L115 `new GraphQueryEngine(graph)`；L116 `engine.query('PQueue')` | ✅ 真边 |
| 17 | `tests/adapters/ts-js-adapter-equivalence.test.ts` | `…/ts-js-adapter.ts::TsJsLanguageAdapter.analyzeFile` | L28 `new TsJsLanguageAdapter()`；L51 `await adapter.analyzeFile(filePath)` | ✅ 真边（与 P4 样本唯一重合项） |
| 18 | `plugins/spec-driver/tests/orchestration-resolver.test.mjs` | `plugins/spec-driver/lib/orchestrator.mjs::Orchestrator.getPhases` | L454 `const orch = new Orchestrator({…})`；L455 `orch.getPhases()` | ✅ 真边（`.mjs` 侧，F243 扩展名面） |
| 19 | `tests/fixtures/ky/src/index.ts::ky` | `tests/fixtures/ky/src/core.ts::Ky.execute` | L15 `const client = new Ky(url, options);`；L16 `client.execute()` | ✅ 真边 |
| 20 | `src/batch/batch-orchestrator.ts::runBatch` | `…/delta-regenerator.ts::DeltaRegenerator.plan` | L389 `const deltaRegenerator = new DeltaRegenerator();`；L390 `await deltaRegenerator.plan({` | ✅ 真边 |
| 21 | `src/batch/generic-language-skeleton-collector.test.ts` | `…::JavaLanguageAdapter.getTestPatterns` | L139 `const realAdapter = new JavaLanguageAdapter();`；L153 `getTestPatterns: () => realAdapter.getTestPatterns(),` | ✅ 真边 |
| 22 | `src/panoramic/query.ts::queryPanoramic` | `…::CrossPackageAnalyzer.isApplicable` | L77 `new CrossPackageAnalyzer()`；L78 `analyzer.isApplicable(context)` | ✅ 真边 |

**22 / 22 全部核对为真实调用点，假边 0 条。**
覆盖形态：局部变量（1,3,5–8,10,12,13,15,16,17,18,19,20,21,22）、
类实例字段 `this.x`（2,4,9）、参数注入（11)、跨包（`scripts/`→`scripts/lib/`、
`tests/`→`src/`、`plugins/` 内 `.mjs`）。

**连同 §3.3 的 6 条 `new-endpoint-manual`，本轮共人工回源码核对 28 条边，全部为真。**

---

## 7. 门禁（§7.2）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 构建 | `npm run build` | **0** | — |
| 全量单测 | `npx vitest run` | **0** | `Test Files 523 passed \| 4 skipped (527)`；`Tests **7273 passed** \| 18 skipped \| 21 todo (7312)`，**零失败** |
| 插件测试 | `npm run test:plugins` | **0** | `pass 1580 / fail 0` |
| 仓库校验 | `npm run repo:check` | **0** | 1 条预先存在的 warning（见下） |
| 发布合同 | `npm run release:check` | **0** | `Release contract valid` |
| 图质量 | `graph-quality --graph graph-P4b.json` | — | `overallVerdict = pass`，六指标不劣于 P4 |

**用例数对账**：P4 收尾为 `7270 passed`（编排器实测），本轮新增 **N42 / N43 / N44 共 3 条**
⇒ `7270 + 3 = 7273`，与实跑数字**逐字一致**，**没有失败被跳过或屏蔽**。

**`repo:check` 的 warning（预先存在，与 P4b 无关）**：

```
[graph-quality] 图产物已 stale（source-commit）：图记录的 sourceCommit（dfe6c479…）
与当前 HEAD（0d3e385f…）不一致
```

指 `specs/_meta/graph.json`（建于 `dfe6c479`），本轮全程未触碰（建图一律走 `--output-dir`
到 scratchpad）。与 P4 报告 §10 记录的是**同一条**，属 R-7 已登记现象。

---

## 8. 不入库大产物：sha256 与生成命令（裁决 P2-4）

留在 scratchpad `<SP>/f260-p4b-r2/`，清单同时写入该目录 `SHA256SUMS.txt`。

| 文件 | sha256 |
|---|---|
| `art/graph-P4b.json` | `016b079cc2517f4ed702cf9c326165deddb38644d68c92a63fcbebf5a012aa03` |
| `art/graph-P4t.json` | `b95afda47cf5a93fb583143c8d8179cb29387810c81d9d050475ca7fd24fdd9b` |
| `art/callsites-P4b.json` | `0d195808a54b0fa929473fb0925c7b501b088f6a8beeec00a75a50542803085b` |
| `art/exports-P4b.json` | `ed5c743404c4ef2ace6c869941bf9dbacdb1663a7024d5a4ef417032c7304989` |
| `art/sample22-P4b.json` | `921cc0672289fffdedfdafd1e4d0444ba7b79762d30a9af2fa817b69b86e6240` |
| `mutants.mjs`（70 变异体清单） | `36e8405bc14329b1ed97eb1303c7e19677a7c43231140c42f3cfa94e627e79d1` |
| `mutation-run-r3.mjs`（跑批器） | `67c1f8598f574ec068c471815e98b014f0d48f0fa7c1d2b4bd7e4afebf3fff2e` |
| `equiv-probe.mts`（等价性实测器） | `64ef43264c9308593c04be60bf7692b4cde5d9e779cfb2fb67bb1016ee041c7f` |
| `ab-receiver-env.mts`（推断层 A/B） | `e89b5339b5c99437ead9c8e89160bb1391cbe2a5b3b6cc50f184801957132528` |
| `counterexample-probe.mts`（§13 反例 BEFORE/AFTER） | `04449cf794d78f515c8fe5a0465c06a5271add26edf522ee9e053c491d09615f` |
| `sample-edges.mjs`（固定种子抽样器） | `6032a071da68dc3bc3008906d0fe01e021ee066e97e44bcd6dab3c0913b34a64` |

`P4` 侧基线沿用 `f260-p4/` 的既有产物（sha256 见 `p4-attribution.md` §9），本轮未重取。

**入库的小产物**（沿用 P0–P4 的既有惯例，均 < 200 KB）：

| 文件 | 内容 |
|---|---|
| `verification/coverage-P4b.json` | 覆盖率重算结果 |
| `verification/P4b-graph-quality.json` | 图质量六指标 |
| `verification/callsites-digest-P4b.json` | 每文件 sha256 摘要（global `48fee7a1362b0e16fefde36c5240b4a5f71a68e6280d65b019a9b7c2d5dfcd8a`） |
| `verification/edge-diff-P4t-to-P4b.json` | §3.1 源码隔离口径（零变化） |
| `verification/edge-diff-P4-to-P4b.json` | §3.2 原始口径（1 条 depends-on） |
| `verification/edge-diff-P3t-to-P4b.json` | §3.3 新分支完整边面（M4 分桶证据） |
| `verification/sample22-P4b.json` | §6 抽样的 22 条边（可复算） |
| `verification/h1-phantom-key-stats.mjs` | **W-E 重算器**（本轮新增工具，见 §2.2 关于它不参与本轮 diff 的说明） |

生成命令（`<V>` = `specs/260-fix-instance-method-call-edges/verification`，`<SP>` = scratchpad）：

```bash
npm run build                                                  # 硬约束：先建 dist
node dist/cli/index.js --version                               # 确认跑本 worktree 产物

# P4b（当前树）
node dist/cli/index.js batch --mode graph-only --output-dir <SP>/f260-p4b-r2/out-P4b
cp <SP>/f260-p4b-r2/out-P4b/_meta/graph.json <SP>/f260-p4b-r2/art/graph-P4b.json
node <V>/dump-skeletons.mjs P4b && mv <V>/callsites-P4b.json <V>/exports-P4b.json <SP>/f260-p4b-r2/art/

# P4t（换回 P4 版 typescript-receiver-env.ts，建完立即还原并重建 dist）
cp src/core/query-mappers/typescript-receiver-env.ts <SP>/f260-p4b-r2/P4b-receiver-env.keep.ts
cp <SP>/f260-p4b/pristine-P4/src/core/query-mappers/typescript-receiver-env.ts src/core/query-mappers/
npm run build && node dist/cli/index.js batch --mode graph-only --output-dir <SP>/f260-p4b-r2/out-P4t
cp <SP>/f260-p4b-r2/out-P4t/_meta/graph.json <SP>/f260-p4b-r2/art/graph-P4t.json
cp <SP>/f260-p4b-r2/P4b-receiver-env.keep.ts src/core/query-mappers/typescript-receiver-env.ts
npm run build

# 比较 / 验收
node <V>/edge-diff.mjs <SP>/f260-p4b-r2/art/graph-P4t.json <SP>/f260-p4b-r2/art/graph-P4b.json \
  --phase P4 --skeletons <SP>/f260-p4b-r2/art/exports-P4b.json
node <V>/edge-diff.mjs <SP>/f260-p4/graph-P4.json <SP>/f260-p4b-r2/art/graph-P4b.json \
  --phase P4 --skeletons <SP>/f260-p4b-r2/art/exports-P4b.json --json
node <V>/coverage-metric.mjs <SP>/f260-p4b-r2/art/graph-P4b.json
node dist/cli/index.js graph-quality --graph <SP>/f260-p4b-r2/art/graph-P4b.json --json
node <V>/h1-phantom-key-stats.mjs                               # W-E 重算器（入库）

# 变异 / 等价 / 反例 / 抽样（全在 scratchpad，仓库文件零改动）
node   <SP>/f260-p4b-r2/mutation-run-r3.mjs "$(pwd)"
npx tsx <SP>/f260-p4b-r2/equiv-probe.mts "$(pwd)" "<8 个幸存变异体 id，逗号分隔>"
npx tsx <SP>/f260-p4b-r2/ab-receiver-env.mts "$(pwd)" \
  <SP>/f260-p4b/pristine-P4/src/core/query-mappers/typescript-receiver-env.ts \
  src/core/query-mappers/typescript-receiver-env.ts
npx tsx <SP>/f260-p4b-r2/counterexample-probe.mts "$(pwd)" <同上两个文件>
node   <SP>/f260-p4b-r2/sample-edges.mjs <SP>/f260-p4b-r2/art/edge-diff-P3t-to-P4b.json \
       <SP>/f260-p4b-r2/art/sample22-P4b.json
```

`impact` 硬断言跑法同 `p4-attribution.md` §9（复制图到 `<SP>/impact-root-P4b/specs/_meta/graph.json`
后直调 `handleImpact`，不覆写仓库图）。

---

## 9. W-D / W-E 的落地位置

| 项 | 落点 | 形态 |
|---|---|---|
| **W-D** | `p3-attribution.md` §3.2 末尾「⚠️ P4b 修正注记」 | **原文保留不删**，追加收窄注记：结论收窄为「全仓**未改动文件**的既有 callSite 逐字未变」；对被改动的 3 个文件明确写出「当前证据链**不能**排除语义置换」，并指出该缺口由用例集 + 变异测试这条独立证据链承担 |
| **W-E** | `p2-attribution.md` §3 末尾「⚠️ P4b 修正注记」 + 新增 `verification/h1-phantom-key-stats.mjs` | 落了**可重跑重算器**（实跑输出与原文 36/37/24/32/35 **逐字一致**）；写清三件事（文件清单来源 = 采集器同源共 1239 文件 / 不含 gitignore / **含** type-only 且分列 3 : 34）；并按要求更正强度表述 |

**W-E 强度更正的实测数**：32 个幽灵键中 **22 个**在同文件内确实存在同名标识符
⇒ 「文件里恰好有别的东西叫那个名字」**并不罕见**，「其余 31 个是已关闭的潜在假边面」
方向成立但强度被高估。
（plan §13 W-E 记的是 26 个，本轮重算口径给出 22 个；差异来自「同名标识符」判法不同 ——
本轮用原文词边界正则计数、含注释与字符串字面量。两个数字支撑同一方向性结论，
故不追平数字，只把本轮口径固化进脚本以便复算。如实登记，不掩饰。）

---

## 10. 本轮未做 / 待编排器裁决的事

1. **§3.2 的机械判据 FAIL（`unclassified = 1`）未自行改判。** 那条
   `tests/unit/tree-sitter-fallback.test.ts --depends-on--> src/core/tree-sitter-analyzer.ts`
   已人工核对为 W-C 引入的真边。是否把裁决 P2-1 的三分类扩展到 `depends-on` 边，属判据变更，
   交编排器。
2. **§3.3 的 `assertion2` 2 条违规未自行改判。** 与 P4 报告 §5.4 记录的是同两条，
   成因是判据作用域（裁决 P2-2 限定为「新分支产出的边」）与工具实现口径的偏差，非本轮新增。
3. **Codex 对抗审查缺席。** 配额耗尽，按 `CLAUDE.local.md` 暂停节，本轮属
   「门禁 / 判定器类」（`edge-diff.mjs` 的 M4 分类闸），**须显式标注档位缺席**，
   已标注在本报告页首。**本轮未跑独立子代理异构对抗复审** —— 这是一个如实登记的缺口，
   建议在 commit 前补上（≥2 个不同切入角）或在配额恢复后回补 Codex。
4. **P5 未开工**（`buildClassMroIndex` / `stripGenericParams`），按任务约束一行未碰。
5. **`sameFileNameCollisions` 的 22 vs 26 口径差**已登记（§9），未追平。
