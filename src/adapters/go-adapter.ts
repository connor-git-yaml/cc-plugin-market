/**
 * Go 语言适配器
 *
 * 将 TreeSitterAnalyzer（AST 解析）和 tree-sitter-fallback（正则降级）
 * 中的 Go 支持聚合为一个内聚的适配器实例。
 *
 * 实现策略：委托（delegation）——调用现有函数，不复制代码。
 */
import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import { TreeSitterAnalyzer } from '../core/tree-sitter-analyzer.js';
import { analyzeFallback as treeSitterFallback } from '../core/tree-sitter-fallback.js';
import { extractCommentsWithTreeSitter } from './tree-sitter-comment-extractor.js';
import type { CommentRegion } from '../debt-scanner/types.js';
import { GO_ADAPTER_SURFACE } from '../collector-surface.js';

export class GoLanguageAdapter implements LanguageAdapter {
  readonly id = 'go';

  readonly languages: readonly Language[] = ['go'];

  /** F249 FR-002 #3：直接持有采集面事实源的引用（不复制字面量），失败模式退化为"导入断裂"。 */
  readonly extensions: ReadonlySet<string> = GO_ADAPTER_SURFACE.extensions;

  readonly defaultIgnoreDirs: ReadonlySet<string> = new Set([
    'vendor',
  ]);

  /**
   * AST 分析（委托 TreeSitterAnalyzer）
   */
  async analyzeFile(
    filePath: string,
    options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    const analyzer = TreeSitterAnalyzer.getInstance();
    return analyzer.analyze(filePath, 'go', {
      includePrivate: options?.includePrivate,
      // Feature 153 — 透传 extractCallSites flag（与 PythonLanguageAdapter 行为一致）
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
   * Go 语言术语映射
   */
  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'go',
      exportConcept: '导出标识符（首字母大写的函数/类型/变量/常量）',
      importConcept: 'import 导入（单行或分组）',
      typeSystemDescription: '静态类型系统 + interface 隐式实现',
      interfaceConcept: 'interface 接口（隐式实现，无需 implements 声明）',
      moduleSystem: 'Go Modules（go.mod + package/import）',
    };
  }

  /**
   * Go 测试文件匹配模式
   */
  getTestPatterns(): TestPatterns {
    return {
      filePattern: /^.*_test\.go$/,
      testDirs: [],
    };
  }

  /**
   * 基于 tree-sitter-go 的注释提取。Go grammar 的注释节点类型为 `comment`。
   */
  async extractComments(filePath: string): Promise<CommentRegion[]> {
    return extractCommentsWithTreeSitter(filePath, {
      grammarName: 'go',
      commentNodeTypes: new Set(['comment']),
    });
  }
}
