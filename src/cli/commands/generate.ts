/**
 * generate 子命令
 * 对指定文件或目录生成单模块 Spec
 */

import { resolve } from 'node:path';
import { generateSpec } from '../../core/single-spec-orchestrator.js';
import { ensureSpecifyTemplates } from '../../utils/specify-template-sync.js';
import {
  validateTargetPath,
  resolveAuthGate,
  handleError,
  printError,
  EXIT_CODES,
} from '../utils/error-handler.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * 执行 generate 子命令
 */
export async function runGenerate(command: CLICommand, version: string): Promise<void> {
  const target = command.target!;
  const targetPath = resolve(target);

  // 首次运行自动补齐 .specify/templates（不阻塞主流程）
  try {
    ensureSpecifyTemplates(process.cwd());
  } catch {
    // 忽略模板同步失败，避免影响 generate 主流程
  }

  console.log(`spectra v${version}`);
  console.log(`正在分析 ${target} ...`);

  if (!validateTargetPath(targetPath)) {
    process.exitCode = EXIT_CODES.TARGET_ERROR;
    return;
  }

  if (!resolveAuthGate(command.requireLlm ?? false)) {
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

    // Feature 222：入口门控只能拦"整机零认证"，运行期 LLM 失败（OAuth 过期 / 重试耗尽）
    // 同样会落入 AST-only 降级，因此 --require-llm 必须在拿到产物后再校验一次。
    if (command.requireLlm && result.llmDegraded) {
      printError(
        '--require-llm 已指定，但本次产物为 AST-only 降级结果（LLM 未成功产出）。\n' +
          `  注意：降级产物已写入 ${result.specPath}（校验发生在写盘之后），` +
          '若它覆盖了此前更高质量的 Spec，请从 git 恢复旧版本。',
      );
      process.exitCode = EXIT_CODES.API_ERROR;
      return;
    }
    process.exitCode = EXIT_CODES.SUCCESS;
  } catch (err) {
    process.exitCode = handleError(err);
  }
}
