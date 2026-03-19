# Feature 051 技术决策研究

**Feature**: 语义增强 + 多格式输出
**Branch**: `051-semantic-enrichment-multiformat`
**Date**: 2026-03-19

---

## Decision 1: LLM 调用方式 — 新建轻量级 enrichment 调用函数 vs. 复用 callLLM

### 问题

现有 `callLLM(context: AssembledContext, ...)` 要求传入 `AssembledContext`，这是 spec-generation 流水线专属的复杂类型（含 prompt、tokenCount、breakdown 等）。语义增强场景仅需发送简单的 system + user prompt，不涉及 CodeSkeleton 组装和 token 预算裁剪。

### 结论

**新建 `callLLMSimple` 轻量函数**，放置在 `src/panoramic/utils/llm-enricher.ts` 内部（非导出）。

### 理由

1. `callLLM` 与 `AssembledContext` 强耦合，强行构造一个假的 `AssembledContext` 是 anti-pattern
2. 语义增强的 prompt 结构完全不同：system prompt 是"你是字段描述推断专家"，user prompt 是字段列表 JSON
3. 认证检测（`detectAuth`）和重试逻辑可直接复用现有模块（`auth-detector.ts`、`cli-proxy.ts`）
4. 新函数仅约 60 行，不引入新的运行时依赖

### 被否决的替代方案

- **直接复用 callLLM**：需要构造假的 `AssembledContext`（`tokenCount=0, breakdown=..., truncated=false`），语义上不正确且脆弱
- **重构 callLLM 为接受 string prompt**：影响范围过大（所有调用方都需要改），不符合本 Feature 的最小变更原则

---

## Decision 2: LLM enrichment 调用粒度 — 按模型/文件分组批量 vs. 逐字段调用

### 问题

DataModelGenerator 可能提取出 25+ 个模型、500+ 个字段。逐字段调用 LLM 会产生大量 API 请求，成本和延迟不可接受。

### 结论

**按模型/文件分组批量调用**。每次调用将一个模型（或一个配置文件）的所有空 description 字段打包为 JSON 数组发送，LLM 一次性返回所有推断结果。

### 理由

1. 一个典型的 Python dataclass 有 5-15 个字段，一次 LLM 调用可处理一个模型的全部字段，token 消耗可控（<2k tokens/batch）
2. 对于 25 个 dataclass 的项目，约 25 次 API 调用（并发可优化），远优于 200+ 次逐字段调用
3. 模型上下文完整性更好——LLM 可参考同模型的其他字段来推断语义

### 被否决的替代方案

- **全项目一次调用**：单次 prompt 可能超过 token 限制（500+ 字段 + 上下文信息），且 LLM 输出质量在超长列表上下降
- **逐字段调用**：200+ 次 API 调用，延迟和成本不可接受

### 超大项目处理

当单个模型字段数超过 50 时，按 50 字段为一批进行分片。这一阈值基于经验：50 个字段的 JSON 输入约 3k tokens，加上上下文信息不超过 4k tokens，远低于 Claude 的上下文限制。

---

## Decision 3: `[AI]` 前缀策略 — enricher 函数内添加 vs. Generator 内添加

### 问题

`[AI]` 前缀标注是 FR-003 的核心要求。需要决定在哪一层添加前缀。

### 结论

**在 `enrichFieldDescriptions` / `enrichConfigDescriptions` 函数返回前添加前缀**。返回值中所有 LLM 推断的 description 已包含 `[AI] ` 前缀。

### 理由

1. 单一职责：enricher 函数是唯一引入 LLM 内容的入口，在此处统一标注最不容易遗漏
2. Generator 无需关心标注逻辑，只需调用 enricher 后直接赋值
3. 避免了"多个 Generator 各自添加前缀"的重复代码

### 已有 `[AI]` 前缀检测

enricher 函数在发送给 LLM 前检查：若 description 已以 `[AI]` 开头，跳过该字段不发送（解决 Edge Case "前缀不叠加"）。

---

## Decision 4: 多格式输出 — 调用层工具函数 vs. Generator 接口扩展

### 问题

spec.md FR-013 要求多格式输出在调用层处理，不修改 `DocumentGenerator` 接口签名。需要设计调用层的具体实现方式。

### 结论

**新建 `writeMultiFormat` 工具函数**，放置在 `src/panoramic/utils/multi-format-writer.ts`。调用层（未来的 batch/MCP 入口）在获取 Generator 的 `generate()` 输出和 `render()` 输出后，调用此函数写出文件。

### 理由

1. Generator 接口不变（FR-016），render() 仍只返回 Markdown 字符串
2. JSON 输出直接 `JSON.stringify(output, null, 2)` —— generate() 返回的 TOutput 本身就是结构化数据
3. Mermaid 源码从 TOutput 中提取（如 `DataModelOutput.erDiagram`）——不同 Generator 的 Mermaid 字段名不同，通过约定式字段检测（检查 `erDiagram`、`mermaidDiagram` 等已知字段名）

### 函数签名设计

```typescript
interface WriteMultiFormatOptions {
  outputDir: string;       // 输出目录
  baseName: string;        // 基础文件名（如 'data-model'）
  outputFormat: OutputFormat; // 'markdown' | 'json' | 'all'
  markdown: string;        // render() 的输出
  structuredData: unknown;  // generate() 的输出（TOutput）
  mermaidSource?: string;  // 可选的 Mermaid 源码
}
function writeMultiFormat(options: WriteMultiFormatOptions): string[]
// 返回实际写出的文件路径列表
```

### 被否决的替代方案

- **修改 render() 返回多格式**：违反 FR-016，且 render() 语义变为"渲染+序列化"，职责混乱
- **在 Generator 内部写文件**：违反关注点分离，Generator 不应知道文件系统路径

---

## Decision 5: OutputFormat Zod Schema 扩展方式 — 原地扩展 vs. 新建 Schema

### 问题

`OutputFormatSchema = z.enum(['markdown'])` 需要支持 `'json'` 和 `'all'`。

### 结论

**原地修改 `OutputFormatSchema`**，从 `z.enum(['markdown'])` 改为 `z.enum(['markdown', 'json', 'all'])`。

### 理由

1. 这是最简单直接的修改，Zod 的 z.enum 天然支持扩展
2. 所有依赖 `OutputFormat` 类型的代码自动获得新类型支持
3. 默认值保持 `'markdown'`（在 `GenerateOptionsSchema` 中已设置），零回归

---

## Decision 6: LLM 不可用降级策略 — 静默降级 vs. 警告降级

### 问题

FR-007 要求 LLM 不可用时静默降级。需要决定"静默"的程度。

### 结论

**静默降级 + 可选 debug 日志**。enricher 函数捕获所有 LLM 相关异常，返回原始未修改的数据。在 `process.env.DEBUG` 存在时输出 `console.debug` 日志，否则完全静默。

### 理由

1. 用户体验：`useLLM=true` 但无 API Key 时，不应看到报错（FR-007）
2. 开发者体验：排查问题时可通过 `DEBUG=1` 看到降级原因
3. 实现简单：try-catch 包裹即可

---

## Decision 7: callLLMSimple 的认证复用

### 问题

语义增强需要调用 LLM，但 `callLLM` 的认证逻辑（API Key vs CLI 代理）绑定在 `callLLM` 函数内部。

### 结论

**直接复用 `detectAuth()` 函数和 `@anthropic-ai/sdk`**。`callLLMSimple` 内部调用 `detectAuth()` 检测可用认证方式，然后：
- API Key 可用 → 直接使用 `new Anthropic({ apiKey })` 调用
- CLI 代理可用 → 调用 `callLLMviaCli` 函数

### 理由

1. `detectAuth()` 已从 `auth-detector.ts` 导出，可直接复用
2. `callLLMviaCli` 已从 `cli-proxy.ts` 导出，也可直接复用
3. 不需要修改任何现有模块

---

## Decision 8: LLM enrichment 的模型选择

### 问题

语义增强使用什么模型？是否与 spec-generation 使用同一模型？

### 结论

**默认使用 Haiku 级别模型**（如 `claude-3-5-haiku-20241022`），可通过环境变量 `PANORAMIC_LLM_MODEL` 覆盖。不使用 `resolveReverseSpecModel()` 的结果。

### 理由

1. 字段描述推断是轻量级任务，Haiku 足以胜任且成本低 10 倍
2. spec-generation 可能配置了 Opus/Sonnet（用于复杂分析），对 enrichment 来说过度消耗
3. 独立的环境变量使用户可以按场景选择模型
4. Haiku 的超时设置更短（60s），符合"快速补充说明"的场景
