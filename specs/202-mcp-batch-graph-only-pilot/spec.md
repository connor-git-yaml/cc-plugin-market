# Feature Specification: MCP batch 工具 graph-only 模式 + goal_loop Pilot

**Feature Branch**: `202-mcp-batch-graph-only-pilot`
**Created**: 2026-06-20
**Status**: Draft

---

## 背景与双重目的

本 Feature 同时承担两个相互独立但刻意绑定的目标：

**载体任务**：补全 MCP `batch` 工具对 `graph-only` 模式的原生支持。这是 F195 落地时遗留的 W-001 缺口——CLI 路径已支持 `--mode graph-only`（纯 AST、零 LLM、无需认证），但 MCP 路径的参数枚举仍明确排除该模式，且 describe 文案直接提示"MCP batch 暂不支持 graph-only"。

**Pilot 目的**：全程启用 `goal_loop` override 跑本 Feature 的 implement 阶段，收集真实遥测数据，诚实回答"goal_loop 自主迭代闭环究竟跑通了吗"——坐实或推翻 F201 verify 报告中的 ⚠️ 未验证部分。

两个目的在 Success Criteria 中分区定义，不混淆。

---

## User Scenarios & Testing

### User Story 1 - MCP 客户端触发 graph-only 建图（Priority: P1）

使用 MCP `batch` 工具的 AI Agent 或开发者，希望快速生成项目知识图谱（纯 AST、零 LLM 调用），用于后续的 impact 分析和代码库导航。由于 graph-only 路径不经过任何 LLM 调用，它天然不依赖 LLM 凭据即可运行；其可测 oracle 为"零 LLM 调用"。

当前行为：向 `batch` 工具传入 `mode: 'graph-only'` 时，Zod schema 的枚举校验直接拒绝该值，报参数校验错误，请求无法到达 handler。

**Why this priority**: MCP 路径是 AI Agent 调用 Spectra 的主入口。CLI 已经支持 graph-only 但 MCP 不支持，造成能力不对称——Agent 无法在无 LLM 凭据的环境中用 MCP 完成建图。这是工具完整性缺口，具有独立交付价值。

**Independent Test**: 构造一个 MCP `batch` 调用，仅传入 `projectRoot` 和 `mode: 'graph-only'`，验证返回体中含有 `graphPath`、`nodeCount`、`edgeCount` 等图谱结果字段，且整个调用过程中零 LLM API 调用发生。

**Acceptance Scenarios**:

1. **Given** MCP `batch` 工具已注册、Zod schema 含 `'graph-only'` 枚举值，**When** 客户端传入 `{ mode: 'graph-only', projectRoot: '/path/to/project' }`，**Then** handler dispatch 到 `buildAstGraphOnly`，返回含 `graphPath`、`nodeCount`、`edgeCount`、`durationMs` 的 JSON 响应，整个调用链零 LLM 调用。

2. **Given** MCP `batch` 工具已更新，**When** 客户端传入 `{ mode: 'full' }`（原有模式），**Then** handler 走原有 `runBatch` 路径，行为与改动前逐字相同，无任何回归。

3. **Given** MCP `batch` 工具已更新，**When** 客户端传入 `{ mode: 'reading' }` 或 `{ mode: 'code-only' }`，**Then** 均走原有 `runBatch` 路径，行为不变。

4. **Given** 新版 MCP batch schema，**When** 工具 describe 文本被读取，**Then** 其中不再出现"MCP batch 暂不支持 graph-only"字样，取而代之的是准确描述 graph-only 的功能与定位。

---

### User Story 2 - goal_loop 自主驱动红→绿（Priority: P2）

作为 spec-driver 流程的 pilot 观察者，需要亲眼确认 goal_loop 能否在无人工干预的情况下，从"测试红"状态（MCP batch 不接受 graph-only 值）自主迭代到"测试绿"状态（改动通过），并在达成后触发 GATE_VERIFY 收口。

**Why this priority**: F201 已落地 goal_loop 核心逻辑，但 F201 verify 报告诚实标注了"⚠️ 未验证：真实 feature 的 goal_loop 端到端"。本 pilot 是第一个刻意设计的实证机会。pilot 结论属于开放问题，spec 不预设答案。

**Independent Test**: 在 implement 阶段开启 goal_loop override，观察并记录每轮迭代的 goal 评估结果、是否自主提交修复、是否在达成目标后退出循环；对照 SC-001～SC-003 分项记录实测结果。

**Acceptance Scenarios**（注意：以下断言的是"遥测被如实记录"，**不**断言 goal_loop 必然成功——pilot 结论开放）:

1. **Given** goal_loop 已在 feature mode 启用、红测试已预先定义，**When** implement 阶段执行，**Then** verify 报告如实记录每一轮 implement→verify 迭代实际发生了什么（改了什么、verify metric 退出码、goal-loop-cli decide-stop 裁决），无论结果是 REACHED_GOAL / continue / escalate / fallback。

2. **Given** goal_loop 完成 implement 阶段，**When** verify 报告生成，**Then** 报告诚实回答"红测试是否被驱到绿、用了几轮、是 REACHED_GOAL 还是 escalate"，并坐实或推翻 F201 verify 的 ⚠️ 未验证结论——若未跑通也须照实写。

3. **Given** goal_loop 已运行，**When** verify 报告生成，**Then** 报告专列「goal_loop 遥测」节，诚实记录：实际迭代轮数、每轮 decide-stop 裁决、是否踩降级路径（impact 注入因图谱 stale 而降级）、max_iterations / 无进展 fallback 是否触发、是否发生原子回滚——未触发的路径如实写"未触发 + 原因"，不硬凑。

---

### Edge Cases

**EC-001 graph-only 传入 languages 参数**
MCP 客户端向 graph-only 调用同时传入 `languages: ['typescript']`。`buildAstGraphOnly` 管线当前的行为与 CLI 一致：记录 warn 日志但仍对全仓执行建图（languages 过滤不适用于纯 AST 路径）。handler 不得因此报错或拒绝请求；返回的图谱是全仓建图结果，响应中可附带 warn 提示。

**EC-002 空源码仓**
目标仓库不含任何 AST 可解析源文件（如空目录或纯文档仓）。`buildAstGraphOnly` 已有"产空图不崩"的防护（EC-001 已在 F195 验证）；MCP handler 应透传该结果，返回 `nodeCount: 0`、`edgeCount: 0` 的合法响应，不抛异常。

**EC-003 graph-only 与 regen/incremental/force 参数共存**
MCP 客户端同时传入 `mode: 'graph-only'` 和 `incremental: true`（或 `force: true`）。`buildAstGraphOnly` 不走 regen 轴，这些参数对 graph-only 路径无意义。handler 在 dispatch 到 `buildAstGraphOnly` 时应忽略 regen 相关参数，不报错、不透传，避免将无关参数引入纯 AST 管线。

**EC-004 F196 description-output-drift 守卫**
mode 字段的 `.describe()` 属于 schema 内部文本，F196 守卫不扫描该层级。F196 扫描的是 `batch` 工具顶层 `description` 字符串中的 `Output:` 示例。顶层 Output 例当前定义为 `{ successful, skipped, failed, indexGenerated }`（BatchResult 的字段），graph-only 返回的专属字段（`graphPath`、`nodeCount`、`edgeCount`、`callEdgeCount`、`dependsOnEdgeCount`、`pythonSymbolCount`、`durationMs`）不属于 BatchResult，**不得**加入顶层 Output 例，否则 F196 守卫会检测到描述与实际产出不一致而报红。

**EC-005 goal_loop 无进展 fallback**
若 goal_loop 连续若干轮迭代后 goal 评分无改善（无进展信号），应按 F201 设计触发 fallback（退出循环 + 标注"未收敛"）。pilot 如未触发此路径（happy path），verify 报告应如实记录"未触发，原因：N 轮内已收敛"，不硬凑。

**EC-006 goal_loop 期间引入 regression**
若 goal_loop 某轮修改引入了其他测试的回归（非目标测试红），应触发 git 原子回滚到本轮修改前的状态。verify 报告须记录此事件是否发生及处置结果。

---

## Requirements

### Functional Requirements

**FR-001** `[必须]` MCP `batch` 工具的 mode 字段枚举 MUST 新增 `'graph-only'` 值，与现有 `'full'`、`'reading'`、`'code-only'` 并列。

**FR-002** `[必须]` mode 字段的 `.describe()` 文本 MUST 更新，移除"MCP batch 暂不支持 graph-only"字样，改为准确描述 graph-only 的定位：纯 AST、零 LLM、无需认证、仅建图不生成 spec 文档。

**FR-003** `[必须]` 仅 `server.ts` handler 内部解构的局部 TypeScript type union（`mode?: 'full' | 'reading' | 'code-only'`）MUST 新增 `'graph-only'` 成员，使其与 Zod schema 一致。**禁止**修改 `src/panoramic/qa/types.ts` 的 `BatchMode` 定义或 `runBatch` 的 `validModes`（见 Out of Scope）。

**FR-004** `[必须]` handler 在 `mode === 'graph-only'` 时 MUST dispatch 到 `buildAstGraphOnly`（复用现有实现，不重写），其他三种 mode 走原有 `runBatch` 路径，逐字不变。

**FR-005** `[必须]` graph-only 路径的 MCP 响应 MUST 沿用 `batch` 工具**现有**的返回形态——`{ content: [{ type: 'text', text: JSON.stringify(result) }] }`（batch 工具本就返回裸 `JSON.stringify(result)`，**无** `{code}` envelope；`{code}` 是 agent-context 等其他工具的契约，不适用于 batch）。graph-only 分支将 `GraphOnlyResult` 全字段（`graphPath`、`nodeCount`、`edgeCount`、`callEdgeCount`、`dependsOnEdgeCount`、`pythonSymbolCount`、`durationMs`）作为 `result` 序列化。即与既有 batch 返回路径同构，仅 `result` 内容因 mode 而异。

**FR-006** `[必须]` graph-only 路径产出的知识图谱 MUST 通过 F193 portable 守卫：绝对路径节点数为 0、`schemaVersion` 为 `2.0`、零 LLM 调用。

**FR-007** `[必须]` `full`、`reading`、`code-only` 三种模式 MUST 仍走原有 `runBatch` dispatch（调用参数构造逻辑不变），改动后全量 vitest 零失败；可测断言为：三 mode 各自的现有 MCP 测试保持绿，且 graph-only 分支不进入 runBatch 路径（dispatch spy 或等价断言）。

**FR-008** `[必须]` F196 description-output-drift 守卫 MUST 保持绿色。graph-only 专属返回字段（`graphPath` 等）**不得**写入 `batch` 工具顶层 `description` 的 `Output:` 示例区。

**FR-009** `[必须]` handler 在 graph-only 路径中忽略 `incremental`、`full`、`force` 等 regen 轴参数，不得将其传入 `buildAstGraphOnly`。

**FR-010** `[必须]` `mode === 'graph-only'` 时若同时传入 `languages` 参数，handler MUST 通过日志（`console.warn` / mcpLogger，与 batch handler 现有日志出口一致）发出"graph-only 不支持 languages 过滤，将全仓建图"提示，**不报错、不拒绝请求、不向 buildAstGraphOnly 传 languages**，返回全仓建图结果。warn 仅落日志，不污染 JSON 响应字段（避免触碰 F196 / 返回契约）。

**FR-011** `[可选]` pilot 期间 goal_loop 的 impact 注入在处理新写的 MCP 修改代码时，预建图不含该代码，SHOULD 踩降级路径（降级为无 impact 注入的通用提示）。verify 报告须实证记录此行为，不得美化。

**FR-012** `[可选]` pilot 结论中须诚实回答"每轮 graph-only 刷图"这一 M9 候选优化是否必要——若 impact 注入每轮都降级，则该候选必要性上升；若目标改动范围极小 loop 仍收敛，则可延后。

### Key Entities

- **GraphOnlyResult**：`buildAstGraphOnly` 返回的数据结构，包含 `graphPath`（图谱文件路径）、`nodeCount`、`edgeCount`、`callEdgeCount`、`dependsOnEdgeCount`、`pythonSymbolCount`（各类节点/边计数）、`durationMs`（建图耗时毫秒）。MCP handler 将其序列化为 JSON 返回给调用方。

- **BatchMode**（现有类型，`src/panoramic/qa/types.ts:16`）：当前 TypeScript union `'full' | 'reading' | 'code-only'`，不包含 `'graph-only'`。`graph-only` **不加入** BatchMode，因为 `runBatch` 的 `validModes` 不支持它；graph-only 作为独立分支在 handler 层提前拦截。

- **goal_loop 遥测记录**：pilot 阶段收集的实测数据。来源 = implement 阶段每轮的 goal-loop-cli `decide-stop` 输出 + trace。最小可审计字段（逐轮）：`iteration`（轮号）、`changed`（本轮改了什么）、`verifyExitCodes`（build/lint/test 退出码）、`decision`（REACHED_GOAL / continue / escalate_full / fallback）、`impactInjectionMode`（normal / degraded）、`fallbackTriggered`、`rollbackTriggered`。这是 verify 报告「goal_loop 遥测」节的必含内容，用于坐实或推翻 F201 未验证结论。

---

## Non-Functional & Constraints

**NFR-001 零回归约束**：`full`、`reading`、`code-only` 三 mode 的 MCP 调用路径不得有任何行为变更。全量 `npx vitest run` 零失败，`npm run build` 类型零错误，`npm run repo:check` 零报错。

**NFR-002 复用不重写**：`buildAstGraphOnly` 的实现逻辑不得在 MCP handler 中重写或复制。handler 仅负责 dispatch，所有建图逻辑保留在 `batch-orchestrator.ts` 的现有实现中。

**NFR-003 F196 不破坏**：`batch` 工具顶层 `description` 字符串中的 `Output:` 示例区内容不得因本次改动发生变化。graph-only 的返回字段仅体现在 mode 字段的 `.describe()` 文本和 handler 的分支逻辑中。

**NFR-004 MCP 响应契约不破坏**：batch 工具沿用其现有返回形态（裸 `JSON.stringify(result)`，见 FR-005）。使用 `{code}` envelope 的其他工具（agent-context / file-nav 等）契约、telemetry 上报逻辑、其余 16 个工具均不受本次改动影响。

**NFR-005 pilot 诚实性约束**：goal_loop pilot 的 verify 报告必须如实记录遥测数据。不得因结论不理想而美化输出、省略失败轮次或跳过未触发的路径。pilot 结论属于开放问题，spec 不预设"跑通"或"未跑通"。

---

## Success Criteria

### 载体任务验收标准

**SC-载体-001（TDD 红→绿）**：在改动前，针对 MCP batch 工具编写测试，调用 graph-only 路径后执行以下可测断言：(a) 从返回的 `graphPath` 读取写盘的 graph JSON 文件，断言 `schemaVersion === '2.0'`；(b) 遍历该 graph 的节点，断言绝对路径节点计数 = 0（F193 portable 守卫）；(c) 通过 spy / 无 LLM 凭据环境断言零 LLM 调用。改动前该测试必须红（schema 枚举拒绝 `'graph-only'`，请求到不了 handler）；改动后必须绿。
注：红态可能体现为 Zod 校验抛错（值被拒），测试需以"调用被拒/handler 未执行"作为红态判据，实现后转为上述 (a)(b)(c) 全绿。

**SC-载体-001b（describe 文案一致性）**：测试读取 `batch` input schema 的 `mode` 字段 `.describe()` 文本，断言 **不含** "暂不支持 graph-only" 旧文案，且 **包含** graph-only 的定位关键词（如"纯 AST""零 LLM"）。

**SC-载体-002（零回归）**：全量 vitest 套件在改动后零失败；`npm run build` 零类型错误；`npm run repo:check` 零报错；F196 守卫绿。

**SC-载体-003（schema 一致性）**：Zod schema、TypeScript type union、mode `.describe()` 文本三者关于 graph-only 的描述相互一致，无矛盾。

### goal_loop Pilot 验收标准

**SC-001（端到端闭环实证）**：verify 报告诚实记录 goal_loop 是否在本次 feature 的 implement 阶段实现了"自主识别红测试→自主提交修复→测试转绿→自主退出→触发 GATE_VERIFY"的完整闭环。对应 F201 verify 报告中"⚠️ 未验证"部分，本次给出坐实或推翻的实证结论。

**SC-002（fallback 路径实证）**：verify 报告记录 max_iterations 限制和无进展 fallback 是否在本次 pilot 中触发。若 happy path 内已收敛、两者均未触发，则如实记录"N 轮内收敛，fallback 未触发"，不需要刻意制造失败场景。

**SC-003（原子回滚实证）**：verify 报告记录 goal_loop 迭代期间是否发生过引入 regression 的轮次，以及是否触发了 git 原子回滚。若未发生则如实记录"未发生 regression，原子回滚未触发"。

**SC-004（impact 注入降级实证，FR-011/012 关联）**：verify 报告专项记录 goal_loop 每轮迭代中 impact 注入的实际行为：是否因预建图不含新写 MCP 代码而每轮都降级为无 impact 的通用提示；据此给出"每轮 graph-only 刷图"这一 M9 候选优化的必要性实证评估。

---

## Out of Scope

- **BatchMode 类型扩展**：`graph-only` 不加入 `src/panoramic/qa/types.ts` 的 `BatchMode` union，`runBatch` 的 `validModes` 不修改。
- **其他 MCP 工具改动**：除 `batch` 工具外的 16 个 MCP 工具均不在本次范围内。
- **graph-only 的 languages 过滤支持**：EC-001 描述的 warn 透传行为已足够，不在本次实现 languages 对 graph-only 的实际过滤。
- **buildAstGraphOnly 功能增强**：不修改 `batch-orchestrator.ts` 中 `buildAstGraphOnly` 的任何逻辑，仅新增 MCP dispatch 路径。
- **每轮 graph-only 刷图（M9 候选）**：SC-004 收集实证数据，但不在本 Feature 实现该优化；结论供 M9 决策参考。
- **goal_loop 自身的 bug 修复**：pilot 期间发现的 goal_loop 问题记录为后续 Fix 候选，不在本 Feature 内修复；verify 报告须为每个发现列出"复现条件 + 影响 + 建议后续 issue 标题"，便于分流。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估 |
|------|------|
| **代码组件** | 1（仅修改 MCP server.ts 的 batch 工具注册段）；测试与验证产物（TDD 红→绿测试、portable 断言、goal_loop verify 报告）另计 |
| **接口数量** | 2（Zod schema 枚举 + handler type union；buildAstGraphOnly 调用签名不变） |
| **依赖新引入数** | 0（buildAstGraphOnly 已在 batch-orchestrator.ts 中存在，仅新增调用路径） |
| **跨模块耦合** | 低（仅 server.ts 调用 batch-orchestrator.ts 的已有函数，无接口修改） |
| **复杂度信号** | 无（无递归结构、无状态机、无并发控制、无数据迁移） |
| **总体复杂度** | **LOW** |

判定依据：组件 < 3，接口 < 4，无复杂度信号。pilot 专属的 goal_loop 配置属于编排层覆盖，不计入代码复杂度。

---

## Clarifications

### Session 2026-06-20

无阻塞性歧义——spec 经 Codex 审查后已充分明确。

所有实现决策点（Zod schema 修改范围、handler dispatch 策略、MCP 响应格式、regen 参数忽略行为、F196 守卫边界、goal_loop 遥测字段）均已在 FR/NFR/EC/SC 各节中明确定义，无需额外澄清。
