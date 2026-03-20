/**
 * panoramic 项目级文档输出文件名映射
 *
 * 统一 batch 项目级编排、coverage audit 与 CLI 摘要使用的命名口径。
 * `mock-readme` 仅作为接口设计验证，不纳入 batch 正式项目文档集合。
 */

const BATCH_PROJECT_OUTPUT_BASE_NAMES: Record<string, string> = {
  'config-reference': 'config-reference',
  'data-model': 'data-model',
  'workspace-index': 'workspace-index',
  'cross-package-deps': 'cross-package-analysis',
  'api-surface': 'api-surface',
  'runtime-topology': 'runtime-topology',
  'architecture-overview': 'architecture-overview',
  'pattern-hints': 'pattern-hints',
  'event-surface': 'event-surface',
  'troubleshooting': 'troubleshooting',
};

export type BatchProjectGeneratorId = keyof typeof BATCH_PROJECT_OUTPUT_BASE_NAMES;

export function isBatchProjectGeneratorId(generatorId: string): generatorId is BatchProjectGeneratorId {
  return generatorId in BATCH_PROJECT_OUTPUT_BASE_NAMES;
}

export function getBatchProjectOutputBaseName(generatorId: string): string {
  return BATCH_PROJECT_OUTPUT_BASE_NAMES[generatorId] ?? generatorId;
}

export function getBatchProjectOutputFileName(generatorId: string): string {
  return `${getBatchProjectOutputBaseName(generatorId)}.md`;
}

export function listBatchProjectGeneratorIds(): BatchProjectGeneratorId[] {
  return Object.keys(BATCH_PROJECT_OUTPUT_BASE_NAMES) as BatchProjectGeneratorId[];
}
