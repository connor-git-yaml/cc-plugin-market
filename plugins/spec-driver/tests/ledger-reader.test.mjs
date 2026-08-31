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
import { fileURLToPath } from 'node:url';
import { readLedgerDelegations, LEDGER_ABSENT, LEDGER_CORRUPT_ENTRY, LEDGER_AGENT_ID_INVERSION, LEDGER_DIAGNOSTICS } from '../scripts/lib/ledger-reader.mjs';
import { ledgerPathFor, appendLedgerEntry } from '../scripts/lib/ledger-writer.mjs';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-reader-'));
  // 采集器有 US5 闸门（`.specify/` 不存在即零落盘）；本文件用 appendLedgerEntry 造数的用例
  // 需要该目录。非 spec-driver 项目的零落盘语义由 ledger-writer.test 的专组覆盖。
  fs.mkdirSync(path.join(tmp, '.specify'), { recursive: true });
  // 闸门判据是「`.specify/` 里除 `.spec-driver-path` 外还有别的条目」——只建空目录不够，
  // 因为 postinstall.sh 在每个项目都会建它（对抗 D CRITICAL-1）。此处放一个流程产物代表
  // 「本项目真的跑过 spec-driver」。
  fs.writeFileSync(path.join(tmp, '.specify', 'project-context.yaml'), 'x: 1\n');
});
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

// ════════════════════════════════════════
// F270 集成 review · FR-021 agent_id 归属过滤
// Tests FIRST：reader 当前全文无 agent_id，本组先红。
//
// 病灶（集成 review CRITICAL-1，实跑复现）：PostToolUse 对子代理内部工具同样触发，且
// session_id 与主线程同值（P-2）→ 子代理的派发写进**同一本账本**。reader 若不按归属过滤，
// 「主线程只派了 general-purpose、由它在内部再派 implement/verify」会被判成主线程走了
// 两阶段收口 —— F208「禁止编排器行内修改」的语义在这一支上失效，且**不需要伪造任何字节**。
// ════════════════════════════════════════

describe('F270 review · FR-021 agent_id 归属过滤', () => {
  const BASE = '2026-09-01T00:00:00.000Z';
  const TS = (m) => `2026-09-01T10:0${m}:00.000Z`;

  it('🔴 带 agent_id 的委派条目被剔除（子代理内部派发不计入主会话）', () => {
    writeRaw('r1', [
      agentEntry('sub1', 'spec-driver:implement', TS(1), { agent_id: 'agent_x', agent_type: 'general-purpose' }),
      agentEntry('sub2', 'spec-driver:verify', TS(2), { agent_id: 'agent_x' }),
      agentEntry('main1', 'spec-driver:implement', TS(3)),   // 主线程：agent_id 键整体缺席
    ]);
    const r = readLedgerDelegations(tmp, 'r1', { sinceTs: BASE });
    assert.equal(r.delegations.length, 1, `只应留主线程那条，实得 ${JSON.stringify(r.delegations.map((d) => d.toolUseId))}`);
    assert.equal(r.delegations[0].toolUseId, 'main1');
  });

  it('agent_id 键缺席＝主线程（结构性判据，非启发式；C-4）', () => {
    writeRaw('r2', [agentEntry('m1', 'spec-driver:verify', TS(1))]);
    const r = readLedgerDelegations(tmp, 'r2', { sinceTs: BASE });
    assert.equal(r.delegations.length, 1);
    assert.equal(r.delegations[0].roleClass, 'verify');
  });

  it('🔴 agent_id **键存在即剔除**，不看值形状（对抗 D W-1：值判定让病灶静默复活）', () => {
    // 初版判据是 `typeof === 'string' && length > 0`，于是 `agent_id:""` / `agent_id:null`
    // 漏过过滤 → CRITICAL-1 原病灶复活；而翻转诊断挂「命中数==总数」，一条都没命中时结构性
    // 不响，等于新增一个会静默退回病灶态的判据。探针实测姊妹字段 `agent_type` 正是
    // `a ?? ""`（空串而非缺席）语义，空串形不是臆想。
    // 安全上界：账本是纯补充源、委派判定单调（count>=1），剔多了的最坏后果＝等于没有账本
    // ＝F270 之前的基线，不会产生高于基线的误阻断。宁可多剔，不可漏剔。
    for (const [i, shape] of [null, 0, '', false, {}, 'a1'].entries()) {
      writeRaw(`r3-${i}`, [agentEntry('m1', 'spec-driver:verify', TS(1), { agent_id: shape })]);
      const r = readLedgerDelegations(tmp, `r3-${i}`, { sinceTs: BASE });
      assert.equal(r.delegations.length, 0,
        `agent_id=${JSON.stringify(shape)} 键存在即应剔除（值形状不参与判定）`);
    }
  });

  it('agent_id 键**整体缺席**才是主线程（与 C-4 结构性判据逐字一致）', () => {
    writeRaw('r3b', [agentEntry('m1', 'spec-driver:verify', TS(1))]);
    assert.equal(readLedgerDelegations(tmp, 'r3b', { sinceTs: BASE }).delegations.length, 1);
  });

  it('🔴 全部委派条目都带 agent_id → 落上游翻转诊断，但过滤行为不变（FR-021 后半：落诊断而非静默改判）', () => {
    writeRaw('r4', [
      agentEntry('s1', 'spec-driver:implement', TS(1), { agent_id: 'a' }),
      agentEntry('s2', 'spec-driver:verify', TS(2), { agent_id: 'a' }),
    ]);
    const r = readLedgerDelegations(tmp, 'r4', { sinceTs: BASE });
    assert.ok(r.diagnostics.includes('ledger-agent-id-inversion-suspected'),
      `应落翻转嫌疑诊断，实得 ${JSON.stringify(r.diagnostics)}`);
    assert.deepEqual(r.delegations, [], '落诊断≠改判：仍按 agent_id 存在即子代理剔除');
  });

  it('存在至少一条主线程条目时不落翻转诊断（正常会话不得噪声）', () => {
    writeRaw('r5', [
      agentEntry('s1', 'spec-driver:implement', TS(1), { agent_id: 'a' }),
      agentEntry('m1', 'spec-driver:verify', TS(2)),
    ]);
    const r = readLedgerDelegations(tmp, 'r5', { sinceTs: BASE });
    assert.ok(!r.diagnostics.includes('ledger-agent-id-inversion-suspected'), JSON.stringify(r.diagnostics));
  });
});

// ════════════════════════════════════════
// 合同同步守卫：账本诊断码 ⊆ verdict-event schema 的 diagnostics enum
// 这些码经 judge 的 ledgerDiagnostics 直通审计事件，schema 是 additionalProperties:false
// 的闭集——漏登记即合同漂移。集成 review 自查实证：新增 LEDGER_AGENT_ID_INVERSION 时确实
// 漏了这一步（与 FOREIGN_DIALECT_DIAGNOSTICS 的同步用例同源纪律，core:517）。
// ════════════════════════════════════════

describe('F270 review · 账本诊断码与 verdict-event schema 合同同步', () => {
  it('reader 导出的全部诊断码都在 schema 的 diagnostics enum 内', () => {
    const schemaPath = fileURLToPath(new URL(
      '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json',
      import.meta.url));
    const enumCodes = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
      .properties.diagnostics.items.enum;
    // 🔴 从 canonical 表**派生**而非硬编码白名单（对抗 E W-2：硬编码只能抓"删已知项"，
    // 抓不到"加新项漏登记"——而后者正是本守卫声称要防的方向）。与
    // `FOREIGN_DIALECT_DIAGNOSTICS` 的同步用例同源纪律：新增码只要进 LEDGER_DIAGNOSTICS，
    // 忘了同步 schema 就会在这里变红。
    const codes = Object.values(LEDGER_DIAGNOSTICS);
    assert.ok(codes.length >= 4, 'canonical 表非空（防表被清空导致守卫空转）');
    for (const code of codes) {
      assert.ok(enumCodes.includes(code), `诊断码 ${code} 未登记进 schema enum（合同漂移）`);
    }
    // 两个承重码必须在表内（防有人从表里摘掉再绕过守卫）
    assert.ok(codes.includes(LEDGER_CORRUPT_ENTRY) && codes.includes(LEDGER_AGENT_ID_INVERSION));
  });
});

// ════════════════════════════════════════
// 对抗 E CRITICAL-1 / CRITICAL-3 收口守卫
// ════════════════════════════════════════

describe('F270 review · writer↔reader 谓词对称（对抗 E C-1）', () => {
  it('🔴 真实管线端到端：六种 agent_id 形态经 writer 落盘后都必须被 reader 剔除', () => {
    // 病灶：reader 改成 `Object.hasOwn` 加固，而 writer 仍是 `typeof === 'string'` 值判定 →
    // `null`/`0`/`false`/`{}` 的键在落盘时被**抹掉**，reader 再严也见不到 → 判为主线程。
    // 谓词不对称时，**严的那侧被松的那侧决定**。此前测试全走 writeRaw 直写 JSONL 绕开 writer，
    // 唯一的 writer→reader 端到端用例又不带 agent_id，整条链上没有把两个谓词接起来的断言。
    for (const [i, shape] of ['a1', '', null, 0, false, {}].entries()) {
      const sid = `sym-${i}`;
      appendLedgerEntry(tmp, {
        session_id: sid, transcript_path: '/tmp/x.jsonl', tool_name: 'Agent',
        tool_use_id: `toolu_SYM${i}`, tool_input: { subagent_type: 'spec-driver:verify' },
        tool_response: { ok: true }, agent_id: shape,
      });
      const r = readLedgerDelegations(tmp, sid, { sinceTs: '2020-01-01T00:00:00.000Z' });
      assert.equal(r.delegations.length, 0,
        `agent_id=${JSON.stringify(shape)} 经真实 writer 落盘后仍应被 reader 剔除`);
    }
  });

  it('主线程 payload（agent_id 键整体缺席）经真实管线仍被采信', () => {
    appendLedgerEntry(tmp, {
      session_id: 'sym-main', transcript_path: '/tmp/x.jsonl', tool_name: 'Agent',
      tool_use_id: 'toolu_MAIN', tool_input: { subagent_type: 'spec-driver:verify' },
      tool_response: { ok: true },
    });
    const r = readLedgerDelegations(tmp, 'sym-main', { sinceTs: '2020-01-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 1);
  });
});

describe('F270 review · 账本委派对 no-op 弃权（对抗 E C-3）', () => {
  it('🔴 账本委派必须显式 noopVerify:false，不能靠"不产"表达弃权', () => {
    // 消费侧判据 `d.noopVerify === undefined && cls === 'verify'` 把 undefined 当作**回退
    // 触发条件**——"刻意不产"反而让每条账本 verify 都计进 noopVerifyCount，一行 JSONL 即可
    // 关掉 F216 的 delegation:noop-verify 要求。弃权的正确编码是 false。
    writeRaw('noop1', [agentEntry('a1', 'spec-driver:verify', '2026-09-01T10:05:00.000Z')]);
    const r = readLedgerDelegations(tmp, 'noop1', { sinceTs: '2020-01-01T00:00:00.000Z' });
    assert.equal(r.delegations.length, 1);
    assert.equal(r.delegations[0].noopVerify, false,
      `账本委派须显式 false（实得 ${JSON.stringify(r.delegations[0].noopVerify)}）——` +
      'undefined 会命中 core 的 verify 回退分支');
  });
});
