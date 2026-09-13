/**
 * F289 · fix-compliance 续做 / 旁链入口收口（Tier 2 续做合同）。
 *
 * 红先行：新导出（`detectFixSkillExpansion().latestResumeLineIndex` / `writeSidechainMarker` / `listSidechainMarkers` /
 * `recordSidechainFixMarker` / `judgeCompliance({ tier2 })`）缺席即红；三源端到端在改动前的判定器上全部是「零接触 exit 0 零落盘」。
 * 夹具驱动 judge CLI（门禁类纪律）；每个 exit 2 后按 harness 形态回灌一条反馈条目（F288 放行佐证）。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JUDGE_DIAGNOSTICS } from '../scripts/fix-compliance-judge.mjs';
import { detectFixSkillExpansion, judgeCompliance, normalizeTranscriptEntry, HOOK_FEEDBACK_PREFIX } from '../scripts/lib/fix-compliance-core.mjs';
import { writeSidechainMarker, listSidechainMarkers, resetBlockState } from '../scripts/lib/fix-compliance-io.mjs';
import { recordSidechainFixMarker, isSubagentStopShape } from '../scripts/lib/fix-compliance-sidechain-marker.mjs';
import { OWNED_HOOK_EXPECTED_EVENT, CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES } from '../scripts/lib/codex-hooks-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..');
const CLI = path.resolve(PLUGIN, 'scripts/fix-compliance-judge.mjs');
const MARKER_CLI = path.resolve(PLUGIN, 'scripts/lib/fix-compliance-sidechain-marker.mjs');
const HOOK_SH = path.resolve(PLUGIN, 'hooks/subagent-stop-fix-marker.sh');
const SCHEMA = JSON.parse(fs.readFileSync(path.resolve(PLUGIN, '../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json'), 'utf8'));
const SCHEMA_ENUM = new Set(SCHEMA.properties.diagnostics.items.enum);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f289-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const EXPANSION = (mode) => ({ type: 'user', isMeta: true, message: { role: 'user', content: `<command-name>/spec-driver:spec-driver-${mode}</command-name>\nBase directory for this skill: /x/plugins/spec-driver/skills/spec-driver-${mode}` } });
// 被判方写的 user 文本（sidechain 首条 = 父编排器 prompt 引用），isMeta=false：B-C1 判据下不算子代理真展开
const EXPANSION_QUOTED = (mode) => ({ type: 'user', message: { role: 'user', content: `请参照 <command-name>/spec-driver:spec-driver-${mode}</command-name> Base directory for this skill: /x/plugins/spec-driver/skills/spec-driver-${mode} 修一下` } });
const ASSISTANT_TEXT = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
let toolSeq = 0;
/** 带 id 的 tool_use + 紧随的成功 tool_result（F257 写入见证要求回执） */
const TOOL_USE_WITH_RECEIPT = (name, input) => {
  const id = `toolu_${++toolSeq}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'ok' }] } },
  ];
};
const AGENT = (subagentType, description) => TOOL_USE_WITH_RECEIPT('Agent', { subagent_type: subagentType, description });
const FIX_DIR = 'specs/301-fix-sample-bug';
const REPAIR_FIX_REPORT = '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n';
const FEEDBACK = (stderr) => ({ type: 'user', isMeta: true, userType: 'external', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[node fix-compliance-judge.mjs --mode hook]: ${stderr}` } });

let seq = 0;
function stageRoot({ withReport = false } = {}) {
  const root = path.join(tmp, `root-${++seq}`);
  fs.mkdirSync(path.join(root, FIX_DIR, 'verification'), { recursive: true });
  fs.writeFileSync(path.join(root, FIX_DIR, 'fix-report.md'), REPAIR_FIX_REPORT);
  if (withReport) fs.writeFileSync(path.join(root, FIX_DIR, 'verification', 'verification-report.md'), '# 验证报告\n全部通过\n');
  return root;
}
/** sidechain CLI 需要合法 spec-driver 项目（A-C4 项目闸）；A2/B2 的『.specify 不存在』证据用无标记 stageRoot */
function sdRoot(opts = {}) {
  const root = stageRoot(opts);
  fs.mkdirSync(path.join(root, '.specify', 'memory'), { recursive: true });
  return root;
}
function writeTranscript(root, lines, name = `t-${++seq}.jsonl`) {
  const p = path.join(root, name);
  fs.writeFileSync(p, lines.flat().map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}
function stop(root, transcriptPath, sessionId, { feedback = true, mode = 'hook', extra = {} } = {}) {
  const payload = { session_id: sessionId, transcript_path: transcriptPath, stop_hook_active: false, ...extra };
  const res = spawnSync('node', [CLI, '--mode', mode, '--project-root', root], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (feedback && mode === 'hook' && res.status === 2) fs.appendFileSync(transcriptPath, `${JSON.stringify(FEEDBACK(res.stderr))}\n`);
  return { status: res.status, stderr: res.stderr, stdout: res.stdout };
}
function readEvents(root) {
  const dir = path.join(root, '.specify', 'runs');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}
const verdictEvents = (root) => readEvents(root).filter((e) => e.eventType === 'fix-compliance-verdict');
const stateDir = (root) => path.join(root, '.specify', 'runs', '.fix-compliance-state');
const stateFile = (root, sid) => path.join(stateDir(root), `${sid}.json`);

// 三种语料骨架（均**无** fix 展开）
const resumeLines = ({ delegateVerify }) => [
  EXPANSION('resume'),
  TOOL_USE_WITH_RECEIPT('Bash', { command: `sed -i '' 's/x/y/' ${FIX_DIR}/fix-report.md && echo ok > ${FIX_DIR}/verification/verification-report.md` }),
  ...(delegateVerify ? [AGENT('spec-driver:verify', '验证修复结果')] : []),
  ASSISTANT_TEXT('续做完成'),
];
const witnessLines = ({ delegateVerify, target = `${FIX_DIR}/fix-report.md` }) => [
  TOOL_USE_WITH_RECEIPT('Write', { file_path: target, content: REPAIR_FIX_REPORT }),
  ...(delegateVerify ? [AGENT('spec-driver:verify', '验证修复结果')] : []),
  ASSISTANT_TEXT('顺手改完'),
];

describe('F289 · 单元：resume 基线 / Tier 2 合同 / 标记 io / 形状守卫 / 合同登记', () => {
  it('U1 detectFixSkillExpansion 同趟记 latestResumeLineIndex（最晚一次），不为 resume 记 fix 基线', () => {
    const entries = [EXPANSION('resume'), ASSISTANT_TEXT('a'), EXPANSION('resume'), ASSISTANT_TEXT('b')].map((raw, i) => normalizeTranscriptEntry(raw, i, false));
    const anchor = detectFixSkillExpansion(entries);
    assert.equal(anchor.earliestFixLineIndex, null);
    assert.equal(anchor.latestFixLineIndex, null);
    assert.equal(anchor.latestResumeLineIndex, 2);
    const none = detectFixSkillExpansion([ASSISTANT_TEXT('x')].map((raw, i) => normalizeTranscriptEntry(raw, i, false)));
    assert.equal(none.latestResumeLineIndex, null);
  });

  it('U2 judgeCompliance({ tier2:true })：implement 委派豁免，verify 委派与制品判据逐字同 Tier 1', () => {
    const base = {
      featureDir: { path: FIX_DIR, existsOnDisk: true },
      fixReport: { exists: true, content: REPAIR_FIX_REPORT },
      verificationReport: { exists: true, nonEmpty: true, content: '# V\n通过' },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    };
    const verifyOnly = [{ roleClass: 'verify' }];
    assert.deepEqual(judgeCompliance({ ...base, delegations: verifyOnly, tier2: true }).missing, []);
    assert.deepEqual(judgeCompliance({ ...base, delegations: verifyOnly, tier2: false }).missing, ['delegation:implement']);
    assert.deepEqual(judgeCompliance({ ...base, delegations: [], tier2: true }).missing, ['delegation:verify']);
    assert.deepEqual(judgeCompliance({ ...base, delegations: verifyOnly, tier2: true, verificationReport: { exists: false, nonEmpty: false } }).missing, ['verification-report.md']);
  });

  it('U3 标记 io：写入 / 列出（只认 sessionId 一致）/ 畸形跳过 / resetBlockState 不删标记', () => {
    const root = stageRoot();
    const w = writeSidechainMarker(root, { sessionId: 's1', agentId: 'agent-a', agentType: 'general-purpose', fixLineIndex: 3, candidatePath: FIX_DIR });
    assert.equal(w.ok, true);
    fs.writeFileSync(path.join(stateDir(root), 's1.sidechain.bogus.json'), '{not json');
    fs.writeFileSync(path.join(stateDir(root), 's1.sidechain.other.json'), JSON.stringify({ sessionId: 'someone-else', agentId: 'x' }));
    const list = listSidechainMarkers(root, 's1');
    assert.equal(list.length, 1);
    assert.equal(list[0].agentId, 'agent-a'); assert.equal(list[0].candidatePath, FIX_DIR); assert.equal(list[0].fixLineIndex, 3);
    assert.equal(listSidechainMarkers(root, 's2').length, 0);
    fs.writeFileSync(stateFile(root, 's1'), JSON.stringify({ sessionId: 's1', blockCount: 1 }));
    resetBlockState(root, 's1');
    assert.equal(fs.existsSync(stateFile(root, 's1')), false);
    assert.equal(listSidechainMarkers(root, 's1').length, 1, 'reset 只删状态文件，不删标记');
  });

  it('U4 形状守卫：缺 agent_transcript_path / session_id 空 / 非对象 ⇒ 方言跳过零落盘', () => {
    const root = stageRoot();
    for (const bad of [null, 42, {}, { session_id: 's', agent_id: 'a' }, { session_id: '', agent_transcript_path: '/x' }]) {
      assert.equal(isSubagentStopShape(bad), false);
      assert.equal(recordSidechainFixMarker(root, bad).reason, 'dialect-skip');
    }
    assert.equal(fs.existsSync(stateDir(root)), false, '零落盘');
  });

  it('U5 合同登记：三个 tier2 码在 JUDGE 表（不可见）且 ⊆ schema enum；schema 有 tier 字段；hooks.json 挂 SubagentStop；脚本登记为 Claude 独有、不进 OWNED 表', () => {
    for (const key of ['tier2BoundResume', 'tier2BoundWitness', 'tier2BoundSidechain']) {
      assert.equal(JUDGE_DIAGNOSTICS[key].userFacing, false);
      assert.ok(SCHEMA_ENUM.has(JUDGE_DIAGNOSTICS[key].code));
    }
    assert.ok(SCHEMA.properties.tier, 'schema 缺 tier 字段');
    const hooks = JSON.parse(fs.readFileSync(path.resolve(PLUGIN, 'hooks/hooks.json'), 'utf8'));
    const commands = (hooks.hooks?.SubagentStop || hooks.SubagentStop || []).flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(commands.some((c) => c.endsWith('/hooks/subagent-stop-fix-marker.sh')), JSON.stringify(commands));
    assert.ok(!Object.keys(OWNED_HOOK_EXPECTED_EVENT).includes('hooks/subagent-stop-fix-marker.sh'));
    assert.ok(CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES.some(([dir, name]) => dir === 'hooks' && name === 'subagent-stop-fix-marker.sh'));
  });
});

describe('F289 · (a) resume 入口', () => {
  it('A1 resume + fix-dir 提名 + 缺 verify 委派 ⇒ Tier 2 阻断（exit 2，tier:2，tier2-bound-resume，implement 不在 missing）；补 verify 委派后放行并 reset', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, resumeLines({ delegateVerify: false }));
    const r1 = stop(root, t, 'a1');
    assert.equal(r1.status, 2, r1.stderr);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.tier, 2);
    assert.ok(ev.diagnostics.includes('tier2-bound-resume'), JSON.stringify(ev.diagnostics));
    assert.deepEqual(ev.missing, ['delegation:verify'], 'implement 已豁免');
    assert.ok(!r1.stderr.includes('缺少 implement 类委派'), 'stderr 不得要求 implement 委派（双路径通用指引里提到 implement 不算）');
    const t2 = writeTranscript(root, resumeLines({ delegateVerify: true }));
    const r2 = stop(root, t2, 'a1');
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(fs.existsSync(stateFile(root, 'a1')), false, '合规 reset');
    assert.equal(verdictEvents(root).pop().compliant, true);
  });

  it('A2 对照：resume 无 fix 提名（feature 续做）⇒ 零判定零落盘；只 cat 提及不提名', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [EXPANSION('resume'), TOOL_USE_WITH_RECEIPT('Bash', { command: `cat ${FIX_DIR}/fix-report.md` }), ASSISTANT_TEXT('看看')]);
    const r = stop(root, t, 'a2');
    assert.equal(r.status, 0); assert.equal(r.stderr, '');
    assert.equal(fs.existsSync(path.join(root, '.specify')), false, 'US5：零落盘');
  });

  it('A3 自愈序列：resume 不合规 exit 2,2 → 第 3 次（佐证 2 条）降级放行；blockCount 路径正常（prompt_id 缺席）', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, resumeLines({ delegateVerify: false }));
    const codes = [1, 2, 3].map(() => stop(root, t, 'a3').status);
    assert.deepEqual(codes, [2, 2, 0]);
    assert.equal(verdictEvents(root).pop().degraded, true);
  });

  it('A4 对抗复审 A-C1：绑定用最早一次 resume 展开 ⇒ 尾部再展开一次 resume 不解绑（仍 Tier 2 阻断，不是零判定）', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, [...resumeLines({ delegateVerify: false }), EXPANSION('resume'), ASSISTANT_TEXT('又续了一次')]);
    const r = stop(root, t, 'a4');
    assert.equal(r.status, 2, r.stderr);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.tier, 2); assert.ok(ev.diagnostics.includes('tier2-bound-resume'), JSON.stringify(ev.diagnostics));
  });

  it('A5 对抗复审 A-C2：resume 后一条光杆 mv 到非规范名（ambiguous 提名）仍绑定 Tier 2（走 F224：missing 含 feature-dir），不是零判定', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, [
      EXPANSION('resume'),
      ...TOOL_USE_WITH_RECEIPT('Write', { file_path: `${FIX_DIR}/fix-report.md`, content: REPAIR_FIX_REPORT }),
      ...TOOL_USE_WITH_RECEIPT('Bash', { command: `mv ${FIX_DIR} specs/archive-alpha` }),
      ASSISTANT_TEXT('归档了'),
    ]);
    const r = stop(root, t, 'a5');
    assert.equal(r.status, 2, r.stderr);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.tier, 2, '光杆 mv 到非规范名不得让 Tier 2 零判定');
    assert.ok(ev.missing.includes('feature-dir'), JSON.stringify(ev.missing));
  });
});

describe('F289 · (b) 裸会话写入见证', () => {
  it('B1 Write fix-report.md（含回执）+ 缺 verify 委派 ⇒ Tier 2 阻断 + tier2-bound-witness；只有 verify 委派 + 制品齐 ⇒ 放行', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, witnessLines({ delegateVerify: false }));
    const r1 = stop(root, t, 'b1');
    assert.equal(r1.status, 2, r1.stderr);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.tier, 2); assert.ok(ev.diagnostics.includes('tier2-bound-witness'));
    const t2 = writeTranscript(root, witnessLines({ delegateVerify: true }));
    assert.equal(stop(root, t2, 'b1').status, 0);
  });

  it('B2 对照：写 fix 目录下其他文件（spec.md）/ 只读 ⇒ 不绑定零落盘', () => {
    const root = stageRoot();
    const t = writeTranscript(root, witnessLines({ delegateVerify: false, target: `${FIX_DIR}/spec.md` }));
    assert.equal(stop(root, t, 'b2').status, 0);
    const t2 = writeTranscript(root, [TOOL_USE_WITH_RECEIPT('Read', { file_path: `${FIX_DIR}/fix-report.md` }), ASSISTANT_TEXT('读完')]);
    assert.equal(stop(root, t2, 'b2b').status, 0);
    assert.equal(fs.existsSync(path.join(root, '.specify')), false);
  });

  it('B3 report 模式透传 tier / tier2Source', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, witnessLines({ delegateVerify: false }));
    const r = stop(root, t, 'b3', { mode: 'report' });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tier, 2); assert.equal(out.tier2Source, 'witness'); assert.equal(out.fixSession, true);
  });
});

describe('F289 · (c) sidechain 两级接力', () => {
  it('C1 SubagentStop CLI：子代理 transcript 含 fix 展开 ⇒ 写标记（键 = session + agent，携带提名）；主 Stop 无展开 ⇒ Tier 2 阻断 + tier2-bound-sidechain；补齐后放行且标记保留', () => {
    const root = sdRoot({ withReport: true });
    const agentT = writeTranscript(root, [EXPANSION('fix'), TOOL_USE_WITH_RECEIPT('Write', { file_path: `${FIX_DIR}/fix-report.md`, content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT('子代理修完')], 'agent-1.jsonl');
    const rec = recordSidechainFixMarker(root, { session_id: 'c1', agent_id: 'agent-1', agent_type: 'general-purpose', agent_transcript_path: agentT });
    assert.equal(rec.reason, 'marker-written', JSON.stringify(rec));
    const markers = listSidechainMarkers(root, 'c1');
    assert.equal(markers.length, 1); assert.equal(markers[0].candidatePath, FIX_DIR);
    const mainT = writeTranscript(root, [ASSISTANT_TEXT('主线程只派了个子代理'), ASSISTANT_TEXT('结束')]);
    const r1 = stop(root, mainT, 'c1');
    assert.equal(r1.status, 2, r1.stderr);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.tier, 2); assert.ok(ev.diagnostics.includes('tier2-bound-sidechain'));
    assert.deepEqual(ev.missing, ['delegation:verify']);
    const mainT2 = writeTranscript(root, [ASSISTANT_TEXT('主线程'), AGENT('spec-driver:verify', '验证修复结果'), ASSISTANT_TEXT('结束')]);
    assert.equal(stop(root, mainT2, 'c1').status, 0);
    assert.equal(listSidechainMarkers(root, 'c1').length, 1, '合规 reset 不删标记');
  });

  it('C2 CLI 不写标记的形态：子代理无 fix 展开 / transcript 缺席（selfdiag）/ 超限；标记 session 不匹配不绑定', () => {
    const root = sdRoot();
    const noFix = writeTranscript(root, [EXPANSION('resume'), ASSISTANT_TEXT('x')], 'agent-nofix.jsonl');
    assert.equal(recordSidechainFixMarker(root, { session_id: 'c2', agent_id: 'a', agent_transcript_path: noFix }).reason, 'no-fix-expansion');
    assert.equal(recordSidechainFixMarker(root, { session_id: 'c2', agent_id: 'a', agent_transcript_path: path.join(root, 'missing.jsonl') }).reason, 'agent-transcript-unavailable');
    assert.ok(fs.existsSync(path.join(stateDir(root), '.sidechain-selfdiag.jsonl')), 'selfdiag 落盘');
    assert.equal(listSidechainMarkers(root, 'c2').length, 0);
    writeSidechainMarker(root, { sessionId: 'someone-else', agentId: 'a', fixLineIndex: 0, candidatePath: FIX_DIR });
    const mainT = writeTranscript(root, [ASSISTANT_TEXT('无关会话')]);
    const r = stop(root, mainT, 'c2');
    assert.equal(r.status, 0); assert.equal(verdictEvents(root).length, 0, '他人标记不绑定');
  });

  it('C3 薄壳 hook：真实 SubagentStop payload 经 sh 走通写标记；CLI 缺席 / node 缺失 / 方言 payload 都 exit 0 零输出', () => {
    const root = sdRoot();
    const agentT = writeTranscript(root, [EXPANSION('fix'), ASSISTANT_TEXT('x')], 'agent-sh.jsonl');
    const payload = JSON.stringify({ session_id: 'c3', agent_id: 'agent-sh', agent_type: '', agent_transcript_path: agentT, transcript_path: '/dev/null', hook_event_name: 'SubagentStop' });
    const ok = spawnSync('bash', [HOOK_SH], { cwd: root, input: payload, encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT: PLUGIN, CLAUDE_PLUGIN_ROOT: '' } });
    assert.equal(ok.status, 0); assert.equal(ok.stdout, ''); assert.equal(ok.stderr, '');
    assert.equal(listSidechainMarkers(root, 'c3').length, 1);
    const missingCli = spawnSync('bash', [HOOK_SH], { cwd: root, input: payload, encoding: 'utf8', env: { ...process.env, SIDECHAIN_MARKER_CLI: path.join(root, 'nope.mjs'), CLAUDE_PLUGIN_ROOT: '', PLUGIN_ROOT: '' } });
    assert.equal(missingCli.status, 0); assert.equal(missingCli.stdout + missingCli.stderr, '');
    const dialect = spawnSync('bash', [HOOK_SH], { cwd: root, input: JSON.stringify({ session_id: 'c3', tool_name: 'x' }), encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT: PLUGIN, CLAUDE_PLUGIN_ROOT: '' } });
    assert.equal(dialect.status, 0); assert.equal(dialect.stdout + dialect.stderr, '');
    const broken = spawnSync('bash', [HOOK_SH], { cwd: root, input: '{not json', encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT: PLUGIN, CLAUDE_PLUGIN_ROOT: '' } });
    assert.equal(broken.status, 0); assert.equal(broken.stdout + broken.stderr, '');
  });

  it('C4 对抗复审 A-C4：非 spec-driver 项目（无 .specify 标记）⇒ 不写标记、不写 selfdiag、零落盘（每个子代理停止都触发，装了插件的任意项目都可能被写）', () => {
    const root = stageRoot();   // 刻意不建 .specify 标记
    const agentT = writeTranscript(root, [EXPANSION('fix'), ASSISTANT_TEXT('x')], 'agent-c4.jsonl');
    assert.equal(recordSidechainFixMarker(root, { session_id: 'c4', agent_id: 'a', agent_transcript_path: agentT }).reason, 'not-spec-driver-project');
    // transcript 缺席形态同样不得穿透项目闸落 selfdiag
    assert.equal(recordSidechainFixMarker(root, { session_id: 'c4', agent_id: 'a', agent_transcript_path: path.join(root, 'nope.jsonl') }).reason, 'not-spec-driver-project');
    assert.equal(fs.existsSync(path.join(root, '.specify')), false, '非 spec-driver 项目零落盘');
  });

  it('C5 对抗复审 B-C1：子代理 transcript 里的 fix 展开字面是父编排器 prompt 引用（isMeta=false）⇒ 不算子代理真展开、不写标记（真实语料唯一 (c) 命中即此诱饵）', () => {
    const root = sdRoot();
    const quoted = writeTranscript(root, [EXPANSION_QUOTED('fix'), ASSISTANT_TEXT('我来审这段 transcript')], 'agent-c5.jsonl');
    assert.equal(recordSidechainFixMarker(root, { session_id: 'c5', agent_id: 'a', agent_transcript_path: quoted }).reason, 'no-fix-expansion');
    assert.equal(listSidechainMarkers(root, 'c5').length, 0);
    // 对照：isMeta=true 的真展开则写标记
    const real = writeTranscript(root, [EXPANSION('fix'), TOOL_USE_WITH_RECEIPT('Write', { file_path: `${FIX_DIR}/fix-report.md`, content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT('修完')], 'agent-c5b.jsonl');
    assert.equal(recordSidechainFixMarker(root, { session_id: 'c5', agent_id: 'b', agent_transcript_path: real }).reason, 'marker-written');
  });
});

describe('F289 · implement 阶段对抗复审回归（跨目标佐证 / sidechain 无提名 / 账本窗口）', () => {
  it('E1 同目标编辑循环正常自愈（delta 误伤面 CRITICAL 回归钉）：用户按判定器提示每轮重编辑同一 fix-report 响应阻断 ⇒ 第 3 轮降级自愈（不得因佐证锚前移而永久 fail-closed）', () => {
    const root = stageRoot({ withReport: true });
    let lines = [...TOOL_USE_WITH_RECEIPT('Write', { file_path: `${FIX_DIR}/fix-report.md`, content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT('start')];
    const t = writeTranscript(root, lines);
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      const r = stop(root, t, 'e1');
      codes.push(r.status);
      // 用户响应阻断：再编辑一次 fix-report（自然合规行为）⇒ 新见证
      fs.appendFileSync(t, [...TOOL_USE_WITH_RECEIPT('Write', { file_path: `${FIX_DIR}/fix-report.md`, content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT(`edit ${i}`)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    }
    assert.deepEqual(codes.slice(0, 3), [2, 2, 0], `同目标编辑循环必须第 3 轮自愈（佐证窗口不随同目标重编辑前移）：${JSON.stringify(codes)}`);
  });

  it('E2 sidechain 无提名不绑定（delta 双角收敛：既不硬阻断〔误伤〕也不 F224 免费通行〔绕过〕）：标记无 candidatePath + 主 transcript 无提名 ⇒ 未识别为 fix 续做、exit 0 零落盘（有无 verify 委派同）；标记携带 candidatePath 才绑定', () => {
    const root = sdRoot({ withReport: true });
    // 无提名（标记 candidatePath:null + 主 transcript 无 fix-dir 提名）+ 有 verify 委派 ⇒ 不绑定、exit 0、零 verdict 事件
    writeSidechainMarker(root, { sessionId: 'e2', agentId: 'a', agentType: 'general-purpose', fixLineIndex: 0, candidatePath: null });
    const t = writeTranscript(root, [ASSISTANT_TEXT('主线程派了 verify'), ...AGENT('spec-driver:verify', '验证修复结果'), ASSISTANT_TEXT('done')]);
    const r = stop(root, t, 'e2', { feedback: false });
    assert.equal(r.status, 0, `无提名 sidechain 不应绑定（非硬阻断、非 F224 免费通行）：${r.stderr}`);
    const rep = JSON.parse(stop(root, t, 'e2', { feedback: false, mode: 'report' }).stdout);
    assert.equal(rep.tier, null, '无提名 ⇒ 未识别为 Tier 2（tier:null）');
    assert.equal(verdictEvents(root).length, 0, 'US5：未绑定 ⇒ 零落盘');
    // 无提名 + 无 verify ⇒ 同样不绑定 exit 0（不是硬阻断）
    writeSidechainMarker(root, { sessionId: 'e2b', agentId: 'a', agentType: 'general-purpose', fixLineIndex: 0, candidatePath: null });
    const t2 = writeTranscript(root, [ASSISTANT_TEXT('什么都没派'), ASSISTANT_TEXT('done')]);
    assert.equal(stop(root, t2, 'e2b', { feedback: false }).status, 0, '无提名无 verify ⇒ 不绑定 exit 0（非硬阻断，修复误伤面 C-1）');
    // 对照：标记携带 candidatePath ⇒ 绑定为 Tier 2（缺 verify ⇒ 阻断）
    writeSidechainMarker(root, { sessionId: 'e2c', agentId: 'a', agentType: 'general-purpose', fixLineIndex: 0, candidatePath: FIX_DIR });
    const t3 = writeTranscript(root, [ASSISTANT_TEXT('子代理修完、主线程没派 verify'), ASSISTANT_TEXT('done')]);
    const r3 = stop(root, t3, 'e2c', { feedback: false });
    assert.equal(r3.status, 2, '标记携带提名 ⇒ 绑定 Tier 2，缺 verify ⇒ 阻断');
    assert.ok(verdictEvents(root).pop().diagnostics.includes('tier2-bound-sidechain'));
  });

  it('E3 账本 sinceTs 真实窗口（implement 误伤面 C-2 覆盖）：witness 锚带真实 timestamp，账本一条锚后 verify ⇒ 补充生效放行；账本条目在锚前 ⇒ 被排除、仍缺 verify 阻断', () => {
    const root = stageRoot({ withReport: true });
    const ts = (n) => `2026-09-13T10:00:${String(n).padStart(2, '0')}.000Z`;
    const witId = 'toolu_wit';
    const lines = [
      { type: 'assistant', timestamp: ts(10), message: { role: 'assistant', content: [{ type: 'tool_use', id: witId, name: 'Write', input: { file_path: `${FIX_DIR}/fix-report.md`, content: REPAIR_FIX_REPORT } }] } },
      { type: 'user', timestamp: ts(11), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: witId, is_error: false, content: 'ok' }] } },
      ASSISTANT_TEXT('续做完成'),
    ];
    const t = writeTranscript(root, lines);
    const ledgerDir = path.join(root, '.specify', 'runs', '.fix-compliance-ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, 'e3.jsonl'), JSON.stringify({ session_id: 'e3', tool_name: 'Agent', tool_use_id: 'led1', subagent_type: 'spec-driver:verify', hookTs: ts(20) }) + '\n');
    assert.equal(stop(root, t, 'e3', { feedback: false }).status, 0, '账本锚后 verify 应补充 ⇒ 合规放行');
    fs.writeFileSync(path.join(ledgerDir, 'e3b.jsonl'), JSON.stringify({ session_id: 'e3b', tool_name: 'Agent', tool_use_id: 'led1', subagent_type: 'spec-driver:verify', hookTs: ts(5) }) + '\n');
    assert.equal(stop(root, t, 'e3b', { feedback: false }).status, 2, '账本锚前 verify 应被 sinceTs 窗口排除 ⇒ 阻断');
  });
});


describe('F289 · Tier 1 不变 + 源码守卫', () => {
  it('D1 有 fix 展开的会话仍是 Tier 1（tier:1，无 tier2 码），implement 缺失照常计入 missing', () => {
    const root = stageRoot({ withReport: true });
    const t = writeTranscript(root, [EXPANSION('fix'), ...witnessLines({ delegateVerify: true })]);
    const r = stop(root, t, 'd1');
    assert.equal(r.status, 2, r.stderr);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.tier, 1);
    assert.ok(ev.missing.includes('delegation:implement'));
    assert.ok(!ev.diagnostics.some((c) => c.startsWith('tier2-bound-')));
  });

  it('D2 源码守卫：judge 用 io 的 readStdinSync（不再自带一份）；sidechain CLI 只调一次 detectFixSkillExpansion（单趟）', () => {
    const judgeSrc = fs.readFileSync(CLI, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/function readStdinSync\(/.test(judgeSrc), false);
    assert.match(judgeSrc, /readStdinSync,\n/);
    const cliSrc = fs.readFileSync(MARKER_CLI, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal((cliSrc.match(/detectFixSkillExpansion\(/g) || []).length, 1);
  });
});
