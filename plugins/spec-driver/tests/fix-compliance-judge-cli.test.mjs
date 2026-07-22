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
import { MISSING_ACTION_TEXT } from '../scripts/lib/fix-compliance-core.mjs';

const CLI = fileURLToPath(new URL('../scripts/fix-compliance-judge.mjs', import.meta.url));
const HOOK_SH = fileURLToPath(new URL('../hooks/stop-fix-compliance-check.sh', import.meta.url));

const SKILL_EXPANSION_LINE = (mode) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}\n请修复问题` }] },
});
const ASSISTANT_TEXT = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const TOOL_USE = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

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
function runCli({ mode = 'hook', transcriptPath, sessionId = 's1', projectRoot = tmp, env = {} }) {
  const payload = JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, stop_hook_active: false });
  const res = spawnSync('node', [CLI, '--mode', mode, '--project-root', projectRoot], {
    input: payload,
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
