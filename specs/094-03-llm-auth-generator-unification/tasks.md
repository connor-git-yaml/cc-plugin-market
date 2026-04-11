# Task Breakdown: F-094-03 LLM/Auth 依赖收敛与 Generator 接口统一

**Feature**: F-094-03 | **Date**: 2026-04-11 | **Plan**: [plan.md](plan.md)

---

## 任务总览

| Task ID | 标题 | 依赖 | 状态 |
|---------|------|------|------|
| T-01 | 新建 `llm-facade.ts`：统一 LLM 调用门面 | — | done |
| T-02 | 改造 `pattern-hints-generator.ts`：切换至 facade | T-01 | done |
| T-03 | 改造 `llm-enricher.ts`：切换至 facade + `isLLMAvailable` | T-01 | done |
| T-04 | 验证 Part A：构建 + 测试 + grep 检查 | T-02, T-03 | done |
| T-05 | 新增 `ComponentViewBuilderGenerator` Adapter | — | done |
| T-06 | 新增 `DynamicScenariosBuilderGenerator` Adapter | T-05 | done |
| T-07 | 新增 `ArchitectureNarrativeGenerator` Adapter + `index.ts` 导出 | — | done |
| T-08 | 新增 `AdrDecisionPipelineGenerator` Adapter | — | done |
| T-09 | 新增 `ProductUxDocsGenerator` Adapter | — | done |
| T-10 | 新增 `DocsQualityEvaluatorGenerator` Adapter | T-05~T-09 | done |
| T-11 | 更新 `bootstrapGenerators()` 注册 6 个新 Adapter | T-05~T-10 | done |
| T-12 | 为 6 个 Adapter 补充 `isApplicable` 测试用例 | T-05~T-10 | done |
| T-13 | 全量验证 | T-04, T-11, T-12 | done |

---

## Part A — LLM 门面收敛

### T-01：新建 `llm-facade.ts`

**文件**：`src/panoramic/utils/llm-facade.ts`（新建）

导出：
- `LLMCallOptions` 接口（systemPrompt, maxTokens, timeout, temperature 均可选）
- `callLLM(prompt, options?)` — 封装 detectAuth→路由→降级逻辑
- `extractJsonArray(text)` — 合并两处私有实现
- `isLLMAvailable()` — 同步封装 detectAuth，供提前判断

内部 import：`src/auth/{auth-detector,cli-proxy,codex-proxy}.ts`。保留 `PANORAMIC_LLM_MODEL` env var 优先级。

### T-02：改造 `pattern-hints-generator.ts`

**文件**：`src/panoramic/generators/pattern-hints-generator.ts`

1. 删除四件套 import
2. 新增 `import { callLLM, extractJsonArray } from '../utils/llm-facade.js'`
3. `callPatternHintsLLM` → `callLLM(prompt, { systemPrompt, timeout: 2500, maxTokens: 1024, temperature: 0.2 })`
4. 删除私有 `extractJsonArray`

### T-03：改造 `llm-enricher.ts`

**文件**：`src/panoramic/utils/llm-enricher.ts`

1. 删除四件套 import
2. 新增 `import { callLLM, extractJsonArray, isLLMAvailable } from './llm-facade.js'`
3. `callLLMSimple` → `callLLM(prompt, { systemPrompt, timeout: 60000, maxTokens: 4096, temperature: 0.3 })`
4. 独立 `detectAuth()` 提前判断 → `isLLMAvailable()`
5. 删除私有 `extractJsonArray`

### T-04：验证 Part A

```bash
npm run build
grep -r "auth-detector\|cli-proxy\|codex-proxy" src/panoramic/ --include="*.ts"  # 仅 llm-facade.ts
npm test -- pattern-hints llm-enricher
```

---

## Part B — Generator 接口适配

### T-05：`ComponentViewBuilderGenerator`（纯计算型）

**文件**：`src/panoramic/builders/component-view-builder.ts`（追加）

- TInput=`ArchitectureIR`, TOutput=`ComponentViewOutput`
- isApplicable: 检查 context 中 IR 数据
- generate: 委托 `buildComponentView()`
- render: 返回文本摘要

### T-06：`DynamicScenariosBuilderGenerator`（纯计算型）

**文件**：`src/panoramic/builders/dynamic-scenarios-builder.ts`（追加）

- TInput=`ComponentViewModel`, TOutput=`DynamicScenariosOutput`
- isApplicable: **检查 context 中是否已有 ComponentViewModel**（无则返回 false）
- extract: 从 context 纯读取 ViewModel
- generate: 委托 `buildDynamicScenarios()`

### T-07：`ArchitectureNarrativeGenerator` + index.ts 导出

**文件 1**：`src/panoramic/pipelines/architecture-narrative.ts`（追加）
**文件 2**：`src/panoramic/index.ts`（修改，补充导出）

- TInput=`ArchitectureIR`, TOutput=`NarrativeOutput`
- 检查 index.ts 无同名符号冲突后添加导出

### T-08：`AdrDecisionPipelineGenerator`（副作用型）

**文件**：`src/panoramic/pipelines/adr-decision-pipeline.ts`（追加）

- 构造函数 `(outputDir: string)`
- generate: 调用 `generateBatchAdrDocs()`，**含 fs 写出**
- render: 纯 Markdown 摘要，**无 fs 调用**

### T-09：`ProductUxDocsGenerator`（副作用型）

**文件**：`src/panoramic/pipelines/product-ux-docs.ts`（追加）

- 构造函数 `(outputDir: string)`
- generate: 调用 `generateProductUxDocs()`，**含 fs 写出**
- render: 纯摘要，**无 fs 调用**

### T-10：`DocsQualityEvaluatorGenerator`（聚合评估型）

**文件**：`src/panoramic/pipelines/docs-quality-evaluator.ts`（追加）

- 构造函数 `(outputDir: string)`
- extract: **编排感知型** — 从 outputDir 读上游 JSON，各字段可选
- 必须最后注册

### T-11：更新 `bootstrapGenerators()` 注册

**文件**：`src/panoramic/generator-registry.ts`

签名扩展为 `bootstrapGenerators(outputDir?: string)`，末尾按顺序注册：
1. ComponentViewBuilderGenerator
2. ArchitectureNarrativeGenerator
3. AdrDecisionPipelineGenerator(outputDir)
4. ProductUxDocsGenerator(outputDir)
5. DynamicScenariosBuilderGenerator
6. DocsQualityEvaluatorGenerator(outputDir)

### T-12：`isApplicable` 测试用例

每个 Adapter 至少 2 个用例（true + false）。

### T-13：全量验证

```bash
npm run build                    # AC-007
npm test                         # AC-010
# Registry = 19                  # AC-002
# isApplicable 覆盖              # AC-003
# render 无 fs                   # AC-009
# architecture-narrative 导出    # AC-008
```
