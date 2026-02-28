/**
 * prepare 子命令
 * 执行预处理 + 上下文组装（阶段 1-2），输出结构化 markdown 到 stdout。
 * 不调用 LLM，不需要 ANTHROPIC_API_KEY。
 * 供 Claude Code 原生模式消费。
 */

import { resolve, relative } from 'node:path';
import { prepareContext } from '../../core/single-spec-orchestrator.js';
import { ensureSpecifyTemplates } from '../../utils/specify-template-sync.js';
import {
  validateTargetPath,
  handleError,
  EXIT_CODES,
} from '../utils/error-handler.js';
import type { CLICommand } from '../utils/parse-args.js';
import type { CodeSkeleton } from '../../models/code-skeleton.js';
import type { AssembledContext } from '../../core/context-assembler.js';

/**
 * 执行 prepare 子命令
 * 进度信息输出到 stderr，结构化数据输出到 stdout
 */
export async function runPrepare(command: CLICommand, version: string): Promise<void> {
  const target = command.target!;
  const targetPath = resolve(target);

  // 首次运行自动补齐 .specify/templates（不阻塞主流程）
  try {
    ensureSpecifyTemplates(process.cwd());
  } catch {
    // 忽略模板同步失败，避免影响 prepare 主流程
  }

  // 进度信息 → stderr（不污染 stdout）
  console.error(`reverse-spec prepare v${version}`);
  console.error(`正在分析 ${target} ...`);

  if (!validateTargetPath(targetPath)) {
    process.exitCode = EXIT_CODES.TARGET_ERROR;
    return;
  }

  // 不检查 API key — prepare 不需要

  try {
    const result = await prepareContext(targetPath, {
      deep: command.deep,
      projectRoot: process.cwd(),
    });

    // 输出结构化 markdown 到 stdout
    const output = formatPrepareOutput(
      target,
      result.skeletons,
      result.mergedSkeleton,
      result.context,
      result.codeSnippets,
      result.filePaths,
    );
    console.log(output);

    console.error(`✓ 预处理完成 (${result.filePaths.length} 文件, ${result.mergedSkeleton.loc} LOC, ${result.context.tokenCount} tokens)`);
    process.exitCode = EXIT_CODES.SUCCESS;
  } catch (err) {
    process.exitCode = handleError(err);
  }
}

/**
 * 格式化 prepare 输出为结构化 markdown
 */
function formatPrepareOutput(
  target: string,
  skeletons: CodeSkeleton[],
  merged: CodeSkeleton,
  context: AssembledContext,
  codeSnippets: string[],
  filePaths: string[],
): string {
  const cwd = process.cwd();
  const parts: string[] = [];

  // YAML Frontmatter
  parts.push('---');
  parts.push('type: prepared-context');
  parts.push(`target: ${target}`);
  parts.push(`files: ${filePaths.length}`);
  parts.push(`loc: ${merged.loc}`);
  parts.push(`language: ${merged.language}`);
  parts.push(`parser: ${merged.parserUsed}`);
  parts.push(`token_count: ${context.tokenCount}`);
  parts.push(`truncated: ${context.truncated}`);
  if (context.truncatedParts.length > 0) {
    parts.push(`truncated_parts: [${context.truncatedParts.join(', ')}]`);
  }
  parts.push('---');
  parts.push('');

  // 文件清单
  parts.push('## 文件清单');
  parts.push('');
  for (const fp of filePaths) {
    const relPath = relative(cwd, fp);
    const skeleton = skeletons.find(s => s.filePath === fp);
    const loc = skeleton?.loc ?? 0;
    parts.push(`- \`${relPath}\` (${loc} LOC)`);
  }
  parts.push('');

  // 导出符号
  parts.push('## 导出符号');
  parts.push('');
  if (merged.exports.length > 0) {
    for (const exp of merged.exports) {
      parts.push(`### ${exp.kind}: \`${exp.name}\`${exp.isDefault ? ' (default)' : ''}`);
      if (exp.jsDoc) {
        parts.push(`> ${exp.jsDoc}`);
      }
      parts.push('```typescript');
      parts.push(exp.signature);
      parts.push('```');
      parts.push('');
    }
  } else {
    parts.push('无导出符号。');
    parts.push('');
  }

  // 导入依赖
  parts.push('## 导入依赖');
  parts.push('');
  if (merged.imports.length > 0) {
    for (const imp of merged.imports) {
      const typeTag = imp.isTypeOnly ? ' (type-only)' : '';
      const relTag = imp.isRelative ? '内部' : '外部';
      parts.push(`- \`${imp.moduleSpecifier}\`${typeTag}（${relTag}）`);
    }
  } else {
    parts.push('无导入依赖。');
  }
  parts.push('');

  // 解析错误
  if (merged.parseErrors && merged.parseErrors.length > 0) {
    parts.push('## 解析错误');
    parts.push('');
    for (const err of merged.parseErrors) {
      parts.push(`- ${err.message} (行 ${err.line}:${err.column})`);
    }
    parts.push('');
  }

  // Token 预算
  parts.push('## Token 预算');
  parts.push('');
  parts.push(`- 骨架: ${context.breakdown.skeleton}`);
  parts.push(`- 依赖 Spec: ${context.breakdown.dependencies}`);
  parts.push(`- 代码片段: ${context.breakdown.snippets}`);
  parts.push(`- 系统指令: ${context.breakdown.instructions}`);
  parts.push(`- **总计: ${context.tokenCount}**`);
  if (context.truncated) {
    parts.push(`- 已裁剪: ${context.truncatedParts.join(', ')}`);
  }
  parts.push('');

  // 代码片段（deep 模式）
  if (codeSnippets.length > 0) {
    parts.push('## 代码片段');
    parts.push('');
    for (let i = 0; i < codeSnippets.length; i++) {
      const relPath = i < filePaths.length ? relative(cwd, filePaths[i]!) : `片段 ${i + 1}`;
      parts.push(`### ${relPath}`);
      parts.push('```typescript');
      parts.push(codeSnippets[i]!);
      parts.push('```');
      parts.push('');
    }
  }

  return parts.join('\n');
}
