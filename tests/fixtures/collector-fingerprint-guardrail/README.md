# collector-fingerprint-guardrail fixture（F249）

本目录是 F249 双轨重建-对比护栏（FR-005）的 **hermetic 输入**：内容完全钉死，任何改动都会
被再生脚本的二元拒绝判据当作"行为面基线变更"处理。

## 目录结构与覆盖意图

| 路径 | 覆盖的采集管线 | 意图 |
|------|---------------|------|
| `src/ts/foo.ts`、`foo.tsx`、`bar.js`、`bar.jsx` | #1 `tsjsSkeletonWalk` | 声明面前四扩展（大小写敏感面） |
| `src/py/mod.py`、`mod.pyi` | #2 `pyWalk` | 含 FIX-4 曾漏报的 `.pyi`。**F259 脚注**：这两个样本无 import/callSite，仅覆盖节点面（SC-005b 扩展名声明面），不覆盖边面独占性——`#2`（本管线）与 `#11 pythonSymbolScan` 在这两个样本上产出的节点 id 完全重合，去重后 `#2` 对最终图零独占贡献（探针 C 证实：整条 `#2` 管线被剔除，护栏仍 20/20 全绿）。 |
| `src/py/producer.py`、`consumer.py` | #2 `pyWalk`（边面独占覆盖，F259） | 补齐 `depends-on`/`calls` 边的 `#2` 独占可见性，防止整条管线被删除而护栏无感（见下方"探针 C 补记"）。 |
| `src/java/Foo.JAVA` | #3 `genericAdapters`（java 分量） | 大小写变体样本，证明大小写不敏感面被真实覆盖 |
| `src/go/main.go` | #3 `genericAdapters`（go 分量） | go 扩展 |
| `src/module-only/entry.mjs` | #1 `tsjsSkeletonWalk` ∩ #7/#8 `moduleDerivationScan` | **双轨可见**样本（见下方"rebase 调和"） |

### rebase 调和补记 · 2026-08-03（`.mjs` 从单轨变双轨）

`entry.mjs` 原本的覆盖意图是"`.mjs` 只被 module 派生扫描面识别，是 a-track 的护栏盲区、
b-track 的存在理由"。master 的 d27ba75 把 `.mjs`/`.cjs` 纳入 `tsjsSkeletonWalk` 采集面后，
该盲区**不再存在**：`entry.mjs` 现在同时出现在 a-track 的 graph-only 产物里。两份 pinned
资产因此经再生脚本的"extensionSurface 变化=自动放行"路径重新生成（a-track 期望图变大）。

b-track 的存在理由改由 `.mts`/`.cts` 承担——`tsjsSkeletonWalk` 显式不含这两个扩展（沿用
d27ba75 登记的残留口径），仅 `moduleDerivationScan` 覆盖；且 a-track 比较的是 symbol/file 图，
b-track 比较的是 module 投影，两者本就不是同一投影面。护栏测试里有一条专门用例把"两轨覆盖面
不等价"钉死，防止将来有人以"两轨都能看到 entry.mjs"为由裁掉 b-track。

`src/` 这一层子目录是**必需的**：`buildModuleGraphForProject` 优先扫描 `<root>/src`，且默认
`includeOnly` 为 `/^src\//`（见 `src/knowledge-graph/module-derivation.ts`）。把样本平铺到
fixture 根目录会让 b-track 扫不到任何文件、退化为空图假绿。

`src/module-only/entry.mjs` 的内容（`import { foo } from '../ts/foo.ts';`）是**逐字钉死**的：
显式带 `.ts` 扩展名的相对路径让 `resolveTsJsImport` 的相对路径分支第一候选即命中真实文件，
不依赖扩展名推断或 tsconfig paths alias，因此 b-track 才能稳定断言 `entry.mjs → foo.ts` 这条
具体端点的边（禁止退化为"边数非空"式断言）。

### 探针 C 补记 · 2026-08-06（`#2 pyWalk` 边面独占样本，F259）

`specs/259-fix-callgraph-false-edge-guardrail/fix-report.md` 记录的探针 C 实测证实：把
`graph-assembly.ts` 里合并 `codeSkeletons` 时的 `pythonSkeletons` 整体剔除后，
`collector-fingerprint-guardrail.test.ts` 的 a-track 用例仍 20/20 全绿——因为既有 `mod.py`/
`mod.pyi` 样本无 import/callSite，`#2`（本管线）与 `#11 pythonSymbolScan`
（`PythonLanguageAdapter.extractSymbolNodes`）在这两个样本上产出的节点 id 完全重合，
buildKnowledgeGraph 按 id 去重后 `#2` 对最终图零独占贡献；`BEHAVIOR_VERSION` bump 纪律因此
在 py 侧完全失灵。

新增 `producer.py`/`consumer.py`（真实 py→py 相对 import + 调用）补齐 `#2` 在 `depends-on`/
`calls` 两条边上的独占贡献：`#11` 结构上只读 `skeleton.exports` 派生 module→component 的
`contains` 边，从不读取 `imports`/`callSites`，产不出这两条边。同时新增护栏用例
`#11 extractSymbolNodes 当前只产 contains 边` 把这条前提正向钉死——一旦未来有人给 `#11`
扩展出 `calls`/`depends-on` 产出能力，即便整条 `#2` 管线被误删，边仍会由 `#11` 补上、掩码
原样复发，该用例会在改动当下 fail-loud，不必等到有人手滑删除 `#2` 才被发现。

此次 fixture 变更依 `shouldRejectRegen` 判据（`scripts/lib/collector-fingerprint-regen-predicate.mjs`）
的既定设计触发 `BEHAVIOR_VERSION` bump（2→3，见 `src/panoramic/graph/collector-fingerprint.ts`
bump 记录）——即便本次未改动任何采集器代码行为，fixture 本身作为"护栏验证的行为契约基线"，
其内容变更同样需要 bump 留痕，防止静默更新 pinned 资产绕开审计链路。

### 再生记录 · 2026-08-31（F271 `lineRange` 新字段，**不 bump** `BEHAVIOR_VERSION`）

F271 给 symbol 节点 `metadata` 新增 `lineRange`（`{ start, end }`，1-indexed 闭区间），
`expected-graph-only-graph.json` 里的 symbol 节点因此多出该字段，pinned 资产经
`npm run fixtures:regen:collector-fingerprint -- --init` 冷启动再生。

**`BEHAVIOR_VERSION` 保持 3**：这是节点上多了一个字段，不改变"哪些文件被计入采集面"，
六类 bump responsibility 均不适用，`extensionSurface` 也未变；与上一节 F259 的情形不同
（那次是 fixture **输入样本**本身变更，触发 `shouldRejectRegen` 的既定 bump 纪律，本次输入
文件一字未改）。为防止"新字段掩盖了别的漂移"，再生前后做过一次审计：把新旧资产的
symbol 节点 `lineRange` 剥掉后深等比较，除该字段外无任何差异——记录在
`specs/271-product-surface-sweep/verification/implement-notes.md`。

**同轮附带的一处 metadata 取值方向翻转（本护栏语料测不到，显式承认）**：F271 把
`python-adapter.extractSymbolNodes` 的同名符号折叠从"下游 `upsertNode` last-wins"前移为
"extraction 侧 first-wins + lineRange 并集"。同一文件内同名 `def`（try-except 双份 / 条件定义）
的 `signature`/`symbolKind` 终值会从末条翻成首条。本 fixture 无同文件同名样本
（`mod.py`/`mod.pyi` 是跨文件、id 不同），护栏对此翻转零覆盖——"剥 lineRange 深等"审计只证明
现有语料无其他漂移，不证明折叠面行为等价。方向已被 `tests/adapters/python-adapter.test.ts`
的 T-overload 探针钉死（first-wins + 并集，双向 fail-loud）。

## pinned 期望资产

- `expected-graph-only-graph.json`：`{ fixtureInputHash, graph }`，`graph` 是 `buildAstGraphOnly` 产物。
- `expected-module-graph.json`：`{ fixtureInputHash, fingerprint, moduleGraph }`，`moduleGraph` 是
  `buildModuleGraphForProject` 产物经 `tests/helpers/module-graph-snapshot-normalize.ts` 规范化后的投影。

两份资产 **MUST** 经 `tests/helpers/pinned-asset-loader.ts` 的 typed loader 解包读取，
**MUST NOT** 裸 `JSON.parse` 后直接传给要求裸 `GraphJSON`/`ModuleGraph` 的入口（外层多一层包装）。

重新生成：`npm run fixtures:regen:collector-fingerprint`（首次冷启动加 `--init`）。

### `expected-graph-only-graph.json` 的 `"builder": null` 是**再生路径的产物**（F261）

该资产里 `graph.graph.builder` 为 `null`，**不是**"这个字段无所谓"，而是再生脚本走
`tsx` 直跑 `src/` 这条路径的必然结果：`builder-stamp` 只在**祖先目录本身**找
`.spectra-build-meta.json`，跑 `src/panoramic/graph/` 时结构性定位不到（形态 b，诚实降级）。

**MUST NOT 改用 dist CLI（`node dist/cli/index.js`）再生这两份资产。** 那样会把再生者本机的
`commit` / `dirty` / `sourceDirty` / `distSha256` 烤进 tracked 文件——这些值**跨机器、跨 worktree
必然不同**，于是 fixture 在别人机器上永久红，且红的原因与被护栏保护的采集面毫无关系。

同理，若将来给再生脚本加"用真 CLI 复核"之类的旁路，落盘前必须把 `graph.graph.builder`
显式置回 `null`，或干脆不落这条旁路的产物。

## 禁止事项

1. **禁止在本目录（含任意子目录）新增与既有大小写变体样本仅大小写不同的文件。**
   具体地：既有 `src/java/Foo.JAVA`，则 **MUST NOT** 新增 `src/java/foo.java`、`Foo.java`、
   `FOO.JAVA` 等任何仅大小写不同的同名文件。
   原因：macOS（APFS 默认 case-insensitive / case-preserving）与 Windows 的文件系统会把两者
   判定为**同一个文件**并静默覆盖，导致 fixture 实际内容与 git 记录不符；而 Linux CI 默认
   case-sensitive 文件系统上两个文件并存，该错误不可复现——构成隐蔽的跨平台不一致风险，
   表现为"本机护栏红、CI 绿"或反之，且排查成本极高。
   如需新增大小写变体覆盖，请换一个 basename（如新增 `src/java/Bar.Java`）而非同名变体。
2. **禁止手工编辑 `expected-*.json`**（除 quickstart 的拒绝路径演示后立即 `git checkout` 还原）。
   两份资产的 `fixtureInputHash`/`fingerprint` 由再生脚本保持彼此一致，手工编辑会在下次运行时
   触发前置一致性校验报错阻塞。
3. **禁止新增 `*.test.ts` / `*.spec.ts` 命名的样本**：虽然本目录不在任何 vitest project 的
   include glob 内，但 `buildModuleGraphForProject` 会按 ts-js adapter 的 test pattern 过滤这类
   文件，导致 registry 已注册 / 未注册两条路径产出不同的图，破坏 b-track 的可对比性。
