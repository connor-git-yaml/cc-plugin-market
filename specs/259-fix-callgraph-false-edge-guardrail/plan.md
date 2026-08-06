# Implementation Plan（FIX 模式）: F259 调用图确定性假边收口 + collector 指纹护栏 py 侧盲区补齐

**Branch**: `claude/f259-call-graph-guardrail-fix-44d1e2` | **Date**: 2026-08-06
**Input**: `specs/259-fix-callgraph-false-edge-guardrail/fix-report.md`（5-Why 根因 + 编排器亲自复现的实证探针）

> 审查档位声明：延续 fix-report 顶部声明——Codex 配额耗尽期，本计划按 `CLAUDE.local.md`
> 暂停节执行「独立子代理异构对抗 ≥2 切入角」，implement 阶段 commit 须显式标注
> 「Codex 审查暂停，异构档位缺席」。

## Summary

两处图正确性缺陷共同点是"现有测试全绿但守护力有洞"：

1. **缺陷 1（确定性假边）**：`call-resolver.ts` 的 moduleSpecifier 兜底别名（`registerSpecifierFallback`）
   只对 `dynamic` 上闸，`commonjs-require` 走同一路径无闸，`require('./dep.js')` 会把别名
   `js` 写成 `dep.ts`，覆盖同名静态绑定 `import { js } from './lit.js'`，产出两端都是真实节点的
   假边（能存活 graph-builder 的悬空过滤）。
2. **缺陷 2（护栏盲区）**：`collector-fingerprint-guardrail.test.ts` 的 a-track 对整条 `#2 pyWalk`
   管线零独占覆盖——该管线整体被删除，护栏仍 20/20 全绿，`BEHAVIOR_VERSION` bump 纪律在 py 侧
   完全失灵。

本计划采纳 fix-report **方案 A**：缺陷 1 把闸的判据从"importType 值枚举"改为"该 import 是否
经过 TS/JS 路径字面量语义抽取"（用已存在的 `importType` 字段的**存在性**而非枚举特定值判定，
下节详述判据设计）；缺陷 2 给 fixture 增补一对能产出 `#2` **独占**边（depends-on + calls）的
py→py 样本，并把 a-track 断言从"节点 id 存在"升级为"`#2` 独占的边存在"。

## Codebase Reality Check

| 目标文件 | LOC | 方法/函数数 | 已知 debt |
|---------|-----|------------|-----------|
| `src/knowledge-graph/call-resolver.ts` | 707 | 14（含 2 个内部 helper：`hasBindingNames`/`registerSpecifierFallback`） | 无 TODO/FIXME/HACK（grep 0 命中）；无超长函数（最长 `resolveOne` ~140 行，`buildImportIndex` ~110 行，均 <200 行阈值） |
| `tests/unit/knowledge-graph/call-resolver.test.ts` | 1785 | N/A（测试文件） | 无 TODO/FIXME；已有 F242 复审轮同类用例（L1698-1785）可直接参照风格新增，不触发"文件>500行+新增>50行"前置清理规则（本次新增预计 <60 行，且改动是同构追加而非重构） |
| `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | 391 | N/A（测试文件） | 无 debt；F249/F250/F252/F255 历次修订均走同一文件追加模式 |
| `tests/fixtures/collector-fingerprint-guardrail/README.md` | 64 | N/A | 无 debt；覆盖表需新增一行 + 补记一节（沿用既有"rebase 调和补记"体例） |
| `src/batch/stages/source-discovery.ts`（只读参照，`collectPythonCodeSkeletons`） | 598 | 只读，不修改 | 无 |
| `src/batch/stages/graph-assembly.ts`（只读参照，`buildAstGraphOnly` 合并点） | 328 | 只读，不修改 | 无 |
| `src/adapters/python-adapter.ts`（只读参照，`extractSymbolNodes`） | 482 | 只读，不修改 | 无 |

**前置清理判定**：均不满足"LOC>500 且新增>50行" / "3+ 相关 TODO" / "30+ 行重复逻辑"任一触发条件，
**不需要** `[CLEANUP]` 前置任务。

## Impact Assessment

- **直接修改文件数**：7（`call-resolver.ts`、`call-resolver.test.ts`、
  `collector-fingerprint-guardrail.test.ts`、fixture README、2 个新增 py 样本文件、
  2 份 pinned JSON 资产经脚本再生——后者算作 1 组再生产物）
- **间接受影响（经 `mcp__plugin_spectra_spectra__impact` 校验）**：对
  `call-resolver.ts::buildImportIndex` 做 `direction=both depth=2` BFS，`riskTier: "low"`，
  `directCallers: 2`（`resolveCalls` + 本文件自身单测）、`transitive: 7`（`buildClassMemberIndex`
  / `buildClassMroIndex` / `buildModuleSymbolIndex` / `buildUnifiedGraph` / `extractClassName` 等），
  全部在 `src/knowledge-graph/` 内部或其单测，**无跨包传播**。
- **跨包影响**：0（改动完全落在 `src/knowledge-graph/` + `tests/`，未触及 `plugins/`、`scripts/`
  对外入口）。
- **数据迁移**：无 schema / 配置格式变更；仅测试 fixture 的 pinned JSON 资产按既有脚本
  （`npm run fixtures:regen:collector-fingerprint`）再生，属于既定的"fixture 变更 → 脚本再生"
  流程，不是数据迁移。
- **API/契约变更**：无。`buildImportIndex` / `resolveCalls` / `registerSpecifierFallback`
  三者签名不变，只改内部判据；`ImportReference` / `CodeSkeleton` schema 不变；
  `collector-fingerprint-guardrail.test.ts` 断言的是既有 pinned 资产格式，不新增字段。
- **风险等级**：**LOW**（影响文件 <10，跨包影响 0，无数据迁移，无契约变更）。不触发
  "HIGH 风险强制分阶段"规则；但两处缺陷本身相互独立、验证方式不同，仍按下文"阶段 A / 阶段 B"
  组织实现顺序（各自可独立验证，非风险等级强制，是可读性与可回滚性的自然选择）。
- **旁证影响面（已用 Grep 排查，非本计划修改范围但需在 implement 阶段跑通）**：
  `tests/fixtures/collector-fingerprint-guardrail/` 被以下 3 处消费，新增 py 样本后须确认
  三者均不受影响或按预期变化：
  - `tests/adapters/python-adapter.test.ts::T-SC005-control`——硬编码引用
    `tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi` 单一路径做剪枝集对照，
    **不枚举目录内容**，新增 `producer.py`/`consumer.py` 不影响该用例。
  - `tests/integration/collector-fingerprint-regen-script.test.ts`——驱动再生脚本 CLI
    行为（拒绝判据、`--init` 流程），不断言 fixture 内部文件内容，仅依赖脚本可正常运行。
  - `specs/249-graph-collector-fingerprint/` 系列制品（`plan.md`/`tasks.md`/`data-model.md`/
    `verification-report.md`）——记录 F249 原始设计意图，其中 FR-005(c) 相关验收记账与本次
    发现的"a-track 对 `#2` 零独占覆盖"事实不符，需要在 implement/verify 阶段据实修订或补记
    （fix-report「Spec 影响」节已指出，非阻断本次代码修复的前置条件）。

## 修复设计 — 缺陷 1：call-resolver.ts 确定性假边

### 判据设计（核心决策）

**不采用**继续列举 `importType !== 'dynamic' && importType !== 'commonjs-require'` 这种值枚举
式追加（root cause 本身就是这种模式——新增一个 `commonjs-require` 值就漏一次）。

**采用**：把 `hasBindingNames(imp)` 判定之外，新增一个**结构性存在性判据**——
`imp.importType === undefined`。理由（均已用 Grep + Read 核实源码逐路径确认，非推测）：

| 语言/路径 | `importType` 是否被设置 | 依据 |
|-----------|------------------------|------|
| TS/JS ts-morph 主路径（`ast-analyzer.ts::extractImports`） | **恒设置**（`'static'` / `'dynamic'` / `'type-only'` / `'commonjs-require'` 四选一，L477-509、L516-552） | 静态 import 分支显式赋值；dynamic/require 分支 `kind` 变量必赋值才 push |
| TS/JS 正则降级路径（`tree-sitter-fallback.ts::extractImportsFromText` / `addCallExpressionImport`） | **恒设置**（L144 `importType: isTypeOnly ? 'type-only' : 'static'`；L262+L274 `addCallExpressionImport` 形参 `importType` 直接透传） | 与 ts-morph 路径行为对齐（同一 `ImportSemanticType` 枚举） |
| Python 主路径（`python-mapper.ts::_extractImportStatement` / `_extractImportFromStatement`） | **恒不设置**（L697-776 两处返回对象字面量均无 `importType` 键） | 逐行读取确认，无遗漏分支 |
| Python 正则降级路径（`tree-sitter-fallback.ts::extractPythonImportsFromText`） | **恒不设置**（L325-362 两处返回对象字面量均无 `importType` 键） | 同上 |
| Java（`java-mapper.ts::_extractImportDeclaration`） | 不设置；但几乎恒有 `namedImports`（`java.util.List` 的 `lastDotIdx>0` 恒真），本就不会走到兜底分支——不受本次判据变更影响 | L523-565 逐行确认 |
| Go（`go-mapper.ts`） | 不设置；`import "fmt"` 无绑定名会继续走兜底（`fmt` 本身就是调用标识符，语义与 Python 绝对 import 同类） | L484-553 逐行确认，本次判据变更**不改变** Go 现状（`importType` 本来就 undefined，新旧判据结果一致） |

即：`importType` 字段的"是否被设置"这一存在性事实，**恰好且仅**由 TS/JS 两条抽取路径显式赋值，
Python / Java / Go 三条路径从未设置。用它做主判据，语义上精确表达"该 specifier 是否经过
TS/JS 路径字面量语义系统标注"，比"specifier 是否以 `.`/`/` 开头"（`isRelative`）更可靠——
`require('lodash.debounce')`（真实存在的 npm 包命名惯例）这类**非相对但含点**的 bare specifier，
`isRelative` 判不出来但 `importType==='commonjs-require'` 判得出来；同时该判据完全不依赖
`importType` 具体取值，未来 TS/JS 抽取层新增第 5 个 `ImportSemanticType` 枚举值时**自动纳入**
拦截范围，不需要在 call-resolver.ts 里同步追加白名单/黑名单条目。

### 代码改动点

**改动点 1**（`buildImportIndex` 第一遍循环，约 L272-274）：

```ts
// before
if (!hasBindingNames(imp)) {
  registerSpecifierFallback(imp, target, aliasToTarget);
}

// after
if (!hasBindingNames(imp) && imp.importType === undefined) {
  registerSpecifierFallback(imp, target, aliasToTarget);
}
```

- Python 三类 import（`import numpy`、`from . import nn, Value`、`from os.path import join`）
  `importType` 恒 `undefined` → 判据不变，行为逐字保持（既有回归锚 test (c) L1770-1784 覆盖）。
- TS `require('./dep.js')`（`commonjs-require`）→ `importType` 已定义 → **不再**调用
  `registerSpecifierFallback`，`js` 别名不会被覆写，静态绑定 `js→lit.ts` 保持权威。
- **副作用（预期内、非范围外功能）**：TS 静态 side-effect-only import（如
  `import './styles.css'`，无 named/default/namespace）过去也会误触发同一个兜底 bug（同根同因，
  只是概率更低、未被 fix-report 单独列出），此改动会一并关闭——因为其 `importType==='static'`
  同样满足"已定义"。这是判据设计的自然覆盖面而非刻意扩大修复范围，落地时补一条回归用例记录该
  副作用（见测试计划）。
- **不影响 depends-on 边**（fix-report 强约束"不得取消 require 的 depends-on 边"）：已用
  `mcp__plugin_spectra_spectra` + 源码核实，`deriveImportEdges`（`src/knowledge-graph/index.ts`
  L142-165）完全独立于 `aliasToTarget`，只读 `imp.resolvedPath` 派生 depends-on 边，与
  `registerSpecifierFallback` 无耦合——本改动结构上不可能影响 depends-on 边计数。
- **不影响 require 调用边覆盖率**：fix-report 探针已实证 `require('./dep.js')` 场景下
  `dep.helper()` 调用**在改动前也从未解析成功**（`dep` 这个真实绑定名从未进 aliasToTarget，
  因为 `const dep = require(...)` 的变量名绑定不在 `ImportReference` 抽取范围内），故本次移除
  `lastSeg`/`moduleSpecifier` 双重兜底别名对 recall 是**零负贡献**，对 precision 是纯正贡献。

**改动点 2**（`registerSpecifierFallback` 内部，双保险防御，方案 A 明确要求）：

```ts
// before
function registerSpecifierFallback(...): void {
  const lastSeg = imp.moduleSpecifier.split('.').pop() ?? imp.moduleSpecifier;
  aliasToTarget.set(lastSeg, target);
  aliasToTarget.set(imp.moduleSpecifier, target);
}

// after
function registerSpecifierFallback(...): void {
  const lastSeg = imp.moduleSpecifier.split('.').pop() ?? imp.moduleSpecifier;
  if (!aliasToTarget.has(lastSeg)) aliasToTarget.set(lastSeg, target);
  if (!aliasToTarget.has(imp.moduleSpecifier)) aliasToTarget.set(imp.moduleSpecifier, target);
}
```

- 作用：即便未来某条件仍触发本函数（如同文件内两个 Python 绝对 import 的 lastSeg 恰好
  同名），也不会覆盖**先写入**的任何 alias（含同一循环内更早的静态绑定 `.set()`）。
- 与改动点 1 是互补关系，非重复：改动点 1 从源头堵住 TS/JS 路径进入本函数；改动点 2 堵住
  "万一进来了也不覆写"的下游防线，两层防御针对不同攻击面（"是否进入"vs"进入后是否覆写"）。

> ⚠️ **已撤回**（implement 阶段内部对抗复审裁定 2，2026-08-06）：改动点 2 未落地，
> `registerSpecifierFallback` 保留原样的无条件 `.set()`（last-write-wins）。撤回原因：
> 改动点 1 落地后 TS/JS 已完全进不了本函数，改动点 2 的实际作用面**只剩 Python**——
> "两层防御针对不同攻击面"这一描述与事实不符，第二层防御是空转的；更严重的是它会在真实
> 存在的 Python 命名模式下**新造假边**（`import pkg.util` + `import util` 场景：
> first-write-wins 会让后写入的 `import util` 被 `.has('util')` 挡下，`util.f()` 解析到
> 错误的 `pkg/util.py::f`，而 base 行为反而正确）。详见
> `implementation-notes.md` Phase 1「T003 双保险防御（改动点 2）——已撤回」节的完整实证与
> 反例推导。

### Python `import numpy` 回归验证

既有单测 `F242 复审轮 修复 2 — dynamic 无绑定项跳过 specifier 兜底` describe 块下的用例
`(c) 回归锚 — 静态无绑定 import 的 specifier 兜底保持不变（Python import X 路径）`
（`call-resolver.test.ts` L1770-1784）已经是本次改动的现成回归锚：其 skeleton 的两条 import
均不带 `importType` 字段（对齐 python-mapper.ts 真实产出），新判据下 `imp.importType===undefined`
恒真，`hasBindingNames` 恒假（无 named/default/namespace），故 `registerSpecifierFallback`
仍被调用，`numpy`/`path`/`os.path` 三条 alias 仍写入——**该用例改动前后必须逐字通过，不修改**。

## 修复设计 — 缺陷 2：collector-fingerprint-guardrail 护栏 py 侧盲区

### 两条生产者的输出面差异（已实读源码确认，非推测）

| 生产者 | 触达路径 | 产出节点 | 产出边 |
|--------|---------|---------|--------|
| `#2 pyWalk`（`collectPythonCodeSkeletons`，`source-discovery.ts` L253-350） | `graph-assembly.ts::buildAstGraphOnly` L217 → `buildUnifiedGraph` | 不直接产节点（贡献 `codeSkeletons` 给 `buildUnifiedGraph` 派生） | **calls**（经 `call-resolver.ts::resolveCalls`，因 `extractCallSites: true`）+ **depends-on**（经 `deriveImportEdges`，因显式解析 `imp.resolvedPath`，见 `collectPythonCodeSkeletons` 内 `resolvePythonImport` 调用链，L290-343） |
| `#11 pythonSymbolScan`（`PythonLanguageAdapter.extractSymbolNodes`，`python-adapter.ts` L200-279） | `graph-assembly.ts::buildAstGraphOnly` L241 → `buildKnowledgeGraph` 的 `extractionResults` 分支 | module 节点（每文件）+ component 节点（每 export 符号） | **仅 contains**（module→component，L266-272）；`analyzeFile` 调用**不传** `extractCallSites`，且函数体内**从不读取** `skeleton.imports`——结构上不可能产出 calls/depends-on |

现有 fixture 样本 `mod.py`（`def mod_fn(): return 1`）/ `mod.pyi`（`def mod_fn() -> int: ...`）
均无 import、无函数调用，两条生产者在这两个样本上的输出**只有节点、没有边**——节点 id 又完全
重合（同一 `{relPath}::{name}` 规则），去重后 `#2` 在这两个样本上对最终图**零独占贡献**，这正是
探针 C（把 `pythonSkeletons` 从 `graph-assembly.ts` 的合并里整体剔除，护栏仍 20/20 全绿）成立的
根因。

### fixture 增样设计

新增两个文件（`tests/fixtures/collector-fingerprint-guardrail/src/py/`）：

- `producer.py`：
  ```python
  # #2 pyWalk 独占覆盖样本（py→py import + call，#11 pythonSymbolScan 产不出这类边）。
  def make() -> int:
      return 42
  ```
- `consumer.py`：
  ```python
  # 与 producer.py 构成真实 py→py 依赖，validate #2 对 depends-on/calls 边的独占贡献。
  from .producer import make


  def use() -> int:
      return make()
  ```

设计要点（均已核实 resolve 链路会命中）：

- `from .producer import make` 是单点相对 import（`level=1`），
  `resolvePythonImport('.producer', <consumer.py 绝对路径>, projectRoot)`
  （`src/knowledge-graph/import-resolver.ts` L160-230）会在 `baseDir=path.dirname(callerFile)`
  （即 `src/py/`）下尝试 `producer.py`，文件存在即命中，`resolvedPath='src/py/producer.py'`——
  产出 **depends-on** 边 `src/py/consumer.py → src/py/producer.py`。
- `make` 是具名 import（`namedImports: ['make']`），`hasBindingNames` 为真，call-resolver
  Stage 3（cross-module）会在 `use()` 的 callSite 上查表命中 `aliasToTarget.get('make')`，
  产出 **calls** 边 `src/py/consumer.py::use → src/py/producer.py::make`（medium confidence，
  非通配 import）。
- `extractSymbolNodes` 处理这两个文件时只会各自产出 1 个 module 节点 + 1 个 component 节点
  + 1 条 contains 边（`src/py/consumer.py` / `::use`、`src/py/producer.py` / `::make`）——
  **不会**产出上述 depends-on / calls 边，因为该函数体内代码路径从未涉及 `imp.resolvedPath`
  或 `callSites`（已通读 L200-279 全函数确认）。两条生产者在这两个新样本上因此**节点面重合、
  边面分叉**，边面分叉即是"#2 独占覆盖"的可断言证据。
- 不违反 fixture README 现有"禁止事项"：不新增大小写变体、不手工编辑 `expected-*.json`、
  不新增 `*.test.ts`/`*.spec.ts` 命名文件。

### 断言升级设计

1. **a-track 覆盖面用例升级**（`collector-fingerprint-guardrail.test.ts`，扩展现有
   "覆盖 #1 六扩展 + #2 两扩展 + #3 大小写变体样本" 用例，或新增一条同级用例）：
   断言 `rebuiltGraph.links` 中存在
   `{ source: 'src/py/consumer.py', target: 'src/py/producer.py', relation: 'depends-on' }`
   与
   `{ source: 'src/py/consumer.py::use', target: 'src/py/producer.py::make', relation: 'calls' }`
   两条具体边（禁止仅断言"边数非空"，对齐 README 与既有 `ENTRY_MODULE_ID`/`FOO_MODULE_ID`
   精确端点断言先例，P10 纪律）。
2. **隔离对照用例（新增，永久单测，非临时探针）**：在测试内直接调用
   `buildUnifiedGraph({ projectRoot, codeSkeletons: <仅 tsJs + generic，显式排除 python> })`，
   断言其产物中**不存在**上述 depends-on/calls 边——用生产函数的合法调用方式（缩小
   `codeSkeletons` 入参）复现探针 C 的因果链，而不需要像 fix-report 探针那样临时改
   `graph-assembly.ts` 源码。这条用例是"#2 pyWalk 是这两条边的唯一生产者"的可维护、可重跑证据，
   避免退化为一次性人工验证。
3. **README 覆盖表修正**：
   - `src/py/mod.py`、`mod.pyi` 行的覆盖意图保持"`#2 pyWalk`"表述，但补一条脚注说明：
     这两个样本**仅覆盖节点面**（扩展名声明面 SC-005b），不覆盖边面独占性；
   - 新增一行：`src/py/producer.py`、`consumer.py` | `#2 pyWalk`（边面独占覆盖）|
     "补齐 depends-on/calls 边的 `#2` 独占可见性，防止整条管线被删除而护栏无感（探针 C）"；
   - 参照既有"rebase 调和补记"体例，补一节"探针 C 补记"说明本次 fixture 变更的动机与
     `fix-report.md` 的引用链接。

### pinned 资产再生路径

**禁止手工编辑** `expected-graph-only-graph.json` / `expected-module-graph.json`
（README 禁止事项 2）。新增 py 样本后必须执行：

```bash
npm run fixtures:regen:collector-fingerprint
```

再生后需确认：

- 两份资产的 `fixtureInputHash` 仍彼此一致（README「两份 pinned 资产的 fixtureInputHash
  彼此一致」用例会自动校验，无需手工核对）；
- `expected-module-graph.json` 的 `moduleGraph` **不应**因新增 py 文件而变化（b-track 只覆盖
  `MODULE_DERIVATION_SCAN_SURFACE` 声明的 TS/JS 扩展名，python 文件不在其扫描面内——若再生后
  b-track 资产确有变化，说明扫描面判断有误，需回退设计重新核实，不得强行接受）；
- `expected-graph-only-graph.json` 的 `graph` 应新增：2 个 module 节点、2 个 component 节点、
  1 条 contains 边（×2 文件）、1 条 depends-on 边、1 条 calls 边——与上文设计逐项对应。

## 测试计划（红用例先行）

### 缺陷 1

1. **红用例先行**：新增单测复刻 fix-report 探针（`call-resolver.test.ts`，追加到既有
   `F242 复审轮 修复 2` describe 块或新开一个 `F259` 专属 describe 块）：
   - skeleton 含 `import { js } from './lit.js'`（static，`namedImports: ['js']`）+
     `require('./dep.js')`（`commonjs-require`，无绑定名）；
   - 断言 `buildImportIndex(...).get(...).aliasToTarget.get('js')` 等于静态绑定目标
     （`'src/lit.ts'` 或等效值），**不等于** require 的目标；
   - 断言 `resolveCalls` 对 `js()` 调用产出的边 `target` 指向静态绑定文件，不产出
     `::js` 假边指向 require 目标。
   - 在改动前跑此用例确认**红**（复现 bug），改动后确认**绿**。
2. **回归用例**：`require('./dep.js')` 场景下 `depends-on` 边仍存在（走
   `deriveImportEdges`，与 call-resolver 改动无关但需断言"未被误伤"）。
3. **副作用回归用例**：TS 静态 side-effect-only import（`import './x.css'`，无
   named/default/namespace）不再注册 `css` 类垃圾别名（与 dynamic/require 同口径）。
4. **既有回归锚复跑**：`call-resolver.test.ts` 全量（1785 行，含 Python 7 case + F242
   两轮修订用例）必须逐字保持绿，尤其 L1770-1784 的 `(c)` 用例（Python 路径不受影响的
   直接证据）。

### 缺陷 2

1. **红用例先行**：fixture 增样 + 断言升级完成后，implement 阶段必须先在**未改动
   call-resolver.ts、未改动 graph-assembly.ts** 的当前 master 基线上跑一次
   `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（此时
   pinned 资产尚未再生，新断言会因 pinned 里没有这两条边而红）——用于确认"新断言确实在测
   真实缺口"而非"自证式必然通过"。
2. **再生 + 绿转换**：跑 `npm run fixtures:regen:collector-fingerprint` 重建两份 pinned
   资产，重跑护栏测试，确认新断言与基础比对（`compareGraphOnlyStructure` multiset 相等）
   均转绿。
3. **探针 C 等价验证**（复刻 fix-report 决定性证据，用「隔离对照用例」的方式做成永久单测，
   见上文设计要点 2）：断言排除 python codeSkeletons 后 depends-on/calls 边缺失，证明
   `#2` 对这两条边的**唯一生产者**地位。
4. **变异矩阵**（对 py 侧 5 个 bump 维度逐个验证新护栏可红，implement 阶段以临时变异 + 观察
   红/绿、不作为永久测试代码提交）：
   - **ignore-dirs-pruning**：临时把 `PY_SKELETON_IGNORE_DIRS`（`source-discovery.ts`
     L237-240）新增 `'py'` 目录别名或改动剪枝集合，验证护栏因扫描文件集变化而红；
   - **gitignore-interpretation**：临时改 `createGitignoreFilter` 的调用方式或传入不同
     `resolvedRoot` 基准，验证过滤层变化可被捕获；
   - **symlink-handling**：验证现有护栏对 `walkPyFiles` 的 symlink 穿越行为敏感（若当前无
     symlink 专项处理，需如实记录"该维度当前无差异探测点"而非编造断言）；
   - **file-size-guard**：临时调低 `MAX_FILE_BYTES`（L274，当前 1MB）使 producer.py/
     consumer.py 被跳过，验证护栏因文件被排除而红；
   - **collection-failure-degradation**：临时让 `adapter.analyzeFile` 对 producer.py 抛异常
     （模拟解析失败），验证护栏能感知"该文件从 codeSkeletons 消失"。
   - 每个维度跑通后记录到 fix-report / commit message 的"变异矩阵结果"表，**不满足**任一维度
     可红时必须诚实标注该维度"当前无法被本护栏捕获"，不得虚报覆盖。
5. **既有 4 类用例组回归**：a-track 基础比对、b-track 基础比对、b-track fallback、扰动注入组
   （T047 三件套）全部保持绿，尤其扰动注入组的"篡改一个节点 id"/"重复一条边"等用例——新增的
   两个 py 样本会改变 `rebuiltGraph.nodes[0]`/`links[0]` 等下标语义，需确认这些用例仍取
   任意元素做扰动、不依赖具体下标内容（已读代码确认为 `perturbed.nodes[0]`/`links[0]` 泛型
   取值，不硬编码具体 id，**不受影响**）。

### 回归护栏核对（本仓自身重建）

1. `spectra graph`/`npm run baseline:collect -- --target self-dogfood --mode full`
   或等效的 graph-only 重建命令（implement 阶段按当时可用命令确定，本计划不预设具体
   CLI 参数）跑一次本仓自身的 graph-only 重建。
2. 与修复前基线（节点 7506 / 边 12628 / calls 3813，fix-report 记录的当前基线）做**逐边
   diff**（非仅计数比对）：
   - calls 边数量若下降，需确认下降的每一条边的 caller/callee 是否命中"require 兜底覆写"
     模式（即修复前该边的 target 是被覆写别名指向的错误节点）——是则为假边清除，属预期；
   - calls 边数量不得出现"预期外"下降（如 Python 路径的调用边意外消失），若出现需回退分析；
   - depends-on 边数量应**不变或持平**（本次改动不触碰 `deriveImportEdges`）。
3. 图质量门（F217 六指标：orphan / dangling / duplicate / ignored / freshness 等，具体
   命令视仓库当前 `npm run` 脚本而定）不得回落。

### F242/F243/F250 既有护栏不得回退

- F242 三级归属回退链（`resolveSourceId`）：未改动，回归测试自动覆盖（既有单测不动）。
- F243 `.mjs`/`.cjs` 采集面：未改动 `collector-surface.ts` / `TSJS_SKELETON_WALK_SURFACE`，
  a-track 现有"两轨覆盖面不等价"用例（L176-182）逐字保留。
- F250 `.pyi` 采集面：未改动 `PY_WALK_SURFACE`/`PYTHON_SYMBOL_SCAN_SURFACE`，`mod.pyi`
  样本继续覆盖扩展名声明面（节点面），仅新增样本覆盖边面，不替代不删除。

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | 通过 | 本 plan.md 中文散文 + 英文标识符；implement 阶段代码注释同规范 |
| II. Spec-Driven Development | 适用 | 通过 | 本次修复走 fix-report → plan → tasks → implement → verify 全链路，未绕过流程直接改源码 |
| III. YAGNI | 适用 | 通过 | 判据设计选择"复用已有 `importType` 字段存在性"而非新增 `specifierKind` 枚举字段（曾评估但放弃，见 Complexity Tracking），未引入不必要抽象；fixture 增样仅 2 个文件，未过度设计覆盖矩阵 |
| IV. 诚实标注不确定性 | 适用 | 通过 | 变异矩阵中若有维度无法验证可红，要求如实标注而非虚报；探针 C 隔离对照用例复现因果链而非断言"应该没问题" |
| V-VIII（spectra 技术约束） | 适用 | 通过 | 改动全部落在 AST 解析产出的结构化数据修正范围内，无 LLM 参与结构化字段；未引入非 Node.js 依赖 |
| IX-XIV（spec-driver 约束） | 不适用 | N/A | 本次修复不改动 `plugins/spec-driver/` 任何文件 |

无 VIOLATION，无需豁免论证。

## Project Structure

### 本次涉及文件（无新增目录）

```text
specs/259-fix-callgraph-false-edge-guardrail/
├── fix-report.md              # 已存在（前置制品）
└── plan.md                    # 本文件

src/knowledge-graph/
└── call-resolver.ts           # 改动点 1 + 2（buildImportIndex 判据 + registerSpecifierFallback 防御）

tests/unit/knowledge-graph/
└── call-resolver.test.ts      # 新增红用例 + 回归用例（追加，非重构）

tests/unit/guardrail/
└── collector-fingerprint-guardrail.test.ts   # 断言升级 + 隔离对照用例（追加）

tests/fixtures/collector-fingerprint-guardrail/
├── README.md                          # 覆盖表新增一行 + 补记一节
├── src/py/producer.py                 # 新增
├── src/py/consumer.py                 # 新增
├── expected-graph-only-graph.json     # 经脚本再生，禁手工编辑
└── expected-module-graph.json         # 经脚本再生，禁手工编辑
```

**Structure Decision**：单项目结构（本仓库既有布局），无需新增顶层目录；改动完全落在
既有 `src/knowledge-graph/` 与 `tests/` 两个既有目录内，符合"最小化变更范围"约束。

## Complexity Tracking

| 曾评估但放弃的方案 | 为何不采用 | 采用的更简单替代 |
|--------------------|-----------|-----------------|
| 给 `ImportReference` 新增显式语义字段（如 `specifierKind: 'path' \| 'dotted-module'`），由每个 mapper 显式标注 | 需改 `code-skeleton.ts` schema + 5 个 mapper（ts-morph/tree-sitter-fallback×2 语言/java/go）+ 所有构造 `ImportReference` 字面量的既有单测，改动面远超"最小化变更范围"约束；且当前 `importType` 字段的存在性已**恰好**精确刻画所需语义（已逐路径核实，见判据设计表），新增字段是重复表达同一事实 | 复用 `imp.importType === undefined` 作为存在性判据，零 schema 变更，零 mapper 改动 |
| 缺陷 2 用"临时 monkey-patch `graph-assembly.ts` 源码"的方式把探针 C 做成永久回归测试 | 违反"编排器/测试不应依赖修改生产源码来验证"原则，且该改法一旦生产代码结构调整（如函数改名、合并顺序调整）测试会静默失效或需要同步改生产代码 | 用「隔离对照用例」——直接调用 `buildUnifiedGraph` 并显式收窄 `codeSkeletons` 入参（合法公开 API 用法），复现同等因果链而不接触生产源码内部结构 |
| 给 5 个 py 侧 bump 维度各写一条永久单测固化到护栏文件 | 部分维度（如 symlink-handling）当前可能确无差异探测点，强行编造断言会产出"看似覆盖实则永远绿"的假护栏，与本次修复要解决的问题（护栏虚假绿灯）自相矛盾 | implement 阶段以临时变异 + 观察红/绿的方式验证，结果记入 fix-report/commit message；仅当某维度确认有可断言的差异点时才转为永久用例 |

## 后续建议（非本次范围，供 tasks.md 或后续 Feature 参考）

- `specs/249-graph-collector-fingerprint/` 的 FR-005(c) 验收记账需要据实修订：明确记录
  "a-track 对 `#2 pyWalk` 管线此前存在零独占覆盖窗口，已由 F259 补齐边面覆盖"，避免未来审计
  时误读为"F249 从未有过盲区"。
- Go 侧 `import "net/http"` 场景的 `registerSpecifierFallback` 用 `split('.').pop()` 取
  lastSeg 语义上不对齐 Go 的 `/` 路径分段（真正的包标识符应取最后一个 `/` 段而非 `.` 段），
  是既有 recall 缺口而非本次引入的假边，不在 F259 范围内，留作后续 Go 语言支持精化的候选项。
