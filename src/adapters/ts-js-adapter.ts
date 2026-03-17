/**
 * TypeScript / JavaScript 语言适配器
 *
 * 将当前分散在 ast-analyzer.ts、tree-sitter-fallback.ts、dependency-graph.ts
 * 中的 TS/JS 专用逻辑聚合为一个内聚的适配器实例。
 *
 * 实现策略：委托（delegation）——调用现有函数，不复制代码。
 */
import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type { DependencyGraph } from '../models/dependency-graph.js';
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  DependencyGraphOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import { analyzeFileInternal } from '../core/ast-analyzer.js';
import { analyzeFallback as treeSitterFallback } from '../core/tree-sitter-fallback.js';
import { buildGraph } from '../graph/dependency-graph.js';

export class TsJsLanguageAdapter implements LanguageAdapter {
  readonly id = 'ts-js';

  readonly languages: readonly Language[] = ['typescript', 'javascript'];

  readonly extensions: ReadonlySet<string> = new Set([
    '.ts', '.tsx', '.js', '.jsx',
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
   */
  async analyzeFile(
    filePath: string,
    options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    return analyzeFileInternal(filePath, options);
  }

  /**
   * 正则降级分析（委托 tree-sitter-fallback.ts 的 analyzeFallback）
   */
  async analyzeFallback(filePath: string): Promise<CodeSkeleton> {
    return treeSitterFallback(filePath);
  }

  /**
   * 依赖图构建（委托 dependency-graph.ts 的 buildGraph）
   * 进行 options 字段名映射：configPath → tsConfigPath
   */
  async buildDependencyGraph(
    projectRoot: string,
    options?: DependencyGraphOptions,
  ): Promise<DependencyGraph> {
    return buildGraph(projectRoot, {
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
}
