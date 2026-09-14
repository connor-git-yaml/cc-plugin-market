/**
 * M11 簇④ 第 5 项：(ii) 升格条款（`templates/gate-class-mandatory-upgrade.md`）与 `GATE_DESIGN` 收敛循环分类表
 * （`templates/gate-design-convergence-loop.md`）各列一套「门禁类命中面」路径。两处此前只靠散文里一句「以 sha 抽检」，
 * 本测试把它变成机械对拍：路径集合必须相等，换算式里的路径条数必须与表行数一致。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CLAUSE_PATH = 'plugins/spec-driver/templates/gate-class-mandatory-upgrade.md';
const TABLE_PATH = 'plugins/spec-driver/templates/gate-design-convergence-loop.md';

/** 分类表：`| N | \`path\` | 路径 |` 行里的 path（类型列为「路径」的行） */
function tablePaths(markdown: string): string[] {
  // 第 10 行形如「| 10 | 仓根 `scripts/**`（…） | 路径 |」：路径是该行第一个反引号段，前面可带「仓根」等修饰
  const rows = markdown.split('\n').filter((line) => /^\| \d+ \| .*`[^`]+`.*\| 路径 \|$/.test(line));
  return rows.map((line) => /`([^`]+)`/.exec(line)![1]!);
}

/** (ii) 条款：「路径条 **13**：`a`、`b`、…；语义条」之间反引号包裹的路径 */
function clausePaths(markdown: string): { paths: string[]; declaredCount: number; declaredTotal: number } {
  const clause = markdown.split('\n').find((line) => line.startsWith('**(ii)'))!;
  const segment = /路径条 \*\*(\d+)\*\*：(.*?)；语义条/.exec(clause)!;
  const paths = [...segment[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const total = /命中面 \*\*(\d+)\*\* 条 = 路径条/.exec(clause)!;
  return { paths, declaredCount: Number(segment[1]), declaredTotal: Number(total[1]) };
}

describe('门禁类命中面路径集合两处同源', () => {
  const table = tablePaths(readFileSync(TABLE_PATH, 'utf-8'));
  const clause = clausePaths(readFileSync(CLAUSE_PATH, 'utf-8'));

  it('分类表的路径行与 (ii) 条款的路径集合相等（顺序无关）', () => {
    expect([...clause.paths].sort()).toEqual([...table].sort());
  });

  it('(ii) 条款自报的路径条数 / 命中面总数与实际一致（13 路径 + 1 语义 = 14）', () => {
    expect(clause.declaredCount).toBe(clause.paths.length);
    expect(clause.declaredTotal).toBe(clause.paths.length + 1);
    expect(table.length).toBe(13);
  });
});
