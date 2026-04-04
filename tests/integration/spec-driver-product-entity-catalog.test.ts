import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseYamlDocument } from '../../src/panoramic/parsers/yaml-config-parser.js';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/generate-product-entity-catalog.mjs');

describe('generate-product-entity-catalog.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-catalog-'));
    mkdirSync(join(projectRoot, 'specs', 'products', 'reverse-spec'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver'), { recursive: true });
    writeFileSync(join(projectRoot, 'README.md'), '# Demo Repo\n', 'utf-8');
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'demo-repo',
        version: '1.0.0',
      }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('为 reverse-spec 和 spec-driver 生成 entity.yaml 与 catalog-index.yaml', () => {
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'product-mapping.yaml'),
      [
        'products:',
        '  reverse-spec:',
        '    description: "reverse-spec v2.2.0 — 结构化逆向文档平台"',
        '    specs:',
        '      - id: "001-reverse-spec-v2"',
        '        type: FEATURE',
        '        summary: "核心流水线"',
        '  spec-driver:',
        '    description: "Spec Driver v3.1.0 — 自治研发编排器 Plugin"',
        '    specs:',
        '      - id: "011-speckit-driver-pro"',
        '        type: INITIAL',
        '        summary: "完整自治编排器"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'reverse-spec', 'current-spec.md'),
      [
        '# Reverse-Spec — 产品规范活文档',
        '',
        '> **产品**: reverse-spec',
        '> **版本**: 聚合自 46 个增量 spec',
        '> **最后聚合**: 2026-03-22',
        '> **状态**: 活跃',
        '',
        '## 1. 产品概述',
        '',
        'Reverse-Spec 是结构化逆向文档平台。',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'),
      [
        '# Spec Driver — 产品规范活文档',
        '',
        '> **产品**: spec-driver',
        '> **版本**: 聚合自 13 个增量 spec',
        '> **最后聚合**: 2026-03-22',
        '> **状态**: 活跃',
        '',
        '## 1. 产品概述',
        '',
        'Spec Driver 是自治研发编排器 Plugin。',
      ].join('\n'),
      'utf-8',
    );

    const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });

    const payload = JSON.parse(stdout) as {
      catalogIndexPath: string;
      entities: Array<{ id: string; entityPath: string; workflowRefCount: number }>;
      warnings: string[];
    };

    expect(payload.catalogIndexPath).toBe('specs/products/catalog-index.yaml');
    expect(payload.warnings).toEqual([]);
    expect(payload.entities.map((entity) => entity.id)).toEqual(['reverse-spec', 'spec-driver']);

    const reverseEntity = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'reverse-spec', 'entity.yaml'), 'utf-8'),
    ) as {
      id: string;
      name: string;
      kind: string;
      owner: { value: string };
      lifecycle: { value: string; source: string };
      docs: Array<{ id: string; path: string; available: boolean }>;
      workflowRefs: string[];
      sourceRefs: Array<{ kind: string; path: string }>;
    };
    expect(reverseEntity.id).toBe('reverse-spec');
    expect(reverseEntity.name).toBe('Reverse-Spec');
    expect(reverseEntity.kind).toBe('library-tooling');
    expect(reverseEntity.owner.value).toBe('unknown');
    expect(reverseEntity.lifecycle.value).toBe('active');
    expect(reverseEntity.lifecycle.source).toBe('inferred:current-spec.status');
    expect(reverseEntity.docs.map((doc) => doc.id)).toEqual(expect.arrayContaining(['current-spec', 'readme']));
    expect(reverseEntity.workflowRefs).toEqual(expect.arrayContaining(['reverse-spec.generate', 'reverse-spec.batch']));
    expect(reverseEntity.sourceRefs.map((source) => source.kind)).toEqual(
      expect.arrayContaining(['product-mapping', 'current-spec', 'readme']),
    );

    const specDriverEntity = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'entity.yaml'), 'utf-8'),
    ) as {
      id: string;
      kind: string;
      workflowRefs: string[];
    };
    expect(specDriverEntity.id).toBe('spec-driver');
    expect(specDriverEntity.kind).toBe('plugin');
    expect(specDriverEntity.workflowRefs).toEqual(expect.arrayContaining([
      'spec-driver-feature',
      'spec-driver-sync',
      'spec-driver-doc',
    ]));

    const catalogIndex = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'catalog-index.yaml'), 'utf-8'),
    ) as {
      productCount: number;
      products: Array<{ id: string; entityPath: string; currentSpecPath: string; specCount: number }>;
    };
    expect(catalogIndex.productCount).toBe(2);
    expect(catalogIndex.products).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'reverse-spec',
        entityPath: 'specs/products/reverse-spec/entity.yaml',
        currentSpecPath: 'specs/products/reverse-spec/current-spec.md',
        specCount: 1,
      }),
      expect.objectContaining({
        id: 'spec-driver',
        entityPath: 'specs/products/spec-driver/entity.yaml',
        currentSpecPath: 'specs/products/spec-driver/current-spec.md',
        specCount: 1,
      }),
    ]));
  });

  it('当 current-spec 缺失时显式标记 unknown 并返回 warning', () => {
    mkdirSync(join(projectRoot, 'specs', 'products', 'demo'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'product-mapping.yaml'),
      [
        'products:',
        '  demo:',
        '    description: "Demo Product — 测试实体目录缺失 current-spec 的回退"',
        '    specs:',
        '      - id: "063-product-entity-catalog"',
        '        type: FEATURE',
        '        summary: "实体目录"',
      ].join('\n'),
      'utf-8',
    );

    const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      warnings: string[];
    };
    expect(payload.warnings).toEqual([
      '缺少 current-spec.md: specs/products/demo/current-spec.md',
    ]);

    const entity = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'demo', 'entity.yaml'), 'utf-8'),
    ) as {
      docs: Array<{ id: string; available: boolean }>;
      lifecycle: { value: string; source: string };
      quality: { currentSpec: { status: string } };
    };
    expect(entity.docs.find((doc) => doc.id === 'current-spec')?.available).toBe(false);
    expect(entity.lifecycle.value).toBe('unknown');
    expect(entity.lifecycle.source).toBe('unknown');
    expect(entity.quality.currentSpec.status).toBe('unknown');
  });
});
