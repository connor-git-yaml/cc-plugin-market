/**
 * 断点恢复检查点持久化（FR-017）
 * 原子写入（临时文件+重命名）防止数据损坏
 * 参见 contracts/batch-module.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BatchStateSchema, type BatchState } from '../models/module-spec.js';

/** 默认检查点路径（Constitution IV：位于 .specs/ 内） */
export const DEFAULT_CHECKPOINT_PATH = '.specs/.reverse-spec-checkpoint.json';

/**
 * 加载已有检查点以恢复执行
 *
 * @param checkpointPath - 检查点文件路径
 * @returns BatchState 或 null（未找到）
 */
export function loadCheckpoint(checkpointPath: string): BatchState | null {
  const resolvedPath = path.resolve(checkpointPath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const data = JSON.parse(content);
    // 使用 Zod 验证
    return BatchStateSchema.parse(data);
  } catch {
    // 损坏的检查点文件，返回 null
    console.warn(`检查点文件损坏或无效: ${checkpointPath}，将重新开始`);
    return null;
  }
}

/**
 * 原子写入检查点状态
 * 先写临时文件再重命名，防止写入中断导致数据损坏
 *
 * @param state - 当前批处理状态
 * @param checkpointPath - 检查点文件路径
 */
export function saveCheckpoint(
  state: BatchState,
  checkpointPath: string,
): void {
  const resolvedPath = path.resolve(checkpointPath);
  const dir = path.dirname(resolvedPath);

  // 确保目录存在
  fs.mkdirSync(dir, { recursive: true });

  // 原子写入：先写临时文件
  const tmpPath = `${resolvedPath}.tmp`;
  const content = JSON.stringify(state, null, 2);

  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, resolvedPath);
}

/**
 * 批处理成功完成后删除检查点
 *
 * @param checkpointPath - 检查点文件路径
 */
export function clearCheckpoint(checkpointPath: string): void {
  const resolvedPath = path.resolve(checkpointPath);

  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }

  // 清理临时文件
  const tmpPath = `${resolvedPath}.tmp`;
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
}
