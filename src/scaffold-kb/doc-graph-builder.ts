/**
 * F190 scaffold-kb — doc-graph 构建器
 *
 * 将 ParsedDoc 列表转换为 DocGraph（doc-graph.json 结构契约）。
 * 幂等保证：相同输入（同 docs 同 opts）产出在去掉 builtAt 后字节级一致。
 * 排序规则：nodes 按 doc.id 升序，edges 按 (source, target) 升序。
 */

import type { DocGraph, DocNode, DocEdge, ParsedDoc } from './types.js';

/** buildDocGraph 的选项参数 */
export interface BuildDocGraphOpts {
  /** 文档来源类型 */
  source: 'llms.txt' | 'directory';
  /** SDK 版本（可选），写入产物元数据 */
  sdkVersion: string | null;
  /** 构建时间戳（ISO 8601），幂等对比时排除 */
  builtAt: string;
}

/**
 * 从解析文档列表构建文档图（doc-graph.json）。
 *
 * @param docs  ingester 解析出的文档数组
 * @param opts  来源类型、SDK 版本、构建时间戳
 * @returns     满足 spec §3.2 结构契约的 DocGraph
 */
export function buildDocGraph(docs: ParsedDoc[], opts: BuildDocGraphOpts): DocGraph {
  // 第一步：构建 id 集合，用于悬空引用过滤
  const idSet = new Set<string>(docs.map((d) => d.id));

  // 第二步：映射 ParsedDoc → DocNode，按 id 升序排列确保幂等
  const nodes: DocNode[] = docs
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => {
      const node: DocNode = {
        id: doc.id,
        title: doc.title,
        lang: doc.lang,
        sourceUrl: doc.sourceUrl,
      };
      // summary 和 tags 是可选字段，仅当 ParsedDoc 携带时写入
      // ParsedDoc 接口本身没有 summary/tags，为 future-proof 保留扩展检查
      return node;
    });

  // 第三步：从 doc.references 提取 DocEdge，跳过悬空引用（目标 id 不在集合内）
  const edgeMap = new Map<string, DocEdge>();
  for (const doc of docs) {
    const refs = doc.references;
    if (refs === undefined || refs.length === 0) {
      continue;
    }
    for (const targetId of refs) {
      // 悬空引用跳过（目标文档不存在于 docs 集合）
      if (!idSet.has(targetId)) {
        continue;
      }
      // 使用 "source|target" 作为 key 去重（同一对可能从多处引用）
      const key = `${doc.id}\x00${targetId}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: doc.id,
          target: targetId,
          relation: 'references',
        });
      }
    }
  }

  // 按 (source, target) 升序排列，保证幂等
  const edges: DocEdge[] = Array.from(edgeMap.values()).sort((a, b) => {
    const cmp = a.source.localeCompare(b.source);
    if (cmp !== 0) return cmp;
    return a.target.localeCompare(b.target);
  });

  return {
    schemaVersion: '1.0',
    source: opts.source,
    builtAt: opts.builtAt,
    sdkVersion: opts.sdkVersion,
    nodes,
    edges,
  };
}
