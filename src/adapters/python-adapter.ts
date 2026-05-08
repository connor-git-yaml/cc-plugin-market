/**
 * Python 语言适配器
 *
 * 将 TreeSitterAnalyzer（AST 解析）和 tree-sitter-fallback（正则降级）
 * 中的 Python 支持聚合为一个内聚的适配器实例。
 *
 * 实现策略：委托（delegation）——调用现有函数，不复制代码。
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type { ExtractionResult } from '../extraction/extraction-types.js';
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  DependencyGraphOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import type { DependencyGraph, DependencyEdge, GraphNode } from '../models/dependency-graph.js';
import { TreeSitterAnalyzer } from '../core/tree-sitter-analyzer.js';
import { analyzeFallback as treeSitterFallback } from '../core/tree-sitter-fallback.js';
import { extractCommentsWithTreeSitter } from './tree-sitter-comment-extractor.js';
import type { CommentRegion } from '../debt-scanner/types.js';

export class PythonLanguageAdapter implements LanguageAdapter {
  readonly id = 'python';

  readonly languages: readonly Language[] = ['python'];

  readonly extensions: ReadonlySet<string> = new Set(['.py', '.pyi']);

  readonly defaultIgnoreDirs: ReadonlySet<string> = new Set([
    '__pycache__',
    '.venv',
    'venv',
    '.tox',
    '.mypy_cache',
    '.pytest_cache',
    '.eggs',
  ]);

  /**
   * AST 分析（委托 TreeSitterAnalyzer）
   */
  async analyzeFile(
    filePath: string,
    options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    const analyzer = TreeSitterAnalyzer.getInstance();
    return analyzer.analyze(filePath, 'python', {
      includePrivate: options?.includePrivate,
      // Feature 151 — 透传 extractCallSites flag（CL-05 默认 false）
      extractCallSites: options?.extractCallSites,
    });
  }

  /**
   * 正则降级分析（委托 tree-sitter-fallback.ts 的 analyzeFallback）
   */
  async analyzeFallback(filePath: string): Promise<CodeSkeleton> {
    return treeSitterFallback(filePath);
  }

  /**
   * Python 语言术语映射
   */
  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'python',
      exportConcept: '公开符号（模块级定义，非 _ 前缀，受 __all__ 控制）',
      importConcept: 'import / from...import 导入',
      typeSystemDescription: '可选类型注解（PEP 484 type hints）',
      interfaceConcept: 'Protocol（PEP 544）/ ABC（Abstract Base Class）',
      moduleSystem: 'Python package/module 系统（__init__.py + import）',
    };
  }

  /**
   * Python 测试文件匹配模式
   */
  getTestPatterns(): TestPatterns {
    return {
      filePattern: /^(test_.*|.*_test|conftest)\.py$/,
      testDirs: ['tests', 'test', '__tests__'],
    };
  }

  /**
   * 基于 tree-sitter-python 的注释提取。
   *
   * Python AST 将 docstring 归类为 `string` 节点（位于 expression_statement 下），
   * 而非 `comment` 节点；因此 docstring 天然被排除，只有真正的 `#` 行注释被收集。
   */
  async extractComments(filePath: string): Promise<CommentRegion[]> {
    return extractCommentsWithTreeSitter(filePath, {
      grammarName: 'python',
      commentNodeTypes: new Set(['comment']),
    });
  }

  /**
   * 递归扫描项目根目录下所有 `.py` 文件，排除语言生态常见忽略目录。
   *
   * 复用 `defaultIgnoreDirs` 并叠加 Python 项目惯例（test/tests/dist 等）。
   * 由 `extractSymbolNodes` 与 `buildDependencyGraph` 共用，避免 DRY 违反。
   *
   * @throws 当根目录不可读时抛出（调用方按需 try-catch 决定是否吞掉）
   */
  private scanPyFiles(resolvedRoot: string): string[] {
    const ignoreNames = new Set([
      ...this.defaultIgnoreDirs,
      'test', 'tests', 'dist', 'node_modules', '.git',
    ]);
    const pyFiles: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!ignoreNames.has(entry.name) && !entry.name.startsWith('.')) {
            walk(path.join(dir, entry.name));
          }
        } else if (entry.isFile() && entry.name.endsWith('.py')) {
          pyFiles.push(path.join(dir, entry.name));
        }
      }
    }
    walk(resolvedRoot);
    return pyFiles;
  }

  /**
   * 提取 Python 项目所有 .py 文件的符号节点（函数/类），转换为 ExtractionResult 格式
   *
   * Feature 145 P0：桥接 Python AST（CodeSkeleton.exports）到知识图谱 ExtractionResult 第四路数据源。
   * 每个 .py 文件产出一个 ExtractionResult，包含：
   * - 文件级 module 节点（id = relPath, kind = 'module'）
   * - 每个 export 符号的 component 节点（id = {relPath}#{name}, kind = 'component'）
   * - module → component 的 containment 边（relation = 'contains'）
   *
   * NF-004：处理完每个文件后 skeleton 立即丢弃，不集中持有全量数据，避免内存压力。
   */
  async extractSymbolNodes(projectRoot: string): Promise<ExtractionResult[]> {
    const resolvedRoot = path.resolve(projectRoot);

    let pyFiles: string[];
    try {
      pyFiles = this.scanPyFiles(resolvedRoot);
    } catch {
      // 目录不可读时返回空结果，不抛出
      return [];
    }

    const results: ExtractionResult[] = [];

    for (const absPath of pyFiles) {
      const relPath = path.relative(resolvedRoot, absPath).split(path.sep).join('/');
      let skeleton: CodeSkeleton;
      try {
        skeleton = await this.analyzeFile(absPath);
      } catch {
        // 单文件解析失败不影响整体，仍产出文件级 module 节点；
        // metadata.parseError 标记用于调用方聚合统计（Codex 对抗审查 C001 修复）
        results.push({
          nodes: [
            {
              id: relPath,
              kind: 'module',
              label: path.basename(relPath, '.py'),
              source_file: relPath,
              confidence: 'EXTRACTED',
              metadata: { parseError: true },
            },
          ],
          edges: [],
        });
        continue;
      }

      const nodes: ExtractionResult['nodes'] = [];
      const edges: ExtractionResult['edges'] = [];

      // 文件级 module 节点
      nodes.push({
        id: relPath,
        kind: 'module',
        label: path.basename(relPath, '.py'),
        source_file: relPath,
        confidence: 'EXTRACTED',
      });

      // 每个导出符号（函数/类）产出 component 节点 + containment 边
      for (const symbol of skeleton.exports) {
        const symbolId = `${relPath}#${symbol.name}`;
        nodes.push({
          id: symbolId,
          kind: 'component',
          label: symbol.name,
          source_file: relPath,
          confidence: 'EXTRACTED',
          metadata: {
            symbolKind: symbol.kind,
            signature: symbol.signature ?? undefined,
          },
        });
        edges.push({
          source: relPath,
          target: symbolId,
          relation: 'contains',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });
      }

      results.push({ nodes, edges });
    }

    return results;
  }

  /**
   * 构建 Python 项目的模块依赖图
   * 扫描所有 .py 文件，解析 import 语句，仅对本地模块构建有向边
   */
  async buildDependencyGraph(
    projectRoot: string,
    _options?: DependencyGraphOptions,
  ): Promise<DependencyGraph> {
    const resolvedRoot = path.resolve(projectRoot);

    // 递归扫描所有 .py 文件，排除语言生态常见忽略目录
    const pyFiles = this.scanPyFiles(resolvedRoot);

    // 构建模块名 → 绝对路径映射（basename 不含扩展名）
    const pyModuleMap = new Map<string, string>();
    for (const f of pyFiles) {
      pyModuleMap.set(path.basename(f, '.py'), f);
    }

    const nodeSet = new Set<string>();
    const rawEdges: Array<{ from: string; to: string }> = [];

    for (const filePath of pyFiles) {
      try {
        const skeleton = await this.analyzeFile(filePath);
        const relFrom = path.relative(resolvedRoot, filePath);
        nodeSet.add(relFrom);

        for (const imp of skeleton.imports) {
          // 取模块路径的顶层包名（如 parser.submodule → parser）
          const topModule = imp.moduleSpecifier.replace(/^\.+/, '').split('.')[0];
          if (!topModule) continue;
          const resolvedPath = pyModuleMap.get(topModule);
          if (resolvedPath) {
            const relTo = path.relative(resolvedRoot, resolvedPath);
            nodeSet.add(relTo);
            rawEdges.push({ from: relFrom, to: relTo });
          }
        }
      } catch {
        // 单文件解析失败不影响整体依赖图构建
      }
    }

    const edges: DependencyEdge[] = rawEdges.map(e => ({
      from: e.from,
      to: e.to,
      isCircular: false,
      importType: 'static' as const,
    }));

    // O(n) 单次遍历计算度数（避免 O(n·m) 的 3 次数组遍历）
    const inDegreeMap = new Map<string, number>();
    const outDegreeMap = new Map<string, number>();
    const connectedNodes = new Set<string>();
    for (const e of rawEdges) {
      inDegreeMap.set(e.to, (inDegreeMap.get(e.to) ?? 0) + 1);
      outDegreeMap.set(e.from, (outDegreeMap.get(e.from) ?? 0) + 1);
      connectedNodes.add(e.from);
      connectedNodes.add(e.to);
    }

    const modules: GraphNode[] = [...nodeSet].map(source => ({
      source,
      isOrphan: !connectedNodes.has(source),
      inDegree: inDegreeMap.get(source) ?? 0,
      outDegree: outDegreeMap.get(source) ?? 0,
      level: 0,
    }));

    return {
      projectRoot: resolvedRoot,
      modules,
      edges,
      topologicalOrder: modules.map(m => m.source),
      sccs: [],
      totalModules: modules.length,
      totalEdges: edges.length,
      analyzedAt: new Date().toISOString(),
      mermaidSource: '',
    };
  }
}
