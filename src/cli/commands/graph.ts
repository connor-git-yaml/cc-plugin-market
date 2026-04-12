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

const GRAPH_HELP = `spectra graph — 构建并持久化知识图谱

用法:
  spectra graph [--directed] [--output-dir <dir>]

说明:
  读取当前项目的 architecture-ir、doc-graph、cross-reference-index，
  合并构建 NetworkX 兼容的 graph.json 并写入 _meta/ 目录。

选项:
  --directed          输出有向图（默认为无向图）
  --output-dir <dir>  指定输出根目录（默认：{cwd}/specs）
  --help              显示帮助信息

输出:
  {output-dir}/_meta/graph.json

退出码:
  0  成功
  1  图构建失败（错误信息输出到 stderr）`;

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

  // 构建轻量 DocGraph（基于已存储 spec 文件，无需 DependencyGraph）
  let docGraph: DocGraph | undefined;
  try {
    const { scanStoredModuleSpecs } = await import('../../panoramic/builders/doc-graph-builder.js');
    const projectRoot = path.dirname(outputDir);
    const stored = scanStoredModuleSpecs(outputDir, projectRoot);

    if (stored.length > 0) {
      docGraph = {
        projectRoot,
        generatedAt: new Date().toISOString(),
        specs: stored.map((s) => ({
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
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir);
    console.log(`✓ graph.json 已写入: ${writtenPath}`);
  } catch (err) {
    console.error(
      `[graph] 图构建失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}
