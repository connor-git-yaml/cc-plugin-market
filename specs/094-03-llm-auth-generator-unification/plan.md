# Implementation Plan: F-094-03 LLM/Auth 依赖收敛与 Generator 接口统一

**Branch**: `feature/089-skill-orchestration-split` | **Date**: 2026-04-11 | **Spec**: [spec.md](spec.md)

---

## Summary

分两个独立部分实施：

- **Part A — LLM 门面收敛**：新增 `src/panoramic/utils/llm-facade.ts`，收敛 `pattern-hints-generator.ts` 和 `llm-enricher.ts` 中各 ~30 行重复路由逻辑和两份 `extractJsonArray`。
- **Part B — Generator 接口适配**：为 6 个模块各添加 Adapter 类（同文件委托），注册到 `bootstrapGenerators()`，Registry 从 13→19。

Part A/B 技术上独立，建议 Part A 先行。

---

## 实施策略

### Part A（LLM 门面）

1. 新建 `llm-facade.ts`：提取 `callLLM(prompt, options?)` + `extractJsonArray` + `isLLMAvailable()`
2. 改造 `pattern-hints-generator.ts`：删除四件套 import → `import { callLLM, extractJsonArray } from '../utils/llm-facade.js'`
3. 改造 `llm-enricher.ts`：同上，额外将独立 `detectAuth()` 提前判断改为 `isLLMAvailable()`

### Part B（Generator 适配）

按三类分批：
- **B1 纯计算型**（3 个）：`ComponentViewBuilderGenerator`、`DynamicScenariosBuilderGenerator`、`ArchitectureNarrativeGenerator` + 补充 index.ts 导出
- **B2 副作用型**（2 个）：`AdrDecisionPipelineGenerator`、`ProductUxDocsGenerator`（构造函数注入 outputDir，副作用留 generate）
- **B3 聚合评估型**（1 个）：`DocsQualityEvaluatorGenerator`（编排感知型 extract，最后注册）+ `bootstrapGenerators()` 注册全部 6 个

---

## 实施步骤

### A-1 新建 `src/panoramic/utils/llm-facade.ts`

```typescript
export interface LLMCallOptions {
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
}

export async function callLLM(prompt: string, options?: LLMCallOptions): Promise<string | null>
export function extractJsonArray(text: string): unknown[]
export function isLLMAvailable(): boolean  // 封装 detectAuth，供需要提前判断的调用方
```

内部 import：`src/auth/auth-detector.ts`、`src/auth/cli-proxy.ts`、`src/auth/codex-proxy.ts`。保留 `PANORAMIC_LLM_MODEL` env var 优先级。所有异常 catch 返回 null。

### A-2 改造 `pattern-hints-generator.ts`

- 删除四件套 import（detectAuth, callLLMviaCli, callLLMviaCodex, resolveReverseSpecModel）
- 新增 `import { callLLM, extractJsonArray } from '../utils/llm-facade.js'`
- `callPatternHintsLLM` → 直接调用 `callLLM(prompt, { systemPrompt, timeout: 2500, maxTokens: 1024, temperature: 0.2 })`
- 删除私有 `extractJsonArray` 定义

### A-3 改造 `llm-enricher.ts`

- 删除四件套 import
- 新增 `import { callLLM, extractJsonArray, isLLMAvailable } from './llm-facade.js'`
- `callLLMSimple` → 调用 `callLLM(prompt, { systemPrompt, timeout: 60000, maxTokens: 4096, temperature: 0.3 })`
- 独立 `detectAuth()` 提前判断 → 改为 `isLLMAvailable()`
- 删除私有 `extractJsonArray` 定义

### A-4 验证 Part A

```bash
npm run build
grep -r "auth-detector\|cli-proxy\|codex-proxy" src/panoramic/ --include="*.ts"  # 仅 llm-facade.ts
npm test -- pattern-hints llm-enricher
```

### B1-1~B1-3 纯计算型 Adapter（3 个）

各 Adapter 同文件追加，委托现有函数：
- `ComponentViewBuilderGenerator`: TInput=`BuildComponentViewOptions`, TOutput=`ComponentViewOutput`
- `DynamicScenariosBuilderGenerator`: TInput=`BuildDynamicScenariosOptions`(含 ComponentViewModel), isApplicable 检查 ViewModel 存在
- `ArchitectureNarrativeGenerator`: TInput=`BuildArchitectureNarrativeOptions`, TOutput=`ArchitectureNarrativeOutput`

额外：`src/panoramic/index.ts` 补充 `architecture-narrative` 导出

### B2-1~B2-2 副作用型 Adapter（2 个）

- `AdrDecisionPipelineGenerator`: 构造函数 `(outputDir: string)`，generate 包含 fs 写出，render 纯文本
- `ProductUxDocsGenerator`: 同上模式

### B3-1 聚合评估型 Adapter（1 个）

- `DocsQualityEvaluatorGenerator`: 构造函数 `(outputDir: string)`，extract 从 outputDir 读上游 JSON，最后注册

### B3-2 `bootstrapGenerators()` 注册更新

签名扩展为 `bootstrapGenerators(outputDir?: string)`，末尾追加 6 个 Adapter：
```
component-view-builder → architecture-narrative → adr-decision-pipeline → product-ux-docs → dynamic-scenarios-builder → docs-quality-evaluator
```

### B3-3 全量验证

```bash
npm run build                    # AC-007
npm test                         # AC-010
# Registry 数量 = 19            # AC-002
# isApplicable 测试             # AC-003
```

---

## 验证策略

| 批次 | 验证命令 | 关联 AC |
|------|---------|---------|
| Part A | `npm run build` + `npm test -- pattern-hints llm-enricher` + grep AC-001 | AC-001、AC-005、AC-006 |
| B1（纯计算型） | `npm run build` + `npm test` | AC-004、AC-008 |
| B2（副作用型） | `npm run build` + render() 无 fs 验证 | AC-004、AC-009 |
| B3（聚合+注册） | `npm run build` + `npm test` + Registry=19 | AC-002、AC-003、AC-007、AC-010 |

---

## 风险等级

**LOW** — 影响 10 个文件，无跨包影响，无数据迁移，不修改已有公共接口签名。所有变更为追加类或替换 import，TypeScript 编译器可精确定位所有路径错误。

### 关键风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| callLLM facade 引入细微行为差异 | 高 | 逐行对照原私有函数核查，Part A 改造后立即运行现有测试 |
| llm-enricher 独立 detectAuth 处理不当致 AC-001 不通过 | 中 | 新增 `isLLMAvailable()` 替代直接 import |
| bootstrapGenerators 签名扩展破坏调用方 | 中 | outputDir 设为可选参数，检查所有入口调用点 |
| docs-quality-evaluator JSON 文件命名约定不明确 | 中 | 实现前检查 outputDir 实际产出文件名 |
