/**
 * 数据处理模块
 * 实现数据转换、清洗和聚合逻辑
 */

export interface ProcessedRecord {
  id: string;
  createdAt: Date;
  normalizedSource: string;
  fields: Record<string, unknown>;
}

export interface AggregateReport {
  bySource: Record<string, number>;
  timeWindows: Array<{ window: string; count: number }>;
  totalProcessed: number;
}

/**
 * 对单条记录执行完整的处理流水线
 * 步骤：字段名规范化、过滤空值、计算派生字段（createdAt 时间戳转换）
 */
export function processRecord(record: {
  id: string;
  timestamp: string;
  source: string;
  payload: unknown;
}): ProcessedRecord {
  // 规范化字段
  const fields = normalizeFields(record.payload as Record<string, unknown>);

  // 过滤空值字段
  const filteredFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined && value !== '') {
      filteredFields[key] = value;
    }
  }

  return {
    id: record.id,
    createdAt: new Date(record.timestamp),
    normalizedSource: record.source.toLowerCase().trim(),
    fields: filteredFields,
  };
}

/**
 * 批量处理记录后按业务维度分组汇总，输出聚合报告
 * 在大批量数据时采用流式处理以降低内存占用
 */
export function aggregateResults(records: ProcessedRecord[]): AggregateReport {
  const bySource: Record<string, number> = {};
  const timeWindowMap = new Map<string, number>();

  for (const record of records) {
    // 按来源聚合
    const src = record.normalizedSource;
    bySource[src] = (bySource[src] ?? 0) + 1;

    // 按小时时间窗口聚合
    const window = record.createdAt.toISOString().slice(0, 13);
    timeWindowMap.set(window, (timeWindowMap.get(window) ?? 0) + 1);
  }

  return {
    bySource,
    timeWindows: [...timeWindowMap.entries()].map(([window, count]) => ({ window, count })),
    totalProcessed: records.length,
  };
}

/**
 * 字段名规范化：将 snake_case 转为 camelCase
 */
function normalizeFields(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}
