/**
 * judge-file-set-guard.test.mjs
 * Feature 236 — FR-002b 真实闭包守卫测试
 *
 * 对仓库真实入口 fix-compliance-judge.mjs 跑 BFS 静态 import 闭包解析，
 * 断言解析结果与 JUDGE_FILE_SET 完全相等；ok:false（无法归类）时同样判 FAIL
 * ——不确定本身即视为守卫失败，不允许静默放行（data-model.md §7.4）。
 *
 * 运行: node --test plugins/spec-driver/tests/judge-file-set-guard.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStaticImportClosure } from './lib/import-closure-parser.mjs';
import { JUDGE_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests → spec-driver
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(PLUGIN_ROOT, 'scripts', 'fix-compliance-judge.mjs');

describe('judge-file-set-guard — 真实 import 闭包 == JUDGE_FILE_SET', () => {
  it('resolveStaticImportClosure 对真实入口返回 ok:true（无法归类即守卫失败）', () => {
    const result = resolveStaticImportClosure(ENTRY);
    if (!result.ok) {
      assert.fail(
        `守卫解析器检测到未支持的 import 形态，请人工确认 JUDGE_FILE_SET：\n` +
          JSON.stringify(result.unsupported, null, 2),
      );
    }
    // 转换为相对 plugins/spec-driver/ 的路径集合
    const relFiles = new Set(result.files.map((abs) => path.relative(PLUGIN_ROOT, abs)));
    const expected = new Set(JUDGE_FILE_SET);
    assert.deepStrictEqual(relFiles, expected);
    assert.equal(relFiles.size, 7);
  });
});
