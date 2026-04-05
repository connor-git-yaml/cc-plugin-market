# Data Model: Script Platform 共享层收敛

## 1. Shared YAML Model

### `ScriptYamlHelper`

| 字段 / 能力 | 类型 | 说明 |
|------------|------|------|
| `parseYamlDocument(content)` | function | 解析仓库当前支持子集的 YAML，返回 object |
| `stringifyYaml(value, indent?)` | function | 以稳定格式序列化 object/array/scalar 到 YAML |

**约束**:

- 只支持当前脚本依赖的 YAML 子集
- `null / boolean / number / string / array / object` 的序列化规则必须稳定
- 不引入 anchor、merge key、复杂 multiline block 等新语义

## 2. Shared Report IO Model

### `ScriptReportArtifact`

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | 输出目标路径 |
| `format` | `'json' \| 'markdown' \| 'yaml'` | 序列化格式 |
| `content` | unknown | 要写出的内容 |
| `appendTrailingNewline` | boolean | 是否保证文件末尾换行 |

### `ScriptReadResult<T>`

| 字段 | 类型 | 说明 |
|------|------|------|
| `exists` | boolean | 文件是否存在 |
| `value` | `T \| null` | 成功解析后的值 |
| `warning` | `string \| null` | 读取失败或解析失败时的 warning |

## 3. Shared Patch Model

### `ArtifactPatchOperation`

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetPath` | string | 需要更新的 YAML 文件路径 |
| `skipIfMissing` | boolean | 缺失时是否静默跳过 |
| `mutate` | function | 接收当前文档并返回更新后文档 |

### `ProductSummaryPatch`

| 字段 | 类型 | 说明 |
|------|------|------|
| `productId` | string | 产品 ID |
| `fields` | `Record<string, unknown>` | 要合并到 catalog product summary 的字段 |

## 4. Diagnostics Model

### `ScriptDiagnostics`

| 字段 | 类型 | 说明 |
|------|------|------|
| `warnings` | `string[]` | 去重后的 warning 列表 |
| `warningCount` | number | warning 数量 |

### `WarningsSectionOptions`

| 字段 | 类型 | 说明 |
|------|------|------|
| `heading` | string | Markdown 标题，默认 `## Warnings` |
| `emptyBehavior` | `'skip' \| 'render-empty'` | warning 为空时的渲染策略 |

## 5. Script Migration Coverage

| 脚本 | 共享 YAML | 共享 IO | 共享 Patch | 共享 Diagnostics |
|------|-----------|---------|------------|------------------|
| `generate-product-entity-catalog.mjs` | 是 | 是 | 可选 | 是 |
| `generate-workflow-registry.mjs` | 是 | 是 | 否 | 是 |
| `generate-product-quality-reports.mjs` | 是 | 是 | 是 | 是 |
| `generate-product-scorecards.mjs` | 是 | 是 | 是 | 是 |
| `generate-adoption-insights.mjs` | 否 | 是 | 否 | 是 |
| `generate-project-context-suggestions.mjs` | 是 | 是 | 否 | 是 |

## 6. Non-Goals in Model

- 不定义统一 `Report` 超类型来覆盖所有业务报告
- 不定义新的产品事实 schema
- 不把 `spec-driver-sync` orchestration 本身抽象成新编排器
