/**
 * orchestrator.js
 * Orchestrator 类：统一编排器，加载 orchestration.yaml 并执行 Phase 序列
 *
 * 职责：
 * - 加载和验证 orchestration.yaml
 * - 构建 Phase、Gate、并行组的映射表
 * - 解析 Gate 优先级（user_config > hard_gate > policy > default）
 * - 判定 Phase 的条件执行
 * - 管理并行组调度和降级
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { z } = require('zod');
const { generateFallbackConfig } = require('./orchestrator-fallback');

/**
 * Orchestrator 类
 */
class Orchestrator {
  /**
   * 构造函数
   * @param {Object} userConfig - 用户配置对象（来自 spec-driver.config.yaml）
   * @param {string} mode - 当前运行模式（feature/story/implement/fix/resume/sync/doc）
   * @param {Object} context - 项目上下文对象（可选）
   */
  constructor(userConfig, mode, context = {}) {
    this.userConfig = userConfig || {};
    this.mode = mode;
    this.context = context;
    this.logger = context.logger || createDefaultLogger();

    // 初始化配置
    this.loadAndValidateConfig();
    this.buildGateBehaviorMap();
    this.buildPhaseMap();
    this.buildParallelGroupMap();
  }

  /**
   * 加载和验证 orchestration.yaml
   * @private
   */
  loadAndValidateConfig() {
    const configPath = path.join(
      __dirname,
      '..',
      'config',
      'orchestration.yaml'
    );

    try {
      if (!fs.existsSync(configPath)) {
        this.logger.warn(
          '[ORCHESTRATOR] orchestration.yaml not found, using fallback config'
        );
        this.config = generateFallbackConfig();
        this.isFallback = true;
        return;
      }

      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const parsedConfig = yaml.load(fileContent);

      // 验证基本结构
      const validationResult = validateOrchestrationYaml(parsedConfig);
      if (!validationResult.valid) {
        this.logger.error(
          `[ORCHESTRATOR] Config validation failed: ${validationResult.errors.join('; ')}`
        );
        this.config = generateFallbackConfig();
        this.isFallback = true;
        return;
      }

      this.config = parsedConfig;
      this.isFallback = false;

      if (validationResult.warnings.length > 0) {
        validationResult.warnings.forEach((w) => {
          this.logger.warn(`[ORCHESTRATOR] ${w}`);
        });
      }
    } catch (error) {
      this.logger.error(
        `[ORCHESTRATOR] Failed to load orchestration.yaml: ${error.message}`
      );
      this.config = generateFallbackConfig();
      this.isFallback = true;
    }
  }

  /**
   * 构建 Gate 行为映射表
   * 优先级：user_config > hard_gate > gate_policy > default_behavior
   * @private
   */
  buildGateBehaviorMap() {
    this.gateBehaviorMap = {};

    const policy = this.userConfig.gate_policy || 'balanced';
    const gates = this.config.gates || {};

    for (const [gateId, gateDef] of Object.entries(gates)) {
      // 1. 检查是否为硬门禁（且当前模式在 hard_gate_modes 中）
      const isHardGate =
        gateDef.hard_gate_modes &&
        gateDef.hard_gate_modes.includes(this.mode);

      // 2. 检查用户配置覆盖（但硬门禁不可覆盖）
      let behavior = gateDef.default_behavior;

      if (
        this.userConfig.gates &&
        this.userConfig.gates[gateId] &&
        this.userConfig.gates[gateId].pause
      ) {
        if (isHardGate) {
          this.logger.warn(
            `[ORCHESTRATOR] ${gateId} is hard gate in ${this.mode} mode, user config override ignored`
          );
        } else {
          behavior = this.userConfig.gates[gateId].pause;
        }
      } else if (isHardGate) {
        // 硬门禁始终为 always
        behavior = 'always';
      } else {
        // 应用全局策略默认值
        behavior = getDefaultBehaviorForPolicy(policy, gateId);
      }

      this.gateBehaviorMap[gateId] = {
        behavior,
        severity: gateDef.severity,
        isHardGate,
        type: gateDef.type,
        description: gateDef.description,
      };
    }
  }

  /**
   * 构建 Phase 映射表
   * @private
   */
  buildPhaseMap() {
    this.phaseMap = {};

    const modes = this.config.modes || {};
    const currentModeConfig = modes[this.mode];

    if (!currentModeConfig || !currentModeConfig.phases) {
      this.logger.error(
        `[ORCHESTRATOR] Mode ${this.mode} not found in config`
      );
      return;
    }

    currentModeConfig.phases.forEach((phase) => {
      this.phaseMap[phase.id] = phase;
    });
  }

  /**
   * 构建并行组映射表
   * @private
   */
  buildParallelGroupMap() {
    this.parallelGroupMap = {};

    const parallelGroups = this.config.parallel_groups || {};

    for (const [groupId, groupDef] of Object.entries(parallelGroups)) {
      this.parallelGroupMap[groupId] = {
        members: groupDef.members || [],
        convergencePoint: groupDef.convergence_point,
        fallbackStrategy: groupDef.fallback_strategy || 'serial_fallback',
        maxConcurrent: groupDef.max_concurrent || 2,
      };
    }
  }

  /**
   * 获取当前模式的 Phase 序列
   * @returns {Array} Phase 对象数组
   */
  getPhases() {
    const modes = this.config.modes || {};
    const currentModeConfig = modes[this.mode];

    if (!currentModeConfig || !currentModeConfig.phases) {
      this.logger.error(
        `[ORCHESTRATOR] No phases found for mode: ${this.mode}`
      );
      return [];
    }

    return currentModeConfig.phases;
  }

  /**
   * 获取指定 Gate 的执行行为
   * @param {string} gateId - Gate ID
   * @returns {string} 行为：always / auto / on_failure
   */
  getGateBehavior(gateId) {
    const gateBehavior = this.gateBehaviorMap[gateId];
    return gateBehavior ? gateBehavior.behavior : 'on_failure';
  }

  /**
   * 判定 Phase 是否应该执行
   * @param {Object} phase - Phase 对象
   * @param {Object} context - 执行上下文（包含 fileSystem 等）
   * @returns {boolean}
   */
  shouldExecutePhase(phase, context = {}) {
    // 检查 conditional 表达式
    if (phase.conditional && !evaluateCondition(phase.conditional, context)) {
      return false;
    }

    // 检查 skip_if_exists
    if (phase.skip_if_exists && context.fileExists) {
      const filePath = path.join(context.featureDir || '', phase.skip_if_exists);
      if (context.fileExists(filePath)) {
        this.logger.info(
          `[ORCHESTRATOR] Skipping phase ${phase.id} (${phase.display_name}) - artifact exists`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * 获取并行组信息
   * @param {string} groupId - 并行组 ID
   * @returns {Object} 并行组配置对象
   */
  getParallelGroup(groupId) {
    return this.parallelGroupMap[groupId];
  }

  /**
   * 获取全局并行调度配置
   * @returns {Object} 并行调度配置
   */
  getParallelSchedulingConfig() {
    return this.config.parallel_scheduling || {
      max_concurrent_tasks: 2,
      fallback_to_serial_on_failure: true,
      fallback_reason_log: true,
    };
  }

  /**
   * 输出配置状态摘要（用于日志）
   * @returns {Object} 状态信息
   */
  getSummary() {
    return {
      mode: this.mode,
      isFallback: this.isFallback,
      phasesCount: Object.keys(this.phaseMap).length,
      gatesCount: Object.keys(this.gateBehaviorMap).length,
      parallelGroupsCount: Object.keys(this.parallelGroupMap).length,
      version: this.config.version,
    };
  }
}

/**
 * 验证 orchestration.yaml 配置
 * @param {Object} config - 配置对象
 * @returns {Object} { valid: boolean, errors: [], warnings: [] }
 */
function validateOrchestrationYaml(config) {
  const errors = [];
  const warnings = [];

  if (!config) {
    errors.push('Config is null or undefined');
    return { valid: false, errors, warnings };
  }

  // 检查必填字段
  if (!config.version) {
    warnings.push('version field missing, assuming 1.0');
  }

  if (!config.modes || Object.keys(config.modes).length === 0) {
    errors.push('modes section is missing or empty');
  }

  // 检查 feature 模式是否存在
  if (config.modes && !config.modes.feature) {
    warnings.push('feature mode not found in modes');
  }

  // 检查 Gate 定义
  if (!config.gates || Object.keys(config.gates).length === 0) {
    warnings.push('No gates defined in config');
  }

  // 检查每个模式的 Phase 数组
  if (config.modes) {
    for (const [modeId, modeConfig] of Object.entries(config.modes)) {
      if (!modeConfig.phases || !Array.isArray(modeConfig.phases)) {
        errors.push(`Mode ${modeId}: phases is not an array`);
      } else if (modeConfig.phases.length === 0) {
        warnings.push(`Mode ${modeId}: empty phases array`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 根据 gate_policy 获取默认 Gate 行为
 * @param {string} policy - 策略：strict / balanced / autonomous
 * @param {string} gateId - Gate ID
 * @returns {string} 行为：always / auto / on_failure
 */
function getDefaultBehaviorForPolicy(policy, gateId) {
  const policyDefaults = {
    strict: 'always',
    balanced: {
      GATE_RESEARCH: 'auto',
      GATE_DESIGN: 'always',
      GATE_ANALYSIS: 'on_failure',
      GATE_TASKS: 'always',
      GATE_IMPLEMENT_MID: 'on_failure',
      GATE_VERIFY: 'always',
    },
    autonomous: 'on_failure',
  };

  if (policy === 'strict' || policy === 'autonomous') {
    return policyDefaults[policy];
  }

  // balanced 模式：各 Gate 有不同默认值
  return policyDefaults.balanced[gateId] || 'on_failure';
}

/**
 * 评估条件表达式
 * 支持的语法：research_mode in [full, tech-only], file_exists(path), AND, OR, NOT
 * @param {string} condition - 条件表达式
 * @param {Object} context - 执行上下文
 * @returns {boolean}
 */
function evaluateCondition(condition, context = {}) {
  if (!condition) return true;

  // 简单的条件评估（支持基本操作符）
  // 实际实现可用更复杂的表达式解析库

  try {
    // 替换变量
    let expr = condition;

    // research_mode 变量
    if (context.research_mode) {
      expr = expr.replace(
        /research_mode\s+in\s+\[(.*?)\]/g,
        (match, values) => {
          const modes = values
            .split(',')
            .map((s) => s.trim().replace(/['"]/g, ''));
          return modes.includes(context.research_mode) ? 'true' : 'false';
        }
      );
    }

    // file_exists 函数（简化处理）
    if (context.fileExists) {
      expr = expr.replace(/file_exists\((.*?)\)/g, (match, filePath) => {
        const cleanPath = filePath.replace(/['"]/g, '');
        return context.fileExists(cleanPath) ? 'true' : 'false';
      });
    }

    // 评估 JavaScript 表达式（注意安全性）
    // eslint-disable-next-line no-eval
    return eval(expr);
  } catch (error) {
    // 条件评估失败，默认返回 true（执行 Phase）
    console.error(`[ORCHESTRATOR] Failed to evaluate condition: ${error}`);
    return true;
  }
}

/**
 * 创建默认日志器
 * @returns {Object} Logger 对象
 */
function createDefaultLogger() {
  return {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
  };
}

module.exports = {
  Orchestrator,
  validateOrchestrationYaml,
  evaluateCondition,
};
