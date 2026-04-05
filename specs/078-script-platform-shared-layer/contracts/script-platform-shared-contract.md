# Contract: Script Platform Shared Layer

## 1. Scope

本合同定义 078 新增共享层对六条主链脚本提供的最小可复用接口，以及必须保持稳定的外部行为边界。

适用脚本：

- `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`
- `plugins/spec-driver/scripts/generate-workflow-registry.mjs`
- `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`
- `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- `plugins/spec-driver/scripts/generate-adoption-insights.mjs`
- `plugins/spec-driver/scripts/generate-project-context-suggestions.mjs`

## 2. Shared Module Contracts

### 2.1 `simple-yaml.mjs`

**Exports**

```js
parseYamlDocument(content: string): Record<string, unknown>
stringifyYaml(value: unknown, indent?: number): string
```

**Behavior**

- 输入空内容时返回空 object
- 输出 YAML 文本必须稳定且可被同模块 `parseYamlDocument` 消费
- 对不支持的 YAML 结构保持当前保守行为，不新增复杂语义

### 2.2 `script-report-io.mjs`

**Exports**

```js
ensureArtifactDir(filePath: string): void
writeJsonArtifact(filePath: string, value: unknown): void
writeMarkdownArtifact(filePath: string, content: string): void
writeYamlArtifact(filePath: string, value: unknown): void
readJsonArtifact(filePath: string): unknown | null
```

**Behavior**

- 写入前自动创建父目录
- JSON 输出保持 `JSON.stringify(value, null, 2) + "\n"`
- Markdown / YAML 输出默认以单个换行结束
- 读取 JSON 失败时返回 `null`，由调用方决定是否记录 warning

### 2.3 `product-artifact-patchers.mjs`

**Exports**

```js
patchYamlArtifact(filePath: string, mutateFn: (doc: Record<string, unknown>) => Record<string, unknown>): boolean
patchProductCatalogIndex(projectRoot: string, mutateProductFn: (product: Record<string, unknown>) => Record<string, unknown>): boolean
```

**Behavior**

- 目标文件缺失时返回 `false`，不抛 fatal error
- patch 过程保留当前 preferred/legacy path 规则
- 共享层只负责读写骨架，不决定业务字段名

### 2.4 `script-diagnostics.mjs`

**Exports**

```js
dedupeStringValues(items: unknown[]): string[]
appendWarningsSection(lines: string[], warnings: string[], heading?: string): string[]
escapeMarkdownTableCell(value: unknown): string
```

**Behavior**

- warning 结果必须去重并过滤空值
- `appendWarningsSection` 在 warnings 为空时默认不输出 section
- helper 只处理通用 Markdown 片段，不负责报告主体模板

## 3. Backward Compatibility Rules

- 脚本 CLI 入口名不变
- `--project-root` / `--json` 参数不变
- 现有输出路径保持不变：
  - `specs/products/<product>/_generated/**`
  - `specs/products/_generated/**`
  - `.specify/project-context.suggestions.*`
- 现有主要 JSON payload 字段保持不变
- 缺失 artifact 文件时继续沿用当前“跳过 / 降级 / warning”语义

## 4. Verification Contract

078 交付前必须满足：

1. 共享层 unit tests 覆盖 YAML、IO、patch、diagnostics
2. 六条主链相关 integration tests 通过
3. `npm run lint` 通过
4. `npm run build` 通过
5. `npm test` 通过
6. 代码检索确认不再保留多份功能等价的本地 `parseYamlDocument` / `stringifyYaml`
