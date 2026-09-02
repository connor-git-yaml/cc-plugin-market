# F279 实现笔记与验证证据

> **执行降级声明（诚实标注）**
> `[DEGRADED: inline-execution — implement 收尾取证 — 子代理 API 连接中断]`
> T001–T027 的代码实现由 `spec-driver:implement` 子代理完成（63 次工具调用后 **API 连接中断**，
> 错误原文：`API Error: Connection lost mid-response`）。代码改动已完整落盘且通过全部验收，
> 但子代理**未能写出本文件**，因此**红先行证据、活性证明、类型检查三段取证由主编排器 inline 补做**。
>
> **这带来一个必须诚实交代的差异**：子代理是否在写实现前**逐条**观察到 FAIL，
> 其过程日志已随中断丢失，**无法追认**。主编排器因此改用一种**更强且可复现**的替代证明
> （见 §1）：把**新测试**跑在**改动前的旧实现**上，观察失败。这比"我先看到了红"的叙述更可验证——
> 任何人都能重跑同一组命令得到同一结果。

---

## 1. 红先行 / 变异证明：新测试 × 旧实现 → 19 处 FAIL

### 方法

```bash
cp scripts/regen-collector-fingerprint-fixtures.ts <备份>
git show HEAD:scripts/regen-collector-fingerprint-fixtures.ts > scripts/regen-collector-fingerprint-fixtures.ts
npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts
npx vitest run tests/integration/collector-fingerprint-regen-script.test.ts
cp <备份> scripts/regen-collector-fingerprint-fixtures.ts   # 还原
```

换回旧实现可行的前提（已实证）：新测试只 import `compareGraphOnlyStructure` /
`compareModuleGraphSnapshot` / 两个文件名常量，**四个符号在新旧两版中都存在**
——这同时正向证明了 FR「不新增导出面」确实达成。

还原完整性：每次换版后都用 `diff -q` 与备份逐字节比对确认还原完整。

### 结果（**对抗审查处置后的终版测试集**实测）

| 测试文件 | 终版测试 × **旧**实现 | 终版测试 × **新**实现 |
|---|---|---|
| `collector-fingerprint-guardrail.test.ts` | **22 failed** / 30 passed（52） | 52 passed |
| `collector-fingerprint-regen-script.test.ts` | **2 failed** / 18 passed（20） | 20 passed |
| 合计 | **24 failed** | **72 passed** |

改动前基线（未加新用例时）：同两文件 **50 passed**。⇒ 净新增 **22** 条用例。

> 口径说明：下方按族列出的是**对抗审查处置前**（69 passed 快照）那一轮的 19 条 FAIL 用例名，
> 处置后新增的 3 条（2 条根层数组 + 1 条 stamp `extensionSurface`）与 2 条转向用例
> （fingerprint 负控 → 报不一致）合计使 FAIL 数从 19 升到 24。三条新增用例各自的
> **定向变异证明**单独记在 §7。

### 19 处 FAIL 按盲区族归类（旧实现下的实测用例名）

**盲区 1 — `node.kind` / `node.label`（6 条）**
```
× a-track：仅变异首个节点的 kind → 报不一致（F279 US1，盲区 1）
× a-track：仅变异首个节点的 label → 报不一致（F279 US1，盲区 1）
× a-track：首个节点 kind 整字段缺席（undefined）→ 报不一致（F279 US1 缺席档）
× a-track：首个节点 label 整字段缺席（undefined）→ 报不一致（F279 US1 缺席档）
× a-track：一侧 kind 缺席、另一侧 kind="" → 报不一致（两档 MUST NOT 塌缩）
× a-track：一侧 label 缺席、另一侧 label="" → 报不一致（两档 MUST NOT 塌缩）
```

**盲区 2 — metadata 递归 key 路径（4 条）**
```
× a-track：某节点 metadata.lineRange 内层由 {start,end} 改名为 {from,to} → 报不一致（F279 US2）
× a-track：某节点 metadata.lineRange 内层删掉 end 子 key → 报不一致（F279 US2）
× a-track：{x:{lineRange:{}}} vs {x:{}} → 报不一致（空嵌套对象 MUST NOT 与 key 缺席碰撞）
× a-track：{x:{"a.b":1,a:{}}} vs {x:{a:{b:1}}} → 报不一致（key 名含字面 . 不得与路径分隔符碰撞）
```

**盲区 3 — `graph.graph` / `directed` / `multigraph`（5 条）**
```
× a-track：graph.graph.nodeCount 被篡改 → 报不一致（F279 US3，盲区 3）
× a-track：graph.graph.schemaVersion 被降级 → 报不一致（F279 US3，盲区 3）
× a-track：graph.graph.sources 被清空 → 报不一致（F279 US3，盲区 3）
× a-track：顶层 directed 被翻转 → 报不一致（F279 US3，GraphJSON 顶层字段）
× a-track：顶层 multigraph 被翻转 → 报不一致（F279 US3，GraphJSON 顶层字段）
```

**重复 id 复合签名（2 条）**
```
× a-track：同一 node id 两侧各 2 次、仅 kind 的 multiset 不同 → 报不一致（F279 重复 id 复合签名）
× a-track：同一 node id 两侧各 2 次、key-set multiset 不同 → 报节点形态签名计数不一致
```

**FR-013 断言迁移（2 条，跨两个文件）**
```
× a-track：删除某节点的一个 metadata key（lineRange）→ 报 metadata key 集合不一致   [单测]
× (e) metadata-only 漂移：pinned 少一个 lineRange → 非零退出 + 指名 metadata 维度   [集成]
```
这两条在旧实现下失败**恰恰是迁移真实性的证据**：文案确实变了，不是"改了断言让它继续绿"。

### 负面对照：旧实现下就应为绿，且实测为绿

终版测试集里**只剩一条**这种"新旧两版都必须绿"的负控（`-t "负控"` 过滤实测命中 1 条、通过）：

```
✓ a-track：只改 graph.graph.builder → 判一致（F279 US3 负控，0 例误报）
```

`builder` 是排除表里唯一一条，它在**新旧两版实现下都判绿**，说明这不是"新实现恰好没做到"，
而是被显式钉死的行为。

> **口径订正**：初版这里还列了两条 `fingerprint` 负控（"只改 fingerprint → 判一致"）。
> 那两条随 §5 记录的裁决撤回而**反向**——`fingerprint` 现已纳入比较，对应用例改为
> "→ 报不一致"，因此它们现在属于上表的 24 条 FAIL 而非负控。保留这段订正是为了让
> "曾经有过一条反向裁决"这件事在制品里留痕，而不是被悄悄抹平。

---

## 2. FR-013 三处断言迁移：前后文案逐字对照

| 位置 | 处置 | 前 → 后 |
|---|---|---|
| `collector-fingerprint-guardrail.test.ts`（原 `:382`） | **改** | `重建缺失 [lineRange] vs 重建新增 []` → `重建缺失 [lineRange, lineRange.end, lineRange.start] vs 重建新增 []` |
| `collector-fingerprint-regen-script.test.ts`（原 `:342-344`） | **改** | `重建缺失 [] vs 重建新增 [lineRange]` → `重建缺失 [] vs 重建新增 [lineRange, lineRange.end, lineRange.start]` |
| `collector-fingerprint-guardrail.test.ts`（原 `:396`，`__mutantKey`） | **不改** | `git diff … \| grep __mutantKey` **无输出**——逐字未动 |

第三处不需改的实证意义：`__mutantKey` 的值是标量（`1`），无子结构 ⇒ 递归路径口径下仍只产出
一条路径 ⇒ 文案不变。这构成"递归化只影响有嵌套结构的字段"的**负面对照**，
与 plan「开放项 B 裁决」的预测逐字吻合。

迁移后断言**仍是含格子的完整字符串精确匹配**，未退化为 `toContain('lineRange')` 式弱关键词匹配
（该硬约束来自 F278 返工 A3）。

新增用例的诊断精度实证（两条新文案）：
```
metadata key 集合不一致（重建缺失 [lineRange.end, lineRange.start] vs 重建新增 [lineRange.from, lineRange.to]）
metadata key 集合不一致（重建缺失 [lineRange.end] vs 重建新增 []）
```
第二条证明**只报真正变化的路径**：内层只删 `end` 时，未变的 `lineRange` / `lineRange.start`
不出现在 missing 列表里。

---

## 3. 活性证明（FR-014 / T026）：真实 fixture 判绿且未写盘

跑前两份 pinned 资产 sha256：
```
08367637e29c309e2981415669cc679da789cee98e35f5df76b200f640cbc2be  expected-graph-only-graph.json
568c1af4660f9565851e132b662e965d2227e80b387238a454d64447d7147270  expected-module-graph.json
```

命令与完整输出（真实 fixture，**无** `--fixture-root`、**无** `--init`）：
```
$ npm run fixtures:regen:collector-fingerprint
> npx tsx scripts/regen-collector-fingerprint-fixtures.ts
⚠ 跳过 3 个 .py 文件（不支持）、1 个 .go 文件（不支持）、1 个 .java 文件（不支持）、1 个 .pyi 文件（不支持）
[regen] 双轨重建内容、指纹与 fixtureInputHash 均一致，无需更新（未写盘）。
exit=0
```

强制后置校验（FR-016）：
```
$ git diff --exit-code tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json \
                       tests/fixtures/collector-fingerprint-guardrail/expected-module-graph.json
✅ 通过（exit 0，零差异）
```
跑后 sha256 与跑前逐字节相同（同上两行）。

**判读**：这是在**四维比较器已生效**的前提下取得的结果 —— 新增的 kind/label、
metadata 递归路径、`graph.graph`/`directed`/`multigraph` 三族维度对当前 pinned 基线
（22 节点 / 14 边）**全部判一致**。未触发任何 `--init`、未 bump `BEHAVIOR_VERSION`。

---

## 4. 主编排器补做的针对性类型检查（仓库门禁的结构性盲区）

**先说结论：`npm run lint` 与 `npm run build` 对本卡改动的三个文件结构性零覆盖。**

实测依据：
```
tsconfig.json  include: ["src/**/*.ts"]   exclude: [... , "tests", ...]
$ npx tsc --noEmit --listFilesOnly | grep -c 'scripts/regen-collector-fingerprint-fixtures.ts'   → 0
$ npx tsc --noEmit --listFilesOnly | grep -c 'tests/unit/guardrail/collector-fingerprint-guardrail.test.ts' → 0
```
`npm run typecheck:tests` 也只覆盖 `tests/type-tests/` 下 3 个手挑文件，不含本卡任何文件。
⇒ 收尾清单里的 lint/build 两条对本卡而言是**空网**，通过它们不构成任何类型正确性证据。

补救（**仅为本次验证动作，未改仓库任何配置**）：用一份放在 scratchpad 的临时 tsconfig
（`module/moduleResolution: NodeNext`、`strict: true`、`noUncheckedIndexedAccess: true`，
与生产 tsconfig 同档）显式 include 三个改动文件跑 `tsc --noEmit`。

结果：**0 error**。

唯一一条初始报错已判定为**既存条件、非本次引入**：
```
scripts/regen-collector-fingerprint-fixtures.ts(45,35): error TS7016:
  Could not find a declaration file for module './lib/collector-fingerprint-regen-predicate.mjs'
```
归因证据：该 import 行在 HEAD 与工作区**逐字相同**，且 `git diff | grep predicate` **无输出**
（本次未触碰）；`scripts/lib/` 下无对应 `.d.ts`/`.d.mts`。它此前从不显形，正是因为仓库
tsconfig 根本不检查 `scripts/`。用一份 scratchpad 内的 ambient 声明 shim 隔离该噪声后，
三个文件**零类型错误**。

**未处置，登记为遗留**：给该 `.mjs` 补类型声明、或把 `scripts/`/`tests/` 纳入某条类型门禁，
都超出本卡范围（属"不要自行添加未要求的改动"），建议单独立卡。

---

## 5. 与 plan 裁决的偏差

> **本节初版写的是"无偏差"，这是一次 over-claim，已订正。**
> 它只核对了"实现 vs plan"，**没有核对"plan 是否忠于 spec"**——而后者正是 F270 登记过的
> over-claim 结构性根源。spec 合规审查抓到了这个缺口，异构对抗审查随后在事实层面推翻了
> plan 的一条核心裁决。下表第一行即为**主动偏离 plan** 的一处，理由见下。

### 主动偏离 plan 的一处（经对抗审查证伪后撤回 plan 裁决）

plan「开放项 A」裁定 `GRAPH_GRAPH_EXCLUDED_FIELDS = {'builder','fingerprint'}`，
排除 `fingerprint` 的理由是"它已有 `fingerprintUnchanged` 这条独立通道"。
**该理由经实读证伪**（详见 `spec-review-report.md`「最终处置」一节的完整证据链）：
`fingerprintUnchanged` 比的是 `pinned vs 现算值`，本比较器比的是 `rebuilt vs pinned`，
两者是不同的事实；排除的实际后果是**重建产物的 stamp 三处无人读**，构成 fail-open 链。

⇒ 终态 `GRAPH_GRAPH_EXCLUDED_FIELDS = new Set(['builder'])`，
并新增两条变异用例 + 用"加回排除表"的变异体实测二者转 FAIL。
此举同时让 FR-010 的**字面约束**得到满足（spec 无需破例）。

### 其余逐条核对（一致）

| plan 裁决 | 实现实况 |
|---|---|
| `directed`/`multigraph` 单独两行、不进 denylist 迭代 | ✅ 一致（诊断文案无 `graph.graph.` 前缀） |
| Route 1（更新断言），不做展示层剪枝 | ✅ 一致 |
| 就地泛化为 `describeNodeShape`/`groupNodeShapes`/`compareNodeShapes` | ✅ 一致，未新增平行维度 |
| 复合签名 `JSON.stringify([kind, label, metadata])` | ✅ 一致（`nodeShapeSignature`） |
| 先记 key 自身路径再判断递归 | ✅ 一致（`collectMetadataKeyPaths`） |
| 先转义 `\` 再转义 `.` | ✅ 一致（`escapeMetadataPathSegment`） |
| `describeScalarField` 只一档 `<absent>` | ✅ 一致 |
| 不新增导出面 | ✅ 一致（§1 的换版实验反向证明：新旧两版导出面相同） |

---

## 6. 改动清单

`git diff --stat` 终值：**4 files changed, 882 insertions(+), 71 deletions(-)**

| 文件 | 改动 |
|---|---|
| `scripts/regen-collector-fingerprint-fixtures.ts` | +400 行档；新增 module-private：`NodeShape`、`describeAbsentableValue`、`describeScalarField`、`escapeMetadataPathSegment`、`isRecursableMetadataValue`、`collectMetadataKeyPaths`、`describeNodeShape`、`nodeShapeSignature`、`describeNodeShapeDifferences`、`compareGraphMetadata`、`GRAPH_GRAPH_EXCLUDED_FIELDS`；泛化：`groupNodeMetadataShapes`→`groupNodeShapes`、`compareNodeMetadataKeys`→`compareNodeShapes`；`compareGraphOnlyStructure` 增 2 行调用 |
| `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | +485 行档，新增 21 条用例 + 迁移 1 条断言 + 2 条负控转向 |
| `tests/integration/collector-fingerprint-regen-script.test.ts` | +40 行档，新增 1 条用例（后转向）+ 迁移 1 条断言 |
| `tests/fixtures/collector-fingerprint-guardrail/README.md` | +28/-6 行档，第三/第四维度口径同步 + 覆盖面诚实边界（该文件不在 FR-016 保护范围） |

用例数：改动前 **50** → 改动后 **72**（净增 **22**）。

**质量审查两条 WARNING 的处置**（`quality-review-report.md`，0 CRITICAL）：
- `describeScalarField`/`describeGraphField` 逐字重复 → 合并为单一 `describeAbsentableValue`，
  `describeScalarField` 退化为取字段包装，`describeGraphField` 删除。
- `compareNodeShapes` 86 行超出本仓 >50 行应拆分的约定 → 提取
  `describeNodeShapeDifferences`（单节点逐 facet 诊断，纯函数、可独立测试）。
- 其 2 条 INFO（kind/label 4 行重复标为"偏好"、连续空行）：前者已随提取自然消解为一个
  `for (const facet of ['kind','label'])` 循环；后者属排版噪声，一并清理。

**未改动（硬性不变量，已实证）**：两份 `expected-*.json`（git diff 为空）、
`src/panoramic/graph/collector-fingerprint.ts` 的 `BEHAVIOR_VERSION`（git diff 为空）。

---

## 7. 异构对抗审查轮（T028）与处置

按 `CLAUDE.local.md`「门禁/判定器/守护类改动须走异构对抗档位」：派两个**不同切入角**的独立子代理，
均要求"构造反例优先于论证"、禁止修改仓库任何文件（收工时用 `git diff | shasum` 指纹核验为一致）。

| 切入角 | 结论 |
|---|---|
| ① 漏检面 / fail-open | 34 组扰动 + 1 组端到端 + 238 万对穷举 → 3 CRITICAL / 3 WARNING / 4 INFO |
| ② 绕过构造面（签名碰撞） | 65,640 穷举 + 800,000 随机 → 1 CRITICAL / 3 WARNING / 2 INFO |

**两角独立收敛于同一批首要发现**（边属性零覆盖、allowlist 自相矛盾），这在本仓约定里是强信号。

### 已在本卡修掉（4 项）

| 发现 | 处置 |
|---|---|
| **CRITICAL：`fingerprint` 排除项的唯一辩护理由被证伪**（重建侧 stamp 三处无人读 ⇒ fail-open 链） | 撤回 plan 裁决，排除表回到只有 `builder`；+2 条变异用例；已用"加回排除表"变异体实测转 FAIL |
| **WARNING：根层与嵌套层"可展开性"判据不同源**（根层不排除数组 ⇒ `metadata:[]` ≡ `metadata:{}`） | 根层改走 `isRecursableMetadataValue`，数组归 `<non-object:array>`；+2 条用例；变异体实测转 FAIL |
| **CRITICAL 归属项：docblock 完整性 over-claim**（写"四维度全部相等才判一致"+"任何未预期差异都必须变红"，实际只比边的 3/8 字段） | 改写为诚实边界，逐条列出三面零覆盖并标注已实证 |
| **WARNING：denylist 论证自相矛盾**（同函数内节点 facet 与顶层字段仍是硬编码 allowlist） | 注释显式承认两处未兑现，说明为何本卡只改 `graph.graph` 一族 |

### 实证为"没问题"（对抗审查的负面结果，同样入账）

- `escapeMetadataPathSegment` 单射性**成立**：两角合计 ~245 万对穷举/随机，**0 碰撞**。
- 三 facet 复合签名 `JSON.stringify([k,l,m])` 的三元组移位攻击全 CAUGHT。
- `<absent>` 哨兵 vs 字面量 `"<absent>"` 四处全 CAUGHT。
- denylist 兄弟位置藏差异（`graph.graph.meta.builder` / `sources:[{builder}]` / `builderX`）全 CAUGHT。
- `compareNodeShapes` 三处 `continue` 的辩护理由**经实测成立**（不是接受论证）：
  id 单侧独有 → 第一维度报 `节点仅存在于重建产物`；计数不等 → 报 `节点计数不一致`。
- `JSON.stringify` 语义碰撞（`NaN`/`Infinity`/`toJSON`/`-0`/大整数）在本场景**不可达**：
  两侧实参都是 `JSON.parse` 产物。该结论顺带确认 `collectMetadataKeyPaths` 的"无环"前提成立。

### 未在本卡修、已登记移交（诚实标注）

以下均**超出本卡授权范围**（卡明确只授权三族盲区），已写入 `spec.md` 的 Out of Scope
并附实证形态，**不得**因为"审查提到了"就顺手扩大改动面：

1. **边属性面零覆盖**（最高可达性）：14 条边属性全改 + 三元组不动 ⇒ 真实再生脚本 exit 0。
2. **节点非 facet 顶层字段**：新增 `filePath`/`weight` 等不报。
3. **`GraphJSON` 顶层非 `directed`/`multigraph` 字段**：如 `hyperedges`。
4. **metadata 叶子类型档**：`{a:{}}` ≡ `{a:1}` ≡ `{a:null}`；实证形态 `signature → null`、
   `callSitesCount: 0 → "0"` 判绿。属类型级退化，但加叶子类型档超出"只比 key 名"授权，须用户裁决。
5. **数组内嵌套 key 改名**：`spans:[{start,end}] → [{from,to}]` 判绿（FR-004 明确规定数组按叶子）。
6. `edgeKey` 的 `|` 未转义（可达性极低，需 node id 含字面 `|`）；`graph` 段 `?? {}` 兜底把
   `undefined`/`null`/`{}`/`[]` 拍平（`graph` 类型必填，生产不可达）。

### 一处被记录但**不采纳**的观察

对抗审查指出"`builder` 在本 fixture 里恒为 `null`，排除它当前只换来盲区、没省下噪声"。
属实，但**不改变裁决**：排除 `builder` 防的是"有人改用 dist CLI 再生"这一被 README 明令禁止
但物理上可发生的场景（届时 `commit`/`distSha256` 会跨机器不同），且与
`graph-quality-pinned-staleness.test.ts:154` 的既定先例一致。保留排除，理由已写进常量注释。
