/**
 * F170b/F170e — graph-query.getCommunity cohesion graceful-degrade 回归测试
 *
 * 历史 bug（F170b）：getCommunity 的 cohesionMessage 只在 readFileSync 抛错时赋值，
 * 当 GRAPH_REPORT.md 存在但 communityId 不在表中时 message 保持 undefined，导致
 * host（有文件）与 worktree（无文件）行为不一致，graph-mcp-snapshot 出现 mismatch。
 *
 * 设计缺陷（F170e）：getCommunity 用 process.cwd() 读 GRAPH_REPORT.md，但 graph.json
 * 是按 projectRoot 加载的。MCP server 进程 cwd 与目标项目不同时会读错/读不到目标项目的
 * 内聚度数据。F170e 把 projectRoot 注入 constructor，getCommunity 用
 * `this.projectRoot ?? process.cwd()` 定位文件。
 *
 * 本测试通过 projectRoot 注入隔离（不再用 process.chdir 全局 mutation）验证：
 *   1. GRAPH_REPORT.md 不存在 → cohesion=null + not-found message
 *   2. 文件存在但 communityId 不在表中 → cohesion=null + not-in-table message
 *   3. 边界值 cohesion=0.0 → 正常解析（message undefined）
 *   4. 正常匹配 → cohesion 解析（message undefined）
 *   5. **F170e 核心不变量**：getCommunity 结果只取决于 projectRoot，与 process.cwd() 无关
 *   6. 向后兼容：未注入 projectRoot 时回退 process.cwd()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 在指定目录写入 specs/_meta/GRAPH_REPORT.md */
function writeReport(root: string, body: string): void {
  mkdirSync(join(root, 'specs', '_meta'), { recursive: true });
  writeFileSync(join(root, 'specs', '_meta', 'GRAPH_REPORT.md'), body);
}

describe('GraphQueryEngine.getCommunity — cohesion graceful-degrade（projectRoot 注入）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'graph-query-cohesion-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('路径 1：GRAPH_REPORT.md 不存在 → cohesion=null + not-found message', () => {
    // tempDir 下没有 specs/_meta/GRAPH_REPORT.md
    const engine = new GraphQueryEngine(FIXTURE_GRAPH, tempDir);
    const result = engine.getCommunity('cluster_0');
    expect(result.cohesion).toBeNull();
    expect(result.message).toContain('未找到');
    expect(result.message).toContain('GRAPH_REPORT.md');
  });

  it('路径 2：文件存在但 communityId 不在表中 → cohesion=null + not-in-table message（F170b 修复 + F170e W-1 文案准确化）', () => {
    writeReport(
      tempDir,
      '# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_99 | 5 | 0.8 |\n',
    );
    const engine = new GraphQueryEngine(FIXTURE_GRAPH, tempDir);
    const result = engine.getCommunity('cluster_0');
    expect(result.cohesion).toBeNull();
    // F170e：文案不再笼统说"不存在"，而是准确说"无该社区记录"
    expect(result.message).toContain('无社区 cluster_0 的内聚度记录');
  });

  it('路径 3：边界值 cohesion=0.0 解析成功（message undefined）', () => {
    // graph-query 内部 regex 强制 [\d.]+，parseFloat 不会返回 NaN；测边界值 0.0
    writeReport(
      tempDir,
      '# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_0 | 5 | 0.0 |\n',
    );
    const engine = new GraphQueryEngine(FIXTURE_GRAPH, tempDir);
    const result = engine.getCommunity('cluster_0');
    expect(result.cohesion).toBe(0);
    expect(result.message).toBeUndefined();
  });

  it('正常路径：cluster 匹配 → cohesion 解析（message undefined）', () => {
    writeReport(
      tempDir,
      '# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_0 | 5 | 0.85 |\n',
    );
    const engine = new GraphQueryEngine(FIXTURE_GRAPH, tempDir);
    const result = engine.getCommunity('cluster_0');
    expect(result.cohesion).toBe(0.85);
    expect(result.message).toBeUndefined();
  });
});

describe('GraphQueryEngine.getCommunity — F170e projectRoot 不变量', () => {
  let projectRoot: string;
  let cwdDir: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'gq-projectroot-'));
    cwdDir = mkdtempSync(join(tmpdir(), 'gq-cwd-'));
  });

  afterEach(() => {
    // 用 mock 替代 process.chdir：不触碰真实进程 cwd，杜绝跨用例/并发污染（Codex INFO-1）
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(cwdDir, { recursive: true, force: true });
  });

  it('核心不变量：getCommunity 读注入的 projectRoot，完全忽略 process.cwd()（MCP 进程 cwd ≠ 目标项目场景）', () => {
    // projectRoot 有正确数据：cluster_0 cohesion=0.77
    writeReport(projectRoot, '# Graph Report\n\n| cluster_0 | 5 | 0.77 |\n');
    // 进程 cwd 有误导数据：cluster_0 cohesion=0.11
    writeReport(cwdDir, '# Graph Report\n\n| cluster_0 | 5 | 0.11 |\n');
    // mock process.cwd() 返回误导目录（模拟 MCP server 在错误目录启动）
    vi.spyOn(process, 'cwd').mockReturnValue(cwdDir);

    const engine = new GraphQueryEngine(FIXTURE_GRAPH, projectRoot);
    const result = engine.getCommunity('cluster_0');

    // 必须读 projectRoot 的 0.77，而非 cwd 的 0.11
    expect(result.cohesion).toBe(0.77);
    expect(result.message).toBeUndefined();
  });

  it('向后兼容：未注入 projectRoot 时回退 process.cwd()', () => {
    writeReport(cwdDir, '# Graph Report\n\n| cluster_0 | 5 | 0.33 |\n');
    vi.spyOn(process, 'cwd').mockReturnValue(cwdDir);

    // 不传 projectRoot → 回退 process.cwd()（mock 为 cwdDir）
    const engine = new GraphQueryEngine(FIXTURE_GRAPH);
    const result = engine.getCommunity('cluster_0');

    expect(result.cohesion).toBe(0.33);
  });
});
