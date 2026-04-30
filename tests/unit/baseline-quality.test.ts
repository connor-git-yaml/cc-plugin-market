import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface QualityModule {
  parseSpecStructure: (modulesDir: string) => {
    modulesWithIntent: number;
    modulesWithBehavior: number;
    modulesWithApi: number;
    modulesWithDataModel: number;
    modulesWithAllFour: number;
    modulesWithInputsOutputs: number;
    averageSpecLines: number;
    shorterThan100Lines: number;
    longerThan1000Lines: number;
    outlierFiles: string[];
    moduleCount: number;
  };
  parseGraphSanity: (graphPath: string) => {
    isolatedNodes: number | null;
    selfLoops: number | null;
    edgesWithMissingTarget: number | null;
    averageDegree: number | null;
    maxDegree: number | null;
    edgesWithoutType: number | null;
  };
  parseCrossLinks: (modulesDir: string, projectRoot?: string) => {
    totalLinks: number;
    brokenLinks: number;
    externalLinks: number;
  };
  buildQualitySection: (outputDir: string, projectRoot?: string) => Record<string, unknown>;
}

async function loadQuality(): Promise<QualityModule> {
  const url = pathToFileURL(resolve('scripts/lib/baseline-quality.mjs')).href;
  return (await import(url)) as QualityModule;
}

describe('baseline-quality', () => {
  let tempDir: string;
  let modulesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'baseline-quality-test-'));
    modulesDir = join(tempDir, 'modules');
    mkdirSync(modulesDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseSpecStructure', () => {
    it('counts modules with all 4 required sections (Chinese + English variants)', async () => {
      const { parseSpecStructure } = await loadQuality();
      writeFileSync(
        join(modulesDir, 'a.spec.md'),
        '# Module A\n\n## 1. 意图\nBlah.\n\n## 2. 业务逻辑\nBlah.\n\n## 3. 接口定义\nBlah.\n\n## 4. 数据结构\nBlah.\n',
      );
      writeFileSync(
        join(modulesDir, 'b.spec.md'),
        '# Module B\n\n## Intent\nBlah.\n\n## Behavior\nBlah.\n\n## API\nBlah.\n\n## Data Model\nBlah.\n',
      );
      writeFileSync(
        join(modulesDir, 'c.spec.md'),
        '# Module C\n\n## 1. 意图\nBlah.\n', // 只有 1 章节
      );
      const r = parseSpecStructure(modulesDir);
      expect(r.moduleCount).toBe(3);
      expect(r.modulesWithIntent).toBe(3);
      expect(r.modulesWithBehavior).toBe(2);
      expect(r.modulesWithApi).toBe(2);
      expect(r.modulesWithDataModel).toBe(2);
      expect(r.modulesWithAllFour).toBe(2);
    });

    it('flags too-short and too-long outliers', async () => {
      const { parseSpecStructure } = await loadQuality();
      writeFileSync(join(modulesDir, 'short.spec.md'), 'tiny\n');
      writeFileSync(join(modulesDir, 'long.spec.md'), 'x\n'.repeat(2000));
      const r = parseSpecStructure(modulesDir);
      expect(r.shorterThan100Lines).toBe(1);
      expect(r.longerThan1000Lines).toBe(1);
      expect(r.outlierFiles).toHaveLength(2);
    });

    it('returns empty stats when modules dir absent', async () => {
      const { parseSpecStructure } = await loadQuality();
      const r = parseSpecStructure(join(tempDir, 'nonexistent'));
      expect(r.moduleCount).toBe(0);
      expect(r._note).toBe('modules dir not found');
    });
  });

  describe('parseGraphSanity', () => {
    it('counts isolated nodes / self-loops / missing targets', async () => {
      const { parseGraphSanity } = await loadQuality();
      const graph = {
        nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'isolated' }],
        links: [
          { source: 'a', target: 'b', type: 'imports' },
          { source: 'b', target: 'c', type: 'calls' },
          { source: 'a', target: 'a', type: 'recursive' }, // self-loop
          { source: 'c', target: 'ghost' }, // missing target + no type
        ],
      };
      const graphPath = join(tempDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(graph));
      const r = parseGraphSanity(graphPath);
      expect(r.isolatedNodes).toBe(1);
      expect(r.selfLoops).toBe(1);
      expect(r.edgesWithMissingTarget).toBe(1);
      expect(r.edgesWithoutType).toBe(1);
      expect(r.averageDegree).toBeGreaterThan(0);
    });

    it('returns nulls when graph.json missing', async () => {
      const { parseGraphSanity } = await loadQuality();
      const r = parseGraphSanity(join(tempDir, 'nonexistent.json'));
      expect(r.isolatedNodes).toBeNull();
    });
  });

  describe('parseCrossLinks', () => {
    it('counts total / broken / external links', async () => {
      const { parseCrossLinks } = await loadQuality();
      writeFileSync(join(modulesDir, 'a.spec.md'), '# A\n\nSee [other](./b.spec.md) and [missing](./ghost.md) and [google](https://google.com).\n');
      writeFileSync(join(modulesDir, 'b.spec.md'), '# B\n');
      const r = parseCrossLinks(modulesDir);
      expect(r.totalLinks).toBe(3);
      expect(r.brokenLinks).toBe(1);
      expect(r.externalLinks).toBe(1);
    });
  });

  describe('buildQualitySection', () => {
    it('aggregates all 3 sub-sections', async () => {
      const { buildQualitySection } = await loadQuality();
      // Build minimal valid output dir
      writeFileSync(
        join(modulesDir, 'a.spec.md'),
        '## 1. 意图\nx\n## 2. 业务逻辑\nx\n## 3. 接口定义\nx\n## 4. 数据结构\nx\n',
      );
      const metaDir = join(tempDir, '_meta');
      mkdirSync(metaDir);
      writeFileSync(join(metaDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'x' }], links: [] }));
      const r = buildQualitySection(tempDir);
      expect(r.specStructure).toBeTruthy();
      expect(r.graphSanity).toBeTruthy();
      expect(r.crossLinks).toBeTruthy();
      expect(r.codingContextGrounding).toBeNull();
    });
  });
});
