import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  orchestrateDocsBundle,
} from '../../src/panoramic/pipelines/docs-bundle-orchestrator.js';
import {
  DOCS_BUNDLE_MANIFEST_FILE,
} from '../../src/panoramic/models/docs-bundle-types.js';
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
    writeDoc('interface-surface.md', '# interface-surface');
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
      'interface-surface.md',
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

describe('docs-bundle-orchestrator (outputDir 在 projectRoot 之外)', () => {
  // baseline-collect 场景：outputDir 位于 ~/.spectra-baselines/<project>-output/，
  // 不在 projectRoot 内。此前 toProjectPath 在该场景返回绝对路径，writeProfiles
  // 的 path.join(projectRoot, absPath) 会把绝对路径前缀拼到 projectRoot 下，
  // 导致 worktree 出现意外的 Users/.../ 目录树（worktree 污染）。
  let workspace: string;
  let projectRoot: string;
  let outputDir: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-bundle-baseline-'));
    projectRoot = path.join(workspace, 'project');
    outputDir = path.join(workspace, 'baseline-output');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    seedDoc('architecture-narrative.md', '# architecture-narrative');
    seedDoc('architecture-overview.md', '# architecture-overview');
    seedDoc('runtime-topology.md', '# runtime-topology');
    seedDoc('workspace-index.md', '# workspace-index');
    seedDoc('config-reference.md', '# config-reference');
    seedDoc('pattern-hints.md', '# pattern-hints');
    seedDoc('cross-package-analysis.md', '# cross-package-analysis');
    seedDoc('interface-surface.md', '# interface-surface');
    seedDoc('api-surface.md', '# api-surface');
    seedDoc('data-model.md', '# data-model');
    seedDoc('event-surface.md', '# event-surface');
    seedDoc('troubleshooting.md', '# troubleshooting');
    seedDoc('_index.spec.md', '# architecture index');
    seedDoc('api.spec.md', '# api spec');
    seedDoc('worker.spec.md', '# worker spec');
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('bundle 产物写入 outputDir，不污染 projectRoot', () => {
    orchestrateDocsBundle({ projectRoot, outputDir });

    expect(fs.existsSync(path.join(outputDir, 'bundles', 'developer-onboarding', 'mkdocs.yml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'bundles', 'developer-onboarding', 'docs', 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'bundles', 'api-consumer', 'mkdocs.yml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'bundles', 'ops-handover', 'mkdocs.yml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'bundles', 'architecture-review', 'mkdocs.yml'))).toBe(true);

    // projectRoot 应保持空（编排不应在其下写入任何文件）
    expect(fs.readdirSync(projectRoot)).toEqual([]);
  });

  it('manifest 写入 outputDir 且不污染 projectRoot', () => {
    orchestrateDocsBundle({ projectRoot, outputDir });

    expect(fs.existsSync(path.join(outputDir, DOCS_BUNDLE_MANIFEST_FILE))).toBe(true);
    expect(fs.readdirSync(projectRoot)).toEqual([]);
  });

  it('metaDir 在 outputDir 下时，manifest 写入 metaDir 不污染 projectRoot', () => {
    // 复刻 batch-orchestrator 真实调用形态：传入 metaDir 让 manifest 落到 _meta/ 子目录。
    const metaDir = path.join(outputDir, '_meta');
    orchestrateDocsBundle({ projectRoot, outputDir, metaDir });

    expect(fs.existsSync(path.join(metaDir, DOCS_BUNDLE_MANIFEST_FILE))).toBe(true);
    expect(fs.readdirSync(projectRoot)).toEqual([]);
  });

  function seedDoc(fileName: string, content: string): void {
    fs.writeFileSync(path.join(outputDir, fileName), `${content}\n`, 'utf-8');
  }
});
