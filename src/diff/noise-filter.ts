/**
 * 噪声过滤器
 * 从漂移结果中移除非实质性变更（FR-021）
 * 支持多语言注释和 import 模式（FR-026）
 * 参见 contracts/diff-engine.md
 */
import type { DriftItem } from '../models/drift-item.js';
import type { Language } from '../models/code-skeleton.js';

export interface FilterResult {
  /** 需要报告的有意义变更 */
  substantive: DriftItem[];
  /** 被移除的噪声项计数 */
  filtered: number;
  /** itemId → 过滤原因 */
  filterReasons: Map<string, string>;
}

/**
 * 移除代码中的注释（根据语言选择模式）
 */
function stripComments(text: string, language?: Language): string {
  let result = text;

  // C 风格注释（JS/TS/Java/Go/Rust/Kotlin/C++/Swift）
  const cStyleLanguages = new Set<string | undefined>([
    undefined, 'typescript', 'javascript', 'java', 'go', 'rust', 'kotlin', 'cpp', 'swift',
  ]);

  // Python/Ruby 使用 # 注释
  const hashCommentLanguages = new Set<string | undefined>(['python', 'ruby']);

  if (cStyleLanguages.has(language)) {
    result = result
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  }

  if (hashCommentLanguages.has(language)) {
    // 移除 # 注释（但排除字符串内的 #，此处简化处理行首 #）
    result = result.replace(/#.*$/gm, '');
  }

  return result;
}

/**
 * 规范化文本用于比较（移除噪声差异）
 *
 * @param text - 待规范化的代码文本
 * @param language - 代码语言（可选，影响注释和语法模式）
 */
function normalizeForComparison(text: string, language?: Language): string {
  let result = stripComments(text, language);

  // 规范化空白
  result = result.replace(/\s+/g, ' ');

  // 语言特定的语法糖规范化
  if (!language || language === 'typescript' || language === 'javascript') {
    // JS/TS: 移除尾逗号和分号（ASI 等价）
    result = result.replace(/,\s*([}\])])/g, '$1');
    result = result.replace(/;/g, '');
  } else if (language === 'go') {
    // Go: 移除尾逗号
    result = result.replace(/,\s*([}\])])/g, '$1');
  }

  return result.trim();
}

/**
 * 获取语言对应的 import 提取正则
 */
function getImportRegex(language?: Language): RegExp {
  switch (language) {
    case 'python':
      // Python: import xxx 或 from xxx import yyy
      return /(?:from\s+\S+\s+import\s+.+|import\s+\S+)/g;
    case 'go':
      // Go: import "xxx" 或 import (多行)
      return /import\s+(?:"[^"]+"|[\w.]+)/g;
    case 'java':
    case 'kotlin':
      // Java/Kotlin: import xxx.yyy.zzz
      return /import\s+(?:static\s+)?[\w.]+\s*;?/g;
    case 'rust':
      // Rust: use xxx::yyy
      return /use\s+[\w:]+(?:::\{[^}]+\})?/g;
    default:
      // JS/TS: import { xxx } from 'yyy'
      return /import\s+(?:type\s+)?(?:\{[^}]+\}|[\w*]+)\s+from\s+['"][^'"]+['"]/g;
  }
}

/**
 * 检测是否仅为 import 重排序
 *
 * @param oldValue - 旧代码片段
 * @param newValue - 新代码片段
 * @param language - 代码语言（可选）
 */
function isImportReorder(
  oldValue: string | null,
  newValue: string | null,
  language?: Language,
): boolean {
  if (!oldValue || !newValue) return false;

  const importRe = getImportRegex(language);
  // 每次调用需新建正则实例（避免 /g 状态问题）
  const oldImports = (oldValue.match(new RegExp(importRe.source, importRe.flags)) ?? []).sort();
  const newImports = (newValue.match(new RegExp(importRe.source, importRe.flags)) ?? []).sort();

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
 * @param language - 代码语言（可选，用于语言感知过滤）
 * @returns 过滤结果
 */
export function filterNoise(
  items: DriftItem[],
  oldContent: string,
  newContent: string,
  language?: Language,
): FilterResult {
  const substantive: DriftItem[] = [];
  const filterReasons = new Map<string, string>();

  for (const item of items) {
    let isNoise = false;
    let reason = '';

    // 规则 1：仅空白字符变更
    if (item.oldValue && item.newValue) {
      const normalizedOld = normalizeForComparison(item.oldValue, language);
      const normalizedNew = normalizeForComparison(item.newValue, language);

      if (normalizedOld === normalizedNew) {
        isNoise = true;
        reason = '仅空白/注释/分号/尾逗号变更';
      }
    }

    // 规则 2：import 重排序
    if (!isNoise && isImportReorder(item.oldValue ?? null, item.newValue ?? null, language)) {
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
