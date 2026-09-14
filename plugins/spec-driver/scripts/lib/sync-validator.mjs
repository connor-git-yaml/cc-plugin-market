/**
 * sync-validator.mjs — 验证模块
 *
 * 对合并结果执行三项验证检查：
 * 1. fr-count: 合并守恒——骨架第 5 章的 FR 总数（含 superseded）== 各 spec 抽取条数之和（基线取自合并**之前**的解析结果，
 *    不再从骨架自身读：此前「活跃 ≥ INITIAL 活跃」的基线与被检对象同源，抽取全丢时 0 ≥ 0 恒 pass——190 份 spec 抽 0 条 FR
 *    而 validation 自证通过的病根，角 A 审查 C-4）
 * 2. no-contradiction: 同一 spec 内同一 FR ID 不存在两个 active 版本（跨 spec 同号无语义关系，不算矛盾）
 * 3. changelog-coverage: 变更历史覆盖所有归属 spec
 *
 * 所有导出函数均为纯函数（无副作用）。
 *
 * @module sync-validator
 */

// ────────────────────────────────────────────────────────────
// 导出函数
// ────────────────────────────────────────────────────────────

/**
 * 对合并结果执行三项验证检查。
 *
 * @param {object} skeleton — MergeSkeleton（冲突解决后）
 * @param {{ productId: string, entries: Array<{ specId: string, type: string }> }} timeline
 * @param {Record<string, { requirements?: Array<object> }>} parsedSpecs — 合并前的逐 spec 解析结果（fr-count 的外部基线）
 * @returns {{ productId: string, passed: boolean, checks: Array<{ name: string, passed: boolean, detail: string, data: Record<string, number|string> }> }}
 *   ValidationReport
 */
export function validateMergeResult(skeleton, timeline, parsedSpecs) {
  const checks = [
    checkFRCount(skeleton, timeline, parsedSpecs),
    checkNoContradiction(skeleton),
    checkChangelogCoverage(skeleton, timeline),
  ];

  const passed = checks.every((check) => check.passed);

  return {
    productId: skeleton.productId,
    passed,
    checks,
  };
}

// ────────────────────────────────────────────────────────────
// 内部检查函数
// ────────────────────────────────────────────────────────────

/**
 * fr-count 检查：合并守恒——四类 handler 一律只追加，骨架第 5 章的 FR 总数必须等于各 spec 抽取条数之和；
 * 少了就是某个 handler 把条目吃掉了，多了就是某份 spec 被合并了两次（子编号坍缩曾让 094-07 进骨架六次）。
 *
 * @param {object} skeleton
 * @param {object} timeline
 * @param {Record<string, { requirements?: Array<object> }>} parsedSpecs
 * @returns {object} ValidationCheck
 */
function checkFRCount(skeleton, timeline, parsedSpecs) {
  const activeFRCount = skeleton.mergeStats.activeFRCount;
  const extractedFRCount = timeline.entries.reduce((sum, entry) => {
    const requirements = parsedSpecs?.[entry.specId]?.requirements;
    return sum + (Array.isArray(requirements) ? requirements.length : 0);
  }, 0);
  const ch5 = skeleton.chapters['5'];
  const skeletonFRCount = ch5 ? ch5.functionalRequirements.length : 0;
  const passed = skeletonFRCount === extractedFRCount;

  return {
    name: 'fr-count',
    passed,
    detail: passed
      ? `骨架 FR 总数 (${skeletonFRCount}) == 各 spec 抽取条数之和 (${extractedFRCount})，其中活跃 ${activeFRCount}`
      : `骨架 FR 总数 (${skeletonFRCount}) != 各 spec 抽取条数之和 (${extractedFRCount})——合并丢失或重复合并`,
    data: {
      activeFRCount,
      extractedFRCount,
      skeletonFRCount,
    },
  };
}

/**
 * no-contradiction 检查：同一 spec 内同一 FR ID 不存在两个 active 版本
 * （冲突解决后应不存在，此为二次校验）
 *
 * @param {object} skeleton
 * @returns {object} ValidationCheck
 */
function checkNoContradiction(skeleton) {
  const activeById = {};
  let contradictions = 0;
  const contradictionDetails = [];

  for (const chapter of Object.values(skeleton.chapters)) {
    for (const fr of chapter.functionalRequirements) {
      if (fr.status !== 'active') {
        continue;
      }
      const key = `${fr.sourceSpec}::${fr.id}`;
      if (!activeById[key]) {
        activeById[key] = [];
      }
      activeById[key].push(fr.sourceSpec);
    }
  }

  for (const [frId, sources] of Object.entries(activeById)) {
    if (sources.length > 1) {
      contradictions += 1;
      contradictionDetails.push(`${frId}: ${sources.join(', ')}`);
    }
  }

  const passed = contradictions === 0;

  return {
    name: 'no-contradiction',
    passed,
    detail: passed
      ? '无矛盾的 FR 描述'
      : `发现 ${contradictions} 个矛盾: ${contradictionDetails.join('; ')}`,
    data: {
      contradictions,
    },
  };
}

/**
 * changelog-coverage 检查：变更历史覆盖所有归属 spec
 *
 * 收集所有 chapter 的 sourceSpecs 去重后的集合 >= timeline.entries 中所有 specId 的集合
 *
 * @param {object} skeleton
 * @param {object} timeline
 * @returns {object} ValidationCheck
 */
function checkChangelogCoverage(skeleton, timeline) {
  // 收集所有 chapter 中的 sourceSpecs
  const coveredSpecs = new Set();
  for (const chapter of Object.values(skeleton.chapters)) {
    for (const specId of chapter.sourceSpecs) {
      coveredSpecs.add(specId);
    }
  }

  // timeline 中的所有 specId
  const expectedSpecs = new Set(timeline.entries.map((e) => e.specId));

  // 检查是否所有 expected 都被 covered
  const missing = [];
  for (const specId of expectedSpecs) {
    if (!coveredSpecs.has(specId)) {
      missing.push(specId);
    }
  }

  const passed = missing.length === 0;

  return {
    name: 'changelog-coverage',
    passed,
    detail: passed
      ? `变更历史覆盖全部 ${expectedSpecs.size} 个 spec`
      : `缺少 ${missing.length} 个 spec 的变更记录: ${missing.join(', ')}`,
    data: {
      expectedCount: expectedSpecs.size,
      coveredCount: coveredSpecs.size,
      missingCount: missing.length,
    },
  };
}
