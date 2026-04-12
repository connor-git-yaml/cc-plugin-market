/**
 * 文件级提取结果缓存（Feature 107）
 * 基于 SHA256(content body + absolutePath) 的哈希缓存
 * 参考 Graphify cache.py 的 SHA256(body + path) 策略
 *
 * 缓存路径：{outputDir}/_meta/extraction-cache/{hash}.json
 * 写入方式：原子 rename（复用 writeAtomicJson）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { writeAtomicJson } from '../utils/atomic-write.js';
import type { ExtractionResult } from './extraction-types.js';
import { ExtractionResultSchema } from './extraction-types.js';

// ============================================================
// 缓存条目类型（内部）
// ============================================================

interface ExtractionCacheEntry {
  /** 文件绝对路径（用于 debug，不用于 cache lookup） */
  filePath: string;
  /** 缓存写入时间（ISO 8601） */
  cachedAt: string;
  /** 提取结果 */
  result: ExtractionResult;
}

// ============================================================
// Frontmatter 剥离（Markdown 文件专用）
// ============================================================

/**
 * 剥离 Markdown frontmatter，返回 body 部分
 * 仅当内容以 "---\n" 开头时进行剥离，否则原样返回
 * 目的：frontmatter 变化（如 lastUpdated）不触发重新提取
 */
function stripMarkdownFrontmatter(content: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return content;
  }

  // 查找第二个 "---" 分隔符
  const firstDash = content.indexOf('---\n', 3);
  const firstDashCR = content.indexOf('---\r\n', 3);
  const endIdx = firstDash !== -1
    ? (firstDashCR !== -1 ? Math.min(firstDash, firstDashCR) : firstDash)
    : firstDashCR;

  if (endIdx === -1) {
    // 未找到闭合分隔符，原样返回
    return content;
  }

  // 返回 frontmatter 之后的内容
  const afterClose = content.indexOf('\n', endIdx);
  return afterClose !== -1 ? content.slice(afterClose + 1) : content;
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 计算文件提取哈希
 * 策略：SHA256(body + absolutePath)
 * Markdown 文件剥离 frontmatter 后计算（frontmatter 变化不影响 hash）
 *
 * @param filePath - 文件绝对路径（纳入哈希，确保同内容不同路径的缓存独立）
 * @param content - 文件完整内容
 * @param isMarkdown - 是否剥离 frontmatter（默认 false）
 * @returns 64 位十六进制 SHA256 哈希字符串
 */
export function fileExtractHash(filePath: string, content: string, isMarkdown = false): string {
  const body = isMarkdown ? stripMarkdownFrontmatter(content) : content;
  // SHA256(body + absolutePath) 保证：内容相同但路径不同时缓存独立
  const input = body + path.resolve(filePath);
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

/**
 * 缓存目录路径
 */
function cacheDirPath(outputDir: string): string {
  return path.join(outputDir, '_meta', 'extraction-cache');
}

/**
 * 缓存文件路径
 */
function cacheFilePath(outputDir: string, hash: string): string {
  return path.join(cacheDirPath(outputDir), `${hash}.json`);
}

/**
 * 加载文件提取缓存
 * 命中返回已验证的 ExtractionResult，未命中或损坏返回 null
 *
 * @param hash - 文件提取哈希（由 fileExtractHash 生成）
 * @param outputDir - 输出目录（绝对路径）
 * @returns 缓存的 ExtractionResult，或 null（未命中）
 */
export function loadExtractCache(hash: string, outputDir: string): ExtractionResult | null {
  const filePath = cacheFilePath(outputDir, hash);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(content) as ExtractionCacheEntry;
    // 使用 Zod 验证缓存结果，防止旧版本缓存格式不兼容
    const parsed = ExtractionResultSchema.safeParse(entry.result);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    // 文件损坏或格式不兼容，视为未命中
    return null;
  }
}

/**
 * 保存文件提取缓存
 * 使用原子写入防止写入中断导致数据损坏
 *
 * @param hash - 文件提取哈希
 * @param outputDir - 输出目录（绝对路径）
 * @param result - 要缓存的提取结果
 * @param filePath - 来源文件路径（用于 debug 标注，不影响 cache lookup）
 */
export async function saveExtractCache(
  hash: string,
  outputDir: string,
  result: ExtractionResult,
  filePath = '',
): Promise<void> {
  const entry: ExtractionCacheEntry = {
    filePath,
    cachedAt: new Date().toISOString(),
    result,
  };
  const targetPath = cacheFilePath(outputDir, hash);
  writeAtomicJson(targetPath, entry);
}
