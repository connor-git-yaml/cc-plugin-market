/**
 * F271 T004 / FR-007 / SC-002 — lineRange 消费侧激活验证（真实生产链路，非手工 graph fixture）。
 *
 * 与 `tests/unit/mcp/file-nav-tools.test.ts` 既有用例的区别：那些用例手工构造带 lineRange 的
 * graph.json 来测消费端切片逻辑（该逻辑本就正确）；本文件跑的是**真实生产链路**
 *   CodeSkeleton → buildUnifiedGraph → buildKnowledgeGraph → writeKnowledgeGraph → graph.json
 *                → handleViewFile / handleContext
 * 从而证明 F271 改动后，lineRange 能自然地从建图端流到消费端——这正是此前 4 个写入点缺失时
 * 断裂、且手工 fixture 测不出来的那一段。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildUnifiedGraph, setCurrentUnifiedGraph } from '../../src/knowledge-graph/index.js';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../../src/panoramic/graph/graph-builder.js';
import { handleViewFile } from '../../src/mcp/file-nav-tools.js';
import { handleContext } from '../../src/mcp/agent-context-tools.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { ToolResult } from '../../src/mcp/lib/tool-response.js';

let root: string;

function parse(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

/** 源文件：`namedFn` 真实占 3-5 行，`Widget` class 占 7-11 行（1-based）。 */
const SOURCE = [
  '// line 1',
  '// line 2',
  'export function namedFn(): number {',
  '  return 42;',
  '}',
  '',
  'export class Widget {',
  '  render(): void {',
  '    /* body */',
  '  }',
  '}',
  '',
].join('\n');

/**
 * 走真实建图链路落盘 graph.json。
 * 行号取自 SOURCE 中符号的真实跨度，与 tree-sitter 会给出的 span 口径一致。
 */
function buildRealGraph(rootDir: string): void {
  const skeleton: CodeSkeleton = {
    filePath: 'src/a.ts',
    language: 'typescript',
    loc: 12,
    exports: [
      {
        name: 'namedFn',
        kind: 'function',
        signature: 'function namedFn(): number',
        isDefault: false,
        startLine: 3,
        endLine: 5,
      },
      {
        name: 'Widget',
        kind: 'class',
        signature: 'class Widget',
        isDefault: false,
        startLine: 7,
        endLine: 11,
        members: [{ name: 'render', kind: 'method', signature: 'render(): void', isStatic: false }],
      },
    ],
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-08-31T00:00:00.000Z',
    parserUsed: 'tree-sitter',
  };

  const unified = buildUnifiedGraph({
    projectRoot: rootDir,
    codeSkeletons: new Map([['src/a.ts', skeleton]]),
  });
  const graph = buildKnowledgeGraph({ unifiedGraph: unified });
  writeKnowledgeGraph(graph, path.join(rootDir, 'specs'), {
    builderProvenance: 'stamp-this-build',
  });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'f271-lr-')));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.ts'), SOURCE);
  buildRealGraph(root);
});

afterEach(() => {
  setCurrentUnifiedGraph(null);
  rmSync(root, { recursive: true, force: true });
});

describe('F271 FR-007 — view_file 按真实生产链路产出的 lineRange 切片', () => {
  it('view_file(path, symbolId) 返回该 symbol 的行区间切片，而非整份文件', async () => {
    const r = await handleViewFile({
      path: 'src/a.ts',
      symbolId: 'src/a.ts::namedFn',
      projectRoot: root,
    });
    expect(r.isError).toBeUndefined();
    const p = parse(r);

    const lines = p['lines'] as string[];
    // 精确落在 3-5 行（不再是整份 12 行文件）
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('3\texport function namedFn(): number {');
    expect(lines[2]).toBe('5\t}');
    expect(p['startLine']).toBe(3);
    expect(p['endLine']).toBe(5);
  });

  it('symbolId 与显式行区间同存 → symbolId-overrides-lines warning 被真实链路触发', async () => {
    const r = await handleViewFile({
      path: 'src/a.ts',
      symbolId: 'src/a.ts::namedFn',
      startLine: 1,
      endLine: 2,
      projectRoot: root,
    });
    expect(r.isError).toBeUndefined();
    const p = parse(r);
    expect(p['warnings'] as string[]).toContain('symbolId-overrides-lines');
    // symbolId 胜出：返回的是 3-5 而非用户传的 1-2
    expect(p['startLine']).toBe(3);
    expect(p['endLine']).toBe(5);
  });

  it('class 级 symbol 同样可切片（覆盖 class span 而非 member）', async () => {
    const r = await handleViewFile({
      path: 'src/a.ts',
      symbolId: 'src/a.ts::Widget',
      projectRoot: root,
    });
    const p = parse(r);
    expect(p['startLine']).toBe(7);
    expect(p['endLine']).toBe(11);
  });

  it('FR-002：member 节点无 lineRange → 不切片，回落整窗口（诚实缺席不伪造定位）', async () => {
    const r = await handleViewFile({
      path: 'src/a.ts',
      symbolId: 'src/a.ts::Widget.render',
      projectRoot: root,
    });
    expect(r.isError).toBeUndefined();
    const p = parse(r);
    // 无 lineRange ⇒ sym.start 非 number ⇒ 不覆盖行区间，退回默认窗口（整份短文件）
    expect(p['startLine']).not.toBe(8);
    expect((p['lines'] as string[]).length).toBeGreaterThan(3);
  });
});

describe('F271 FR-007 / SC-002 — context.definition 携带 lineStart / lineEnd', () => {
  it('context 返回的 definition 首次出现 lineStart/lineEnd 且数值正确', async () => {
    const r = await handleContext({ symbolId: 'src/a.ts::namedFn', projectRoot: root });
    expect(r.isError).toBeUndefined();
    const p = parse(r);

    const def = p['definition'] as Record<string, unknown>;
    expect(def).toBeDefined();
    expect(def['lineStart']).toBe(3);
    expect(def['lineEnd']).toBe(5);
  });

  it('FR-002：member 节点的 definition 不含 lineStart/lineEnd（诚实缺席）', async () => {
    const r = await handleContext({ symbolId: 'src/a.ts::Widget.render', projectRoot: root });
    expect(r.isError).toBeUndefined();
    const def = parse(r)['definition'] as Record<string, unknown>;
    expect('lineStart' in def).toBe(false);
    expect('lineEnd' in def).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// F271 对抗审查 F4 — view_file 消费端的两条诚实 warning
// 缺了它们，"按 symbolId 定位"失败时调用方拿到的是一段与该 symbol 无关的文本，
// 且没有任何信号提示定位没生效。
// ════════════════════════════════════════════════════════════════════

describe('F271 对抗审查 F4 — view_file 定位失败时的诚实 warning', () => {
  it('symbolId 解析成功但图中无可用行号（member 节点）→ warning: lineRange-unavailable', async () => {
    const r = await handleViewFile({
      path: 'src/a.ts',
      symbolId: 'src/a.ts::Widget.render',
      projectRoot: root,
    });
    expect(r.isError).toBeUndefined();
    const p = parse(r);
    expect(p['warnings'] as string[]).toContain('lineRange-unavailable');
    // 对照：有行号的 symbol 不得挂这条 warning（否则等于狼来了）
    const ok = parse(
      await handleViewFile({ path: 'src/a.ts', symbolId: 'src/a.ts::namedFn', projectRoot: root }),
    );
    expect((ok['warnings'] as string[] | undefined) ?? []).not.toContain('lineRange-unavailable');
  });

  it('图中行号越界被 sliceLines 钳制（图陈旧）→ warning: lineRange-clamped', async () => {
    // 图里记的是 3-99，但源文件只有 12 行 —— 建图后文件被改短的典型形态
    const staleRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'f271-stale-')));
    try {
      mkdirSync(path.join(staleRoot, 'src'), { recursive: true });
      writeFileSync(path.join(staleRoot, 'src', 'a.ts'), SOURCE);
      const unified = buildUnifiedGraph({
        projectRoot: staleRoot,
        codeSkeletons: new Map([
          [
            'src/a.ts',
            {
              filePath: 'src/a.ts',
              language: 'typescript',
              loc: 12,
              exports: [
                {
                  name: 'namedFn',
                  kind: 'function',
                  signature: 'function namedFn(): number',
                  isDefault: false,
                  startLine: 3,
                  endLine: 99,
                },
              ],
              imports: [],
              hash: 'a'.repeat(64),
              analyzedAt: '2026-08-31T00:00:00.000Z',
              parserUsed: 'tree-sitter',
            } satisfies CodeSkeleton,
          ],
        ]),
      });
      writeKnowledgeGraph(buildKnowledgeGraph({ unifiedGraph: unified }), path.join(staleRoot, 'specs'), {
        builderProvenance: 'stamp-this-build',
      });

      const p = parse(
        await handleViewFile({
          path: 'src/a.ts',
          symbolId: 'src/a.ts::namedFn',
          projectRoot: staleRoot,
        }),
      );
      expect(p['warnings'] as string[]).toContain('lineRange-clamped');
      // 仍返回可用内容（钳制到文件实际末行），只是明确告知区间与请求不一致
      expect(p['startLine']).toBe(3);
      expect(p['endLine']).toBe(p['totalLines']);
      expect(p['endLine']).not.toBe(99);
    } finally {
      setCurrentUnifiedGraph(null);
      rmSync(staleRoot, { recursive: true, force: true });
    }
  });

  it('区间未被钳制时不得挂 lineRange-clamped（防狼来了）', async () => {
    const p = parse(
      await handleViewFile({ path: 'src/a.ts', symbolId: 'src/a.ts::namedFn', projectRoot: root }),
    );
    expect((p['warnings'] as string[] | undefined) ?? []).not.toContain('lineRange-clamped');
  });
});
