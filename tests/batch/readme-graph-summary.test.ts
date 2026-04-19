/**
 * Feature 127: README 图摘要提取与渲染测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  extractGraphHighlights,
  parseSurprisingConnections,
  renderGodNodesBlock,
  renderSurprisingBlock,
  renderGraphQueryHint,
} from '../../src/batch/readme-graph-section.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-readme-graph-'));
  fs.mkdirSync(path.join(tmpDir, '_meta'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeGraphJson(payload: object): void {
  fs.writeFileSync(
    path.join(tmpDir, '_meta', 'graph.json'),
    JSON.stringify(payload),
    'utf-8',
  );
}

function writeGraphReport(text: string): void {
  fs.writeFileSync(path.join(tmpDir, '_meta', 'GRAPH_REPORT.md'), text, 'utf-8');
}

describe('extractGraphHighlights', () => {
  it('产物缺失时 hasGraph/hasGraphReport 均为 false', () => {
    const h = extractGraphHighlights(tmpDir);
    expect(h.hasGraph).toBe(false);
    expect(h.hasGraphReport).toBe(false);
    expect(h.godNodes).toEqual([]);
    expect(h.surprisingConnections).toEqual([]);
  });

  it('从 graph.json 按 degree 降序取 Top N（默认 5）', () => {
    writeGraphJson({
      nodes: [
        { id: 'a', label: 'a', kind: 'module', metadata: { degree: 10 } },
        { id: 'b', label: 'b', kind: 'module', metadata: { degree: 25 } },
        { id: 'c', label: 'c', kind: 'module', metadata: { degree: 3 } },
        { id: 'd', label: 'd', kind: 'module', metadata: { degree: 0 } },
        { id: 'e', label: 'e', kind: 'module', metadata: { degree: 15 } },
      ],
    });
    const h = extractGraphHighlights(tmpDir);
    expect(h.hasGraph).toBe(true);
    expect(h.godNodes.map((n) => n.label)).toEqual(['b', 'e', 'a', 'c']);
  });

  it('topGodNodes 上限参数生效', () => {
    writeGraphJson({
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`,
        label: `n${i}`,
        kind: 'module',
        metadata: { degree: 10 - i },
      })),
    });
    const h = extractGraphHighlights(tmpDir, { topGodNodes: 3 });
    expect(h.godNodes.map((n) => n.label)).toEqual(['n0', 'n1', 'n2']);
  });

  it('从 GRAPH_REPORT.md 解析 Surprising Connections', () => {
    writeGraphReport(`# 架构图谱分析报告

## 概述

| 节点 | 数 |
|------|---|

## God Nodes

未检测到。

## Surprising Connections

跨社区或低置信度的意外关系：

| Source | Target | 关系类型 | 跨社区 | 置信度 | 评分 |
|--------|--------|---------|--------|--------|------|
| \`src/a\` | \`src/b\` | import | 是 | INFERRED | 0.8 |
| \`src/c\` | \`src/d\` | uses | 否 | EXTRACTED | 0.95 |

## Knowledge Gaps

略
`);
    const h = extractGraphHighlights(tmpDir);
    expect(h.hasGraphReport).toBe(true);
    expect(h.surprisingConnections).toHaveLength(2);
    expect(h.surprisingConnections[0]).toEqual({
      source: 'src/a',
      target: 'src/b',
      relation: 'import',
      crossCommunity: true,
      confidence: 'INFERRED',
    });
  });

  it('GRAPH_REPORT 里 "未检测到" 时返回空数组', () => {
    writeGraphReport(`## Surprising Connections\n\n未检测到跨社区异常连接。\n\n## Knowledge Gaps\n`);
    const h = extractGraphHighlights(tmpDir);
    expect(h.hasGraphReport).toBe(true);
    expect(h.surprisingConnections).toEqual([]);
  });
});

describe('parseSurprisingConnections', () => {
  it('topSurprising 上限参数生效', () => {
    const text = `## Surprising Connections

| Source | Target | 关系类型 | 跨社区 | 置信度 | 评分 |
|--------|--------|---------|--------|--------|------|
| \`a\` | \`b\` | x | 是 | INFERRED | 0.5 |
| \`c\` | \`d\` | x | 是 | INFERRED | 0.5 |
| \`e\` | \`f\` | x | 是 | INFERRED | 0.5 |
`;
    const rows = parseSurprisingConnections(text, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source)).toEqual(['a', 'c']);
  });
});

describe('renderGodNodesBlock', () => {
  it('图谱缺失时输出占位说明', () => {
    const md = renderGodNodesBlock({
      godNodes: [],
      surprisingConnections: [],
      hasGraph: false,
      hasGraphReport: false,
    }).join('\n');
    expect(md).toContain('代码核心抽象');
    expect(md).toContain('图谱未生成');
  });

  it('节点数组为空时输出"项目规模较小"', () => {
    const md = renderGodNodesBlock({
      godNodes: [],
      surprisingConnections: [],
      hasGraph: true,
      hasGraphReport: true,
    }).join('\n');
    expect(md).toContain('未识别到显著核心抽象节点');
  });

  it('正常情况输出节点表格', () => {
    const md = renderGodNodesBlock({
      godNodes: [
        { id: 'a', label: 'Auth', degree: 20, kind: 'module' },
      ],
      surprisingConnections: [],
      hasGraph: true,
      hasGraphReport: true,
    }).join('\n');
    expect(md).toContain('| 节点 | 类型 | 度数 |');
    expect(md).toContain('`Auth`');
    expect(md).toContain('| 20 |');
  });
});

describe('renderSurprisingBlock', () => {
  it('图谱报告缺失时输出占位', () => {
    const md = renderSurprisingBlock({
      godNodes: [],
      surprisingConnections: [],
      hasGraph: false,
      hasGraphReport: false,
    }).join('\n');
    expect(md).toContain('图谱报告未生成');
  });

  it('无连接时输出"未检测到"', () => {
    const md = renderSurprisingBlock({
      godNodes: [],
      surprisingConnections: [],
      hasGraph: true,
      hasGraphReport: true,
    }).join('\n');
    expect(md).toContain('未检测到跨社区的意外连接');
  });

  it('正常情况输出连接表格', () => {
    const md = renderSurprisingBlock({
      godNodes: [],
      surprisingConnections: [
        { source: 's', target: 't', relation: 'import', crossCommunity: true, confidence: 'INFERRED' },
      ],
      hasGraph: true,
      hasGraphReport: true,
    }).join('\n');
    expect(md).toContain('| 源 | 目标 | 关系 | 跨社区 |');
    expect(md).toContain('`s`');
    expect(md).toContain('`t`');
  });
});

describe('renderGraphQueryHint', () => {
  it('包含 5 个 MCP 工具名称', () => {
    const md = renderGraphQueryHint().join('\n');
    for (const tool of ['graph_query', 'graph_node', 'graph_path', 'graph_community', 'graph_god_nodes']) {
      expect(md).toContain(tool);
    }
  });
});
