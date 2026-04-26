/**
 * validate-orchestration-overrides.mjs
 * Feature 133 — 项目级 orchestration overrides 校验器
 *
 * 主导出：validateOrchestrationOverrides({ projectRoot })
 * 返回值格式与 repo-maintenance-core.mjs 的 aggregateValidation 兼容：
 *   { status: "ok" | "warning" | "error", checks: [], warnings: [], errors: [] }
 *
 * 其中 check 格式：{ id, title, status, evidence }
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveOrchestrationConfig } from '../lib/orchestration-resolver.mjs';

/**
 * 创建 check 对象（与 repo-maintenance-core.mjs 的 createCheck 格式一致）
 * @param {string} id
 * @param {string} title
 * @param {'pass'|'warn'|'fail'} status
 * @param {object} [evidence]
 * @returns {{ id: string, title: string, status: string, evidence: object }}
 */
function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

/**
 * 校验项目级 orchestration overrides 配置。
 *
 * 校验内容：
 *   1. overrides 文件是否存在（不存在则 skip，status=ok）
 *   2. YAML 解析是否成功（parse-error → warning）
 *   3. overrides Zod schema 校验（schema-fallback → warning）
 *   4. version 是否与 base 一致（version-mismatch → warning）
 *   5. 合并后 mergedConfig 防御性校验（base-invalid → error）
 *   6. unsupported-field 检测（parallel_groups strip → warning）
 *
 * @param {{ projectRoot: string }} params
 * @returns {Promise<{ status: "ok" | "warning" | "error", checks: object[], warnings: string[], errors: string[] }>}
 */
export async function validateOrchestrationOverrides({ projectRoot }) {
  const checks = [];
  const warnings = [];
  const errors = [];

  // 检查 overrides 文件是否存在
  const overridesPath = path.join(projectRoot, '.specify', 'orchestration-overrides.yaml');
  const overridesExists = fs.existsSync(overridesPath);

  if (!overridesExists) {
    // 不存在：skip，状态 ok（无 overrides 是合法状态）
    checks.push(createCheck(
      'overrides-file-exists',
      'orchestration-overrides.yaml 文件存在性检查',
      'pass',
      { path: overridesPath, exists: false, note: '无 overrides 文件，使用 base 配置（正常）' },
    ));
    return { status: 'ok', checks, warnings, errors };
  }

  checks.push(createCheck(
    'overrides-file-exists',
    'orchestration-overrides.yaml 文件存在性检查',
    'pass',
    { path: overridesPath, exists: true },
  ));

  // 调用 resolver，获取完整校验结果（含所有降级路径）
  let resolverResult;
  try {
    resolverResult = await resolveOrchestrationConfig({ projectRoot });
  } catch (err) {
    // resolver 本身抛异常（极罕见）
    const msg = `resolver 调用异常：${err.message}`;
    errors.push(msg);
    checks.push(createCheck(
      'overrides-resolver',
      'orchestration overrides resolver 调用',
      'fail',
      { error: err.message },
    ));
    return { status: 'error', checks, warnings, errors };
  }

  const { diagnostics, isFallback, isBaseInvalid } = resolverResult;

  // 根据 diagnostics 分类生成 checks / warnings / errors
  for (const diag of diagnostics) {
    switch (diag.code) {
      case 'orchestration-overrides.parse-error': {
        // YAML 解析失败 → error（文件存在但不可读，repo:check 应拦截；AC-009）
        errors.push(`orchestration-overrides.yaml YAML 解析失败：${diag.message}`);
        checks.push(createCheck(
          'overrides-yaml-parse',
          'orchestration-overrides.yaml YAML 语法解析',
          'fail',
          { code: diag.code, message: diag.message },
        ));
        break;
      }
      case 'orchestration-overrides.schema-fallback': {
        // schema 校验失败 → error（无效 overrides 文件应被 repo:check 拦截；AC-009）
        errors.push(`orchestration-overrides.yaml schema 校验失败：${diag.message}`);
        checks.push(createCheck(
          'overrides-schema-validation',
          'orchestration-overrides.yaml Zod schema 校验',
          'fail',
          { code: diag.code, message: diag.message },
        ));
        break;
      }
      case 'orchestration-overrides.version-mismatch': {
        // version 不一致 → error（overrides 文件与 base 不兼容，应被 repo:check 拦截）
        errors.push(`orchestration-overrides.yaml version 不一致：${diag.message}`);
        checks.push(createCheck(
          'overrides-version-match',
          'orchestration-overrides.yaml version 与 base 一致性',
          'fail',
          { code: diag.code, message: diag.message, context: diag.context },
        ));
        break;
      }
      case 'orchestration-overrides.unsupported-field': {
        // unsupported 字段（parallel_groups strip）→ warning（非阻断性）
        warnings.push(`orchestration-overrides.yaml 含不支持的字段：${diag.message}`);
        checks.push(createCheck(
          'overrides-unsupported-fields',
          'orchestration-overrides.yaml 不支持字段检测',
          'warn',
          { code: diag.code, message: diag.message },
        ));
        break;
      }
      case 'orchestration.base-invalid': {
        // base config 不可读或校验失败 → error
        errors.push(`orchestration base 配置错误：${diag.message}`);
        checks.push(createCheck(
          'overrides-base-valid',
          'orchestration base 配置有效性',
          'fail',
          { code: diag.code, message: diag.message },
        ));
        break;
      }
      case 'orchestration-overrides.mode-overridden': {
        // 正常 info，不生成 check
        break;
      }
      default: {
        // 未知 diagnostic → 记录为 warning
        warnings.push(`[unknown] ${diag.code}: ${diag.message}`);
        break;
      }
    }
  }

  // 如果没有错误也没有警告来自 diagnostics，补充正常校验 check
  const hasSchemaCheck = checks.some(c => c.id === 'overrides-schema-validation');
  if (!hasSchemaCheck && !isBaseInvalid) {
    checks.push(createCheck(
      'overrides-schema-validation',
      'orchestration-overrides.yaml Zod schema 校验',
      'pass',
      { isFallback, diagnosticCount: diagnostics.length },
    ));
  }

  const hasVersionCheck = checks.some(c => c.id === 'overrides-version-match');
  if (!hasVersionCheck && !isBaseInvalid) {
    checks.push(createCheck(
      'overrides-version-match',
      'orchestration-overrides.yaml version 与 base 一致性',
      'pass',
      { note: '版本一致或无 version 字段' },
    ));
  }

  // 判断整体状态
  let status;
  if (errors.length > 0) {
    status = 'error';
  } else if (warnings.length > 0) {
    status = 'warning';
  } else {
    status = 'ok';
  }

  return { status, checks, warnings, errors };
}
