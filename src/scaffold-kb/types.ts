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

/** 三方导入来源种类（F192 §3.3 provenance）；null/缺省 = F190 旧库或厂商构建 */
export type IngestSourceType =
  | 'llms-txt'
  | 'markdown-dir'
  | 'url'
  | 'office-docx'
  | 'office-pptx'
  | 'office-pdf'
  | 'minutes';

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
  /** F192 provenance（仅新建/项目库写入；F190 旧库读取时为 null，见 R-COMPAT-1） */
  ingestSourceType?: IngestSourceType | null;
  ingestOrigin?: string | null;
  ingestedAt?: string | null;
}

/** API 实体单条（F192 §3.2；文档自抽取，证据级，非代码级） */
export interface ApiEntity {
  /** 稳定唯一 id：qualified_name + kind + overload_key 归一 */
  id: string;
  name: string;
  /** 文档侧限定名（含 namespace/容器路径）；无则等于 name */
  qualifiedName: string;
  /** 所属 class/module/namespace（可选） */
  container?: string | null;
  /** 同名重载消歧键（可选） */
  overloadKey?: string | null;
  kind: 'function' | 'method' | 'class' | 'constant' | 'type' | 'endpoint' | 'error_code' | 'event';
  signature?: string | null;
  params?: Array<{ name: string; type?: string | null; required?: boolean; doc?: string | null }>;
  returns?: string | null;
  deprecated?: { isDeprecated: boolean; since?: string | null; replacement?: string | null };
  sinceVersion?: string | null;
  sourceDocId: string;
  /** primary 证据 chunk id（chunks.sqlite，仅同一次 build 内可回溯） */
  sourceChunkId: string;
  /** 证据链跨多 chunk 时的全部 chunk id（可选） */
  sourceChunkIds?: string[];
  sourceAnchor?: string | null;
  /** 抽取依据的原文片段（截断，可选） */
  evidenceQuote?: string | null;
  lang: string;
  /** [0,1]，读取越界 clamp、非数值视为缺失 */
  confidence: number;
  extractionMethod: 'llm' | 'heuristic';
}

/**
 * 抽取输入单元（section 窗口，W-4）：同 docId+anchor 的相邻 chunk 聚合，
 * 防 API 签名/参数跨 chunk 被切碎。LLM 与 heuristic 抽取共享此输入契约。
 */
export interface ExtractionSection {
  docId: string;
  anchor: string | null;
  lang: string;
  /** 窗口内全部 chunk id（primary = chunkIds[0]） */
  chunkIds: string[];
  /** 聚合后的原文文本 */
  text: string;
}

/** api-entities.json 结构契约（F192 §3.2） */
export interface ApiEntityFile {
  schemaVersion: '1.0';
  builtAt: string;
  sdkVersion: string | null;
  sourceKind: SourceKind;
  entities: ApiEntity[];
  /** 成本护栏：抽取覆盖率元字段（超预算截断时记录，FR-001） */
  coverage?: { totalSections: number; extractedSections: number };
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
  /** 跳过 LLM 抽取，只走 heuristic（CLI --no-llm，FR-001） */
  noLlm?: boolean;
  /** 产物 source_kind（厂商构建=vendor，项目导入=project）；默认 vendor */
  sourceKind?: SourceKind;
}
