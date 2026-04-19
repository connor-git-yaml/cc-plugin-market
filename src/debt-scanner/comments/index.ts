/**
 * 代码注释债务扫描主入口
 *
 * 遍历源文件 → 调用 adapter.extractComments → debt-classifier 分类 →
 * symbol-resolver 定位符号 → git-blame 获取作者与年龄 → 产生 CodeDebtEntry。
 */
import * as path from 'node:path';
import type { LanguageAdapter } from '../../adapters/language-adapter.js';
import type { LanguageAdapterRegistry } from '../../adapters/language-adapter-registry.js';
import type { CodeSkeleton } from '../../models/code-skeleton.js';
import { getLineBlame } from '../../utils/git-blame.js';
import type { CodeDebtEntry, CommentRegion } from '../types.js';
import { classifyCommentRegion, SEVERITY_ORDER } from './debt-classifier.js';
import { resolveEnclosingSymbol } from './symbol-resolver.js';

export interface ScanCodeCommentsOptions {
  /** 项目根，用于把绝对路径转为相对路径 */
  projectRoot: string;
  /** 将要扫描的源文件绝对路径列表 */
  files: string[];
  /** 语言适配器注册中心 */
  registry: LanguageAdapterRegistry;
  /** 可选：自定义 blame 实现，测试时可注入 */
  blame?: (filePath: string, line: number) => Promise<{ author: string; ageDays: number }>;
  /** 可选：日志回调 */
  logger?: { debug?: (msg: string) => void; warn?: (msg: string) => void };
}

export interface ScanCodeCommentsResult {
  entries: CodeDebtEntry[];
  filesScanned: number;
  filesSkipped: number;
  totalLoc: number;
  messages: string[];
}

/**
 * 扫描代码注释，产生 CodeDebtEntry 列表。
 */
export async function scanCodeComments(
  opts: ScanCodeCommentsOptions,
): Promise<ScanCodeCommentsResult> {
  const messages: string[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;
  let totalLoc = 0;
  const entries: CodeDebtEntry[] = [];

  const blameFn = opts.blame ?? (async (f, l) => {
    const info = await getLineBlame(f, l);
    return { author: info.author, ageDays: info.ageDays };
  });

  for (const file of opts.files) {
    const adapter = opts.registry.getAdapter(file);
    if (!adapter) {
      filesSkipped++;
      continue;
    }
    if (typeof adapter.extractComments !== 'function') {
      filesSkipped++;
      messages.push(`adapter ${adapter.id} 未实现 extractComments，跳过 ${path.relative(opts.projectRoot, file)}`);
      continue;
    }

    let regions: CommentRegion[];
    try {
      regions = await adapter.extractComments(file);
    } catch (err) {
      filesSkipped++;
      messages.push(`extractComments 失败 (${adapter.id}) ${path.relative(opts.projectRoot, file)}: ${(err as Error).message}`);
      continue;
    }

    filesScanned++;

    // 统计 LOC（尽量不重新 analyze 避免性能代价；用文件实际行数近似）
    try {
      const fs = await import('node:fs');
      const text = fs.readFileSync(file, 'utf-8');
      totalLoc += Math.max(1, text.split('\n').length);
    } catch {
      // 读文件失败忽略
    }

    // 解析符号需要 skeleton —— 懒加载：仅当该文件确实有 debt 时才跑 analyzeFile
    let skeleton: CodeSkeleton | null = null;
    let skeletonAttempted = false;

    for (const region of regions) {
      const classified = classifyCommentRegion(region);
      if (classified.length === 0) continue;

      if (!skeletonAttempted) {
        skeletonAttempted = true;
        try {
          skeleton = await adapter.analyzeFile(file);
        } catch {
          skeleton = null;
        }
      }

      for (const c of classified) {
        const line = region.startLine + c.lineOffset;
        const blame = await blameFn(file, line);
        const relPath = toPosix(path.relative(opts.projectRoot, file));
        entries.push({
          kind: c.kind,
          severity: c.severity,
          text: c.text,
          filePath: relPath,
          line,
          symbol: resolveEnclosingSymbol(skeleton, line),
          author: blame.author,
          ageDays: blame.ageDays,
        });
      }
    }
  }

  // NFR-2 稳定排序：severity asc, age desc, file, line
  entries.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
    if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
    return a.line - b.line;
  });

  return { entries, filesScanned, filesSkipped, totalLoc, messages };
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
