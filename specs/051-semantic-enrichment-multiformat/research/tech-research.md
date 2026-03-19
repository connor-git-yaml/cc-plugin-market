# Feature 051 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. 核心问题

Phase 1 端到端验证发现三个可用性问题：
- ConfigReferenceGenerator 的配置项无说明（description 全空）
- DataModelGenerator 的字段无说明（description 全 null）
- Mermaid ER 图嵌在 Markdown 中不便阅读

## 2. LLM 调用机制（已有）

`src/core/llm-client.ts`:
- `callLLM(context, config?)` — 主入口，自动检测 API Key vs CLI 代理
- 支持重试（3 次指数退避）、超时控制
- 返回 `LLMResponse { content, model, inputTokens, outputTokens, duration }`

## 3. GenerateOptions 现状

`src/panoramic/interfaces.ts:40-47`:
```typescript
GenerateOptionsSchema = z.object({
  useLLM: z.boolean().optional().default(false),
  templateOverride: z.string().optional(),
  outputFormat: OutputFormatSchema.optional().default('markdown'),
});
OutputFormat = 'markdown'  // 仅支持 markdown
```

**useLLM 已定义但未被任何 Generator 使用**。

## 4. 语义增强集成点

### DataModelGenerator.generate() (行 608)

DataModelField.description 当前全为 null。需要：
- 收集所有 description 为空的字段
- 批量发送给 LLM（按模型分组，减少调用次数）
- 返回值标注 `[AI]` 前缀

### ConfigReferenceGenerator.generate() (行 169)

ConfigEntry.description 当前从注释提取（大多为空）。需要：
- 收集 description 为空的配置项
- 批量发送给 LLM
- 标注 `[AI]`

## 5. 多格式输出方案

**推荐方案**：扩展 OutputFormat + 在调用层写出多文件

```typescript
OutputFormat = 'markdown' | 'json' | 'all'
```

每个 Generator 的 generate() 返回的 TOutput 本身就是结构化数据，直接 JSON.stringify 即可。

输出文件命名：
- `{name}.md` — Markdown 文档（现有）
- `{name}.json` — 结构化 JSON（新增）
- `{name}.mmd` — 独立 Mermaid 源文件（新增，从 erDiagram/dependencyDiagram 提取）

## 6. 关键设计决策

1. **LLM 调用粒度**：按模型/文件批量而非逐字段调用（减少 API 调用次数和 token 消耗）
2. **标注方式**：`[AI]` 前缀标注 LLM 推断内容，与人工注释明确区分
3. **多格式不修改接口**：render() 签名不变，多格式在调用层（batch/MCP）处理
4. **OutputFormat 扩展**：新增 'json' 和 'all'，向后兼容
5. **降级**：useLLM=true 但 LLM 不可用时，静默降级为 AST-only（description 保持空）
