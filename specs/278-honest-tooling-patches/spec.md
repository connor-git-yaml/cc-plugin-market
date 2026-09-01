# Feature Specification: F278 诚实工具面四小补

**Feature Branch**: `278-honest-tooling-patches`
**Created**: 2026-09-01
**Status**: Draft
**Input**: 用户需求原文 —— F278 诚实工具面四小补：impact/context symbol-not-found hint 误导修正、
collector-fingerprint 护栏 metadata-key 档位、`--init` 冷启动再生审计留痕、judge:doctor 增量漂移视图。
**证据基础**: `specs/278-honest-tooling-patches/code-context.md`（编排器实读源码事实清单，非调研制品）。
本规范每条 FR 均携带该文件中的证据锚（`路径:行号`），不含任何该文件未证实的事实。四项均来自
`docs/design/dogfooding-feedback-ledger.md`"已处理"节的实证条目，符合 Constitution 原则 III（YAGNI）
的"须有 ledger 实证来源"要求。

---

## Clarifications

### Session 2026-09-01

- Q: `--init` 冷启动审计记录若落在 fixture 目录内新增文件，是否会被 `computeFixtureInputHash` 计入、
  造成自指循环？→ A: 已核实为**否**——`scripts/regen-collector-fingerprint-fixtures.ts:477` 显示
  `computeFixtureInputHash(srcRoot)` 的入参是 `path.join(fixtureRoot, 'src')`，只递归 fixture 的
  `src/` 子目录，**不含 fixture 根目录下任何文件**。实证旁证：`README.md`、
  `expected-graph-only-graph.json`、`expected-module-graph.json` 三个文件长期存在于 fixture 根目录，
  pinned a-track 图的 22 个节点全部在 `src/` 下——根目录文件既不进 inputHash 也不进两轨图产物。据此，
  审计记录落点约束从"待核实"收敛为确定结论：MUST 落在 fixture **根目录**（与 `README.md` 同级），
  MUST NOT 落在 `<fixtureRoot>/src/` 下（后者会直接改变 `fixtureInputHash` 并污染两轨图产物）。落点的
  具体形态（README 追加段落 vs 独立 sidecar 文件）仍由 plan 阶段决定。
- Q: `judge-snapshot-doctor.mjs --since` 若必须修改 `judge-snapshot-core.mjs` 才能实现，是否有已知
  可行的纯 CLI 层实现路径？→ A: 已核实**存在**可行路径——`compareFile` 已由
  `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs` 具名导出，入参是纯数据 `DigestResult`
  （`{status:'ok',sha256}` / `{status:'missing',sha256:null}` / `{status:'error',errorCode}`），函数
  本身零 I/O。因此"把某 git ref 下文件内容的 sha256 包装成同形状 `DigestResult` 后喂给已导出的
  `compareFile`，只改 doctor CLI 层"这条路径已确认可行，FR-013 的 BLOCKED 分支预期不会触发；BLOCKED
  条款仍作为安全网保留，仅当 implement 阶段实际遇到反例（`compareFile` 之外还需要 core 内部其他未导出
  能力）时才启用。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - impact/context 的 symbol-not-found hint 不再误导新符号场景 (Priority: P1)

Agent 调用 `impact`/`context` 查询一个刚刚新增或新导出的 symbol（文件本身已在图中，但该符号本身尚未
被最近一次建图收录）时，目前收到的提示是"请检查 symbol id 格式或参考 fuzzyMatches 候选"——这在文件确
实在图中时是误导的：真正原因通常是图陈旧，而不是 agent 拼错了 id。

**Why this priority**：这是四项里唯一直接影响 agent 高频路径（`impact`/`context` 是最常用的两个 MCP
工具）诊断质量的一项，误导会让 agent 在错误方向（反复调整 id 拼写、翻 fuzzyMatches）浪费执行轮次。

**Independent Test**：构造一个图中已有 module 节点、但该 module 内某具名 symbol 不在图中的场景（可用
"手工从 pinned/临时图中删除某 symbol 节点，保留其所属 module 节点"来模拟），分别调用
`impact(target=<该symbol>)` 与 `context(symbolId=<该symbol>)`，验证 hint 文案切换为"可能是新增符号"分
支；再构造一个 module 本身就不在图中的场景，验证 hint 保持原文案不变。

**Acceptance Scenarios**：

1. **Given** 图中存在 `moduleFileFromId(target)` 对应的 module 节点（`findNode(graphData, file)` 命中），
   但 `canonicalizeSymbolId(target, ...)` 返回 `not-found` 且 `resolveSymbolFuzzy` 未能 `autoResolved`，
   **When** 调用 `impact(target)`，**Then** 返回的 `error.hint` 为新文案（提示"文件已在图中，符号可能是
   新增/新导出，建议 `spectra batch --mode graph-only` 重建后重试"一类表述，具体措辞由 plan 阶段定稿），
   `error.code` 仍为 `symbol-not-found`，`error.context.fuzzyMatches` 字段保持原有结构不变。
2. **Given** 同上条件，**When** 调用 `context(symbolId)`，**Then** hint 切换为同一新文案（与 impact 的
   文案保持一致，避免两处再度漂移），其余返回字段结构不变。
3. **Given** `moduleFileFromId(target)` 对应的 module 节点**不在**图中（`findNode` 返回 `null`），
   **When** 调用 `impact`/`context`，**Then** hint 保持现有文案"请检查 symbol id 格式或参考
   fuzzyMatches 候选"不变（文件本身都不在图中时，"新增符号"推测不成立，原文案更贴切）。
4. **Given** 任意 `target`/`symbolId`，**When** `canonicalizeSymbolId` 命中或 `resolveSymbolFuzzy` 已
   `autoResolved`（走 `fuzzy-resolved` 分支），**Then** 本次改动不引入任何行为差异——fuzzy 自动解析路径
   完全不受影响。

---

### User Story 2 - collector-fingerprint 护栏新增 metadata-key 比较档位 (Priority: P1)

`compareGraphOnlyStructure` 目前只比节点 id 集合和边的 multiset，节点 `metadata` 的字段完全不参与比
较——F271 的 lineRange 场景已实证：某节点悄悄丢失 `lineRange` 字段，护栏毫无察觉。需要新增一个"metadata
key 集合"维度（只比字段名有无，不比值），在不引入值级噪声的前提下捕获字段增删。

**Why this priority**：这是纯粹的安全网补洞——当前护栏对 metadata 字段增删完全失明，任何未来改动（不
限于 lineRange）都可能重演 F271 那种静默丢字段而无人发现的情况。

**Independent Test**：对 pinned 基线图做一次"删除某节点的某个 metadata key"的变异，验证新档位能检测到
差异并报告；对同一份 pinned 基线图不做任何改动重跑比较，验证判定为一致（活性证明）。

**Acceptance Scenarios**：

1. **Given** `scripts/regen-collector-fingerprint-fixtures.ts:166` 的 `compareGraphOnlyStructure`，
   **When** 两份图里同一 node id 的 `metadata` key 集合不同（如一份有 `lineRange` 另一份没有），
   **Then** 比较结果标注为不一致，且差异信息能定位到具体 node id 与缺失/新增的 key 名。
2. **Given** 两份图存在重复 node id（同 id 出现多次），**When** 按 key 集合比较，**Then** 比较维度
   MUST 按 node id 逐项比较（而非把全图 metadata key 拍平成一个并集），保证"某节点丢字段、其余节点该
   字段仍在"的场景可被检出（这正是当前"全图并集"档位对 F271 lineRange 场景零检测力的根因，不得重蹈）。
3. **Given** 节点 `metadata` 字段本身缺席（`undefined`，即该节点根本没有 `metadata` 属性）与
   `metadata: {}`（空对象，字段存在但 key 集合为空），**When** 比较，**Then** 两种情况 MUST 被区分对
   待，不得混同为同一种"key 集合为空"状态（`undefined` 代表"该节点从未产出过 metadata"，是比"key 集合
   为空"更强的退化信号）。
4. **Given** 当前 pinned 基线资产 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`
   （已含 F271 的 `lineRange` 字段），**When** 用未改动的采集流程重新产出图并跑新档位比较，**Then** 判
   定为一致（这是新档位不引入假阳性的活性证明，MUST 实跑验证，不得纸面断言）。
5. **Given** 既有扰动注入测试组（`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:307+`：
   删边/改 id/重复节点/乱序/重复边），**When** 运行全量测试，**Then** 这些既有用例的判定结果 MUST 与
   改动前逐一致（新档位只新增检测面，不改变既有维度的判定逻辑）。

---

### User Story 3 - judge:doctor 支持相对基线的增量漂移视图 (Priority: P2)

维护者对门禁/判定器类改动跑 `judge:doctor` 时，目前只能看到"当前 repo 内容 vs 生效 snapshot"的全量对
比，无法区分"这次改动引入的新 drift"和"开工前就已存在的 drift"。增加 `--since <ref>` 选项，用某个 git
ref（如改动前的 commit）作为基线，输出相对该基线的增量漂移。

**Why this priority**：这是诊断能力增强而非缺陷修复（既有全量视图仍然正确、`main` 恒返回
`exitCode 0` 未变），价值在于降低维护者的排查成本，但不影响任何门禁判定结果本身，优先级低于两项直接
影响 agent 工具正确性/安全网的改动。

**Independent Test**：在一个已知存在漂移的 judge snapshot 场景下，分别不带 `--since` 与带
`--since <某个更早 ref>` 运行 doctor，验证前者输出与改动前逐字节一致，后者能区分"该 ref 时已存在的
drift"与"该 ref 之后新引入的 drift"。

**Acceptance Scenarios**：

1. **Given** `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 当前的 `parseArgs`（仅支持
   `--project-root`），**When** 不传 `--since` 运行 doctor，**Then** 输出（含 `formatReport` 的四态文
   案：not-applicable / indeterminate(resolution) / indeterminate(comparison) / drift|in-sync）与改
   动前逐字节一致，`main` 的 `process.exitCode` 仍恒为 `0`。
2. **Given** 一个有效的 git ref（如 `HEAD~5`）且当前 repo 是合法 git 仓库，**When** 运行
   `judge-snapshot-doctor.mjs --since <ref>`，**Then** 输出对 `JUDGE_FILE_SET`（`lib/judge-snapshot-core.mjs`
   导出的 10 个文件）中每一份，标注其相对 `<ref>` 时刻内容是否发生变化（新引入 drift / 该 ref 时已存在
   / 未变），且实现方式 MUST 复用已导出的 `compareFile`（把"某 git ref 下文件内容的 sha256"包装成与
   `computeSha256` 同形状的 `DigestResult` 喂给它），MUST NOT 修改
   `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`（该文件是 F276 的并行改动面，见 Out of
   Scope）。
3. **Given** `<ref>` 不是一个合法的 git ref、或当前目录不在 git 仓库内（`git show <ref>:<path>` 进程本
   身失败，非"路径在该 ref 下不存在"的正常退出），**When** 运行 `--since <ref>`，**Then** 系统 MUST
   fail-loud（明确报错并以非零 `exitCode` 或专门的错误态退出），MUST NOT 将其静默降级为"该 ref 下所有
   文件均缺失 → 视为本次全部新引入"（这是本卡明确点名的 fail-open 陷阱：把"基线不可读"误报成"基线里
   没有"）。
4. **Given** `<ref>` 合法且是 git 仓库，但某个 `JUDGE_FILE_SET` 文件在该 ref 下确实不存在（如该文件是
   `<ref>` 之后才新建的），**When** 运行 `--since <ref>`，**Then** 该文件的增量状态 MUST 标注为"该 ref
   下不存在 → 本次新增"（这是与场景 3 语义不同的正常情况，MUST 与"ref 不可读"的报错路径明确区分，不
   得共用同一处理分支）。

---

### User Story 4 - collector-fingerprint `--init` 冷启动再生留下审计记录 (Priority: P3)

维护者用 `--init` 冷启动重新生成 collector-fingerprint 护栏的两份 pinned 资产后，目前唯一的留痕方式是
手工在 fixture README 里补一段文字（F271 就是这么做的）。这项改动让 `--init` 路径自动写一条再生审计记
录，减少"忘记补记"的风险。

**Why this priority**：纯留痕增强，不影响任何护栏判定逻辑或既有资产内容，是四项里成本/价值都最小的
一项。原有的"自指循环风险"已在 Clarifications 中核实为不成立（`computeFixtureInputHash` 只扫描
`src/` 子目录，不含 fixture 根目录），但优先级排序本身不变。

**Independent Test**：在两份 pinned 资产均缺席的前提下运行 `--init`，验证审计记录被写出且包含时间戳与
触发原因（可从 CLI 参数或 git 上下文获取）；再次在已有资产存在时尝试 `--init`（触发 C-002 守卫拒绝），
验证审计记录不会被写出。

**Acceptance Scenarios**：

1. **Given** `tests/fixtures/collector-fingerprint-guardrail/` 下两份 pinned 资产均缺席，**When** 运行
   `regen-collector-fingerprint-fixtures.ts --init`，**Then** 冷启动再生成功后，系统写出一条审计记录
   （落点形态——README 追加段落 或 独立 sidecar 文件——由 plan 阶段决定，但 MUST 落在 fixture **根目录**，
   MUST NOT 落在 `<fixtureRoot>/src/` 下），记录 MUST 包含再生时间与触发方式（`--init` 路径）。
2. **Given** `scripts/regen-collector-fingerprint-fixtures.ts:500-519` 的 C-002 守卫（两份 pinned 资产
   任一存在即拒绝 `--init`），**When** `--init` 被该守卫拒绝退出，**Then** 系统 MUST NOT 写出任何审计
   记录（守卫拒绝是"未执行再生"，写审计记录会造成"记录了一次并未发生的再生"的虚假留痕）。
3. **Given** 已写出的审计记录，**When** 后续（非 `--init`）常规再生流程运行，**Then** 该记录不被追加或
   修改（本卡范围仅覆盖 `--init` 冷启动路径，常规路径的留痕方式不在本卡改动范围内）。

---

### Edge Cases

- **US1 · symbol id 无 file part（纯 module id）**：`moduleFileFromId(id)` 对无 `::`/`#` 分隔符的 id
  返回其自身（`query-helpers.ts:708-714`）。此时"文件是否在图中"退化为直接 `findNode(graphData, id)`
  判定该 module id 本身是否存在——若不存在，按 US1 场景 3 处理（保持原文案），逻辑上自动成立，不需要
  额外分支。
- **US1 · `view_file` 第三处 hint 是否纳入范围**：`file-nav-tools.ts:150-165` 的 `resolveSymbolRange`
  也有一条 `symbol-not-found` hint，措辞与 impact/context 不同（多了"或改用 startLine/endLine"）。**裁
  决**：不纳入本卡范围。理由——`view_file` 场景下即使"文件在图中、symbol 不在"，用户手边就有
  `startLine`/`endLine` 的替代方案，误导性弱于 impact/context（后两者没有绕过 symbol id 的替代入参）；
  纳入会把改动面从"2 处一致文案"扩大到"3 处需要各自适配替代方案措辞"的不同结构，超出"小补"定位。M10
  §5 P1-E 记载的三处 graph-not-built 提示不一致问题（与本项是不同的 hint，见下条）如有余力顺手对齐，但
  `view_file` 的 symbol-not-found 分支本身不改。
- **graph-not-built 恢复提示三处一致性**（区别于上一条的 symbol-not-found）：`code-context.md` §1 列出
  的 `file-nav-tools.ts:140`、`agent-context-tools.ts:130/150`、`graph-tools.ts:182`、`server.ts:61`
  五个恢复提示点，本卡**不承诺**统一改写（这是 M10 §5 P1-E 的既有登记项，非本卡四项需求之一）。若
  plan/implement 阶段顺手核实到文案已经一致或可零成本对齐，可以对齐；改不动则保持现状，不作为本卡验
  收项，不得因为"顺手做了"而扩大本卡的复杂度评估。
- **US2 · 重复 node id 的 key 集合比较**：见 Acceptance Scenario 2，MUST 按 node id 分组、逐组比较 key
  集合的 multiset，不得拍平成全图并集。
- **US2 · `metadata` 缺席 vs 空对象**：见 Acceptance Scenario 3，`undefined` 与 `{}` 是两种不同退化程
  度的状态，比较逻辑 MUST 能区分（至少在差异报告中标注清楚，不要求两者触发不同严重等级，但不得等同
  处理为"key 集合都是空集合"）。
- **US2 · 对当前 pinned 基线的活性证明是硬约束**：见 Acceptance Scenario 4——"新档位对当前基线判一致"
  不是锦上添花的验证项，而是本卡验收的强制组成部分（用户明确要求"不是可选项"）。若实跑发现不一致，
  MUST 先排查是"比较器逻辑错误"还是"pinned 资产本身确有未被发现的 metadata 缺陷"，不得为了让测试变绿
  而 `--init` 重生或调整比较逻辑掩盖真实差异。
- **US4 · `--init` 冷启动与 `computeFixtureInputHash` 扫描面的关系**：已在 Clarifications 中核实并
  收口——`computeFixtureInputHash(srcRoot)` 的入参恒为 `<fixtureRoot>/src`，只递归该子目录，不含 fixture
  根目录下任何文件（`README.md`/`expected-graph-only-graph.json`/`expected-module-graph.json` 三份长期
  存在于根目录且从未进入 inputHash 或两轨图产物即为实证）。因此审计记录只要落在 fixture 根目录（不落入
  `src/` 子目录），即不构成自指循环，plan 阶段无需再重新核实此项，只需在两个落点候选（README 追加 /
  独立 sidecar 文件）之间选择具体形态。
- **US4 · `--init` 被 C-002 守卫拒绝时的留痕边界**：见 Acceptance Scenario 2，守卫拒绝退出的路径下
  MUST NOT 写审计记录。
- **US4 · judge:doctor `--since` 三种基线不可读语义的区分**：
  1. `<ref>` 语法非法或当前目录不是 git 仓库 → **fail-loud**（报错，不得当成"该 ref 下文件都缺失"）；
  2. `<ref>` 合法但目标文件在该 ref 下确实不存在 → 判定为"该 ref 之后新增"（正常态，非错误）；
  3. `<ref>` 合法、文件在该 ref 下存在但内容与当前不同 → 判定为"漂移"，且需要能进一步区分"该漂移在
     `<ref>` 时刻是否已相对**当前生效 snapshot** 存在"，从而回答"是这次改动引入的，还是开工前就有的"
     这一核心问题。三者的判定逻辑与 fail-loud 边界 MUST 有独立的单元测试覆盖，不得共用同一处理分支导
     致 1 和 2 被混淆。
- **US4 · `--since` 与既有四态输出的组合**：`formatReport` 现有四态（not-applicable /
  indeterminate(resolution) / indeterminate(comparison) / drift\|in-sync）在带 `--since` 时 MUST 仍然
  成立（增量视图是在现有四态判定结果之上叠加"相对基线新增 or 既存"的维度，不是替换四态）；不带
  `--since` 时的输出（含这四态的措辞与结构）MUST 逐字节不变（宪法原则 XIII 向后兼容，见验收 Scenario 1）。

---

## Requirements *(mandatory)*

### Functional Requirements

**User Story 1 — impact/context symbol-not-found hint**

- **FR-001**: 系统 MUST 在 `src/mcp/agent-context-tools.ts:216-230`（impact handler）与
  `:365-379`（context handler）的 `symbol-not-found` 分支中，先判定
  `findNode(graphData, moduleFileFromId(target))`（或 `symbolId`）是否命中；命中时使用新 hint 文案
  （提示"可能是新增/新导出符号，建议重建图后重试"），未命中时保持现有文案不变。**[必须]**——这是本
  User Story 的核心行为，去掉则误导依旧存在。
- **FR-002**: impact 与 context 两处的新 hint 文案 MUST 一致（同一措辞），避免重演当前"impact 与
  context 各写各的、三处 symbol-not-found hint 已经三种措辞"的漂移局面。**[必须]**——一致性是本项改
  动价值的一部分，不一致等于只修了一半。
- **FR-003**: 本次改动 MUST NOT 修改 `error.code`（仍为 `symbol-not-found`）、`error.context.fuzzyMatches`
  的结构与内容、`resolveSymbolFuzzy`/`canonicalizeSymbolId` 的行为，以及 `fuzzy-resolved` 自动解析分
  支的返回结构——仅新增一个分支判定与替换 hint 文案字符串。**[必须（保持现状）]**——防止范围蔓延到
  fuzzy resolve 的判定逻辑，这是用户明示的护栏。
- **FR-004**: `src/mcp/file-nav-tools.ts:150-165`（`view_file` 的 `resolveSymbolRange`）、
  `agent-context-tools.ts:385`（`findNode` 返回 null 的防御性分支）、`file-nav-tools.ts:103`
  （`nodeToRange` 内 v8-ignore 防御分支）系统 MUST NOT 改动。**[必须（保持现状）]**——裁决见 Edge
  Cases，超出本卡"2 处一致文案"定位。

**User Story 2 — collector-fingerprint 护栏 metadata-key 档位**

- **FR-005**: 系统 MUST 在 `scripts/regen-collector-fingerprint-fixtures.ts:166` 的
  `compareGraphOnlyStructure` 中新增一个比较维度：按 node id 分组比较两份图中同 id 节点的
  `metadata` key 集合（仅比较 key 名有无，不比较 value），差异需可定位到具体 node id 与 key 名。
  **[必须]**——这是本 User Story 的核心交付，去掉则 metadata 盲区依旧存在。
- **FR-006**: 新档位的比较 MUST 按 node id 维度分组（重复 id 时按 key-set multiset 比较），MUST NOT
  将全图 metadata key 拍平成单一并集后比较（后者对"某节点丢字段、其余节点该字段仍在"的场景零检测
  力，已被 F271 lineRange 场景实证）。**[必须]**——是 FR-005 的正确性前提，写错等于新增了一个没用的
  检测维度。
- **FR-007**: 新档位 MUST 区分节点 `metadata` 字段缺席（`undefined`）与 `metadata: {}`（空对象）两种
  状态，不得等同处理。**[必须]**——`undefined` 是比空 key 集合更强的退化信号，混同会丢失诊断精度。
- **FR-008**: 系统 MUST NOT 引入 metadata **值**级比较（只比 key 名，不比对应字段的值），也 MUST NOT
  修改现有节点 id multiset / 边 multiset 两个既有比较维度的判定逻辑。**[必须（保持现状）]**——用户明
  示范围边界；值级比较会引入远超"字段增删"诉求的噪声面（如 `confidence` 浮点值波动）。
- **FR-009**: 系统 MUST 实跑验证：对当前 pinned 基线资产
  （`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` 及其
  fingerprint/moduleGraph 对照物）用未改动的采集流程重新产出图后，新档位判定为一致。**[必须]**——这
  是新档位不引入假阳性的活性证明，是用户明示的硬性验收项而非可选验证。
- **FR-010**: 系统 MUST 新增变异测试用例（如"删除某节点某个 metadata key"）验证新档位能检出该差异，
  并追加到既有扰动注入测试组
  （`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:307+`）；既有该测试组的用例（删边/
  改 id/重复节点/乱序/重复边）判定结果 MUST 与改动前逐一致。**[必须]**——变异测试是证明"新档位真的会
  红"的唯一手段，符合用户明示的回归护栏要求。
- **FR-011**: 本次改动 MUST NOT 修改 `src/panoramic/graph/collector-fingerprint.ts` 的
  `BEHAVIOR_VERSION`（当前值 3），因为改动仅限比较器（护栏侧），不改采集器行为、不改 fixture 输入样
  本，按 F249/F252 口径不应 bump。若实跑发现比较器新档位导致 pinned 基线判不一致，MUST 先排查是"真漂
  移"还是"资产陈旧"并如实回报，MUST NOT 为求绿而 bump 版本号或用 `--init` 重生掩盖。**[必须（保持现
  状）]**——版本号纪律，防止用版本跳变掩盖真实发现。

**User Story 3 — judge:doctor 增量漂移视图**

- **FR-012**: 系统 MUST 在 `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 的 `parseArgs` 中
  新增可选参数 `--since <ref>`；不传该参数时，`parseArgs` 及全流程输出 MUST 与改动前逐字节一致（宪
  法原则 XIII）。**[必须]**——这是本 User Story 的入口，也是向后兼容的直接验收点。
- **FR-013**: `--since <ref>` 的实现 MUST 只改动 `judge-snapshot-doctor.mjs`（CLI 编排层），MUST NOT
  修改 `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`。已核实 `compareFile` 已由
  `judge-snapshot-core.mjs` 具名导出、入参是纯数据 `DigestResult`（`{status:'ok',sha256}` /
  `{status:'missing',sha256:null}` / `{status:'error',errorCode}`）、函数本身零 I/O，因此"只改 CLI
  层、复用已导出 `compareFile`"这条路径已确认可行，预期不会触发下述 BLOCKED 分支。该分支仍作为安全
  网保留：若实现过程中仍然发现必须修改 `judge-snapshot-core.mjs`（例如需要 `compareFile` 之外的未导出
  内部能力）才能达成目标，MUST 在实现前停止并将该子项标记为 **BLOCKED**（与 F276 存在文件级冲突，不得
  擅自扩大到 core），回报给编排器由用户裁决是否顺延或调整范围。**[必须]**——用户明示的硬性边界，防止
  与 F276 并行改动产生合并冲突。
- **FR-014**: 系统 MUST 复用 `judge-snapshot-core.mjs` 已导出的 `compareFile`，通过把"某 git ref 下
  文件内容的 sha256"包装成与 `computeSha256` 同形状的 `DigestResult`（`{status:'ok',sha256}` /
  `{status:'missing',sha256:null}` / `{status:'error',errorCode}`）后传入，而非另写一套比较逻辑。
  **[必须]**——复用既有比较原语是 FR-013"不改 core"约束下唯一可行的实现路径。
- **FR-015**: 系统 MUST 明确区分三种基线读取结果并分别处理：(a) `<ref>` 本身无效或当前目录不是 git
  仓库 → fail-loud（非零 exit 或专门错误态，MUST NOT 静默当作"该 ref 下所有文件缺失"）；(b) `<ref>`
  合法但目标文件在该 ref 下不存在 → 判定为"该 ref 之后新增"（正常态）；(c) `<ref>` 合法且文件存在但
  内容不同 → 判定为"漂移"。**[必须]**——用户明示的头号 fail-open 陷阱："基线不可读"绝不能静默降级
  成"本次新引入"，这是本 User Story 的安全底线。
- **FR-016**: `--since <ref>` 模式的输出 MUST 在现有 `formatReport` 四态（not-applicable /
  indeterminate(resolution) / indeterminate(comparison) / drift\|in-sync）基础上叠加"相对
  `<ref>` 是新增还是既存漂移"的维度，MUST NOT 替换或删减现有四态判定逻辑。**[必须]**——增量视图是叠
  加能力，不是替代现有诊断，避免破坏 `main` 恒 `exitCode 0`（诊断非门禁）的既有定位。
  **本条与 FR-015 的措辞冲突及其裁决（implement 阶段收口，如实留痕）**：本条的"恒 0"只约束**诊断结论**
  ——`--since` 视图里出现多少 `introduced` / `drift` 都不改退出码；而 `--since` 的**环境类失败**
  （git 不可用 / 不在仓库内 / ref 无效 / 基线对象不可读 / `--project-root` 不是仓库根）按 FR-015
  以 `exitCode 1` 退出且 **stdout 完全为空**。二者不冲突：前者是"跑成了、结论是 drift"，后者是
  "环境不满足、诊断根本没跑成"，把后者也压成 exit 0 正是 FR-015 点名的头号 fail-open。实现按
  FR-015 收口。
- **FR-017**: 系统 MUST 只使用 Node 内置模块（`node:child_process` 调 `git show`、`node:crypto` 算
  sha256）实现 `--since`，MUST NOT 引入任何新增运行时依赖。**[必须（保持现状）]**——宪法原则 X 零运
  行时依赖，`plugins/spec-driver/` 下的硬约束。

**User Story 4 — `--init` 冷启动再生审计记录**

- **FR-018**: 系统 MUST 在 `scripts/regen-collector-fingerprint-fixtures.ts` 的 `--init` 成功路径
  （两份 pinned 资产均缺席、冷启动首次生成完成后）写出一条再生审计记录，包含再生时间与触发方式
  （`--init`）。**[必须]**——这是本 User Story 的核心交付，替代此前"手工在 README 补记"的做法。
- **FR-019**: 审计记录的落点形态（README 追加段落 / 独立 sidecar 文件）与具体位置由 plan 阶段决定，
  但 MUST 落在 fixture **根目录**（与 `README.md` 同级），MUST NOT 落在 `<fixtureRoot>/src/` 下。已核实
  `computeFixtureInputHash(srcRoot)` 的入参恒为 `<fixtureRoot>/src`，只递归该子目录、不覆盖 fixture
  根目录下任何文件（`README.md`/两份 expected-*.json 三个根目录文件长期存在且从未进入 inputHash 或两
  轨图产物即为实证）；据此，只要落点选在根目录，MUST NOT 出现"审计记录本身改变输入指纹、致使下次一
  致性判定失真"的自指循环，plan 阶段无需再重新核实扫描面，只需在两个落点候选之间选择具体形态。
  **[必须]**——防止本卡明确点名的头号陷阱，同时避免向 plan 阶段转嫁已核实清楚的核实工作。
- **FR-020**: 当 `--init` 被 C-002 守卫（`:500-519`，两份 pinned 资产任一存在即拒绝）拒绝退出时，系
  统 MUST NOT 写出审计记录。**[必须]**——守卫拒绝意味着未发生再生，写记录会造成虚假留痕。
- **FR-021**: 本次改动 MUST NOT 改变常规（非 `--init`）再生路径的行为与留痕方式，仅覆盖 `--init`
  冷启动路径。**[必须（保持现状）]**——用户明示范围边界，防止蔓延到常规再生流程。

### Key Entities *(include if feature involves data)*

- **impact/context `symbol-not-found` hint 文案**（既有字段扩展）：`error.hint` 字符串内容按"文件是
  否在图中"分两个固定文案分支，`error.code`/`error.context.fuzzyMatches` 结构不变。
- **`compareGraphOnlyStructure` metadata-key 差异报告**（新增比较维度产出）：按 node id 分组的 key 集
  合差异列表，形状由 plan 阶段定，但须能定位到具体 node id 与 key 名，且能区分 `undefined` 与 `{}`。
- **`--init` 再生审计记录**（新增数据实体）：至少含再生时间戳与触发方式（`--init`），落点由 plan 阶
  段在"fixture 根目录"约束内定具体形态，已确认 MUST NOT 落入 `computeFixtureInputHash` 扫描面
  （即 `<fixtureRoot>/src/`）。
- **judge:doctor 增量漂移报告**（既有四态输出的叠加字段）：在现有 `formatReport` 四态基础上，附加
  "相对 `<ref>` 是新增 / 既存漂移 / 未变"的分类，仅在传入 `--since` 时出现。

---

## Complexity 评估（供 GATE_DESIGN 审查）

- **组件总数**：不新增独立模块，涉及对既有文件的定向修改：`src/mcp/agent-context-tools.ts`、
  `scripts/regen-collector-fingerprint-fixtures.ts`（承载 US2 与 US4 两项）、
  `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`。归入"组件"计数约 3 个。
- **接口数量**：变更点约 4 个 —— (1) impact/context 的 `symbol-not-found` hint 文案分支（响应契约不
  变，仅字符串内容变化）；(2) `compareGraphOnlyStructure` 新增比较维度（新增返回信息，不改变既有两
  维度的判定结果）；(3) `--init` 审计记录写出（新增副作用，无既有接口变更）；(4) `judge-snapshot-doctor.mjs`
  新增 `--since` CLI flag（新增可选入口，不带该 flag 时行为不变）。
- **依赖新引入数**：0（US3 复用 Node 内置 `child_process`/`crypto`，其余三项不引入任何依赖）。
- **跨模块耦合**：否——四项改动分别落在互不相交的文件集合内（US1 仅 `agent-context-tools.ts`；US2/US4
  同落 `regen-collector-fingerprint-fixtures.ts` 但改动的是不同函数/路径，非同一处逻辑的跨模块联动；
  US3 仅 `judge-snapshot-doctor.mjs`，明确禁止碰 core），不需要同时修改 2+ 个现有模块的对外接口。
- **复杂度信号**：均不存在——无递归结构、无状态机新增、无并发控制改动、无数据迁移（US2/US4/US3 均为
  只读比较或追加式写入，不改变既有数据形状的语义）。
- **总体复杂度**：**LOW**（组件数 3 < 5、无接口数量超阈值、无跨模块耦合、无复杂度信号；US3 存在一处
  已核实但仍保留安全网的 BLOCKED 风险（撞 `judge-snapshot-core.mjs`，预期不触发），不构成结构复杂度
  上升）。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 构造"module 节点在图中、symbol 不在图中"的红先行用例，`impact`/`context` 返回的 hint
  文案切换为新文案；构造"module 也不在图中"的对照用例，hint 保持原文案——两个场景各有独立单元测试断
  言分支正确性，且 `error.context.fuzzyMatches` 结构在两个场景下均不变。
- **SC-002**: `npx vitest run` 中新增的 metadata-key 变异测试（删除某 key 后判不一致）由红变绿；对当
  前 pinned 基线（`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` 等）
  重新采集后跑新档位比较判定一致；既有扰动注入测试组（`collector-fingerprint-guardrail.test.ts:307+`）
  全部保持原判定结果通过。
- **SC-003**: `--init` 冷启动路径（两份 pinned 资产均缺席）跑通后，审计记录被写出且可读取到再生时间
  与触发方式；C-002 守卫拒绝路径（资产已存在时跑 `--init`）不产生任何审计记录；
  `tests/integration/collector-fingerprint-regen-script.test.ts` 新增对应用例通过。
- **SC-004**: `judge-snapshot-doctor.mjs` 不带 `--since` 的输出与改动前逐字节一致（可用改动前后两次
  运行的 stdout diff 验证为空）；带 `--since <合法 ref>` 时能区分"该 ref 后新增"与"该 ref 时已存在的
  漂移"；带 `--since <非法 ref>` 或非 git 仓库时 fail-loud（非零退出或明确错误态），不产生"全部文件
  视为本次新引入"的误报；`plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` 新增用例覆盖
  上述三种基线场景，`npm run test:plugins` 全部通过。
- **SC-005**: 全量 `npx vitest run`、`npm run test:plugins`、`npm run build`、`npm run repo:check`、
  `npm run release:check` 均零失败。
- **SC-006**: FR-013 已核实存在"只改 CLI 层复用 `compareFile`"的可行实现路径，预期本项不触发
  BLOCKED；该判定仍作为安全网保留——若 US3 在实现前仍确认必须修改 `judge-snapshot-core.mjs` 才能达成
  `--since` 目标，则该子项在验收时被明确标注为 **BLOCKED（与 F276 撞文件）** 并回报给用户裁决，而非被
  静默实现或静默跳过而不留痕迹。

---

## Out of Scope

以下内容明确不在本次改动范围内：

- **`src/mcp/file-nav-tools.ts:150-165`**（`view_file` 的 `symbol-not-found` hint）：裁决见 Edge
  Cases——不纳入，措辞结构与 impact/context 不同，扩大会超出"小补"定位。
- **`agent-context-tools.ts:385` 与 `file-nav-tools.ts:103`**：两处非本卡分支覆盖的防御性
  `symbol-not-found` 分支，不改动。
- **graph-not-built 恢复提示三处/五处不一致**（M10 §5 P1-E 登记项）：本卡不承诺统一改写，能顺手对齐
  则对齐、改不动则维持现状，不作为验收项。
- **`compareGraphOnlyStructure` 的 metadata **值**级比较**：本卡只做 key 集合比较，不比较字段值（如
  `confidence` 浮点值、`sourcePath` 字符串内容）。
- **节点 id multiset / 边 multiset 两个既有比较维度的判定逻辑改动**：本卡只新增第三个维度，不改动前
  两个既有维度。
- **`BEHAVIOR_VERSION` bump**（`src/panoramic/graph/collector-fingerprint.ts`）：本卡不改采集器行
  为，按纪律不应 bump；若实跑证明必须 bump，须先停下回报而非直接改。
- **`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`**：本卡硬性禁止修改（F276 撞文件风险
  区）；若实现证明绕不开，对应子项标 BLOCKED，不擅自扩大范围。
- **常规（非 `--init`）collector-fingerprint 再生路径的留痕方式**：本卡仅覆盖 `--init` 冷启动路径。
- **`vitest.config.ts`、`.github/workflows/ci.yml` 等 F272 点名的测试基础设施资产**：不在本卡改动范
  围（新增本卡自身的单元/集成测试文件不算越界，但不得改动测试运行配置本身）。
- **`plugins/spec-driver/scripts/fix-compliance-*.mjs`、`plugins/spec-driver/hooks/**`**：F270 路径，
  与本卡改动面无关，不触碰。
