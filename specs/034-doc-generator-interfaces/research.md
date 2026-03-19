# Feature 034 技术决策研究

**Feature**: DocumentGenerator + ArtifactParser 接口定义
**日期**: 2026-03-19
**状态**: 已完成

---

## 决策 1: 泛型接口的类型参数设计

### 问题

DocumentGenerator 需要支持不同文档类型各自的输入/输出数据结构。如何设计泛型参数使其既类型安全又足够灵活？

### 结论

采用 `DocumentGenerator<TInput, TOutput>` 双泛型参数设计。TInput 约束为 `extract()` 的返回类型，TOutput 约束为 `generate()` 的返回类型。不添加基类型约束（即不写 `extends BaseInput`），因为 Phase 0 阶段各 Generator 的输入/输出结构尚未确定，过早约束会限制灵活性。

### 理由

- 参考 Docusaurus Plugin 的 `Plugin<Content>` 单泛型参数，但 DocumentGenerator 的 `extract` 和 `generate` 分离了数据提取与转换两个关注点，需要独立类型参数
- 参考现有 LanguageAdapter 的 `analyzeFile() → CodeSkeleton` 模式——LanguageAdapter 返回固定类型，而 DocumentGenerator 需要多态返回
- ArtifactParser 采用单泛型 `<T>` 足够，因为 `parse()` 直接返回结构化数据，无中间转换步骤

### 替代方案

1. **单泛型 `<T>` + 固定 Input 类型**: 限制了 extract 步骤返回不同数据结构的能力——被拒绝
2. **三泛型 `<TContext, TInput, TOutput>`**: TContext 统一为 ProjectContext，无需泛型化——过度设计，被拒绝
3. **联合类型替代泛型**: 丢失编译期类型安全——被拒绝

---

## 决策 2: isApplicable 返回类型设计

### 问题

`isApplicable()` 应该返回 `boolean`、`Promise<boolean>` 还是联合类型 `boolean | Promise<boolean>`？

### 结论

采用联合类型 `boolean | Promise<boolean>`。调用方统一用 `Promise.resolve()` 包装处理。

### 理由

- 简单的文件存在性检查（如检测 package.json）可同步返回，避免不必要的 async 开销
- 复杂判断（如需要读取文件内容分析框架类型）需要异步返回
- 参考 LanguageAdapter 中 `buildDependencyGraph?()` 的可选异步模式，为不同复杂度的判断提供灵活性
- spec.md FR-002 明确要求此设计

### 替代方案

1. **统一 `Promise<boolean>`**: 强制所有实现为 async——简单判断增加不必要开销，被拒绝
2. **统一 `boolean`**: 限制了需要文件 I/O 的异步判断——被拒绝

---

## 决策 3: Zod Schema 与接口定义的文件组织

### 问题

Zod Schema 应与接口定义放在同一文件还是拆分为独立文件？

### 结论

同一文件 `src/panoramic/interfaces.ts`。组织顺序：Zod Schema 定义 -> `z.infer<>` 类型推导 -> 手写 interface 引用推导类型。

### 理由

- 参考现有 `src/models/code-skeleton.ts` 的模式：Schema 定义 + `z.infer` + `export type` 全部在同一文件
- 同文件组织避免 Schema 与 interface 的类型兼容性 drift
- spec.md FR-011 明确要求此组织方式
- 当前文件体量预估约 200-300 行，未超过单文件可管理阈值

### 替代方案

1. **独立 `schemas.ts` 文件**: Schema 与 interface 分离增加维护成本和 drift 风险——被拒绝
2. **Schema 与 interface 分别导出，通过测试保证一致性**: 增加测试负担——被拒绝

---

## 决策 4: ProjectContext 最小占位版本的字段设计

### 问题

Feature 035 负责完整的 ProjectContext 实现，但 034 的接口定义和 Mock Generator 需要引用它。如何设计最小占位版本？

### 结论

定义最小版本包含两个属性：`projectRoot: string` 和 `configFiles: Map<string, string>`。用 Zod Schema 定义并导出类型。放在 `src/panoramic/interfaces.ts` 中而非独立文件。

### 理由

- `projectRoot` 是所有 Generator/Parser 的基本需求——定位项目文件
- `configFiles` 满足 Mock Generator 的 `isApplicable()` 检查需求（检测 package.json 是否存在）
- 蓝图依赖矩阵标注 034 和 035 无相互依赖，034 不应依赖 035 的完整交付物
- Feature 035 可通过扩展（TypeScript interface extends）此占位定义添加 `detectedLanguages`、`workspaceType` 等属性

### 替代方案

1. **使用 `any` 类型占位**: 丢失类型安全——被拒绝
2. **定义完整 ProjectContext**: 侵入 Feature 035 的交付范围——被拒绝
3. **仅 `projectRoot` 一个属性**: Mock Generator 的 `isApplicable()` 无法检测配置文件——不够用，被拒绝

---

## 决策 5: GenerateOptions 最小字段集

### 问题

`generate(input, options?)` 的 options 参数应包含哪些字段？

### 结论

定义三个可选字段：
- `useLLM?: boolean`（默认 false，是否启用 LLM 增强）
- `templateOverride?: string`（自定义 Handlebars 模板路径）
- `outputFormat?: 'markdown'`（预留枚举，当前仅 markdown）

### 理由

- `useLLM` 是蓝图 6.1 节和 tech-research 5.1 节降级机制的核心开关
- `templateOverride` 对标现有 `spec-renderer.ts` 的 Handlebars 模板机制
- `outputFormat` 预留未来扩展（如 JSON、HTML），当前仅支持 markdown
- 后续 Phase 1 各 Generator 可通过 TypeScript 类型交叉（`GenerateOptions & DataModelSpecificOptions`）扩展 Generator 特定选项

### 替代方案

1. **空 options 类型，后续再定义**: Mock Generator 无法验证 options 传递——被拒绝
2. **包含 `verbose`、`maxTokens` 等更多字段**: 034 范围内无需求驱动——过度设计，被拒绝

---

## 决策 6: Mock Generator 的选择

### 问题

用哪种 Mock Generator 来验证接口设计的可行性？

### 结论

实现 `MockReadmeGenerator`，模拟一个 README 文档生成器。

### 理由

- README 是最简单、最通用的文档类型——适合作为接口验证的冒烟测试
- `isApplicable`: 检查 ProjectContext.configFiles 中是否有 package.json
- `extract`: 从 configFiles 中提取项目名称和描述
- `generate`: 将提取数据转换为结构化 ReadmeOutput
- `render`: 渲染为简单的 Markdown README 字符串
- 四步生命周期均有明确的输入输出，便于单元测试

### 替代方案

1. **MockDataModelGenerator**: 需要 AST 分析能力，Mock 实现过于复杂——被拒绝
2. **MockLicenseGenerator**: 过于简单，无法充分验证 extract/generate 的数据转换——被拒绝

---

## 决策 7: 文件组织结构

### 问题

`src/panoramic/` 目录下的文件如何组织？

### 结论

```
src/panoramic/
├── interfaces.ts          # 核心接口 + Zod Schema + 辅助类型
└── mock-readme-generator.ts  # Mock Generator 实现

tests/panoramic/
├── schemas.test.ts        # Zod Schema 单元测试
└── mock-generator.test.ts # Mock Generator 生命周期测试
```

### 理由

- `interfaces.ts` 单文件包含所有接口定义、Zod Schema 和辅助类型——与 `code-skeleton.ts` 模式一致
- Mock Generator 独立文件——关注点分离，且后续会被真正的 Generator 替代
- 测试目录 `tests/panoramic/` 与源码目录 `src/panoramic/` 对称——遵循现有 tests/ 结构
- `src/panoramic/index.ts` barrel 文件暂不创建——Phase 0 仅两个文件，待 Feature 036（GeneratorRegistry）时再创建

### 替代方案

1. **按类型拆分（types/、schemas/、mocks/）**: 当前文件数量过少，子目录增加无必要复杂度——被拒绝
2. **放在 `src/models/` 下**: 违反 FR-025 正交性要求——被拒绝

---

## 决策 8: render() 返回类型设计

### 问题

`render()` 应该返回 `string`、`Promise<string>` 还是联合类型？

### 结论

采用联合类型 `string | Promise<string>`，与 `isApplicable()` 的设计保持一致。

### 理由

- 简单的字符串模板拼接可同步返回
- 使用 Handlebars 模板文件渲染需要异步文件读取
- 保持接口一致性（isApplicable 和 render 均为可选异步，extract 和 generate 为强制异步）
- spec.md FR-005 明确要求此设计

### 替代方案

1. **统一 `Promise<string>`**: 简单渲染增加不必要开销——被拒绝
2. **返回 `DocumentOutput` 结构体**: render 的输出是最终产物（Markdown 字符串），不需要额外包装——被拒绝
