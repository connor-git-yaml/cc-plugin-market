/**
 * 适配器模块导出入口
 * 提供接口、类型、Registry、具体适配器和启动注册函数
 */

// 接口与类型
export type { LanguageAdapter } from './language-adapter.js';
export type { LanguageTerminology } from './language-adapter.js';
export type { TestPatterns } from './language-adapter.js';
export type { AnalyzeFileOptions } from './language-adapter.js';
export type { DependencyGraphOptions } from './language-adapter.js';

// Registry
export { LanguageAdapterRegistry } from './language-adapter-registry.js';

// 具体适配器
export { TsJsLanguageAdapter } from './ts-js-adapter.js';
export { PythonLanguageAdapter } from './python-adapter.js';
export { GoLanguageAdapter } from './go-adapter.js';

// ============================================================
// 启动注册
// ============================================================

import { LanguageAdapterRegistry } from './language-adapter-registry.js';
import { TsJsLanguageAdapter } from './ts-js-adapter.js';
import { PythonLanguageAdapter } from './python-adapter.js';
import { GoLanguageAdapter } from './go-adapter.js';

/**
 * 启动适配器注册
 * 在 CLI/MCP 入口最早时机调用，完成所有内置适配器的注册。
 * 幂等：如果已有适配器注册则跳过。
 */
export function bootstrapAdapters(): void {
  const registry = LanguageAdapterRegistry.getInstance();

  // 幂等检查：防止重复注册
  if (registry.getAllAdapters().length > 0) {
    return;
  }

  registry.register(new TsJsLanguageAdapter());
  registry.register(new PythonLanguageAdapter());
  registry.register(new GoLanguageAdapter());

  // 未来扩展点：
  // registry.register(new JavaLanguageAdapter());
}
