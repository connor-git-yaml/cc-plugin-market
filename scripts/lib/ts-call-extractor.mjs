/**
 * TypeScript / TSX Call Site AST Extractor — Stub
 *
 * Phase 4A 占位：实际实现在 Phase 4D (T-013) 由 spec-driver-feature 流程交付。
 * 当前 throw not implemented，让 graph-accuracy --language ts 立即报错指引用户。
 *
 * 实现指引（plan.md §Tree-sitter query 关键模式）：
 * - call_expression（method / function / arrow / IIFE）
 * - new_expression（constructor）
 * - decorator 内 call_expression（按 method 处理）
 * - unresolved: eval / 动态 import / Function 构造器
 */

/**
 * @typedef {Object} TruthCall
 * @property {string} caller
 * @property {string} callee
 * @property {string} file
 * @property {number} line
 * @property {'method'|'function'|'arrow'|'constructor'|'unresolved'} kind
 */

/**
 * @typedef {Object} ExtractResult
 * @property {string} language - 'ts'
 * @property {TruthCall[]} truthCalls
 * @property {Array<{file: string, line?: number, code: string, message?: string}>} warnings
 */

/**
 * 从 TS / TSX 源码 root 抽取 truth calls
 * @param {{sourceRoot: string, baseline?: object}} options
 * @returns {Promise<ExtractResult>}
 */
export async function extractTsCallSites(_options) {
  throw new Error(
    '[ts-call-extractor] not yet implemented — Phase 4D (T-013) will deliver this. ' +
    'See specs/150-graph-accuracy-extension/tasks.md',
  );
}
