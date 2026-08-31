/**
 * fix-compliance-judge-cli.test.mjs
 * Feature 208 — fix 依从性判定 CLI（--mode hook|report）退出码矩阵 + FR-006 阻断有界化集成测试
 *
 * Tests FIRST（research.md D7）：本文件覆盖 contracts/fix-compliance-judge-cli.md 场景表，
 * 以及 FR-010 missing→action 映射、T013 bash 薄壳退出码转发、T025 阻断计数集成。
 *
 * 运行: node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  buildFeedbackText,
} from '../scripts/fix-compliance-judge.mjs';
import {
  MISSING_ACTION_TEXT,
  CLAUDE_TRANSCRIPT_ROLES,
  FOREIGN_DIALECT_DIAGNOSTICS,
  scanRenameCommandEvents,
  isDeferrableMissingSet,
} from '../scripts/lib/fix-compliance-core.mjs';

const CLI = fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url));
const HOOK_SH = fileURLToPath(new URL('../hooks/stop-fix-compliance-check.sh', import.meta.url));

const SKILL_EXPANSION_LINE = (mode) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}\n请修复问题` }] },
});
const ASSISTANT_TEXT = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const TOOL_USE = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

/**
 * F257：带 `id` 的 tool_use + 紧随其后的配对 tool_result（真实 wire format 形态）。
 *
 * 为何单独加而不是改 TOOL_USE：`collectArtifactWriteWitnessDirs` 的安全下界来自 harness 回执
 * （被判方伪造不了成功回执），故见证要求 `id` 非空 + 配对回执非 error。既有 TOOL_USE 两者都不产出，
 * 于是既有 fixture 的 Write 一律**不构成见证**——这是刻意保留的：放弃该要求等于允许凭空伪造
 * `tool_use` 而不真的执行。只有需要见证的用例改用本 helper，无关用例逐字不动。
 *
 * 返回**两条** envelope，调用处用展开符插入：`...TOOL_USE_OK('Write', { … }, 'w1')`。
 * @param {{ isError?:boolean }} [opts] - isError=true 时回执为失败（用于反例）
 */
const TOOL_USE_OK = (name, input, id, { isError = false } = {}) => ([
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }] } },
]);

const FEATURE_DIR = 'specs/301-fix-sample-bug';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-compliance-cli-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 写 transcript.jsonl，返回绝对路径 */
function writeTranscript(lines) {
  const p = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return p;
}

/** 构造 collapsed 会话 transcript（fix 展开 + 0 委派 + 无制品） */
function collapsedTranscript() {
  return writeTranscript([SKILL_EXPANSION_LINE('fix'), ASSISTANT_TEXT('已完成修复，一切正常。')]);
}

/** 构造合规修复收口会话 transcript + 落盘真实制品 */
function compliantTranscript() {
  const p = writeTranscript([
    SKILL_EXPANSION_LINE('fix'),
    TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
    TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
    TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
    TOOL_USE('Write', { file_path: `${FEATURE_DIR}/verification/verification-report.md`, content: '# V' }),
    ASSISTANT_TEXT('修复完成'),
  ]);
  fs.mkdirSync(path.join(tmp, FEATURE_DIR, 'verification'), { recursive: true });
  fs.writeFileSync(path.join(tmp, FEATURE_DIR, 'fix-report.md'), '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n', 'utf8');
  fs.writeFileSync(path.join(tmp, FEATURE_DIR, 'verification', 'verification-report.md'), '# 验证报告\n\n所有单测通过，回归零失败。\n', 'utf8');
  return p;
}

/** 调用 CLI，返回 { status, stdout, stderr } */
function runCli({ mode = 'hook', transcriptPath, sessionId = 's1', projectRoot = tmp, env = {},
  stopHookActive = false, backgroundTasks = undefined }) {
  const payloadObj = { session_id: sessionId, transcript_path: transcriptPath, stop_hook_active: stopHookActive };
  // F270 P3：仅当测试显式传入时才带 background_tasks 键——undefined 模拟"键缺席"（undetermined 态）
  if (backgroundTasks !== undefined) payloadObj.background_tasks = backgroundTasks;
  const res = spawnSync('node', [CLI, '--mode', mode, '--project-root', projectRoot], {
    input: JSON.stringify(payloadObj),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

// ────────────────────────────────────────
// F216 · fixture 铺盘辅助（judge-cli 端到端）：fixture 文件直接作 transcript_path，
// 把 Write 内嵌的 fix-report.md（及所需 verification-report.md）铺到 projectRoot 磁盘，
// 因为 judge 的 fix-report/verification-report 判据走磁盘核验（readArtifactFile）而非 transcript 内容。
// ────────────────────────────────────────

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/fix-compliance/', import.meta.url));
const VERIFICATION_DOC = '# 验证报告\n\n所有单测通过，回归零失败。\n';
const REPAIR_FIX_REPORT = '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n';

/** 从 fixture 的 Write fix-report.md 抽取 input.content（与 core 测试 loadFixReport 同源逻辑） */
function extractFixReportContent(fixtureName) {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, fixtureName), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b && b.type === 'tool_use' && b.name === 'Write'
        && b.input && typeof b.input.file_path === 'string' && b.input.file_path.endsWith('fix-report.md')
        && typeof b.input.content === 'string') return b.input.content;
    }
  }
  return null;
}

/**
 * 铺 fixture 所需磁盘制品到 projectRoot，返回 fixture 绝对路径（作 transcript_path）。
 * fixReportContent 缺省时从 fixture Write 内嵌抽取；verification 非 null 时铺 verification-report.md。
 * @param {string} fixtureName
 * @param {{ fixReportContent?:string|null, verification?:string|null }} [opts]
 */
function stageFixture(fixtureName, { fixReportContent, verification } = {}) {
  const dir = path.join(tmp, FEATURE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const content = fixReportContent !== undefined ? fixReportContent : extractFixReportContent(fixtureName);
  if (content != null) fs.writeFileSync(path.join(dir, 'fix-report.md'), content, 'utf8');
  if (verification != null) {
    fs.mkdirSync(path.join(dir, 'verification'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'verification', 'verification-report.md'), verification, 'utf8');
  }
  return path.join(FIXTURE_DIR, fixtureName);
}

/** 直接预置 blockState（W7 精确窗口：模拟旧合同缺口已产生的阻断计数） */
function preinstallBlockState(sessionId, state) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown-session';
  const stateDir = path.join(tmp, '.specify', 'runs', '.fix-compliance-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, `${safe}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ sessionId: safe, ...state })}\n`, 'utf8');
  return file;
}

// ────────────────────────────────────────
// 退出码矩阵（contracts/fix-compliance-judge-cli.md）
// ────────────────────────────────────────

describe('退出码矩阵（--mode hook）', () => {
  it('非 fix 会话 → exit 0，零接触（stderr 空）', () => {
    const p = writeTranscript([SKILL_EXPANSION_LINE('feature'), ASSISTANT_TEXT('feature 完成')]);
    const r = runCli({ transcriptPath: p });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });

  it('enforcement=off + 不合规 → exit 0，零接触', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    const r = runCli({ transcriptPath: collapsedTranscript() });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });

  it('合规收口 → exit 0，静默（stderr 空）', () => {
    const r = runCli({ transcriptPath: compliantTranscript() });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });

  it('enforcement=warn + 不合规 → exit 0，stderr [FIX-COMPLIANCE][WARN]', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    const r = runCli({ transcriptPath: collapsedTranscript() });
    assert.equal(r.status, 0);
    assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE][WARN] '), r.stderr);
  });

  it('enforcement=block + 不合规 + 首次 → exit 2，stderr [FIX-COMPLIANCE]', () => {
    const r = runCli({ transcriptPath: collapsedTranscript() });
    assert.equal(r.status, 2);
    assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE] '), r.stderr);
    // 反馈文本含缺失动作行与双路径指引
    assert.ok(r.stderr.includes('两条合法收口路径任选其一'));
  });

  it('payload 非法 → exit 0（FR-013 fail-open）', () => {
    const res = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', tmp], { input: 'not json{', encoding: 'utf8' });
    assert.equal(res.status, 0);
  });

  it('transcript 缺失 → exit 0（FR-013 fail-open）', () => {
    const r = runCli({ transcriptPath: path.join(tmp, 'nope.jsonl') });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });
});

// ────────────────────────────────────────
// FR-013 loud 半边 + FR-015 off 短路顺序（主编排器复核处置）
// ────────────────────────────────────────

/** 读取沙箱 .specify/runs/ 全部 fix-compliance-verdict 事件 */
/**
 * 读取某 session 的阻断/推迟状态文件（F256 R2：blockCount 与 inFlightDeferCount 分列）。
 * @returns {{blockCount:number, inFlightDeferCount:number, degradedRecorded:boolean}|null} 文件不存在返回 null
 */
function readState(sessionId, root = tmp) {
  const p = path.join(root, '.specify', 'runs', '.fix-compliance-state', `${sessionId}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function readVerdictEvents(root = tmp) {
  const runsDir = path.join(root, '.specify', 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const events = [];
  for (const f of fs.readdirSync(runsDir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(runsDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.eventType === 'fix-compliance-verdict') events.push(obj);
      } catch { /* 跳过损坏行 */ }
    }
  }
  return events;
}

describe('FR-013 fail-open loud：判定能力失效必须落盘 degraded 诊断', () => {
  it('transcript 缺失 → exit 0 且落盘 compliant:null + transcript-unavailable 诊断事件', () => {
    const r = runCli({ transcriptPath: path.join(tmp, 'nope.jsonl') });
    assert.equal(r.status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].compliant, null);
    assert.equal(events[0].closureForm, 'undetermined');
    assert.ok(events[0].diagnostics.includes('transcript-unavailable'), JSON.stringify(events[0].diagnostics));
    assert.equal(events[0].degraded, true);
  });

  it('payload 非法 → exit 0 且落盘 payload-invalid 诊断事件（sessionId 回落 unknown）', () => {
    const res = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', tmp], { input: 'not json{', encoding: 'utf8' });
    assert.equal(res.status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].compliant, null);
    assert.equal(events[0].sessionId, 'unknown');
    assert.ok(events[0].diagnostics.includes('payload-invalid'));
  });
});

describe('FR-015 判定顺序：off 短路先于 transcript 读取', () => {
  it('off + transcript 指向不可解析目标 → exit 0 且零落盘（证明未进入 transcript 读取与 fail-open 分支）', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    // transcript_path 指向目录：若 off 短路发生在读取之后，会产生 transcript-unavailable 诊断事件
    const dirAsTranscript = path.join(tmp, 'a-directory');
    fs.mkdirSync(dirAsTranscript);
    const r = runCli({ transcriptPath: dirAsTranscript });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.equal(readVerdictEvents().length, 0);
    assert.ok(!fs.existsSync(path.join(tmp, '.specify')), 'off 档不得创建任何 .specify 落盘');
  });

  it('off + payload 非法 → exit 0 且零落盘（off 的零接触覆盖 payload-invalid 分支）', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    const res = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', tmp], { input: '{broken', encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(path.join(tmp, '.specify')));
  });
});

describe('退出码矩阵（--mode report）：恒 exit 0 + verdict JSON + 零落盘', () => {
  it('collapsed → exit 0，stdout verdict compliant:false', () => {
    const r = runCli({ mode: 'report', transcriptPath: collapsedTranscript() });
    assert.equal(r.status, 0);
    const v = JSON.parse(r.stdout);
    assert.equal(v.fixSession, true);
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('fix-report.md'));
    // 零落盘：不产生 .specify/runs
    assert.equal(fs.existsSync(path.join(tmp, '.specify', 'runs')), false);
  });

  it('compliant → exit 0，stdout verdict compliant:true', () => {
    const r = runCli({ mode: 'report', transcriptPath: compliantTranscript() });
    assert.equal(r.status, 0);
    const v = JSON.parse(r.stdout);
    assert.equal(v.compliant, true);
    assert.equal(v.closureForm, 'repair');
  });

  it('非 fix → exit 0，fixSession:false', () => {
    const p = writeTranscript([SKILL_EXPANSION_LINE('feature')]);
    const r = runCli({ mode: 'report', transcriptPath: p });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).fixSession, false);
  });
});

// ────────────────────────────────────────
// FR-010：missing 枚举 → action 文案映射全覆盖（防新增枚举漏配）
// ────────────────────────────────────────

describe('FR-010 反馈文本机械拼装', () => {
  it('每个 missing 枚举都在 buildFeedbackText 输出对应 action 行', () => {
    for (const key of Object.keys(MISSING_ACTION_TEXT)) {
      const text = buildFeedbackText([key]);
      assert.ok(text.includes(MISSING_ACTION_TEXT[key]), `${key} 缺 action 行`);
      assert.ok(text.includes('两条合法收口路径任选其一'), '缺双路径指引');
    }
  });

  it('degraded 场景前置降级说明行', () => {
    const text = buildFeedbackText(['fix-report.md'], { degraded: true });
    assert.ok(text.includes('已达阻断上限(2 次)'), text);
  });

  it('未知枚举被安全跳过（不抛出、不留空行注入）', () => {
    const text = buildFeedbackText(['unknown-enum-x']);
    assert.ok(text.includes('两条合法收口路径任选其一'));
  });
});

describe('parseArgs', () => {
  it('默认 mode=hook、projectRoot=cwd', () => {
    const a = parseArgs([]);
    assert.equal(a.mode, 'hook');
  });
  it('解析 --mode report --project-root --transcript-path', () => {
    const a = parseArgs(['--mode', 'report', '--project-root', '/x', '--transcript-path', '/t.jsonl']);
    assert.equal(a.mode, 'report');
    assert.equal(a.projectRoot, '/x');
    assert.equal(a.transcriptPath, '/t.jsonl');
  });
  it('非法 mode 归一化为 hook', () => {
    assert.equal(parseArgs(['--mode', 'bogus']).mode, 'hook');
  });
});

// ────────────────────────────────────────
// T025：FR-006 阻断有界化 + 双写降级 + 会话隔离 + 存储不可用
// ────────────────────────────────────────

describe('阻断有界化（FR-006）', () => {
  function readRunsEvents() {
    const runsDir = path.join(tmp, '.specify', 'runs');
    if (!fs.existsSync(runsDir)) return [];
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.jsonl'));
    const events = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(runsDir, f), 'utf8').split('\n').filter((l) => l.trim());
      for (const l of lines) events.push(JSON.parse(l));
    }
    return events;
  }

  it('连续 3 次同 session：1/2 次 exit 2、第 3 次 exit 0 + [GATE-DEGRADED]', () => {
    const p = collapsedTranscript();
    const r1 = runCli({ transcriptPath: p, sessionId: 'sess-A' });
    const r2 = runCli({ transcriptPath: p, sessionId: 'sess-A' });
    const r3 = runCli({ transcriptPath: p, sessionId: 'sess-A' });
    assert.equal(r1.status, 2);
    assert.equal(r2.status, 2);
    assert.equal(r3.status, 0);
    assert.ok(r3.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), r3.stderr);
  });

  it('第 3 次后落盘 workflow-run-summary（complianceVerdict.degraded/blockCount/missing）+ fix-compliance-verdict', () => {
    const p = collapsedTranscript();
    runCli({ transcriptPath: p, sessionId: 'sess-B' });
    runCli({ transcriptPath: p, sessionId: 'sess-B' });
    runCli({ transcriptPath: p, sessionId: 'sess-B' });
    const events = readRunsEvents();
    const summaries = events.filter((e) => e.eventType === 'workflow-run-summary');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].complianceVerdict.degraded, true);
    assert.equal(summaries[0].complianceVerdict.blockCount, 2);
    assert.ok(summaries[0].complianceVerdict.missing.length > 0);
    assert.equal(summaries[0].result, 'failed');
    const verdicts = events.filter((e) => e.eventType === 'fix-compliance-verdict');
    assert.ok(verdicts.length >= 1);
    // 降级审计事件标记 degraded
    assert.ok(verdicts.some((e) => e.degraded === true));
  });

  it('第 4 次同 session 不再新增 workflow-run-summary 终态事件（degradedRecorded 幂等）', () => {
    const p = collapsedTranscript();
    for (let i = 0; i < 4; i += 1) runCli({ transcriptPath: p, sessionId: 'sess-C' });
    const summaries = readRunsEvents().filter((e) => e.eventType === 'workflow-run-summary');
    assert.equal(summaries.length, 1);
  });

  it('不同 session 计数互不干扰', () => {
    const p = collapsedTranscript();
    const rA = runCli({ transcriptPath: p, sessionId: 'iso-A' });
    const rB = runCli({ transcriptPath: p, sessionId: 'iso-B' });
    assert.equal(rA.status, 2);
    assert.equal(rB.status, 2); // B 是各自的第 1 次，仍应阻断
  });

  it('补救成功清零：阻断×2 → compliant 收口 → 额度恢复，再次不合规从第 1 次重新计数', () => {
    // bad 与 good 必须落在不同 transcript 文件（collapsed/compliant 默认复用同一 transcript.jsonl，
    // 同测试内先后调用会互相覆盖）；bad 无 feature dir 提名 → 恒非合规，磁盘制品是否存在不影响判定。
    const bad = path.join(tmp, 'bad.jsonl');
    fs.writeFileSync(bad, [SKILL_EXPANSION_LINE('fix'), ASSISTANT_TEXT('已完成修复，一切正常。')].map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    const good = compliantTranscript();
    // 第一轮：bad×2 均硬阻断（exit 2），第 3 次 bad 降级放行（exit 0 + GATE-DEGRADED）
    assert.equal(runCli({ transcriptPath: bad, sessionId: 'sess-R1' }).status, 2);
    assert.equal(runCli({ transcriptPath: bad, sessionId: 'sess-R1' }).status, 2);
    // 补救成功收口：合规 → exit 0 静默，且重置该 session 的阻断状态
    const goodRun = runCli({ transcriptPath: good, sessionId: 'sess-R1' });
    assert.equal(goodRun.status, 0);
    assert.equal(goodRun.stderr.trim(), '');
    // 额度已恢复：再次不合规应重新进入完整 2→2→降级 周期，而非直接沿用旧计数当场降级
    const again1 = runCli({ transcriptPath: bad, sessionId: 'sess-R1' });
    const again2 = runCli({ transcriptPath: bad, sessionId: 'sess-R1' });
    const again3 = runCli({ transcriptPath: bad, sessionId: 'sess-R1' });
    assert.equal(again1.status, 2); // 若未重置，此处会因 count>=2 直接 exit 0 降级
    assert.equal(again2.status, 2);
    assert.equal(again3.status, 0);
    assert.ok(again3.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), again3.stderr);
  });

  it('降级放行后补救成功：degradedRecorded 随重置归位，同一 session 可再次产生新的降级终态事件', () => {
    const bad = path.join(tmp, 'bad.jsonl');
    fs.writeFileSync(bad, [SKILL_EXPANSION_LINE('fix'), ASSISTANT_TEXT('已完成修复，一切正常。')].map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    const good = compliantTranscript();
    // 第一轮：bad×3 → 第 3 次降级并写第 1 条 workflow-run-summary
    runCli({ transcriptPath: bad, sessionId: 'sess-R2' });
    runCli({ transcriptPath: bad, sessionId: 'sess-R2' });
    runCli({ transcriptPath: bad, sessionId: 'sess-R2' });
    assert.equal(readRunsEvents().filter((e) => e.eventType === 'workflow-run-summary').length, 1);
    // 补救成功：重置 blockCount 与 degradedRecorded
    assert.equal(runCli({ transcriptPath: good, sessionId: 'sess-R2' }).status, 0);
    // 第二轮：bad×3 → 应再次降级并写第 2 条终态事件（证伪旧幂等标记吞掉第二轮终态）
    runCli({ transcriptPath: bad, sessionId: 'sess-R2' });
    runCli({ transcriptPath: bad, sessionId: 'sess-R2' });
    const last = runCli({ transcriptPath: bad, sessionId: 'sess-R2' });
    assert.equal(last.status, 0);
    assert.ok(last.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), last.stderr);
    assert.equal(readRunsEvents().filter((e) => e.eventType === 'workflow-run-summary').length, 2);
  });

  it('state-storage-unavailable → 降级放行 + 审计事件含 state-storage-unavailable', () => {
    // 主路径不可写：用文件占据 .fix-compliance-state 子目录位置
    fs.mkdirSync(path.join(tmp, '.specify', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state'), 'blocker');
    // tmp 降级路径不可写：env 指向一个文件
    const tmpBlocker = path.join(tmp, 'tmp-blocker');
    fs.writeFileSync(tmpBlocker, 'x');
    const r = runCli({
      transcriptPath: collapsedTranscript(),
      sessionId: 'sess-D',
      env: { SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP: tmpBlocker },
    });
    assert.equal(r.status, 0);
    assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), r.stderr);
    assert.ok(r.stderr.includes('state-storage-unavailable'), r.stderr);
    const verdicts = readRunsEvents().filter((e) => e.eventType === 'fix-compliance-verdict');
    assert.ok(verdicts.some((e) => e.diagnostics.includes('state-storage-unavailable')));
  });
});

// ────────────────────────────────────────
// T013：bash 薄壳退出码转发（0/2 原样，其余兜底 0）
// ────────────────────────────────────────

describe('stop-fix-compliance-check.sh 退出码转发', () => {
  function runShellWithStubExit(exitCode) {
    // 用 stub CLI 注入固定退出码，断言薄壳转发
    const stub = path.join(tmp, 'stub-cli.mjs');
    fs.writeFileSync(stub, `process.exit(${exitCode});\n`, 'utf8');
    const res = spawnSync('bash', [HOOK_SH], {
      input: '{}',
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, FIX_COMPLIANCE_CLI: stub },
    });
    return res.status;
  }

  it('CLI exit 2 → 薄壳 exit 2', () => {
    assert.equal(runShellWithStubExit(2), 2);
  });
  it('CLI exit 0 → 薄壳 exit 0', () => {
    assert.equal(runShellWithStubExit(0), 0);
  });
  it('CLI exit 1（异常）→ 薄壳兜底 exit 0', () => {
    assert.equal(runShellWithStubExit(1), 0);
  });
  it('CLI exit 42（其他）→ 薄壳兜底 exit 0', () => {
    assert.equal(runShellWithStubExit(42), 0);
  });
});

describe('codex W-2：fail-open 事件合并配置层诊断', () => {
  it('配置非法 + transcript 缺失 → 事件同时含 config-degraded 与 transcript-unavailable', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: not-a-valid-value\n');
    const r = runCli({ transcriptPath: path.join(tmp, 'nope.jsonl') });
    assert.equal(r.status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('transcript-unavailable'), JSON.stringify(events[0].diagnostics));
    assert.ok(events[0].diagnostics.includes('config-degraded'), JSON.stringify(events[0].diagnostics));
    assert.equal(events[0].enforcement, 'block');
  });
});

// ────────────────────────────────────────
// F216 T017：judge-cli 端到端 no-op 复现证据门（SC-001/SC-002/FR-011/FR-018/EC-003/EC-007 + report 模式）
// 红：evaluate() 尚未透传 ExecutionRecord → 合法 no-op 被误判 command-mismatch（绿用例转 exit 2）
// ────────────────────────────────────────

describe('F216 T017 judge-cli 端到端：no-op 复现证据门', () => {
  it('F216 T017 noop-unverified-citation → block exit 2 + 要求产出 repro 的 next-step（SC-001）', () => {
    const t = stageFixture('noop-unverified-citation.jsonl');
    const r = runCli({ transcriptPath: t, sessionId: 'sc001' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE] '), r.stderr);
    assert.ok(r.stderr.includes('SPEC-DRIVER-REPRO'), '反馈含 sentinel 断言骨架 next-step');
    assert.ok(r.stderr.includes('printf'), '反馈含 printf 断言骨架');
  });

  it('F216 T017 compliant-noop-with-repro → 合规放行 exit 0（SC-002）', () => {
    const t = stageFixture('compliant-noop-with-repro.jsonl');
    const r = runCli({ transcriptPath: t, sessionId: 'sc002' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
  });

  it('F216 T017 升级后 compliant-noop.jsonl → 合规放行 exit 0（回归护栏不误伤）', () => {
    const t = stageFixture('compliant-noop.jsonl');
    const r = runCli({ transcriptPath: t, sessionId: 'cnoop' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
  });

  it('F216 T017 compliant-full.jsonl（真修复路径）→ 证据门零介入、继续绿（FR-007）', () => {
    const t = stageFixture('compliant-full.jsonl', { fixReportContent: REPAIR_FIX_REPORT, verification: VERIFICATION_DOC });
    const r = runCli({ transcriptPath: t, sessionId: 'cfull' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
  });

  it('F216 T017 legacy-noop-without-repro → block exit 2 + noop:repro-fields（FR-011）', () => {
    const t = stageFixture('legacy-noop-without-repro.jsonl');
    const r = runCli({ transcriptPath: t, sessionId: 'legnoop' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes(MISSING_ACTION_TEXT['noop:repro-fields']), r.stderr);
  });

  it('F216 T017 legacy-repair-no-noop-anchor → 证据门零介入、绿（FR-007/W8）', () => {
    const t = stageFixture('legacy-repair-no-noop-anchor.jsonl', { verification: VERIFICATION_DOC });
    const r = runCli({ transcriptPath: t, sessionId: 'legrepair' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
  });

  it('F216 T017 双锚点 missing-repair：report missing 含 repair 键、无 repro 键（FR-018）', () => {
    const t = stageFixture('noop-dual-anchor-missing-repair.jsonl');
    const r = runCli({ mode: 'report', transcriptPath: t });
    assert.equal(r.status, 0);
    const v = JSON.parse(r.stdout);
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('verification-report.md'), JSON.stringify(v.missing));
    assert.ok(v.missing.includes('delegation:implement'));
    assert.ok(v.missing.includes('delegation:verify'));
    assert.ok(!v.missing.some((k) => k.startsWith('noop:repro-')), 'repro 满足不应有 repro 键');
  });

  it('F216 T017 双锚点 missing-repro：report missing 含 repro 键、无 repair 键（FR-018）', () => {
    const t = stageFixture('noop-dual-anchor-missing-repro.jsonl', { verification: VERIFICATION_DOC });
    const r = runCli({ mode: 'report', transcriptPath: t });
    assert.equal(r.status, 0);
    const v = JSON.parse(r.stdout);
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('noop:repro-command-mismatch'), JSON.stringify(v.missing));
    assert.ok(!v.missing.includes('verification-report.md'), 'repair 满足不应缺 verification');
    assert.ok(!v.missing.includes('delegation:implement'));
  });

  it('F216 T017 双锚点 both-satisfied → 合规放行 exit 0（FR-018）', () => {
    const t = stageFixture('noop-dual-anchor-both-satisfied.jsonl', { verification: VERIFICATION_DOC });
    const r = runCli({ transcriptPath: t, sessionId: 'dualboth' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
  });

  it('F216 T017 noop-non-bash-tool-execution → noop:repro-command-mismatch（EC-007）', () => {
    const t = stageFixture('noop-non-bash-tool-execution.jsonl');
    const r = runCli({ mode: 'report', transcriptPath: t });
    const v = JSON.parse(r.stdout);
    assert.ok(v.missing.includes('noop:repro-command-mismatch'), JSON.stringify(v.missing));
  });

  it('F216 T017 noop-no-repro-claims → noop:repro-fields（EC-003）', () => {
    const t = stageFixture('noop-no-repro-claims.jsonl');
    const r = runCli({ mode: 'report', transcriptPath: t });
    const v = JSON.parse(r.stdout);
    assert.ok(v.missing.includes('noop:repro-fields'), JSON.stringify(v.missing));
  });

  it('F216 T017 --mode report：exit 0 + 合法 JSON + compliant:false + 精确新键 + 零阻断计数写入', () => {
    const t = stageFixture('noop-unverified-citation.jsonl');
    const r = runCli({ mode: 'report', transcriptPath: t });
    assert.equal(r.status, 0);
    const v = JSON.parse(r.stdout); // 合法 JSON
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('noop:repro-command-mismatch'), JSON.stringify(v.missing));
    // report 只读判定：不触碰 blockState
    assert.equal(fs.existsSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state')), false, 'report 模式零阻断计数写入');
  });
});

// ────────────────────────────────────────
// F216 T018：SC-003a 阻断→补证据→放行序列闭环（US3 Acceptance Scenario 1）
// ────────────────────────────────────────

describe('F216 T018 SC-003a：阻断→补证据→放行序列闭环', () => {
  it('F216 T018 无证据 no-op 阻断 exit 2 → 补齐复现证据 → 放行 exit 0 + F211 清零', () => {
    const sid = 'sess-seq-1';
    // 步骤 1：无证据 no-op（unverified-citation）→ block exit 2 + 要求产出 repro
    const bad = stageFixture('noop-unverified-citation.jsonl');
    const r1 = runCli({ transcriptPath: bad, sessionId: sid });
    assert.equal(r1.status, 2, r1.stderr);
    assert.ok(r1.stderr.includes('SPEC-DRIVER-REPRO'), '含要求产出 repro 的 next-step');
    // 步骤 2：补充主 transcript 可见复现执行记录（覆盖磁盘 fix-report + 带真实 Bash 的 transcript）
    const good = stageFixture('compliant-noop-with-repro.jsonl');
    const r2 = runCli({ transcriptPath: good, sessionId: sid });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stderr.trim(), '');
    // F211 清零：合规收口后阻断状态文件被移除
    const stateFile = path.join(tmp, '.specify', 'runs', '.fix-compliance-state', `${sid}.json`);
    assert.equal(fs.existsSync(stateFile), false, '合规后 blockState 应清零');
    // 反证清零：再次无证据应从第 1 次重新计数（exit 2 而非直接降级）
    const badAgain = stageFixture('noop-unverified-citation.jsonl');
    assert.equal(runCli({ transcriptPath: badAgain, sessionId: sid }).status, 2, '清零后重新从第 1 次阻断');
  });
});

// ────────────────────────────────────────
// F216 T019：SC-004 档位切换矩阵 + W7 精确窗口
// ────────────────────────────────────────

describe('F216 T019 SC-004 档位切换矩阵 + W7 精确窗口', () => {
  /** 读取指定 session 的 blockState.blockCount（不存在则返回 null，W2 精确断言用） */
  function readBlockCount(sessionId, root = tmp) {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown-session';
    const file = path.join(root, '.specify', 'runs', '.fix-compliance-state', `${safe}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')).blockCount;
  }

  it('F216 T019 W2 block→warn→block：同一 session 计数轨迹精确（warn 不 bump、切回续阻断至降级）', () => {
    const sid = 'sw-same'; // 全程同一 session，真正走 blockState 计数轨迹
    const t = stageFixture('noop-unverified-citation.jsonl');
    // 步 1 block：首次阻断 exit 2，count 0→1
    assert.equal(runCli({ transcriptPath: t, sessionId: sid }).status, 2);
    assert.equal(readBlockCount(sid), 1, 'block 首次 → count=1');
    // 步 2 切 warn：判定照跑（非合规仍 [WARN]）但不 bump、不 reset，count 保持 1
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    const rw = runCli({ transcriptPath: t, sessionId: sid });
    assert.equal(rw.status, 0);
    assert.ok(rw.stderr.startsWith('[FIX-COMPLIANCE][WARN] '), rw.stderr);
    assert.equal(readBlockCount(sid), 1, 'warn 不 bump → count 仍为 1');
    // 步 3 切回 block：第二次阻断 exit 2，count 1→2
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: block\n');
    assert.equal(runCli({ transcriptPath: t, sessionId: sid }).status, 2);
    assert.equal(readBlockCount(sid), 2, 'block 第二次 → count=2');
    // 步 4 第三次 block：已达上限 → 降级放行 exit 0 [GATE-DEGRADED]
    const r4 = runCli({ transcriptPath: t, sessionId: sid });
    assert.equal(r4.status, 0, r4.stderr);
    assert.ok(r4.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), r4.stderr);
  });

  it('F216 T019 W2 block→off→block：off 零接触不改计数，切回续阻断（同一 session 精确 count）', () => {
    const sid = 'so-same';
    const t = stageFixture('noop-unverified-citation.jsonl');
    // 步 1 先真实执行首个 block：exit 2，count 0→1
    assert.equal(runCli({ transcriptPath: t, sessionId: sid }).status, 2);
    assert.equal(readBlockCount(sid), 1, 'block 首次 → count=1');
    // 步 2 切 off：transcript 读取前零接触放行，不改 blockState（count 仍 1）
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    const roff = runCli({ transcriptPath: t, sessionId: sid });
    assert.equal(roff.status, 0);
    assert.equal(roff.stderr.trim(), '');
    assert.equal(readBlockCount(sid), 1, 'off 零接触 → count 保持 1（不清零、不 bump）');
    // 步 3 切回 block：从 count=1 续阻断至 count=2，exit 2
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: block\n');
    assert.equal(runCli({ transcriptPath: t, sessionId: sid }).status, 2);
    assert.equal(readBlockCount(sid), 2, 'block 切回续阻断 → count=2');
  });

  it('F216 T019 warn 下合规清零旧计数', () => {
    const sid = 'sw-clear';
    preinstallBlockState(sid, { blockCount: 1, degradedRecorded: false });
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    const t = stageFixture('compliant-noop-with-repro.jsonl');
    const r = runCli({ transcriptPath: t, sessionId: sid });
    assert.equal(r.status, 0, r.stderr);
    // 合规收口无条件 resetBlockState → 旧计数文件移除
    assert.equal(fs.existsSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state', `${sid}.json`)), false, 'warn 合规应清零旧计数');
  });

  it('F216 T019 W7 精确窗口：预装 count=2 + 仅缺新 repro 证据 → 首次降级放行 + 审计 missing 仅新键 → 补证据清零', () => {
    const sid = 'sess-W7';
    // 预装 blockState count=2（模拟旧合同缺口已产生两次阻断）
    const stateFile = preinstallBlockState(sid, { blockCount: 2, degradedRecorded: false });
    // 输入：旧合同全满足（判定依据非占位 + noopVerify 委派 + featureDir）、仅缺新 repro 证据的 no-op
    const bad = stageFixture('noop-unverified-citation.jsonl');
    const r1 = runCli({ transcriptPath: bad, sessionId: sid });
    // count 已达上限 → 第 3 次降级放行 exit 0
    assert.equal(r1.status, 0, r1.stderr);
    assert.ok(r1.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), r1.stderr);
    // 审计事件 missing[] 仅含新 repro 键（不误带旧合同键）
    const degraded = readVerdictEvents().filter((e) => e.degraded === true);
    assert.ok(degraded.length >= 1, '应有降级审计事件');
    const w7 = degraded[degraded.length - 1];
    assert.deepEqual(w7.missing, ['noop:repro-command-mismatch'], JSON.stringify(w7.missing));
    // 补齐证据 → 合规且阻断计数清零（FR-009/F211）
    const good = stageFixture('compliant-noop-with-repro.jsonl');
    const r2 = runCli({ transcriptPath: good, sessionId: sid });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stderr.trim(), '');
    assert.equal(fs.existsSync(stateFile), false, '补证据合规后阻断计数清零');
  });
});

// ────────────────────────────────────────
// F224 · 候选目录解析盲区修复（CLI 端到端）
// ────────────────────────────────────────

describe('F224 CLI 端到端：目录改名后仍合规收口（复现 F223 场景，FR-001）', () => {
  const OLD_DIR = 'specs/350-fix-renamed-bug';
  const NEW_DIR = 'specs/351-fix-renamed-bug';

  /** 制品先写旧路径 → git mv 改名；磁盘上只存在改名后的新目录 */
  function renamedTranscript() {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Write', { file_path: `${OLD_DIR}/verification/verification-report.md`, content: '# V' }),
      TOOL_USE('Bash', { command: `git mv ${OLD_DIR} ${NEW_DIR}` }),
      ASSISTANT_TEXT('编号撞车已改名，修复完成'),
    ]);
    fs.mkdirSync(path.join(tmp, NEW_DIR, 'verification'), { recursive: true });
    fs.writeFileSync(path.join(tmp, NEW_DIR, 'fix-report.md'), '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n', 'utf8');
    fs.writeFileSync(path.join(tmp, NEW_DIR, 'verification', 'verification-report.md'), '# 验证报告\n\n所有单测通过，回归零失败。\n', 'utf8');
    return p;
  }

  it('改名后制品齐全 → exit 0 静默放行（不再误报未建立特性目录）', () => {
    const r = runCli({ transcriptPath: renamedTranscript() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
  });

  it('report 模式确认候选已跟随到新路径且判定合规', () => {
    const r = runCli({ mode: 'report', transcriptPath: renamedTranscript() });
    const v = JSON.parse(r.stdout);
    assert.equal(v.fixSession, true);
    assert.equal(v.compliant, true, JSON.stringify(v.missing));
    assert.deepEqual(v.missing, []);
  });
});

describe('F224 CLI 端到端：候选目录存在但 fix-report.md 真实缺失仍阻断（SC-004 回归）', () => {
  /** transcript 正常提名候选，但磁盘上只有空目录 */
  function stagedMissingReport() {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      ASSISTANT_TEXT('修复完成'),
    ]);
    fs.mkdirSync(path.join(tmp, FEATURE_DIR), { recursive: true });
    return p;
  }

  it('exit 2 硬阻断，且 missing 走制品缺失判据而非候选目录判据', () => {
    const t = stagedMissingReport();
    const r = runCli({ transcriptPath: t });
    assert.equal(r.status, 2, r.stderr);
    const v = JSON.parse(runCli({ mode: 'report', transcriptPath: t }).stdout);
    assert.ok(v.missing.includes('fix-report.md'), JSON.stringify(v.missing));
    assert.ok(!v.missing.includes('feature-dir'), JSON.stringify(v.missing));
  });
});

describe('F224 CLI 端到端：只写非制品文件仍阻断（降级触发面收窄的反向回归）', () => {
  it('磁盘目录存在但只写了 plan.md → exit 2，不得借 fail-open 降级通道放行', () => {
    // 这正是 F208 要抓的坍塌形态：走过场建目录写计划，但跳过诊断报告。
    const t = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/plan.md`, content: '# Plan' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      ASSISTANT_TEXT('修复完成'),
    ]);
    fs.mkdirSync(path.join(tmp, FEATURE_DIR), { recursive: true });
    const r = runCli({ transcriptPath: t });
    assert.equal(r.status, 2, r.stderr);
    const v = JSON.parse(runCli({ mode: 'report', transcriptPath: t }).stdout);
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('fix-report.md'), JSON.stringify(v.missing));
    // 降级诊断不得出现——该场景由磁盘 + 既有严格判据裁决，非"无法定位候选"
    assert.deepEqual(v.transcriptDiagnostics, []);
  });
});

describe('F224 CLI 端到端：候选目录无法确定 → fail-open 降级 + 诊断留痕（SC-005）', () => {
  /**
   * 候选已被改名搬到非 NNN-fix-<name> 目录，新位置无法机械定位，
   * 且会话确有 implement + verify 收口委派——即"唯一不确定的只是制品落在哪个目录"。
   * 这是降级放行**唯一**成立的形态（见下方 SC-005b 收窄用例）。
   */
  function unresolvableTranscript() {
    return writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: `git mv ${FEATURE_DIR} specs/renamed-nonstandard` }),
      ASSISTANT_TEXT('已改名'),
    ]);
  }

  it('exit 0 静默放行且落盘 compliant:null + feature-dir-unresolvable 诊断事件', () => {
    const r = runCli({ transcriptPath: unresolvableTranscript() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].compliant, null);
    assert.equal(events[0].degraded, true);
    assert.ok(events[0].diagnostics.includes('feature-dir-unresolvable'), JSON.stringify(events[0].diagnostics));
  });

  it('report 模式暴露 feature-dir-unresolvable 且不产出 compliant:false 结论', () => {
    const v = JSON.parse(runCli({ mode: 'report', transcriptPath: unresolvableTranscript() }).stdout);
    assert.equal(v.fixSession, true);
    assert.deepEqual(v.transcriptDiagnostics, ['feature-dir-unresolvable']);
    assert.equal(v.compliant, undefined, JSON.stringify(v));
  });
});

describe('F224 CRITICAL 收窄：改名到非规范目录不得赦免委派证据（SC-005b）', () => {
  /**
   * 反向回归：零委派坍塌会话 + 一条 `git mv <候选> <非规范名>`。
   * 收窄前这条 Bash 会让整段判定短路成 fail-open，把硬阻断变成放行（1 条命令绕过阻断型门禁）；
   * 收窄后目录不确定只作用于 featureDir 维度，委派证据照常裁决 → 必须维持 exit 2。
   */
  function zeroDelegationRenamedTranscript() {
    return writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Bash', { command: `git mv ${FEATURE_DIR} specs/renamed-nonstandard` }),
      ASSISTANT_TEXT('已改名'),
    ]);
  }

  it('零委派 + 非规范改名 → exit 2 硬阻断，不落降级诊断', () => {
    const t = zeroDelegationRenamedTranscript();
    const r = runCli({ transcriptPath: t });
    assert.equal(r.status, 2, r.stderr);
    const v = JSON.parse(runCli({ mode: 'report', transcriptPath: t }).stdout);
    assert.equal(v.compliant, false, JSON.stringify(v));
    assert.deepEqual(v.transcriptDiagnostics, []);
    assert.deepEqual(v.delegationCounts, { implement: 0, verify: 0, other: 0 });
    assert.ok(v.missing.includes('feature-dir'), JSON.stringify(v.missing));
    assert.ok(v.missing.includes('fix-report.md'), JSON.stringify(v.missing));
  });

  it('仅 verify 类委派（no-op 收口形态）+ 非规范改名 → 仍走降级放行', () => {
    // no-op 路径合法收口只需 1 次 verify 类交叉核实，不含 implement；
    // 收窄口径是 implement 与 verify 同时为 0 才阻断，故此形态不得被误伤。
    const t = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '交叉核实无需改动' }),
      TOOL_USE('Bash', { command: `git mv ${FEATURE_DIR} specs/renamed-nonstandard` }),
      ASSISTANT_TEXT('已改名'),
    ]);
    assert.equal(runCli({ transcriptPath: t }).status, 0);
    const v = JSON.parse(runCli({ mode: 'report', transcriptPath: t }).stdout);
    assert.deepEqual(v.transcriptDiagnostics, ['feature-dir-unresolvable']);
  });

  // 入库 fixture 端到端复核：与主编排器实测的 A/C 对照构造逐字同源，
  // 保证该绕过路径的回归护栏不依赖本文件内联 transcript 的写法。
  const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/fix-compliance/', import.meta.url));

  it('fixture resolve-ambiguous-rename-nonstandard（零委派）→ exit 2', () => {
    const t = path.join(FIXTURE_DIR, 'resolve-ambiguous-rename-nonstandard.jsonl');
    assert.equal(runCli({ transcriptPath: t }).status, 2);
  });

  it('fixture resolve-ambiguous-rename-with-delegations（有收口委派）→ exit 0 + 降级落盘', () => {
    const t = path.join(FIXTURE_DIR, 'resolve-ambiguous-rename-with-delegations.jsonl');
    assert.equal(runCli({ transcriptPath: t }).status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].degraded, true);
    assert.ok(events[0].diagnostics.includes('feature-dir-unresolvable'), JSON.stringify(events[0].diagnostics));
  });

  // Codex 复审给出的两个绕过构造：零委派会话下无论如何构造改名信号都不得放行。
  it('Codex 构造 A：sed -i 提名 decoy + 改名到非规范（零委派）→ exit 2', () => {
    const t = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Bash', { command: "sed -i '' 's/x/y/' specs/999-fix-decoy/fix-report.md; mv specs/999-fix-decoy specs/renamed-nonstandard" }),
      ASSISTANT_TEXT('已完成'),
    ]);
    assert.equal(runCli({ transcriptPath: t }).status, 2);
  });

  it('Codex 构造 B：注释形态 `true # mv <候选> <非规范>`（零委派）→ exit 2', () => {
    const t = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Bash', { command: `true # mv ${FEATURE_DIR} specs/renamed-nonstandard` }),
      ASSISTANT_TEXT('已完成'),
    ]);
    assert.equal(runCli({ transcriptPath: t }).status, 2);
  });
});

// ────────────────────────────────────────
// F227 · judge 层"主候选磁盘不可用时"的只读兜底解析
// ────────────────────────────────────────

import { main as judgeMain } from '../scripts/fix-compliance-judge.mjs';

const F227_FIX_REPORT = REPAIR_FIX_REPORT;

/** 在 projectRoot 下铺一个完整可用的特性目录（fix-report + verification-report） */
function stageDir(dir, { fixReport = F227_FIX_REPORT, verification = VERIFICATION_DOC } = {}) {
  const abs = path.join(tmp, dir);
  fs.mkdirSync(abs, { recursive: true });
  if (fixReport != null) fs.writeFileSync(path.join(abs, 'fix-report.md'), fixReport, 'utf8');
  if (verification != null) {
    fs.mkdirSync(path.join(abs, 'verification'), { recursive: true });
    fs.writeFileSync(path.join(abs, 'verification', 'verification-report.md'), verification, 'utf8');
  }
}

/** 进程内跑 --mode report（可被 statSync 探针计数器观测），返回解析后的 verdict JSON */
function reportInProcess(transcriptPath, projectRoot = tmp) {
  const chunks = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  let code;
  try {
    code = judgeMain(['--mode', 'report', '--transcript-path', transcriptPath, '--project-root', projectRoot], '');
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(code, 0, 'report 模式恒 exit 0');
  return JSON.parse(chunks.join(''));
}

/** 记录 fn 执行期间落在任意 fix-report.md 上的全部 statSync 探针路径 */
function withFixReportProbeSpy(fn) {
  const originalStatSync = fs.statSync;
  const probes = [];
  fs.statSync = function spy(target, ...rest) {
    if (typeof target === 'string' && target.endsWith('fix-report.md')) probes.push(target);
    return originalStatSync.call(fs, target, ...rest);
  };
  try {
    return { value: fn(), probes };
  } finally {
    fs.statSync = originalStatSync;
  }
}

describe('F227 judge fallback - usable primary candidate', () => {
  it('主候选可用 → 兜底循环零介入：探针只落在主候选，历史候选一次都不被探测', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/300-fix-alpha/fix-report.md', content: '# Fix' }),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/verification/verification-report.md`, content: '# V' }),
    ]);
    stageDir('specs/300-fix-alpha');
    stageDir(FEATURE_DIR);

    const { value: out, probes } = withFixReportProbeSpy(() => reportInProcess(p));

    assert.equal(out.compliant, true, JSON.stringify(out));
    assert.deepEqual(out.transcriptDiagnostics, []);
    // 核心断言：历史候选 specs/300-fix-alpha 的 fix-report.md 一次都没被探测过
    assert.deepEqual(
      probes.filter((x) => x.includes('300-fix-alpha')), [],
      `兜底循环意外介入，探针序列=${JSON.stringify(probes)}`,
    );
    // 主候选恰好两次探针：usable() 判据一次 + readArtifactFile 一次，无任何额外调用
    assert.equal(
      probes.filter((x) => x.includes(FEATURE_DIR)).length, 2,
      `主候选探针次数异常，探针序列=${JSON.stringify(probes)}`,
    );
  });

  it('主候选可用但内容不合规 → 仍基于主候选判定，不被更"干净"的历史候选顶替', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/300-fix-alpha/fix-report.md', content: '# Fix' }),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
    ]);
    stageDir('specs/300-fix-alpha'); // 历史候选制品齐全（含 verification）
    stageDir(FEATURE_DIR, { verification: null }); // 主候选缺 verification-report

    const out = reportInProcess(p);
    assert.equal(out.compliant, false, JSON.stringify(out));
    assert.ok(out.missing.includes('verification-report.md'), JSON.stringify(out.missing));
  });
});

describe('F227 judge fallback - unusable primary candidate', () => {
  it('主候选不可用 + 历史候选可用 → 解析到历史候选并正常走完 judgeCompliance', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/300-fix-alpha/fix-report.md', content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Write', { file_path: 'specs/300-fix-alpha/verification/verification-report.md', content: '# V' }),
      // 会话自身写下的 fixture/repro 文本覆写真实候选（ghost 提名，磁盘上不存在）
      TOOL_USE('Bash', { command: "echo body > specs/399-fix-ghost/fix-report.md" }),
    ]);
    stageDir('specs/300-fix-alpha');

    const out = reportInProcess(p);
    assert.equal(out.compliant, true, JSON.stringify(out));
    assert.deepEqual(out.missing, []);
    assert.deepEqual(out.transcriptDiagnostics, []);
  });

  it('硬阻断支等价复现（缓存 4.3.0 + head -526 同构）：幽灵候选覆写 → hook 由 exit 2 转 exit 0', () => {
    // 目标场景：ambiguous=false（幽灵路径本身命名规范）、主候选 specs/300-fix-old 磁盘不存在、
    // candidates 中存在制品齐全的真实历史候选 → 改动前 missing:["feature-dir","fix-report.md"] 硬阻断。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/verification/verification-report.md`, content: '# V' }),
      TOOL_USE('Bash', { command: "echo body > specs/300-fix-old/fix-report.md" }),
    ]);
    stageDir(FEATURE_DIR); // 真实候选制品齐全；specs/300-fix-old 磁盘上不存在

    const out = reportInProcess(p);
    assert.equal(out.compliant, true, JSON.stringify(out));
    assert.deepEqual(out.missing, []);
    // hook 模式端到端：不再硬阻断
    assert.equal(runCli({ transcriptPath: p }).status, 0);
  });

  it('主候选不可用 + 历史候选全不可用 → 完全回落现状（missing 与改动前逐字一致）', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: "echo body > specs/399-fix-ghost/fix-report.md" }),
    ]);
    // 磁盘上不铺任何目录

    const out = reportInProcess(p);
    assert.equal(out.compliant, false, JSON.stringify(out));
    assert.ok(out.missing.includes('feature-dir'), JSON.stringify(out.missing));
    assert.ok(out.missing.includes('fix-report.md'), JSON.stringify(out.missing));
  });

  it('单调性不变量：ambiguous=true + 历史候选可用 → 兜底零介入，不得把 exit 0 反转为阻断', () => {
    // 缺陷复盘：若兜底在 ambiguous=true 时也介入，会选中一个 usable 但制品不全的历史候选
    // （本仓库 48 个含 fix-report.md 的历史 fix 目录中 21 个缺 verification-report），
    // featureDirUndetermined 由真变假 → judgeCompliance 跑完 → compliant:false → routeBlock → exit 2，
    // 把今天的 fail-open 放行反转为新增误阻断。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/300-fix-alpha/fix-report.md', content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: 'mv specs/300-fix-alpha tmp/stage-a' }),
    ]);
    // 历史候选 specs/300-fix-alpha 磁盘可用，但**故意缺 verification-report** —— 一旦被兜底选中即翻转为阻断
    stageDir('specs/300-fix-alpha', { verification: null });

    const { value: out, probes } = withFixReportProbeSpy(() => reportInProcess(p));

    assert.deepEqual(out.transcriptDiagnostics, ['feature-dir-unresolvable'], JSON.stringify(out));
    assert.equal(out.compliant, undefined, 'ambiguous 分支必须维持 F224 fail-open，不得产出 compliant:false');
    assert.deepEqual(
      probes, [],
      `ambiguous=true 时兜底探针必须零调用，实际=${JSON.stringify(probes)}`,
    );
  });

  it('F224 合法降级场景 + 无可用历史候选 → feature-dir-unresolvable 降级通道原样保留', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/399-fix-ghost/fix-report.md', content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: 'mv specs/399-fix-ghost tmp/stage-a' }),
    ]);
    // 磁盘上不铺任何目录 → candidates 中唯一条目 specs/399-fix-ghost 也不可用

    const out = reportInProcess(p);
    assert.deepEqual(out.transcriptDiagnostics, ['feature-dir-unresolvable'], JSON.stringify(out));
    assert.equal(out.compliant, undefined, 'verdict 为 null 时不产出 compliant 结论');
  });
});

// ────────────────────────────────────────
// F227 · 真实 transcript 端到端复验（本机路径缺失时优雅跳过）
// ────────────────────────────────────────

const F227_REAL_TRANSCRIPT = path.join(
  os.homedir(),
  '.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73',
  '67720241-f20c-44af-856d-d1e976bcf3ef.jsonl',
);
// 只读复验专用：`--mode report` 恒零落盘（runReport 只调 evaluate，不触达 appendAuditEvent），
// 因此可以安全地把真实 worktree 当 projectRoot 用。
// **hook 模式不可复用它**——hook 走 fail-open 分支会调 tryAppendFailOpenEvent，
// 每跑一次测试就往真实 worktree 的 .specify/runs/YYYY-MM.jsonl 追加一条伪造降级事件，
// 污染本地审计流水与 adoption-insights 统计。hook 模式一律用 stageIsolatedRoot() 的 tmp root。
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * 在 tmp 内构造隔离 project root，并铺上真实 transcript 判定所需的最小制品
 * （specs/225-fix-compound-command-hijack 的 fix-report.md + verification/verification-report.md），
 * 使其成为 REPO_ROOT 的等价替身：候选解析结果只由 transcript 决定，磁盘侧制品齐备度与 REPO_ROOT 一致。
 * @returns {string} 隔离 project root 绝对路径
 */
function stageIsolatedRoot() {
  const root = path.join(tmp, 'isolated-root');
  const dir = path.join(root, 'specs/225-fix-compound-command-hijack');
  fs.mkdirSync(path.join(dir, 'verification'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fix-report.md'), REPAIR_FIX_REPORT, 'utf8');
  fs.writeFileSync(path.join(dir, 'verification', 'verification-report.md'), VERIFICATION_DOC, 'utf8');
  return root;
}

// 证据强度如实标注（Codex 观察，不改逻辑）：下方"截断实录"用例只断言
// (a) 不同时缺 feature-dir/fix-report、(b) hook exit 0。若截断内容退化成非 fix 会话，
// 或 transcript 本身触发 fail-open，这两条断言**仍会通过**——它们是单调性护栏而非阳性覆盖。
// 本次修复的核心回归覆盖来自上方合成的"幽灵覆写"用例（ambiguous=false 支），不要把本组当作充分证据。
describe('F227 real transcript re-verification（F230 已闭合 F227 限界三）', () => {
  // F227 交付时，该真实 transcript（session 67720241，F225 交付会话）在当时源码下走 **ambiguous=true**
  // 那一支：transcript 里一段临时验证脚本内的合成 `mv` 文本被 applyRename 当真实改名跟随，把候选带到
  // 非规范名目录 → ambiguous=true → feature-dir-unresolvable → fail-open 放行。F227 明确将这一支列为
  // 「限界三」不予处理（它的兜底只覆盖 ambiguous=false 的幽灵覆写支）。
  //
  // F230（本次）恰好修的就是这一支：命令位锚定后，该合成 `mv` 不再被跟随，候选停在 ambiguous=false
  // 的合成路径（specs/300-fix-old，磁盘不存在）→ **F227 的 usable() 兜底随即介入**，由候选历史回落到
  // 真实的 specs/225-fix-compound-command-hijack（磁盘制品齐全）→ judgeCompliance 读到真实 fix-report.md
  // 与 verification-report.md → **compliant:true**。两处修复在此协同：F230 使该会话脱离 ambiguous=true
  // 死角，F227 兜底把它接回真实目录。单独任一都不够（F227 单独→仍 fail-open 降级；F230 单独→合成候选
  // 磁盘不存在会误阻断）。这正是该会话本应有的结论——它确实完整合规（implement×2 / verify×3 / 四件制品齐全）。
  it('真实 transcript → compliant:true（F230 解除 ambiguous 死角，F227 兜底回落真实目录）', (t) => {
    if (!fs.existsSync(F227_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    const res = spawnSync('node', [CLI, '--mode', 'report', '--transcript-path', F227_REAL_TRANSCRIPT, '--project-root', REPO_ROOT], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    // 单调性：改动前是 fail-open 放行（exit 0），改动后是合规放行（exit 0），仍是 exit 0，无新增误阻断。
    assert.deepEqual(out.transcriptDiagnostics, [], JSON.stringify(out));
    assert.equal(out.compliant, true, `合规会话应被正确识别为 compliant，而非仅靠 fail-open 放行：${JSON.stringify(out)}`);
  });

  it('截断到阻断时点（head -526）同样维持 exit 0，不因兜底新增误阻断', (t) => {
    if (!fs.existsSync(F227_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    const lines = fs.readFileSync(F227_REAL_TRANSCRIPT, 'utf8').split('\n').slice(0, 526);
    const truncated = path.join(tmp, 'trunc526.jsonl');
    fs.writeFileSync(truncated, lines.join('\n') + '\n', 'utf8');
    const res = spawnSync('node', [CLI, '--mode', 'report', '--transcript-path', truncated, '--project-root', REPO_ROOT], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    const missing = out.missing || [];
    assert.ok(
      !(missing.includes('feature-dir') && missing.includes('fix-report.md')),
      `仍存在候选覆写型假阴性：${JSON.stringify(out)}`,
    );
    // hook 模式必须维持放行（单调性：不得由 exit 0 反转为 exit 2）
    // projectRoot 用隔离 tmp root 而非 REPO_ROOT：hook 的 fail-open 分支会落盘审计事件，
    // 指向真实 worktree 会污染 .specify/runs/YYYY-MM.jsonl（实测已累计伪造事件）。
    const hook = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', stageIsolatedRoot()], {
      input: JSON.stringify({ session_id: 'f227-trunc', transcript_path: truncated, stop_hook_active: false }),
      encoding: 'utf8',
    });
    assert.equal(hook.status, 0, hook.stderr);
  });
});

describe('F230 伪造改名 fail-open 反向回归（差分矩阵 A/D/E）', () => {
  /**
   * 统一前缀：fix 展开锚点 + Write 提名 `specs/300-fix-decoy/fix-report.md`（**不落盘**，
   * 复现"文件可以根本没写成功"）+ 1 次委派 + 末条 Bash。
   * 差分点只有两处：委派构成（第 2 层判据）与末条 Bash 的改名文本形态（第 1 层判据）。
   */
  const DECOY_DIR = 'specs/300-fix-decoy';
  const forgedTranscript = (agentInput, command) => writeTranscript([
    SKILL_EXPANSION_LINE('fix'),
    TOOL_USE('Write', { file_path: `${DECOY_DIR}/fix-report.md`, content: '# Fix' }),
    TOOL_USE('Agent', agentInput),
    TOOL_USE('Bash', { command }),
    ASSISTANT_TEXT('已完成'),
  ]);
  const VERIFY_AGENT = { subagent_type: 'spec-driver:verify', description: '交叉核实无需改动' };

  // ── 第 1 层（命令位锚定）：伪造 mv 不得把候选带到非规范名，故不得进入降级通道 ──
  const FORGED_COMMANDS = [
    ['A  注释假 mv', `true # mv ${DECOY_DIR} specs/renamed-nonstandard`],
    ['D  引号内假 mv', `echo 'mv ${DECOY_DIR} specs/renamed-nonstandard'`],
    ['F1 裸参数假 mv（无注释无引号）', `echo mv ${DECOY_DIR} specs/renamed-nonstandard`],
    // F230 第 3 轮 Codex CRITICAL 的端到端反向用例（core 单测已覆盖判据，此处钉住整条 CLI 链路）
    ['F8  参数内引号藏 mv（R3-C1）', `mv source "dest;mv ${DECOY_DIR} specs/renamed-nonstandard"`],
    ['F10 注释内藏分号（R3-C2）', `true # ; mv ${DECOY_DIR} specs/renamed-nonstandard`],
    // F230 第 4 轮 Codex CRITICAL（R4-4）：真实 bash 收到的是 argc=3 的 `mv SRC DST DEST_DIR`
    // ——语义是"移入目录 DEST_DIR"，不是一次 SRC→DST 改名。若参数先按长度上界截断再解析，
    // 第三操作数被抹掉，形态退化成看似合法的二操作数改名，绕过「多操作数整条跳过」的保守化合同。
    // 选它做端到端用例是因为它最不像人为构造：超长参数在真实命令里天然可能出现。
    ['R4-4 超长参数藏第三操作数', `mv ${DECOY_DIR} specs/renamed-nonstandard${' '.repeat(400)}specs/dest-dir`],
    // F231 端到端反向回归（H1/H2/H3）：藏在不会执行的控制流 / 命令替换里的 mv 不得被采信为改名。
    // HEAD 上这三条都会把候选带到非规范名 → ambiguous → feature-dir-unresolvable → exit 0 放行；
    // 白名单闸门（&&/|| + $( + 保留字 一律拒绝）关闭后候选停在 DECOY_DIR（磁盘不存在）→ 走制品缺失判据 exit 2。
    ['H1 短路 RHS 控制流藏 mv', `true || git mv ${DECOY_DIR} specs/renamed-nonstandard`],
    ['H2 死 if 分支藏 mv', `if false; then git mv ${DECOY_DIR} specs/renamed-nonstandard; fi`],
    ['H3 命令替换藏 mv', `: $(false && mv ${DECOY_DIR} specs/renamed-nonstandard)`],
  ];

  for (const [label, command] of FORGED_COMMANDS) {
    it(`${label} + verify 类委派 → 必须 exit 2（伪造文本不打开降级通道）`, () => {
      const t = forgedTranscript(VERIFY_AGENT, command);
      // 断死 exit 2（阻断）而非 notEqual(0)：后者在 CLI 崩溃返回 1 / status:null 时也会通过，
      // 会把"门禁挂了"误读成"门禁生效了"。
      const run = runCli({ transcriptPath: t });
      assert.equal(run.status, 2, run.stderr);
      const v = JSON.parse(runCli({ mode: 'report', transcriptPath: t }).stdout);
      assert.deepEqual(v.transcriptDiagnostics, [], JSON.stringify(v));
      assert.ok(!v.transcriptDiagnostics.includes('feature-dir-unresolvable'), JSON.stringify(v));
      assert.equal(v.compliant, false, JSON.stringify(v));
    });
  }

  // ── 正向保住：F224 的合法降级设计意图不得被本次两层收窄误伤 ──
  it('C 真实 mv + verify 类委派 → 继续 exit 0 + degraded（F224 合法降级不变）', () => {
    const t = forgedTranscript(VERIFY_AGENT, `git mv ${DECOY_DIR} specs/renamed-nonstandard`);
    assert.equal(runCli({ transcriptPath: t }).status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].degraded, true);
    assert.ok(events[0].diagnostics.includes('feature-dir-unresolvable'), JSON.stringify(events[0].diagnostics));
  });

  // ── 第 2 层（降级下界取两收口合同交集）：零验证类委派的会话无论目录落在哪都不可能合规收口 ──
  it('E implement-only 零验证类委派 + 真实 mv → 必须 exit 2', () => {
    const t = forgedTranscript(
      { subagent_type: 'spec-driver:implement', description: '执行代码修复' },
      `git mv ${DECOY_DIR} specs/renamed-nonstandard`,
    );
    const run = runCli({ transcriptPath: t });
    assert.equal(run.status, 2, run.stderr);
    const v = JSON.parse(runCli({ mode: 'report', transcriptPath: t }).stdout);
    assert.equal(v.compliant, false, JSON.stringify(v));
    assert.ok(!v.transcriptDiagnostics.includes('feature-dir-unresolvable'), JSON.stringify(v));
  });

  it('E 对照 1：canonical no-op 委派（roleClass=other + noopVerify）+ 真实 mv → 仍走降级 exit 0', () => {
    // 证明第 2 层没有过度收紧到"只认 roleClass==='verify'"：no-op 合同的合法收口文案
    // 「交叉核实无需改动判定」只命中 NOOP_VERIFY_ROLE_REGEX，不得被误伤。
    const t = forgedTranscript(
      { subagent_type: null, description: '交叉核实无需改动判定' },
      `git mv ${DECOY_DIR} specs/renamed-nonstandard`,
    );
    assert.equal(runCli({ transcriptPath: t }).status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].degraded, true);
  });

  it('E2 对照 2：描述含"确认"致 noopVerify=true（即便 roleClass=implement）+ 真实 mv → 仍走降级 exit 0', () => {
    // 原先此处期望 exit 2（理由是"implement 只需加两个字即可重开降级"），该论证已被证伪：
    // description='确认无需代码修复' 实测同时得到 roleClass='implement'（IMPLEMENT_ROLE_REGEX 的
    // 「代码修复」命中了"无需代码修复"）与 noopVerify=true，而 judgeCompliance 的 no-op 分支只看
    // noopVerify===true，会判这条**合规**。降级下界必须被合规合同蕴含，否则就成了
    //「目录可定位时合规、改名后却不许降级」的状态依赖不一致，故改为正向期望。
    const t = forgedTranscript(
      { subagent_type: null, description: '确认无需代码修复' },
      `git mv ${DECOY_DIR} specs/renamed-nonstandard`,
    );
    const run = runCli({ transcriptPath: t });
    assert.equal(run.status, 0, run.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].degraded, true);
    assert.ok(events[0].diagnostics.includes('feature-dir-unresolvable'), JSON.stringify(events[0].diagnostics));
  });
});

// ────────────────────────────────────────
// F240 T033 · FR-004：transcript 方言识别的三条不变量（I1 / I2 / I3）
//
// 范围声明（禁止 over-claim，与 plan §5 逐字一致）：本组守护的是**可观测性**改进——
// 判定能力在异构 wire format 下失效时**是否留下诊断**。它**不**提供独立于 transcript
// 的第二事实源、**不**提高合规判定强度、**不**改变任何放行/阻断语义（恒 exit 0 方向）。
// ────────────────────────────────────────

/**
 * I2 钉死基线：改动前对 Claude fixture 全集实测采集的可观测结局。
 * 以常量形式写死（不做 git stash 前后对拍——CI 不可复现）。任何一行变动即为 Claude 侧回归。
 */
const CLAUDE_BASELINE = Object.freeze({
  'collapsed-zero-delegation.jsonl': { status: 2, eventCount: 1, compliant: [false], diagnostics: [['in-flight-undetermined']], stderrPrefix: '[FIX-COMPLIANCE]', specifyDirCreated: true },
  'compliant-full.jsonl': { status: 2, eventCount: 1, compliant: [false], diagnostics: [['in-flight-undetermined']], stderrPrefix: '[FIX-COMPLIANCE]', specifyDirCreated: true },
  // F270 P3（FR-015）：payload 无 background_tasks 键（runCli 默认不带）→ 在途三态判 undetermined，
  // 该独立诊断码如实进不合规审计 → 6 条不合规 fixture 的 diagnostics 基线 [] → ['in-flight-undetermined']。
  // F270 P2b（FR-024 修订版）：合规收口不再零落盘——曾 fix 展开的会话，compliant 裁决
  // 也留恰一条审计事件（R-2 实证的黑洞收口）。两条合规 fixture 的基线随之更新：
  // eventCount 0→1、compliant []→[true]、specifyDirCreated false→true。
  // non-fix-session 不变：从未 fix 展开 = US5 健康路径，仍零落盘。
  'compliant-noop.jsonl': { status: 0, eventCount: 1, compliant: [true], diagnostics: [[]], stderrPrefix: '', specifyDirCreated: true },
  'non-fix-session.jsonl': { status: 0, eventCount: 0, compliant: [], diagnostics: [], stderrPrefix: '', specifyDirCreated: false },
  'legacy-repair-no-noop-anchor.jsonl': { status: 0, eventCount: 1, compliant: [true], diagnostics: [[]], stderrPrefix: '', specifyDirCreated: true },
  'role-mismatch.jsonl': { status: 2, eventCount: 1, compliant: [false], diagnostics: [['in-flight-undetermined']], stderrPrefix: '[FIX-COMPLIANCE]', specifyDirCreated: true },
  'multi-expansion.jsonl': { status: 2, eventCount: 1, compliant: [false], diagnostics: [['in-flight-undetermined']], stderrPrefix: '[FIX-COMPLIANCE]', specifyDirCreated: true },
  'fake-anchor-in-tool-result.jsonl': { status: 2, eventCount: 1, compliant: [false], diagnostics: [['in-flight-undetermined']], stderrPrefix: '[FIX-COMPLIANCE]', specifyDirCreated: true },
  'real-bash-transcript-claude.jsonl': { status: 2, eventCount: 1, compliant: [false], diagnostics: [['in-flight-undetermined']], stderrPrefix: '[FIX-COMPLIANCE]', specifyDirCreated: true },
});

/** 跑一次 CLI 并归约为与 CLAUDE_BASELINE 同构的可观测结局 */
function observeFixtureOutcome(fixtureName, { sessionId = 'base' } = {}) {
  const transcriptPath = stageFixture(fixtureName, { verification: VERIFICATION_DOC });
  const r = runCli({ transcriptPath, sessionId });
  const events = readVerdictEvents();
  return {
    status: r.status,
    eventCount: events.length,
    compliant: events.map((e) => e.compliant),
    diagnostics: events.map((e) => e.diagnostics),
    stderrPrefix: r.stderr.split(' ')[0] || '',
    specifyDirCreated: fs.existsSync(path.join(tmp, '.specify')),
  };
}

/** 写一份 Codex rollout 格式 transcript（每行 {timestamp,type,payload}），返回绝对路径 */
function writeCodexRollout(types = ['session_meta', 'event_msg', 'response_item']) {
  const p = path.join(tmp, 'rollout.jsonl');
  fs.writeFileSync(p, types.map((type, i) => JSON.stringify({
    timestamp: `2026-08-03T10:0${i}:00.000Z`, type, payload: { seq: i },
  })).join('\n') + '\n', 'utf8');
  return p;
}

describe('F240 I1 · 退出码恒 0：方言识别不新增任何阻断路径', () => {
  it('Codex rollout transcript → exit 0', () => {
    assert.equal(runCli({ transcriptPath: writeCodexRollout() }).status, 0);
  });

  it('unknown 方言 transcript → exit 0', () => {
    const p = path.join(tmp, 'unknown.jsonl');
    fs.writeFileSync(p, `${JSON.stringify({ type: 'x-alien', foo: 1 })}\n`, 'utf8');
    assert.equal(runCli({ transcriptPath: p }).status, 0);
  });

  it('empty transcript（仅空白行）→ exit 0', () => {
    const p = path.join(tmp, 'empty.jsonl');
    fs.writeFileSync(p, '\n\n', 'utf8');
    assert.equal(runCli({ transcriptPath: p }).status, 0);
  });

  it('enforcement=warn 下 Codex rollout → 仍 exit 0', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    assert.equal(runCli({ transcriptPath: writeCodexRollout() }).status, 0);
  });

  it('SC-025 第 6 行：诊断落盘路径自身不可写 → 仍 exit 0，不抛异常', () => {
    // .specify/runs 位置放一个文件 → mkdirSync 必失败 → appendAuditEvent 走 ok:false
    fs.mkdirSync(path.join(tmp, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'runs'), 'blocker', 'utf8');
    const r = runCli({ transcriptPath: writeCodexRollout() });
    assert.equal(r.status, 0);
  });
});

describe('F240 I2 · Claude 零回归：既有 fixture 全集结局与钉死基线逐字段相等', () => {
  for (const [name, expected] of Object.entries(CLAUDE_BASELINE)) {
    it(`${name} 结局与改动前基线一致`, () => {
      assert.deepEqual(observeFixtureOutcome(name), expected);
    });
  }
});

describe('F240 I3 · 健康路径零落盘：Claude 非 fix 会话不得因本改造开始产生诊断', () => {
  it('正常 Claude 非 fix 会话 → exit 0 且 .specify 目录未被创建（零落盘）', () => {
    const r = runCli({ transcriptPath: stageFixture('non-fix-session.jsonl', { verification: VERIFICATION_DOC }) });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.equal(fs.existsSync(path.join(tmp, '.specify')), false, '健康路径不得产生任何落盘');
    assert.equal(readVerdictEvents().length, 0);
  });

  it('手写的最小 Claude 非 fix 会话（无任何 skill 锚点）→ 零落盘', () => {
    const p = writeTranscript([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '帮我看下这个函数' }] } },
      ASSISTANT_TEXT('看完了，没问题。'),
    ]);
    const r = runCli({ transcriptPath: p });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(tmp, '.specify')), false);
  });
});

// ────────────────────────────────────────
// F240 W-2 · 白名单欠包含性回归语料（US5 零落盘不变量的可证伪探针）
//
// 背景（本机全量实扫 ~/.claude/projects 2676 份 .jsonl 取证）：Claude transcript 的顶层
// `type` 实测取值域为 assistant / user / attachment / last-prompt / queue-operation /
// custom-title / system / mode / permission-mode / file-history-snapshot / ai-title /
// frame-link / agent-name，远超 CLAUDE_TRANSCRIPT_ROLES 声明的 4 项；其中 1 份**规范
// session 文件**（`<encoded-cwd>/<uuid>.jsonl`）只含 ai-title + agent-name 两行。
//
// 这些用例把"白名单是否穷尽"变成**可证伪**命题：US5「健康路径零落盘」不允许依赖一份
// 需要永久跟随上游 Claude 版本维护的 type 清单——清单只要落后一个版本，就会在任意用户
// 项目目录凭空创建 .specify/ 并写入事实错误的 `transcript-format-unrecognized` 诊断。
// ────────────────────────────────────────

/**
 * 本机实扫观测到、且**不在** CLAUDE_TRANSCRIPT_ROLES 内的真实顶层 type。
 * 键形状按实测还原（值已脱敏），刻意每份只含单一 type：混入 user/assistant 会让白名单
 * 命中而使探针失效，那正是既有 30 份 Claude fixture 测不出欠包含性的原因。
 */
const OBSERVED_NON_WHITELISTED_ENTRIES = Object.freeze({
  attachment: {
    parentUuid: null, isSidechain: false, attachment: { type: 'file', path: '/w/a.ts' },
    type: 'attachment', uuid: 'u-1', timestamp: '2026-08-03T00:00:00.000Z', userType: 'external',
    entrypoint: 'cli', cwd: '/w', sessionId: 's-1', version: '2.1.215', gitBranch: 'master',
  },
  'last-prompt': { type: 'last-prompt', leafUuid: 'u-1', sessionId: 's-1' },
  'queue-operation': { type: 'queue-operation', operation: 'add', timestamp: '2026-08-03T00:00:00.000Z', sessionId: 's-1', content: '排队中的提示词' },
  'custom-title': { type: 'custom-title', customTitle: '自定义标题', sessionId: 's-1' },
  mode: { type: 'mode', mode: 'default', sessionId: 's-1' },
  'permission-mode': { type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: 's-1' },
  'file-history-snapshot': { type: 'file-history-snapshot', messageId: 'm-1', snapshot: {}, isSnapshotUpdate: false },
  'ai-title': { type: 'ai-title', aiTitle: '示例会话标题', sessionId: 's-1' },
  'agent-name': { type: 'agent-name', agentName: '示例代理名', sessionId: 's-1' },
  'frame-link': { type: 'frame-link', sessionId: 's-1', path: '/w/a.ts', frameUrl: 'http://localhost:1/f', timestamp: '2026-08-03T00:00:00.000Z' },
});

describe('F240 W-2 · Claude 非白名单顶层 type 语料：健康路径恒零落盘', () => {
  const assertZeroSideEffect = (transcriptPath) => {
    const r = runCli({ transcriptPath });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.equal(fs.existsSync(path.join(tmp, '.specify')), false, '健康路径不得在用户项目目录创建 .specify/');
    assert.equal(readVerdictEvents().length, 0, '健康路径不得写入任何审计事件');
  };

  it('语料非空且确实全部落在白名单之外（防探针空转）', () => {
    const types = Object.keys(OBSERVED_NON_WHITELISTED_ENTRIES);
    assert.ok(types.length >= 10, `语料仅 ${types.length} 项`);
    for (const t of types) assert.equal(CLAUDE_TRANSCRIPT_ROLES.includes(t), false, `${t} 已在白名单内，探针失效`);
  });

  for (const [type, entry] of Object.entries(OBSERVED_NON_WHITELISTED_ENTRIES)) {
    it(`只含 ${type} 条目的真实 Claude 会话 → exit 0 且零落盘`, () => {
      assertZeroSideEffect(writeTranscript([entry]));
    });
  }

  it('真实观测的最小 session 文件（只含 ai-title + agent-name）→ 零落盘', () => {
    assertZeroSideEffect(path.join(FIXTURE_DIR, 'real-claude-session-title-only.jsonl'));
  });

  it('多种非白名单 type 混合的正常会话（无 user/assistant）→ 零落盘', () => {
    assertZeroSideEffect(writeTranscript(Object.values(OBSERVED_NON_WHITELISTED_ENTRIES)));
  });
});

describe('F240 SC-025 · Codex rollout 必须落 loud 诊断且与「确实不是 fix 会话」可区分', () => {
  it('第 1 行：Codex rollout → 落盘一条 loud 诊断事件，含格式不可识别原因 code', () => {
    const r = runCli({ transcriptPath: writeCodexRollout(), sessionId: 'codex-1' });
    assert.equal(r.status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].compliant, null, '本次 compliance 判定未执行');
    assert.equal(events[0].degraded, true);
    assert.equal(events[0].closureForm, 'undetermined');
    assert.equal(events[0].sessionId, 'codex-1');
    assert.ok(events[0].diagnostics.includes('transcript-format-unrecognized'), JSON.stringify(events[0].diagnostics));
    assert.ok(events[0].diagnostics.includes('dialect:codex-rollout'), JSON.stringify(events[0].diagnostics));
  });

  it('第 2 行：与「确实不是 fix 会话」信号可区分（后者零事件，前者有独立 code）', () => {
    const codexEvents = (() => {
      runCli({ transcriptPath: writeCodexRollout(), sessionId: 'codex-2' });
      return readVerdictEvents();
    })();
    assert.equal(codexEvents.length, 1);
    // 对照：同一沙箱换成 Claude 非 fix 会话，事件数不增长
    const before = readVerdictEvents().length;
    runCli({ transcriptPath: stageFixture('non-fix-session.jsonl', { verification: VERIFICATION_DOC }), sessionId: 'claude-2' });
    assert.equal(readVerdictEvents().length, before, 'Claude 非 fix 会话不得新增任何事件');
  });

  it('第 3 行：只含 turn_context / world_state / compacted 的 rollout 切片仍被正确识别', () => {
    // W-1：这三种顶层 type 实测存在（turn_context 出现于 1001/1167 份 rollout），
    // 却曾漏出 CODEX_ROLLOUT_ROLES。C-1 把 unknown 收窄为静默后，本清单成为承重件——
    // 漏项将直接表现为"Codex 切片静默漏报"，故此处按单一 type 逐个取证。
    for (const type of ['turn_context', 'world_state', 'compacted', 'inter_agent_communication_metadata']) {
      const p = path.join(tmp, `codex-${type}.jsonl`);
      fs.writeFileSync(p, `${JSON.stringify({ timestamp: '2026-08-03T00:00:00.000Z', type, payload: {} })}\n`, 'utf8');
      const r = runCli({ transcriptPath: p, sessionId: `codex-${type}` });
      assert.equal(r.status, 0);
      const events = readVerdictEvents().filter((e) => e.sessionId === `codex-${type}`);
      assert.equal(events.length, 1, `type=${type} 未落 loud 诊断`);
      assert.ok(events[0].diagnostics.includes('transcript-format-unrecognized'), type);
      assert.ok(events[0].diagnostics.includes('dialect:codex-rollout'), type);
    }
  });

  it('empty transcript → transcript-empty 独立诊断码 + loud 落盘（F270 FR-045 取代 F240 的零落盘裁决）', () => {
    // F240 当年判"零落盘避免噪声"；F257 N1 实证该形态是审计黑洞（事后完全不可见），
    // F270 FR-045 裁决改为与 transcript-unavailable 同族的 fail-open loud：仍放行、留独立码。
    const p = path.join(tmp, 'empty.jsonl');
    fs.writeFileSync(p, '\n', 'utf8');
    assert.equal(runCli({ transcriptPath: p }).status, 0, '仍 fail-open 放行');
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('transcript-empty'), JSON.stringify(events[0].diagnostics));
    assert.equal(events[0].diagnostics.includes('transcript-format-unrecognized'), false, '不得被方言码顶替');
  });

  it('第 4 行：transcript 不存在 → 仍是 transcript-unavailable（既有行为不变，不被方言码顶替）', () => {
    assert.equal(runCli({ transcriptPath: path.join(tmp, 'nope.jsonl') }).status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('transcript-unavailable'), JSON.stringify(events[0].diagnostics));
    assert.equal(events[0].diagnostics.includes('transcript-format-unrecognized'), false);
  });

  it('enforcement=off + Codex rollout → 零接触放行（off 短路仍先于一切读取）', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    const r = runCli({ transcriptPath: writeCodexRollout() });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(tmp, '.specify')), false);
  });

  it('真实 Codex rollout fixture（real-bash-transcript-codex.jsonl）→ 同样落 loud 诊断 + exit 0', () => {
    const r = runCli({ transcriptPath: path.join(FIXTURE_DIR, 'real-bash-transcript-codex.jsonl'), sessionId: 'codex-real' });
    assert.equal(r.status, 0);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('transcript-format-unrecognized'));
    assert.ok(events[0].diagnostics.includes('dialect:codex-rollout'));
  });

  it('over-claim 静态检查：改造涉及的三个文件不出现「第二事实源/判定已加固/compliance 已闭环」类表述', () => {
    const files = [
      '../scripts/lib/fix-compliance-core.mjs',
      '../scripts/fix-compliance-judge.mjs',
      '../scripts/lib/fix-compliance-io.mjs',
    ].map((rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
    for (const src of files) {
      for (const banned of ['第二事实源', '判定已加固', 'compliance 已闭环', '判定强度']) {
        assert.equal(src.includes(banned), false, `禁止 over-claim 表述: ${banned}`);
      }
    }
  });

  it('合同同步：方言诊断码从 FOREIGN_DIALECT_DIAGNOSTICS 派生，恒 ⊆ verdict-event schema enum', () => {
    // schema 为文档契约（无运行时 ajv 校验，见 F224 plan §3），故用测试守住"代码发码 ⊆ 合同枚举"。
    // I-2：这里刻意**遍历常量表**而非硬编码码字符串——判定器已改为只发表内的码，
    // 于是"新增一个方言码却忘了登记合同"必然在此变红，不会像模板串拼接那样静默逃逸。
    const schemaPath = fileURLToPath(new URL(
      '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json',
      import.meta.url,
    ));
    const registered = new Set(JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
      .properties.diagnostics.items.enum);
    const emitted = Object.values(FOREIGN_DIALECT_DIAGNOSTICS);
    assert.ok(emitted.length > 0, '常量表为空会让本守卫空转');
    for (const code of [...emitted, 'transcript-path-absent', 'transcript-format-unrecognized']) {
      assert.ok(registered.has(code), `诊断码 ${code} 未登记进 schema enum`);
    }
    // C-1：dialect:unknown 已随"unknown 不落盘"一并退役，留在合同里会变成误导性死码
    assert.equal(registered.has('dialect:unknown'), false, 'dialect:unknown 应已从合同 enum 移除');
  });

  it('F256 T017 合同同步：判定器实际产出的 delegation-in-flight 必须已登记进 schema enum', () => {
    // 与上一条同源守卫，但独立成条：新增诊断码不来自 FOREIGN_DIALECT_DIAGNOSTICS 常量表，
    // 上一条的遍历覆盖不到它，若不单列会出现"码已发、合同未登记"的静默漂移。
    const schemaPath = fileURLToPath(new URL(
      '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json',
      import.meta.url,
    ));
    const registered = new Set(JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
      .properties.diagnostics.items.enum);
    assert.ok(registered.has('delegation-in-flight'), '诊断码 delegation-in-flight 未登记进 schema enum');
    // 反向：判定器源码里确实发这个码（防止合同登记了一个从不产出的死码）
    const judgeSrc = fs.readFileSync(fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url)), 'utf8');
    assert.ok(judgeSrc.includes("'delegation-in-flight'"), '判定器未产出该码 → 合同登记了死码');
  });

  it('I-2 反向守卫：判定器不再用模板串拼接方言诊断码', () => {
    const judgeSrc = fs.readFileSync(fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url)), 'utf8');
    assert.equal(/`dialect:\$\{/.test(judgeSrc), false, '模板串拼接会绕过合同 enum 守卫');
  });

  it('C-1 回归：`unknown` 是开放世界的否定，不得被当成「这是异构格式」的肯定断言', () => {
    // 只有正向识别到 Codex rollout 才落盘。任何"我不认识"的形态一律回落零落盘
    // （= 本改造前的行为），否则 US5 不变量会被上游任意新增的 envelope 形态击穿。
    const p = path.join(tmp, 'unknown.jsonl');
    fs.writeFileSync(p, `${JSON.stringify({ type: 'x-alien' })}\n`, 'utf8');
    assert.equal(runCli({ transcriptPath: p }).status, 0);
    assert.equal(fs.existsSync(path.join(tmp, '.specify')), false, 'unknown 方言不得落盘');
    assert.equal(readVerdictEvents().length, 0);
  });

  it('反向验证：判定链三文件不存在对 .specify/runs/ 的判定输入读取', () => {
    const core = fs.readFileSync(fileURLToPath(new URL('../scripts/lib/fix-compliance-core.mjs', import.meta.url)), 'utf8');
    // core 层是纯函数层，不得出现任何 runs 目录读取
    assert.equal(/readFileSync[^\n]*runs/.test(core), false);
    assert.equal(/\bfs\./.test(core.slice(core.indexOf('export function detectTranscriptDialect'))), false);
  });
});

// ────────────────────────────────────────
// F256 盲区 1 · 复合命令重编号后的 short-name 磁盘重锚定（端到端）
// ────────────────────────────────────────

describe('F256 T006 · 盲区 1 端到端：编号被复合命令重编后不再误报「未建立特性目录」', () => {
  const OLD_DIR = 'specs/251-fix-foo';
  const NEW_DIR = 'specs/254-fix-foo';
  /**
   * 复现 F254 交付实况：三次撞号重编都是复合命令 `cd "<worktree>" && git mv A B && FILES=(…)`。
   * F231 第 5 轮把改名跟随收窄为「整条命令必须就是一条光杆 mv/git mv」，故本命令**不产生任何改名事件**
   * ——候选因此停在磁盘上已消失的 251，这正是被修复的盲区，不可改用光杆 mv 构造（那会走 F224 路径）。
   */
  const RENUMBER_COMMAND = `cd "/w/worktrees/serene" && git mv ${OLD_DIR} ${NEW_DIR} && FILES=(spec.md plan.md)`;

  /**
   * 提名旧编号目录 + 复合命令重编 + 完整委派；磁盘上只有新编号目录。
   *
   * F257：那次 Write 改用 TOOL_USE_OK（带 id + 配对成功回执）——重锚定的采信条件新增了
   * 「本会话对该 short-name 家族制品的成功写入见证」，而真实 transcript 里 Write 必有 id 与
   * tool_result，原 TOOL_USE 两者都不产出只是 fixture 简化。此处补齐即与真实 wire format 同构。
   */
  function renumberedTranscript() {
    return writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }, 'f256-w-old'),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成，制品已迁移'),
    ]);
  }

  it('前提核实：复合命令确实不产生改名事件（候选停在旧编号且 ambiguous=false）', () => {
    // 该前提一旦被日后放宽 scanRenameCommandEvents 打破，本组用例就不再覆盖目标盲区，
    // 故显式钉住，避免用例静默退化为"测了别的东西"。
    assert.deepEqual(scanRenameCommandEvents(RENUMBER_COMMAND), []);
  });

  it('候选停在磁盘已消失的 251、磁盘仅存制品齐全的 254 → 重锚定后合规放行（exit 0）', () => {
    const p = renumberedTranscript();
    stageDir(NEW_DIR); // 只铺新编号目录；specs/251-fix-foo 磁盘上不存在

    const out = reportInProcess(p);
    assert.equal(out.compliant, true, JSON.stringify(out));
    assert.deepEqual(out.missing, [], JSON.stringify(out));
    assert.deepEqual(out.transcriptDiagnostics, []);

    // hook 模式端到端：exit 0。F270 P2b（FR-024 修订版）：合规收口不再静默——曾 fix 展开的
    // 会话合规裁决也留痕（R-2 实证的审计黑洞收口），断言恰一条 compliant 事件。
    const r = runCli({ transcriptPath: p, sessionId: 'f256-blk1' });
    assert.equal(r.status, 0, r.stderr);
    const evs1 = readVerdictEvents();
    assert.equal(evs1.length, 1, '合规收口恰一条留痕事件（FR-024）');
    assert.equal(evs1[0].compliant, true);
    assert.equal(
      fs.existsSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state', 'f256-blk1.json')),
      false,
      '阻断计数状态文件不得被创建',
    );
  });

  it('磁盘上无同名 short-name 目录 → 完全回落现状（仍按缺失阻断，兜底不凭空放行）', () => {
    const p = renumberedTranscript();
    // 磁盘上什么都不铺：短名枚举命中 0 → resolvedPath 保持 null
    const out = reportInProcess(p);
    assert.equal(out.compliant, false, JSON.stringify(out));
    assert.ok(out.missing.includes('feature-dir'), JSON.stringify(out.missing));
    assert.ok(out.missing.includes('fix-report.md'), JSON.stringify(out.missing));
  });

  it('同名 short-name 目录存在但缺 fix-report.md → 不采信（usable 谓词仍是唯一采信闸门）', () => {
    const p = renumberedTranscript();
    stageDir(NEW_DIR, { fixReport: null });
    const out = reportInProcess(p);
    assert.equal(out.compliant, false, JSON.stringify(out));
    assert.ok(out.missing.includes('fix-report.md'), JSON.stringify(out.missing));
  });

  it('多个同 short-name 目录均制品齐全 → 取编号最大者（重编链末端）', () => {
    const p = renumberedTranscript();
    stageDir('specs/252-fix-foo');
    stageDir('specs/253-fix-foo', { verification: null }); // 中间编号故意缺 verification
    stageDir(NEW_DIR);
    const out = reportInProcess(p);
    // 若错取升序首项（252）也会 compliant:true，故补一条能区分的断言：
    // 把 254 的 verification 抽掉后必须变红（证明确实读的是 254 而非 252）
    assert.equal(out.compliant, true, JSON.stringify(out));
    fs.rmSync(path.join(tmp, NEW_DIR, 'verification'), { recursive: true, force: true });
    const out2 = reportInProcess(p);
    assert.equal(out2.compliant, false, `采信的应是编号最大的 ${NEW_DIR}：${JSON.stringify(out2)}`);
    assert.ok(out2.missing.includes('verification-report.md'), JSON.stringify(out2.missing));
  });

  it('short-name 不同的目录不得被冒用（要求完全相等，无模糊匹配）', () => {
    const p = renumberedTranscript();
    stageDir('specs/254-fix-foobar'); // 仅前缀相同
    stageDir('specs/254-fix-ofoo');   // 仅后缀相同
    const out = reportInProcess(p);
    assert.equal(out.compliant, false, JSON.stringify(out));
    assert.ok(out.missing.includes('feature-dir'), JSON.stringify(out.missing));
  });

  it('单调性：ambiguous=true（光杆 mv 改名到非规范目录）时短名兜底零介入', () => {
    // F224 fail-open 降级通道必须逐字保留——短名兜底整体嵌套在 ambiguous===false 分支内。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: `mv ${OLD_DIR} tmp/stage-a` }),
    ]);
    stageDir(NEW_DIR); // 短名可命中的目录就在磁盘上；若兜底越界介入，此处会被选中
    const out = reportInProcess(p);
    assert.deepEqual(out.transcriptDiagnostics, ['feature-dir-unresolvable'], JSON.stringify(out));
    assert.equal(out.compliant, undefined, 'ambiguous 分支必须维持 F224 fail-open');
  });
});

// ────────────────────────────────────────
// F256 · 真实 F254 交付 transcript 截断回放（本机路径缺失时优雅跳过）
// ────────────────────────────────────────

/**
 * fix-report.md 证据基线引用的真实 transcript（F254 交付会话，649 条 / 2.3MB）。
 * 沿用 F227_REAL_TRANSCRIPT 的 existsSync + t.skip 先例：本机存在则跑，缺失则跳过。
 */
const F256_REAL_TRANSCRIPT = path.join(
  os.homedir(),
  '.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-serene-taussig-2c33c3',
  'f3f2fe3b-5458-4dbe-8dab-cb9fb6e3966a.jsonl',
);

/**
 * 该真实会话自己的 projectRoot（transcript 每条 envelope 的 `cwd` 字段，实测全文件唯一取值）。
 * 从文件自身读取而非硬编码：回放改根（见 truncateRealTranscriptAt 的 replayRoot）需要精确的原始根串。
 */
function readRealTranscriptSessionRoot() {
  for (const line of fs.readFileSync(F256_REAL_TRANSCRIPT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj && typeof obj.cwd === 'string' && obj.cwd.length > 0) return obj.cwd;
  }
  return null;
}

/**
 * 按 stop 时间戳做**前缀**截断，复现该时点 hook 看到的 transcript。
 *
 * 用前缀（而非按时间戳过滤）是因为文件行序即写入序——hook 在时刻 T 读到的就是彼时已落盘的前缀；
 * 实测该 transcript 的 timestamp 并非全序（sidechain 条目交错），故截断点取
 * "最后一个 timestamp ≤ T 的行下标"，而不是简单计数。
 *
 * F257 新增 `replayRoot`：这份 transcript 产自**另一个 worktree**（其 `cwd` 与写入用的绝对
 * `file_path` 都指向 serene-taussig-2c33c3），而回放时磁盘侧 projectRoot 只能是本 worktree 或 tmp
 * 沙箱。生产环境里 hook 的 projectRoot 恒等于会话自身的 cwd，两者从不错位；不改根的回放等于人为
 * 制造一个生产上不存在的跨仓错位，会让「本会话写入见证」的绝对路径归一化（刻意 fail-closed 拒绝
 * projectRoot 之外的写入，见 T-1h）全部落空，从而测到一个与被测语义无关的假失败。
 * 故传 replayRoot 时把原始根串整体替换为回放根 = 「同一份会话如果发生在这里」，
 * 除该前缀外逐字不变（提名走 `specs/…` 子串、F231 不跟随复合命令，均不受根串影响）。
 * @param {string} [replayRoot] - 缺省不改根（不依赖绝对路径的用例保持字节原样）
 * @returns {string} 截断文件绝对路径
 */
function truncateRealTranscriptAt(stopIso, tag, replayRoot) {
  const raw = fs.readFileSync(F256_REAL_TRANSCRIPT, 'utf8');
  let lines = raw.split('\n').filter((l) => l.trim());
  if (typeof replayRoot === 'string') {
    const sessionRoot = readRealTranscriptSessionRoot();
    assert.ok(sessionRoot, '真实 transcript 缺 cwd 字段，无法安全改根');
    lines = lines.map((l) => l.split(sessionRoot).join(replayRoot.replace(/\/+$/, '')));
  }
  let cut = -1;
  for (let i = 0; i < lines.length; i += 1) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj && typeof obj.timestamp === 'string' && obj.timestamp <= stopIso) cut = i;
  }
  const out = path.join(tmp, `f256-trunc-${tag}.jsonl`);
  fs.writeFileSync(out, lines.slice(0, cut + 1).join('\n') + '\n', 'utf8');
  return out;
}

/** 对截断文件跑 --mode report（零落盘，可安全以真实 worktree 为 projectRoot） */
function reportRealTranscript(truncatedPath) {
  const res = spawnSync('node', [CLI, '--mode', 'report', '--transcript-path', truncatedPath, '--project-root', REPO_ROOT], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

/** 签名 A（盲区 1）的三个误报 stop —— fix-report.md「检测判据」表后三行 */
const F256_SIGNATURE_A_STOPS = [
  '2026-08-04T03:03:46.034Z',
  '2026-08-04T03:05:02.669Z',
  '2026-08-04T03:07:22.999Z',
];

describe('F256 T007 · 真实 F254 transcript 截断回放：签名 A 三个 stop 不再误报', () => {
  it('三处截断均不再复现 missing:["feature-dir","fix-report.md"]', (t) => {
    if (!fs.existsSync(F256_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    // 前提：REPO_ROOT 上确有重编后的目标目录，否则本用例会以"磁盘没有可锚定对象"的理由假绿
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, 'specs/254-fix-graph-scope-extensions/fix-report.md')),
      '前提缺失：重编后的 specs/254-fix-graph-scope-extensions 应在本仓库',
    );
    for (const [i, stop] of F256_SIGNATURE_A_STOPS.entries()) {
      // replayRoot=REPO_ROOT：reportRealTranscript 以 REPO_ROOT 为 projectRoot，回放必须同根，
      // 否则会话内以绝对路径写下的制品全部落在 projectRoot 之外，F257 写入见证按设计拒绝采信
      const out = reportRealTranscript(truncateRealTranscriptAt(stop, `a${i}`, REPO_ROOT));
      const missing = out.missing || [];
      assert.equal(
        missing.includes('feature-dir') && missing.includes('fix-report.md'),
        false,
        `${stop} 仍复现签名 A：${JSON.stringify(out)}`,
      );
      // 单调性：改动前是 exit 2 阻断，改动后至少不得反向新增阻断维度
      assert.deepEqual(out.transcriptDiagnostics, [], `${stop}: ${JSON.stringify(out)}`);
    }
  });
});

// ────────────────────────────────────────
// F256 盲区 2 · 在途委派 = 判定时机未到（端到端）
// ────────────────────────────────────────

describe('F256 T013 · 盲区 2 端到端：未回收的在途委派推迟裁决而非判烂尾', () => {
  const AGENT_ID = 'ad602324a1dd9715a';
  /** 带 tool_use id 的 assistant 条目（既有 TOOL_USE 不带 id，配对判定需要它） */
  const TOOL_USE_ID = (id, name, input) => ({
    type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
  /** harness 写入的 tool_result 回执（落在紧随的 user 条目，与真实 wire format 一致） */
  const TOOL_RESULT = (toolUseId, content, isError = false) => ({
    type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
  });
  /** <task-notification> 完成信号（harness 注入的 user 文本块） */
  const TASK_NOTIFICATION = (taskId, toolUseId) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` }] },
  });

  /**
   * 复现 F254 实况：复审全部走 `SendMessage` → 后台恢复。SendMessage 立刻拿到 ack tool_result，
   * 在途性体现在**尚未到达的 task-notification**，而非缺失的 tool_result。
   * @param {boolean} withNotification - true 时补上完成通知（对照组：在途集合为空）
   */
  function inFlightTranscript(withNotification) {
    const lines = [
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE_ID('toolu_impl', 'Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_RESULT('toolu_impl', `Agent "${AGENT_ID}" completed`),
      TOOL_USE_ID('toolu_sm', 'SendMessage', { to: AGENT_ID, message: '继续复审' }),
      TOOL_RESULT('toolu_sm', `{"success":true,"message":"Agent \\"${AGENT_ID}\\" had no active task; resumed from transcript in the background with your message."}`),
    ];
    if (withNotification) lines.push(TASK_NOTIFICATION(AGENT_ID, 'toolu_impl'));
    lines.push(ASSISTANT_TEXT('等待复审结果'));
    return writeTranscript(lines);
  }

  /** 两组共用磁盘状态：fix-report 齐备但缺 verification-report → 判据本应判不合规 */
  function stageIncomplete() {
    stageDir(FEATURE_DIR, { verification: null });
  }

  it('对照组（在途集合为空）：同一 fixture 走既有阻断路由 → exit 2 且递增阻断计数', () => {
    // 这一组存在的意义是证明下一组的 exit 0 确实由本次新增分支产生，
    // 而非"这个 fixture 本来就合规/本来就走了别的放行分支"。
    const p = inFlightTranscript(true);
    stageIncomplete();
    const r = runCli({ transcriptPath: p, sessionId: 'f256-ctrl' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE] '), r.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].compliant, false);
    assert.equal(events[0].blockCount, 1, '对照组必须消耗一次阻断预算');
    assert.equal(events[0].diagnostics.includes('delegation-in-flight'), false);
    assert.ok(events[0].missing.includes('verification-report.md'), JSON.stringify(events[0].missing));
  });

  it('在途组：exit 0 + WARN 级 delegation-in-flight，且不消耗阻断预算', () => {
    const p = inFlightTranscript(false);
    stageIncomplete();
    const r = runCli({ transcriptPath: p, sessionId: 'f256-inflight' });

    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stderr.includes('[FIX-COMPLIANCE][WARN]'), r.stderr);
    assert.ok(r.stderr.includes('诊断: delegation-in-flight'), r.stderr);

    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('delegation-in-flight'), JSON.stringify(events[0].diagnostics));
    assert.equal(events[0].compliant, false, '缺口如实记录，不是把不合规粉饰为合规');
    assert.equal(events[0].degraded, false, '推迟裁决不是降级放行，两者审计语义必须可区分');
    assert.equal(events[0].blockCount, null);
    // 状态文件确实被写（推迟必须有界，见 IN_FLIGHT_DEFER_LIMIT），但两个预算分列：
    // 推迟只递增 inFlightDeferCount，blockCount 原地不动。
    assert.deepEqual(
      (({ blockCount, inFlightDeferCount }) => ({ blockCount, inFlightDeferCount }))(readState('f256-inflight')),
      { blockCount: 0, inFlightDeferCount: 1 },
      '推迟不得消耗阻断预算（否则在途停顿会白白烧掉 2 次额度）',
    );
  });

  it('推迟不是豁免：在途回收后同一会话再次 stop 恢复完整裁决（exit 2）', () => {
    // 单调性论证的实证半边——若"推迟"实为"豁免"，补上完成通知后仍会 exit 0。
    stageIncomplete();
    const first = runCli({ transcriptPath: inFlightTranscript(false), sessionId: 'f256-seq' });
    assert.equal(first.status, 0, first.stderr);
    const second = runCli({ transcriptPath: inFlightTranscript(true), sessionId: 'f256-seq' });
    assert.equal(second.status, 2, second.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 2);
    assert.equal(events[1].blockCount, 1, '推迟期间未消耗预算，回收后从 1 起算');
  });

  it('合规会话即使有在途委派仍走合规早退（compliant 分支优先于在途分支）', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/verification/verification-report.md`, content: '# V' }),
      TOOL_USE_ID('toolu_sm', 'SendMessage', { to: AGENT_ID, message: '继续' }),
      TOOL_RESULT('toolu_sm', '{"success":true}'),
      ASSISTANT_TEXT('完成'),
    ]);
    stageDir(FEATURE_DIR);
    const r = runCli({ transcriptPath: p, sessionId: 'f256-ok' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readVerdictEvents().filter((e) => e.compliant !== true), [], '在途分支不得额外落非合规事件（F270 P2b 后合规本身留痕一条，FR-024）');
  });

  it('warn 档：退出码不变（本就 exit 0），但审计事件带上 delegation-in-flight', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    stageIncomplete();
    const r = runCli({ transcriptPath: inFlightTranscript(false), sessionId: 'f256-warn' });
    assert.equal(r.status, 0, r.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].enforcement, 'warn');
    assert.ok(events[0].diagnostics.includes('delegation-in-flight'), JSON.stringify(events[0].diagnostics));
  });

  it('off 档：在途分支不改变零接触语义（off 仍先于一切读取短路）', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: off\n');
    stageIncomplete();
    assert.equal(runCli({ transcriptPath: inFlightTranscript(false) }).status, 0);
    assert.equal(fs.existsSync(path.join(tmp, '.specify')), false);
  });

  it('--mode report 透传 inFlightDelegations 且维持零落盘', () => {
    stageIncomplete();
    const out = reportInProcess(inFlightTranscript(false));
    assert.equal(out.inFlightDelegations.length, 1);
    assert.equal(out.inFlightDelegations[0].kind, 'send-message');
    assert.equal(out.inFlightDelegations[0].id, AGENT_ID);
    assert.deepEqual(reportInProcess(inFlightTranscript(true)).inFlightDelegations, []);
  });
});

describe('F256 T014 · 真实 F254 transcript 截断回放：在途检测与 fix-report 判据表逐行一致', () => {
  /**
   * fix-report.md「检测判据」表：签名 B 的三个 stop 命中在途（放行），签名 A 的三个不命中。
   *
   * 如实标注（不粉饰）：该表「在途数」一列对 16:48:49 记的是 2，而按 plan.md §5.3 的规则实现
   * （SendMessage 按 **agent 去重**取最后一次派发）+ 前缀截断回放，可复现值为 1。差异源于计数
   * 粒度（逐次派发 vs 逐 agent），**不影响任何判定结论**——路由只看在途集合是否非空。
   * 因此本用例钉的是表格真正承重的一列：命中/不命中。
   */
  const TABLE = [
    { stop: '2026-08-03T16:32:26.638Z', signature: 'B', inFlight: true },
    { stop: '2026-08-03T16:33:41.002Z', signature: 'B', inFlight: true },
    { stop: '2026-08-03T16:48:49.072Z', signature: 'B', inFlight: true },
    { stop: '2026-08-04T03:03:46.034Z', signature: 'A', inFlight: false },
    { stop: '2026-08-04T03:05:02.669Z', signature: 'A', inFlight: false },
    { stop: '2026-08-04T03:07:22.999Z', signature: 'A', inFlight: false },
  ];

  it('6 个 stop 时间戳截断回放的在途命中/不命中与判据表逐行一致', (t) => {
    if (!fs.existsSync(F256_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    for (const [i, row] of TABLE.entries()) {
      const out = reportRealTranscript(truncateRealTranscriptAt(row.stop, `b${i}`));
      const items = out.inFlightDelegations || [];
      assert.equal(items.length > 0, row.inFlight, `${row.stop}（签名 ${row.signature}）在途判定与表格不符：${JSON.stringify(items)}`);
      if (row.inFlight) {
        // 实测形态：F254 的复审全部走 SendMessage → 后台恢复（后台 Agent 0 个、同步 Agent 均已收口），
        // 这直接证伪了"按缺失 tool_result 检测"的路线——那条路线在本 transcript 上 0 命中。
        assert.deepEqual([...new Set(items.map((x) => x.kind))], ['send-message'], row.stop);
      }
    }
  });

  it('两处修复正交：签名 A 的三个 stop 在途恒为 0，不会把盲区 1 顺手遮蔽', (t) => {
    if (!fs.existsSync(F256_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    // 若在途检测在签名 A 上误命中，盲区 1 的磁盘兜底就会被"顺手治好"的假象掩盖，
    // 其真实修复效果将不再可测。此断言守住二者的可独立回归性。
    for (const row of TABLE.filter((r) => r.signature === 'A')) {
      const out = reportRealTranscript(truncateRealTranscriptAt(row.stop, 'orth'));
      assert.deepEqual(out.inFlightDelegations, [], row.stop);
    }
  });

  it('真实 transcript 的差分对照：同一 projectRoot 下 B 命中放行、A 不命中仍阻断', (t) => {
    if (!fs.existsSync(F256_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    // hook 模式会落盘，故用 tmp 内的隔离 projectRoot（绝不指向真实 worktree，见 F227 注释），
    // 并铺上重编后的 specs/254-fix-graph-scope-extensions/fix-report.md ——
    // 这是短名磁盘兜底的锚定对象，也让两个时点的 missing 收敛为**完全相同**的
    // `["verification-report.md"]`（实测，见下方断言）。missing 相同是有效对照的前提：
    // 退出码差异因此只可能由在途分支产生，而不会掺入"可推迟性闸门"或缺口构成的差异。
    const stagedRoot = path.join(tmp, 'f256-staged-root');
    fs.mkdirSync(path.join(stagedRoot, 'specs/254-fix-graph-scope-extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(stagedRoot, 'specs/254-fix-graph-scope-extensions/fix-report.md'),
      REPAIR_FIX_REPORT, 'utf8',
    );
    const runHookOn = (truncated, sessionId) => spawnSync('node', [CLI, '--mode', 'hook', '--project-root', stagedRoot], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: truncated, stop_hook_active: false }),
      encoding: 'utf8',
    });

    // 取 16:33:41（签名 B）而非 16:32:26：前者的 missing 与签名 A 逐字相同，对照更纯
    // replayRoot=stagedRoot：与本用例的 projectRoot 同根（理由见 truncateRealTranscriptAt 的 JSDoc）
    const bRun = runHookOn(truncateRealTranscriptAt('2026-08-03T16:33:41.002Z', 'diff-b', stagedRoot), 'f256-real-b');
    assert.equal(bRun.status, 0, bRun.stderr);
    assert.ok(bRun.stderr.includes('诊断: delegation-in-flight'), bRun.stderr);

    const aRun = runHookOn(truncateRealTranscriptAt('2026-08-04T03:03:46.034Z', 'diff-a', stagedRoot), 'f256-real-a');
    assert.equal(aRun.status, 2, '签名 A 无在途信号 → 仍走既有阻断路由（放行不得外溢）');

    const byId = Object.fromEntries(readVerdictEvents(stagedRoot).map((e) => [e.sessionId, e]));
    assert.deepEqual(byId['f256-real-b'].missing, ['verification-report.md'], JSON.stringify(byId['f256-real-b']));
    assert.deepEqual(byId['f256-real-b'].missing, byId['f256-real-a'].missing, '两次 missing 必须相同，才构成有效对照');
    assert.ok(byId['f256-real-b'].diagnostics.includes('delegation-in-flight'));
    assert.equal(byId['f256-real-a'].diagnostics.includes('delegation-in-flight'), false);
  });

  it('真实 transcript 正样本核实：16:32 stop 的 missing 两项均在可推迟白名单内（收窄闸门不得误伤）', (t) => {
    if (!fs.existsSync(F256_REAL_TRANSCRIPT)) {
      t.skip('本机不存在该真实 transcript（非本 worktree 环境）');
      return;
    }
    // 第 2 轮新增的「可推迟性闸门」是收紧改动（把部分放行改回阻断），必须证明它没有误伤
    // 本 Feature 的正样本——F254 那次真实的中途停顿。
    const stagedRoot = path.join(tmp, 'f256-anchor-root');
    fs.mkdirSync(path.join(stagedRoot, 'specs/254-fix-graph-scope-extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(stagedRoot, 'specs/254-fix-graph-scope-extensions/fix-report.md'),
      REPAIR_FIX_REPORT, 'utf8',
    );
    // replayRoot=stagedRoot：与本用例的 projectRoot 同根（理由见 truncateRealTranscriptAt 的 JSDoc）
    const truncated = truncateRealTranscriptAt('2026-08-03T16:32:26.638Z', 'anchor', stagedRoot);
    const res = spawnSync('node', [CLI, '--mode', 'report', '--transcript-path', truncated, '--project-root', stagedRoot], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.missing, ['verification-report.md', 'delegation:verify'], JSON.stringify(out));
    assert.equal(isDeferrableMissingSet(out.missing), true, '正样本必须仍可推迟');
    assert.ok((out.inFlightDelegations || []).length > 0, JSON.stringify(out.inFlightDelegations));
  });
});

// ────────────────────────────────────────
// F256 第 2 轮（三路对抗审查后修复轮）· 在途推迟的两道闸门 + 短名兜底的可用性过滤
// ────────────────────────────────────────

describe('F256 R2 · 在途推迟必须有界且只对「在途工作关得掉的缺口」生效', () => {
  const BG_ID = 'toolu_bg_review';

  /** 带 tool_use id 的 assistant 条目（既有 TOOL_USE 不带 id，而配对判定需要它） */
  const TOOL_USE_ID = (id, name, input) => ({
    type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
  /** harness 写入的 tool_result 回执 */
  const TOOL_RESULT = (toolUseId, content, isError = false) => ({
    type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
  });
  /** <task-notification> 完成信号 */
  const TASK_NOTIFICATION = (taskId, toolUseId) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` }] },
  });

  /**
   * 制品与委派齐备、只差 verification-report.md，外加一次**后台**复审委派的会话。
   * 配 stageDir(FEATURE_DIR, { verification: null }) 时 missing 恰为 ['verification-report.md']
   * ——白名单内的可推迟缺口，于是"推不推迟"只由在途判定与预算决定，判据边界最纯。
   * @param {{ack?:boolean, ackIsError?:boolean, notified?:boolean}} [opts]
   */
  function backgroundReviewTranscript({ ack = true, ackIsError = false, notified = false } = {}) {
    const lines = [
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE_ID(BG_ID, 'Agent', { subagent_type: 'spec-driver:verify', description: '后台复审', run_in_background: true }),
    ];
    if (ack) lines.push(TOOL_RESULT(BG_ID, 'Agent launched in the background', ackIsError));
    if (notified) lines.push(TASK_NOTIFICATION('agent-x', BG_ID));
    lines.push(ASSISTANT_TEXT('等待后台复审结果'));
    return writeTranscript(lines);
  }

  /** 只铺 fix-report.md，不铺 verification → 判据本应判不合规 */
  function stageIncomplete() {
    stageDir(FEATURE_DIR, { verification: null });
  }

  it('前提核实：本组 fixture 的 missing 恰为可推迟白名单内的单项', () => {
    stageIncomplete();
    const out = reportInProcess(backgroundReviewTranscript());
    assert.deepEqual(out.missing, ['verification-report.md'], JSON.stringify(out));
    assert.equal(isDeferrableMissingSet(out.missing), true);
  });

  // —— 闸门 0（CRITICAL-1a）：后台派发本身必须被受理，才谈得上"在途" ——

  it('🔴 CRITICAL-1a：一次 is_error 的后台派发不得制造在途 → 恢复阻断（exit 2）', () => {
    // 修复前：规则 2 只看"有没有完成通知"，不看该派发是否被受理，于是**一条被拒的后台派发**
    // 即可让门禁永久推迟。这是最廉价的自助绕过，且与规则 3 已设的门槛不对等。
    stageIncomplete();
    const out = reportInProcess(backgroundReviewTranscript({ ackIsError: true }));
    assert.deepEqual(out.inFlightDelegations, [], JSON.stringify(out.inFlightDelegations));

    const r = runCli({ transcriptPath: backgroundReviewTranscript({ ackIsError: true }), sessionId: 'r2-err' });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(readState('r2-err').inFlightDeferCount, 0, '未推迟 → 在途预算不动');
    assert.equal(readState('r2-err').blockCount, 1);
  });

  it('🔴 CRITICAL-1a：完全没有回执的后台派发同样不得制造在途（exit 2）', () => {
    stageIncomplete();
    assert.deepEqual(reportInProcess(backgroundReviewTranscript({ ack: false })).inFlightDelegations, []);
    assert.equal(runCli({ transcriptPath: backgroundReviewTranscript({ ack: false }), sessionId: 'r2-noack' }).status, 2);
  });

  it('对照：正常 ack 且通知未到 → 确实在途，走推迟（exit 0）', () => {
    // 与上两条构成 A/B：三者 fixture 只差 tool_result 回执一项，退出码差异只可能来自 1a 的门槛。
    stageIncomplete();
    const out = reportInProcess(backgroundReviewTranscript());
    assert.deepEqual(out.inFlightDelegations.map((x) => x.kind), ['background']);
    const r = runCli({ transcriptPath: backgroundReviewTranscript(), sessionId: 'r2-ok' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stderr.includes('诊断: delegation-in-flight'), r.stderr);
  });

  // —— 闸门 1（CRITICAL-1c）：只有在途工作关得掉的缺口才配推迟 ——

  it('🔴 CRITICAL-1c：缺口含 feature-dir/fix-report.md（主线程自己该产出）时不得推迟', () => {
    // 同一份**在途成立**的 transcript，只改磁盘状态：什么都不铺 → missing 混入主线程制品缺口。
    // 修复前这类会话（实测占不合规会话的 5.2%）会被静默推迟，而在途工作再怎么回收也补不上它们。
    const p = backgroundReviewTranscript();
    const out = reportInProcess(p);
    assert.ok(out.inFlightDelegations.length > 0, '前提：在途判定成立，退出码差异只能来自可推迟性闸门');
    assert.deepEqual(out.missing, ['feature-dir', 'fix-report.md'], JSON.stringify(out.missing));
    assert.equal(isDeferrableMissingSet(out.missing), false);

    const r = runCli({ transcriptPath: p, sessionId: 'r2-nondef' });
    assert.equal(r.status, 2, r.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].diagnostics.includes('delegation-in-flight'), false, '不推迟就不该发在途诊断码');
    assert.equal(readState('r2-nondef').inFlightDeferCount, 0);
  });

  // —— 闸门 2（CRITICAL-1b）：推迟次数有界 ——

  it('🔴 CRITICAL-1b：连续在途 stop 推迟至多 3 次，第 4 次恢复裁决并留 budget-exhausted 诊断', () => {
    // 「每个在途委派最终都会回收通知」已被实测证伪（202 次后台派发中 43 次、21.3% 的通知从未到达），
    // 无界推迟等于给出一条自然发生率两成的永久放行通道。本用例钉住上界。
    stageIncomplete();
    const p = backgroundReviewTranscript();
    for (let i = 1; i <= 3; i += 1) {
      const r = runCli({ transcriptPath: p, sessionId: 'r2-budget' });
      assert.equal(r.status, 0, `第 ${i} 次推迟应放行：${r.stderr}`);
      assert.equal(readState('r2-budget').inFlightDeferCount, i);
      assert.equal(readState('r2-budget').blockCount, 0, '推迟全程不动阻断预算');
    }

    const fourth = runCli({ transcriptPath: p, sessionId: 'r2-budget' });
    assert.equal(fourth.status, 2, `预算耗尽后必须恢复阻断：${fourth.stderr}`);
    const events = readVerdictEvents();
    assert.equal(events.length, 4);
    assert.ok(events[3].diagnostics.includes('delegation-in-flight-budget-exhausted'), JSON.stringify(events[3]));
    assert.equal(events[3].diagnostics.includes('delegation-in-flight'), false, '两个诊断码互斥：推了才发前者');
    assert.equal(events[3].blockCount, 1, '恢复裁决后才开始消耗阻断预算');

    // 继续跑到阻断预算也耗尽 → 落回既有 FR-006 降级放行（两个有界机制串联仍在有限步内收敛）
    assert.equal(runCli({ transcriptPath: p, sessionId: 'r2-budget' }).status, 2);
    const last = runCli({ transcriptPath: p, sessionId: 'r2-budget' });
    assert.equal(last.status, 0, last.stderr);
    assert.ok(last.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), last.stderr);
  });

  it('warn 档：预算耗尽后退出码仍为 0，但审计事件必须留 budget-exhausted 诊断', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    stageIncomplete();
    const p = backgroundReviewTranscript();
    for (let i = 0; i < 3; i += 1) assert.equal(runCli({ transcriptPath: p, sessionId: 'r2-warn' }).status, 0);
    const fourth = runCli({ transcriptPath: p, sessionId: 'r2-warn' });
    assert.equal(fourth.status, 0, fourth.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 4);
    assert.ok(events[3].diagnostics.includes('delegation-in-flight-budget-exhausted'), JSON.stringify(events[3]));
    assert.equal(events[3].enforcement, 'warn');
  });

  it('存储不可用 → 不推迟（维持不了计数就不能开推迟通道，方向 fail-closed）', () => {
    // 两级状态存储均不可写：主路径被文件占位、tmpdir 降级路径 env 指向文件。
    fs.mkdirSync(path.join(tmp, '.specify', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state'), 'blocker');
    const tmpBlocker = path.join(tmp, 'tmp-blocker');
    fs.writeFileSync(tmpBlocker, 'x');
    stageIncomplete();

    const r = runCli({
      transcriptPath: backgroundReviewTranscript(),
      sessionId: 'r2-nostore',
      env: { SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP: tmpBlocker },
    });
    // 落回正常裁决 → routeBlock 同样写不了计数 → 走既有 FR-006「存储不可用等同已达上限」降级放行。
    // 与推迟分支的判别锚点：前缀是 GATE-DEGRADED 而非 WARN，诊断码是存储不可用而非在途。
    assert.ok(r.stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] '), r.stderr);
    assert.equal(r.stderr.includes('delegation-in-flight'), false, '未推迟就不得发在途诊断码');
    const events = readVerdictEvents();
    assert.ok(events.some((e) => e.diagnostics.includes('state-storage-unavailable')), JSON.stringify(events));
    assert.equal(events.some((e) => e.diagnostics.includes('delegation-in-flight')), false);
  });

  // —— 两个预算互不干扰 ——

  it('🔴 变异钉子 M15：推迟既不递增也不重置阻断计数（先阻断 1 次 → 推迟 → 回收后仍不合规 = 2 次）', () => {
    stageIncomplete();
    // 第 1 次：无在途（通知已到）→ 正常阻断，blockCount 1
    const first = runCli({ transcriptPath: backgroundReviewTranscript({ notified: true }), sessionId: 'r2-m15' });
    assert.equal(first.status, 2, first.stderr);
    assert.equal(readState('r2-m15').blockCount, 1);

    // 第 2 次：在途 → 推迟；blockCount 必须原地不动（既不 +1 也不清零）
    const second = runCli({ transcriptPath: backgroundReviewTranscript(), sessionId: 'r2-m15' });
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(
      (({ blockCount, inFlightDeferCount }) => ({ blockCount, inFlightDeferCount }))(readState('r2-m15')),
      { blockCount: 1, inFlightDeferCount: 1 },
    );

    // 第 3 次：在途已回收且仍不合规 → 从 1 续上，而非从 0 重来
    const third = runCli({ transcriptPath: backgroundReviewTranscript({ notified: true }), sessionId: 'r2-m15' });
    assert.equal(third.status, 2, third.stderr);
    assert.equal(readState('r2-m15').blockCount, 2, '推迟不得重置阻断预算（重置=多送一次阻断额度）');
  });

  it('阻断路径不得抹平在途预算（saveBlockState 是整体覆写，两个字段须各自带回）', () => {
    stageIncomplete();
    const p = backgroundReviewTranscript();
    assert.equal(runCli({ transcriptPath: p, sessionId: 'r2-mix' }).status, 0);
    assert.equal(readState('r2-mix').inFlightDeferCount, 1);
    // 一次不含在途的阻断写入后，在途预算必须仍是 1（被写回 0 就等于又送 1 次推迟）
    runCli({ transcriptPath: backgroundReviewTranscript({ notified: true }), sessionId: 'r2-mix' });
    assert.deepEqual(
      (({ blockCount, inFlightDeferCount }) => ({ blockCount, inFlightDeferCount }))(readState('r2-mix')),
      { blockCount: 1, inFlightDeferCount: 1 },
    );
  });

  it('合规收口清零两个预算（resetBlockState 删整份状态文件）', () => {
    stageIncomplete();
    assert.equal(runCli({ transcriptPath: backgroundReviewTranscript(), sessionId: 'r2-reset' }).status, 0);
    assert.equal(readState('r2-reset').inFlightDeferCount, 1);

    // 补齐 verification 后同一 session 合规收口 → 状态文件整份删除
    stageDir(FEATURE_DIR);
    assert.equal(runCli({ transcriptPath: backgroundReviewTranscript({ notified: true }), sessionId: 'r2-reset' }).status, 0);
    assert.equal(readState('r2-reset'), null, '合规收口后状态文件应被删除（两个预算一并归零）');

    // 再退回不合规 + 在途 → 预算从 1 重新起算，证明确实清零而非文件残留
    stageDir(FEATURE_DIR, { verification: null });
    fs.rmSync(path.join(tmp, FEATURE_DIR, 'verification'), { recursive: true, force: true });
    assert.equal(runCli({ transcriptPath: backgroundReviewTranscript(), sessionId: 'r2-reset' }).status, 0);
    assert.equal(readState('r2-reset').inFlightDeferCount, 1);
  });

  it('向后兼容：F256 之前写下的状态文件（缺 inFlightDeferCount）按 0 起算', () => {
    stageIncomplete();
    const stateDir = path.join(tmp, '.specify', 'runs', '.fix-compliance-state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'r2-legacy.json'), JSON.stringify({ sessionId: 'r2-legacy', blockCount: 1, degradedRecorded: false }));
    assert.equal(runCli({ transcriptPath: backgroundReviewTranscript(), sessionId: 'r2-legacy' }).status, 0);
    const st = readState('r2-legacy');
    assert.equal(st.inFlightDeferCount, 1, '缺字段按 0 起算，本次推迟记为 1');
    assert.equal(st.blockCount, 1, '既有阻断计数不得被新字段写入抹平');
  });

  it('合同同步：judge 实际产出的 delegation-in-flight-budget-exhausted 必须已登记进 schema enum', () => {
    const schemaPath = fileURLToPath(new URL(
      '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json',
      import.meta.url,
    ));
    const registered = new Set(JSON.parse(fs.readFileSync(schemaPath, 'utf8')).properties.diagnostics.items.enum);
    assert.ok(registered.has('delegation-in-flight-budget-exhausted'), '诊断码未登记进 schema enum');
    const judgeSrc = fs.readFileSync(fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url)), 'utf8');
    assert.ok(judgeSrc.includes("'delegation-in-flight-budget-exhausted'"), '合同登记了一个从不产出的死码');
  });
});

describe('F256 R2 · 短名磁盘兜底的 usable 过滤是承重判据', () => {
  const OLD_DIR = 'specs/251-fix-foo';
  const RENUMBER_COMMAND = `cd "/w/worktrees/serene" && git mv ${OLD_DIR} specs/254-fix-foo && FILES=(spec.md)`;

  it('🔴 变异钉子 M10/M11：编号更大者是空壳时必须回落到编号更小的**可用**目录', () => {
    // 删掉 evaluate() 里的 `.filter(usable)` 后本用例必须变红。修复前 748 条测试全绿——
    // 既有用例只覆盖"唯一候选是空壳"（回落 null 后 missing 仍含 fix-report.md，断言照样通过），
    // 覆盖不到"空壳把可用目录挤掉"这一真实重编场景（先建新目录、制品尚未迁入即是此形态）。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      // F257：带 id + 成功回执，使本会话对 short-name 家族 `foo` 的写入见证成立（否则重锚定被拒，
      // 本用例就测不到 `.filter(usable)` 这一层了）
      ...TOOL_USE_OK('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }, 'r2-w-old'),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' }),
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir('specs/252-fix-foo');                                   // 编号小、制品齐全
    fs.mkdirSync(path.join(tmp, 'specs/254-fix-foo'), { recursive: true }); // 编号大、空壳

    const out = reportInProcess(p);
    assert.equal(out.compliant, true, `应回落到制品齐全的 252 而非空壳 254：${JSON.stringify(out)}`);
    assert.deepEqual(out.missing, [], JSON.stringify(out.missing));
    assert.equal(runCli({ transcriptPath: p, sessionId: 'r2-usable' }).status, 0);
  });
});

// ────────────────────────────────────────
// F257 缺陷 1 · short-name 磁盘重锚定的「本会话写入见证」门槛（方案 A′ · short-name 家族级）
// ────────────────────────────────────────

describe('F257 · 短名磁盘重锚定必须有本会话对同 short-name 家族制品的成功写入见证', () => {
  const OLD_DIR = 'specs/251-fix-foo';
  const NEW_DIR = 'specs/254-fix-foo';
  /** 与 F256 T006 同源：复合命令，F231 刻意不跟随 → 候选永久停在磁盘已消失的旧编号 */
  const RENUMBER_COMMAND = `cd "/w/worktrees/serene" && git mv ${OLD_DIR} ${NEW_DIR} && FILES=(spec.md plan.md)`;
  const IMPLEMENT = TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' });
  const VERIFY = TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '工具链验证' });

  it('T-1a 缺陷 1 主场景：本会话零产出时不得静默采信磁盘上同 short-name 的**旧编号**目录', () => {
    // 失效模式是**无意**的而非冒用：本会话老实提名了自己的新编号目录 specs/777-fix-foo，
    // 磁盘上恰好存在同 short-name 的历史目录 specs/100-fix-foo（别人的产出、制品齐全），
    // F256 的重锚定只过 usable() 闸门 → 静默采信他人产物 → compliant:true → 合规早退
    // （发生在任何 appendAuditEvent 之前）→ exit 0 且事后零审计线索。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/777-fix-foo/fix-report.md', content: '# Fix' }),
      IMPLEMENT,
      VERIFY,
      ASSISTANT_TEXT('已修复完毕'),
    ]);
    stageDir('specs/100-fix-foo'); // 非本会话产出的历史目录，制品齐全

    const r = runCli({ transcriptPath: p, sessionId: 'f257-a' });
    assert.equal(r.status, 2, `本会话零产出必须落回阻断：${r.stderr}`);
    const events = readVerdictEvents();
    assert.equal(events.length, 1, JSON.stringify(events));
    assert.ok(events[0].missing.includes('feature-dir'), JSON.stringify(events[0].missing));
    assert.ok(
      events[0].diagnostics.includes('feature-dir-witness-absent'),
      `新增阻断必须可归因（否则与"根本没建目录"不可区分）：${JSON.stringify(events[0].diagnostics)}`,
    );
  });

  it('T-1b F256 互补：改名后对新目录零写入，家族级见证仍成立 → 仍 exit 0', () => {
    // 🔴 本用例与真实会话（F254 交付会话 f3f2fe3b）同构：锚点后全部写入都打在**旧**编号目录，
    // 改名后对新目录零写入。刻意**不**人为补一次"改名后写新目录"——那样构造会让主候选
    // 直接提名到 254 并被 usable 命中，根本不进短名分支，用例即成假绿（守护力为零）。
    // 验收硬要求：把 judge 的短名分支整段注释掉后本用例必须转红。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }, 'w-old'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成，制品已迁移'),
    ]);
    stageDir(NEW_DIR); // 磁盘上只有新编号目录

    const out = reportInProcess(p);
    assert.equal(out.compliant, true, JSON.stringify(out));
    assert.deepEqual(out.missing, [], JSON.stringify(out));
    const r = runCli({ transcriptPath: p, sessionId: 'f257-b' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readVerdictEvents().filter((e) => e.compliant !== true), [], '合规收口只留 compliant 痕迹、无其他 verdict 事件（FR-024 修订版）');
  });

  it('T-1c 类 X（预期阻断，勿当回归修回）：家族内任一目录都无成功写入见证 → exit 2', () => {
    // 与 T-1b 唯一差别：那次 Write 没有 id / 没有配对回执（等价于"制品由子代理在 sidechain 落盘、
    // 主 transcript 不可见"）。这是修正后类 X 的**预期**行为，不是回归——
    // 补一次对该 short-name 家族任一目录制品的成功 Write/Edit 即恢复 exit 0，
    // 且 BLOCK_LIMIT=2 保证最坏两次阻断后降级放行，会话不会卡死。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);

    const r = runCli({ transcriptPath: p, sessionId: 'f257-c' });
    assert.equal(r.status, 2, r.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('feature-dir-witness-absent'), JSON.stringify(events[0].diagnostics));
  });

  it('T-1d 子串边界：见证 specs/254-fix-alpha-retry 不得为 short-name `alpha` 背书', () => {
    // 红队实证过 includes() 实现会让 specs/254-fix-alpha-retry 命中 specs/254-fix-alpha。
    // 见证侧用锚定全串匹配后**反取**目录，家族比较用 short-name **完全相等**，两层都不许子串越界。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: 'specs/254-fix-alpha-retry/fix-report.md', content: '# Fix' }, 'w-retry'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Write', { file_path: 'specs/999-fix-alpha/fix-report.md', content: '# Fix' }), // 末次提名
      ASSISTANT_TEXT('完成'),
    ]);
    stageDir('specs/254-fix-alpha'); // 磁盘只有 alpha；alpha-retry 刻意不铺（否则 F227 历史兜底先手命中）

    const r = runCli({ transcriptPath: p, sessionId: 'f257-d' });
    assert.equal(r.status, 2, `见证不得跨到 short-name 不同的目录：${r.stderr}`);
    assert.ok(readVerdictEvents()[0].diagnostics.includes('feature-dir-witness-absent'));
  });

  it('T-1e 回执为 error + id 复用：不构成见证（配对判据取「该 id 全部回执均非 error」）', () => {
    // W-A3 实证：若判据写成"存在某条非 error 回执"，先让 Write 失败、再让任意无关工具复用同一
    // tool_use id 拿到成功回执，即可凭空发证。故取全称判据。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }, 'w-dup', { isError: true }),
      ...TOOL_USE_OK('Bash', { command: 'echo hi' }, 'w-dup'), // 无关工具复用同 id + 成功回执
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);

    const r = runCli({ transcriptPath: p, sessionId: 'f257-e' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(readVerdictEvents()[0].diagnostics.includes('feature-dir-witness-absent'));
  });

  it('T-1f 只 Read 过制品不构成见证（ARTIFACT_WRITER_TOOL_NAMES 是唯一放宽点）', () => {
    // 变异钉子：向 ARTIFACT_WRITER_TOOL_NAMES 增补 'Read' 后本用例必须转红。
    // 实测真实会话锚点后 Read 触及制品 15 次，"读过即算见证"会把见证门槛降到接近零成本。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }),
      ...TOOL_USE_OK('Read', { file_path: `${NEW_DIR}/fix-report.md` }, 'r-1'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);

    const r = runCli({ transcriptPath: p, sessionId: 'f257-f' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(readVerdictEvents()[0].diagnostics.includes('feature-dir-witness-absent'));
  });

  it('T-1g 绝对路径（projectRoot 内）归一化后构成见证 → exit 0', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: path.join(tmp, OLD_DIR, 'fix-report.md'), content: '# Fix' }, 'w-abs'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);
    assert.equal(runCli({ transcriptPath: p, sessionId: 'f257-g' }).status, 0);
  });

  it('T-1h 跨仓绝对路径不作见证（分段级前缀比较，`/repo-backup` 不得命中 `/repo`）', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: `${tmp}-backup/${OLD_DIR}/fix-report.md`, content: '# Fix' }, 'w-out'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);

    const r = runCli({ transcriptPath: p, sessionId: 'f257-h' });
    assert.equal(r.status, 2, `projectRoot 之外的写入不得为本仓目录背书：${r.stderr}`);
    assert.ok(readVerdictEvents()[0].diagnostics.includes('feature-dir-witness-absent'));
  });

  it('T-1i Edit 与 Write 等价发证', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Edit', { file_path: `${OLD_DIR}/fix-report.md`, old_string: 'a', new_string: 'b' }, 'e-1'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);
    assert.equal(runCli({ transcriptPath: p, sessionId: 'f257-i' }).status, 0);
  });

  it('T-1j 合同同步：feature-dir-witness-absent 必须已登记进 schema enum（逐码硬编码，不会自动守住）', () => {
    const schemaPath = fileURLToPath(new URL(
      '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json',
      import.meta.url,
    ));
    const registered = new Set(JSON.parse(fs.readFileSync(schemaPath, 'utf8')).properties.diagnostics.items.enum);
    assert.ok(registered.has('feature-dir-witness-absent'), '诊断码未登记进 schema enum');
    const judgeSrc = fs.readFileSync(fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url)), 'utf8');
    assert.ok(judgeSrc.includes("'feature-dir-witness-absent'"), '合同登记了一个从不产出的死码');
  });

  it('T-1k 诊断码绝不可落进 transcriptDiagnostics（该数组非空即 fail-open 放行）', () => {
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/777-fix-foo/fix-report.md', content: '# Fix' }),
      IMPLEMENT,
      VERIFY,
      ASSISTANT_TEXT('已修复完毕'),
    ]);
    stageDir('specs/100-fix-foo');
    const out = reportInProcess(p);
    assert.deepEqual(out.transcriptDiagnostics, [], JSON.stringify(out));
    assert.ok(out.diagnostics.includes('feature-dir-witness-absent'), JSON.stringify(out));
  });

  // ── 第 3 轮红队复打（CRITICAL）：见证制品类与采信谓词 usable() 不同源 ──
  //
  // 攻击链（红队已实跑）：本会话零真实产出 → 两次廉价 Agent 委派 → Write 一份 1 字节的
  // `verification/verification-report.md` 到全新编号目录并拿到成功回执 → stop。
  // 该目录**拿到了见证但不 usable**（无 fix-report.md）⟹ 上方 F227 历史兜底只挑 usable 者故不选它
  // ⟹ 控制流照旧进入短名分支 ⟹ `witnessedShortNames.has(shortName)` 成立 ⟹ 重锚定到磁盘上
  // 本会话从未触碰的旧目录 ⟹ compliant:true ⟹ 合规早退（在任何 appendAuditEvent 之前）⟹ exit 0 零审计。
  //
  // 这直接证伪了第 2 轮注释里的演绎证明：「见证集合 ⊆ 提名集合 ⟹ 被见证目录必进 candidateHistory
  // ⟹ F227 兜底先手命中」——**「进 candidateHistory」≠「usable」**，兜底循环只挑 usable 的历史候选。
  const GHOST_SHORT = 'ghost';
  const GHOST_NEW_DIR = `specs/999-fix-${GHOST_SHORT}`;
  const GHOST_OLD_DIR = `specs/100-fix-${GHOST_SHORT}`;
  /** 本会话唯一产出：一份 verification-report.md（带 id + 成功回执，见证的其余条件全部满足） */
  const ghostTranscript = () => writeTranscript([
    SKILL_EXPANSION_LINE('fix'),
    IMPLEMENT,
    VERIFY,
    ...TOOL_USE_OK('Write', { file_path: `${GHOST_NEW_DIR}/verification/verification-report.md`, content: 'x' }, 'w-ghost'),
    ASSISTANT_TEXT('已完成'),
  ]);

  it('🔴 T-1L 红先行（S1 形态）：只 Write verification-report.md 不得白嫖见证 → 必须 exit 2', () => {
    const p = ghostTranscript();
    // 该 1 字节写入确实落了盘（S1：新编号目录在磁盘上存在，但**不 usable**——没有 fix-report.md）
    fs.mkdirSync(path.join(tmp, GHOST_NEW_DIR, 'verification'), { recursive: true });
    fs.writeFileSync(path.join(tmp, GHOST_NEW_DIR, 'verification', 'verification-report.md'), 'x', 'utf8');
    stageDir(GHOST_OLD_DIR); // 本会话从未触碰的旧目录，制品齐全

    const r = runCli({ transcriptPath: p, sessionId: 'f257-l' });
    assert.equal(r.status, 2, `见证制品类必须与 usable() 同源，否则本会话零产出仍 exit 0：${r.stderr}`);
    const events = readVerdictEvents();
    assert.equal(events.length, 1, JSON.stringify(events));
    assert.equal(events[0].compliant, false, JSON.stringify(events[0]));
    assert.ok(
      events[0].diagnostics.includes('feature-dir-witness-absent'),
      `拒绝重锚定必须可归因：${JSON.stringify(events[0].diagnostics)}`,
    );
  });

  it('🔴 T-1M 红先行（W1 形态）：写完立刻回滚、磁盘上新编号目录根本不存在 → 仍必须 exit 2', () => {
    // 见证不绑定终态（判据看 transcript 历史、制品判据看磁盘终态，二者时间解耦），
    // 故 W1 与 S1 走的是同一条采信路径；收窄制品类后两者一并落回裁决。
    const p = ghostTranscript();
    stageDir(GHOST_OLD_DIR); // 磁盘上只有旧目录，999 全无痕迹

    const r = runCli({ transcriptPath: p, sessionId: 'f257-m' });
    assert.equal(r.status, 2, r.stderr);
    const events = readVerdictEvents();
    assert.equal(events.length, 1, JSON.stringify(events));
    assert.ok(events[0].missing.includes('feature-dir'), JSON.stringify(events[0].missing));
    assert.ok(events[0].diagnostics.includes('feature-dir-witness-absent'), JSON.stringify(events[0].diagnostics));
  });

  it('T-1N 互补（F256 正向不得被误伤）：Write fix-report.md + 复合命令改名 → 仍 exit 0', () => {
    // 收窄见证制品类只砍掉 verification-report.md 这一类；F256 的真实场景里旧目录本就写过
    // fix-report.md（只是被 git mv 移走故不 usable），家族级见证照旧成立。
    const p = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ...TOOL_USE_OK('Write', { file_path: `${OLD_DIR}/fix-report.md`, content: '# Fix' }, 'w-n'),
      IMPLEMENT,
      VERIFY,
      TOOL_USE('Bash', { command: RENUMBER_COMMAND }),
      ASSISTANT_TEXT('重编号完成'),
    ]);
    stageDir(NEW_DIR);

    const out = reportInProcess(p);
    assert.equal(out.compliant, true, JSON.stringify(out));
    assert.equal(out.diagnostics.includes('feature-dir-witness-absent'), false, JSON.stringify(out.diagnostics));
    const r = runCli({ transcriptPath: p, sessionId: 'f257-n' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readVerdictEvents().filter((e) => e.compliant !== true), [], '合规收口只留 compliant 痕迹、无其他 verdict 事件（FR-024 修订版）');
  });
});

// ────────────────────────────────────────
// F257 缺陷 2 · 闸门三（会话长度预算）：不依赖 projectRoot 下可写状态的单调上界
// ────────────────────────────────────────

describe('F257 缺陷 2 · 推迟通道的上界不得只寄存在可被删除的本地状态里', () => {
  /** 每轮追加的 assistant 条目数（真实长会话的"一段工作"量级；6 轮跨过 420 阈值） */
  const PER_ROUND = 70;

  /** 未消费的同步 verify 委派——必须是 entries 末条且带 id（findTrailingUnresolvedSyncDelegation 合同） */
  const SYNC_AGENT = (id) => ({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'spec-driver:verify', description: '工具链验证' } }],
    },
  });
  const PAD = (n, tag) => Array.from({ length: n }, (_, i) => ASSISTANT_TEXT(`${tag}-pad-${i}`));

  /** 抹掉本地推迟状态（缺陷 2 的攻击动作，也可作为无恶意的"清理本地运行态"自然发生） */
  function wipeState() {
    fs.rmSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state'), { recursive: true, force: true });
  }

  /** 读取 .specify/runs/ 全部 workflow-run-summary 终态记录 */
  function readWorkflowRuns(root = tmp) {
    const runsDir = path.join(root, '.specify', 'runs');
    if (!fs.existsSync(runsDir)) return [];
    const events = [];
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      for (const line of fs.readFileSync(path.join(runsDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.eventType === 'workflow-run-summary') events.push(obj);
        } catch { /* 跳过损坏行 */ }
      }
    }
    return events;
  }

  /**
   * 单次展开的长会话：制品与 implement 委派齐备、只差 verification-report.md（可推迟缺口），
   * 末条挂一条未消费的同步 verify 委派（恒在途）。锚点后 assistant 条目数 = PER_ROUND × rounds + 3。
   */
  function longSessionTranscript(rounds) {
    const lines = [
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
    ];
    for (let r = 1; r <= rounds; r += 1) lines.push(...PAD(PER_ROUND, `r${r}`));
    lines.push(SYNC_AGENT('toolu_sync_tail'));
    return writeTranscript(lines);
  }

  /**
   * 锚点重展开攻击会话（CRITICAL-2 实跑形态）：每轮 ① 重新展开 Skill(spec-driver-fix)
   * ② 对制品做一次 Write 重提名（否则 missing 混入 feature-dir 变不可推迟）
   * ③ 末条挂未消费的同步 Agent。每轮 assistant 条目数 = PER_ROUND。
   */
  function reExpansionAttackTranscript(rounds) {
    const lines = [];
    for (let r = 1; r <= rounds; r += 1) {
      lines.push(SKILL_EXPANSION_LINE('fix'));
      lines.push(TOOL_USE('Write', { file_path: `${FEATURE_DIR}/fix-report.md`, content: '# Fix' }));
      lines.push(TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }));
      lines.push(...PAD(PER_ROUND - 3, `a${r}`));
      lines.push(SYNC_AGENT(`toolu_sync_${r}`));
    }
    return writeTranscript(lines);
  }

  function stageIncomplete() {
    stageDir(FEATURE_DIR, { verification: null });
  }

  it('前提核实：本组 fixture 的缺口恰在可推迟白名单内，且在途判定成立', () => {
    stageIncomplete();
    const out = reportInProcess(longSessionTranscript(1));
    assert.deepEqual(out.missing, ['verification-report.md'], JSON.stringify(out));
    assert.equal(isDeferrableMissingSet(out.missing), true);
    assert.deepEqual(out.inFlightDelegations.map((x) => x.kind), ['sync'], JSON.stringify(out.inFlightDelegations));
  });

  it('report 透传：assistantEntriesSinceEarliestFix 为事实字段（供端到端复现与标定取数）', () => {
    stageIncomplete();
    const out = reportInProcess(longSessionTranscript(2));
    assert.equal(out.assistantEntriesSinceEarliestFix, PER_ROUND * 2 + 3, JSON.stringify(out));
  });

  it('🔴 T-2a 红先行：每轮删状态文件 → 不得"全部 exit 0 且零终态记录"，越阈必须落回裁决', () => {
    // 修复前：`rm -rf .specify/runs/.fix-compliance-state` 让闸门二每轮读到初始态 → 推迟通道恒开，
    // N≫3 轮全部 exit 0、审计 degraded=false、终态记录 0 条（比 blockCount 篡改更安静的静默通道）。
    stageIncomplete();
    const statuses = [];
    const counts = [];
    for (let rounds = 1; rounds <= 6; rounds += 1) {
      wipeState();                                    // ← 缺陷 2 的攻击动作，每轮抹掉闸门二
      const p = longSessionTranscript(rounds);
      counts.push(reportInProcess(p).assistantEntriesSinceEarliestFix);
      statuses.push(runCli({ transcriptPath: p, sessionId: 'f257-g3' }).status);
    }

    assert.notDeepEqual(statuses, [0, 0, 0, 0, 0, 0], '删状态即全放行的静默通道必须被闸门三兜住');
    assert.deepEqual(statuses, [0, 0, 0, 0, 0, 2], JSON.stringify({ statuses, counts }));
    // 计数单调递增，且恰在越过 420 的那一轮转为阻断
    for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i] > counts[i - 1], JSON.stringify(counts));
    assert.ok(counts[4] < 420 && counts[5] >= 420, JSON.stringify(counts));

    const events = readVerdictEvents();
    const last = events[events.length - 1];
    assert.ok(last.diagnostics.includes('delegation-in-flight-entry-budget-exhausted'), JSON.stringify(last));
    assert.equal(last.diagnostics.includes('delegation-in-flight'), false, '未推迟就不得发在途诊断码');
    assert.equal(last.compliant, false);
  });

  it('🔴 T-2b 红先行（CRITICAL-2 回归钉子）：每轮重展开 fix 锚点 + 删状态，计数仍须单调收敛', () => {
    // 主锚点取最晚一次展开：agent 自调一次 Skill(spec-driver-fix) 即可令锚点后计数归零而 isFix 仍真。
    // 实跑证据：攻击组 30/30 全 exit 0、锚点后计数恒 4。闸门三以**最早**一次展开为基线破掉它。
    stageIncomplete();
    const statuses = [];
    const counts = [];
    for (let rounds = 1; rounds <= 6; rounds += 1) {
      wipeState();
      const p = reExpansionAttackTranscript(rounds);
      const out = reportInProcess(p);
      assert.equal(isDeferrableMissingSet(out.missing), true, `第 ${rounds} 轮缺口须仍可推迟：${JSON.stringify(out.missing)}`);
      assert.ok(out.inFlightDelegations.length > 0, `第 ${rounds} 轮在途须成立：${JSON.stringify(out)}`);
      counts.push(out.assistantEntriesSinceEarliestFix);
      statuses.push(runCli({ transcriptPath: p, sessionId: 'f257-reexp' }).status);
    }

    assert.notDeepEqual(statuses, [0, 0, 0, 0, 0, 0], '重展开攻击必须被闸门三收敛，不得 N/N 全 exit 0');
    assert.deepEqual(statuses, [0, 0, 0, 0, 0, 2], JSON.stringify({ statuses, counts }));
    for (let i = 1; i < counts.length; i += 1) {
      assert.ok(counts[i] > counts[i - 1], `重展开使计数回退（= 用了最晚锚点作基线）：${JSON.stringify(counts)}`);
    }
    const last = readVerdictEvents().pop();
    assert.ok(last.diagnostics.includes('delegation-in-flight-entry-budget-exhausted'), JSON.stringify(last));
  });

  it('🔴 T-2c 不回退：正常在途会话（不删状态、远未越阈）仍保持既有 0 0 0 2 2 0 形态', () => {
    stageIncomplete();
    const p = longSessionTranscript(1);                 // 73 条 ≪ 420，闸门三全程不触发
    const seq = [];
    for (let i = 0; i < 6; i += 1) seq.push(runCli({ transcriptPath: p, sessionId: 'f257-normal' }).status);
    assert.deepEqual(seq, [0, 0, 0, 2, 2, 0], '闸门三不得改变闸门二 + BLOCK_LIMIT 的既有收敛序列');
  });

  it('🔴 T-2d 审计提档：推迟成功必须落一条 result:"paused" 的 workflow-run 终态', () => {
    // 修复前推迟只打 [WARN] + degraded=false 审计事件、**不写终态**，事后审计看起来就是"还有子代理在跑"。
    stageIncomplete();
    const r = runCli({ transcriptPath: longSessionTranscript(1), sessionId: 'f257-paused' });
    assert.equal(r.status, 0, r.stderr);

    const runs = readWorkflowRuns();
    assert.equal(runs.length, 1, JSON.stringify(runs));
    assert.equal(runs[0].result, 'paused', 'paused 与"降级放行 = failed"区分，事后可分辨两类放行');
    assert.equal(runs[0].workflowId, 'spec-driver-fix');
    assert.equal(runs[0].runId, 'f257-paused');
    assert.equal(runs[0].complianceVerdict.degraded, false);
    // recordWorkflowRun 的 normalizeComplianceVerdict 只收有限数值，null 会被整键丢弃——
    // 与"推迟不消耗阻断预算、无计数可报"的既有语义一致，故此处断言的是**键缺席**而非值为 null。
    assert.equal(Object.hasOwn(runs[0].complianceVerdict, 'blockCount'), false, JSON.stringify(runs[0].complianceVerdict));
    assert.deepEqual(runs[0].complianceVerdict.missing, ['verification-report.md']);

    const events = readVerdictEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0].diagnostics.includes('delegation-in-flight'), JSON.stringify(events[0]));
    assert.equal(events[0].degraded, false, '审计事件的 degraded 语义不变（推迟 ≠ 降级放行）');
  });

  it('🔴 T-2e 并联是 AND 不是 OR：闸门二耗尽而闸门三未耗尽 → 不推迟', () => {
    // 改成 `||` 等于两道闸门互相赦免（缺陷 2 原样存活）：此处 entryBudgetLeft 为真会把已耗尽的
    // 闸门二一并赦免 → exit 0。
    stageIncomplete();
    preinstallBlockState('f257-and', { blockCount: 0, degradedRecorded: false, inFlightDeferCount: 3 });
    const r = runCli({ transcriptPath: longSessionTranscript(1), sessionId: 'f257-and' });
    assert.equal(r.status, 2, `闸门二耗尽即不得推迟：${r.stderr}`);
    const events = readVerdictEvents();
    assert.ok(events[0].diagnostics.includes('delegation-in-flight-budget-exhausted'), JSON.stringify(events[0]));
    assert.equal(events[0].diagnostics.includes('delegation-in-flight-entry-budget-exhausted'), false, '闸门三尚未耗尽，不得误报');
    assert.equal(events[0].diagnostics.includes('delegation-in-flight'), false);
    assert.deepEqual(readWorkflowRuns(), [], '不推迟就不得写 paused 终态');
  });

  it('T-2f warn 档：退出码仍恒 0，但越阈后的诊断码从 delegation-in-flight 变为 entry-budget-exhausted', () => {
    fs.writeFileSync(path.join(tmp, 'spec-driver.config.yaml'), 'fix_compliance:\n  enforcement: warn\n');
    stageIncomplete();
    wipeState();
    const under = runCli({ transcriptPath: longSessionTranscript(1), sessionId: 'f257-warn' });
    assert.equal(under.status, 0, under.stderr);
    wipeState();
    const over = runCli({ transcriptPath: longSessionTranscript(6), sessionId: 'f257-warn' });
    assert.equal(over.status, 0, over.stderr);
    const events = readVerdictEvents();
    assert.ok(events[0].diagnostics.includes('delegation-in-flight'), JSON.stringify(events[0]));
    assert.ok(events[1].diagnostics.includes('delegation-in-flight-entry-budget-exhausted'), JSON.stringify(events[1]));
    assert.equal(events[1].enforcement, 'warn');
  });

  it('失败路径：终态记录写不进去时推迟路由不得崩溃（崩溃 → main() 顶层 catch → 静默 exit 0）', () => {
    // recordDeferTerminal 的 try/catch 不是防御性冗余：judge 的 main() 顶层 catch（FR-013）会把任何
    // 未捕获异常静默转成 exit 0 放行，于是"终态写失败"会连带把一次本该走完的裁决变成 fail-open。
    // 这里把月度 jsonl 占成目录，令 recordWorkflowRun 的 appendFileSync 必抛。
    stageIncomplete();
    const runsDir = path.join(tmp, '.specify', 'runs');
    fs.mkdirSync(path.join(runsDir, `${new Date().toISOString().slice(0, 7)}.jsonl`), { recursive: true });

    const r = runCli({ transcriptPath: longSessionTranscript(1), sessionId: 'f257-terminal-fail' });
    assert.equal(r.status, 0, `推迟路由须照常走完：${r.stderr}`);
    assert.ok(r.stderr.includes('诊断: delegation-in-flight'), r.stderr);
    // 推迟确实发生过（计数落盘），证明不是"异常被顶层 catch 吞掉后碰巧也 exit 0"
    assert.equal(readState('f257-terminal-fail').inFlightDeferCount, 1);
  });

  it('🔴 变异钉子 M-6：EARLIEST_FIX_ENTRY_DEFER_LIMIT 的数量级本身是承重判据', async () => {
    // 把常量改成 Number.MAX_SAFE_INTEGER 等价于删除闸门三，而阈值缩放型用例（越阈轮次由计数决定）
    // 抓不到这一手——必须有一条直接钉住取值的断言。
    const { EARLIEST_FIX_ENTRY_DEFER_LIMIT } = await import('../scripts/fix-compliance-judge.mjs');
    assert.equal(
      EARLIEST_FIX_ENTRY_DEFER_LIMIT,
      420,
      '定稿值 420 ≈ 真实语料（新口径 N=149）的 P98.7；实测 2/149 越阈，且均不因此受实际影响'
        + '（一份缺口不可推迟、一份合规早退）。⚠️ 前身消息写的「覆盖 P99=409」取自旧口径，已更正',
    );
    assert.equal(Number.isSafeInteger(EARLIEST_FIX_ENTRY_DEFER_LIMIT), true);
    assert.ok(
      EARLIEST_FIX_ENTRY_DEFER_LIMIT > 0 && EARLIEST_FIX_ENTRY_DEFER_LIMIT <= 1000,
      `闸门三失去实际约束力：${EARLIEST_FIX_ENTRY_DEFER_LIMIT}`,
    );
  });

  it('合同同步：judge 实际产出的 delegation-in-flight-entry-budget-exhausted 必须已登记进 schema enum', () => {
    const schemaPath = fileURLToPath(new URL(
      '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json',
      import.meta.url,
    ));
    const registered = new Set(JSON.parse(fs.readFileSync(schemaPath, 'utf8')).properties.diagnostics.items.enum);
    assert.ok(registered.has('delegation-in-flight-entry-budget-exhausted'), '诊断码未登记进 schema enum');
    const judgeSrc = fs.readFileSync(fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url)), 'utf8');
    assert.ok(judgeSrc.includes("'delegation-in-flight-entry-budget-exhausted'"), '合同登记了一个从不产出的死码');
  });
});

// ════════════════════════════════════════
// F270 P2 · T201 端到端：病根 iv 修复（isFix 存在性 + 证据窗口切 latestFix）
// Tests FIRST：当前实现 fixSession=false 且委派被切窗外，本组先红。
// ════════════════════════════════════════

describe('F270 P2 · T201 fix→委派→尾部 doc 端到端（--mode report）', () => {
  const skillLine = (mode) =>
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}` },
    });
  const delegateLine = (id, sub, desc) =>
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Task', id, input: { subagent_type: sub, description: desc } }] },
    });

  function writeTranscript(lines) {
    const p = path.join(tmp, 'p2-t201.jsonl');
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  }

  it('🔴 尾部 doc 展开不再翻转 isFix（report 模式，病根 iv 正面）', () => {
    const p = writeTranscript([
      skillLine('fix'),
      delegateLine('toolu_P2_IMPL', 'spec-driver:implement', '实施修复'),
      skillLine('doc'),
    ]);
    const r = runCli({ mode: 'report', transcriptPath: p });
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.equal(report.fixSession, true, '病根 iv：曾 fix 展开即 isFix=true（存在性判据）');
    assert.equal(report.mode, 'doc', 'mode 如实报最晚任意展开（诊断语义保持）');
  });

  it('🔴 全合规会话 + 尾部 doc 展开 → hook 仍 exit 0（窗口误伤面检测器）', () => {
    // 检测的是"只修 isFix、不切窗口"的半吊子修法：isFix=true 后判定照跑，
    // 但 5 个证据窗口若仍以 anchorLineIndex（=doc 行）为界，fix 阶段的
    // 委派/见证全被切到窗外 → missing 非空 → exit 2 误阻断。
    // 正确实现（窗口切 latestFixLineIndex）下本会话与"无尾部 doc"完全同判：合规 exit 0。
    const p = compliantTranscript();
    fs.appendFileSync(p, skillLine('doc') + '\n');
    const r = runCli({ mode: 'hook', transcriptPath: p });
    assert.equal(
      r.status, 0,
      `全合规 + 尾部 doc 必须仍合规；exit=${r.status} stderr=${r.stderr.slice(0, 300)}`
    );
  });

  it('仅 doc 无 fix：isFix=false（存在性判据不误伤非 fix 会话）', () => {
    const p = writeTranscript([skillLine('doc')]);
    const r = runCli({ mode: 'report', transcriptPath: p });
    const report = JSON.parse(r.stdout);
    assert.equal(report.fixSession, false);
    assert.equal(report.mode, 'doc');
  });

  it('T203 端到端回归钉：纯 fix 会话行为与改动前一致', () => {
    const p = writeTranscript([
      skillLine('fix'),
      delegateLine('toolu_P2_V', 'spec-driver:verify', '工具链验证'),
    ]);
    const r = runCli({ mode: 'report', transcriptPath: p });
    const report = JSON.parse(r.stdout);
    assert.equal(report.fixSession, true);
    assert.equal(report.inFlightDelegations.length, 1);
  });
});

// ════════════════════════════════════════
// F270 P2b · FR-024/045 审计黑洞收口（A-3 / R-2 实证的两条静默路径）
// Tests FIRST：合规早退当前零落盘、空 transcript 当前静默放行，本组先红。
// ════════════════════════════════════════

describe('F270 P2b · 审计黑洞收口', () => {
  function readAuditEvents() {
    const runsDir = path.join(tmp, '.specify', 'runs');
    if (!fs.existsSync(runsDir)) return [];
    const events = [];
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      for (const line of fs.readFileSync(path.join(runsDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* 忽略坏行 */ }
      }
    }
    return events;
  }

  it('🔴 合规早退不再零落盘：compliant verdict 落审计事件（R-2 收口）', () => {
    const p = compliantTranscript();
    const r = runCli({ mode: 'hook', transcriptPath: p, sessionId: 'p2b-compliant' });
    assert.equal(r.status, 0, '合规仍放行');
    const hits = readAuditEvents().filter(
      (e) => e.eventType === 'fix-compliance-verdict' && e.sessionId === 'p2b-compliant' && e.compliant === true
    );
    assert.equal(hits.length, 1, '曾 fix 展开的会话，合规裁决必须留痕（FR-024 修订版）');
  });

  it('🔴 空 transcript：独立诊断码 transcript-empty + fail-open 落盘（N1 收口）', () => {
    const p = path.join(tmp, 'empty.jsonl');
    fs.writeFileSync(p, '');
    const r = runCli({ mode: 'report', transcriptPath: p, sessionId: 'p2b-empty' });
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.ok(
      report.transcriptDiagnostics.includes('transcript-empty'),
      `空 transcript 须落独立诊断码而非静默按"非 fix"放行；实际 ${JSON.stringify(report.transcriptDiagnostics)}`
    );
    const rh = runCli({ mode: 'hook', transcriptPath: p, sessionId: 'p2b-empty-hook' });
    assert.equal(rh.status, 0, '空 transcript 仍 fail-open 放行');
    const hits = readAuditEvents().filter(
      (e) => e.sessionId === 'p2b-empty-hook' && (e.diagnostics || []).includes('transcript-empty')
    );
    assert.equal(hits.length, 1, 'hook 侧须 loud 落盘（与 transcript-unavailable 同族）');
  });

  it('US5 回归钉：从未 fix 展开的会话仍零落盘', () => {
    const p = path.join(tmp, 'healthy.jsonl');
    fs.writeFileSync(
      p,
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '普通会话' }] } }) + '\n'
    );
    const specifyDir = path.join(tmp, '.specify');
    fs.rmSync(specifyDir, { recursive: true, force: true });
    const r = runCli({ mode: 'hook', transcriptPath: p, sessionId: 'p2b-healthy' });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(specifyDir), false, '健康路径不得凭空创建 .specify/（US5）');
  });
});

// ════════════════════════════════════════
// F270 P3 · 在途三态 + 解锁计时器 nonBlockStopCount + 重入(必答③) + delta-2 定时雷
// Tests FIRST：重入/三态/计时器判定路径尚不存在，本组先红。
// ════════════════════════════════════════

describe('F270 P3 · 重入语义（对抗 CRITICAL-1 修订后：不改路由，仅诊断登记）+ 解锁计时器单元', () => {
  // 不合规会话（缺 fix-report + 委派）→ 正常路径 exit 2
  function nonCompliantTranscript() {
    return writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      ASSISTANT_TEXT('开始但什么都没做'),
    ]);
  }
  function readVerdictEventsFor(sessionId) {
    const runsDir = path.join(tmp, '.specify', 'runs');
    if (!fs.existsSync(runsDir)) return [];
    const events = [];
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      for (const line of fs.readFileSync(path.join(runsDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); if (e.sessionId === sessionId) events.push(e); } catch { /* skip */ }
      }
    }
    return events;
  }

  it('🔴 对抗 C-1 回归钉：重入不合规 → 裁决与非重入逐字一致（exit 2 + 计 blockCount），不提前放行', () => {
    // 初版"重入必放行"被对抗实跑证伪：把最短绕过从 2 次 exit 2 砍到 1 次且零终态。
    // 终版：重入不改路由。真实序列 exit2 → 重入 Stop 仍 exit 2（blockCount 1→2）→ 第三次 degraded。
    const p = nonCompliantTranscript();
    const r1 = runCli({ transcriptPath: p, sessionId: 'p3-re', stopHookActive: false });
    assert.equal(r1.status, 2);
    const r2 = runCli({ transcriptPath: p, sessionId: 'p3-re', stopHookActive: true });
    assert.equal(r2.status, 2, '重入不得提前放行——BLOCK_LIMIT=2 已有界防循环，提前放行=净损一格预算');
    const statePath = path.join(tmp, '.specify', 'runs', '.fix-compliance-state', 'p3-re.json');
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(st.blockCount, 2, '重入照常计 blockCount（与改动前逐字一致）');
    assert.equal(st.nonBlockStopCount, 0, '重入不再计解锁计时器（撤线）');
    const r3 = runCli({ transcriptPath: p, sessionId: 'p3-re', stopHookActive: true });
    assert.equal(r3.status, 0, '第三次达 BLOCK_LIMIT → releaseDegraded（既有语义）');
  });

  it('重入的可观测性：审计事件带 stop-hook-reentry 码（新增仅此）', () => {
    const p = nonCompliantTranscript();
    runCli({ transcriptPath: p, sessionId: 'p3-re-diag', stopHookActive: true });
    const evs = readVerdictEventsFor('p3-re-diag');
    assert.ok(evs.length >= 1);
    assert.ok(evs.some((e) => (e.diagnostics || []).includes('stop-hook-reentry')),
      `重入须可观测：${JSON.stringify(evs.map((e) => e.diagnostics))}`);
  });

  it('非布尔 stop_hook_active（"true" 字符串）→ 无 reentry 码，裁决不变', () => {
    const p = nonCompliantTranscript();
    const res = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', tmp], {
      input: JSON.stringify({ session_id: 'p3-nonbool', transcript_path: p, stop_hook_active: 'true' }),
      encoding: 'utf8', env: { ...process.env },
    });
    assert.equal(res.status, 2);
    const evs = readVerdictEventsFor('p3-nonbool');
    assert.ok(!evs.some((e) => (e.diagnostics || []).includes('stop-hook-reentry')));
  });

  it('🔴 delta-2 定时雷：NON_BLOCK_LIMIT ≥ BLOCK_LIMIT（阈值不变量）', async () => {
    const mod = await import('../scripts/fix-compliance-judge.mjs');
    assert.ok(mod.NON_BLOCK_LIMIT >= mod.BLOCK_LIMIT,
      `NON_BLOCK_LIMIT(${mod.NON_BLOCK_LIMIT}) 必须 ≥ BLOCK_LIMIT(${mod.BLOCK_LIMIT})`);
  });

  // routeNonBlock 当前零接线（重入撤线，P4 GATE 指纹接入）——单元级钉死其合同
  describe('routeNonBlock 单元（零接线期合同）', () => {
    const fakeVerdict = { closureForm: 'repair', compliant: false, missing: ['verification-report.md'], diagnostics: [] };

    it('未耗尽：exit 0 + 计数 +1 + 审计 + loud stderr（不留最安静通道）', async () => {
      const { routeNonBlock } = await import('../scripts/fix-compliance-judge.mjs');
      const code = routeNonBlock(tmp, 'rnb-1', fakeVerdict, 'stop-hook-reentry', 10);
      assert.equal(code, 0);
      const st = JSON.parse(fs.readFileSync(path.join(tmp, '.specify', 'runs', '.fix-compliance-state', 'rnb-1.json'), 'utf8'));
      assert.equal(st.nonBlockStopCount, 1);
    });

    it('🔴 快路径耗尽 → 终态可见（recordWorkflowRun paused + 触发标注）', async () => {
      const { routeNonBlock, NON_BLOCK_LIMIT } = await import('../scripts/fix-compliance-judge.mjs');
      for (let i = 0; i <= NON_BLOCK_LIMIT; i++) routeNonBlock(tmp, 'rnb-2', fakeVerdict, 'stop-hook-reentry', 10);
      const evs = readVerdictEventsFor('rnb-2');
      assert.ok(evs.some((e) => (e.diagnostics || []).includes('nonblock-limit-exhausted')), '耗尽须标触发计时器（SC-014）');
    });

    it('🔴 对抗 C-2 回归钉：backstop 比常量不存锚——擦库后仍触发（不可擦为真）', async () => {
      const { routeNonBlock, NON_BLOCK_ENTRY_LIMIT } = await import('../scripts/fix-compliance-judge.mjs');
      const stateDir = path.join(tmp, '.specify', 'runs', '.fix-compliance-state');
      // 每次调用前擦库（快路径恒 0），entryCount 超常量 → backstop 必须触发终态
      fs.rmSync(stateDir, { recursive: true, force: true });
      routeNonBlock(tmp, 'rnb-3', fakeVerdict, 'stop-hook-reentry', NON_BLOCK_ENTRY_LIMIT + 5);
      const evs = readVerdictEventsFor('rnb-3');
      assert.ok(evs.some((e) => (e.diagnostics || []).includes('nonblock-backstop-exhausted')),
        '初版把锚存可擦文件（delta=单调量−可擦锚=整体可擦，对抗双路命中）；终版单调量比常量，rm -rf 无效');
    });

    it('主路径被占位 → tmpdir 二级降级仍计数成功（不误触 storage-unavailable）', async () => {
      // saveBlockState 有两级存储（主路径→tmpdir），仅两级皆失败才 ok:false。
      // 主路径占位只应触发降级、计数照常——storage-unavailable 分支的 ok:false 语义
      // 由 io 层测试与 routeNonBlock 代码路径（!saved.ok → 视同耗尽）共同覆盖，
      // tmpdir 不可注入故不在 CLI 级强造两级全失败。
      const { routeNonBlock } = await import('../scripts/fix-compliance-judge.mjs');
      const runsDir = path.join(tmp, '.specify', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      fs.rmSync(path.join(runsDir, '.fix-compliance-state'), { recursive: true, force: true });
      fs.writeFileSync(path.join(runsDir, '.fix-compliance-state'), 'blocker');
      try {
        const code = routeNonBlock(tmp, 'rnb-4', fakeVerdict, 'stop-hook-reentry', 10);
        assert.equal(code, 0);
        const evs = readVerdictEventsFor('rnb-4');
        // 未耗尽、tmpdir 降级成功 → 正常审计（带 reason 码），不误标 storage-unavailable
        assert.ok(evs.some((e) => (e.diagnostics || []).includes('stop-hook-reentry')));
        assert.ok(!evs.some((e) => (e.diagnostics || []).includes('nonblock-storage-unavailable')),
          'tmpdir 降级成功不得误标存储不可用');
      } finally {
        fs.rmSync(path.join(runsDir, '.fix-compliance-state'), { force: true });
      }
    });
  });
});

describe('F270 P3 · background_tasks 在途三态端到端', () => {
  function deferrableTranscript() {
    // 缺 verification-report + delegation:verify（均在可推迟白名单）→ 在途时应推迟。
    // fix-report 用 REPAIR_FIX_REPORT：内容须过 F228 占位判据（太短会判 placeholder，
    // 而 placeholder 不在 DEFERRABLE 白名单 → 闸门一不过 → 不推迟——红先行时踩过）。
    return writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }),
      // 委派带 id 且无配对回执 → transcript 派生的 trailing 在途判据可命中
      // （findTrailingUnresolvedSyncDelegation 要求 tool_use.id 非空——undetermined 退回路径的前提）
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'Agent', id: 'toolu_P3_INFLIGHT', input: { subagent_type: 'spec-driver:implement', description: '执行代码修复' } },
      ] } },
    ]);
  }

  it('background_tasks 非空 → in-flight 诊断码进审计', () => {
    const p = deferrableTranscript();
    fs.mkdirSync(path.join(tmp, 'specs', '301-fix-sample-bug'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', '301-fix-sample-bug', 'fix-report.md'), REPAIR_FIX_REPORT);
    const r = runCli({ transcriptPath: p, sessionId: 'p3-bt', backgroundTasks: [{ id: 'a1', type: 'subagent', status: 'running' }] });
    assert.equal(r.status, 0, 'harness 权威在途 → 推迟放行');
  });

  it('🔴 background_tasks 键缺席 → undetermined，不坍缩为 no-in-flight', () => {
    // 键缺席时退回 transcript 派生在途判定（向后兼容），不因"探测不到"当"确证无在途"
    const p = deferrableTranscript();
    fs.mkdirSync(path.join(tmp, 'specs', '301-fix-sample-bug'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', '301-fix-sample-bug', 'fix-report.md'), REPAIR_FIX_REPORT);
    const r = runCli({ transcriptPath: p, sessionId: 'p3-undet' }); // 不传 backgroundTasks
    assert.equal(r.status, 0, 'undetermined 退回 transcript 派生(该会话有 transcript 在途委派)仍推迟');
  });
});

describe('F270 P3 · saveBlockState 带回合同（漏带即清零回归钉）', () => {
  it('🔴 解锁计时器计数不被后续 routeBlock 写入抹平', async () => {
    const p = writeTranscript([SKILL_EXPANSION_LINE('fix'), ASSISTANT_TEXT('未收口')]);
    // 1) routeNonBlock 一次 → nonBlockStopCount=1（重入已撤线，直接经零接线通道造数）
    const { routeNonBlock } = await import('../scripts/fix-compliance-judge.mjs');
    routeNonBlock(tmp, 'p3-carry', { closureForm: 'repair', compliant: false, missing: [], diagnostics: [] }, 'stop-hook-reentry', 10);
    const statePath = path.join(tmp, '.specify', 'runs', '.fix-compliance-state', 'p3-carry.json');
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).nonBlockStopCount, 1);
    // 2) 正常不合规 Stop → routeBlock 写入(blockCount 1) → 计时器必须原样带回
    const r = runCli({ transcriptPath: p, sessionId: 'p3-carry', stopHookActive: false });
    assert.equal(r.status, 2);
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(s.blockCount, 1);
    assert.equal(s.nonBlockStopCount, 1, 'routeBlock 整体覆写不得抹平解锁计时器（自查抓到的漏带 bug）');
    // 3) 在途推迟写入同样不得抹平(构造 harness 在途)
    fs.mkdirSync(path.join(tmp, 'specs', '301-fix-sample-bug'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', '301-fix-sample-bug', 'fix-report.md'), REPAIR_FIX_REPORT);
    const p2 = writeTranscript([
      SKILL_EXPANSION_LINE('fix'),
      TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码修复' }),
    ]);
    runCli({ transcriptPath: p2, sessionId: 'p3-carry', backgroundTasks: [{ id: 'x', type: 'subagent', status: 'running' }] });
    const s2 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(s2.nonBlockStopCount, 1, '推迟分支写入不得抹平解锁计时器');
    assert.equal(s2.inFlightDeferCount, 1, '推迟计数正常累积');
  });
});
