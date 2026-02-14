#!/usr/bin/env node
/**
 * reverse-spec CLI 入口点
 * 全局命令调度器
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './utils/parse-args.js';
import { printError } from './utils/error-handler.js';
import { runGenerate } from './commands/generate.js';
import { runBatchCommand } from './commands/batch.js';
import { runDiff } from './commands/diff.js';
import { runInit } from './commands/init.js';
import { runPrepare } from './commands/prepare.js';
import { runAuthStatus } from './commands/auth-status.js';
import { runMcpServer } from './commands/mcp-server.js';

// 读取 package.json 版本号
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
const version = pkg.version;

// 帮助文本
const HELP_TEXT = `reverse-spec — 代码逆向工程 Spec 生成工具 v${version}

用法:
  reverse-spec generate <target> [--deep] [--output-dir <dir>]
  reverse-spec prepare <target> [--deep]
  reverse-spec batch [--force] [--output-dir <dir>]
  reverse-spec diff <spec-file> <source> [--output-dir <dir>]
  reverse-spec init [--global] [--remove]
  reverse-spec auth-status [--verify]
  reverse-spec mcp-server
  reverse-spec --version / --help

子命令:
  generate      对指定文件或目录生成 Spec（需要认证）
  prepare       AST 预处理 + 上下文组装，输出到 stdout（无需认证）
  batch         批量生成当前项目所有模块的 Spec
  diff          检测 Spec 与源代码之间的漂移
  init          安装 Claude Code skills 到项目或全局目录
  auth-status   查看当前认证状态（API Key / Claude CLI）
  mcp-server    启动 MCP stdio server（供 Claude Code 插件调用）

认证:
  支持两种认证方式（自动检测，优先级: API Key > CLI 代理）:
  1. ANTHROPIC_API_KEY 环境变量（直接 SDK 调用）
  2. Claude Code CLI 订阅登录（spawn CLI 子进程代理）

选项:
  --global, -g   安装到全局 ~/.claude/skills/（仅 init）
  --remove       移除已安装的 skills（仅 init）
  --verify       在线验证认证凭证（仅 auth-status）
  --deep         包含函数体进行深度分析（generate / prepare）
  --force        强制重新生成所有 Spec（仅 batch）
  --output-dir   自定义输出目录
  --version, -v  显示版本号
  --help, -h     显示帮助信息`;

async function main(): Promise<void> {
  const result = parseArgs(process.argv.slice(2));

  if (!result.ok) {
    printError(result.error.message);
    console.log();
    console.log(HELP_TEXT);
    process.exitCode = 1;
    return;
  }

  const { command } = result;

  if (command.version) {
    console.log(`reverse-spec v${version}`);
    return;
  }

  if (command.help) {
    console.log(HELP_TEXT);
    return;
  }

  switch (command.subcommand) {
    case 'generate':
      await runGenerate(command, version);
      break;
    case 'batch':
      await runBatchCommand(command, version);
      break;
    case 'diff':
      await runDiff(command, version);
      break;
    case 'init':
      runInit(command);
      break;
    case 'prepare':
      await runPrepare(command, version);
      break;
    case 'auth-status':
      await runAuthStatus(command);
      break;
    case 'mcp-server':
      await runMcpServer();
      break;
  }
}

main().catch((err) => {
  printError(`致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
});
