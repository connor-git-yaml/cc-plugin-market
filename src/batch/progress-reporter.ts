/**
 * 终端进度报告器
 * [N/Total] Processing src/module... 格式（FR-015）
 * 参见 contracts/batch-module.md
 */
import * as fs from 'node:fs';
import type { StageProgress } from '../models/module-spec.js';

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

/**
 * 创建终端进度报告器
 *
 * @param total - 模块总数
 * @returns ProgressReporter
 */
export function createReporter(total: number): ProgressReporter {
  const startTime = Date.now();
  let completed = 0;
  const modules: BatchSummary['modules'] = [];
  const moduleStartTimes = new Map<string, number>();

  return {
    start(modulePath: string): void {
      completed++;
      moduleStartTimes.set(modulePath, Date.now());
      console.log(`[${completed}/${total}] 正在处理 ${modulePath}...`);
    },

    stage(_modulePath: string, progress: StageProgress): void {
      if (progress.duration === undefined) {
        // 阶段开始
        console.log(`  → ${progress.message}`);
      } else {
        // 阶段完成
        console.log(`  ✓ ${progress.stage}完成 (${progress.duration}ms)`);
      }
    },

    complete(
      modulePath: string,
      status: 'success' | 'failed' | 'skipped' | 'degraded',
    ): void {
      const moduleStart = moduleStartTimes.get(modulePath);
      const duration = moduleStart ? Date.now() - moduleStart : undefined;

      const statusEmoji = {
        success: '✅',
        failed: '❌',
        skipped: '⏭️',
        degraded: '⚠️',
      }[status];

      console.log(`  ${statusEmoji} ${modulePath} — ${status}${duration ? ` (${duration}ms)` : ''}`);

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

      console.log('\n--- 批处理完成 ---');
      console.log(`总计: ${total} 模块`);
      console.log(`成功: ${summary.successful}`);
      console.log(`失败: ${summary.failed}`);
      console.log(`跳过: ${summary.skipped}`);
      console.log(`降级: ${summary.degraded}`);
      console.log(`耗时: ${(duration / 1000).toFixed(1)}s`);

      return summary;
    },
  };
}

/**
 * 写入批处理摘要日志（FR-015）
 *
 * @param summary - 批处理摘要
 * @param outputPath - 输出路径（specs/ 目录下）
 */
export function writeSummaryLog(
  summary: BatchSummary,
  outputPath: string,
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

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
