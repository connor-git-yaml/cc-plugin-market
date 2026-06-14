/**
 * F190 scaffold-kb — buildKb 主流程编排
 *
 * ingest → split → doc-graph + chunks → 落盘 kb/{doc-graph.json, chunks.sqlite}
 * 原子性：ingest 失败前未写任何文件；所有产物在内存算好后再一次性落盘
 * （EC-008：不留中间态残片）。
 *
 * 同一 CLI 指向项目路径即写项目库（FR-016：`--output <project>/.{tool}/kb`）。
 */

import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildKbOptions, Chunk, ChunkMeta, DocGraph } from './types.js';
import { ingestDocuments } from './ingester.js';
import { splitDocument } from './chunk-splitter.js';
import { buildDocGraph } from './doc-graph-builder.js';
import { buildChunksDbBytes } from './sqlite-writer.js';

export interface BuildKbResult {
  docCount: number;
  chunkCount: number;
  outputPath: string;
  builtAt: string;
}

/** 把内存 DocGraph 序列化为 spec §3.2 的 on-disk JSON（snake_case，含 schema_version 供 EC-009） */
function serializeDocGraph(g: DocGraph): Record<string, unknown> {
  return {
    schema_version: g.schemaVersion,
    source: g.source,
    built_at: g.builtAt,
    sdk_version: g.sdkVersion,
    nodes: g.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary ?? null,
      tags: n.tags ?? [],
      lang: n.lang,
      source_url: n.sourceUrl,
    })),
    edges: g.edges.map((e) => ({ source: e.source, target: e.target, relation: e.relation })),
  };
}

export async function buildKb(opts: BuildKbOptions): Promise<BuildKbResult> {
  const outputPath = opts.outputPath ?? './kb';
  const builtAt = opts.builtAt ?? new Date().toISOString();
  const sdkVersion = opts.sdkVersion ?? null;
  const source: 'llms.txt' | 'directory' = opts.llmsTxtUrl ? 'llms.txt' : 'directory';

  // 1. ingest（参数校验 + 抓取/扫描；失败抛错，此前未落盘 → 原子性）
  const ingestOpts: Parameters<typeof ingestDocuments>[0] = {};
  if (opts.dirPath !== undefined) ingestOpts.dirPath = opts.dirPath;
  if (opts.llmsTxtUrl !== undefined) ingestOpts.llmsTxtUrl = opts.llmsTxtUrl;
  if (opts.lang !== undefined) ingestOpts.lang = opts.lang;
  const docs = await ingestDocuments(ingestOpts);

  // 2. 切分 + 组装 chunk_meta（doc_title/source_url 冗余自 doc，R-003）
  const chunks: Chunk[] = [];
  const meta: ChunkMeta[] = [];
  for (const doc of docs) {
    for (const c of splitDocument(doc)) {
      chunks.push(c);
      meta.push({
        chunkId: c.chunkId,
        docId: c.docId,
        docTitle: doc.title,
        sourceUrl: doc.sourceUrl,
        anchor: c.anchor,
        sdkVersion,
        builtAt,
      });
    }
  }

  // 3. doc-graph
  const graph = buildDocGraph(docs, { source, sdkVersion, builtAt });

  // 4. 先在内存算好 sqlite 字节（与 graph JSON），再一次性落盘（原子性）
  const sqliteBytes = await buildChunksDbBytes(chunks, meta);
  const graphJson = JSON.stringify(serializeDocGraph(graph), null, 2);

  // 5. 落盘（原子性：先写 .tmp 再 rename，避免半成品 KB；修 Codex WARNING）
  mkdirSync(outputPath, { recursive: true });
  const graphPath = join(outputPath, 'doc-graph.json');
  const sqlitePath = join(outputPath, 'chunks.sqlite');
  const graphTmp = `${graphPath}.tmp`;
  const sqliteTmp = `${sqlitePath}.tmp`;
  try {
    writeFileSync(graphTmp, graphJson);
    writeFileSync(sqliteTmp, sqliteBytes);
    renameSync(graphTmp, graphPath);
    renameSync(sqliteTmp, sqlitePath);
  } catch (err) {
    // 清理可能残留的 .tmp，不留中间态（EC-008 原子性）
    for (const t of [graphTmp, sqliteTmp]) {
      try {
        rmSync(t, { force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  return { docCount: docs.length, chunkCount: chunks.length, outputPath, builtAt };
}
