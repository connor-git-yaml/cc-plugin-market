/**
 * 内容哈希引擎
 * 使用 Node.js 原生 crypto.createHash('sha256') 计算文件和内容哈希
 * 对 .md 文件自动跳过 frontmatter 区域，只哈希正文
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ============================================================
// ContentHasher 接口
// ============================================================

/**
 * 内容哈希计算接口
 */
export interface ContentHasher {
  /**
   * 计算单个文件的 SHA256 哈希
   * 对 .md 文件自动跳过 frontmatter 区域，只哈希正文
   * @param filePath 文件绝对路径
   * @returns SHA256 hex 字符串
   */
  hashFile(filePath: string): Promise<string>;

  /**
   * 计算文件集合的聚合哈希（各文件 hash 排序后合并再次 hash）
   * @param filePaths 文件绝对路径列表
   * @returns 聚合后的 SHA256 hex 字符串
   */
  hashFiles(filePaths: string[]): Promise<string>;

  /**
   * 计算字符串内容的 SHA256 哈希
   * @param content 任意字符串
   * @returns SHA256 hex 字符串
   */
  hashContent(content: string): string;
}

// ============================================================
// frontmatter 处理
// ============================================================

/** 扫描 frontmatter 闭合标记的最大行数 */
const FRONTMATTER_SCAN_LIMIT = 50;

/**
 * 从 Markdown 内容中剥离 frontmatter，返回正文
 *
 * 边界规则（来自 spec clarifications）：
 * 1. 首行不是 `---`：返回原文（无 frontmatter）
 * 2. 首行是 `---`：从第 2 行开始扫描，找到仅含 `---` 的行即为闭合标记，返回其后正文
 * 3. 扫描超过第 50 行仍未找到闭合：降级返回原文（未闭合 frontmatter）
 */
function stripFrontmatter(content: string): string {
  const lines = content.split('\n');

  // 首行不是 --- → 无 frontmatter，返回全文
  if (lines.length === 0 || lines[0]?.trim() !== '---') {
    return content;
  }

  // 从第 2 行开始查找闭合 ---
  const scanLimit = Math.min(lines.length, FRONTMATTER_SCAN_LIMIT);
  for (let i = 1; i < scanLimit; i++) {
    if (lines[i]?.trim() === '---') {
      // 找到闭合标记，返回其后的正文
      return lines.slice(i + 1).join('\n');
    }
  }

  // 50 行内未找到闭合标记 → 降级返回全文
  return content;
}

// ============================================================
// ContentHasherImpl 实现
// ============================================================

/**
 * ContentHasher 的默认实现
 * 使用 node:crypto 的 SHA256 哈希
 */
export class ContentHasherImpl implements ContentHasher {
  /**
   * 计算单个文件的 SHA256 哈希
   * 对 .md 扩展名的文件，先剥离 frontmatter 再哈希
   * 哈希输入为 filePath + content（确保不同路径的相同内容产生不同 hash）
   */
  async hashFile(filePath: string): Promise<string> {
    const rawContent = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    // .md 文件跳过 frontmatter
    const content = ext === '.md' ? stripFrontmatter(rawContent) : rawContent;

    return crypto
      .createHash('sha256')
      .update(filePath + content)
      .digest('hex');
  }

  /**
   * 计算文件集合的聚合哈希
   * 并发计算各文件 hash，按 filePath 排序后拼接再次 SHA256
   * 保证文件集合相同、顺序不同时结果一致
   */
  async hashFiles(filePaths: string[]): Promise<string> {
    // 按路径排序，确保顺序一致
    const sortedPaths = [...filePaths].sort();

    // 并发计算各文件 hash
    const hashes = await Promise.all(
      sortedPaths.map((p) => this.hashFile(p)),
    );

    // 拼接所有 hash 再次 SHA256
    const combined = hashes.join('');
    return crypto
      .createHash('sha256')
      .update(combined)
      .digest('hex');
  }

  /**
   * 计算字符串内容的 SHA256 哈希（同步）
   */
  hashContent(content: string): string {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
  }
}
