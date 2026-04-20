/**
 * edge-builder 单元测试
 * 覆盖：去重逻辑、INFERRED 边空 evidenceText 丢弃、evidenceText 截断、evidenceSource 格式、heading 整行保留
 */
import { describe, it, expect } from 'vitest';
import { buildSemanticEdges, buildEvidenceText, type CodeNodeInfo } from '../../../src/panoramic/anchoring/edge-builder.js';
import type { DocChunk } from '../../../src/panoramic/anchoring/chunker.js';
import type { SimilarPair } from '../../../src/panoramic/anchoring/similarity.js';

// ============================================================
// 辅助数据
// ============================================================

function makeChunk(overrides: Partial<DocChunk> = {}): DocChunk {
  return {
    filePath: 'docs/design.md',
    startLine: 10,
    endLine: 20,
    headingPath: '## Design',
    text: 'This section describes the ingestData function behavior.',
    tokenCount: 50,
    ...overrides,
  };
}

function makePair(overrides: Partial<SimilarPair> = {}): SimilarPair {
  return {
    chunkIndex: 0,
    nodeId: 'src/pipeline.ts',
    similarity: 0.85,
    ...overrides,
  };
}

function makeNode(overrides: Partial<CodeNodeInfo> = {}): CodeNodeInfo {
  return {
    id: 'src/pipeline.ts',
    name: 'ingestData',
    ...overrides,
  };
}

// ============================================================
// 测试
// ============================================================

describe('buildSemanticEdges', () => {
  it('测试用例 1：去重逻辑——同一三元组出现两次，保留 confidence 最高版本', () => {
    const chunk = makeChunk();
    const node = makeNode();

    // pair1: similarity=0.85，pair2: similarity=0.90（同一三元组）
    const pairs: SimilarPair[] = [
      { chunkIndex: 0, nodeId: 'src/pipeline.ts', similarity: 0.85 },
      { chunkIndex: 0, nodeId: 'src/pipeline.ts', similarity: 0.90 },
    ];

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs,
      codeNodes: [node],
      projectRoot: '/project',
    });

    // 去重后只应有 1 条边
    expect(edges.length).toBe(1);
    // 保留 confidenceScore 较高的
    expect(edges[0].confidenceScore).toBeCloseTo(0.90, 2);
  });

  it('测试用例 2：INFERRED 边且 evidenceText 为空字符串时，该边被丢弃（返回空数组）', () => {
    // 空文本 chunk → buildEvidenceText 返回空字符串
    const chunk = makeChunk({ text: '' });
    const node = makeNode({ name: 'someFunc' });

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs: [makePair()],
      codeNodes: [node],
      projectRoot: '/project',
    });

    expect(edges).toHaveLength(0);
  });

  it('测试用例 3：evidenceText 对称截断——超过 200 字符时，结果 ≤ 200 字符', () => {
    // 构造超长文本，在中间包含函数名
    const prefix = 'A'.repeat(200);
    const suffix = 'B'.repeat(200);
    const chunk = makeChunk({
      text: prefix + ' ingestData ' + suffix,
    });
    const node = makeNode({ name: 'ingestData' });

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs: [makePair({ nodeId: 'src/pipeline.ts', similarity: 0.8 })],
      codeNodes: [node],
      projectRoot: '/project',
      maxEvidenceLength: 200,
    });

    expect(edges.length).toBe(1);
    expect(edges[0].evidenceText!.length).toBeLessThanOrEqual(200);
    // 应包含函数名（在 match 中心附近）
    expect(edges[0].evidenceText).toContain('ingestData');
  });

  it('测试用例 4：evidenceSource 格式正确（path:startLine-endLine，repo-relative）', () => {
    const chunk = makeChunk({
      filePath: 'docs/design.md',
      startLine: 15,
      endLine: 25,
    });
    const node = makeNode();

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs: [makePair()],
      codeNodes: [node],
      projectRoot: '/project',
    });

    expect(edges.length).toBe(1);
    expect(edges[0].evidenceSource).toBe('docs/design.md:15-25');
  });

  it('测试用例 5：heading 行整行纳入（以 ## 开头的行不被截断）', () => {
    const headingLine = '## Architecture Design';
    const chunk = makeChunk({
      text: headingLine + '\n' + 'Some content about ingestData function.\n' + 'More content here.',
      startLine: 1,
      endLine: 3,
    });
    const node = makeNode({ name: 'ingestData' });

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs: [makePair({ similarity: 0.82 })],
      codeNodes: [node],
      projectRoot: '/project',
    });

    expect(edges.length).toBe(1);
    // evidenceText 中应包含 ingestData（精确匹配）
    expect(edges[0].evidenceText).toContain('ingestData');
  });

  it('函数名精确出现在文本中时，边类型升级为 references', () => {
    const chunk = makeChunk({
      text: '文档描述了 ingestData 函数的功能和接口。',
    });
    const node = makeNode({ name: 'ingestData' });

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs: [makePair()],
      codeNodes: [node],
      projectRoot: '/project',
    });

    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('references');
  });

  it('函数名不在文本中时，边类型为 conceptually_related_to', () => {
    const chunk = makeChunk({
      text: '这段文字与管道处理相关，但没有提到具体函数名称。',
    });
    const node = makeNode({ name: 'ingestData' });

    const edges = buildSemanticEdges({
      chunks: [chunk],
      pairs: [makePair()],
      codeNodes: [node],
      projectRoot: '/project',
    });

    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('conceptually_related_to');
  });

  it('空 pairs 返回空数组', () => {
    const edges = buildSemanticEdges({
      chunks: [makeChunk()],
      pairs: [],
      codeNodes: [makeNode()],
      projectRoot: '/project',
    });
    expect(edges).toEqual([]);
  });
});

describe('buildEvidenceText', () => {
  it('包含匹配词时从 match 位置对称扩展', () => {
    const text = 'A'.repeat(50) + 'ingestData' + 'B'.repeat(50);
    const result = buildEvidenceText(text, 'ingestData', 200);
    expect(result).toContain('ingestData');
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('无匹配词时取文本开头', () => {
    const text = 'No function name here. Just some content.';
    const result = buildEvidenceText(text, 'nonexistent', 200);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('No function');
  });

  it('空文本返回空字符串', () => {
    expect(buildEvidenceText('', 'func', 200)).toBe('');
    expect(buildEvidenceText('  \n  ', 'func', 200)).toBe('');
  });

  it('超过 maxLength 时截断', () => {
    const text = 'x'.repeat(1000);
    const result = buildEvidenceText(text, 'xxx', 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});
