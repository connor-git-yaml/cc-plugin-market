# Feature Specification: 图质量门机器化（Graph Quality Gates）

**Feature Branch**: `217-graph-quality-gates`
**Created**: 2026-07-20
**Status**: Draft
**Input**: M9 §4 B2 — 把六个图质量指标变成机器可查的门禁信号：防回归、可诊断、不静默

## 摘要

`specs/_meta/graph.json`（GraphJSON）是 Spectra 知识图谱的最终消费产物，被 MCP 工具与 CLI 命令直接读取。当前该产物没有任何自动化质量门禁——重复 canonical ID、悬空边、覆盖率坍塌、图内容陈旧等问题只能靠人工肉眼核对或线上故障暴露。本 Feature 新增一个机器可解析的 `graph-quality` CLI 命令，把六项质量指标固化为可重复执行的检测逻辑，并把强不变量接入 `repo:check` 作为提交前门禁，覆盖 TS/JS、Python、Java、Go 四语言回归矩阵。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 维护者提交前自查图质量（Priority: P1）

维护者在改动了 AST parser、graph-builder、contains 边生成逻辑后，想在提交前确认这次改动没有让图产物劣化（引入重复 ID、悬空边、覆盖率下降），而不必手工翻 JSON 或凭经验猜测。

**Why this priority**：这是本 Feature 的核心防回归价值——没有它，图产物质量问题只能等到下游 MCP 工具返回错误结果时才被动发现，诊断成本高且定位困难。

**Independent Test**：在本仓库执行 `spectra graph-quality`（或对应 CLI 入口），可以独立验证——不依赖其他 User Story——命令能读取 `specs/_meta/graph.json` 并输出六项指标的 pass/fail 状态与人读摘要。

**Acceptance Scenarios**:

1. **Given** 仓库已建图且图质量六项指标均达标，**When** 维护者执行 `graph-quality` 命令，**Then** 命令输出总体 verdict 为 pass，人读摘要逐项列出六指标状态，exit code 为 0。
2. **Given** 仓库图产物中存在悬空边（edge 的 source/target 指向不存在的 node），**When** 维护者执行 `graph-quality` 命令，**Then** 命令输出该指标为 fail，并精确列出问题 edge 的 source/target/relation，给出修复方向提示（next-step），exit code 为 1（强不变量违反，参见 FR-014）。
3. **Given** 维护者对改动后的代码重新建图，**When** 执行 `graph-quality --json`，**Then** 输出为可被脚本/CI 解析的结构化 JSON，字段包含六指标各自的 pass/fail、数值、问题清单、总体 verdict。

---

### User Story 2 - CI / repo:check 自动拦截强不变量回归（Priority: P1）

CI 流水线或本地 `repo:check` 在提交前自动运行图质量检查；如果图产物出现"生产端天然保证应恒为 0"的强不变量违反（重复 canonical ID、悬空边），视为代码级 bug，直接挡住提交；其余四项指标先以 warning 形式提示，不阻断，避免磨合期误伤正常提交。

**Why this priority**：把质量门槛自动接入既有的提交前校验链路，是"不依赖人工记得手动跑检查"的关键——否则质量门禁形同虚设。

**Independent Test**：可以独立验证——在一个人为构造出重复 canonical ID 的图产物上运行 `npm run repo:check`，观察是否返回 error 且非零 exit code；在一个正常图产物但 orphan 率超标的场景下运行，观察是否返回 warning 但不阻断（exit code 0）。

**Acceptance Scenarios**:

1. **Given** `specs/_meta/graph.json` 不存在（干净 clone、未建图仓库），**When** 执行 `repo:check`，**Then** graph-quality 子检查被优雅跳过（既非 warning 也非 error），总体校验结果不受影响。
2. **Given** 图产物中存在重复 canonical ID 或悬空边，**When** 执行 `repo:check`，**Then** 该子检查返回 error，总体 `repo:check` 判定为 fail，exit code 非 0。
3. **Given** 图产物存在 contains 覆盖率不足 100%、orphan 率超过 5%、遗留 `#` 节点或 ignored 路径节点、或图内容 commit 级 stale（`graph.sourceCommit` 与当前 HEAD 不一致），**When** 执行 `repo:check`，**Then** 该子检查返回 warning，总体校验不因此 fail，提交不被阻断。
4. **Given** 图产物 `graph.sourceCommit` 与当前 HEAD 一致，但工作树存在未提交的源码改动（dirty），**When** 执行 `repo:check`，**Then** 该子检查不因 dirty 状态产生 warning（理由见 FR-026）。

---

### User Story 3 - 多语言场景下的图质量一致性验证（Priority: P2）

Spectra 维护者需要确认图质量门禁逻辑在 TS/JS 之外的语言（Python、Java、Go）也能正确工作，避免只在单语言 fixture 上通过、实际对多语言项目误报或漏报。

**Why this priority**：Spectra 是多语言代码库分析工具，图质量检测逻辑如果只验证过 TS/JS，会在真实多语言项目上留下未知风险；但这属于回归矩阵完善，不是 MVP 阻断项，故优先级低于 P1 的核心检测能力。

**Independent Test**：可以独立验证——对四语言各自的 pinned fixture 分别运行 `graph-quality`，确认命令能正确处理 Python/Java/Go 特有的 symbol 结构（如 Python 模块级函数、Java 类方法、Go 包级函数）而不误报。

**Acceptance Scenarios**:

1. **Given** TS/JS pinned fixture（复用 F215 `tests/fixtures/micrograd-baseline-graph/`），**When** 运行 `graph-quality` 回归测试，**Then** 六指标结果与预先人工推导的期望值一致（而非仅与上次快照比对，参见 SC-002）。
2. **Given** 新建的 Java 迷你项目 fixture 与既有 Go/Python fixture，**When** 运行 `graph-quality` 回归测试，**Then** 四语言场景下六指标均按预期判定（无跨语言误报/漏报）。

---

### Edge Cases

- **图不存在**：`specs/_meta/graph.json` 文件缺失时，CLI 命令直接给出明确的"未建图，请先运行 `spectra batch --mode graph-only`"提示（非静默失败），exit code 为 2（无法评估，参见 FR-014）；`repo:check` 场景下为 graceful skip（关联 FR-015、FR-017）。
- **图产物存在但 JSON 解析失败 / 结构损坏**：CLI 命令 MUST 明确报告"图产物损坏，建议重建"（`cannot-assess` 语义，非质量指标 fail），exit code 为 2；`repo:check` 场景下该情况 MUST 产生 warning（不是 skip——静默跳过会掩盖产物损坏；也不是 error——无法证明是代码级 bug 导致）（关联 FR-014、FR-027）。
- **非 git 仓库 / `git rev-parse HEAD` 执行失败**：图产物写盘时 `graph.sourceCommit` 字段写 `null`；门禁读取到 `null` 时判定为 `unknown-provenance` 分类，不等同于 `stale`，不应触发 stale 类告警文案（关联 FR-009）。**detached HEAD 场景不属于此类**——detached HEAD 下 `git rev-parse HEAD` 能正常解析出具体 commit SHA，应按正常 commit 记录，不写 `null`。
- **图产物由本 Feature 上线之前生成 / 旧版本 fixture（字段 `undefined`）**：`graph.sourceCommit` 字段不存在（`undefined`）时，与显式写入 `null` 同等判定为 `unknown-provenance`，不视为异常崩溃场景（关联 FR-010）。
- **图内容 commit 一致但工作树 dirty**：`graph.sourceCommit` 与当前 HEAD 一致，但 `git status --porcelain` 显示工作树存在未提交的源码文件改动时，CLI 报告 MUST 明确提示"图可能未反映未提交改动，如需精确请重建"（`dirty` 态，非静默判定为 `fresh` 完全等价）；`repo:check` 场景下该 dirty 态 MUST NOT 产生 warning（关联 FR-010、FR-026）。
- **空图（0 个节点）**：contains 覆盖率、orphan 率等指标分母为 0 时，判定为 `not-applicable`（既非 pass 也非 fail），避免除零或误报 100%/0% 假象（关联 FR-004、FR-005）。
- **orphan 全部落在例外分类中**：当 degree 为 0（不带任何 relation 的边，contains 边也计入）的 symbol 节点全部被 entrypoint / 纯类型声明 / 测试导出等例外规则覆盖时，orphan 率的"超标分子"为 0，即使原始 zero-degree 节点数量不小（关联 FR-005）。
- **四语言回归 fixture 依赖的源码 clone 缺失**：Java/Go/Python fixture 若依赖外部源 clone（环境变量控制，参照 F215 `MICROGRAD_SOURCE` 模式）不存在时，对应回归测试跳过而非失败，不阻断无该依赖环境下的验证链路（关联 FR-011）。
- **图产物存在但 `schemaVersion` 早于当前支持版本**：命令应识别版本不兼容并给出"图产物过旧，需重新建图"的明确提示，exit code 为 2（无法评估），而非以未定义行为静默产出错误指标值（关联 FR-013、FR-016）。
- **重复 canonical ID 与悬空边被检出**：输出必须包含足以定位问题的精确信息（如具体 canonical ID 字符串、涉及的多个 node id、悬空 edge 的 source/target/relation），而非仅报告"存在问题"的布尔值（关联 FR-002、FR-006）。
- **HEAD 在两次建图之间前进**：图产物写盘时记录的 `graph.sourceCommit` 与建图之后新增的提交不再一致时，命令必须明确报告 commit 级 stale，不得因为图产物本身格式合法而静默当作最新使用（关联 FR-009、FR-010，与 F193 加载期检测的分工见 CONSTRAINT-006）。

## Requirements *(mandatory)*

### Functional Requirements

#### 六项质量指标判定规则

- **FR-001**：系统 MUST 提供对 GraphJSON 中"语义重复 canonical ID"的检测——判定依据为归一化后的 `(文件路径, symbol 名, kind)` 三元组映射到一个以上不同的 canonical ID 字符串（涵盖遗留 `#` 分隔符与当前 `::` 分隔符共存场景）；重复数量必须为 0 才判定该指标 pass。`[必须]`
- **FR-002**：检测到重复 canonical ID 时，系统 MUST 在输出中列出每一组重复的三元组及其对应的所有 ID 字符串，供维护者定位具体冲突节点。`[必须]`
- **FR-003**：系统 MUST 计算"受支持 symbol 节点的 contains 覆盖率"——分子为存在至少一条 contains 入边的 symbol 节点数（`metadata.unifiedKind === 'symbol'` 的节点），分母为全部 symbol 节点数；覆盖率必须为 100% 才判定该指标 pass；当分母为 0 时判定为 `not-applicable`。`[必须]`
- **FR-004**：contains 覆盖率不达标时，系统 MUST 列出未被任何 contains 边覆盖的 symbol 节点 id 清单。`[必须]`
- **FR-005**：系统 MUST 计算"source symbol orphan 比例"——orphan 定义为 **degree 为 0（不带任何 relation 的边，contains 边也计入判定，即完全没有任何入边或出边）** 的 symbol 节点（权威口径来自 `docs/design/milestone-M9-codex-trusted-live-graph.md` §4 B2 实测注：本仓库 symbol 级 zero-degree 实测为 0.00%）；比例 = 未落入例外分类的 orphan symbol 数 / symbol 节点总数，必须 ≤ 5% 才判定该指标 pass；例外分类（entrypoint 文件如 `main.*`/`index.*`/`__init__.py`、纯类型声明如 interface/type、测试导出）不计入超标分子，但需在输出中单独计数呈现。当 symbol 节点总数为 0 时判定为 `not-applicable`。系统 MUST 在报告中额外附带展示**全节点级 zero-degree 率**（对齐 M9 doc 的"孤立率"口径，本仓库实测 1.78%，与文档记录的 1.9% 数量级一致），该数值仅作信息展示，不参与本项 pass/fail 门禁判定。`[必须]`
- **FR-006**：系统 MUST 检测 GraphJSON 中的悬空边——edge 的 `source` 或 `target` 指向图中不存在的 node id；数量必须为 0 才判定该指标 pass；检出时 MUST 列出每条悬空边的 source/target/relation 三元组。`[必须]`
- **FR-007**：系统 MUST 检测图中是否残留遗留格式 symbol 节点（使用 `#` 分隔符而非规范 `::` 分隔符的 canonical ID）；数量必须为 0 才判定该子项 pass。`[必须]`
- **FR-008**：系统 MUST 检测图中是否存在源自应被扫描器排除路径（`.gitignore` / 内置 ignore 规则命中的路径）的节点；数量必须为 0 才判定该子项 pass。FR-007 与 FR-008 共同构成"ignored path / 遗留引用节点 = 0"这一验证不变量。`[必须]`
- **FR-009**：系统 MUST 在建图写盘时，在**被分析项目根目录**（即 `batch` 命令的 target 目录，而非 Spectra 进程自身的 cwd）执行 `git rev-parse HEAD`，并将结果写入 GraphJSON 的 **`graph.sourceCommit`** 字段（类型 `string | null`）；若该目录不在 git 仓库中或 `git rev-parse` 执行失败，MUST 写入 `null`（不得抛出异常中断建图流程）；detached HEAD 场景下 `git rev-parse HEAD` 能正常解析出具体 commit SHA，MUST 按正常 commit 记录而非写 `null`。`[必须]`
- **FR-010**：系统 MUST 在质量门禁检测时比对 GraphJSON 的 **`graph.sourceCommit`** 与当前工作区 `HEAD`，并输出以下四态之一：
  - `fresh`（pass）：`sourceCommit` 与当前 HEAD 一致，且工作树无未提交的源码改动；
  - `dirty`：`sourceCommit` 与当前 HEAD 一致，但工作树存在未提交的源码改动（`git status --porcelain` 非空）——CLI 报告 MUST 明确提示"图可能未反映未提交改动，如需精确请重建"，不得静默等同于 `fresh`；
  - `stale`（fail）：`sourceCommit` 与当前 HEAD 不一致——输出 MUST 标明记录的 commit 与当前 HEAD 的差异；
  - `unknown-provenance`：`sourceCommit` 为 `null` 或字段缺失（`undefined`，如旧版本图产物）——既非 pass 也非等同于 stale 的 fail，需在输出与摘要中明确区分文案。
  禁止在内容陈旧或未反映未提交改动场景下静默判定为通过。`[必须]`

#### 命令形态与输出契约

- **FR-011**：系统 MUST 新增一个独立顶层 CLI 子命令 `graph-quality`（与 `direction-audit` 同级），默认执行模式下读取 `specs/_meta/graph.json` 并输出完整体检报告：六项指标各自的判定结果（pass/fail/not-applicable/unknown-provenance 等状态）、freshness 四态判定、人读摘要文本、针对每个 fail 项的 next-step 修复建议。`[必须]`
- **FR-012**：系统 MUST 支持 `--json` 参数，输出结构化、可被脚本/CI 解析的完整报告（六指标详情 + 问题清单 + freshness 四态 + 总体 verdict），字段结构在实现阶段（plan/tasks）固化为契约，供 `repo:check` 复用。`[必须]`
- **FR-013**：系统 SHOULD 支持轻量 `--status` 模式：仅输出图产物是否存在、freshness 判定、总体 verdict，用于快速健康检查场景，不逐项展开六指标细节。`[可选]`
- **FR-014**：命令 MUST 通过 exit code 传达总体判定结果，三档固定语义：
  - **exit 0**：命令完成完整评估，且无强不变量违反（可包含 warning 级问题，如覆盖率不足、orphan 超标、ignored/遗留节点、commit 级 stale、JSON 结构良好但内容有瑕疵等）；
  - **exit 1**：强不变量违反（重复 canonical ID / 悬空边，FR-001、FR-006）；
  - **exit 2**：命令无法完成评估（图产物不存在 / JSON 解析失败或结构损坏 / `schemaVersion` 低于支持的最低版本）。
  `[必须]`
- **FR-015**：系统 MUST 在图产物不存在时，`graph-quality` 命令给出明确的"未建图"提示与修复建议（如提示运行 `spectra batch --mode graph-only`），而非报错崩溃或空输出。`[必须]`
- **FR-016**：系统 MUST 在图产物 `schemaVersion` 低于当前命令支持的最低版本时，明确报告"图产物版本过旧，需重新建图"，不得以未定义行为静默给出误导性指标值。`[必须]`

#### repo:check 集成（三态语义）

- **FR-017**：系统 MUST 在 `repo:check` 中新增图质量子检查；当 `specs/_meta/graph.json` 不存在时，该子检查 MUST 优雅跳过（既不产生 warning 也不产生 error），不影响 `repo:check` 总体结果。`[必须]`
- **FR-018**：`repo:check` 中的图质量子检查 MUST 将重复 canonical ID（FR-001）与悬空边（FR-006）两项判定为 error 级别——违反时导致 `repo:check` 总体 fail、阻断提交。`[必须]`
- **FR-019**：`repo:check` 中的图质量子检查 MUST 将 contains 覆盖率（FR-003）、orphan 比例（FR-005）、ignored path / 遗留引用节点（FR-007、FR-008）、commit 级 freshness（FR-010 的 `stale` 态）四项判定为 warning 级别——违反时不阻断提交，仅在 `repo:check` 输出中提示。`[必须]`
- **FR-020**：图质量子检查的输出 MUST 复用 `graph-quality --json` 的结构化数据，避免在 `repo:check` 侧重复实现指标判定逻辑。`[必须]`
- **FR-021**：系统 SHOULD 为图质量子检查预留可扩展接口约定，使未来的 spec drift 检测（M9 轨道 C）能够以类似的 skip/warning/error 三态语义接入 `repo:check`，无需改动图质量子检查自身的判定逻辑。`[可选]`
- **FR-026**：`repo:check` 中的图质量子检查 MUST NOT 对 `dirty` freshness 态（FR-010）产生 warning。理由：提交前运行 `repo:check` 时工作树几乎必然处于 dirty 状态——待提交的改动本身就构成 `git status --porcelain` 的非空输出，若 `dirty` 触发告警，则每次正常提交流程都会产生噪音告警，门禁失去信噪比。`repo:check` 仅对 `stale`（commit 级不一致）产生 warning，对 `dirty` 保持静默（但 CLI 独立运行 `graph-quality` 时仍需按 FR-010 完整呈现 `dirty` 提示）。`[必须]`
- **FR-027**：`repo:check` 中的图质量子检查在遇到图产物 JSON 解析失败 / 结构损坏时 MUST 产生 warning（既不是优雅跳过，也不是 error）——不跳过是因为静默跳过会掩盖产物损坏本身这一异常信号；不升级为 error 是因为无法证明该损坏是当前改动引入的代码级 bug。`[必须]`

#### 多语言回归矩阵

- **FR-022**：系统 MUST 建立 TS/JS、Python、Java、Go 四语言的图质量回归测试矩阵；TS/JS 复用 F215 已有的 in-repo pinned fixture 机制（`tests/fixtures/micrograd-baseline-graph/`）。`[必须]`
- **FR-023**：系统 MUST 为 Java 语言新建可建图的迷你项目 pinned fixture（当前仓库无对应样本），规模与结构足以驱动六项指标在**正常路径**下的有效断言（即该 fixture 由生产链路真实建图产出，验证六指标在正常场景下全绿或按预期归类）。**异常检测路径**（重复 canonical ID、悬空边、ignored/遗留节点等强不变量违反场景）MUST NOT 依赖该 fixture 的生产链路自然产出——这些场景在当前生产链路结构上不可能自然产生（详见 Success Criteria 前置的"对抗测试诚实性说明"及 SC-003~SC-009），须由独立的 JSON 级构造 fixture 覆盖；正常路径 fixture 与异常构造 fixture 是两套并行的测试合同，不得混用。`[必须]`
- **FR-024**：系统 MUST 确认并在必要时补充 Python、Go 现有 fixture（`tests/fixtures/multilang-project/`）的规模，使其足以驱动六项指标的有效断言（而非仅语法样本级别的最小规模）。`[必须]`
- **FR-025**：四语言回归矩阵 MUST 遵循 F215 已确立的 SOP（校验源 commit → 只读拷贝 → `batch --mode graph-only` 建图 → 冻结拷贝入库），并在依赖的外部源缺失时优雅跳过而非失败。`[必须]`

### 回归护栏（作为显式约束）

- **CONSTRAINT-001**：图质量检测 MUST 仅通过纯 AST / 零 LLM 的 `graph-only` 建图链路验证，检测逻辑本身不得引入任何 LLM 调用依赖。`[必须]`
- **CONSTRAINT-002**：新增的 `graph.sourceCommit` 字段 MUST 遵循既有的 byte-stable 写盘规范（`normalizeGraphForWrite` 归一化出口），不得破坏图产物的确定性输出保证。**已知约束**：F215 pinned fixture 生成 SOP 使用的临时只读拷贝会剔除 `.git` 目录，因此这类 fixture 建图时 `graph.sourceCommit` 恒为 `null`（`unknown-provenance`）——这天然保证了 fixture 跨重生成过程的 byte-stable 不因 commit 值抖动而失效。`[必须]`
- **CONSTRAINT-003**：本 Feature MUST NOT 修改 UnifiedGraph 的 zod schema；`sourceCommit` 字段仅新增在 GraphJSON 的 TS interface（`graph-types.ts` 中的 `graph.*` 元数据结构，而非顶层 `metadata` 对象——GraphJSON 顶层是 `directed/multigraph/graph/nodes/links`，图级元数据统一挂在 `graph.*` 下）层。`[必须]`
- **CONSTRAINT-004**：本 Feature MUST NOT 触碰 `plugins/spec-driver/` 目录下的任何文件。`[必须]`
- **CONSTRAINT-005**：本 Feature MUST NOT 新增任何 MCP 工具；图质量检测能力仅通过 CLI 命令与 `repo:check` 暴露。`[必须]`
- **CONSTRAINT-006**：F193 的加载期格式/路径漂移检测（`assertGraphFormatNotStale`）与本 Feature 的内容 freshness 检测（FR-009/FR-010）职责边界 MUST 保持清晰分工、不重叠实现——前者判定图格式是否合规可加载，后者判定图内容是否与当前 HEAD 一致（含 commit 级 stale 与 dirty 提示两个子维度）。`[必须]`
- **CONSTRAINT-007**：F214 已确立的三层 canonical ID 合同（`::` 分隔符规范、`parseCanonicalSymbolId` 单点解析、加载期遗留节点判 stale）MUST NOT 因本 Feature 引入回归。`[必须]`

### Key Entities

- **GraphQualityReport**：一次 `graph-quality` 命令执行产出的完整体检结果，包含六项指标各自的状态（pass/fail/not-applicable/unknown-provenance）、问题清单、freshness 四态判定、全节点级 zero-degree 率（信息展示）、总体 verdict、人读摘要与 next-step 建议。
- **DuplicateCanonicalIdGroup**：一组语义重复的问题记录，包含归一化三元组 `(文件路径, symbol 名, kind)` 与对应的多个 canonical ID 字符串。
- **DanglingEdgeRecord**：一条悬空边的问题记录，包含 source/target/relation。
- **OrphanExceptionCategory**：orphan 节点例外分类的枚举（entrypoint / 纯类型声明 / 测试导出），用于将符合例外规则的 zero-degree（不带任何 relation 的边，含 contains）symbol 节点从超标分子中排除。
- **GraphFreshnessVerdict**：freshness 判定的四态结果（fresh / dirty / stale / unknown-provenance），关联记录的 `graph.sourceCommit` 值与当前 HEAD 的比对结果，以及工作树 `git status --porcelain` 的脏净状态。

## Success Criteria *(mandatory)*

### Measurable Outcomes

> **对抗测试诚实性说明**（适用于 SC-003~SC-009）：强不变量类劣化场景（重复 canonical ID、悬空边、ignored 路径节点、遗留 `#` 节点）在当前生产建图链路的结构性保证下不会被生产链路自然产出。以下对抗测试均通过**人为构造 / 篡改的 GraphJSON fixture**（在 JSON 层直接注入异常结构）来验证检测器本身的灵敏度与精确定位能力，而非验证"当前生产链路会产生此类问题"。这一测试路径的价值在于防御未来 producer 逻辑变更引入的回归，以及检测图产物在传输/存储过程中的损坏，spec 在此明确声明测试构造方式，不 over-claim 检测覆盖了当前生产链路的自然产出场景。

- **SC-001**：在本仓库自身的 graph-only 建图产物上运行 `graph-quality` 命令，六项指标均可机器判定输出（非人工目测），且当前仓库状态下六指标全部 pass（或按已知例外正确归类为 not-applicable）。
- **SC-002**：TS/JS、Python、Java、Go 四语言 pinned fixture 各自跑通完整回归矩阵；四语言矩阵的期望指标值 MUST 从各 fixture 源码人工推导并固化为断言（例如"Java fixture 含 N 个 symbol 节点、全部应有 contains 父边"），不允许仅断言"与上一次运行快照一致"这种无法验证正确性的弱断言。
- **SC-003（对抗测试 - 重复 canonical ID）**：基于人为构造的 GraphJSON fixture（含语义重复 canonical ID），`graph-quality` 命令 100% 检出该问题，并精确报告冲突的三元组与对应 ID 字符串。
- **SC-004（对抗测试 - 悬空边）**：基于人为构造的 GraphJSON fixture（含悬空边，source/target 指向不存在节点），命令 100% 检出，并精确报告问题边的 source/target/relation。
- **SC-005（对抗测试 - ignored 路径节点）**：基于人为构造的 GraphJSON fixture（含本应被扫描器排除路径的节点），命令 100% 检出该异常。
- **SC-006（对抗测试 - 遗留 `#` 节点）**：基于人为构造的 GraphJSON fixture（含遗留 `#` 分隔符 symbol 节点），命令 100% 检出该异常。
- **SC-007（对抗测试 - commit 级 stale 图）**：人为构造 `graph.sourceCommit` 落后于当前 HEAD 的图产物，命令 100% 判定为 `stale`（非静默通过），并在摘要中明确展示记录的 commit 与当前 HEAD 的差异。
- **SC-008（对抗测试 - contains 覆盖率坍塌）**：基于人为构造的 GraphJSON fixture（含未被 contains 边覆盖的 symbol 节点），命令 100% 检出并列出具体缺失覆盖的节点。
- **SC-009（对抗测试 - orphan 超标）**：基于人为构造的 GraphJSON fixture（zero-degree symbol 比例超过 5% 阈值且不落入例外分类），命令 100% 检出并报告超标比例与具体节点清单。
- **SC-010**：在 HEAD 前进（新增提交）但图产物未重新生成的场景下，`graph-quality` 命令必须报告 commit 级 `stale` 而非静默沿用旧图判定结果（覆盖 User Story 1 Acceptance Scenario 与 SC-007 场景的独立复验）。
- **SC-011**：`graph-quality` 命令在检出任一问题时，输出内容包含面向维护者的下一步修复建议文本（而非仅返回布尔失败状态）。
- **SC-012**：`repo:check` 在图产物缺失、JSON 损坏、强不变量违反、非强不变量问题四种场景下分别表现为 skip / warning / error（阻断）/ warning（不阻断），与 D3 决策及 FR-026、FR-027 的语义完全一致，可通过独立测试用例验证。
- **SC-013**：本 Feature 交付前，全量 `npx vitest run`、`npm run build`、`npm run repo:check` 均为零失败通过，且新增测试遵循 TDD（先写检测失败用例，再实现使其通过）。
- **SC-014（dirty 态验证）**：在 `graph.sourceCommit` 与 HEAD 一致但工作树存在未提交源码改动的场景下，独立运行 `graph-quality` 命令必须明确呈现 `dirty` 提示（非静默判定为 `fresh`）；而在同一场景下运行 `repo:check`，图质量子检查不产生 warning（验证 FR-010 与 FR-026 的组合行为）。

## Out of Scope

- 将图质量检测能力通过 MCP 工具暴露给 AI Agent 直接调用（留待后续 Feature 评估必要性）。
- Rename-follow（符号重命名后的血缘追踪）能力，不在本 Feature 范围内。
- Spec drift 的全仓库范围推断能力（M10 议题），本 Feature 仅为其预留 `repo:check` 接入的接口约定（FR-021）。
- 对 `UnifiedGraph`（构建期内存态）或 `SnapshotWrapper`（`.spectra/unified-graph.json` 增量缓存）产物的质量门禁——本 Feature 仅检测最终消费产物 `specs/_meta/graph.json`（GraphJSON）。
- Symbol 语义级别的相似度/相关性分析，本 Feature 六指标均为结构性/机械性判定，不涉及语义理解。
- 未提交改动的**内容级（content-level）freshness 指纹**（例如对工作树源码计算 hash 并与图产物比对到文件粒度）不在本 Feature 范围内；本期 freshness 边界为 **commit 级比对 + dirty 提示**（FR-009、FR-010），不做内容指纹级精确追踪，避免过度工程。
