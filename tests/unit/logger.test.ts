/**
 * Logger 单元测试
 * 覆盖：级别过滤、环境变量读取、命名空间前缀格式、stderr 输出验证
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger } from '../../src/panoramic/utils/logger.js';

describe('createLogger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalLevel = process.env['REVERSE_SPEC_LOG_LEVEL'];

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    // 恢复环境变量
    if (originalLevel === undefined) {
      delete process.env['REVERSE_SPEC_LOG_LEVEL'];
    } else {
      process.env['REVERSE_SPEC_LOG_LEVEL'] = originalLevel;
    }
  });

  // ============================================================
  // 命名空间前缀格式验证
  // ============================================================

  it('输出包含正确的命名空间前缀', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const logger = createLogger('my-module');
    logger.warn('测试消息');
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('[my-module]');
    expect(output).toContain('WARN:');
    expect(output).toContain('测试消息');
  });

  it('无命名空间时使用默认前缀 [logger]', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const logger = createLogger();
    logger.warn('无命名空间消息');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('[logger]');
  });

  it('携带 context 参数时以括号追加', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const logger = createLogger('ns');
    logger.warn('操作失败', 'SyntaxError');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('(SyntaxError)');
  });

  // ============================================================
  // 输出到 stderr 而非 stdout
  // ============================================================

  it('日志输出到 stderr，不输出到 stdout', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger('test');
    logger.warn('应输出到 stderr');
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  // ============================================================
  // 默认级别为 warn（未设置环境变量）
  // ============================================================

  it('未设置环境变量时默认 warn 级别，debug 和 info 不输出', () => {
    delete process.env['REVERSE_SPEC_LOG_LEVEL'];
    const logger = createLogger('default');
    logger.debug('debug 消息');
    logger.info('info 消息');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('未设置环境变量时默认 warn 级别，warn 和 error 输出', () => {
    delete process.env['REVERSE_SPEC_LOG_LEVEL'];
    const logger = createLogger('default');
    logger.warn('warn 消息');
    logger.error('error 消息');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  // ============================================================
  // 环境变量读取：四个值
  // ============================================================

  it('REVERSE_SPEC_LOG_LEVEL=debug 时 4 个级别全部输出', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'debug';
    const logger = createLogger('ns');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });

  it('REVERSE_SPEC_LOG_LEVEL=info 时 debug 不输出，其余输出', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'info';
    const logger = createLogger('ns');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(3);
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((s) => s.includes('DEBUG'))).toBe(false);
  });

  it('REVERSE_SPEC_LOG_LEVEL=warn 时只有 warn 和 error 输出', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const logger = createLogger('ns');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('REVERSE_SPEC_LOG_LEVEL=error 时只有 error 输出', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'error';
    const logger = createLogger('ns');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('ERROR:');
  });

  // ============================================================
  // 级别标签格式验证
  // ============================================================

  it('debug 级别标签为大写 DEBUG', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'debug';
    const logger = createLogger('ns');
    logger.debug('调试信息');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('DEBUG:');
  });

  it('info 级别标签为大写 INFO', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'info';
    const logger = createLogger('ns');
    logger.info('信息');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('INFO:');
  });

  // ============================================================
  // 惰性读取：运行时修改环境变量立即生效
  // ============================================================

  it('惰性读取：运行时修改 REVERSE_SPEC_LOG_LEVEL 立即生效', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const logger = createLogger('lazy');
    logger.debug('不应输出');
    expect(stderrSpy).not.toHaveBeenCalled();

    // 运行时切换到 debug 级别
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'debug';
    logger.debug('应输出');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  // ============================================================
  // 输出行以换行符结尾
  // ============================================================

  it('每条日志输出以换行符结尾', () => {
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'warn';
    const logger = createLogger('ns');
    logger.warn('消息');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });
});
