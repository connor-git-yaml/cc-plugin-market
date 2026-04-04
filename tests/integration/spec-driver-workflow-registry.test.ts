import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/generate-workflow-registry.mjs');

describe('generate-workflow-registry.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-workflow-registry-'));
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('生成 workflow-index markdown/json，并应用 metadata-only override', () => {
    mkdirSync(join(projectRoot, '.specify', 'workflows'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.specify', 'workflows', 'spec-driver-story.yaml'),
      [
        'id: spec-driver-story',
        'persona: "项目级迭代开发者"',
        'recommendedWhen:',
        '  - "团队内部的常规迭代需求"',
        'entryCommand:',
        '  claude: "/should-not-override"',
      ].join('\n'),
      'utf-8',
    );

    const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      workflowCount: number;
      goldenPathCount: number;
      jsonPath: string;
      markdownPath: string;
      workflows: Array<{
        id: string;
        persona: string;
        recommendedWhen: string[];
        entryCommand: { claude?: string };
      }>;
      warnings: string[];
    };

    expect(payload.workflowCount).toBe(6);
    expect(payload.goldenPathCount).toBe(3);
    expect(payload.jsonPath).toBe('specs/products/spec-driver/workflow-index.json');
    expect(payload.markdownPath).toBe('specs/products/spec-driver/workflow-index.md');

    const storyWorkflow = payload.workflows.find((workflow) => workflow.id === 'spec-driver-story');
    expect(storyWorkflow?.persona).toBe('项目级迭代开发者');
    expect(storyWorkflow?.recommendedWhen).toEqual(['团队内部的常规迭代需求']);
    expect(storyWorkflow?.entryCommand.claude).toBe('/spec-driver:spec-driver-story <需求描述>');
    expect(payload.warnings).toEqual(expect.arrayContaining([
      'workflow override 忽略非 metadata 字段: spec-driver-story.entryCommand',
    ]));

    const jsonIndex = JSON.parse(
      readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'workflow-index.json'), 'utf-8'),
    ) as {
      goldenPaths: Array<{ id: string; workflows: string[] }>;
    };
    expect(jsonIndex.goldenPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'new-feature-delivery',
        workflows: ['spec-driver-feature', 'spec-driver-sync', 'spec-driver-doc'],
      }),
      expect.objectContaining({
        id: 'rapid-fix-delivery',
        workflows: ['spec-driver-fix', 'spec-driver-sync'],
      }),
      expect.objectContaining({
        id: 'product-facts-refresh',
        workflows: ['spec-driver-sync', 'spec-driver-doc'],
      }),
    ]));

    const markdownIndex = readFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', 'workflow-index.md'),
      'utf-8',
    );
    expect(markdownIndex).toContain('# Spec Driver Workflow Registry');
    expect(markdownIndex).toContain('## 如何选择技能');
    expect(markdownIndex).toContain('### 新功能研发');
    expect(markdownIndex).toContain('### 快速修复');
    expect(markdownIndex).toContain('### 产品事实与文档更新');
  });
});
