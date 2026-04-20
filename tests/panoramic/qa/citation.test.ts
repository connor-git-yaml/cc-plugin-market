/**
 * citation.test.ts
 * T-017 单元测试：Citation 构建 + lineRange 越界检查
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCitations } from '../../../src/panoramic/qa/citation.js';
import type { GraphContext } from '../../../src/panoramic/qa/types.js';
import type { RerankResult } from '../../../src/panoramic/qa/rag-reranker.js';

// ============================================================
// Mock fs 模块（避免真实文件 IO）
// ============================================================

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
const mockReadFileSync = vi.mocked(fs.readFileSync);

// ============================================================
// Mock edge-builder（buildEvidenceText）
// ============================================================

vi.mock('../../../src/panoramic/anchoring/edge-builder.js', () => ({
  buildEvidenceText: vi.fn().mockImplementation((text: string) => text.slice(0, 200)),
}));

// ============================================================
// 测试辅助
// ============================================================

function makeEmptyGraphCtx(): GraphContext {
  return { bfsNodes: [], topChunks: [], hyperedges: [] };
}

function makeEmptyRerankResult(): RerankResult {
  return { rankedChunks: [] };
}

// ============================================================
// 测试套件
// ============================================================

describe('buildCitations', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('RAG 精排路径', () => {
    it('应从 rankedChunks 生成 citation', () => {
      mockReadFileSync.mockReturnValue('line1\n'.repeat(50));

      const rerankResult: RerankResult = {
        rankedChunks: [
          {
            chunk: {
              filePath: 'specs/auth.md',
              startLine: 5,
              endLine: 15,
              headingPath: '## Auth',
              text: '认证模块的设计说明',
              tokenCount: 20,
            },
            similarity: 0.85,
            nodeId: 'node-auth',
          },
        ],
      };

      const graphCtx: GraphContext = {
        bfsNodes: [{ id: 'node-auth', label: '认证模块', kind: 'module' }],
        topChunks: [],
        hyperedges: [],
      };

      const citations = buildCitations(rerankResult, graphCtx, [], '/project');

      expect(citations.length).toBeGreaterThan(0);
      const ragCitation = citations.find((c) => c.specPath === 'specs/auth.md');
      expect(ragCitation).toBeDefined();
      expect(ragCitation!.similarity).toBe(0.85);
      expect(ragCitation!.nodeId).toBe('node-auth');
    });

    it('lineRange 越界时应跳过该 citation 并记录 warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // mock 文件只有 10 行
      mockReadFileSync.mockReturnValue('line\n'.repeat(10));

      const rerankResult: RerankResult = {
        rankedChunks: [
          {
            chunk: {
              filePath: 'specs/auth.md',
              startLine: 50,   // 超出实际 10 行
              endLine: 60,
              headingPath: '## Auth',
              text: '认证模块',
              tokenCount: 10,
            },
            similarity: 0.80,
            nodeId: 'node-auth',
          },
        ],
      };

      const graphCtx: GraphContext = {
        bfsNodes: [{ id: 'node-auth', label: 'Auth', kind: 'module' }],
        topChunks: [],
        hyperedges: [],
      };

      const citations = buildCitations(rerankResult, graphCtx, [], '/project');

      const ragCitation = citations.find(
        (c) => c.specPath === 'specs/auth.md' && c.lineRange.startLine === 50,
      );
      expect(ragCitation).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lineRange 越界'));

      warnSpy.mockRestore();
    });
  });

  describe('Hyperedge 路径', () => {
    it('hyperedge citation 的 specPath 应为 [graph hyperedge]', () => {
      mockReadFileSync.mockReturnValue('line\n'.repeat(20));

      const graphCtx: GraphContext = {
        bfsNodes: [],
        topChunks: [],
        hyperedges: [
          {
            id: 'he-1',
            label: '认证流程',
            nodes: ['n1', 'n2', 'n3'],
            rationale: '跨模块认证协作',
            confidence: 'INFERRED',
          },
        ],
      };

      const citations = buildCitations(makeEmptyRerankResult(), graphCtx, [], '/project');

      const heCitation = citations.find((c) => c.specPath === '[graph hyperedge]');
      expect(heCitation).toBeDefined();
      expect(heCitation!.lineRange.startLine).toBe(0);
      expect(heCitation!.lineRange.endLine).toBe(0);
      expect(heCitation!.excerpt).toContain('跨模块认证协作');
    });
  });

  describe('Debt 路径', () => {
    it('债务 citation 应直接透传', () => {
      mockReadFileSync.mockReturnValue('line\n'.repeat(20));

      const debtCitations = [
        {
          specPath: 'src/auth.ts',
          lineRange: { startLine: 10, endLine: 10 },
          excerpt: 'TODO: 修复认证逻辑',
        },
      ];

      const citations = buildCitations(
        makeEmptyRerankResult(), makeEmptyGraphCtx(), debtCitations, '/project',
      );

      const debtCit = citations.find((c) => c.specPath === 'src/auth.ts');
      expect(debtCit).toBeDefined();
      expect(debtCit!.excerpt).toBe('TODO: 修复认证逻辑');
    });
  });

  describe('合并优先级', () => {
    it('RAG citation 应出现在 hyperedge citation 之前', () => {
      mockReadFileSync.mockReturnValue('line\n'.repeat(50));

      const rerankResult: RerankResult = {
        rankedChunks: [
          {
            chunk: {
              filePath: 'specs/auth.md',
              startLine: 1, endLine: 5,
              headingPath: '## Auth', text: '认证', tokenCount: 5,
            },
            similarity: 0.9,
            nodeId: 'n1',
          },
        ],
      };

      const graphCtx: GraphContext = {
        bfsNodes: [{ id: 'n1', label: '认证', kind: 'module' }],
        topChunks: [],
        hyperedges: [
          {
            id: 'he-1', label: 'flow',
            nodes: ['n1', 'n2', 'n3'],
            rationale: 'hyperedge rationale',
            confidence: 'INFERRED',
          },
        ],
      };

      const citations = buildCitations(rerankResult, graphCtx, [], '/project');

      const ragIdx = citations.findIndex((c) => c.specPath === 'specs/auth.md');
      const heIdx = citations.findIndex((c) => c.specPath === '[graph hyperedge]');

      expect(ragIdx).toBeGreaterThanOrEqual(0);
      expect(heIdx).toBeGreaterThanOrEqual(0);
      expect(ragIdx).toBeLessThan(heIdx);
    });
  });
});
