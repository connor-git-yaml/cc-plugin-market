/**
 * F190 scaffold-kb — 共享类型（构建流水线各模块的契约单一事实源）
 */

/** 知识库来源种类（厂商库 / 项目库）；下沉到 scaffold-kb 供 evidence-envelope 复用，避免反向依赖 kb-mcp */
export type SourceKind = 'vendor' | 'project';

/** ingester 解析出的单篇文档 */
export interface ParsedDoc {
  /** 文档唯一 id（URL path 或文件相对路径），同一 KB 内稳定唯一 */
  id: string;
  /** 文档标题 */
  title: string;
  /** 文档 Markdown 正文 */
  content: string;
  /** 原始来源（URL 或文件路径） */
  sourceUrl: string;
  /** 语言标记 */
  lang: 'zh' | 'en' | string;
  /** 文档内显式引用的其它文档目标（href / llms.txt 关联），用于 doc-graph 边 */
  references?: string[];
}

/** chunk-splitter 切出的单个片段 */
export interface Chunk {
  /** `doc_id + '#' + anchor`（同 anchor 多 chunk 追加序号），稳定可复现 */
  chunkId: string;
  /** 所属文档 id */
  docId: string;
  /** 片段原文（envelope 返回用） */
  contentRaw: string;
  /** 所在段落/章节锚点 slug（如 `error-codes`），可空 */
  anchor: string | null;
}

/** chunk_meta 表的一行（关联检索结果到来源） */
export interface ChunkMeta {
  chunkId: string;
  docId: string;
  /** 冗余自 doc-graph 节点 title，使 kb_search 不依赖 doc-graph.json（R-003） */
  docTitle: string;
  sourceUrl: string | null;
  anchor: string | null;
  sdkVersion: string | null;
  builtAt: string;
}

/** doc-graph.json 节点 */
export interface DocNode {
  id: string;
  title: string;
  summary?: string;
  tags?: string[];
  lang: string;
  sourceUrl: string;
}

/** doc-graph.json 边 */
export interface DocEdge {
  source: string;
  target: string;
  relation: 'references' | 'mentions' | 'supersedes';
}

/** doc-graph.json 结构契约（spec §3.2） */
export interface DocGraph {
  schemaVersion: '1.0';
  source: 'llms.txt' | 'directory';
  builtAt: string;
  sdkVersion: string | null;
  nodes: DocNode[];
  edges: DocEdge[];
}

/** scaffold-kb build 选项 */
export interface BuildKbOptions {
  /** 远程 llms.txt 索引 URL */
  llmsTxtUrl?: string;
  /** 本地 Markdown 文档目录 */
  dirPath?: string;
  /** kb/ 产物输出目录（默认 ./kb） */
  outputPath?: string;
  /** SDK 版本（写入产物元数据） */
  sdkVersion?: string;
  /** 文档语言标记（写入 doc-graph 节点 lang；默认 en） */
  lang?: string;
  /** 注入的时间戳（ISO 8601）；幂等比较时排除（不传则由 build 决定，测试可固定） */
  builtAt?: string;
}
