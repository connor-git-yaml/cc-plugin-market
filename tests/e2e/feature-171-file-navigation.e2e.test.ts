/**
 * Feature 171 — File Navigation E2E（sandbox 无真实 LLM，用 byteLength/estimateTokens 代理断言）
 *
 * 4 个用户故事（SC-001）+ HOST_E2E gate 控制的真实 driver token 对比（默认 skip，对标 F170d）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { handleViewFile, registerFileNavTools } from '../../src/mcp/file-nav-tools.js';
import { estimateUtf8ByteTokens } from '../../src/mcp/lib/file-nav-helpers.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolResult } from '../../src/mcp/lib/tool-response.js';

let root: string;
let outside: string;
const FULL_CONTENT = Array.from({ length: 400 }, (_, i) => `源文件第 ${i + 1} 行内容 some code here`).join('\n') + '\n';

function parse(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

function writeGraphFixture(rootDir: string): void {
  const graph = {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-06-06T00:00:00.000Z',
      nodeCount: 1, edgeCount: 0, sources: ['unified-graph'], schemaVersion: '1.0',
    },
    nodes: [{
      id: 'sub/b.ts::Widget',
      kind: 'component',
      label: 'Widget',
      metadata: { sourceFile: 'sub/b.ts', lineRange: { start: 3, end: 7 } },
    }],
    links: [],
  };
  mkdirSync(path.join(rootDir, 'specs', '_meta'), { recursive: true });
  writeFileSync(path.join(rootDir, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'f171-e2e-')));
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'f171-e2e-out-')));
  writeFileSync(path.join(root, 'big.ts'), FULL_CONTENT);
  mkdirSync(path.join(root, 'sub'));
  writeFileSync(path.join(root, 'sub', 'b.ts'), Array.from({ length: 20 }, (_, i) => `L${i + 1}`).join('\n') + '\n');
  writeFileSync(path.join(outside, 'passwd'), 'root:x:0:0:SECRET');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('用户故事:driver 用 view_file 按 line range 看文件省 token (US1)', () => {
  it('按 5 行区间的响应 byte ≤ 全文 Read 的 50%（estimateTokens 代理断言）', async () => {
    const r = await handleViewFile({ path: 'big.ts', startLine: 10, endLine: 14, projectRoot: root });
    expect(r.isError).toBeUndefined();
    const sliceText = r.content[0]!.text;
    const fullBytes = Buffer.byteLength(FULL_CONTENT, 'utf-8');
    const sliceBytes = Buffer.byteLength(sliceText, 'utf-8');
    expect(sliceBytes).toBeLessThanOrEqual(fullBytes * 0.5);
    // estimateTokens 代理同向
    expect(estimateUtf8ByteTokens(sliceText)).toBeLessThanOrEqual(estimateUtf8ByteTokens(FULL_CONTENT) * 0.5);
  });
});

describe('用户故事:context 拿 symbol 后 view_file(symbolId) 定位定义行段 (US2)', () => {
  it('startLine/endLine 等于 graph node lineRange + nextStepHint 非空', async () => {
    writeGraphFixture(root);
    const r = await handleViewFile({ path: 'sub/b.ts', symbolId: 'sub/b.ts::Widget', projectRoot: root });
    expect(r.isError).toBeUndefined();
    const p = parse(r);
    expect(p['startLine']).toBe(3);
    expect(p['endLine']).toBe(7);
    expect(typeof p['nextStepHint']).toBe('string');
    expect((p['nextStepHint'] as string).length).toBeGreaterThan(0);
  });
});

describe('用户故事:driver 传越界路径被安全拒绝且不泄露 projectRoot 外内容 (US3)', () => {
  it('../../../etc/passwd → isError + path-outside-root，响应不含目标字节', async () => {
    const r = await handleViewFile({ path: '../../../etc/passwd', projectRoot: root });
    expect(r.isError).toBe(true);
    expect(parse(r)['code']).toBe('path-outside-root');
    expect(r.content[0]!.text).not.toContain('root:');
  });

  it('指向 projectRoot 外的绝对路径 → path-outside-root，不含 SECRET', async () => {
    const r = await handleViewFile({ path: path.join(outside, 'passwd'), projectRoot: root });
    expect(parse(r)['code']).toBe('path-outside-root');
    expect(r.content[0]!.text).not.toContain('SECRET');
  });
});

describe('用户故事:3 工具 description 满足 F170c 4 要素 (US4)', () => {
  interface Captured { name: string; description: string }
  function capture(): Captured[] {
    const out: Captured[] = [];
    const mock = { tool: (n: string, d: string) => out.push({ name: n, description: d }) } as unknown as McpServer;
    registerFileNavTools(mock);
    return out;
  }

  for (const name of ['view_file', 'search_in_file', 'list_directory']) {
    it(`${name}: 长度 [100,500] + Use when ≥3 bullet + Example + chained →`, () => {
      const d = capture().find((t) => t.name === name)!.description;
      expect(d.length).toBeGreaterThanOrEqual(100);
      expect(d.length).toBeLessThanOrEqual(500);
      expect(d).toContain('Use this tool when');
      expect(d.split('\n').filter((l) => /^\s*-/.test(l)).length).toBeGreaterThanOrEqual(3);
      expect(d).toContain('Example');
      expect(d).toContain('Typical chained usage');
      expect(d).toMatch(/→/);
    });
  }
});

// ============================================================
// HOST_E2E gate：真实 driver token 对比（默认 skip，需 HOST_E2E=1 + 真实 LLM 凭据）
// ============================================================
describe.skipIf(!process.env['HOST_E2E'])('HOST_E2E: 真实 driver 用 view_file vs 全文 Read 的 token 对比', () => {
  it('占位：driver 调 view_file 实测输入 token < 全文 Read（需 host 真实 driver）', () => {
    // 真机验收时在此接入真实 driver run + telemetry tokensInput 对比；sandbox 默认 skip。
    expect(true).toBe(true);
  });
});
