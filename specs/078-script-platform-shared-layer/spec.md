# Feature Specification: Script Platform 共享层收敛

**Feature Branch**: `078-script-platform-shared-layer`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: User description: "[$spec-driver-feature] 阅读最新的 blueprint 和相关文档以及代码，并完成需求 078."

## User Scenarios & Testing

### User Story 1 - 六条主链共享同一套 YAML 能力 (Priority: P1)

作为维护者，我希望 `entity / workflow / quality / scorecard / adoption / suggestions` 六条主链不再各自维护等价的 YAML parse / stringify 实现，这样修复 YAML 边界行为时只需要改一处并配一组测试。

**Why this priority**: 078 的首要验收标准就是消除多份功能等价的 `parseYamlDocument` / `stringifyYaml`。如果 YAML 仍分散在各脚本里，后续 081 的热点重构会继续建立在重复基础上。

**Independent Test**: 运行共享层单测，验证统一 `parseYamlDocument` / `stringifyYaml` 覆盖当前脚本依赖的 YAML 子集；再运行 `workflow / quality / scorecard / suggestions / entity` 相关集成测试，确认输出合同不变。

**Acceptance Scenarios**:

1. **Given** `generate-workflow-registry.mjs`、`generate-product-quality-reports.mjs` 和 `generate-product-scorecards.mjs` 之前各自内嵌了 YAML parser，**When** 078 完成后再次检索 `plugins/spec-driver/scripts/*.mjs`，**Then** 这些脚本不再保留本地功能等价的 `parseYamlDocument` 定义，而是复用共享层。
2. **Given** `entity / quality / scorecard / suggestions` 之前各自维护了 YAML stringify，**When** 078 完成后生成相同 fixture 的产物，**Then** 输出路径和关键字段保持兼容，但 `stringifyYaml` 只保留共享实现。

---

### User Story 2 - 主要生成脚本共享基础 IO、patch 与 diagnostics 合同 (Priority: P1)

作为维护者，我希望主要生成脚本都通过统一的 report IO、entity/catalog patch helper 和 warning contract 写文件与回写索引，这样新增一个产品级报告时不会再复制 mkdir / write / dedupe warning / patch index 模板代码。

**Why this priority**: 蓝图把 078 定位成“script platform 共享层收敛”，不仅是 YAML；如果 IO、patch 与 diagnostics 仍各写一套，维护成本并不会明显下降。

**Independent Test**: 运行 `generate-product-entity-catalog.mjs`、`generate-product-quality-reports.mjs`、`generate-product-scorecards.mjs`、`generate-project-context-suggestions.mjs`、`generate-adoption-insights.mjs` 的集成测试，验证 entity 回写、catalog 更新、warnings 汇总与文件落盘仍正常。

**Acceptance Scenarios**:

1. **Given** `quality` 和 `scorecard` 都会回写 `entity.yaml` 与 `catalog-index.yaml`，**When** 078 完成后执行对应脚本，**Then** 回写逻辑通过共享 patch helper 完成，且产物字段仍包含对应 `quality*` / `scorecard*` 摘要。
2. **Given** `suggestions`、`adoption`、`workflow` 都会写 Markdown / JSON / YAML 报告并附带 warnings，**When** 078 完成后执行这些脚本，**Then** warnings 通过统一 contract 去重输出，文件写入逻辑通过共享 IO helper 完成。

---

### User Story 3 - 重构后对外合同保持稳定且共享层有专门测试 (Priority: P2)

作为协作者，我希望这次收敛只改变共享层与脚本内部结构，而不改变 `spec-driver-sync` 的外部产物路径、CLI 入口和 Codex / Claude 兼容行为；同时共享层本身要有单独测试，而不是只靠端到端用例兜底。

**Why this priority**: 078 是维护性收敛，不是产品行为改版。只要外部合同漂移，后续 079/080 会被迫跟着补救。

**Independent Test**: 新增共享层 unit tests，覆盖 YAML、patch、report IO 和 diagnostics helper；再运行现有 integration tests、`npm run lint`、`npm run build` 和 `npm test`。

**Acceptance Scenarios**:

1. **Given** 仓库已有 `spec-driver-sync` 和各生成脚本的集成测试，**When** 078 完成后执行这些测试，**Then** 产物路径仍保持在 `specs/products/**`、`.specify/**` 和现有脚本返回 JSON 合同内。
2. **Given** 共享层后续将被 081 继续复用，**When** 维护者查看测试套件，**Then** 能找到专门针对共享 YAML / IO / patch / diagnostics helper 的单测，而不是只剩黑盒集成测试。

### Edge Cases

- 当 `entity.yaml` 或 `catalog-index.yaml` 不存在时，patch helper 必须静默跳过，不得让生成脚本整体失败。
- 当 preferred path 与 legacy path 同时存在时，共享 IO / patch helper 必须保留当前优先级，不得改变已有 fallback 行为。
- 当 warnings 为空、包含重复值或来自多个阶段时，共享 diagnostics contract 必须输出稳定、去重后的 `string[]`。
- 当 YAML 输入超出当前仓库支持子集时，共享 YAML helper 必须保持与现有脚本相同的保守行为，而不是在 078 中悄悄扩展语义。
- 当某个脚本只需要 Markdown + JSON 或只需要 YAML 输出时，共享 report IO helper 必须支持按需写入，不得强迫所有脚本输出同一组格式。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 `plugins/spec-driver/scripts/lib/` 提供统一的 YAML helper，并由共享层导出 `parseYamlDocument` 与 `stringifyYaml`。
- **FR-002**: `generate-product-quality-reports.mjs`、`generate-product-scorecards.mjs`、`generate-workflow-registry.mjs`、`generate-product-entity-catalog.mjs`、`generate-project-context-suggestions.mjs` MUST 改为复用共享 YAML helper，而不是各自保留功能等价的本地实现。
- **FR-003**: 系统 MUST 提供共享 report IO helper，统一处理父目录创建、JSON/Markdown/YAML 写入与常见读取逻辑。
- **FR-004**: 系统 MUST 提供共享 patch helper，统一处理 `entity.yaml`、`catalog-index.yaml` 或同类索引文件的回写更新。
- **FR-005**: 系统 MUST 提供共享 diagnostics / warnings contract，至少统一 warnings 去重、输出形状和可复用的 warning section 渲染辅助。
- **FR-006**: 078 MUST 优先覆盖 `entity / workflow / quality / scorecard / adoption / suggestions` 六条主链，不要求在本次迁移所有 `plugins/spec-driver/scripts/*.mjs`。
- **FR-007**: 078 MUST 保持现有脚本入口、输出文件路径、主要 JSON payload 字段与 `spec-driver-sync` 调用方式兼容。
- **FR-008**: 078 MUST 不引入新的运行时依赖、常驻服务或只兼容单一端的工作流；实现必须继续兼容 Codex / Claude 双端。
- **FR-009**: 共享层 MUST 以可直接被 `.mjs` 脚本消费的 Node ESM 形式提供，不要求把这批脚本整体迁移到 `src/**` TypeScript。
- **FR-010**: 共享层 MUST 有专门单测，相关生成脚本 MUST 有回归集成测试，覆盖 YAML roundtrip、report IO、patch 行为与 warnings 归一化。
- **FR-011**: 078 MUST 只做共享层收敛，不提前实现 079、080 或 081 的目录重排、版本同步或热点大重构。

### Key Entities

- **ScriptYamlHelper**: 统一 YAML parse / stringify 能力，供六条主链脚本直接复用。
- **ScriptReportArtifact**: 共享 report IO 的输入结构，描述要写出的 JSON / Markdown / YAML 内容与目标路径。
- **ArtifactPatchOperation**: 共享 patch helper 的更新描述，负责将报告摘要回写到 entity 或跨产品索引。
- **ScriptDiagnostics**: 脚本级 diagnostics / warnings 结构，统一 warnings 去重、渲染和结果返回。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 在 `plugins/spec-driver/scripts/*.mjs` 中，不再保留多份功能等价的 `parseYamlDocument` / `stringifyYaml` 主实现，YAML 能力集中到共享层。
- **SC-002**: `entity / workflow / quality / scorecard / adoption / suggestions` 六条主链均改为复用共享 IO、diagnostics 或 patch primitives 中的至少一类核心能力。
- **SC-003**: 新增共享层 unit tests，且覆盖 YAML、report IO、patch 与 diagnostics helper。
- **SC-004**: 现有相关 integration tests 继续通过，证明 `spec-driver-sync` 和各脚本对外合同未回归。
- **SC-005**: `npm run lint`、`npm run build`、`npm test` 全部通过。

## Clarifications

### Session 2026-04-05

- [AUTO-CLARIFIED: 078 的共享层优先放在 `plugins/spec-driver/scripts/lib/`，不把整批脚本整体迁移到 `src/**` TypeScript]
- [AUTO-CLARIFIED: 本次只覆盖蓝图点名的六条主链；`record-workflow-run`、`validate-wrapper-sources`、`resolve-project-context` 等脚本不是 078 的主要迁移目标]
- [AUTO-CLARIFIED: 078 的目标是抽重复基础能力并保持对外合同稳定，不做站在共享层之上的新产品功能]
