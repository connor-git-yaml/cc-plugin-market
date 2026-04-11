# 技术调研报告：F-094-03

**日期**: 2026-04-11 | **模式**: codebase-scan

---

## Part A: LLM 调用链路

### 1. 4 件套定义位置与签名

| 函数 | 定义文件 | 签名概要 |
|------|---------|---------|
| `detectAuth` | `src/llm/auth-detector.ts` | `(): AuthInfo` — 检测可用的 LLM 认证方式 |
| `callLLMviaCli` | `src/llm/cli-proxy.ts` | `(prompt, systemPrompt?, options?): Promise<string \| null>` |
| `callLLMviaCodex` | `src/llm/codex-proxy.ts` | `(prompt, systemPrompt?, options?): Promise<string \| null>` |
| `resolveReverseSpecModel` | `src/llm/auth-detector.ts` | `(): string` — 解析模型名，优先 `PANORAMIC_LLM_MODEL` env var |

### 2. 引用清单（全量扫描）

仅 2 个文件存在完整 4-import 模式：
- `src/panoramic/generators/pattern-hints-generator.ts` — 4 个函数全部导入
- `src/panoramic/utils/llm-enricher.ts` — 4 个函数全部导入

其他文件无直接导入。

### 3. pattern-hints-generator 调用模式

- 私有函数 `callPatternHintsLLM(prompt, systemPrompt)`
- 流程：`detectAuth()` → 分支路由（cli/codex/sdk）→ 返回 `string | null`
- 参数：`max_tokens: 1024`, `temperature: 0.2`, `timeout: 2500ms`（速度敏感）
- 降级：auth 失败返回 null，不抛异常
- 包含 `extractJsonArray()` 私有实现

### 4. llm-enricher 调用模式

- 私有函数 `callLLMSimple(prompt, systemPrompt, maxTokens?)`
- 流程：与 pattern-hints-generator 完全相同（~30 行复制）
- 参数：`max_tokens: 4096`, `temperature: 0.3`, `timeout: 60000ms`（批量处理）
- 降级：同上，返回 null
- 包含 `extractJsonArray()` 重复实现

### 5. 调用模式异同分析

| 维度 | pattern-hints | llm-enricher |
|------|--------------|-------------|
| timeout | 2,500ms | 60,000ms |
| max_tokens | 1,024 | 4,096 |
| temperature | 0.2 | 0.3 |
| 核心路由逻辑 | 完全相同 | 完全相同 |
| extractJsonArray | 有（私有） | 有（私有，重复） |

**结论**: 认证检测 + provider 路由逻辑完全重复。`llm-facade.ts` 需统一这 30 行核心分支，参数通过 `LLMCallOptions` 透传。

---

## Part B: Generator 接口

### 6. DocumentGenerator 接口定义

```typescript
interface DocumentGenerator<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  isApplicable(context: ProjectContext): boolean;
  extract(context: ProjectContext): TInput | Promise<TInput>;
  generate(input: TInput): TOutput | Promise<TOutput>;
  render(output: TOutput): string | Promise<string>;
}
```

4 个方法全部必选；泛型 TInput/TOutput 由实现方定义。

### 7. 现有 Generator 实现模式

已有 Generator 遵循统一模式：
- `isApplicable`: 检查 context 中的必要数据是否存在
- `extract`: 从 ProjectContext 提取所需子集
- `generate`: 纯计算/转换，返回结构化数据
- `render`: 将结构化数据渲染为 Markdown 字符串

### 8. GeneratorRegistry 注册模式

`bootstrapGenerators()` 当前注册 **13 个** Generator。采用 `registry.register(new XxxGenerator())` 模式，顺序注册。

### 9. 6 个目标模块函数签名

**三类异质性场景**：

**纯计算型（简单 Adapter）**:
- `component-view-builder`: `buildComponentView(ir, options?) → ComponentViewOutput` — 已有 build/render 分离
- `dynamic-scenarios-builder`: `buildDynamicScenarios(componentView, options?) → DynamicScenariosOutput` — 注意输入是 `ComponentViewModel` 而非完整 output
- `architecture-narrative`: `buildArchitectureNarrative(ir, options?) → NarrativeOutput` + `renderArchitectureNarrative(output) → string`

**编排层 + 文件写出型（复杂 Adapter）**:
- `adr-decision-pipeline`: `generateBatchAdrDocs(outputDir, context, options?) → AdrIndexOutput` — 含 `fs.writeFileSync` 副作用
- `product-ux-docs`: `generateProductUxDocs(outputDir, context, options?) → ProductUxDocsOutput` — 含文件写出

**聚合评估型（最复杂 Adapter）**:
- `docs-quality-evaluator`: `evaluateDocsQuality(options: EvaluateDocsQualityOptions) → DocsQualityReport` — 依赖多达 11 个可选上游输出

### 10. index.ts 导出现状

5/6 模块已在 `src/panoramic/index.ts` 导出。唯一缺失：`architecture-narrative`（未导出）。

---

## 关键发现与风险点

| ID | 发现 | 影响 | 缓解策略 |
|----|------|------|---------|
| F1 | 4-import 核心路由逻辑 ~30 行完全复制 | facade 统一目标明确 | `callLLM(options)` 统一入口 |
| F2 | Timeout 差异极大（2.5s vs 60s）| facade 不能硬编码 | `LLMCallOptions` 参数对象，调用方覆盖 |
| F3 | `PANORAMIC_LLM_MODEL` env var 优先级 | facade 必须保留 | 在 facade 内部复制此逻辑 |
| F4 | `extractJsonArray` 两份重复实现 | 可一并收敛 | facade 或 utils 导出共享版本 |
| F5 | 6 个模块异质性高（3 类） | Adapter 实现难度不一 | 分类实施策略 |
| F6 | adr/product-ux 有文件写出副作用 | `generate()` vs `render()` 边界 | 副作用留 `generate()`，`render()` 纯渲染 |
| F7 | docs-quality-evaluator extract 依赖 11 个上游 | 标准 extract 契约不够 | 设计"编排感知型"extract 从 outputDir 读 JSON |
| F8 | architecture-narrative 缺少 index.ts 导出 | 需同步补充 | Part B 实施时处理 |
| F9 | dynamic-scenarios 输入是 ComponentViewModel | TInput 设计需精确 | 明确 TInput 类型 |
| F10 | bootstrapGenerators 注册顺序有隐式依赖 | 新增 6 个需排序 | 按依赖图排列注册顺序 |
