# Tech Research: 053 Batch 全景项目文档套件与架构叙事输出

## 方案选择

### 方案 A: 仅在 CLI 层拼装项目级文档

- 优点：实现位置集中在 `src/cli/commands/batch.ts`
- 缺点：无法复用到 `runBatch()` 调用方；测试和 coverage audit 仍会看到“编排层未接通”的问题

结论：不采用。

### 方案 B: 在 `runBatch()` 末尾直接编排项目级 generators，并新增 batch 专用叙事文档

- 优点：最贴近事实源，CLI / 测试 / E2E / 未来 API 调用都能复用
- 优点：可直接复用 `GeneratorRegistry`、`buildProjectContext()`、`writeMultiFormat()`
- 优点：能与 `coverage-auditor` 使用同一套命名映射
- 风险：需要处理 `--incremental` 模式下“当前 module spec 不完整”的问题

结论：采用。

## 关键设计

### 1. 项目级输出编排器

新增 batch 内部 helper，职责：

- 构建 `ProjectContext`
- 发现 applicable generators
- 统一写 `md/json/mmd`
- 汇总写出文件路径和 warnings

### 2. 输出命名共享映射

新增共享命名 helper，至少统一：

- `cross-package-deps -> cross-package-analysis`
- 其余默认 `generatorId`

后续 `coverage-auditor` 与 batch 同时依赖这份映射。

### 3. 架构叙事文档的数据来源

优先级：

1. 当前运行产生的 `ModuleSpec[]`
2. 输出目录中已有 module spec 的解析结果
3. `architecture-overview` / `runtime-topology` / `workspace-index` 结构化输出
4. `ProjectContext` 与目录级事实

### 4. 关键类 / 方法提炼策略

- 关键类 / 类型：优先从 `baselineSkeleton.exports` 中选择 `class/interface/type/data_class/struct/protocol`
- 关键方法 / 函数：优先选择
  - class members 中的 public `method/getter/setter/constructor`
  - 顶层 function exports
- 排序启发式：
  - 先按模块重要性
  - 再按导出成员数量、签名复杂度、名称权重（如 `create`/`connect`/`query`/`start`/`run`/`handle`/`parse`/`generate`）

### 5. 增量模式兼容

为保证 narrative 不丢失未重生成模块，需要解析输出目录中已有 module spec 的最小必要事实：

- frontmatter
- `intent` / `businessLogic` / `dependencies`
- `baseline-skeleton` 注释

不必完整还原所有渲染细节，只要能满足 narrative 与项目级聚合即可。
