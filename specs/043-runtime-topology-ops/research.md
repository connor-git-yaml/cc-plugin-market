# Research: 运行时拓扑与运维抽取

**Feature**: `043-runtime-topology-ops`
**Date**: 2026-03-20
**Related Blueprint**: `specs/033-panoramic-doc-blueprint/blueprint.md` §4.3 Feature 043 / 045

---

## Decision 1: 043 与 045 共享独立的 runtime model 文件

**Decision**: 新增 `src/panoramic/runtime-topology-model.ts`，承载 043/045 共享的 `RuntimeTopology`、`RuntimeService`、`RuntimeImage`、`RuntimeContainer`、`RuntimeBuildStage` 和辅助归一化函数；`RuntimeTopologyGenerator` 只负责 `extract/generate/render` 生命周期，不把模型类型埋在生成器私有实现里。

**Rationale**:

- 蓝图明确要求 043/045 共享同一份运行时模型，不能分别重复解析部署制品。
- 若把类型放进 `runtime-topology-generator.ts`，045 未来导入时会额外耦合文档生成流程和模板细节。
- 类似 040/041 的复用方式已经验证过：共享结构类型 + 具体生成器分层实现。

**Consequence**:

- 043 的 `generate()` 输出中会显式包含 `topology: RuntimeTopology`。
- 045 后续只需消费 `RuntimeTopology`，不需要知道 043 的 Handlebars 模板。

---

## Decision 2: 复用现有 parser 能力，但在 043 层补 Compose 语义归一化

**Decision**: 继续复用现有 `DockerfileParser`、`EnvConfigParser`、`YamlConfigParser`；其中：

- Dockerfile 基础解析完全复用 `DockerfileParser`
- `.env` 文件解析完全复用 `EnvConfigParser`
- YAML/TOML 配置提示复用 `YamlConfigParser` / `TomlConfigParser`
- Compose 服务语义（`services` / `ports` / `volumes` / `depends_on` 等）在 043 自己的 helper 中做轻量归一化，而不是引入新的 parser registry 类型

**Rationale**:

- 当前 `YamlConfigParser` 的目标是“配置项平铺提取”，适合 `keyPath -> value` 线索，不足以直接表达 Compose 的数组/对象混合语义。
- 043 需要的是 Compose 领域归一化，而不是新的 parser 基础设施；把领域逻辑放在 043 更符合“复用基础 parser，新增领域 helper”的边界。
- 避免为单个 Feature 引入新的运行时依赖或修改 `ArtifactParser` 契约。

**Consequence**:

- `RuntimeTopologyGenerator` 会包含一个受限的 Compose 语义解析 helper。
- 未来若 045/050 也需要读取 Compose 原始结构，可直接复用 `runtime-topology-model.ts` 中的归一化 helper，而不是重新写第二套逻辑。

---

## Decision 3: 服务级环境变量遵循 Compose 覆盖顺序

**Decision**: 服务环境变量按以下顺序合并：

1. `.env` / `env_file` 提供默认值
2. Compose `environment` 内联键值覆盖同名变量

所有环境变量都保留来源路径与来源类型（`env-file` / `compose` / `dockerfile-stage`）。

**Rationale**:

- 这是 Compose 的直觉语义，也最符合运维文档对“最终有效值”的理解。
- 仅保留最终值会丢失证据链；仅保留原始来源而不做覆盖会让服务视图不准确。

**Consequence**:

- 共享模型既有最终服务视图，也能追溯变量来自哪个文件/阶段。

---

## Decision 4: 容器实例粒度以“服务定义实例”为准

**Decision**: 043 中的 `RuntimeContainer` 以 Compose service 定义为一条容器实例记录；若显式声明 `container_name`，使用它，否则退化为服务名。

**Rationale**:

- Compose 文件中通常只定义单个服务模板，并不总是显式声明副本数；043 的目标是抽取结构化部署信息，不是运行时实际编排状态采样。
- 045 未来做架构概览时需要的是“部署构件关系”，服务粒度的容器定义足够。

**Consequence**:

- 当前模型不会尝试推导实时副本数、Swarm/K8s 运行时状态。
- 若后续需要 `replicas`，可在不破坏现有模型的前提下追加可选字段。

---

## Decision 5: 多阶段 Dockerfile 的 stage 角色按“运行目标优先”判定

**Decision**:

- 默认最后一个 stage 视为 runtime stage，其余视为 build stages
- 如果 Compose `build.target` 指向某个 stage，则该 stage 视为服务的 runtime target
- 通过 `COPY --from=...` 保留 stage 间依赖链

**Rationale**:

- 这是对多阶段 Dockerfile 最稳定且最可解释的归一化方式。
- 仅靠 alias 名称（如 `runner` / `builder`）做推断不够稳健，应以位置和 `build.target` 为主，名称为辅。

**Consequence**:

- 即使 alias 缺失，也能产出可靠的 stage 角色。
- 后续 045 渲染部署视图时，可从共享模型中获得“服务使用哪个 stage 作为最终镜像”的信息。

---

## Decision 6: 043 只输出运行时拓扑文档，不提前做 045 的架构视图渲染

**Decision**: `templates/runtime-topology.hbs` 只渲染 043 自身的运行时拓扑摘要、表格与来源信息，不在本 Feature 内输出系统上下文图、部署视图组合页或跨能力复合视图。

**Rationale**:

- 用户明确要求“不要把 045 的架构视图渲染提前做进来”。
- 043 的职责是提供共享运行时模型与运维拓扑文档，045 才是综合视图渲染层。

**Consequence**:

- 043 文档会专注于服务/镜像/容器/stage/配置证据链。
- 任何系统上下文、分层视图、跨 Generator 拼装逻辑都留到 045。

---

## Implementation Notes

- 无需引入新依赖；继续使用现有 `handlebars`、`zod`、Node `fs/path`。
- `isApplicable()` 以存在 compose 文件、Dockerfile 或 `.env` / 运行时配置文件为触发条件。
- `extract()` 阶段优先从 `ProjectContext.configFiles` 读取根目录 compose / Dockerfile，再根据 Compose `build.*` / `env_file` 补充发现引用文件。
- `generate()` 负责把 Compose、Dockerfile、env/config 提示合并成单一 `RuntimeTopology`，并补充文档所需的统计字段。
