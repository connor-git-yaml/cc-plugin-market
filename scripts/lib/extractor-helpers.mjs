/**
 * Feature 150 Phase 4 阶段 A — extractor 共享 helpers
 *
 * 4 语言（python / ts / go / java）AST extractor 共享的 boilerplate：
 *   - tree-sitter wasm grammar 加载（封装 web-tree-sitter 的 init + Language.load）
 *   - 源码文件递归遍历（按扩展名 + 跳过通用 ignore 路径）
 *   - warnings 数组追加（统一 schema：{file, line?, code, message?}）
 *   - fixture 元数据头构造（baseline.repo / commit / scope / generatedAt / extractorVersion）
 *
 * 所有 extractor 文件 MUST 复用本 module，不重复实现 boilerplate（plan.md
 * Architecture "Phase 2 抽出共享 helpers" 节）。
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const require = createRequire(import.meta.url);

// ── 模块根定位 ──

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 从当前模块向上查找 package.json，定位仓库根。
 * 与 src/core/grammar-manager.ts 的 findProjectRoot 行为一致。
 */
function findProjectRoot() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 降级：scripts/lib/ 两层向上
  return path.resolve(__dirname, '..', '..');
}

const PROJECT_ROOT = findProjectRoot();
const GRAMMARS_DIR = path.join(PROJECT_ROOT, 'grammars');
const WEB_TREE_SITTER_DIR = path.join(
  PROJECT_ROOT,
  'node_modules',
  'web-tree-sitter',
);

// ── 类型常量 ──

/**
 * 受支持的 extractor language 标识。
 * 'python' 走旧的 python-call-extractor.py 不在本 helper 范围；
 * 本 helper 仅服务 ts / go / java 三个新增 extractor。
 */
export const SUPPORTED_LANGUAGES = Object.freeze(['ts', 'go', 'java']);

/**
 * language → grammar wasm 文件名映射。
 * 注：'ts' 用 tree-sitter-typescript.wasm（同时支持 .ts 与 .tsx）。
 */
const LANGUAGE_TO_GRAMMAR_FILE = Object.freeze({
  ts: 'tree-sitter-typescript.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
});

/**
 * 通用 ignore 路径前缀（递归遍历时跳过）。
 * 与 src/core 现有 walker 行为对齐：node_modules / .git / vendor / target / build / dist / out
 */
/**
 * 默认忽略目录列表。导出供调用方做 merge：
 *   `walkSourceFiles(root, exts, [...DEFAULT_IGNORE_DIRS, ...userExtraIgnore])`
 *
 * Codex Phase 4C Round 1 WARNING #3 修订：之前 ignoreDirs 直接覆盖默认值，导致
 * 调用方传 `['schema']` 时 `vendor/.git/node_modules` 不再被忽略。改为导出常量后，
 * extractor 内部显式 merge 防止意外覆盖。
 */
export const DEFAULT_IGNORE_DIRS = Object.freeze([
  'node_modules',
  '.git',
  'vendor',
  'target',
  'build',
  'dist',
  'out',
]);

// ── tree-sitter Parser 全局 init 去重 ──

/** 已加载 grammar 缓存（language → Parser.Language Promise） */
const grammarCache = new Map();

/**
 * 懒加载 web-tree-sitter Parser 类（CommonJS module，借 createRequire）。
 * 注：web-tree-sitter 0.24.x 主入口是 tree-sitter.js，CommonJS 风格 export default。
 */
function getParserClass() {
  // require 调用结果缓存在 Node module cache，重复调用无成本
  return require('web-tree-sitter');
}

/**
 * 缓存「init 完成后的 Parser 类」的 promise
 *
 * 注：web-tree-sitter 0.24.x 的 Parser.init() 是一次性 emscripten 初始化，
 *   完成后 Parser.Language 才挂上。但调用 Parser.init() 本身会 mutate 全局
 *   require 缓存（Module 单例），后续再调用 Parser.init() 可能不再可用。
 *   这里把「init 完成的 Parser 类」缓存起来，所有后续调用都走该 promise。
 */
let parserClassPromise = null;

async function ensureParserInit() {
  if (!parserClassPromise) {
    const Parser = getParserClass();
    parserClassPromise = (async () => {
      await Parser.init({
        locateFile(scriptName) {
          return path.join(WEB_TREE_SITTER_DIR, scriptName);
        },
      });
      return Parser;
    })();
    // 失败时清缓存便于重试
    parserClassPromise.catch(() => {
      parserClassPromise = null;
    });
  }
  return parserClassPromise;
}

/**
 * 加载指定语言的 tree-sitter grammar 并返回初始化好的 Parser 实例。
 *
 * @param {'ts' | 'go' | 'java'} language - extractor language 标识
 * @returns {Promise<{ parser: object, language: object }>} 已 setLanguage 的 Parser
 *   + 对应 Language 对象（便于后续用 Query API）
 *
 * @throws {Error} language 不在 SUPPORTED_LANGUAGES / wasm 文件缺失
 */
export async function loadTreeSitterGrammar(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new Error(
      `loadTreeSitterGrammar: 不支持的 language="${language}"，支持的：${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }

  // 取已 init 完成的 Parser 类
  const Parser = await ensureParserInit();

  // 复用已加载 grammar
  let langPromise = grammarCache.get(language);
  if (!langPromise) {
    const wasmFile = LANGUAGE_TO_GRAMMAR_FILE[language];
    const wasmPath = path.join(GRAMMARS_DIR, wasmFile);
    if (!fs.existsSync(wasmPath)) {
      throw new Error(
        `loadTreeSitterGrammar: grammar wasm 不存在 path="${wasmPath}"`,
      );
    }
    langPromise = Parser.Language.load(wasmPath);
    grammarCache.set(language, langPromise);
    // 失败时清缓存以便重试
    langPromise.catch(() => grammarCache.delete(language));
  }

  const lang = await langPromise;
  const parser = new Parser();
  parser.setLanguage(lang);
  return { parser, language: lang };
}

/**
 * 重置 helper 内部 grammar 缓存（仅供测试使用）。
 *
 * 注：web-tree-sitter 的 Parser.init() 是一次性 emscripten 全局初始化，
 *   不可以在测试间重复调用，因此 parserClassPromise 不在 reset 范围内。
 *   该 reset 只清 grammar 缓存，触发下次 grammar 重新 load。
 */
export function _resetHelpersForTests() {
  grammarCache.clear();
}

// ── 文件遍历 ──

/**
 * 递归遍历 root 目录，返回所有匹配 extensions 的文件绝对路径。
 *
 * @param {string} root - 起始目录绝对路径
 * @param {readonly string[]} extensions - 含点的扩展名数组（如 ['.ts', '.tsx']）
 * @param {readonly string[]} [ignoreDirs] - 跳过的目录名数组（匹配 basename）
 * @returns {string[]} 匹配文件的绝对路径数组（按文件系统遍历顺序，未排序）
 *
 * @throws {Error} root 不存在
 */
export function walkSourceFiles(root, extensions, ignoreDirs) {
  if (!root || typeof root !== 'string') {
    throw new Error('walkSourceFiles: root 必须为非空字符串');
  }
  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new Error('walkSourceFiles: extensions 必须为非空数组');
  }
  if (!fs.existsSync(root)) {
    throw new Error(`walkSourceFiles: root 不存在 path="${root}"`);
  }

  const ignoreSet = new Set(ignoreDirs ?? DEFAULT_IGNORE_DIRS);
  const extensionSet = new Set(extensions);
  const results = [];

  /** @param {string} dir */
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // 目录读取失败（权限等） → 跳过，不影响其它分支
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreSet.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensionSet.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(root);
  return results;
}

// ── warnings 数组 ──

/**
 * @typedef {object} ExtractorWarning
 * @property {string} file - 警告所属源码文件路径
 * @property {number} [line] - 行号（可选）
 * @property {'parse-error' | 'unresolved-reflection' | 'unresolved-dynamic' | string} code - 警告分类码
 * @property {string} [message] - 自由文本说明（可选）
 */

/**
 * 创建 typed warnings 数组（带 push helper）。
 *
 * 设计意图：4 个 extractor 都需要追加 warnings，统一构造避免对象 schema 漂移。
 *
 * @returns {{ items: ExtractorWarning[], append: (w: ExtractorWarning) => void }}
 */
export function createWarningsArray() {
  /** @type {ExtractorWarning[]} */
  const items = [];

  /** @param {ExtractorWarning} w */
  function append(w) {
    if (!w || typeof w !== 'object') {
      throw new Error('createWarningsArray.append: warning 必须为对象');
    }
    if (typeof w.file !== 'string' || w.file.length === 0) {
      throw new Error('createWarningsArray.append: warning.file 必须为非空字符串');
    }
    if (typeof w.code !== 'string' || w.code.length === 0) {
      throw new Error('createWarningsArray.append: warning.code 必须为非空字符串');
    }
    items.push({
      file: w.file,
      ...(typeof w.line === 'number' ? { line: w.line } : {}),
      code: w.code,
      ...(typeof w.message === 'string' ? { message: w.message } : {}),
    });
  }

  return { items, append };
}

// ── fixture 元数据头 ──

/**
 * @typedef {object} BaselineMetadataInput
 * @property {string} language - 'ts' | 'go' | 'java' | 'python'
 * @property {{ repo?: string, commit?: string, scope: string }} baseline
 *   - repo / commit 可选（self-dogfood 等 in-repo baseline 可省 repo）
 *   - scope 必填（如 'src/main' / 'gorm.io/gorm 顶层包'）
 * @property {string} [generatedAt] - ISO 8601 时间戳；缺省时取 new Date().toISOString()
 * @property {string} extractorVersion - extractor 自身版本（如 '1.0.0'）
 */

/**
 * 构造 fixture 元数据头（FR-014 / FR-017）。
 * 输出 schema 与 spec.md key entities "Truth Set" 段对齐。
 *
 * @param {BaselineMetadataInput} input
 * @returns {{ language: string, baseline: object }} 元数据头对象，调用方负责合并到 fixture 顶层
 */
export function buildMetadataHeader(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('buildMetadataHeader: input 必须为对象');
  }
  const { language, baseline, generatedAt, extractorVersion } = input;
  if (typeof language !== 'string' || language.length === 0) {
    throw new Error('buildMetadataHeader: language 必须为非空字符串');
  }
  if (!baseline || typeof baseline !== 'object') {
    throw new Error('buildMetadataHeader: baseline 必须为对象');
  }
  if (typeof baseline.scope !== 'string' || baseline.scope.length === 0) {
    throw new Error('buildMetadataHeader: baseline.scope 必须为非空字符串');
  }
  if (typeof extractorVersion !== 'string' || extractorVersion.length === 0) {
    throw new Error('buildMetadataHeader: extractorVersion 必须为非空字符串');
  }

  return {
    language,
    baseline: {
      ...(typeof baseline.repo === 'string' ? { repo: baseline.repo } : {}),
      ...(typeof baseline.commit === 'string' ? { commit: baseline.commit } : {}),
      scope: baseline.scope,
      generatedAt: typeof generatedAt === 'string' ? generatedAt : new Date().toISOString(),
      extractorVersion,
    },
  };
}
