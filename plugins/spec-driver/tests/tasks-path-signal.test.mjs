/**
 * tasks-path-signal.test.mjs
 * Feature 241 — tasks.md 目标路径信号（D3 `pre-implement advisory` 轮 1 信号源）
 *
 * D3 给 advisory 合同定义的轮 1 信号是「tasks.md 已声明目标文件路径的**存在性**
 * （`fs.existsSync`，纯文件系统事实，非 agent 自报）」。本模块只负责两件事：
 *   1. 从 tasks.md 文本里把目标路径抠出来（纯文本解析）
 *   2. 拿注入的 `fsExists` 判断这批路径是「改既有」还是「纯新增」
 *
 * 两个函数都必须是纯函数：`fsExists` 走依赖注入而非直接 import `node:fs`，否则用例得在磁盘上
 * 造真实文件才能测分类，测试成本与耦合都会失控。
 *
 * **解析不出路径一律返回空数组 / `unknown`**，绝不猜测：`unknown` 在 FR-003 矩阵里落降级消费
 * （行 7），是安全方向；猜成 `additive-only` 会直接跳过 impact，猜错的代价不对称。
 *
 * 运行方式: node --test plugins/spec-driver/tests/tasks-path-signal.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractTaskPaths, classifyFromTaskPaths } from '../scripts/lib/tasks-path-signal.mjs';

/* ------------------------------------------------------- extractTaskPaths */

describe('extractTaskPaths — 任务行里的目标路径抽取', () => {
  it('未勾选任务行：抽出反引号包裹的路径', () => {
    const text = '- [ ] T001 新增 `plugins/spec-driver/scripts/lib/foo.mjs`：做点什么\n';
    assert.deepEqual(extractTaskPaths(text), ['plugins/spec-driver/scripts/lib/foo.mjs']);
  });

  it('已勾选任务行（勾选态不影响抽取——tasks.md 常带历史勾选）', () => {
    const text = '- [x] T002 改造 `scripts/lib/bar.mjs` 为薄壳\n';
    assert.deepEqual(extractTaskPaths(text), ['scripts/lib/bar.mjs']);
  });

  it('[P] / [US1] 等标记位于 T 编号之后，不干扰抽取', () => {
    const text = '- [ ] T003 [P][红测试] 新增 `tests/a.test.mjs` 与 `tests/b.test.mjs`\n';
    assert.deepEqual(extractTaskPaths(text), ['tests/a.test.mjs', 'tests/b.test.mjs']);
  });

  it('裸路径（无反引号）同样抽出', () => {
    const text = '- [ ] T004 修改 src/index.ts 的导出\n';
    assert.deepEqual(extractTaskPaths(text), ['src/index.ts']);
  });

  it('中文路径与中文句读：路径抽出、句末标点不粘连', () => {
    const text = '- [ ] T005 新增 `文档/设计/图谱说明.md`，并更新 `docs/中文-指南.md`。\n';
    assert.deepEqual(extractTaskPaths(text), ['文档/设计/图谱说明.md', 'docs/中文-指南.md']);
  });

  it('symbol id 形态（`路径::符号` / `路径#符号`）归一到文件路径', () => {
    const text = '- [ ] T006 复用 `scripts/lib/goal-loop-core.mjs::parsePreservedConfigStates` 与 `src/a.ts#helper`\n';
    assert.deepEqual(extractTaskPaths(text), ['scripts/lib/goal-loop-core.mjs', 'src/a.ts']);
  });

  it('编辑器风格的 `:行[:列]` 后缀被剥掉', () => {
    const text = '- [ ] T007 改 `tests/unit/hook.test.ts:16,109` 的常量\n';
    assert.deepEqual(extractTaskPaths(text), ['tests/unit/hook.test.ts']);
  });

  it('同一路径重复出现只保留一次，且保持首次出现顺序', () => {
    const text = [
      '- [ ] T008 改 `src/b.ts`',
      '- [ ] T009 改 `src/a.ts` 与 `src/b.ts`',
      '',
    ].join('\n');
    assert.deepEqual(extractTaskPaths(text), ['src/b.ts', 'src/a.ts']);
  });

  it('非任务行（普通列表 / 表格 / 标题）一律不参与抽取', () => {
    const text = [
      '## 阶段 1',
      '- 参考 `docs/readme.md`',              // 无 checkbox
      '- [ ] 没有 T 编号，`docs/other.md`',    // 无 T 编号
      '| RG-001 | `plugins/x.mjs` | 门禁 |',   // 表格行
      '- [ ] T010 改 `src/real.ts`',
      '',
    ].join('\n');
    assert.deepEqual(extractTaskPaths(text), ['src/real.ts']);
  });

  it('无路径的任务行 → 空数组（不猜测）', () => {
    const text = '- [ ] T011 记录 batch base：`git rev-parse HEAD` 写进 trace\n';
    assert.deepEqual(extractTaskPaths(text), []);
  });

  it('空文本 / 非字符串 → 空数组', () => {
    assert.deepEqual(extractTaskPaths(''), []);
    assert.deepEqual(extractTaskPaths(null), []);
    assert.deepEqual(extractTaskPaths(undefined), []);
    assert.deepEqual(extractTaskPaths(42), []);
  });

  it('章节号 / 版本号 / URL / 命令行开关不得被误当成路径', () => {
    const text = [
      '- [ ] T012 见 plan §1.7 与 §1.2/§1.3，版本 v1.2.3',
      '- [ ] T013 参考 https://example.com/docs/guide.md 与 `--refresh-policy`',
      '- [ ] T014 扩展名白名单 `.ts/.tsx/.js/.jsx`',
      '',
    ].join('\n');
    assert.deepEqual(extractTaskPaths(text), []);
  });

  /**
   * B1-W2 —— 判据收紧的负例集。
   *
   * 审查复现两类误收：
   *   1. `Node.js` / `spectra.batch` 这类裸词满足"基名 + 字母开头扩展名"，被当成仓内路径；
   *      它们几乎必然不存在 → 直接把 advisory 轮 1 推向 `additive-only` → 跳过 impact。
   *   2. `/etc/passwd`、`../../outside.ts` 这类仓外 / 绝对路径被原样送去做存在性探测——
   *      一个仓外文件恰好存在就能反向把结论掰成 `modifies-existing`。
   * 判据因此加三条：必须含 `/`、不得绝对、不得含 `..` 段。
   */
  it('B1-W2 裸词（无 `/`）不得被当成路径：Node.js / v2.md / spectra.batch', () => {
    const text = [
      '- [ ] T101 升级 Node.js 到 20.x，参考 README.md 与 spectra.batch 说明',
      '- [ ] T102 见 v2.md',
      '',
    ].join('\n');
    assert.deepEqual(extractTaskPaths(text), []);
  });

  it('B1-W2 绝对路径 / Windows 盘符路径一律拒收（仓内相对路径才是合同）', () => {
    const text = [
      '- [ ] T103 读 /etc/passwd.txt 与 /Users/someone/secret.ts',
      '- [ ] T104 读 `C:/Windows/system.ini`',
      '',
    ].join('\n');
    assert.deepEqual(extractTaskPaths(text), []);
  });

  it('B1-W2 含 `..` 段的路径拒收（resolve 后可越出 projectRoot）', () => {
    const text = [
      '- [ ] T105 改 `../../outside/evil.ts` 与 `src/../../escape.ts`',
      '- [ ] T106 改 `./src/ok.ts`',
      '',
    ].join('\n');
    assert.deepEqual(extractTaskPaths(text), ['./src/ok.ts']);
  });

  it('B1-W2 收紧不得误伤正常仓内相对路径（正例对照）', () => {
    const text = '- [ ] T107 改 `plugins/spec-driver/scripts/lib/a.mjs` 与 tests/b.test.ts\n';
    assert.deepEqual(extractTaskPaths(text), [
      'plugins/spec-driver/scripts/lib/a.mjs',
      'tests/b.test.ts',
    ]);
  });

  it('真实 tasks.md 片段（多子句 + 强调 + 括号）只抽出真路径', () => {
    const text =
      '- [x] T004 新增 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`：把仓根 ' +
      '`scripts/lib/graph-bootstrap-status.mjs` 逐字节搬移到此路径，只追加一段 D8 迁移说明注释' +
      '（**不改内部逻辑**，D8 方案 A，plan §1.1/§1.2）\n';
    assert.deepEqual(extractTaskPaths(text), [
      'plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs',
      'scripts/lib/graph-bootstrap-status.mjs',
    ]);
  });
});

/* -------------------------------------------------- classifyFromTaskPaths */

describe('classifyFromTaskPaths — 存在性 → 三态分类', () => {
  const existsOnly = (...present) => {
    const set = new Set(present);
    return (filePath) => set.has(filePath);
  };

  it('任一路径已存在 → modifies-existing', () => {
    assert.equal(
      classifyFromTaskPaths(['src/new.ts', 'src/old.ts'], existsOnly('src/old.ts')),
      'modifies-existing',
    );
  });

  it('全部路径都不存在且清单非空 → additive-only', () => {
    assert.equal(classifyFromTaskPaths(['src/new.ts', 'src/other.ts'], existsOnly()), 'additive-only');
  });

  it('空清单 → unknown（"没抽到路径"不等于"全是新增"）', () => {
    assert.equal(classifyFromTaskPaths([], existsOnly('src/old.ts')), 'unknown');
  });

  it('非数组入参 → unknown', () => {
    assert.equal(classifyFromTaskPaths(null, existsOnly()), 'unknown');
    assert.equal(classifyFromTaskPaths('src/a.ts', existsOnly()), 'unknown');
  });

  it('未注入 fsExists → unknown（不回退到直接读磁盘）', () => {
    assert.equal(classifyFromTaskPaths(['src/a.ts'], undefined), 'unknown');
  });

  it('fsExists 抛错 → unknown（不把工具面失败折成 additive-only）', () => {
    assert.equal(
      classifyFromTaskPaths(['src/a.ts'], () => {
        throw new Error('EACCES');
      }),
      'unknown',
    );
  });

  it('命中即短路：第一个存在的路径之后不再继续探测', () => {
    const probed = [];
    const verdict = classifyFromTaskPaths(['a.ts', 'b.ts', 'c.ts'], (filePath) => {
      probed.push(filePath);
      return filePath === 'a.ts';
    });
    assert.equal(verdict, 'modifies-existing');
    assert.deepEqual(probed, ['a.ts']);
  });
});

/* -------------------------------------------------------------- 纯函数性 */

describe('模块纯度（与 git-change-classifier 同规格）', () => {
  it('模块源码不 import node:fs / node:child_process', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const modulePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'scripts',
      'lib',
      'tasks-path-signal.mjs',
    );
    const text = fs.readFileSync(modulePath, 'utf-8');
    assert.doesNotMatch(text, /from\s+'node:fs'/, 'fsExists 必须依赖注入，模块本身零 I/O');
    assert.doesNotMatch(text, /from\s+'node:child_process'/);
  });
});
