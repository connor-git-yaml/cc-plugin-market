/**
 * sync-timeline-builder.mjs — 时间线构建模块
 *
 * 负责将产品下的 SpecEntry 列表排序并标记类型，生成 Timeline 对象。
 * 所有导出函数均为纯函数（无副作用）。
 *
 * @module sync-timeline-builder
 */

// ────────────────────────────────────────────────────────────
// SpecType 分类规则
// ────────────────────────────────────────────────────────────

/**
 * 根据 spec 目录名判定 SpecType。
 * 注意：INITIAL 类型由 buildTimeline 在排序后标记（编号最小者），
 * 此函数不处理 INITIAL 判定。
 *
 * 分类规则（按 data-model.md Section 1.1）：
 * - dirName 含 `fix` → 'FIX'
 * - dirName 含 `refactor` / `rename` / `split` → 'REFACTOR'
 * - dirName 含 `enhance` / `batch` / `improve` → 'ENHANCEMENT'
 * - 其余 → 'FEATURE'
 *
 * @param {{ id: string, dirName: string }} specEntry
 * @returns {'FEATURE' | 'FIX' | 'REFACTOR' | 'ENHANCEMENT'}
 */
export function classifySpecType(specEntry) {
  const name = specEntry.dirName.toLowerCase();

  // fix 类型匹配：需要防止 "fix" 误匹配包含 fix 子串的非修复目录
  // 使用词边界检测：以 fix 开头的后缀部分，或包含 -fix- 前缀
  if (/(?:^|\d+-)fix(?:-|$)/.test(name)) {
    return 'FIX';
  }

  if (/(?:refactor|rename|split)/.test(name)) {
    return 'REFACTOR';
  }

  if (/(?:enhance|batch|improve)/.test(name)) {
    return 'ENHANCEMENT';
  }

  return 'FEATURE';
}

/**
 * 构建单个产品的 spec 时间线。
 *
 * - 按 specId 数值升序排序
 * - 第一个条目强制标记为 INITIAL
 * - 其余条目调用 classifySpecType 判定类型
 * - 编号重复时按 dirName 字母序排列并记录警告
 *
 * @param {Array<{ id: string, dirName: string, title: string|null, summary: string|null }>} specEntries
 * @param {string} productId
 * @returns {{ productId: string, entries: Array<{ specId: string, dirName: string, type: string, title: string|null, summary: string|null }>, stats: Record<string, number>, warnings: string[] }}
 */
export function buildTimeline(specEntries, productId) {
  const emptyStats = {
    INITIAL: 0,
    FEATURE: 0,
    FIX: 0,
    REFACTOR: 0,
    ENHANCEMENT: 0,
  };

  if (!Array.isArray(specEntries) || specEntries.length === 0) {
    return { productId, entries: [], stats: { ...emptyStats }, warnings: [] };
  }

  const warnings = [];

  // 排序：按 specId 数值升序；编号相同时按 dirName 字母序
  const sorted = [...specEntries].sort((a, b) => {
    const numA = parseInt(a.id, 10);
    const numB = parseInt(b.id, 10);
    if (numA !== numB) {
      return numA - numB;
    }
    // 编号重复——按 dirName 字母序稳定排列
    return a.dirName.localeCompare(b.dirName);
  });

  // 检测编号重复
  const idCounts = {};
  for (const entry of sorted) {
    idCounts[entry.id] = (idCounts[entry.id] || 0) + 1;
  }
  for (const [id, count] of Object.entries(idCounts)) {
    if (count > 1) {
      warnings.push(`编号 ${id} 存在 ${count} 个重复条目，按目录名字母序排列`);
    }
  }

  // 构建时间线条目
  const stats = { ...emptyStats };
  const entries = sorted.map((entry, index) => {
    // 第一个条目强制标记为 INITIAL
    const type = index === 0 ? 'INITIAL' : classifySpecType(entry);
    stats[type] = (stats[type] || 0) + 1;

    return {
      specId: entry.id,
      dirName: entry.dirName,
      type,
      title: entry.title ?? null,
      summary: entry.summary ?? null,
    };
  });

  return { productId, entries, stats, warnings };
}
