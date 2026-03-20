# Feature Specification: API Surface Reference

**Feature Branch**: `codex/042-api-surface-reference`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "落地 Feature 042 API Surface Reference，固定使用编号 042，按 schema -> introspection -> ast 顺序生成 API Surface 文档"

---

## User Scenarios & Testing

### User Story 1 - 优先消费已有 OpenAPI / Swagger 产物 (Priority: P1)

作为项目维护者，我希望当仓库内已经存在 OpenAPI / Swagger 产物时，系统直接读取这些产物并生成 API Surface 文档，而不是重复做源码推断，这样我能得到最完整、最稳定的端点清单。

**Why this priority**: 这是 042 蓝图定义的首选路径，信息完整度最高，也是最容易满足“参数 / 响应 / 认证 / 标签”字段的方式。

**Independent Test**: 在一个同时包含 OpenAPI 文档和源码路由的项目上运行 `extract -> generate -> render`，验证 `source='schema'` 且输出端点来自 schema。

**Acceptance Scenarios**:

1. **Given** 项目包含 `openapi.json`，其中定义了多个 path 和 operation，**When** 运行 `ApiSurfaceGenerator`，**Then** 输出包含 HTTP 方法、路径、参数、响应类型、认证/标签，且每个端点的 `source` 为 `schema`。
2. **Given** path-level parameters 与 operation-level parameters 同时存在，**When** 解析 schema，**Then** 输出正确合并两类参数，不遗漏 path 参数。
3. **Given** 项目同时存在 OpenAPI 文档和 Express/FastAPI 源码，**When** 运行提取，**Then** 生成器优先使用 schema，不继续回退到 introspection 或 AST。

---

### User Story 2 - 静态解析 FastAPI / tsoa 原生元数据 (Priority: P1)

作为项目维护者，我希望在没有预生成 schema 的情况下，系统仍能从 FastAPI / tsoa 这类框架的原生声明中静态提取 API surface，而不需要启动服务或执行用户应用。

**Why this priority**: 蓝图明确把框架原生 introspection 作为第二优先级；这也是兼顾信息质量和安全性的主要路径。

**Independent Test**: 准备一个 FastAPI 或 tsoa 静态示例项目，验证生成器在没有 schema 时产出 `source='introspection'` 的端点集合。

**Acceptance Scenarios**:

1. **Given** 一个 FastAPI 项目，使用 `FastAPI`、`APIRouter`、路由装饰器和 `include_router()`，**When** 运行 `ApiSurfaceGenerator`，**Then** 输出完整路径、方法、参数、响应类型、标签和认证提示，且 `source='introspection'`。
2. **Given** 一个 tsoa controller，使用 `@Route`、HTTP 方法装饰器和参数装饰器，**When** 运行生成器，**Then** 输出对应的 REST 端点信息，且 `source='introspection'`。
3. **Given** 项目没有标准 schema，但同时存在 FastAPI 和 Express 源码，**When** FastAPI 静态元数据足够产出端点，**Then** 生成器停止在 introspection 层，不继续进入 AST fallback。

---

### User Story 3 - 无 schema 时 Express AST fallback 仍覆盖全部端点 (Priority: P1)

作为 Express 项目的维护者，我希望即使项目没有 OpenAPI 文档，也没有 tsoa/FastAPI 装饰器，系统仍能通过静态 AST 分析列出全部方法和路径，这样至少能得到可靠的基础 API 清单。

**Why this priority**: 这是蓝图的最后兜底路径，也是 042 验收中最明确的回退要求。

**Independent Test**: 构造一个包含 10+ 路由、跨文件挂载和 `router.route()` 链式调用的 Express 项目，验证输出覆盖全部端点方法和路径。

**Acceptance Scenarios**:

1. **Given** 一个包含 `app.use('/api', usersRouter)`、`router.get()`、`router.post()` 和 `router.route('/x').get().patch()` 的 Express 项目，**When** 运行生成器，**Then** 输出中包含所有方法和完整挂载后的路径，且 `source='ast'`。
2. **Given** Express 路由分布在多个文件并通过 import 挂载，**When** 运行 AST fallback，**Then** 生成器正确拼接 mount prefix，不遗漏跨文件子路由。
3. **Given** 某些 Express route 仅能静态识别到方法和路径，**When** 输出文档，**Then** 响应类型允许退化为 `unknown`，但结构字段仍完整存在。

---

### User Story 4 - 在 panoramic registry 中可发现并渲染 (Priority: P2)

作为 reverse-spec 的使用者，我希望 `ApiSurfaceGenerator` 能被现有 `GeneratorRegistry` 自动发现，并使用统一模板渲染输出，这样它能自然进入 panoramic 能力集合而不需要专门开分支调用路径。

**Why this priority**: 042 不是单独工具，而是 panoramic 架构中的新增 generator；不接入 registry 就无法交付。

**Independent Test**: 调用 `bootstrapGenerators()` 后通过 registry 查询 `api-surface`，并验证 `render()` 产出的 Markdown 包含 API 表格。

---

### Edge Cases

- **项目存在多个 schema 文档**：系统应稳定按文件名优先级挑选或聚合解析结果，避免重复端点。
- **OpenAPI path item 与 operation 同时声明参数**：应去重合并，而不是重复输出同名参数。
- **FastAPI `include_router()` 叠加 prefix/tags/dependencies**：系统应把父层 prefix 和元数据合并到最终端点。
- **Express `app.use()` 同时挂载中间件和子 router**：系统应保留 auth 中间件提示，并继续解析子 router。
- **项目无任何可识别 API 描述**：`isApplicable()` 返回 false，或 `extract()` 返回空端点集合且不抛异常。
- **动态路径 / 变量路径**：静态无法解析的表达式应跳过或降级为未知，不得伪造路径字符串。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 实现 `DocumentGenerator<ApiSurfaceInput, ApiSurfaceOutput>` 接口，遵循 `isApplicable -> extract -> generate -> render` 生命周期。
- **FR-002**: 系统 MUST 按 `schema -> introspection -> ast` 的固定优先级选择 API 抽取来源。
- **FR-003**: 系统 MUST 优先读取项目内现有 OpenAPI/Swagger 产物，并在命中时将所有端点 `source` 标记为 `schema`。
- **FR-004**: 系统 MUST 从 schema 中提取 HTTP 方法、路径、参数、响应类型、认证信息和标签。
- **FR-005**: 系统 MUST 在无可用 schema 时，静态解析 FastAPI / tsoa 原生元数据，不启动服务、不执行用户应用。
- **FR-006**: 系统 MUST 在 introspection 场景下支持 FastAPI 的 `FastAPI`/`APIRouter`/路由装饰器/`include_router()` 组合。
- **FR-007**: 系统 MUST 在 introspection 场景下支持 tsoa 的 `@Route`、HTTP 方法装饰器和参数装饰器。
- **FR-008**: 系统 MUST 在 schema 和 introspection 均不可用时，对 Express 项目执行 AST fallback。
- **FR-009**: 系统 MUST 在 Express AST fallback 中识别 `express()`、`Router()`、`router.route()`、`app.use()` 和 `router.use()` 的挂载关系。
- **FR-010**: 系统 MUST 在无标准 schema 的 10+ Express 路由项目中覆盖全部端点方法和路径。
- **FR-011**: 系统 MUST 为所有端点输出统一结构，至少包含 `method`、`path`、`parameters`、`responseType`、`auth`、`tags`、`source`。
- **FR-012**: 系统 MUST 使用 `templates/api-surface.hbs` 渲染 Markdown 文档。
- **FR-013**: 系统 MUST 在 `bootstrapGenerators()` 中注册 `ApiSurfaceGenerator`，并提供稳定 id `api-surface`。
- **FR-014**: 系统 MUST 保持与现有 panoramic 输出格式约定兼容，支持 `markdown/json/all` 三种输出模式。
- **FR-015**: 系统 SHOULD 在输出中给出来源摘要和端点统计，便于快速核验。
- **FR-016**: 系统 SHOULD 对静态无法判定的响应类型显式标记为 `unknown`，而不是省略字段。

### Key Entities

- **ApiSurfaceInput**: `extract()` 的输出，包含项目名称、选中的来源类型、端点数组和来源文件列表。
- **ApiEndpoint**: 单个 API 端点，包含方法、路径、参数、响应、认证、标签、来源和来源文件。
- **ApiParameter**: 单个参数，包含名称、位置（path/query/body/header/cookie）、类型、required。
- **ApiSurfaceOutput**: `generate()` 的输出，包含排序后的端点、统计摘要和模板渲染所需字段。
- **ApiSurfaceGenerator**: 042 的具体 generator，实现三层抽取链并接入 `GeneratorRegistry`。

### Traceability Matrix

| FR | User Story |
|----|-----------|
| FR-001, FR-012, FR-013, FR-014 | US4 |
| FR-002, FR-003, FR-004 | US1 |
| FR-005, FR-006, FR-007 | US2 |
| FR-008, FR-009, FR-010 | US3 |
| FR-011, FR-015, FR-016 | US1, US2, US3 |

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对包含 `openapi.json` 的项目运行生成器，输出端点包含 schema 中的关键字段，且来源统一为 `schema`。
- **SC-002**: 在无 schema 的 FastAPI 示例项目上，生成器输出至少一个带 prefix 合并后的路由，来源为 `introspection`。
- **SC-003**: 在无 schema 的 10+ 路由 Express 示例项目上，AST fallback 覆盖全部方法和路径，无遗漏。
- **SC-004**: `bootstrapGenerators()` 后可通过 `GeneratorRegistry.getInstance().get('api-surface')` 发现该 generator。
- **SC-005**: 相关单元/集成测试通过，且 `npm run lint`、`npm run build` 均通过。
