/**
 * report-builder 单元测试
 */
import { describe, it, expect } from 'vitest';
import { buildDebtReportMarkdown } from '../../src/debt-scanner/aggregator/report-builder.js';
import type {
  CodeDebtEntry,
  DebtDiagnostics,
  DebtMetrics,
  OpenQuestionEntry,
} from '../../src/debt-scanner/types.js';

function mkDiag(overrides: Partial<DebtDiagnostics> = {}): DebtDiagnostics {
  return {
    filesScanned: 0,
    filesSkipped: 0,
    totalLoc: 0,
    llmCalls: 0,
    docsScanned: 0,
    ruleCandidates: 0,
    llmCandidates: 0,
    messages: [],
    ...overrides,
  };
}

function mkMetrics(overrides: Partial<DebtMetrics> = {}): DebtMetrics {
  return {
    totalEntries: 0,
    byKind: { TODO: 0, FIXME: 0, HACK: 0, XXX: 0, NOTE: 0 },
    densityPerKloc: 0,
    oldestAgeDays: 0,
    openQuestionsCount: 0,
    ...overrides,
  };
}

const BASE = {
  diagnostics: mkDiag(),
  metrics: mkMetrics(),
  tokenUsage: { input: 0, output: 0 },
  durationMs: 100,
  languages: ['typescript'],
};

describe('buildDebtReportMarkdown', () => {
  it('空状态输出 "未识别出技术债"', () => {
    const md = buildDebtReportMarkdown({
      ...BASE,
      codeEntries: [],
      openQuestions: [],
    });
    expect(md).toContain('项目当前未识别出技术债');
    expect(md).toContain('generated: true');
  });

  it('frontmatter 包含 tokenUsage / durationMs / llmModel / fallbackReason', () => {
    const md = buildDebtReportMarkdown({
      ...BASE,
      codeEntries: [],
      openQuestions: [],
      tokenUsage: { input: 10, output: 5 },
      llmModel: 'stub-haiku',
      fallbackReason: 'dry-run',
    });
    expect(md).toContain('tokenUsage: {input: 10, output: 5}');
    expect(md).toContain('llmModel: stub-haiku');
    expect(md).toContain('fallbackReason: dry-run');
  });

  it('仅代码债务时 design-doc 节明确说明 "未识别出开放问题"', () => {
    const e: CodeDebtEntry = {
      kind: 'TODO', severity: 'warning', text: 'do it',
      filePath: 'a.ts', line: 3, symbol: 'foo', author: 'bob', ageDays: 10,
    };
    const md = buildDebtReportMarkdown({
      ...BASE,
      codeEntries: [e],
      openQuestions: [],
      metrics: mkMetrics({ totalEntries: 1, byKind: { TODO: 1, FIXME: 0, HACK: 0, XXX: 0, NOTE: 0 }, oldestAgeDays: 10 }),
    });
    expect(md).toContain('未识别出开放问题');
    expect(md).toMatch(/\| TODO \|/);
    expect(md).toContain('a.ts');
  });

  it('仅 open questions 时代码债务节说明 "未识别出代码注释债务"', () => {
    const q: OpenQuestionEntry = {
      snippet: 'Should we X?', docPath: 'notes.md', headingPath: '## Q', source: 'rule', topics: [],
    };
    const md = buildDebtReportMarkdown({
      ...BASE,
      codeEntries: [],
      openQuestions: [q],
      metrics: mkMetrics({ openQuestionsCount: 1 }),
    });
    expect(md).toContain('未识别出代码注释债务');
    expect(md).toContain('Should we X?');
  });

  it('按文档分组 open questions', () => {
    const md = buildDebtReportMarkdown({
      ...BASE,
      codeEntries: [],
      openQuestions: [
        { snippet: 'q1', docPath: 'a.md', headingPath: '#', source: 'rule', topics: [] },
        { snippet: 'q2', docPath: 'b.md', headingPath: '#', source: 'llm', topics: ['t1'] },
        { snippet: 'q3', docPath: 'a.md', headingPath: '#', source: 'rule', topics: [] },
      ],
      metrics: mkMetrics({ openQuestionsCount: 3 }),
    });
    expect(md).toMatch(/### a\.md\n[\s\S]*?### b\.md/);
    expect(md).toContain('主题: t1');
  });
});
