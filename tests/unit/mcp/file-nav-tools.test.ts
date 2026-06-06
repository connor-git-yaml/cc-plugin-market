/**
 * Feature 171 — file-nav-tools handler 单测（目标 per-file ≥ 95%）
 *
 * 覆盖：3 工具成功路径 + 6 错误码 redaction（FR-014）+ payload-too-large + binary-file(view+search)
 * + symbol-not-found / graph-not-built / path-symbol 不一致 + symbolId→lineRange 成功 + telemetry。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  handleViewFile, handleSearchInFile, handleListDirectory, registerFileNavTools,
} from '../../../src/mcp/file-nav-tools.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolResult } from '../../../src/mcp/lib/tool-response.js';

let root: string;
let outside: string;

function parse(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

/** 写一个含单节点（带 lineRange + sourceFile）的最小 graph.json 到 <root>/specs/_meta/graph.json */
function writeGraphFixture(rootDir: string): void {
  const graph = {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-06-06T00:00:00.000Z',
      nodeCount: 1,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '1.0',
    },
    nodes: [
      {
        id: 'sub/b.ts::foo',
        kind: 'component',
        label: 'foo',
        metadata: { sourceFile: 'sub/b.ts', lineRange: { start: 1, end: 2 } },
      },
    ],
    links: [],
  };
  mkdirSync(path.join(rootDir, 'specs', '_meta'), { recursive: true });
  writeFileSync(path.join(rootDir, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'f171-h-')));
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'f171-ho-')));
  writeFileSync(path.join(root, 'a.ts'), Array.from({ length: 50 }, (_, i) => `code line ${i + 1}`).join('\n') + '\n');
  mkdirSync(path.join(root, 'sub'));
  writeFileSync(path.join(root, 'sub', 'b.ts'), 'function foo() {}\nfoo();\n');
  writeFileSync(path.join(outside, 'secret.txt'), 'TOPSECRET_DATA');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  delete process.env['SPECTRA_MCP_TELEMETRY_PATH'];
});

describe('F171 handleViewFile', () => {
  it('成功：按行区间返回带行号切片 + nextStepHint', async () => {
    const r = await handleViewFile({ path: 'a.ts', startLine: 1, endLine: 3, projectRoot: root });
    expect(r.isError).toBeUndefined();
    const p = parse(r);
    expect((p['lines'] as string[])[0]).toBe('1\tcode line 1');
    expect(p['totalLines']).toBe(50);
    expect(typeof p['nextStepHint']).toBe('string');
  });

  it('无定位 → 前 200 行窗口（短文件不 truncated）', async () => {
    const r = await handleViewFile({ path: 'a.ts', projectRoot: root });
    expect(parse(r)['truncated']).toBe(false);
  });

  it('越界路径 → path-outside-root，且响应脱敏（不含目标内容/绝对路径）', async () => {
    const r = await handleViewFile({ path: '../../../etc/passwd', projectRoot: root });
    expect(r.isError).toBe(true);
    const text = r.content[0]!.text;
    expect(parse(r)['code']).toBe('path-outside-root');
    expect(text).not.toContain('root:'); // 不含 /etc/passwd 内容
    expect(text).not.toContain(root); // 不泄露 projectRoot 绝对路径
  });

  it('绝对越界路径 → path-outside-root，不含 outside 文件字节', async () => {
    const r = await handleViewFile({ path: path.join(outside, 'secret.txt'), projectRoot: root });
    expect(parse(r)['code']).toBe('path-outside-root');
    expect(r.content[0]!.text).not.toContain('TOPSECRET');
  });

  it('空 path → invalid-input', async () => {
    expect(parse(await handleViewFile({ path: '', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('目录路径 → invalid-input', async () => {
    expect(parse(await handleViewFile({ path: 'sub', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('不存在文件 → file-not-found，不泄露绝对路径', async () => {
    const r = await handleViewFile({ path: 'missing.ts', projectRoot: root });
    expect(parse(r)['code']).toBe('file-not-found');
    expect(r.content[0]!.text).not.toContain(root);
  });

  it('二进制文件 → binary-file', async () => {
    writeFileSync(path.join(root, 'bin'), Buffer.from([1, 2, 0, 3, 4]));
    expect(parse(await handleViewFile({ path: 'bin', projectRoot: root }))['code']).toBe('binary-file');
  });

  it('超大单行 → payload-too-large', async () => {
    writeFileSync(path.join(root, 'huge.txt'), 'x'.repeat(1_100_000));
    const r = await handleViewFile({ path: 'huge.txt', startLine: 1, endLine: 1, projectRoot: root });
    expect(parse(r)['code']).toBe('payload-too-large');
  });

  it('symbolId 无 graph → graph-not-built', async () => {
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::foo', projectRoot: root });
    expect(parse(r)['code']).toBe('graph-not-built');
  });

  it('symbolId 命中 → 按 graph lineRange 切片', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::foo', projectRoot: root });
    expect(r.isError).toBeUndefined();
    const p = parse(r);
    expect(p['startLine']).toBe(1);
    expect(p['endLine']).toBe(2);
    expect(typeof p['nextStepHint']).toBe('string');
  });

  it('symbolId 不存在 → symbol-not-found', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::nope', projectRoot: root });
    expect(parse(r)['code']).toBe('symbol-not-found');
  });

  it('path 与 symbolId 文件不一致 → invalid-input', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'a.ts', symbolId: 'sub/b.ts::foo', projectRoot: root });
    expect(parse(r)['code']).toBe('invalid-input');
  });

  it('symbolId + 显式行区间同存 → warnings 含 symbolId-overrides-lines', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::foo', startLine: 1, endLine: 1, projectRoot: root });
    expect((parse(r)['warnings'] as string[])).toContain('symbolId-overrides-lines');
  });

  it('symbol sourceFile 是 path 的 segment 后缀（b.ts vs sub/b.ts）→ 视为一致', async () => {
    const graph = {
      directed: true, multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-06-06T00:00:00.000Z', nodeCount: 1, edgeCount: 0, sources: ['unified-graph'], schemaVersion: '1.0' },
      nodes: [{ id: 'sub/b.ts::seg', kind: 'component', label: 'seg', metadata: { sourceFile: 'b.ts', lineRange: { start: 1, end: 1 } } }],
      links: [],
    };
    mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
    writeFileSync(path.join(root, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::seg', projectRoot: root });
    expect(r.isError).toBeUndefined();
  });
});

describe('F171 handleSearchInFile', () => {
  it('成功：命中带上下文', async () => {
    const r = await handleSearchInFile({ path: 'sub/b.ts', pattern: 'foo', contextLines: 1, projectRoot: root });
    const p = parse(r);
    expect(p['totalMatches']).toBe(2);
    expect((p['matches'] as unknown[]).length).toBe(2);
  });

  it('非法正则 → invalid-input', async () => {
    const r = await handleSearchInFile({ path: 'sub/b.ts', pattern: '(', isRegex: true, projectRoot: root });
    expect(parse(r)['code']).toBe('invalid-input');
  });

  it('maxMatches 越界 → 响应带 warnings（maxMatches-clamped）', async () => {
    const r = await handleSearchInFile({ path: 'sub/b.ts', pattern: 'foo', maxMatches: 99999, projectRoot: root });
    expect((parse(r)['warnings'] as string[])).toContain('maxMatches-clamped');
  });

  it('越界 → path-outside-root', async () => {
    expect(parse(await handleSearchInFile({ path: '../x', pattern: 'a', projectRoot: root }))['code']).toBe('path-outside-root');
  });

  it('二进制 → binary-file', async () => {
    writeFileSync(path.join(root, 'b.bin'), Buffer.from([0, 1, 2]));
    expect(parse(await handleSearchInFile({ path: 'b.bin', pattern: 'a', projectRoot: root }))['code']).toBe('binary-file');
  });

  it('目录 → invalid-input', async () => {
    expect(parse(await handleSearchInFile({ path: 'sub', pattern: 'a', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('空 path → invalid-input', async () => {
    expect(parse(await handleSearchInFile({ path: '', pattern: 'a', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('不存在 → file-not-found', async () => {
    expect(parse(await handleSearchInFile({ path: 'no.ts', pattern: 'a', projectRoot: root }))['code']).toBe('file-not-found');
  });
});

describe('F171 handleListDirectory', () => {
  it('成功：列条目 + entryCount', async () => {
    const r = await handleListDirectory({ path: '.', projectRoot: root });
    const p = parse(r);
    expect(p['entryCount']).toBeGreaterThanOrEqual(2);
    expect((p['entries'] as Array<{ name: string }>).some((e) => e.name === 'a.ts')).toBe(true);
  });

  it('非目录 → invalid-input', async () => {
    expect(parse(await handleListDirectory({ path: 'a.ts', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('depth 越界 → 响应带 warnings（depth-clamped）', async () => {
    const r = await handleListDirectory({ path: '.', depth: 999, projectRoot: root });
    expect((parse(r)['warnings'] as string[])).toContain('depth-clamped');
  });

  it('越界 → path-outside-root', async () => {
    expect(parse(await handleListDirectory({ path: '../', projectRoot: root }))['code']).toBe('path-outside-root');
  });

  it('空 path → invalid-input', async () => {
    expect(parse(await handleListDirectory({ path: '', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('不存在目录 → file-not-found', async () => {
    expect(parse(await handleListDirectory({ path: 'nodir', projectRoot: root }))['code']).toBe('file-not-found');
  });
});

describe('F171 边界/防御分支', () => {
  it('NUL 字节 path → invalid-input（经 resolveSafePath）', async () => {
    expect(parse(await handleViewFile({ path: 'a\0.ts', projectRoot: root }))['code']).toBe('invalid-input');
  });

  it('args 含 BigInt（JSON.stringify 抛错）→ requestSize 容错，仍正常返回', async () => {
    // 覆盖 requestSize 的 catch 分支
    const r = await handleViewFile({ path: 'a.ts', startLine: 1, endLine: 2, projectRoot: root, x: 10n } as never);
    expect(r.isError).toBeUndefined();
  });

  it('symbolId 格式非法（空段 a::）→ invalid-symbol-id', async () => {
    writeGraphFixture(root);
    expect(parse(await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::', projectRoot: root }))['code']).toBe('invalid-symbol-id');
  });

  it('symbol 节点无 sourceFile → 从 id 派生文件名仍可定位', async () => {
    // 节点缺 sourceFile，file 由 moduleFileFromId(id) 派生
    const graph = {
      directed: true, multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-06-06T00:00:00.000Z', nodeCount: 1, edgeCount: 0, sources: ['unified-graph'], schemaVersion: '1.0' },
      nodes: [{ id: 'sub/b.ts::bar', kind: 'component', label: 'bar', metadata: { lineRange: { start: 1, end: 1 } } }],
      links: [],
    };
    mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
    writeFileSync(path.join(root, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::bar', projectRoot: root });
    expect(r.isError).toBeUndefined();
    expect(parse(r)['startLine']).toBe(1);
  });

  it('symbol lineRange 仅 start → endLine 回退为 start', async () => {
    const graph = {
      directed: true, multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-06-06T00:00:00.000Z', nodeCount: 1, edgeCount: 0, sources: ['unified-graph'], schemaVersion: '1.0' },
      nodes: [{ id: 'sub/b.ts::only', kind: 'component', label: 'only', metadata: { sourceFile: 'sub/b.ts', lineRange: { start: 2 } } }],
      links: [],
    };
    mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
    writeFileSync(path.join(root, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::only', projectRoot: root });
    const p = parse(r);
    expect(p['startLine']).toBe(2);
    expect(p['endLine']).toBe(2);
  });

  it('读取异常（不可读文件）→ internal-error（脱敏）', async () => {
    const f = path.join(root, 'noperm.ts');
    writeFileSync(f, 'secret content');
    chmodSync(f, 0o000);
    try {
      const r = await handleViewFile({ path: 'noperm.ts', projectRoot: root });
      // 非 root 用户：readFileSync EACCES → internal-error；root 环境下可能成功，故放宽断言
      if (r.isError) {
        expect(parse(r)['code']).toBe('internal-error');
        expect(r.content[0]!.text).not.toContain(root);
      }
    } finally {
      chmodSync(f, 0o644);
    }
  });
});

describe('F171 telemetry', () => {
  it('recordAndReturn 写 JSONL，错误码被记录', async () => {
    const telPath = path.join(root, 'tel.jsonl');
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = telPath;
    await handleViewFile({ path: '../escape', projectRoot: root });
    expect(existsSync(telPath)).toBe(true);
    const entry = JSON.parse(readFileSync(telPath, 'utf-8').trim().split('\n')[0]!) as Record<string, unknown>;
    expect(entry['toolName']).toBe('view_file');
    expect(entry['errorCode']).toBe('path-outside-root');
  });
});

describe('F171 registerFileNavTools — description 4 要素（F170c）', () => {
  interface Captured { name: string; description: string }
  function capture(): Captured[] {
    const out: Captured[] = [];
    const mock = { tool: (name: string, description: string) => out.push({ name, description }) } as unknown as McpServer;
    registerFileNavTools(mock);
    return out;
  }

  it('注册 3 个工具', () => {
    expect(capture().map((t) => t.name).sort()).toEqual(['list_directory', 'search_in_file', 'view_file']);
  });

  for (const name of ['view_file', 'search_in_file', 'list_directory']) {
    it(`${name} description 满足 4 要素 + 长度 [100,500]`, () => {
      const tool = capture().find((t) => t.name === name)!;
      const d = tool.description;
      expect(d.length).toBeGreaterThanOrEqual(100);
      expect(d.length).toBeLessThanOrEqual(500);
      expect(d.split('\n')[0]!.trim().length).toBeGreaterThanOrEqual(10); // lead-in
      expect(d).toContain('Use this tool when');
      const bullets = d.split('\n').filter((l) => /^\s*-/.test(l)).length;
      expect(bullets).toBeGreaterThanOrEqual(3);
      expect(d).toContain('Example');
      expect(d).toContain('Typical chained usage');
      expect(d).toMatch(/→/);
    });
  }

  it('view_file chained 段含 context → view_file 闭环', () => {
    const d = capture().find((t) => t.name === 'view_file')!.description;
    expect(d).toMatch(/context\s*→\s*view_file/);
  });
});
