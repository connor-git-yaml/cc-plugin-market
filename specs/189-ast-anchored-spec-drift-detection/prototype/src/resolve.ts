/**
 * F189 prototype —— 引用解析（只读复用 F174 canonicalize/fuzzy）。
 *
 * 流程（spec FR-001）：
 *   1. 从文件集 analyzeFiles 派生最小 GraphJSON {nodes, links}（node id = relPath::name，与生产口径一致）
 *   2. canonicalizeSymbolId 做 exact/前缀/路径归一；裸名落空 → resolveSymbolFuzzy partial-name 层
 *   3. 唯一高置信 → 自动 resolve；多候选 → ambiguous + top-3；无候选 → unresolved
 *
 * 不变量：graphData 只读；不自动误绑多候选（复用 F174 不变量）。
 */
import path from 'node:path';
import { analyzeFiles } from '../../../../src/core/ast-analyzer.js';
import { bootstrapAdapters } from '../../../../src/adapters/index.js';
import {
  canonicalizeSymbolId,
  resolveSymbolFuzzy,
} from '../../../../src/knowledge-graph/query-helpers.js';

/** prototype 自用的最小 graph 形态（结构兼容生产 GraphJSON 的 {nodes, links} 读路径） */
export interface MinimalGraph {
  nodes: Array<{ id: string; label: string; kind: string }>;
  links: unknown[];
  metadata: Record<string, unknown>;
}

export interface ResolvedRef {
  symbolId: string | null;
  resolvedFrom: string;
  matchKind?: string;
  status: 'ok' | 'ambiguous' | 'unresolved';
  candidates?: string[];
}

/** 项目相对 POSIX 路径 */
function toRelPosix(absFile: string, projectRoot: string): string {
  return path.relative(projectRoot, absFile).split(path.sep).join('/');
}

/** 从文件集构建最小 graph（node id = relPath::exportName，与生产 deriveNodesFromSkeletons 同口径） */
export async function buildGraphFromFiles(
  absFiles: string[],
  projectRoot: string,
): Promise<MinimalGraph> {
  bootstrapAdapters(); // 幂等：确保语言适配器已注册（生产由 runtime-bootstrap 调用）
  const skeletons = await analyzeFiles(absFiles);
  const nodes: MinimalGraph['nodes'] = [];
  for (const sk of skeletons) {
    const rel = toRelPosix(sk.filePath, projectRoot);
    nodes.push({ id: rel, label: rel.split('/').pop() ?? rel, kind: 'module' });
    for (const exp of sk.exports) {
      nodes.push({ id: `${rel}::${exp.name}`, label: exp.name, kind: 'symbol' });
      for (const m of exp.members ?? []) {
        nodes.push({ id: `${rel}::${exp.name}.${m.name}`, label: `${exp.name}.${m.name}`, kind: 'symbol' });
      }
    }
  }
  return {
    nodes,
    links: [],
    metadata: { name: 'spectra-knowledge-graph', generatedBy: 'f189-prototype' },
  };
}

/** 解析一条引用 → canonical symbol id（exact 优先，裸名走 fuzzy partial-name） */
export function resolveRef(ref: string, graph: MinimalGraph, projectRoot: string): ResolvedRef {
  // 生产函数签名要求 Readonly<GraphJSON>；prototype 的 MinimalGraph 仅覆盖被读字段，用 cast 适配
  const graphData = graph as unknown as Parameters<typeof canonicalizeSymbolId>[1];

  // symbol 节点 id 恒含 `::`（`${rel}::${name}`），module 节点 id 不含。
  // 锚点只接受 symbol（Codex WARNING-2：防 ref 命中同名 module 路径被误绑）。
  const isSymbolId = (id: string): boolean => id.includes('::');

  const canon = canonicalizeSymbolId(ref, graphData, { projectRoot });
  if (canon.reason === 'ok' && canon.canonicalId !== null && isSymbolId(canon.canonicalId)) {
    return { symbolId: canon.canonicalId, resolvedFrom: ref, matchKind: 'exact', status: 'ok' };
  }

  const fuzzy = resolveSymbolFuzzy(graphData, ref, { projectRoot });
  if (fuzzy.autoResolved && fuzzy.candidates.length === 1 && isSymbolId(fuzzy.candidates[0]!.id)) {
    return {
      symbolId: fuzzy.candidates[0]!.id,
      resolvedFrom: ref,
      matchKind: fuzzy.candidates[0]!.matchKind,
      status: 'ok',
    };
  }
  if (fuzzy.candidates.length > 1) {
    return {
      symbolId: null,
      resolvedFrom: ref,
      status: 'ambiguous',
      candidates: fuzzy.candidates.slice(0, 3).map((c) => c.id),
    };
  }
  return { symbolId: null, resolvedFrom: ref, status: 'unresolved' };
}
