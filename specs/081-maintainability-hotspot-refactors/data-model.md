# Data Model: 可读性与维护性热点重构

## 1. Complexity Baseline Model

### `HotspotScriptBaseline`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 热点脚本标识，如 `product-scorecards` |
| `path` | string | 入口文件路径 |
| `lineCount` | number | 重构前/后的行数 |
| `inlineHelperCount` | number | 入口文件内联 helper 数量 |
| `responsibilityAreas` | string[] | 当前承担的主要职责分类 |

**用途**:

- 在 verification report 中记录复杂度下降证据
- 明确 081 的重构对象和边界

## 2. Thin Entry Model

### `ThinOrchestratorEntry`

| 字段 | 类型 | 说明 |
|------|------|------|
| `scriptPath` | string | 外部 CLI 入口路径 |
| `parseArgs` | function | 参数解析函数 |
| `mainFlow` | function | 主流程 orchestration |
| `outputContract` | string[] | 需要保持兼容的输出字段或产物路径 |

**约束**:

- 入口保留 CLI 合同
- 入口不再承载大块领域 helper

## 3. Scorecard Core Model

### `ScorecardGenerationInput`

| 字段 | 类型 | 说明 |
|------|------|------|
| `projectRoot` | string | 项目根目录 |
| `productId` | string | 产品 ID |
| `productDef` | object | product mapping 中的产品定义 |
| `entity` | object | entity.yaml 解析结果 |
| `qualityReport` | object \| null | 对应 quality-report.json 内容 |
| `workflowIndex` | object \| null | workflow-index.json 内容 |
| `repoMeta` | object | Git remote/default branch 信息 |
| `branchPolicy` | object | branch sync policy 探测结果 |

### `ScorecardReportBundle`

| 字段 | 类型 | 说明 |
|------|------|------|
| `report` | object | 最终 scorecard report JSON 对象 |
| `markdown` | string | 渲染后的 Markdown |
| `summaryEntry` | object | 写入 scorecard-index.yaml / catalog 的摘要 |

## 4. Quality Core Model

### `QualityDocumentRef`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 文档 ID |
| `title` | string | 文档标题 |
| `path` | string \| null | 文档路径 |
| `required` | boolean | 是否 required doc |
| `available` | boolean | 当前是否存在 |
| `sourceType` | string | spec / generated / config 等来源 |

### `QualityReportBundle`

| 字段 | 类型 | 说明 |
|------|------|------|
| `report` | object | 最终 quality report JSON 对象 |
| `markdown` | string | 渲染后的 Markdown |
| `summaryEntry` | object | 写入 quality index / catalog 的摘要 |

## 5. Workflow Registry Core Model

### `WorkflowRegistryInput`

| 字段 | 类型 | 说明 |
|------|------|------|
| `workflowDir` | string | 默认 workflow 定义目录 |
| `overrideDir` | string | 项目级 override 目录 |
| `warnings` | string[] | merge 过程中累积的 warning |

### `WorkflowRegistryBundle`

| 字段 | 类型 | 说明 |
|------|------|------|
| `indexJson` | object | workflow-index.json 的完整内容 |
| `markdown` | string | workflow-index.md 的完整内容 |
| `workflows` | object[] | merge 后的 workflow 列表 |
| `goldenPaths` | object[] | golden path 列表 |

## 6. Init Project Phase Model

### `InitProjectStatusSnapshot`

| 字段 | 类型 | 说明 |
|------|------|------|
| `projectRoot` | string | 当前项目根 |
| `specifyDir` | string | `.specify` 目录路径 |
| `needsConstitution` | boolean | 是否缺 constitution |
| `needsConfig` | boolean | 是否缺 config |
| `hasGatePolicy` | boolean | 是否检测到 gate_policy |
| `hasSpecDriverSkills` | boolean | 是否检测到项目 override skills |
| `projectContextMode` | string | `missing/yaml/legacy-md/dual` |
| `results` | string[] | 阶段结果列表 |

### `InitProjectOutputRenderContext`

| 字段 | 类型 | 说明 |
|------|------|------|
| `outputMode` | `'json' \| 'text'` | 输出模式 |
| `snapshot` | `InitProjectStatusSnapshot` | 状态快照 |

## 7. Non-Goals in Model

- 不定义新的产品事实 schema
- 不改变现有 JSON / Markdown / YAML 报告业务合同
- 不把所有 shell 状态都迁成 TypeScript 运行时对象
