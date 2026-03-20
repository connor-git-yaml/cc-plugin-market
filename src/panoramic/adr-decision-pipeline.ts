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
import type { ProjectContext } from './interfaces.js';
import type {
  ArchitectureNarrativeOutput,
  BatchGeneratedDocSummary,
  NarrativeModuleInsight,
} from './architecture-narrative.js';
import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import type { PatternHintsOutput } from './pattern-hints-model.js';
import { loadTemplate } from './utils/template-loader.js';

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
    const jsonPath = path.join(adrDir, `${baseName}.json`);
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(mdPath, markdown, 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(draft, null, 2), 'utf-8');
    writtenFiles.push(mdPath, jsonPath);
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
  const indexJsonPath = path.join(adrDir, 'index.json');
  fs.writeFileSync(indexMarkdownPath, indexMarkdown, 'utf-8');
  fs.writeFileSync(indexJsonPath, JSON.stringify(index, null, 2), 'utf-8');
  writtenFiles.push(indexMarkdownPath, indexJsonPath);

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

function buildAdrCandidates(corpus: AdrCorpus): CandidateDraft[] {
  const candidates = [
    buildCliHostedRuntimeCandidate(corpus),
    buildStreamJsonProtocolCandidate(corpus),
    buildRegistryExtensibilityCandidate(corpus),
    buildDeterministicFactsCandidate(corpus),
    buildCurrentSpecFactSourceCandidate(corpus),
    buildAppendOnlySessionCandidate(corpus),
    buildContainerizedRuntimeCandidate(corpus),
    buildModularSeparationCandidate(corpus),
  ].filter((candidate): candidate is CandidateDraft => candidate !== null);

  if (candidates.length >= 2) {
    return candidates;
  }

  const fallback = buildGenericCoreSeparationCandidate(corpus);
  return fallback ? [...candidates, fallback] : candidates;
}

function buildCliHostedRuntimeCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const evidence = matchEvidence(corpus, [
    'claude code cli',
    'subprocess',
    'transport',
    'stdin/stdout',
    'cli 子进程',
    'subprocesscli',
    'subprocess_cli',
  ], 4);
  if (evidence.length < 2) {
    return null;
  }

  return {
    key: 'cli-hosted-runtime',
    score: 98 + evidence.length,
    title: '使用 CLI 作为宿主执行引擎',
    category: 'runtime',
    confidence: 'high',
    inferred: false,
    summary: '将宿主语言 SDK/工具层建立在现有 CLI runtime 之上，而不是重复实现 agent loop。',
    decision: '以 CLI 子进程作为主执行引擎，宿主侧负责参数封装、回调桥接、消息解析与本地扩展接入。',
    context: [
      '代码和文档证据反复指向 CLI transport / subprocess transport，而不是直接 HTTP 模型客户端。',
      '这种结构通常用于复用现有 agent loop、工具生态与权限/插件体系，减少宿主 SDK 自行实现运行时的成本。',
    ],
    consequences: [
      '宿主层可以专注于类型系统、回调与本地扩展，而不必复制完整 runtime。',
      '与 CLI 版本和协议的兼容性会成为关键约束，需要保持 transport 与消息解析层稳定。',
    ],
    alternatives: [
      '直接构建独立的 HTTP / SDK runtime，完全绕过 CLI。',
      '把 agent loop 内嵌在当前宿主进程中，不再依赖外部可执行程序。',
    ],
    evidence,
  };
}

function buildStreamJsonProtocolCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const evidence = matchEvidence(corpus, [
    'stream-json',
    'message parser',
    'control_request',
    'control response',
    'json',
    'stdin',
    'stdout',
    'message_parser',
    '控制协议',
  ], 4);
  if (evidence.length < 2) {
    return null;
  }

  return {
    key: 'stream-json-protocol',
    score: 94 + evidence.length,
    title: '使用 JSON 流式控制协议连接宿主与运行时',
    category: 'protocol',
    confidence: 'high',
    inferred: false,
    summary: '在宿主层与运行时之间统一使用 JSON 消息流，维持双向控制和消息扩展能力。',
    decision: '宿主与执行引擎之间通过 JSON over stdin/stdout 的流式协议交换初始化、控制请求、控制响应和消息事件。',
    context: [
      '项目中同时出现 message parser、streaming、stdin/stdout 与 control request/response 等证据，说明通信协议是架构核心而不是实现细节。',
      '使用结构化协议有助于让 hook、工具权限、MCP 与 session 控制落到同一条消息总线上。',
    ],
    consequences: [
      '消息类型、字段兼容性和缓冲容错会成为运行时稳定性的关键。',
      '协议一旦扩展，宿主侧 parser 与 transport 需要同步演进。',
    ],
    alternatives: [
      '使用一次性命令调用或纯文本 stdout 解析。',
      '宿主与运行时只交换单向消息，不保留 control request/response 语义。',
    ],
    evidence,
  };
}

function buildRegistryExtensibilityCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const evidence = matchEvidence(corpus, [
    'generatorregistry',
    'parserregistry',
    'languageadapterregistry',
    'documentgenerator',
    'artifactparser',
    '注册中心',
    'registry',
  ], 5);
  if (evidence.length < 2) {
    return null;
  }

  return {
    key: 'registry-extensibility',
    score: 91 + evidence.length,
    title: '使用 Registry 统一扩展生成器、解析器与语言适配器',
    category: 'extensibility',
    confidence: 'high',
    inferred: false,
    summary: '把生成器、解析器和适配器收敛到统一注册中心，避免能力扩展散落在分支逻辑里。',
    decision: '通过 Registry 抽象统一管理 DocumentGenerator、ArtifactParser 与 LanguageAdapter 的发现、启停和按上下文过滤。',
    context: [
      '当前仓库的 panoramic 能力已经演化为多生成器、多解析器、多语言适配的组合系统。',
      '如果没有统一注册/过滤机制，新增文档类型和解析链路会快速失控，并增加 batch 编排复杂度。',
    ],
    consequences: [
      '扩展点更稳定，batch/CLI/MCP 可以共享同一套能力发现逻辑。',
      'Registry 自身会成为横切层，需要额外保证幂等初始化、冲突检测和可观察性。',
    ],
    alternatives: [
      '在 CLI 或 batch 中硬编码每类生成器/解析器调用顺序。',
      '按语言或文档类型拆散到多套互不共享的发现机制。',
    ],
    evidence,
  };
}

function buildDeterministicFactsCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const evidence = matchEvidence(corpus, [
    'ast-only',
    'fallback',
    'low confidence',
    '静默降级',
    'graceful degradation',
    'confidence',
    '结构化事实',
    'deterministic',
  ], 4);
  if (evidence.length < 2) {
    return null;
  }

  return {
    key: 'deterministic-facts',
    score: 89 + evidence.length,
    title: '优先保留确定性事实层并对 LLM 增强做诚实降级',
    category: 'quality',
    confidence: 'high',
    inferred: false,
    summary: '把结构化事实抽取与 narrative 增强分层，LLM 不可用时仍保留 AST/规则输出。',
    decision: '将 API、配置、依赖图、模块签名等确定性事实保留在 parser/graph 层；LLM 仅用于 explanation、summary 与 narrative，失败时静默降级为 AST-only / low-confidence 输出。',
    context: [
      '当前产品明确区分结构化事实与 narrative 输出，并把低置信度和降级路径作为一等能力暴露。',
      '这类工具链如果让 LLM 直接决定 canonical facts，会把文档体系变成不可验证的文本生成器。',
    ],
    consequences: [
      '输出质量更可控，coverage audit 和 drift 检测仍能基于确定性事实运行。',
      '当 LLM 不可用时，文档可读性会下降，但不会完全失去可用性。',
    ],
    alternatives: [
      '让 LLM 直接生成或决定 API / 配置 / 依赖等结构事实。',
      '在增强失败时终止整次文档生成，而不是保留保守输出。',
    ],
    evidence,
  };
}

function buildCurrentSpecFactSourceCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const evidence = matchEvidence(corpus, [
    'current-spec',
    '产品规范活文档',
    '事实源',
    'spec-driver-sync',
    'product facts',
  ], 4).filter((entry) => entry.sourceType === 'current-spec' || entry.sourceType === 'spec' || entry.sourceType === 'commit');
  if (evidence.length < 1) {
    return null;
  }

  return {
    key: 'current-spec-fact-source',
    score: 86 + evidence.length,
    title: '将 current-spec 作为产品文档的上游事实源',
    category: 'product-facts',
    confidence: 'high',
    inferred: false,
    summary: '先用 Spec Driver 聚合产品级事实，再派生 README、产品概览和对外文档，减少事实漂移。',
    decision: '把 `current-spec.md` 作为产品/文档层的规范化事实源之一，优先消费聚合后的产品语义而不是重复从代码和增量 spec 中猜测产品定位。',
    context: [
      '当前仓库同时存在 reverse-spec 与 spec-driver，两者的职责边界之一就是“事实聚合”和“文档派生”分层。',
      '没有产品级事实源时，对外文档会在 README、spec 和实现之间反复漂移。',
    ],
    consequences: [
      'README / product overview / feature brief 可以共享同一套产品事实摘要。',
      '需要保证 sync 链路的及时性，否则 current-spec 会成为过时缓存。',
    ],
    alternatives: [
      '每次生成对外文档都直接从增量 spec 与代码重新拼接产品语义。',
      '完全依赖 README 或 issue 文本作为产品事实来源。',
    ],
    evidence,
  };
}

function buildAppendOnlySessionCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const evidence = matchEvidence(corpus, [
    'append-only',
    'session_mutations',
    'rename_session',
    'tag_session',
    '追加式',
    'append only',
  ], 4);
  if (evidence.length < 2) {
    return null;
  }

  return {
    key: 'append-only-session-metadata',
    score: 84 + evidence.length,
    title: '对会话元数据采用 append-only 更新策略',
    category: 'storage',
    confidence: 'medium',
    inferred: false,
    summary: '通过追加元数据记录而非重写整份 transcript，降低并发写风险并保持读取兼容性。',
    decision: '会话标题、标签等变更采用 append-only 元数据行追加，并在读取时应用最后一条记录生效的规则。',
    context: [
      '会话 transcript 往往体积较大，且运行时可能同时读取尾部或追加新消息。',
      '全量重写 transcript 成本高，也更容易在并发场景下损坏或产生竞争。',
    ],
    consequences: [
      '写路径更轻，兼容 tail-read/re-append 场景。',
      '读取端需要承担“最后一条生效”的合并逻辑。',
    ],
    alternatives: [
      '每次修改标题或标签都整文件重写 transcript。',
      '把会话元数据迁到独立数据库或索引服务中维护。',
    ],
    evidence,
  };
}

function buildContainerizedRuntimeCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const deploymentAvailable = corpus.architectureOverview?.deploymentView?.available ?? false;
  const evidence = deploymentAvailable
    ? matchEvidence(corpus, ['docker', 'compose', 'deployment', 'runtime-topology', 'container'], 4)
    : [];
  if (!deploymentAvailable || evidence.length < 2) {
    return null;
  }

  return {
    key: 'containerized-runtime-boundary',
    score: 82 + evidence.length,
    title: '使用容器化部署边界表达运行时拓扑',
    category: 'deployment',
    confidence: 'medium',
    inferred: false,
    summary: '通过 Dockerfile / Compose 等制品显式建模服务、端口和依赖，而不是把运行时假设隐含在脚本里。',
    decision: '将服务镜像、端口、环境变量和依赖关系显式维护为容器化运行时拓扑，并把部署视图作为架构文档的一等组成部分。',
    context: [
      '项目已经暴露出可解析的 Docker / Compose 运行时制品，说明部署边界是系统结构的一部分。',
      '当部署事实没有结构化表达时，架构文档很难稳定覆盖服务关系与运维约束。',
    ],
    consequences: [
      '运行时和部署约束更易被文档、审计和后续工具消费。',
      '部署视图将依赖制品完整性；缺少 Docker/Compose 时需要降级说明。',
    ],
    alternatives: [
      '仅在 README 或脚本里零散描述运行时与部署方式。',
      '不把部署事实纳入架构文档主链路。',
    ],
    evidence,
  };
}

function buildModularSeparationCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const coreModules = corpus.architectureNarrative.keyModules.filter((module) => module.role === 'core');
  if (coreModules.length < 2) {
    return null;
  }

  const evidence = coreModules
    .slice(0, 3)
    .map((module) => evidenceFromModule(module))
    .filter((entry): entry is AdrEvidenceRef => entry !== null);

  return {
    key: 'modular-surface-separation',
    score: 78 + evidence.length,
    title: '按核心职责拆分模块边界，而不是把主流程堆叠在单一入口中',
    category: 'modularity',
    confidence: 'medium',
    inferred: true,
    summary: '把核心职责拆成多个聚焦模块，有助于让主流程、支撑能力和验证层分别演化。',
    decision: `将核心能力优先拆分到 ${coreModules.slice(0, 3).map((module) => `\`${module.sourceTarget}\``).join('、')} 等职责明确的模块中，再由高层入口聚合。`,
    context: [
      '当前项目的关键模块已经呈现出相对清晰的职责分离，而不是所有能力都堆在同一目录或同一入口文件。',
      '这类结构更有利于后续为不同文档视图、运行时路径或测试层提供稳定边界。',
    ],
    consequences: [
      '模块级文档和组件级文档更容易建立阅读路径与责任边界。',
      '如果聚合层过薄或缺少索引，阅读者仍可能感到跳转成本高，需要额外 narrative/overview 支撑。',
    ],
    alternatives: [
      '把主流程、支撑能力和验证代码集中在单一模块或入口文件中。',
      '依赖目录命名约定而不显式维护职责边界。',
    ],
    evidence,
  };
}

function buildGenericCoreSeparationCandidate(corpus: AdrCorpus): CandidateDraft | null {
  const module = corpus.architectureNarrative.keyModules[0];
  if (!module) {
    return null;
  }

  const evidence = [evidenceFromModule(module)].filter((item): item is AdrEvidenceRef => item !== null);
  return {
    key: 'core-separation-fallback',
    score: 60,
    title: '围绕核心模块维持聚焦职责边界',
    category: 'modularity',
    confidence: 'medium',
    inferred: true,
    summary: '即便缺少更多产品/历史上下文，当前输出也显示系统围绕少数核心模块组织主流程。',
    decision: `优先围绕 \`${module.sourceTarget}\` 一类核心模块组织主链路，并避免把支撑逻辑无边界地扩散到所有文件。`,
    context: [
      '当前可见证据有限，但架构叙事仍指向了若干核心模块与导出符号。',
    ],
    consequences: [
      '可以为后续 component view / dynamic scenarios 留出更稳定的分析入口。',
    ],
    alternatives: [
      '在证据不足的情况下完全放弃候选 ADR 输出。',
    ],
    evidence,
  };
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

function matchEvidence(
  corpus: AdrCorpus,
  keywords: string[],
  limit: number,
): AdrEvidenceRef[] {
  const loweredKeywords = keywords.map((item) => item.toLowerCase());

  const matchedItems = corpus.entries
    .map((entry): { score: number; evidence: AdrEvidenceRef } | null => {
      const loweredText = entry.text.toLowerCase();
      const score = loweredKeywords.reduce((sum, keyword) => (
        loweredText.includes(keyword) ? sum + 1 : sum
      ), 0);
      if (score === 0) {
        return null;
      }

      return {
        score,
        evidence: {
          sourceType: entry.sourceType,
          label: entry.label,
          path: entry.path,
          excerpt: summarizeEvidenceText(entry.text, loweredKeywords),
        } satisfies AdrEvidenceRef,
      };
    })
    .filter((item): item is { score: number; evidence: AdrEvidenceRef } => item !== null);

  return matchedItems
    .sort((left, right) => right.score - left.score || left.evidence.label.localeCompare(right.evidence.label))
    .slice(0, limit)
    .map((item) => item.evidence);
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
      || lower.startsWith('.reverse-spec')
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
