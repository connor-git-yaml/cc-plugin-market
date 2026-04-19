/**
 * debt-intelligence-pipeline 单元/集成测试
 *
 * 使用临时 fixture 跑端到端路径：
 * - 生成 technical-debt.md
 * - 存在 quality-report.md 时追加节
 * - 存在 specs/README.md 有 "质量审计" 节时插入链接
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateDebtIntelligence } from '../../../src/panoramic/pipelines/debt-intelligence-pipeline.js';
import { LanguageAdapterRegistry } from '../../../src/adapters/language-adapter-registry.js';
import { TsJsLanguageAdapter } from '../../../src/adapters/ts-js-adapter.js';
import { resetBlameCache } from '../../../src/utils/git-blame.js';

function makeFixture(files: Record<string, string>): { projectRoot: string; specsDir: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-pl-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(projectRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  const specsDir = path.join(projectRoot, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  return { projectRoot, specsDir };
}

function freshRegistry(): LanguageAdapterRegistry {
  LanguageAdapterRegistry.resetInstance();
  const r = LanguageAdapterRegistry.getInstance();
  r.register(new TsJsLanguageAdapter());
  return r;
}

describe('generateDebtIntelligence pipeline', () => {
  beforeEach(() => {
    resetBlameCache();
  });

  it('生成 technical-debt.md，包含代码注释债务', async () => {
    const { projectRoot, specsDir } = makeFixture({
      'src/foo.ts': [
        '// TODO: refactor me',
        'export function foo() { return 1; }',
      ].join('\n'),
    });
    const registry = freshRegistry();
    const res = await generateDebtIntelligence({
      projectRoot,
      specsDir,
      registry,
    });
    expect(res.generated).toBe(true);
    expect(res.entriesCount).toBe(1);
    expect(res.outputPath).toBe('project/technical-debt.md');
    const md = fs.readFileSync(path.join(specsDir, 'project', 'technical-debt.md'), 'utf-8');
    expect(md).toContain('TODO');
    expect(md).toContain('refactor me');
  });

  it('空项目输出 "未识别出技术债"', async () => {
    const { projectRoot, specsDir } = makeFixture({
      'src/foo.ts': 'export const a = 1;\n',
    });
    const registry = freshRegistry();
    const res = await generateDebtIntelligence({
      projectRoot,
      specsDir,
      registry,
    });
    expect(res.generated).toBe(true);
    expect(res.entriesCount).toBe(0);
    const md = fs.readFileSync(path.join(specsDir, 'project', 'technical-debt.md'), 'utf-8');
    expect(md).toContain('项目当前未识别出技术债');
  });

  it('quality-report.md 存在时追加节', async () => {
    const { projectRoot, specsDir } = makeFixture({
      'src/foo.ts': '// FIXME urgent\nexport const x = 1;',
      'specs/project/quality-report.md': '# Quality\n\n## Required Docs\n\n- a\n',
    });
    const registry = freshRegistry();
    const res = await generateDebtIntelligence({ projectRoot, specsDir, registry });
    expect(res.generated).toBe(true);
    expect(res.qualityReportPatched).toBe(true);
    const qr = fs.readFileSync(path.join(specsDir, 'project', 'quality-report.md'), 'utf-8');
    expect(qr).toContain('## 技术债');
  });

  it('pipeline 不再直接修改 specs/README.md（由 batch-readme-generator 统一拥有）', async () => {
    // Codex review 修复后：debt pipeline 在 batch 路径上 README 会被步骤 7 重写，
    // 所以 pipeline 显式 skip README 索引，避免假阳性。README 链接由 batch-readme-generator 根据
    // project/technical-debt.md 是否存在自动生成（见 tests/unit/batch-readme-generator.test.ts）。
    const { projectRoot, specsDir } = makeFixture({
      'src/foo.ts': '// FIXME urgent\nexport const x = 1;',
      'specs/README.md': '# Specs\n\n## 质量审计\n\n- [coverage](coverage.md)\n\n',
    });
    const registry = freshRegistry();
    const res = await generateDebtIntelligence({ projectRoot, specsDir, registry });
    expect(res.generated).toBe(true);
    expect(res.readmeIndexed).toBe(false);
    // technical-debt.md 仍被写入
    const tdPath = path.join(specsDir, 'project', 'technical-debt.md');
    expect(fs.existsSync(tdPath)).toBe(true);
  });

  it('无 design-doc 时 open-question 节明确为空', async () => {
    const { projectRoot, specsDir } = makeFixture({
      'src/foo.ts': '// TODO do it\nexport const x = 1;',
    });
    const registry = freshRegistry();
    const res = await generateDebtIntelligence({ projectRoot, specsDir, registry });
    expect(res.openQuestionsCount).toBe(0);
    const md = fs.readFileSync(path.join(specsDir, 'project', 'technical-debt.md'), 'utf-8');
    expect(md).toContain('未识别出开放问题');
  });
});
