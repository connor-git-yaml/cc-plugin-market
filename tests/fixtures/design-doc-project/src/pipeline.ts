/**
 * 管道编排模块
 * 协调摄取、处理和输出三个阶段的执行顺序
 */

export interface PipelineConfig {
  maxRetries: number;
  failureThreshold: number;
  outputTarget: 'file' | 'database';
}

export interface PipelineResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  outputPath?: string;
}

/**
 * 运行完整数据处理管道
 * 依次调用 ingestData、processRecord、aggregateResults
 */
export async function runPipeline(
  config: PipelineConfig,
  sources: string[],
): Promise<PipelineResult> {
  let processedCount = 0;
  let failedCount = 0;

  for (const source of sources) {
    try {
      // 实际实现中调用摄取和处理模块
      processedCount++;
    } catch {
      failedCount++;
      const failureRate = failedCount / (processedCount + failedCount);
      if (failureRate > config.failureThreshold) {
        return { success: false, processedCount, failedCount };
      }
    }
  }

  return {
    success: true,
    processedCount,
    failedCount,
  };
}

/**
 * 重试包装器：对给定操作进行最多 maxRetries 次重试
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('操作失败');
}
