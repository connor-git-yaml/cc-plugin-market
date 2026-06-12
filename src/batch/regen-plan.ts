/**
 * Batch 重生成计划解析（regen-plan）
 *
 * 提供两个纯函数，供 batch 三入口（CLI / MCP / runBatch 直调）与 DeltaRegenerator 共享：
 *   - resolveRegenPlan：把"已合并后的有效输入"解析为唯一的 RegenPlan 真值
 *   - resolveSourceTarget：统一 module → sourceTarget 的口径（含目录冲突分支）
 *
 * 从 batch-orchestrator.ts 提取，消除 GREEN 阶段在两处分别推演 target / regen 语义的认知负担。
 */
import * as path from 'node:path';
import type { ModuleGroup } from './module-grouper.js';

// ============================================================
// RegenPlan 类型定义（见 specs/175-.../data-model.md §2）
// ============================================================

/** RegenPlan 的来源标记，用于可观测日志与降级追溯 */
export type RegenPlanSource =
  | 'full' // full 或 force（已合并）
  | 'incremental-explicit' // 显式给出 incremental（true 或 false 皆属显式选择）
  | 'default'; // 未传任何参数 → 默认增量路径（FR-001）

/**
 * resolveRegenPlan 的扁平输入。
 * config 合并由各入口在自己现状位置完成（CLI 在 batch.ts，MCP 在 server.ts 用 `?? fileConfig.x`），
 * 本函数只接收"合并后的有效值"，不做 cli/mcp/config 笛卡尔积。
 */
export interface RegenPlanInput {
  /** 已合并：--incremental / mcp.incremental / config.incremental */
  incremental?: boolean;
  /** 已合并：--full / mcp.full（config 无 full 字段，用 force 表达） */
  full?: boolean;
  /** 已合并：--force / mcp.force / config.force（--full 的等义别名） */
  force?: boolean;
}

/** resolveRegenPlan 的解析结果（唯一真值） */
export interface RegenPlan {
  /** true = 走 DeltaRegenerator */
  incremental: boolean;
  /** true = 绕 DeltaRegenerator + 绕 checkpoint 全量重生成（full|force 合并真值） */
  full: boolean;
  /** 来源标记 */
  source: RegenPlanSource;
}

/**
 * 把"合并后的有效输入"解析为唯一的 RegenPlan。
 *
 * 解析规则（优先级自上而下）：
 *   (1) full===true || force===true → { incremental:false, full:true, source:'full' }
 *   (2) incremental===true（显式 opt-in，未给 full/force）→ { incremental:true, full:false, source:'incremental-explicit' }
 *   (3) incremental===false（显式 opt-out）→ { incremental:false, full:false, source:'incremental-explicit' }
 *   (4) 全 undefined（默认）→ { incremental:true, full:false }（FR-001 默认翻转）
 *
 * 显式 incremental===true（规则 2）与显式 incremental===false（规则 3）都尊重调用方意图；
 * 仅在未给出任何 regen 轴参数时（规则 4）落默认增量（FR-001）。
 */
export function resolveRegenPlan(input: RegenPlanInput): RegenPlan {
  // 规则 (1)：full 或 force 优先（force 是 full 的等义别名）
  if (input.full === true || input.force === true) {
    return { incremental: false, full: true, source: 'full' };
  }

  // 规则 (2)：显式 incremental=true → 走增量（任何阶段都尊重显式 opt-in）
  if (input.incremental === true) {
    return { incremental: true, full: false, source: 'incremental-explicit' };
  }

  // 规则 (3)：显式 incremental=false 走旧"仅看文件存在"兼容路径
  if (input.incremental === false) {
    return { incremental: false, full: false, source: 'incremental-explicit' };
  }

  // 规则 (4)：undefined 默认路径
  // FR-001 默认翻转：未传任何 regen 轴参数时走增量（DeltaRegenerator）。
  return { incremental: true, full: false, source: 'default' };
}

// ============================================================
// resolveSourceTarget：统一 module → sourceTarget 口径
// ============================================================

/**
 * 把系统路径分隔符归一化为正斜杠。
 *
 * Feature 178：batch 内单参口径的唯一来源（delta-regenerator / batch-orchestrator import 此处），
 * 消除三份逐字副本。注意与 panoramic 的双参变体 `(inputPath, projectRoot)`（先 path.relative）
 * 语义不同，不在此合并范围。
 */
export function normalizeProjectPath(inputPath: string): string {
  return inputPath.split(path.sep).join('/');
}

/**
 * 计算单个模块的 sourceTarget（与 batch-orchestrator.processOneModule:713-720 等价）。
 *
 * H4 修复语义：文件级降级场景（非 root + 单文件 + dirPath 冲突）下 sourceTarget 须与文件路径
 * 保持一致，否则 --incremental 的 regenerateTargets 查询与 storedSpecByTarget 查询全部错位。
 *
 * @param group 模块分组
 * @param conflictingDirPaths 与其他单文件目录冲突的 dirPath 集合
 * @param isRoot 是否 root 模块（root 模块按文件展开，调用方自行处理，本函数返回 dirPath 口径）
 * @returns 归一化后的 sourceTarget
 */
export function resolveSourceTarget(
  group: ModuleGroup,
  conflictingDirPaths: Set<string>,
  isRoot: boolean,
): string {
  const hasDirPathConflict =
    !isRoot && group.files.length === 1 && conflictingDirPaths.has(group.dirPath);
  return hasDirPathConflict
    ? normalizeProjectPath(group.files[0]!)
    : normalizeProjectPath(group.dirPath);
}

/**
 * 从纯路径 sourceTarget 派生增量缓存 key（Feature 182）。
 *
 * 修复同目录多语言组 Map 键碰撞：同一 dirPath 被 language-split 成两个 ModuleGroup 时，
 * resolveSourceTarget 对两组返回相同纯路径，导致 storedSpecByTarget / regenerateTargets
 * 键碰撞、后写覆盖前写、增量永久 miss。
 *
 * 本 helper 仅在 languageSplit 组追加 `::language` 后缀派生唯一 cache key；
 * 单语言目录维持纯路径（最小化存量缓存失效面）。
 *
 * 关键不变量：frontmatter 的 sourceTarget 保持纯路径不变（panoramic / spec-store 路径
 * 匹配消费方零改动）；cache key 只存在于 src/batch/ 内的 Map/Set 与新增 frontmatter
 * 字段 sourceTargetKey。
 *
 * @param sourceTarget resolveSourceTarget 返回的纯路径
 * @param group 仅需 language / languageSplit 两字段
 * @returns 单语言：原路径；语言拆分组：`${sourceTarget}::${language}`
 */
export function buildSpecCacheKey(
  sourceTarget: string,
  group: Pick<ModuleGroup, 'language' | 'languageSplit'>,
): string {
  return group.languageSplit && group.language
    ? `${sourceTarget}::${group.language}`
    : sourceTarget;
}
