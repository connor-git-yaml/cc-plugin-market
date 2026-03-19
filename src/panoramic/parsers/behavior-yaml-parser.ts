/**
 * BehaviorYamlParser — 行为定义文件解析器
 *
 * 支持两种格式：
 * 1. YAML 格式：逐行正则解析 key:value + 嵌套列表
 * 2. Markdown 格式：标题分段 + 列表项提取
 *
 * 格式检测策略：
 * - .yaml/.yml 扩展名 -> YAML 模式
 * - .md 扩展名 -> Markdown 模式
 * - 扩展名不明确时，检查内容特征
 *
 * 容错降级：解析失败返回 { states: [] }
 */
import * as path from 'node:path';
import { AbstractArtifactParser } from './abstract-artifact-parser.js';
import type { BehaviorInfo, BehaviorState } from './types.js';

/** 格式类型 */
type FormatType = 'yaml' | 'markdown';

/** YAML 顶层键匹配正则（无缩进的 key:） */
const YAML_TOP_KEY_RE = /^([a-zA-Z_][\w-]*):\s*$/;

/** YAML description 行匹配正则 */
const YAML_DESCRIPTION_RE = /^\s+description:\s*(.+)$/;

/** YAML actions 标记匹配正则 */
const YAML_ACTIONS_RE = /^\s+actions:\s*$/;

/** YAML 列表项匹配正则 */
const YAML_LIST_ITEM_RE = /^\s+-\s+(.+)$/;

/** Markdown 二级标题匹配正则 */
const MD_H2_RE = /^##\s+(.+)$/;

/** Markdown 列表项匹配正则（- 或 *） */
const MD_LIST_ITEM_RE = /^[-*]\s+(.+)$/;

/**
 * 行为定义文件解析器
 * 实现 ArtifactParser<BehaviorInfo> 接口
 */
export class BehaviorYamlParser extends AbstractArtifactParser<BehaviorInfo> {
  readonly id = 'behavior-yaml' as const;
  readonly name = 'Behavior YAML Parser' as const;
  readonly filePatterns = [
    '**/behavior/**/*.yaml',
    '**/behavior/**/*.yml',
    '**/behavior/**/*.md',
  ] as const;

  /**
   * 从 behavior 文件内容解析为结构化数据
   */
  protected doParse(content: string, filePath: string): BehaviorInfo {
    // 空内容直接返回降级结果
    if (!content.trim()) {
      return this.createFallback();
    }

    const format = this.detectFormat(content, filePath);

    try {
      if (format === 'yaml') {
        return this.parseYaml(content);
      }
      return this.parseMarkdown(content);
    } catch {
      return this.createFallback();
    }
  }

  /**
   * 降级结果
   */
  protected createFallback(): BehaviorInfo {
    return { states: [] };
  }

  /**
   * 检测内容格式
   */
  private detectFormat(content: string, filePath: string): FormatType {
    const ext = path.extname(filePath).toLowerCase();

    // 按扩展名判断
    if (ext === '.yaml' || ext === '.yml') return 'yaml';
    if (ext === '.md') return 'markdown';

    // 扩展名不明确时，检查内容特征
    // 如果包含 Markdown 标题（##），判定为 Markdown
    if (/^#{1,2}\s+/m.test(content)) return 'markdown';

    // 默认按 YAML 处理
    return 'yaml';
  }

  /**
   * YAML 格式解析
   * 逐行正则解析，识别顶层键作为 state name，嵌套 description 和 actions 列表
   */
  private parseYaml(content: string): BehaviorInfo {
    const states: BehaviorState[] = [];
    const lines = content.split('\n');

    let currentState: BehaviorState | null = null;
    let inActions = false;

    for (const line of lines) {
      // 跳过空行
      if (line.trim() === '') {
        continue;
      }

      // 检测顶层键（新状态开始）
      const topKeyMatch = YAML_TOP_KEY_RE.exec(line);
      if (topKeyMatch) {
        // 保存前一个状态
        if (currentState) {
          states.push(currentState);
        }
        currentState = {
          name: topKeyMatch[1]!,
          description: '',
          actions: [],
        };
        inActions = false;
        continue;
      }

      if (!currentState) continue;

      // 检测 description 字段
      const descMatch = YAML_DESCRIPTION_RE.exec(line);
      if (descMatch) {
        currentState.description = descMatch[1]!.trim();
        inActions = false;
        continue;
      }

      // 检测 actions 标记
      if (YAML_ACTIONS_RE.test(line)) {
        inActions = true;
        continue;
      }

      // 检测列表项（actions 下的 - item）
      if (inActions) {
        const listMatch = YAML_LIST_ITEM_RE.exec(line);
        if (listMatch) {
          currentState.actions.push(listMatch[1]!.trim());
        }
      }
    }

    // 保存最后一个状态
    if (currentState) {
      states.push(currentState);
    }

    return { states };
  }

  /**
   * Markdown 格式解析
   * 按二级标题分段，段落作为 description，列表项作为 actions
   */
  private parseMarkdown(content: string): BehaviorInfo {
    const states: BehaviorState[] = [];
    const lines = content.split('\n');

    let currentState: BehaviorState | null = null;

    for (const line of lines) {
      // 检测二级标题（新状态开始）
      const h2Match = MD_H2_RE.exec(line);
      if (h2Match) {
        // 保存前一个状态
        if (currentState) {
          // trim description
          currentState.description = currentState.description.trim();
          states.push(currentState);
        }
        currentState = {
          name: h2Match[1]!.trim(),
          description: '',
          actions: [],
        };
        continue;
      }

      if (!currentState) continue;

      // 检测列表项
      const listMatch = MD_LIST_ITEM_RE.exec(line.trim());
      if (listMatch) {
        currentState.actions.push(listMatch[1]!.trim());
        continue;
      }

      // 非空行、非标题、非列表项 -> 追加到 description
      const trimmed = line.trim();
      if (trimmed) {
        if (currentState.description) {
          currentState.description += ' ' + trimmed;
        } else {
          currentState.description = trimmed;
        }
      }
    }

    // 保存最后一个状态
    if (currentState) {
      currentState.description = currentState.description.trim();
      states.push(currentState);
    }

    return { states };
  }
}
