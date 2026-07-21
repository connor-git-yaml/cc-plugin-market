/**
 * F220 Stage ③ — generation scheduling（生成调度）
 *
 * 从 batch-orchestrator.ts 依赖闭合搬迁（F220 B4，函数体逐字不变）：并发数边界
 * 规范化（Feature 146 FR-002）。
 *
 * 边界说明（refactor-plan §3 B7 / residual-report）：p-limit 调度块与模块生成循环
 * 深织于 runBatch 闭包（共享 processOneModule/failed/checkedState/reporter 等
 * ~5 个局部量），提取需传大上下文、零漂移风险高而解耦收益低，按"不以文件变短
 * 为成功"原则显式保留在 facade（M9 §6 决议记录于 residual-report.md）。
 *
 * @internal 内部实现模块：外部消费者请从 `batch/batch-orchestrator.js`（facade）导入
 * 公共 14 符号契约；对 stages/ 的深导入不属于稳定 API，随时可能重构。
 */
/**
 * Feature 146 FR-002 — 并发数边界规范化
 *
 * 规则：
 * - 非整数（含小数、非数字、Infinity、NaN）→ Math.floor 向下取整
 * - 取整后 <= 0 → 修正为 1（顺序处理）并通过 onWarn 上报
 *
 * 提取为独立纯函数便于单元测试（不需要启动完整 pipeline）。
 *
 * @param raw  原始 concurrency 值（已合并 CLI / config / 默认值之后传入）
 * @param onWarn 修正发生时的告警回调（用于注入 logger.warn 或测试中的 spy）
 */
export function normalizeConcurrency(
  raw: number,
  onWarn?: (message: string) => void,
): number {
  let normalized = Math.floor(raw);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    onWarn?.(`concurrency=${raw} 无效，修正为 1（顺序处理）`);
    normalized = 1;
  }
  return normalized;
}
