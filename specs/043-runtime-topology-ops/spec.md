# Feature Specification: 运行时拓扑与运维抽取

**Feature Branch**: `feature/043-runtime-topology-ops`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "落地 Feature 043 RuntimeTopologyGenerator，从 Dockerfile、docker-compose 和环境配置抽取统一运行时拓扑模型，并为 Feature 045 复用同一份中间模型。"

---

## User Scenarios & Testing

### User Story 1 - 联合解析 Compose + Dockerfile 生成运行时拓扑文档 (Priority: P1)

作为部署/运维文档的消费者，我希望系统能同时读取 `docker-compose.yml` / `compose.yaml`、关联的 Dockerfile 以及 `.env` 环境变量文件，生成一份统一的运行时拓扑文档，这样我可以一次性看到服务、镜像、容器、端口、卷、依赖关系和启动命令，而不是分散阅读多份部署文件。

**Why this priority**: 这是蓝图 4.3 对 Feature 043 的主交付物，也是后续 045 架构概览的直接输入来源。若不能联合抽取，043 的共享中间模型价值不成立。

**Independent Test**: 准备一个包含 `docker-compose.yml`、服务 Dockerfile 和 `.env` 的测试项目，运行 `RuntimeTopologyGenerator` 的 `extract -> generate -> render` 全流程，验证输出包含服务、镜像/构建上下文、端口映射、卷挂载、环境变量、命令和 `depends_on`。

**Acceptance Scenarios**:

1. **Given** 一个包含 `docker-compose.yml`、`.env` 和服务 Dockerfile 的项目，**When** 运行 `RuntimeTopologyGenerator`，**Then** 输出文档列出所有服务、容器实例、镜像/构建上下文、端口映射、卷挂载、启动命令和 `depends_on` 关系。
2. **Given** Compose 服务同时声明 `env_file` 和 `environment`，**When** 运行生成器，**Then** 输出中的环境变量聚合同时包含两个来源，且同名变量以 Compose 内联 `environment` 为最终覆盖值。
3. **Given** Compose 服务使用 `build.context` 和 `build.dockerfile` 指向非根目录 Dockerfile，**When** 运行生成器，**Then** 输出中能正确解析并关联对应 Dockerfile 的阶段信息。

---

### User Story 2 - 正确识别多阶段 Dockerfile 的 build/runtime stages (Priority: P1)

作为运行时架构消费者，我希望生成器能识别多阶段 Dockerfile 中的构建阶段与最终运行阶段，并把这些阶段映射到统一运行时模型中，以便我区分哪些阶段仅用于构建，哪些阶段最终参与容器运行。

**Why this priority**: 蓝图的第二条验收标准明确要求多阶段 Dockerfile 被正确识别并映射到共享运行时模型，这是 043 区别于简单部署文档拼接的关键。

**Independent Test**: 准备一个包含 `builder` / `runner` 两个 stage 的 Dockerfile，运行生成器并验证输出结构中同时包含多个 stage，且最终运行服务指向正确的 runtime stage。

**Acceptance Scenarios**:

1. **Given** 一个多阶段 Dockerfile（如 `FROM node AS builder` + `FROM node AS runner`），**When** 运行生成器，**Then** 共享运行时模型中包含两个 stage，且 `builder` 被标记为 build stage、`runner` 被标记为 runtime stage。
2. **Given** Compose 服务通过 `build.target` 指定某个中间 stage，**When** 运行生成器，**Then** 该服务与对应 stage 建立关联，而不是默认关联 Dockerfile 的最后一个 stage。
3. **Given** Dockerfile 的 runtime stage 通过 `COPY --from=builder` 复制构建产物，**When** 运行生成器，**Then** 共享模型中保留 stage 间的来源关系，供后续 045 消费。

---

### User Story 3 - 聚合环境变量和运行时配置提示 (Priority: P2)

作为部署维护者，我希望统一运行时模型不仅包含 Compose 中显式声明的环境变量，还能纳入 `.env` 和配置文件里显式暴露的运行时线索（例如端口、镜像、命令相关键），这样文档能反映更完整的运行时上下文。

**Why this priority**: 蓝图将 043 定义为“运行时拓扑与运维抽取”，不应只停留在 Compose 表层结构。聚合 `.env` / 配置文件线索有助于后续 045 和 050 做解释与审计。

**Independent Test**: 准备一个包含 `.env` 和运行时 YAML/TOML 配置键的项目，验证输出中的统一模型保留这些环境变量与配置提示，并标明来源文件。

**Acceptance Scenarios**:

1. **Given** 项目存在 `.env` / `.env.local` 文件，**When** 运行生成器，**Then** 输出模型中记录这些环境变量及来源文件，并可被服务通过 `env_file` 引用。
2. **Given** 项目存在含运行时键信息的 YAML/TOML 配置文件（如 `server.port`、`image.tag`），**When** 运行生成器，**Then** 这些信息以配置提示形式进入共享模型，而不是被完全丢弃。

---

### User Story 4 - 通过 GeneratorRegistry 自动发现 RuntimeTopologyGenerator (Priority: P2)

作为 reverse-spec 用户，我希望 `RuntimeTopologyGenerator` 被 `GeneratorRegistry` 自动注册并可按上下文发现，这样运行 `reverse-spec batch` 时无需额外配置即可产出 043 文档。

**Why this priority**: 不注册就无法被现有 panoramic 工具链消费，Feature 043 无法端到端交付。

**Independent Test**: 调用 `bootstrapGenerators()` 后，通过 `GeneratorRegistry.getInstance().get('runtime-topology')` 获取到该生成器，并验证包含 compose / Dockerfile 的上下文会被 `filterByContext()` 返回。

**Acceptance Scenarios**:

1. **Given** 已执行 `bootstrapGenerators()`，**When** 通过 id `runtime-topology` 查询，**Then** 返回 `RuntimeTopologyGenerator` 实例。
2. **Given** 一个包含 compose 或 Dockerfile 的项目上下文，**When** 调用 `filterByContext()`，**Then** 结果包含 `RuntimeTopologyGenerator`。

---

### User Story 5 - 与 Feature 045 共享统一运行时模型 (Priority: P2)

作为后续 Feature 045 的实现者，我希望 043 输出的结构化运行时模型与文档渲染解耦，并能被其它生成器直接消费，这样 045 只需做视图渲染，不需要再次解析 Dockerfile / Compose。

**Why this priority**: 蓝图明确要求 043/045 共享同一份运行时模型，禁止分别重复解析部署制品。

**Independent Test**: 检查 043 的结构化输出与共享 types/helper，验证模型不包含模板/Markdown 细节，并可从 `src/panoramic/index.ts` 导出。

**Acceptance Scenarios**:

1. **Given** 043 的 `generate()` 输出，**When** 读取共享运行时模型，**Then** 能直接访问服务、镜像、容器、端口、卷、依赖和 stages，而不依赖 Handlebars 渲染结果。
2. **Given** 后续 045 需要消费运行时模型，**When** 导入共享 types/helper，**Then** 无需再次实现 Dockerfile / Compose 解析逻辑。

---

### Edge Cases

- Compose 文件使用 `ports` / `volumes` / `environment` 的短语法和长语法混用时，系统应同时支持。
- Compose `depends_on` 既可能是字符串数组，也可能是带 `condition` 的对象映射，系统应统一归一化为依赖关系数组。
- Dockerfile 只有单阶段或没有显式 alias 时，系统仍应生成可用的 stage 名称（例如 `stage-1`）。
- 项目只有 Dockerfile 没有 Compose，或只有 Compose 没有关联 Dockerfile 时，生成器仍应静默降级并返回尽可能完整的拓扑。
- 引用的 `env_file` / Dockerfile 路径不存在时，生成器不应抛异常，应保留缺失来源提示并继续生成其它部分。
- 配置文件解析能力只覆盖当前仓库已有 parser 能识别的 `.env` / YAML / TOML 子集；超出子集的复杂 YAML 特性（anchor / merge key）可降级为空提示，但不应阻断整体生成。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 实现 `DocumentGenerator<RuntimeTopologyInput, RuntimeTopologyOutput>` 接口，遵循 `isApplicable -> extract -> generate -> render` 四步生命周期。
- **FR-002**: 系统 MUST 在 `src/panoramic/runtime-topology-generator.ts` 中实现 `RuntimeTopologyGenerator`，使用 id `'runtime-topology'`。
- **FR-003**: 系统 MUST 联合解析 `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` / `compose.yaml`、Dockerfile 和 `.env` 文件。
- **FR-004**: 系统 MUST 复用现有 `DockerfileParser` 提取 Dockerfile stages / instructions，而不是重新实现 Dockerfile 基础解析。
- **FR-005**: 系统 MUST 复用现有 `.env` / YAML 配置 parser 能力提取环境变量和运行时配置提示，而不是新增平行的 parser registry 基础设施。
- **FR-006**: 系统 MUST 产出一份共享运行时模型，至少包含服务、镜像/构建上下文、容器实例、端口、卷、依赖关系、启动命令、环境变量和多阶段 build/runtime stages。
- **FR-007**: 系统 MUST 在共享模型中保留 Docker build stages 与服务/镜像的关联关系，以供 Feature 045 直接消费。
- **FR-008**: 系统 MUST 在多阶段 Dockerfile 场景下正确识别 build stage 与 runtime stage；默认情况下最后一个 stage 为 runtime stage，若 Compose 指定 `build.target`，则该 target stage 视为运行目标。
- **FR-009**: 系统 MUST 统一归一化 Compose 服务中的 `ports`、`volumes`、`depends_on`、`command`、`entrypoint` 和 `environment` 字段，支持短语法与长语法。
- **FR-010**: 系统 MUST 对 `env_file` 与 `.env` 文件中的环境变量做来源追踪，并与 Compose 内联环境变量合并。
- **FR-011**: 系统 MUST 通过 `templates/runtime-topology.hbs` 渲染最终 Markdown 文档。
- **FR-012**: 系统 MUST 在 `bootstrapGenerators()` 中注册 `RuntimeTopologyGenerator`，使其可被 `GeneratorRegistry` 自动发现。
- **FR-013**: 系统 MUST 在 `src/panoramic/index.ts` 中导出 `RuntimeTopologyGenerator` 及共享 runtime model/types/helper。
- **FR-014**: 系统 MUST 将文档渲染细节限制在 `RuntimeTopologyOutput` / 模板层，不得将 Markdown/Handlebars 细节塞进共享 runtime model。
- **FR-015**: 系统 SHOULD 将 Dockerfile、Compose、env、配置文件的来源路径保存在共享模型中，用于后续 045/050 的证据链展示。
- **FR-016**: 系统 MAY 在共享模型中保留运行时配置提示（runtime config hints），用于 `.env` 之外的 YAML/TOML 运行时线索聚合。

### Key Entities

- **RuntimeTopologyInput**: `extract()` 阶段输出，包含项目名称、Compose 解析结果、Dockerfile 解析结果、环境变量文件和运行时配置提示。
- **RuntimeTopology**: 043/045 共享的核心中间模型，承载服务、镜像、容器、端口、卷、依赖、环境变量、构建 stages 与来源信息。
- **RuntimeService**: 单个服务定义，包含镜像/构建信息、容器关联、命令、环境变量、端口、卷和依赖。
- **RuntimeImage**: 镜像或构建目标的结构化表示，包含镜像名、build context、Dockerfile 路径、target stage 和关联 stages。
- **RuntimeContainer**: 运行时容器实例定义，通常与 Compose service 对齐，包含端口、卷和最终命令等运行属性。
- **RuntimeBuildStage**: Dockerfile 中的单个构建阶段，包含 base image、alias、阶段角色、命令、暴露端口、环境变量与 stage 间依赖。
- **RuntimeConfigHint**: 从 `.env` / YAML / TOML 配置中提取的运行时提示信息，包含 key、value、来源文件和用途分类。

### Traceability Matrix

| FR | User Story |
|----|-----------|
| FR-001, FR-002 | US1, US4 |
| FR-003, FR-004, FR-006, FR-009, FR-011 | US1 |
| FR-007, FR-008 | US2, US5 |
| FR-005, FR-010, FR-015, FR-016 | US3 |
| FR-012, FR-013 | US4, US5 |
| FR-014 | US5 |

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对包含 Compose + Dockerfile + `.env` 的测试项目运行 `RuntimeTopologyGenerator` 后，输出文档至少覆盖服务、镜像/构建上下文、环境变量、端口映射、卷挂载、命令和 `depends_on` 七类核心信息。
- **SC-002**: 对多阶段 Dockerfile 测试项目运行后，共享模型中正确产出 build/runtime stages，且服务与目标 runtime stage 的映射准确。
- **SC-003**: `bootstrapGenerators()` 后可通过 `GeneratorRegistry.getInstance().get('runtime-topology')` 查询到该生成器；`filterByContext()` 在包含 Compose / Dockerfile 的上下文中返回该生成器。
- **SC-004**: 新增单元/集成测试通过，至少覆盖一组 Compose + Dockerfile 联合解析测试和一组 multi-stage Dockerfile 测试。
- **SC-005**: `npm run lint`、相关 `vitest` 用例和 `npm run build` 全部通过，无类型错误。
