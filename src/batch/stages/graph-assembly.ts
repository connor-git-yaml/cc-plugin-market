/**
 * F220 Stage ② — graph assembly（依赖图构建/合并 与 graph-only 建图）
 *
 * 从 batch-orchestrator.ts 依赖闭合搬迁（F220 B3，函数体逐字不变，仅动态 import
 * 相对路径随目录层级 +1）：多语言 ModuleGraph 合并拓扑（Feature 031/TD-002）、
 * 跨语言引用检测与提示（CQ-001）、语言组依赖图构建与目录图兜底、以及
 * Feature 195 零 LLM graph-only 建图入口（F183 写盘出口 / F193 portable 守卫 /
 * F217 sourceCommit 注入语义逐字保留）。
 *
 * logger namespace 保持 'batch-orchestrator'：搬迁函数的日志输出必须 byte-identical。
 *
 * @internal 内部实现模块：外部消费者请从 `batch/batch-orchestrator.js`（facade）导入
 * 公共 14 符号契约；对 stages/ 的深导入不属于稳定 API，随时可能重构。
 */
import * as path from 'node:path';
import { createLogger } from '../../panoramic/utils/logger.js';
import { LanguageAdapterRegistry } from '../../adapters/language-adapter-registry.js';
import type { ModuleGraph, ModuleNode, ModuleEdge } from '../../knowledge-graph/module-derivation.js';
import type { LanguageGroup } from '../language-grouper.js';
import { collectGenericLanguageCodeSkeletons } from '../generic-language-skeleton-collector.js';
import { collectPythonCodeSkeletons, collectTsJsCodeSkeletons } from './source-discovery.js';
import { buildUnifiedGraph } from '../../knowledge-graph/index.js';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../../panoramic/graph/index.js';
import { resolveSourceCommit } from '../../panoramic/graph/source-commit.js';

const logger = createLogger('batch-orchestrator');

/**
 * 合并多个语言的 ModuleGraph 用于全局拓扑排序
 * 仅合并 modules 和 edges，SCC/Mermaid 按语言独立保留（TD-002 选项 C）
 */
export function mergeGraphsForTopologicalSort(
  graphs: ModuleGraph[],
  projectRoot: string,
): ModuleGraph {
  const allModules: ModuleNode[] = [];
  const allEdges: ModuleEdge[] = [];

  for (const graph of graphs) {
    allModules.push(...graph.modules);
    allEdges.push(...graph.edges);
  }

  // 合并 Mermaid 源码（各语言用注释分隔）
  const mermaidParts = graphs
    .filter((g) => g.mermaidSource.trim().length > 0)
    .map((g) => g.mermaidSource);
  const mermaidSource = mermaidParts.join('\n');

  return {
    projectRoot,
    modules: allModules,
    edges: allEdges,
    topologicalOrder: allModules.map((m) => m.source),
    sccs: graphs.flatMap((g) => g.sccs),
    totalModules: allModules.length,
    totalEdges: allEdges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource,
  };
}

/**
 * 检测跨语言引用
 * 扫描模块 imports 是否引用了其他语言组的路径
 */
export function detectCrossLanguageRefs(
  moduleFiles: string[],
  languageGroups: LanguageGroup[],
  graph: ModuleGraph,
): string[] {
  const refs: string[] = [];

  // 构建文件到语言组的映射
  const fileToLang = new Map<string, string>();
  for (const group of languageGroups) {
    for (const file of group.files) {
      fileToLang.set(file, group.adapterId);
    }
  }

  // 查找当前模块文件的语言
  const moduleFileSet = new Set(moduleFiles);
  const moduleLangs = new Set<string>();
  for (const file of moduleFiles) {
    const lang = fileToLang.get(file);
    if (lang) moduleLangs.add(lang);
  }

  // 查找依赖边中指向其他语言的引用
  for (const edge of graph.edges) {
    if (!moduleFileSet.has(edge.from)) continue;
    const targetLang = fileToLang.get(edge.to);
    if (targetLang && !moduleLangs.has(targetLang)) {
      refs.push(`${targetLang}:${edge.to}`);
    }
  }

  return [...new Set(refs)];
}

/**
 * 生成跨语言调用提示文本（CQ-001）
 */
export function generateCrossLanguageHint(languageNames: string[]): string {
  return `\n\n> 注意：本项目包含多种编程语言（${languageNames.join('、')}），` +
    '模块间可能存在 AST 不可见的隐式跨语言调用' +
    '（如 REST API、gRPC、FFI、subprocess 等），' +
    '建议人工审查跨语言交互边界。';
}


export async function buildGraphForLanguageGroup(
  langGroup: LanguageGroup,
  projectRoot: string,
): Promise<ModuleGraph> {
  const registry = LanguageAdapterRegistry.getInstance();
  const adapter = registry.getAllAdapters().find((item) => item.id === langGroup.adapterId);

  if (adapter?.buildModuleGraph) {
    try {
      const langGraph = await adapter.buildModuleGraph(projectRoot);
      for (const node of langGraph.modules) {
        node.language = langGroup.adapterId;
      }
      return langGraph;
    } catch (err) {
      // Codex 对抗审查 W004 修复：升 warn 级别，避免静默回落到不含 import 边的目录图
      logger.warn(
        `语言专属依赖图构建失败（${langGroup.adapterId}），回落到目录图（不含 import 边）: ${String(err)}`,
      );
    }
  }

  return buildFallbackGraph(langGroup, projectRoot);
}

/**
 * 使用 buildDirectoryGraph 为语言组构建兜底依赖图
 */
async function buildFallbackGraph(
  langGroup: LanguageGroup,
  projectRoot: string,
): Promise<ModuleGraph> {
  // buildDirectoryGraph 需要 CodeSkeleton，但此处我们没有骨架
  // 创建最小化的图（仅节点，无边）
  const { buildDirectoryGraph } = await import('../../graph/directory-graph.js');
  const emptySkeletons: any[] = langGroup.files.map((f) => ({
    filePath: f,
    language: langGroup.languageName,
    loc: 0,
    exports: [],
    imports: [],
    hash: '0'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'tree-sitter',
  }));
  return buildDirectoryGraph(langGroup.files, projectRoot, emptySkeletons);
}

// ============================================================
// Feature 195：graph-only 零 LLM 建图路径
// ============================================================

/** Feature 195：graph-only 路径产出结果 */
export interface GraphOnlyResult {
  /** 写盘后的 graph.json 绝对路径 */
  graphPath: string;
  /** 节点总数 */
  nodeCount: number;
  /** 边总数 */
  edgeCount: number;
  /** calls 边数 */
  callEdgeCount: number;
  /** depends-on 边数 */
  dependsOnEdgeCount: number;
  /** Python 符号 component 节点数 */
  pythonSymbolCount: number;
  /** 墙钟耗时（ms） */
  durationMs: number;
}

/**
 * Feature 195：全仓纯 AST、零 LLM 的 graph-only 建图。
 *
 * 与 runBatch 解耦的姊妹管线——只跑 AST 采集 → unifiedGraph（call graph + depends-on）
 * + Python 符号节点 → buildKnowledgeGraph → writeKnowledgeGraph，全程不调用任何
 * spec-gen / enrichment / hyperedge LLM，也不需要认证。
 *
 * why 复用 collectPython/collectTsJs 而非 scanFiles：batch 的 unifiedGraph（见 runBatch
 * 内早期 UnifiedGraph 构建段）正是用这两个采集器构建，复用它们使 graph-only 的 unifiedGraph
 * 与 batch 口径逐一对齐（扩展名集合 + ignore 规则一致）。不按 languages 过滤，与 batch
 * unifiedGraph 行为一致。
 *
 * why writeKnowledgeGraph 传 stripTimestamps:true：与 batch 写盘一致，剥除 generatedAt
 * 实时戳，保 byte-stable 与跨 worktree 一致（F193/NFR-002）。
 */
export async function buildAstGraphOnly(
  projectRoot: string,
  options?: { outputDir?: string },
): Promise<GraphOnlyResult> {
  const startTime = Date.now();
  const resolvedRoot = path.resolve(projectRoot);
  const outputDir = options?.outputDir ?? 'specs';
  const resolvedOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.join(resolvedRoot, outputDir);

  logger.info('[Feature 195] graph-only 建图：纯 AST / 零 LLM');

  // 步骤 1：AST 采集（与 batch unifiedGraph 同款采集器，合并 Python + TS/JS + Java/Go）
  const pythonSkeletons = await collectPythonCodeSkeletons(resolvedRoot);
  const tsJsSkeletons = await collectTsJsCodeSkeletons(resolvedRoot, {
    extractCallSites: true,
  });
  // F217 决策 1：Java/Go 通用采集器接入（默认 adapters = [Java, Go]）
  const genericSkeletons = await collectGenericLanguageCodeSkeletons(resolvedRoot);
  const codeSkeletons = new Map([...pythonSkeletons, ...tsJsSkeletons, ...genericSkeletons]);

  if (codeSkeletons.size === 0) {
    // EC-001：无可解析源码 → 仍产出 schema 合法的空图，不崩溃
    logger.warn('[Feature 195] 未发现可建图的源码（将产出空图）');
  }

  // 步骤 2：UnifiedGraph（calls + depends-on，纯 AST）
  const unifiedGraph =
    codeSkeletons.size > 0
      ? buildUnifiedGraph({ projectRoot: resolvedRoot, codeSkeletons })
      : undefined;

  // 步骤 3：Python 符号节点（纯 AST，extractionResults 第四路）
  // EC-003：extractSymbolNodes 内部已 best-effort（单文件失败仍产文件级节点），此处仅兜底捕获
  let pythonSymbolResults: import('../../extraction/extraction-types.js').ExtractionResult[] = [];
  try {
    const { PythonLanguageAdapter } = await import('../../adapters/python-adapter.js');
    pythonSymbolResults = await new PythonLanguageAdapter().extractSymbolNodes(resolvedRoot);
  } catch (pyErr) {
    logger.warn(`[Feature 195] Python 符号提取失败，跳过: ${String(pyErr)}`);
  }
  const pythonSymbolCount = pythonSymbolResults.reduce(
    (sum, r) => sum + r.nodes.filter((n) => n.kind === 'component').length,
    0,
  );

  // 步骤 4：合并构建 knowledge graph（不传 docGraph/architectureIR/crossReferenceLinks——
  // 那三路依赖 spec-gen 产物；EC-004：buildKnowledgeGraph 对缺席数据源 graceful skip）
  const graphJson = buildKnowledgeGraph({
    ...(unifiedGraph ? { unifiedGraph } : {}),
    ...(pythonSymbolResults.length > 0 ? { extractionResults: pythonSymbolResults } : {}),
  });

  // F217 FR-009：graph-only 基于当前工作树 AST 重新分析源码，写盘前注入 sourceCommit
  // （非 git 仓库 / rev-parse 失败时 resolveSourceCommit 返回 null，不抛异常）
  graphJson.graph.sourceCommit = resolveSourceCommit(resolvedRoot);

  // 步骤 5：复用 F183 写盘出口（内部 portable 守卫扫描 → normalizeGraphForWrite → 原子写）
  const graphPath = writeKnowledgeGraph(graphJson, resolvedOutputDir, {
    stripTimestamps: true,
  });

  const callEdgeCount = graphJson.links.filter((e) => e.relation === 'calls').length;
  const dependsOnEdgeCount = graphJson.links.filter((e) => e.relation === 'depends-on').length;

  logger.info(
    `[Feature 195] graph-only 完成：${graphJson.nodes.length} 节点 / ${graphJson.links.length} 边 ` +
      `(${callEdgeCount} calls, ${dependsOnEdgeCount} depends-on, ${pythonSymbolCount} Python 符号)`,
  );

  return {
    graphPath,
    nodeCount: graphJson.nodes.length,
    edgeCount: graphJson.links.length,
    callEdgeCount,
    dependsOnEdgeCount,
    pythonSymbolCount,
    durationMs: Date.now() - startTime,
  };
}
