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
  sanitizeSessionId,
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
