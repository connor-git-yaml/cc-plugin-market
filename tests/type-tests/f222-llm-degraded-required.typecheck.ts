/**
 * Feature 222 类型断言：`GenerateSpecResult.llmDegraded` 必须保持**必填**。
 *
 * why 需要专门锁定：该字段是 batch 降级统计与 `--require-llm` 校验的唯一真值来源，
 * 消费端用 truthiness 读取。一旦被改成 optional，漏赋值的 `undefined` 会静默等价 false，
 * 严格模式就会放行 AST-only 产物，且没有任何运行时测试能捕获这一退化。
 *
 * 跑方式: `npm run typecheck:tests`
 */

import type { GenerateSpecResult } from '../../src/core/single-spec-orchestrator.js';

// 工具类型：断言 K 是 T 的 required 字段
type IsRequired<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

const _llmDegraded_required: IsRequired<GenerateSpecResult, 'llmDegraded'> = true;

// 值域必须是确定的 boolean，不能退化成 `boolean | undefined`
const _llmDegraded_boolean: GenerateSpecResult['llmDegraded'] extends boolean ? true : false = true;

// 防止"未使用"警告 — 导出确保未被 tree-shake
export const __f222_type_assertions = {
  _llmDegraded_required,
  _llmDegraded_boolean,
};
