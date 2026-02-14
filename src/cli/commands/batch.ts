/**
 * batch 子命令
 * 对当前项目执行批量 Spec 生成
 */

import { runBatch } from '../../batch/batch-orchestrator.js';
import { checkAuth, handleError, EXIT_CODES } from '../utils/error-handler.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * 执行 batch 子命令
 */
export async function runBatchCommand(command: CLICommand, version: string): Promise<void> {
  console.log(`reverse-spec v${version} — 批量生成`);

  if (!checkAuth()) {
    process.exitCode = EXIT_CODES.API_ERROR;
    return;
  }

  try {
    const result = await runBatch(process.cwd(), {
      force: command.force,
      onProgress: (completed, total) => {
        // 简易进度输出
        const bar = '='.repeat(Math.floor((completed / total) * 20)).padEnd(20, ' ');
        process.stdout.write(`\r[${bar}] ${completed}/${total}`);
      },
    });

    // 换行（进度条之后）
    console.log();
    console.log(`  模块总数: ${result.totalModules} | 成功: ${result.successful.length} | 降级: ${result.degraded.length} | 失败: ${result.failed.length} | 跳过: ${result.skipped.length}`);

    if (result.indexGenerated) {
      console.log(`✓ specs/_index.spec.md 已生成`);
    }
    console.log(`✓ 日志: ${result.summaryLogPath}`);

    process.exitCode = result.failed.length > 0 ? EXIT_CODES.TARGET_ERROR : EXIT_CODES.SUCCESS;
  } catch (err) {
    process.exitCode = handleError(err);
  }
}
