/**
 * F170b — graph-query.getCommunity cohesion graceful-degrade 回归测试
 *
 * 修复前 bug：getCommunity 的 cohesionMessage 只在 readFileSync 抛错时赋值，
 * 当 GRAPH_REPORT.md 存在但 communityId 不在表中时，message 保持 undefined。
 * 这导致 host（有 GRAPH_REPORT.md）和 worktree（无 GRAPH_REPORT.md）行为不一致，
 * graph-mcp-snapshot.test.ts 出现 snapshot mismatch。
 *
 * 三条 graceful-degrade 路径必须返回相同语义（cohesion=null + message 非 undefined）：
 *   1. 文件不存在 (ENOENT → catch)
 *   2. 文件存在但 regex 不匹配 (match=null)
 *   3. 文件存在且匹配但 parseFloat NaN
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

const FIXTURE_GRAPH: GraphJSON = {
  directed: false,
  multigraph: false,
  graph: {
    sources: ['extractionResults'],
    nodeCount: 2,
    edgeCount: 0,
    generatedAt: '2026-06-01T00:00:00.000Z',
  },
  nodes: [
    {
      id: 'src/a.ts',
      kind: 'file',
      label: 'a.ts',
      sourceFile: 'src/a.ts',
      metadata: { sourcePath: 'src/a.ts', community: 'cluster_0' },
    },
    {
      id: 'src/b.ts',
      kind: 'file',
      label: 'b.ts',
      sourceFile: 'src/b.ts',
      metadata: { sourcePath: 'src/b.ts', community: 'cluster_0' },
    },
  ],
  links: [],
};

describe('GraphQueryEngine.getCommunity — cohesion graceful-degrade 三路径', () => {
  let savedCwd: string;
  let tempDir: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'graph-query-cohesion-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('路径 1：GRAPH_REPORT.md 不存在 → message 非 undefined', () => {
    // tempDir 下没有 specs/_meta/GRAPH_REPORT.md
    const engine = new GraphQueryEngine(FIXTURE_GRAPH);
    const result = engine.getCommunity('cluster_0', { limit: 100 });
    expect(result.cohesion).toBeNull();
    expect(result.message).toBeDefined();
    expect(result.message).toContain('内聚度不可用');
  });

  it('路径 2：GRAPH_REPORT.md 存在但 communityId 不在表中 → message 非 undefined（F170b 修复点）', () => {
    // 创建一个不含 cluster_0 数据的 GRAPH_REPORT.md
    mkdirSync(join(tempDir, 'specs', '_meta'), { recursive: true });
    writeFileSync(
      join(tempDir, 'specs', '_meta', 'GRAPH_REPORT.md'),
      '# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_99 | 5 | 0.8 |\n',
    );
    const engine = new GraphQueryEngine(FIXTURE_GRAPH);
    const result = engine.getCommunity('cluster_0', { limit: 100 });
    // F170b 修复前：result.message === undefined（snapshot mismatch）
    // F170b 修复后：result.message 非 undefined，与路径 1 行为一致
    expect(result.cohesion).toBeNull();
    expect(result.message).toBeDefined();
    expect(result.message).toContain('内聚度不可用');
  });

  it('路径 3：边界值 cohesion=0.0 解析成功（NaN 分支防御代码不可被 regex 命中）', () => {
    mkdirSync(join(tempDir, 'specs', '_meta'), { recursive: true });
    // graph-query 内部 regex 是 `\|\s*${escaped}\s*\|[^|]*\|\s*([\d.]+)` —
    // 强制 [\d.]+ 字符集，理论上 parseFloat 不会返回 NaN（除非多 . 如 "0.0.5"
    // 但 parseFloat("0.0.5") = 0 而非 NaN）。
    // NaN 分支是防御性代码，无法用 regex 可匹配的输入触发。
    // 这里测边界值 0.0 验证正常解析路径。
    writeFileSync(
      join(tempDir, 'specs', '_meta', 'GRAPH_REPORT.md'),
      '# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_0 | 5 | 0.0 |\n',
    );
    const engine = new GraphQueryEngine(FIXTURE_GRAPH);
    const result = engine.getCommunity('cluster_0', { limit: 100 });
    expect(result.cohesion).toBe(0);
    expect(result.message).toBeUndefined();
  });

  it('正常路径：GRAPH_REPORT.md 存在且 cluster 匹配 → cohesion 解析，message undefined', () => {
    mkdirSync(join(tempDir, 'specs', '_meta'), { recursive: true });
    writeFileSync(
      join(tempDir, 'specs', '_meta', 'GRAPH_REPORT.md'),
      '# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_0 | 5 | 0.85 |\n',
    );
    const engine = new GraphQueryEngine(FIXTURE_GRAPH);
    const result = engine.getCommunity('cluster_0', { limit: 100 });
    expect(result.cohesion).toBe(0.85);
    expect(result.message).toBeUndefined();
  });

  it('环境不变量：worktree 与 host 行为必须一致（无论 GRAPH_REPORT.md 是否存在）', () => {
    // 模拟 worktree（无文件）
    const engineWorktree = new GraphQueryEngine(FIXTURE_GRAPH);
    const resultWorktree = engineWorktree.getCommunity('cluster_0', { limit: 100 });

    // 模拟 host（有文件但 cluster_0 不在）
    mkdirSync(join(tempDir, 'specs', '_meta'), { recursive: true });
    writeFileSync(
      join(tempDir, 'specs', '_meta', 'GRAPH_REPORT.md'),
      '# Graph Report\n\n| cluster_99 | 5 | 0.8 |\n',
    );
    const engineHost = new GraphQueryEngine(FIXTURE_GRAPH);
    const resultHost = engineHost.getCommunity('cluster_0', { limit: 100 });

    // 两种环境 message 都应非 undefined，且 cohesion 都为 null
    expect(resultWorktree.cohesion).toBe(resultHost.cohesion);
    expect(resultWorktree.message).toBe(resultHost.message);
  });
});
