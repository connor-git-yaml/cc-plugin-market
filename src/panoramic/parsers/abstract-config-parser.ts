/**
 * AbstractConfigParser — 配置文件 Parser 的抽象基类
 *
 * 进一步封装 YAML/ENV/TOML 三个配置 Parser 的共同逻辑：
 * - 空内容检测和降级返回
 * - 统一的 createFallback() 实现（返回 { entries: [] }）
 * - 子类只需实现 parseContent(content) 返回 ConfigEntry[]
 *
 * 继承链: AbstractConfigParser -> AbstractArtifactParser -> ArtifactParser
 */
import { AbstractArtifactParser } from './abstract-artifact-parser.js';
import type { ConfigEntries, ConfigEntry } from './types.js';

/**
 * 配置文件 Parser 抽象基类
 * 封装空内容检测和统一降级逻辑
 */
export abstract class AbstractConfigParser extends AbstractArtifactParser<ConfigEntries> {
  /**
   * 子类实现：从非空配置文件内容解析为 ConfigEntry 数组
   *
   * @param content - 文件内容字符串（已确保非空）
   * @returns 配置项数组
   */
  protected abstract parseContent(content: string): ConfigEntry[];

  /**
   * 从配置文件内容解析为结构化数据
   * 空内容直接返回降级结果，非空内容委托给 parseContent()
   */
  protected doParse(content: string, _filePath: string): ConfigEntries {
    if (!content.trim()) {
      return this.createFallback();
    }
    return { entries: this.parseContent(content) };
  }

  /**
   * 降级结果：空配置项数组
   */
  protected createFallback(): ConfigEntries {
    return { entries: [] };
  }
}
