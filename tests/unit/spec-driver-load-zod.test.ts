import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// load-zod.mjs 是 ESM .mjs，用静态相对路径动态 import（顶层不固化任何态）
const LOAD_ZOD_PATH = '../../plugins/spec-driver/scripts/lib/load-zod.mjs';

/**
 * 用例间隔离：清环境变量 + 清 memoize 缓存，避免 loadZod 的 _cache 跨用例污染。
 */
interface LoadZodModule {
  loadZod: () => { z: unknown; available: boolean; error: Error | null };
  __resetZodCacheForTest: () => void;
}

async function freshLoadZodModule(): Promise<LoadZodModule> {
  const mod = await import(LOAD_ZOD_PATH);
  return mod as unknown as LoadZodModule;
}

describe('load-zod.mjs::loadZod', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    const { __resetZodCacheForTest } = await freshLoadZodModule();
    __resetZodCacheForTest();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    const { __resetZodCacheForTest } = await freshLoadZodModule();
    __resetZodCacheForTest();
  });

  it('zod 正常在场时返回 { available: true, z 非 null, error: null }', async () => {
    const { loadZod } = await freshLoadZodModule();
    const result = loadZod();
    expect(result.available).toBe(true);
    expect(result.z).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it('SPEC_DRIVER_FORCE_ZOD_MISSING=1 时返回 { available: false, z: null, error 非 null }', async () => {
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING = '1';
    const { loadZod, __resetZodCacheForTest } = await freshLoadZodModule();
    __resetZodCacheForTest();
    const result = loadZod();
    expect(result.available).toBe(false);
    expect(result.z).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('memoize：同一进程连续两次调用返回相同对象引用', async () => {
    const { loadZod } = await freshLoadZodModule();
    const first = loadZod();
    const second = loadZod();
    expect(first).toBe(second);
  });

  it('__resetZodCacheForTest 后改变环境变量可切换态', async () => {
    const { loadZod, __resetZodCacheForTest } = await freshLoadZodModule();
    // 先正常态
    const available = loadZod();
    expect(available.available).toBe(true);
    // reset + 设 env → 缺失态
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING = 'true';
    __resetZodCacheForTest();
    const missing = loadZod();
    expect(missing.available).toBe(false);
    // reset + 清 env → 恢复正常态
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    __resetZodCacheForTest();
    const restored = loadZod();
    expect(restored.available).toBe(true);
  });

  it('loadZod 永不抛（无论 zod 在否）', async () => {
    const { loadZod, __resetZodCacheForTest } = await freshLoadZodModule();
    expect(() => loadZod()).not.toThrow();
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING = '1';
    __resetZodCacheForTest();
    expect(() => loadZod()).not.toThrow();
  });
});
