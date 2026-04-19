/**
 * sourceKind frontmatter schema — Zod 验证合同
 * Feature 128: Harden — SpecStore Abstraction
 *
 * 本文件定义 sourceKind / derivedFrom 字段的 Zod schema 合同。
 * 实际集成到 src/models/module-spec.ts 的 SpecFrontmatterSchema 中。
 *
 * 合同版本：1.0.0
 */
import { z } from 'zod';

// ============================================================
// SpecSourceKind schema
// ============================================================

/**
 * spec 身份类型枚举
 *
 * 注意：历史 spec 缺少此字段时，SpecStore 默认视为 'canonical'。
 * 这是一条 **应用层约定**，不在 schema 层强制（字段为 optional）。
 */
export const SpecSourceKindSchema = z.enum(['canonical', 'derived', 'bundle_copy']);

export type SpecSourceKind = z.infer<typeof SpecSourceKindSchema>;

// ============================================================
// 集成到 SpecFrontmatterSchema 的增量扩展
// ============================================================

/**
 * SpecFrontmatterIdentityExtensionSchema
 *
 * 使用方式：在 src/models/module-spec.ts 的 SpecFrontmatterSchema 中追加这两个字段：
 *
 * ```typescript
 * export const SpecFrontmatterSchema = z.object({
 *   // ... 现有字段 ...
 *   sourceKind: SpecSourceKindSchema.optional(),
 *   derivedFrom: z.string().nullable().optional(),
 * });
 * ```
 *
 * 两字段均为 optional 以保持向后兼容：现有 spec 不含这些字段，
 * Zod 解析会将其设为 undefined（不报错）。
 */
export const SpecFrontmatterIdentityExtensionSchema = z.object({
  /**
   * spec 身份类型（optional）
   * 缺失时 SpecStore 应用层默认视为 'canonical'
   */
  sourceKind: SpecSourceKindSchema.optional(),

  /**
   * 派生来源 spec 的 outputPath（相对于 projectRoot）
   * - canonical：null 或 undefined（无派生来源）
   * - derived/bundle_copy：源 canonical spec 的相对路径
   *   例：'specs/modules/batch-orchestrator.spec.md'
   */
  derivedFrom: z.string().nullable().optional(),
});

export type SpecFrontmatterIdentityExtension = z.infer<typeof SpecFrontmatterIdentityExtensionSchema>;

// ============================================================
// 手动 frontmatter 解析扩展
// ============================================================

/**
 * extractSourceKind
 *
 * 用于 doc-graph-builder.ts 中 extractStoredModuleSpecSummary 函数
 * 的手动 YAML 解析器增量扩展。
 *
 * 在现有的逐行扫描循环中，添加以下两个分支：
 *
 * ```typescript
 * if (line.startsWith('sourceKind:')) {
 *   const parsed = stripYamlScalar(line.slice('sourceKind:'.length).trim());
 *   if (parsed === 'canonical' || parsed === 'derived' || parsed === 'bundle_copy') {
 *     sourceKind = parsed;
 *   }
 *   inRelatedFiles = false;
 *   inCrossLanguageRefs = false;
 *   continue;
 * }
 *
 * if (line.startsWith('derivedFrom:')) {
 *   const val = stripYamlScalar(line.slice('derivedFrom:'.length).trim());
 *   derivedFrom = val === 'null' || val === '~' || val === '' ? null : val;
 *   inRelatedFiles = false;
 *   inCrossLanguageRefs = false;
 *   continue;
 * }
 * ```
 */
export function extractSourceKindFromLine(line: string): {
  field: 'sourceKind' | 'derivedFrom';
  value: SpecSourceKind | string | null;
} | null {
  const stripped = (raw: string) => {
    const val = raw.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1);
    }
    return val;
  };

  if (line.startsWith('sourceKind:')) {
    const raw = stripped(line.slice('sourceKind:'.length));
    if (raw === 'canonical' || raw === 'derived' || raw === 'bundle_copy') {
      return { field: 'sourceKind', value: raw };
    }
    return null;
  }

  if (line.startsWith('derivedFrom:')) {
    const raw = stripped(line.slice('derivedFrom:'.length));
    const value = raw === 'null' || raw === '~' || raw === '' ? null : raw;
    return { field: 'derivedFrom', value };
  }

  return null;
}
