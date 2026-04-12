import { describe, it, expect } from 'vitest';
import { GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';

describe('GraphQueryEngine budget 硬上限', () => {
  it('broad query + budget:1 → nodes.length ≤ 1', () => {
    // 构造包含 5 个节点的图，标签都包含 "auth"
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'auth-service', label: 'auth-service', kind: 'module', metadata: { description: 'auth service' } },
        { id: 'auth-middleware', label: 'auth-middleware', kind: 'module', metadata: { description: 'auth middleware' } },
        { id: 'auth-controller', label: 'auth-controller', kind: 'module', metadata: { description: 'auth controller' } },
        { id: 'auth-utils', label: 'auth-utils', kind: 'module', metadata: { description: 'auth utils' } },
        { id: 'auth-types', label: 'auth-types', kind: 'module', metadata: { description: 'auth types' } },
      ],
      links: [
        { source: 'auth-service', target: 'auth-middleware', relation: 'import', confidence: 1 },
        { source: 'auth-middleware', target: 'auth-controller', relation: 'import', confidence: 1 },
      ],
    };

    const engine = new GraphQueryEngine(graphJson as any);
    const result = engine.query('auth', { budget: 1 });

    expect(result.nodes.length).toBeLessThanOrEqual(1);
  });

  it('budget >= 匹配数时返回所有匹配（不截断）', () => {
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'auth-a', label: 'auth-a', kind: 'module', metadata: { description: 'auth a' } },
        { id: 'auth-b', label: 'auth-b', kind: 'module', metadata: { description: 'auth b' } },
      ],
      links: [],
    };

    const engine = new GraphQueryEngine(graphJson as any);
    const result = engine.query('auth', { budget: 10 });

    expect(result.truncated).toBe(false);
    expect(result.nodes.length).toBe(2);
  });

  it('budget:2 返回不超过 2 个节点', () => {
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'auth-service', label: 'auth-service', kind: 'module', metadata: { description: 'auth service' } },
        { id: 'auth-middleware', label: 'auth-middleware', kind: 'module', metadata: { description: 'auth middleware' } },
        { id: 'auth-controller', label: 'auth-controller', kind: 'module', metadata: { description: 'auth controller' } },
        { id: 'auth-utils', label: 'auth-utils', kind: 'module', metadata: { description: 'auth utils' } },
        { id: 'auth-types', label: 'auth-types', kind: 'module', metadata: { description: 'auth types' } },
      ],
      links: [],
    };

    const engine = new GraphQueryEngine(graphJson as any);
    const result = engine.query('auth', { budget: 2 });

    expect(result.nodes.length).toBeLessThanOrEqual(2);
  });
});
