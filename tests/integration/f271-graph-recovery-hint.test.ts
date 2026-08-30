/**
 * F271 T011 / FR-013 — graph-not-built / graph-format-stale 恢复提示统一。
 *
 * 此前 5 处提示、3 种措辞，其中 5 处引导用户跑 `spectra index`——而 `spectra index` 写的是
 * `.spectra/unified-graph.json`，MCP 读的是 `specs/_meta/graph.json`，是两个不同文件：
 * 照提示操作**解除不了**问题（死胡同指引，白白浪费 agent 的执行轮次）。
 *
 * 本测试逐一触发 5 处消息，断言：均不含 `spectra index`，且均指向 `graph-only`。
 * 5 处分别是：
 *   ① src/panoramic/graph/graph-query.ts   legacy `#` symbol 节点分支
 *   ② src/panoramic/graph/graph-query.ts   跨 worktree 绝对路径节点分支
 *   ③ src/mcp/file-nav-tools.ts            view_file 的 graph-format-stale 映射
 *   ④ src/mcp/agent-context-tools.ts       context 的 graph-format-stale 映射
 *   ⑤ src/cli/commands/graph-quality.ts    legacy `#` 节点的 nextStep 建议
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { assertGraphFormatNotStale } from '../../src/panoramic/graph/graph-query.js';
import { handleViewFile } from '../../src/mcp/file-nav-tools.js';
import { handleContext } from '../../src/mcp/agent-context-tools.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import type { ToolResult } from '../../src/mcp/lib/tool-response.js';
import type { GraphQualityReport } from '../../src/panoramic/graph/quality/quality-types.js';

const CLI_PATH = path.resolve('dist/cli/index.js');
const LEGACY_FIXTURE = path.resolve('tests/fixtures/graph-quality-adversarial/legacy-hash-node.json');

let root: string;

function parse(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

/** 统一断言：死胡同指引已消除，且指向唯一正确路径。 */
function expectUnifiedHint(message: string): void {
  expect(message).not.toContain('spectra index');
  expect(message).toContain('graph-only');
}

function mkGraph(nodes: Array<{ id: string; metadata?: Record<string, unknown> }>): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-08-31T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: 'component',
      label: n.id,
      metadata: n.metadata ?? {},
    })),
    links: [],
  } as unknown as GraphJSON;
}

/** 落一份"legacy `#` symbol 节点"的图到 <root>/specs/_meta/graph.json，触发 stale 判定。 */
function writeStaleGraph(rootDir: string): void {
  mkdirSync(path.join(rootDir, 'specs', '_meta'), { recursive: true });
  writeFileSync(
    path.join(rootDir, 'specs', '_meta', 'graph.json'),
    JSON.stringify(mkGraph([{ id: 'src/a.py#foo', metadata: { unifiedKind: 'symbol' } }])),
  );
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'f271-hint-')));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.py'), 'def foo():\n    pass\n');
  writeStaleGraph(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('F271 FR-013 — 5 处恢复提示统一指向 spectra batch --mode graph-only', () => {
  it('① graph-query：legacy `#` symbol 节点分支', () => {
    let message = '';
    try {
      assertGraphFormatNotStale(
        mkGraph([{ id: 'src/a.py#foo', metadata: { unifiedKind: 'symbol' } }]),
        '/proj',
      );
      throw new Error('应抛出 graph-format-stale');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('graph-format-stale');
    expectUnifiedHint(message);
  });

  it('② graph-query：跨 worktree 绝对路径节点分支', () => {
    let message = '';
    try {
      assertGraphFormatNotStale(mkGraph([{ id: '/other/repo/src/a.ts::foo' }]), '/proj');
      throw new Error('应抛出 graph-format-stale');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('graph-format-stale');
    expectUnifiedHint(message);
  });

  it('③ file-nav-tools：view_file 命中 graph-format-stale', async () => {
    const r = await handleViewFile({
      path: 'src/a.py',
      symbolId: 'src/a.py::foo',
      projectRoot: root,
    });
    expect(r.isError).toBe(true);
    const env = parse(r);
    expect(env['code']).toBe('graph-format-stale');
    expectUnifiedHint(JSON.stringify(env));
  });

  it('④ agent-context-tools：context 命中 graph-format-stale', async () => {
    const r = await handleContext({ symbolId: 'src/a.py::foo', projectRoot: root });
    expect(r.isError).toBe(true);
    const env = parse(r);
    expect(env['code']).toBe('graph-format-stale');
    expectUnifiedHint(JSON.stringify(env));
  });

  it('⑤ graph-quality：legacy `#` 节点的 nextStep 建议', () => {
    const stdout = execFileSync(
      'node',
      [CLI_PATH, 'graph-quality', '--graph', LEGACY_FIXTURE, '--json'],
      { encoding: 'utf-8', timeout: 60_000 },
    );
    const report = JSON.parse(stdout) as GraphQualityReport;

    const legacyStep = report.nextSteps.find((s) => s.includes('遗留'));
    expect(legacyStep).toBeDefined();
    expectUnifiedHint(legacyStep!);
  });
});
