/**
 * TypeScript / JavaScript 语言适配器
 *
 * 将当前分散在 ast-analyzer.ts、tree-sitter-fallback.ts、module-derivation.ts
 * 中的 TS/JS 专用逻辑聚合为一个内聚的适配器实例。
 *
 * 实现策略：委托（delegation）——调用现有函数，不复制代码。
 *
 * Feature 152 T-013/T-014 — 双路径 callSites merge（方案 B）：
 * - extractCallSites=false（默认）→ 现有 ts-morph 单路径不变（FR-5.2 性能不回归）
 * - extractCallSites=true → ts-morph 主路径（exports/imports）+ tree-sitter callSites merge
 *   EC-11 隔离：tree-sitter 的 exports/imports 被丢弃，仅取 callSites 字段
 *   EC-1 降级：tree-sitter 调用失败时安全降级为空 callSites
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type { ModuleGraph } from '../knowledge-graph/module-derivation.js';
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  ModuleGraphOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import type { CommentRegion } from '../debt-scanner/types.js';
import { analyzeFileInternal } from '../core/ast-analyzer.js';
import { analyzeFallback as treeSitterFallback } from '../core/tree-sitter-fallback.js';
import { buildModuleGraphForProject } from '../knowledge-graph/module-derivation.js';
import { Project, ScriptTarget, ScriptKind } from 'ts-morph';
import { TreeSitterAnalyzer } from '../core/tree-sitter-analyzer.js';

export class TsJsLanguageAdapter implements LanguageAdapter {
  readonly id = 'ts-js';

  readonly languages: readonly Language[] = ['typescript', 'javascript'];

  // 扫描扩展名扩充 `.mjs/.cjs/.mts/.cts`：
  //   - `.mjs/.cjs`：Node.js ESM/CJS 模块文件
  //   - `.mts/.cts`：TypeScript ESM/CJS 显式扩展
  readonly extensions: ReadonlySet<string> = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  ]);

  readonly defaultIgnoreDirs: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'build',
    '.next',
    '.nuxt',
  ]);

  /**
   * AST 分析（委托 ast-analyzer.ts 的 analyzeFile）
   *
   * Feature 152 T-013/T-014 — 双路径 merge 逻辑：
   * - 默认路径（extractCallSites=false）：单路径 ts-morph，行为与原版完全一致
   * - callSites 路径（extractCallSites=true）：ts-morph 主路径 + tree-sitter callSites 覆盖
   *   EC-11：tree-sitter 仅贡献 callSites，不替换 exports/imports
   *   EC-1：tree-sitter 调用异常时降级为空 callSites，不抛异常
   */
  async analyzeFile(
    filePath: string,
    options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    // 默认路径：直接走 ts-morph 单路径（性能不回归）
    if (options?.extractCallSites !== true) {
      return analyzeFileInternal(filePath, options);
    }

    // 双路径 merge：ts-morph 主结果 + tree-sitter callSites
    const tsMorphResult = await analyzeFileInternal(filePath, options);

    // 检测 .tsx / .jsx 文件：根据扩展名决定 tree-sitter 使用的语言
    const ext = path.extname(filePath).toLowerCase();
    const tsLanguage: Language = ext === '.js' || ext === '.jsx' ? 'javascript' : 'typescript';

    let callSites = tsMorphResult.callSites ?? [];
    try {
      // 调用 tree-sitter 路径，仅取 callSites（EC-11：忽略 exports/imports）
      const tsResult = await TreeSitterAnalyzer.getInstance().analyze(
        filePath,
        tsLanguage,
        { extractCallSites: true },
      );
      // EC-11 隔离：只取 callSites，丢弃 tree-sitter 的 exports/imports
      callSites = tsResult.callSites ?? [];
      // Codex P2 W-1 修复：parse-error 路径同样降级为空 callSites
      // tree-sitter 在遇到 .tsx JSX dialect 等语法不识别时，可能返回 parseErrors 数组
      // 而不抛异常；这种情况下 callSites 可能不可靠，强制降级
      if (tsResult.parseErrors && tsResult.parseErrors.length > 0) {
        callSites = [];
      }
    } catch {
      // EC-1 降级：tree-sitter 调用失败（如 dialect 不可用、grammar 初始化失败）时
      // 安全降级为空 callSites，不阻塞主路径结果
      callSites = [];
    }

    return { ...tsMorphResult, callSites };
  }

  /**
   * 正则降级分析（委托 tree-sitter-fallback.ts 的 analyzeFallback）
   */
  async analyzeFallback(filePath: string): Promise<CodeSkeleton> {
    return treeSitterFallback(filePath);
  }

  /**
   * 模块图构建（W1.4：委托 module-derivation.ts 的 buildModuleGraphForProject，
   * 内部走 UnifiedGraph + deriveModuleGraph 派生路径，不再调用 dependency-cruiser）。
   *
   * options 字段名映射：configPath → tsConfigPath
   */
  async buildModuleGraph(
    projectRoot: string,
    options?: ModuleGraphOptions,
  ): Promise<ModuleGraph> {
    return buildModuleGraphForProject(projectRoot, {
      includeOnly: options?.includeOnly,
      excludePatterns: options?.excludePatterns,
      tsConfigPath: options?.configPath,
    });
  }

  /**
   * TS/JS 语言术语映射
   */
  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'typescript',
      exportConcept: 'export 导出的函数/类/类型',
      importConcept: 'import 导入',
      typeSystemDescription: '静态类型系统 + interface/type 别名',
      interfaceConcept: 'interface 接口',
      moduleSystem: 'ES Modules / CommonJS',
    };
  }

  /**
   * TS/JS 测试文件匹配模式
   */
  getTestPatterns(): TestPatterns {
    return {
      filePattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/,
      testDirs: ['__tests__', 'tests', 'test', '__mocks__'],
    };
  }

  /**
   * 使用 ts-morph 基于 AST 提取所有注释 region。
   * 字符串字面量里的 "TODO" 天然不会被 TypeScript 扫描器归为 comment trivia，
   * 因此该实现无需额外过滤即可满足 AC-1.2。
   */
  async extractComments(filePath: string): Promise<CommentRegion[]> {
    const content = fs.readFileSync(filePath, 'utf-8');
    // 独立 Project 实例，避免污染全局 ts-morph 缓存
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ScriptTarget.ESNext,
        allowJs: true,
        checkJs: false,
      },
    });

    const lower = filePath.toLowerCase();
    const scriptKind = lower.endsWith('.tsx')
      ? ScriptKind.TSX
      : lower.endsWith('.jsx')
      ? ScriptKind.JSX
      : lower.endsWith('.js')
      ? ScriptKind.JS
      : ScriptKind.TS;

    const sourceFile = project.createSourceFile('__extract__' + (scriptKind === ScriptKind.TSX || scriptKind === ScriptKind.TS ? '.ts' : '.js'), content, {
      scriptKind,
      overwrite: true,
    });

    const ts = sourceFile.getSourceFile().compilerNode;
    const fullText = ts.getFullText();
    const regions: CommentRegion[] = [];
    const seen = new Set<number>();

    // 基于 SourceFile AST 遍历，收集 leading 和 trailing comment ranges
    sourceFile.forEachDescendant((node) => {
      const leading = node.getLeadingCommentRanges();
      const trailing = node.getTrailingCommentRanges();
      for (const range of [...leading, ...trailing]) {
        const pos = range.getPos();
        if (seen.has(pos)) continue;
        seen.add(pos);
        const raw = fullText.slice(pos, range.getEnd());
        const isBlock = raw.startsWith('/*');
        regions.push({
          kind: isBlock ? 'block' : 'line',
          text: stripCommentMarkers(raw),
          startLine: offsetToLine(fullText, pos),
          endLine: offsetToLine(fullText, range.getEnd()),
        });
      }
    });

    // 稳定排序：按 startLine → kind
    regions.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    return regions;
  }
}

/**
 * 去除注释起始/结束标记（// 或 block 注释）以及每行前导的 * 装饰。
 * 保留内部换行，供 debt-classifier 逐行正则匹配。
 */
function stripCommentMarkers(raw: string): string {
  if (raw.startsWith('//')) {
    return raw.slice(2).replace(/^[ \t]/, '');
  }
  if (raw.startsWith('/*')) {
    let inner = raw.slice(2);
    if (inner.endsWith('*/')) inner = inner.slice(0, -2);
    return inner
      .split('\n')
      .map((line) => line.replace(/^\s*\*[ \t]?/, ''))
      .join('\n')
      .trim();
  }
  return raw;
}

/**
 * 从字符偏移量计算 1-indexed 行号
 */
function offsetToLine(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}
