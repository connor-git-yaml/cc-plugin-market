/**
 * F220 Stage ④ — checkpoint / incremental state（检查点状态机）
 *
 * 从 batch-orchestrator.ts 依赖闭合搬迁（F220 B1，函数体逐字不变）：
 * checkpoint completed/failed 的 replace 语义状态机（F182 修复面 4）与
 * 受管输出目录归属判定（F175 FR-017/EC-009 孤儿删除必要条件2）。
 *
 * @internal 内部实现模块：外部消费者请从 `batch/batch-orchestrator.js`（facade）导入
 * 公共 14 符号契约；对 stages/ 的深导入不属于稳定 API，随时可能重构。
 */
import * as path from 'node:path';
import type { BatchState, CompletedModule, FailedModule } from '../../models/module-spec.js';

/**
 * Feature 182 修复面 4：checkpoint replace 语义（completed/failed 互斥去重）。
 *
 * 背景：F175 给 checkpoint 加了「mustRegen 失效重跑」（fall-through）语义，但 completedModules
 * 仍沿用 append-only 写法——已完成 module 被重跑后会二次 push，导致 resume 进度超 totalModules，
 * 且 completed / failed 可能交叉污染（同一 module 同时出现在两个集合）。
 *
 * 本 helper 以 path 为身份键先剔除两个集合中的同名旧条目，再 push 到目标集合，保证：
 *   (1) 同一 module 在每个集合最多出现一次；(2) completed 与 failed 互斥。
 *
 * 注意：helper 内不得有 await——JS 单线程下同步段不被 pLimit 并发交错，
 * 保持纯同步可防未来插入 await 后语义退化为「读-改-写」竞态。
 */
export function upsertCompletedModule(state: BatchState, entry: CompletedModule): void {
  state.completedModules = state.completedModules.filter((m) => m.path !== entry.path);
  state.failedModules = state.failedModules.filter((m) => m.path !== entry.path);
  state.completedModules.push(entry);
}

export function recordFailedModule(state: BatchState, entry: FailedModule): void {
  state.failedModules = state.failedModules.filter((m) => m.path !== entry.path);
  state.completedModules = state.completedModules.filter((m) => m.path !== entry.path);
  state.failedModules.push(entry);
}

/**
 * F175 FR-017/EC-009：判定 absPath 是否位于受管 modules/ 输出目录内（孤儿删除 ownership 必要条件2）。
 *
 * 用 path.relative 判定目录归属，禁用字符串 startsWith——否则 `specs/modules-old/...` 这类
 * sibling 目录会被前缀匹配误判为受管目录（目录穿越）。同时校验 .spec.md 后缀。
 */
export function isInManagedOutputDir(absPath: string, modulesDir: string): boolean {
  const rel = path.relative(modulesDir, path.resolve(absPath));
  return !rel.startsWith('..') && !path.isAbsolute(rel) && absPath.endsWith('.spec.md');
}
