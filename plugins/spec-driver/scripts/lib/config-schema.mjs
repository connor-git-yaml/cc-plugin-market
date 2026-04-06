/**
 * config-schema.mjs -- spec-driver.config.yaml 的 Zod Schema 定义、校验函数和 effective config 合并
 *
 * 导出:
 *   - specDriverConfigSchema   Zod Schema
 *   - BUILTIN_DEFAULTS         内置默认值
 *   - PRESET_DEFAULTS          preset 默认值表
 *   - COMMON_CONFIG_FILES      通用配置文件排除列表（跨 Feature 冲突检测用）
 *   - validateConfig()         Schema 校验入口
 *   - suggestField()           编辑距离字段建议
 *   - resolveEffectiveConfig() effective config 合并
 */

import { z } from 'zod';

// ────────────────────────────────────────
// 子 Schema
// ────────────────────────────────────────

const modelNameSchema = z.enum(['opus', 'sonnet', 'haiku'])
  .or(z.string().min(1));

const agentOverrideSchema = z.object({
  model: modelNameSchema.optional(),
}).strict();

const agentsSchema = z.record(
  z.string(),
  agentOverrideSchema,
).optional();

const aliasMapSchema = z.record(z.string(), z.string());

const modelCompatSchema = z.object({
  runtime: z.enum(['auto', 'claude', 'codex']).default('auto'),
  aliases: z.object({
    codex: aliasMapSchema.optional(),
    claude: aliasMapSchema.optional(),
  }).optional(),
  defaults: z.object({
    codex: z.string().optional(),
    claude: z.string().optional(),
  }).optional(),
}).optional();

const codexSchema = z.object({
  service_tier: z.enum(['fast', 'standard', 'flex']).default('fast'),
}).optional();

const codexThinkingSchema = z.object({
  default_level: z.enum(['low', 'medium', 'high', 'xhigh']).default('xhigh'),
  level_map: z.record(z.string(), z.enum(['low', 'medium', 'high', 'xhigh'])).optional(),
}).optional();

const researchSchema = z.object({
  default_mode: z.enum([
    'auto', 'full', 'tech-only', 'product-only',
    'codebase-scan', 'skip', 'custom',
  ]).default('auto'),
  custom_steps: z.array(z.string()).default([]),
}).optional();

const verificationSchema = z.object({
  commands: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  monorepo: z.object({
    enabled: z.boolean().default(true),
  }).optional(),
  timeout: z.number().int().positive().optional().default(300),
}).optional();

const gatePauseSchema = z.object({
  pause: z.enum(['always', 'auto', 'on_failure']),
});

const gatesSchema = z.record(z.string(), gatePauseSchema).optional();

const qualityGatesSchema = z.object({
  auto_continue_on_warning: z.boolean().default(true),
  pause_on_critical: z.boolean().default(true),
}).optional();

const retrySchema = z.object({
  max_attempts: z.number().int().min(0).max(10).default(2),
}).optional();

const progressSchema = z.object({
  show_stage_progress: z.boolean().default(true),
  show_stage_summary: z.boolean().default(true),
}).optional();

// ────────────────────────────────────────
// 顶层 Schema
// ────────────────────────────────────────

export const specDriverConfigSchema = z.object({
  preset: z.enum(['balanced', 'quality-first', 'cost-efficient']).default('balanced'),
  agents: agentsSchema,
  model_compat: modelCompatSchema,
  codex: codexSchema,
  codex_thinking: codexThinkingSchema,
  research: researchSchema,
  verification: verificationSchema,
  quality_gates: qualityGatesSchema,
  gate_policy: z.enum(['strict', 'balanced', 'autonomous']).default('balanced'),
  gates: gatesSchema,
  retry: retrySchema,
  progress: progressSchema,
}).strict();

// ────────────────────────────────────────
// 常量
// ────────────────────────────────────────

/** 编排器内置默认值 */
export const BUILTIN_DEFAULTS = {
  preset: 'balanced',
  gate_policy: 'balanced',
  'research.default_mode': 'auto',
  'research.custom_steps': [],
  'verification.timeout': 300,
  'verification.monorepo.enabled': true,
  'quality_gates.auto_continue_on_warning': true,
  'quality_gates.pause_on_critical': true,
  'retry.max_attempts': 2,
  'progress.show_stage_progress': true,
  'progress.show_stage_summary': true,
  'model_compat.runtime': 'auto',
  'codex.service_tier': 'fast',
  'codex_thinking.default_level': 'xhigh',
};

/** preset 默认值表 */
export const PRESET_DEFAULTS = {
  balanced: {
    'agents.product-research.model': 'opus',
    'agents.tech-research.model': 'opus',
    'agents.specify.model': 'opus',
    'agents.plan.model': 'opus',
    'agents.analyze.model': 'opus',
    'agents.clarify.model': 'sonnet',
    'agents.checklist.model': 'sonnet',
    'agents.tasks.model': 'sonnet',
    'agents.implement.model': 'sonnet',
    'agents.verify.model': 'sonnet',
  },
  'quality-first': {
    'agents.product-research.model': 'opus',
    'agents.tech-research.model': 'opus',
    'agents.specify.model': 'opus',
    'agents.plan.model': 'opus',
    'agents.analyze.model': 'opus',
    'agents.clarify.model': 'opus',
    'agents.checklist.model': 'opus',
    'agents.tasks.model': 'opus',
    'agents.implement.model': 'opus',
    'agents.verify.model': 'opus',
  },
  'cost-efficient': {
    'agents.product-research.model': 'sonnet',
    'agents.tech-research.model': 'sonnet',
    'agents.specify.model': 'sonnet',
    'agents.plan.model': 'sonnet',
    'agents.analyze.model': 'sonnet',
    'agents.clarify.model': 'sonnet',
    'agents.checklist.model': 'sonnet',
    'agents.tasks.model': 'sonnet',
    'agents.implement.model': 'sonnet',
    'agents.verify.model': 'sonnet',
  },
};

/** 通用配置文件排除列表（跨 Feature 冲突检测时排除） */
export const COMMON_CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  '.eslintrc.json',
  '.prettierrc',
  'spec-driver.config.yaml',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
]);

// ────────────────────────────────────────
// Levenshtein 编辑距离（手写，零外部依赖）
// ────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * 对未知字段名在已知字段列表中找最近匹配
 * @param {string} unknown - 用户输入的未知字段名
 * @param {string[]} knownFields - Schema 定义的合法字段名列表
 * @returns {string|null} - 最近匹配或 null（阈值 <= 3）
 */
export function suggestField(unknown, knownFields) {
  let bestMatch = null;
  let bestDist = 4; // 阈值 <= 3
  for (const field of knownFields) {
    const dist = levenshtein(unknown, field);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = field;
    }
  }
  return bestMatch;
}

// ────────────────────────────────────────
// Schema 校验
// ────────────────────────────────────────

/** 顶层 Schema 合法字段名列表 */
const KNOWN_TOP_LEVEL_FIELDS = [
  'preset', 'agents', 'model_compat', 'codex', 'codex_thinking',
  'research', 'verification', 'quality_gates', 'gate_policy',
  'gates', 'retry', 'progress',
];

/**
 * 校验已解析的 YAML 对象
 * @param {unknown} parsedYaml - 由 simple-yaml.mjs 解析后的对象
 * @returns {{ success: boolean, data?: object, diagnostics: Array<{ level: string, code: string, message: string, path?: string, suggestion?: string }> }}
 */
export function validateConfig(parsedYaml) {
  const diagnostics = [];

  // 空对象视为合法（全用默认值）
  if (parsedYaml === null || parsedYaml === undefined) {
    return { success: true, data: {}, diagnostics };
  }

  const result = specDriverConfigSchema.safeParse(parsedYaml);

  if (result.success) {
    // 校验通过后检查 warning 级别项
    const timeout = result.data?.verification?.timeout;
    if (timeout !== undefined && timeout > 3600) {
      diagnostics.push({
        level: 'warning',
        code: 'config.timeout-too-large',
        message: `\`verification.timeout\` 值 ${timeout} 偏大（超过 1 小时），确认是否有意为之`,
        path: 'verification.timeout',
      });
    }
    return { success: true, data: result.data, diagnostics };
  }

  // 解析 Zod 错误
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');

    if (issue.code === 'unrecognized_keys') {
      // 未知字段
      for (const key of issue.keys) {
        const suggestion = suggestField(key, KNOWN_TOP_LEVEL_FIELDS);
        const msg = suggestion
          ? `未知字段 \`${key}\`，你是否想写 \`${suggestion}\`?`
          : `未知字段 \`${key}\``;
        diagnostics.push({
          level: 'error',
          code: 'config.unknown-field',
          message: msg,
          path: path || key,
          suggestion: suggestion || undefined,
        });
      }
    } else if (issue.code === 'invalid_enum_value') {
      // 非法 enum 值
      const options = issue.options.map((o) => `\`${o}\``).join(' / ');
      diagnostics.push({
        level: 'error',
        code: 'config.invalid-enum',
        message: `\`${path}\` 值 \`${issue.received}\` 不合法，合法值: ${options}`,
        path,
      });
    } else if (issue.code === 'invalid_type') {
      // 类型不匹配
      diagnostics.push({
        level: 'error',
        code: 'config.invalid-type',
        message: `\`${path}\` 期望 ${issue.expected}，实际为 ${issue.received}`,
        path,
      });
    } else if (issue.code === 'too_small' && issue.type === 'number') {
      // 正整数校验（如 timeout）
      diagnostics.push({
        level: 'error',
        code: 'config.invalid-positive-int',
        message: `\`${path}\` 必须为正整数，当前值: ${issue.minimum !== undefined ? `< ${issue.minimum}` : '非法'}`,
        path,
      });
    } else {
      // 其他 Zod 错误
      diagnostics.push({
        level: 'error',
        code: 'config.invalid-type',
        message: `\`${path}\` ${issue.message}`,
        path,
      });
    }
  }

  return { success: false, data: undefined, diagnostics };
}

// ────────────────────────────────────────
// effective config 合并
// ────────────────────────────────────────

/**
 * 从嵌套对象中按点分路径取值
 * @param {object} obj
 * @param {string} dotPath - 如 "verification.timeout"
 * @returns {*} 值或 undefined
 */
function getNestedValue(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * 按优先级链合并配置，返回每项的生效值和来源
 * 优先级：命令行 --preset > config.yaml agents > config.yaml 顶层 > preset 默认值 > 内置默认值
 * @param {{ configYaml: object, presetOverride?: string }} options
 * @returns {Array<{ key: string, value: *, source: string }>}
 */
export function resolveEffectiveConfig(options) {
  const { configYaml = {}, presetOverride } = options;
  const entries = [];

  // 确定 preset
  const effectivePreset = presetOverride || configYaml.preset || BUILTIN_DEFAULTS.preset;
  const presetSource = presetOverride
    ? '--preset 命令行参数'
    : configYaml.preset
      ? 'config.yaml'
      : '内置默认';

  entries.push({ key: 'preset', value: effectivePreset, source: presetSource });

  // 非 preset 的顶层标量配置项
  const topLevelKeys = ['gate_policy'];
  for (const key of topLevelKeys) {
    if (configYaml[key] !== undefined) {
      entries.push({ key, value: configYaml[key], source: 'config.yaml' });
    } else if (BUILTIN_DEFAULTS[key] !== undefined) {
      entries.push({ key, value: BUILTIN_DEFAULTS[key], source: '内置默认' });
    }
  }

  // 嵌套配置项
  const nestedKeys = [
    'research.default_mode',
    'research.custom_steps',
    'verification.timeout',
    'verification.monorepo.enabled',
    'quality_gates.auto_continue_on_warning',
    'quality_gates.pause_on_critical',
    'retry.max_attempts',
    'progress.show_stage_progress',
    'progress.show_stage_summary',
    'model_compat.runtime',
    'codex.service_tier',
    'codex_thinking.default_level',
  ];

  for (const dotPath of nestedKeys) {
    const configVal = getNestedValue(configYaml, dotPath);
    if (configVal !== undefined) {
      entries.push({ key: dotPath, value: configVal, source: 'config.yaml' });
    } else if (BUILTIN_DEFAULTS[dotPath] !== undefined) {
      entries.push({ key: dotPath, value: BUILTIN_DEFAULTS[dotPath], source: '内置默认' });
    }
  }

  // preset 默认值提供的 agent 模型配置
  const presetDefaults = PRESET_DEFAULTS[effectivePreset] || {};
  const agents = configYaml.agents || {};

  // 收集 config.yaml 中显式配置的 agent
  for (const [agentId, agentConfig] of Object.entries(agents)) {
    if (agentConfig && agentConfig.model) {
      entries.push({
        key: `agents.${agentId}.model`,
        value: agentConfig.model,
        source: 'config.yaml agents',
      });
    }
  }

  // 补充 preset 默认值中有但 config.yaml 中没有显式配置的 agent
  for (const [dotPath, value] of Object.entries(presetDefaults)) {
    // dotPath 格式: "agents.xxx.model"
    const parts = dotPath.split('.');
    const agentId = parts[1];
    if (!agents[agentId]?.model) {
      entries.push({
        key: dotPath,
        value,
        source: presetOverride ? '--preset 命令行参数' : 'preset 默认值',
      });
    }
  }

  return entries;
}
