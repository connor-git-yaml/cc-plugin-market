/**
 * panoramic 子命令 handler
 * 运行 panoramic 架构分析（cross-package / architecture-ir / overview）
 */

import type { CLICommand } from '../utils/parse-args.js';
import { queryPanoramic } from '../../panoramic/query.js';

const PANORAMIC_HELP = `spectra panoramic — panoramic 架构分析

用法:
  spectra panoramic <cross-package|architecture-ir|overview> [--json] [--project-root <dir>]

子操作:
  cross-package    分析 monorepo 子包间的依赖关系，检测循环依赖，输出拓扑排序
  architecture-ir  生成统一架构中间表示（Architecture IR），含元素、关系和视图
  overview         生成架构概览（系统上下文、部署视图、分层视图）

选项:
  --json           以 JSON 格式输出（默认输出人类可读格式）
  --project-root   指定分析目标目录（默认为当前工作目录）`;

export async function runPanoramicCommand(command: CLICommand): Promise<void> {
  if (command.help || !command.panoramicOperation) {
    console.log(PANORAMIC_HELP);
    return;
  }

  const operation = command.panoramicOperation;
  const projectRoot = command.projectRoot ?? process.cwd();

  const result = await queryPanoramic({ operation, projectRoot });

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  if (command.jsonOutput) {
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    // 人类可读格式：JSON 代码块
    console.log(`# Panoramic ${operation}\n`);
    console.log('```json');
    console.log(JSON.stringify(result.data, null, 2));
    console.log('```');
  }
}
