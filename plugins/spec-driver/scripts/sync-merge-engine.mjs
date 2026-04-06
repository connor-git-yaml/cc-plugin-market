#!/usr/bin/env node

/**
 * sync-merge-engine.mjs — sync 合并引擎 CLI 入口
 *
 * 编排 5 个 lib 模块，执行确定性的 spec 合并流水线。
 * 输出 JSON（MergeEngineOutput）供 sync Agent 消费。
 *
 * CLI 参数：
 *   --project-root <path>  项目根目录（默认 cwd）
 *   --dry-run              不修改文件，仅预览
 *   --json                 JSON 格式输出
 *
 * @module sync-merge-engine
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// lib 模块导入
import {
  parseProductMapping,
  correctProductNames,
  detectUnmappedSpecs,
  serializeProductMapping,
  NAME_CORRECTION_RULES,
} from './lib/sync-product-mapping.mjs';
import { buildTimeline } from './lib/sync-timeline-builder.mjs';
import { executeMerge } from './lib/sync-merge-strategy.mjs';
import { resolveConflicts } from './lib/sync-conflict-resolver.mjs';
import { validateMergeResult } from './lib/sync-validator.mjs';

// 复用现有 helper
import { getProductsRoot } from './lib/product-artifact-paths.mjs';

// ────────────────────────────────────────────────────────────
// CLI 参数解析
// ────────────────────────────────────────────────────────────

/**
 * 解析 CLI 参数
 * @param {string[]} argv
 * @returns {{ projectRoot: string, dryRun: boolean, json: boolean }}
 */
function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), dryRun: false, json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--project-root') {
      args.projectRoot = argv[index + 1] ?? args.projectRoot;
      index += 1;
    }
    // 未知参数静默忽略
  }

  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

// ────────────────────────────────────────────────────────────
// Spec 扫描
// ────────────────────────────────────────────────────────────

/**
 * 扫描 specs/ 目录，提取 SpecEntry 列表
 * @param {string} projectRoot
 * @returns {Array<{ id: string, dirName: string, title: string|null, summary: string|null, status: string|null, filePath: string, createdDate: string|null }>}
 */
function scanSpecs(projectRoot) {
  const specsDir = path.join(projectRoot, 'specs');
  const entries = [];

  let dirList;
  try {
    dirList = fs.readdirSync(specsDir);
  } catch {
    return entries;
  }

  // 匹配 NNN-* 模式
  const specDirPattern = /^(\d{3})-(.+)$/;

  for (const dirName of dirList.sort()) {
    const match = specDirPattern.exec(dirName);
    if (!match) {
      continue;
    }

    const id = match[1];
    const specFilePath = path.join(specsDir, dirName, 'spec.md');

    if (!fs.existsSync(specFilePath)) {
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(specFilePath, 'utf-8');
    } catch {
      entries.push({
        id,
        dirName,
        title: null,
        summary: null,
        status: null,
        filePath: specFilePath,
        createdDate: null,
      });
      continue;
    }

    // 宽松解析 spec.md
    const { title, summary, status, createdDate } = parseSpecMeta(content);

    entries.push({
      id,
      dirName,
      title,
      summary,
      status,
      filePath: specFilePath,
      createdDate,
    });
  }

  return entries;
}

/**
 * 宽松解析 spec.md 元数据
 * @param {string} content
 * @returns {{ title: string|null, summary: string|null, status: string|null, createdDate: string|null }}
 */
function parseSpecMeta(content) {
  // 提取 H1 标题
  const titleMatch = /^#\s+(.+?)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : null;

  // 提取 YAML Front Matter
  let status = null;
  let createdDate = null;
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/m.exec(content);
  if (fmMatch) {
    const fmContent = fmMatch[1];
    const statusMatch = /^status:\s*(.+)$/m.exec(fmContent);
    if (statusMatch) status = statusMatch[1].trim();
    const createdMatch = /^created:\s*(.+)$/m.exec(fmContent);
    if (createdMatch) createdDate = createdMatch[1].trim();
  }

  // 提取概述段：第一个 H1 后到第一个 H2 之前的正文（前 200 字符）
  let summary = null;
  const overviewMatch = /^#\s+.+?\n([\s\S]*?)(?=\n##\s|$)/m.exec(content);
  if (overviewMatch) {
    const overviewText = overviewMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('---') && !l.startsWith('>'))
      .join(' ')
      .trim();
    if (overviewText) {
      summary = overviewText.slice(0, 200);
    }
  }

  return { title, summary, status, createdDate };
}

// ────────────────────────────────────────────────────────────
// Spec 内容解析
// ────────────────────────────────────────────────────────────

/**
 * 宽松解析 spec.md 的结构化内容（以 H2 为分割点）
 * @param {string} specFilePath
 * @returns {object} ParsedSpecContent
 */
function parseSpecContent(specFilePath) {
  const result = {
    title: null,
    overview: null,
    frontMatter: null,
    userStories: [],
    requirements: [],
    successCriteria: [],
    constraints: null,
    dependencies: null,
  };

  let content;
  try {
    content = fs.readFileSync(specFilePath, 'utf-8');
  } catch {
    return result;
  }

  // 提取 H1 标题
  const titleMatch = /^#\s+(.+?)$/m.exec(content);
  result.title = titleMatch ? titleMatch[1].trim() : null;

  // 提取 YAML Front Matter
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/m.exec(content);
  if (fmMatch) {
    const fm = {};
    for (const line of fmMatch[1].split('\n')) {
      const kvMatch = /^(\w[\w-]*):\s*(.+)$/.exec(line.trim());
      if (kvMatch) {
        fm[kvMatch[1]] = kvMatch[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    result.frontMatter = fm;
  }

  // 按 H2 分割
  const sections = splitByH2(content);

  // 提取 User Stories
  for (const [heading, sectionContent] of Object.entries(sections)) {
    const headingLower = heading.toLowerCase();

    if (headingLower.includes('user') && (headingLower.includes('scenario') || headingLower.includes('story') || headingLower.includes('stories'))) {
      result.userStories = extractUserStories(sectionContent);
    }

    if (headingLower.includes('requirement') || headingLower.includes('functional')) {
      result.requirements = extractFunctionalRequirements(sectionContent);
    }

    if (headingLower.includes('success') && headingLower.includes('criter')) {
      result.successCriteria = extractBulletList(sectionContent);
    }

    if (headingLower.includes('constraint') || headingLower.includes('boundary') || headingLower.includes('boundari')) {
      result.constraints = sectionContent.trim();
    }

    if (headingLower.includes('depend') || headingLower.includes('impact')) {
      result.dependencies = sectionContent.trim();
    }
  }

  return result;
}

/**
 * 按 H2 (##) 分割 Markdown 内容
 * @param {string} content
 * @returns {Record<string, string>} 键为标题文本，值为该章节正文
 */
function splitByH2(content) {
  const sections = {};
  const h2Pattern = /^##\s+(.+?)$/gm;
  let lastMatch = null;
  let match;

  while ((match = h2Pattern.exec(content)) !== null) {
    if (lastMatch) {
      sections[lastMatch[1].trim()] = content.slice(lastMatch.index + lastMatch[0].length, match.index).trim();
    }
    lastMatch = match;
  }

  if (lastMatch) {
    sections[lastMatch[1].trim()] = content.slice(lastMatch.index + lastMatch[0].length).trim();
  }

  return sections;
}

/**
 * 从 User Stories 章节提取 UserStoryRaw 列表
 * @param {string} sectionContent
 * @returns {Array<{ title: string, priority: string|null, rawText: string }>}
 */
function extractUserStories(sectionContent) {
  const stories = [];
  // 匹配 H3 子标题（### US1: ... 或 ### 1. ...）
  const h3Pattern = /^###\s+(.+?)$/gm;
  let lastMatch = null;
  let match;
  const blocks = [];

  while ((match = h3Pattern.exec(sectionContent)) !== null) {
    if (lastMatch) {
      blocks.push({
        title: lastMatch[1].trim(),
        content: sectionContent.slice(lastMatch.index + lastMatch[0].length, match.index).trim(),
      });
    }
    lastMatch = match;
  }
  if (lastMatch) {
    blocks.push({
      title: lastMatch[1].trim(),
      content: sectionContent.slice(lastMatch.index + lastMatch[0].length).trim(),
    });
  }

  // 如果没有 H3，尝试匹配列表项
  if (blocks.length === 0) {
    const listItems = sectionContent.split(/\n(?=[-*]\s)/).filter(Boolean);
    for (const item of listItems) {
      const text = item.replace(/^[-*]\s+/, '').trim();
      if (text) {
        stories.push({ title: text.split('\n')[0], priority: null, rawText: text });
      }
    }
    return stories;
  }

  for (const block of blocks) {
    // 提取优先级标注
    const priorityMatch = /\(?(P[0-3])\)?/i.exec(block.title);
    stories.push({
      title: block.title,
      priority: priorityMatch ? priorityMatch[1].toUpperCase() : null,
      rawText: block.content || block.title,
    });
  }

  return stories;
}

/**
 * 从 Requirements 章节提取 FRRaw 列表
 * @param {string} sectionContent
 * @returns {Array<{ id: string, description: string, level: string|null }>}
 */
function extractFunctionalRequirements(sectionContent) {
  const requirements = [];
  // 匹配 FR-NNN 模式（可在行首或列表项中）
  const frPattern = /(?:^|\n)\s*[-*]?\s*(FR-\d{3})\s*[:\uff1a]\s*(.+?)(?=\n\s*[-*]?\s*FR-\d{3}|\n##|\n$|$)/gs;
  let match;

  while ((match = frPattern.exec(sectionContent)) !== null) {
    const id = match[1];
    const description = match[2].trim();
    const levelMatch = /\b(MUST|SHOULD|MAY)\b/i.exec(description);

    requirements.push({
      id,
      description,
      level: levelMatch ? levelMatch[1].toUpperCase() : null,
    });
  }

  // 如果 FR-NNN 模式匹配为空，尝试 H3 子标题模式
  if (requirements.length === 0) {
    const h3Pattern = /^###\s+.*(FR-\d{3}).*$/gm;
    let h3Match;
    const h3Blocks = [];
    let lastH3 = null;

    while ((h3Match = h3Pattern.exec(sectionContent)) !== null) {
      if (lastH3) {
        h3Blocks.push({
          id: lastH3[1],
          content: sectionContent.slice(lastH3.index + lastH3[0].length, h3Match.index).trim(),
        });
      }
      lastH3 = h3Match;
    }
    if (lastH3) {
      h3Blocks.push({
        id: lastH3[1],
        content: sectionContent.slice(lastH3.index + lastH3[0].length).trim(),
      });
    }

    for (const block of h3Blocks) {
      const levelMatch = /\b(MUST|SHOULD|MAY)\b/i.exec(block.content);
      requirements.push({
        id: block.id,
        description: block.content.split('\n')[0] || block.id,
        level: levelMatch ? levelMatch[1].toUpperCase() : null,
      });
    }
  }

  return requirements;
}

/**
 * 提取简单的列表项
 * @param {string} sectionContent
 * @returns {string[]}
 */
function extractBulletList(sectionContent) {
  return sectionContent
    .split('\n')
    .filter((l) => /^\s*[-*]\s/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────

/**
 * 执行合并引擎主流程
 *
 * @param {{ projectRoot?: string, dryRun?: boolean, json?: boolean }} options
 * @returns {object} MergeEngineOutput
 */
export function syncMergeEngine(options = {}) {
  const startTime = Date.now();
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const warnings = [];

  // ── 前置校验 ──

  if (!fs.existsSync(projectRoot)) {
    return {
      error: `项目根目录不存在: ${projectRoot}`,
      code: 'INVALID_PROJECT_ROOT',
    };
  }

  const specsDir = path.join(projectRoot, 'specs');
  if (!fs.existsSync(specsDir)) {
    return {
      error: `specs 目录不存在: ${specsDir}`,
      code: 'NO_SPECS_DIR',
    };
  }

  // ── Phase 1: 扫描 specs ──

  const scannedSpecs = scanSpecs(projectRoot);
  if (scannedSpecs.length === 0) {
    warnings.push('specs/ 目录下未找到有效的 spec 目录');
  }

  // ── Phase 2: 加载产品映射 ──

  const productsRoot = getProductsRoot(projectRoot);
  const mappingPath = path.join(productsRoot, 'product-mapping.yaml');

  let rawMapping;
  if (fs.existsSync(mappingPath)) {
    try {
      const yamlContent = fs.readFileSync(mappingPath, 'utf-8');
      rawMapping = parseProductMapping(yamlContent);
    } catch {
      rawMapping = { products: {} };
      warnings.push(`product-mapping.yaml 解析失败，使用空映射`);
    }
  } else {
    rawMapping = { products: {} };
    warnings.push(`product-mapping.yaml 不存在，使用空映射`);
  }

  // ── Phase 3: 产品名修正 ──

  const correctedMapping = correctProductNames(rawMapping, NAME_CORRECTION_RULES);

  // ── Phase 4: 差集检测 ──

  const unmappedSpecs = detectUnmappedSpecs(correctedMapping, scannedSpecs);
  if (unmappedSpecs.length > 0) {
    warnings.push(`发现 ${unmappedSpecs.length} 个未映射的 spec: ${unmappedSpecs.map((s) => s.specId).join(', ')}`);
  }

  // ── Phase 5: 逐产品处理 ──

  const products = {};
  const validationReports = [];
  let totalActiveFR = 0;
  let totalConflicts = 0;

  for (const [productId, productDef] of Object.entries(correctedMapping.products)) {
    // 获取该产品下的 spec 条目
    const productSpecEntries = scannedSpecs.filter((spec) =>
      productDef.specs.includes(spec.id)
    );

    if (productSpecEntries.length === 0) {
      warnings.push(`产品 ${productId} 下无有效的 spec 条目`);
      continue;
    }

    // 解析每个 spec 的内容
    const parsedSpecs = {};
    for (const entry of productSpecEntries) {
      parsedSpecs[entry.id] = parseSpecContent(entry.filePath);
    }

    // 构建时间线
    const timeline = buildTimeline(productSpecEntries, productId);
    if (timeline.warnings.length > 0) {
      warnings.push(...timeline.warnings.map((w) => `[${productId}] ${w}`));
    }

    // 执行合并
    const mergeSkeleton = executeMerge(timeline, parsedSpecs);

    // 解决冲突
    const { skeleton: resolvedSkeleton, conflicts } = resolveConflicts(mergeSkeleton);

    // 验证
    const validation = validateMergeResult(resolvedSkeleton, timeline);
    validationReports.push(validation);

    totalActiveFR += resolvedSkeleton.mergeStats.activeFRCount;
    totalConflicts += conflicts.length;

    products[productId] = {
      productId,
      timeline,
      mergeSkeleton: resolvedSkeleton,
      conflicts,
      validation,
    };
  }

  // ── Phase 6: 组装输出 ──

  const output = {
    schemaVersion: '1.0.0',
    products,
    unmappedSpecs,
    validation: {
      allPassed: validationReports.every((r) => r.passed),
      reports: validationReports,
    },
    warnings,
    stats: {
      totalProducts: Object.keys(products).length,
      totalSpecs: scannedSpecs.length,
      totalActiveFR,
      totalConflicts,
      executionTimeMs: Date.now() - startTime,
    },
  };

  if (dryRun) {
    output.dryRun = true;
  }

  // ── Phase 7: 写入（非 dry-run）──

  if (!dryRun) {
    // 检查映射是否发生变化，仅在有差异时写入
    const newMappingYaml = serializeProductMapping(correctedMapping);
    let oldMappingYaml = '';
    if (fs.existsSync(mappingPath)) {
      try {
        oldMappingYaml = fs.readFileSync(mappingPath, 'utf-8').trim();
      } catch {
        // 忽略读取失败
      }
    }

    if (newMappingYaml.trim() !== oldMappingYaml) {
      try {
        fs.mkdirSync(path.dirname(mappingPath), { recursive: true });
        fs.writeFileSync(mappingPath, newMappingYaml.endsWith('\n') ? newMappingYaml : `${newMappingYaml}\n`, 'utf-8');
      } catch (err) {
        warnings.push(`写入 product-mapping.yaml 失败: ${err.message}`);
      }
    }
  }

  return output;
}

// ────────────────────────────────────────────────────────────
// 输出格式化
// ────────────────────────────────────────────────────────────

/**
 * 输出结果到 stdout
 * @param {object} result
 * @param {{ json: boolean, dryRun: boolean }} args
 */
function printResult(result, args) {
  // 错误情况：始终 JSON 输出
  if (result.error) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  // --json 模式或 --dry-run + --json 组合
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  // dry-run 非 json 模式：人类可读混合格式
  if (args.dryRun) {
    const lines = [
      '═══ Sync Merge Engine — Dry Run ═══',
      '',
      `Schema Version: ${result.schemaVersion}`,
      `产品数: ${result.stats.totalProducts}`,
      `Spec 总数: ${result.stats.totalSpecs}`,
      `活跃 FR 总数: ${result.stats.totalActiveFR}`,
      `冲突数: ${result.stats.totalConflicts}`,
      `执行时间: ${result.stats.executionTimeMs}ms`,
      '',
    ];

    // 逐产品摘要
    for (const [productId, productResult] of Object.entries(result.products)) {
      lines.push(`── ${productId} ──`);
      lines.push(`  时间线: ${productResult.timeline.entries.length} 个 spec`);
      const stats = productResult.timeline.stats;
      lines.push(`  类型分布: INITIAL=${stats.INITIAL} FEATURE=${stats.FEATURE} FIX=${stats.FIX} REFACTOR=${stats.REFACTOR} ENHANCEMENT=${stats.ENHANCEMENT}`);
      lines.push(`  活跃 FR: ${productResult.mergeSkeleton.mergeStats.activeFRCount}`);
      lines.push(`  冲突: ${productResult.conflicts.length}`);
      lines.push(`  验证: ${productResult.validation.passed ? '通过' : '未通过'}`);
      lines.push('');
    }

    // 未映射 spec
    if (result.unmappedSpecs.length > 0) {
      lines.push('── 未映射 Spec ──');
      for (const spec of result.unmappedSpecs) {
        lines.push(`  ${spec.specId}: ${spec.title || spec.dirName}`);
      }
      lines.push('');
    }

    // 警告
    if (result.warnings.length > 0) {
      lines.push('── 警告 ──');
      for (const warning of result.warnings) {
        lines.push(`  ⚠ ${warning}`);
      }
      lines.push('');
    }

    lines.push(`验证: ${result.validation.allPassed ? '全部通过' : '存在未通过项'}`);

    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  // 正常模式（非 dry-run、非 json）：输出 JSON
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// ────────────────────────────────────────────────────────────
// CLI 入口
// ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = syncMergeEngine(args);
  printResult(result, args);
}
