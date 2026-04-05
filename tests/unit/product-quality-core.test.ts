import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function importScriptModule<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(resolve(relativePath)).href) as Promise<T>;
}

describe('product-quality core module', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'product-quality-core-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('collectDocumentRefs 会去重并为 spec-driver 注入治理必需文档', async () => {
    const { collectDocumentRefs } = await importScriptModule<{
      collectDocumentRefs: (projectRoot: string, productId: string, entity: Record<string, unknown>) => Array<{ id: string; available: boolean }>;
    }>('plugins/spec-driver/scripts/lib/product-quality-core.mjs');

    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated'), { recursive: true });
    writeFileSync(join(projectRoot, 'README.md'), '# Demo Repo\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'), '# Spec Driver\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'entity.yaml'), 'id: "spec-driver"\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'scorecard-report.json'), '{}\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'workflow-index.json'), '{}\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'adoption-report.json'), '{}\n', 'utf-8');

    const refs = collectDocumentRefs(projectRoot, 'spec-driver', {
      docs: [
        { id: 'current-spec', path: 'specs/products/spec-driver/current-spec.md' },
        { id: 'current-spec', path: 'specs/products/spec-driver/current-spec.md' },
        { id: 'readme', path: 'README.md' },
      ],
    });

    expect(refs.map((doc) => doc.id)).toEqual([
      'current-spec',
      'readme',
      'entity',
      'scorecard-report',
      'workflow-index',
      'adoption-report',
    ]);
    expect(refs.every((doc) => doc.available)).toBe(true);
  });

  it('detectProductConflicts 会识别 entity 与 current-spec 标题漂移', async () => {
    const { detectProductConflicts } = await importScriptModule<{
      detectProductConflicts: (input: {
        entity: Record<string, unknown>;
        documentRefs: Array<{
          id: string;
          available: boolean;
          path: string;
          relativePath: string;
        }>;
      }) => Array<{ topic: string; severity: string }>;
    }>('plugins/spec-driver/scripts/lib/product-quality-core.mjs');

    const currentSpecPath = join(projectRoot, 'specs', 'products', 'reverse-spec', 'current-spec.md');
    mkdirSync(join(projectRoot, 'specs', 'products', 'reverse-spec'), { recursive: true });
    writeFileSync(currentSpecPath, '# Another Product Name\n', 'utf-8');

    const conflicts = detectProductConflicts({
      entity: { name: 'Reverse-Spec' },
      documentRefs: [
        {
          id: 'entity',
          available: true,
          path: join(projectRoot, 'specs', 'products', 'reverse-spec', '_generated', 'entity.yaml'),
          relativePath: 'specs/products/reverse-spec/_generated/entity.yaml',
        },
        {
          id: 'current-spec',
          available: true,
          path: currentSpecPath,
          relativePath: 'specs/products/reverse-spec/current-spec.md',
        },
      ],
    });

    expect(conflicts).toEqual([
      expect.objectContaining({
        topic: 'product-positioning',
        severity: 'medium',
      }),
    ]);
  });

  it('quality status 在 dependency warnings 下按 partial 降级', async () => {
    const { determineDocsQualityStatus } = await importScriptModule<{
      determineDocsQualityStatus: (input: {
        bundleCoverage: string;
        conflicts: Array<{ severity: string }>;
        requiredDocs: Array<{ coverage: string }>;
        warnings: string[];
        dependencyWarnings: string[];
      }) => string;
    }>('plugins/spec-driver/scripts/lib/product-quality-core.mjs');

    const status = determineDocsQualityStatus({
      bundleCoverage: 'partial',
      conflicts: [],
      requiredDocs: [{ coverage: 'covered' }, { coverage: 'missing' }],
      warnings: [],
      dependencyWarnings: ['缺少 required doc: workflow-index'],
    });

    expect(status).toBe('partial');
  });
});
