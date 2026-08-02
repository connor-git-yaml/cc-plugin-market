/**
 * F241 E1/E3 — KB 治理层参数的单一常量模块（OQ-2）
 *
 * 这四个参数都是 proposed-default，调参成本必须恒等于「改这里一处常量 + 改测试期望值」，
 * 因此禁止在 recorder / 聚合器 / 状态命令里散落同名字面量。
 */

/** coverage-gap 最小出现阈值：term 至少被 k 个**不同** normalizedQueryHash 命中才进 backlog（FR-015，k=2） */
export const MIN_OCCURRENCE_THRESHOLD = 2;

/** no-hit JSONL 保留期（天）：写入时清理 mtime 超期的同目录文件（FR-013） */
export const NOHIT_RETENTION_DAYS = 30;

/** KB freshness：built_at 超过该天数记 aging（FR-020） */
export const KB_FRESHNESS_AGING_DAYS = 30;

/** KB freshness：built_at 超过该天数记 stale（FR-020） */
export const KB_FRESHNESS_STALE_DAYS = 90;

/**
 * lockfile 解析上限（字节，EC-28）：`statSync` 前置守卫，超限直接明确失败而非读进内存。
 *
 * 32MB `[推断]`——真实 `package-lock.json` 极端案例通常 <10MB，留 3 倍余量。
 * **不是** F239 图 JSON 的 256MB：那是另一个量级语义的保护，两者不共享常量（plan §6）。
 */
export const MAX_LOCKFILE_BYTES = 32 * 1024 * 1024;
