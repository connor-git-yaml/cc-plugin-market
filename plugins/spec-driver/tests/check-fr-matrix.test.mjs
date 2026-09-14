/**
 * check-fr-matrix.test.mjs — M11 簇④ 第 3 / 4 项：
 *   constitution  Constitution Check 里引用的 FR 编号必须 ∈ plan.md 覆盖矩阵已认领集合（机械检测，此前只靠散文要求）
 *   verify-gaps   verify 的「补登」清单 = spec 抽出的 FR 集合 − 矩阵已认领集合（机械生成，此前靠人手枚举）
 *
 * 运行方式: node --test plugins/spec-driver/tests/check-fr-matrix.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  collectMatrixClaimedFRs,
  collectConstitutionCheckFRs,
  checkConstitutionReferences,
  computeVerifyGaps,
} from '../scripts/check-fr-matrix.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'scripts', 'check-fr-matrix.mjs');

const PLAN = `# plan

## Summary

改动概述。

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|---|---|---|---|
| I. 双语 | 适用 | PASS | FR-001 / FR-002 已明写为 MUST；FR-009 另见裁剪 |
| II. YAGNI | 适用 | PASS | 与 **FR-003** 的核验方式一致 |

## FR → Phase 覆盖矩阵

| FR | 类别 | Phase | 落点 |
|---|---|---|---|
| FR-001 | 实现型 | A | src/a.ts |
| FR-002 | 实现型 | B | src/b.ts |
| FR-003 | 约束型 | — | — |
| FR-005 | 实现型 | C | src/c.ts |

## FR → Phase 覆盖矩阵 · 冻结后修订记录

无。FR-999 只是修订记录里的引用，不算认领。

## 裁剪登记

- FR-004（可选）：裁剪。
`;

const SPEC = `# spec

## 功能需求

- **FR-001**: 一
- **FR-002**: 二
- **FR-003**: 三
- **FR-004**: 四
- **FR-005**: 五
- **FR-006**: 六（矩阵未认领）
`;

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-fr-matrix-'));
  fs.writeFileSync(path.join(dir, 'plan.md'), PLAN);
  fs.writeFileSync(path.join(dir, 'spec.md'), SPEC);
  return dir;
}

describe('矩阵已认领集合', () => {
  it('只取 `## FR → Phase 覆盖矩阵` 一节里的第一张表：Phase 列有认领的行是已认领，`—` 行是约束型；修订记录 / 裁剪登记里的编号不算', () => {
    const claimed = collectMatrixClaimedFRs(PLAN);
    assert.deepEqual([...claimed].sort(), ['FR-001', 'FR-002', 'FR-005']);
    assert.deepEqual([...claimed.constraints], ['FR-003']);
    assert.deepEqual([...claimed.registered].sort(), ['FR-001', 'FR-002', 'FR-003', 'FR-005']);
    assert.equal(claimed.claimColumnMissing, false);
  });
  it('没有矩阵章节 → 空集合并标记 matrixMissing', () => {
    const claimed = collectMatrixClaimedFRs('# plan\n\n## Summary\n\n无矩阵。\n');
    assert.equal(claimed.size, 0);
    assert.equal(claimed.matrixMissing, true);
  });
});

describe('constitution：Constitution Check 引用 ⊆ 矩阵已认领', () => {
  it('抽出 Constitution Check 一节里的全部 FR 编号（含加粗形态），不越界到其它章节', () => {
    assert.deepEqual([...collectConstitutionCheckFRs(PLAN)].sort(), ['FR-001', 'FR-002', 'FR-003', 'FR-009']);
  });
  it('FR-009 不在矩阵里 → 判不通过并指名', () => {
    const r = checkConstitutionReferences(PLAN);
    assert.equal(r.passed, false);
    assert.deepEqual(r.unclaimed, ['FR-009']);
  });
  it('全部引用都已认领 → 通过', () => {
    const r = checkConstitutionReferences(PLAN.replace('；FR-009 另见裁剪', ''));
    assert.equal(r.passed, true);
    assert.deepEqual(r.unclaimed, []);
  });
  it('没有 Constitution Check 章节 → 不通过（判不出从严），reason 指名章节缺席', () => {
    const r = checkConstitutionReferences(PLAN.replace('## Constitution Check', '## 宪法核对'));
    assert.equal(r.passed, false);
    assert.equal(r.sectionMissing, 'constitution');
    assert.deepEqual(r.unclaimed, [], '缺席分支 unclaimed 恒空——接线方必须按 passed === false 判，不能只看 unclaimed');
    assert.match(r.reason, /Constitution/);
  });
  it('C-1 · 标题带编号前缀 / 尾部装饰 / Re-check 变体都能定位到章节（本仓 18/125 份 plan 的真实形态）', () => {
    for (const heading of ['## 8. Constitution Check', '## Constitution Check（简要）', '## 3. Constitution Re-check (Post-Design)', '## Constitution / 合同预检自查']) {
      const r = checkConstitutionReferences(PLAN.replace('## Constitution Check', heading));
      assert.equal(r.sectionMissing, null, heading);
      assert.deepEqual(r.unclaimed, ['FR-009'], heading);
    }
    const numbered = checkConstitutionReferences(PLAN.replace('## FR → Phase 覆盖矩阵\n', '## 3. FR → Phase 覆盖矩阵\n'));
    assert.equal(numbered.sectionMissing, null);
    assert.deepEqual(numbered.unclaimed, ['FR-009']);
  });
  it('W-7 · Constitution 节里 fenced code / 行内代码 / 引用块中的编号不算引用（留痕的重算命令不得制造恒红）', () => {
    const plan = PLAN.replace('## Constitution Check\n', "## Constitution Check\n\n```bash\ngrep -c '^- \\*\\*FR-0' spec.md\n```\n\n复算命令 `grep -c 'FR-999'`：\n\n> FR-888 由上游负责\n\n");
    const r = checkConstitutionReferences(plan);
    assert.deepEqual(r.referenced, ['FR-001', 'FR-002', 'FR-003', 'FR-009']);
  });
});

describe('verify-gaps：spec FR − 矩阵认领 = 补登清单', () => {
  it('spec 抽出 6 条，矩阵认领 4 条 → 补登 FR-004 / FR-006；裁剪登记里的 FR-004 单独标出', () => {
    const dir = tmpProject();
    const r = computeVerifyGaps(path.join(dir, 'spec.md'), PLAN);
    assert.deepEqual(r.specFRs, ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005', 'FR-006']);
    assert.deepEqual(r.gaps, ['FR-004', 'FR-006']);
    assert.deepEqual(r.registeredAsCut, ['FR-004']);
    assert.deepEqual(r.unclaimedAndUncut, ['FR-006']);
  });
  it('矩阵缺席 → 全部 spec FR 进补登清单并带 matrixMissing 标记', () => {
    const dir = tmpProject();
    const r = computeVerifyGaps(path.join(dir, 'spec.md'), '# plan\n\n## Summary\n\n无矩阵。\n');
    assert.equal(r.matrixMissing, true);
    assert.equal(r.gaps.length, 6);
  });
  it('C-2 · 认领列语义：移交 / 未认领⇒裁剪 / — 都不是认领；讨论用子表不算；handedOver 单独列出', () => {
    const plan = `# plan
## FR → Phase 覆盖矩阵
| FR | 类型 | 认领 Phase | 落点 |
|---|---|---|---|
| FR-001 | 实现型 | **A** | src/a.ts |
| FR-002 | 实现型 | **移交 F27x** | — |
| FR-003 | 实现型 | （未认领 ⇒ 裁剪） | — |
| FR-004 | **约束型** | — | 核验方式见右 |
| FR-005 | 实现型 |  | 空格 |

讨论用子表：
| FR | 判定理由 |
|---|---|
| FR-006 | 只是讨论 |
`;
    const dir = tmpProject();
    const r = computeVerifyGaps(path.join(dir, 'spec.md'), plan);
    assert.deepEqual(r.claimed, ['FR-001']);
    assert.deepEqual(r.constraints, ['FR-004', 'FR-005']);
    assert.deepEqual(r.handedOver, ['FR-002']);
    assert.deepEqual(r.gaps, ['FR-002', 'FR-003', 'FR-006']);
    assert.deepEqual(r.registeredAsCut, ['FR-003']);
    assert.deepEqual(r.unclaimedAndUncut, ['FR-002', 'FR-006'], '移交是未完成态：按合并律进「未实现」侧，不得当作裁剪或认领');
  });
  it('W-6 · 首格多编号形态：区间展开、链接、斜线、逗号、反引号、尾注', () => {
    const plan = `# plan
## FR → Phase 覆盖矩阵
| FR | Phase |
|---|---|
| FR-001 ~ FR-003 | A |
| [FR-004](#fr-004) | A |
| FR-005 / FR-006 | B |
| FR-007,FR-008 | B |
| \`FR-009\` | C |
| FR-010（部分） | C |
`;
    const claimed = collectMatrixClaimedFRs(plan);
    assert.deepEqual([...claimed].sort(), ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005', 'FR-006', 'FR-007', 'FR-008', 'FR-009', 'FR-010']);
  });
  it('无认领列的矩阵退化为「有表行即认领」并标 claimColumnMissing', () => {
    const plan = '# plan\n## FR → Phase 覆盖矩阵\n| FR | 落点 |\n|---|---|\n| FR-001 | src |\n';
    const claimed = collectMatrixClaimedFRs(plan);
    assert.deepEqual([...claimed], ['FR-001']);
    assert.equal(claimed.claimColumnMissing, true);
  });
  it('W-8 · spec 抽出 0 条 ⇒ specEmpty:true（清单无意义须显式标记）', () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, 'empty.md'), '# 空\n');
    const r = computeVerifyGaps(path.join(dir, 'empty.md'), PLAN);
    assert.equal(r.specEmpty, true);
    assert.deepEqual(r.gaps, []);
  });
});

describe('CLI', () => {
  it('constitution <plan.md>：有未认领引用时 exit 1 并输出 JSON', () => {
    const dir = tmpProject();
    const r = spawnSync(process.execPath, [CLI, 'constitution', path.join(dir, 'plan.md'), '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).unclaimed, ['FR-009']);
  });
  it('I-3 · 传目录 / 不存在的路径 ⇒ exit 2（用法错误，不与「检查未通过」的 exit 1 混用）', () => {
    const dir = tmpProject();
    assert.equal(spawnSync(process.execPath, [CLI, 'constitution', dir], { encoding: 'utf-8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, 'verify-gaps', path.join(dir, 'spec.md'), path.join(dir, 'nope.md')], { encoding: 'utf-8' }).status, 2);
  });
  it('verify-gaps <spec.md> <plan.md>：输出补登清单 JSON，有缺口不算失败（exit 0，判定权在 verify）', () => {
    const dir = tmpProject();
    const r = spawnSync(process.execPath, [CLI, 'verify-gaps', path.join(dir, 'spec.md'), path.join(dir, 'plan.md'), '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).unclaimedAndUncut, ['FR-006']);
  });
  it('文件不存在 / 未知子命令 → exit 2', () => {
    assert.equal(spawnSync(process.execPath, [CLI, 'constitution', '/nonexistent/plan.md'], { encoding: 'utf-8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, 'bogus'], { encoding: 'utf-8' }).status, 2);
  });
});
