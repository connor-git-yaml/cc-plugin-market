/**
 * Java 语言适配器
 *
 * 将 TreeSitterAnalyzer（AST 解析）和 tree-sitter-fallback（正则降级）
 * 中的 Java 支持聚合为一个内聚的适配器实例。
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

export class JavaLanguageAdapter implements LanguageAdapter {
  readonly id = 'java';

  readonly languages: readonly Language[] = ['java'];

  readonly extensions: ReadonlySet<string> = new Set(['.java']);

  readonly defaultIgnoreDirs: ReadonlySet<string> = new Set([
    'target',   // Maven
    'build',    // Gradle
    'out',      // IntelliJ IDEA
    '.gradle',  // Gradle 缓存
    '.idea',    // IntelliJ 配置
    '.settings', // Eclipse 配置
    '.mvn',     // Maven Wrapper
  ]);

  /**
   * AST 分析（委托 TreeSitterAnalyzer）
   */
  async analyzeFile(
    filePath: string,
    options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    const analyzer = TreeSitterAnalyzer.getInstance();
    return analyzer.analyze(filePath, 'java', {
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
   * Java 语言术语映射
   */
  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'java',
      exportConcept: '公开成员（public 修饰的类/接口/枚举/方法/字段）',
      importConcept: 'import 导入（单类导入、通配导入、static 导入）',
      typeSystemDescription: '静态强类型系统 + 泛型 + 注解',
      interfaceConcept: 'interface 接口 + abstract class 抽象类 + default method 默认方法',
      moduleSystem: 'Java Modules (JPMS) + package/import',
    };
  }

  /**
   * Java 测试文件匹配模式
   */
  getTestPatterns(): TestPatterns {
    return {
      filePattern: /^(.*Test|Test.*|.*Tests|.*IT)\.java$/,
      testDirs: ['src/test/java'],
    };
  }
}
