/**
 * spec-directory-index.mjs — `specs/NNN-*` 目录的编号索引
 *
 * 编号口径与 product-mapping 共用 `extractSpecId`（三位主编号 + 可选字母后缀 / 两位子编号），
 * 目录名在编号之后必须紧跟 `-名称`。此前 sync 引擎、catalog、scorecard 各自拼路径：
 * catalog 只吃对象形态条目（`specCount` 恒 0），scorecard 把短编号 `"001"` 原样当目录名（一律判 missing）。
 * 本模块是三者共用的唯一取数路径（M11 簇④ 第 12 项）。
 *
 * @module spec-directory-index
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractSpecId } from './sync-product-mapping.mjs';

/**
 * 目录名是否是合法的 spec 目录（`NNN-name` / `NNNa-name` / `NNN-NN-name`）。
 * @param {string} dirName
 * @returns {boolean}
 */
export function isSpecDirName(dirName) {
  const id = extractSpecId(dirName);
  return Boolean(id) && /^-\S/.test(dirName.slice(id.length));
}

/**
 * 按编号索引 `specsDir` 下的全部 spec 目录；同一编号多个目录时按目录名字典序保留全部（调用方自行决定取舍或告警）。
 * 目录不存在 / 不可读时返回空索引。
 * @param {string} specsDir
 * @returns {Map<string, string[]>} 编号 → 目录名列表（已排序）
 */
export function indexSpecDirectories(specsDir) {
  let dirNames;
  try {
    dirNames = fs.readdirSync(specsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return new Map();
  }
  const byId = new Map();
  for (const dirName of dirNames.sort()) {
    if (!isSpecDirName(dirName)) continue;
    const id = extractSpecId(dirName);
    byId.set(id, [...(byId.get(id) || []), dirName]);
  }
  return byId;
}

/**
 * 把 mapping 条目（短编号 `"001"` 或完整目录名 `"001-foo"`）解析成磁盘目录名。
 * 完整目录名在盘即原样返回；否则按编号查索引取首个；都取不到返回 null（调用方判 missing）。
 * @param {string} specsDir
 * @param {string} entry
 * @param {Map<string, string[]>} [index] 预先算好的索引（批量解析时复用，避免每条重读目录）
 * @returns {{ id: string, dirName: string|null }}
 */
export function resolveSpecDirName(specsDir, entry, index = indexSpecDirectories(specsDir)) {
  const id = extractSpecId(entry) ?? entry;
  if (isSpecDirName(entry) && fs.existsSync(path.join(specsDir, entry))) {
    return { id, dirName: entry };
  }
  const candidates = index.get(id) || [];
  return { id, dirName: candidates[0] ?? null };
}
