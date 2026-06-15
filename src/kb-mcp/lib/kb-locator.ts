/**
 * F190 KB MCP — 厂商库/项目库定位 + 加载 + 进程内缓存（cold/warm 性能前提）
 *
 * 降级语义（修 Codex tasks-WARNING）：
 * - 两库皆不可用 → KB_NOT_FOUND
 * - 仅一库可用 → 降级查该库（非错误），sourcesAvailable 如实标注
 * - chunks.sqlite 损坏 → KB_CORRUPT
 * - doc-graph.json 缺失/损坏 → graph=null（kb_search 仍可用，kb_doc_lookup 降级）
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDbFromBytes, type SqliteDb } from '../../scaffold-kb/sqlite-engine.js';
import { deserializeApiEntities } from '../../scaffold-kb/api-entities-serializer.js';
import type { ApiEntityFile } from '../../scaffold-kb/types.js';
import type { KbErrorCode } from './kb-error.js';
import type { SourceKind } from './result-merger.js';

/** 解析后的 doc-graph.json（on-disk snake_case 形态） */
export interface DocGraphFile {
  schema_version?: string;
  built_at?: string;
  sdk_version?: string | null;
  nodes: Array<{ id: string; title: string; summary?: string | null; source_url?: string; lang?: string }>;
  edges: Array<{ source: string; target: string; relation: string }>;
}

export interface KbHandle {
  db: SqliteDb;
  graph: DocGraphFile | null;
  /** F192：api-entities.json（缺失/损坏 → null，kb_api_lookup 降级 document_fallback） */
  entities: ApiEntityFile | null;
}

export interface KbContext {
  vendor: KbHandle | null;
  project: KbHandle | null;
  sourcesAvailable: SourceKind[];
}

export type LoadKbResult = { ok: true; context: KbContext } | { ok: false; code: KbErrorCode };

async function loadHandle(kbDir: string): Promise<KbHandle | { corrupt: true }> {
  const sqlitePath = join(kbDir, 'chunks.sqlite');
  let db: SqliteDb | undefined;
  try {
    const bytes = readFileSync(sqlitePath);
    db = (await loadDbFromBytes(bytes)).db;
    // 触一次查询确认库结构可用（损坏会抛）
    db.exec('SELECT count(*) FROM chunk_meta');
  } catch {
    // probe 失败时关闭已加载的 DB，避免泄漏（修 Codex WARNING）
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    return { corrupt: true };
  }
  let graph: DocGraphFile | null = null;
  try {
    const graphPath = join(kbDir, 'doc-graph.json');
    if (existsSync(graphPath)) {
      graph = JSON.parse(readFileSync(graphPath, 'utf-8')) as DocGraphFile;
    }
  } catch {
    graph = null; // doc-graph 损坏 → 仅 kb_doc_lookup 降级，不影响 kb_search
  }
  // F192：api-entities.json（可选，同 graph 降级语义）
  let entities: ApiEntityFile | null = null;
  try {
    const entitiesPath = join(kbDir, 'api-entities.json');
    if (existsSync(entitiesPath)) {
      entities = deserializeApiEntities(JSON.parse(readFileSync(entitiesPath, 'utf-8')));
    }
  } catch {
    entities = null; // 缺失/损坏 → kb_api_lookup 降级 document_fallback（W-3）
  }
  return { db, graph, entities };
}

/**
 * 加载 KB 上下文（一次性，缓存交由调用方持有 → warm 复用）。
 * @param opts.vendorKbPath 厂商库 kb/ 目录；opts.projectKbPath 项目库 kb/ 目录（可选）
 */
export async function loadKbContext(opts: {
  vendorKbPath?: string;
  projectKbPath?: string;
}): Promise<LoadKbResult> {
  let vendor: KbHandle | null = null;
  let project: KbHandle | null = null;
  const sourcesAvailable: SourceKind[] = [];

  if (opts.vendorKbPath && existsSync(join(opts.vendorKbPath, 'chunks.sqlite'))) {
    const h = await loadHandle(opts.vendorKbPath);
    if ('corrupt' in h) return { ok: false, code: 'KB_CORRUPT' };
    vendor = h;
    sourcesAvailable.push('vendor');
  }
  if (opts.projectKbPath && existsSync(join(opts.projectKbPath, 'chunks.sqlite'))) {
    const h = await loadHandle(opts.projectKbPath);
    if ('corrupt' in h) return { ok: false, code: 'KB_CORRUPT' };
    project = h;
    sourcesAvailable.push('project');
  }

  if (vendor === null && project === null) {
    return { ok: false, code: 'KB_NOT_FOUND' };
  }
  return { ok: true, context: { vendor, project, sourcesAvailable } };
}
