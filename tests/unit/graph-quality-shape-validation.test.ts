/**
 * F217 FIX-1（Codex CRITICAL）— GraphJSON 结构校验加深单测。
 *
 * 覆盖 Codex 给出的两例可证伪输入：
 * ① 顶层缺 directed/multigraph → 当前实现错误地 pass（未校验这两个字段），
 *    加深后必须判定结构无效（cannot-assess/json-parse-error 家族，CLI 层 exit 2）。
 * ② edge 缺 source/target（如 `{}`）→ 当前实现未校验 edge 形态，下游
 *    dangling-edge-check 会把 undefined 当悬空边处理，错误地判定为强不变量违反
 *    （exit 1）；加深后必须在进入引擎前就判定结构无效（exit 2），绝不进引擎。
 */
import { describe, expect, it } from 'vitest';
import { validateGraphJsonShape } from '../../src/cli/commands/graph-quality.js';

function validGraph(): unknown {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 0,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: [],
    links: [],
  };
}

describe('validateGraphJsonShape（FIX-1）', () => {
  it('合法最小 GraphJSON → true', () => {
    expect(validateGraphJsonShape(validGraph())).toBe(true);
  });

  it('Codex 红测试①：顶层缺 directed/multigraph → false（当前实现错误地 pass）', () => {
    const malformed = { graph: { schemaVersion: '2.0' }, nodes: [], links: [] };
    expect(validateGraphJsonShape(malformed)).toBe(false);
  });

  it('Codex 红测试②：edge 缺 source/target（`{}`）→ false（当前实现进入引擎并误判强失败）', () => {
    const malformed = {
      ...JSON.parse(JSON.stringify(validGraph())),
      links: [{}],
    };
    expect(validateGraphJsonShape(malformed)).toBe(false);
  });

  it('node 缺 id 或 id 为空字符串 → false', () => {
    const g1 = validGraph() as Record<string, unknown>;
    g1['nodes'] = [{ kind: 'module', label: 'x', metadata: {} }];
    expect(validateGraphJsonShape(g1)).toBe(false);

    const g2 = validGraph() as Record<string, unknown>;
    g2['nodes'] = [{ id: '', kind: 'module', label: 'x', metadata: {} }];
    expect(validateGraphJsonShape(g2)).toBe(false);
  });

  it('edge source/target 为非空 string 时通过；relation 缺失时仍通过（可选字段）', () => {
    const g = validGraph() as Record<string, unknown>;
    g['links'] = [{ source: 'a', target: 'b' }];
    expect(validateGraphJsonShape(g)).toBe(true);
  });

  it('edge relation 存在但非 string → false', () => {
    const g = validGraph() as Record<string, unknown>;
    g['links'] = [{ source: 'a', target: 'b', relation: 123 }];
    expect(validateGraphJsonShape(g)).toBe(false);
  });

  it('nodes/links 非 Array → false', () => {
    const g1 = validGraph() as Record<string, unknown>;
    g1['nodes'] = 'not-an-array';
    expect(validateGraphJsonShape(g1)).toBe(false);

    const g2 = validGraph() as Record<string, unknown>;
    g2['links'] = null;
    expect(validateGraphJsonShape(g2)).toBe(false);
  });

  it('graph 字段非 object → false', () => {
    const g = validGraph() as Record<string, unknown>;
    g['graph'] = 'not-an-object';
    expect(validateGraphJsonShape(g)).toBe(false);
  });

  it('顶层非 object（null/数组/原始值）→ false', () => {
    expect(validateGraphJsonShape(null)).toBe(false);
    expect(validateGraphJsonShape([])).toBe(false);
    expect(validateGraphJsonShape('foo')).toBe(false);
    expect(validateGraphJsonShape(42)).toBe(false);
  });
});
