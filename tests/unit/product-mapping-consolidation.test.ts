/**
 * M11 卡 C 第 12 项 — 三套 `parseProductMapping` 收敛到 `sync-product-mapping.mjs`
 *
 * 病根（账本 2026-09-14 角 B W-B7）：catalog 自带的解析器只吃对象形态条目，真实 mapping 是字符串形态
 * （`- "001"`），于是 `catalog-index.yaml` 的 `specCount: 0` 一直是假数；scorecard 则把条目原样当目录名拼路径，
 * 短编号一律判 `missing`。三处各自一套编号口径，改一处漏两处。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function importScriptModule<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(resolve(relativePath)).href) as Promise<T>;
}

const MAPPING_STRING_FORM = [
  '# 头部注释',
  'products:',
  '  demo:',
  '    description: "demo product"',
  '    specs:',
  '      - "001"',
  '      - "002-second-feature"',
  '      - 003',
  '',
].join('\n');

function scaffoldProject(projectRoot: string): void {
  mkdirSync(join(projectRoot, 'specs', 'products', 'demo'), { recursive: true });
  writeFileSync(join(projectRoot, 'specs', 'products', 'product-mapping.yaml'), MAPPING_STRING_FORM, 'utf-8');
  for (const dir of ['001-first-feature', '002-second-feature', '003-third-feature']) {
    mkdirSync(join(projectRoot, 'specs', dir), { recursive: true });
    writeFileSync(join(projectRoot, 'specs', dir, 'spec.md'), `# ${dir}\n\n**Status**: Implemented\n`, 'utf-8');
  }
  writeFileSync(
    join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'),
    '# Demo — 产品规范活文档\n\n> **状态**: 活跃\n\n## 1. 产品概述\n\nDemo overview.\n',
    'utf-8',
  );
}

describe('parseProductMapping 单一实现', () => {
  it('plugins/spec-driver/scripts 下只剩 sync-product-mapping.mjs 一处定义（结构性护栏，防再长出第四套）', () => {
    const listing = execFileSync('git', ['grep', '-l', '-E', '^(export )?function parseProductMapping', '--', 'plugins/spec-driver/scripts', 'scripts'], {
      cwd: resolve('.'),
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);
    expect(listing).toEqual(['plugins/spec-driver/scripts/lib/sync-product-mapping.mjs']);
  });
});

describe('generate-product-entity-catalog 消费 canonical 解析器', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'mapping-consolidation-'));
    scaffoldProject(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('字符串形态（含不带引号的 003）的 mapping 条目按 canonical 口径计数：specCount = 3 而不是 0', async () => {
    const { generateProductEntityCatalog } = await importScriptModule<{
      generateProductEntityCatalog: (options: { projectRoot: string }) => { entities: Array<{ id: string; specCount: number }>; warnings: string[] };
    }>('plugins/spec-driver/scripts/generate-product-entity-catalog.mjs');

    const result = generateProductEntityCatalog({ projectRoot });
    expect(result.entities.map((entity) => [entity.id, entity.specCount])).toEqual([['demo', 3]]);

    const catalogIndex = readFileSync(join(projectRoot, 'specs', 'products', '_generated', 'catalog-index.yaml'), 'utf-8');
    expect(catalogIndex).toMatch(/specCount: 3\b/);
  });

  it('上轮 catalog-index 有、本轮 generator 产不出的字段发 warning；由后续 pass 回填的字段不算脱落', async () => {
    const { generateProductEntityCatalog } = await importScriptModule<{
      generateProductEntityCatalog: (options: { projectRoot: string }) => { warnings: string[] };
    }>('plugins/spec-driver/scripts/generate-product-entity-catalog.mjs');

    mkdirSync(join(projectRoot, 'specs', 'products', '_generated'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'specs', 'products', '_generated', 'catalog-index.yaml'),
      [
        'schemaVersion: 1',
        'generatedAt: "2026-01-01T00:00:00.000Z"',
        'productCount: 1',
        'products:',
        '  - id: "demo"',
        '    name: "Demo"',
        '    specCount: 0',
        '    legacyOnlyField: "from-an-older-generator"',
        '    qualityReportPath: "specs/products/demo/_generated/quality-report.json"',
        '    scorecardStatus: "warn"',
        '    scorecardScore: 90',
        '',
      ].join('\n'),
      'utf-8',
    );

    const result = generateProductEntityCatalog({ projectRoot });
    const dropWarnings = result.warnings.filter((warning) => warning.includes('legacyOnlyField'));
    expect(dropWarnings).toHaveLength(1);
    expect(dropWarnings[0]).toMatch(/demo/);
    expect(result.warnings.some((warning) => /scorecardScore|scorecardStatus|qualityReportPath/.test(warning))).toBe(false);
  });
});

describe('product-scorecard-core collectFeatureInputs 按编号解析目录', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'mapping-consolidation-scorecard-'));
    scaffoldProject(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('短编号 "001" 解析到 specs/001-first-feature（此前原样拼路径判 missing）', async () => {
    const { collectFeatureInputs } = await importScriptModule<{
      collectFeatureInputs: (projectRoot: string, specs: string[]) => Array<{ id: string; featureDir: string; artifactType: string; governed: boolean }>;
    }>('plugins/spec-driver/scripts/lib/product-scorecard-core.mjs');

    const inputs = collectFeatureInputs(projectRoot, ['001', '002-second-feature', '999']);
    // 报告 id = 解析到的磁盘目录名（能定位才有行动价值）；解析不到时保留 mapping 原条目
    expect(inputs.map((input) => [input.id, input.artifactType, input.governed])).toEqual([
      ['001-first-feature', 'feature', true],
      ['002-second-feature', 'feature', true],
      ['999', 'missing', false],
    ]);
    expect(inputs[0]!.featureDir).toBe(join(projectRoot, 'specs', '001-first-feature'));
  });

  it('端到端：真实字符串形态 mapping（含不带引号的 003）跑 scorecard 不再抛错，且报告里没有 missing 形态', async () => {
    const { generateProductScorecards } = await importScriptModule<{
      generateProductScorecards: (options: { projectRoot: string }) => { products: Array<{ id: string; reportPath: string }> };
    }>('plugins/spec-driver/scripts/lib/product-scorecard-core.mjs');
    const result = generateProductScorecards({ projectRoot });
    const demo = result.products.find((product) => product.id === 'demo');
    expect(demo).toBeDefined();
    // reportPath 是相对 projectRoot 的 posix 路径（scorecard-core 合同），不是相对 cwd
    const report = readFileSync(join(projectRoot, demo!.reportPath), 'utf-8');
    expect(report).not.toMatch(/missing/);
  });
});
