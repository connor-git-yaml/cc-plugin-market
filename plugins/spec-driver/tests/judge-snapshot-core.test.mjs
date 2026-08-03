/**
 * judge-snapshot-core.test.mjs
 * Feature 236 — 纯函数层单测（core）
 *
 * 覆盖：compareFile 九组合、aggregateStatus 三分支、resolveActiveSnapshot FR-007 四步 + W1 边界、
 * JUDGE_FILE_SET 常量断言。全部为纯函数输入/输出断言，不触碰真实文件系统。
 *
 * 运行: node --test plugins/spec-driver/tests/judge-snapshot-core.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  JUDGE_FILE_SET,
  resolveActiveSnapshot,
  compareFile,
  aggregateStatus,
} from '../scripts/lib/judge-snapshot-core.mjs';

// --- 测试辅助构造子 ---
const ok = (sha256) => ({ status: 'ok', sha256 });
const missing = () => ({ status: 'missing', sha256: null });
const errDigest = (errorCode) => ({ status: 'error', sha256: null, errorCode });

describe('compareFile — data-model.md §5 九组合判定表', () => {
  it('error × error → indeterminate/both, errorCode 取 repo 侧', () => {
    assert.deepStrictEqual(
      compareFile(errDigest('EACCES'), errDigest('EPERM')),
      { status: 'indeterminate', side: 'both', errorCode: 'EACCES' },
    );
  });

  it('error × 非 error → indeterminate/repo', () => {
    assert.deepStrictEqual(
      compareFile(errDigest('EACCES'), ok('a')),
      { status: 'indeterminate', side: 'repo', errorCode: 'EACCES' },
    );
    assert.deepStrictEqual(
      compareFile(errDigest('EACCES'), missing()),
      { status: 'indeterminate', side: 'repo', errorCode: 'EACCES' },
    );
  });

  it('非 error × error → indeterminate/snapshot', () => {
    assert.deepStrictEqual(
      compareFile(ok('a'), errDigest('EACCES')),
      { status: 'indeterminate', side: 'snapshot', errorCode: 'EACCES' },
    );
    assert.deepStrictEqual(
      compareFile(missing(), errDigest('EACCES')),
      { status: 'indeterminate', side: 'snapshot', errorCode: 'EACCES' },
    );
  });

  it('missing × missing → missingBoth（W2 修订核心，不是 missingInRepo）', () => {
    assert.deepStrictEqual(compareFile(missing(), missing()), { status: 'missingBoth' });
  });

  it('missing × ok → missingInRepo', () => {
    assert.deepStrictEqual(compareFile(missing(), ok('a')), { status: 'missingInRepo' });
  });

  it('ok × missing → missingInSnapshot', () => {
    assert.deepStrictEqual(compareFile(ok('a'), missing()), { status: 'missingInSnapshot' });
  });

  it('ok × ok，sha256 相等 → match', () => {
    assert.deepStrictEqual(compareFile(ok('deadbeef'), ok('deadbeef')), { status: 'match' });
  });

  it('ok × ok，sha256 不等 → mismatch', () => {
    assert.deepStrictEqual(compareFile(ok('aaaa'), ok('bbbb')), { status: 'mismatch' });
  });
});

describe('aggregateStatus — 三分支', () => {
  const entry = (status) => ({ file: 'x', status });

  it('任一 indeterminate → indeterminate（优先级最高）', () => {
    assert.equal(
      aggregateStatus([entry('match'), entry('mismatch'), entry('indeterminate')]),
      'indeterminate',
    );
  });

  it('无 indeterminate 但存在非 match → drift', () => {
    assert.equal(aggregateStatus([entry('match'), entry('mismatch')]), 'drift');
    assert.equal(aggregateStatus([entry('match'), entry('missingInSnapshot')]), 'drift');
    assert.equal(aggregateStatus([entry('match'), entry('missingInRepo')]), 'drift');
    assert.equal(aggregateStatus([entry('match'), entry('missingBoth')]), 'drift');
  });

  it('全部 match → in-sync', () => {
    assert.equal(aggregateStatus([entry('match'), entry('match')]), 'in-sync');
  });
});

describe('resolveActiveSnapshot — FR-007 四步优先级 + W1 边界', () => {
  const okProbe = (path) => ({ kind: 'ok', path, canonicalPath: path });
  const candidate = (over = {}) => ({
    path: over.path ?? '/c',
    canonicalPath: over.canonicalPath ?? over.path ?? '/c',
    scope: over.scope ?? null,
    valid: over.valid ?? { kind: 'ok' },
  });

  it('claudePluginRoot=ok 命中 → claude-plugin-root（短路，不看后续）', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: okProbe('/root/a'),
      // 若检查后续来源会得到不同结果 → 用于证明短路
      specDriverPath: okProbe('/root/b'),
      installedMetadata: { kind: 'ok', candidates: [candidate({ path: '/root/c' })] },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/root/a', resolutionSource: 'claude-plugin-root' });
  });

  it('claudePluginRoot=error → 立即 source-error，不看后续（短路证明）', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'error', errorCode: 'EACCES' },
      specDriverPath: okProbe('/root/b'),
      installedMetadata: { kind: 'ok', candidates: [candidate({ path: '/root/c' })] },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'claude-plugin-root', errorCode: 'EACCES' },
    });
  });

  it('claudePluginRoot=invalid（name-mismatch）→ 不短路，继续第 2 步', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'invalid', reason: 'name-mismatch' },
      specDriverPath: okProbe('/root/b'),
      installedMetadata: { kind: 'absent' },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/root/b', resolutionSource: 'spec-driver-path-file' });
  });

  it('claudePluginRoot=unavailable, specDriverPath=ok → spec-driver-path-file', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: okProbe('/root/b'),
      installedMetadata: { kind: 'absent' },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/root/b', resolutionSource: 'spec-driver-path-file' });
  });

  it('specDriverPath=invalid（dir-absent，悬空指针）→ 确定性负判定，继续第 3 步', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'invalid', reason: 'dir-absent' },
      installedMetadata: { kind: 'ok', candidates: [candidate({ path: '/root/c' })] },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/root/c', resolutionSource: 'installed-plugins-metadata' });
  });

  it('specDriverPath=error → 立即 source-error', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'error', errorCode: 'EACCES' },
      installedMetadata: { kind: 'ok', candidates: [candidate({ path: '/root/c' })] },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'spec-driver-path-file', errorCode: 'EACCES' },
    });
  });

  it('installedMetadata 单条 valid ok → installed-plugins-metadata', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: { kind: 'ok', candidates: [candidate({ path: '/root/c' })] },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/root/c', resolutionSource: 'installed-plugins-metadata' });
  });

  it('one-valid-one-invalid：过滤后剩 1 条 → 不算歧义，直接采用', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [
          candidate({ path: '/good', canonicalPath: '/good' }),
          candidate({ path: '/bad', canonicalPath: '/bad', valid: { kind: 'invalid', reason: 'name-mismatch' } }),
        ],
      },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/good', resolutionSource: 'installed-plugins-metadata' });
  });

  it('duplicate-same-path：canonicalPath 相同（symlink）→ 单一候选，不算歧义', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [
          candidate({ path: '/a/link', canonicalPath: '/real' }),
          candidate({ path: '/real', canonicalPath: '/real' }),
        ],
      },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/real', resolutionSource: 'installed-plugins-metadata' });
  });

  it('候选含 error：整体 source-error，即使另一条 ok 也不跳过', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [
          candidate({ path: '/good', canonicalPath: '/good' }),
          candidate({ path: '/err', canonicalPath: '/err', valid: { kind: 'error', errorCode: 'EACCES' } }),
        ],
      },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'installed-plugins-metadata', errorCode: 'EACCES' },
    });
  });

  it('scope 优先级：存在 project scope → 只保留 project，视为单一候选', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [
          candidate({ path: '/proj', canonicalPath: '/proj', scope: 'project' }),
          candidate({ path: '/user', canonicalPath: '/user', scope: 'user' }),
        ],
      },
    });
    assert.deepStrictEqual(res, { snapshotPath: '/proj', resolutionSource: 'installed-plugins-metadata' });
  });

  it('scope 全 user/null 对照：不引入进一步优先级，按原候选数判定（2 条 → 歧义）', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [
          candidate({ path: '/u1', canonicalPath: '/u1', scope: 'user' }),
          candidate({ path: '/u2', canonicalPath: '/u2', scope: null }),
        ],
      },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'installed-plugins-metadata-ambiguous',
    });
  });

  it('恰 2 条不同 canonicalPath 均 ok → installed-plugins-metadata-ambiguous', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [
          candidate({ path: '/x', canonicalPath: '/x' }),
          candidate({ path: '/y', canonicalPath: '/y' }),
        ],
      },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'installed-plugins-metadata-ambiguous',
    });
  });

  it('installedMetadata=error → source-error', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: { kind: 'error', errorCode: 'EACCES' },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'installed-plugins-metadata', errorCode: 'EACCES' },
    });
  });

  it('installedMetadata=invalid（json-parse-error）→ source-error', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: { kind: 'invalid', reason: 'json-parse-error' },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'installed-plugins-metadata', errorCode: 'json-parse-error' },
    });
  });

  it('三路均 unavailable/absent → no-active-snapshot-resolvable', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'unavailable' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: { kind: 'absent' },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'no-active-snapshot-resolvable',
    });
  });

  it('installedMetadata ok 但候选全被过滤（全 invalid）→ no-active-snapshot-resolvable', () => {
    const res = resolveActiveSnapshot({
      claudePluginRoot: { kind: 'invalid', reason: 'name-mismatch' },
      specDriverPath: { kind: 'unavailable' },
      installedMetadata: {
        kind: 'ok',
        candidates: [candidate({ valid: { kind: 'invalid', reason: 'name-mismatch' } })],
      },
    });
    assert.deepStrictEqual(res, {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'no-active-snapshot-resolvable',
    });
  });
});

describe('JUDGE_FILE_SET — 常量断言', () => {
  it('长度为 7，内容与 data-model.md 罗列一致（Set 比较，顺序无关）', () => {
    assert.equal(JUDGE_FILE_SET.length, 7);
    assert.deepStrictEqual(
      new Set(JUDGE_FILE_SET),
      new Set([
        'scripts/fix-compliance-judge.mjs',
        'scripts/lib/fix-compliance-core.mjs',
        'scripts/lib/fix-compliance-execution-record.mjs',
        'scripts/lib/fix-compliance-io.mjs',
        // F246：record-workflow-run.mjs 入口守卫改用共享 helper 后进入闭包
        'scripts/lib/is-invoked-directly.mjs',
        'scripts/lib/simple-yaml.mjs',
        'scripts/record-workflow-run.mjs',
      ]),
    );
  });

  it('Object.freeze 生效：push/赋值不改变内容', () => {
    assert.throws(() => JUDGE_FILE_SET.push('x'));
    assert.equal(JUDGE_FILE_SET.length, 7);
  });
});
