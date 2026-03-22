/**
 * Product / UX fact ingestion
 *
 * Feature 060: 将 current-spec、README/设计说明、GitHub issue/PR 与近期提交
 * 汇总为产品概览、用户旅程与 feature brief 文档。
 *
 * 设计原则：
 * 1. current-spec 是首选事实源；README / 设计文档 / GitHub issue/PR 为补充源
 * 2. 允许无 GitHub token / 无 gh CLI 的离线降级
 * 3. narrative 与 journey/brief synthesis 必须保留 evidence / confidence / inferred
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ProjectContext } from './interfaces.js';
import type { BatchGeneratedDocSummary } from './architecture-narrative.js';
import { loadTemplate } from './utils/template-loader.js';

export type ProductFactSourceType =
  | 'current-spec'
  | 'readme'
  | 'design-doc'
  | 'issue'
  | 'pull-request'
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

interface GitHubItem {
  sourceType: 'issue' | 'pull-request';
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url?: string;
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
  issues: GitHubItem[];
  pullRequests: GitHubItem[];
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
  const jsonPath = path.join(outputDir, 'product-overview.json');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(mdPath, renderProductOverview(overview), 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(overview, null, 2), 'utf-8');
  return [mdPath, jsonPath];
}

function writeJourneys(outputDir: string, journeys: UserJourneysOutput): string[] {
  const mdPath = path.join(outputDir, 'user-journeys.md');
  const jsonPath = path.join(outputDir, 'user-journeys.json');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(mdPath, renderUserJourneys(journeys), 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(journeys, null, 2), 'utf-8');
  return [mdPath, jsonPath];
}

function writeFeatureBriefs(outputDir: string, index: FeatureBriefIndexOutput): string[] {
  const briefsDir = path.join(outputDir, 'feature-briefs');
  const writtenFiles: string[] = [];
  fs.mkdirSync(briefsDir, { recursive: true });

  const indexMd = path.join(briefsDir, 'index.md');
  const indexJson = path.join(briefsDir, 'index.json');
  fs.writeFileSync(indexMd, renderFeatureBriefIndex(index), 'utf-8');
  fs.writeFileSync(indexJson, JSON.stringify(index, null, 2), 'utf-8');
  writtenFiles.push(indexMd, indexJson);

  for (const brief of index.briefs) {
    const mdPath = path.join(briefsDir, `${brief.fileName}.md`);
    const jsonPath = path.join(briefsDir, `${brief.fileName}.json`);
    fs.writeFileSync(mdPath, renderFeatureBrief(brief), 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(brief, null, 2), 'utf-8');
    writtenFiles.push(mdPath, jsonPath);
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
  const gitHubFacts = collectGitHubFacts(projectRoot);
  const commits = collectRecentCommits(projectRoot, 10);
  const warnings = uniqueSorted([
    ...gitHubFacts.warnings,
    ...(currentSpecs.length === 0
      ? ['未找到 current-spec.md，将更多依赖 README / 设计文档 / issue/PR 进行产品事实推断。']
      : []),
    ...(readmes.length === 0
      ? ['未找到项目级 README.md，产品定位摘要将缺少一份高价值补充源。']
      : []),
    ...(designDocs.length === 0
      ? ['未找到本地设计说明/roadmap Markdown，UX 旅程与 feature brief 将更多依赖 current-spec / issue/PR。']
      : []),
  ]);

  return {
    projectName: resolveProjectName(projectRoot, currentSpecs, readmes),
    currentSpecs,
    readmes,
    designDocs,
    issues: gitHubFacts.issues,
    pullRequests: gitHubFacts.pullRequests,
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
    ...corpus.issues.slice(0, 3).map((issue) => toGitHubEvidence(issue, issue.title, 'medium')),
    ...corpus.pullRequests.slice(0, 2).map((pr) => toGitHubEvidence(pr, pr.title, 'medium')),
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
      ? [`基于 ${journeys.length} 条核心场景组织用户旅程，优先引用 current-spec、README 与可用的 issue/PR 事实。`]
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
  const defaultAudience = overview.targetUsers[0]?.name ?? '开发者';

  for (const issue of corpus.issues.slice(0, 3)) {
    const id = `ISSUE-${issue.number}`;
    briefs.push({
      id,
      slug: slugify(issue.title),
      fileName: briefFileName(id, issue.title),
      title: issue.title,
      summary: firstMeaningfulSentence(issue.body) ?? issue.title,
      problem: firstMeaningfulSentence(issue.body) ?? `${issue.title} 对应的问题陈述未在 issue 正文中明确给出。`,
      proposedSolution: `围绕 issue #${issue.number} 组织功能说明，并将其纳入产品 / UX 文档事实层。`,
      audience: inferAudience(issue.title, overview.targetUsers) ?? defaultAudience,
      status: issue.state === 'closed' ? 'shipped' : 'candidate',
      evidence: [toGitHubEvidence(issue, issue.title, 'high')],
      confidence: 'high',
      inferred: false,
    });
  }

  for (const pr of corpus.pullRequests.slice(0, 2)) {
    const id = `PR-${pr.number}`;
    briefs.push({
      id,
      slug: slugify(pr.title),
      fileName: briefFileName(id, pr.title),
      title: pr.title,
      summary: firstMeaningfulSentence(pr.body) ?? pr.title,
      problem: firstMeaningfulSentence(pr.body) ?? `${pr.title} 对应的变更动机未在 PR 正文中明确给出。`,
      proposedSolution: `把 PR #${pr.number} 的实现意图沉淀为可读的 feature brief，并连接到产品概览与用户旅程。`,
      audience: inferAudience(pr.title, overview.targetUsers) ?? defaultAudience,
      status: pr.state === 'closed' ? 'shipped' : 'candidate',
      evidence: [toGitHubEvidence(pr, pr.title, 'high')],
      confidence: 'high',
      inferred: false,
    });
  }

  if (briefs.length === 0) {
    for (const scenario of journeys.journeys.slice(0, 3)) {
      const id = `BRIEF-${String(briefs.length + 1).padStart(2, '0')}`;
      briefs.push({
        id,
        slug: slugify(scenario.title),
        fileName: briefFileName(id, scenario.title),
        title: scenario.title,
        summary: scenario.goal,
        problem: `${scenario.actor} 需要更直接地完成“${scenario.title}”相关任务，但现有事实源未提供独立 issue/PR 说明。`,
        proposedSolution: `围绕 ${scenario.title} 组织一份产品 brief，把用户目标、路径和预期输出显式化。`,
        audience: scenario.actor,
        status: 'candidate',
        evidence: scenario.evidence,
        confidence: 'medium',
        inferred: true,
      });
    }
  }

  const warnings = uniqueSorted([
    ...corpus.warnings,
    ...(corpus.issues.length === 0 && corpus.pullRequests.length === 0
      ? ['未获取到 GitHub issue/PR 事实，feature briefs 已回退到 current-spec / journey 派生模式。']
      : []),
  ]);

  return {
    title: `Feature Briefs: ${corpus.projectName}`,
    generatedAt: new Date().toISOString(),
    projectName: corpus.projectName,
    summary: [
      `共组织 ${briefs.length} 份 feature brief，优先使用 issue/PR 事实，缺失时回退到 current-spec 与 journey synthesis。`,
    ],
    briefs: briefs.slice(0, 5),
    warnings,
    confidence: currentSpecConfidence(corpus.issues.length + corpus.pullRequests.length > 0, briefs.length),
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
        || entry.name.startsWith('.reverse-spec')
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
    const isGeneratedOutput = /(^|\/)\.reverse-spec[^/]*\//i.test(lower)
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

function collectGitHubFacts(projectRoot: string): {
  issues: GitHubItem[];
  pullRequests: GitHubItem[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const repo = resolveGitHubRepo(projectRoot);
  if (!repo) {
    return {
      issues: [],
      pullRequests: [],
      warnings: ['未解析到 GitHub 远端仓库，跳过 issue/PR 事实接入。'],
    };
  }

  const issues = runGhJson(projectRoot, [
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'all',
    '--limit',
    '12',
    '--json',
    'number,title,body,state,labels,url',
  ], 'issue', warnings);

  const pullRequests = runGhJson(projectRoot, [
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'all',
    '--limit',
    '12',
    '--json',
    'number,title,body,state,labels,url',
  ], 'pull-request', warnings);

  return {
    issues,
    pullRequests,
    warnings,
  };
}

function runGhJson(
  projectRoot: string,
  args: string[],
  sourceType: GitHubItem['sourceType'],
  warnings: string[],
): GitHubItem[] {
  const result = spawnSync('gh', args, {
    cwd: projectRoot,
    encoding: 'utf-8',
  });

  if (result.error) {
    warnings.push(`gh CLI 不可用，跳过 GitHub ${sourceType === 'issue' ? 'issue' : 'PR'} 接入。`);
    return [];
  }

  if (result.status !== 0) {
    const stderr = `${result.stderr ?? ''}`.trim();
    warnings.push(
      `GitHub ${sourceType === 'issue' ? 'issue' : 'PR'} 接入失败: ${stderr || `退出码 ${result.status}`}`,
    );
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout || '[]') as Array<Record<string, unknown>>;
    return parsed.map((item) => ({
      sourceType,
      number: normalizeNumber(item.number),
      title: `${item.title ?? ''}`.trim(),
      body: `${item.body ?? ''}`.trim(),
      state: `${item.state ?? 'unknown'}`.trim(),
      labels: Array.isArray(item.labels)
        ? item.labels
          .map((label) => {
            if (label && typeof label === 'object') {
              return `${(label as { name?: unknown }).name ?? ''}`.trim();
            }
            return `${label ?? ''}`.trim();
          })
          .filter((label) => label.length > 0)
        : [],
      url: typeof item.url === 'string' ? item.url : undefined,
    }));
  } catch (error) {
    warnings.push(`GitHub ${sourceType === 'issue' ? 'issue' : 'PR'} 输出解析失败: ${String(error)}`);
    return [];
  }
}

function resolveGitHubRepo(projectRoot: string): string | undefined {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return undefined;
  }

  const remoteUrl = `${result.stdout ?? ''}`.trim();
  const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
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

  const readmeParagraph = corpus.readmes.flatMap((source) => extractParagraphs(source.text)).find(Boolean);
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

  if (scenarios.length === 0) {
    for (const item of [...corpus.issues.slice(0, 2), ...corpus.pullRequests.slice(0, 2)]) {
      scenarios.push({
        id: `scenario-${scenarios.length + 1}`,
        title: item.title,
        summary: firstMeaningfulSentence(item.body) ?? item.title,
        actors: [inferAudience(item.title, targetUsers) ?? targetUsers[0]?.name ?? '使用者'],
        evidence: [toGitHubEvidence(item, item.title, 'medium')],
        confidence: 'medium',
        inferred: true,
      });
    }
  }

  return dedupeScenarios(scenarios).slice(0, 6);
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
      paragraph.length > 0
      && !paragraph.startsWith('|')
      && !paragraph.startsWith('##')
      && !paragraph.startsWith('```'),
    );
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

function toGitHubEvidence(
  item: GitHubItem,
  excerpt: string,
  confidence: ProductEvidenceRef['confidence'],
): ProductEvidenceRef {
  return {
    sourceType: item.sourceType,
    label: `${item.sourceType === 'issue' ? 'issue' : 'pr'} #${item.number}`,
    path: item.url,
    ref: item.url,
    excerpt,
    confidence,
    inferred: false,
  };
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
    } catch {
      // ignore
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
