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
import type { CodeSkeleton, ImportReference, Language } from '../models/code-skeleton.js';
import type { ExtractionResult } from '../extraction/extraction-types.js';
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  ModuleGraphOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import type { ModuleGraph } from '../knowledge-graph/module-derivation.js';
import { TreeSitterAnalyzer } from '../core/tree-sitter-analyzer.js';
import { analyzeFallback as treeSitterFallback } from '../core/tree-sitter-fallback.js';
import { extractCommentsWithTreeSitter } from './tree-sitter-comment-extractor.js';
import type { CommentRegion } from '../debt-scanner/types.js';
import { buildModuleGraphFromCodeSkeletons } from '../knowledge-graph/module-derivation.js';

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
   * 由 `extractSymbolNodes` 与 `buildModuleGraph` 共用，避免 DRY 违反。
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
   * 构建 Python 项目的模块图（Feature 156 W1.4：UnifiedGraph 派生路径）
   *
   * 流程：
   * 1. 递归扫描所有 .py 文件，排除语言生态忽略目录
   * 2. 解析 Python import → 相对路径（包含 dot-relative + namedImports 展开）
   * 3. 把推断到的 resolvedPath 写回 CodeSkeleton.imports[i]
   * 4. buildModuleGraphFromCodeSkeletons 一站式派生
   *
   * Python import 解析规则：
   * - 绝对模块（`import foo` / `from foo import x`）：用 basename map（EC-6 简化策略）
   * - 单点相对（`from . import utils` / `from . import a, b`）：
   *   * 当 moduleSpecifier === '.'：把每个 namedImport 名字 N 当作候选模块，
   *     在当前包目录尝试解析 ./N.py 或 ./N/__init__.py
   *   * 多个 named import 都命中时，取第一个命中的（resolvedPath 是单值字段）；
   * - 双点相对（`from .. import x`）：同理，往上一级查
   * - 带模块名相对（`from .nn import Module`）：解析 `.nn` 子模块
   */
  async buildModuleGraph(
    projectRoot: string,
    _options?: ModuleGraphOptions,
  ): Promise<ModuleGraph> {
    const resolvedRoot = path.resolve(projectRoot);

    // 递归扫描所有 .py 文件
    const pyFiles = this.scanPyFiles(resolvedRoot);

    // 构建模块名 → 相对路径映射（绝对 import 用）
    const pyModuleMap = new Map<string, string>();
    const relPyFiles: string[] = [];
    const relPySet = new Set<string>();
    for (const absF of pyFiles) {
      const rel = path.relative(resolvedRoot, absF).split(path.sep).join('/');
      relPyFiles.push(rel);
      relPySet.add(rel);
      pyModuleMap.set(path.basename(absF, '.py'), rel);
    }

    // 收集 CodeSkeleton（含推断的 resolvedPath），喂给 buildGraphFromCodeSkeletons
    const codeSkeletons = new Map<string, CodeSkeleton>();
    for (const absPath of pyFiles) {
      const relFrom = path.relative(resolvedRoot, absPath).split(path.sep).join('/');
      try {
        const skeleton = await this.analyzeFile(absPath);
        const newImports: ImportReference[] = skeleton.imports.flatMap((imp) =>
          this.resolvePythonImport(imp, relFrom, relPySet, pyModuleMap),
        );
        codeSkeletons.set(relFrom, {
          ...skeleton,
          filePath: relFrom,
          imports: newImports,
        });
      } catch {
        // WARN-2 修订：解析失败时不注入空 skeleton（loc:1 占位会污染 module 节点 + 跨语言统计）。
        // 改为在 metadata 标 parseError，buildGraphFromCodeSkeletons 之前过滤掉。
        // 仍保留 module 节点的最小占位（让 graph 可见该文件存在），但 imports/exports 必为空。
        codeSkeletons.set(relFrom, {
          filePath: relFrom,
          language: 'python',
          loc: 0,
          exports: [],
          imports: [],
          hash: '0'.repeat(64),
          analyzedAt: new Date().toISOString(),
          parserUsed: 'tree-sitter',
          metadata: { parseError: true },
        } as CodeSkeleton & { metadata: { parseError: boolean } });
      }
    }

    // 兜底：scan 到的文件但 codeSkeletons 漏掉的（不应该发生），补一个空骨架
    for (const rel of relPyFiles) {
      if (!codeSkeletons.has(rel)) {
        codeSkeletons.set(rel, {
          filePath: rel,
          language: 'python',
          loc: 1,
          exports: [],
          imports: [],
          hash: '0'.repeat(64),
          analyzedAt: new Date().toISOString(),
          parserUsed: 'tree-sitter',
        });
      }
    }

    // WARN-2：过滤掉 parseError 的 skeleton 不让它进 buildUnifiedGraph 派生 module 节点
    // —— 但保留一条诊断日志会更好；当前为 silent 跳过（与现有 stderr noise budget 一致）。
    const cleanSkeletons = new Map<string, CodeSkeleton>();
    for (const [k, sk] of codeSkeletons) {
      const md = (sk as CodeSkeleton & { metadata?: { parseError?: boolean } }).metadata;
      if (md?.parseError) continue;
      cleanSkeletons.set(k, sk);
    }

    return buildModuleGraphFromCodeSkeletons(cleanSkeletons, resolvedRoot, 'python');
  }

  /**
   * 解析单条 Python ImportReference 为 0..N 条带 resolvedPath 的 ImportReference。
   *
   * CRIT-4 v2：处理 dot-relative + namedImports 展开。当 specifier 为纯点号（'.'/'..'）时，
   * 把 namedImports 每个名字 N 展开为候选 specifier `.N` / `..N`，用相对路径解析每个候选；
   * 任一命中即派生一条 edge（resolvedPath 写回）。
   *
   * 返回 ImportReference 数组：
   *  - 命中 0 个候选：返回原 imp（不带 resolvedPath，下游 deriveImportEdges 跳过）
   *  - 命中 1 个：返回单元素数组（imp + resolvedPath）
   *  - 命中 N 个（仅 dot-relative + multi-named 才会发生）：返回 N 元素数组，
   *    每个元素是同一 imp 的副本但 resolvedPath 各异 + namedImports 收窄到对应名字
   */
  private resolvePythonImport(
    imp: ImportReference,
    fromRel: string,
    relPySet: Set<string>,
    pyModuleMap: Map<string, string>,
  ): ImportReference[] {
    const spec = imp.moduleSpecifier;
    const fromDir = path.dirname(fromRel);

    // 工具函数：从一个目录起始，解析 "moduleSegment[/subSegment...]" 为实际 .py 文件
    // 返回相对项目根的路径，未命中返回 null
    const tryResolveAtDir = (baseDir: string, segments: string[]): string | null => {
      const joinedSegs = segments.join('/');
      const candidates = [
        `${baseDir}/${joinedSegs}.py`,
        `${baseDir}/${joinedSegs}/__init__.py`,
      ];
      for (const c of candidates) {
        // path.normalize 处理 './a/../b' 这类
        const norm = path.posix.normalize(c.startsWith('/') ? c : `./${c}`).replace(/^\.\//, '');
        if (relPySet.has(norm)) return norm;
      }
      return null;
    };

    // Case A: 纯点号 specifier（'.', '..'）—— 必须靠 namedImports 展开
    if (/^\.+$/.test(spec)) {
      const dots = spec.length;
      // dots=1: 当前包；dots=2: 父包；以此类推
      let baseDir = fromDir;
      for (let i = 1; i < dots; i++) {
        baseDir = path.dirname(baseDir) === '.' ? '' : path.dirname(baseDir);
      }
      // 如果没有 namedImports，无法展开 → 保留原 imp
      const named = imp.namedImports ?? [];
      if (named.length === 0) return [imp];

      const out: ImportReference[] = [];
      for (const name of named) {
        const resolved = tryResolveAtDir(baseDir || '.', [name]);
        if (resolved && resolved !== fromRel) {
          out.push({ ...imp, resolvedPath: resolved, namedImports: [name] });
        }
      }
      return out.length > 0 ? out : [imp];
    }

    // Case B: dot-relative + 模块名（'.foo' / '..foo.bar'）
    const dotRelMatch = /^(\.+)(.*)$/.exec(spec);
    if (dotRelMatch && dotRelMatch[1]!.length >= 1 && dotRelMatch[2]!.length > 0) {
      const dots = dotRelMatch[1]!.length;
      const tail = dotRelMatch[2]!;
      let baseDir = fromDir;
      for (let i = 1; i < dots; i++) {
        baseDir = path.dirname(baseDir) === '.' ? '' : path.dirname(baseDir);
      }
      const segs = tail.split('.');
      const resolved = tryResolveAtDir(baseDir || '.', segs);
      if (resolved && resolved !== fromRel) {
        return [{ ...imp, resolvedPath: resolved }];
      }
      return [imp];
    }

    // Case C: 绝对 import — 用 basename map（保留原简化策略，EC-6 留给后续 Feature）
    const topModule = spec.split('.')[0];
    if (!topModule) return [imp];
    const resolvedRel = pyModuleMap.get(topModule);
    if (resolvedRel && resolvedRel !== fromRel) {
      return [{ ...imp, resolvedPath: resolvedRel }];
    }
    return [imp];
  }
}
