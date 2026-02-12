/**
 * generate 子命令
 * 对指定文件或目录生成单模块 Spec
 */

import { resolve } from 'node:path';
import { generateSpec } from '../../core/single-spec-orchestrator.js';
import {
  validateTargetPath,
  checkApiKey,
  handleError,
  EXIT_CODES,
} from '../utils/error-handler.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * 执行 generate 子命令
 */
export async function runGenerate(command: CLICommand, version: string): Promise<void> {
  const target = command.target!;
  const targetPath = resolve(target);

  console.log(`reverse-spec v${version}`);
  console.log(`正在分析 ${target} ...`);

  if (!validateTargetPath(targetPath)) {
    process.exitCode = EXIT_CODES.TARGET_ERROR;
    return;
  }

  if (!checkApiKey()) {
    process.exitCode = EXIT_CODES.API_ERROR;
    return;
  }

  try {
    const result = await generateSpec(targetPath, {
      deep: command.deep,
      outputDir: command.outputDir,
      projectRoot: process.cwd(),
    });

    console.log(`✓ ${result.specPath} 已生成 (置信度: ${result.confidence})`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.warn(`⚠ ${w}`);
      }
    }
    process.exitCode = EXIT_CODES.SUCCESS;
  } catch (err) {
    process.exitCode = handleError(err);
  }
}
