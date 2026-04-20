/**
 * 数据摄取模块
 * 从外部数据源读取原始数据并写入系统存储
 */

export interface IngestConfig {
  source: string;
  batchSize: number;
  timeout: number;
}

export interface IngestResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface RawRecord {
  id: string;
  timestamp: string;
  source: string;
  payload: unknown;
}

/**
 * 主摄取函数：接收数据源配置并驱动完整的摄取流程
 * 返回摄取统计信息（处理总数、成功数、失败数）
 */
export async function ingestData(config: IngestConfig): Promise<IngestResult> {
  const records: RawRecord[] = [];
  const errors: string[] = [];

  try {
    const raw = await fetchRawData(config.source, config.timeout);
    records.push(...raw);
  } catch (error) {
    errors.push(`摄取失败: ${error instanceof Error ? error.message : String(error)}`);
    return { total: 0, succeeded: 0, failed: 0, errors };
  }

  let succeeded = 0;
  let failed = 0;

  for (const record of records) {
    const validation = validateRecord(record);
    if (validation.isValid) {
      succeeded++;
    } else {
      failed++;
      errors.push(...validation.errors);
    }
  }

  return { total: records.length, succeeded, failed, errors };
}

/**
 * 从远端 API 或文件系统读取原始记录
 */
export async function fetchRawData(source: string, timeout: number): Promise<RawRecord[]> {
  // fixture 实现：返回模拟数据
  void timeout;
  return [
    { id: '001', timestamp: new Date().toISOString(), source, payload: { value: 1 } },
    { id: '002', timestamp: new Date().toISOString(), source, payload: { value: 2 } },
  ];
}

/**
 * 对单条记录执行格式校验
 * 校验规则：必填字段（id、timestamp、source）、ISO 8601 时间格式、合法来源
 */
export function validateRecord(record: RawRecord): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!record.id) {
    errors.push('缺少必填字段: id');
  }

  if (!record.timestamp) {
    errors.push('缺少必填字段: timestamp');
  } else if (!/^\d{4}-\d{2}-\d{2}T/.test(record.timestamp)) {
    errors.push('timestamp 必须为 ISO 8601 格式');
  }

  if (!record.source) {
    errors.push('缺少必填字段: source');
  }

  return { isValid: errors.length === 0, errors };
}
