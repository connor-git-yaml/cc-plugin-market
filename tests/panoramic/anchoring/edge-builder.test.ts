/**
 * edge-builder 单元测试
 * 覆盖：去重逻辑、INFERRED 边空 evidenceText 丢弃、evidenceText 截断、evidenceSource 格式、heading 整行保留
 * F232 链 E 追加：confidenceScore 出口量化（跨平台可复现）+ "去重仍用原始值" 的行为守护
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

// ============================================================
// F232 链 E：confidenceScore 出口量化
// ============================================================

describe('confidenceScore 出口量化（F232 链 E）', () => {
  /** 跑一遍 buildSemanticEdges，返回写出的 confidenceScore（经过出口量化） */
  function writtenScore(similarity: number): number {
    const edges = buildSemanticEdges({
      chunks: [makeChunk()],
      pairs: [makePair({ similarity })],
      codeNodes: [makeNode()],
      projectRoot: '/project',
    });
    expect(edges).toHaveLength(1);
    return edges[0].confidenceScore;
  }

  it('两个真实平台观测值收敛到同一字面量 0.7806（链 E 核心契约）', () => {
    // 同一输入在两个 CPU 架构上由 onnxruntime 产出不同 float32 embedding，
    // 传播到余弦相似度后差 4.37e-9（F232 fix-report 链 E 实测值）。
    const macOsArm64 = 0.780570518226505;
    const ubuntuX64 = 0.7805705225965378;
    expect(macOsArm64).not.toBe(ubuntuX64); // 前提：两个原始值确实不同

    expect(writtenScore(macOsArm64)).toBe(0.7806);
    expect(writtenScore(ubuntuX64)).toBe(0.7806);
    // 图谱产物与快照写出的是字符串，故序列化形态也必须逐字一致
    expect(String(writtenScore(macOsArm64))).toBe(String(writtenScore(ubuntuX64)));
  });

  it('边界值与 4 位格点值逐比特不变（0 / 1 / 0.15 / 既有单测用的 0.85 0.90 0.8 0.82）', () => {
    for (const score of [0, 1, 0.15, 0.85, 0.9, 0.8, 0.82]) {
      expect(writtenScore(score)).toBe(score);
    }
  });

  it('量化中点两侧舍入方向明确（half-up，中点本身归上格）', () => {
    // 4 位量化格点 0.1234 / 0.1235，中点 0.12345
    expect(writtenScore(0.1234499999)).toBe(0.1234); // 中点下方 → 归下格
    expect(writtenScore(0.1234500001)).toBe(0.1235); // 中点上方 → 归上格
    // 中点本身：0.12345 * 1e4 在 IEEE-754 下恰好落在 1234.5，
    // `Math.round` 的 half-up 是 ECMAScript 规范强制行为（非实现自由），故归上格且跨平台一致
    expect(0.12345 * 1e4).toBe(1234.5);
    expect(writtenScore(0.12345)).toBe(0.1235);
  });

  it('去重仍按原始相似度比较——量化不得提前到去重之前', () => {
    // 两条候选边三元组相同（同 filePath / 同 nodeId / 同 relation），
    // 原始相似度 0.800041 < 0.800049，但量化后都是 0.8。
    // 若把量化挪到去重之前，"高分胜出" 会退化成 "先到者胜出"，
    // 被选中的边（连同它的 evidenceText / evidenceSource）随之翻面。
    const chunks: DocChunk[] = [
      makeChunk({ startLine: 10, endLine: 20, text: '低分片段，这里提到 ingestData 函数。' }),
      makeChunk({ startLine: 30, endLine: 40, text: '高分片段，这里也提到 ingestData 函数。' }),
    ];
    // 低分在前、高分在后：只有"用原始值比较"才会让后来的高分覆盖先到的低分
    const pairs: SimilarPair[] = [
      { chunkIndex: 0, nodeId: 'src/pipeline.ts', similarity: 0.800041 },
      { chunkIndex: 1, nodeId: 'src/pipeline.ts', similarity: 0.800049 },
    ];

    const edges = buildSemanticEdges({
      chunks,
      pairs,
      codeNodes: [makeNode()],
      projectRoot: '/project',
    });

    expect(edges).toHaveLength(1);
    // 前提确认：两条候选量化后确实同值（否则本用例退化为普通去重测试）
    expect(writtenScore(0.800041)).toBe(0.8);
    expect(writtenScore(0.800049)).toBe(0.8);
    expect(edges[0].confidenceScore).toBe(0.8);
    // 关键断言：选中的必须是**原始值更高**的那条（chunkIndex 1）
    expect(edges[0].evidenceSource).toBe('docs/design.md:30-40');
    expect(edges[0].evidenceText).toContain('高分片段');
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
