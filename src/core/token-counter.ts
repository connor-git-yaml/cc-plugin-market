/**
 * Token 计数与预算控制
 * 两阶段策略：快速字符估算 + 精确计数（带 LRU 缓存）
 * 参见 research R5
 */
import { createHash } from 'node:crypto';

/** CJK 字符范围检测正则 */
const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff00-\uffef]/;

/** 缓存条目 */
interface CacheEntry {
  count: number;
  lastAccessed: number;
}

/** 基于哈希的 LRU 缓存 */
const cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 1000;

/**
 * 计算文本的 SHA-256 哈希（用于缓存 key）
 */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * 清理最久未访问的缓存条目
 */
function evictCache(): void {
  if (cache.size <= MAX_CACHE_SIZE) return;

  // 按 lastAccessed 排序，移除最早的
  const entries = [...cache.entries()].sort(
    (a, b) => a[1].lastAccessed - b[1].lastAccessed,
  );

  const toRemove = entries.slice(0, cache.size - MAX_CACHE_SIZE);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

/**
 * 快速 token 估算（基于字符）
 * 约 0.01ms，±15% 精度，支持 CJK 字符
 *
 * @param text - 待估算文本
 * @returns 估算的 token 数
 */
export function estimateFast(text: string): number {
  if (!text) return 0;

  const hasCJK = CJK_RE.test(text);
  const charsPerToken = hasCJK ? 2.5 : 3.8;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * 精确 token 计数（带缓存）
 * 首次调用约 1-5ms，后续从缓存读取
 *
 * 注：当前使用基于词的估算作为"精确"方法
 * 后续可替换为 @anthropic-ai/tokenizer 或 tiktoken
 *
 * @param text - 待计数文本
 * @returns 精确的 token 数
 */
export async function countAccurate(text: string): Promise<number> {
  if (!text) return 0;

  const hash = hashText(text);

  // 缓存命中
  const cached = cache.get(hash);
  if (cached) {
    cached.lastAccessed = Date.now();
    return cached.count;
  }

  // 基于词的精确估算
  // 按空白和标点分割，每个词约 1.3 token（代码场景）
  const count = countByWords(text);

  // 写入缓存
  cache.set(hash, { count, lastAccessed: Date.now() });
  evictCache();

  return count;
}

/**
 * 基于词的 token 计数
 * 比纯字符估算更精确（±5-10%）
 */
function countByWords(text: string): number {
  let cjkCount = 0;
  let nonCjkLength = 0;

  for (const char of text) {
    if (CJK_RE.test(char)) {
      cjkCount++;
    } else {
      nonCjkLength++;
    }
  }

  // CJK 字符：每个约 1-2 token（取 1.5）
  // 非 CJK：基于词计算
  const cjkTokens = cjkCount * 1.5;

  // 提取非 CJK 部分的词数
  const nonCjkText = text.replace(CJK_RE, ' ');
  const words = nonCjkText.split(/\s+/).filter(Boolean);

  // 代码中的词平均约 1.3 token（含标点、运算符等子词）
  const nonCjkTokens = words.length * 1.3;

  return Math.ceil(cjkTokens + nonCjkTokens);
}

/**
 * 快速预算检查
 * 使用快速估算 + 15% 安全余量
 *
 * @param text - 待检查文本
 * @param budget - token 预算
 * @returns 是否在预算内
 */
export function fitsInBudget(text: string, budget: number): boolean {
  const estimated = estimateFast(text);
  const withMargin = estimated * 1.15; // 15% 安全余量
  return withMargin <= budget;
}

/**
 * 清空缓存（测试用）
 */
export function clearCache(): void {
  cache.clear();
}
