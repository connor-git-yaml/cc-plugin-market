/**
 * F190 scaffold-kb — buildKb 主流程编排
 *
 * ingest → split → doc-graph + chunks → 落盘 kb/{doc-graph.json, chunks.sqlite}
 * 原子性：ingest 失败前未写任何文件；所有产物在内存算好后再一次性落盘
 * （EC-008：不留中间态残片）。
 *
 * 同一 CLI 指向项目路径即写项目库（FR-016：`--output <project>/.{tool}/kb`）。
 */

import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiEntityFile, BuildKbOptions, Chunk, ChunkMeta, DocGraph } from './types.js';
import { ingestDocuments } from './ingester.js';
import { splitDocument } from './chunk-splitter.js';
import { buildDocGraph } from './doc-graph-builder.js';
import { buildChunksDbBytes } from './sqlite-writer.js';
import { aggregateSections, extractEntities } from './entity-extractor.js';
import { serializeApiEntities } from './api-entities-serializer.js';

export interface BuildKbResult {
  docCount: number;
  chunkCount: number;
  entityCount: number;
  extractionMethod: 'llm' | 'heuristic' | 'mixed';
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

  // 4. API 实体抽取（FR-001：LLM 提质 + heuristic 兜底；--no-llm 跳过 LLM）
  const docLang = new Map(docs.map((d) => [d.id, d.lang]));
  const sections = aggregateSections(chunks, docLang);
  const extractOpts: Parameters<typeof extractEntities>[1] = {};
  if (opts.noLlm === true) extractOpts.noLlm = true;
  const extraction = await extractEntities(sections, extractOpts);
  const entityFile: ApiEntityFile = {
    schemaVersion: '1.0',
    builtAt,
    sdkVersion,
    sourceKind: opts.sourceKind ?? 'vendor',
    entities: extraction.entities,
    coverage: extraction.coverage,
  };

  // 5. 内存算好全部产物，再一次性原子落盘（三文件：doc-graph + chunks + api-entities，EC-008）
  const sqliteBytes = await buildChunksDbBytes(chunks, meta);
  const graphJson = JSON.stringify(serializeDocGraph(graph), null, 2);
  const entitiesJson = JSON.stringify(serializeApiEntities(entityFile), null, 2);

  mkdirSync(outputPath, { recursive: true });
  const graphPath = join(outputPath, 'doc-graph.json');
  const sqlitePath = join(outputPath, 'chunks.sqlite');
  const entitiesPath = join(outputPath, 'api-entities.json');
  const writes: Array<{ tmp: string; target: string; data: string | Uint8Array }> = [
    { tmp: `${graphPath}.tmp`, target: graphPath, data: graphJson },
    { tmp: `${sqlitePath}.tmp`, target: sqlitePath, data: sqliteBytes },
    { tmp: `${entitiesPath}.tmp`, target: entitiesPath, data: entitiesJson },
  ];
  // 三文件近似原子（C-5）：先写全部 .tmp；commit 阶段对每个 target 先备份 .bak 再 rename，
  // 任一 rename 失败 → 回滚已替换的 target（恢复 .bak）+ 清理 .tmp，杜绝"新 graph + 旧 entities"半成品。
  const committed: Array<{ target: string; bak: string | null }> = [];
  try {
    for (const w of writes) writeFileSync(w.tmp, w.data);
    for (const w of writes) {
      let bak: string | null = null;
      if (existsSync(w.target)) {
        bak = `${w.target}.bak`;
        renameSync(w.target, bak);
      }
      renameSync(w.tmp, w.target);
      committed.push({ target: w.target, bak });
    }
    // 全部成功 → 删除备份
    for (const c of committed) if (c.bak) rmSync(c.bak, { force: true });
  } catch (err) {
    // 回滚：已替换的 target 删除并从 .bak 恢复；清理所有 .tmp
    for (const c of committed) {
      try {
        rmSync(c.target, { force: true });
      } catch {
        /* ignore */
      }
      if (c.bak) {
        try {
          renameSync(c.bak, c.target);
        } catch {
          /* ignore */
        }
      }
    }
    for (const w of writes) {
      try {
        rmSync(w.tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  return {
    docCount: docs.length,
    chunkCount: chunks.length,
    entityCount: extraction.entities.length,
    extractionMethod: extraction.method,
    outputPath,
    builtAt,
  };
}
