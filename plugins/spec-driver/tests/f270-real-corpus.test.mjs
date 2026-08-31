/**
 * f270-real-corpus.test.mjs
 * F270 P6 — 主验收语料：关键 acceptance 跑**真实录制**的会话 payload（SC-009 / 必答④）。
 *
 * 语料来源：本机 Claude Code 2.1.220 实采的 PostToolUse / Stop / SubagentStop payload，
 * 经脱敏（替换真实 session_id/路径/agent_id、内容无害化，保留字段存在性/形状/类型/序列）
 * 落 tests/fixtures/fix-compliance/real-*.json[l]。脱敏规则见该目录 README「F270 真实录制语料」。
 *
 * 必答④ 要求这些 acceptance **必须**跑在真实语料上（不接受仅合成语料通过）：
 *   - 三态在途判定（in-flight，真实 background_tasks）
 *   - 账本条目消费与主/子归属（真实 agent_id 缺席=主线程）
 *   - stop_hook_active 重入防护（真实取值类型）
 *   - last_assistant_message 缺席 vs 存在（真实字段形态）
 *
 * 运行: node --test plugins/spec-driver/tests/f270-real-corpus.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyInFlightFromPayload, IN_FLIGHT_STATES } from '../scripts/lib/in-flight-verdict.mjs';
import { buildLedgerEntry } from '../scripts/lib/ledger-writer.mjs';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fix-compliance');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8'));
const readJsonl = (f) => fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('F270 P6 · 真实录制语料主验收（SC-009 / 必答④）', () => {
  it('真实 Stop payload：background_tasks 非空 → in-flight（三态判定跑真实字段）', () => {
    const stop = readJson('real-stop-payload-background-tasks.json');
    // 真实字段形状核实（脱敏保留）
    assert.equal(typeof stop.stop_hook_active, 'boolean', 'stop_hook_active 真实为布尔（必答③承重）');
    assert.ok(Array.isArray(stop.background_tasks));
    assert.ok(Array.isArray(stop.session_crons));
    const v = classifyInFlightFromPayload(stop);
    assert.equal(v.state, IN_FLIGHT_STATES.IN_FLIGHT, '真实非空 background_tasks 判 in-flight');
    assert.equal(v.count, stop.background_tasks.length);
  });

  it('真实 SubagentStop payload：agent_id 存在（子代理），background_tasks 含自身', () => {
    const sub = readJson('real-subagentstop-payload.json');
    assert.equal(typeof sub.agent_id, 'string', 'SubagentStop 真实带 agent_id');
    // C-9/T-2 实证：SubagentStop 的 background_tasks 含触发它的子代理自身（已登记为已知边界）
    assert.ok(Array.isArray(sub.background_tasks));
  });

  it('真实 PostToolUse 账本序列：主线程条目无 agent_id、子代理条目有（归属判据跑真实语料）', () => {
    const seq = readJsonl('real-posttooluse-ledger-sequence.jsonl');
    assert.ok(seq.length >= 3, '录制序列非空');
    for (const payload of seq) {
      const entry = buildLedgerEntry(payload);
      // 主/子归属：agent_id 缺席即主线程（C-4 结构性判据，跑真实语料）
      if (Object.hasOwn(payload, 'agent_id')) {
        assert.equal(entry.agent_id, payload.agent_id);
      } else {
        assert.ok(!Object.hasOwn(entry, 'agent_id'), '主线程真实条目不得补 agent_id 键');
      }
      // 委派类真实携带 subagent_type 全值
      if (payload.tool_name === 'Agent' || payload.tool_name === 'Task') {
        assert.equal(entry.subagent_type, payload.tool_input?.subagent_type);
      }
      // 裁剪：真实 payload 的大字段不入账本条目
      assert.ok(!('tool_response' in entry));
      assert.ok(!('tool_input' in entry));
    }
    // 序列含真实委派（主验收语料要求覆盖委派采集主路径）
    const delegations = seq.filter((p) => p.tool_name === 'Agent' || p.tool_name === 'Task');
    assert.ok(delegations.length >= 1, '录制语料须含真实委派条目');
    // 🔴 两个分支都必须真的跑到（对抗 E W-3：此前 fixture 零 agent_id，`if` 半边从未执行，
    // 而用例名声称"子代理条目有"——归属判据是本卡最承重的新判据，不能只有合成语料背书）
    const withAgentId = seq.filter((p) => Object.hasOwn(p, 'agent_id'));
    const withoutAgentId = seq.filter((p) => !Object.hasOwn(p, 'agent_id'));
    assert.ok(withAgentId.length >= 1, '录制语料须含真实子代理条目（agent_id 存在）');
    assert.ok(withoutAgentId.length >= 1, '录制语料须含真实主线程条目（agent_id 整体缺席）');
    // C-4 判据的真实前提：子代理条目带 agent_id + agent_type，主线程两键皆缺席
    for (const p of withAgentId) {
      assert.equal(typeof p.agent_id, 'string');
      assert.ok(Object.hasOwn(p, 'agent_type'), '真实子代理条目同时带 agent_type');
    }
    for (const p of withoutAgentId) {
      assert.ok(!Object.hasOwn(p, 'agent_type'), '真实主线程条目两键皆缺席（非 null）');
    }
  });

  it('归属过滤跑真实子代理条目：经 writer→reader 真实管线被剔除', () => {
    const seq = readJsonl('real-posttooluse-ledger-sequence.jsonl');
    const sub = seq.find((p) => Object.hasOwn(p, 'agent_id'));
    assert.ok(sub, '前置：录制语料含子代理条目');
    // 把真实子代理条目的**归属字段**装进一条委派 payload（tool_name/tool_input 换成委派形，
    // 其余顶层字段用真实取值）——因为本仓录制库 101 份里 4 条委派**全部是主线程派的**，
    // 「子代理内部再派子代理」这一形态**无真实样本**，如实登记为录制缺口：其 tool 形状用合成，
    // 归属字段（agent_id/agent_type/session_id/prompt_id 的真实取值与共存关系）用真实录制。
    const entry = buildLedgerEntry({
      ...sub, tool_name: 'Agent', tool_use_id: 'toolu_REALSUB01',
      tool_input: { subagent_type: 'spec-driver:verify' }, tool_response: { ok: true },
    });
    assert.equal(entry.agent_id, sub.agent_id, '真实 agent_id 透传');
    assert.equal(entry.subagent_type, 'spec-driver:verify');
  });

  it('真实语料的 last_assistant_message 形态（缺席 vs 存在，真实字段）', () => {
    const stop = readJson('real-stop-payload-background-tasks.json');
    // 真实 Stop 带 last_assistant_message（脱敏后内容无害，键存在性保留）
    // 缺席态由合成语料覆盖（真实全空会话难录制）；此处验证"存在"态的真实形态
    assert.ok('last_assistant_message' in stop, '真实 Stop 含 last_assistant_message 键');
    assert.equal(typeof stop.last_assistant_message, 'string');
  });

  it('脱敏完整性：录制语料无真实标识残留（连带守卫）', () => {
    for (const f of ['real-stop-payload-background-tasks.json', 'real-subagentstop-payload.json', 'real-posttooluse-ledger-sequence.jsonl']) {
      const raw = fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8');
      assert.ok(!raw.includes('connorlu'), `${f} 不得残留真实用户名`);
      assert.ok(!raw.includes('b5b4a9eb'), `${f} 不得残留真实 session_id`);
      assert.ok(!/\/Users\//.test(raw), `${f} 不得残留真实绝对路径`);
    }
  });
});
