/**
 * spec-driver.config.yaml 中 Spectra batch 相关配置的读取入口（Feature 146）
 *
 * 仅暴露 `batch.concurrency` 字段；其他驱动相关字段由 plugins/spec-driver 自己的
 * resolver 处理，互不干扰。
 *
 * 配置文件查找顺序（自当前工作目录向上递归）：
 * 1. <dir>/spec-driver.config.yaml
 * 2. <dir>/.specify/spec-driver.config.yaml
 *
 * 解析失败 / 文件不存在时返回 undefined，调用方应回落到默认值。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseYamlDocument } from '../panoramic/parsers/yaml-config-parser.js';

const CANDIDATE_NAMES = [
  ['spec-driver.config.yaml'],
  ['.specify', 'spec-driver.config.yaml'],
] as const;

/**
 * 自指定目录向上递归查找 spec-driver.config.yaml 路径，返回首个匹配的绝对路径。
 */
export function findSpecDriverConfigPath(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    for (const segments of CANDIDATE_NAMES) {
      const candidate = path.join(current, ...segments);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * 读取 `spec-driver.config.yaml` 中的 `batch.concurrency` 字段。
 *
 * 返回值约定：
 * - 文件不存在 / 解析失败 / 字段缺失 → undefined（调用方降级到默认值）
 * - 字段为 number 或可解析为有限数字的字符串（如 "3"）→ 数值原样返回
 *   （非整数和越界值由调用链末端的 normalizeConcurrency 统一规范化，
 *    避免双重规范化导致语义不一致）
 * - 字段为无法解析的字符串 / 布尔 / 数组 / NaN / Infinity → undefined
 *   （Codex 对抗审查 CRITICAL #2：YAML quoted "3" 不能静默 fallback，
 *    否则 CLI > config > 默认值的优先级链对配置层失效）
 *
 * @param startDir 项目根目录或 cwd，用于查找配置文件
 */
export function readBatchConcurrency(startDir: string): number | undefined {
  const configPath = findSpecDriverConfigPath(startDir);
  if (!configPath) {
    return undefined;
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    raw = parseYamlDocument(content);
  } catch {
    return undefined;
  }

  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const batch = (raw as Record<string, unknown>)['batch'];
  if (typeof batch !== 'object' || batch === null) {
    return undefined;
  }
  const concurrency = (batch as Record<string, unknown>)['concurrency'];

  // 数字直接返回（含小数 / 越界，由 normalizeConcurrency 兜底）
  if (typeof concurrency === 'number' && Number.isFinite(concurrency)) {
    return concurrency;
  }

  // 字符串数字（YAML 中 quoted 形式如 "3"）也接受
  if (typeof concurrency === 'string') {
    const trimmed = concurrency.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}
