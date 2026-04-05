import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function importScriptModule<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(resolve(relativePath)).href) as Promise<T>;
}

describe('workflow-registry core module', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'workflow-registry-core-'));
    mkdirSync(join(projectRoot, '.specify', 'workflows'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('override 只保留 metadata 字段并记录 warnings', async () => {
    const { readWorkflowOverrides } = await importScriptModule<{
      readWorkflowOverrides: (overrideDir: string, warnings: string[]) => Map<string, Record<string, unknown>>;
    }>('plugins/spec-driver/scripts/lib/workflow-registry-core.mjs');

    writeFileSync(
      join(projectRoot, '.specify', 'workflows', 'spec-driver-story.yaml'),
      [
        'id: "spec-driver-story"',
        'persona: "项目级迭代开发者"',
        'recommendedWhen:',
        '  - "团队内部常规迭代"',
        'entryCommand:',
        '  claude: "/should-be-ignored"',
      ].join('\n'),
      'utf-8',
    );

    const warnings: string[] = [];
    const overrides = readWorkflowOverrides(join(projectRoot, '.specify', 'workflows'), warnings);

    expect(overrides.get('spec-driver-story')).toEqual({
      persona: '项目级迭代开发者',
      recommendedWhen: ['团队内部常规迭代'],
    });
    expect(warnings).toEqual([
      'workflow override 忽略非 metadata 字段: spec-driver-story.entryCommand',
    ]);
  });

  it('markdown renderer 输出 golden path、workflow detail 与 warnings', async () => {
    const { renderWorkflowIndexMarkdown } = await importScriptModule<{
      renderWorkflowIndexMarkdown: (index: {
        generatedAt: string;
        sourceDir: string;
        overrideDir: string | null;
        workflowCount: number;
        goldenPathCount: number;
        workflows: Array<{
          id: string;
          title: string;
          persona: string;
          useCases: string[];
          requiredInputs: string[];
          keyGates: string[];
          artifacts: string[];
          recommendedWhen: string[];
          templateVersion: string;
          entryCommand: { claude?: string; codex?: string };
        }>;
        goldenPaths: Array<{
          id: string;
          title: string;
          persona: string;
          workflows: string[];
          recommendedWhen: string[];
        }>;
        warnings: string[];
      }) => string;
    }>('plugins/spec-driver/scripts/lib/workflow-registry-core.mjs');

    const markdown = renderWorkflowIndexMarkdown({
      generatedAt: '2026-04-05T00:00:00.000Z',
      sourceDir: 'plugins/spec-driver/workflows',
      overrideDir: '.specify/workflows',
      workflowCount: 1,
      goldenPathCount: 1,
      workflows: [
        {
          id: 'spec-driver-feature',
          title: '新功能研发',
          persona: '实施负责人',
          useCases: ['新能力开发'],
          requiredInputs: ['feature brief'],
          keyGates: ['GATE_DESIGN'],
          artifacts: ['spec.md'],
          recommendedWhen: ['需要完整 spec-driver 流程'],
          templateVersion: '1.0.0',
          entryCommand: {
            claude: '/spec-driver:spec-driver-feature <需求描述>',
            codex: '$spec-driver-feature <需求描述>',
          },
        },
      ],
      goldenPaths: [
        {
          id: 'new-feature-delivery',
          title: '新功能研发',
          persona: '实施负责人',
          workflows: ['spec-driver-feature', 'spec-driver-sync'],
          recommendedWhen: ['产品级增量功能'],
        },
      ],
      warnings: ['override 忽略 entryCommand'],
    });

    expect(markdown).toContain('# Spec Driver Workflow Registry');
    expect(markdown).toContain('## Golden Paths');
    expect(markdown).toContain('### 新功能研发');
    expect(markdown).toContain('spec-driver-feature');
    expect(markdown).toContain('override 忽略 entryCommand');
  });
});
