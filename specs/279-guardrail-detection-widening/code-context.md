# F279 代码上下文摘要（编排器实读事实清单，非调研制品）

> 本文件由 story 模式编排器在 Step 7「代码库上下文扫描」阶段亲自产出。
> **每条事实都带 `路径:行号` 锚或实跑输出**；不含任何未经实读/实跑证实的推断。
> 下游 spec/plan/tasks/implement 子代理**只能引用本文件已证实的事实**，需要新事实必须自己实读并标注锚。

## 0. 基座与前置

- 分支 `claude/suspicious-mclean-fe715f`，已 `git rebase origin/master` 到 **`058c7012`（F278 落账）**，
  本地额外携带 `e1105e8b`（docs T063，与本卡正交）。
- **前置警示**：本卡任务描述里引用的 F278 基础设施（`groupMetadataSignatures` / `metadataKeySignature`）
  在 rebase 之前**不存在于工作区**。开工时必须先 `git fetch` 并确认基座含 F278，
  否则会得出"任务描述事实全假"的错误结论。已核实：rebase 后 F278 基础设施齐备。

## 1. 被改对象：`compareGraphOnlyStructure` 的当前比较维度

`scripts/regen-collector-fingerprint-fixtures.ts:337-375`，恰好三个维度：

| # | 维度 | 实现锚 | 语义 |
|---|------|--------|------|
| 1 | 节点 **id** multiset | `:345-364` | `countByKey(nodes.map(n => n.id))`，两侧计数相等 |
| 2 | 边 multiset | `:366-374` | key = `source\|relation\|target`（`edgeKey`，`:172-174`） |
| 3 | 节点 metadata **顶层** key 集合 | `compareNodeMetadataKeys` `:254-334`，由 `:371-372` 调用 | 按 node id 分组，只比 key 名不比 value（F278 FR-008） |

维度 3 的既有基础设施（F278 落地，本卡直接复用）：
- `NodeMetadataShape`（`:196-201`）：`signature` 负责相等性判定、`keys` 供富诊断直接消费，**刻意分离**
  （`:186-195` 注释：反解签名会让诊断正确性依赖签名格式这一实现细节）。
- `describeNodeMetadata`（`:217-226`）：三档签名 `<absent>` / `<non-object:*>` / key 数组 JSON。
- `groupNodeMetadataShapes`（`:228-238`）：`Map<nodeId, NodeMetadataShape[]>`。
- `compareNodeMetadataKeys`（`:254-334`）：只对"两侧该 id 计数相等且 > 0"的 id 求值（`:274-276`）；
  重复 id 走 multiset 分支（`:288-301`），单节点走富诊断分支（`:303-333`）。

**节点对象的另外两个顶层字段 `kind` / `label` 一个都不读**（全文件搜索 `node.kind` / `node.label` 零命中）。
`GraphNode` 的完整字段集为 `{id, kind, label, metadata}`（`src/panoramic/graph/graph-types.ts:55-65`）。

## 2. 三族盲区：真资产单点变异实测（本卡立项证据）

对 pinned 基线 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`
（22 节点 / 14 边）做单点变异后调 `compareGraphOnlyStructure`，实跑输出：

```
=== 基线自反 ===
GREEN | diffs=0 | 未变异（自反性）

=== 盲区 1：node.kind / node.label ===
GREEN | diffs=0 | node.kind: component→module（首个 component 节点）
GREEN | diffs=0 | node.label 改名（首个节点）
GREEN | diffs=0 | 全部 node.kind 抹成 module

=== 盲区 2：metadata 嵌套 key 改名 ===
GREEN | diffs=0 | metadata.lineRange {start,end}→{from,to}
GREEN | diffs=0 | metadata.lineRange 内层删 end

=== 盲区 3：graph.graph / directed / multigraph ===
GREEN | diffs=0 | 清空整个 graph.graph
GREEN | diffs=0 | graph.graph.nodeCount 22→999
GREEN | diffs=0 | graph.graph.schemaVersion 2.0→1.0
GREEN | diffs=0 | graph.graph.sources 清空
GREEN | diffs=0 | directed false→true
GREEN | diffs=0 | multigraph false→true

=== 对照：F278 已覆盖维度（应全 RED）===
RED   | diffs=1 | [对照] metadata 顶层新增 key
        └─ metadata key 集合不一致（重建缺失 [] vs 重建新增 [__probe]）: src/go/main.go
RED   | diffs=1 | [对照] 删一条边
        └─ 边计数不一致（重建 0 vs pinned 1）: src/ts/foo.tsx|contains|src/ts/foo.tsx::widget
RED   | diffs=2 | [对照] 改一个 node.id
        └─ 节点仅存在于 pinned 期望: src/go/main.go ; 节点仅存在于重建产物: src/go/main.go__P

=== 顺序敏感性对照（应 GREEN）===
GREEN | diffs=0 | [对照] 仅节点/边顺序反转
```

**判读**：三族全部 `diffs=0` = 零检测力；对照组三条全 RED 证明探针本身有效（不是探针写错）；
顺序对照 GREEN 证明既有 multiset 语义正常。

## 3. 盲区 1 已在历史上真实走通过一次（不是假想风险）

`specs/250-pyi-symbol-surface/trace.md:133` 原文（F250 rebase 对齐记录）：

> …契约 3/4 逐字段仍完全成立：**`label mod.pyi→mod`**、`sourceTag unified-graph→extraction`、…
> **负面清单四项零命中**（节点 id 未变 / `contains` 边零增删 / `mod.py` 对照组零变化 /
> `modules[].` 内容零变化）；**a-track 节点·边 multiset 比较器 `contentMismatch=false` 独立佐证后两项**。

同一段话里既写明"改了 `label`"，又把该比较器的 `contentMismatch=false` 当作"节点结构零变化"的
**独立佐证**引用——而该比较器结构性看不见 `label`。这是一次真实发生的误读，不是推演。

## 4. 盲区 3 的关键约束：`graph.builder` 必须继续排除

### 4.1 本 fixture 侧
`tests/fixtures/collector-fingerprint-guardrail/README.md`「`"builder": null` 是**再生路径的产物**」一节
与 `scripts/regen-collector-fingerprint-fixtures.ts:12-16` 文件头注释均写明：
再生走 `tsx` 直跑 `src/`，`builder-stamp` 结构性定位不到 `.spectra-build-meta.json` ⇒ 诚实降级 `null`；
**MUST NOT** 改用 dist CLI 再生，否则把再生者本机的 `commit`/`dirty`/`distSha256` 烤进 tracked 资产。

### 4.2 另一份 pinned 资产实证 builder 是机器/commit 绑定量
`tests/fixtures/micrograd-baseline-graph/graph.json` 的
`graph.builder = {formatVersion:1, commit:"68b5929cb16e...", dirty:false, sourceDirty:false, distSha256:"40ba0fdb..."}`
—— 真实戳，含 commit 与 dist 内容摘要。

## 5. **仓内已有同族先例**：`compareGraphDeep`（本卡设计的最强参照）

`tests/integration/graph-quality-pinned-staleness.test.ts`：

- **它的文件头注释（`:19-30`）逐字点名了本卡的同三族盲区**：
  > 早期版本复用 …`compareGraphOnlyStructure`——但那个比较器只看节点 id multiset 与边
  > `source|relation|target` multiset，**`kind`/`label`/`metadata`/`confidence` 等属性字段、
  > 以及 `graph.fingerprint`…/`graph.nodeCount`/`graph.edgeCount` 等 `graph.*` 元数据字段全部不参与比较**
  > ——这恰恰是 pinned 资产陈旧的核心信号。
- **处置**：改为全字段深比较 `compareGraphDeep`（`:205-209`），
  排除表 `DEEP_COMPARE_EXCLUDED_PATHS = new Set(['graph.builder'])`（`:154`），**唯一一条排除**。
  排除理由（`:26-30`）：builder 跟踪宿主仓库/dist 构建戳，跨机器/跨 commit 必然不同，
  与"这份 pinned 是否代表当前 builder **行为**"无关 —— 即 F261 D1「builder 戳只可见不判定」。
  注意该表**未排除** `graph.fingerprint` / `graph.sourceCommit`，二者参与比较。
- **它不覆盖本卡的 fixture**：`enumeratePinnedGraphDirs`（`:113-128`）只认文件名精确为 `graph.json` 的资产，
  注释（`:107-113`）明写 `collector-fingerprint-guardrail/` 下两份资产
  （`expected-graph-only-graph.json` / `expected-module-graph.json`）**天然被排除**。
  ⇒ **本卡不与该守卫重复**；a-track 是这份 fixture 的唯一结构守卫。
- **它已不再 import `compareGraphOnlyStructure`**（F272 改写，`:33-44` 说明为何自实现而不复用
  `collectDeepDifferences`：不为复用私有函数扩大再生脚本的导出面）。
  ⇒ **改本卡比较器不会波及该测试**。

## 6. 活性前置探针：新维度在当前基线上天然一致（实跑）

用 `rebuildTracks(FIXTURE_ROOT)` 实建 a-track 产物与 pinned 逐字段比对：

```
directed  : false vs pinned false
multigraph: false vs pinned false

--- graph.graph 逐字段（10/10 全同）---
  同 builder = null        同 edgeCount = 14      同 fingerprint = {...}
  同 generatedAt = "1970-01-01T00:00:00.000Z"     同 name = "spectra-knowledge-graph"
  同 nodeCount = 22        同 schemaVersion = "2.0"
  同 skippedSources = [...]  同 sourceCommit = null   同 sources = ["extraction","unified-graph"]

--- node kind/label 逐节点 ---
kind/label 差异数: 0 / 节点数 重建 22 vs pinned 22

--- metadata 递归 key 路径逐节点 ---
metadata 递归路径差异数: 0
```

递归路径样本：
```
src/go/main.go        → ["callSitesCount","sourcePath","sourceTag","unifiedKind"]
src/go/main.go::Name  → ["exportKind","lineRange","lineRange.end","lineRange.start",
                         "sourcePath","sourceTag","unifiedKind"]
```

⇒ **三族新维度的"活性证明"前置条件已满足**：不存在"实现完必然判红"的隐患。

`generatedAt` 之所以是固定 epoch（可安全纳入比较）：`buildAstGraphOnly` 走 `stripTimestamps:true`
（`src/batch/batch-orchestrator.ts:1499-1500` → `src/panoramic/graph/graph-builder.ts:853`）。

## 7. 消费方清单（改动影响面）

| 消费方 | 锚 | 受影响？ |
|--------|-----|---------|
| `runRegen` 的 a-track 判定 | `scripts/regen-collector-fingerprint-fixtures.ts:773` | 是（`contentMismatch` 输入变敏感） |
| 护栏单测 16 处调用 | `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:132,314,326,337,349,358,373,392,407,452,471,499,548,567,609,616` | 是 |
| `collector-fingerprint-regen-script.test.ts` | 端到端跑 `runRegen` 子进程 | 间接（放行/拒绝文案） |
| `graph-quality-pinned-staleness.test.ts` | 已改用自有 `compareGraphDeep` | **否**（§5） |

`shouldRejectRegen` 判据（`scripts/lib/collector-fingerprint-regen-predicate.mjs`）：
`contentMismatch && fingerprintUnchanged` ⇒ 拒绝。比较器变敏感 = `contentMismatch` 更容易为真，
**拒绝面只会变严不会变松**（不存在新增 fail-open 面）。

## 8. 会被新维度影响的既有精确断言（必须显式处置，不得静默改绿）

`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 两条 F278 断言断到**含格子的完整子串**：

- `:382` `metadata key 集合不一致（重建缺失 [lineRange] vs 重建新增 []）: ${id}`
- `:396` `metadata key 集合不一致（重建缺失 [] vs 重建新增 [__mutantKey]）: ${id}`

若 metadata 签名改为**递归 key 路径**，`:382` 那条删除整个 `lineRange` 子树的变异会同时缺失
`lineRange` / `lineRange.start` / `lineRange.end` 三条路径 ⇒ 文案变化 ⇒ 该断言当前形态会红。
这是 plan 阶段必须显式裁决的点（两条路：改断言 vs 让诊断只报最浅差异路径）。

## 9. 判定不变量（不得违反）

1. **禁止**修改 `tests/fixtures/collector-fingerprint-guardrail/expected-*.json` 两份 pinned 资产。
2. **禁止**在真实 fixture 目录跑 `--init`（只在 `--fixture-root <临时副本>` 上跑）。
3. **禁止**为让护栏变绿而 bump `BEHAVIOR_VERSION`（`src/panoramic/graph/collector-fingerprint.ts`）；
   六类 bump responsibility 只覆盖"哪些文件被计入采集面"，不覆盖节点字段集合
   （fixture README「护栏报 metadata key 集合不一致时的处置路径」一节）。
4. 既有扰动用例（删边/改 id/重复节点/**乱序判一致**/重复边/F278 M1-M3 + A1-A7）检测力一条都不许回退；
   「乱序判一致」是新签名是否引入顺序敏感性的探针，必须单独核对。
5. 属**守护类**改动 ⇒ 按 `CLAUDE.local.md` 走**异构对抗档位**（≥2 个不同切入角的独立子代理），
   commit message 标注「Codex 审查暂停，异构档位缺席」。
