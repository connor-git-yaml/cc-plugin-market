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
import { validateConfig, resolveEffectiveConfig, BUILTIN_DEFAULTS, zodAvailable } from '../scripts/lib/config-schema.mjs';
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

// resolveEffectiveConfig 不依赖 zod（纯对象合并），故以下用例无需 zod 守卫。
describe('config-schema: resolveEffectiveConfig 展示 batch.concurrency（111423f R1 WARNING 2 follow-up）', () => {
  function findBatchEntry(entries) {
    return entries.find((e) => e.key === 'batch.concurrency');
  }

  it('显式配置时展示该行，且来源标注 spectra batch 子系统', () => {
    const entries = resolveEffectiveConfig({ configYaml: { batch: { concurrency: 3 } } });
    const entry = findBatchEntry(entries);
    assert.ok(entry, '应展示 batch.concurrency 行');
    assert.equal(entry.value, 3, '生效值应为配置值');
    assert.equal(
      entry.source,
      'config.yaml (spectra batch)',
      '来源应标注 spectra batch 子系统，避免被误读为编排器并发旋钮',
    );
  });

  it('quoted 字符串 "3" 原样流经展示（与运行时 readBatchConcurrency 接受集一致）', () => {
    const entries = resolveEffectiveConfig({ configYaml: { batch: { concurrency: '3' } } });
    const entry = findBatchEntry(entries);
    assert.ok(entry, '字符串数字也应展示');
    assert.equal(entry.value, '3', '原样保留字符串值（整数化交运行时 normalizeConcurrency）');
    assert.equal(entry.source, 'config.yaml (spectra batch)');
  });

  it('未配置 batch 时不展示 batch.concurrency 行（不伪造运行时默认 3）', () => {
    const entries = resolveEffectiveConfig({ configYaml: {} });
    assert.equal(findBatchEntry(entries), undefined, '未配置时不应有 batch.concurrency 行');
  });

  it('batch 段存在但 concurrency 缺失时不展示（仅 batch:{}）', () => {
    const entries = resolveEffectiveConfig({ configYaml: { batch: {} } });
    assert.equal(findBatchEntry(entries), undefined);
  });

  it('回归护栏：batch.concurrency 不得进入 BUILTIN_DEFAULTS（守住单源 — 默认 canonical 在 src/ 运行时）', () => {
    // 真护栏（数据结构层）：直接断言 BUILTIN_DEFAULTS 不含 batch.concurrency。
    // why 不能只查 resolveEffectiveConfig 输出——那是假绿：batch.concurrency 不在 nestedKeys，
    // 即便有人污染 BUILTIN_DEFAULTS，输出也不会冒出"内置默认"来源的 batch 行，行为层察觉不到
    // （codex follow-up 审查 WARNING：脚本动态注入 BUILTIN_DEFAULTS['batch.concurrency']=3 后输出仍不变）。
    assert.equal(
      Object.hasOwn(BUILTIN_DEFAULTS, 'batch.concurrency'),
      false,
      'batch.concurrency 不应出现在 BUILTIN_DEFAULTS（避免与 src/ 运行时默认 3 形成双源）',
    );
    // 行为层兜底：当前展示逻辑对任何配置都不应产出"内置默认"来源的 batch.concurrency 行。
    for (const configYaml of [{}, { batch: {} }, { batch: { concurrency: 3 } }]) {
      const entries = resolveEffectiveConfig({ configYaml });
      const builtinBatch = entries.find(
        (e) => e.key === 'batch.concurrency' && e.source === '内置默认',
      );
      assert.equal(builtinBatch, undefined, '展示逻辑不应产出内置默认来源的 batch.concurrency');
    }
  });

  it('未触动编排器字段：未配置时 retry.max_attempts 仍以内置默认展示', () => {
    // 确认新增 batch 块未干扰既有 nestedKeys 通用回退逻辑。
    const entries = resolveEffectiveConfig({ configYaml: {} });
    const retry = entries.find((e) => e.key === 'retry.max_attempts');
    assert.ok(retry, '编排器字段应照常展示');
    assert.equal(retry.source, '内置默认');
    assert.equal(retry.value, 2);
  });
});

describe('config-schema: goal_loop.full_required_kinds（F204）', () => {
  it('AC-7: 省略 full_required_kinds → validateConfig 通过，data 补默认 []', () => {
    const result = validateConfig({ goal_loop: { max_iterations: 5 } });
    assert.equal(result.success, true);
    assert.deepEqual(errorsOf(result), []);
    assert.deepEqual(
      result.data.goal_loop.full_required_kinds,
      [],
      '省略时应被 zod default 填为 []',
    );
  });

  it('AC-7: 声明合法枚举 ["build","test"] → 通过且保留', () => {
    const result = validateConfig({ goal_loop: { full_required_kinds: ['build', 'test'] } });
    assert.equal(result.success, true);
    assert.deepEqual(errorsOf(result), []);
    assert.deepEqual(result.data.goal_loop.full_required_kinds, ['build', 'test']);
  });

  it('AC-7 变体: 非法枚举值 ["invalid"] → validateConfig 报 error', {
    skip: !zodAvailable && '缺 zod 时降级为 best-effort，不做枚举校验',
  }, () => {
    const result = validateConfig({ goal_loop: { full_required_kinds: ['invalid'] } });
    assert.equal(result.success, false);
    assert.ok(errorsOf(result).length > 0, '非法枚举应产生 error 级诊断');
  });

  it('W-2: resolveEffectiveConfig 展示 goal_loop.full_required_kinds（未配置→内置默认 []）', () => {
    const entries = resolveEffectiveConfig({ configYaml: {} });
    const entry = entries.find((e) => e.key === 'goal_loop.full_required_kinds');
    assert.ok(entry, '应展示 goal_loop.full_required_kinds 行');
    assert.deepEqual(entry.value, []);
    assert.equal(entry.source, '内置默认');
  });

  it('W-2: 显式配置时 resolveEffectiveConfig 展示配置值', () => {
    const entries = resolveEffectiveConfig({
      configYaml: { goal_loop: { full_required_kinds: ['build', 'test', 'lint', 'check'] } },
    });
    const entry = entries.find((e) => e.key === 'goal_loop.full_required_kinds');
    assert.ok(entry);
    assert.deepEqual(entry.value, ['build', 'test', 'lint', 'check']);
    assert.equal(entry.source, 'config.yaml');
  });

  it('W-2: BUILTIN_DEFAULTS 含 goal_loop.full_required_kinds=[]', () => {
    assert.deepEqual(BUILTIN_DEFAULTS['goal_loop.full_required_kinds'], []);
  });
});

describe('config-schema: fix_compliance 段（Feature 208 FR-015）', () => {
  it('合法三值（block/warn/off）均通过校验', () => {
    for (const value of ['block', 'warn', 'off']) {
      const result = validateConfig({ fix_compliance: { enforcement: value } });
      assert.equal(result.success, true, `enforcement=${value} 应通过`);
      assert.deepEqual(errorsOf(result), [], `enforcement=${value} 不应有 error`);
    }
  });

  it('非法 enforcement 值报 error', {
    skip: !zodAvailable && '缺 zod 时降级为 best-effort，不做枚举校验',
  }, () => {
    const result = validateConfig({ fix_compliance: { enforcement: 'strict' } });
    assert.equal(result.success, false);
    assert.ok(errorsOf(result).length > 0, '非法枚举应产生 error 级诊断');
  });

  it('省略 fix_compliance → 通过，data 补默认 block', () => {
    const result = validateConfig({ preset: 'balanced' });
    assert.equal(result.success, true);
    assert.deepEqual(errorsOf(result), []);
    assert.equal(result.data.fix_compliance.enforcement, 'block', '省略时应被 zod default 填为 block');
  });

  it('近似拼写 fix_complianc 会建议 fix_compliance（确认已登记为已知顶层字段）', {
    skip: !zodAvailable && '缺 zod 时降级为 best-effort 接受，不产生未知字段诊断',
  }, () => {
    const result = validateConfig({ fix_complianc: { enforcement: 'block' } });
    assert.equal(result.success, false);
    const err = errorsOf(result).find((d) => d.code === 'config.unknown-field');
    assert.ok(err, '应报未知字段错误');
    assert.equal(err.suggestion, 'fix_compliance', '应建议 fix_compliance');
  });

  it('resolveEffectiveConfig 缺省得内置默认 block', () => {
    const entries = resolveEffectiveConfig({ configYaml: {} });
    const entry = entries.find((e) => e.key === 'fix_compliance.enforcement');
    assert.ok(entry, '应展示 fix_compliance.enforcement 行');
    assert.equal(entry.value, 'block');
    assert.equal(entry.source, '内置默认');
  });

  it('resolveEffectiveConfig 显式配置时展示配置值', () => {
    const entries = resolveEffectiveConfig({ configYaml: { fix_compliance: { enforcement: 'warn' } } });
    const entry = entries.find((e) => e.key === 'fix_compliance.enforcement');
    assert.ok(entry);
    assert.equal(entry.value, 'warn');
    assert.equal(entry.source, 'config.yaml');
  });

  it('BUILTIN_DEFAULTS 含 fix_compliance.enforcement=block', () => {
    assert.equal(BUILTIN_DEFAULTS['fix_compliance.enforcement'], 'block');
  });
});
