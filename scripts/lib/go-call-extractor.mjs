/**
 * Go Call Site AST Extractor — Stub
 *
 * Phase 4A 占位：实际实现在 Phase 4C (T-010) 由 spec-driver-feature 流程交付。
 *
 * 实现指引（plan.md §Tree-sitter query 关键模式）：
 * - call_expression (callee = identifier) → function
 * - call_expression (callee = selector_expression) → method / static (按 receiver capitalization 区分)
 * - unresolved: reflect / interface{} / generics
 */

/**
 * @typedef {Object} TruthCall
 * @property {string} caller
 * @property {string} callee
 * @property {string} file
 * @property {number} line
 * @property {'method'|'function'|'static'|'unresolved'} kind
 */

/**
 * @typedef {Object} ExtractResult
 * @property {string} language - 'go'
 * @property {TruthCall[]} truthCalls
 * @property {Array<{file: string, line?: number, code: string, message?: string}>} warnings
 */

/**
 * 从 Go 源码 root 抽取 truth calls
 * @param {{sourceRoot: string, baseline?: object}} options
 * @returns {Promise<ExtractResult>}
 */
export async function extractGoCallSites(_options) {
  throw new Error(
    '[go-call-extractor] not yet implemented — Phase 4C (T-010) will deliver this. ' +
    'See specs/150-graph-accuracy-extension/tasks.md',
  );
}
