/**
 * 结构化 Diff 引擎
 * 比较两个 CodeSkeleton，按严重级别分类差异（FR-019）
 * 参见 contracts/diff-engine.md
 */
import type { CodeSkeleton, ExportSymbol } from '../models/code-skeleton.js';
import type { DriftItem, Severity, DriftCategory, ChangeType } from '../models/drift-item.js';

let nextId = 0;

function generateId(): string {
  return `drift-${Date.now()}-${nextId++}`;
}

/**
 * 比较两个 CodeSkeleton，识别导出符号中的结构差异
 *
 * @param oldSkeleton - 基线骨架（spec 生成时）
 * @param newSkeleton - 当前源代码骨架
 * @returns DriftItem[]
 */
export function compareSkeletons(
  oldSkeleton: CodeSkeleton,
  newSkeleton: CodeSkeleton,
): DriftItem[] {
  const items: DriftItem[] = [];

  // 构建旧/新导出的映射
  const oldExports = new Map<string, ExportSymbol>();
  const newExports = new Map<string, ExportSymbol>();

  for (const exp of oldSkeleton.exports) {
    oldExports.set(exp.name, exp);
  }
  for (const exp of newSkeleton.exports) {
    newExports.set(exp.name, exp);
  }

  // 检测删除的导出（HIGH）
  for (const [name, oldExp] of oldExports) {
    if (!newExports.has(name)) {
      items.push({
        id: generateId(),
        severity: 'HIGH',
        category: 'Interface',
        changeType: 'removal',
        location: `${oldSkeleton.filePath}:${oldExp.startLine}`,
        symbolName: name,
        description: `导出符号 \`${name}\` (${oldExp.kind}) 已被删除 — Breaking Change`,
        oldValue: oldExp.signature,
        newValue: null,
        proposedUpdate: `从接口定义章节中移除 \`${name}\` 的文档`,
        detectedBy: 'structural',
      });
    }
  }

  // 检测新增的导出（LOW）
  for (const [name, newExp] of newExports) {
    if (!oldExports.has(name)) {
      items.push({
        id: generateId(),
        severity: 'LOW',
        category: 'Interface',
        changeType: 'addition',
        location: `${newSkeleton.filePath}:${newExp.startLine}`,
        symbolName: name,
        description: `新增导出符号 \`${name}\` (${newExp.kind})`,
        oldValue: null,
        newValue: newExp.signature,
        proposedUpdate: `在接口定义章节中添加 \`${name}\` 的文档`,
        detectedBy: 'structural',
      });
    }
  }

  // 检测修改的导出（MEDIUM）
  for (const [name, oldExp] of oldExports) {
    const newExp = newExports.get(name);
    if (!newExp) continue;

    // 比较签名
    if (oldExp.signature !== newExp.signature) {
      items.push({
        id: generateId(),
        severity: 'MEDIUM',
        category: 'Interface',
        changeType: 'modification',
        location: `${newSkeleton.filePath}:${newExp.startLine}`,
        symbolName: name,
        description: `导出符号 \`${name}\` 的签名已修改`,
        oldValue: oldExp.signature,
        newValue: newExp.signature,
        proposedUpdate: `更新接口定义章节中 \`${name}\` 的签名为 \`${newExp.signature}\``,
        detectedBy: 'structural',
      });
      continue;
    }

    // 比较类型参数
    const oldTypeParams = (oldExp.typeParameters ?? []).join(', ');
    const newTypeParams = (newExp.typeParameters ?? []).join(', ');
    if (oldTypeParams !== newTypeParams) {
      items.push({
        id: generateId(),
        severity: 'MEDIUM',
        category: 'Interface',
        changeType: 'modification',
        location: `${newSkeleton.filePath}:${newExp.startLine}`,
        symbolName: name,
        description: `导出符号 \`${name}\` 的类型参数已修改`,
        oldValue: oldTypeParams || '(无)',
        newValue: newTypeParams || '(无)',
        proposedUpdate: `更新 \`${name}\` 的类型参数文档`,
        detectedBy: 'structural',
      });
    }

    // 比较成员（类/接口）
    if (oldExp.members && newExp.members) {
      const memberDiffs = compareMembers(
        oldExp.members,
        newExp.members,
        name,
        newSkeleton.filePath,
        newExp.startLine,
      );
      items.push(...memberDiffs);
    }
  }

  return items;
}

/**
 * 比较类/接口的成员差异
 */
function compareMembers(
  oldMembers: NonNullable<ExportSymbol['members']>,
  newMembers: NonNullable<ExportSymbol['members']>,
  parentName: string,
  filePath: string,
  startLine: number,
): DriftItem[] {
  const items: DriftItem[] = [];
  const oldMap = new Map(oldMembers.map((m) => [m.name, m]));
  const newMap = new Map(newMembers.map((m) => [m.name, m]));

  // 删除的成员
  for (const [name, oldMember] of oldMap) {
    if (!newMap.has(name)) {
      items.push({
        id: generateId(),
        severity: 'MEDIUM',
        category: 'Interface',
        changeType: 'removal',
        location: `${filePath}:${startLine}`,
        symbolName: `${parentName}.${name}`,
        description: `成员 \`${parentName}.${name}\` (${oldMember.kind}) 已被删除`,
        oldValue: oldMember.signature,
        newValue: null,
        proposedUpdate: `从 \`${parentName}\` 的文档中移除 \`${name}\``,
        detectedBy: 'structural',
      });
    }
  }

  // 新增的成员
  for (const [name, newMember] of newMap) {
    if (!oldMap.has(name)) {
      items.push({
        id: generateId(),
        severity: 'LOW',
        category: 'Interface',
        changeType: 'addition',
        location: `${filePath}:${startLine}`,
        symbolName: `${parentName}.${name}`,
        description: `\`${parentName}\` 新增成员 \`${name}\` (${newMember.kind})`,
        oldValue: null,
        newValue: newMember.signature,
        proposedUpdate: `在 \`${parentName}\` 的文档中添加 \`${name}\``,
        detectedBy: 'structural',
      });
    }
  }

  // 修改的成员签名
  for (const [name, oldMember] of oldMap) {
    const newMember = newMap.get(name);
    if (newMember && oldMember.signature !== newMember.signature) {
      items.push({
        id: generateId(),
        severity: 'MEDIUM',
        category: 'Interface',
        changeType: 'modification',
        location: `${filePath}:${startLine}`,
        symbolName: `${parentName}.${name}`,
        description: `成员 \`${parentName}.${name}\` 的签名已修改`,
        oldValue: oldMember.signature,
        newValue: newMember.signature,
        proposedUpdate: `更新 \`${parentName}.${name}\` 的签名文档`,
        detectedBy: 'structural',
      });
    }
  }

  return items;
}
