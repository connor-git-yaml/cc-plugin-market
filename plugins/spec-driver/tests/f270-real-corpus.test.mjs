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
import {
  normalizeTranscriptEntry,
  countStorageUnavailableBlockFeedback,
  HOOK_FEEDBACK_PREFIX,
  STORAGE_UNAVAILABLE_FEEDBACK_TOKEN,
} from '../scripts/lib/fix-compliance-core.mjs';

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

// ════════════════════════════════════════
// F276 卡 C · 入库脱敏 fixture 上的形态守卫（P-2 / P-3，CI 恒执行）
//
// why 走入库 fixture 而不是扫本机 `~/.claude/projects`：本机语料在 CI 上恒缺席 ⟹ 用例永远 skip、
// 零常绿守护力；全量读约 650MB；且谓词选中集为空时用例会**静默变绿**——恰好在"harness 换了形态"
// 这一它本要侦测的场景下最先失效。
//
// ⚠️ 守护面口径（不得 over-claim）：本组是**冻结快照**上的回归守卫，只守「我方谓词对该快照的行为」，
// **不侦测 harness 形态漂移**——harness 换了回灌形态它照样绿。漂移无自动可发现性，已接受为残余。
// ════════════════════════════════════════

describe('F276 卡 C · 真实回灌条目形态守卫（P-2 / P-3）', () => {
  const FEEDBACK_FIXTURE = 'real-stop-hook-feedback-entries.jsonl';
  const loadEntries = () => readJsonl(FEEDBACK_FIXTURE)
    .map((raw, i) => normalizeTranscriptEntry(raw, i, false));

  it('P-2 四条真实条目：命中 1 / 排除 3（显式基线 -1）', () => {
    const entries = loadEntries();
    assert.equal(entries.length, 4, 'fixture 必须是 4 条（① 命中 ② tool_result 型 user ③ assistant ④ skill 展开）');
    // 🔴 写死显式基线 -1：这是纯函数合同的**另一半**——数字基线 ⟹ 计其后全部条目
    //（fixture 里所有 lineIndex 均 > -1，故窗口不参与本探针，只留形态面）。
    // 不得传 null 图省事：那会让整条用例恒为 0 而假绿（null ⟹ 返回 0 的那一半由 core.test U-7 钉）。
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 1);
  });

  it('P-2 四条的角色分工与排除理由各自成立（防 fixture 被改成自证）', () => {
    const [hit, toolResultUser, assistantEntry, skillExpansion] = loadEntries();

    // ① 命中项：四条件全真
    assert.equal(hit.role, 'user');
    assert.equal(hit.textBlocks.length, 1);
    assert.ok(hit.textBlocks[0].startsWith(HOOK_FEEDBACK_PREFIX));
    assert.ok(hit.textBlocks[0].includes(STORAGE_UNAVAILABLE_FEEDBACK_TOKEN));

    // ② tool_result 型 user：被 textBlocks.length===1 排除（tool_result 不进 textBlocks）
    assert.equal(toolResultUser.role, 'user');
    assert.equal(toolResultUser.textBlocks.length, 0);
    assert.equal(toolResultUser.toolResultBlocks.length, 1);
    assert.ok(toolResultUser.toolResultBlocks[0].flattenedContent.includes(STORAGE_UNAVAILABLE_FEEDBACK_TOKEN),
      '②「正文含同串」是它的存在理由，被脱敏抹掉即退化成无关条目');

    // ③ assistant：被 role 排除。
    // 🔴 必须对 **raw** 断言它确实携带 token（IM-2）：token 藏在 `tool_use.input` 里、不进 textBlocks，
    // 所以规范化后的对象上看不出"它本来就是个带 token 的诱饵"。重录时把这段正文当噪声抹掉，
    // 它就退化成一条与守护无关的普通 assistant 条目，而 P-2 的命中数仍是 1 ⟹ **静默假绿**。
    assert.equal(assistantEntry.role, 'assistant');
    const rawAssistant = JSON.stringify(readJsonl(FEEDBACK_FIXTURE)[2]);
    assert.ok(rawAssistant.includes(STORAGE_UNAVAILABLE_FEEDBACK_TOKEN),
      '③ raw 必须携带 token —— 它被排除的理由是 role，不是"压根不含 token"');
    assert.ok(rawAssistant.includes(HOOK_FEEDBACK_PREFIX),
      '③ raw 还须含 `Stop hook feedback:` 串，否则退化成 role 之外条件也能排除的弱诱饵');

    // ④ 🔴 `startsWith` 条件在本探针下的**唯一**守护点：①②③ 都被前置条件先行排除，
    // 只有 ④ 真正走到 startsWith 判定。删掉该条件 ⟹ 命中数由 1 变 2 ⟹ P-2 变红。
    assert.equal(skillExpansion.role, 'user');
    assert.equal(skillExpansion.textBlocks.length, 1, '④ 必须是单文本块，否则被前置条件排除、守护力归零');
    assert.ok(skillExpansion.textBlocks[0].startsWith('Base directory for this skill:'),
      '④ 首块必须以技能展开前缀起头（token 因此永远不在 offset 0）');
    assert.ok(skillExpansion.textBlocks[0].includes(STORAGE_UNAVAILABLE_FEEDBACK_TOKEN),
      '④ 正文必须含 token（人工注入的对抗构造，重录时不得当噪声删掉）');
    assert.ok(skillExpansion.textBlocks[0].includes(HOOK_FEEDBACK_PREFIX),
      '④ 正文必须含 `Stop hook feedback:` 串——否则 startsWith→includes 的退化变体抓不到');
    // 🔴 ④ 的骨架必须是**非 spec-driver 的** skill：含 spec-driver-fix 会推走 latestFixLineIndex
    //（窗口自塌 ⟹ 假绿），含其它 mode 会改 anchor.mode（⟹ 假红）。
    assert.equal(/\/skills\/spec-driver-/.test(skillExpansion.textBlocks[0]), false,
      '④ 骨架不得取 spec-driver-* 的 skill 展开');
  });

  it('P-3 脱敏完整性：无真实标识残留（与 P-2 保留清单相容）', () => {
    const raw = fs.readFileSync(path.join(FIXTURE_DIR, FEEDBACK_FIXTURE), 'utf8');
    assert.ok(!raw.includes('connorlu'), '不得残留真实用户名');
    assert.ok(!raw.includes('b5b4a9eb'), '不得残留真实 session_id');
    assert.ok(!/\/Users\//.test(raw), '不得残留真实绝对路径');
    // 相容性：`[<cmd>]: ` 段结构保留（只替换其中的路径值），故 P-2 与 P-3 不互斥
    assert.ok(/\[bash [^\]]+\]: /.test(raw), '`[<cmd>]: ` 段结构必须保留（脱敏只替换路径值）');
  });
});
