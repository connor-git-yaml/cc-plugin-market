/**
 * Feature 188 — 离线重判驱动纯函数单测。
 *
 * 覆盖 Codex 修复点对应的核心不变量：
 * - W2：untracked 路径四分类（tooling 排除 / test 排除 / source 并入 / ambiguous 人工复核）
 * - C3：合成 diff 结构校验 + 空 patch 合法 + new-file diff 格式
 * - CL-1：candidatePatch 构造（无 source → patch.diff；有 source → 并入）
 * - FR-002/012：排名口径聚合（error 剔分母 + error_rate>30% 标低置信）
 *
 * 不跑 docker/oracle（runSwebenchInstance 不在被测函数内）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyUntrackedPath,
  isWellFormedDiff,
  synthNewFileDiff,
  buildCandidatePatch,
  aggregateByCohort,
  discoverAnswerSheets,
} from '../../scripts/eval-offline-rejudge.mjs';

describe('classifyUntrackedPath（W2 四分类）', () => {
  const cases: Array<[string, string]> = [
    // tooling：运行态/工具产物，非候选代码
    ['.specify/.spec-driver-path', 'tooling'],
    ['task-runner-stdout.log', 'tooling'],
    ['task-runner-stderr.log', 'tooling'],
    ['specs/001-fix-mro-marks/plan.md', 'tooling'],
    ['changelog/10060.bugfix.rst', 'tooling'],
    ['.venv-test/pyvenv.cfg', 'tooling'],
    // test：候选自写测试（CL-1 排除）
    ['test_foo.py', 'test'],
    ['sympy/foo/test_bar.py', 'test'],
    ['foo_test.py', 'test'],
    ['conftest.py', 'test'],
    ['tests/test_x.py', 'test'],
    // source：候选非测试源码（CL-1 并入）
    ['sympy/core/mul.py', 'source'],
    ['src/lib/foo.py', 'source'],
    // ambiguous：repo-specific 盲区（人工复核）
    ['sympy/core/tests/helper.py', 'ambiguous'], // 嵌套 tests/
    ['sympy/testing/runtests.py', 'ambiguous'],  // testing/
    ['data/fixture.json', 'ambiguous'],          // 非 .py
    // W2 收紧：目标 repo 自带 specs/ 源码不被误吞为 tooling
    ['specs/foo.py', 'source'],                  // 非 spec-driver NNN- 目录 → 真源码
    ['specs/module/impl.py', 'source'],
  ];
  for (const [p, expected] of cases) {
    it(`${p} → ${expected}`, () => {
      expect(classifyUntrackedPath(p)).toBe(expected);
    });
  }
});

describe('isWellFormedDiff（C3 结构校验）', () => {
  it('空串合法（空 patch = 候选未产出 → 交 oracle 判 fail）', () => {
    expect(isWellFormedDiff('')).toBe(true);
    expect(isWellFormedDiff(null as unknown as string)).toBe(true);
  });
  it('合法 unified diff', () => {
    const d = `diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1,1 +1,1 @@\n-a\n+b\n`;
    expect(isWellFormedDiff(d)).toBe(true);
  });
  it('纯文本（无 diff 标记）非法', () => {
    expect(isWellFormedDiff('this is not a patch\njust prose\n')).toBe(false);
  });
});

describe('synthNewFileDiff（new-file 合成格式）', () => {
  it('含尾换行的多行文件', () => {
    const d = synthNewFileDiff('a/b.py', 'x = 1\ny = 2\n');
    expect(d).toContain('new file mode 100644');
    expect(d).toContain('--- /dev/null');
    expect(d).toContain('+++ b/a/b.py');
    expect(d).toContain('@@ -0,0 +1,2 @@');
    expect(d).toContain('+x = 1');
    expect(d).toContain('+y = 2');
    expect(d).not.toContain('No newline');
    expect(isWellFormedDiff(d)).toBe(true);
  });
  it('无尾换行标注 No newline', () => {
    const d = synthNewFileDiff('a.py', 'x = 1');
    expect(d).toContain('@@ -0,0 +1,1 @@');
    expect(d).toContain('\\ No newline at end of file');
  });
});

describe('buildCandidatePatch（CL-1 构造）', () => {
  it('无 untracked source → 返回 patch.diff 原文（本数据集经验路径）', () => {
    const patch = `diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b\n`;
    expect(buildCandidatePatch(patch, [])).toBe(patch);
  });
  it('空 patch + 无 source → 空串（候选 fail 信号，不伪造）', () => {
    expect(buildCandidatePatch('', [])).toBe('');
  });
  it('有 untracked source → patch.diff ⊕ new-file diff', () => {
    const patch = `diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b\n`;
    const out = buildCandidatePatch(patch, [{ relPath: 'sympy/new.py', content: 'z = 3\n' }]);
    expect(out).toContain('+++ b/x.py');
    expect(out).toContain('+++ b/sympy/new.py');
    expect(out).toContain('+z = 3');
    expect(isWellFormedDiff(out)).toBe(true);
  });
});

describe('aggregateByCohort（FR-002 排名口径 + FR-012 低置信）', () => {
  it('error 剔分母：passRate = pass/(pass+fail)', () => {
    const per = [
      { task: 't', cohort: 'A', repeat: 'r1', classification: 'pass' },
      { task: 't', cohort: 'A', repeat: 'r2', classification: 'fail' },
      { task: 't', cohort: 'A', repeat: 'r3', classification: 'error' },
    ];
    const [a] = aggregateByCohort(per);
    expect(a.n_total).toBe(3);
    expect(a.n_valid).toBe(2); // error 剔出
    expect(a.n_pass).toBe(1);
    expect(a.passRate).toBe(0.5); // 1/2，非 1/3
    expect(a.error_rate).toBeCloseTo(0.3333, 3);
    expect(a.lowConfidence).toBe(true); // error_rate=33%>30% → 低置信
  });
  it('error_rate>30% → lowConfidence=true（FR-012 防虚高）', () => {
    const per = [
      { task: 't', cohort: 'B', repeat: 'r1', classification: 'pass' },
      { task: 't', cohort: 'B', repeat: 'r2', classification: 'error' },
      { task: 't', cohort: 'B', repeat: 'r3', classification: 'error' },
    ];
    const [b] = aggregateByCohort(per);
    expect(b.error_rate).toBeCloseTo(0.6667, 3);
    expect(b.lowConfidence).toBe(true);
    expect(b.passRate).toBe(1); // 1/1，但低置信
  });
  it('全 error → passRate=null（无有效分母）', () => {
    const per = [{ task: 't', cohort: 'C', repeat: 'r1', classification: 'error' }];
    const [c] = aggregateByCohort(per);
    expect(c.n_valid).toBe(0);
    expect(c.passRate).toBeNull();
    expect(c.lowConfidence).toBe(true);
  });
  it('多 cohort 排序稳定', () => {
    const per = [
      { task: 't', cohort: 'Z', repeat: 'r1', classification: 'pass' },
      { task: 't', cohort: 'A', repeat: 'r1', classification: 'pass' },
    ];
    const out = aggregateByCohort(per);
    expect(out.map((x) => x.cohort)).toEqual(['A', 'Z']);
  });
  it('rankEligible：低置信或 n_valid=0 不可入排名（W1）', () => {
    const per = [
      { task: 't', cohort: 'good', repeat: 'r1', classification: 'pass' },
      { task: 't', cohort: 'good', repeat: 'r2', classification: 'fail' },
      { task: 't', cohort: 'good', repeat: 'r3', classification: 'pass' },
      { task: 't', cohort: 'bad', repeat: 'r1', classification: 'pass' },
      { task: 't', cohort: 'bad', repeat: 'r2', classification: 'error' },
      { task: 't', cohort: 'bad', repeat: 'r3', classification: 'error' },
    ];
    const out = aggregateByCohort(per);
    expect(out.find((x) => x.cohort === 'good')!.rankEligible).toBe(true);
    expect(out.find((x) => x.cohort === 'bad')!.rankEligible).toBe(false); // error_rate 66%
  });
});

describe('discoverAnswerSheets（C4 缺 patch.diff 不丢弃）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f188-disc-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('收全部叶子目录，缺 patch.diff 标 missingPatch', () => {
    // task/cohort/r 结构：r1 有 patch.diff，r2 无
    const mk = (rel: string, content = '') => {
      const fp = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content);
    };
    mk('SWE-V001-x/control/r1/patch.diff', 'diff --git a/x b/x\n');
    fs.mkdirSync(path.join(tmp, 'SWE-V001-x/control/r2'), { recursive: true }); // 缺 patch.diff
    mk('SWE-V001-x/spec-driver/r1/patch.diff', '');

    const sheets = discoverAnswerSheets(tmp);
    expect(sheets).toHaveLength(3); // r2 不丢弃
    const r2 = sheets.find((s) => s.cohort === 'control' && s.repeat === 'r2');
    expect(r2!.missingPatch).toBe(true);
    const r1 = sheets.find((s) => s.cohort === 'control' && s.repeat === 'r1');
    expect(r1!.missingPatch).toBe(false);
    // 排序稳定
    expect(sheets.map((s) => `${s.cohort}/${s.repeat}`)).toEqual(['control/r1', 'control/r2', 'spec-driver/r1']);
  });
});
