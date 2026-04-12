---
contract: extraction-pipeline
feature: 107-multi-modal-extraction
version: 1.0.0
status: Draft
---

# 契约：`src/extraction/extraction-pipeline.ts`

本契约定义 `ExtractionPipeline` 的公开接口。`batch-orchestrator.ts` 依赖此契约。

## 公开 API

```typescript
export interface ExtractionPipelineOptions {
  /** 目标项目根目录（绝对路径） */
  projectRoot: string;
  /** 输出目录（绝对路径，缓存写入 {outputDir}/_meta/extraction-cache/） */
  outputDir: string;
  /** 是否启用 Markdown + API 规范提取 */
  includeDocs: boolean;
  /** 是否启用图像/图表 Vision 提取 */
  includeImages: boolean;
}

/**
 * 运行多模态提取管道
 *
 * 行为：
 * - includeDocs=false && includeImages=false 时立即返回 []
 * - 所有提取失败（降级）时返回 []，不抛出异常
 * - 返回的 ExtractionResult[] 已通过 Zod schema 验证（验证失败的结果已丢弃）
 *
 * @param options 管道选项
 * @returns 所有提取结果的扁平合并数组（每个文件一个 ExtractionResult）
 */
export async function runExtractionPipeline(
  options: ExtractionPipelineOptions
): Promise<ExtractionResult[]>;
```

## 不变量

- 函数**不抛出异常**（所有异常在内部 catch 并降级为空结果）
- 返回值中每个 `ExtractionResult` 均已通过 `ExtractionResultSchema.parse()` 验证
- Markdown 文件 LLM 调用并发数上限为 5，单次超时上限为 8 秒
- 图片数量 > 50 时在 stdout 输出警告，不影响返回值
- API key 脱敏：函数内部不向外暴露 `ANTHROPIC_API_KEY` 原值

## 副作用

- 写入缓存文件至 `{outputDir}/_meta/extraction-cache/`
- 向 `logger` 输出 info/warn 日志
