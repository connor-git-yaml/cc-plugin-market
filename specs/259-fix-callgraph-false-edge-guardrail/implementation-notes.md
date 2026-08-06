# Implementation Notes: F259 调用图确定性假边收口 + collector 指纹护栏 py 侧盲区补齐

> 本文件按 Phase 增量追加，实现过程中曾遇一次 API 连接中断，恢复后按此文件续跑，避免结论丢失。
> 实现过程中经历了两轮**独立对抗审查**（Codex 配额耗尽期，按 `CLAUDE.local.md` 暂停节改用主编排器
> 亲自复核 + 异构对抗），分别抓到"护栏掩码面"3 条与"假边构造面"2 条 CRITICAL/WARNING 级发现，
> 均已逐条处置，处置过程与最终结论记录在下方对应 Phase 小节。**Codex 审查暂停，异构档位缺席**
> （主编排器亲自复核 + 独立对抗审查两轮）。

---

## Phase 1（缺陷 1）：call-resolver.ts 确定性假边 — 状态：完成（含一轮撤回修正）

### T001 红用例先行（复刻 fix-report 探针）

在**未改动 `call-resolver.ts`** 的基线上执行：

```bash
npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts -t "F259"
```

实测输出（真实失败，非自证式必然通过）：

```
× F259 — commonjs-require 兜底别名覆写同名静态绑定（确定性假边） > (a) require('./dep.js') 不得覆盖同名静态绑定 alias `js`（复刻 fix-report 探针）
  → expected 'src/dep.ts' to be 'src/lit.ts' // Object.is equality
× F259 — commonjs-require 兜底别名覆写同名静态绑定（确定性假边） > (b) `js()` 调用产出的边指向静态绑定目标，不产出指向 require 目标的 `::js` 假边
  → expected 'src/dep.ts::js' to be 'src/lit.ts::js' // Object.is equality
× F259 — commonjs-require 兜底别名覆写同名静态绑定（确定性假边） > (c) registerSpecifierFallback 双保险：无绑定名条目 lastSeg 碰撞时保留第一次写入值（间接验证，函数未导出）
  → expected 'b1.py' to be 'a1.py' // Object.is equality
✓ F259 — 回归：require 的 depends-on 边不受兜底别名闸收紧影响（已通过 —— deriveImportEdges 与 aliasToTarget 无耦合，符合预期）
× F259 — 副作用回归：side-effect-only 静态 import 不再注册垃圾别名 > import './x.css'（无 named/default/namespace）不向 aliasToTarget 注册 lastSeg 垃圾别名
  → expected true to be false // Object.is equality

Tests  4 failed | 1 passed | 64 skipped (69)
```

（注：上述 (c) 用例后经**内部对抗复审裁定撤回**，见下方"内部对抗复审处置"节。）

### T002 修复实现（判据变更，保留）

`src/knowledge-graph/call-resolver.ts::buildImportIndex` 第一遍循环，判据从
`if (!hasBindingNames(imp))` 改为 `if (!hasBindingNames(imp) && imp.importType === undefined)`。

`git diff` 核对：该函数体内仅此一行判据变更（另加中文注释说明）。**这是本次唯一保留的生产代码
改动点**（改动点 2 已撤回，见下）。

### T003 双保险防御（改动点 2）——已撤回

**原实现**：`registerSpecifierFallback` 内部两行无条件 `.set()` 改为 `has()` 守卫后再写，
意图是"即便判据未来遗漏也不覆写已有 alias"。

**内部对抗复审（假边构造面，第二路独立对抗）抓到 2 条 CRITICAL，裁定撤回**：

1. **实际作用面与 plan 描述不符**：`registerSpecifierFallback` 全仓只有一个调用点。改动点 1
   落地后 TS/JS 已经进不了该函数，改动点 2 的实际作用面**只剩 Python**——它唯一的真实效果
   是把 Python 侧的 last-write-wins 改成 first-write-wins，plan 写的"两层防御针对不同攻击面"
   与事实不符，第二层是空转的。
2. **该变更会新造假边（端到端实证）**：
   ```python
   import pkg.util   # Python 语义只绑定 pkg，不绑定 util
   import util       # 真正绑定 util
   util.f()
   ```
   撤回前（base，无判据）：`util` 解析到 `util.py::f`（正确）。
   加了改动点 2（first-write-wins）后：`import pkg.util` 先写入 `util` → `pkg/util.py`，
   `import util` 因 `.has('util')` 为真而被跳过 → `util.f()` 解析到 `pkg/util.py::f`
   （**假边**，两端真实节点）。即"先来者赢"在这个真实存在的 Python 命名模式下恰好是错的
   那一个。
3. **plan 的回归验证结构性失明**：plan 指定的 Python 回归锚（`call-resolver.test.ts`
   L1770-1784 `(c)` 用例）两条 import 互不撞名，first-write-wins 分支永不触发，全绿
   不构成安全证据。

**处置**：`registerSpecifierFallback` 恢复原样的无条件 `.set()`（`git diff` 确认该函数体
逐字与撤回前一致）；T003 对应的单测 `(c) registerSpecifierFallback 双保险...` 已删除，替换为
一段说明性注释记录撤回原因与已知残留（Python 侧 lastSeg 撞名沿用改动前 last-write-wins 行为，
不在 F259 范围内——见下方"已知残留"）。

### T004 depends-on 回归用例（保留）

新增用例直接调用 `deriveImportEdges`，断言 `require('./dep.js')` 场景下
`src/caller.ts → src/dep.ts`（depends-on）边仍存在。改动前后均绿（证明与 aliasToTarget 无耦合，
非被动通过）。

### T005 副作用回归用例（保留）

TS 静态 side-effect-only import（`import './x.css'`）：改动前 `aliasToTarget.has('css')` 为
`true`（红，见 T001 实测输出第 4 条）；改动后为 `false`（绿）。

### 内部对抗复审裁定 3（WARNING-2）—— 新增不变量护栏

`ImportReference.importType` 在 `code-skeleton.ts:143` 是 `.optional()`——"TS/JS 抽取路径恒设置
该字段"是**无任何机制保障的隐式约定**，失效形态是**静默假边**（该 import 会被误判为 Python
语义分支，重新掉进 `registerSpecifierFallback`）而非报错。新增护栏测试：用**真实采集器**
（`collectTsJsCodeSkeletons`，而非手写 skeleton 字面量）对含 4 类 import
（static/dynamic/type-only/commonjs-require，复用既有 fixture
`tests/fixtures/156-w1.2-v2/ts-import-types`）跑一遍，断言每条 import 都带 `importType`
字段，且 4 类各出现一次。用例位置：`call-resolver.test.ts` "F259 裁定 3" describe 块。

同时核对：T001 的红用例手写 skeleton 是否显式填了 `importType: 'commonjs-require'`——已核实
两处（`(a)`/`(b)`）均显式填写，测的是正确分支（TS 语义），非误判为 Python 语义分支的假绿。

### T006 全量回归

```bash
npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts
```

最终（撤回改动点 2 + 新增裁定 3 护栏后）实测输出：

```
✓ |unit| tests/unit/knowledge-graph/call-resolver.test.ts (69 tests) 79ms
Test Files  1 passed (1)
     Tests  69 passed (69)
```

69 = 改动前既有 64 条（逐字保持绿，尤其 `(c) 回归锚 — 静态无绑定 import 的 specifier
兜底保持不变（Python import X 路径）` 断言值不变）+ 本阶段净增 5 条
（T001 (a)(b) + T004 + T005 + 裁定 3 新增 1 条，T003 的 (c) 已删除相抵）。0 failed。

**验证结果**：
- 命令：`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts`
- 退出码：0
- 输出摘要：`Tests  69 passed (69)`

### 内部对抗复审裁定 2 —— recall 口径据实改写（"零负贡献"已被证伪）

**原 plan 声称**："本次移除 lastSeg/moduleSpecifier 双重兜底别名对 recall 是零负贡献，对
precision 是纯正贡献。" **已被证伪。**

**独立对抗审查证据**（全仓 A/B 实跑，1229 skeletons / 119611 callSites，逐边 diff）：
`buildUnifiedGraph` 原始输出（`graph-builder.ts` 悬空过滤**之前**）层面，
`tests/fixtures/156-w1.2-v2/ts-import-types/main.ts::run → cjs-target.cjs::cjsHello`
（medium confidence）这条边在应用改动点 1 后消失。

**本轮亲自复现确认该机制真实存在**：

```bash
$ node probe-cjs3.mjs   # 直接调用 analyzeFile + buildUnifiedGraph，绕过 CLI 的 graph-builder 装配
POST-FIX calls edges from run(): [
  { target: '?::import', confidence: 'low' },
  { target: 'static-target.ts::staticHello', confidence: 'medium' },
  { target: 'dynamic-target.ts::dynamicHello', confidence: 'medium' }
  // cjs-target.cjs::cjsHello 已不再出现（修复前会出现，medium confidence）
]
```

**机制**：`const cjs = require('./cjs-target.cjs')` 的变量名 `cjs` **恰好等于**
`'./cjs-target.cjs'.split('.').pop()` 计算出的 lastSeg `'cjs'`——修复前 lastSeg 兜底别名
`aliasToTarget.set('cjs', <cjs-target.cjs 路径>)` 意外与真实调用点 `cjs.cjsHello()` 的
`calleeQualifier='cjs'` 撞上，产出一条**碰巧正确**的 medium confidence 边。修复后
`imp.importType === 'commonjs-require'`（已定义）不再进入兜底分支，该边消失，
`cjs.cjsHello()` 回落 Stage 4 → `?::cjsHello`（低置信度占位，被悬空过滤丢弃）。此机制可泛化到
任何 `const X = require('…/X.ext')` 形态（如 `const zod = require('zod')`，若 `zod` 是
non-scoped bare specifier 且 `resolvedPath` 非空）；本仓因以 ESM 为主 + bare specifier 多数
落 `node_modules`（`resolvedPath=null`，不触发兜底注册）而只暴露这一条实例。

**本轮进一步查明的关键澄清（`graph-builder.ts` 悬空过滤层面的最终可见性）**：

- `cjs-target.cjs::cjsHello` 节点**从未存在于最终图**——`cjs-target.cjs` 是 CommonJS
  `module.exports = { cjsHello: () => 'cjs' }` 形态，属于既有已知能力边界
  （MEMORY: "F243 CJS module.exports 提取为空是能力边界"）：其导出符号不会被抽取为图节点。
- 因此**修复前**这条边虽然在 `buildUnifiedGraph` 原始输出中存在，但目标节点始终是悬空的，
  会被 `graph-builder.ts` 的悬空端点过滤在装配最终 `graph.json` 前丢弃——**从未出现在任何人
  实际消费的 `specs/_meta/graph.json` 里**。
- 因此**本仓自身的 graph-only 全量重建**（T017，逐边 diff 见下）在最终 `graph.json` 层面
  测得 **LOST=0 / GAINED=0**（详见下方 T017 记录），与"buildUnifiedGraph 原始层面 LOST=1"
  两个观测**均真实、不矛盾**——只是分别测在悬空过滤前后两个不同的可观测层。

**据实结论**（覆盖 plan 与 fix-report 的过度声明）：

> 预期 calls 边净变化（`buildUnifiedGraph` 原始输出层面，悬空过滤前）
> = −(假边) − (lastSeg 与 require 变量名巧合命中的真边)。
> 本次改动**不是**对 recall 零负贡献；它是一次以少量、可解释的巧合命中损失换取消除
> 确定性假边的 precision-recall 取舍。在**本仓自身发布的 `graph.json`**（悬空过滤后）
> 这一层，该取舍因目标节点本就悬空而**不可见**（净变化 0），但在其他代码库（require 目标
> 文件若有 ES-recognizable 导出，或未来 CJS 导出抽取能力被补齐）该取舍会真实体现为 1 条
> 边的 recall 损失。**不要**在 commit message / 交付说明里使用"零负贡献"或"假边收口"
> （不加限定语）这类全称表述——只应表述为"收口了 TS/JS require 路径字面量兜底别名覆写
> 静态绑定这一类确定性假边，代价是极少数 lastSeg-与require变量名巧合命中的真边"。

### 已知残留（明确登记为 F259 范围外，不修）

以下均为**既有**（改动前后行为不变，或本身是判据设计的自然副作用边界）缺陷，独立对抗审查已
核实、裁定登记为残留不在本次修复范围：

1. **Python `import a.b.c as d`**：`python-mapper` 取原名不取别名，仍会注册假别名 `c`
   （lastSeg），且漏掉真实应绑定到 `d` 的边。
2. **Python `import pkg.util` 注册 `util` 本身违反 Python 绑定语义**——Python 的
   `import pkg.util` 只绑定 `pkg`（访问需 `pkg.util.f()`），不绑定裸 `util`；现有兜底
   `registerSpecifierFallback` 对此类 dotted specifier 仍注册 lastSeg `util` 作为独立别名，
   是既有假边源（不是 F259 引入，F259 判据变更不影响 Python 分支的这一行为）。
3. **Go `import "gopkg.in/yaml.v2"`** → lastSeg（`.split('.').pop()`）算出 `'v2'` 作为假别名；
   当前因 Go import 的 `resolvedPath` 恒为 `null`（Go 模块解析未实现），不产边，暂无实际
   危害，但判据本身仍在。
4. **`registerSpecifierFallback` 的 Python 侧 lastSeg 撞名（first-write-wins vs
   last-write-wins）**：改动点 2 撤回后，沿用改动前的无条件 `.set()`（**last-write-wins**）——
   两个 Python import 若 lastSeg 撞名，后写入的覆盖先写入的，可能产生错误 alias（如
   "内部对抗复审裁定 2" 反例 `import pkg.util` + `import util` 场景，若两者顺序颠倒）。
   这是 F249/F242 时代即存在的既有行为，F259 判据变更后依旧保留，不在本次范围。

> **禁止全称表述**：notes / commit message 均不得使用"假边收口"这种不加限定语的全称
> 表述——本次只收口了 **TS/JS `require()` 路径字面量兜底覆写同名静态绑定**这一类确定性
> 假边，上述 4 类既有假边源不受影响。

---

## Phase 2（缺陷 2）：collector-fingerprint-guardrail py 侧盲区 — 状态：完成（含一轮补强）

### T007/T008 fixture 增样

新增 `tests/fixtures/collector-fingerprint-guardrail/src/py/producer.py`（`def make() -> int:
return 42`）与 `consumer.py`（`from .producer import make` + `def use() -> int: return
make()`）。`python3 -m py_compile` 语法校验通过。

### T009 断言升级（在 a-track 新增具体端点边断言）

在 `collector-fingerprint-guardrail.test.ts` a-track 新增一条 `it`，断言 `rebuiltGraph.links`
含 `consumer.py → producer.py`（depends-on）与 `consumer.py::use → producer.py::make`
（calls）两条具体端点边（非仅断言非空）。

### T010 红用例先行验证 —— 内部对抗复审 C3：原始证据被判无效，已重做

**独立对抗审查（护栏掩码面）指出的问题（C3，记账伪证据链）**：T009 的新断言打在
`rebuiltGraph.links`（每次 `beforeAll` 从当前 fixture 目录**现建**）上，不是 pinned
资产上——fixture 一放进 producer.py/consumer.py，`rebuiltGraph` 当场就含这两条边，
T009 自身的断言**从一开始就是绿的**，不构成"红用例先行"的有效证据。真正在 pinned 未再生
阶段变红的是 a-track 的 multiset 比对用例（`节点 id multiset + 边 multiset 与 pinned
严格相等`）与两条级联失败，这与"T009 新断言在测真实缺口"是两回事——原始记账混淆了两种不同
机制，已判定为伪证据链。

**要求的正确证据（探针 C 式变异）**：把 `pythonSkeletons` 从 `graph-assembly.ts` 的合并中
剔除（探针 C），验证**在 pinned 已包含新边之后**（T011/T012 之后）新断言必须红。

**重做记录**（在 T011/T012 完成、pinned 已含新边之后执行）：

```bash
$ # 临时变异：graph-assembly.ts 内 codeSkeletons 合并剔除 pythonSkeletons
$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts
Tests  4 failed | 19 passed (23)
```

4 处失败：(1) a-track multiset 比对（`节点仅存在于重建产物: src/py/consumer.py` 等 8 条
diff）；(2) **T009 自身新断言**（`#2 pyWalk 独占贡献 py→py 的 depends-on 与 calls 边`）——
这次是真正的红，因为 `rebuiltGraph` 本身在探针 C 下已经不含这两条边了；(3)(4) 两条级联失败
（顺序扰动用例、真实重建绿路径交叉断言）。

验证后立即用 `git diff src/batch/stages/graph-assembly.ts` 确认变异已完全还原（空 diff），
`SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run` 重跑确认恢复 23/23 全绿。

**结论**：T009 断言在"探针 C 已生效 + pinned 已含新边"这一真实场景下确实会红，是有效的
永久回归保护；但它**不是**"红用例先行"意义上的证据（那一步的正确验证载体是探针 C，不是
pinned-vs-fixture 的偶发不一致）。

### T011 pinned 资产再生（含 BEHAVIOR_VERSION bump，独立对抗审查已核实批准）

首次执行 `npm run fixtures:regen:collector-fingerprint` 被脚本拒绝：

```
[regen] 拒绝再生：a-track(graph-only) 重建内容与 pinned 期望不一致，但指纹未变化
[regen]   - 节点仅存在于重建产物: src/py/consumer.py（+3 同类）
[regen]   - 边计数不一致（重建 1 vs pinned 0）: ...（+3 同类）
```

原因：`shouldRejectRegen`（`scripts/lib/collector-fingerprint-regen-predicate.mjs`）是
**二元**拒绝判据（`contentMismatch ∧ fingerprintUnchanged`），且该模块文档明确"fixture 是
护栏验证的行为契约基线，其变更同样需要 bump 留痕"——即便本次未改动任何采集器**代码**行为，
纯 fixture 内容扩充也需要 `BEHAVIOR_VERSION` bump 才能通过。

处置：`src/panoramic/graph/collector-fingerprint.ts` 的 `BEHAVIOR_VERSION` 从 2 bump 至 3，
附 bump 记录注释说明"非采集器代码行为变化，是 fixture 基线扩充触发的既定 bump 纪律"。

**独立对抗审查已核实批准该路线**（核对 `shouldRejectRegen` 源码确认无豁免通道，fixture 变更
需 bump 是设计本意）。

再生后：

```
[regen] 放行：contentMismatch=true、fingerprintUnchanged=false、inputHashChanged=true
[regen] 已更新两份 pinned 资产（fixtureInputHash=bc3ece8c8120…）
```

逐项核对（T011 验收判据）：

- (a) `expected-graph-only-graph.json` 新增恰好 2 个 module 节点、2 个 component 节点、
  2 条 contains 边、1 条 depends-on 边、1 条 calls 边（`git diff` 逐行核对确认）。
- (b) `expected-module-graph.json` 的 `moduleGraph` 字段**未变**（只有 `fixtureInputHash`/
  `behaviorVersion: 2→3` 变化）——`git diff` 确认。
- (c) 两份资产的 `fixtureInputHash` 彼此一致（`bc3ece8c8120b716dc915db9eb8d232d77cc5eeed656699510e3edc329125adc`）。

### T012 绿转换确认

```bash
$ npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts
✓ |unit| tests/unit/guardrail/collector-fingerprint-guardrail.test.ts (22 tests) 179ms
Tests  22 passed (22)
```

### T013 隔离对照用例 —— 内部对抗复审 C4：判定为同义反复，已补正向不变量钉死

**独立对抗审查（护栏掩码面）指出的问题（C4）**：`extractSymbolNodes`（#11）当前只产
`contains` 边这一不变量**全仓无测试钉死**。一旦有人给 #11 加上 `depends-on`/`calls`
产出能力，`buildKnowledgeGraph` 按 `source|target|relation` 去重 → 即便整条 #2 管线被删，
边仍会由 #11 补上 → 掩码原样复发。原 T013"隔离对照用例"（收窄 `codeSkeletons` 排除 python，
断言 `buildUnifiedGraph` 产物中无这两条边）本身**抓不到这一幕**——它测的是
`buildUnifiedGraph` 与 #11 是两条不相交调用这一结构性事实（收窄入参时 #11 本来就不在场），
是同义反复，不构成"`#2` 是唯一生产者"的独立证据。

**处置**：保留原 T013 用例（作为文档性佐证，已加注释澄清其局限），**新增**正向不变量钉死用例：

```ts
it('#11 extractSymbolNodes 当前只产 contains 边（钉死前提，防止未来给 #11 加边后掩码复发）', async () => {
  const staged = stageFixture();
  const results = await new PythonLanguageAdapter().extractSymbolNodes(staged);
  const relations = new Set(results.flatMap((r) => r.edges.map((e) => e.relation)));
  expect(relations).toEqual(new Set(['contains']));
});
```

该用例直接对生产代码的当前输出做正向断言，一旦未来有人给 #11 扩展出 `calls`/`depends-on`
产出能力，改动当下就会 fail-loud，不必等到有人手滑删除 #2 才被发现。

最终 22 → 23 tests（新增裁定 4 用例）。

### T014 变异矩阵（5 维度 + 探针 C），内部对抗复审 W1/W2/W3/W4 已逐条处置

所有变异均在 `SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run
tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 下执行（跳过 globalSetup 的
dist 重建，区分"护栏红"与"构建失败"两种信号），每次变异后立即 `git diff` 确认已完全还原。

#### 探针 C（决定性，post-regen 重做，见 T010 节）

**结论：可红**。4 processes failed（含 T009 自身断言与 a-track multiset 比对）。还原后
`git diff src/batch/stages/graph-assembly.ts` 为空，重跑 23/23 绿。

#### (1) ignore-dirs-pruning —— 可红

临时在 `PY_SKELETON_IGNORE_DIRS`（`source-discovery.ts`）新增 `'py'`（fixture 的
python 样本恰好都在 `src/py/` 目录下，整个目录被剪枝）：

```bash
$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run ...
Tests  4 failed | 19 passed (23)
```

**结论：可红**。还原后 `git diff` 为空，重跑 23/23 绿。

**覆盖边界（内部对抗复审 W4，据实标注）**：本维度只对含 fixture 现存目录字面量（`py`/`ts`/
`java`/`go`/`module-only`）的变异敏感——新增一个 fixture 里从未出现过的目录名（如
`'vendor'`）不会被任何变异捕获（因为 fixture 本身不含该目录名的样本可被剪枝）。这是本护栏
固有的覆盖边界，不做进一步扩大。

#### (2) gitignore-interpretation —— 结构性不可见（内部对抗复审 W3 核实，未虚报为可红）

**独立对抗审查已指出**：护栏把 fixture 复制到 `os.tmpdir()`（`stageFixture()`），该临时目录
**不是 git 仓库**且 fixture 内无 `.gitignore` 文件——F255 的 git 事实源分支
（`git ls-files --others --ignored ...`）在本护栏环境下**从未执行**（`cwd` 非 git 仓库，命令
必然失败），过滤谓词恒为 `false`（回退路径 `parseGitignore` 面对不存在的 `.gitignore` 文件
直接 `return () => false`）。

**本轮实测验证**（不依赖推理，直接构造探针）：

```bash
$ node /tmp/test-gitignore-invisibility.mjs
git ls-files failed as expected (staged dir is not a git repo): Command failed: git ls-files ...
staged root .gitignore exists: true   # 即便手工放了 .gitignore，stageFixture() 也从不复制它
```

`stageFixture()` 只 `cpSync(FIXTURE_ROOT/src, staged/src)`，从不复制任何 `.gitignore` 到
`staged` 根——即便未来给 `.gitignore` 解释逻辑本身引入任何行为变化，本护栏的这条通路上
**没有任何 `.gitignore` 文件可读**，判定谓词的返回值不随该逻辑变化而变化。

**结论：该维度当前无法被本护栏捕获**（结构性不可见，非代码缺陷，是 `stageFixture()` 隔离设计
与 F255 git 事实源前提共同作用的既定结果）。诚实标注，未构造虚假红用例圆场。

#### (3) symlink-handling —— 无自然探测点（内部对抗复审 W3 核实）；受控实验证实机制可行但需双重变异

**核实**：`walkPyFiles` 用 `entry.isFile()`/`entry.isDirectory()` 判定（Node
`fs.Dirent`），符号链接条目二者均为 `false`（已用独立 node 脚本验证：
`isFile=false, isSymlink=true`）——当前实现**不跟随符号链接**，无任何专项 symlink 处理代码，
且 fixture 本身**不含任何符号链接样本**。这意味着：仅修改现有代码（不同时改 fixture）不会
产生任何可观测差异——**该维度当前无自然探测点**。

**受控双重实验**（临时同时变异代码 + fixture，验证机制原理上可行，验证后完整还原）：

1. 基线（无变异）：在 `src/py/` 下新增一个指向 `__pycache__/`（两套忽略集合均排除的目录）内
   容目标的符号链接 `symlink-decoy.py`，**不改代码** → 重跑护栏 → **23/23 绿**（确认当前
   实现确实忽略该符号链接）。
2. 加变异：`walkPyFiles` 的文件判定条件从 `entry.isFile()` 改为
   `entry.isFile() || entry.isSymbolicLink()`（跟随符号链接）→ 重跑 → **3 failed**
   （`节点仅存在于重建产物: src/py/symlink-decoy.py`），确认机制可行。
3. 还原：移除临时符号链接与 `__pycache__` 探针目录，撤销代码变异，`git diff
   src/batch/stages/source-discovery.ts` 为空，重跑 23/23 绿。

（探索过程中一度误用 `src/py/build/` 作为"隐藏目录"，因 `build` 只在 `PY_SKELETON_IGNORE_DIRS`
（#2）中被忽略、不在 `#11`（`extractSymbolNodes` 的 `defaultIgnoreDirs` + 硬编码集）中被忽略，
导致 #11 直接扫描到该目录内容、产生与 symlink 无关的误报——已定位为既有"两套剪枝集不同"的
已知设计差异（`python-adapter.ts` 注释已载明，非本次引入），改用 `__pycache__`（两套忽略集合
均覆盖）重做后消除该confound。）

**结论**：该维度**当前无自然探测点**（如实标注，不计入"可红"维度）；但通过受控实验确认
"若未来有人改动符号链接跟随策略 **且** fixture 同时补充符号链接样本"，该护栏机制上具备
检出能力——这与"当前可被单一维度变异捕获"是两个不同的结论，不得混淆汇报。

#### (4) file-size-guard —— 仅退化变异可红，真实阈值变更不可探测（内部对抗复审 W2/W1 核实）

**W1 修正**：mutation 必须打在 `consumer.py`（180 字节），而非 producer.py——独立对抗审查
实跑证实两条新边（depends-on + calls）**全部由 consumer.py 一侧的 skeleton 派生**
（depends-on 走 `imp.resolvedPath` 文件系统解析、calls 走 alias→`${target}::${name}`
字符串拼装），producer.py 的 skeleton 是否成功采集**不影响**这两条边是否产出（下方(5)节有
反证实验）。

**W2 修正**：`consumer.py` 实际 180 字节（远大于 plan/reviewer 估计的 41B/73B，但结论方向
相同）。

```bash
$ # MAX_FILE_BYTES 降到 100（远低于 consumer.py 180B）
$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run ...
Tests  4 failed | 19 passed (23)   # 可红（退化阈值）
```

```bash
$ # MAX_FILE_BYTES 降到 512_000（"现实"阈值调整 1MB→512KB）
$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run ...
Tests  23 passed (23)   # 不可红——consumer.py 180B 远小于 512KB，"现实"阈值调整完全不可见
```

**结论**：仅极端退化变异（阈值降到 <180B）可红；真实场景下 1MB→512KB 这类"现实"阈值调整
**不可探测**。两次实验均已确认后还原，`git diff src/batch/stages/source-discovery.ts` 为空。

#### (5) collection-failure-degradation —— 需打在 consumer.py（W1 核实 + 反证）

```bash
$ # 让 adapter.analyzeFile 对 consumer.py 抛异常（模拟解析失败）
$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run ...
Tests  4 failed | 19 passed (23)   # 可红
```

**W1 反证实验**（对照：只让 producer.py 解析失败）：

```bash
$ # 让 adapter.analyzeFile 对 producer.py 抛异常（对照，验证 W1 结论）
$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run ...
Tests  23 passed (23)   # 全绿——producer.py 解析失败对这两条新边完全无感知
```

**机制解释**（本轮追加发现，加深理解 F259 缺陷 2 的掩码本质）：即便 producer.py 的 #2 侧
skeleton 采集完全失败（从 `codeSkeletons` Map 中整体消失），`src/py/producer.py`/
`src/py/producer.py::make` 这两个节点仍会由 `#11 pythonSymbolScan` **独立产出**（#11 的采集
不依赖 #2 的成功与否），calls 边的 target 字符串 `producer.py::make` 因此仍能在最终图中命中
一个真实节点（来自 #11），不会被 graph-builder 悬空过滤丢弃——这正是本 Feature 要解决的
"两条独立生产者节点面重合"现象的又一次直接体现。

**结论**：mutation 必须打在 consumer.py 才能红；打在 producer.py 不可红（这不是护栏缺陷，
是两条新边的派生机制决定的——已记入 W1 修正后的正确结论，不再误判为"该维度无法捕获"）。
两次实验均已还原，`git diff` 为空。

### T015 README 覆盖表修正

见 `tests/fixtures/collector-fingerprint-guardrail/README.md`：(a) `mod.py`/`mod.pyi`
行补脚注说明"仅覆盖节点面（SC-005b），不覆盖边面独占性"；(b) 新增
`producer.py`/`consumer.py` 一行记录"#2 pyWalk（边面独占覆盖，F259）"；(c) 新增"探针 C
补记 · 2026-08-06"一节，说明动机、机制与 BEHAVIOR_VERSION bump 理由，链接
`fix-report.md`。

### T016 既有 4 类用例组回归复核

```bash
$ npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts
Tests  23 passed (23)
```

= 改动前 20 条（a-track 5 + b-track fallback 2 + b-track 主用例 4 + 扰动注入组 9）
+ 本阶段净增 3 条（T009 边断言 1 + T013 隔离对照 1 + 裁定 4 正向不变量 1）。
特别核对扰动注入组用例：`perturbed.nodes[0]`/`links[0]` 均为泛型取任意元素做扰动，不硬编码
具体下标内容，不受新增 py 样本影响下标语义——已逐条通读确认。

---

## Phase 3：回归护栏核对（本仓自身重建）— 状态：完成

### T017 graph-only 重建 + 逐边 diff

**重要方法论发现**：编排器提供的"修复前基线"文件（节点 7362 / 边 12467，calls 3777，
depends-on 2586）经核实与本仓当前 HEAD（19bff52a）用同一命令、同一 git 仓库上下文的独立
复现结果（节点 7506 / 边 12628，calls 3813，depends-on 2599，用 `git archive HEAD` 导出到
无 `.git` 的临时目录构建，但该构建环境因缺失 `.git` 触发 F255 的
git-事实源→近似回退，与真实 git 仓库内构建口径不一致，不能直接采信）以及本次自建的
**受控 local A/B**（详见下）均不一致。为避免采信一个可能采集方法学有偏差的外部基线，
改用**同环境受控 A/B**：在**当前完整工作树**（含本次全部 fixture/代码改动，真实 git 仓库
上下文，与最终交付状态完全一致）下，仅临时切换 `call-resolver.ts` 的判据一行
（`imp.importType === undefined` 有 vs 无），两次构建保持其余一切变量（fixture 内容、
git 仓库上下文、node_modules、tsc 版本）完全相同，只隔离本次修复的唯一变量。

```bash
$ node dist/cli/index.js batch --mode graph-only   # 判据改动生效（post-fix）
节点: 7510 | 边: 12644 (calls 3820, depends-on 2606)

$ # 临时恢复 if (!hasBindingNames(imp)) { ... }（local-pre-fix，其余状态不变）
$ node dist/cli/index.js batch --mode graph-only
节点: 7510 | 边: 12644 (calls 3820, depends-on 2606)   # 完全相同
```

逐边 multiset diff（`source|target|relation` 为 key）：**LOST=0，GAINED=0**——本仓自身
当前源码树中**不存在**任何 `require()` 目标 lastSeg 与某个真实静态绑定名撞名的实例，
因此本次修复在**本仓自身发布的 `graph.json`** 这一层没有产生任何可观测的边集合变化（既没有
清除假边——因为本仓没有这种假边实例，也没有损失前述"巧合命中真边"——见 Phase 1
"内部对抗复审裁定 2"节的详细机制分析：`ts-import-types` fixture 里唯一已知的巧合命中实例
`cjs.cjsHello()`，其目标节点因 CJS 导出抽取能力边界从未真实存在于最终图，悬空过滤后修复前后
均不可见）。

**结论**（对齐"验收判据 (a)(b)(c)"）：
- (a) calls 边数量本仓层面无变化（3820 = 3820），因此无"下降的边"需逐条核实是否命中
  require 兜底覆写模式——本仓没有这类实例。
- (b) calls 边无"预期外"下降——净变化为 0，非预期外。
- (c) depends-on 边数量与"pre"（同环境受控基线）持平（2606 = 2606），差值 0，符合预期
  （`deriveImportEdges` 未被本次改动触碰）。

（编排器提供基线文件与"节点/边数量"不一致的根因已定位为**构建环境差异**（git 仓库上下文
是否存在，触发 F255 gitignore 事实源 vs 近似回退两种不同过滤口径），**非本次修复引入的
回归**——已在此如实记录该方法论排查过程，供后续复核参考。）

### T018 图质量门六指标核对

```bash
$ node dist/cli/index.js graph-quality --graph specs/_meta/graph.json --format text
Overall Verdict: pass
[duplicate-canonical-id] pass
[contains-coverage] pass (6218/6218, 100.0%)
[orphan-ratio] pass (超标 0/6218, 0.0%; 全节点 zero-degree 率 1.5%)
[dangling-edge] pass
[legacy-ignored] pass
[freshness] dirty (recorded=19bff52a..., current=19bff52a...)  # 工作树未提交，预期状态
```

对照同环境受控 pre-fix 基线（同上 T017 节）跑同一命令，六指标结果**逐字相同**——本次
修复对本仓自身图质量六指标无影响（与 T017 的 LOST=0/GAINED=0 结论一致）。`freshness: dirty`
是因为工作树有未提交改动，非回归（`recorded` 与 `current` commit hash 相同，只是内容脏）。

---

## Phase 4：记账修正 — 状态：完成

### T019 F249 FR-005(c) 据实补记

已在 `specs/249-graph-collector-fingerprint/verification/verification-report.md` 追加
"F259 补记 · 2026-08-06"一节（只追加不改写原有内容），明确记录"a-track 对 `#2 pyWalk`
管线此前在边面存在零独占覆盖窗口，已由 F259 补齐"，并澄清该窗口不构成对 F249 原有 Layer 1/
SC-010 判定的推翻（判定在其验证范围内成立，本补记澄清的是验证范围未覆盖的一个具体维度）。

---

## Phase 5：全量验证 — 状态：完成（含两处交叉影响修复）

### 交叉影响 1：`f220-decomposition-charter.e2e.test.ts` 冻结快照 9 处 behaviorVersion

`npx vitest run` 全量首跑发现 `tests/e2e/f220-decomposition-charter.e2e.test.ts` 9 处快照断言
失败，均为 `"behaviorVersion": 2` vs 实际 `3` 不一致（`BEHAVIOR_VERSION` bump 2→3 的连带影响，
该 e2e 用例的冻结快照内嵌了 collector fingerprint 结构）。

按 F255（`27ca1372`）先例做**外科替换**，**未使用 `vitest -u`**（F223/F232 纪律：冻结型快照
禁止 `-u` 再生，防止把"应该冻结的其他字段"一并悄悄改写）：

1. `grep -n '"behaviorVersion": 2'
   tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` 定位 9 处，逐处核对
   上下文（均为 `graph.graph.fingerprint.behaviorVersion` 字段，非同名异义字段）。
2. 用固定行号的 `sed` 逐行精确替换 `"behaviorVersion": 2,` → `"behaviorVersion": 3,`
   （非全局 `s/2/3/g`，避免误伤其他数字字段）。
3. `git diff` 确认恰好 9 处 `+`/9 处 `-`（10/10，含 diff header），无额外改动。
4. 重跑 `tests/e2e/f220-decomposition-charter.e2e.test.ts` → 12/12 绿。

### 交叉影响 2：collector-fingerprint-guardrail fixture `fixtureInputHash` 被自身验证工具污染

`npx vitest run` 全量首跑还发现 `tests/integration/collector-fingerprint-regen-script.test.ts`
4 处失败（放行场景 1 + 拒绝场景 2 + 内含的其余用例），根因排查：

- T007/T008 新增 `producer.py`/`consumer.py` 后，我在同一步骤内对这两个文件运行了
  `python3 -m py_compile <path>` 做语法校验——这在 fixture 目录内**就地**生成了
  `src/py/__pycache__/*.pyc` 字节码缓存文件。
- `computeFixtureInputHash`（`scripts/regen-collector-fingerprint-fixtures.ts`）的
  `collectFilesRecursively` **没有任何排除过滤**（不识别 `PY_SKELETON_IGNORE_DIRS`，也不识别
  `.gitignore`），逐字节纳入 `src/` 下的**一切**文件——包括这些本不该存在的 `.pyc` 缓存。
- T011 首次跑 `npm run fixtures:regen:collector-fingerprint` 时，这些 `.pyc` 文件仍在磁盘上，
  被计入 `fixtureInputHash`（当时记为 `bc3ece8c8120…`）并写入两份 pinned 资产。
- 后续 T014 变异矩阵的 symlink-handling 维度实验中，我为构造探针新建了
  `src/py/__pycache__/`（复用同名目录做"两套剪枝集合都排除"的隐藏目标），实验后清理
  `rm -rf .../src/py/__pycache__` 时，**连带清掉了 T007/T008 遗留的 `.pyc` 字节码**——这是一次
  无意的"意外修复"：`src/` 恢复到真正干净、可复现的状态，但此时 pinned 资产里记录的
  `fixtureInputHash`（`bc3ece8c8120…`）已经不再等于干净状态下的真实计算值。
- `git status`/`find` 等 git 感知或按类型过滤的检查**看不出这个问题**（`.pyc` 不受 git
  跟踪、`find -type f` 虽会列出但未被特别关注为"异常"）——这是本次唯一一处未能被
  `git status --short` 常规复核流程覆盖的隐患，记录在此供后续同类操作参考：
  **`python3 -m py_compile` 等本地语法校验工具若直接对 fixture 目录内文件执行，其产生的
  字节码缓存会污染任何"递归读取整个目录内容做 hash"的机制（不限于本例），应改为拷贝到
  临时目录校验，或校验后立即清理 `__pycache__`。**

**修复**：重跑 `npm run fixtures:regen:collector-fingerprint`——`computeFixtureInputHash`
在干净 `src/` 下重新计算得到 `8e00f28820fe…`（用独立探针脚本交叉验证：对 tracked 目录与
一份 `/tmp` 拷贝分别调用 `computeFixtureInputHash`，两次结果逐字节相同，确认该函数本身是
纯内容确定性的，问题完全出在输入内容含有意外文件）。核对重新生成的
`expected-graph-only-graph.json`：与本次修复前的版本相比，**唯一差异是 `fixtureInputHash`
字段值**（`bc3ece8c8120…` → `8e00f28820fe…`）+ 顶层 `nodeCount`/`edgeCount` 统计字段随之刷新，
graph 实际内容（nodes/links 数组）逐项比对确认**无任何变化**（新增节点/边仍是且仅是
T011 记录的那 4 个节点 + 4 条边，`git diff` 未出现任何重复或额外条目）；`expected-module-graph.json`
的 `moduleGraph` 字段同样保持不变（只有 `fixtureInputHash`/`behaviorVersion` 元数据刷新）。

重跑 `tests/integration/collector-fingerprint-regen-script.test.ts` → 13/13 绿。

### T020-T024 全量验证结果

```bash
$ npx vitest run
Test Files  522 passed | 4 skipped (526)
     Tests  7118 passed | 18 skipped | 21 todo (7157)
```
退出码 0，0 failed。

```bash
$ npm run test:plugins
ℹ tests 1484
ℹ pass 1484
ℹ fail 0
```
退出码 0。

```bash
$ npm run build
[postbuild:stamp] 盖章: commit=19bff52a (dirty)
```
`tsc` 零错误，退出码 0。

```bash
$ npm run repo:check
[repo-check] status=pass
```
退出码 0，全部子项 pass（含 graph-quality 六指标、spec-drift、model-literal-gate、
worktree-local-state 等全部族）。

```bash
$ npm run release:check
Release contract valid (contracts/release-contract.yaml)
```
退出码 0（本次改动不涉及 release contract 字段，预期通过，已实跑确认）。

**验证结果汇总**：
- 命令：`npx vitest run && npm run test:plugins && npm run build && npm run repo:check && npm run release:check`
- 退出码：全部 0
- 输出摘要：vitest 7118 passed/0 failed；test:plugins 1484 passed/0 failed；build 零错误；
  repo:check status=pass；release:check contract valid

---

## Phase 4a/4b 两路独立审查处置（2026-08-06，0 CRITICAL / 2 WARNING，均判定真问题）

### W1（spec-review · 记账不同步）—— 已处置

`plan.md` L137-158「改动点 2」小节与 `tasks.md` T003 描述/验收判据此前**均未标注已撤回**，
只有本文件（implementation-notes.md）单方面记录撤回事实——审计者若只读 plan/tasks 会得出
"双保险防御已实现且测试通过"的错误结论。

**处置**：
- `plan.md` 改动点 2 代码块与说明段落末尾追加 `> ⚠️ **已撤回**` 引用块，写明撤回理由
  （对抗审查实证会在 `import pkg.util` + `import util` 场景新造 Python 假边，且改动点 1
  落地后其作用面只剩 Python），并指向本文件 Phase 1「T003 双保险防御（改动点 2）——已撤回」节。
- `tasks.md` T003 描述末尾同样追加 `> ⚠️ **已撤回**` 引用块，说明代码改动未落地、对应单测
  已删除（非"用例绿"而是不存在）。**未改动 `[x]` 勾选状态本身**（T003 描述的"评估该方案是否
  可行"这一验证工作确实做了，结论是否决，勾选反映的是任务已执行完毕而非方案被采纳）。

未涉及代码/测试改动，无需重跑验证命令。

### W2（quality-review · 注释 over-claim + 护栏覆盖缺口）—— 已处置

**问题 1（注释 over-claim）**：`call-resolver.ts:272-278` 原注释声称"tree-sitter 降级路径
恒会显式设置 importType"是 mapper 自身的结构性保证。实测证伪：
`typescript-mapper.ts::_extractImportStatement`（静态 import_statement 分支，L813-905）
返回的 `ImportReference` **本身不含** `importType` 字段；该字段是调用方
`tree-sitter-analyzer.ts::analyze()`（L188-195，仅 `language === 'typescript'|'javascript'`
时触发）内联执行的 `postProcessTsJsImports()`（L312-327）事后回填的
（`importType: imp.importType ?? (imp.isTypeOnly ? 'type-only' : 'static')`）。
（补充实读确认：`_extractCallExpressionImport` 产出的 dynamic/commonjs-require 两类**自带**
`importType`，不依赖此回填——耦合脆弱点仅存在于 static/type-only 两类。）

**问题 2（护栏覆盖缺口）**：F259 裁定 3 新增的不变量护栏用
`collectTsJsCodeSkeletons(..., { extractCallSites: true })` 驱动，按 `ts-js-adapter.ts`
EC-11 规则，registry 已注册 ts-js adapter 时 imports/exports 恒来自 **ts-morph 主路径**，
tree-sitter 侧的 imports 被丢弃——该护栏完全没有覆盖注释点名的 tree-sitter 降级路径。

**处置**：
1. 重写 `call-resolver.ts:272-278` 后追加的注释段，如实说明该不变量是"两个函数协同才成立
   的隐式耦合"、靠"全仓唯一调用点"维持，而非 mapper 输出契约本身承诺；点明
   dynamic/commonjs-require 与 static/type-only 两类的耦合强度不同（前者自带、后者依赖回填）。
2. 新增 `describe('F259 裁定 3 补充 — tree-sitter 降级路径（绕开 EC-11 discard）产出的 4 类
   import 均带 importType')`（`call-resolver.test.ts`），**直接**调用
   `TreeSitterAnalyzer.getInstance().analyze(filePath, 'typescript')`（不经
   `collectTsJsCodeSkeletons`/registry，绕开 EC-11 discard 规则），对含 4 类 import 语句的
   单文件样本断言 `importType` 均非 `undefined` 且恰好覆盖 4 类取值。

```bash
$ npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts -t "F259 裁定 3 补充"
✓ TreeSitterAnalyzer.analyze() 直接产出的 static/type-only/dynamic/commonjs-require 四类 import 均定义 importType
Tests  1 passed | 69 skipped (70)
```

```bash
$ npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts
Tests  70 passed (70)   # 69 既有 + 1 本次新增
```

```bash
$ npx vitest run   # 全量回归
Test Files  522 passed | 4 skipped (526)
     Tests  7119 passed | 18 skipped | 21 todo (7158)   # 7118 + 1 本次新增
```

```bash
$ npm run build
[postbuild:stamp] 盖章: commit=19bff52a (dirty)   # tsc 零错误，退出码 0
```

全部退出码 0，0 failed，无回归。

### INFO（T013 隔离对照用例同义反复但无害）—— 不处置

按编排器指示保留：该用例已在自身注释中自我披露局限性，并配有 #11 正向不变量
（`extractSymbolNodes` 只产 `contains` 边）作为真正的护栏，无需额外改动。
