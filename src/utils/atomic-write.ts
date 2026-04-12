/**
 * 原子写入工具函数
 * 从 checkpoint.ts 的 saveCheckpoint() 提取通用原子写入逻辑
 * 核心流程：解析绝对路径 → 创建目录 → 写 .tmp → renameSync 原子替换
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 原子写入 JSON 数据到文件
 * 先写临时文件再 rename，防止写入中断导致数据损坏
 * .tmp 残留由 renameSync 覆盖，无需预清理
 *
 * @param filePath - 目标文件路径
 * @param data - 要序列化为 JSON 的数据
 */
export function writeAtomicJson(filePath: string, data: unknown): void {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);

  // 确保目录存在
  fs.mkdirSync(dir, { recursive: true });

  // 原子写入：先写临时文件
  const tmpPath = `${resolvedPath}.tmp`;
  const content = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, resolvedPath);
}
