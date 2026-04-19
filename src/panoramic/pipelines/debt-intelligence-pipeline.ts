/**
 * Debt Intelligence pipeline
 *
 * batch-orchestrator 调用入口。封装：
 * 1. scanProjectDebt（代码注释 + design-doc open questions）
 * 2. 写入 <specsDir>/project/technical-debt.md
 * 3. 若 quality-report.md 存在则追加 "## 技术债" 节
 * 4. 若 specs/README.md 存在则在 "质量审计" 节插入链接
 *
 * 任何单步失败都 try/catch；返回 result 且包含 diagnostics。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LanguageAdapterRegistry } from '../../adapters/language-adapter-registry.js';
import { scanProjectDebt } from '../../debt-scanner/index.js';
import { buildDebtReportFromReport } from '../../debt-scanner/aggregator/report-builder.js';
import { patchQualityReportWithDebt } from '../../debt-scanner/aggregator/quality-report-patcher.js';
import { indexDebtInReadme } from '../../debt-scanner/aggregator/readme-indexer.js';
import type { SimpleLLMClient } from '../../debt-scanner/design-docs/llm-topic-inferrer.js';
import type { TokenUsage } from '../../debt-scanner/types.js';

export interface DebtPipelineOptions {
  projectRoot: string;
  /** batch 输出目录（= specsDir，含 modules/project/_meta 子目录） */
  specsDir: string;
  registry: LanguageAdapterRegistry;
  llmClient?: SimpleLLMClient;
  budgetLimit?: number;
  dryRun?: boolean;
}

export interface DebtPipelineResult {
  generated: boolean;
  entriesCount: number;
  openQuestionsCount: number;
  tokenUsage: TokenUsage;
  durationMs: number;
  /** 相对 specsDir 的输出路径；未生成为 null */
  outputPath: string | null;
  qualityReportPatched: boolean;
  readmeIndexed: boolean;
  fallbackReason?: string;
  diagnostics: string[];
}

const EMPTY_RESULT: DebtPipelineResult = Object.freeze({
  generated: false,
  entriesCount: 0,
  openQuestionsCount: 0,
  tokenUsage: { input: 0, output: 0 },
  durationMs: 0,
  outputPath: null,
  qualityReportPatched: false,
  readmeIndexed: false,
  diagnostics: [],
});

export async function generateDebtIntelligence(
  options: DebtPipelineOptions,
): Promise<DebtPipelineResult> {
  const t0 = Date.now();
  const diagnostics: string[] = [];

  let report;
  try {
    report = await scanProjectDebt({
      projectRoot: options.projectRoot,
      registry: options.registry,
      llmClient: options.llmClient,
      budgetLimit: options.budgetLimit,
      dryRun: options.dryRun,
    });
  } catch (err) {
    diagnostics.push(`scanProjectDebt 失败：${(err as Error).message}`);
    return { ...EMPTY_RESULT, diagnostics, durationMs: Date.now() - t0 };
  }

  diagnostics.push(...report.diagnostics.messages);
  diagnostics.push(
    `扫描 ${report.diagnostics.filesScanned} 个源文件，跳过 ${report.diagnostics.filesSkipped} 个，` +
      `扫描 ${report.diagnostics.docsScanned} 个 design-doc，LLM 调用 ${report.diagnostics.llmCalls} 次`,
  );

  // 选择语言标签：从 registry 反推
  const extensions = [...options.registry.getSupportedExtensions()];
  const languages = Array.from(
    new Set(extensions.map(extToLang).filter((v): v is string => !!v)),
  );

  const markdown = buildDebtReportFromReport(report, languages);
  const projectDir = path.join(options.specsDir, 'project');
  const outputAbs = path.join(projectDir, 'technical-debt.md');

  try {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(outputAbs, markdown, 'utf-8');
  } catch (err) {
    diagnostics.push(`写入 technical-debt.md 失败：${(err as Error).message}`);
    return {
      ...EMPTY_RESULT,
      diagnostics,
      durationMs: Date.now() - t0,
      tokenUsage: report.tokenUsage,
      fallbackReason: report.fallbackReason,
    };
  }

  // 仅当存在内容才追加到 quality-report.md（AC-4.3）
  let qualityReportPatched = false;
  if (report.codeEntries.length > 0 || report.openQuestions.length > 0) {
    try {
      qualityReportPatched = patchQualityReportWithDebt({
        qualityReportPath: path.join(projectDir, 'quality-report.md'),
        metrics: report.metrics,
      });
    } catch (err) {
      diagnostics.push(`quality-report 追加失败：${(err as Error).message}`);
    }
  }

  let readmeIndexed = false;
  try {
    readmeIndexed = indexDebtInReadme(options.specsDir);
  } catch (err) {
    diagnostics.push(`specs/README.md 索引失败：${(err as Error).message}`);
  }

  return {
    generated: true,
    entriesCount: report.codeEntries.length,
    openQuestionsCount: report.openQuestions.length,
    tokenUsage: report.tokenUsage,
    durationMs: Date.now() - t0,
    outputPath: path.relative(options.specsDir, outputAbs).split(path.sep).join('/'),
    qualityReportPatched,
    readmeIndexed,
    fallbackReason: report.fallbackReason,
    diagnostics,
  };
}

/** 扩展名 → 语言标签（用于报告描述） */
function extToLang(ext: string): string | undefined {
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
      return 'typescript/javascript';
    case '.py':
    case '.pyi':
      return 'python';
    case '.go':
      return 'go';
    case '.java':
      return 'java';
    default:
      return undefined;
  }
}
