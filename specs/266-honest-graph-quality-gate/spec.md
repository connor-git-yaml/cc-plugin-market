# Feature Specification: 空图/退化图 fail-loud 链 + MCP 返回面诚实化

**Feature Branch**: `claude/honest-graph-quality-gate-2e3add`
**Created**: 2026-08-24
**Status**: Draft
**Input**: 用户需求描述："F266 空图/退化图 fail-loud 链收口 + MCP impact/context/detect_changes 返回面诚实化（freshness + coverage/boundary）"，SSoT 为 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-C
**调研基础**: `[无调研基础]` — story 模式无 research 阶段；本 spec 的事实基础由主编排器在派发前逐条实证核实（文件路径/行号/实跑 fixture），详见下方"事实核实结论"。functional scope 严格对齐 SSoT §4 P0-C 的 (a)–(e) 五项，未超出其列出的范围。

## 事实核实结论

主编排器在派发前提供的 5 条事实（(a) module-derivation 默认过滤器、(b) post-commit 覆写好图、(c) graph-quality 对空图判 pass、(d) MCP 返回面确定性口吻、(e) detect_changes baseRef 忽略工作树）均附带具体文件路径、行号与实跑证据。本子代理复核这些引用（文件路径存在性、行号语义、既有通道如 `buildCannotAssessReport`/`describeBuilderStamp`/`computeCollectorFingerprint` 的可复用性）后**未发现可证伪之处**，全部予以采纳作为本 spec 的事实基础，不再重复推导。唯一需要澄清的口径差异：SSoT 原文引用 `graph-quality.ts:196-204` 描述空图判 pass 的成因，但主编排器已修正为真实成因在 `validateGraphJsonShape`（约 `graph-quality.ts:99`）对空数组的放行；本 spec 按修正后的口径描述行为而不引用具体行号（行号细节留给 plan 阶段核实）。

**需求澄清核实补充（澄清子代理，2026-08-24）**：复核 `src/cli/commands/graph-quality.ts` 的 `exitCodeFor`（约行 768-771）与 `scripts/lib/graph-quality-core.mjs`（约行 87、187-188）后确认——`graph-quality` 命令自身对 `cannot-assess` 类判定的退出码映射是 **exit 2**（非 pass 的 exit 0），FR-006"在退出码上体现非正常通过"这一诉求与命令自身既有行为**并不矛盾**，是自洽的（本卡把空图新增判入 `cannot-assess` 通道后自动继承该 exit 2 语义，无需额外改动退出码逻辑本身）。`scripts/lib/graph-quality-core.mjs` 里把 `cannot-assess` 映射为 "warning" 严重度的逻辑，是**下游另一消费方**（fix-compliance 判定器）对该 exit code 的门禁严重度分级策略，与 `graph-quality` 命令本身"是否算 pass"是两层不同的判断，不在本卡改动范围内，plan 阶段无需为此二者"不一致"而纠结。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI agent 得到诚实的"零结果"而非误导性结论 (Priority: P1)

一个通过 Spectra MCP 工具（`impact` / `context` / `detect_changes`）辅助编码决策的 AI agent，在查询某个 symbol 的调用方时得到"无已知调用方"。当前这句话不区分"真的没人调用"和"图根本没建好/没覆盖到这段代码"，导致 agent 可能据此做出删除代码、判定为死代码等错误决策。本 story 要求返回结果诚实区分这两种以及另外两种成因，并给出与实际成因匹配的下一步建议。

**Why this priority**: 这是本卡的核心价值——把"静默的错误"变成"可观测的诚实"。MCP 是 agent 唯一的信息来源，返回面的诚实度直接决定下游决策质量；这是 P1 因为它直接影响生产决策正确性，且是本卡里唯一同时触达全部三个 MCP 工具（impact/context/detect_changes）的改动。

**Independent Test**: 构造四种图状态（新鲜且完整解析出 0 调用方 / 图中该 symbol 所在文件未被解析成功 / 调用方来自 node_modules 等图覆盖范围外 / 图的 sourceCommit 与当前工作树不匹配），分别调用三个 MCP 工具，验证返回内容能区分四种成因且不产生第五种混淆结果。可脱离其余 4 项子需求独立验证并交付价值。

**Acceptance Scenarios**:

1. **Given** 图是当前 commit 完整解析出的（source 覆盖到位、无解析报错），symbol X 确实没有任何调用方，**When** 调用 `impact`/`context` 查询 X 的调用方，**Then** 返回结果表明"已完整解析，确认无调用方"，不建议进一步排查。
2. **Given** symbol X 所在文件在最近一次建图中解析失败或被跳过（解析缺口），**When** 查询 X 的调用方，**Then** 返回结果明确指出该 symbol 处于解析缺口范围内，调用方计数不可采信为"确认为零"。
3. **Given** symbol X 唯一潜在调用方来自图覆盖范围之外（如 `node_modules` 或未被建图语言写的代码），**When** 查询 X 的调用方，**Then** 返回结果指出存在图边界外的潜在调用方，而非直接给出"无调用方"的确定性结论。
4. **Given** 图的 `sourceCommit`/指纹与当前工作树不一致（图已过期），**When** 查询任意 symbol，**Then** 返回结果附带图陈旧标记，且该标记不改变查询本身的成功/失败状态（仅作为 advisory 附加信息）。
5. **Given** 以上任一非"确认为零"的成因存在，**When** agent 读取 `nextStepHint`（或等价的下一步建议字段），**Then** 建议内容与实际成因匹配（例如提示"该范围解析未完成，建议先重建图"而非笼统的"可能为顶层入口"）。

---

### User Story 2 - CI/门禁维护者信任 graph-quality 的 pass 判定 (Priority: P1)

一个在 CI 中运行 `spectra graph-quality` 作为质量门禁的维护者，期望"pass"意味着图确实包含有意义的内容。当前一个 `nodes: []` / `links: []` 的空图会被判定为 pass（六项指标在空集合上全部 trivially 满足），使门禁形同虚设。

**Why this priority**: 门禁失效是最直接的"安全假象"——比没有门禁更危险，因为它给人虚假的信心。P1 因为它是 fail-loud 链的最后一道防线，且改动范围小、验证明确。

**Independent Test**: 构造 `nodes: [], links: []` 的最小合法 graph.json fixture（`schemaVersion` 取受支持版本），运行 `graph-quality` 命令，验证不再返回 `overallVerdict: pass` / `exitCode 0`，且退出码/verdict 不因 `builder` 戳不一致而单独翻转（与裁决 1 一致）。可独立于其余子需求验证。

**Acceptance Scenarios**:

1. **Given** 一个 `nodes` 与 `links` 均为空数组的合法 graph.json，**When** 运行 `graph-quality`，**Then** 命令不得判定为 `pass`，须归入既有的"无法评估/需警示"类判定通道（与 `graph-missing`/`schema-too-old` 等既有 reason 语义一致的处理方式），且退出码相应反映非正常通过（即归入既有 `cannot-assess` 通道并继承其 exit 2 语义）。
2. **Given** 图的 `sourceCommit` 为 null 或缺失（builder 戳信息不可用），**When** 运行 `graph-quality`，**Then** 该事实可被记录/暴露，但**不得单独导致**退出码从 pass 翻转为 fail（裁决 1：builder 戳只可见不判定）。
3. **Given** 一个正常非空、指标良好的图，**When** 运行 `graph-quality`，**Then** 判定行为与改动前一致（不引入新的误判 fail）。

---

### User Story 3 - 非 src/ 布局项目的使用者得到明确提示而非静默空图 (Priority: P2)

一个代码库不采用 `src/` 目录约定（如 `lib/`、`app/` 等布局）的用户运行全量 `batch` 建图，当前模块图会静默构建为 0 模块，没有任何 warning，用户以为图正常建好，实际上模块层面的信息完全缺失。

**Why this priority**: 这是 fail-loud 链的第一环（图构建阶段），影响面小于 P1（仅影响非 src 布局项目，且 graph-only 路径不受影响），但仍是"静默失败"模式的代表性场景，P2 反映其影响范围窄于 P1 但仍需修。

**Independent Test**: 构造一个仅含 `lib/` 目录源文件、不含 `src/` 目录的临时工程，运行全量 batch 建图，验证不再静默产出 0 模块的模块图，而是有可观测的提示（错误或警告，具体呈现形式留给 plan 阶段），且提示中包含如何指定实际源码位置的引导。同时验证 `graph-only` 模式路径行为不受影响（按既有设计不经过模块派生环节）。

**Acceptance Scenarios**:

1. **Given** 项目源码全部在 `lib/` 下、无 `src/` 目录，**When** 运行全量 `batch` 建图，**Then** 模块派生环节产生可观测的提示（而非静默返回 0 模块 0 spec），提示内容引导用户如何指定实际源码范围。
2. **Given** 同样的非 src 布局项目，**When** 运行 `batch --mode graph-only`，**Then** 行为与改动前一致（不受本项改动影响，因该模式不执行模块派生）。
3. **Given** 项目确实采用 `src/` 布局（默认场景的绝大多数情况），**When** 运行全量 batch，**Then** 行为与改动前完全一致，不产生新的提示噪声。

---

### User Story 4 - post-commit hook 的用户得到真实生效的增量重建而非贫图覆写 (Priority: P2)

一个安装了 post-commit hook 的用户，文档告诉他"每次 commit 会增量重建图"，但实际执行的命令只读取已生成的 `.spec.md` 与缓存，**不解析源码**，其执行结果会把此前由 AST 完整解析出的好图覆盖成信息大幅缺失的贫图（且这个贫图的 provenance 仍被标记为"这次构建产生的"）。用户下次查询时得到的是被静默降级的图，却毫无察觉。

**Why this priority**: 影响所有安装了 post-commit hook 的用户（默认推荐路径），且是"文档承诺与实际行为不符"的诚信问题，但相比 P1（每次 MCP 查询都可能踩坑）触发频率略低（仅在 commit 时触发），故列 P2。

**Independent Test**: 在一个已完整建过全量图的临时工程中执行一次 commit（触发 hook），检查图产物在 commit 前后的内容差异；验证 hook 触发的操作不再产出信息量低于 commit 前的图，或者验证文档已如实描述其真实能力边界（不再声称"增量重建"）。

**Acceptance Scenarios**:

1. **Given** 一个已通过全量 batch 建出完整图的项目安装了 post-commit hook，**When** 用户提交一次含代码改动的 commit，**Then** hook 触发后的图内容不得比提交前信息量更少（不发生"好图被静默降级为贫图"的覆写）。
2. **Given** 用户查阅 README / CLI 参考文档中关于 post-commit hook 行为的描述，**When** 对照 hook 实际执行的命令与效果，**Then** 文档描述与实际行为一致，不再使用"增量重建"（incrementally rebuilds）等超出实际能力的措辞。
3. **Given** `plugins/spectra/hooks/post-commit.sh`（跑 `spectra index --incremental` 的独立路径），**When** 本项改动交付，**Then** 该文件与其行为不受影响（明确排除在本卡范围外）。

---

### User Story 5 - detect_changes 的使用者了解比较口径的边界 (Priority: P3)

一个调用 `detect_changes` 比较某个历史 commit 到当前状态改动的使用者，当前该工具用三点记法比较 `merge-base(baseRef, HEAD)...HEAD`，只能看到已提交的改动，工作树中尚未提交的改动完全不出现在结果里，但返回结果没有任何字段说明这一点，使用者可能误以为"未受影响"等同于"改动已完整评估"。

**Why this priority**: 影响范围窄（仅 `detect_changes` 一个工具的一种使用模式），且不是"给出错误结论"而是"结论范围未声明"，危害性低于 P1/P2，故列 P3。

**Independent Test**: 在一个有未提交工作树改动的仓库中调用 `detect_changes` 并指定 `baseRef`，验证返回结果中包含对比较口径（只覆盖已提交内容，不含工作树改动）的声明。

**Acceptance Scenarios**:

1. **Given** 仓库工作树中存在未提交的改动，**When** 调用 `detect_changes` 并指定某个历史 `baseRef`，**Then** 返回结果中声明本次比较的口径范围（已提交改动 vs 工作树改动），不隐含"结果已覆盖全部改动"的误导。
2. **Given** 工作树完全干净（无未提交改动），**When** 调用 `detect_changes`，**Then** 该声明可以是"无差异需要说明"的最简形式，不产生误导性噪声。

---

### Edge Cases

- **空图 vs 缺图 vs 损坏图的区分**：`nodes: []/links: []` 的空图（本卡新增判定通道）、graph.json 文件不存在（既有 `graph-missing` reason）、graph.json 内容无法 JSON 解析（既有 `json-parse-error` reason）三者必须落入不同的既有/新增通道，不得互相吞并或产生混淆的判定结果。
- **非 src 布局**：全量 batch 模式下模块派生静默产出 0 模块需可观测；`graph-only` 模式因不执行模块派生，行为不受影响，需在验收中显式区分这两条路径。
- **graph-only 与全量 batch 的差异**：本卡多项改动（(a)(b)(c)）只影响全量 batch 或独立命令路径，`graph-only` 路径需在每一项分别确认不受影响。
- **工作树脏但已提交部分干净**：`detect_changes` 的三点记法比较口径需要向使用者声明，即使工作树有未提交改动、已提交部分本身完全一致的情况也要如实反映"未检测到已提交改动"而不是隐藏"工作树还有未评估的改动"这一事实。
- **builder 戳不匹配但内容新鲜**：图是当前 commit 刚建出来的（内容新鲜），但记录的 builder 标识与当前工具版本不一致时，该信息只能作为 advisory 出现在 MCP 返回体里，不得让 `graph-quality` 的 pass/fail 判定因此翻转（裁决 1）。
- **fingerprint 缺失的旧图**：由未升级到指纹机制（F249 之前）的旧版本生成的图缺少指纹字段时，四分类逻辑需要有明确的兜底行为（不能因缺字段而抛错或误判为"陈旧"）。
- **外部边界调用方**：调用方存在于图解析范围之外（如第三方依赖包、未支持的语言文件）时，返回结果需要把这类情况与"确认没有调用方"区分开，即便图本身是新鲜且完整解析的。
- **byte-stable 回归**：本卡任何改动（尤其是返回体新增字段的取值来源）不得引入非确定性内容（时间戳、随机数、执行环境相关值）到 `graph.json` 产物中；连续两次生成 `graph.json` 的哈希值必须保持一致。
- **post-commit hook 改动后旧安装的兼容性**：已经安装了旧版 post-commit hook 脚本的项目，在升级到新版本前仍运行旧脚本行为；本卡只改变新安装/重新安装后生成的 hook 脚本内容，不追溯修改已安装到用户 `.git/hooks/` 的历史脚本文件本身（该文件由 git-hook-installer 在下次运行安装命令时重新生成）。
- **解析缺口/外部边界与图陈旧同时成立**（需求澄清子代理补充，2026-08-24）：Resolution Reason（①已解析为零/②解析缺口/③外部边界，三者互斥、择一呈现）与 Graph Freshness（④图陈旧）是**两个正交维度**，不是同一个枚举的四个互斥取值——参见 Key Entities 中"解析成因"与"图新鲜度"分属两个独立概念，FR-011 也已明确图陈旧是"追加式 advisory"。因此当"解析缺口/外部边界"与"图陈旧"同时成立时，MUST **两者都呈现**（Resolution Reason 字段给出①②③中确定的一个值，Graph Freshness 作为独立的 advisory 字段并行附加），不存在互相遮盖或需要二选一优先级的问题；`nextStepHint` 类文案在两者同时成立时应同时提及"该范围解析未完成"与"图已过期，建议重建"两层含义。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 全量 batch 建图流程 MUST 在模块派生环节检测到"实际扫描到的模块数量为 0 且项目并非有意为空"这一情况时，产生可观测的提示（而非静默返回空模块图），提示内容 MUST 引导用户了解如何指定实际的源码范围。`[必须]`（去掉后，非 src 布局用户会持续在毫无感知的情况下拿到误导性的空模块图，这正是本卡要解决的核心病症之一，无法降级为可选）。对应 User Story 3；覆盖 SSoT (a)。
- **FR-002**: `graph-only` 建图路径 MUST NOT 因 FR-001 引入的检测逻辑而产生任何行为变化（该路径按既有设计不执行模块派生）。`[必须]`（这是防止改动扩散到不应受影响范围的护栏，去掉会破坏既有稳定路径的行为承诺）。对应 User Story 3 验收场景 2；覆盖 SSoT (a) 边界声明。
- **FR-003**: post-commit hook 触发的操作 MUST NOT 使已存在的、信息量更完整的图产物被替换为信息量更少的图产物（即消除"好图被静默覆写为贫图"的行为）。`[必须]`（这是 fail-loud 链里唯一影响"默认推荐工作流"的一环，不修复则用户会持续在不知情的情况下丢失图质量）。对应 User Story 4 验收场景 1；覆盖 SSoT (b)。判定"信息量更少"MUST 以既有的、可复用的信息量代理指标为准（如节点数、边数等结构性计数指标，二选其一或组合，具体取哪个/如何组合留给 plan 阶段设计），不引入新的语义化质量评分体系（避免与 F217 六指标体系职责重叠）。
- **FR-004**: README 与 CLI 参考文档中描述 post-commit hook 行为的文案 MUST 与其真实执行效果保持一致，不得使用超出实际能力的措辞（如声称"增量重建"却实际不解析源码）。`[必须]`（文档失真是可独立观测、可独立修复的诚信问题，即便 FR-003 的行为修复本身也需要配套文案更新才能形成闭环）。对应 User Story 4 验收场景 2；覆盖 SSoT (b) 三处文案。
- **FR-005**: `plugins/spectra/hooks/post-commit.sh` 及其行为 MUST 保持不变（明确排除在本卡范围外，其执行的是独立的增量索引路径）。`[必须]`（这是范围边界声明，防止改动误伤不相关路径）。对应 User Story 4 验收场景 3。
- **FR-006**: `graph-quality` 命令 MUST 在检测到 `nodes` 与 `links` 均为空数组的图时，不得判定为 `pass`；该情况 MUST 归入既有的"无法正常评估/需要警示"类判定通道（与既有的 `graph-missing`/`schema-too-old` 等 reason 语义一致，即复用 `cannot-assess` 通道），并在退出码上体现非正常通过（复核确认：该通道既有 `exitCodeFor` 映射已是 exit 2，本卡无需新增退出码逻辑，只需把空图判入该通道）。`[必须]`（这是门禁类改动的核心诉求，是本卡里唯一直接堵住"安全假象"的一项，不可降级）。对应 User Story 2 验收场景 1；覆盖 SSoT (c)。
- **FR-007**: `graph-quality` 的判定结果（pass/fail/需警示 verdict 与对应退出码）MUST NOT 因图的 builder 戳信息（记录该图由谁/哪次构建产生）与当前工具版本不一致而单独翻转；builder 戳不匹配 MAY 作为记录/展示信息存在，但不得参与门禁判定逻辑。`[必须]`（这是 M10 裁决 1 的强制约束，违反会与既有 F261 设计冲突并造成"开发期天天红"的噪声）。对应 User Story 2 验收场景 2；覆盖裁决 1。
- **FR-008**: 对于非空且指标良好的图，`graph-quality` 的判定行为 MUST 与本卡改动前完全一致，不得引入新的误判 fail。`[必须]`（这是防止改动破坏既有正常路径的回归护栏）。对应 User Story 2 验收场景 3。
- **FR-009**: `impact` / `context` / `detect_changes` 三个 MCP 工具在返回"零结果"或"无已知调用方"类结论时，MUST 能够区分至少以下四种成因并让调用方感知区别：①图新鲜且解析完整、确实为零；②查询范围内存在未成功解析的部分（解析缺口）；③潜在结果存在于图覆盖范围之外（外部边界）；④图内容相对当前状态已过期（图陈旧）。这四种成因的具体呈现形式（字段名、数据结构）由后续 plan 阶段设计，本 FR 只约束"调用方能够区分它们"这一行为结果。**成因①②③三者互斥（同一次查询只归入其中一类 Resolution Reason），成因④与①②③正交、可与其中任一者同时成立**（图既可能"解析缺口"又"陈旧"，也可能"确认为零"但"陈旧"）；MUST NOT 因二者同时成立而只呈现其中一个、或产生需要人工判断"优先展示哪个"的歧义——两个维度须同时携带在返回结果中（见 Edge Cases 补充）。`[必须]`（这是本卡最高优先级的核心诉求，四分类是"诚实的零"的定义本身，缺一种成因会重新制造出一种新的"确定性口吻掩盖不确定性"的盲区）。对应 User Story 1 全部验收场景；覆盖 SSoT (d)。
- **FR-010**: 上述三个 MCP 工具返回体中现有的"下一步建议"类文案（如当前对 context 的"可能为顶层入口"、对 impact 的"检查 symbol ID 是否正确"、对 detect_changes 的"暂无上游调用方"）MUST 依据 FR-009 判定出的实际成因给出对应建议，不得在成因②③④已知的情况下继续输出"确认为零"式的确定性措辞；当②或③与④同时成立时，建议文案 MUST 同时体现两层含义（如"该范围解析未完成，建议先重建图；另图已过期，重建时会一并更新"）。`[必须]`（这是 FR-009 的行为闭环，没有它 agent 依然会读到误导性建议，即便底层字段已区分成因）。对应 User Story 1 验收场景 5；覆盖 SSoT (d) 的 nextStepHint 改写要求。
- **FR-011**: 图陈旧信息（如 `sourceCommit`/指纹与当前工作树不一致、工作树存在未纳入图的改动）在三个 MCP 工具的返回体中 MUST 以追加式（不影响既有字段与既有调用方行为）的 advisory 信息呈现，不得改变工具本身的成功/失败状态。`[必须]`（同时满足 FR-009 的成因④与向后兼容约束；若不满足追加式约束会破坏现有 MCP 客户端）。对应 User Story 1 验收场景 4；覆盖裁决 1 中"MCP 返回面以 advisory 暴露"的要求。
- **FR-012**: `detect_changes` 在使用 `baseRef` 参数比较模式时，返回结果 MUST 声明本次比较的口径范围（即：只反映两个已提交状态之间的差异，不包含当前工作树中尚未提交的改动）。该声明 MAY 复用既有的 advisory/warnings 类返回通道（若既有 warnings 数组的语义与追加式声明兼容），也 MAY 新增专用字段；两种做法均满足本 FR，具体选型留给 plan 阶段，唯一约束是必须满足 FR-013 的追加式要求。`[必须]`（这是唯一直接对应 SSoT (e) 的诉求，且是低成本、高透明度收益的一项）。对应 User Story 5；覆盖 SSoT (e)。
- **FR-013**: 本卡涉及的所有 MCP 返回体字段变更 MUST 为追加式扩展：不读取新增字段的既有消费方在改动前后行为保持一致，不得删除、重命名或改变现有字段的语义。`[必须]`（宪法 XIII 向后兼容硬约束，同时也是护栏，防止 FR-009/FR-010/FR-011/FR-012 的实现破坏现网集成）。对应全部 User Story；覆盖硬约束 5。
- **FR-014**: 本卡任何涉及 graph.json 产物内容的改动 MUST 保持 byte-stable：同一输入连续两次生成的 graph.json 文件哈希值一致，不得引入时间戳、随机数等非确定性内容。`[必须]`（这是既有 F249/F254 等多轮工作建立的不变量，一旦破坏会连带影响下游多个消费方与既有的 diff/指纹机制）。对应 Edge Cases「byte-stable 回归」；覆盖硬约束 3。

*说明：本卡范围严格对齐 SSoT 列出的 (a)–(e) 五项，未识别出可标注为 `[YAGNI-移除]` 的条目——每一项都直接对应 SSoT 中已实证的具体缺陷，且均已在派发前完成事实核实，不存在"面向假设性未来需求"的冗余项。*

### Key Entities *(include if feature involves data)*

- **解析成因（Resolution Reason）**：描述某次查询"零结果/无调用方"背后的真实原因，取值语义覆盖三类且互斥——已完整解析确认为零、解析缺口（scope 内存在未成功解析的文件/符号）、外部边界（潜在结果存在于图覆盖范围之外）。这是 FR-009 的核心概念之一；具体字段形态、命名、数据结构由 plan 阶段设计。
- **图新鲜度（Graph Freshness）**：描述图产物相对当前代码状态的时效性，包含图的来源 commit 标识、与当前状态是否一致、构建者标识是否匹配等维度；其中"构建者是否匹配"按裁决 1 只作为 advisory 呈现、不参与门禁判定。**图新鲜度与解析成因是两个正交维度**（不是同一枚举的第四个取值），二者可同时成立并须同时呈现（见 Edge Cases 补充、FR-009）。这是 FR-011 与 FR-007 共享的底层概念。
- **覆盖/边界维度（Coverage / Boundary Dimension）**：描述某次查询结果相对"完整答案"的覆盖程度，区分"查询范围内解析完整"与"查询范围内存在解析缺口"，以及"结果集是否可能被图覆盖边界外的实体截断"。这是解析成因中②③两类的量化基础。
- **空图/退化图判定通道（Degenerate Graph Verdict Channel）**：`graph-quality` 命令中用于处理"图技术上合法但内容退化（如全空）"情况的判定分支，需要与既有的 `graph-missing`/`json-parse-error`/`schema-too-old`/`schema-newer-than-supported` 等既有 reason 语义对齐、复用同一个既有 `cannot-assess` 通道（含其既有 exit 2 退出码语义）。这是 FR-006 的核心概念。
- **比较口径声明（Comparison Scope Declaration）**：`detect_changes` 返回结果中对本次改动检测覆盖范围（已提交 vs 工作树）的显式说明。这是 FR-012 的核心概念。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：在四种构造好的图状态（新鲜完整解析出零结果 / 解析缺口 / 外部边界 / 图陈旧）下分别调用 `impact`、`context`、`detect_changes`，每种状态下返回结果均可被人工或脚本判读为对应的且仅对应的成因类别，四种状态两两之间结果可区分（不产生歧义或混淆）；另需补充构造"解析缺口 + 图陈旧同时成立"的组合状态，验证两个维度均可在同一次返回中被判读到（对应 FR-009 正交性约束）。
- **SC-002**：构造 `nodes: []`/`links: []` 的空图 fixture 运行 `graph-quality`，判定结果不再是 `pass`；同时对既有正常图（本卡改动前后各跑一次）的判定结果保持逐字段一致（零回归）。
- **SC-003**：对一个真实的外部语料工程（`~/.spectra-baselines` 下的 baseline 工程之一，或对 `node_modules` 内某依赖包做抽样）执行本卡涉及的图构建/查询链路，做逐边/逐结果 A/B 对比（改动前 vs 改动后），确认新增的成因分类字段/advisory 信息不改变原有的调用方集合、影响面集合等既有核心结果（只做诚实化标注，不改变已有正确结果的内容）。一次性验证产物不入库，只保留可重复运行的对比脚本。
- **SC-004**：非 src 布局的最小构造工程跑全量 batch，能在人工审查产出（日志/命令输出/返回体，具体载体留给 plan）中在 10 秒内定位到"模块图为空且这是需要关注的情况"这一事实，而改动前该事实完全不可见（需要读代码或对比模块数量才能发现）。
- **SC-005**：安装 post-commit hook 的项目在提交含代码改动的 commit 前后，对比图产物的节点/边计数或等价的信息量指标，图信息量不发生"从完整解析结果退化为仅基于 .spec.md 缓存"的降级；同时 README / CLI 参考文档中相关描述经人工审阅确认与实际命令行为一致。
- **SC-006**：改动前后各生成一次 `graph.json`（相同输入、相邻两次运行），两次产物的内容哈希（或等价的确定性摘要）保持一致，确认未引入非确定性输出。
- **SC-007**：`npm run build`、`npx vitest run`、`npm run repo:check` 三项在本卡交付前全部零失败通过。

## Non-Goals / Out of Scope

- **`src/hooks/hook-installer.ts`**：不在本卡范围内（与 P0-D atomic-write 缺陷群重叠，属于另一张卡的文件边界）。
- **`src/utils/atomic-write.ts`**：不在本卡范围内（同上，P0-D 专属）。
- **`plugins/spectra/hooks/post-commit.sh`**：这是独立的 `spectra index --incremental` 路径，不受本卡影响（见 FR-005）。
- **P1-E 产品表面清扫**（如 `metadata.lineRange` 死功能、`graph_community` 死工具等）：属于后续 P1 轨道卡，不在本卡范围。
- **embedding / 检索内核 v1（P1-J）**：本卡不涉及相似度检索或 embedding 门控，`impact`/`context`/`detect_changes` 的结果集合本身不因本卡改动而扩大或缩小（裁决 2：相似度命中永不进 impact/context）。
- **fix-compliance 门禁证据源换代（P0-A）**、**Codex hooks 分发纠偏（P0-B）**：均为独立卡，不在本卡范围内，尽管它们与本卡同批（批次 1）派发。
- **F193 `graph-format-stale` 错误路径的语义改动**：本卡新增的 freshness 是成功路径上的 advisory 信息，与 `graph-format-stale`（旧绝对格式图导致的错误路径）是不同语义、不同触发条件的两套机制，本卡不得将二者合并，也不得把 `graph-format-stale` 降级为 advisory。
- **F217 六指标体系、F249 指纹机制、F254 自述面判据的既有逻辑改写**：本卡只新增判定通道与返回字段，不得修改这些既有机制的既定行为（除非是为了对齐/复用而做的最小接入）。
- **具体字段命名与数据结构设计**：spec 只定义语义要求（四分类、advisory、口径声明等"要什么"），字段名、JSON 结构、错误码等实现细节留给 plan 阶段。

## Constraints

1. **「诚实的零」四分**：空结果必须能区分①已解析为零②解析缺口③外部边界④图陈旧；①②③互斥、④与①②③正交可共存（见 FR-009）；`nextStepHint` 类文案不得继续往"没人调用"引导。字段形态由 plan 定。
2. **裁决 1（builder 戳只可见不判定）**：`graph-quality` 退出码不得因 builder 戳不一致翻转；MCP envelope 中 builder 不匹配信息只能是 advisory。
3. **byte-stable 不破**：graph.json 产物连续两次生成的哈希必须一致，不得引入时间戳/随机量。
4. **`spectra graph` 命令自身的"静默毁图"陷阱**（覆写好图为贫图）并入本卡范围（对应 FR-003）。
5. **向后兼容（宪法 XIII）**：MCP envelope 新增字段必须是追加式，不配置/不读取新字段的既有消费方行为不变。
6. **YAGNI（宪法 III）**：每个新增字段/抽象须有当前明确使用场景；不为假设性未来需求加配置项。
7. **诚实标注（宪法 IV）**：推断内容不得以确定性口吻呈现——既是本卡目标也是本 spec 自身写作要求。
8. **文件边界**：与 P0-D 卡同目录不同文件；禁止触碰 `src/hooks/hook-installer.ts` 与 `src/utils/atomic-write.ts`。
9. **验收口径**：图解析/返回面类改动验收必须带外部语料 A/B 第二口径（`~/.spectra-baselines` 下的 baseline 工程，或 `node_modules` 抽样逐边 diff）；一次性验证 dump 不入库，只留重算器脚本。
10. **提交前验证**：`npm run build` + `npx vitest run` + `npm run repo:check` 必须零失败（本 worktree 当前无 dist，vitest 前需先 build）。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：4（模块派生检测逻辑扩展 / post-commit hook 生成逻辑调整 / graph-quality 空图判定通道 / MCP 返回面成因分类与 advisory 拼装逻辑）——均为对既有模块的行为扩展，不新增独立模块/服务。
- **接口数量**：约 6（`buildModuleGraphForProject` 行为扩展 1 处、`git-hook-installer.ts` 生成的 hook 命令 1 处、`graph-quality` 判定分支 1 处、`impact`/`context`/`detect_changes` 三个 MCP 工具返回体各 1 处扩展）。
- **依赖新引入数**：0（全部复用既有能力：`buildCannotAssessReport`、`describeBuilderStamp`、`computeCollectorFingerprint`/`parseCollectorFingerprint`/`isValidCollectorFingerprint`/`fingerprintsEqual`，无新增外部依赖）。
- **跨模块耦合**：是——需要同时改动 `src/knowledge-graph/module-derivation.ts`、`src/hooks/git-hook-installer.ts`、`src/cli/commands/graph-quality.ts`、`src/mcp/agent-context-tools.ts`（及/或 `src/mcp/lib/response-helpers.ts`）等 4+ 个既有模块，且需要与既有的 F217/F193/F249/F254 判据保持语义对齐（不修改其行为但需理解其接口）。
- **复杂度信号**：存在 1 个——"四分类"判定逻辑属于轻量决策树/条件分支组合，非完整状态机；不涉及递归结构、并发控制、数据迁移。判定为存在 1 个复杂度信号（多因素分类决策逻辑，需要在 plan 阶段仔细设计判定优先级避免歧义组合，如"既有解析缺口又图陈旧"时如何呈现——本轮需求澄清已在 FR-009/Edge Cases 中给出正交共存的结论，plan 阶段无需再自行裁决该优先级问题，只需按"两者并列呈现"设计数据结构）。
- **总体复杂度**：**MEDIUM**（跨模块耦合成立 + 组件数 4 落在 3-5 区间 + 1 个复杂度信号，满足 MEDIUM 判定规则；未达到 HIGH 的任一阈值：组件未超 5、接口未超 8、复杂度信号未达 2 个）。
