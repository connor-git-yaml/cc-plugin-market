/**
 * docs-bundle-orchestrator
 *
 * 在 batch 既有输出之上组织 audience-oriented documentation bundles。
 * 055 只复制和编排 markdown 输出，不重新抽取项目事实。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listBatchProjectGeneratorIds, getBatchProjectOutputBaseName } from './output-filenames.js';
import {
  DOCS_BUNDLE_VERSION,
  DOCS_BUNDLE_MANIFEST_FILE,
  DOCS_BUNDLE_ROOT_DIR,
  type BundleDocument,
  type BundleNavItem,
  type BundleProfileDefinition,
  type BundleProfileManifest,
  type DocsBundleInput,
  type DocsBundleManifest,
  type DocsBundleProfileSummary,
  type DocsBundleResult,
  type ModuleSpecDocument,
  type SourceDocument,
} from './docs-bundle-types.js';
import { listDocsBundleProfiles } from './docs-bundle-profiles.js';
import { loadTemplate } from './utils/template-loader.js';

const INDEX_SPEC_ID = '_index.spec';
const INDEX_SPEC_FILE = '_index.spec.md';
const ARCHITECTURE_NARRATIVE_ID = 'architecture-narrative';
const BUNDLE_NAV_HOME_TITLE = 'Home';

const PROJECT_DOC_METADATA: Record<string, { title: string; description: string; relativePath?: string }> = {
  'product-overview': {
    title: 'Product Overview',
    description: '产品定位、目标用户、核心场景与关键任务流摘要。',
    relativePath: 'product-overview.md',
  },
  'user-journeys': {
    title: 'User Journeys',
    description: '从用户目标到关键步骤的旅程说明。',
    relativePath: 'user-journeys.md',
  },
  'feature-briefs/index': {
    title: 'Feature Briefs',
    description: '围绕 issue/PR 或 current-spec 派生的 feature brief 集合。',
    relativePath: 'feature-briefs/index.md',
  },
  'api-surface': {
    title: 'API Surface',
    description: '接口入口、路径、请求/响应与参数摘要。',
    relativePath: 'api-surface.md',
  },
  'interface-surface': {
    title: 'Interface Surface',
    description: '公开入口、关键类、公开函数与关键方法摘要。',
    relativePath: 'interface-surface.md',
  },
  'architecture-narrative': {
    title: 'Architecture Narrative',
    description: '面向人类阅读的系统叙事与关键模块说明。',
    relativePath: 'architecture-narrative.md',
  },
  'architecture-overview': {
    title: 'Architecture Overview',
    description: 'system context / deployment / layered 结构总览。',
    relativePath: 'architecture-overview.md',
  },
  'component-view': {
    title: 'Component View',
    description: '关键组件、边界、职责与核心关系视图。',
    relativePath: 'component-view.md',
  },
  'config-reference': {
    title: 'Config Reference',
    description: '配置项、环境变量与默认值参考。',
    relativePath: 'config-reference.md',
  },
  'cross-package-analysis': {
    title: 'Cross-Package Analysis',
    description: '跨包依赖拓扑、关键包关系与循环提示。',
    relativePath: 'cross-package-analysis.md',
  },
  'data-model': {
    title: 'Data Model',
    description: '关键实体、字段与数据结构摘要。',
    relativePath: 'data-model.md',
  },
  'docs/adr/index': {
    title: 'ADR Index',
    description: '架构决策草稿与索引入口。',
    relativePath: 'docs/adr/index.md',
  },
  'dynamic-scenarios': {
    title: 'Dynamic Scenarios',
    description: '关键运行时场景、参与者与步骤链路。',
    relativePath: 'dynamic-scenarios.md',
  },
  'event-surface': {
    title: 'Event Surface',
    description: '事件、通道、状态附录与消息流摘要。',
    relativePath: 'event-surface.md',
  },
  'pattern-hints': {
    title: 'Pattern Hints',
    description: '架构模式提示、证据链与替代方案。',
    relativePath: 'pattern-hints.md',
  },
  'runtime-topology': {
    title: 'Runtime Topology',
    description: '服务、镜像、容器、端口、卷与运行时依赖。',
    relativePath: 'runtime-topology.md',
  },
  'troubleshooting': {
    title: 'Troubleshooting',
    description: '运行与集成问题排查入口。',
    relativePath: 'troubleshooting.md',
  },
  'workspace-index': {
    title: 'Workspace Index',
    description: 'workspace / package 结构与依赖视图。',
    relativePath: 'workspace-index.md',
  },
  [INDEX_SPEC_ID]: {
    title: 'Architecture Index',
    description: '模块级 spec 的全局索引入口。',
    relativePath: INDEX_SPEC_FILE,
  },
};

interface OrchestratorPaths {
  projectRoot: string;
  outputDir: string;
  outputDirRelative: string;
}

interface DocsBundleLandingContext {
  profileId: string;
  title: string;
  description: string;
  generatedAt: string;
  readingPath: BundleDocument[];
  moduleDocs: BundleDocument[];
  warnings: string[];
}

export interface OrchestrateDocsBundleOptions {
  projectRoot: string;
  outputDir: string;
}

export function orchestrateDocsBundle(
  options: OrchestrateDocsBundleOptions,
): DocsBundleResult {
  const paths = resolvePaths(options);
  const input = buildDocsBundleInput(paths);
  const generatedAt = new Date().toISOString();
  const profiles = listDocsBundleProfiles().map((definition) => buildProfileManifest(definition, input, paths));
  const manifest: DocsBundleManifest = {
    version: DOCS_BUNDLE_VERSION,
    generatedAt,
    outputDir: paths.outputDirRelative,
    profiles,
    sourceInventory: [
      ...input.projectDocs,
      ...(input.indexSpec ? [input.indexSpec] : []),
    ],
    moduleSpecCount: input.moduleSpecs.length,
  };

  writeProfiles(profiles, generatedAt, paths);

  const manifestPathAbs = path.join(paths.outputDir, DOCS_BUNDLE_MANIFEST_FILE);
  fs.writeFileSync(manifestPathAbs, stringifyYaml(manifest), 'utf-8');

  const profileSummaries = profiles.map((profile) => toProfileSummary(profile));
  const warnings = profiles.flatMap((profile) => profile.warnings);

  return {
    manifestPath: toProjectPath(paths.projectRoot, manifestPathAbs),
    manifest,
    profileRoots: profiles.map((profile) => profile.rootDir),
    profiles: profileSummaries,
    warnings,
  };
}

export function buildDocsBundleInput(paths: OrchestratorPaths): DocsBundleInput {
  const projectDocs = collectProjectDocs(paths);
  const moduleSpecs = collectModuleSpecs(paths);
  const indexSpec = collectIndexSpec(paths);

  return {
    projectRoot: paths.projectRoot,
    outputDir: paths.outputDir,
    projectDocs,
    moduleSpecs,
    indexSpec,
  };
}

function resolvePaths(options: OrchestrateDocsBundleOptions): OrchestratorPaths {
  const projectRoot = path.resolve(options.projectRoot);
  const outputDir = path.resolve(options.outputDir);

  return {
    projectRoot,
    outputDir,
    outputDirRelative: toProjectPath(projectRoot, outputDir),
  };
}

function collectProjectDocs(paths: OrchestratorPaths): SourceDocument[] {
  const docs: SourceDocument[] = [];
  const seen = new Set<string>();

  for (const generatorId of listBatchProjectGeneratorIds()) {
    const baseName = getBatchProjectOutputBaseName(generatorId);
    const sourcePathAbs = path.join(paths.outputDir, `${baseName}.md`);
    if (!fs.existsSync(sourcePathAbs)) {
      continue;
    }

    const metadata = PROJECT_DOC_METADATA[baseName] ?? {
      title: humanizeDocumentId(baseName),
      description: 'Project-level generated document.',
    };

    docs.push({
      id: baseName,
      title: metadata.title,
      kind: 'project-doc',
      generatorId,
      sourcePath: toProjectPath(paths.projectRoot, sourcePathAbs),
      relativePath: toProjectPath(paths.projectRoot, sourcePathAbs),
      description: metadata.description,
    });
    seen.add(baseName);
  }

  const architectureNarrativeAbs = path.join(paths.outputDir, `${ARCHITECTURE_NARRATIVE_ID}.md`);
  if (!seen.has(ARCHITECTURE_NARRATIVE_ID) && fs.existsSync(architectureNarrativeAbs)) {
    const metadata = PROJECT_DOC_METADATA[ARCHITECTURE_NARRATIVE_ID] ?? {
      title: humanizeDocumentId(ARCHITECTURE_NARRATIVE_ID),
      description: 'Project-level generated document.',
    };
    docs.push({
      id: ARCHITECTURE_NARRATIVE_ID,
      title: metadata.title,
      kind: 'project-doc',
      generatorId: ARCHITECTURE_NARRATIVE_ID,
      sourcePath: toProjectPath(paths.projectRoot, architectureNarrativeAbs),
      relativePath: toProjectPath(paths.projectRoot, architectureNarrativeAbs),
      description: metadata.description,
    });
  }

  for (const [docId, metadata] of Object.entries(PROJECT_DOC_METADATA)) {
    if (seen.has(docId) || docId === INDEX_SPEC_ID || docId === ARCHITECTURE_NARRATIVE_ID) {
      continue;
    }
    const relativePath = metadata.relativePath ?? `${docId}.md`;
    const sourcePathAbs = path.join(paths.outputDir, relativePath);
    if (!fs.existsSync(sourcePathAbs)) {
      continue;
    }
    docs.push({
      id: docId,
      title: metadata.title,
      kind: 'project-doc',
      generatorId: docId,
      sourcePath: toProjectPath(paths.projectRoot, sourcePathAbs),
      relativePath: toProjectPath(paths.projectRoot, sourcePathAbs),
      description: metadata.description,
    });
    seen.add(docId);
  }

  return docs.sort((left, right) => left.id.localeCompare(right.id));
}

function collectIndexSpec(paths: OrchestratorPaths): SourceDocument | undefined {
  const sourcePathAbs = path.join(paths.outputDir, INDEX_SPEC_FILE);
  if (!fs.existsSync(sourcePathAbs)) {
    return undefined;
  }

  const metadata = PROJECT_DOC_METADATA[INDEX_SPEC_ID] ?? {
    title: humanizeDocumentId(INDEX_SPEC_ID),
    description: 'Project-level generated document.',
  };
  return {
    id: INDEX_SPEC_ID,
    title: metadata.title,
    kind: 'index-spec',
    sourcePath: toProjectPath(paths.projectRoot, sourcePathAbs),
    relativePath: toProjectPath(paths.projectRoot, sourcePathAbs),
    description: metadata.description,
  };
}

function collectModuleSpecs(paths: OrchestratorPaths): ModuleSpecDocument[] {
  const results: ModuleSpecDocument[] = [];
  walkModuleSpecs(paths.outputDir, paths.projectRoot, results);
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function walkModuleSpecs(dir: string, projectRoot: string, results: ModuleSpecDocument[]): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === DOCS_BUNDLE_ROOT_DIR) {
        continue;
      }
      walkModuleSpecs(fullPath, projectRoot, results);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.spec.md') || entry.name === INDEX_SPEC_FILE) {
      continue;
    }

    const relativePath = toProjectPath(projectRoot, fullPath);
    const fileName = path.basename(fullPath);
    results.push({
      moduleName: fileName.replace(/\.spec\.md$/, ''),
      title: fileName.replace(/\.md$/, ''),
      sourcePath: relativePath,
      relativePath,
      bundlePath: path.posix.join('modules', fileName),
    });
  }
}

function buildProfileManifest(
  definition: BundleProfileDefinition,
  input: DocsBundleInput,
  paths: OrchestratorPaths,
): BundleProfileManifest {
  const rootDirAbs = path.join(paths.outputDir, DOCS_BUNDLE_ROOT_DIR, definition.id);
  const docsRootAbs = path.join(rootDirAbs, 'docs');
  const mkdocsConfigAbs = path.join(rootDirAbs, 'mkdocs.yml');
  const landingPageAbs = path.join(docsRootAbs, 'index.md');

  const documents: BundleDocument[] = [];
  const warnings: string[] = [];
  const navigation: BundleNavItem[] = [{ title: BUNDLE_NAV_HOME_TITLE, path: 'index.md' }];
  const projectDocsById = new Map(input.projectDocs.map((doc) => [doc.id, doc]));

  documents.push({
    sourceId: `${definition.id}:index`,
    title: definition.title,
    sourcePath: '',
    outputPath: toProjectPath(paths.projectRoot, landingPageAbs),
    navPath: 'index.md',
    order: 0,
    kind: 'landing',
    optional: false,
    description: definition.description,
  });

  let order = 1;
  for (const sourceId of definition.coreDocumentIds) {
    const sourceDoc = projectDocsById.get(sourceId);
    if (!sourceDoc) {
      warnings.push(`缺少源文档: ${sourceId}`);
      continue;
    }

    const document = toBundleDocument(sourceDoc, definition, paths, order);
    documents.push(document);
    navigation.push({ title: document.title, path: document.navPath });
    order += 1;
  }

  if (definition.includeModuleSpecs) {
    const moduleChildren: BundleNavItem[] = [];

    if (input.indexSpec) {
      const indexDocument = toIndexSpecBundleDocument(input.indexSpec, definition, paths, order);
      documents.push(indexDocument);
      moduleChildren.push({ title: indexDocument.title, path: indexDocument.navPath });
      order += 1;
    } else {
      warnings.push('缺少源文档: _index.spec');
    }

    for (const moduleSpec of input.moduleSpecs) {
      const moduleDocument = toModuleSpecBundleDocument(moduleSpec, definition, paths, order);
      documents.push(moduleDocument);
      moduleChildren.push({ title: moduleDocument.title, path: moduleDocument.navPath });
      order += 1;
    }

    if (moduleChildren.length > 0) {
      navigation.push({
        title: definition.moduleSpecsSectionTitle ?? 'Module Specs',
        children: moduleChildren,
      });
    } else {
      warnings.push('未发现可纳入 bundle 的 module spec');
    }
  }

  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    rootDir: toProjectPath(paths.projectRoot, rootDirAbs),
    docsRoot: toProjectPath(paths.projectRoot, docsRootAbs),
    mkdocsConfigPath: toProjectPath(paths.projectRoot, mkdocsConfigAbs),
    landingPagePath: toProjectPath(paths.projectRoot, landingPageAbs),
    documents,
    navigation,
    warnings,
  };
}

function toBundleDocument(
  source: SourceDocument,
  definition: BundleProfileDefinition,
  paths: OrchestratorPaths,
  order: number,
): BundleDocument {
  const navPath = toBundleProjectDocNavPath(source, paths);
  const outputPathAbs = path.join(paths.outputDir, DOCS_BUNDLE_ROOT_DIR, definition.id, 'docs', navPath);

  return {
    sourceId: source.id,
    title: source.title,
    sourcePath: source.sourcePath,
    outputPath: toProjectPath(paths.projectRoot, outputPathAbs),
    navPath,
    order,
    kind: source.kind,
    optional: true,
    description: source.description,
  };
}

function toBundleProjectDocNavPath(source: SourceDocument, paths: OrchestratorPaths): string {
  const relativeToOutput = path.posix.relative(paths.outputDirRelative, source.relativePath);
  if (!relativeToOutput || relativeToOutput.startsWith('..')) {
    return path.posix.basename(source.relativePath);
  }
  return relativeToOutput;
}

function toIndexSpecBundleDocument(
  source: SourceDocument,
  definition: BundleProfileDefinition,
  paths: OrchestratorPaths,
  order: number,
): BundleDocument {
  const navPath = path.posix.join('modules', 'architecture-index.md');
  const outputPathAbs = path.join(paths.outputDir, DOCS_BUNDLE_ROOT_DIR, definition.id, 'docs', navPath);

  return {
    sourceId: source.id,
    title: source.title,
    sourcePath: source.sourcePath,
    outputPath: toProjectPath(paths.projectRoot, outputPathAbs),
    navPath,
    order,
    kind: source.kind,
    optional: true,
    description: source.description,
  };
}

function toModuleSpecBundleDocument(
  source: ModuleSpecDocument,
  definition: BundleProfileDefinition,
  paths: OrchestratorPaths,
  order: number,
): BundleDocument {
  const outputPathAbs = path.join(paths.outputDir, DOCS_BUNDLE_ROOT_DIR, definition.id, 'docs', source.bundlePath);

  return {
    sourceId: source.moduleName,
    title: source.title,
    sourcePath: source.sourcePath,
    outputPath: toProjectPath(paths.projectRoot, outputPathAbs),
    navPath: source.bundlePath,
    order,
    kind: 'module-spec',
    optional: true,
    description: `Module spec for ${source.moduleName}.`,
  };
}

function writeProfiles(
  profiles: BundleProfileManifest[],
  generatedAt: string,
  paths: OrchestratorPaths,
): void {
  for (const profile of profiles) {
    const rootDirAbs = path.join(paths.projectRoot, profile.rootDir);
    const docsRootAbs = path.join(paths.projectRoot, profile.docsRoot);

    fs.rmSync(rootDirAbs, { recursive: true, force: true });
    fs.mkdirSync(docsRootAbs, { recursive: true });

    for (const document of profile.documents) {
      if (document.kind === 'landing') {
        fs.writeFileSync(
          path.join(paths.projectRoot, document.outputPath),
          renderDocsBundleIndex(profile, generatedAt),
          'utf-8',
        );
        continue;
      }

      const sourcePathAbs = path.join(paths.projectRoot, document.sourcePath);
      const outputPathAbs = path.join(paths.projectRoot, document.outputPath);
      if (!fs.existsSync(sourcePathAbs)) {
        continue;
      }

      fs.mkdirSync(path.dirname(outputPathAbs), { recursive: true });
      fs.copyFileSync(sourcePathAbs, outputPathAbs);
    }

    const mkdocsPathAbs = path.join(paths.projectRoot, profile.mkdocsConfigPath);
    fs.writeFileSync(mkdocsPathAbs, renderMkdocsConfig(profile), 'utf-8');
  }
}

function renderDocsBundleIndex(profile: BundleProfileManifest, generatedAt: string): string {
  const template = loadTemplate('docs-bundle-index.hbs', import.meta.url);
  const readingPath = profile.documents.filter(
    (document) => document.kind !== 'landing' && document.kind !== 'module-spec' && document.kind !== 'index-spec',
  );
  const moduleDocs = profile.documents.filter(
    (document) => document.kind === 'module-spec' || document.kind === 'index-spec',
  );

  const context: DocsBundleLandingContext = {
    profileId: profile.id,
    title: profile.title,
    description: profile.description,
    generatedAt,
    readingPath,
    moduleDocs,
    warnings: profile.warnings,
  };

  return template(context);
}

function renderMkdocsConfig(profile: BundleProfileManifest): string {
  const nav = profile.navigation.map((item) => navItemToMkdocs(item));
  const config = {
    site_name: profile.title,
    site_description: profile.description,
    docs_dir: 'docs',
    nav,
  };

  return stringifyYaml(config);
}

function navItemToMkdocs(item: BundleNavItem): Record<string, unknown> {
  if (item.children && item.children.length > 0) {
    return {
      [item.title]: item.children.map((child) => navItemToMkdocs(child)),
    };
  }

  return {
    [item.title]: item.path ?? '',
  };
}

function toProfileSummary(profile: BundleProfileManifest): DocsBundleProfileSummary {
  return {
    id: profile.id,
    title: profile.title,
    rootDir: profile.rootDir,
    documentCount: profile.documents.length,
    warningCount: profile.warnings.length,
  };
}

function toProjectPath(projectRoot: string, targetPath: string): string {
  const relativePath = path.relative(projectRoot, targetPath);
  return relativePath.startsWith('..') ? targetPath : relativePath.split(path.sep).join('/');
}

function humanizeDocumentId(documentId: string): string {
  return documentId
    .replace(/^_/, '')
    .replace(/\.spec$/, '')
    .split(/[-_.]/)
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function stringifyYaml(value: unknown, indent = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${' '.repeat(indent)}[]`;
    }

    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${' '.repeat(indent)}- ${formatYamlScalar(item)}`;
        }

        const serialized = stringifyYaml(item, indent + 2).split('\n');
        const [firstLine = '', ...restLines] = serialized;
        return [
          `${' '.repeat(indent)}- ${firstLine.trimStart()}`,
          ...restLines,
        ].join('\n');
      })
      .join('\n');
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${' '.repeat(indent)}{}`;
    }

    return entries
      .map(([key, entryValue]) => {
        if (isScalar(entryValue)) {
          return `${' '.repeat(indent)}${key}: ${formatYamlScalar(entryValue)}`;
        }

        if (Array.isArray(entryValue) && entryValue.length === 0) {
          return `${' '.repeat(indent)}${key}: []`;
        }

        if (isPlainObject(entryValue) && Object.keys(entryValue).length === 0) {
          return `${' '.repeat(indent)}${key}: {}`;
        }

        return `${' '.repeat(indent)}${key}:\n${stringifyYaml(entryValue, indent + 2)}`;
      })
      .join('\n');
  }

  return `${' '.repeat(indent)}${formatYamlScalar(value)}`;
}

function formatYamlScalar(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
