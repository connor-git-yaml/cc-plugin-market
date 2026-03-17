/**
 * TreeSitterAnalyzer — 统一的多语言 tree-sitter 解析入口
 *
 * 编排 GrammarManager（grammar 加载）+ Parser（AST 解析）+
 * QueryMapper（结果映射）的完整流程。
 *
 * 职责：
 * 1. 根据语言获取 grammar → 创建 Parser → 解析源码为 AST
 * 2. 根据语言选择对应的 QueryMapper，将 AST 映射为 CodeSkeleton
 * 3. 处理边界情况（空文件、BOM、编码检测、语法错误）
 * 4. 管理 AST Tree 生命周期（try/finally 确保释放）
 */

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import Parser from 'web-tree-sitter';
import type { CodeSkeleton, Language, ParseError } from '../models/code-skeleton.js';
import { GrammarManager } from './grammar-manager.js';
import type { QueryMapper, MapperOptions } from './query-mappers/base-mapper.js';
import { PythonMapper } from './query-mappers/python-mapper.js';
import { GoMapper } from './query-mappers/go-mapper.js';
import { JavaMapper } from './query-mappers/java-mapper.js';
import { TypeScriptMapper } from './query-mappers/typescript-mapper.js';

// ════════════════════════ 类型 ════════════════════════

export interface TreeSitterAnalyzeOptions {
  /** 包含非导出/私有符号（默认 false） */
  includePrivate?: boolean;
}

// ════════════════════════ 扩展名到语言映射 ════════════════════════

const EXTENSION_LANGUAGE_MAP: Record<string, Language> = {
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
};

// TS 和 JS 共用 typescript grammar（tree-sitter-wasms 中 TS grammar 可解析 JS）
// 但为精确起见，JS 用 javascript grammar
const LANGUAGE_GRAMMAR_MAP: Record<string, string> = {
  python: 'python',
  go: 'go',
  java: 'java',
  typescript: 'typescript',
  javascript: 'javascript',
  // 未来扩展语言在此映射
};

// ════════════════════════ TreeSitterAnalyzer ════════════════════════

export class TreeSitterAnalyzer {
  // ── 单例 ──
  private static instance: TreeSitterAnalyzer | null = null;

  static getInstance(): TreeSitterAnalyzer {
    if (!TreeSitterAnalyzer.instance) {
      TreeSitterAnalyzer.instance = new TreeSitterAnalyzer();
    }
    return TreeSitterAnalyzer.instance;
  }

  static resetInstance(): void {
    TreeSitterAnalyzer.instance = null;
  }

  // ── 内部状态 ──

  /** 语言 → QueryMapper 注册表 */
  private mappers = new Map<string, QueryMapper>();

  /** Parser 实例缓存（按 grammar 语言，每种语言一个 Parser） */
  private parsers = new Map<string, Parser>();

  private disposed = false;

  private constructor() {
    // 注册内置 mapper
    this.registerMapper(new PythonMapper());
    this.registerMapper(new GoMapper());
    this.registerMapper(new JavaMapper());
    this.registerMapper(new TypeScriptMapper());
    // TS mapper 同时服务 JavaScript
    this.mappers.set('javascript', new TypeScriptMapper());
  }

  // ── 公开 API ──

  /**
   * 解析单个源文件，返回结构化的 CodeSkeleton
   *
   * @param filePath - 源文件绝对路径
   * @param language - 目标语言标识
   * @param options - 解析选项
   * @throws 文件不存在（I/O 错误）、语言不支持
   */
  async analyze(
    filePath: string,
    language: Language,
    options?: TreeSitterAnalyzeOptions,
  ): Promise<CodeSkeleton> {
    if (this.disposed) {
      throw new Error('TreeSitterAnalyzer 已被 dispose，请创建新实例');
    }

    // 读取文件
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error: any) {
      throw new Error(`无法读取文件: ${filePath} — ${error.message}`);
    }

    // 空文件处理
    if (content.length === 0) {
      return this.emptyCodeSkeleton(filePath, language);
    }

    // BOM 处理
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    // 获取 grammar 和 parser
    const grammarName = LANGUAGE_GRAMMAR_MAP[language];
    if (!grammarName) {
      throw new Error(`不支持的语言: "${language}"`);
    }

    const grammarManager = GrammarManager.getInstance();
    const grammar = await grammarManager.getGrammar(grammarName);

    // 获取或创建 Parser（每种 grammar 一个）
    let parser = this.parsers.get(grammarName);
    if (!parser) {
      parser = new Parser();
      parser.setLanguage(grammar);
      this.parsers.set(grammarName, parser);
    }

    // 解析 AST
    const tree = parser.parse(content);

    try {
      // 获取 mapper
      const mapper = this.mappers.get(language);
      if (!mapper) {
        throw new Error(`未找到语言 "${language}" 的 QueryMapper`);
      }

      const mapperOptions: MapperOptions = {
        includePrivate: options?.includePrivate,
      };

      // 提取结构
      const exports = mapper.extractExports(tree, content, mapperOptions);
      const imports = mapper.extractImports(tree, content);
      const parseErrors = mapper.extractParseErrors(tree);

      // 计算哈希
      const hash = createHash('sha256').update(content).digest('hex');
      const loc = content.split('\n').length;

      const skeleton: CodeSkeleton = {
        filePath,
        language,
        loc,
        exports,
        imports,
        parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
        hash,
        analyzedAt: new Date().toISOString(),
        parserUsed: 'tree-sitter',
      };

      return skeleton;
    } finally {
      // 释放 AST Tree（NFR-004: 防止内存泄漏）
      tree.delete();
    }
  }

  /**
   * 检查指定语言是否有可用的 grammar 和 mapper
   */
  isLanguageSupported(language: Language): boolean {
    const grammarName = LANGUAGE_GRAMMAR_MAP[language];
    if (!grammarName) return false;
    if (!this.mappers.has(language)) return false;
    return GrammarManager.getInstance().hasGrammar(grammarName);
  }

  /**
   * 返回所有支持的语言列表
   */
  getSupportedLanguages(): Language[] {
    const grammarManager = GrammarManager.getInstance();
    const supported: Language[] = [];
    for (const [lang, grammarName] of Object.entries(LANGUAGE_GRAMMAR_MAP)) {
      if (this.mappers.has(lang) && grammarManager.hasGrammar(grammarName)) {
        supported.push(lang as Language);
      }
    }
    return supported;
  }

  /**
   * 从文件路径推断语言
   */
  static getLanguageFromPath(filePath: string): Language | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_LANGUAGE_MAP[ext] ?? null;
  }

  /**
   * 释放所有 Parser 实例和缓存
   */
  async dispose(): Promise<void> {
    for (const parser of this.parsers.values()) {
      parser.delete();
    }
    this.parsers.clear();
    this.mappers.clear();
    this.disposed = true;
  }

  // ── 内部方法 ──

  /**
   * 注册语言 mapper
   */
  private registerMapper(mapper: QueryMapper): void {
    this.mappers.set(mapper.language, mapper);
  }

  /**
   * 生成空文件的 CodeSkeleton
   */
  private emptyCodeSkeleton(filePath: string, language: Language): CodeSkeleton {
    return {
      filePath,
      language,
      loc: 0,
      exports: [],
      imports: [],
      hash: createHash('sha256').update('').digest('hex'),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'tree-sitter',
    };
  }
}
