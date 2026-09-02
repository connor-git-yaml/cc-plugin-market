---
description: "Task list for feature 279 — a-track 护栏比较器检测面拓宽"
---

# Tasks: a-track 护栏比较器检测面拓宽（node.kind/label + metadata 嵌套 key + graph.graph 元数据）

**Input**: `specs/279-guardrail-detection-widening/plan.md`（已定稿，本文件不得推翻其裁决）、
`specs/279-guardrail-detection-widening/spec.md`（17 条 FR / 3 个 User Story / 6 条 SC）、
`specs/279-guardrail-detection-widening/code-context.md`（编排器实读事实清单）

**Tests**: spec.md 与 plan.md 均要求测试先行（红先行顺序，plan §"红先行顺序"共 15 步），本卡强制包含测试任务。

**红先行硬性纪律**（适用于下方所有标注"RED"的任务，逐条落实，不得简化为"写完测试和实现一起跑"）：
先写「`mismatch` 应为 `true`」的**粗断言**（不含具体诊断文案），跑之确认 **FAIL**（证明现状确实是盲区，对照
`code-context.md §2` 已实测的 `diffs=0` 基线）；实现完成后重跑确认转 **PASS**；随后再补一个独立的**精确文案断言**
任务（含节点 id / 字段名 / 新旧值等诊断细节），重跑确认 PASS。三段（粗断言 RED → 实现 → 精确断言 PASS）在下方
拆成独立任务，禁止合并简化。

**范围收敛**：本卡改动集中于 `scripts/regen-collector-fingerprint-fixtures.ts` 一个源文件 +
`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` + `tests/integration/collector-fingerprint-regen-script.test.ts`
两个既有测试文件的用例扩展/断言更新 + `tests/fixtures/collector-fingerprint-guardrail/README.md` 的措辞同步（非阻塞质量项）。
**禁止**新增源文件、新增导出面、修改两份 pinned 资产（`expected-*.json`）、修改 `BEHAVIOR_VERSION`。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件或不同断言片段、无依赖）
- **[US1/US2/US3]**: 对应用户故事；Setup/Foundational/Polish 阶段不加标记

---

## Phase 1: Setup

- [ ] **T001** 确认基座与工作区状态：`git log --oneline -1` 确认已 rebase 到含 F278 的提交
  （`code-context.md §0` 记录基座为 `058c7012` 或更新），`git status --short` 为空（无未提交改动）。
  **验收**：两条命令均按预期输出；若基座缺 F278（`groupNodeMetadataShapes`/`compareNodeMetadataKeys`
  在 `scripts/regen-collector-fingerprint-fixtures.ts` 搜不到），先 `git fetch` + rebase 到最新 master 再继续。
  **依赖**：无。

---

## Phase 2: Foundational（US1/US2 共享骨架，Blocking Prerequisites）

**目的**：按 plan「架构裁决」把 F278 的 `NodeMetadataShape`/`describeNodeMetadata`/`groupNodeMetadataShapes`/
`compareNodeMetadataKeys` **就地泛化**为覆盖 kind/label/metadata 三 facet 的骨架，供 US1（kind/label）与
US2（metadata 递归路径）复用同一落点，避免新增平行维度 4（plan 明文禁止）。

**⚠️ CRITICAL**：US1/US2 的实现任务（T010、T016）依赖本阶段产出的骨架符号，须在其之前完成。

- [ ] **T002** [Foundational] 在 `scripts/regen-collector-fingerprint-fixtures.ts` 内新增类型
  `NodeShape { kindSignature: string; labelSignature: string; metadataSignature: string; metadataPaths: string[] | null }`，
  与既有 `NodeMetadataShape` 并存（不删除旧类型，避免中间态编译失败；最终由 T010 完成替换收口）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 全量仍 100% PASS
  （本任务纯新增类型，未接线，零行为变化）。
  **依赖**：T001。

- [ ] **T003** [P] [Foundational] 新增私有 helper `describeScalarField(node, field)`：
  `raw === undefined ? '<absent>' : JSON.stringify(raw)`（plan「kind/label 缺席态」裁决），
  紧邻既有 `describeNodeMetadata`（`:217-226` 附近），module-private（不加 `export`）。
  **验收**：同 T002，`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 零回归
  （未接线，纯新增函数）。
  **依赖**：T001。

- [ ] **T004** [P] [Foundational] 新增两个私有 helper：
  (a) `escapeMetadataPathSegment(segment) = segment.replace(/\\/g, '\\\\').replace(/\./g, '\\.')`
  （先转义 `\` 再转义 `.`，plan「分隔符歧义的可判定编码」裁决）；
  (b) `collectMetadataKeyPaths(value, prefixSegments)` 递归函数：只递归 **plain object**
  （`typeof === 'object' && !Array.isArray && !== null`）；数组/`null`/字符串/数字/布尔值一律按叶子处理；
  **先记录 key 自身路径，再判断是否递归**（堵空嵌套对象碰撞坑，plan edge case b）；
  各 segment 转义后用未转义的 `.` 连接。两者均 module-private，位置紧邻 T003。
  **验收**：同 T002/T003，未接线，零回归。
  **依赖**：T001。

- [ ] **T005** [Foundational] 新增私有常量
  `GRAPH_GRAPH_EXCLUDED_FIELDS = new Set(['builder', 'fingerprint'])`（开放项 A 裁决：denylist 非 allowlist），
  紧邻处以注释显式登记纪律：「新增环境/机器相关字段时必须在此登记并给出理由，否则会跨机器误报」
  （plan「风险登记表」denylist 代价一节要求的显式化）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 零回归（未接线）。
  **依赖**：T001。

**Checkpoint**：骨架符号（`NodeShape`/`describeScalarField`/`collectMetadataKeyPaths`/
`escapeMetadataPathSegment`/`GRAPH_GRAPH_EXCLUDED_FIELDS`）就绪，US1/US2/US3 的实现任务可以开始接线。

---

## Phase 3: User Story 1 — node.kind / node.label 改动可被护栏检出 (Priority: P1) 🎯 MVP

**目标**：`kind`/`label` 单点变异必须被护栏检出并精确定位到节点 id + 字段名（对应 F250 已发生过的真实误读，
`code-context.md §3`）。

**Independent Test**：在临时副本 fixture 或合成 `GraphJSON` 对象上单点变异首个节点的 `kind`/`label`，
跑 `compareGraphOnlyStructure`，验证 `mismatch=true` 且诊断文案定位到该节点 id 与变化字段；可独立于
US2/US3 单独验收。

### Tests for User Story 1（RED 先行，逐条见下方纪律）

- [ ] **T006** [US1] RED-粗断言：在 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 新增用例
  "仅变异首个节点 kind"——把重建产物某节点 `kind` 从原值改为一个不同的合法枚举值，其余字段不变。
  先写「`mismatch` 应为 `true`」的粗断言（不含具体文案）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts -t "kind"` **FAIL**
  （现状 `mismatch=false`，对照 `code-context.md §2`"盲区 1：node.kind"实测记录）。
  **依赖**：T001（不依赖 Foundational 骨架，测试本身先于实现落地）。

- [ ] **T007** [US1] [P] RED-粗断言：同上构造模式，新增"仅变异首个节点 label"用例，先写 mismatch=true 粗断言。
  **验收**：同上命令按 label 用例名过滤，**FAIL**（现状 `mismatch=false`）。
  **依赖**：T001。

- [ ] **T008** [US1] [P] RED-粗断言（edge case）：合成两个独立用例——(a) 首个节点 `kind` 缺失（`undefined`）；
  (b) 首个节点 `label` 缺失（`undefined`）——分别断言 mismatch=true；并各自补一个"空字符串"对照用例
  （`kind=''`/`label=''`），断言其签名与 `<absent>` 档不同（两条独立断言，不要求此刻 mismatch=true，
  仅要求签名字符串不相等，为 T011 精确化打基础）。
  **验收**：缺席两用例 **FAIL**（现状结构性看不到 kind/label，`mismatch=false`）；空字符串对照用例可先跳过
  （`.skip` 或留空断言占位），待 T010 实现后在 T011 一并补全。
  **依赖**：T001。

- [ ] **T009** [US1] RED-粗断言（重复 id 复合签名）：扩展 `injectDuplicatedNodeMetadata` 式构造器，
  令两侧同 id 各 2 副本仅 `kind` 不同（`metadata`/`label` 相同），断言 mismatch=true。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts -t "重复"` **FAIL**
  （现状复合 multiset 分支只用 `metadataSignature`，kind 差异结构性不可见）。
  **依赖**：T001。

### Implementation for User Story 1

- [ ] **T010** [US1] IMPL：将 `groupNodeMetadataShapes` 泛化为 `groupNodeShapes`（产出 `NodeShape`，
  `kindSignature=describeScalarField(node,'kind')`、`labelSignature=describeScalarField(node,'label')`，
  `metadataSignature`/`metadataPaths` 暂沿用旧 `describeNodeMetadata` 顶层 key 逻辑，留给 T016 泛化）；
  将 `compareNodeMetadataKeys` 泛化为 `compareNodeShapes`（分组/去重/multiset 骨架 `:262-291` 原样保留，
  单节点富诊断分支扩展为依次比较 kind/label/metadata 三 facet，每个不同 facet 各产出一条独立诊断行）；
  复合等价签名改为 `JSON.stringify([kindSignature, labelSignature, metadataSignature])`
  （plan「重复 id 场景的复合签名」裁决）；主入口 `compareGraphOnlyStructure`（`:371-372` 附近）调用点改调
  `compareNodeShapes`；删除不再使用的旧 `NodeMetadataShape`/`describeNodeMetadata`（内部保留为
  `compareNodeShapes` 调用的 metadata 子过程，函数体逻辑不变，仅调用关系变化）。
  **验收**：重跑 T006/T007/T008（缺席两条）/T009 全部转 **PASS**（粗断言层面）。
  **依赖**：T002, T003, T006, T007, T008, T009。

### 精确化断言（Route 1，FR-003/SC-001）

- [ ] **T011** [US1] 将 T006/T007 的粗断言细化为含**节点 id + 字段名（`kind`/`label`）+ 新旧值**的精确文案
  断言（FR-003 硬性要求，不得只报"节点不一致"）；补全 T008 空字符串对照用例的精确断言（区分
  `<absent>` 档 `'<absent>'` 与空字符串档 `'""'`）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 全量 PASS。
  **依赖**：T010。

**Checkpoint**：User Story 1（kind/label 检测）功能完整、可独立验收——SC-001 达成。

---

## Phase 4: User Story 2 — metadata 嵌套 key 改名可被护栏检出 (Priority: P2)

**目标**：metadata 内部对象字段的子 key 改名/增删（顶层 key 集合不变）必须被检出并精确定位到嵌套路径
（如 `lineRange.start`），F271 `lineRange` 同构模式下沉一层。

**Independent Test**：在临时副本 fixture 上单点变异某节点 `metadata.lineRange` 的内层 key，跑比较器，验证
`mismatch=true` 且诊断能定位到具体嵌套路径而非只报"metadata 不一致"；可独立于 US1/US3 单独验收。

### Tests for User Story 2（RED 先行）

- [ ] **T012** [US2] RED-粗断言：某节点 `metadata.lineRange` 由 `{start, end}` 改为 `{from, to}`
  （顶层 key 集合 `["lineRange", ...]` 不变），先写 mismatch=true 粗断言。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts -t "lineRange"` **FAIL**
  （现状顶层 key 集合比较看不到内层改名，`mismatch=false`，对照 `code-context.md §2`"盲区 2"）。
  **依赖**：T001。

- [ ] **T013** [US2] [P] RED-粗断言：从某节点 `metadata.lineRange` 内删除 `end` 子 key（顶层 key 集合不变），
  先写 mismatch=true 粗断言。
  **验收**：同上过滤，**FAIL**（现状 `mismatch=false`）。
  **依赖**：T001。

- [ ] **T014** [US2] [P] RED-粗断言（edge case b，空嵌套对象碰撞坑）：合成节点 `metadata = { lineRange: {} }`
  vs 对照节点 `metadata = {}`，断言两者 metadata 签名字符串**不相等**（当前实现下二者都产出"0 条路径"会
  碰撞成同一签名，应 FAIL）。
  **验收**：跑之 **FAIL**（现状签名碰撞：均为空 key 数组）。
  **依赖**：T001。

- [ ] **T015** [US2] [P] RED-粗断言（edge case c，分隔符歧义）：合成 `metadata = { 'a.b': 1 }` vs
  `metadata = { a: { b: 1 } }`，断言两者签名字符串**不相等**（不转义时两者展示字符串均为 `"a.b"`，
  会碰撞）。
  **验收**：跑之 **FAIL**（现状未转义，签名碰撞）。
  **依赖**：T001。

### Implementation for User Story 2

- [ ] **T016** [US2] IMPL：把 `describeNodeShape`（T010 产出）内 metadata facet 的签名生成从"顶层 key 数组"
  改为调用 T004 的 `collectMetadataKeyPaths`（只递归 plain object、数组按叶子、先记 key 自身路径）+
  `escapeMetadataPathSegment`（先转义 `\` 再转义 `.`）；`metadataSignature = JSON.stringify(sortedPaths)`，
  `metadataPaths` 字段存排序后的路径数组供富诊断消费。
  **验收**：重跑 T012/T013/T014/T015 全部转 **PASS**（粗断言层面）。
  **依赖**：T002, T004, T010, T012, T013, T014, T015。

### 精确化断言（Route 1，FR-005/SC-002）

- [ ] **T017** [US2] 将 T012/T013 的粗断言细化为含**节点 id + 递归 key 路径列表**的精确文案断言
  （FR-005 硬性要求）；T013 须额外断言"未变路径不出现在 missing 列表里"（如仍存在的 `lineRange`/
  `lineRange.start` 不应被误报为缺失，只报真正变化的 `lineRange.end`——"只报真正变化路径"负控）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 全量 PASS。
  **依赖**：T016。

### FR-013 既有精确断言迁移（plan「新发现」范围，三处非两处，不得漏第三处）

- [ ] **T018** [US2] FR-013 断言迁移三处：
  (a) `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:382`：原文案
  `metadata key 集合不一致（重建缺失 [lineRange] vs 重建新增 []）: ${id}` 先重跑确认**转 FAIL**
  （证明 T016 确实改变了可观察诊断格式，而非误配置）；随后更新为三路径新文案
  `metadata key 集合不一致（重建缺失 [lineRange, lineRange.end, lineRange.start] vs 重建新增 []）: ${id}`，
  重跑转 **PASS**。
  (b) `tests/integration/collector-fingerprint-regen-script.test.ts:342-344`：原文案
  `metadata key 集合不一致（重建缺失 [] vs 重建新增 [lineRange]）: ${victimId}` 先重跑确认**转 FAIL**；
  随后更新为
  `metadata key 集合不一致（重建缺失 [] vs 重建新增 [lineRange, lineRange.end, lineRange.start]）: ${victimId}`，
  重跑转 **PASS**。
  (c) `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:396`（`__mutantKey` 标量新增）
  **保持原文案不改动**——作为"标量新增不受递归影响"的负面对照，全程应保持 **PASS**（不 FAIL、不改动）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts tests/integration/collector-fingerprint-regen-script.test.ts`
  全量 PASS；对 (a)/(b) 须能提供"改前跑=FAIL、改后跑=PASS"的两次运行记录（不得只跑一次改后版本）；
  对 (c) 须确认改动 diff 中 `:396` 一行**未被触碰**（`git diff` 该行零变化）。
  **依赖**：T016, T017。

**Checkpoint**：User Story 2（metadata 递归路径检测）功能完整、可独立验收——SC-002 达成，FR-013 三处均妥善处置。

---

## Phase 5: User Story 3 — graph.graph 元数据字段清空/篡改可被护栏检出 (Priority: P3)

**目标**：`graph.graph`（`builder`/`fingerprint` 除外）及 `directed`/`multigraph` 字段的清空/篡改必须被检出
并精确定位到字段名+新旧值；`builder`/`fingerprint` 两个负面对照必须继续保持 `mismatch=false`（各自不同类别
的排除理由，见 plan「开放项 A 裁决」问题 1/FR-009）。

**Independent Test**：在临时副本 fixture 上单点清空/篡改 `graph.graph` 某字段（`builder`/`fingerprint` 除外）
或 `directed`/`multigraph`，跑比较器，验证 `mismatch=true` 且诊断指出具体字段名+新旧值；可独立于
US1/US2 单独验收。

### Tests for User Story 3（RED 先行）

- [ ] **T019** [US3] RED-粗断言：分别构造 `graph.graph.nodeCount`/`graph.graph.schemaVersion`/
  `graph.graph.sources` 清空或篡改的三个合成用例（一个字段一个用例），各自先写 mismatch=true 粗断言。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts -t "graph.graph"` **FAIL**
  （现状三者均 `mismatch=false`，对照 `code-context.md §2`"盲区 3"六项实测中的对应三项）。
  **依赖**：T001。

- [ ] **T020** [US3] [P] RED-粗断言：`directed`（`false→true`）与 `multigraph`（`false→true`）各一个合成用例，
  先写 mismatch=true 粗断言。
  **验收**：跑之 **FAIL**（现状均 `mismatch=false`）。
  **依赖**：T001。

### Implementation for User Story 3

- [ ] **T021** [US3] IMPL：新增私有函数 `compareGraphMetadata(rebuilt, pinned)`：
  比较字段集合 = `(rebuilt.graph.graph 的 key 并集 pinned.graph.graph 的 key) − GRAPH_GRAPH_EXCLUDED_FIELDS`
  （T005 常量）；标量字段（`nodeCount`/`edgeCount`/`schemaVersion`/`name`/`generatedAt`/`sourceCommit`）用
  `JSON.stringify(a) !== JSON.stringify(b)`（`undefined` 显示 `<absent>`，与既有缺席态惯例一致）；数组字段
  （`sources`/`skippedSources`）同样 `JSON.stringify` 整体比较、**顺序敏感**（沿用 `collectDeepDifferences`
  既定处理方式，plan 已排除"顺序无关"的 YAGNI 替代方案）；`directed`/`multigraph` 是 `GraphJSON` 顶层字段，
  **单独两行比较**，不进 denylist 迭代。接入 `compareGraphOnlyStructure` 主入口，diff 文案含具体字段名+
  新旧值。
  **验收**：重跑 T019/T020 全部转 **PASS**（粗断言层面）。
  **依赖**：T005, T019, T020。

### 精确化断言（Route 1，FR-008/SC-003）

- [ ] **T022** [US3] 将 T019/T020 的粗断言细化为含**字段名 + 新旧值**的精确文案断言（FR-008 硬性要求）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 全量 PASS。
  **依赖**：T021。

### 负面对照（非红先行，必须保持 GREEN；对应开放项 A 裁决与 FR-009）

- [ ] **T023** [US3] `builder` 负面对照（SC-004/FR-009）：只改 `graph.graph.builder`（其余字段不变），验证
  `compareGraphOnlyStructure` 单独调用 `mismatch=false`——**必须保持 GREEN**，不是红先行任务。
  **验收**：跑该用例，实现前后（T021 前后均）应 `mismatch=false`，0 例误报。
  **依赖**：T021（在实现完成后确认该负控依然成立，防止 denylist 迭代逻辑意外覆盖到 `builder`）。

- [ ] **T024** [US3] `fingerprint` 负面对照（新增，钉死开放项 A 问题 1 裁决，防止未来被误当 bug 重新加回）：
  (a) 只改 `graph.graph.fingerprint`（如单独改一个不同的 `behaviorVersion` 数值），验证
  `compareGraphOnlyStructure` **单独调用**时 `mismatch=false`（结构性不再看 fingerprint 字段）；
  (b) 补一条**集成级测试**：验证当 `runRegen` 的 `fingerprintUnchanged=false`（因为指纹确实变了）时，
  `shouldRejectRegen` 依然正确判 `false`（放行分支），行为与改动前完全一致——防止"排除 fingerprint 字段"
  这个决策被未来误当 bug 修复重新加回。
  **验收**：(a) 单元测试 PASS，`mismatch=false`；(b) 集成测试 PASS，`shouldRejectRegen` 返回值与改动前
  基线一致（可用 `git stash` 临时回退到改动前版本跑一次同用例对照，或在 commit message 中记录改动前
  该场景的既有行为出处作为参照）。
  **依赖**：T021。

**Checkpoint**：User Story 3（graph.graph/directed/multigraph 检测 + builder/fingerprint 负控）功能完整、
可独立验收——SC-003/SC-004 达成。

---

## Phase 6: Polish & Cross-Cutting Concerns

**目的**：跨三个 User Story 的回归确认、活性证明（FR-014）、文档同步、异构对抗审查、全量收尾验证。

- [ ] **T025** 顺序不敏感回归（FR-011，跨 US1/US2/US3）：重跑既有"仅节点/边顺序反转"用例
  （`collector-fingerprint-guardrail.test.ts:344-350` 附近，事实清单 §2「顺序敏感性对照（应 GREEN）」）
  确认仍 PASS、`mismatch=false`；确认新增 kind/label/graph.graph 三个维度均未引入顺序敏感性
  （逻辑上按 node id / 固定字段名索引，不依赖数组下标，跑既有用例即为回归验证，不需新增用例）。
  **验收**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts -t "顺序"`
  （或按实际 `it()` 名过滤）PASS。
  **依赖**：T010, T016, T021（全部三个 User Story 实现完成后）。

- [ ] **T026** 活性证明（FR-014，独立任务，不得省略）：
  命令：`npm run fixtures:regen:collector-fingerprint`（**真实 fixture 目录**，**无** `--fixture-root`、
  **无** `--init`）。
  期望：stdout 含"无需更新"（未写盘）字样，进程 **exit code 0**。
  **强制后置校验**：
  ```
  git diff --exit-code \
    tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json \
    tests/fixtures/collector-fingerprint-guardrail/expected-module-graph.json
  ```
  必须**零差异**（exit 0、无输出）——防止再生脚本意外写盘、违反 FR-016。
  **判红时禁止清单**：禁用 `--init` 冷启动重建资产绕过；禁 bump `BEHAVIOR_VERSION`。若判红，按
  plan「风险登记表 (a)」处置：先排查是否只含一条 `graph.graph.sourceCommit 不一致`（命中风险登记 (d)，
  用 `git -C "$(node -e 'console.log(require("os").tmpdir())')" rev-parse --show-toplevel` 自查，若成功输出
  仓库路径则是环境问题、调整 `TMPDIR` 配置而非改代码）；否则视为实现 bug，回头复核 T014/T015/T019/T020
  等合成用例是否已暴露该 bug 的更小复现，禁止跳过诊断直接用 `--init`/bump 让红变绿。
  **依赖**：T010, T016, T021（全部实现完成后）。

- [ ] **T027** [P] 文档同步（plan 风险 (c) 第 2 条，非阻塞质量项，不在 FR-016 保护范围内）：
  更新 `tests/fixtures/collector-fingerprint-guardrail/README.md`（约 `:92-96` 一节）措辞，
  由"只比 key 名（不比 value）"改为"递归 key 路径集合（不比 value）"，与实现口径同步。
  **验收**：`grep -n "递归" tests/fixtures/collector-fingerprint-guardrail/README.md` 有命中；
  `git status --short tests/fixtures/collector-fingerprint-guardrail/` 只显示 `README.md` 一个文件变更
  （两份 `expected-*.json` 零改动）。
  **依赖**：无强依赖，可与 T025/T026 并行（不同文件）。

- [ ] **T028** 异构对抗审查（守护类改动强制要求，`CLAUDE.local.md` 顶部「Codex 对抗审查暂停」节 +
  项目主线焦点"裁决不变量"）：启动 **≥2 个不同切入角**的独立子代理（非同构复用同一 prompt），对本次
  改动做证伪式审查：
  - **切入角①「fail-open / 漏检面」**：审查新增三维度是否存在"看起来在比、实际比不到"的通道——例如
    `GRAPH_GRAPH_EXCLUDED_FIELDS` denylist 迭代是否遗漏某字段导致误比较或漏比较、
    `collectMetadataKeyPaths` 递归终止条件是否有绕过路径（如原型链污染、`Object.keys` 遗漏
    non-enumerable key）、复合签名 `JSON.stringify([kindSignature, labelSignature, metadataSignature])`
    是否存在两个真实不同的三元组序列化成同一字符串的碰撞（如 signature 内部含未转义的分隔符）。
  - **切入角②「绕过构造面」**：尝试构造两份**语义不同**（kind/label/metadata 嵌套/graph.graph 任一维度
    真实不同）但**新签名相同**的合成 `GraphJSON` 对，验证能否骗过 `compareGraphOnlyStructure` 判
    `mismatch=false`。
  **处置**：真实 bug/设计缺陷/边界遗漏 → 立即修复，回到对应 US 阶段重跑该维度的全部红先行/精确化/负控
  用例；风格偏好/过度抽象建议 → 记录在 commit message 备注，不阻塞交付。
  **commit message 必须显式标注**：「Codex 审查暂停，异构档位缺席」（配额恢复后可回补 Codex 审查）。
  **依赖**：T010, T016, T021, T023, T024（全部实现 + 负控完成后，异构对抗才有完整改动面可审）。

- [ ] **T029** 收尾全量验证（SC-006 + 项目仓库级门禁 + 编排器补充类型检查）：
  1. `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts tests/integration/collector-fingerprint-regen-script.test.ts` — 零失败
  2. `npx vitest run`（全量）— 零失败，确认无跨文件回归
  3. `npm run test:plugins` — 零失败
  4. `npm run build` — 零错误
  5. `npm run repo:check` — 零错误
  6. `npm run release:check` — 零错误
  7. **针对性类型检查（编排器补充，非仓库既有门禁）**：`tsconfig.json` 的 `include` 仅 `["src/**/*.ts"]`
     且 `exclude` 含 `"tests"`；编排器已实测
     `npx tsc --noEmit --listFilesOnly | grep -c 'scripts/regen-collector-fingerprint-fixtures.ts'` = **0**、
     `grep -c 'tests/unit/guardrail/collector-fingerprint-guardrail.test.ts'` = **0**——即 `npm run build`
     对本卡改动的 `scripts/regen-collector-fingerprint-fixtures.ts` 与两个测试文件**结构性零覆盖**；
     `typecheck:tests` 也只覆盖 `tests/type-tests/` 下 3 个手挑文件，同样覆盖不到。因此须额外补跑一次
     ad-hoc 类型检查：
     ```
     npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler \
       scripts/regen-collector-fingerprint-fixtures.ts \
       tests/unit/guardrail/collector-fingerprint-guardrail.test.ts \
       tests/integration/collector-fingerprint-regen-script.test.ts
     ```
     期望零错误。**MUST NOT** 为此新增 npm script、**MUST NOT** 修改 `tsconfig.json`
     （超出本卡范围）；在 commit message 中如实说明这是本次 tasks 编排补充的一次性验证步骤，
     不是仓库既有门禁的一部分。
  **验收**：以上 7 项全部通过。
  **依赖**：T025, T026, T027, T028（全部实现、活性证明、文档同步、异构对抗审查完成后才做最终收尾验证）。

**Checkpoint**：全部三个 User Story 独立可用，FR-001~FR-017 全覆盖，SC-001~SC-006 全达成。

---

## FR 覆盖映射表

| FR | 内容摘要 | 对应任务 |
|---|---|---|
| FR-001 | 检测 `node.kind` 差异 | T006, T010, T011 |
| FR-002 | 检测 `node.label` 差异 | T007, T010, T011 |
| FR-003 | kind/label 报红须定位节点 id + 字段名 | T011 |
| FR-004 | metadata 嵌套 key 递归检测（plain object 递归、数组按叶子） | T012, T013, T016 |
| FR-005 | metadata 报红须定位节点 id + 递归 key 路径 | T017 |
| FR-006 | metadata 比较范围仍是"只比 key 不比 value" | T016（沿用 `describeNodeMetadata` 设计意图，未引入 value 比较） |
| FR-007 | 检测 `graph.graph`（非 builder/fingerprint）+ `directed`/`multigraph` 差异 | T019, T020, T021 |
| FR-008 | graph.graph 报红须定位字段名 + 新旧值 | T022 |
| FR-009 | `graph.builder` 显式排除且给出理由 | T005, T023 |
| FR-010 | 排除面不得覆盖随采集行为变化的字段 | T005（denylist 仅 `builder`/`fingerprint`，注释登记纪律），T021 |
| FR-011 | 新维度不引入顺序敏感性 | T025 |
| FR-012 | 既有扰动用例检测力不回退 | T025, T029（全量回归） |
| FR-013 | 既有精确断言迁移（三处，含新发现第三处） | T018 |
| FR-014 | 新维度在当前 pinned 基线上判一致，禁 `--init`/bump 绕过 | T026 |
| FR-015 | 复用 F278 诊断基础设施模式（SHOULD） | T002, T003, T010（泛化而非新增平行实现） |
| FR-016 | 禁止修改两份 pinned 资产 | T026（强制后置校验）, 全程约束 |
| FR-017 | 禁止修改 `BEHAVIOR_VERSION` | T026（禁止清单） |

**Success Criteria 覆盖**：SC-001→T006/T007/T008/T011；SC-002→T012/T013/T017；SC-003→T019/T020/T022；
SC-004→T023；SC-005→T025/T026；SC-006→T029。

---

## Dependencies & Execution Order

### Phase 依赖

- **Setup（Phase 1）**：无前置依赖，立即开始。
- **Foundational（Phase 2）**：依赖 Setup 完成；T002-T005 之间 `[P]` 标注的可并行（均为纯新增、未接线的
  独立符号，互不冲突）；**阻塞** US1 实现任务 T010 与 US2 实现任务 T016（二者共享同一泛化骨架）。
- **User Stories（Phase 3-5）**：RED 测试任务（T006-T009、T012-T015、T019-T020）不依赖 Foundational，
  可与 Phase 2 并行编写（只要求现状 FAIL，不需要骨架符号存在）；IMPL 任务（T010、T016、T021）依赖
  Foundational 对应符号就绪。US3（T019-T024）只依赖 T005，**不依赖** T010/T016，可与 US1/US2 完全并行。
- **Polish（Phase 6）**：T025/T026/T028/T029 依赖全部三个 User Story 的 IMPL 任务完成；T027 无强依赖，
  随时可做。

### User Story 间依赖

- **US1（P1）**：Foundational 完成后可独立实现、独立验收（T006-T011），不依赖 US2/US3。
- **US2（P2）**：**实现层面依赖 US1 的 T010**（`describeNodeShape`/`groupNodeShapes`/`compareNodeShapes`
  骨架由 T010 建立，T016 在其上扩展 metadata facet）——这是 plan「架构裁决」明确要求的"泛化而非平行新增"
  的必然结果，US2 无法在 US1 的 T010 之前完成 IMPL（但 US2 的 RED 测试 T012-T015 可以先行编写）。
  FR-013 迁移（T018）额外依赖 T016/T017。
- **US3（P3）**：**独立于 US1/US2**（`compareGraphMetadata` 是与 `compareNodeShapes` 平级的新函数，仅共享
  T005 一个常量），可与 US1/US2 完全并行实现、独立验收。

### Story 内部并行机会

- US1：T007/T008 可与 T006 并行编写（不同断言片段，未接线前互不干扰）；T009 独立编写。
- US2：T013/T014/T015 可与 T012 并行编写。
- US3：T020 可与 T019 并行编写。

### 推荐实现策略

**MVP First**：完成 Phase 1 + Phase 2 + Phase 3（US1）即可交付一个独立可验收的增量（kind/label 检测，
对应历史真实误读场景 F250，风险最高、收益最直接）。

**Incremental Delivery**（推荐，与 plan 的"红先行顺序"步骤编号一一对应）：
Setup → Foundational → US1（含 T006-T011，对应 plan 红先行步骤 1-3）→ US2（含 T012-T018，对应步骤 4-8）
→ US3（含 T019-T024，对应步骤 9-11，可与 US1/US2 并行插入）→ 顺序回归（T025，对应步骤 12）→
活性证明（T026，对应步骤 14）→ 文档同步（T027）→ 异构对抗审查（T028）→ 全量收尾验证（T029，对应步骤 15）。
重复 id 复合签名用例（plan 步骤 13）已并入 US1 的 T009/T011。

**Parallel Team Strategy**：Foundational 完成后，US1 与 US3 可由不同执行者并行推进（互不共享代码落点）；
US2 因实现层面依赖 US1 的 T010，须在 US1 的 T010 落地后才能开始其 IMPL（T016），但 US2 的全部 RED 测试
（T012-T015）可提前与 US1 并行编写。

---

## Notes

- `[P]` 任务 = 不同文件或同文件内不同、互不冲突的断言片段，且无实现依赖。
- `[US1/US2/US3]` 标签用于可追溯性，映射任务到对应用户故事；Setup/Foundational/Polish 阶段任务不加标签。
- **红先行纪律逐条落实**：T006/T007/T008/T009/T012/T013/T014/T015/T019/T020 均为"粗断言先 FAIL"任务，
  T010/T016/T021 为对应实现任务，T011/T017/T022 为对应精确化断言任务——三段严格按此顺序执行，不合并。
- 提交前必须完成 T028（异构对抗审查）与 T029（全量收尾验证），且 T028 须先于 T029（对抗发现的问题
  需要在收尾验证前修完重验）。
- 避免：模糊任务描述、同文件冲突写入、破坏 Story 独立性的跨故事强依赖（US3 与 US1/US2 已确认无此问题；
  US2 对 US1 的实现层依赖已在上方显式记录，不视为架构缺陷，而是 plan 明确裁决的复用策略的必然结果）。
