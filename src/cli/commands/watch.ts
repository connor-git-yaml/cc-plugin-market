/**
 * watch 子命令 handler
 * 监听文件变更，自动触发增量文档同步
 */

import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { runBatch } from '../../batch/batch-orchestrator.js';
import { checkAuth, handleError, EXIT_CODES } from '../utils/error-handler.js';
import { loadProjectConfig, mergeConfig } from '../../config/project-config.js';
import { FileWatcher, CATEGORY_LABEL } from '../../watcher/index.js';
import type { FileChangeEvent } from '../../watcher/index.js';
import type { CLICommand } from '../utils/parse-args.js';

// ---------------------------------------------------------------------------
// 模块级状态变量（进程内串行保护，FR-011）
// ---------------------------------------------------------------------------

/** 是否正在执行 batch */
let isRunning = false;
/** 收集等待中的变更文件（batch 执行期间新触发的变更）*/
let pendingNextRound: Set<string> = new Set();
/** 是否已收到停止信号 */
let pendingShutdown = false;

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 检测是否有外部 batch 进程正在运行（FR-010）
 * 宁可漏检也不崩溃——异常时返回 false
 */
export function isExternalBatchRunning(): boolean {
  try {
    const output = execSync('pgrep -f "spectra batch"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // 排除空输出（pgrep 无匹配时抛异常，但某些平台可能返回空字符串）
    return output.trim().length > 0;
  } catch {
    // pgrep 返回非 0 表示无匹配进程
    return false;
  }
}

/**
 * 注册 SIGINT / SIGTERM 信号处理器（FR-003）
 * 等待当前 batch 完成后再退出，避免留下孤儿进程
 */
function setupSignalHandlers(watcher: FileWatcher): void {
  const shutdown = async () => {
    // 防止重复触发
    if (pendingShutdown) return;
    pendingShutdown = true;
    console.log('\n[watch] 收到停止信号，等待当前更新完成...');

    if (!isRunning) {
      // 当前没有 batch 在跑，直接退出
      await watcher.stop();
      process.exit(EXIT_CODES.SUCCESS);
    }
    // 否则，batch 完成回调中负责检查 pendingShutdown 并退出
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

/**
 * 打印变更文件列表（FR-006）
 */
function printChangedFiles(events: FileChangeEvent[]): void {
  console.log(`\n[watch] 检测到 ${events.length} 个文件变更：`);
  for (const event of events) {
    const label = CATEGORY_LABEL[event.category];
    console.log(`  ${label} ${event.path}`);
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行 watch 子命令
 * 启动文件监听，变更触发后自动调用 runBatch({ incremental: true })
 */
export async function runWatchCommand(command: CLICommand): Promise<void> {
  if (!checkAuth()) {
    process.exitCode = EXIT_CODES.API_ERROR;
    return;
  }

  // 解析配置（FR-002）
  const projectRoot = resolve(command.target ?? process.cwd());
  const debounceMs = command.watchDebounce !== undefined
    ? command.watchDebounce * 1000  // CLI 传入的是秒，内部使用毫秒
    : 3000;
  const verbose = command.watchVerbose ?? false;

  // 加载项目级配置（与 batch.ts 模式一致）
  const fileConfig = loadProjectConfig(projectRoot);
  const merged = mergeConfig({}, fileConfig, new Set());

  console.log(`[watch] 正在启动文件监听...`);
  console.log(`[watch] 项目根目录: ${projectRoot}`);
  console.log(`[watch] Debounce 时长: ${debounceMs / 1000} 秒`);

  // 重置模块级状态（支持同一进程多次调用，如测试场景）
  isRunning = false;
  pendingNextRound = new Set();
  pendingShutdown = false;

  // 先实例化 FileWatcher（回调稍后赋值，避免闭包时序依赖）
  let watcher: FileWatcher;

  // onChange 回调：debounce 到期后触发
  const handleChange = async (events: FileChangeEvent[]): Promise<void> => {
    printChangedFiles(events);

    // FR-010：外部 batch 进程检测
    if (isExternalBatchRunning()) {
      console.log('[watch] 检测到外部 spectra batch 正在运行，跳过本次触发');
      return;
    }

    // FR-011：进程内串行保护
    if (isRunning) {
      for (const event of events) {
        pendingNextRound.add(event.path);
      }
      console.log(`[watch] 当前有 batch 正在执行，${events.length} 个变更已加入等待队列`);
      return;
    }

    // 启动 batch 执行循环
    isRunning = true;
    try {
      await executeBatchLoop(projectRoot, verbose, merged.outputDir, merged.languages);
    } finally {
      isRunning = false;
      if (pendingShutdown) {
        console.log('[watch] 更新完成，正在退出...');
        await watcher.stop();
        process.exit(EXIT_CODES.SUCCESS);
      }
    }
  };

  // 实例化 FileWatcher（FR-001）
  watcher = new FileWatcher(
    { projectRoot, debounceMs, verbose },
    (events) => void handleChange(events),
  );

  // 注册信号处理器（FR-003）
  setupSignalHandlers(watcher);

  try {
    // 启动监听（FR-001）
    await watcher.start();

    // 提示用户避免并发运行 batch（WONTFIX 缓解措施）
    console.log('[watch] 注意：请勿同时运行 spectra batch，两者会竞争同一 checkpoint 文件');
    // FR-013：启动完成后打印"已就绪"消息
    console.log('[watch] 已就绪，监听文件变更中... (Ctrl+C 停止)');
  } catch (err) {
    process.exitCode = handleError(err);
  }
}

/**
 * 执行 batch 并在 pendingNextRound 非空时继续下一轮
 * 失败时不清空等待状态（FR-009）
 */
async function executeBatchLoop(projectRoot: string, verbose: boolean, outputDir?: string, languages?: string[]): Promise<void> {
  // 循环执行直到没有待处理变更
  while (true) {
    const batchStartTime = Date.now();
    console.log('[watch] 触发增量更新...');

    try {
      // FR-007：复用 runBatch({ incremental: true })，透传配置文件的 outputDir/languages
      const result = await runBatch(projectRoot, { incremental: true, outputDir, languages });
      const elapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);
      console.log(
        `[watch] 增量更新完成（${elapsed}s）：` +
        `成功 ${result.successful.length} / 总计 ${result.totalModules}` +
        (result.failed.length > 0 ? `，失败 ${result.failed.length}` : ''),
      );
    } catch (err) {
      // FR-009：失败时不清空 pendingNextRound，保证下次触发仍会重新处理
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] 增量更新失败: ${errMsg}`);
      if (verbose) {
        console.error(err);
      }
      // 失败后不继续循环，等待下次文件变更触发
      return;
    }

    // 检查是否有新积压的变更
    if (pendingNextRound.size === 0) {
      // 没有待处理变更，退出循环
      break;
    }

    // 有待处理变更，继续下一轮
    console.log(`[watch] 有 ${pendingNextRound.size} 个变更在等待，启动下一轮更新...`);
    pendingNextRound.clear();
  }
}
