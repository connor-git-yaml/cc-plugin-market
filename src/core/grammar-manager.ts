/**
 * GrammarManager — web-tree-sitter grammar WASM 文件的按需加载与单例缓存管理器
 *
 * 职责：
 * 1. 全局唯一 Parser.init()，通过 locateFile 定位 tree-sitter.wasm
 * 2. 按语言名称按需加载 grammar WASM，并发请求去重
 * 3. 加载前进行 SHA256 校验（比对 grammars/manifest.json）
 * 4. 提供 dispose / resetInstance 等生命周期方法
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'web-tree-sitter';

// ────────────────────────── Manifest 类型 ──────────────────────────

/** 单条 grammar 条目 */
export interface GrammarManifestEntry {
  wasmFile: string;
  sha256: string;
}

/** grammars/manifest.json 的完整结构 */
export interface GrammarManifest {
  abiVersion: number;
  webTreeSitterVersion: string;
  grammars: Record<string, GrammarManifestEntry>;
}

// ─────────────────── 内部工具：定位项目根目录 ───────────────────

/**
 * 从当前模块位置向上查找 package.json，以此确定项目根目录。
 * 无论从 src/ (ts-node / vitest) 还是 dist/ (编译后) 执行均可正确定位。
 */
function findProjectRoot(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  let dir = currentDir;
  // 最多向上查找 10 层，防止无限循环
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // 到达文件系统根
    dir = parent;
  }
  // 降级：假设 src/core/ 或 dist/core/ 两层上即为项目根
  return resolve(currentDir, '..', '..');
}

// ──────────────────────── GrammarManager ────────────────────────

export class GrammarManager {
  // ── 单例 ──
  private static instance: GrammarManager | null = null;

  /** 获取全局唯一实例 */
  static getInstance(): GrammarManager {
    if (!GrammarManager.instance) {
      GrammarManager.instance = new GrammarManager();
    }
    return GrammarManager.instance;
  }

  /** 重置单例（仅供测试使用） */
  static resetInstance(): void {
    GrammarManager.instance = null;
  }

  // ── 内部状态 ──

  /** Parser.init() 全局去重 Promise */
  private initPromise: Promise<void> | null = null;

  /** grammar 按语言缓存（含并发去重） */
  private grammarCache = new Map<string, Promise<Parser.Language>>();

  /** manifest 缓存 */
  private manifest: GrammarManifest | null = null;

  /** 项目根目录 */
  private readonly projectRoot: string;

  /** grammars/ 目录绝对路径 */
  private readonly grammarsDir: string;

  /** web-tree-sitter 运行时 WASM 所在目录 */
  private readonly webTreeSitterDir: string;

  private constructor() {
    this.projectRoot = findProjectRoot();
    this.grammarsDir = join(this.projectRoot, 'grammars');
    // node_modules/web-tree-sitter/ 下存放 tree-sitter.wasm
    this.webTreeSitterDir = join(
      this.projectRoot,
      'node_modules',
      'web-tree-sitter',
    );
  }

  // ── 公开 API ──

  /**
   * 按语言名称获取 grammar（按需加载 + 并发去重 + SHA256 校验）
   *
   * @param language - 语言标识，如 'typescript', 'python'
   * @returns Parser.Language 实例
   * @throws 语言不在 manifest / WASM 文件缺失 / SHA256 校验失败
   */
  async getGrammar(language: string): Promise<Parser.Language> {
    // 确保 Parser 已初始化
    await this.ensureInit();

    // 加载 manifest（懒加载）
    const manifest = await this.loadManifest();
    const entry = manifest.grammars[language];
    if (!entry) {
      const supported = Object.keys(manifest.grammars).join(', ');
      throw new Error(
        `不支持的语言: "${language}"。支持的语言: ${supported}`,
      );
    }

    // 并发去重：同一语言的并发请求共享同一个 Promise
    const cached = this.grammarCache.get(language);
    if (cached) {
      return cached;
    }

    const loadPromise = this.loadAndVerifyGrammar(language, entry);
    this.grammarCache.set(language, loadPromise);

    // 如果加载失败，从缓存中移除，以便下次可以重试
    loadPromise.catch(() => {
      this.grammarCache.delete(language);
    });

    return loadPromise;
  }

  /**
   * 检查 manifest 中是否包含指定语言
   */
  hasGrammar(language: string): boolean {
    if (!this.manifest) {
      this.manifest = this.loadManifestSync();
    }
    return language in this.manifest.grammars;
  }

  /**
   * 返回所有受支持的语言列表
   */
  getSupportedLanguages(): string[] {
    if (!this.manifest) {
      this.manifest = this.loadManifestSync();
    }
    return Object.keys(this.manifest.grammars);
  }

  /**
   * 释放所有缓存的 grammar Promise
   */
  async dispose(): Promise<void> {
    this.grammarCache.clear();
    this.manifest = null;
    this.initPromise = null;
  }

  // ── 内部方法 ──

  /**
   * 确保 Parser.init() 只执行一次（全局去重）
   */
  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      const wasmDir = this.webTreeSitterDir;
      this.initPromise = Parser.init({
        locateFile(scriptName: string) {
          // web-tree-sitter 内部会请求 'tree-sitter.wasm'，
          // 通过 locateFile 将其指向正确的绝对路径
          return join(wasmDir, scriptName);
        },
      });
    }
    return this.initPromise;
  }

  /**
   * 异步加载 manifest（带缓存）
   */
  private async loadManifest(): Promise<GrammarManifest> {
    if (this.manifest) {
      return this.manifest;
    }
    const manifestPath = join(this.grammarsDir, 'manifest.json');
    const raw = await readFile(manifestPath, 'utf-8');
    this.manifest = JSON.parse(raw) as GrammarManifest;
    return this.manifest;
  }

  /**
   * 同步加载 manifest（用于 hasGrammar / getSupportedLanguages 等同步方法）
   * manifest.json 很小，同步读取不会有性能问题
   */
  private loadManifestSync(): GrammarManifest {
    const manifestPath = join(this.grammarsDir, 'manifest.json');
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as GrammarManifest;
  }

  /**
   * 加载 WASM 文件并进行 SHA256 校验，然后调用 Parser.Language.load()
   */
  private async loadAndVerifyGrammar(
    language: string,
    entry: GrammarManifestEntry,
  ): Promise<Parser.Language> {
    const wasmPath = join(this.grammarsDir, entry.wasmFile);

    // 检查文件是否存在
    if (!existsSync(wasmPath)) {
      throw new Error(
        `Grammar WASM 文件不存在: 语言="${language}", 预期路径="${wasmPath}"`,
      );
    }

    // 读取 WASM 文件并计算 SHA256
    const wasmBuffer = await readFile(wasmPath);
    const actualSha256 = createHash('sha256')
      .update(wasmBuffer)
      .digest('hex');

    if (actualSha256 !== entry.sha256) {
      throw new Error(
        `Grammar WASM SHA256 校验失败: 语言="${language}", ` +
          `预期="${entry.sha256}", 实际="${actualSha256}"`,
      );
    }

    // 加载 grammar
    return Parser.Language.load(wasmPath);
  }
}
