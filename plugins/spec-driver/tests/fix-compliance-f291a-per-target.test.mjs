/**
 * F291a · per-target 阻断预算（M11 卡 B，门禁类 · 方案①′）。
 *
 * 病根（F289 delta 复审 CRITICAL）：blockCount / 降级状态按 **session** 持久。同会话 Fix-A 付满 2 次真实阻断后，**全新** Fix-B
 * 首次评估即满足「blockCount ≥ 上限 + 佐证够」⟹ 0 往返降级放行。
 *
 * 修法（方案①′，两轮异构对抗后从方案①复合文件改来）：状态仍是每会话一份 `<sid>.json`（锁按会话），文件内
 * `targets[桶键]` 分目标记账；桶键 = 规范化的目标目录字面量（提名身份优先），随目标身份链（F224 改名跟随 / F227 候选历史 /
 * F256 短名重锚定）迁移；定位不到目标的轮次落 `__no-target__` 桶、不向具名目标捐赠；合规清零整份删除；在途推迟预算
 * （会话属性）留顶层；改造前文件的顶层计数不迁移（fail-closed 迁移）。
 *
 * 语料来源：两轮对抗审查的实跑构造（跨目标 fail-open / 无目标桶捐赠 / 兄弟桶残留 / 逐轮改名与重编号的永久 fail-closed /
 * 推迟预算按目标放大 / sidechain 非规范拼写撞键），每条都曾在方案①或 HEAD 上实测失败。
 * 运行方式: node --test plugins/spec-driver/tests/fix-compliance-f291a-per-target.test.mjs
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCK_LIMIT, IN_FLIGHT_DEFER_LIMIT } from '../scripts/fix-compliance-judge.mjs';
import { HOOK_FEEDBACK_PREFIX } from '../scripts/lib/fix-compliance-core.mjs';
import * as io from '../scripts/lib/fix-compliance-io.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../scripts/fix-compliance-judge.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f291a-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SKILL_EXPANSION_LINE = { type: 'user', message: { role: 'user', content: '<command-name>/spec-driver:spec-driver-fix</command-name>\nBase directory for this skill: /x/plugins/spec-driver/skills/spec-driver-fix' } };
const ASSISTANT_TEXT = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const TOOL_USE = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
const REPAIR_FIX_REPORT = '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n';
const FEEDBACK = (stderr) => ({ type: 'user', isMeta: true, userType: 'external', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[node fix-compliance-judge.mjs --mode hook]: ${stderr}` } });
const TARGET_A = 'specs/301-fix-sample-bug';
const TARGET_B = 'specs/302-fix-other-bug';
const TARGET_C = 'specs/303-fix-gamma-bug';

let seq = 0;
function stageRoot(dirs = [TARGET_A, TARGET_B, TARGET_C]) {
  const root = path.join(tmp, `root-${++seq}`);
  for (const dir of dirs) stageTarget(root, dir);
  return root;
}
function stageTarget(root, dir, { verification = true } = {}) {
  fs.mkdirSync(path.join(root, dir, 'verification'), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'fix-report.md'), REPAIR_FIX_REPORT);
  if (verification) fs.writeFileSync(path.join(root, dir, 'verification', 'verification-report.md'), '# 验证报告\n\n全部通过。\n');
}
const nominate = (target) => [TOOL_USE('Write', { file_path: `${target}/fix-report.md`, content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT(`${target} 报告已写`)];
const delegations = () => [
  TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码实现' }),
  TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '验证修复结果' }),
];
function writeTranscript(root, lines) {
  const p = path.join(root, `t-${++seq}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}
function append(p, lines) { for (const l of lines) fs.appendFileSync(p, `${JSON.stringify(l)}\n`); }
/** 跑一次 Stop；exit 2 时按 harness 形态回灌一条阻断反馈（放行佐证） */
function stop(root, transcriptPath, sessionId, promptId, extra = {}) {
  const payload = { session_id: sessionId, transcript_path: transcriptPath, stop_hook_active: false, ...(promptId ? { prompt_id: promptId } : {}), ...extra };
  const r = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', root], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (r.status === 2) fs.appendFileSync(transcriptPath, `${JSON.stringify(FEEDBACK(r.stderr))}\n`);
  return r;
}
const stateDir = (root) => path.join(root, '.specify', 'runs', '.fix-compliance-state');
function readState(root, sid) {
  const p = path.join(stateDir(root), `${sid}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
const bucket = (root, sid, key) => io.targetBudgetOf(readState(root, sid), key);
function events(root, type) {
  const dir = path.join(root, '.specify', 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    .filter((e) => e.eventType === type);
}
const runSummaries = (root) => events(root, 'workflow-run-summary');
const verdictEvents = (root) => events(root, 'fix-compliance-verdict');
const RESUME_EXPANSION = { type: 'user', isMeta: true, message: { role: 'user', content: '<command-name>/spec-driver:spec-driver-resume</command-name>\nBase directory for this skill: /x/plugins/spec-driver/skills/spec-driver-resume' } };
let toolSeq = 0;
function toolUseWithReceipt(name, input) {
  const id = `toolu_${++toolSeq}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'ok' }] } },
  ];
}
const resumeNominate = (target) => [
  ...toolUseWithReceipt('Bash', { command: `sed -i '' 's/x/y/' ${target}/fix-report.md && echo ok > ${target}/verification/verification-report.md` }),
  ASSISTANT_TEXT('续做完成'),
];
/** 逐轮 Stop 直到 exit 0 或达上限，返回退出码序列 */
function runRounds(root, t, sid, n, { prompt = true, between = () => [ASSISTANT_TEXT('继续')] } = {}) {
  const codes = [];
  for (let i = 0; i < n; i += 1) {
    const r = stop(root, t, sid, prompt ? `p${i}-${seq}` : undefined);
    codes.push(r.status);
    if (r.status === 0) break;
    append(t, between(i));
  }
  return codes;
}

describe('F291a · 跨目标切换不 fail-open', () => {
  it('Tier 2（resume 绑定）：A 付满 2 次阻断降级后同会话提名切到 B，B 首次 Stop 必须 exit 2；A / B 各自的桶记在各自的桶键', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [RESUME_EXPANSION, ...resumeNominate(TARGET_A)]);
    const codesA = ['a1', 'a2', 'a3'].map(() => stop(root, t, 'sid').status);
    assert.deepEqual(codesA, [2, 2, 0], 'A：两次真实阻断 + 回灌佐证 ⇒ 第三次降级放行');
    assert.equal(runSummaries(root).length, 1);
    assert.equal(bucket(root, 'sid', TARGET_A).blockCount, BLOCK_LIMIT);
    append(t, resumeNominate(TARGET_B));
    const rB = stop(root, t, 'sid');
    assert.equal(rB.status, 2, `B 首次评估必须阻断（改动前 0 往返放行）：${rB.stderr}`);
    assert.equal(bucket(root, 'sid', TARGET_B).blockCount, 1);
    assert.equal(bucket(root, 'sid', TARGET_A).blockCount, BLOCK_LIMIT, 'A 的桶不受 B 影响');
    assert.equal(runSummaries(root).length, 1, 'B 未放行 ⇒ 无新降级终态');
    const last = verdictEvents(root).pop();
    assert.equal(last.targetDir, TARGET_B, '审计事件带被判目录');
    assert.equal(last.budgetKey, TARGET_B, '审计事件带预算桶键');
  });

  it('无目标桶不捐赠：前三轮零提名（裸 Stop）付满预算后，提名全新 A / B / C 各自首次 Stop 都 exit 2（对抗审查 E2 / C-2）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ASSISTANT_TEXT('排查中，尚未建目录')]);
    // 带 prompt_id ⇒ 指纹路由：首轮 nonBlock 计数、两次阻断、第四轮降级（同目标 8 轮语料同型）
    const bare = ['p1', 'p2', 'p3', 'p4'].map((p) => { const c = stop(root, t, 'sid', p).status; append(t, [ASSISTANT_TEXT(`继续 ${p}`)]); return c; });
    assert.deepEqual(bare, [2, 2, 2, 0], '无目标桶自己的预算：两次阻断后降级放行（改动前语义）');
    assert.equal(bucket(root, 'sid', io.NO_TARGET_BUDGET_KEY).blockCount, BLOCK_LIMIT);
    const firsts = [];
    for (const target of [TARGET_A, TARGET_B, TARGET_C]) {
      append(t, nominate(target));
      firsts.push(stop(root, t, 'sid', `first-${target}`).status);
    }
    assert.deepEqual(firsts, [2, 2, 2], '具名目标各自从 0 起算，不继承无目标桶');
    assert.equal(runSummaries(root).length, 1, '只有无目标桶那一次降级终态');
  });

  it('改造前会话文件（顶层 blockCount:2 + degradedRecorded:true）不迁移：resume 后提名 A 首次 Stop exit 2，且终态照写', () => {
    const root = stageRoot();
    fs.mkdirSync(stateDir(root), { recursive: true });
    fs.writeFileSync(path.join(stateDir(root), 'old.json'), JSON.stringify({ sessionId: 'old', blockCount: 2, degradedRecorded: true, nonBlockStopCount: 2, inFlightDeferCount: 1 }));
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...nominate(TARGET_A)]);
    const codes = runRounds(root, t, 'old', 5);
    assert.deepEqual(codes, [2, 2, 2, 0], '旧计数不捐赠：A 自己走完 nonBlock + 两轮阻断后才降级');
    assert.equal(readState(root, 'old').inFlightDeferCount, 1, '会话属性 inFlightDeferCount 照旧保留');
    assert.equal(runSummaries(root).length, 1, '降级终态照写（预置 degradedRecorded 抑制不了）');
  });
});

describe('F291a · 合规清零按会话；同目标预算连续', () => {
  it('兄弟桶不残留（对抗审查 C-2）：A 付满 → 同会话 B 合规收口 → 回到 A 首次 Stop 仍 exit 2', () => {
    const root = stageRoot([TARGET_B]);
    stageTarget(root, TARGET_A, { verification: false });   // A 缺 verification-report（诚实的「还没验完」）
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...nominate(TARGET_A), ...delegations(), ASSISTANT_TEXT('A 先做到这里')]);
    const seqA = ['a1', 'a2', 'a3', 'a4'].map((p) => { const c = stop(root, t, 'sid', p).status; append(t, [ASSISTANT_TEXT(`A 补 ${p}`)]); return c; });
    assert.deepEqual(seqA, [2, 2, 2, 0]);
    append(t, [...nominate(TARGET_B), ...delegations(), ASSISTANT_TEXT('B 完成')]);
    assert.equal(stop(root, t, 'sid', 'b1').status, 0, 'B 制品齐备 ⇒ 合规放行');
    assert.equal(readState(root, 'sid'), null, '合规 ⇒ 会话状态整份删除（全部目标桶清零）');
    append(t, [...nominate(TARGET_A), ASSISTANT_TEXT('回到 A')]);
    const back = stop(root, t, 'sid', 'a9');
    assert.equal(back.status, 2, `回到 A 必须重新计数（方案①复合文件下这里是 0 往返放行）：${back.stderr}`);
    // 清零后的桶是「该目标首次」态：带 prompt_id 的首轮走 nonBlock 计数（不动 blockCount），与同目标 8 轮语料首轮同型
    assert.deepEqual([bucket(root, 'sid', TARGET_A).blockCount, bucket(root, 'sid', TARGET_A).nonBlockStopCount], [0, 1]);
  });

  it('同目标 8 轮自愈：[2,2,2,0,2,2,2,0]——首轮 nonBlock 计数、两次阻断、降级；合规清零后再来一遍（回归护栏）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...nominate(TARGET_A)]);
    const codes = [];
    for (let round = 0; round < 2; round += 1) {
      codes.push(...runRounds(root, t, 'sid', 4));
      append(t, [...delegations(), ASSISTANT_TEXT('补齐委派')]);
      assert.equal(stop(root, t, 'sid', `ok-${round}`).status, 0, '合规收口');
      assert.equal(readState(root, 'sid'), null, '合规 ⇒ 清零');
      // 重新展开 fix（新证据窗口，委派不再在窗口内）+ 再提名同一目标 ⇒ 回到不合规态
      append(t, [SKILL_EXPANSION_LINE, ...nominate(TARGET_A), ASSISTANT_TEXT('又回到不合规态')]);
    }
    assert.deepEqual(codes, [2, 2, 2, 0, 2, 2, 2, 0]);
  });

  it('逐轮合法改名（光杆 mv，F224 跟随）预算随身份链迁移：[2,2,2,0]，不再永久 fail-closed（对抗审查 C-3 / E3b）', () => {
    const dirs = Array.from({ length: 10 }, (_, i) => `specs/${301 + i}-fix-chain-bug`);
    const root = stageRoot(dirs);
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...nominate(dirs[0])]);
    const codes = runRounds(root, t, 'sid', 8, { between: (i) => [TOOL_USE('Bash', { command: `mv ${dirs[i]} ${dirs[i + 1]}` }), ASSISTANT_TEXT(`重编到 ${dirs[i + 1]}`)] });
    assert.deepEqual(codes, [2, 2, 2, 0], `逐轮改名下第 4 轮必须自愈：${JSON.stringify(codes)}`);
    const keys = Object.keys(readState(root, 'sid').targets);
    assert.equal(keys.length, 1, `预算桶随改名迁移，只剩一个桶：${keys.join(',')}`);
    assert.equal(bucket(root, 'sid', keys[0]).blockCount, BLOCK_LIMIT);
  });

  it('逐轮复合 git mv 重编号（F231 不跟随 ⇒ F256 短名磁盘重锚定）：提名身份不变，预算连续 [2,2,2,0]（对抗审查 E5b）', () => {
    const dirs = Array.from({ length: 10 }, (_, i) => `specs/${401 + i}-fix-chain-bug`);
    const root = stageRoot([dirs[0]]);
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...toolUseWithReceipt('Write', { file_path: `${dirs[0]}/fix-report.md`, content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT('报告已写')]);
    const codes = runRounds(root, t, 'sid', 8, {
      between: (i) => {
        fs.renameSync(path.join(root, dirs[i]), path.join(root, dirs[i + 1]));
        return [TOOL_USE('Bash', { command: `cd . && git mv ${dirs[i]} ${dirs[i + 1]} && echo done` }), ASSISTANT_TEXT('重编')];
      },
    });
    assert.deepEqual(codes, [2, 2, 2, 0], `重编号链下第 4 轮必须自愈：${JSON.stringify(codes)}`);
    assert.equal(Object.keys(readState(root, 'sid').targets).length, 1, '提名身份稳定 ⇒ 单桶');
  });
});

describe('F291a · 会话属性与键的不可伪造性', () => {
  it('在途推迟预算是会话属性：三个目标共用 IN_FLIGHT_DEFER_LIMIT 次推迟（对抗审查 C-3：方案①下每目标各 3 次）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...nominate(TARGET_A)]);
    const IN_FLIGHT = { background_tasks: [{ id: 'bt1', status: 'running', description: '子代理在跑' }] };
    const exit0 = [];
    for (const target of [TARGET_A, TARGET_B, TARGET_C]) {
      if (target !== TARGET_A) append(t, nominate(target));
      // 不回灌反馈 ⇒ 放行只能经推迟门；推迟 exit 0 不回灌
      for (let i = 0; i < 4; i += 1) {
        const r = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', root], { input: JSON.stringify({ session_id: 'sid', transcript_path: t, stop_hook_active: false, ...IN_FLIGHT }), encoding: 'utf8' });
        if (r.status === 0) exit0.push(target);
      }
    }
    assert.equal(exit0.length, IN_FLIGHT_DEFER_LIMIT, `整个会话只能推迟 ${IN_FLIGHT_DEFER_LIMIT} 次，实际 ${exit0.length}（${exit0.join(',')}）`);
    assert.equal(readState(root, 'sid').inFlightDeferCount, IN_FLIGHT_DEFER_LIMIT);
  });

  it('sidechain 标记的非规范拼写（`specs/<垃圾>/../302-fix-other-bug`）折回 B 自己的桶，不撞 A（对抗审查 C-1）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [ASSISTANT_TEXT('主线程零提名'), ASSISTANT_TEXT('尾')]);
    fs.mkdirSync(stateDir(root), { recursive: true });
    const setMarker = (p) => {
      for (const f of fs.readdirSync(stateDir(root)).filter((f) => f.includes('.sidechain.'))) fs.rmSync(path.join(stateDir(root), f));
      io.writeSidechainMarker(root, { sessionId: 'sid', agentId: 'ag1', agentType: 'general-purpose', fixLineIndex: 0, candidatePath: p });
    };
    setMarker(TARGET_A);
    assert.deepEqual(['a1', 'a2', 'a3'].map(() => stop(root, t, 'sid').status), [2, 2, 0], 'A 付满');
    setMarker('specs/1998154760/../302-fix-other-bug');
    const c1 = stop(root, t, 'sid');
    assert.equal(c1.status, 2, '非规范拼写被判的是 B ⇒ 记到 B 的桶 ⇒ 首次阻断');
    assert.equal(bucket(root, 'sid', TARGET_B).blockCount, 1);
    assert.equal(bucket(root, 'sid', TARGET_A).blockCount, BLOCK_LIMIT, 'A 的桶未被撞');
    const marker = io.listSidechainMarkers(root, 'sid')[0];
    assert.equal(marker.candidatePath, TARGET_B, '读侧已规范化');
  });

  it('--mode report 透传 targetDir / budgetKey；审计 verdict 事件在无目标轮次带 __no-target__', () => {
    const root = stageRoot();
    const t = writeTranscript(root, [SKILL_EXPANSION_LINE, ...nominate(TARGET_A)]);
    const r = spawnSync('node', [CLI, '--mode', 'report', '--project-root', root, '--transcript-path', t, '--session-id', 'sid'], { encoding: 'utf8' });
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.targetDir, TARGET_A);
    assert.equal(rep.budgetKey, TARGET_A);
    const t2 = writeTranscript(root, [SKILL_EXPANSION_LINE, ASSISTANT_TEXT('尚未建目录')]);
    assert.equal(stop(root, t2, 'sid2', 'q1').status, 2);
    const ev = verdictEvents(root).pop();
    assert.equal(ev.targetDir, null);
    assert.equal(ev.budgetKey, io.NO_TARGET_BUDGET_KEY);
  });
});
