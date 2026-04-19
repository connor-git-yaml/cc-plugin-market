/**
 * 回归测试（Codex review Finding 2）：
 * batch-readme-generator 生成 specs/README.md 时必须自动包含 technical-debt.md 链接，
 * 否则 debt pipeline 写入的 README 链接会被步骤 7 重写 README 时清零。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateBatchReadme } from '../../src/batch/batch-readme-generator.js';

interface Fixture {
  outputDir: string;
}

function makeFixture(files: Record<string, string>): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-debt-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  return { outputDir: root };
}

describe('batch-readme-generator — 技术债链接', () => {
  it('project/technical-debt.md 存在时，生成的 README 含链接', () => {
    const { outputDir } = makeFixture({
      'project/technical-debt.md': '# 技术债\n',
    });
    const readme = generateBatchReadme({
      projectName: 'demo',
      version: '9.9.9',
      moduleSpecs: [],
      projectDocs: [],
      outputDir,
    });
    expect(readme).toContain('## 质量审计');
    expect(readme).toContain('[技术债清单（代码注释 + 设计开放问题）](project/technical-debt.md)');
  });

  it('无 technical-debt.md 时不出现相关链接', () => {
    const { outputDir } = makeFixture({});
    const readme = generateBatchReadme({
      projectName: 'demo',
      version: '9.9.9',
      moduleSpecs: [],
      projectDocs: [],
      outputDir,
    });
    expect(readme).not.toContain('technical-debt.md');
  });

  it('同时有 quality-report 和 technical-debt 时，两者都在质量审计节', () => {
    const { outputDir } = makeFixture({
      'project/quality-report.md': '# QR\n',
      'project/technical-debt.md': '# TD\n',
    });
    const readme = generateBatchReadme({
      projectName: 'demo',
      version: '9.9.9',
      moduleSpecs: [],
      projectDocs: [],
      outputDir,
    });
    const qualityIdx = readme.indexOf('## 质量审计');
    const qrIdx = readme.indexOf('质量报告');
    const tdIdx = readme.indexOf('技术债清单');
    expect(qualityIdx).toBeGreaterThan(-1);
    expect(qrIdx).toBeGreaterThan(qualityIdx);
    expect(tdIdx).toBeGreaterThan(qualityIdx);
  });
});
