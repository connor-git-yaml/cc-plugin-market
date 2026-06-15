/**
 * F192 T005 / SC-001 — buildKb 产出 api-entities.json（E2E，heuristic 路径确定性）
 * 校验：三文件落盘、schema 完整、实体 source_chunk_id 真实存在于 chunks.sqlite、产物隔离。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKb } from '../../src/scaffold-kb/index.js';
import { loadDbFromBytes, queryRows } from '../../src/scaffold-kb/sqlite-engine.js';

let work: string;
let docsDir: string;
let outDir: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'f192-build-'));
  docsDir = join(work, 'docs');
  outDir = join(work, 'kb');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    join(docsDir, 'chart.md'),
    [
      '# Chart API',
      '',
      '调用 `createChart(dom, options)` 创建图表实例。',
      '',
      '错误码 E1001 表示初始化失败。',
    ].join('\n'),
  );
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('buildKb → api-entities.json（SC-001）', () => {
  it('产出三文件 + 实体 schema 完整 + heuristic 方法', async () => {
    const res = await buildKb({
      dirPath: docsDir,
      outputPath: outDir,
      noLlm: true,
      sdkVersion: '1.0',
      builtAt: 'T-fixed',
      lang: 'zh',
    });
    expect(res.entityCount).toBeGreaterThan(0);
    expect(res.extractionMethod).toBe('heuristic');

    // 三文件落盘
    expect(existsSync(join(outDir, 'doc-graph.json'))).toBe(true);
    expect(existsSync(join(outDir, 'chunks.sqlite'))).toBe(true);
    expect(existsSync(join(outDir, 'api-entities.json'))).toBe(true);

    const file = JSON.parse(readFileSync(join(outDir, 'api-entities.json'), 'utf-8'));
    expect(file.schema_version).toBe('1.0');
    expect(file.source_kind).toBe('vendor');
    expect(file.built_at).toBe('T-fixed');
    expect(file.coverage).toMatchObject({ total_sections: expect.any(Number) });
    expect(Array.isArray(file.entities)).toBe(true);
    expect(file.entities.length).toBeGreaterThan(0);

    // 每实体字段完整
    const e = file.entities[0];
    for (const key of ['id', 'name', 'qualified_name', 'kind', 'confidence', 'extraction_method', 'source_doc_id', 'source_chunk_id']) {
      expect(e[key], `entity 缺字段 ${key}`).toBeDefined();
    }
    expect(e.extraction_method).toBe('heuristic');

    // 抽到了 createChart + E1001
    const names = file.entities.map((x: { name: string }) => x.name);
    expect(names).toContain('createChart');
    expect(names).toContain('E1001');
  });

  it('实体 source_chunk_id 真实存在于 chunks.sqlite（证据可回溯，W-9）', async () => {
    const file = JSON.parse(readFileSync(join(outDir, 'api-entities.json'), 'utf-8'));
    const { db } = await loadDbFromBytes(readFileSync(join(outDir, 'chunks.sqlite')));
    for (const e of file.entities) {
      const rows = queryRows(db, 'SELECT chunk_id FROM chunk_meta WHERE chunk_id = ?', [e.source_chunk_id]);
      expect(rows.length, `source_chunk_id ${e.source_chunk_id} 不在 sqlite`).toBe(1);
    }
  });

  it('产物隔离：kb/ 仅含 KB 三文件，不写 _meta/graph.json 或 specs/（R-ENT-1/FR-017）', () => {
    const entries = readdirSync(outDir).sort();
    expect(entries).toEqual(['api-entities.json', 'chunks.sqlite', 'doc-graph.json']);
    expect(existsSync(join(outDir, '_meta'))).toBe(false);
    expect(existsSync(join(outDir, 'graph.json'))).toBe(false);
  });

  it('重建覆盖已有 KB → 成功且不留 .tmp/.bak（C-5 原子提交 happy path）', async () => {
    // outDir 已含上次构建的三文件 → 触发 backup(.bak)+rename+清理路径
    await buildKb({ dirPath: docsDir, outputPath: outDir, noLlm: true, builtAt: 'T2', lang: 'zh' });
    const entries = readdirSync(outDir).sort();
    expect(entries).toEqual(['api-entities.json', 'chunks.sqlite', 'doc-graph.json']);
    // 无残留临时/备份文件
    expect(entries.some((f) => f.endsWith('.tmp') || f.endsWith('.bak'))).toBe(false);
  });
});
