/**
 * TomlConfigParser — TOML 配置文件解析器
 *
 * 解析 TOML 配置文件（.toml）中的键值对，
 * 提取配置项路径、类型、默认值和注释说明。
 *
 * 解析策略：
 * - [section.name] 头定义当前分组前缀
 * - key = value 行级正则匹配
 * - 上方注释行和行内注释均可作为 description
 * - 上方注释优先于行内注释
 * - 空行隔断注释与配置项的关联
 * - 支持引号包裹的值（双引号和单引号）
 *
 * 容错降级：解析失败返回 { entries: [] }
 */
import { AbstractConfigParser } from './abstract-config-parser.js';
import { inferType, stripQuotes } from './types.js';
import { CommentTracker } from './comment-tracker.js';
import type { ConfigEntry } from './types.js';

/**
 * TOML 配置文件解析器
 * 继承 AbstractConfigParser，只需实现 parseContent()
 */
export class TomlConfigParser extends AbstractConfigParser {
  readonly id = 'toml-config' as const;
  readonly name = 'TOML Config Parser' as const;
  readonly filePatterns = ['**/*.toml'] as const;

  /**
   * 从 TOML 配置文件内容解析为 ConfigEntry 数组
   */
  protected parseContent(content: string): ConfigEntry[] {
    return parseTomlContent(content);
  }
}

/**
 * 解析 TOML 文件内容为 ConfigEntry 数组
 *
 * @param content - TOML 文件的文本内容
 * @returns ConfigEntry 数组
 */
export function parseTomlContent(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = content.split('\n');
  let currentSection = '';
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

    // Section 头 [section.name]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      tracker.reset();
      continue;
    }

    // key = value 匹配
    const kvMatch = trimmed.match(/^([\w][\w.-]*)\s*=\s*(.+)$/);
    if (!kvMatch) {
      tracker.reset();
      continue;
    }

    const key = kvMatch[1]!;
    let value = kvMatch[2]!;

    // 提取行内注释
    let inlineComment = '';
    // 处理未被引号包裹的行内注释
    if (!value.startsWith('"') && !value.startsWith("'") && !value.startsWith('[') && !value.startsWith('{')) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        inlineComment = value.slice(commentIdx + 2).trim();
        value = value.slice(0, commentIdx).trim();
      }
    }

    // 去除引号
    value = stripQuotes(value);

    const keyPath = currentSection ? `${currentSection}.${key}` : key;
    const pendingComment = tracker.consume();
    const description = pendingComment || inlineComment;

    entries.push({
      keyPath,
      type: inferType(value),
      defaultValue: value,
      description,
    });
  }

  return entries;
}
