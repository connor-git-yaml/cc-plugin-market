/**
 * Feature 140 T28 — buildDesignDocAbsPaths 扩展逻辑单测
 *
 * 覆盖 spec FR-007：扩展 design doc 来源
 * - 来源 3: 根 README.md（不区分大小写）
 * - 来源 4: docs/ 目录递归扫描 .md（--include-docs=true）
 * - 来源 5: modulesDir/*.spec.md（当前 batch 产物）
 * - 来源 6: .specify/project-context.{yaml,md}
 *
 * 与既有 fromDocs / fromDisk 测试（tests/unit/batch-orchestrator.test.ts）互补。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildDesignDocAbsPaths } from '../../src/batch/batch-orchestrator.js';

let tmpDir: string;
let projectRoot: string;
let outputDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-doc-paths-'));
  projectRoot = path.join(tmpDir, 'project-root');
  outputDir = path.join(tmpDir, 'output');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildDesignDocAbsPaths — Feature 140 T27 扩展来源 (FR-007)', () => {
  it('case 1: 仅 README.md 存在（新项目首次 batch）→ paths.length >= 1', () => {
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeReadme: true,
    });
    expect(result.paths.length).toBeGreaterThanOrEqual(1);
    expect(result.fromReadmeCount).toBe(1);
    expect(result.paths.some((p) => p.endsWith('README.md'))).toBe(true);
  });

  it('case 2: includeReadme=false → README 不被加入', () => {
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeReadme: false,
    });
    expect(result.fromReadmeCount).toBe(0);
    expect(result.paths.length).toBe(0);
  });

  it('case 3: README + docs/ 多层 .md → 包含全部（includeDocs=true）', () => {
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test');
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'docs', 'guide'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'overview.md'), '# Overview');
    fs.writeFileSync(path.join(projectRoot, 'docs', 'guide', 'install.md'), '# Install');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeReadme: true,
      includeDocs: true,
    });
    expect(result.fromReadmeCount).toBe(1);
    expect(result.fromDocsDirCount).toBe(2); // overview.md + guide/install.md
    expect(result.paths.length).toBeGreaterThanOrEqual(3);
  });

  it('case 4: includeDocs=false → docs/ 不被扫描（向后兼容默认）', () => {
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'unread.md'), '# Should not');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir);
    // 默认 includeReadme=true / includeProjectContext=true，但 includeDocs 默认 false
    expect(result.fromDocsDirCount).toBe(0);
  });

  it('case 5: docs/ 排除 node_modules / .git / dist 黑名单', () => {
    fs.mkdirSync(path.join(projectRoot, 'docs', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'node_modules', 'fake.md'), '# fake');
    fs.mkdirSync(path.join(projectRoot, 'docs', 'real'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'real', 'doc.md'), '# real');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeDocs: true,
    });
    expect(result.fromDocsDirCount).toBe(1); // 只 real/doc.md，node_modules 被跳过
    expect(result.paths.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('case 6: modulesDir 含 *.spec.md → 全部加入 fromModuleSpecs', () => {
    const modulesDir = path.join(outputDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    fs.writeFileSync(path.join(modulesDir, 'auth.spec.md'), '# auth');
    fs.writeFileSync(path.join(modulesDir, 'db.spec.md'), '# db');
    fs.writeFileSync(path.join(modulesDir, 'index.md'), '# index'); // 非 .spec.md
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      modulesDir,
    });
    expect(result.fromModuleSpecsCount).toBe(2);
    expect(result.paths.some((p) => p.endsWith('auth.spec.md'))).toBe(true);
    expect(result.paths.some((p) => p.endsWith('db.spec.md'))).toBe(true);
    expect(result.paths.some((p) => p.endsWith('modules/index.md'))).toBe(false);
  });

  it('case 7: .specify/project-context.yaml 存在 → 加入 fromProjectContext', () => {
    fs.mkdirSync(path.join(projectRoot, '.specify'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.specify', 'project-context.yaml'),
      'projectName: test',
    );
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeProjectContext: true,
    });
    expect(result.fromProjectContextCount).toBe(1);
  });

  it('case 8: includeProjectContext=false → 不加入', () => {
    fs.mkdirSync(path.join(projectRoot, '.specify'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.specify', 'project-context.yaml'),
      'projectName: test',
    );
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeProjectContext: false,
    });
    expect(result.fromProjectContextCount).toBe(0);
  });

  it('case 9: 文件不存在时被静默过滤（向后兼容 + 防御性）', () => {
    // projectRoot 完全空，所有来源应返回 0
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeReadme: true,
      includeDocs: true,
      includeProjectContext: true,
      modulesDir: path.join(outputDir, 'nonexistent-modules'),
    });
    expect(result.paths.length).toBe(0);
    expect(result.fromReadmeCount).toBe(0);
    expect(result.fromDocsDirCount).toBe(0);
    expect(result.fromModuleSpecsCount).toBe(0);
    expect(result.fromProjectContextCount).toBe(0);
  });

  it('case 10: 全部来源同时启用 → 去重合并 + count 聚合', () => {
    // README + docs/ + module specs + project-context + writtenFiles + outputDir/project/
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# r');
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'a.md'), '# a');
    fs.mkdirSync(path.join(projectRoot, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.specify', 'project-context.md'), '# pc');
    const modulesDir = path.join(outputDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    fs.writeFileSync(path.join(modulesDir, 'm.spec.md'), '# m');
    fs.mkdirSync(path.join(outputDir, 'project'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'project', 'p.md'), '# p');
    fs.writeFileSync(path.join(projectRoot, 'written.md'), '# w');

    const result = buildDesignDocAbsPaths(['written.md'], projectRoot, outputDir, {
      includeReadme: true,
      includeDocs: true,
      modulesDir,
      includeProjectContext: true,
    });
    expect(result.fromReadmeCount).toBe(1);
    expect(result.fromDocsDirCount).toBe(1);
    expect(result.fromModuleSpecsCount).toBe(1);
    expect(result.fromProjectContextCount).toBe(1);
    expect(result.fromDocsCount).toBe(1); // writtenFiles
    expect(result.fromDiskCount).toBe(1); // outputDir/project/
    expect(result.paths.length).toBe(6); // 全部独立路径
  });

  it('case 11: 不传 extraOptions → 默认 includeReadme=true / includeDocs=false / includeProjectContext=true（向后兼容）', () => {
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# r');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir);
    // 默认行为：README 自动加入
    expect(result.fromReadmeCount).toBe(1);
  });

  it('case 12: project-context.yaml 与 .md 共存 → 仅取 yaml（修复 Codex C-2，docs/shared/agent-context-layering.md 规则）', () => {
    fs.mkdirSync(path.join(projectRoot, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.specify', 'project-context.yaml'), 'projectName: test');
    fs.writeFileSync(path.join(projectRoot, '.specify', 'project-context.md'), '# legacy');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeProjectContext: true,
    });
    expect(result.fromProjectContextCount).toBe(1); // canonical yaml 优先，md 不重复加入
    expect(result.paths.some((p) => p.endsWith('.yaml'))).toBe(true);
    expect(result.paths.some((p) => p.endsWith('project-context.md'))).toBe(false);
  });

  it('case 13: 仅 project-context.md 存在（无 yaml）→ fallback 取 md', () => {
    fs.mkdirSync(path.join(projectRoot, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.specify', 'project-context.md'), '# legacy only');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeProjectContext: true,
    });
    expect(result.fromProjectContextCount).toBe(1);
    expect(result.paths.some((p) => p.endsWith('project-context.md'))).toBe(true);
  });

  it('case 14: docs/ 黑名单扩展 — 跳过 __pycache__/target/.cache/tmp 等（修复 Codex W-2）', () => {
    fs.mkdirSync(path.join(projectRoot, 'docs', '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', '__pycache__', 'gen.md'), '# pyc');
    fs.mkdirSync(path.join(projectRoot, 'docs', 'target'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'target', 'rust.md'), '# rust');
    fs.mkdirSync(path.join(projectRoot, 'docs', '.cache'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', '.cache', 'cache.md'), '# cache');
    fs.mkdirSync(path.join(projectRoot, 'docs', 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'tmp', 'tmp.md'), '# tmp');
    fs.mkdirSync(path.join(projectRoot, 'docs', 'real'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'real', 'doc.md'), '# real');
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeDocs: true,
    });
    // 只有 real/doc.md 应被收集
    expect(result.fromDocsDirCount).toBe(1);
    expect(result.paths.some((p) => p.includes('__pycache__'))).toBe(false);
    expect(result.paths.some((p) => p.includes('docs/target'))).toBe(false);
    expect(result.paths.some((p) => p.includes('.cache'))).toBe(false);
    expect(result.paths.some((p) => p.includes('docs/tmp'))).toBe(false);
  });

  it('case 15: modulesDir 不存在 → 静默忽略（防御性）', () => {
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      modulesDir: path.join(outputDir, 'absolutely-nonexistent-dir'),
    });
    expect(result.fromModuleSpecsCount).toBe(0);
    // 不应抛异常
  });

  it('case 16: 部分缺失组合 — README 在但 docs 不在', () => {
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# r');
    // 不创建 docs 目录
    const result = buildDesignDocAbsPaths([], projectRoot, outputDir, {
      includeReadme: true,
      includeDocs: true, // 启用但目录不存在
    });
    expect(result.fromReadmeCount).toBe(1);
    expect(result.fromDocsDirCount).toBe(0); // docs/ 不存在 → 0
  });
});
