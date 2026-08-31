/**
 * ledger-reader.test.mjs
 * F270 P4 — Stop 侧读账本委派证据（T401-T404）
 *
 * Tests FIRST：先于 ledger-reader.mjs 存在，import 失败即红。
 * 覆盖：坏行跳过计数（FR-010）/ 去重（FR-048）/ hookTs 窗口过滤（FR-013）/
 * 缺席与部分缺席（FR-009/047）/ 只产委派类（D-1 方向 X）。
 *
 * 运行: node --test plugins/spec-driver/tests/ledger-reader.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLedgerDelegations, LEDGER_ABSENT, LEDGER_CORRUPT_ENTRY } from '../scripts/lib/ledger-reader.mjs';
import { ledgerPathFor, appendLedgerEntry } from '../scripts/lib/ledger-writer.mjs';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-reader-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function writeRaw(sessionId, lines) {
  const p = ledgerPathFor(tmp, sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return p;
}
const agentEntry = (id, sub, ts, extra = {}) => ({
  v: 1, tool_use_id: id, tool_name: 'Agent', prompt_id: 'p', session_id: 's',
  hookTs: ts, subagent_type: sub, ok: true, ...extra,
});

describe('F270 P4 · readLedgerDelegations', () => {
  it('账本文件不存在 → LEDGER_ABSENT（供判定器 FR-009 回退 transcript）', () => {
    const r = readLedgerDelegations(tmp, 'nope', { sinceTs: null });
    assert.equal(r.state, LEDGER_ABSENT);
    assert.deepEqual(r.delegations, []);
  });

  it('只产委派类（Agent/Task），Bash/Write 等采集条目被过滤（D-1 方向 X）', () => {
    writeRaw('s1', [
      { v: 1, type: 'ledger-open', session_id: 's1', hookTs: '2026-09-01T10:00:00.000Z' },
      { v: 1, tool_use_id: 'b1', tool_name: 'Bash', hookTs: '2026-09-01T10:01:00.000Z', ok: true },
      agentEntry('a1', 'spec-driver:implement', '2026-09-01T10:02:00.000Z'),
    ]);
    const r = readLedgerDelegations(tmp, 's1', { sinceTs: '2026-09-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 1);
    assert.equal(r.delegations[0].subagentType, 'spec-driver:implement');
    assert.equal(r.delegations[0].source, 'ledger');
  });

  it('坏行跳过并计数（FR-010，不使整本失效）', () => {
    writeRaw('s2', [
      agentEntry('a1', 'spec-driver:implement', '2026-09-01T10:00:00.000Z'),
      'not-json{{{',
      agentEntry('a2', 'spec-driver:verify', '2026-09-01T10:01:00.000Z'),
    ]);
    const r = readLedgerDelegations(tmp, 's2', { sinceTs: '2026-09-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 2);
    assert.equal(r.corruptCount, 1);
  });

  it('🔴 去重：同 tool_use_id 内容一致 → 静默折叠为一条', () => {
    writeRaw('s3', [
      agentEntry('a1', 'spec-driver:implement', '2026-09-01T10:00:00.000Z'),
      agentEntry('a1', 'spec-driver:implement', '2026-09-01T10:00:05.000Z'), // hook 叠装重复
    ]);
    const r = readLedgerDelegations(tmp, 's3', { sinceTs: '2026-09-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 1);
    assert.ok(!(r.diagnostics || []).includes(LEDGER_CORRUPT_ENTRY));
  });

  it('🔴 去重键含 subagent_type 全值：内容不一致 → ledger-entry-conflict', () => {
    writeRaw('s4', [
      agentEntry('a1', 'spec-driver:implement', '2026-09-01T10:00:00.000Z'),
      agentEntry('a1', 'spec-driver:verify', '2026-09-01T10:00:05.000Z'), // 同 id 不同 subagent_type
    ]);
    const r = readLedgerDelegations(tmp, 's4', { sinceTs: '2026-09-01T00:00:00.000Z' });
    assert.ok((r.diagnostics || []).includes(LEDGER_CORRUPT_ENTRY), '同 id 不同内容须落冲突码');
  });

  it('🔴 hookTs 窗口过滤：只保留 sinceTs 之后的委派（FR-013 归属窗口）', () => {
    writeRaw('s5', [
      agentEntry('a0', 'spec-driver:implement', '2026-09-01T09:00:00.000Z'), // 旧轮，早于 latestFix
      agentEntry('a1', 'spec-driver:implement', '2026-09-01T10:05:00.000Z'), // 本轮
    ]);
    const r = readLedgerDelegations(tmp, 's5', { sinceTs: '2026-09-01T10:00:00.000Z' });
    assert.equal(r.delegations.length, 1);
    assert.equal(r.delegations[0].toolUseId, 'a1');
  });

  it('🔴 对抗 WARNING-2：sinceTs=null（latestFix 无 timestamp）→ windowUndetermined + 空补充（不跨周期回流）', () => {
    writeRaw('s6', [
      agentEntry('a0', 'spec-driver:implement', '2026-09-01T09:00:00.000Z'),
      agentEntry('a1', 'spec-driver:verify', '2026-09-01T10:05:00.000Z'),
    ]);
    const r = readLedgerDelegations(tmp, 's6', { sinceTs: null });
    assert.equal(r.windowUndetermined, true);
    assert.deepEqual(r.delegations, [], '窗口画不出来 → 不用账本补充，退回纯 transcript');
    assert.ok((r.diagnostics || []).includes('ledger-window-undetermined'));
  });

  it('🔴 对抗 WARNING-2 同纪律：hookTs 缺省/非串 → 保守剔除（定位不了不采信）', () => {
    writeRaw('s6b', [
      { v: 1, tool_use_id: 'a1', tool_name: 'Agent', subagent_type: 'spec-driver:verify', ok: true }, // 无 hookTs
      agentEntry('a2', 'spec-driver:implement', '2026-09-01T10:05:00.000Z'),
    ]);
    const r = readLedgerDelegations(tmp, 's6b', { sinceTs: '2026-09-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 1, '无 hookTs 的条目被剔除');
    assert.equal(r.delegations[0].toolUseId, 'a2');
  });

  it('roleClass 分类与 transcript 委派同源（复用 classifyDelegationRole）', () => {
    writeRaw('s7', [agentEntry('a1', 'spec-driver:verify', '2026-09-01T10:00:00.000Z')]);
    const r = readLedgerDelegations(tmp, 's7', { sinceTs: '2026-09-01T00:00:00.000Z' });
    assert.equal(r.delegations[0].roleClass, 'verify');
  });

  it('与 writer 端到端：appendLedgerEntry 写的委派能被 reader 读回', () => {
    appendLedgerEntry(tmp, {
      session_id: 'e2e', tool_use_id: 'toolu_x', tool_name: 'Agent',
      tool_input: { subagent_type: 'spec-driver:implement', description: '执行代码修复' },
      tool_response: { isAsync: true },
    });
    const r = readLedgerDelegations(tmp, 'e2e', { sinceTs: '2020-01-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 1);
    assert.equal(r.delegations[0].subagentType, 'spec-driver:implement');
  });
});

describe('F270 P4 · 时间戳格式承重假设（对抗 B 登记）', () => {
  it('writer hookTs 为 ISO8601 UTC-Z（与 transcript timestamp 同构，词法可比）', () => {
    const entry = { session_id: 's', tool_use_id: 'x', tool_name: 'Agent',
      tool_input: { subagent_type: 'spec-driver:verify' }, tool_response: {} };
    appendLedgerEntry(tmp, entry);
    const raw = fs.readFileSync(ledgerPathFor(tmp, 's'), 'utf8').split('\n').filter(Boolean);
    const dataLine = raw.map((l) => JSON.parse(l)).find((e) => e.tool_name === 'Agent');
    // 承重:窗口比较依赖 hookTs 与 transcript timestamp 同为 `…Z` 词法序
    assert.match(dataLine.hookTs, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      'hookTs 若改偏移量形/异精度,窗口词法比较即错乱且无守卫');
    // 词法可比性:同格式下字符串序 == 时间序
    assert.ok('2026-09-01T10:00:00.000Z' < '2026-09-01T10:05:00.000Z');
  });
});
