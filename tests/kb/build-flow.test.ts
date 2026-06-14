/**
 * F190 T015 — buildKb 端到端构建流程 + 幂等
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKb } from '../../src/scaffold-kb/index.js';
import { loadDbFromBytes, queryRows } from '../../src/scaffold-kb/sqlite-engine.js';

let workdir: string;
let docsDir: string;
let outDir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'kb-build-'));
  docsDir = join(workdir, 'docs');
  outDir = join(workdir, 'kb');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    join(docsDir, 'auth.md'),
    '# 鉴权\n\n## 错误码\n\n鉴权失败返回 ERR_AUTH_FAILED，请检查 X-Api-Key。\n',
  );
  writeFileSync(
    join(docsDir, 'init.md'),
    '# 初始化\n\n调用 sdk.Init() 完成初始化。详见 [鉴权](auth.md)。\n',
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('buildKb', () => {
  it('从 --dir 产出 doc-graph.json + chunks.sqlite', async () => {
    const res = await buildKb({ dirPath: docsDir, outputPath: outDir, builtAt: 'B1' });
    expect(res.docCount).toBe(2);
    expect(res.chunkCount).toBeGreaterThan(0);

    // doc-graph.json
    const graphPath = join(outDir, 'doc-graph.json');
    expect(existsSync(graphPath)).toBe(true);
    const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
    expect(graph.schema_version).toBe('1.0');
    expect(graph.nodes.length).toBe(2);
    expect(graph.built_at).toBe('B1');

    // chunks.sqlite 可查询
    const sqlitePath = join(outDir, 'chunks.sqlite');
    expect(existsSync(sqlitePath)).toBe(true);
    const { db } = await loadDbFromBytes(readFileSync(sqlitePath));
    const hit = queryRows(db, "SELECT chunk_id FROM chunks WHERE chunks MATCH '\"错误\"'");
    expect(hit.length).toBeGreaterThan(0);
    db.close();
  });

  it('幂等：doc-graph.json 去 built_at 后两次一致；sqlite chunk 集合一致', async () => {
    const out1 = join(workdir, 'kb1');
    const out2 = join(workdir, 'kb2');
    await buildKb({ dirPath: docsDir, outputPath: out1, builtAt: 'X' });
    await buildKb({ dirPath: docsDir, outputPath: out2, builtAt: 'Y' });

    const g1 = JSON.parse(readFileSync(join(out1, 'doc-graph.json'), 'utf-8'));
    const g2 = JSON.parse(readFileSync(join(out2, 'doc-graph.json'), 'utf-8'));
    delete g1.built_at;
    delete g2.built_at;
    expect(JSON.stringify(g1)).toEqual(JSON.stringify(g2));

    const snapshot = async (p: string): Promise<string> => {
      const { db } = await loadDbFromBytes(readFileSync(join(p, 'chunks.sqlite')));
      const rows = queryRows(db, 'SELECT chunk_id, content_raw, doc_id FROM chunks ORDER BY chunk_id');
      db.close();
      return JSON.stringify(rows);
    };
    expect(await snapshot(out1)).toEqual(await snapshot(out2));
  });

  it('两种输入都未提供 → 抛错（不落盘）', async () => {
    await expect(buildKb({ outputPath: outDir })).rejects.toThrow();
    expect(existsSync(join(outDir, 'doc-graph.json'))).toBe(false);
  });
});
