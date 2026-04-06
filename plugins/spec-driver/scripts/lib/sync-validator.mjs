/**
 * sync-validator.mjs — 验证模块
 *
 * 对合并结果执行三项验证检查：
 * 1. fr-count: 合并后 activeFRCount >= INITIAL spec 的 FR 数量
 * 2. no-contradiction: 同一 FR ID 不存在两个 active 版本
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
 * @returns {{ productId: string, passed: boolean, checks: Array<{ name: string, passed: boolean, detail: string, data: Record<string, number|string> }> }}
 *   ValidationReport
 */
export function validateMergeResult(skeleton, timeline) {
  const checks = [
    checkFRCount(skeleton, timeline),
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
 * fr-count 检查：合并后活跃 FR 数量 >= INITIAL spec 的 FR 数量
 *
 * @param {object} skeleton
 * @param {object} timeline
 * @returns {object} ValidationCheck
 */
function checkFRCount(skeleton, timeline) {
  // 找到 INITIAL 条目
  const initialEntry = timeline.entries.find((e) => e.type === 'INITIAL');
  const activeFRCount = skeleton.mergeStats.activeFRCount;

  // 计算 INITIAL spec 的 FR 数量
  // 从骨架的第 5 章中，查找 sourceSpec === INITIAL specId 的 active FR
  let initialFRCount = 0;
  if (initialEntry) {
    const ch5 = skeleton.chapters['5'];
    if (ch5) {
      // 统计 sourceSpec 为 INITIAL 的 FR 数量作为基线
      initialFRCount = ch5.functionalRequirements.filter(
        (fr) => fr.sourceSpec === initialEntry.specId
      ).length;
    }
  }

  const passed = activeFRCount >= initialFRCount;

  return {
    name: 'fr-count',
    passed,
    detail: passed
      ? `活跃 FR 数量 (${activeFRCount}) >= INITIAL FR 数量 (${initialFRCount})`
      : `活跃 FR 数量 (${activeFRCount}) < INITIAL FR 数量 (${initialFRCount})`,
    data: {
      activeFRCount,
      initialFRCount,
    },
  };
}

/**
 * no-contradiction 检查：同一 FR ID 不存在两个 active 版本
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
      if (!activeById[fr.id]) {
        activeById[fr.id] = [];
      }
      activeById[fr.id].push(fr.sourceSpec);
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
