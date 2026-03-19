/**
 * EnvConfigParser — .env 配置文件解析器
 *
 * 解析 .env 文件（.env、.env.*）中的 KEY=VALUE 对，
 * 提取环境变量名、类型、值和注释说明。
 *
 * 解析策略：
 * - 逐行匹配 KEY=VALUE 格式
 * - 上方注释行（# 开头）作为 description
 * - 空行隔断注释与环境变量的关联
 * - 支持引号包裹的值（双引号和单引号）
 *
 * 容错降级：解析失败返回 { entries: [] }
 */
import { AbstractConfigParser } from './abstract-config-parser.js';
import { inferType, stripQuotes } from './types.js';
import { CommentTracker } from './comment-tracker.js';
import type { ConfigEntry } from './types.js';

/**
 * .env 配置文件解析器
 * 继承 AbstractConfigParser，只需实现 parseContent()
 */
export class EnvConfigParser extends AbstractConfigParser {
  readonly id = 'env-config' as const;
  readonly name = '.env Config Parser' as const;
  readonly filePatterns = ['**/.env', '**/.env.*'] as const;

  /**
   * 从 .env 文件内容解析为 ConfigEntry 数组
   */
  protected parseContent(content: string): ConfigEntry[] {
    return parseEnvContent(content);
  }
}

/**
 * 解析 .env 文件内容为 ConfigEntry 数组
 *
 * @param content - .env 文件的文本内容
 * @returns ConfigEntry 数组
 */
export function parseEnvContent(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = content.split('\n');
  const tracker = new CommentTracker();

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行重置 pending comment
    if (trimmed === '') {
      tracker.reset();
      continue;
    }

    // 注释行
    if (trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^#\s*/, '');
      tracker.append(commentText);
      continue;
    }

    // KEY=VALUE 匹配
    const match = trimmed.match(/^([A-Za-z_][\w.]*)\s*=\s*(.*)$/);
    if (!match) {
      tracker.reset();
      continue;
    }

    const key = match[1]!;
    const value = stripQuotes(match[2]!);

    entries.push({
      keyPath: key,
      type: inferType(value),
      defaultValue: value,
      description: tracker.consume(),
    });
  }

  return entries;
}
