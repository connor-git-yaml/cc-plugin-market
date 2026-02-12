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

// 读取 package.json 版本号
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
const version = pkg.version;

// 帮助文本
const HELP_TEXT = `reverse-spec — 代码逆向工程 Spec 生成工具 v${version}

用法:
  reverse-spec generate <target> [--deep] [--output-dir <dir>]
  reverse-spec batch [--force] [--output-dir <dir>]
  reverse-spec diff <spec-file> <source> [--output-dir <dir>]
  reverse-spec --version
  reverse-spec --help

命令:
  generate   对指定文件或目录生成 Spec
  batch      批量生成当前项目所有模块的 Spec
  diff       检测 Spec 与源代码之间的漂移

选项:
  --deep         深度分析（包含函数体）
  --force        强制重新生成所有 spec
  --output-dir   自定义输出目录
  -v, --version  显示版本号
  -h, --help     显示帮助信息`;

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
  }
}

main().catch((err) => {
  printError(`致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
});
