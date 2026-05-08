/**
 * 单一 runtime 初始化入口（FR-10 + SC-007）。
 *
 * 所有 entry point 必须调用 `bootstrapRuntime()`：
 * - src/mcp/server.ts（MCP entry）
 * - src/cli/index.ts（CLI entry）
 * - src/panoramic/batch-project-docs.ts（batch entry）
 * - src/panoramic/pipelines/coverage-auditor.ts（audit entry）
 *
 * 幂等性：内部 3 个 bootstrap 函数本身已幂等
 *（registry 非空时跳过；详见 generator-registry.ts / parser-registry.ts / adapters/index.ts）。
 *
 * SC-007 验收：
 *   grep -rE 'bootstrap(Adapters|Generators|Parsers)\(' src/ \
 *     | grep -v 'src/runtime-bootstrap.ts'
 *   → 期望 0 行命中（仅本文件调用 3 个 bootstrap 函数）
 */
import { bootstrapAdapters } from './adapters/index.js';
import { bootstrapGenerators } from './panoramic/generator-registry.js';
import { bootstrapParsers } from './panoramic/parser-registry.js';

/**
 * 一次性初始化 spectra runtime 的 3 个 registry。
 *
 * @param outputDir 可选的 generator 输出目录（透传给 bootstrapGenerators）。
 *   - mcp / cli 入口通常省略（generator 内部使用默认值）
 *   - batch / audit 入口可传入特定的 outputDir 指定 panoramic 文档落点
 */
export function bootstrapRuntime(outputDir?: string): void {
  bootstrapAdapters();
  bootstrapGenerators(outputDir);
  bootstrapParsers();
}
