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
import { AbstractArtifactParser } from './abstract-artifact-parser.js';
import { inferType } from './types.js';
import type { ConfigEntries } from './types.js';

/**
 * .env 配置文件解析器
 * 实现 ArtifactParser<ConfigEntries> 接口
 */
export class EnvConfigParser extends AbstractArtifactParser<ConfigEntries> {
  readonly id = 'env-config' as const;
  readonly name = '.env Config Parser' as const;
  readonly filePatterns = ['**/.env', '**/.env.*'] as const;

  /**
   * 从 .env 文件内容解析为结构化数据
   */
  protected doParse(content: string, _filePath: string): ConfigEntries {
    // 空内容直接返回降级结果
    if (!content.trim()) {
      return this.createFallback();
    }

    return { entries: parseEnvContent(content) };
  }

  /**
   * 降级结果
   */
  protected createFallback(): ConfigEntries {
    return { entries: [] };
  }
}

/**
 * 解析 .env 文件内容为 ConfigEntry 数组
 *
 * @param content - .env 文件的文本内容
 * @returns ConfigEntry 数组
 */
export function parseEnvContent(content: string): ConfigEntries['entries'] {
  const entries: ConfigEntries['entries'] = [];
  const lines = content.split('\n');
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

    // KEY=VALUE 匹配
    const match = trimmed.match(/^([A-Za-z_][\w.]*)\s*=\s*(.*)$/);
    if (!match) {
      pendingComment = '';
      continue;
    }

    const key = match[1]!;
    let value = match[2]!;

    // 去除引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push({
      keyPath: key,
      type: inferType(value),
      defaultValue: value,
      description: pendingComment,
    });

    pendingComment = '';
  }

  return entries;
}
