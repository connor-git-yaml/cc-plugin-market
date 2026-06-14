import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 禁止在测试文件顶层静态 import 被测 schema 模块（否则 zodAvailable 会被首次加载固化为
// true，缺 zod 用例无法注入）。一律用例内动态 import + vi.resetModules() 防止 memoize 污染。
const ORCHESTRATION_SCHEMA_PATH = '../../plugins/spec-driver/contracts/orchestration-schema.mjs';
const LOAD_ZOD_PATH = '../../plugins/spec-driver/scripts/lib/load-zod.mjs';

// 9 个 schema 导出名（守卫化的全部 z.* schema；orchestrationMergedSchema 为别名）
const SCHEMA_EXPORT_NAMES = [
  'phaseSchema',
  'gateDefinitionSchema',
  'gateOverrideSchema',
  'modeDefinitionSchema',
  'modeOverrideSchema',
  'parallelGroupSchema',
  'parallelSchedulingSchema',
  'orchestrationBaseSchema',
  'orchestrationOverridesSchema',
  'orchestrationMergedSchema',
] as const;

interface ZodSchemaLike {
  safeParse: (input: unknown) => { success: boolean };
}

interface OrchestrationSchemaModule {
  zodAvailable: boolean;
  phaseSchema: ZodSchemaLike | null;
  gateDefinitionSchema: ZodSchemaLike | null;
  gateOverrideSchema: ZodSchemaLike | null;
  modeDefinitionSchema: ZodSchemaLike | null;
  modeOverrideSchema: ZodSchemaLike | null;
  parallelGroupSchema: ZodSchemaLike | null;
  parallelSchedulingSchema: ZodSchemaLike | null;
  orchestrationBaseSchema: ZodSchemaLike | null;
  orchestrationOverridesSchema: ZodSchemaLike | null;
  orchestrationMergedSchema: ZodSchemaLike | null;
  formatZodIssue: (issue: unknown) => string;
  BASE_RESERVED_MODE_NAMES: string[];
}

async function importOrchestrationSchema(): Promise<OrchestrationSchemaModule> {
  return (await import(ORCHESTRATION_SCHEMA_PATH)) as unknown as OrchestrationSchemaModule;
}

async function resetZodCache(): Promise<void> {
  const { __resetZodCacheForTest } = (await import(LOAD_ZOD_PATH)) as {
    __resetZodCacheForTest: () => void;
  };
  __resetZodCacheForTest();
}

describe('orchestration-schema.mjs — zod 在场（防回归）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('zodAvailable === true 且全部 9 个 schema 导出非 null', async () => {
    const mod = await importOrchestrationSchema();
    expect(mod.zodAvailable).toBe(true);
    for (const name of SCHEMA_EXPORT_NAMES) {
      expect(mod[name], `${name} 应为非 null schema`).not.toBeNull();
    }
  });

  it('formatZodIssue 可调用、BASE_RESERVED_MODE_NAMES 为非空数组', async () => {
    const mod = await importOrchestrationSchema();
    expect(typeof mod.formatZodIssue).toBe('function');
    expect(Array.isArray(mod.BASE_RESERVED_MODE_NAMES)).toBe(true);
    expect(mod.BASE_RESERVED_MODE_NAMES.length).toBeGreaterThan(0);
    expect(mod.BASE_RESERVED_MODE_NAMES).toContain('fix');
  });

  it('phaseSchema.safeParse 对合法 phase 返回 success: true（smoke）', async () => {
    const mod = await importOrchestrationSchema();
    const result = mod.phaseSchema!.safeParse({
      id: 'specify',
      name: 'specify',
      display_name: 'Specify',
      agent: null,
      agent_mode: 'single',
      gates_before: null,
      gates_after: null,
      conditional: null,
      skip_if_exists: null,
      is_critical: true,
    });
    expect(result.success).toBe(true);
  });

  it('orchestrationMergedSchema 与 orchestrationBaseSchema 为同一引用（别名）', async () => {
    const mod = await importOrchestrationSchema();
    expect(mod.orchestrationMergedSchema).toBe(mod.orchestrationBaseSchema);
  });
});

describe('orchestration-schema.mjs — 缺 zod 守卫降级（最高风险点）', () => {
  beforeEach(async () => {
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING = '1';
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('模块 import 不抛任何错（无 ReferenceError / MODULE_NOT_FOUND）', async () => {
    await expect(importOrchestrationSchema()).resolves.toBeDefined();
  });

  it('zodAvailable === false 且全部 9 个 schema 导出为 null', async () => {
    const mod = await importOrchestrationSchema();
    expect(mod.zodAvailable).toBe(false);
    for (const name of SCHEMA_EXPORT_NAMES) {
      expect(mod[name], `${name} 缺 zod 时应为 null`).toBeNull();
    }
  });

  it('formatZodIssue / BASE_RESERVED_MODE_NAMES 在缺 zod 时仍可访问（不进守卫）', async () => {
    const mod = await importOrchestrationSchema();
    expect(typeof mod.formatZodIssue).toBe('function');
    expect(Array.isArray(mod.BASE_RESERVED_MODE_NAMES)).toBe(true);
    expect(mod.BASE_RESERVED_MODE_NAMES).toContain('fix');
  });
});

describe('orchestration-schema.mjs — 导出 shape 稳定性（回归守护）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('全部预期导出名存在（无拼写错误导致的 undefined 导出）', async () => {
    const mod = await importOrchestrationSchema();
    const expectedExports = [
      ...SCHEMA_EXPORT_NAMES,
      'zodAvailable',
      'formatZodIssue',
      'BASE_RESERVED_MODE_NAMES',
    ];
    for (const name of expectedExports) {
      expect(
        Object.prototype.hasOwnProperty.call(mod, name),
        `导出 ${name} 应存在`,
      ).toBe(true);
    }
  });
});
