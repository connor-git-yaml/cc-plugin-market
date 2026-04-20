/**
 * debt-context.test.ts
 * T-016 单元测试：关键词路由 + ageDays 排序 + citation 格式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDebtContext, isDebtQuestion } from '../../../src/panoramic/qa/debt-context.js';
import type { ScanProjectDebtOptions } from '../../../src/debt-scanner/index.js';

// ============================================================
// Mock scanProjectDebt
// ============================================================

vi.mock('../../../src/debt-scanner/index.js', () => ({
  scanProjectDebt: vi.fn(),
}));

import { scanProjectDebt } from '../../../src/debt-scanner/index.js';
const mockScanProjectDebt = vi.mocked(scanProjectDebt);

function makeDebtReport(entries: Array<{ line: number; filePath: string; ageDays: number; text: string; kind?: 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'NOTE' }>) {
  return {
    codeEntries: entries.map((e) => ({
      kind: (e.kind ?? 'TODO') as 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'NOTE',
      severity: 'warning' as const,
      text: e.text,
      filePath: e.filePath,
      line: e.line,
      symbol: null,
      author: 'test-author',
      ageDays: e.ageDays,
    })),
    openQuestions: [],
    diagnostics: {
      filesScanned: 1, filesSkipped: 0, totalLoc: 100, llmCalls: 0,
      docsScanned: 0, ruleCandidates: 1, llmCandidates: 0, messages: [],
    },
    metrics: {
      totalEntries: entries.length,
      byKind: { TODO: entries.length, FIXME: 0, HACK: 0, XXX: 0, NOTE: 0 } as Record<'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'NOTE', number>,
      densityPerKloc: 0,
      oldestAgeDays: 0,
      openQuestionsCount: 0,
    },
    tokenUsage: { input: 0, output: 0 },
    durationMs: 10,
  };
}

const mockRegistry = {} as ScanProjectDebtOptions['registry'];

// ============================================================
// 测试套件
// ============================================================

describe('isDebtQuestion', () => {
  it('包含 TODO 时应返回 true', () => {
    expect(isDebtQuestion('哪里有 TODO 需要处理')).toBe(true);
  });

  it('包含 FIXME 时应返回 true', () => {
    expect(isDebtQuestion('FIXME 的代码在哪里')).toBe(true);
  });

  it('包含技术债时应返回 true', () => {
    expect(isDebtQuestion('有哪些技术债需要优先处理')).toBe(true);
  });

  it('包含最老时应返回 true', () => {
    expect(isDebtQuestion('最老的 TODO 是哪个')).toBe(true);
  });

  it('大小写不敏感：todo 也应匹配', () => {
    expect(isDebtQuestion('show all todo items')).toBe(true);
  });

  it('普通问题不应匹配', () => {
    expect(isDebtQuestion('什么调用了认证模块')).toBe(false);
  });
});

describe('injectDebtContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('不含关键词时', () => {
    it('应返回 triggered=false 且不调用 scanProjectDebt', async () => {
      const result = await injectDebtContext('什么调用了认证模块', '/project', mockRegistry);

      expect(result.triggered).toBe(false);
      expect(result.citations).toEqual([]);
      expect(mockScanProjectDebt).not.toHaveBeenCalled();
    });
  });

  describe('含关键词时', () => {
    it('应调用 scanProjectDebt 并返回 triggered=true', async () => {
      mockScanProjectDebt.mockResolvedValue(makeDebtReport([
        { line: 10, filePath: 'src/auth.ts', ageDays: 30, text: 'TODO: 修复认证逻辑' },
      ]));

      const result = await injectDebtContext('最老的 TODO 在哪', '/project', mockRegistry);

      expect(result.triggered).toBe(true);
      expect(mockScanProjectDebt).toHaveBeenCalledOnce();
    });

    it('应按 ageDays 倒序排列 citations', async () => {
      mockScanProjectDebt.mockResolvedValue(makeDebtReport([
        { line: 1, filePath: 'src/a.ts', ageDays: 10, text: '较新的 TODO' },
        { line: 2, filePath: 'src/b.ts', ageDays: 90, text: '最老的 TODO' },
        { line: 3, filePath: 'src/c.ts', ageDays: 50, text: '中等的 TODO' },
      ]));

      const result = await injectDebtContext('最老的 TODO', '/project', mockRegistry);

      expect(result.citations[0]?.specPath).toBe('src/b.ts');
      expect(result.citations[1]?.specPath).toBe('src/c.ts');
      expect(result.citations[2]?.specPath).toBe('src/a.ts');
    });

    it('应限制返回 topN 条（默认 5）', async () => {
      const manyEntries = Array.from({ length: 8 }, (_, i) => ({
        line: i + 1, filePath: `src/file-${i}.ts`, ageDays: i * 10, text: `TODO ${i}`,
      }));
      mockScanProjectDebt.mockResolvedValue(makeDebtReport(manyEntries));

      const result = await injectDebtContext('TODO 处理', '/project', mockRegistry);

      expect(result.citations.length).toBeLessThanOrEqual(5);
    });

    it('citation 格式应包含 specPath、lineRange、excerpt', async () => {
      mockScanProjectDebt.mockResolvedValue(makeDebtReport([
        { line: 42, filePath: 'src/auth/login.ts', ageDays: 60, text: '需要重构这段登录逻辑' },
      ]));

      const result = await injectDebtContext('技术债', '/project', mockRegistry);

      const citation = result.citations[0];
      expect(citation).toBeDefined();
      expect(citation!.specPath).toBe('src/auth/login.ts');
      expect(citation!.lineRange.startLine).toBe(42);
      expect(citation!.lineRange.endLine).toBe(42);
      expect(citation!.excerpt).toBeTruthy();
    });

    it('excerpt 应截断至 200 字符', async () => {
      const longText = 'A'.repeat(300);
      mockScanProjectDebt.mockResolvedValue(makeDebtReport([
        { line: 1, filePath: 'src/a.ts', ageDays: 10, text: longText },
      ]));

      const result = await injectDebtContext('FIXME', '/project', mockRegistry);

      expect(result.citations[0]?.excerpt.length).toBeLessThanOrEqual(200);
    });
  });

  describe('scanProjectDebt 失败时', () => {
    it('应返回 triggered=true 但 citations 为空，不抛出异常', async () => {
      mockScanProjectDebt.mockRejectedValue(new Error('磁盘 IO 错误'));

      const result = await injectDebtContext('TODO 修复', '/project', mockRegistry);

      expect(result.triggered).toBe(true);
      expect(result.citations).toEqual([]);
    });
  });
});
