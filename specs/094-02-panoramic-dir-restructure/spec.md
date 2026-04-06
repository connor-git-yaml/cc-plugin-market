# Feature Specification: F-094-02 Panoramic 目录结构分层重组

**Feature Branch**: `feature/089-skill-orchestration-split`
**Created**: 2026-04-06
**Status**: Draft
**模式**: story（快速需求实现，无调研阶段）
**关联蓝图**: M-094 Panoramic 架构整洁化里程碑

---

## 1. 概述

### 背景

`src/panoramic/` 根目录当前包含约 50 个 `.ts` 文件，平铺在单一层级下（F-094-01 已将 `api-surface/` 拆分完成）。缺乏按职责划分的子目录分层，导致：

- 文件查找困难，需要搜索而非目录导航
- 不同职责的模块（Generator、Builder、Pipeline、Model）混居根目录，依赖方向不直观
- 新增模块时难以判断放置位置，积累无序增长

### 目标

将 `src/panoramic/` 根目录的文件按职责分层迁移至对应子目录，使根目录 `.ts` 文件数量不超过 10 个，同时保持所有外部导入和公开导出集合不变（zero breaking change）。

### 范围

**包含**：
- 将 generators/、pipelines/、models/、builders/、exporters/ 等分类文件迁移至对应子目录
- 将「待分类」文件归入合适子目录
- 更新 `index.ts` 桶文件内的导入路径
- 更新所有文件内部的相互引用路径
- 更新 13 处外部导入点的路径引用

**不包含**：
- 接口语义变更（interfaces.ts 内容不变）
- 注册中心逻辑变更（generator-registry.ts、parser-registry.ts 内容不变）
- F-094-01 已产出的 api-surface/ 目录（保持不变）
- utils/ 和 parsers/ 子目录（已有，保持不变）
- 任何功能逻辑修改

---

## 2. 用户故事

### User Story 1 - 开发者能通过目录结构直观定位模块（Priority: P1）

作为 Panoramic 模块的开发者，当我需要找到某个 Generator 实现或数据模型时，我希望通过目录名即可锁定目标文件，而不需要全局搜索 50 个平铺文件。

**Why this priority**: 这是本次重组的核心价值。目录结构是代码库最直接的认知地图，P1 级别确保重组完成后开发体验立即改善。

**Independent Test**: 可通过检查 `src/panoramic/` 根目录的 `.ts` 文件列表独立验证——根目录文件数不超过 10 个即视为通过。

**Acceptance Scenarios**:

1. **Given** 重组完成后的代码库，**When** 开发者查看 `src/panoramic/generators/` 目录，**Then** 目录内包含且仅包含所有 `DocumentGenerator` 实现类（共 12 个文件）
2. **Given** 重组完成后的代码库，**When** 开发者查看 `src/panoramic/` 根目录，**Then** 根目录下 `.ts` 文件不超过 10 个，仅保留核心接口/注册中心/上下文等框架性文件
3. **Given** 重组完成后的代码库，**When** 开发者查看 `src/panoramic/models/` 目录，**Then** 目录内包含所有纯数据模型/类型文件（共 7 个文件）

---

### User Story 2 - 外部调用方无感知重组（Priority: P1）

作为依赖 `src/panoramic/` 模块的外部调用方（batch-orchestrator、delta-regenerator、mcp/server、cli/index、config/project-config），当重组完成后，我的代码无需任何修改即可继续正常运行。

**Why this priority**: 零破坏性变更是本次重组的硬性约束，与 P1 story 1 同等重要。任何一处导入中断都意味着任务失败。

**Independent Test**: 可通过运行 `npm run build` 并执行全量测试套件独立验证，无编译错误、无运行时导入失败即视为通过。

**Acceptance Scenarios**:

1. **Given** 13 处已识别的外部导入点，**When** 重组完成后执行 `npm run build`，**Then** 编译零错误，所有模块正确解析
2. **Given** 现有测试套件，**When** 重组完成后运行全量测试，**Then** 全部测试通过，无回归失败
3. **Given** `src/panoramic/index.ts` 的导出集合，**When** 重组前后对比导出符号列表，**Then** 两者完全一致（名称、类型、数量均相同）

---

### User Story 3 - 待分类文件得到明确归属（Priority: P2）

作为代码库维护者，当前有 5 个待分类文件（coverage-auditor.ts、docs-bundle-manifest-reader.ts、docs-bundle-orchestrator.ts、docs-bundle-profiles.ts、pattern-knowledge-base.ts）悬浮在根目录，我希望它们在本次重组中获得明确归属。

**Why this priority**: 这 5 个文件若不处理，根目录将残留无法分类的文件，削弱目录结构的信息密度。

**Independent Test**: 可通过检查重组后根目录文件列表，确认上述 5 个文件不在根目录即视为通过。

**Acceptance Scenarios**:

1. **Given** 5 个待分类文件，**When** 分析其职责，**Then** 每个文件被归入 pipelines/、models/ 或新建的合适子目录，归属理由有据可查（记录在迁移矩阵中）
2. **Given** 归类后的文件，**When** 重组完成并构建，**Then** 文件内的内部引用路径已更新，无悬空引用

---

### Edge Cases

- **循环依赖风险**：子目录间文件相互引用可能在移动后形成循环依赖。需在迁移后使用工具（如 `madge` 或 TypeScript 编译器诊断）验证无循环依赖。
- **index.ts 重导出遗漏**：若某个文件原先通过根目录 `index.ts` 间接导出，迁移后若未更新 `index.ts` 路径，会导致静默的导出缺失。需对比迁移前后的导出符号集合。
- **测试文件中的导入路径**：测试文件（`*.spec.ts` / `*.test.ts`）若直接导入 `src/panoramic/` 下的具体文件路径，也需同步更新。
- **编辑器/IDE 缓存**：文件物理移动后，IDE 可能缓存旧路径导致假性报错，需区分工具链报错和 IDE 缓存问题。

---

## 3. 功能需求（Functional Requirements）

### FR-001 [必须] 创建目标子目录结构

**系统 MUST** 在 `src/panoramic/` 下创建以下子目录（若不存在）：
- `generators/`
- `pipelines/`
- `models/`
- `builders/`
- `exporters/`

**必要性标注**: `[必须]` — 无此步骤则文件无处迁移

---

### FR-002 [必须] 迁移 generators/ 文件（12 个）

**系统 MUST** 将以下 12 个文件从根目录迁移至 `generators/` 子目录：

- architecture-ir-generator.ts
- architecture-overview-generator.ts
- config-reference-generator.ts
- cross-package-analyzer.ts
- data-model-generator.ts
- event-surface-generator.ts
- interface-surface-generator.ts
- mock-readme-generator.ts
- pattern-hints-generator.ts
- runtime-topology-generator.ts
- troubleshooting-generator.ts
- workspace-index-generator.ts

**必要性标注**: `[必须]` — Generator 文件是根目录文件数超标的最大来源

---

### FR-003 [必须] 迁移 pipelines/ 文件（5 个）

**系统 MUST** 将以下 5 个文件从根目录迁移至 `pipelines/` 子目录：

- adr-decision-pipeline.ts
- architecture-narrative.ts
- docs-quality-evaluator.ts
- narrative-provenance-adapter.ts
- product-ux-docs.ts

**必要性标注**: `[必须]`

---

### FR-004 [必须] 迁移 models/ 文件（7 个）

**系统 MUST** 将以下 7 个文件从根目录迁移至 `models/` 子目录：

- architecture-ir-model.ts
- architecture-overview-model.ts
- component-view-model.ts
- docs-quality-model.ts
- pattern-hints-model.ts
- runtime-topology-model.ts
- docs-bundle-types.ts

**必要性标注**: `[必须]`

---

### FR-005 [必须] 迁移 builders/ 文件（5 个）

**系统 MUST** 将以下 5 个文件从根目录迁移至 `builders/` 子目录：

- architecture-ir-builder.ts
- component-view-builder.ts
- dynamic-scenarios-builder.ts
- doc-graph-builder.ts
- architecture-ir-mermaid-adapter.ts

**必要性标注**: `[必须]`

---

### FR-006 [必须] 迁移 exporters/ 文件（1 个）

**系统 MUST** 将以下文件从根目录迁移至 `exporters/` 子目录：

- architecture-ir-exporters.ts

**必要性标注**: `[必须]`

---

### FR-007 [必须] 归类并迁移 5 个待分类文件

**系统 MUST** 按以下方式迁移 5 个待分类文件（归类决策见「文件迁移矩阵」章节）：

- coverage-auditor.ts → `pipelines/`（审计属于功能性管道）
- docs-bundle-manifest-reader.ts → `pipelines/`（读取/解析属于管道输入层）
- docs-bundle-orchestrator.ts → `pipelines/`（编排属于管道职责）
- docs-bundle-profiles.ts → `models/`（profiles 为数据配置模型）
- pattern-knowledge-base.ts → `models/`（知识库为数据模型）

**必要性标注**: `[必须]` — 待分类文件若不处理，根目录仍超标

---

### FR-008 [必须] 更新所有文件内部相互引用路径

**系统 MUST** 在文件迁移后，更新每个迁移文件内部 `import` 语句的相对路径，确保引用指向新的正确位置，无悬空引用。

**必要性标注**: `[必须]`

---

### FR-009 [必须] 更新 index.ts 桶文件的导入路径

**系统 MUST** 更新 `src/panoramic/index.ts` 中所有迁移文件的导入路径，从根目录相对路径更新为子目录相对路径（如 `./generators/workspace-index-generator`）。导出的符号名称和集合不得有任何变更。

**必要性标注**: `[必须]`

---

### FR-010 [必须] 更新 13 处外部导入点

**系统 MUST** 更新以下外部文件中对迁移模块的直接路径导入：

- `batch-orchestrator.ts`（7 处）
- `delta-regenerator.ts`（2 处）
- `mcp/server.ts`（2 处）
- `cli/index.ts`（2 处）
- `config/project-config.ts`（1 处）

**必要性标注**: `[必须]` — 外部导入未更新将导致构建失败

[AUTO-RESOLVED: 外部导入文件数量为 5 个，路径已在注入上下文中明确列出，无需人工澄清]

---

### FR-011 [必须] 根目录保留文件清单确认

**系统 MUST** 确保重组后以下文件继续留在 `src/panoramic/` 根目录，不被迁移：

- index.ts
- interfaces.ts
- abstract-registry.ts
- generator-registry.ts
- parser-registry.ts
- project-context.ts
- stored-module-specs.ts
- output-filenames.ts
- cross-reference-index.ts
- batch-project-docs.ts

**必要性标注**: `[必须]` — 这些文件是框架核心，移动会破坏导入合同

---

### FR-012 [可选] 为新建子目录提供桶文件（barrel index）

**系统 MAY** 为每个新建子目录创建 `index.ts` 桶文件，方便子目录级别的集中导入。

**必要性标注**: `[可选]` — 当前外部导入通过根目录 `index.ts` 统一，子目录桶文件非当前迭代必须；可降低未来维护成本但不影响核心功能。

---

## 4. 非功能需求（NFR）

### NFR-001 零破坏性变更

重组完成后，所有外部调用方的行为必须与重组前完全一致。`npm run build` 零错误，全量测试零失败。

### NFR-002 无循环依赖

重组后 `src/panoramic/` 内部的模块依赖图不得存在循环依赖。

### NFR-003 根目录文件数约束

重组完成后 `src/panoramic/` 根目录 `.ts` 文件数量 ≤ 10 个。

### NFR-004 迁移原子性

迁移操作应保持代码库在每个提交节点可构建（即不应出现「文件已移动但引用未更新」的中间状态提交）。

---

## 5. 文件迁移矩阵

| 文件名 | 当前位置 | 目标位置 | 归类依据 |
|--------|----------|----------|----------|
| architecture-ir-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| architecture-overview-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| config-reference-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| cross-package-analyzer.ts | src/panoramic/ | src/panoramic/generators/ | 分析器，输出供 Generator 消费 |
| data-model-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| event-surface-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| interface-surface-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| mock-readme-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| pattern-hints-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| runtime-topology-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| troubleshooting-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| workspace-index-generator.ts | src/panoramic/ | src/panoramic/generators/ | 实现 DocumentGenerator 接口 |
| adr-decision-pipeline.ts | src/panoramic/ | src/panoramic/pipelines/ | 独立函数式管道，非 Generator 接口 |
| architecture-narrative.ts | src/panoramic/ | src/panoramic/pipelines/ | 叙事生成管道 |
| docs-quality-evaluator.ts | src/panoramic/ | src/panoramic/pipelines/ | 质量评估管道 |
| narrative-provenance-adapter.ts | src/panoramic/ | src/panoramic/pipelines/ | 管道适配器 |
| product-ux-docs.ts | src/panoramic/ | src/panoramic/pipelines/ | UX 文档管道 |
| architecture-ir-model.ts | src/panoramic/ | src/panoramic/models/ | 纯数据模型/类型定义 |
| architecture-overview-model.ts | src/panoramic/ | src/panoramic/models/ | 纯数据模型/类型定义 |
| component-view-model.ts | src/panoramic/ | src/panoramic/models/ | 纯数据模型/类型定义 |
| docs-quality-model.ts | src/panoramic/ | src/panoramic/models/ | 纯数据模型/类型定义 |
| pattern-hints-model.ts | src/panoramic/ | src/panoramic/models/ | 纯数据模型/类型定义 |
| runtime-topology-model.ts | src/panoramic/ | src/panoramic/models/ | 纯数据模型/类型定义 |
| docs-bundle-types.ts | src/panoramic/ | src/panoramic/models/ | 类型定义文件 |
| architecture-ir-builder.ts | src/panoramic/ | src/panoramic/builders/ | 构建器，不实现 Generator 接口 |
| component-view-builder.ts | src/panoramic/ | src/panoramic/builders/ | 构建器 |
| dynamic-scenarios-builder.ts | src/panoramic/ | src/panoramic/builders/ | 构建器 |
| doc-graph-builder.ts | src/panoramic/ | src/panoramic/builders/ | 构建器 |
| architecture-ir-mermaid-adapter.ts | src/panoramic/ | src/panoramic/builders/ | IR 到 Mermaid 格式转换，属于构建层 |
| architecture-ir-exporters.ts | src/panoramic/ | src/panoramic/exporters/ | IR 导出器 |
| coverage-auditor.ts | src/panoramic/ | src/panoramic/pipelines/ | 审计功能属于管道职责范畴 |
| docs-bundle-manifest-reader.ts | src/panoramic/ | src/panoramic/pipelines/ | 读取/解析 Manifest 属于管道输入层 |
| docs-bundle-orchestrator.ts | src/panoramic/ | src/panoramic/pipelines/ | 文档包编排属于管道职责 |
| docs-bundle-profiles.ts | src/panoramic/ | src/panoramic/models/ | 配置 Profile 为数据模型 |
| pattern-knowledge-base.ts | src/panoramic/ | src/panoramic/models/ | 知识库为数据模型 |
| index.ts | src/panoramic/ | src/panoramic/ (保留) | 根目录桶文件，不移动 |
| interfaces.ts | src/panoramic/ | src/panoramic/ (保留) | 核心接口定义，不移动 |
| abstract-registry.ts | src/panoramic/ | src/panoramic/ (保留) | 注册中心基类，不移动 |
| generator-registry.ts | src/panoramic/ | src/panoramic/ (保留) | 注册中心，不移动 |
| parser-registry.ts | src/panoramic/ | src/panoramic/ (保留) | 注册中心，不移动 |
| project-context.ts | src/panoramic/ | src/panoramic/ (保留) | 上下文构建，不移动 |
| stored-module-specs.ts | src/panoramic/ | src/panoramic/ (保留) | 框架核心，不移动 |
| output-filenames.ts | src/panoramic/ | src/panoramic/ (保留) | 框架核心，不移动 |
| cross-reference-index.ts | src/panoramic/ | src/panoramic/ (保留) | 框架核心，不移动 |
| batch-project-docs.ts | src/panoramic/ | src/panoramic/ (保留) | 框架核心，不移动 |

**重组后根目录文件数**: 10 个（恰好满足 ≤ 10 的约束）

---

## 6. 外部依赖影响

以下 5 个外部文件包含 13 处对 `src/panoramic/` 的直接路径导入，重组后需更新：

| 外部文件 | 导入数量 | 涉及的迁移模块 | 更新类型 |
|----------|----------|----------------|----------|
| batch-orchestrator.ts | 7 处 | doc-graph-builder → builders/、cross-reference-index（保留）、coverage-auditor → pipelines/、project-context（保留）、batch-project-docs（保留）、docs-bundle-orchestrator → pipelines/、docs-bundle-types → models/ | 路径更新 |
| delta-regenerator.ts | 2 处 | doc-graph-builder → builders/、utils/template-loader（utils/ 已有，路径不变） | 路径更新（1处） |
| mcp/server.ts | 2 处 | generator-registry（保留）、parser-registry（保留） | 无需更新 |
| cli/index.ts | 2 处 | generator-registry（保留）、parser-registry（保留） | 无需更新 |
| config/project-config.ts | 1 处 | parsers/yaml-config-parser（parsers/ 已有，不变） | 无需更新 |

**实际需要更新的外部导入**: batch-orchestrator.ts 中约 3 处（迁移文件）+ delta-regenerator.ts 中 1 处 = 共约 4 处路径变更。其余 9 处导入的目标文件不移动，路径保持不变。

[AUTO-RESOLVED: mcp/server.ts 和 cli/index.ts 的导入目标均为根目录保留文件，无需更新，已自动确认]

---

## 7. 验收标准

| 编号 | 标准 | 验证方式 |
|------|------|----------|
| SC-001 | `src/panoramic/` 根目录 `.ts` 文件数量 ≤ 10 个 | `ls src/panoramic/*.ts \| wc -l` |
| SC-002 | `npm run build` 零错误完成 | CI 构建日志 |
| SC-003 | 全量测试套件全部通过，无回归失败 | `npm test` 输出 |
| SC-004 | 迁移前后 `src/panoramic/index.ts` 的导出符号集合完全一致 | 对比 `tsc --declaration` 生成的 `.d.ts` 导出符号 |
| SC-005 | `src/panoramic/` 内部无循环依赖 | 使用 `madge` 或 TypeScript 编译器循环检测 |
| SC-006 | 5 个待分类文件全部从根目录移除并有明确归属 | 检查根目录文件列表 |

---

## 8. 风险与缓解

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| 文件间相互引用路径遗漏更新，导致构建失败 | 高 | 迁移后立即运行 `npm run build`，将编译错误作为路径遗漏的精确指引 |
| 移动后产生循环依赖 | 中 | 迁移完成后运行 `madge --circular src/panoramic/`，若发现循环则回退对应文件并重新归类 |
| 待分类文件归类决策有误，导致语义混乱 | 低 | 归类决策已在迁移矩阵中记录理由，代码审查时可复核；归类错误不影响功能正确性 |
| index.ts 导出遗漏，外部消费方运行时报错 | 高 | 迁移后对比 TypeScript 声明文件（.d.ts）的导出符号列表，确保 100% 一致 |
| 测试文件中存在未识别的直接路径导入 | 中 | 执行全量测试（`npm test`）作为最终验证；测试失败本身即可定位未更新路径 |

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|-----|------|
| 组件总数 | 5 | 新建 5 个子目录（generators/、pipelines/、models/、builders/、exporters/） |
| 接口数量 | 0 | 不新增或修改任何接口/契约，仅移动文件 |
| 依赖新引入数 | 0 | 不引入任何新外部依赖 |
| 跨模块耦合 | 是（低风险） | 需修改 5 个外部文件（batch-orchestrator、delta-regenerator 等），但仅为路径字符串更新，不修改接口 |
| 复杂度信号 | 无 | 无递归结构、状态机、并发控制、数据迁移 |
| **总体复杂度** | **LOW** | 组件 5 个但接口 0 个，无复杂度信号；本质为纯文件移动 + 路径更新 |

> **LOW 复杂度判定理由**：虽然涉及约 36 个文件的物理迁移和大量路径更新，但所有变更均为机械性路径替换，无业务逻辑变更、无接口变更、无新引入依赖。构建工具可自动验证变更完整性，人工审查负担低。
