# Feature Specification: 文档 Bundle 与发布编排

**Feature Branch**: `055-doc-bundle-publish-orchestration`  
**Created**: 2026-03-20  
**Status**: Draft  
**Input**: User description: "落地 Feature 055 文档 Bundle 与发布编排，基于现有 batch/panoramic 输出新增 docs bundle 编排，输出 4 个 bundle profile、manifest、landing page 和 MkDocs/TechDocs 兼容骨架"

## User Scenarios & Testing

### User Story 1 - Batch 自动产出受众导向的文档 Bundle (Priority: P1)

作为维护者，我希望在 `reverse-spec batch` 完成模块 spec 和项目级 panoramic 文档之后，系统能继续按固定 profile 组织出可交付的 docs bundle，而不是让我手工挑文件、改目录、写导航。

**Why this priority**: 055 是 054 Phase 0 的交付层入口，没有 bundle 编排，053 输出仍然停留在“文件集合”，难以被文档站点或交接场景直接消费。

**Independent Test**: 对包含模块 spec、项目级 panoramic 文档和 `_index.spec.md` 的 fixture 执行 `runBatch()`，验证输出目录新增 `docs-bundle.yaml` 与 4 个 profile 对应的 bundle 目录。

**Acceptance Scenarios**:

1. **Given** 一个已适用 053 项目级文档套件的项目，**When** 执行 `reverse-spec batch`，**Then** 输出目录中会额外生成 `docs-bundle.yaml` 和 4 个 bundle profile 的目录结构。
2. **Given** 用户使用默认 `specs/` 输出目录或自定义相对 `outputDir`，**When** batch 结束后生成 bundle，**Then** manifest 和 bundle 目录都必须以 `projectRoot` 为基准写入，而不是受当前 cwd 影响。

---

### User Story 2 - Bundle 导航顺序体现阅读路径 (Priority: P1)

作为阅读者，我希望 bundle 内的 landing page 和导航是“先看什么、后看什么”的阅读路径，而不是把文档按文件名字母序硬排。

**Why this priority**: 这是蓝图对 055 的核心验收点；如果导航仍是文件名排序，bundle 只是目录复制，不构成交付编排。

**Independent Test**: 查看 `developer-onboarding` 或 `architecture-review` 的 `mkdocs.yml` / manifest，验证导航顺序体现 `index -> architecture-narrative -> architecture-overview -> runtime-topology -> module specs` 等阅读路径。

**Acceptance Scenarios**:

1. **Given** 一个同时拥有 `architecture-narrative`、`architecture-overview`、`runtime-topology` 和模块 spec 的项目，**When** 生成 `developer-onboarding` bundle，**Then** 导航顺序必须优先展示整体认知文档，再进入运行时和模块级明细。
2. **Given** 某些项目级文档缺失，**When** 生成 bundle，**Then** 系统必须按预设阅读路径保留剩余节点顺序，并跳过缺失节点，而不是退化为按文件名排序。

---

### User Story 3 - Bundle 可直接被 MkDocs / TechDocs 消费 (Priority: P1)

作为文档发布者，我希望每个 bundle 都带有最小但完整的站点骨架，例如 `mkdocs.yml`、`docs/` 目录和自动生成的 `index.md`，从而可直接接入 MkDocs 或 TechDocs，而不必重新组织站点结构。

**Why this priority**: 055 在蓝图中的定位是“文档交付与发布编排层”，不是新增事实抽取器，也不是重造站点系统。

**Independent Test**: 对 `claude-agent-sdk-python` 或等价准真实项目执行 batch + bundle 输出，验证至少 1 个 profile 下存在 `mkdocs.yml`、`docs/index.md` 和可访问的文档页面目录结构。

**Acceptance Scenarios**:

1. **Given** 一个成功生成模块 spec 和项目级文档的项目，**When** bundle 编排完成，**Then** 每个 profile 目录下都必须含有 MkDocs / TechDocs 可消费的 `mkdocs.yml` 和 `docs/` 目录。
2. **Given** 一个准真实 Python 项目（如 `claude-agent-sdk-python`），**When** 执行 bundle 输出，**Then** 至少有 1 套 profile 可被直接识别为文档站点骨架，而不是只有散落 Markdown 文件。

---

### User Story 4 - 四种 Profile 体现不同受众，而不是简单复制 (Priority: P2)

作为文档维护者，我希望 `developer-onboarding`、`architecture-review`、`api-consumer`、`ops-handover` 四种 profile 的选文逻辑明显不同，能服务不同阅读场景，而不是把同一组文件复制四遍。

**Why this priority**: 如果四个 profile 只是同一导航和同一文件集合，055 无法证明自己是“发布编排层”，只会增加维护噪音。

**Independent Test**: 对同一 fixture 生成 4 个 profile，验证 manifest 中各 profile 的导航入口和文档集合不完全相同，且差异符合 profile 语义。

**Acceptance Scenarios**:

1. **Given** 一个具备 API、运行时、架构和模块 spec 文档的项目，**When** 生成 `api-consumer` 与 `ops-handover` bundle，**Then** 两者的核心文档顺序和文档集合必须不同，例如前者优先 `api-surface`，后者优先 `runtime-topology` / `troubleshooting`。
2. **Given** 一个仅有部分 panoramic 文档的项目，**When** 生成四种 profile，**Then** 系统必须按 profile 规则选择可用文档并输出 warning，而不是因为缺项就把四种 profile 压扁成同一结果。

---

### User Story 5 - 不破坏现有 batch 输出与项目级文档主链路 (Priority: P2)

作为维护者，我希望新增 bundle 编排后，现有 `reverse-spec batch` 的模块 spec、`_index.spec.md`、`_doc-graph`、`_coverage-report` 和 053 项目级文档套件保持兼容，避免 055 为了发布编排反向污染事实输出主链路。

**Why this priority**: 蓝图明确要求 055 只做交付层，不能回头重造事实抽取链，也不能让原有 batch 回归。

**Independent Test**: 运行现有 batch panoramic 文档套件回归测试，验证原有输出仍然存在；同时新增 bundle 目录和 manifest。

**Acceptance Scenarios**:

1. **Given** 一个已通过 053 回归测试的 fixture，**When** 接入 055 后执行 batch，**Then** 原有项目级文档文件名和写出语义必须保持可用，bundle 只是新增产物。
2. **Given** bundle 编排过程中某个 profile 缺少部分源文档，**When** 运行 batch，**Then** 原有 batch 主流程仍必须返回成功结果，并记录 bundle warning，而不是整体失败。

### Edge Cases

- 当某个 bundle 依赖的项目级文档不存在时，系统必须降级输出剩余阅读路径，并在 manifest / landing page 中记录缺失说明。
- 当输出目录使用相对路径或非默认目录时，bundle 的 `docs-bundle.yaml`、profile 目录和 `mkdocs.yml` 都必须相对 `projectRoot` 稳定落盘。
- 当 batch 以 `--incremental` 模式运行时，bundle 仍必须基于当前输出目录中的全量可见文档组织，而不是只使用本次变更命中的模块。
- 当模块 spec 数量较多时，bundle 导航必须把模块文档放入单独 section，而不是把全部 module spec 平铺到顶层。
- 当某些 profile 的核心文档全部缺失时，系统仍应生成 landing page 和 warning，而不是生成空目录或直接抛错。

## Requirements

### Functional Requirements

- **FR-001**: `runBatch()` MUST 在 053 项目级文档套件和 `_index.spec.md` 写出完成后，新增 docs bundle 编排步骤。
- **FR-002**: 系统 MUST 在 batch 输出目录中生成 `docs-bundle.yaml` 或等价 YAML manifest，描述 bundle profile、导航顺序、源文档和目标路径。
- **FR-003**: 系统 MUST 固定支持以下 4 个 bundle profile：`developer-onboarding`、`architecture-review`、`api-consumer`、`ops-handover`。
- **FR-004**: 每个 profile MUST 生成独立目录结构，至少包含 `mkdocs.yml`、`docs/` 目录和自动生成的 `docs/index.md` landing page。
- **FR-005**: 每个 profile 的导航顺序 MUST 由 profile 定义驱动，体现阅读路径；系统 MUST NOT 退化为按文件名硬排序。
- **FR-006**: profile 选文 MUST 复用 batch 已生成的模块 spec、`_index.spec.md` 和 053 项目级文档，不得重新扫描源码或重新生成事实抽取结果。
- **FR-007**: 系统 MUST 为 bundle 中的每个已选页面建立明确的“源文件 -> bundle 目标路径”映射，以便 manifest、landing page 和 MkDocs 导航保持一致。
- **FR-008**: `developer-onboarding` 与 `architecture-review` profile MUST 支持把模块 spec 作为独立 section 纳入阅读路径；`api-consumer` 与 `ops-handover` profile MUST 使用不同的核心文档集合或排序逻辑，不能只是简单复制前两者。
- **FR-009**: 当某个源文档缺失时，系统 MUST 保留 bundle 生成、跳过缺失页面，并在 manifest 或 landing page 中记录 warning / missing reason。
- **FR-010**: Bundle 输出 MUST 对相对 `outputDir`、非默认 `specs/` 目录和 `--incremental` 场景保持兼容，以当前输出目录中的可见文档作为唯一编排输入。
- **FR-011**: 系统 MUST 为每个 profile 生成 MkDocs / TechDocs 兼容的最小导航骨架，其中 `mkdocs.yml` 与 `docs/` 目录可被下游文档站点直接消费。
- **FR-012**: `BatchResult` 与 CLI 摘要 MUST 暴露 bundle manifest 路径和已生成的 profile 摘要，便于用户在 batch 结束后发现新增交付物。
- **FR-013**: 新增 bundle 编排 MUST 不改变现有模块 spec、`_index.spec.md`、`_doc-graph.json`、`_coverage-report.*`、053 项目级文档套件的既有输出合同。
- **FR-014**: 系统 SHOULD 为 bundle manifest 和 profile 定义保留共享类型 / helper，以便 056/057/059 后续消费文档交付层元数据，但 055 MUST NOT 提前实现 Architecture IR、component view、ADR 或 publishing backend。
- **FR-015**: verification report MUST 记录至少一次 bundle 目录与导航顺序验证；如果本机存在 `claude-agent-sdk-python`，系统 SHOULD 追加一次真实或准真实验证记录。

### Key Entities

- **DocsBundleManifest**: 文档交付总清单，描述 bundle 版本、生成时间、profile 列表、导航和源文件映射。
- **DocsBundleProfile**: 单个受众 profile 的定义与输出结果，包含 bundle 目录、landing page、MkDocs 配置、导航项和 warning。
- **BundleDocumentEntry**: 某个源文档在 bundle 中的编排记录，包含来源类型、源路径、目标路径、导航标题、阅读顺序和可选/必需属性。
- **BundleProfileDefinition**: 代码内置的 profile 规则，定义文档优先级、导航节顺序以及是否纳入模块 spec。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 对一个适用 053 项目级文档套件的 fixture 执行 `reverse-spec batch` 后，输出目录中自动新增 `docs-bundle.yaml` 和 4 个 profile 目录，每个目录都包含 `mkdocs.yml` 与 `docs/index.md`。
- **SC-002**: `developer-onboarding` 或 `architecture-review` bundle 的导航顺序可验证为阅读路径顺序，例如 `index -> architecture-narrative -> architecture-overview -> runtime-topology -> module specs`，而不是按文件名排序。
- **SC-003**: 4 个 profile 的 manifest 选文结果不完全相同，且 `api-consumer` 与 `ops-handover` 的前 3 个导航入口至少有 1 处差异。
- **SC-004**: 现有 053 batch 项目级文档套件回归测试继续通过，原有 `.md/.json/.mmd` 输出仍保持可用。
- **SC-005**: 若本机存在 `claude-agent-sdk-python`，则至少 1 个 bundle profile 能在 verification report 中给出可直接被 MkDocs / TechDocs 消费的目录结构验证记录。
