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
  extractSpecId,
  NAME_CORRECTION_RULES,
} from './lib/sync-product-mapping.mjs';
import { buildTimeline } from './lib/sync-timeline-builder.mjs';
import { executeMerge } from './lib/sync-merge-strategy.mjs';
import { resolveConflicts } from './lib/sync-conflict-resolver.mjs';
import { validateMergeResult } from './lib/sync-validator.mjs';

// 复用现有 helper
import { getProductsRoot } from './lib/product-artifact-paths.mjs';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';

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
/**
 * specs/ 下的全部目录名（不存在则空）；scanSpecs 只保留有 spec.md 的，这里不筛。
 * @param {string} specsDir
 * @returns {string[]}
 */
function listSpecDirNames(specsDir) {
  try {
    return fs.readdirSync(specsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function scanSpecs(projectRoot) {
  const specsDir = path.join(projectRoot, 'specs');
  const entries = [];

  let dirList;
  try {
    dirList = fs.readdirSync(specsDir);
  } catch {
    return entries;
  }

  // 匹配 NNN-* / NNN-NN-* 目录（编号口径与 product-mapping 共用 extractSpecId）
  for (const dirName of dirList.sort()) {
    const id = extractSpecId(dirName);
    if (!id || !/^-\S/.test(dirName.slice(id.length))) {
      continue;
    }

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
export function parseSpecContent(specFilePath) {
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

  // 同一类节可能出现多次（`## 功能需求` 之后常跟 `## 非功能需求` / `## 需求模糊点说明`），此前按「最后命中者覆盖」
  // 路由，20 份 spec 的 301 条 FR 被后续标题静默归零、候选计数同时被抹成 0 导致 warning 失明（2026-09-14 delta 审查 C-1）。
  // 现改为：命中即累加；requirements 排除非功能 / 模糊点类标题；Edge Cases（`边界`）不是约束，不再路由进 constraints（W-5）。
  result.frCandidateIds = new Set();
  result.requirementsHeadingCount = 0;
  // 需求类 H2 之外的 FR 条目写法（`## Clarifications` 下的「新增需求」、`## FR-002：…` 这样的 H2 位条目）：
  // 它们不抽取，但必须可见——候选集若只从被路由到的节收集，路由层的丢失对护栏结构性不可见（角 A 审查 C-1：
  // spec 032 在 Clarifications 下写了 7 条 FR，含 3 条对已抽取条目的「修正」，按编号集合差永远报不出来）
  result.frEntriesOutside = [];
  const constraintParts = [];
  const dependencyParts = [];
  for (const { heading, content: sectionContent } of sections) {
    const headingLower = heading.toLowerCase();
    const h2Entry = FR_ENTRY_HEAD.exec(`### ${heading}`);
    if (h2Entry) result.frEntriesOutside.push({ id: h2Entry[1], heading: `## ${heading}` });

    if ((headingLower.includes('user') && (headingLower.includes('scenario') || headingLower.includes('story') || headingLower.includes('stories'))) || heading.includes('用户场景') || heading.includes('用户故事')) {
      result.userStories.push(...extractUserStories(sectionContent));
    }

    if (isRequirementsHeading(heading)) {
      result.requirementsHeadingCount += 1;
      result.requirements.push(...extractFunctionalRequirements(sectionContent));
      for (const id of collectFRCandidateIds(sectionContent)) result.frCandidateIds.add(id);
    } else {
      for (const id of collectFREntryIds(sectionContent)) result.frEntriesOutside.push({ id, heading: `## ${heading}` });
    }

    if ((headingLower.includes('success') && headingLower.includes('criter')) || heading.includes('成功标准')) {
      result.successCriteria.push(...extractBulletList(sectionContent));
    }

    if (isConstraintsHeading(heading)) {
      constraintParts.push(sectionContent.trim());
    }

    if (headingLower.includes('depend') || headingLower.includes('impact')) {
      dependencyParts.push(sectionContent.trim());
    }
  }
  // 同一 spec 内重复出现的编号（`**FR-001 验收信号**：…` 段落、YAGNI 移除记录 `- FR-004（…）：… 标 [YAGNI-移除]`）
  // 是对同一条需求的再次陈述，不是第二条需求：按出现顺序并入首条描述并登记，供 Phase 5 发 warning。
  // 此前当成重复编号进冲突账，移除记录被判 superseded 而被移除的需求仍 active——语义正好反了（角 B 审查 W-B1）。
  result.duplicateFRIds = [];
  const firstById = new Map();
  const deduped = [];
  for (const fr of result.requirements) {
    const first = firstById.get(fr.id);
    if (!first) {
      firstById.set(fr.id, fr);
      deduped.push(fr);
      continue;
    }
    first.description = `${first.description}\n\n${fr.description}`.trim();
    if (!first.level && fr.level) first.level = fr.level;
    result.duplicateFRIds.push(fr.id);
  }
  result.requirements = deduped;
  if (constraintParts.length > 0) result.constraints = constraintParts.join('\n\n');
  if (dependencyParts.length > 0) result.dependencies = dependencyParts.join('\n\n');

  return result;
}

/**
 * 需求类 H2：命中 requirement / functional / 需求，且不是非功能（NFR）或需求模糊点说明——后两者与功能需求同处一份
 * spec 时排在其后，若同样路由会覆盖或稀释功能需求。全仓 27 种写法（2026-09-14 统计）均落在这两条规则内。
 * @param {string} heading
 * @returns {boolean}
 */
/**
 * 约束类 H2：约束 / constraint / 英文 boundary（`Scope Boundaries` 是 In Scope / Out of Scope，角 B 审查 C-B2：此前误删）/
 * 中文「范围边界 / 能力边界 / 约束与边界」；「边界条件 / 边界情况 / 边界场景 / Edge Cases」是边界用例，不是约束。
 * @param {string} heading
 * @returns {boolean}
 */
export function isConstraintsHeading(heading) {
  const lower = heading.toLowerCase();
  const positive = lower.includes('constraint') || lower.includes('boundar') || heading.includes('约束') || heading.includes('边界');
  const edgeCase = lower.includes('edge case') || /边界(?:条件|情况|场景|用例)/.test(heading);
  return positive && !edgeCase;
}

export function isRequirementsHeading(heading) {
  const lower = heading.toLowerCase();
  const positive = lower.includes('requirement') || lower.includes('functional') || heading.includes('需求');
  const negative = lower.includes('non-functional') || lower.includes('nfr') || heading.includes('非功能') || heading.includes('模糊');
  return positive && !negative;
}

/**
 * 按 H2 (##) 分割 Markdown 内容。返回**数组**而不是以标题为键的对象：同名 H2（两段 `## 功能需求`）在对象里会
 * 后者覆盖前者，与「后标题覆盖前标题」那条已修缺陷同构（角 A 审查 C-2）；fenced code 里的 `## ` 行不是标题
 * （角 A 审查 W-1：一个 ```` ```md ```` 示例就把需求节后半段切给伪标题）。
 * @param {string} content
 * @returns {Array<{ heading: string, content: string }>}
 */
function splitByH2(content) {
  const sections = [];
  let current = null;
  for (const { line, inFence } of classifyLines(content)) {
    const match = inFence ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.push({ heading: current.heading, content: current.lines.join('\n').trim() });
      current = { heading: match[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ heading: current.heading, content: current.lines.join('\n').trim() });
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
// FR 条目的真实写法（2026-09-14 全仓统计）：列表位置上的 FR 编号即条目（1600+ 行）、行首粗体段落 `**FR-001**: …`
// 也是条目（214 行，spec 090 等整份如此）、标题位置（`### FR-016：…` / `#### FR-A01 [必须] …`，220 行）也是条目。
// 编号形态：`FR-001` 为主，另有 `FR-1` / `FR-10`（186 行）、`FR-A-001` / `FR-A01`（字母分组，094-06 / 094-03 / 187）、
// 点分子编号（`FR-1.1` / `FR-3.1.1`，60 行）、字母 / `-x` 后缀且大小写皆有（`FR-002a` / `FR-003A` / `FR-007-A` / `FR-026-01`）；
// 编号后可跟粗体短标题、
// 强度注解（`\`[必须]\`` / `[必须]` / `（MUST · [必须]）`）、冒号可有可无。
// 不是条目：缩进的裸编号续行（`  FR-013 fail-open 之外…`，是上一条的正文）、引用块里的编号（正文引用）、
// 标题中段的编号（`### 澄清 2: FR-006 …` 是引用）、区间标签（`#### FR-001 ~ FR-005: 分组名` 是分组，条目在其下）、fenced code 里的示例行。
// 候选 = 条目前缀 ∪ 表格行 ∪ 反引号包裹 ∪ 行首裸编号段落，编号用宽判据；由构造保证 候选 ⊇ 条目，
// 陌生写法（四位编号、反引号 ID、表格）只会进候选、由「候选编号未抽取」warning 兜住而不会静默消失。
const FR_ID = String.raw`FR-(?:[A-Z]-?)?\d{1,3}(?:\.\d+)*(?:[A-Za-z]|-(?!FR-)[A-Za-z0-9]+)?`;
const FR_ID_LOOSE = String.raw`FR-[A-Za-z]?-?\d+(?:\.\d+)*[A-Za-z0-9-]*`;
const LIST_MARK = String.raw`(?:[-*+]|\d+[.)])\s+`;
const HEADING_MARK = String.raw`#{3,6}\s+`;
const FR_ENTRY_HEAD = new RegExp(String.raw`^\s*(?:${LIST_MARK}\**|${HEADING_MARK}\**|\*\*)(${FR_ID})\b`);
// 前缀组可缺席 = 行首（不缩进）裸编号段落也算候选；缩进的裸编号是续行，不算
const FR_CANDIDATE_LINE = new RegExp(String.raw`^(?:\s*(?:${LIST_MARK}\**\x60?|${HEADING_MARK}\**\x60?|\*\*|\|\s*\**\x60?|\x60))?(${FR_ID_LOOSE})`);
// 行首注解只剥「纯强度标记」（`[必须]` / `\`[可选]\`` / `（MUST · [必须]）` / `[MUST NOT]`）；`（离线重判）` / `[Story 1, 3]` /
// `\`[Non-goal]\`` 这类短标题、溯源标签、语义限定是需求内容的一部分，保留为描述前缀（角 B 审查 W-B2：此前 98 处被吞）
const STRENGTH_TOKEN = String.raw`(?:必须|可选|推荐|应当|MUST(?:\s+NOT)?|SHOULD(?:\s+NOT)?|MAY|SHALL(?:\s+NOT)?|REQUIRED|OPTIONAL|RECOMMENDED)`;
const STRENGTH_ONLY = new RegExp(String.raw`^\s*\[?${STRENGTH_TOKEN}\]?(?:\s*[·•/|,，、]\s*\[?${STRENGTH_TOKEN}\]?)*\s*$`, 'i');
const LEADING_GROUP = /^\s*(?:\x60([^\x60\n]*)\x60|\[([^\]\n]*)\]|（([^）\n]*)）|\(([^)\n]*)\))/;
// 编号后紧跟区间符再接编号（`~ FR-005` / `～005` / `— FR-003`）的是区间标签；`FR-9 — 6 个工具` 里的破折号后是计数不是编号，仍是条目
const FR_RANGE_TAIL = /^\**\s*(?:[~～]\s*\**(?:FR-)?\d|[–—-]\s*\**FR-)/;
const FENCE_LINE = /^\s*(?:\x60{3,}|~{3,})/;
const HEADING_LINE = /^\s*#{2,6}\s/;

/** 条目首行：去掉粗体标记、纯强度注解、编号后的分隔符（冒号或破折号）；实质性的括号 / 方括号短标题保留为描述前缀。 */
function cleanEntryFirstLine(rest) {
  let text = rest.replace(/\*\*/g, '');
  const kept = [];
  for (;;) {
    const match = LEADING_GROUP.exec(text);
    if (!match) break;
    const inner = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    const innerCore = inner.replace(/^\s*\[([^\]]*)\]\s*$/, '$1');
    if (!STRENGTH_ONLY.test(inner) && !STRENGTH_ONLY.test(innerCore)) kept.push(match[0].trim());
    text = text.slice(match[0].length);
  }
  text = text.replace(/^\s*(?:[:：]|[–—-])\s*/, '').trim();
  return [...kept, text].filter(Boolean).join(' ');
}

/**
 * 逐行遍历并标注是否处于 fenced code block 内：代码块里的 `- FR-901 示例` 既不是条目也不是候选。
 * @param {string} content
 * @returns {Array<{ line: string, inFence: boolean }>}
 */
function classifyLines(content) {
  let inFence = false;
  return content.split('\n').map((line) => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return { line, inFence: true };
    }
    return { line, inFence };
  });
}

/**
 * 「长得像 FR 条目」的行所带的编号集合（每行只取行首那个）。与抽取结果做差集即「候选却未抽取」的编号——
 * 按编号而非按行数比较，追溯表 / 状态表里重复引用已抽取编号的行不再造成误报（2026-09-14 实测 7 份 spec 全是这类噪声）。
 * @param {string} content
 * @returns {Set<string>}
 */
export function collectFRCandidateIds(content) {
  const ids = new Set();
  for (const { line, inFence } of classifyLines(content)) {
    if (inFence) continue;
    const match = FR_CANDIDATE_LINE.exec(line);
    if (match) ids.add(match[1]);
  }
  return ids;
}

/**
 * 非需求节里「按条目写法」出现的 FR 编号（列表位 / 行首粗体段落 / 标题位，排除区间标签与 fenced code），
 * 逐行保留重复（同一编号被「修正」两次也要各算一条）。表格行 / 引用块 / 反引号包裹不算——那些在非需求节里是引用。
 * @param {string} content
 * @returns {string[]}
 */
export function collectFREntryIds(content) {
  const ids = [];
  for (const { line, inFence } of classifyLines(content)) {
    if (inFence) continue;
    const match = FR_ENTRY_HEAD.exec(line);
    if (match && !FR_RANGE_TAIL.test(line.slice(match[0].length))) ids.push(match[1]);
  }
  return ids;
}

/**
 * @param {string} sectionContent
 * @returns {Array<{ id: string, description: string, level: string|null }>}
 */
function extractFunctionalRequirements(sectionContent) {
  const requirements = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const description = current.body.join('\n').trim();
    const levelSource = `${current.annot} ${description}`;
    const levelMatch = /\b(MUST|SHOULD|MAY)\b/i.exec(levelSource);
    requirements.push({ id: current.id, description, level: levelMatch ? levelMatch[1].toUpperCase() : null });
    current = null;
  };
  for (const { line, inFence } of classifyLines(sectionContent)) {
    if (inFence) {
      if (current) current.body.push(line);
      continue;
    }
    const m = FR_ENTRY_HEAD.exec(line);
    if (m && !FR_RANGE_TAIL.test(line.slice(m[0].length))) {
      flush();
      const rest = line.slice(m[0].length);
      current = { id: m[1], annot: rest, body: [cleanEntryFirstLine(rest)] };
      continue;
    }
    // 不以 FR 编号开头的子标题（`### Functional Requirements` / `### Key Entities` / `### 澄清 2: FR-006 …`）
    // 只结束当前条目，不结束抽取——Requirements 节内常有多个子标题，条目分布在各子标题之下
    if (HEADING_LINE.test(line)) { flush(); continue; }
    if (current) current.body.push(line);
  }
  flush();
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
  // 同一编号多个含 spec.md 的目录：parsedSpecs 按编号索引会后者覆盖前者（094-0x 坍缩的同型残留，角 B 审查 W-B8）
  const dirsByScannedId = new Map();
  for (const spec of scannedSpecs) dirsByScannedId.set(spec.id, [...(dirsByScannedId.get(spec.id) || []), spec.dirName]);
  for (const [id, dirs] of dirsByScannedId) {
    if (dirs.length > 1) warnings.push(`编号 ${id} 有 ${dirs.length} 个含 spec.md 的目录（${dirs.join(', ')}），按编号索引时后者覆盖前者，请改名或合并`);
  }
  // 全部 NNN-* 目录（含只有 blueprint.md 的）按编号索引，供「映射悬空」判定区分「无目录」与「有目录无 spec.md」
  const specDirsById = new Map();
  for (const dirName of listSpecDirNames(specsDir)) {
    const id = extractSpecId(dirName);
    if (id && /^-\S/.test(dirName.slice(id.length))) specDirsById.set(id, dirName);
  }
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
      const parsed = parseSpecContent(entry.filePath);
      parsedSpecs[entry.id] = parsed;
      const extractedIds = new Set((parsed.requirements || []).map((fr) => fr.id));
      const missing = [...(parsed.frCandidateIds || [])].filter((id) => !extractedIds.has(id));
      if (missing.length > 0) {
        warnings.push(`[${productId}] spec ${entry.id}: Requirements 节有 ${missing.length} 个 FR 编号出现在候选行但未抽取（${missing.join(', ')}），请核对写法`);
      }
      const repeats = parsed.duplicateFRIds || [];
      if (repeats.length > 0) {
        const counts = new Map();
        for (const id of repeats) counts.set(id, (counts.get(id) || 1) + 1);
        const detail = [...counts].map(([id, n]) => `${id} ×${n}`).join(', ');
        warnings.push(`[${productId}] spec ${entry.id}: ${counts.size} 个 FR 编号重复出现，已按出现顺序并入首条描述（${detail}），请核对是否为同一条需求`);
      }
      const outside = parsed.frEntriesOutside || [];
      if (outside.length > 0) {
        const byHeading = new Map();
        for (const { id, heading } of outside) byHeading.set(heading, [...(byHeading.get(heading) || []), id]);
        const detail = [...byHeading].map(([heading, ids]) => `「${heading}」: ${ids.join(', ')}`).join('；');
        const prefix = parsed.requirementsHeadingCount === 0 ? '未找到需求类 H2；' : '';
        warnings.push(`[${productId}] spec ${entry.id}: ${prefix}需求类 H2 之外有 ${outside.length} 条 FR 条目写法未纳入抽取（${detail}），请移入需求节或核对`);
      } else if (extractedIds.size === 0) {
        warnings.push(`[${productId}] spec ${entry.id}: 未抽出任何 FR（需求可能写成散文、表格或位于非需求标题下）`);
      }
    }

    // mapping 列了、磁盘上却没有对应 spec.md 的编号：单向差集之外的另一半（角 A 审查 W-6）。
    // 只有 blueprint.md 的目录（024 / 054 / 062 / 067 / 070 / 076）是有意登记进活文档变更历史的，不算悬空。
    const scannedIds = new Set(scannedSpecs.map((spec) => spec.id));
    for (const mappedId of productDef.specs) {
      if (scannedIds.has(mappedId)) continue;
      const dirName = specDirsById.get(mappedId);
      if (!dirName) {
        warnings.push(`[${productId}] 映射条目 ${mappedId} 在 specs/ 下没有对应目录`);
      } else if (!fs.existsSync(path.join(specsDir, dirName, 'blueprint.md'))) {
        warnings.push(`[${productId}] 映射条目 ${mappedId} 的目录 ${dirName} 既无 spec.md 也无 blueprint.md`);
      }
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
    const validation = validateMergeResult(resolvedSkeleton, timeline, parsedSpecs);
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
    // 只在映射**语义**变化时写回，且保留原文件的注释头——序列化不保留注释，
    // 早期实现按「序列化文本是否相同」判断，首次运行就把「可手动编辑 / 未纳入正式映射」等十行注释剥光（2026-09-14）。
    const newMappingYaml = serializeProductMapping(correctedMapping);
    let oldText = '';
    if (fs.existsSync(mappingPath)) {
      try {
        oldText = fs.readFileSync(mappingPath, 'utf-8');
      } catch {
        // 忽略读取失败
      }
    }
    const semanticOld = JSON.stringify((rawMapping && rawMapping.products) || {});
    const semanticNew = JSON.stringify(correctedMapping.products || {});
    // 注释头 = 可选 BOM + 注释行 / YAML 文档分隔符 `---` / 空行的前导序列；正文行尾跟随原文件（CRLF 文件不写成混合行尾）
    const leadingComments = (oldText.match(/^\uFEFF?(?:#[^\n]*\n|---[ \t]*\r?\n|\r?\n)*/) || [''])[0];

    if (semanticNew !== semanticOld) {
      try {
        fs.mkdirSync(path.dirname(mappingPath), { recursive: true });
        const eol = /\r\n/.test(oldText) ? '\r\n' : '\n';
        const body = (newMappingYaml.endsWith('\n') ? newMappingYaml : `${newMappingYaml}\n`).replace(/\r?\n/g, eol);
        fs.writeFileSync(mappingPath, `${leadingComments}${body}`, 'utf-8');
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

if (isInvokedDirectly(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = syncMergeEngine(args);
  printResult(result, args);
}
