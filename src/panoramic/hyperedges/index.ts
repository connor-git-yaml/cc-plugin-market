/**
 * hyperedges 模块对外接口
 *
 * 导出 extractHyperedges 函数、相关类型和 Zod schema
 * 供 doc-graph-builder.ts 和其他调用方使用
 */

// ============================================================
// 主函数 + 类型导出
// ============================================================

export { extractHyperedges } from './extractor.js';
export type { ExtractHyperedgesOptions, ExtractResult } from './extractor.js';

// ============================================================
// Zod schema + 类型导出
// ============================================================

export { HyperedgesOutputSchema, HyperedgeSchema } from './schema.js';
export type { HyperedgeOutput, HyperedgeInput } from './schema.js';

// ============================================================
// Prompt 构造器导出（供测试/调试使用）
// ============================================================

export { buildHyperedgePrompt } from './prompt.js';
