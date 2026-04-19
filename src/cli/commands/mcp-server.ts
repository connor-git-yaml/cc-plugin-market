/**
 * mcp-server 子命令
 * 启动 MCP stdio server，通过 JSON-RPC 2.0 暴露 spectra 工具能力
 *
 * dev 模式（--dev flag 或 SPECTRA_DEV=1 环境变量）：
 *   通过 tsx --watch 启动子进程，文件变更后自动重启，下次 MCP 调用立即使用新代码。
 *   CI 环境（CI=1 或 SPECTRA_DEV_DISABLE=1）下即使传了 --dev 也强制禁用，避免意外的 watcher 开销。
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CLICommand } from '../utils/parse-args.js';
import { startMcpServer } from '../../mcp/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 解析是否应启用 dev 热重载模式
 *
 * 规则（按优先级）：
 *   1. SPECTRA_DEV_DISABLE=1 → 强制禁用，并打印提示
 *   2. CI=true 或 CI=1      → 强制禁用，并打印提示
 *   3. --dev flag 或 SPECTRA_DEV=1 → 启用
 */
export function resolveDevMode(command: Pick<CLICommand, 'mcpDev'>): boolean {
  // CI 强制禁用守卫（优先级最高）
  if (process.env['SPECTRA_DEV_DISABLE'] === '1') {
    process.stderr.write('[dev-mode] disabled by SPECTRA_DEV_DISABLE=1\n');
    return false;
  }
  if (process.env['CI'] === 'true' || process.env['CI'] === '1') {
    process.stderr.write('[dev-mode] disabled by CI env\n');
    return false;
  }

  // 任一条件满足即启用 dev 模式
  return (command.mcpDev ?? false) || process.env['SPECTRA_DEV'] === '1';
}

/**
 * dev 模式：通过 tsx --watch 启动子进程，父进程负责信号转发
 *
 * stdio 策略：inherit — 子进程直接继承父进程的 stdin/stdout/stderr，
 * MCP JSON-RPC 通信无需额外 pipe 即可透传。
 *
 * 子进程 crash 时打印错误但保持父进程存活（不崩溃），
 * 父进程终止时向子进程发送 SIGTERM 进行干净关闭。
 */
function runDevMode(): void {
  // MCP server 入口文件的绝对路径（从 dist/cli/commands/ 向上推算 src/mcp/index.ts）
  // 运行时可能在 dist/ 目录，需要找到对应的 src 路径
  // 优先尝试本地开发路径（src/），再 fallback 到已编译路径
  const srcMcpEntry = resolve(__dirname, '..', '..', '..', 'src', 'mcp', 'index.ts');

  process.stderr.write(`[dev-mode] 启动 tsx --watch: ${srcMcpEntry}\n`);
  process.stderr.write('[dev-mode] 文件变更后 MCP server 将自动重启\n');

  const child = spawn('tsx', ['--watch', srcMcpEntry], {
    stdio: 'inherit',
    // 确保子进程在父进程退出时也能收到信号
    detached: false,
  });

  child.on('error', (err) => {
    // tsx 未找到或启动失败时打印错误，不崩溃父进程
    process.stderr.write(`[dev-mode] 子进程启动失败: ${err.message}\n`);
    process.stderr.write('[dev-mode] 请确认 tsx 已安装：npm install -D tsx\n');
  });

  child.on('exit', (code, signal) => {
    // 子进程因 crash 退出（非父进程主动终止）时打印提示
    if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
      process.stderr.write(
        `[dev-mode] 子进程退出（code=${String(code ?? 'null')}, signal=${String(signal ?? 'null')}）\n`,
      );
    }
  });

  // 父进程终止时干净关闭子进程
  const cleanup = (sig: NodeJS.Signals): void => {
    if (!child.killed) {
      child.kill(sig);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));
}

/**
 * 执行 mcp-server 子命令
 */
export async function runMcpServer(command?: Pick<CLICommand, 'mcpDev'>): Promise<void> {
  const isDev = command !== undefined ? resolveDevMode(command) : false;

  if (isDev) {
    // dev 模式：spawn tsx --watch 子进程，函数不 await（子进程持续运行）
    runDevMode();
    return;
  }

  // 非 dev 模式：走现有路径，零性能回归，不初始化任何 watcher
  await startMcpServer();
}
