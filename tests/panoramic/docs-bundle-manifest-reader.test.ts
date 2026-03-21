import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readDocsBundleManifest } from '../../src/panoramic/docs-bundle-manifest-reader.js';

describe('readDocsBundleManifest', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('读取 055 风格的 docs-bundle.yaml 最小引用结构', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-bundle-reader-'));
    const outputDir = path.join(projectRoot, 'specs');
    tempDirs.push(projectRoot);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'docs-bundle.yaml'),
      `
version: 1
generatedAt: "2026-03-21T10:00:00.000Z"
profiles:
  - id: developer-onboarding
    title: Developer Onboarding
    rootDir: specs/bundles/developer-onboarding
    docsRoot: specs/bundles/developer-onboarding/docs
    landingPagePath: specs/bundles/developer-onboarding/docs/index.md
    documents:
      - sourceId: architecture-narrative
      - sourceId: architecture-overview
    navigation:
      - title: Home
        path: index.md
      - title: Architecture Narrative
        path: architecture-narrative.md
`.trim(),
      'utf-8',
    );

    const result = readDocsBundleManifest(outputDir, projectRoot);

    expect(result.warnings).toHaveLength(0);
    expect(result.manifest).toBeDefined();
    expect(result.manifest?.sourcePath).toBe('specs/docs-bundle.yaml');
    expect(result.manifest?.profiles).toHaveLength(1);
    expect(result.manifest?.profiles[0]).toMatchObject({
      id: 'developer-onboarding',
      title: 'Developer Onboarding',
      documentIds: ['architecture-narrative', 'architecture-overview'],
    });
    expect(result.manifest?.profiles[0]?.navigation[0]).toMatchObject({
      title: 'Home',
      path: 'index.md',
    });
  });

  it('manifest 缺失时返回降级 warning', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-bundle-reader-missing-'));
    const outputDir = path.join(projectRoot, 'specs');
    tempDirs.push(projectRoot);
    fs.mkdirSync(outputDir, { recursive: true });

    const result = readDocsBundleManifest(outputDir, projectRoot);

    expect(result.manifest).toBeUndefined();
    expect(result.warnings).toEqual([
      '未找到 docs-bundle manifest，将以 partial 模式降级 required-doc 的发布覆盖校验。',
    ]);
  });
});
