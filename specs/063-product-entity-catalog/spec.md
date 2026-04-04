# Feature Specification: 产品实体目录与 Catalog 生成

**Feature Branch**: `063-product-entity-catalog`  
**Created**: 2026-04-04  
**Status**: Implemented  
**Input**: User description: "开始 Feature 063"

## User Scenarios & Testing

### User Story 1 - 为每个产品生成最小实体目录 (Priority: P1)

作为维护者，我希望在 `spec-driver-sync` 生成 `current-spec.md` 之后，还能稳定产出机器可读的 `entity.yaml`，这样后续 workflow registry、scorecards 和 adoption 分析就能复用统一的 Catalog 入口，而不用继续从长篇 Markdown 里做二次猜测。

**Why this priority**: 063 是 `062` 蓝图的事实层起点。如果没有最小 Catalog，064–066 都只能继续依附在 `current-spec.md` 文本之上，结构会继续失衡。

**Independent Test**: 准备包含 `product-mapping.yaml`、`reverse-spec/current-spec.md`、`spec-driver/current-spec.md` 的临时项目，执行实体目录脚本，验证两个产品都生成 `entity.yaml` 和 `catalog-index.yaml`。

**Acceptance Scenarios**:

1. **Given** `specs/products/product-mapping.yaml` 与至少一份 `current-spec.md`，**When** 运行 Catalog helper，**Then** 系统生成 `specs/products/<product>/entity.yaml` 与 `specs/products/catalog-index.yaml`。
2. **Given** `reverse-spec` 与 `spec-driver` 两个产品都存在 `current-spec.md`，**When** 运行 helper，**Then** 两个实体文档都包含 `id`、`name`、`kind`、`owner`、`lifecycle`、`repo`、`docs`、`quality`、`workflowRefs` 与 `sourceRefs`。

---

### User Story 2 - sync 主流程显式产出 Catalog (Priority: P1)

作为 Spec Driver 的使用者，我希望 `spec-driver-sync` 不只是产出产品活文档，还会显式调用实体目录 helper 并在最终报告中展示 entity/catalog 结果，这样后续流程可以把 Catalog 视为正式交付物，而不是隐藏的附加脚本。

**Why this priority**: 063 的价值不在独立脚本本身，而在它进入 `sync` 主入口之后，Catalog 才会成为统一事实层的一部分。

**Independent Test**: 检查 `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` 与 Codex 对应 skill，验证流程新增“生成产品实体目录”步骤，并引用确定性 helper。

**Acceptance Scenarios**:

1. **Given** `spec-driver-sync` 技能被执行，**When** 聚合完成 `current-spec.md`，**Then** skill 文档明确要求调用 `generate-product-entity-catalog.mjs` 并把 `entity.yaml` / `catalog-index.yaml` 纳入报告。
2. **Given** Codex 环境使用 `.codex/skills/spec-driver-sync/SKILL.md`，**When** 阅读流程说明，**Then** Codex 版本与 plugin source skill 对 063 的产物和边界描述一致。

---

### User Story 3 - 缺失字段时保守降级为 unknown / inferred (Priority: P2)

作为维护者，我希望 owner、lifecycle、quality report 等经常缺失的字段在实体目录里被显式标成 `unknown` 或 `inferred`，而不是被省略或静默伪造，这样 Catalog 不会把不确定元数据伪装成事实。

**Why this priority**: 062 蓝图已明确要求 Catalog 以诚实标注不确定性为前提；缺失 owner/lifecycle 是最常见的现实情况。

**Independent Test**: 准备一个只有 `product-mapping.yaml`、没有 `current-spec.md` 的 fixture，运行 helper，验证输出 entity 中 `current-spec` 文档标记为不可用、`lifecycle=unknown` 且返回 warning。

**Acceptance Scenarios**:

1. **Given** 产品缺少 `current-spec.md`，**When** 运行 helper，**Then** 系统仍生成 `entity.yaml`，但 `docs.current-spec.available=false`、`lifecycle.value=unknown`，并返回 warning。
2. **Given** 产品的 `current-spec.md` 状态为 `活跃`，**When** 运行 helper，**Then** `lifecycle.value=active` 且 `lifecycle.source=inferred:current-spec.status`，而不是静态硬编码。

## Edge Cases

- `product-mapping.yaml` 中存在产品条目但尚未生成 `current-spec.md` 时，helper 不能直接退出；必须生成部分实体并记录 warning。
- 同一仓库可能同时承载多个产品，`catalog-index.yaml` 需要稳定收集多个 `entity.yaml`，不能只输出最后一个产品。
- `quality-report.json` 在多数仓库中并不会常驻 Git，需要把缺失视为 `unavailable`，而不是错误。
- `entity.yaml` 必须只保留索引元数据，不能把 `current-spec.md` 的长段落正文复制进去形成第二份 README。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供一个确定性 helper，从 `product-mapping.yaml + current-spec.md + repo metadata + quality report` 生成 `entity.yaml` 和 `catalog-index.yaml`。
- **FR-002**: helper MUST 在 `specs/products/<product>/entity.yaml` 中输出最小字段集：`id`、`name`、`kind`、`owner`、`lifecycle`、`repo`、`docs`、`quality`、`workflowRefs`、`sourceRefs`。
- **FR-003**: helper MUST 将 `current-spec.md` 视为正文事实层，只引用路径和聚合元信息，不复制长段正文。
- **FR-004**: helper MUST 在缺失 owner / lifecycle / quality report 时显式写出 `unknown` 或 `inferred`，不得省略字段。
- **FR-005**: helper MUST 为 `reverse-spec` 与 `spec-driver` 推导稳定的 `workflowRefs` 集合，作为 064 workflow registry 的最小前置引用。
- **FR-006**: `spec-driver-sync` source skill 与 Codex skill MUST 新增 Catalog 生成步骤，并显式调用 helper。
- **FR-007**: `plugins/spec-driver/agents/sync.md` MUST 明确 `current-spec.md` 是本阶段输出，而 `entity.yaml` / `catalog-index.yaml` 由后置 helper 生成。
- **FR-008**: helper MUST 在 `current-spec.md` 缺失时保守降级，生成部分实体并返回 warning，而不是阻断。
- **FR-009**: 实现 MUST 保持 Git-native、零新增运行时依赖，不引入数据库、服务端 Catalog 或独立 UI。
- **FR-010**: 实现 MUST 保持 Codex / Claude 双端兼容。

### Key Entities

- **ProductEntityDoc**: 单产品机器可读实体目录，记录产品 ID、类型、生命周期、repo、docs、quality、workflowRefs 和 sourceRefs。
- **CatalogIndexDoc**: 所有产品实体的轻量索引，记录实体路径、生命周期、workflow 数量和 spec 数量。
- **CurrentSpecMeta**: 从 `current-spec.md` 头部提取的聚合元数据，如版本、状态、最后聚合时间。
- **RepoMetadata**: 从 Git / `package.json` 推断出的仓库根信息、远端地址和默认分支。

## Success Criteria

- **SC-001**: 当前仓库中的 `reverse-spec` 与 `spec-driver` 都能稳定生成 `entity.yaml`。
- **SC-002**: `specs/products/catalog-index.yaml` 会收录全部产品实体，并保留稳定的 `entityPath` / `currentSpecPath`。
- **SC-003**: 缺失 `current-spec.md` 的测试场景会返回 warning，并把 `lifecycle`、`currentSpec.status` 等字段显式写成 `unknown`。
- **SC-004**: `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` 与 `.codex/skills/spec-driver-sync/SKILL.md` 都包含 Catalog 生成步骤。
- **SC-005**: 相关集成测试、`npm run lint`、`npm run build` 全部通过。

## Clarifications

### Session 2026-04-04

- [AUTO-CLARIFIED: 063 只做最小 Catalog，不引入 UI、数据库、OPA 或远程注册中心]
- [AUTO-CLARIFIED: `entity.yaml` 只保存索引元数据，不复制 `current-spec.md` 的正文章节]
- [AUTO-CLARIFIED: `workflowRefs` 在 063 先保留为静态最小引用集合，完整 workflow registry 留给 064]
