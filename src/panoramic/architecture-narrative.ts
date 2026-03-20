/**
 * Architecture narrative document builder
 *
 * 面向人类阅读的技术架构说明，不替代现有结构化 panoramic 文档，
 * 而是聚合 module spec、baseline skeleton 与 architecture overview 的事实，
 * 生成“先说结论 / 关键模块 / 关键类 / 关键方法”的叙事文档。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodeSkeleton, ExportSymbol, MemberInfo } from '../models/code-skeleton.js';
import type { ProjectContext } from './interfaces.js';
import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import { loadTemplate } from './utils/template-loader.js';

export interface BatchGeneratedDocSummary {
  generatorId: string;
  writtenFiles: string[];
  warnings: string[];
}

type NarrativeModuleRole = 'core' | 'support' | 'validation';

export interface NarrativeSymbolInsight {
  moduleName: string;
  ownerName?: string;
  name: string;
  kind: string;
  signature: string;
  note: string;
  inferred: boolean;
}

export interface NarrativeModuleInsight {
  sourceTarget: string;
  displayName: string;
  role: NarrativeModuleRole;
  relatedFiles: string[];
  confidence: 'high' | 'medium' | 'low';
  intentSummary: string;
  businessSummary: string;
  dependencySummary: string;
  keySymbols: NarrativeSymbolInsight[];
  keyMethods: NarrativeSymbolInsight[];
  inferred: boolean;
}

export interface RepositoryMapEntry {
  path: string;
  category: string;
  moduleCount: number;
  fileCount: number;
  summary: string;
}

export interface SupportingDocLink {
  generatorId: string;
  title: string;
  path: string;
}

export interface ArchitectureNarrativeOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  executiveSummary: string[];
  repositoryMap: RepositoryMapEntry[];
  keyModules: NarrativeModuleInsight[];
  keySymbols: NarrativeSymbolInsight[];
  keyMethods: NarrativeSymbolInsight[];
  observations: string[];
  supportingDocs: SupportingDocLink[];
}

interface StoredNarrativeModule {
  sourceTarget: string;
  relatedFiles: string[];
  confidence: 'high' | 'medium' | 'low';
  intentSummary: string;
  businessSummary: string;
  dependencySummary: string;
  baselineSkeleton?: CodeSkeleton;
}

export interface BuildArchitectureNarrativeOptions {
  projectRoot: string;
  outputDir: string;
  projectContext: ProjectContext;
  architectureOverview?: ArchitectureOverviewOutput;
  generatedDocs: BatchGeneratedDocSummary[];
}

export function buildArchitectureNarrative(
  options: BuildArchitectureNarrativeOptions,
): ArchitectureNarrativeOutput {
  const modules = loadStoredNarrativeModules(options.outputDir, options.projectRoot);
  const projectName = resolveProjectName(
    options.architectureOverview?.model.projectName,
    options.projectRoot,
  );

  const moduleInsights = modules
    .map((module) => toNarrativeModuleInsight(module))
    .sort((left, right) => compareModuleInsights(left, right));

  const keyModules = moduleInsights.slice(0, 6);
  const keySymbols = collectKeySymbols(moduleInsights).slice(0, 10);
  const keyMethods = collectKeyMethods(moduleInsights).slice(0, 12);
  const repositoryMap = buildRepositoryMap(moduleInsights, options.projectContext);
  const supportingDocs = buildSupportingDocs(options.generatedDocs);
  const executiveSummary = buildExecutiveSummary(
    projectName,
    moduleInsights,
    keyModules,
    options.projectContext,
    options.architectureOverview,
    supportingDocs,
  );
  const observations = buildObservations(
    moduleInsights,
    options.architectureOverview,
    supportingDocs,
  );

  return {
    title: `技术架构说明: ${projectName}`,
    generatedAt: new Date().toISOString().split('T')[0]!,
    projectName,
    executiveSummary,
    repositoryMap,
    keyModules,
    keySymbols,
    keyMethods,
    observations,
    supportingDocs,
  };
}

export function renderArchitectureNarrative(output: ArchitectureNarrativeOutput): string {
  const template = loadTemplate('architecture-narrative.hbs', import.meta.url);
  return template(output);
}

export function loadStoredNarrativeModules(
  outputDir: string,
  projectRoot: string,
): StoredNarrativeModule[] {
  if (!fs.existsSync(outputDir)) {
    return [];
  }

  const markdownSpecFiles: string[] = [];
  walkSpecFiles(outputDir, markdownSpecFiles);

  return markdownSpecFiles
    .map((filePath) => parseStoredNarrativeModule(filePath, projectRoot))
    .filter((item): item is StoredNarrativeModule => item !== null)
    .sort((left, right) => left.sourceTarget.localeCompare(right.sourceTarget));
}

function walkSpecFiles(dir: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSpecFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.spec.md') && !entry.name.startsWith('_')) {
      results.push(fullPath);
    }
  }
}

function parseStoredNarrativeModule(
  filePath: string,
  projectRoot: string,
): StoredNarrativeModule | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter || frontmatter.type !== 'module-spec' || !frontmatter.sourceTarget) {
    return null;
  }

  const baselineSkeleton = extractBaselineSkeleton(content);

  return {
    sourceTarget: normalizeProjectPath(frontmatter.sourceTarget, projectRoot),
    relatedFiles: frontmatter.relatedFiles.map((item) => normalizeProjectPath(item, projectRoot)),
    confidence: frontmatter.confidence ?? 'medium',
    intentSummary: extractSectionSummary(content, 1, frontmatter.sourceTarget),
    businessSummary: extractSectionSummary(content, 3, `${frontmatter.sourceTarget} 的业务逻辑以模块职责为中心组织`),
    dependencySummary: extractSectionSummary(content, 9, `${frontmatter.sourceTarget} 的依赖关系未在既有 spec 中显式描述`),
    baselineSkeleton,
  };
}

function extractFrontmatter(content: string): {
  type?: string;
  sourceTarget?: string;
  confidence?: 'high' | 'medium' | 'low';
  relatedFiles: string[];
} | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(content);
  if (!match?.[1]) {
    return null;
  }

  const lines = match[1].split(/\r?\n/);
  let type: string | undefined;
  let sourceTarget: string | undefined;
  let confidence: 'high' | 'medium' | 'low' | undefined;
  const relatedFiles: string[] = [];
  let inRelatedFiles = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('type:')) {
      type = stripYamlScalar(line.slice('type:'.length).trim());
      inRelatedFiles = false;
      continue;
    }

    if (line.startsWith('sourceTarget:')) {
      sourceTarget = stripYamlScalar(line.slice('sourceTarget:'.length).trim());
      inRelatedFiles = false;
      continue;
    }

    if (line.startsWith('confidence:')) {
      const parsed = stripYamlScalar(line.slice('confidence:'.length).trim());
      if (parsed === 'high' || parsed === 'medium' || parsed === 'low') {
        confidence = parsed;
      }
      inRelatedFiles = false;
      continue;
    }

    if (line === 'relatedFiles:') {
      inRelatedFiles = true;
      continue;
    }

    if (inRelatedFiles) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        relatedFiles.push(stripYamlScalar(trimmed.slice(2).trim()));
        continue;
      }
      inRelatedFiles = false;
    }
  }

  return { type, sourceTarget, confidence, relatedFiles };
}

function extractSectionSummary(content: string, sectionNumber: number, fallback: string): string {
  const headingRe = new RegExp(String.raw`^##\s+${sectionNumber}\.\s+[^\r\n]+\r?\n`, 'm');
  const headingMatch = headingRe.exec(content);
  if (!headingMatch?.[0]) {
    return fallback;
  }

  const start = headingMatch.index + headingMatch[0].length;
  const remainder = content.slice(start);
  const boundaries = [
    remainder.search(/^[ \t]*##\s+\d+\.\s+[^\r\n]+/m),
    remainder.search(/^[ \t]*---\s*$/m),
    remainder.search(/<!-- baseline-skeleton:/m),
  ].filter((index) => index >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : remainder.length;

  return summarizeMarkdown(remainder.slice(0, end), fallback);
}

function summarizeMarkdown(content: string, fallback: string): string {
  const line = content
    .split(/\r?\n/)
    .map((item) => item
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .trim())
    .find((item) =>
      item.length > 0
      && !item.startsWith('```')
      && !item.startsWith('|')
      && !/^<a\s+/i.test(item),
    );
  return line ?? fallback;
}

function extractBaselineSkeleton(content: string): CodeSkeleton | undefined {
  const match = /<!-- baseline-skeleton: ([\s\S]*?) -->/.exec(content);
  if (!match?.[1]) {
    return undefined;
  }

  try {
    return JSON.parse(match[1]) as CodeSkeleton;
  } catch {
    return undefined;
  }
}

function toNarrativeModuleInsight(module: StoredNarrativeModule): NarrativeModuleInsight {
  const role = classifyModuleRole(module.sourceTarget);
  const keySymbols = collectModuleSymbols(module).slice(0, symbolLimitForRole(role));
  const keyMethods = collectModuleMethods(module).slice(0, methodLimitForRole(role));
  const inferred = module.confidence === 'low' || !module.baselineSkeleton;

  return {
    sourceTarget: module.sourceTarget,
    displayName: path.posix.basename(module.sourceTarget),
    role,
    relatedFiles: module.relatedFiles,
    confidence: module.confidence,
    intentSummary: module.intentSummary,
    businessSummary: module.businessSummary,
    dependencySummary: module.dependencySummary,
    keySymbols,
    keyMethods,
    inferred,
  };
}

function collectModuleSymbols(module: StoredNarrativeModule): NarrativeSymbolInsight[] {
  const exports = module.baselineSkeleton?.exports ?? [];

  return exports
    .filter((symbol) => isNarrativeSymbolKind(symbol.kind))
    .map((symbol) => ({
      moduleName: module.sourceTarget,
      name: symbol.name,
      kind: symbol.kind,
      signature: symbol.signature,
      note: summarizeSymbolNote(symbol, module.intentSummary),
      inferred: module.confidence === 'low',
    }))
    .sort((left, right) => compareSymbolInsights(left, right));
}

function collectModuleMethods(module: StoredNarrativeModule): NarrativeSymbolInsight[] {
  const exports = module.baselineSkeleton?.exports ?? [];
  const methods: NarrativeSymbolInsight[] = [];
  const role = classifyModuleRole(module.sourceTarget);

  for (const symbol of exports) {
    if (symbol.kind === 'function' && !isLowSignalNarrativeMethod(symbol.name, undefined, role)) {
      methods.push({
        moduleName: module.sourceTarget,
        ownerName: undefined,
        name: symbol.name,
        kind: 'function',
        signature: symbol.signature,
        note: summarizeSymbolNote(symbol, module.businessSummary),
        inferred: module.confidence === 'low',
      });
    }

    for (const member of symbol.members ?? []) {
      if (!isNarrativeMethodKind(member.kind)) {
        continue;
      }
      if (isLowSignalNarrativeMethod(member.name, symbol.name, role)) {
        continue;
      }
      methods.push({
        moduleName: module.sourceTarget,
        ownerName: symbol.name,
        name: member.name,
        kind: member.kind,
        signature: member.signature,
        note: summarizeMemberNote(member, symbol.name, module.businessSummary),
        inferred: module.confidence === 'low',
      });
    }
  }

  return methods.sort((left, right) => compareMethodInsights(left, right));
}

function collectKeySymbols(modules: NarrativeModuleInsight[]): NarrativeSymbolInsight[] {
  return collectPrioritizedNarrativeItems(
    modules,
    (module) => module.keySymbols,
    (item) => `${item.moduleName}:${item.kind}:${item.name}`,
    compareSymbolInsights,
    10,
  );
}

function collectKeyMethods(modules: NarrativeModuleInsight[]): NarrativeSymbolInsight[] {
  return collectPrioritizedNarrativeItems(
    modules,
    (module) => module.keyMethods,
    (item) => `${item.moduleName}:${item.ownerName ?? 'module'}:${item.kind}:${item.name}`,
    compareMethodInsights,
    12,
  );
}

function buildRepositoryMap(
  modules: NarrativeModuleInsight[],
  projectContext: ProjectContext,
): RepositoryMapEntry[] {
  const buckets = new Map<string, RepositoryMapEntry>();
  const languages = projectContext.detectedLanguages.length > 0
    ? projectContext.detectedLanguages.join(' / ')
    : 'unknown';

  for (const module of modules) {
    const firstSegment = module.sourceTarget.includes('/')
      ? module.sourceTarget.split('/')[0]!
      : module.sourceTarget;
    const category = categorizePath(firstSegment);
    if (!buckets.has(firstSegment)) {
      buckets.set(firstSegment, {
        path: firstSegment,
        category,
        moduleCount: 0,
        fileCount: 0,
        summary: '',
      });
    }
    const entry = buckets.get(firstSegment)!;
    entry.moduleCount += 1;
    entry.fileCount += module.relatedFiles.length;
  }

  for (const entry of buckets.values()) {
    entry.summary = `${entry.category}，覆盖 ${entry.moduleCount} 个模块 / ${entry.fileCount} 个文件，主要语言 ${languages}`;
  }

  return [...buckets.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function buildSupportingDocs(generatedDocs: BatchGeneratedDocSummary[]): SupportingDocLink[] {
  return generatedDocs
    .map((doc) => {
      const markdownPath = doc.writtenFiles.find((filePath) => filePath.endsWith('.md'));
      if (!markdownPath) {
        return null;
      }

      return {
        generatorId: doc.generatorId,
        title: humanizeGeneratorId(doc.generatorId),
        path: path.basename(markdownPath),
      } satisfies SupportingDocLink;
    })
    .filter((item): item is SupportingDocLink => item !== null)
    .sort((left, right) => left.title.localeCompare(right.title));
}

function buildExecutiveSummary(
  projectName: string,
  modules: NarrativeModuleInsight[],
  keyModules: NarrativeModuleInsight[],
  projectContext: ProjectContext,
  architectureOverview: ArchitectureOverviewOutput | undefined,
  supportingDocs: SupportingDocLink[],
): string[] {
  const lines: string[] = [];
  const languages = projectContext.detectedLanguages.length > 0
    ? projectContext.detectedLanguages.join(' / ')
    : 'unknown';

  lines.push(
    `${projectName} 当前以 ${modules.length} 个模块组织，主要语言为 ${languages}，包管理器为 ${projectContext.packageManager}。`,
  );

  if (architectureOverview) {
    lines.push(
      `结构化架构视图已覆盖 ${architectureOverview.model.stats.availableSections}/${architectureOverview.model.stats.totalSections} 个版块，可进一步下钻 system context / deployment / layered 视图。`,
    );
  } else {
    lines.push('当前项目缺少完整部署/monorepo 事实，系统级说明主要基于模块 spec 与源码骨架归纳。');
  }

  if (keyModules.length > 0) {
    lines.push(
      `关键职责主要集中在 ${keyModules.slice(0, 3).map((item) => `\`${item.sourceTarget}\``).join('、')} 等模块。`,
    );
  }

  if (supportingDocs.length > 0) {
    lines.push(`本次 batch 还产出了 ${supportingDocs.length} 份项目级结构化文档，可与本叙事文档配合阅读。`);
  }

  return lines;
}

function buildObservations(
  modules: NarrativeModuleInsight[],
  architectureOverview: ArchitectureOverviewOutput | undefined,
  supportingDocs: SupportingDocLink[],
): string[] {
  const observations = new Set<string>();
  const lowConfidenceCount = modules.filter((module) => module.confidence === 'low').length;

  if (!architectureOverview) {
    observations.add('未生成 architecture-overview；当前叙事以模块职责、导出符号与依赖摘要为主。');
  } else if (architectureOverview.warnings.length > 0) {
    for (const warning of architectureOverview.warnings.slice(0, 4)) {
      observations.add(warning);
    }
  }

  if (lowConfidenceCount > 0) {
    observations.add(`有 ${lowConfidenceCount} 个模块标记为 low confidence，叙事中的部分结论带有 [推断] 性质。`);
  }

  if (supportingDocs.length === 0) {
    observations.add('当前批次未写出额外项目级结构化文档；如需更细粒度视图，需检查 generator 适用性。');
  }

  return [...observations];
}

function resolveProjectName(explicitName: string | undefined, projectRoot: string): string {
  return explicitName?.trim() || path.basename(projectRoot);
}

function compareModuleInsights(left: NarrativeModuleInsight, right: NarrativeModuleInsight): number {
  const scoreDiff = scoreModuleInsight(right) - scoreModuleInsight(left);
  return scoreDiff !== 0 ? scoreDiff : left.sourceTarget.localeCompare(right.sourceTarget);
}

function scoreModuleInsight(module: NarrativeModuleInsight): number {
  let score = module.relatedFiles.length * 2 + module.keySymbols.length * 3 + module.keyMethods.length * 2;
  if (module.role === 'core') score += 10;
  if (module.sourceTarget.includes('core')) score += 4;
  if (module.sourceTarget.includes('internal')) score += 2;
  if (module.role === 'support') score -= 2;
  if (module.role === 'validation') score -= 8;
  if (module.confidence === 'low') score -= 2;
  return score;
}

function compareSymbolInsights(left: NarrativeSymbolInsight, right: NarrativeSymbolInsight): number {
  const scoreDiff = scoreSymbolInsight(right) - scoreSymbolInsight(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return `${left.moduleName}:${left.name}`.localeCompare(`${right.moduleName}:${right.name}`);
}

function scoreSymbolInsight(item: NarrativeSymbolInsight): number {
  let score = 0;
  if (/(Client|Service|Manager|Parser|Session|Transport|Query|Config|Model|SDK|Server)/.test(item.name)) score += 5;
  if (/(class|data_class|struct|protocol|interface)/.test(item.kind)) score += 4;
  score += Math.min(item.signature.length / 40, 4);
  if (classifyModuleRole(item.moduleName) === 'core') score += 3;
  if (classifyModuleRole(item.moduleName) === 'validation') score -= 4;
  if (item.inferred) score -= 1;
  return score;
}

function compareMethodInsights(left: NarrativeSymbolInsight, right: NarrativeSymbolInsight): number {
  const scoreDiff = scoreMethodInsight(right) - scoreMethodInsight(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return `${left.moduleName}:${left.ownerName ?? 'module'}:${left.name}`.localeCompare(
    `${right.moduleName}:${right.ownerName ?? 'module'}:${right.name}`,
  );
}

function scoreMethodInsight(item: NarrativeSymbolInsight): number {
  let score = 0;
  if (/(create|connect|query|start|run|handle|parse|generate|initialize|send|receive|load|build|call|stream|execute|process|write|read|resolve)/i.test(item.name)) {
    score += 6;
  }
  if (item.ownerName) score += 2;
  if (classifyModuleRole(item.moduleName) === 'core') score += 4;
  if (classifyModuleRole(item.moduleName) === 'support') score -= 1;
  if (classifyModuleRole(item.moduleName) === 'validation') score -= 6;
  score += Math.min(item.signature.length / 50, 4);
  if (item.inferred) score -= 1;
  return score;
}

function collectPrioritizedNarrativeItems<T>(
  modules: NarrativeModuleInsight[],
  pick: (module: NarrativeModuleInsight) => T[],
  keyOf: (item: T) => string,
  compare: (left: T, right: T) => number,
  limit: number,
): T[] {
  const orderedRoles: NarrativeModuleRole[] = ['core', 'support', 'validation'];
  const results: T[] = [];
  const seen = new Set<string>();

  for (const role of orderedRoles) {
    const ranked = modules
      .filter((module) => module.role === role)
      .flatMap((module) => pick(module))
      .sort(compare);

    for (const item of ranked) {
      const key = keyOf(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(item);
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}

function summarizeSymbolNote(symbol: ExportSymbol, fallback: string): string {
  if (symbol.jsDoc?.trim()) {
    return summarizeMarkdown(symbol.jsDoc, fallback);
  }
  return fallback;
}

function summarizeMemberNote(member: MemberInfo, ownerName: string, fallback: string): string {
  if (member.jsDoc?.trim()) {
    return summarizeMarkdown(member.jsDoc, fallback);
  }
  return `${ownerName} 的核心成员；${fallback}`;
}

function isNarrativeSymbolKind(kind: string): boolean {
  return kind === 'class'
    || kind === 'interface'
    || kind === 'type'
    || kind === 'data_class'
    || kind === 'struct'
    || kind === 'protocol';
}

function isNarrativeMethodKind(kind: string): boolean {
  return kind === 'method'
    || kind === 'constructor'
    || kind === 'classmethod'
    || kind === 'staticmethod'
    || kind === 'associated_function'
    || kind === 'getter'
    || kind === 'setter';
}

function humanizeGeneratorId(generatorId: string): string {
  return generatorId
    .split('-')
    .map((part) => {
      if (part === 'api') return 'API';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function categorizePath(segment: string): string {
  if (segment === 'src') return '核心实现目录';
  if (segment === 'tests' || segment === 'e2e-tests') return '测试与验收目录';
  if (segment === 'examples') return '示例与对外使用目录';
  if (segment === 'scripts') return '脚本与运维辅助目录';
  return '项目子域目录';
}

function classifyModuleRole(sourceTarget: string): NarrativeModuleRole {
  if (
    sourceTarget === 'tests'
    || sourceTarget.startsWith('tests/')
    || sourceTarget === 'e2e-tests'
    || sourceTarget.startsWith('e2e-tests/')
  ) {
    return 'validation';
  }

  if (
    sourceTarget === 'examples'
    || sourceTarget.startsWith('examples/')
    || sourceTarget === 'scripts'
    || sourceTarget.startsWith('scripts/')
  ) {
    return 'support';
  }

  return 'core';
}

function symbolLimitForRole(role: NarrativeModuleRole): number {
  switch (role) {
    case 'core':
      return 6;
    case 'support':
      return 3;
    case 'validation':
      return 2;
  }
}

function methodLimitForRole(role: NarrativeModuleRole): number {
  switch (role) {
    case 'core':
      return 10;
    case 'support':
      return 4;
    case 'validation':
      return 2;
  }
}

function isLowSignalNarrativeMethod(
  name: string,
  ownerName: string | undefined,
  role: NarrativeModuleRole,
): boolean {
  if (role !== 'validation') {
    return false;
  }

  return name.startsWith('test_')
    || name.startsWith('test')
    || ownerName?.startsWith('Test') === true;
}

function stripYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeProjectPath(inputPath: string, projectRoot: string): string {
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(projectRoot, inputPath);
  const rel = path.relative(projectRoot, absolutePath);
  return rel.startsWith('..') ? inputPath.split(path.sep).join('/') : rel.split(path.sep).join('/');
}

function dedupeNarrativeItems<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(item);
  }
  return results;
}
