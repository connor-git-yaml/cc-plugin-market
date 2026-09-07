/**
 * orchestrator.mjs
 * Orchestrator 类：统一编排器，加载 orchestration.yaml 并执行 Phase 序列
 *
 * 4-tier Gate 优先级：user_config > hard_gate > gate_policy > yaml_default
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseYamlDocument } from '../scripts/lib/simple-yaml.mjs';
import { generateFallbackConfig } from './orchestrator-fallback.mjs';
import { orchestrationBaseSchema, formatZodIssue, evaluateGateMountingAgainstBase, zodAvailable } from '../contracts/orchestration-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Orchestrator {
  /**
   * @param {Object} userConfig - 用户配置（来自 spec-driver.config.yaml）
   * @param {string} mode - 运行模式
   * @param {Object} context - 项目上下文
   * @param {Object} [options={}] - 可选扩展选项（T-012，D-PLAN-6）
   * @param {Object} [options.preloadedConfig] - 预加载好的 merged orchestration config（由 resolveOrchestrationConfig 提供）。
   *   存在时直接使用，跳过 loadAndValidateConfig() 文件读取，防止 CLI 读取两次 YAML 且确保使用合并后的 config。
   *   不传时行为与迁移前完全一致（向后兼容）。
   * @param {Object} [options.baseConfig] - base（未经项目级 overrides 的）orchestration config，
   *   门挂载判据的锚点来源。不传时退回 `this.config`——`loadAndValidateConfig()` 与
   *   `generateFallbackConfig()` 两条路径读到的本来就是 base，自锚定即「无覆盖」，恒无违规。
   */
  constructor(userConfig, mode, context = {}, options = {}) {
    this.userConfig = userConfig || {};
    this.mode = mode;
    this.context = context;
    this.logger = context.logger || defaultLogger;

    if (options.preloadedConfig) {
      // 使用预加载的 merged config，绕过文件读取（D-PLAN-6 关键陷阱防御）
      this.config = options.preloadedConfig;
      this.isFallback = false;
    } else {
      this.loadAndValidateConfig();
    }
    this.baseConfig = options.baseConfig || this.config;

    this.buildGateBehaviorMap();
    this.buildGateMountingMap();
    this.buildPhaseMap();
    this.buildParallelGroupMap();
  }

  /** @private */
  loadAndValidateConfig() {
    const configPath = path.join(__dirname, '..', 'config', 'orchestration.yaml');

    try {
      if (!fs.existsSync(configPath)) {
        this.logger.warn('[ORCHESTRATOR] orchestration.yaml not found, using fallback');
        this.config = generateFallbackConfig();
        this.isFallback = true;
        return;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = parseYamlDocument(content);

      // ── zod 缺失守卫（YAML 解析成功之后、safeParse 之前）────────────
      // 缺 zod 时 orchestrationBaseSchema 为 null，调用 .safeParse 会抛 TypeError 被外层
      // catch 误判为加载失败并丢弃真实配置。显式守卫在此 best-effort 信任已解析 YAML。
      if (!zodAvailable) {
        const isParsedPlainObject =
          parsed !== null &&
          parsed !== undefined &&
          Object.prototype.toString.call(parsed) === '[object Object]';

        if (isParsedPlainObject) {
          // parsed 是纯对象 → best-effort 信任已解析的 YAML
          this.logger.warn(
            '[ORCHESTRATOR] zod 未加载，已跳过 orchestration schema 校验并 best-effort 信任已解析配置',
          );
          this.config = parsed;
          this.isFallback = false;   // 真实配置，非最小桩
        } else {
          // parsed 不是纯对象（YAML 解析为 null/数组/标量等）→ 退 generateFallbackConfig
          this.logger.warn(
            '[ORCHESTRATOR] zod 未加载且 YAML 解析结果非纯对象，使用 fallback 配置',
          );
          this.config = generateFallbackConfig();
          this.isFallback = true;
        }
        return;   // 跳过 safeParse，退出 loadAndValidateConfig
      }
      // ── zod 缺失守卫结束 ─────────────────────────────────────────────

      // 使用 orchestrationBaseSchema.safeParse 替代手写校验（CL-016，T-011）
      const zodResult = orchestrationBaseSchema.safeParse(parsed);
      if (!zodResult.success) {
        const issues = zodResult.error.issues.map(formatZodIssue).join('; ');
        this.logger.error(`[ORCHESTRATOR] Config validation failed: ${issues}`);
        this.config = generateFallbackConfig();
        this.isFallback = true;
        return;
      }

      this.config = zodResult.data;
      this.isFallback = false;
    } catch (error) {
      this.logger.error(`[ORCHESTRATOR] Failed to load config: ${error.message}`);
      this.config = generateFallbackConfig();
      this.isFallback = true;
    }
  }

  /**
   * 构建 Gate 行为映射表
   * 4-tier 优先级：user_config > hard_gate > gate_policy > yaml_default
   * @private
   */
  buildGateBehaviorMap() {
    this.gateBehaviorMap = {};
    const policy = this.userConfig.gate_policy || 'balanced';
    const userGates = this.userConfig.gates || {};
    const configGates = this.config.gates || {};

    for (const [gateId, gateDef] of Object.entries(configGates)) {
      const isHardGate =
        Array.isArray(gateDef.hard_gate_modes) &&
        gateDef.hard_gate_modes.includes(this.mode);

      let behavior, source;

      if (isHardGate) {
        behavior = 'always';
        source = 'hard_gate';
      } else if (userGates[gateId]?.pause) {
        behavior = userGates[gateId].pause;
        source = 'user_config';
      } else {
        const policyDefault = getDefaultBehaviorForPolicy(policy, gateId);
        if (policyDefault !== null) {
          behavior = policyDefault;
          source = 'gate_policy';
        } else {
          behavior = gateDef.default_behavior || 'on_failure';
          source = 'yaml_default';
        }
      }

      this.gateBehaviorMap[gateId] = {
        behavior, source, severity: gateDef.severity,
        isHardGate, type: gateDef.type, description: gateDef.description,
      };
    }
  }

  /**
   * 构建 Gate 挂载映射表（FR-052 / FR-068）
   *
   * `mounted` 回答的是「这道门在本 mode 的 effective phase 序列里会不会被求值」，
   * 与 `buildGateBehaviorMap` 回答的「它被求值时该怎么表现」是两件事：后者只遍历
   * `config.gates`、从不查 `modes.<mode>.phases`，因此门被删掉挂载时它仍答
   * `is_hard_gate: true`。`mounted: false` 时 `is_hard_gate: true` 不构成
   * 「门在场」的证据。
   *
   * 判据是 `evaluateGateMountingAgainstBase`（**base 锚定的可达性**），不是纯结构
   * 存在性——后者会被「挂到 conditional 恒假 / skip_if_exists 恒真的幽灵 phase」
   * 与「挂到序列末尾」整类绕过（Phase A 对抗审查 α-C1 / α-C2 / α-C3）。
   *
   * 取不到一律按 `false`（判不出⇒从严）。fallback 情形下 `this.config` 与
   * `this.baseConfig` 同为 `generateFallbackConfig()` 的返回值，本方法照常算得出。
   *
   * @private
   */
  buildGateMountingMap() {
    this.gateMountingMap = {};
    this.gateMountingDetailMap = {};
    // 并上 base 的 gate id：覆盖删掉某个 gate 定义时，它的挂载事实仍须可查
    const gateIds = new Set([
      ...Object.keys(this.config.gates || {}),
      ...Object.keys(this.baseConfig?.gates || {}),
    ]);
    for (const gateId of gateIds) {
      const detail = evaluateGateMountingAgainstBase(this.config, this.baseConfig, this.mode, gateId);
      this.gateMountingDetailMap[gateId] = detail;
      this.gateMountingMap[gateId] = detail.mounted;
    }
  }

  /** @private */
  buildPhaseMap() {
    this.phaseMap = {};
    const modeConfig = (this.config.modes || {})[this.mode];
    if (!modeConfig?.phases) {
      this.logger.error(`[ORCHESTRATOR] Mode '${this.mode}' not found`);
      return;
    }
    modeConfig.phases.forEach((p) => { this.phaseMap[p.id] = p; });
  }

  /** @private */
  buildParallelGroupMap() {
    this.parallelGroupMap = {};
    for (const [id, def] of Object.entries(this.config.parallel_groups || {})) {
      this.parallelGroupMap[id] = {
        id,
        members: def.members || [],
        convergencePoint: def.convergence_point,
        fallbackStrategy: def.fallback_strategy || 'serial_fallback',
        maxConcurrent: def.max_concurrent || 2,
        description: def.description || '',
      };
    }
  }

  getPhases() {
    const modeConfig = (this.config.modes || {})[this.mode];
    if (!modeConfig?.phases) return [];
    return modeConfig.phases;
  }

  getGateBehavior(gateId) {
    return this.gateBehaviorMap[gateId] || {
      behavior: 'on_failure', source: 'default',
      severity: 'non_critical', isHardGate: false,
    };
  }

  /**
   * 该 gate 是否被本 mode 的 phase 序列挂载（FR-052 的 `mounted` 字段）。
   * 未知 gate id / 未知 mode / 配置读不出来一律返回 `false`（判不出⇒从严）。
   * @param {string} gateId
   * @returns {boolean}
   */
  getGateMounting(gateId) {
    return this.gateMountingMap[gateId] === true;
  }

  /**
   * 该 gate 的门挂载判定明细（FR-052 / FR-068 的 `mounted_in_base` 与
   * `mounting_violations` 两个输出字段的来源）。
   *
   * 未预先算过的 gate id（例如 base 与 effective 都没有该 gate 定义）现场算一次，
   * 而不是返回 `undefined`——`undefined` 会让下游的蕴含式判据空转（F270 教训）。
   *
   * @param {string} gateId
   * @returns {{ mountedInBase: boolean, mounted: boolean, anchors: Array, violations: Array }}
   */
  getGateMountingDetail(gateId) {
    return this.gateMountingDetailMap?.[gateId]
      ?? evaluateGateMountingAgainstBase(this.config, this.baseConfig, this.mode, gateId);
  }

  getParallelGroup(groupId) {
    return this.parallelGroupMap[groupId] || null;
  }

  getParallelGroups() {
    return Object.values(this.parallelGroupMap);
  }

  shouldExecutePhase(phase, context = {}) {
    if (phase.conditional && !evaluateCondition(phase.conditional, context)) return false;
    if (phase.skip_if_exists && context.fileExists) {
      const fp = path.join(context.featureDir || '', phase.skip_if_exists);
      if (context.fileExists(fp)) {
        this.logger.info(`[ORCHESTRATOR] Skip ${phase.id} (${phase.display_name}) - artifact exists`);
        return false;
      }
    }
    return true;
  }

  getParallelSchedulingConfig() {
    return this.config.parallel_scheduling || {
      max_concurrent_tasks: 2, fallback_to_serial_on_failure: true, fallback_reason_log: true,
    };
  }

  getSummary() {
    return {
      mode: this.mode, isFallback: this.isFallback,
      phasesCount: Object.keys(this.phaseMap).length,
      gatesCount: Object.keys(this.gateBehaviorMap).length,
      parallelGroupsCount: Object.keys(this.parallelGroupMap).length,
      version: this.config.version,
    };
  }
}

/**
 * 验证 orchestration.yaml 配置（向后兼容薄壳，T-011）
 *
 * 历史逻辑：手写循环校验 modes/phases/gates（已移除）。
 * 当前实现：保留向后兼容的 null 检查和 modes 存在性检查，
 * 内部核心校验已迁移至 loadAndValidateConfig() 使用 orchestrationBaseSchema.safeParse()。
 *
 * 本函数作为公共 API 保留，仅做基础 null/modes 检查，
 * 调用方应优先使用 orchestrationBaseSchema.safeParse() 获取完整 Zod 校验。
 */
export function validateOrchestrationYaml(config) {
  const errors = [];
  const warnings = [];

  // 基础 null 检查
  if (!config) {
    errors.push('Config is null or undefined');
    return { valid: false, errors, warnings };
  }

  // modes 存在性检查（最关键的结构约束）
  if (!config.modes || Object.keys(config.modes).length === 0) {
    errors.push('modes section is missing or empty');
  }

  // 语义警告（向后兼容）
  if (config.modes && !config.modes.feature) {
    warnings.push('feature mode not found');
  }
  if (!config.gates || Object.keys(config.gates).length === 0) {
    warnings.push('No gates defined');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 安全的条件表达式求值（不使用 eval）
 */
export function evaluateCondition(condition, context = {}) {
  if (!condition) return true;

  try {
    // "variable in [val1, val2]"
    const inMatch = condition.match(/^(\w+)\s+in\s+\[(.*)\]$/);
    if (inMatch) {
      const values = inMatch[2].split(',').map((s) => s.trim().replace(/['"]/g, ''));
      return context[inMatch[1]] !== undefined && values.includes(String(context[inMatch[1]]));
    }

    // "variable == value"
    const eqMatch = condition.match(/^(\w+)\s*==\s*(.+)$/);
    if (eqMatch) return String(context[eqMatch[1]]) === eqMatch[2].trim().replace(/['"]/g, '');

    // "variable != value"
    const neqMatch = condition.match(/^(\w+)\s*!=\s*(.+)$/);
    if (neqMatch) return String(context[neqMatch[1]]) !== neqMatch[2].trim().replace(/['"]/g, '');

    // "variable > number"
    const gtMatch = condition.match(/^(\w+)\s*>\s*(\d+)$/);
    if (gtMatch) { const v = Number(context[gtMatch[1]]); return !isNaN(v) && v > parseInt(gtMatch[2], 10); }

    console.warn(`[ORCHESTRATOR] 无法解析条件: "${condition}"`);
    return true;
  } catch { return true; }
}

function getDefaultBehaviorForPolicy(policy, gateId) {
  if (policy === 'strict') return 'always';
  if (policy === 'autonomous') return 'on_failure';
  const balanced = {
    GATE_RESEARCH: 'auto', GATE_DESIGN: 'always', GATE_ANALYSIS: 'on_failure',
    GATE_TASKS: 'always', GATE_IMPLEMENT_MID: 'on_failure', GATE_VERIFY: 'always',
  };
  return balanced[gateId] || null;
}

const defaultLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  debug: () => {},
};
