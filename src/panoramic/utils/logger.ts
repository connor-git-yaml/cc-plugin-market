/**
 * 轻量级分级日志工具
 *
 * 特性：
 * - 四个日志级别：debug < info < warn < error
 * - 默认 warn 级别（静默降级行为默认不可见）
 * - 通过 `REVERSE_SPEC_LOG_LEVEL` 环境变量控制级别（惰性读取，支持测试覆盖）
 * - 全部输出到 `process.stderr`（不污染 stdout 数据流）
 * - 输出格式：`[namespace] LEVEL: message [context]`
 * - 零外部 npm 依赖，纯 Node.js 内置 API
 *
 * @example
 * ```ts
 * const logger = createLogger('data-model-generator');
 * logger.warn('Python 文件解析失败，已跳过: src/models.py', 'SyntaxError');
 * logger.debug('JSON 解析失败，使用默认值: unexpected token');
 * ```
 *
 * @example 测试覆盖环境变量
 * ```ts
 * process.env.REVERSE_SPEC_LOG_LEVEL = 'debug';
 * // 此后所有 logger 实例调用均按 debug 级别过滤
 * ```
 */

/** 日志级别类型 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Logger 接口 */
export interface Logger {
  debug(message: string, context?: string): void;
  info(message: string, context?: string): void;
  warn(message: string, context?: string): void;
  error(message: string, context?: string): void;
}

/** 级别到数值的映射（数值越大优先级越高） */
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 默认日志级别 */
const DEFAULT_LEVEL: LogLevel = 'warn';

/**
 * 惰性读取当前生效的日志级别
 * 每次调用时读取 process.env.REVERSE_SPEC_LOG_LEVEL，支持测试动态覆盖
 */
function getEffectiveLevel(): number {
  const raw = process.env['REVERSE_SPEC_LOG_LEVEL']?.toLowerCase();
  const level = (raw && raw in LEVEL_ORDER) ? raw as LogLevel : DEFAULT_LEVEL;
  return LEVEL_ORDER[level];
}

/**
 * 创建分级日志工具实例
 *
 * 输出格式：`[namespace] LEVEL: message` 或 `[namespace] LEVEL: message (context)`
 *
 * @param namespace - 日志命名空间（如 'data-model-generator'），用于标识来源
 * @returns Logger 实例
 */
export function createLogger(namespace?: string): Logger {
  const prefix = namespace ? `[${namespace}]` : '[logger]';

  function log(level: LogLevel, message: string, context?: string): void {
    if (LEVEL_ORDER[level] < getEffectiveLevel()) {
      return;
    }

    const levelLabel = level.toUpperCase();
    const contextSuffix = context ? ` (${context})` : '';
    process.stderr.write(`${prefix} ${levelLabel}: ${message}${contextSuffix}\n`);
  }

  return {
    debug(message: string, context?: string): void {
      log('debug', message, context);
    },
    info(message: string, context?: string): void {
      log('info', message, context);
    },
    warn(message: string, context?: string): void {
      log('warn', message, context);
    },
    error(message: string, context?: string): void {
      log('error', message, context);
    },
  };
}
