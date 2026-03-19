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

// ============================================================
// 受限 YAML 文档解析（供 Compose 等场景复用）
// ============================================================

export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlObject | YamlArray;
export interface YamlObject {
  [key: string]: YamlValue;
}
export type YamlArray = YamlValue[];

interface YamlLine {
  indent: number;
  text: string;
}

interface ParseState {
  index: number;
}

/**
 * 解析受限 YAML 文档为 JS 风格的嵌套对象。
 *
 * 目标覆盖：
 * - map / list 结构
 * - Compose 常见短语法与长语法
 * - inline array / inline object
 *
 * 非目标：
 * - anchor / alias / merge key
 * - 多文档 YAML
 */
export function parseYamlDocument(content: string): YamlObject {
  const lines = tokenizeYamlLines(content);
  if (lines.length === 0) {
    return {};
  }

  const state: ParseState = { index: 0 };
  const parsed = parseYamlBlock(lines, state, lines[0]!.indent);
  return isYamlObject(parsed) ? parsed : {};
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

function tokenizeYamlLines(content: string): YamlLine[] {
  const lines: YamlLine[] = [];

  for (const rawLine of content.split('\n')) {
    const withoutComment = stripYamlComment(rawLine);
    if (withoutComment.trim() === '') {
      continue;
    }

    lines.push({
      indent: rawLine.match(/^\s*/)?.[0].length ?? 0,
      text: withoutComment.trim(),
    });
  }

  return lines;
}

function parseYamlBlock(lines: YamlLine[], state: ParseState, indent: number): YamlValue {
  if (state.index >= lines.length) {
    return {};
  }

  const current = lines[state.index]!;
  if (current.text.startsWith('- ')) {
    return parseYamlSequence(lines, state, indent);
  }

  return parseYamlMapping(lines, state, indent);
}

function parseYamlMapping(lines: YamlLine[], state: ParseState, indent: number): YamlObject {
  const result: YamlObject = {};

  while (state.index < lines.length) {
    const line = lines[state.index]!;

    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      state.index += 1;
      continue;
    }

    if (line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    parseYamlMappingEntry(result, line.text, indent, lines, state);
  }

  return result;
}

function parseYamlMappingEntry(
  target: YamlObject,
  text: string,
  indent: number,
  lines: YamlLine[],
  state: ParseState,
): void {
  const separatorIndex = findYamlSeparator(text);
  if (separatorIndex < 0) {
    return;
  }

  const key = text.slice(0, separatorIndex).trim();
  const rawValue = text.slice(separatorIndex + 1).trim();

  if (rawValue.length > 0) {
    target[key] = parseYamlScalar(rawValue);
    return;
  }

  const next = lines[state.index];
  if (!next || next.indent <= indent) {
    target[key] = {};
    return;
  }

  target[key] = parseYamlBlock(lines, state, next.indent);
}

function parseYamlSequence(lines: YamlLine[], state: ParseState, indent: number): YamlArray {
  const result: YamlArray = [];

  while (state.index < lines.length) {
    const line = lines[state.index]!;

    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    const itemText = line.text.slice(2).trim();

    if (itemText.length === 0) {
      const next = lines[state.index];
      if (next && next.indent > indent) {
        result.push(parseYamlBlock(lines, state, next.indent));
      } else {
        result.push(null);
      }
      continue;
    }

    const separatorIndex = findYamlSeparator(itemText);
    if (separatorIndex >= 0) {
      result.push(parseYamlSequenceObjectItem(itemText, indent + 2, lines, state));
      continue;
    }

    result.push(parseYamlScalar(itemText));
  }

  return result;
}

function parseYamlSequenceObjectItem(
  firstLine: string,
  indent: number,
  lines: YamlLine[],
  state: ParseState,
): YamlObject {
  const result: YamlObject = {};
  parseYamlMappingEntry(result, firstLine, indent, lines, state);

  while (state.index < lines.length) {
    const line = lines[state.index]!;

    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      state.index += 1;
      continue;
    }

    if (line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    parseYamlMappingEntry(result, line.text, indent, lines, state);
  }

  return result;
}

function parseYamlScalar(rawValue: string): YamlValue {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }

    return splitInlineYamlCollection(inner).map((item) => parseYamlScalar(item));
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) {
      return {};
    }

    const objectValue: YamlObject = {};
    for (const item of splitInlineYamlCollection(inner)) {
      const separatorIndex = findYamlSeparator(item);
      if (separatorIndex < 0) continue;
      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      objectValue[key] = parseYamlScalar(value);
    }
    return objectValue;
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);

  return trimmed;
}

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd();
    }
  }

  return line;
}

function findYamlSeparator(text: string): number {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === ':' && !inSingle && !inDouble) {
      const next = text[i + 1];
      if (next !== undefined && !/\s/.test(next)) {
        continue;
      }
      return i;
    }
  }

  return -1;
}

function splitInlineYamlCollection(content: string): string[] {
  const result: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;

  for (const char of content) {
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (char === '[' || char === '{') {
        depth += 1;
      } else if (char === ']' || char === '}') {
        depth -= 1;
      } else if (char === ',' && depth === 0) {
        if (current.trim().length > 0) {
          result.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim().length > 0) {
    result.push(current.trim());
  }

  return result;
}

function isYamlObject(value: YamlValue): value is YamlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
