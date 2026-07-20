/**
 * Feature 214 T028【C5】— installRelativizedBaseline fail-fast 负向单测（R-3, W3, C5）。
 *
 * 构造含 legacy `#` symbol 节点的最小 fixture → helper 抛错且含 recollect 指引；
 * canonical `::` fixture → 不抛。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installRelativizedBaseline } from '../../e2e/helpers/stdio-client.js';

interface GraphFile {
  nodes: Array<{ id: string; kind: string; label: string; metadata?: Record<string, unknown> }>;
  links: Array<{ source: string; target: string }>;
}

function writeGraph(dir: string, name: string, graph: GraphFile): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(graph), 'utf-8');
  return p;
}

describe('Feature 214 T028 — installRelativizedBaseline W3 fail-fast', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'f214-failfast-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('源 fixture 含 legacy `#` symbol 节点（extraction + .py）→ 抛错且含 recollect 指引', () => {
    const src = writeGraph(dir, 'legacy.json', {
      nodes: [
        { id: 'engine.py', kind: 'module', label: 'engine', metadata: { sourceTag: 'extraction' } },
        { id: 'engine.py#Value', kind: 'component', label: 'Value', metadata: { sourceTag: 'extraction' } },
      ],
      links: [{ source: 'engine.py', target: 'engine.py#Value' }],
    });
    const dest = join(dir, 'out.json');
    expect(() => installRelativizedBaseline(dest, dir, src)).toThrow(/baseline:collect/);
  });

  it('源 fixture 为 canonical `::` symbol 节点 → 不抛，正常写盘', () => {
    const src = writeGraph(dir, 'canonical.json', {
      nodes: [
        { id: 'engine.py', kind: 'module', label: 'engine', metadata: { sourceTag: 'extraction' } },
        { id: 'engine.py::Value', kind: 'component', label: 'Value', metadata: { sourceTag: 'unified-graph', unifiedKind: 'symbol' } },
      ],
      links: [{ source: 'engine.py', target: 'engine.py::Value' }],
    });
    const dest = join(dir, 'out.json');
    expect(() => installRelativizedBaseline(dest, dir, src)).not.toThrow();
  });

  it('负例：doc-anchor `#` 节点（kind=module，无 symbol provenance）不触发 fail-fast', () => {
    const src = writeGraph(dir, 'docanchor.json', {
      nodes: [
        { id: 'src/pipeline.ts', kind: 'module', label: 'pipeline', metadata: {} },
        { id: 'src/pipeline.ts#withRetry', kind: 'module', label: 'withRetry', metadata: {} },
      ],
      links: [],
    });
    const dest = join(dir, 'out.json');
    expect(() => installRelativizedBaseline(dest, dir, src)).not.toThrow();
  });
});
