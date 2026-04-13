/**
 * Product / UX fact ingestion
 *
 * Feature 060: 将 current-spec、README/设计说明与近期提交
 * 汇总为产品概览、用户旅程与 feature brief 文档。
 *
 * 设计原则：
 * 1. current-spec 是首选事实源；README / 设计文档为补充源
 * 2. 文档生成完全基于仓库内容，不依赖外部 API 或 CLI
 * 3. narrative 与 journey/brief synthesis 必须保留 evidence / confidence / inferred
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from '../interfaces.js';
import type { BatchGeneratedDocSummary } from './architecture-narrative.js';
import { loadTemplate } from '../utils/template-loader.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('product-ux-docs');

export type ProductFactSourceType =
  | 'current-spec'
  | 'readme'
  | 'design-doc'
  | 'commit'
  | 'inference';

export interface ProductEvidenceRef {
  sourceType: ProductFactSourceType;
  label: string;
  path?: string;
  ref?: string;
  excerpt: string;
  confidence: 'high' | 'medium' | 'low';
  inferred: boolean;
}

export interface ProductUserSegment {
  name: string;
  description: string;
  primaryScenarios: string[];
  evidence: ProductEvidenceRef[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ProductScenario {
  id: string;
  title: string;
  summary: string;
  actors: string[];
  evidence: ProductEvidenceRef[];
  confidence: 'high' | 'medium' | 'low';
  inferred: boolean;
}

export interface ProductOverviewOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  summary: string[];
  targetUsers: ProductUserSegment[];
  coreScenarios: ProductScenario[];
  keyTaskFlows: string[];
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
  inferred: boolean;
  evidence: ProductEvidenceRef[];
}

export interface UserJourneyStep {
  title: string;
  detail: string;
  inferred: boolean;
}

export interface UserJourney {
  id: string;
  title: string;
  actor: string;
  goal: string;
  outcome: string;
  steps: UserJourneyStep[];
  evidence: ProductEvidenceRef[];
  confidence: 'high' | 'medium' | 'low';
  inferred: boolean;
}

export interface UserJourneysOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  summary: string[];
  journeys: UserJourney[];
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface FeatureBrief {
  id: string;
  slug: string;
  fileName: string;
  title: string;
  summary: string;
  problem: string;
  proposedSolution: string;
  audience: string;
  status: 'candidate' | 'shipped';
  evidence: ProductEvidenceRef[];
  confidence: 'high' | 'medium' | 'low';
  inferred: boolean;
}

export interface FeatureBriefIndexOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  summary: string[];
  briefs: FeatureBrief[];
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface GenerateProductUxDocsOptions {
  projectRoot: string;
  outputDir: string;
  projectContext: ProjectContext;
  generatedDocs: BatchGeneratedDocSummary[];
}

export interface GenerateProductUxDocsResult {
  overview: ProductOverviewOutput;
  journeys: UserJourneysOutput;
  featureBriefIndex: FeatureBriefIndexOutput;
  warnings: string[];
  writtenFiles: string[];
}

interface MarkdownSource {
  sourceType: ProductFactSourceType;
  label: string;
  path: string;
  text: string;
}

interface CurrentSpecDoc extends MarkdownSource {
  productId: string;
  sections: Map<string, string>;
}

interface CommitFact {
  sha: string;
  subject: string;
  body: string;
}

interface ProductFactCorpus {
  projectName: string;
  currentSpecs: CurrentSpecDoc[];
  readmes: MarkdownSource[];
  designDocs: MarkdownSource[];
  commits: CommitFact[];
  warnings: string[];
}

interface ParsedTableRow {
  [key: string]: string;
}

export function generateProductUxDocs(
  options: GenerateProductUxDocsOptions,
): GenerateProductUxDocsResult {
  const corpus = buildProductFactCorpus(options.projectRoot);
  const overview = buildProductOverview(corpus);
  const journeys = buildUserJourneys(corpus, overview);
  const featureBriefIndex = buildFeatureBriefIndex(corpus, overview, journeys);

  const writtenFiles: string[] = [];

  writtenFiles.push(...writeOverview(options.outputDir, overview));
  writtenFiles.push(...writeJourneys(options.outputDir, journeys));
  writtenFiles.push(...writeFeatureBriefs(options.outputDir, featureBriefIndex));

  return {
    overview,
    journeys,
    featureBriefIndex,
    warnings: uniqueSorted([
      ...corpus.warnings,
      ...overview.warnings,
      ...journeys.warnings,
      ...featureBriefIndex.warnings,
    ]),
    writtenFiles,
  };
}

function writeOverview(outputDir: string, overview: ProductOverviewOutput): string[] {
  const mdPath = path.join(outputDir, 'product-overview.md');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(mdPath, renderProductOverview(overview), 'utf-8');
  return [mdPath];
}

function writeJourneys(outputDir: string, journeys: UserJourneysOutput): string[] {
  const mdPath = path.join(outputDir, 'user-journeys.md');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(mdPath, renderUserJourneys(journeys), 'utf-8');
  return [mdPath];
}

function writeFeatureBriefs(outputDir: string, index: FeatureBriefIndexOutput): string[] {
  const briefsDir = path.join(outputDir, 'feature-briefs');
  const writtenFiles: string[] = [];
  fs.mkdirSync(briefsDir, { recursive: true });

  const indexMd = path.join(briefsDir, 'index.md');
  fs.writeFileSync(indexMd, renderFeatureBriefIndex(index), 'utf-8');
  writtenFiles.push(indexMd);

  for (const brief of index.briefs) {
    const mdPath = path.join(briefsDir, `${brief.fileName}.md`);
    fs.writeFileSync(mdPath, renderFeatureBrief(brief), 'utf-8');
    writtenFiles.push(mdPath);
  }

  return writtenFiles;
}

function renderProductOverview(output: ProductOverviewOutput): string {
  return loadTemplate('product-overview.hbs', import.meta.url)(output);
}

function renderUserJourneys(output: UserJourneysOutput): string {
  return loadTemplate('user-journeys.hbs', import.meta.url)(output);
}

function renderFeatureBriefIndex(output: FeatureBriefIndexOutput): string {
  return loadTemplate('feature-brief-index.hbs', import.meta.url)(output);
}

function renderFeatureBrief(output: FeatureBrief): string {
  return loadTemplate('feature-brief.hbs', import.meta.url)(output);
}

function buildProductFactCorpus(projectRoot: string): ProductFactCorpus {
  const currentSpecs = collectCurrentSpecs(projectRoot);
  const readmes = collectReadmes(projectRoot);
  const designDocs = collectLocalDesignDocs(projectRoot);
  const commits = collectRecentCommits(projectRoot, 10);
  const warnings = uniqueSorted([
    ...(currentSpecs.length === 0
      ? ['未找到 current-spec.md，将更多依赖 README 与设计文档进行产品事实推断。']
      : []),
    ...(readmes.length === 0
      ? ['未找到项目级 README.md，产品定位摘要将缺少一份高价值补充源。']
      : []),
    ...(designDocs.length === 0
      ? ['未找到本地设计说明/roadmap Markdown，UX 旅程与 feature brief 将更多依赖 current-spec 与 README。']
      : []),
  ]);

  return {
    projectName: resolveProjectName(projectRoot, currentSpecs, readmes),
    currentSpecs,
    readmes,
    designDocs,
    commits,
    warnings,
  };
}

function buildProductOverview(corpus: ProductFactCorpus): ProductOverviewOutput {
  const summary = collectOverviewParagraphs(corpus).slice(0, 4);
  const targetUsers = buildTargetUsers(corpus);
  const coreScenarios = buildCoreScenarios(corpus, targetUsers);
  const evidence = uniqueEvidence([
    ...collectEvidenceFromSources(corpus.currentSpecs, 'high'),
    ...collectEvidenceFromSources(corpus.readmes, 'medium'),
    ...collectEvidenceFromSources(corpus.designDocs, 'medium'),
  ]);

  const warnings = uniqueSorted([
    ...corpus.warnings,
    ...(summary.length === 0
      ? ['未提取到稳定的产品概述段落，product-overview 将更多依赖推断和标题级摘要。']
      : []),
    ...(targetUsers.length === 0
      ? ['未识别到显式用户画像表或用户段落，将使用 README / issue 文本推断目标用户。']
      : []),
    ...(coreScenarios.length === 0
      ? ['未识别到显式核心场景列表，将使用 feature briefs 和 README 文本推断核心任务流。']
      : []),
  ]);

  const inferred = corpus.currentSpecs.length === 0;
  return {
    title: `产品概览: ${corpus.projectName}`,
    generatedAt: new Date().toISOString(),
    projectName: corpus.projectName,
    summary: summary.length > 0
      ? summary
      : ['仅基于代码与现有规格推断；尚未找到足够稳定的产品事实源。'],
    targetUsers,
    coreScenarios,
    keyTaskFlows: coreScenarios.slice(0, 5).map((scenario) => scenario.title),
    warnings,
    confidence: currentSpecConfidence(corpus.currentSpecs.length > 0, evidence.length),
    inferred,
    evidence,
  };
}

function buildUserJourneys(
  corpus: ProductFactCorpus,
  overview: ProductOverviewOutput,
): UserJourneysOutput {
  const journeys = overview.coreScenarios.slice(0, 5).map((scenario, index) => {
    const actor = scenario.actors[0] ?? overview.targetUsers[0]?.name ?? '使用者';
    const detail = scenario.summary || scenario.title;

    return {
      id: `journey-${String(index + 1).padStart(2, '0')}`,
      title: scenario.title,
      actor,
      goal: detail,
      outcome: `完成 ${scenario.title} 对应的关键任务，并获得结构化文档或可执行下一步。`,
      steps: [
        {
          title: '触发场景',
          detail: `${actor} 识别当前任务需要：${scenario.title}`,
          inferred: true,
        },
        {
          title: '执行关键动作',
          detail,
          inferred: false,
        },
        {
          title: '消费输出',
          detail: '使用生成的文档、接口说明或评审材料完成后续沟通、实现或交接。',
          inferred: true,
        },
      ],
      evidence: scenario.evidence,
      confidence: scenario.confidence,
      inferred: true,
    } satisfies UserJourney;
  });

  const warnings = uniqueSorted([
    ...corpus.warnings,
    ...(journeys.length === 0
      ? ['未识别到可稳定组织成用户旅程的场景，user-journeys 将为空。']
      : []),
  ]);

  return {
    title: `用户旅程: ${corpus.projectName}`,
    generatedAt: new Date().toISOString(),
    projectName: corpus.projectName,
    summary: journeys.length > 0
      ? [`基于 ${journeys.length} 条核心场景组织用户旅程，优先引用 current-spec、README 与本地设计文档事实。`]
      : ['仅基于代码与现有规格推断；尚未识别到稳定的用户旅程输入。'],
    journeys,
    warnings,
    confidence: currentSpecConfidence(corpus.currentSpecs.length > 0, journeys.length),
  };
}

function buildFeatureBriefIndex(
  corpus: ProductFactCorpus,
  overview: ProductOverviewOutput,
  journeys: UserJourneysOutput,
): FeatureBriefIndexOutput {
  const briefs: FeatureBrief[] = [];

  for (const scenario of journeys.journeys.slice(0, 3)) {
    const id = `BRIEF-${String(briefs.length + 1).padStart(2, '0')}`;
    briefs.push({
      id,
      slug: slugify(scenario.title),
      fileName: briefFileName(id, scenario.title),
      title: scenario.title,
      summary: scenario.goal,
      problem: `${scenario.actor} 需要更直接地完成”${scenario.title}”相关任务，当前缺少独立的功能说明文档。`,
      proposedSolution: `围绕 ${scenario.title} 组织一份产品 brief，把用户目标、路径和预期输出显式化。`,
      audience: scenario.actor,
      status: 'candidate',
      evidence: scenario.evidence,
      confidence: 'medium',
      inferred: true,
    });
  }

  return {
    title: `Feature Briefs: ${corpus.projectName}`,
    generatedAt: new Date().toISOString(),
    projectName: corpus.projectName,
    summary: [
      `共组织 ${briefs.length} 份 feature brief，基于 current-spec 与用户旅程派生。`,
    ],
    briefs: briefs.slice(0, 5),
    warnings: [...corpus.warnings],
    confidence: currentSpecConfidence(corpus.currentSpecs.length > 0, briefs.length),
  };
}

function collectCurrentSpecs(projectRoot: string): CurrentSpecDoc[] {
  const currentSpecs: CurrentSpecDoc[] = [];
  const productsDir = path.join(projectRoot, 'specs', 'products');
  if (!fs.existsSync(productsDir)) {
    return currentSpecs;
  }

  for (const entry of fs.readdirSync(productsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(productsDir, entry.name, 'current-spec.md');
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    currentSpecs.push({
      sourceType: 'current-spec',
      label: `${entry.name}/current-spec.md`,
      path: normalizeProjectPath(filePath, projectRoot),
      text,
      productId: entry.name,
      sections: parseMarkdownSections(text),
    });
  }

  return currentSpecs.sort((left, right) => left.productId.localeCompare(right.productId));
}

function collectReadmes(projectRoot: string): MarkdownSource[] {
  const readmes: MarkdownSource[] = [];
  for (const candidate of ['README.md', 'readme.md']) {
    const filePath = path.join(projectRoot, candidate);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    readmes.push({
      sourceType: 'readme',
      label: candidate,
      path: normalizeProjectPath(filePath, projectRoot),
      text: fs.readFileSync(filePath, 'utf-8'),
    });
  }
  return readmes;
}

function collectLocalDesignDocs(projectRoot: string): MarkdownSource[] {
  const matches: MarkdownSource[] = [];
  walkMarkdownDocs(projectRoot, projectRoot, matches);
  return matches.sort((left, right) => left.path.localeCompare(right.path));
}

function walkMarkdownDocs(root: string, dir: string, results: MarkdownSource[]): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relative = normalizeProjectPath(fullPath, root);

    if (entry.isDirectory()) {
      if (
        ['node_modules', '.git', 'specs', 'dist', 'coverage', 'bundles'].includes(entry.name)
        || entry.name.startsWith('.spectra')
      ) {
        continue;
      }
      walkMarkdownDocs(root, fullPath, results);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
      continue;
    }

    const lower = relative.toLowerCase();
    const isRootReadme = lower === 'readme.md';
    const isGeneratedOutput = /(^|\/)\.spectra[^/]*\//i.test(lower)
      || /(^|\/)docs\/adr\//i.test(lower)
      || /(^|\/)feature-briefs\//i.test(lower);
    const isDesignLike = /(design|product|roadmap|journey|ux|persona|brief)/i.test(entry.name)
      || /(^|\/)(design|product|roadmap|journey|ux|persona|brief)s?\//i.test(lower);
    if (!isDesignLike || isRootReadme || isGeneratedOutput) {
      continue;
    }

    results.push({
      sourceType: 'design-doc',
      label: path.basename(fullPath),
      path: relative,
      text: fs.readFileSync(fullPath, 'utf-8'),
    });
  }
}

function collectRecentCommits(projectRoot: string, limit: number): CommitFact[] {
  const result = spawnSync(
    'git',
    ['log', `-${limit}`, '--pretty=format:%H%n%s%n%b%n---END-COMMIT---'],
    {
      cwd: projectRoot,
      encoding: 'utf-8',
    },
  );

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split('\n---END-COMMIT---\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const [sha = '', subject = '', ...bodyLines] = chunk.split('\n');
      return {
        sha: sha.trim(),
        subject: subject.trim(),
        body: bodyLines.join('\n').trim(),
      };
    })
    .filter((entry) => entry.sha.length > 0 && entry.subject.length > 0);
}

function collectOverviewParagraphs(corpus: ProductFactCorpus): string[] {
  const paragraphs: string[] = [];

  for (const spec of corpus.currentSpecs) {
    for (const key of ['产品概述', '概览']) {
      const section = spec.sections.get(key);
      if (!section) {
        continue;
      }
      paragraphs.push(...extractParagraphs(section));
    }
  }

  for (const source of [...corpus.readmes, ...corpus.designDocs]) {
    paragraphs.push(...extractParagraphs(source.text).slice(0, 2));
  }

  return uniqueSorted(paragraphs.filter((paragraph) => paragraph.length >= 20)).slice(0, 6);
}

function buildTargetUsers(corpus: ProductFactCorpus): ProductUserSegment[] {
  const segments: ProductUserSegment[] = [];

  for (const spec of corpus.currentSpecs) {
    const userSection = spec.sections.get('用户画像与场景');
    if (!userSection) {
      continue;
    }

    const rows = parseFirstMarkdownTable(userSection);
    for (const row of rows) {
      const name = row['角色'] || row['用户'] || row['名称'] || row['persona'] || '';
      const description = row['描述'] || row['说明'] || row['description'] || '';
      const scenarios = splitScenarioText(
        row['主要使用场景'] || row['场景'] || row['scenario'] || '',
      );
      if (!name.trim()) {
        continue;
      }
      segments.push({
        name: name.trim(),
        description: description.trim() || `${name.trim()} 是该产品的关键使用者。`,
        primaryScenarios: scenarios,
        evidence: [{
          sourceType: 'current-spec',
          label: spec.label,
          path: spec.path,
          excerpt: `${name} | ${description} | ${scenarios.join(' / ')}`,
          confidence: 'high',
          inferred: false,
        }],
        confidence: 'high',
      });
    }
  }

  if (segments.length > 0) {
    return dedupeSegments(segments);
  }

  const readmeParagraph = corpus.readmes
    .flatMap((source) => extractParagraphs(source.text))
    .find((para) => isDescriptiveParagraph(para));
  if (!readmeParagraph) {
    return [];
  }

  return [{
    name: '开发者',
    description: firstSentence(readmeParagraph) ?? readmeParagraph,
    primaryScenarios: ['阅读文档、生成规格、理解系统行为'],
    evidence: [{
      sourceType: 'readme',
      label: corpus.readmes[0]!.label,
      path: corpus.readmes[0]!.path,
      excerpt: readmeParagraph,
      confidence: 'medium',
      inferred: true,
    }],
    confidence: 'medium',
  }];
}

/**
 * 判断一段文字是否是有意义的描述性段落（非标题、非导航链接）。
 */
function isDescriptiveParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;
  if (trimmed.startsWith('#')) return false;
  const linkCount = (trimmed.match(/\[.*?\]\(.*?\)/g) ?? []).length;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 0 && linkCount / wordCount > 0.5) return false;
  if (trimmed.startsWith('<') || trimmed.startsWith('![')) return false;
  return true;
}

function buildCoreScenarios(
  corpus: ProductFactCorpus,
  targetUsers: ProductUserSegment[],
): ProductScenario[] {
  const scenarios: ProductScenario[] = [];

  for (const spec of corpus.currentSpecs) {
    const userSection = spec.sections.get('用户画像与场景');
    if (!userSection) {
      continue;
    }

    const items = extractListItems(userSection);
    for (const item of items) {
      const [titlePart, ...restParts] = item.split(/[:：]/);
      const title = titlePart?.trim() || item;
      const summary = restParts.join('：').trim() || item;
      const actors = inferActors(title + summary, targetUsers);
      scenarios.push({
        id: `scenario-${scenarios.length + 1}`,
        title,
        summary,
        actors,
        evidence: [{
          sourceType: 'current-spec',
          label: spec.label,
          path: spec.path,
          excerpt: item,
          confidence: 'high',
          inferred: false,
        }],
        confidence: 'high',
        inferred: false,
      });
    }
  }

  // README Usage/Features 节 fallback
  if (scenarios.length === 0) {
    scenarios.push(...extractScenariosFromReadme(corpus, targetUsers));
  }

  // Phase 3：从 README Features/How it works 等标题下提取叙述段落场景
  if (scenarios.length === 0) {
    for (const readme of corpus.readmes) {
      scenarios.push(...extractScenariosFromReadme(readme, targetUsers));
      if (scenarios.length >= 3) break;
    }
  }

  return dedupeScenarios(scenarios).slice(0, 6);
}

/**
 * 从 README 提取场景：
 * 1. corpus 模式优先读取 Features / Usage 等章节列表项
 * 2. 单文档模式回退到叙述型标题段落与段落文本
 */
function extractScenariosFromReadme(
  source: ProductFactCorpus | MarkdownSource,
  targetUsers: ProductUserSegment[],
): ProductScenario[] {
  if ('currentSpecs' in source) {
    return extractScenariosFromReadmeCorpus(source, targetUsers);
  }

  return extractScenariosFromReadmeDocument(source, targetUsers);
}

function extractScenariosFromReadmeCorpus(
  corpus: ProductFactCorpus,
  targetUsers: ProductUserSegment[],
): ProductScenario[] {
  const scenarios: ProductScenario[] = [];
  const sectionKeySet = new Set([
    'usage', 'features', 'getting started', 'quick start', 'overview',
    '使用', '使用方法', '功能', '快速开始', '特性',
  ]);

  for (const readme of corpus.readmes) {
    const sections = parseMarkdownSections(readme.text);
    for (const [rawKey, section] of sections) {
      if (!sectionKeySet.has(rawKey.toLowerCase())) continue;

      const items = extractListItems(section);
      for (const item of items.slice(0, 4)) {
        if (item.length < 10) continue;

        const [titlePart, ...restParts] = item.split(/[:：]/);
        const title = titlePart?.trim() || item;
        const summary = restParts.join('：').trim() || item;
        scenarios.push({
          id: `scenario-${scenarios.length + 1}`,
          title: title.slice(0, 80),
          summary: summary.slice(0, 200) || title.slice(0, 200),
          actors: [inferAudience(title, targetUsers) ?? targetUsers[0]?.name ?? '开发者'],
          evidence: [{
            sourceType: 'readme',
            label: readme.label,
            path: readme.path,
            excerpt: item,
            confidence: 'medium',
            inferred: true,
          }],
          confidence: 'medium',
          inferred: true,
        });
        if (scenarios.length >= 4) return scenarios;
      }
      if (scenarios.length >= 4) return scenarios;
    }
    if (scenarios.length >= 4) return scenarios;
  }

  return scenarios;
}

function extractScenariosFromReadmeDocument(
  readme: MarkdownSource,
  targetUsers: ProductUserSegment[],
): ProductScenario[] {
  const FEATURE_HEADING = /^(Features?|How\s+it\s+works?|What\s+(?:it\s+)?does|Capabilities|Use\s+cases?|Getting\s+started|Overview|About)\s*$/i;

  const scenarios: ProductScenario[] = [];
  const lines = readme.text.split('\n');
  let inSection = false;
  let sectionLines: string[] = [];
  const sections: string[] = [];

  for (const line of lines) {
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (inSection && sectionLines.length > 0) {
        sections.push(sectionLines.join('\n'));
      }
      inSection = FEATURE_HEADING.test(headingMatch[1]?.trim() ?? '');
      sectionLines = [];
    } else if (inSection) {
      sectionLines.push(line);
    }
  }
  if (inSection && sectionLines.length > 0) {
    sections.push(sectionLines.join('\n'));
  }

  for (const section of sections) {
    const items = extractListItems(section);
    if (items.length > 0) {
      for (const item of items.slice(0, 4)) {
        const colonIdx = item.search(/[:：]/);
        const title = colonIdx > 0 ? item.slice(0, colonIdx).trim() : item;
        const summary = colonIdx > 0 ? item.slice(colonIdx + 1).trim() : item;
        scenarios.push({
          id: `scenario-${scenarios.length + 1}`,
          title,
          summary: summary || title,
          actors: inferActors(title + summary, targetUsers),
          evidence: [{
            sourceType: 'readme',
            label: readme.label,
            path: readme.path,
            excerpt: item,
            confidence: 'medium',
            inferred: true,
          }],
          confidence: 'medium',
          inferred: true,
        });
      }
    } else {
      // 无列表时从段落提取
      for (const para of extractParagraphs(section).slice(0, 2)) {
        const title = firstSentence(para) ?? para.slice(0, 60);
        scenarios.push({
          id: `scenario-${scenarios.length + 1}`,
          title,
          summary: para,
          actors: inferActors(para, targetUsers),
          evidence: [{
            sourceType: 'readme',
            label: readme.label,
            path: readme.path,
            excerpt: para,
            confidence: 'low',
            inferred: true,
          }],
          confidence: 'low',
          inferred: true,
        });
      }
    }
    if (scenarios.length >= 3) break;
  }

  return scenarios;
}

function parseMarkdownSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    if (!current?.index) {
      continue;
    }

    const rawHeading = current[1]?.trim() ?? '';
    const start = current.index + current[0].length;
    const end = next?.index ?? markdown.length;
    const content = markdown.slice(start, end).trim();
    const normalized = normalizeHeading(rawHeading);
    if (normalized) {
      sections.set(normalized, content);
    }
  }

  return sections;
}

function normalizeHeading(heading: string): string {
  return heading
    .replace(/^[0-9]+\.\s*/, '')
    .replace(/^[一二三四五六七八九十]+\.\s*/, '')
    .replace(/[：:]\s*$/, '')
    .trim();
}

function parseFirstMarkdownTable(content: string): ParsedTableRow[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));

  if (lines.length < 3) {
    return [];
  }

  const header = splitMarkdownTableLine(lines[0]!);
  const divider = lines[1]!;
  if (!divider.includes('---')) {
    return [];
  }

  return lines.slice(2).map((line) => {
    const values = splitMarkdownTableLine(line);
    const row: ParsedTableRow = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index] ?? `col-${index}`] = values[index] ?? '';
    }
    return row;
  });
}

function splitMarkdownTableLine(line: string): string[] {
  return line
    .split('|')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function extractListItems(content: string): string[] {
  return [...content.matchAll(/^(?:[-*]|\d+\.)\s+(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((item) => item.length > 0);
}

function extractParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/\n+/g, ' ').trim())
    .filter((paragraph) =>
      paragraph.length >= 20
      && !paragraph.startsWith('|')
      && !paragraph.startsWith('##')
      && !paragraph.startsWith('```')
      && !isBadgeLine(paragraph)
      && !isPureLinkLine(paragraph),
    );
}

/** 是否为纯徽章行（仅含 ![...](url) 或 [![...](url)](url2) 无其他文字） */
function isBadgeLine(text: string): boolean {
  // 先移除图片 ![...](...) 再移除剩余链接壳 [...](...) ，判断是否为空
  const withoutImages = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  const withoutAll = withoutImages.replace(/\[[^\]]*\]\([^)]+\)/g, '').trim();
  return withoutAll.length === 0 && text.includes('![');
}

/** 是否为纯链接行（仅含 [...](url) 无其他文字） */
function isPureLinkLine(text: string): boolean {
  const withoutLinks = text.replace(/\[[^\]]*\]\([^)]+\)/g, '').trim();
  return withoutLinks.length === 0 && text.includes('](');
}

function splitScenarioText(value: string): string[] {
  return value
    .split(/[、,，/]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function inferActors(text: string, users: ProductUserSegment[]): string[] {
  const matched = users
    .filter((user) => text.includes(user.name) || user.primaryScenarios.some((scenario) => text.includes(scenario)))
    .map((user) => user.name);
  if (matched.length > 0) {
    return uniqueSorted(matched);
  }
  return users[0] ? [users[0].name] : [];
}

function inferAudience(title: string, users: ProductUserSegment[]): string | undefined {
  return inferActors(title, users)[0];
}

function dedupeSegments(segments: ProductUserSegment[]): ProductUserSegment[] {
  const byName = new Map<string, ProductUserSegment>();
  for (const segment of segments) {
    const existing = byName.get(segment.name);
    if (!existing) {
      byName.set(segment.name, segment);
      continue;
    }
    existing.description = existing.description.length >= segment.description.length
      ? existing.description
      : segment.description;
    existing.primaryScenarios = uniqueSorted([...existing.primaryScenarios, ...segment.primaryScenarios]);
    existing.evidence = uniqueEvidence([...existing.evidence, ...segment.evidence]);
  }
  return [...byName.values()];
}

function dedupeScenarios(scenarios: ProductScenario[]): ProductScenario[] {
  const byTitle = new Map<string, ProductScenario>();
  for (const scenario of scenarios) {
    const key = scenario.title.toLowerCase();
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, scenario);
      continue;
    }
    existing.summary = existing.summary.length >= scenario.summary.length ? existing.summary : scenario.summary;
    existing.actors = uniqueSorted([...existing.actors, ...scenario.actors]);
    existing.evidence = uniqueEvidence([...existing.evidence, ...scenario.evidence]);
  }
  return [...byTitle.values()];
}

function collectEvidenceFromSources(
  sources: MarkdownSource[],
  confidence: ProductEvidenceRef['confidence'],
): ProductEvidenceRef[] {
  return sources.slice(0, 3).map((source) => ({
    sourceType: source.sourceType,
    label: source.label,
    path: source.path,
    excerpt: extractParagraphs(source.text)[0] ?? source.text.slice(0, 160).trim(),
    confidence,
    inferred: false,
  }));
}

function currentSpecConfidence(hasCurrentSpec: boolean, signalCount: number): 'high' | 'medium' | 'low' {
  if (hasCurrentSpec && signalCount >= 2) {
    return 'high';
  }
  if (signalCount > 0) {
    return 'medium';
  }
  return 'low';
}

function resolveProjectName(
  projectRoot: string,
  currentSpecs: CurrentSpecDoc[],
  readmes: MarkdownSource[],
): string {
  const currentSpecTitle = currentSpecs[0]?.text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (currentSpecTitle) {
    return currentSpecTitle.replace(/^[^—-]+[—-]\s*/, '').replace(/^产品规范活文档[:：]?\s*/, '').trim();
  }

  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
      if (pkg.name?.trim()) {
        return pkg.name.trim();
      }
    } catch (err) {
      logger.debug(`package.json 读取失败，尝试从 README 获取项目名称: ${String(err)}`);
    }
  }

  const readmeTitle = readmes[0]?.text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (readmeTitle) {
    return readmeTitle;
  }

  return path.basename(projectRoot);
}

function firstMeaningfulSentence(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  const sentence = normalized.split(/(?<=[。.!?])\s+/)[0]?.trim();
  return sentence && sentence.length > 0 ? sentence : normalized;
}

function firstSentence(text: string): string | undefined {
  return firstMeaningfulSentence(text);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return slug || 'untitled';
}

function briefFileName(id: string, title: string): string {
  return `${id.toLowerCase()}-${slugify(title)}`;
}

function normalizeProjectPath(filePath: string, projectRoot: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseInt(`${value ?? ''}`, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right, 'zh-Hans-CN'),
  );
}

function uniqueEvidence(entries: ProductEvidenceRef[]): ProductEvidenceRef[] {
  const seen = new Set<string>();
  const deduped: ProductEvidenceRef[] = [];

  for (const entry of entries) {
    const key = [
      entry.sourceType,
      entry.label,
      entry.path ?? '',
      entry.ref ?? '',
      entry.excerpt,
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

// ============================================================
// DocumentGenerator Adapter
// ============================================================

/**
 * ProductUxDocsGenerator
 *
 * 将 generateProductUxDocs() 适配为 DocumentGenerator 接口。
 * generate() 包含 fs 文件写出副作用（写出产品概览、用户旅程、feature brief）。
 * render() 为纯摘要，不含 fs 调用。
 *
 * TInput: GenerateProductUxDocsOptions
 * TOutput: GenerateProductUxDocsResult
 */
export class ProductUxDocsGenerator
  implements DocumentGenerator<GenerateProductUxDocsOptions, GenerateProductUxDocsResult>
{
  readonly id = 'product-ux-docs' as const;
  readonly name = '产品 UX 文档生成器' as const;
  readonly description = '基于 current-spec、README 与本地设计文档生成产品概览、用户旅程与 feature brief 文档';

  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  isApplicable(context: ProjectContext): boolean {
    // 只要项目根目录存在即可适用
    return Boolean(context.projectRoot);
  }

  async extract(context: ProjectContext): Promise<GenerateProductUxDocsOptions> {
    return {
      projectRoot: context.projectRoot,
      outputDir: this.outputDir,
      projectContext: context,
      generatedDocs: [],
    };
  }

  async generate(
    input: GenerateProductUxDocsOptions,
    _options?: GenerateOptions,
  ): Promise<GenerateProductUxDocsResult> {
    // generate() 包含 fs 写出副作用
    return generateProductUxDocs(input);
  }

  render(output: GenerateProductUxDocsResult): string {
    // render() 为纯摘要，无 fs 调用
    const lines: string[] = [
      `# 产品文档生成摘要`,
      '',
      `**产品概览**: ${output.overview.title}`,
      `**用户旅程**: ${output.journeys.journeys.length} 条`,
      `**Feature Brief**: ${output.featureBriefIndex.briefs.length} 个`,
      '',
    ];

    if (output.writtenFiles.length > 0) {
      lines.push('**写出文件**:');
      for (const file of output.writtenFiles) {
        lines.push(`- ${file}`);
      }
    }

    if (output.warnings.length > 0) {
      lines.push('', '**警告**:');
      for (const warning of output.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    return lines.join('\n');
  }
}
