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
 *   - resolveOrchestrationConfig({ projectRoot, _loadBase?, _loadOverrides? })
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
  findForbiddenGateOverrides,
  findLostGateMountings,
  findMissingMandatoryModes,
  zodAvailable,
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
// 子函数 1：loadBaseOrFallback — 步骤 1~2 + zod 缺失短路
// ─────────────────────────────────────────────────────────────

/**
 * 加载并校验 base config。
 *
 * 四条终止路径（返回 `{ kind: 'return' }`，由主入口原样透出）：
 *   1. base 加载抛错 → `error` 级 `orchestration.base-invalid` + generateFallbackConfig()
 *   2. zod 缺失且 base 非纯对象 → 同上
 *   3. zod 缺失但 base 是纯对象 → `warning` 级 `orchestration.zod-unavailable`，
 *      best-effort 信任 base 并跳过项目级 overrides（用户输入无法校验）
 *   4. base Zod 校验失败 → `error` 级 `orchestration.base-invalid` + generateFallbackConfig()
 *
 * @param {object} params
 * @param {Function} [params._loadBase] - 可选注入的 base 加载函数
 * @param {Array} params.diagnostics - 就地累积的 diagnostics 数组
 * @returns {Promise<{ kind: 'return', value: object } | { kind: 'continue', baseConfig: object }>}
 */
export async function loadBaseOrFallback({ _loadBase, diagnostics }) {
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
      kind: 'return',
      value: {
        mergedConfig: fallbackConfig,
        baseConfig: fallbackConfig,
        fieldSources: {},
        diagnostics,
        isFallback: true,
        isBaseInvalid: true,
      },
    };
  }

  // ── zod 缺失短路（步骤 1 成功之后、步骤 2 safeParse 之前）────────
  // 缺 zod 时全部 schema 为 null，无法 safeParse；此处 best-effort 信任 base、
  // 跳过项目级 overrides（用户输入无法校验），返回结构化结果而非硬崩。
  if (!zodAvailable) {
    // 纯对象检查（复用既有 isPlainObject 守卫模式）
    const isBaseRawPlainObject =
      rawBase !== null &&
      rawBase !== undefined &&
      Object.prototype.toString.call(rawBase) === '[object Object]';

    if (!isBaseRawPlainObject) {
      // base 解析结果不是纯对象 → 视为 base 损坏，退 generateFallbackConfig
      diagnostics.push(createDiagnostic(
        'error',
        'orchestration.base-invalid',
        '[orchestration] base 配置不是合法对象（zod 缺失 + base 非纯对象）',
      ));
      const fallbackConfig = generateFallbackConfig();
      return {
        kind: 'return',
        value: {
          mergedConfig: fallbackConfig,
          baseConfig: fallbackConfig,
          fieldSources: {},
          diagnostics,
          isFallback: true,
          isBaseInvalid: true,
        },
      };
    }

    // base 是纯对象 → best-effort 信任，跳过 overrides（无法校验用户输入）
    diagnostics.push(createDiagnostic(
      'warning',
      'orchestration.zod-unavailable',
      '[orchestration] 未能加载 zod，已跳过 orchestration schema 校验并 best-effort 信任 base 配置；' +
      '项目级 orchestration-overrides 在缺 zod 时不被应用。' +
      '如需完整校验请在已安装依赖的目录运行（npm i）或从仓内源路径运行 spec-driver 脚本',
    ));
    return {
      kind: 'return',
      value: {
        mergedConfig: rawBase,
        baseConfig: rawBase,
        fieldSources: buildBaseOnlyFieldSources(rawBase),
        diagnostics,
        isFallback: true,
        isBaseInvalid: false,
      },
    };
  }
  // ── zod 缺失短路结束 ─────────────────────────────────────────────

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
      kind: 'return',
      value: {
        mergedConfig: fallbackConfig,
        baseConfig: fallbackConfig,
        fieldSources: {},
        diagnostics,
        isFallback: true,
        isBaseInvalid: true,
      },
    };
  }

  return { kind: 'continue', baseConfig: baseParseResult.data };
}

// ─────────────────────────────────────────────────────────────
// 子函数 2：loadOverridesOrNull — 步骤 3~7
// ─────────────────────────────────────────────────────────────

/**
 * 定位、读取、校验项目级 overrides。
 *
 * 所有降级路径都以 base 配置终止（`kind: 'return'`）；只有校验全部通过时
 * 才返回 `kind: 'continue'` 与已解析的 overridesConfig。
 *
 * @param {object} params
 * @param {string} params.projectRoot
 * @param {Function} [params._loadOverrides]
 * @param {object} params.baseConfig - 已通过 Zod 校验的 base
 * @param {Array} params.diagnostics
 * @returns {Promise<{ kind: 'return', value: object } | { kind: 'continue', overridesConfig: object }>}
 */
export async function loadOverridesOrNull({ projectRoot, _loadOverrides, baseConfig, diagnostics }) {
  /** 以 base 配置终止的统一构造（避免五处降级路径各写一遍） */
  const returnBase = (isFallback) => ({
    kind: 'return',
    value: {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: buildBaseOnlyFieldSources(baseConfig),
      diagnostics,
      isFallback,
      isBaseInvalid: false,
    },
  });

  // ── 步骤 3：检查 overrides 文件是否存在 ────────────────────
  // _loadOverrides 注入时跳过文件系统检查，直接进入步骤 4
  if (!_loadOverrides) {
    const overridesPath = path.join(projectRoot, '.specify', 'orchestration-overrides.yaml');
    if (!fs.existsSync(overridesPath)) {
      // 不存在：静默返回 base，无 diagnostic（spec AC-007/AC-015）
      return returnBase(false);
    }
  }

  // ── 步骤 4：读取并解析 overrides YAML ─────────────────────
  // AC-4.1/4.2：区分 _loadOverrides 注入函数抛错（loader-error）与文件路径方式抛错（parse-error）
  let rawOverrides;
  if (_loadOverrides) {
    try {
      rawOverrides = await _loadOverrides();
    } catch (loaderError) {
      // AC-4.1：注入函数抛错 → loader-error（语义不同于 YAML 解析失败）
      diagnostics.push(createDiagnostic(
        'warning',
        'orchestration-overrides.loader-error',
        `[orchestration-overrides] overrides loader 失败，将使用 base 配置：${loaderError.message}`,
      ));
      return returnBase(true);
    }
  } else {
    try {
      const overridesPath = path.join(projectRoot, '.specify', 'orchestration-overrides.yaml');
      const content = fs.readFileSync(overridesPath, 'utf-8');
      rawOverrides = parseYamlDocument(content);
    } catch (error) {
      // AC-4.2：文件 IO 或 YAML 语法错误 → parse-error code，降级到 base
      diagnostics.push(createDiagnostic(
        'warning',
        'orchestration-overrides.parse-error',
        `[orchestration-overrides] YAML 解析失败，将使用 base 配置：${error.message}`,
      ));
      return returnBase(true);
    }
  }

  // fix(139): 区分两种"非合法对象"场景以提供更准确的 diagnostic
  //   - 文件路径：合法空 YAML 文件（simple-yaml 解析为 null）→ 静默返 base（保持原行为）
  //   - 注入路径：loader 函数返非纯对象（null/undefined/标量/数组/Date/Map 等）违反契约 → 发 loader-error
  //
  // 守卫用 Object.prototype.toString.call() 精确识别"纯对象"（[object Object]），
  // 排除数组、Date、Map、Set 等 typeof === 'object' 的非纯对象类型，否则它们会
  // 绕过守卫被 schema 校验误判为 schema-fallback（Codex 对抗审查 fix/139 角度 3）。
  const isPlainObject = rawOverrides !== null
    && rawOverrides !== undefined
    && Object.prototype.toString.call(rawOverrides) === '[object Object]';

  if (!isPlainObject) {
    if (_loadOverrides) {
      // 描述具体类型用于诊断 message（替代误导性的 typeof，避免 null 显示为 "object"）
      const typeName = rawOverrides === null
        ? 'null'
        : Array.isArray(rawOverrides)
          ? 'Array'
          : Object.prototype.toString.call(rawOverrides).slice(8, -1); // [object X] → X
      diagnostics.push(createDiagnostic(
        'warning',
        'orchestration-overrides.loader-error',
        `[orchestration-overrides] _loadOverrides 注入函数返回非纯对象（${typeName}），将使用 base 配置`,
      ));
      return returnBase(true);
    }
    // 文件路径下空文件：静默返回 base（合法空 YAML 用法）
    return returnBase(false);
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
    return returnBase(true);
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

  // ── 步骤 6.5：FR-052 禁改集甲 / 乙 ─────────────────────────
  // 必须先于步骤 7：禁改集违规同样会被 overrides schema 拒绝，但那条路发的是
  // warning 级 schema-fallback，而 FR-052 要求「被拒绝的覆盖须以不低于 error
  // 的级别出现在 diagnostics 中」——覆盖没生效但也没人报，等同于静默降级。
  const forbiddenGateOverrides = findForbiddenGateOverrides(rawOverridesForStrip.gates);
  if (forbiddenGateOverrides.length > 0) {
    for (const violation of forbiddenGateOverrides) {
      diagnostics.push(createDiagnostic(
        violation.level,
        'orchestration-overrides.gate-field-forbidden',
        violation.message,
        { gateId: violation.gateId, field: violation.field, value: violation.value },
      ));
    }
    return returnBase(true);
  }

  // ── 步骤 7：orchestrationOverridesSchema 校验 ──────────────
  const overridesParseResult = orchestrationOverridesSchema.safeParse(rawOverridesForStrip);
  if (!overridesParseResult.success) {
    diagnostics.push(createDiagnostic(
      'warning',
      'orchestration-overrides.schema-fallback',
      formatOverridesSchemaFallbackMessage(overridesParseResult.error.issues),
    ));
    return returnBase(true);
  }

  return { kind: 'continue', overridesConfig: overridesParseResult.data };
}

/**
 * 组装 overrides schema 校验失败的 diagnostic message。
 *
 * AC-2.1/2.2/2.3：当 issue 命中 modes.<mode>.phases.* 路径时，附加 generate-template hint。
 * 检测路径结构 modes.<m>.phases.*（path[0]==='modes' && path[2]==='phases' && length>=4）
 * 注意：将来若 overridesSchema 调整 phases 嵌套层级，需要同步更新此处路径判断。
 *
 * fix(139)：多 mode 同时出 phase 字段错误时，枚举所有命中的 mode 名（去重）
 * 避免单一 .find() 取第一个时 hint 误导：用户先看到 story 错误但 hint 却建议
 * generate-template fix（取决于 Zod issue 顺序，按 schema shape 而非 YAML 顺序）
 *
 * @param {Array} issues - Zod issues
 * @returns {string}
 */
function formatOverridesSchemaFallbackMessage(issues) {
  const formatted = issues.map(formatZodIssue).join('; ');
  const hitModes = new Set(
    issues
      .filter(iss => Array.isArray(iss.path) && iss.path.length >= 4
          && iss.path[0] === 'modes' && iss.path[2] === 'phases')
      .map(iss => iss.path[1])
  );
  let message = `[orchestration-overrides] overrides 校验失败，将使用 base 配置：${formatted}`;
  if (hitModes.size > 0) {
    const modeList = [...hitModes].sort().join(' / ');
    const example = [...hitModes].sort()[0];
    message += `\nhint: 运行 \`orchestrator-cli generate-template ${example}\` 获取含所有必填字段的完整 phase 模板（命中 mode: ${modeList}）`;
  }
  return message;
}

// ─────────────────────────────────────────────────────────────
// 子函数 3：mergeAndValidate — 步骤 8~9
// ─────────────────────────────────────────────────────────────

/**
 * 合并 base + overrides，并对合并结果做防御性 Zod 校验。
 *
 * @param {object} params
 * @param {object} params.baseConfig
 * @param {object} params.overridesConfig
 * @param {Array} params.diagnostics
 * @returns {{ kind: 'return', value: object } | { kind: 'continue', merged: object, fieldSources: object }}
 */
export function mergeAndValidate({ baseConfig, overridesConfig, diagnostics }) {
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
    return {
      kind: 'return',
      value: {
        mergedConfig: baseConfig,
        baseConfig,
        fieldSources: buildBaseOnlyFieldSources(baseConfig),
        diagnostics,
        isFallback: true,
        isBaseInvalid: false,
      },
    };
  }

  return { kind: 'continue', merged: mergedParseResult.data, fieldSources };
}

// ─────────────────────────────────────────────────────────────
// 子函数 4：validateGateMounting — 门挂载校验（FR-052 禁改集丙）
// ─────────────────────────────────────────────────────────────

/**
 * 校验 override 是否使强制 mode 的 effective phase 序列**失去门的可达挂载**。
 *
 * 判据逐 (强制 mode, gate) 调一次 `evaluateGateMountingAgainstBase`——**base 锚定的可达性**，
 * 不是纯结构存在性：后者只问「门的名字还在不在配置里」，会被三类构造整类绕过
 * （Phase A 对抗审查 α-C1 幽灵 `conditional` / α-C2 幽灵 `skip_if_exists` / α-C3 挂到序列末尾），
 * 它们都能做到「YAML 上看两道门还挂着、执行上一次都不被求值」。现在的判据是
 * 「base 的每个挂载锚点在 effective 中**同名同侧仍挂、抑制条件不强于 base、位序保持**」。
 *
 * 与 FR-068 的运行时守卫（经 `get-gate-behavior` 的 `mounted` / `mounted_in_base` /
 * `mounting_violations`）共用 `contracts/orchestration-schema.mjs` 的同一实现，不各写一套；
 * `validate-gate-mounting.mjs` 共用同一个锚点解析器，但**判据取绝对形式**——理由见该文件头部。
 *
 * **只挂在合并路径上**：三处 fallback 返回路径（base 加载失败 / base 非纯对象 /
 * base Zod 校验失败）刻意不覆盖——那时 base 已损坏，「回退 base」无处可回会成
 * 循环；那些路径的 fail-loud 由既有 `orchestration.base-invalid` error diagnostic 承担。
 *
 * @param {object} merged - 合并后的 effective 配置
 * @param {object} base - base 配置（挂载锚点来源）
 * @returns {Array<{ mode: string, gateId: string, violations: Array }>} 违规项清单；空数组表示通过
 */
export function validateGateMounting(merged, base) {
  return findLostGateMountings(merged, base);
}

// ─────────────────────────────────────────────────────────────
// 子函数 5：assembleResult — 步骤 10 + 结果组装
// ─────────────────────────────────────────────────────────────

/**
 * 发出 mode-overridden info diagnostic 并组装最终返回值。
 *
 * @param {object} params
 * @param {object} params.merged
 * @param {object} params.baseConfig
 * @param {object} params.fieldSources
 * @param {object} params.overridesConfig
 * @param {Array} params.diagnostics
 * @returns {object}
 */
export function assembleResult({ merged, baseConfig, fieldSources, overridesConfig, diagnostics }) {
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
    mergedConfig: merged,
    baseConfig,
    fieldSources,
    diagnostics,
    isFallback: false,
    isBaseInvalid: false,
  };
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
 * @param {Function} [params._loadOverrides] - 可选注入函数，覆盖默认 overrides 加载路径（测试支持）
 *   签名：() => object（同步或异步均可，返回解析后的 YAML 对象，null 表示无 overrides）
 *   测试中可注入内联 YAML 对象来避免创建临时文件。
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
export async function resolveOrchestrationConfig({ projectRoot, _loadBase, _loadOverrides }) {
  const diagnostics = [];

  const baseStep = await loadBaseOrFallback({ _loadBase, diagnostics });
  if (baseStep.kind === 'return') return baseStep.value;
  const { baseConfig } = baseStep;

  // ── 步骤 1.5：base 的强制 mode 射程完整性（FR-052 丙的前提）────────
  // 必须紧跟 base 加载、**先于** overrides 与合并两步：那两步各有若干「回退 base 并
  // 提前 return」的分支（YAML 语法错 / version 不一致 / schema 不过 …），把本检查放在
  // 步骤 9.5 会让「base 缺强制 mode + overrides 恰好写坏」这条组合路径静默逃掉。
  // 不回退、不改 mergedConfig：base 自身残缺时无处可回；判红由 error diagnostic 承担
  // （FR-068 判据 2 与 FR-053 (v) 各接一次）。β-C2 实测：不发这条时，从 base 删掉
  // modes.story 整段可让一次「一道门都不挂」的 story 运行全程无任何 error 信号。
  const missingMandatoryModes = findMissingMandatoryModes(baseConfig);
  if (missingMandatoryModes.length > 0) {
    diagnostics.push(createDiagnostic(
      'error',
      'orchestration.mandatory-mode-missing',
      `[orchestration] base 配置缺少强制 mode 段：${missingMandatoryModes.join(', ')}`
      + '（modes.<mode>.phases 读不出）。这些 mode 的门挂载锚点无从取得，'
      + '「effective 相对 base 有没有失去挂载」这个相对量判不出——判不出⇒从严，'
      + '不得按「没失去」放行。请修复 plugins/spec-driver/config/orchestration.yaml',
      { modes: missingMandatoryModes },
    ));
  }

  const overridesStep = await loadOverridesOrNull({
    projectRoot, _loadOverrides, baseConfig, diagnostics,
  });
  if (overridesStep.kind === 'return') return overridesStep.value;
  const { overridesConfig } = overridesStep;

  const mergeStep = mergeAndValidate({ baseConfig, overridesConfig, diagnostics });
  if (mergeStep.kind === 'return') return mergeStep.value;
  const { merged, fieldSources } = mergeStep;

  // ── 步骤 9.5：门挂载校验（FR-052 禁改集丙）─────────────────
  // 合并之后、返回 effective 之前；失败动作与 schema-fallback 同路（回退 base），
  // 但级别为 error——门挂载缺失属安全面失效，不是配置写错。
  const mountingViolations = validateGateMounting(merged, baseConfig);
  if (mountingViolations.length > 0) {
    const detail = mountingViolations
      .map(v => `mode "${v.mode}" 的 ${v.gateId} 挂载已不可达：`
        + v.violations.map(x => `[${x.kind}] ${x.detail}`).join(' / '))
      .join('；');
    diagnostics.push(createDiagnostic(
      'error',
      'orchestration-overrides.gate-mounting-lost',
      '[orchestration-overrides] 项目级覆盖使强制 mode 的 effective phase 序列失去门挂载，' +
      `已拒绝该覆盖并回退 base 配置：${detail}。` +
      '门挂载不可被项目级覆盖删除；如确需调整该门的适用范围，请修改 spec 与 base orchestration.yaml，' +
      '而不是在 .specify/orchestration-overrides.yaml 里覆盖',
      { violations: mountingViolations },
    ));
    return {
      mergedConfig: baseConfig,
      baseConfig,
      fieldSources: buildBaseOnlyFieldSources(baseConfig),
      diagnostics,
      isFallback: true,
      isBaseInvalid: false,
    };
  }

  return assembleResult({ merged, baseConfig, fieldSources, overridesConfig, diagnostics });
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
