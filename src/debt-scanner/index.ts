/**
 * debt-scanner 模块主入口
 *
 * scanProjectDebt：整合代码注释扫描 + design-doc open-question 检测，
 * 产出统一的 DebtReport。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import type { Language } from '../models/code-skeleton.js';
import { scanCodeComments } from './comments/index.js';
import { detectOpenQuestions } from './design-docs/index.js';
import {
  inferOpenQuestionTopics,
  type SimpleLLMClient,
} from './design-docs/llm-topic-inferrer.js';
import type {
  CodeDebtEntry,
  DebtDiagnostics,
  DebtKind,
  DebtMetrics,
  DebtReport,
  OpenQuestionEntry,
} from './types.js';

export interface ScanProjectDebtOptions {
  projectRoot: string;
  registry: LanguageAdapterRegistry;
  /**
   * 可选：语言过滤（adapter id 集合，例如 ['python']）。
   * 传入时，只扫描这些 adapter 支持的扩展名。
   * 用于让 debt 扫描与 batch 的 --languages 过滤保持一致，避免发布不在本次 batch 范围内的债务。
   */
  languages?: string[];
  /** 可选：LLM 客户端；未提供则 open-question 主题推断降级 */
  llmClient?: SimpleLLMClient;
  /** 剩余 LLM budget（input+output token 总量） */
  budgetLimit?: number;
  /** dryRun 跳过 LLM */
  dryRun?: boolean;
  /** 可选：覆盖文件枚举（测试用） */
  files?: string[];
  /** 可选：注入 blame（测试用） */
  blame?: (filePath: string, line: number) => Promise<{ author: string; ageDays: number }>;
}

const EMPTY_KIND_COUNTS: Record<DebtKind, number> = {
  TODO: 0,
  FIXME: 0,
  HACK: 0,
  XXX: 0,
  NOTE: 0,
};

/**
 * 扫描 projectRoot，返回完整 DebtReport。
 */
export async function scanProjectDebt(opts: ScanProjectDebtOptions): Promise<DebtReport> {
  const t0 = Date.now();
  const projectRoot = path.resolve(opts.projectRoot);

  // ── 1. 枚举源文件（遵守 languages 过滤）──
  const files = opts.files ?? enumerateSourceFiles(projectRoot, opts.registry, opts.languages);

  // ── 2. 代码注释扫描 ──
  const codeRes = await scanCodeComments({
    projectRoot,
    files,
    registry: opts.registry,
    blame: opts.blame,
  });

  // ── 3. Design-doc open questions ──
  const dd = detectOpenQuestions(projectRoot);
  const llm = await inferOpenQuestionTopics({
    confirmed: dd.confirmed,
    llmCandidates: dd.llmCandidates,
    llmClient: opts.llmClient,
    budgetLimit: opts.budgetLimit,
    dryRun: opts.dryRun,
  });

  // ── 4. 汇总 ──
  const codeEntries: CodeDebtEntry[] = codeRes.entries;
  const openQuestions: OpenQuestionEntry[] = llm.entries;

  const metrics = buildMetrics(codeEntries, openQuestions, codeRes.totalLoc);
  const diagnostics: DebtDiagnostics = {
    filesScanned: codeRes.filesScanned,
    filesSkipped: codeRes.filesSkipped,
    totalLoc: codeRes.totalLoc,
    llmCalls: llm.llmCalls,
    docsScanned: dd.docsScanned,
    ruleCandidates: dd.confirmed.length,
    llmCandidates: dd.llmCandidates.length,
    messages: codeRes.messages,
  };

  return {
    codeEntries,
    openQuestions,
    diagnostics,
    metrics,
    tokenUsage: llm.tokenUsage,
    durationMs: Date.now() - t0,
    llmModel: llm.llmModel,
    fallbackReason: llm.fallbackReason,
  };
}

function buildMetrics(
  codeEntries: CodeDebtEntry[],
  openQuestions: OpenQuestionEntry[],
  totalLoc: number,
): DebtMetrics {
  const byKind: Record<DebtKind, number> = { ...EMPTY_KIND_COUNTS };
  let oldestAgeDays = 0;
  for (const e of codeEntries) {
    byKind[e.kind]++;
    if (e.ageDays > oldestAgeDays) oldestAgeDays = e.ageDays;
  }
  const densityPerKloc = totalLoc > 0 ? (codeEntries.length / totalLoc) * 1000 : 0;
  return {
    totalEntries: codeEntries.length,
    byKind,
    densityPerKloc,
    oldestAgeDays,
    openQuestionsCount: openQuestions.length,
  };
}

/**
 * 枚举项目中所有受支持的源文件，跳过 defaultIgnoreDirs 与常见构建目录。
 * 当 languageFilter 非空时，只接受这些 adapter id 支持的扩展名。
 */
function enumerateSourceFiles(
  projectRoot: string,
  registry: LanguageAdapterRegistry,
  languageFilter?: string[],
): string[] {
  const out: string[] = [];
  const ignoreDirs = new Set<string>(registry.getDefaultIgnoreDirs());
  // 通用忽略
  for (const d of ['.git', 'node_modules', 'dist', 'build', 'out']) ignoreDirs.add(d);
  const supportedExts = resolveAllowedExtensions(registry, languageFilter);

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (supportedExts.has(ext)) out.push(full);
    }
  }
  walk(projectRoot);
  // 稳定排序
  out.sort();
  return out;
}

/**
 * 根据 languageFilter 计算实际可接受的扩展名集合。
 * 过滤器为空/undefined 时返回全部受支持扩展名（向后兼容）。
 * 过滤器中 adapter id 不存在时会被静默忽略（行为与 batch language-grouper 一致）。
 */
function resolveAllowedExtensions(
  registry: LanguageAdapterRegistry,
  languageFilter: string[] | undefined,
): ReadonlySet<string> {
  if (!languageFilter || languageFilter.length === 0) {
    return registry.getSupportedExtensions();
  }
  const allowed = new Set<string>();
  const adapters = registry.getAllAdapters();
  const idSet = new Set(languageFilter);
  for (const a of adapters) {
    if (idSet.has(a.id)) {
      for (const ext of a.extensions) allowed.add(ext);
    }
  }
  return allowed;
}

/**
 * 根据 languageFilter 返回人类可读的语言标签（报告使用）。
 * 过滤器为空时覆盖全部已注册 adapter；否则仅列出过滤集合中的 adapter。
 */
export function describeScannedLanguages(
  registry: LanguageAdapterRegistry,
  languageFilter: string[] | undefined,
): string[] {
  const adapters = registry.getAllAdapters();
  const idSet = languageFilter && languageFilter.length > 0 ? new Set(languageFilter) : null;
  const labels = new Set<string>();
  for (const a of adapters) {
    if (idSet && !idSet.has(a.id)) continue;
    labels.add(adapterIdToLabel(a.id));
  }
  return Array.from(labels).sort();
}

function adapterIdToLabel(id: string): string {
  switch (id) {
    case 'ts-js':
      return 'typescript/javascript';
    case 'python':
      return 'python';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    default:
      return id;
  }
}

export type { DebtReport, CodeDebtEntry, OpenQuestionEntry };
export { buildDebtReportFromReport } from './aggregator/report-builder.js';
export { patchQualityReportWithDebt, findQualityReportPath, renderDebtSection } from './aggregator/quality-report-patcher.js';
export { indexDebtInReadme } from './aggregator/readme-indexer.js';
export type { SimpleLLMClient } from './design-docs/llm-topic-inferrer.js';

// 对未使用的导入给出一个显式 re-export，保持类型检查干净
export type { Language };
