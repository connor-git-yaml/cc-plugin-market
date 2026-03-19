/**
 * DocGraphBuilder
 * 汇总当前批量生成的 ModuleSpec、既有 spec 文件以及文件级依赖图，
 * 产出源码 -> spec -> 交叉引用 -> 缺口的统一图谱。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DependencyGraph } from '../models/dependency-graph.js';
import type { ModuleSpec } from '../models/module-spec.js';

export const MODULE_SPEC_ANCHOR_ID = 'module-spec';
export const CROSS_REFERENCE_MARKER_PREFIX = '<!-- cross-reference-index: auto';

export interface ExistingSpecDocument {
  specPath: string;
  sourceTarget: string;
  relatedFiles: string[];
  linked: boolean;
}

export interface DocGraphSpecNode {
  specPath: string;
  sourceTarget: string;
  relatedFiles: string[];
  linked: boolean;
  currentRun: boolean;
}

export interface DocGraphSourceToSpec {
  sourcePath: string;
  specPath: string;
  sourceTarget: string;
  matchType: 'source-target' | 'related-file';
}

export interface DocGraphReferenceSample {
  fromSource: string;
  toSource: string;
}

export interface DocGraphReference {
  kind: 'same-module' | 'cross-module';
  fromSpecPath: string;
  toSpecPath: string;
  fromSourceTarget: string;
  toSourceTarget: string;
  evidenceCount: number;
  evidenceSamples: DocGraphReferenceSample[];
}

export interface DocGraphMissingSpec {
  sourcePath: string;
  reason: 'no-spec-owner';
}

export interface DocGraphUnlinkedSpec {
  specPath: string;
  sourceTarget: string;
}

export interface DocGraph {
  projectRoot: string;
  generatedAt: string;
  specs: DocGraphSpecNode[];
  sourceToSpec: DocGraphSourceToSpec[];
  references: DocGraphReference[];
  missingSpecs: DocGraphMissingSpec[];
  unlinkedSpecs: DocGraphUnlinkedSpec[];
}

export interface BuildDocGraphOptions {
  projectRoot: string;
  dependencyGraph: DependencyGraph;
  moduleSpecs: ModuleSpec[];
  existingSpecs?: ExistingSpecDocument[];
}

/**
 * 扫描输出目录下的既有 *.spec.md，仅提取 044 所需最小元数据。
 */
export function scanExistingSpecDocuments(
  specsDir: string,
  projectRoot: string,
): ExistingSpecDocument[] {
  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const specFiles: string[] = [];
  walkSpecFiles(specsDir, specFiles);

  return specFiles
    .map((filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const metadata = extractModuleSpecMetadata(content);
      if (!metadata) {
        return null;
      }

      return {
        specPath: normalizeProjectPath(filePath, projectRoot),
        sourceTarget: normalizeProjectPath(metadata.sourceTarget, projectRoot),
        relatedFiles: metadata.relatedFiles.map((item) => normalizeProjectPath(item, projectRoot)),
        linked: content.includes(CROSS_REFERENCE_MARKER_PREFIX),
      } satisfies ExistingSpecDocument;
    })
    .filter((item): item is ExistingSpecDocument => item !== null)
    .sort((a, b) => a.specPath.localeCompare(b.specPath));
}

/**
 * 构建统一 DocGraph。
 */
export function buildDocGraph(options: BuildDocGraphOptions): DocGraph {
  const { projectRoot, dependencyGraph } = options;
  const currentSpecs = options.moduleSpecs.map((moduleSpec) => ({
    specPath: normalizeProjectPath(moduleSpec.outputPath, projectRoot),
    sourceTarget: normalizeProjectPath(moduleSpec.frontmatter.sourceTarget, projectRoot),
    relatedFiles: dedupePaths(
      moduleSpec.frontmatter.relatedFiles.map((item) => normalizeProjectPath(item, projectRoot)),
    ),
    linked: true,
    currentRun: true,
  } satisfies DocGraphSpecNode));

  const specMap = new Map<string, DocGraphSpecNode>();
  for (const spec of options.existingSpecs ?? []) {
    specMap.set(spec.specPath, {
      ...spec,
      relatedFiles: dedupePaths(spec.relatedFiles),
      currentRun: false,
    });
  }
  for (const spec of currentSpecs) {
    specMap.set(spec.specPath, spec);
  }

  const specs = [...specMap.values()].sort((a, b) => a.specPath.localeCompare(b.specPath));

  const sourceToSpec: DocGraphSourceToSpec[] = [];
  const sourceToSpecKey = new Set<string>();
  for (const spec of specs) {
    pushSourceToSpec(
      sourceToSpec,
      sourceToSpecKey,
      spec.sourceTarget,
      spec.specPath,
      spec.sourceTarget,
      'source-target',
    );
    for (const relatedFile of spec.relatedFiles) {
      pushSourceToSpec(
        sourceToSpec,
        sourceToSpecKey,
        relatedFile,
        spec.specPath,
        spec.sourceTarget,
        'related-file',
      );
    }
  }

  const references = buildReferenceList(specs, dependencyGraph);
  const missingSpecs = buildMissingSpecList(specs, dependencyGraph);
  const unlinkedSpecs = specs
    .filter((spec) => !spec.currentRun && !spec.linked)
    .map((spec) => ({
      specPath: spec.specPath,
      sourceTarget: spec.sourceTarget,
    }))
    .sort((a, b) => a.specPath.localeCompare(b.specPath));

  return {
    projectRoot,
    generatedAt: new Date().toISOString(),
    specs,
    sourceToSpec: sourceToSpec.sort((a, b) => {
      const left = `${a.sourcePath}:${a.specPath}:${a.matchType}`;
      const right = `${b.sourcePath}:${b.specPath}:${b.matchType}`;
      return left.localeCompare(right);
    }),
    references,
    missingSpecs,
    unlinkedSpecs,
  };
}

function buildReferenceList(
  specs: DocGraphSpecNode[],
  dependencyGraph: DependencyGraph,
): DocGraphReference[] {
  const aggregated = new Map<string, DocGraphReference>();

  for (const edge of dependencyGraph.edges) {
    const fromSpec = resolveSpecForSource(edge.from, specs);
    const toSpec = resolveSpecForSource(edge.to, specs);
    if (!fromSpec || !toSpec) {
      continue;
    }

    const kind = fromSpec.specPath === toSpec.specPath ? 'same-module' : 'cross-module';
    const key = `${kind}:${fromSpec.specPath}:${toSpec.specPath}`;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        kind,
        fromSpecPath: fromSpec.specPath,
        toSpecPath: toSpec.specPath,
        fromSourceTarget: fromSpec.sourceTarget,
        toSourceTarget: toSpec.sourceTarget,
        evidenceCount: 0,
        evidenceSamples: [],
      });
    }

    const entry = aggregated.get(key)!;
    entry.evidenceCount += 1;
    const duplicate = entry.evidenceSamples.some(
      (sample) => sample.fromSource === edge.from && sample.toSource === edge.to,
    );
    if (!duplicate && entry.evidenceSamples.length < 5) {
      entry.evidenceSamples.push({
        fromSource: edge.from,
        toSource: edge.to,
      });
    }
  }

  return [...aggregated.values()].sort((left, right) => {
    if (right.evidenceCount !== left.evidenceCount) {
      return right.evidenceCount - left.evidenceCount;
    }
    return `${left.fromSpecPath}:${left.toSpecPath}`.localeCompare(
      `${right.fromSpecPath}:${right.toSpecPath}`,
    );
  });
}

function buildMissingSpecList(
  specs: DocGraphSpecNode[],
  dependencyGraph: DependencyGraph,
): DocGraphMissingSpec[] {
  const missing = new Set<string>();

  for (const node of dependencyGraph.modules) {
    if (!resolveSpecForSource(node.source, specs)) {
      missing.add(node.source);
    }
  }

  return [...missing]
    .sort((a, b) => a.localeCompare(b))
    .map((sourcePath) => ({
      sourcePath,
      reason: 'no-spec-owner' as const,
    }));
}

function resolveSpecForSource(
  sourcePath: string,
  specs: DocGraphSpecNode[],
): DocGraphSpecNode | undefined {
  let bestMatch: { spec: DocGraphSpecNode; score: number } | undefined;

  for (const spec of specs) {
    const exactSourceTarget = spec.sourceTarget === sourcePath;
    const exactRelatedFile = spec.relatedFiles.includes(sourcePath);
    const prefixMatch = sourcePath.startsWith(`${spec.sourceTarget}/`);
    if (!exactSourceTarget && !exactRelatedFile && !prefixMatch) {
      continue;
    }

    let score = spec.sourceTarget.length;
    if (prefixMatch) score += 1_000;
    if (exactRelatedFile) score += 2_000;
    if (exactSourceTarget) score += 3_000;
    if (spec.currentRun) score += 10;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { spec, score };
    }
  }

  return bestMatch?.spec;
}

function pushSourceToSpec(
  target: DocGraphSourceToSpec[],
  seen: Set<string>,
  sourcePath: string,
  specPath: string,
  sourceTarget: string,
  matchType: 'source-target' | 'related-file',
): void {
  const key = `${sourcePath}:${specPath}:${matchType}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push({
    sourcePath,
    specPath,
    sourceTarget,
    matchType,
  });
}

function extractModuleSpecMetadata(content: string): {
  sourceTarget: string;
  relatedFiles: string[];
} | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(content);
  if (!match?.[1]) {
    return null;
  }

  const lines = match[1].split(/\r?\n/);
  let typeValue: string | undefined;
  let sourceTarget: string | undefined;
  const relatedFiles: string[] = [];
  let inRelatedFiles = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('type:')) {
      typeValue = stripYamlScalar(line.slice('type:'.length).trim());
      inRelatedFiles = false;
      continue;
    }

    if (line.startsWith('sourceTarget:')) {
      sourceTarget = stripYamlScalar(line.slice('sourceTarget:'.length).trim());
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

  if (typeValue !== 'module-spec' || !sourceTarget) {
    return null;
  }

  return {
    sourceTarget,
    relatedFiles,
  };
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

function walkSpecFiles(dir: string, results: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSpecFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.spec.md')) {
      results.push(fullPath);
    }
  }
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function normalizeProjectPath(inputPath: string, projectRoot: string): string {
  const relative = path.isAbsolute(inputPath)
    ? path.relative(projectRoot, inputPath)
    : inputPath;
  return relative.split(path.sep).join('/');
}
