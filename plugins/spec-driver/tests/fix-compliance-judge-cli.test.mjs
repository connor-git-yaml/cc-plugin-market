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
