/**
 * F192 T022 / SC-008 / FR-018 — 冻结实体抽取 + lookup recall 评测
 * heuristic precision/recall（含 holdout）+ content_hash 冻结 + mutation 泛化 +
 * anti-overfit 源码扫描 + kb_api_lookup recall（从 manifest docs 建 KB）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { extractHeuristic } from '../../src/scaffold-kb/entity-heuristic.js';
import { buildKb } from '../../src/scaffold-kb/index.js';
import { loadKbContext } from '../../src/kb-mcp/lib/kb-locator.js';
import { executeKbApiLookup } from '../../src/kb-mcp/tools/kb-api-lookup.js';
import type { ExtractionSection } from '../../src/scaffold-kb/types.js';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, 'specs/192-scaffold-kb-entity-and-ingest/eval/entity-manifest.json');

interface Expected { name: string; kind: string }
interface Entry { id: string; holdout?: boolean; doc: string; expected: Expected[] }
interface LookupCase { query: string; expected_name: string; expected_kind: string; mode: string }
interface Manifest {
  content_hash: string;
  thresholds: { heuristic: { precision: number; recall: number }; lookup_recall: number };
  entries: Entry[];
  mutation_entries: Entry[];
  lookup_cases: LookupCase[];
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as Manifest;

function keyOf(e: { name: string; kind: string }): string {
  return `${e.name.toLowerCase()}#${e.kind}`;
}
function sectionOf(entry: Entry): ExtractionSection {
  return { docId: entry.id, anchor: null, lang: 'zh', chunkIds: [entry.id], text: entry.doc };
}
function evalSubset(entries: Entry[]): { precision: number; recall: number } {
  let tp = 0, fp = 0, fn = 0;
  for (const entry of entries) {
    const extracted = new Set(extractHeuristic(sectionOf(entry)).map(keyOf));
    const expected = new Set(entry.expected.map(keyOf));
    for (const k of expected) (extracted.has(k) ? tp++ : fn++);
    for (const k of extracted) if (!expected.has(k)) fp++;
  }
  return { precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn) };
}

describe('实体抽取冻结评测（SC-008 / FR-018）', () => {
  it('content_hash 冻结校验（防 entries 误改）', () => {
    const recomputed = createHash('sha256').update(JSON.stringify(manifest.entries)).digest('hex');
    expect(recomputed).toBe(manifest.content_hash);
  });

  it('heuristic 全集 precision/recall ≥ floor', () => {
    const { precision, recall } = evalSubset(manifest.entries);
    expect(precision).toBeGreaterThanOrEqual(manifest.thresholds.heuristic.precision);
    expect(recall).toBeGreaterThanOrEqual(manifest.thresholds.heuristic.recall);
  });

  it('holdout 子集独立达 floor', () => {
    const holdout = manifest.entries.filter((e) => e.holdout);
    expect(holdout.length).toBeGreaterThan(0);
    const { precision, recall } = evalSubset(holdout);
    expect(precision).toBeGreaterThanOrEqual(manifest.thresholds.heuristic.precision);
    expect(recall).toBeGreaterThanOrEqual(manifest.thresholds.heuristic.recall);
  });

  it('mutation 泛化：从未在源码出现的新名也能抽取（非背答案，FR-018）', () => {
    for (const m of manifest.mutation_entries) {
      const extracted = new Set(extractHeuristic(sectionOf(m)).map(keyOf));
      for (const e of m.expected) {
        expect(extracted.has(keyOf(e)), `mutation 未抽到 ${e.name}`).toBe(true);
      }
    }
  });

  it('anti-overfit：抽取源码不含 entries/mutation 实体名字面量（含小写变体）', () => {
    const sources = [
      readFileSync(join(ROOT, 'src/scaffold-kb/entity-heuristic.ts'), 'utf-8'),
      readFileSync(join(ROOT, 'src/scaffold-kb/entity-extractor.ts'), 'utf-8'),
    ].join('\n').toLowerCase();
    const names = [...manifest.entries, ...manifest.mutation_entries].flatMap((e) => e.expected.map((x) => x.name));
    for (const n of names) {
      expect(sources.includes(n.toLowerCase()), `源码出现 manifest 实体名 "${n}"（疑似特例/过拟合）`).toBe(false);
    }
  });
});

describe('kb_api_lookup 冻结 recall（FR-018）', () => {
  let work: string;
  let kbPath: string;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'f192-eval-lookup-'));
    const docsDir = join(work, 'docs');
    kbPath = join(work, 'kb');
    mkdirSync(docsDir, { recursive: true });
    manifest.entries.forEach((e, i) => writeFileSync(join(docsDir, `${i}-${e.id}.md`), e.doc));
    await buildKb({ dirPath: docsDir, outputPath: kbPath, noLlm: true, builtAt: 'T', lang: 'zh' });
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('冻结 lookup_cases 命中率 ≥ 门槛', async () => {
    const r = await loadKbContext({ vendorKbPath: kbPath });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let hit = 0;
    for (const c of manifest.lookup_cases) {
      const out = JSON.parse(executeKbApiLookup(r.context, { api_name: c.query, top_n: 5 }).content[0]!.text) as {
        results?: Array<{ name: string; kind: string }>;
      };
      if ((out.results ?? []).some((x) => x.name.toLowerCase() === c.expected_name.toLowerCase() && x.kind === c.expected_kind)) {
        hit++;
      }
    }
    const recall = hit / manifest.lookup_cases.length;
    expect(recall).toBeGreaterThanOrEqual(manifest.thresholds.lookup_recall);
  });
});
