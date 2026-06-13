/**
 * Feature 193 T020 — 同 commit 跨 worktree byte 一致断言（FR-016 / SC-002）。
 *
 * 验证：两个不同伪 projectRoot（不同路径深度）从含**绝对路径** key 的等价输入构建，
 * 序列化（strip 时间戳）后 byte 相等，排除 external 节点（FR-004）。
 *
 * 覆盖字段（plan-C5/W4）：graph.json 的 node.id / edge.source/target /
 * metadata.sourcePath/sourceFile/sourceTarget / hyperedge 引用（GraphNode 无顶层 filePath）；
 * 以及 buildUnifiedGraph 出口相对化后 metadata.projectRoot='.'。
 */
import { describe, it, expect } from 'vitest';
import { buildUnifiedGraph } from '../../../src/knowledge-graph/index.js';
import {
  buildKnowledgeGraph,
  normalizeGraphForWrite,
  scanGraphPortabilityViolations,
} from '../../../src/panoramic/graph/graph-builder.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

/** 构造含**绝对路径** key 的 CodeSkeleton map（模拟真实 batch 抽取产物） */
function mkSkeletons(root: string): Map<string, CodeSkeleton> {
  const sk = (filePath: string, partial: Partial<CodeSkeleton>): CodeSkeleton => ({
    filePath,
    language: 'typescript',
    loc: 100,
    imports: [],
    exports: [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-05-08T10:00:00.000Z',
    parserUsed: 'tree-sitter',
    callSites: [],
    ...partial,
  });
  return new Map<string, CodeSkeleton>([
    [
      `${root}/src/main.ts`,
      sk(`${root}/src/main.ts`, {
        imports: [
          {
            moduleSpecifier: './util',
            isRelative: true,
            resolvedPath: `${root}/src/util.ts`,
            namedImports: ['helper'],
            isTypeOnly: false,
          },
        ],
        callSites: [{ calleeName: 'helper', calleeKind: 'cross-module', line: 3 }],
        exports: [
          { name: 'main', kind: 'function', signature: 'function main()', isDefault: false, startLine: 1, endLine: 5 },
        ],
      }),
    ],
    [
      `${root}/src/util.ts`,
      sk(`${root}/src/util.ts`, {
        exports: [
          { name: 'helper', kind: 'function', signature: 'function helper()', isDefault: false, startLine: 1, endLine: 3 },
        ],
      }),
    ],
  ]);
}

function serializeForWorktree(root: string): string {
  const unifiedGraph = buildUnifiedGraph({ projectRoot: root, codeSkeletons: mkSkeletons(root) });
  const graph = buildKnowledgeGraph({ unifiedGraph });
  normalizeGraphForWrite(graph, { stripTimestamps: true });
  return JSON.stringify(graph, null, 2);
}

describe('Feature 193 — 跨 worktree byte 一致（SC-002 / FR-016）', () => {
  it('两个不同深度 projectRoot 构建出 byte-identical graph.json', () => {
    const a = serializeForWorktree('/Users/dev/wt-shallow');
    const b = serializeForWorktree('/home/ci/agents/very/deep/nested/wt');
    expect(a).toBe(b);
  });

  it('相对化后 node.id / edge.source/target 不含绝对路径前缀', () => {
    const out = serializeForWorktree('/Users/dev/wt-a');
    // 不应残留任意 worktree 绝对前缀
    expect(out).not.toContain('/Users/dev/wt-a');
    // 关键相对 id 存在
    expect(out).toContain('src/main.ts');
    expect(out).toContain('src/util.ts::helper');
  });

  it('writeKnowledgeGraph portable 守卫（T012）：相对化产物 0 违例', () => {
    const root = '/Users/dev/wt-guard';
    const unifiedGraph = buildUnifiedGraph({ projectRoot: root, codeSkeletons: mkSkeletons(root) });
    const graph = buildKnowledgeGraph({ unifiedGraph });
    const scan = scanGraphPortabilityViolations(graph);
    expect(scan.count).toBe(0);
  });

  it('portable 守卫能检出未相对化的绝对 id 泄漏', () => {
    const root = '/Users/dev/wt-leak';
    const graph = buildKnowledgeGraph({
      unifiedGraph: {
        // 故意注入绝对 id（模拟 producer 漏改）
        nodes: [{ id: `${root}/src/leak.ts`, kind: 'module', label: 'leak.ts', filePath: `${root}/src/leak.ts` }],
        edges: [],
      },
    });
    const scan = scanGraphPortabilityViolations(graph);
    expect(scan.count).toBeGreaterThan(0);
    expect(scan.samples.some((s) => s.includes('/src/leak.ts'))).toBe(true);
  });

  it('external 节点（绝对路径 + external 标记）不计入守卫违例（FR-004）', () => {
    const graph = buildKnowledgeGraph({
      unifiedGraph: {
        nodes: [
          {
            id: '/Users/dev/node_modules/zod/index.ts',
            kind: 'module',
            label: 'index.ts',
            filePath: '/Users/dev/node_modules/zod/index.ts',
            metadata: { external: true },
          },
        ],
        edges: [],
      },
    });
    const scan = scanGraphPortabilityViolations(graph);
    expect(scan.count).toBe(0);
  });

  it('external 标记不豁免 sourceFile/sourceTarget 泄漏（Codex implement-W2 回归）', () => {
    // 直接构造 GraphJSON：external 节点的 id + sourcePath（自身在 node_modules 的合法绝对身份）
    // 应豁免，但 sourceFile（另一条关系映射）的绝对路径仍须检出——不被 external 整节点跳过掩盖。
    const graphJson: GraphJSON = {
      directed: true,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-06-13T00:00:00.000Z',
        nodeCount: 1,
        edgeCount: 0,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
      },
      nodes: [
        {
          id: '/Users/dev/node_modules/zod/index.ts',
          kind: 'module',
          label: 'index.ts',
          metadata: {
            external: true,
            sourcePath: '/Users/dev/node_modules/zod/index.ts', // 自身文件，external 合法豁免
            sourceFile: '/abs/leak/elsewhere.ts', // 不同关系映射的绝对泄漏，须检出
          },
        },
      ],
      links: [],
    };
    const scan = scanGraphPortabilityViolations(graphJson);
    // 仅 sourceFile 计违例（id 与 sourcePath 因 external 豁免）
    expect(scan.count).toBe(1);
    expect(scan.samples.some((s) => s.includes('sourceFile') && s.includes('/abs/leak/elsewhere.ts'))).toBe(true);
  });
});
