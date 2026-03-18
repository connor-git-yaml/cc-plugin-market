/**
 * Python 语言适配器
 *
 * 将 TreeSitterAnalyzer（AST 解析）和 tree-sitter-fallback（正则降级）
 * 中的 Python 支持聚合为一个内聚的适配器实例。
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
}
