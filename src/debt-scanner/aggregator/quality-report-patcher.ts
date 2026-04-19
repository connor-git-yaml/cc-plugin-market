/**
 * quality-report.md 追加 "## 技术债" 节
 *
 * AC-4.1 / AC-4.3：
 * - 若 quality-report.md 不存在 → 跳过，不报错
 * - 若 technical-debt.md 未生成（metrics 为空）→ 跳过
 * - 若节已存在 → 替换内容（幂等）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DebtKind, DebtMetrics } from '../types.js';

export interface PatchQualityReportOptions {
  qualityReportPath: string;
  metrics: DebtMetrics;
  /** technical-debt.md 的相对路径（通常同目录下的 "technical-debt.md"） */
  technicalDebtRelPath?: string;
}

/**
 * 对 quality-report.md 追加或替换 "## 技术债" 节。
 * 返回 true 表示做了改动，false 表示跳过。
 */
export function patchQualityReportWithDebt(opts: PatchQualityReportOptions): boolean {
  if (!fs.existsSync(opts.qualityReportPath)) return false;

  const section = renderDebtSection(opts.metrics, opts.technicalDebtRelPath ?? 'technical-debt.md');
  const original = fs.readFileSync(opts.qualityReportPath, 'utf-8');

  const existing = findExistingSection(original);
  let next: string;
  if (existing) {
    next =
      original.slice(0, existing.start) +
      section +
      original.slice(existing.end);
  } else {
    // AC-4.1 / plan §3.4：优先插入到 "## Required Docs" 节末尾；
    // 找不到锚点时退化到文件末尾追加（向后兼容模板漂移）。
    const anchor = findRequiredDocsInsertionPoint(original);
    if (anchor != null) {
      const before = original.slice(0, anchor);
      const after = original.slice(anchor);
      const leadingNewline = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      next = before + leadingNewline + section + (after.startsWith('\n') ? '' : '\n') + after;
    } else {
      const sep = original.endsWith('\n') ? '' : '\n';
      next = original + sep + '\n' + section;
    }
  }

  if (next === original) return false;
  fs.writeFileSync(opts.qualityReportPath, next, 'utf-8');
  return true;
}

/**
 * 生成 "## 技术债" 节 Markdown（不含首尾空行控制）。
 */
export function renderDebtSection(metrics: DebtMetrics, technicalDebtRelPath: string): string {
  const kindLine = (Object.keys(metrics.byKind) as DebtKind[])
    .map((k) => `${k} ${metrics.byKind[k]}`)
    .join(' / ');
  return [
    '## 技术债',
    '',
    `- 总条目数：${metrics.totalEntries}`,
    `- 按 kind：${kindLine}`,
    `- 代码债务密度：${metrics.densityPerKloc.toFixed(2)} 条/kLOC`,
    `- 最老条目：${metrics.oldestAgeDays} 天`,
    '',
    `详情见 [technical-debt.md](${technicalDebtRelPath})。`,
    '',
  ].join('\n');
}

/**
 * 若存在 "## 技术债" 节，返回其 [start, end)；无则 null。
 * 结束位置为下一个同级或更高级 heading 行首，或文件末尾。
 */
function findExistingSection(text: string): { start: number; end: number } | null {
  const re = /^##\s+技术债\s*$/m;
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index;
  // 从 start 之后查找下一个 ^#{1,2}\s
  const afterStart = start + m[0].length;
  const nextRe = /^#{1,2}\s+\S/gm;
  nextRe.lastIndex = afterStart;
  const next = nextRe.exec(text);
  const end = next ? next.index : text.length;
  return { start, end };
}

/**
 * 找到 "## Required Docs" 节结束位置（下一个同级 heading 前、或文件末尾）。
 * 返回可插入位置（字符偏移）；没有该节时返回 null。
 */
function findRequiredDocsInsertionPoint(text: string): number | null {
  const re = /^##\s+Required Docs\s*$/m;
  const m = re.exec(text);
  if (!m) return null;
  const afterHeading = m.index + m[0].length;
  const nextRe = /^#{1,2}\s+\S/gm;
  nextRe.lastIndex = afterHeading;
  const next = nextRe.exec(text);
  return next ? next.index : text.length;
}

/**
 * 辅助：根据 specsDir 推断 quality-report.md 的常见路径。
 * 文件不存在时也返回该路径，由 patcher 自行 skip。
 */
export function findQualityReportPath(specsDir: string): string {
  return path.join(specsDir, 'project', 'quality-report.md');
}
