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
 * spec 编号：三位主编号，可带字母后缀（`170c`，本仓在用的同族拆卡约定）或两位子编号（`094-02`）；子编号后必须紧跟 `-名称` 或结束，
 * 避免把 `123-2024-report` 这类名称里的数字段误当子编号。目录名与 mapping 条目共用同一口径——
 * 此前两侧都截成三位，六份 094-0x 坍缩成同一个 id：parsedSpecs 互相覆盖、最后一份的 FR 被合并六次、
 * 产生 77 条假冲突而其余五份的需求整体消失（2026-09-14 delta 审查实测）。
 */
// 编号后必须是 `-` 或结束：`1234-foo` 不是 `123`（角 B 审查 W-B7：mapping 侧此前缺这半个守卫，与目录侧不对称）
export const SPEC_ID_PATTERN = /^(\d{3}[a-z]?(?:-\d{2}(?=-\D|$))?)(?=-|$)/;

/**
 * @param {string} text 目录名或 mapping 条目
 * @returns {string|null}
 */
export function extractSpecId(text) {
  const match = SPEC_ID_PATTERN.exec(text);
  return match ? match[1] : null;
}

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
    // 带 BOM 的文件此前整份被解析成空映射 → 全部 spec 判未映射（角 B 审查 W-B5 变体实测）
    document = parseYamlDocument(yamlContent.replace(/^\uFEFF/, ''));
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
          } else if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0) {
            // 手写 `- 002` 不带引号时 YAML 读成数字 2，此前被 typeof 过滤整条消失（角 B 审查 W-B4）
            rawId = String(entry).padStart(3, '0');
          } else if (isObject(entry) && typeof entry.id === 'string') {
            rawId = entry.id;
          }
          if (!rawId) return null;
          // 从 "001-reverse-spec-v2" / "094-02-panoramic-dir-restructure" 提取编号 "001" / "094-02"
          return extractSpecId(rawId) ?? rawId;
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
      // M11 簇④ 第 9 项：fix-report 通道扫到的目录也可能未映射，sync 子代理归属时需要知道它不是 spec.md
      artifact: entry.artifact ?? 'spec',
    }));
}

/**
 * M11 簇④ 第 13 项：产品名修正的 in-place 文本补丁——只改产品 key 行，注释头 / `name` / `owner` / 行内注释 / 顶层非
 * products 键全部原样保留（整体序列化会把这些全剥掉，文件自述「可手动编辑」对它们一直不成立）。
 * 目标 key 已存在（需要合并两组条目、重排结构）时不做补丁，返回 applied:false 交调用方整体序列化并告警。
 *
 * 纯函数。
 * @param {string} text product-mapping.yaml 原文
 * @param {Array<{ from: string, to: string }>} renames
 * @returns {{ applied: boolean, text: string, reason?: string }}
 */
export function patchProductMappingText(text, renames) {
  let patched = text;
  for (const { from, to } of renames) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fromLine = new RegExp(`^(  ${escape(from)}:)([ \t]*(?:#.*)?)$`, 'm');
    // 目标 key 的**存在性**判定放宽到任意尾部（`spec-driver: ~` / `: {}` / 流式对象也算已存在，对抗审查 C-3：
    // 光杆判据会漏掉标量形态、产出重复键 YAML 并静默丢掉整个产品的 specs）；from 侧仍要求光杆（产品条目必是 mapping）
    const toLine = new RegExp(`^  ${escape(to)}:`, 'm');
    if (toLine.test(patched)) {
      return { applied: false, text, reason: `产品 ${from} 与 ${to} 同时存在，须合并条目，in-place 补丁不覆盖该形态` };
    }
    const matches = patched.match(new RegExp(fromLine.source, 'gm')) ?? [];
    if (matches.length !== 1) {
      return { applied: false, text, reason: `产品 key 行「  ${from}:」出现 ${matches.length} 次，无法定位` };
    }
    patched = patched.replace(fromLine, (_whole, _key, tail) => `  ${to}:${tail ?? ''}`);
  }
  return { applied: true, text: patched };
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
