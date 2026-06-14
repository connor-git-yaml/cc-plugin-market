import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// W2 修正：禁止在测试文件顶层静态 import 被测 schema 模块（否则 zodAvailable 会被
// 首次加载固化为 true，缺 zod 用例无法注入）。一律用例内动态 import。
const CONFIG_SCHEMA_PATH = '../../plugins/spec-driver/scripts/lib/config-schema.mjs';
const LOAD_ZOD_PATH = '../../plugins/spec-driver/scripts/lib/load-zod.mjs';

type ValidateResult = {
  success: boolean;
  data?: unknown;
  degraded?: boolean;
  diagnostics: Array<{ level: string; code: string; message: string; path?: string }>;
};

interface ConfigSchemaModule {
  validateConfig: (parsedYaml: unknown) => ValidateResult;
  zodAvailable: boolean;
}

async function importConfigSchema(): Promise<ConfigSchemaModule> {
  return (await import(CONFIG_SCHEMA_PATH)) as unknown as ConfigSchemaModule;
}

async function resetZodCache(): Promise<void> {
  const { __resetZodCacheForTest } = (await import(LOAD_ZOD_PATH)) as {
    __resetZodCacheForTest: () => void;
  };
  __resetZodCacheForTest();
}

describe('config-schema.mjs::validateConfig — zod 在场（防回归）', () => {
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

  it('合法 config 返回 { success: true } 且不含 degraded', async () => {
    const { validateConfig, zodAvailable } = await importConfigSchema();
    expect(zodAvailable).toBe(true);
    const result = validateConfig({ preset: 'quality-first', gate_policy: 'strict' });
    expect(result.success).toBe(true);
    expect(result.degraded).toBeUndefined();
  });

  it('非法 enum 值仍产 error 诊断', async () => {
    const { validateConfig } = await importConfigSchema();
    const result = validateConfig({ preset: 'nonexistent-preset' });
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.level === 'error' && d.code === 'config.invalid-enum')).toBe(true);
  });

  it('unknown-field 仍产 error 诊断', async () => {
    const { validateConfig } = await importConfigSchema();
    const result = validateConfig({ presett: 'balanced' });
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.level === 'error' && d.code === 'config.unknown-field')).toBe(true);
  });
});

describe('config-schema.mjs::validateConfig — 缺 zod 降级', () => {
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

  it('config-schema.mjs 模块 import 不抛（AC-5 config 侧）', async () => {
    await expect(importConfigSchema()).resolves.toBeDefined();
  });

  it('zodAvailable=false 且 validateConfig 返回 degraded + config.zod-unavailable warning', async () => {
    const { validateConfig, zodAvailable } = await importConfigSchema();
    expect(zodAvailable).toBe(false);
    const result = validateConfig({ preset: 'balanced' });
    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      level: 'warning',
      code: 'config.zod-unavailable',
    });
  });

  it('缺 zod 时 best-effort 原样返回 data', async () => {
    const { validateConfig } = await importConfigSchema();
    const input = { preset: 'balanced', custom: 'kept' };
    const result = validateConfig(input);
    expect(result.data).toEqual(input);
  });
});
