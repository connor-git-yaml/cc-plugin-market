/**
 * F192 T016 — 三方导入核心（FR-009/014/015）
 *
 * 源（url/office/minutes）→ ParsedDoc(+provenance) → splitDocument → 抽实体 →
 * 与现有项目库**合并去重**（内容级 dedup chunk + merge key 覆盖 entity）→ 三件套原子写项目库。
 * 默认网络实现 = SSRF 安全 fetcher（禁 F190 默认 fetch）。单源失败不阻断其他源。
 * 导入内容全 untrusted：入库即落 provenance，检索经 envelope（复用既有路径）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  ApiEntity, ApiEntityFile, Chunk, ChunkMeta, DocEdge, DocNode, IngestSourceType, ParsedDoc,
} from '../types.js';
import { splitDocument } from '../chunk-splitter.js';
import { aggregateSections, extractEntities } from '../entity-extractor.js';
import { buildChunksDbBytes } from '../sqlite-writer.js';
import { serializeApiEntities, deserializeApiEntities } from '../api-entities-serializer.js';
import { provenanceSelectFragment } from '../schema-compat.js';
import { writeKbArtifactsAtomic } from '../kb-writer.js';
import { loadDbFromBytes, queryRows } from '../sqlite-engine.js';
import { safeFetchUrl } from './url-fetcher.js';
import { parseOfficeFile, detectOfficeFormat } from './office-parser.js';

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

export interface IngestSource {
  kind: 'url' | 'file' | 'minutes';
  value: string;
}

export interface IngestSourceResult {
  origin: string;
  type: IngestSourceType | null;
  ok: boolean;
  reason?: string;
}

export interface IngestPlan {
  newDocs: number;
  newChunks: number;
  newEntities: number;
  totalChunks: number;
  totalEntities: number;
  sources: IngestSourceResult[];
  artifacts: { graphJson: string; sqliteBytes: Uint8Array; entitiesJson: string };
}

export interface IngestOptions {
  noLlm?: boolean;
  builtAt?: string;
  /** 注入安全 fetcher（测试用），缺省 safeFetchUrl */
  fetchUrl?: typeof safeFetchUrl;
}

const HAN = /\p{Script=Han}/u;
function detectLang(text: string): string {
  return HAN.test(text) ? 'zh' : 'en';
}
function firstH1(md: string): string | undefined {
  for (const line of md.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line.trim());
    if (m) return m[1]!.trim();
  }
  return undefined;
}
function urlToId(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** 单源 → ParsedDoc + provenance；失败抛错（调用方记 reason，不阻断其他源） */
async function sourceToDoc(
  source: IngestSource,
  fetchUrl: typeof safeFetchUrl,
): Promise<{ doc: ParsedDoc; type: IngestSourceType; origin: string }> {
  if (source.kind === 'url') {
    const { finalUrl, markdown } = await fetchUrl(source.value);
    const id = urlToId(finalUrl);
    return {
      doc: { id, title: firstH1(markdown) ?? id, content: markdown, sourceUrl: finalUrl, lang: detectLang(markdown) },
      type: 'url',
      origin: finalUrl,
    };
  }
  if (source.kind === 'file') {
    const fmt = detectOfficeFormat(source.value);
    if (!fmt) throw new Error(`不支持的文件类型: ${source.value}`);
    const { text } = await parseOfficeFile(new Uint8Array(readFileSync(source.value)), fmt);
    const id = basename(source.value);
    const type: IngestSourceType = fmt === 'md' ? 'markdown-dir' : (`office-${fmt}` as IngestSourceType);
    return {
      doc: { id, title: firstH1(text) ?? id, content: text, sourceUrl: source.value, lang: detectLang(text) },
      type,
      origin: id,
    };
  }
  // minutes：自由文本/markdown
  const text = readFileSync(source.value, 'utf-8');
  const id = basename(source.value);
  return {
    doc: { id, title: firstH1(text) ?? id, content: text, sourceUrl: source.value, lang: detectLang(text) },
    type: 'minutes',
    origin: id,
  };
}

interface ExistingKb {
  chunks: Chunk[];
  meta: ChunkMeta[];
  entities: ApiEntity[];
  nodes: DocNode[];
  edges: DocEdge[];
}

/**
 * 加载现有项目库三件套（不存在 → 空）。
 * C-2 fail-closed：sqlite 存在但读取失败 → 抛 IngestError（拒绝导入，绝不静默覆盖丢数据）。
 * 坏的 api-entities.json / doc-graph.json 隔离处理（按空，保留 sqlite 数据）。
 */
async function loadExisting(projectKbPath: string): Promise<ExistingKb> {
  const empty: ExistingKb = { chunks: [], meta: [], entities: [], nodes: [], edges: [] };
  const sqlitePath = join(projectKbPath, 'chunks.sqlite');
  if (!existsSync(sqlitePath)) return empty; // 首次导入

  const chunks: Chunk[] = [];
  const meta: ChunkMeta[] = [];
  try {
    const { db } = await loadDbFromBytes(readFileSync(sqlitePath));
    const prov = provenanceSelectFragment(db);
    const rows = queryRows(
      db,
      `SELECT chunks.chunk_id, chunks.doc_id, chunks.content_raw, chunk_meta.doc_title,
        chunk_meta.source_url, chunk_meta.anchor, chunk_meta.sdk_version, chunk_meta.built_at${prov}
       FROM chunks JOIN chunk_meta ON chunk_meta.chunk_id = chunks.chunk_id`,
      [],
    );
    for (const r of rows) {
      const s = (v: unknown): string => (v == null ? '' : String(v));
      const sn = (v: unknown): string | null => (v == null ? null : String(v));
      chunks.push({ chunkId: s(r[0]), docId: s(r[1]), contentRaw: s(r[2]), anchor: sn(r[5]) });
      meta.push({
        chunkId: s(r[0]), docId: s(r[1]), docTitle: s(r[3]), sourceUrl: sn(r[4]), anchor: sn(r[5]),
        sdkVersion: sn(r[6]), builtAt: s(r[7]),
        ingestSourceType: sn(r[8]) as IngestSourceType | null, ingestOrigin: sn(r[9]), ingestedAt: sn(r[10]),
      });
    }
  } catch (e) {
    // fail-closed：现有 sqlite 损坏不可读 → 拒绝导入，避免 commit 覆盖丢数据（C-2）
    throw new IngestError(
      `既有项目库 chunks.sqlite 读取失败，已拒绝导入以防数据丢失（请人工修复后重试）: ${(e as Error).message}`,
    );
  }

  // entities：坏文件隔离（按空，不阻断、不清空 sqlite）
  let entities: ApiEntity[] = [];
  try {
    const entPath = join(projectKbPath, 'api-entities.json');
    if (existsSync(entPath)) {
      const f = deserializeApiEntities(JSON.parse(readFileSync(entPath, 'utf-8')));
      if (f) entities = f.entities;
    }
  } catch {
    entities = [];
  }
  // doc-graph：读取已有 nodes/edges 并保留（W-2，防覆盖丢旧 graph）
  let nodes: DocNode[] = [];
  let edges: DocEdge[] = [];
  try {
    const graphPath = join(projectKbPath, 'doc-graph.json');
    if (existsSync(graphPath)) {
      const g = JSON.parse(readFileSync(graphPath, 'utf-8')) as {
        nodes?: Array<{ id: string; title?: string; lang?: string; source_url?: string }>;
        edges?: DocEdge[];
      };
      nodes = (g.nodes ?? []).map((n) => ({ id: n.id, title: n.title ?? n.id, lang: n.lang ?? 'en', sourceUrl: n.source_url ?? '' }));
      edges = Array.isArray(g.edges) ? g.edges : [];
    }
  } catch {
    nodes = [];
    edges = [];
  }
  return { chunks, meta, entities, nodes, edges };
}

/** 准备导入（处理所有源 + 合并去重，不落盘）；commitIngest 才写 */
export async function prepareIngest(
  sources: IngestSource[],
  projectKbPath: string,
  opts: IngestOptions = {},
): Promise<IngestPlan> {
  const builtAt = opts.builtAt ?? new Date().toISOString();
  const fetchUrl = opts.fetchUrl ?? safeFetchUrl;
  const results: IngestSourceResult[] = [];
  const newDocs: Array<{ doc: ParsedDoc; type: IngestSourceType; origin: string }> = [];

  for (const source of sources) {
    try {
      newDocs.push(await sourceToDoc(source, fetchUrl));
      results.push({ origin: source.value, type: newDocs[newDocs.length - 1]!.type, ok: true });
    } catch (e) {
      results.push({ origin: source.value, type: null, ok: false, reason: (e as Error).message });
    }
  }

  const existing = await loadExisting(projectKbPath);
  const newDocIds = new Set(newDocs.map((d) => d.doc.id));

  // W-3 doc-level replace：移除既有同 doc id 的 chunk/meta/entity/node（支持更新 + 防 chunk_id 撞 PRIMARY KEY）
  const keptChunks = existing.chunks.filter((c) => !newDocIds.has(c.docId));
  const keptMeta = existing.meta.filter((m) => !newDocIds.has(m.docId));
  const keptEntities = existing.entities.filter((e) => !newDocIds.has(e.sourceDocId));
  const keptNodes = existing.nodes.filter((n) => !newDocIds.has(n.id));
  // 去重计数基准 = 导入前全集（使同内容 re-ingest 计 0，幂等）
  const originalContent = new Set(existing.chunks.map((c) => c.contentRaw));
  const originalEntityKeys = new Set(existing.entities.map((e) => e.id));

  const seenContent = new Set(keptChunks.map((c) => c.contentRaw));
  const newChunks: Chunk[] = [];
  const newMeta: ChunkMeta[] = [];
  let newChunkCount = 0;
  const nodes: DocNode[] = [...keptNodes];

  for (const { doc, type, origin } of newDocs) {
    nodes.push({ id: doc.id, title: doc.title, lang: doc.lang, sourceUrl: doc.sourceUrl });
    for (const c of splitDocument(doc)) {
      if (c.contentRaw.trim().length < 20) continue; // 过滤空/超短
      if (seenContent.has(c.contentRaw)) continue; // 内容级 dedup（FR-014，防同内容重复存）
      seenContent.add(c.contentRaw);
      newChunks.push(c);
      newMeta.push({
        chunkId: c.chunkId, docId: c.docId, docTitle: doc.title, sourceUrl: doc.sourceUrl, anchor: c.anchor,
        sdkVersion: null, builtAt, ingestSourceType: type, ingestOrigin: origin, ingestedAt: builtAt,
      });
      if (!originalContent.has(c.contentRaw)) newChunkCount++; // 仅统计导入前不存在的内容
    }
  }

  // 抽实体（仅新内容）→ merge key 覆盖
  const extractOpts: Parameters<typeof extractEntities>[1] = {};
  if (opts.noLlm === true) extractOpts.noLlm = true;
  const docLang = new Map(newDocs.map((d) => [d.doc.id, d.doc.lang]));
  const extraction = await extractEntities(aggregateSections(newChunks, docLang), extractOpts);
  const entityByKey = new Map<string, ApiEntity>();
  for (const e of keptEntities) entityByKey.set(e.id, e);
  let newEntityCount = 0;
  for (const e of extraction.entities) {
    if (!originalEntityKeys.has(e.id)) newEntityCount++;
    entityByKey.set(e.id, e);
  }

  const allChunks = [...keptChunks, ...newChunks];
  const allMeta = [...keptMeta, ...newMeta];
  const allEntities = [...entityByKey.values()];
  const sqliteBytes = await buildChunksDbBytes(allChunks, allMeta);
  const entityFile: ApiEntityFile = {
    schemaVersion: '1.0', builtAt, sdkVersion: null, sourceKind: 'project', entities: allEntities,
  };
  const graphJson = JSON.stringify({ schema_version: '1.0', source: 'directory', built_at: builtAt, sdk_version: null, nodes: nodes.map((n) => ({ id: n.id, title: n.title, summary: null, tags: [], lang: n.lang, source_url: n.sourceUrl })), edges: existing.edges }, null, 2);

  return {
    newDocs: newDocs.length,
    newChunks: newChunkCount,
    newEntities: newEntityCount,
    totalChunks: allChunks.length,
    totalEntities: allEntities.length,
    sources: results,
    artifacts: { graphJson, sqliteBytes, entitiesJson: JSON.stringify(serializeApiEntities(entityFile), null, 2) },
  };
}

/** 落盘项目库三件套（原子） */
export function commitIngest(projectKbPath: string, plan: IngestPlan): void {
  writeKbArtifactsAtomic(projectKbPath, [
    { name: 'doc-graph.json', data: plan.artifacts.graphJson },
    { name: 'chunks.sqlite', data: plan.artifacts.sqliteBytes },
    { name: 'api-entities.json', data: plan.artifacts.entitiesJson },
  ]);
}
