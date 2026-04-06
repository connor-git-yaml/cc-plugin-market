/**
 * sync-conflict-resolver.mjs — 冲突解决模块
 *
 * 检测 MergeSkeleton 中同一 FR ID 的多个 active 版本，
 * 以编号更大者（sourceSpec 更大）胜出。
 * 所有导出函数均为纯函数（无副作用），返回新对象。
 *
 * @module sync-conflict-resolver
 */

// ────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────

/**
 * 深拷贝简单 JSON 兼容对象
 * @param {unknown} value
 * @returns {unknown}
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    result[key] = deepClone(value[key]);
  }
  return result;
}

// ────────────────────────────────────────────────────────────
// 导出函数
// ────────────────────────────────────────────────────────────

/**
 * 解决 MergeSkeleton 中的 FR 冲突。
 *
 * 遍历所有章节的 functionalRequirements，检测同一 FR ID 是否存在多个 active 版本。
 * 冲突解决规则：编号更大者（sourceSpec 数值更大）胜出保持 active，
 * 编号更小者标记为 superseded。
 *
 * 纯函数：不修改输入的 skeleton 对象，返回新对象。
 *
 * @param {object} skeleton — MergeSkeleton
 * @returns {{ skeleton: object, conflicts: Array<{ subject: string, winner: string, loser: string, reason: string }> }}
 */
export function resolveConflicts(skeleton) {
  const result = deepClone(skeleton);
  const conflicts = [];

  // 遍历所有章节
  for (const chapter of Object.values(result.chapters)) {
    const frList = chapter.functionalRequirements;
    if (frList.length === 0) {
      continue;
    }

    // 按 FR ID 分组，找出有多个 active 版本的 FR
    const activeByFrId = {};
    for (let i = 0; i < frList.length; i += 1) {
      const fr = frList[i];
      if (fr.status !== 'active') {
        continue;
      }
      if (!activeByFrId[fr.id]) {
        activeByFrId[fr.id] = [];
      }
      activeByFrId[fr.id].push({ index: i, fr });
    }

    // 对有冲突的 FR 执行裁决
    for (const [frId, entries] of Object.entries(activeByFrId)) {
      if (entries.length <= 1) {
        continue;
      }

      // 按 sourceSpec 编号降序排列，编号最大者胜出
      entries.sort((a, b) => {
        const numA = parseInt(a.fr.sourceSpec, 10) || 0;
        const numB = parseInt(b.fr.sourceSpec, 10) || 0;
        return numB - numA;
      });

      const winner = entries[0];
      // 其余全部标记为 superseded
      for (let i = 1; i < entries.length; i += 1) {
        const loser = entries[i];
        frList[loser.index].status = 'superseded';
        frList[loser.index].supersededBy = winner.fr.sourceSpec;

        conflicts.push({
          subject: frId,
          winner: winner.fr.sourceSpec,
          loser: loser.fr.sourceSpec,
          reason: `FR ${frId} 存在多个 active 版本，编号更大者 (${winner.fr.sourceSpec}) 优先`,
        });
      }
    }
  }

  // 重新计算 mergeStats
  let activeFRCount = 0;
  let supersededFRCount = 0;
  let deprecatedFRCount = 0;
  let userStoryCount = 0;

  for (const chapter of Object.values(result.chapters)) {
    for (const fr of chapter.functionalRequirements) {
      if (fr.status === 'active') activeFRCount += 1;
      if (fr.status === 'superseded') supersededFRCount += 1;
      if (fr.status === 'deprecated') deprecatedFRCount += 1;
    }
    userStoryCount += chapter.userStories.length;
  }

  result.mergeStats = {
    ...result.mergeStats,
    activeFRCount,
    supersededFRCount,
    deprecatedFRCount,
    userStoryCount,
  };

  return { skeleton: result, conflicts };
}
