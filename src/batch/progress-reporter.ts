/**
 * 终端进度报告器
 *
 * 支持两种输出模式（由 {@link ProgressMode} 枚举控制）：
 *
 * - `tty`：交互终端模式，使用 ANSI 控制码（`\x1b[2K\r`）清行后重绘进度条；
 *   日志从上方滚动，进度条固定底部，进度与模块日志不发生视觉交叉。
 *
 * - `pipe`：管道/CI 模式，输出纯文本行日志（`[N/Total] path ... status\n`）；
 *   全程禁止 ANSI 控制码与 `\r`，适合重定向到文件或 CI 日志流。
 *
 * 模式选择策略：
 * - 未指定 `mode` 时，根据 `process.stdout.isTTY` 自动检测；
 * - `isTTY=true` → `tty`，否则 → `pipe`。
 *
 * 向后兼容性：
 * - `createReporter(total)` 单参数调用方零改动，`mode` 为可选参数。
 *
 * [N/Total] Processing src/module... 格式（FR-015）
 * 参见 contracts/batch-module.md
 */
import * as fs from 'node:fs';
import type { FailedModule, StageProgress } from '../models/module-spec.js';
import type { CostSummary } from './cost-summary.js';
import { renderSummaryCostSection } from './cost-summary.js';

// ============================================================
// 类型定义
// ============================================================

/** 进度报告输出模式 */
export type ProgressMode = 'tty' | 'pipe';

export interface BatchSummary {
  totalModules: number;
  successful: number;
  failed: number;
  skipped: number;
  degraded: number;
  duration: number;
  modules: Array<{
    path: string;
    status: 'success' | 'failed' | 'skipped' | 'degraded';
    duration?: number;
  }>;
}

export interface ProgressReporter {
  /** 开始处理某模块 */
  start(modulePath: string): void;
  /** 报告模块内阶段进度 */
  stage(modulePath: string, progress: StageProgress): void;
  /** 完成某模块处理 */
  complete(
    modulePath: string,
    status: 'success' | 'failed' | 'skipped' | 'degraded',
  ): void;
  /** 生成最终摘要 */
  finish(): BatchSummary;
}

// ============================================================
// 内部工具函数
// ============================================================

/** 渲染进度条字符串（TTY 模式复用） */
function renderProgressBar(completed: number, total: number): string {
  const percent = total > 0 ? completed / total : 0;
  const barWidth = 20;
  const filled = Math.floor(percent * barWidth);
  const bar = '='.repeat(filled).padEnd(barWidth, ' ');
  return `[${bar}] ${completed}/${total}`;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建终端进度报告器
 *
 * @param total - 模块总数
 * @param mode  - 输出模式（默认根据 process.stdout.isTTY 自动检测）
 * @returns ProgressReporter
 */
export function createReporter(total: number, mode?: ProgressMode): ProgressReporter {
  // 自动检测模式：isTTY 为 true 时使用 tty，否则使用 pipe
  const effectiveMode: ProgressMode = mode ?? (process.stdout.isTTY ? 'tty' : 'pipe');

  const startTime = Date.now();
  let completed = 0;
  const modules: BatchSummary['modules'] = [];
  const moduleStartTimes = new Map<string, number>();

  // ============================================================
  // TTY 模式实现
  // ============================================================

  if (effectiveMode === 'tty') {
    return {
      start(modulePath: string): void {
        moduleStartTimes.set(modulePath, Date.now());
        // 清行 → 输出模块开始日志 → 重绘进度条（completed 在 complete() 中递增，与 pipe 模式对齐）
        process.stdout.write(`\x1b[2K\r[${completed + 1}/${total}] 正在处理 ${modulePath}...\n`);
        process.stdout.write(`\x1b[2K\r${renderProgressBar(completed, total)}`);
      },

      stage(modulePath: string, progress: StageProgress): void {
        if (progress.duration === undefined) {
          // 阶段开始
          process.stdout.write(`\x1b[2K\r  → ${progress.message}\n`);
        } else {
          // 阶段完成
          process.stdout.write(`\x1b[2K\r  ✓ ${progress.stage}完成 (${progress.duration}ms)\n`);
        }
        // 重绘进度条
        process.stdout.write(`\x1b[2K\r${renderProgressBar(completed, total)}`);
      },

      complete(
        modulePath: string,
        status: 'success' | 'failed' | 'skipped' | 'degraded',
      ): void {
        completed++;
        const moduleStart = moduleStartTimes.get(modulePath);
        const duration = moduleStart ? Date.now() - moduleStart : undefined;

        const statusEmoji = {
          success: '✅',
          failed: '❌',
          skipped: '⏭️',
          degraded: '⚠️',
        }[status];

        // 清行 → 输出完成行 → 重绘进度条
        process.stdout.write(`\x1b[2K\r  ${statusEmoji} ${modulePath} — ${status}${duration ? ` (${duration}ms)` : ''}\n`);
        process.stdout.write(`\x1b[2K\r${renderProgressBar(completed, total)}`);

        modules.push({ path: modulePath, status, duration });
      },

      finish(): BatchSummary {
        const duration = Date.now() - startTime;
        const summary: BatchSummary = {
          totalModules: total,
          successful: modules.filter((m) => m.status === 'success').length,
          failed: modules.filter((m) => m.status === 'failed').length,
          skipped: modules.filter((m) => m.status === 'skipped').length,
          degraded: modules.filter((m) => m.status === 'degraded').length,
          duration,
          modules,
        };

        // 清除进度行 → 输出摘要统计
        process.stdout.write('\x1b[2K\r');
        process.stdout.write('\n--- 批处理完成 ---\n');
        process.stdout.write(`总计: ${total} 模块\n`);
        process.stdout.write(`成功: ${summary.successful}\n`);
        process.stdout.write(`失败: ${summary.failed}\n`);
        process.stdout.write(`跳过: ${summary.skipped}\n`);
        process.stdout.write(`降级: ${summary.degraded}\n`);
        process.stdout.write(`耗时: ${(duration / 1000).toFixed(1)}s\n`);

        return summary;
      },
    };
  }

  // ============================================================
  // Pipe 模式实现
  // ============================================================

  return {
    start(modulePath: string): void {
      // pipe 模式 start 记录开始时间，不输出（避免噪音）
      moduleStartTimes.set(modulePath, Date.now());
    },

    stage(_modulePath: string, _progress: StageProgress): void {
      // pipe 模式 stage 不输出，避免噪音
    },

    complete(
      modulePath: string,
      status: 'success' | 'failed' | 'skipped' | 'degraded',
    ): void {
      completed++;
      const moduleStart = moduleStartTimes.get(modulePath);
      const duration = moduleStart ? Date.now() - moduleStart : undefined;

      // 纯文本行日志：[N/Total] module-path ... status
      const durationStr = duration ? ` (${duration}ms)` : '';
      process.stdout.write(`[${completed}/${total}] ${modulePath} ... ${status}${durationStr}\n`);

      modules.push({ path: modulePath, status, duration });
    },

    finish(): BatchSummary {
      const duration = Date.now() - startTime;
      const summary: BatchSummary = {
        totalModules: total,
        successful: modules.filter((m) => m.status === 'success').length,
        failed: modules.filter((m) => m.status === 'failed').length,
        skipped: modules.filter((m) => m.status === 'skipped').length,
        degraded: modules.filter((m) => m.status === 'degraded').length,
        duration,
        modules,
      };

      // 纯文本摘要，无 ANSI 控制码
      process.stdout.write('\n--- 批处理完成 ---\n');
      process.stdout.write(`总计: ${total} 模块\n`);
      process.stdout.write(`成功: ${summary.successful}\n`);
      process.stdout.write(`失败: ${summary.failed}\n`);
      process.stdout.write(`跳过: ${summary.skipped}\n`);
      process.stdout.write(`降级: ${summary.degraded}\n`);
      process.stdout.write(`耗时: ${(duration / 1000).toFixed(1)}s\n`);

      return summary;
    },
  };
}

/**
 * 写入批处理摘要日志（FR-015）
 *
 * @param summary - 批处理摘要
 * @param outputPath - 输出路径（specs/ 目录下）
 * @param costSummary - 可选的 LLM 成本汇总（Feature 127 FR-008），存在时追加 "LLM 成本汇总" 节
 * @param failedModules - 可选的失败模块详情（Bug 142），含 reason / retryCount / error；
 *                         传入时追加 "## 失败详情" 节，让用户能直接看到失败原因
 *                         （如 retry-budget-exceeded），不必再翻 checkpoint 文件
 */
export function writeSummaryLog(
  summary: BatchSummary,
  outputPath: string,
  costSummary?: CostSummary,
  failedModules?: FailedModule[],
): void {
  const lines: string[] = [
    '# 批处理摘要日志',
    '',
    `生成时间: ${new Date().toISOString()}`,
    `总耗时: ${(summary.duration / 1000).toFixed(1)}s`,
    '',
    '## 统计',
    '',
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 总模块数 | ${summary.totalModules} |`,
    `| 成功 | ${summary.successful} |`,
    `| 失败 | ${summary.failed} |`,
    `| 跳过 | ${summary.skipped} |`,
    `| 降级 | ${summary.degraded} |`,
    '',
    '## 详情',
    '',
    '| 模块 | 状态 | 耗时 |',
    '|------|------|------|',
  ];

  for (const mod of summary.modules) {
    const duration = mod.duration ? `${mod.duration}ms` : '-';
    lines.push(`| ${mod.path} | ${mod.status} | ${duration} |`);
  }

  // Bug 142：追加失败详情节，输出 reason / retryCount / error
  if (failedModules && failedModules.length > 0) {
    lines.push('');
    lines.push('## 失败详情');
    lines.push('');
    lines.push('| 模块 | 原因 | 重试次数 | 错误 |');
    lines.push('|------|------|---------|------|');
    for (const fm of failedModules) {
      const reason = fm.reason ?? '-';
      // 错误消息可能包含管道符 / 换行，转义后截断到合理长度
      const errorEscaped = fm.error
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '\\|')
        .slice(0, 500);
      lines.push(`| ${fm.path} | ${reason} | ${fm.retryCount} | ${errorEscaped} |`);
    }
  }

  // Feature 127：追加 LLM 成本汇总节
  if (costSummary) {
    lines.push('');
    lines.push(renderSummaryCostSection(costSummary));
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
