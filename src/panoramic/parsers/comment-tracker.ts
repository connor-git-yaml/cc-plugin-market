/**
 * CommentTracker — 注释行累积跟踪器
 *
 * 配置文件 Parser（YAML/ENV/TOML）在逐行解析时需要：
 * - 累积连续注释行（空格连接）
 * - 遇到空行时重置
 * - 遇到配置项时消费已累积的注释作为 description
 *
 * 本类封装此通用逻辑，消除三个 Parser 中的重复代码。
 */

/**
 * 注释行累积跟踪器
 * 维护一个 pending 注释缓冲区，提供 append / consume / reset 操作
 */
export class CommentTracker {
  private pending = '';

  /**
   * 重置注释缓冲区
   * 在空行或非关联行时调用
   */
  reset(): void {
    this.pending = '';
  }

  /**
   * 追加注释行内容
   * 多行注释之间以空格连接
   *
   * @param commentLine - 去除注释标记后的文本内容
   */
  append(commentLine: string): void {
    if (this.pending) {
      this.pending += ' ' + commentLine;
    } else {
      this.pending = commentLine;
    }
  }

  /**
   * 消费并返回累积的注释内容
   * 调用后缓冲区自动清空
   *
   * @returns 累积的注释文本（无注释时为空字符串）
   */
  consume(): string {
    const result = this.pending;
    this.pending = '';
    return result;
  }
}
