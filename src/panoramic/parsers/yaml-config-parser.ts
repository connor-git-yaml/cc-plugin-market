/**
 * YamlConfigParser — YAML 配置文件解析器
 *
 * 解析 YAML 配置文件（.yaml/.yml）中的键值对，
 * 提取配置项路径、类型、默认值和注释说明。
 *
 * 解析策略：
 * - 行级正则匹配 key: value 结构
 * - 缩进堆栈跟踪嵌套层级，构建点号分隔的 keyPath
 * - 上方注释行和行内注释均可作为 description
 * - 上方注释优先于行内注释
 * - 空行隔断注释与配置项的关联
 *
 * 容错降级：解析失败返回 { entries: [] }
 */
import { AbstractConfigParser } from './abstract-config-parser.js';
import { inferType, stripQuotes } from './types.js';
import { CommentTracker } from './comment-tracker.js';
import type { ConfigEntry } from './types.js';

/**
 * YAML 配置文件解析器
 * 继承 AbstractConfigParser，只需实现 parseContent()
 */
export class YamlConfigParser extends AbstractConfigParser {
  readonly id = 'yaml-config' as const;
  readonly name = 'YAML Config Parser' as const;
  readonly filePatterns = ['**/*.yaml', '**/*.yml'] as const;

  /**
   * 从 YAML 配置文件内容解析为 ConfigEntry 数组
   */
  protected parseContent(content: string): ConfigEntry[] {
    return parseYamlContent(content);
  }
}

/**
 * 解析 YAML 文件内容为 ConfigEntry 数组
 * 使用行级正则解析，提取键值对、缩进层级和注释
 *
 * @param content - YAML 文件的文本内容
 * @returns ConfigEntry 数组
 */
export function parseYamlContent(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = content.split('\n');

  // 用缩进堆栈跟踪当前路径
  const pathStack: Array<{ indent: number; key: string }> = [];
  const tracker = new CommentTracker();

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // 空行重置 pending comment
    if (trimmed.trim() === '') {
      tracker.reset();
      continue;
    }

    // 纯注释行
    if (/^\s*#/.test(trimmed)) {
      const commentText = trimmed.replace(/^\s*#\s*/, '');
      tracker.append(commentText);
      continue;
    }

    // 匹配 key: value 或 key: (纯嵌套头)
    const match = trimmed.match(/^(\s*)([\w][\w.-]*)\s*:\s*(.*?)$/);
    if (!match) {
      tracker.reset();
      continue;
    }

    const indent = match[1]!.length;
    const key = match[2]!;
    let rawValue = match[3]!;

    // 提取行内注释
    let inlineComment = '';
    const commentMatch = rawValue.match(/^(.*?)\s+#\s+(.*)$/);
    if (commentMatch) {
      rawValue = commentMatch[1]!.trim();
      inlineComment = commentMatch[2]!;
    }

    // 更新路径堆栈
    while (pathStack.length > 0 && pathStack[pathStack.length - 1]!.indent >= indent) {
      pathStack.pop();
    }
    pathStack.push({ indent, key });

    // 构建完整 keyPath
    const keyPath = pathStack.map((p) => p.key).join('.');

    // 有值 -> 叶节点
    if (rawValue !== '') {
      const cleanValue = stripQuotes(rawValue);
      const pendingComment = tracker.consume();
      const description = pendingComment || inlineComment;
      entries.push({
        keyPath,
        type: inferType(cleanValue),
        defaultValue: cleanValue,
        description,
      });
    } else {
      // 无值 -> 父节点（不作为 entry，但保留在堆栈中）
      tracker.consume(); // 消费注释但不使用
    }
  }

  return entries;
}
