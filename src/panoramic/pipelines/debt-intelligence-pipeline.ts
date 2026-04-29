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
import { scanProjectDebt, describeScannedLanguages } from '../../debt-scanner/index.js';
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
  /**
   * 可选：语言过滤 adapter id 列表（例如 ['python']）。
   * 传入时让 debt 扫描只覆盖 batch 本次处理的语言子集，避免发布 out-of-scope 的债务。
   */
  languages?: string[];
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
      languages: options.languages,
      llmClient: options.llmClient,
      budgetLimit: options.budgetLimit,
      dryRun: options.dryRun,
    });
  } catch (err) {
    diagnostics.push(`scanProjectDebt 失败：${(err as Error).message}`);
    return { ...EMPTY_RESULT, diagnostics, durationMs: Date.now() - t0 };
  }

  diagnostics.push(...report.diagnostics.messages);
  // Feature 145 P2（T021）：诊断日志输出 docsScanned、openQuestions.length、ruleCandidates
  // 字段名与 DebtDiagnostics 定义保持一致；ruleCandidates 表示规则匹配阶段被识别为候选 open question 的数量。
  // 用于排查 P2 根因：docsScanned=0 说明 projectRoot 传值有问题；docsScanned>0 但 openQuestions 为空说明内容匹配问题
  diagnostics.push(
    `扫描 ${report.diagnostics.filesScanned} 个源文件，跳过 ${report.diagnostics.filesSkipped} 个，` +
      `扫描 ${report.diagnostics.docsScanned} 个 design-doc，` +
      `发现 ${report.openQuestions.length} 个 open question（ruleCandidates=${report.diagnostics.ruleCandidates}），` +
      `LLM 调用 ${report.diagnostics.llmCalls} 次`,
  );

  // 报告中的语言标签严格遵循 languages 过滤器，避免列出未扫描的语言
  const languages = describeScannedLanguages(options.registry, options.languages);

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

  // 说明：batch 路径上 specs/README.md 由 batch-readme-generator 在 debt pipeline 之后重写，
  // 所以这里的 indexDebtInReadme 即便成功也会被 batch 覆写。为了避免"看起来生效实际没用"的假阳性，
  // 在批处理上下文中直接 skip：README 入口由 batch-readme-generator 统一拥有（它会检测
  // project/technical-debt.md 是否存在并生成链接）。
  //
  // indexDebtInReadme 仍保留在 aggregator 中供独立调用 scanProjectDebt 的 caller 使用。
  const readmeIndexed = false;
  void indexDebtInReadme; // 显式保留 import（向外暴露）

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

