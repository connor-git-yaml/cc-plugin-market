/**
 * F283 — (b) DELEGATION_TOOL_NAMES 单源（core / ledger-writer / ledger-reader 共用一份，进判定器闭包）；
 *        (c) parseRenameOperands 变异钉住矩阵（M10 §12.3 W-3：`operands.length !== 2` 改 `< 2` 曾 829 用例零红）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DELEGATION_TOOL_NAMES } from '../scripts/lib/delegation-tool-names.mjs';
import { DELEGATION_TOOL_NAMES as READER_NAMES } from '../scripts/lib/ledger-reader.mjs';
import { parseRenameOperands } from '../scripts/lib/fix-compliance-core.mjs';
import { JUDGE_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.resolve(HERE, '../scripts/lib', rel), 'utf8');

describe('F283 (b) · DELEGATION_TOOL_NAMES 单源', () => {
  it('内容 = {Agent, Task}；reader 的导出就是同一个对象；真不可变（add / delete / clear 抛错，Object.freeze 对 Set 内容是空保证）', () => {
    assert.deepEqual([...DELEGATION_TOOL_NAMES].sort(), ['Agent', 'Task']);
    assert.equal(READER_NAMES, DELEGATION_TOOL_NAMES);
    assert.throws(() => DELEGATION_TOOL_NAMES.add('Bash'), /不可变/);
    assert.throws(() => DELEGATION_TOOL_NAMES.delete('Agent'), /不可变/);
    assert.throws(() => DELEGATION_TOOL_NAMES.clear(), /不可变/);
    assert.equal(DELEGATION_TOOL_NAMES.size, 2);
    assert.ok(DELEGATION_TOOL_NAMES.has('Task'));
  });

  it('core / ledger-writer / ledger-reader 源码里不再有第二份 new Set([...]) 字面量，且都 import 单源模块', () => {
    for (const rel of ['fix-compliance-core.mjs', 'ledger-writer.mjs', 'ledger-reader.mjs']) {
      const text = src(rel);
      assert.equal(/DELEGATION_TOOL_NAMES\s*=\s*new Set\(/.test(text), false, `${rel} 仍有本地副本`);
      assert.ok(text.includes("from './delegation-tool-names.mjs'"), `${rel} 未 import 单源`);
    }
  });

  it('单源模块进入判定器 import 闭包（JUDGE_FILE_SET）', () => {
    assert.ok(JUDGE_FILE_SET.includes('scripts/lib/delegation-tool-names.mjs'));
  });
});

describe('F283 (c) · parseRenameOperands 单元合同矩阵（生产方向由 scanRenameCommandEvents 的 F231 用例承担；矩阵 23 行中仅 5 行在生产入口可达（verify 子代理用 scanRenameCommandEvents 逐行实测））', () => {
  const MATRIX = [
    // [输入, 期望]                                 // 钉住的方向
    ['specs/300-fix-a specs/301-fix-b', ['specs/300-fix-a', 'specs/301-fix-b']],
    ['specs/300-fix-a', null],                       // 1 操作数 → null
    ['specs/300-fix-a specs/301-fix-b extra', null], // 3 操作数 → null（变异 `!== 2`→`< 2` 会返回前两个 → 红）
    ['a b c d', null],
    ['-f a b', ['a', 'b']],                          // 无参 option 不计入操作数
    ['-fv a b', ['a', 'b']],
    ['-- a b', ['a', 'b']],                          // 显式 end-of-options
    ['a -- b', ['a', 'b']],
    ['-t dir a', null],                              // 带参 option → 位次错位 → null
    ['--target-directory=dir a b', null],
    ['-S .bak a b', null],
    ['--suffix=.bak a b', null],
    ['"a b" c', null],                               // 含空格引号路径按空白拆散 → 3 token → null（保守化）
    ["'a' 'b'", ['a', 'b']],                         // 首尾成对简单引号剥除
    ['"a\'b" c', ["a'b", 'c']],                      // 内部不含同种引号才剥
    ['"a"b" c', ['"a"b"', 'c']],                     // 内部含同种引号 → 不剥
    ['- b', ['-', 'b']],                             // 单字符 `-` 是操作数（stdin 约定）
    ['-a -b -c -d -e -f -g -h x y', ['x', 'y']],      // 8 个 option = 上界内
    ['-a -b -c -d -e -f -g -h -i x y', null],         // 9 个 option > RENAME_MAX_OPTION_TOKENS(8) → null
    ['-- -- a b', null],                             // 第二个 `--` 成操作数 → 3 操作数 → null
    ['a\tb', ['a', 'b']],                            // tab 分隔（生产可达形态；split(/\s+/) 改 split(' ') 在此红）
    ['', null],
    ['   ', null],
  ];

  it('矩阵逐行（23 行）', () => {
    for (const [input, expected] of MATRIX) {
      assert.deepEqual(parseRenameOperands(input), expected, `input=${JSON.stringify(input)}`);
    }
  });

  it('方向钉：操作数 ≠ 2 一律 null，多操作数不得"取前两个"跟随（fail-closed：不识别 = 不跟随）', () => {
    assert.equal(parseRenameOperands('specs/300-fix-a specs/301-fix-b specs/302-fix-c'), null);
    assert.equal(parseRenameOperands('specs/300-fix-a'), null);
  });
});
