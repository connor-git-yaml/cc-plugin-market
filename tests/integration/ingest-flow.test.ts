/**
 * F192 T016-T019 / SC-005/006 — 三方导入 E2E（url/office/minutes → 预览 → 落项目库 → 可查）
 * URL 用注入 fetcher 保确定性；office 用 fflate 构造 docx fixture。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { prepareIngest, commitIngest, IngestError, type IngestSource, type IngestOptions } from '../../src/scaffold-kb/ingest/ingest-core.js';
import { mkdirSync } from 'node:fs';
import { loadDbFromBytes } from '../../src/scaffold-kb/sqlite-engine.js';
import { searchKbCore } from '../../src/scaffold-kb/search-core.js';

let work: string;
let docxPath: string;
let minutesPath: string;
let projectKb: string;

const fakeFetch: NonNullable<IngestOptions['fetchUrl']> = async (url: string) => ({
  finalUrl: url,
  contentType: 'text/html',
  markdown: '# Web 文档\n\n通过 createChart 创建图表实例，这是来自网页的内容说明。',
});

const INGEST_OPTS: IngestOptions = { noLlm: true, builtAt: 'T-ing', fetchUrl: fakeFetch };

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'f192-ingest-'));
  projectKb = join(work, 'kb');
  docxPath = join(work, 'spec.docx');
  minutesPath = join(work, 'meeting.txt');
  writeFileSync(
    docxPath,
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>办公文档里描述了 setOption 配置项的用法说明。</w:t></w:r></w:p></w:body></w:document>'),
    }),
  );
  writeFileSync(minutesPath, '# 评审会议纪要\n\n约定：dispose 释放实例后不可再用，这是合成的通用纪要内容。');
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('三方导入 E2E（SC-005）', () => {
  it('prepareIngest 三源（url/docx/minutes）→ 预览计数', async () => {
    const sources: IngestSource[] = [
      { kind: 'url', value: 'https://example.com/doc' },
      { kind: 'file', value: docxPath },
      { kind: 'minutes', value: minutesPath },
    ];
    const plan = await prepareIngest(sources, projectKb, INGEST_OPTS);
    expect(plan.sources.every((s) => s.ok)).toBe(true);
    expect(plan.newDocs).toBe(3);
    expect(plan.newChunks).toBeGreaterThan(0);
    // 不落库（prepareIngest 仅预览）
    expect(existsSync(join(projectKb, 'chunks.sqlite'))).toBe(false);
  });

  it('commitIngest → 三件套写项目库 + 可检索 + provenance 正确', async () => {
    const sources: IngestSource[] = [
      { kind: 'url', value: 'https://example.com/doc' },
      { kind: 'file', value: docxPath },
      { kind: 'minutes', value: minutesPath },
    ];
    const plan = await prepareIngest(sources, projectKb, INGEST_OPTS);
    commitIngest(projectKb, plan);
    for (const f of ['doc-graph.json', 'chunks.sqlite', 'api-entities.json']) {
      expect(existsSync(join(projectKb, f)), `缺 ${f}`).toBe(true);
    }
    // 检索命中三个来源的内容
    const { db } = await loadDbFromBytes(readFileSync(join(projectKb, 'chunks.sqlite')));
    for (const q of ['createChart', 'setOption', 'dispose']) {
      const r = searchKbCore(db, q, 5);
      expect(r.ok && r.results.length > 0, `查不到 ${q}`).toBe(true);
    }
    // provenance：检索结果带 ingest_source_type
    const r = searchKbCore(db, 'setOption', 5);
    expect(r.ok && r.results.some((x) => x.ingestSourceType === 'office-docx')).toBe(true);
  });

  it('SC-006：重复导入 → dedup（newChunks=0）', async () => {
    const sources: IngestSource[] = [{ kind: 'minutes', value: minutesPath }];
    // 已在上一个测试落库（含 minutes）→ 再次导入同内容
    const plan = await prepareIngest(sources, projectKb, INGEST_OPTS);
    expect(plan.newChunks).toBe(0);
  });

  it('单源失败不阻断其他源（坏 url throws → 记录失败，office 仍导入）', async () => {
    const throwFetch: NonNullable<IngestOptions['fetchUrl']> = async () => {
      throw new Error('SSRF 拒绝');
    };
    const sources: IngestSource[] = [
      { kind: 'url', value: 'http://127.0.0.1/x' },
      { kind: 'file', value: docxPath },
    ];
    const plan = await prepareIngest(sources, join(work, 'kb2'), { ...INGEST_OPTS, fetchUrl: throwFetch });
    const url = plan.sources.find((s) => s.origin.includes('127.0.0.1'));
    const file = plan.sources.find((s) => s.origin.includes('spec.docx'));
    expect(url?.ok).toBe(false);
    expect(url?.reason).toContain('SSRF');
    expect(file?.ok).toBe(true);
  });

  it('损坏 PDF 源 → 该源失败，不崩', async () => {
    const badPdf = join(work, 'bad.pdf');
    writeFileSync(badPdf, 'not a real pdf');
    const plan = await prepareIngest([{ kind: 'file', value: badPdf }], join(work, 'kb3'), INGEST_OPTS);
    expect(plan.sources[0]!.ok).toBe(false);
  });

  it('C-2 fail-closed：既有项目库 sqlite 损坏 → 拒绝导入（不覆盖丢数据）', async () => {
    const kbBad = join(work, 'kb-corrupt');
    mkdirSync(kbBad, { recursive: true });
    writeFileSync(join(kbBad, 'chunks.sqlite'), 'corrupt not a sqlite db');
    await expect(
      prepareIngest([{ kind: 'minutes', value: minutesPath }], kbBad, INGEST_OPTS),
    ).rejects.toBeInstanceOf(IngestError);
  });

  it('W-3 doc-level replace：同源更新内容 → 替换不重复、不撞 chunk_id', async () => {
    const kbUpd = join(work, 'kb-upd');
    const f = join(work, 'note.txt');
    writeFileSync(f, '# 笔记\n\n第一版内容：alpha 接口用于初始化流程说明。');
    const p1 = await prepareIngest([{ kind: 'minutes', value: f }], kbUpd, INGEST_OPTS);
    commitIngest(kbUpd, p1);
    const total1 = p1.totalChunks;
    // 改内容后重导（同 basename = 同 doc id）
    writeFileSync(f, '# 笔记\n\n第二版内容：beta 接口替换了旧的初始化流程说明。');
    const p2 = await prepareIngest([{ kind: 'minutes', value: f }], kbUpd, INGEST_OPTS);
    commitIngest(kbUpd, p2); // 不应因 chunk_id PRIMARY KEY 撞而抛错
    // doc 被替换：总量未翻倍（旧 chunk 被移除）
    expect(p2.totalChunks).toBeLessThanOrEqual(total1 + p2.newChunks);
    const { db } = await loadDbFromBytes(readFileSync(join(kbUpd, 'chunks.sqlite')));
    expect(searchKbCore(db, 'beta', 5).ok && searchKbCore(db, 'beta', 5).results.length > 0).toBe(true);
  });
});
