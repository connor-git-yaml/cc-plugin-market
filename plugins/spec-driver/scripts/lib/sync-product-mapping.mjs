/**
 * sync-product-mapping.mjs — 产品映射模块
 *
 * 负责 product-mapping.yaml 的解析、修正、差集检测和序列化。
 * 所有导出函数均为纯函数（无副作用），文件 I/O 仅在入口脚本中完成。
 *
 * @module sync-product-mapping
 */

import { parseYamlDocument, stringifyYaml } from './simple-yaml.mjs';

// ────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────

/**
 * 已知的产品名自动修正规则。
 * key 为旧名，value 为新名。
 * @type {Record<string, string>}
 */
export const NAME_CORRECTION_RULES = {
  'spec-driverdriver': 'spec-driver',
  'spec-driver-driver-pro': 'spec-driver',
};

// ────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────

/**
 * 判断值是否为非数组对象
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深拷贝简单 JSON 兼容对象（无函数、无循环引用）
 * @param {unknown} value
 * @returns {unknown}
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    result[key] = deepClone(value[key]);
  }
  return result;
}

// ────────────────────────────────────────────────────────────
// 导出函数
// ────────────────────────────────────────────────────────────

/**
 * 解析 product-mapping.yaml 内容为 ProductMapping 对象。
 *
 * @param {string} yamlContent — YAML 字符串
 * @returns {{ products: Record<string, { description: string, specs: string[] }> }}
 *   ProductMapping 对象；输入为空或解析失败时返回 { products: {} }
 */
export function parseProductMapping(yamlContent) {
  if (!yamlContent || typeof yamlContent !== 'string') {
    return { products: {} };
  }

  let document;
  try {
    document = parseYamlDocument(yamlContent);
  } catch {
    return { products: {} };
  }

  if (!isObject(document) || !isObject(document.products)) {
    return { products: {} };
  }

  const products = {};

  for (const [productId, rawProduct] of Object.entries(document.products)) {
    const product = isObject(rawProduct) ? rawProduct : {};
    const description = typeof product.description === 'string' ? product.description : '';

    // specs 列表：支持两种格式
    // 格式 A（当前）：[{ id: "001-reverse-spec-v2", type: "INITIAL", summary: "..." }, ...]
    // 格式 B（简化）：["001", "002", ...] 或 ["001-reverse-spec-v2", ...]
    // 统一提取为纯数字编号（如 "001"）
    let specs = [];
    if (Array.isArray(product.specs)) {
      specs = product.specs
        .map((entry) => {
          let rawId = null;
          if (typeof entry === 'string') {
            rawId = entry;
          } else if (isObject(entry) && typeof entry.id === 'string') {
            rawId = entry.id;
          }
          if (!rawId) return null;
          // 从 "001-reverse-spec-v2" 提取纯数字编号 "001"
          const numMatch = /^(\d{3})/.exec(rawId);
          return numMatch ? numMatch[1] : rawId;
        })
        .filter(Boolean);
    }

    products[productId] = { description, specs };
  }

  return { products };
}

/**
 * 执行产品名自动修正。
 * 若 mapping 中存在旧名 key，将其 specs 合并到新名 key 下（去重），删除旧名条目。
 *
 * 纯函数：不修改输入对象，返回新的 ProductMapping。
 *
 * @param {{ products: Record<string, { description: string, specs: string[] }> }} mapping
 * @param {Record<string, string>} [rules=NAME_CORRECTION_RULES] — 修正规则
 * @returns {{ products: Record<string, { description: string, specs: string[] }> }}
 */
export function correctProductNames(mapping, rules = NAME_CORRECTION_RULES) {
  const result = deepClone(mapping);

  for (const [oldName, newName] of Object.entries(rules)) {
    if (!result.products[oldName]) {
      continue;
    }

    const oldEntry = result.products[oldName];

    // 如果新名已存在，合并 specs（去重）
    if (result.products[newName]) {
      const existingSpecs = new Set(result.products[newName].specs);
      for (const specId of oldEntry.specs) {
        existingSpecs.add(specId);
      }
      result.products[newName].specs = [...existingSpecs].sort();
    } else {
      // 新名不存在，直接改名
      result.products[newName] = { ...oldEntry };
    }

    // 删除旧名条目
    delete result.products[oldName];
  }

  return result;
}

/**
 * 检测未映射的 spec。
 * 计算差集：scannedSpecs 中的 specId 不在任何产品的 specs 列表中。
 *
 * @param {{ products: Record<string, { description: string, specs: string[] }> }} mapping
 * @param {Array<{ id: string, dirName: string, title: string|null, summary: string|null }>} scannedSpecs
 * @returns {Array<{ specId: string, dirName: string, title: string|null, summary: string|null }>}
 *   UnmappedSpec[]
 */
export function detectUnmappedSpecs(mapping, scannedSpecs) {
  // 收集所有已映射的 spec 编号
  const mappedIds = new Set();
  for (const productDef of Object.values(mapping.products)) {
    for (const specId of productDef.specs) {
      mappedIds.add(specId);
    }
  }

  // 筛选未映射的 spec
  return scannedSpecs
    .filter((entry) => !mappedIds.has(entry.id))
    .map((entry) => ({
      specId: entry.id,
      dirName: entry.dirName,
      title: entry.title ?? null,
      summary: entry.summary ?? null,
    }));
}

/**
 * 将 Agent 归属决策的未映射 spec 合并到 mapping 中。
 *
 * 纯函数：不修改输入对象，返回新的 ProductMapping。
 *
 * @param {{ products: Record<string, { description: string, specs: string[] }> }} mapping
 * @param {Array<{ specId: string, dirName: string }>} unmappedSpecs
 * @param {Record<string, string>} agentDecisions — 键为 specId，值为 productId
 * @returns {{ products: Record<string, { description: string, specs: string[] }> }}
 */
export function mergeUnmappedSpecs(mapping, unmappedSpecs, agentDecisions) {
  const result = deepClone(mapping);

  for (const spec of unmappedSpecs) {
    const targetProduct = agentDecisions[spec.specId];
    if (!targetProduct) {
      continue;
    }

    // 确保产品存在
    if (!result.products[targetProduct]) {
      result.products[targetProduct] = { description: '', specs: [] };
    }

    // 追加 spec（去重）
    if (!result.products[targetProduct].specs.includes(spec.specId)) {
      result.products[targetProduct].specs.push(spec.specId);
    }
  }

  return result;
}

/**
 * 将 ProductMapping 序列化为 YAML 字符串。
 *
 * @param {{ products: Record<string, { description: string, specs: string[] }> }} mapping
 * @returns {string} YAML 字符串
 */
export function serializeProductMapping(mapping) {
  return stringifyYaml(mapping);
}
