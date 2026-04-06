/**
 * docs bundle 共享类型
 *
 * 055 只负责“把既有文档组织成交付包”，不重新生成事实。
 * 这些类型因此聚焦于文档清单、profile 和导航，而不包含站点框架实现细节。
 */

export const DOCS_BUNDLE_VERSION = 1 as const;
export const DOCS_BUNDLE_MANIFEST_FILE = 'docs-bundle.yaml' as const;
export const DOCS_BUNDLE_ROOT_DIR = 'bundles' as const;

export type SourceDocumentKind = 'project-doc' | 'index-spec';
export type BundleDocumentKind = 'landing' | 'project-doc' | 'index-spec' | 'module-spec';

export type BundleProfileId =
  | 'developer-onboarding'
  | 'architecture-review'
  | 'api-consumer'
  | 'ops-handover';

export interface SourceDocument {
  id: string;
  title: string;
  kind: SourceDocumentKind;
  generatorId?: string;
  sourcePath: string;
  relativePath: string;
  description?: string;
}

export interface ModuleSpecDocument {
  moduleName: string;
  title: string;
  sourcePath: string;
  relativePath: string;
  bundlePath: string;
}

export interface DocsBundleInput {
  projectRoot: string;
  outputDir: string;
  projectDocs: SourceDocument[];
  moduleSpecs: ModuleSpecDocument[];
  indexSpec?: SourceDocument;
}

export interface BundleProfileDefinition {
  id: BundleProfileId;
  title: string;
  description: string;
  coreDocumentIds: string[];
  includeModuleSpecs: boolean;
  moduleSpecsSectionTitle?: string;
}

export interface BundleDocument {
  sourceId: string;
  title: string;
  sourcePath: string;
  outputPath: string;
  navPath: string;
  order: number;
  kind: BundleDocumentKind;
  optional: boolean;
  description?: string;
}

export interface BundleNavItem {
  title: string;
  path?: string;
  children?: BundleNavItem[];
}

export interface BundleProfileManifest {
  id: BundleProfileId;
  title: string;
  description: string;
  rootDir: string;
  docsRoot: string;
  mkdocsConfigPath: string;
  landingPagePath: string;
  documents: BundleDocument[];
  navigation: BundleNavItem[];
  warnings: string[];
}

export interface DocsBundleManifest {
  version: typeof DOCS_BUNDLE_VERSION;
  generatedAt: string;
  outputDir: string;
  profiles: BundleProfileManifest[];
  sourceInventory: SourceDocument[];
  moduleSpecCount: number;
}

export interface DocsBundleProfileSummary {
  id: BundleProfileId;
  title: string;
  rootDir: string;
  documentCount: number;
  warningCount: number;
}

export interface DocsBundleResult {
  manifestPath: string;
  manifest: DocsBundleManifest;
  profileRoots: string[];
  profiles: DocsBundleProfileSummary[];
  warnings: string[];
}
