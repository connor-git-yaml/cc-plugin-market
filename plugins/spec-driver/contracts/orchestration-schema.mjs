/**
 * orchestration-schema.mjs
 * Feature 133 — orchestration 配置的 Zod 三件套 Schema 定义
 *
 * 导出：
 *   - phaseSchema                  Phase 定义 Schema（base 用）
 *   - gateDefinitionSchema         Gate 定义 Schema（base 用）
 *   - gateOverrideSchema           Gate 覆盖 Schema（overrides 用）
 *   - modeDefinitionSchema         Mode 定义 Schema（base 用）
 *   - modeOverrideSchema           Mode 覆盖 Schema（overrides 用）
 *   - parallelGroupSchema          并行组 Schema（base 用）
 *   - parallelSchedulingSchema     全局并行调度 Schema
 *   - orchestrationBaseSchema      校验 plugin base orchestration.yaml
 *   - orchestrationOverridesSchema 校验项目级 overrides 文件
 *   - orchestrationMergedSchema    校验合并后的 config（复用 base schema）
 *   - formatZodIssue               Zod issue 中文化格式辅助函数
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Zod issue 中文化格式辅助
// ─────────────────────────────────────────────────────────────

/**
 * 将 Zod issue 格式化为中文可读的错误信息
 * @param {import('zod').ZodIssue} issue
 * @returns {string}
 */
export function formatZodIssue(issue) {
  const path = issue.path.length > 0 ? `字段 "${issue.path.join('.')}"` : '配置根';
  switch (issue.code) {
    case 'invalid_type':
      return `${path}：类型错误，期望 ${issue.expected}，实际为 ${issue.received}`;
    case 'invalid_enum_value':
      return `${path}：不合法的枚举值 "${issue.received}"，合法值为 [${issue.options?.join(' | ')}]`;
    case 'unrecognized_keys':
      return `${path}：包含未识别的字段 [${issue.keys?.join(', ')}]`;
    case 'too_small':
      return `${path}：值过小，最小值为 ${issue.minimum}`;
    case 'too_big':
      return `${path}：值过大，最大值为 ${issue.maximum}`;
    case 'invalid_string':
      return `${path}：字符串格式不合法`;
    default:
      return `${path}：${issue.message}`;
  }
}

// ─────────────────────────────────────────────────────────────
// 共用子 Schema 基础类型（从 orchestration.yaml 实际结构推导）
// ─────────────────────────────────────────────────────────────

/**
 * Phase 定义 Schema（base orchestration.yaml 中 phases 数组元素）
 *
 * 关键观察（来自 orchestration.yaml 实际字段）：
 *   - agent: null | string | string[]（三种形态）
 *   - agent_mode: inline | single | parallel_group | gate | orchestrator_verify | batch_loop
 *   - gates_before / gates_after: null | string[]（nullable，非 optional）
 *   - conditional / skip_if_exists: null | string（nullable）
 *   - is_critical: boolean
 */
export const phaseSchema = z.object({
  id: z.string({ required_error: 'phase id 为必填字段' }),
  name: z.string({ required_error: 'phase name 为必填字段' }),
  display_name: z.string({ required_error: 'phase display_name 为必填字段' }),
  // agent 可以是 null、string 或 string 数组（parallel_group 模式时）
  agent: z.union([
    z.null(),
    z.string(),
    z.array(z.string()),
  ]),
  // agent_mode 枚举——来自 orchestration.yaml 实际值
  agent_mode: z.enum([
    'inline',
    'single',
    'parallel_group',
    'gate',
    'orchestrator_verify',
    'batch_loop',
  ], {
    error_map: (issue) => {
      if (issue.code === 'invalid_enum_value') {
        return {
          message: `agent_mode 不合法：期望 [inline|single|parallel_group|gate|orchestrator_verify|batch_loop]，实际为 "${issue.received}"`,
        };
      }
      return { message: issue.message };
    },
  }),
  // gates_before / gates_after：null 或 string 数组（YAML 中的 null 必须用 .nullable()）
  gates_before: z.array(z.string()).nullable(),
  gates_after: z.array(z.string()).nullable(),
  // conditional / skip_if_exists：null 或字符串表达式
  conditional: z.string().nullable(),
  skip_if_exists: z.string().nullable(),
  is_critical: z.boolean(),
});

/**
 * Gate 定义 Schema（base orchestration.yaml 中 gates 块）
 *
 * 关键观察：
 *   - type: string（自由文本，如 "research_checkpoint"）
 *   - applicable_modes: string[] 或不存在（非所有 gate 都有此字段）
 *   - default_behavior: "always" | "auto" | "on_failure" | "skip"（skip 表示跳过该 gate 检查点）
 *   - severity: "critical" | "non_critical"（实际值，非 spec 定义的 warning/info）
 *   - hard_gate_modes: null | string[]（nullable）
 *   - insertion_point: null | string（nullable）
 */
export const gateDefinitionSchema = z.object({
  type: z.string(),
  // applicable_modes 在某些 gate 中存在（如 GATE_RESEARCH），某些不存在（如 GATE_VERIFY 有）
  // 实际上所有 gate 都有此字段，但为了健壮性设为 optional
  applicable_modes: z.array(z.string()).optional(),
  description: z.string(),
  // 实际 default_behavior 值包含 on_failure 和 skip（override 场景允许 skip 跳过 gate）
  default_behavior: z.enum(['always', 'auto', 'on_failure', 'skip'], {
    error_map: (issue) => {
      if (issue.code === 'invalid_enum_value') {
        return {
          message: `default_behavior 不合法：期望 [always | auto | on_failure | skip]，实际为 "${issue.received}"`,
        };
      }
      return { message: issue.message };
    },
  }),
  // 实际 severity 值为 "critical" 和 "non_critical"（非 spec 文档定义的 warning/info）
  severity: z.enum(['critical', 'non_critical', 'warning', 'info'], {
    error_map: (issue) => {
      if (issue.code === 'invalid_enum_value') {
        return {
          message: `severity 不合法：期望 [critical | non_critical | warning | info]，实际为 "${issue.received}"`,
        };
      }
      return { message: issue.message };
    },
  }),
  // hard_gate_modes：YAML 中显式为 null（必须用 .nullable()，不能用 .optional()）
  hard_gate_modes: z.array(z.string()).nullable(),
  // insertion_point：YAML 中显式为 null 或字符串
  insertion_point: z.string().nullable(),
});

/**
 * Gate 覆盖 Schema（overrides 文件中 gates 块，仅允许部分字段）
 * 只有 default_behavior / severity / hard_gate_modes 可被覆盖
 */
export const gateOverrideSchema = z.object({
  // overrides 中的 default_behavior 允许 always/auto/on_failure/skip（与 gateDefinitionSchema 对齐）
  default_behavior: z.enum(['always', 'auto', 'on_failure', 'skip']).optional(),
  severity: z.enum(['critical', 'non_critical', 'warning', 'info']).optional(),
  // hard_gate_modes 整段替换，非追加
  hard_gate_modes: z.array(z.string()).optional(),
}).strict();

/**
 * Mode 定义 Schema（base orchestration.yaml 中 modes 块）
 */
export const modeDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  phases: z.array(phaseSchema).min(1, { message: 'phases 数组不能为空' }),
});

/**
 * Mode 覆盖 Schema（overrides 文件中 modes 块，整段替换语义）
 * 整段替换要求用户提供完整的 mode 定义（name/description/phases）
 * extends 字段为 MVP 预留：schema 接受但 resolver 不处理
 */
export const modeOverrideSchema = z.object({
  name: z.string().optional(),         // 与 modeDefinitionSchema 保持一致（整段替换时合并进 mergedModes）
  description: z.string().optional(),  // 同上
  extends: z.string().optional(),      // 二期预留，MVP 接受但不处理
  // phases 的 agent_mode 在 override 场景下也接受额外值，或直接复用 phaseSchema
  phases: z.array(phaseSchema).min(0),
}).strip();  // strip 未知字段（与整体 .strict() 策略一致；二期新增字段时在此处显式声明）

/**
 * 并行组 Schema（base orchestration.yaml 中 parallel_groups 块）
 */
export const parallelGroupSchema = z.object({
  members: z.array(z.string()),
  convergence_point: z.string(),
  fallback_strategy: z.string(),
  max_concurrent: z.number().int().positive(),
  description: z.string(),
});

/**
 * 全局并行调度 Schema（base orchestration.yaml 中 parallel_scheduling 块）
 */
export const parallelSchedulingSchema = z.object({
  max_concurrent_tasks: z.number().int().positive(),
  fallback_to_serial_on_failure: z.boolean(),
  fallback_reason_log: z.boolean(),
});

// ─────────────────────────────────────────────────────────────
// Base reserved mode names（FR-007-A，CL-001）
// ─────────────────────────────────────────────────────────────

/** Base 保留 mode 名称列表（overrides schema 中做 enum 校验）*/
export const BASE_RESERVED_MODE_NAMES = [
  'feature',
  'story',
  'implement',
  'fix',
  'resume',
  'sync',
  'doc',
  'refactor',
];

// ─────────────────────────────────────────────────────────────
// 三件套 Schema
// ─────────────────────────────────────────────────────────────

/**
 * orchestrationBaseSchema — 校验 plugin base orchestration.yaml
 *
 * 设计原则（FR-024 / R11）：先以现有 orchestration.yaml 内容为准定义 schema，
 * 确保现有文件 100% 通过 Zod 校验，再扩展为 overrides 使用。
 *
 * 字段清单（来自 orchestration.yaml 实际结构）：
 *   - version: string，必填
 *   - parallel_scheduling: 并行调度配置
 *   - gates: Record<GATE_ID, GateDefinition>
 *   - parallel_groups: Record<GROUP_ID, ParallelGroup>
 *   - modes: Record<ModeName, ModeDefinition>（所有 8 个模式）
 */
export const orchestrationBaseSchema = z.object({
  version: z.string({ required_error: 'version 为必填字段' }),
  parallel_scheduling: parallelSchedulingSchema,
  gates: z.record(z.string(), gateDefinitionSchema),
  parallel_groups: z.record(z.string(), parallelGroupSchema),
  modes: z.record(z.string(), modeDefinitionSchema),
});

/**
 * orchestrationOverridesSchema — 校验项目级 .specify/orchestration-overrides.yaml
 *
 * 关键设计决策（GATE_DESIGN CL-001/010）：
 *   - version 必填（CL-008，resolver 比对 base version）
 *   - modes key 使用显式 z.object() 列出 8 个 mode（CL-001 enum 校验）
 *   - parallel_groups 字段：schema 接受但 transform 时 strip，发出 unsupported-field warning
 *   - $schema_version 和 modes.<m>.extends 字段：接受但 resolver 不特殊处理（FR-014）
 *
 * 注意：parallel_groups 由 resolver 步骤 6 手动检测并 strip；schema 层仅声明该字段以免被 .strict() 拒绝
 */
export const orchestrationOverridesSchema = z.object({
  // 二期预留字段：schema 接受但 MVP resolver 不处理（FR-014）
  $schema_version: z.string().optional(),

  // version 必填（CL-008）——resolver 层做 base/overrides version 比对
  version: z.string({ required_error: 'overrides 文件必须包含 version 字段' }),

  // modes key 使用显式枚举——拒绝非 reserved name（CL-001，FR-007-A）
  // 非 reserved 名 → safeParse 返回 error → 触发 schema-fallback → 整体 overrides 降级到 base
  // 使用 .strict() 拒绝任何不在 8 个 reserved name 中的 mode key
  modes: z.object({
    feature: modeOverrideSchema.optional(),
    story: modeOverrideSchema.optional(),
    implement: modeOverrideSchema.optional(),
    fix: modeOverrideSchema.optional(),
    resume: modeOverrideSchema.optional(),
    sync: modeOverrideSchema.optional(),
    doc: modeOverrideSchema.optional(),
    refactor: modeOverrideSchema.optional(),
  }).strict({
    message: 'modes 字段包含非法的 mode 名称，合法值为 [feature|story|implement|fix|resume|sync|doc|refactor]',
  }).optional(),

  // gates 字段：Record<GATE_ID, GateOverride>，对象级字段合并
  gates: z.record(z.string(), gateOverrideSchema).optional(),

  // parallel_scheduling：标量覆盖
  parallel_scheduling: z.object({
    max_concurrent_tasks: z.number().int().positive().optional(),
    fallback_to_serial_on_failure: z.boolean().optional(),
    fallback_reason_log: z.boolean().optional(),
  }).optional(),

  // parallel_groups：MVP 不支持覆盖，schema 接受但 resolver 层 strip + warning
  // 不 reject 整个 overrides，其余合法字段照常生效（CL-010，FR-022）
  // 使用 z.record() 保留类型信息，同时接受任意结构；由 resolver 在 parse 前检测并 strip
  parallel_groups: z.record(z.string(), z.unknown()).optional(),
}).strict({
  // 顶层真正未知字段使用 .strict() 策略拒绝（NFR-003）
  // 注意：parallel_groups 已显式声明，不会被 .strict() 拒绝
  message: 'overrides 文件包含未识别的顶层字段，请检查字段名称',
});

/**
 * orchestrationMergedSchema — 校验合并后的 config
 *
 * 合并结果必须满足 base schema 的全部约束（FR-013）
 * 复用 orchestrationBaseSchema 实现 DRY 原则（NFR-006）
 */
export const orchestrationMergedSchema = orchestrationBaseSchema;
