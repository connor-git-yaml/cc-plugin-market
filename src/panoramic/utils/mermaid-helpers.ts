/**
 * Mermaid 图表辅助函数
 *
 * 提供跨 Generator 共享的 Mermaid 相关工具函数：
 * - sanitizeMermaidId: 将名称转义为合法的 Mermaid 节点 ID
 *
 * 此前 sanitizeMermaidId 分别在 workspace-index-generator.ts 和
 * data-model-generator.ts 中定义，导致重复代码。
 * 提取到此共享模块消除重复。
 */

/**
 * 将名称转义为合法的 Mermaid 节点 ID
 * 替换 @、/、-、. 等特殊字符为 _
 *
 * @param name - 原始名称
 * @returns 合法的 Mermaid 节点 ID
 */
export function sanitizeMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
