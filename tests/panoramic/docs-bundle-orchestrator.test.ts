import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  orchestrateDocsBundle,
} from '../../src/panoramic/docs-bundle-orchestrator.js';
import {
  DOCS_BUNDLE_MANIFEST_FILE,
} from '../../src/panoramic/docs-bundle-types.js';
import { parseYamlDocument } from '../../src/panoramic/parsers/yaml-config-parser.js';

describe('docs-bundle-orchestrator', () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-bundle-orchestrator-'));
    outputDir = path.join(projectRoot, 'specs');
    fs.mkdirSync(outputDir, { recursive: true });

    writeDoc('architecture-narrative.md', '# architecture-narrative');
    writeDoc('architecture-overview.md', '# architecture-overview');
    writeDoc('runtime-topology.md', '# runtime-topology');
    writeDoc('workspace-index.md', '# workspace-index');
    writeDoc('config-reference.md', '# config-reference');
    writeDoc('pattern-hints.md', '# pattern-hints');
    writeDoc('cross-package-analysis.md', '# cross-package-analysis');
    writeDoc('api-surface.md', '# api-surface');
    writeDoc('data-model.md', '# data-model');
    writeDoc('event-surface.md', '# event-surface');
    writeDoc('troubleshooting.md', '# troubleshooting');
    writeDoc('_index.spec.md', '# architecture index');
    writeDoc('api.spec.md', '# api spec');
    writeDoc('worker.spec.md', '# worker spec');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('生成 manifest、bundle skeleton，并按阅读路径组织 developer-onboarding', () => {
    const result = orchestrateDocsBundle({
      projectRoot,
      outputDir,
    });

    expect(result.manifestPath).toBe('specs/docs-bundle.yaml');
    expect(result.profiles.map((profile) => profile.id)).toEqual([
      'developer-onboarding',
      'architecture-review',
      'api-consumer',
      'ops-handover',
    ]);

    const onboarding = result.manifest.profiles.find((profile) => profile.id === 'developer-onboarding');
    expect(onboarding).toBeDefined();
    expect(onboarding!.navigation.map((item) => item.path ?? item.title)).toEqual([
      'index.md',
      'architecture-narrative.md',
      'architecture-overview.md',
      'runtime-topology.md',
      'workspace-index.md',
      'config-reference.md',
      'Module Specs',
    ]);
    expect(onboarding!.navigation[6]?.children?.map((item) => item.path)).toEqual([
      'modules/architecture-index.md',
      'modules/api.spec.md',
      'modules/worker.spec.md',
    ]);

    const apiConsumer = result.manifest.profiles.find((profile) => profile.id === 'api-consumer');
    const opsHandover = result.manifest.profiles.find((profile) => profile.id === 'ops-handover');
    expect(apiConsumer?.navigation.map((item) => item.path ?? item.title)).toEqual([
      'index.md',
      'api-surface.md',
      'config-reference.md',
      'data-model.md',
      'event-surface.md',
      'troubleshooting.md',
    ]);
    expect(opsHandover?.navigation.map((item) => item.path ?? item.title)).toEqual([
      'index.md',
      'runtime-topology.md',
      'troubleshooting.md',
      'config-reference.md',
      'architecture-overview.md',
      'event-surface.md',
    ]);

    const manifestContent = fs.readFileSync(
      path.join(outputDir, DOCS_BUNDLE_MANIFEST_FILE),
      'utf-8',
    );
    const manifest = parseYamlDocument(manifestContent) as {
      version?: number;
      profiles?: Array<{ id?: string }>;
      moduleSpecCount?: number;
    };
    expect(manifest.version).toBe(1);
    expect(manifest.moduleSpecCount).toBe(2);
    expect(manifest.profiles?.map((profile) => profile.id)).toEqual([
      'developer-onboarding',
      'architecture-review',
      'api-consumer',
      'ops-handover',
    ]);

    expect(fs.existsSync(path.join(outputDir, 'bundles', 'developer-onboarding', 'mkdocs.yml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'bundles', 'developer-onboarding', 'docs', 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'bundles', 'developer-onboarding', 'docs', 'modules', 'api.spec.md'))).toBe(true);
  });

  it('缺失文档时保持稳定顺序并记录 warning', () => {
    fs.rmSync(path.join(outputDir, 'runtime-topology.md'));

    const result = orchestrateDocsBundle({
      projectRoot,
      outputDir,
    });

    const onboarding = result.manifest.profiles.find((profile) => profile.id === 'developer-onboarding');
    expect(onboarding).toBeDefined();
    expect(onboarding!.warnings).toContain('缺少源文档: runtime-topology');
    expect(onboarding!.navigation.map((item) => item.path ?? item.title)).toEqual([
      'index.md',
      'architecture-narrative.md',
      'architecture-overview.md',
      'workspace-index.md',
      'config-reference.md',
      'Module Specs',
    ]);
  });

  it('重复运行时忽略既有 bundles 中的 module spec 副本', () => {
    const first = orchestrateDocsBundle({
      projectRoot,
      outputDir,
    });
    const second = orchestrateDocsBundle({
      projectRoot,
      outputDir,
    });

    const firstOnboarding = first.manifest.profiles.find((profile) => profile.id === 'developer-onboarding');
    const secondOnboarding = second.manifest.profiles.find((profile) => profile.id === 'developer-onboarding');

    expect(firstOnboarding?.documents.filter((document) => document.kind === 'module-spec')).toHaveLength(2);
    expect(secondOnboarding?.documents.filter((document) => document.kind === 'module-spec')).toHaveLength(2);
  });

  function writeDoc(fileName: string, content: string): void {
    fs.writeFileSync(path.join(outputDir, fileName), `${content}\n`, 'utf-8');
  }
});
