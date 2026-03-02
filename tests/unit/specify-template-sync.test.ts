/**
 * specify-template-sync 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureSpecifyTemplates } from '../../src/utils/specify-template-sync.js';

describe('ensureSpecifyTemplates', () => {
  let tempDir: string;
  let sourceDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specify-sync-test-'));
    sourceDir = path.join(tempDir, 'source');
    projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('会复制缺失模板到 .specify/templates', () => {
    const templates = [
      'plan-template.md',
      'spec-template.md',
      'tasks-template.md',
      'checklist-template.md',
      'constitution-template.md',
      'agent-file-template.md',
      // 调研模板（FR-001: 纳入同步体系）
      'product-research-template.md',
      'tech-research-template.md',
      'research-synthesis-template.md',
      'verification-report-template.md',
    ];
    for (const name of templates) {
      fs.writeFileSync(path.join(sourceDir, name), `# ${name}\n`, 'utf-8');
    }

    const result = ensureSpecifyTemplates(projectDir, {
      sourceDirs: [sourceDir],
    });

    expect(result.missing).toHaveLength(0);
    expect(result.copied).toHaveLength(10);
    expect(
      fs.existsSync(path.join(projectDir, '.specify', 'templates', 'plan-template.md')),
    ).toBe(true);
  });

  it('源目录不完整时返回 missing 列表', () => {
    fs.writeFileSync(path.join(sourceDir, 'plan-template.md'), '# plan\n', 'utf-8');
    const result = ensureSpecifyTemplates(projectDir, {
      sourceDirs: [sourceDir],
    });

    expect(result.copied).toContain('plan-template.md');
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing).toContain('spec-template.md');
  });

  it('幂等：已有文件不重复复制', () => {
    const planTarget = path.join(projectDir, '.specify', 'templates', 'plan-template.md');
    fs.mkdirSync(path.dirname(planTarget), { recursive: true });
    fs.writeFileSync(planTarget, '# existing\n', 'utf-8');
    fs.writeFileSync(path.join(sourceDir, 'plan-template.md'), '# source\n', 'utf-8');

    const result = ensureSpecifyTemplates(projectDir, {
      sourceDirs: [sourceDir],
    });

    expect(result.copied).not.toContain('plan-template.md');
    expect(fs.readFileSync(planTarget, 'utf-8')).toBe('# existing\n');
  });
});

