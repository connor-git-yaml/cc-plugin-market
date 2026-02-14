/**
 * Mermaid 依赖关系图生成器
 * 从 CodeSkeleton 的 imports 数据生成模块间依赖关系图
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';

/**
 * 从 CodeSkeleton 生成 Mermaid 依赖关系图
 * 展示模块的内部/外部依赖关系
 *
 * @param skeleton - 合并后的 CodeSkeleton
 * @param skeletons - 原始各文件的 CodeSkeleton（可选，用于展示文件间关系）
 * @returns Mermaid graph 源码，或 null（无依赖时）
 */
export function generateDependencyDiagram(
  skeleton: CodeSkeleton,
  skeletons?: CodeSkeleton[],
): string | null {
  const imports = skeleton.imports;
  if (!imports || imports.length === 0) return null;

  // 分类依赖
  const internalDeps: string[] = [];
  const externalDeps: string[] = [];

  const seenInternal = new Set<string>();
  const seenExternal = new Set<string>();

  for (const imp of imports) {
    const modName = extractModuleName(imp.moduleSpecifier);

    if (imp.isRelative) {
      if (!seenInternal.has(modName)) {
        seenInternal.add(modName);
        internalDeps.push(modName);
      }
    } else if (!imp.isTypeOnly) {
      if (!seenExternal.has(modName)) {
        seenExternal.add(modName);
        externalDeps.push(modName);
      }
    }
  }

  // 至少需要一些依赖才值得生成图
  if (internalDeps.length === 0 && externalDeps.length === 0) return null;

  // 限制显示数量避免图太大
  const maxInternal = 15;
  const maxExternal = 10;
  const shownInternal = internalDeps.slice(0, maxInternal);
  const shownExternal = externalDeps.slice(0, maxExternal);

  const lines: string[] = ['graph LR'];

  // 当前模块节点
  const moduleName = extractModuleName(skeleton.filePath);
  lines.push(`  M["${moduleName}"]`);

  // 内部依赖
  if (shownInternal.length > 0) {
    for (const dep of shownInternal) {
      const safeId = sanitizeId(dep);
      lines.push(`  M --> ${safeId}["${dep}"]`);
    }
    if (internalDeps.length > maxInternal) {
      lines.push(`  M --> MORE_INT["...其他 ${internalDeps.length - maxInternal} 个内部模块"]`);
    }
  }

  // 外部依赖
  if (shownExternal.length > 0) {
    for (const dep of shownExternal) {
      const safeId = sanitizeId(dep);
      lines.push(`  M -.-> ${safeId}["📦 ${dep}"]`);
    }
    if (externalDeps.length > maxExternal) {
      lines.push(`  M -.-> MORE_EXT["...其他 ${externalDeps.length - maxExternal} 个外部包"]`);
    }
  }

  // 样式
  lines.push('  style M fill:#f9f,stroke:#333,stroke-width:2px');

  return lines.join('\n');
}

/**
 * 从 import 路径提取模块名
 * './auth/login' → 'auth/login'
 * 'node:fs' → 'node:fs'
 * '@anthropic-ai/sdk' → '@anthropic-ai/sdk'
 */
function extractModuleName(specifier: string): string {
  return specifier.replace(/^\.\//, '').replace(/\.[^.]+$/, '');
}

/**
 * 将模块名转换为合法的 Mermaid 节点 ID
 */
function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
