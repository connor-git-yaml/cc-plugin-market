/**
 * F184 T008 — view_file fuzzy symbol 解析单测（FR-003 / FR-004 / EC-001/003 / Codex Plan W-002）
 *
 * 覆盖 5 分支：
 *   SC-001 autoResolved 成功（warnings 含 fuzzy-resolved）
 *   SC-002 多候选无高置信 → symbol-not-found + context.fuzzyMatches（含 matchKind 三字段）
 *   EC-001 graph-not-built（现状不变）
 *   EC-003 空/非法 symbolId → invalid-symbol-id（fuzzy 不触发）
 *   W-002 fuzzy 解析到另一文件 + path 不一致 → invalid-input（fuzzy-resolved file 也过 fileMismatch）
 *
 * 用真实 graph.json 落盘（与 file-nav-tools.test.ts 同款），经真实 getCachedGraphData 读取。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { handleViewFile } from '../../../src/mcp/file-nav-tools.js';
import type { ToolResult } from '../../../src/mcp/lib/tool-response.js';

let root: string;

function parse(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

/** 多节点 graph fixture：覆盖 auto-resolve / 多义 / 跨文件 mismatch */
function writeGraphFixture(rootDir: string): void {
  const graph = {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-06-06T00:00:00.000Z',
      nodeCount: 4,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '1.0',
    },
    nodes: [
      // 唯一 relu 定义 → 'engine.py::Value.relu' 路径后缀唯一命中 0.9 auto-resolve
      { id: 'micrograd/engine.py::Value.relu', kind: 'component', label: 'Value.relu', metadata: { sourceFile: 'micrograd/engine.py', lineRange: { start: 10, end: 20 } } },
      // 与 relu 构成 'relu' 多义（小写裸名同时命中两者）→ 不 auto-resolve
      { id: 'micrograd/nn.py::ReLU', kind: 'component', label: 'ReLU', metadata: { sourceFile: 'micrograd/nn.py', lineRange: { start: 5, end: 8 } } },
      // 跨文件 mismatch 目标：唯一 fooXyz → 'b.ts::fooXyz' 路径后缀 auto-resolve 到 sub/b.ts
      { id: 'sub/b.ts::fooXyz', kind: 'component', label: 'fooXyz', metadata: { sourceFile: 'sub/b.ts', lineRange: { start: 1, end: 2 } } },
      { id: 'micrograd/engine.py::Value', kind: 'component', label: 'Value', metadata: { sourceFile: 'micrograd/engine.py', lineRange: { start: 1, end: 40 } } },
    ],
    links: [],
  };
  mkdirSync(path.join(rootDir, 'specs', '_meta'), { recursive: true });
  writeFileSync(path.join(rootDir, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'f184-fuzzy-')));
  // 真实源文件（view_file 成功路径要读文件按 lineRange 切片）
  mkdirSync(path.join(root, 'micrograd'));
  writeFileSync(
    path.join(root, 'micrograd', 'engine.py'),
    Array.from({ length: 25 }, (_, i) => `engine line ${i + 1}`).join('\n') + '\n',
  );
  mkdirSync(path.join(root, 'sub'));
  writeFileSync(path.join(root, 'sub', 'b.ts'), 'function fooXyz() {}\nfooXyz();\n');
  writeFileSync(path.join(root, 'a.ts'), 'const a = 1;\nconst b = 2;\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('F184 FR-003 — view_file fuzzy symbol 解析', () => {
  it('SC-001 autoResolved：path-suffix 唯一高分候选 → 成功 + warnings 含 fuzzy-resolved', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'micrograd/engine.py', symbolId: 'engine.py::Value.relu', projectRoot: root });
    const data = parse(r);
    expect(r.isError, `应成功，实际: ${r.content[0]!.text.slice(0, 160)}`).toBeUndefined();
    expect(data['warnings'] as string[]).toContain('fuzzy-resolved');
    // 按 resolved 节点 lineRange 切片（10-20）
    expect(data['startLine']).toBe(10);
    expect(data['endLine']).toBe(20);
  });

  it('SC-002 多候选无高置信 → symbol-not-found + context.fuzzyMatches（含 matchKind 三字段）', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'micrograd/engine.py', symbolId: 'relu', projectRoot: root });
    const data = parse(r);
    expect(data['code']).toBe('symbol-not-found');
    const fuzzyMatches = (data['context'] as { fuzzyMatches?: Array<Record<string, unknown>> } | undefined)?.fuzzyMatches ?? [];
    expect(fuzzyMatches.length).toBeGreaterThan(0);
    expect(fuzzyMatches.length).toBeLessThanOrEqual(3);
    // 完整 SymbolCandidate 三字段（W-003）
    for (const c of fuzzyMatches) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('confidence');
      expect(c).toHaveProperty('matchKind');
    }
  });

  it('EC-001 graph-not-built：无 graph.json → graph-not-built（现状不变）', async () => {
    // 不写 graph fixture
    const r = await handleViewFile({ path: 'micrograd/engine.py', symbolId: 'engine.py::Value.relu', projectRoot: root });
    expect(parse(r)['code']).toBe('graph-not-built');
  });

  it('EC-003 非法 symbolId（空段 a::）→ invalid-symbol-id（fuzzy 不触发）', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'micrograd/engine.py', symbolId: 'micrograd/engine.py::', projectRoot: root });
    expect(parse(r)['code']).toBe('invalid-symbol-id');
  });

  it('W-002 fuzzy 解析到另一文件 + path 不一致 → invalid-input + 保留 fuzzy 溯源 context（不丢诊断）', async () => {
    writeGraphFixture(root);
    // 'b.ts::fooXyz' fuzzy auto-resolve 到 sub/b.ts::fooXyz，但 path=a.ts → 文件不一致
    const r = await handleViewFile({ path: 'a.ts', symbolId: 'b.ts::fooXyz', projectRoot: root });
    const data = parse(r);
    expect(data['code']).toBe('invalid-input');
    // fuzzy-resolved 诊断在 error envelope 不能丢：经 context 保留（warning 在错误响应会丢）
    const ctx = data['context'] as { fuzzyResolved?: boolean; resolvedFile?: string } | undefined;
    expect(ctx?.fuzzyResolved).toBe(true);
    expect(ctx?.resolvedFile).toBe('sub/b.ts');
  });
});
