#!/usr/bin/env node
/**
 * spectra CLI 入口点
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
import { runPanoramicCommand } from './commands/panoramic.js';
import { runCacheCommand } from './commands/cache.js';
import { runWatchCommand } from './commands/watch.js';
import { runGraphCommand } from './commands/graph.js';
import { runCommunityCommand } from './commands/community.js';
import { runQueryCommand } from './commands/query.js';
import { runInstall } from './commands/install.js';
import { runExportCommand } from './commands/export.js';
import { runDirectionAuditCommand } from './commands/direction-audit.js';
import { bootstrapAdapters } from '../adapters/index.js';
import { bootstrapGenerators } from '../panoramic/generator-registry.js';
import { bootstrapParsers } from '../panoramic/parser-registry.js';

// 读取 package.json 版本号
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
const version = pkg.version;

// 帮助文本
const HELP_TEXT = `spectra — 代码逆向工程 Spec 生成工具 v${version}

用法:
  spectra generate <target> [--deep] [--output-dir <dir>]
  spectra prepare <target> [--deep]
  spectra batch [--force] [--incremental] [--languages <lang,...>] [--include-docs] [--include-images] [--mode <full|reading|code-only>] [--hyperedges] [--concurrency <N>] [--no-html] [--output-dir <dir>]
  spectra diff <spec-file> <source> [--output-dir <dir>]
  spectra init [--global] [--remove] [--target <claude|codex|both>]
  spectra auth-status [--verify]
  spectra panoramic <cross-package|architecture-ir|overview> [--json] [--project-root <dir>]
  spectra cache <stats|clear> [--generator <id>] [--output-dir <dir>]
  spectra watch [--debounce <seconds>] [--verbose]
  spectra graph [--directed] [--output-dir <dir>]
  spectra community [--min-size <N>] [--output-dir <dir>]
  spectra query "<问题>" [--budget <N>] [--format json|text]
  spectra install [--git] [--remove]
  spectra export --format <obsidian|html> [--output-dir <dir>]
  spectra direction-audit [--graph <path>] [--output <path>] [--format json|text]
  spectra direction-audit --snapshot <path>
  spectra direction-audit --compare-snapshot <path>
  spectra mcp-server
  spectra --version / --help

子命令:
  generate      对指定文件或目录生成 Spec（需要认证）
  prepare       AST 预处理 + 上下文组装，输出到 stdout（无需认证）
  batch         批量生成当前项目所有模块的 Spec
  diff          检测 Spec 与源代码之间的漂移
  init          安装 skills 到 Claude Code / Codex 的项目或全局目录
  auth-status   查看当前认证状态（API Key / Claude CLI / Codex CLI）
  panoramic     运行 panoramic 架构分析（cross-package / architecture-ir / overview）
  cache         管理内容哈希缓存（stats / clear）
  watch         监听文件变更，自动触发增量文档同步
  graph         构建知识图谱并输出 _meta/graph.json
  community     社区检测与架构洞察分析，输出 _meta/GRAPH_REPORT.md
  query         查询知识图谱，返回相关模块及依赖关系子图
  install       安装/卸载 Claude Code PreToolUse hook 和 git post-commit hook（≠ init：init = skill 安装，install = hook 安装）
  export        将知识图谱导出为 Obsidian Vault 或 HTML 交互式可视化
  direction-audit 依赖方向自查工具（SC-006 CI regression guard）
  mcp-server    启动 MCP stdio server（供 Claude Code 插件调用）

认证:
  支持三种认证方式（自动检测，优先级按当前运行时动态排序）:
  1. ANTHROPIC_API_KEY 环境变量（直接 SDK 调用）
  2. Claude Code CLI 订阅登录（spawn CLI 子进程代理）
  3. Codex CLI 登录态（spawn CLI 子进程代理）

选项:
  --global, -g   安装到全局 ~/.claude/skills/ 或 ~/.codex/skills/（由 --target 决定，仅 init）
  --remove       移除已安装的 skills（仅 init）或 hooks（仅 install）
  --target       目标平台: claude | codex | both（仅 init，默认按当前运行时自动选择）
  --verify       在线验证认证凭证（仅 auth-status）
  --deep         包含函数体进行深度分析（generate / prepare）
  --force        强制重新生成所有 Spec（仅 batch）
  --incremental  仅重生成受影响的 Spec（仅 batch）
  --languages    仅处理指定语言，逗号分隔（如 typescript,python）（仅 batch）
  --include-docs 启用 Markdown 文档和 OpenAPI/AsyncAPI 规范提取（仅 batch）
  --include-images 启用图像/图表 Vision 提取（仅 batch）
  --mode         批处理运行模式: full（默认，完整文档，LLM 全量）| reading（省约 38% 时间，模块级 LLM 仍运行，跳过架构叙事/ADR/产品文档层）| code-only（纯 AST，< 30s，无 LLM，最快）（仅 batch）
  --hyperedges   启用 hyperedge LLM 提取（仅 batch + mode=full 生效，默认 false；可用 env SPECTRA_HYPEREDGES_ENABLED=true 等价开启）
  --enable-adr   显式启用 ADR pipeline（v4.0.1 临时禁用，将在 v4.1 evidence-binding 重构后恢复；默认 false）（仅 batch）
  --concurrency  最大并发模块数（仅 batch，默认 3；优先级 CLI > spec-driver.config.yaml batch.concurrency > 默认 3；≤0 / 非整数会规范化为 1 并打印 warn）
  --html         显式启用 graph.html 生成（仅 batch；Feature 140 起默认已启用，本 flag 仅作显式标注，不影响行为）
  --no-html      禁用 graph.html 生成（仅 batch；CI / 资源紧张场景使用；与 --html 同时出现时 --no-html 优先）
  --json         以 JSON 格式输出结果（仅 panoramic）
  --project-root 指定分析目标目录（仅 panoramic，默认为 cwd）
  --generator    指定 generator ID（仅 cache clear）
  --debounce     文件变更静默等待时长（秒，默认 3，仅 watch）
  --verbose      打印详细变更日志（仅 watch）
  --output-dir   自定义输出目录
  --directed     输出有向图（仅 graph 命令）
  --min-size     最小社区节点数过滤（仅 community 命令）
  --budget       返回节点数量上限（仅 query 命令，默认 50）
  --format       输出格式 text|json（仅 query 命令，默认 text）
  --git          同时操作 git post-commit hook（仅 install）
  --format       导出格式 obsidian|html（仅 export 命令，必填）
  --version, -v  显示版本号
  --help, -h     显示帮助信息`;

async function main(): Promise<void> {
  // 注册所有语言适配器（在命令调度前执行）
  bootstrapAdapters();
  // 注册所有文档生成器
  bootstrapGenerators();
  // 注册所有制品解析器
  bootstrapParsers();

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
    console.log(`spectra v${version}`);
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
    case 'panoramic':
      await runPanoramicCommand(command);
      break;
    case 'cache':
      await runCacheCommand(command);
      break;
    case 'watch':
      await runWatchCommand(command);
      break;
    case 'graph':
      await runGraphCommand(command);
      break;
    case 'community':
      await runCommunityCommand(command);
      break;
    case 'query':
      await runQueryCommand(command);
      break;
    case 'install':
      runInstall(command);
      break;
    case 'export':
      await runExportCommand(command);
      break;
    case 'direction-audit':
      await runDirectionAuditCommand(command);
      break;
    case 'mcp-server':
      await runMcpServer(command);
      break;
  }
}

main().catch((err) => {
  printError(`致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
});
