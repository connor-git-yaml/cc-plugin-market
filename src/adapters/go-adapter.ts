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

export class GoLanguageAdapter implements LanguageAdapter {
  readonly id = 'go';

  readonly languages: readonly Language[] = ['go'];

  readonly extensions: ReadonlySet<string> = new Set(['.go']);

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
}
