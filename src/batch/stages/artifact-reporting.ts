/**
 * F220 Stage ⑤ — artifact writing / reporting（产物写盘与报告）
 *
 * F220 B7 seam：从 runBatch 提取步骤 6（batch-summary 摘要日志写盘）与
 * 步骤 7（人类友好 README.md 索引生成）。逻辑逐字搬迁；`reporter.finish()`
 * 留在 runBatch（reporter 为编排闭包状态），本模块只接收其结果。
 *
 * 行为合同由 G2 charter 冻结（README / latestSummary 清洗后全文快照 ——
 * Codex G 层审查 C2 专门为本 seam 加的内容守护）。
 *
 * @internal 内部实现模块：外部消费者请从 `batch/batch-orchestrator.js`（facade）导入
 * 公共 14 符号契约；对 stages/ 的深导入不属于稳定 API，随时可能重构。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../../panoramic/utils/logger.js';
import { writeSummaryLog, type BatchSummary } from '../progress-reporter.js';
import type { CostSummary } from '../cost-summary.js';
import type { FailedModule } from '../../models/module-spec.js';
import type { SpecStore } from '../../spec-store/index.js';
import type { DocsBundleProfileSummary } from '../../panoramic/models/docs-bundle-types.js';

const logger = createLogger('batch-orchestrator');

export async function writeBatchReportingArtifacts(args: {
  summary: BatchSummary;
  metaDir: string;
  costSummary: CostSummary;
  failedModules: FailedModule[];
  resolvedRoot: string;
  resolvedOutputDir: string;
  modulesDir: string;
  specStore: SpecStore;
  projectDocs: string[] | undefined;
  docsBundleProfiles: DocsBundleProfileSummary[] | undefined;
  spectraVersion: string;
}): Promise<{ summaryLogPathAbs: string }> {
  const {
    summary,
    metaDir,
    costSummary,
    failedModules,
    resolvedRoot,
    resolvedOutputDir,
    modulesDir,
    specStore,
    projectDocs,
    docsBundleProfiles,
    spectraVersion,
  } = args;

  // 步骤 6：写入摘要日志（输出到 _meta/ 子目录）
  fs.mkdirSync(metaDir, { recursive: true });
  const summaryLogPathAbs = path.join(metaDir, `batch-summary-${Date.now()}.md`);
  fs.mkdirSync(path.dirname(summaryLogPathAbs), { recursive: true });
  // Bug 142：传入 failedModules，让 batch-summary markdown 含 "## 失败详情" 节，
  // 用户能直接看到 reason（如 retry-budget-exceeded），不必翻 checkpoint。
  writeSummaryLog(summary, summaryLogPathAbs, costSummary, failedModules);

  // 步骤 7：生成人类友好的 README.md 索引
  try {
    const { generateBatchReadme } = await import('../batch-readme-generator.js');
    const readmeContent = generateBatchReadme({
      projectName: path.basename(resolvedRoot),
      version: spectraVersion,
      // 通过 SpecStore.allKnownSpecs() 获取：新生成 + 历史存储，已排除 orphan/bundle_copy/derived
      // 精确匹配 modulesDir 前缀（相对于 resolvedRoot），避免将 bundles/*/docs/modules/ 误计入
      moduleSpecs: (() => {
        const modulesDirRel = path.relative(resolvedRoot, modulesDir).split(path.sep).join('/') + '/';
        return specStore.allKnownSpecs()
          .filter(s => {
            const p = s.outputPath.replace(/\\/g, '/');
            return p.startsWith(modulesDirRel) && !path.basename(s.outputPath).startsWith('_');
          })
          .map(s => path.basename(s.outputPath, '.spec.md'));
      })(),
      projectDocs: projectDocs ?? [],
      bundles: docsBundleProfiles,
      outputDir: resolvedOutputDir,
    });
    fs.writeFileSync(path.join(resolvedOutputDir, 'README.md'), readmeContent, 'utf-8');
    logger.info('README.md 索引已生成');
  } catch (err) {
    logger.warn(`README.md 生成失败: ${String(err)}`);
  }

  return { summaryLogPathAbs };
}
