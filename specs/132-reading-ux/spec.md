---
feature: F5 Reading UX
branch: 132-reading-ux
phase: spec
status: Draft
created: 2026-04-20
priority: P1/P2
---

# Feature Specification: F5 Reading UX — 轻量模式 + 自然语言问答 + graph.html 交互可视化

**Feature Branch**: `132-reading-ux`
**Created**: 2026-04-20
**Status**: Draft
**Input**: synthesis.md（产研汇总，来自 research 阶段）

---

## 背景与目标

当前 Spectra / batch-project-docs 存在三个用户痛点：

1. **无自然语言问答**：用户无法用自然语言提问代码库（"什么模块调用了 X？""X 对应哪个设计决策？"），只能手动检索图谱
2. **无交互可视化**：输出的 graph.html 是静态展示，节点不可交互，无法从可视化直接跳转到 spec 文件
3. **小项目资源浪费**：batch 流水线默认 full 模式，对只需查阅代码结构的轻量场景（如 5 文件项目）也会触发全量 spec 生成，耗时过长

本 Feature（F5）通过三条并行用户 Story 解决以上三个痛点，构成"阅读体验升级"这一完整产品能力。

---

## User Scenarios & Testing

### User Story 1 — 轻量批处理模式（Priority: P1）

**场景描述**：开发者面对一个只需快速了解代码结构的项目（无需深度 spec 推断），希望以最短时间获得代码层 blueprint。他通过 CLI 或 MCP 工具调用时传入 `--mode=reading` 或 `--mode=code-only`，系统跳过资源密集型的产品文档层生成器，仅输出代码层摘要。

**Why this priority**：轻量模式是 F5 的基础 pipeline 改造，Story 2（问答）和 Story 3（交互可视化）的命令行入口都依赖 `mode` 参数的存在。同时，它直接解决"小项目水土不服"痛点（synthesis §1 和 product §1.3 痛点 C），让 Spectra 可用于中小代码库。MVP 最小可行版本 = Story 1 + Story 2 同时交付。

**Independent Test**：可独立验证：对 graphify 示例项目（5 文件），执行 `batch-project-docs --mode=reading`，观察实际输出文件清单与耗时，不依赖 Story 2/3 的任何问答或可视化能力。

**Acceptance Scenarios**:

1. **Given** 用户在 CLI 调用 `batch-project-docs` 时不传 `mode` 参数，**When** 流水线运行，**Then** 系统以 `full` 模式运行（默认行为不变），输出完整的 blueprint + spec + 产品文档层摘要。

2. **Given** 用户传入 `--mode=reading`，**When** 流水线运行，**Then** 系统跳过"产品文档层生成器"（不生成 design-doc 推断内容），仅输出代码层 blueprint；命令行日志明确提示当前运行模式为 `reading`。

3. **Given** 用户传入 `--mode=code-only`，**When** 流水线运行，**Then** 系统在 `reading` 基础上进一步跳过"从 design-doc 推断内容"的所有生成步骤，输出纯代码结构摘要；命令行日志明确提示当前运行模式为 `code-only`。

4. **Given** 用户传入无效 `mode` 值（如 `--mode=fast`），**When** 流水线启动，**Then** 系统在启动阶段返回明确错误提示，列出有效枚举值（`full | reading | code-only`），并退出执行。

5. **Given** MCP `batch` 工具调用时带有 `mode: "reading"` 参数，**When** 工具执行，**Then** 行为与 CLI 等价，schema 校验通过，返回与 `reading` 模式一致的输出结构。

6. **Given** `--mode=reading` 对 graphify 示例项目（5 文件）运行，**When** 冷启动（无 SpecStore 缓存），**Then** 总耗时 < 300 秒（相对 full 模式 ~776s 节省 ≥ 60%）；**When** 热启动（有 SpecStore 缓存），**Then** 总耗时 < 60 秒（Q1 选项 A 已锁定）。

---

### User Story 2 — 自然语言问答（Priority: P1）

**场景描述**：开发者或架构师希望用自然语言查询代码库："什么模块调用了 AuthService？""从 UserService 到 Database 的调用路径是什么？""TODO: optimize 这个注释对应哪个设计决策？"。系统基于图谱（Graph-first BFS）+ 语义相似度（embedding 精排）+ LLM 组装，返回带溯源引用的简短回答。每次问答是独立单轮，无会话状态。

**Why this priority**：自然语言问答是 Spectra 超越 Graphify 最核心的差异化能力（synthesis §2 差异化点 1 和 3）。MVP = Story 1 + Story 2，两者共同构成本轮必须交付的最小可行产品。问答覆盖 5 类典型问题（代码调用关系、调用路径、设计决策映射、技术债查询、流程归属），并强制集成 F3 debt-scanner（最老 TODO 查询）和 F4 hyperedges（流程归属查询）的数据层。

**Independent Test**：可独立验证：安装完 Story 1 后（有 graph 数据），对 graphify 示例项目执行 5 类典型问答查询，逐一检查返回结果是否包含 `citation`（含 specPath + lineRange + excerpt），不依赖 Story 3 的可视化能力。

**Acceptance Scenarios**:

1. **Given** 用户提出"什么调用了 X"类型问题，**When** 系统处理问答请求，**Then** 返回的答案包含：（a）直接回答文本；（b）至少 1 条 `Citation`（含 `specPath`、`lineRange`、`excerpt` 三个字段）；（c）100% 的答案语句有对应引用，不出现无引用的断言。

2. **Given** 用户提出"从 X 到 Y 的调用路径"类型问题，**When** 系统处理，**Then** 答案按路径顺序列出每一跳的节点名称，并为每一跳提供 `Citation` 指向对应代码层 spec 文件的相关行。

3. **Given** 用户提出"X 对应哪个设计决策"类型问题，**When** 系统处理，**Then** 答案能引用 spec.md 中 `[conceptually_related_to]` 区块的内容（不仅是代码行），体现 F4 hyperedges 的价值暴露；Citation 的 `specPath` 指向 design-doc 层文件。

4. **Given** 用户提出"最老的 TODO"类型问题，**When** 系统处理，**Then** 答案直接来源于 F3 debt-scanner 数据（按 `ageDays` 倒序），返回 TODO 条目及其所在文件路径，Citation 可定位到具体代码行。

5. **Given** 用户提出"X 属于哪个流程"类型问题，**When** 系统处理，**Then** 系统利用 F4 hyperedges（`getHyperedges()`）的流程级关联数据回答，Citation 包含 hyperedge 来源文件的相关段落。

6. **Given** 图谱数据不足（BFS 命中节点数 < 3），**When** 系统处理问答，**Then** 系统降级到纯 RAG 路径继续尝试；若仍失败，则返回明确提示"图谱数据不足以回答此问题"，而非返回无引用的猜测性回答。

7. **Given** 问答单次 token 成本超过 $0.05 的 hardcode 上限，**When** 系统处理完问答，**Then** LLM 调用**不被阻断**（继续返回答案），但 `tokenUsage.overBudget` 标记为 `true` 供后续审计；日志输出 "[warn] qna token cost over hardcode limit, recorded only"（Q2 选项 C 已锁定）。

8. **Given** 用户发起问答，**When** 系统处理，**Then** 所有新 LLM 调用必须经过 F1 `runBudgetGate()` 并记录 `tokenUsage`，不允许绕过 budget 合规机制。

---

### User Story 3 — graph.html 交互可视化（Priority: P2）

**场景描述**：开发者打开 batch 生成的 `graph.html` 文件，看到的不再是静态节点图，而是可拖动、可搜索的力导向图。点击某个节点时，不只弹出一个详情框，而是直接打开该节点对应的 spec 文件（在 IDE 或默认编辑器中）。图文件本身是完全自包含（self-contained）的 HTML，零外部 CDN 依赖，可在无网络环境下使用。

**Why this priority**：交互可视化是 Spectra 超越 Graphify 的第二条差异化能力（synthesis §2 差异化点 2）。标注为 P2 的原因：Story 1+2 已构成 MVP，Story 3 不影响核心问答和轻量模式功能，可在实施阶段遇阻时降级为"最小可用"版本（节点拖动 + 搜索，暂缓 hyperedge 可视化），但不退出本轮 scope（synthesis §7 编排器裁决）。

**Independent Test**：可独立验证：使用已有 batch 输出数据（无需重新生成）直接更新 `graph.html` 模板，在浏览器中打开，验证节点可拖动、搜索框可过滤、点击节点有反馈行为，不依赖 Story 1/2 的问答能力。

**Acceptance Scenarios**:

1. **Given** 用户在浏览器中打开 batch 生成的 `graph.html`，**When** 页面加载完成，**Then** 节点以力导向布局渲染，用户可拖动任意节点调整位置；页面不依赖任何外部 CDN 资源（可在离线环境正常打开）。

2. **Given** 用户在搜索框输入模块名关键词，**When** 输入完成，**Then** 匹配的节点高亮或其余节点淡出，帮助用户定位目标节点；清空搜索框后恢复完整图显示。

3. **Given** 用户点击图中某个节点，**When** 点击事件触发，**Then** 系统触发打开该节点关联的 spec 文件的行为（具体打开方式——href 跳转、postMessage 到宿主 IDE 或其他——由 plan 阶段决定）；用户能观察到明确的响应（非静默）。

4. **Given** 用户点击节点后，spec 文件路径不存在或无法打开，**When** 打开行为触发，**Then** 系统在 graph.html 内展示友好的错误提示（如"spec 文件未找到：{path}"），而非浏览器报错或静默无响应。

5. **Given** 项目节点数量 < 2000，**When** graph.html 渲染，**Then** 力导向布局正常运行，节点可拖动，交互响应流畅（无明显卡顿）。

6. **Given** 项目节点数量 ≥ 2000（Q3 已锁定），**When** graph.html 渲染，**Then** 系统自动切换为静态坐标模式（关闭 force layout + 禁用拖动 + 启用 community 预计算坐标），页面顶部横幅提示"大图模式：部分交互受限"，生成日志输出 warning。

7. **Given** 生成的 `graph.html` 文件体积超过 5 MB（节点数据 + D3 + CSS 三合一内联），**When** 生成完成，**Then** 生成工具输出警告提示，但不阻断生成流程。

---

### Edge Cases

- **空图谱**：项目无任何节点时，问答返回"图谱为空，无法回答"；graph.html 展示空状态提示而非空白页面
- **单节点图谱**：图谱只有 1 个节点时，force layout 正常运行，问答调用路径类问题能给出"无路径"提示
- **问答查询为空字符串**：系统在入参校验阶段拒绝，返回明确错误，不进行 LLM 调用
- **问答查询过长**（如 > 2000 字符）：系统截断并提示，或拒绝并说明限制
- **Citation lineRange 越界**：`startLine` 或 `endLine` 超出文件实际行数时，系统记录警告并跳过该 citation，不导致整体问答失败
- **`--mode` 和其他 pipeline flag 冲突**：如 `--mode=code-only` 与 `--force-full-spec` 同时传入，系统以明确错误提示用户，不静默覆盖

---

## Requirements

### Functional Requirements

#### Story 1：轻量批处理模式

- **FR-001**：系统 MUST 支持 `mode` 枚举参数（`full | reading | code-only`），可在 CLI flag 和 MCP `batch` 工具 schema 两个入口传入 `[必须]`
- **FR-002**：系统 MUST 在不传 `mode` 参数时默认使用 `full` 模式，保持现有行为不变 `[必须]`
- **FR-003**：系统 MUST 在 `reading` 模式下跳过"产品文档层生成器"，仅执行代码层 blueprint 生成步骤 `[必须]`
- **FR-004**：系统 MUST 在 `code-only` 模式下在 `reading` 基础上进一步跳过所有"从 design-doc 推断内容"的生成步骤（具体清单由 plan 阶段产出，参见 synthesis §3.4）`[必须]`
- **FR-005**：系统 MUST 在传入无效 `mode` 值时，在启动阶段返回包含有效枚举值列表的错误提示并退出 `[必须]`
- **FR-006**：系统 MUST 在每次运行时于命令行日志中明确输出当前 `mode` 值 `[必须]`
- **FR-007**：`batch` MCP 工具的 schema MUST 新增 `mode` enum 参数，且与 CLI 行为完全等价 `[必须]`
- **FR-008**：`reading` 模式在 graphify 示例项目（5 文件）下的性能目标——冷启动 < 300 秒、热启动（有 SpecStore 缓存）< 60 秒；`code-only` 模式同等目标 `[必须]`（Q1 选项 A 已锁定）

#### Story 2：自然语言问答

- **FR-009**：系统 MUST 提供自然语言问答能力，接受用户自然语言查询并返回带引用的答案 `[必须]`
- **FR-010**：系统 MUST 采用 Graph-first BFS 命中候选 → embedding 精排 Top-K → LLM 组装的 B+C 混合架构（synthesis §1 已锁定）`[必须]`
- **FR-011**：系统 MUST 支持以下 5 类典型问题类型，每类有明确的检索路径和 Citation 层级 `[必须]`：

  | # | 问题类型 | 典型示例 | 主检索路径 | 数据源 | Citation 层级 |
  |---|---------|---------|-----------|--------|---------------|
  | 1 | 调用关系 | "什么调用了 storage？" | Graph BFS（inbound edges） | `graph.json` `references` 边 | 代码层 spec.md |
  | 2 | 调用路径 | "从 parse_file 到 save_processed 的调用路径？" | Graph 双端 BFS（source→target） | `graph.json` `references` 边 | 代码层 spec.md（每跳一条） |
  | 3 | 设计决策映射 | "handle_search 对应哪个设计决策？" | Graph BFS + hyperedge 反向查询 | `rationale_for` 边 + `hyperedges[]` | design-doc 层 + `[conceptually_related_to]` 区块 |
  | 4 | 技术债查询 | "项目最老的 TODO 是哪条？" | 按 `DebtReport.codeEntries.ageDays` 倒序 | F3 `scanProjectDebt()` 输出 | 代码行（debt entry 原位置） |
  | 5 | 流程归属 | "handle_search 属于哪个流程？" | `engine.getHyperedges({ nodeId })` | F4 hyperedges | hyperedge 来源文件的相关段落 |
- **FR-012**：系统 MUST 在每条答案中提供 100% 的 `Citation` 覆盖，每条 `Citation` 必须包含 `specPath`、`lineRange`（含 `startLine` 和 `endLine`）、`excerpt` 三个字段 `[必须]`（来自 synthesis §2 差异化点 1 和 3）
- **FR-013**：系统 MUST 能引用 spec.md 中 `[conceptually_related_to]` 区块（F4 hyperedges）的内容作为 Citation 来源，不仅限于代码行 `[必须]`
- **FR-014**：系统 MUST 在 BFS 命中节点数 < 3 时降级到纯 RAG 路径；若仍失败，则返回明确的"图谱数据不足"提示，不返回无引用的猜测性答案 `[必须]`
- **FR-015**：系统 MUST 对问答的每次 LLM 调用执行 F1 `runBudgetGate()`，并记录 `tokenUsage`，不允许绕过 budget 合规机制 `[必须]`（来自 synthesis §1 LLM 调用合规）
- **FR-016**：问答 MUST 为单轮无状态模式，不在服务端维护会话历史；多轮对话由调用方自行组装上下文 `[必须]`
- **FR-017**：问答每次调用 MUST 走 F1 `runBudgetGate()` 的 **record-only 模式**，hardcode 单次上限约 $0.05/query（估算 5k input + 1k output）；若超额，LLM 调用**不阻断**（继续返回答案），但在 `tokenUsage` 中标记 `overBudget: true` 供后续审计 `[必须]`（Q2 选项 C 已锁定）

#### Story 3：graph.html 交互可视化

- **FR-018**：系统 MUST 生成包含力导向布局的交互式 `graph.html`，用户可拖动节点 `[必须]`
- **FR-019**：系统 MUST 在 `graph.html` 内提供节点搜索/过滤功能，支持按名称关键词高亮节点 `[必须]`
- **FR-020**：系统 MUST 在用户点击节点时触发打开该节点关联 spec 文件的行为，并在 spec 文件不存在时展示友好提示（而非静默或浏览器报错）`[必须]`（来自 synthesis §2 差异化点 2）
- **FR-021**：`graph.html` MUST 为完全 self-contained 文件（CSS + D3 + 数据三合一内联），零 CDN 依赖，可在离线环境打开 `[必须]`（来自 synthesis §1 graph.html self-contained 决策）
- **FR-022**：系统 MUST 在节点数 ≥ 2000 时自动切换为静态坐标模式（关闭 force layout + 禁用拖动 + 启用 community 预计算坐标），并输出 warning；< 2000 节点启用完整 force layout 交互 `[必须]`（Q3 已锁定）
- **FR-023**：`graph.html` 节点数 ≥ 2000 时 MUST 顶部展示横幅"大图模式：部分交互受限（拖动已禁用）"，生成日志输出 `[warn] graph node count exceeds 2000, force layout disabled, using static layout` `[必须]`（Q3 已锁定）
- **FR-024**：系统 SHOULD 在生成的 `graph.html` 超过 5 MB 时输出警告（不阻断生成）`[可选]`

### Non-Functional Requirements

- **NFR-001 性能**：`reading` / `code-only` 模式的性能目标（Q1 选项 A 已锁定，基准为 graphify 示例 5 文件项目，full 模式 ~776s）：
  - **冷启动**（无 SpecStore 缓存）：`--mode=reading` < 300 秒、`--mode=code-only` < 300 秒
  - **热启动**（有 SpecStore 缓存）：`--mode=reading` < 60 秒、`--mode=code-only` < 60 秒
  - verify 阶段 MUST 实际测量并记录冷/热启动各自耗时；收益不足时退化为文档层跳过 + 日志提示（R5 缓解）

- **NFR-002 溯源强制**：所有问答答案的 Citation 覆盖率 MUST 达到 100%，即答案中每一条非引言性陈述都有对应 `Citation`；溯源跨越代码层 + 设计决策层两个维度（来自 synthesis §2 差异化点 1 和 3）

- **NFR-003 self-contained 约束**：`graph.html` MUST 零 CDN 依赖，所有资源（D3 bundle、CSS、数据 JSON）均内联于单一 HTML 文件，在无网络环境下可用（来自 synthesis §1 graph.html self-contained 决策）

- **NFR-004 Budget 合规**：F5 新增的所有 LLM 调用 MUST 走 F1 `runBudgetGate()` 并记录 `tokenUsage`，不得以任何方式绕过 budget 管控（来自 synthesis §1 LLM 调用合规）

- **NFR-005 降级韧性**：当图谱数据不足时，系统 MUST 按预定降级链路（BFS 失效 → 纯 RAG → 友好提示）处理，而非返回无引用猜测或崩溃

- **NFR-006 离线可用**：`graph.html` 及其所有交互功能（包括节点拖动、搜索、跳转）在离线环境下 MUST 完整可用（CDN 资源不在可用范围内，但 spec 文件跳转依赖本地文件系统）

---

## Key Entities

- **QnAQuery**：用户提交的自然语言问题，包含查询文本（字符串），以及可选的上下文（如目标模块名）；单轮无状态，无会话 ID

- **QnAAnswer**：问答系统返回的回答对象，包含：回答文本、`Citation` 列表（1 条或多条）、处理耗时、`tokenUsage` 记录；每条答案的 Citation 覆盖率须达到 100%

- **Citation**：溯源引用单元，包含：`specPath`（指向 spec 或代码文件的路径）、`lineRange`（含 `startLine` 和 `endLine`）、`excerpt`（相关原文片段）；来源可以是代码层文件或 design-doc 层文件（含 hyperedge 区块）

- **GraphContext**：问答 B+C 混合架构的中间态，包含：BFS 命中的候选节点列表、embedding 精排后的 Top-K 文档 chunk 列表、hyperedge 关联信息；作为 LLM 组装的输入上下文

- **BatchMode**：控制 batch-project-docs 流水线执行范围的枚举值（`full | reading | code-only`），决定哪些生成器被激活或跳过；存在于 CLI flag 和 MCP `batch` 工具 schema 两个入口

- **GraphHtmlOptions**：生成 `graph.html` 时的配置选项，包含：force layout 开关阈值（节点数 ≥ 2000 自动关闭，Q3 已锁定）、community 预计算坐标开关（大图模式启用）、self-contained 内联模式（MUST 始终开启）、文件体积警告阈值（默认 5 MB，见 FR-024）

---

## Success Metrics

### 可度量成果

- **SC-001 轻量模式性能**：对 graphify 示例项目（5 文件），`--mode=reading` 冷启动实测耗时 < 300 秒、热启动 < 60 秒；`--mode=code-only` 同等目标（Q1 选项 A 已锁定）

- **SC-002 问答覆盖率**：在 graphify 示例项目上，FR-011 表中 5 类典型问题各执行至少 3 次问答（共 ≥ 15 次），100% 的返回答案包含至少 1 条有效 `Citation`（含 `specPath` + `lineRange` + `excerpt`），零无引用答案

- **SC-003 graph.html 可用性**：生成的 `graph.html` 在主流浏览器（Chrome / Firefox / Safari）离线环境下可打开，节点可拖动，搜索框可用，点击节点有可观察的响应行为

- **SC-004 差异化点验证**：至少 1 次"X 对应哪个设计决策"问答返回的 Citation 指向 spec.md 中 F4 hyperedge 区块（`[conceptually_related_to]`），体现设计决策层溯源

- **SC-005 差异化点验证**：点击 graph.html 节点后，系统触发打开对应 spec 文件的行为（与 Graphify 停在"弹窗"相区别）

- **SC-006 Budget 合规**：F5 新增的所有 LLM 调用在 verify 阶段均可在日志中追溯到对应的 `tokenUsage` 记录，无绕过 budget-gate 的调用路径

- **SC-007 降级验证（R1）**：模拟 BFS 命中 < 3 节点的场景，系统能自动降级到纯 RAG 路径，最终返回结果或明确的"图谱数据不足"提示，无崩溃或无引用猜测

---

## Out of Scope

本 Feature（F5）明确不包含以下内容：

1. **F6+ 大规模图谱功能**：节点数 ≥ 2000 时本 Feature 已提供降级策略（FR-022/023），但完整大图渲染优化（如 WebGL、viewport culling、分层加载）留给 F6+
2. **GraphQL 接口**：不为问答或可视化引入 GraphQL 端点
3. **多轮问答 / 会话管理**：F5 问答严格单轮无状态，多轮对话组装由调用方负责，F5 不在服务端维护任何会话历史
4. **实时协同**：不支持多用户同时编辑 / 查看 graph.html 的协同场景
5. **问答的流式输出（streaming）**：F5 问答为批量返回，不实现 SSE 或 WebSocket 流式推送
6. **graph.html 的后端服务化**：graph.html 始终是静态文件，不引入 WebSocket 服务端或实时数据推送
7. **设计文档推断生成器精确清单**：`--mode=code-only` 跳过的具体生成器列表属于 plan 阶段产物（synthesis §3.4），不在本 spec 中定义

---

## Open Questions

所有 clarify 阶段的待澄清项均已解决，详见 `clarifications.md`。本 spec 的 FR/NFR/SC 已回填对应决策结果。

### Q1（P0 — 已解决 ✅）：性能目标场景定义

**决策**：选项 A — 分场景指标（冷启动 < 300s + 热启动 < 60s）
**依据**：Prompt 原始"< 120 秒"仅在 SpecStore 热启动下可达（冷启动主要耗时约 600s 在逐模块 spec 生成无法跳过）。分场景指标诚实展示 F5 的两种价值：冷启动相对 full 模式（~776s）节省 ≥ 60%，热启动节省 ≥ 90%。
**影响范围已回填**：FR-008、NFR-001、SC-001、Story 1 Acceptance Scenario 6

### Q2（P1 — 已解决 ✅）：问答的独立 budget 策略

**决策**：选项 C — hardcode $0.05/query，走 `runBudgetGate()` 的 record-only 模式，仅记账不阻断
**依据**：问答是交互级操作，"阻断"语义不合适；超额仅标记 `tokenUsage.overBudget: true` 供审计。
**影响范围已回填**：FR-017、Story 2 Acceptance Scenario 7

### Q3（P2 — 已解决 ✅）：graph.html 节点数上限策略

**决策**：< 2000 节点启用完整 force layout；≥ 2000 节点自动降级为静态坐标（关闭 force + 禁用拖动 + 启用 community 预计算坐标 + 顶部横幅 + 日志 warning）
**依据**：graphify 示例项目（5 文件）和 Spectra 自身仓库均 << 2000，覆盖 F5 主线场景；大图渲染优化留给 F6+。
**影响范围已回填**：FR-022、FR-023、GraphHtmlOptions、Story 3 Acceptance Scenario 5/6

---

## Risks & Mitigations

来自 synthesis §4，完整照搬并与本 spec 的 FR/Story 关联：

| # | 风险 | 关联 | 缓解措施 |
|---|------|------|----------|
| R1 | Graph-first BFS 命中节点数 < 3 时 RAG 精排失效 | FR-014，Story 2 AC 6 | Fallback 到纯 RAG（`anchorDocToCode` 路径）；再失败降级返回"图谱数据不足"提示 |
| R2 | `@xenova/transformers` 首次加载 5-15 秒 + 150-400 MB 内存 | Story 2，NFR-005 | 混合方案仅在 Top-K 精排阶段用 embedding；复用 F4 anchoring 已加载实例，避免重复初始化 |
| R3 | Hyperedge 问答语义对齐依赖 LLM 质量，召回可能不稳定 | FR-013，Story 2 AC 5 | 在 LLM prompt 中显式列出 hyperedge.label 作为候选，让 LLM 从列表中挑选而非自由发散 |
| R4 | graph.html 节点数 ≥ 2000 时 force layout 卡顿 | FR-022，Story 3 AC 6 | 节点数阈值检查：≥ 2000 自动切静态坐标模式（Q3 锁定，复用 `graph.communities[].center` 预计算坐标） |
| R5 | `--mode=reading` 实际性能收益低于预期 | NFR-001，SC-001，Q1 | verify 阶段实际测量冷/热启动耗时；收益不足时降级为文档层跳过 + 日志提示 |
| R6 | 问答 Citation 漂移到错误 chunk（chunk 边界 vs 语义边界不一致） | FR-012，NFR-002 | 强制 Citation 包含 `{startLine, endLine}`；verify 阶段 E2E 检查每条 Citation 可定位到实际 spec 行 |
| R7 | graph.html self-contained 时文件体积膨胀（500+ 节点数据 + D3 + CSS） | FR-021，FR-024，Story 3 AC 7 | 使用 gzip-friendly 的 minified JSON；超过 5 MB 时输出警告（不阻断） |

---

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：3 个新增模块（`src/panoramic/qa/` 问答模块、`BatchMode` dispatcher 扩展、graph.html 交互模板扩展）
- **接口数量**：4 个新增/修改接口（MCP `batch` 工具 schema + `mode` 参数、问答入口接口、`GraphHtmlOptions` 扩展、budget-gate 集成接口）
- **依赖新引入数**：0（所有依赖复用现有基线，synthesis §5 可复用组件清单）
- **跨模块耦合**：需要修改或扩展 3 个现有模块（`src/mcp/graph-tools.ts`、`src/panoramic/exporters/html-template.ts`、`batch-project-docs` dispatcher）
- **复杂度信号**：存在 1 个信号——B+C 混合问答的 BFS + embedding 精排 + LLM 组装的多步串联流程（类似状态机的阶段控制）
- **总体复杂度**：**MEDIUM**（组件 3 个 + 接口 4 个 + 1 个复杂度信号）
