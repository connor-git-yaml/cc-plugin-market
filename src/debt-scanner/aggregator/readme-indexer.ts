/**
 * specs/README.md "质量审计" 节追加技术债链接
 *
 * AC-3.4：若文件存在且有 "质量审计" 节，在该节内 idempotent 插入一行。
 * 若 README.md 不存在或没有 "质量审计" 节则跳过。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const LINK_LINE = '- [技术债清单](project/technical-debt.md)';
const HEADING_REGEX = /^##\s+质量审计\s*$/m;

/**
 * 在 specs/README.md 的 "质量审计" 节中插入技术债链接。
 * 返回 true 表示做了改动，false 表示跳过（文件缺失 / 节缺失 / 已存在）。
 */
export function indexDebtInReadme(specsDir: string): boolean {
  const readmePath = path.join(specsDir, 'README.md');
  if (!fs.existsSync(readmePath)) return false;

  const text = fs.readFileSync(readmePath, 'utf-8');
  const match = HEADING_REGEX.exec(text);
  if (!match) return false;

  // 已存在链接时 idempotent 跳过
  if (text.includes(LINK_LINE)) return false;

  const headingEnd = match.index + match[0].length;
  // 将 LINK_LINE 插到 "## 质量审计" 后的第一个空行之后，或直接紧跟 heading
  const after = text.slice(headingEnd);
  // 找到下一个 heading（同级或更高级）或文件末尾
  const nextHeading = /^#{1,2}\s+\S/gm;
  nextHeading.lastIndex = 0;
  nextHeading.exec(after); // 仅为复用正则；下一步用 .lastIndex 计算
  const nextIdx = (() => {
    const re = /^#{1,2}\s+\S/gm;
    re.lastIndex = 0;
    const m2 = re.exec(after);
    return m2 ? m2.index : after.length;
  })();

  const block = after.slice(0, nextIdx);
  // 插入：保留 heading 后的原 block，但在结尾前追加 LINK_LINE
  const trimmed = block.replace(/\s+$/, '');
  const newBlock = trimmed + '\n' + LINK_LINE + '\n\n';

  const next =
    text.slice(0, headingEnd) +
    '\n' + // heading 与 block 之间的换行
    newBlock.replace(/^\n/, '') +
    text.slice(headingEnd + block.length);

  if (next === text) return false;
  fs.writeFileSync(readmePath, next, 'utf-8');
  return true;
}
