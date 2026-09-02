# Implementation Plan: a-track 护栏比较器检测面拓宽

**Branch**: `claude/suspicious-mclean-fe715f` | **Date**: 2026-09-02 | **Spec**: `specs/279-guardrail-detection-widening/spec.md`
**Input**: `specs/279-guardrail-detection-widening/code-context.md`（编排器实读事实清单）+ `spec.md`（17 条 FR）+ 本计划阶段对 `scripts/regen-collector-fingerprint-fixtures.ts` / `scripts/lib/collector-fingerprint-regen-predicate.mjs` / `src/panoramic/graph/collector-fingerprint.ts` / `src/panoramic/graph/source-commit.ts` / `src/panoramic/graph/graph-types.ts` / 两处消费测试的补充实读

## Summary

`compareGraphOnlyStructure`（`scripts/regen-collector-fingerprint-fixtures.ts:337-375`）当前只有三个比较维度（节点 id multiset / 边 multiset / metadata **顶层** key 集合），结构性看不见 `node.kind`/`node.label`、metadata 嵌套 key、`graph.graph` 元数据字段三族信号。本计划把检测面拓宽到全部三族，同时：

1. 复用 F278 已建立的"按 node id 分组 + 重复 id 走 multiset 分支 + 单节点走富诊断分支"骨架，把 `describeNodeMetadata`/`groupNodeMetadataShapes`/`compareNodeMetadataKeys` 三个既有 helper **就地泛化**为覆盖 kind/label/metadata 三个facet 的 `describeNodeShape`/`groupNodeShapes`/`compareNodeShapes`，而不是新增平行实现（消除重复，符合"如果今天从零写会怎么写"的项目约定）。
2. 新增 `compareGraphMetadata` 处理 `graph.graph`（denylist 排除 `builder`/`fingerprint`）+ `directed`/`multigraph`。
3. metadata key 比较从"顶层 key 数组"泛化为"递归 key 路径数组"，只递归 plain object、数组按叶子处理，并给出可判定的路径编码（转义 `.`/`\`）解决 key 名含 `.` 的分隔符歧义。
4. 处置因此产生的三处（非两处，见下方"新发现"）既有精确文案断言漂移：采用**更新断言**（Route 1），不采用"剪枝展示"（Route 2）。
5. `graph.builder` 与 `graph.graph.fingerprint` 两项从 FR-007 比较范围显式排除，且给出**两种不同类别**的排除理由。

## 新发现：FR-013 遗漏的第三处精确断言

事实清单 §8 只点名了 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:382`/`:396` 两处。计划阶段实读发现第三处、**性质相同**的精确断言：

`tests/integration/collector-fingerprint-regen-script.test.ts:342-344`：
```
expect(run.stderr).toContain(
  `metadata key 集合不一致（重建缺失 [] vs 重建新增 [lineRange]）: ${victimId}`,
);
```
该断言由 `stripLineRangeFromGraphOnlyAsset`（`:150-161`）从 **pinned 侧**整体删除 `metadata.lineRange` 子树构造（方向与单测 `:382` 相反：pinned 缺失 ⇒ 重建侧"新增"），触发路径是端到端子进程（`runRegenScript`）而非直接函数调用，但断言的仍是 `compareGraphOnlyStructure` 产出并透传到 stderr 的同一条文案。三处的处置方式必须一致（见下方 FR-013 裁决），否则会出现"单测按新格式判绿、集成测试按旧格式判红"的自相矛盾状态。

FR-013 的裁决范围因此扩展为三处：`collector-fingerprint-guardrail.test.ts:382`、`:396`、`collector-fingerprint-regen-script.test.ts:342-344`。

## Technical Context

**Language/Version**: TypeScript 5.x（`scripts/regen-collector-fingerprint-fixtures.ts` 为 `.ts`，经 `tsx` 直跑，不依赖 `npm run build`）
**Primary Dependencies**: 零新增（FR-015/复杂度评估已确认，全部复用 Node.js 内置能力 + 既有 F278 helper）
**Storage**: N/A（比较器为纯函数，pinned 资产为只读输入，FR-016 禁止修改）
**Testing**: vitest（`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 直接单测比较器；`tests/integration/collector-fingerprint-regen-script.test.ts` 端到端子进程跑 `runRegen`）
**Target Platform**: Node.js 20.x+ 本地开发脚本（非 CI 关键路径，`swapPinnedAssets` 文件头注释已明确）
**Project Type**: single（护栏比较器改动集中于 `scripts/regen-collector-fingerprint-fixtures.ts` 一个源文件 + 两个消费测试文件）
**Performance Goals**: N/A（比较器输入规模固定为 pinned 基线 22 节点/14 边，递归深度实测 ≤ 2 层，性能非关注点）
**Constraints**: FR-016（禁改两份 pinned 资产）、FR-017（禁 bump `BEHAVIOR_VERSION`）、判定不变量第 2 条（禁在真实 fixture 目录跑 `--init`）
**Scale/Scope**: 单文件内部维度扩展，不新增模块/不新增导出面（FR-015 SHOULD + 事实清单已确认的既有纪律）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | 本计划及后续 tasks/实现注释均中文散文 + 英文标识符 |
| II. Spec-Driven Development | 适用 | PASS | 本卡通过 spec-driver story 流程执行，spec.md 已先行 |
| III. 如无必要勿增实体（YAGNI） | 适用 | PASS（含一项主动拒绝） | 见下方"Route 2 被拒绝"；新增的递归编码/转义/denylist 迭代均对应 spec 显式要求（FR-004/FR-006/FR-010），非假设性抽象 |
| IV. 诚实标注不确定性 | 适用 | PASS | 本计划所有裁决均带 `路径:行号` 证据锚；无法确定的项（如 `inputHash` 字段未来是否会在 graph-only 路径出现、`sourceCommit` 在非标准 `TMPDIR` 布局下的残余风险）显式标注为前瞻性风险而非确定结论 |
| V-VIII（spectra AST/pipeline/只读/Node 生态约束） | 部分适用 | PASS | 本改动不生成 Spec 文档、不涉及 LLM 生成路径；仅涉及"纯 Node.js 生态"（无新依赖，PASS）与"只读安全性"（比较器不写盘，仅 `runRegen` 主流程写盘，未改动） |
| IX-XIV（spec-driver Prompt/Harness 约束） | 不适用 | N/A | 本卡改动对象是 `scripts/`+`tests/`，非 `plugins/spec-driver/` 下的 Prompt/YAML/Hook |

**结论**：无 VIOLATION，无需豁免论证。

---

## 开放项 A 裁决：`graph.graph` 排除面（FR-010）

### 问题 1：`graph.graph.fingerprint` 是否应纳入比较？—— **裁决：排除**

**证据链**（`scripts/regen-collector-fingerprint-fixtures.ts:690-817`）：

1. `runRegen` 在 `pinned !== null` 分支里，`fingerprintUnchanged`（`:772`）由 `fingerprintsEqual(pinned.fingerprint, currentFingerprint)` 计算；`pinned.fingerprint` 来自 `loadPinnedPair`（`:890-926`）的 `graphFingerprint = parseCollectorFingerprint(graphOnly.graph.graph.fingerprint)`（`:903`）—— 即**它本来就是 `graph.graph.fingerprint` 字段的解析结果**，只是经过一层 `parseCollectorFingerprint` 的严格校验+重构（`collector-fingerprint.ts:302-344`）。
2. `currentFingerprint = computeCollectorFingerprint()`（`:702`）与 `rebuilt.graph.graph.fingerprint`（由 `buildAstGraphOnly` 内部在 `batch-orchestrator.ts:1507` `graphJson.graph.fingerprint = computeCollectorFingerprint()` 写入、经 `rebuildTracks` 的 `JSON.parse(fs.readFileSync(...))`（`:596-597`）回读）在同一进程内是**同一份纯函数的两次独立求值**（`computeCollectorFingerprint` 文件头明写"零 I/O"、"确定性构造"，`collector-fingerprint.ts:10-13`）。
3. 因此若把 `graph.graph.fingerprint` 也塞进 `compareGraphOnlyStructure` 的 `contentMismatch`：这个新增子项的"是否报差异"这一事实，与 `fingerprintUnchanged` 这一独立字段回答的是**同一个底层问题**（"当前指纹是否等于 pinned 记录的指纹"），只是走了两条不同代码路径。

**为什么这不只是"无害的双重计数"，而是有真实回归风险**：`fingerprintsEqual`（`collector-fingerprint.ts:387-400`）在比较前显式 `canonicalizeFingerprint`（`:365-377`，重新 `.sort()` 每条管线的 `extensions` 数组），其文件头注释明写理由（`:15-17`）：

> 两份指纹**是否语义相等**一律走 `fingerprintsEqual()`（canonical 化后字段级深比较），**MUST NOT** 用 `JSON.stringify` 字符串相等替代：`recordedFingerprint` 来自 `JSON.parse` 后的外部图产物字段，其字面键序与数组元素排列不受本模块控制（W-01）。

而 a-track 若照搬 FR-007 对 `nodeCount`/`schemaVersion` 等标量字段的处理方式（`JSON.stringify(a) !== JSON.stringify(b)` 之类的裸值比较），**恰恰是这条注释明确警告 MUST NOT 使用的比较方式**。两条比较路径的语义并不等价：`fingerprintsEqual` 对数组元素顺序不敏感，一个直接嵌入 `compareGraphOnlyStructure` 的裸值比较则天然顺序敏感。虽然 `toSurfaceEntry`（`:175-180`）保证 `computeCollectorFingerprint()` 每次都产出已排序数组，使得**当前**代码路径下两者实际不会分歧，但这是"恰好不触发"而非"结构上不可能触发"——一旦 `parseCollectorFingerprint` 未来放宽了对历史资产的兼容策略，或某次手工编辑资产引入未排序的 `extensions` 数组，会出现：`fingerprintUnchanged=true`（canonical 化后语义相等）但新增的 a-track 裸值子项报 `mismatch`（因为字面数组顺序不同）——`contentMismatch=true ∧ fingerprintUnchanged=true` ⇒ `shouldRejectRegen` 判 **true**，产出一次**与采集行为漂移毫无关系**的误拒绝，直接违反该判据的设计意图（`collector-fingerprint-regen-predicate.mjs:17`"指纹不可见的行为漂移"）。

**结论**：`graph.graph.fingerprint` **MUST 排除**，理由与 `graph.builder` 不同类：
- `builder` 排除理由（FR-009，沿用）：字段本身与"采集行为"无关（机器/commit 身份），比较它是噪声。
- `fingerprint` 排除理由（本次新增）：字段与采集行为**高度相关**，但它已经有一条**独立、canonical 化、且已经是 `shouldRejectRegen` 判据本身一个必要合取项**的专用比较通道（`fingerprintUnchanged`）。在 `contentMismatch` 里再放一份**非 canonical 化**的裸值比较，不是"多一层保险"，而是**引入一个与既有权威判定不一致的第二真源**，其唯一可能的效果是在两者语义分歧时产生误判——且分歧只可能朝着"误拒绝"的方向（见上段推导），不可能朝着"漏检"方向（因为 `fingerprintUnchanged=false` 时 `shouldRejectRegen` 已经整体判 false，新增子项此时是否报 mismatch 不影响最终判定）。这是一个**只有下行风险、没有上行收益**的比较维度。

**与既有先例 `compareGraphDeep` 的语境区分**（回应"若裁决与先例不同,须说明语境何以不同"）：

`compareGraphDeep`（`tests/integration/graph-quality-pinned-staleness.test.ts:154,205-209`）确实**不排除** `graph.fingerprint`（`:114` 事实清单已确认）。但该测试与本卡的场景在两个关键维度上不同：

1. **判定拓扑不同**：`compareGraphDeep` 是**单一裁决**（`mismatch` 直接作为唯一真值），不存在第二条独立计算同一事实的通道与其做布尔合取；而 `compareGraphOnlyStructure` 的产出要喂给 `shouldRejectRegen(contentMismatch, fingerprintUnchanged)` 这个**两臂合取判据**，其中一臂已经是 `fingerprintUnchanged`。把同一份数据塞进另一臂，是本卡场景特有的"双源同题"风险，`compareGraphDeep` 从未有过。
2. **输入来源不同**：`compareGraphDeep` 比较的是**真实 dist CLI 子进程**（`runGraphOnlyBatch`，`:136-141`，`spawn node CLI_PATH batch ...`）产出的图，而 `compareGraphOnlyStructure` 比较的是 `rebuildTracks` 用 `tsx` 直接 `import` 生产函数、**同进程**两次独立调用 `computeCollectorFingerprint()` 的结果（见上文推导 2）。前者天然只有"一次序列化"的顺序不确定性来源，后者存在"同进程两次求值是否语义等价"这一额外的、`fingerprintsEqual` 已经专门处理过的问题。

因此本卡对 `fingerprint` 的排除决策，与 `compareGraphDeep` 的既有先例并不矛盾——是同一条"只排除与本裁决目标无关或已被更权威机制覆盖的字段"原则，在不同判定拓扑下的不同应用结果。

### 问题 2：`graph.sourceCommit` 是否有跨机器不确定性？—— **裁决：不排除，纳入比较**（原论证机制有事实错误，已订正）

`resolveSourceCommit(projectRoot)`（`src/panoramic/graph/source-commit.ts:24-37`）执行 `execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, ... })`。**git 会向上追溯祖先目录寻找 `.git`**——`projectRoot` 自身没有 `.git` 并不意味着解析必然失败；只要 `projectRoot` 的任一祖先目录是 git 工作树，`git rev-parse HEAD` 就会追溯到那个祖先仓库并返回其 HEAD。

`[订正]` 本节此前的论证写成"`stageFixture` 不复制 `.git`，因此 `resolveSourceCommit` 确定性恒返回 `null`"——前半句（`stageFixture` 确实不复制 `.git`，`scripts/regen-collector-fingerprint-fixtures.ts:575-579`）为真，但由此推不出"确定性恒 null"：**真正的成立条件是 `stageFixture` 产出的临时目录（`os.mkdtempSync(path.join(os.tmpdir(), ...))`）及其全部祖先目录都不在任何 git 工作树内**，而不是"临时目录自身没有 `.git`"。

实测证据（锚定本机/本环境，非普适推导）：

```
$ D=$(mktemp -d); git -C "$D" init -q; git -C "$D" commit --allow-empty -m x
$ mkdir -p "$D/sub/deep"
$ git -C "$D/sub/deep" rev-parse HEAD
14bdf7238806c7ac03d8841aa094aeb31a40eb77      # 祖先仓被 git 向上追溯到，返回值非 null
```

上例证明"临时目录自己无 `.git`"不足以保证 `resolveSourceCommit` 返回 `null`——若临时目录的某个祖先恰好是 git 仓，会解析出那个祖先仓的 HEAD。本机/本环境下"恒 null"依然成立，但成立原因是**另一个更强的条件**：`os.tmpdir()` 本身及其全部祖先都不在任何 git 工作树内：

```
$ node -e 'console.log(require("os").tmpdir())'
/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T
$ git -C /var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T rev-parse --show-toplevel
致命错误：不是 Git 仓库（或者任何父目录）：.git
```

这与 `builder-stamp` 恒 `null` 仍是**同一族原因**（事实清单 §4.1 已点名"再生路径的产物"），但**不是同一个字段**、成因也不完全相同：`builder` 是"机器身份，即使能取到也该排除"，与是否解析成功无关；`sourceCommit` 是"在本机与典型 CI 的标准 `TMPDIR` 布局下取不到，但这是一个**依赖宿主环境配置**的经验事实，不是代码结构上的必然保证"——若宿主的 `os.tmpdir()`（或其任一祖先目录）恰好落在某个 git 工作树内，就会解析出一个与本次比较意图无关的祖先仓 HEAD（见下方风险登记新增条目）。

活性证据（事实清单 §6，`:135`）：当前 pinned 基线的 `graph.graph.sourceCommit` 在重建/pinned 两侧都是 `null`，`diffs=0` 已实测确认，纳入比较不会导致 FR-014 违反。`compareGraphDeep` 先例（事实清单 §5，`:114`）同样不排除 `sourceCommit`，两处判断一致，无需额外语境区分。

**裁决维持"不排除，纳入比较"**，但支撑理由改为：(1) 在本机与典型 CI 环境的标准 `TMPDIR` 布局下该字段两侧恒为 `null` 且已实测确认，FR-014 不受影响；(2) 即便在非标准 `TMPDIR` 配置下触发，也不是沉默漏检——护栏会正确报出一个真实存在的字段差异，只是差异成因与"采集行为漂移"无关，且可诊断、可自查（见下方风险登记）；(3) 排除该字段并不能消除"宿主环境依赖"这一根源（根源在 git 命令的祖先追溯语义），排除只是把"可诊断的误报"换成"该字段维度的沉默盲区"，不构成更优选择。**这是一条已知、诚实标注、且被评估为低概率的残余风险，不是"已证明不会发生"的结论**——与问题 1 中 `fingerprint`（排除、零残余风险）是不同的风险-收益权衡，两者结论不同并不矛盾。

### `graph.graph` 比较范围的最终实现策略：**denylist（排除集）而非 allowlist**

FR-007 给出的是"至少含"（`nodeCount`/`edgeCount`/`sources`/`skippedSources`/`schemaVersion`）而非穷举清单；`graph-types.ts:147-206` 显示 `graph.graph` 实际还有 `name`（`:154-155`，固定字面量）、`generatedAt`（`:156-157`，`stripTimestamps:true` 保证固定 epoch，事实清单 §6 已证实）、`inputHash?`（`:174-175`，F100 cache 字段，`buildAstGraphOnly` 路径未见其出现在事实清单 §6 的 10 字段枚举中，当前推断为该路径下恒缺席）。

若用固定 allowlist 逐条列出要比较的字段，**会重演本卡要修的同一类缺陷**——未来 `graph.graph` 新增字段时，若没人记得同步更新 allowlist，新字段会静默落入"两个维度都不比较"的盲区，这正是 F271 `lineRange` 事件（顶层 key 集合比较缺陷）在另一个字段族上的重演。因此实现策略定为：

```
GRAPH_GRAPH_EXCLUDED_FIELDS = new Set(['builder', 'fingerprint'])
比较字段集合 = (rebuilt.graph.graph 的 key 并集 pinned.graph.graph 的 key) − GRAPH_GRAPH_EXCLUDED_FIELDS
```

这与 `compareGraphDeep` 的 `DEEP_COMPARE_EXCLUDED_PATHS`（`:154`，同样是排除集而非白名单）在架构风格上完全一致，是本卡应当采纳的既定项目惯例，而非新发明。`directed`/`multigraph` 是 `GraphJSON` 顶层字段（不在 `graph.graph` 内，`graph-types.ts:149,151`），需要单独两行比较，不纳入上述 denylist 迭代。

**风险登记（denylist 策略的代价，之前未被记录）**：denylist 是"默认全比较、显式排除已知无关字段"的策略，好处是自动覆盖未来新增字段（不会重演本卡修的盲区），但代价是：若未来有人往 `graph.graph` 加一个**新的**机器/环境相关字段（类比 `builder`），却忘记把它加入 `GRAPH_GRAPH_EXCLUDED_FIELDS`，护栏会对该字段产生跨机器误报（与本卡试图排除的第一个字段 `builder` 曾经历的问题相同）。这是本次改动主动接受的权衡（fail-loud 默认 vs. 需要手动登记的例外），在 `GRAPH_GRAPH_EXCLUDED_FIELDS` 定义处的注释中必须显式写明"新增环境/机器相关字段时必须在此登记并给出理由，否则会跨机器误报"，把这条隐性纪律显式化。**诚实澄清**：`builder` 并非当前唯一"依赖宿主环境"的字段——`sourceCommit`（问题 2 已订正的论证）同样依赖宿主环境（`os.tmpdir()` 的 git 工作树归属），只是本次裁决评估其残余风险可接受且选择不排除；`GRAPH_GRAPH_EXCLUDED_FIELDS` 的登记纪律描述的是"未来新增字段"这一前瞻场景，不代表现有两个字段（`builder` 排除、`sourceCommit` 不排除）已穷尽了"宿主环境相关字段"这一类别的全部处置方式，两者是分别评估、可能得出不同结论的独立决策。

字段级比较方式：标量字段（`nodeCount`/`edgeCount`/`schemaVersion`/`name`/`generatedAt`/`sourceCommit`）用 `JSON.stringify(a) !== JSON.stringify(b)`（复用 `<absent>` 惯例：值为 `undefined` 时显示 `<absent>` 而非字面量 `"undefined"` 文本，与既有 `describeNodeMetadata` 的缺席态惯例保持一致）；数组字段（`sources`/`skippedSources`）同样走 `JSON.stringify` 整体比较，**顺序敏感**——理由：这两个数组由生产者按固定构建顺序写入（非用户可重排的输入，不同于 FR-011 明确要求顺序不敏感的 `nodes[]`/`links[]`），沿用 b-track `collectDeepDifferences` 对数组"顺序即语义"的既定处理方式（`:393` 注释），避免为一个当前无实证需求的场景（`sources` 数组被合法重排）新增顺序无关比较逻辑（YAGNI）。

---

## 开放项 B 裁决：既有精确断言文案漂移（FR-013，范围含新发现的第三处）—— **裁决：Route 1（更新断言）**

### 决策

metadata 签名从"顶层 key 数组"改为"递归 key 路径数组"后，三处受影响断言（`collector-fingerprint-guardrail.test.ts:382`、`:396`、`collector-fingerprint-regen-script.test.ts:342-344`）中，只有 `:382` 与 `:342-344` 两处真正受影响（两者都删除/新增**整个** `lineRange` 子树，会同时产生 `lineRange`/`lineRange.start`/`lineRange.end` 三条路径）；`:396` 的 `__mutantKey` 是标量新增（无子结构），不受递归化影响，保持不变。

对受影响的两处，**更新断言文案为完整三路径列表**，不采用"剪枝展示"：

```
# :382（原）
metadata key 集合不一致（重建缺失 [lineRange] vs 重建新增 []）: ${id}
# :382（新）
metadata key 集合不一致（重建缺失 [lineRange, lineRange.end, lineRange.start] vs 重建新增 []）: ${id}

# :342-344（原）
metadata key 集合不一致（重建缺失 [] vs 重建新增 [lineRange]）: ${victimId}
# :342-344（新）
metadata key 集合不一致（重建缺失 [] vs 重建新增 [lineRange, lineRange.end, lineRange.start]）: ${victimId}
```

（路径排序：默认字符串序，`lineRange` 是 `lineRange.end`/`lineRange.start` 的前缀故排最前；`lineRange.end` < `lineRange.start` 因 `'e' < 's'`——与事实清单 §6 实跑样本 `["...,"lineRange","lineRange.end","lineRange.start",...]` 的顺序完全一致，非本计划臆造。）

更新后的断言**仍是完整字符串的精确匹配**（沿用 `toContain(\`完整句子\`)` 形态），不退化为 `toContain('lineRange')` 式的弱关键词匹配——满足事实清单 §8 的硬约束。

### 为什么不选 Route 2（剪枝展示：只报最浅差异路径，判定仍用完整路径集合）

1. **当前无实证收益**：Route 2 要解决的问题是"深层子树差异刷屏"，但本仓库 metadata 当前唯一的嵌套结构是 `lineRange: {start, end}`（深度 1），删除整个子树只多出 2 条路径（`.start`/`.end`），完全不构成"刷屏"。Route 2 是为一个当前不存在的规模问题预先设计方案，违反 Constitution III（YAGNI：不为假设性未来需求增加抽象层）。
2. **引入的新复杂度需要自己的正确性证明**：Route 2 要求实现"祖先路径已在差异集合中时剪掉其后代路径"的展示层逻辑，这个逻辑本身有非平凡的边界（如"祖先在 missing 侧被剪，但后代在 extra 侧独立存在"这类交叉场景如何处理），且 spec 已经预判到这一点（"须论证剪枝只影响展示不影响判定，并设计一条钉死用例"）——这意味着 Route 2 需要**新增至少一条专门测试**来证明剪枝逻辑本身不引入新 bug，而 Route 1 不需要任何额外测试（更新后的字符串本身就是回归测试）。
3. **与本文件既有诊断哲学冲突**：`describeNodeMetadata` 的文件头注释（`:186-195`）明确阐述"分离 signature 与 keys 是为了让诊断正确性不依赖签名格式这一实现细节"，其潜台词是这个文件的诊断设计原则是**尽量减少展示层与判定层之间的隐式耦合**。Route 2 恰恰是在展示层引入一个"依赖判定层完整路径集合、但选择性隐藏部分信息"的新耦合点，与既有设计哲学方向相反。Route 1（展示层 = 判定层的直接、无剪裁投影）与既有 `missing`/`extra` 直接来自 key 集合 diff 的实现方式完全一致，零新增耦合。
4. **信息完整性**：本项目多处注释体现"不静默丢弃诊断信息"的一致纪律（如 `describeNodeMetadata` 对 `undefined` vs `{}` 的分档、`swapPinnedAssets` 对回滚失败"不吞异常"的处理）。Route 2 主动隐藏部分真实发生的路径差异（即使逻辑上可以从祖先差异推出后代也差异，但"具体是 `.start` 还是 `.end` 缺失"这类信息在 Route 2 下会被剪掉），与这条纪律的精神不符，即便 Route 2 声称"判定不受影响"。

**结论**：Route 1 是复杂度更低、与既有代码哲学更一致、且完全满足 spec 硬约束（保留完整格子文案）的选择。Route 2 记录在案作为"已评估并主动拒绝"的备选方案，不实现。

---

## 架构裁决：kind/label 与 metadata 共享同一比较骨架

任务描述已指出两个错误做法：
- **不要**把 `kind`/`label` 折进维度 1（节点 id multiset）的复合 key——会导致"改了 label"报成两条互相矛盾的"仅存在于重建产物/仅存在于 pinned"文案（诊断倒退，违反 FR-003）。
- **应该**落在 F278 维度 3（`compareNodeMetadataKeys`，按 node id 分组的富诊断分支）同一个"比较落点"，因为该维度天生就是"同 id 节点形态比较"。

本计划的具体做法是**泛化**（而非在维度 3 旁边新增一个平行的维度 4）：

| 现有符号（F278） | 新符号（本卡） | 变化 |
|---|---|---|
| `NodeMetadataShape { signature, keys }` | `NodeShape { kindSignature, labelSignature, metadataSignature, metadataPaths }` | 新增 kind/label 两个独立 signature 字段；`keys: string[]\|null` 改名语义扩展为 `metadataPaths: string[]\|null`（递归路径而非顶层 key） |
| `describeNodeMetadata(node)` | `describeNodeShape(node)` | 内部调用一个保留的 `describeNodeMetadata` 子过程产出 metadata 部分，新增两次 `describeScalarField(node, 'kind'/'label')` 调用 |
| `groupNodeMetadataShapes(nodes)` | `groupNodeShapes(nodes)` | 泛型不变，`Map<id, NodeShape[]>` |
| `compareNodeMetadataKeys(rebuilt, pinned)` | `compareNodeShapes(rebuilt, pinned)` | 分组/去重/multiset 分支的骨架逻辑不变（`:262-291` 原样保留），单节点富诊断分支从"只查 metadata 差异"扩展为"依次查 kind / label / metadata 三个 facet，每个不同的 facet 各自产出一条独立诊断行" |

**为什么泛化而不是新增平行函数**：`compareNodeMetadataKeys` 的分组与重复 id multiset 分支（`:262-291`，约 30 行）是本文件复杂度最高的一段逻辑，其正确性此前已由 F278 的多条测试钉死（重复 id key-set multiset 计数、乱序判一致等）。若新增一个平行的 `compareNodeKindLabel` 各自重新实现一遍分组/去重/multiset 骨架，会产生"消除重复"约定明确禁止的重复逻辑，且两份骨架未来独立演化会产生行为分歧风险。复用同一骨架、只在"单节点富诊断分支"里按 facet 分叉，是复杂度更低、正确性风险更小的选择。

**重复 id 场景的复合签名**（回应"新维度在 `:288-301` multiset 分支下如何表达"）：

`NodeShape` 的**复合等价签名**定义为 `JSON.stringify([kindSignature, labelSignature, metadataSignature])`，替换原先仅用 `metadataSignature`（即 `NodeMetadataShape.signature`）做 multiset key 的做法。这不会削弱既有检测力（原逻辑能检测到的 metadata-only 差异，复合签名同样能检测——metadata 部分不等则整个复合签名必然不等）；新增的能力是：重复 id 场景下 kind/label 的 multiset 级差异现在也能被捕获（此前完全不可见）。诊断粒度上做了权衡：重复 id 分支延续既有设计"不做逐节点两两配对的精确归因"（`:278-280` 原有注释已说明理由——重复节点没有可对应身份，强行配对会编造误导性结论），因此复合签名分支产出的是粗粒度"节点形态签名计数不一致"提示（含完整复合签名 JSON 供人工排查），而非精确到"哪个字段变了"——这与现状对 metadata-only 重复 id 差异的诊断粒度一致，不是本卡引入的新降级。

---

## metadata 递归 key 路径编码规范（回应"其他必须覆盖"第 2 点）

### (a) 递归规则

只递归 **plain object**（`typeof === 'object' && !Array.isArray && !== null`）；遇到数组、`null`、字符串、数字、布尔值一律视为叶子，不再往下递归（FR-004 硬性规定）。对每个遇到的 key（无论其值是 plain object 还是叶子），**先记录该 key 自身的路径**，若其值是 plain object 才继续递归记录子路径——即中间层的"对象类型 key"本身也算一条独立路径，不是只记叶子。

### (b) 空嵌套对象的碰撞坑

若只记叶子路径，`{lineRange: {}}`（空对象）会因为没有任何叶子而产出 0 条路径，与 `{}`（`lineRange` 键完全不存在）产出的 0 条路径**无法区分**——两者会碰撞成同一签名。(a) 规则里"先记录 key 自身路径，再判断是否递归"正是为了堵住这个坑：`{lineRange: {}}` 产出路径 `['lineRange']`（1 条），`{}` 产出路径 `[]`（0 条），签名 `JSON.stringify(['lineRange'])` 与 `JSON.stringify([])` 不同，不碰撞。

需新增一条合成测试（当前 fixture 无此形态）来钉死这条规则本身，见下方"红先行顺序"。

### (c) 分隔符歧义的可判定编码

Key 名含字面 `.` 时，`{'a.b': 1}`（一个 segment）与 `{a: {b: 1}}`（两个 segment、路径 `a.b`）若都直接用 `.` 拼接展示字符串，会产出同一个显示字符串 `"a.b"`，无法区分——用于**判定**（等价性比较）时若也用同一套拼接字符串做签名，会产生假阴性（两种不同结构被误判为同一路径集合的一部分）。

**编码方案**：定义转义函数 `escapeMetadataPathSegment(segment) = segment.replace(/\\/g, '\\\\').replace(/\./g, '\\.')`（先转义反斜杠本身，再转义字面 `.`，标准可逆转义顺序，避免二义性）。路径 = 各 segment 转义后用**未转义**的 `.` 连接。

- `{a: {b: 1}}` → segments `['a', 'b']` → 转义后 `['a', 'b']`（均无特殊字符）→ 路径 `'a.b'`
- `{'a.b': 1}` → segment `['a.b']` → 转义后 `['a\\.b']` → 路径 `'a\\.b'`（显示为 `a\.b`）

两者显示字符串不同（`a.b` vs `a\.b`），签名（`JSON.stringify` 排序后的路径字符串数组）自然不同，判定正确、展示也无歧义。该转义函数是本文件内部新增的一个纯函数（≤3 行），不导出（见下方"不新增导出面"）。

`[推断]` 当前 22 节点 pinned 基线的全部 metadata key 均不含 `.` 或 `\`（事实清单 §6 递归路径样本已列出全部实际出现的 key 名：`exportKind`/`lineRange`/`lineRange.end`（此处 `.` 是路径分隔符不是 key 名本身）/`lineRange.start`/`sourcePath`/`sourceTag`/`unifiedKind`/`callSitesCount`），因此这条编码规则在**当前**语料上是零行为差异的纯前瞻性加固，验证只能靠合成测试（非 fixture 驱动），见"红先行顺序"。

---

## kind/label 缺席/非字符串态的处理（回应"其他必须覆盖"第 4 点）

沿用 `describeNodeMetadata` 的分档惯例，但**简化**：kind/label 在类型定义（`graph-types.ts:59-62`）上都是标量（字符串/字符串字面量联合），不像 `metadata` 那样有"对象 vs 非对象"的二階判断需求，因此只需一档缺席判断：

```
describeScalarField(node, field) =
  raw === undefined ? '<absent>' : JSON.stringify(raw)
```

`JSON.stringify` 天然区分空字符串（`'""'`）、`null`（`'null'`）、正常值（`'"module"'`），满足 spec Edge Case"缺失与存在但为空字符串视为不同状态"的要求，且比 metadata 的"对象/非对象"两档判断更简单——这是判断该 facet **不需要**照搬 metadata 三档设计的正确复杂度评估，而非偷懒省略。

---

## 不新增导出面（回应第 5 点）

`compareGraphOnlyStructure` 保持为唯一导出的比较入口（`export function compareGraphOnlyStructure`，`:337`），`StructuralComparison` 接口保持不变（`{ mismatch, differences }`）。新增/泛化的以下符号全部保持 module-private（不加 `export`）：

`describeNodeShape` / `describeScalarField` / `groupNodeShapes` / `compareNodeShapes` / `compareGraphMetadata` / `escapeMetadataPathSegment` / `collectMetadataKeyPaths` / `GRAPH_GRAPH_EXCLUDED_FIELDS`

这与 `compareNodeMetadataKeys` 当前刻意保持 module-private 的纪律一致（事实清单 §1 已确认该函数无 export 关键字），也是文件头注释"不为复用私有函数扩大再生脚本导出面"（`graph-quality-pinned-staleness.test.ts:33-36` 引用的同一条纪律）在本文件内部的延续。

---

## Complexity Tracking

*本节按项目惯例逐条给出"为什么不能更简单"，而非因为触发了 Constitution 违规（无 VIOLATION，本节是主动的复杂度自证）。*

| 新增复杂度 | 为什么需要 | 更简单的替代方案为何被拒绝 |
|---|---|---|
| metadata key 递归路径提取（`collectMetadataKeyPaths`） | FR-004 硬性要求；F271 lineRange 事件已证明"只看顶层 key"是会被真实踩中的盲区类别 | 硬编码只展开 `lineRange` 这一个已知字段：无法泛化到未来任何新的嵌套 metadata 字段，等于把本卡要修的盲区换个位置重新埋一次 |
| 路径分隔符转义（`escapeMetadataPathSegment`） | edge case (c) 要求给出可判定编码；不转义会在 key 名含 `.` 时产生签名假阴性 | 用数组而非字符串做签名（`JSON.stringify([['a','b']])` 天然无碰撞）：可行但放弃了转义带来的"展示字符串本身也无歧义"的额外收益，且当前实现改动量相近，转义方案额外成本仅一个 3 行纯函数，收益更高故采纳 |
| `compareGraphMetadata` 的 denylist 迭代（而非固定字段清单） | 若干次强调：allowlist 会重演本卡本身要修的盲区类别（新字段静默零覆盖） | 固定 allowlist（`nodeCount`/`edgeCount`/`sources`/`skippedSources`/`schemaVersion`）：更符合 FR-007 字面"至少含"清单、实现更短，但违反"不重演同类盲区"的架构一致性原则，故拒绝 |
| `NodeShape` 复合签名（kind+label+metadata 合一） | 复用既有 multiset 骨架，避免三份平行去重逻辑重复 | 三个独立 multiset（kind 一个、label 一个、metadata 一个）：检测力理论上更细，但对"重复 id"这一本就是粗粒度诊断的边缘场景，三倍实现成本换取的诊断精度收益极低，且原有代码已表明重复 id 场景刻意不做精细归因（`:278-280`） |
| **（主动拒绝）** Route 2 展示层剪枝 | 不采纳 | 见"开放项 B 裁决"第 4 段 4 点理由；本行仅为完整记录"考虑过但拒绝"的复杂度决策 |

---

## 红先行顺序（先写变异用例见 FAIL，再改实现）

以下按依赖顺序排列；每一步在"改实现前"先运行确认预期的 FAIL 输出，实现后重跑确认 PASS。**全部新用例基于临时副本 fixture 或合成 `GraphJSON` 对象构造，不修改两份 pinned 资产**（FR-016）。

1. **kind 变异**（对应 US1 AS-1）：复用 `injectMetadataOnSharedNode` 式的构造器改造为 `injectNodeShapeOnSharedNode`，把 `rebuilt.nodes[0].kind` 从原值改为一个不同的合法枚举值。改实现前跑：`compareGraphOnlyStructure` 返回 `mismatch=false`（当前实现结构性看不见 kind，对照事实清单 §2 盲区 1 实测已验证）。这一步只需确认现状，不需要真的先跑一次断言失败的测试（因为断言本身要等实现后才能写"kind 不一致"这个新期望字符串）——正确的红先行做法是：先写「`mismatch` 应为 `true`」的断言（不含具体文案），跑之应 FAIL（现状 `mismatch=false`）；实现 `describeScalarField`/`compareNodeShapes` 后转 PASS，再补上文案的精确断言。
2. **label 变异**：同上构造模式，改 `label`。
3. **kind/label 均缺席（`undefined`）**：验证 `<absent>` 档正确触发且与"空字符串"档不混同（两个独立合成用例）。
4. **metadata 嵌套 key 改名**（对应 US2 AS-1）：把某节点 `metadata.lineRange` 从 `{start, end}` 改为 `{from, to}`。改实现前跑：`mismatch=false`（对照事实清单 §2 盲区 2 实测）。实现递归路径提取后转 PASS，断言文案含 `lineRange.start`/`lineRange.end`（缺失侧）与 `lineRange.from`/`lineRange.to`（新增侧）。
5. **metadata 嵌套 key 内层删除**（对应 US2 AS-2）：`delete metadata.lineRange.end`。改实现前 `mismatch=false`；实现后 PASS，断言文案含 `lineRange.end`（缺失）但不含 `lineRange`/`lineRange.start`（未变的路径不应出现在 missing 列表里——这一条同时钉死"只报真正变化的路径，不误报未变路径"）。
6. **既有精确断言迁移**（FR-013 三处，见"开放项 B 裁决"）：实现递归路径提取后，`collector-fingerprint-guardrail.test.ts:382` 与 `collector-fingerprint-regen-script.test.ts:342-344` 两处**原文案**先转 FAIL（预期行为——证明实现确实改变了可观察格式），随后更新为本计划给出的三路径新文案，重新转 PASS。`:396`（`__mutantKey`）保持不变、全程 PASS，作为"标量新增不受递归影响"的负面对照。
7. **空嵌套对象合成用例**（edge case b）：合成一个节点 `metadata = { lineRange: {} }` vs 对照节点 `metadata = {}`，断言两者签名不同、`mismatch=true` 且不误判为一致。
8. **分隔符歧义合成用例**（edge case c）：合成 `metadata = { 'a.b': 1 }` vs `metadata = { a: { b: 1 } }`，断言两者签名不同（`mismatch=true`），锁定转义编码的判定正确性；可选再断一条展示字符串确实分别是 `a\.b` 与 `a.b`（若该细节被采纳进最终实现）。
9. **`graph.graph` 字段变异**（对应 US3 AS-1/AS-2，`compareGraphMetadata`）：分别构造 `nodeCount`/`schemaVersion`/`sources` 清空/篡改、`directed`/`multigraph` 翻转的合成用例。改实现前 `mismatch=false`（对照事实清单 §2 盲区 3 实测）；实现后 PASS，文案含具体字段名与新旧值。
10. **`builder` 负面对照**（对应 US3 AS-3）：只改 `graph.graph.builder`，实现前后均应 `mismatch=false`——这是"必须保持 GREEN"的负控，不是红先行。
11. **`fingerprint` 负面对照（新增，钉死问题 1 裁决）**：只改 `graph.graph.fingerprint`（如 `behaviorVersion` 单独改一个不同的数），验证 `compareGraphOnlyStructure` 单独调用时 `mismatch=false`（结构性不再看 fingerprint）；再补一条集成级测试验证：当 `runRegen` 的 `fingerprintUnchanged=false`（因为指纹确实变了）时，`shouldRejectRegen` 依然正确判 false（放行分支），行为与改动前一致——防止"排除 fingerprint 字段"这个决策被未来的人误当作 bug 修复重新加回去。
12. **顺序不敏感回归**（FR-011，既有用例 `:344-350` 应保持不动仍 PASS）：确认新增的 kind/label/graph.graph 三个维度均未引入顺序敏感性（它们天然按 node id/固定字段名索引，不依赖数组下标，理论上不会引入新的顺序敏感性，但仍需运行既有"仅节点顺序反转"用例确认无回归）。
13. **重复 id 复合签名用例**（对应"重复 id 场景"要求）：扩展 `injectDuplicatedNodeMetadata` 式构造器，让两侧同 id 的 2 个副本仅 `kind` 不同（metadata/label 相同），验证复合签名 multiset 分支能捕获（当前 `compareNodeMetadataKeys` 的等价用例 `:539-557` 只测了 metadata 维度，需要新增一条 kind 维度的对应用例）。
14. **端到端确认**（FR-014）：`npm run fixtures:regen:collector-fingerprint`（真实 fixture，无 `--fixture-root`，无 `--init`）应输出"无需更新"，`diffs=0`，验证全部新增维度在当前 pinned 基线上真实判绿（不是只在合成用例里判绿）。
15. **全量回归 + `lint`/`build`**（SC-006）：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts tests/integration/collector-fingerprint-regen-script.test.ts`、`npx vitest run`（全量，确认无跨文件回归）、`npm run lint`、`npm run build`。

---

## 风险登记表

### (a) 活性证明判红时的分叉处置

事实清单 §6 已实测三族新维度在当前 pinned 基线上天然 `diffs=0`（`graph.graph` 10/10 全同、kind/label 差异数 0/22、metadata 递归路径差异数 0）。若实现完成后第 14 步（真实 fixture 端到端跑）判红，**禁止**：
- 用 `--init` 冷启动重建资产绕过（判定不变量第 2 条明文禁止在真实 fixture 目录跑 `--init`）
- bump `BEHAVIOR_VERSION`（FR-017 明文禁止，且六类 bump responsibility 均不覆盖"护栏比较维度扩展"这一变化类别，`collector-fingerprint.ts:96-101` 已有 F271 同类先例的处置记录可参照）

正确处置：判红即视为**实现 bug**（大概率是排序/转义/递归终止条件的实现错误），优先复核第 7/8/9/11 步的合成用例是否已经暴露出该 bug 的更小复现——若合成用例全绿但真实 fixture 判红，说明合成用例覆盖不到真实语料的某种形态，需要先补合成用例定位根因，再修实现，绝不能跳过诊断直接用 `--init`/bump 让红变绿。**若判红且 `differences` 只含一条 `graph.graph.sourceCommit 不一致`**，需先排查是否命中下方风险登记 (d)（宿主 `TMPDIR` 落在 git 工作树内），这是一种环境问题而非实现 bug，处置方式不同（见 (d)）。

### (b) 本次改动对 `runRegen` 拒绝面的影响方向

延续事实清单 §7 的结论并做精确化：`contentMismatch` 更容易为 true（kind/label/metadata 嵌套/graph.graph 非 builder/fingerprint 字段任一变化都会让它变 true），`shouldRejectRegen = contentMismatch ∧ fingerprintUnchanged` 因此**只会变得更容易触发拒绝，不会变得更容易放行**——这一结论对**除 fingerprint 外**的全部新增维度成立。对 `fingerprint` 维度本身，本计划的排除决策使其对 `contentMismatch` **零贡献**（既不会让判据更严也不会更松，因为 `fingerprintUnchanged` 已经独立承担这个信号，见开放项 A 问题 1 的完整推导）——这不是"拒绝面变松"，而是"拒绝面的严格度对该字段保持与改动前完全相同"，需要在提交信息里明确这一点，避免被误读为"本卡削弱了护栏"。

### (c) code-context.md 未记录的新风险

1. **FR-013 遗漏第三处断言**（本计划已发现并补入范围，见文首"新发现"一节）——若 tasks/implement 阶段仍只处理事实清单 §8 点名的两处，`collector-fingerprint-regen-script.test.ts` 的集成测试会在实现完成后意外变红。
2. **README.md 文档漂移**（非阻塞，但应在 implement 阶段同步）：`tests/fixtures/collector-fingerprint-guardrail/README.md:92-96`"护栏报 `metadata key 集合不一致` 时的处置路径"一节明确写道"按 node id 分组比较节点 `metadata` 的 **key 集合**（只比 key 名，不比 value）"，未提及递归路径这一拓宽。该文件不是 FR-016 保护的 pinned 资产（只有 `expected-*.json` 两份 JSON 受保护），更新它不违反任何判定不变量，但若不同步会造成文档与实现描述不一致，建议 implement 阶段顺带更新这一节的措辞（"key 集合"→"递归 key 路径集合"），不引入新的验收标准，仅为质量项。
3. **`graph.graph.inputHash?` 字段的未来风险**（`graph-types.ts:174-175`，F100 cache 字段）：事实清单 §6 的 10 字段活性枚举中未出现 `inputHash`，`[推断]` 当前 `buildAstGraphOnly` 路径不写入该字段（否则会出现在枚举里）。denylist 策略下，若该字段未来在 graph-only 路径开始出现且其值是内容哈希（不同于 `builder` 的机器/dist 哈希），只要内容确定性生成（相同输入→相同哈希），不应加入排除集；若它被证明与 `builder`/`fingerprint` 同类（环境/机器相关而非内容相关），则应在 `GRAPH_GRAPH_EXCLUDED_FIELDS` 追加登记并给出理由。本计划**不**预先排除 `inputHash`（当前无证据支持排除，排除无实证字段违反 FR-010"不得排除随采集行为变化字段"的精神），仅记录为需要后续关注的观察点。
4. **重复 id 复合签名的诊断粒度降级面扩大**（架构裁决一节已分析，非新增缺陷但需要在 tasks 阶段显式验收）：合入复合签名后，重复 id 场景下 kind/label 的差异只会得到"形态签名计数不一致"这类粗粒度提示，不会精确到"是 kind 变了还是 label 变了"。这是本卡主动的复杂度权衡（与既有 metadata-only 粗粒度诊断一致），但如果未来有人期望重复 id 场景也有精确到字段的诊断，需要重新评估三个独立 multiset 的成本收益——当前不实现，仅记录该权衡的存在。

### (d) `graph.graph.sourceCommit` 残余风险（新增；纳入比较的裁决未消除，只是评估为低概率）

**触发机制**：`resolveSourceCommit`（`src/panoramic/graph/source-commit.ts:24-31`）执行 `git rev-parse HEAD`，git 会向上追溯祖先目录寻找 `.git`。若维护者的 `os.tmpdir()`（可能受 `TMPDIR` 环境变量影响）本身或其任一祖先目录恰好是 git 工作树，`stageFixture` 产出的临时目录（`os.mkdtempSync` 建在 `os.tmpdir()` 下）虽然自己没有 `.git`，仍会被 `git rev-parse HEAD` 追溯解析出**该祖先仓库的 HEAD**，而非 `null`。此时 `rebuilt.graph.graph.sourceCommit`（解析出的真实 commit）会与 `pinnedGraphOnly.graph.graph.sourceCommit`（pinned 资产里固化的 `null`）不相等，`compareGraphMetadata` 会报 `graph.graph.sourceCommit 不一致`，使 a-track `contentMismatch=true`。

**触发条件**：`os.tmpdir()`（或 `TMPDIR` 环境变量指向的目录）本身或其任一祖先目录是 git 工作树。本机与典型 CI 默认路径（`/tmp`、`/var/folders/.../T` 等）实测不满足（见问题 2 的实测证据），但某些容器化/沙箱开发环境把 `TMPDIR` 显式指向项目内部子目录（如 `<repo>/.tmp/`）时会满足此条件。

**判定方法**：若 `runRegen`/单测报的 `differences` **只含一条** `graph.graph.sourceCommit 不一致`、其余全部维度（节点/边/kind/label/metadata/其余 graph.graph 字段）均一致，应首先怀疑命中本风险而非真实的采集面漂移。自查命令：

```
git -C "$(node -e 'console.log(require("os").tmpdir())')" rev-parse --show-toplevel
```

若该命令成功输出一个仓库路径（而非报错"不是 Git 仓库"），说明 `os.tmpdir()` 落在某个 git 工作树内，本风险成立。

**处置建议**：确认命中后，**不要**当作真实的护栏拒绝处理——不 bump `BEHAVIOR_VERSION`，不 `--init`，不修改比较器代码"绕过"这个字段；正确处置是调整本地/CI 的 `TMPDIR`/`os.tmpdir()` 配置使其指向仓库外部、非 git 工作树内的路径，这是环境配置问题而非代码或 pinned 资产问题。

**诚实标注**：这是本计划**评估后选择接受、而非已消除**的残余风险。裁决"纳入比较"是在承认此风险存在的前提下做出的权衡（收益：能检测真实的 `sourceCommit` 漂移；代价：在少数非常规 `TMPDIR` 配置下会产生一次可诊断、可自查、原因明确的误报，且误报方向只会导致"过度拒绝再生"而不会导致"漏检真实漂移"）。这与 `graph.graph.fingerprint`（排除、零残余风险但也零检测收益）是不同类别的风险-收益判断，两者结论不同（一个排除、一个纳入）是分别评估的结果，不代表判断标准不一致——`builder`（排除）同样依赖宿主环境，但其排除理由是"即使能取到也与采集行为无关"，与 `sourceCommit`"取到时通常反映真实 provenance"的性质不同，三个字段（`builder`/`fingerprint`/`sourceCommit`）各自独立评估、结论不必相同。

---

## Project Structure

### Documentation (this feature)

```text
specs/279-guardrail-detection-widening/
├── code-context.md      # 已存在（编排器产出，不修改）
├── spec.md               # 已存在（不修改）
└── plan.md               # 本文件
```

### Source Code（受影响文件，均为已存在文件的内部修改，不新增文件）

```text
scripts/
└── regen-collector-fingerprint-fixtures.ts   # 主要改动：describeNodeShape/groupNodeShapes/
                                                #   compareNodeShapes（泛化自 F278 三个 helper）+
                                                #   compareGraphMetadata（新增）+
                                                #   collectMetadataKeyPaths/escapeMetadataPathSegment（新增私有 helper）+
                                                #   GRAPH_GRAPH_EXCLUDED_FIELDS（新增私有常量）

tests/unit/guardrail/
└── collector-fingerprint-guardrail.test.ts    # 新增变异用例（kind/label/嵌套 metadata/graph.graph/
                                                #   fingerprint 负面对照/重复 id 复合签名/合成边界用例）+
                                                #   更新 :382/:396 两处既有断言（:396 实为不变，仅 :382 需改）

tests/integration/
└── collector-fingerprint-regen-script.test.ts # 更新 :342-344 一处既有断言（FR-013 范围扩展项）

tests/fixtures/collector-fingerprint-guardrail/
└── README.md                                   # 非阻塞质量项：同步"只比顶层 key"措辞为"递归 key 路径"
                                                 # （不修改同目录下两份 expected-*.json，FR-016 保护对象不含 README）
```

**Structure Decision**：单文件内部维度扩展 + 两个既有测试文件的用例扩展/断言更新，无新增源文件、无新增导出面、无新增依赖，与 spec.md"复杂度评估"一节判定的 MEDIUM（组件 3、接口 3-4、1 个递归结构复杂度信号）一致；plan 阶段额外识别的复合签名/denylist/转义三处新增复杂度均已在 Complexity Tracking 表逐条给出必要性论证。
