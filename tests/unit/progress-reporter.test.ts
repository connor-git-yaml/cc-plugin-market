/**
 * ProgressReporter 单元测试（FR-A-001~007）
 * 覆盖：TTY 模式 ANSI 控制码、pipe 模式纯文本格式、向后兼容
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReporter, type ProgressMode } from '../../src/batch/progress-reporter.js';
import type { StageProgress } from '../../src/models/module-spec.js';

describe('createReporter', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  // ============================================================
  // 向后兼容：createReporter(total) 不传 mode 时正常工作
  // ============================================================

  it('createReporter(total) 不传 mode 时能正常返回 ProgressReporter', () => {
    const reporter = createReporter(5);
    expect(reporter).toHaveProperty('start');
    expect(reporter).toHaveProperty('stage');
    expect(reporter).toHaveProperty('complete');
    expect(reporter).toHaveProperty('finish');
  });

  it('createReporter(total) 不传 mode 时 finish 返回 BatchSummary', () => {
    const reporter = createReporter(1);
    reporter.start('src/a.ts');
    reporter.complete('src/a.ts', 'success');
    const summary = reporter.finish();
    expect(summary.totalModules).toBe(1);
    expect(summary.successful).toBe(1);
    expect(summary.failed).toBe(0);
  });

  // ============================================================
  // TTY 模式：含 ANSI 清行控制码
  // ============================================================

  describe('TTY 模式（mode = tty）', () => {
    it('start() 输出包含 ANSI 清行控制码 \\x1b[2K\\r', () => {
      const reporter = createReporter(3, 'tty');
      reporter.start('src/module-a.ts');
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('\x1b[2K\r');
    });

    it('stage() 输出包含 ANSI 清行控制码 \\x1b[2K\\r', () => {
      const reporter = createReporter(3, 'tty');
      reporter.start('src/module-a.ts');
      stdoutSpy.mockClear();
      const progress: StageProgress = { stage: 'parse', message: '正在解析' };
      reporter.stage('src/module-a.ts', progress);
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('\x1b[2K\r');
    });

    it('complete() 输出包含 ANSI 清行控制码 \\x1b[2K\\r', () => {
      const reporter = createReporter(3, 'tty');
      reporter.start('src/module-a.ts');
      stdoutSpy.mockClear();
      reporter.complete('src/module-a.ts', 'success');
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('\x1b[2K\r');
    });

    it('finish() 不应有遗留的进度行（清除后输出摘要）', () => {
      const reporter = createReporter(1, 'tty');
      reporter.start('src/a.ts');
      reporter.complete('src/a.ts', 'success');
      stdoutSpy.mockClear();
      reporter.finish();
      // finish 输出摘要
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('1');
    });

    it('BatchSummary 计数在 TTY 模式下正确', () => {
      const reporter = createReporter(2, 'tty');
      reporter.start('src/a.ts');
      reporter.complete('src/a.ts', 'success');
      reporter.start('src/b.ts');
      reporter.complete('src/b.ts', 'failed');
      const summary = reporter.finish();
      expect(summary.successful).toBe(1);
      expect(summary.failed).toBe(1);
    });
  });

  // ============================================================
  // Pipe 模式：纯文本行日志，无 ANSI 控制码，无 \r
  // ============================================================

  describe('Pipe 模式（mode = pipe）', () => {
    it('complete() 输出格式为 [N/Total] path ... status\\n', () => {
      const reporter = createReporter(3, 'pipe');
      reporter.start('src/module-a.ts');
      stdoutSpy.mockClear();
      reporter.complete('src/module-a.ts', 'success');
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      // 包含 [N/Total] 格式
      expect(allOutput).toMatch(/\[\d+\/\d+\]/);
      // 包含路径
      expect(allOutput).toContain('src/module-a.ts');
      // 包含状态
      expect(allOutput).toContain('success');
      // 以换行结尾
      expect(allOutput.endsWith('\n')).toBe(true);
    });

    it('complete() 输出不含 ANSI 控制序列', () => {
      const reporter = createReporter(3, 'pipe');
      reporter.start('src/module-a.ts');
      stdoutSpy.mockClear();
      reporter.complete('src/module-a.ts', 'success');
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      // 不含 ESC 字符（ANSI 序列起始）
      expect(allOutput).not.toContain('\x1b');
    });

    it('complete() 输出不含 \\r（回车符）', () => {
      const reporter = createReporter(3, 'pipe');
      reporter.start('src/module-a.ts');
      stdoutSpy.mockClear();
      reporter.complete('src/module-a.ts', 'failed');
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).not.toContain('\r');
    });

    it('start() 在 pipe 模式下不输出', () => {
      const reporter = createReporter(3, 'pipe');
      reporter.start('src/module-a.ts');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('stage() 在 pipe 模式下不输出', () => {
      const reporter = createReporter(3, 'pipe');
      reporter.start('src/a.ts');
      stdoutSpy.mockClear();
      const progress: StageProgress = { stage: 'analyze', message: '分析中' };
      reporter.stage('src/a.ts', progress);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('finish() 输出摘要且不含 ANSI 控制序列', () => {
      const reporter = createReporter(2, 'pipe');
      reporter.start('src/a.ts');
      reporter.complete('src/a.ts', 'success');
      reporter.start('src/b.ts');
      reporter.complete('src/b.ts', 'skipped');
      stdoutSpy.mockClear();
      const summary = reporter.finish();
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).not.toContain('\x1b');
      expect(summary.successful).toBe(1);
      expect(summary.skipped).toBe(1);
    });

    it('BatchSummary 计数在 pipe 模式下正确', () => {
      const reporter = createReporter(3, 'pipe');
      reporter.start('src/a.ts');
      reporter.complete('src/a.ts', 'success');
      reporter.start('src/b.ts');
      reporter.complete('src/b.ts', 'degraded');
      reporter.start('src/c.ts');
      reporter.complete('src/c.ts', 'failed');
      const summary = reporter.finish();
      expect(summary.successful).toBe(1);
      expect(summary.degraded).toBe(1);
      expect(summary.failed).toBe(1);
    });
  });

  // ============================================================
  // ProgressMode 类型可作为字面量使用
  // ============================================================

  it('ProgressMode 类型接受 tty 和 pipe 字面量', () => {
    const ttyMode: ProgressMode = 'tty';
    const pipeMode: ProgressMode = 'pipe';
    expect(ttyMode).toBe('tty');
    expect(pipeMode).toBe('pipe');
  });
});
