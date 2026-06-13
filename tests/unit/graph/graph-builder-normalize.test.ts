/**
 * F175 normalizeGraphForWrite 单测
 *
 * 验证写盘前归一化的 byte-stable 不变量：in-place（返回 void、数组引用不变）+
 * nodes/links/hyperedges 确定性排序 + stripTimestamps 剥时间戳 +
 * inputHash 的 stripVolatileFields/stableStringify 内容敏感性（FR-006/FR-007）。
 *
 * 注：T022 实现真实排序后，Phase 0 的"不改顺序/不剥时间戳"占位断言已不再成立，
 * 仅保留与真实实现一致的不变量（void 返回 + 数组引用稳定）。
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeGraphForWrite } from '../../../src/panoramic/graph/index.js';
// stripVolatileFields / stableStringify 未从 index 导出，直接从 graph-builder 导入（GREEN T023 实现）
import {
  stripVolatileFields,
  stableStringify,
  writeKnowledgeGraph,
} from '../../../src/panoramic/graph/graph-builder.js';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function makeGraph(): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-06-06T00:00:00.000Z',
      nodeCount: 3,
      edgeCount: 2,
      sources: ['architecture-ir'],
      inputHash: 'abcdef0123456789',
      schemaVersion: '2.0',
    },
    // 故意乱序（非字典序），用于证明 Phase 0 占位不重排
    nodes: [
      { id: 'zeta', kind: 'module', label: 'zeta' } as GraphJSON['nodes'][number],
      { id: 'alpha', kind: 'module', label: 'alpha' } as GraphJSON['nodes'][number],
      { id: 'mid', kind: 'module', label: 'mid' } as GraphJSON['nodes'][number],
    ],
    links: [
      { source: 'zeta', target: 'alpha', relation: 'depends-on' } as GraphJSON['links'][number],
      { source: 'alpha', target: 'mid', relation: 'calls' } as GraphJSON['links'][number],
    ],
  };
}

describe('normalizeGraphForWrite — in-place 不变量', () => {
  it('返回 void', () => {
    const graph = makeGraph();
    const result = normalizeGraphForWrite(graph);
    expect(result).toBeUndefined();
  });

  it('调用前后数组引用相同（in-place sort，不替换数组引用）', () => {
    const graph = makeGraph();
    const nodesRef = graph.nodes;
    const linksRef = graph.links;
    normalizeGraphForWrite(graph);
    expect(graph.nodes).toBe(nodesRef);
    expect(graph.links).toBe(linksRef);
  });
});

// ===== Phase 1 [RED]（T011）：byte-stable 排序 + inputHash 稳定化 =====
// 这些断言验证 GREEN（T022/T023）的目标行为，当前占位实现下全部 RED（功能未实现）。

describe('normalizeGraphForWrite — 写盘前确定性排序（T011 RED）', () => {
  it('归一化后 nodes 按 id 字典序排序', () => {
    const graph = makeGraph(); // 原序 zeta, alpha, mid
    normalizeGraphForWrite(graph);
    expect(graph.nodes.map((n) => n.id)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('归一化后 links 按 source + target + relation 三元组字典序排序', () => {
    const graph = makeGraph(); // 原序 zeta->alpha(depends-on), alpha->mid(calls)
    normalizeGraphForWrite(graph);
    // 排序键 = `${source}\x1f${target}\x1f${relation}`：alpha->mid 在 zeta->alpha 之前
    expect(graph.links.map((l) => `${l.source}->${l.target}:${l.relation}`)).toEqual([
      'alpha->mid:calls',
      'zeta->alpha:depends-on',
    ]);
  });

  it('stripTimestamps=true 时剥除 graph.generatedAt', () => {
    const graph = makeGraph();
    normalizeGraphForWrite(graph, { stripTimestamps: true });
    // 剥除后 generatedAt 应被归一化（空串或固定 epoch），不再是原始时间戳
    expect(graph.graph.generatedAt).not.toBe('2026-06-06T00:00:00.000Z');
  });
});

describe('inputHash 稳定化：stripVolatileFields + stableStringify（T011 RED）', () => {
  // 模拟 docGraph 结构：含易变 generatedAt + 稳定语义内容
  function makeDocGraph(generatedAt: string, payload: Record<string, unknown>): Record<string, unknown> {
    return { generatedAt, ...payload };
  }

  it('仅 generatedAt 不同、内容相同 → 剥时间戳后 stableStringify 一致（FR-006/FR-007）', () => {
    const dgA = makeDocGraph('2026-06-06T00:00:00.000Z', { specs: [{ id: 'm1' }, { id: 'm2' }] });
    const dgB = makeDocGraph('2030-12-31T23:59:59.999Z', { specs: [{ id: 'm1' }, { id: 'm2' }] });
    // stripVolatileFields 应移除 generatedAt → 两者序列化后逐字符相同 → hash 相同
    expect(sha256(stableStringify(stripVolatileFields(dgA)))).toBe(
      sha256(stableStringify(stripVolatileFields(dgB))),
    );
  });

  it('内容不同但 node 数相同 → hash 必须不同（禁止退化为 count 撞 hash，C-1）', () => {
    const dgA = makeDocGraph('2026-06-06T00:00:00.000Z', { specs: [{ id: 'm1' }, { id: 'm2' }] });
    // 同样 2 个 spec，但内容不同（id 改变）
    const dgB = makeDocGraph('2026-06-06T00:00:00.000Z', { specs: [{ id: 'X9' }, { id: 'Y8' }] });
    expect(sha256(stableStringify(stripVolatileFields(dgA)))).not.toBe(
      sha256(stableStringify(stripVolatileFields(dgB))),
    );
  });

  it('stableStringify 对 key 插入顺序不敏感（同内容不同 key 序 → 相同字符串）', () => {
    const a = { alpha: 1, beta: 2, gamma: 3 };
    const b = { gamma: 3, alpha: 1, beta: 2 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

// ===== F183 修复 1：writeKnowledgeGraph 写盘出口应用归一化（shared write boundary）=====
// Codex W-2：诚实命名 —— 此 unit 测的是「共用写盘出口契约」（writeKnowledgeGraph 内聚调用
// normalizeGraphForWrite），而非 graph/community/batch 三条 CLI 端到端路径。三路形态一致性
// 来自「均经过同一 writeKnowledgeGraph 出口」这一结构事实，本块用行为级测试（含 community
// 重写路径模拟）佐证，对函数改名 / 别名导入稳健（不会假绿）。

describe('writeKnowledgeGraph 写盘出口应用归一化（shared write boundary applies normalization，T-01）', () => {
  it('落盘后 nodes 按 id 字典序、links 按三元组字典序、currentRun 被剥除', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'f183-write-'));
    try {
      const graph: GraphJSON = {
        directed: false,
        multigraph: false,
        graph: {
          name: 'spectra-knowledge-graph',
          generatedAt: '2026-06-06T00:00:00.000Z',
          nodeCount: 3,
          edgeCount: 2,
          sources: ['architecture-ir'],
          inputHash: 'abcdef0123456789',
          schemaVersion: '2.0',
        },
        // 故意乱序 + 注入 currentRun 运行态字段（应被写盘出口剥除）
        nodes: [
          { id: 'zeta', kind: 'module', label: 'zeta', metadata: { currentRun: true } } as GraphJSON['nodes'][number],
          { id: 'alpha', kind: 'module', label: 'alpha', metadata: { currentRun: false } } as GraphJSON['nodes'][number],
          { id: 'mid', kind: 'module', label: 'mid' } as GraphJSON['nodes'][number],
        ],
        links: [
          { source: 'zeta', target: 'alpha', relation: 'depends-on' } as GraphJSON['links'][number],
          { source: 'alpha', target: 'mid', relation: 'calls' } as GraphJSON['links'][number],
        ],
      };

      const writtenPath = writeKnowledgeGraph(graph, tmp);
      const onDisk = JSON.parse(readFileSync(writtenPath, 'utf8')) as GraphJSON;

      // nodes 按 id 字典序
      expect(onDisk.nodes.map((n) => n.id)).toEqual(['alpha', 'mid', 'zeta']);
      // links 按 source + target + relation 三元组字典序
      expect(onDisk.links.map((l) => `${l.source}->${l.target}:${l.relation}`)).toEqual([
        'alpha->mid:calls',
        'zeta->alpha:depends-on',
      ]);
      // 无任何节点 metadata.currentRun 残留
      for (const node of onDisk.nodes) {
        expect(node.metadata?.currentRun).toBeUndefined();
      }
      // 注：hyperedge.nodes 成员顺序 / metadata key 顺序不在 F183 归一化契约内，本测试不断言此两项；
      // generatedAt 逐字节值（stripTimestamps:false 时各路独立）亦不断言。
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('共用写盘出口对 community 重写路径仍施加归一化（行为级，重构稳健，W-2）', () => {
    // 行为级模拟 community 重写路径：community 重写流程 = 读回已写盘 graph.json →
    // mutate 某节点 metadata → 再次经 writeKnowledgeGraph 写回。验证「共用写盘出口」契约：
    // 二次写盘仍归一化（字典序 + 剥 currentRun + generatedAt 不变）。比静态 source-grep 诚实，
    // 对函数改名 / 别名导入稳健（不会假绿）。
    const tmp = mkdtempSync(join(tmpdir(), 'f183-community-'));
    try {
      const graph: GraphJSON = {
        directed: false,
        multigraph: false,
        graph: {
          name: 'spectra-knowledge-graph',
          generatedAt: '2026-06-06T00:00:00.000Z',
          nodeCount: 3,
          edgeCount: 2,
          sources: ['architecture-ir'],
          inputHash: 'abcdef0123456789',
          schemaVersion: '2.0',
        },
        nodes: [
          { id: 'zeta', kind: 'module', label: 'zeta' } as GraphJSON['nodes'][number],
          { id: 'alpha', kind: 'module', label: 'alpha' } as GraphJSON['nodes'][number],
          { id: 'mid', kind: 'module', label: 'mid' } as GraphJSON['nodes'][number],
        ],
        links: [
          { source: 'zeta', target: 'alpha', relation: 'depends-on' } as GraphJSON['links'][number],
          { source: 'alpha', target: 'mid', relation: 'calls' } as GraphJSON['links'][number],
        ],
      };

      // ① 首次写盘（如 graph/batch 产出 graph.json）
      const firstPath = writeKnowledgeGraph(graph, tmp);
      const firstDisk = JSON.parse(readFileSync(firstPath, 'utf8')) as GraphJSON;
      expect(firstDisk.nodes.map((n) => n.id)).toEqual(['alpha', 'mid', 'zeta']);
      const firstGeneratedAt = firstDisk.graph.generatedAt;

      // ② 模拟 community 重写：读回写盘文件 → mutate 某节点 community 标注 + 注入运行态 currentRun
      const reloaded = JSON.parse(readFileSync(firstPath, 'utf8')) as GraphJSON;
      const target = reloaded.nodes.find((n) => n.id === 'mid')!;
      target.metadata = { ...(target.metadata ?? {}), community: '1', currentRun: true };

      // ③ community 重写后再次经共用出口写回
      const secondPath = writeKnowledgeGraph(reloaded, tmp);
      const secondDisk = JSON.parse(readFileSync(secondPath, 'utf8')) as GraphJSON;

      // 重写后仍字典序
      expect(secondDisk.nodes.map((n) => n.id)).toEqual(['alpha', 'mid', 'zeta']);
      // community 标注保留、运行态 currentRun 被剥除
      const midOnDisk = secondDisk.nodes.find((n) => n.id === 'mid')!;
      expect(midOnDisk.metadata?.community).toBe('1');
      for (const node of secondDisk.nodes) {
        expect(node.metadata?.currentRun).toBeUndefined();
      }
      // 默认 options 不改时间戳 → generatedAt 与首次写盘一致
      expect(secondDisk.graph.generatedAt).toBe(firstGeneratedAt);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('batch epoch 保留（T-02 防回归）', () => {
  it('默认 options（不传 stripTimestamps）写盘后 epoch generatedAt 保持不变', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'f183-epoch-'));
    try {
      const graph: GraphJSON = {
        directed: false,
        multigraph: false,
        graph: {
          name: 'spectra-knowledge-graph',
          generatedAt: '1970-01-01T00:00:00.000Z',
          nodeCount: 1,
          edgeCount: 0,
          sources: ['architecture-ir'],
          inputHash: 'abcdef0123456789',
          schemaVersion: '2.0',
        },
        nodes: [{ id: 'only', kind: 'module', label: 'only' } as GraphJSON['nodes'][number]],
        links: [],
      };

      const writtenPath = writeKnowledgeGraph(graph, tmp);
      const onDisk = JSON.parse(readFileSync(writtenPath, 'utf8')) as GraphJSON;
      // 默认 options 不应改写 epoch（normalizeGraphForWrite 仅在 stripTimestamps:true 时改时间戳）
      expect(onDisk.graph.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
