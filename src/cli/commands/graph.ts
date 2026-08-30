/**
 * graph 子命令 handler
 * 构建知识图谱并持久化为 _meta/graph.json
 * 支持独立运行，不依赖完整 batch 流程
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CLICommand } from '../utils/parse-args.js';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../../panoramic/graph/index.js';
import type { ArchitectureIR } from '../../panoramic/models/architecture-ir-model.js';
import type { DocGraph } from '../../panoramic/builders/doc-graph-builder.js';
import type { CrossReferenceLink } from '../../models/module-spec.js';
import { SpecStore } from '../../spec-store/index.js';

const GRAPH_HELP = `spectra graph — 构建并持久化知识图谱

用法:
  spectra graph [--directed] [--force] [--output-dir <dir>]

说明:
  读取当前项目的 architecture-ir、doc-graph、cross-reference-index，
  合并构建 NetworkX 兼容的 graph.json 并写入 _meta/ 目录。

选项:
  --directed          输出有向图（默认为无向图）
  --output-dir <dir>  指定输出根目录（默认：{cwd}/specs）
  --force             跳过信息量守卫，允许写入节点数 / 边数 / calls 边数少于现有图的新图
  --help              显示帮助信息

输出:
  {output-dir}/_meta/graph.json

退出码:
  0  成功
  1  图构建失败，或新图信息量低于现有图而被守卫拒绝（错误信息输出到 stderr）`;

/** graph.json 的结构性计数指标（信息量守卫的唯一判据来源） */
interface GraphStructuralCounts {
  nodeCount: number;
  edgeCount: number;
  /** `relation === 'calls'` 的边数 —— 调用图这一层的独立计数 */
  callsEdgeCount: number;
}

/**
 * 从一张已在内存里的图统计守卫用的三个计数。
 *
 * F266 对抗审查 A6b：**一律现数，绝不信图自报的 `graph.nodeCount` / `graph.edgeCount`**。
 * 自报值与实际数组可以脱节（写入方 bug / 手工编辑 / 更新版本改口径），守卫拿自报值当基线
 * 等于把判据交给被判定对象自己填。反正 JSON 已全文 parse，现数是零额外成本的。
 */
function countGraphStructure(nodes: unknown[], links: unknown[]): GraphStructuralCounts {
  let callsEdgeCount = 0;
  for (const l of links) {
    if (l !== null && typeof l === 'object' && (l as { relation?: unknown }).relation === 'calls') {
      callsEdgeCount += 1;
    }
  }
  return { nodeCount: nodes.length, edgeCount: links.length, callsEdgeCount };
}

/**
 * 读取既有 graph.json 的结构性计数，作为覆写守卫的基线。
 *
 * F266 FR-003：守卫**不得把"没有基线"误判成"退化"**，因此以下情形一律返回 null（= 放行）：
 * 文件不存在 / 读取失败 / JSON 损坏 / `nodes`|`links` 不是数组。
 *
 * @param outputDir - 项目输出根目录（与 writeKnowledgeGraph 的 outputDir 同源）
 * @returns 旧图计数；无可用基线时返回 null
 */
function readExistingGraphCounts(outputDir: string): GraphStructuralCounts | null {
  try {
    // 路径必须与生产者 writeKnowledgeGraph 的 `{outputDir}/_meta/graph.json` 同源，
    // 否则守卫会读到一个根本不会被覆写的文件（既可能误拒也可能漏放）。
    const graphPath = path.join(outputDir, '_meta', 'graph.json');
    if (!fs.existsSync(graphPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as {
      nodes?: unknown;
      links?: unknown;
    };
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) {
      return null;
    }
    return countGraphStructure(parsed.nodes, parsed.links);
  } catch {
    return null;
  }
}

/**
 * 从磁盘缓存加载 ArchitectureIR
 * 读取 {outputDir}/_meta/architecture-ir.json，失败时返回 undefined
 * 采用方案 B：仅检查顶层字段存在性
 *
 * @param outputDir - 项目输出目录
 * @returns ArchitectureIR 对象或 undefined
 */
function loadArchitectureIR(outputDir: string): ArchitectureIR | undefined {
  try {
    const irPath = path.join(outputDir, '_meta', 'architecture-ir.json');
    if (!fs.existsSync(irPath)) {
      return undefined;
    }
    const content = fs.readFileSync(irPath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    // 方案 B：仅检查顶层 elements、relationships 字段存在性
    if (
      !Array.isArray(parsed['elements']) ||
      !Array.isArray(parsed['relationships'])
    ) {
      return undefined;
    }
    return parsed as unknown as ArchitectureIR;
  } catch {
    // 加载失败时 graceful skip
    return undefined;
  }
}

/**
 * 从磁盘上的 spec 文件提取 crossReferenceIndex 中的 CrossReferenceLink
 * 扫描 spec 文件中的 cross-reference-index 注释块，失败时返回空数组
 *
 * @param outputDir - 项目输出目录
 * @returns CrossReferenceLink 数组
 */
function collectCrossRefs(outputDir: string): CrossReferenceLink[] {
  try {
    const links: CrossReferenceLink[] = [];

    /** 递归扫描目录中的 .spec.md 文件 */
    function walkDir(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.spec.md')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // 从 spec 文件提取 crossReferenceIndex JSON 块
            const match = content.match(/<!-- cross-reference-index: auto\s+([\s\S]*?)-->/);
            if (match?.[1]) {
              const parsed = JSON.parse(match[1].trim()) as {
                sameModule?: CrossReferenceLink[];
                crossModule?: CrossReferenceLink[];
              };
              if (Array.isArray(parsed.sameModule)) {
                links.push(...parsed.sameModule);
              }
              if (Array.isArray(parsed.crossModule)) {
                links.push(...parsed.crossModule);
              }
            }
          } catch {
            // 单个文件解析失败时跳过
          }
        }
      }
    }

    walkDir(outputDir);
    return links;
  } catch {
    return [];
  }
}

/**
 * 执行 graph 子命令
 * 支持独立调用图构建，不依赖完整 batch 流程
 *
 * 数据加载策略（独立运行，不走完整 batch）：
 * 1. ArchitectureIR：读取 {outputDir}/_meta/architecture-ir.json（若存在）
 * 2. DocGraph：基于已存储 spec 文件构建轻量 DocGraph（动态导入 scanStoredModuleSpecs）
 * 3. CrossReferenceLinks：从已生成的 spec 文件中提取 crossReferenceIndex 段
 * 任一数据源加载失败 → graceful skip，不中断图构建
 *
 * @param command - 解析后的 CLI 命令对象
 */
export async function runGraphCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(GRAPH_HELP);
    return;
  }

  const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');

  // 加载 ArchitectureIR（从磁盘缓存读取）
  const architectureIR = loadArchitectureIR(outputDir);

  // 构建轻量 DocGraph（基于已存储 spec 文件，无需 ModuleGraph）
  // 通过 SpecStore 过滤，排除 orphan/bundle_copy/derived
  let docGraph: DocGraph | undefined;
  try {
    const { scanStoredModuleSpecs } = await import('../../panoramic/builders/doc-graph-builder.js');
    const projectRoot = path.dirname(outputDir);
    const stored = scanStoredModuleSpecs(outputDir, projectRoot);

    if (stored.length > 0) {
      // 构造轻量 SpecStore（独立运行，无本次生成 spec），通过 storedOnlySpecs() 获取过滤后列表
      const specStore = new SpecStore({
        currentSpecs: [],
        storedSpecs: stored,
        projectRoot,
        toProjectPath: (absPath: string) => {
          const rel = path.relative(projectRoot, absPath);
          return rel.startsWith('..') ? absPath : rel;
        },
      });
      // storedOnlySpecs() 按 sourceKind 过滤，orphanSpecs() 获取 orphan 集合
      const canonicalSpecs = specStore.storedOnlySpecs({ sourceKind: 'canonical' });
      const orphanPaths = new Set(specStore.orphanSpecs().map((s) => s.outputPath));
      // 排除 orphan（源文件不存在的 spec）
      const validSpecs = canonicalSpecs.filter((s) => !orphanPaths.has(s.outputPath));

      if (validSpecs.length > 0) {
        docGraph = {
          projectRoot,
          generatedAt: new Date().toISOString(),
          specs: validSpecs.map((s) => ({
            specPath: s.specPath,
            sourceTarget: s.sourceTarget,
            relatedFiles: s.relatedFiles,
            linked: s.linked,
            confidence: s.confidence,
            currentRun: false,
          })),
          sourceToSpec: [],
          references: [],
          missingSpecs: [],
          unlinkedSpecs: [],
        };
      }
    }
  } catch {
    // DocGraph 构建失败时 graceful skip
  }

  // 从已生成的 spec 文件提取 crossReferenceLinks
  const crossReferenceLinks = collectCrossRefs(outputDir);

  try {
    const graphJson = buildKnowledgeGraph({
      architectureIR,
      docGraph,
      crossReferenceLinks,
      directed: command.directed ?? false,
    });
    // F217 FR-009：本命令从缓存 architectureIR / 已生成 spec / crossRefs 三路合并产出，
    // 不解析源码，MUST 显式写 null（盖当前 HEAD 属于 provenance 伪造）。
    graphJson.graph.sourceCommit = null;
    // F249 FR-007：同一诚实降级理由——本命令没有跑任何采集管线，写入"当前采集器指纹"会
    // 谎称这张图由当前采集面产出。写 null 让 freshness 判定按 unrecorded 保守处理。
    graphJson.graph.fingerprint = null;

    // F266 FR-003：信息量守卫。本命令只合并磁盘缓存 + 已生成的 .spec.md，**不解析源码**，
    // 在没有 spec 产物的仓库里它会把一张由 batch/graph-only 建出的完整图静默覆写成贫图。
    // why 判据只用结构性计数：语义化质量评分属于 F217 六指标的职责，混进来只会造出第二套
    // 互相打架的判定。why 阈值是"严格不减"而非百分比容忍：任意容忍阈值本身就是新的造假面。
    //
    // F266 对抗审查 A6b：判据从两个标量扩到三个，第三个是 **calls 边数**。
    // 实证：架构 IR 在场时本命令会产出"节点/总边数都更多、但 calls 边归零"的图，
    // 两标量守卫全程放行 —— 调用图被静默洗掉，而调用图正是 impact / context 的承重面。
    // 本命令在结构上永远不产 calls 边（它不解析源码），所以这条判据不会误伤自身的正常路径。
    const previousCounts = readExistingGraphCounts(outputDir);
    const nextCounts = countGraphStructure(graphJson.nodes, graphJson.links);
    const degraded =
      previousCounts !== null &&
      (nextCounts.nodeCount < previousCounts.nodeCount ||
        nextCounts.edgeCount < previousCounts.edgeCount ||
        nextCounts.callsEdgeCount < previousCounts.callsEdgeCount);
    if (degraded && !command.force) {
      console.error(
        `[graph] 拒绝覆写：新图信息量低于现有图` +
          `（节点 ${previousCounts.nodeCount} → ${nextCounts.nodeCount}，` +
          `边 ${previousCounts.edgeCount} → ${nextCounts.edgeCount}，` +
          `calls 边 ${previousCounts.callsEdgeCount} → ${nextCounts.callsEdgeCount}）。\n` +
          `[graph] 'spectra graph' 只合并缓存与已生成的 spec，不解析源码；` +
          `要真正重建知识图谱请改用 'spectra batch --mode graph-only'（纯 AST / 零 LLM / 无需认证）。\n` +
          `[graph] 若这是有意的（主动重置 / --directed 表示形态切换 / 确认接受调用图丢失），加 --force。`,
      );
      process.exitCode = 1;
      return;
    }

    // F261：本命令的图内容由上面的 buildKnowledgeGraph 当场建出 ⇒ 由本进程的 dist 盖章。
    // （与 sourceCommit / fingerprint 写 null 不矛盾：那两维是**被分析对象**的属性，本命令没解析
    // 源码所以不能推导；builder 是**执行者自己**的属性，它确切知道自己是哪一版。）
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir, {
      builderProvenance: 'stamp-this-build',
    });
    console.log(`✓ graph.json 已写入: ${writtenPath}`);
  } catch (err) {
    console.error(
      `[graph] 图构建失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}
