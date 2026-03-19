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
import { AbstractArtifactParser } from './abstract-artifact-parser.js';
import { inferType } from './types.js';
import type { ConfigEntries } from './types.js';

/**
 * TOML 配置文件解析器
 * 实现 ArtifactParser<ConfigEntries> 接口
 */
export class TomlConfigParser extends AbstractArtifactParser<ConfigEntries> {
  readonly id = 'toml-config' as const;
  readonly name = 'TOML Config Parser' as const;
  readonly filePatterns = ['**/*.toml'] as const;

  /**
   * 从 TOML 配置文件内容解析为结构化数据
   */
  protected doParse(content: string, _filePath: string): ConfigEntries {
    // 空内容直接返回降级结果
    if (!content.trim()) {
      return this.createFallback();
    }

    return { entries: parseTomlContent(content) };
  }

  /**
   * 降级结果
   */
  protected createFallback(): ConfigEntries {
    return { entries: [] };
  }
}

/**
 * 解析 TOML 文件内容为 ConfigEntry 数组
 *
 * @param content - TOML 文件的文本内容
 * @returns ConfigEntry 数组
 */
export function parseTomlContent(content: string): ConfigEntries['entries'] {
  const entries: ConfigEntries['entries'] = [];
  const lines = content.split('\n');
  let currentSection = '';
  let pendingComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行重置 pending comment
    if (trimmed === '') {
      pendingComment = '';
      continue;
    }

    // 注释行
    if (trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^#\s*/, '');
      if (pendingComment) {
        pendingComment += ' ' + commentText;
      } else {
        pendingComment = commentText;
      }
      continue;
    }

    // Section 头 [section.name]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      pendingComment = '';
      continue;
    }

    // key = value 匹配
    const kvMatch = trimmed.match(/^([\w][\w.-]*)\s*=\s*(.+)$/);
    if (!kvMatch) {
      pendingComment = '';
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const keyPath = currentSection ? `${currentSection}.${key}` : key;
    const description = pendingComment || inlineComment;

    entries.push({
      keyPath,
      type: inferType(value),
      defaultValue: value,
      description,
    });

    pendingComment = '';
  }

  return entries;
}
