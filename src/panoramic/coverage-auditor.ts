/**
 * CoverageAuditor
 * 基于 DocGraph、ModuleGroup 和 GeneratorRegistry 生成覆盖率审计结果。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModuleGroup } from '../batch/module-grouper.js';
import type { ProjectContext } from './interfaces.js';
import {
  GeneratorRegistry,
  bootstrapGenerators,
} from './generator-registry.js';
import {
  resolveSpecForSource,
  type DocGraph,
  type DocGraphSpecNode,
} from './doc-graph-builder.js';
import { loadTemplate } from './utils/template-loader.js';
import {
  getBatchProjectOutputFileName,
  isBatchProjectGeneratorId,
} from './output-filenames.js';

export type CoverageIssue =
  | 'missing-doc'
  | 'missing-links'
  | 'dangling-links'
  | 'low-confidence';

export type ModuleCoverageStatus = 'documented' | 'missing-doc' | 'attention';

export interface CoverageTargetUnit {
  unitName: string;
  displayName: string;
  dirPath: string;
  level: number;
  sourceFiles: string[];
}

export interface ModuleCoverageEntry {
  moduleName: string;
  dirPath: string;
  level: number;
  sourceFiles: string[];
  status: ModuleCoverageStatus;
  issues: CoverageIssue[];
  specPath?: string;
  sourceTarget?: string;
}

export interface GeneratorCoverageEntry {
  generatorId: string;
  generatorName: string;
  scope: 'project' | 'module';
  expectedCount: number;
  generatedCount: number;
  missingCount: number;
  coveragePct: number;
  expectedOutputs: string[];
  existingOutputs: string[];
  missingOutputs: string[];
}

export interface DanglingLinkEntry {
  specPath: string;
  href: string;
  targetPath: string;
  anchor?: string;
  reason: 'missing-file' | 'missing-anchor';
}

export interface MissingLinkEntry {
  specPath: string;
  sourceTarget: string;
}

export interface LowConfidenceSpecEntry {
  specPath: string;
  sourceTarget: string;
  confidence: 'low';
}

export interface LevelCoverageEntry {
  level: number;
  total: number;
  documented: number;
  missingDoc: number;
  attention: number;
}

export interface CoverageSummary {
  totalModules: number;
  documentedModules: number;
  moduleCoveragePct: number;
  missingDocCount: number;
  missingLinkCount: number;
  danglingLinkCount: number;
  lowConfidenceCount: number;
  applicableGenerators: number;
  generatedGeneratorDocs: number;
}

export interface CoverageAudit {
  title: string;
  generatedAt: string;
  projectRoot: string;
  summary: CoverageSummary;
  moduleCoverage: ModuleCoverageEntry[];
  missingDocModules: ModuleCoverageEntry[];
  attentionModules: ModuleCoverageEntry[];
  generatorCoverage: GeneratorCoverageEntry[];
  levelCoverage: LevelCoverageEntry[];
  danglingLinks: DanglingLinkEntry[];
  missingLinks: MissingLinkEntry[];
  lowConfidenceSpecs: LowConfidenceSpecEntry[];
}

export interface CoverageAuditorOptions {
  projectRoot: string;
  outputDir: string;
  projectContext: ProjectContext;
  docGraph: DocGraph;
  moduleGroups: ModuleGroup[];
}

const ROOT_MODULE_RE = /^root(?:--.+)?$/;
const SPEC_LINK_RE = /\[[^\]]+\]\(([^)]+?\.spec\.md(?:#[^)]+)?)\)/g;
export class CoverageAuditor {
  async audit(options: CoverageAuditorOptions): Promise<CoverageAudit> {
    const coverageTargets = expandCoverageTargets(options.moduleGroups);
    const danglingLinks = scanDanglingSpecLinks(options.outputDir, options.projectRoot);
    const danglingBySpecPath = groupDanglingLinksBySpec(danglingLinks);
    const missingLinks = options.docGraph.unlinkedSpecs.map((entry) => ({
      specPath: entry.specPath,
      sourceTarget: entry.sourceTarget,
    }));
    const lowConfidenceSpecs = options.docGraph.specs
      .filter((spec): spec is DocGraphSpecNode & { confidence: 'low' } => spec.confidence === 'low')
      .map((spec) => ({
        specPath: spec.specPath,
        sourceTarget: spec.sourceTarget,
        confidence: 'low' as const,
      }));

    const moduleCoverage = coverageTargets.map((target) => {
      const matchedSpecs = target.sourceFiles
        .map((filePath) => resolveSpecForSource(filePath, options.docGraph.specs))
        .filter((spec, index, specs): spec is DocGraphSpecNode =>
          spec !== undefined
          && specs.findIndex((candidate) => candidate?.specPath === spec.specPath) === index,
        );

      const issues = new Set<CoverageIssue>();
      if (matchedSpecs.length === 0) {
        issues.add('missing-doc');
      }

      for (const spec of matchedSpecs) {
        if (!spec.linked) {
          issues.add('missing-links');
        }
        if (spec.confidence === 'low') {
          issues.add('low-confidence');
        }
        if ((danglingBySpecPath.get(spec.specPath)?.length ?? 0) > 0) {
          issues.add('dangling-links');
        }
      }

      const issueList = [...issues].sort(issuePrioritySort);
      const primarySpec = matchedSpecs[0];
      const status: ModuleCoverageStatus = issueList.length === 0
        ? 'documented'
        : issueList.includes('missing-doc')
          ? 'missing-doc'
          : 'attention';

      return {
        moduleName: target.displayName,
        dirPath: target.dirPath,
        level: target.level,
        sourceFiles: target.sourceFiles,
        status,
        issues: issueList,
        specPath: primarySpec?.specPath,
        sourceTarget: primarySpec?.sourceTarget,
      } satisfies ModuleCoverageEntry;
    });

    const generatorCoverage = await this.buildGeneratorCoverage(
      options.projectContext,
      options.outputDir,
      moduleCoverage,
    );

    const levelCoverage = summarizeLevelCoverage(moduleCoverage);
    const documentedModules = moduleCoverage.filter((entry) => entry.status === 'documented').length;
    const missingDocCount = moduleCoverage.filter((entry) => entry.issues.includes('missing-doc')).length;
    const missingLinkCount = moduleCoverage.filter((entry) => entry.issues.includes('missing-links')).length;
    const moduleGenerator = generatorCoverage.find((entry) => entry.generatorId === 'module-spec');
    const projectGeneratorEntries = generatorCoverage.filter((entry) => entry.scope === 'project');
    const generatedGeneratorDocs = projectGeneratorEntries.reduce(
      (sum, entry) => sum + entry.generatedCount,
      0,
    );

    return {
      title: 'Coverage Audit Report',
      generatedAt: new Date().toISOString(),
      projectRoot: options.projectRoot,
      summary: {
        totalModules: coverageTargets.length,
        documentedModules,
        moduleCoveragePct: percent(documentedModules, coverageTargets.length),
        missingDocCount,
        missingLinkCount,
        danglingLinkCount: danglingLinks.length,
        lowConfidenceCount: lowConfidenceSpecs.length,
        applicableGenerators: projectGeneratorEntries.length + (moduleGenerator ? 1 : 0),
        generatedGeneratorDocs,
      },
      moduleCoverage: moduleCoverage.sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
      missingDocModules: moduleCoverage
        .filter((entry) => entry.issues.includes('missing-doc'))
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
      attentionModules: moduleCoverage
        .filter((entry) => entry.status === 'attention')
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
      generatorCoverage,
      levelCoverage,
      danglingLinks,
      missingLinks,
      lowConfidenceSpecs,
    };
  }

  render(audit: CoverageAudit): string {
    const template = loadTemplate('coverage-report.hbs', import.meta.url);
    return template(audit);
  }

  private async buildGeneratorCoverage(
    projectContext: ProjectContext,
    outputDir: string,
    moduleCoverage: ModuleCoverageEntry[],
  ): Promise<GeneratorCoverageEntry[]> {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();

    const moduleSpecCoverage: GeneratorCoverageEntry = {
      generatorId: 'module-spec',
      generatorName: '模块 Spec',
      scope: 'module',
      expectedCount: moduleCoverage.length,
      generatedCount: moduleCoverage.filter((entry) => !entry.issues.includes('missing-doc')).length,
      missingCount: moduleCoverage.filter((entry) => entry.issues.includes('missing-doc')).length,
      coveragePct: percent(
        moduleCoverage.filter((entry) => !entry.issues.includes('missing-doc')).length,
        moduleCoverage.length,
      ),
      expectedOutputs: moduleCoverage.map((entry) => entry.moduleName),
      existingOutputs: moduleCoverage
        .map((entry) => entry.specPath)
        .filter((item): item is string => typeof item === 'string'),
      missingOutputs: moduleCoverage
        .filter((entry) => entry.issues.includes('missing-doc'))
        .map((entry) => entry.moduleName),
    };

    const applicableGenerators = (await registry.filterByContext(projectContext))
      .filter((generator) => isBatchProjectGeneratorId(generator.id));

    const projectEntries = applicableGenerators.map((generator) => {
      const expectedFile = getBatchProjectOutputFileName(generator.id);
      const expectedOutputs = [expectedFile];
      const existingOutputs = expectedOutputs.filter((fileName) =>
        fs.existsSync(path.join(outputDir, fileName)),
      );

      return {
        generatorId: generator.id,
        generatorName: generator.name,
        scope: 'project' as const,
        expectedCount: expectedOutputs.length,
        generatedCount: existingOutputs.length,
        missingCount: expectedOutputs.length - existingOutputs.length,
        coveragePct: percent(existingOutputs.length, expectedOutputs.length),
        expectedOutputs,
        existingOutputs,
        missingOutputs: expectedOutputs.filter((item) => !existingOutputs.includes(item)),
      };
    });

    return [moduleSpecCoverage, ...projectEntries].sort((left, right) =>
      left.generatorId.localeCompare(right.generatorId),
    );
  }
}

function expandCoverageTargets(moduleGroups: ModuleGroup[]): CoverageTargetUnit[] {
  return moduleGroups.flatMap((group) => {
    if (ROOT_MODULE_RE.test(group.name)) {
      return group.files.map((filePath) => ({
        unitName: filePath,
        displayName: filePath,
        dirPath: path.posix.dirname(filePath) === '.' ? filePath : path.posix.dirname(filePath),
        level: path.posix.dirname(filePath) === '.' ? 0 : path.posix.dirname(filePath).split('/').length,
        sourceFiles: [filePath],
      }));
    }

    return [{
      unitName: group.name,
      displayName: group.name,
      dirPath: group.dirPath,
      level: group.name.split('/').length - 1,
      sourceFiles: [...group.files].sort((a, b) => a.localeCompare(b)),
    }];
  });
}

function scanDanglingSpecLinks(
  outputDir: string,
  projectRoot: string,
): DanglingLinkEntry[] {
  if (!fs.existsSync(outputDir)) {
    return [];
  }

  const markdownFiles: string[] = [];
  walkMarkdownFiles(outputDir, markdownFiles);
  const issues: DanglingLinkEntry[] = [];

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.matchAll(SPEC_LINK_RE);

    for (const match of matches) {
      const href = match[1];
      if (!href) {
        continue;
      }

      const [targetFilePart, anchor] = href.split('#');
      if (!targetFilePart) {
        continue;
      }
      const targetAbs = path.resolve(path.dirname(filePath), targetFilePart);
      const normalizedSource = normalizeProjectPath(filePath, projectRoot);
      const normalizedTarget = normalizeProjectPath(targetAbs, projectRoot);

      if (!fs.existsSync(targetAbs)) {
        issues.push({
          specPath: normalizedSource,
          href,
          targetPath: normalizedTarget,
          anchor,
          reason: 'missing-file',
        });
        continue;
      }

      if (anchor && !hasAnchor(targetAbs, anchor)) {
        issues.push({
          specPath: normalizedSource,
          href,
          targetPath: normalizedTarget,
          anchor,
          reason: 'missing-anchor',
        });
      }
    }
  }

  return issues.sort((a, b) => {
    const left = `${a.specPath}:${a.href}`;
    const right = `${b.specPath}:${b.href}`;
    return left.localeCompare(right);
  });
}

function walkMarkdownFiles(dir: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
}

function hasAnchor(filePath: string, anchor: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.includes(`id="${anchor}"`) || content.includes(`name="${anchor}"`);
}

function groupDanglingLinksBySpec(
  danglingLinks: DanglingLinkEntry[],
): Map<string, DanglingLinkEntry[]> {
  const grouped = new Map<string, DanglingLinkEntry[]>();
  for (const issue of danglingLinks) {
    if (!grouped.has(issue.specPath)) {
      grouped.set(issue.specPath, []);
    }
    grouped.get(issue.specPath)!.push(issue);
  }
  return grouped;
}

function summarizeLevelCoverage(moduleCoverage: ModuleCoverageEntry[]): LevelCoverageEntry[] {
  const levels = new Map<number, LevelCoverageEntry>();

  for (const entry of moduleCoverage) {
    if (!levels.has(entry.level)) {
      levels.set(entry.level, {
        level: entry.level,
        total: 0,
        documented: 0,
        missingDoc: 0,
        attention: 0,
      });
    }
    const levelEntry = levels.get(entry.level)!;
    levelEntry.total += 1;
    if (entry.status === 'documented') levelEntry.documented += 1;
    if (entry.status === 'missing-doc') levelEntry.missingDoc += 1;
    if (entry.status === 'attention') levelEntry.attention += 1;
  }

  return [...levels.values()].sort((a, b) => a.level - b.level);
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function issuePrioritySort(left: CoverageIssue, right: CoverageIssue): number {
  const order: CoverageIssue[] = [
    'missing-doc',
    'dangling-links',
    'missing-links',
    'low-confidence',
  ];
  return order.indexOf(left) - order.indexOf(right);
}

function normalizeProjectPath(inputPath: string, projectRoot: string): string {
  const relative = path.isAbsolute(inputPath)
    ? path.relative(projectRoot, inputPath)
    : inputPath;
  return relative.split(path.sep).join('/');
}
