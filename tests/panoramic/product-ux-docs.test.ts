import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import { generateProductUxDocs } from '../../src/panoramic/product-ux-docs.js';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';

describe('generateProductUxDocs', () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'product-ux-docs-'));
    outputDir = path.join(projectRoot, 'specs');
    fs.mkdirSync(path.join(projectRoot, 'specs', 'products', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });

    fs.writeFileSync(
      path.join(projectRoot, 'README.md'),
      [
        '# Demo Product',
        '',
        'Demo Product 是一个面向团队协作的 SDK 与 CLI 组合工具，用于把结构化规格和产品文档沉淀到统一事实层。',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(projectRoot, 'docs', 'product-roadmap.md'),
      [
        '# Product Roadmap',
        '',
        '重点体验包括 onboarding、review 和 handoff 三类工作流。',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'),
      [
        '# Demo Product — 产品规范活文档',
        '',
        '## 1. 产品概述',
        '',
        'Demo Product 让开发者能够把工程事实、产品事实和文档输出编排到同一工作流中。',
        '',
        '## 3. 用户画像与场景',
        '',
        '| 角色 | 描述 | 主要使用场景 |',
        '| --- | --- | --- |',
        '| 平台工程师 | 负责维护工程基线与交付质量 | 构建文档包、检查质量门 |',
        '| 产品负责人 | 负责确认产品定位与用户场景 | 阅读产品概览、确认用户旅程 |',
        '',
        '1. Onboarding 新成员：快速理解系统的产品定位与技术架构',
        '2. 架构评审：围绕结构视图和 feature brief 对齐设计',
      ].join('\n'),
      'utf-8',
    );

    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      const joined = args.join(' ');
      if (command === 'git' && joined.includes('remote get-url origin')) {
        return {
          status: 0,
          stdout: 'https://github.com/example/demo-product.git\n',
          stderr: '',
        };
      }
      if (command === 'git' && joined.includes('log')) {
        return {
          status: 0,
          stdout: [
            'abc123',
            'feat(product): add bundle onboarding flow',
            '',
            '---END-COMMIT---',
          ].join('\n'),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'issue') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 12,
              title: 'Improve onboarding summary',
              body: 'Users need a clearer landing page and product overview.',
              state: 'open',
              labels: [{ name: 'ux' }],
              url: 'https://github.com/example/demo-product/issues/12',
            },
          ]),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'pr') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 34,
              title: 'Add architecture review bundle',
              body: 'This PR organizes architecture docs into a review-friendly bundle.',
              state: 'closed',
              labels: [{ name: 'docs' }],
              url: 'https://github.com/example/demo-product/pull/34',
            },
          ]),
          stderr: '',
        };
      }
      return {
        status: 1,
        stdout: '',
        stderr: 'unexpected command',
      };
    });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    spawnSyncMock.mockReset();
  });

  it('从 current-spec、README 与 GitHub issue/PR 生成产品概览、旅程和 feature brief', () => {
    const result = generateProductUxDocs({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot),
      generatedDocs: [],
    });

    expect(result.overview.summary.join('\n')).toContain('Demo Product');
    expect(result.overview.targetUsers.map((user) => user.name)).toEqual(
      expect.arrayContaining(['平台工程师', '产品负责人']),
    );
    expect(result.journeys.journeys.map((journey) => journey.title)).toEqual(
      expect.arrayContaining(['Onboarding 新成员', '架构评审']),
    );
    expect(result.featureBriefIndex.briefs.map((brief) => brief.id)).toEqual(
      expect.arrayContaining(['ISSUE-12', 'PR-34']),
    );
    expect(fs.existsSync(path.join(outputDir, 'product-overview.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'user-journeys.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'feature-briefs', 'index.md'))).toBe(true);
    expect(result.writtenFiles.some((filePath) => filePath.endsWith('feature-briefs/issue-12-improve-onboarding-summary.md'))).toBe(true);
  });
});

function createProjectContext(projectRoot: string): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'npm',
    workspaceType: 'single',
    detectedLanguages: ['ts-js'],
    existingSpecs: [],
  };
}
