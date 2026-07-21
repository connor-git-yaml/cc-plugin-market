/**
 * F220 G3（类型层）— batch-orchestrator 三个 type-only 导出的形状冻结
 *
 * 主 tsconfig 排除 tests/，vitest 不做类型检查 —— 若五段拆分后 facade 漏掉
 * `export type { GraphOnlyResult }`（当前无任何 src 消费者 import 该类型），
 * build/vitest 均不会红（Codex 设计审查 C1）。本文件经 `npm run typecheck:tests`
 * （专属 f220.tsconfig.json，与 src 同基线）强制可解析性。
 *
 * Codex G 层审查 C4 加固：`K extends keyof T` 只证 key 存在，字段改型
 * （nodeCount: number → string）不红。升级为双向 Equal 断言：
 * - GraphOnlyResult：keyof 全集 + 整体形状精确冻结（拆分期间该接口不许有任何变化）
 * - BatchOptions / BatchResult：keyof 全集冻结 + 代表性字段精确类型
 *   （运行时导出面已由 ts-morph 测试双向锁定；此处锁类型层形状）
 */

import type {
  BatchOptions,
  BatchResult,
  GraphOnlyResult,
} from '../../src/batch/batch-orchestrator.js';

// 双向类型相等断言（分布式条件类型技巧，业界通用 Equal 模式）
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

// ─── GraphOnlyResult：全字段精确冻结 ─────────────────────────────────────────
type _GraphOnlyKeys = Expect<
  Equal<
    keyof GraphOnlyResult,
    | 'graphPath'
    | 'nodeCount'
    | 'edgeCount'
    | 'callEdgeCount'
    | 'dependsOnEdgeCount'
    | 'pythonSymbolCount'
    | 'durationMs'
  >
>;
type _GraphOnlyShape = Expect<
  Equal<
    GraphOnlyResult,
    {
      graphPath: string;
      nodeCount: number;
      edgeCount: number;
      callEdgeCount: number;
      dependsOnEdgeCount: number;
      pythonSymbolCount: number;
      durationMs: number;
    }
  >
>;

// ─── BatchOptions：keyof 全集冻结 + 代表性字段类型 ───────────────────────────
type _BatchOptionsKeys = Expect<
  Equal<
    keyof BatchOptions,
    | 'force'
    | 'incremental'
    | 'full'
    | 'outputDir'
    | 'onProgress'
    | 'maxRetries'
    | 'concurrency'
    | 'checkpointPath'
    | 'grouping'
    | 'languages'
    | 'progressMode'
    | 'includeDocs'
    | 'includeImages'
    | 'dryRun'
    | 'budget'
    | 'onOverBudget'
    | 'enableDebtIntelligence'
    | 'debtLlmClient'
    | 'mode'
    | 'generateHtml'
    | 'hyperedgesEnabled'
    | 'enableAdr'
  >
>;
type _BatchOptionsIncremental = Expect<Equal<BatchOptions['incremental'], boolean | undefined>>;
type _BatchOptionsLanguages = Expect<Equal<BatchOptions['languages'], string[] | undefined>>;
type _BatchOptionsConcurrency = Expect<Equal<BatchOptions['concurrency'], number | undefined>>;

// ─── BatchResult：keyof 全集冻结 + 代表性字段类型 ────────────────────────────
type _BatchResultKeys = Expect<
  Equal<
    keyof BatchResult,
    | 'totalModules'
    | 'successful'
    | 'failed'
    | 'skipped'
    | 'degraded'
    | 'duration'
    | 'indexGenerated'
    | 'summaryLogPath'
    | 'detectedLanguages'
    | 'languageStats'
    | 'docGraphPath'
    | 'coverageReportPath'
    | 'deltaReportPath'
    | 'deltaReport'
    | 'projectDocs'
    | 'docsBundleManifestPath'
    | 'docsBundleProfiles'
    | 'costSummary'
    | 'dryRunReportPath'
    | 'budgetDecision'
    | 'debt'
    | 'graphHtmlPath'
  >
>;
type _BatchResultSuccessful = Expect<Equal<BatchResult['successful'], string[]>>;
type _BatchResultTotal = Expect<Equal<BatchResult['totalModules'], number>>;
type _BatchResultSummaryLog = Expect<Equal<BatchResult['summaryLogPath'], string>>;

// 消除 "declared but never used" 告警
export type {
  _GraphOnlyKeys,
  _GraphOnlyShape,
  _BatchOptionsKeys,
  _BatchOptionsIncremental,
  _BatchOptionsLanguages,
  _BatchOptionsConcurrency,
  _BatchResultKeys,
  _BatchResultSuccessful,
  _BatchResultTotal,
  _BatchResultSummaryLog,
};
