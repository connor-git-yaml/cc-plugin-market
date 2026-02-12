/**
 * 噪声过滤器
 * 从漂移结果中移除非实质性变更（FR-021）
 * 参见 contracts/diff-engine.md
 */
import type { DriftItem } from '../models/drift-item.js';

export interface FilterResult {
  /** 需要报告的有意义变更 */
  substantive: DriftItem[];
  /** 被移除的噪声项计数 */
  filtered: number;
  /** itemId → 过滤原因 */
  filterReasons: Map<string, string>;
}

/**
 * 规范化文本用于比较（移除噪声差异）
 */
function normalizeForComparison(text: string): string {
  return text
    // 移除所有注释
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 规范化空白
    .replace(/\s+/g, ' ')
    // 移除尾逗号
    .replace(/,\s*([}\])])/g, '$1')
    // 移除分号（ASI 等价）
    .replace(/;/g, '')
    // 移除前后空白
    .trim();
}

/**
 * 检测是否仅为 import 重排序
 */
function isImportReorder(oldValue: string | null, newValue: string | null): boolean {
  if (!oldValue || !newValue) return false;

  // 提取 import 语句
  const importRe = /import\s+(?:type\s+)?(?:{[^}]+}|[\w*]+)\s+from\s+['"][^'"]+['"]/g;
  const oldImports = (oldValue.match(importRe) ?? []).sort();
  const newImports = (newValue.match(importRe) ?? []).sort();

  if (oldImports.length === 0 || newImports.length === 0) return false;

  return oldImports.length === newImports.length &&
    oldImports.every((imp, i) => imp === newImports[i]);
}

/**
 * 从漂移结果中移除非实质性变更
 *
 * @param items - 原始漂移项
 * @param oldContent - 旧版源代码
 * @param newContent - 新版源代码
 * @returns 过滤结果
 */
export function filterNoise(
  items: DriftItem[],
  oldContent: string,
  newContent: string,
): FilterResult {
  const substantive: DriftItem[] = [];
  const filterReasons = new Map<string, string>();

  for (const item of items) {
    let isNoise = false;
    let reason = '';

    // 规则 1：仅空白字符变更
    if (item.oldValue && item.newValue) {
      const normalizedOld = normalizeForComparison(item.oldValue);
      const normalizedNew = normalizeForComparison(item.newValue);

      if (normalizedOld === normalizedNew) {
        isNoise = true;
        reason = '仅空白/注释/分号/尾逗号变更';
      }
    }

    // 规则 2：import 重排序
    if (!isNoise && isImportReorder(item.oldValue ?? null, item.newValue ?? null)) {
      isNoise = true;
      reason = 'import 重排序（相同 import，不同顺序）';
    }

    if (isNoise) {
      filterReasons.set(item.id, reason);
    } else {
      substantive.push(item);
    }
  }

  return {
    substantive,
    filtered: filterReasons.size,
    filterReasons,
  };
}
