/**
 * Java Call Site AST Extractor — Stub
 *
 * Phase 4A 占位：实际实现在 Phase 4B (T-006) 由 spec-driver-feature 流程交付。
 *
 * 实现指引（plan.md §Tree-sitter query 关键模式，Codex CRITICAL #1 修订后真实 node types）：
 * - method_invocation （基础方法调用，含 instance + static + super）
 *   - 检测第一子节点是 super keyword → kind: 'super'
 * - object_creation_expression （new ClassName()） → kind: 'constructor'
 * - explicit_constructor_invocation （构造器内 super() / this()） → kind: 'super'
 * - unresolved: Class.forName / JMX MBean / 反射 method invocation
 */

/**
 * @typedef {Object} TruthCall
 * @property {string} caller
 * @property {string} callee
 * @property {string} file
 * @property {number} line
 * @property {'method'|'static'|'constructor'|'super'|'unresolved'} kind
 */

/**
 * @typedef {Object} ExtractResult
 * @property {string} language - 'java'
 * @property {TruthCall[]} truthCalls
 * @property {Array<{file: string, line?: number, code: string, message?: string}>} warnings
 */

/**
 * 从 Java 源码 root 抽取 truth calls
 * @param {{sourceRoot: string, baseline?: object}} options
 * @returns {Promise<ExtractResult>}
 */
export async function extractJavaCallSites(_options) {
  throw new Error(
    '[java-call-extractor] not yet implemented — Phase 4B (T-006) will deliver this. ' +
    'See specs/150-graph-accuracy-extension/tasks.md',
  );
}
