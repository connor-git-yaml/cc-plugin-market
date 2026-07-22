/**
 * diff 子命令
 * 检测 Spec 与源代码之间的漂移
 */

import { resolve } from 'node:path';
import { detectDrift } from '../../diff/drift-orchestrator.js';
import {
  validateTargetPath,
  resolveAuthGate,
  handleError,
  EXIT_CODES,
} from '../utils/error-handler.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * 执行 diff 子命令
 */
export async function runDiff(command: CLICommand, version: string): Promise<void> {
  const specFile = command.specFile!;
  const source = command.target!;

  console.log(`spectra v${version} — 漂移检测`);
  console.log(`Spec: ${specFile}`);
  console.log(`Source: ${source}`);

  if (!validateTargetPath(resolve(specFile))) {
    process.exitCode = EXIT_CODES.TARGET_ERROR;
    return;
  }

  if (!validateTargetPath(resolve(source))) {
    process.exitCode = EXIT_CODES.TARGET_ERROR;
    return;
  }

  // Feature 222：diff 只做入口检查——semantic-diff 的 LLM 失败路径静默 return null，
  // DriftReport 不保留"LLM 未跑"痕迹，技术上无法事后校验 --require-llm。
  // 降级形态也与 spec 生成不同：仍产出完整结构漂移报告，只是没有语义评估，故定制提示文案。
  if (
    !resolveAuthGate(
      command.requireLlm ?? false,
      '本次将跳过 LLM 语义评估，仅进行结构漂移检测（漂移报告仍完整产出）',
    )
  ) {
    process.exitCode = EXIT_CODES.API_ERROR;
    return;
  }

  try {
    const report = await detectDrift(resolve(specFile), resolve(source), {
      outputDir: command.outputDir,
    });

    const { summary } = report;
    console.log(`  结构差异: ${summary.totalChanges} 项 (HIGH: ${summary.high}, MEDIUM: ${summary.medium}, LOW: ${summary.low})`);
    console.log(`  噪声过滤: 移除 ${report.filteredNoise} 项`);

    if (summary.high > 0) {
      console.log(`⚠ 检测到 HIGH 级别漂移`);
    }
    console.log(`✓ ${report.outputPath} 已生成`);

    // 退出码：HIGH/MEDIUM → 1, 仅 LOW → 0
    process.exitCode = (summary.high > 0 || summary.medium > 0)
      ? EXIT_CODES.TARGET_ERROR
      : EXIT_CODES.SUCCESS;
  } catch (err) {
    process.exitCode = handleError(err);
  }
}
