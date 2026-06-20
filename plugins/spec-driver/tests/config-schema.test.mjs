/**
 * config-schema.test.mjs
 * spec-driver.config.yaml 的 Zod Schema 校验测试（使用 Node.js 内置测试框架）
 *
 * 运行方式: node --test plugins/spec-driver/tests/config-schema.test.mjs
 *
 * 测试覆盖（聚焦 Feature 146 batch 段补全）：
 * - 仓库实际 spec-driver.config.yaml 通过校验（防止 yaml 顶层字段与 schema 再次漂移）
 * - batch 段被顶层 schema 接受，修复 validate-config "未知字段 batch" 退出码 1
 * - batch.concurrency 接受集与运行时 readBatchConcurrency 对齐（有限 number 或数字字符串如 "3"；
 *   整数化 / 越界裁剪交运行时 normalizeConcurrency），非数字类型 + 未知子字段被 strict 拒绝（zod 可用时）
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig, zodAvailable } from '../scripts/lib/config-schema.mjs';
import { parseYamlDocument } from '../scripts/lib/simple-yaml.mjs';

// 测试文件位于 plugins/spec-driver/tests/，向上三级即仓库根
const REPO_CONFIG_PATH = fileURLToPath(
  new URL('../../../spec-driver.config.yaml', import.meta.url),
);

function errorsOf(result) {
  return result.diagnostics.filter((d) => d.level === 'error');
}

describe('config-schema: batch 段（Feature 146）', () => {
  it('仓库实际 spec-driver.config.yaml 通过 schema 校验（含 batch 段）', () => {
    const parsed = parseYamlDocument(readFileSync(REPO_CONFIG_PATH, 'utf8'));
    assert.ok(parsed && typeof parsed === 'object', '配置应解析为对象');
    assert.ok('batch' in parsed, '前提：仓库配置确实含 batch 段，否则本回归测试失去意义');
    const result = validateConfig(parsed);
    assert.equal(result.success, true, '仓库实际配置应通过校验');
    assert.deepEqual(errorsOf(result), [], '不应有 error 级诊断');
  });

  it('合法 batch.concurrency 被接受', () => {
    const result = validateConfig({ batch: { concurrency: 3 } });
    assert.equal(result.success, true);
    assert.deepEqual(errorsOf(result), []);
  });

  it('空 batch 段合法（concurrency 可选）', () => {
    const result = validateConfig({ batch: {} });
    assert.equal(result.success, true);
    assert.deepEqual(errorsOf(result), []);
  });

  it('近似拼写 batc 会建议 batch（确认 batch 已登记为已知顶层字段）', {
    skip: !zodAvailable && '缺 zod 时降级为 best-effort 接受，不产生未知字段诊断',
  }, () => {
    const result = validateConfig({ batc: { concurrency: 3 } });
    assert.equal(result.success, false);
    const err = errorsOf(result).find((d) => d.code === 'config.unknown-field');
    assert.ok(err, '应报未知字段错误');
    assert.equal(err.suggestion, 'batch', '应建议 batch');
  });

  it('quoted 数字字符串 "3" 被接受（与运行时 readBatchConcurrency 合同一致）', () => {
    const result = validateConfig({ batch: { concurrency: '3' } });
    assert.equal(result.success, true);
    assert.deepEqual(errorsOf(result), []);
  });

  it('运行时归一化值（小数 / 0 / 负数 / 越界）在 schema 层被接受（整数化与裁剪交运行时）', () => {
    for (const v of [2.5, 0, -1, 100]) {
      const result = validateConfig({ batch: { concurrency: v } });
      assert.equal(result.success, true, `concurrency=${v} 应在 schema 层接受（运行时归一化）`);
      assert.deepEqual(errorsOf(result), [], `concurrency=${v} 不应有 error`);
    }
  });

  it('非数字类型 concurrency（boolean / 非数字字符串 / 数组）被拒绝', {
    skip: !zodAvailable && '缺 zod 时降级为 best-effort 接受，无 schema 拒绝可测',
  }, () => {
    for (const bad of [true, 'abc', [3]]) {
      const result = validateConfig({ batch: { concurrency: bad } });
      assert.equal(result.success, false, `concurrency=${JSON.stringify(bad)} 应校验失败`);
      assert.ok(errorsOf(result).length > 0, `concurrency=${JSON.stringify(bad)} 应有 error 诊断`);
    }
  });

  it('batch 段 strict — 未知子字段被拒绝', {
    skip: !zodAvailable && '缺 zod 时降级为 best-effort 接受，无 schema 拒绝可测',
  }, () => {
    const result = validateConfig({ batch: { concurrency: 3, unknown_knob: true } });
    assert.equal(result.success, false);
    assert.ok(errorsOf(result).length > 0, '未知子字段应产生 error');
  });
});
