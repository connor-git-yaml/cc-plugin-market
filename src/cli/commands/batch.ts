/**
 * batch 子命令
 * 对当前项目执行批量 Spec 生成
 */

import { resolve } from 'node:path';
import { runBatch } from '../../batch/batch-orchestrator.js';
import { checkAuth, handleError, EXIT_CODES } from '../utils/error-handler.js';
import { loadProjectConfig, mergeConfig } from '../../config/project-config.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * 执行 batch 子命令
 */
export async function runBatchCommand(command: CLICommand, version: string): Promise<void> {
  console.log(`spectra v${version} — 批量生成`);

  if (!checkAuth()) {
    process.exitCode = EXIT_CODES.API_ERROR;
    return;
  }

  try {
    // 解析目标路径：优先使用 CLI 传入的 target，其次使用 cwd
    const projectRoot = resolve(command.target ?? process.cwd());

    // 加载项目级配置并与 CLI 参数合并
    const fileConfig = loadProjectConfig(projectRoot);
    const merged = mergeConfig(
      {
        force: command.force,
        incremental: command.incremental,
        languages: command.languages,
        outputDir: command.outputDir,
      },
      fileConfig,
      command._explicitFlags ?? new Set(),
    );

    const result = await runBatch(projectRoot, {
      force: merged.force,
      incremental: merged.incremental,
      languages: merged.languages,
      outputDir: merged.outputDir,
      concurrency: command.concurrency ?? 1,
      // Feature 107：多模态提取标志（不纳入配置文件合并，仅从 CLI 传入）
      includeDocs: command.includeDocs,
      includeImages: command.includeImages,
      // Feature 127：dry-run + 预算守护
      dryRun: command.dryRun,
      budget: command.batchBudget,
      onOverBudget: command.onOverBudget,
      // F5：批处理运行模式
      mode: command.batchMode,
      // F5 Story 3：graph.html 生成 flag
      generateHtml: command.generateHtml,
      // Feature 133（adversarial-review post-fix）：hyperedge LLM 提取（默认 false）
      hyperedgesEnabled: command.hyperedgesEnabled,
    });
    console.log(`  模块总数: ${result.totalModules} | 成功: ${result.successful.length} | 降级: ${result.degraded.length} | 失败: ${result.failed.length} | 跳过: ${result.skipped.length}`);

    if (result.indexGenerated) {
      console.log(`✓ specs/_index.spec.md 已生成`);
    }
    if (result.docGraphPath) {
      console.log(`✓ 文档图谱: ${result.docGraphPath}`);
    }
    if (result.graphHtmlPath) {
      console.log(`✓ 图谱可视化: ${result.graphHtmlPath}`);
    }
    if (result.coverageReportPath) {
      console.log(`✓ 覆盖率审计: ${result.coverageReportPath}`);
    }
    if (result.deltaReportPath) {
      console.log(`✓ 差量报告: ${result.deltaReportPath}`);
    }
    if (result.projectDocs && result.projectDocs.length > 0) {
      const preview = result.projectDocs.slice(0, 6).join(', ');
      const suffix = result.projectDocs.length > 6 ? ` ... 共 ${result.projectDocs.length} 个` : '';
      console.log(`✓ 项目级文档: ${preview}${suffix}`);
    }
    if (result.docsBundleManifestPath) {
      console.log(`✓ 文档 Bundle: ${result.docsBundleManifestPath}`);
    }
    if (result.docsBundleProfiles && result.docsBundleProfiles.length > 0) {
      const preview = result.docsBundleProfiles
        .map((profile) => `${profile.id}(${profile.documentCount})`)
        .join(', ');
      console.log(`✓ Bundle Profiles: ${preview}`);
    }
    if (result.summaryLogPath) {
      console.log(`✓ 日志: ${result.summaryLogPath}`);
    }
    // Feature 127：dry-run / 预算决策输出
    if (result.dryRunReportPath) {
      console.log(`✓ Dry-run 预估报告: ${result.dryRunReportPath}`);
    }
    if (result.budgetDecision) {
      console.log(`✓ 预算决策: ${result.budgetDecision.policy}（${result.budgetDecision.message}）`);
    }

    // Feature 127（Codex review 修复）：预算 cancel 必须返回非零 exit 让 CI 能识别。
    // 优先级：failed > budget-cancel > success。
    if (result.failed.length > 0) {
      process.exitCode = EXIT_CODES.TARGET_ERROR;
    } else if (result.budgetDecision?.policy === 'cancel') {
      process.exitCode = EXIT_CODES.BUDGET_EXCEEDED;
    } else {
      process.exitCode = EXIT_CODES.SUCCESS;
    }
  } catch (err) {
    process.exitCode = handleError(err);
  }
}
