/**
 * F217 决策 1：Java/Go（及未来新语言）通用 CodeSkeleton 采集器。
 *
 * 与既有 collectPythonCodeSkeletons / collectTsJsCodeSkeletons 对称：各自直接实例化
 * 自己的分析器，不经过 LanguageAdapterRegistry（避免"直接调 buildAstGraphOnly 的测试
 * 没跑 bootstrapRuntime → registry 空 → 静默零文件"的隐藏前置，决策 1 现状确认已指出该风险）。
 *
 * 内部逻辑：
 * ① 遍历注入的 adapters 集合，用各自的 extensions 并集 + defaultIgnoreDirs 并集走自有 walk；
 * ② 复用共享 ignore oracle（ignore-oracle.ts，组合 createGitignoreFilter + 内置忽略目录集合）；
 * ③ 逐文件按扩展名匹配到对应 adapter，调用 adapter.analyzeFile(filePath, { extractCallSites: true }),
 *    单文件失败 catch 吞掉（与 Python/TS-JS 采集器 EC-14 兜底一致）。
 *
 * 范围裁剪（CONSTRAINT 级 out-of-scope）：不做 Java/Go 的 import resolution
 * （imports[].resolvedPath 恒为 null，deriveImportEdges 对 Java/Go 不产生 depends-on 边）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { LanguageAdapter } from '../adapters/language-adapter.js';
import { JavaLanguageAdapter } from '../adapters/java-adapter.js';
import { GoLanguageAdapter } from '../adapters/go-adapter.js';
import { createIgnoreOracle } from '../panoramic/graph/quality/ignore-oracle.js';

/** 大文件 size guard，与 Python/TS-JS 采集器对齐（EC-14：1MB 阈值）。 */
const MAX_FILE_BYTES = 1_000_000;

function collectExtensions(adapters: readonly LanguageAdapter[]): Set<string> {
  const extensions = new Set<string>();
  for (const adapter of adapters) {
    for (const ext of adapter.extensions) extensions.add(ext);
  }
  return extensions;
}

function collectDefaultIgnoreDirs(adapters: readonly LanguageAdapter[]): Set<string> {
  const dirs = new Set<string>();
  for (const adapter of adapters) {
    for (const dir of adapter.defaultIgnoreDirs) dirs.add(dir);
  }
  return dirs;
}

function resolveAdapterForFile(
  filePath: string,
  adapters: readonly LanguageAdapter[],
): LanguageAdapter | null {
  const ext = path.extname(filePath).toLowerCase();
  for (const adapter of adapters) {
    if (adapter.extensions.has(ext)) return adapter;
  }
  return null;
}

/**
 * 递归扫描目录，收集匹配 adapters 扩展名集合的文件（跳过忽略目录/被忽略路径）。
 */
function walkFiles(
  dir: string,
  baseDir: string,
  extensions: ReadonlySet<string>,
  adapterIgnoreDirs: ReadonlySet<string>,
  isIgnored: (relativePath: string) => boolean,
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (adapterIgnoreDirs.has(entry.name)) continue;
      if (isIgnored(relativePath)) continue;
      walkFiles(fullPath, baseDir, extensions, adapterIgnoreDirs, isIgnored, out);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.has(ext)) continue;
    if (isIgnored(relativePath)) continue;
    out.push(fullPath);
  }
}

/**
 * 采集 Java/Go（及未来经 adapters 参数注入的新语言）CodeSkeleton。
 *
 * @param projectRoot 项目根目录（绝对/相对均可，内部 normalize 为绝对路径）
 * @param adapters 语言适配器集合，默认 [JavaLanguageAdapter, GoLanguageAdapter]；
 *   测试可注入其他 adapter 实例做替身
 */
export async function collectGenericLanguageCodeSkeletons(
  projectRoot: string,
  adapters: readonly LanguageAdapter[] = [new JavaLanguageAdapter(), new GoLanguageAdapter()],
): Promise<Map<string, CodeSkeleton>> {
  const out = new Map<string, CodeSkeleton>();
  if (adapters.length === 0) return out;

  const resolvedProjectRoot = path.resolve(projectRoot);
  const extensions = collectExtensions(adapters);
  const adapterIgnoreDirs = collectDefaultIgnoreDirs(adapters);
  const isIgnored = createIgnoreOracle(resolvedProjectRoot);

  const filePaths: string[] = [];
  walkFiles(resolvedProjectRoot, resolvedProjectRoot, extensions, adapterIgnoreDirs, isIgnored, filePaths);

  for (const filePath of filePaths) {
    const adapter = resolveAdapterForFile(filePath, adapters);
    if (!adapter) continue;
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;

      const skeleton = await adapter.analyzeFile(filePath, { extractCallSites: true });
      out.set(filePath, skeleton);
    } catch {
      // 单文件失败不影响整体（与 collectPythonCodeSkeletons/collectTsJsCodeSkeletons EC-14 一致）
    }
  }

  return out;
}
