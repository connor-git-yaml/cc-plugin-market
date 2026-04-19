/**
 * spec 身份标识类型与辅助函数
 *
 * 定义 SpecSourceKind 类型和 getDefaultSourceKind 辅助函数，
 * 用于区分 canonical（权威原始）、derived（衍生）、bundle_copy（bundle 副本）。
 */

/**
 * spec 身份类型
 * - canonical：权威原始 spec，由 batch 生成并直接对应源代码模块
 * - derived：从 canonical 派生的变体（如翻译版、摘要版），内容可能不同
 * - bundle_copy：bundle 打包时原样复制的副本，内容与 canonical 完全一致
 *
 * 历史遗留 spec（缺少此字段）默认视为 canonical。
 */
export type SpecSourceKind = 'canonical' | 'derived' | 'bundle_copy';

/**
 * 将原始值（可能来自 frontmatter 解析）规范化为合法的 SpecSourceKind。
 *
 * 向后兼容规则：
 * - 缺失值（undefined / null / ''）→ 'canonical'
 * - 非法字符串 → 'canonical'
 * - 合法的枚举值 → 原样返回
 *
 * @param value 待规范化的原始值
 * @returns 合法的 SpecSourceKind，缺失或无效时返回 'canonical'
 */
export function getDefaultSourceKind(value?: string | null): SpecSourceKind {
  if (value === 'canonical' || value === 'derived' || value === 'bundle_copy') {
    return value;
  }
  return 'canonical';
}
