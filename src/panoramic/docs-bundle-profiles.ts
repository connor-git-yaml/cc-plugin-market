import type { BundleProfileDefinition, BundleProfileId } from './docs-bundle-types.js';

/**
 * audience-oriented docs bundle profile definitions
 */
const PROFILE_DEFINITIONS: Record<BundleProfileId, BundleProfileDefinition> = {
  'developer-onboarding': {
    id: 'developer-onboarding',
    title: 'Developer Onboarding',
    description: '从系统叙事到运行时再到模块级 spec 的开发者阅读路径。',
    coreDocumentIds: [
      'architecture-narrative',
      'architecture-overview',
      'runtime-topology',
      'workspace-index',
      'config-reference',
    ],
    includeModuleSpecs: true,
    moduleSpecsSectionTitle: 'Module Specs',
  },
  'architecture-review': {
    id: 'architecture-review',
    title: 'Architecture Review',
    description: '优先呈现结构视图、模式判断和依赖链路，适合架构评审或设计复盘。',
    coreDocumentIds: [
      'architecture-overview',
      'pattern-hints',
      'architecture-narrative',
      'cross-package-analysis',
      'runtime-topology',
      'event-surface',
    ],
    includeModuleSpecs: true,
    moduleSpecsSectionTitle: 'Module Specs',
  },
  'api-consumer': {
    id: 'api-consumer',
    title: 'API Consumer',
    description: '面向接口使用者的接口、配置与数据模型阅读路径。',
    coreDocumentIds: [
      'api-surface',
      'config-reference',
      'data-model',
      'event-surface',
      'troubleshooting',
    ],
    includeModuleSpecs: false,
  },
  'ops-handover': {
    id: 'ops-handover',
    title: 'Ops Handover',
    description: '面向运维交接的运行时、排障与配置优先路径。',
    coreDocumentIds: [
      'runtime-topology',
      'troubleshooting',
      'config-reference',
      'architecture-overview',
      'event-surface',
    ],
    includeModuleSpecs: false,
  },
};

export function listDocsBundleProfiles(): BundleProfileDefinition[] {
  return Object.values(PROFILE_DEFINITIONS).map((definition) => ({
    ...definition,
    coreDocumentIds: [...definition.coreDocumentIds],
  }));
}

export function getDocsBundleProfile(profileId: BundleProfileId): BundleProfileDefinition {
  return {
    ...PROFILE_DEFINITIONS[profileId],
    coreDocumentIds: [...PROFILE_DEFINITIONS[profileId].coreDocumentIds],
  };
}
