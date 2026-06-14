import { loadZod } from './load-zod.mjs';

// 经共享 helper 同步加载 zod；缺失时 zodAvailable=false，模块加载不崩
const { z, available: zodAvailable } = loadZod();

export const EXCLUDED_EXECUTION_FIELDS = new Set([
  'phase_focus',
  'skip_spec',
  'implementation_only',
  'task_strategy',
]);

export const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'product',
  'owner',
  'references',
  'architecture_constraints',
  'verification_policy',
  'research_policy',
  'workflow_preferences',
  'forbidden_changes',
  'notes',
  // F191：scaffold-kb 预查注入配置（加入白名单避免 unknown-field 警告）
  'knowledge_sources',
]);

// schema 求值必须全部包进 zodAvailable 守卫：缺 zod 时模块体完全不触碰 z，
// 否则会从 MODULE_NOT_FOUND 退化为 ReferenceError —— 等于没修。
// ESM 语法限制 export const 不能进 if 块，故用 let 顶层声明 + 守卫内赋值 + 末尾统一 export。
let referenceEntryObjectSchema = null;
let referenceEntrySchema = null;
let resolvedReferenceEntrySchema = null;
let resolvedProjectProfileSchema = null;

if (zodAvailable) {
  referenceEntryObjectSchema = z.object({
    label: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    url: z.string().trim().url().optional(),
    required: z.boolean().optional(),
    purpose: z.string().trim().min(1).optional(),
  });

  referenceEntrySchema = referenceEntryObjectSchema.refine(
    (value) => Boolean(value.path || value.url),
    {
      message: 'reference entry requires either path or url',
    },
  );

  resolvedReferenceEntrySchema = referenceEntryObjectSchema.extend({
    exists: z.boolean().optional(),
    resolvedPath: z.string().trim().min(1).optional(),
    source: z.enum(['yaml', 'markdown']).optional(),
  });

  resolvedProjectProfileSchema = z.object({
    product: z
      .object({
        name: z.string().trim().min(1).optional(),
        summary: z.string().trim().min(1).optional(),
      })
      .nullable(),
    owner: z
      .object({
        name: z.string().trim().min(1).optional(),
        team: z.string().trim().min(1).optional(),
        email: z.string().trim().email().optional(),
      })
      .nullable(),
    references: z.array(resolvedReferenceEntrySchema),
    architectureConstraints: z.array(z.string().trim().min(1)),
    verificationPolicy: z.object({
      requireRealExecution: z.boolean(),
      requiredCommands: z.array(z.string().trim().min(1)),
      notes: z.array(z.string().trim().min(1)),
    }),
    researchPolicy: z.object({
      onlineRequired: z.boolean(),
      minPoints: z.number().int().min(0),
      maxPoints: z.number().int().min(0),
      preferredTools: z.array(z.string().trim().min(1)),
      notes: z.array(z.string().trim().min(1)),
    }),
    workflowPreferences: z.object({
      defaultMode: z.string().trim().min(1).nullable(),
      preferredPreset: z.string().trim().min(1).nullable(),
      notes: z.array(z.string().trim().min(1)),
    }),
    forbiddenChanges: z.array(z.string().trim().min(1)),
    notes: z.array(z.string().trim().min(1)),
    // F191：scaffold-kb 预查注入配置。OPTIONAL —— 仅 yaml 路径设置；md/fallback 路径省略仍合法，
    // 避免新增 required 字段触发 safeParse 失败 → whole-profile fallback 清空旧字段（Codex 零回归关注点）
    knowledgeSources: z
      .object({
        enabled: z.boolean(),
        vendorKb: z.string().nullable(),
        projectKb: z.string().nullable(),
        topK: z.number().int().positive(),
        maxInjectChars: z.number().int().positive(),
      })
      .optional(),
  });
}

export {
  zodAvailable,
  referenceEntryObjectSchema,
  referenceEntrySchema,
  resolvedReferenceEntrySchema,
  resolvedProjectProfileSchema,
};
