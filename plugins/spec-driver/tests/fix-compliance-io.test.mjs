/**
 * fix-compliance-io.test.mjs
 * Feature 208 — fix 依从性判定 I/O 边界单测
 *
 * Tests FIRST（research.md D7）：先于 fix-compliance-io.mjs 存在，import 失败即红。
 * 本文件覆盖 payload/transcript/config/audit/featureDir 五组函数；
 * BlockCountState 读写（loadBlockState/saveBlockState）不在本任务范围（归 T023）。
 *
 * 运行: node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_TRANSCRIPT_BYTES,
  readHookPayload,
  readTranscriptEntries,
  findAndParseConfig,
  appendAuditEvent,
  checkFeatureDirOnDisk,
  readArtifactFile,
  loadBlockState,
  saveBlockState,
  resetBlockState,
  sanitizeSessionId,
  listFeatureDirCandidatesByShortName,
} from '../scripts/lib/fix-compliance-io.mjs';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-compliance-io-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('readHookPayload', () => {
  it('合法 payload → ok', () => {
    const r = readHookPayload(JSON.stringify({ session_id: 'abc', transcript_path: '/x/t.jsonl', stop_hook_active: false }));
    assert.equal(r.ok, true);
    assert.equal(r.payload.session_id, 'abc');
  });
  it('缺 session_id → payload-invalid', () => {
    const r = readHookPayload(JSON.stringify({ transcript_path: '/x/t.jsonl' }));
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics.includes('payload-invalid'));
  });
  it('非 JSON → payload-invalid（不抛出）', () => {
    const r = readHookPayload('not json{');
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics.includes('payload-invalid'));
  });

  // F240 T036 · FR-004：transcript_path 放宽（Codex payload schema 中该字段 nullable）。
  // 三类输入的诊断必须语义可区分：路径缺席 ≠ 路径给了但读不到 ≠ payload 本身结构非法。
  it('F240：transcript_path 缺失 + session_id 有值 → ok（不再误判 payload-invalid）', () => {
    const r = readHookPayload(JSON.stringify({ session_id: 'abc', stop_hook_active: false }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.diagnostics, []);
    assert.equal(r.payload.session_id, 'abc');
  });
  it('F240：transcript_path 为 null → ok', () => {
    const r = readHookPayload(JSON.stringify({ session_id: 'abc', transcript_path: null }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.diagnostics, []);
  });
  it('F240：transcript_path 为空串 → ok（视同缺席，下游产出 transcript-path-absent）', () => {
    const r = readHookPayload(JSON.stringify({ session_id: 'abc', transcript_path: '' }));
    assert.equal(r.ok, true);
  });
  it('F240：transcript_path 类型非法（非字符串非 null）→ 仍 payload-invalid', () => {
    for (const bad of [123, true, { a: 1 }, ['x']]) {
      const r = readHookPayload(JSON.stringify({ session_id: 'abc', transcript_path: bad }));
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.deepEqual(r.diagnostics, ['payload-invalid'], JSON.stringify(bad));
    }
  });
  it('F240：session_id 仍必需 —— 缺失/空串/类型非法一律 payload-invalid（放宽不外溢）', () => {
    for (const bad of [undefined, '', 123, null, {}]) {
      const r = readHookPayload(JSON.stringify({ session_id: bad, transcript_path: '/x/t.jsonl' }));
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.deepEqual(r.diagnostics, ['payload-invalid'], JSON.stringify(bad));
    }
  });
  it('F240：session_id 缺失 + transcript_path 同时缺失 → payload-invalid（session_id 优先判定）', () => {
    const r = readHookPayload(JSON.stringify({ stop_hook_active: false }));
    assert.equal(r.ok, false);
    assert.deepEqual(r.diagnostics, ['payload-invalid']);
  });
});

describe('F240 T036 · readTranscriptEntries：路径缺席的独立诊断码', () => {
  it('transcriptPath 为 null/undefined/空串 → transcript-path-absent（与 transcript-unavailable 可区分）', () => {
    for (const bad of [null, undefined, '']) {
      const r = readTranscriptEntries(bad);
      assert.deepEqual(r.entries, []);
      assert.deepEqual(r.diagnostics, ['transcript-path-absent'], String(bad));
    }
  });
  it('三诊断码语义互不混淆：absent / unavailable / too-large 各自独立', () => {
    assert.deepEqual(readTranscriptEntries(null).diagnostics, ['transcript-path-absent']);
    assert.deepEqual(readTranscriptEntries(path.join(tmp, 'nope.jsonl')).diagnostics, ['transcript-unavailable']);
    const p = path.join(tmp, 'big.jsonl');
    fs.writeFileSync(p, '{"type":"user"}\n');
    assert.deepEqual(readTranscriptEntries(p, 1).diagnostics, ['transcript-too-large']);
  });
  it('非字符串路径（数字/对象）→ transcript-path-absent 而非抛出', () => {
    assert.deepEqual(readTranscriptEntries(123).diagnostics, ['transcript-path-absent']);
    assert.deepEqual(readTranscriptEntries({}).diagnostics, ['transcript-path-absent']);
  });
});

describe('readTranscriptEntries', () => {
  it('文件缺失 → transcript-unavailable', () => {
    const r = readTranscriptEntries(path.join(tmp, 'missing.jsonl'));
    assert.deepEqual(r.entries, []);
    assert.ok(r.diagnostics.includes('transcript-unavailable'));
  });

  it('体积超限 → transcript-too-large（注入极小上限触发）', () => {
    const p = path.join(tmp, 't.jsonl');
    fs.writeFileSync(p, '{"type":"user","message":{"role":"user","content":"hi"}}\n');
    const r = readTranscriptEntries(p, 5);
    assert.ok(r.diagnostics.includes('transcript-too-large'));
    assert.deepEqual(r.entries, []);
  });

  it('content 字符串/数组双形态均解析', () => {
    const p = path.join(tmp, 't.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'string form' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'arr form' }] } }),
    ].join('\n') + '\n');
    const r = readTranscriptEntries(p);
    assert.equal(r.entries.length, 2);
    assert.deepEqual(r.entries[0].textBlocks, ['string form']);
    assert.deepEqual(r.entries[1].textBlocks, ['arr form']);
  });

  it('损坏行逐行容错（parseError 条目不中断整体）', () => {
    const p = path.join(tmp, 't.jsonl');
    fs.writeFileSync(p, [
      '{ broken json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' } }),
    ].join('\n') + '\n');
    const r = readTranscriptEntries(p);
    assert.equal(r.entries.length, 2);
    assert.equal(r.entries[0].parseError, true);
    assert.equal(r.entries[1].parseError, false);
  });

  it('MAX_TRANSCRIPT_BYTES 常量为 20MB', () => {
    assert.equal(MAX_TRANSCRIPT_BYTES, 20 * 1024 * 1024);
  });
});

describe('findAndParseConfig：FR-015 三步判定顺序', () => {
  it('无配置文件 → block，非降级', () => {
    const r = findAndParseConfig(tmp);
    assert.equal(r.enforcement, 'block');
    assert.equal(r.configDegraded, false);
    assert.equal(r.found, false);
  });

  it('projectRoot/spec-driver.config.yaml 的 off → 立即采用', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    const r = findAndParseConfig(tmp);
    assert.equal(r.enforcement, 'off');
    assert.equal(r.configDegraded, false);
  });

  it('.specify/spec-driver.config.yaml 回退查找', () => {
    fs.mkdirSync(path.join(tmp, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    const r = findAndParseConfig(tmp);
    assert.equal(r.enforcement, 'warn');
  });

  it('非法取值 → block + config-degraded', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: strict\n');
    const r = findAndParseConfig(tmp);
    assert.equal(r.enforcement, 'block');
    assert.equal(r.configDegraded, true);
    assert.ok(r.diagnostics.includes('config-degraded'));
  });

  it('读取抛异常（配置路径是目录）→ block + config-degraded', () => {
    fs.mkdirSync(path.join(tmp, 'spec-driver.config.yaml'));
    const r = findAndParseConfig(tmp);
    assert.equal(r.enforcement, 'block');
    assert.equal(r.configDegraded, true);
    assert.ok(r.diagnostics.includes('config-degraded'));
  });

  it('存在配置但无 fix_compliance 字段 → block，非降级', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'preset: balanced\n');
    const r = findAndParseConfig(tmp);
    assert.equal(r.enforcement, 'block');
    assert.equal(r.configDegraded, false);
    assert.equal(r.found, true);
  });
});

describe('appendAuditEvent', () => {
  it('写入 .specify/runs/YYYY-MM.jsonl 并可读回', () => {
    const event = { schemaVersion: 1, eventType: 'fix-compliance-verdict', sessionId: 'abc', compliant: false };
    const r = appendAuditEvent(tmp, event);
    assert.equal(r.ok, true);
    const runsDir = path.join(tmp, '.specify', 'runs');
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const content = fs.readFileSync(path.join(runsDir, files[0]), 'utf8').trim();
    const parsed = JSON.parse(content);
    assert.equal(parsed.eventType, 'fix-compliance-verdict');
    assert.equal(parsed.sessionId, 'abc');
  });

  it('写入失败（runs 路径被文件占位）→ ok:false，不抛出', () => {
    // 用一个文件占据 .specify 位置，使 mkdir 失败
    fs.writeFileSync(path.join(tmp, '.specify'), 'blocker');
    const r = appendAuditEvent(tmp, { eventType: 'fix-compliance-verdict' });
    assert.equal(r.ok, false);
  });
});

describe('checkFeatureDirOnDisk / readArtifactFile', () => {
  it('存在目录 → existsOnDisk true', () => {
    fs.mkdirSync(path.join(tmp, 'specs', '301-fix-sample-bug'), { recursive: true });
    const r = checkFeatureDirOnDisk(tmp, 'specs/301-fix-sample-bug');
    assert.equal(r.existsOnDisk, true);
  });
  it('缺失目录 → existsOnDisk false', () => {
    const r = checkFeatureDirOnDisk(tmp, 'specs/999-fix-nope');
    assert.equal(r.existsOnDisk, false);
  });
  it('null 候选 → existsOnDisk false', () => {
    assert.equal(checkFeatureDirOnDisk(tmp, null).existsOnDisk, false);
  });
  it('readArtifactFile 读非空文件', () => {
    fs.mkdirSync(path.join(tmp, 'specs', '301-fix-sample-bug'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', '301-fix-sample-bug', 'fix-report.md'), '# Fix\n**Root Cause**: x\n');
    const r = readArtifactFile(tmp, 'specs/301-fix-sample-bug/fix-report.md');
    assert.equal(r.exists, true);
    assert.equal(r.nonEmpty, true);
    assert.ok(r.content.includes('Root Cause'));
  });
  it('readArtifactFile 缺失文件 → exists false', () => {
    const r = readArtifactFile(tmp, 'specs/301-fix-sample-bug/verification/verification-report.md');
    assert.equal(r.exists, false);
    assert.equal(r.nonEmpty, false);
  });
});

// ────────────────────────────────────────
// BlockCountState 组（T023，FR-006）
// ────────────────────────────────────────

describe('sanitizeSessionId：白名单清洗', () => {
  it('保留 [A-Za-z0-9._-]', () => {
    assert.equal(sanitizeSessionId('abc-123_x.y'), 'abc-123_x.y');
  });
  it('非法字符替换为 _（防路径穿越）', () => {
    assert.equal(sanitizeSessionId('../../etc/passwd'), '.._.._etc_passwd');
    assert.equal(sanitizeSessionId('a/b\\c'), 'a_b_c');
  });
  it('非法字符逐个替换（非空则保留）', () => {
    assert.equal(sanitizeSessionId('///'), '___');
  });
  it('清洗后为空（空串/null）→ unknown-session', () => {
    assert.equal(sanitizeSessionId(''), 'unknown-session');
    assert.equal(sanitizeSessionId(null), 'unknown-session');
  });
});

describe('loadBlockState / saveBlockState：读写 + 降级 + 幂等', () => {
  it('首次读取（无文件）→ blockCount 0、degradedRecorded false', () => {
    const s = loadBlockState(tmp, 'sess-1');
    assert.equal(s.blockCount, 0);
    assert.equal(s.degradedRecorded, false);
  });

  it('保存后读回一致（主路径 .specify/runs/.fix-compliance-state）', () => {
    const w = saveBlockState(tmp, 'sess-2', { blockCount: 1, degradedRecorded: false });
    assert.equal(w.ok, true);
    assert.equal(w.degraded, false);
    assert.ok(w.path.includes(path.join('.specify', 'runs', '.fix-compliance-state')));
    const s = loadBlockState(tmp, 'sess-2');
    assert.equal(s.blockCount, 1);
    assert.equal(s.degradedRecorded, false);
  });

  it('degradedRecorded 幂等标记持久化', () => {
    saveBlockState(tmp, 'sess-3', { blockCount: 2, degradedRecorded: true });
    const s = loadBlockState(tmp, 'sess-3');
    assert.equal(s.blockCount, 2);
    assert.equal(s.degradedRecorded, true);
  });

  it('历史文件缺 degradedRecorded 字段 → 按 false（向后兼容）', () => {
    const stateDir = path.join(tmp, '.specify', 'runs', '.fix-compliance-state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'sess-legacy.json'), JSON.stringify({ sessionId: 'sess-legacy', blockCount: 1 }));
    const s = loadBlockState(tmp, 'sess-legacy');
    assert.equal(s.blockCount, 1);
    assert.equal(s.degradedRecorded, false);
  });

  it('损坏文件 → 按初始态返回（不抛出）', () => {
    const stateDir = path.join(tmp, '.specify', 'runs', '.fix-compliance-state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'sess-broken.json'), '{ not json');
    const s = loadBlockState(tmp, 'sess-broken');
    assert.equal(s.blockCount, 0);
  });

  it('session_id 清洗后作为文件名组件（不穿越目录）', () => {
    const w = saveBlockState(tmp, 'a/b', { blockCount: 1, degradedRecorded: false });
    assert.equal(w.ok, true);
    assert.ok(w.path.endsWith(`a_b.json`));
  });

  it('主路径不可写 → 降级 tmpdir（degraded:true, ok:true）', () => {
    // 用文件占据 .fix-compliance-state 目录位置，使主路径 mkdir 失败
    fs.mkdirSync(path.join(tmp, '.specify', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state'), 'blocker');
    const w = saveBlockState(tmp, 'sess-degrade', { blockCount: 1, degradedRecorded: false });
    assert.equal(w.ok, true);
    assert.equal(w.degraded, true);
    // 降级写入后仍可从 tmp 路径读回
    const s = loadBlockState(tmp, 'sess-degrade');
    assert.equal(s.blockCount, 1);
  });

  it('两级存储均不可用 → ok:false + state-storage-unavailable', () => {
    fs.mkdirSync(path.join(tmp, '.specify', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state'), 'blocker');
    const tmpBlocker = path.join(tmp, 'tmp-blocker');
    fs.writeFileSync(tmpBlocker, 'x');
    const prev = process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP;
    process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP = tmpBlocker;
    try {
      const w = saveBlockState(tmp, 'sess-unavail', { blockCount: 1, degradedRecorded: false });
      assert.equal(w.ok, false);
      assert.ok(w.diagnostics.includes('state-storage-unavailable'));
    } finally {
      if (prev === undefined) delete process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP;
      else process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP = prev;
    }
  });
});

describe('resetBlockState：补救成功清零（两级存储均清）', () => {
  it('删除主路径状态文件，load 回到初始态', () => {
    // 先写入非零计数到主路径
    const w = saveBlockState(tmp, 'sess-reset-1', { blockCount: 2, degradedRecorded: true });
    assert.equal(w.ok, true);
    assert.equal(w.degraded, false);
    const before = loadBlockState(tmp, 'sess-reset-1');
    assert.equal(before.blockCount, 2);
    assert.equal(before.degradedRecorded, true);
    // 重置后应回初始态且主路径文件不复存在
    resetBlockState(tmp, 'sess-reset-1');
    const after = loadBlockState(tmp, 'sess-reset-1');
    assert.equal(after.blockCount, 0);
    assert.equal(after.degradedRecorded, false);
    const stateFile = path.join(tmp, '.specify', 'runs', '.fix-compliance-state', 'sess-reset-1.json');
    assert.equal(fs.existsSync(stateFile), false);
  });

  it('主路径不可写、状态已降级写入 tmpdir 时，重置后 tmpdir 残留同样被清除', () => {
    // 占据主路径子目录位置迫使降级写 tmpdir；env 指向一个可写的隔离 tmpdir
    fs.mkdirSync(path.join(tmp, '.specify', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state'), 'blocker');
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-reset-tmp-'));
    const prev = process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP;
    process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP = tmpBase;
    try {
      const w = saveBlockState(tmp, 'sess-reset-2', { blockCount: 2, degradedRecorded: false });
      assert.equal(w.ok, true);
      assert.equal(w.degraded, true); // 确认走了 tmpdir 降级
      assert.equal(loadBlockState(tmp, 'sess-reset-2').blockCount, 2);
      // 重置必须两级都清 → load 不得回落读到 tmpdir 残留旧计数
      resetBlockState(tmp, 'sess-reset-2');
      const after = loadBlockState(tmp, 'sess-reset-2');
      assert.equal(after.blockCount, 0);
      assert.equal(after.degradedRecorded, false);
    } finally {
      if (prev === undefined) delete process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP;
      else process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP = prev;
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('文件不存在（从未阻断过的 session）→ 不抛出', () => {
    // 两级文件均不存在，尽力而为重置应静默返回 void
    assert.doesNotThrow(() => resetBlockState(tmp, 'sess-never-blocked'));
    assert.equal(resetBlockState(tmp, 'sess-never-blocked'), undefined);
  });
});

describe('codex C-1：全损坏 transcript 走 FR-013 loud 路径', () => {
  it('非空行全部解析失败 → diagnostics=[transcript-unavailable]（不得静默当非 fix 会话）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-io-corrupt-'));
    try {
      const p = path.join(dir, 'all-corrupt.jsonl');
      fs.writeFileSync(p, 'this is not valid json\nnot json either\n', 'utf8');
      const { entries, diagnostics } = readTranscriptEntries(p);
      assert.equal(entries.length, 0);
      assert.deepEqual(diagnostics, ['transcript-unavailable']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('部分损坏维持逐行容错（不触发整体 fail-open）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-io-mixed-'));
    try {
      const p = path.join(dir, 'mixed.jsonl');
      fs.writeFileSync(p, 'broken{\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n', 'utf8');
      const { entries, diagnostics } = readTranscriptEntries(p);
      assert.equal(diagnostics.length, 0);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].parseError, true);
      assert.equal(entries[1].parseError, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────
// F216 T006：readTranscriptEntries 调用链透传 core 归一化新字段（集成回归，不新增 io 实现）
// ────────────────────────────────────────

describe('F216 T006 readTranscriptEntries 透传 ExecutionRecord 字段 + 既有行为回归', () => {
  it('F216 T006 entry 含 toolUseBlocks[].id 与 toolResultBlocks（配对字段完整）', () => {
    const p = path.join(tmp, 'exec.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command: "printf 'SPEC-DRIVER-REPRO: PASS\\n'" } },
      ] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_x', is_error: false, content: 'SPEC-DRIVER-REPRO: PASS' },
      ] } }),
    ].join('\n') + '\n');
    const r = readTranscriptEntries(p);
    assert.equal(r.entries.length, 2);
    assert.equal(r.entries[0].toolUseBlocks[0].id, 'toolu_x');
    assert.equal(r.entries[1].toolResultBlocks.length, 1);
    assert.equal(r.entries[1].toolResultBlocks[0].toolUseId, 'toolu_x');
    assert.equal(r.entries[1].toolResultBlocks[0].isError, false);
    assert.equal(r.entries[1].toolResultBlocks[0].flattenedContent, 'SPEC-DRIVER-REPRO: PASS');
  });

  it('F216 T006 每个 entry 恒带 toolResultBlocks 数组（含 parseError/text-only 行）', () => {
    const p = path.join(tmp, 'mix.jsonl');
    fs.writeFileSync(p, [
      'broken{',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'plain' } }),
    ].join('\n') + '\n');
    const r = readTranscriptEntries(p);
    for (const e of r.entries) {
      assert.ok(Array.isArray(e.toolResultBlocks), 'toolResultBlocks 应恒为数组');
    }
  });

  it('F216 T006 既有行为回归不变：20MB 上限 / 全损坏 transcript-unavailable / 缺失', () => {
    const big = path.join(tmp, 'big.jsonl');
    fs.writeFileSync(big, '{"type":"user","message":{"role":"user","content":"hi"}}\n');
    assert.ok(readTranscriptEntries(big, 5).diagnostics.includes('transcript-too-large'));
    const corrupt = path.join(tmp, 'corrupt.jsonl');
    fs.writeFileSync(corrupt, 'nope\nstill nope\n');
    assert.deepEqual(readTranscriptEntries(corrupt).diagnostics, ['transcript-unavailable']);
    assert.ok(readTranscriptEntries(path.join(tmp, 'nope.jsonl')).diagnostics.includes('transcript-unavailable'));
  });

  it('F216 T006 fake tool_result 反伪造：内容进 toolResultBlocks 但不污染 textBlocks', () => {
    const p = path.join(tmp, 'fake.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix\n请修复' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-story' }] }] } }),
    ].join('\n') + '\n');
    const r = readTranscriptEntries(p);
    const resultEntry = r.entries[1];
    assert.equal(resultEntry.toolResultBlocks.length, 1);
    assert.deepEqual(resultEntry.textBlocks, [], 'tool_result 伪造展开痕迹不得进 textBlocks');
  });
});

// ────────────────────────────────────────
// F256 盲区 1 · listFeatureDirCandidatesByShortName（按 short-name 的一层只读枚举）
// ────────────────────────────────────────

/** 在 tmp 下建若干 specs/ 子目录（只建目录，制品齐备度由调用方另行铺设） */
function stageSpecDirs(...names) {
  for (const name of names) fs.mkdirSync(path.join(tmp, 'specs', name), { recursive: true });
}

describe('F256 T002 · listFeatureDirCandidatesByShortName', () => {
  it('命中单个候选 → 返回其相对路径', () => {
    stageSpecDirs('254-fix-graph-scope-extensions', '253-fix-other-thing');
    assert.deepEqual(
      listFeatureDirCandidatesByShortName(tmp, 'graph-scope-extensions'),
      ['specs/254-fix-graph-scope-extensions'],
    );
  });

  it('命中多个候选 → 按编号升序返回（judge 侧「取编号最大者」依赖此序）', () => {
    // 刻意乱序创建 + 混入宽度不同的编号，确保排序按数值而非字典序
    stageSpecDirs('254-fix-foo', '9-fix-foo', '251-fix-foo', '1000-fix-foo');
    assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, 'foo'), [
      'specs/9-fix-foo',
      'specs/251-fix-foo',
      'specs/254-fix-foo',
      'specs/1000-fix-foo',
    ]);
  });

  it('specs/ 目录不存在 → 返回 []（非抛出）', () => {
    assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, 'foo'), []);
  });

  it('specs/ 被文件占位（readdir ENOTDIR）→ 返回 []（非抛出）', () => {
    fs.writeFileSync(path.join(tmp, 'specs'), 'blocker');
    assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, 'foo'), []);
  });

  it('回归钉子：子串误配边界 —— shortName="x" 不得误配 decoy-x / xx / 前缀非纯数字', () => {
    stageSpecDirs(
      '999-fix-decoy-x',   // 后缀切分后前缀为 "999-fix-decoy" 非纯数字 → 不得命中
      '1-fix-xx',          // 后缀字面量 "-fix-x" 不匹配 "…-fix-xx" 的切分 → 不得命中
      'v1-fix-x',          // 前缀含非数字 → 不得命中
      '-fix-x',            // 前缀为空 → 不得命中
      '7-fix-x',           // 唯一合法命中
    );
    assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, 'x'), ['specs/7-fix-x']);
  });

  it('只认目录项，同名普通文件不得混入结果', () => {
    stageSpecDirs('7-fix-bar');
    fs.writeFileSync(path.join(tmp, 'specs', '8-fix-bar'), 'not a dir');
    assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, 'bar'), ['specs/7-fix-bar']);
  });

  it('非法 shortName（空串/非字符串）→ [] 且不触碰磁盘', () => {
    stageSpecDirs('7-fix-x');
    for (const bad of ['', null, undefined, 123, {}, []]) {
      assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, bad), [], String(bad));
    }
  });

  it('枚举只下探一层：嵌套在子目录里的同名目录不得被找到（非递归、非 glob）', () => {
    fs.mkdirSync(path.join(tmp, 'specs', 'archive', '300-fix-nested'), { recursive: true });
    assert.deepEqual(listFeatureDirCandidatesByShortName(tmp, 'nested'), []);
  });

  it('本函数只枚举不核验：返回项不保证含 fix-report.md（制品判据留给 judge 的 usable()）', () => {
    stageSpecDirs('7-fix-empty');
    const hits = listFeatureDirCandidatesByShortName(tmp, 'empty');
    assert.deepEqual(hits, ['specs/7-fix-empty']);
    assert.equal(fs.existsSync(path.join(tmp, hits[0], 'fix-report.md')), false);
  });
});
