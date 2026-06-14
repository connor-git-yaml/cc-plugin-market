/**
 * load-zod.mjs -- 共享的同步 zod 加载 helper。
 *
 * 为什么需要：spec-driver 脚本原本在多个 schema 模块顶层 `import { z } from 'zod'`。
 * ESM 顶层 import 在模块加载期静态解析，缺 zod（如插件缓存目录无 node_modules）时
 * 会抛 ERR_MODULE_NOT_FOUND 硬崩，无法被运行时 try/catch 捕获。
 *
 * 本 helper 用 createRequire + require('zod') 同步加载（zod 自带 CJS 入口，可 require），
 * 把"加载期硬崩"收敛为"可捕获的运行时缺失"：缺 zod 时返回 { available: false }
 * 而非抛错，从而让调用方决定降级路径。保持全同步调用链，避免动态 import 的 async 涟漪。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// memoize：首次加载结果缓存，后续直接返回，避免重复 require / 重复求值
let _cache = null;

/**
 * 同步加载 zod，永不抛错。
 * @returns {{ z: object|null, available: boolean, error: Error|null }}
 *   - z：可用时为 zod 命名空间（mod.z ?? mod），缺失时为 null
 *   - available：zod 是否成功加载
 *   - error：缺失时的捕获错误（用于诊断），可用时为 null
 */
export function loadZod() {
  if (_cache) return _cache;

  // 测试 seam：强制走缺失分支，使"缺 zod"路径可在有 node_modules 的仓库内被复现
  if (
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING === '1' ||
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING === 'true'
  ) {
    _cache = {
      z: null,
      available: false,
      error: new Error('zod 加载被 SPEC_DRIVER_FORCE_ZOD_MISSING 强制禁用'),
    };
    return _cache;
  }

  try {
    const mod = require('zod');
    // zod 的 CJS 模块上 `.z` 是命名空间；某些打包形态下退回 mod 本体
    const z = mod.z ?? mod;
    _cache = { z, available: true, error: null };
  } catch (error) {
    // require 缺失抛 MODULE_NOT_FOUND（可捕获），降级为运行时缺失而非加载期硬崩
    _cache = { z: null, available: false, error };
  }

  return _cache;
}

/**
 * 仅供测试使用：清空 memoize 缓存，使同进程内可在切换环境变量后重新求值。
 * 注意：本函数只清 load-zod.mjs 内的 _cache，不影响已加载 schema 模块固化的 zodAvailable。
 */
export function __resetZodCacheForTest() {
  _cache = null;
}
