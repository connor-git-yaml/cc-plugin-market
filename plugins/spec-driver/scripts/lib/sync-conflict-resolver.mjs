/**
 * sync-conflict-resolver.mjs — 冲突解决模块
 *
 * 检测 MergeSkeleton 中**同一 spec 内**同一 FR ID 的多个 active 版本（只会来自 spec 自身重复编号），
 * 保留首次出现者。跨 spec 同号不是冲突：FR 编号是 spec 局部编号（2026-09-14 对抗审查 C-1）。
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
 * 遍历所有章节的 functionalRequirements，按 (sourceSpec, id) 分组检测多个 active 版本。
 * 冲突解决规则：同组内首次出现者保持 active，其余标记为 superseded（同组 sourceSpec 相同，
 * 「编号更大者胜出」在此退化为稳定排序下的首条）。
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

    // 按 (sourceSpec, id) 分组，找出同一 spec 内有多个 active 版本的 FR
    const activeByFrId = {};
    for (let i = 0; i < frList.length; i += 1) {
      const fr = frList[i];
      if (fr.status !== 'active') {
        continue;
      }
      const key = `${fr.sourceSpec}::${fr.id}`;
      if (!activeByFrId[key]) {
        activeByFrId[key] = [];
      }
      activeByFrId[key].push({ index: i, fr });
    }

    // 对有冲突的 FR 执行裁决
    for (const [frId, entries] of Object.entries(activeByFrId)) {
      if (entries.length <= 1) {
        continue;
      }

      // 同键条目来自同一 spec（分组键含 sourceSpec），按出现顺序首条胜出；此前的「编号降序」比较器在同 spec 内恒为 0，
      // 只是靠排序稳定性碰巧保住首条（角 B 审查 I-B1）
      const winner = entries[0];
      // 其余全部标记为 superseded（按身份跳过 winner，而不是按下标——否则「谁胜出」与「谁被标记」脱钩，
      // 胜者改成末条时会把胜者自己标成 superseded 而观测不出差异，角 B 审查 I-B1 的等价变异）
      for (const loser of entries) {
        if (loser === winner) continue;
        frList[loser.index].status = 'superseded';
        frList[loser.index].supersededBy = winner.fr.sourceSpec;

        conflicts.push({
          subject: frId,
          winner: winner.fr.sourceSpec,
          loser: loser.fr.sourceSpec,
          reason: `FR ${winner.fr.id} 在 spec ${winner.fr.sourceSpec} 内存在多个 active 版本，保留首次出现`,
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
