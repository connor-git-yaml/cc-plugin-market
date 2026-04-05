import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/resolve-project-context.mjs');

function runResolver(projectRoot: string) {
  const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
    encoding: 'utf-8',
  });
  return JSON.parse(stdout) as {
    source: {
      usedSource: string;
      usedPath: string | null;
      yamlExists: boolean;
      markdownExists: boolean;
    };
    projectContextBlock: string;
    onlineResearch: {
      required: boolean;
      minPoints: number;
      maxPoints: number;
      preferredTools: string[];
    };
    referenceSummary: {
      existing: Array<{ label: string; path: string | null }>;
      missing: Array<{ label: string; path: string | null }>;
    };
    diagnostics: Array<{ level: string; code: string; message: string }>;
    resolvedProfile: {
      verificationPolicy: { requiredCommands: string[] };
      workflowPreferences: { defaultMode: string | null; preferredPreset: string | null };
      forbiddenChanges: string[];
    };
  };
}

describe('resolve-project-context.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-project-context-'));
    mkdirSync(join(projectRoot, '.specify'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('优先读取 canonical YAML，并输出 diagnostics 与引用存在性', () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'architecture.md'), '# architecture\n', 'utf-8');
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      [
        'product:',
        '  name: "Demo Product"',
        '  summary: "Resolver test"',
        'owner:',
        '  name: "Platform Team"',
        'references:',
        '  - label: "Architecture Notes"',
        '    path: "docs/architecture.md"',
        '  - path: "docs/missing.md"',
        'architecture_constraints:',
        '  - "Keep CLI thin"',
        'verification_policy:',
        '  required_commands:',
        '    - "npm test"',
        '  require_real_execution: true',
        'research_policy:',
        '  online_required: true',
        '  min_points: 2',
        '  max_points: 4',
        '  preferred_tools:',
        '    - "perplexity"',
        'workflow_preferences:',
        '  default_mode: "feature"',
        '  preferred_preset: "quality-first"',
        'forbidden_changes:',
        '  - "Do not rename public CLI commands"',
        'notes:',
        '  - "Prefer additive changes"',
        'phase_focus:',
        '  - "implementation"',
        'extra_field: "ignored"',
      ].join('\n'),
      'utf-8',
    );

    const result = runResolver(projectRoot);

    expect(result.source.usedSource).toBe('yaml');
    expect(result.onlineResearch).toEqual({
      required: true,
      minPoints: 2,
      maxPoints: 4,
      preferredTools: ['perplexity'],
      source: 'yaml',
    });
    expect(result.projectContextBlock).toContain('Architecture Notes: docs/architecture.md');
    expect(result.projectContextBlock).not.toContain('docs/missing.md');
    expect(result.referenceSummary.existing).toEqual([
      expect.objectContaining({ label: 'Architecture Notes', path: 'docs/architecture.md' }),
    ]);
    expect(result.referenceSummary.missing).toEqual([
      expect.objectContaining({ path: 'docs/missing.md' }),
    ]);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'project-context.excluded-field',
        'project-context.unknown-field',
        'project-context.missing-reference',
      ]),
    );
  });

  it('yaml 与 markdown 并存时只读取 YAML，并返回迁移 warning', () => {
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      ['product:', '  name: "Canonical Product"'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.md'),
      ['# Product', '', 'Legacy Product'].join('\n'),
      'utf-8',
    );

    const result = runResolver(projectRoot);

    expect(result.source.usedSource).toBe('yaml');
    expect(result.projectContextBlock).toContain('Canonical Product');
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'project-context.legacy-md-shadowed',
    );
  });

  it('仅存在 markdown 时走 legacy fallback', () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'design.md'), '# design\n', 'utf-8');
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.md'),
      [
        '# Product',
        'Legacy Product',
        '',
        '# References',
        '- [Design Doc](docs/design.md)',
        '',
        '# Research Policy',
        '- 使用 perplexity',
        '- min_points: 1',
        '- max_points: 3',
        '',
        '# Verification Policy',
        '- 必跑 `npm test`',
        '',
        '# Workflow Preferences',
        '- default_mode: story',
        '- preferred_preset: balanced',
        '',
        '# Forbidden Changes',
        '- 不要重命名公开接口',
      ].join('\n'),
      'utf-8',
    );

    const result = runResolver(projectRoot);

    expect(result.source.usedSource).toBe('markdown-legacy');
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'project-context.legacy-md',
    );
    expect(result.onlineResearch.required).toBe(true);
    expect(result.onlineResearch.minPoints).toBe(1);
    expect(result.onlineResearch.maxPoints).toBe(3);
    expect(result.resolvedProfile.verificationPolicy.requiredCommands).toEqual(['npm test']);
    expect(result.resolvedProfile.workflowPreferences.defaultMode).toBe('story');
    expect(result.resolvedProfile.workflowPreferences.preferredPreset).toBe('balanced');
    expect(result.resolvedProfile.forbiddenChanges).toEqual(['不要重命名公开接口']);
    expect(existsSync(join(projectRoot, 'docs', 'design.md'))).toBe(true);
    expect(result.referenceSummary.existing).toEqual([
      expect.objectContaining({ path: 'docs/design.md' }),
    ]);
  });
});
