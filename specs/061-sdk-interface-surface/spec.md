# Feature Specification: SDK / Library Interface Surface

**Feature Branch**: `061-sdk-interface-surface`  
**Created**: 2026-03-22  
**Status**: Implemented  
**Input**: User description: "把库 / SDK 项目的接口文档和质量门对齐，用 Feature 的方式做"

---

## User Scenarios & Testing

### User Story 1 - 为库 / SDK 项目生成 public interface 文档 (Priority: P1)

作为阅读者，我希望 `reverse-spec batch` 在处理库 / SDK 仓库时，除了现有的模块 spec 和架构文档之外，还能输出一份聚焦公开入口、关键类、关键函数和关键方法的 `interface-surface` 文档，这样我不需要从多个模块 spec 里手工拼凑 SDK 的对外能力。

**Why this priority**: 当前真实样例 `claude-agent-sdk-python` 的主要缺口不是链路不可用，而是缺少面向库 / SDK 的统一接口层摘要；这是质量门误判的直接原因。

**Independent Test**: 对一个 Python SDK 或 Node library fixture 执行 batch，验证输出目录中出现 `interface-surface.md` 与 `interface-surface.json`，并包含公开模块、关键类/函数与关键方法摘要。

**Acceptance Scenarios**:

1. **Given** 一个带有 `pyproject.toml` 与模块 spec 的 Python SDK 项目，**When** 运行 `reverse-spec batch --force`，**Then** 输出目录中新增 `interface-surface.md` 和 `interface-surface.json`，内容聚焦公开入口与关键类型/方法。
2. **Given** 一个带有 `package.json` 的 Node library 项目，**When** 运行 project-level docs 编排，**Then** 文档会优先展示 `index.ts` / `__init__.py` / `client.ts` 等 entrypoint 模块，而不是 tests/examples。

---

### User Story 2 - Quality gate 不再把 SDK 项目按 HTTP API 项目误判 (Priority: P1)

作为维护者，我希望文档质量门对库 / SDK 项目要求的是 `interface-surface`，而不是只认 REST / OpenAPI 风格的 `api-surface`，这样像 `claude-agent-sdk-python` 这类项目不会因为没有 HTTP API 而被错误判为缺失关键文档。

**Why this priority**: 这是当前真实 E2E 中仍然存在的最明显误报，直接影响 `quality-report` 的可信度。

**Independent Test**: 用 library / SDK fixture 生成完整文档后，检查 `quality-report.json` 中 required docs 不再把 `api-surface` 标记为必需缺失，而是将 `interface-surface` 视为覆盖项。

**Acceptance Scenarios**:

1. **Given** 一个没有 OpenAPI / Express / FastAPI 入口但具备公开 SDK 导出的项目，**When** 生成 quality report，**Then** `interface-surface` 被计入 required docs，`api-surface` 不再作为该项目的必需缺失项。
2. **Given** 一个传统 HTTP API 项目，**When** 生成 quality report，**Then** 质量门仍然要求 `api-surface`，不会因为新增 `interface-surface` 而放松原有语义。

---

### User Story 3 - Docs bundle 面向接口消费者时同时兼容 API 与 SDK (Priority: P2)

作为文档消费者，我希望 `api-consumer` bundle profile 在 Web/API 项目里能看到 `api-surface`，在 SDK 项目里能看到 `interface-surface`，必要时两者都能被纳入，而不是只能消费一种接口文档形态。

**Why this priority**: docs bundle 已经是 055 的正式交付层，接口文档如果不进入 bundle，就无法真正成为可消费的交付物。

**Independent Test**: 对 bundle orchestrator 运行测试，验证 `api-consumer` profile 能按照文档存在性稳定组织 `interface-surface` / `api-surface` / `config-reference` / `data-model`。

**Acceptance Scenarios**:

1. **Given** `interface-surface.md` 存在而 `api-surface.md` 不存在，**When** 组织 `api-consumer` bundle，**Then** 导航中包含 `interface-surface.md` 且不会因缺少 `api-surface` 失败。
2. **Given** `api-surface.md` 与 `interface-surface.md` 同时存在，**When** 组织 `api-consumer` bundle，**Then** 两者都可被纳入，顺序稳定且不覆盖 landing page。

---

### Edge Cases

- 项目存在模块 spec，但全部来自 `tests/`、`examples/`、`scripts/` 等低信号目录时，`interface-surface` 必须保守降级，而不是把测试辅助函数当成公开接口。
- 项目是混合仓库，既包含 HTTP API 又包含 SDK/public exports 时，质量门需要同时识别 `api-surface` 与 `interface-surface` 的不同语义。
- 模块 spec 缺少 baseline skeleton 或 confidence 很低时，`interface-surface` 仍应输出保守摘要，并显式标注低置信度。
- 多语言库项目可能同时存在 Python 与 TypeScript 导出；接口文档需要保持统一展示，而不是只处理单语言。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `interface-surface` 项目级 generator，用于面向库 / SDK / public interface 项目的接口摘要文档生成。
- **FR-002**: `interface-surface` generator MUST 基于已生成的 module spec / baseline skeleton 汇总公开模块、关键类/类型、公开函数与关键方法，不新增新的底层语言 parser。
- **FR-003**: `interface-surface` generator MUST 对低信号目录（如 `tests/`、`examples/`、`scripts/`）降权或排除，优先展示 entrypoint / core 模块。
- **FR-004**: 系统 MUST 为 `interface-surface` 输出 Markdown 与 JSON，并通过 batch 项目级文档编排写入标准输出目录。
- **FR-005**: docs bundle `api-consumer` profile MUST 支持纳入 `interface-surface`，并在文档存在时保持稳定导航顺序。
- **FR-006**: quality evaluator MUST 将 `api-surface` 与 `interface-surface` 的 required-doc 规则区分对待：HTTP API 项目继续要求 `api-surface`，library / SDK 项目要求 `interface-surface`。
- **FR-007**: library / SDK 项目的识别 MUST 结合项目配置与现有文档事实，而不是仅凭 `api-surface` 是否存在。
- **FR-008**: 现有 HTTP API 项目的 `api-surface` 生成与 quality gate 语义 MUST 保持不变，不得因 061 弱化。
- **FR-009**: 真实样例 `claude-agent-sdk-python` 在完成 061 后，quality report MUST 不再把缺失 `api-surface` 作为 SDK 项目的主要失败原因。

### Key Entities

- **InterfaceSurfaceModule**: 公开接口文档中的模块级条目，记录模块角色、摘要、相关文件和公开符号集合。
- **InterfaceSurfaceSymbol**: 单个公开符号或关键方法，记录所属模块、owner、签名、说明和推断标记。
- **InterfaceSurfaceOutput**: `interface-surface` 文档的结构化输出，汇总模块、关键符号、关键方法和统计信息。
- **ProjectKindSignals**: quality gate 用于区分 `library-sdk` 与 `http-api` 的项目信号集合。

## Success Criteria

- **SC-001**: 在 library / SDK fixture 上执行 batch 后，输出目录中新增 `interface-surface.md` 与 `interface-surface.json`。
- **SC-002**: `interface-surface.md` 能列出至少 1 个入口模块、3 个公开符号和 3 个关键方法，且不会被 tests/examples 抢占前排。
- **SC-003**: 对 library / SDK fixture 生成的 `quality-report.json` 中，`interface-surface` 被标记为 covered，而 `api-surface` 不再作为该类项目的 required-doc 缺失项。
- **SC-004**: 对 HTTP API fixture 生成的 `quality-report.json` 中，`api-surface` 仍然是 required-doc，原有 `api-surface` 测试与 batch 集成语义保持通过。
- **SC-005**: 相关单测、集成测试、`npm run lint`、`npm run build` 全部通过，并在真实 `claude-agent-sdk-python` 样例上验证质量门改善。
