/**
 * sync-merge-strategy.mjs — 增量合并策略模块
 *
 * 负责按 Timeline 的类型规则执行增量合并，生成 MergeSkeleton（14 章结构）。
 * 所有导出函数均为纯函数（无副作用）。
 *
 * @module sync-merge-strategy
 */

// ────────────────────────────────────────────────────────────
// 14 章标题常量（与 merge-engine-output.md Section 6 一致）
// ────────────────────────────────────────────────────────────

/** @type {Record<string, string>} */
export const CHAPTER_TITLES = {
  '1': '产品概述',
  '2': '目标与成功指标',
  '3': '用户画像与场景',
  '4': '范围与边界',
  '5': '当前功能全集',
  '6': '非功能需求',
  '7': '当前技术架构',
  '8': '设计原则与决策记录',
  '9': '已知限制与技术债',
  '10': '假设与风险',
  '11': '被废弃的功能',
  '12': '变更历史',
  '13': '术语表',
  '14': '附录：增量 spec 索引',
};

// ────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────

/**
 * 创建空的 MergeSkeleton
 * @param {string} productId
 * @returns {object} MergeSkeleton
 */
function createEmptySkeleton(productId) {
  const chapters = {};
  for (const [num, title] of Object.entries(CHAPTER_TITLES)) {
    chapters[num] = {
      title,
      number: parseInt(num, 10),
      functionalRequirements: [],
      userStories: [],
      sourceSpecs: [],
      changeSummary: '',
    };
  }

  return {
    productId,
    chapters,
    mergeStats: {
      activeFRCount: 0,
      supersededFRCount: 0,
      deprecatedFRCount: 0,
      userStoryCount: 0,
      totalSpecCount: 0,
    },
  };
}

/**
 * 在 FR 列表中查找同 ID 的条目
 * @param {Array<object>} frList
 * @param {string} frId
 * @returns {object|null}
 */
function findFRById(frList, frId) {
  return frList.find((fr) => fr.id === frId) ?? null;
}

/**
 * 向章节的 sourceSpecs 添加 specId（去重）
 * @param {object} chapter
 * @param {string} specId
 */
function addSourceSpec(chapter, specId) {
  if (!chapter.sourceSpecs.includes(specId)) {
    chapter.sourceSpecs.push(specId);
  }
}

// ────────────────────────────────────────────────────────────
// 合并处理器（按 SpecType）
// ────────────────────────────────────────────────────────────

/**
 * INITIAL 类型：将其 FR 和 UserStory 作为基础写入骨架
 */
function mergeInitial(skeleton, specId, parsedContent) {
  const ch5 = skeleton.chapters['5'];
  const ch3 = skeleton.chapters['3'];

  // 写入 FR
  if (Array.isArray(parsedContent.requirements)) {
    for (const fr of parsedContent.requirements) {
      ch5.functionalRequirements.push({
        id: fr.id,
        description: fr.description,
        sourceSpec: specId,
        status: 'active',
        supersededBy: null,
      });
    }
  }

  // 写入 User Stories
  if (Array.isArray(parsedContent.userStories)) {
    for (const us of parsedContent.userStories) {
      ch3.userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
      ch5.userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
    }
  }

  // 标记所有章节的来源
  for (const chapter of Object.values(skeleton.chapters)) {
    addSourceSpec(chapter, specId);
  }
}

/**
 * FEATURE 类型：追加新的 FR 和 UserStory（id 不重复则 append）
 */
function mergeFeature(skeleton, specId, parsedContent) {
  const ch5 = skeleton.chapters['5'];
  const ch3 = skeleton.chapters['3'];

  if (Array.isArray(parsedContent.requirements)) {
    for (const fr of parsedContent.requirements) {
      const existing = findFRById(ch5.functionalRequirements, fr.id);
      if (!existing) {
        ch5.functionalRequirements.push({
          id: fr.id,
          description: fr.description,
          sourceSpec: specId,
          status: 'active',
          supersededBy: null,
        });
      }
      // 如果已存在同 ID 的 FR，不追加（保持现有版本）
    }
  }

  if (Array.isArray(parsedContent.userStories)) {
    for (const us of parsedContent.userStories) {
      ch3.userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
      ch5.userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
    }
  }

  // 标记相关章节来源
  addSourceSpec(ch5, specId);
  addSourceSpec(ch3, specId);
  addSourceSpec(skeleton.chapters['12'], specId);
  addSourceSpec(skeleton.chapters['14'], specId);
}

/**
 * FIX 类型：查找同 FR ID，更新 description，标记 sourceSpec
 */
function mergeFix(skeleton, specId, parsedContent) {
  const ch5 = skeleton.chapters['5'];

  if (Array.isArray(parsedContent.requirements)) {
    for (const fr of parsedContent.requirements) {
      const existing = findFRById(ch5.functionalRequirements, fr.id);
      if (existing && existing.status === 'active') {
        existing.description = fr.description;
        existing.sourceSpec = specId;
      } else if (!existing) {
        // FIX 中的新 FR（防御性：理论上 fix 不新增，但容错处理）
        ch5.functionalRequirements.push({
          id: fr.id,
          description: fr.description,
          sourceSpec: specId,
          status: 'active',
          supersededBy: null,
        });
      }
    }
  }

  addSourceSpec(ch5, specId);
  addSourceSpec(skeleton.chapters['12'], specId);
  addSourceSpec(skeleton.chapters['14'], specId);
}

/**
 * REFACTOR 类型：查找同 FR ID，替换 description，记录 supersededBy
 */
function mergeRefactor(skeleton, specId, parsedContent) {
  const ch5 = skeleton.chapters['5'];
  const ch11 = skeleton.chapters['11'];

  if (Array.isArray(parsedContent.requirements)) {
    for (const fr of parsedContent.requirements) {
      const existing = findFRById(ch5.functionalRequirements, fr.id);
      if (existing && existing.status === 'active') {
        // 标记旧版本被取代
        existing.status = 'superseded';
        existing.supersededBy = specId;

        // 追加新版本
        ch5.functionalRequirements.push({
          id: fr.id,
          description: fr.description,
          sourceSpec: specId,
          status: 'active',
          supersededBy: null,
        });
      } else if (!existing) {
        ch5.functionalRequirements.push({
          id: fr.id,
          description: fr.description,
          sourceSpec: specId,
          status: 'active',
          supersededBy: null,
        });
      }
    }
  }

  if (Array.isArray(parsedContent.userStories)) {
    for (const us of parsedContent.userStories) {
      skeleton.chapters['3'].userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
    }
  }

  addSourceSpec(ch5, specId);
  addSourceSpec(ch11, specId);
  addSourceSpec(skeleton.chapters['12'], specId);
  addSourceSpec(skeleton.chapters['14'], specId);
}

/**
 * ENHANCEMENT 类型：查找同 FR ID，增强 description（追加而非替换）
 */
function mergeEnhancement(skeleton, specId, parsedContent) {
  const ch5 = skeleton.chapters['5'];

  if (Array.isArray(parsedContent.requirements)) {
    for (const fr of parsedContent.requirements) {
      const existing = findFRById(ch5.functionalRequirements, fr.id);
      if (existing && existing.status === 'active') {
        // 增强：追加描述
        existing.description = `${existing.description}\n[增强 by ${specId}] ${fr.description}`;
        existing.sourceSpec = specId;
      } else if (!existing) {
        ch5.functionalRequirements.push({
          id: fr.id,
          description: fr.description,
          sourceSpec: specId,
          status: 'active',
          supersededBy: null,
        });
      }
    }
  }

  if (Array.isArray(parsedContent.userStories)) {
    for (const us of parsedContent.userStories) {
      skeleton.chapters['3'].userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
      ch5.userStories.push({
        title: us.title,
        description: us.rawText || us.title,
        sourceSpec: specId,
        priority: us.priority ?? null,
      });
    }
  }

  addSourceSpec(ch5, specId);
  addSourceSpec(skeleton.chapters['12'], specId);
  addSourceSpec(skeleton.chapters['14'], specId);
}

// ────────────────────────────────────────────────────────────
// 导出函数
// ────────────────────────────────────────────────────────────

/**
 * 按 Timeline 顺序执行增量合并，生成 MergeSkeleton。
 *
 * 同一 timeline + parsedSpecs 输入多次调用结果完全一致（确定性）。
 *
 * @param {{ productId: string, entries: Array<{ specId: string, dirName: string, type: string }> }} timeline
 * @param {Record<string, object>} parsedSpecs — 键为 specId，值为 ParsedSpecContent
 * @returns {object} MergeSkeleton
 */
export function executeMerge(timeline, parsedSpecs) {
  const skeleton = createEmptySkeleton(timeline.productId);

  // 合并策略分发表
  const mergeHandlers = {
    INITIAL: mergeInitial,
    FEATURE: mergeFeature,
    FIX: mergeFix,
    REFACTOR: mergeRefactor,
    ENHANCEMENT: mergeEnhancement,
  };

  // 按 timeline 顺序遍历
  for (const entry of timeline.entries) {
    const parsedContent = parsedSpecs[entry.specId] || {
      requirements: [],
      userStories: [],
    };

    const handler = mergeHandlers[entry.type];
    if (handler) {
      handler(skeleton, entry.specId, parsedContent);
    }
  }

  // 计算 mergeStats
  let activeFRCount = 0;
  let supersededFRCount = 0;
  let deprecatedFRCount = 0;
  let userStoryCount = 0;

  for (const chapter of Object.values(skeleton.chapters)) {
    for (const fr of chapter.functionalRequirements) {
      if (fr.status === 'active') activeFRCount += 1;
      if (fr.status === 'superseded') supersededFRCount += 1;
      if (fr.status === 'deprecated') deprecatedFRCount += 1;
    }
    userStoryCount += chapter.userStories.length;
  }

  skeleton.mergeStats = {
    activeFRCount,
    supersededFRCount,
    deprecatedFRCount,
    userStoryCount,
    totalSpecCount: timeline.entries.length,
  };

  // 填充各章节 changeSummary
  for (const chapter of Object.values(skeleton.chapters)) {
    const sources = chapter.sourceSpecs;
    const frCount = chapter.functionalRequirements.filter((fr) => fr.status === 'active').length;
    const usCount = chapter.userStories.length;

    const parts = [];
    if (frCount > 0) parts.push(`${frCount} FR`);
    if (usCount > 0) parts.push(`${usCount} User Stories`);
    if (sources.length > 0) parts.push(`来自 ${sources.join(', ')}`);

    chapter.changeSummary = parts.length > 0 ? parts.join('，') : '无变更';
  }

  return skeleton;
}
