/**
 * ADR 决策流水线
 *
 * 基于项目级结构化输出、模块 spec、current-spec、增量 spec 与 git 提交历史，
 * 生成候选 ADR 草稿与索引。该流水线优先使用确定性证据匹配，避免把 ADR 草稿
 * 变成“看起来合理”的纯 LLM 幻觉文本。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from '../interfaces.js';
import type {
  ArchitectureNarrativeOutput,
  BatchGeneratedDocSummary,
  NarrativeModuleInsight,
} from './architecture-narrative.js';
import type { ArchitectureOverviewOutput } from '../generators/architecture-overview-generator.js';
import type { PatternHintsOutput } from '../models/pattern-hints-model.js';
import { loadTemplate } from '../utils/template-loader.js';

export type AdrSourceType =
  | 'architecture-narrative'
  | 'pattern-hints'
  | 'current-spec'
  | 'spec'
  | 'blueprint'
  | 'commit'
  | 'source-path'
  | 'architecture-overview';

export interface AdrEvidenceRef {
  sourceType: AdrSourceType;
  label: string;
  path?: string;
  excerpt: string;
}

export interface AdrDraft {
  decisionId: string;
  slug: string;
  title: string;
  status: 'proposed';
  category:
    | 'runtime'
    | 'protocol'
    | 'extensibility'
    | 'quality'
    | 'product-facts'
    | 'deployment'
    | 'modularity'
    | 'storage';
  confidence: 'high' | 'medium';
  inferred: boolean;
  sourceTypes: AdrSourceType[];
  summary: string;
  decision: string;
  context: string[];
  consequences: string[];
  alternatives: string[];
  evidence: AdrEvidenceRef[];
}

export interface AdrIndexOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  summary: string[];
  draftCount: number;
  warnings: string[];
  drafts: AdrDraft[];
}

export interface GenerateBatchAdrDocsOptions {
  projectRoot: string;
  outputDir: string;
  projectContext: ProjectContext;
  generatedDocs: BatchGeneratedDocSummary[];
  architectureNarrative: ArchitectureNarrativeOutput;
  architectureOverview?: ArchitectureOverviewOutput;
  patternHints?: PatternHintsOutput;
}

export interface GenerateBatchAdrDocsResult {
  index: AdrIndexOutput;
  drafts: AdrDraft[];
  warnings: string[];
  writtenFiles: string[];
}

interface CorpusEntry {
  sourceType: AdrSourceType;
  label: string;
  path?: string;
  text: string;
}

interface GitCommitEntry {
  sha: string;
  subject: string;
  body: string;
}

interface AdrCorpus {
  projectName: string;
  projectRoot: string;
  architectureNarrative: ArchitectureNarrativeOutput;
  architectureOverview?: ArchitectureOverviewOutput;
  patternHints?: PatternHintsOutput;
  commits: GitCommitEntry[];
  entries: CorpusEntry[];
}

interface CandidateDraft {
  key: string;
  score: number;
  title: string;
  category: AdrDraft['category'];
  confidence: AdrDraft['confidence'];
  inferred: boolean;
  summary: string;
  decision: string;
  context: string[];
  consequences: string[];
  alternatives: string[];
  evidence: AdrEvidenceRef[];
}

export function generateBatchAdrDocs(
  options: GenerateBatchAdrDocsOptions,
): GenerateBatchAdrDocsResult {
  const corpus = buildAdrCorpus(options);
  const warnings = new Set<string>();
  const candidates = buildAdrCandidates(corpus);

  if (candidates.length === 0) {
    warnings.add('未识别到足够稳定的 ADR 候选信号，已仅生成空索引。');
  }

  const drafts = candidates
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 4)
    .map((candidate, index) => finalizeDraft(index + 1, candidate));

  const adrDir = path.join(options.outputDir, 'docs', 'adr');
  const writtenFiles: string[] = [];

  for (const draft of drafts) {
    const markdown = renderAdrDraft(draft);
    const baseName = `${draft.decisionId.toLowerCase()}-${draft.slug}`;
    const mdPath = path.join(adrDir, `${baseName}.md`);
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(mdPath, markdown, 'utf-8');
    writtenFiles.push(mdPath);
  }

  const index: AdrIndexOutput = {
    title: `ADR 决策索引: ${corpus.projectName}`,
    generatedAt: new Date().toISOString(),
    projectName: corpus.projectName,
    summary: buildIndexSummary(corpus, drafts),
    draftCount: drafts.length,
    warnings: [...warnings],
    drafts,
  };

  fs.mkdirSync(adrDir, { recursive: true });
  const indexMarkdown = renderAdrIndex(index);
  const indexMarkdownPath = path.join(adrDir, 'index.md');
  fs.writeFileSync(indexMarkdownPath, indexMarkdown, 'utf-8');
  writtenFiles.push(indexMarkdownPath);

  return {
    index,
    drafts,
    warnings: [...warnings],
    writtenFiles,
  };
}

function renderAdrDraft(draft: AdrDraft): string {
  const template = loadTemplate('adr-draft.hbs', import.meta.url);
  return template(draft);
}

function renderAdrIndex(output: AdrIndexOutput): string {
  const template = loadTemplate('adr-index.hbs', import.meta.url);
  return template(output);
}

function buildAdrCorpus(options: GenerateBatchAdrDocsOptions): AdrCorpus {
  const entries: CorpusEntry[] = [];
  const projectName = options.architectureNarrative.projectName;

  entries.push({
    sourceType: 'architecture-narrative',
    label: 'executive-summary',
    path: path.join(options.outputDir, 'architecture-narrative.md'),
    text: [
      ...options.architectureNarrative.executiveSummary,
      ...options.architectureNarrative.observations,
    ].join('\n'),
  });

  for (const module of options.architectureNarrative.keyModules) {
    entries.push({
      sourceType: 'architecture-narrative',
      label: `module:${module.sourceTarget}`,
      path: path.join(options.outputDir, 'architecture-narrative.md'),
      text: [
        module.sourceTarget,
        module.displayName,
        module.intentSummary,
        module.businessSummary,
        module.dependencySummary,
        ...module.keySymbols.map((symbol) => `${symbol.kind}:${symbol.name}:${symbol.note}`),
        ...module.keyMethods.map((method) => `${method.kind}:${method.name}:${method.note}`),
      ].join('\n'),
    });
  }

  if (options.patternHints) {
    entries.push({
      sourceType: 'pattern-hints',
      label: 'pattern-summary',
      path: path.join(options.outputDir, 'pattern-hints.md'),
      text: options.patternHints.model.matchedPatterns
        .map((hint) => [
          hint.patternName,
          hint.summary,
          hint.explanation,
          ...hint.matchedSignals,
        ].join('\n'))
        .join('\n\n'),
    });
  }

  if (options.architectureOverview) {
    entries.push({
      sourceType: 'architecture-overview',
      label: 'overview-summary',
      path: path.join(options.outputDir, 'architecture-overview.md'),
      text: [
        options.architectureOverview.title,
        summarizeArchitectureSection(options.architectureOverview.systemContext),
        summarizeArchitectureSection(options.architectureOverview.deploymentView),
        summarizeArchitectureSection(options.architectureOverview.layeredView),
      ].filter(Boolean).join('\n'),
    });
  }

  for (const filePath of collectMarkdownEvidenceFiles(options.projectRoot)) {
    const normalized = normalizeProjectPath(filePath, options.projectRoot);
    const lower = normalized.toLowerCase();
    let sourceType: AdrSourceType = 'spec';
    if (lower.endsWith('/current-spec.md')) {
      sourceType = 'current-spec';
    } else if (lower.endsWith('/blueprint.md')) {
      sourceType = 'blueprint';
    }

    entries.push({
      sourceType,
      label: normalized,
      path: normalized,
      text: readTrimmed(filePath, 24_000),
    });
  }

  for (const sourcePath of collectSourcePathSignals(options.projectRoot)) {
    entries.push({
      sourceType: 'source-path',
      label: sourcePath,
      path: sourcePath,
      text: sourcePath,
    });
  }

  const commits = loadRecentGitCommits(options.projectRoot);
  for (const commit of commits) {
    entries.push({
      sourceType: 'commit',
      label: commit.sha.slice(0, 7),
      text: [commit.subject, commit.body].filter(Boolean).join('\n'),
    });
  }

  return {
    projectName,
    projectRoot: options.projectRoot,
    architectureNarrative: options.architectureNarrative,
    architectureOverview: options.architectureOverview,
    patternHints: options.patternHints,
    commits,
    entries,
  };
}

// Feature 140 T37 (FR-003) — buildAdrCandidates 内部 8 个 hardcoded candidate 函数已删除：
// - buildCliHostedRuntimeCandidate / buildStreamJsonProtocolCandidate
// - buildRegistryExtensibilityCandidate / buildDeterministicFactsCandidate
// - buildCurrentSpecFactSourceCandidate / buildAppendOnlySessionCandidate
// - buildContainerizedRuntimeCandidate / buildModularSeparationCandidate
// 还有 buildGenericCoreSeparationCandidate fallback 也已删除。
//
// 这 8 个函数原本基于关键词匹配（matchEvidence）触发候选，导致任何足够大的项目都会
// 偶然命中关键词，产出 Spectra 自身架构的模板套壳 ADR（hallucination），这是 spec
// FR-003 锁定要求清除的"ADR 质量问题 1 — ADR hallucinate"根因。
//
// 替代实现：`runAdrMapReduce`（src/panoramic/pipelines/adr-mapreduce.ts）通过
// cluster orchestrator + Map (sonnet) / Reduce (opus) + evidence 真实性校验
// 产出项目特有的 ADR。本同步入口保留作为兼容 stub：返回空数组让既有 caller
// 不至于崩溃，但 ADR 实际产出依赖调用方传入 anthropicClient 并切换到 MapReduce 路径。
function buildAdrCandidates(_corpus: AdrCorpus): CandidateDraft[] {
  // 同步路径不再产出 ADR（MapReduce 路径是 async，由 caller 显式选择）
  return [];
}

function finalizeDraft(index: number, candidate: CandidateDraft): AdrDraft {
  const decisionId = `ADR-${String(index).padStart(4, '0')}`;
  const slug = slugify(candidate.title);
  const sourceTypes = uniqueSorted(candidate.evidence.map((item) => item.sourceType));

  return {
    decisionId,
    slug,
    title: candidate.title,
    status: 'proposed',
    category: candidate.category,
    confidence: candidate.confidence,
    inferred: candidate.inferred,
    sourceTypes,
    summary: candidate.summary,
    decision: candidate.decision,
    context: candidate.context,
    consequences: candidate.consequences,
    alternatives: candidate.alternatives,
    evidence: candidate.evidence,
  };
}

function buildIndexSummary(corpus: AdrCorpus, drafts: AdrDraft[]): string[] {
  const lines = [
    `本批次基于 ${drafts.length} 个候选 ADR 草稿组织决策索引，输入事实主要来自架构叙事、模式提示、现有 spec/current-spec 与近期提交历史。`,
  ];

  if (corpus.patternHints?.model.matchedPatterns.length) {
    lines.push(
      `模式提示中识别到 ${corpus.patternHints.model.matchedPatterns.length} 条可用模式证据，可作为 ADR 背景的结构化补充。`,
    );
  }

  if (corpus.commits.length > 0) {
    lines.push(`已纳入最近 ${Math.min(corpus.commits.length, 20)} 条 git 提交标题作为演进证据。`);
  } else {
    lines.push('未检测到可读取的 git 提交历史，部分 ADR 仅基于当前代码与文档结构推断。');
  }

  return lines;
}

function evidenceFromModule(module: NarrativeModuleInsight): AdrEvidenceRef | null {
  const excerpt = [module.intentSummary, module.businessSummary, module.dependencySummary]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!excerpt) {
    return null;
  }

  return {
    sourceType: 'architecture-narrative',
    label: module.sourceTarget,
    path: 'architecture-narrative.md',
    excerpt,
  };
}

function summarizeArchitectureSection(
  section: ArchitectureOverviewOutput['systemContext'] | undefined,
): string {
  if (!section) {
    return '';
  }

  const parts = [
    section.title,
    section.description ?? '',
    ...section.nodes.slice(0, 4).map((node) => `${node.kind}:${node.label}`),
    ...section.edges.slice(0, 4).map((edge) => `${edge.from}->${edge.to}:${edge.relation}`),
    section.missingReason ?? '',
  ].filter(Boolean);

  return parts.join(' | ');
}


function summarizeEvidenceText(text: string, loweredKeywords: string[]): string {
  const normalized = text.replace(/\r/g, '');
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const matchedLine = lines.find((line) => {
    const lowered = line.toLowerCase();
    return loweredKeywords.some((keyword) => lowered.includes(keyword));
  });

  const source = matchedLine ?? lines[0] ?? normalized;
  return source.length > 240 ? `${source.slice(0, 237)}...` : source;
}

function collectMarkdownEvidenceFiles(projectRoot: string): string[] {
  const specsDir = path.join(projectRoot, 'specs');
  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const results: string[] = [];
  walkDirectory(specsDir, (filePath) => {
    const relative = normalizeProjectPath(filePath, projectRoot).toLowerCase();
    if (
      relative.endsWith('/current-spec.md')
      || relative.endsWith('/blueprint.md')
      || relative.endsWith('/spec.md')
    ) {
      results.push(filePath);
    }
  });

  return results.sort((left, right) => left.localeCompare(right));
}

function collectSourcePathSignals(projectRoot: string): string[] {
  const results: string[] = [];
  walkDirectory(projectRoot, (filePath) => {
    const relative = normalizeProjectPath(filePath, projectRoot);
    const lower = relative.toLowerCase();
    if (
      lower.startsWith('.git/')
      || lower.startsWith('node_modules/')
      || lower.startsWith('dist/')
      || lower.startsWith('coverage/')
      || lower.startsWith('specs/')
      || lower.startsWith('.spectra')
    ) {
      return;
    }
    results.push(relative);
  });

  return results.sort((left, right) => left.localeCompare(right));
}

function walkDirectory(dir: string, onFile: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(fullPath, onFile);
      continue;
    }

    if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

function loadRecentGitCommits(projectRoot: string): GitCommitEntry[] {
  const result = spawnSync(
    'git',
    ['-C', projectRoot, 'log', '--no-color', '--pretty=format:%H%x1f%s%x1f%b%x1e', '-n', '20'],
    { encoding: 'utf-8' },
  );

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha, subject, body] = chunk.split('\x1f');
      return {
        sha: sha ?? '',
        subject: subject ?? '',
        body: body ?? '',
      };
    })
    .filter((entry) => entry.sha && entry.subject);
}

function normalizeProjectPath(filePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, filePath);
  return relative.split(path.sep).join('/');
}

function readTrimmed(filePath: string, maxLength: number): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const normalized = content.replace(/\r/g, '');
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function uniqueSorted<T extends string>(items: T[]): T[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

// ============================================================
// DocumentGenerator Adapter
// ============================================================

/**
 * AdrDecisionPipelineGenerator
 *
 * 将 generateBatchAdrDocs() 适配为 DocumentGenerator 接口。
 * generate() 包含 fs 文件写出副作用（写出 ADR 草稿与索引）。
 * render() 为纯 Markdown 摘要，不含 fs 调用。
 *
 * TInput: GenerateBatchAdrDocsOptions
 * TOutput: GenerateBatchAdrDocsResult
 */
export class AdrDecisionPipelineGenerator
  implements DocumentGenerator<GenerateBatchAdrDocsOptions, GenerateBatchAdrDocsResult>
{
  readonly id = 'adr-decision-pipeline' as const;
  readonly name = 'ADR 决策流水线生成器' as const;
  readonly description = '基于架构事实与模块 spec 生成候选 ADR 草稿与索引，并写出到 outputDir/docs/adr/';

  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  isApplicable(context: ProjectContext): boolean {
    // 只要项目根目录存在即可适用（outputDir 由构造函数注入）
    return Boolean(context.projectRoot);
  }

  async extract(context: ProjectContext): Promise<GenerateBatchAdrDocsOptions> {
    // 构造最小化 options，必需字段来自 context 和 outputDir
    // architectureNarrative 必须提供，此处使用最小 stub（由编排层注入完整值）
    return {
      projectRoot: context.projectRoot,
      outputDir: this.outputDir,
      projectContext: context,
      generatedDocs: [],
      architectureNarrative: {
        title: '',
        generatedAt: new Date().toISOString().split('T')[0]!,
        projectName: '',
        executiveSummary: [],
        repositoryMap: [],
        keyModules: [],
        keySymbols: [],
        keyMethods: [],
        observations: [],
        supportingDocs: [],
      },
    };
  }

  async generate(
    input: GenerateBatchAdrDocsOptions,
    _options?: GenerateOptions,
  ): Promise<GenerateBatchAdrDocsResult> {
    // generate() 包含 fs 写出副作用（写出 ADR 文件）
    return generateBatchAdrDocs(input);
  }

  render(output: GenerateBatchAdrDocsResult): string {
    // render() 为纯摘要，无 fs 调用
    const { index } = output;
    const lines: string[] = [
      `# ${index.title}`,
      '',
      `**生成时间**: ${index.generatedAt}`,
      `**ADR 草稿数**: ${index.draftCount}`,
      '',
      ...index.summary,
    ];

    if (output.writtenFiles.length > 0) {
      lines.push('', '**写出文件**:');
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
