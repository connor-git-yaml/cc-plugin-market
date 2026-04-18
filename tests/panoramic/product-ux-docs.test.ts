import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import { generateProductUxDocs } from '../../src/panoramic/pipelines/product-ux-docs.js';
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

  it('从 current-spec、README 与本地设计文档生成产品概览、旅程和 feature brief', () => {
    fs.mkdirSync(path.join(projectRoot, '.spectra-preview', 'docs', 'adr'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.spectra-preview', 'docs', 'adr', 'adr-0001-runtime.md'),
      [
        '---',
        'type: adr',
        'status: proposed',
        '---',
        '',
        '# ADR',
        '',
        'This should not be treated as a product design document.',
      ].join('\n'),
      'utf-8',
    );

    const result = generateProductUxDocs({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot),
    });

    expect(result.overview.summary.join('\n')).toContain('Demo Product');
    expect(result.overview.targetUsers.map((user) => user.name)).toEqual(
      expect.arrayContaining(['平台工程师', '产品负责人']),
    );
    expect(result.journeys.journeys.map((journey) => journey.title)).toEqual(
      expect.arrayContaining(['Onboarding 新成员', '架构评审']),
    );
    // feature briefs 现在由 journey 派生，ID 格式为 BRIEF-NN
    expect(result.featureBriefIndex.briefs.map((brief) => brief.id)).toEqual(
      expect.arrayContaining(['BRIEF-01', 'BRIEF-02']),
    );
    expect(result.overview.summary.join('\n')).not.toContain('type: adr');
    expect(result.overview.evidence.some((entry) => entry.path?.includes('.spectra-preview'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'product-overview.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'user-journeys.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'feature-briefs', 'index.md'))).toBe(true);
    // feature-briefs 现在基于旅程生成，文件名包含旅程标题
    expect(result.featureBriefIndex.briefs.length).toBeGreaterThanOrEqual(2);
    // 不含 GitHub warning
    expect(result.warnings.some((w) => w.includes('GitHub') || w.includes('gh CLI'))).toBe(false);
  });

  it('叙述型 README 无 current-spec 无 GitHub 时，从 Features 标题提取场景并生成 feature brief', () => {
    // 移除 current-spec，模拟纯 Python 项目
    fs.rmSync(path.join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'));

    // 用叙述型 README 替换（无列表，Features 标题下有段落描述）
    fs.writeFileSync(
      path.join(projectRoot, 'README.md'),
      [
        '# Graphify',
        '',
        'Graphify 是一个将代码仓库转换为知识图谱的 Python 工具，帮助开发者理解大型代码库的结构与依赖关系。',
        '',
        '## Features',
        '',
        '- Code Graph: 将代码文件解析为有向图，节点代表模块，边代表依赖关系',
        '- Community Detection: 使用社区发现算法自动识别功能模块簇',
        '- Export: 将图谱导出为 HTML 可视化或 JSON 格式',
        '',
        '## How it works',
        '',
        'Graphify 首先扫描项目目录，解析 Python import 语句，然后构建有向依赖图。',
        '社区检测算法在图上运行，将高度互联的模块聚类为功能组。',
      ].join('\n'),
      'utf-8',
    );

    // GitHub 不可用
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'git' && args.includes('get-url')) {
        return { status: 1, stdout: '', stderr: 'no remote' };
      }
      if (command === 'git' && args.includes('log')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'not available' };
    });

    const result = generateProductUxDocs({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot),
    });

    // 场景应从 README Features 标题下的列表项提取
    expect(result.overview.coreScenarios.length).toBeGreaterThan(0);
    // journeys 从 coreScenarios 派生，不应为空
    expect(result.journeys.journeys.length).toBeGreaterThan(0);
    // feature briefs 不应为空
    expect(result.featureBriefIndex.briefs.length).toBeGreaterThan(0);
  });

  it('parseMarkdownSections 正确解析以 ## 开头的第一个章节（index=0 不被 falsy 跳过）', () => {
    // 当 current-spec.md 第一行就是 ## 标题（index === 0）时，该章节不应被丢失
    fs.writeFileSync(
      path.join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'),
      [
        '## 产品概述',
        '',
        '这是一个以 ## 标题开头的文档，index 为 0，以前会被 !current?.index 错误跳过。',
        '',
        '## 用户画像与场景',
        '',
        '| 角色 | 描述 | 主要使用场景 |',
        '| --- | --- | --- |',
        '| 开发者 | 核心使用者 | 读文档 |',
      ].join('\n'),
      'utf-8',
    );

    const result = generateProductUxDocs({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot),
    });

    // 产品概述章节应被正确解析，不因 index=0 falsy 而丢失
    const summaryText = result.overview.summary.join('\n');
    expect(summaryText).toContain('以 ## 标题开头的文档');
    // 用户画像章节（第二个 ## 标题）也应被正确解析
    expect(result.overview.targetUsers.map((user) => user.name)).toContain('开发者');
  });

  it('extractParagraphs 过滤 badge 行、纯链接行和短于 20 字的行', () => {
    // 通过写一个含噪声内容的 README 间接验证过滤效果
    fs.rmSync(path.join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'));
    fs.writeFileSync(
      path.join(projectRoot, 'README.md'),
      [
        '# Test Project',
        '',
        '[![Build Status](https://img.shields.io/badge/build-passing-green)](https://ci.example.com)',
        '',
        '[View Documentation](https://docs.example.com)',
        '',
        'Short.',
        '',
        'This is a meaningful paragraph that describes the product in sufficient detail for extraction.',
      ].join('\n'),
      'utf-8',
    );

    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'git' && args.includes('get-url')) {
        return { status: 1, stdout: '', stderr: 'no remote' };
      }
      if (command === 'git' && args.includes('log')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'not available' };
    });

    const result = generateProductUxDocs({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot),
    });

    // 只有足够长的有意义段落应出现在 summary 中，badge/链接/短行被过滤
    const summaryText = result.overview.summary.join('\n');
    expect(summaryText).not.toContain('shields.io');
    expect(summaryText).not.toContain('docs.example.com');
    expect(summaryText).not.toContain('Short.');
    expect(summaryText).toContain('meaningful paragraph');
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
