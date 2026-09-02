
# Feature Specification: a-track 护栏比较器检测面拓宽（node.kind/label + metadata 嵌套 key + graph.graph 元数据）

**Feature Branch**: `claude/suspicious-mclean-fe715f`
**Created**: 2026-09-02
**Status**: Draft
**Input**: User description: 拓宽 `compareGraphOnlyStructure`（a-track 护栏比较器）的检测面，补上三族当前零检测力的盲区——`node.kind`/`node.label`、metadata 嵌套 key 改名、`graph.graph` 元数据字段。

## 背景与证据基座

本 spec 的每条 FR 均携带 `specs/279-guardrail-detection-widening/code-context.md`（下称"事实清单"）中的证据锚，未在事实清单中证实的内容不写入。

**当前状态**（事实清单 §1）：`compareGraphOnlyStructure`（`scripts/regen-collector-fingerprint-fixtures.ts:337-375`）只有三个比较维度：节点 id multiset、边 multiset、节点 metadata **顶层** key 集合。`GraphNode` 的完整字段集为 `{id, kind, label, metadata}`（`src/panoramic/graph/graph-types.ts:55-65`），其中 `kind`/`label` 全文件搜索零命中，比较器结构性看不见。

**立项证据**（事实清单 §2）：对 pinned 基线 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`（22 节点/14 边）做单点变异实测，三族盲区全部 `diffs=0`（零检测力），同批对照组（新增顶层 metadata key / 删边 / 改 id）全部正确报红，证明探针本身有效、盲区确凿存在。

**历史实证**（事实清单 §3）：盲区 1（`node.label`）在 `specs/250-pyi-symbol-surface/trace.md:133` 已真实发生过一次误读——改了 `label` 却把该比较器的 `contentMismatch=false` 当作"节点结构零变化"的独立佐证引用。

**活性前置证明**（事实清单 §6）：对当前 pinned 基线实跑三族新维度候选签名，`graph.graph` 逐字段 10/10 全同、node kind/label 差异数 0/22、metadata 递归 key 路径差异数 0——三族新维度在当前资产上天然一致，不存在"实现完必然判红需回填资产"的隐患。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - node.kind / node.label 改动可被护栏检出 (Priority: P1)

作为对 a-track 护栏有依赖的开发者/审查者，当某次改动使某个节点的 `kind`（如 F260 那类 symbol 重分类：`component`→`module`）或 `label`（如改名展示文案）发生变化，但节点 id、边、metadata 顶层 key 均未变时，护栏必须报红并指出具体是哪个节点的 `kind` 或 `label` 变了。

**Why this priority**: 三族盲区中风险最高——事实清单 §3 证实该盲区已在 F250 真实场景中被误读过一次（把"零检测"误当"零变化"的独立佐证），属于已发生过的错误结论来源，而非假想风险。

**Independent Test**: 在临时副本 fixture 上单点变异首个节点的 `kind`（或 `label`），跑 `compareGraphOnlyStructure`，验证 `diffs > 0` 且诊断文案定位到该节点 id 与变化字段。可独立于盲区 2/3 单独实现、单独验收。

**Acceptance Scenarios**:

1. **Given** pinned 基线的重建产物与期望产物逐字节相同，**When** 仅将重建产物中某一节点的 `kind` 由 `component` 改为 `module`（其余字段不变），**Then** 比较器报 `diffs ≥ 1`，诊断信息包含该节点 id 与 `kind` 字段名及新旧值。
2. **Given** pinned 基线的重建产物与期望产物逐字节相同，**When** 仅将重建产物中某一节点的 `label` 改名（其余字段不变），**Then** 比较器报 `diffs ≥ 1`，诊断信息包含该节点 id 与 `label` 字段名及新旧值。
3. **Given** 当前 pinned 基线未做任何变异，**When** 跑新签名的比较，**Then** `diffs = 0`（对应事实清单 §6 的活性证明：kind/label 差异数 0/22）。

---

### User Story 2 - metadata 嵌套 key 改名可被护栏检出 (Priority: P2)

作为依赖护栏检测 metadata 结构漂移的开发者，当某次改动使 metadata 内部某个对象字段的子 key 改名（如 `lineRange.start`/`lineRange.end` 改为 `lineRange.from`/`lineRange.to`），但 metadata **顶层** key 集合不变时，护栏必须报红并指出是哪个节点、哪条嵌套路径发生了变化。

**Why this priority**: 与 F271 原始病同构、只是下沉一层，属已知模式的变体而非全新风险类别，故置于盲区 1 之后；但仍是实测证实的零检测力盲区（事实清单 §2：`metadata.lineRange {start,end}→{from,to}` 与"内层删 end"两个变异点均 `diffs=0`）。

**Independent Test**: 在临时副本 fixture 上单点变异某节点 `metadata.lineRange` 的内层 key（改名或删除一个子 key，保持顶层 key 集合不变），跑比较器，验证 `diffs > 0` 且诊断能定位到具体的嵌套路径（如 `lineRange.start`），而非只报"metadata 不一致"。

**Acceptance Scenarios**:

1. **Given** 重建产物与期望产物逐字节相同，**When** 仅将某节点 `metadata.lineRange` 由 `{start, end}` 改为 `{from, to}`（顶层 key 集合 `["lineRange", ...]` 不变），**Then** 比较器报 `diffs ≥ 1`，诊断信息指出该节点 id 及 `lineRange.start`/`lineRange.end` 层级的差异，而不是仅报顶层 `lineRange` 一致。
2. **Given** 重建产物与期望产物逐字节相同，**When** 仅从某节点 `metadata.lineRange` 内删除 `end` 子 key（顶层 key 集合不变），**Then** 比较器报 `diffs ≥ 1`，诊断信息指出 `lineRange.end` 缺失。
3. **Given** 当前 pinned 基线未做任何变异，**When** 跑新签名的比较，**Then** `diffs = 0`（对应事实清单 §6 的活性证明：metadata 递归路径差异数 0）。

---

### User Story 3 - graph.graph 元数据字段清空/篡改可被护栏检出 (Priority: P3)

作为依赖护栏检测整图元数据漂移的开发者，当 `graph.graph`（`nodeCount`/`edgeCount`/`sources`/`skippedSources`/`schemaVersion` 等，`builder` 除外）或重建侧的 `directed`/`multigraph` 字段被清空或篡改，而节点/边/metadata 均未变时，护栏必须报红并指出是哪个字段发生了变化。

**Why this priority**: 三族中风险相对最低（事实清单未记录该盲区曾在历史事故中被误读，仅为实测证实的零检测力盲区），但仍是确凿存在的检测空洞（事实清单 §2：清空整个 `graph.graph`、`nodeCount`/`schemaVersion`/`sources` 篡改、`directed`/`multigraph` 翻转均 `diffs=0`）。

**Independent Test**: 在临时副本 fixture 上单点清空或篡改 `graph.graph` 中某一字段（`builder` 除外）或 `directed`/`multigraph`，跑比较器，验证 `diffs > 0` 且诊断指出具体字段名与新旧值。

**Acceptance Scenarios**:

1. **Given** 重建产物与期望产物逐字节相同，**When** 仅将 `graph.graph.nodeCount` 由实际值改为一个错误值（其余字段不变），**Then** 比较器报 `diffs ≥ 1`，诊断信息包含字段名 `graph.graph.nodeCount` 及新旧值。
2. **Given** 重建产物与期望产物逐字节相同，**When** 仅将 `directed` 由 `false` 翻转为 `true`（其余字段不变），**Then** 比较器报 `diffs ≥ 1`，诊断信息包含字段名 `directed` 及新旧值。
3. **Given** 重建产物与期望产物逐字节相同，**When** 仅将 `graph.graph.builder` 字段改变（其余字段不变），**Then** 比较器 `diffs = 0`（`builder` 必须继续排除，见 FR-010）。
4. **Given** 当前 pinned 基线未做任何变异，**When** 跑新签名的比较，**Then** `graph.graph` 逐字段一致、`directed`/`multigraph` 一致（对应事实清单 §6 活性证明：10/10 全同）。

---

### Edge Cases

- **节点/边顺序反转**：仅反转 `nodes[]`/`links[]` 数组顺序（值不变）时，护栏必须仍判一致（`diffs = 0`），不得因新签名引入顺序敏感性。对应事实清单 §2「顺序敏感性对照（应 GREEN）」；此为 FR-011 的验收条件，不是新增能力。
- **metadata 值不是 plain object 的情况**（如 `metadata` 本身缺失、为非对象、或某个子字段值为数组/基础类型）：递归 key 路径提取必须能安全处理，不得抛异常导致比较器崩溃；数组类型的值按叶子处理，不展开下标（见 FR-004 的递归规则）。
- **`kind`/`label` 缺失或为 `undefined`**：极端情况下节点对象可能缺失 `kind` 或 `label` 字段，比较逻辑需将"缺失"与"存在但为空字符串"视为不同状态并报红，不得静默跳过。
- **重复节点 id 的场景与 kind/label 比较的交互**：既有护栏对重复 id 走 multiset 分支（事实清单 §1 `compareNodeMetadataKeys` `:288-301`）；新增的 kind/label 比较维度在重复 id 场景下的分支归属由 plan 阶段裁决，spec 仅要求"不得降低既有重复 id 检测力"（见 FR-007）。
- **既有精确断言文案漂移**（`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:382,396`）：metadata 签名从"顶层 key 列表"改为"递归 key 路径列表"后，删除整个 `lineRange` 子树的变异会同时缺失 `lineRange`/`lineRange.start`/`lineRange.end` 三条路径，导致这两条断言的诊断文案变化。这是一个需要 plan 阶段显式裁决的开放项（见 FR-013），spec 阶段不预设"改断言"或"只报最浅差异路径"中的任何一种解法。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**（`[必须]`）：护栏比较器 MUST 检测 `node.kind` 字段在期望产物与重建产物之间的差异（对应用户故事 1）。证据锚：事实清单 §2「盲区 1：node.kind」三项实测均 `diffs=0`；§3 历史误读记录。
- **FR-002**（`[必须]`）：护栏比较器 MUST 检测 `node.label` 字段在期望产物与重建产物之间的差异（对应用户故事 1）。证据锚：事实清单 §2「盲区 1：node.label」实测 `diffs=0`；§3 历史误读记录（`label mod.pyi→mod`）。
- **FR-003**（`[必须]`）：FR-001/FR-002 的报红诊断 MUST 指出具体的节点 id 与发生差异的字段名（`kind` 或 `label`），不得只报"节点不一致"这类无法定位的笼统文案。证据锚：需求描述"§5 诊断文案质量"要求；事实清单 §1 `describeNodeMetadata`/`groupNodeMetadataShapes` 已提供按 id 分组诊断的先例可参照。
- **FR-004**（`[必须]`）：护栏比较器 MUST 检测 metadata 内部嵌套对象字段的子 key 改名或增删（即使顶层 key 集合不变），签名生成规则为：只递归 plain object（`{}` 字面量结构），数组类型的值一律按叶子处理，不产生下标敏感的路径（例如 `tags: ["a","b"]` 不展开为 `tags.0`/`tags.1`）。对应用户故事 2。证据锚：事实清单 §2「盲区 2」两项实测均 `diffs=0`；需求描述"递归规则要先定死"的显式要求。
- **FR-005**（`[必须]`）：FR-004 的报红诊断 MUST 指出具体的节点 id 与发生差异的递归 key 路径（如 `lineRange.start`），不得只报"metadata 不一致"。证据锚：事实清单 §6 已实证递归路径样本可行（`lineRange.end`/`lineRange.start` 等）；需求描述"§5 诊断文案质量"要求。
- **FR-006**（`[必须]`）：FR-004 的 metadata 比较范围 MUST 保持"只比 key 名（含嵌套路径）不比 value"的既有设计意图（F278 FR-008 的延伸，不违反），即两侧只要在同一路径下都存在该 key，即视为该路径一致，不比较该路径叶子的具体值。证据锚：需求描述"仍属只比 key 名不比 value，不违反 F278 FR-008 的设计意图"的显式约束。
- **FR-007**（`[必须]`）：护栏比较器 MUST 检测 `graph.graph` 中随采集行为变化的字段（至少含 `nodeCount`/`edgeCount`/`sources`/`skippedSources`/`schemaVersion`）以及重建侧的 `directed`/`multigraph` 字段的差异（对应用户故事 3）。证据锚：事实清单 §2「盲区 3」六项实测均 `diffs=0`；事实清单 §5 引用 `compareGraphDeep` 文件头注释已点名"这恰恰是 pinned 资产陈旧的核心信号"。
- **FR-008**（`[必须]`）：FR-007 的报红诊断 MUST 指出具体的字段名与新旧值，不得只报"graph.graph 不一致"。证据锚：需求描述"§5 诊断文案质量"要求。
- **FR-009**（`[必须]`）：`graph.builder` 字段 MUST 从 FR-007 的比较范围中显式排除，理由记录在 spec 中：`builder` 跟踪宿主仓库/dist 构建戳（`commit`/`dirty`/`distSha256` 等），跨机器/跨 commit 必然不同，与"这份 pinned 是否代表当前采集行为"无关（F261 D1「builder 戳只可见不判定」）；本 fixture 再生路径下 `builder` 恒为 `null`（诚实降级），比较该字段会引入与采集行为无关的噪声。证据锚：事实清单 §4.1/§4.2；事实清单 §5 引用 `compareGraphDeep` 的 `DEEP_COMPARE_EXCLUDED_PATHS` 唯一排除项即为 `graph.builder`（同族先例）。
- **FR-010**（`[必须]`）：任何从 FR-007 比较范围排除的 `graph.graph` 子字段（除 `graph.builder` 外，若 plan 阶段决定新增排除项）MUST 逐条给出理由，且不得排除任何"随采集行为变化"的字段（例如 `nodeCount`/`edgeCount`/`schemaVersion`/`sources`/`skippedSources` 不得被排除，因为它们直接反映采集结果而非宿主机器身份）。证据锚：需求描述"§4 盲区 3 的排除面"显式约束。
- **FR-011**（`[必须]`）：新增的三族检测维度（FR-001/002/004/007）MUST 不引入节点或边的顺序敏感性——仅反转 `nodes[]`/`links[]` 数组顺序而不改变任何字段值时，比较器仍须判一致（`diffs = 0`）。证据锚：事实清单 §2「顺序敏感性对照（应 GREEN）」已验证既有维度的语义；需求描述"§3 不回退不变量"要求"乱序判一致"必须单列验证。
- **FR-012**（`[必须]`）：既有扰动用例的检测力 MUST 不回退，包括但不限于：删边、改节点 id、重复节点、重复边、F278 引入的 metadata 顶层 key 集合比较（M1-M3 + A1-A7 全部场景）。证据锚：事实清单 §2 对照组三条（新增顶层 metadata key / 删边 / 改 id）全部正确报红，作为回归基线；需求描述"§3 不回退不变量"显式列出的场景清单。
- **FR-013**（`[必须]`）：`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:382` 与 `:396` 两条既有精确文案断言，在 metadata 签名改为递归 key 路径后可能因诊断文案变化而失败，此为已知影响面，MUST 在 plan 阶段显式裁决处置方式（改断言 vs 让诊断只报最浅差异路径），spec 阶段不预设结论、不得静默假设"可以直接改断言"。证据锚：事实清单 §8 逐字标注两条断言的锚点与断言文本。
- **FR-014**（`[必须]`）：三族新增检测维度 MUST 在当前 pinned 基线（`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`，22 节点/14 边）上判一致（`diffs = 0`）。若判红，MUST 停下先判定是"真漂移"还是"资产陈旧"，`NOT be resolved` 通过 `--init` 重新生成资产或 bump `BEHAVIOR_VERSION` 使其变绿。证据锚：事实清单 §6「活性前置探针」已实测三族新维度在当前基线上天然一致（graph.graph 10/10 全同、kind/label 差异数 0/22、metadata 递归路径差异数 0）；事实清单 §9 判定不变量第 1/2/3 条。
- **FR-015**（`[可选]`）：比较器改动 SHOULD 复用 F278 已建立的诊断基础设施模式（按节点 id 分组、`describeNodeMetadata` 式的分档签名描述），以保持诊断输出风格一致，但具体函数命名/结构由 plan 阶段决定，spec 不作规定。证据锚：事实清单 §1 已证实 `describeNodeMetadata`/`groupNodeMetadataShapes` 存在且可复用；需求描述"建议实现方向"段落（非强制，标 SHOULD）。
- **FR-016**（`[必须]`）：本次改动 MUST NOT 修改 `tests/fixtures/collector-fingerprint-guardrail/` 下的两份 pinned 资产文件（`expected-graph-only-graph.json`/`expected-module-graph.json`）。证据锚：事实清单 §9 判定不变量第 1 条。
- **FR-017**（`[必须]`）：本次改动 MUST NOT 修改 `src/panoramic/graph/collector-fingerprint.ts` 中的 `BEHAVIOR_VERSION`。证据锚：事实清单 §9 判定不变量第 3 条——六类 bump responsibility 不覆盖节点字段集合，本次改动属于护栏检测面拓宽而非采集面变化。

### Key Entities

- **GraphNode**：图节点，完整字段集为 `{id, kind, label, metadata}`（`src/panoramic/graph/graph-types.ts:55-65`）。本次改动新增比较 `kind`/`label` 两个字段，`metadata` 从"顶层 key 集合"拓宽为"递归 key 路径集合"。
- **GraphMetadata（graph.graph）**：整图级元数据，含 `nodeCount`/`edgeCount`/`sources`/`skippedSources`/`schemaVersion`/`builder` 等字段；重建侧另有 `directed`/`multigraph` 两个平级字段。本次改动新增比较除 `builder` 外的随采集行为变化字段。
- **NodeMetadataShape**（既有实体，事实清单 §1）：节点 metadata 的签名描述结构，本次改动将其签名生成规则从"顶层 key 数组"拓宽为"递归 key 路径数组"，具体扩展方式由 plan 阶段决定。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：对 `node.kind` 或 `node.label` 做单点变异后，比较器在 100% 的测试用例中报 `diffs ≥ 1`，且诊断文案包含节点 id 与字段名。
- **SC-002**：对 metadata 嵌套 key 做单点变异（改名/删除子 key，顶层 key 集合不变）后，比较器在 100% 的测试用例中报 `diffs ≥ 1`，且诊断文案包含节点 id 与递归 key 路径。
- **SC-003**：对 `graph.graph`（`builder` 除外）或 `directed`/`multigraph` 做单点变异后，比较器在 100% 的测试用例中报 `diffs ≥ 1`，且诊断文案包含字段名。
- **SC-004**：`graph.builder` 单独变异时，比较器判一致（`diffs = 0`），0 例误报。
- **SC-005**：当前 pinned 基线（22 节点/14 边）在新签名下判一致（`diffs = 0`），且既有扰动用例（删边/改 id/重复节点/重复边/F278 M1-M3+A1-A7）检测力 100% 保留、乱序判一致 100% 成立。
- **SC-006**（实现后按实测修订口径）：相关单测（`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`、`tests/integration/collector-fingerprint-regen-script.test.ts`）全部通过，其中文案漂移相关的既有断言按 FR-013 裁决后的方案落地，不遗留失败用例；`npm run lint` 与 `npm run build` 零错误。
  ⚠️ **`lint`/`build` 这两条对本卡是结构性空网，不构成类型正确性证据**：`tsconfig.json` 的 `include` 仅 `["src/**/*.ts"]`、`exclude` 含 `"tests"`，实测 `npx tsc --noEmit --listFilesOnly` 对本卡三个改动文件的命中数均为 **0**；`npm run typecheck:tests` 也只覆盖 `tests/type-tests/` 下 3 个手挑文件。因此本卡的类型正确性由一次**一次性 ad-hoc `tsc --noEmit`**（与生产 tsconfig 同档 strict，显式 include 三个改动文件）提供，结果 0 error——该检查**非仓库常设门禁**，覆盖范围仅本次改动。把 SC-006 写成"lint/build 零错误 ⇒ 类型正确"是 over-claim。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：3（节点 kind/label 比较维度、metadata 递归 key 路径签名生成器、graph.graph/directed/multigraph 比较维度）——均为对既有单一比较器 `compareGraphOnlyStructure` 的内部维度扩展，不新增独立模块文件。
- **接口数量**：预计 3-4 处（新增/修改的比较子函数或签名生成函数，具体数量由 plan 阶段裁决）。
- **依赖新引入数**：0（复用 F278 已有基础设施，事实清单 §1）。
- **跨模块耦合**：否（改动集中在 `scripts/regen-collector-fingerprint-fixtures.ts` 一个源文件 + 其对应测试文件，事实清单 §7 显示 `graph-quality-pinned-staleness.test.ts` 已用自有比较器不受影响）。
- **复杂度信号**：存在 1 个——metadata 嵌套 key 的**递归结构**遍历（FR-004 要求递归 plain object、数组按叶子处理）。无状态机、无并发控制、无数据迁移。
- **总体复杂度**：**LOW-MEDIUM**（组件 3、接口 3-4、无新依赖、单模块内聚，但存在 1 个递归结构复杂度信号）——按判定规则（组件 3-5 或接口 4-8 或 1 个复杂度信号 → MEDIUM）落在 **MEDIUM** 区间下沿，建议 GATE_DESIGN 常规审查即可，无需额外人工升级。

## 范围边界

### Out of Scope

- **metadata 值级比较**：本次改动继续沿用 F278 FR-008"只比 key 名（含本次拓宽的嵌套路径）不比 value"的设计，不引入 value 级 diff。
- **FR-011「顺序不敏感」的适用范围**（实现后显式裁定，避免被误读为全局不变量）：FR-011 的正文逐字限定为"仅反转 `nodes[]`/`links[]` 数组顺序"。而第四维度对 `sources`/`skippedSources` 采用 `JSON.stringify` **整体顺序敏感**比较——这是本卡**新增**的顺序敏感行为，理由是这两个数组由生产者按固定构建顺序写入、非用户可重排输入（沿用 b-track `collectDeepDifferences`「顺序即语义」的既定处理）。按 spec 字面不构成 FR-011 违反，但**必须显式记录**，否则未来有人默认"顺序不敏感是全局不变量"会被这条行为反证。
- **边（`links[]`）属性字段比较**：本次改动不涉及边对象除 `source`/`relation`/`target`（既有 `edgeKey`）外的其他字段。
  ⚠️ **实现后由异构对抗审查实证升级为"已知缺口"（非假想）**：两路独立审查各自在**真实 pinned 资产**上构造并跑通——把 14 条边的 `confidence`/`confidenceScore`/`directional`/`evidenceText` 全部改掉、三元组一字不动，**真实再生脚本判"无需更新"并 exit 0**。`confidenceScore` 由 `src/panoramic/graph/confidence-mapper.ts:15-19` 的常量表决定、`directional` 由 relation 语义派生，二者都是采集行为输出。本卡未处置（超出授权范围），已移交后续卡。
- **节点非 facet 顶层字段**：维度 3 只看 `kind`/`label`/`metadata` 三个 facet，给节点新增 `filePath`/`weight` 等顶层字段不报。同上，实证已知缺口，移交后续卡。
- **`GraphJSON` 除 `directed`/`multigraph` 外的顶层字段**：如 schema v2.0 的 `hyperedges`（`graph-types.ts:257`）。graph-only 当前不产出，但"今天不产出"正是 F271 lineRange 盲区的同构条件。移交后续卡。
- **metadata 叶子的类型档**：路径集合只记 key 名，故 `{a:{}}` 与 `{a:1}`/`{a:null}`/`{a:[...]}` 同签名——实证形态：`signature: "def use(x)" → null`、`callSitesCount: 0 → "0"` 均判绿。这类是**类型级退化**而非 FR-006 要防的浮点噪声，但给叶子加类型档超出本卡"只比 key 名"的授权，移交后续卡由用户裁决。
- **数组内的嵌套 key 改名**：`spans:[{start,end}] → spans:[{from,to}]` 判绿（数组按叶子，FR-004 明确规定）。与本卡立论同构、只是外面多套一层数组，移交后续卡。
- **`BEHAVIOR_VERSION` 变更**：见 FR-017。
- **两份 pinned 资产的任何修改**：见 FR-016。
- **`graph-quality-pinned-staleness.test.ts` 及其 `compareGraphDeep` 比较器**：该测试已使用独立的全字段深比较实现，与本次改动的 `compareGraphOnlyStructure` 无重叠（事实清单 §5），不在本次改动范围内。

### 待澄清事项

无超过 2 处需要 `[NEEDS CLARIFICATION]` 标记的歧义。以下 1 处属明确的 `[AUTO-RESOLVED]`：

- **metadata 嵌套 key 的比较粒度**：`[AUTO-RESOLVED: 采用"递归 key 路径 multiset/set 比较"而非"深度限定为一层"——理由：需求描述明确给出递归规则（只递归 plain object、数组按叶子处理），且事实清单 §6 已实证该方案在当前基线上活性成立，无需进一步澄清]`。
