import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/resolve-project-context.mjs');

interface ResolverResult {
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
    references: Array<{ label?: string; path?: string; url?: string; exists?: boolean }>;
    verificationPolicy: { requiredCommands: string[] };
    workflowPreferences: { defaultMode: string | null; preferredPreset: string | null };
    forbiddenChanges: string[];
  };
}

function runResolver(projectRoot: string, env?: NodeJS.ProcessEnv): ResolverResult {
  const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
    encoding: 'utf-8',
    env: env ?? process.env,
  });
  return JSON.parse(stdout) as ResolverResult;
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

describe('resolve-project-context.mjs — 缺 zod 降级路径', () => {
  let projectRoot: string;
  const SCHEMA_PATH = resolve('plugins/spec-driver/scripts/lib/project-profile-schema.mjs');
  const forceMissingEnv = { ...process.env, SPEC_DRIVER_FORCE_ZOD_MISSING: '1' };

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-zod-missing-'));
    mkdirSync(join(projectRoot, '.specify'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('AC-5：schema 模块在缺 zod 子进程加载不抛（无 ReferenceError / MODULE_NOT_FOUND）', () => {
    // 子进程 zodAvailable 必为 false → 退出码应为 0；若抛错则非 0
    const exitCode = execFileSync(
      'node',
      ['-e', `import('${SCHEMA_PATH.replace(/\\/g, '/')}').then(m => { process.exit(m.zodAvailable ? 1 : 0); }).catch(() => process.exit(2));`],
      { encoding: 'utf-8', env: forceMissingEnv },
    );
    // execFileSync 在退出码非 0 时抛错；能走到此处即退出码 0
    expect(exitCode).toBeDefined();
  });

  it('AC-1：缺 zod 时 resolver --json 退出码 0 且输出有效 JSON', () => {
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      ['product:', '  name: "Degraded Product"'].join('\n'),
      'utf-8',
    );
    // runResolver 内部 JSON.parse；不抛即退出码 0 + 有效 JSON
    const result = runResolver(projectRoot, forceMissingEnv);
    expect(result.source.usedSource).toBe('yaml');
  });

  it('AC-1：diagnostics 含且仅含一条 project-context.zod-unavailable warning', () => {
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      ['product:', '  name: "Degraded Product"'].join('\n'),
      'utf-8',
    );
    const result = runResolver(projectRoot, forceMissingEnv);
    const zodWarnings = result.diagnostics.filter(
      (d) => d.code === 'project-context.zod-unavailable',
    );
    expect(zodWarnings).toHaveLength(1);
    expect(zodWarnings[0].level).toBe('warning');
  });

  it('AC-3：缺 zod 降级路径 resolvedProfile shape 与正常路径等价', () => {
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      ['product:', '  name: "Degraded Product"'].join('\n'),
      'utf-8',
    );
    const degraded = runResolver(projectRoot, forceMissingEnv);
    const normal = runResolver(projectRoot);
    expect(Object.keys(degraded.resolvedProfile).sort()).toEqual(
      Object.keys(normal.resolvedProfile).sort(),
    );
    expect(degraded.resolvedProfile.verificationPolicy.requiredCommands).toBeDefined();
    expect(degraded.resolvedProfile.workflowPreferences).toBeDefined();
    expect(degraded.resolvedProfile.forbiddenChanges).toBeDefined();
  });

  it('W1：含前后空格的有效 reference 在降级路径与正常路径解析等价（trim）', () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'architecture.md'), '# architecture\n', 'utf-8');
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      [
        'product:',
        '  name: "Trim Product"',
        'references:',
        '  - label: "Arch"',
        '    path: " docs/architecture.md "',
      ].join('\n'),
      'utf-8',
    );

    const degraded = runResolver(projectRoot, forceMissingEnv);
    const normal = runResolver(projectRoot);

    // 正常路径 referenceEntrySchema 会 trim path → docs/architecture.md
    const normalRef = normal.resolvedProfile.references.find((r) => r.label === 'Arch');
    const degradedRef = degraded.resolvedProfile.references.find((r) => r.label === 'Arch');
    expect(normalRef?.path).toBe('docs/architecture.md');
    expect(degradedRef?.path).toBe('docs/architecture.md');
    expect(degradedRef?.exists).toBe(true);
    expect(degradedRef?.exists).toBe(normalRef?.exists);
  });

  it('C1：缺 zod 时非字符串 path 的 reference 被丢弃而不致崩溃，合法 reference 仍正常解析', () => {
    // simple-yaml 会把 `path: 123` 强转成 number；降级路径若原样带入，
    // 后续 path.resolve(projectRoot, 123) 会抛 ERR_INVALID_ARG_TYPE 导致 exit 1。
    // 修复后非字符串 path 应被丢弃 → 该 reference 既无 path 也无 url → 触发
    // project-context.invalid-reference warning + 被忽略；合法 string reference 不受影响。
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'valid.md'), '# valid\n', 'utf-8');
    writeFileSync(
      join(projectRoot, '.specify', 'project-context.yaml'),
      [
        'product:',
        '  name: "C1 Product"',
        'references:',
        '  - label: "Numeric Path"',
        '    path: 123',
        '  - label: "Valid Ref"',
        '    path: "docs/valid.md"',
      ].join('\n'),
      'utf-8',
    );

    // (a) 进程不抛、退出码 0；(b) stdout 为有效 JSON（runResolver 内部 JSON.parse 成功即满足）
    const result = runResolver(projectRoot, forceMissingEnv);

    // (c) diagnostics 含 project-context.invalid-reference
    expect(result.diagnostics.map((d) => d.code)).toContain(
      'project-context.invalid-reference',
    );

    // (d) 非法（数字 path）reference 不出现在 resolvedProfile.references / referenceSummary
    expect(
      result.resolvedProfile.references.some((r) => r.label === 'Numeric Path'),
    ).toBe(false);
    expect(result.referenceSummary.existing.some((r) => r.label === 'Numeric Path')).toBe(
      false,
    );
    expect(result.referenceSummary.missing.some((r) => r.label === 'Numeric Path')).toBe(
      false,
    );

    // (e) 合法 string reference 仍被正常解析
    const validRef = result.resolvedProfile.references.find((r) => r.label === 'Valid Ref');
    expect(validRef?.path).toBe('docs/valid.md');
    expect(validRef?.exists).toBe(true);
  });
});
