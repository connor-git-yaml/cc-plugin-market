/**
 * module-derivation.ts — UnifiedGraph 派生 ModuleGraph 工具（Feature 156 W1.4 atomic switch）
 *
 * 角色：UnifiedGraph 的合法计算工具，不是过渡 shim。
 *   - 输入：UnifiedGraph（唯一 source of truth）
 *   - 输出：ModuleGraph 视图（含 inDegree / outDegree / level / SCC / topologicalOrder /
 *     mermaidSource，是 panoramic / batch / index-generator 等 17 consumer 的消费形态）
 *
 * 设计原则（FR-22 / AC-5 / NG-7）：
 *   - ModuleGraph 与 UnifiedGraph 并行存在，是 UnifiedGraph 的派生视图（不是双轨数据源）
 *   - 类型名以 "Module" 为前缀，与 UnifiedGraph 的语义边界清晰分离
 *
 * 关键约束（FR-31）：
 *   - 派生函数必须从**当次输入**（UnifiedGraph 参数）派生
 *   - 禁止读取 getCurrentUnifiedGraph() 全局 cache
 */
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { buildTsConfigContext } from '../core/import-resolver.js';
import type { UnifiedGraph } from './unified-graph.js';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import { detectSCCs, topologicalSort } from '../graph/topological-sort.js';
import { renderModuleGraph } from '../graph/mermaid-renderer.js';
import { buildUnifiedGraph } from './index.js';
import { analyzeFileInternal } from '../core/ast-analyzer.js';
import { scanFiles } from '../utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { createLogger } from '../panoramic/utils/logger.js';

const logger = createLogger('module-derivation');

/** workspace 约定目录（monorepo per-package tsconfig 常驻于此） */
const MONOREPO_WORKSPACE_DIRS = ['packages', 'apps', 'libs'] as const;

// ───────────────────────────────────────────────────────────
// ModuleGraph schema
// ───────────────────────────────────────────────────────────

/** import 语义类型（commonjs-require 在 module 视图中归并到 static） */
export const ModuleImportTypeSchema = z.enum(['static', 'dynamic', 'type-only']);
export type ModuleImportType = z.infer<typeof ModuleImportTypeSchema>;

/** 模块图节点（kind === 'module' 的 UnifiedNode 派生） */
export const ModuleNodeSchema = z.object({
  source: z.string().min(1),
  isOrphan: z.boolean(),
  inDegree: z.number().int().nonnegative(),
  outDegree: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  /** 节点所属的编程语言（多语言图合并时使用） */
  language: z.string().optional(),
});
export type ModuleNode = z.infer<typeof ModuleNodeSchema>;

/** 模块间依赖边（depends-on 关系的 UnifiedEdge 派生） */
export const ModuleEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  isCircular: z.boolean(),
  importType: ModuleImportTypeSchema,
});
export type ModuleEdge = z.infer<typeof ModuleEdgeSchema>;

/** 模块图强连通分量 */
export const ModuleStronglyConnectedSetSchema = z.object({
  id: z.number().int().nonnegative(),
  modules: z.array(z.string().min(1)).min(1),
});
export type ModuleStronglyConnectedSet = z.infer<typeof ModuleStronglyConnectedSetSchema>;

/** 模块依赖图（UnifiedGraph 派生视图） */
export const ModuleGraphSchema = z.object({
  projectRoot: z.string().min(1),
  modules: z.array(ModuleNodeSchema),
  edges: z.array(ModuleEdgeSchema),
  topologicalOrder: z.array(z.string()),
  sccs: z.array(ModuleStronglyConnectedSetSchema),
  totalModules: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  analyzedAt: z.string().datetime(),
  mermaidSource: z.string(),
});
export type ModuleGraph = z.infer<typeof ModuleGraphSchema>;

// ───────────────────────────────────────────────────────────
// 派生 API
// ───────────────────────────────────────────────────────────

/**
 * 把 UnifiedGraph 派生成 ModuleGraph 视图。
 *
 * @param unified - 源 UnifiedGraph（必传，禁止从全局 cache 取）
 * @param projectRoot - 项目根目录
 * @returns ModuleGraph 视图
 */
export function deriveModuleGraph(
  unified: UnifiedGraph,
  projectRoot: string,
): ModuleGraph {
  // ── 1. 过滤 module 节点 + depends-on 边 ──
  const moduleIds = new Set<string>();
  for (const n of unified.nodes) {
    if (n.kind === 'module') moduleIds.add(n.id);
  }

  const dependsOnEdges = unified.edges.filter((e) => e.relation === 'depends-on');

  // ── 2. 过滤掉指向非 module 节点的边 + 自引用 ──
  const moduleEdges = dependsOnEdges.filter(
    (e) => moduleIds.has(e.source) && moduleIds.has(e.target) && e.source !== e.target,
  );

  // ── 3. 派生 ModuleEdge 中间体（不含 isCircular，待 SCC 计算后填充）──
  type EdgeDraft = { from: string; to: string; importType: ModuleImportType };
  const edgeDrafts: EdgeDraft[] = moduleEdges.map((e) => ({
    from: e.source,
    to: e.target,
    importType: parseImportType(e.metadata, e.evidence),
  }));

  // ── 4. 计算 inDegree / outDegree（线性扫描）──
  const inDegrees = new Map<string, number>();
  const outDegrees = new Map<string, number>();
  for (const id of moduleIds) {
    inDegrees.set(id, 0);
    outDegrees.set(id, 0);
  }
  for (const e of edgeDrafts) {
    outDegrees.set(e.from, (outDegrees.get(e.from) ?? 0) + 1);
    inDegrees.set(e.to, (inDegrees.get(e.to) ?? 0) + 1);
  }

  // ── 5. 构造初始 ModuleNode 列表（level 暂置 0，topologicalSort 后回填）──
  const nodes: ModuleNode[] = [];
  for (const id of moduleIds) {
    const inDeg = inDegrees.get(id) ?? 0;
    const outDeg = outDegrees.get(id) ?? 0;
    nodes.push({
      source: id,
      isOrphan: inDeg === 0 && outDeg === 0,
      inDegree: inDeg,
      outDegree: outDeg,
      level: 0,
    });
  }

  // ── 6. 构造临时 ModuleGraph 供 detectSCCs / topologicalSort 消费 ──
  const tempEdges: ModuleEdge[] = edgeDrafts.map((d) => ({
    from: d.from,
    to: d.to,
    isCircular: false,
    importType: d.importType,
  }));
  const tempGraph: ModuleGraph = {
    projectRoot,
    modules: nodes,
    edges: tempEdges,
    topologicalOrder: [],
    sccs: [],
    totalModules: nodes.length,
    totalEdges: tempEdges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };

  // ── 7. SCC + topologicalSort（既有 Tarjan + Kahn 算法）──
  const sccs: ModuleStronglyConnectedSet[] = detectSCCs(tempGraph);
  const sortResult = topologicalSort(tempGraph);

  // ── 8. SCC 反查：构造 nodeId → sccIndex 映射；
  //     仅当 source / target 在**同一** size>1 SCC 才标 isCircular = true。
  const nodeToSccIndex = new Map<string, number>();
  for (let idx = 0; idx < sccs.length; idx++) {
    const scc = sccs[idx]!;
    if (scc.modules.length > 1) {
      for (const m of scc.modules) nodeToSccIndex.set(m, idx);
    }
  }

  // ── 9. 重建最终 edges：填 isCircular（仅同一 SCC 内边标 true） ──
  const finalEdges: ModuleEdge[] = edgeDrafts.map((d) => {
    const fromScc = nodeToSccIndex.get(d.from);
    const toScc = nodeToSccIndex.get(d.to);
    const isCircular = fromScc !== undefined && fromScc === toScc;
    return {
      from: d.from,
      to: d.to,
      isCircular,
      importType: d.importType,
    };
  });

  // ── 10. 回填节点 level ──
  for (const node of nodes) {
    node.level = sortResult.levels.get(node.source) ?? 0;
  }

  // ── 11. 渲染 mermaid 源码 ──
  const finalGraph: ModuleGraph = {
    projectRoot,
    modules: nodes,
    edges: finalEdges,
    topologicalOrder: sortResult.order,
    sccs,
    totalModules: nodes.length,
    totalEdges: finalEdges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };
  finalGraph.mermaidSource = renderModuleGraph(finalGraph);

  return finalGraph;
}

/**
 * 从 CodeSkeleton Map 一站式派生 ModuleGraph。
 *
 * 适用场景：调用方已自行解析好 imports[].resolvedPath（如 python-adapter），
 * 直接喂给 buildUnifiedGraph 派生 module 节点 + depends-on 边。
 *
 * @param codeSkeletons - filePath（相对项目根）→ CodeSkeleton（含 resolvedPath）
 * @param projectRoot - 项目根目录（绝对路径）
 * @param language - 可选：给所有 module 节点统一打 language 标签
 */
export function buildModuleGraphFromCodeSkeletons(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
  projectRoot: string,
  language?: CodeSkeleton['language'],
): ModuleGraph {
  if (codeSkeletons.size === 0) {
    return createEmptyModuleGraph(projectRoot);
  }
  const unified = buildUnifiedGraph({ projectRoot, codeSkeletons });
  const derived = deriveModuleGraph(unified, projectRoot);

  if (language) {
    for (const node of derived.modules) {
      node.language = language;
    }
  } else {
    const registry = LanguageAdapterRegistry.getInstance();
    for (const node of derived.modules) {
      const adapter = registry.getAdapter(node.source);
      if (adapter) node.language = adapter.id;
    }
  }
  return derived;
}

/**
 * 创建空的 ModuleGraph（用于无文件或解析全失败的兜底场景）
 */
export function createEmptyModuleGraph(projectRoot: string): ModuleGraph {
  return {
    projectRoot,
    modules: [],
    edges: [],
    topologicalOrder: [],
    sccs: [],
    totalModules: 0,
    totalEdges: 0,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };
}

/**
 * F183 修复 3（Codex W1 修正）：探测 monorepo per-package tsconfig。
 * 仅扫 workspace 约定目录的直接子目录是否含 tsconfig.json——batch per-file nearest 会命中、
 * 而 module-derivation root-only 会漏的子包配置信号。不再误判根级 tsconfig.base.json 等单包 config-split。
 * fs 探针通过 io 参数注入，便于零全局 mock 单测（避免污染 scanFiles 的 Dirent 调用，Codex C-2）。
 * 返回命中的子包相对路径（如 ['packages/core','apps/web']）。
 */
export function findMonorepoPackageTsConfigDirs(
  root: string,
  io: {
    readdirSync: (p: string) => Array<{ name: string; isDirectory: () => boolean }>;
    existsSync: (p: string) => boolean;
  } = {
    readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
    existsSync: fs.existsSync,
  },
): string[] {
  const hits: string[] = [];
  for (const ws of MONOREPO_WORKSPACE_DIRS) {
    const wsPath = path.join(root, ws);
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = io.readdirSync(wsPath);
    } catch {
      continue; // workspace 目录不存在/不可读 → 跳过
    }
    for (const e of entries) {
      if (e.isDirectory() && io.existsSync(path.join(wsPath, e.name, 'tsconfig.json'))) {
        hits.push(`${ws}/${e.name}`);
      }
    }
  }
  return hits;
}

// ───────────────────────────────────────────────────────────
// 工程入口：TS/JS 项目全量构建（取代 legacy buildGraph）
// ───────────────────────────────────────────────────────────

/**
 * TS/JS 项目级 ModuleGraph 构建器（W1.4：取代 legacy src/graph/dependency-graph.ts）。
 *
 * 流程：
 *   1. scanFiles 收集 TS/JS 源文件
 *   2. analyzeFileInternal（ast-analyzer + import-resolver）产出 CodeSkeleton（含 resolvedPath）
 *   3. buildUnifiedGraph 派生 calls + depends-on 边
 *   4. deriveModuleGraph 派生 ModuleGraph 视图
 */
export interface BuildModuleGraphOptions {
  /** 用于过滤分析文件的 Glob 模式（默认 '^src/'） */
  includeOnly?: string;
  /** 排除模式 */
  excludePatterns?: string[];
  /** tsconfig.json 路径 */
  tsConfigPath?: string;
}

export class ProjectNotFoundError extends Error {
  constructor(projectRoot: string) {
    super(`项目目录不存在: ${projectRoot}`);
    this.name = 'ProjectNotFoundError';
  }
}

/**
 * 构建项目级 TS/JS ModuleGraph（取代 legacy buildGraph）。
 *
 * @param projectRoot - 项目根目录
 * @param options - 构建选项
 * @returns ModuleGraph
 */
export async function buildModuleGraphForProject(
  projectRoot: string,
  options: BuildModuleGraphOptions = {},
): Promise<ModuleGraph> {
  const resolvedRoot = path.resolve(projectRoot);

  if (!fs.existsSync(resolvedRoot)) {
    throw new ProjectNotFoundError(projectRoot);
  }

  // ── 1. 扫描 TS/JS 源文件 ──
  const registry = LanguageAdapterRegistry.getInstance();
  const tsJsAdapter = registry.getAllAdapters().find((a) => a.id === 'ts-js');
  const tsJsExts = tsJsAdapter
    ? new Set(tsJsAdapter.extensions)
    : new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

  const includeOnlyRe = options.includeOnly ? new RegExp(options.includeOnly) : /^src\//;
  const srcDir = path.join(resolvedRoot, 'src');
  const scanRoot = fs.existsSync(srcDir) ? srcDir : resolvedRoot;

  let scanResult;
  try {
    scanResult = scanFiles(scanRoot, {
      projectRoot: resolvedRoot,
      extensions: tsJsExts,
    });
  } catch (err) {
    logger.warn(`scanFiles 失败，回退到空模块图: ${String(err)}`);
    return createEmptyModuleGraph(resolvedRoot);
  }

  const testPattern = tsJsAdapter?.getTestPatterns().filePattern;
  const tsJsFiles: string[] = [];
  for (const relToScan of scanResult.files) {
    const absFile = path.isAbsolute(relToScan) ? relToScan : path.join(scanRoot, relToScan);
    const rel = path.relative(resolvedRoot, absFile).split(path.sep).join('/');
    if (!includeOnlyRe.test(rel)) continue;
    if (testPattern && testPattern.test(rel)) continue;
    if (rel.includes('__tests__') || rel.includes('__mocks__')) continue;
    tsJsFiles.push(rel);
  }

  if (tsJsFiles.length === 0) {
    return createEmptyModuleGraph(resolvedRoot);
  }

  // ── 2. 解析 tsconfig（Feature 181 收口：统一 loader buildTsConfigContext，
  //       含 extends 链；root tsconfig 选取策略保持现状，不改为 per-file nearest）──
  const tsConfigPath = options.tsConfigPath
    ?? (fs.existsSync(path.join(resolvedRoot, 'tsconfig.json'))
      ? path.join(resolvedRoot, 'tsconfig.json')
      : undefined);

  // F183 修复 3（双口径可观测性）：探测 monorepo per-package tsconfig（workspace 约定目录的
  // 子包 tsconfig.json）。存在则说明 batch per-file nearest 会命中、而 module-derivation
  // root-only 会漏的子包 alias 可能漏解析，发 warn 提示该已知限制。
  const monorepoPkgs = findMonorepoPackageTsConfigDirs(resolvedRoot);
  if (monorepoPkgs.length >= 1) {
    logger.warn(
      `[module-derivation] 检测到 monorepo 子包 tsconfig（${monorepoPkgs.join(', ')}）。` +
        `module-derivation 使用 root-only tsconfig，batch 使用 per-file nearest tsconfig，子包 alias 可能漏解析。详见 F183 已知限制。`,
    );
  }

  const tsConfigContext = tsConfigPath ? buildTsConfigContext(tsConfigPath) : null;

  // ── 3. 调用 ast-analyzer 提取每个文件的 CodeSkeleton ──
  const codeSkeletons = new Map<string, CodeSkeleton>();
  const ANALYZE_CONCURRENCY = 8;
  const analyzerOpts = {
    projectRoot: resolvedRoot,
    ...(tsConfigContext ? { tsConfigContext } : {}),
  };
  for (let i = 0; i < tsJsFiles.length; i += ANALYZE_CONCURRENCY) {
    const batch = tsJsFiles.slice(i, i + ANALYZE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (rel) => {
        const absPath = path.join(resolvedRoot, rel);
        try {
          const sk = await analyzeFileInternal(absPath, analyzerOpts);
          return { rel, sk } as const;
        } catch (err) {
          logger.warn(`analyzeFile 失败（${rel}）: ${String(err)}`);
          return { rel, sk: null } as const;
        }
      }),
    );
    for (const { rel, sk } of batchResults) {
      if (sk) {
        codeSkeletons.set(rel, normalizeSkeletonPaths(sk, resolvedRoot, rel));
      }
    }
  }

  if (codeSkeletons.size === 0) {
    return createEmptyModuleGraph(resolvedRoot);
  }

  // ── 4. 构建 UnifiedGraph ──
  const unified = buildUnifiedGraph({
    projectRoot: resolvedRoot,
    codeSkeletons,
  });

  // ── 5. 派生 ModuleGraph + 给节点回填 language ──
  const derived = deriveModuleGraph(unified, resolvedRoot);
  for (const node of derived.modules) {
    const adapter = registry.getAdapter(node.source);
    if (adapter) {
      node.language = adapter.id;
    }
  }
  return derived;
}

// ───────────────────────────────────────────────────────────
// 内部辅助
// ───────────────────────────────────────────────────────────

/**
 * 从 UnifiedEdge 解析 importType。
 *
 * 优先级：
 *   1. edge.metadata.importType（结构化字段）
 *   2. evidence 前缀（旧产物兼容）
 *   3. 默认 'static'
 */
function parseImportType(
  metadata: Record<string, unknown> | undefined,
  evidence: string | undefined,
): ModuleImportType {
  const metaType = metadata?.importType;
  if (typeof metaType === 'string') {
    if (metaType === 'type-only') return 'type-only';
    if (metaType === 'dynamic') return 'dynamic';
    if (metaType === 'commonjs-require') return 'static';
    if (metaType === 'static') return 'static';
  }

  if (evidence) {
    if (evidence.startsWith('type-only:')) return 'type-only';
    if (evidence.startsWith('dynamic:')) return 'dynamic';
    if (evidence.startsWith('commonjs-require:')) return 'static';
    if (evidence.startsWith('static:')) return 'static';
  }

  return 'static';
}

/**
 * 把 CodeSkeleton 中的 imports[].resolvedPath 从绝对路径归一化为相对路径，
 * 使其与 codeSkeletons Map 的 key（相对路径）对齐。
 */
function normalizeSkeletonPaths(
  sk: CodeSkeleton,
  projectRoot: string,
  callerRel: string,
): CodeSkeleton {
  const newImports = sk.imports.map((imp) => {
    if (!imp.resolvedPath) return imp;
    const rel = path.relative(projectRoot, imp.resolvedPath).split(path.sep).join('/');
    return { ...imp, resolvedPath: rel.startsWith('..') ? imp.resolvedPath : rel };
  });
  return { ...sk, filePath: callerRel, imports: newImports };
}
