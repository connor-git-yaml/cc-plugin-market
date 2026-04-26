/**
 * orchestration-resolver.mjs
 * Feature 133 — 项目级 orchestration overrides 解析器
 *
 * 职责：
 *   1. 读取 plugin base config（orchestration.yaml）并用 Zod 校验
 *   2. 检查项目级 overrides 文件（.specify/orchestration-overrides.yaml）
 *   3. 将 base 和 overrides 合并（mergeOrchestrationConfigs）
 *   4. 返回合并结果 + fieldSources + diagnostics
 *
 * 导出：
 *   - resolveOrchestrationConfig({ projectRoot, _loadBase? })
 *     返回 { mergedConfig, fieldSources, diagnostics, isFallback, isBaseInvalid }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlDocument } from '../scripts/lib/simple-yaml.mjs';
import { generateFallbackConfig } from './orchestrator-fallback.mjs';
import {
  orchestrationBaseSchema,
  orchestrationOverridesSchema,
  orchestrationMergedSchema,
  formatZodIssue,
} from '../contracts/orchestration-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// Diagnostic 辅助
// ─────────────────────────────────────────────────────────────

/**
 * 创建结构化的 diagnostic 对象
 * @param {'error'|'warning'|'info'} level
 * @param {string} code
 * @param {string} message
 * @param {object} [context]
 */
function createDiagnostic(level, code, message, context) {
  return context !== undefined
    ? { level, code, message, context }
    : { level, code, message };
}

// ─────────────────────────────────────────────────────────────
// mergeOrchestrationConfigs — 核心合并函数（T-006）
// ─────────────────────────────────────────────────────────────

/**
 * 合并 base config 和 overrides config，生成 merged config 和 fieldSources。
 *
 * 合并语义（spec FR-004）：
 *   - modes.<mode>：整段替换（overrides 中存在的 mode 整体替换 base 同名 mode；
 *     不保留 base 该 mode 的任何字段；如需局部调整请用 gates.* 覆盖）
 *   - gates.<GATE_ID>：字段级合并（overrides 中的字段覆盖 base 字段，未声明字段保留 base）
 *   - gates.<GATE_ID>.hard_gate_modes：数组整段替换（非追加）
 *   - parallel_scheduling.*：顶层标量后者覆盖（overrides 中有值就覆盖 base 对应字段）
 *   - parallel_groups：不在 overrides 中处理（已被 resolver 层 strip + warning）
 *   - version：以 base 为准（resolver 在调用前已比对 version，此处不变）
 *
 * @param {object} base - 已通过 orchestrationBaseSchema 校验的 base config
 * @param {object} overrides - 已通过 orchestrationOverridesSchema 校验的 overrides config
 * @returns {{ merged: object, fieldSources: object }}
 */
function mergeOrchestrationConfigs(base, overrides) {
  const fieldSources = {};

  // ── modes 合并：整段替换语义 ──────────────────────────────
  const mergedModes = { ...base.modes };
  for (const [modeKey, modeDef] of Object.entries(overrides.modes || {})) {
    if (modeDef !== undefined && modeDef !== null) {
      // 整段替换：不继承 base 该 mode 的任何字段
      mergedModes[modeKey] = modeDef;
      fieldSources[`modes.${modeKey}`] = 'overrides';
    }
  }
  // base 中未被 overrides 覆盖的 mode 标记为 base
  for (const modeKey of Object.keys(base.modes || {})) {
    if (!fieldSources[`modes.${modeKey}`]) {
      fieldSources[`modes.${modeKey}`] = 'base';
    }
  }

  // ── gates 合并：字段级合并（hard_gate_modes 数组整段替换）──
  const mergedGates = {};
  const allGateIds = new Set([
    ...Object.keys(base.gates || {}),
    ...Object.keys(overrides.gates || {}),
  ]);
  for (const gateId of allGateIds) {
    const baseGate = (base.gates || {})[gateId];
    const overrideGate = (overrides.gates || {})[gateId];

    if (baseGate && overrideGate) {
      // 字段级合并：overrides 字段覆盖 base，hard_gate_modes 数组整段替换（非追加）
      mergedGates[gateId] = { ...baseGate, ...overrideGate };
      // 为每个被覆盖的 Gate 字段记录 source
      for (const field of Object.keys(overrideGate)) {
        fieldSources[`gates.${gateId}.${field}`] = 'overrides';
      }
      // 未被覆盖的字段标记为 base
      for (const field of Object.keys(baseGate)) {
        if (!fieldSources[`gates.${gateId}.${field}`]) {
          fieldSources[`gates.${gateId}.${field}`] = 'base';
        }
      }
    } else if (baseGate) {
      // 仅在 base 中存在，全部标记为 base
      mergedGates[gateId] = { ...baseGate };
      for (const field of Object.keys(baseGate)) {
        fieldSources[`gates.${gateId}.${field}`] = 'base';
      }
    }
    // overrides 中仅有而 base 没有的 gate 忽略（按 spec 约定不新建 gate）
  }

  // ── parallel_scheduling 合并：顶层标量后者覆盖 ────────────
  const mergedParallelScheduling = {
    ...(base.parallel_scheduling || {}),
    ...(overrides.parallel_scheduling || {}),
  };
  // 检查是否有任何字段被 overrides 覆盖
  for (const field of Object.keys(overrides.parallel_scheduling || {})) {
    fieldSources[`parallel_scheduling.${field}`] = 'overrides';
  }
  for (const field of Object.keys(base.parallel_scheduling || {})) {
    if (!fieldSources[`parallel_scheduling.${field}`]) {
      fieldSources[`parallel_scheduling.${field}`] = 'base';
    }
  }

  const merged = {
    // version 以 base 为准
    version: base.version,
    parallel_scheduling: mergedParallelScheduling,
    gates: mergedGates,
    // parallel_groups 保留 base 值（overrides 中此字段已被 resolver 层 strip）
    parallel_groups: base.parallel_groups,
    modes: mergedModes,
  };

  return { merged, fieldSources };
}

// ─────────────────────────────────────────────────────────────
// 默认 base loader
// ─────────────────────────────────────────────────────────────

/**
 * 默认 base config 加载函数：读取 plugin 自带的 orchestration.yaml
 * @returns {object} 解析后的 YAML 对象
 */
function defaultLoadBase() {
  const configPath = path.join(__dirname, '..', 'config', 'orchestration.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  return parseYamlDocument(content);
}

// ─────────────────────────────────────────────────────────────
// resolveOrchestrationConfig — 主入口（T-007/T-008/T-009/T-010）
// ─────────────────────────────────────────────────────────────

/**
 * 解析 orchestration 配置，合并 base + 项目级 overrides。
 *
 * @param {object} params
 * @param {string} params.projectRoot - 项目根目录（用于定位 .specify/orchestration-overrides.yaml）
 * @param {Function} [params._loadBase] - 可选注入函数，覆盖默认 base 加载路径（D-PLAN-4，测试支持）
 *   签名：() => object（同步或异步均可，返回解析后的 YAML 对象）
 *   测试中可注入抛错函数来模拟 base 不可读场景。
 *
 * @returns {Promise<{
 *   mergedConfig: object,
 *   baseConfig: object,
 *   fieldSources: object,
 *   diagnostics: Array<{level: string, code: string, message: string, context?: object}>,
 *   isFallback: boolean,
 *   isBaseInvalid: boolean
 * }>}
 */
export async function resolveOrchestrationConfig({ projectRoot, _loadBase }) {
  const diagnostics = [];

  // ── 步骤 1：加载 base config ───────────────────────────────
  let rawBase;
  try {
    rawBase = _loadBase ? await _loadBase() : defaultLoadBase();
  } catch (error) {
    // base 不可读：记录 error 级别 diagnostic，使用 fallback
    diagnostics.push(createDiagnostic(
      'error',
      'orchestration.base-invalid',
      `[orchestration] base 配置文件加载失败：${error.message}`,
    ));
    const fallbackConfig = generateFallbackConfig();
    return {
      mergedConfig: fallbackConfig,
      baseConfig: fallbackConfig,
      fieldSources: {},
      diagnostics,
      isFallback: true,
      isBaseInvalid: true,
    };
  }

  // ── 步骤 2：base Zod 校验 ──────────────────────────────────
  const baseParseResult = orchestrationBaseSchema.safeParse(rawBase);
  if (!baseParseResult.success) {
    const issues = baseParseResult.error.issues.map(formatZodIssue).join('; ');
    diagnostics.push(createDiagnostic(
      'error',
      'orchestration.base-invalid',
      `[orchestration] base 配置校验失败：${issues}`,
    ));
    const fallbackConfig = generateFallbackConfig();
    return {
      mergedConfig: fallbackConfig,
      baseConfig: fallbackConfig,
      fieldSources: {},
      diagnostics,
      isFallback: true,
      isBaseInvalid: true,
    };
  }
  const baseConfig = baseParseResult.data;

  // ── 步骤 3：检查 overrides 文件是否存在 ────────────────────
  const overridesPath = path.join(projectRoot, '.specify', 'orchestration-overrides.yaml');
  if (!fs.existsSync(overridesPath)) {
    // 不存在：静默返回 base，无 diagnostic（spec AC-007/AC-015）
    const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: baseFieldSources,
      diagnostics,
      isFallback: false,
      isBaseInvalid: false,
    };
  }

  // ── 步骤 4：读取并解析 overrides YAML ─────────────────────
  let rawOverrides;
  try {
    const content = fs.readFileSync(overridesPath, 'utf-8');
    rawOverrides = parseYamlDocument(content);
  } catch (error) {
    // YAML 语法错误：warning + parse-error code，降级到 base
    diagnostics.push(createDiagnostic(
      'warning',
      'orchestration-overrides.parse-error',
      `[orchestration-overrides] YAML 解析失败，将使用 base 配置：${error.message}`,
    ));
    const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: baseFieldSources,
      diagnostics,
      isFallback: true,
      isBaseInvalid: false,
    };
  }

  // 空文件或 null 解析结果：静默返回 base
  if (!rawOverrides || typeof rawOverrides !== 'object') {
    const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: baseFieldSources,
      diagnostics,
      isFallback: false,
      isBaseInvalid: false,
    };
  }

  // ── 步骤 5：比对 version（AC-022）────────────────────────
  // CHK-SR-13 修复：仅当 overrides 显式声明 version 且与 base 不一致时触发 version-mismatch。
  // version 字段缺失（undefined）时跳过本步骤，让步骤 7 的 Zod schema 校验报告"version 必填"
  // → 触发 schema-fallback。这避免缺失字段被误诊为版本不一致，diagnostic 语义更精确。
  if (rawOverrides.version !== undefined && rawOverrides.version !== baseConfig.version) {
    diagnostics.push(createDiagnostic(
      'warning',
      'orchestration-overrides.version-mismatch',
      `[orchestration-overrides] version 不一致：base="${baseConfig.version}"，overrides="${rawOverrides.version}"；将使用 base 配置`,
      { baseVersion: baseConfig.version, overridesVersion: rawOverrides.version },
    ));
    const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: baseFieldSources,
      diagnostics,
      isFallback: true,
      isBaseInvalid: false,
    };
  }

  // ── 步骤 6：检测并 strip unsupported 字段（AC-023）────────
  const rawOverridesForStrip = { ...rawOverrides };
  if (rawOverridesForStrip.parallel_groups !== undefined) {
    diagnostics.push(createDiagnostic(
      'warning',
      'orchestration-overrides.unsupported-field',
      '[orchestration-overrides] parallel_groups 字段在当前版本不支持覆盖，已忽略；其余合法字段照常生效',
    ));
    // 删除 parallel_groups，其余字段继续处理
    delete rawOverridesForStrip.parallel_groups;
  }

  // ── 步骤 7：orchestrationOverridesSchema 校验 ──────────────
  const overridesParseResult = orchestrationOverridesSchema.safeParse(rawOverridesForStrip);
  if (!overridesParseResult.success) {
    const issues = overridesParseResult.error.issues.map(formatZodIssue).join('; ');
    diagnostics.push(createDiagnostic(
      'warning',
      'orchestration-overrides.schema-fallback',
      `[orchestration-overrides] overrides 校验失败，将使用 base 配置：${issues}`,
    ));
    const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: baseFieldSources,
      diagnostics,
      isFallback: true,
      isBaseInvalid: false,
    };
  }
  const overridesConfig = overridesParseResult.data;

  // ── 步骤 8：合并 base + overrides ─────────────────────────
  const { merged, fieldSources } = mergeOrchestrationConfigs(baseConfig, overridesConfig);

  // ── 步骤 9：防御性校验合并结果（orchestrationMergedSchema）─
  const mergedParseResult = orchestrationMergedSchema.safeParse(merged);
  if (!mergedParseResult.success) {
    // 理论上不应到达此处；若到达，记录 error 并降级到 base
    const issues = mergedParseResult.error.issues.map(formatZodIssue).join('; ');
    diagnostics.push(createDiagnostic(
      'error',
      'orchestration.base-invalid',
      `[orchestration] 合并结果校验失败（意外错误），将使用 base 配置：${issues}`,
    ));
    const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: baseFieldSources,
      diagnostics,
      isFallback: true,
      isBaseInvalid: false,
    };
  }

  // ── 步骤 10：发出 mode-overridden info diagnostic（T-010）──
  for (const modeKey of Object.keys(overridesConfig.modes || {})) {
    diagnostics.push(createDiagnostic(
      'info',
      'orchestration-overrides.mode-overridden',
      `[orchestration-overrides] mode "${modeKey}" 已被项目级 overrides 整段替换`,
      { mode: modeKey },
    ));
  }

  return {
    mergedConfig: mergedParseResult.data,
    baseConfig,
    fieldSources,
    diagnostics,
    isFallback: false,
    isBaseInvalid: false,
  };
}

// ─────────────────────────────────────────────────────────────
// 辅助：生成 base-only fieldSources
// ─────────────────────────────────────────────────────────────

/**
 * 当没有 overrides 时，生成所有字段都来自 base 的 fieldSources
 * @param {object} baseConfig
 * @returns {object}
 */
function buildBaseOnlyFieldSources(baseConfig) {
  const fieldSources = {};
  for (const modeKey of Object.keys(baseConfig.modes || {})) {
    fieldSources[`modes.${modeKey}`] = 'base';
  }
  for (const gateId of Object.keys(baseConfig.gates || {})) {
    for (const field of Object.keys((baseConfig.gates[gateId]) || {})) {
      fieldSources[`gates.${gateId}.${field}`] = 'base';
    }
  }
  for (const field of Object.keys(baseConfig.parallel_scheduling || {})) {
    fieldSources[`parallel_scheduling.${field}`] = 'base';
  }
  return fieldSources;
}
