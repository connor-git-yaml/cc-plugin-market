import { describe, expect, it } from 'vitest';
import { adaptArchitectureNarrativeProvenance } from '../../src/panoramic/narrative-provenance-adapter.js';
import type { ArchitectureNarrativeOutput } from '../../src/panoramic/architecture-narrative.js';

describe('adaptArchitectureNarrativeProvenance', () => {
  it('将 architecture-narrative 包装为 section-level provenance records', () => {
    const narrative: ArchitectureNarrativeOutput = {
      title: '技术架构说明: sample-app',
      generatedAt: '2026-03-21',
      projectName: 'sample-app',
      executiveSummary: ['系统通过 query client 与 transport 层交互。'],
      repositoryMap: [],
      keyModules: [
        {
          sourceTarget: 'src/query/client.ts',
          displayName: 'client.ts',
          role: 'core',
          relatedFiles: ['src/query/client.ts'],
          confidence: 'high',
          intentSummary: '负责查询与请求编排。',
          businessSummary: '协调 transport 与 parser。',
          dependencySummary: '依赖 transport/client.ts。',
          keySymbols: [],
          keyMethods: [],
          inferred: false,
        },
      ],
      keySymbols: [
        {
          moduleName: 'src/query/client.ts',
          name: 'QueryClient',
          kind: 'class',
          signature: 'class QueryClient',
          note: '主查询入口',
          inferred: false,
        },
      ],
      keyMethods: [
        {
          moduleName: 'src/query/client.ts',
          ownerName: 'QueryClient',
          name: 'query',
          kind: 'method',
          signature: 'query(input: string)',
          note: '发起主请求',
          inferred: true,
        },
      ],
      observations: ['模块边界清晰，但 transport 仍有低置信推断。'],
      supportingDocs: [
        {
          generatorId: 'architecture-overview',
          title: 'Architecture Overview',
          path: 'specs/architecture-overview.md',
        },
      ],
    };

    const record = adaptArchitectureNarrativeProvenance(narrative, {
      projectRoot: '/workspace/project',
      outputDir: '/workspace/project/specs',
    });

    expect(record.documentId).toBe('architecture-narrative');
    expect(record.sourcePath).toBe('specs/architecture-narrative.md');
    expect(record.available).toBe(true);
    expect(record.sections.map((section) => section.id)).toEqual([
      'executive-summary',
      'key-modules',
      'key-symbols',
      'observations',
    ]);
    expect(record.sourceTypes).toEqual(expect.arrayContaining(['spec', 'code', 'generated-doc']));
    expect(record.sections.find((section) => section.id === 'key-modules')?.entries[0]).toMatchObject({
      sourceType: 'spec',
      originType: 'stored-module-spec',
      ref: 'src/query/client.ts',
    });
    expect(record.sections.find((section) => section.id === 'key-symbols')?.entries[1]).toMatchObject({
      sourceType: 'code',
      inferred: true,
    });
  });
});
