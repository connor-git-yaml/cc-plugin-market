# F260 P3 A/B 归因报告 + 变异测试报告

> 本文件只记录**实跑得到的**数字与逐条核对结论，不写推测。
> 入库工具产物：`edge-diff-P2t-to-P3.json` / `callsites-fingerprint-P2t-to-P3.json` /
> `callsites-fingerprint-positionfree-P2t-to-P3.json` / `callsites-digest-P2t.json` /
> `callsites-digest-P3.json` / `P2t-graph-quality.json` / `P3-graph-quality.json` /
> `coverage-P2t.json` / `coverage-P3.json`。
> 大体积产物（`graph-P*.json` / `callsites-P*.json` / `exports-P*.json`）按裁决 P2-4 不入库，
> sha256 与生成命令见 §7。

---

## 0. 本轮收口的缺陷（先核实、再动手）

上一名 P3 实现代理中途终止，磁盘上留下的实现有**一处确切缺陷**，主线程编排器已定位，本轮先独立复核后再修。

**缺陷**：A3 的宿主分桶只做了一半 —— **注册侧**已按 `host != null` 做宿主判定（对象字面量方法 /
匿名类 / 带 `extends` 的类不登记），但**键仍是扁平的 `` `this.${x}` ``；**查表侧**
`resolveCallSiteReceiver` 的「形态 2」也查扁平键，**从未调用**文件里已写好的
`resolveThisHostBucket()`。⇒ 跨类同名实例字段串台没有被拦住。

**复核证据**（修改前）：

```
npx vitest run tests/unit/typescript-mapper-callsite.test.ts
→ Tests  1 failed | 57 passed (58)
  × M12b — A3 `this.x` 跨类串台：对象字面量方法宿主一律弃权
    AssertionError: expected 'Foo' to be undefined
```

**修复**（`src/core/query-mappers/typescript-receiver-env.ts`，三处同源改动）：

| 位置 | 改动 |
|---|---|
| `required_parameter` 分支（构造器参数属性） | 登记键 `` `this.${x}` `` → `` `${host}#${x}` `` |
| `public_field_definition` 分支（实例字段） | 登记键 `` `this.${x}` `` → `` `${host}#${x}` `` |
| `resolveCallSiteReceiver` 形态 2（查表侧） | 先 `resolveThisHostBucket(objectNode)`，**宿主判不出即弃权**，再查 `` `${host}#${x}` `` |

注册侧与查表侧现在**同源分桶**：两侧用的是同一条 `classBucketName` / `memberHostBucket` 判据链。

**⚠️ 前一名代理的 scratchpad 里存有一份 `receiver-env.orig.ts`，其内容与本轮修复结果在三处改动上一致。**
本轮**没有**直接拷贝它 —— 修复是独立复核判据后手写的，事后 diff 才发现除一条新增注释外逐字相同。
这条留痕是为了说明：本轮结论不依赖于那份来源不明的快照。

---

## 1. 变异测试报告（本轮主交付之一）

### 1.1 为什么做

M12c（宿主带 `extends` ⇒ 弃权）在缺陷修复**之前**就是绿的，但它绿的原因可能是
「注册侧因 `hasExtendsClause` 返回 null 而从未登记该键 → 查表侧查扁平键也查不到 → 恰好 undefined」，
**不是**因为查表侧真的做了宿主判定。**真空绿（passes for the wrong reason）的用例等于没有守护力**
（本仓 F232 已确立「判测试守护力用变异测试」的方法论）。

判据：一个弃权型用例，若在**所有**破坏它所声称判据的变异体下都不转红，则它没有判别力，必须补强。

### 1.2 跑法

跑批器 `mutation-run.mjs`（在 scratchpad，sha256 `7a296b02e8db982082748e8a3b599363ce11dc153037dff05d8937e80274aa42`）。
每个变异体：单锚点替换（锚点命中次数必须**恰好 1**，否则抛错）→ 跑
`npx vitest run tests/unit/typescript-mapper-callsite.test.ts --reporter=json` → 逐字还原源码。
基线（PRISTINE）先跑一遍，非全绿即中止。变异锚点全文见 §1.5，**不依赖 scratchpad 也可复现**。

### 1.3 结果（最终 61 个用例）

| 变异体 | 被移除的判据 | 转红的用例 |
|---|---|---|
| `A1a-drop-shadow-check` | A1「绑定点 ≥2 ⇒ 拦」 | **M10** |
| `A1b-drop-import-source` | A1「唯一绑定必须来自 import」 | **M10c** |
| `A1c-zero-binding-failopen` | A1「零绑定 ⇒ fail-closed」 | **M10c** |
| `A1d-enumerate-import-exemption` | A1 换成被 plan 否决的「全部绑定都来自 import 就放行」穷举式判据 | **M10b** |
| `A3a-flat-this-key` | A3 宿主分桶整体撤销（= 本轮修复前的磁盘缺陷） | **M12b, M12e, M12f, M12g** |
| `A3b-lookup-only-flat` | 只把查表侧退回扁平键（注册/查表不对称） | M4, M5, M14 |
| `A3c-allow-extends-host` | A3「带 extends 的宿主弃权」 | **M12c** |
| `A3d-allow-object-literal-host` | A3「对象字面量方法宿主弃权」 | **M12e** |
| `A3e-this-rebinding-ignored` | A3「普通 function / 静态块重绑 this」（两条一起） | **M12f, M12g** |
| `A3e1-function-rebinding-only` | 仅「普通 function 重绑 this」 | **M12f** |
| `A3e2-static-block-only` | 仅「静态块」 | **M12g** |
| `A4-drop-assignment-binding` | A4「赋值计为类型不可知绑定点」 | **M9b** |
| `AMB-first-wins` | 歧义弃权改 first-wins（= 一遍式实现会得到的结果） | **M8, M9, M9b, M12** |
| `A5a-first-type-identifier` | A5 类型形状白名单换成「取第一个 type_identifier」 | **M12d** |
| `A5b-accept-type-query` | A5 额外接受 `typeof x` | **M12d** |
| `H7-loose-constructor` | H7「构造器必须是裸 identifier」 | **M7** |
| `M11-claim-bare-this` | 不夺路（裸 `this.m()` 也去推断） | **M11** |
| `M14-half-open-fields` | fail-closed 不变量（只写 `receiverType` 不写判据字段） | M1–M6, M10, M10b, M10c, **M14**, M15–M15d |
| `NULL-capability-off` | 整条推断能力关闭（真空绿普查基准） | M1–M6, M10, M10b, M10c, M12d, M14, M15–M15d |

**每个变异体都被至少 1 个用例杀死；每个弃权型断言都被至少 1 个变异体杀死。**

### 1.4 发现的两个**真空绿**（已补强）

首轮（58 用例）跑批时，`A3d-allow-object-literal-host` 与 `A3e-this-rebinding-ignored`
**零转红** —— 说明 A3 的三条宿主弃权判据里有两条**完全没有守护力**。

根因是攻击形态选得不够狠：M12b 的对象字面量写在**顶层 function** 里，上溯撞到普通 function 就
返回 null 了，所以「memberHostBucket 是否对非 `class_body` 弃权」这件事在 M12b 上**不可观测**。
真正的攻击形态是宿主**嵌套在一个真类里**。

补强了 3 个用例（`tests/unit/typescript-mapper-callsite.test.ts`）：

| # | 样本 | 断言 | 杀死的变异体 |
|---|---|---|---|
| **M12e** | 类方法内**嵌套**对象字面量：`class A { private client: Foo; g(){ return { client: mkBar(), run(){ this.client.m() } } } }` | `receiverType` 不产出（对象字面量的 `client` 是 Bar，不是外层 A 的 Foo） | `A3a` / `A3d` |
| **M12f** | 类方法内的普通 function：`class A { private client: Foo; g(){ function inner(){ this.client.m() } } }` | 同上（普通 function 重绑 this） | `A3a` / `A3e` / `A3e1` |
| **M12g** | 静态块：`class A { private client: Foo; static { this.client.m() } }` | 同上（静态块的 this 是类本身，不是实例） | `A3a` / `A3e` / `A3e2` |

三个样本的 AST 祖先链已用 tree-sitter 探针实测确认（不是凭记忆写的）：

```
M12e: member_expression < member_expression < call_expression < expression_statement <
      statement_block < method_definition < object < return_statement < statement_block <
      method_definition < class_body < class_declaration < export_statement < program
M12f: … < statement_block < function_declaration < statement_block < method_definition <
      class_body < class_declaration < …
M12g: … < statement_block < class_static_block < class_body < class_declaration < …
```

`A3e` 一次移除了两条判据，无法区分是哪条被守护，故另拆出 `A3e1` / `A3e2` 单独验证 ——
结果是 **1:1 干净归因**（`A3e1` 只杀 M12f，`A3e2` 只杀 M12g）。

### 1.5 变异锚点全文（脱离 scratchpad 可复现）

文件缩写：`ENV` = `src/core/query-mappers/typescript-receiver-env.ts`，
`MAPPER` = `src/core/query-mappers/typescript-mapper.ts`。

| 变异体 | 文件 | 原文 → 变异 |
|---|---|---|
| `A1a` | ENV | `slot.total === 1 && slot.fromImport === 1` → `slot.total >= 1 && slot.fromImport === 1` |
| `A1b` | ENV | 同上整行 → `return slot !== undefined && slot.total === 1;` |
| `A1c` | ENV | 同上整行 → `return slot === undefined \|\| (slot.total === 1 && slot.fromImport === 1);` |
| `A1d` | ENV | 同上整行 → `return slot !== undefined && slot.total === slot.fromImport;` |
| `A3a` | ENV | 三处：两处登记键 `` `${host}#${…}` `` → `` `this.${…}` ``；查表侧 `resolveThisHostBucket` 三行 → `return bind(env, env.lookupReceiverType(\`this.${prop.text}\`));` |
| `A3b` | ENV | 仅查表侧三行 → 同 A3a 的查表侧替换 |
| `A3c` | ENV | `classBucketName` 内删除 `if (hasExtendsClause(classNode)) return null;` |
| `A3d` | ENV | `memberHostBucket` 的「非 `class_body` 即 null」→ 改为向上遍历找最近具名类 |
| `A3e` | ENV | `resolveThisHostBucket` 内 `THIS_REBINDING_FUNCTION_TYPES` 与 `class_static_block` 两处 `return null` → 改为 `cur = cur.parent; continue;` |
| `A3e1` | ENV | 仅 `THIS_REBINDING_FUNCTION_TYPES` 那处 |
| `A3e2` | ENV | 仅 `class_static_block` 那处 |
| `A4` | ENV | `assignment_expression` 分支体（`bindName` + `bindReceiver`）→ `void node;` |
| `AMB` | ENV | `if (existing.type !== type) existing.type = null;` → `void type;` |
| `A5a` | ENV | `classNameFromTypeAnnotation` 的白名单分支 → BFS 找子树第一个 `type_identifier` |
| `A5b` | ENV | 在 `return null;` 前插入接受 `type_query` 的分支 |
| `H7` | ENV | `return ctor?.type === 'identifier' ? ctor.text : null;` → `return ctor != null ? ctor.text : null;` |
| `M11` | ENV | `resolveCallSiteReceiver` 形态 1 之前插入 `if (objectNode.type === 'this') return bind(env, resolveThisHostBucket(objectNode));` |
| `M14` | MAPPER | 删除 `cs.receiverTypeSoleImportBinding = receiver.soleImportBinding;` |
| `NULL` | ENV | `if (!objectNode) return undefined;` → `if (!objectNode \|\| memberNode.id >= 0) return undefined;` |

### 1.6 顺带验证的 P2 弃权型断言（同族，有界抽查）

P2 的假边守卫也是弃权型断言，做了 1 个变异体抽查：把 `buildImportIndex` 里
`local !== imported` 分支的 `renamedImportAliases.add(local)` 换回 `register(imported)`
（= 恢复 H1 幽灵键）。结果 **R1 / R1b / R1c 三条同时转红**
（`Tests 3 failed | 72 passed (75)`）⇒ P2 的收口断言有判别力，不是真空绿。

---

## 2. 归因口径与基线

### 2.1 中间基线 P2t 是必需的（承接裁决 P2-5）

`tests/**` 与 `verification/*.mjs` 都会被采集进图。P3 既改了实现也改了测试，
不切开会把测试文件自身的变化算进 diff。故本轮的归因主锚点是 **`P2t → P3`**：

- **P2t** = P2 源码 + P3 测试 + P3 冻结版 `verification/*.mjs`
- **P3** = P3 源码 + P3 测试 + 同一份冻结版 `verification/*.mjs`

P2t 的构造方式（**全程无 git 写操作**）：`typescript-mapper.ts` 从 P2 备份还原、
`call-site.ts` 从 `git show HEAD:` 还原（该文件在 P2 未改动 ⇒ P2 版 = HEAD 版）、
`typescript-receiver-env.ts` 移出工作区。还原到 P3 后逐份 `shasum -a 256` 复核与 P3 快照一致：

```
852329ab57d5b03a5bed41bdd256bc62ed8a0a147bc258ca21d19c63d7094369  src/core/query-mappers/typescript-mapper.ts
e55f0a700a64685a157c4e02a474df18d591cfecaa0af6a77ad367607902c215  src/models/call-site.ts
dbd2210c12688404eec58bfdac1fe255b527887ea699a784ae4ef6375dcba1db  src/core/query-mappers/typescript-receiver-env.ts
```

P2 备份的保真性也做了核对：`ast-analyzer.ts` / `tree-sitter-fallback.ts` / `call-resolver.ts` /
`code-skeleton.ts` 四个 P3 未触碰的文件，备份与当前磁盘 `diff` 为空。

### 2.2 工具冻结与三次重取（如实登记）

`verification/*.mjs` 自身进图，**改工具就必须重取基线**（p2-attribution §6 的既有约定）。
本轮为落实裁决 P2-1 / P2-2 / P2-4 改了 `edge-diff.mjs` 与 `callsites-fingerprint.mjs`，
因此 **P2t/P3 这对基线一共重取了 3 次**，最终这份是在**工具全部改完之后**取的，
两侧 `verification/` 的 `.mjs` 内容完全一致。前两次的产物已删除，不参与结论。

可观测的印证：工具改动确实进了图 —— 加上 `digestCallSites` 导出后，P2t 的节点数从
7555 → 7556、calls 边 3845 → 3846。这正是「不冻结工具就会把工具自己的改动算进阶段 diff」的实例。

### 2.3 环境硬约束的执行

- 每次建图前都先 `npm run build`（退出码 0）。
- 用 `node dist/cli/index.js` 显式调用**本 worktree 的构建产物**，不走 `PATH` 上的全局 `spectra`。
  `node dist/cli/index.js --version` → `spectra v4.4.0 (0d3e385)`。
- `--output-dir` 指向 scratchpad 临时目录，**不覆写** `specs/_meta/graph.json`（MCP 在用）。

---

## 3. 主锚点：callSites 产物指纹（`P2t → P3`）

### 3.1 主口径（含 `line` / `column`）—— **按字面判 FAIL**

```
before 122933 条 / after 123065 条
新增 353 / 减少 221 / zeroDiff = false
```

按文件分布（**全仓 1149 个文件里只有 3 个有差异**）：

| 文件 | 新增 | 减少 |
|---|---|---|
| `src/core/query-mappers/typescript-mapper.ts` | 223 | 221 |
| `src/core/query-mappers/typescript-receiver-env.ts`（新建） | 126 | 0 |
| `src/models/call-site.ts` | 4 | 0 |

**⚠️ 与判据的偏差（如实登记，未自行改判、未放宽断言）**：
plan §6 P3 行与 §7.1 断言 4 写的是「callSites 指纹**零差**」。按字面，本阶段 **FAIL**。

**但这条判据在本阶段是结构性不可满足的**：指纹键含 `line` / `column`，而 plan §5 变更 #9
本身就给 `typescript-mapper.ts` 批了 **+40 行**的净增预算。任何往该文件插代码的实现都会让
其后所有 callSite 的行号位移 ⇒ 指纹必然非零。**这不是实现问题，是判据自带的结构性假阳性**，
与裁决 P2-1 处理的那次 FAIL 同构（判据没预见到实现会新增源码符号）。
**本轮不自行改判据**，把事实摆出来交编排器裁决。

### 3.2 位置无关口径 —— 这才是有判别力的那一刀

为把「行号位移」与「既有调用点的抽取语义变了」切开，给 `callsites-fingerprint.mjs` 加了
`--position-free` 口径（剔除 `line` / `column`，其余 6 个字段照旧；self-test 已覆盖
「主口径认位移 / 位置无关口径不认位移 / 位置无关口径仍认语义字段变化」三条）：

```
新增 132 / 减少 0
```

- **减少 = 0（全仓）** ⇒ **没有任何一条既有 callSite 消失或语义改变**。
- 新增 132 条 = `123065 − 122933`，**全部**是本次新增源码自身的调用点：

| 文件 | 新增 | 内容 |
|---|---|---|
| `typescript-receiver-env.ts` | 126 | 新建文件自身的调用点 |
| `typescript-mapper.ts` | 2 | `buildReceiverTypeEnv`（在 `extractCallSites`）、`resolveCallSiteReceiver`（在 `_handleMemberCall`）—— 就是 P3 的两处接线 |
| `call-site.ts` | 4 | `z.string()` / `.optional()` / `z.boolean()` / `.optional()` —— 两个新 schema 字段 |

⇒ **「指纹除新增的两个字段外零差」这句话的实质内容成立**：`receiverType` /
`receiverTypeSoleImportBinding` 被指纹白名单显式排除（`EXCLUDED_FIELDS`，self-test 有断言），
而剩下 8 个字段在**全仓既有调用点上逐字未变**。变化的只有新写的代码自己。

> #### ⚠️ P4b 修正注记（plan §13 **W-D**；2026-08-09 补）
>
> **上面这段结论的适用范围被 P3/P4 对抗审查判为过强，此处按 W-D 收窄。原文保留不删**，
> 修正如下：
>
> `--position-free` 口径是把 6 个语义字段做成**多重集**再比对的。多重集对
> **同文件内两条 callSite 语义字段互换**是**守恒**的（审查方实测构造出 `zeroDiff=true`），
> 因此「减少 = 0」只能支撑「**没有 callSite 消失**」，**不能**支撑「**没有 callSite 语义被置换**」。
>
> **收窄后的准确表述**：
>
> - 对全仓**未改动的 1146 个文件**：位置无关口径的 6 字段多重集**逐字未变**，
>   且 §3.3 的**每文件指纹**（含 `line` / `column` 共 8 字段的多重集 sha256）也逐字未变
>   （「逐文件指纹变化文件数: 3 / 1149」）。后者足以排除文件内互换 ——
>   互换会让 `line|column` 与语义字段的**配对**改变，8 字段多重集随之改变；
>   而这些文件没有新增代码，不存在行号位移这个混淆源。**这一半结论仍然成立。**
> - 对**被改动的 3 个文件**（`typescript-mapper.ts` / `typescript-receiver-env.ts` /
>   `call-site.ts`）：每文件指纹本来就变了（新增代码），**当前证据链不能排除**
>   这 3 个文件内部发生了既有 callSite 的语义置换。
>
> 换言之：**「全仓既有调用点逐字未变」应读作「全仓未改动文件的既有调用点逐字未变」。**
> 被改动文件的语义保真由另一条独立证据链承担 —— P3/P4b 的用例集与变异测试
> （P4b 轮：70 个源码判据面变异体 / 65 杀死 / 5 个经实测证明等价，见 `p4b-attribution.md` §1）。

### 3.3 压缩摘要（裁决 P2-4 的入库形态）

`callsites-digest-P2t.json` / `callsites-digest-P3.json`：每 callerFile 一行 sha256 + 全局 sha256。

```
global P2t = 92349ed8758e749ab8c038ced47ceedae3c2fec4a8faca04252b7ba207358552
global P3  = 517c132a8e501097173bddc3ae37cb64e043c479e0262f81effdec522ce8422f
逐文件指纹变化文件数: 3 / 1149
  src/core/query-mappers/typescript-mapper.ts        222 → 224
  src/core/query-mappers/typescript-receiver-env.ts  (无) → 126
  src/models/call-site.ts                             17 → 21
```

与 §3.1 / §3.2 三个口径互相印证，无矛盾。

---

## 4. 辅助信号：逐边 diff（`P2t → P3`）

```
before 12720 边 / 3846 calls  →  after 12732 边 / 3848 calls
新增 12 条 {"calls":2,"contains":9,"depends-on":1} / 减少 0 条
新增边三分类（裁决 P2-1）: {"retarget":0,"new-symbol":12,"phase-expected":0,"unclassified":0}
结论: PASS
```

### 4.1 裁决 P2-1 的三分类已做成机械判定

按裁决 P2-1 的要求（「`edge-diff.mjs` 须把『target 是否为本阶段新增节点』做成机械判定，
不靠人眼分类」），本轮给 `edge-diff.mjs` 补了 `classifyAddedEdges()`：
判据是 **target 节点 id 是否存在于上一阶段基线的节点集**，不是「看着像新符号」。
self-test 新增 5 条覆盖：新符号归类 / **反例**（target 早已存在 ⇒ 判 `unclassified` 而非混进新符号）/
`unclassified` 让判定失败 / P4 下同一条边落「阶段期望」/ P3 期望不得有减少。

**12 条新增边全部机械判定为「新符号自证边」（第 2 类），`unclassified = 0`。**
它们全部落在本次新建的 `typescript-receiver-env.ts` 及其在 `typescript-mapper.ts` 的接线上：

| 关系 | 条数 | 内容 |
|---|---|---|
| `calls` | 2 | `TypeScriptMapper.extractCallSites → buildReceiverTypeEnv`、`TypeScriptMapper._handleMemberCall → resolveCallSiteReceiver`（回源码核对为真实调用点，即 §3.2 那 2 条新 callSite） |
| `contains` | 9 | 新建文件的 module→symbol / symbol→member（`ReceiverBinding` / `ReceiverTypeEnv` 及其成员、两个导出函数）+ `TypeScriptMapper._receiverEnv` 新字段 |
| `depends-on` | 1 | `typescript-mapper.ts → typescript-receiver-env.ts` |

**无法归类的新增边 = 0 ⇒ 无需停工报告。**

### 4.2 断言 2 按裁决 P2-2 限定作用域

`edge-diff.mjs` 现按裁决 P2-2 把断言 2 的作用域限定为 **P4 / P5 新分支与 MRO 分支产出的边**；
P2 / P3 下标记 `applicable: false` 且**不静默** —— 违规数照旧算出并写进 detail：

```
【裁决 P2-2：本断言只对 P4 / P5 新分支与 MRO 分支产出的 calls 边生效，P3 不适用；下列为信息项】
违规 2 / 通过 0 / 未判定 0
```

那 2 条「违规」就是 §4.1 的两条新符号自证边（`exportKind === 'function'`），与 P2 的
`buildNamedImportBindings` 完全同构 —— 断言 2 的设计对象是 D2b 六条件与门产出的 member-target 边。
`--phase` 未指定时该断言仍照旧全量生效（保守缺省），只有显式传 `P2` / `P3` 才退为信息项。

### 4.3 断言 3 与 B5 dedup 顺序敏感性

- `danglingAdded = 0`，通过。
- B5 提示照常打出。本轮**减少边 = 0**、新增边全部指向上一阶段图中**不存在**的节点，
  不存在同键冲突，故第五路 dedup 的 first-write-wins 顺序敏感性在本阶段**无作用面**。

---

## 5. 六指标与覆盖率

| 指标 | P0 | P2 | P2t | P3 |
|---|---|---|---|---|
| duplicate-canonical-id | pass | pass | pass | pass |
| contains-coverage | pass | pass | pass (6257/6257) | pass (6266/6266) |
| orphan-ratio | pass | pass | pass (0.0%) | pass (0.0%) |
| dangling-edge | pass | pass | pass | pass |
| legacy-ignored | pass | pass | pass | pass |
| freshness | dirty | dirty | dirty | dirty |
| **overallVerdict** | pass | pass | **pass** | **pass** |

freshness 两侧同为 `dirty`（工作区有未提交改动，`recordedSourceCommit == currentHead`），
**不劣于 P0 / P2**。

覆盖率（主口径）：

| | P2t | P3 |
|---|---|---|
| method 节点 / 有入边 / 覆盖率 | 515 / 152 / **29.5%** | 517 / 152 / **29.4%** |
| function 节点 / 有入边 / 覆盖率 | 1467 / 1311 / 89.4% | 1469 / 1313 / 89.4% |
| gapRatio | 3.03 | 3.04 |

**method 覆盖率 29.5% → 29.4% 不是回归**：分子（152）逐字不变，分母 +2 来自新建文件里
`ReceiverTypeEnv` 接口的两个方法（`lookupReceiverType` / `isSoleImportBinding`），它们是纯类型
声明、无入边。P3 是**纯抽取层**阶段，resolver 不消费 `receiverType`（plan §6 P3 行明确
「resolver 不消费」）⇒ 覆盖率本就不该有任何提升。真正的覆盖率变化要到 P4 才发生。

function 侧 +2/+2 就是新增的两个导出函数自身。

---

## 6. 门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 构建 | `npm run build` | 退出码 **0** |
| 全量单测 | `npx vitest run` | 退出码 **0**；`Test Files 523 passed \| 4 skipped (527)` / `Tests 7198 passed \| 18 skipped \| 21 todo (7237)`，**零失败** |
| 插件测试 | `npm run test:plugins` | 退出码 **0** |
| 仓库校验 | `npm run repo:check` | 退出码 **0**（见下方 warning 说明） |
| 发布合同 | `npm run release:check` | 退出码 **0**，`Release contract valid` |
| 图质量 | `graph-quality --graph graph-P3.json` | `overallVerdict = pass`，六指标不劣于 P0/P2/P2t |
| 工具自验 | `edge-diff.mjs --self-test` | **18/18** 通过 |
| 工具自验 | `callsites-fingerprint.mjs --self-test` | **19/19** 通过 |

对账：修复前是 `1 failed / 7194 passed`（合计 7195 个非跳过用例），本轮修好那 1 条并新增
M12e / M12f / M12g 三条 ⇒ `7195 + 3 = 7198 passed`，与实跑数字一致，**没有失败被跳过或屏蔽**。

**`repo:check` 的 warning（预先存在，与 P3 无关）**：

```
[graph-quality] 图产物已 stale（source-commit）：图记录的 sourceCommit（dfe6c479…）
与当前 HEAD（0d3e385f…）不一致
```

指的是 `specs/_meta/graph.json`，它建于 `dfe6c479`（HEAD 之前两个提交），**本轮全程未触碰**
（所有建图都走 `--output-dir` 到 scratchpad）。这是 R-7 已登记的「图需全量重建」现象的一个实例。

---

## 7. 不入库大产物：sha256 与生成命令（裁决 P2-4）

三类大产物（`graph-P*.json` / `callsites-P*.json` / `exports-P*.json`）不入库，
留在 scratchpad `<scratchpad>/f260-artifacts/`，清单同时追加进该目录的 `SHA256SUMS.txt`。

| 文件 | sha256 |
|---|---|
| `graph-P2t.json` | `49437756505a81f2cf41899a144c7b4c65e57490a0d0992e2411ce92dabeed6e` |
| `callsites-P2t.json` | `94107d8b66170727001d7580b5b9a7e929895cd19ad5fb3b28c6195f8aab09ea` |
| `exports-P2t.json` | `9cf4f9628f1549ee1c3e2bd53aebd172b622714e3fc2203878748dbb8e024eff` |
| `graph-P3.json` | `a42c0b601091ac148203292edc87b646a3e91bc1fbebeeb384439a08767104d7` |
| `callsites-P3.json` | `526221d3e4bd0514b2c6dc2c9aab29b20e6ad4971943bcdb0974611f8d3255ce` |
| `exports-P3.json` | `0eca2ec12336f88fdc81d64a21b7d93fc1a094a8b5b112242bb2beb6038b8788` |

生成命令（`<tag>` ∈ {`P2t`, `P3`}，`<V>` = `specs/260-fix-instance-method-call-edges/verification`）：

```bash
npm run build                                                     # 硬约束：先建 dist
node dist/cli/index.js --version                                  # 确认跑的是本 worktree 产物
node dist/cli/index.js batch --mode graph-only \
  --output-dir <scratchpad>/out-<tag>                             # → out-<tag>/_meta/graph.json
cp <scratchpad>/out-<tag>/_meta/graph.json <V>/graph-<tag>.json
node <V>/dump-skeletons.mjs <tag>                                 # → callsites-<tag>.json / exports-<tag>.json
node dist/cli/index.js graph-quality --graph <V>/graph-<tag>.json --json > <V>/<tag>-graph-quality.json
node <V>/callsites-fingerprint.mjs --digest <V>/callsites-<tag>.json > <V>/callsites-digest-<tag>.json
node <V>/coverage-metric.mjs <V>/graph-<tag>.json > <V>/coverage-<tag>.json
```

比较命令：

```bash
node <V>/edge-diff.mjs <graph-P2t> <graph-P3> --phase P3 --skeletons <V>/exports-P3.json --json \
  > <V>/edge-diff-P2t-to-P3.json
node <V>/callsites-fingerprint.mjs <callsites-P2t> <callsites-P3> --json \
  > <V>/callsites-fingerprint-P2t-to-P3.json
node <V>/callsites-fingerprint.mjs <callsites-P2t> <callsites-P3> --json --position-free \
  > <V>/callsites-fingerprint-positionfree-P2t-to-P3.json
```

⚠️ `graph-quality` 的 `--output` 写的是**人类可读报告**，要 JSON 必须走 `--json` + stdout 重定向。
p2-attribution §7 记的 `--json --output <file>` 命令实测产出的是文本，此处已更正。

---

## 8. 本轮未做 / 待编排器裁决的事

1. **未改判据、未改工具去迁就结果**：§3.1 的主口径指纹按字面判 FAIL，已如实登记并给出
   结构性成因分析，**没有**把 `line` / `column` 从主口径里删掉来让它变绿 ——
   `--position-free` 是**新增的第二个口径**，主口径原样保留。请编排器裁决判据是否按
   裁决 P2-1 的同款方式收窄。
2. **未碰 P4 / P5**：resolver 侧新分支与 MRO 分支一行未动。
3. **未做任何 git 写操作**（无 `add` / `commit` / `stash` / `checkout` / `clean`），
   只用了只读的 `git show HEAD:<file>` 与 `git status`。
4. **审查档位**：Codex 配额耗尽期，本轮的对抗面由**变异测试**承担（§1），
   属于「异构内部对抗」的一种形态，但**不等价于**独立子代理的双切入角对抗审查。
   如需按 CLAUDE.local.md 的暂停期档位补齐，应在 P3 收口 commit 前另行安排，
   并在 commit message 标注「Codex 审查暂停，异构档位缺席」。
5. **残余风险登记**：`A3b-lookup-only-flat`（注册侧分桶、查表侧扁平）这一形态正是本轮修复前的
   磁盘缺陷方向之一，目前由 M4 / M5 / M14 守护；反方向（两侧都扁平）由 M12b / M12e / M12f / M12g 守护。
   两个方向都有守护后，A3 的注册/查表**对称性**才算被钉死。
