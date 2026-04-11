# Feature Specification: F-094-07 Panoramic → Spec-Driver CLI 桥接

**Feature Branch**: `feature/089-skill-orchestration-split`
**Created**: 2026-04-11
**Status**: Draft
**Dependencies**: F-094-02（目录重组）、F-094-03（Generator 接口统一）
**Input**: Panoramic CrossPackageAnalyzer 与 spec-driver refactor-plan agent 能力桥接，以 CLI 子命令和 MCP tool 形式暴露结构化分析结果

---

## 用户场景与测试方案

### User Story 1 - CLI 跨包依赖分析（Priority: P1）

作为 spec-driver refactor-plan agent，我希望能通过 `reverse-spec panoramic cross-package --json` 命令获取结构化的跨包依赖分析结果（含循环依赖组、拓扑层级、统计信息），以替代当前基于 grep 的手工实现，从而获得更准确的 Tarjan SCC 循环检测和自动拓扑排序。

**优先级理由**：这是本 feature 的核心价值——将现有能力（CrossPackageAnalyzer）以标准接口暴露出来，直接解决 refactor-plan agent 的能力缺口。P1 Story 独立可交付：仅实现 CLI 子命令即构成 MVP。

**独立测试方案**：在 monorepo 项目根目录执行 `reverse-spec panoramic cross-package --json`，验证输出为有效 JSON 且包含 `hasCycles`、`cycleGroups`、`topologicalOrder`、`levels`、`stats` 字段，可被 `jq` 解析。

**验收场景**：

1. **Given** 当前目录为有效 monorepo 项目，**When** 执行 `reverse-spec panoramic cross-package --json`，**Then** 标准输出为格式正确的 JSON，包含 `hasCycles` (boolean)、`cycleGroups` (array)、`topologicalOrder` (string[])、`levels` (array)、`stats.totalPackages` (number)
2. **Given** 当前目录为有效 monorepo 且存在循环依赖，**When** 执行上述命令，**Then** 输出中 `hasCycles` 为 true，`cycleGroups` 包含至少一个元素，每个元素含 `packages` 和 `cyclePath` 字段
3. **Given** 当前目录为单包（非 monorepo）项目，**When** 执行上述命令，**Then** 进程返回非零退出码，标准错误输出包含可读的降级提示（"当前项目不是 monorepo，cross-package 分析不可用"）

---

### User Story 2 - MCP panoramic-query tool（Priority: P2）

作为通过 MCP 协议接入的 AI 代理，我希望能调用 `panoramic-query` tool，传入操作类型（`cross-package` / `architecture-ir` / `overview`）和项目根路径，获取对应的结构化分析结果，以便在对话上下文中执行架构感知推理。

**优先级理由**：MCP 接口使 panoramic 能力在 Claude Code 对话场景中可用，扩展了使用场景。依赖 P1 的业务逻辑共享 helper（`query.ts`），因此排在 P2。

**独立测试方案**：在 MCP 服务器启动后，调用 `panoramic-query` tool 并传入 `{ operation: "cross-package", projectRoot: "/path/to/monorepo" }`，验证返回内容为结构化 JSON 文本。

**验收场景**：

1. **Given** MCP 服务器已启动，**When** 调用 `panoramic-query` tool 并传入 `operation: "cross-package"` 和有效 `projectRoot`，**Then** 返回包含 `hasCycles`、`cycleGroups`、`topologicalOrder` 字段的 JSON 文本
2. **Given** MCP 服务器已启动，**When** 调用 `panoramic-query` tool 并传入 `operation: "architecture-ir"` 和有效 `projectRoot`，**Then** 返回包含 `elements`、`relationships`、`views`、`stats` 字段的 JSON 文本
3. **Given** MCP 服务器已启动，**When** 调用 `panoramic-query` tool 并传入无效 `operation` 值，**Then** 返回错误消息而非抛出未捕获异常
4. **Given** MCP 服务器已启动，**When** 调用 `panoramic-query` tool 传入单包项目的 `projectRoot` 并指定 `operation: "cross-package"`，**Then** 返回包含 `error` 字段的 JSON，描述降级原因

---

### User Story 3 - 输出格式合同文档（Priority: P2）

作为需要对接桥接输出的开发者或 agent，我希望有一份 `contracts/panoramic-bridge.md` 描述三种操作的 JSON 输出结构（字段名、类型、可选性），使我不需要阅读源码即可了解输出格式。

**优先级理由**：合同文档是接口稳定性的保障，避免调用方依赖内部实现细节。与 P1/P2 同步交付可避免日后漂移。排 P2 而非 P1 是因为不阻塞核心功能，但应在同一迭代内完成。

**独立测试方案**：文件 `contracts/panoramic-bridge.md` 存在，包含 `cross-package`、`architecture-ir`、`overview` 三节，每节描述关键字段的名称、类型和含义。

**验收场景**：

1. **Given** 合同文档已写入，**When** 查看 `contracts/panoramic-bridge.md`，**Then** 文档包含三个操作的字段说明，并标注 `schemaVersion` 字段
2. **Given** CLI 实现已完成，**When** 将 CLI 实际输出的 JSON 字段与合同文档对照，**Then** 所有必需字段均在合同中有记录，无未记录字段

---

### User Story 4 - CLI 帮助文本与子命令发现（Priority: P3）

作为初次使用的开发者，我希望执行 `reverse-spec --help` 或 `reverse-spec panoramic --help` 时能看到 `panoramic` 子命令的说明和可用操作列表，以便无需查阅文档即可了解可用能力。

**优先级理由**：帮助文本是基础可用性的一部分，但不阻塞核心功能。P3 允许在核心功能稳定后再完善文案。

**独立测试方案**：执行 `reverse-spec --help`，输出包含 `panoramic` 关键字；执行 `reverse-spec panoramic --help`，输出列出 `cross-package`、`architecture-ir`、`overview` 三个子操作及其简要说明。

**验收场景**：

1. **Given** CLI 已安装，**When** 执行 `reverse-spec --help`，**Then** 帮助文本中出现 `panoramic` 子命令条目
2. **Given** CLI 已安装，**When** 执行 `reverse-spec panoramic --help`，**Then** 列出三个子操作（`cross-package`、`architecture-ir`、`overview`）及各自的一行描述

---

### 边界场景

- **单包项目调用 cross-package**：系统必须在执行分析前检测 `workspaceType`，若为非 monorepo 项目则立即以友好错误消息退出（非零码），不得抛出未捕获异常。[AUTO-RESOLVED: 选择"返回友好错误"而非"返回空结构"，理由是空结构会让调用方误判为无依赖，而错误信息可明确告知原因]
- **projectRoot 路径不存在**：MCP tool 和 CLI 均应返回可读错误，描述路径无效，不得崩溃
- **IR Generator 产生 warnings**：ArchitectureIR 的 `warnings` 字段应透传到 CLI/MCP 输出中，不得静默丢弃
- **overview 操作在非 monorepo 项目的行为**：overview 不依赖 CrossPackageAnalyzer，在单包项目中应正常可用，降级行为仅针对 cross-package 操作

---

## 功能需求

### 功能需求清单

- **FR-001**：系统 MUST 在 CLI 中注册 `panoramic` 子命令，支持三个子操作：`cross-package`、`architecture-ir`、`overview`。**[必须]** `[追踪: US-1, US-2]`

- **FR-002**：系统 MUST 在执行 `cross-package` 操作时，先验证项目类型为 monorepo；若非 monorepo，以非零退出码终止并输出可读错误消息。**[必须]** `[追踪: US-1, Edge Case]`

- **FR-003**：系统 MUST 支持 `--json` 标志，使 CLI 输出机器可读的 JSON 到标准输出；未传 `--json` 时以人类可读 Markdown 格式输出。[AUTO-RESOLVED: `--json` 为显式标志而非默认，理由是与现有 CLI 其他命令保持一致的输出行为约定，且 Markdown 对开发者直接使用更友好] **[必须]** `[追踪: US-1]`

- **FR-004**：系统 MUST 注册 MCP tool `panoramic-query`，接受 `operation`（枚举：`cross-package` | `architecture-ir` | `overview`）和 `projectRoot`（字符串，必需）参数，返回对应的结构化 JSON 文本。**[必须]** `[追踪: US-2]`

- **FR-005**：系统 MUST 将 `cross-package`、`architecture-ir`、`overview` 三种操作的业务逻辑集中在共享 helper 中实现，CLI handler 和 MCP tool 均调用该共享 helper，不得各自重复实现分析逻辑。**[必须]** `[追踪: US-1, US-2，YAGNI 复用原则]`

- **FR-006**：`cross-package` JSON 输出 MUST 包含字段：`hasCycles` (boolean)、`cycleGroups` (array)、`topologicalOrder` (string[])、`levels` (array)、`stats` (object，含 totalPackages、totalEdges、rootPackages、leafPackages)。**[必须]** `[追踪: US-1, Blueprint 验收标准]`

- **FR-007**：`architecture-ir` JSON 输出 MUST 包含字段：`elements`、`relationships`、`views`、`stats`、`sourceTags`、`warnings`。**[必须]** `[追踪: US-2]`

- **FR-008**：`overview` JSON 输出 MUST 包含 `model` 字段（含 `sections`、`stats`、`moduleSummaries`）及 `warnings` 字段。**[必须]** `[追踪: US-2]`

- **FR-009**：系统 MUST 在 `contracts/panoramic-bridge.md` 中记录三种操作的 JSON 输出格式，包含字段名、类型、可选性说明及 `schemaVersion`。**[必须]** `[追踪: US-3]`

- **FR-010**：CLI 帮助文��� SHOULD 包含 `panoramic` 子命令的条目，以及三个子操作的简要���明。**[应当]** `[追踪: US-4]`

- **FR-011**：MCP tool `panoramic-query` 的 `projectRoot` 参数 MUST 为必需参数，调用方必须显式传入，不得从运行时上下文隐式推断。[AUTO-RESOLVED: 必需参数，理由是 MCP 调用上下文与 CLI 的 cwd 不同，隐式推断会导致不可预期的行为] **[必须]** `[追踪: US-2]`

- **FR-012**：CLICommand 类型扩展 MUST 通过在 `panoramic` 专属解析分支中使用 optional 字段方式实现，不得改变现有联合类型中其他成员的结构，以保持向后兼容。[AUTO-RESOLVED: 选择 optional 字段而非独立子类型，理由是最小侵入且与现有 parse-args.ts 模式一致] **[必须]** `[追踪: US-1, constitution 原则 XIII]`

- **FR-013**：`contracts/panoramic-bridge.md` 合同格式 MUST 采用 Markdown 表格描述字段（含名称、类型、是否必需、说明），不引入独立 YAML Schema 文件。[AUTO-RESOLVED: 选择 Markdown 描述而非 YAML schema，理由是与现有 contracts/ 目录其他文件格式一致，且当前只有 3 个输出类型，YAML schema 属于过早工程化] **[必须]** `[追踪: US-3]`

- **FR-014**：系统 SHOULD 支持集成测试，验证 `reverse-spec panoramic cross-package --json` 在真实项目结构下的输出格式符合合同定义。[AUTO-CLARIFIED: 从 MAY 升级为 SHOULD，与 Blueprint 验收标准对齐] **[应当]** `[追踪: Blueprint 验收标准]`

- **FR-015**：CLI `panoramic` 子命令 SHOULD 支持 `--project-root <dir>` 可选参数，允许指定分析目标目录；未传时默认使用 `process.cwd()`。[AUTO-CLARIFIED: 补充遗漏参数，与 Blueprint 方案概述对齐] **[应当]** `[追踪: US-1, Blueprint 方案概述]`

### 关键实体

- **panoramic CLI 子命令**：CLI 路由层的新分支，接受子操作名和 `--json` 标志，调用共享 query helper 后格式化输出
- **panoramic-query MCP tool**：MCP 服务器中的新 tool，接受 `operation` 和 `projectRoot` 参数，调用共享 query helper 后返回 JSON 文本
- **共享 query helper**：封装对 CrossPackageAnalyzer、ArchitectureIR builder、ArchitectureOverviewGenerator 的调用，是 CLI 和 MCP 的唯一业务逻辑来源
- **panoramic-bridge 合同**：`contracts/panoramic-bridge.md`，记录三种操作的 JSON 输出格式契约，含 `schemaVersion` 防止漂移

---

## 成功标准

### 可测量结果

- **SC-001**：`reverse-spec panoramic cross-package --json` 在有效 monorepo 项目中执行后，输出可被 `jq .hasCycles` 解析，返回布尔值，进程退出码为 0
- **SC-002**：MCP tool `panoramic-query` 注册成功，在 MCP inspector 或实际 Claude Code 对话中可调用并返回结构化 JSON 内容，不返回错误
- **SC-003**：`cross-package` JSON 输出中必须包含 `cycles`（即 `cycleGroups`）、`topologicalOrder`（即 `topologicalOrder`）、`stats` 三个顶层字段
- **SC-004**：`contracts/panoramic-bridge.md` 文件存在，包含对三种操作输出格式的字段级描述，并标注 `schemaVersion`
- **SC-005**：CLI 帮助文本（`reverse-spec --help` 输出）包含 `panoramic` 关键字
- **SC-006**：单包（非 monorepo）项目调用 `cross-package` 时，CLI 退出码非零，标准错误输出包含可读错误信息，不抛出未捕获异常
- **SC-007**：CLI handler 和 MCP tool 的业务逻辑通过共享 helper 实现，不存在重复的分析调用代码

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 / 描述 |
|------|------------|
| **组件总数** | 3 个新增组件：`src/panoramic/query.ts`（共享 helper）、`src/cli/commands/panoramic.ts`（CLI handler）、MCP tool 注册（追加到 `src/mcp/server.ts`） |
| **接口数量** | 2 处修改接口：`src/cli/utils/parse-args.ts`（扩展 CLICommand 类型 + 解析）、`src/cli/index.ts`（switch case + help text）；1 处新增接口：`contracts/panoramic-bridge.md` |
| **依赖新引入数** | 0：Thin Facade 模式直接调用现有 panoramic Generator，不引入新 npm 依赖 |
| **跨模块耦合** | 需修改 2 个现有文件（parse-args.ts、index.ts），但均为追加式修改，不改变现有分支逻辑 |
| **复杂度信号** | 无递归结构；无状态机；无并发控制；无数据迁移；CrossPackageAnalyzer 的 `isApplicable` 约束需在 query.ts 中显式处理（条件分支，非状态机） |
| **总体复杂度** | **LOW** |

**判定依据**：组件数 3（< 5）、接口数 3（< 4 新增，2 修改为追加型）、无复杂度信号，满足 LOW 判定条件。GATE_DESIGN 可自动放行，无需人工审查。

---

*本 spec 基于 `specs/094-07-panoramic-spec-driver-bridge/research/tech-research.md` 推荐方案 A（Thin Facade）生成，未超出调研报告推荐的 MVP 范围。*
*所有 `[AUTO-RESOLVED]` 标注共 4 处，未超过上限。FR-006 字段名以 `CrossPackageOutput` 实际源码类型为准，优先于 Blueprint 占位字段名（`cycles` → `cycleGroups`，`topologyLevels` → `levels`/`topologicalOrder`）。*

---

## Clarifications

### Session 2026-04-11

| # | 问题 | 决策 | FR 影响 |
|---|------|------|---------|
| C-00 | MCP 参数名 `operation` vs `analyzer` | 保留 `operation`，Blueprint 为示意性伪代码 | 无变更 |
| C-01 | CLI `--project-root` 参数遗漏 | 新增 FR-015 | FR-015（新增） |
| C-02 | Blueprint 字段名与源码不一致 | 以 spec/源码为准 | FR-006、SC-003 保持不变 |
| C-03 | FR-014 集成测试 MAY vs Blueprint | 升级为 SHOULD | FR-014 |
| C-04 | FR-010 SHOULD/[必须] 矛盾 | 统一为 SHOULD/[应当] | FR-010 |
