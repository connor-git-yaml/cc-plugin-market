/**
 * AbstractArtifactParser<T> — 非代码制品解析器的抽象基类
 *
 * 封装三个 Parser 的共通逻辑：
 * - 容错读取：try-catch 包裹文件读取和解析
 * - 降级返回：异常时调用 createFallback() 返回空但合法的结果
 * - parseAll 默认实现：Promise.all 并发调用 parse()
 *
 * 子类只需实现 doParse(content, filePath) 和 createFallback()。
 */
import * as fs from 'node:fs';
import type { ArtifactParser } from '../interfaces.js';

/**
 * 非代码制品解析器抽象基类
 * 实现 ArtifactParser<T> 接口的通用容错逻辑
 *
 * @typeParam T - parse 步骤的输出数据结构
 */
export abstract class AbstractArtifactParser<T> implements ArtifactParser<T> {
  /** 唯一标识符（如 'skill-md'、'dockerfile'） */
  abstract readonly id: string;

  /** 显示名称（如 'SKILL.md Parser'） */
  abstract readonly name: string;

  /** 支持的文件匹配模式，glob 格式 */
  abstract readonly filePatterns: readonly string[];

  /**
   * 子类实现：从文件内容解析为结构化数据
   *
   * @param content - 文件内容字符串（UTF-8）
   * @param filePath - 文件绝对路径（用于格式检测等）
   * @returns 结构化解析结果
   */
  protected abstract doParse(content: string, filePath: string): T;

  /**
   * 子类实现：提供降级结果
   * 当文件读取失败或解析异常时返回此结果
   *
   * @returns 空但合法的类型实例
   */
  protected abstract createFallback(): T;

  /**
   * 统一的容错解析入口
   * try-catch 包裹文件读取和 doParse()，任何异常均降级
   *
   * @param filePath - 制品文件绝对路径
   * @returns 结构化解析结果（正常或降级）
   */
  async parse(filePath: string): Promise<T> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      // 统一换行符为 LF，确保 CRLF 环境下正则解析正确
      const content = raw.replace(/\r\n/g, '\n');
      return this.doParse(content, filePath);
    } catch {
      return this.createFallback();
    }
  }

  /**
   * 默认的批量解析实现
   * Promise.all 并发调用 parse()，因为每个 parse() 内部已有容错
   * 返回与输入数组等长的结果数组
   *
   * @param filePaths - 制品文件路径数组
   * @returns 解析结果数组
   */
  async parseAll(filePaths: string[]): Promise<T[]> {
    return Promise.all(filePaths.map((fp) => this.parse(fp)));
  }
}
