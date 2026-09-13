/**
 * sidechain-file-set-guard.test.mjs
 * F290（批次 3 残余）— SubagentStop 检测侧 import 闭包守卫
 *
 * 对 SubagentStop 侧 CLI fix-compliance-sidechain-marker.mjs 跑 BFS 静态 import 闭包解析，
 * 断言与 SIDECHAIN_FILE_SET 完全相等；ok:false 同样判 FAIL（与 judge-file-set-guard 同纪律）。
 * 目的：F236「本机门禁跑着旧判定器」同型风险在检测侧（sidechain 标记 CLI 陈旧 ⟹ (c) 源静默失效）也进 doctor 快照比对。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStaticImportClosure } from './lib/import-closure-parser.mjs';
import { JUDGE_FILE_SET, SIDECHAIN_FILE_SET, DOCTOR_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(PLUGIN_ROOT, 'scripts', 'lib', 'fix-compliance-sidechain-marker.mjs');

describe('sidechain-file-set-guard — 检测侧真实 import 闭包 == SIDECHAIN_FILE_SET', () => {
  it('resolveStaticImportClosure 对 sidechain CLI 返回 ok:true 且闭包与 SIDECHAIN_FILE_SET 完全相等', () => {
    const result = resolveStaticImportClosure(ENTRY);
    if (!result.ok) {
      assert.fail(`守卫解析器检测到未支持的 import 形态，请人工确认 SIDECHAIN_FILE_SET：\n${JSON.stringify(result.unsupported, null, 2)}`);
    }
    const relFiles = new Set(result.files.map((abs) => path.relative(PLUGIN_ROOT, abs)));
    assert.deepStrictEqual(relFiles, new Set(SIDECHAIN_FILE_SET));
    assert.equal(relFiles.size, SIDECHAIN_FILE_SET.length);
  });

  it('DOCTOR_FILE_SET = JUDGE_FILE_SET ∪ SIDECHAIN_FILE_SET（去重、JUDGE 顺序在前、入口仍是 JUDGE_FILE_SET[0]）', () => {
    const union = [...JUDGE_FILE_SET, ...SIDECHAIN_FILE_SET.filter((f) => !JUDGE_FILE_SET.includes(f))];
    assert.deepStrictEqual([...DOCTOR_FILE_SET], union);
    assert.equal(DOCTOR_FILE_SET[0], JUDGE_FILE_SET[0]);
    assert.ok(DOCTOR_FILE_SET.includes('scripts/lib/fix-compliance-sidechain-marker.mjs'), '检测侧 CLI 必须进 doctor 比对集');
    assert.ok(!JUDGE_FILE_SET.includes('scripts/lib/fix-compliance-sidechain-marker.mjs'), '判定器闭包本身不 import 检测侧 CLI（FR-002b 守卫不变）');
    assert.ok(Object.isFrozen(SIDECHAIN_FILE_SET) && Object.isFrozen(DOCTOR_FILE_SET));
  });
});
