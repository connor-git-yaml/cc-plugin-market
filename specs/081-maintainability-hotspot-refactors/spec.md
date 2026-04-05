# Feature Specification: 可读性与维护性热点重构

**Feature Branch**: `081-maintainability-hotspot-refactors`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: User description: "[$spec-driver-feature] 开始实施 081"

## User Scenarios & Testing

### User Story 1 - 热点生成脚本变薄且更可读 (Priority: P1)

作为维护者，我希望 `generate-product-scorecards.mjs`、`generate-product-quality-reports.mjs` 和 `generate-workflow-registry.mjs` 不再把参数解析、数据收集、规则计算、Markdown 渲染和文件落盘全部塞在单个入口文件里，这样我修改一个评分规则或报告段落时，可以直接定位到明确的 builder / renderer / orchestration 层。

**Why this priority**: 蓝图 076 把这三个脚本列为最高优先级热点；如果它们继续膨胀，078 刚建立的共享层会重新被大文件入口吞回去。

**Independent Test**: 运行 `workflow-registry`、`product-quality-reports` 和 `product-scorecards` 的相关 unit/integration tests，确认提取后的 core/builder/renderer 模块可独立测试，且脚本入口的 JSON / Markdown / YAML 合同不变。

**Acceptance Scenarios**:

1. **Given** `generate-product-scorecards.mjs` 目前同时承担规则加载、产品上下文拼装、rule evaluation、Markdown 渲染和索引回写，**When** 081 完成后维护者阅读该文件，**Then** 会看到一个以参数解析和主流程 orchestration 为主的入口，而非继续在文件底部混杂数百行 helper。
2. **Given** `generate-product-quality-reports.mjs` 和 `generate-workflow-registry.mjs` 当前同样内嵌大量领域 helper，**When** 081 完成后执行现有集成测试，**Then** 外部产物保持兼容，同时 builder / renderer 逻辑已经迁入可直接导入测试的共享模块。

---

### User Story 2 - init-project 启动脚本的阶段边界更清楚 (Priority: P1)

作为维护者，我希望 `init-project.sh` 能更清晰地表达“参数解析 / 目录初始化 / 模板同步 / 状态探测 / 输出渲染”的阶段边界，这样我调整初始化合同、JSON 输出或 `project-context` 处理时，不必在 400 行 Bash 中来回跳转。

**Why this priority**: `init-project.sh` 是 feature/story/fix/implement 流程的第一跳；它可读性差会直接放大整个 Spec Driver 链路的维护成本。

**Independent Test**: 运行 `tests/integration/spec-driver-init-project.test.ts` 以及 `tests/unit/init-command.test.ts` / `tests/integration/init-e2e.test.ts`，验证脚本文本输出、JSON 输出、模板同步和 CLI 接入仍正常。

**Acceptance Scenarios**:

1. **Given** `init-project.sh` 现在既维护状态变量、又拼 JSON、又处理模板复制和 skill 检测，**When** 081 完成后查看主流程，**Then** 各阶段会通过清晰函数或 shell helper 分离，输出渲染不再夹在初始化逻辑中间。
2. **Given** feature 流程依赖 `init-project.sh --json` 的现有字段合同，**When** 081 完成后执行现有集成测试，**Then** `NEEDS_CONSTITUTION`、`NEEDS_CONFIG`、`PROJECT_CONTEXT_MODE`、`RESULTS` 等字段仍保持兼容。

---

### User Story 3 - 热点重构后测试更容易补而不是更难写 (Priority: P2)

作为后续推进 082+ 的协作者，我希望热点脚本的关键行为可以通过更小粒度的 unit tests 直接覆盖，而不是每次都只能从黑盒 integration test 反推问题位置。

**Why this priority**: 蓝图 081 的验收标准之一就是“新增测试不会更难写”；如果重构完仍只能靠大而重的 CLI 集成测试，维护收益就不成立。

**Independent Test**: 为提取出的 core/builder/renderer 或 shell helper 增加专门单测，并验证新增单测不依赖全仓大 fixture 才能定位问题。

**Acceptance Scenarios**:

1. **Given** `scorecards / quality / workflow / init` 的复杂逻辑被拆分成更小模块，**When** 新增针对某个 builder、rule summarizer 或 output formatter 的测试，**Then** 测试可以直接导入该模块并用小 fixture 验证，不必每次都走完整 CLI 流程。
2. **Given** 081 只做热点重构，**When** 查看最终测试集，**Then** 会同时存在原有 integration tests 和新增的 targeted unit tests，而不是用重构替换掉回归覆盖。

### Edge Cases

- 当 `quality` / `scorecard` 的 preferred path 与 legacy path 同时存在时，重构后的 orchestration 仍必须保持当前优先级，不得因为模块拆分改变 fallback 语义。
- 当 scorecard rules 或 workflow overrides 中存在无效字段时，warnings contract 仍必须保持去重和稳定输出，不得在重构中改变 warning shape。
- 当 `init-project.sh` 同时遇到 `.specify/project-context.yaml` 与 legacy `.md` 时，dual/legacy/yaml 模式探测结果必须和当前脚本一致。
- 当某个热点脚本被拆分后，builder / renderer 发生异常时，入口脚本返回的 CLI 行为和 `--json` 合同仍必须可预测，不得引入只在模块内部可见的隐藏状态。
- 当 078 共享 helper 已能处理 YAML / IO / patch / diagnostics 时，081 不得重新在热点文件中新长出第二套同类 helper。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 针对蓝图 076 指定的四个热点文件 `generate-product-scorecards.mjs`、`generate-product-quality-reports.mjs`、`generate-workflow-registry.mjs`、`init-project.sh` 做小范围结构重构。
- **FR-002**: `generate-product-scorecards.mjs` MUST 将参数解析/主流程 orchestration 与规则加载、上下文拼装、评分、Markdown 渲染等领域逻辑分离到更小的共享模块中。
- **FR-003**: `generate-product-quality-reports.mjs` MUST 将文档引用收集、质量统计/冲突判断、Markdown 渲染等逻辑从入口脚本中拆分出来，入口文件以 orchestration 为主。
- **FR-004**: `generate-workflow-registry.mjs` MUST 将 workflow definition 读取、override 应用、golden path 读取与 Markdown 渲染从入口文件中拆分出来，入口文件只保留薄层 orchestration。
- **FR-005**: `init-project.sh` MUST 明确拆分参数解析、目录初始化、模板/scorecard 同步、状态探测和输出渲染阶段，降低主脚本的认知负担。
- **FR-006**: 081 MUST 优先复用 078 已提供的 `simple-yaml`、artifact IO、patch 和 diagnostics shared helpers，不得重新引入等价 helper 分叉。
- **FR-007**: 081 MUST 保持热点脚本现有 CLI 入口、参数、输出路径、JSON payload 关键字段和 Codex / Claude 兼容行为不变。
- **FR-008**: 081 MUST 不把整批 `.mjs` 热点脚本整体迁移到 `src/**` TypeScript，也不要求把 Bash 全量重写成 Node/TS。
- **FR-009**: 081 MUST 为提取出的核心 builder / renderer / evaluator / formatter 或 shell helper 增加 targeted unit tests，使新增测试不必总是依赖大集成用例。
- **FR-010**: 081 MUST 保留现有相关 integration tests，并在重构后继续通过，以证明对外合同未回归。
- **FR-011**: 081 MUST 只覆盖热点重构，不提前实现 079 的分发收敛、080 的版本/发布合同统一，亦不扩展新的产品级治理功能。
- **FR-012**: 081 SHOULD 让热点入口文件的行数和内联 helper 数量相对当前基线下降，并在 verification report 中记录重构前后对比。
- **FR-013**: 081 MUST 让文档、实现和测试之间的入口关系更清晰，即 spec / verification 能明确指出每个热点对应的核心模块和回归测试。

### Key Entities

- **HotspotScriptBaseline**: 记录四个热点脚本在 081 开始时的基线复杂度信息，如行数、主要职责和主要内联 helper 类别。
- **HotspotCoreModule**: 从热点入口文件中提取出的共享模块，承载 builder、evaluator、renderer 或 formatter 等单一职责逻辑。
- **ThinOrchestratorEntry**: 重构后的热点入口脚本，只负责参数解析、调用 core module、落盘和错误冒泡。
- **InitProjectPhase**: `init-project.sh` 的阶段划分单元，至少覆盖参数解析、目录准备、模板同步、状态检测和输出渲染。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 四个热点入口文件相对当前基线均出现可验证的复杂度下降，至少体现为更少的行数、内联 helper 数量或更清晰的阶段分层，并在 verification report 中记录。
- **SC-002**: `scorecards / quality / workflow / init-project` 至少新增一组 targeted unit tests 或等价小粒度测试，覆盖提取后的核心模块。
- **SC-003**: 现有相关 integration tests 持续通过，证明 `--json` 输出、Markdown/YAML 产物和初始化合同未回归。
- **SC-004**: `npm run lint`、`npm run build`、`npm test` 全部通过。
- **SC-005**: 维护者可以在 spec / verification 中直接找到“热点入口 -> 核心模块 -> 回归测试”的对应关系。

## Clarifications

### Session 2026-04-05

- [AUTO-CLARIFIED: 081 依赖 078 的共享层，但不重做 078 已完成的 YAML / IO / patch / diagnostics primitive]
- [AUTO-CLARIFIED: 081 的重点是热点脚本结构重构，不扩展新的用户能力、产品事实源或发布流程]
- [AUTO-CLARIFIED: `init-project.sh` 允许继续保留 Bash 形态，但必须把阶段边界收清楚，不要求整脚本迁移为 Node/TS]
