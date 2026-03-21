/**
 * Docs bundle manifest reader
 *
 * 059 只做 055 manifest 的轻量读取与降级，不重做 bundle orchestration。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseYamlDocument,
  type YamlArray,
  type YamlObject,
  type YamlValue,
} from './parsers/yaml-config-parser.js';

export interface BundleNavigationReference {
  title: string;
  path?: string;
  children: BundleNavigationReference[];
}

export interface BundleProfileReference {
  id: string;
  title: string;
  rootDir?: string;
  docsRoot?: string;
  landingPagePath?: string;
  documentIds: string[];
  navigation: BundleNavigationReference[];
}

export interface DocsBundleManifestReference {
  sourcePath: string;
  version?: number;
  generatedAt?: string;
  profiles: BundleProfileReference[];
}

export interface ReadDocsBundleManifestResult {
  manifest?: DocsBundleManifestReference;
  warnings: string[];
}

const CANDIDATE_MANIFEST_NAMES = ['docs-bundle.yaml', 'docs-bundle.yml'] as const;

export function readDocsBundleManifest(
  outputDir: string,
  projectRoot?: string,
): ReadDocsBundleManifestResult {
  const warnings: string[] = [];

  const manifestPath = CANDIDATE_MANIFEST_NAMES
    .map((fileName) => path.join(outputDir, fileName))
    .find((candidatePath) => fs.existsSync(candidatePath));

  if (!manifestPath) {
    return {
      manifest: undefined,
      warnings: ['未找到 docs-bundle manifest，将以 partial 模式降级 required-doc 的发布覆盖校验。'],
    };
  }

  try {
    const parsed = parseYamlDocument(fs.readFileSync(manifestPath, 'utf-8'));
    const profiles = readProfileReferences(parsed.profiles);

    if (profiles.length === 0) {
      warnings.push('docs-bundle manifest 已存在，但未解析到有效 profile。');
    }

    return {
      manifest: {
        sourcePath: normalizeProjectPath(manifestPath, projectRoot),
        version: asNumber(parsed.version),
        generatedAt: asString(parsed.generatedAt),
        profiles,
      },
      warnings,
    };
  } catch (error) {
    return {
      manifest: undefined,
      warnings: [`docs-bundle manifest 读取失败: ${String(error)}`],
    };
  }
}

function readProfileReferences(value: YamlValue | undefined): BundleProfileReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (isYamlObject(entry) ? entry : undefined))
    .filter((entry): entry is YamlObject => Boolean(entry))
    .map((entry) => ({
      id: asString(entry.id) ?? 'unknown',
      title: asString(entry.title) ?? asString(entry.id) ?? 'Unknown Profile',
      rootDir: asString(entry.rootDir),
      docsRoot: asString(entry.docsRoot),
      landingPagePath: asString(entry.landingPagePath),
      documentIds: readDocumentIds(entry.documents),
      navigation: readNavigation(entry.navigation),
    }));
}

function readDocumentIds(value: YamlValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (isYamlObject(entry) ? asString(entry.sourceId) : undefined))
    .filter((entry): entry is string => Boolean(entry))
    .sort((left, right) => left.localeCompare(right));
}

function readNavigation(value: YamlValue | undefined): BundleNavigationReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readNavigationNode(entry))
    .filter((entry): entry is BundleNavigationReference => Boolean(entry));
}

function readNavigationNode(value: YamlValue): BundleNavigationReference | undefined {
  if (!isYamlObject(value)) {
    return undefined;
  }

  return {
    title: asString(value.title) ?? 'Untitled',
    path: asString(value.path),
    children: readNavigation(value.children),
  };
}

function asString(value: YamlValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: YamlValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isYamlObject(value: YamlValue | undefined): value is YamlObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProjectPath(candidatePath: string, projectRoot?: string): string {
  if (!projectRoot) {
    return candidatePath.split(path.sep).join('/');
  }

  const relative = path.relative(projectRoot, candidatePath);
  return relative.startsWith('..')
    ? candidatePath.split(path.sep).join('/')
    : relative.split(path.sep).join('/');
}
