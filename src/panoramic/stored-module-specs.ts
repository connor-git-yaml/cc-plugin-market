/**
 * Stored module spec helpers
 *
 * 统一读取 batch 已生成的 module specs，并提取 frontmatter、章节摘要和 baseline skeleton。
 * 该 helper 同时供 architecture-narrative 与 Feature 057 的组件/动态链路构建复用。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodeSkeleton } from '../models/code-skeleton.js';

export interface StoredModuleSpecRecord {
  sourceTarget: string;
  relatedFiles: string[];
  confidence: 'high' | 'medium' | 'low';
  intentSummary: string;
  businessSummary: string;
  dependencySummary: string;
  baselineSkeleton?: CodeSkeleton;
}

interface SpecFrontmatter {
  type?: string;
  sourceTarget?: string;
  confidence?: 'high' | 'medium' | 'low';
  relatedFiles: string[];
}

export function loadStoredModuleSpecs(
  outputDir: string,
  projectRoot: string,
): StoredModuleSpecRecord[] {
  if (!fs.existsSync(outputDir)) {
    return [];
  }

  const markdownSpecFiles: string[] = [];
  walkStoredSpecFiles(outputDir, markdownSpecFiles);

  return markdownSpecFiles
    .map((filePath) => parseStoredModuleSpec(filePath, projectRoot))
    .filter((item): item is StoredModuleSpecRecord => item !== null)
    .sort((left, right) => left.sourceTarget.localeCompare(right.sourceTarget));
}

export function parseStoredModuleSpec(
  filePath: string,
  projectRoot: string,
): StoredModuleSpecRecord | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const frontmatter = extractStoredSpecFrontmatter(content);
  if (!frontmatter || frontmatter.type !== 'module-spec' || !frontmatter.sourceTarget) {
    return null;
  }

  return {
    sourceTarget: normalizeStoredProjectPath(frontmatter.sourceTarget, projectRoot),
    relatedFiles: frontmatter.relatedFiles.map((item) => normalizeStoredProjectPath(item, projectRoot)),
    confidence: frontmatter.confidence ?? 'medium',
    intentSummary: extractStoredSpecSectionSummary(content, 1, frontmatter.sourceTarget),
    businessSummary: extractStoredSpecSectionSummary(content, 3, `${frontmatter.sourceTarget} 的业务逻辑以模块职责为中心组织`),
    dependencySummary: extractStoredSpecSectionSummary(content, 9, `${frontmatter.sourceTarget} 的依赖关系未在既有 spec 中显式描述`),
    baselineSkeleton: extractStoredBaselineSkeleton(content),
  };
}

export function extractStoredSpecFrontmatter(content: string): SpecFrontmatter | null {
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

export function extractStoredSpecSectionSummary(
  content: string,
  sectionNumber: number,
  fallback: string,
): string {
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

  return summarizeStoredMarkdown(remainder.slice(0, end), fallback);
}

export function summarizeStoredMarkdown(content: string, fallback: string): string {
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

export function extractStoredBaselineSkeleton(content: string): CodeSkeleton | undefined {
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

export function normalizeStoredProjectPath(inputPath: string, projectRoot: string): string {
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(projectRoot, inputPath);
  const rel = path.relative(projectRoot, absolutePath);
  return rel.startsWith('..') ? inputPath.split(path.sep).join('/') : rel.split(path.sep).join('/');
}

export function stripYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function walkStoredSpecFiles(dir: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkStoredSpecFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.spec.md') && !entry.name.startsWith('_')) {
      results.push(fullPath);
    }
  }
}
