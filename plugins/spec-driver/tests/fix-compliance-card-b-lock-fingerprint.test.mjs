/**
 * F288 · fix-compliance 卡 B（P0-A 残余：G1 状态文件并发安全 + 计数幂等 / G2 GATE 证据指纹路由半边 / 6b 放行佐证）。
 *
 * 红先行：新导出（mutateBlockState / acquireStateLock / computeEvidenceFingerprint / NON_BLOCK_*）缺席即 import 红；
 * 端到端序列（冻结暂停 2,2,0 且 blockCount 全程 0；有进展 2,2,2,0）在改动前的判定器上全部翻转。
 * 夹具驱动 judge CLI（门禁类纪律）；每个 exit 2 后按 harness 形态回灌一条 `Stop hook feedback:` 条目（放行佐证）。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  JUDGE_DIAGNOSTICS, BLOCK_LIMIT, NON_BLOCK_LIMIT, NON_BLOCK_ENTRY_LIMIT, EARLIEST_FIX_ENTRY_DEFER_LIMIT,
  computeEvidenceFingerprint, buildFeedbackText,
} from '../scripts/fix-compliance-judge.mjs';
import {
  mutateBlockState, acquireStateLock, releaseStateLock, loadBlockState, saveBlockState, STATE_STORAGE_DIAGNOSTICS, targetBudgetOf, NO_TARGET_BUDGET_KEY,
} from '../scripts/lib/fix-compliance-io.mjs';
import { countBlockFeedbackEntries, normalizeTranscriptEntry, HOOK_FEEDBACK_PREFIX } from '../scripts/lib/fix-compliance-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../scripts/fix-compliance-judge.mjs');
const IO_URL = pathToFileURL(path.resolve(HERE, '../scripts/lib/fix-compliance-io.mjs')).href;
const SCHEMA = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json'), 'utf8'));
const SCHEMA_ENUM = new Set(SCHEMA.properties.diagnostics.items.enum);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f288-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SKILL_EXPANSION_LINE = { type: 'user', message: { role: 'user', content: '<command-name>/spec-driver:spec-driver-fix</command-name>\nBase directory for this skill: /x/plugins/spec-driver/skills/spec-driver-fix' } };
const ASSISTANT_TEXT = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const TOOL_USE = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
const REPAIR_FIX_REPORT = '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n';
const FEEDBACK = (stderr) => ({ type: 'user', isMeta: true, userType: 'external', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[node fix-compliance-judge.mjs --mode hook]: ${stderr}` } });

let seq = 0;
function stageRoot() {
  const root = path.join(tmp, `root-${++seq}`);
  fs.mkdirSync(path.join(root, 'specs', '301-fix-sample-bug', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '301-fix-sample-bug', 'fix-report.md'), REPAIR_FIX_REPORT);
  return root;
}
function writeTranscript(root, lines) {
  const p = path.join(root, `t-${++seq}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}
/** 不合规（缺 verification-report + 委派）语料 */
function nonCompliantLines(extraAssistantEntries = 0) {
  const lines = [SKILL_EXPANSION_LINE, TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT })];
  for (let i = 0; i < extraAssistantEntries; i += 1) lines.push(ASSISTANT_TEXT(`填充 ${i}`));
  lines.push(ASSISTANT_TEXT('最后一条'));
  return lines;
}
function compliantLines() {
  return [
    SKILL_EXPANSION_LINE,
    TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }),
    TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码实现' }),
    TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '验证修复结果' }),
    ASSISTANT_TEXT('尾'),
  ];
}
function payloadFor(root, transcriptPath, sessionId, extra = {}) {
  return { session_id: sessionId, transcript_path: transcriptPath, stop_hook_active: false, ...extra };
}
function runHookRaw(root, payload, env = {}) {
  const res = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', root], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: res.status, stderr: res.stderr, stdout: res.stdout };
}
/** 跑一次 Stop；exit 2 时按 harness 形态回灌反馈条目（放行佐证）——feedback:false 关闭 */
function stop(root, transcriptPath, sessionId, { promptId, feedback = true, env = {}, extra = {} } = {}) {
  const payload = payloadFor(root, transcriptPath, sessionId, { ...(promptId === undefined ? {} : { prompt_id: promptId }), ...extra });
  const r = runHookRaw(root, payload, env);
  if (feedback && r.status === 2) fs.appendFileSync(transcriptPath, `${JSON.stringify(FEEDBACK(r.stderr))}\n`);
  return r;
}
function readEvents(root) {
  const dir = path.join(root, '.specify', 'runs');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      out.push(JSON.parse(line));
    }
  }
  return out;
}
const verdictEvents = (root) => readEvents(root).filter((e) => e.eventType === 'fix-compliance-verdict');
const runSummaries = (root) => readEvents(root).filter((e) => e.eventType === 'workflow-run-summary');
/**
 * F291a（方案①′）：状态仍是每会话一份 `<sid>.json`，阻断预算在 `targets[桶键]` 分桶（桶键 = 规范化的目标目录字面量）；
 * 本文件 judge 驱动的用例目标恒为 FIXTURE_TARGET，直接调 io 原语的用例也把桶落在同一键上。
 */
const FIXTURE_TARGET = 'specs/301-fix-sample-bug';
/** 读会话状态并把某目标桶摊平到顶层（blockCount / degradedRecorded / nonBlockStopCount / lastCountedFingerprint）；inFlightDeferCount 取顶层 */
function readState(root, sessionId, targetKey = FIXTURE_TARGET) {
  const p = path.join(root, '.specify', 'runs', '.fix-compliance-state', `${sessionId}.json`);
  if (!fs.existsSync(p)) return null;
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  const bucket = (st.targets || {})[targetKey] || {};
  return {
    sessionId: st.sessionId, inFlightDeferCount: st.inFlightDeferCount ?? 0, targets: st.targets || {},
    blockCount: bucket.blockCount ?? 0, degradedRecorded: bucket.degradedRecorded === true,
    nonBlockStopCount: bucket.nonBlockStopCount ?? 0, lastCountedFingerprint: bucket.lastCountedFingerprint ?? null,
  };
}
/** 预置状态文件：桶字段落 targets[targetKey]，inFlightDeferCount 落顶层 */
function presetState(stateDir, sessionId, { inFlightDeferCount, ...bucket }, targetKey = FIXTURE_TARGET) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, `${sessionId}.json`), `${JSON.stringify({ sessionId, ...(inFlightDeferCount === undefined ? {} : { inFlightDeferCount }), targets: { [targetKey]: bucket } })}\n`);
}
/** F291a：原语层用例对夹具目标桶做 +1（状态顶层不再有 blockCount） */
const bump = (st) => ({ ...st, targets: { ...(st.targets || {}), [FIXTURE_TARGET]: { ...targetBudgetOf(st, FIXTURE_TARGET), blockCount: targetBudgetOf(st, FIXTURE_TARGET).blockCount + 1 } } });
const BUMP_SRC = "(st) => { const k = 'specs/301-fix-sample-bug'; const b = (st.targets || {})[k] || {}; return { next: { ...st, targets: { ...(st.targets || {}), [k]: { ...b, blockCount: (b.blockCount || 0) + 1 } } } }; }";
const lockPath = (root, sessionId) => path.join(root, '.specify', 'runs', '.fix-compliance-state', `${sessionId}.lock`);
const HEX64 = /^[0-9a-f]{64}$/;

// ════════════════════════════════════════════
// G1 · 状态锁 / 锁内 RMW / 计数幂等
// ════════════════════════════════════════════
describe('F288 G1 · mutateBlockState 原语', () => {
  it('T1-U1 锁内 RMW：写回后锁文件被持有者 unlink；next=null 不写盘；lastCountedFingerprint 字段持久化且非法值归 null', () => {
    const root = stageRoot();
    const bucket = (st) => targetBudgetOf(st, FIXTURE_TARGET);
    const r1 = mutateBlockState(root, 's', (st) => ({ next: { ...st, targets: { ...st.targets, [FIXTURE_TARGET]: { ...bucket(st), blockCount: bucket(st).blockCount + 1, lastCountedFingerprint: 'a'.repeat(64) } } }, result: 'w' }));
    assert.equal(r1.ok, true); assert.equal(r1.written, true); assert.equal(r1.lockUnavailable, false); assert.equal(r1.result, 'w');
    assert.equal(bucket(r1.state).blockCount, 1); assert.equal(bucket(r1.state).lastCountedFingerprint, 'a'.repeat(64));
    assert.equal(fs.existsSync(lockPath(root, 's')), false, '锁文件必须由持有者释放');
    const r2 = mutateBlockState(root, 's', (st) => ({ next: null, result: bucket(st).blockCount }));
    assert.equal(r2.written, false); assert.equal(r2.result, 1);
    assert.equal(bucket(loadBlockState(root, 's')).lastCountedFingerprint, 'a'.repeat(64));
    saveBlockState(root, 's', { targets: { [FIXTURE_TARGET]: { blockCount: 1, lastCountedFingerprint: 'not-hex' } } });
    assert.equal(bucket(loadBlockState(root, 's')).lastCountedFingerprint, null, '非法指纹归 null（向后兼容口径）');
    assert.equal(bucket(loadBlockState(root, 'never')).lastCountedFingerprint, null, '缺省 null');
  });

  it('T1-U2 陈旧锁接管（pid 不存活 / 墙钟超 300s）落 state-lock-taken-over；活锁（pid 存活且新鲜）有界重试后降级为无锁 RMW + state-lock-unavailable，裁决数据照样写回', () => {
    const root = stageRoot();
    fs.mkdirSync(path.dirname(lockPath(root, 's')), { recursive: true });
    fs.writeFileSync(lockPath(root, 's'), JSON.stringify({ lockId: 'x', pid: 2147483000, startedAt: Date.now() }));
    const stale = mutateBlockState(root, 's', (st) => ({ next: bump(st) }));
    assert.equal(stale.lockUnavailable, false);
    assert.ok(stale.diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver));
    assert.equal(targetBudgetOf(stale.state, FIXTURE_TARGET).blockCount, 1);
    fs.writeFileSync(lockPath(root, 's'), JSON.stringify({ lockId: 'y', pid: process.pid, startedAt: Date.now() - 301 * 1000 }));
    const old = mutateBlockState(root, 's', (st) => ({ next: bump(st) }));
    assert.ok(old.diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver), '墙钟兜底');
    assert.equal(targetBudgetOf(old.state, FIXTURE_TARGET).blockCount, 2);
    fs.writeFileSync(lockPath(root, 's'), JSON.stringify({ lockId: 'z', pid: process.pid, startedAt: Date.now() }));
    const t0 = Date.now();
    const live = mutateBlockState(root, 's', (st) => ({ next: bump(st) }));
    const ms = Date.now() - t0;
    assert.equal(live.lockUnavailable, true);
    assert.ok(live.diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockUnavailable));
    assert.equal(live.ok, true); assert.equal(targetBudgetOf(live.state, FIXTURE_TARGET).blockCount, 3, '锁不可得 ⇒ 无锁 RMW（= 改动前行为），不跳过');
    assert.ok(ms >= 400 && ms < 5000, `有界重试 ≈480ms（实测 ${ms}ms）`);
    assert.equal(JSON.parse(fs.readFileSync(lockPath(root, 's'), 'utf8')).lockId, 'z', '别人的活锁不得被 unlink');
    const foreign = { acquired: true, lockPath: lockPath(root, 's'), lockId: 'not-z' };
    releaseStateLock(foreign);
    assert.equal(fs.existsSync(lockPath(root, 's')), true, 'lockId 不一致 ⇒ 不 unlink');
    // 对抗复审 W-4：startedAt 在未来（伪造）⇒ 墙钟兜底不得被绕掉；pid 无权探测（pid 1）⇒ 不算存活
    fs.writeFileSync(lockPath(root, 's'), JSON.stringify({ lockId: 'f', pid: process.pid, startedAt: Date.now() + 1e15 }));
    const future = mutateBlockState(root, 's', (st) => ({ next: bump(st) }));
    assert.equal(future.lockUnavailable, false, '未来 startedAt 的锁必须被接管');
    assert.ok(future.diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver));
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      fs.writeFileSync(lockPath(root, 's'), JSON.stringify({ lockId: 'g', pid: 1, startedAt: Date.now() }));
      const eperm = mutateBlockState(root, 's', (st) => ({ next: bump(st) }));
      assert.equal(eperm.lockUnavailable, false, 'pid 1（EPERM）的锁必须被接管');
      assert.ok(eperm.diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver));
    }
  });

  it('T1-U3 mutator 抛错 ⇒ ok:false + mutatorError，不向外抛（顶层 catch 不得把它兜成放行）', () => {
    const root = stageRoot();
    const r = mutateBlockState(root, 's', () => { throw new Error('boom'); });
    assert.equal(r.ok, false); assert.ok(r.mutatorError instanceof Error);
    assert.equal(fs.existsSync(lockPath(root, 's')), false);
  });

  it('T1-C1 原语层：8 进程并发无条件 +1 ⇒ 最终 8、丢更新 0（加锁臂）', async () => {
    const root = stageRoot();
    const script = `import { mutateBlockState } from ${JSON.stringify(IO_URL)};\nconst r = mutateBlockState(process.argv[2], 'c1', ${BUMP_SRC});\nprocess.stdout.write(JSON.stringify({ ok: r.ok, lockUnavailable: r.lockUnavailable }));`;
    const scriptPath = path.join(root, 'inc.mjs');
    fs.writeFileSync(scriptPath, script);
    const children = Array.from({ length: 8 }, () => new Promise((resolve) => {
      const child = spawn('node', [scriptPath, root], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP: path.join(root, 'tmp-override') } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve({ code, out }));
    }));
    const results = await Promise.all(children);
    for (const r of results) assert.equal(r.code, 0, r.out);
    const parsed = results.map((r) => JSON.parse(r.out));
    assert.ok(parsed.every((p) => p.ok), JSON.stringify(parsed));
    assert.equal(targetBudgetOf(loadBlockState(root, 'c1'), FIXTURE_TARGET).blockCount, 8, '丢更新必须为 0');
    assert.equal(parsed.filter((p) => p.lockUnavailable).length, 0, '480ms 内 8 路竞争不应耗尽重试');
  });

  it('T1-C5 预置陈旧锁（死 pid）+ 8 进程并发接管 ⇒ 最终 8、丢更新 0、接管有界（对抗复审 B-W1 / verify W2：闭合「陈旧锁 + 多进程」结构缺口）', async () => {
    const root = stageRoot();
    // 预置一把「死 pid」陈旧锁：pidAlive(2147483000)=false ⇒ 必被接管；8 进程从"锁已存在且陈旧"起跑（非从零竞争新锁）
    fs.mkdirSync(path.dirname(lockPath(root, 'c5')), { recursive: true });
    fs.writeFileSync(lockPath(root, 'c5'), JSON.stringify({ lockId: 'stale', pid: 2147483000, startedAt: Date.now() }));
    const script = `import { mutateBlockState } from ${JSON.stringify(IO_URL)};\nimport { STATE_STORAGE_DIAGNOSTICS } from ${JSON.stringify(IO_URL)};\nconst r = mutateBlockState(process.argv[2], 'c5', ${BUMP_SRC});\nprocess.stdout.write(JSON.stringify({ ok: r.ok, lockUnavailable: r.lockUnavailable, tookOver: (r.diagnostics||[]).includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver) }));`;
    const scriptPath = path.join(root, 'inc-c5.mjs');
    fs.writeFileSync(scriptPath, script);
    const children = Array.from({ length: 8 }, () => new Promise((resolve) => {
      const child = spawn('node', [scriptPath, root], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP: path.join(root, 'tmp-override') } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve({ code, out }));
    }));
    const results = await Promise.all(children);
    for (const r of results) assert.equal(r.code, 0, r.out);
    const parsed = results.map((r) => JSON.parse(r.out));
    assert.ok(parsed.every((p) => p.ok), JSON.stringify(parsed));
    // 核心断言：陈旧锁被接管后，8 路各 +1 无一丢失（裸 unlink 接管 = 活锁被误删则会丢更新；此为回归地板）
    assert.equal(targetBudgetOf(loadBlockState(root, 'c5'), FIXTURE_TARGET).blockCount, 8, '陈旧锁并发接管下丢更新必须为 0');
    // 陈旧锁只应被接管有限次（不因每进程各接管一次而抖动成 8 次）——至少 1 次、且残留 stale 副本被清理不影响新锁
    assert.ok(parsed.some((p) => p.tookOver), '至少一个进程落 state-lock-taken-over');
    assert.equal(fs.existsSync(lockPath(root, 'c5')), false, '收尾锁文件已释放（无残留活锁）');
  });
});

  it('T1-C6 确定性接管身份竞态（F290，闭合 verify W2 / M1-c）：A 读到陈旧锁后被 trace 延迟，窗口内 B 已接管并持有活锁 ⇒ A 的 rename 经身份核对 rename 回、等待 B 释放后再取锁 ⇒ 最终 2、丢更新 0（裸 unlink 接管会删掉 B 的活锁 ⇒ 最终 1）', async () => {
    const root = stageRoot();
    fs.mkdirSync(path.dirname(lockPath(root, 'c6')), { recursive: true });
    fs.writeFileSync(lockPath(root, 'c6'), JSON.stringify({ lockId: 'stale', pid: 2147483000, startedAt: Date.now() }));
    const script = `import { mutateBlockState } from ${JSON.stringify(IO_URL)};\nconst hold = Number(process.argv[3] || 0);\nconst r = mutateBlockState(process.argv[2], 'c6', (st) => { if (hold > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, hold); return (${BUMP_SRC})(st); });\nprocess.stdout.write(JSON.stringify({ ok: r.ok, lockUnavailable: r.lockUnavailable, diagnostics: r.diagnostics }));`;
    const scriptPath = path.join(root, 'inc-c6.mjs');
    fs.writeFileSync(scriptPath, script);
    const run = (holdMs, env) => new Promise((resolve) => {
      const child = spawn('node', [scriptPath, root, String(holdMs)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP: path.join(root, 'tmp-override'), ...env } });
      let out = ''; child.stdout.on('data', (d) => { out += d; }); child.on('close', (code) => resolve({ code, out }));
    });
    // A：读到陈旧 holder 后在 rename 前被延迟 150ms；B：立即接管并在 mutator 里持锁 300ms（150 < 300 < 150+480 重试预算）
    const [a, b] = await Promise.all([
      run(0, { SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS: '150' }),
      run(300, {}),
    ]);
    for (const r of [a, b]) assert.equal(r.code, 0, r.out);
    const pa = JSON.parse(a.out); const pb = JSON.parse(b.out);
    assert.ok(pa.ok && pb.ok);
    assert.equal(targetBudgetOf(loadBlockState(root, 'c6'), FIXTURE_TARGET).blockCount, 2, '身份核对必须防止 A 删掉 B 的活锁：丢更新 = 0');
    assert.equal(pa.lockUnavailable, false, 'A 应在 B 释放后取到锁（不该耗尽重试降级）');
    assert.equal(fs.existsSync(lockPath(root, 'c6')), false, '收尾锁已释放');
  });

// ════════════════════════════════════════════
// G2 · 指纹与路由
// ════════════════════════════════════════════
describe('F288 G2 · computeEvidenceFingerprint / 常量不变量 / 合同', () => {
  it('T2-U1 四分量：prompt_id 缺席 ⇒ null；缺失集合排序不敏感；latestFixLineIndex 变 ⇒ 变；earliest 不是输入（R-5 方向钉）', () => {
    const base = { promptId: 'p1', missing: ['b', 'a'], ledgerDelegationCount: 0, latestFixLineIndex: 3 };
    const fp = computeEvidenceFingerprint(base);
    assert.match(fp, HEX64);
    assert.equal(computeEvidenceFingerprint({ ...base, missing: ['a', 'b'] }), fp, '集合序无关');
    assert.notEqual(computeEvidenceFingerprint({ ...base, latestFixLineIndex: 4 }), fp);
    assert.notEqual(computeEvidenceFingerprint({ ...base, ledgerDelegationCount: 1 }), fp);
    assert.notEqual(computeEvidenceFingerprint({ ...base, promptId: 'p2' }), fp);
    assert.equal(computeEvidenceFingerprint({ ...base, earliestFixLineIndex: 99 }), fp, 'earliest 不参与');
    for (const bad of [undefined, null, '', 42]) assert.equal(computeEvidenceFingerprint({ ...base, promptId: bad }), null);
  });

  it('T2-U2 不变量：NON_BLOCK_LIMIT >= BLOCK_LIMIT（放行地板不变）且 NON_BLOCK_ENTRY_LIMIT == 闸门三；五个新码已入 JUDGE 表（不可见）且 ⊆ schema enum', () => {
    assert.ok(NON_BLOCK_LIMIT >= BLOCK_LIMIT);
    assert.equal(NON_BLOCK_LIMIT, BLOCK_LIMIT);
    assert.equal(NON_BLOCK_ENTRY_LIMIT, EARLIEST_FIX_ENTRY_DEFER_LIMIT);
    for (const key of ['gateFingerprintNoProgress', 'gateFingerprintPartial', 'nonblockLimitExhausted', 'nonblockBackstopExhausted', 'stateBudgetUncorroborated']) {
      assert.equal(JUDGE_DIAGNOSTICS[key].userFacing, false, key);
      assert.ok(SCHEMA_ENUM.has(JUDGE_DIAGNOSTICS[key].code), JUDGE_DIAGNOSTICS[key].code);
    }
    for (const code of Object.values(STATE_STORAGE_DIAGNOSTICS)) assert.ok(SCHEMA_ENUM.has(code), code);
  });

  it('T2-U3 countBlockFeedbackEntries：只数 latest 窗口后、role user、单文本块、前缀起头且含 [FIX-COMPLIANCE] 的条目', () => {
    const entries = [
      { type: 'user', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[x]: [FIX-COMPLIANCE] 窗口前` } },
      SKILL_EXPANSION_LINE,
      { type: 'user', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[x]: [FIX-COMPLIANCE] 阻断` } },
      { type: 'user', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[x]: [FIX-COMPLIANCE][STORAGE-UNAVAILABLE] 存储不可用阻断` } },
      { type: 'user', message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[x]: [OTHER-HOOK] 别的 hook` } },
      ASSISTANT_TEXT(`${HOOK_FEEDBACK_PREFIX}\n[x]: [FIX-COMPLIANCE] assistant 侧伪造`),
      { type: 'user', message: { role: 'user', content: `前缀不在 0 位 ${HOOK_FEEDBACK_PREFIX} [FIX-COMPLIANCE]` } },
    ].map((raw, i) => normalizeTranscriptEntry(raw, i, false));
    assert.equal(countBlockFeedbackEntries(entries, 1), 2);
    assert.equal(countBlockFeedbackEntries(entries, null), 0, '基线缺席 ⇒ 0（不得照抄 -1 全量）');
  });
});

describe('F288 G2 · 端到端序列（指纹路由）', () => {
  it('T2-E1 冻结暂停（同 prompt_id、同缺失集）：exit 2,2,0；blockCount 全程 0；nonBlockStopCount 1→2→2；终态 failed 且 blockCount 为 number 0；审计 degraded true + nonblock-limit-exhausted + gate-fingerprint-no-progress', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const runs = [1, 2, 3].map(() => stop(root, t, 'frozen', { promptId: 'P' }));
    assert.deepEqual(runs.map((r) => r.status), [2, 2, 0], runs.map((r) => r.stderr).join('\n---\n'));
    assert.ok(runs[0].stderr.startsWith('[FIX-COMPLIANCE] '), runs[0].stderr);
    assert.ok(runs[2].stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), runs[2].stderr);
    const st = readState(root, 'frozen');
    assert.equal(st.blockCount, 0, '无进展全程不计 blockCount');
    assert.equal(st.nonBlockStopCount, 2);
    assert.match(st.lastCountedFingerprint, HEX64, '写回纪律：nonBlock 分支必须写回指纹');
    assert.equal(st.degradedRecorded, true);
    const evs = verdictEvents(root);
    assert.deepEqual(evs.map((e) => e.blockCount), [0, 0, 0]);
    assert.deepEqual(evs.map((e) => e.degraded), [false, false, true]);
    assert.ok(evs[0].diagnostics.includes('gate-fingerprint-no-progress'));
    assert.ok(evs[2].diagnostics.includes('nonblock-limit-exhausted') && evs[2].diagnostics.includes('gate-fingerprint-no-progress'), JSON.stringify(evs[2].diagnostics));
    const summaries = runSummaries(root);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].result, 'failed');
    assert.equal(typeof summaries[0].complianceVerdict.blockCount, 'number', 'R2-11：键必须存在且为 number');
    assert.equal(summaries[0].complianceVerdict.blockCount, 0);
    assert.equal(summaries[0].complianceVerdict.degraded, true);
    // 误伤面钉（R2-5）：首次 exit 2 的 stderr 含 missing 逐项动作行
    const expectedText = buildFeedbackText(evs[0].missing, { diagnostics: [] });
    for (const line of expectedText.split('\n').slice(0, 2)) assert.ok(runs[0].stderr.includes(line), `首次 exit 2 缺动作行：${line}`);
    // 第 4 次：终态幂等（已记录且账本里确有 failed 记录）⇒ 不再新增 summary
    const r4 = stop(root, t, 'frozen', { promptId: 'P' });
    assert.equal(r4.status, 0);
    assert.equal(runSummaries(root).length, 1);
  });

  it('T2-E2 有进展（prompt_id 每轮变）：exit 2(nb=1),2(b=1),2(b=2),0；blockCount 达上限触发 releaseDegraded（证明 routeBlock 可达、指纹已写回）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const seqCodes = ['P1', 'P2', 'P3', 'P4'].map((p) => stop(root, t, 'progress', { promptId: p }).status);
    assert.deepEqual(seqCodes, [2, 2, 2, 0]);
    const st = readState(root, 'progress');
    assert.equal(st.blockCount, 2); assert.equal(st.nonBlockStopCount, 1);
    const evs = verdictEvents(root);
    assert.deepEqual(evs.map((e) => e.blockCount), [0, 1, 2, 2]);
    assert.ok(!evs[1].diagnostics.includes('gate-fingerprint-no-progress'), '有进展不打无进展码');
    assert.ok(!evs[3].diagnostics.includes('nonblock-limit-exhausted'), 'blockCount 路径的放行不带 nonblock 触发码');
  });

  it('T2-E3 prompt_id 缺席 ⇒ 指纹路由不生效：exit 2,2,0 + blockCount 1,2 + gate-fingerprint-partial（= 改动前 routeBlock 行为）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const seqCodes = [1, 2, 3].map(() => stop(root, t, 'partial').status);
    assert.deepEqual(seqCodes, [2, 2, 0]);
    const st = readState(root, 'partial');
    assert.equal(st.blockCount, 2); assert.equal(st.nonBlockStopCount, 0);
    assert.equal(st.lastCountedFingerprint, null, 'prompt_id 缺席不写指纹');
    const evs = verdictEvents(root);
    assert.ok(evs.every((e) => e.diagnostics.includes('gate-fingerprint-partial')), JSON.stringify(evs.map((e) => e.diagnostics)));
    assert.deepEqual(evs.map((e) => e.blockCount), [1, 2, 2]);
  });

  it('T2-E4 warn 档 + 无进展 ⇒ exit 0（F208 三档语义不被推翻）且不写回指纹 / 不建状态文件', () => {
    const root = stageRoot();
    fs.writeFileSync(path.join(root, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    const t = writeTranscript(root, nonCompliantLines());
    for (let i = 0; i < 3; i += 1) {
      const r = stop(root, t, 'warn', { promptId: 'P' });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE][WARN] '), r.stderr);
    }
    assert.equal(readState(root, 'warn'), null, 'warn 档零状态写入');
  });

  it('T2-E5 最短完全绕过持平：无进展 2 次 exit 2 后第 3 次放行；不同桶交替（P,P,Q,Q）也不更松', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const codes = ['P', 'P', 'Q', 'Q', 'Q'].map((p) => stop(root, t, 'alt', { promptId: p }).status);
    // P(nb=1) P(nb=2) Q(进展 b=1) Q(无进展、nb 已达上限、佐证 3 ⇒ 放行) Q(已放行，终态幂等) —— 精确序列钉住（对抗复审 I-3）
    assert.deepEqual(codes, [2, 2, 2, 0, 0]);
  });

  it('T2-E6 存储不可用（两级目录占位）+ nonBlock 路径 ⇒ 首次 exit 2 + state-storage-unavailable（G1 处置 7 方向保留，不回退成"写不进就放行"）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const tmpOverride = path.join(root, 'tmp-override');
    // F291a（方案①′）：状态文件仍按会话 `<sid>.json`——占位放在会话文件路径上即命中判定器的写路径
    fs.mkdirSync(path.join(root, '.specify', 'runs', '.fix-compliance-state', 'nb-su.json'), { recursive: true });
    fs.mkdirSync(path.join(tmpOverride, 'spec-driver-fix-compliance', 'nb-su.json'), { recursive: true });
    const r = stop(root, t, 'nb-su', { promptId: 'P', env: { SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP: tmpOverride } });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('[FIX-COMPLIANCE][STORAGE-UNAVAILABLE]'), r.stderr);
    const evs = verdictEvents(root);
    assert.ok(evs[evs.length - 1].diagnostics.includes('state-storage-unavailable'), JSON.stringify(evs));
  });

  it('T2-E7 420 backstop 不是放行腿（对抗复审 C-1）：状态目录被 rm -rf、锚点后 assistant entry ≥ 420、零回灌 ⇒ 仍 exit 2 + state-budget-uncorroborated（被判方自产 entry 换不来放行）；两条真实回灌后才放行，触发码 nonblock-backstop-exhausted、首行不说「已达阻断上限」', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines(NON_BLOCK_ENTRY_LIMIT + 5));
    fs.rmSync(path.join(root, '.specify', 'runs', '.fix-compliance-state'), { recursive: true, force: true });
    const r0 = stop(root, t, 'backstop', { promptId: 'P', feedback: false });
    assert.equal(r0.status, 2, r0.stderr);
    assert.ok(verdictEvents(root).pop().diagnostics.includes('state-budget-uncorroborated'));
    assert.equal(runSummaries(root).length, 0, '零往返不得放行');
    const runs = ['P', 'P', 'P'].map((p) => stop(root, t, 'backstop', { promptId: p }));
    assert.deepEqual(runs.map((x) => x.status), [2, 2, 0], runs.map((x) => x.stderr).join('\n---\n'));
    const ev = verdictEvents(root).pop();
    assert.ok(ev.diagnostics.includes('nonblock-backstop-exhausted'), JSON.stringify(ev.diagnostics));
    assert.equal(ev.degraded, true);
    assert.equal(ev.blockCount, 0);
    assert.ok(!runs[2].stderr.includes('已达阻断上限'), runs[2].stderr);
    assert.ok(runs[2].stderr.includes(String(NON_BLOCK_ENTRY_LIMIT)), runs[2].stderr);
    assert.equal(typeof runSummaries(root)[0].complianceVerdict.blockCount, 'number');
  });

  it('T2-E8 指纹锚点 = 最晚 fix 展开（R-5 接线钉，对抗复审 W-3）：两次 fix 展开的 transcript 写回的 lastCountedFingerprint 等于按 latest 计算的指纹、不等于按 earliest 计算的指纹', () => {
    const root = stageRoot();
    const lines = [SKILL_EXPANSION_LINE, TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }), ASSISTANT_TEXT('中'), SKILL_EXPANSION_LINE, ASSISTANT_TEXT('尾')];
    const t = writeTranscript(root, lines);
    const r = stop(root, t, 'anchor', { promptId: 'P', feedback: false });
    assert.equal(r.status, 2, r.stderr);
    const report = spawnSync('node', [CLI, '--mode', 'report', '--project-root', root, '--transcript-path', t], { encoding: 'utf8' });
    const missing = JSON.parse(report.stdout).missing;
    // F291a：最晚 fix 展开之后的窗口里没有提名 ⇒ 本轮记账到无目标桶（早先窗口的提名不跨展开续用）
    const st = readState(root, 'anchor', NO_TARGET_BUDGET_KEY);
    const latest = computeEvidenceFingerprint({ promptId: 'P', missing, ledgerDelegationCount: 0, latestFixLineIndex: 3 });
    const earliest = computeEvidenceFingerprint({ promptId: 'P', missing, ledgerDelegationCount: 0, latestFixLineIndex: 0 });
    assert.equal(st.lastCountedFingerprint, latest);
    assert.notEqual(st.lastCountedFingerprint, earliest);
  });

  it('T2-E9 nonBlock 写回不丢既有字段（M1-d 单进程钉，对抗复审 I-5）：预置 inFlightDeferCount:1 经一次无进展 Stop 后仍为 1', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
    presetState(stateDir, 'keep', { blockCount: 0, degradedRecorded: false, inFlightDeferCount: 1 });
    assert.equal(stop(root, t, 'keep', { promptId: 'P' }).status, 2);
    const st = readState(root, 'keep');
    assert.equal(st.inFlightDeferCount, 1);
    assert.equal(st.nonBlockStopCount, 1);
  });

  it('T2-E10 mutator 抛错（判定器自身 bug）⇒ exit 2 + internal-error、不冒充 STORAGE-UNAVAILABLE（对抗复审 W-2）；佐证 ≥ 2 后降级放行仍带 internal-error', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const src = fs.readFileSync(CLI, 'utf8');
    const marker = '    const last = bucket.lastCountedFingerprint;';
    assert.ok(src.includes(marker), '注入锚点缺席');
    const patched = path.join(path.dirname(CLI), '.f288-t2e10-judge.tmp.mjs');
    fs.writeFileSync(patched, src.split(marker).join(`    throw new Error('T2-E10 injected');\n${marker}`));
    try {
      const run = (feedback) => {
        const payload = payloadFor(root, t, 'bug', { prompt_id: 'P' });
        const res = spawnSync('node', [patched, '--mode', 'hook', '--project-root', root], { input: JSON.stringify(payload), encoding: 'utf8' });
        if (feedback && res.status === 2) fs.appendFileSync(t, `${JSON.stringify(FEEDBACK(res.stderr))}\n`);
        return res;
      };
      const r1 = run(true);
      assert.equal(r1.status, 2, r1.stderr);
      assert.ok(r1.stderr.startsWith('[FIX-COMPLIANCE] '), r1.stderr);
      assert.ok(!r1.stderr.includes('STORAGE-UNAVAILABLE') && !r1.stderr.includes('不可写'), r1.stderr);
      const ev1 = verdictEvents(root).pop();
      assert.ok(ev1.diagnostics.includes('internal-error') && !ev1.diagnostics.includes('state-storage-unavailable'), JSON.stringify(ev1.diagnostics));
      assert.equal(ev1.blockCount, null);
      assert.equal(run(true).status, 2);
      const r3 = run(true);
      assert.equal(r3.status, 0, r3.stderr);
      const ev3 = verdictEvents(root).pop();
      assert.ok(ev3.degraded && ev3.diagnostics.includes('internal-error'), JSON.stringify(ev3.diagnostics));
    } finally {
      fs.rmSync(patched, { force: true });
    }
  });
});

// ════════════════════════════════════════════
// 6b · 放行佐证（状态文件不可伪造性）
// ════════════════════════════════════════════
describe('F288 6b · 预置状态文件换不来放行', () => {
  it('T6-E1 预置 {blockCount:2, nonBlockStopCount:2, degradedRecorded:true} 且 transcript 零回灌 ⇒ 首个 Stop exit 2 + state-budget-uncorroborated；两条真实回灌后才放行，且终态记录仍被写出（预置标记抑制不了终态）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
    presetState(stateDir, 'forged', { blockCount: 2, nonBlockStopCount: 2, degradedRecorded: true });
    for (const promptId of ['P', 'Q']) {
      const r = stop(root, t, 'forged', { promptId });
      assert.equal(r.status, 2, `预置计数不得兑换放行：${r.stderr}`);
      const ev = verdictEvents(root).pop();
      assert.ok(ev.diagnostics.includes('state-budget-uncorroborated'), JSON.stringify(ev.diagnostics));
    }
    assert.equal(runSummaries(root).length, 0, '未放行前不得有 failed 终态');
    // 两条真实回灌（上面两次 exit 2）已在 transcript ⇒ 第 3 次放行，且 failed 终态被写出（账本里此前没有）
    const r3 = stop(root, t, 'forged', { promptId: 'R' });
    assert.equal(r3.status, 0, r3.stderr);
    assert.equal(runSummaries(root).length, 1, '预置 degradedRecorded:true 抑制不了终态');
    assert.equal(runSummaries(root)[0].result, 'failed');
  });

  it('T6-E2 prompt_id 缺席路径同样受佐证闸门约束：预置 blockCount:2 ⇒ exit 2 而非 0-trip 放行', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
    presetState(stateDir, 'forged2', { blockCount: 2, degradedRecorded: false });
    const r1 = stop(root, t, 'forged2');
    assert.equal(r1.status, 2, r1.stderr);
    assert.ok(verdictEvents(root).pop().diagnostics.includes('state-budget-uncorroborated'));
    const r2 = stop(root, t, 'forged2');
    assert.equal(r2.status, 2);
    assert.equal(stop(root, t, 'forged2').status, 0, '2 条真实回灌后放行');
  });

  it('T6-E3 无回灌（feedback:false，模拟 harness 未回灌 / 懒刷盘）⇒ 达上限也不放行（fail-closed；420 也不是放行腿，见 T2-E7）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const runs = [1, 2, 3, 4].map(() => stop(root, t, 'noharness', { promptId: 'P', feedback: false }));
    assert.deepEqual(runs.map((r) => r.status), [2, 2, 2, 2]);
    assert.ok(verdictEvents(root).pop().diagnostics.includes('state-budget-uncorroborated'));
    // 对抗复审 C-1（误伤面）：达上限但缺佐证 ⇒ stderr 明确告知在等回灌、指向 enforcement: warn（勿空烧预算）
    assert.ok(runs[3].stderr.includes('缺放行佐证') && runs[3].stderr.includes('enforcement: warn'), runs[3].stderr);
  });
});

// ════════════════════════════════════════════
// 并发 / 锁 / reset
// ════════════════════════════════════════════
describe('F288 G1 · 并发与锁的端到端', () => {
  it('T1-C2 同一 payload 的 2 个并发判定器（已有历史指纹 ⇒ 都是"有进展"）⇒ blockCount 增量恰 1（另一进程落无进展格，nonBlockStopCount +1）——5 轮', async () => {
    for (let round = 0; round < 5; round += 1) {
      const root = stageRoot();
      const t = writeTranscript(root, nonCompliantLines());
      const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
      presetState(stateDir, 'conc', { blockCount: 0, lastCountedFingerprint: 'f'.repeat(64) });
      const payload = JSON.stringify(payloadFor(root, t, 'conc', { prompt_id: 'P' }));
      const procs = [0, 1].map(() => new Promise((resolve) => {
        const child = spawn('node', [CLI, '--mode', 'hook', '--project-root', root], { stdio: ['pipe', 'ignore', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => resolve({ code, err }));
        child.stdin.end(payload);
      }));
      const results = await Promise.all(procs);
      assert.deepEqual(results.map((r) => r.code), [2, 2], results.map((r) => r.err).join('\n'));
      const st = readState(root, 'conc');
      assert.equal(st.blockCount, 1, `第 ${round + 1} 轮：blockCount 增量必须为 1（实得 ${st.blockCount}）`);
      assert.equal(st.nonBlockStopCount, 1, `第 ${round + 1} 轮：另一进程落无进展格`);
    }
  });

  it('T1-C3 合规 + 活锁 ⇒ exit 0 且状态文件被 reset（R2-9：reset 不需要互斥，锁不可得也生效）', () => {
    const root = stageRoot();
    const t = writeTranscript(root, compliantLines());
    fs.writeFileSync(path.join(root, 'specs', '301-fix-sample-bug', 'verification', 'verification-report.md'), '# 验证报告\n全部通过\n');
    const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
    presetState(stateDir, 'lockc', { blockCount: 1 });
    fs.writeFileSync(path.join(stateDir, 'lockc.lock'), JSON.stringify({ lockId: 'q', pid: process.pid, startedAt: Date.now() }));
    const r = stop(root, t, 'lockc', { promptId: 'P' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(stateDir, 'lockc.json')), false, '合规 reset 必须生效');
    assert.equal(fs.existsSync(path.join(stateDir, 'lockc.lock')), true, 'reset 不删别人的锁');
  });

  it('T1-E4 活锁下的不合规 Stop：裁决方向不变（exit 2）、计数照常推进、审计带 state-lock-unavailable', () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
    fs.mkdirSync(stateDir, { recursive: true });
    // F291a（方案①′）：锁仍按会话——预置活锁落在 `<sid>.lock` 即是判定器要抢的那把
    fs.writeFileSync(lockPath(root, 'lockb'), JSON.stringify({ lockId: 'q', pid: process.pid, startedAt: Date.now() }));
    const r = stop(root, t, 'lockb', { promptId: 'P' });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(readState(root, 'lockb').nonBlockStopCount, 1);
    assert.ok(verdictEvents(root).pop().diagnostics.includes('state-lock-unavailable'));
    assert.ok(!r.stderr.includes('state-lock-unavailable'), '锁码不进用户文案');
  });

  it('T1-C4 degradedRecorded 单写终态：2 个并发判定器（各自有进展）同时达上限且佐证已够 ⇒ 都放行、failed 终态恰 1 条（锁内 test-and-set 决定写者）', async () => {
    const root = stageRoot();
    const t = writeTranscript(root, nonCompliantLines());
    fs.appendFileSync(t, `${JSON.stringify(FEEDBACK('[FIX-COMPLIANCE] 1'))}\n${JSON.stringify(FEEDBACK('[FIX-COMPLIANCE] 2'))}\n`);
    const stateDir = path.join(root, '.specify', 'runs', '.fix-compliance-state');
    presetState(stateDir, 'term', { blockCount: 2, nonBlockStopCount: 0, lastCountedFingerprint: 'f'.repeat(64) });
    // 两个进程各带不同 prompt_id（都判「有进展」⇒ 都走 blockCount 达上限的放行）；同一 prompt_id 的第 2 个进程会落入
    // 无进展格（K-14 已登记），那条路径不到达终态写入。
    const procs = ['P', 'Q'].map((promptId) => new Promise((resolve) => {
      const child = spawn('node', [CLI, '--mode', 'hook', '--project-root', root], { stdio: ['pipe', 'ignore', 'pipe'] });
      child.on('close', (code) => resolve(code));
      child.stdin.end(JSON.stringify(payloadFor(root, t, 'term', { prompt_id: promptId })));
    }));
    const codes = await Promise.all(procs);
    assert.deepEqual(codes, [0, 0]);
    assert.equal(runSummaries(root).length, 1, '终态必须恰 1 条（锁内 test-and-set 决定写者；账本核对只在标记为真时补写缺失的记录）');
  });
});

describe('F288 · 源码守卫', () => {
  it('T-S1 judge 不再直接调用 loadBlockState / saveBlockState（4 条 RMW 全部经 mutateBlockState）；无 inFlightDeferCount = 0 默认值；routeNonBlock 死代码注释已改写', () => {
    const src = fs.readFileSync(CLI, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal((src.match(/\bloadBlockState\(/g) || []).length, 0);
    assert.equal((src.match(/\bsaveBlockState\(/g) || []).length, 0);
    assert.ok((src.match(/mutateBlockState\(/g) || []).length >= 3, '至少 defer / routeBlock / routeByFingerprint 三处');
    assert.equal(/inFlightDeferCount = 0/.test(src), false);
    const full = fs.readFileSync(CLI, 'utf8');
    assert.equal(/生产零接线/.test(full), false, 'G2 处置 4：不得留下与实现相反的注释');
    // 对抗复审 C-1：放行佐证谓词只认 harness 回灌，不得再引用 assistant entry 腿
    const corroborated = src.match(/function releaseCorroborated\([\s\S]*?\n\}/);
    assert.ok(corroborated, 'releaseCorroborated 缺席');
    assert.ok(!/NON_BLOCK_ENTRY_LIMIT|entryCount/.test(corroborated[0]), corroborated[0]);
  });
  it('T-S2 原子创建源码钉（F290，M1-b）：锁只经 staging + linkSync 原子创建，不得退回 openSync(wx)+写（空内容窗口）', () => {
    const io = fs.readFileSync(path.resolve(HERE, '../scripts/lib/fix-compliance-io.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(/fs\.linkSync\(stagingPath, lockPath\)/.test(io), '必须 linkSync(stagingPath, lockPath)');
    assert.ok(!/openSync\(lockPath, 'wx'\)/.test(io), '不得对 lockPath 直接 openSync wx（内容为空的窗口）');
    // trace 延迟 hook 只在 rename 之前、且只由环境变量驱动（生产不设 ⟹ 零行为）
    assert.ok(/SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS/.test(io));
    // 🔴 对抗复审 CRITICAL-1：此前只断言「变量名出现」，上限与一次性闭锁**零覆盖**（去掉 Math.min 全绿）。
    // 现钉三件：① 常量上限 ≤ 1000ms；② 睡眠经 Math.min(…, 常量) 夹取；③ 每次调用一次性闭锁。
    const capDecl = io.match(/const LOCK_TRACE_DELAY_MAX_MS = (\d+);/);
    assert.ok(capDecl, '缺 LOCK_TRACE_DELAY_MAX_MS 上限常量');
    assert.ok(Number(capDecl[1]) <= 1000, `trace 延迟上限须 ≤1000ms（现 ${capDecl[1]}）`);
    assert.ok(/sleepSync\(Math\.min\(traceDelay, LOCK_TRACE_DELAY_MAX_MS\)\)/.test(io), '睡眠必须经上限常量夹取');
    assert.ok(/let traceApplied = false;/.test(io) && /!traceApplied &&/.test(io) && /traceApplied = true;/.test(io), 'trace 延迟须每次 acquireStateLock 仅生效一次');
  });
});
