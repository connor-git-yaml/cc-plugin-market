/**
 * git-change-classifier.test.mjs
 * Feature 241 — 变更类别机械判定（FR-005）
 *
 * 为什么锁死 NUL 分隔契约：`git diff --name-status`（无 `-z`）对含空格/引号/非 ASCII 的路径会加引号
 * 并转义，重命名记录写作 `old -> new` 的**人读**形态。按 ` -> ` 切分在真实仓库里迟早会踩到
 * 文件名本身含 ` -> ` 的情况，切出一份错误的文件清单，而错误清单会直接污染 changeClass 判定。
 * `-z` 一次性消掉转义、引号、空格、非 ASCII 四类歧义，因此本模块**只**接受 `-z` 形态输入。
 *
 * 契约（与 git 文档逐字对齐）：
 *   `--name-status -z`：`<status>\0<path>\0`；重命名/复制为 `<status><score>\0<old>\0<new>\0`（三段）
 *   `--porcelain -z`：`XY <path>\0`；重命名为 `XY <new>\0<old>\0`（**新旧顺序与 name-status 相反**）
 *
 * 运行方式: node --test plugins/spec-driver/tests/git-change-classifier.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyChangeSet } from '../scripts/lib/git-change-classifier.mjs';

/** 把字段数组拼成 NUL 分隔文本（每个字段后跟一个 \0，与 git 输出一致）。 */
const nul = (...fields) => fields.map((field) => `${field}\0`).join('');

/**
 * F258：`nameStatusOk` / `porcelainOk` 是 required 布尔位（缺省即 throw），因此每个用例的
 * 基底都必须显式声明"这两路 git 输出是可信的"。见文件尾 R2-4 段。
 */
const EMPTY = { nameStatusText: '', porcelainText: '', nameStatusOk: true, porcelainOk: true };

describe('FR-005 name-status -z 解析', () => {
  it('M + A 混合 → modifies-existing，文件清单含两者', () => {
    const result = classifyChangeSet({
      ...EMPTY,
      nameStatusText: nul('M', 'src/foo.ts', 'A', 'src/new.ts'),
    });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual([...result.files].sort(), ['src/foo.ts', 'src/new.ts']);
  });

  it('全部为 A → additive-only', () => {
    const result = classifyChangeSet({ ...EMPTY, nameStatusText: nul('A', 'src/a.ts', 'A', 'src/b.ts') });
    assert.equal(result.changeClass, 'additive-only');
    assert.deepEqual([...result.files].sort(), ['src/a.ts', 'src/b.ts']);
  });

  it('D（删除既有文件）→ modifies-existing', () => {
    const result = classifyChangeSet({ ...EMPTY, nameStatusText: nul('D', 'src/gone.ts') });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual(result.files, ['src/gone.ts']);
  });

  it('R100 三段重命名 → modifies-existing，新旧路径都进清单', () => {
    const result = classifyChangeSet({
      ...EMPTY,
      nameStatusText: nul('R100', 'src/old-name.ts', 'src/new-name.ts'),
    });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual([...result.files].sort(), ['src/new-name.ts', 'src/old-name.ts']);
  });

  it('C75 复制 → modifies-existing，源与副本都进清单', () => {
    const result = classifyChangeSet({
      ...EMPTY,
      nameStatusText: nul('C75', 'src/source.ts', 'src/copy.ts'),
    });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual([...result.files].sort(), ['src/copy.ts', 'src/source.ts']);
  });

  it('含空格的文件名原样保留（-z 下不加引号）', () => {
    const result = classifyChangeSet({ ...EMPTY, nameStatusText: nul('M', 'src/my file name.ts') });
    assert.deepEqual(result.files, ['src/my file name.ts']);
  });

  it('含中文与引号字符的路径原样保留', () => {
    const weird = 'src/中文目录/含"双引号"和\'单引号\'.ts';
    const result = classifyChangeSet({ ...EMPTY, nameStatusText: nul('A', weird) });
    assert.equal(result.changeClass, 'additive-only');
    assert.deepEqual(result.files, [weird]);
  });
});

describe('FR-005 porcelain -z 解析', () => {
  it('全部为 ?? （未跟踪）→ additive-only', () => {
    const result = classifyChangeSet({ ...EMPTY, porcelainText: nul('?? src/a.ts', '?? src/b.ts') });
    assert.equal(result.changeClass, 'additive-only');
    assert.deepEqual([...result.files].sort(), ['src/a.ts', 'src/b.ts']);
  });

  it('工作树修改（" M path"，X 位为空格）→ modifies-existing', () => {
    const result = classifyChangeSet({ ...EMPTY, porcelainText: nul(' M src/foo.ts') });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual(result.files, ['src/foo.ts']);
  });

  it('暂存新增（"A  path"）→ additive-only', () => {
    const result = classifyChangeSet({ ...EMPTY, porcelainText: nul('A  src/new.ts') });
    assert.equal(result.changeClass, 'additive-only');
  });

  it('重命名两段且**新旧顺序与 name-status 相反** → 两路径都进清单', () => {
    const result = classifyChangeSet({ ...EMPTY, porcelainText: nul('R  src/new.ts', 'src/old.ts') });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual([...result.files].sort(), ['src/new.ts', 'src/old.ts']);
  });

  it('含空格的未跟踪文件名原样保留（不在第一个空格处截断）', () => {
    const result = classifyChangeSet({ ...EMPTY, porcelainText: nul('?? src/a b c.ts') });
    assert.deepEqual(result.files, ['src/a b c.ts']);
  });
});

describe('FR-005 两路输入合并', () => {
  it('name-status 全 A 但 porcelain 有 M → 合并后 modifies-existing', () => {
    const result = classifyChangeSet({
      ...EMPTY,
      nameStatusText: nul('A', 'src/new.ts'),
      porcelainText: nul(' M src/existing.ts'),
    });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual([...result.files].sort(), ['src/existing.ts', 'src/new.ts']);
  });

  it('两路都是新增 → additive-only，文件清单去重', () => {
    const result = classifyChangeSet({
      ...EMPTY,
      nameStatusText: nul('A', 'src/new.ts'),
      porcelainText: nul('?? src/new.ts', '?? src/other.ts'),
    });
    assert.equal(result.changeClass, 'additive-only');
    assert.deepEqual([...result.files].sort(), ['src/new.ts', 'src/other.ts']);
  });
});

describe('FR-005 unknown 兜底', () => {
  it('两路皆空 → unknown + 空文件清单', () => {
    const result = classifyChangeSet(EMPTY);
    assert.equal(result.changeClass, 'unknown');
    assert.deepEqual(result.files, []);
  });

  it('仅空白字符 / 仅 NUL → unknown', () => {
    assert.equal(classifyChangeSet({ ...EMPTY, nameStatusText: '\0', porcelainText: '  ' }).changeClass, 'unknown');
  });

  it('ok 位齐全时，文本字段缺失或非字符串 → unknown，不抛错', () => {
    // F258 口径调整：可信度由 ok 位承担并 fail-loud（见文件尾 R2-4），文本类型仍保持宽容——
    // 同一件事没必要判两遍。原用例断言的是"整个入参缺失也不抛错"，那条已被 required 契约取代。
    for (const bad of [{}, { nameStatusText: 42, porcelainText: [] }]) {
      const withOk = { ...bad, nameStatusOk: true, porcelainOk: true };
      assert.doesNotThrow(() => classifyChangeSet(withOk));
      assert.equal(classifyChangeSet(withOk).changeClass, 'unknown');
    }
  });

  it('未识别的状态码（T 类型变更 / U 未合并）→ unknown，不猜测', () => {
    assert.equal(classifyChangeSet({ ...EMPTY, nameStatusText: nul('T', 'src/a.ts') }).changeClass, 'unknown');
    assert.equal(classifyChangeSet({ ...EMPTY, porcelainText: nul('UU src/a.ts') }).changeClass, 'unknown');
  });

  it('结构残缺（状态码后缺路径 / 重命名缺第二段）→ unknown', () => {
    assert.equal(classifyChangeSet({ ...EMPTY, nameStatusText: nul('M') }).changeClass, 'unknown');
    assert.equal(
      classifyChangeSet({ ...EMPTY, nameStatusText: nul('R100', 'only-old.ts') }).changeClass,
      'unknown',
    );
    assert.equal(classifyChangeSet({ ...EMPTY, porcelainText: nul('??') }).changeClass, 'unknown');
  });
});

describe('FR-005 格式契约守卫：绝不按 " -> " 人读形态切分', () => {
  it('文件名本身含 " -> " 时，路径必须完整保留（负例：误切会得到错误清单）', () => {
    // 合法 POSIX 文件名，正是人读格式与真实路径产生歧义的那个交点
    const trickyOld = 'src/a -> b.ts';
    const trickyNew = 'src/renamed.ts';
    const nameStatusText = nul('R100', trickyOld, trickyNew);

    const result = classifyChangeSet({ ...EMPTY, nameStatusText });
    assert.equal(result.changeClass, 'modifies-existing');
    assert.deepEqual([...result.files].sort(), [trickyNew, trickyOld].sort());

    // 同一份 fixture 若按人读格式切分会得到什么：证明这两条路径确实分叉，负例非虚设
    const naiveFiles = nameStatusText
      .split('\0')
      .filter((field) => field.length > 0)
      .slice(1)
      .flatMap((field) => field.split(' -> '));
    assert.notDeepEqual(
      [...naiveFiles].sort(),
      [...result.files].sort(),
      '负例失效：按 " -> " 切分应当产出不同（错误）的文件清单',
    );
    assert.ok(naiveFiles.includes('src/a'), '误切后应出现被腰斩的 "src/a"');
    assert.equal(result.files.includes('src/a'), false, '正确解析不得出现被腰斩的路径');
  });

  it('porcelain 侧同样不按 " -> " 切分', () => {
    const trickyNew = 'src/x -> y.ts';
    const result = classifyChangeSet({ ...EMPTY, porcelainText: nul(`R  ${trickyNew}`, 'src/old.ts') });
    assert.deepEqual([...result.files].sort(), ['src/old.ts', trickyNew].sort());
  });
});

/* ------------------------------- F258 R2-4：输入不可信的显式入口（required + throw） */

describe('F258 R2-4 输入可信度必须由调用方显式声明（required ok 位，缺省即 throw）', () => {
  /**
   * 原缺陷（fix-report 缺陷 2 的 Why 5）：`runGit` 把"命令跑失败"折成空串，而空串在
   * `parseNameStatus` 里是合法的"没有变更"——于是"读不到"与"没有改动"在类型层不可区分。
   *
   * 为什么是 **throw** 而不是"缺省即不可信"：后者会把一切缺省调用静默判成 `unknown`，
   * 而 R1 已实证 `unknown` 走矩阵行 7 `consume-degraded`、**根本不刷图**，还会抢在 freshness
   * 之前短路，把 stale/dirty 信号永久遮蔽。静默的保守方向在这里恰恰不保守。
   */
  it('缺两个 ok 位 → throw TypeError（不接受"缺省即可信"）', () => {
    assert.throws(
      () => classifyChangeSet({ nameStatusText: '', porcelainText: nul('?? src/a.ts') }),
      TypeError,
    );
  });

  it('只缺其中一个 ok 位 → 同样 throw（两位都是 required）', () => {
    assert.throws(
      () => classifyChangeSet({ nameStatusText: '', porcelainText: '', porcelainOk: true }),
      TypeError,
    );
    assert.throws(
      () => classifyChangeSet({ nameStatusText: '', porcelainText: '', nameStatusOk: true }),
      TypeError,
    );
  });

  it('整个入参缺失（undefined / null）→ 同样 throw（`input?.[key]` 得 undefined，非 boolean）', () => {
    for (const bad of [undefined, null]) {
      assert.throws(() => classifyChangeSet(bad), TypeError, `入参 ${JSON.stringify(bad)} 应被拒`);
    }
  });

  it('ok 位非 boolean（含 truthy 的 1 / "true"）→ throw，不做隐式转换', () => {
    for (const bad of [1, 0, 'true', null, undefined]) {
      assert.throws(
        () => classifyChangeSet({ nameStatusText: '', porcelainText: '', nameStatusOk: bad, porcelainOk: true }),
        TypeError,
        `nameStatusOk=${JSON.stringify(bad)} 应被拒`,
      );
    }
  });

  it('nameStatusOk:false → unknown（空串不再被当成"没有变更"这一事实）', () => {
    const result = classifyChangeSet({
      nameStatusText: '',
      nameStatusOk: false,
      porcelainText: nul('?? src/a.ts'),
      porcelainOk: true,
    });
    // 若不看 ok 位，这份输入会被判成 additive-only（porcelain 里只有 ??）
    assert.equal(result.changeClass, 'unknown');
  });

  it('porcelainOk:false → unknown（同上，责任方是工作树读取）', () => {
    const result = classifyChangeSet({
      nameStatusText: nul('A', 'src/new.ts'),
      nameStatusOk: true,
      porcelainText: '',
      porcelainOk: false,
    });
    assert.equal(result.changeClass, 'unknown');
  });

  it('两位皆 true 时行为与既有逐字一致（防修过头）', () => {
    const result = classifyChangeSet({
      nameStatusText: nul('A', 'src/new.ts'),
      nameStatusOk: true,
      porcelainText: '',
      porcelainOk: true,
    });
    assert.equal(result.changeClass, 'additive-only');
    assert.deepEqual(result.files, ['src/new.ts']);
  });
});
