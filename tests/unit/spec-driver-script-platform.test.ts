import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

async function importScriptModule<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(resolve(relativePath)).href) as Promise<T>;
}

describe('spec-driver script platform shared layer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'spec-driver-script-platform-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('通过共享 simple-yaml 解析和序列化脚本平台对象', async () => {
    const { parseYamlDocument, stringifyYaml } = await importScriptModule<{
      parseYamlDocument: (content: string) => Record<string, unknown>;
      stringifyYaml: (value: unknown, indent?: number) => string;
    }>('plugins/spec-driver/scripts/lib/simple-yaml.mjs');

    const source = {
      schemaVersion: 1,
      product: {
        id: 'spec-driver',
        enabled: true,
      },
      warnings: ['legacy-md', 'missing-owner'],
      reports: [
        { id: 'quality', status: 'warn' },
        { id: 'scorecard', status: 'pass' },
      ],
      note: null,
    };

    const rendered = stringifyYaml(source);

    expect(rendered).toContain('schemaVersion: 1');
    expect(rendered).toContain('- "legacy-md"');
    expect(parseYamlDocument(rendered)).toEqual(source);
  });

  it('通过共享 IO helper 统一读写 JSON、Markdown 和 YAML 产物', async () => {
    const { readJsonArtifact, writeJsonArtifact, writeMarkdownArtifact, writeYamlArtifact } = await importScriptModule<{
      readJsonArtifact: (filePath: string) => Record<string, unknown> | null;
      writeJsonArtifact: (filePath: string, value: unknown) => void;
      writeMarkdownArtifact: (filePath: string, content: string) => void;
      writeYamlArtifact: (filePath: string, value: unknown) => void;
    }>('plugins/spec-driver/scripts/lib/script-report-io.mjs');
    const { parseYamlDocument } = await importScriptModule<{
      parseYamlDocument: (content: string) => Record<string, unknown>;
    }>('plugins/spec-driver/scripts/lib/simple-yaml.mjs');

    const jsonPath = join(tempDir, 'reports', 'quality-report.json');
    const markdownPath = join(tempDir, 'reports', 'quality-report.md');
    const yamlPath = join(tempDir, 'reports', 'quality-report.yaml');
    const invalidJsonPath = join(tempDir, 'reports', 'invalid.json');

    writeJsonArtifact(jsonPath, { status: 'pass', score: 95 });
    writeMarkdownArtifact(markdownPath, '# Report');
    writeYamlArtifact(yamlPath, { status: 'pass', warnings: ['none'] });
    writeFileSync(invalidJsonPath, '{invalid json', 'utf-8');

    expect(readFileSync(jsonPath, 'utf-8').endsWith('\n')).toBe(true);
    expect(readFileSync(markdownPath, 'utf-8')).toBe('# Report\n');
    expect(readFileSync(yamlPath, 'utf-8').endsWith('\n')).toBe(true);
    expect(readJsonArtifact(jsonPath)).toEqual({ status: 'pass', score: 95 });
    expect(readJsonArtifact(invalidJsonPath)).toBeNull();
    expect(parseYamlDocument(readFileSync(yamlPath, 'utf-8'))).toEqual({
      status: 'pass',
      warnings: ['none'],
    });
  });

  it('通过共享 patcher 回写产品 YAML 与 catalog 索引', async () => {
    const { patchProductCatalogIndex, patchYamlArtifact } = await importScriptModule<{
      patchProductCatalogIndex: (projectRoot: string, mergeProduct: (product: Record<string, unknown>) => Record<string, unknown>) => boolean;
      patchYamlArtifact: (filePath: string, mutateFn: (current: Record<string, unknown>) => Record<string, unknown>) => boolean;
    }>('plugins/spec-driver/scripts/lib/product-artifact-patchers.mjs');
    const { parseYamlDocument } = await importScriptModule<{
      parseYamlDocument: (content: string) => Record<string, unknown>;
    }>('plugins/spec-driver/scripts/lib/simple-yaml.mjs');
    const { writeYamlArtifact } = await importScriptModule<{
      writeYamlArtifact: (filePath: string, value: unknown) => void;
    }>('plugins/spec-driver/scripts/lib/script-report-io.mjs');

    const entityPath = join(tempDir, 'specs', 'products', 'spec-driver', '_generated', 'entity.yaml');
    const catalogIndexPath = join(tempDir, 'specs', 'products', '_generated', 'catalog-index.yaml');
    mkdirSync(join(tempDir, 'specs', 'products', 'spec-driver', '_generated'), { recursive: true });
    mkdirSync(join(tempDir, 'specs', 'products', '_generated'), { recursive: true });

    writeYamlArtifact(entityPath, {
      id: 'spec-driver',
      quality: {
        report: {
          status: 'warn',
        },
      },
    });
    writeYamlArtifact(catalogIndexPath, {
      schemaVersion: 1,
      products: [
        {
          id: 'spec-driver',
          qualityStatus: 'warn',
        },
      ],
    });

    expect(patchYamlArtifact(entityPath, (current) => ({
      ...current,
      quality: {
        ...(current.quality as Record<string, unknown>),
        report: {
          ...((current.quality as Record<string, unknown>).report as Record<string, unknown>),
          status: 'pass',
        },
      },
    }))).toBe(true);
    expect(patchYamlArtifact(join(tempDir, 'missing.yaml'), (current) => current)).toBe(false);
    expect(patchProductCatalogIndex(tempDir, (product) => (
      product.id === 'spec-driver'
        ? { ...product, qualityStatus: 'pass', scorecardStatus: 'pass' }
        : product
    ))).toBe(true);

    expect(parseYamlDocument(readFileSync(entityPath, 'utf-8'))).toEqual({
      id: 'spec-driver',
      quality: {
        report: {
          status: 'pass',
        },
      },
    });
    expect(parseYamlDocument(readFileSync(catalogIndexPath, 'utf-8'))).toEqual({
      schemaVersion: 1,
      products: [
        {
          id: 'spec-driver',
          qualityStatus: 'pass',
          scorecardStatus: 'pass',
        },
      ],
    });
  });

  it('通过共享 diagnostics helper 统一 warnings 与 Markdown 表格转义', async () => {
    const { appendWarningsSection, dedupeStringValues, escapeMarkdownTableCell } = await importScriptModule<{
      appendWarningsSection: (lines: string[], warnings: unknown[], heading?: string) => string[];
      dedupeStringValues: (items: unknown[]) => string[];
      escapeMarkdownTableCell: (value: unknown) => string;
    }>('plugins/spec-driver/scripts/lib/script-diagnostics.mjs');

    const lines = ['# Report'];
    appendWarningsSection(lines, [' duplicate ', 'duplicate', '', 'needs-owner', null], '## Diagnostics');

    expect(dedupeStringValues([' duplicate ', 'duplicate', '', 'needs-owner', null])).toEqual([
      'duplicate',
      'needs-owner',
    ]);
    expect(lines).toEqual([
      '# Report',
      '',
      '## Diagnostics',
      '',
      '- duplicate',
      '- needs-owner',
      '',
    ]);
    expect(escapeMarkdownTableCell('quality|warn')).toBe('quality\\|warn');
  });

  it('目标脚本链路统一复用共享 YAML、IO 与 diagnostics 合同', () => {
    const thinEntryTargets = [
      'plugins/spec-driver/scripts/generate-workflow-registry.mjs',
      'plugins/spec-driver/scripts/generate-product-quality-reports.mjs',
      'plugins/spec-driver/scripts/generate-product-scorecards.mjs',
    ];
    const sharedYamlTargets = [
      'plugins/spec-driver/scripts/lib/workflow-registry-core.mjs',
      'plugins/spec-driver/scripts/lib/product-quality-core.mjs',
      'plugins/spec-driver/scripts/lib/product-scorecard-core.mjs',
    ];
    const legacySharedYamlTargets = [
      'plugins/spec-driver/scripts/generate-product-entity-catalog.mjs',
    ];
    const sharedIoTargets = [
      'plugins/spec-driver/scripts/lib/workflow-registry-core.mjs',
      'plugins/spec-driver/scripts/lib/product-quality-core.mjs',
      'plugins/spec-driver/scripts/lib/product-scorecard-core.mjs',
    ];
    const legacySharedIoTargets = [
      'plugins/spec-driver/scripts/generate-product-entity-catalog.mjs',
      'plugins/spec-driver/scripts/generate-project-context-suggestions.mjs',
      'plugins/spec-driver/scripts/generate-adoption-insights.mjs',
    ];
    const sharedDiagnosticsTargets = [
      'plugins/spec-driver/scripts/lib/workflow-registry-core.mjs',
      'plugins/spec-driver/scripts/lib/product-quality-core.mjs',
      'plugins/spec-driver/scripts/lib/product-scorecard-core.mjs',
    ];
    const legacySharedDiagnosticsTargets = [
      'plugins/spec-driver/scripts/generate-project-context-suggestions.mjs',
      'plugins/spec-driver/scripts/generate-adoption-insights.mjs',
    ];
    const noLocalDupTargets = [
      'plugins/spec-driver/scripts/lib/workflow-registry-core.mjs',
      'plugins/spec-driver/scripts/lib/product-quality-core.mjs',
      'plugins/spec-driver/scripts/lib/product-scorecard-core.mjs',
      'plugins/spec-driver/scripts/generate-product-entity-catalog.mjs',
      'plugins/spec-driver/scripts/generate-project-context-suggestions.mjs',
    ];
    const entryToCoreImports = new Map([
      ['plugins/spec-driver/scripts/generate-workflow-registry.mjs', "./lib/workflow-registry-core.mjs"],
      ['plugins/spec-driver/scripts/generate-product-quality-reports.mjs', "./lib/product-quality-core.mjs"],
      ['plugins/spec-driver/scripts/generate-product-scorecards.mjs', "./lib/product-scorecard-core.mjs"],
    ]);

    for (const relativePath of thinEntryTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './lib/script-cli-args.mjs'");
      expect(source).toContain(`from '${entryToCoreImports.get(relativePath)}'`);
    }

    for (const relativePath of sharedYamlTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './simple-yaml.mjs'");
    }
    for (const relativePath of legacySharedYamlTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './lib/simple-yaml.mjs'");
    }

    for (const relativePath of sharedIoTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './script-report-io.mjs'");
    }
    for (const relativePath of legacySharedIoTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './lib/script-report-io.mjs'");
    }

    for (const relativePath of sharedDiagnosticsTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './script-diagnostics.mjs'");
    }
    for (const relativePath of legacySharedDiagnosticsTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).toContain("from './lib/script-diagnostics.mjs'");
    }

    for (const relativePath of noLocalDupTargets) {
      const source = readFileSync(resolve(relativePath), 'utf-8');
      expect(source).not.toMatch(/^function parseYamlDocument\(/m);
      expect(source).not.toMatch(/^function stringifyYaml\(/m);
      expect(source).not.toMatch(/^function readJsonFile\(/m);
    }
  });
});
