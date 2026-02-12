/**
 * Mermaid 类图生成器
 * 从 CodeSkeleton exports 生成 classDiagram 源码（FR-007）
 * 参见 contracts/generator.md
 */
import type { CodeSkeleton, ExportSymbol } from '../models/code-skeleton.js';

/**
 * 转义 Mermaid 中的特殊字符
 */
function escapeMermaid(str: string): string {
  return str.replace(/[<>{}()[\]|]/g, '');
}

/**
 * 简化类型签名用于 Mermaid 显示
 */
function simplifyType(signature: string): string {
  // 移除 async、function 关键字等，保留核心签名
  return signature
    .replace(/^async\s+/, '')
    .replace(/^function\s+/, '')
    .replace(/^const\s+/, '')
    .slice(0, 80);
}

/**
 * 从 ExportSymbol 生成 Mermaid 类图条目
 */
function renderExport(exp: ExportSymbol): string[] {
  const lines: string[] = [];

  if (exp.kind === 'class' || exp.kind === 'interface') {
    lines.push(`  class ${escapeMermaid(exp.name)} {`);

    // 添加 <<interface>> 构造型
    if (exp.kind === 'interface') {
      lines.push(`    <<interface>>`);
    }

    // 渲染成员
    if (exp.members) {
      for (const member of exp.members) {
        // 跳过私有成员
        if (member.visibility === 'private') continue;

        const prefix = member.visibility === 'protected' ? '#' : '+';
        const staticMark = member.isStatic ? '$' : '';
        const abstractMark = member.isAbstract ? '*' : '';

        if (member.kind === 'method' || member.kind === 'constructor') {
          lines.push(
            `    ${prefix}${escapeMermaid(member.signature)}${staticMark}${abstractMark}`,
          );
        } else if (member.kind === 'property') {
          lines.push(
            `    ${prefix}${escapeMermaid(member.signature)}${staticMark}`,
          );
        } else if (member.kind === 'getter' || member.kind === 'setter') {
          lines.push(
            `    ${prefix}${escapeMermaid(member.signature)}`,
          );
        }
      }
    }

    lines.push('  }');
  }

  return lines;
}

/**
 * 从签名中提取继承/实现关系
 */
function extractRelationships(exp: ExportSymbol): string[] {
  const relationships: string[] = [];

  // 从签名中提取 extends
  const extendsMatch = /extends\s+(\w+)/.exec(exp.signature);
  if (extendsMatch?.[1]) {
    relationships.push(`  ${extendsMatch[1]} <|-- ${exp.name}`);
  }

  // 从签名中提取 implements
  const implMatch = /implements\s+(.+)$/.exec(exp.signature);
  if (implMatch?.[1]) {
    const interfaces = implMatch[1].split(',').map((s) => s.trim());
    for (const iface of interfaces) {
      const ifaceName = iface.split('<')[0]!.trim();
      if (ifaceName) {
        relationships.push(`  ${ifaceName} <|.. ${exp.name}`);
      }
    }
  }

  // 检查成员中的组合关系
  if (exp.members) {
    const seen = new Set<string>();
    for (const member of exp.members) {
      if (member.kind === 'property') {
        // 从类型中检测组合关系
        const typeMatch = /:\s*(\w+)(?:\[\])?$/.exec(member.signature);
        if (typeMatch?.[1] && /^[A-Z]/.test(typeMatch[1]) && !seen.has(typeMatch[1])) {
          seen.add(typeMatch[1]);
          relationships.push(`  ${exp.name} *-- ${typeMatch[1]}`);
        }
      }
    }
  }

  return relationships;
}

/**
 * 从 CodeSkeleton 生成 Mermaid classDiagram 源码
 *
 * @param skeleton - AST 提取的 CodeSkeleton
 * @returns Mermaid classDiagram 源码字符串
 */
export function generateClassDiagram(skeleton: CodeSkeleton): string {
  const classExports = skeleton.exports.filter(
    (e) => e.kind === 'class' || e.kind === 'interface',
  );

  if (classExports.length === 0) {
    return '';
  }

  const lines: string[] = ['classDiagram'];
  const relationships: string[] = [];

  for (const exp of classExports) {
    lines.push(...renderExport(exp));
    relationships.push(...extractRelationships(exp));
  }

  // 去重并添加关系
  const uniqueRelationships = [...new Set(relationships)];
  if (uniqueRelationships.length > 0) {
    lines.push('');
    lines.push(...uniqueRelationships);
  }

  return lines.join('\n');
}
